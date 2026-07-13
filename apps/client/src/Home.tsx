import { useState } from "react";
import type { BoardMode } from "@risk3d/engine";
import type { SeatSpec } from "./game/useHotseat.js";
import { NewGameDialog } from "./NewGameDialog.js";
import { RulesDialog } from "./RulesDialog.js";

type Dialog = { kind: "new"; mode: BoardMode } | { kind: "rules" } | null;

interface Props {
  onStart: (mode: BoardMode, seats: SeatSpec[], tutorial: boolean, names: string[]) => void;
}

export function Home({ onStart }: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);

  return (
    <div className="home">
      <div className="home-inner">
        <img className="home-banner" src="/assets/images/banner.png" alt="3D Risk — Dominate. Conquer. Control." />
        <div className="home-actions">
          <button className="home-btn primary" onClick={() => setDialog({ kind: "new", mode: "classic" })}>
            New Classic Game
            <span className="home-desc">Close to the classic board — country groups across the traditional six continents. A quicker game.</span>
          </button>
          <button className="home-btn primary" onClick={() => setDialog({ kind: "new", mode: "world" })}>
            New Modern Game
            <span className="home-desc">Every one of the world's 177 real countries as its own territory. A longer, sprawling campaign.</span>
          </button>
          <button className="home-btn" onClick={() => setDialog({ kind: "rules" })}>
            How To Play
          </button>
        </div>
        <img className="home-emblem" src="/assets/images/winged-emblem.png" alt="" />
      </div>

      {dialog?.kind === "new" && (
        <NewGameDialog mode={dialog.mode} onStart={onStart} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "rules" && <RulesDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
