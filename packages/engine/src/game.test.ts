import { describe, expect, it } from "vitest";
import {
  airStrikeRemoval,
  applyAction,
  createGame,
  IllegalActionError,
  isLegal,
  listLegalActions,
  perceivedArmies,
  reinforcementsFor,
  type GameConfig,
} from "./game.js";
import { buildDeck } from "./cards.js";
import type { Action } from "./actions.js";
import type { BoardDefinition, GameState } from "./types.js";

// A 4-territory ring: A-B-C-D-A, all one continent (bonus 5).
function ringBoard(): BoardDefinition {
  const adj: Record<string, string[]> = {
    A: ["B", "D"],
    B: ["A", "C"],
    C: ["B", "D"],
    D: ["C", "A"],
  };
  const territories = Object.fromEntries(
    Object.entries(adj).map(([id, neighbours]) => [id, { id, continent: "c", neighbours }]),
  );
  return { territories, continents: { c: { id: "c", name: "Continent", bonus: 5, territories: ["A", "B", "C", "D"] } } };
}

// A 4-territory line A-B-C-D (for fortify path tests).
function lineBoard(): BoardDefinition {
  const adj: Record<string, string[]> = { A: ["B"], B: ["A", "C"], C: ["B", "D"], D: ["C"] };
  const territories = Object.fromEntries(
    Object.entries(adj).map(([id, neighbours]) => [id, { id, continent: "c", neighbours }]),
  );
  return { territories, continents: { c: { id: "c", name: "Continent", bonus: 5, territories: ["A", "B", "C", "D"] } } };
}

const P1 = { id: "p1", name: "One", color: "#f00", kind: "human" as const };
const P2 = { id: "p2", name: "Two", color: "#00f", kind: "human" as const };

function baseGame(board: BoardDefinition, extra?: Partial<GameConfig>): GameState {
  return createGame({ players: [P1, P2], board, seed: 1, cardsEnabled: false, ...extra });
}

/** Overwrite ownership/armies for a controlled scenario. */
function setBoard(s: GameState, owners: Record<string, [string, number]>): void {
  for (const [id, [owner, armies]] of Object.entries(owners)) s.territories[id] = { owner, armies };
}

describe("createGame", () => {
  it("deals every territory to a player with at least one army", () => {
    const s = baseGame(ringBoard());
    const owned = Object.values(s.territories);
    expect(owned).toHaveLength(4);
    expect(owned.every((t) => t.owner === "p1" || t.owner === "p2")).toBe(true);
    expect(owned.every((t) => t.armies >= 1)).toBe(true);
  });

  it("opens on player 1's reinforce phase with computed reinforcements", () => {
    const s = baseGame(ringBoard());
    expect(s.phase).toBe("reinforce");
    expect(s.activePlayer).toBe("p1");
    expect(s.reinforcementsRemaining).toBe(reinforcementsFor(s, "p1"));
  });

  it("is fully deterministic for a fixed seed", () => {
    const cfg: GameConfig = { players: [P1, P2], boardMode: "classic", seed: 99 };
    expect(JSON.stringify(createGame(cfg))).toBe(JSON.stringify(createGame(cfg)));
  });

  it("distributes armies from a scaled starting pool on the world board", () => {
    const s = createGame({ players: [P1, P2], boardMode: "world", seed: 7, cardsEnabled: false });
    const total = Object.values(s.territories).reduce((n, t) => n + t.armies, 0);
    expect(total).toBeGreaterThan(177); // 1 per territory + a placement pool
  });
});

describe("reinforcements", () => {
  it("gives max(3, floor(owned/3)) plus continent bonuses", () => {
    const s = baseGame(ringBoard());
    setBoard(s, { A: ["p1", 1], B: ["p1", 1], C: ["p1", 1], D: ["p1", 1] });
    expect(reinforcementsFor(s, "p1")).toBe(Math.max(3, Math.floor(4 / 3)) + 5); // 3 + 5
    setBoard(s, { A: ["p1", 1], B: ["p1", 1], C: ["p1", 1], D: ["p2", 1] });
    expect(reinforcementsFor(s, "p1")).toBe(3); // no continent bonus
  });
});

describe("reinforce phase", () => {
  it("places armies then advances to attack when the pool is empty", () => {
    const s = baseGame(ringBoard());
    setBoard(s, { A: ["p1", 1], B: ["p1", 1], C: ["p2", 1], D: ["p2", 1] });
    s.reinforcementsRemaining = 3;
    const { state } = applyAction(s, { type: "placeArmies", territory: "A", count: 3 });
    expect(state.territories.A.armies).toBe(4);
    expect(state.phase).toBe("attack");
  });

  it("forces a trade when holding 5+ cards", () => {
    const s = baseGame(ringBoard(), { cardsEnabled: true });
    setBoard(s, { A: ["p1", 1], B: ["p1", 1], C: ["p2", 1], D: ["p2", 1] });
    s.reinforcementsRemaining = 3;
    s.players[0].cards = buildDeck(ringBoard()).slice(0, 5);
    expect(isLegal(s, { type: "placeArmies", territory: "A", count: 1 })).toBe(false);
    const legal = listLegalActions(s);
    expect(legal.every((a) => a.type === "tradeCards")).toBe(true);
    expect(legal.length).toBeGreaterThan(0);
  });

  it("adds the escalating base bonus when a set is traded", () => {
    const s = baseGame(ringBoard(), { cardsEnabled: true });
    // p1 owns only D, so none of the traded cards (A/B/C) grant the territory-match +2.
    setBoard(s, { A: ["p2", 1], B: ["p2", 1], C: ["p2", 1], D: ["p1", 1] });
    s.reinforcementsRemaining = 3;
    const deck = buildDeck(ringBoard());
    const trio = [deck.find((c) => c.symbol === "infantry")!, deck.find((c) => c.symbol === "cavalry")!, deck.find((c) => c.symbol === "artillery")!];
    s.players[0].cards = trio;
    const { state } = applyAction(s, { type: "tradeCards", cards: [trio[0].id, trio[1].id, trio[2].id] });
    expect(state.reinforcementsRemaining).toBe(3 + 4); // first set = 4, no territory match
    expect(state.setsTradedIn).toBe(1);
    expect(state.players[0].cards).toHaveLength(0);
  });

  it("places the +2 territory bonus on an owned pictured territory, not the pool", () => {
    const s = baseGame(ringBoard(), { cardsEnabled: true });
    setBoard(s, { A: ["p1", 1], B: ["p1", 1], C: ["p1", 1], D: ["p2", 1] }); // p1 owns A/B/C
    s.reinforcementsRemaining = 3;
    const deck = buildDeck(ringBoard());
    // trio pictures A (infantry), B (cavalry), C (artillery) — all owned by p1.
    const trio = [deck.find((c) => c.territory === "A")!, deck.find((c) => c.territory === "B")!, deck.find((c) => c.territory === "C")!];
    s.players[0].cards = trio;
    const { state, events } = applyAction(s, { type: "tradeCards", cards: [trio[0].id, trio[1].id, trio[2].id] });
    expect(state.reinforcementsRemaining).toBe(3 + 4); // pool gets only the base bonus
    expect(state.territories.A.armies).toBe(1 + 2); // +2 landed on the first owned match
    expect(state.territories.B.armies).toBe(1);
    const traded = events.find((e) => e.type === "cardsTraded")!;
    expect(traded).toMatchObject({ bonus: 4, territoryBonus: 2, bonusTerritory: "A" });
  });

  it("honours an explicit bonusTerritory choice", () => {
    const s = baseGame(ringBoard(), { cardsEnabled: true });
    setBoard(s, { A: ["p1", 1], B: ["p1", 1], C: ["p1", 1], D: ["p2", 1] });
    s.reinforcementsRemaining = 3;
    const deck = buildDeck(ringBoard());
    const trio = [deck.find((c) => c.territory === "A")!, deck.find((c) => c.territory === "B")!, deck.find((c) => c.territory === "C")!];
    s.players[0].cards = trio;
    const { state } = applyAction(s, { type: "tradeCards", cards: [trio[0].id, trio[1].id, trio[2].id], bonusTerritory: "C" });
    expect(state.territories.C.armies).toBe(1 + 2);
    expect(state.territories.A.armies).toBe(1);
  });

  it("rejects a bonusTerritory you don't own or isn't in the set", () => {
    const s = baseGame(ringBoard(), { cardsEnabled: true });
    setBoard(s, { A: ["p1", 1], B: ["p1", 1], C: ["p1", 1], D: ["p2", 1] });
    s.reinforcementsRemaining = 3;
    const deck = buildDeck(ringBoard());
    const trio = [deck.find((c) => c.territory === "A")!, deck.find((c) => c.territory === "B")!, deck.find((c) => c.territory === "C")!];
    s.players[0].cards = trio;
    const cards: [string, string, string] = [trio[0].id, trio[1].id, trio[2].id];
    expect(isLegal(s, { type: "tradeCards", cards, bonusTerritory: "D" })).toBe(false); // not owned / not in set
  });
});

describe("attack + occupy", () => {
  function attackScenario() {
    const s = baseGame(ringBoard());
    setBoard(s, { A: ["p1", 10], B: ["p2", 1], C: ["p2", 1], D: ["p1", 1] });
    s.phase = "attack";
    s.reinforcementsRemaining = 0;
    return s;
  }

  it("rejects illegal attacks", () => {
    const s = attackScenario();
    expect(() => applyAction(s, { type: "attack", from: "A", to: "C", dice: 1 })).toThrow(IllegalActionError); // not adjacent
    expect(() => applyAction(s, { type: "attack", from: "B", to: "A", dice: 1 })).toThrow(IllegalActionError); // not owner
    expect(() => applyAction(s, { type: "attack", from: "A", to: "B", dice: 4 })).toThrow(IllegalActionError); // too many dice
  });

  it("resolves dice deterministically and conserves army losses", () => {
    const s = attackScenario();
    const r1 = applyAction(s, { type: "attack", from: "A", to: "B", dice: 2 });
    const r2 = applyAction(s, { type: "attack", from: "A", to: "B", dice: 2 });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2)); // pure + deterministic
    const ev = r1.events[0];
    expect(ev.type).toBe("attacked");
    if (ev.type === "attacked") {
      expect(ev.attackerLosses + ev.defenderLosses).toBe(Math.min(2, 1)); // defender had 1 army → 1 comparison
    }
    expect(s.territories.A.armies).toBe(10); // input unmutated
  });

  it("requires occupying a conquered territory before continuing", () => {
    let s = attackScenario();
    // Blitz A -> B until captured.
    while (s.territories.B.owner !== "p1" && s.territories.A.armies >= 2) {
      s = applyAction(s, { type: "attack", from: "A", to: "B", dice: Math.min(3, s.territories.A.armies - 1) }).state;
    }
    expect(s.territories.B.owner).toBe("p1");
    expect(s.pendingOccupation).not.toBeNull();
    // Only occupy is legal now.
    expect(isLegal(s, { type: "endAttack" })).toBe(false);
    expect(isLegal(s, { type: "attack", from: "A", to: "D", dice: 1 })).toBe(false);
    const { min, max } = s.pendingOccupation!;
    const armiesInA = s.territories.A.armies;
    const after = applyAction(s, { type: "occupy", count: max }).state;
    expect(after.territories.B.armies).toBe(max); // conquered territory was emptied to 0
    expect(after.territories.A.armies).toBe(armiesInA - max);
    expect(after.pendingOccupation).toBeNull();
    expect(max).toBeGreaterThanOrEqual(min);
  });
});

describe("elimination + win", () => {
  it("eliminates a wiped-out player, steals cards, and declares a winner", () => {
    const s = baseGame(ringBoard(), { cardsEnabled: true });
    setBoard(s, { A: ["p1", 20], B: ["p2", 1], C: ["p1", 1], D: ["p1", 1] });
    s.phase = "attack";
    s.reinforcementsRemaining = 0;
    s.players[1].cards = buildDeck(ringBoard()).slice(0, 2); // victim holds 2 cards

    let cur = s;
    while (!cur.winner && cur.territories.B.owner !== "p1" && cur.territories.A.armies >= 2) {
      const res = applyAction(cur, { type: "attack", from: "A", to: "B", dice: Math.min(3, cur.territories.A.armies - 1) });
      cur = res.state;
    }
    expect(cur.players[1].eliminated).toBe(true);
    expect(cur.players[0].cards.length).toBe(2); // stole victim's cards
    expect(cur.winner).toBe("p1");
    expect(listLegalActions(cur)).toEqual([]);
  });
});

describe("fortify", () => {
  it("allows moving along an owned path (connected rule)", () => {
    const s = baseGame(lineBoard());
    setBoard(s, { A: ["p1", 5], B: ["p1", 1], C: ["p1", 1], D: ["p2", 1] });
    s.phase = "fortify";
    // A and C are not adjacent, but connected through B (all owned).
    expect(isLegal(s, { type: "fortify", from: "A", to: "C", count: 4 })).toBe(true);
    const { state } = applyAction(s, { type: "fortify", from: "A", to: "C", count: 4 });
    expect(state.territories.A.armies).toBe(1);
    expect(state.territories.C.armies).toBe(5);
    expect(state.activePlayer).toBe("p2"); // fortify ends the turn
    expect(state.phase).toBe("reinforce");
  });

  it("forbids fortifying through enemy territory", () => {
    const s = baseGame(lineBoard());
    setBoard(s, { A: ["p1", 5], B: ["p2", 1], C: ["p1", 1], D: ["p2", 1] });
    s.phase = "fortify";
    expect(isLegal(s, { type: "fortify", from: "A", to: "C", count: 4 })).toBe(false);
  });

  it("honours the adjacent-only rule when configured", () => {
    const s = baseGame(lineBoard(), { fortifyRule: "adjacent" });
    setBoard(s, { A: ["p1", 5], B: ["p1", 1], C: ["p1", 1], D: ["p2", 1] });
    s.phase = "fortify";
    expect(isLegal(s, { type: "fortify", from: "A", to: "C", count: 4 })).toBe(false); // not adjacent
    expect(isLegal(s, { type: "fortify", from: "A", to: "B", count: 4 })).toBe(true);
  });
});

describe("turn flow", () => {
  it("ends the turn, advances the player, and recomputes reinforcements", () => {
    const s = baseGame(ringBoard());
    setBoard(s, { A: ["p1", 3], B: ["p1", 1], C: ["p2", 1], D: ["p2", 1] });
    s.phase = "fortify";
    const { state } = applyAction(s, { type: "endTurn" });
    expect(state.activePlayer).toBe("p2");
    expect(state.phase).toBe("reinforce");
    expect(state.reinforcementsRemaining).toBe(reinforcementsFor(state, "p2"));
    expect(state.turn).toBe(2);
  });

  it("never returns illegal actions from listLegalActions", () => {
    const s = createGame({ players: [P1, P2], boardMode: "classic", seed: 3 });
    for (const a of listLegalActions(s)) expect(isLegal(s, a as Action)).toBe(true);
  });
});

describe("action cards", () => {
  it("are off by default: no cards dealt, option disabled", () => {
    const s = baseGame(ringBoard());
    expect(s.options.actionCardsEnabled).toBe(false);
    expect(s.players.every((p) => p.actionCards.length === 0)).toBe(true);
  });

  it("deals exactly 2 to each player when enabled", () => {
    const s = baseGame(ringBoard(), { actionCardsEnabled: true });
    expect(s.options.actionCardsEnabled).toBe(true);
    expect(s.players.every((p) => p.actionCards.length === 2)).toBe(true);
  });

  it("deals from a pool of two-of-each (no type appears more than twice overall)", () => {
    const s = createGame({
      players: [P1, P2, { id: "p3", name: "Three", color: "#0f0", kind: "human" as const }],
      board: ringBoard(),
      seed: 7,
      cardsEnabled: false,
      actionCardsEnabled: true,
    });
    const counts = new Map<string, number>();
    for (const p of s.players) for (const c of p.actionCards) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect([...counts.values()].every((n) => n <= 2)).toBe(true);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(6);
  });

  it("airStrikeRemoval: round(20%), ≥1 when armies≥2, never below 1 left", () => {
    expect(airStrikeRemoval(10)).toBe(2);
    expect(airStrikeRemoval(7)).toBe(1);
    expect(airStrikeRemoval(3)).toBe(1);
    expect(airStrikeRemoval(2)).toBe(1);
    expect(airStrikeRemoval(1)).toBe(0);
  });

  function cardGame(): GameState {
    const s = baseGame(ringBoard(), { actionCardsEnabled: true });
    for (const p of s.players) p.actionCards = [];
    return s;
  }

  it("Air Strike removes ~20% of the target and consumes the card", () => {
    const s = cardGame();
    s.players.find((p) => p.id === "p1")!.actionCards = ["airStrike"];
    setBoard(s, { A: ["p1", 3], B: ["p2", 10], C: ["p2", 1], D: ["p2", 1] });
    s.phase = "attack";
    const { state, events } = applyAction(s, { type: "playActionCard", card: "airStrike", from: "A", to: "B" });
    expect(state.territories.B.armies).toBe(8);
    expect(state.players.find((p) => p.id === "p1")!.actionCards).not.toContain("airStrike");
    const res = events.find((e) => e.type === "airStrikeResolved");
    expect(res).toMatchObject({ removed: 2, nullifiedBy: null });
  });

  it("Anti-Aircraft nullifies an Air Strike; both cards are consumed", () => {
    const s = cardGame();
    s.players.find((p) => p.id === "p1")!.actionCards = ["airStrike"];
    s.players.find((p) => p.id === "p2")!.actionCards = ["antiAircraft"];
    setBoard(s, { A: ["p1", 3], B: ["p2", 10], C: ["p2", 1], D: ["p2", 1] });
    s.phase = "attack";
    const { state, events } = applyAction(s, { type: "playActionCard", card: "airStrike", from: "A", to: "B" });
    expect(state.territories.B.armies).toBe(10); // unchanged
    expect(state.players.find((p) => p.id === "p1")!.actionCards).not.toContain("airStrike");
    expect(state.players.find((p) => p.id === "p2")!.actionCards).not.toContain("antiAircraft");
    expect(events.find((e) => e.type === "airStrikeResolved")).toMatchObject({ removed: 0, nullifiedBy: "p2" });
  });

  it("Troop Transport lets fortify ignore connectivity", () => {
    const s = cardGame();
    s.players.find((p) => p.id === "p1")!.actionCards = ["troopTransport"];
    // p1 owns A and C, which are NOT connected through owned land (B, D are p2's).
    setBoard(s, { A: ["p1", 3], B: ["p2", 1], C: ["p1", 1], D: ["p2", 1] });
    s.phase = "fortify";
    expect(isLegal(s, { type: "fortify", from: "A", to: "C", count: 2 })).toBe(false);
    const { state } = applyAction(s, { type: "playActionCard", card: "troopTransport" });
    expect(state.fortifyAnywhere).toBe(true);
    expect(isLegal(state, { type: "fortify", from: "A", to: "C", count: 2 })).toBe(true);
    // …and it resets after the turn ends.
    const { state: next } = applyAction(state, { type: "fortify", from: "A", to: "C", count: 2 });
    expect(next.fortifyAnywhere).toBe(false);
  });

  function threeCardGame(): GameState {
    const s = createGame({
      players: [P1, P2, { id: "p3", name: "Three", color: "#0f0", kind: "human" as const }],
      board: ringBoard(),
      seed: 5,
      cardsEnabled: false,
      actionCardsEnabled: true,
    });
    for (const p of s.players) p.actionCards = [];
    return s;
  }

  it("Misinformation: owner sees the real count, opponents see the fake", () => {
    const s = threeCardGame();
    s.players.find((p) => p.id === "p1")!.actionCards = ["misinformation"];
    setBoard(s, { A: ["p1", 5], B: ["p2", 1], C: ["p2", 1], D: ["p3", 1] });
    // reinforcementsFor(p1) is 3 here, so a swing of +3 (5→8) is allowed.
    const { state } = applyAction(s, { type: "playActionCard", card: "misinformation", territory: "A", fake: 8 });
    expect(perceivedArmies(state, "p1", "A")).toBe(5); // owner: real
    expect(perceivedArmies(state, "p2", "A")).toBe(8); // opponent: fake
    expect(perceivedArmies(state, "p3", "A")).toBe(8);
    expect(state.players.find((p) => p.id === "p1")!.actionCards).not.toContain("misinformation");
  });

  it("Misinformation swing is bounded by this turn's reinforcements (≥1)", () => {
    const s = threeCardGame();
    s.players.find((p) => p.id === "p1")!.actionCards = ["misinformation"];
    setBoard(s, { A: ["p1", 5], B: ["p2", 1], C: ["p2", 1], D: ["p3", 1] });
    expect(reinforcementsFor(s, "p1")).toBe(3);
    expect(isLegal(s, { type: "playActionCard", card: "misinformation", territory: "A", fake: 8 })).toBe(true); // +3
    expect(isLegal(s, { type: "playActionCard", card: "misinformation", territory: "A", fake: 2 })).toBe(true); // −3
    expect(isLegal(s, { type: "playActionCard", card: "misinformation", territory: "A", fake: 9 })).toBe(false); // +4
    expect(isLegal(s, { type: "playActionCard", card: "misinformation", territory: "A", fake: 0 })).toBe(false); // <1
  });

  it("conquering a defender who holds Minefield opens a decision window (blocking occupy)", () => {
    const s = cardGame();
    s.players.find((p) => p.id === "p2")!.actionCards = ["minefield"];
    // p2 owns B and C, so conquering B doesn't eliminate them.
    setBoard(s, { A: ["p1", 20], B: ["p2", 1], C: ["p2", 1], D: ["p1", 1] });
    s.phase = "attack";
    let st = s;
    for (let i = 0; i < 12 && !st.pendingDecision; i++) {
      if (st.pendingOccupation) break;
      st = applyAction(st, { type: "attack", from: "A", to: "B", dice: 3 }).state;
    }
    expect(st.pendingDecision).toMatchObject({ kind: "minefield", player: "p2", territory: "B" });
    expect(isLegal(st, { type: "occupy", count: 1 })).toBe(false); // blocked until resolved
    expect(isLegal(st, { type: "resolveDecision", play: true })).toBe(true);
  });

  it("Minefield destroys 2 of the incoming armies (1 if <4 move), destination ≥1", () => {
    const s = cardGame();
    s.players.find((p) => p.id === "p2")!.actionCards = ["minefield"];
    setBoard(s, { A: ["p1", 6], B: ["p1", 0], C: ["p2", 1], D: ["p1", 1] });
    s.phase = "attack";
    s.pendingOccupation = { from: "A", to: "B", min: 1, max: 5 };
    s.pendingDecision = { kind: "minefield", player: "p2", territory: "B", from: "A" };
    const { state } = applyAction(s, { type: "resolveDecision", play: true });
    expect(state.pendingDecision).toBeNull();
    expect(state.pendingOccupation!.mined).toBe(true);
    expect(state.players.find((p) => p.id === "p2")!.actionCards).not.toContain("minefield");
    const big = applyAction(state, { type: "occupy", count: 5 }).state; // 5≥4 → −2
    expect(big.territories.B.armies).toBe(3);
    expect(big.territories.A.armies).toBe(1);
    const small = applyAction(state, { type: "occupy", count: 3 }).state; // <4 → −1
    expect(small.territories.B.armies).toBe(2);
  });

  it("declining Minefield leaves the occupation untouched", () => {
    const s = cardGame();
    s.players.find((p) => p.id === "p2")!.actionCards = ["minefield"];
    setBoard(s, { A: ["p1", 6], B: ["p1", 0], C: ["p2", 1], D: ["p1", 1] });
    s.phase = "attack";
    s.pendingOccupation = { from: "A", to: "B", min: 1, max: 5 };
    s.pendingDecision = { kind: "minefield", player: "p2", territory: "B", from: "A" };
    const { state } = applyAction(s, { type: "resolveDecision", play: false });
    expect(state.pendingOccupation!.mined).toBeUndefined();
    expect(state.players.find((p) => p.id === "p2")!.actionCards).toContain("minefield"); // not consumed
    const occ = applyAction(state, { type: "occupy", count: 5 }).state;
    expect(occ.territories.B.armies).toBe(5);
  });

  it("Tactical Retreat: window opens between rolls when the defender takes losses", () => {
    const s = cardGame();
    s.players.find((p) => p.id === "p2")!.actionCards = ["tacticalRetreat"];
    // p2 holds B (attacked from A) and owns C to retreat into. B has plenty so it won't fall.
    setBoard(s, { A: ["p1", 20], B: ["p2", 8], C: ["p2", 1], D: ["p1", 1] });
    s.phase = "attack";
    let st = s;
    for (let i = 0; i < 15 && !st.pendingDecision && !st.pendingOccupation; i++)
      st = applyAction(st, { type: "attack", from: "A", to: "B", dice: 3 }).state;
    expect(st.pendingDecision).toMatchObject({ kind: "tacticalRetreat", player: "p2", territory: "B" });
    // Legal moves are the retreat (to an owned neighbour) or declining.
    expect(isLegal(st, { type: "resolveDecision", play: true, to: "C" })).toBe(true);
    expect(isLegal(st, { type: "resolveDecision", play: false })).toBe(true);
    expect(isLegal(st, { type: "resolveDecision", play: true, to: "D" })).toBe(false); // not owned
  });

  it("Tactical Retreat moves all armies out and hands the empty territory to the attacker", () => {
    const s = cardGame();
    s.players.find((p) => p.id === "p2")!.actionCards = ["tacticalRetreat"];
    setBoard(s, { A: ["p1", 6], B: ["p2", 4], C: ["p2", 2], D: ["p1", 1] });
    s.phase = "attack";
    s.pendingDecision = { kind: "tacticalRetreat", player: "p2", territory: "B", from: "A" };
    const { state, events } = applyAction(s, { type: "resolveDecision", play: true, to: "C" });
    expect(state.territories.C.armies).toBe(6); // 2 + all 4 from B
    expect(state.territories.B.owner).toBe("p1"); // attacker captured the empty land
    expect(state.territories.B.armies).toBe(0);
    expect(state.pendingOccupation).toMatchObject({ from: "A", to: "B" });
    expect(state.players.find((p) => p.id === "p2")!.actionCards).not.toContain("tacticalRetreat");
    expect(events.find((e) => e.type === "tacticalRetreat")).toMatchObject({ from: "B", to: "C", count: 4, capturedBy: "p1" });
    // The attacker then moves in as a normal occupation.
    const occ = applyAction(state, { type: "occupy", count: 5 }).state;
    expect(occ.territories.B.armies).toBe(5);
    expect(occ.territories.A.armies).toBe(1);
  });

  it("attacking a bluffed territory reveals it to that attacker only; combat uses the real count", () => {
    const s = threeCardGame();
    // A is bluffed (real 10, shown as 8). B (p2) borders A and attacks it.
    setBoard(s, { A: ["p1", 10], B: ["p2", 2], C: ["p2", 1], D: ["p3", 1] });
    s.misinformation.A = { fake: 8, revealedTo: [] };
    s.activePlayer = "p2";
    s.phase = "attack";
    expect(perceivedArmies(s, "p2", "A")).toBe(8);
    const { state } = applyAction(s, { type: "attack", from: "B", to: "A", dice: 1 });
    expect(state.misinformation.A.revealedTo).toContain("p2");
    expect(state.misinformation.A.revealedTo).not.toContain("p3");
    expect(perceivedArmies(state, "p2", "A")).toBe(state.territories.A.armies); // p2 now sees real
    expect(perceivedArmies(state, "p3", "A")).toBe(8); // p3 still fooled
  });
});
