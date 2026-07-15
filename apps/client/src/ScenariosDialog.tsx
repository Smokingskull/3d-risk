import { useState } from "react";
import type { GameState } from "@risk3d/engine";
import { SCENARIOS, scenarioById, DIFFICULTY } from "./scenarios/index.js";
import { Button, Dialog, Dot } from "./ui/index.js";

/** Human-readable label for a CPU seat's AI level (falls back to the raw value). */
const AI_LABEL: Record<string, string> = {
  easy: "Easy AI",
  medium: "Medium AI",
  hard: "Hard AI",
  joshua: "Joshua",
};

/**
 * Pick a scenario from the list on the left and read its briefing on the right.
 * Every scenario plays as designed: the board, player count, each seat's CPU
 * difficulty and which faction you command are all fixed by the scenario file.
 * The roster shows which side is yours (Human) and each rival's AI level, but
 * none can be reassigned.
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

  // Arrow / Home / End navigation for the list box.
  function onListKeyDown(e: React.KeyboardEvent) {
    const i = SCENARIOS.findIndex((s) => s.id === active);
    if (i < 0) return;
    let next = i;
    if (e.key === "ArrowDown") next = Math.min(SCENARIOS.length - 1, i + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, i - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = SCENARIOS.length - 1;
    else return;
    e.preventDefault();
    setActive(SCENARIOS[next].id);
    document.getElementById(`scenario-opt-${SCENARIOS[next].id}`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <Dialog title="Scenarios" cardClassName="scenarios-dialog" onClose={onClose}>
      {!scenario ? (
        <p className="hint">No scenarios available.</p>
      ) : (
        <>
          <div className="scenarios-body">
              <ul
                className="scenario-list"
                role="listbox"
                aria-label="Scenarios"
                tabIndex={0}
                aria-activedescendant={`scenario-opt-${active}`}
                onKeyDown={onListKeyDown}
              >
                {SCENARIOS.map((s) => (
                  <li
                    key={s.id}
                    id={`scenario-opt-${s.id}`}
                    role="option"
                    aria-selected={s.id === active}
                  >
                    <button className={s.id === active ? "sel" : ""} onClick={() => setActive(s.id)}>
                      <span className="scenario-list-name">{s.name}</span>
                      <span className={`diff-chip diff-${s.difficulty}`}>{DIFFICULTY[s.difficulty].label}</span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="scenario-detail" key={scenario.id}>
                <h3>{scenario.name}</h3>

                <div className="scenario-section">
                  <span className="field-label">Difficulty</span>
                  <div className="difficulty-row">
                    <span className={`difficulty-pill diff-${scenario.difficulty}`}>
                      {DIFFICULTY[scenario.difficulty].label}
                    </span>
                  </div>
                  {scenario.difficultyNote && <p className="difficulty-note">{scenario.difficultyNote}</p>}
                </div>

                <div className="scenario-section">
                  <span className="field-label">Briefing</span>
                  <p>{scenario.description}</p>
                </div>

                <div className="scenario-section">
                  <span className="field-label">Factions</span>
                  <div className="scenario-seats">
                    {scenario.seats.map((seat) => {
                      const you = seat.id === scenario.defaultHuman;
                      return (
                        <div className="scenario-seat" key={seat.id}>
                          <Dot color={seat.color} />
                          <span className="seat-label">{seat.name}</span>
                          {you ? (
                            <span className="seat-you">You · Human</span>
                          ) : (
                            <span className="seat-tag">
                              CPU{seat.cpuDifficulty ? ` · ${AI_LABEL[seat.cpuDifficulty] ?? seat.cpuDifficulty}` : ""}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="dialog-foot">
              <Button variant="quiet" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => onPlay(scenario.build(new Set([scenario.defaultHuman])))}>
                Play
              </Button>
            </div>
          </>
        )}
    </Dialog>
  );
}
