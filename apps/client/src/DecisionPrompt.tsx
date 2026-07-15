import type { Hotseat } from "./game/useHotseat.js";
import { Button, Overlay } from "./ui/index.js";
import { actionCardInfo } from "./actionCards.js";

/**
 * Prompts a human defender to resolve an open decision window during another
 * player's attack. Phase 4 handles Minefield (Tactical Retreat is added later).
 */
export function DecisionPrompt({ hs }: { hs: Hotseat }) {
  const game = hs.game;
  const pd = game?.pendingDecision;
  if (!game || !pd) return null;
  const decider = game.players.find((p) => p.id === pd.player);
  if (decider?.kind !== "human") return null; // CPU resolves automatically
  const attacker = game.players.find((p) => p.id === game.territories[pd.from]?.owner);

  if (pd.kind === "minefield") {
    const info = actionCardInfo("minefield");
    return (
      <Overlay backdropClassName="combat-backdrop" cardBaseClassName="combat" cardClassName="decision-prompt" closeOnBackdrop={false}>
        <h2 className="combat-title">Minefield?</h2>
        <img className="decision-img" src={info.image} alt={info.name} draggable={false} />
        <p className="combat-result">
          {attacker?.name ?? "The enemy"} took <strong>{pd.territory}</strong>. Lay a minefield to
          destroy some of the armies they move in?
        </p>
        <div className="combat-actions">
          <Button onClick={() => hs.resolveDecision(true)}>Lay Minefield</Button>
          <Button variant="quiet" onClick={() => hs.resolveDecision(false)}>
            No, let them pass
          </Button>
        </div>
      </Overlay>
    );
  }

  if (pd.kind === "tacticalRetreat") {
    const info = actionCardInfo("tacticalRetreat");
    const targets = game.board.territories[pd.territory].neighbours.filter(
      (n) => game.territories[n]?.owner === pd.player,
    );
    return (
      <Overlay backdropClassName="combat-backdrop" cardBaseClassName="combat" cardClassName="decision-prompt" closeOnBackdrop={false}>
        <h2 className="combat-title">Tactical Retreat?</h2>
        <img className="decision-img" src={info.image} alt={info.name} draggable={false} />
        <p className="combat-result">
          {attacker?.name ?? "The enemy"} is attacking <strong>{pd.territory}</strong>. Pull all your
          armies out to an adjacent territory — you keep them, but forfeit {pd.territory}.
        </p>
        <div className="combat-actions">
          {targets.map((to) => (
            <Button key={to} onClick={() => hs.resolveDecision(true, to)}>
              Retreat to {to}
            </Button>
          ))}
          <Button variant="quiet" onClick={() => hs.resolveDecision(false)}>
            Stay and fight
          </Button>
        </div>
      </Overlay>
    );
  }

  return null;
}
