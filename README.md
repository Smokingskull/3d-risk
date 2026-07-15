# 3D RISK

A web-based 3D-globe take on the board game RISK.

## Monorepo layout

```
packages/engine    Pure, deterministic TypeScript rules engine (shared by client, server, AI)
apps/client        Vite + React + React-Three-Fiber front end (the 3D globe)
```

Future packages (see the build order below): `apps/server` (Colyseus authoritative
multiplayer), and an AI module inside `packages/engine`.

## Getting started

```bash
pnpm install
pnpm dev          # starts the client on http://localhost:5173
```

Set up players and board mode from the start menu. Rotate the globe by dragging,
hover a country to see its name and army count, and click a country to act on it —
deploy, attack, or fortify, depending on the current phase.

## The GAME box (in-game HUD)

The top-left **GAME** box drives the turn and makes RISK's turn structure explicit:

- **Title** shows the turn number — *Game — Turn N*.
- **Phase rail** — a Reinforce → Attack → Fortify tracker: completed phases dim,
  the current one is highlighted, upcoming ones stay faint, so where you are in the
  turn is always visible.
- **Reinforce meter** — during Reinforce, a progress bar with an *X/Y placed*
  count. All reinforcements must be placed before you can attack, and the total
  grows if you trade a card set mid-phase.
- **Trade banner** — holding 5+ cards shows a prominent banner with a **Trade
  cards** button (trading is mandatory before deploying) that opens the card dialog
  straight from the box.
- **End turn** — available throughout Attack and Fortify, so you can end your turn
  at any point after reinforcing (attacking and the single fortify move are both
  optional).
- **At-a-glance stats** — territories, total armies, continents held, and next-turn
  army income for the active player.
- **Rotate-lock** — the square toggle in the footer (beside Options) locks the
  globe to rotate-only, so dragging never selects a country.

The full move history is recorded as you play and is available from the win/loss
screen via **View game log**, grouped into per-turn sections with player names.

## The game board asset

`apps/client/public/assets/models/transparent_country_globe_gameboard.glb` is a glTF 2.0 binary
containing **177 country meshes**, each a named node (Natural Earth country names)
under a single `world` root. No materials are baked in — the client assigns colours
per country at runtime.

## Deployment

The client is a static SPA hosted on the Hetzner VPS behind Caddy, served at
**`3drisk.iainwilson.uk`**. Pushing to `main` runs `.github/workflows/deploy.yml`,
which typechecks, tests, builds `apps/client`, and rsyncs `apps/client/dist/` to
`/srv/3drisk/` on the VPS.

One-time setup (owner-only, needs the Smokingskull / Cloudflare / VPS accounts):

1. **Create the repo** — empty public `Smokingskull/3d-risk` on GitHub, then push
   (remote already set to the `github.com-smokingskull` SSH alias).
2. **Repo secrets** (Settings → Secrets → Actions), same as `iainwilson.uk`:
   `VPS_HOST=167.233.119.140`, `VPS_USER=iain`, `VPS_SSH_KEY=<deploy private key>`.
3. **DNS** — Cloudflare A record `3drisk` → `167.233.119.140` (DNS-only / grey cloud).
4. **Caddy** — append `deploy/3drisk.Caddyfile` to `/etc/caddy/Caddyfile` on the VPS,
   then `sudo systemctl reload caddy` (Let's Encrypt issues the cert automatically).

After that, every push to `main` redeploys.

### Staging deploy (branch previews)

Staging is a **separate** site so production is never touched while previewing
changes. `.github/workflows/deploy-staging.yml` builds and rsyncs to
`/srv/3drisk-staging/`, served at **`staging.3drisk.iainwilson.uk`**. It shares
nothing with production but the VPS.

Staging tracks `main` by default. To preview a large feature branch, point staging
at it by setting the `branches:` filter in `deploy-staging.yml` to that branch;
each push then deploys to staging without touching production. Revert the filter
back to `main` when the branch merges.

The staging site's DNS + Caddy are already set up (Cloudflare A record
`staging.3drisk` → `167.233.119.140`, DNS-only; `deploy/3drisk-staging.Caddyfile`
appended to `/etc/caddy/Caddyfile`), so no per-branch infra work is needed.

## Build order (roadmap)

1. **Engine** — RISK rules as a pure deterministic module + tests. _(done: types, RNG,
   board data, and the reinforce/attack/fortify state-machine with cards — 32 tests)_
2. **Globe client** — load GLB, colour/highlight countries by name, local hotseat. _(done:
   World/Classic modes, colour-by-owner, army labels, phase-driven clicks + HUD)_

### Rules engine

`applyAction(state, action)` is a pure, deterministic reducer (all randomness comes
from the state's seed + cursor), so the client, server, and AI run identical code
and always agree. Key exports from `@risk3d/engine`: `createGame`, `applyAction`,
`validateAction` / `isLegal`, `listLegalActions`, plus selectors
(`reinforcementsFor`, `ownsContinent`, `pathExists`, …). Turn flow is
reinforce → attack (⇄ occupy) → fortify, with full RISK cards (escalating set
bonuses, award-on-conquest, forced trade at 5+, steal-on-elimination). Run tests
with `pnpm --filter @risk3d/engine test`.

### Board data

`packages/engine/src/data/` holds the board. Land adjacency is **derived from the
mesh geometry** (adjacent Natural Earth countries share exact border vertices) by
`scripts/build-board.mjs`, then merged with hand-authored continents
(`world.continents.json`) and sea routes (`world.searoutes.json`). Regenerate with:

```bash
pnpm --filter @risk3d/engine build:board
```

The generated board JSON is validated at build time and should not be hand-edited —
edit the source data and rerun. Two board modes ship:

- **World** — all 177 countries, 6 continents, land adjacency from geometry + curated
  sea routes. Build: `build:board`.
- **Classic** — a classic-*style* board of ~39 **regions** that group **all 177
  countries** (North Africa, Scandinavia, the Middle East, Central America, …), so
  the whole globe is in play with no inert areas. Regions carry a `members` list of
  the country meshes they cover; the client renders each region as one territory
  (single colour + one army label). Continents/bonuses and hand-curated adjacency
  (`classic.regions.json` + `classic.adjacency.json`) follow classic choke points.
  Single-country classic splits (Russia, USA) stay whole since a mesh can't be cut.
  Build: `build:classic`.

Rebuild both with `pnpm --filter @risk3d/engine build:boards`. Load either via
`getBoard("world" | "classic")` from `@risk3d/engine`.
3. **AI** — heuristic → MCTS in a Web Worker; single-player vs CPU. _(done: easy/medium/hard
   deterministic policies + exact combat odds, run in a Web Worker; MCTS + adaptive
   opponent-modelling still to come)_
4. **Server** — Colyseus authoritative multiplayer; mixed local + remote sessions.

### AI

`packages/engine/src/ai/` holds the CPU brains: `battleOdds.ts` (exact
`conquestProbability` from dice recursion — the AI reasons about odds, never peeks
at the RNG), `evaluate.ts` (position scoring), and `policy.ts` (`createAI(difficulty)`
+ `planTurn(state)`). All deterministic, so CPU turns are reproducible and tested,
including full CPU-vs-CPU games that terminate with a winner. In the client the AI
runs in `apps/client/src/game/ai.worker.ts` off the main thread; seats are chosen in
the start menu (Human / Easy / Medium / Hard, any mix).
5. **Persistence** — accounts, resumable games, move-log archive.
6. **Learning** — per-opponent modelling, then optional self-play RL.

## Credits

UI icons are from [game-icons.net](https://game-icons.net), licensed
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Individual authors:
Lorc, Delapouite, sbed, quoting, and John Colburn. Icons have been recoloured and
had their background stripped for use in the interface.
