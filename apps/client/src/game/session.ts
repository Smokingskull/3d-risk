import { applyAction, isLegal, type Action, type GameEvent, type GameState } from "@risk3d/engine";

/**
 * How the authoritative game state advances — so the UI never calls `applyAction`
 * itself. `LocalSession` (single-player / hotseat) owns and mutates the state in the
 * browser; a future `OnlineSession` will send intents to the server and receive
 * authoritative updates over this same seam (see ONLINE_MULTIPLAYER_PLAN.md).
 */
export interface GameSession {
  /** The current authoritative game state. */
  readonly state: GameState;
  /**
   * Enact a human action. `LocalSession` applies it and returns the resulting events
   * (or `null` if illegal). An online session will send it to the server and return
   * `null` — its updates arrive asynchronously (a `subscribe` hook is added when
   * `OnlineSession` lands).
   */
  submit(action: Action): GameEvent[] | null;
  /** Release any resources (sockets, workers). No-op locally. */
  dispose(): void;
}

/** Single-player / hotseat session: the browser holds and advances the state itself. */
export function createLocalSession(initial: GameState): GameSession {
  let state = initial;
  return {
    get state() {
      return state;
    },
    submit(action) {
      if (!isLegal(state, action)) return null;
      const result = applyAction(state, action);
      state = result.state;
      return result.events;
    },
    dispose() {},
  };
}
