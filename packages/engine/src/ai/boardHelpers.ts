/**
 * Board/position helpers shared by the heuristic policies (`policy.ts`) and the
 * search AI (`search.ts`). Pure and deterministic. Kept in one place so the two
 * tiers can't drift (they previously carried byte-identical copies of these).
 */
import type { Action } from "../actions.js";
import { reinforcementsFor, territoriesOf } from "../game.js";
import type { GameState, PlayerId, TerritoryId } from "../types.js";

/** Defender armies at which an Air Strike is worth spending before attacking. */
export const AIRSTRIKE_MIN_DEFENDERS = 4;

export function enemyNeighbours(s: GameState, me: PlayerId, t: TerritoryId): TerritoryId[] {
  return s.board.territories[t].neighbours.filter((n) => s.territories[n].owner !== me);
}

export function isBorder(s: GameState, me: PlayerId, t: TerritoryId): boolean {
  return enemyNeighbours(s, me, t).length > 0;
}

export function enemyArmyPressure(s: GameState, me: PlayerId, t: TerritoryId): number {
  return enemyNeighbours(s, me, t).reduce((sum, n) => sum + s.territories[n].armies, 0);
}

/** Whether `to` is reachable from `from` through territories all owned by `me`. */
export function pathThroughOwned(s: GameState, me: PlayerId, from: TerritoryId, to: TerritoryId): boolean {
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

/** 0..1 bonus for attacking `to` when it advances the active player's campaign
 * objective: capturing the target country (or a neighbour of it), taking territory in
 * the target continent, or hitting the assassination target's land. */
export function campaignBonus(s: GameState, me: PlayerId, to: TerritoryId): number {
  const c = s.players.find((p) => p.id === me)?.campaign;
  if (!c) return 0;
  if (c.kind === "country")
    return to === c.territory ? 1 : s.board.territories[to].neighbours.includes(c.territory) ? 0.3 : 0;
  if (c.kind === "continent") return s.board.territories[to].continent === c.continent ? 1 : 0;
  return s.territories[to].owner === c.target ? 1 : 0; // assassination
}

/** Move the biggest trapped interior stack to its most-threatened reachable border.
 * `forceAnywhere` (or an active Troop Transport) lifts the connectivity requirement. */
export function chooseFortify(s: GameState, me: PlayerId, forceAnywhere = false): Action | null {
  const owned = territoriesOf(s, me);
  const anywhere = forceAnywhere || s.fortifyAnywhere;
  const interiors = owned
    .filter((t) => s.territories[t].armies >= 2 && !isBorder(s, me, t))
    .sort((a, b) => s.territories[b].armies - s.territories[a].armies);
  for (const from of interiors) {
    const targets = owned
      .filter((t) => t !== from && isBorder(s, me, t) && (anywhere || pathThroughOwned(s, me, from, t)))
      .sort((a, b) => enemyArmyPressure(s, me, b) - enemyArmyPressure(s, me, a));
    if (targets.length > 0)
      return { type: "fortify", from, to: targets[0], count: s.territories[from].armies - 1 };
  }
  return null;
}

/** Pick the weakest, most-pressured border to bluff as strong with Misinformation. */
export function chooseMisinformation(s: GameState, me: PlayerId): { territory: TerritoryId; fake: number } | null {
  const borders = territoriesOf(s, me).filter((t) => isBorder(s, me, t));
  if (borders.length === 0) return null;
  const swing = reinforcementsFor(s, me);
  if (swing <= 0) return null;
  const target = borders.sort(
    (a, b) =>
      s.territories[a].armies - enemyArmyPressure(s, me, a) - (s.territories[b].armies - enemyArmyPressure(s, me, b)),
  )[0];
  return { territory: target, fake: s.territories[target].armies + swing };
}

/** After a conquest, push forward — but keep a garrison if the source still borders enemies. */
export function chooseOccupy(s: GameState, me: PlayerId): Action {
  const { from, to, min, max } = s.pendingOccupation!;
  const sourceStillBorders = enemyNeighbours(s, me, from).some((n) => n !== to);
  const count = sourceStillBorders ? Math.max(min, Math.ceil(max / 2)) : max;
  return { type: "occupy", count: Math.min(max, Math.max(min, count)) };
}
