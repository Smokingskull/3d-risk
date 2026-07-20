import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createGame,
  decideReaction,
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
import { createLocalSession, createOnlineSession, type GameSession } from "./session.js";
import { connect, type Connection } from "../net/connection.js";
import { getTutorialEnabled, setTutorialEnabled } from "../settings.js";
import { useAiWorker } from "./useAiWorker.js";
import { useReinforceMeter } from "./useReinforceMeter.js";
import { useUiPrefs } from "./useUiPrefs.js";
import { useDevConsole, type DevConsole } from "./useDevConsole.js";
import { useGameStore } from "./useGameStore.js";

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
  /**
   * "attacker" — the local human is instigating this attack (full controls).
   * "defender" — the local seat's territory is under attack; a read-only live view
   * of the exchange (no controls). Only opened solo + online, never hotseat.
   */
  role: "attacker" | "defender";
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
  /**
   * The seat *this screen* represents — distinct from the current player. Solo and
   * online have one permanent human at the screen, so it's fixed (the human / your
   * seat). Local hotseat may share one machine between several humans, so it's the
   * current player when they're human, else null (e.g. during a CPU turn — no local
   * active human). Drives the campaign button, the GAME box identity, and which
   * incoming attacks open the read-only defence view.
   */
  localSeat: PlayerId | null;
  selectedFrom: TerritoryId | null;
  validTargets: Set<TerritoryId>;
  /** Full chronological event history for the current game (end-of-game transcript). */
  log: GameEvent[];
  isHumanTurn: boolean;
  /** True while a CPU is computing its move in the worker (drives the HUD indicator). */
  thinking: boolean;
  /** Online multiplayer: connected to the server (in a lobby or game). */
  online: boolean;
  /** The seat this client controls online (null until joined). */
  yourSeat: PlayerId | null;
  /** Final placement (seat ids, best→worst) once an online game ends; null otherwise. */
  ranking: PlayerId[] | null;
  /** The live server connection (for the lobby UI); null when offline. */
  conn: Connection | null;
  /** Enter online play — opens a server connection and shows the lobby. */
  goOnline: () => void;
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
  /** Dev-only cheat console (surfaced as `window.risk` in DEV). */
  dev: DevConsole;
}

export function useHotseat(): Hotseat {
  const { game, getGame, commitGame } = useGameStore();
  const [selectedFrom, setSelectedFrom] = useState<TerritoryId | null>(null);
  const [log, setLog] = useState<GameEvent[]>([]);
  const [tutorial, setTutorial] = useState(getTutorialEnabled);
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
  const { autoRotate, toggleAutoRotate, mode, toggleMode, tourNonce, startTour } = useUiPrefs();
  const { decideAi } = useAiWorker();

  // The session owns how the authoritative state advances (local apply, or the
  // server when online). The hook mirrors its state into the game store for rendering.
  const sessionRef = useRef<GameSession | null>(null);
  // Online play: the server is authoritative; the client sends intents and renders
  // pushed fog-projected views. `yourSeat` is the player id this client controls.
  const [online, setOnline] = useState(false);
  const [yourSeat, setYourSeat] = useState<PlayerId | null>(null);
  const [ranking, setRanking] = useState<PlayerId[] | null>(null);
  const connRef = useRef<Connection | null>(null);
  const engagementRef = useRef<Engagement | null>(null);
  engagementRef.current = engagement;
  // Ref so the stable applyUpdate can tell hotseat apart (it needs `online`, which is
  // React state, not a ref) when deciding whether to open the read-only defence view.
  const onlineRef = useRef(false);
  onlineRef.current = online;
  const autoRef = useRef(false);

  // Whether the CPU step-loop is currently running (prevents re-entry).
  const cpuRunning = useRef(false);
  // True while the worker is computing a CPU action (drives the HUD "thinking" line).
  const [thinking, setThinking] = useState(false);

  // Reinforce meter (peak reinforcements this phase, incl. mid-phase trade bonuses).
  const reinforceTotal = useReinforceMeter(game);

  const activePlayer = game?.players.find((p) => p.id === game.activePlayer) ?? null;
  // Online: it's your turn only when the active seat is *yours*. Local hotseat: any
  // human seat that's active is the (single) player at the keyboard.
  const isHumanTurn = online
    ? !!game && !game.winner && game.activePlayer === yourSeat
    : !!game && !game.winner && activePlayer?.kind === "human";

  // Whose perspective the board is rendered from (for Misinformation fog): the
  // active player while it's a human's turn, otherwise the last human to act (so a
  // human watching a CPU turn keeps their own view). Falls back to the first human.
  const lastHumanRef = useRef<PlayerId | null>(null);
  if (activePlayer?.kind === "human") lastHumanRef.current = activePlayer.id;
  const viewerId: PlayerId | null = online
    ? yourSeat // online the board is always your seat's fog view
    : (activePlayer?.kind === "human" ? activePlayer.id : lastHumanRef.current) ??
      game?.players.find((p) => p.kind === "human")?.id ??
      null;
  // Ref so applyAndStore (stable callback) can read the current viewer.
  const viewerIdRef = useRef<PlayerId | null>(null);
  viewerIdRef.current = viewerId;

  // The seat this screen represents (see Hotseat.localSeat). Solo/online: the single
  // permanent human (the sole human seat / your seat). Hotseat (multiple humans on one
  // machine): the current player while they're human, else none.
  const humanSeats = game?.players.filter((p) => p.kind === "human") ?? [];
  const localSeat: PlayerId | null = online
    ? yourSeat
    : humanSeats.length === 1
      ? humanSeats[0].id
      : activePlayer?.kind === "human"
        ? activePlayer.id
        : null;
  // Ref for stable callbacks (the defence-view detection reads this in applyUpdate).
  const localSeatRef = useRef<PlayerId | null>(null);
  localSeatRef.current = localSeat;

  // React to an advanced state (from a local apply now, or a server push later):
  // sync the ref immediately (so rapid synchronous callers — the auto-attack loop,
  // CPU replay — never read stale state), record events, and surface any reactive-
  // card outcome popups. Shared by every source of state change.
  const applyUpdate = useCallback((state: GameState, events: GameEvent[]) => {
    commitGame(state);
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
    // Combat-modal feedback, derived from events here so it works whether the state
    // advanced from a local apply or a server push (online). Two cases:
    //  - our own attack (engagement role "attacker") — animate each exchange;
    //  - an attack *on us* (solo + online only) — open a read-only defence view and
    //    animate it as each incoming exchange arrives (per-event pacing).
    const eng = engagementRef.current;
    const atk = events.find((e) => e.type === "attacked") as AttackedEvent | undefined;
    if (atk) {
      const local = localSeatRef.current;
      const humanCount = state.players.filter((p) => p.kind === "human").length;
      const hotseat = !onlineRef.current && humanCount > 1;
      const ourOffence = eng?.role === "attacker" && atk.from === eng.from && atk.to === eng.to;
      // The defender owned the target before the attack; on a conquest the live owner
      // has already flipped, so read the previous owner from the conquest event.
      const conq = events.find(
        (e): e is Extract<GameEvent, { type: "territoryConquered" }> => e.type === "territoryConquered" && e.to === atk.to,
      );
      const defender = conq ? conq.previousOwner : state.territories[atk.to]?.owner ?? null;
      const incoming = !hotseat && local != null && atk.player !== local && defender === local;
      if (ourOffence) {
        setLastCombat(atk);
        setCombatSeq((s) => s + 1);
      } else if (incoming) {
        setEngagement({ from: atk.from, to: atk.to, role: "defender" });
        setLastCombat(atk);
        setCombatSeq((s) => s + 1);
      } else if (eng?.role === "defender") {
        // The attacker moved on to someone else — our defence episode is over.
        setEngagement(null);
        setLastCombat(null);
      }
    }
    const airHit = events.find((e) => e.type === "airStrikeResolved");
    if (airHit && airHit.type === "airStrikeResolved" && viewer === airHit.player)
      setCombatNote(
        airHit.nullifiedBy
          ? "Air Strike nullified by Anti-Aircraft!"
          : `Air Strike hit — ${airHit.removed} ${airHit.removed === 1 ? "army" : "armies"} destroyed.`,
      );
  }, [commitGame]);

  // Single apply path for a *human* action: delegate the state advance to the
  // session (local apply today; the server later), then react to the result.
  const applyAndStore = useCallback(
    (action: Action): GameEvent[] | null => {
      const session = sessionRef.current;
      if (!session) return null;
      const events = session.submit(action);
      if (events === null) return null;
      applyUpdate(session.state, events);
      return events;
    },
    [applyUpdate],
  );

  const start = useCallback((mode: BoardMode, seats: SeatSpec[], names: string[], campaign: boolean, actionCards: boolean) => {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    cpuRunning.current = false;
    autoRef.current = false;
    lastHumanRef.current = null;
    setActionOutcome(null);
    const initial = createGame({ players: buildPlayers(seats, names), boardMode: mode, seed, campaign, actionCardsEnabled: actionCards });
    sessionRef.current?.dispose();
    sessionRef.current = createLocalSession(initial);
    commitGame(initial);
    setSelectedFrom(null);
    setSelection(null);
    setEngagement(null);
    setLastCombat(null);
    setAutoAttacking(false);
    setLog([]);
    // Tutorial tips are a persisted global preference, toggled from Options.
    setTutorial(getTutorialEnabled());
    setWinReason(null);
  }, [commitGame]);

  const loadState = useCallback((state: GameState) => {
    cpuRunning.current = false;
    autoRef.current = false;
    lastHumanRef.current = null;
    setActionOutcome(null);
    sessionRef.current?.dispose();
    sessionRef.current = createLocalSession(state);
    commitGame(state);
    setSelectedFrom(null);
    setSelection(null);
    setEngagement(null);
    setLastCombat(null);
    setAutoAttacking(false);
    setLog([]);
    setTutorial(false);
    setWinReason(null);
  }, [commitGame]);

  // Re-seat the local session on a mutated state and push it through the normal update
  // path — the one place the dev console reaches into session ownership.
  const applyDevMutation = useCallback(
    (next: GameState, events: GameEvent[]) => {
      sessionRef.current?.dispose();
      sessionRef.current = createLocalSession(next);
      applyUpdate(next, events);
    },
    [applyUpdate],
  );
  const dev = useDevConsole({ getState: getGame, applyDevMutation });

  const toggleTutorial = useCallback(
    () =>
      setTutorial((t) => {
        setTutorialEnabled(!t);
        return !t;
      }),
    [],
  );

  const reset = useCallback(() => {
    cpuRunning.current = false;
    autoRef.current = false;
    lastHumanRef.current = null;
    setActionOutcome(null);
    sessionRef.current?.dispose();
    sessionRef.current = null;
    connRef.current?.close();
    connRef.current = null;
    setOnline(false);
    setYourSeat(null);
    setRanking(null);
    commitGame(null);
    setSelectedFrom(null);
    setSelection(null);
    setEngagement(null);
    setLastCombat(null);
    setAutoAttacking(false);
    setLog([]);
    setWinReason(null);
  }, [commitGame]);

  // Enter online multiplayer: open a server connection and wire an online session.
  // The server pushes fog-projected views (driving applyUpdate); intents are sent,
  // not applied locally; CPU seats are driven server-side (the CPU loop is off).
  const goOnline = useCallback(() => {
    reset();
    const conn = connect();
    connRef.current = conn;
    const session = createOnlineSession(conn);
    session.onUpdate = (state, events) => applyUpdate(state, events);
    sessionRef.current = session;
    conn.on((msg) => {
      if (msg.type === "joined") setYourSeat(msg.you);
      else if (msg.type === "over") setRanking(msg.ranking);
    });
    setOnline(true);
  }, [reset, applyUpdate]);

  // Drive CPU turns and CPU defender reactions one action at a time. Stepping
  // (rather than planning a whole turn) is required because reactive cards make a
  // turn interactive: an attack may open a defender decision window mid-turn. The
  // loop runs while a CPU must act and pauses whenever a human must (their turn,
  // or their own decision window) — resuming when the state next changes.
  useEffect(() => {
    const g = game;
    if (online) return; // online: the server drives CPU seats, not the client
    if (!g || g.winner || cpuRunning.current) return;
    const actorId = g.pendingDecision ? g.pendingDecision.player : g.activePlayer;
    if (g.players.find((p) => p.id === actorId)?.kind !== "cpu") return;
    cpuRunning.current = true;

    (async () => {
      while (true) {
        const cur = getGame();
        if (!cur || cur.winner) break;
        const id = cur.pendingDecision ? cur.pendingDecision.player : cur.activePlayer;
        if (cur.players.find((p) => p.id === id)?.kind !== "cpu") break; // a human must act
        setThinking(true);
        const action = await decideAi(cur); // off the main thread (worker), sync fallback
        setThinking(false);
        if (!action) break;
        await sleep(delayFor(action));
        if (getGame()?.winner) break;
        if (!applyAndStore(action)) break; // became illegal (state moved) — avoid a busy loop
      }
      setThinking(false);
      cpuRunning.current = false;
    })();
  }, [game?.activePlayer, game?.turn, game?.winner, game?.pendingDecision, applyAndStore, decideAi, online]);

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

  // The selected country persists through a player's whole turn (reinforce → attack →
  // fortify), so it only needs picking once. Drop it at the turn hand-off — the next
  // player (human or CPU) starts with a clean selection.
  const lastActiveRef = useRef<string | null>(null);
  useEffect(() => {
    const active = game?.activePlayer ?? null;
    if (lastActiveRef.current !== active) {
      lastActiveRef.current = active;
      setSelection(null);
    }
  }, [game?.activePlayer]);

  // Close the read-only defence view once our territory has fallen — immediately,
  // unless one of our reactive-card decisions (Minefield / Tactical Retreat) is still
  // open, which holds it while the DecisionPrompt is answered. (The generic effect
  // above already drops it when the attacker leaves the attack phase.)
  useEffect(() => {
    if (engagement?.role !== "defender" || !game || game.winner) return;
    if (game.pendingDecision?.player === localSeat) return; // our decision holds it open
    if (game.territories[engagement.to]?.owner !== localSeat) {
      setEngagement(null);
      setLastCombat(null);
    }
  }, [game, engagement, localSeat]);

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
      // Keep the territory selected so it carries through the rest of the turn
      // (e.g. reinforce → attack without having to re-select). Cleared at the
      // turn hand-off by the active-player effect below.
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
      if (getGame()?.misinformation[to]) applyAndStore({ type: "revealMisinformation", territory: to });
      setEngagement({ from: selectedFrom, to, role: "attacker" });
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
    const g = getGame();
    const eng = engagementRef.current;
    if (!g || !eng || g.pendingOccupation || g.pendingDecision || g.winner) return;
    const from = g.territories[eng.from];
    if (!from || from.armies < 2 || from.owner !== g.activePlayer) return;
    setCombatNote(null); // the air-strike note only applies before the first roll
    // Fire the attack; the dice feedback (lastCombat/combatSeq) is set in applyUpdate,
    // so it works for both a local apply and an online server push.
    applyAndStore({ type: "attack", from: eng.from, to: eng.to, dice: Math.min(3, from.armies - 1) });
    // Local only: resolve a CPU defender's reaction immediately so it doesn't interrupt
    // the attacker (a human defender is prompted). Online, the server does this.
    if (!online) {
      const pd = getGame()?.pendingDecision;
      if (pd && getGame()!.players.find((p) => p.id === pd.player)?.kind === "cpu")
        applyAndStore(decideReaction(getGame()!));
    }
  }, [applyAndStore, online]);

  // Play an action card as the human (Air Strike from combat, Troop Transport from
  // the fortify row). Surfaces the Air Strike outcome as a transient combat note.
  const playActionCard = useCallback(
    (a: Extract<Action, { type: "playActionCard" }>) => {
      if (!isHumanTurn) return;
      // The Air Strike combat note is surfaced in applyUpdate (works online too).
      applyAndStore(a);
    },
    [isHumanTurn, applyAndStore],
  );

  // Resolve a human defender's decision window (Minefield now, Tactical Retreat later).
  const resolveDecision = useCallback(
    (play: boolean, to?: TerritoryId) => {
      const g = getGame();
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
    const g = getGame();
    const eng = engagementRef.current;
    return (
      !!g && !!eng && !g.winner && !g.pendingOccupation && !g.pendingDecision &&
      g.territories[eng.from]?.armies >= 2
    );
  };

  const startAuto = useCallback(() => {
    if (online) return; // online: attacks resolve via server pushes, so roll one at a time
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
  }, [rollOnce, stopAuto, online]);

  const closeEngagement = useCallback(() => {
    if (getGame()?.pendingOccupation) return; // must resolve a capture first
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
        const g = getGame();
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
    localSeat,
    selectedFrom,
    validTargets,
    log,
    isHumanTurn,
    thinking,
    online,
    yourSeat,
    ranking,
    conn: connRef.current,
    goOnline,
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
    dev,
  };
}
