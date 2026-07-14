import { setBonus, validSetsInHand, type Card } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";

const ART: Record<string, string | undefined> = {
  infantry: "/assets/cards/infantry-unit-card.png",
  cavalry: "/assets/cards/cavalry-unit-card.png",
  artillery: "/assets/cards/artillery-unit-card.png",
};

function CardFace({ card, owned, inSet }: { card: Card; owned: boolean; inSet: boolean }) {
  const art = ART[card.symbol];
  return (
    <div className={`card-face${inSet ? " in-set" : ""}`}>
      {art ? (
        <img src={art} alt={card.symbol} draggable={false} />
      ) : (
        <div className="card-wild">
          <Icon name="star" size={40} />
          <span>WILD</span>
        </div>
      )}
      <div className="card-terr">
        {card.territory ?? "Wild"}
        {owned && <Icon name="shield" style={{ color: "var(--accent-bright)" }} />}
      </div>
    </div>
  );
}

/** Modal showing the active player's hand as illustrated cards, with the set
 *  bonus and a trade action. Only opened on a human reinforce turn. */
export function CardPanel({ hs, onClose }: { hs: Hotseat; onClose: () => void }) {
  const game = hs.game;
  if (!game) return null;
  const me = game.players.find((p) => p.id === game.activePlayer);
  if (!me) return null;

  const hand = me.cards;
  const nextBonus = setBonus(game.setsTradedIn);
  const firstSet = validSetsInHand(hand)[0];
  const inSet = (id: string) => !!firstSet?.includes(id);
  const owns = (t: string | null) => !!t && game.territories[t]?.owner === me.id;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card cards-card" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h2>{me.name} — Cards</h2>
          <button className="tut-x" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {hand.length === 0 ? (
          <p className="hint">No cards yet — capture at least one territory on your turn to earn a card.</p>
        ) : (
          <div className="card-hand">
            {hand.map((c) => (
              <CardFace key={c.id} card={c} owned={owns(c.territory)} inSet={inSet(c.id)} />
            ))}
          </div>
        )}

        <div className="card-foot">
          <div className="card-bonus">
            Set bonus <strong>+{nextBonus}</strong>
          </div>
          <button
            className="start"
            disabled={hs.availableSets === 0 || game.phase !== "reinforce"}
            onClick={hs.tradeFirstSet}
          >
            Trade set (+{nextBonus})
          </button>
        </div>

        {hs.mustTrade && <p className="hint">You hold 5+ cards — you must trade a set before placing armies.</p>}
        {game.phase !== "reinforce" && <p className="hint">You can trade a set during your reinforce phase.</p>}
        {hand.some((c) => owns(c.territory)) && (
          <p className="hint">
            <Icon name="shield" /> = you hold the pictured territory (grants +2 armies there when traded).
          </p>
        )}
      </div>
    </div>
  );
}
