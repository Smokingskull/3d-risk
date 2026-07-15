/** Persisted client preferences (localStorage-backed). Currently just the
 *  tutorial-tips toggle, which is a global preference set from Options — on the
 *  home menu or in-game — rather than chosen per game. Defaults to off. */

const TUTORIAL_KEY = "risk3d.tutorial";

export function getTutorialEnabled(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTutorialEnabled(on: boolean): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, on ? "1" : "0");
  } catch {
    // Ignore storage failures (private mode, quota) — the in-memory state still works.
  }
}
