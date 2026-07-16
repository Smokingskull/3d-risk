import { describe, expect, it } from "vitest";
import { createGame, isLegal, type GameState } from "@risk3d/engine";
import { nextCpuAction } from "./rooms.js";

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
