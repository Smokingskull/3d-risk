/**
 * The RISK rules state-machine.
 *
 * `applyAction(state, action)` is a pure function: it never mutates its input,
 * does no I/O, and draws all randomness from the state's seed + cursor. Same
 * (state, action) → same result, so the client, server, and AI run identical
 * code and always agree.
 */
import type { Action } from "./actions.js";
import { buildDeck, isValidSet, setBonus, validSetsInHand } from "./cards.js";
import type { GameEvent } from "./events.js";
import { getBoard } from "./board.js";
import { mulberry32, rollDieAt, shuffle } from "./rng.js";
import type {
  BoardDefinition,
  BoardMode,
  Card,
  ContinentId,
  GameState,
  Player,
  PlayerId,
  TerritoryId,
} from "./types.js";

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

  const players: Player[] = config.players.map((p) => ({ ...p, eliminated: false, cards: [] }));

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

  const deck = cardsEnabled ? shuffle(buildDeck(board), rng) : [];

  const state: GameState = {
    board,
    options: { boardMode, fortifyRule: config.fortifyRule ?? "connected", cardsEnabled },
    players,
    territories,
    turn: 1,
    activePlayer: players[0].id,
    phase: "reinforce",
    reinforcementsRemaining: 0,
    pendingOccupation: null,
    conqueredThisTurn: false,
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
    players: s.players.map((p) => ({ ...p, cards: [...p.cards] })),
    territories,
    deck: [...s.deck],
    discard: [...s.discard],
    pendingOccupation: s.pendingOccupation ? { ...s.pendingOccupation } : null,
  };
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
  const me = state.activePlayer;

  switch (action.type) {
    case "tradeCards": {
      if (state.phase !== "reinforce") return "can only trade during reinforce";
      const hand = playerById(state, me).cards;
      const picked = action.cards.map((id) => hand.find((c) => c.id === id));
      if (picked.some((c) => !c)) return "card not in hand";
      if (new Set(action.cards).size !== 3) return "must pick three distinct cards";
      if (!isValidSet(picked as Card[])) return "not a valid set";
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
      const reachable =
        state.options.fortifyRule === "adjacent"
          ? areAdjacent(state, action.from, action.to)
          : pathExists(state, me, action.from, action.to);
      if (!reachable) return "no owned path between territories";
      return null;
    }
    case "endTurn":
      if (state.phase !== "fortify") return "can only end turn from the fortify phase";
      return null;
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
  s.reinforcementsRemaining = reinforcementsFor(s, s.activePlayer);
  events.push({ type: "turnEnded", player: prev, nextPlayer: s.activePlayer, turn: s.turn });
  events.push({ type: "phaseChanged", phase: "reinforce", player: s.activePlayer });
}

function checkWin(s: GameState, events: GameEvent[]): void {
  const alive = activePlayers(s);
  if (alive.length === 1) {
    s.winner = alive[0].id;
    events.push({ type: "gameWon", winner: s.winner });
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
      const territoryMatch = picked.some(
        (c) => c.territory && s.territories[c.territory].owner === me,
      );
      const bonus = setBonus(s.setsTradedIn) + (territoryMatch ? 2 : 0);
      s.setsTradedIn += 1;
      s.reinforcementsRemaining += bonus;
      events.push({ type: "cardsTraded", player: me, bonus, territoryMatch });
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
          checkWin(s, events);
        }
      }
      break;
    }

    case "occupy": {
      const { from, to } = s.pendingOccupation!;
      s.territories[from].armies -= action.count;
      s.territories[to].armies += action.count;
      s.pendingOccupation = null;
      events.push({ type: "occupied", from, to, count: action.count });
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
  }

  return { state: s, events };
}

// --- legal-move generation (for AI / UI) ------------------------------------

/**
 * Canonical legal moves for the current player. Placement/fortify counts are
 * given as "all available" rather than every partial split — enough for AI move
 * selection and UI affordances; use isLegal() to validate arbitrary counts.
 */
export function listLegalActions(state: GameState): Action[] {
  if (state.winner) return [];
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
        for (const from of territoriesOf(state, me)) {
          if (state.territories[from].armies < 2) continue;
          const dice = maxAttackDice(state.territories[from].armies);
          for (const to of state.board.territories[from].neighbours)
            if (state.territories[to].owner !== me) out.push({ type: "attack", from, to, dice });
        }
        out.push({ type: "endAttack" });
      }
      break;
    }
    case "fortify": {
      for (const from of territoriesOf(state, me)) {
        const movable = state.territories[from].armies - 1;
        if (movable < 1) continue;
        for (const to of territoriesOf(state, me)) {
          if (to === from) continue;
          const reachable =
            state.options.fortifyRule === "adjacent"
              ? areAdjacent(state, from, to)
              : pathExists(state, me, from, to);
          if (reachable) out.push({ type: "fortify", from, to, count: movable });
        }
      }
      out.push({ type: "endTurn" });
      break;
    }
  }
  return out;
}
