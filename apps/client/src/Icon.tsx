import type { CSSProperties } from "react";

/**
 * Monochrome UI icon from /assets/icons. Rendered with a CSS mask so it inherits
 * the current text colour (change it by setting `color` on the icon or a parent).
 */
export function Icon({
  name,
  size,
  className,
  style,
}: {
  /** Explicit size: number (px) or any CSS length. Omit to size relative to the
   *  adjacent text (1.3em) so the icon is always a touch larger than it. */
  name: string;
  size?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  const url = `/assets/icons/${name}.svg`;
  const dim = size === undefined ? undefined : typeof size === "number" ? `${size}px` : size;
  return (
    <span
      className={className ? `icon ${className}` : "icon"}
      aria-hidden="true"
      style={{
        ...(dim ? { width: dim, height: dim } : null),
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
        ...style,
      }}
    />
  );
}
