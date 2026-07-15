import type { GameEvent } from "@risk3d/engine";

/**
 * Render a single game event as a one-line human-readable log entry. `nameOf`
 * maps a player id to their display name (event payloads carry ids).
 */
export function describe(e: GameEvent, nameOf: (id: string) => string): string {
  switch (e.type) {
    case "armiesPlaced":
      return `${nameOf(e.player)} placed ${e.count} on ${e.territory}`;
    case "cardsTraded":
      return `${nameOf(e.player)} traded a set for +${e.bonus}${e.territoryBonus ? ` (+${e.territoryBonus} on ${e.bonusTerritory})` : ""}`;
    case "attacked":
      return `${e.from} → ${e.to}: 🎲 [${e.attackerDice.join(",")}] vs [${e.defenderDice.join(",")}] · −${e.attackerLosses}/−${e.defenderLosses}${e.conquered ? " · captured!" : ""}`;
    case "territoryConquered":
      return `${nameOf(e.newOwner)} took ${e.to} from ${nameOf(e.previousOwner)}`;
    case "occupied":
      return `moved ${e.count} into ${e.to}`;
    case "cardAwarded":
      return `${nameOf(e.player)} earned a card`;
    case "fortified":
      return `fortified ${e.count} from ${e.from} to ${e.to}`;
    case "playerEliminated":
      return `☠ ${nameOf(e.player)} eliminated by ${nameOf(e.by)}`;
    case "turnEnded":
      return `— ${nameOf(e.nextPlayer)}'s turn (turn ${e.turn}) —`;
    case "gameWon":
      return `🏆 ${nameOf(e.winner)} wins!`;
    default:
      return "";
  }
}
