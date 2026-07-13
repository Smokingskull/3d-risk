import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { Globe } from "./Globe.js";
import { Hud } from "./Hud.js";
import { StartMenu } from "./StartMenu.js";
import { RulesPage } from "./RulesPage.js";
import { TutorialTips } from "./TutorialTips.js";
import { CombatModal } from "./CombatModal.js";
import { CountryPopup } from "./CountryPopup.js";
import { ContinentsPanel } from "./ContinentsPanel.js";
import { useHotseat } from "./game/useHotseat.js";

export function App() {
  const hs = useHotseat();
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<"menu" | "rules">("menu");
  const [highlightContinent, setHighlightContinent] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);

  // Dev-only test hook so headless checks can drive the game deterministically.
  if (import.meta.env.DEV) (window as unknown as { __risk: typeof hs }).__risk = hs;

  if (!hs.game) {
    return view === "rules" ? (
      <RulesPage onBack={() => setView("menu")} />
    ) : (
      <StartMenu onStart={hs.start} onShowRules={() => setView("rules")} />
    );
  }

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
  };

  if (import.meta.env.DEV)
    (window as unknown as { __app: unknown }).__app = { pickCountry, toggleContinent, selectRegion };

  return (
    <>
      <Hud hs={hs} hovered={hovered} />
      <TutorialTips hs={hs} />
      <CombatModal hs={hs} />
      <CountryPopup hs={hs} />
      <ContinentsPanel
        game={hs.game}
        highlight={highlightContinent}
        selection={hs.selection}
        onToggle={toggleContinent}
        onSelectRegion={selectRegion}
      />

      <Canvas camera={{ position: [0, 0, 4], fov: 45 }} dpr={[1, 2]}>
        <color attach="background" args={["#05070d"]} />
        {/* Mostly-flat ambient keeps colours bright; a gentle hemisphere + key
            light add a subtle top-lit gradient so countries read as slightly raised. */}
        <ambientLight intensity={0.8} />
        <hemisphereLight args={["#dbe6ff", "#2a3242", 0.35]} />
        <directionalLight position={[5, 4, 5]} intensity={0.7} />
        <directionalLight position={[-5, -2, -3]} intensity={0.25} />
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
