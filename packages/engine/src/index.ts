/**
 * Public surface of the RISK rules engine — pure, deterministic, no I/O.
 */
export * from "./types.js";
export * from "./rng.js";
export * from "./board.js";
export * from "./cards.js";
export * from "./events.js";
export * from "./actions.js";
export * from "./game.js";
export * from "./save.js";
export * from "./ai/index.js";

export const ENGINE_VERSION = "0.3.0";
