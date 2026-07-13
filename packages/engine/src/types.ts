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
}

export interface TerritoryState {
  owner: PlayerId | null;
  armies: number;
}

export type Phase = "reinforce" | "attack" | "fortify";

export interface GameOptions {
  boardMode: BoardMode;
  /** "connected": fortify between any two owned territories linked by owned land. */
  fortifyRule: "connected" | "adjacent";
  cardsEnabled: boolean;
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
  /** Whether the active player has captured a territory this turn (earns a card). */
  conqueredThisTurn: boolean;
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
