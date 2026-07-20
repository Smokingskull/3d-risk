# 3D RISK — Architecture & Design Analysis

## 1. What it is, in one paragraph

3D RISK is a browser-based version of the board game RISK played on a rotatable 3D
globe. It's a **pnpm monorepo** with a hard architectural spine: a single **pure,
deterministic rules engine** (`packages/engine`) that is imported, unchanged, by three
consumers — the React/Three.js client (`apps/client`), the authoritative multiplayer
server (`apps/server`), and the CPU AI (which lives *inside* the engine package).
Because the engine is a pure function of `(state, action)` with all randomness derived
from a seed+cursor, every consumer runs identical code and can never disagree about what
happened. That single decision is the best thing about this codebase and everything else
hangs off it.

```
┌─────────────────────────────────────────────────────────────┐
│  packages/engine   (pure, deterministic, no DOM/network)     │
│  ─ types, actions, events                                    │
│  ─ game.ts        applyAction(state, action) → {state,events}│
│  ─ rng, cards, board, scenario, projection                   │
│  ─ ai/            createAI(difficulty).decide(state)         │
└───────────▲───────────────▲───────────────▲─────────────────┘
            │ imports        │ imports        │ imports
   ┌────────┴──────┐  ┌──────┴───────┐  ┌────┴──────────────┐
   │ apps/client   │  │ apps/server  │  │ ai.worker.ts       │
   │ React+R3F     │  │ ws + rooms   │  │ (client runs the   │
   │ 3D globe, HUD │  │ authoritative│  │  engine's AI off   │
   │ hotseat/online│  │ fog-of-war   │  │  the main thread)  │
   └───────────────┘  └──────────────┘  └────────────────────┘
```

**Roadmap status:** the README's build order (engine → client → AI → server →
persistence → learning) is essentially complete through step 4. Single-player (hotseat +
vs-CPU), scenarios, action cards, campaign mode, and online multiplayer all ship.
Persistence and learning-AI are the remaining unbuilt tracks.

---

## 2. The engine — the crown jewel

Everything of value is concentrated here, and it's genuinely well-built.

**Purity & determinism (`game.ts`, `rng.ts`).** `applyAction(state, action)` clones its
input (`cloneState`, game.ts:228), never mutates, does no I/O, and reads all randomness
from `state.rngSeed` + `state.rngCursor` via a **stateless hash** `randAt(seed, cursor)`
(rng.ts:26). Every die roll advances the cursor, so the reducer stays a pure function.
This is what lets the server own the dice, replays reproduce exactly, and the client run
the AI locally with confidence it matches the server.

**The state machine (`game.ts`, 836 lines).** Turn flow is
`reinforce → attack (⇄ occupy) → fortify → endTurn`. It implements the full authentic
ruleset: starting-army tables by player count (game.ts:156), continent bonuses,
escalating card-set bonuses (4,6,8,10,12,15,+5), forced trade at 5+ cards,
award-a-card-on-conquest, steal-cards-on-elimination, and win-by-elimination. Validation
and application are cleanly separated: `validateAction` returns a *reason string or null*
(game.ts:267), `isLegal` wraps it, and `applyAction` re-validates and throws
`IllegalActionError`. `listLegalActions` (game.ts:763) generates canonical moves for the
AI and UI.

**Two optional layers, cleanly bolted on:**

- **Campaign mode** — each player gets a secret objective (hold a country 3 turns / own a
  continent / assassinate a player); first to meet theirs wins. Checked at turn-end
  (game.ts:463).
- **Action cards** — six one-shot special cards with genuinely interesting mechanics,
  including **per-opponent fog-of-war** (Misinformation shows a fake army count until an
  opponent attacks) and **reactive decision windows** (`pendingDecision`) where a
  *defender* acts during the *attacker's* turn (Minefield, Tactical Retreat). This is the
  most sophisticated part of the rules and it's modeled well — the
  `pendingDecision`/`pendingOccupation` fields block all other actions until resolved.

**Fog-of-war projection (`projection.ts`).** `projectStateForViewer(state, viewer)`
returns a redacted `GameState` safe to send a player: opponents' hands masked (count
preserved, contents hidden), action cards and campaign objectives removed, army counts
replaced with `perceivedArmies` so bluffs read as real, and — critically — `deck`,
`rngSeed`, `rngCursor` all stripped so a client can never predict undrawn cards or dice.
This is a well-designed security boundary.

**Board generation (`scripts/build-classic.mjs`).** The board isn't hand-written — it's
*generated* from the GLB globe model's manifest (one gameplay territory per mesh, with
the manifest's adjacency), and validated at build time: symmetric adjacency, no isolated
territories, full graph connectivity (DFS), correct continent membership. Exits non-zero
on any problem. This keeps the 3D model and the rules provably in sync.

**Test coverage is strong on the engine:** `game.test.ts` (543 lines), plus dedicated
suites for cards, campaign, scenario, projection, rng, and AI — including full
CPU-vs-CPU games that must terminate with a winner.

---

## 3. The AI — better than the README admits

The AI (`packages/engine/src/ai/`, ~860 lines) is deterministic and reproducible, built
on **exact combat mathematics** rather than simulation: `conquestProbability(attackers,
defenders)` (battleOdds.ts) computes the true probability of taking a territory by
recursive convolution over the single-battle dice distribution, memoized. The AI reasons
about odds and *never peeks at the RNG*.

Four tiers, table-driven by a `KNOBS` object (attack threshold, whether it fortifies,
card aggressiveness, continent-awareness):

- **easy / medium / hard** — greedy heuristic policies of increasing sophistication
  (`policy.ts`).
- **joshua** (the top tier, a WarGames reference) — a **bounded expectimax-lite beam
  search** over attack sequences (`search.ts`, depth 3, beam 5, node budget 2500), with
  search-driven reinforcement placement. Full-game tests assert Joshua statistically
  beats hard and near-dominates easy.

Card use scales with difficulty (easy ignores cards; hard/joshua use all six, including
bluffing and tactical retreat). Reactive-card defence uses the *defender's* difficulty.

**Reconciling the README:** it says "MCTS + adaptive opponent-modelling still to come."
That's accurate — `search.ts` is expectimax/beam, **not** Monte Carlo tree search — but
the README *understates* what exists: there's real lookahead search (Joshua). Genuine
gaps: true MCTS, and any opponent-modelling/learning (the only "opponent model" today is
the single-strongest-opponent penalty in `evaluate.ts` plus Misinformation perception).

---

## 4. The client — one god-hook does everything

Stack: React 19 + `@react-three/fiber`/`drei` + Three.js 0.18, Vite build. The client is
a pure view/controller over the engine — it holds *no* rules logic.

**`Globe.tsx` (706 lines)** is the 3D renderer: loads the GLB, maps sanitized mesh node
names back to territory ids, injects a procedural "cracked earth" shader into every
material, raises land radially off the sphere, builds per-territory
outlines/skirts/floor slabs, paints territories by owner colour, handles hemisphere-aware
click/hover with a drag-vs-click discriminator, and animates camera focus glides. It's
impressive but does far too much in one file (a 225-line scene-setup `useMemo` that
mutates meshes; GLSL string-surgery coupled to Three's internal chunk names).

**`useHotseat.ts` (1007 lines)** is the heart — and the biggest liability. It's a
**god-hook** returning a ~70-field object consumed by nearly every component. It owns:
game lifecycle, mirroring the authoritative `GameState` into React state, the
step-by-step CPU turn loop, AI Web Worker management (with a synchronous fallback if the
worker dies), combat/engagement orchestration, reactive-card outcome popups (by
string-scanning the events array), fog-of-war viewer derivation, online session wiring,
the reinforce meter, *and* a ~115-line dev cheat console (`window.risk`). It leans
heavily on a **ref-shadows-state** pattern (8+ refs mirroring React state so stable
callbacks read current values) — each of which is a potential desync bug.

**The session seam (`session.ts`) is the client's cleanest abstraction:**
`createLocalSession` applies actions locally and returns events synchronously;
`createOnlineSession` sends intents to the server and receives pushed updates. But
online-vs-local `if (online)` branching leaks throughout `useHotseat` rather than being
fully owned by these two strategies.

**Networking (`net/connection.ts`)** is a thin `ws` wrapper with an outbox queue for
pre-open sends — but no reconnect/backoff and silent `onclose`/`onerror`, despite the
protocol defining a `reconnect` message. `net/protocol.ts` is a hand-copied duplicate of
the server's protocol types (drift risk, acknowledged in a comment).

---

## 5. The server — authoritative, hand-rolled

**Headline: it does not use Colyseus** (the README is stale). It's a bespoke `ws`
WebSocket server. `index.ts` runs one HTTP+WS server on port 8787; `rooms.ts` (463
lines) holds all logic in three in-memory `Map`s (rooms, conn→room,
reconnect-token→seat).

**The trust boundary is fundamentally sound:**

- Connection identity is a server-issued UUID.
- The actor is derived **server-side** (`pendingDecision.player ?? activePlayer`); an
  intent from any other seat is rejected ("not your turn").
- Every intent passes `isLegal(state, action)` **before** `applyAction` — the engine is
  the referee.
- Mid-game, each seat receives `projectStateForViewer` (fog applied per-viewer); the full
  state is revealed only at game-over.
- RNG seed/cursor are stripped from every projection, so clients can't predict dice.

It also handles reconnection (5-min pause with tokens), owner-drop →
end-or-replace-with-Joshua, CPU seats driven server-side on a timer, chat, ranking on
game-over, and a Joshua chat easter egg.

**Hardening status (all Tier-1 security work has since shipped):**

- ✅ **Runtime message validation** (#2) — `validate.ts` (`validateClientMsg`) checks every
  `ClientMsg` and the nested `Action` before dispatch; malformed frames and bad JSON are
  rejected. A `PROTOCOL_VERSION` handshake (a `?v=` query param) rejects mismatched clients.
- ✅ **Per-viewer event projection** (#3) — `projectEventsForViewer` withholds a
  Misinformation play from opponents (the one event that leaked hidden state); all other
  events remain public (their effects are observable anyway).
- ✅ **Server integration tests** (#4) — `rooms.hosting.test.ts` drives the handlers with
  fake connections + fake timers (turn-ownership, `isLegal` gating, reconnect/token,
  pause/resume, owner end-vs-replace, reaping), plus `projection.test.ts` and
  `validate.test.ts`.
- ✅ **Abuse hardening** (#5) — per-connection room cap (one live room per socket), chat
  rate-limit (8/10s per seat), an **opt-in** WS origin check (`MP_ALLOWED_ORIGINS`), and a
  ws ping/pong heartbeat that reaps dead sockets.
- ✅ **Idle turn/reaction timeout** (#6) — **opt-in** via `MP_TURN_TIMEOUT_MS`; auto-declines
  a stalled reaction or auto-ends an idle turn, so a connected-but-idle player can't hang a game.

**Remaining gaps:**

- **In-memory only.** All room/game state lives in module `Map`s — a restart loses every
  in-progress game. SQLite-backed persistence is the fix (#14); the engine already
  serializes cleanly (`serializeGame`).
- **Single-process / single-core AI** — see *Capacity & scaling* below.
- **Per-connection (not per-IP) room cap.** The cap keys on the socket, so many sockets can
  each still create a room; a per-IP / global backstop is tracked in #17.

### Capacity & scaling

The server is a **single Node process, single main thread**; `driveCpu` runs the AI's
`decide()` **synchronously** on that thread (there are no server-side worker threads — the
AI worker is client-only). So all AI across all rooms serialises onto **one core**,
regardless of how many the VPS has. That, not memory, is the binding constraint.

Benchmarked (6-player, action cards on, all-Joshua — the heaviest case) on a fast
Apple-Silicon dev core:

| Measure | Value |
|---|---|
| Joshua `decide()` — average | **~0.6 ms** |
| Joshua `decide()` — worst single call | **~8 ms** (worst event-loop block per move) |
| Mid-game `GameState` (serialized) | **~9 KB** |
| CPU pacing between CPU moves (`CPU_DELAY`) | 350 ms |

- **Memory is not the limit.** ~9 KB per room-state, and the board is a **shared singleton**
  (not copied per room — `getBoard` returns one instance, `cloneState` shares the reference),
  so thousands of rooms cost only hundreds of MB.
- **AI worst case:** at one `decide()` per active room per 350 ms, `350 / 0.6 ≈ ~570`
  continuously-active all-Joshua 6-player rooms saturate one core on dev hardware; de-rate
  ~2–3× for a typical VPS vCPU → **~200–300** such rooms. Beyond that it **degrades
  gracefully** — `decide()` calls queue and bot turns simply pace out slower; each call is
  ≤ ~8 ms, far too short to block networking or drop connections.
- **Realistic games are connection-bound, not CPU-bound.** A human consumes *zero* server
  CPU while thinking (their turn is just an idle timer); CPU is spent only on bot moves. So
  the practical ceiling is concurrent WebSocket count — **low-thousands of players → a few
  hundred rooms** — comfortably under the AI worst case.
- **Scaling lever (unbuilt, no current need):** shard rooms across multiple Node
  processes/workers behind Caddy — each adds a core of AI. The engine's determinism and
  per-room isolation make this clean.

*(Measured on dev hardware; treat the VPS de-rate as a rough factor, not a guarantee. To
re-measure, time `createAI("joshua").decide()` over full 6-Joshua games.)*

---

## 6. Build, deploy, tooling

Clean and appropriate for the scale. Strict TypeScript everywhere (`strict`,
`noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch`). Vitest for tests. Three
GitHub Actions workflows deploy on push to `main`: the static client → `/srv/3drisk/`, a
staging site → `/srv/3drisk-staging/`, and an esbuild-bundled server → a `3drisk-mp`
systemd service, all on a Hetzner VPS behind Caddy. The multiplayer server URL is baked
into the client at build time via `VITE_MP_SERVER`.

---

## 7. Scenario file structure

A scenario is a **hand-authored, versioned JSON snapshot of a `GameState` with the board
omitted** — the board is large and fully reconstructable from `options.boardMode`, so it
never travels in the file. There are 12 of them in
`apps/client/src/scenarios/*.classic.json`, plus an engine test fixture at
`packages/engine/src/scenarios/example.classic.json`.

### Two layers of the format

The engine defines the shape in `scenario.ts`:

- **`serializeGame`** emits a *full* canonical snapshot (every field present) — used to
  capture a live game.
- **`deserializeGame`** is deliberately **tolerant**: it accepts a *partial, hand-written*
  object, fills sensible defaults, rebuilds the board via `getBoard()`, validates
  everything, and returns a real `GameState` ready for `applyAction`. This tolerance is
  what lets a human author a scenario by writing only the interesting fields.

### The two kinds of fields

A scenario file mixes **engine fields** (consumed by `deserializeGame`) with
**presentation fields** (consumed only by the client's `scenarios/index.ts`, and ignored
by the engine):

**Presentation-only (client menu):**

| Field | Purpose |
|---|---|
| `name` | Scenario title in the Scenarios menu |
| `description` | The briefing paragraph |
| `difficulty` | Menu rating: `easy`/`medium`/`hard`/`very-hard` (sorts the list) |
| `difficultyNote` | One-line strategic hint under the rating |

**Engine fields (`ScenarioStateInput`):**

| Field | Required? | Default & notes |
|---|---|---|
| `version` | optional | Must be ≤ `SCENARIO_VERSION` (currently 1) or load fails |
| `options` | **required** | `boardMode` (default `"classic"`), `fortifyRule` (`"connected"`), `cardsEnabled` (`true`), `campaign` (`false`), `actionCardsEnabled` (`false`) |
| `players` | **required (≥2)** | Each needs `id`, `name`, `color`, `kind`; may add `difficulty`, `eliminated`, `cards`, `actionCards`, `campaign`. Duplicate ids rejected. |
| `territories` | **required** | Must map **exactly** the board's 42 territories — no missing, no unknown. Each has `owner` (or `null`) and `armies`. Unowned must be 0 armies; owned must be ≥1. |
| `activePlayer` | optional | Defaults to first non-eliminated player; must not be eliminated |
| `phase` | optional | `reinforce`/`attack`/`fortify`, default `reinforce` |
| `turn` | optional | Default 1 |
| `reinforcementsRemaining` | optional | Auto-computed from `reinforcementsFor()` if in reinforce phase |
| `pendingOccupation`, `pendingDecision` | optional | Validated for adjacency/ownership if present |
| `misinformation` | optional | Per-territory `{ fake, revealedTo[] }` |
| `conqueredThisTurn`, `fortifyAnywhere`, `setsTradedIn`, `winner` | optional | Sensible defaults |
| `deck`, `discard` | optional | **If `deck` omitted, it's auto-filled**: the full deck minus every card already in a hand or discard, shuffled from `rngSeed` |
| `rngSeed`, `rngCursor` | optional | Default seed 1, cursor 0 |

### The `kind` trick (why files have no `kind`)

The scenario files list players with `difficulty` but **no `kind`** — yet
`deserializeGame` requires `kind`. The client's `scenarios/index.ts` bridges this: a
scenario's players are treated as *seats*. When you pick a scenario and choose which
seat(s) you'll play, `build(humanIds)` injects `kind: "human"` for your chosen seats and
`kind: "cpu"` for the rest, using each seat's `difficulty` as its AI level. So the same
file plays as any faction. `defaultHuman` is the scenario's `activePlayer`.

### What the 12 scenarios actually look like

They're remarkably uniform, which is a design strength (easy to author and validate): all
start at **turn 1, reinforce phase**, no explicit deck (auto-filled), `cardsEnabled:
true`, and every territory at 2 armies except the player's own (weighted higher). 11 of
12 are **campaign** scenarios with per-player secret objectives themed to history
(Napoleon must hold all of Europe; Britain safe across the Channel bankrolls his
enemies). The one exception, **ww2-axis** ("very-hard"), is a straight elimination game
with no campaign objectives — an intentional variety point. None use action cards (by
design — action cards are never in scenarios).

**A minimal hand-authored scenario** is therefore just: `options`, `players`
(id/name/color/difficulty), `activePlayer`, and all 42 `territories`. Everything else
defaults.

---

## 8. Improvements, now that features are in place

Ordered by value. These are now tracked as GitHub issues on `Smokingskull/3d-risk`.
**Status: Tier 1 is complete** — all five items below shipped as #2 (validation), #3 (fog
leak), #4 (server tests), #5 (abuse hardening) and #6 (idle timeout); see §5. Tier 2 and
Tier 3 remain open (plus follow-ups #16 docs, #17 per-IP cap). The list is kept here for
context.

### Tier 1 — correctness & security (✅ done — #2–#6)

1. **Server-side runtime message validation.** Add a schema layer (zod or hand-rolled)
   for every `ClientMsg` at `index.ts:44-73`, and add a protocol version field. Today
   only `JSON.parse` guards the boundary. *(This is the single most important gap — it's
   a live, internet-facing server.)*
2. **Audit & fix the events-channel fog leak.** `broadcastGame` sends identical `events`
   to all seats while only *state* is projected (`rooms.ts`). Add per-viewer event
   filtering or an explicit public-event allowlist, and add a **`projection.test.ts`**
   plus a security test asserting a projected view never contains another seat's
   cards/objective/deck/seed.
3. **Server integration tests.** There's essentially no coverage of the networking
   surface. Add in-process multi-socket tests for turn-ownership rejection, illegal-intent
   gating, reconnect/token flow, pause/resume, and owner end-vs-replace. This is the
   biggest quality gap in the repo.
4. **Basic abuse hardening.** Per-connection room cap, chat rate-limit (length cap alone
   exists), WS origin check, and a ws ping/pong heartbeat so dead sockets are reaped.
5. **Reaction-window / turn stall guard.** A human with an open defender decision (or just
   a slow turn) can hang an online game indefinitely; only a full disconnect (5-min
   pause) bounds it. Add an optional per-decision/turn timeout that auto-declines/auto-ends.

### Tier 2 — maintainability (the two god-files)

6. **Break up `useHotseat.ts` (1007 lines).** Split by concern into focused hooks:
   `useAiWorker`, `useCpuLoop`, `useEngagement` (combat), `useOnlineSession`,
   `useReinforceMeter`, and move the dev console out entirely. Stop returning a 70-field
   object.
7. **Replace the ref-shadows-state pattern.** 8+ refs in `useHotseat` (and `Globe`'s
   `refs.current` snapshot) mirror React state so callbacks see current values — each a
   desync risk. Consider a reducer or `useSyncExternalStore` over the `GameSession` so
   there's one source of truth.
8. **Make `applyUpdate` event handling declarative.** It currently string-scans the events
   array (~100 lines) to fire popups/combat feedback; every new engine event means
   editing it. Move to a declarative event→UI-effect map, reusing `gameLog.describe`.
9. **Extract Globe's non-React code.** Pull the procedural texture/geometry utilities and
   the 225-line setup `useMemo` into a plain module. The GLSL `.replace` surgery is
   coupled to Three's internal chunk names — wrap/isolate it so a Three upgrade doesn't
   silently break rendering.
10. **De-duplicate.** Kill the triplicated AI actor-selection logic
    (`useHotseat.nextAiAction`, `ai.worker.ts`, CPU-loop inline) via one shared
    `decide(state)`; extract the shared board helpers duplicated between `policy.ts` and
    `search.ts`; and **promote `protocol.ts` to a shared package** (`packages/protocol`)
    instead of the client/server hand-copy.

### Tier 3 — polish & the next roadmap steps

11. **Reconcile the docs.** README says Colyseus (unused → `ws`);
    `ONLINE_MULTIPLAYER_PLAN.md` says "not started" though the MVP is largely shipped;
    room codes are 4 chars, not the 6 the plan states.
12. **Persistence (roadmap step 5).** The engine already serializes perfectly
    (`serializeGame`) and the server state is a single object — the seam for a
    SQLite-backed resumable game is small and would fix the restart-loses-everything
    limitation.
13. **AI depth (roadmap step 6).** Strengthen `evaluate.ts` (it ignores
    connectivity/border-exposure and models only one opponent by territory *count*), and
    if you want the README's "MCTS," Joshua's expectimax is the natural upgrade point. Add
    isolated unit tests for `evaluate`/`planAttack` so tuning weights doesn't rely on
    slow, seed-sensitive full-game win-rate tests.
14. **Networking robustness on the client.** `connection.ts` has no reconnect/backoff and
    swallows `onclose`/`onerror`, even though the protocol already defines `reconnect`.
    Wire it up.
15. **Minor consistency.** Only the tutorial toggle is persisted; auto-rotate/board-mode
    live in memory — persist them the same way. Dev tooling (`window.*` assigned during
    render in `App.tsx`, per-frame `window.__camDir` in Globe) should be gated behind a
    dev flag.

---

## 9. Overall assessment

This is a well-architected project with an unusually disciplined core. The pure
deterministic engine shared verbatim across client/server/AI is textbook, and the
fog-of-war + authoritative-server security model is *conceptually* right. The two real
risks are (a) the server's thin input-validation/test coverage now that it's exposed
online, and (b) two oversized client files (`useHotseat`, `Globe`) that concentrate
complexity. Tier 1 addresses the first; Tier 2 addresses the second. Neither is a
redesign — the bones are good.

**Update (v1.1.x):** Tier 1 is now complete — the server has runtime message validation +
a protocol version, per-viewer event projection, an integration test suite, abuse
hardening, and an opt-in idle timeout (#2–#6; see §5 and *Capacity & scaling*). The
remaining risk (b) — the two oversized client files — is Tier 2 and still open.
