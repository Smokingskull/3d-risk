/**
 * The command set. Every mutation to a game goes through one of these, applied by
 * applyAction. Clients/AI/server all speak this vocabulary.
 */
import type { TerritoryId } from "./types.js";

export type Action =
  /** Trade three cards (by id) for bonus armies during reinforce. */
  | { type: "tradeCards"; cards: [string, string, string] }
  /** Place armies from the reinforcement pool onto an owned territory. */
  | { type: "placeArmies"; territory: TerritoryId; count: number }
  /** Attack an adjacent enemy territory with 1..3 dice. */
  | { type: "attack"; from: TerritoryId; to: TerritoryId; dice: number }
  /** Move armies into a just-conquered territory (resolves a pending occupation). */
  | { type: "occupy"; count: number }
  /** Finish attacking; move to the fortify phase. */
  | { type: "endAttack" }
  /** Make the single end-of-turn fortify move between two owned territories. */
  | { type: "fortify"; from: TerritoryId; to: TerritoryId; count: number }
  /** End the turn without fortifying. */
  | { type: "endTurn" };

export type ActionType = Action["type"];
