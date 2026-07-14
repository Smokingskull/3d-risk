import { useState } from "react";
import type { BoardMode } from "@risk3d/engine";
import type { SeatSpec } from "./game/useHotseat.js";
import { NewGameDialog } from "./NewGameDialog.js";
import { HelpDialog } from "./HelpDialog.js";

type Dialog = { kind: "new"; campaign: boolean } | { kind: "help" } | null;

interface Props {
  onStart: (mode: BoardMode, seats: SeatSpec[], tutorial: boolean, names: string[], campaign: boolean) => void;
}

export function Home({ onStart }: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);

  return (
    <div className="home">
      <div className="home-inner">
        <img className="home-banner" src="/assets/images/banner.png" alt="3D Risk — Dominate. Conquer. Control." />
        <div className="home-actions">
          <button className="home-btn primary" onClick={() => setDialog({ kind: "new", campaign: false })}>
            New Game
            <span className="home-desc">Standard RISK — choose the Classic or Modern map, then conquer the world.</span>
          </button>
          <button className="home-btn primary" onClick={() => setDialog({ kind: "new", campaign: true })}>
            New Campaign
            <span className="home-desc">Every player gets a secret objective — hold a country, seize a continent, or assassinate a rival. First to complete theirs wins.</span>
          </button>
          <button className="home-btn" onClick={() => setDialog({ kind: "help" })}>
            How To Play
          </button>
        </div>
        <img className="home-emblem" src="/assets/images/winged-emblem.png" alt="" />
      </div>

      {dialog?.kind === "new" && (
        <NewGameDialog campaign={dialog.campaign} onStart={onStart} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "help" && <HelpDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
