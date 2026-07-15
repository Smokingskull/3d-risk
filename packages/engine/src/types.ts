/**
 * Core domain types for the RISK rules engine.
 *
 * This module is pure and deterministic — no DOM, no Three.js, no network. It is
 * imported by the client (for local play / optimistic UI), by the future server
 * (as the authoritative referee), and by the AI. Keep it that way.
 */

/** A territory id is the country's Natural Earth name, matching the GLB node names. */
export type TerritoryId = string;

/** A continent grouping, used for reinforcement bonuses. */
export type ContinentId = string;

/** Which prebuilt board a game uses. */
export type BoardMode = "world" | "classic";

export interface Continent {
  id: ContinentId;
  name: string;
  /** Bonus armies awarded for controlling every territory in this continent. */
  bonus: number;
  territories: TerritoryId[];
}

export interface Territory {
  id: TerritoryId;
  continent: ContinentId;
  /** Adjacent territory ids reachable in a single attack/fortify move. */
  neighbours: TerritoryId[];
  /**
   * Real country meshes this territory occupies. Presentation-only (the engine
   * treats territories as opaque). Single-country territories (the World board)
   * may omit this; the client then treats the territory id as its one member.
   */
  members?: TerritoryId[];
}

/** The static board: which territories exist, how they group, what connects. */
export interface BoardDefinition {
  territories: Record<TerritoryId, Territory>;
  continents: Record<ContinentId, Continent>;
}

export type PlayerId = string;

/** The symbol on a RISK card; three of a kind or one of each forms a set. */
export type CardSymbol = "infantry" | "cavalry" | "artillery" | "wild";

export interface Card {
  id: string;
  /** The territory pictured (grants a placement bonus if you own it). Null for wilds. */
  territory: TerritoryId | null;
  symbol: CardSymbol;
}

/**
 * The six special one-shot Action cards (an optional game mode). Two of each exist
 * across a game; each player is dealt 2 at the start and they are not replenished.
 */
export type ActionCardType =
  | "troopTransport"
  | "airStrike"
  | "misinformation"
  | "antiAircraft"
  | "minefield"
  | "tacticalRetreat";

/** A player's secret objective in a Campaign game. */
export type CampaignKind = "country" | "continent" | "assassination";
export type CampaignTarget =
  | { kind: "country"; territory: TerritoryId; heldTurns: number }
  | { kind: "continent"; continent: ContinentId }
  | { kind: "assassination"; target: PlayerId };

export interface Player {
  id: PlayerId;
  name: string;
  /** Hex colour used to paint owned territories on the globe, e.g. "#e6194b". */
  color: string;
  kind: "human" | "cpu";
  /** Difficulty is only meaningful for cpu players. */
  difficulty?: "easy" | "medium" | "hard" | "adaptive";
  eliminated: boolean;
  /** Cards held in hand. */
  cards: Card[];
  /** Action cards held (only used when actionCardsEnabled). Hidden from opponents. */
  actionCards: ActionCardType[];
  /** Secret campaign objective (only set in Campaign games). */
  campaign?: CampaignTarget;
}

export interface TerritoryState {
  owner: PlayerId | null;
  armies: number;
}

export type Phase = "reinforce" | "attack" | "fortify";

/**
 * A Misinformation bluff on a territory: opponents see `fake` instead of the real
 * army count, until they attempt an attack on it (added to `revealedTo`, after
 * which that opponent — and only that opponent — sees the truth). The owner always
 * sees the real count.
 */
export interface Misinformation {
  fake: number;
  revealedTo: PlayerId[];
}

export interface GameOptions {
  boardMode: BoardMode;
  /** "connected": fortify between any two owned territories linked by owned land. */
  fortifyRule: "connected" | "adjacent";
  cardsEnabled: boolean;
  /** Campaign mode: each player has a secret objective; first to meet theirs wins. */
  campaign: boolean;
  /** Action cards mode: deal 2 special one-shot cards per player at the start. */
  actionCardsEnabled: boolean;
}

/**
 * After a successful attack empties a territory, the attacker must move armies in.
 * While this is set, the only legal action is `occupy`.
 */
export interface PendingOccupation {
  from: TerritoryId;
  to: TerritoryId;
  /** Minimum armies that must be moved (at least the number of dice rolled). */
  min: number;
  /** Maximum armies that may be moved (attacking territory must keep ≥1). */
  max: number;
  /** A Minefield was laid: the occupation loses armies on arrival (see occupy). */
  mined?: boolean;
  /** Who laid the Minefield (the defender), for attributing the outcome. */
  minedBy?: PlayerId;
}

/**
 * A defender's optional reaction during another player's attack (an action-card
 * decision window). While set, the only legal action is that player's
 * `resolveDecision` (play or decline). `territory` is the contested territory,
 * `from` the attacker's source.
 */
export interface PendingDecision {
  kind: "minefield" | "tacticalRetreat";
  player: PlayerId;
  territory: TerritoryId;
  from: TerritoryId;
}

export interface GameState {
  /** Shared, treated as immutable — not cloned between actions. */
  board: BoardDefinition;
  /** Shared, treated as immutable. */
  options: GameOptions;
  players: Player[];
  territories: Record<TerritoryId, TerritoryState>;
  /** Increments on every turn hand-off. */
  turn: number;
  activePlayer: PlayerId;
  phase: Phase;
  /** Armies the active player still has to place this reinforce phase. */
  reinforcementsRemaining: number;
  pendingOccupation: PendingOccupation | null;
  /** A defender's open action-card reaction window, if any (blocks all else). */
  pendingDecision: PendingDecision | null;
  /** Active Misinformation bluffs, keyed by territory (empty unless a card set one). */
  misinformation: Record<TerritoryId, Misinformation>;
  /** Whether the active player has captured a territory this turn (earns a card). */
  conqueredThisTurn: boolean;
  /** Troop Transport played this turn: the fortify move ignores connectivity. */
  fortifyAnywhere: boolean;
  /** Draw pile. */
  deck: Card[];
  /** Discard pile (reshuffled into the deck when it runs out). */
  discard: Card[];
  /** How many card sets have been traded across the whole game (drives the bonus). */
  setsTradedIn: number;
  /** Seed for the deterministic RNG, so games are reproducible/verifiable. */
  rngSeed: number;
  /** How many random draws have been consumed; advances on every dice roll. */
  rngCursor: number;
  winner: PlayerId | null;
}
