import { useEffect, useRef, useState, useCallback } from "react";
import { initGame, setPlayerProfile } from "./game";
import { StoreOverlay } from "./components/StoreOverlay";

type Profile = {
  username: string;
  echoBalance: number;
  bonusFlares: number;
  sonarLevel: number;
};

function App() {
  const threeRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const tc = threeRef.current;
    const hc = hudRef.current;
    if (!tc || !hc) return;
    const cleanup = initGame(tc, hc);
    return cleanup;
  }, []);

  const handleProfileChange = useCallback((p: Profile | null) => {
    setProfile(p);
    setPlayerProfile(p ? { bonusFlares: p.bonusFlares, sonarLevel: p.sonarLevel, echoBalance: p.echoBalance, username: p.username } : null);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden" }}>
      <canvas ref={threeRef} style={{ position: "absolute", inset: 0, display: "block" }} />
      <canvas ref={hudRef} style={{ position: "absolute", inset: 0, display: "block", pointerEvents: "none" }} />
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.75) 100%)",
      }} />
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.07) 2px, rgba(0,0,0,0.07) 3px)",
      }} />
      <StoreOverlay onProfileChange={handleProfileChange} />
      {/* Suppress unused variable warning — profile is used for HUD wiring in future */}
      <span style={{ display: "none" }}>{profile?.username}</span>
    </div>
  );
}

export default App;
