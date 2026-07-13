/**
 * Exact RISK combat probabilities. The AI decides using these odds rather than
 * peeking at the state's deterministic dice, so it never cheats.
 */

interface Outcome {
  aLoss: number;
  dLoss: number;
  prob: number;
}

function enumerateRolls(n: number): number[][] {
  if (n === 0) return [[]];
  const rest = enumerateRolls(n - 1);
  const out: number[][] = [];
  for (let f = 1; f <= 6; f++) for (const r of rest) out.push([f, ...r]);
  return out;
}

const outcomeCache = new Map<number, Outcome[]>();

/** Distribution of (attacker loss, defender loss) for a single battle. */
function battleOutcomes(aDice: number, dDice: number): Outcome[] {
  const key = aDice * 10 + dDice;
  const cached = outcomeCache.get(key);
  if (cached) return cached;

  const tally = new Map<string, number>();
  const aRolls = enumerateRolls(aDice);
  const dRolls = enumerateRolls(dDice);
  const compares = Math.min(aDice, dDice);
  for (const a of aRolls) {
    const as = [...a].sort((x, y) => y - x);
    for (const d of dRolls) {
      const ds = [...d].sort((x, y) => y - x);
      let aLoss = 0;
      let dLoss = 0;
      for (let i = 0; i < compares; i++) {
        if (as[i] > ds[i]) dLoss++;
        else aLoss++; // ties favour the defender
      }
      const k = `${aLoss},${dLoss}`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
  }
  const total = aRolls.length * dRolls.length;
  const outcomes: Outcome[] = [...tally].map(([k, count]) => {
    const [aLoss, dLoss] = k.split(",").map(Number);
    return { aLoss, dLoss, prob: count / total };
  });
  outcomeCache.set(key, outcomes);
  return outcomes;
}

const conquestCache = new Map<string, number>();

/**
 * Probability the attacker fully conquers the territory, given the army counts
 * in the attacking (`attackers`) and defending (`defenders`) territories, playing
 * battles until the defender is wiped or the attacker can no longer attack.
 */
export function conquestProbability(attackers: number, defenders: number): number {
  if (defenders <= 0) return 1;
  if (attackers < 2) return 0; // need armies-1 ≥ 1 to roll a die
  const key = `${attackers},${defenders}`;
  const cached = conquestCache.get(key);
  if (cached !== undefined) return cached;

  const aDice = Math.min(3, attackers - 1);
  const dDice = Math.min(2, defenders);
  let p = 0;
  for (const o of battleOutcomes(aDice, dDice))
    p += o.prob * conquestProbability(attackers - o.aLoss, defenders - o.dLoss);

  conquestCache.set(key, p);
  return p;
}
