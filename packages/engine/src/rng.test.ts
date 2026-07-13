import { describe, expect, it } from "vitest";
import { mulberry32, randAt, rollDieAt, shuffle } from "./rng.js";

describe("randAt", () => {
  it("is deterministic for the same (seed, cursor)", () => {
    expect(randAt(42, 7)).toBe(randAt(42, 7));
  });

  it("returns values in [0, 1)", () => {
    for (let c = 0; c < 1000; c++) {
      const v = randAt(123, c);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("varies across cursors (not a constant)", () => {
    const values = new Set(Array.from({ length: 100 }, (_, c) => randAt(1, c)));
    expect(values.size).toBeGreaterThan(90);
  });
});

describe("rollDieAt", () => {
  it("always yields 1..6", () => {
    for (let c = 0; c < 5000; c++) {
      const d = rollDieAt(9, c);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
    }
  });

  it("covers all six faces", () => {
    const faces = new Set(Array.from({ length: 600 }, (_, c) => rollDieAt(5, c)));
    expect(faces).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });
});

describe("shuffle", () => {
  it("is deterministic for a given seed and preserves elements", () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(3));
    const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(3));
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
