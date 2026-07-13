import type { GameState, TerritoryId } from "@risk3d/engine";
import { CONTINENT_COLORS } from "./continents.js";

interface Props {
  game: GameState;
  highlight: string | null;
  onToggle: (id: string) => void;
  onFocusCountry: (id: TerritoryId) => void;
}

export function ContinentsPanel({ game, highlight, onToggle, onFocusCountry }: Props) {
  const me = game.activePlayer;
  const continents = Object.values(game.board.continents);
  const ownerName = (id: string | null) => game.players.find((p) => p.id === id)?.name ?? "—";
  const ownerColor = (id: string | null) => game.players.find((p) => p.id === id)?.color ?? "#6b7280";

  return (
    <div className="continents">
      <h1>Continents</h1>
      <p className="hint">Click a continent to highlight it (gold = still needed). Then click a country to rotate to it.</p>
      {continents.map((c) => {
        const owned = c.territories.filter((t) => game.territories[t].owner === me).length;
        const total = c.territories.length;
        const complete = owned === total;
        const active = highlight === c.id;
        return (
          <div className="cont-item" key={c.id}>
            <button className={`cont-row${active ? " active" : ""}`} onClick={() => onToggle(c.id)}>
              <span className="cont-sw" style={{ background: CONTINENT_COLORS[c.id] ?? "#888" }} />
              <span className="cont-name">{c.name}</span>
              <span className="cont-bar" aria-hidden>
                <span className="cont-fill" style={{ width: `${(owned / total) * 100}%`, background: complete ? "#22c55e" : "#6ea8ff" }} />
              </span>
              <span className={`cont-prog${complete ? " done" : ""}`}>
                {owned}/{total}
                {complete ? " ✓" : ""}
              </span>
              <span className="cont-bonus">+{c.bonus}</span>
            </button>

            {active && (
              <ul className="cont-members">
                {c.territories.map((t) => {
                  const st = game.territories[t];
                  const mine = st.owner === me;
                  return (
                    <li key={t}>
                      <button className="cont-member" onClick={() => onFocusCountry(t)} title={`${t} — held by ${ownerName(st.owner)} — ${st.armies} armies (click to rotate here)`}>
                        <span className="cont-dot" style={{ background: ownerColor(st.owner) }} />
                        <span className={`cont-mname${mine ? "" : " need"}`}>{t}</span>
                        <span className="cont-marmy">{st.armies}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
