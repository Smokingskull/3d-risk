import { ownsContinent, reinforcementsFor, territoriesOf, type GameState, type PlayerId } from "@risk3d/engine";

/**
 * At-a-glance strip for a player: how much of the map they hold, their army
 * total, continents fully controlled, and the army income they'll draw at the
 * start of their next reinforce (territories/3 + continent bonuses, before any
 * card trades).
 */
export function TurnStats({ game, playerId }: { game: GameState; playerId: PlayerId }) {
  const owned = territoriesOf(game, playerId);
  const territories = owned.length;
  const armies = owned.reduce((sum, t) => sum + game.territories[t].armies, 0);
  const continents = Object.values(game.board.continents);
  const held = continents.filter((c) => ownsContinent(game, playerId, c.id)).length;
  const income = reinforcementsFor(game, playerId);

  return (
    <div className="turn-stats">
      <div className="turn-stat">
        <span className="turn-stat-val">{territories}</span>
        <span className="turn-stat-label">Territories</span>
      </div>
      <div className="turn-stat">
        <span className="turn-stat-val">{armies}</span>
        <span className="turn-stat-label">Armies</span>
      </div>
      <div className="turn-stat">
        <span className="turn-stat-val">{held}/{continents.length}</span>
        <span className="turn-stat-label">Continents</span>
      </div>
      <div className="turn-stat" title="Armies at the start of your next reinforce (before card trades)">
        <span className="turn-stat-val">+{income}</span>
        <span className="turn-stat-label">Income</span>
      </div>
    </div>
  );
}
