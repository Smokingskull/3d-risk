import { deserializeGame, type GameState, type Scenario } from "@risk3d/engine";
import cards from "./cards.classic.json";
import conquer from "./conquer.classic.json";

/** A scenario the player can pick from the Scenarios menu. */
export interface ScenarioEntry {
  id: string;
  name: string;
  description: string;
  /** Build the ready-to-play GameState (throws ScenarioError if the file is bad). */
  load: () => GameState;
}

// Curated scenarios are bundled as JSON modules so they ship in production too.
// Insertion order here is the display order in the menu.
const FILES: Record<string, unknown> = { cards, conquer };

export const SCENARIOS: ScenarioEntry[] = Object.entries(FILES).map(([id, raw]) => {
  const s = raw as Scenario;
  return { id, name: s.name, description: s.description, load: () => deserializeGame(s) };
});

export const scenarioById = (id: string): ScenarioEntry | undefined =>
  SCENARIOS.find((s) => s.id === id);
