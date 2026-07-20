import { useCallback, useState } from "react";

export interface UiPrefs {
  autoRotate: boolean;
  toggleAutoRotate: () => void;
  /** Globe interaction mode: "select" picks territories, "rotate" only spins. */
  mode: "rotate" | "select";
  toggleMode: () => void;
  /** Bumps to (re)play the guided interface tour. */
  tourNonce: number;
  startTour: () => void;
}

/**
 * In-memory UI preferences that aren't part of game state: auto-rotate, the globe
 * interaction mode, and the guided-tour nonce. (The tutorial toggle stays in
 * useHotseat for now — it's reset by the game lifecycle callbacks.)
 */
export function useUiPrefs(): UiPrefs {
  const [autoRotate, setAutoRotate] = useState(true);
  const [mode, setMode] = useState<"rotate" | "select">("select");
  const [tourNonce, setTourNonce] = useState(0);

  const toggleAutoRotate = useCallback(() => setAutoRotate((a) => !a), []);
  const toggleMode = useCallback(() => setMode((m) => (m === "select" ? "rotate" : "select")), []);
  const startTour = useCallback(() => setTourNonce((n) => n + 1), []);

  return { autoRotate, toggleAutoRotate, mode, toggleMode, tourNonce, startTour };
}
