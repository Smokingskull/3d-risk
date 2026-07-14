import type { Hotseat } from "./game/useHotseat.js";

/** Centred options popup opened from the Game box: tutorial + auto-rotate
 *  toggles, and Quit-to-Menu / Resume at the bottom. */
export function OptionsDialog({ hs, onClose }: { hs: Hotseat; onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card options-card" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h2>Options</h2>
          <button className="tut-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <label className="toggle">
          <input type="checkbox" checked={hs.tutorial} onChange={hs.toggleTutorial} />
          <span>Show tutorial tips</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={hs.autoRotate} onChange={hs.toggleAutoRotate} />
          <span>Auto-rotate the globe when picking from the Continents box</span>
        </label>

        <div className="options-actions">
          <button className="quiet" onClick={hs.reset}>
            Quit to Menu
          </button>
          <button className="start" onClick={onClose}>
            Resume
          </button>
        </div>
      </div>
    </div>
  );
}
