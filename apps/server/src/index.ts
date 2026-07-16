/**
 * Multiplayer server — rooms/lobby + authoritative hosting slice.
 *
 * HTTP serves a small embedded lobby+game client (so two browser tabs can create/
 * join a room and play). WebSocket carries the protocol (see protocol.ts): the
 * server is authoritative, validates every intent with the engine, and broadcasts
 * each connected human only its own fog-of-war view. CPU seats are driven here.
 *
 * Run: `pnpm --filter @risk3d/server dev`, open http://localhost:8787 in two tabs.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import type { ClientMsg } from "./protocol.js";
import { chat, createRoom, disconnect, handleIntent, joinRoom, reconnect, resolveDrop, setSeat, startGame, type Conn } from "./rooms.js";

const PORT = Number(process.env.PORT ?? 8787);

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
  const conn: Conn = {
    id: randomUUID(),
    send: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  ws.on("message", (raw) => {
    let m: ClientMsg;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (m.type) {
      case "create":
        createRoom(conn, m.name, m.players, m.campaign ?? true, m.actionCards ?? false);
        break;
      case "join":
        joinRoom(conn, m.code, m.name);
        break;
      case "reconnect":
        reconnect(conn, m.token);
        break;
      case "setSeat":
        setSeat(conn, m.seat, m.kind, m.difficulty);
        break;
      case "start":
        startGame(conn);
        break;
      case "intent":
        handleIntent(conn, m.action);
        break;
      case "chat":
        chat(conn, m.text);
        break;
      case "resolveDrop":
        resolveDrop(conn, m.seat, m.choice);
        break;
    }
  });
  ws.on("close", () => disconnect(conn));
});

server.listen(PORT, () => console.log(`[mp] http + ws listening on http://localhost:${PORT}`));

// --- embedded lobby + game client (spike/testing only) ----------------------
const CLIENT_HTML = /* html */ `<!doctype html>
<meta charset="utf-8" />
<title>3D Risk — multiplayer</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 20px; background:#101417; color:#e8e0d2; max-width:760px; }
  button, select, input { font: inherit; }
  button { margin-right:6px; padding:4px 10px; }
  .card { border:1px solid #333; border-radius:8px; padding:12px; margin-top:10px; }
  .k { color:#d5ae69; } .err { color:#e06b5b; min-height:1.4em; }
  #terr { height:220px; overflow:auto; border:1px solid #444; padding:6px; margin-top:8px; white-space:pre; font-family:monospace; }
  .seat { display:flex; gap:8px; align-items:center; margin:3px 0; }
</style>
<h2>3D Risk — multiplayer</h2>
<div id="err" class="err"></div>
<div id="status" class="k"></div>
<div id="dropchoice" class="card" style="display:none"></div>

<div id="entry" class="card">
  <div class="seat"><label>Name <input id="name" value="Player" /></label></div>
  <div class="seat">
    <label>Players <select id="players"><option>2</option><option selected>3</option><option>4</option><option>5</option><option>6</option></select></label>
    <label><input type="checkbox" id="campaign" checked /> Campaign</label>
    <button id="create">Create room</button>
  </div>
  <div class="seat"><label>Code <input id="code" size="6" /></label><button id="join">Join</button></div>
</div>

<div id="lobby" class="card" style="display:none">
  <div>Room <span class="k" id="lcode"></span> — you are <span class="k" id="lyou"></span></div>
  <div id="seats"></div>
  <button id="start" style="display:none">Start game</button>
  <div id="wait" style="display:none">Waiting for the owner to start…</div>
</div>

<div id="game" class="card" style="display:none">
  <div id="turn"></div><div id="me"></div><div id="players"></div>
  <div id="reaction" style="display:none; margin-top:8px"></div>
  <p>
    <button id="deploy">Deploy all reinforcements</button>
    <button id="endAttack">End attack</button>
    <button id="endTurn">End turn</button>
  </p>
  <div id="terr"></div>
  <div style="margin-top:10px">
    <div id="chatlog" style="height:80px; overflow:auto; border:1px solid #333; padding:4px; font-size:13px"></div>
    <input id="chatinput" placeholder="chat…" size="38" /><button id="chatsend">Send</button>
  </div>
</div>

<script>
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
  let you = null, room = null, state = null, token = null;
  const $ = (id) => document.getElementById(id);
  const send = (m) => ws.send(JSON.stringify(m));
  const err = (t) => { $("err").textContent = t || ""; };
  window.__mp = () => ({ you, room, state, token });

  const addChat = (line) => { const d = $("chatlog"), p = document.createElement("div"); p.textContent = line; d.appendChild(p); d.scrollTop = d.scrollHeight; };
  function actionBtn(text, action) { const b = document.createElement("button"); b.textContent = text; b.onclick = () => send({ type: "intent", action }); return b; }
  function showDropChoice(seat, name) {
    const d = $("dropchoice"); d.style.display = ""; d.innerHTML = "<b>" + name + "</b> didn't return. ";
    const end = document.createElement("button"); end.textContent = "End game"; end.onclick = () => send({ type: "resolveDrop", seat, choice: "end" });
    const rep = document.createElement("button"); rep.textContent = "Replace with Joshua"; rep.onclick = () => send({ type: "resolveDrop", seat, choice: "replace" });
    d.append(end, rep);
  }

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "joined") { you = m.you; token = m.token; $("code").value = m.code; }
    else if (m.type === "lobby") { room = m.room; renderLobby(); }
    else if (m.type === "update" || m.type === "over") { you = m.you; state = m.state; renderGame(m.type === "over" ? m.winner : null); }
    else if (m.type === "chat") addChat(m.from + ": " + m.text);
    else if (m.type === "paused") $("status").textContent = "⏸ " + m.name + " disconnected — paused up to " + m.seconds + "s for reconnect…";
    else if (m.type === "resumed") { $("status").textContent = ""; $("dropchoice").style.display = "none"; }
    else if (m.type === "dropChoice") showDropChoice(m.seat, m.name);
    else if (m.type === "ended") $("status").textContent = "🏁 Game ended — " + m.reason;
    else if (m.type === "error") err("⚠ " + m.reason);
  };

  $("create").onclick = () => { err(""); send({ type: "create", name: $("name").value, players: +$("players").value, campaign: $("campaign").checked }); };
  $("join").onclick = () => { err(""); send({ type: "join", code: $("code").value.trim().toUpperCase(), name: $("name").value }); };
  $("start").onclick = () => send({ type: "start" });
  $("deploy").onclick = () => { err(""); const owned = Object.keys(state.territories).filter(t => state.territories[t].owner === you); if (owned.length) send({ type: "intent", action: { type: "placeArmies", territory: owned[0], count: state.reinforcementsRemaining } }); };
  $("endAttack").onclick = () => send({ type: "intent", action: { type: "endAttack" } });
  $("endTurn").onclick = () => send({ type: "intent", action: { type: "endTurn" } });
  $("chatsend").onclick = () => { const t = $("chatinput").value; if (t.trim()) { send({ type: "chat", text: t }); $("chatinput").value = ""; } };

  function renderLobby() {
    $("entry").style.display = "none";
    $("lobby").style.display = room.phase === "lobby" ? "" : "none";
    $("game").style.display = room.phase === "lobby" ? "none" : "";
    $("lcode").textContent = room.code; $("lyou").textContent = you;
    const owner = room.owner === you;
    $("seats").innerHTML = "";
    for (const s of room.seats) {
      const row = document.createElement("div"); row.className = "seat";
      const label = s.id + ": " + s.name + (s.connected ? " ✓" : "") + (s.id === room.owner ? " (owner)" : "");
      if (owner && s.id !== room.owner) {
        const sel = document.createElement("select");
        for (const [v, t] of [["open","Open"],["easy","Easy"],["medium","Medium"],["hard","Hard"],["joshua","Joshua"]]) {
          const o = document.createElement("option"); o.value = v; o.textContent = t;
          o.selected = (v === "open" && s.kind === "human") || v === s.difficulty; sel.appendChild(o);
        }
        sel.onchange = () => sel.value === "open"
          ? send({ type: "setSeat", seat: s.id, kind: "human" })
          : send({ type: "setSeat", seat: s.id, kind: "cpu", difficulty: sel.value });
        row.append(label + "  ", sel);
      } else row.textContent = label;
      $("seats").appendChild(row);
    }
    $("start").style.display = owner ? "" : "none";
    $("wait").style.display = owner ? "none" : "";
  }

  function renderGame(winner) {
    if (room) { $("lobby").style.display = "none"; $("game").style.display = ""; }
    const me = state.players.find(p => p.id === you);
    $("turn").innerHTML = (winner ? "<b>Winner: " + winner + "</b> — " : "") + "<span class=k>" + state.activePlayer + "</span>'s turn — phase <span class=k>" + state.phase + "</span>, reinforcements: " + state.reinforcementsRemaining;
    $("me").innerHTML = "You (" + you + "): cards <span class=k>" + (me.cards.map(c => c.symbol).join(",") || "none") + "</span> · objective <span class=k>" + (me.campaign ? JSON.stringify(me.campaign) : "—") + "</span>";
    $("players").innerHTML = "Players — " + state.players.map(p => {
      const n = Object.values(state.territories).filter(t => t.owner === p.id).length;
      return p.name + ": " + n + "t, " + p.cards.length + "c" + (p.id === you ? " (you)" : "");
    }).join(" | ");
    // Defender reaction window (Minefield / Tactical Retreat)
    const pd = state.pendingDecision, rdiv = $("reaction");
    if (pd && pd.player === you) {
      rdiv.style.display = ""; rdiv.innerHTML = "<b>Reaction — " + pd.kind + ":</b> ";
      if (pd.kind === "minefield") {
        rdiv.append(actionBtn("Lay minefield", { type: "resolveDecision", play: true }), actionBtn("Decline", { type: "resolveDecision", play: false }));
      } else {
        for (const h of state.board.territories[pd.territory].neighbours.filter(n => state.territories[n].owner === you))
          rdiv.append(actionBtn("Retreat to " + h, { type: "resolveDecision", play: true, to: h }));
        rdiv.append(actionBtn("Stay and fight", { type: "resolveDecision", play: false }));
      }
    } else rdiv.style.display = "none";
    $("terr").textContent = Object.keys(state.territories).sort().map(t => t.padEnd(22) + (state.territories[t].owner || "-").padEnd(4) + state.territories[t].armies).join("\\n");
  }
</script>`;
