import { useMemo, useState } from "react";
import { isValidSet, setBonus, type Card, type TerritoryId } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";
import { Button, Dialog } from "./ui/index.js";

const ART: Record<string, string> = {
  infantry: "/assets/cards/infantry-unit-card.png",
  cavalry: "/assets/cards/cavalry-unit-card.png",
  artillery: "/assets/cards/artillery-unit-card.png",
  wild: "/assets/cards/wild-unit-card.png",
};

function CardFace({
  card,
  owned,
  selected,
  onClick,
}: {
  card: Card;
  owned: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`card-face${selected ? " sel" : ""}`} onClick={onClick} aria-pressed={selected}>
      <img src={ART[card.symbol]} alt={card.symbol} draggable={false} />
      <div className="card-terr">
        {card.territory ?? "Wild"}
        {owned && <Icon name="shield" style={{ color: "var(--accent-bright)" }} />}
      </div>
    </button>
  );
}

/** Modal showing the active player's hand as illustrated cards. The player picks
 *  three cards to form a set and, when the set pictures territories they own,
 *  chooses which one receives the +2 bonus armies. Trading only in reinforce. */
export function CardPanel({ hs, onClose }: { hs: Hotseat; onClose: () => void }) {
  const game = hs.game;
  const [selected, setSelected] = useState<string[]>([]);
  const [bonusChoice, setBonusChoice] = useState<TerritoryId | null>(null);

  const me = game?.players.find((p) => p.id === game.activePlayer);
  const hand = me?.cards ?? [];
  const owns = (t: string | null) => !!t && !!me && game!.territories[t]?.owner === me.id;

  const selectedCards = useMemo(() => hand.filter((c) => selected.includes(c.id)), [hand, selected]);
  const isSet = selected.length === 3 && isValidSet(selectedCards);
  // Owned territories pictured in the chosen set — candidates for the +2.
  const ownedInSet = useMemo(
    () => (isSet ? selectedCards.map((c) => c.territory).filter((t): t is TerritoryId => owns(t)) : []),
    [isSet, selectedCards],
  );
  const bonusTerritory = bonusChoice && ownedInSet.includes(bonusChoice) ? bonusChoice : ownedInSet[0] ?? null;

  if (!game || !me) return null;

  const base = setBonus(game.setsTradedIn);
  const canTrade = isSet && game.phase === "reinforce";

  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 3 ? [...cur, id] : cur,
    );

  const trade = () => {
    if (!canTrade) return;
    hs.tradeSet(selected as [string, string, string], bonusTerritory ?? undefined);
    setSelected([]);
    setBonusChoice(null);
  };

  return (
    <Dialog title={`${me.name} — Cards`} cardClassName="cards-card" onClose={onClose}>
        {hand.length === 0 ? (
          <p className="hint">No cards yet — capture at least one territory on your turn to earn a card.</p>
        ) : (
          <div className="card-hand">
            {hand.map((c) => (
              <CardFace key={c.id} card={c} owned={owns(c.territory)} selected={selected.includes(c.id)} onClick={() => toggle(c.id)} />
            ))}
          </div>
        )}

        <div className="card-foot">
          {/* Selection status */}
          {hand.length > 0 && !isSet && (
            <p className="hint">
              {selected.length < 3
                ? `Select ${3 - selected.length} more card${3 - selected.length === 1 ? "" : "s"} to form a set.`
                : "Not a valid set — pick three of a kind, one of each, or any three including a wild."}
            </p>
          )}

          {/* Territory bonus chooser (only when the chosen set is valid) */}
          {isSet && (
            <div className="card-bonusrow">
              {ownedInSet.length > 0 ? (
                <div className="bonus-choice">
                  <span className="bonus-label">
                    <Icon name="shield" /> +2 armies on:
                  </span>
                  {ownedInSet.map((t) => (
                    <button
                      key={t}
                      className={`bonus-chip${t === bonusTerritory ? " sel" : ""}`}
                      disabled={ownedInSet.length === 1}
                      onClick={() => setBonusChoice(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="hint">No territory bonus — you own none of the countries in this set.</p>
              )}
            </div>
          )}

          <div className="card-actions">
            <div className="card-bonus">
              Set bonus <strong>+{base}</strong>
            </div>
            <Button disabled={!canTrade} onClick={trade}>
              Trade set (+{base}){isSet && bonusTerritory ? ` · +2 → ${bonusTerritory}` : ""}
            </Button>
          </div>

          {hs.mustTrade && <p className="hint warn">You hold 5+ cards — you must trade a set before placing armies.</p>}
          {game.phase !== "reinforce" && <p className="hint">You can only trade during your reinforce phase.</p>}
        </div>
    </Dialog>
  );
}
