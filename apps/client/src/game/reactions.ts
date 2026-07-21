import type { ActionCardType, GameEvent, GameState, PlayerId, TerritoryId } from "@risk3d/engine";

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

/** What the caller knows when deriving reactions for one event batch. */
export interface ReactionContext {
  /** The state as of this batch. */
  state: GameState;
  /** Whose perspective the popups are shown from (Misinformation fog viewer). */
  viewer: PlayerId | null;
  /** The seat this screen represents (drives the incoming-defence view). */
  localSeat: PlayerId | null;
  online: boolean;
  /** The current combat engagement (for detecting our own attacks / our defence). */
  engagement: Engagement | null;
}

/** A combat-modal update derived from an `attacked` event. */
export type CombatUpdate =
  | { kind: "offence"; atk: AttackedEvent } // our own attack — animate the exchange
  | { kind: "incoming"; atk: AttackedEvent } // an attack on us — open the read-only defence view
  | { kind: "defenceOver" }; // the attacker moved on — close our defence view

/** One declarative UI reaction to something in an event batch. The caller applies it. */
export interface Reaction {
  /** A dismissible outcome banner (reactive-card result), for the involved human. */
  outcome?: ActionOutcome;
  /** Transient combat-modal note (the Air Strike result, for the attacker). */
  combatNote?: string;
  /** Combat-modal engagement/feedback update. */
  combat?: CombatUpdate;
}

/**
 * Derive the ordered UI reactions for one event batch — reactive-card outcome popups
 * and combat-modal feedback — from a viewer's perspective. Pure and unit-testable; the
 * caller (useHotseat's reaction effect) applies each Reaction to React state. This
 * replaces the imperative event-scanning that used to live inline.
 *
 * Popups only fire for a human who was actually involved (played the card, or it was
 * used against them); CPU-vs-CPU card play produces no popup for a watching human.
 */
export function reactionsFor(events: GameEvent[], ctx: ReactionContext): Reaction[] {
  const { state, viewer, localSeat, online, engagement } = ctx;
  const out: Reaction[] = [];
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
  const plural = (n: number) => (n === 1 ? "army" : "armies");

  // Minefield: the layer and the attacker each see a tailored outcome.
  const mined = events.find((e) => e.type === "occupied" && e.mineLoss !== undefined);
  if (mined && mined.type === "occupied") {
    const attacker = state.territories[mined.to].owner ?? "";
    const n = mined.mineLoss ?? 0;
    if (viewer === mined.minedBy) {
      out.push({ outcome: { card: "minefield", text: n
        ? `Your minefield destroyed ${n} of ${nameOf(attacker)}'s ${plural(n)} as they took ${mined.to}.`
        : `${nameOf(attacker)} took ${mined.to} — your minefield caught nothing (only 1 army moved in).` } });
    } else if (viewer === attacker) {
      out.push({ outcome: { card: "minefield", text: n
        ? `You took ${mined.to}, but a minefield destroyed ${n} of your ${plural(n)} moving in.`
        : `You took ${mined.to} — the minefield caught nothing (you moved in just 1 army).` } });
    }
  }

  // Air Strike against the viewer (an opponent striking them). The attacker who plays it
  // gets the combat-modal note instead (below).
  const air = events.find((e) => e.type === "airStrikeResolved");
  if (air && air.type === "airStrikeResolved") {
    const defender = state.territories[air.target]?.owner;
    if (viewer === defender && viewer !== air.player) {
      out.push({ outcome: air.nullifiedBy
        ? { card: "antiAircraft", text: `Your Anti-Aircraft nullified an Air Strike on ${air.target}.` }
        : { card: "airStrike", text: `An Air Strike hit your ${air.target} — ${air.removed} ${plural(air.removed)} lost.` } });
    }
  }

  // Tactical Retreat: the retreating defender and the capturing attacker each see it.
  const retreat = events.find((e) => e.type === "tacticalRetreat");
  if (retreat && retreat.type === "tacticalRetreat") {
    const n = retreat.count;
    if (viewer === retreat.player)
      out.push({ outcome: { card: "tacticalRetreat", text: `You pulled ${n} ${plural(n)} back to ${retreat.to}, ceding ${retreat.from} to ${nameOf(retreat.capturedBy)}.` } });
    else if (viewer === retreat.capturedBy)
      out.push({ outcome: { card: "tacticalRetreat", text: `${nameOf(retreat.player)} retreated ${n} ${plural(n)} to ${retreat.to} — you take ${retreat.from}.` } });
  }

  // Combat-modal feedback from an `attacked` event: our own attack, an attack on us
  // (solo + online only), or the end of our defence episode.
  const atk = events.find((e) => e.type === "attacked") as AttackedEvent | undefined;
  if (atk) {
    const humanCount = state.players.filter((p) => p.kind === "human").length;
    const hotseat = !online && humanCount > 1;
    const ourOffence = engagement?.role === "attacker" && atk.from === engagement.from && atk.to === engagement.to;
    // The defender owned the target before the attack; on a conquest the live owner has
    // already flipped, so read the previous owner from the conquest event.
    const conq = events.find(
      (e): e is Extract<GameEvent, { type: "territoryConquered" }> => e.type === "territoryConquered" && e.to === atk.to,
    );
    const defender = conq ? conq.previousOwner : state.territories[atk.to]?.owner ?? null;
    const incoming = !hotseat && localSeat != null && atk.player !== localSeat && defender === localSeat;
    if (ourOffence) out.push({ combat: { kind: "offence", atk } });
    else if (incoming) out.push({ combat: { kind: "incoming", atk } });
    else if (engagement?.role === "defender") out.push({ combat: { kind: "defenceOver" } });
  }

  // Air Strike combat-modal note, for the human who played it.
  const airHit = events.find((e) => e.type === "airStrikeResolved");
  if (airHit && airHit.type === "airStrikeResolved" && viewer === airHit.player)
    out.push({ combatNote: airHit.nullifiedBy
      ? "Air Strike nullified by Anti-Aircraft!"
      : `Air Strike hit — ${airHit.removed} ${plural(airHit.removed)} destroyed.` });

  return out;
}
