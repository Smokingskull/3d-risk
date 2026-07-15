import { useEffect, useState } from "react";
import { perceivedArmies, reinforcementsFor } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import { Button, CloseButton, Dot } from "./ui/index.js";

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

  // Misinformation: enemies see the perceived (possibly fake) count; the owner sees
  // the real count plus their own bluff.
  const perceived = hs.viewerId ? perceivedArmies(game, hs.viewerId, id) : t.armies;
  const mis = game.misinformation[id];
  const canMisinform =
    game.options.actionCardsEnabled &&
    game.phase === "reinforce" &&
    mine &&
    !!game.players.find((p) => p.id === me)?.actionCards.includes("misinformation");
  const playMisinfo = (fake: number) => {
    hs.playActionCard({ type: "playActionCard", card: "misinformation", territory: id, fake });
    hs.closeDialog();
  };

  let body: React.ReactNode = null;

  if (game.phase === "reinforce") {
    if (mine)
      body = (
        <>
          {hs.mustTrade ? (
            <p className="hint">You hold 5+ cards — trade a set (top-left) before deploying.</p>
          ) : (
            <div className="pop-action">
              <Stepper min={1} max={Math.max(1, game.reinforcementsRemaining)} value={Math.min(amount, game.reinforcementsRemaining || 1)} onChange={setAmount} />
              <Button onClick={() => hs.deploy(id, Math.min(amount, game.reinforcementsRemaining))}>
                Deploy
              </Button>
            </div>
          )}
          {canMisinform && <MisinfoControl real={t.armies} swing={reinforcementsFor(game, me)} onSet={playMisinfo} />}
        </>
      );
    else body = <p className="hint">Enemy territory — you can't reinforce here.</p>;
  } else if (game.phase === "attack") {
    if (!mine) {
      if (isSource === false && isTarget) body = <Button onClick={() => hs.attackTarget(id)}>⚔ Attack from {hs.selectedFrom}</Button>;
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
      body = <Button onClick={() => hs.chooseSource(id)}>Attack from here</Button>;
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
          <Button onClick={() => hs.fortifyMove(id, Math.min(amount, fromArmies - 1))}>
            Move here from {hs.selectedFrom}
          </Button>
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
      body = <Button onClick={() => hs.chooseSource(id)}>Move armies from here</Button>;
    } else {
      body = <p className="hint">{hs.selectedFrom ? "Not connected to your selected source." : "Only 1 army — can't move from here."}</p>;
    }
  }

  return (
    <div className="country-pop">
      <div className="pop-head">
        <Dot color={ownerColor} />
        <strong>{id}</strong>
        <CloseButton onClick={hs.closeDialog} />
      </div>
      <div className="pop-info">
        {mine ? `Your territory · ${t.armies} armies` : `Held by ${ownerName} · ${perceived} armies`}
        {mine && mis ? <span className="misinfo-note"> (shown to enemies as {mis.fake})</span> : null}
      </div>
      <div className="pop-body">{body}</div>
    </div>
  );
}

/** Set a fake displayed army count on an owned territory (Misinformation). */
function MisinfoControl({ real, swing, onSet }: { real: number; swing: number; onSet: (fake: number) => void }) {
  const [open, setOpen] = useState(false);
  const [fake, setFake] = useState(real);
  const min = Math.max(1, real - swing);
  const max = real + swing;
  const value = Math.min(max, Math.max(min, fake));
  if (!open)
    return (
      <div className="misinfo-block">
        <button className="card-btn misinfo-open" onClick={() => { setFake(real); setOpen(true); }}>
          Misinformation
        </button>
      </div>
    );
  return (
    <div className="misinfo-block misinfo-action">
      <span className="hint">Show enemies a fake count — real is {real}:</span>
      <div className="pop-action">
        <Stepper min={min} max={max} value={value} onChange={setFake} />
        <Button onClick={() => onSet(value)}>Show {value}</Button>
      </div>
    </div>
  );
}
