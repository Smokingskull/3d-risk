import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import { Globe } from "./Globe.js";
import { Hud } from "./Hud.js";
import { Home } from "./Home.js";
import { TutorialTips } from "./TutorialTips.js";
import { CombatModal } from "./CombatModal.js";
import { CountryPopup } from "./CountryPopup.js";
import { ContinentsPanel } from "./ContinentsPanel.js";
import { PlayersPanel } from "./PlayersPanel.js";
import { useHotseat } from "./game/useHotseat.js";

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Key light offset up-and-left of the camera so it RAKES across the surface
 * rather than lighting it head-on. This gives the globe a lit/shadow gradient
 * (real spherical form) and lets the cracked-earth bevels catch the light. It
 * stays camera-relative so the raking is consistent as you orbit. */
function KeyLight() {
  const ref = useRef<THREE.DirectionalLight>(null);
  useFrame(({ camera }) => {
    const light = ref.current;
    if (!light) return;
    const e = camera.matrixWorld.elements;
    _right.set(e[0], e[1], e[2]); // camera right (world)
    _up.set(e[4], e[5], e[6]); // camera up (world)
    const dist = camera.position.length();
    light.position
      .copy(camera.position)
      .addScaledVector(_right, -0.7 * dist)
      .addScaledVector(_up, 0.7 * dist);
  });
  return <directionalLight ref={ref} intensity={1.25} />;
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
    hs.start(mode, [{ kind: "human" }, { kind: "cpu", difficulty: "easy" }, { kind: "cpu", difficulty: "easy" }], false, [
      "Red",
      "Blue",
      "Green",
    ]);
  }, [hs]);

  // Dev-only camera distance override (?cam=2.2) for inspecting the globe surface.
  const camZ =
    import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get("cam")) || 4 : 4;

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
  // Click a country in the list: select it (open its dialog) + rotate to it.
  const selectRegion = (id: string) => {
    hs.clickTerritory(id);
    focusOn(id);
  };
  // Click a country on the globe: select it + reflect its continent in the list (symmetry).
  const pickCountry = (id: string) => {
    hs.clickTerritory(id);
    setHighlightContinent(hs.game!.board.territories[id]?.continent ?? null);
    focusOn(id); // auto-rotate to the selected country (when auto-rotate is on)
  };

  if (import.meta.env.DEV)
    (window as unknown as { __app: unknown }).__app = { pickCountry, toggleContinent, selectRegion };

  return (
    <>
      <Hud hs={hs} hovered={hovered} />
      <TutorialTips hs={hs} />
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

      <Canvas camera={{ position: [0, 0, camZ], fov: 45 }} dpr={[1, 2]}>
        <color attach="background" args={["#101417"]} />
        {/* A raking key light (offset from the camera) gives the globe spherical
            form and makes the cracked-earth bevels catch light; low ambient +
            a cool hemisphere fill keep the shadow side readable without washing
            out the relief. */}
        <ambientLight intensity={0.25} />
        <hemisphereLight args={["#cdd8ee", "#20262e", 0.18]} />
        <KeyLight />
        <Stars radius={120} depth={40} count={3000} factor={4} fade speed={0.5} />

        <Suspense fallback={null}>
          <Globe
            game={hs.game}
            selectedFrom={hs.selectedFrom}
            validTargets={hs.validTargets}
            selection={hs.selection}
            highlightContinent={highlightContinent}
            focus={focus}
            onHover={setHovered}
            onPick={pickCountry}
          />
        </Suspense>

        <OrbitControls makeDefault enablePan={false} minDistance={1.6} maxDistance={8} rotateSpeed={0.6} zoomSpeed={0.7} />
      </Canvas>
    </>
  );
}
