/**
 * Phase-0 multiplayer spike — an authoritative Node WebSocket server hosting a
 * single hardcoded 2-player game. It proves the model the full feature will build
 * on: clients send *intents*, the server validates+applies them with the shared
 * engine, and broadcasts each connection only its own *fog-of-war projection*
 * (own cards/objective visible; opponents' hidden; Misinformation applied). Dice
 * and undrawn cards stay server-side.
 *
 * It also serves a tiny embedded HTML client so you can open two browser tabs and
 * play a turn end-to-end. Run: `pnpm --filter @risk3d/server dev`, open two tabs
 * at http://localhost:8787. This is scaffolding for the real rooms/lobby server.
 */
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  applyAction,
  createGame,
  isLegal,
  projectStateForViewer,
  type Action,
  type GameState,
} from "@risk3d/engine";

const PORT = Number(process.env.PORT ?? 8787);
const SEAT_IDS = ["p1", "p2"] as const;

// --- the single spike room (in-memory) --------------------------------------
let state: GameState = createGame({
  players: [
    { id: "p1", name: "Player 1", color: "#e6194b", kind: "human" },
    { id: "p2", name: "Player 2", color: "#4363d8", kind: "human" },
  ],
  boardMode: "classic",
  seed: 42,
  campaign: true,
  cardsEnabled: true,
});

const seats = new Map<string, WebSocket>(); // playerId -> socket

function sendView(pid: string, ws: WebSocket): void {
  ws.send(JSON.stringify({ type: "view", you: pid, state: projectStateForViewer(state, pid) }));
}
function broadcast(): void {
  for (const [pid, ws] of seats) if (ws.readyState === ws.OPEN) sendView(pid, ws);
}
/** Whoever is allowed to act right now (a pending defender reaction, else the active player). */
function currentActor(): string {
  return state.pendingDecision ? state.pendingDecision.player : state.activePlayer;
}

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(CLIENT_HTML);
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  const seat = SEAT_IDS.find((id) => !seats.has(id));
  if (!seat) {
    ws.send(JSON.stringify({ type: "full" }));
    ws.close();
    return;
  }
  seats.set(seat, ws);
  ws.send(JSON.stringify({ type: "assigned", you: seat }));
  sendView(seat, ws);

  ws.on("message", (raw) => {
    let msg: { type?: string; action?: Action };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type !== "intent" || !msg.action) return;
    if (seat !== currentActor()) {
      ws.send(JSON.stringify({ type: "error", reason: "not your turn" }));
      return;
    }
    if (!isLegal(state, msg.action)) {
      ws.send(JSON.stringify({ type: "error", reason: "illegal action" }));
      return;
    }
    state = applyAction(state, msg.action).state;
    broadcast();
  });

  ws.on("close", () => {
    if (seats.get(seat) === ws) seats.delete(seat);
  });
});

server.listen(PORT, () => console.log(`[mp-spike] http + ws listening on http://localhost:${PORT}`));

// --- tiny embedded client (spike only) --------------------------------------
const CLIENT_HTML = /* html */ `<!doctype html>
<meta charset="utf-8" />
<title>3D Risk — MP spike</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 20px; background:#101417; color:#e8e0d2; }
  button { font: inherit; margin-right: 6px; padding: 4px 10px; }
  #terr { height: 260px; overflow:auto; border:1px solid #444; padding:6px; margin-top:8px; white-space:pre; font-family:monospace; }
  .k { color:#d5ae69; }
</style>
<h2>3D Risk — multiplayer spike</h2>
<div id="who">connecting…</div>
<div id="turn"></div>
<div id="me"></div>
<div id="players"></div>
<p>
  <button id="deploy">Deploy all reinforcements</button>
  <button id="endAttack">End attack</button>
  <button id="endTurn">End turn</button>
</p>
<div id="err" style="color:#e06b5b"></div>
<div id="terr"></div>
<script>
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
  let you = null, state = null;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "assigned") { you = m.you; }
    else if (m.type === "view") { you = m.you; state = m.state; render(); }
    else if (m.type === "error") { document.getElementById("err").textContent = "⚠ " + m.reason; }
    else if (m.type === "full") { document.getElementById("who").textContent = "Room full (2 players already)."; }
  };
  ws.onclose = () => document.getElementById("who").textContent = "disconnected";
  const send = (action) => { document.getElementById("err").textContent = ""; ws.send(JSON.stringify({ type: "intent", action })); };

  document.getElementById("deploy").onclick = () => {
    const meId = you;
    const owned = Object.keys(state.territories).filter(t => state.territories[t].owner === meId);
    if (!owned.length) return;
    send({ type: "placeArmies", territory: owned[0], count: state.reinforcementsRemaining });
  };
  document.getElementById("endAttack").onclick = () => send({ type: "endAttack" });
  document.getElementById("endTurn").onclick = () => send({ type: "endTurn" });

  function render() {
    const meId = you;
    window.__state = state; window.__you = you; // exposed for the spike verification test
    const me = state.players.find(p => p.id === meId);
    document.getElementById("who").innerHTML = "You are <span class=k>" + me.name + "</span> (" + meId + ")";
    document.getElementById("turn").innerHTML = "<span class=k>" + state.activePlayer + "</span>'s turn — phase <span class=k>" + state.phase + "</span>, reinforcements left: " + state.reinforcementsRemaining;
    document.getElementById("me").innerHTML =
      "Your cards: <span class=k>" + (me.cards.map(c => c.symbol + (c.territory ? "(" + c.territory + ")" : "")).join(", ") || "none") + "</span>" +
      " · Your objective: <span class=k>" + (me.campaign ? JSON.stringify(me.campaign) : "—") + "</span>";
    document.getElementById("players").innerHTML = "Players — " + state.players.map(p => {
      const n = Object.values(state.territories).filter(t => t.owner === p.id).length;
      return p.name + ": " + n + " terr, " + p.cards.length + " cards" + (p.id === meId ? " (you)" : "");
    }).join(" | ");
    document.getElementById("terr").textContent = Object.keys(state.territories).sort()
      .map(t => t.padEnd(22) + (state.territories[t].owner || "-").padEnd(4) + state.territories[t].armies).join("\\n");
  }
</script>`;
