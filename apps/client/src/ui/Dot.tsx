/** A small round player-colour swatch (the `.dot` control). `className` adds a
 *  size/context modifier (e.g. `combat-dot`). */
export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={className ? `dot ${className}` : "dot"} style={{ background: color }} />;
}
