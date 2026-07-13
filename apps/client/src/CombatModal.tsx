import { useEffect, useState } from "react";
import { conquestProbability } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";

// Pip positions on a 3×3 grid (cells 0..8) for each die face.
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ value, side, dim, rolling }: { value: number; side: "atk" | "def"; dim?: boolean; rolling?: boolean }) {
  const on = PIPS[value] ?? [];
  return (
    <div className={`die die-${side}${dim ? " die-dim" : ""}${rolling ? " die-rolling" : ""}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={on.includes(i) ? "pip on" : "pip"} />
      ))}
    </div>
  );
}

export function CombatModal({ hs }: { hs: Hotseat }) {
  const game = hs.game;
  const eng = hs.engagement;

  const [rolling, setRolling] = useState(false);
  const [shown, setShown] = useState<{ atk: number[]; def: number[] } | null>(null);

  // Animate each roll: cycle random faces briefly, then reveal the real dice.
  useEffect(() => {
    const c = hs.lastCombat;
    if (!c) {
      setShown(null);
      return;
    }
    setRolling(true);
    const iv = setInterval(() => {
      setShown({
        atk: c.attackerDice.map(() => 1 + Math.floor(Math.random() * 6)),
        def: c.defenderDice.map(() => 1 + Math.floor(Math.random() * 6)),
      });
    }, 80);
    const done = setTimeout(() => {
      clearInterval(iv);
      setRolling(false);
      setShown({ atk: c.attackerDice, def: c.defenderDice });
    }, 500);
    return () => {
      clearInterval(iv);
      clearTimeout(done);
    };
    // combatSeq changes on every roll, even when dice values repeat.
  }, [hs.combatSeq]);

  if (!game || !eng) return null;
  const from = game.territories[eng.from];
  const to = game.territories[eng.to];
  if (!from || !to) return null;

  const color = (owner: string | null) => game.players.find((p) => p.id === owner)?.color ?? "#6b7280";
  const pending = game.pendingOccupation;
  const captured = !!pending && pending.to === eng.to;
  const winPct = Math.round(conquestProbability(from.armies, to.armies) * 100);

  // Which shown dice "won" their comparison (for dimming losers), from real values.
  const loserFlags = (() => {
    if (rolling || !shown) return { atk: [], def: [] as boolean[] };
    const a = [...shown.atk].sort((x, y) => y - x);
    const d = [...shown.def].sort((x, y) => y - x);
    const atk = a.map(() => false);
    const def = d.map(() => false);
    for (let i = 0; i < Math.min(a.length, d.length); i++) {
      if (a[i] > d[i]) def[i] = true; // defender die lost
      else atk[i] = true; // attacker die lost (ties to defender)
    }
    return { atk, def };
  })();

  return (
    <div className="combat-backdrop">
      <div className="combat">
        <h2 className="combat-title">Battle for {eng.to}</h2>

        <div className="combat-arena">
          <div className="combat-side">
            <span className="combat-dot" style={{ background: color(from.owner) }} />
            <div className="combat-name">{eng.from}</div>
            <div className="combat-armies">{from.armies}</div>
            <div className="dice-row">
              {shown ? shown.atk.map((v, i) => <Die key={i} value={v} side="atk" dim={loserFlags.atk[i]} rolling={rolling} />) : <span className="dice-hint">attacker</span>}
            </div>
          </div>

          <div className="combat-vs">
            <Icon name="swords" size={24} style={{ color: "var(--accent-bright)" }} />
            <div className="combat-odds">{winPct}%<span>to conquer</span></div>
          </div>

          <div className="combat-side">
            <span className="combat-dot" style={{ background: color(to.owner) }} />
            <div className="combat-name">{eng.to}</div>
            <div className="combat-armies">{to.armies}</div>
            <div className="dice-row">
              {shown ? shown.def.map((v, i) => <Die key={i} value={v} side="def" dim={loserFlags.def[i]} rolling={rolling} />) : <span className="dice-hint">defender</span>}
            </div>
          </div>
        </div>

        <div className="combat-result">
          {captured ? (
            <strong>Territory captured!</strong>
          ) : hs.lastCombat && !rolling ? (
            <span>
              You lost {hs.lastCombat.attackerLosses}, defender lost {hs.lastCombat.defenderLosses}.
            </span>
          ) : (
            <span className="dice-hint">Roll to attack — attacker rolls {Math.min(3, from.armies - 1)} dice, defender {Math.min(2, to.armies)}.</span>
          )}
        </div>

        <div className="combat-actions">
          {captured && pending ? (
            <OccupyControls min={pending.min} max={pending.max} onOccupy={hs.occupy} />
          ) : from.armies < 2 ? (
            <>
              <span className="hint">Not enough armies to keep attacking.</span>
              <button onClick={hs.closeEngagement}>Retreat</button>
            </>
          ) : hs.autoAttacking ? (
            <button className="warn" onClick={hs.stopAuto}>
              ■ Stop
            </button>
          ) : (
            <>
              <button className="start" onClick={hs.rollOnce}>
                🎲 Roll once
              </button>
              <button onClick={hs.startAuto}>Attack till resolved</button>
              <button className="quiet" onClick={hs.closeEngagement}>
                Retreat
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OccupyControls({ min, max, onOccupy }: { min: number; max: number; onOccupy: (n: number) => void }) {
  const [n, setN] = useState(max);
  const value = Math.min(max, Math.max(min, n));
  return (
    <div className="occupy">
      <span>Move armies in:</span>
      {max > min && (
        <input type="range" min={min} max={max} value={value} onChange={(e) => setN(Number(e.target.value))} />
      )}
      <button className="start" onClick={() => onOccupy(value)}>
        Move {value} in
      </button>
    </div>
  );
}
