import type { GameState } from "@risk3d/engine";
import { Icon } from "./Icon.js";

const ART: Record<string, string> = {
  country: "/assets/cards/country-campaign-card.png",
  continent: "/assets/cards/continent-campaign-card.png",
  assassination: "/assets/cards/assassination-campaign-card.png",
};

/** Shows the ACTIVE player's secret campaign objective — the card art plus the
 *  specific aim. Only ever the current player's target (never a rival's). */
export function CampaignDialog({ game, onClose }: { game: GameState; onClose: () => void }) {
  const me = game.players.find((p) => p.id === game.activePlayer);
  const c = me?.campaign;
  if (!c) return null;

  let aim = "";
  if (c.kind === "country") {
    aim = `Capture ${c.territory} and hold it for 3 consecutive turns${c.heldTurns > 0 ? ` — held ${c.heldTurns}/3` : ""}.`;
  } else if (c.kind === "continent") {
    aim = `Control every territory of ${game.board.continents[c.continent]?.name ?? c.continent} at the end of one of your turns.`;
  } else {
    aim = `Eliminate ${game.players.find((p) => p.id === c.target)?.name ?? "your target"} — destroy all of their armies.`;
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card campaign-card" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h2>Your Campaign</h2>
          <button className="tut-x" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <img className="campaign-img" src={ART[c.kind]} alt={c.kind} draggable={false} />
        <p className="campaign-aim">{aim}</p>
        <button className="start" onClick={onClose}>
          Understood
        </button>
      </div>
    </div>
  );
}
