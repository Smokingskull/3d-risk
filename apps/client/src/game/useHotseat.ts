import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  createGame,
  isLegal,
  maxDisjointSets,
  pathExists,
  type Action,
  type BoardMode,
  type Difficulty,
  type GameEvent,
  type GameState,
  type TerritoryId,
} from "@risk3d/engine";
import { PLAYER_COLORS } from "../players.js";

export type SeatSpec = { kind: "human" } | { kind: "cpu"; difficulty: Difficulty };
export type AttackedEvent = Extract<GameEvent, { type: "attacked" }>;
export interface Engagement {
  from: TerritoryId;
  to: TerritoryId;
}

function buildPlayers(seats: SeatSpec[], names: string[]) {
  return seats.map((seat, i) => ({
    id: `p${i + 1}`,
    name: names[i]?.trim() || `Player ${i + 1}`,
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
const AUTO_ATTACK_DELAY = 600;

export interface Hotseat {
  game: GameState | null;
  selectedFrom: TerritoryId | null;
  validTargets: Set<TerritoryId>;
  log: GameEvent[];
  isHumanTurn: boolean;
  tutorial: boolean;
  toggleTutorial: () => void;
  autoRotate: boolean;
  toggleAutoRotate: () => void;
  /** Globe interaction mode: "select" picks territories, "rotate" only spins. */
  mode: "rotate" | "select";
  toggleMode: () => void;
  /** Bumps to (re)play the guided interface tour. */
  tourNonce: number;
  startTour: () => void;
  // Combat engagement (the centre-screen battle dialog).
  engagement: Engagement | null;
  lastCombat: AttackedEvent | null;
  combatSeq: number;
  autoAttacking: boolean;
  rollOnce: () => void;
  startAuto: () => void;
  stopAuto: () => void;
  closeEngagement: () => void;
  occupy: (count: number) => void;
  // Country action dialog.
  selection: TerritoryId | null;
  closeDialog: () => void;
  deploy: (territory: TerritoryId, count: number) => void;
  chooseSource: (id: TerritoryId) => void;
  clearSource: () => void;
  attackTarget: (to: TerritoryId) => void;
  fortifyMove: (to: TerritoryId, count: number) => void;
  // Lifecycle / other controls.
  start: (mode: BoardMode, seats: SeatSpec[], tutorial: boolean, names: string[], campaign: boolean) => void;
  /** Load a pre-built game state (e.g. a deserialized save) instead of starting fresh. */
  loadState: (state: GameState) => void;
  reset: () => void;
  clickTerritory: (id: TerritoryId) => void;
  endAttack: () => void;
  endTurn: () => void;
  /** Trade a player-chosen set; bonusTerritory picks which owned country gets the +2. */
  tradeSet: (cards: [string, string, string], bonusTerritory?: TerritoryId) => void;
  /** How many sets the active hand can actually cash (disjoint), for the label. */
  tradeableSetCount: number;
  mustTrade: boolean;
  /** How the game was won, once there's a winner (drives the win screen). */
  winReason: "elimination" | "campaign" | null;
}

export function useHotseat(): Hotseat {
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<TerritoryId | null>(null);
  const [log, setLog] = useState<GameEvent[]>([]);
  const [tutorial, setTutorial] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [mode, setMode] = useState<"rotate" | "select">("select");
  const [tourNonce, setTourNonce] = useState(0);
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [lastCombat, setLastCombat] = useState<AttackedEvent | null>(null);
  const [combatSeq, setCombatSeq] = useState(0);
  const [autoAttacking, setAutoAttacking] = useState(false);
  const [selection, setSelection] = useState<TerritoryId | null>(null);
  const [winReason, setWinReason] = useState<"elimination" | "campaign" | null>(null);

  const gameRef = useRef<GameState | null>(null);
  gameRef.current = game;
  const engagementRef = useRef<Engagement | null>(null);
  engagementRef.current = engagement;
  const autoRef = useRef(false);

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

  // Single apply path: validates, applies, syncs the ref immediately (so rapid
  // synchronous callers — the auto-attack loop, CPU replay — never read stale
  // state), and records events. Returns the events, or null if illegal.
  const applyAndStore = useCallback((action: Action): GameEvent[] | null => {
    const g = gameRef.current;
    if (!g || !isLegal(g, action)) return null;
    const { state, events } = applyAction(g, action);
    gameRef.current = state;
    setGame(state);
    setLog((prev) => [...events].reverse().concat(prev).slice(0, 10));
    const won = events.find((e) => e.type === "gameWon");
    if (won && won.type === "gameWon") setWinReason(won.reason ?? null);
    return events;
  }, []);

  const start = useCallback((mode: BoardMode, seats: SeatSpec[], useTutorial: boolean, names: string[], campaign: boolean) => {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    runningTurn.current = -1;
    autoRef.current = false;
    setGame(createGame({ players: buildPlayers(seats, names), boardMode: mode, seed, campaign }));
    setSelectedFrom(null);
    setSelection(null);
    setEngagement(null);
    setLastCombat(null);
    setAutoAttacking(false);
    setLog([]);
    setTutorial(useTutorial);
    setWinReason(null);
  }, []);

  const loadState = useCallback((state: GameState) => {
    runningTurn.current = -1;
    autoRef.current = false;
    gameRef.current = state;
    setGame(state);
    setSelectedFrom(null);
    setSelection(null);
    setEngagement(null);
    setLastCombat(null);
    setAutoAttacking(false);
    setLog([]);
    setTutorial(false);
    setWinReason(null);
  }, []);

  const toggleTutorial = useCallback(() => setTutorial((t) => !t), []);
  const toggleAutoRotate = useCallback(() => setAutoRotate((a) => !a), []);
  const toggleMode = useCallback(() => setMode((m) => (m === "select" ? "rotate" : "select")), []);
  const startTour = useCallback(() => setTourNonce((n) => n + 1), []);

  const reset = useCallback(() => {
    runningTurn.current = -1;
    autoRef.current = false;
    setGame(null);
    setSelectedFrom(null);
    setSelection(null);
    setEngagement(null);
    setLastCombat(null);
    setAutoAttacking(false);
    setLog([]);
    setWinReason(null);
  }, []);

  // Drive CPU turns via the worker (unchanged logic; uses applyAndStore).
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
        applyAndStore(a);
      }
    })();
  }, [game?.activePlayer, game?.turn, game?.winner, requestPlan, applyAndStore]);

  // Drop stale selection/engagement when they stop being valid.
  useEffect(() => {
    if (!game || game.winner || game.phase !== "attack") {
      autoRef.current = false;
      setEngagement(null);
      setLastCombat(null);
      setAutoAttacking(false);
    }
    if (game && selectedFrom) {
      const t = game.territories[selectedFrom];
      const ok = t && t.owner === game.activePlayer && t.armies >= 2 && (game.phase === "attack" || game.phase === "fortify");
      if (!ok) setSelectedFrom(null);
    }
    // Close the country dialog when it's no longer this human's turn.
    if (!game || game.winner || game.players.find((p) => p.id === game.activePlayer)?.kind !== "human") {
      setSelection(null);
    }
  }, [game, selectedFrom]);

  const validTargets = useMemo<Set<TerritoryId>>(() => {
    if (!game || !selectedFrom) return new Set();
    const me = game.activePlayer;
    if (game.phase === "attack" && !game.pendingOccupation) {
      return new Set(game.board.territories[selectedFrom].neighbours.filter((n) => game.territories[n].owner !== me));
    }
    if (game.phase === "fortify") {
      return new Set(Object.keys(game.territories).filter((t) => t !== selectedFrom && pathExists(game, me, selectedFrom, t)));
    }
    return new Set();
  }, [game, selectedFrom]);

  // Clicking a country opens its action dialog (the dialog performs the action).
  const clickTerritory = useCallback(
    (id: TerritoryId) => {
      if (!game || game.winner || !isHumanTurn || engagement || game.pendingOccupation) return;
      if (!game.territories[id]) return; // not playable in this mode
      setSelection(id);
    },
    [game, isHumanTurn, engagement],
  );

  const closeDialog = useCallback(() => setSelection(null), []);
  const deploy = useCallback(
    (territory: TerritoryId, count: number) => {
      applyAndStore({ type: "placeArmies", territory, count });
      setSelection(null);
    },
    [applyAndStore],
  );
  const chooseSource = useCallback((id: TerritoryId) => {
    setSelectedFrom(id);
    setSelection(null);
  }, []);
  const clearSource = useCallback(() => {
    setSelectedFrom(null);
    setSelection(null);
  }, []);
  const attackTarget = useCallback(
    (to: TerritoryId) => {
      if (!selectedFrom) return;
      setEngagement({ from: selectedFrom, to });
      setLastCombat(null);
      setSelection(null);
    },
    [selectedFrom],
  );
  const fortifyMove = useCallback(
    (to: TerritoryId, count: number) => {
      if (!selectedFrom) return;
      applyAndStore({ type: "fortify", from: selectedFrom, to, count });
      setSelectedFrom(null);
      setSelection(null);
    },
    [selectedFrom, applyAndStore],
  );

  // --- combat controls ---
  const rollOnce = useCallback(() => {
    const g = gameRef.current;
    const eng = engagementRef.current;
    if (!g || !eng || g.pendingOccupation || g.winner) return;
    const from = g.territories[eng.from];
    if (!from || from.armies < 2 || from.owner !== g.activePlayer) return;
    const events = applyAndStore({ type: "attack", from: eng.from, to: eng.to, dice: Math.min(3, from.armies - 1) });
    if (events) {
      const atk = events.find((e) => e.type === "attacked") as AttackedEvent | undefined;
      if (atk) setLastCombat(atk);
      setCombatSeq((s) => s + 1);
    }
  }, [applyAndStore]);

  const stopAuto = useCallback(() => {
    autoRef.current = false;
    setAutoAttacking(false);
  }, []);

  const canContinue = () => {
    const g = gameRef.current;
    const eng = engagementRef.current;
    return !!g && !!eng && !g.winner && !g.pendingOccupation && g.territories[eng.from]?.armies >= 2;
  };

  const startAuto = useCallback(() => {
    if (!canContinue()) return;
    autoRef.current = true;
    setAutoAttacking(true);
    const step = () => {
      if (!autoRef.current || !canContinue()) return stopAuto();
      rollOnce();
      if (!autoRef.current || !canContinue()) return stopAuto();
      setTimeout(step, AUTO_ATTACK_DELAY);
    };
    step();
  }, [rollOnce, stopAuto]);

  const closeEngagement = useCallback(() => {
    if (gameRef.current?.pendingOccupation) return; // must resolve a capture first
    autoRef.current = false;
    setAutoAttacking(false);
    setEngagement(null);
    setLastCombat(null);
  }, []);

  const occupy = useCallback(
    (count: number) => {
      if (!isHumanTurn) return;
      applyAndStore({ type: "occupy", count });
      autoRef.current = false;
      setAutoAttacking(false);
      setEngagement(null);
      setLastCombat(null);
    },
    [applyAndStore, isHumanTurn],
  );

  const guardHuman = useCallback((fn: () => void) => () => { if (isHumanTurn) fn(); }, [isHumanTurn]);
  const endAttack = useMemo(() => guardHuman(() => applyAndStore({ type: "endAttack" })), [guardHuman, applyAndStore]);
  const endTurn = useMemo(() => guardHuman(() => applyAndStore({ type: "endTurn" })), [guardHuman, applyAndStore]);

  const activeHand = activePlayer?.cards ?? [];
  const tradeableSetCount = useMemo(() => maxDisjointSets(activeHand), [activeHand]);
  const tradeSet = useCallback(
    (cards: [string, string, string], bonusTerritory?: TerritoryId) => {
      if (isHumanTurn) applyAndStore({ type: "tradeCards", cards, bonusTerritory });
    },
    [isHumanTurn, applyAndStore],
  );

  return {
    game,
    selectedFrom,
    validTargets,
    log,
    isHumanTurn,
    tutorial,
    toggleTutorial,
    autoRotate,
    toggleAutoRotate,
    mode,
    toggleMode,
    tourNonce,
    startTour,
    engagement,
    lastCombat,
    combatSeq,
    autoAttacking,
    rollOnce,
    startAuto,
    stopAuto,
    closeEngagement,
    occupy,
    selection,
    closeDialog,
    deploy,
    chooseSource,
    clearSource,
    attackTarget,
    fortifyMove,
    start,
    loadState,
    reset,
    clickTerritory,
    endAttack,
    endTurn,
    tradeSet,
    tradeableSetCount,
    mustTrade: game ? mustTrade(game) : false,
    winReason,
  };
}
