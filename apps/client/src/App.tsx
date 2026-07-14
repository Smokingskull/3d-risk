import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import { Globe } from "./Globe.js";
import { Hud } from "./Hud.js";
import { Home } from "./Home.js";
import { Tutorial } from "./Tutorial.js";
import { CombatModal } from "./CombatModal.js";
import { CountryPopup } from "./CountryPopup.js";
import { ContinentsPanel } from "./ContinentsPanel.js";
import { PlayersPanel } from "./PlayersPanel.js";
import { useHotseat } from "./game/useHotseat.js";

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Two opposing raking lights, camera-relative. A single light only reveals the
 * cracked-earth relief in the grazing band near its terminator; the lit cap
 * flattens out. A brighter key from the left plus a dimmer fill from the right
 * each graze their own half, so the relief reads across the whole visible disc
 * while the key still carries the spherical shading. */
function RakingLights() {
  const key = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  useFrame(({ camera }) => {
    const e = camera.matrixWorld.elements;
    _right.set(e[0], e[1], e[2]); // camera right (world)
    _up.set(e[4], e[5], e[6]); // camera up (world)
    const d = camera.position.length();
    if (key.current)
      key.current.position.copy(camera.position).addScaledVector(_right, -1.5 * d).addScaledVector(_up, 0.45 * d);
    if (fill.current)
      fill.current.position.copy(camera.position).addScaledVector(_right, 1.5 * d).addScaledVector(_up, -0.4 * d);
  });
  return (
    <>
      <directionalLight ref={key} intensity={1.35} />
      <directionalLight ref={fill} intensity={0.7} color="#cfe0ff" />
    </>
  );
}

/** Star field parented to the camera (via a portal) so it reads as a stationary
 * backdrop: the stars inherit the camera's world matrix at render time, so the
 * globe rotates against fixed stars instead of the stars swinging with the view.
 * The camera is added to the scene so its portaled children get rendered. */
function BackdropStars() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.add(camera);
    return () => {
      scene.remove(camera);
    };
  }, [scene, camera]);
  return <>{createPortal(<Stars radius={120} depth={40} count={6500} factor={4} fade speed={0} />, camera)}</>;
}

/** Vertical gradient scene background (navy at the top -> near-black at the
 * bottom) for a sense of depth behind the globe. Screen-fixed, behind the stars. */
function SkyBackground() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#00092e"); // top
    g.addColorStop(1, "#101417"); // bottom (current background colour)
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const prev = scene.background;
    scene.background = tex;
    return () => {
      scene.background = prev;
      tex.dispose();
    };
  }, [scene]);
  return null;
}

export function App() {
  const hs = useHotseat();
  const [hovered, setHovered] = useState<string | null>(null);
  const [highlightContinent, setHighlightContinent] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);

  // Dev-only test hook so headless checks can drive the game deterministically.
  if (import.meta.env.DEV) (window as unknown as { __risk: typeof hs }).__risk = hs;

  // Dev-only: ?autostart=classic|world boots straight into a game so headless
  // screenshots can capture the live globe (which only renders in-game).
  const autostarted = useRef(false);
  useEffect(() => {
    if (!import.meta.env.DEV || autostarted.current || hs.game) return;
    const mode = new URLSearchParams(window.location.search).get("autostart");
    if (mode !== "classic" && mode !== "world") return;
    autostarted.current = true;
    const sp = new URLSearchParams(window.location.search);
    hs.start(mode, [{ kind: "human" }, { kind: "cpu", difficulty: "easy" }, { kind: "cpu", difficulty: "easy" }], sp.get("tutorial") === "1", ["Red", "Blue", "Green"], sp.get("campaign") === "1");
  }, [hs]);

  // Dev-only camera overrides for inspection: ?cam=<dist>, ?orbit=<degrees>.
  const params = import.meta.env.DEV ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const camZ = Number(params.get("cam")) || 4;
  const orbitRad = ((Number(params.get("orbit")) || 0) * Math.PI) / 180;
  const camPos: [number, number, number] = [camZ * Math.sin(orbitRad), 0, camZ * Math.cos(orbitRad)];

  if (!hs.game) return <Home onStart={hs.start} />;

  const focusOn = (id: string) => {
    if (!hs.autoRotate) return; // auto-rotate disabled → never rotate the globe
    setFocus((cur) => ({ id, n: (cur?.n ?? 0) + 1 }));
  };
  // Click a continent: highlight + rotate to it + de-select any selected country.
  const toggleContinent = (id: string) => {
    if (highlightContinent === id) {
      setHighlightContinent(null);
      return;
    }
    setHighlightContinent(id);
    hs.clearSource();
    focusOn(id);
  };
  // Click a country in the Continents list: rotate the globe to it only (no select).
  const selectRegion = (id: string) => {
    focusOn(id);
  };
  // Click a country on the globe: select it + reflect its continent in the list.
  // Selection never rotates the globe (that only happens from the Continents box).
  const pickCountry = (id: string) => {
    hs.clickTerritory(id);
    setHighlightContinent(hs.game!.board.territories[id]?.continent ?? null);
  };

  if (import.meta.env.DEV)
    (window as unknown as { __app: unknown }).__app = { pickCountry, toggleContinent, selectRegion };

  return (
    <>
      <Hud hs={hs} hovered={hovered} />
      <Tutorial hs={hs} />
      <CombatModal hs={hs} />
      <CountryPopup hs={hs} />
      <div className="right-stack">
        <PlayersPanel hs={hs} />
        <ContinentsPanel
          game={hs.game}
          highlight={highlightContinent}
          selection={hs.selection}
          onToggle={toggleContinent}
          onSelectRegion={selectRegion}
        />
      </div>

      <Canvas
        camera={{ position: camPos, fov: 45 }}
        dpr={[1, 2]}
        style={{ cursor: hs.mode === "rotate" ? "grab" : "pointer" }}
      >
        <SkyBackground />
        {/* A raking key light (offset from the camera) gives the globe spherical
            form and makes the cracked-earth bevels catch light; low ambient +
            a cool hemisphere fill keep the shadow side readable without washing
            out the relief. */}
        <ambientLight intensity={0.14} />
        <hemisphereLight args={["#cdd8ee", "#20262e", 0.1]} />
        <RakingLights />
        <BackdropStars />

        <Suspense fallback={null}>
          <Globe
            game={hs.game}
            selectedFrom={hs.selectedFrom}
            validTargets={hs.validTargets}
            selection={hs.selection}
            highlightContinent={highlightContinent}
            focus={focus}
            selectable={hs.mode === "select"}
            onHover={setHovered}
            onPick={pickCountry}
          />
        </Suspense>

        <OrbitControls makeDefault enablePan={false} minDistance={1.6} maxDistance={8} rotateSpeed={0.6} zoomSpeed={0.7} />
      </Canvas>
    </>
  );
}
