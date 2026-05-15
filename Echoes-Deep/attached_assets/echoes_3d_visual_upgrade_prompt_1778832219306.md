# ECHOES OF THE DEEP — 3D VISUAL UPGRADE PROMPT

## ROLE & TASK
You are an expert browser game developer specializing in Three.js 3D graphics. Take the existing Echoes of the Deep game and completely rebuild its rendering engine to match the reference visual style described below. Keep ALL gameplay mechanics, story, dialogue, levels, enemies, HUD, and audio exactly the same. Only upgrade the graphics to full 3D.

---

## TECHNOLOGY STACK

Replace the HTML5 Canvas 2D renderer with:
- **Three.js** (load from CDN: https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js)
- **Howler.js** for audio (keep from before)
- Single `index.html` file
- No other frameworks

---

## CAMERA & PERSPECTIVE

- **View:** First-person cockpit view — the player sees the world from INSIDE Elias's submarine cockpit
- The cockpit dashboard is always visible at the bottom of the screen (like the reference image)
- Camera is fixed inside the cockpit. Mouse movement rotates the camera left/right and up/down (look around)
- The submarine moves through the 3D world but the camera always stays inside it
- Field of View: 75 degrees
- The cockpit frame acts like a helmet/visor — it never moves, only the world outside rotates with mouse look

---

## COCKPIT DASHBOARD (Bottom of Screen — Always Visible)

Model a 3D cockpit interior visible at the bottom of the screen at all times. Include:
- A **radar/sonar dish** in the center (slowly rotating, green sweep line)
- Rows of **buttons and switches** on left and right panels (purely visual, not interactive)
- A **central console** with glowing red and green indicator lights
- All cockpit geometry rendered in **dark metal tones** — NOT wireframe. The cockpit is real/solid, everything outside is wireframe
- Subtle red ambient light illuminates the cockpit interior from below
- The cockpit viewport (the window you look through) is an oval/rounded rectangle shape — like a submarine porthole — framing the 3D world outside

---

## 3D WORLD — WIREFRAME ECHOLOCATION RENDERING

This is the most critical visual system. Implement it exactly:

### Default State (No Ping)
- The world outside the cockpit is **pure black — total darkness**
- Nothing is visible. No ambient light. No stars. Nothing.
- Only the cockpit interior has dim red ambient light

### When a Sonar Ping is Emitted
- A sphere of light expands outward from the submarine in 3D space
- As the expanding sphere intersects with 3D geometry, it "paints" those surfaces as glowing neon wireframes
- Use Three.js `EdgesGeometry` + `LineSegments` to render ALL world geometry as wireframe edges only (no solid faces — only the edges glow)
- Wireframe lines glow brightly when first revealed, then fade to black over 3–5 seconds using line material opacity animation
- The ping wave itself is visible as a brief expanding translucent sphere that disappears after reaching max radius

### Wireframe Color System
| Object Type | Color | Hex |
|---|---|---|
| Cave walls / terrain | Cyan-blue gradient | #00FFFF to #0088FF |
| Research vessel / wreckage | Cyan with rainbow edge shimmer (like reference image) | #00FFFF |
| Lifepods | Pulsing green | #00FF88 |
| Data logs / collectibles | Yellow | #FFD700 |
| Enemies (when pinged) | Red with distortion | #FF3333 |
| Flare glow | Orange sphere of light | #FF6600 |
| Player submarine edges | Soft blue always-on glow | #4488FF |

### Wireframe Bloom Effect
- Apply a post-processing **bloom/glow effect** to all wireframe lines
- Use Three.js UnrealBloomPass if available, otherwise simulate with additive blending on line materials
- Result: Wireframe lines should look like they are emitting light, not just colored lines

---

## 3D ENVIRONMENT GEOMETRY

Build the following 3D scene elements:

### Cave Tunnel System
- Irregular cave tunnel built from multiple cylinder/cone segments with displaced vertices to create rough organic walls
- Stalactites hanging from ceiling (cone geometry, pointing down)
- Stalagmites on floor (cone geometry, pointing up)
- Rock formations on walls (icosahedron geometry, scaled irregularly)
- All rendered as wireframe edges only

### Research Vessel Wreck (Level 1 End Zone)
- A large research vessel (like the "RESEARCH VESSEL ODYSSEY" in the reference image) built from Box geometries assembled into a ship shape
- Ship name rendered on hull using 3D text or canvas texture: "RESEARCH VESSEL ODYSSEY"
- The ship is partially collapsed — some sections are rotated/displaced to show damage
- When pinged: Lights up with the full rainbow-edge wireframe shimmer from the reference image (cycle through cyan → blue → purple → green along the hull edges)

### Debris Field
- Scattered box, cylinder, and sphere geometry pieces floating/resting on the cave floor
- Some slowly rotating (simulating gentle current)

### Lifepods
- Oval/capsule geometry (CapsuleGeometry or combined sphere+cylinder)
- Pulsing green glow — animate the line material opacity between 0.6 and 1.0 continuously
- Small viewport window on the pod (a circle geometry on the surface)

### Floating Particles
- 200 tiny point particles floating slowly upward throughout the scene
- Very faint cyan color — simulate bioluminescence
- Always visible (very low opacity) even without a ping — they are the only constant light source in the world besides the cockpit

---

## ENEMY 3D MODELS

### DRIFTER (Level 1)
- Built from sharp angular geometry — think broken/shattered icosahedron with extra jagged spikes
- Always invisible (opacity 0) until hit by sonar ping
- When pinged: Instantly appears as red wireframe for 2 seconds then fades
- Has "too many limbs" — add 6–8 thin cylinder arms extending from center at wrong angles
- Slowly rotates as it patrols, like something drifting in current
- Scale: 2x submarine size

### STALKER (Level 2)
- More elongated — stretched sphere body with long tentacle-like appendages trailing behind
- When revealed: Red wireframe with a distortion effect (animate vertex positions slightly ±2px randomly)
- Moves faster than Drifter
- When it "listens" — it stops moving and all its appendages spread outward (scale Y up slowly)
- Scale: 1.5x submarine size

### VOID LEVIATHAN (Level 3)
- Massive — 8x submarine size
- Serpentine body: chain of 12 sphere segments getting larger toward the head
- Head: Large sphere with two glowing cyan eye spheres (always visible even without ping — this is its tell)
- When it breathes/pulses: Its body segments ripple in a wave animation
- Its sonar-disrupting pulse: Emits a visible red expanding ring that temporarily inverts all wireframe colors to static noise
- Always partially revealed — you can always see its eye glow in the darkness

---

## FLARE SYSTEM (3D)

- When F is pressed: Spawn a 3D sphere object (small, radius 0.3)
- The flare emits an actual Three.js `PointLight` with orange color (#FF6600) and limited range (radius 80 units)
- This light physically illuminates nearby wireframe geometry continuously (no ping needed — flares break the darkness with real light)
- The flare sinks downward at 2 units/second (gravity simulation)
- Leaves a faint orange particle trail as it falls
- After 8 seconds: PointLight fades out and flare disappears
- Visual result: Like the orange glowing sphere in the reference image — it creates a warm cone of light revealing surroundings

---

## SONAR PING VISUAL EFFECT (3D Implementation)

```
SMALL PING:
- Spawn expanding sphere at submarine position
- Radius grows from 0 to 150 units over 1.5 seconds
- Sphere material: wireframe, cyan, opacity fades from 0.4 to 0
- All EdgesGeometry within 150 unit radius: opacity spikes to 1.0 then fades over 3 seconds
- Noise meter +5

LARGE PING:
- Same but radius grows to 350 units over 2.5 seconds
- Ping sphere opacity starts at 0.7
- Lit wireframes fade over 5 seconds
- Noise meter +25

FLARE CONTINUOUS PING:
- Every 1.5 seconds from flare position: small ping radius 80 units
- Noise meter +3 per ping
```

---

## ENEMY DETECTION VISUAL

When a Sound-Hunter is nearby (within 100 units) but NOT yet revealed by ping:
- The cockpit radar dish shows a blip (red dot at correct bearing)
- The wireframe edges near the enemy location show brief red interference flickers randomly
- The enemy's breathing sound volume increases with proximity
- Screen edges get a subtle red vignette that pulses with the enemy's breathing rhythm

When enemy is hit by ping:
- Instantly renders in red wireframe with bloom
- A red "THREAT DETECTED" label appears in 3D space near the enemy (matching reference image)
- Label always faces the camera (billboard)
- Label fades after 2 seconds

---

## LIGHTING SETUP

```javascript
// Scene lighting — keep it minimal and atmospheric
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // Pure black

// Dim red ambient for cockpit interior only
const cockpitAmbient = new THREE.AmbientLight(0x330000, 0.3);

// No other global lighting — world is lit ONLY by:
// 1. Sonar ping revealing wireframes (material opacity animation)
// 2. Flare PointLights (orange, limited range)
// 3. Enemy eye glow (Leviathan only — small cyan PointLight on eyes)
// 4. Lifepod pulse (small green PointLight, animated intensity)
```

---

## HUD (Keep from Previous Version — Overlay on Top of 3D Scene)

Render HUD as a 2D HTML overlay (`position: absolute`) on top of the Three.js canvas:
- O2 gauge (top left) — CSS animated circular arc
- Noise meter bar (top right)
- Flare count (bottom left) — icon dots
- Interaction prompt (bottom center) — appears near interactable objects
- Dialogue subtitles (bottom center, above interaction prompt)
- Scanlines CSS overlay on entire screen
- "THREAT DETECTED" labels rendered in Three.js 3D space (as described above)
- Glitch effect: Random CSS `transform: translate` + `opacity` flicker every 30–60 seconds on HUD

---

## POST-PROCESSING & SCREEN EFFECTS

- **Bloom:** All emissive/wireframe materials should bloom (glow beyond their geometry)
- **Scanlines:** CSS overlay of repeating horizontal lines at 2px intervals, opacity 0.08
- **Vignette:** Dark circular vignette always on — edges of screen are darker than center
- **Glitch shader:** Triggered by: enemy nearby, low oxygen, taking damage. Briefly distorts UVs, adds color channel separation (RGB shift)
- **Enemy proximity distortion:** When Sound-Hunter is within 50 units, wireframe geometry vertices jitter slightly — the world itself becomes unstable

---

## ENDING SEQUENCE (3D)

### Both Endings — Environment Glitch
When the final choice is made:
1. All wireframe geometry begins flickering rapidly
2. The cave walls start dissolving — EdgesGeometry opacity drops to 0 piece by piece randomly
3. The pure black sky begins turning white slowly (scene background color animates from #000000 to #FFFFFF over 4 seconds)
4. The cockpit dashboard dissolves last
5. Fade to white completely

### Hospital Room Reveal
After white flash:
- Render a simple 3D hospital room: white box geometry (solid, no wireframe), a bed, medical equipment silhouettes
- Camera slowly pulls back revealing Elias lying in the bed
- The rhythmic breathing audio transitions to ventilator/EKG sounds
- Overlay the 2D comic panel cutscene system for the final ending panels

---

## PERFORMANCE REQUIREMENTS

- Target: 60fps on a modern laptop browser
- Use `THREE.BufferGeometry` for all geometry (not legacy Geometry)
- Limit active PointLights to maximum 4 simultaneous (flares share a light pool)
- Wireframe segments: Only animate opacity for geometry within 400 units of camera
- Enemies outside 500 units: Pause their AI update loop
- Use `THREE.LOD` for large geometry (cave walls) if needed

---

## FINAL INSTRUCTION

Rebuild the complete game with this 3D rendering system. The result must look like the reference image: a first-person cockpit view, pure black void outside, geometry revealed only by sonar pings as glowing neon wireframes, enemies appearing as jagged red wireframe shapes, flares casting real orange light. Keep every gameplay mechanic, all story dialogue, all level layouts, all enemy behaviors, all HUD elements, and all audio from the original version. Only the renderer changes — from 2D canvas to full Three.js 3D.

The final game must run in a single `index.html` file on Replit with no build step required.
