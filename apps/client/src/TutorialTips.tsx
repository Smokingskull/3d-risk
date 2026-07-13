import { useState } from "react";
import type { Hotseat } from "./game/useHotseat.js";

/** One tip per stage. Keyed by the stage the player is currently in. */
const TIPS: Record<string, { title: string; body: string }> = {
  reinforce: {
    title: "Reinforce",
    body: "Click your own territories to place your armies. Your goal is to hold whole continents — that earns bonus armies each turn. Holding 3+ matching cards? Trade them for extra armies.",
  },
  attack: {
    title: "Attack",
    body: "Click one of your territories with 2+ armies, then a highlighted enemy neighbour to open the battle. There you can roll once, or “Attack till resolved”, and see the dice and your win chance. Press “End attack” on the panel when you're done.",
  },
  occupy: {
    title: "You conquered a territory!",
    body: "Choose how many armies to move into it with the “Move” buttons — push forward to press an advance, or keep a garrison behind if that border is still exposed.",
  },
  fortify: {
    title: "Fortify",
    body: "Optionally move armies once between two of your connected territories to shore up a border, then press “End turn”. Capture at least one territory this turn to earn a card.",
  },
};

export function TutorialTips({ hs }: { hs: Hotseat }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const game = hs.game;
  if (!game || game.winner || !hs.tutorial || !hs.isHumanTurn) return null;

  const key = game.pendingOccupation ? "occupy" : game.phase;
  if (dismissed.has(key)) return null;
  const tip = TIPS[key];
  if (!tip) return null;

  return (
    <div className="tutorial">
      <div className="tut-head">
        <span className="tut-badge">Tutorial</span>
        <strong>{tip.title}</strong>
        <button className="tut-x" aria-label="Dismiss" onClick={() => setDismissed((d) => new Set(d).add(key))}>
          ×
        </button>
      </div>
      <p>{tip.body}</p>
      <button className="tut-off" onClick={hs.toggleTutorial}>
        Turn tutorial off
      </button>
    </div>
  );
}
