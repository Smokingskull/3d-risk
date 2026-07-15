import { useState } from "react";
import type { BoardMode, GameState } from "@risk3d/engine";
import type { SeatSpec } from "./game/useHotseat.js";
import { NewGameDialog } from "./NewGameDialog.js";
import { HelpDialog } from "./HelpDialog.js";
import { ScenariosDialog } from "./ScenariosDialog.js";
import { Icon } from "./Icon.js";
import { getTutorialEnabled, setTutorialEnabled } from "./settings.js";

type Dialog =
  | { kind: "new"; campaign: boolean }
  | { kind: "help" }
  | { kind: "scenarios" }
  | { kind: "options" }
  | null;

interface Props {
  onStart: (mode: BoardMode, seats: SeatSpec[], names: string[], campaign: boolean, actionCards: boolean) => void;
  onLoadScenario: (state: GameState) => void;
}

export function Home({ onStart, onLoadScenario }: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);

  return (
    <div className="home">
      <div className="home-inner">
        <img className="home-banner" src="/assets/images/banner.png" alt="3D Risk — Dominate. Conquer. Control." />
        <div className="home-actions">
          <button className="home-btn primary" onClick={() => setDialog({ kind: "new", campaign: false })}>
            New Game
            <span className="home-desc">Standard RISK — set up your players and conquer the world.</span>
          </button>
          <button className="home-btn primary" onClick={() => setDialog({ kind: "new", campaign: true })}>
            New Campaign
            <span className="home-desc">Every player gets a secret objective — hold a country, seize a continent, or assassinate a rival. First to complete theirs wins.</span>
          </button>
          <button className="home-btn primary" onClick={() => setDialog({ kind: "scenarios" })}>
            Scenarios
            <span className="home-desc">Refight history — Alexander, Rome, the Mongols, Napoleon, the World Wars. Command a faction and chase its objective.</span>
          </button>
          <button className="home-btn" onClick={() => setDialog({ kind: "options" })}>
            Options
          </button>
        </div>
        <img className="home-emblem" src="/assets/images/winged-emblem.png" alt="" />
      </div>

      {dialog?.kind === "new" && (
        <NewGameDialog campaign={dialog.campaign} onStart={onStart} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "scenarios" && (
        <ScenariosDialog onPlay={onLoadScenario} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "options" && (
        <HomeOptionsDialog onClose={() => setDialog(null)} onHelp={() => setDialog({ kind: "help" })} />
      )}
      {dialog?.kind === "help" && <HelpDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/** The home-menu Options popup — mirrors the in-game Options: the tutorial-tips
 *  toggle plus a route into Help. Auto-rotate / Quit-to-Menu live in-game only. */
function HomeOptionsDialog({ onClose, onHelp }: { onClose: () => void; onHelp: () => void }) {
  const [tutorial, setTutorial] = useState(getTutorialEnabled);
  const toggleTutorial = () => {
    const next = !tutorial;
    setTutorial(next);
    setTutorialEnabled(next);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card options-card" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h2>Options</h2>
          <button className="tut-x" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <label className="toggle">
          <input type="checkbox" checked={tutorial} onChange={toggleTutorial} />
          <span>Show tutorial tips — on-screen prompts for each phase (recommended for new players)</span>
        </label>

        <button
          className="options-help"
          onClick={() => {
            onClose();
            onHelp();
          }}
        >
          <Icon name="help" /> Help &amp; how to play
        </button>

        <div className="options-actions">
          <button className="start" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
