/**
 * RISK card deck and set-trading rules.
 *
 * The deck has one card per territory (symbols cycling infantry/cavalry/artillery)
 * plus a board-dependent number of wilds (classic 2, modern/world 4). A set is
 * three cards that are all the same symbol, all three different troop symbols, or
 * any combination including a wild. Trading a set yields an escalating army bonus.
 */
import type { BoardDefinition, BoardMode, Card, CardSymbol } from "./types.js";

const TROOP_SYMBOLS: CardSymbol[] = ["infantry", "cavalry", "artillery"];

/** How many wild cards each board's deck carries. */
export const WILDS_BY_MODE: Record<BoardMode, number> = { classic: 2, world: 4 };

/** Builds the (unshuffled) deck for a board: one card per territory + `wilds` wilds. */
export function buildDeck(board: BoardDefinition, wilds = 2): Card[] {
  const ids = Object.keys(board.territories).sort();
  const cards: Card[] = ids.map((territory, i) => ({
    id: `card:${territory}`,
    territory,
    symbol: TROOP_SYMBOLS[i % 3],
  }));
  for (let i = 0; i < wilds; i++) cards.push({ id: `wild:${i}`, territory: null, symbol: "wild" });
  return cards;
}

/** True if exactly three cards form a tradeable set. */
export function isValidSet(cards: Card[]): boolean {
  if (cards.length !== 3) return false;
  const wilds = cards.filter((c) => c.symbol === "wild").length;
  if (wilds > 0) return true; // a wild completes any set
  const symbols = new Set(cards.map((c) => c.symbol));
  return symbols.size === 1 || symbols.size === 3;
}

/**
 * Army bonus for trading in a set, by how many sets have already been traded in
 * the whole game (classic escalating schedule 4, 6, 8, 10, 12, 15, then +5).
 */
export function setBonus(setsAlreadyTraded: number): number {
  const schedule = [4, 6, 8, 10, 12, 15];
  if (setsAlreadyTraded < schedule.length) return schedule[setsAlreadyTraded];
  return 15 + 5 * (setsAlreadyTraded - (schedule.length - 1));
}

/** Enumerate every valid 3-card set (as id triples) available in a hand. */
export function validSetsInHand(hand: Card[]): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++)
      for (let k = j + 1; k < hand.length; k++) {
        if (isValidSet([hand[i], hand[j], hand[k]]))
          out.push([hand[i].id, hand[j].id, hand[k].id]);
      }
  return out;
}

/**
 * The greatest number of sets that can be cashed from a hand at once, i.e. the
 * most pairwise-disjoint valid triples. Unlike `validSetsInHand().length` (which
 * counts overlapping combinations), this reflects how many trades the hand can
 * actually yield: 4–5 cards can never make more than one. Hands are tiny, so an
 * exhaustive branch-and-recurse is fine.
 */
export function maxDisjointSets(hand: Card[]): number {
  if (hand.length < 3) return 0;
  let max = 0;
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++)
      for (let k = j + 1; k < hand.length; k++)
        if (isValidSet([hand[i], hand[j], hand[k]])) {
          const rest = hand.filter((_, idx) => idx !== i && idx !== j && idx !== k);
          max = Math.max(max, 1 + maxDisjointSets(rest));
        }
  return max;
}
