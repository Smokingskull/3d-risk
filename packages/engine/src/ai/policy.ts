/**
 * Difficulty-tiered CPU policies. Each is a deterministic function of the game
 * state (no Math.random), so CPU turns are reproducible and testable.
 */
import type { Action } from "../actions.js";
import { validSetsInHand } from "../cards.js";
import { applyAction, perceivedArmies, territoriesOf } from "../game.js";
import type { GameState, PlayerId, TerritoryId } from "../types.js";
import { conquestProbability } from "./battleOdds.js";

export type Difficulty = "easy" | "medium" | "hard";

interface Knobs {
  /** Minimum conquest probability worth attacking. */
  attackThreshold: number;
  /** Whether to consolidate armies in the fortify phase. */
  fortify: boolean;
  /** Whether to trade card sets whenever available (else only when forced). */
  eagerTrade: boolean;
  /** Whether attack choice is biased toward completing continents. */
  continentAware: boolean;
}

const KNOBS: Record<Difficulty, Knobs> = {
  easy: { attackThreshold: 0.7, fortify: false, eagerTrade: false, continentAware: false },
  medium: { attackThreshold: 0.6, fortify: true, eagerTrade: true, continentAware: false },
  hard: { attackThreshold: 0.5, fortify: true, eagerTrade: true, continentAware: true },
};

// --- board helpers ----------------------------------------------------------

function enemyNeighbours(s: GameState, me: PlayerId, t: TerritoryId): TerritoryId[] {
  return s.board.territories[t].neighbours.filter((n) => s.territories[n].owner !== me);
}

function isBorder(s: GameState, me: PlayerId, t: TerritoryId): boolean {
  return enemyNeighbours(s, me, t).length > 0;
}

function mustTrade(s: GameState): boolean {
  if (!s.options.cardsEnabled) return false;
  const p = s.players.find((pl) => pl.id === s.activePlayer)!;
  return p.cards.length >= 5;
}

/** 0..1 bonus for attacking `to` when it advances the active player's campaign
 * objective: capturing the target country, taking territory in the target
 * continent, or hitting the assassination target's land. */
function campaignAttackBonus(s: GameState, me: PlayerId, to: TerritoryId): number {
  const c = s.players.find((p) => p.id === me)?.campaign;
  if (!c) return 0;
  if (c.kind === "country") {
    if (to === c.territory) return 1;
    return s.board.territories[to].neighbours.includes(c.territory) ? 0.3 : 0;
  }
  if (c.kind === "continent") return s.board.territories[to].continent === c.continent ? 1 : 0;
  return s.territories[to].owner === c.target ? 1 : 0; // assassination
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
      const campScore = Math.max(0, ...en.map((n) => campaignAttackBonus(s, me, n)));
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
      const camp = campaignAttackBonus(s, me, to);
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

function chooseFortify(s: GameState, me: PlayerId): Action | null {
  const owned = territoriesOf(s, me);
  // Interior territories (no enemy neighbours) with spare armies are "trapped".
  const interiors = owned
    .filter((t) => s.territories[t].armies >= 2 && !isBorder(s, me, t))
    .sort((a, b) => s.territories[b].armies - s.territories[a].armies);

  for (const from of interiors) {
    // Reachable owned border, most threatened first.
    const targets = owned
      .filter((t) => t !== from && isBorder(s, me, t) && pathThroughOwned(s, me, from, t))
      .sort(
        (a, b) =>
          enemyArmyPressure(s, me, b) - enemyArmyPressure(s, me, a),
      );
    if (targets.length > 0)
      return { type: "fortify", from, to: targets[0], count: s.territories[from].armies - 1 };
  }
  return null;
}

function enemyArmyPressure(s: GameState, me: PlayerId, t: TerritoryId): number {
  return enemyNeighbours(s, me, t).reduce((sum, n) => sum + s.territories[n].armies, 0);
}

function pathThroughOwned(s: GameState, me: PlayerId, from: TerritoryId, to: TerritoryId): boolean {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    for (const n of s.board.territories[cur].neighbours)
      if (!seen.has(n) && s.territories[n].owner === me) {
        seen.add(n);
        stack.push(n);
      }
  }
  return false;
}

// --- controller -------------------------------------------------------------

export interface AIController {
  decide(state: GameState): Action;
}

export function createAI(difficulty: Difficulty): AIController {
  const k = KNOBS[difficulty];
  return {
    decide(s: GameState): Action {
      const me = s.activePlayer;

      if (s.phase === "reinforce") {
        const sets = validSetsInHand(s.players.find((p) => p.id === me)!.cards);
        if (sets.length > 0 && (mustTrade(s) || k.eagerTrade)) return { type: "tradeCards", cards: sets[0] };
        return { type: "placeArmies", territory: chooseReinforceTarget(s, me, k), count: s.reinforcementsRemaining };
      }

      if (s.phase === "attack") {
        if (s.pendingOccupation) {
          const { from, to, min, max } = s.pendingOccupation;
          // Push forward, but keep a garrison if the source still borders enemies.
          const sourceStillBorders = enemyNeighbours(s, me, from).some((n) => n !== to);
          const count = sourceStillBorders ? Math.max(min, Math.ceil(max / 2)) : max;
          return { type: "occupy", count: Math.min(max, Math.max(min, count)) };
        }
        const attack = chooseAttack(s, me, k);
        return attack ? { type: "attack", from: attack.from, to: attack.to, dice: attack.dice } : { type: "endAttack" };
      }

      // fortify
      if (k.fortify) {
        const move = chooseFortify(s, me);
        if (move) return move;
      }
      return { type: "endTurn" };
    },
  };
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
    const action = ai.decide(s);
    actions.push(action);
    s = applyAction(s, action).state;
    if (s.winner || s.activePlayer !== me) break;
  }
  return actions;
}
