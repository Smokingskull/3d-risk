import { useEffect, useMemo, useRef } from "react";
import { Text, useGLTF } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { GameState, TerritoryId } from "@risk3d/engine";
import { NEUTRAL_COLOR } from "./players.js";

const MODEL_URL = "/transparent_country_globe_gameboard.glb";
const TARGET_RADIUS = 1.2;
const INERT_COLOR = "#20242e"; // countries not playable in the current mode

interface GlobeProps {
  game: GameState;
  selectedFrom: TerritoryId | null;
  validTargets: Set<TerritoryId>;
  onHover: (country: TerritoryId | null) => void;
  onPick: (country: TerritoryId) => void;
}

interface LabelEntry {
  id: string;
  position: [number, number, number];
  text: string;
}

/** Army-count labels that always face the camera. */
function Labels({ entries }: { entries: LabelEntry[] }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    if (!group.current) return;
    for (const child of group.current.children) child.quaternion.copy(camera.quaternion);
  });
  return (
    <group ref={group}>
      {entries.map((e) => (
        <Text
          key={e.id}
          position={e.position}
          fontSize={0.04}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.005}
          outlineColor="#000000"
        >
          {e.text}
        </Text>
      ))}
    </group>
  );
}

export function Globe({ game, selectedFrom, validTargets, onHover, onPick }: GlobeProps) {
  const { scene } = useGLTF(MODEL_URL);

  // Prepare the scene once: per-country material, collect meshes + surface
  // centroids, normalise size/position so the globe is centred on the origin.
  const { group, meshesByCountry, centroids } = useMemo(() => {
    const root = scene.clone(true);
    const byCountry = new Map<string, THREE.Mesh[]>();
    const rawCentroids = new Map<string, THREE.Vector3>();
    const points: THREE.Vector3[] = [];

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const country = mesh.name || mesh.parent?.name || "";
      if (!country) return;

      mesh.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(NEUTRAL_COLOR), roughness: 0.85 });
      mesh.userData.country = country;
      const list = byCountry.get(country) ?? [];
      list.push(mesh);
      byCountry.set(country, list);

      // Accumulate the vertex centroid (average) and collect points for a true
      // bounding sphere — Box3.getBoundingSphere would over-size a sphere's AABB.
      const pos = mesh.geometry.getAttribute("position");
      const c = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        points.push(v);
        c.add(v);
      }
      rawCentroids.set(country, c.multiplyScalar(1 / pos.count));
    });

    const sphere = new THREE.Sphere().setFromPoints(points);
    const s = TARGET_RADIUS / (sphere.radius || 1);

    const g = new THREE.Group();
    g.add(root);
    root.position.copy(sphere.center).multiplyScalar(-s);
    root.scale.setScalar(s);

    // Label anchors in world space: direction from the globe centre, at the
    // globe's true world radius (so they sit just above the surface).
    const centroidDirs = new Map<string, THREE.Vector3>();
    for (const [country, c] of rawCentroids)
      centroidDirs.set(country, c.clone().sub(sphere.center).normalize().multiplyScalar(TARGET_RADIUS * 1.03));

    return { group: g, meshesByCountry: byCountry, centroids: centroidDirs };
  }, [scene]);

  // Owner → colour, refreshed when players change.
  const ownerColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of game.players) m.set(p.id, p.color);
    return m;
  }, [game.players]);

  const playable = useMemo(() => new Set(Object.keys(game.board.territories)), [game.board]);

  // Refs so the repaint routine and the imperative hover handler share one source.
  const refs = useRef({ game, selectedFrom, validTargets, ownerColor, playable, hovered: null as string | null });
  refs.current.game = game;
  refs.current.selectedFrom = selectedFrom;
  refs.current.validTargets = validTargets;
  refs.current.ownerColor = ownerColor;
  refs.current.playable = playable;

  const paint = (country: string) => {
    const meshes = meshesByCountry.get(country);
    if (!meshes) return;
    const r = refs.current;
    const playableHere = r.playable.has(country);
    const owner = playableHere ? r.game.territories[country]?.owner : null;
    const base = !playableHere ? INERT_COLOR : owner ? (r.ownerColor.get(owner) ?? NEUTRAL_COLOR) : NEUTRAL_COLOR;

    let emissive = "#000000";
    let intensity = 0;
    if (playableHere) {
      if (r.selectedFrom === country) [emissive, intensity] = ["#fff27a", 0.6];
      else if (r.validTargets.has(country)) [emissive, intensity] = ["#ff8844", 0.5];
      else if (r.hovered === country) [emissive, intensity] = ["#ffffff", 0.3];
    }
    for (const mesh of meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(base);
      mat.emissive.set(emissive);
      mat.emissiveIntensity = intensity;
    }
  };

  const paintAll = () => {
    for (const country of meshesByCountry.keys()) paint(country);
  };

  // Repaint owner colours + selection/target highlights whenever they change.
  useEffect(paintAll, [game, selectedFrom, validTargets, ownerColor, playable]);

  const setHovered = (country: string | null) => {
    const prev = refs.current.hovered;
    if (prev === country) return;
    refs.current.hovered = country;
    if (prev) paint(prev);
    if (country) paint(country);
    onHover(country);
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const country = e.object.userData.country as string | undefined;
    setHovered(country && playable.has(country) ? country : null);
  };
  const handleOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(null);
  };
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const country = e.object.userData.country as string | undefined;
    if (country && playable.has(country)) onPick(country);
  };

  useEffect(() => () => setHovered(null), []);

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
