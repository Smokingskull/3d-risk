import { describe, expect, it } from "vitest";
import exampleScenario from "./scenarios/example.classic.json";
import {
  deserializeGame,
  loadFromJSON,
  ScenarioError,
  SCENARIO_VERSION,
  serializeGame,
  type ScenarioStateInput,
} from "./scenario.js";
import { createGame, applyAction, reinforcementsFor } from "./game.js";
import { buildDeck, validSetsInHand } from "./cards.js";
import { CLASSIC_BOARD } from "./board.js";
import type { Card, GameState, TerritoryId, TerritoryState } from "./types.js";

const CLASSIC_IDS = Object.keys(CLASSIC_BOARD.territories);
const P1 = { id: "p1", name: "You", color: "#e6194b", kind: "human" as const };
const P2 = { id: "p2", name: "CPU", color: "#3cb44b", kind: "cpu" as const };

/** Build a territory map over the whole classic board via a per-id assignment. */
function territoryMap(
  assign: (id: TerritoryId, index: number) => TerritoryState,
): Record<TerritoryId, TerritoryState> {
  return Object.fromEntries(CLASSIC_IDS.map((id, i) => [id, assign(id, i)]));
}

describe("serializeGame / deserializeGame round-trip", () => {
  it("reproduces a freshly created game exactly (board omitted, rebuilt on load)", () => {
    const original = createGame({ players: [P1, P2], boardMode: "classic", seed: 42 });
    const restored = deserializeGame(serializeGame(original));
    expect(restored).toEqual(original);
  });

  it("carries non-default state (rngCursor, cards, phase, sets) through the round-trip", () => {
    const s = createGame({ players: [P1, P2], boardMode: "classic", seed: 7 });
    s.rngCursor = 12;
    s.setsTradedIn = 3;
    s.phase = "attack";
    s.conqueredThisTurn = true;
    s.players[0].cards.push(s.deck.pop()!, s.deck.pop()!);
    expect(deserializeGame(serializeGame(s))).toEqual(s);
  });

  it("serializeGame drops the board and stamps the current version", () => {
    const save = serializeGame(createGame({ players: [P1, P2], boardMode: "classic", seed: 1 }));
    expect(save).not.toHaveProperty("board");
    expect(save.version).toBe(SCENARIO_VERSION);
  });
});

describe("deserializeGame tolerant authoring", () => {
  it("fills defaults for omitted fields", () => {
    const save: ScenarioStateInput = {
      options: { boardMode: "classic", cardsEnabled: true },
      players: [P1, P2],
      territories: territoryMap((_id, i) => ({ owner: i % 2 === 0 ? "p1" : "p2", armies: 1 })),
      // phase, activePlayer, deck, reinforcementsRemaining, rng*, etc. all omitted
    };
    const state = deserializeGame(save);

    expect(state.phase).toBe("reinforce");
    expect(state.activePlayer).toBe("p1"); // first non-eliminated
    expect(state.rngCursor).toBe(0);
    expect(state.turn).toBe(1);
    expect(state.winner).toBeNull();
    // deck auto-filled with the whole deck (no cards dealt into hands)
    expect(state.deck).toHaveLength(buildDeck(CLASSIC_BOARD).length);
    // reinforcements computed for the active player
    expect(state.reinforcementsRemaining).toBe(reinforcementsFor(state, "p1"));
    expect(state.reinforcementsRemaining).toBeGreaterThan(0);
  });

  it("excludes cards already in hands from the auto-filled deck", () => {
    const hand: Card[] = [
      { id: "card:Brazil", territory: "Brazil", symbol: "infantry" },
      { id: "card:Peru", territory: "Peru", symbol: "infantry" },
    ];
    const state = deserializeGame({
      options: { boardMode: "classic" },
      players: [{ ...P1, cards: hand }, P2],
      territories: territoryMap(() => ({ owner: "p1", armies: 1 })),
    });
    const deckIds = new Set(state.deck.map((c) => c.id));
    expect(state.deck).toHaveLength(buildDeck(CLASSIC_BOARD).length - hand.length);
    expect(deckIds.has("card:Brazil")).toBe(false);
    expect(deckIds.has("card:Peru")).toBe(false);
  });
});

describe("deserializeGame validation", () => {
  const base = (): ScenarioStateInput => ({
    version: 1,
    options: { boardMode: "classic", cardsEnabled: false },
    players: [P1, P2],
    territories: territoryMap((_id, i) => ({ owner: i % 2 === 0 ? "p1" : "p2", armies: 1 })),
    activePlayer: "p1",
    phase: "reinforce",
  });

  it("accepts the base case", () => {
    expect(() => deserializeGame(base())).not.toThrow();
  });

  it("rejects an unknown territory id", () => {
    const save = base();
    save.territories["Atlantis"] = { owner: "p1", armies: 1 };
    expect(() => deserializeGame(save)).toThrow(/unknown territory/);
  });

  it("rejects a save missing board territories", () => {
    const save = base();
    delete save.territories["Brazil"];
    expect(() => deserializeGame(save)).toThrow(/missing/);
  });

  it("rejects an owner that is not a player", () => {
    const save = base();
    save.territories["Brazil"] = { owner: "pX", armies: 1 };
    expect(() => deserializeGame(save)).toThrow(/unknown player/);
  });

  it("rejects an owned territory with zero armies", () => {
    const save = base();
    save.territories["Brazil"] = { owner: "p1", armies: 0 };
    expect(() => deserializeGame(save)).toThrow(/at least 1 army/);
  });

  it("rejects an activePlayer that is not a player", () => {
    const save = base();
    save.activePlayer = "pX";
    expect(() => deserializeGame(save)).toThrow(ScenarioError);
  });

  it("rejects a save version newer than supported", () => {
    const save = base();
    save.version = SCENARIO_VERSION + 1;
    expect(() => deserializeGame(save)).toThrow(/newer/);
  });

  it("rejects fewer than two players", () => {
    const save = base();
    save.players = [P1];
    expect(() => deserializeGame(save)).toThrow(/at least 2 players/);
  });
});

describe("hand-authored scenarios drive the reducer", () => {
  it("card-set scenario: an authored set trades for the opening bonus", () => {
    const state = deserializeGame({
      options: { boardMode: "classic", cardsEnabled: true },
      players: [
        {
          ...P1,
          cards: [
            { id: "c1", territory: null, symbol: "infantry" },
            { id: "c2", territory: null, symbol: "infantry" },
            { id: "c3", territory: null, symbol: "infantry" },
          ],
        },
        P2,
      ],
      territories: territoryMap((_id, i) => ({ owner: i % 2 === 0 ? "p1" : "p2", armies: 1 })),
      phase: "reinforce",
      activePlayer: "p1",
    });

    const sets = validSetsInHand(state.players[0].cards);
    expect(sets).toHaveLength(1);

    const before = state.reinforcementsRemaining;
    const { state: after } = applyAction(state, { type: "tradeCards", cards: sets[0] });
    expect(after.reinforcementsRemaining).toBe(before + 4); // first set = 4, no territory match
    expect(after.setsTradedIn).toBe(1);
  });

  it("near-game-end scenario: capturing the last enemy territory wins the game", () => {
    let state: GameState = deserializeGame({
      options: { boardMode: "classic", cardsEnabled: false },
      players: [P1, P2],
      // p1 owns everything except Greenland; Canada (adjacent to Greenland) is loaded.
      territories: territoryMap((id) =>
        id === "Greenland"
          ? { owner: "p2", armies: 1 }
          : { owner: "p1", armies: id === "Canada" ? 30 : 1 },
      ),
      phase: "attack",
      activePlayer: "p1",
    });

    for (let i = 0; i < 200 && !state.winner; i++) {
      const from = state.territories["Canada"];
      const dice = Math.min(3, from.armies - 1);
      state = applyAction(state, { type: "attack", from: "Canada", to: "Greenland", dice }).state;
    }

    expect(state.winner).toBe("p1");
    expect(state.players.find((p) => p.id === "p2")!.eliminated).toBe(true);
  });
});

describe("committed example fixture (scenarios/example.classic.json)", () => {
  it("loads into a valid, playable state via both object and JSON-string paths", () => {
    for (const state of [
      deserializeGame(exampleScenario as ScenarioStateInput),
      loadFromJSON(JSON.stringify(exampleScenario)),
    ]) {
      expect(state.options.boardMode).toBe("classic");
      expect(state.activePlayer).toBe("p1");
      const p1 = state.players.find((p) => p.id === "p1")!;
      expect(p1.cards).toHaveLength(3);
      expect(validSetsInHand(p1.cards).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("reports invalid JSON as a ScenarioError", () => {
    expect(() => loadFromJSON("{ not json")).toThrow(ScenarioError);
  });
});
