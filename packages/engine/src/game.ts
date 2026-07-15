/**
 * The RISK rules state-machine.
 *
 * `applyAction(state, action)` is a pure function: it never mutates its input,
 * does no I/O, and draws all randomness from the state's seed + cursor. Same
 * (state, action) → same result, so the client, server, and AI run identical
 * code and always agree.
 */
import type { Action } from "./actions.js";
import { buildDeck, isValidSet, setBonus, validSetsInHand, WILDS_BY_MODE } from "./cards.js";
import type { GameEvent } from "./events.js";
import { getBoard } from "./board.js";
import { mulberry32, rollDieAt, shuffle } from "./rng.js";
import type {
  ActionCardType,
  BoardDefinition,
  BoardMode,
  CampaignKind,
  Card,
  ContinentId,
  GameState,
  Player,
  PlayerId,
  TerritoryId,
} from "./types.js";

/** The action-card deck: two of each of the six types (dealt 2 per player). */
export const ACTION_CARD_TYPES: ActionCardType[] = [
  "troopTransport",
  "airStrike",
  "misinformation",
  "antiAircraft",
  "minefield",
  "tacticalRetreat",
];

export class IllegalActionError extends Error {
  constructor(reason: string) {
    super(`Illegal action: ${reason}`);
    this.name = "IllegalActionError";
  }
}

/** Force a player to hold ≥5 cards before they may place reinforcements. */
const FORCED_TRADE_AT = 5;

export interface GameConfig {
  players: Array<Pick<Player, "id" | "name" | "color" | "kind" | "difficulty">>;
  /** Which prebuilt board to use (ignored if `board` is supplied). Default "world". */
  boardMode?: BoardMode;
  /** Provide a board directly (for tests / custom maps). Overrides boardMode. */
  board?: BoardDefinition;
  seed: number;
  fortifyRule?: "connected" | "adjacent";
  cardsEnabled?: boolean;
  /** Campaign mode: assign each player a secret objective; first to meet it wins. */
  campaign?: boolean;
  /** Action cards mode: deal 2 special one-shot cards per player. Default false. */
  actionCardsEnabled?: boolean;
}

/** Number of consecutive owned turn-ends needed to win a "country" campaign. */
const COUNTRY_HOLD_TURNS = 3;

/** Assign each player a random secret objective (deterministic via rng). Country
 * targets are never a territory the player starts owning. */
function assignCampaigns(
  players: Player[],
  territories: GameState["territories"],
  board: BoardDefinition,
  rng: () => number,
): void {
  const kinds: CampaignKind[] = ["country", "continent", "assassination"];
  const continentIds = Object.keys(board.continents);
  const allTerritories = Object.keys(territories);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  for (const p of players) {
    const kind = pick(kinds);
    if (kind === "country") {
      const notOwned = allTerritories.filter((t) => territories[t].owner !== p.id);
      p.campaign = { kind: "country", territory: pick(notOwned), heldTurns: 0 };
    } else if (kind === "continent") {
      p.campaign = { kind: "continent", continent: pick(continentIds) };
    } else {
      p.campaign = { kind: "assassination", target: pick(players.filter((o) => o.id !== p.id)).id };
    }
  }
}

// --- selectors --------------------------------------------------------------

export function playerById(state: GameState, id: PlayerId): Player {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`No such player: ${id}`);
  return p;
}

export function territoriesOf(state: GameState, id: PlayerId): TerritoryId[] {
  return Object.keys(state.territories).filter((t) => state.territories[t].owner === id);
}

export function ownsContinent(state: GameState, id: PlayerId, continent: ContinentId): boolean {
  return state.board.continents[continent].territories.every(
    (t) => state.territories[t].owner === id,
  );
}

/** Armies the player would receive at the start of a reinforce phase. */
export function reinforcementsFor(state: GameState, id: PlayerId): number {
  const owned = territoriesOf(state, id).length;
  let armies = Math.max(3, Math.floor(owned / 3));
  for (const continent of Object.values(state.board.continents))
    if (ownsContinent(state, id, continent.id)) armies += continent.bonus;
  return armies;
}

/** Whether `to` is reachable from `from` through territories all owned by `owner`. */
export function pathExists(
  state: GameState,
  owner: PlayerId,
  from: TerritoryId,
  to: TerritoryId,
): boolean {
  if (from === to) return false;
  if (state.territories[from].owner !== owner || state.territories[to].owner !== owner)
    return false;
  const seen = new Set<TerritoryId>([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    for (const n of state.board.territories[cur].neighbours) {
      if (!seen.has(n) && state.territories[n].owner === owner) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return false;
}

function areAdjacent(state: GameState, a: TerritoryId, b: TerritoryId): boolean {
  return state.board.territories[a].neighbours.includes(b);
}

function activePlayers(state: GameState): Player[] {
  return state.players.filter((p) => !p.eliminated);
}

function maxAttackDice(armies: number): number {
  return Math.min(3, armies - 1);
}

// --- setup ------------------------------------------------------------------

function startingArmyPool(mode: BoardMode, players: number, owned: number): number {
  if (mode === "classic") {
    const table: Record<number, number> = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };
    return Math.max(0, (table[players] ?? 25) - owned);
  }
  // World board has far more territories than the classic table assumes; give a
  // placement pool proportional to holdings instead.
  return Math.round(owned * 0.8);
}

export function createGame(config: GameConfig): GameState {
  if (config.players.length < 2) throw new Error("Need at least 2 players");
  const boardMode = config.boardMode ?? "world";
  const board = config.board ?? getBoard(boardMode);
  const cardsEnabled = config.cardsEnabled ?? true;
  const rng = mulberry32(config.seed);

  const players: Player[] = config.players.map((p) => ({ ...p, eliminated: false, cards: [], actionCards: [] }));

  // Deal every territory round-robin in random order, one army each.
  const ids = shuffle(Object.keys(board.territories), rng);
  const territories: GameState["territories"] = {};
  ids.forEach((id, i) => {
    territories[id] = { owner: players[i % players.length].id, armies: 1 };
  });

  // Auto-scatter each player's remaining starting armies over their territories.
  for (const player of players) {
    const owned = ids.filter((id) => territories[id].owner === player.id);
    const pool = startingArmyPool(boardMode, players.length, owned.length);
    for (let k = 0; k < pool; k++) {
      const t = owned[Math.floor(rng() * owned.length)];
      territories[t].armies++;
    }
  }

  const campaign = config.campaign ?? false;
  if (campaign) assignCampaigns(players, territories, board, rng);

  const deck = cardsEnabled ? shuffle(buildDeck(board, WILDS_BY_MODE[boardMode]), rng) : [];

  // Action cards: shuffle a pool of two-of-each and deal 2 to each player.
  const actionCardsEnabled = config.actionCardsEnabled ?? false;
  if (actionCardsEnabled) {
    const pool = shuffle(ACTION_CARD_TYPES.flatMap((t) => [t, t]), rng);
    for (const player of players) player.actionCards = pool.splice(0, 2);
  }

  const state: GameState = {
    board,
    options: { boardMode, fortifyRule: config.fortifyRule ?? "connected", cardsEnabled, campaign, actionCardsEnabled },
    players,
    territories,
    turn: 1,
    activePlayer: players[0].id,
    phase: "reinforce",
    reinforcementsRemaining: 0,
    pendingOccupation: null,
    pendingDecision: null,
    misinformation: {},
    conqueredThisTurn: false,
    fortifyAnywhere: false,
    deck,
    discard: [],
    setsTradedIn: 0,
    rngSeed: config.seed,
    rngCursor: 0,
    winner: null,
  };
  state.reinforcementsRemaining = reinforcementsFor(state, players[0].id);
  return state;
}

// --- cloning ----------------------------------------------------------------

/** Clone everything mutable; board and options are shared (treated immutable). */
function cloneState(s: GameState): GameState {
  const territories: GameState["territories"] = {};
  for (const k in s.territories) territories[k] = { ...s.territories[k] };
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, cards: [...p.cards], actionCards: [...p.actionCards], campaign: p.campaign ? { ...p.campaign } : undefined })),
    territories,
    deck: [...s.deck],
    discard: [...s.discard],
    pendingOccupation: s.pendingOccupation ? { ...s.pendingOccupation } : null,
    pendingDecision: s.pendingDecision ? { ...s.pendingDecision } : null,
    misinformation: Object.fromEntries(
      Object.entries(s.misinformation).map(([k, v]) => [k, { fake: v.fake, revealedTo: [...v.revealedTo] }]),
    ),
  };
}

/**
 * Army count a `viewer` perceives for a territory. The owner (and anyone the bluff
 * has been revealed to) sees the real count; other players see the Misinformation
 * `fake`. Combat and all rules use the real count — this is display/AI-perception only.
 */
export function perceivedArmies(state: GameState, viewer: PlayerId, id: TerritoryId): number {
  const t = state.territories[id];
  const mis = state.misinformation[id];
  if (!mis || viewer === t.owner || mis.revealedTo.includes(viewer)) return t.armies;
  return mis.fake;
}

// --- validation -------------------------------------------------------------

function mustTrade(state: GameState): boolean {
  return (
    state.options.cardsEnabled &&
    playerById(state, state.activePlayer).cards.length >= FORCED_TRADE_AT
  );
}

/** Returns a reason string if the action is illegal in this state, else null. */
export function validateAction(state: GameState, action: Action): string | null {
  if (state.winner) return "game is over";
  // A pending defender decision blocks everything except resolving it.
  if (state.pendingDecision && action.type !== "resolveDecision")
    return "a defender decision is pending";
  const me = state.activePlayer;

  switch (action.type) {
    case "tradeCards": {
      if (state.phase !== "reinforce") return "can only trade during reinforce";
      const hand = playerById(state, me).cards;
      const picked = action.cards.map((id) => hand.find((c) => c.id === id));
      if (picked.some((c) => !c)) return "card not in hand";
      if (new Set(action.cards).size !== 3) return "must pick three distinct cards";
      if (!isValidSet(picked as Card[])) return "not a valid set";
      if (action.bonusTerritory !== undefined) {
        const pictured = (picked as Card[]).some((c) => c.territory === action.bonusTerritory);
        if (!pictured) return "bonus territory is not pictured in this set";
        if (state.territories[action.bonusTerritory]?.owner !== me)
          return "bonus territory must be one you own";
      }
      return null;
    }
    case "placeArmies": {
      if (state.phase !== "reinforce") return "not the reinforce phase";
      if (mustTrade(state)) return "must trade cards first (5+ in hand)";
      if (state.territories[action.territory]?.owner !== me) return "not your territory";
      if (action.count < 1) return "count must be ≥1";
      if (action.count > state.reinforcementsRemaining) return "not enough reinforcements";
      return null;
    }
    case "attack": {
      if (state.phase !== "attack") return "not the attack phase";
      if (state.pendingOccupation) return "must occupy the conquered territory first";
      const from = state.territories[action.from];
      const to = state.territories[action.to];
      if (!from || !to) return "unknown territory";
      if (from.owner !== me) return "attacking territory is not yours";
      if (to.owner === me) return "cannot attack your own territory";
      if (!areAdjacent(state, action.from, action.to)) return "territories are not adjacent";
      if (from.armies < 2) return "need at least 2 armies to attack";
      if (action.dice < 1 || action.dice > maxAttackDice(from.armies))
        return "invalid number of dice";
      return null;
    }
    case "occupy": {
      if (state.phase !== "attack" || !state.pendingOccupation) return "nothing to occupy";
      const { min, max } = state.pendingOccupation;
      if (action.count < min || action.count > max) return `must move ${min}..${max} armies`;
      return null;
    }
    case "endAttack":
      if (state.phase !== "attack") return "not the attack phase";
      if (state.pendingOccupation) return "must occupy the conquered territory first";
      return null;
    case "fortify": {
      if (state.phase !== "fortify") return "not the fortify phase";
      const from = state.territories[action.from];
      const to = state.territories[action.to];
      if (!from || !to) return "unknown territory";
      if (from.owner !== me || to.owner !== me) return "both territories must be yours";
      if (action.count < 1) return "count must be ≥1";
      if (action.count > from.armies - 1) return "must leave at least 1 army behind";
      // Troop Transport (fortifyAnywhere) lets the move ignore connectivity.
      const reachable =
        state.fortifyAnywhere ||
        (state.options.fortifyRule === "adjacent"
          ? areAdjacent(state, action.from, action.to)
          : pathExists(state, me, action.from, action.to));
      if (!reachable) return "no owned path between territories";
      return null;
    }
    case "endTurn":
      if (state.phase !== "fortify") return "can only end turn from the fortify phase";
      return null;
    case "playActionCard":
      return validateActionCard(state, action);
    case "revealMisinformation": {
      const t = state.territories[action.territory];
      if (!t) return "unknown territory";
      if (t.owner === me) return "you own that territory";
      return null; // idempotent / no-op if there's no bluff to reveal
    }
    case "resolveDecision": {
      const pd = state.pendingDecision;
      if (!pd) return "no decision is pending";
      if (!action.play) return null; // declining is always allowed
      const card: ActionCardType = pd.kind === "minefield" ? "minefield" : "tacticalRetreat";
      if (!playerById(state, pd.player).actionCards.includes(card)) return "you no longer hold that card";
      if (pd.kind === "tacticalRetreat") {
        if (!action.to) return "choose a territory to retreat into";
        const dest = state.territories[action.to];
        if (!dest || dest.owner !== pd.player) return "retreat target must be yours";
        if (!areAdjacent(state, pd.territory, action.to)) return "retreat target must be adjacent";
      }
      return null;
    }
  }
}

/** Validate a playActionCard action (Phase 2 supports troopTransport + airStrike). */
function validateActionCard(
  state: GameState,
  action: Extract<Action, { type: "playActionCard" }>,
): string | null {
  if (!state.options.actionCardsEnabled) return "action cards are not enabled";
  const me = state.activePlayer;
  if (!playerById(state, me).actionCards.includes(action.card)) return "you do not hold that card";
  switch (action.card) {
    case "troopTransport":
      if (state.phase !== "fortify") return "troop transport is a fortify-phase card";
      if (state.fortifyAnywhere) return "troop transport is already active";
      return null;
    case "airStrike": {
      if (state.phase !== "attack") return "air strike can only be played while attacking";
      if (state.pendingOccupation) return "resolve the conquered territory first";
      if (!action.from || !action.to) return "air strike needs a from and to";
      const from = state.territories[action.from];
      const to = state.territories[action.to];
      if (!from || !to) return "unknown territory";
      if (from.owner !== me) return "attacking territory is not yours";
      if (to.owner === me) return "cannot air-strike your own territory";
      if (!areAdjacent(state, action.from, action.to)) return "territories are not adjacent";
      if (from.armies < 2) return "need at least 2 armies to attack";
      return null;
    }
    case "misinformation": {
      if (state.phase !== "reinforce") return "misinformation is a reinforce-phase card";
      if (!action.territory) return "misinformation needs a territory";
      const t = state.territories[action.territory];
      if (!t) return "unknown territory";
      if (t.owner !== me) return "must be one of your territories";
      if (action.fake === undefined || action.fake < 1) return "fake count must be at least 1";
      const swing = reinforcementsFor(state, me); // this turn's base income bounds the bluff
      if (Math.abs(action.fake - t.armies) > swing) return `fake count can differ by at most ${swing}`;
      return null;
    }
    default:
      return "that card cannot be played right now";
  }
}

export function isLegal(state: GameState, action: Action): boolean {
  return validateAction(state, action) === null;
}

// --- apply ------------------------------------------------------------------

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

/** Draw one card for the active player (reshuffling discard if needed). Mutates `s`. */
function drawCard(s: GameState, events: GameEvent[]): void {
  if (!s.options.cardsEnabled) return;
  if (s.deck.length === 0) {
    if (s.discard.length === 0) return;
    s.deck = shuffle(s.discard, mulberry32(s.rngSeed + s.rngCursor));
    s.discard = [];
    s.rngCursor += 1;
  }
  const card = s.deck.pop()!;
  playerById(s, s.activePlayer).cards.push(card);
  events.push({ type: "cardAwarded", player: s.activePlayer });
}

/** Advance to the next non-eliminated player and open their reinforce phase. */
function endTurn(s: GameState, events: GameEvent[]): void {
  if (s.conqueredThisTurn) drawCard(s, events);

  const order = s.players;
  const startIdx = order.findIndex((p) => p.id === s.activePlayer);
  let next = startIdx;
  do {
    next = (next + 1) % order.length;
  } while (order[next].eliminated && next !== startIdx);

  const prev = s.activePlayer;
  s.activePlayer = order[next].id;
  s.turn += 1;
  s.phase = "reinforce";
  s.pendingOccupation = null;
  s.conqueredThisTurn = false;
  s.fortifyAnywhere = false;
  s.reinforcementsRemaining = reinforcementsFor(s, s.activePlayer);
  events.push({ type: "turnEnded", player: prev, nextPlayer: s.activePlayer, turn: s.turn });
  events.push({ type: "phaseChanged", phase: "reinforce", player: s.activePlayer });

  // Campaign: update the finishing player's country-hold streak, then check if
  // their country/continent objective is met at this turn's end.
  const prevPlayer = playerById(s, prev);
  if (prevPlayer.campaign?.kind === "country") {
    prevPlayer.campaign.heldTurns =
      s.territories[prevPlayer.campaign.territory]?.owner === prev ? prevPlayer.campaign.heldTurns + 1 : 0;
  }
  setCampaignWinner(s, events, prevPlayer);
}

/** Is player p's campaign objective currently satisfied? */
function campaignMet(s: GameState, p: Player): boolean {
  const c = p.campaign;
  if (!c || p.eliminated) return false;
  if (c.kind === "country") return c.heldTurns >= COUNTRY_HOLD_TURNS;
  if (c.kind === "continent") return ownsContinent(s, p.id, c.continent);
  return playerById(s, c.target).eliminated; // assassination
}

/** Declare p the winner if they've met their campaign objective (and nobody has yet). */
function setCampaignWinner(s: GameState, events: GameEvent[], p: Player): void {
  if (s.winner || !campaignMet(s, p)) return;
  s.winner = p.id;
  events.push({ type: "gameWon", winner: p.id, reason: "campaign" });
}

function checkWin(s: GameState, events: GameEvent[]): void {
  if (s.winner) return;
  const alive = activePlayers(s);
  if (alive.length === 1) {
    s.winner = alive[0].id;
    events.push({ type: "gameWon", winner: s.winner, reason: "elimination" });
  }
}

export function applyAction(state: GameState, action: Action): ApplyResult {
  const reason = validateAction(state, action);
  if (reason) throw new IllegalActionError(reason);

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const me = s.activePlayer;

  switch (action.type) {
    case "tradeCards": {
      const player = playerById(s, me);
      const picked = action.cards.map((id) => player.cards.find((c) => c.id === id)!);
      player.cards = player.cards.filter((c) => !action.cards.includes(c.id));
      s.discard.push(...picked);
      const base = setBonus(s.setsTradedIn);
      s.setsTradedIn += 1;
      s.reinforcementsRemaining += base; // base set bonus goes to the pool
      // The +2 territory bonus is placed on ONE owned territory pictured in the
      // set — the chosen one, or the first owned match if unspecified.
      const owned = picked
        .map((c) => c.territory)
        .filter((t): t is TerritoryId => !!t && s.territories[t].owner === me);
      const dest = action.bonusTerritory ?? owned[0] ?? null;
      if (dest) s.territories[dest].armies += 2;
      events.push({
        type: "cardsTraded",
        player: me,
        bonus: base,
        territoryBonus: dest ? 2 : 0,
        bonusTerritory: dest,
      });
      break;
    }

    case "placeArmies": {
      s.territories[action.territory].armies += action.count;
      s.reinforcementsRemaining -= action.count;
      events.push({ type: "armiesPlaced", player: me, territory: action.territory, count: action.count });
      if (s.reinforcementsRemaining === 0) {
        s.phase = "attack";
        events.push({ type: "phaseChanged", phase: "attack", player: me });
      }
      break;
    }

    case "attack": {
      const from = s.territories[action.from];
      const to = s.territories[action.to];
      const defender = to.owner!;
      // Committing to an attack reveals any Misinformation on the target to the attacker.
      revealMisinformationTo(s, action.to, me);
      const attackerDiceCount = action.dice;
      const defenderDiceCount = Math.min(2, to.armies);

      let cursor = s.rngCursor;
      const roll = (n: number) =>
        Array.from({ length: n }, () => rollDieAt(s.rngSeed, cursor++)).sort((a, b) => b - a);
      const attackerDice = roll(attackerDiceCount);
      const defenderDice = roll(defenderDiceCount);
      s.rngCursor = cursor;

      let attackerLosses = 0;
      let defenderLosses = 0;
      const comparisons = Math.min(attackerDiceCount, defenderDiceCount);
      for (let i = 0; i < comparisons; i++) {
        if (attackerDice[i] > defenderDice[i]) defenderLosses++;
        else attackerLosses++; // ties go to the defender
      }
      from.armies -= attackerLosses;
      to.armies -= defenderLosses;

      const conquered = to.armies === 0;
      events.push({
        type: "attacked",
        player: me,
        from: action.from,
        to: action.to,
        attackerDice,
        defenderDice,
        attackerLosses,
        defenderLosses,
        conquered,
      });

      if (conquered) {
        to.owner = me;
        s.conqueredThisTurn = true;
        delete s.misinformation[action.to]; // bluff is moot once the territory changes hands
        const min = Math.max(1, Math.min(attackerDiceCount, from.armies - 1));
        s.pendingOccupation = { from: action.from, to: action.to, min, max: from.armies - 1 };
        events.push({
          type: "territoryConquered",
          from: action.from,
          to: action.to,
          newOwner: me,
          previousOwner: defender,
        });

        if (territoriesOf(s, defender).length === 0) {
          const victim = playerById(s, defender);
          const taken = victim.cards.length;
          playerById(s, me).cards.push(...victim.cards);
          victim.cards = [];
          victim.eliminated = true;
          events.push({ type: "playerEliminated", player: defender, by: me, cardsTaken: taken });
          // Assassination campaign: anyone who targeted the eliminated player wins.
          for (const p of s.players)
            if (p.campaign?.kind === "assassination" && p.campaign.target === defender)
              setCampaignWinner(s, events, p);
          checkWin(s, events);
        } else if (holdsActionCard(s, defender, "minefield") && !s.winner) {
          // Defender may lay a Minefield before the attacker moves in.
          s.pendingDecision = { kind: "minefield", player: defender, territory: action.to, from: action.from };
        }
      }
      break;
    }

    case "occupy": {
      const po = s.pendingOccupation!;
      const { from, to } = po;
      s.territories[from].armies -= action.count;
      let mineLoss = 0;
      if (po.mined) mineLoss = Math.min(action.count >= 4 ? 2 : 1, action.count - 1); // keep ≥1
      s.territories[to].armies += action.count - mineLoss;
      s.pendingOccupation = null;
      // Report mineLoss on any mined occupation (even 0) so the UI can show the outcome.
      events.push({ type: "occupied", from, to, count: action.count, mineLoss: po.mined ? mineLoss : undefined });
      break;
    }

    case "endAttack":
      s.phase = "fortify";
      events.push({ type: "phaseChanged", phase: "fortify", player: me });
      break;

    case "fortify": {
      s.territories[action.from].armies -= action.count;
      s.territories[action.to].armies += action.count;
      events.push({ type: "fortified", from: action.from, to: action.to, count: action.count });
      endTurn(s, events);
      break;
    }

    case "endTurn":
      endTurn(s, events);
      break;

    case "playActionCard":
      applyActionCard(s, action, events);
      break;

    case "revealMisinformation":
      revealMisinformationTo(s, action.territory, me);
      break;

    case "resolveDecision":
      applyDecision(s, action, events);
      break;
  }

  return { state: s, events };
}

/** Resolve an open defender decision window (Minefield here; Tactical Retreat added later). */
function applyDecision(
  s: GameState,
  action: Extract<Action, { type: "resolveDecision" }>,
  events: GameEvent[],
): void {
  const pd = s.pendingDecision!;
  s.pendingDecision = null;
  if (!action.play) return;
  if (pd.kind === "minefield") {
    consumeActionCard(s, pd.player, "minefield");
    if (s.pendingOccupation) s.pendingOccupation.mined = true;
    events.push({ type: "actionCardPlayed", player: pd.player, card: "minefield", target: pd.territory });
  }
}

/** Add `viewer` to a territory's Misinformation revealedTo set (no-op if none). */
function revealMisinformationTo(s: GameState, id: TerritoryId, viewer: PlayerId): void {
  const mis = s.misinformation[id];
  if (mis && !mis.revealedTo.includes(viewer)) mis.revealedTo.push(viewer);
}

/** Remove one copy of `card` from a player's hand (mutates `s`). */
function consumeActionCard(s: GameState, playerId: PlayerId, card: ActionCardType): void {
  const hand = playerById(s, playerId).actionCards;
  const i = hand.indexOf(card);
  if (i >= 0) hand.splice(i, 1);
}

/** Armies removed by an Air Strike: round(20%), ≥1 when armies≥2, never below 1 left. */
export function airStrikeRemoval(armies: number): number {
  const raw = Math.round(0.2 * armies);
  const removed = armies >= 2 ? Math.max(1, raw) : raw;
  return Math.max(0, Math.min(removed, armies - 1));
}

/** Apply a played action card (Phase 2: troopTransport, airStrike + Anti-Aircraft). */
function applyActionCard(
  s: GameState,
  action: Extract<Action, { type: "playActionCard" }>,
  events: GameEvent[],
): void {
  const me = s.activePlayer;
  if (action.card === "troopTransport") {
    consumeActionCard(s, me, "troopTransport");
    s.fortifyAnywhere = true;
    events.push({ type: "actionCardPlayed", player: me, card: "troopTransport" });
    return;
  }
  if (action.card === "airStrike") {
    consumeActionCard(s, me, "airStrike");
    const to = s.territories[action.to!];
    const defender = to.owner!;
    events.push({ type: "actionCardPlayed", player: me, card: "airStrike", target: action.to });
    if (playerById(s, defender).actionCards.includes("antiAircraft")) {
      consumeActionCard(s, defender, "antiAircraft");
      events.push({ type: "actionCardPlayed", player: defender, card: "antiAircraft", target: action.to });
      events.push({ type: "airStrikeResolved", player: me, target: action.to!, removed: 0, nullifiedBy: defender });
      return;
    }
    const removed = airStrikeRemoval(to.armies);
    to.armies -= removed;
    events.push({ type: "airStrikeResolved", player: me, target: action.to!, removed, nullifiedBy: null });
    return;
  }
  if (action.card === "misinformation") {
    consumeActionCard(s, me, "misinformation");
    s.misinformation[action.territory!] = { fake: action.fake!, revealedTo: [] };
    events.push({ type: "actionCardPlayed", player: me, card: "misinformation", target: action.territory });
  }
}

// --- legal-move generation (for AI / UI) ------------------------------------

/**
 * Canonical legal moves for the current player. Placement/fortify counts are
 * given as "all available" rather than every partial split — enough for AI move
 * selection and UI affordances; use isLegal() to validate arbitrary counts.
 */
export function listLegalActions(state: GameState): Action[] {
  if (state.winner) return [];
  // An open defender decision window: the only moves are that player's resolution.
  if (state.pendingDecision) {
    const pd = state.pendingDecision;
    const out: Action[] = [{ type: "resolveDecision", play: false }];
    const card: ActionCardType = pd.kind === "minefield" ? "minefield" : "tacticalRetreat";
    if (holdsActionCard(state, pd.player, card)) {
      if (pd.kind === "minefield") out.push({ type: "resolveDecision", play: true });
      else
        for (const to of state.board.territories[pd.territory].neighbours)
          if (state.territories[to].owner === pd.player) out.push({ type: "resolveDecision", play: true, to });
    }
    return out;
  }
  const me = state.activePlayer;
  const out: Action[] = [];

  switch (state.phase) {
    case "reinforce": {
      const hand = playerById(state, me).cards;
      for (const cards of validSetsInHand(hand)) out.push({ type: "tradeCards", cards });
      if (!mustTrade(state))
        for (const t of territoriesOf(state, me))
          out.push({ type: "placeArmies", territory: t, count: state.reinforcementsRemaining });
      break;
    }
    case "attack": {
      if (state.pendingOccupation) {
        const { min, max } = state.pendingOccupation;
        out.push({ type: "occupy", count: max });
        if (min !== max) out.push({ type: "occupy", count: min });
      } else {
        const hasAirStrike = holdsActionCard(state, me, "airStrike");
        for (const from of territoriesOf(state, me)) {
          if (state.territories[from].armies < 2) continue;
          const dice = maxAttackDice(state.territories[from].armies);
          for (const to of state.board.territories[from].neighbours)
            if (state.territories[to].owner !== me) {
              out.push({ type: "attack", from, to, dice });
              if (hasAirStrike) out.push({ type: "playActionCard", card: "airStrike", from, to });
            }
        }
        out.push({ type: "endAttack" });
      }
      break;
    }
    case "fortify": {
      if (holdsActionCard(state, me, "troopTransport") && !state.fortifyAnywhere)
        out.push({ type: "playActionCard", card: "troopTransport" });
      for (const from of territoriesOf(state, me)) {
        const movable = state.territories[from].armies - 1;
        if (movable < 1) continue;
        for (const to of territoriesOf(state, me)) {
          if (to === from) continue;
          const reachable =
            state.fortifyAnywhere ||
            (state.options.fortifyRule === "adjacent"
              ? areAdjacent(state, from, to)
              : pathExists(state, me, from, to));
          if (reachable) out.push({ type: "fortify", from, to, count: movable });
        }
      }
      out.push({ type: "endTurn" });
      break;
    }
  }
  return out;
}

/** Whether a player holds a given action card (and the mode is on). */
function holdsActionCard(state: GameState, playerId: PlayerId, card: ActionCardType): boolean {
  return state.options.actionCardsEnabled && playerById(state, playerId).actionCards.includes(card);
}
