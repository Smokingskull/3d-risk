import { describe, expect, it } from "vitest";
import { createGame, isLegal, type GameState } from "@risk3d/engine";
import { computeRanking, nextCpuAction } from "./rooms.js";

/** A CPU-vs-human classic game with the CPU to move first. */
function cpuFirstGame(): GameState {
  return createGame({
    players: [
      { id: "p1", name: "CPU", color: "#e6194b", kind: "cpu", difficulty: "medium" },
      { id: "p2", name: "You", color: "#4363d8", kind: "human" },
    ],
    boardMode: "classic",
    seed: 3,
  });
}
const SEATS = [
  { id: "p1", kind: "cpu" as const, difficulty: "medium" as const },
  { id: "p2", kind: "human" as const },
];

describe("nextCpuAction (server drive logic)", () => {
  it("returns a legal action when a CPU is the active player", () => {
    const s = cpuFirstGame();
    const a = nextCpuAction(s, SEATS);
    expect(a).not.toBeNull();
    expect(isLegal(s, a!)).toBe(true);
  });

  it("waits (null) when a human is the active player", () => {
    const s = { ...cpuFirstGame(), activePlayer: "p2" } as GameState;
    expect(nextCpuAction(s, SEATS)).toBeNull();
  });

  it("waits (null) on a human's defender reaction window", () => {
    const s = {
      ...cpuFirstGame(),
      pendingDecision: { kind: "minefield", player: "p2", territory: "Brazil", from: "Peru" },
    } as GameState;
    expect(nextCpuAction(s, SEATS)).toBeNull();
  });

  it("never acts once the game is won", () => {
    const s = { ...cpuFirstGame(), winner: "p1" } as GameState;
    expect(nextCpuAction(s, SEATS)).toBeNull();
  });
});

describe("computeRanking (final placement)", () => {
  const state = (winner: string | null, players: { id: string; eliminated?: boolean }[], owners: Record<string, string> = {}) =>
    ({
      winner,
      players: players.map((p) => ({ id: p.id, eliminated: !!p.eliminated })),
      territories: Object.fromEntries(Object.entries(owners).map(([t, owner]) => [t, { owner, armies: 1 }])),
    }) as unknown as GameState;

  it("normal game: winner first, then reverse order of elimination", () => {
    // p3 knocked out first, then p2; p1 wins.
    const s = state("p1", [{ id: "p1" }, { id: "p2", eliminated: true }, { id: "p3", eliminated: true }]);
    expect(computeRanking(s, ["p3", "p2"])).toEqual(["p1", "p2", "p3"]);
  });

  it("campaign win with survivors: winner, then living players by territory count, then eliminated", () => {
    const s = state(
      "p1",
      [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4", eliminated: true }],
      { A: "p3", B: "p3", C: "p3", D: "p2", E: "p2" }, // p3 holds 3, p2 holds 2
    );
    expect(computeRanking(s, ["p4"])).toEqual(["p1", "p3", "p2", "p4"]);
  });
});
