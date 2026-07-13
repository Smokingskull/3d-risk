/**
 * Runs CPU turn planning off the main thread. Receives a game state, returns the
 * whole turn as a list of actions (the engine is deterministic, so the main
 * thread replays them identically).
 */
import { planTurn, type GameState } from "@risk3d/engine";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};

ctx.onmessage = (e: MessageEvent) => {
  const { id, state } = e.data as { id: number; state: GameState };
  ctx.postMessage({ id, actions: planTurn(state) });
};
