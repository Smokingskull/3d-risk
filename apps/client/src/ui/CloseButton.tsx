import { Icon } from "../Icon.js";

/** The corner "×" close button shared by every dialog (the `.tut-x` control). */
export function CloseButton({
  onClick,
  className,
  label = "Close",
}: {
  onClick: () => void;
  className?: string;
  label?: string;
}) {
  return (
    <button className={className ? `tut-x ${className}` : "tut-x"} aria-label={label} onClick={onClick}>
      <Icon name="close" size={18} />
    </button>
  );
}
