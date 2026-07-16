/**
 * Placeholder player palette used to demonstrate per-country ownership colouring
 * on the globe. In the real game these come from the engine's Player list.
 */
export const PLAYER_COLORS = [
  "#e6194b", // red
  "#3cb44b", // green
  "#4363d8", // blue
  "#f58231", // orange
  "#911eb4", // purple
  "#42d4f4", // cyan
] as const;

/** Colour of a territory owned by nobody yet. */
export const NEUTRAL_COLOR = "#6b7280";

/**
 * Colour for a seat id ("p1", "p2", …). Seats are coloured by position, matching
 * both the server PALETTE and single-player `buildPlayers`, so a player's chat name
 * is the same colour as their armies on the globe. Falls back to neutral if the id
 * isn't a recognised "p<n>" seat.
 */
export function seatColor(seatId: string): string {
  const n = /^p(\d+)$/.exec(seatId)?.[1];
  if (!n) return NEUTRAL_COLOR;
  return PLAYER_COLORS[(Number(n) - 1) % PLAYER_COLORS.length];
}
