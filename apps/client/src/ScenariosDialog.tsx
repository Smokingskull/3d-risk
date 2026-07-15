import { useState } from "react";
import type { GameState } from "@risk3d/engine";
import { SCENARIOS, scenarioById } from "./scenarios/index.js";
import { Icon } from "./Icon.js";

/**
 * Pick a scenario from the list on the left and read its briefing on the right.
 * Every scenario plays as designed: the board, player count, each seat's CPU
 * difficulty and which faction you command are all fixed by the scenario file.
 * The factions are listed with your side marked, but none can be reassigned.
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

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card scenarios-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h2>Scenarios</h2>
          <button className="tut-x" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {!scenario ? (
          <p className="hint">No scenarios available.</p>
        ) : (
          <>
            <div className="scenarios-body">
              <ul className="scenario-list" role="listbox" aria-label="Scenarios">
                {SCENARIOS.map((s) => (
                  <li key={s.id} role="option" aria-selected={s.id === active}>
                    <button className={s.id === active ? "sel" : ""} onClick={() => setActive(s.id)}>
                      {s.name}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="scenario-detail" key={scenario.id}>
                <h3>{scenario.name}</h3>
                <p>{scenario.description}</p>
                <div className="scenario-seats">
                  <span className="field-label">Factions</span>
                  {scenario.seats.map((seat) => (
                    <div className="scenario-seat" key={seat.id}>
                      <span className="dot" style={{ background: seat.color }} />
                      <span className="seat-label">{seat.name}</span>
                      {seat.id === scenario.defaultHuman && <span className="seat-you">You</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="dialog-foot">
              <button className="quiet" onClick={onClose}>
                Cancel
              </button>
              <button className="start" onClick={() => onPlay(scenario.build(new Set([scenario.defaultHuman])))}>
                Play
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
