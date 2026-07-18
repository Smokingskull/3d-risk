import { useEffect, useMemo, useState } from "react";

/**
 * The WarGames easter egg. Shown when a human beats a game that included the
 * Joshua (WOPR) CPU tier: a black terminal that types the film's closing lines one
 * character at a time behind a filled block cursor. It can only be dismissed once
 * the message has finished — then a CONTINUE control (also Enter/click) fires
 * `onDone`, which hands back to the normal end-of-game flow.
 *
 * WarGames (1983): after Joshua/WOPR plays out every nuclear scenario to stalemate,
 * it concludes "the only winning move is not to play" and asks for a game of chess.
 */
const MESSAGE = "GREETINGS, PROFESSOR FALKEN.\n\nA STRANGE GAME.  THE ONLY WINNING MOVE IS NOT TO PLAY.\n\nHOW ABOUT A NICE GAME OF CHESS?";

const CHAR_MS = 55; // per-character reveal cadence
const LINE_PAUSE_MS = 420; // extra dwell on each newline (a beat between paragraphs)

export function WoprTerminal({ onDone }: { onDone: () => void }) {
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const [shown, setShown] = useState(reducedMotion ? MESSAGE.length : 0);
  const done = shown >= MESSAGE.length;

  // Reveal one character per tick; dwell a little longer on line breaks so the three
  // lines land as separate beats.
  useEffect(() => {
    if (done) return;
    const delay = MESSAGE[shown] === "\n" ? LINE_PAUSE_MS : CHAR_MS;
    const id = setTimeout(() => setShown((n) => n + 1), delay);
    return () => clearTimeout(id);
  }, [shown, done]);

  // Once complete, Enter / Space / Escape also dismiss (as well as the button / a click).
  useEffect(() => {
    if (!done) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        e.preventDefault();
        onDone();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, onDone]);

  return (
    <div className="wopr" role="dialog" aria-modal="true" aria-label="WOPR terminal" onClick={done ? onDone : undefined}>
      <pre className="wopr-screen">
        {MESSAGE.slice(0, shown)}
        <span className={`wopr-cursor${done ? " wopr-cursor-blink" : ""}`}>█</span>
      </pre>
      {done && (
        <button
          type="button"
          className="wopr-continue"
          autoFocus
          onClick={(e) => {
            e.stopPropagation();
            onDone();
          }}
        >
          [ CONTINUE ]
        </button>
      )}
    </div>
  );
}
