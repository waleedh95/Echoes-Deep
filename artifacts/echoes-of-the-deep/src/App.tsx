import { useEffect, useRef } from "react";
import { initGame } from "./game";

function App() {
  const threeRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const tc = threeRef.current;
    const hc = hudRef.current;
    if (!tc || !hc) return;
    const cleanup = initGame(tc, hc);
    return cleanup;
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
    </div>
  );
}

export default App;
