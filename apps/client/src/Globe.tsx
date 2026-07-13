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
import { getBoard, type GameState, type TerritoryId } from "@risk3d/engine";
import { NEUTRAL_COLOR } from "./players.js";

const MODEL_URL = "/transparent_country_globe_gameboard.glb";
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
        <Text key={e.id} font="/fonts/Oswald-SemiBold.ttf" position={e.position} fontSize={0.04} color="#ffffff" anchorX="center" anchorY="middle" outlineWidth={0.005} outlineColor="#000000">
          {e.text}
        </Text>
      ))}
    </group>
  );
}

export function Globe({ game, selectedFrom, validTargets, selection, highlightContinent, focus, onHover, onPick }: GlobeProps) {
  const { scene } = useGLTF(MODEL_URL);
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
      mesh.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(NEUTRAL_COLOR), roughness: 0.8, side: THREE.DoubleSide });
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
    const s = TARGET_RADIUS / (sphere.radius || 1);
    const g = new THREE.Group();
    g.add(root);
    root.position.copy(sphere.center).multiplyScalar(-s);
    root.scale.setScalar(s);

    // One surface anchor per territory (mean of its member vertices), plus one
    // per continent (for rotate-to-continent). Keyed distinctly (region names vs
    // continent ids), both looked up by focus.
    const centroidDirs = new Map<string, THREE.Vector3>();
    const toDir = (v: THREE.Vector3) => v.clone().sub(sphere.center).normalize().multiplyScalar(TARGET_RADIUS * 1.03);
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
  }, [scene, countryToTerritory, board]);

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
