import type { GameState } from "@risk3d/engine";
import { CONTINENT_COLORS } from "./continents.js";

interface Props {
  game: GameState;
  highlight: string | null;
  onToggle: (id: string) => void;
}

export function ContinentsPanel({ game, highlight, onToggle }: Props) {
  const me = game.activePlayer;
  const continents = Object.values(game.board.continents);

  return (
    <div className="continents">
      <h1>Continents</h1>
      <p className="hint">Click one to highlight it — gold marks the territories you still need for the bonus.</p>
      {continents.map((c) => {
        const owned = c.territories.filter((t) => game.territories[t].owner === me).length;
        const total = c.territories.length;
        const complete = owned === total;
        const active = highlight === c.id;
        return (
          <button key={c.id} className={`cont-row${active ? " active" : ""}`} onClick={() => onToggle(c.id)}>
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
        );
      })}
    </div>
  );
}
