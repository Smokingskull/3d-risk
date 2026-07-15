import type { ReactNode } from "react";

/**
 * Single-select segmented switch — the shared `.segmented` control used for
 * yes/no and multi-option choices. The button whose `value` equals `value` gets
 * the `sel` class.
 */
export function Segmented<T>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={o.value === value ? "sel" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
