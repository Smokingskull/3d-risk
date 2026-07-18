import { useMemo } from "react";
import type { GameEvent } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import { Button, Dialog } from "./ui/index.js";
import { describe } from "./gameLog.js";
import { RankingScreen } from "./RankingScreen.js";
import { WoprTerminal } from "./WoprTerminal.js";

export type EndView = "result" | "choices" | "leaderboard" | "log" | "board";

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
 * The end-of-game flow, shown when a game has a winner. A modal hub the player can
 * only leave via its own buttons:
 *  - result: the victory/defeat card (from this viewer's perspective) → the choices.
 *  - choices: watch the board, open the leaderboard/log, or leave the game.
 *  - leaderboard / log: modal panels that close back to the choices.
 *  - board: the modal is hidden so the map is visible; the GAME box re-opens the
 *    choices (and offers Leave game).
 * The active view is owned by {@link App} so the GAME box can re-open the choices.
 */
export function VictoryOverlay({ hs, view, setView }: { hs: Hotseat; view: EndView; setView: (v: EndView) => void }) {
  const game = hs.game;
  const winnerId = game?.winner ?? null;

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

  if (!game || !winnerId || view === "board") return null; // watching the board → nothing over the map
  const winner = game.players.find((p) => p.id === winnerId);
  if (!winner) return null;

  const leave = hs.online ? "Leave game" : "New game";
  const canRank = hs.online && !!hs.ranking;

  // Leaderboard / log: modal panels that hide back to the choices hub.
  if (view === "leaderboard") return <RankingScreen hs={hs} onClose={() => setView("choices")} />;
  if (view === "log")
    return (
      <Dialog title="Game log" cardClassName="game-log-card" onClose={() => setView("choices")} closeOnBackdrop={false} showClose={false}>
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
        <Button onClick={() => setView("choices")}>Back</Button>
      </Dialog>
    );

  // Choices hub: watch the board, view the leaderboard/log, or leave.
  if (view === "choices") {
    const youWon = hs.online ? winnerId === hs.yourSeat : winner.kind === "human";
    return (
      <Dialog title={youWon ? "Victory" : "Defeat"} cardClassName="end-choices" onClose={() => setView("board")} closeOnBackdrop={false} showClose={false}>
        <div className="end-choices-actions">
          <Button variant="quiet" onClick={() => setView("board")}>
            Watch the board
          </Button>
          {canRank && (
            <Button variant="quiet" onClick={() => setView("leaderboard")}>
              Leaderboard
            </Button>
          )}
          <Button variant="quiet" onClick={() => setView("log")}>
            Game log
          </Button>
          <Button onClick={hs.reset}>{leave}</Button>
        </div>
      </Dialog>
    );
  }

  // Default (result): the big victory/defeat card → continue to the choices.
  const youWon = hs.online ? winnerId === hs.yourSeat : winner.kind === "human";

  // Easter egg: beating a game that included the Joshua (WOPR) CPU tier opens the
  // WarGames terminal as the result step, before the normal choices hub.
  const joshuaPlayed = game.players.some((p) => p.kind === "cpu" && p.difficulty === "joshua");
  if (youWon && joshuaPlayed) return <WoprTerminal onDone={() => setView("choices")} />;

  let src: string;
  if (!youWon) src = LOSS;
  else if (game.options.campaign && hs.winReason === "campaign" && winner.campaign) src = CAMPAIGN_VICTORY[winner.campaign.kind] ?? NORMAL_VICTORY;
  else src = NORMAL_VICTORY;

  return (
    <div className="overlay victory-overlay">
      <div className="victory-card">
        <img className="victory-img" src={src} alt={youWon ? "Victory" : "Defeat"} draggable={false} />
        <div className="victory-actions">
          <Button onClick={() => setView("choices")}>Continue</Button>
        </div>
      </div>
    </div>
  );
}
