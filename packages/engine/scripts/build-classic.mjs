// Builds the Classic (classic-style, region-based) BoardDefinition.
//
// Classic territories are REGIONS that group real countries (classic.regions.json),
// so the whole globe is in play — no inert areas. Adjacency is hand-authored
// (classic.adjacency.json) for classic choke points. This validates that the
// regions partition ALL 177 country meshes exactly once, that adjacency is
// symmetric and fully connected, then writes src/data/classic.board.json with a
// `members` list per territory.
//
// Run with:  pnpm --filter @risk3d/engine build:classic

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const DATA_DIR = resolve(HERE, "../src/data");
const GLB_PATH = join(REPO_ROOT, "transparent_country_globe_gameboard.glb");

function glbCountryNames() {
  const buf = readFileSync(GLB_PATH);
  let off = 12;
  const jsonLen = buf.readUInt32LE(off);
  off += 8;
  const json = JSON.parse(buf.subarray(off, off + jsonLen).toString("utf8"));
  return new Set(json.nodes.filter((n) => n.name && n.mesh !== undefined).map((n) => n.name));
}

const allCountries = glbCountryNames();
const regionData = JSON.parse(readFileSync(join(DATA_DIR, "classic.regions.json"), "utf8"));
const adjData = JSON.parse(readFileSync(join(DATA_DIR, "classic.adjacency.json"), "utf8"));

const problems = [];

// --- continents + regions + membership -------------------------------------
const continents = {};
const territories = {};
const regionContinent = new Map();
const countryToRegion = new Map();

for (const cont of regionData.continents) {
  continents[cont.id] = { id: cont.id, name: cont.name, bonus: cont.bonus, territories: cont.regions.map((r) => r.id) };
  for (const region of cont.regions) {
    if (territories[region.id]) problems.push(`duplicate region id: "${region.id}"`);
    territories[region.id] = { id: region.id, continent: cont.id, neighbours: [], members: region.members };
    regionContinent.set(region.id, cont.id);
    for (const c of region.members) {
      if (!allCountries.has(c)) problems.push(`region "${region.id}" lists non-mesh country: "${c}"`);
      if (countryToRegion.has(c)) problems.push(`country "${c}" assigned to both "${countryToRegion.get(c)}" and "${region.id}"`);
      countryToRegion.set(c, region.id);
    }
  }
}

// Every country must be assigned to exactly one region (no inert areas).
for (const c of allCountries) if (!countryToRegion.has(c)) problems.push(`country not assigned to any region: "${c}"`);

// --- adjacency --------------------------------------------------------------
const adj = new Map(Object.keys(territories).map((t) => [t, new Set()]));
for (const [a, b] of adjData.edges) {
  if (!adj.has(a)) problems.push(`edge references unknown region: "${a}"`);
  if (!adj.has(b)) problems.push(`edge references unknown region: "${b}"`);
  if (a === b) problems.push(`self-edge: "${a}"`);
  if (adj.has(a) && adj.has(b) && a !== b) {
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
}
for (const [id, set] of adj) territories[id].neighbours = [...set].sort();

// --- connectivity + isolation -----------------------------------------------
const all = Object.keys(territories).sort();
const isolated = all.filter((t) => adj.get(t).size === 0);
if (isolated.length) problems.push(`isolated regions: ${isolated.join(", ")}`);

const seen = new Set();
const stack = [all[0]];
while (stack.length) {
  const c = stack.pop();
  if (seen.has(c)) continue;
  seen.add(c);
  for (const n of adj.get(c)) stack.push(n);
}
if (seen.size !== all.length) problems.push(`graph not fully connected — unreachable: ${all.filter((t) => !seen.has(t)).join(", ")}`);

// --- report -----------------------------------------------------------------
console.log(`Regions: ${all.length}   Countries covered: ${countryToRegion.size} / ${allCountries.size}`);
console.log(`Edges: ${adjData.edges.length}`);
console.log("\nPer-continent regions (bonus):");
for (const cont of regionData.continents)
  console.log(`  ${cont.name.padEnd(16)} ${String(cont.regions.length).padStart(2)}  (bonus ${cont.bonus})`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}

const board = { mode: "classic", continents, territories };
writeFileSync(join(DATA_DIR, "classic.board.json"), JSON.stringify(board, null, 2) + "\n");
console.log(`\n✅ Validated, fully connected, all 177 countries covered. Wrote src/data/classic.board.json`);
