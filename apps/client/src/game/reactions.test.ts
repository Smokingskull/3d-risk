import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "@risk3d/engine";
import { reactionsFor, type ReactionContext } from "./reactions.js";

/** Minimal state: reactionsFor only reads players (id/name/kind) and territory owners. */
function state(
  players: { id: string; name: string; kind: "human" | "cpu" }[],
  territories: Record<string, { owner: string | null; armies: number }>,
): GameState {
  return { players, territories } as unknown as GameState;
}
const ctx = (over: Partial<ReactionContext> & { state: GameState }): ReactionContext => ({
  viewer: null,
  localSeat: null,
  online: false,
  engagement: null,
  ...over,
});
const HUMANS = [
  { id: "p1", name: "Ann", kind: "human" as const },
  { id: "p2", name: "Bo", kind: "human" as const },
];
const HUMAN_V_CPU = [
  { id: "p1", name: "Ann", kind: "human" as const },
  { id: "p2", name: "Bo", kind: "cpu" as const },
];

describe("reactionsFor — Minefield", () => {
  const s = state(HUMAN_V_CPU, { Brazil: { owner: "p1", armies: 3 } }); // p1 just captured Brazil
  const events: GameEvent[] = [{ type: "occupied", from: "Peru", to: "Brazil", count: 3, mineLoss: 2, minedBy: "p2" }];

  it("tells the layer their mine bit", () => {
    const r = reactionsFor(events, ctx({ state: s, viewer: "p2" }));
    expect(r).toHaveLength(1);
    expect(r[0].outcome?.card).toBe("minefield");
    expect(r[0].outcome?.text).toMatch(/Your minefield destroyed 2 of Ann's armies as they took Brazil/);
  });

  it("tells the attacker they lost armies to it", () => {
    const r = reactionsFor(events, ctx({ state: s, viewer: "p1" }));
    expect(r[0].outcome?.text).toMatch(/You took Brazil, but a minefield destroyed 2 of your armies/);
  });

  it("says nothing to an uninvolved viewer", () => {
    expect(reactionsFor(events, ctx({ state: s, viewer: null }))).toHaveLength(0);
  });
});

describe("reactionsFor — Air Strike", () => {
  const s = state(HUMANS, { Brazil: { owner: "p2", armies: 5 } });
  const ev: GameEvent[] = [{ type: "airStrikeResolved", player: "p1", target: "Brazil", removed: 1, nullifiedBy: null }];

  it("gives the attacker a combat-modal note (not a popup)", () => {
    const r = reactionsFor(ev, ctx({ state: s, viewer: "p1" }));
    expect(r.some((x) => x.combatNote?.includes("Air Strike hit"))).toBe(true);
    expect(r.some((x) => x.outcome)).toBe(false);
  });

  it("gives the struck defender a popup (not a note)", () => {
    const r = reactionsFor(ev, ctx({ state: s, viewer: "p2" }));
    expect(r.some((x) => x.outcome?.card === "airStrike")).toBe(true);
    expect(r.some((x) => x.combatNote)).toBe(false);
  });
});

describe("reactionsFor — Tactical Retreat", () => {
  const s = state(HUMANS, { Brazil: { owner: "p1", armies: 1 } });
  const ev: GameEvent[] = [{ type: "tacticalRetreat", player: "p2", from: "Brazil", to: "Argentina", count: 3, capturedBy: "p1" }];

  it("tells the retreating defender", () => {
    expect(reactionsFor(ev, ctx({ state: s, viewer: "p2" }))[0].outcome?.text).toMatch(/You pulled 3 armies back to Argentina, ceding Brazil to Ann/);
  });
  it("tells the capturing attacker", () => {
    expect(reactionsFor(ev, ctx({ state: s, viewer: "p1" }))[0].outcome?.text).toMatch(/Bo retreated 3 armies to Argentina — you take Brazil/);
  });
});

describe("reactionsFor — combat feedback (attacked)", () => {
  const atk = (player: string): GameEvent => ({
    type: "attacked", player, from: "Peru", to: "Brazil",
    attackerDice: [6], defenderDice: [3], attackerLosses: 0, defenderLosses: 1, conquered: false,
  });

  it("marks our own attack as offence", () => {
    const s = state(HUMANS, { Brazil: { owner: "p2", armies: 2 } });
    const r = reactionsFor([atk("p1")], ctx({ state: s, viewer: "p1", localSeat: "p1", engagement: { from: "Peru", to: "Brazil", role: "attacker" } }));
    expect(r).toEqual([{ combat: { kind: "offence", atk: atk("p1") } }]);
  });

  it("opens a defence view for an attack on us (solo)", () => {
    const s = state(HUMAN_V_CPU, { Brazil: { owner: "p1", armies: 2 } });
    const r = reactionsFor([atk("p2")], ctx({ state: s, viewer: "p1", localSeat: "p1" }));
    expect(r[0].combat?.kind).toBe("incoming");
  });

  it("does NOT open a defence view in local hotseat (two humans)", () => {
    const s = state(HUMANS, { Brazil: { owner: "p1", armies: 2 } });
    const r = reactionsFor([atk("p2")], ctx({ state: s, viewer: "p1", localSeat: "p1", online: false }));
    expect(r).toHaveLength(0); // hotseat: no incoming defence view
  });
});
