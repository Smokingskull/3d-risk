import { useEffect, useMemo, useState } from "react";
import type { GameEvent } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import { Button, CloseButton, Dialog } from "./ui/index.js";
import { describe } from "./gameLog.js";
import { RankingScreen } from "./RankingScreen.js";

interface TurnGroup {
  turn: number;
  player: string;
  events: GameEvent[];
}

const NORMAL_VICTORY = "/assets/cards/normal-game-victory.png";
const LOSS = "/assets/cards/game-loss.png";
const CAMPAIGN_VICTORY: Record<string, string> = {
  country: "/assets/cards/campaign-country-victory.png",
  continent: "/assets/cards/campaign-continent-victory.png",
  assassination: "/assets/cards/campaign-assassination-victory.png",
};

/**
 * Full-screen win/loss screen shown when a game ends. Picks the image from the
 * human's perspective and the mode:
 *  - a CPU won → defeat;
 *  - campaign won on objective → the art for that objective type;
 *  - otherwise (normal game, or a campaign won by wiping the map) → normal victory.
 */
export function VictoryOverlay({ hs }: { hs: Hotseat }) {
  const game = hs.game;
  const winnerId = game?.winner ?? null;
  const [dismissed, setDismissed] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [rankOpen, setRankOpen] = useState(false);

  // Re-show (and reset the sub-views) whenever a new game reaches a winner.
  useEffect(() => {
    setDismissed(false);
    setLogOpen(false);
    setRankOpen(false);
  }, [winnerId]);

  const nameOf = useMemo(() => {
    const names = new Map((game?.players ?? []).map((p) => [p.id, p.name]));
    return (id: string) => names.get(id) ?? id;
  }, [game]);

  // Split the flat chronological log into per-turn groups. A turnEnded event
  // closes the current turn (its `player`/`turn` label it — turn is the *next*
  // turn's number, so the one that just ended is turn-1) and opens the next.
  const groups = useMemo<TurnGroup[]>(() => {
    const out: TurnGroup[] = [];
    let turn = 1;
    let player = game?.players[0]?.id ?? "";
    let events: GameEvent[] = [];
    for (const e of hs.log) {
      if (e.type === "turnEnded") {
        out.push({ turn: e.turn - 1, player, events });
        turn = e.turn;
        player = e.nextPlayer;
        events = [];
      } else {
        events.push(e);
      }
    }
    if (events.length) out.push({ turn, player, events });
    return out;
  }, [hs.log, game]);

  if (!game || !winnerId || dismissed) return null;
  const winner = game.players.find((p) => p.id === winnerId);
  if (!winner) return null;

  // Online: you win only if you ARE the winning seat (another human winning is a loss
  // for you). Offline hotseat: a human winning is a win for the player at the screen.
  const youWon = hs.online ? winnerId === hs.yourSeat : winner.kind === "human";
  let src: string;
  if (!youWon) src = LOSS;
  else if (game.options.campaign && hs.winReason === "campaign" && winner.campaign)
    src = CAMPAIGN_VICTORY[winner.campaign.kind] ?? NORMAL_VICTORY;
  else src = NORMAL_VICTORY;

  return (
    <div className="overlay victory-overlay" onClick={() => setDismissed(true)}>
      <div className="victory-card" onClick={(e) => e.stopPropagation()}>
        <CloseButton className="victory-x" onClick={() => setDismissed(true)} />
        <img className="victory-img" src={src} alt={youWon ? "Victory" : "Defeat"} draggable={false} />
        <div className="victory-actions">
          <Button variant="quiet" onClick={() => setDismissed(true)}>
            View board
          </Button>
          <Button variant="quiet" onClick={() => setLogOpen(true)}>
            View game log
          </Button>
          {hs.online && hs.ranking ? (
            <Button onClick={() => setRankOpen(true)}>See rankings</Button>
          ) : (
            <Button onClick={hs.reset}>New game</Button>
          )}
        </div>
      </div>
      {rankOpen && <RankingScreen hs={hs} onClose={() => setRankOpen(false)} />}
      {logOpen && (
        <Dialog title="Game log" cardClassName="game-log-card" onClose={() => setLogOpen(false)}>
          {groups.length === 0 ? (
            <p className="hint">No moves were recorded.</p>
          ) : (
            <div className="game-log">
              {groups.map((g, gi) => (
                <section key={gi} className="game-log-turn">
                  <h3 className="game-log-turn-head">
                    Turn {g.turn} · {nameOf(g.player)}
                  </h3>
                  {g.events.length === 0 ? (
                    <p className="game-log-empty">(no moves)</p>
                  ) : (
                    <ol className="game-log-events">
                      {g.events.map((e, i) => (
                        <li key={i}>{describe(e, nameOf)}</li>
                      ))}
                    </ol>
                  )}
                </section>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
