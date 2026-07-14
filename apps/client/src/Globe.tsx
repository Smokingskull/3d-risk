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
const CRACK_DARK = 0.72; // how much crack lines darken the tint
const CRACK_ROUGH = 0.2; // extra roughness in the cracks
const CRACK_BUMP = 0.5; // relief strength — perturbs the normal so cracks catch light

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

// Generate a tileable dried-earth crack pattern (Worley F2−F1 cell edges): thin
// dark lines at cell borders, light inside. Synchronous DataTexture — no asset
// download, renders immediately, and reads as parched earth when tiled.
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
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cells;
      const v = (y / size) * cells;
      const cx = Math.floor(u);
      const cy = Math.floor(v);
      let f1 = 1e9;
      let f2 = 1e9;
      let owner = 0;
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
            owner = gy * cells + gx;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
      const edge = f2 - f1; // ~0 on a cell border (crack), larger inside
      let c = Math.min(1, edge / 0.14); // wider → thicker cracks that survive minification
      c = c * c * (3 - 2 * c); // smoothstep
      // Each plate has its own shade; borders drop toward dark. Together the
      // surface reads as a patchwork of parched plates split by cracks — so the
      // whole territory is textured, not just the deepest crack lines.
      const b = cb[owner] * (0.16 + 0.84 * c);
      const val = Math.round(Math.max(0, Math.min(1, b)) * 255);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = val;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8; // keep crack lines crisp when the surface is minified
  tex.needsUpdate = true;
  return tex;
}
import { getBoard, type GameState, type TerritoryId } from "@risk3d/engine";
import { NEUTRAL_COLOR } from "./players.js";

const MODEL_URL = "/assets/models/transparent_country_globe_gameboard.glb";
const TARGET_RADIUS = 1.2;
const INERT_COLOR = "#646d7c"; // neutral inactive land (only if a mesh fails to resolve)

// GLTFLoader sanitises node names (spaces -> underscores); map them back to
// canonical country ids using the full world list (covers both board modes).
const CANONICAL_BY_SANITIZED = new Map(
  Object.keys(getBoard("world").territories).map((id) => [THREE.PropertyBinding.sanitizeNodeName(id), id]),
);

// Scratch vectors reused each frame (single globe instance, single render thread).
const _labelDir = new THREE.Vector3();
const _camDir = new THREE.Vector3();

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

export function Globe({ game, selectedFrom, validTargets, selection, highlightContinent, focus, onHover, onPick }: GlobeProps) {
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
            "float triCrack(){",
            "  vec3 n = normalize(abs(vObjNrm));",
            "  n /= (n.x + n.y + n.z);",
            "  vec3 p = vObjPos * uScale;",
            "  float x = texture2D(uCrack, p.yz).r;",
            "  float y = texture2D(uCrack, p.zx).r;",
            "  float z = texture2D(uCrack, p.xy).r;",
            "  return x * n.x + y * n.y + z * n.z;",
            "}",
          ].join("\n"),
        )
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + (1.0 - triCrack()) * uRough, 0.0, 1.0);",
        )
        .replace(
          "#include <color_fragment>",
          "#include <color_fragment>\n  diffuseColor.rgb *= mix(1.0 - uDark, 1.0, triCrack());\n  if (!gl_FrontFacing) diffuseColor.rgb *= 0.4;",
        )
        // Derivative-based bump: perturb the normal from the crack height using
        // screen-space gradients (no UVs/tangents needed). Cracks become grooves
        // that catch light — the raised-plate relief.
        .replace(
          "#include <normal_fragment_maps>",
          [
            "#include <normal_fragment_maps>",
            "{",
            "  float _h = triCrack();",
            "  vec2 _dH = vec2(dFdx(_h), dFdy(_h)) * uBump;",
            "  vec3 _sp = -vViewPosition;",
            "  vec3 _sx = dFdx(_sp);",
            "  vec3 _sy = dFdy(_sp);",
            "  vec3 _R1 = cross(_sy, normal);",
            "  vec3 _R2 = cross(normal, _sx);",
            "  float _fd = gl_FrontFacing ? 1.0 : -1.0;",
            "  float _det = dot(_sx, _R1) * _fd;",
            "  vec3 _grad = sign(_det) * (_dH.x * _R1 + _dH.y * _R2);",
            "  normal = normalize(abs(_det) * normal - _grad);",
            "}",
          ].join("\n"),
        );
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

  const refs = useRef({ game, selectedFrom, validTargets, selection, ownerColor, playable, highlightContinent, hovered: null as string | null });
  refs.current.game = game;
  refs.current.selectedFrom = selectedFrom;
  refs.current.validTargets = validTargets;
  refs.current.selection = selection;
  refs.current.ownerColor = ownerColor;
  refs.current.playable = playable;
  refs.current.highlightContinent = highlightContinent;

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

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const territory = e.object.userData.territory as string | undefined;
    setHovered(territory && playable.has(territory) ? territory : null);
  };
  const handleOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(null);
  };
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const territory = e.object.userData.territory as string | undefined;
    if (territory && playable.has(territory)) onPick(territory);
  };

  useEffect(() => () => setHovered(null), []);

  // Rotate the globe so a requested territory faces front (rotation only).
  const focusDir = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    if (!focus) return;
    const c = centroids.get(focus.id);
    if (c) focusDir.current = c.clone().normalize();
  }, [focus, centroids]);

  useFrame(() => {
    if (import.meta.env.DEV) (window as unknown as { __camDir: number[] }).__camDir = camera.position.clone().normalize().toArray();
    const target = focusDir.current;
    if (!target) return;
    if (controls) controls.enabled = false;
    const radius = camera.position.length();
    const cur = camera.position.clone().normalize();
    if (cur.angleTo(target) < 0.02) {
      focusDir.current = null;
      if (controls) {
        controls.enabled = true;
        controls.update?.();
      }
      return;
    }
    camera.position.copy(cur.lerp(target, 0.15).normalize().multiplyScalar(radius));
    camera.lookAt(0, 0, 0);
  });

  const labels = useMemo<LabelEntry[]>(() => {
    const out: LabelEntry[] = [];
    for (const id of Object.keys(game.territories)) {
      const pos = centroids.get(id);
      if (!pos) continue;
      out.push({ id, position: [pos.x, pos.y, pos.z], text: String(game.territories[id].armies) });
    }
    return out;
  }, [game.territories, centroids]);

  return (
    <group>
      <primitive object={group} onPointerMove={handleMove} onPointerOut={handleOut} onClick={handleClick} />
      <Labels entries={labels} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
