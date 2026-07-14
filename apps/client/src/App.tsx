import { Suspense, useRef, useState } from "react";
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

/** A directional light that tracks the camera — straight-on "headlight" so the
 * globe shows a subtle centre-bright, edge-dark 3D gradient as it rotates. */
function CameraLight() {
  const ref = useRef<THREE.DirectionalLight>(null);
  useFrame(({ camera }) => ref.current?.position.copy(camera.position));
  return <directionalLight ref={ref} intensity={0.85} />;
}

export function App() {
  const hs = useHotseat();
  const [hovered, setHovered] = useState<string | null>(null);
  const [highlightContinent, setHighlightContinent] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);

  // Dev-only test hook so headless checks can drive the game deterministically.
  if (import.meta.env.DEV) (window as unknown as { __risk: typeof hs }).__risk = hs;

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

      <Canvas camera={{ position: [0, 0, 4], fov: 45 }} dpr={[1, 2]}>
        <color attach="background" args={["#101417"]} />
        {/* Base ambient + a camera-tracking headlight give a straight-on, centre-bright
            3D gradient; a faint fixed fill keeps the far edge from going pure black. */}
        <ambientLight intensity={0.5} />
        <hemisphereLight args={["#dbe6ff", "#2a3242", 0.2]} />
        <CameraLight />
        <directionalLight position={[-5, -2, -3]} intensity={0.15} />
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
