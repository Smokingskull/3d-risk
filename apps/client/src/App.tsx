import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { Globe } from "./Globe.js";
import { Hud } from "./Hud.js";
import { StartMenu } from "./StartMenu.js";
import { RulesPage } from "./RulesPage.js";
import { TutorialTips } from "./TutorialTips.js";
import { CombatModal } from "./CombatModal.js";
import { ContinentsPanel } from "./ContinentsPanel.js";
import { useHotseat } from "./game/useHotseat.js";

export function App() {
  const hs = useHotseat();
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<"menu" | "rules">("menu");
  const [highlightContinent, setHighlightContinent] = useState<string | null>(null);

  // Dev-only test hook so headless checks can drive the game deterministically.
  if (import.meta.env.DEV) (window as unknown as { __risk: typeof hs }).__risk = hs;

  if (!hs.game) {
    return view === "rules" ? (
      <RulesPage onBack={() => setView("menu")} />
    ) : (
      <StartMenu onStart={hs.start} onShowRules={() => setView("rules")} />
    );
  }

  return (
    <>
      <Hud hs={hs} hovered={hovered} />
      <TutorialTips hs={hs} />
      <CombatModal hs={hs} />
      <ContinentsPanel game={hs.game} highlight={highlightContinent} onToggle={(id) => setHighlightContinent((cur) => (cur === id ? null : id))} />

      <Canvas camera={{ position: [0, 0, 4], fov: 45 }} dpr={[1, 2]}>
        <color attach="background" args={["#05070d"]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[5, 3, 5]} intensity={1.1} />
        <directionalLight position={[-5, -2, -3]} intensity={0.3} />
        <Stars radius={120} depth={40} count={3000} factor={4} fade speed={0.5} />

        <Suspense fallback={null}>
          <Globe
            game={hs.game}
            selectedFrom={hs.selectedFrom}
            validTargets={hs.validTargets}
            highlightContinent={highlightContinent}
            onHover={setHovered}
            onPick={hs.clickTerritory}
          />
        </Suspense>

        <OrbitControls enablePan={false} minDistance={1.6} maxDistance={8} rotateSpeed={0.6} zoomSpeed={0.7} />
      </Canvas>
    </>
  );
}
