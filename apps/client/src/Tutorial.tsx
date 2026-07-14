import { useEffect, useLayoutEffect, useState } from "react";
import type { Hotseat } from "./game/useHotseat.js";

/** Ordered guided tour. Each step points a speech bubble at a [data-tut] element. */
const STEPS: { sel: string; text: string }[] = [
  { sel: "player", text: "This is the active player — whose turn it is right now." },
  { sel: "phase", text: "The current phase: Reinforce, then Attack, then Fortify." },
  { sel: "reinforcements", text: "Armies you still have to place this Reinforce phase — click your territories to deploy them." },
  { sel: "mode", text: "Rotate-lock: turn it on to spin the globe freely, off to select territories. You can always drag to rotate." },
  { sel: "options", text: "Options — toggle tutorial and auto-rotate, or quit back to the menu." },
  { sel: "player-current", text: "In the roster, this chevron marks the player whose turn it is." },
  { sel: "cards", text: "Your RISK cards. Trade a set of three for bonus armies during Reinforce." },
  { sel: "progress", text: "How much of each continent you hold." },
  { sel: "bonus", text: "Bonus armies you collect each turn for holding the whole continent." },
  { sel: "continent-row", text: "Click a continent to highlight it, then click a country to rotate the globe to it." },
];

export function Tutorial({ hs }: { hs: Hotseat }) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const game = hs.game;
  const active = game?.players.find((p) => p.id === game.activePlayer);
  const show = !!game && hs.tutorial && !done && active?.kind === "human";
  const step = STEPS[i];

  // Restart the tour whenever the tutorial is (re)enabled.
  useEffect(() => {
    if (!hs.tutorial) {
      setI(0);
      setDone(false);
    }
  }, [hs.tutorial]);

  useLayoutEffect(() => {
    if (!show) return;
    const el = document.querySelector<HTMLElement>(`[data-tut="${step.sel}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [show, i, step.sel]);

  if (!show) return null;

  const last = i === STEPS.length - 1;
  const next = () => (last ? setDone(true) : setI((n) => n + 1));

  const W = 268;
  const below = rect ? rect.top < window.innerHeight * 0.5 : true;
  const cx = rect
    ? Math.min(Math.max(rect.left + rect.width / 2, W / 2 + 10), window.innerWidth - W / 2 - 10)
    : window.innerWidth / 2;
  const bubbleStyle: React.CSSProperties = rect
    ? {
        left: cx,
        top: below ? rect.bottom + 14 : rect.top - 14,
        transform: below ? "translateX(-50%)" : "translateX(-50%) translateY(-100%)",
      }
    : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };

  return (
    <>
      {rect && (
        <div
          className="tut-ring"
          style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div className="tut-bubble" style={bubbleStyle}>
        {rect && <span className={`tut-arrow ${below ? "up" : "down"}`} />}
        <p>{step.text}</p>
        <div className="tut-actions">
          <button className="quiet" onClick={() => setDone(true)}>
            Skip
          </button>
          <span className="tut-step">
            {i + 1} / {STEPS.length}
          </span>
          <button className="start" onClick={next}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
