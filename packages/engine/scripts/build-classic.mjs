// Builds the Classic 42-territory BoardDefinition from the globe model's manifest.
//
// The board is the authentic classic-Risk layout: one gameplay territory per mesh
// in risk_42_territory_globe.glb. The manifest ships the full topology (continent
// per territory + symmetric adjacency), so this script just maps it into our
// BoardDefinition schema — attaching continent ids and the authentic continent
// bonuses — and validates (42 territories, symmetric adjacency, fully connected)
// before writing src/data/classic.board.json.
//
// Territory ids are the manifest display names (spaces); the globe reverse-maps
// GLTF-sanitised mesh names (underscores) back to these. Run with:
//   pnpm --filter @risk3d/engine build:classic

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const DATA_DIR = resolve(HERE, "../src/data");
const MANIFEST = resolve(REPO_ROOT, "apps/client/public/assets/models/risk_42_territory_globe_manifest.json");

// Continent display name (as in the manifest) -> our id + authentic Risk bonus.
const CONTINENTS = {
  "North America": { id: "north-america", bonus: 5 },
  "South America": { id: "south-america", bonus: 2 },
  Europe: { id: "europe", bonus: 5 },
  Africa: { id: "africa", bonus: 3 },
  Asia: { id: "asia", bonus: 7 },
  Australia: { id: "australia", bonus: 2 },
};

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const problems = [];

const continents = {};
for (const [name, { id, bonus }] of Object.entries(CONTINENTS))
  continents[id] = { id, name, bonus, territories: [] };

const territories = {};
const names = new Set(manifest.territories.map((t) => t.name));

for (const t of manifest.territories) {
  const cont = CONTINENTS[t.continent];
  if (!cont) {
    problems.push(`territory "${t.name}" has unknown continent "${t.continent}"`);
    continue;
  }
  if (territories[t.name]) problems.push(`duplicate territory: "${t.name}"`);
  territories[t.name] = { id: t.name, continent: cont.id, neighbours: [...t.adjacent].sort() };
  continents[cont.id].territories.push(t.name);
}

// --- validation: adjacency refs, symmetry, isolation, connectivity ----------
for (const t of manifest.territories)
  for (const n of t.adjacent) {
    if (!names.has(n)) problems.push(`"${t.name}" borders unknown territory "${n}"`);
    else {
      const back = manifest.territories.find((x) => x.name === n);
      if (back && !back.adjacent.includes(t.name)) problems.push(`asymmetric border: "${t.name}"->"${n}"`);
    }
  }

const adj = new Map(Object.keys(territories).map((t) => [t, new Set(territories[t].neighbours)]));
const all = Object.keys(territories).sort();
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

// --- report -----------------------------------------------------------------
const edges = all.reduce((s, t) => s + adj.get(t).size, 0) / 2;
console.log(`Territories: ${all.length}   Edges: ${edges}`);
console.log("\nPer-continent territories (bonus):");
for (const c of Object.values(continents))
  console.log(`  ${c.name.padEnd(16)} ${String(c.territories.length).padStart(2)}  (bonus ${c.bonus})`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}

const board = { mode: "classic", continents, territories };
writeFileSync(resolve(DATA_DIR, "classic.board.json"), JSON.stringify(board, null, 2) + "\n");
console.log(`\n✅ Validated, fully connected. Wrote src/data/classic.board.json`);
