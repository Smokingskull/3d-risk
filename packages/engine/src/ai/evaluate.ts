/**
 * Static evaluation of a position from one player's perspective. Higher is better.
 * The leaf heuristic for the Joshua search AI (ai/search.ts): territory count +
 * army mass + owned-continent bonuses + fractional continent progress, minus the
 * strongest opponent's reach.
 */
import { territoriesOf } from "../game.js";
import type { GameState, PlayerId } from "../types.js";

export function evaluate(state: GameState, me: PlayerId): number {
  const mine = territoriesOf(state, me);
  let armies = 0;
  for (const id of mine) armies += state.territories[id].armies;

  let fullContinentBonus = 0;
  let progress = 0;
  for (const cont of Object.values(state.board.continents)) {
    const owned = cont.territories.filter((t) => state.territories[t].owner === me).length;
    const frac = owned / cont.territories.length;
    if (owned === cont.territories.length) fullContinentBonus += cont.bonus;
    progress += frac * cont.bonus;
  }

  let strongestOpponent = 0;
  for (const p of state.players)
    if (!p.eliminated && p.id !== me)
      strongestOpponent = Math.max(strongestOpponent, territoriesOf(state, p.id).length);

  return mine.length + 0.25 * armies + 3 * fullContinentBonus + 0.6 * progress - 0.4 * strongestOpponent;
}
