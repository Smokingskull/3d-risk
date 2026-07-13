import { describe, expect, it } from "vitest";
import { conquestProbability } from "./battleOdds.js";
import { createAI, planTurn, type Difficulty } from "./policy.js";
import { applyAction, createGame, isLegal } from "../game.js";
import type { BoardMode } from "../types.js";

describe("conquestProbability", () => {
  it("is a probability", () => {
    for (const [a, d] of [[2, 1], [5, 3], [10, 10], [3, 8]]) {
      const p = conquestProbability(a, d);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("favours the larger attacker and rises with more attackers", () => {
    expect(conquestProbability(10, 1)).toBeGreaterThan(0.9);
    expect(conquestProbability(2, 10)).toBeLessThan(0.1);
    expect(conquestProbability(8, 5)).toBeGreaterThan(conquestProbability(4, 5));
  });

  it("cannot attack without a spare army", () => {
    expect(conquestProbability(1, 1)).toBe(0);
  });
});

function cpuPlayers(specs: Difficulty[]) {
  return specs.map((difficulty, i) => ({
    id: `p${i + 1}`,
    name: `CPU ${i + 1}`,
    color: "#888888",
    kind: "cpu" as const,
    difficulty,
  }));
}

describe("policy legality", () => {
  it("only ever proposes legal actions across a full turn", () => {
    const s = createGame({ players: cpuPlayers(["medium", "medium"]), boardMode: "classic", seed: 11 });
    const ai = createAI("medium");
    let cur = s;
    for (let i = 0; i < 200 && cur.activePlayer === s.activePlayer && !cur.winner; i++) {
      const a = ai.decide(cur);
      expect(isLegal(cur, a)).toBe(true);
      cur = applyAction(cur, a).state;
    }
  });
});

describe("full CPU games terminate with a winner", () => {
  const play = (mode: BoardMode, specs: Difficulty[], seed: number) => {
    let s = createGame({ players: cpuPlayers(specs), boardMode: mode, seed });
    let guard = 0;
    while (!s.winner && guard++ < 6000) {
      for (const a of planTurn(s)) {
        expect(isLegal(s, a)).toBe(true);
        s = applyAction(s, a).state;
        if (s.winner) break;
      }
    }
    return s;
  };

  it("classic, hard vs hard", () => {
    const s = play("classic", ["hard", "hard"], 7);
    expect(s.winner).not.toBeNull();
  });

  it("classic, 3-way mixed difficulties", () => {
    const s = play("classic", ["easy", "medium", "hard"], 3);
    expect(s.winner).not.toBeNull();
  });
});

describe("world board CPU play is legal", () => {
  it("plays several legal turns on the world board", () => {
    let s = createGame({ players: cpuPlayers(["hard", "hard", "hard"]), boardMode: "world", seed: 5 });
    for (let turn = 0; turn < 6 && !s.winner; turn++) {
      for (const a of planTurn(s)) {
        expect(isLegal(s, a)).toBe(true);
        s = applyAction(s, a).state;
        if (s.winner) break;
      }
    }
    expect(s.turn).toBeGreaterThan(1);
  });
});
