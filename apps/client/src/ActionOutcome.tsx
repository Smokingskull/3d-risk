import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";
import { actionCardInfo } from "./actionCards.js";

/** Dismissible popup summarising the outcome of a reactive card (Minefield, Retreat). */
export function ActionOutcome({ hs }: { hs: Hotseat }) {
  const outcome = hs.actionOutcome;
  if (!outcome) return null;
  const info = actionCardInfo(outcome.card);
  return (
    <div className="combat-backdrop" onClick={hs.dismissOutcome}>
      <div className="combat decision-prompt" onClick={(e) => e.stopPropagation()}>
        <h2 className="combat-title">{info.name}</h2>
        <img className="decision-img" src={info.image} alt={info.name} draggable={false} />
        <p className="combat-result">{outcome.text}</p>
        <div className="combat-actions">
          <button className="start" onClick={hs.dismissOutcome}>
            <Icon name="arrow-right" size={14} /> Continue
          </button>
        </div>
      </div>
    </div>
  );
}
