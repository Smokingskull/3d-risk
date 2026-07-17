# Interaction & player-management cleanup — plan

Cleaning up the in-game HUD so the **GAME box**, **PLAYERS box**, **Campaign button**
and **ATTACK (combat) box** all behave correctly and consistently across the three
play modes. This is a client-only change (`apps/client/src`); no engine or server work
is expected.

## Terminology (used throughout)

- **Current player** = `game.activePlayer` — whoever's turn it is (human or CPU).
- **Local seat** = the seat *this screen* represents:
  - **Solo** (`!online`, one human): the human's seat — **fixed**, even during CPU turns.
  - **Online** (`online`): `hs.yourSeat` — **fixed**.
  - **Local hotseat** (`!online`, ≥2 humans): the current player **if it's a human**, otherwise **none** (empty — e.g. during a CPU turn).
- **Active-local-human** ("my turn") = the current player is *both* human *and* controllable here.
  This is the existing `myTurn` in `Hud.tsx` (`online ? active === yourSeat : !isCpu`) and
  `isHumanTurn` in `useHotseat.ts`. Reused as-is.

The three modes are distinguished by `hs.online` + human count
(`game.players.filter(p => p.kind === "human").length`).

## Current state (what exists today)

- `Hud.tsx` — the **GAME box** (`.panel`). Always renders the phase bullet/name from
  `active` (current player), always renders `<PhaseRail>`, and shows phase hint rows
  only when `myTurn`. CPU turns show a "🤖 … is thinking" line; online other-human
  turns show a small "Waiting for …" hint. The **Campaign button** is in the footer,
  shown only when `game.options.campaign && !isCpu`.
- `CampaignDialog.tsx` — reads `game.activePlayer` to decide *whose* campaign to show.
- `PlayersPanel.tsx` — right-hand roster; highlights the active row; meta line is
  "CPU · <diff> · N cards" / "Human · N cards". No "what are they doing" status.
- `CombatModal.tsx` — the **ATTACK box**. Renders only when `hs.engagement` is set,
  which only happens when the **local human initiates** an attack (`attackTarget`).
  Full action buttons (Roll / Attack-till-resolved / Air Strike / Retreat).
- `DecisionPrompt.tsx` — defender reactive-card popups (Minefield / Tactical Retreat),
  already gated to the human decider (and to `yourSeat` online). Doesn't name the
  defender, so in hotseat it's unclear *who* is being asked.
- `useHotseat.ts` — owns `engagement`, `lastCombat`, `combatSeq`; `applyUpdate` already
  feeds combat dice/notes from events, but only for the local player's own engagement.
- Server (`rooms.ts`) broadcasts the **same `events` array to every seat** (only *state*
  is fog-projected), so a defender client *does* receive `attacked` events with dice —
  the online spectator-defence view is feasible with no server change.

## Requirements → behaviour matrix

| Element | Solo | Local hotseat | Online |
|---|---|---|---|
| **Campaign button** | Always enabled → local human's campaign | Enabled only when current player is human → that human's campaign | Always enabled → your seat's campaign |
| **GAME box bullet + name** | Fixed: local human | Active human, else **empty** | Fixed: your seat |
| **REINFORCE/ATTACK/FORTIFY + hints** | Only when human's turn; else large "Waiting for <name>…" | Only when a human is current; else large "Waiting…" | Only when it's your turn; else large "Waiting…" |
| **PLAYERS box active-row status** | "Reinforcing…/Attacking…/Fortifying…" | same | same |
| **ATTACK box (own attack)** | Yes, full controls | Yes, full controls | Yes, full controls |
| **ATTACK box (defending, read-only)** | Yes — live view, no buttons | **No** | Yes — live view, no buttons |
| **Defender reactive-card popups** | Yes | Yes, **naming the defender** | Yes |
| **"Attack till resolved"** | Yes | Yes | **Not offered** (already the case) |

## Phased implementation

Following the usual working style: land each phase on its own, commit at the boundary,
check in before moving on.

### Phase 1 — "Seat perspective" derivation (foundation, no visible change)
Add derived values so the UI stops reading `game.activePlayer` for "who am I". In
`useHotseat.ts` (exposed on `Hotseat`), or a tiny helper:
- `localSeat: PlayerId | null` per the definition above.
- Keep/`export` `isHumanTurn` (already there) as the "my turn" gate.
- Optionally `humanCount` / a `mode` discriminant for readability.

Everything below consumes these; low risk, unblocks the rest.

### Phase 2 — Campaign button + dialog
- `Hud.tsx`: show the button whenever `localSeat != null` (always in solo/online;
  hotseat only when the current player is human). Drop the `!isCpu` gate.
- `CampaignDialog.tsx`: take an explicit `playerId` prop (= `localSeat`) instead of
  reading `game.activePlayer`, so solo shows the human's campaign even during a CPU turn.
- Keep the solo auto-open on game start, keyed off `localSeat`.

### Phase 3 — GAME box restructure
- Bullet + name (`.turn`): render `localSeat`'s colour + name; when `localSeat` is null
  (hotseat, no active human) render an empty/placeholder bullet to signal "no local
  active human".
- Gate `<PhaseRail>` + all phase hint rows + the mandatory-trade banner behind `myTurn`.
- When **not** `myTurn`: render a single large, centred **"Waiting for {current
  player name}…"** in place of the rail + hints (folds in today's CPU "thinking" line
  and the small online "Waiting…" hint).
- `TurnStats`: follow `localSeat` (hide when null). *(see Q2)*

### Phase 4 — PLAYERS box active-row status
- `PlayersPanel.tsx`: on the active row (when `isActive && !game.winner`), show a short
  status derived from `game.phase`: **Reinforcing… / Attacking… / Fortifying…** —
  alongside/under the name. No counts or specifics. Applies to every current player in
  all modes (human or CPU).

### Phase 5 — ATTACK box: read-only defence view (solo + online only)
- `useHotseat.ts`: detect an **incoming** attack on `localSeat`'s territory in
  `applyUpdate` (an `attacked` event whose target was owned by `localSeat`), and open a
  **defender engagement** that reuses the existing `lastCombat`/`combatSeq` animation
  path. Tag engagements with a role (`"attacker" | "defender"`).
  - **Suppress in hotseat** (defence view is solo/online only).
  - Close the defence view on: territory captured (brief "captured", then close),
    the attacker's phase leaving `attack` (`phaseChanged`/`turnEnded`), or an idle
    timeout with no further attack. *(see Q3)*
- `CombatModal.tsx`: in defender role, hide all action buttons (Roll / Attack-till-
  resolved / Air Strike / Retreat) and show a "Defending {territory}…" framing; keep
  the dice, odds, and result line as a live spectator view.

### Phase 6 — Defender popups name the player (hotseat clarity)
- `DecisionPrompt.tsx`: include the **defender's name** (and keep the attacker's) so in
  hotseat it's clear whose decision it is, e.g. "{Defender} — {Attacker} took {X}. Lay a
  minefield?" *(see Q6 for wording)*
- Sanity-check the `ActionOutcome` popup text (`useHotseat.applyUpdate`) in hotseat,
  where "you/your" is framed from `viewerId` (last human); make sure a defender's result
  reads correctly for whoever just acted.

## Test / verification
- Manual: run each mode (solo, 2-human hotseat, online with a second tab) and walk
  Campaign / GAME box / PLAYERS status / an attack in both directions.
- Scenarios (`?scenario=…`) + the dev `__risk` hook can drive deterministic states for
  screenshots of the waiting state and the read-only defence view.

---

## Decisions (answers, 2026-07-17)

1. **Waiting flavour** — keep the Joshua/WOPR flavour for the Joshua tier; plain
   "Waiting for {name}…" otherwise.
2. **TurnStats** — follow the local seat; **hide when there's no active local human**.
3. **Defence view closes on capture.** Immediate close, *unless* a minefield can be
   played (a defender decision window is open) — then hold until that resolves.
4. **Defence pacing** — animate each `attacked` event **as it happens** (a fast CPU
   shows a flurry; no artificial pacing).
5. **PLAYERS status** — the gerund just indicates the **phase** the current player is
   in; no specifics (the game report has the detail).
6. **Hotseat popup wording** — the "{Defender} — {Attacker} took {X}…" lead-in is fine.
7. **Terminology confirmed** — current player ≠ the person at the screen. Solo/online
   have one permanent human at the screen; hotseat may have several sharing one machine,
   so the UI must be careful what it shows and when.

## Original questions

1. **Waiting message flavour** — for a CPU current player, keep the WOPR/Joshua flavour
   ("…is thinking… *Shall we play a game?*") as a subtitle under the big "Waiting for
   {name}…", or make it plain "Waiting for {name}…" everywhere regardless of human/CPU?

2. **TurnStats in the GAME box** — the PLAYERS box already shows everyone's
   territory/army/continent counts. Should the GAME box `TurnStats` strip follow the
   **local seat** (and hide when there's no active local human), or keep showing the
   **current player's** stats always? (I've assumed: follow local seat, hide when none.)

3. **Read-only defence view — when does it close?** I plan to close on capture /
   attacker's phase ending / idle timeout. Is an idle timeout acceptable, and any
   preferred duration (e.g. ~2s of no new dice)? Also: should Air Strike / Minefield
   *results* against you surface inside this defence box, or stay as the existing
   separate outcome popups?

4. **Defence view pacing** — online the attacker rolls one exchange at a time (nice and
   watchable); solo a CPU may fire several quickly. OK to just animate each `attacked`
   event as it arrives (so a fast CPU shows a quick flurry), rather than pacing them?

5. **PLAYERS status granularity** — you said no specifics (no army counts). During a
   defender's reactive-card window or the post-capture "move armies in" step, should the
   attacker's status still just read "Attacking…", or is that fine to leave as-is?

6. **Hotseat popup wording** — for the defender-naming in reactive popups, is a lead-in
   like **"{Defender} — {Attacker} took {territory}. Lay a minefield?"** the right tone,
   or would you prefer it phrased differently?

7. **Terminology check** — confirming I've read you right: "current player" = whoever's
   turn it is; "local active player" = the seat at this screen (which in solo/online is
   fixed to you, and in hotseat is the active human or empty). Phase 1 encodes exactly
   that.
