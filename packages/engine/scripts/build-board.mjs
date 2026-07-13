// Builds a BoardDefinition from the country-globe GLB.
//
//  1. Land adjacency is derived from geometry: two countries are neighbours when
//     their border meshes share (near-)coincident vertices. Natural Earth admin-0
//     boundaries are topologically shared, so adjacent countries have identical
//     border vertices (verified: distance 0.0). We quantise vertices to a grid and
//     treat any two countries meeting in the same cell as adjacent.
//  2. Curated sea routes (world.searoutes.json) are merged in for water crossings.
//  3. Continents come from world.continents.json.
//  4. The result is validated (full coverage, symmetry, connectivity) and written
//     to src/data/world.board.json.
//
// Run with:  pnpm --filter @risk3d/engine build:board

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const DATA_DIR = resolve(HERE, "../src/data");
const GLB_PATH = join(REPO_ROOT, "transparent_country_globe_gameboard.glb");

// Decimal places to quantise vertex coords to when hashing. Adjacent borders share
// exact vertices, so 4 dp (~6e-4 on a unit sphere) groups them reliably.
const QUANT = 4;
// Adjacencies whose country centroids subtend more than this angle (radians) are
// flagged for human review — usually an overseas-territory quirk (e.g. French
// Guiana making France border Brazil).
const LONG_RANGE_ANGLE = 0.45;

function parseGlb(buf) {
  let off = 12; // skip magic, version, length
  const jsonLen = buf.readUInt32LE(off);
  off += 8; // length + type
  const json = JSON.parse(buf.subarray(off, off + jsonLen).toString("utf8"));
  off += jsonLen;
  const binLen = buf.readUInt32LE(off);
  off += 8;
  const bin = buf.subarray(off, off + binLen);
  return { json, bin };
}

function positionsFor(node, json, bin) {
  const mesh = json.meshes[node.mesh];
  const out = [];
  for (const prim of mesh.primitives) {
    const acc = json.accessors[prim.attributes.POSITION];
    const view = json.bufferViews[acc.bufferView];
    const stride = view.byteStride ?? 12;
    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    for (let i = 0; i < acc.count; i++) {
      const o = base + i * stride;
      out.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
    }
  }
  return out;
}

function centroid(pts) {
  const c = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length];
}

function angleBetween(a, b) {
  const na = Math.hypot(...a);
  const nb = Math.hypot(...b);
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

// --- load inputs -----------------------------------------------------------
const { json, bin } = parseGlb(readFileSync(GLB_PATH));
const countryNodes = json.nodes.filter((n) => n.name && n.mesh !== undefined);

const verts = new Map(); // name -> [[x,y,z], ...]
const centroids = new Map();
for (const node of countryNodes) {
  const pts = positionsFor(node, json, bin);
  verts.set(node.name, pts);
  centroids.set(node.name, centroid(pts));
}
const allCountries = [...verts.keys()].sort();

const continentData = JSON.parse(
  readFileSync(join(DATA_DIR, "world.continents.json"), "utf8"),
);
const seaData = JSON.parse(
  readFileSync(join(DATA_DIR, "world.searoutes.json"), "utf8"),
);

// --- land adjacency from shared vertices ------------------------------------
const cells = new Map(); // quantised-vertex key -> Set(country)
for (const [name, pts] of verts) {
  for (const [x, y, z] of pts) {
    const key = `${x.toFixed(QUANT)},${y.toFixed(QUANT)},${z.toFixed(QUANT)}`;
    let set = cells.get(key);
    if (!set) cells.set(key, (set = new Set()));
    set.add(name);
  }
}

const adj = new Map(allCountries.map((c) => [c, new Set()]));
const link = (a, b) => {
  if (a === b) return;
  adj.get(a).add(b);
  adj.get(b).add(a);
};

for (const set of cells.values()) {
  if (set.size < 2) continue;
  const members = [...set];
  for (let i = 0; i < members.length; i++)
    for (let j = i + 1; j < members.length; j++) link(members[i], members[j]);
}
const landEdgeCount = [...adj.values()].reduce((n, s) => n + s.size, 0) / 2;

// --- merge curated sea routes -----------------------------------------------
const problems = [];
let seaAdded = 0;
for (const [a, b] of seaData.routes) {
  if (!adj.has(a)) problems.push(`sea route references unknown country: "${a}"`);
  if (!adj.has(b)) problems.push(`sea route references unknown country: "${b}"`);
  if (adj.has(a) && adj.has(b)) {
    const before = adj.get(a).has(b);
    link(a, b);
    if (!before) seaAdded++;
  }
}

// --- continents -------------------------------------------------------------
const continents = {};
const territoryContinent = new Map();
for (const cont of continentData.continents) {
  continents[cont.id] = {
    id: cont.id,
    name: cont.name,
    bonus: cont.bonus,
    territories: cont.territories,
  };
  for (const t of cont.territories) {
    if (!adj.has(t)) problems.push(`continent "${cont.id}" lists unknown country: "${t}"`);
    if (territoryContinent.has(t))
      problems.push(`"${t}" assigned to multiple continents`);
    territoryContinent.set(t, cont.id);
  }
}
for (const c of allCountries)
  if (!territoryContinent.has(c)) problems.push(`country not assigned to any continent: "${c}"`);

// --- connectivity + isolation checks ----------------------------------------
const seen = new Set();
const stack = [allCountries[0]];
while (stack.length) {
  const c = stack.pop();
  if (seen.has(c)) continue;
  seen.add(c);
  for (const n of adj.get(c)) stack.push(n);
}
if (seen.size !== allCountries.length) {
  const missing = allCountries.filter((c) => !seen.has(c));
  problems.push(`graph not fully connected — ${missing.length} unreachable: ${missing.join(", ")}`);
}
const isolated = allCountries.filter((c) => adj.get(c).size === 0);
if (isolated.length) problems.push(`isolated territories (no neighbours): ${isolated.join(", ")}`);

// --- long-range adjacency report (informational) ----------------------------
const longRange = [];
for (const [a, set] of adj)
  for (const b of set)
    if (a < b) {
      const ang = angleBetween(centroids.get(a), centroids.get(b));
      if (ang > LONG_RANGE_ANGLE) longRange.push([a, b, ang]);
}
longRange.sort((x, y) => y[2] - x[2]);

// --- assemble board ---------------------------------------------------------
const territories = {};
for (const c of allCountries) {
  territories[c] = {
    id: c,
    continent: territoryContinent.get(c) ?? null,
    neighbours: [...adj.get(c)].sort(),
  };
}
const board = { mode: "world", continents, territories };

// --- report -----------------------------------------------------------------
console.log(`Countries (mesh nodes): ${allCountries.length}`);
console.log(`Land adjacencies (from geometry): ${landEdgeCount}`);
console.log(`Sea routes added: ${seaAdded}`);
console.log(`Total edges: ${[...adj.values()].reduce((n, s) => n + s.size, 0) / 2}`);
console.log("\nPer-continent territory counts:");
for (const cont of continentData.continents)
  console.log(`  ${cont.name.padEnd(16)} ${String(cont.territories.length).padStart(3)}  (bonus ${cont.bonus})`);

console.log(`\nLong-range adjacencies to eyeball (> ${LONG_RANGE_ANGLE} rad): ${longRange.length}`);
for (const [a, b, ang] of longRange.slice(0, 20))
  console.log(`  ${ang.toFixed(2)}  ${a} <-> ${b}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}

writeFileSync(join(DATA_DIR, "world.board.json"), JSON.stringify(board, null, 2) + "\n");
console.log(`\n✅ Validated & connected. Wrote src/data/world.board.json`);
