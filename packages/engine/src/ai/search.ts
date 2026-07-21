/**
 * "Joshua" — the search + evaluation CPU (the top difficulty tier, named for the
 * WOPR AI in WarGames, 1983). Unlike the greedy heuristic tiers, Joshua plans its
 * attacks with a bounded expectimax-lite lookahead: it expands the most promising
 * border attacks, models each as win-with-probability-`conquestProbability` (occupy)
 * versus loss (attrition), recurses a few plies, and scores leaf positions with
 * `evaluate()`. Reinforcements are placed on whichever border most improves that
 * attacking future. Fortify/occupy/cards reuse strong heuristics (position, which
 * `evaluate()` doesn't capture, is handled directly).
 *
 * Fully deterministic (analytic odds, no RNG), so games stay reproducible/testable.
 * Bounded by node/depth/beam constants, so a decision is cheap (single-digit ms).
 */
import type { Action } from "../actions.js";
import { validSetsInHand } from "../cards.js";
import { perceivedArmies, territoriesOf } from "../game.js";
import type { GameState, PlayerId, TerritoryId, TerritoryState } from "../types.js";
import type { ActionCardType } from "../types.js";
import { conquestProbability } from "./battleOdds.js";
import {
  AIRSTRIKE_MIN_DEFENDERS,
  campaignBonus,
  chooseFortify,
  chooseMisinformation,
  chooseOccupy,
  enemyNeighbours,
  isBorder,
} from "./boardHelpers.js";
import { evaluate } from "./evaluate.js";
import type { AIController } from "./policy.js";

// Search budget. A full turn's decisions stay well under a few thousand leaf evals.
const ATTACK_DEPTH = 3;
const ATTACK_BEAM = 5;
const MAX_NODES = 2500;
const REINFORCE_DEPTH = 2;

// --- helpers (most board helpers are shared via boardHelpers.ts) -------------

/** Cheap hypothetical: a state sharing everything but with a few territories overridden. */
function withEdits(s: GameState, edits: Record<TerritoryId, TerritoryState>): GameState {
  return { ...s, territories: { ...s.territories, ...edits } };
}

// --- attack search (expectimax-lite) ----------------------------------------

interface AttackPlan {
  action: Action | null; // null = stand pat (endAttack)
  ev: number;
}

/** Best attack (or standing pat) from `s`, looking `depth` plies ahead. */
function planAttack(s: GameState, me: PlayerId, depth: number, budget: { n: number }): AttackPlan {
  const stand = evaluate(s, me);
  if (depth <= 0 || budget.n <= 0) return { action: null, ev: stand };

  const cands: { from: TerritoryId; to: TerritoryId; a: number; d: number; p: number; camp: number }[] = [];
  for (const from of territoriesOf(s, me)) {
    const a = s.territories[from].armies;
    if (a < 2) continue;
    for (const to of enemyNeighbours(s, me, from)) {
      const d = Math.max(1, perceivedArmies(s, me, to));
      const p = conquestProbability(a, d);
      const camp = campaignBonus(s, me, to);
      if (p < (camp > 0 ? 0.25 : 0.4)) continue; // skip hopeless (chase objectives harder)
      cands.push({ from, to, a, d, p, camp });
    }
  }
  if (!cands.length) return { action: null, ev: stand };

  cands.sort((x, y) => y.p + y.camp - (x.p + x.camp));
  let best: AttackPlan = { action: null, ev: stand }; // standing pat is the baseline

  for (const c of cands.slice(0, ATTACK_BEAM)) {
    budget.n--;
    // Win: keep a garrison on `from` only if it still faces other enemies.
    const garrison = enemyNeighbours(s, me, c.from).some((n) => n !== c.to);
    const moveIn = garrison ? Math.max(1, Math.ceil((c.a - 1) / 2)) : Math.max(1, c.a - 1 - Math.round(c.d * 0.7));
    const winEdits = {
      [c.to]: { owner: me, armies: Math.max(1, moveIn) },
      [c.from]: { owner: me, armies: Math.max(1, c.a - moveIn) },
    };
    const winStateVal = evaluate(withEdits(s, winEdits), me);
    let winVal = winStateVal;
    if (depth > 1 && budget.n > 0) winVal = Math.max(winVal, planAttack(withEdits(s, winEdits), me, depth - 1, budget).ev);
    winVal += 5 * c.camp;

    // Lose: attacker knocked back to 1, defender lightly attrited.
    const loseVal = evaluate(
      withEdits(s, {
        [c.from]: { owner: me, armies: 1 },
        [c.to]: { owner: s.territories[c.to].owner, armies: Math.max(1, c.d - Math.round(c.d * 0.3)) },
      }),
      me,
    );

    const ev = c.p * winVal + (1 - c.p) * loseVal;
    if (ev > best.ev + 1e-6)
      best = { action: { type: "attack", from: c.from, to: c.to, dice: Math.min(3, c.a - 1) }, ev };
  }
  return best;
}

// --- reinforce / fortify / occupy / cards -----------------------------------

/** Place the pool on the border that most improves our best attacking future. */
function chooseReinforceTarget(s: GameState, me: PlayerId): TerritoryId {
  const owned = territoriesOf(s, me);
  const borders = owned.filter((t) => isBorder(s, me, t));
  if (borders.length === 0) return owned[0];
  const pool = s.reinforcementsRemaining;
  let best = borders[0];
  let bestVal = -Infinity;
  for (const t of borders) {
    const st = withEdits(s, { [t]: { owner: me, armies: s.territories[t].armies + pool } });
    const campHere = Math.max(0, ...enemyNeighbours(s, me, t).map((n) => campaignBonus(s, me, n)));
    const val = planAttack(st, me, REINFORCE_DEPTH, { n: 600 }).ev + 3 * campHere;
    if (val > bestVal) {
      bestVal = val;
      best = t;
    }
  }
  return best;
}

// --- controller -------------------------------------------------------------

export function createSearchAI(): AIController {
  return {
    decide(s: GameState): Action {
      const me = s.activePlayer;
      const player = s.players.find((p) => p.id === me)!;
      const holds = (c: ActionCardType) => s.options.actionCardsEnabled && player.actionCards.includes(c);

      if (s.phase === "reinforce") {
        const sets = validSetsInHand(player.cards);
        if (sets.length > 0) return { type: "tradeCards", cards: sets[0] };
        if (holds("misinformation")) {
          const m = chooseMisinformation(s, me);
          if (m) return { type: "playActionCard", card: "misinformation", territory: m.territory, fake: m.fake };
        }
        return { type: "placeArmies", territory: chooseReinforceTarget(s, me), count: s.reinforcementsRemaining };
      }

      if (s.phase === "attack") {
        if (s.pendingOccupation) return chooseOccupy(s, me);
        const plan = planAttack(s, me, ATTACK_DEPTH, { n: MAX_NODES });
        if (!plan.action) return { type: "endAttack" };
        const atk = plan.action as Extract<Action, { type: "attack" }>;
        if (holds("airStrike") && perceivedArmies(s, me, atk.to) >= AIRSTRIKE_MIN_DEFENDERS)
          return { type: "playActionCard", card: "airStrike", from: atk.from, to: atk.to };
        return plan.action;
      }

      // fortify
      if (holds("troopTransport") && !s.fortifyAnywhere && !chooseFortify(s, me) && chooseFortify(s, me, true))
        return { type: "playActionCard", card: "troopTransport" };
      return chooseFortify(s, me) ?? { type: "endTurn" };
    },
  };
}
