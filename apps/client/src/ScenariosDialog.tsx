import { useEffect, useState } from "react";
import type { GameState } from "@risk3d/engine";
import { SCENARIOS, scenarioById } from "./scenarios/index.js";
import { Icon } from "./Icon.js";

/**
 * Pick a scenario (names on the left, details on the right) and choose which
 * named seat you play as before starting. The board, player count and each
 * seat's CPU difficulty are fixed by the scenario file, so none are shown.
 */
export function ScenariosDialog({
  onPlay,
  onClose,
}: {
  onPlay: (state: GameState) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(SCENARIOS[0]?.id);
  const scenario = scenarioById(active) ?? SCENARIOS[0];
  const [humans, setHumans] = useState<Set<string>>(
    () => new Set(scenario ? [scenario.defaultHuman] : []),
  );

  // Reset the seat choices to the scenario's default whenever the selection changes.
  useEffect(() => {
    const s = scenarioById(active);
    setHumans(new Set(s ? [s.defaultHuman] : []));
  }, [active]);

  if (!scenario) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="overlay-card help-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="overlay-head">
            <h2>Scenarios</h2>
            <button className="tut-x" aria-label="Close" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <p className="hint">No scenarios available.</p>
        </div>
      </div>
    );
  }

  const setSeat = (id: string, human: boolean) =>
    setHumans((prev) => {
      const next = new Set(prev);
      if (human) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card help-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h2>Scenarios</h2>
          <button className="tut-x" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="help-body">
          <nav className="help-nav">
            {SCENARIOS.map((s) => (
              <button key={s.id} className={s.id === active ? "sel" : ""} onClick={() => setActive(s.id)}>
                {s.name}
              </button>
            ))}
          </nav>
          <div className="help-content" key={scenario.id}>
            <h3>{scenario.name}</h3>
            <p>{scenario.description}</p>
            <div className="scenario-seats">
              <span className="field-label">Play as</span>
              {scenario.seats.map((seat) => (
                <div className="scenario-seat" key={seat.id}>
                  <span className="dot" style={{ background: seat.color }} />
                  <span className="seat-label">{seat.name}</span>
                  <div className="segmented">
                    <button className={humans.has(seat.id) ? "sel" : ""} onClick={() => setSeat(seat.id, true)}>
                      Human
                    </button>
                    <button className={!humans.has(seat.id) ? "sel" : ""} onClick={() => setSeat(seat.id, false)}>
                      CPU
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dialog-foot">
          <button className="quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="start" onClick={() => onPlay(scenario.build(humans))}>
            Play
          </button>
        </div>
      </div>
    </div>
  );
}
