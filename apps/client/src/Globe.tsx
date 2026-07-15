import { useEffect, useMemo, useRef } from "react";
import { Text, useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

const BORDER_COLOR = "#0a0e18"; // permanent thin territory border (buttonised look)
const BORDER_WIDTH = 1.4;
const PICK_WIDTH = 4.5;

// The model's north pole is on +Z; rotate it to +Y so the globe shows north-up
// (standard orientation) rather than pole-on. Applied to meshes, labels, and foci.
const POLE_FIX = new THREE.Euler(-Math.PI / 2, 0, 0);

// Cracked-earth surface via object-space triplanar projection. The country
// meshes have no UVs, so we sample a tiling crack texture from the three axis
// planes and blend by the surface normal — the detail sticks to the globe as it
// turns. Crack lines darken the per-owner tint (and roughen it a touch) so each
// territory reads as parched earth in its player colour. Back-facing fragments
// are dimmed so the far side of the transparent globe reads as "the back".
const CRACK_REPEATS = 9; // crack texture tiles across the globe diameter (tune)
const CRACK_DARK = 0.55; // how much crack lines darken the tint (0 = bevel only)
const CRACK_ROUGH = 0.2; // extra roughness in the cracks
const CRACK_BUMP = 1.7; // relief strength — scales the baked normal so cracks catch light

// Small deterministic RNG so the generated crack pattern is stable across runs.
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate a tileable dried-earth crack texture from Worley cells. One packed
// texture so colour and relief can never drift apart: RGB = surface normal baked
// from a smooth height field (wide, sloped crack walls → a real bevel), A = the
// diffuse darkening factor (per-plate shade × groove). Synchronous DataTexture.
function makeCrackTexture(size = 512, cells = 14, seed = 20260714): THREE.DataTexture {
  const rnd = mulberry32(seed);
  const fx = new Float32Array(cells * cells);
  const fy = new Float32Array(cells * cells);
  const cb = new Float32Array(cells * cells); // per-cell (plate) base brightness
  for (let i = 0; i < cells * cells; i++) {
    fx[i] = rnd();
    fy[i] = rnd();
    cb[i] = 0.5 + rnd() * 0.5; // 0.5..1.0 so plates differ in shade
  }

  // Pass 1: groove height H (1 on the plate, sloping down to 0 in the crack) and
  // which cell owns each texel. Wide smoothstep → gently sloped walls (the bevel).
  const H = new Float32Array(size * size);
  const owner = new Int32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cells;
      const v = (y / size) * cells;
      const cx = Math.floor(u);
      const cy = Math.floor(v);
      let f1 = 1e9;
      let f2 = 1e9;
      let own = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = (((cx + ox) % cells) + cells) % cells;
          const gy = (((cy + oy) % cells) + cells) % cells;
          const dx = u - (cx + ox + fx[gy * cells + gx]);
          const dy = v - (cy + oy + fy[gy * cells + gx]);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            own = gy * cells + gx;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
      let h = Math.min(1, (f2 - f1) / 0.45); // wide → sloped bevel walls
      h = h * h * (3 - 2 * h);
      const idx = y * size + x;
      H[idx] = h;
      owner[idx] = own;
    }
  }

  // Pass 2: bake tangent-space normals from H (wrapping central differences) into
  // RGB, and the diffuse darkening (plate shade × groove) into A.
  const data = new Uint8Array(size * size * 4);
  const K = 6.0; // slope gain — how steep the baked walls are
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const yd = (y - 1 + size) % size;
      const yu = (y + 1) % size;
      const dhx = (H[y * size + xr] - H[y * size + xl]) * 0.5 * K;
      const dhy = (H[yu * size + x] - H[yd * size + x]) * 0.5 * K;
      let nx = -dhx;
      let ny = -dhy;
      let nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const idx = y * size + x;
      const cf = cb[owner[idx]] * (0.2 + 0.8 * H[idx]);
      const i = idx * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = Math.round(Math.max(0, Math.min(1, cf)) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
import { getBoard, perceivedArmies, type GameState, type PlayerId, type TerritoryId } from "@risk3d/engine";
import { NEUTRAL_COLOR } from "./players.js";

const MODEL_URL = "/assets/models/risk_42_territory_globe.glb";
const TARGET_RADIUS = 1.2;
const INERT_COLOR = "#646d7c"; // neutral inactive land (only if a mesh fails to resolve)

// GLTFLoader sanitises node names (spaces -> underscores); map them back to the
// board's territory ids. The model has one mesh per territory named after it.
const CANONICAL_BY_SANITIZED = new Map(
  Object.keys(getBoard("classic").territories).map((id) => [THREE.PropertyBinding.sanitizeNodeName(id), id]),
);

// Scratch vectors reused each frame (single globe instance, single render thread).
const _labelDir = new THREE.Vector3();
const _camDir = new THREE.Vector3();

// Seconds for a rotate-to-territory glide (smooth, eased — no jump).
const FOCUS_DURATION = 0.6;
// Only allow selecting/hovering territories on the near (camera-facing)
// hemisphere; below this dot the point is round the back.
const NEAR_SIDE_MIN = 0.12;

/** Spherical interpolation between two unit direction vectors. */
function slerpDir(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const d = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const theta = Math.acos(d);
  if (theta < 1e-4) return a.clone();
  const s = Math.sin(theta);
  return a
    .clone()
    .multiplyScalar(Math.sin((1 - t) * theta) / s)
    .add(b.clone().multiplyScalar(Math.sin(t * theta) / s));
}

/** Requested camera focus: rotate so this territory faces front (rotation only). */
export interface FocusRequest {
  id: TerritoryId;
  n: number;
}

interface GlobeProps {
  game: GameState;
  selectedFrom: TerritoryId | null;
  validTargets: Set<TerritoryId>;
  selection: TerritoryId | null;
  highlightContinent: string | null;
  focus: FocusRequest | null;
  /** Selection mode: picking/hover enabled. In rotate mode the globe only spins. */
  selectable: boolean;
  /** Whose perspective army labels are shown from (Misinformation fog). */
  viewerId: PlayerId | null;
  onHover: (territory: TerritoryId | null) => void;
  onPick: (territory: TerritoryId) => void;
}

interface LabelEntry {
  id: string;
  position: [number, number, number];
  text: string;
}

/** Army-count labels that always face the camera; far-side ones are hidden. */
function Labels({ entries }: { entries: LabelEntry[] }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    if (!group.current) return;
    _camDir.copy(camera.position).normalize();
    for (const child of group.current.children) {
      child.quaternion.copy(camera.quaternion);
      child.visible = _labelDir.copy(child.position).normalize().dot(_camDir) > 0.12;
    }
  });
  return (
    <group ref={group}>
      {entries.map((e) => (
        <Text key={e.id} font="/assets/fonts/Oswald-SemiBold.ttf" position={e.position} fontSize={0.04} color="#ffffff" anchorX="center" anchorY="middle" outlineWidth={0.005} outlineColor="#000000">
          {e.text}
        </Text>
      ))}
    </group>
  );
}

export function Globe({ game, selectedFrom, validTargets, selection, highlightContinent, focus, selectable, viewerId, onHover, onPick }: GlobeProps) {
  const { scene } = useGLTF(MODEL_URL);
  const crackTex = useMemo(() => makeCrackTexture(), []);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean; update?: () => void } | null;

  // Map each country to the territory that owns it (a region for Classic, the
  // country itself for World, where territories carry no `members`).
  const board = game.board;
  const countryToTerritory = useMemo(() => {
    const m = new Map<string, TerritoryId>();
    for (const t of Object.values(board.territories)) for (const c of t.members ?? [t.id]) m.set(c, t.id);
    return m;
  }, [board]);

  // Prepare the scene once per board: per-territory material grouping + centroids.
  const { group, meshesByTerritory, outlinesByTerritory, outlineMaterials, centroids } = useMemo(() => {
    const root = scene.clone(true);

    // Shared crack shader. One function reference for every material, so three
    // dedups to a single compiled program while still injecting each material's
    // uniforms. uScale is filled in once the object-space radius is known.
    const scaleHolder = { value: 0.5 };
    const applyCrack = (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uCrack = { value: crackTex };
      shader.uniforms.uScale = { value: scaleHolder.value };
      shader.uniforms.uDark = { value: CRACK_DARK };
      shader.uniforms.uRough = { value: CRACK_ROUGH };
      shader.uniforms.uBump = { value: CRACK_BUMP };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNrm;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vObjPos = position;\n  vObjNrm = normal;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          [
            "#include <common>",
            "varying vec3 vObjPos;",
            "varying vec3 vObjNrm;",
            "uniform sampler2D uCrack;",
            "uniform float uScale;",
            "uniform float uDark;",
            "uniform float uRough;",
            "uniform float uBump;",
            "uniform mat3 normalMatrix;",
            // Object-space triplanar blend weights, sharpened so each face picks
            // mostly one projection plane.
            "vec3 triBlend(){ vec3 b = pow(abs(normalize(vObjNrm)), vec3(4.0)); return b / max(dot(b, vec3(1.0)), 1e-4); }",
            // Diffuse darkening factor (packed in the texture's alpha).
            "float crackColor(){ vec3 b = triBlend(); vec3 p = vObjPos * uScale;",
            "  return texture2D(uCrack, p.zy).a * b.x + texture2D(uCrack, p.xz).a * b.y + texture2D(uCrack, p.xy).a * b.z; }",
            // Triplanar normal mapping (whiteout blend) → object-space normal,
            // then into view space for lighting. RGB of the texture is the normal.
            "vec3 crackNormal(){",
            "  vec3 wn = normalize(vObjNrm); vec3 b = triBlend(); vec3 p = vObjPos * uScale;",
            "  vec3 nX = texture2D(uCrack, p.zy).xyz * 2.0 - 1.0;",
            "  vec3 nY = texture2D(uCrack, p.xz).xyz * 2.0 - 1.0;",
            "  vec3 nZ = texture2D(uCrack, p.xy).xyz * 2.0 - 1.0;",
            "  nX.xy *= uBump; nY.xy *= uBump; nZ.xy *= uBump;",
            "  nX = vec3(nX.xy + wn.zy, abs(nX.z) * wn.x);",
            "  nY = vec3(nY.xy + wn.xz, abs(nY.z) * wn.y);",
            "  nZ = vec3(nZ.xy + wn.xy, abs(nZ.z) * wn.z);",
            "  vec3 on = normalize(nX.zyx * b.x + nY.xzy * b.y + nZ.xyz * b.z);",
            "  return normalize(normalMatrix * on);",
            "}",
          ].join("\n"),
        )
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + (1.0 - crackColor()) * uRough, 0.0, 1.0);",
        )
        .replace(
          "#include <color_fragment>",
          "#include <color_fragment>\n  diffuseColor.rgb *= mix(1.0 - uDark, 1.0, crackColor());\n  if (!gl_FrontFacing) diffuseColor.rgb *= 0.4;",
        )
        // Real bevel: replace the geometric normal with the triplanar-sampled
        // baked normal (relief that catches light), respecting face direction.
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n  normal = crackNormal() * faceDirection;");
    };

    const byTerritory = new Map<string, THREE.Mesh[]>();
    const outlines = new Map<string, LineSegments2>();
    const outlineMaterials: LineMaterial[] = [];
    const sum = new Map<string, THREE.Vector3>();
    const counts = new Map<string, number>();
    const points: THREE.Vector3[] = [];

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const raw = mesh.name || mesh.parent?.name || "";
      if (!raw) return;
      const country = CANONICAL_BY_SANITIZED.get(raw) ?? raw;
      const territory = countryToTerritory.get(country) ?? country;

      if (!mesh.geometry.getAttribute("normal")) mesh.geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(NEUTRAL_COLOR), roughness: 0.85, side: THREE.DoubleSide });
      material.onBeforeCompile = applyCrack;
      mesh.material = material;
      mesh.userData.territory = territory;
      const list = byTerritory.get(territory) ?? [];
      list.push(mesh);
      byTerritory.set(territory, list);

      const pos = mesh.geometry.getAttribute("position");
      const acc = sum.get(territory) ?? new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        points.push(v);
        acc.add(v);
      }
      sum.set(territory, acc);
      counts.set(territory, (counts.get(territory) ?? 0) + pos.count);
    });

    // One fat-line outline per territory tracing its OUTER boundary only (member
    // country geometries merged + welded so shared internal borders drop out of
    // EdgesGeometry). Always visible as a thin dark border (buttonised look);
    // paint() thickens + brightens it when the territory is picked. Non-interactive.
    for (const [territory, meshes] of byTerritory) {
      const geos = meshes.map((m) => {
        const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", src.getAttribute("position").clone());
        return g;
      });
      const merged = mergeVertices(geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!);
      const lsg = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(merged, 30));
      const mat = new LineMaterial({ color: new THREE.Color(BORDER_COLOR).getHex(), linewidth: BORDER_WIDTH, transparent: true });
      const seg = new LineSegments2(lsg, mat);
      seg.scale.setScalar(1.004);
      seg.renderOrder = 3;
      seg.raycast = () => {};
      root.add(seg);
      outlines.set(territory, seg);
      outlineMaterials.push(mat);
    }

    const sphere = new THREE.Sphere().setFromPoints(points);
    scaleHolder.value = CRACK_REPEATS / (2 * (sphere.radius || 1));
    const s = TARGET_RADIUS / (sphere.radius || 1);
    const g = new THREE.Group();
    g.add(root);
    root.position.copy(sphere.center).multiplyScalar(-s).applyEuler(POLE_FIX);
    root.scale.setScalar(s);
    root.rotation.copy(POLE_FIX);

    // One surface anchor per territory (mean of its member vertices), plus one
    // per continent (for rotate-to-continent). Keyed distinctly (region names vs
    // continent ids), both looked up by focus.
    const centroidDirs = new Map<string, THREE.Vector3>();
    const toDir = (v: THREE.Vector3) => v.clone().sub(sphere.center).normalize().applyEuler(POLE_FIX).multiplyScalar(TARGET_RADIUS * 1.03);
    const contSum = new Map<string, THREE.Vector3>();
    const contCount = new Map<string, number>();
    for (const [territory, acc] of sum) {
      const n = counts.get(territory) || 1;
      centroidDirs.set(territory, toDir(acc.clone().multiplyScalar(1 / n)));
      const cont = board.territories[territory]?.continent;
      if (!cont) continue;
      let cs = contSum.get(cont);
      if (!cs) contSum.set(cont, (cs = new THREE.Vector3()));
      cs.add(acc);
      contCount.set(cont, (contCount.get(cont) ?? 0) + n);
    }
    for (const [cont, acc] of contSum) centroidDirs.set(cont, toDir(acc.clone().multiplyScalar(1 / (contCount.get(cont) || 1))));
    return { group: g, meshesByTerritory: byTerritory, outlinesByTerritory: outlines, outlineMaterials, centroids: centroidDirs };
  }, [scene, countryToTerritory, board, crackTex]);

  // Fat lines need the viewport resolution for correct pixel width.
  const size = useThree((s) => s.size);
  useEffect(() => {
    for (const m of outlineMaterials) m.resolution.set(size.width, size.height);
  }, [size, outlineMaterials]);

  const ownerColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of game.players) m.set(p.id, p.color);
    return m;
  }, [game.players]);

  const playable = useMemo(() => new Set(Object.keys(board.territories)), [board]);

  const refs = useRef({ game, selectedFrom, validTargets, selection, ownerColor, playable, highlightContinent, selectable, hovered: null as string | null });
  refs.current.game = game;
  refs.current.selectedFrom = selectedFrom;
  refs.current.validTargets = validTargets;
  refs.current.selection = selection;
  refs.current.ownerColor = ownerColor;
  refs.current.playable = playable;
  refs.current.highlightContinent = highlightContinent;
  refs.current.selectable = selectable;

  const paint = (territory: string) => {
    const meshes = meshesByTerritory.get(territory);
    if (!meshes) return;
    const r = refs.current;
    const playableHere = r.playable.has(territory);
    const owner = playableHere ? r.game.territories[territory]?.owner : null;
    const base = !playableHere ? INERT_COLOR : owner ? (r.ownerColor.get(owner) ?? NEUTRAL_COLOR) : NEUTRAL_COLOR;

    // Highlighting a continent keeps members' true owner colours and dims
    // everything else hard, so real ownership stays visible (spotlight, not recolour).
    const hl = r.highlightContinent;
    const dimNonMember = !!hl && playableHere && r.game.board.territories[territory]?.continent !== hl;

    // A picked territory (attack source / open dialog) gets a bold, bright border.
    // Hover and attack targets use a soft fill instead. Every territory keeps its
    // permanent thin dark border (buttonised).
    const pickColor = r.selectedFrom === territory ? "#fff27a" : r.selection === territory ? "#38bdf8" : null;

    let emissive = "#000000";
    let intensity = 0;
    if (playableHere && !pickColor) {
      if (r.validTargets.has(territory)) [emissive, intensity] = ["#ff8844", 0.5];
      else if (r.hovered === territory) [emissive, intensity] = ["#ffffff", 0.3];
    }
    for (const mesh of meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(base);
      if (dimNonMember) mat.color.multiplyScalar(0.15);
      mat.emissive.set(emissive);
      mat.emissiveIntensity = intensity;
    }
    const seg = outlinesByTerritory.get(territory);
    if (seg) {
      const mat = seg.material as LineMaterial;
      mat.color.set(pickColor ?? BORDER_COLOR);
      mat.linewidth = pickColor ? PICK_WIDTH : BORDER_WIDTH;
    }
  };

  const paintAll = () => {
    for (const territory of meshesByTerritory.keys()) paint(territory);
  };
  useEffect(paintAll, [game, selectedFrom, validTargets, selection, ownerColor, playable, highlightContinent]);

  const setHovered = (territory: string | null) => {
    const prev = refs.current.hovered;
    if (prev === territory) return;
    refs.current.hovered = territory;
    if (prev) paint(prev);
    if (territory) paint(territory);
    onHover(territory);
  };

  // A hit is on the near hemisphere if its point faces the camera. Blocks
  // hovering/selecting territories round the back of the globe.
  const nearSide = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.point.clone().normalize().dot(_camDir.copy(camera.position).normalize()) > NEAR_SIDE_MIN;

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!refs.current.selectable || !nearSide(e)) {
      setHovered(null);
      return;
    }
    const territory = e.object.userData.territory as string | undefined;
    setHovered(territory && playable.has(territory) ? territory : null);
  };
  const handleOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(null);
  };
  // Track where the pointer went down so a drag (globe rotation) doesn't count as
  // a click. Selection fires on pointer-up only if the pointer barely moved.
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    downPos.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
  };
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!refs.current.selectable || !nearSide(e)) return; // rotate-lock / back of globe
    const d = downPos.current;
    if (d) {
      const dx = e.nativeEvent.clientX - d.x;
      const dy = e.nativeEvent.clientY - d.y;
      if (dx * dx + dy * dy > 36) return; // moved >6px → it was a drag, not a click
    }
    const territory = e.object.userData.territory as string | undefined;
    if (territory && playable.has(territory)) onPick(territory);
  };

  useEffect(() => () => setHovered(null), []);
  // Clear any hover highlight when leaving selection mode.
  useEffect(() => {
    if (!selectable) setHovered(null);
  }, [selectable]);

  // Rotate the globe so a requested territory faces front — a smooth, eased
  // glide (slerp over FOCUS_DURATION) rather than a per-frame lerp that jumps.
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number; radius: number } | null>(null);
  useEffect(() => {
    if (!focus) return;
    const c = centroids.get(focus.id);
    if (!c) return;
    anim.current = {
      from: camera.position.clone().normalize(),
      to: c.clone().normalize(),
      t: 0,
      radius: camera.position.length(),
    };
  }, [focus, centroids, camera]);

  useFrame((_, delta) => {
    if (import.meta.env.DEV) (window as unknown as { __camDir: number[] }).__camDir = camera.position.clone().normalize().toArray();
    const a = anim.current;
    if (!a) return;
    if (controls) controls.enabled = false; // don't fight the glide
    a.t = Math.min(1, a.t + delta / FOCUS_DURATION);
    const e = a.t * a.t * (3 - 2 * a.t); // smoothstep ease in/out
    camera.position.copy(slerpDir(a.from, a.to, e).multiplyScalar(a.radius));
    camera.lookAt(0, 0, 0);
    if (a.t >= 1) {
      anim.current = null;
      if (controls) {
        controls.enabled = true;
        controls.update?.();
      }
    }
  });

  const labels = useMemo<LabelEntry[]>(() => {
    const out: LabelEntry[] = [];
    for (const id of Object.keys(game.territories)) {
      const pos = centroids.get(id);
      if (!pos) continue;
      const t = game.territories[id];
      const mis = game.misinformation[id];
      // The owner of a bluffed territory sees both counts: real (fake). Everyone
      // else sees only what they perceive (the fake, until revealed).
      const text =
        viewerId && mis && t.owner === viewerId
          ? `${t.armies} (${mis.fake})`
          : String(viewerId ? perceivedArmies(game, viewerId, id) : t.armies);
      out.push({ id, position: [pos.x, pos.y, pos.z], text });
    }
    return out;
  }, [game, viewerId, centroids]);

  return (
    <group>
      <primitive object={group} onPointerDown={handleDown} onPointerMove={handleMove} onPointerOut={handleOut} onClick={handleClick} />
      <Labels entries={labels} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
