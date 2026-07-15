import type { GameState } from "@risk3d/engine";
import { Icon } from "./Icon.js";

/**
 * The turn pipeline as a three-step rail: Reinforce → Attack → Fortify. Steps
 * before the current phase read as "done", the current one is highlighted, later
 * ones are dimmed. The active Reinforce step carries the placement meter (armies
 * placed of the total, mandatory); the active Fortify step notes it is one
 * optional move.
 */
const STEPS: { key: GameState["phase"]; label: string; icon: string }[] = [
  { key: "reinforce", label: "Reinforce", icon: "target" },
  { key: "attack", label: "Attack", icon: "swords" },
  { key: "fortify", label: "Fortify", icon: "shield" },
];

export function PhaseRail({ game, reinforceTotal }: { game: GameState; reinforceTotal: number }) {
  const current = STEPS.findIndex((s) => s.key === game.phase);
  const placed = Math.max(0, reinforceTotal - game.reinforcementsRemaining);
  const pct = reinforceTotal > 0 ? Math.round((placed / reinforceTotal) * 100) : 0;

  return (
    <div className="phase-rail" data-tut="phase">
      {STEPS.map((step, i) => {
        const state = i < current ? "done" : i === current ? "active" : "upcoming";
        const isReinforce = step.key === "reinforce" && state === "active";
        const isFortify = step.key === "fortify" && state === "active";
        return (
          <div key={step.key} className={`phase-step ${state}`}>
            <div className="phase-step-head">
              <Icon name={step.icon} size={14} />
              <span className="phase-step-label">{step.label}</span>
            </div>
            {isReinforce && reinforceTotal > 0 && (
              <div className="phase-meter" data-tut="reinforcements">
                <div className="phase-meter-bar">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <span className="phase-meter-count">{placed}/{reinforceTotal} placed</span>
              </div>
            )}
            {isFortify && <span className="phase-step-sub">optional · 1 move</span>}
          </div>
        );
      })}
    </div>
  );
}
