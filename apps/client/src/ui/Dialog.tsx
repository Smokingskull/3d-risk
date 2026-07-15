import type { ReactNode } from "react";
import { Overlay } from "./Overlay.js";
import { CloseButton } from "./CloseButton.js";

/**
 * Standard dialog: backdrop + card + a header (title and close "×") followed by
 * the body. `cardClassName` adds the per-dialog width/layout modifier class.
 */
export function Dialog({
  title,
  cardClassName,
  onClose,
  closeOnBackdrop = true,
  children,
}: {
  title: ReactNode;
  cardClassName?: string;
  onClose: () => void;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  return (
    <Overlay cardClassName={cardClassName} onClose={onClose} closeOnBackdrop={closeOnBackdrop}>
      <div className="overlay-head">
        <h2>{title}</h2>
        <CloseButton onClick={onClose} />
      </div>
      {children}
    </Overlay>
  );
}
