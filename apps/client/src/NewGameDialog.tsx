import { useState } from "react";
import type { BoardMode } from "@risk3d/engine";
import type { SeatSpec } from "./game/useHotseat.js";
import { PLAYER_COLORS } from "./players.js";
import { Button, Dialog, Dot, Field, Segmented } from "./ui/index.js";

type SeatChoice = "human" | "easy" | "medium" | "hard";
const CHOICES: { value: SeatChoice; label: string }[] = [
  { value: "human", label: "Human" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];
const toSpec = (c: SeatChoice): SeatSpec => (c === "human" ? { kind: "human" } : { kind: "cpu", difficulty: c });
const defaultName = (i: number) => `Player ${i + 1}`;

// Games are played on the Classic board.
const MODE: BoardMode = "classic";

const YES_NO = [
  { value: true, label: "Yes" },
  { value: false, label: "No" },
];

interface Props {
  onStart: (mode: BoardMode, seats: SeatSpec[], names: string[], campaign: boolean, actionCards: boolean) => void;
  onClose: () => void;
}

export function NewGameDialog({ onStart, onClose }: Props) {
  const [seats, setSeats] = useState<SeatChoice[]>(["human", "medium", "medium"]);
  const [names, setNames] = useState<string[]>([0, 1, 2].map(defaultName));
  const [campaign, setCampaign] = useState(false);
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
    <Dialog title="New Game" cardClassName="new-game" onClose={onClose}>
      <Field
        label="Campaign cards"
        hint="Deal every player a secret objective — hold a country, seize a continent or assassinate a rival. First to complete theirs wins. No plays a standard last-general-standing game."
      >
        <Segmented options={YES_NO} value={campaign} onChange={setCampaign} ariaLabel="Campaign cards" />
      </Field>

      <Field label="Action cards" hint="Deal each player 2 secret one-shot special cards to manage.">
        <Segmented options={YES_NO} value={actionCards} onChange={setActionCards} ariaLabel="Action cards" />
      </Field>

      <Field label="Players">
        <Segmented
          options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: n }))}
          value={seats.length}
          onChange={setCount}
          ariaLabel="Number of players"
        />
      </Field>

      <Field label="Seats">
        {seats.map((choice, i) => (
          <div className="seat" key={i}>
            <Dot color={PLAYER_COLORS[i % PLAYER_COLORS.length]} />
            <input
              className="seat-name"
              value={names[i] ?? ""}
              maxLength={18}
              placeholder={defaultName(i)}
              onChange={(e) => setName(i, e.target.value)}
              aria-label={`Name for player ${i + 1}`}
            />
            <Segmented options={CHOICES} value={choice} onChange={(c) => setSeat(i, c)} ariaLabel={`Player ${i + 1} type`} />
          </div>
        ))}
      </Field>

      <Button onClick={() => onStart(MODE, seats.map(toSpec), names, campaign, actionCards)}>
        {campaign ? "Start campaign" : "Start game"}
      </Button>
    </Dialog>
  );
}
