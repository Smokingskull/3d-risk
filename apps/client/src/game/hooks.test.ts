import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createGame, type GameState } from "@risk3d/engine";
import { useGameStore } from "./useGameStore.js";
import { useReinforceMeter } from "./useReinforceMeter.js";
import { useUiPrefs } from "./useUiPrefs.js";

const twoPlayer = (): GameState =>
  createGame({
    players: [
      { id: "p1", name: "Ann", color: "#e6194b", kind: "human" },
      { id: "p2", name: "Bo", color: "#4363d8", kind: "human" },
    ],
    boardMode: "classic",
    seed: 1,
  });

describe("useGameStore", () => {
  it("starts null, then commits reactively and via the stable getter", () => {
    const { result } = renderHook(() => useGameStore());
    expect(result.current.game).toBeNull();
    expect(result.current.getGame()).toBeNull();

    const g = twoPlayer();
    act(() => result.current.commitGame(g));
    expect(result.current.game).toBe(g); // reactive value re-rendered
    expect(result.current.getGame()).toBe(g); // stable getter is current

    act(() => result.current.commitGame(null));
    expect(result.current.game).toBeNull();
  });

  it("keeps getGame/commitGame identities stable across renders", () => {
    const { result, rerender } = renderHook(() => useGameStore());
    const get1 = result.current.getGame;
    const commit1 = result.current.commitGame;
    act(() => result.current.commitGame(twoPlayer()));
    rerender();
    expect(result.current.getGame).toBe(get1);
    expect(result.current.commitGame).toBe(commit1);
  });
});

describe("useReinforceMeter", () => {
  it("tracks the peak reinforcements for the phase (incl. a mid-phase bump)", () => {
    const g = twoPlayer(); // reinforce phase, p1 active
    const base = g.reinforcementsRemaining;
    const { result, rerender } = renderHook(({ game }) => useReinforceMeter(game), { initialProps: { game: g } });
    expect(result.current).toBe(base);

    // A mid-phase trade bonus (same turn/player, higher remaining) raises the peak.
    rerender({ game: { ...g, reinforcementsRemaining: base + 4 } as GameState });
    expect(result.current).toBe(base + 4);

    // Placing armies lowers remaining, but the peak (the meter total) is retained.
    rerender({ game: { ...g, reinforcementsRemaining: 1 } as GameState });
    expect(result.current).toBe(base + 4);
  });
});

describe("useUiPrefs", () => {
  it("toggles autoRotate and mode, and bumps the tour nonce", () => {
    const { result } = renderHook(() => useUiPrefs());
    expect(result.current.autoRotate).toBe(true);
    expect(result.current.mode).toBe("select");

    act(() => result.current.toggleAutoRotate());
    expect(result.current.autoRotate).toBe(false);

    act(() => result.current.toggleMode());
    expect(result.current.mode).toBe("rotate");

    const n = result.current.tourNonce;
    act(() => result.current.startTour());
    expect(result.current.tourNonce).toBe(n + 1);
  });
});
