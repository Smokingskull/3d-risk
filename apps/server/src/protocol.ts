/**
 * Wire protocol for the multiplayer server (rooms/lobby + hosting slice).
 * All messages are JSON. The client sends *intents*; the server is authoritative
 * and replies with lobby state and per-viewer game views (fog applied).
 */
import type { Action, Difficulty, GameEvent, GameState } from "@risk3d/engine";

/** A seat's public lobby info. A "human" seat with no `connected` is an open slot. */
export interface SeatInfo {
  id: string; // engine player id, e.g. "p1"
  name: string;
  kind: "human" | "cpu";
  difficulty?: Difficulty;
  connected: boolean; // a human is currently occupying it
}

export interface LobbyInfo {
  code: string;
  owner: string; // seat id of the room owner
  phase: "lobby" | "playing" | "over";
  seats: SeatInfo[];
}

// --- client → server --------------------------------------------------------
export type ClientMsg =
  | { type: "create"; name: string; players: number; campaign?: boolean; actionCards?: boolean }
  | { type: "join"; name: string; code: string }
  /** Rejoin a seat you dropped from, using the token from your `joined` message. */
  | { type: "reconnect"; token: string }
  /** Owner-only, in lobby: set a seat to a CPU of `difficulty`, or open it for a
   *  human (`kind: "human"` with no difficulty). Can't touch a seat a different
   *  human currently holds. */
  | { type: "setSeat"; seat: string; kind: "human" | "cpu"; difficulty?: Difficulty }
  | { type: "start" } // owner-only
  | { type: "intent"; action: Action }
  | { type: "chat"; text: string }
  /** Owner's decision after a dropped player's reconnect window expires. */
  | { type: "resolveDrop"; seat: string; choice: "end" | "replace" }
  /** Dev/test only (ignored unless NODE_ENV !== "production"): end the current game
   *  immediately with the requester as winner, to exercise the reveal/ranking flow. */
  | { type: "devForceEnd" };

// --- server → client --------------------------------------------------------
export type ServerMsg =
  | { type: "joined"; code: string; you: string; token: string } // token = reconnect key
  | { type: "lobby"; room: LobbyInfo }
  | { type: "update"; you: string; state: GameState; events: GameEvent[] } // fog-projected view
  | { type: "over"; you: string; state: GameState; winner: string; ranking: string[] } // finished; state is unfogged (all cards/objectives revealed), ranking is seat ids best→worst
  | { type: "chat"; from: string; seat: string; text: string } // seat = speaker's seat id (for colour)
  /** A player dropped; the game is paused for `seconds` awaiting their reconnect. */
  | { type: "paused"; seat: string; name: string; seconds: number }
  | { type: "resumed" }
  /** Reconnect window expired — the owner must choose end vs replace-with-Joshua. */
  | { type: "dropChoice"; seat: string; name: string }
  | { type: "ended"; reason: string }
  | { type: "error"; reason: string };
