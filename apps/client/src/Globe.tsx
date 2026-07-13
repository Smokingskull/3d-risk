import { useEffect, useMemo, useRef } from "react";
import { Text, useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { getBoard, type GameState, type TerritoryId } from "@risk3d/engine";
import { NEUTRAL_COLOR } from "./players.js";
import { HAVE_COLOR, NEED_COLOR } from "./continents.js";

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
        <Text key={e.id} position={e.position} fontSize={0.04} color="#ffffff" anchorX="center" anchorY="middle" outlineWidth={0.005} outlineColor="#000000">
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
  const { group, meshesByTerritory, centroids } = useMemo(() => {
    const root = scene.clone(true);
    const byTerritory = new Map<string, THREE.Mesh[]>();
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

      mesh.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(NEUTRAL_COLOR), roughness: 0.85, side: THREE.DoubleSide });
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

    const sphere = new THREE.Sphere().setFromPoints(points);
    const s = TARGET_RADIUS / (sphere.radius || 1);
    const g = new THREE.Group();
    g.add(root);
    root.position.copy(sphere.center).multiplyScalar(-s);
    root.scale.setScalar(s);

    // One surface label anchor per territory (mean of its member vertices).
    const centroidDirs = new Map<string, THREE.Vector3>();
    for (const [territory, acc] of sum) {
      const centre = acc.clone().multiplyScalar(1 / (counts.get(territory) || 1));
      centroidDirs.set(territory, centre.sub(sphere.center).normalize().multiplyScalar(TARGET_RADIUS * 1.03));
    }
    return { group: g, meshesByTerritory: byTerritory, centroids: centroidDirs };
  }, [scene, countryToTerritory]);

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

    const hl = r.highlightContinent;
    const isMember = !!hl && playableHere && r.game.board.territories[territory]?.continent === hl;
    const dimNonMember = !!hl && playableHere && !isMember;

    let emissive = "#000000";
    let intensity = 0;
    if (playableHere) {
      if (r.selectedFrom === territory) [emissive, intensity] = ["#fff27a", 0.6];
      else if (r.selection === territory) [emissive, intensity] = ["#38bdf8", 0.6];
      else if (r.validTargets.has(territory)) [emissive, intensity] = ["#ff8844", 0.5];
      else if (r.hovered === territory) [emissive, intensity] = ["#ffffff", 0.3];
      else if (isMember) [emissive, intensity] = owner === r.game.activePlayer ? [HAVE_COLOR, 0.4] : [NEED_COLOR, 0.75];
    }
    for (const mesh of meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(base);
      if (dimNonMember) mat.color.multiplyScalar(0.32);
      mat.emissive.set(emissive);
      mat.emissiveIntensity = intensity;
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
