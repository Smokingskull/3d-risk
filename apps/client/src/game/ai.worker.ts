/**
 * AI web worker. Computes one CPU action for a given game state off the main
 * thread so the globe stays responsive while the search-based "Joshua" tier
 * thinks. Mirrors the (tiny) actor dispatch in useHotseat's nextAiAction: resolve
 * a pending defender reaction, else decide for the active CPU; null when a human
 * must act. The engine is pure/deterministic, so the returned action replays
 * identically on the main thread.
 */
import {
  createAI,
  decideReaction,
  type Action,
  type Difficulty,
  type GameState,
} from "@risk3d/engine";

function decide(state: GameState): Action | null {
  if (state.winner) return null;
  if (state.pendingDecision) {
    const decider = state.players.find((p) => p.id === state.pendingDecision!.player);
    return decider?.kind === "cpu" ? decideReaction(state) : null;
  }
  const active = state.players.find((p) => p.id === state.activePlayer);
  if (active?.kind !== "cpu") return null;
  return createAI((active.difficulty as Difficulty) ?? "medium").decide(state);
}

// `self` is typed as Window under the DOM lib; cast to the minimal worker surface.
const ctx = self as unknown as {
  postMessage(msg: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

ctx.onmessage = (e: MessageEvent<{ reqId: number; state: GameState }>) => {
  const { reqId, state } = e.data;
  let action: Action | null = null;
  try {
    action = decide(state);
  } catch {
    action = null; // main thread falls back to a synchronous decide on null-with-error
  }
  ctx.postMessage({ reqId, action });
};
