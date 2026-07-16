import { describe, expect, it } from "vitest";
import { createGame } from "./game.js";
import { projectStateForViewer } from "./projection.js";
import type { GameState } from "./types.js";

// A 2-player classic game with some secret state planted on p2.
function stateWithSecrets(): GameState {
  const s = createGame({
    players: [
      { id: "p1", name: "You", color: "#e6194b", kind: "human" },
      { id: "p2", name: "Rival", color: "#3cb44b", kind: "cpu", difficulty: "hard" },
    ],
    boardMode: "classic",
    seed: 1,
    campaign: true,
    actionCardsEnabled: true,
  });
  const p2 = s.players.find((p) => p.id === "p2")!;
  p2.cards = [
    { id: "card:Brazil", territory: "Brazil", symbol: "infantry" },
    { id: "card:Peru", territory: "Peru", symbol: "cavalry" },
  ];
  p2.actionCards = ["airStrike"];
  p2.campaign = { kind: "continent", continent: "asia" };
  // A bluff on a p2-owned territory: opponents see `fake`, p2 sees the truth.
  const p2Terr = Object.keys(s.territories).find((t) => s.territories[t].owner === "p2")!;
  s.territories[p2Terr].armies = 3;
  s.misinformation[p2Terr] = { fake: 9, revealedTo: [] };
  return { ...s, __p2Terr: p2Terr } as GameState & { __p2Terr: string };
}

describe("projectStateForViewer (fog of war)", () => {
  it("hides an opponent's card contents but keeps the count", () => {
    const s = stateWithSecrets();
    const view = projectStateForViewer(s, "p1");
    const p2 = view.players.find((p) => p.id === "p2")!;
    expect(p2.cards).toHaveLength(2); // count is public
    expect(p2.cards.every((c) => c.id.startsWith("hidden:") && c.territory === null)).toBe(true);
    expect(p2.cards.some((c) => c.id === "card:Brazil")).toBe(false); // no real card leaked
  });

  it("hides an opponent's action cards and secret objective", () => {
    const view = projectStateForViewer(stateWithSecrets(), "p1");
    const p2 = view.players.find((p) => p.id === "p2")!;
    expect(p2.actionCards).toEqual([]);
    expect(p2.campaign).toBeUndefined();
  });

  it("keeps the viewer's own secrets intact", () => {
    const s = stateWithSecrets();
    const view = projectStateForViewer(s, "p2");
    const p2 = view.players.find((p) => p.id === "p2")!;
    expect(p2.cards.map((c) => c.id)).toEqual(["card:Brazil", "card:Peru"]);
    expect(p2.actionCards).toEqual(["airStrike"]);
    expect(p2.campaign).toEqual({ kind: "continent", continent: "asia" });
  });

  it("applies Misinformation: opponents see the fake count, the owner sees the truth", () => {
    const s = stateWithSecrets() as GameState & { __p2Terr: string };
    const t = s.__p2Terr;
    expect(projectStateForViewer(s, "p1").territories[t].armies).toBe(9); // opponent sees the bluff
    expect(projectStateForViewer(s, "p2").territories[t].armies).toBe(3); // owner sees the truth
  });

  it("strips opponents' bluffs from the misinformation map (no 'this is bluffed' tell)", () => {
    const s = stateWithSecrets() as GameState & { __p2Terr: string };
    expect(projectStateForViewer(s, "p1").misinformation[s.__p2Terr]).toBeUndefined();
    expect(projectStateForViewer(s, "p2").misinformation[s.__p2Terr]).toBeDefined(); // own bluff kept
  });

  it("strips the draw pile and RNG authority", () => {
    const view = projectStateForViewer(stateWithSecrets(), "p1");
    expect(view.deck).toEqual([]);
    expect(view.rngSeed).toBe(0);
    expect(view.rngCursor).toBe(0);
  });

  it("preserves public facts (ownership, phase, whose turn, board)", () => {
    const s = stateWithSecrets();
    const view = projectStateForViewer(s, "p1");
    expect(view.activePlayer).toBe(s.activePlayer);
    expect(view.phase).toBe(s.phase);
    expect(view.board).toBe(s.board);
    for (const id of Object.keys(s.territories))
      expect(view.territories[id].owner).toBe(s.territories[id].owner);
  });
});
