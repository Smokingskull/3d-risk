/**
 * The command set. Every mutation to a game goes through one of these, applied by
 * applyAction. Clients/AI/server all speak this vocabulary.
 */
import type { ActionCardType, TerritoryId } from "./types.js";

export type Action =
  /**
   * Trade three cards (by id) for bonus armies during reinforce. If the set
   * pictures a territory the player owns, `bonusTerritory` names the one that
   * receives the +2 (must be an owned territory among the three cards). When
   * omitted, the engine picks the first owned match.
   */
  | { type: "tradeCards"; cards: [string, string, string]; bonusTerritory?: TerritoryId }
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
  | { type: "endTurn" }
  /**
   * Play one of the active player's action cards. Params depend on the card:
   *  - troopTransport: none (fortify phase; the fortify move then ignores connectivity)
   *  - airStrike: `from`/`to` (the attack target; removes ~20% of the defender, unless
   *    the defender auto-plays Anti-Aircraft)
   *  - misinformation: `territory` + `fake` (reinforce phase — a bluffed display count)
   *  - minefield / tacticalRetreat: played in a defender decision window (tacticalRetreat
   *    takes `to`, the adjacent territory to retreat into)
   */
  | { type: "playActionCard"; card: ActionCardType; from?: TerritoryId; to?: TerritoryId; territory?: TerritoryId; fake?: number };

export type ActionType = Action["type"];
