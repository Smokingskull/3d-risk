import { describe, expect, it } from "vitest";
import { buildDeck, isValidSet, maxDisjointSets, setBonus, validSetsInHand, WILDS_BY_MODE } from "./cards.js";
import type { BoardDefinition, Card } from "./types.js";

const board: BoardDefinition = {
  territories: {
    A: { id: "A", continent: "c", neighbours: ["B"] },
    B: { id: "B", continent: "c", neighbours: ["A"] },
    C: { id: "C", continent: "c", neighbours: [] },
  },
  continents: { c: { id: "c", name: "C", bonus: 1, territories: ["A", "B", "C"] } },
};

const card = (symbol: Card["symbol"], id: string = symbol): Card => ({ id, symbol, territory: null });

describe("buildDeck", () => {
  it("has one card per territory plus two wilds by default", () => {
    const deck = buildDeck(board);
    expect(deck).toHaveLength(3 + 2);
    expect(deck.filter((c) => c.symbol === "wild")).toHaveLength(2);
    expect(deck.filter((c) => c.territory !== null).map((c) => c.territory).sort()).toEqual(["A", "B", "C"]);
  });
  it("adds the requested number of wilds (modern boards use 4)", () => {
    expect(buildDeck(board, 4).filter((c) => c.symbol === "wild")).toHaveLength(4);
    expect(buildDeck(board, 4).filter((c) => c.symbol === "wild").map((c) => c.id).sort()).toEqual([
      "wild:0",
      "wild:1",
      "wild:2",
      "wild:3",
    ]);
    expect(WILDS_BY_MODE).toEqual({ classic: 2, world: 4 });
  });
});

describe("maxDisjointSets", () => {
  const c = (symbol: Card["symbol"], id: string): Card => ({ id, symbol, territory: null });
  it("is 0 with fewer than three cards", () => {
    expect(maxDisjointSets([c("infantry", "1"), c("cavalry", "2")])).toBe(0);
  });
  it("counts a four-card hand's single set as 1, not the overlapping combinations", () => {
    const hand = [c("infantry", "i1"), c("cavalry", "c1"), c("artillery", "a1"), c("infantry", "i2")];
    expect(validSetsInHand(hand).length).toBeGreaterThan(1); // overlapping combos
    expect(maxDisjointSets(hand)).toBe(1); // but only one can actually be cashed
  });
  it("finds two disjoint sets in six one-of-each cards", () => {
    const hand = [
      c("infantry", "i1"), c("cavalry", "c1"), c("artillery", "a1"),
      c("infantry", "i2"), c("cavalry", "c2"), c("artillery", "a2"),
    ];
    expect(maxDisjointSets(hand)).toBe(2);
  });
});

describe("isValidSet", () => {
  it("accepts three of a kind", () => {
    expect(isValidSet([card("infantry", "1"), card("infantry", "2"), card("infantry", "3")])).toBe(true);
  });
  it("accepts one of each", () => {
    expect(isValidSet([card("infantry"), card("cavalry"), card("artillery")])).toBe(true);
  });
  it("accepts any set containing a wild", () => {
    expect(isValidSet([card("infantry", "1"), card("infantry", "2"), card("wild")])).toBe(true);
  });
  it("rejects two-of-a-kind with an odd one out", () => {
    expect(isValidSet([card("infantry", "1"), card("infantry", "2"), card("cavalry")])).toBe(false);
  });
  it("rejects the wrong number of cards", () => {
    expect(isValidSet([card("infantry")])).toBe(false);
  });
});

describe("setBonus", () => {
  it("follows the escalating schedule", () => {
    expect([0, 1, 2, 3, 4, 5].map(setBonus)).toEqual([4, 6, 8, 10, 12, 15]);
    expect(setBonus(6)).toBe(20);
    expect(setBonus(7)).toBe(25);
  });
});

describe("validSetsInHand", () => {
  it("finds tradeable triples", () => {
    const hand = [card("infantry", "i1"), card("infantry", "i2"), card("infantry", "i3"), card("cavalry", "c1")];
    const sets = validSetsInHand(hand);
    expect(sets).toContainEqual(["i1", "i2", "i3"]);
  });
});
