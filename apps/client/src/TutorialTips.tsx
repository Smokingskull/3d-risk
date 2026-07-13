import type { Hotseat } from "./game/useHotseat.js";

/** One tip per stage. Keyed by the stage the player is currently in. */
const TIPS: Record<string, { title: string; body: string }> = {
  reinforce: {
    title: "Reinforce",
    body: "Click one of your territories to open its dialog, choose how many armies to deploy, and confirm. Your goal is to hold whole continents — that earns bonus armies each turn. Holding 3+ matching cards? Trade them for extra armies.",
  },
  attack: {
    title: "Attack",
    body: "Click one of your territories (2+ armies) and choose “Attack from here”, then click a highlighted enemy neighbour and confirm to open the battle — roll once or “Attack till resolved”, and see the dice and your win chance. “End attack” on the panel when done.",
  },
  occupy: {
    title: "You conquered a territory!",
    body: "Choose how many armies to move into it with the “Move” buttons — push forward to press an advance, or keep a garrison behind if that border is still exposed.",
  },
  fortify: {
    title: "Fortify",
    body: "Optionally move armies once between two connected territories: click a source and choose “Move from here”, then a connected territory and set how many to move. Then “End turn”. Capture at least one territory this turn to earn a card.",
  },
};

export function TutorialTips({ hs }: { hs: Hotseat }) {
  const game = hs.game;
  if (!game || game.winner || !hs.tutorial || !hs.isHumanTurn) return null;

  const key = game.pendingOccupation ? "occupy" : game.phase;
  const tip = TIPS[key];
  if (!tip) return null;

  return (
    <div className="tutorial">
      <div className="tut-head">
        <span className="tut-badge">Tutorial</span>
        <strong>{tip.title}</strong>
      </div>
      <p>{tip.body}</p>
      <button className="tut-off" onClick={hs.toggleTutorial}>
        Turn tutorial off
      </button>
    </div>
  );
}
