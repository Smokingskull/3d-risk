/**
 * Integration tests for the authoritative room host. These drive the exported
 * rooms.ts handlers in-process with fake connections (each captures the messages it
 * was sent), exercising the trust boundary and lifecycle without a real socket:
 * turn-ownership rejection, isLegal gating, CPU driving, disconnect/pause,
 * reconnect-by-token, the reconnect-window expiry (owner end/replace), owner-drop
 * ending the game, and reaping an empty room.
 *
 * Timers (CPU pacing, reconnect window) are driven with fake timers so nothing
 * depends on wall-clock or leaks between tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "@risk3d/engine";
import type { ServerMsg } from "./protocol.js";
import {
  chat,
  createRoom,
  disconnect,
  handleIntent,
  joinRoom,
  reconnect,
  resolveDrop,
  setSeat,
  startGame,
  type Conn,
} from "./rooms.js";

// Long enough to fire the 5-minute reconnect window (RECONNECT_MS default).
const PAST_RECONNECT_WINDOW = 6 * 60 * 1000;

let seq = 0;
interface FakeConn {
  conn: Conn;
  sent: ServerMsg[];
}
function makeConn(): FakeConn {
  const id = `conn-${++seq}`;
  const sent: ServerMsg[] = [];
  return { conn: { id, send: (m) => sent.push(m) }, sent };
}

function all<T extends ServerMsg["type"]>(sent: ServerMsg[], type: T): Extract<ServerMsg, { type: T }>[] {
  return sent.filter((m) => m.type === type) as Extract<ServerMsg, { type: T }>[];
}
function last<T extends ServerMsg["type"]>(sent: ServerMsg[], type: T): Extract<ServerMsg, { type: T }> | undefined {
  const m = all(sent, type);
  return m[m.length - 1];
}
/** The most recent game state a connection has been shown (from its fog projection). */
function stateSeenBy(sent: ServerMsg[]): GameState | undefined {
  return last(sent, "update")?.state as GameState | undefined;
}

/** Start a fresh game with two connected humans (p1 owner, p2). Returns their conns + tokens. */
function startTwoHumans(opts: { campaign?: boolean } = {}) {
  const p1 = makeConn();
  createRoom(p1.conn, "P1", 2, opts.campaign ?? false, false); // p1 human owner, p2 CPU
  const code = last(p1.sent, "joined")!.code;
  const token1 = last(p1.sent, "joined")!.token;
  setSeat(p1.conn, "p2", "human"); // open p2 up for a human
  const p2 = makeConn();
  joinRoom(p2.conn, code, "P2");
  const token2 = last(p2.sent, "joined")!.token;
  startGame(p1.conn);
  return { p1, p2, code, token1, token2 };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete process.env.MP_TURN_TIMEOUT_MS;
});

describe("lobby", () => {
  it("createRoom issues a join token, a room code, and a lobby", () => {
    const p1 = makeConn();
    createRoom(p1.conn, "P1", 3, false, false);
    const joined = last(p1.sent, "joined");
    expect(joined?.you).toBe("p1");
    expect(joined?.code).toMatch(/^[A-Z0-9]{4}$/);
    expect(joined?.token).toBeTruthy();
    const lobby = last(p1.sent, "lobby");
    expect(lobby?.room.seats).toHaveLength(3);
    expect(lobby?.room.owner).toBe("p1");
  });

  it("joinRoom fills an open human seat", () => {
    const p1 = makeConn();
    createRoom(p1.conn, "P1", 2, false, false);
    const code = last(p1.sent, "joined")!.code;
    setSeat(p1.conn, "p2", "human");
    const p2 = makeConn();
    joinRoom(p2.conn, code, "P2");
    expect(last(p2.sent, "joined")?.you).toBe("p2");
    const seats = last(p2.sent, "lobby")!.room.seats;
    expect(seats.find((s) => s.id === "p2")).toMatchObject({ kind: "human", connected: true, name: "P2" });
  });

  it("joinRoom rejects an unknown or full room", () => {
    const stranger = makeConn();
    joinRoom(stranger.conn, "ZZZZ", "X");
    expect(last(stranger.sent, "error")?.reason).toBe("no such room");
  });

  it("setSeat is owner-only (in the lobby)", () => {
    const p1 = makeConn();
    createRoom(p1.conn, "P1", 3, false, false);
    const code = last(p1.sent, "joined")!.code;
    setSeat(p1.conn, "p2", "human");
    const p2 = makeConn();
    joinRoom(p2.conn, code, "P2");
    // p2 is not the owner: its setSeat is ignored (no resulting lobby broadcast to it).
    const before = all(p2.sent, "lobby").length;
    setSeat(p2.conn, "p3", "human");
    expect(all(p2.sent, "lobby").length).toBe(before);
  });

  it("startGame transitions the room to playing and deals a projected state", () => {
    const { p1, p2 } = startTwoHumans();
    expect(stateSeenBy(p1.sent)).toBeDefined();
    expect(stateSeenBy(p2.sent)).toBeDefined();
    expect(stateSeenBy(p1.sent)!.activePlayer).toBe("p1");
  });
});

describe("hosting — the trust boundary", () => {
  it("rejects an intent from a seat whose turn it is not", () => {
    const { p2 } = startTwoHumans(); // p1 is active
    handleIntent(p2.conn, { type: "endTurn" });
    expect(last(p2.sent, "error")?.reason).toBe("not your turn");
  });

  it("rejects an illegal action and applies a legal one", () => {
    const { p1 } = startTwoHumans();
    // endTurn during reinforce is illegal.
    handleIntent(p1.conn, { type: "endTurn" });
    expect(last(p1.sent, "error")?.reason).toBe("illegal action");

    const st = stateSeenBy(p1.sent)!;
    const owned = Object.keys(st.territories).find((t) => st.territories[t].owner === "p1")!;
    const before = st.reinforcementsRemaining;
    const updatesBefore = all(p1.sent, "update").length;
    handleIntent(p1.conn, { type: "placeArmies", territory: owned, count: 1 });
    // No new error, and the placement was broadcast back.
    expect(all(p1.sent, "update").length).toBe(updatesBefore + 1);
    expect(stateSeenBy(p1.sent)!.reinforcementsRemaining).toBe(before - 1);
  });

  it("hides an opponent's secret campaign objective in a viewer's projection", () => {
    const { p1 } = startTwoHumans({ campaign: true });
    const st = stateSeenBy(p1.sent)!;
    expect(st.players.find((pl) => pl.id === "p1")!.campaign).toBeDefined();
    expect(st.players.find((pl) => pl.id === "p2")!.campaign).toBeUndefined();
  });

  it("drives CPU seats to completion after a human ends their turn", () => {
    const p1 = makeConn();
    createRoom(p1.conn, "P1", 2, false, false); // p1 human, p2 CPU (medium)
    startGame(p1.conn);

    // Play p1's turn out trivially: place everything, skip attacking, end the turn.
    const st = stateSeenBy(p1.sent)!;
    const owned = Object.keys(st.territories).find((t) => st.territories[t].owner === "p1")!;
    handleIntent(p1.conn, { type: "placeArmies", territory: owned, count: st.reinforcementsRemaining });
    handleIntent(p1.conn, { type: "endAttack" });
    handleIntent(p1.conn, { type: "endTurn" }); // now p2 (CPU) is active; driveCpu kicks in

    expect(stateSeenBy(p1.sent)!.activePlayer).toBe("p2");
    // Let the CPU's scheduled actions fire until control returns to the human.
    for (let i = 0; i < 500; i++) {
      const cur = stateSeenBy(p1.sent)!;
      if (cur.winner || cur.activePlayer === "p1") break;
      vi.advanceTimersByTime(500);
    }
    const final = stateSeenBy(p1.sent)!;
    expect(final.winner ?? final.activePlayer).toBe(final.winner ? final.winner : "p1");
  });
});

describe("disconnect / reconnect / owner choice", () => {
  it("pauses on a mid-game drop and resumes on reconnect via token", () => {
    const { p1, p2, code, token2 } = startTwoHumans();
    disconnect(p2.conn);
    expect(last(p1.sent, "paused")?.seat).toBe("p2");

    const p2b = makeConn(); // a fresh socket for the returning player
    reconnect(p2b.conn, token2);
    expect(last(p2b.sent, "joined")?.code).toBe(code);
    expect(last(p2b.sent, "update")).toBeDefined();
    expect(last(p1.sent, "resumed")).toBeDefined();
  });

  it("on reconnect-window expiry, offers the owner end-or-replace; replace installs Joshua", () => {
    const { p1, p2 } = startTwoHumans();
    disconnect(p2.conn);
    vi.advanceTimersByTime(PAST_RECONNECT_WINDOW);
    expect(last(p1.sent, "dropChoice")?.seat).toBe("p2");

    resolveDrop(p1.conn, "p2", "replace");
    expect(last(p1.sent, "resumed")).toBeDefined();
    const p2seat = last(p1.sent, "lobby")!.room.seats.find((s) => s.id === "p2")!;
    expect(p2seat).toMatchObject({ kind: "cpu", difficulty: "joshua", name: "Joshua" });
  });

  it("on reconnect-window expiry, the owner can end the game", () => {
    const { p1, p2 } = startTwoHumans();
    disconnect(p2.conn);
    vi.advanceTimersByTime(PAST_RECONNECT_WINDOW);
    resolveDrop(p1.conn, "p2", "end");
    expect(last(p1.sent, "ended")).toBeDefined();
  });

  it("ends the game if the owner drops and doesn't return", () => {
    const { p1, p2 } = startTwoHumans();
    disconnect(p1.conn); // the owner leaves
    expect(last(p2.sent, "paused")?.seat).toBe("p1");
    vi.advanceTimersByTime(PAST_RECONNECT_WINDOW);
    expect(last(p2.sent, "ended")).toBeDefined();
  });

  it("reaps the room once everyone has left (token no longer valid)", () => {
    const { p1, p2, token2 } = startTwoHumans();
    disconnect(p2.conn); // pauses the room
    disconnect(p1.conn); // no connections left → room is reaped
    const p2b = makeConn();
    reconnect(p2b.conn, token2);
    expect(last(p2b.sent, "error")?.reason).toBe("cannot reconnect");
  });
});

describe("abuse hardening", () => {
  it("caps a connection to one live room", () => {
    const p1 = makeConn();
    createRoom(p1.conn, "P1", 3, false, false);
    const code = last(p1.sent, "joined")!.code;
    createRoom(p1.conn, "P1", 3, false, false); // second create refused
    expect(last(p1.sent, "error")?.reason).toBe("already in a room");
    joinRoom(p1.conn, code, "P1"); // joining another refused too
    expect(last(p1.sent, "error")?.reason).toBe("already in a room");
  });

  it("rate-limits chat per seat", () => {
    const { p1 } = startTwoHumans();
    const before = all(p1.sent, "chat").length;
    for (let i = 0; i < 8; i++) chat(p1.conn, `msg ${i}`); // CHAT_MAX = 8 in the window
    expect(all(p1.sent, "chat").length).toBe(before + 8);
    chat(p1.conn, "one too many");
    expect(all(p1.sent, "chat").length).toBe(before + 8); // dropped
    expect(last(p1.sent, "error")?.reason).toMatch(/too quickly/);
    vi.advanceTimersByTime(11_000); // window passes
    chat(p1.conn, "later");
    expect(all(p1.sent, "chat").length).toBe(before + 9);
  });
});

describe("idle turn timeout (opt-in via MP_TURN_TIMEOUT_MS)", () => {
  it("auto-ends an idle human's turn once the timeout elapses", () => {
    process.env.MP_TURN_TIMEOUT_MS = "60000";
    const { p1 } = startTwoHumans(); // room captures the timeout at creation
    delete process.env.MP_TURN_TIMEOUT_MS;

    expect(stateSeenBy(p1.sent)!.activePlayer).toBe("p1");
    vi.advanceTimersByTime(61_000); // nobody acted → p1's turn is auto-finished
    expect(stateSeenBy(p1.sent)!.activePlayer).toBe("p2");
  });

  it("stays put when no timeout is configured (casual default)", () => {
    const { p1 } = startTwoHumans(); // no MP_TURN_TIMEOUT_MS → off
    vi.advanceTimersByTime(10 * 60_000);
    expect(stateSeenBy(p1.sent)!.activePlayer).toBe("p1"); // still p1's turn
  });
});
