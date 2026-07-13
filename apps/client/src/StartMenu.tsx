import { useState } from "react";
import type { BoardMode } from "@risk3d/engine";
import type { SeatSpec } from "./game/useHotseat.js";
import { PLAYER_COLORS } from "./players.js";

type SeatChoice = "human" | "easy" | "medium" | "hard";
const CHOICES: SeatChoice[] = ["human", "easy", "medium", "hard"];
const LABEL: Record<SeatChoice, string> = { human: "Human", easy: "Easy", medium: "Medium", hard: "Hard" };

function toSpec(choice: SeatChoice): SeatSpec {
  return choice === "human" ? { kind: "human" } : { kind: "cpu", difficulty: choice };
}

interface StartMenuProps {
  onStart: (mode: BoardMode, seats: SeatSpec[], tutorial: boolean) => void;
  onShowRules: () => void;
}

export function StartMenu({ onStart, onShowRules }: StartMenuProps) {
  const [mode, setMode] = useState<BoardMode>("classic");
  const [seats, setSeats] = useState<SeatChoice[]>(["human", "medium", "medium"]);
  const [tutorial, setTutorial] = useState(true);

  const setCount = (n: number) => {
    setSeats((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("medium");
      return next;
    });
  };
  const setSeat = (i: number, c: SeatChoice) =>
    setSeats((prev) => prev.map((s, idx) => (idx === i ? c : s)));

  return (
    <div className="menu">
      <div className="menu-card">
        <h1>3D Risk</h1>
        <p className="tagline">Play locally against friends and CPU generals.</p>

        <label className="field">
          <span>Board</span>
          <div className="choices">
            <button className={mode === "classic" ? "sel" : ""} onClick={() => setMode("classic")}>
              Classic <em>42 territories</em>
            </button>
            <button className={mode === "world" ? "sel" : ""} onClick={() => setMode("world")}>
              World <em>177 countries</em>
            </button>
          </div>
        </label>

        <label className="field">
          <span>Players</span>
          <div className="choices">
            {[2, 3, 4, 5, 6].map((n) => (
              <button key={n} className={seats.length === n ? "sel" : ""} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </label>

        <div className="field">
          <span>Seats</span>
          {seats.map((choice, i) => (
            <div className="seat" key={i}>
              <span className="dot" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }} />
              <span className="seat-no">P{i + 1}</span>
              <div className="segmented">
                {CHOICES.map((c) => (
                  <button key={c} className={choice === c ? "sel" : ""} onClick={() => setSeat(i, c)}>
                    {LABEL[c]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <label className="toggle">
          <input type="checkbox" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} />
          <span>Tutorial tips — on-screen prompts for each phase (recommended for new players)</span>
        </label>

        <div className="menu-actions">
          <button className="start" onClick={() => onStart(mode, seats.map(toSpec), tutorial)}>
            Start game
          </button>
          <button className="link" onClick={onShowRules}>
            How to play
          </button>
        </div>
      </div>
    </div>
  );
}
