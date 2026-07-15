import type { Hotseat } from "./game/useHotseat.js";
import { Dialog } from "./ui/index.js";
import { actionCardInfo } from "./actionCards.js";

/**
 * The active human's held action cards. View-only for now — cards are played
 * through the game mechanics (attack/reinforce/fortify/combat), not from here.
 */
export function ActionCardPanel({ hs, onClose }: { hs: Hotseat; onClose: () => void }) {
  const game = hs.game;
  const me = game?.players.find((p) => p.id === game.activePlayer);
  if (!game || !me) return null;
  const held = me.actionCards;

  return (
    <Dialog title={`${me.name} — Action cards`} cardClassName="action-cards-card" onClose={onClose}>
      {held.length === 0 ? (
        <p className="hint">No action cards left — you've played them all.</p>
      ) : (
        <>
          <p className="hint">
            Your secret one-shot cards. Play them through the game itself (attacking,
            reinforcing, fortifying, or when defending) — not from this screen.
          </p>
          <div className="action-hand">
            {held.map((type, i) => {
              const info = actionCardInfo(type);
              return (
                <div className="action-card" key={`${type}-${i}`}>
                  <img className="action-card-img" src={info.image} alt={info.name} draggable={false} />
                  <div className="action-card-text">
                    <strong>{info.name}</strong>
                    <span className="hint">{info.blurb}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Dialog>
  );
}
