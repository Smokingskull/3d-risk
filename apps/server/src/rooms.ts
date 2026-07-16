/**
 * In-memory rooms + authoritative game hosting (rooms/lobby slice).
 *
 * A room holds seats (humans and CPUs) and, once started, the true GameState. The
 * server validates every intent with the engine, applies it, and broadcasts each
 * connected human only its own fog-of-war projection. CPU seats are driven here,
 * server-side, via the same engine AI as single-player (including Joshua).
 *
 * Not in this slice (next): chat, human reaction windows over the wire, and the
 * 5-minute disconnect pause / owner end-or-replace choice. Human reaction windows
 * and disconnected seats are auto-resolved for now so a game never stalls.
 */
import {
  applyAction,
  createAI,
  createGame,
  decideReaction,
  isLegal,
  projectStateForViewer,
  type Action,
  type Difficulty,
  type GameEvent,
  type GameState,
} from "@risk3d/engine";
import type { LobbyInfo, SeatInfo, ServerMsg } from "./protocol.js";

const PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4"];
const CPU_DELAY = 350; // ms between CPU actions (casual pacing)

export interface Conn {
  id: string;
  send: (msg: ServerMsg) => void;
}

interface Seat {
  id: string; // engine player id "p1".. and PALETTE index by position
  name: string;
  kind: "human" | "cpu";
  difficulty?: Difficulty;
  conn?: Conn; // present iff a human currently occupies it
}

interface Room {
  code: string;
  owner: string; // owner seat id
  phase: "lobby" | "playing" | "over";
  seats: Seat[];
  campaign: boolean;
  actionCards: boolean;
  state: GameState | null;
  cpuTimer?: ReturnType<typeof setTimeout>;
}

const rooms = new Map<string, Room>();
const connRoom = new Map<string, string>(); // connId -> room code

function genCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

const cpuName = (d: Difficulty) => (d === "joshua" ? "Joshua" : `CPU (${d})`);

function seatInfo(s: Seat): SeatInfo {
  return { id: s.id, name: s.name, kind: s.kind, difficulty: s.difficulty, connected: !!s.conn };
}
function lobbyInfo(room: Room): LobbyInfo {
  return { code: room.code, owner: room.owner, phase: room.phase, seats: room.seats.map(seatInfo) };
}
function broadcastLobby(room: Room): void {
  const msg: ServerMsg = { type: "lobby", room: lobbyInfo(room) };
  for (const s of room.seats) s.conn?.send(msg);
}
function broadcastGame(room: Room, events: GameEvent[] = []): void {
  const st = room.state!;
  for (const s of room.seats) {
    if (!s.conn) continue;
    const view = projectStateForViewer(st, s.id);
    s.conn.send(
      st.winner
        ? { type: "over", you: s.id, state: view, winner: st.winner }
        : { type: "update", you: s.id, state: view, events },
    );
  }
}

// --- lobby ------------------------------------------------------------------

export function createRoom(conn: Conn, name: string, players: number, campaign: boolean, actionCards: boolean): Room {
  const n = Math.max(2, Math.min(6, players || 3));
  const seats: Seat[] = Array.from({ length: n }, (_, i) => {
    const id = `p${i + 1}`;
    if (i === 0) return { id, name: name || "Player 1", kind: "human", conn };
    return { id, name: cpuName("medium"), kind: "cpu", difficulty: "medium" };
  });
  const room: Room = { code: genCode(), owner: "p1", phase: "lobby", seats, campaign, actionCards, state: null };
  rooms.set(room.code, room);
  connRoom.set(conn.id, room.code);
  conn.send({ type: "joined", code: room.code, you: "p1" });
  broadcastLobby(room);
  return room;
}

export function joinRoom(conn: Conn, code: string, name: string): void {
  const room = rooms.get(code.toUpperCase());
  if (!room) return conn.send({ type: "error", reason: "no such room" });
  if (room.phase !== "lobby") return conn.send({ type: "error", reason: "game already started" });
  const seat = room.seats.find((s) => s.kind === "human" && !s.conn);
  if (!seat) return conn.send({ type: "error", reason: "room is full" });
  seat.conn = conn;
  seat.name = name || seat.id;
  connRoom.set(conn.id, room.code);
  conn.send({ type: "joined", code: room.code, you: seat.id });
  broadcastLobby(room);
}

export function setSeat(conn: Conn, seatId: string, kind: "human" | "cpu", difficulty?: Difficulty): void {
  const room = roomOf(conn);
  if (!room || room.phase !== "lobby") return;
  if (room.owner !== seatIdOf(room, conn)) return conn.send({ type: "error", reason: "only the owner can configure seats" });
  const seat = room.seats.find((s) => s.id === seatId);
  if (!seat || seat.id === room.owner) return; // can't reconfigure the owner seat
  if (seat.conn && seat.conn.id !== conn.id) return conn.send({ type: "error", reason: "seat is held by a player" });
  if (kind === "cpu") {
    seat.kind = "cpu";
    seat.difficulty = difficulty ?? "medium";
    seat.conn = undefined;
    seat.name = cpuName(seat.difficulty);
  } else {
    seat.kind = "human"; // open slot awaiting a human
    seat.difficulty = undefined;
    seat.conn = undefined;
    seat.name = "(open)";
  }
  broadcastLobby(room);
}

export function startGame(conn: Conn): void {
  const room = roomOf(conn);
  if (!room || room.phase !== "lobby") return;
  if (room.owner !== seatIdOf(room, conn)) return conn.send({ type: "error", reason: "only the owner can start" });
  // Any still-open human seat becomes a medium CPU so the game is always fillable.
  for (const s of room.seats)
    if (s.kind === "human" && !s.conn) {
      s.kind = "cpu";
      s.difficulty = "medium";
      s.name = cpuName("medium");
    }
  if (!room.seats.some((s) => s.kind === "human" && s.conn)) return conn.send({ type: "error", reason: "need at least one human" });

  room.state = createGame({
    players: room.seats.map((s, i) => ({
      id: s.id,
      name: s.name,
      color: PALETTE[i % PALETTE.length],
      kind: s.kind,
      difficulty: s.kind === "cpu" ? s.difficulty : undefined,
    })),
    boardMode: "classic",
    seed: Math.floor(Math.random() * 0x7fffffff),
    campaign: room.campaign,
    actionCardsEnabled: room.actionCards,
  });
  room.phase = "playing";
  broadcastLobby(room);
  broadcastGame(room);
  driveCpu(room);
}

// --- hosting ----------------------------------------------------------------

export function handleIntent(conn: Conn, action: Action): void {
  const room = roomOf(conn);
  if (!room || room.phase !== "playing" || !room.state) return;
  const seat = room.seats.find((s) => s.conn?.id === conn.id);
  if (!seat) return;
  const actor = room.state.pendingDecision ? room.state.pendingDecision.player : room.state.activePlayer;
  if (seat.id !== actor) return conn.send({ type: "error", reason: "not your turn" });
  if (!applyToRoom(room, action)) return conn.send({ type: "error", reason: "illegal action" });
  driveCpu(room); // continue if the next actor is a CPU
}

function applyToRoom(room: Room, action: Action): boolean {
  const st = room.state!;
  if (!isLegal(st, action)) return false;
  const { state, events } = applyAction(st, action);
  room.state = state;
  if (state.winner) room.phase = "over";
  broadcastGame(room, events);
  return true;
}

/** Advance CPU seats (and, for now, auto-resolve reaction windows / disconnected
 *  seats) until it's a connected human's move or the game ends. */
function driveCpu(room: Room): void {
  if (room.cpuTimer) clearTimeout(room.cpuTimer);
  if (room.phase !== "playing" || !room.state || room.state.winner) return;
  const st = room.state;

  if (st.pendingDecision) {
    const seat = room.seats.find((s) => s.id === st.pendingDecision!.player)!;
    // CPU defenders decide; human reaction-over-wire is the next slice, so a human's
    // window is auto-declined for now to keep play moving.
    const action = seat.kind === "cpu" ? decideReaction(st) : ({ type: "resolveDecision", play: false } as const);
    applyToRoom(room, action);
    room.cpuTimer = setTimeout(() => driveCpu(room), CPU_DELAY);
    return;
  }

  const seat = room.seats.find((s) => s.id === st.activePlayer)!;
  if (seat.kind === "human" && seat.conn) return; // wait for the human's intent
  const difficulty = seat.kind === "cpu" ? seat.difficulty ?? "medium" : "easy"; // disconnected human ⇒ easy CPU (stopgap)
  applyToRoom(room, createAI(difficulty).decide(st));
  room.cpuTimer = setTimeout(() => driveCpu(room), CPU_DELAY);
}

// --- disconnect (minimal; full pause/owner-choice is the next slice) --------

export function disconnect(conn: Conn): void {
  const room = roomOf(conn);
  if (!room) return;
  const seat = room.seats.find((s) => s.conn?.id === conn.id);
  connRoom.delete(conn.id);
  if (!seat) return;
  seat.conn = undefined;
  if (room.phase === "lobby") {
    seat.kind = "human";
    seat.name = "(open)";
    broadcastLobby(room);
  } else {
    // In play: the seat keeps playing as a CPU stopgap; drive picks it up.
    broadcastLobby(room);
    driveCpu(room);
  }
  // Reap an empty room.
  if (!room.seats.some((s) => s.conn)) {
    if (room.cpuTimer) clearTimeout(room.cpuTimer);
    rooms.delete(room.code);
  }
}

// --- helpers ----------------------------------------------------------------

function roomOf(conn: Conn): Room | undefined {
  const code = connRoom.get(conn.id);
  return code ? rooms.get(code) : undefined;
}
function seatIdOf(room: Room, conn: Conn): string | undefined {
  return room.seats.find((s) => s.conn?.id === conn.id)?.id;
}
