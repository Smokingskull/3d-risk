/**
 * Client-side mirror of the multiplayer wire protocol (kept in sync with
 * apps/server/src/protocol.ts). Duplicated rather than shared for now; extract to a
 * shared package if it grows. See ONLINE_MULTIPLAYER_PLAN.md.
 */
import type { Action, Difficulty, GameEvent, GameState } from "@risk3d/engine";

export interface SeatInfo {
  id: string;
  name: string;
  kind: "human" | "cpu";
  difficulty?: Difficulty;
  connected: boolean;
}
export interface LobbyInfo {
  code: string;
  owner: string;
  phase: "lobby" | "playing" | "over";
  seats: SeatInfo[];
}

export type ClientMsg =
  | { type: "create"; name: string; players: number; campaign?: boolean; actionCards?: boolean }
  | { type: "join"; name: string; code: string }
  | { type: "reconnect"; token: string }
  | { type: "setSeat"; seat: string; kind: "human" | "cpu"; difficulty?: Difficulty }
  | { type: "start" }
  | { type: "intent"; action: Action }
  | { type: "chat"; text: string }
  | { type: "resolveDrop"; seat: string; choice: "end" | "replace" };

export type ServerMsg =
  | { type: "joined"; code: string; you: string; token: string }
  | { type: "lobby"; room: LobbyInfo }
  | { type: "update"; you: string; state: GameState; events: GameEvent[] }
  | { type: "over"; you: string; state: GameState; winner: string }
  | { type: "chat"; from: string; text: string }
  | { type: "paused"; seat: string; name: string; seconds: number }
  | { type: "resumed" }
  | { type: "dropChoice"; seat: string; name: string }
  | { type: "ended"; reason: string }
  | { type: "error"; reason: string };
