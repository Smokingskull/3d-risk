export function RulesPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="rules">
      <div className="rules-card">
        <div className="rules-top">
          <h1>How to play</h1>
          <button onClick={onBack}>← Back</button>
        </div>

        <p className="lede">
          3D Risk is world domination on a globe. Every country is a territory; take them all — or be the
          last general standing — to win.
        </p>

        <h2>Setup</h2>
        <p>
          Every territory is dealt out and seeded with armies automatically, then play begins. Choose the{" "}
          <strong>World</strong> board (all 177 countries, six real continents) or <strong>Classic</strong>{" "}
          (42 major countries in the traditional six regions). Each seat is a human or a CPU general
          (Easy, Medium or Hard).
        </p>

        <h2>Your turn has three phases</h2>
        <ol className="phases">
          <li>
            <strong>Reinforce.</strong> You receive armies equal to your territory count ÷ 3 (minimum 3),
            plus a bonus for every continent you fully control. Click your territories to place them.
          </li>
          <li>
            <strong>Attack.</strong> Pick one of your territories (2+ armies) and strike an adjacent enemy.
            The attacker rolls up to three dice, the defender up to two; highest dice are compared and{" "}
            <em>ties go to the defender</em>. Reduce a territory to zero armies to capture it, then move
            your armies in. Attack as often as you like.
          </li>
          <li>
            <strong>Fortify.</strong> Once per turn you may move armies between two connected territories
            you own, then end your turn.
          </li>
        </ol>

        <h2>Continents</h2>
        <p>
          Holding every territory in a continent grants extra armies each Reinforce phase — the engine of a
          winning position. Bigger, harder-to-defend continents (Asia, Africa) pay the most.
        </p>

        <h2>Cards</h2>
        <p>
          Capture at least one territory in a turn and you earn a card (infantry, cavalry, artillery, or a
          wild). Three of a kind, one of each, or any set including a wild can be traded during Reinforce
          for bonus armies — and the payout grows the more sets are cashed in over the game. Hold five or
          more and you must trade before you can place. Eliminate a player and you seize their hand.
        </p>

        <h2>Winning</h2>
        <p>Eliminate every rival — take their last territory — and the world is yours.</p>

        <h2>Controls</h2>
        <ul className="controls">
          <li>Drag to rotate the globe · scroll to zoom.</li>
          <li>Hover a country to read its name and army count.</li>
          <li>Reinforce: click a territory to deploy. Attack/Fortify: click a source, then a highlighted target.</li>
          <li>Use the on-screen buttons to trade cards, end the attack phase, occupy, and end your turn.</li>
          <li>New to the game? Leave <strong>Tutorial tips</strong> on — stage-by-stage prompts you can dismiss or toggle off anytime.</li>
        </ul>

        <button className="start" onClick={onBack}>
          Back to menu
        </button>
      </div>
    </div>
  );
}
