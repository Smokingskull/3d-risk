import type { GameEvent } from "@risk3d/engine";

/** Render a single game event as a one-line human-readable log entry. */
export function describe(e: GameEvent): string {
  switch (e.type) {
    case "armiesPlaced":
      return `${e.player} placed ${e.count} on ${e.territory}`;
    case "cardsTraded":
      return `${e.player} traded a set for +${e.bonus}${e.territoryBonus ? ` (+${e.territoryBonus} on ${e.bonusTerritory})` : ""}`;
    case "attacked":
      return `${e.from} → ${e.to}: 🎲 [${e.attackerDice.join(",")}] vs [${e.defenderDice.join(",")}] · −${e.attackerLosses}/−${e.defenderLosses}${e.conquered ? " · captured!" : ""}`;
    case "territoryConquered":
      return `${e.newOwner} took ${e.to} from ${e.previousOwner}`;
    case "occupied":
      return `moved ${e.count} into ${e.to}`;
    case "cardAwarded":
      return `${e.player} earned a card`;
    case "fortified":
      return `fortified ${e.count} from ${e.from} to ${e.to}`;
    case "playerEliminated":
      return `☠ ${e.player} eliminated by ${e.by}`;
    case "turnEnded":
      return `— ${e.nextPlayer}'s turn (turn ${e.turn}) —`;
    case "gameWon":
      return `🏆 ${e.winner} wins!`;
    default:
      return "";
  }
}
