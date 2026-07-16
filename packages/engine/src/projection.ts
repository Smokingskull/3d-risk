/**
 * Fog-of-war projection for online multiplayer. Given the authoritative game state
 * and a viewer, returns a redacted `GameState` safe to send to that player:
 *
 *  - opponents' hand cards are hidden (contents masked; the COUNT is public in RISK
 *    so array length is preserved),
 *  - opponents' action cards are hidden entirely (existence is secret),
 *  - opponents' secret campaign objectives are removed,
 *  - army counts are replaced with the viewer's `perceivedArmies` (so Misinformation
 *    bluffs read as real to opponents), and the Misinformation map is stripped to the
 *    viewer's own bluffs (they must not learn which enemy territories are bluffed),
 *  - the draw pile and the RNG seed/cursor are stripped (undrawn cards and dice are
 *    server authority — a client must never be able to predict them).
 *
 * Public facts (territory ownership, phase, turn, whose move it is, occupation and
 * decision windows, winner) are preserved. The result is display-only — it is never
 * fed back into `applyAction`; the server always mutates the true state.
 */
import { perceivedArmies } from "./game.js";
import type { Card, GameState, PlayerId, TerritoryId, TerritoryState } from "./types.js";

const maskedCard = (owner: PlayerId, i: number): Card => ({ id: `hidden:${owner}:${i}`, territory: null, symbol: "infantry" });

export function projectStateForViewer(state: GameState, viewer: PlayerId): GameState {
  const players = state.players.map((p) =>
    p.id === viewer
      ? { ...p } // your own cards / action cards / objective stay intact
      : {
          ...p,
          cards: p.cards.map((_, i) => maskedCard(p.id, i)), // count public, contents hidden
          actionCards: [], // secret one-shots — existence hidden from opponents
          campaign: undefined, // secret objective hidden
        },
  );

  const territories: Record<TerritoryId, TerritoryState> = {};
  for (const id of Object.keys(state.territories))
    territories[id] = { owner: state.territories[id].owner, armies: perceivedArmies(state, viewer, id) };

  // Keep only the viewer's own bluffs; opponents' bluffs are invisible (their fake
  // count already shows through `perceivedArmies` above).
  const misinformation: GameState["misinformation"] = {};
  for (const id of Object.keys(state.misinformation))
    if (state.territories[id].owner === viewer) misinformation[id] = state.misinformation[id];

  return {
    ...state,
    players,
    territories,
    misinformation,
    deck: [], // undrawn cards are secret
    rngSeed: 0, // dice stay server-side authority
    rngCursor: 0,
  };
}
