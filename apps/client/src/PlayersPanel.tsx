import { useState } from "react";
import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";
import { CardPanel } from "./CardPanel.js";

/** Right-hand roster: every player with their territory count, army total, card
 *  count, the active player highlighted and eliminated players dimmed. Also owns
 *  the active human's card view/trade action. */
export function PlayersPanel({ hs }: { hs: Hotseat }) {
  const game = hs.game;
  const [open, setOpen] = useState(true);
  const [cardsOpen, setCardsOpen] = useState(false);
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
        armies += t.armies;
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
            {open ? "▾" : "▸"}
          </button>
        </div>

        {open &&
          rows.map(({ p, territories, armies, cards }) => {
            const isActive = p.id === game.activePlayer && !game.winner;
            const won = game.winner === p.id;
            return (
              <div key={p.id} className={`player-row${isActive ? " active" : ""}${p.eliminated ? " dead" : ""}`}>
                <span className="player-arrow">{isActive ? "▸" : ""}</span>
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

        {open && activeHuman && game.options.cardsEnabled && (
          <button className={`players-cards${hs.mustTrade ? " warn" : ""}`} onClick={() => setCardsOpen(true)}>
            Cards ({activeHuman.cards.length}){hs.availableSets ? ` · ${hs.availableSets} set${hs.availableSets > 1 ? "s" : ""}` : ""}
          </button>
        )}
      </div>

      {cardsOpen && activeHuman && <CardPanel hs={hs} onClose={() => setCardsOpen(false)} />}
    </>
  );
}
