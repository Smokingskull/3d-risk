import { useState, type ReactNode } from "react";
import { Icon } from "./Icon.js";

interface Topic {
  id: string;
  label: string;
  body: ReactNode;
}

const TOPICS: Topic[] = [
  {
    id: "how",
    label: "How to Play",
    body: (
      <>
        <p className="lede">
          3D Risk is world domination on a globe. Every country is a territory — take them all, or be the
          last general standing, to win.
        </p>
        <h3>Your turn has three phases</h3>
        <ul>
          <li>
            <strong>Reinforce.</strong> You get armies equal to your territory count ÷ 3 (minimum 3), plus a
            bonus for every continent you fully control. Click your territories to place them.
          </li>
          <li>
            <strong>Attack.</strong> Pick one of your territories (2+ armies) and strike an adjacent enemy.
            The attacker rolls up to three dice, the defender up to two; highest dice are compared and{" "}
            <em>ties go to the defender</em>. Reduce a territory to zero to capture it, then move armies in.
          </li>
          <li>
            <strong>Fortify.</strong> Once per turn, move armies between two connected territories you own,
            then end your turn.
          </li>
        </ul>
        <h3>Continents</h3>
        <p>Holding an entire continent grants bonus armies each Reinforce phase — the engine of a winning position.</p>
      </>
    ),
  },
  {
    id: "modes",
    label: "Game Modes",
    body: (
      <>
        <h3>Standard Game</h3>
        <p>Classic conquest — the winner is the last general left standing once every rival is eliminated.</p>
        <h3>Campaign</h3>
        <p>
          Turn on <strong>Campaign cards</strong> when starting a New Game. Every player (you and the CPUs) is
          then dealt a secret objective, and the first to complete theirs wins:
        </p>
        <ul>
          <li><strong>Country</strong> — capture an assigned territory and hold it for three consecutive turns.</li>
          <li><strong>Continent</strong> — control every territory of an assigned continent at the end of a turn.</li>
          <li><strong>Assassination</strong> — eliminate an assigned rival (by any means).</li>
        </ul>
        <p>You only ever see your own objective — open the Campaign card from the Game box. Eliminating everyone still wins too.</p>
        <h3>Scenarios</h3>
        <p>
          Drop into a pre-built situation instead of setting up a fresh game. Open{" "}
          <strong>Scenarios</strong> from the main menu and pick from the list — ranked by difficulty, from
          gentle learn-the-ropes setups up through historical campaigns (the Crusades, Rome, Napoleon, the
          World Wars…) to punishing challenges. The panel shows each one's difficulty, briefing and full
          roster — your side marked <strong>You</strong>, every rival with its CPU level — and each has its
          own victory objective. Each scenario plays as designed; press <strong>Play</strong> to start.
        </p>
      </>
    ),
  },
  {
    id: "cpu",
    label: "CPU Difficulty",
    body: (
      <>
        <p>Each CPU seat can be set to one of three levels:</p>
        <ul>
          <li><strong>Easy</strong> — attacks only with strong odds, doesn't fortify or chase continents; a gentle opponent.</li>
          <li><strong>Medium</strong> — trades cards eagerly, consolidates armies, and presses weak borders.</li>
          <li><strong>Hard</strong> — all of the above plus continent-aware planning: it builds toward bonuses and picks its fights well.</li>
        </ul>
        <p>In a Campaign, every CPU also actively pursues its own secret objective.</p>
      </>
    ),
  },
  {
    id: "cards",
    label: "Cards & Sets",
    body: (
      <>
        <p>Capture at least one territory during your turn and you earn one card. Each card shows a symbol:</p>
        <ul>
          <li><strong>Infantry</strong>, <strong>Cavalry</strong>, <strong>Artillery</strong> or <strong>Wild</strong>.</li>
        </ul>
        <h3>Trading a set</h3>
        <p>
          A set is three cards that are <strong>all the same symbol</strong>, <strong>one of each</strong>{" "}
          (infantry + cavalry + artillery), or <strong>any three including a Wild</strong>. Open the Cards
          panel during Reinforce, <strong>pick the three cards yourself</strong> and trade them for bonus
          armies — the payout escalates each time any set is cashed in over the game (4, 6, 8, 10, 12, 15,
          then +5 each).
        </p>
        <p>
          If the set pictures a country you own, <strong>place +2 extra armies on it</strong> — and when more
          than one of the three is yours, you choose which country gets them.
        </p>
        <p>Hold five or more cards and you must trade before placing. Eliminate a player and you seize their whole hand.</p>
      </>
    ),
  },
  {
    id: "action-cards",
    label: "Action Cards",
    body: (
      <>
        <p>
          An optional mode — set <strong>Action cards</strong> to <strong>Yes</strong> when starting a game.
          Each player is dealt <strong>2 secret one-shot cards</strong> at the start — a finite resource,
          hidden from everyone else. Open the
          <strong> Action cards</strong> button in the Players panel to see your hand; you play them through
          the game itself, not from that screen.
        </p>
        <ul>
          <li><strong>Troop Transport</strong> — in Fortify, move armies between <em>any</em> two of your territories, connected or not.</li>
          <li><strong>Air Strike</strong> — before an attack, destroy ~20% of the defending army. Nullified if they hold Anti-Aircraft.</li>
          <li><strong>Anti-Aircraft</strong> — passive: automatically cancels an Air Strike played against you.</li>
          <li><strong>Misinformation</strong> — in Reinforce, show enemies a fake army count on one territory (you see both). Each enemy learns the truth only when they attack it.</li>
          <li><strong>Minefield</strong> — when an enemy conquers one of your territories, destroy 2 of the armies they move in (1 if they move fewer than 4).</li>
          <li><strong>Tactical Retreat</strong> — while defending, between rolls, pull all your armies out to an adjacent territory instead of losing them (the attacker then takes the emptied land).</li>
        </ul>
        <p>Once played, a card is gone — spend them wisely.</p>
      </>
    ),
  },
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(TOPICS[0].id);
  const topic = TOPICS.find((t) => t.id === active) ?? TOPICS[0];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card help-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h2>Help</h2>
          <button className="tut-x" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="help-body">
          <nav className="help-nav">
            {TOPICS.map((t) => (
              <button key={t.id} className={t.id === active ? "sel" : ""} onClick={() => setActive(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="help-content" key={topic.id}>
            {topic.body}
          </div>
        </div>
      </div>
    </div>
  );
}
