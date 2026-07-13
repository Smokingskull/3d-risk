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
        <img className="home-banner" src="/banner.png" alt="3D Risk — Dominate. Conquer. Control." />
        <div className="home-actions">
          <button className="home-btn primary" onClick={() => setDialog({ kind: "new", mode: "classic" })}>
            New Classic Game
          </button>
          <button className="home-btn primary" onClick={() => setDialog({ kind: "new", mode: "world" })}>
            New Modern Game
          </button>
          <button className="home-btn" onClick={() => setDialog({ kind: "rules" })}>
            How To Play
          </button>
        </div>
      </div>

      {dialog?.kind === "new" && (
        <NewGameDialog mode={dialog.mode} onStart={onStart} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "rules" && <RulesDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
