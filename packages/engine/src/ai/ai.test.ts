import { describe, expect, it } from "vitest";
import { conquestProbability } from "./battleOdds.js";
import { createAI, decideReaction, planTurn, type Difficulty } from "./policy.js";
import { applyAction, createGame, isLegal } from "../game.js";
import type { BoardDefinition, BoardMode, GameState } from "../types.js";

// A 2-territory board A-B for targeted card tests.
function pairBoard(): BoardDefinition {
  return {
    territories: {
      A: { id: "A", continent: "c", neighbours: ["B"] },
      B: { id: "B", continent: "c", neighbours: ["A"] },
    },
    continents: { c: { id: "c", name: "c", bonus: 2, territories: ["A", "B"] } },
  };
}

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

  it("joshua (search AI) only proposes legal actions across a full turn", () => {
    const s = createGame({ players: cpuPlayers(["joshua", "hard"]), boardMode: "classic", seed: 11, actionCardsEnabled: true });
    const ai = createAI("joshua");
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

  it("classic, joshua vs hard terminates", () => {
    const s = play("classic", ["joshua", "hard"], 7);
    expect(s.winner).not.toBeNull();
  });
});

describe("Joshua is stronger than the heuristic tiers", () => {
  // Play a full CPU-vs-CPU game to its winner.
  const winnerOf = (specs: Difficulty[], seed: number): string | null => {
    let s = createGame({ players: cpuPlayers(specs), boardMode: "classic", seed });
    let guard = 0;
    while (!s.winner && guard++ < 6000) {
      for (const a of planTurn(s)) {
        s = applyAction(s, a).state;
        if (s.winner) break;
      }
    }
    return s.winner;
  };

  // Count Joshua's wins vs `opp` across seeds, alternating who moves first (p1/p2)
  // to cancel the first-move advantage.
  const joshuaWins = (opp: Difficulty, seeds: number[]) => {
    let wins = 0;
    for (const seed of seeds) {
      if (winnerOf(["joshua", opp], seed) === "p1") wins++;
      if (winnerOf([opp, "joshua"], seed) === "p2") wins++;
    }
    return { wins, games: seeds.length * 2 };
  };

  it("beats hard in a clear majority of games", () => {
    const { wins, games } = joshuaWins("hard", [1, 2, 3]);
    expect(wins).toBeGreaterThan(games / 2);
  }, 120_000);

  it("dominates easy", () => {
    const { wins, games } = joshuaWins("easy", [4, 5]);
    expect(wins).toBeGreaterThanOrEqual(games - 1);
  }, 120_000);
});

describe("AI action-card strategy", () => {
  const cardGame = (difficulty: Difficulty): GameState => {
    const s = createGame({
      players: cpuPlayers([difficulty, difficulty]),
      board: pairBoard(),
      seed: 2,
      cardsEnabled: false,
      actionCardsEnabled: true,
    });
    for (const p of s.players) p.actionCards = [];
    return s;
  };

  it("softens a well-defended target with an Air Strike before attacking (hard)", () => {
    const s = cardGame("hard");
    s.players.find((p) => p.id === "p1")!.actionCards = ["airStrike"];
    s.territories.A = { owner: "p1", armies: 10 };
    s.territories.B = { owner: "p2", armies: 5 }; // ≥4 → worth a strike
    s.phase = "attack";
    const a = createAI("hard").decide(s);
    expect(a).toMatchObject({ type: "playActionCard", card: "airStrike", from: "A", to: "B" });
  });

  it("easy ignores action cards entirely", () => {
    const s = cardGame("easy");
    s.players.find((p) => p.id === "p1")!.actionCards = ["airStrike"];
    s.territories.A = { owner: "p1", armies: 10 };
    s.territories.B = { owner: "p2", armies: 5 };
    s.phase = "attack";
    expect(createAI("easy").decide(s)).toMatchObject({ type: "attack" });
  });

  it("lays a Minefield (medium+) but not on easy", () => {
    const mk = (difficulty: Difficulty): GameState => {
      const s = cardGame(difficulty);
      s.players.find((p) => p.id === "p2")!.actionCards = ["minefield"];
      s.pendingDecision = { kind: "minefield", player: "p2", territory: "B", from: "A" };
      s.pendingOccupation = { from: "A", to: "B", min: 1, max: 5 };
      return s;
    };
    expect(decideReaction(mk("medium"))).toMatchObject({ type: "resolveDecision", play: true });
    expect(decideReaction(mk("hard"))).toMatchObject({ type: "resolveDecision", play: true });
    expect(decideReaction(mk("easy"))).toMatchObject({ type: "resolveDecision", play: false });
  });

  it("hard retreats a losing battle it can preserve", () => {
    const s = cardGame("hard");
    s.players.find((p) => p.id === "p2")!.actionCards = ["tacticalRetreat"];
    // B (2) is under attack from A (8); B has no owned neighbour on this board, so
    // add one via a 3-territory setup would be needed — use a ring instead.
    s.board = {
      territories: {
        A: { id: "A", continent: "c", neighbours: ["B"] },
        B: { id: "B", continent: "c", neighbours: ["A", "C"] },
        C: { id: "C", continent: "c", neighbours: ["B"] },
      },
      continents: { c: { id: "c", name: "c", bonus: 2, territories: ["A", "B", "C"] } },
    };
    s.territories = {
      A: { owner: "p1", armies: 8 },
      B: { owner: "p2", armies: 2 },
      C: { owner: "p2", armies: 1 },
    };
    s.pendingDecision = { kind: "tacticalRetreat", player: "p2", territory: "B", from: "A" };
    expect(decideReaction(s)).toMatchObject({ type: "resolveDecision", play: true, to: "C" });
  });
});

describe("full CPU games with action cards terminate with a winner", () => {
  it("classic, hard vs hard, cards enabled", () => {
    let s = createGame({ players: cpuPlayers(["hard", "hard"]), boardMode: "classic", seed: 9, actionCardsEnabled: true });
    let guard = 0;
    while (!s.winner && guard++ < 8000) {
      for (const a of planTurn(s)) {
        expect(isLegal(s, a)).toBe(true);
        s = applyAction(s, a).state;
        if (s.winner) break;
      }
    }
    expect(s.winner).not.toBeNull();
  });
});
