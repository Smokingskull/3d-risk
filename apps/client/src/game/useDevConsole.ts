import { useCallback, useMemo } from "react";
import type { ActionCardType, CampaignKind, Card, CardSymbol, GameEvent, GameState, PlayerId } from "@risk3d/engine";

/**
 * Dev-only cheat console (exposed as `window.risk` in DEV). Forces game conditions
 * that are otherwise unreachable by legal play — for manual testing (e.g. reaching
 * the win/loss screens and the Joshua easter egg on demand). Each command clones the
 * live state, mutates it, and re-seats the session (via `applyDevMutation`), so the
 * changes are authoritative for subsequent play. Players are referenced by id
 * (e.g. "p1"); run `risk.help()`.
 */
export interface DevConsole {
  /** Log the available commands and the current players (ids/names/kinds). */
  help: () => void;
  listPlayers: () => { id: PlayerId; name: string; kind: string; difficulty?: string }[];
  /** Add a unit card to a player's hand (draws a real card unless a symbol is given). */
  addUnitCard: (playerId: PlayerId, symbol?: CardSymbol) => void;
  /** Set a player's secret campaign objective. arg = territoryId / continentId / target playerId. */
  setCampaign: (playerId: PlayerId, kind: CampaignKind, arg: string) => void;
  /** Replace a player's action-card hand. */
  setActionCards: (playerId: PlayerId, cards: ActionCardType[]) => void;
  /** End the game now: playerId wins by campaign objective. */
  winCampaign: (playerId: PlayerId) => void;
  /** End the game now: playerId wins by total conquest (all others eliminated). */
  winTotal: (playerId: PlayerId) => void;
  /** End the game now: you lose — a CPU (or the given player) wins. */
  lose: (playerId?: PlayerId) => void;
}

export function useDevConsole(opts: {
  /** The current live game state (or null when no game is in progress). */
  getState: () => GameState | null;
  /** Re-seat the session on a mutated state and push it through the normal update path. */
  applyDevMutation: (next: GameState, events: GameEvent[]) => void;
}): DevConsole {
  const { getState, applyDevMutation } = opts;

  // Clone the live state (pure data), let the caller mutate it and return any synthetic
  // events, then hand it to the parent to re-seat + push through the update path (so
  // React re-renders, the log appends, winReason derives from a `gameWon` event).
  // Bypasses the engine's legality checks on purpose — this is a debug tool.
  const devMutate = useCallback(
    (mutate: (s: GameState) => GameEvent[] | void) => {
      const cur = getState();
      if (!cur) {
        console.warn("[risk] no game in progress — start one first");
        return;
      }
      const next = structuredClone(cur);
      const events = mutate(next) ?? [];
      applyDevMutation(next, events);
    },
    [getState, applyDevMutation],
  );

  return useMemo<DevConsole>(() => {
    const ACTION_CARDS: ActionCardType[] = [
      "troopTransport",
      "airStrike",
      "misinformation",
      "antiAircraft",
      "minefield",
      "tacticalRetreat",
    ];
    const listPlayers = () =>
      (getState()?.players ?? []).map((p) => ({ id: p.id, name: p.name, kind: p.kind, difficulty: p.difficulty }));
    // Resolve a player in the *clone*; log valid ids and bail (returns undefined) on miss.
    const player = (s: GameState, id: PlayerId) => {
      const p = s.players.find((pl) => pl.id === id);
      if (!p) console.warn(`[risk] no player "${id}". Valid ids:`, s.players.map((pl) => pl.id));
      return p;
    };
    let synthSeq = 0;
    return {
      help() {
        console.log("%cwindow.risk — dev console", "font-weight:bold;font-size:13px");
        console.table(listPlayers());
        console.log(
          [
            "commands (players by id, e.g. 'p1'):",
            "  risk.addUnitCard(id, symbol?)      symbol: infantry|cavalry|artillery|wild (default: draw a card)",
            "  risk.setCampaign(id, kind, arg)    kind: 'country' arg=territoryId | 'continent' arg=continentId | 'assassination' arg=playerId",
            "  risk.setActionCards(id, [cards])   " + ACTION_CARDS.join(" | "),
            "  risk.winCampaign(id)               end now — id wins by campaign",
            "  risk.winTotal(id)                  end now — id wins by total conquest",
            "  risk.lose(id?)                     end now — you lose (a CPU wins)",
            "  risk.listPlayers()                 ids / names / kinds",
          ].join("\n"),
        );
      },
      listPlayers,
      addUnitCard(playerId, symbol) {
        devMutate((s) => {
          const p = player(s, playerId);
          if (!p) return;
          let card: Card;
          if (symbol) {
            const ids = Object.keys(s.board.territories);
            const territory = symbol === "wild" ? null : ids[synthSeq % ids.length];
            card = { id: `dev:${playerId}:${synthSeq++}`, territory, symbol };
          } else {
            card = s.deck.pop() ?? { id: `dev:${playerId}:${synthSeq++}`, territory: null, symbol: "wild" };
          }
          p.cards.push(card);
          console.log(`[risk] ${p.name} now holds ${p.cards.length} unit card(s)`);
        });
      },
      setCampaign(playerId, kind, arg) {
        devMutate((s) => {
          const p = player(s, playerId);
          if (!p) return;
          if (kind === "country") {
            if (!s.board.territories[arg])
              return void console.warn(`[risk] no territory "${arg}". Valid:`, Object.keys(s.board.territories));
            p.campaign = { kind: "country", territory: arg, heldTurns: 0 };
          } else if (kind === "continent") {
            if (!s.board.continents[arg])
              return void console.warn(`[risk] no continent "${arg}". Valid:`, Object.keys(s.board.continents));
            p.campaign = { kind: "continent", continent: arg };
          } else if (kind === "assassination") {
            if (!s.players.some((pl) => pl.id === arg))
              return void console.warn(`[risk] no player "${arg}". Valid:`, s.players.map((pl) => pl.id));
            p.campaign = { kind: "assassination", target: arg };
          } else {
            return void console.warn(`[risk] kind must be 'country' | 'continent' | 'assassination'`);
          }
          console.log(`[risk] ${p.name} campaign:`, p.campaign);
        });
      },
      setActionCards(playerId, cards) {
        devMutate((s) => {
          const p = player(s, playerId);
          if (!p) return;
          const unknown = cards.filter((c) => !ACTION_CARDS.includes(c));
          if (unknown.length) return void console.warn(`[risk] unknown action card(s): ${unknown.join(", ")}. Valid:`, ACTION_CARDS);
          p.actionCards = [...cards];
          console.log(`[risk] ${p.name} action cards:`, p.actionCards);
        });
      },
      winCampaign(playerId) {
        devMutate((s) => {
          const p = player(s, playerId);
          if (!p) return;
          s.winner = playerId;
          console.log(`[risk] ${p.name} wins by campaign`);
          return [{ type: "gameWon", winner: playerId, reason: "campaign" }];
        });
      },
      winTotal(playerId) {
        devMutate((s) => {
          const p = player(s, playerId);
          if (!p) return;
          for (const pl of s.players) if (pl.id !== playerId) pl.eliminated = true;
          s.winner = playerId;
          console.log(`[risk] ${p.name} wins by total conquest`);
          return [{ type: "gameWon", winner: playerId, reason: "elimination" }];
        });
      },
      lose(playerId) {
        devMutate((s) => {
          const winnerId = playerId ?? s.players.find((pl) => pl.kind === "cpu" && !pl.eliminated)?.id;
          if (!winnerId) return void console.warn("[risk] no CPU to hand the win to — pass a playerId to lose(id)");
          if (!s.players.some((pl) => pl.id === winnerId))
            return void console.warn(`[risk] no player "${winnerId}"`);
          for (const pl of s.players) if (pl.id !== winnerId) pl.eliminated = true;
          s.winner = winnerId;
          console.log(`[risk] you lose — ${s.players.find((pl) => pl.id === winnerId)?.name} wins`);
          return [{ type: "gameWon", winner: winnerId, reason: "elimination" }];
        });
      },
    };
  }, [devMutate, getState]);
}
