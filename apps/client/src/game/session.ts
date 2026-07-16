import { applyAction, isLegal, type Action, type GameEvent, type GameState } from "@risk3d/engine";
import type { Connection } from "../net/connection.js";

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

/** Online session: the server is authoritative. `submit` sends an intent (returns
 *  null — the authoritative result arrives asynchronously); state advances are
 *  pushed by the server and delivered via `onUpdate`. */
export interface OnlineSession extends GameSession {
  onUpdate?: (state: GameState, events: GameEvent[]) => void;
}
export function createOnlineSession(conn: Connection): OnlineSession {
  let state: GameState | null = null;
  const session: OnlineSession = {
    get state() {
      return state as GameState; // only read on the local path; online reads via onUpdate
    },
    submit(action) {
      conn.intent(action);
      return null;
    },
    dispose() {
      unsub();
    },
  };
  const unsub = conn.on((msg) => {
    if (msg.type === "update" || msg.type === "over") {
      state = msg.state;
      session.onUpdate?.(msg.state, msg.type === "update" ? msg.events : []);
    }
  });
  return session;
}
