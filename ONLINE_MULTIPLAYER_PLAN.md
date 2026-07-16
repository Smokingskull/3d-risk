# Online Multiplayer — Design Plan

**Status:** proposal / not started. This is the last major roadmap item, gated on the
single-player game being complete (it now is: 42-territory board, campaigns, action cards,
Easy/Medium/Hard + Joshua AI). Nothing here is built yet — networking is greenfield.

**Scope is decided** (MVP + Stretch) — see §9 for the confirmed answers. The sections below have
been updated to match; §9 is the authoritative record of what's in/out.

---

## 1. Goals & scope

**Goal:** two-to-six humans play a real-time game of 3D Risk together over the internet, with
any empty seats optionally filled by CPUs (including Joshua). Same rules, board, campaigns and
cards as single-player — just with remote humans instead of hotseat.

**MVP (confirmed)**
- **2–6 players, private room code** (host creates, friends join). No matchmaking.
- **Anonymous** — display name + a reconnect token. No accounts.
- **Mixed humans + CPUs** (any difficulty incl. Joshua) in the same game.
- **In-memory only** — no persistence; a server restart ends in-progress games (acceptable at
  "handful of friends" scale).
- **Casual** — no turn clock; players take as long as they like.
- **In-game chat** (text).
- **Disconnect handling:** the game **pauses up to 5 minutes** for the player to reconnect. If they
  don't return, the **room owner chooses** to *end the game* or *replace them with Joshua* (CPU
  takeover — we already run the AI server-side). If the **owner** disconnects, pause 5 minutes for
  reconnect, then **end the game**.
- **Reveal on end** — at game over, reveal every player's secret cards + campaign objective, and show
  a **final ranking** (by territories held, then total army size).
- **Own Node WS server on the existing Hetzner VPS** — reuses the box already serving the site, so
  **no additional hosting cost** (see §5d/§8).

**Explicitly deferred to Stretch (not MVP):** accounts/login, persistence/save-&-resume,
configurable turn timers, spectators. (Never in scope for now: ranked/ELO, public matchmaking,
replays, mobile-specific work.)

**Stretch (planned direction, after MVP ships)**
- **Accounts & login** — friends lists and win/record history.
- **SQLite persistence** — save a game (with **all participants' agreement**) and resume it later.
- **Configurable per-game turn timer** — *None / 2 min / 4 min*, chosen at room setup.
- **Spectators** — join a room to watch (fog-limited or full, TBD).

The MVP is built to make the Stretch additive, not a rewrite: the auth/persistence/timer/spectator
seams are noted where they land, so nothing about the MVP boxes them out.

---

## 2. The core challenge: hidden information ⇒ authoritative server

3D Risk has **secret state**: each player's card hand, their secret campaign objective, and
**Misinformation** bluffs (a territory's displayed army count differs from the truth, per viewer).
Today the entire `GameState` lives in the browser, and the UI hides secrets only by *choosing not
to render them* (`perceivedArmies`, `viewerId` fog). That's fine for hotseat, but **fatal online**:
if we shipped the full state to every client (naive peer-to-peer or client-authoritative), any
player could read opponents' cards/objectives straight out of memory.

Therefore online multiplayer needs an **authoritative server** that:
- holds the one true `GameState`,
- **validates every action** with the engine before applying it (no trusting clients),
- **rolls the dice** (owns the RNG — clients can't fish for good rolls),
- sends each client only a **fog-of-war projection** of the state (their own secrets, opponents'
  hidden info stripped, Misinformation applied to army counts they see).

This is the one unavoidable architectural shift: the game currently runs 100% in the browser;
multiplayer moves the *authority* to a server while the browser becomes a view + input device.
(Determinism/lockstep P2P is deliberately **not** chosen — it can't hide information and is far more
fragile. Server-authoritative is simpler and secure.)

---

## 3. The key asset: the engine is already server-ready

`packages/engine` is pure, deterministic, plain-data, and UI-free. The server imports the **same
engine** the client uses — one rules implementation, no divergence. Directly reusable:

- `createGame(config)` — build the initial state (`game.ts`).
- `applyAction(state, action) → { state, events }` — pure, non-mutating; the authoritative step.
- `validateAction` / `isLegal` (`game.ts`) — reject illegal/cheating client intents.
- deterministic RNG via `rngSeed`/`rngCursor` + `rollDieAt` (`rng.ts`) — server owns the seed.
- `serializeGame` / `deserializeGame` (`scenario.ts`) — snapshot/restore for persistence & reconnect.
- `perceivedArmies(state, viewer, t)` and the Misinformation model (`types.ts`, `game.ts`) — the
  basis for per-viewer fog.
- `createAI(difficulty).decide(state)` / `decideReaction` (`ai/`) — **CPU seats run on the server**,
  so online games can include Joshua as an opponent with zero extra work.

**New engine work required:** a `projectStateForViewer(state, playerId)` that returns a redacted
`GameState` — opponents' `cards`/`campaign` removed, army counts replaced by `perceivedArmies` for
that viewer, deck contents hidden. This generalises the fog the UI already does ad-hoc into one
server-side function (and a matching lightweight "public view" for lobby/spectators later).

**Consumption note:** the engine is published as raw TS (`main: src/index.ts`, `type: module`). The
client bundles it via Vite; a Node server will need to either build the engine to JS or run via a TS
loader (tsx/esbuild). Small task, flag it early.

---

## 4. Target architecture

```
 Browser (React + R3F)                    Server (Node, new apps/server)
 ┌────────────────────────┐   WebSocket   ┌───────────────────────────────┐
 │ UI + GameSession        │ ◀───────────▶ │ Rooms/lobby                    │
 │  - LocalSession (today) │   intents ▶   │ Authoritative GameState        │
 │  - OnlineSession (new)  │   ◀ views     │  applyAction / validateAction  │
 │ renders a *view* only   │   ◀ events    │  RNG authority (dice)          │
 │ sends *intents* only    │               │  projectStateForViewer (fog)   │
 └────────────────────────┘               │  CPU seats via createAI         │
                                           │  reconnection tokens           │
                                           └───────────────────────────────┘
```

- **Transport:** WebSocket (turn-based, low-frequency, needs server→client push for other players'
  moves and reaction prompts). Not REST-polling.
- **Client sends intents** (`Action`s + lobby commands), never authoritative state.
- **Server broadcasts** each player their projected view + the event stream (so the globe animates
  attacks the same way it does locally, from `events`).

---

## 5. Components

### 5a. Server (`apps/server`, new workspace)
- **Lobby/rooms:** create room → 6-char code; join by code; assign seats (human/CPU + difficulty);
  the **room owner** (creator) starts. One `GameState` per room, held **in memory** (a `Map` of
  room→state); rooms are cleaned up on game end / all-left.
- **Game host:** receives an intent, checks it's from the seat whose turn/decision it is, runs
  `validateAction`; if legal, `applyAction`, then push new per-viewer views + events to all clients.
- **RNG authority:** server sets/advances the seed; dice never computed client-side.
- **CPU host:** for CPU seats, the server runs `createAI().decide` (the same call the client worker
  makes — fast, runs inline) on that seat's turn and applies it. Also used for **Joshua takeover** of
  a dropped human (below).
- **Reaction windows:** an attack can open a defender decision (Minefield / Tactical Retreat). The
  server prompts exactly that player and awaits their response, pausing the attacker. **Casual (MVP):
  no timeout** — it waits (subject to the disconnect pause). Mirrors the client's interactive-turn model.
- **Chat:** the server relays room chat messages (name + text) to all seats; kept in memory with the
  room, not persisted. Basic length/rate limits.
- **Reconnection & disconnect policy (MVP):**
  - Issue a **reconnect token** on join; on reconnect, re-send that player's current projected view +
    recent chat.
  - On a drop, **pause the game for 5 minutes** and notify the room. If the player returns, resume.
  - If they don't return within 5 min: the **room owner is prompted** to either **end the game** or
    **replace the seat with Joshua** (flip the seat to a CPU that plays on from the exact state).
  - If the **owner** drops: same 5-minute pause; on no-return the game **ends** (owner-only powers
    don't transfer in MVP — revisit with accounts at Stretch).
- **Game over — reveal & ranking:** on a win, send a final payload that **reveals every player's
  cards + campaign objective** and a **ranking** sorted by territories held, then total armies
  (computed from the true `GameState`, not a projection).

### 5b. Wire protocol (sketch — to be finalised)
- client→server: `createRoom`, `joinRoom{code,name}`, `setSeat`, `start`, `intent{action}`,
  `respondDecision{...}`, `leave`, `reconnect{token}`.
- server→client: `roomState{seats,phase}`, `view{projectedState}`, `events{[...]}`,
  `yourTurn`/`decisionRequest{...}`, `error{reason}`, `gameOver{winner}`.
- Version the protocol; validate every inbound message shape server-side.

### 5c. Client
- **`GameSession` abstraction (the key refactor):** today `apps/client/src/game/useHotseat.ts`
  owns the state *and* mutates it locally (`applyAndStore` → `applyAction`) *and* drives CPUs. Extract
  an interface — roughly `{ state/view, submit(action), onUpdate, ... }` — with two implementations:
  - `LocalSession` — current behaviour (hotseat + local CPU worker), no server.
  - `OnlineSession` — sends intents over WS, receives authoritative views/events, renders those.
  The UI (Globe, Hud, dialogs) should consume the session, not `applyAction` directly. This is the
  biggest client change and worth doing cleanly first (it also tidies single-player).
- **Lobby UI:** a screen to create/join a room, pick a name, see seats fill, and start — reusing the
  `ui/` primitives (Dialog, Button, Segmented) and the New Game seat controls.
- Rendering already works from a `GameState` + `events`; online just feeds it a projected state.

### 5d. Infra / deployment
- New long-running **Node process** on the existing Hetzner VPS (systemd unit), reverse-proxied by
  Caddy (WebSocket upgrade) at a subdomain/path — e.g. `wss://api.3drisk.iainwilson.uk` or `/ws`.
  TLS via Caddy/Let's Encrypt as with the site.
- **No additional hosting cost** (your condition on Q1): the process shares the VPS already running
  the site + Caddy. A single small Node server for a handful of concurrent friend-games uses
  negligible CPU/RAM — no new box, no managed service, no metered usage. (If we ever needed to scale
  to many public games that calculus changes, but that's explicitly out of scope.)
- Extend CI: a build/deploy for `apps/server` alongside the static client (`.github/workflows/`),
  with a **staging server** mirroring the staging site (branch-preview workflow, see
  `staging.3drisk.iainwilson.uk`).
- Config: the client needs the server URL per environment (prod vs staging vs local).

---

## 6. Suggested phasing (each phase shippable & verifiable)

0. **Spike** — a throwaway 2-tab local test: bare Node `ws` server hosting one hardcoded game,
   two browser tabs sending intents, server validating with the engine and broadcasting projected
   views. Proves the authoritative + fog model end-to-end before committing to structure. (~1–2 days)
1. **`projectStateForViewer` in the engine** + tests (opponents' cards/objectives/deck hidden,
   Misinformation applied). Pure, unit-testable, no networking.
2. **Client `GameSession` refactor** — decouple UI from `applyAction`; ship it in single-player
   (LocalSession) so it's proven before any netcode. No user-visible change.
3. **Server MVP** (`apps/server`) — rooms, host a game, validate/apply, per-viewer views, CPU seats,
   reaction windows, in-memory state. Integration-tested with simulated socket clients.
4. **Client OnlineSession + Lobby** — create/join by code, seat setup, play a real game online.
5. **Reconnection & disconnect policy** — reconnect tokens + resume view; the **5-min pause**, the
   **owner's end-or-replace-with-Joshua** choice, and **owner-leaves ⇒ end** flow.
6. **Chat** — room text chat (lobby + in-game), relayed by the server.
7. **Reveal & ranking on game over** — reveal all cards/objectives + final ranking screen (reuse the
   `ui/` primitives and the VictoryOverlay).
8. **Infra** — server systemd + Caddy + subdomain/TLS + CI + staging server.
9. **Hardening & polish** — error/edge handling, room lifecycle/cleanup, basic abuse/rate limits.
   (Casual = no turn timers in MVP.)

Each phase goes on its own feature branch → staging → main, per the established workflow.

### Stretch track (after MVP ships)
- **S1. Accounts & login** — identity, friends lists, win/record history. (Displaces anonymous names;
  the reconnect-token seam generalises to a session.)
- **S2. SQLite persistence** — durable rooms + **save-with-all-participants'-agreement** and resume
  later; survives server restarts. (Swap the in-memory room `Map` for a repository behind the same
  interface.)
- **S3. Configurable turn timer** — per-room *None / 2 min / 4 min*, enforced on turns and reaction
  windows (the MVP already routes both through the server, so this is a timeout + default-action).
- **S4. Spectators** — join-to-watch using a fog-limited (or full) projection; the per-viewer
  projection from §3 already supports a "spectator view".

---

## 7. Testing / verification
- Engine: unit tests for `projectStateForViewer` (no secret leaks; fog correct).
- Server: integration tests driving N in-process socket clients through full games (incl. reactions,
  CPU seats, illegal-intent rejection, reconnect) — reuse the engine's determinism to assert outcomes.
- Client: `OnlineSession` against a local test server; Playwright two-context test (two "players").
- Security check: assert a client's projected view never contains another seat's cards/objective.

---

## 8. Risks & unknowns
- **Client refactor blast radius:** `useHotseat` is monolithic; the `GameSession` seam touches most
  of the in-game UI. Doing it in single-player first (phase 2) de-risks this.
- **Reaction-window latency:** waiting on a remote human mid-attack needs solid timeout/default
  handling or games stall. Turn/decision timers likely required, not optional.
- **Ops burden:** we go from a static site (zero backend) to a stateful long-running service —
  monitoring, restarts (in-memory games lost unless persisted), and TLS/WS proxying to get right.
- **Engine-as-TS-source** on Node needs a build/loader step (minor).
- **Scale:** fine for friends; "many concurrent public games" would push toward persistence + horizontal
  concerns we're explicitly deferring.

---

## 9. Decisions (confirmed)

| # | Question | MVP | Stretch |
|---|----------|-----|---------|
| 1 | Hosting | **Own Node WS server** on the existing VPS — provided it adds **no cost** (it doesn't; §5d) | no change |
| 2 | Identity | **Anonymous** name + room code | **Accounts & login**, friends lists, win record |
| 3 | Persistence | **In-memory** only (no persistence) | **SQLite** — save (with all participants' agreement) & resume later |
| 4 | Disconnect | **5-min pause** to reconnect; then **owner picks end vs replace-with-Joshua**. Owner drops ⇒ 5-min pause ⇒ **end** | no change |
| 5 | Timers | **Casual** (no timer) | **Per-game: None / 2 min / 4 min** |
| 6 | CPUs online | **Mixed humans + CPUs** (incl. Joshua) | no change |
| 7 | Players / rooms | **2–6, private room code** | no change |
| 8 | Chat / spectators | **Chat: yes.** Spectators: no | **Spectators: yes** |
| 9 | End of game | **Reveal all** secrets + **ranking** (territories, then army size) | no change |
| 10 | Scale | **Handful of friends** | no change |

These are reflected throughout §1 and §5–§6. The build targets the MVP column; the Stretch column is
kept additive (auth/persistence/timer/spectator seams flagged in §6's Stretch track).

---

*Scope is locked for the MVP. Next step whenever you're ready: I'll turn this into a concrete
per-phase implementation plan (starting phase 0 spike → phase 1 `projectStateForViewer`) and run it
on feature branches → staging → main, as with the board and AI work.*
