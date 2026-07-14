import { deserializeGame, type GameState, type ScenarioStateInput } from "@risk3d/engine";
import cardSets from "./card-sets.classic.json";
import totalVictory from "./total-victory.classic.json";
import countryCampaign from "./country-campaign.classic.json";
import continentCampaign from "./continent-campaign.classic.json";
import assassinationCampaign from "./assassination-campaign.classic.json";

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

// Insertion order here is the display order in the menu.
export const SCENARIOS: ScenarioEntry[] = [
  toEntry("card-sets", cardSets as unknown as RawScenario),
  toEntry("total-victory", totalVictory as unknown as RawScenario),
  toEntry("country-campaign", countryCampaign as unknown as RawScenario),
  toEntry("continent-campaign", continentCampaign as unknown as RawScenario),
  toEntry("assassination-campaign", assassinationCampaign as unknown as RawScenario),
];

export const scenarioById = (id: string): ScenarioEntry | undefined =>
  SCENARIOS.find((s) => s.id === id);
