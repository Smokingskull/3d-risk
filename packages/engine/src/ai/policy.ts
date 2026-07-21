/**
 * Difficulty-tiered CPU policies. Each is a deterministic function of the game
 * state (no Math.random), so CPU turns are reproducible and testable.
 */
import type { Action } from "../actions.js";
import { validSetsInHand } from "../cards.js";
import { applyAction, perceivedArmies, territoriesOf } from "../game.js";
import type { ActionCardType, GameState, PlayerId, TerritoryId } from "../types.js";
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
import { createSearchAI } from "./search.js";

export type Difficulty = "easy" | "medium" | "hard" | "joshua";

interface Knobs {
  /** Minimum conquest probability worth attacking. */
  attackThreshold: number;
  /** Whether to consolidate armies in the fortify phase. */
  fortify: boolean;
  /** Whether to trade card sets whenever available (else only when forced). */
  eagerTrade: boolean;
  /** Whether attack choice is biased toward completing continents. */
  continentAware: boolean;
  /** Action-card usage: "none" ignores them, "some" uses the simple ones (Air
   * Strike, Minefield), "all" uses every card including bluffs and retreats. */
  useCards: "none" | "some" | "all";
}

const KNOBS: Record<Difficulty, Knobs> = {
  easy: { attackThreshold: 0.7, fortify: false, eagerTrade: false, continentAware: false, useCards: "none" },
  medium: { attackThreshold: 0.6, fortify: true, eagerTrade: true, continentAware: false, useCards: "some" },
  hard: { attackThreshold: 0.5, fortify: true, eagerTrade: true, continentAware: true, useCards: "all" },
  // Joshua's turn logic lives in search.ts; these knobs only drive its (hard-grade)
  // defensive reactions in decideReaction.
  joshua: { attackThreshold: 0.5, fortify: true, eagerTrade: true, continentAware: true, useCards: "all" },
};

// --- helpers (enemyNeighbours / isBorder / campaignBonus / chooseFortify /
//     chooseMisinformation / chooseOccupy / AIRSTRIKE_MIN_DEFENDERS live in
//     boardHelpers.ts, shared with the search AI) ------------------------------

function mustTrade(s: GameState): boolean {
  if (!s.options.cardsEnabled) return false;
  const p = s.players.find((pl) => pl.id === s.activePlayer)!;
  return p.cards.length >= 5;
}

/** How valuable taking `to` is toward completing its continent (0..bonus·2). */
function continentValue(s: GameState, me: PlayerId, to: TerritoryId): number {
  const cont = s.board.continents[s.board.territories[to].continent];
  if (!cont) return 0;
  const owned = cont.territories.filter((t) => s.territories[t].owner === me).length;
  const after = owned + 1;
  const completes = after === cont.territories.length ? cont.bonus : 0;
  return cont.bonus * (after / cont.territories.length) + completes;
}

// --- per-phase decisions ----------------------------------------------------

function chooseReinforceTarget(s: GameState, me: PlayerId, k: Knobs): TerritoryId {
  const owned = territoriesOf(s, me);
  const borders = owned.filter((t) => isBorder(s, me, t));
  if (borders.length === 0) return owned[0];

  // Campaign pursuit (any difficulty): reinforce the border best placed to hit
  // the objective — adjacent to the target country/continent/assassination land.
  if (s.players.find((p) => p.id === me)?.campaign) {
    let best = borders[0];
    let bestScore = -Infinity;
    for (const t of borders) {
      const en = enemyNeighbours(s, me, t);
      const campScore = Math.max(0, ...en.map((n) => campaignBonus(s, me, n)));
      const weakest = Math.min(...en.map((n) => perceivedArmies(s, me, n)));
      const score = 10 * campScore - weakest;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  if (!k.eagerTrade && !k.continentAware) return borders[0]; // easy: first border

  // Spearhead: reinforce the border touching the weakest enemy territory,
  // optionally biased toward continents we nearly control.
  let best = borders[0];
  let bestScore = -Infinity;
  for (const t of borders) {
    const weakestEnemy = Math.min(...enemyNeighbours(s, me, t).map((n) => perceivedArmies(s, me, n)));
    let score = -weakestEnemy;
    if (k.continentAware)
      score += Math.max(...enemyNeighbours(s, me, t).map((n) => continentValue(s, me, n)));
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

interface AttackChoice {
  from: TerritoryId;
  to: TerritoryId;
  dice: number;
  score: number;
}

function chooseAttack(s: GameState, me: PlayerId, k: Knobs): AttackChoice | null {
  let best: AttackChoice | null = null;
  for (const from of territoriesOf(s, me)) {
    const armies = s.territories[from].armies;
    if (armies < 2) continue;
    for (const to of enemyNeighbours(s, me, from)) {
      const odds = conquestProbability(armies, perceivedArmies(s, me, to));
      const camp = campaignBonus(s, me, to);
      // Pursue campaign targets even at moderate odds (but not hopeless ones).
      const threshold = camp > 0 ? Math.min(k.attackThreshold, 0.45) : k.attackThreshold;
      if (odds < threshold) continue;
      const score = odds + (k.continentAware ? 0.15 * continentValue(s, me, to) : 0) + 5 * camp;
      if (!best || score > best.score)
        best = { from, to, dice: Math.min(3, armies - 1), score };
    }
  }
  return best;
}

// --- controller -------------------------------------------------------------

export interface AIController {
  decide(state: GameState): Action;
}

export function createAI(difficulty: Difficulty): AIController {
  if (difficulty === "joshua") return createSearchAI();
  const k = KNOBS[difficulty];
  return {
    decide(s: GameState): Action {
      const me = s.activePlayer;
      const holds = (c: ActionCardType) =>
        s.options.actionCardsEnabled && s.players.find((p) => p.id === me)!.actionCards.includes(c);

      if (s.phase === "reinforce") {
        const sets = validSetsInHand(s.players.find((p) => p.id === me)!.cards);
        if (sets.length > 0 && (mustTrade(s) || k.eagerTrade)) return { type: "tradeCards", cards: sets[0] };
        // Bluff a weak border as strong before deploying (hard only).
        if (k.useCards === "all" && holds("misinformation") && !mustTrade(s)) {
          const m = chooseMisinformation(s, me);
          if (m) return { type: "playActionCard", card: "misinformation", territory: m.territory, fake: m.fake };
        }
        return { type: "placeArmies", territory: chooseReinforceTarget(s, me, k), count: s.reinforcementsRemaining };
      }

      if (s.phase === "attack") {
        if (s.pendingOccupation) return chooseOccupy(s, me);
        const attack = chooseAttack(s, me, k);
        if (!attack) return { type: "endAttack" };
        // Soften a well-defended target with an Air Strike first (medium+hard).
        if (k.useCards !== "none" && holds("airStrike") && perceivedArmies(s, me, attack.to) >= AIRSTRIKE_MIN_DEFENDERS)
          return { type: "playActionCard", card: "airStrike", from: attack.from, to: attack.to };
        return { type: "attack", from: attack.from, to: attack.to, dice: attack.dice };
      }

      // fortify — Troop Transport unlocks a redeploy that connectivity forbids (hard only).
      if (k.useCards === "all" && holds("troopTransport") && !s.fortifyAnywhere && !chooseFortify(s, me) && chooseFortify(s, me, true))
        return { type: "playActionCard", card: "troopTransport" };
      if (k.fortify) {
        const move = chooseFortify(s, me);
        if (move) return move;
      }
      return { type: "endTurn" };
    },
  };
}

/**
 * Resolve an open defender decision window (Minefield / Tactical Retreat) for the
 * CPU whose reaction is pending — using that defender's difficulty. Deterministic.
 * "some" (medium) lays Minefields; "all" (hard) also retreats a losing battle it
 * can preserve; "none" (easy) declines both.
 */
export function decideReaction(state: GameState): Action {
  const pd = state.pendingDecision;
  if (!pd) return { type: "resolveDecision", play: false };
  const defender = state.players.find((p) => p.id === pd.player);
  const k = KNOBS[(defender?.difficulty as Difficulty) ?? "medium"];

  if (pd.kind === "minefield") return { type: "resolveDecision", play: k.useCards !== "none" };

  if (pd.kind === "tacticalRetreat" && k.useCards === "all") {
    const contested = state.territories[pd.territory];
    const attacker = state.territories[pd.from];
    const targets = state.board.territories[pd.territory].neighbours
      .filter((n) => state.territories[n].owner === pd.player)
      .sort((a, b) => state.territories[b].armies - state.territories[a].armies);
    // Retreat a losing battle when there are armies worth saving and a haven.
    if (contested.armies >= 2 && attacker.armies > contested.armies && targets.length > 0)
      return { type: "resolveDecision", play: true, to: targets[0] };
  }
  return { type: "resolveDecision", play: false };
}

/**
 * Plan the active (CPU) player's entire turn as a list of actions, by running the
 * policy against a private simulation. The list replays identically on the real
 * game because the engine is deterministic.
 */
export function planTurn(state: GameState, maxActions = 5000): Action[] {
  const player = state.players.find((p) => p.id === state.activePlayer)!;
  const ai = createAI((player.difficulty as Difficulty) ?? "medium");
  const actions: Action[] = [];
  let s = state;
  const me = state.activePlayer;
  for (let i = 0; i < maxActions; i++) {
    // A defender reaction window (Minefield / Tactical Retreat) can open mid-turn;
    // resolve it as that defender so the simulation can continue.
    const action = s.pendingDecision ? decideReaction(s) : ai.decide(s);
    actions.push(action);
    s = applyAction(s, action).state;
    if (s.winner || s.activePlayer !== me) break;
  }
  return actions;
}
