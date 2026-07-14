import { useEffect, useState } from "react";
import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";

const NORMAL_VICTORY = "/assets/cards/normal-game-victory.png";
const SCENARIO_VICTORY = "/assets/cards/scenario-game-victory.png";
const LOSS = "/assets/cards/game-loss.png";
const CAMPAIGN_VICTORY: Record<string, string> = {
  country: "/assets/cards/campaign-country-victory.png",
  continent: "/assets/cards/campaign-continent-victory.png",
  assassination: "/assets/cards/campaign-assassination-victory.png",
};

/**
 * Full-screen win/loss screen shown when a game ends. Picks the image from the
 * human's perspective and the mode:
 *  - a CPU won → defeat;
 *  - scenario → the scenario victory art;
 *  - campaign won on objective → the art for that objective type;
 *  - otherwise (normal game, or a campaign won by wiping the map) → normal victory.
 */
export function VictoryOverlay({ hs }: { hs: Hotseat }) {
  const game = hs.game;
  const winnerId = game?.winner ?? null;
  const [dismissed, setDismissed] = useState(false);

  // Re-show whenever a new game reaches a winner.
  useEffect(() => setDismissed(false), [winnerId]);

  if (!game || !winnerId || dismissed) return null;
  const winner = game.players.find((p) => p.id === winnerId);
  if (!winner) return null;

  const humanWon = winner.kind === "human";
  let src: string;
  if (!humanWon) src = LOSS;
  else if (hs.isScenario) src = SCENARIO_VICTORY;
  else if (game.options.campaign && hs.winReason === "campaign" && winner.campaign)
    src = CAMPAIGN_VICTORY[winner.campaign.kind] ?? NORMAL_VICTORY;
  else src = NORMAL_VICTORY;

  return (
    <div className="overlay victory-overlay" onClick={() => setDismissed(true)}>
      <div className="victory-card" onClick={(e) => e.stopPropagation()}>
        <button className="tut-x victory-x" aria-label="Close" onClick={() => setDismissed(true)}>
          <Icon name="close" size={18} />
        </button>
        <img className="victory-img" src={src} alt={humanWon ? "Victory" : "Defeat"} draggable={false} />
        <div className="victory-actions">
          <button className="quiet" onClick={() => setDismissed(true)}>
            View board
          </button>
          <button className="start" onClick={hs.reset}>
            New game
          </button>
        </div>
      </div>
    </div>
  );
}
