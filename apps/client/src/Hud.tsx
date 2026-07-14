import { useState } from "react";
import type { GameEvent, GameState } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";
import { OptionsDialog } from "./OptionsDialog.js";
import { CampaignDialog } from "./CampaignDialog.js";

function describe(e: GameEvent): string {
  switch (e.type) {
    case "armiesPlaced":
      return `${e.player} placed ${e.count} on ${e.territory}`;
    case "cardsTraded":
      return `${e.player} traded a set for +${e.bonus}${e.territoryMatch ? " (incl. territory bonus)" : ""}`;
    case "attacked":
      return `${e.from} → ${e.to}: 🎲 [${e.attackerDice.join(",")}] vs [${e.defenderDice.join(",")}] · −${e.attackerLosses}/−${e.defenderLosses}${e.conquered ? " · captured!" : ""}`;
    case "territoryConquered":
      return `${e.newOwner} took ${e.to} from ${e.previousOwner}`;
    case "occupied":
      return `moved ${e.count} into ${e.to}`;
    case "cardAwarded":
      return `${e.player} earned a card`;
    case "fortified":
      return `fortified ${e.count} from ${e.from} to ${e.to}`;
    case "playerEliminated":
      return `☠ ${e.player} eliminated by ${e.by}`;
    case "turnEnded":
      return `— ${e.nextPlayer}'s turn (turn ${e.turn}) —`;
    case "gameWon":
      return `🏆 ${e.winner} wins!`;
    default:
      return "";
  }
}

const PHASE_LABEL: Record<GameState["phase"], string> = {
  reinforce: "Reinforce",
  attack: "Attack",
  fortify: "Fortify",
};

const PHASE_ICON: Record<GameState["phase"], string> = {
  reinforce: "target",
  attack: "swords",
  fortify: "shield",
};

export function Hud({ hs, hovered, onOpenHelp }: { hs: Hotseat; hovered: string | null; onOpenHelp: () => void }) {
  const game = hs.game!;
  const active = game.players.find((p) => p.id === game.activePlayer)!;
  const winner = game.winner ? game.players.find((p) => p.id === game.winner) : null;
  const pending = game.pendingOccupation;
  const isCpu = active.kind === "cpu" && !winner;
  const [open, setOpen] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Auto-show the campaign card on start for a solo human (not in multi-human games).
  const humanCount = game.players.filter((p) => p.kind === "human").length;
  const [campaignOpen, setCampaignOpen] = useState(game.options.campaign && humanCount === 1 && active.kind === "human");

  return (
    <>
    <div className={open ? "panel" : "panel collapsed"}>
      <div className="panel-header">
        <h1>{open ? "Game" : `Game (${active.name})`}</h1>
        <button className="collapse" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={16} />
        </button>
      </div>

      {open && (
        <>
          <div className="turn">
            <span className="dot" style={{ background: active.color }} />
            <strong data-tut="player">{active.name}</strong>
            <button
              className={`mode-btn${hs.mode === "rotate" ? " on" : ""}`}
              data-tut="mode"
              onClick={hs.toggleMode}
              aria-pressed={hs.mode === "rotate"}
              title={hs.mode === "rotate" ? "Rotate lock ON — selection disabled. Click to enable selecting." : "Rotate lock OFF — click to lock rotation only (no selecting)."}
            >
              <Icon name="rotate" />
            </button>
            <span className="phase" data-tut="phase">
              <Icon name={PHASE_ICON[game.phase]} />
              {PHASE_LABEL[game.phase]}
              {game.phase === "reinforce" && (
                <strong className="phase-count" data-tut="reinforcements">
                  {game.reinforcementsRemaining}
                </strong>
              )}
            </span>
            <span className="turnno">turn {game.turn}</span>
          </div>


      {isCpu && <div className="row cpu">🤖 {active.name} ({active.difficulty}) is planning…</div>}

      {!isCpu && game.phase === "reinforce" && (
        <p className="hint">
          {hs.mustTrade ? "You hold 5+ cards — you must trade before placing." : "Click your territories to place armies."}
        </p>
      )}

      {!isCpu && !hs.engagement && game.phase === "attack" && !pending && (
        <div className="row">
          <button onClick={hs.endAttack}>End attack <Icon name="arrow-right" size={14} /></button>
          <span className="hint">
            {hs.selectedFrom ? `Attacking from ${hs.selectedFrom} — pick a highlighted enemy.` : "Select one of your territories (2+ armies)."}
          </span>
        </div>
      )}
      {!isCpu && !hs.engagement && game.phase === "attack" && pending && (
        <div className="row">
          <span>
            Captured {pending.to} — move armies in:
          </span>
          <button onClick={() => hs.occupy(pending.max)}>Move max ({pending.max})</button>
          {pending.min !== pending.max && <button onClick={() => hs.occupy(pending.min)}>Move min ({pending.min})</button>}
        </div>
      )}

      {!isCpu && game.phase === "fortify" && (
        <div className="row">
          <button onClick={hs.endTurn}>End turn <Icon name="skip-forward" size={14} /></button>
          <span className="hint">
            {hs.selectedFrom ? `Move from ${hs.selectedFrom} to a highlighted territory.` : "Optionally fortify: select a territory (2+ armies)."}
          </span>
        </div>
      )}

      <div className="hovered">{hovered ? `${hovered}${game.territories[hovered] ? ` — ${game.territories[hovered].armies} armies` : " (not in play)"}` : " "}</div>

      <ul className="log">
        {hs.log.map((e, i) => (
          <li key={i}>{describe(e)}</li>
        ))}
      </ul>

      {winner && (
        <div className="banner">
          <Icon name="leaderboards" style={{ color: "#f5c842" }} />
          {winner.name} wins!
          <button onClick={hs.reset}>New game</button>
        </div>
      )}
      {!winner && (
        <div className="footer-row">
          {game.options.campaign && !isCpu && (
            <button className="campaign-btn" onClick={() => setCampaignOpen(true)}>
              <Icon name="star" /> Campaign
            </button>
          )}
          <button className="options-btn" data-tut="options" onClick={() => setOptionsOpen(true)}>
            <Icon name="settings" /> Options
          </button>
        </div>
      )}
        </>
      )}
    </div>
    {optionsOpen && !winner && <OptionsDialog hs={hs} onClose={() => setOptionsOpen(false)} onHelp={onOpenHelp} />}
    {campaignOpen && active.kind === "human" && <CampaignDialog game={game} onClose={() => setCampaignOpen(false)} />}
    </>
  );
}
