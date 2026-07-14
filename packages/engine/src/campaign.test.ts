import { describe, expect, it } from "vitest";
import { applyAction, createGame, type GameConfig } from "./game.js";
import type { BoardDefinition, GameState } from "./types.js";

// 4-territory ring A-B-C-D-A, one continent "c" (bonus 5).
function ringBoard(): BoardDefinition {
  const adj: Record<string, string[]> = { A: ["B", "D"], B: ["A", "C"], C: ["B", "D"], D: ["C", "A"] };
  const territories = Object.fromEntries(
    Object.entries(adj).map(([id, neighbours]) => [id, { id, continent: "c", neighbours }]),
  );
  return { territories, continents: { c: { id: "c", name: "Continent", bonus: 5, territories: ["A", "B", "C", "D"] } } };
}

const P1 = { id: "p1", name: "One", color: "#f00", kind: "human" as const };
const P2 = { id: "p2", name: "Two", color: "#00f", kind: "human" as const };
const P3 = { id: "p3", name: "Three", color: "#0f0", kind: "human" as const };

function game(players: GameConfig["players"], extra?: Partial<GameConfig>): GameState {
  return createGame({ players, board: ringBoard(), seed: 1, cardsEnabled: false, ...extra });
}
function setBoard(s: GameState, owners: Record<string, [string, number]>): void {
  for (const [id, [owner, armies]] of Object.entries(owners)) s.territories[id] = { owner, armies };
}

describe("campaign assignment", () => {
  it("gives every player an objective; country target isn't self-owned, assassination isn't self", () => {
    const s = createGame({ players: [P1, P2, P3], board: ringBoard(), seed: 7, cardsEnabled: false, campaign: true });
    expect(s.options.campaign).toBe(true);
    for (const p of s.players) {
      expect(p.campaign).toBeDefined();
      if (p.campaign!.kind === "country") expect(s.territories[p.campaign!.territory].owner).not.toBe(p.id);
      if (p.campaign!.kind === "assassination") expect(p.campaign!.target).not.toBe(p.id);
    }
  });

  it("is off by default (no campaigns assigned)", () => {
    const s = game([P1, P2]);
    expect(s.options.campaign).toBe(false);
    expect(s.players.every((p) => p.campaign === undefined)).toBe(true);
  });
});

describe("campaign win conditions", () => {
  it("continent: wins by holding the whole target continent at end of turn", () => {
    const s = game([P1, P2]);
    setBoard(s, { A: ["p1", 2], B: ["p1", 1], C: ["p1", 1], D: ["p1", 1] });
    s.players[0].campaign = { kind: "continent", continent: "c" };
    s.phase = "fortify";
    s.activePlayer = "p1";
    const r = applyAction(s, { type: "endTurn" });
    expect(r.state.winner).toBe("p1");
    expect(r.events.some((e) => e.type === "gameWon" && e.reason === "campaign")).toBe(true);
  });

  it("country: wins after holding the target territory for 3 of the player's turn-ends", () => {
    const s = game([P1, P2]);
    setBoard(s, { A: ["p1", 3], B: ["p1", 3], C: ["p2", 3], D: ["p2", 3] });
    s.players[0].campaign = { kind: "country", territory: "A", heldTurns: 0 };
    s.phase = "fortify";
    s.activePlayer = "p1";
    let cur: GameState = s;
    for (let i = 0; i < 6 && !cur.winner; i++) {
      cur = applyAction({ ...cur, phase: "fortify" }, { type: "endTurn" }).state;
    }
    expect(cur.winner).toBe("p1");
  });

  it("assassination: wins when the target is eliminated by anyone (3-player)", () => {
    const s = game([P1, P2, P3]);
    setBoard(s, { A: ["p1", 20], B: ["p1", 1], C: ["p3", 3], D: ["p2", 1] });
    s.players[0].campaign = { kind: "assassination", target: "p2" };
    s.phase = "attack";
    s.activePlayer = "p1";
    s.pendingOccupation = null;
    let cur: GameState = s;
    for (let i = 0; i < 40 && !cur.winner; i++) {
      if (cur.pendingOccupation) {
        cur = applyAction(cur, { type: "occupy", count: cur.pendingOccupation.min }).state;
        continue;
      }
      cur = applyAction(cur, {
        type: "attack",
        from: "A",
        to: "D",
        dice: Math.min(3, cur.territories["A"].armies - 1),
      }).state;
    }
    expect(cur.players.find((p) => p.id === "p2")!.eliminated).toBe(true);
    expect(cur.winner).toBe("p1");
  });
});
