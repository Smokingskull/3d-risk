import { useState } from "react";
import type { GameState } from "@risk3d/engine";
import { SCENARIOS, scenarioById } from "./scenarios/index.js";
import { Icon } from "./Icon.js";

/** Pick a pre-built scenario (names on the left, description on the right) and Play. */
export function ScenariosDialog({
  onPlay,
  onClose,
}: {
  onPlay: (state: GameState) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(SCENARIOS[0]?.id);
  const scenario = scenarioById(active) ?? SCENARIOS[0];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card help-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h2>Scenarios</h2>
          <button className="tut-x" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {scenario ? (
          <>
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
              </div>
            </div>
            <div className="dialog-foot">
              <button className="quiet" onClick={onClose}>
                Cancel
              </button>
              <button className="start" onClick={() => onPlay(scenario.load())}>
                Play
              </button>
            </div>
          </>
        ) : (
          <p className="hint">No scenarios available.</p>
        )}
      </div>
    </div>
  );
}
