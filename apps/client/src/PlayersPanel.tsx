import { useState } from "react";
import { perceivedArmies, type GameState } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";

/** What the current player is doing, by phase — a bare indicator (no specifics like
 *  armies placed; the game report has the detail). */
const DOING: Record<GameState["phase"], string> = {
  reinforce: "Reinforcing…",
  attack: "Attacking…",
  fortify: "Fortifying…",
};

/** Right-hand roster: every player with their territory count, army total, card
 *  count, the active player highlighted and eliminated players dimmed. Opens the
 *  active human's card view/trade dialog (owned by App). */
export function PlayersPanel({ hs, onOpenCards, onOpenActionCards }: { hs: Hotseat; onOpenCards: () => void; onOpenActionCards: () => void }) {
  const game = hs.game;
  const [open, setOpen] = useState(true);
  if (!game) return null;

  const alive = game.players.filter((p) => !p.eliminated).length;
  const active = game.players.find((p) => p.id === game.activePlayer);
  const activeHuman = active && active.kind === "human" && !game.winner ? active : null;

  const rows = game.players.map((p) => {
    let territories = 0;
    let armies = 0;
    for (const id in game.territories) {
      const t = game.territories[id];
      if (t.owner === p.id) {
        territories++;
        // Perceived from the viewer's side, so an enemy's Misinformation bluff
        // shifts their visible total too (until revealed).
        armies += hs.viewerId ? perceivedArmies(game, hs.viewerId, id) : t.armies;
      }
    }
    return { p, territories, armies, cards: p.cards.length };
  });

  return (
    <>
      <div className={open ? "players" : "players collapsed"}>
        <div className="cont-header">
          <h1>{open ? "Players" : `Players (${alive} left)`}</h1>
          <button className="collapse" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? "chevron-down" : "chevron-right"} size={16} />
          </button>
        </div>

        {open &&
          rows.map(({ p, territories, armies, cards }) => {
            const isActive = p.id === game.activePlayer && !game.winner;
            const won = game.winner === p.id;
            return (
              <div key={p.id} className={`player-row${isActive ? " active" : ""}${p.eliminated ? " dead" : ""}`}>
                <span className="player-arrow" data-tut={isActive ? "player-current" : undefined}>
                  {isActive && <Icon name="chevron-right" size={13} />}
                </span>
                <span className="player-sw" style={{ background: p.color }} />
                <div className="player-id">
                  <span className="player-name">
                    {p.name}
                    {won && <Icon name="leaderboards" style={{ color: "#f5c842" }} />}
                  </span>
                  <span className="player-meta">
                    {p.eliminated ? (
                      <>
                        <Icon name="skull" /> eliminated
                      </>
                    ) : isActive ? (
                      <span className="player-doing">{DOING[game.phase]}</span>
                    ) : (
                      <>
                        {p.kind === "cpu" ? `CPU · ${p.difficulty}` : "Human"} · {cards} {cards === 1 ? "card" : "cards"}
                      </>
                    )}
                  </span>
                </div>
                <div className="player-stats">
                  <span className="player-terr">{territories}</span>
                  <span className="player-armies">
                    <Icon name="players" /> {armies}
                  </span>
                </div>
              </div>
            );
          })}

        {open && activeHuman && (game.options.cardsEnabled || game.options.actionCardsEnabled) && (
          <div className="players-card-buttons">
            {game.options.cardsEnabled && (
              <button className={`players-cards${hs.mustTrade ? " warn" : ""}`} data-tut="cards" onClick={onOpenCards}>
                Unit cards ({activeHuman.cards.length}){hs.tradeableSetCount ? ` · ${hs.tradeableSetCount} set${hs.tradeableSetCount > 1 ? "s" : ""}` : ""}
              </button>
            )}
            {game.options.actionCardsEnabled && (
              <button className="players-cards" data-tut="action-cards" onClick={onOpenActionCards}>
                Action cards ({activeHuman.actionCards.length})
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
