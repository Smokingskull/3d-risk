import { useMemo } from "react";
import type { GameState, Player } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import { Button, Dialog, Dot } from "./ui/index.js";

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** A short, revealed summary of a player's campaign objective (game over — no secrets). */
function objectiveText(game: GameState, p: Player): string | null {
  const c = p.campaign;
  if (!c) return null;
  if (c.kind === "country") return `Hold ${c.territory} for 3 turns`;
  if (c.kind === "continent") return `Control ${game.board.continents[c.continent]?.name ?? c.continent}`;
  return `Eliminate ${game.players.find((t) => t.id === c.target)?.name ?? "target"}`;
}

/** Final placement screen shown after the win/loss card. Lists every player best→worst
 *  (per the server's ranking), revealing their objective and remaining forces. */
export function RankingScreen({ hs, onClose }: { hs: Hotseat; onClose: () => void }) {
  const game = hs.game;
  const territories = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of Object.values(game?.territories ?? {})) if (t.owner) counts[t.owner] = (counts[t.owner] ?? 0) + 1;
    return counts;
  }, [game]);

  if (!game || !hs.ranking) return null;
  const byId = new Map(game.players.map((p) => [p.id, p]));

  return (
    <Dialog title="Final ranking" cardClassName="ranking-card" onClose={onClose} closeOnBackdrop={false} showClose={false}>
      <ol className="ranking-list">
        {hs.ranking.map((seat, i) => {
          const p = byId.get(seat);
          if (!p) return null;
          const aim = game.options.campaign ? objectiveText(game, p) : null;
          return (
            <li className={`ranking-row${seat === hs.yourSeat ? " you" : ""}`} key={seat}>
              <span className="ranking-place">{ordinal(i + 1)}</span>
              <Dot color={p.color} />
              <span className="ranking-name">
                {p.name}
                {seat === game.winner && <span className="ranking-tag win">Winner</span>}
                {seat === hs.yourSeat && <span className="ranking-tag me">You</span>}
              </span>
              <span className="ranking-stats">
                {aim && <em className="ranking-aim">{aim}</em>}
                {territories[seat] ?? 0} terr · {p.cards.length} cards
                {p.eliminated && " · eliminated"}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="ranking-actions">
        <Button onClick={onClose}>Back</Button>
      </div>
    </Dialog>
  );
}
