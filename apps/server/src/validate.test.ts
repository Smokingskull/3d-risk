import { afterEach, describe, expect, it } from "vitest";
import { originAllowed, protocolVersionError, validateClientMsg } from "./validate.js";
import { PROTOCOL_VERSION } from "@risk3d/protocol";

describe("validateClientMsg — well-formed messages", () => {
  const good: unknown[] = [
    { type: "create", name: "Ann", players: 3 },
    { type: "create", name: "Ann", players: 3, campaign: true, actionCards: false },
    { type: "join", name: "Bo", code: "ABCD" },
    { type: "reconnect", token: "tok-123" },
    { type: "setSeat", seat: "p2", kind: "cpu", difficulty: "hard" },
    { type: "setSeat", seat: "p2", kind: "human" },
    { type: "start" },
    { type: "devForceEnd" },
    { type: "chat", text: "hi" },
    { type: "resolveDrop", seat: "p2", choice: "replace" },
    { type: "intent", action: { type: "placeArmies", territory: "Peru", count: 3 } },
    { type: "intent", action: { type: "attack", from: "Peru", to: "Brazil", dice: 3 } },
    { type: "intent", action: { type: "tradeCards", cards: ["a", "b", "c"] } },
    { type: "intent", action: { type: "playActionCard", card: "airStrike", from: "Peru", to: "Brazil" } },
    { type: "intent", action: { type: "resolveDecision", play: true, to: "Peru" } },
    { type: "intent", action: { type: "endTurn" } },
  ];
  it.each(good)("accepts %j", (m) => {
    expect(validateClientMsg(m).ok).toBe(true);
  });
});

describe("validateClientMsg — malformed messages are rejected", () => {
  const bad: unknown[] = [
    null,
    "not an object",
    {},
    { type: 42 },
    { type: "nope" }, // unknown type
    { type: "create", name: "Ann" }, // missing players
    { type: "create", name: "Ann", players: "3" }, // players not a number
    { type: "join", code: "ABCD" }, // missing name
    { type: "reconnect" }, // missing token
    { type: "setSeat", seat: "p2", kind: "robot" }, // bad kind
    { type: "setSeat", seat: "p2", kind: "cpu", difficulty: "godlike" }, // bad difficulty
    { type: "chat" }, // missing text
    { type: "resolveDrop", seat: "p2", choice: "maybe" }, // bad choice
    { type: "intent" }, // missing action
    { type: "intent", action: { type: "attack", from: "Peru" } }, // missing to + dice
    { type: "intent", action: { type: "placeArmies", territory: "Peru", count: "lots" } }, // count not a number
    { type: "intent", action: { type: "playActionCard", card: "deathRay" } }, // unknown card
    { type: "intent", action: { type: "frobnicate" } }, // unknown action
    { type: "intent", action: "nope" }, // action not an object
  ];
  it.each(bad)("rejects %j", (m) => {
    const r = validateClientMsg(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBeTruthy();
  });
});

describe("protocolVersionError (connect handshake)", () => {
  it("accepts a matching version", () => {
    expect(protocolVersionError(`/?v=${PROTOCOL_VERSION}`)).toBeNull();
  });
  it("tolerates an absent version (older clients)", () => {
    expect(protocolVersionError("/")).toBeNull();
    expect(protocolVersionError(undefined)).toBeNull();
  });
  it("rejects a mismatched version", () => {
    expect(protocolVersionError(`/?v=${PROTOCOL_VERSION + 1}`)).toMatch(/unsupported protocol version/);
  });
});

describe("originAllowed (CSWSH guard, opt-in)", () => {
  afterEach(() => {
    delete process.env.MP_ALLOWED_ORIGINS;
  });

  it("allows everything when unset (default off)", () => {
    expect(originAllowed("https://anything.example")).toBe(true);
    expect(originAllowed(undefined)).toBe(true);
  });

  it("allows everything when set to *", () => {
    process.env.MP_ALLOWED_ORIGINS = "*";
    expect(originAllowed("https://evil.example")).toBe(true);
  });

  it("enforces the allowlist when configured", () => {
    process.env.MP_ALLOWED_ORIGINS = "https://3drisk.iainwilson.uk, https://staging.3drisk.iainwilson.uk";
    expect(originAllowed("https://3drisk.iainwilson.uk")).toBe(true);
    expect(originAllowed("https://staging.3drisk.iainwilson.uk")).toBe(true);
    expect(originAllowed("https://evil.example")).toBe(false);
  });

  it("allows an absent Origin (non-browser clients can't mount CSWSH)", () => {
    process.env.MP_ALLOWED_ORIGINS = "https://3drisk.iainwilson.uk";
    expect(originAllowed(undefined)).toBe(true);
  });
});
