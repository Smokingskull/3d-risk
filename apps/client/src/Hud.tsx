import { useState } from "react";
import { perceivedArmies } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";
import { Button, Dot } from "./ui/index.js";
import { OptionsDialog } from "./OptionsDialog.js";
import { CampaignDialog } from "./CampaignDialog.js";
import { PhaseRail } from "./PhaseRail.js";
import { TurnStats } from "./TurnStats.js";

export function Hud({ hs, hovered, onOpenHelp, onOpenCards }: { hs: Hotseat; hovered: string | null; onOpenHelp: () => void; onOpenCards: () => void }) {
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
        <h1>{open ? `Game — Turn ${game.turn}` : `Turn ${game.turn} (${active.name})`}</h1>
        <button className="collapse" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={16} />
        </button>
      </div>

      {open && (
        <>
          <div className="turn">
            <Dot color={active.color} />
            <strong data-tut="player">{active.name}</strong>
          </div>

          <PhaseRail game={game} reinforceTotal={hs.reinforceTotal} />


      {isCpu && (
        <div className={`row cpu${hs.thinking ? " thinking" : ""}`}>
          🤖 {active.name} ({active.difficulty === "joshua" ? "Joshua" : active.difficulty}){" "}
          {active.difficulty === "joshua" ? "is thinking…" : "is planning…"}
          {active.difficulty === "joshua" && <em className="cpu-flavour"> Shall we play a game?</em>}
        </div>
      )}

      {!isCpu && game.phase === "reinforce" && (
        hs.mustTrade ? (
          <div className="banner trade-banner">
            <span>You hold 5+ cards — you must trade a set before deploying.</span>
            <Button onClick={onOpenCards}>Trade cards</Button>
          </div>
        ) : (
          <p className="hint">Click your territories to place armies.</p>
        )
      )}

      {!isCpu && !hs.engagement && game.phase === "attack" && !pending && (
        <div className="row action-row">
          <button onClick={hs.endAttack}>End attack <Icon name="arrow-right" size={14} /></button>
          <button className="end-turn" onClick={hs.endTurnNow}>End turn <Icon name="skip-forward" size={14} /></button>
          <span className="hint">
            {hs.selectedFrom ? `Attacking from ${hs.selectedFrom} — pick a highlighted enemy.` : "Attacks are optional — attack, or end your turn."}
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
        <div className="row action-row">
          <button className="end-turn" onClick={hs.endTurnNow}>End turn <Icon name="skip-forward" size={14} /></button>
          {game.options.actionCardsEnabled && active.actionCards.includes("troopTransport") && !game.fortifyAnywhere && (
            <button className="card-btn" onClick={() => hs.playActionCard({ type: "playActionCard", card: "troopTransport" })}>
              Troop Transport
            </button>
          )}
          <span className="hint">
            {game.fortifyAnywhere
              ? "Troop Transport active — move between any two of your territories."
              : hs.selectedFrom
                ? `Move from ${hs.selectedFrom} to a highlighted territory.`
                : "One optional move, then your turn ends."}
          </span>
        </div>
      )}

      <TurnStats game={game} playerId={active.id} />

      <div className="hovered">{hovered ? `${hovered}${game.territories[hovered] ? ` — ${hs.viewerId ? perceivedArmies(game, hs.viewerId, hovered) : game.territories[hovered].armies} armies` : " (not in play)"}` : " "}</div>

      <div className="footer-row">
        {winner ? (
          <button className="options-btn" onClick={hs.reset}>
            <Icon name="leaderboards" style={{ color: "#f5c842" }} /> New game
          </button>
        ) : (
          <>
            {game.options.campaign && !isCpu && (
              <button className="campaign-btn" onClick={() => setCampaignOpen(true)}>
                <Icon name="star" /> Campaign
              </button>
            )}
            <button className="options-btn" data-tut="options" onClick={() => setOptionsOpen(true)}>
              <Icon name="settings" /> Options
            </button>
          </>
        )}
        <button
          className={`mode-btn${hs.mode === "rotate" ? " on" : ""}`}
          data-tut="mode"
          onClick={hs.toggleMode}
          aria-pressed={hs.mode === "rotate"}
          title={hs.mode === "rotate" ? "Rotate lock ON — selection disabled. Click to enable selecting." : "Rotate lock OFF — click to lock rotation only (no selecting)."}
        >
          <Icon name="rotate" />
        </button>
      </div>
        </>
      )}
    </div>
    {optionsOpen && !winner && <OptionsDialog hs={hs} onClose={() => setOptionsOpen(false)} onHelp={onOpenHelp} />}
    {campaignOpen && active.kind === "human" && <CampaignDialog game={game} onClose={() => setCampaignOpen(false)} />}
    </>
  );
}
