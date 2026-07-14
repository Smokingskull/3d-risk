import { useEffect, useState } from "react";
import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";

function Stepper({ min, max, value, onChange }: { min: number; max: number; value: number; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="stepper">
      <button onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label="less">
        −
      </button>
      <span className="stepper-val">{value}</span>
      <button onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label="more">
        +
      </button>
      {max > min && <button className="stepper-max" onClick={() => onChange(max)}>max</button>}
    </div>
  );
}

export function CountryPopup({ hs }: { hs: Hotseat }) {
  const game = hs.game;
  const id = hs.selection;

  // Deploy/move amount, reset whenever the dialog opens on a new country.
  const [amount, setAmount] = useState(1);
  useEffect(() => {
    if (game && id) setAmount(game.reinforcementsRemaining || 1);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!game || !id) return null;
  const t = game.territories[id];
  if (!t) return null;

  const me = game.activePlayer;
  const mine = t.owner === me;
  const ownerName = game.players.find((p) => p.id === t.owner)?.name ?? "—";
  const ownerColor = game.players.find((p) => p.id === t.owner)?.color ?? "#6b7280";
  const isSource = hs.selectedFrom === id;
  const isTarget = hs.validTargets.has(id);
  const fromArmies = hs.selectedFrom ? (game.territories[hs.selectedFrom]?.armies ?? 0) : 0;

  let body: React.ReactNode = null;

  if (game.phase === "reinforce") {
    if (mine && hs.mustTrade) body = <p className="hint">You hold 5+ cards — trade a set (top-left) before deploying.</p>;
    else if (mine)
      body = (
        <div className="pop-action">
          <Stepper min={1} max={Math.max(1, game.reinforcementsRemaining)} value={Math.min(amount, game.reinforcementsRemaining || 1)} onChange={setAmount} />
          <button className="start" onClick={() => hs.deploy(id, Math.min(amount, game.reinforcementsRemaining))}>
            Deploy
          </button>
        </div>
      );
    else body = <p className="hint">Enemy territory — you can't reinforce here.</p>;
  } else if (game.phase === "attack") {
    if (!mine) {
      if (isSource === false && isTarget) body = <button className="start" onClick={() => hs.attackTarget(id)}>⚔ Attack from {hs.selectedFrom}</button>;
      else if (hs.selectedFrom) body = <p className="hint">Not adjacent to {hs.selectedFrom}. Pick a bordering target.</p>;
      else body = <p className="hint">Select one of your bordering territories (2+ armies) to attack from.</p>;
    } else if (isSource) {
      body = (
        <div className="pop-action">
          <span className="hint">Chosen as your attacker — click an enemy neighbour to attack.</span>
          <button onClick={hs.clearSource}>Deselect</button>
        </div>
      );
    } else if (t.armies >= 2) {
      body = <button className="start" onClick={() => hs.chooseSource(id)}>Attack from here</button>;
    } else {
      body = <p className="hint">Only 1 army — needs 2+ to attack.</p>;
    }
  } else if (game.phase === "fortify") {
    if (!mine) {
      body = <p className="hint">Enemy territory.</p>;
    } else if (isTarget) {
      body = (
        <div className="pop-action">
          <Stepper min={1} max={Math.max(1, fromArmies - 1)} value={Math.min(amount, fromArmies - 1)} onChange={setAmount} />
          <button className="start" onClick={() => hs.fortifyMove(id, Math.min(amount, fromArmies - 1))}>
            Move here from {hs.selectedFrom}
          </button>
        </div>
      );
    } else if (isSource) {
      body = (
        <div className="pop-action">
          <span className="hint">Chosen as source — click a connected territory to move to.</span>
          <button onClick={hs.clearSource}>Deselect</button>
        </div>
      );
    } else if (t.armies >= 2) {
      body = <button className="start" onClick={() => hs.chooseSource(id)}>Move armies from here</button>;
    } else {
      body = <p className="hint">{hs.selectedFrom ? "Not connected to your selected source." : "Only 1 army — can't move from here."}</p>;
    }
  }

  return (
    <div className="country-pop">
      <div className="pop-head">
        <span className="pop-dot" style={{ background: ownerColor }} />
        <strong>{id}</strong>
        <button className="tut-x" aria-label="Close" onClick={hs.closeDialog}><Icon name="close" size={18} /></button>
      </div>
      <div className="pop-info">{mine ? `Your territory · ${t.armies} armies` : `Held by ${ownerName} · ${t.armies} armies`}</div>
      <div className="pop-body">{body}</div>
    </div>
  );
}
