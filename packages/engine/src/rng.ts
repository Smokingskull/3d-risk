/**
 * Deterministic, seedable RNG. Dice rolls must be reproducible so that the
 * authoritative server, replays, and verification all agree. Never use
 * Math.random() in the engine.
 *
 * Two flavours:
 *  - `mulberry32` gives a stateful generator, used for one-shot setup (shuffling).
 *  - `randAt(seed, cursor)` is a stateless hash — the same (seed, cursor) always
 *    yields the same value. The game state carries `rngSeed` + `rngCursor`, and
 *    every dice roll reads `randAt(seed, cursor)` then advances the cursor, so the
 *    reducer stays a pure function of (state, action).
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless splitmix32-style hash → float in [0, 1) for a given (seed, cursor). */
export function randAt(seed: number, cursor: number): number {
  let z = (seed + Math.imul(cursor, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  z = (z ^ (z >>> 15)) >>> 0;
  return z / 4294967296;
}

/** Roll a single d6 (1..6) deterministically from (seed, cursor). */
export function rollDieAt(seed: number, cursor: number): number {
  return 1 + Math.floor(randAt(seed, cursor) * 6);
}

/** In-place Fisher–Yates shuffle using a stateful generator. Returns the array. */
export function shuffle<T>(arr: T[], next: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
