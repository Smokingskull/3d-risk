/**
 * Thin WebSocket client for the multiplayer server. Wraps the protocol as
 * typed send helpers + a subscribe API for incoming server messages. UI (the
 * lobby) and the game session both consume one connection.
 */
import type { Action, Difficulty } from "@risk3d/engine";
import type { ClientMsg, ServerMsg } from "./protocol.js";

export interface Connection {
  /** Subscribe to server messages. Returns an unsubscribe fn. */
  on(listener: (msg: ServerMsg) => void): () => void;
  create(name: string, players: number, campaign: boolean, actionCards: boolean): void;
  join(code: string, name: string): void;
  reconnect(token: string): void;
  setSeat(seat: string, kind: "human" | "cpu", difficulty?: Difficulty): void;
  start(): void;
  intent(action: Action): void;
  chat(text: string): void;
  resolveDrop(seat: string, choice: "end" | "replace"): void;
  close(): void;
}

/** The multiplayer server URL for this environment (Vite env, else localhost dev). */
export function serverUrl(): string {
  const configured = import.meta.env.VITE_MP_SERVER as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.hostname}:8787`; // local dev default
}

export function connect(url = serverUrl()): Connection {
  const ws = new WebSocket(url);
  const listeners = new Set<(msg: ServerMsg) => void>();
  const outbox: string[] = [];

  ws.onmessage = (e) => {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const l of listeners) l(msg);
  };
  ws.onopen = () => {
    for (const m of outbox.splice(0)) ws.send(m);
  };

  const send = (m: ClientMsg) => {
    const s = JSON.stringify(m);
    if (ws.readyState === WebSocket.OPEN) ws.send(s);
    else outbox.push(s); // queued until the socket opens
  };

  return {
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    create: (name, players, campaign, actionCards) => send({ type: "create", name, players, campaign, actionCards }),
    join: (code, name) => send({ type: "join", code, name }),
    reconnect: (token) => send({ type: "reconnect", token }),
    setSeat: (seat, kind, difficulty) => send({ type: "setSeat", seat, kind, difficulty }),
    start: () => send({ type: "start" }),
    intent: (action) => send({ type: "intent", action }),
    chat: (text) => send({ type: "chat", text }),
    resolveDrop: (seat, choice) => send({ type: "resolveDrop", seat, choice }),
    close: () => ws.close(),
  };
}
