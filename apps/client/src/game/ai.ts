import { createAI, decideReaction, type Action, type Difficulty, type GameState } from "@risk3d/engine";

/**
 * The next action for whichever CPU must act — the player owing a pending decision
 * (a defender reaction), else the active CPU. Returns null when a human must act
 * (their turn, or their decision window). Deterministic and cheap; shared by the AI
 * web worker (`ai.worker.ts`) and the main-thread fallback in `useAiWorker`.
 */
export function nextAiAction(state: GameState): Action | null {
  if (state.winner) return null;
  if (state.pendingDecision) {
    const decider = state.players.find((p) => p.id === state.pendingDecision!.player);
    return decider?.kind === "cpu" ? decideReaction(state) : null;
  }
  const active = state.players.find((p) => p.id === state.activePlayer);
  if (active?.kind !== "cpu") return null;
  return createAI((active.difficulty as Difficulty) ?? "medium").decide(state);
}
