import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";
import { Button, Dialog, Toggle } from "./ui/index.js";

/** Centred options popup opened from the Game box: tutorial + auto-rotate
 *  toggles, and Quit-to-Menu / Resume at the bottom. */
export function OptionsDialog({ hs, onClose, onHelp }: { hs: Hotseat; onClose: () => void; onHelp: () => void }) {
  return (
    <Dialog title="Options" cardClassName="options-card" onClose={onClose}>
      <Toggle checked={hs.tutorial} onChange={hs.toggleTutorial}>
        Show tutorial tips
      </Toggle>
      <Toggle checked={hs.autoRotate} onChange={hs.toggleAutoRotate}>
        Auto-rotate the globe when picking from the Continents box
      </Toggle>

      <button
        className="options-help"
        onClick={() => {
          onClose();
          onHelp();
        }}
      >
        <Icon name="help" /> Help &amp; how to play
      </button>

      <div className="options-actions">
        <Button variant="quiet" onClick={hs.reset}>
          Quit to Menu
        </Button>
        <Button onClick={onClose}>Resume</Button>
      </div>
    </Dialog>
  );
}
