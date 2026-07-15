import type { ReactNode } from "react";

/**
 * Modal backdrop + centered card. Clicking the backdrop calls `onClose` (unless
 * `closeOnBackdrop` is false); clicks inside the card never bubble to it. The
 * single backdrop implementation behind {@link Dialog} (default `.overlay` /
 * `.overlay-card`) and the combat modals (`.combat-backdrop` / `.combat`).
 */
export function Overlay({
  backdropClassName = "overlay",
  cardBaseClassName = "overlay-card",
  cardClassName,
  onClose,
  closeOnBackdrop = true,
  children,
}: {
  backdropClassName?: string;
  cardBaseClassName?: string;
  cardClassName?: string;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={backdropClassName}
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
        className={cardClassName ? `${cardBaseClassName} ${cardClassName}` : cardBaseClassName}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
