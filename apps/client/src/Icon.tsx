import type { CSSProperties } from "react";

/**
 * Monochrome UI icon from /assets/icons. Rendered with a CSS mask so it inherits
 * the current text colour (change it by setting `color` on the icon or a parent).
 */
export function Icon({
  name,
  size = 18,
  className,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const url = `/assets/icons/${name}.svg`;
  return (
    <span
      className={className ? `icon ${className}` : "icon"}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
        ...style,
      }}
    />
  );
}
