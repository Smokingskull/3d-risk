/**
 * AI web worker. Computes one CPU action for a given game state off the main
 * thread so the globe stays responsive while the search-based "Joshua" tier
 * thinks. The actor dispatch is the shared `nextAiAction` (see ./ai.ts), so the
 * worker and the main-thread fallback can never diverge. The engine is
 * pure/deterministic, so the returned action replays identically on the main thread.
 */
import type { Action, GameState } from "@risk3d/engine";
import { nextAiAction } from "./ai.js";

// `self` is typed as Window under the DOM lib; cast to the minimal worker surface.
const ctx = self as unknown as {
  postMessage(msg: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

ctx.onmessage = (e: MessageEvent<{ reqId: number; state: GameState }>) => {
  const { reqId, state } = e.data;
  let action: Action | null = null;
  try {
    action = nextAiAction(state);
  } catch {
    action = null; // main thread falls back to a synchronous decide on null-with-error
  }
  ctx.postMessage({ reqId, action });
};
