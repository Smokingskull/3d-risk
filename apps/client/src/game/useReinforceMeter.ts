import { useEffect, useRef, useState } from "react";
import type { GameState } from "@risk3d/engine";

/**
 * Tracks the total armies to place this reinforce phase (for the HUD meter). The
 * running peak captures the base income plus any trade bonuses added mid-phase; the
 * turn+player key resets it when a new reinforce phase opens. (The refs here are a
 * running accumulator, not state-shadows.)
 */
export function useReinforceMeter(game: GameState | null): number {
  const [reinforceTotal, setReinforceTotal] = useState(0);
  const reinforceTotalRef = useRef(0);
  const reinforceKeyRef = useRef("");

  useEffect(() => {
    if (!game || game.phase !== "reinforce") return;
    const key = `${game.turn}:${game.activePlayer}`;
    if (reinforceKeyRef.current !== key) {
      reinforceKeyRef.current = key;
      reinforceTotalRef.current = 0;
    }
    reinforceTotalRef.current = Math.max(reinforceTotalRef.current, game.reinforcementsRemaining);
    if (reinforceTotalRef.current !== reinforceTotal) setReinforceTotal(reinforceTotalRef.current);
  }, [game, reinforceTotal]);

  return reinforceTotal;
}
