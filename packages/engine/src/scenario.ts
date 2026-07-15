/**
 * Scenarios: pre-built game states you can drop straight into play.
 *
 * A scenario is a plain, versioned, JSON-serializable snapshot of a `GameState`
 * with the `board` omitted — the board is large and fully reconstructable from
 * `options.boardMode` via `getBoard()`, so it never needs to travel in the file.
 * Randomness round-trips as `rngSeed` + `rngCursor` (see rng.ts). There is no user
 * save feature; this exists to author named, described setups (test fixtures now,
 * historical situations later).
 *
 * Two layers:
 *  - `serializeGame` emits a *full* canonical snapshot (every field present).
 *  - `deserializeGame` is *tolerant*: it accepts a partial, hand-authored object,
 *    fills sensible defaults, rebuilds the board, validates, and returns a real
 *    `GameState` ready to hand to `applyAction`. This is what lets a scenario be
 *    written by hand to put the game into a specific state.
 */
import { getBoard } from "./board.js";
import { buildDeck, WILDS_BY_MODE } from "./cards.js";
import { reinforcementsFor } from "./game.js";
import { mulberry32, shuffle } from "./rng.js";
import type {
  BoardMode,
  Card,
  GameOptions,
  GameState,
  PendingDecision,
  PendingOccupation,
  Phase,
  Player,
  PlayerId,
  TerritoryId,
  TerritoryState,
} from "./types.js";

/** Bump when the scenario shape changes incompatibly. */
export const SCENARIO_VERSION = 1;

/** Raised when a scenario cannot be loaded. Catchable and carries a clear message. */
export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioError";
  }
}

/** Canonical, fully-populated snapshot (what `serializeGame` emits). Board omitted. */
export interface ScenarioState {
  version: number;
  options: GameOptions;
  players: Player[];
  territories: Record<TerritoryId, TerritoryState>;
  turn: number;
  activePlayer: PlayerId;
  phase: Phase;
  reinforcementsRemaining: number;
  pendingOccupation: PendingOccupation | null;
  pendingDecision: PendingDecision | null;
  misinformation: Record<TerritoryId, { fake: number; revealedTo: PlayerId[] }>;
  conqueredThisTurn: boolean;
  fortifyAnywhere: boolean;
  deck: Card[];
  discard: Card[];
  setsTradedIn: number;
  rngSeed: number;
  rngCursor: number;
  winner: PlayerId | null;
}

/** Hand-authoring shape accepted by `deserializeGame` — most fields optional. */
export interface ScenarioStateInput {
  version?: number;
  /** `boardMode` may be omitted (defaults to "world"); other options default too. */
  options: Partial<GameOptions> & { boardMode?: BoardMode };
  /** Each player needs at least id/name/color/kind; eliminated/cards default. */
  players: Array<Pick<Player, "id" | "name" | "color" | "kind"> & Partial<Player>>;
  territories: Record<TerritoryId, TerritoryState>;
  turn?: number;
  activePlayer?: PlayerId;
  phase?: Phase;
  reinforcementsRemaining?: number;
  pendingOccupation?: PendingOccupation | null;
  pendingDecision?: PendingDecision | null;
  misinformation?: Record<TerritoryId, { fake: number; revealedTo: PlayerId[] }>;
  conqueredThisTurn?: boolean;
  fortifyAnywhere?: boolean;
  deck?: Card[];
  discard?: Card[];
  setsTradedIn?: number;
  rngSeed?: number;
  rngCursor?: number;
  winner?: PlayerId | null;
}

const PHASES: Phase[] = ["reinforce", "attack", "fortify"];

/** Deep-clone plain data by JSON round-trip (the value is JSON-bound anyway). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Snapshot a live game to a canonical, JSON-serializable scenario state. The board
 * is dropped (rebuilt from `options.boardMode` on load); everything else is copied
 * verbatim. `deserializeGame(serializeGame(s))` reproduces `s`.
 */
export function serializeGame(state: GameState): ScenarioState {
  const { board: _board, ...rest } = state;
  return { version: SCENARIO_VERSION, ...clone(rest) };
}

/** Serialize a game to a pretty-printed JSON string (for authoring scenario files). */
export function serializeGameToJSON(state: GameState): string {
  return JSON.stringify(serializeGame(state), null, 2);
}

/**
 * Rebuild a `GameState` from a (possibly partial, hand-authored) scenario. Fills
 * defaults, reconstructs the board, and validates; throws `ScenarioError` on any
 * inconsistency with a message that names the offending field/value.
 */
export function deserializeGame(input: ScenarioStateInput): GameState {
  if (!input || typeof input !== "object") throw new ScenarioError("scenario is not an object");

  if (input.version !== undefined && input.version > SCENARIO_VERSION)
    throw new ScenarioError(`scenario version ${input.version} is newer than supported (${SCENARIO_VERSION})`);

  // --- board ---------------------------------------------------------------
  if (!input.options || typeof input.options !== "object")
    throw new ScenarioError("missing options");
  const boardMode: BoardMode = input.options.boardMode ?? "world";
  const board = getBoard(boardMode);
  if (!board) throw new ScenarioError(`unknown boardMode "${boardMode}"`);

  const options: GameOptions = {
    boardMode,
    fortifyRule: input.options.fortifyRule ?? "connected",
    cardsEnabled: input.options.cardsEnabled ?? true,
    campaign: input.options.campaign ?? false,
    actionCardsEnabled: input.options.actionCardsEnabled ?? false,
  };

  // --- players -------------------------------------------------------------
  if (!Array.isArray(input.players) || input.players.length < 2)
    throw new ScenarioError("need at least 2 players");
  const seen = new Set<PlayerId>();
  const players: Player[] = input.players.map((p, i) => {
    if (!p || !p.id) throw new ScenarioError(`player ${i} is missing an id`);
    if (seen.has(p.id)) throw new ScenarioError(`duplicate player id "${p.id}"`);
    seen.add(p.id);
    if (!p.name || !p.color || !p.kind)
      throw new ScenarioError(`player "${p.id}" needs name, color and kind`);
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      kind: p.kind,
      difficulty: p.difficulty,
      eliminated: p.eliminated ?? false,
      cards: p.cards ? clone(p.cards) : [],
      actionCards: p.actionCards ? clone(p.actionCards) : [],
      campaign: p.campaign ? clone(p.campaign) : undefined,
    };
  });
  const playerIds = new Set(players.map((p) => p.id));

  // --- active player -------------------------------------------------------
  const firstAlive = players.find((p) => !p.eliminated);
  if (!firstAlive) throw new ScenarioError("every player is eliminated");
  const activePlayer = input.activePlayer ?? firstAlive.id;
  const active = players.find((p) => p.id === activePlayer);
  if (!active) throw new ScenarioError(`activePlayer "${activePlayer}" is not a player`);
  if (active.eliminated) throw new ScenarioError(`activePlayer "${activePlayer}" is eliminated`);

  // --- territories (must match the board exactly) --------------------------
  if (!input.territories || typeof input.territories !== "object")
    throw new ScenarioError("missing territories");
  const boardIds = Object.keys(board.territories);
  const scenarioIds = new Set(Object.keys(input.territories));
  const unknown = [...scenarioIds].filter((id) => !board.territories[id]);
  if (unknown.length) throw new ScenarioError(`unknown territory ids: ${unknown.join(", ")}`);
  const missing = boardIds.filter((id) => !scenarioIds.has(id));
  if (missing.length)
    throw new ScenarioError(
      `territories missing for board "${boardMode}" (${missing.length}): ${missing.join(", ")}`,
    );

  const territories: Record<TerritoryId, TerritoryState> = {};
  for (const id of boardIds) {
    const t = input.territories[id];
    if (!t || typeof t.armies !== "number")
      throw new ScenarioError(`territory "${id}" needs a numeric armies count`);
    const owner = t.owner ?? null;
    if (owner !== null && !playerIds.has(owner))
      throw new ScenarioError(`territory "${id}" owned by unknown player "${owner}"`);
    if (owner === null && t.armies !== 0)
      throw new ScenarioError(`unowned territory "${id}" must have 0 armies`);
    if (owner !== null && t.armies < 1)
      throw new ScenarioError(`owned territory "${id}" must have at least 1 army`);
    territories[id] = { owner, armies: t.armies };
  }

  // --- phase ---------------------------------------------------------------
  const phase = input.phase ?? "reinforce";
  if (!PHASES.includes(phase)) throw new ScenarioError(`unknown phase "${phase}"`);

  // --- cards: validate any pictured territory exists -----------------------
  const validateCards = (cards: Card[], where: string) => {
    for (const c of cards)
      if (c.territory != null && !board.territories[c.territory])
        throw new ScenarioError(`card "${c.id}" in ${where} pictures unknown territory "${c.territory}"`);
  };
  players.forEach((p) => validateCards(p.cards, `${p.id}'s hand`));

  // --- rng, deck, discard --------------------------------------------------
  const rngSeed = input.rngSeed ?? 1;
  const rngCursor = input.rngCursor ?? 0;
  const discard = input.discard ? clone(input.discard) : [];
  validateCards(discard, "discard");

  let deck: Card[];
  if (input.deck) {
    deck = clone(input.deck);
    validateCards(deck, "deck");
  } else if (options.cardsEnabled) {
    // Auto-fill: the full deck minus every card already dealt into a hand or discard.
    const used = new Set<string>();
    players.forEach((p) => p.cards.forEach((c) => used.add(c.id)));
    discard.forEach((c) => used.add(c.id));
    deck = shuffle(
      buildDeck(board, WILDS_BY_MODE[boardMode]).filter((c) => !used.has(c.id)),
      mulberry32(rngSeed),
    );
  } else {
    deck = [];
  }

  // --- pending occupation --------------------------------------------------
  const pendingOccupation = input.pendingOccupation ?? null;
  if (pendingOccupation) {
    const { from, to } = pendingOccupation;
    if (!board.territories[from] || !board.territories[to])
      throw new ScenarioError("pendingOccupation references an unknown territory");
    if (!board.territories[from].neighbours.includes(to))
      throw new ScenarioError("pendingOccupation from/to are not adjacent");
    if (territories[from].owner !== activePlayer)
      throw new ScenarioError("pendingOccupation.from must be owned by the active player");
  }

  // --- assemble ------------------------------------------------------------
  const state: GameState = {
    board,
    options,
    players,
    territories,
    turn: input.turn ?? 1,
    activePlayer,
    phase,
    reinforcementsRemaining: 0, // set below once state is assembled
    pendingOccupation: pendingOccupation ? clone(pendingOccupation) : null,
    pendingDecision: input.pendingDecision ? clone(input.pendingDecision) : null,
    misinformation: input.misinformation ? clone(input.misinformation) : {},
    conqueredThisTurn: input.conqueredThisTurn ?? false,
    fortifyAnywhere: input.fortifyAnywhere ?? false,
    deck,
    discard,
    setsTradedIn: input.setsTradedIn ?? 0,
    rngSeed,
    rngCursor,
    winner: input.winner ?? null,
  };

  state.reinforcementsRemaining =
    input.reinforcementsRemaining ??
    (phase === "reinforce" ? reinforcementsFor(state, activePlayer) : 0);

  return state;
}

/** Load a `GameState` from a JSON string (a serialized game or a hand-written scenario). */
export function loadFromJSON(json: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new ScenarioError(`scenario is not valid JSON: ${(e as Error).message}`);
  }
  return deserializeGame(parsed as ScenarioStateInput);
}
