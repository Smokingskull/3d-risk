import type { ButtonHTMLAttributes } from "react";

/**
 * Primary/secondary action button. `variant` picks the look:
 *  - "start" — the filled primary button (default).
 *  - "quiet" — the low-emphasis secondary button.
 * Everything else (onClick, disabled, children, aria-*, type) passes straight through.
 */
export function Button({
  variant = "start",
  className,
  ...rest
}: { variant?: "start" | "quiet" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={className ? `${variant} ${className}` : variant} {...rest} />;
}
