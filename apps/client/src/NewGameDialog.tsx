import { useState } from "react";
import type { BoardMode } from "@risk3d/engine";
import type { SeatSpec } from "./game/useHotseat.js";
import { PLAYER_COLORS } from "./players.js";
import { Icon } from "./Icon.js";

type SeatChoice = "human" | "easy" | "medium" | "hard";
const CHOICES: SeatChoice[] = ["human", "easy", "medium", "hard"];
const LABEL: Record<SeatChoice, string> = { human: "Human", easy: "Easy", medium: "Medium", hard: "Hard" };
const toSpec = (c: SeatChoice): SeatSpec => (c === "human" ? { kind: "human" } : { kind: "cpu", difficulty: c });
const defaultName = (i: number) => `Player ${i + 1}`;

// The board is fixed to the Classic map for now — the Modern map isn't offered yet.
const MODE: BoardMode = "classic";

interface Props {
  campaign: boolean;
  onStart: (mode: BoardMode, seats: SeatSpec[], names: string[], campaign: boolean, actionCards: boolean) => void;
  onClose: () => void;
}

export function NewGameDialog({ campaign, onStart, onClose }: Props) {
  const [seats, setSeats] = useState<SeatChoice[]>(["human", "medium", "medium"]);
  const [names, setNames] = useState<string[]>([0, 1, 2].map(defaultName));
  const [actionCards, setActionCards] = useState(false);

  const setCount = (n: number) => {
    setSeats((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("medium");
      return next;
    });
    setNames((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(defaultName(next.length));
      return next;
    });
  };
  const setSeat = (i: number, c: SeatChoice) => setSeats((prev) => prev.map((s, idx) => (idx === i ? c : s)));
  const setName = (i: number, v: string) => setNames((prev) => prev.map((s, idx) => (idx === i ? v : s)));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card new-game" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h2>New {campaign ? "Campaign" : "Game"}</h2>
          <button className="tut-x" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>

        <label className="field">
          <span>Action cards</span>
          <div className="segmented">
            <button className={actionCards ? "sel" : ""} onClick={() => setActionCards(true)}>
              Yes
            </button>
            <button className={!actionCards ? "sel" : ""} onClick={() => setActionCards(false)}>
              No
            </button>
          </div>
          <span className="field-hint">Deal each player 2 secret one-shot special cards to manage.</span>
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
              <input
                className="seat-name"
                value={names[i] ?? ""}
                maxLength={18}
                placeholder={defaultName(i)}
                onChange={(e) => setName(i, e.target.value)}
                aria-label={`Name for player ${i + 1}`}
              />
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

        <button className="start" onClick={() => onStart(MODE, seats.map(toSpec), names, campaign, actionCards)}>
          {campaign ? "Start campaign" : "Start game"}
        </button>
      </div>
    </div>
  );
}
