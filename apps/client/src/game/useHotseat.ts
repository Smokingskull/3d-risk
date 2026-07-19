import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAI,
  createGame,
  decideReaction,
  maxDisjointSets,
  pathExists,
  type Action,
  type ActionCardType,
  type BoardMode,
  type CampaignKind,
  type Card,
  type CardSymbol,
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

/**
 * Dev-only cheat console (exposed as `window.risk` in DEV). Forces game conditions
 * that are otherwise unreachable by legal play — for manual testing (e.g. reaching
 * the win/loss screens and the Joshua easter egg on demand). Each command clones the
 * live state, mutates it, and re-seats the session, so the changes are authoritative
 * for subsequent play. Players are referenced by id (e.g. "p1"); run `risk.help()`.
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
  // The session owns how the authoritative state advances (local apply, or the
  // server when online). The hook mirrors its state into React state for rendering.
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
  // Reinforce-meter tracking: the peak reinforcementsRemaining seen during the
  // current reinforce phase (captures trade bonuses added mid-phase), keyed by
  // turn+player so it resets each new reinforce phase.
  const reinforceTotalRef = useRef(0);
  const reinforceKeyRef = useRef("");

  // Whether the CPU step-loop is currently running (prevents re-entry).
  const cpuRunning = useRef(false);
  // True while the worker is computing a CPU action (drives the HUD "thinking" line).
  const [thinking, setThinking] = useState(false);

  // AI web worker: computes CPU actions off the main thread so the search-based
  // Joshua tier never freezes the globe. Falls back to a synchronous decide if the
  // worker can't start or errors.
  const aiWorker = useRef<Worker | null>(null);
  const aiWorkerDead = useRef(false);
  const aiPending = useRef(new Map<number, { resolve: (a: Action | null) => void; state: GameState }>());
  const aiReqSeq = useRef(0);

  const decideAi = useCallback((state: GameState): Promise<Action | null> => {
    if (!aiWorker.current && !aiWorkerDead.current) {
      try {
        const w = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
        w.onmessage = (e: MessageEvent<{ reqId: number; action: Action | null }>) => {
          const p = aiPending.current.get(e.data.reqId);
          if (p) {
            aiPending.current.delete(e.data.reqId);
            p.resolve(e.data.action);
          }
        };
        w.onerror = () => {
          aiWorkerDead.current = true;
          aiWorker.current = null;
          for (const [id, p] of aiPending.current) {
            aiPending.current.delete(id);
            p.resolve(nextAiAction(p.state)); // fall back synchronously
          }
        };
        aiWorker.current = w;
      } catch {
        aiWorkerDead.current = true;
      }
    }
    const w = aiWorker.current;
    if (!w) return Promise.resolve(nextAiAction(state));
    const reqId = ++aiReqSeq.current;
    return new Promise((resolve) => {
      aiPending.current.set(reqId, { resolve, state });
      try {
        w.postMessage({ reqId, state });
      } catch {
        aiPending.current.delete(reqId);
        resolve(nextAiAction(state));
      }
    });
  }, []);

  // Tear the worker down with the hook.
  useEffect(() => () => aiWorker.current?.terminate(), []);

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
  }, []);

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
    gameRef.current = initial;
    setGame(initial);
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
    sessionRef.current?.dispose();
    sessionRef.current = createLocalSession(state);
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

  // Dev cheat plumbing: clone the live state (pure data), let the caller mutate it and
  // return any synthetic events, then re-seat the local session on the mutated state and
  // push it through the normal update path (so React re-renders, the log appends, and
  // winReason is derived from a `gameWon` event). Bypasses the engine's legality checks
  // on purpose — this is a debug tool. See DevConsole / window.risk.
  const devMutate = useCallback(
    (mutate: (s: GameState) => GameEvent[] | void) => {
      const cur = gameRef.current;
      if (!cur) {
        console.warn("[risk] no game in progress — start one first");
        return;
      }
      const next = structuredClone(cur);
      const events = mutate(next) ?? [];
      sessionRef.current?.dispose();
      sessionRef.current = createLocalSession(next);
      applyUpdate(next, events);
    },
    [applyUpdate],
  );

  const dev = useMemo<DevConsole>(() => {
    const ACTION_CARDS: ActionCardType[] = [
      "troopTransport",
      "airStrike",
      "misinformation",
      "antiAircraft",
      "minefield",
      "tacticalRetreat",
    ];
    const listPlayers = () =>
      (gameRef.current?.players ?? []).map((p) => ({ id: p.id, name: p.name, kind: p.kind, difficulty: p.difficulty }));
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
  }, [devMutate]);

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
    sessionRef.current?.dispose();
    sessionRef.current = null;
    connRef.current?.close();
    connRef.current = null;
    setOnline(false);
    setYourSeat(null);
    setRanking(null);
    setGame(null);
    setSelectedFrom(null);
    setSelection(null);
    setEngagement(null);
    setLastCombat(null);
    setAutoAttacking(false);
    setLog([]);
    setWinReason(null);
  }, []);

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
        const cur = gameRef.current;
        if (!cur || cur.winner) break;
        const id = cur.pendingDecision ? cur.pendingDecision.player : cur.activePlayer;
        if (cur.players.find((p) => p.id === id)?.kind !== "cpu") break; // a human must act
        setThinking(true);
        const action = await decideAi(cur); // off the main thread (worker), sync fallback
        setThinking(false);
        if (!action) break;
        await sleep(delayFor(action));
        if (gameRef.current?.winner) break;
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
      if (gameRef.current?.misinformation[to]) applyAndStore({ type: "revealMisinformation", territory: to });
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
    const g = gameRef.current;
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
      const pd = gameRef.current?.pendingDecision;
      if (pd && gameRef.current!.players.find((p) => p.id === pd.player)?.kind === "cpu")
        applyAndStore(decideReaction(gameRef.current!));
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
