import { deserializeGame, type GameState, type ScenarioStateInput } from "@risk3d/engine";
import huns from "./huns.classic.json";
import mongols from "./mongols.classic.json";
import napoleon from "./napoleon.classic.json";
import rome from "./rome.classic.json";
import alexander from "./alexander.classic.json";
import ww2Axis from "./ww2-axis.classic.json";
import ww2Allied from "./ww2-allied.classic.json";
import crusades from "./crusades.classic.json";
import conquistadors from "./conquistadors.classic.json";
import firstCommand from "./first-command.classic.json";
import fortress from "./fortress.classic.json";
import paxBritannica from "./pax-britannica.classic.json";

/** Difficulty rating shown in the Scenarios menu (distinct from a CPU seat's AI level). */
export type Difficulty = "easy" | "medium" | "hard" | "very-hard";

/** Display label and sort order for each difficulty tier (Easy first). */
export const DIFFICULTY: Record<Difficulty, { label: string; order: number }> = {
  easy: { label: "Easy", order: 0 },
  medium: { label: "Medium", order: 1 },
  hard: { label: "Hard", order: 2 },
  "very-hard": { label: "Very Hard", order: 3 },
};

/** The raw scenario-file shape. Players are "seats" — kind is assigned at load. */
interface RawPlayer {
  id: string;
  name: string;
  color: string;
  difficulty?: string;
  [k: string]: unknown;
}
interface RawScenario {
  name: string;
  description: string;
  difficulty: Difficulty;
  /** One-line strategic note shown under the difficulty rating. */
  difficultyNote?: string;
  options?: { campaign?: boolean; [k: string]: unknown };
  activePlayer?: string;
  players: RawPlayer[];
  [k: string]: unknown;
}

export interface ScenarioSeat {
  id: string;
  name: string;
  color: string;
  /** The seat's AI level when played as CPU (from the file's per-player difficulty). */
  cpuDifficulty?: string;
}

/** A scenario the player can pick and set up from the Scenarios menu. */
export interface ScenarioEntry {
  id: string;
  name: string;
  description: string;
  difficulty: Difficulty;
  difficultyNote: string;
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
    difficulty: raw.difficulty,
    difficultyNote: raw.difficultyNote ?? "",
    campaign: !!raw.options?.campaign,
    seats: raw.players.map((p) => ({ id: p.id, name: p.name, color: p.color, cpuDifficulty: p.difficulty })),
    defaultHuman: raw.activePlayer ?? raw.players[0].id,
    build: (humanIds) =>
      deserializeGame({
        ...raw,
        players: raw.players.map((p) => ({ ...p, kind: humanIds.has(p.id) ? "human" : "cpu" })),
      } as unknown as ScenarioStateInput),
  };
}

// Authoring order (grouped historical, then classic-style). The menu displays them
// sorted by difficulty (Easy → Very Hard); within a tier this authoring order holds.
const ALL: ScenarioEntry[] = [
  toEntry("alexander", alexander as unknown as RawScenario),
  toEntry("rome", rome as unknown as RawScenario),
  toEntry("huns", huns as unknown as RawScenario),
  toEntry("mongols", mongols as unknown as RawScenario),
  toEntry("napoleon", napoleon as unknown as RawScenario),
  toEntry("ww2-axis", ww2Axis as unknown as RawScenario),
  toEntry("ww2-allied", ww2Allied as unknown as RawScenario),
  toEntry("crusades", crusades as unknown as RawScenario),
  toEntry("conquistadors", conquistadors as unknown as RawScenario),
  toEntry("first-command", firstCommand as unknown as RawScenario),
  toEntry("fortress", fortress as unknown as RawScenario),
  toEntry("pax-britannica", paxBritannica as unknown as RawScenario),
];

export const SCENARIOS: ScenarioEntry[] = ALL.map((s, i) => ({ s, i }))
  .sort((a, b) => DIFFICULTY[a.s.difficulty].order - DIFFICULTY[b.s.difficulty].order || a.i - b.i)
  .map(({ s }) => s);

export const scenarioById = (id: string): ScenarioEntry | undefined =>
  SCENARIOS.find((s) => s.id === id);
