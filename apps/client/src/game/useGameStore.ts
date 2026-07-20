import { useCallback, useRef, useSyncExternalStore } from "react";
import type { GameState } from "@risk3d/engine";

/**
 * A tiny hook-local external store for the authoritative `GameState | null`.
 *
 * `game` is reactive (components re-render when it's committed), while `getGame()` is a
 * stable getter that always returns the latest committed state — so synchronous callers
 * (the CPU step-loop, the auto-attack recursion) read fresh state without a `gameRef`
 * shadow. `commitGame` sets the state synchronously and then notifies, so a read right
 * after a commit already sees the new value. The engine returns a fresh state object per
 * action, so `getSnapshot`'s reference only changes on a real update — no tearing, no loop.
 */
export function useGameStore(): {
  game: GameState | null;
  getGame: () => GameState | null;
  commitGame: (next: GameState | null) => void;
} {
  const storeRef = useRef<{ state: GameState | null; listeners: Set<() => void> }>(null as never);
  if (storeRef.current === null) storeRef.current = { state: null, listeners: new Set() };
  const store = storeRef.current;

  const subscribe = useCallback(
    (cb: () => void) => {
      store.listeners.add(cb);
      return () => store.listeners.delete(cb);
    },
    [store],
  );
  const getSnapshot = useCallback(() => store.state, [store]);
  const game = useSyncExternalStore(subscribe, getSnapshot);

  const getGame = useCallback(() => store.state, [store]);
  const commitGame = useCallback(
    (next: GameState | null) => {
      store.state = next;
      store.listeners.forEach((l) => l());
    },
    [store],
  );

  return { game, getGame, commitGame };
}
