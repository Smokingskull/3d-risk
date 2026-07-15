import { useState } from "react";
import type { BoardMode, GameState } from "@risk3d/engine";
import type { SeatSpec } from "./game/useHotseat.js";
import { NewGameDialog } from "./NewGameDialog.js";
import { HelpDialog } from "./HelpDialog.js";
import { ScenariosDialog } from "./ScenariosDialog.js";
import { Icon } from "./Icon.js";
import { Button, Dialog, Toggle } from "./ui/index.js";
import { getTutorialEnabled, setTutorialEnabled } from "./settings.js";

type Dialog =
  | { kind: "new" }
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
          <button className="home-btn primary" onClick={() => setDialog({ kind: "new" })}>
            New Game
            <span className="home-desc">Set up your players and conquer the world. Turn on Campaign cards to play for secret objectives instead.</span>
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
        <NewGameDialog onStart={onStart} onClose={() => setDialog(null)} />
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
    <Dialog title="Options" cardClassName="options-card" onClose={onClose}>
      <Toggle checked={tutorial} onChange={toggleTutorial}>
        Show tutorial tips — on-screen prompts for each phase (recommended for new players)
      </Toggle>

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
        <Button onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}
