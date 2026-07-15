/**
 * Board loader. The board is generated from the globe model's manifest by
 * scripts/build-classic.mjs (run `pnpm --filter @risk3d/engine build:classic`).
 * Do not hand-edit the generated JSON — edit the manifest and regenerate.
 */
import type { BoardDefinition, BoardMode } from "./types.js";
import classicBoard from "./data/classic.board.json";

export type { BoardMode };

// Cast through unknown: the generated JSON matches BoardDefinition (validated at
// build time), but TS infers only its structural literal.
const boards: Record<BoardMode, BoardDefinition> = {
  classic: classicBoard as unknown as BoardDefinition,
};

/** Returns the static board for a mode. */
export function getBoard(mode: BoardMode): BoardDefinition {
  return boards[mode];
}

export const CLASSIC_BOARD = boards.classic;
