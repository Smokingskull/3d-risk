import { useRef, type ReactNode } from "react";

/**
 * Modal backdrop + centered card. Clicking the backdrop calls `onClose` (unless
 * `closeOnBackdrop` is false); clicks inside the card never bubble to it. The
 * single backdrop implementation behind {@link Dialog} (default `.overlay` /
 * `.overlay-card`) and the combat modals (`.combat-backdrop` / `.combat`).
 *
 * A backdrop close only fires when the press *began* on the backdrop. This stops
 * a text-selection drag that starts inside the card and releases outside it (the
 * click then lands on the backdrop) from being mistaken for an outside click.
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
  const pressedBackdrop = useRef(false);

  return (
    <div
      className={backdropClassName}
      onMouseDown={closeOnBackdrop ? (e) => (pressedBackdrop.current = e.target === e.currentTarget) : undefined}
      onClick={
        closeOnBackdrop
          ? (e) => {
              // Only a press that started AND ended on the backdrop counts as an
              // outside click — not a drag that began inside the card.
              if (e.target !== e.currentTarget || !pressedBackdrop.current) return;
              pressedBackdrop.current = false;
              // Stop the click reaching any ancestor overlay (e.g. a dialog nested
              // inside another), so it closes only this one.
              e.stopPropagation();
              onClose?.();
            }
          : undefined
      }
    >
      <div className={cardClassName ? `${cardBaseClassName} ${cardClassName}` : cardBaseClassName}>{children}</div>
    </div>
  );
}
