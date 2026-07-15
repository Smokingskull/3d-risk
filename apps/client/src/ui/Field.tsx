import type { ReactNode } from "react";

/** A labelled settings row (the `.field` control): a heading, the control(s), and
 *  an optional hint line beneath. */
export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}
