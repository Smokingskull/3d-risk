/**
 * Events emitted by applyAction. The UI animates from these; the server can log
 * them; the move-log archive built from them is training data for the learning AI.
 */
import type { ActionCardType, Phase, PlayerId, TerritoryId } from "./types.js";

export type GameEvent =
  | { type: "armiesPlaced"; player: PlayerId; territory: TerritoryId; count: number }
  | {
      type: "cardsTraded";
      player: PlayerId;
      /** Base set bonus added to the reinforcement pool. */
      bonus: number;
      /** Extra armies placed on a pictured territory the player owns (0 or 2). */
      territoryBonus: number;
      /** Which territory received the +2, or null if none was owned. */
      bonusTerritory: TerritoryId | null;
    }
  | {
      type: "attacked";
      player: PlayerId;
      from: TerritoryId;
      to: TerritoryId;
      attackerDice: number[];
      defenderDice: number[];
      attackerLosses: number;
      defenderLosses: number;
      conquered: boolean;
    }
  | {
      type: "territoryConquered";
      from: TerritoryId;
      to: TerritoryId;
      newOwner: PlayerId;
      previousOwner: PlayerId;
    }
  | { type: "occupied"; from: TerritoryId; to: TerritoryId; count: number }
  | { type: "cardAwarded"; player: PlayerId }
  | { type: "fortified"; from: TerritoryId; to: TerritoryId; count: number }
  | { type: "playerEliminated"; player: PlayerId; by: PlayerId; cardsTaken: number }
  | { type: "phaseChanged"; phase: Phase; player: PlayerId }
  | { type: "turnEnded"; player: PlayerId; nextPlayer: PlayerId; turn: number }
  | { type: "gameWon"; winner: PlayerId; reason?: "elimination" | "campaign" }
  | { type: "actionCardPlayed"; player: PlayerId; card: ActionCardType; target?: TerritoryId }
  | {
      type: "airStrikeResolved";
      player: PlayerId;
      target: TerritoryId;
      /** Armies destroyed (0 if nullified). */
      removed: number;
      /** The defender who auto-played Anti-Aircraft, or null if the strike landed. */
      nullifiedBy: PlayerId | null;
    };
