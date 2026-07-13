import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  createGame,
  isLegal,
  pathExists,
  validSetsInHand,
  type Action,
  type BoardMode,
  type Difficulty,
  type GameEvent,
  type GameState,
  type TerritoryId,
} from "@risk3d/engine";
import { PLAYER_COLORS } from "../players.js";

export type SeatSpec = { kind: "human" } | { kind: "cpu"; difficulty: Difficulty };

function buildPlayers(seats: SeatSpec[]) {
  return seats.map((seat, i) => ({
    id: `p${i + 1}`,
    name: seat.kind === "human" ? `Player ${i + 1}` : `CPU ${i + 1}`,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    kind: seat.kind,
    difficulty: seat.kind === "cpu" ? seat.difficulty : undefined,
  }));
}

function mustTrade(state: GameState): boolean {
  if (!state.options.cardsEnabled) return false;
  const p = state.players.find((pl) => pl.id === state.activePlayer)!;
  return p.cards.length >= 5;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const delayFor = (a: Action) =>
  a.type === "placeArmies" || a.type === "tradeCards" ? 160 : a.type === "endTurn" ? 320 : 220;

export interface Hotseat {
  game: GameState | null;
  selectedFrom: TerritoryId | null;
  validTargets: Set<TerritoryId>;
  log: GameEvent[];
  isHumanTurn: boolean;
  tutorial: boolean;
  toggleTutorial: () => void;
  start: (mode: BoardMode, seats: SeatSpec[], tutorial: boolean) => void;
  reset: () => void;
  clickTerritory: (id: TerritoryId) => void;
  endAttack: () => void;
  endTurn: () => void;
  occupy: (count: number) => void;
  tradeFirstSet: () => void;
  availableSets: number;
  mustTrade: boolean;
}

export function useHotseat(): Hotseat {
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<TerritoryId | null>(null);
  const [log, setLog] = useState<GameEvent[]>([]);
  const [tutorial, setTutorial] = useState(false);

  const gameRef = useRef<GameState | null>(null);
  gameRef.current = game;

  // --- AI worker ---
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (a: Action[]) => void>());
  const reqId = useRef(0);
  const runningTurn = useRef(-1);

  useEffect(() => {
    const w = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent) => {
      const { id, actions } = e.data as { id: number; actions: Action[] };
      const resolve = pending.current.get(id);
      if (resolve) {
        pending.current.delete(id);
        resolve(actions);
      }
    };
    workerRef.current = w;
    return () => {
      w.terminate();
      workerRef.current = null;
    };
  }, []);

  const requestPlan = useCallback((state: GameState) => {
    return new Promise<Action[]>((resolve) => {
      const id = ++reqId.current;
      pending.current.set(id, resolve);
      workerRef.current!.postMessage({ id, state });
    });
  }, []);

  const activePlayer = game?.players.find((p) => p.id === game.activePlayer) ?? null;
  const isHumanTurn = !!game && !game.winner && activePlayer?.kind === "human";

  const start = useCallback((mode: BoardMode, seats: SeatSpec[], useTutorial: boolean) => {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    runningTurn.current = -1;
    setGame(createGame({ players: buildPlayers(seats), boardMode: mode, seed }));
    setSelectedFrom(null);
    setLog([]);
    setTutorial(useTutorial);
  }, []);

  const toggleTutorial = useCallback(() => setTutorial((t) => !t), []);

  const reset = useCallback(() => {
    runningTurn.current = -1;
    setGame(null);
    setSelectedFrom(null);
    setLog([]);
  }, []);

  const dispatch = useCallback((action: Action) => {
    setGame((current) => {
      if (!current || !isLegal(current, action)) return current;
      const { state, events } = applyAction(current, action);
      setLog((prev) => [...events].reverse().concat(prev).slice(0, 10));
      return state;
    });
  }, []);

  // Drive CPU turns via the worker, replaying actions with small delays. Resilient
  // to StrictMode double-invocation (guarded by turn) and to quitting mid-turn.
  useEffect(() => {
    const g = game;
    if (!g || g.winner) return;
    const cpu = g.players.find((p) => p.id === g.activePlayer)!;
    if (cpu.kind !== "cpu" || runningTurn.current === g.turn) return;
    runningTurn.current = g.turn;
    const plannedTurn = g.turn;

    (async () => {
      const actions = await requestPlan(g);
      const stillActing = () => {
        const c = gameRef.current;
        return c && !c.winner && c.turn === plannedTurn && c.activePlayer === cpu.id;
      };
      for (const a of actions) {
        if (!stillActing()) return;
        await sleep(delayFor(a));
        if (!stillActing()) return;
        dispatch(a);
      }
    })();
  }, [game?.activePlayer, game?.turn, game?.winner, requestPlan, dispatch]);

  // Drop a stale selection when it stops being a legal source.
  useEffect(() => {
    if (!game || !selectedFrom) return;
    const t = game.territories[selectedFrom];
    const ok =
      t &&
      t.owner === game.activePlayer &&
      t.armies >= 2 &&
      !game.pendingOccupation &&
      (game.phase === "attack" || game.phase === "fortify");
    if (!ok) setSelectedFrom(null);
  }, [game, selectedFrom]);

  const validTargets = useMemo<Set<TerritoryId>>(() => {
    if (!game || !selectedFrom) return new Set();
    const me = game.activePlayer;
    if (game.phase === "attack" && !game.pendingOccupation) {
      return new Set(
        game.board.territories[selectedFrom].neighbours.filter((n) => game.territories[n].owner !== me),
      );
    }
    if (game.phase === "fortify") {
      return new Set(
        Object.keys(game.territories).filter((t) => t !== selectedFrom && pathExists(game, me, selectedFrom, t)),
      );
    }
    return new Set();
  }, [game, selectedFrom]);

  const clickTerritory = useCallback(
    (id: TerritoryId) => {
      if (!game || game.winner || !isHumanTurn) return;
      const t = game.territories[id];
      if (!t) return;
      const me = game.activePlayer;

      if (game.phase === "reinforce") {
        if (t.owner === me && !mustTrade(game)) dispatch({ type: "placeArmies", territory: id, count: 1 });
        return;
      }
      if (game.pendingOccupation) return;
      if (id === selectedFrom) {
        setSelectedFrom(null);
        return;
      }
      if (game.phase === "attack") {
        if (selectedFrom && t.owner !== me && validTargets.has(id)) {
          dispatch({ type: "attack", from: selectedFrom, to: id, dice: Math.min(3, game.territories[selectedFrom].armies - 1) });
        } else if (t.owner === me && t.armies >= 2) setSelectedFrom(id);
        else setSelectedFrom(null);
        return;
      }
      if (game.phase === "fortify") {
        if (selectedFrom && validTargets.has(id)) {
          dispatch({ type: "fortify", from: selectedFrom, to: id, count: game.territories[selectedFrom].armies - 1 });
          setSelectedFrom(null);
        } else if (t.owner === me && t.armies >= 2) setSelectedFrom(id);
        else setSelectedFrom(null);
      }
    },
    [game, isHumanTurn, selectedFrom, validTargets, dispatch],
  );

  const guardHuman = useCallback((fn: () => void) => () => { if (isHumanTurn) fn(); }, [isHumanTurn]);
  const endAttack = useMemo(() => guardHuman(() => dispatch({ type: "endAttack" })), [guardHuman, dispatch]);
  const endTurn = useMemo(() => guardHuman(() => dispatch({ type: "endTurn" })), [guardHuman, dispatch]);
  const occupy = useCallback((count: number) => { if (isHumanTurn) dispatch({ type: "occupy", count }); }, [isHumanTurn, dispatch]);

  const activeHand = activePlayer?.cards ?? [];
  const sets = useMemo(() => validSetsInHand(activeHand), [activeHand]);
  const tradeFirstSet = useCallback(() => { if (isHumanTurn && sets.length > 0) dispatch({ type: "tradeCards", cards: sets[0] }); }, [isHumanTurn, sets, dispatch]);

  return {
    game,
    selectedFrom,
    validTargets,
    log,
    isHumanTurn,
    tutorial,
    toggleTutorial,
    start,
    reset,
    clickTerritory,
    endAttack,
    endTurn,
    occupy,
    tradeFirstSet,
    availableSets: sets.length,
    mustTrade: game ? mustTrade(game) : false,
  };
}
