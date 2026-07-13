// Builds the Classic BoardDefinition from hand-curated data.
//
// Unlike the World board, Classic adjacency is authored (classic.adjacency.json),
// not derived from geometry — it deliberately reproduces the original RISK board's
// choke points. This script validates that every territory is a real GLB mesh, is
// placed in exactly one continent, and that the authored graph is symmetric and
// fully connected, then writes src/data/classic.board.json.
//
// Run with:  pnpm --filter @risk3d/engine build:classic

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const DATA_DIR = resolve(HERE, "../src/data");
const GLB_PATH = join(REPO_ROOT, "transparent_country_globe_gameboard.glb");

// Valid territory names = the named mesh nodes in the GLB.
function glbCountryNames() {
  const buf = readFileSync(GLB_PATH);
  let off = 12;
  const jsonLen = buf.readUInt32LE(off);
  off += 8;
  const json = JSON.parse(buf.subarray(off, off + jsonLen).toString("utf8"));
  return new Set(json.nodes.filter((n) => n.name && n.mesh !== undefined).map((n) => n.name));
}

const validNames = glbCountryNames();
const continentData = JSON.parse(readFileSync(join(DATA_DIR, "classic.continents.json"), "utf8"));
const adjData = JSON.parse(readFileSync(join(DATA_DIR, "classic.adjacency.json"), "utf8"));

const problems = [];

// --- continents + territory set ---------------------------------------------
const continents = {};
const territoryContinent = new Map();
const territorySet = new Set();
for (const cont of continentData.continents) {
  continents[cont.id] = { id: cont.id, name: cont.name, bonus: cont.bonus, territories: cont.territories };
  for (const t of cont.territories) {
    if (!validNames.has(t)) problems.push(`continent "${cont.id}" lists non-mesh country: "${t}"`);
    if (territoryContinent.has(t)) problems.push(`"${t}" assigned to multiple continents`);
    territoryContinent.set(t, cont.id);
    territorySet.add(t);
  }
}

// --- adjacency from authored edges ------------------------------------------
const adj = new Map([...territorySet].map((t) => [t, new Set()]));
for (const [a, b] of adjData.edges) {
  if (!territorySet.has(a)) problems.push(`edge references non-classic territory: "${a}"`);
  if (!territorySet.has(b)) problems.push(`edge references non-classic territory: "${b}"`);
  if (a === b) problems.push(`self-edge: "${a}"`);
  if (territorySet.has(a) && territorySet.has(b) && a !== b) {
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
}

// --- connectivity + isolation -----------------------------------------------
const all = [...territorySet].sort();
const isolated = all.filter((t) => adj.get(t).size === 0);
if (isolated.length) problems.push(`isolated territories: ${isolated.join(", ")}`);

const seen = new Set();
const stack = [all[0]];
while (stack.length) {
  const c = stack.pop();
  if (seen.has(c)) continue;
  seen.add(c);
  for (const n of adj.get(c)) stack.push(n);
}
if (seen.size !== all.length)
  problems.push(`graph not fully connected — unreachable: ${all.filter((t) => !seen.has(t)).join(", ")}`);

// --- assemble ----------------------------------------------------------------
const territories = {};
for (const t of all)
  territories[t] = { id: t, continent: territoryContinent.get(t), neighbours: [...adj.get(t)].sort() };
const board = { mode: "classic", continents, territories };

// --- report ------------------------------------------------------------------
console.log(`Classic territories: ${all.length}`);
console.log(`Edges: ${adjData.edges.length}`);
console.log("\nPer-continent counts:");
for (const cont of continentData.continents)
  console.log(`  ${cont.name.padEnd(16)} ${String(cont.territories.length).padStart(2)}  (bonus ${cont.bonus})`);
console.log("\nDegree per territory:");
for (const t of all) console.log(`  ${t.padEnd(26)} ${adj.get(t).size}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}

writeFileSync(join(DATA_DIR, "classic.board.json"), JSON.stringify(board, null, 2) + "\n");
console.log(`\n✅ Validated & connected. Wrote src/data/classic.board.json`);
