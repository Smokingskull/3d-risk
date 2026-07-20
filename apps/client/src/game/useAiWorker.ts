import { useCallback, useEffect, useRef } from "react";
import type { Action, GameState } from "@risk3d/engine";
import { nextAiAction } from "./ai.js";

/**
 * Owns the AI web worker so CPU actions (the search-based Joshua tier especially) are
 * computed off the main thread and never freeze the globe. `decideAi(state)` resolves
 * the CPU's next action; if the worker can't start or errors, it falls back to a
 * synchronous `nextAiAction`. `decideAi` is stable (safe in effect dep arrays).
 */
export function useAiWorker(): { decideAi: (state: GameState) => Promise<Action | null> } {
  const aiWorker = useRef<Worker | null>(null);
  const aiWorkerDead = useRef(false);
  const aiPending = useRef(new Map<number, { resolve: (a: Action | null) => void; state: GameState }>());
  const aiReqSeq = useRef(0);

  const decideAi = useCallback((state: GameState): Promise<Action | null> => {
    if (!aiWorker.current && !aiWorkerDead.current) {
      try {
        const w = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
        w.onmessage = (e: MessageEvent<{ reqId: number; action: Action | null }>) => {
          const p = aiPending.current.get(e.data.reqId);
          if (p) {
            aiPending.current.delete(e.data.reqId);
            p.resolve(e.data.action);
          }
        };
        w.onerror = () => {
          aiWorkerDead.current = true;
          aiWorker.current = null;
          for (const [id, p] of aiPending.current) {
            aiPending.current.delete(id);
            p.resolve(nextAiAction(p.state)); // fall back synchronously
          }
        };
        aiWorker.current = w;
      } catch {
        aiWorkerDead.current = true;
      }
    }
    const w = aiWorker.current;
    if (!w) return Promise.resolve(nextAiAction(state));
    const reqId = ++aiReqSeq.current;
    return new Promise((resolve) => {
      aiPending.current.set(reqId, { resolve, state });
      try {
        w.postMessage({ reqId, state });
      } catch {
        aiPending.current.delete(reqId);
        resolve(nextAiAction(state));
      }
    });
  }, []);

  // Tear the worker down with the hook.
  useEffect(() => () => aiWorker.current?.terminate(), []);

  return { decideAi };
}
