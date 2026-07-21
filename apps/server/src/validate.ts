/**
 * Runtime validation of the wire protocol. Everything arriving over the socket is
 * untrusted: `JSON.parse` only guarantees valid JSON, not a well-formed message. We
 * validate the shape of every ClientMsg (and the nested Action of an `intent`) before
 * it reaches a handler, so malformed frames are rejected cleanly rather than coercing
 * their way into the engine. The engine still has the final say on *legality*; this is
 * purely about *shape*.
 */
import { ACTION_CARD_TYPES, type ActionCardType, type Difficulty } from "@risk3d/engine";
import { PROTOCOL_VERSION, type ClientMsg } from "@risk3d/protocol";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "joshua"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

export type Validation = { ok: true; msg: ClientMsg } | { ok: false; reason: string };

/** Validate the shape of an engine Action (the payload of an `intent`). Returns a
 *  reason string if malformed, else null. Legality is checked later by the engine. */
function actionShapeError(a: unknown): string | null {
  if (!isObj(a) || !isStr(a.type)) return "action needs a type";
  switch (a.type) {
    case "tradeCards":
      if (!Array.isArray(a.cards) || a.cards.length !== 3 || !a.cards.every(isStr)) return "tradeCards.cards must be three card ids";
      if (a.bonusTerritory !== undefined && !isStr(a.bonusTerritory)) return "tradeCards.bonusTerritory must be a string";
      return null;
    case "placeArmies":
      return isStr(a.territory) && isNum(a.count) ? null : "placeArmies needs territory + count";
    case "attack":
      return isStr(a.from) && isStr(a.to) && isNum(a.dice) ? null : "attack needs from + to + dice";
    case "occupy":
      return isNum(a.count) ? null : "occupy needs count";
    case "fortify":
      return isStr(a.from) && isStr(a.to) && isNum(a.count) ? null : "fortify needs from + to + count";
    case "endAttack":
    case "endTurn":
      return null;
    case "playActionCard":
      if (!isStr(a.card) || !ACTION_CARD_TYPES.includes(a.card as ActionCardType)) return "playActionCard needs a known card";
      for (const k of ["from", "to", "territory"] as const) if (a[k] !== undefined && !isStr(a[k])) return `playActionCard.${k} must be a string`;
      if (a.fake !== undefined && !isNum(a.fake)) return "playActionCard.fake must be a number";
      return null;
    case "revealMisinformation":
      return isStr(a.territory) ? null : "revealMisinformation needs a territory";
    case "resolveDecision":
      if (!isBool(a.play)) return "resolveDecision needs a boolean play";
      if (a.to !== undefined && !isStr(a.to)) return "resolveDecision.to must be a string";
      return null;
    default:
      return `unknown action "${a.type}"`;
  }
}

/** Validate an inbound client message. On success, narrows it to ClientMsg. */
export function validateClientMsg(raw: unknown): Validation {
  if (!isObj(raw) || !isStr(raw.type)) return { ok: false, reason: "message needs a type" };
  const r = raw;
  const bad = (what: string): Validation => ({ ok: false, reason: `invalid ${what}` });
  const ok = (): Validation => ({ ok: true, msg: raw as unknown as ClientMsg });
  switch (r.type) {
    case "create":
      if (!isStr(r.name)) return bad("create.name");
      if (!isNum(r.players)) return bad("create.players");
      if (r.campaign !== undefined && !isBool(r.campaign)) return bad("create.campaign");
      if (r.actionCards !== undefined && !isBool(r.actionCards)) return bad("create.actionCards");
      return ok();
    case "join":
      return isStr(r.name) && isStr(r.code) ? ok() : bad("join");
    case "reconnect":
      return isStr(r.token) ? ok() : bad("reconnect.token");
    case "setSeat":
      if (!isStr(r.seat)) return bad("setSeat.seat");
      if (r.kind !== "human" && r.kind !== "cpu") return bad("setSeat.kind");
      if (r.difficulty !== undefined && !DIFFICULTIES.includes(r.difficulty as Difficulty)) return bad("setSeat.difficulty");
      return ok();
    case "start":
    case "devForceEnd":
      return ok();
    case "intent": {
      const reason = actionShapeError((r as { action?: unknown }).action);
      return reason ? { ok: false, reason: `intent: ${reason}` } : ok();
    }
    case "chat":
      return isStr(r.text) ? ok() : bad("chat.text");
    case "resolveDrop":
      if (!isStr(r.seat)) return bad("resolveDrop.seat");
      if (r.choice !== "end" && r.choice !== "replace") return bad("resolveDrop.choice");
      return ok();
    default:
      return { ok: false, reason: `unknown message type "${String(r.type)}"` };
  }
}

/** Connect-time protocol check from the request URL's `?v=`. Returns an error reason
 *  if a version is declared and mismatched; null if it matches or is absent (older
 *  clients are tolerated — shape validation still guards every message). */
export function protocolVersionError(reqUrl: string | undefined): string | null {
  const v = new URL(reqUrl ?? "/", "http://localhost").searchParams.get("v");
  if (v !== null && Number(v) !== PROTOCOL_VERSION) return `unsupported protocol version ${v} (server speaks ${PROTOCOL_VERSION})`;
  return null;
}

/**
 * Cross-site WebSocket-hijacking guard. Opt-in: the check is OFF unless
 * `MP_ALLOWED_ORIGINS` is set (comma-separated allowlist; `*` also disables it), so
 * default deployments are unaffected and it can be switched on with an env change +
 * restart (no redeploy). When on, a browser `Origin` that isn't allowlisted is rejected;
 * an absent Origin (non-browser clients — they can't mount a CSWSH attack) is allowed.
 */
export function originAllowed(origin: string | undefined): boolean {
  const cfg = process.env.MP_ALLOWED_ORIGINS?.trim();
  if (!cfg || cfg === "*") return true; // check disabled (default)
  if (!origin) return true; // no browser Origin → not a cross-site vector
  return cfg.split(",").map((s) => s.trim()).filter(Boolean).includes(origin);
}
