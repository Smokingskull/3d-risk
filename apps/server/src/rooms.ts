/**
 * In-memory rooms + authoritative game hosting.
 *
 * A room holds seats (humans and CPUs) and, once started, the true GameState. Every
 * intent is validated + applied with the engine; each connected human is broadcast
 * only its fog-of-war projection. CPU seats — and CPU defender reactions — are driven
 * here via the engine AI. Human defender reaction windows wait for that player.
 *
 * Disconnect handling: dropping mid-game pauses the room for a reconnect window
 * (RECONNECT_MS). If the player returns (via their token) it resumes; otherwise the
 * owner chooses to end the game or replace the seat with Joshua. If the owner drops
 * and doesn't return, the game ends.
 */
import { randomUUID } from "node:crypto";
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
const RECONNECT_MS = Number(process.env.MP_RECONNECT_MS ?? 5 * 60 * 1000); // 5 min (overridable for tests)

export interface Conn {
  id: string;
  send: (msg: ServerMsg) => void;
}

interface Seat {
  id: string; // engine player id "p1".., PALETTE index by position
  name: string;
  kind: "human" | "cpu";
  difficulty?: Difficulty;
  conn?: Conn; // present iff a human currently occupies it
  token?: string; // reconnect key for a human seat
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
  // disconnect handling
  paused: boolean;
  droppedSeat?: string; // seat awaiting reconnect
  dropTimer?: ReturnType<typeof setTimeout>;
  awaitingOwnerChoice?: string; // seat the owner must decide on
}

const rooms = new Map<string, Room>();
const connRoom = new Map<string, string>(); // connId -> room code
const tokens = new Map<string, { code: string; seat: string }>(); // reconnect token -> seat

function genCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}
const cpuName = (d: Difficulty) => (d === "joshua" ? "Joshua" : `CPU (${d})`);

// --- pure drive decision (unit-tested) --------------------------------------

/** What the server should enact right now, or null to wait for a human. Only CPU
 *  actors (and CPU defender reactions) produce actions; a human actor always waits. */
export function nextCpuAction(
  state: GameState,
  seats: { id: string; kind: "human" | "cpu"; difficulty?: Difficulty }[],
): Action | null {
  if (state.winner) return null;
  const actorId = state.pendingDecision ? state.pendingDecision.player : state.activePlayer;
  const seat = seats.find((s) => s.id === actorId);
  if (!seat || seat.kind === "human") return null; // wait for the human
  if (state.pendingDecision) return decideReaction(state);
  return createAI(seat.difficulty ?? "medium").decide(state);
}

// --- messaging --------------------------------------------------------------

function seatInfo(s: Seat): SeatInfo {
  return { id: s.id, name: s.name, kind: s.kind, difficulty: s.difficulty, connected: !!s.conn };
}
function lobbyInfo(room: Room): LobbyInfo {
  return { code: room.code, owner: room.owner, phase: room.phase, seats: room.seats.map(seatInfo) };
}
function broadcast(room: Room, msg: ServerMsg): void {
  for (const s of room.seats) s.conn?.send(msg);
}
function broadcastLobby(room: Room): void {
  broadcast(room, { type: "lobby", room: lobbyInfo(room) });
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

function issueToken(room: Room, seat: Seat): string {
  const token = randomUUID();
  seat.token = token;
  tokens.set(token, { code: room.code, seat: seat.id });
  return token;
}

export function createRoom(conn: Conn, name: string, players: number, campaign: boolean, actionCards: boolean): void {
  const n = Math.max(2, Math.min(6, players || 3));
  const seats: Seat[] = Array.from({ length: n }, (_, i) => {
    const id = `p${i + 1}`;
    if (i === 0) return { id, name: name || "Player 1", kind: "human", conn };
    return { id, name: cpuName("medium"), kind: "cpu", difficulty: "medium" };
  });
  const room: Room = { code: genCode(), owner: "p1", phase: "lobby", seats, campaign, actionCards, state: null, paused: false };
  rooms.set(room.code, room);
  connRoom.set(conn.id, room.code);
  const token = issueToken(room, seats[0]);
  conn.send({ type: "joined", code: room.code, you: "p1", token });
  broadcastLobby(room);
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
  const token = issueToken(room, seat);
  conn.send({ type: "joined", code: room.code, you: seat.id, token });
  broadcastLobby(room);
}

export function reconnect(conn: Conn, token: string): void {
  const ref = tokens.get(token);
  const room = ref && rooms.get(ref.code);
  if (!ref || !room || room.phase === "over") return conn.send({ type: "error", reason: "cannot reconnect" });
  const seat = room.seats.find((s) => s.id === ref.seat);
  if (!seat) return conn.send({ type: "error", reason: "seat gone" });
  seat.conn = conn;
  connRoom.set(conn.id, room.code);
  conn.send({ type: "joined", code: room.code, you: seat.id, token });
  conn.send({ type: "lobby", room: lobbyInfo(room) });
  if (room.phase === "playing" && room.state) conn.send({ type: "update", you: seat.id, state: projectStateForViewer(room.state, seat.id), events: [] });
  // Resume if this was the seat we were waiting on.
  if (room.paused && room.droppedSeat === seat.id) resume(room);
}

export function setSeat(conn: Conn, seatId: string, kind: "human" | "cpu", difficulty?: Difficulty): void {
  const room = roomOf(conn);
  if (!room || room.phase !== "lobby" || room.owner !== seatIdOf(room, conn)) return;
  const seat = room.seats.find((s) => s.id === seatId);
  if (!seat || seat.id === room.owner) return;
  if (seat.conn && seat.conn.id !== conn.id) return conn.send({ type: "error", reason: "seat is held by a player" });
  if (kind === "cpu") {
    seat.kind = "cpu";
    seat.difficulty = difficulty ?? "medium";
    seat.conn = undefined;
    seat.name = cpuName(seat.difficulty);
  } else {
    seat.kind = "human";
    seat.difficulty = undefined;
    seat.conn = undefined;
    seat.name = "(open)";
  }
  broadcastLobby(room);
}

export function startGame(conn: Conn): void {
  const room = roomOf(conn);
  if (!room || room.phase !== "lobby" || room.owner !== seatIdOf(room, conn)) return;
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
  if (room.paused) return conn.send({ type: "error", reason: "game is paused" });
  const seat = room.seats.find((s) => s.conn?.id === conn.id);
  if (!seat) return;
  const actor = room.state.pendingDecision ? room.state.pendingDecision.player : room.state.activePlayer;
  if (seat.id !== actor) return conn.send({ type: "error", reason: "not your turn" });
  if (!applyToRoom(room, action)) return conn.send({ type: "error", reason: "illegal action" });
  driveCpu(room);
}

export function chat(conn: Conn, text: string): void {
  const room = roomOf(conn);
  const seat = room && room.seats.find((s) => s.conn?.id === conn.id);
  if (!room || !seat) return;
  const clean = String(text).slice(0, 300).trim();
  if (clean) broadcast(room, { type: "chat", from: seat.name, text: clean });
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

function driveCpu(room: Room): void {
  if (room.cpuTimer) clearTimeout(room.cpuTimer);
  if (room.phase !== "playing" || room.paused || !room.state) return;
  const action = nextCpuAction(room.state, room.seats);
  if (!action) return; // a human must act (or the game is over)
  applyToRoom(room, action);
  room.cpuTimer = setTimeout(() => driveCpu(room), CPU_DELAY);
}

// --- disconnect / reconnect / owner choice ----------------------------------

export function disconnect(conn: Conn): void {
  const room = roomOf(conn);
  connRoom.delete(conn.id);
  if (!room) return;
  const seat = room.seats.find((s) => s.conn?.id === conn.id);
  if (!seat) return;
  seat.conn = undefined;

  if (room.phase === "lobby") {
    if (seat.id !== room.owner) {
      seat.kind = "human";
      seat.name = "(open)";
      if (seat.token) tokens.delete(seat.token);
      seat.token = undefined;
    }
    broadcastLobby(room);
    reapIfEmpty(room);
    return;
  }
  if (room.phase !== "playing") return;

  // Pause for a reconnect window (only the first drop drives the timer).
  if (!room.paused) {
    room.paused = true;
    room.droppedSeat = seat.id;
    if (room.cpuTimer) clearTimeout(room.cpuTimer);
    broadcast(room, { type: "paused", seat: seat.id, name: seat.name, seconds: Math.round(RECONNECT_MS / 1000) });
    room.dropTimer = setTimeout(() => onReconnectExpired(room, seat.id), RECONNECT_MS);
  }
  reapIfEmpty(room);
}

function resume(room: Room): void {
  if (room.dropTimer) clearTimeout(room.dropTimer);
  room.paused = false;
  room.droppedSeat = undefined;
  room.awaitingOwnerChoice = undefined;
  broadcast(room, { type: "resumed" });
  broadcastLobby(room);
  driveCpu(room);
}

function onReconnectExpired(room: Room, seatId: string): void {
  if (room.phase !== "playing" || !room.paused || room.droppedSeat !== seatId) return;
  if (seatId === room.owner) return endGame(room, "the owner left the game");
  // Ask the owner: end, or replace with Joshua.
  room.awaitingOwnerChoice = seatId;
  const owner = room.seats.find((s) => s.id === room.owner);
  const dropped = room.seats.find((s) => s.id === seatId);
  owner?.conn?.send({ type: "dropChoice", seat: seatId, name: dropped?.name ?? seatId });
}

export function resolveDrop(conn: Conn, seatId: string, choice: "end" | "replace"): void {
  const room = roomOf(conn);
  if (!room || room.owner !== seatIdOf(room, conn) || room.awaitingOwnerChoice !== seatId) return;
  if (choice === "end") return endGame(room, "the owner ended the game");
  const seat = room.seats.find((s) => s.id === seatId);
  if (seat) {
    if (seat.token) tokens.delete(seat.token);
    seat.token = undefined;
    seat.conn = undefined;
    seat.kind = "cpu";
    seat.difficulty = "joshua"; // replace a lost human with the strongest CPU
    seat.name = cpuName("joshua");
  }
  resume(room);
}

function endGame(room: Room, reason: string): void {
  room.phase = "over";
  if (room.cpuTimer) clearTimeout(room.cpuTimer);
  if (room.dropTimer) clearTimeout(room.dropTimer);
  broadcast(room, { type: "ended", reason });
  for (const s of room.seats) if (s.token) tokens.delete(s.token);
  rooms.delete(room.code);
}

function reapIfEmpty(room: Room): void {
  if (room.seats.some((s) => s.conn)) return;
  if (room.cpuTimer) clearTimeout(room.cpuTimer);
  if (room.dropTimer) clearTimeout(room.dropTimer);
  for (const s of room.seats) if (s.token) tokens.delete(s.token);
  rooms.delete(room.code);
}

// --- helpers ----------------------------------------------------------------

function roomOf(conn: Conn): Room | undefined {
  const code = connRoom.get(conn.id);
  return code ? rooms.get(code) : undefined;
}
function seatIdOf(room: Room, conn: Conn): string | undefined {
  return room.seats.find((s) => s.conn?.id === conn.id)?.id;
}
