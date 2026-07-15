import type { ReactNode } from "react";

/**
 * Modal backdrop + centered card. Clicking the backdrop calls `onClose` (unless
 * `closeOnBackdrop` is false); clicks inside the card never bubble to it. This is
 * the single backdrop implementation behind {@link Dialog} and other overlays.
 */
export function Overlay({
  cardClassName,
  onClose,
  closeOnBackdrop = true,
  children,
}: {
  cardClassName?: string;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="overlay"
      onClick={
        closeOnBackdrop
          ? (e) => {
              // Stop the click reaching any ancestor overlay (e.g. a dialog nested
              // inside another), so it closes only this one.
              e.stopPropagation();
              onClose?.();
            }
          : undefined
      }
    >
      <div
        className={cardClassName ? `overlay-card ${cardClassName}` : "overlay-card"}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
