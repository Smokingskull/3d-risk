import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  createAI,
  createGame,
  decideReaction,
  isLegal,
  maxDisjointSets,
  pathExists,
  type Action,
  type ActionCardType,
  type BoardMode,
  type Difficulty,
  type GameEvent,
  type GameState,
  type PlayerId,
  type TerritoryId,
} from "@risk3d/engine";
import { PLAYER_COLORS } from "../players.js";
import { getTutorialEnabled, setTutorialEnabled } from "../settings.js";

/**
 * The next action for whichever CPU must act — the player owing a pending
 * decision (a defender reaction), else the active CPU. Returns null when a human
 * must act (their turn, or their decision window). Run on the main thread: the
 * heuristic AI is cheap and this avoids re-serializing the board to a worker each
 * step (needed now that reactive cards make turns interactive rather than
 * plannable up front).
 */
function nextAiAction(state: GameState): Action | null {
  if (state.winner) return null;
  if (state.pendingDecision) {
    const decider = state.players.find((p) => p.id === state.pendingDecision!.player);
    return decider?.kind === "cpu" ? decideReaction(state) : null;
  }
  const active = state.players.find((p) => p.id === state.activePlayer);
  if (active?.kind !== "cpu") return null;
  return createAI((active.difficulty as Difficulty) ?? "medium").decide(state);
}

export type SeatSpec = { kind: "human" } | { kind: "cpu"; difficulty: Difficulty };
export type AttackedEvent = Extract<GameEvent, { type: "attacked" }>;
/** A dismissible outcome banner shown after a reactive card resolves. */
export interface ActionOutcome {
  card: ActionCardType;
  text: string;
}
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
  /** Whose perspective the board is shown from (Misinformation fog); null pre-game. */
  viewerId: PlayerId | null;
  selectedFrom: TerritoryId | null;
  validTargets: Set<TerritoryId>;
  /** Full chronological event history for the current game (end-of-game transcript). */
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
  /** Transient feedback shown in the combat modal (e.g. Air Strike outcome). */
  combatNote: string | null;
  autoAttacking: boolean;
  /** Play one of the active human's action cards (Air Strike, Troop Transport, …). */
  playActionCard: (a: Extract<Action, { type: "playActionCard" }>) => void;
  /** Resolve a human defender's open decision window (Minefield / Tactical Retreat). */
  resolveDecision: (play: boolean, to?: TerritoryId) => void;
  /** Outcome popup after a reactive card resolves (null when none showing). */
  actionOutcome: ActionOutcome | null;
  dismissOutcome: () => void;
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
  start: (mode: BoardMode, seats: SeatSpec[], names: string[], campaign: boolean, actionCards: boolean) => void;
  /** Load a pre-built game state (e.g. a deserialized save) instead of starting fresh. */
  loadState: (state: GameState) => void;
  reset: () => void;
  clickTerritory: (id: TerritoryId) => void;
  endAttack: () => void;
  endTurn: () => void;
  /** End the turn from any phase after reinforce (attack skips through fortify). */
  endTurnNow: () => void;
  /** Trade a player-chosen set; bonusTerritory picks which owned country gets the +2. */
  tradeSet: (cards: [string, string, string], bonusTerritory?: TerritoryId) => void;
  /** How many sets the active hand can actually cash (disjoint), for the label. */
  tradeableSetCount: number;
  mustTrade: boolean;
  /** How the game was won, once there's a winner (drives the win screen). */
  winReason: "elimination" | "campaign" | null;
  /** Total armies to place this reinforce phase (peak, incl. trade bonuses), for the meter. */
  reinforceTotal: number;
}

export function useHotseat(): Hotseat {
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<TerritoryId | null>(null);
  const [log, setLog] = useState<GameEvent[]>([]);
  const [tutorial, setTutorial] = useState(getTutorialEnabled);
  const [autoRotate, setAutoRotate] = useState(true);
  const [mode, setMode] = useState<"rotate" | "select">("select");
  const [tourNonce, setTourNonce] = useState(0);
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [lastCombat, setLastCombat] = useState<AttackedEvent | null>(null);
  const [combatSeq, setCombatSeq] = useState(0);
  /** Transient combat feedback for a played action card (e.g. Air Strike result). */
  const [combatNote, setCombatNote] = useState<string | null>(null);
  /** Dismissible popup summarising a reactive card's outcome (Minefield, Retreat). */
  const [actionOutcome, setActionOutcome] = useState<ActionOutcome | null>(null);
  const [autoAttacking, setAutoAttacking] = useState(false);
  const [selection, setSelection] = useState<TerritoryId | null>(null);
  const [winReason, setWinReason] = useState<"elimination" | "campaign" | null>(null);
  const [reinforceTotal, setReinforceTotal] = useState(0);

  const gameRef = useRef<GameState | null>(null);
  gameRef.current = game;
  const engagementRef = useRef<Engagement | null>(null);
  engagementRef.current = engagement;
  const autoRef = useRef(false);
  // Reinforce-meter tracking: the peak reinforcementsRemaining seen during the
  // current reinforce phase (captures trade bonuses added mid-phase), keyed by
  // turn+player so it resets each new reinforce phase.
  const reinforceTotalRef = useRef(0);
  const reinforceKeyRef = useRef("");

  // Whether the CPU step-loop is currently running (prevents re-entry).
  const cpuRunning = useRef(false);

  const activePlayer = game?.players.find((p) => p.id === game.activePlayer) ?? null;
  const isHumanTurn = !!game && !game.winner && activePlayer?.kind === "human";

  // Whose perspective the board is rendered from (for Misinformation fog): the
  // active player while it's a human's turn, otherwise the last human to act (so a
  // human watching a CPU turn keeps their own view). Falls back to the first human.
  const lastHumanRef = useRef<PlayerId | null>(null);
  if (activePlayer?.kind === "human") lastHumanRef.current = activePlayer.id;
  const viewerId: PlayerId | null =
    (activePlayer?.kind === "human" ? activePlayer.id : lastHumanRef.current) ??
    game?.players.find((p) => p.kind === "human")?.id ??
    null;
  // Ref so applyAndStore (stable callback) can read the current viewer.
  const viewerIdRef = useRef<PlayerId | null>(null);
  viewerIdRef.current = viewerId;

  // Single apply path: validates, applies, syncs the ref immediately (so rapid
  // synchronous callers — the auto-attack loop, CPU replay — never read stale
  // state), and records events. Returns the events, or null if illegal.
  const applyAndStore = useCallback((action: Action): GameEvent[] | null => {
    const g = gameRef.current;
    if (!g || !isLegal(g, action)) return null;
    const { state, events } = applyAction(g, action);
    gameRef.current = state;
    setGame(state);
    // Full chronological history, kept for the end-of-game transcript (shown from
    // the victory/defeat screen, not live in the GAME box).
    setLog((prev) => prev.concat(events));
    const won = events.find((e) => e.type === "gameWon");
    if (won && won.type === "gameWon") setWinReason(won.reason ?? null);
    // Surface a reactive card's outcome popup — but ONLY to a human who was
    // actually involved (they played the card, or it was used against them).
    // CPU-vs-CPU card play produces no popup for the watching human.
    const viewer = viewerIdRef.current;
    const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
    const mined = events.find((e) => e.type === "occupied" && e.mineLoss !== undefined);
    if (mined && mined.type === "occupied") {
      const attacker = state.territories[mined.to].owner ?? "";
      const layer = mined.minedBy;
      const n = mined.mineLoss ?? 0;
      if (viewer === layer) {
        setActionOutcome({
          card: "minefield",
          text: n
            ? `Your minefield destroyed ${n} of ${nameOf(attacker)}'s ${n === 1 ? "army" : "armies"} as they took ${mined.to}.`
            : `${nameOf(attacker)} took ${mined.to} — your minefield caught nothing (only 1 army moved in).`,
        });
      } else if (viewer === attacker) {
        setActionOutcome({
          card: "minefield",
          text: n
            ? `You took ${mined.to}, but a minefield destroyed ${n} of your ${n === 1 ? "army" : "armies"} moving in.`
            : `You took ${mined.to} — the minefield caught nothing (you moved in just 1 army).`,
        });
      }
    }
    // Air Strike against the human viewer (e.g. a CPU striking them). The human
    // attacker who plays it gets the combat-modal note instead (see playActionCard).
    const air = events.find((e) => e.type === "airStrikeResolved");
    if (air && air.type === "airStrikeResolved") {
      const defender = state.territories[air.target]?.owner;
      if (viewer === defender && viewer !== air.player) {
        setActionOutcome(
          air.nullifiedBy
            ? { card: "antiAircraft", text: `Your Anti-Aircraft nullified an Air Strike on ${air.target}.` }
            : { card: "airStrike", text: `An Air Strike hit your ${air.target} — ${air.removed} ${air.removed === 1 ? "army" : "armies"} lost.` },
        );
      }
    }
    const retreat = events.find((e) => e.type === "tacticalRetreat");
    if (retreat && retreat.type === "tacticalRetreat") {
      const n = retreat.count;
      if (viewer === retreat.player) {
        setActionOutcome({
          card: "tacticalRetreat",
          text: `You pulled ${n} ${n === 1 ? "army" : "armies"} back to ${retreat.to}, ceding ${retreat.from} to ${nameOf(retreat.capturedBy)}.`,
        });
      } else if (viewer === retreat.capturedBy) {
        setActionOutcome({
          card: "tacticalRetreat",
          text: `${nameOf(retreat.player)} retreated ${n} ${n === 1 ? "army" : "armies"} to ${retreat.to} — you take ${retreat.from}.`,
        });
      }
    }
    return events;
  }, []);

  const start = useCallback((mode: BoardMode, seats: SeatSpec[], names: string[], campaign: boolean, actionCards: boolean) => {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    cpuRunning.current = false;
    autoRef.current = false;
    lastHumanRef.current = null;
    setActionOutcome(null);
    setGame(createGame({ players: buildPlayers(seats, names), boardMode: mode, seed, campaign, actionCardsEnabled: actionCards }));
    setSelectedFrom(null);
    setSelection(null);
    setEngagement(null);
    setLastCombat(null);
    setAutoAttacking(false);
    setLog([]);
    // Tutorial tips are a persisted global preference, toggled from Options.
    setTutorial(getTutorialEnabled());
    setWinReason(null);
  }, []);

  const loadState = useCallback((state: GameState) => {
    cpuRunning.current = false;
    autoRef.current = false;
    lastHumanRef.current = null;
    setActionOutcome(null);
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

  const toggleTutorial = useCallback(
    () =>
      setTutorial((t) => {
        setTutorialEnabled(!t);
        return !t;
      }),
    [],
  );
  const toggleAutoRotate = useCallback(() => setAutoRotate((a) => !a), []);
  const toggleMode = useCallback(() => setMode((m) => (m === "select" ? "rotate" : "select")), []);
  const startTour = useCallback(() => setTourNonce((n) => n + 1), []);

  const reset = useCallback(() => {
    cpuRunning.current = false;
    autoRef.current = false;
    lastHumanRef.current = null;
    setActionOutcome(null);
    setGame(null);
    setSelectedFrom(null);
    setSelection(null);
    setEngagement(null);
    setLastCombat(null);
    setAutoAttacking(false);
    setLog([]);
    setWinReason(null);
  }, []);

  // Drive CPU turns and CPU defender reactions one action at a time. Stepping
  // (rather than planning a whole turn) is required because reactive cards make a
  // turn interactive: an attack may open a defender decision window mid-turn. The
  // loop runs while a CPU must act and pauses whenever a human must (their turn,
  // or their own decision window) — resuming when the state next changes.
  useEffect(() => {
    const g = game;
    if (!g || g.winner || cpuRunning.current) return;
    const actorId = g.pendingDecision ? g.pendingDecision.player : g.activePlayer;
    if (g.players.find((p) => p.id === actorId)?.kind !== "cpu") return;
    cpuRunning.current = true;

    (async () => {
      while (true) {
        const cur = gameRef.current;
        if (!cur || cur.winner) break;
        const id = cur.pendingDecision ? cur.pendingDecision.player : cur.activePlayer;
        if (cur.players.find((p) => p.id === id)?.kind !== "cpu") break; // a human must act
        const action = nextAiAction(cur);
        if (!action) break;
        await sleep(delayFor(action));
        if (gameRef.current?.winner) break;
        if (!applyAndStore(action)) break; // became illegal (state moved) — avoid a busy loop
      }
      cpuRunning.current = false;
    })();
  }, [game?.activePlayer, game?.turn, game?.winner, game?.pendingDecision, applyAndStore]);

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

  // Track the total armies to place this reinforce phase (for the meter). The
  // running peak captures the base plus any trade bonuses added mid-phase; the
  // turn+player key resets it when a new reinforce phase opens.
  useEffect(() => {
    if (!game || game.phase !== "reinforce") return;
    const key = `${game.turn}:${game.activePlayer}`;
    if (reinforceKeyRef.current !== key) {
      reinforceKeyRef.current = key;
      reinforceTotalRef.current = 0;
    }
    reinforceTotalRef.current = Math.max(reinforceTotalRef.current, game.reinforcementsRemaining);
    if (reinforceTotalRef.current !== reinforceTotal) setReinforceTotal(reinforceTotalRef.current);
  }, [game, reinforceTotal]);

  const validTargets = useMemo<Set<TerritoryId>>(() => {
    if (!game || !selectedFrom) return new Set();
    const me = game.activePlayer;
    if (game.phase === "attack" && !game.pendingOccupation) {
      return new Set(game.board.territories[selectedFrom].neighbours.filter((n) => game.territories[n].owner !== me));
    }
    if (game.phase === "fortify") {
      // Troop Transport (fortifyAnywhere): any owned territory is a valid target.
      if (game.fortifyAnywhere)
        return new Set(Object.keys(game.territories).filter((t) => t !== selectedFrom && game.territories[t].owner === me));
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
      // Committing to the attack lifts any Misinformation on the target for us
      // (persists even if we retreat before rolling).
      if (gameRef.current?.misinformation[to]) applyAndStore({ type: "revealMisinformation", territory: to });
      setEngagement({ from: selectedFrom, to });
      setLastCombat(null);
      setCombatNote(null);
      setSelection(null);
    },
    [selectedFrom, applyAndStore],
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
    if (!g || !eng || g.pendingOccupation || g.pendingDecision || g.winner) return;
    const from = g.territories[eng.from];
    if (!from || from.armies < 2 || from.owner !== g.activePlayer) return;
    const events = applyAndStore({ type: "attack", from: eng.from, to: eng.to, dice: Math.min(3, from.armies - 1) });
    if (events) {
      const atk = events.find((e) => e.type === "attacked") as AttackedEvent | undefined;
      if (atk) setLastCombat(atk);
      setCombatSeq((s) => s + 1);
      setCombatNote(null); // the air-strike note only applies before the first roll
      // A CPU defender's reaction (Minefield / Tactical Retreat) resolves immediately so
      // it doesn't interrupt the attacker; a human defender is prompted instead.
      const pd = gameRef.current?.pendingDecision;
      if (pd && gameRef.current!.players.find((p) => p.id === pd.player)?.kind === "cpu")
        applyAndStore(decideReaction(gameRef.current!));
    }
  }, [applyAndStore]);

  // Play an action card as the human (Air Strike from combat, Troop Transport from
  // the fortify row). Surfaces the Air Strike outcome as a transient combat note.
  const playActionCard = useCallback(
    (a: Extract<Action, { type: "playActionCard" }>) => {
      if (!isHumanTurn) return;
      const events = applyAndStore(a);
      if (!events) return;
      const res = events.find((e) => e.type === "airStrikeResolved");
      if (res && res.type === "airStrikeResolved")
        setCombatNote(
          res.nullifiedBy
            ? "Air Strike nullified by Anti-Aircraft!"
            : `Air Strike hit — ${res.removed} ${res.removed === 1 ? "army" : "armies"} destroyed.`,
        );
    },
    [isHumanTurn, applyAndStore],
  );

  // Resolve a human defender's decision window (Minefield now, Tactical Retreat later).
  const resolveDecision = useCallback(
    (play: boolean, to?: TerritoryId) => {
      const g = gameRef.current;
      if (!g?.pendingDecision) return;
      if (g.players.find((p) => p.id === g.pendingDecision!.player)?.kind !== "human") return;
      applyAndStore({ type: "resolveDecision", play, to });
    },
    [applyAndStore],
  );

  const dismissOutcome = useCallback(() => setActionOutcome(null), []);

  const stopAuto = useCallback(() => {
    autoRef.current = false;
    setAutoAttacking(false);
  }, []);

  const canContinue = () => {
    const g = gameRef.current;
    const eng = engagementRef.current;
    return (
      !!g && !!eng && !g.winner && !g.pendingOccupation && !g.pendingDecision &&
      g.territories[eng.from]?.armies >= 2
    );
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
    setCombatNote(null);
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
  // End the turn from wherever the player is: attack advances through fortify
  // (endAttack applies synchronously, so the follow-up endTurn sees the fortify
  // state); fortify ends directly. Reinforce can't end early — all armies must be
  // placed — so it's a no-op there.
  const endTurnNow = useMemo(
    () =>
      guardHuman(() => {
        const g = gameRef.current;
        if (!g) return;
        if (g.phase === "attack" && !g.pendingOccupation) {
          applyAndStore({ type: "endAttack" });
          applyAndStore({ type: "endTurn" });
        } else if (g.phase === "fortify") {
          applyAndStore({ type: "endTurn" });
        }
      }),
    [guardHuman, applyAndStore],
  );

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
    viewerId,
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
    combatNote,
    autoAttacking,
    playActionCard,
    resolveDecision,
    actionOutcome,
    dismissOutcome,
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
    endTurnNow,
    tradeSet,
    tradeableSetCount,
    mustTrade: game ? mustTrade(game) : false,
    winReason,
    reinforceTotal,
  };
}
