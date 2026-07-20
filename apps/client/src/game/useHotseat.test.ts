import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useHotseat, type SeatSpec } from "./useHotseat.js";

const HUMANS: SeatSpec[] = [{ kind: "human" }, { kind: "human" }];
const NAMES = ["Ann", "Bo"];

/** A p1 territory that borders an enemy — a valid attack source once reinforced. */
function findP1Border(game: NonNullable<ReturnType<typeof useHotseat>["game"]>) {
  for (const id of Object.keys(game.territories)) {
    if (game.territories[id].owner !== "p1") continue;
    const enemy = game.board.territories[id].neighbours.find(
      (n) => game.territories[n].owner && game.territories[n].owner !== "p1",
    );
    if (enemy) return { from: id, to: enemy };
  }
  throw new Error("no p1 border found");
}

describe("useHotseat — local game flow", () => {
  it("starts a classic game with p1 to reinforce", () => {
    const { result } = renderHook(() => useHotseat());
    act(() => result.current.start("classic", HUMANS, NAMES, false, false));
    const g = result.current.game!;
    expect(g).toBeTruthy();
    expect(g.activePlayer).toBe("p1");
    expect(g.phase).toBe("reinforce");
    expect(result.current.isHumanTurn).toBe(true);
    expect(result.current.viewerId).toBe("p1");
  });

  it("advances a turn: reinforce → attack → fortify → next player", () => {
    const { result } = renderHook(() => useHotseat());
    act(() => result.current.start("classic", HUMANS, NAMES, false, false));
    const g0 = result.current.game!;
    const owned = Object.keys(g0.territories).find((t) => g0.territories[t].owner === "p1")!;

    act(() => result.current.deploy(owned, g0.reinforcementsRemaining));
    expect(result.current.game!.phase).toBe("attack");

    act(() => result.current.endAttack());
    expect(result.current.game!.phase).toBe("fortify");

    act(() => result.current.endTurn());
    expect(result.current.game!.activePlayer).toBe("p2");
    expect(result.current.game!.turn).toBe(2);
  });

  it("rollOnce fires an attack and surfaces combat feedback (the applyUpdate reaction path)", () => {
    const { result } = renderHook(() => useHotseat());
    act(() => result.current.start("classic", HUMANS, NAMES, false, false));

    const { from, to } = findP1Border(result.current.game!);
    // Pour reinforcements onto the border so it can attack.
    act(() => result.current.deploy(from, result.current.game!.reinforcementsRemaining));
    act(() => result.current.chooseSource(from));
    act(() => result.current.attackTarget(to));
    expect(result.current.engagement).toMatchObject({ from, to, role: "attacker" });

    const seq0 = result.current.combatSeq;
    act(() => result.current.rollOnce());
    expect(result.current.lastCombat).toBeTruthy();
    expect(result.current.lastCombat!.from).toBe(from);
    expect(result.current.combatSeq).toBe(seq0 + 1);
  });
});

describe("useHotseat — CPU loop (headless, sync-worker fallback)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("drives the CPU opponent's turn after the human ends theirs", async () => {
    const seats: SeatSpec[] = [{ kind: "human" }, { kind: "cpu", difficulty: "easy" }];
    const { result } = renderHook(() => useHotseat());
    act(() => result.current.start("classic", seats, ["You", "CPU"], false, false));

    // Play p1's (human) turn to its end.
    const g0 = result.current.game!;
    const owned = Object.keys(g0.territories).find((t) => g0.territories[t].owner === "p1")!;
    act(() => result.current.deploy(owned, g0.reinforcementsRemaining));
    act(() => result.current.endAttack());
    act(() => result.current.endTurn());
    expect(result.current.game!.activePlayer).toBe("p2");

    // Let the CPU step-loop run (decideAi resolves via the sync fallback; sleeps are timers).
    await act(async () => {
      for (let i = 0; i < 300; i++) {
        const g = result.current.game!;
        if (g.winner || g.activePlayer === "p1") break;
        await vi.advanceTimersByTimeAsync(400);
      }
    });

    const g = result.current.game!;
    // The CPU either finished its turn (control back to p1) or won outright.
    expect(g.winner === "p2" || g.activePlayer === "p1").toBe(true);
  });
});
