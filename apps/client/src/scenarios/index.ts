import { deserializeGame, type GameState, type ScenarioStateInput } from "@risk3d/engine";
import huns from "./huns.classic.json";
import mongols from "./mongols.classic.json";
import napoleon from "./napoleon.classic.json";
import rome from "./rome.classic.json";
import alexander from "./alexander.classic.json";
import ww2Axis from "./ww2-axis.classic.json";
import ww2Allied from "./ww2-allied.classic.json";

/** The raw scenario-file shape. Players are "seats" — kind is assigned at load. */
interface RawPlayer {
  id: string;
  name: string;
  color: string;
  [k: string]: unknown;
}
interface RawScenario {
  name: string;
  description: string;
  options?: { campaign?: boolean; [k: string]: unknown };
  activePlayer?: string;
  players: RawPlayer[];
  [k: string]: unknown;
}

export interface ScenarioSeat {
  id: string;
  name: string;
  color: string;
}

/** A scenario the player can pick and set up from the Scenarios menu. */
export interface ScenarioEntry {
  id: string;
  name: string;
  description: string;
  campaign: boolean;
  seats: ScenarioSeat[];
  /** Which seat is HUMAN by default (the scenario's active player). */
  defaultHuman: string;
  /** Build the ready-to-play state, with the chosen seats as HUMAN and the rest CPU. */
  build: (humanIds: Set<string>) => GameState;
}

function toEntry(id: string, raw: RawScenario): ScenarioEntry {
  return {
    id,
    name: raw.name,
    description: raw.description,
    campaign: !!raw.options?.campaign,
    seats: raw.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    defaultHuman: raw.activePlayer ?? raw.players[0].id,
    build: (humanIds) =>
      deserializeGame({
        ...raw,
        players: raw.players.map((p) => ({ ...p, kind: humanIds.has(p.id) ? "human" : "cpu" })),
      } as unknown as ScenarioStateInput),
  };
}

// Insertion order here is the display order in the menu (chronological).
export const SCENARIOS: ScenarioEntry[] = [
  toEntry("alexander", alexander as unknown as RawScenario),
  toEntry("rome", rome as unknown as RawScenario),
  toEntry("huns", huns as unknown as RawScenario),
  toEntry("mongols", mongols as unknown as RawScenario),
  toEntry("napoleon", napoleon as unknown as RawScenario),
  toEntry("ww2-axis", ww2Axis as unknown as RawScenario),
  toEntry("ww2-allied", ww2Allied as unknown as RawScenario),
];

export const scenarioById = (id: string): ScenarioEntry | undefined =>
  SCENARIOS.find((s) => s.id === id);
