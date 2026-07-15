import type { ReactNode } from "react";

/** Labelled checkbox toggle (the `.toggle` control). */
export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={() => onChange()} />
      <span>{children}</span>
    </label>
  );
}
