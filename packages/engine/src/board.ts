/**
 * Board loader. Board data is generated from the globe mesh + curated continent
 * and sea-route data by scripts/build-board.mjs (run `pnpm --filter
 * @risk3d/engine build:board`). Do not hand-edit the generated JSON — edit the
 * source data files and regenerate.
 */
import type { BoardDefinition, BoardMode } from "./types.js";
import worldBoard from "./data/world.board.json";
import classicBoard from "./data/classic.board.json";

export type { BoardMode };

// Casts through unknown: the generated JSON is produced to match BoardDefinition
// exactly (validated at build time), but TS infers only its structural literal.
const boards: Record<BoardMode, BoardDefinition> = {
  world: worldBoard as unknown as BoardDefinition,
  classic: classicBoard as unknown as BoardDefinition,
};

/** Returns the static board for a mode. */
export function getBoard(mode: BoardMode): BoardDefinition {
  return boards[mode];
}

export const CLASSIC_BOARD = boards.classic;
