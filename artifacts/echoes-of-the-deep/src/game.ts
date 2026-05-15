// ============================================================
// ECHOES OF THE DEEP — 3D Renderer Upgrade
// Two.js (first-person cockpit, wireframe echolocation)
// All gameplay mechanics preserved from 2D version.
// ============================================================
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ============================================================
// POST-PROCESSING SHADER DEFINITIONS
// ============================================================

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    offset:   { value: 0.35 },
    darkness: { value: 0.9 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 uv = vUv - vec2(0.5);
      float dist = length(uv);
      float v = 1.0 - smoothstep(offset, offset + 0.42, dist);
      color.rgb *= mix(1.0 - darkness, 1.0, v);
      gl_FragColor = color;
    }
  `,
};

const FilmGrainShader = {
  uniforms: {
    tDiffuse:  { value: null as THREE.Texture | null },
    time:      { value: 0.0 },
    intensity: { value: 0.45 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float intensity;
    varying vec2 vUv;
    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float t = fract(time * 0.37);
      float gr = rand(vUv + t) * 2.0 - 1.0;
      float gg = rand(vUv + t + 0.13) * 2.0 - 1.0;
      float gb = rand(vUv + t + 0.27) * 2.0 - 1.0;
      color.r = clamp(color.r + gr * intensity, 0.0, 1.0);
      color.g = clamp(color.g + gg * intensity * 0.75, 0.0, 1.0);
      color.b = clamp(color.b + gb * intensity * 0.85, 0.0, 1.0);
      gl_FragColor = color;
    }
  `,
};

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0.004 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec2 center = vec2(0.5);
      vec2 delta = vUv - center;
      float dist = length(delta);
      float fade = smoothstep(0.35, 0.62, dist);
      vec2 dir = normalize(delta) * strength * fade;
      float r = texture2D(tDiffuse, vUv + dir * 2.0).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * 2.0).b;
      float a = texture2D(tDiffuse, vUv).a;
      gl_FragColor = vec4(r, g, b, a);
    }
  `,
};

const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    vec3 sCurve(vec3 c) {
      c = clamp(c, 0.0, 1.0);
      c = pow(c, vec3(1.18));
      c = c * 0.94 + 0.012;
      return c;
    }
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;
      color = sCurve(color);
      float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(lum), color, 0.80);
      float shadow   = 1.0 - smoothstep(0.0, 0.22, lum);
      float midtone  = smoothstep(0.0, 0.55, lum) * (1.0 - smoothstep(0.45, 1.0, lum));
      color += shadow  * vec3(-0.025, -0.012, 0.055);
      color += midtone * vec3(-0.018,  0.038, 0.028);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
    }
  `,
};

// ============================================================
// CONSTANTS
// ============================================================
const GAME_W = 1280;
const GAME_H = 720;
const PLAYER_SIZE = 15;
const PLAYER_SPEED = 210;
const PLAYER_BOOST_MULT = 2.0;
const PLAYER_FRICTION = 0.84;
const O2_DRAIN_NORMAL = 1 / 3;
const O2_DRAIN_BOOST = 1.0;
const O2_LOSS_HIT = 15;
const NOISE_DECAY = 5;
const SONAR_SMALL_R = 160;
const SONAR_LARGE_R = 360;
const SONAR_SMALL_NOISE = 5;
const SONAR_LARGE_NOISE = 25;
const FLARE_DURATION = 8000;
const FLARE_PING_INTERVAL = 1500;
const INTERACT_RADIUS = 65;

// 3D visual constants
const WS = 0.05;          // world scale: 1px → 0.05 Three.js units
const EYE_H = 1.5;        // camera eye height
const WALL_H = 8;         // wall height in 3D units
const FLOOR_CELL = 100;   // floor grid cell size in 2D pixels
const MOUSE_SENS = 0.002; // mouse look sensitivity

// Fluid physics constants
const FLUID_BASE_DRAG = 3.2;       // base linear drag per second
const FLUID_SPEED_DRAG = 0.00025;  // quadratic drag coefficient (per speed² per second)
const INPUT_SMOOTH_K = 0.12;       // input lerp amount per 1/60 s frame
const CAM_ROLL_SENS = 0.30;        // yaw-rate → roll mapping factor
const CAM_ROLL_MAX = 4 * Math.PI / 180;  // ±4° max roll
const CAM_PITCH_MAX = 5 * Math.PI / 180; // ±5° max pitch from buoyancy
const CAM_ROLL_RETURN = 5.0;       // roll lerp-back rate (per second)
const CAM_PITCH_RETURN = 3.5;      // pitch lerp-back rate (per second)
const BUOY_FREQ = 0.4;             // buoyancy sine frequency (rad/s)
const BUOY_AMP = 0.038;            // buoyancy Y amplitude (Three.js units)

// ─── SONAR OVERLAY SHADERS ───────────────────────────────────────────────────
// Projects a glowing world-space grid onto all terrain surfaces as the
// sonar ring sweeps through them — pure Subnautica-style depth scan.
const SONAR_VERT = /* glsl */`
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const SONAR_FRAG = /* glsl */`
  #define MAX_PINGS 5
  uniform vec3  uPingOrigin[MAX_PINGS];
  uniform float uPingRadius[MAX_PINGS];
  uniform float uPingOpacity[MAX_PINGS];
  varying vec3  vWorldPos;

  void main() {
    float alpha = 0.0;
    vec3  col   = vec3(0.0);

    for (int i = 0; i < MAX_PINGS; i++) {
      float op = uPingOpacity[i];
      if (op < 0.004) continue;

      // Cylindrical (XZ plane) distance — ring sweeps in the horizontal plane
      float dx = vWorldPos.x - uPingOrigin[i].x;
      float dz = vWorldPos.z - uPingOrigin[i].z;
      float dist = sqrt(dx * dx + dz * dz);
      float radius = uPingRadius[i];

      // ── Ring front: extra-bright leading edge ──
      float ringDist = abs(dist - radius);
      float ringGlow = max(0.0, 1.0 - ringDist / 0.7) * op * 3.5;
      ringGlow = pow(ringGlow, 0.55);

      // ── Grid painted onto the entire swept zone ──
      // No trail fade — the whole area behind the ring stays lit at full
      // opacity until the ping expires.  Only uPingOpacity controls fade.
      float gridGlow = 0.0;
      if (dist < radius) {
        // Dense world-space XZ grid (0.6-unit cells ≈ 12 game pixels)
        float gridSz = 0.6;
        float lw     = 0.10;   // thick lines for high contrast
        float gx = abs(fract(vWorldPos.x / gridSz + 0.5) - 0.5) * 2.0;
        float gz = abs(fract(vWorldPos.z / gridSz + 0.5) - 0.5) * 2.0;
        float lines = max(
          smoothstep(1.0 - lw * 2.4, 1.0, gx),
          smoothstep(1.0 - lw * 2.4, 1.0, gz)
        );
        // Extra glow where lines cross
        float cross = min(
          smoothstep(1.0 - lw * 2.4, 1.0, gx) *
          smoothstep(1.0 - lw * 2.4, 1.0, gz) * 2.0, 1.0);
        gridGlow = (lines + cross * 0.5) * op * 1.5;
      }

      float glow = max(ringGlow, gridGlow);
      alpha = max(alpha, glow);
      col  += vec3(0.04, 0.92, 1.0) * glow;
    }

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(min(col, vec3(2.5)), min(alpha, 1.0));
  }
`;

// Colours (still used in HUD canvas)
const C_ENV = "#00FFFF";
const C_SAFE = "#00FF88";
const C_DANGER = "#FF3333";
const C_BG = "#00000A";

// ============================================================
// TYPES
// ============================================================
interface Vec2 { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }

interface Ping {
  x: number; y: number; radius: number; maxRadius: number;
  type: "small" | "large" | "flare" | "boost";
  thickness: number; speed: number; color: number;
  paintedObjects: Set<number>; paintedEnemies: Set<number>; paintedPods: Set<number>;
  screeches: Set<number>;
  nearbyObjs: number[];
}
interface RevealObj {
  lines: THREE.LineSegments; mat: THREE.LineBasicMaterial;
  cx: number; cy: number;
  alpha: number; baseAlpha: number;
  fadeTimer: number; fadeDuration: number;
  tintColor: number;
}
interface EnemyObj { group: THREE.Group; mats: THREE.LineBasicMaterial[]; label: THREE.Sprite; labelMat: THREE.SpriteMaterial; jitterTimer: number }
interface PodObj { group: THREE.Group; mat: THREE.LineBasicMaterial; light: THREE.PointLight; label: THREE.Sprite; labelMat: THREE.SpriteMaterial }
interface Ping3D { sphere: THREE.Mesh; mat: THREE.MeshBasicMaterial; maxR: number; radius: number; ox: number; oy: number; type: string; warpTimer: number; warpPos: THREE.Vector3 | null }
interface FlareMesh { mesh: THREE.Mesh; light: THREE.PointLight }

interface Enemy {
  x: number; y: number; type: "drifter" | "stalker" | "leviathan";
  waypoints: Vec2[]; wpIdx: number; speed: number;
  state: "patrol" | "alert" | "hunt";
  visTimer: number; hitR: number; listenTimer: number; damagedAt: number;
  roarTimer?: number;
}
interface Lifepod { x: number; y: number; id: string; rescued: boolean; revealTimer: number; character: string; commsLine: string }
interface NoiseObj { x: number; y: number; id: string; silenced: boolean; noiseRate: number; revealTimer: number }
interface Flare { x: number; y: number; vy: number; timer: number; pingTimer: number }
interface DialogueCue { time: number; text: string }

interface LevelData {
  id: number; name: string; worldW: number; worldH: number;
  playerStart: Vec2; obstacles: Rect[];
  enemyDefs: Array<Omit<Enemy, "state" | "visTimer" | "listenTimer" | "damagedAt">>;
  pods: Lifepod[]; noiseObjs?: NoiseObj[]; o2Start: number; dialogue: DialogueCue[];
}
interface CutscenePanel { text: string; speaker: string; art: string; badge?: string }

type GameState = "MENU" | "PLAYING" | "CUTSCENE" | "CHOICE" | "ENDING_A" | "ENDING_B" | "GAME_OVER" | "LEVEL_TRANSITION";

// ============================================================
// AUDIO
// ============================================================
class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    this.startOcean();
  }
  resume() { this.ctx?.resume(); }

  private startOcean() {
    if (!this.ctx || !this.master) return;
    const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator(), lfoG = this.ctx.createGain();
    const g = this.ctx.createGain(); g.gain.value = 0.1;
    o1.type = "sine"; o1.frequency.value = 38;
    o2.type = "sine"; o2.frequency.value = 52;
    lfo.type = "sine"; lfo.frequency.value = 0.07; lfoG.gain.value = 6;
    lfo.connect(lfoG); lfoG.connect(o1.frequency); lfoG.connect(o2.frequency);
    o1.connect(g); o2.connect(g); g.connect(this.master);
    o1.start(); o2.start(); lfo.start();
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 3, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.22;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const flt = this.ctx.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 160;
    const ng = this.ctx.createGain(); ng.gain.value = 0.035;
    src.connect(flt); flt.connect(ng); ng.connect(this.master); src.start();
    // Water movement — slow LFO-modulated bandpass resonance (gentle whooshing current)
    const waterNoiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 8, this.ctx.sampleRate);
    const wd = waterNoiseBuf.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = (Math.random() * 2 - 1);
    const waterSrc = this.ctx.createBufferSource(); waterSrc.buffer = waterNoiseBuf; waterSrc.loop = true;
    const waterFlt = this.ctx.createBiquadFilter(); waterFlt.type = "bandpass"; waterFlt.frequency.value = 280; waterFlt.Q.value = 0.6;
    const waterLfo = this.ctx.createOscillator(); waterLfo.type = "sine"; waterLfo.frequency.value = 0.04;
    const waterLfoG = this.ctx.createGain(); waterLfoG.gain.value = 90;
    waterLfo.connect(waterLfoG); waterLfoG.connect(waterFlt.frequency);
    const waterG = this.ctx.createGain(); waterG.gain.value = 0.022;
    waterSrc.connect(waterFlt); waterFlt.connect(waterG); waterG.connect(this.master);
    waterSrc.start(); waterLfo.start();
    // Distant pressure drone — very low sub-bass rumble (hull under pressure)
    const drone = this.ctx.createOscillator(); drone.type = "sine"; drone.frequency.value = 22;
    const droneLfo = this.ctx.createOscillator(); droneLfo.type = "sine"; droneLfo.frequency.value = 0.021;
    const droneLfoG = this.ctx.createGain(); droneLfoG.gain.value = 3;
    droneLfo.connect(droneLfoG); droneLfoG.connect(drone.frequency);
    const droneG = this.ctx.createGain(); droneG.gain.value = 0.055;
    drone.connect(droneG); droneG.connect(this.master);
    drone.start(); droneLfo.start();
    // Schedule random ambient hull creaks in the background
    this.scheduleAmbientCreak();
  }

  // Ambient creak gain — always-on low volume, independent of depth
  private ambientCreakGain: GainNode | null = null;
  private ambientCreakTimer: ReturnType<typeof setTimeout> | null = null;

  private getAmbientCreakGain(): GainNode {
    if (!this.ambientCreakGain && this.ctx && this.master) {
      this.ambientCreakGain = this.ctx.createGain();
      this.ambientCreakGain.gain.value = 0.18;
      this.ambientCreakGain.connect(this.master);
    }
    return this.ambientCreakGain!;
  }

  stopAmbientCreaks() {
    if (this.ambientCreakTimer !== null) {
      clearTimeout(this.ambientCreakTimer);
      this.ambientCreakTimer = null;
    }
  }

  private scheduleAmbientCreak() {
    if (!this.ctx) return;
    // Random interval 7–22 s between ambient hull sounds
    const delay = 7000 + Math.random() * 15000;
    this.ambientCreakTimer = setTimeout(() => {
      this.ambientCreakTimer = null;
      if (!this.ctx || !this.master) return;
      const roll = Math.random();
      if (roll < 0.55) {
        this.ambientHullGroan();
      } else if (roll < 0.85) {
        this.ambientHullCreak();
      } else {
        // Distant sonar echo — ghostly ping heard through the hull
        this.ambientDistantPing();
      }
      this.scheduleAmbientCreak();
    }, delay);
  }

  private ambientHullGroan() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const g = this.getAmbientCreakGain();
    const t0 = ctx.currentTime;
    const dur = 1.8 + Math.random() * 1.6;
    const centers = [68, 125, 260].map(f => f * (0.78 + Math.random() * 0.44));
    for (const fc of centers) {
      const bufLen = Math.ceil(ctx.sampleRate * dur);
      const nb = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = nb;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = fc; bp.Q.value = 10 + Math.random() * 9;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.32, t0 + dur * 0.3);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(bp); bp.connect(env); env.connect(g);
      src.start(t0); src.stop(t0 + dur);
      src.onended = () => { try { src.disconnect(); bp.disconnect(); env.disconnect(); } catch { /* gone */ } };
    }
  }

  private ambientHullCreak() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const g = this.getAmbientCreakGain();
    const t0 = ctx.currentTime;
    const dur = 0.28 + Math.random() * 0.32;
    const fc = 160 + Math.random() * 200;
    const bufLen = Math.ceil(ctx.sampleRate * dur);
    const nb = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = nb;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = fc; bp.Q.value = 18 + Math.random() * 12;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.45, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(bp); bp.connect(env); env.connect(g);
    src.start(t0); src.stop(t0 + dur);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); env.disconnect(); } catch { /* gone */ } };
  }

  private ambientDistantPing() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const g = this.getAmbientCreakGain();
    const t0 = ctx.currentTime;
    const freq = 620 + Math.random() * 280;
    const dur = 1.4;
    const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.07, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    // Heavy lowpass — muffled, heard-through-hull quality
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
    osc.connect(lp); lp.connect(env); env.connect(g);
    osc.start(t0); osc.stop(t0 + dur);
    osc.onended = () => { try { osc.disconnect(); lp.disconnect(); env.disconnect(); } catch { /* gone */ } };
  }
  startBreathing() {
    if (!this.ctx || !this.master) return;
    const g = this.ctx.createGain(); g.gain.value = 0;
    const osc = this.ctx.createOscillator();
    const flt = this.ctx.createBiquadFilter(); flt.type = "bandpass"; flt.frequency.value = 340; flt.Q.value = 2;
    osc.type = "sawtooth"; osc.frequency.value = 52;
    osc.connect(flt); flt.connect(g); g.connect(this.master); osc.start();
    const breathe = () => {
      if (!this.ctx || !g) return;
      const t = this.ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 2);
      g.gain.linearRampToValueAtTime(0, t + 4.5);
    };
    breathe(); setInterval(breathe, 4500);
  }
  sonar(type: "small" | "large") {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const freq = type === "small" ? 1100 : 780;
    const dur = type === "small" ? 0.55 : 1.4;

    // Transient click — sharp metallic tap (the emitter pulse)
    const clickBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.06), ctx.sampleRate);
    const cd = clickBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
    const clickSrc = ctx.createBufferSource(); clickSrc.buffer = clickBuf;
    const clickFlt = ctx.createBiquadFilter(); clickFlt.type = "highpass"; clickFlt.frequency.value = 800;
    const clickG = ctx.createGain(); clickG.gain.value = type === "small" ? 0.28 : 0.38;
    clickSrc.connect(clickFlt); clickFlt.connect(clickG); clickG.connect(this.master);
    clickSrc.start(t0);

    // Main ping tone — frequency sweep (existing behaviour, kept)
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.28, t0 + dur);
    g.gain.setValueAtTime(0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g); g.connect(this.master); osc.start(t0); osc.stop(t0 + dur);

    // Echo — delayed repeat at lower volume (underwater reflection)
    const echoDelay = type === "small" ? 0.38 : 0.65;
    const echoOsc = ctx.createOscillator(), echoG = ctx.createGain();
    const echoLp = ctx.createBiquadFilter(); echoLp.type = "lowpass"; echoLp.frequency.value = 700;
    echoOsc.type = "sine";
    echoOsc.frequency.setValueAtTime(freq * 0.96, t0 + echoDelay);
    echoOsc.frequency.exponentialRampToValueAtTime(freq * 0.18, t0 + echoDelay + dur * 0.7);
    echoG.gain.setValueAtTime(0, t0);
    echoG.gain.setValueAtTime(0.14, t0 + echoDelay);
    echoG.gain.exponentialRampToValueAtTime(0.001, t0 + echoDelay + dur * 0.7);
    echoOsc.connect(echoLp); echoLp.connect(echoG); echoG.connect(this.master);
    echoOsc.start(t0); echoOsc.stop(t0 + echoDelay + dur * 0.7 + 0.05);
    echoOsc.onended = () => { try { echoOsc.disconnect(); echoLp.disconnect(); echoG.disconnect(); } catch { /* gone */ } };
  }
  damage() {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.type = "sawtooth"; osc.frequency.value = 75;
    g.gain.setValueAtTime(0.5, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.9);
    osc.connect(g); g.connect(this.master); osc.start(); osc.stop(this.ctx.currentTime + 0.9);
  }
  dock() {
    if (!this.ctx || !this.master) return;
    [440, 554, 660].forEach((f, i) => {
      const osc = this.ctx!.createOscillator(), g = this.ctx!.createGain();
      const t = this.ctx!.currentTime + i * 0.14;
      osc.frequency.value = f; osc.type = "sine";
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.28, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(g); g.connect(this.master!); osc.start(t); osc.stop(t + 0.6);
    });
  }
  alarm() {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.type = "square"; osc.frequency.value = 880;
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.16, t); g.gain.setValueAtTime(0, t + 0.12);
    g.gain.setValueAtTime(0.16, t + 0.24); g.gain.setValueAtTime(0, t + 0.36);
    osc.connect(g); g.connect(this.master); osc.start(); osc.stop(t + 0.5);
  }
  flare() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    // Thud — short low-freq impact burst (the launch mechanism firing)
    const thudBufLen = Math.ceil(ctx.sampleRate * 0.18);
    const thudBuf = ctx.createBuffer(1, thudBufLen, ctx.sampleRate);
    const td = thudBuf.getChannelData(0);
    for (let i = 0; i < td.length; i++) td[i] = (Math.random() * 2 - 1);
    const thudSrc = ctx.createBufferSource(); thudSrc.buffer = thudBuf;
    const thudLp = ctx.createBiquadFilter(); thudLp.type = "lowpass"; thudLp.frequency.value = 180;
    const thudG = ctx.createGain();
    thudG.gain.setValueAtTime(0.52, t0);
    thudG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    thudSrc.connect(thudLp); thudLp.connect(thudG); thudG.connect(this.master);
    thudSrc.start(t0);
    thudSrc.onended = () => { try { thudSrc.disconnect(); thudLp.disconnect(); thudG.disconnect(); } catch { /* gone */ } };

    // Sub-bass thud oscillator underneath (deep hull knock)
    const thudOsc = ctx.createOscillator(); thudOsc.type = "sine"; thudOsc.frequency.value = 55;
    const thudOscG = ctx.createGain();
    thudOscG.gain.setValueAtTime(0.45, t0);
    thudOscG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    thudOsc.connect(thudOscG); thudOscG.connect(this.master);
    thudOsc.start(t0); thudOsc.stop(t0 + 0.22);
    thudOsc.onended = () => { try { thudOsc.disconnect(); thudOscG.disconnect(); } catch { /* gone */ } };

    // Whoosh — filtered noise with upward frequency sweep (flare accelerating through water)
    const whooshLen = Math.ceil(ctx.sampleRate * 0.55);
    const whooshBuf = ctx.createBuffer(1, whooshLen, ctx.sampleRate);
    const wd = whooshBuf.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = (Math.random() * 2 - 1);
    const whooshSrc = ctx.createBufferSource(); whooshSrc.buffer = whooshBuf;
    const whooshFlt = ctx.createBiquadFilter(); whooshFlt.type = "bandpass"; whooshFlt.Q.value = 1.2;
    whooshFlt.frequency.setValueAtTime(220, t0 + 0.04);
    whooshFlt.frequency.exponentialRampToValueAtTime(1800, t0 + 0.5);
    const whooshG = ctx.createGain();
    whooshG.gain.setValueAtTime(0, t0);
    whooshG.gain.linearRampToValueAtTime(0.32, t0 + 0.06);
    whooshG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    whooshSrc.connect(whooshFlt); whooshFlt.connect(whooshG); whooshG.connect(this.master);
    whooshSrc.start(t0 + 0.04);
    whooshSrc.onended = () => { try { whooshSrc.disconnect(); whooshFlt.disconnect(); whooshG.disconnect(); } catch { /* gone */ } };
  }

  // Metallic impact sound — sharp transient clang, low-pass filtered for underwater quality
  impact(severity: "graze" | "direct") {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const hard = severity === "direct";

    // Sharp transient click — the moment of impact
    const clickLen = Math.ceil(ctx.sampleRate * 0.05);
    const clickBuf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
    const cd = clickBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) {
      cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.007));
    }
    const clickSrc = ctx.createBufferSource(); clickSrc.buffer = clickBuf;
    const clickHp = ctx.createBiquadFilter(); clickHp.type = "highpass"; clickHp.frequency.value = 500;
    const clickG = ctx.createGain(); clickG.gain.value = hard ? 0.55 : 0.30;
    clickSrc.connect(clickHp); clickHp.connect(clickG); clickG.connect(this.master);
    clickSrc.start(t0);
    clickSrc.onended = () => { try { clickSrc.disconnect(); clickHp.disconnect(); clickG.disconnect(); } catch { /* gone */ } };

    // Sub-bass body — low-pass noise burst (hull mass resonance)
    const thudLen = Math.ceil(ctx.sampleRate * (hard ? 0.32 : 0.18));
    const thudBuf = ctx.createBuffer(1, thudLen, ctx.sampleRate);
    const td = thudBuf.getChannelData(0);
    for (let i = 0; i < td.length; i++) td[i] = Math.random() * 2 - 1;
    const thudSrc = ctx.createBufferSource(); thudSrc.buffer = thudBuf;
    const thudLp = ctx.createBiquadFilter(); thudLp.type = "lowpass"; thudLp.frequency.value = hard ? 260 : 180;
    const thudG = ctx.createGain();
    thudG.gain.setValueAtTime(hard ? 0.65 : 0.32, t0);
    thudG.gain.exponentialRampToValueAtTime(0.001, t0 + (hard ? 0.32 : 0.18));
    thudSrc.connect(thudLp); thudLp.connect(thudG); thudG.connect(this.master);
    thudSrc.start(t0);
    thudSrc.onended = () => { try { thudSrc.disconnect(); thudLp.disconnect(); thudG.disconnect(); } catch { /* gone */ } };

    // Metallic ring — bandpass-filtered oscillator with quick decay
    const ringOsc = ctx.createOscillator();
    ringOsc.type = "triangle";
    const ringFreq = hard ? 155 : 210;
    ringOsc.frequency.value = ringFreq;
    const ringBp = ctx.createBiquadFilter(); ringBp.type = "bandpass"; ringBp.frequency.value = ringFreq; ringBp.Q.value = 7;
    const ringG = ctx.createGain();
    const ringDur = hard ? 0.48 : 0.26;
    ringG.gain.setValueAtTime(hard ? 0.28 : 0.14, t0 + 0.01);
    ringG.gain.exponentialRampToValueAtTime(0.001, t0 + ringDur);
    ringOsc.connect(ringBp); ringBp.connect(ringG); ringG.connect(this.master);
    ringOsc.start(t0); ringOsc.stop(t0 + ringDur);
    ringOsc.onended = () => { try { ringOsc.disconnect(); ringBp.disconnect(); ringG.disconnect(); } catch { /* gone */ } };
  }

  // Hull danger sting — sharp alarm cluster triggered once when hull enters red zone
  hullDangerSting() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const master = this.master;
    const t0 = ctx.currentTime;

    // Low sub-bass warning pulse
    const subOsc = ctx.createOscillator(); subOsc.type = "sine"; subOsc.frequency.value = 48;
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0, t0);
    subG.gain.linearRampToValueAtTime(0.38, t0 + 0.05);
    subG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);
    subOsc.connect(subG); subG.connect(master);
    subOsc.start(t0); subOsc.stop(t0 + 0.7);

    // Tritone descending alarm — three staggered tones (tense, unresolved)
    const alarmFreqs = [523, 370, 262];  // C5 → F#4 → C4 tritone descent
    alarmFreqs.forEach((freq, i) => {
      const osc = ctx.createOscillator(); osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, t0 + i * 0.09);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.82, t0 + i * 0.09 + 0.55);
      const flt = ctx.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + i * 0.09);
      g.gain.linearRampToValueAtTime(0.22, t0 + i * 0.09 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.09 + 0.6);
      osc.connect(flt); flt.connect(g); g.connect(master);
      osc.start(t0 + i * 0.09); osc.stop(t0 + i * 0.09 + 0.65);
      osc.onended = () => { try { osc.disconnect(); flt.disconnect(); g.disconnect(); } catch { /* gone */ } };
    });

    // Metallic creak accent — filtered noise burst (hull under stress)
    const crackLen = Math.ceil(ctx.sampleRate * 0.35);
    const crackBuf = ctx.createBuffer(1, crackLen, ctx.sampleRate);
    const nd = crackBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const crackSrc = ctx.createBufferSource(); crackSrc.buffer = crackBuf;
    const crackBp = ctx.createBiquadFilter(); crackBp.type = "bandpass"; crackBp.frequency.value = 380; crackBp.Q.value = 8;
    const crackG = ctx.createGain();
    crackG.gain.setValueAtTime(0.3, t0 + 0.18);
    crackG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    crackSrc.connect(crackBp); crackBp.connect(crackG); crackG.connect(master);
    crackSrc.start(t0 + 0.18);
    crackSrc.onended = () => { try { crackSrc.disconnect(); crackBp.disconnect(); crackG.disconnect(); } catch { /* gone */ } };
  }
  // ----- LEVIATHAN ROAR — deep guttural growl with FM modulation, sub-bass & noise -----
  leviathanRoar(intensity: 1 | 2 = 1) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const dur = intensity === 2 ? 2.6 : 1.8;
    const peak = intensity === 2 ? 0.55 : 0.42;

    // Envelope (slow attack, long body, slow tail)
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t0);
    out.gain.linearRampToValueAtTime(peak, t0 + 0.25);
    out.gain.linearRampToValueAtTime(peak * 0.85, t0 + dur * 0.55);
    out.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    // Lowpass to keep it muffled & underwater
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    lp.Q.value = 1.2;
    out.connect(lp); lp.connect(this.master);

    // 1) Sub-bass fundamental — slow downward sweep (the "growl")
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(70, t0);
    sub.frequency.exponentialRampToValueAtTime(38, t0 + dur);
    const subG = ctx.createGain(); subG.gain.value = 0.55;
    sub.connect(subG); subG.connect(out);
    sub.start(t0); sub.stop(t0 + dur);

    // 2) Sawtooth growl — adds harmonic grit; FM-modulated for snarl
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(90, t0);
    saw.frequency.exponentialRampToValueAtTime(48, t0 + dur);
    const lfo = ctx.createOscillator();
    lfo.type = "sine"; lfo.frequency.value = 7.5;
    const lfoG = ctx.createGain(); lfoG.gain.value = 18;
    lfo.connect(lfoG); lfoG.connect(saw.frequency);
    const sawG = ctx.createGain(); sawG.gain.value = 0.32;
    saw.connect(sawG); sawG.connect(out);
    saw.start(t0); saw.stop(t0 + dur);
    lfo.start(t0); lfo.stop(t0 + dur);

    // 3) Mid-range harmonic — gives it a "voice"
    const mid = ctx.createOscillator();
    mid.type = "triangle";
    mid.frequency.setValueAtTime(180, t0);
    mid.frequency.exponentialRampToValueAtTime(95, t0 + dur);
    const midG = ctx.createGain(); midG.gain.value = 0.18;
    mid.connect(midG); midG.connect(out);
    mid.start(t0); mid.stop(t0 + dur);

    // 4) Filtered noise — breath & gravel
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.6;
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuf;
    const nFilt = ctx.createBiquadFilter();
    nFilt.type = "bandpass"; nFilt.frequency.value = 220; nFilt.Q.value = 0.8;
    const nG = ctx.createGain(); nG.gain.value = 0.28;
    noise.connect(nFilt); nFilt.connect(nG); nG.connect(out);
    noise.start(t0); noise.stop(t0 + dur);

    // Clean up the entire node graph once the longest source ends — prevents accumulation over long play sessions
    noise.onended = () => {
      try {
        sub.disconnect(); subG.disconnect();
        saw.disconnect(); sawG.disconnect();
        lfo.disconnect(); lfoG.disconnect();
        mid.disconnect(); midG.disconnect();
        noise.disconnect(); nFilt.disconnect(); nG.disconnect();
        out.disconnect(); lp.disconnect();
      } catch { /* nodes already disconnected */ }
    };
  }

  metallicScreech(delay = 0) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime + delay;
    const dur = 0.38;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.055));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1800;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.45, t0); env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(hp); hp.connect(bp); bp.connect(env); env.connect(this.master);
    src.start(t0);
    src.onended = () => { try { src.disconnect(); hp.disconnect(); bp.disconnect(); env.disconnect(); } catch { /**/ } };
  }

  wallEcho(layered: boolean, delay = 0) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime + delay;
    const echoCount = layered ? 3 : 1;
    for (let e = 0; e < echoCount; e++) {
      const tE = t0 + e * 0.28;
      const freq = 680 + e * 90;
      const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = freq;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 800 - e * 120;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, tE);
      env.gain.setValueAtTime(0.10 / (e + 1), tE + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, tE + 0.65);
      osc.connect(lp); lp.connect(env); env.connect(this.master);
      osc.start(tE); osc.stop(tE + 0.7);
      osc.onended = () => { try { osc.disconnect(); lp.disconnect(); env.disconnect(); } catch { /**/ } };
    }
  }

  flatline() {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 440; g.gain.value = 0.26;
    osc.connect(g); g.connect(this.master); osc.start(); osc.stop(this.ctx.currentTime + 4);
  }

  // ----- HULL STRESS — procedural metallic groaning & creaking from deep-sea pressure -----
  private hullStressGain: GainNode | null = null;

  initHullStress() {
    if (!this.ctx || !this.master || this.hullStressGain) return;
    this.hullStressGain = this.ctx.createGain();
    this.hullStressGain.gain.value = 0;
    this.hullStressGain.connect(this.master);
  }

  setHullStressDepthGain(depthNorm: number) {
    if (!this.ctx || !this.hullStressGain) return;
    // Ramp up gain as depth increases (silent at surface, full at abyss)
    const target = Math.max(0, Math.min(1, (depthNorm - 0.25) / 0.65)) * 0.65;
    this.hullStressGain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 2.0);
  }

  // Groan — slow attack resonant metallic sound for depth-triggered stress
  hullGroan() {
    if (!this.ctx || !this.hullStressGain) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const dur = 1.6 + Math.random() * 1.4;
    // Three resonant bandpass filters at 80, 140, 320 Hz (with organic random offset)
    const centers = [80, 140, 320].map(f => f * (0.82 + Math.random() * 0.36));
    for (const fc of centers) {
      const bufLen = Math.ceil(ctx.sampleRate * dur);
      const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = fc;
      bp.Q.value = 9 + Math.random() * 8;
      // Slow attack, medium release envelope
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.38, t0 + dur * 0.38);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(bp); bp.connect(env); env.connect(this.hullStressGain);
      src.start(t0); src.stop(t0 + dur);
      src.onended = () => {
        try { src.disconnect(); bp.disconnect(); env.disconnect(); } catch { /* already gone */ }
      };
    }
  }

  // Creak — short sharp stress pop for sharp-turn trigger (faster envelope)
  hullCreak() {
    if (!this.ctx || !this.hullStressGain) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const dur = 0.35 + Math.random() * 0.25;
    const fc = 140 + Math.random() * 180;
    const bufLen = Math.ceil(ctx.sampleRate * dur);
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = fc;
    bp.Q.value = 14 + Math.random() * 10;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.55, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(bp); bp.connect(env); env.connect(this.hullStressGain);
    src.start(t0); src.stop(t0 + dur);
    src.onended = () => {
      try { src.disconnect(); bp.disconnect(); env.disconnect(); } catch { /* already gone */ }
    };
  }
  speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (typeof SpeechSynthesisUtterance === "undefined") return;
    // Strip bracketed tags first ([COMM], [HULL BREACH], etc.)
    const noBrackets = text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
    if (!noBrackets) return;
    let voice: "elias" | "narrator" | "child" | "doctor" = "narrator";
    let speakText = noBrackets;
    // Case-insensitive speaker prefix (handles "Elias: ...", "ELIAS: ...", "Liam: ...", etc.)
    const m = noBrackets.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
    if (m) {
      const sp = m[1].toUpperCase();
      // Strip surrounding quotes (straight or curly) and trailing/leading spaces
      speakText = m[2].replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, "").trim();
      if (sp === "ELIAS") voice = "elias";
      else if (sp === "LIAM" || sp === "MIA" || sp === "NOAH" || sp === "SARA") voice = "child";
      else if (sp === "DOCTOR") voice = "doctor";
    }
    if (!speakText) return;
    try {
      const utter = new SpeechSynthesisUtterance(speakText);
      utter.rate = voice === "narrator" ? 0.78 : 0.88;
      utter.pitch = voice === "child" ? 1.55 : voice === "narrator" ? 0.7 : voice === "doctor" ? 0.78 : 0.85;
      utter.volume = 0.7;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch { /* ignore — partial-support browsers */ }
  }
}

// ============================================================
// LEVEL DATA
// ============================================================
function level1(): LevelData {
  const obs: Rect[] = [
    { x: 0, y: 0, w: 800, h: 50 }, { x: 0, y: 2950, w: 800, h: 50 },
    { x: 0, y: 50, w: 50, h: 2900 }, { x: 750, y: 50, w: 50, h: 2900 },
    { x: 50, y: 50, w: 260, h: 830 }, { x: 50, y: 1080, w: 260, h: 620 },
    { x: 50, y: 1820, w: 260, h: 1130 },
    { x: 490, y: 50, w: 260, h: 1330 }, { x: 490, y: 1580, w: 260, h: 1370 },
    { x: 50, y: 880, w: 130, h: 40 }, { x: 50, y: 1040, w: 130, h: 40 },
    { x: 620, y: 1380, w: 130, h: 40 }, { x: 620, y: 1540, w: 130, h: 40 },
    { x: 310, y: 1700, w: 55, h: 100 }, { x: 435, y: 1720, w: 55, h: 80 },
    { x: 330, y: 2280, w: 55, h: 45 }, { x: 410, y: 2240, w: 70, h: 35 },
    { x: 355, y: 2360, w: 40, h: 75 }, { x: 430, y: 2370, w: 50, h: 55 },
    { x: 310, y: 2460, w: 30, h: 60 }, { x: 460, y: 2440, w: 30, h: 50 },
    { x: 330, y: 480, w: 28, h: 22 }, { x: 440, y: 1100, w: 22, h: 28 },
    { x: 370, y: 2050, w: 30, h: 20 }, { x: 420, y: 650, w: 20, h: 30 },
  ];
  return {
    id: 1, name: "LEVEL I — THE DESCENT", worldW: 800, worldH: 3000,
    playerStart: { x: 400, y: 160 },
    obstacles: obs,
    enemyDefs: [{
      x: 400, y: 1300, type: "drifter",
      waypoints: [{ x: 400, y: 1000 }, { x: 400, y: 1700 }, { x: 370, y: 1350 }, { x: 430, y: 1350 }],
      wpIdx: 0, speed: 38, hitR: 32,
    }],
    pods: [{ x: 400, y: 2800, id: "sara", rescued: false, revealTimer: 0, character: "SARA", commsLine: '"...is someone there?... please..."' }],
    o2Start: 100,
    dialogue: [
      { time: 1.5, text: "Click to emit sonar. Hold 1s for large ping. Use WASD to move." },
      { time: 9, text: 'Elias: "Rescue mission CREST-7. Descending to sector nine."' },
      { time: 22, text: 'Elias: "Oxygen nominal. Keeping the acoustic signature low."' },
      { time: 48, text: 'Elias: "Signal. Something survived down here."' },
    ],
  };
}
function level2(): LevelData {
  const obs: Rect[] = [
    { x: 0, y: 0, w: 2000, h: 55 }, { x: 0, y: 1345, w: 2000, h: 55 },
    { x: 0, y: 55, w: 55, h: 1290 }, { x: 1945, y: 55, w: 55, h: 1290 },
    { x: 420, y: 55, w: 45, h: 345 }, { x: 420, y: 600, w: 45, h: 300 }, { x: 420, y: 1100, w: 45, h: 245 },
    { x: 55, y: 510, w: 145, h: 38 }, { x: 280, y: 510, w: 90, h: 38 },
    { x: 820, y: 55, w: 45, h: 145 }, { x: 820, y: 400, w: 45, h: 350 }, { x: 820, y: 950, w: 45, h: 395 },
    { x: 1040, y: 620, w: 38, h: 400 }, { x: 1220, y: 620, w: 38, h: 400 },
    { x: 1078, y: 620, w: 142, h: 38 }, { x: 1078, y: 982, w: 142, h: 38 },
    { x: 1440, y: 55, w: 45, h: 255 }, { x: 1440, y: 530, w: 45, h: 290 }, { x: 1440, y: 1040, w: 45, h: 305 },
    { x: 55, y: 820, w: 220, h: 38 }, { x: 1510, y: 280, w: 435, h: 38 },
    { x: 1600, y: 900, w: 345, h: 38 }, { x: 1620, y: 1060, w: 325, h: 38 }, { x: 1620, y: 1180, w: 325, h: 38 },
    { x: 580, y: 200, w: 180, h: 45 }, { x: 900, y: 1050, w: 120, h: 45 },
    { x: 1120, y: 200, w: 45, h: 260 }, { x: 640, y: 780, w: 30, h: 30 }, { x: 1300, y: 500, w: 25, h: 35 },
  ];
  return {
    id: 2, name: "LEVEL II — THE PRESSURE ZONE", worldW: 2000, worldH: 1400,
    playerStart: { x: 160, y: 200 },
    obstacles: obs,
    enemyDefs: [
      { x: 580, y: 220, type: "stalker", waypoints: [{ x: 160, y: 220 }, { x: 760, y: 220 }, { x: 760, y: 460 }, { x: 160, y: 460 }], wpIdx: 0, speed: 62, hitR: 26 },
      { x: 1130, y: 820, type: "stalker", waypoints: [{ x: 1085, y: 720 }, { x: 1175, y: 720 }, { x: 1175, y: 940 }, { x: 1085, y: 940 }], wpIdx: 0, speed: 54, hitR: 26 },
    ],
    pods: [{ x: 1870, y: 1240, id: "noah", rescued: false, revealTimer: 0, character: "NOAH", commsLine: '"Dad? ...Dad, is that you?"' }],
    noiseObjs: [
      { x: 1098, y: 720, id: "n1", silenced: false, noiseRate: 8, revealTimer: 0 },
      { x: 1180, y: 790, id: "n2", silenced: false, noiseRate: 6, revealTimer: 0 },
      { x: 1130, y: 880, id: "n3", silenced: false, noiseRate: 10, revealTimer: 0 },
    ],
    o2Start: 100,
    dialogue: [
      { time: 3, text: 'Elias: "Pressure at 6,000 meters. Hull integrity holding."' },
      { time: 16, text: 'Elias: "Multiple life signals. Moving carefully."' },
      { time: 32, text: 'Elias: "I can hear something. Mechanical. Rhythmic."' },
      { time: 58, text: 'Elias: "Signal stronger. He\'s close. He has to be."' },
    ],
  };
}
function level3(): LevelData {
  const obs: Rect[] = [
    { x: 0, y: 0, w: 2400, h: 55 }, { x: 0, y: 1345, w: 2400, h: 55 },
    { x: 0, y: 55, w: 55, h: 1290 }, { x: 2345, y: 55, w: 55, h: 1290 },
    { x: 55, y: 55, w: 65, h: 545 }, { x: 55, y: 760, w: 65, h: 585 },
    { x: 950, y: 180, w: 85, h: 210 }, { x: 1150, y: 820, w: 105, h: 155 },
    { x: 1450, y: 260, w: 75, h: 195 }, { x: 1640, y: 720, w: 95, h: 125 },
    { x: 1320, y: 1020, w: 125, h: 105 }, { x: 780, y: 920, w: 55, h: 80 },
    { x: 680, y: 480, w: 50, h: 65 }, { x: 1780, y: 480, w: 55, h: 80 },
    { x: 2040, y: 920, w: 65, h: 50 }, { x: 2120, y: 380, w: 75, h: 60 },
    { x: 1870, y: 700, w: 40, h: 90 },
    { x: 380, y: 55, w: 55, h: 130 }, { x: 700, y: 55, w: 35, h: 105 },
    { x: 1100, y: 55, w: 60, h: 95 }, { x: 1720, y: 55, w: 45, h: 140 },
    { x: 2020, y: 55, w: 55, h: 85 }, { x: 340, y: 1215, w: 65, h: 130 },
    { x: 820, y: 1250, w: 45, h: 95 }, { x: 1220, y: 1230, w: 70, h: 115 },
    { x: 1920, y: 1260, w: 55, h: 85 },
  ];
  return {
    id: 3, name: "LEVEL III — THE ABYSS", worldW: 2400, worldH: 1400,
    playerStart: { x: 150, y: 700 },
    obstacles: obs,
    enemyDefs: [{
      x: 1200, y: 700, type: "leviathan",
      waypoints: [
        { x: 1200, y: 280 }, { x: 1820, y: 360 }, { x: 2100, y: 700 }, { x: 1820, y: 1040 },
        { x: 1200, y: 1120 }, { x: 580, y: 1040 }, { x: 360, y: 700 }, { x: 580, y: 360 }, { x: 1200, y: 280 },
      ],
      wpIdx: 0, speed: 32, hitR: 85,
    }],
    pods: [
      { x: 720, y: 700, id: "liam", rescued: false, revealTimer: 0, character: "LIAM", commsLine: '"It\'s dark. I don\'t like the dark."' },
      { x: 1960, y: 700, id: "mia", rescued: false, revealTimer: 0, character: "MIA", commsLine: '"The fishies are sleeping. Are you sleeping too?"' },
    ],
    o2Start: 68,
    dialogue: [
      { time: 2, text: 'LIAM [COMM]: "It\'s dark. I don\'t like the dark."' },
      { time: 7, text: 'MIA [COMM]: "The fishies are sleeping. Are you sleeping too?"' },
      { time: 16, text: 'Elias: "Two signals. Both alive. O2 at 20%. I have to choose."' },
      { time: 28, text: 'Elias: "Something massive is circling. Keeping the noise down."' },
    ],
  };
}

// ============================================================
// CUTSCENE DATA
// ============================================================
const CS1: CutscenePanel[] = [
  { text: "The ocean is silent.\nThe pressure builds.\nSix thousand meters and descending.", speaker: "NARRATOR", art: "ocean" },
  { text: '"Survivor located. Beginning dock sequence."\n\nHer vital signs are faint.\nBut she is breathing.', speaker: "ELIAS", art: "ocean", badge: "[ SARA — RESCUED ]" },
  { text: "A memory — unasked for:\nA boat. Afternoon light.\nA family laughing.\n\nHis hand reaches toward someone—\n\nThe image cuts to black.", speaker: "NARRATOR", art: "crack" },
  { text: '"I found one."\n\nStatic.\n\n"I\'ll find the rest."', speaker: "ELIAS", art: "crack" },
];
const CS2: CutscenePanel[] = [
  { text: "The debris field groans.\nMetal against stone.\nHe is somewhere behind it.", speaker: "NARRATOR", art: "deep" },
  { text: "A child's drawing, remembered:\nA submarine, in blue crayon.\nTwo words beneath it:\n\n\"DAD COME HOME\"", speaker: "NARRATOR", art: "crack" },
  { text: "The image cracks.\nLike glass.\nLike something that was never whole\nbut held together anyway.", speaker: "NARRATOR", art: "crack" },
  { text: '"You\'re safe now."\n\nHis voice catches.\nJust for a moment.\nHe clears his throat.\n\n"I\'ve got you."', speaker: "ELIAS", art: "deep", badge: "[ NOAH — RESCUED ]" },
];
const END_A: CutscenePanel[] = [
  { text: "One pod docked.\nOne pod's light goes dark.\n\nHe made his choice.\nHe begins the ascent.", speaker: "NARRATOR", art: "deep" },
  { text: "The ocean dissolves.\nThe wireframes collapse.\n\nA hospital room forms\nin the silence.", speaker: "NARRATOR", art: "hospital" },
  { text: '"His brain activity just spiked."\n\nA pause.\n\n"Then flatlined."', speaker: "DOCTOR", art: "hospital" },
  { text: "A newspaper clipping:\n\n\"MAN, 38, REMAINS IN COMA AFTER BOATING ACCIDENT\nFAMILY OF FOUR PERISHED. PRONOUNCED BRAIN-DEAD TODAY.\"\n\nThe date is ten years ago.", speaker: "NARRATOR", art: "news" },
  { text: "He saved one.\n\nIn his mind,\nthat was enough\nto finally let go.", speaker: "NARRATOR", art: "news" },
];
const END_B: CutscenePanel[] = [
  { text: "He reroutes the oxygen.\n\nThe HUD flickers red.\nHis vision blurs at the edges.", speaker: "NARRATOR", art: "deep" },
  { text: "Both pods lock in.\n\nChildren's voices —\ndistorted, dreamy:\n\n\"...Dad?\"", speaker: "NARRATOR", art: "deep" },
  { text: "The wireframe ocean\ndissolves into white.\n\nEverything\ndissolves into white.", speaker: "NARRATOR", art: "hospital" },
  { text: "A heart monitor flatlines.\n\nThe nurse gasps.\n\nThen:\n\nSilence.", speaker: "NARRATOR", art: "hospital" },
  { text: "In a child's bedroom:\nthe same clipping, pinned to a corkboard.\n\nTwo crayon drawings beside it.\nTwo submarines.\nTwo stick figures inside.", speaker: "NARRATOR", art: "news" },
  { text: "He saved them all.\n\nEven if only in the place\nthat mattered.", speaker: "NARRATOR", art: "news" },
];

// ============================================================
// 3D GEOMETRY BUILDERS
// ============================================================
function wireMat(hexColor: number, opacity = 0): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: hexColor, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

function envMat(hexColor: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: hexColor,
    roughness,
    metalness: 0.05,
  });
}

function buildObstacleMesh(rect: Rect, color: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(rect.w * WS, WALL_H, rect.h * WS);
  const mat = envMat(color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((rect.x + rect.w / 2) * WS, WALL_H / 2, (rect.y + rect.h / 2) * WS);
  return mesh;
}

function buildFloorMesh(cx2d: number, cy2d: number, cellW: number, cellH: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(cellW * WS, cellH * WS);
  const mat = envMat(0x0a1622, 0.95);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx2d * WS, 0.02, cy2d * WS);
  return mesh;
}

function buildCeilMesh(cx2d: number, cy2d: number, cellW: number, cellH: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(cellW * WS, cellH * WS);
  const mat = envMat(0x05101a, 0.95);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(cx2d * WS, WALL_H - 0.02, cy2d * WS);
  return mesh;
}

function buildStalactiteMesh(x3d: number, z3d: number, onFloor: boolean, height: number): THREE.Mesh {
  const r = 0.1 + Math.random() * 0.15;
  const geo = new THREE.ConeGeometry(r, height, 6, 1);
  const mat = envMat(0x162636, 0.85);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x3d, onFloor ? height / 2 : WALL_H - height / 2, z3d);
  if (onFloor) mesh.rotation.x = Math.PI;
  return mesh;
}

function buildPodMesh(): { group: THREE.Group; mat: THREE.LineBasicMaterial; light: THREE.PointLight } {
  const mat = wireMat(0x00FF88);
  const group = new THREE.Group();
  const sGeo = new THREE.SphereGeometry(1.2, 10, 8);
  const sEdge = new THREE.EdgesGeometry(sGeo);
  const sphere = new THREE.LineSegments(sEdge, mat);
  sphere.scale.set(1, 0.7, 1.6);
  group.add(sphere);
  const wGeo = new THREE.CircleGeometry(0.35, 12);
  const wEdge = new THREE.EdgesGeometry(wGeo);
  const wmat = wireMat(0x00FF88, 0.8);
  const window3 = new THREE.LineSegments(wEdge, wmat);
  window3.position.set(0, 0, 1.1);
  window3.rotation.x = -0.15;
  group.add(window3);
  const light = new THREE.PointLight(0x00FF88, 1.0, 12);
  light.position.set(0, 0, 0);
  group.add(light);
  return { group, mat, light };
}

function buildNoiseObjMesh(): THREE.Group {
  const mat = wireMat(0xFFCC00, 0);
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const edges = new THREE.EdgesGeometry(geo);
  const lines = new THREE.LineSegments(edges, mat);
  group.add(lines);
  group.userData.mat = mat;
  return group;
}

// ---------- DRIFTER: bioluminescent jellyfish-like creature ----------
function buildDrifterGroup(): { group: THREE.Group; mats: THREE.LineBasicMaterial[] } {
  const group = new THREE.Group();
  const mats: THREE.LineBasicMaterial[] = [];
  const makeM = () => { const m = wireMat(0xFF3344); mats.push(m); return m; };

  // Bell (translucent dome) — solid additive mesh so it's visible in the dark
  const bellGeo = new THREE.SphereGeometry(1.6, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const bellSolid = new THREE.Mesh(
    bellGeo,
    new THREE.MeshBasicMaterial({ color: 0xFF2244, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  group.add(bellSolid);
  // Bell wireframe outline
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(bellGeo), makeM()));

  // Glowing core inside the bell
  const coreSolid = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xFFAA66, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }),
  );
  coreSolid.position.y = 0.4;
  group.add(coreSolid);
  const coreLight = new THREE.PointLight(0xFF6644, 1.2, 14);
  coreLight.position.set(0, 0.4, 0);
  group.add(coreLight);

  // Ring of trailing tentacles (thin tapered cylinders with curl)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const len = 2.6 + Math.random() * 1.4;
    const tGeo = new THREE.CylinderGeometry(0.03, 0.10, len, 5);
    const t = new THREE.LineSegments(new THREE.EdgesGeometry(tGeo), makeM());
    t.position.set(Math.cos(a) * 1.2, -len / 2 - 0.1, Math.sin(a) * 1.2);
    t.rotation.z = Math.cos(a) * 0.25;
    t.rotation.x = Math.sin(a) * 0.25;
    group.add(t);
  }
  return { group, mats };
}

// ---------- STALKER: anglerfish-like predator with lure & jaws ----------
function buildStalkerGroup(): { group: THREE.Group; mats: THREE.LineBasicMaterial[] } {
  const group = new THREE.Group();
  const mats: THREE.LineBasicMaterial[] = [];
  const makeM = () => { const m = wireMat(0xFF3333); mats.push(m); return m; };

  // Body — elongated ellipsoid (head at +Z front, tail at -Z back)
  const bodyGeo = new THREE.SphereGeometry(1.0, 14, 10);
  const bodySolid = new THREE.Mesh(
    bodyGeo,
    new THREE.MeshBasicMaterial({ color: 0x661122, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  bodySolid.scale.set(1.0, 0.85, 2.4);
  group.add(bodySolid);
  const bodyWire = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo), makeM());
  bodyWire.scale.set(1.0, 0.85, 2.4);
  group.add(bodyWire);

  // Head — slightly larger sphere at front
  const headGeo = new THREE.SphereGeometry(0.85, 12, 10);
  const headSolid = new THREE.Mesh(
    headGeo,
    new THREE.MeshBasicMaterial({ color: 0x882233, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  headSolid.position.z = 2.0;
  group.add(headSolid);
  const headWire = new THREE.LineSegments(new THREE.EdgesGeometry(headGeo), makeM());
  headWire.position.z = 2.0;
  group.add(headWire);

  // Jaw — cone pointing forward (open mouth)
  const jawGeo = new THREE.ConeGeometry(0.75, 1.4, 8, 1, true);
  const jawWire = new THREE.LineSegments(new THREE.EdgesGeometry(jawGeo), makeM());
  jawWire.position.z = 2.8;
  jawWire.rotation.x = Math.PI / 2;
  group.add(jawWire);

  // Teeth — small cones around the jaw rim
  const toothMat = new THREE.MeshBasicMaterial({ color: 0xFFEEDD, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 4), toothMat);
    tooth.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.4, 3.05);
    tooth.rotation.x = -Math.PI / 2;
    group.add(tooth);
  }

  // Lure — bioluminescent bulb on a stalk above the head
  const stalk = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 4)),
    makeM(),
  );
  stalk.position.set(0, 0.9, 1.9);
  stalk.rotation.x = -0.4;
  group.add(stalk);
  const bulbSolid = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xFFEE66, blending: THREE.AdditiveBlending }),
  );
  bulbSolid.position.set(0, 1.45, 2.4);
  group.add(bulbSolid);
  const bulbLight = new THREE.PointLight(0xFFCC44, 1.1, 10);
  bulbLight.position.copy(bulbSolid.position);
  group.add(bulbLight);

  // Eyes — glowing yellow dots on the head
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xFFDD44, blending: THREE.AdditiveBlending });
  const eyeGeo = new THREE.SphereGeometry(0.13, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.45, 0.35, 2.55);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.45, 0.35, 2.55);
  group.add(eyeR);

  // Side fins — flat triangles
  const finGeo = new THREE.PlaneGeometry(1.4, 0.9);
  const finMat = new THREE.MeshBasicMaterial({ color: 0xAA3344, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const finL = new THREE.Mesh(finGeo, finMat);
  finL.position.set(-1.0, 0, 0.2);
  finL.rotation.y = -0.6;
  group.add(finL);
  const finR = new THREE.Mesh(finGeo, finMat);
  finR.position.set(1.0, 0, 0.2);
  finR.rotation.y = 0.6;
  group.add(finR);

  // Tail fluke
  const tailGeo = new THREE.PlaneGeometry(1.1, 1.6);
  const tail = new THREE.Mesh(tailGeo, finMat);
  tail.position.set(0, 0, -2.6);
  tail.rotation.x = Math.PI / 2;
  group.add(tail);

  return { group, mats };
}

// ---------- LEVIATHAN: Subnautica-inspired Ghost Leviathan ----------
// Long serpentine body in neon blue with pulsing neon-red bioluminescent stripes,
// four signature mandibles fanning out from the face, translucent fins.
function buildLeviathanGroup(): { group: THREE.Group; mats: THREE.LineBasicMaterial[] } {
  const group = new THREE.Group();
  const mats: THREE.LineBasicMaterial[] = [];
  // Pulsing red bio-stripe materials — animated from updateEnemies via userData.bioMats
  const bioMats: THREE.MeshBasicMaterial[] = [];
  const NEON_BLUE = 0x00AAFF;
  const NEON_BLUE_DEEP = 0x0066CC;
  const NEON_RED = 0xFF2244;

  // Body wireframe material (neon blue, leathery silhouette)
  const makeM = () => { const m = wireMat(NEON_BLUE); mats.push(m); return m; };
  // Body solid fill (translucent dark blue for depth)
  const bodyMat = new THREE.MeshBasicMaterial({
    color: NEON_BLUE_DEEP, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  // ----- BODY: long EEL-LIKE ribbon, slim & monotonically tapering head-to-tail -----
  // No middle bulge (would read as jellyfish). Smooth taper from r=2.0 at head end to r=0.35 at tail.
  const segCount = 26;
  const segSpacing = 1.7;
  // Slight S-curve for the "charging" silhouette
  const curve = (t: number) => Math.sin(t * Math.PI * 1.4) * 1.4;
  for (let i = 0; i < segCount; i++) {
    const t = i / (segCount - 1);
    // Eel-like profile: thicker near head, narrows smoothly to tail (cubic ease-out)
    const taper = 1 - t;
    const r = 0.35 + 1.65 * (taper * taper);
    const segGeo = new THREE.SphereGeometry(r, 12, 9);
    const z = -i * segSpacing;
    const yOffset = curve(t);

    const segSolid = new THREE.Mesh(segGeo, bodyMat);
    segSolid.position.set(0, yOffset, z);
    group.add(segSolid);
    const segWire = new THREE.LineSegments(new THREE.EdgesGeometry(segGeo), makeM());
    segWire.position.copy(segSolid.position);
    group.add(segWire);

    // Red bioluminescent stripe rings encircling the body (skip tail end)
    if (i > 0 && i < segCount - 3 && i % 2 === 0) {
      const ringGeo = new THREE.TorusGeometry(r * 1.02, 0.10, 6, 20);
      const ringMat = new THREE.MeshBasicMaterial({
        color: NEON_RED, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      bioMats.push(ringMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(0, yOffset, z);
      ring.rotation.y = Math.PI / 2; // ring plane perpendicular to body axis
      group.add(ring);
    }

    // Glowing red dot lights along the spine — every 3 segments
    if (i % 3 === 0 && i < segCount - 2) {
      const dotMat = new THREE.MeshBasicMaterial({
        color: NEON_RED, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending,
      });
      bioMats.push(dotMat);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), dotMat);
      dot.position.set(0, yOffset + r * 0.85, z);
      group.add(dot);
    }
  }

  // ----- HEAD: larger neon-blue dome at front (+Z) -----
  const headR = 2.6;
  const headGeo = new THREE.SphereGeometry(headR, 16, 12);
  const headSolid = new THREE.Mesh(
    headGeo,
    new THREE.MeshBasicMaterial({
      color: NEON_BLUE, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  headSolid.position.z = 2.4;
  group.add(headSolid);
  const headWire = new THREE.LineSegments(new THREE.EdgesGeometry(headGeo), makeM());
  headWire.position.z = 2.4;
  group.add(headWire);

  // ----- FOUR MANDIBLES — signature Ghost Leviathan X-shape claws -----
  // Each mandible is a long curved "claw" extending forward & outward from the face,
  // meeting near the front. Built from a tapered cylinder + curved tip.
  const mandibleMat = new THREE.MeshBasicMaterial({
    color: NEON_BLUE, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const mandibleEdgeMat = wireMat(NEON_BLUE);
  mats.push(mandibleEdgeMat);
  const mandibleAngles = [
    { ax:  1, ay:  1 }, // upper-right
    { ax: -1, ay:  1 }, // upper-left
    { ax:  1, ay: -1 }, // lower-right
    { ax: -1, ay: -1 }, // lower-left
  ];
  for (const { ax, ay } of mandibleAngles) {
    // Base anchor on the face, pointing forward + outward
    const mandible = new THREE.Group();
    // Two tapered cone segments (base + curved tip) for the mandible
    const baseGeo = new THREE.ConeGeometry(0.55, 5.2, 8, 1, true);
    const baseSolid = new THREE.Mesh(baseGeo, mandibleMat);
    baseSolid.position.set(0, 0, 2.5);
    baseSolid.rotation.x = -Math.PI / 2;
    mandible.add(baseSolid);
    const baseWire = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo), mandibleEdgeMat);
    baseWire.position.copy(baseSolid.position);
    baseWire.rotation.copy(baseSolid.rotation);
    mandible.add(baseWire);
    // Tip — narrower curved-in cone meeting at the centerline
    const tipGeo = new THREE.ConeGeometry(0.22, 3.4, 6, 1, true);
    const tipSolid = new THREE.Mesh(tipGeo, mandibleMat);
    // Curl tip back toward center (apex at +Z, narrowing)
    tipSolid.position.set(-ax * 0.7, -ay * 0.7, 6.6);
    tipSolid.rotation.x = -Math.PI / 2;
    tipSolid.rotation.z = ax * ay * 0.45;
    mandible.add(tipSolid);
    const tipWire = new THREE.LineSegments(new THREE.EdgesGeometry(tipGeo), mandibleEdgeMat);
    tipWire.position.copy(tipSolid.position);
    tipWire.rotation.copy(tipSolid.rotation);
    mandible.add(tipWire);
    // Red bio-stripe along the mandible base
    const stripeMat = new THREE.MeshBasicMaterial({
      color: NEON_RED, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    bioMats.push(stripeMat);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.5, 5), stripeMat);
    stripe.position.set(0, 0.5, 2.7);
    stripe.rotation.x = -Math.PI / 2;
    mandible.add(stripe);

    // Position & rotate the whole mandible to fan out diagonally from the face
    mandible.position.set(ax * 1.2, ay * 1.2, 3.5);
    mandible.rotation.y = ax * 0.35;
    mandible.rotation.x = -ay * 0.35;
    group.add(mandible);
  }

  // ----- EYES — small glowing red orbs deep in the face -----
  const eyeMat = new THREE.MeshBasicMaterial({
    color: NEON_RED, blending: THREE.AdditiveBlending,
  });
  bioMats.push(eyeMat);
  const eyeGeo = new THREE.SphereGeometry(0.32, 10, 8);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-1.1, 0.6, 4.4);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(1.1, 0.6, 4.4);
  group.add(eyeR);
  const eyeLightL = new THREE.PointLight(NEON_RED, 1.4, 26);
  eyeLightL.position.copy(eyeL.position);
  group.add(eyeLightL);
  const eyeLightR = new THREE.PointLight(NEON_RED, 1.4, 26);
  eyeLightR.position.copy(eyeR.position);
  group.add(eyeLightR);

  // Always-on red rim light pulsing with the bio stripes
  const rimLight = new THREE.PointLight(NEON_RED, 0.8, 40);
  rimLight.position.set(0, 0, -segCount * segSpacing * 0.4);
  group.add(rimLight);

  // ----- DORSAL FRILL — translucent flowing sail along the back -----
  const dorsalMat = new THREE.MeshBasicMaterial({
    color: NEON_BLUE, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(2, 0);
  dorsalShape.lineTo(-segCount * segSpacing + 4, 0);
  dorsalShape.bezierCurveTo(
    -segCount * segSpacing * 0.7, 1.4,
    -segCount * segSpacing * 0.4, 3.2,
    -2, 2.8,
  );
  dorsalShape.lineTo(2, 0);
  const dorsal = new THREE.Mesh(new THREE.ShapeGeometry(dorsalShape), dorsalMat);
  dorsal.position.set(0, 1.6, 0);
  dorsal.rotation.y = Math.PI / 2;
  group.add(dorsal);

  // ----- PECTORAL FINS — two flowing fins near the head -----
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.bezierCurveTo(2.8, 0.4, 4.2, -1.2, 4.6, -3.0);
  finShape.bezierCurveTo(3.0, -2.4, 1.4, -1.4, 0, 0);
  const finGeo = new THREE.ShapeGeometry(finShape);
  const finL = new THREE.Mesh(finGeo, dorsalMat);
  finL.position.set(-1.8, -0.3, 1.4);
  finL.rotation.y = Math.PI / 2;
  finL.rotation.x = 0.4;
  group.add(finL);
  const finR = new THREE.Mesh(finGeo, dorsalMat);
  finR.position.set(1.8, -0.3, 1.4);
  finR.rotation.y = -Math.PI / 2;
  finR.rotation.x = 0.4;
  group.add(finR);

  // ----- TAIL FLUKE — sweeping translucent tail at the end -----
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0);
  tailShape.bezierCurveTo(-1.8, 2.6, -3.2, 3.4, -3.6, 3.2);
  tailShape.bezierCurveTo(-2.4, 1.4, -1.0, 0.4, 0, 0);
  tailShape.bezierCurveTo(-1.0, -0.4, -2.4, -1.4, -3.6, -3.2);
  tailShape.bezierCurveTo(-3.2, -3.4, -1.8, -2.6, 0, 0);
  const tailGeo = new THREE.ShapeGeometry(tailShape);
  const tail = new THREE.Mesh(tailGeo, dorsalMat);
  tail.position.set(0, 0, -(segCount - 1) * segSpacing - 0.8);
  tail.rotation.y = Math.PI / 2;
  group.add(tail);

  // Expose pulsing materials so updateEnemies can animate them
  group.userData.bioMats = bioMats;

  return { group, mats };
}

function makeTextTexture(text: string, w: number, h: number, color = "#00FFFF", bgGlow = true): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  const lines = text.split("\n");
  const fontSize = Math.floor(h / (lines.length * 1.6));
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (bgGlow) {
    ctx.shadowColor = color; ctx.shadowBlur = fontSize * 0.7;
  }
  ctx.fillStyle = color;
  const lh = fontSize * 1.25;
  lines.forEach((line, i) => {
    ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function makeBillboard(text: string, color: string, scaleW = 5, scaleH = 1.2): THREE.Sprite {
  const tex = makeTextTexture(text, 512, 128, color, true);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scaleW, scaleH, 1);
  return sprite;
}

function buildOdysseyShip(): THREE.Group {
  const group = new THREE.Group();
  // Lit deep-sea wreck materials — rusted/encrusted hull tones
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x3a4452, roughness: 0.85, metalness: 0.35 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x2d3744, roughness: 0.9, metalness: 0.25 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2e, roughness: 0.9, metalness: 0.4 }); // rusty
  const detailMat = new THREE.MeshStandardMaterial({ color: 0x222a34, roughness: 0.9, metalness: 0.3 });

  // Hull (long box)
  const hullGeo = new THREE.BoxGeometry(7, 1.6, 1.8);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.set(0, 0.8, 0);
  group.add(hull);
  // Bow taper (front of ship)
  const bow = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.2), hullMat);
  bow.position.set(4.0, 0.7, 0); group.add(bow);
  // Deck superstructure
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.8, 1.4), deckMat);
  deck.position.set(-0.5, 1.95, 0); group.add(deck);
  // Bridge (raised cabin)
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 1.2), deckMat);
  bridge.position.set(-0.8, 2.85, 0); group.add(bridge);
  // Smokestack
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.2, 12), trimMat);
  stack.position.set(-1.6, 3.85, 0); group.add(stack);
  // Crane / cargo arm
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), trimMat);
  arm.position.set(1.6, 3.2, 0); arm.rotation.z = -0.35; group.add(arm);
  // Mast (tall thin pole)
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.5, 8), detailMat);
  mast.position.set(0.4, 4.6, 0); group.add(mast);
  // Antenna spokes
  for (let i = 0; i < 3; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.04), detailMat);
    w.position.set(0.4, 4.6 + i * 0.5, 0); group.add(w);
  }
  // Rails along deck
  for (let side = -1; side <= 1; side += 2) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(7, 0.04, 0.04), detailMat);
    rail.position.set(0, 1.7, side * 0.85); group.add(rail);
  }

  // Hull text plane: "RESEARCH VESSEL ODYSSEY" — kept as faintly self-illuminated stencil
  const tex = makeTextTexture("RESEARCH VESSEL\nODYSSEY", 1024, 256, "#C8DCE8", false);
  const textMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, roughness: 0.95, metalness: 0.0 });
  const textPlane = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.1), textMat);
  textPlane.position.set(0.4, 0.85, 0.92); group.add(textPlane);
  const textPlaneB = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.1), textMat.clone());
  textPlaneB.position.set(0.4, 0.85, -0.92); textPlaneB.rotation.y = Math.PI; group.add(textPlaneB);

  // Floating "DATA BULKHEAD" label near a damaged section — set up by caller
  return group;
}

function buildBioLights(worldW: number, worldH: number): THREE.Group {
  const grp = new THREE.Group();
  const count = Math.max(8, Math.floor(worldW * worldH / 250000));
  for (let i = 0; i < count; i++) {
    const x = (60 + Math.random() * (worldW - 120)) * WS;
    const z = (60 + Math.random() * (worldH - 120)) * WS;
    const y = 1 + Math.random() * (WALL_H - 2);
    const cyan = Math.random() > 0.5;
    const color = cyan ? 0x00DDFF : 0x66AAFF;
    const light = new THREE.PointLight(color, 0.55, 9);
    light.position.set(x, y, z);
    grp.add(light);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 6, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    orb.position.copy(light.position);
    orb.userData.baseY = y; orb.userData.phase = Math.random() * Math.PI * 2;
    grp.add(orb);
  }
  return grp;
}

function buildCockpit(camera: THREE.PerspectiveCamera): { sweep: THREE.Object3D } {
  const cockpit = new THREE.Group();
  const metal = new THREE.MeshLambertMaterial({ color: 0x15151E });
  const darkMetal = new THREE.MeshLambertMaterial({ color: 0x0D0D14 });
  const greenM = new THREE.MeshStandardMaterial({ color: 0x004400, emissive: 0x00AA00, emissiveIntensity: 0.8 });
  const redM = new THREE.MeshStandardMaterial({ color: 0x440000, emissive: 0xAA0000, emissiveIntensity: 0.8 });
  const amberM = new THREE.MeshStandardMaterial({ color: 0x443300, emissive: 0xFF8800, emissiveIntensity: 0.6 });

  // Main dashboard panel
  const dash = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.28, 1.0), metal);
  dash.position.set(0, 0, 0);
  cockpit.add(dash);

  // Left and right raised side panels
  const lPanel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.72, 0.88), darkMetal);
  lPanel.position.set(-1.9, 0.36, 0.06);
  cockpit.add(lPanel);
  const rPanel = lPanel.clone();
  rPanel.position.set(1.9, 0.36, 0.06);
  cockpit.add(rPanel);

  // Central console raised block
  const console3d = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.85), darkMetal);
  console3d.position.set(0, 0.18, 0.08);
  cockpit.add(console3d);

  // Sonar ring
  const sonarRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 8, 32), new THREE.MeshLambertMaterial({ color: 0x003300, emissive: 0x00BB44 }));
  sonarRing.rotation.x = Math.PI / 2;
  sonarRing.position.set(0, 0.3, 0.12);
  cockpit.add(sonarRing);

  // Radar sweep line (child of sonarRing for rotation)
  const sweepGeo = new THREE.PlaneGeometry(0.26, 0.015);
  const sweepMat = new THREE.MeshStandardMaterial({ color: 0x00FF44, emissive: 0x00FF44, emissiveIntensity: 1.5, transparent: true, opacity: 0.9 });
  const sweep = new THREE.Mesh(sweepGeo, sweepMat);
  sweep.position.set(0.13, 0, 0);
  sonarRing.add(sweep);

  // Buttons — rows on left and right panels
  const btnPositions: [number, number, number, THREE.Material][] = [
    [-1.65, 0.42, 0.15, greenM], [-1.5, 0.42, 0.15, redM], [-1.35, 0.42, 0.15, greenM],
    [-1.65, 0.42, -0.05, redM], [-1.5, 0.42, -0.05, greenM], [-1.35, 0.42, -0.05, amberM],
    [1.35, 0.42, 0.15, greenM], [1.5, 0.42, 0.15, redM], [1.65, 0.42, 0.15, greenM],
    [1.35, 0.42, -0.05, amberM], [1.5, 0.42, -0.05, greenM], [1.65, 0.42, -0.05, redM],
    [-0.4, 0.34, 0.22, greenM], [-0.2, 0.34, 0.22, amberM], [0.2, 0.34, 0.22, redM], [0.4, 0.34, 0.22, greenM],
  ];
  for (const [bx, by, bz, bm] of btnPositions) {
    const btn = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.055, 0.065), bm);
    btn.position.set(bx, by, bz);
    cockpit.add(btn);
  }

  // Porthole frame — thick torus around the view
  const portholeMat = new THREE.MeshLambertMaterial({ color: 0x1E1E2A });
  const porthole = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.18, 10, 48), portholeMat);
  porthole.position.set(0, 0.62, -0.25);
  cockpit.add(porthole);

  // Edge rivets on porthole
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 5), darkMetal);
    rivet.position.set(Math.cos(a) * 1.08, 0.62 + Math.sin(a) * 1.08, -0.22);
    cockpit.add(rivet);
  }

  // Ambient red light for cockpit
  const redLight = new THREE.PointLight(0xFF1100, 1.8, 4.5);
  redLight.position.set(0, -0.1, 0);
  cockpit.add(redLight);

  // Position cockpit in camera space (below and in front)
  cockpit.position.set(0, -0.88, -1.55);
  camera.add(cockpit);

  return { sweep: sonarRing };
}

// ============================================================
// ANIMATED HEADLIGHT COOKIE
// Draws a 128×128 caustic ripple texture that can be refreshed
// each render tick with a time offset so the beam shimmers like
// real underwater light refraction.
// ============================================================
interface AnimatedCookie {
  texture: THREE.CanvasTexture;
  /** Redraw cookie at time t (seconds). Call every N frames. */
  update(t: number): void;
}

function makeAnimatedHeadlightCookie(): AnimatedCookie {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);

  function draw(t: number) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    // Radial gradient base — bright centre, falloff to transparent edge
    const cx = size / 2, cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
    grad.addColorStop(0,    "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.72, "rgba(255,255,255,0.3)");
    grad.addColorStop(1,    "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Modulate pixel brightness with three slowly drifting sine waves
    // ph1 shifts radial rings; ph2/ph3 drift diagonal interference bands
    const ph1 = t * 0.7;
    const ph2 = t * 0.5;
    const ph3 = t * 0.4;
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const dx = (x - cx) / cx;
        const dy = (y - cy) / cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1.0) {
          const ripple =
            Math.sin(dist * 20 + ph1) * 0.12 +
            Math.sin(dx * 15 + dy * 11 + ph2) * 0.09 +
            Math.sin(dx * 8  - dy * 13 + ph3) * 0.07;
          const base   = data[idx] / 255;
          const factor = Math.max(0, Math.min(1, base + ripple));
          const v = Math.floor(factor * 255);
          data[idx] = v; data[idx + 1] = v; data[idx + 2] = v;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    tex.needsUpdate = true;
  }

  draw(0); // initial bake so the texture is non-blank from the start
  return { texture: tex, update: draw };
}

function buildParticles(worldW: number, worldH: number): THREE.Points {
  const count = 300;
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3); // per-particle base velocities
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = Math.random() * worldW * WS;
    pos[i * 3 + 1] = Math.random() * WALL_H;
    pos[i * 3 + 2] = Math.random() * worldH * WS;
    // Gentle lazy drift: slow upward with a tiny random horizontal wobble
    vel[i * 3]     = (Math.random() - 0.5) * 0.0018;
    vel[i * 3 + 1] = 0.0008 + Math.random() * 0.0014;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.0018;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0x00DDFF, size: 0.06, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.userData.vel = vel;
  pts.userData.worldW = worldW;
  pts.userData.worldH = worldH;
  return pts;
}

// ============================================================
// SEEDED PRNG (xorshift32)
// ============================================================
function seededRng(seed: number): () => number {
  let s = ((seed >>> 0) ^ 0xA3C59F71) || 1;
  return (): number => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

// ============================================================
// ROCK GLB — loaded once at startup; scatter waits on this promise
// so fallback is only used on explicit load failure, not "still loading".
// ============================================================
const _rockLoadPromise: Promise<THREE.BufferGeometry | null> = (async () => {
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(
      `${import.meta.env.BASE_URL}beach_cliff_rock_face_1778855916049.glb`,
    );
    let geo: THREE.BufferGeometry | null = null;
    gltf.scene.traverse((child) => {
      if (geo) return;
      const m = child as THREE.Mesh;
      if (m.isMesh && m.geometry) geo = (m.geometry as THREE.BufferGeometry).clone();
    });
    return geo;
  } catch {
    return null; // explicit load failure — use procedural fallback
  }
})();

// ============================================================
// OBSTACLE SCATTER HELPERS
// ============================================================
interface ScatterResult {
  meshes: THREE.Object3D[];
  revealEntries: Array<{ lines: THREE.LineSegments; mat: THREE.LineBasicMaterial; cx: number; cy: number }>;
  rects: Rect[];
}

function _scatterRockMat(rng: () => number): THREE.MeshStandardMaterial {
  const palette = [0x1a2530, 0x243040, 0x1c2838, 0x2a3848, 0x131e28, 0x1e2c3a, 0x232f3c];
  return new THREE.MeshStandardMaterial({
    color: palette[Math.floor(rng() * palette.length)],
    roughness: 0.94,
    metalness: 0.03,
  });
}

function _makeRevealLines(
  geo: THREE.BufferGeometry,
  position: THREE.Vector3,
  rotation: THREE.Euler,
  scale: THREE.Vector3,
): { lines: THREE.LineSegments; mat: THREE.LineBasicMaterial } {
  const mat = new THREE.LineBasicMaterial({
    color: 0x22BBFF,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat);
  lines.position.copy(position);
  lines.rotation.copy(rotation);
  lines.scale.copy(scale);
  return { lines, mat };
}

// ─── ROCKS ────────────────────────────────────────────────────────────────────
// rockGeo is the resolved GLB geometry (null on explicit load failure).
// RNG consumption is identical regardless of rockGeo availability so the
// same seed always produces the same positions and colliders.
function scatterRocks(
  seed: number, worldW: number, worldH: number,
  rockGeo: THREE.BufferGeometry | null,
): ScatterResult {
  const rng = seededRng(seed);
  const result: ScatterResult = { meshes: [], revealEntries: [], rects: [] };
  const total = 35 + Math.floor(rng() * 20);

  let placed = 0;
  while (placed < total) {
    const clusterSize = rng() < 0.55 ? 1 : 2 + Math.floor(rng() * 3);
    const baseCx = 80 + rng() * (worldW - 160);
    const baseCz = 80 + rng() * (worldH - 160);

    for (let c = 0; c < clusterSize && placed < total; c++, placed++) {
      const scale = 0.5 + rng() * 2.5;
      const rotY   = rng() * Math.PI * 2;
      const tiltX  = (rng() - 0.5) * 0.7;
      const tiltZ  = (rng() - 0.5) * 0.7;
      const x2d = Math.max(60, Math.min(worldW - 60, baseCx + (rng() - 0.5) * 80));
      const z2d = Math.max(60, Math.min(worldH - 60, baseCz + (rng() - 0.5) * 80));

      // Always consume the same RNG calls for procedural params.
      // These drive colliders + fallback geometry regardless of GLB state.
      const r    = 0.35 + rng() * 0.4;
      const h    = 0.8  + rng() * 1.5;
      const segs = 5    + Math.floor(rng() * 4);

      // Visual geometry: GLB clone preferred, procedural cone as fallback
      const baseGeo: THREE.BufferGeometry = rockGeo
        ? rockGeo.clone()
        : new THREE.ConeGeometry(r, h, segs);

      const pos  = new THREE.Vector3(x2d * WS, 0, z2d * WS);
      const rot  = new THREE.Euler(tiltX, rotY, tiltZ);
      const scl  = new THREE.Vector3(scale, scale, scale);

      const pt = rng();
      if (pt < 0.60) {
        pos.y = 0;
      } else if (pt < 0.78) {
        pos.y = WALL_H - scale * 0.45; // constant — independent of GLB state
        rot.x += Math.PI;
      } else {
        pos.y = -scale * rng() * 0.35;
      }

      const mesh = new THREE.Mesh(baseGeo, _scatterRockMat(rng));
      mesh.position.copy(pos); mesh.rotation.copy(rot); mesh.scale.copy(scl);
      result.meshes.push(mesh);

      const { lines, mat } = _makeRevealLines(baseGeo, pos, rot, scl);
      result.meshes.push(lines);
      result.revealEntries.push({ lines, mat, cx: x2d, cy: z2d });

      // Collider always derived from procedural r (deterministic across runs)
      const fr = Math.min(48, Math.max(8, (r * scale) / WS));
      result.rects.push({ x: x2d - fr, y: z2d - fr, w: fr * 2, h: fr * 2 });
    }
  }
  return result;
}

// ─── WALLS ────────────────────────────────────────────────────────────────────
function scatterWalls(seed: number, worldW: number, worldH: number): ScatterResult {
  const rng = seededRng(seed);
  const result: ScatterResult = { meshes: [], revealEntries: [], rects: [] };
  const wallPalette = [0x1e2c3e, 0x1a2838, 0x243248, 0x162230, 0x202e40, 0x1c2a38];
  const total = 14 + Math.floor(rng() * 10);

  for (let w = 0; w < total; w++) {
    const x2d     = 100 + rng() * (worldW - 200);
    const z2d     = 100 + rng() * (worldH - 200);
    const wallRot = rng() * Math.PI;
    const slabs   = 2   + Math.floor(rng() * 3);
    let offsetZ   = 0;

    for (let s = 0; s < slabs; s++) {
      const sw  = (14 + rng() * 34) * WS;
      const sh  = WALL_H * (0.5 + rng() * 0.5);
      const sd  = (7  + rng() * 16) * WS;
      const cx3 = x2d * WS + (rng() - 0.5) * sw * 0.25;
      const cz3 = z2d * WS + offsetZ;
      offsetZ  += (rng() - 0.5) * sd * 0.8;

      const rot = new THREE.Euler(0, wallRot + (rng() - 0.5) * 0.3, 0);
      const pos = new THREE.Vector3(cx3, sh / 2, cz3);
      const geo = new THREE.BoxGeometry(sw, sh, sd);
      const mat = new THREE.MeshStandardMaterial({
        color: wallPalette[Math.floor(rng() * wallPalette.length)],
        roughness: 0.95, metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos); mesh.rotation.copy(rot);
      result.meshes.push(mesh);

      const { lines, mat: lmat } = _makeRevealLines(geo, pos, rot, new THREE.Vector3(1, 1, 1));
      result.meshes.push(lines);
      result.revealEntries.push({ lines, mat: lmat, cx: x2d, cy: z2d });

      const cosR = Math.abs(Math.cos(wallRot));
      const sinR = Math.abs(Math.sin(wallRot));
      const rw2d = (sw / WS) * cosR + (sd / WS) * sinR;
      const rh2d = (sw / WS) * sinR + (sd / WS) * cosR;
      // Use actual slab centre (cx3/cz3) not wall anchor (x2d/z2d) so each
      // slab's AABB tracks its real displaced position in the 2D collision map.
      const slabCx = cx3 / WS;
      const slabCz = cz3 / WS;
      result.rects.push({ x: slabCx - rw2d / 2, y: slabCz - rh2d / 2, w: rw2d, h: rh2d });
    }
  }
  return result;
}

// ─── DEBRIS ───────────────────────────────────────────────────────────────────
function scatterDebris(seed: number, worldW: number, worldH: number): ScatterResult {
  const rng = seededRng(seed);
  const result: ScatterResult = { meshes: [], revealEntries: [], rects: [] };
  const metalPalette = [0x2a3540, 0x1e2c38, 0x344454, 0x3a4858, 0x1a2632, 0x283848];
  const total = 22 + Math.floor(rng() * 14);

  for (let cl = 0; cl < total; cl++) {
    const cx2d = 80 + rng() * (worldW - 160);
    const cz2d = 80 + rng() * (worldH - 160);
    const pieces = 2 + Math.floor(rng() * 4);
    // Size-proportional heuristic: large clusters (4–5 pieces) occupy enough
    // physical space to plausibly block the sub; small ones rarely do.
    // This replaces a flat 40% with a graduated probability so colliders
    // appear where there is actually enough geometry to warrant them.
    const blocksPath = rng() < (pieces >= 4 ? 0.65 : 0.20);

    for (let p = 0; p < pieces; p++) {
      const px2d = cx2d + (rng() - 0.5) * 60;
      const pz2d = cz2d + (rng() - 0.5) * 60;
      const x3d  = px2d * WS;
      const z3d  = pz2d * WS;

      const floatRoll = rng();
      const y3d = floatRoll < 0.65 ? rng() * 0.3
               : floatRoll < 0.88  ? 0.3 + rng() * 1.2
               :                     1.0 + rng() * 2.0;

      const rotX = (rng() - 0.5) * Math.PI;
      const rotY = rng() * Math.PI * 2;
      const rotZ = (rng() - 0.5) * Math.PI;
      const pos  = new THREE.Vector3(x3d, y3d, z3d);
      const rot  = new THREE.Euler(rotX, rotY, rotZ);
      const scl  = new THREE.Vector3(1, 1, 1);

      const shapeRoll = rng();
      let geo: THREE.BufferGeometry;
      if (shapeRoll < 0.38) {
        geo = new THREE.BoxGeometry(
          (0.3 + rng() * 0.8) * WS * 20,
          (0.04 + rng() * 0.12) * WS * 20,
          (0.2 + rng() * 0.6) * WS * 20,
        );
      } else if (shapeRoll < 0.64) {
        geo = new THREE.CylinderGeometry(
          0.04 + rng() * 0.10, 0.04 + rng() * 0.10,
          0.2 + rng() * 0.8, 7,
        );
      } else if (shapeRoll < 0.84) {
        geo = new THREE.ConeGeometry(0.08 + rng() * 0.22, 0.15 + rng() * 0.55, 4 + Math.floor(rng() * 3));
      } else {
        const s = 0.1 + rng() * 0.35;
        geo = new THREE.BoxGeometry(s, s * (0.4 + rng() * 0.6), s);
      }

      const mat = new THREE.MeshStandardMaterial({
        color: metalPalette[Math.floor(rng() * metalPalette.length)],
        roughness: 0.88, metalness: 0.35,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos); mesh.rotation.copy(rot);
      result.meshes.push(mesh);

      const { lines, mat: lmat } = _makeRevealLines(geo, pos, rot, scl);
      result.meshes.push(lines);
      result.revealEntries.push({ lines, mat: lmat, cx: px2d, cy: pz2d });
    }

    if (blocksPath) {
      result.rects.push({ x: cx2d - 22, y: cz2d - 22, w: 44, h: 44 });
    }
  }
  return result;
}

// ─── PLATFORMS ────────────────────────────────────────────────────────────────
// Large flat disc / tiered-ring structures — the most visually striking shape
// for the sonar grid since the curved faces wrap the grid naturally.
function scatterPlatforms(seed: number, worldW: number, worldH: number): ScatterResult {
  const rng = seededRng(seed);
  const result: ScatterResult = { meshes: [], revealEntries: [], rects: [] };
  const palette = [0x1a2a3a, 0x162230, 0x1e2c3e, 0x243040, 0x202838];
  const total = 10 + Math.floor(rng() * 8);

  for (let i = 0; i < total; i++) {
    const cx2d = 120 + rng() * (worldW - 240);
    const cz2d = 120 + rng() * (worldH - 240);
    const tiers = 1 + Math.floor(rng() * 3);          // 1–3 stacked discs
    const baseR = (18 + rng() * 30) * WS;             // outer radius
    const onFloor = rng() > 0.4;
    const baseY = onFloor ? 0 : WALL_H * (0.5 + rng() * 0.4);

    for (let t = 0; t < tiers; t++) {
      const tierR = baseR * (1 - t * 0.28);
      const tierH = (4 + rng() * 8) * WS;
      const yOff  = t * tierH * 0.85;
      const segs  = 14 + Math.floor(rng() * 8);   // smooth enough to show curved grid
      const col   = palette[Math.floor(rng() * palette.length)];
      const geo   = new THREE.CylinderGeometry(tierR * 0.7, tierR, tierH, segs, 1);
      const mat   = new THREE.MeshStandardMaterial({ color: col, roughness: 0.92, metalness: 0.12 });
      const pos   = new THREE.Vector3(cx2d * WS, baseY + yOff, cz2d * WS);
      const rot   = new THREE.Euler(0, rng() * Math.PI * 2, 0);
      const mesh  = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.rotation.copy(rot);
      result.meshes.push(mesh);

      const { lines, mat: lmat } = _makeRevealLines(geo, pos, rot, new THREE.Vector3(1, 1, 1));
      result.meshes.push(lines);
      result.revealEntries.push({ lines, mat: lmat, cx: cx2d, cy: cz2d });
    }
    // Collider for the widest (bottom) tier only
    const fr = Math.min(80, Math.max(12, baseR / WS));
    result.rects.push({ x: cx2d - fr, y: cz2d - fr, w: fr * 2, h: fr * 2 });
  }
  return result;
}

// ============================================================
// MAIN GAME CLASS
// ============================================================
class EchoesGame {
  // Canvases
  private threeCanvas: HTMLCanvasElement;
  private hudCanvas: HTMLCanvasElement;
  private hudCtx: CanvasRenderingContext2D;

  // Three.js
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private sceneGroup!: THREE.Group;   // holds all level geometry
  private cockpitSweep: THREE.Object3D | null = null;

  // 3D scene objects
  private revealObjs: RevealObj[] = [];
  private enemyObjs: EnemyObj[] = [];
  private podObjs: PodObj[] = [];
  private noiseObjMeshes: Array<{ group: THREE.Group; mat: THREE.LineBasicMaterial }> = [];
  private ping3Ds: Ping3D[] = [];
  private flareMeshes: FlareMesh[] = [];
  private activeFadeSet: Set<RevealObj> = new Set();
  private boostPingCooldown = 0;
  private particleSystem: THREE.Points | null = null;

  // Mouse look (camera-relative)
  private yaw = Math.PI;   // start facing into tunnel (+Z)
  private pitch = 0;

  // Fluid physics
  private smoothFwd = 0;        // smoothed forward/back input [-1..1]
  private smoothSide = 0;       // smoothed strafe input [-1..1]
  private prevYaw = Math.PI;    // yaw from previous frame (for delta-yaw)
  private cameraRoll = 0;       // current camera roll offset (radians)
  private cameraPitchOff = 0;   // current camera pitch offset from buoyancy (radians)

  // Audio
  private audio = new AudioSys();
  private audioReady = false;

  // State
  private state: GameState = "MENU";
  private _sceneBuildToken = 0; // incremented each loadLevel call; post-await guard
  private lvlIdx = 0;
  private lvlDef: LevelData | null = null;
  private lvlTime = 0;

  // Player (2D positions)
  private px = 400; private py = 400;
  private pvx = 0; private pvy = 0;
  private o2 = 100; private flares = 3;
  private invTimer = 0; private glitchTimer = 0;

  // Noise
  private noise = 0; private alarmTimer = 0;

  // Level objects (2D logic)
  private enemies: Enemy[] = [];
  private pods: Lifepod[] = [];
  private noiseObjs: NoiseObj[] = [];
  private pings: Ping[] = [];
  private flareObjs: Flare[] = [];

  // Camera (2D follow)
  private camX = 400; private camY = 400;

  // Input
  private keys: Record<string, boolean> = {};
  private mouseHeld = false; private mouseDownAt = 0;

  // HUD state
  private subtitle = ""; private subTimer = 0;
  private dlgQueue: DialogueCue[] = [];

  // Cutscene
  private csPanels: CutscenePanel[] = [];
  private csPanelIdx = 0;
  private csTextLen = 0; private csTextTimer = 0;
  private csPhase: "typing" | "waiting" = "typing";
  private csCallback: (() => void) | null = null;

  // Puzzle (L2), choice (L3)
  private puzzleDone = false;
  private sacrificing = false; private transitioning = false;
  private levPulseTimer = 8000; private levBlocked = false;

  // Analog dashboard state
  private hullIntegrity = 100;
  private hullInDanger = false;  // tracks when hull is in the red zone to fire the sting once
  private sonarOverlayMat: THREE.ShaderMaterial | null = null;
  private sonarCharge = 100;
  private gaugeDisplay = { o2: 100, depth: 20, sonarCharge: 100, hull: 100, flares: 3 };
  private sonarSwitchAnim = 0;   // ms countdown for toggle snap animation
  private flareSwitchAnim = 0;
  private valveSonarAngle = 0;   // radians — rotary valve animation
  private valveFlareAngle = 0;
  private readonly glassScratches: Array<Array<{x1:number;y1:number;x2:number;y2:number;a:number}>> = [];

  // Interactables
  private nearPod: Lifepod | null = null;
  private nearNoise: NoiseObj | null = null;

  // Post-processing uniforms that need per-frame updates
  private grainUniforms: { tDiffuse: { value: THREE.Texture | null }; time: { value: number }; intensity: { value: number } } | null = null;
  private grainIntensity = 0.03; // current (lerped) grain intensity

  // Animated headlight cookie — caustic ripple texture that drifts each frame
  private headlightCookie: AnimatedCookie | null = null;
  private cookieFrame = 0; // throttle: redraw every 3 render frames

  // Hull stress audio system
  private hullStressTier = -1;      // 0=shallow 1=mid 2=deep 3=abyss; -1=uninitialised
  private hullStressTimer = 0;      // ms until next random groan trigger
  private sharpTurnCooldown = 0;    // ms cooldown after a creak fires
  private lastYawStress = Math.PI;  // yaw sampled last update for delta-yaw calculation
  private hullGainRampTimer = 0;    // throttle: only re-ramp gain every 2 s

  // Gauge damage-reaction state
  private gaugeVelocity = { o2: 0, depth: 0, sonarCharge: 0, hull: 0, flares: 0 };
  private hullBezelFlash = 0;    // ms countdown — orange/red glow on hull hit
  private o2BezelPhase = 0;      // accumulated radians for O2 critical sine pulse

  // Hull collision damage state
  private hullDamageCooldown = 0;   // ms — min gap between damage ticks (spam prevention)
  private shakeTimer = 0;           // ms remaining for camera shake
  private shakeIntensity = 0;       // peak shake magnitude (Three.js units)
  private shakeDuration = 160;      // ms — total duration of current shake event (for decay calc)
  private gameOverReason: "oxygen" | "hull" = "oxygen";

  // Level transition
  private transitionTargetLvl = 0;
  private transitionStartMs = 0;
  private transitionDurationMs = 3400;
  private transitionCallback: (() => void) | null = null;

  // RAF
  private rafId = 0; private lastT = 0;

  constructor(threeCanvas: HTMLCanvasElement, hudCanvas: HTMLCanvasElement) {
    this.threeCanvas = threeCanvas;
    this.hudCanvas = hudCanvas;
    this.hudCtx = hudCanvas.getContext("2d")!;
    this.initThreeJS();
    this.resizeCanvases();
    window.addEventListener("resize", () => this.resizeCanvases());
    this.bindInput();
  }

  // ============================================================
  // SETUP
  // ============================================================
  private resizeCanvases() {
    const sx = window.innerWidth / GAME_W, sy = window.innerHeight / GAME_H;
    const s = Math.min(sx, sy);
    const w = `${GAME_W * s}px`, h = `${GAME_H * s}px`;
    const ml = `${(window.innerWidth - GAME_W * s) / 2}px`;
    const mt = `${(window.innerHeight - GAME_H * s) / 2}px`;
    for (const c of [this.threeCanvas, this.hudCanvas]) {
      c.style.width = w; c.style.height = h;
      c.style.marginLeft = ml; c.style.marginTop = mt;
    }
  }

  private webglFailed = false;

  private initThreeJS() {
    // Check WebGL availability
    try {
      const testCtx = this.threeCanvas.getContext("webgl2") || this.threeCanvas.getContext("webgl");
      if (!testCtx) throw new Error("no webgl");
    } catch {
      this.webglFailed = true;
      this.hudCanvas.width = GAME_W; this.hudCanvas.height = GAME_H;
      const ctx = this.hudCtx;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = "#00FFFF"; ctx.font = "bold 22px monospace"; ctx.textAlign = "center";
      ctx.fillText("WebGL is required to play Echoes of the Deep.", GAME_W / 2, GAME_H / 2 - 20);
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "14px monospace";
      ctx.fillText("Please open this game in a modern browser with GPU acceleration enabled.", GAME_W / 2, GAME_H / 2 + 20);
      return;
    }

    // Renderer
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.threeCanvas, antialias: true, alpha: false });
    } catch {
      this.webglFailed = true; return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(GAME_W, GAME_H);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020a0e);
    this.scene.fog = new THREE.FogExp2(0x020a0e, 0.10);

    // Camera
    this.camera = new THREE.PerspectiveCamera(75, GAME_W / GAME_H, 0.05, 500);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    // Scene group (level geometry)
    this.sceneGroup = new THREE.Group();
    this.scene.add(this.sceneGroup);

    // Murky baseline ambient + hemisphere so the world is faintly visible everywhere
    this.scene.add(new THREE.AmbientLight(0x223344, 0.35));
    this.scene.add(new THREE.HemisphereLight(0x355577, 0x06101a, 0.55));

    // Sub headlight — forward-facing spotlight parented to the camera (porthole view)
    // Cookie texture gives uneven, water-distorted beam; sharp quadratic falloff
    const headlight = new THREE.SpotLight(0xCCE6FF, 6.0, 18, Math.PI / 4.5, 0.4, 2);
    headlight.position.set(0, 0, 0);
    headlight.target.position.set(0, 0, -1);
    this.headlightCookie = makeAnimatedHeadlightCookie();
    headlight.map = this.headlightCookie.texture;
    this.camera.add(headlight);
    this.camera.add(headlight.target);
    // Soft close-range fill so nearby walls aren't pitch black at the edges of the cone
    const fill = new THREE.PointLight(0x4466AA, 0.45, 6);
    fill.position.set(0, 0, 0);
    this.camera.add(fill);

    // Effect composer: bloom → vignette → film grain → chromatic aberration → color grade
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(GAME_W, GAME_H), 0.45, 0.4, 0.75);
    this.composer.addPass(bloom);

    // Vignette — strong corner darkening for tunnel vision
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.offset.value = 0.35;
    vignettePass.uniforms.darkness.value = 0.9;
    this.composer.addPass(vignettePass);

    // Film grain — live static noise each frame
    const grainPass = new ShaderPass(FilmGrainShader);
    grainPass.uniforms.intensity.value = 0.03;
    this.grainUniforms = grainPass.uniforms as typeof this.grainUniforms;
    this.composer.addPass(grainPass);

    // Chromatic aberration — R/B fringing at screen edges
    const caPass = new ShaderPass(ChromaticAberrationShader);
    caPass.uniforms.strength.value = 0.004;
    this.composer.addPass(caPass);

    // Color grading — S-curve, desaturate, cyan-green mid-tone, cool shadows
    const colorGradePass = new ShaderPass(ColorGradeShader);
    this.composer.addPass(colorGradePass);

    // Build cockpit (attached to camera)
    const { sweep } = buildCockpit(this.camera);
    this.cockpitSweep = sweep;

    // HUD canvas size
    this.hudCanvas.width = GAME_W;
    this.hudCanvas.height = GAME_H;
  }

  private bindInput() {
    window.addEventListener("keydown", (e) => {
      this.keys[e.code] = true;
      this.ensureAudio();
      if (this.state === "MENU" && (e.code === "Space" || e.code === "Enter")) this.startGame();
      if ((this.state === "CUTSCENE" || this.state === "ENDING_A" || this.state === "ENDING_B") &&
          (e.code === "Space" || e.code === "Enter")) this.advanceCS();
      if (this.state === "GAME_OVER" && e.code === "Space") this.loadLevel(this.lvlIdx);
      if (this.state === "PLAYING") {
        if (e.code === "KeyF") this.dropFlare();
        if (e.code === "KeyE") this.interact();
      }
      if (this.state === "CHOICE") {
        if (e.code === "KeyE") this.makeChoice("A");
        if (e.code === "KeyQ") this.makeChoice("B");
        if (e.code === "KeyR") this.makeChoice("BOTH");
      }
    });
    window.addEventListener("keyup", (e) => { this.keys[e.code] = false; });

    this.threeCanvas.addEventListener("mousemove", (e) => {
      if (this.state === "PLAYING" || this.state === "CHOICE") {
        this.yaw -= e.movementX * MOUSE_SENS;
        // Mouse up = look up, mouse down = look down (standard FPS)
        this.pitch -= e.movementY * MOUSE_SENS;
        this.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.pitch));
      }
    });

    this.threeCanvas.addEventListener("mousedown", () => {
      this.ensureAudio();
      this.mouseHeld = true;
      this.mouseDownAt = Date.now();
      if (this.state === "MENU") this.startGame();
      if (this.state === "CUTSCENE" || this.state === "ENDING_A" || this.state === "ENDING_B") this.advanceCS();
    });

    this.threeCanvas.addEventListener("mouseup", () => {
      if (this.state === "PLAYING" && this.mouseHeld) {
        const held = Date.now() - this.mouseDownAt;
        this.emitSonar(held >= 900 ? "large" : "small");
      }
      this.mouseHeld = false;
    });
  }

  private ensureAudio() {
    if (this.audioReady) return;
    this.audio.init(); this.audio.resume(); this.audio.startBreathing();
    this.audio.initHullStress();
    this.audioReady = true;
  }

  // ============================================================
  // LEVEL MANAGEMENT
  // ============================================================
  private startGame() { this.loadLevel(0); }

  private loadLevel(idx: number) {
    this.lvlIdx = idx;
    const def = [level1(), level2(), level3()][idx];
    this.lvlDef = def;

    // Reset 2D state
    this.px = def.playerStart.x; this.py = def.playerStart.y;
    this.pvx = this.pvy = 0;
    this.o2 = def.o2Start; this.flares = 3;
    this.invTimer = 0; this.glitchTimer = 0;
    this.noise = 0; this.alarmTimer = 0; this.lvlTime = 0;
    this.pings = []; this.flareObjs = [];
    this.puzzleDone = false; this.sacrificing = false; this.transitioning = false;
    this.hullIntegrity = 100; this.hullInDanger = false; this.sonarCharge = 100;
    this.hullDamageCooldown = 0; this.shakeTimer = 0; this.shakeIntensity = 0; this.shakeDuration = 160;
    this.gameOverReason = "oxygen";
    this.sonarSwitchAnim = 0; this.flareSwitchAnim = 0;
    this.valveSonarAngle = 0; this.valveFlareAngle = 0;
    const depthBase = [20, 55, 82][idx] ?? 20;
    this.gaugeDisplay = { o2: def.o2Start, depth: depthBase, sonarCharge: 100, hull: 100, flares: 3 };
    this.levPulseTimer = 8000; this.levBlocked = false;
    this.nearPod = null; this.nearNoise = null;
    this.subtitle = ""; this.subTimer = 0;

    this.activeFadeSet = new Set();
    this.boostPingCooldown = 0;
    this.enemies = def.enemyDefs.map(e => ({ ...e, state: "patrol" as const, visTimer: 0, listenTimer: 0, damagedAt: 0 }));
    this.pods = def.pods.map(p => ({ ...p }));
    this.noiseObjs = (def.noiseObjs || []).map(o => ({ ...o }));
    this.dlgQueue = [...def.dialogue];

    this.camX = def.playerStart.x; this.camY = def.playerStart.y;
    this.yaw = Math.PI;   // face +Z (into tunnel)
    this.pitch = 0;
    this.smoothFwd = 0; this.smoothSide = 0;
    this.prevYaw = Math.PI;
    this.cameraRoll = 0; this.cameraPitchOff = 0;

    // Reset hull stress state for new level
    this.hullStressTier = -1;
    this.hullStressTimer = 0;
    this.sharpTurnCooldown = 0;
    this.lastYawStress = Math.PI;
    this.hullGainRampTimer = 0;

    // Show level-transition screen immediately so the user sees something
    // meaningful while build3DScene awaits the GLB, and to block re-triggering
    // from MENU/GAME_OVER input handlers before PLAYING state is set.
    this.transitionTargetLvl = idx;
    this.transitionStartMs = Date.now();
    this.state = "LEVEL_TRANSITION";

    // Build 3D scene async — sets state to PLAYING on completion.
    void this.build3DScene(def);
  }

  private async build3DScene(def: LevelData): Promise<void> {
    // Increment the build token on every call.  After the async await below we
    // compare against this captured token; if they differ, a newer build has started
    // and we silently discard our results to prevent duplicate scene/obstacle state.
    const buildToken = ++this._sceneBuildToken;

    // Dispose previous scene content recursively (geometries + materials + textures)
    this.sceneGroup.traverse((obj) => {
      const g = (obj as THREE.Mesh | THREE.LineSegments | THREE.Points | THREE.Sprite).geometry as THREE.BufferGeometry | undefined;
      if (g && typeof g.dispose === "function") g.dispose();
      const matAny = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (matAny) {
        const mats = Array.isArray(matAny) ? matAny : [matAny];
        for (const m of mats) {
          const tex = (m as THREE.MeshBasicMaterial).map;
          if (tex && typeof tex.dispose === "function") tex.dispose();
          if (typeof m.dispose === "function") m.dispose();
        }
      }
    });
    while (this.sceneGroup.children.length > 0) this.sceneGroup.remove(this.sceneGroup.children[0]);
    // Also dispose any in-flight ping spheres / flare meshes that live on this.scene
    for (const p3 of this.ping3Ds) { this.scene.remove(p3.sphere); p3.sphere.geometry.dispose(); p3.mat.dispose(); }
    for (const fm of this.flareMeshes) { this.scene.remove(fm.mesh); }
    this.revealObjs = [];
    this.enemyObjs = [];
    this.podObjs = [];
    this.noiseObjMeshes = [];
    this.ping3Ds = [];
    this.flareMeshes = [];
    this.particleSystem = null; // (lived in sceneGroup; already removed above)
    if (this.sonarOverlayMat) { this.sonarOverlayMat.dispose(); this.sonarOverlayMat = null; }

    // ── Shared sonar overlay material — created early so ALL terrain gets it ──
    this.sonarOverlayMat = new THREE.ShaderMaterial({
      vertexShader:   SONAR_VERT,
      fragmentShader: SONAR_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
      side:           THREE.DoubleSide,
      uniforms: {
        uPingOrigin:  { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
        uPingRadius:  { value: [0, 0, 0, 0, 0] },
        uPingOpacity: { value: [0, 0, 0, 0, 0] },
      },
    });
    const omat = this.sonarOverlayMat;

    // Helper: add an overlay twin for any Mesh (same geometry, sonar shader)
    const addOverlay = (m: THREE.Mesh) => {
      const ov = new THREE.Mesh(m.geometry, omat);
      ov.position.copy(m.position);
      ov.rotation.copy(m.rotation);
      ov.scale.copy(m.scale);
      this.sceneGroup.add(ov);
    };

    // Muted deep-sea rock palette for solid lit walls
    const wallPalette = [0x2a3a4a, 0x223040, 0x304050, 0x1f2a35, 0x283848, 0x35455a];

    // Obstacle boxes — solid lit walls + sonar overlay twin
    let pi = 0;
    for (const rect of def.obstacles) {
      const c = wallPalette[pi++ % wallPalette.length];
      const obsMesh = buildObstacleMesh(rect, c);
      this.sceneGroup.add(obsMesh);
      addOverlay(obsMesh);
    }

    // Floor grid cells — solid lit floor + ceiling + sonar overlay per tile
    const fCols = Math.ceil(def.worldW / FLOOR_CELL);
    const fRows = Math.ceil(def.worldH / FLOOR_CELL);
    for (let row = 0; row < fRows; row++) {
      for (let col = 0; col < fCols; col++) {
        const cx = (col + 0.5) * FLOOR_CELL, cy = (row + 0.5) * FLOOR_CELL;
        const cellW = Math.min(FLOOR_CELL, def.worldW - col * FLOOR_CELL);
        const cellH = Math.min(FLOOR_CELL, def.worldH - row * FLOOR_CELL);
        const floorM = buildFloorMesh(cx, cy, cellW, cellH);
        this.sceneGroup.add(floorM);
        addOverlay(floorM);
        if ((col + row) % 2 === 0) {
          const ceilM = buildCeilMesh(cx, cy, cellW * 2, cellH * 2);
          this.sceneGroup.add(ceilM);
          addOverlay(ceilM);
        }
      }
    }

    // Stalactites / stalagmites — solid lit cones + sonar overlay twin
    const stalaCount = Math.floor(def.worldW * def.worldH / 18000);
    for (let i = 0; i < stalaCount; i++) {
      const x3d = (50 + Math.random() * (def.worldW - 100)) * WS;
      const z3d = (50 + Math.random() * (def.worldH - 100)) * WS;
      const h = 0.8 + Math.random() * 3;
      const onFloor = Math.random() > 0.5;
      const stalaM = buildStalactiteMesh(x3d, z3d, onFloor, h);
      this.sceneGroup.add(stalaM);
      addOverlay(stalaM);
    }

    // Bioluminescent point lights scattered throughout (always visible — deep ocean)
    this.sceneGroup.add(buildBioLights(def.worldW, def.worldH));

    // RESEARCH VESSEL ODYSSEY — featured wreck in level 1 (matches reference image)
    if (def.id === 1) {
      const ship = buildOdysseyShip();
      ship.position.set(400 * WS, 0.05, 2620 * WS);
      ship.rotation.y = -0.15;
      this.sceneGroup.add(ship);
      const bulkLabel = makeBillboard("DATA BULKHEAD", "#FFAA22", 4, 0.9);
      bulkLabel.material.opacity = 0.85;
      bulkLabel.position.set(400 * WS + 0.6, 1.4, 2620 * WS + 1.2);
      this.sceneGroup.add(bulkLabel);
      const bulkCube = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.45, 0.2),
        new THREE.MeshBasicMaterial({ color: 0xFFAA22, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }),
      );
      bulkCube.position.set(400 * WS + 0.6, 0.9, 2620 * WS + 1.0);
      this.sceneGroup.add(bulkCube);
      const bulkLight = new THREE.PointLight(0xFF9911, 1.6, 6);
      bulkLight.position.copy(bulkCube.position);
      this.sceneGroup.add(bulkLight);
    }

    // Enemies — wrap with THREAT DETECTED label
    for (const enemy of this.enemies) {
      let built: { group: THREE.Group; mats: THREE.LineBasicMaterial[] };
      if (enemy.type === "drifter") built = buildDrifterGroup();
      else if (enemy.type === "stalker") built = buildStalkerGroup();
      else {
        // Leviathan — large procedural sea-serpent
        built = buildLeviathanGroup();
        // Always-on red rim light so the silhouette reads in the dark
        const rim = new THREE.PointLight(0xFF3344, 1.2, 36);
        rim.position.set(0, 3, 0);
        built.group.add(rim);
      }
      const labelY = enemy.type === "leviathan" ? 11 : 3.4;
      const label = makeBillboard("THREAT DETECTED", "#FF4444", enemy.type === "leviathan" ? 6.5 : 4.2, enemy.type === "leviathan" ? 1.4 : 1.0);
      label.position.set(0, labelY, 0);
      built.group.add(label);
      built.group.visible = false;
      this.sceneGroup.add(built.group);
      this.enemyObjs.push({ group: built.group, mats: built.mats, label, labelMat: label.material as THREE.SpriteMaterial, jitterTimer: 0 });
    }

    // Lifepods — labelled with character name
    for (const pod of this.pods) {
      const pobj = buildPodMesh();
      pobj.group.position.set(pod.x * WS, EYE_H * 0.6, pod.y * WS);
      const label = makeBillboard(`${pod.character} — LIFEPOD`, "#22FFAA", 4.2, 0.95);
      label.position.set(0, 2.2, 0);
      pobj.group.add(label);
      pobj.group.visible = false;
      this.sceneGroup.add(pobj.group);
      this.podObjs.push({ ...pobj, label, labelMat: label.material as THREE.SpriteMaterial });
    }

    // Noise objects (L2)
    for (const nobj of this.noiseObjs) {
      const group = buildNoiseObjMesh();
      group.position.set(nobj.x * WS, 1.0, nobj.y * WS);
      this.sceneGroup.add(group);
      this.noiseObjMeshes.push({ group, mat: group.userData.mat as THREE.LineBasicMaterial });
    }

    // Bioluminescent particles
    this.particleSystem = buildParticles(def.worldW, def.worldH);
    this.sceneGroup.add(this.particleSystem);

    // ── Natural ocean obstacle scattering ──────────────────────────────────────
    // Await GLB rock geometry so fallback is only used on explicit failure,
    // never because the asset is still in-flight.
    // Per-level deterministic seeds: rocks 1001/2001/3001, walls 2001/3001/4001,
    // debris 3001/4001/5001.  Results integrate into sceneGroup, revealObjs, and
    // def.obstacles so all three systems (3D render, sonar reveal, 2D collision)
    // stay consistent across levels and re-loads.
    const rockGeo    = await _rockLoadPromise;

    // Guard: if loadLevel was called again while we were awaiting, a newer token
    // has been issued.  Discard this build silently to prevent appending duplicate
    // meshes/obstacles/revealObjs on top of the newer scene.
    if (buildToken !== this._sceneBuildToken) return;
    const rockSeed   = 1001 + (def.id - 1) * 1000;
    const wallSeed   = 2001 + (def.id - 1) * 1000;
    const debrisSeed = 3001 + (def.id - 1) * 1000;

    const rocksR     = scatterRocks(rockSeed,      def.worldW, def.worldH, rockGeo);
    const wallsR     = scatterWalls(wallSeed,      def.worldW, def.worldH);
    const debrisR    = scatterDebris(debrisSeed,   def.worldW, def.worldH);
    const platformsR = scatterPlatforms(4001 + (def.id - 1) * 1000, def.worldW, def.worldH);

    // ── Add scatter meshes + overlay twins ────────────────────────────────────
    // LineSegments (EdgesGeometry reveals) are skipped — the shader handles all
    // terrain reveal.  revealEntries are not pushed to revealObjs for the same reason.
    for (const sr of [rocksR, wallsR, debrisR, platformsR]) {
      for (const mesh of sr.meshes) {
        if (mesh instanceof THREE.LineSegments) continue; // shader handles terrain
        this.sceneGroup.add(mesh);
        addOverlay(mesh as THREE.Mesh);
      }
      for (const rect of sr.rects) def.obstacles.push(rect);
    }

    // Transition to PLAYING after the async scatter is done
    this.state = "PLAYING";
  }

  // ============================================================
  // GAME MECHANICS (2D logic unchanged)
  // ============================================================
  private emitSonar(type: "small" | "large") {
    if (this.levBlocked) { this.showSub("[ LEVIATHAN PULSE — SONAR DISRUPTED ]"); return; }
    const maxR = type === "small" ? SONAR_SMALL_R : SONAR_LARGE_R;
    const speed = type === "small" ? 210 : 290;
    this.noise = Math.min(100, this.noise + (type === "small" ? SONAR_SMALL_NOISE : SONAR_LARGE_NOISE));
    this.audio.sonar(type);
    this.sonarCharge = Math.max(0, this.sonarCharge - (type === "small" ? 25 : 50));
    this.sonarSwitchAnim = 200;
    this.valveSonarAngle += Math.PI * (type === "small" ? 0.6 : 1.2);
    this._spawnPing(this.px, this.py, maxR, speed, 0x00CCFF, type);
  }

  private _spawnPing(px: number, py: number, maxR: number, speed: number, color: number, type: "small" | "large" | "flare" | "boost") {
    // Cap total active pings at 5 — dispose oldest first
    if (this.pings.length >= 5) {
      this.pings.shift();
      if (this.ping3Ds.length > 0) {
        const oldest3D = this.ping3Ds.shift()!;
        this.scene.remove(oldest3D.sphere);
        oldest3D.sphere.geometry.dispose();
        (oldest3D.mat as THREE.Material).dispose();
      }
    }
    // Pre-filter: collect only objects within maxRadius + margin
    const nearbyObjs: number[] = [];
    for (let ri = 0; ri < this.revealObjs.length; ri++) {
      const ro = this.revealObjs[ri];
      const d = Math.hypot(ro.cx - px, ro.cy - py);
      if (d <= maxR + 28) nearbyObjs.push(ri);
    }
    const newPing: Ping = {
      x: px, y: py, radius: 0, maxRadius: maxR,
      type, thickness: 26, speed, color,
      paintedObjects: new Set(), paintedEnemies: new Set(), paintedPods: new Set(),
      screeches: new Set(),
      nearbyObjs,
    };
    // Pre-schedule audio at exact distance-crossing times via AudioContext clock.
    // Only for small/large pings (flare/boost don't trigger enemy detects or wall echoes).
    if (this.audioReady && (type === "small" || type === "large")) {
      // Enemy screeches — one per enemy in range, timed to radius-distance crossing
      for (let ei = 0; ei < this.enemies.length; ei++) {
        const e = this.enemies[ei];
        const eDist = Math.hypot(e.x - px, e.y - py);
        if (eDist <= maxR) {
          this.audio.metallicScreech(eDist / speed);
          newPing.screeches.add(ei); // pre-mark so band-test skips audio re-fire
        }
      }
      // Wall echo — timed to ring crossing nearest boundary
      if (this.lvlDef) {
        const minWall = Math.min(px, this.lvlDef.worldW - px, py, this.lvlDef.worldH - py);
        this.audio.wallEcho(type === "large", minWall / speed);
      }
    }
    this.pings.push(newPing);
    // 3D ring shell
    const sGeo = new THREE.SphereGeometry(0.5, 16, 12);
    const smat = new THREE.MeshBasicMaterial({
      color, wireframe: true, transparent: true,
      opacity: type === "boost" ? 0.18 : 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sphere = new THREE.Mesh(sGeo, smat);
    sphere.position.set(px * WS, EYE_H, py * WS);
    this.scene.add(sphere);
    this.ping3Ds.push({ sphere, mat: smat, maxR: maxR * WS, radius: 0, ox: px, oy: py, type, warpTimer: 0, warpPos: null });
  }

  private dropFlare() {
    if (this.flares <= 0) return;
    this.flares--;
    this.flareObjs.push({ x: this.px, y: this.py, vy: 18, timer: FLARE_DURATION, pingTimer: 0 });
    this.noise = Math.min(100, this.noise + 5);
    this.audio.flare();
    this.flareSwitchAnim = 200;
    this.valveFlareAngle += Math.PI * 0.75;
    // 3D flare with FLARE label and orbital ring
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0xFF6600, blending: THREE.AdditiveBlending }));
    const light = new THREE.PointLight(0xFF6600, 2.5, 60 * WS);
    light.position.set(0, 0, 0);
    mesh.add(light);
    // Orbital ring (visual cue like the reference image)
    const ringGeo = new THREE.TorusGeometry(0.55, 0.025, 6, 24);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xFFAA33, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }));
    ring.rotation.x = Math.PI / 2;
    mesh.add(ring);
    // FLARE billboard label
    const label = makeBillboard("FLARE", "#FFAA33", 1.6, 0.5);
    label.material.opacity = 0.9;
    label.position.set(0, 1.1, 0);
    mesh.add(label);
    mesh.position.set(this.px * WS, EYE_H, this.py * WS);
    this.scene.add(mesh);
    this.flareMeshes.push({ mesh, light });
  }

  private interact() {
    if (this.transitioning) return;
    for (const o of this.noiseObjs) {
      if (o.silenced) continue;
      if (Math.hypot(o.x - this.px, o.y - this.py) < INTERACT_RADIUS) {
        o.silenced = true;
        this.showSub("[ NOISE SOURCE SILENCED ]");
        this.checkPuzzle(); return;
      }
    }
    for (const p of this.pods) {
      if (p.rescued) continue;
      if (Math.hypot(p.x - this.px, p.y - this.py) < INTERACT_RADIUS) {
        if (this.lvlDef?.id === 2 && p.id === "noah" && !this.puzzleDone) {
          this.showSub("[ DEBRIS FIELD BLOCKING — SILENCE ALL NOISE SOURCES FIRST ]"); return;
        }
        if (this.lvlDef?.id === 3) { this.state = "CHOICE"; return; }
        this.dockPod(p); return;
      }
    }
  }

  private dockPod(pod: Lifepod) {
    pod.rescued = true;
    this.o2 = Math.min(100, this.o2 + 20);
    this.showSub(pod.commsLine);
    this.audio.dock();
    if (this.pods.every(p => p.rescued)) { this.transitioning = true; setTimeout(() => this.completeLevel(), 2200); }
  }

  private checkPuzzle() {
    if (this.noiseObjs.every(o => o.silenced) && !this.puzzleDone) {
      this.puzzleDone = true;
      this.showSub("[ ALL SOURCES SILENCED — DEBRIS FIELD DISINTEGRATING — POD RELEASED ]");
    }
  }

  private completeLevel() {
    if (this.lvlIdx === 0) this.startCS(CS1, () => this.showLevelTransition(1, () => this.loadLevel(1)));
    else if (this.lvlIdx === 1) this.startCS(CS2, () => this.showLevelTransition(2, () => this.loadLevel(2)));
  }

  private showLevelTransition(nextIdx: number, cb: () => void) {
    this.transitionTargetLvl = nextIdx;
    this.transitionStartMs = Date.now();
    this.transitionCallback = cb;
    this.state = "LEVEL_TRANSITION";
  }

  private makeChoice(c: "A" | "B" | "BOTH") {
    this.state = "PLAYING"; this.transitioning = true;
    if (c === "BOTH") {
      this.sacrificing = true;
      this.showSub('Elias: "Rerouting suit oxygen... Locking both pods in."');
      for (const p of this.pods) p.rescued = true;
      setTimeout(() => { this.audio.flatline(); this.state = "ENDING_B"; this.startCS(END_B, () => { this.state = "MENU"; }); }, 3000);
    } else {
      const podId = c === "A" ? "liam" : "mia";
      const pod = this.pods.find(p => p.id === podId)!;
      pod.rescued = true; this.audio.dock();
      this.showSub(`Elias: "Docking with ${pod.character}'s pod. Oxygen critical."`);
      setTimeout(() => { this.state = "ENDING_A"; this.startCS(END_A, () => { this.state = "MENU"; }); }, 3000);
    }
  }

  private triggerGameOver() {
    this.showSub('Elias: "I\'m sorry..."'); this.transitioning = true;
    setTimeout(() => { this.state = "GAME_OVER"; }, 2200);
  }

  // ============================================================
  // CUTSCENE
  // ============================================================
  private startCS(panels: CutscenePanel[], cb: () => void) {
    this.csPanels = panels; this.csPanelIdx = 0;
    this.csTextLen = 0; this.csTextTimer = 0;
    this.csPhase = "typing"; this.csCallback = cb;
  }

  private advanceCS() {
    if (this.csPhase === "typing") {
      this.csTextLen = this.csPanels[this.csPanelIdx].text.length;
      this.csPhase = "waiting";
    } else {
      this.csPanelIdx++;
      if (this.csPanelIdx >= this.csPanels.length) { this.csCallback?.(); this.csCallback = null; }
      else { this.csTextLen = 0; this.csTextTimer = 0; this.csPhase = "typing"; }
    }
  }

  private showSub(text: string, ms = 5500) {
    this.subtitle = text; this.subTimer = ms;
    if (this.audioReady) this.audio.speak(text);
  }

  // ============================================================
  // UPDATE
  // ============================================================
  private update(dt: number) {
    const isCS = this.state === "CUTSCENE" || this.state === "ENDING_A" || this.state === "ENDING_B";
    if (this.state === "MENU" || this.state === "GAME_OVER") return;
    if (isCS) { this.updateCS(dt); return; }
    if (this.state === "CHOICE") { this.updatePings3D(dt); return; }
    if (this.state === "LEVEL_TRANSITION") {
      const elapsed = Date.now() - this.transitionStartMs;
      if (elapsed >= this.transitionDurationMs && this.transitionCallback) {
        const cb = this.transitionCallback;
        this.transitionCallback = null;
        cb();
      }
      return;
    }
    if (this.state !== "PLAYING") return;

    this.lvlTime += dt / 1000;
    this.updateDialogue();
    this.updatePlayer(dt);
    this.updateCameraPhysics(dt);
    this.updateEnemies(dt);
    this.updatePings(dt);
    this.updateFlares(dt);
    this.updateNoise(dt);
    this.updateO2(dt);
    this.updateDashboard(dt);
    this.updateCamera(dt);
    this.updateInteractables();
    this.updateLeviathan(dt);
    this.updatePings3D(dt);
    this.updateSonarShader();
    this.updateFlareMeshes(dt);
    this.updateRevealFade(dt);
    this.updateHullStress(dt);
    if (this.subTimer > 0) this.subTimer -= dt;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
  }

  private updateDialogue() {
    for (let i = this.dlgQueue.length - 1; i >= 0; i--) {
      if (this.lvlTime >= this.dlgQueue[i].time) {
        this.showSub(this.dlgQueue[i].text, 6000);
        this.dlgQueue.splice(i, 1); break;
      }
    }
  }

  private updatePlayer(dt: number) {
    const def = this.lvlDef!;
    const dtS = dt / 1000;
    const boosting = this.keys["ShiftLeft"] || this.keys["ShiftRight"];

    // ── Step 1: Raw key input axes ([-1, 0, 1]) ──
    const rawFwd  = (this.keys["KeyW"] || this.keys["ArrowUp"]    ? 1 : 0)
                  - (this.keys["KeyS"] || this.keys["ArrowDown"]  ? 1 : 0);
    const rawSide = (this.keys["KeyD"] || this.keys["ArrowRight"] ? 1 : 0)
                  - (this.keys["KeyA"] || this.keys["ArrowLeft"]  ? 1 : 0);

    // ── Step 2: Input smoothing — lerp toward raw each frame ──
    // Scale lerp rate to be frame-rate independent (~0.12 per 1/60 s frame)
    const smoothRate = 1 - Math.pow(1 - INPUT_SMOOTH_K, dtS * 60);
    this.smoothFwd  += (rawFwd  - this.smoothFwd)  * smoothRate;
    this.smoothSide += (rawSide - this.smoothSide) * smoothRate;

    // ── Step 3: Direction vectors from current yaw ──
    // forward3D = (-sin(yaw), 0, -cos(yaw)); mapped to 2D: fwdX, fwdY
    const fwdX =  -Math.sin(this.yaw);
    const fwdY =  -Math.cos(this.yaw);
    const rgtX =   Math.cos(this.yaw);
    const rgtY =  -Math.sin(this.yaw);

    // ── Step 4: Apply force from smoothed input ──
    const spd = PLAYER_SPEED * (boosting ? PLAYER_BOOST_MULT : 1);
    const forceX = (fwdX * this.smoothFwd + rgtX * this.smoothSide) * spd;
    const forceY = (fwdY * this.smoothFwd + rgtY * this.smoothSide) * spd;
    this.pvx += forceX * dtS;
    this.pvy += forceY * dtS;

    // ── Step 5: Non-linear drag — base drag + speed-squared term ──
    const speed = Math.hypot(this.pvx, this.pvy);
    const dragRate = FLUID_BASE_DRAG + FLUID_SPEED_DRAG * speed * speed;
    const dragFactor = Math.max(0, 1 - dragRate * dtS);
    this.pvx *= dragFactor;
    this.pvy *= dragFactor;

    // Boost noise while sprinting with input
    if (boosting && (rawFwd || rawSide)) this.noise = Math.min(100, this.noise + 2.5 * dtS);

    // Boost auto-ping: while shift held, fire a dim ping every 2 s
    if (boosting) {
      this.boostPingCooldown -= dt;
      if (this.boostPingCooldown <= 0) {
        this.boostPingCooldown = 2000;
        this._spawnPing(this.px, this.py, 100, 120, 0x888888, "boost");
        this.noise = Math.min(100, this.noise + 8);
      }
    } else {
      this.boostPingCooldown = 0;
    }

    const nx = this.px + this.pvx * dtS;
    const ny = this.py + this.pvy * dtS;
    const [rx, ry] = this.collide(nx, ny, PLAYER_SIZE, def.obstacles);
    this.px = Math.max(PLAYER_SIZE + 2, Math.min(def.worldW - PLAYER_SIZE - 2, rx));
    this.py = Math.max(PLAYER_SIZE + 2, Math.min(def.worldH - PLAYER_SIZE - 2, ry));

    // ── Hull collision damage ──
    if (this.hullDamageCooldown > 0) this.hullDamageCooldown -= dt;

    // Correction vector: how far we were pushed out of the obstacle/wall
    const corrX = this.px - nx;
    const corrY = this.py - ny;
    const corrDist = Math.hypot(corrX, corrY);

    if (corrDist > 0.4 && this.hullDamageCooldown <= 0 && !this.transitioning) {
      // Project velocity onto outward collision normal to get approach speed
      const normX = corrX / corrDist, normY = corrY / corrDist;
      const approachVel = -(this.pvx * normX + this.pvy * normY);
      const isDirect = approachVel > 90; // px/s — head-on threshold

      const damage = isDirect ? 18 + Math.random() * 7 : 5 + Math.random() * 3;
      this.hullIntegrity = Math.max(0, this.hullIntegrity - damage);
      this.hullDamageCooldown = 600;

      // Spring kick on hull needle — overshoot effect
      this.gaugeVelocity.hull -= isDirect ? 65 : 28;
      this.hullBezelFlash = isDirect ? 620 : 340;

      // Camera shake — intensity and duration scale with severity
      this.shakeTimer = isDirect ? 320 : 160;
      this.shakeDuration = isDirect ? 320 : 160;
      this.shakeIntensity = isDirect ? 0.07 : 0.028;

      // Metallic impact sound
      if (this.audioReady) this.audio.impact(isDirect ? "direct" : "graze");
    }
  }

  private updateCameraPhysics(dt: number) {
    const dtS = dt / 1000;
    // Guard against zero-delta frames (e.g. tab backgrounded) to prevent NaN
    if (dtS <= 0) return;

    // ── Roll: proportional to turn rate (delta yaw per second) ──
    const deltaYaw = this.yaw - this.prevYaw;
    this.prevYaw = this.yaw;
    // Only update prevYaw each physics tick; deltaYaw is yaw change this frame
    const yawRate = deltaYaw / dtS;  // radians per second
    const targetRoll = Math.max(-CAM_ROLL_MAX, Math.min(CAM_ROLL_MAX, -yawRate * CAM_ROLL_SENS));
    // Lerp roll toward target when turning, back to 0 when not
    const rollLerp = Math.min(1, CAM_ROLL_RETURN * dtS);
    this.cameraRoll += (targetRoll - this.cameraRoll) * rollLerp;

    // ── Buoyancy drift: sinusoidal Y offset when no vertical input ──
    // lvlTime is in seconds; BUOY_FREQ in rad/s
    // Velocity of buoyancy position = d/dt [BUOY_AMP * sin(BUOY_FREQ * t)]
    //                                = BUOY_AMP * BUOY_FREQ * cos(BUOY_FREQ * t)
    const buoyancyVel = BUOY_AMP * BUOY_FREQ * Math.cos(BUOY_FREQ * this.lvlTime);

    // ── Pitch: map buoyancy vertical velocity to a gentle nose pitch ──
    const velScale = CAM_PITCH_MAX / (BUOY_AMP * BUOY_FREQ);
    const targetPitch = Math.max(-CAM_PITCH_MAX, Math.min(CAM_PITCH_MAX, buoyancyVel * velScale));
    const pitchLerp = Math.min(1, CAM_PITCH_RETURN * dtS);
    this.cameraPitchOff += (targetPitch - this.cameraPitchOff) * pitchLerp;
  }

  private collide(x: number, y: number, r: number, obs: Rect[]): [number, number] {
    let rx = x, ry = y;
    for (const o of obs) {
      const cx = Math.max(o.x, Math.min(rx, o.x + o.w));
      const cy = Math.max(o.y, Math.min(ry, o.y + o.h));
      const dx = rx - cx, dy = ry - cy;
      const d = Math.hypot(dx, dy);
      if (d < r && d > 0) { const ov = r - d; rx += (dx / d) * ov; ry += (dy / d) * ov; }
      else if (d === 0) rx = o.x + o.w + r + 1;
    }
    return [rx, ry];
  }

  private updateEnemies(dt: number) {
    const dtS = dt / 1000;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.visTimer > 0) e.visTimer -= dt;
      const dist = Math.hypot(e.x - this.px, e.y - this.py);
      if (this.noise >= 61 && dist < 700) e.state = "hunt";
      else if (this.noise >= 31 && dist < 500) e.state = "alert";
      else e.state = "patrol";

      let tx: number, ty: number, sm = 1;
      if (e.state === "hunt") { tx = this.px; ty = this.py; sm = 1.9; }
      else { const wp = e.waypoints[e.wpIdx]; tx = wp.x; ty = wp.y; sm = e.state === "alert" ? 1.4 : 1; }

      const pausing = e.type === "stalker" && e.state === "alert" && e.listenTimer > 0;
      if (!pausing) {
        const edx = tx - e.x, edy = ty - e.y, ed = Math.hypot(edx, edy);
        if (ed > 6) { e.x += (edx / ed) * e.speed * sm * dtS; e.y += (edy / ed) * e.speed * sm * dtS; }
        else if (e.state !== "hunt") { e.wpIdx = (e.wpIdx + 1) % e.waypoints.length; if (e.type === "stalker") e.listenTimer = 1800; }
      }
      if (e.type === "stalker" && e.state === "alert" && e.listenTimer > 0) e.listenTimer -= dt;

      // Player hit
      if (this.invTimer <= 0 && dist < e.hitR + PLAYER_SIZE * 0.8) {
        this.o2 = Math.max(0, this.o2 - O2_LOSS_HIT); this.invTimer = 2200;
        this.glitchTimer = 700; this.noise = Math.min(100, this.noise + 20);
        this.hullIntegrity = Math.max(0, this.hullIntegrity - 14);
        // Spring overshoot kick — needle slams past new value then bounces back
        this.gaugeVelocity.hull -= 55;
        this.gaugeVelocity.o2   -= 30;
        this.hullBezelFlash = 480;
        this.audio.damage(); this.showSub("[ HULL BREACH — OXYGEN DEPLETED ]");
        if (e.type === "leviathan") this.audio.leviathanRoar(2);
      }
      // Periodic leviathan roar when hunting (scary stalking growl)
      if (e.type === "leviathan") {
        e.roarTimer = (e.roarTimer ?? 0) - dt;
        if (e.roarTimer <= 0) {
          // Roar more often when hunting, occasionally when alert, rarely when patrolling
          const interval = e.state === "hunt" ? 3500 : e.state === "alert" ? 7000 : 14000;
          e.roarTimer = interval + Math.random() * 1500;
          this.audio.leviathanRoar(e.state === "hunt" ? 2 : 1);
        }
      }
      if (this.invTimer > 0) this.invTimer -= dt;

      // Sync 3D enemy position — always render, sonar controls brightness
      if (i < this.enemyObjs.length) {
        const eobj = this.enemyObjs[i];
        const sonarA = Math.min(1, e.visTimer / 900);
        // Base dim presence (0.08 min) so creature is always faintly visible; spikes on sonar
        const a = Math.max(0.08, sonarA);
        eobj.group.visible = true;

        // Jitter on sonar ping hit: randomize group position offset for 0.5 s
        let jx = 0, jy = 0, jz = 0;
        if (eobj.jitterTimer > 0) {
          eobj.jitterTimer -= dt;
          const jStr = (eobj.jitterTimer / 500) * 0.18 * WS;
          jx = (Math.random() - 0.5) * jStr;
          jy = (Math.random() - 0.5) * jStr * 0.5;
          jz = (Math.random() - 0.5) * jStr;
          if (eobj.jitterTimer <= 0) {
            // Restore normal color after jitter ends
            for (const m of eobj.mats) m.color.set(0x00FFFF);
          }
        }
        eobj.group.position.set(e.x * WS + jx, EYE_H * 0.5 + jy, e.y * WS + jz);
        eobj.group.rotation.y += 0.012;

        // During jitter: keep red flash; otherwise normal opacity animation
        if (eobj.jitterTimer > 0) {
          const flashPulse = 0.7 + Math.sin(Date.now() / 40) * 0.3;
          for (const mat of eobj.mats) mat.opacity = flashPulse;
        } else {
          for (const mat of eobj.mats) mat.opacity = a * (0.7 + Math.random() * 0.3);
        }
        // THREAT DETECTED label — only show during sonar reveal
        eobj.labelMat.opacity = sonarA * (0.65 + Math.sin(Date.now() / 180) * 0.35);
        // Boost the rim light intensity: dim always, bright on sonar
        eobj.group.traverse((child) => {
          if ((child as THREE.PointLight).isPointLight) {
            (child as THREE.PointLight).intensity = 0.3 + sonarA * 2.8;
          }
        });
        // Pulse bioluminescent stripes (Ghost Leviathan) at medium speed
        const bioMats = eobj.group.userData.bioMats as THREE.MeshBasicMaterial[] | undefined;
        if (bioMats) {
          // Medium pulse ~0.6 Hz, range 0.35 .. 1.0, brighter on sonar
          const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 280);
          const baseAlpha = 0.35 + pulse * 0.55;
          for (const m of bioMats) m.opacity = Math.min(1, baseAlpha + sonarA * 0.4);
        }
      }
    }
  }

  private updatePings(dt: number) {
    const def = this.lvlDef;
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.radius += p.speed * (dt / 1000);
      const inner = p.radius - p.thickness;
      const outer = p.radius + p.thickness;

      // ── Terrain objects — band test on pre-filtered nearbyObjs ──
      for (const ri of p.nearbyObjs) {
        if (p.paintedObjects.has(ri)) continue;
        const ro = this.revealObjs[ri];
        const d = Math.hypot(ro.cx - p.x, ro.cy - p.y);
        if (d >= inner && d <= outer) {
          p.paintedObjects.add(ri);
          const dur = p.type === "flare" ? 3000 : 4000;
          const tint = p.type === "flare" ? 0xFF8C00 : 0x22BBFF;
          ro.fadeTimer = dur;
          ro.fadeDuration = dur;
          ro.tintColor = tint;
          ro.mat.color.set(tint);
          ro.alpha = 1;
          this.activeFadeSet.add(ro);
        }
      }

      // ── Enemies — band test with paintedEnemies gate ──
      for (let ei = 0; ei < this.enemies.length; ei++) {
        const e = this.enemies[ei];
        const ed = Math.hypot(e.x - p.x, e.y - p.y);
        if (ed >= inner - e.hitR && ed <= outer + e.hitR) {
          const isNew = !p.paintedEnemies.has(ei);
          if (isNew) {
            p.paintedEnemies.add(ei);
            // Enemy fade: 1.5 s vis timer (consistent with spec)
            e.visTimer = 1500;
            // Enemy special reveal: red flash on all materials
            if (ei < this.enemyObjs.length) {
              const eobj = this.enemyObjs[ei];
              eobj.group.visible = true;
              for (const m of eobj.mats) {
                m.color.set(0xFF3030);
                m.opacity = 1.0;
              }
              eobj.labelMat.opacity = 1.0;
              eobj.jitterTimer = 500;
            }
            // Audio already pre-scheduled at spawn via AudioContext clock; just gate visuals
            p.screeches.add(ei);
            // Show THREAT DETECTED subtitle once per enemy per ping
            this.showSub(`[ THREAT DETECTED — ${e.type.toUpperCase()} ]`, 2200);
            // Ring mesh warp — record warp position on matching ping3D
            if (i < this.ping3Ds.length) {
              const p3 = this.ping3Ds[i];
              p3.warpTimer = 300;
              p3.warpPos = new THREE.Vector3(e.x * WS, EYE_H, e.y * WS);
            }
          }
        }
      }

      // ── Pods — band test with paintedPods gate ──
      for (let pi = 0; pi < this.pods.length; pi++) {
        const pod = this.pods[pi];
        if (pod.rescued) continue;
        const pd = Math.hypot(pod.x - p.x, pod.y - p.y);
        if (pd >= inner - 20 && pd <= outer + 20 && !p.paintedPods.has(pi)) {
          p.paintedPods.add(pi);
          pod.revealTimer = p.type === "small" ? 3800 : 6000;
          if (pi < this.podObjs.length) this.podObjs[pi].group.visible = true;
        }
      }

      // ── Noise objects ──
      for (let ni = 0; ni < this.noiseObjs.length; ni++) {
        const o = this.noiseObjs[ni];
        if (o.silenced) continue;
        const od = Math.hypot(o.x - p.x, o.y - p.y);
        if (od >= inner - 18 && od <= outer + 18) o.revealTimer = 3200;
      }

      // ── Sync radius to matching 3D ring (arrays are kept in lock-step) ──
      if (i < this.ping3Ds.length) {
        this.ping3Ds[i].radius = p.radius * WS;
      }

      // ── Atomic removal: expire both 2D and 3D pings together ──
      if (p.radius >= p.maxRadius) {
        if (i < this.ping3Ds.length) {
          const p3 = this.ping3Ds[i];
          this.scene.remove(p3.sphere);
          p3.sphere.geometry.dispose();
          (p3.mat as THREE.Material).dispose();
          this.ping3Ds.splice(i, 1);
        }
        this.pings.splice(i, 1);
      }
    }
  }

  private updateFlares(dt: number) {
    const def = this.lvlDef!;
    for (let i = this.flareObjs.length - 1; i >= 0; i--) {
      const f = this.flareObjs[i];
      f.timer -= dt; f.vy += 18 * (dt / 1000);
      f.y = Math.min(f.y + f.vy * (dt / 1000), def.worldH - 30);
      f.pingTimer -= dt;
      if (f.pingTimer <= 0) {
        f.pingTimer = FLARE_PING_INTERVAL;
        this._spawnPing(f.x, f.y, 80, 60, 0xFF8800, "flare");
        this.noise = Math.min(100, this.noise + 3);
      }
      if (f.timer <= 0) this.flareObjs.splice(i, 1);
    }
  }

  private updateNoise(dt: number) {
    this.noise = Math.max(0, this.noise - NOISE_DECAY * (dt / 1000));
    for (const o of this.noiseObjs) if (!o.silenced) this.noise = Math.min(100, this.noise + o.noiseRate * (dt / 1000));
  }

  private updateO2(dt: number) {
    if (this.sacrificing) return;
    const boosting = this.keys["ShiftLeft"] || this.keys["ShiftRight"];
    const mv = Object.keys(this.keys).some(k => this.keys[k] && ["KeyW","KeyS","KeyA","KeyD","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(k));
    const drain = (boosting && mv) ? O2_DRAIN_BOOST : O2_DRAIN_NORMAL;
    this.o2 = Math.max(0, this.o2 - drain * (dt / 1000));
    if (this.o2 < 20) { this.alarmTimer -= dt; if (this.alarmTimer <= 0) { this.alarmTimer = 2200; this.audio.alarm(); } }
    if (this.o2 <= 0 && !this.transitioning) this.triggerGameOver();
  }

  private updateCamera(dt: number) {
    const k = 5 * (dt / 1000);
    this.camX += (this.px - this.camX) * k;
    this.camY += (this.py - this.camY) * k;
  }

  private updateInteractables() {
    this.nearPod = null; this.nearNoise = null;
    if (!this.lvlDef) return;
    for (const p of this.pods) {
      if (!p.rescued && Math.hypot(p.x - this.px, p.y - this.py) < INTERACT_RADIUS) { this.nearPod = p; return; }
    }
    for (const o of this.noiseObjs) {
      if (!o.silenced && Math.hypot(o.x - this.px, o.y - this.py) < INTERACT_RADIUS) { this.nearNoise = o; return; }
    }
  }

  private updateLeviathan(dt: number) {
    if (this.lvlIdx !== 2) return;
    this.levPulseTimer -= dt;
    if (this.levPulseTimer <= 0) {
      this.levPulseTimer = 8000; this.levBlocked = true; this.glitchTimer = 1400;
      setTimeout(() => { this.levBlocked = false; }, 1100);
      this.showSub("[ LEVIATHAN PULSE — SONAR DISRUPTED ]");
    }
  }

  private updateSonarShader() {
    if (!this.sonarOverlayMat) return;
    const u       = this.sonarOverlayMat.uniforms;
    const origins = u.uPingOrigin.value  as THREE.Vector3[];
    const radii   = u.uPingRadius.value  as number[];
    const ops     = u.uPingOpacity.value as number[];
    for (let i = 0; i < 5; i++) {
      if (i < this.pings.length) {
        const p = this.pings[i];
        origins[i].set(p.x * WS, EYE_H, p.y * WS);
        radii[i] = p.radius * WS;
        // Flat-top decay: stays near 1.0 for the first ~75% of the ping's
        // life (ring sweeping out), then drops sharply near the end so the
        // grid lingers long after the ring passes a surface.
        ops[i]   = Math.max(0, 1.0 - Math.pow(p.radius / p.maxRadius, 5.0));
      } else {
        origins[i].set(0, 0, 0);
        radii[i] = -1; // mark inactive
        ops[i]   = 0;
      }
    }
  }

  private updatePings3D(dt: number) {
    // radius is already synced from pings[] in updatePings(); removal is also atomic there.
    // This method handles 3D visual updates only.
    for (let i = 0; i < this.ping3Ds.length; i++) {
      const p3 = this.ping3Ds[i];

      if (p3.radius > 0) {
        // ── Constant shell thickness: recreate geometry at exact radius each frame ──
        // World-space wireframe grid squares stay constant in size as ring grows.
        p3.sphere.geometry.dispose();
        p3.sphere.geometry = new THREE.SphereGeometry(p3.radius, 16, 12);
        p3.sphere.scale.set(1, 1, 1);
      }

      // Opacity: starts full, eases out toward maxR
      const t = p3.radius / p3.maxR;
      const baseOpacity = p3.type === "boost" ? 0.18 : 0.32;
      let opacity = Math.max(0, baseOpacity * (1 - Math.pow(t, 0.55)));

      // ── Warp: localized vertex displacement toward enemy impact point for 0.3 s ──
      if (p3.warpTimer > 0 && p3.warpPos) {
        p3.warpTimer -= dt;
        const warpProgress = 1 - Math.max(0, p3.warpTimer) / 300; // 0→1 over 300 ms
        const warpStr = Math.sin(warpProgress * Math.PI) * 0.12 * p3.radius;
        const warpDir = p3.warpPos.clone().sub(p3.sphere.position).normalize();
        const geo = p3.sphere.geometry;
        const pos = geo.attributes.position as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        const vtmp = new THREE.Vector3();
        for (let vi = 0; vi < arr.length; vi += 3) {
          // Radial unit vector of this vertex
          vtmp.set(arr[vi], arr[vi + 1], arr[vi + 2]).normalize();
          const dot = vtmp.dot(warpDir); // 1 = directly toward enemy, -1 = opposite
          if (dot > 0) {
            // Displace outward in proportion to alignment with enemy direction
            const displace = (dot * dot) * warpStr;
            arr[vi]     += vtmp.x * displace;
            arr[vi + 1] += vtmp.y * displace;
            arr[vi + 2] += vtmp.z * displace;
          }
        }
        pos.needsUpdate = true;
        opacity = Math.min(1, opacity + 0.22);
      }

      p3.mat.opacity = opacity;
    }
  }

  private updateFlareMeshes(dt: number) {
    for (let i = this.flareMeshes.length - 1; i >= 0; i--) {
      const fm = this.flareMeshes[i];
      if (i < this.flareObjs.length) {
        const f = this.flareObjs[i];
        fm.mesh.position.set(f.x * WS, f.y * WS > WALL_H * 0.1 ? WALL_H * 0.1 : f.y * WS, f.y * WS);
        fm.mesh.position.y = Math.max(0.2, EYE_H - (FLARE_DURATION - f.timer) / FLARE_DURATION * 1.5);
        const fadeRatio = f.timer / FLARE_DURATION;
        fm.light.intensity = 2.5 * fadeRatio;
      } else {
        this.scene.remove(fm.mesh);
        this.flareMeshes.splice(i, 1);
      }
    }
  }

  private updateRevealFade(dt: number) {
    // Use activeFadeSet for O(active) instead of O(all) iteration
    const FLASH_DUR = 100; // ms over-bright window at start of reveal
    for (const ro of this.activeFadeSet) {
      ro.fadeTimer -= dt;
      if (ro.fadeTimer <= 0) {
        ro.fadeTimer = 0;
        ro.alpha = ro.baseAlpha;
        ro.mat.opacity = ro.baseAlpha;
        this.activeFadeSet.delete(ro);
      } else {
        const remaining = ro.fadeTimer;
        const total = ro.fadeDuration;
        if (remaining > total - FLASH_DUR) {
          // Over-bright flash phase (first 100 ms): RGB > 1 + AdditiveBlending → ~1.5× intensity
          ro.mat.color.setRGB(1.5, 1.5, 1.5);
          ro.alpha = 1.0;
        } else {
          // Restore tint; ease-out: pow(t, 0.4) from flash end to zero
          ro.mat.color.set(ro.tintColor);
          const fadeFrac = remaining / (total - FLASH_DUR);
          ro.alpha = Math.pow(fadeFrac, 0.4);
        }
        ro.mat.opacity = ro.alpha;
      }
    }
    // Pods
    for (let i = 0; i < this.pods.length; i++) {
      const pod = this.pods[i];
      if (pod.revealTimer > 0) {
        pod.revealTimer -= dt;
        if (i < this.podObjs.length) {
          const pobj = this.podObjs[i];
          const a = Math.min(1, pod.revealTimer / 900);
          pobj.mat.opacity = a * (0.7 + Math.sin(Date.now() / 350) * 0.3);
          pobj.light.intensity = a * 1.2 * (0.7 + Math.sin(Date.now() / 280) * 0.3);
          pobj.labelMat.opacity = a * 0.9;
          if (pod.rescued) { pobj.group.visible = false; }
        }
      } else if (!pod.rescued) {
        if (i < this.podObjs.length) this.podObjs[i].group.visible = false;
      }
    }
    // Noise objs
    for (let i = 0; i < this.noiseObjs.length; i++) {
      const nobj = this.noiseObjs[i];
      if (i >= this.noiseObjMeshes.length) continue;
      const { mat, group } = this.noiseObjMeshes[i];
      if (nobj.silenced) { group.visible = false; continue; }
      if (nobj.revealTimer > 0) {
        nobj.revealTimer -= dt;
        mat.opacity = Math.min(1, nobj.revealTimer / 600) * (0.5 + Math.sin(Date.now() / 100) * 0.5);
      } else {
        mat.opacity = 0;
      }
    }
  }

  // ============================================================
  // HULL STRESS AUDIO (depth-based groans + sharp-turn creaks)
  // ============================================================
  private updateHullStress(dt: number) {
    if (!this.audioReady) return;

    // ── Depth tier: 0=shallow, 1=mid, 2=deep, 3=abyss ──
    const depth = this.gaugeDisplay.depth; // roughly 20..97
    const tier = depth < 32 ? 0 : depth < 52 ? 1 : depth < 72 ? 2 : 3;

    // ── Reschedule groan timer when tier changes ──
    if (tier !== this.hullStressTier) {
      this.hullStressTier = tier;
      const baseIntervals = [Infinity, 32000, 19000, 8000]; // ms
      const jitter       = [0, 8000, 6000, 4000];
      this.hullStressTimer = baseIntervals[tier] + Math.random() * jitter[tier];
      // Force an immediate gain ramp on tier change
      this.hullGainRampTimer = 0;
    }

    // ── Continuous depth-to-gain mapping (throttled to every ~2 s) ──
    // This keeps the gain smoothly coupled to actual depth even within a tier.
    this.hullGainRampTimer -= dt;
    if (this.hullGainRampTimer <= 0) {
      const depthNorm = Math.max(0, Math.min(1, (depth - 20) / 77));
      this.audio.setHullStressDepthGain(depthNorm);
      this.hullGainRampTimer = 2000; // re-evaluate every 2 s
    }

    // ── Periodic groan countdown ──
    if (tier > 0) {
      this.hullStressTimer -= dt;
      if (this.hullStressTimer <= 0) {
        this.audio.hullGroan();
        const baseIntervals = [Infinity, 32000, 19000, 8000];
        const jitter       = [0, 8000, 6000, 4000];
        this.hullStressTimer = baseIntervals[tier] + Math.random() * jitter[tier];
      }
    }

    // ── Sharp-turn creak (delta-yaw threshold) ──
    if (this.sharpTurnCooldown > 0) this.sharpTurnCooldown -= dt;
    const deltaYaw = Math.abs(this.yaw - this.lastYawStress);
    this.lastYawStress = this.yaw;
    // ~0.035 rad/frame @ 60 fps ≈ ~2.1 rad/s — a fast mouse swipe
    if (deltaYaw > 0.032 && this.sharpTurnCooldown <= 0) {
      this.audio.hullCreak();
      this.sharpTurnCooldown = 3000; // 3 s cooldown
    }
  }

  private updateCS(dt: number) {
    if (this.csPhase === "typing") {
      this.csTextTimer += dt;
      const chars = Math.floor(this.csTextTimer / 40);
      const max = this.csPanels[this.csPanelIdx]?.text.length ?? 0;
      if (chars >= max) { this.csTextLen = max; this.csPhase = "waiting"; }
      else this.csTextLen = chars;
    }
    if (this.subTimer > 0) this.subTimer -= dt;
  }

  // ============================================================
  // ANALOG DASHBOARD
  // ============================================================
  private updateDashboard(dt: number) {
    const dtS = dt / 1000;
    // Sonar charge regenerates over time
    this.sonarCharge = Math.min(100, this.sonarCharge + 14 * dtS);
    // Hull failure — trigger game over when integrity reaches zero (same path as O2 depletion)
    if (this.hullIntegrity <= 0 && !this.transitioning) {
      this.gameOverReason = "hull";
      this.shakeTimer = 2200;
      this.shakeDuration = 2200;
      this.shakeIntensity = 0.06;
      this.subtitle = '[ HULL FAILURE — CRITICAL BREACH ]';
      this.subTimer = 2400;
      this.transitioning = true;
      setTimeout(() => { this.state = "GAME_OVER"; }, 2200);
    }
    // Hull danger sting — fire once when crossing into the red zone, reset when recovering above 35
    if (this.hullIntegrity < 25 && this.hullIntegrity > 0 && !this.hullInDanger) {
      this.hullInDanger = true;
      this.audio.hullDangerSting();
    } else if (this.hullIntegrity >= 35 && this.hullInDanger) {
      this.hullInDanger = false;
    }
    // Decrement switch anim timers
    if (this.sonarSwitchAnim > 0) this.sonarSwitchAnim -= dt;
    if (this.flareSwitchAnim > 0) this.flareSwitchAnim -= dt;
    // Valve spring return (decay back toward rest position)
    if (Math.abs(this.valveSonarAngle) > 0.01) this.valveSonarAngle *= Math.max(0, 1 - 1.6 * dtS);
    else this.valveSonarAngle = 0;
    if (Math.abs(this.valveFlareAngle) > 0.01) this.valveFlareAngle *= Math.max(0, 1 - 1.6 * dtS);
    else this.valveFlareAngle = 0;
    // Bezel flash timer
    if (this.hullBezelFlash > 0) this.hullBezelFlash = Math.max(0, this.hullBezelFlash - dt);

    // O2 critical pulse phase accumulator (1.4 Hz when below threshold)
    if (this.o2 < 20) {
      this.o2BezelPhase += dtS * Math.PI * 2 * 1.4;
    } else {
      // Decay phase back to zero so it restarts cleanly next time
      this.o2BezelPhase = 0;
    }

    // Spring physics for all gauge needles (underdamped = overshoot + bounce)
    // Cap dtS to 50 ms so a tab-hitch can't produce wild transient needle spikes
    const springDtS  = Math.min(dtS, 0.05);
    const SPRING_K   = 22;   // stiffness — higher snaps faster
    const SPRING_DMP = 5.5;  // damping — below 2*sqrt(22)≈9.4 keeps underdamped bounce
    const depthBase = [20, 55, 82][this.lvlIdx] ?? 20;
    const depthVar = this.lvlDef ? (this.py / this.lvlDef.worldH) * 15 : 0;
    const targets = {
      o2: this.o2,
      depth: depthBase + depthVar,
      sonarCharge: this.sonarCharge,
      hull: this.hullIntegrity,
      flares: this.flares,
    };
    for (const key of Object.keys(this.gaugeDisplay) as Array<keyof typeof this.gaugeDisplay>) {
      const disp = targets[key] - this.gaugeDisplay[key];
      this.gaugeVelocity[key] += (disp * SPRING_K - this.gaugeVelocity[key] * SPRING_DMP) * springDtS;
      this.gaugeDisplay[key] += this.gaugeVelocity[key] * springDtS;
    }
  }

  private getGlassScratches(idx: number): Array<{x1:number;y1:number;x2:number;y2:number;a:number}> {
    if (this.glassScratches[idx]) return this.glassScratches[idx];
    // Deterministic per-gauge scratch patterns (not per-frame random)
    const PATTERNS = [
      [{x1:-18,y1:-30,x2:22,y2:15,a:0.055},{x1:5,y1:22,x2:-14,y2:-28,a:0.038},{x1:-36,y1:8,x2:20,y2:-16,a:0.043}],
      [{x1:12,y1:-36,x2:-16,y2:26,a:0.048},{x1:-22,y1:18,x2:32,y2:-6,a:0.032},{x1:26,y1:32,x2:-8,y2:-14,a:0.041},{x1:-31,y1:-12,x2:14,y2:30,a:0.036}],
      [{x1:-10,y1:-40,x2:28,y2:20,a:0.052},{x1:18,y1:14,x2:-24,y2:-26,a:0.040},{x1:-34,y1:24,x2:16,y2:-18,a:0.037}],
      [{x1:22,y1:-34,x2:-12,y2:28,a:0.046},{x1:-26,y1:-18,x2:30,y2:12,a:0.039},{x1:8,y1:36,x2:-20,y2:-8,a:0.051},{x1:-32,y1:16,x2:10,y2:-30,a:0.035}],
      [{x1:-16,y1:-32,x2:24,y2:18,a:0.053},{x1:14,y1:28,x2:-28,y2:-10,a:0.042},{x1:32,y1:-14,x2:-10,y2:24,a:0.038}],
    ];
    this.glassScratches[idx] = PATTERNS[idx % PATTERNS.length];
    return this.glassScratches[idx];
  }

  private drawGauge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, value: number, label: string, needleColor: string, idx: number, bezGlowColor = '', bezGlowAlpha = 0, showDamageCracks = false) {
    const v = Math.max(0, Math.min(1, value));
    const START_A = Math.PI * 0.75;   // 7:30 o'clock
    const SWEEP   = Math.PI * 1.5;    // 270° sweep

    // --- Outer brass bezel (radial gradient) ---
    const bezGrad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.15, cx, cy, r + 9);
    bezGrad.addColorStop(0,   '#c8a44a');
    bezGrad.addColorStop(0.35,'#8a6820');
    bezGrad.addColorStop(0.65,'#4a3a10');
    bezGrad.addColorStop(1,   '#1e1508');
    ctx.fillStyle = bezGrad;
    ctx.beginPath(); ctx.arc(cx, cy, r + 9, 0, Math.PI * 2); ctx.fill();

    // --- Bezel glow overlay (damage flash / O2 critical pulse) ---
    if (bezGlowAlpha > 0 && bezGlowColor) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, bezGlowAlpha));
      ctx.shadowColor = bezGlowColor;
      ctx.shadowBlur  = 18;
      ctx.strokeStyle = bezGlowColor;
      ctx.lineWidth   = 5;
      ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur  = 0;
      ctx.restore();
    }

    // Thin specular ring on bezel
    ctx.strokeStyle = 'rgba(200,170,80,0.35)';
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r + 6.5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r + 1, 0, Math.PI * 2); ctx.stroke();

    // --- Glass face ---
    const glassGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    glassGrad.addColorStop(0,  '#1b2224');
    glassGrad.addColorStop(0.8,'#0e1617');
    glassGrad.addColorStop(1,  '#080e0f');
    ctx.fillStyle = glassGrad; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

    // --- Background arc track ---
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r - 11, START_A, START_A + SWEEP); ctx.stroke();

    // --- Colored value arc ---
    if (v > 0.005) {
      ctx.strokeStyle = needleColor; ctx.shadowColor = needleColor; ctx.shadowBlur = 6;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, r - 11, START_A, START_A + v * SWEEP); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // --- Tick marks ---
    for (let t = 0; t <= 10; t++) {
      const frac = t / 10;
      const a = START_A + frac * SWEEP;
      const major = t % 2 === 0;
      const tLen = major ? 9 : 5;
      ctx.strokeStyle = major ? 'rgba(190,175,140,0.88)' : 'rgba(120,110,85,0.55)';
      ctx.lineWidth = major ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3));
      ctx.lineTo(cx + Math.cos(a) * (r - 3 - tLen), cy + Math.sin(a) * (r - 3 - tLen));
      ctx.stroke();
      // Minor tick labels at 0, 50, 100
      if (t === 0 || t === 5 || t === 10) {
        const lbl = t === 0 ? '0' : t === 5 ? '50' : '100';
        const lr = r - 18;
        ctx.fillStyle = 'rgba(160,148,118,0.7)'; ctx.font = '7px monospace'; ctx.textAlign = 'center';
        ctx.fillText(lbl, cx + Math.cos(a) * lr, cy + Math.sin(a) * lr + 3);
      }
    }

    // --- Needle ---
    const needleA = START_A + v * SWEEP;
    const needleLen = r - 14;
    const tailLen = 9;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(needleA);
    // Shadow
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(1.5, tailLen); ctx.lineTo(1.5, -needleLen); ctx.stroke();
    // Tapered needle body
    ctx.fillStyle = needleColor;
    ctx.shadowColor = needleColor; ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(-2.2, tailLen); ctx.lineTo(2.2, tailLen);
    ctx.lineTo(0.6, -needleLen); ctx.lineTo(-0.6, -needleLen);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // --- Center brass cap ---
    const capGrad = ctx.createRadialGradient(cx - 2, cy - 2, 0, cx, cy, 7.5);
    capGrad.addColorStop(0, '#d4a820'); capGrad.addColorStop(0.55, '#7a5212'); capGrad.addColorStop(1, '#1e1000');
    ctx.fillStyle = capGrad; ctx.beginPath(); ctx.arc(cx, cy, 6.5, 0, Math.PI * 2); ctx.fill();
    // Center rivet dot
    ctx.fillStyle = 'rgba(255,210,80,0.7)'; ctx.beginPath(); ctx.arc(cx - 1.5, cy - 1.5, 1.5, 0, Math.PI * 2); ctx.fill();

    // --- Scratched glass overlay (clipped to gauge circle) ---
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    for (const s of this.getGlassScratches(idx)) {
      ctx.strokeStyle = `rgba(255,255,255,${s.a})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(cx + s.x1, cy + s.y1); ctx.lineTo(cx + s.x2, cy + s.y2); ctx.stroke();
    }
    // --- Hull damage crack overlay (shown when hull < 25%) ---
    if (showDamageCracks) {
      // Fracture lines emanating from a stress point near center-right
      const cracks = [
        { x1:  4, y1:  2, x2:  r - 4, y2: -r + 8 },
        { x1:  4, y1:  2, x2:  r - 6, y2:  r - 12 },
        { x1:  4, y1:  2, x2: -r + 10, y2:  r - 6 },
        { x1:  4, y1:  2, x2: -r + 8,  y2: -r + 10 },
        // Secondary branches off first crack
        { x1: Math.round((r-4)*0.45) + 4, y1: Math.round((-r+8)*0.45) + 2,
          x2: Math.round((r-4)*0.45) + 4 + 10, y2: Math.round((-r+8)*0.45) + 2 - 14 },
        { x1: Math.round((r-4)*0.6) + 4,  y1: Math.round((-r+8)*0.6) + 2,
          x2: Math.round((r-4)*0.6) + 4 + 16, y2: Math.round((-r+8)*0.6) + 2 + 6 },
      ];
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 0.8;
      ctx.shadowColor = 'rgba(255,80,0,0.4)';
      ctx.shadowBlur = 3;
      for (const c of cracks) {
        ctx.beginPath();
        ctx.moveTo(cx + c.x1, cy + c.y1);
        ctx.lineTo(cx + c.x2, cy + c.y2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      // Faint red tint over the glass
      ctx.fillStyle = 'rgba(180,20,0,0.12)';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    // Top-left specular highlight
    const hlGrad = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.38, 0, cx - r * 0.38, cy - r * 0.38, r * 0.52);
    hlGrad.addColorStop(0, 'rgba(255,255,255,0.13)'); hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hlGrad; ctx.fillRect(cx - r, cy - r, r, r);
    ctx.restore();

    // --- Label below gauge ---
    ctx.fillStyle = 'rgba(185,172,138,0.88)'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy + r + 17);
  }

  private drawSwitch(ctx: CanvasRenderingContext2D, cx: number, cy: number, label: string, active: boolean) {
    const sw = 18, sh = 36;
    const py = cy - sh / 2;

    // Housing body
    const hGrad = ctx.createLinearGradient(cx - sw/2, py, cx + sw/2, py + sh);
    hGrad.addColorStop(0, '#2e2a22'); hGrad.addColorStop(1, '#18160f');
    ctx.fillStyle = hGrad;
    ctx.beginPath(); ctx.roundRect(cx - sw/2, py, sw, sh, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(110,100,70,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(cx - sw/2, py, sw, sh, 4); ctx.stroke();

    // Slot groove
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, py + 6); ctx.lineTo(cx, py + sh - 6); ctx.stroke();

    // Lever position: snapped UP when active, down when idle
    const leverY = active ? py + 9 : py + sh - 18;
    const lGrad = ctx.createLinearGradient(cx - 6, leverY, cx + 6, leverY + 13);
    lGrad.addColorStop(0, active ? '#e87010' : '#907860');
    lGrad.addColorStop(1, active ? '#6a3808' : '#3a3020');
    ctx.fillStyle = lGrad;
    ctx.beginPath(); ctx.roundRect(cx - 6, leverY, 12, 13, 3); ctx.fill();
    ctx.strokeStyle = active ? 'rgba(255,180,60,0.6)' : 'rgba(140,120,80,0.4)';
    ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(cx - 6, leverY, 12, 13, 3); ctx.stroke();
    // Indicator light on lever top
    if (active) {
      ctx.fillStyle = '#FFCC44'; ctx.shadowColor = '#FF8800'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(cx, leverY + 3, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Rivet dots on housing corners
    ctx.fillStyle = 'rgba(130,115,80,0.6)';
    for (const [rx, ry] of [[cx-6, py+4],[cx+6, py+4],[cx-6, py+sh-4],[cx+6, py+sh-4]] as [number,number][]) {
      ctx.beginPath(); ctx.arc(rx, ry, 1.5, 0, Math.PI * 2); ctx.fill();
    }

    // Label
    ctx.fillStyle = active ? 'rgba(255,160,50,0.9)' : 'rgba(160,148,118,0.75)';
    ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy + sh / 2 + 12);
  }

  private drawValve(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, active: boolean, label: string) {
    const r = 21;

    // Outer rim: aged brass radial gradient
    const rimGrad = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.32, r * 0.1, cx, cy, r + 4);
    rimGrad.addColorStop(0,    active ? '#d4a030' : '#9a7828');
    rimGrad.addColorStop(0.45, active ? '#7a5018' : '#4e3410');
    rimGrad.addColorStop(1,    '#1a1006');
    ctx.fillStyle = rimGrad;
    ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.fill();

    // Active glow ring
    if (active) {
      ctx.strokeStyle = 'rgba(255,180,50,0.55)'; ctx.lineWidth = 2; ctx.shadowColor = '#FF8800'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

    // Inner dark face
    const faceGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    faceGrad.addColorStop(0, '#1c2224'); faceGrad.addColorStop(1, '#0e1415');
    ctx.fillStyle = faceGrad; ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2); ctx.fill();

    // Four spokes at current angle
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
    const spokeColor = active ? 'rgba(200,160,60,0.88)' : 'rgba(130,110,70,0.68)';
    ctx.strokeStyle = spokeColor; ctx.lineWidth = 3.5;
    for (let s = 0; s < 4; s++) {
      ctx.save(); ctx.rotate(s * Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, r * 0.28); ctx.lineTo(0, r * 0.82); ctx.stroke();
      ctx.restore();
    }
    // Cross hub cap
    const hubGrad = ctx.createRadialGradient(-r * 0.12, -r * 0.12, 0, 0, 0, r * 0.3);
    hubGrad.addColorStop(0, active ? '#d4a030' : '#8a6820');
    hubGrad.addColorStop(1, '#1a1006');
    ctx.fillStyle = hubGrad; ctx.beginPath(); ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2); ctx.fill();
    // Hub highlight
    ctx.fillStyle = 'rgba(255,210,80,0.5)'; ctx.beginPath(); ctx.arc(-r*0.06, -r*0.06, r*0.1, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // Indicator notch on rim at current angle (shows rotation position)
    const notchA = angle - Math.PI / 2; // notch at "12 o'clock" offset by rotation
    ctx.strokeStyle = active ? 'rgba(255,200,60,0.9)' : 'rgba(160,140,90,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(notchA) * (r - 5), cy + Math.sin(notchA) * (r - 5));
    ctx.lineTo(cx + Math.cos(notchA) * (r + 1), cy + Math.sin(notchA) * (r + 1));
    ctx.stroke();

    // Label
    ctx.fillStyle = active ? 'rgba(255,160,50,0.9)' : 'rgba(155,142,108,0.72)';
    ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy + r + 14);
  }

  private renderAnalogDashboard() {
    const ctx = this.hudCtx;
    const PANEL_Y = Math.floor(GAME_H * 0.75);  // 540 — 25% of screen
    const PANEL_H = GAME_H - PANEL_Y;            // 180px

    // ── 3D perspective tilt: trapezoid clip simulates looking slightly downward ──
    // Top edge is narrower (farther from viewer), bottom is full-width (closer)
    ctx.save();
    const TAPER = 14;
    ctx.beginPath();
    ctx.moveTo(TAPER, PANEL_Y); ctx.lineTo(GAME_W - TAPER, PANEL_Y);
    ctx.lineTo(GAME_W, GAME_H); ctx.lineTo(0, GAME_H);
    ctx.closePath(); ctx.clip();
    // Subtle x-skew to reinforce depth (y unchanged, so circles stay round)
    ctx.transform(1, 0, 0.015, 1, -PANEL_Y * 0.015, 0);

    // ── Panel base: aged gunmetal aluminum ──
    const baseGrad = ctx.createLinearGradient(0, PANEL_Y, 0, GAME_H);
    baseGrad.addColorStop(0,   '#22292c');
    baseGrad.addColorStop(0.28,'#1a2022');
    baseGrad.addColorStop(0.68,'#14191a');
    baseGrad.addColorStop(1,   '#0d1011');
    ctx.fillStyle = baseGrad; ctx.fillRect(0, PANEL_Y, GAME_W, PANEL_H);

    // Horizontal metal grain lines
    for (let i = 0; i < 6; i++) {
      const by = PANEL_Y + 14 + i * 28;
      ctx.strokeStyle = `rgba(255,255,255,${0.010 + i * 0.003})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(GAME_W, by); ctx.stroke();
    }

    // Panel scratch marks
    const scratchDefs: [number,number,number,number][] = [
      [85,14,175,24],[315,18,425,10],[560,24,690,16],[790,10,910,20],[975,16,1090,8],[1190,12,1258,22],
    ];
    ctx.lineWidth = 1;
    for (const [x1,y1,x2,y2] of scratchDefs) {
      ctx.strokeStyle = 'rgba(255,255,255,0.022)';
      ctx.beginPath(); ctx.moveTo(x1, PANEL_Y+y1); ctx.lineTo(x2, PANEL_Y+y2); ctx.stroke();
    }

    // Side vignettes (grime)
    const vigL = ctx.createLinearGradient(0, PANEL_Y, 85, PANEL_Y);
    vigL.addColorStop(0, 'rgba(0,0,0,0.58)'); vigL.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vigL; ctx.fillRect(0, PANEL_Y, 85, PANEL_H);
    const vigR = ctx.createLinearGradient(GAME_W-85, PANEL_Y, GAME_W, PANEL_Y);
    vigR.addColorStop(0, 'rgba(0,0,0,0)'); vigR.addColorStop(1, 'rgba(0,0,0,0.58)');
    ctx.fillStyle = vigR; ctx.fillRect(GAME_W-85, PANEL_Y, 85, PANEL_H);

    // Top edge: worn highlight + separator
    const edgeH = ctx.createLinearGradient(0, PANEL_Y, 0, PANEL_Y + 8);
    edgeH.addColorStop(0, 'rgba(140,125,90,0.88)'); edgeH.addColorStop(1, 'rgba(50,45,30,0)');
    ctx.fillStyle = edgeH; ctx.fillRect(0, PANEL_Y, GAME_W, 8);
    ctx.strokeStyle = 'rgba(80,70,50,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, PANEL_Y + 8); ctx.lineTo(GAME_W, PANEL_Y + 8); ctx.stroke();

    // ── Rivets along top edge ──
    const rivetY = PANEL_Y + 5;
    for (let rx = 28; rx < GAME_W - 20; rx += 52) {
      const rg = ctx.createRadialGradient(rx-1, rivetY-1, 0, rx, rivetY, 5);
      rg.addColorStop(0, 'rgba(200,180,130,0.9)'); rg.addColorStop(0.45, 'rgba(110,95,65,0.7)');
      rg.addColorStop(1, 'rgba(30,25,15,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(rx, rivetY, 4.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath(); ctx.ellipse(rx, rivetY+3.5, 3.5, 1.5, 0, 0, Math.PI*2); ctx.fill();
    }

    // ── ROW 1: three large primary gauges ──
    // OXYGEN (left) | [SONAR SWITCH] | DEPTH (center) | [FLARE SWITCH] | SONAR CHARGE (right)
    const R1 = 32;           // radius
    const R1_EXT = R1 + 7;  // from center to outer bezel edge = 39
    const ROW1_CY = PANEL_Y + 9 + R1_EXT;  // 540 + 9 + 39 = 588

    const gO2Color   = this.o2 > 50            ? '#00FF88' : this.o2 > 20            ? '#FFD700' : '#FF4422';
    const o2PulseA   = this.o2 < 20 ? (0.45 + 0.45 * Math.sin(this.o2BezelPhase)) : 0;
    this.drawGauge(ctx,  180, ROW1_CY, R1, this.gaugeDisplay.o2 / 100,          'OXYGEN', gO2Color,  0, '#FF2200', o2PulseA, false);
    this.drawGauge(ctx,  640, ROW1_CY, R1, this.gaugeDisplay.depth / 100,        'DEPTH',  '#00CCFF', 1);
    this.drawGauge(ctx, 1100, ROW1_CY, R1, this.gaugeDisplay.sonarCharge / 100,  'SONAR',  '#22EEBB', 2);

    // Toggle switches sit between the row-1 gauges (at row-1 height)
    this.drawSwitch(ctx, 415, ROW1_CY, 'SONAR', this.sonarSwitchAnim > 0);
    this.drawSwitch(ctx, 865, ROW1_CY, 'FLARE', this.flareSwitchAnim > 0);

    // ── ROW 2: two smaller gauges + two rotary valve handles + NOISE arc ──
    // HULL (left) | BALLAST VALVE | [NOISE ARC] | VENT VALVE | FLARES (right)
    const R2 = 24;           // radius
    const R2_EXT = R2 + 6;  // 30
    const ROW2_CY = ROW1_CY + R1_EXT + 9 + R2_EXT;  // 588 + 39 + 9 + 30 = 666

    const gHullColor   = this.hullIntegrity > 50 ? '#00FF88' : this.hullIntegrity > 25 ? '#FFD700' : '#FF4422';
    const hullFlashA   = this.hullBezelFlash > 0 ? (this.hullBezelFlash / 480) * 0.85 : 0;
    const hullCracked  = this.hullIntegrity < 25;
    this.drawGauge(ctx,  300, ROW2_CY, R2, this.gaugeDisplay.hull / 100,  'HULL',   gHullColor, 3, '#FF5500', hullFlashA, hullCracked);
    this.drawGauge(ctx,  980, ROW2_CY, R2, this.gaugeDisplay.flares / 3,  'FLARES', '#FF8C00',  4);

    // Rotary valve handles between gauges (animated on sonar/flare activation)
    this.drawValve(ctx, 490, ROW2_CY, this.valveSonarAngle, this.sonarSwitchAnim > 0, 'BALLAST');
    this.drawValve(ctx, 790, ROW2_CY, this.valveFlareAngle, this.flareSwitchAnim > 0, 'VENT');

    // ── Analog NOISE arc meter (center of row 2, between the two valves) ──
    // Semicircle sweep gauge — purely mechanical, no digital elements
    {
      const nx = 640, ny = ROW2_CY, nr = 22;
      const nv = Math.max(0, Math.min(1, this.noise / 100));
      const nCol = nv <= 0.30 ? '#00FF88' : nv <= 0.60 ? '#FFD700' : nv <= 0.82 ? '#FF8800' : '#FF3333';
      const NS = Math.PI * 0.80;  // start angle (slightly left of bottom)
      const NSW = Math.PI * 1.4;  // sweep (252°)

      // Arc background track
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.arc(nx, ny, nr - 5, NS, NS + NSW); ctx.stroke();
      // Filled value arc
      if (nv > 0.01) {
        ctx.strokeStyle = nCol; ctx.shadowColor = nCol; ctx.shadowBlur = 5;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(nx, ny, nr - 5, NS, NS + nv * NSW); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // Tiny tick marks (5 ticks)
      for (let t = 0; t <= 4; t++) {
        const ta = NS + (t / 4) * NSW;
        const tLen = t === 0 || t === 4 || t === 2 ? 5 : 3;
        ctx.strokeStyle = 'rgba(160,148,110,0.6)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(nx + Math.cos(ta)*(nr-2), ny + Math.sin(ta)*(nr-2));
        ctx.lineTo(nx + Math.cos(ta)*(nr-2-tLen), ny + Math.sin(ta)*(nr-2-tLen));
        ctx.stroke();
      }
      // Needle
      const needleA = NS + nv * NSW;
      ctx.strokeStyle = nCol; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(nx + Math.cos(needleA)*(nr-7), ny + Math.sin(needleA)*(nr-7));
      ctx.stroke();
      // Center hub
      ctx.fillStyle = '#4a3810'; ctx.beginPath(); ctx.arc(nx, ny, 3.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(200,170,80,0.7)'; ctx.beginPath(); ctx.arc(nx-0.8, ny-0.8, 1.2, 0, Math.PI*2); ctx.fill();
      // Label
      ctx.fillStyle = 'rgba(155,142,110,0.72)'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
      ctx.fillText('NOISE', nx, ny + nr + 13);
    }

    ctx.restore(); // end perspective tilt transform
  }

  // ============================================================
  // RENDER
  // ============================================================
  private render() {
    // Clear HUD canvas every frame
    this.hudCtx.clearRect(0, 0, GAME_W, GAME_H);

    const isCS = this.state === "CUTSCENE" || this.state === "ENDING_A" || this.state === "ENDING_B";

    if (this.state === "MENU") {
      this.renderer.render(this.scene, this.camera);
      this.renderMenu();
      return;
    }
    if (isCS) {
      this.renderer.render(this.scene, this.camera);
      this.renderCS();
      return;
    }
    if (this.state === "GAME_OVER") {
      this.renderer.render(this.scene, this.camera);
      this.renderGameOver();
      return;
    }
    if (this.state === "LEVEL_TRANSITION") {
      this.renderer.render(this.scene, this.camera);
      this.renderLevelTransition();
      return;
    }

    // Update camera from 2D position + buoyancy Y drift + roll/pitch offsets
    const buoyancyY = BUOY_AMP * Math.sin(BUOY_FREQ * this.lvlTime);
    this.camera.position.set(this.px * WS, EYE_H + buoyancyY, this.py * WS);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + this.cameraPitchOff;
    this.camera.rotation.z = this.cameraRoll;

    // Camera shake — apply decaying random positional offsets on collision
    if (this.shakeTimer > 0) {
      const dtRender = 16; // approx 1 frame ms (render runs in RAF)
      this.shakeTimer = Math.max(0, this.shakeTimer - dtRender);
      const decay = this.shakeTimer / Math.max(1, this.shakeDuration);
      const s = this.shakeIntensity * Math.sqrt(decay);
      this.camera.position.x += (Math.random() - 0.5) * s * 2;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s * 0.8;
    }

    // Rotate radar sweep
    if (this.cockpitSweep) this.cockpitSweep.rotation.z += 0.025;

    // Animate particles — velocity-reactive marine snow
    if (this.particleSystem) {
      const pos = (this.particleSystem.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      const vel = this.particleSystem.userData.vel as Float32Array;
      const wW  = (this.particleSystem.userData.worldW as number) * WS;
      const wH  = (this.particleSystem.userData.worldH as number) * WS;

      // Current speed (2D physics units/s)
      const speed = Math.hypot(this.pvx, this.pvy);
      const maxSpeed = PLAYER_SPEED * PLAYER_BOOST_MULT;
      const speedNorm = Math.min(1, speed / maxSpeed); // 0..1

      // Camera forward direction in world XZ
      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);

      // Rush effect: apply velocity OPPOSITE to camera forward so particles
      // stream from ahead, past the porthole, and behind — the correct "rushing through"
      // sensation.  At rest: only the lazy base drift.  At max speed: ~4× Y + strong
      // backward-rush bias (opposite forward = toward-then-behind-camera in camera space).
      const rushY    = 0.0015 + speedNorm * 0.055;   // lazy → streaking upward
      const rushBack = speedNorm * 0.065;              // particles fly from front → behind camera

      // Scale point size with speed (cheap motion-blur hint)
      const mat = this.particleSystem.material as THREE.PointsMaterial;
      mat.size = 0.06 + speedNorm * 0.08;

      const camX = this.px * WS, camZ = this.py * WS;
      const count = pos.length / 3;
      for (let i = 0; i < count; i++) {
        const ix = i * 3, iy = ix + 1, iz = ix + 2;
        // Move particle: base drift + backward-rush (negative forward = against movement direction)
        pos[ix] += vel[ix] - fwdX * rushBack;
        pos[iy] += vel[iy] + rushY;
        pos[iz] += vel[iz] - fwdZ * rushBack;

        // Y wrap
        if (pos[iy] > WALL_H) pos[iy] = 0.05;
        if (pos[iy] < 0) pos[iy] = WALL_H - 0.05;
        // XZ: particles that have passed behind the camera (distance > 28 units) are
        // respawned in front so the cone of visible space stays continuously seeded
        const dx = pos[ix] - camX, dz = pos[iz] - camZ;
        if (dx * dx + dz * dz > 28 * 28) {
          // Respawn in a forward cone ahead of the camera
          const d = 4 + Math.random() * 24;
          const spread = (Math.random() - 0.5) * 14;
          const sideX = -fwdZ, sideZ = fwdX; // perpendicular in XZ
          pos[ix] = camX + fwdX * d + sideX * spread;
          pos[iz] = camZ + fwdZ * d + sideZ * spread;
          pos[iy] = Math.random() * WALL_H;
        }
        // Hard-clamp to world bounds
        if (pos[ix] < 0) pos[ix] = wW;
        if (pos[ix] > wW) pos[ix] = 0;
        if (pos[iz] < 0) pos[iz] = wH;
        if (pos[iz] > wH) pos[iz] = 0;
      }

      // ── Speed-based spawn-rate boost ──
      // At rest 0 extra respawns/frame; at max speed ~2× effective spawn throughput
      // by seeding additional particles in front of camera each frame.
      const extraSpawns = Math.round(speedNorm * count * 0.012); // 0 → ~3-4 per frame at max
      for (let r = 0; r < extraSpawns; r++) {
        const ri = Math.floor(Math.random() * count);
        const ix = ri * 3, iy = ix + 1, iz = ix + 2;
        const d = 2 + Math.random() * 20;
        const spread = (Math.random() - 0.5) * 14;
        const sideX = -fwdZ, sideZ = fwdX;
        pos[ix] = camX + fwdX * d + sideX * spread;
        pos[iz] = camZ + fwdZ * d + sideZ * spread;
        pos[iy] = Math.random() * WALL_H;
      }

      this.particleSystem.geometry.attributes.position.needsUpdate = true;
    }

    // Update film grain time uniform for live static noise
    if (this.grainUniforms) {
      this.grainUniforms.time.value = performance.now() / 1000;

      // Drive grain intensity from hull / O2 damage state — heavier grain when
      // things go critically wrong, reinforcing the degraded-camera-feed feel.
      // At full health: ~0.03 (subtle).  At critical hull (<25%) or O2 (<15%): ~0.10 (heavy).
      // The lerp provides a smooth ramp; the target itself is a discrete step.
      const isCritical = this.hullIntegrity < 25 || this.o2 < 15;
      const targetIntensity = isCritical ? 0.10 : 0.03;

      // Smooth lerp — ~0.05 per frame ≈ 0.3 s half-life at 60 fps
      this.grainIntensity += (targetIntensity - this.grainIntensity) * 0.05;
      this.grainUniforms.intensity.value = this.grainIntensity;
    }

    // Animate headlight cookie — redraw caustic ripple every 3 frames to keep cost low
    if (this.headlightCookie) {
      this.cookieFrame++;
      if (this.cookieFrame % 3 === 0) {
        this.headlightCookie.update(performance.now() / 1000);
      }
    }

    // Render 3D scene with post-processing stack
    this.composer.render();

    // HUD overlay
    this.renderHUD();
    if (this.glitchTimer > 0) this.renderGlitch();
    if (this.state === "CHOICE") this.renderChoice();
  }

  // ============================================================
  // HUD (drawn on hudCanvas)
  // ============================================================
  private renderHUD() {
    if (this.state !== "PLAYING" && this.state !== "CHOICE") return;
    const ctx = this.hudCtx;
    const glitch = this.glitchTimer > 0;
    const gx = glitch ? (Math.random() - 0.5) * 8 : 0;
    const gy = glitch ? (Math.random() - 0.5) * 4 : 0;

    // Level name stays at top
    this.renderLvlName(GAME_W / 2 + gx, 18 + gy);

    // Analog cockpit dashboard (bottom 22% of screen)
    this.renderAnalogDashboard();

    if (this.nearPod) this.renderPrompt(`[E] DOCK — ${this.nearPod.character}'S POD`);
    else if (this.nearNoise) this.renderPrompt("[E] SILENCE NOISE SOURCE");
    if (this.subTimer > 0 && this.subtitle) this.renderSubtitle();

    // Low O2 vignette pulse (only in the viewport area above the panel)
    if (this.o2 < 20) {
      const panelY = Math.floor(GAME_H * 0.785);
      const pulse = 0.15 + Math.sin(Date.now() / 320) * 0.12;
      ctx.fillStyle = `rgba(255,0,0,${pulse})`;
      ctx.fillRect(0, 0, GAME_W, panelY);
    }
  }

  private renderO2(cx: number, cy: number) {
    const ctx = this.hudCtx; const r = 32, o = this.o2 / 100;
    ctx.strokeStyle = "rgba(0,255,255,0.12)"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI * 1.5); ctx.stroke();
    const col = o > 0.5 ? "#00FF88" : o > 0.2 ? "#FFD700" : "#FF3333";
    ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 9; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + o * Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#AAFFFF"; ctx.font = "bold 11px monospace"; ctx.textAlign = "center";
    ctx.fillText("O2", cx, cy + 4); ctx.font = "9px monospace"; ctx.fillText(`${Math.ceil(this.o2)}%`, cx, cy + 15);
  }

  private renderNoiseBar(x: number, y: number) {
    const ctx = this.hudCtx; const w = 228, h = 18, n = this.noise / 100;
    ctx.fillStyle = "rgba(0,255,255,0.7)"; ctx.font = "10px monospace"; ctx.textAlign = "left";
    ctx.fillText("ACOUSTIC SIGNATURE", x, y + 10);
    ctx.fillStyle = "rgba(0,255,255,0.08)"; ctx.fillRect(x, y + 14, w, h);
    const col = n <= 0.3 ? "#00FF88" : n <= 0.6 ? "#FFD700" : n <= 0.8 ? "#FF8800" : "#FF3333";
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 5;
    ctx.fillRect(x, y + 14, w * n, h); ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0,255,255,0.25)"; ctx.lineWidth = 1; ctx.strokeRect(x, y + 14, w, h);
    for (const pct of [0.3, 0.6, 0.8]) {
      ctx.strokeStyle = "rgba(255,255,100,0.35)"; ctx.beginPath();
      ctx.moveTo(x + w * pct, y + 14); ctx.lineTo(x + w * pct, y + 14 + h); ctx.stroke();
    }
    const label = n <= 0.3 ? "SAFE" : n <= 0.6 ? "CAUTION" : n <= 0.8 ? "DANGER" : "CRITICAL";
    ctx.fillStyle = col; ctx.font = "9px monospace"; ctx.textAlign = "right";
    ctx.fillText(label, x + w, y + 46);
  }

  private renderLvlName(cx: number, y: number) {
    if (!this.lvlDef) return;
    const ctx = this.hudCtx;
    ctx.fillStyle = "rgba(0,255,255,0.65)"; ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText(this.lvlDef.name, cx, y + 14);
  }

  private renderFlareHUD(x: number, y: number) {
    const ctx = this.hudCtx;
    ctx.fillStyle = "rgba(255,140,0,0.85)"; ctx.font = "12px monospace"; ctx.textAlign = "left";
    ctx.fillText(`FLARES: ${this.flares}`, x, y);
    ctx.fillStyle = "rgba(0,255,255,0.5)"; ctx.font = "10px monospace";
    ctx.fillText("CLICK: sonar  HOLD: large ping  F: flare  E: interact", x, y - 15);
  }

  private renderPrompt(text: string) {
    const ctx = this.hudCtx;
    const panelY = Math.floor(GAME_H * 0.75);
    ctx.fillStyle = "rgba(0,255,136,0.92)"; ctx.font = "14px monospace"; ctx.textAlign = "center";
    ctx.fillText(text, GAME_W / 2, panelY - 16);
  }

  private renderSubtitle() {
    const ctx = this.hudCtx; const a = Math.min(1, this.subTimer / 500);
    const panelY = Math.floor(GAME_H * 0.75);
    const maxW = 820;
    const lines = this.wrapTxt(this.subtitle, maxW); const lh = 20;
    const totH = lines.length * lh; const sy = panelY - 14 - totH;
    ctx.fillStyle = `rgba(0,0,0,${a * 0.65})`;
    ctx.fillRect(GAME_W / 2 - maxW / 2 - 12, sy - 6, maxW + 24, totH + 12);
    ctx.fillStyle = `rgba(255,255,255,${a * 0.9})`; ctx.font = "13px monospace"; ctx.textAlign = "center";
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], GAME_W / 2, sy + i * lh + 14);
  }

  private wrapTxt(text: string, maxW: number): string[] {
    const ctx = this.hudCtx; ctx.font = "13px monospace";
    const words = text.split(" "); const lines: string[] = []; let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    }
    if (cur) lines.push(cur); return lines;
  }

  // ============================================================
  // CHOICE SCREEN
  // ============================================================
  private renderChoice() {
    const ctx = this.hudCtx;
    ctx.fillStyle = "rgba(0,0,0,0.78)"; ctx.fillRect(0, 0, GAME_W, GAME_H);
    const px = 180, py = 155, pw = GAME_W - 360, ph = GAME_H - 310;
    ctx.fillStyle = "rgba(0,0,20,0.94)"; ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = "#00FFFF"; ctx.lineWidth = 2; ctx.strokeRect(px, py, pw, ph);
    ctx.fillStyle = "#FF3333"; ctx.font = "bold 15px monospace"; ctx.textAlign = "center";
    ctx.fillText("⚠  OXYGEN CRITICAL  —  DECISION REQUIRED  ⚠", GAME_W / 2, py + 42);
    ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.font = "13px monospace";
    ctx.fillText("Two lifepods detected. Oxygen insufficient for sequential rescue.", GAME_W / 2, py + 74);
    ctx.fillStyle = "#00FF88"; ctx.font = "14px monospace";
    ctx.fillText("[E]  DOCK WITH POD A — Save LIAM   (oxygen: ~12%)", GAME_W / 2, py + 120);
    ctx.fillText("[Q]  DOCK WITH POD B — Save MIA    (oxygen: ~12%)", GAME_W / 2, py + 156);
    ctx.fillStyle = "#FFD700";
    ctx.fillText("[R]  REROUTE SUIT OXYGEN — Save BOTH  (Elias will not survive)", GAME_W / 2, py + 206);
    ctx.fillStyle = "rgba(255,255,255,0.38)"; ctx.font = "11px monospace";
    ctx.fillText('LIAM  (Pod A)  — Age 7 — "It\'s dark. I don\'t like the dark."', GAME_W / 2, py + 250);
    ctx.fillText('MIA   (Pod B)  — Age 5 — "The fishies are sleeping. Are you sleeping too?"', GAME_W / 2, py + 272);
  }

  // ============================================================
  // CUTSCENE (on HUD canvas)
  // ============================================================
  private renderCS() {
    if (this.csPanelIdx >= this.csPanels.length) return;
    const ctx = this.hudCtx; const panel = this.csPanels[this.csPanelIdx];
    const t = Date.now() / 1000;
    ctx.fillStyle = "rgba(0,0,0,0.96)"; ctx.fillRect(0, 0, GAME_W, GAME_H);
    const px = 90, py = 55, pw = GAME_W - 180, ph = GAME_H - 110;
    ctx.strokeStyle = "#FFF"; ctx.lineWidth = 4; ctx.strokeRect(px, py, pw, ph);
    this.renderCSArt(panel.art, px, py, pw, ph, t);
    const g = ctx.createLinearGradient(px, py + ph - 230, px, py + ph);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.97)");
    ctx.fillStyle = g; ctx.fillRect(px, py + ph - 230, pw, 230);
    if (panel.speaker !== "NARRATOR") {
      ctx.fillStyle = "#00FFFF"; ctx.font = "bold 13px monospace"; ctx.textAlign = "left";
      ctx.fillText(panel.speaker, px + 22, py + ph - 178);
    }
    const display = panel.text.substring(0, this.csTextLen);
    ctx.fillStyle = "#FFF"; ctx.font = "15px Georgia, serif"; ctx.textAlign = "left";
    let lineY = py + ph - 155;
    for (const line of display.split("\n")) { ctx.fillText(line, px + 22, lineY); lineY += 24; }
    if (panel.badge && this.csPhase === "waiting") {
      ctx.fillStyle = "#00FF88"; ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
      ctx.fillText(panel.badge, GAME_W / 2, py + ph - 16);
    }
    if (this.csPhase === "waiting" && Math.sin(t * 3) > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.font = "11px monospace"; ctx.textAlign = "right";
      ctx.fillText("[ SPACE / CLICK ] continue", px + pw - 18, py + ph - 16);
    }
    ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.font = "10px monospace"; ctx.textAlign = "left";
    ctx.fillText(`${this.csPanelIdx + 1} / ${this.csPanels.length}`, px + 18, py + 18);
    ctx.strokeStyle = "#00FFFF"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py + 28); ctx.lineTo(px + pw * 0.32, py + 28); ctx.stroke();
  }

  private renderCSArt(art: string, x: number, y: number, w: number, h: number, t: number) {
    const ctx = this.hudCtx; ctx.save();
    ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, h - 4); ctx.clip();
    const cx = x + w / 2, cy = y + h / 2 - 50;
    if (art === "ocean") {
      for (let i = 0; i < 7; i++) {
        const wy = y + 60 + i * 48 + Math.sin(t * 0.4 + i) * 10;
        ctx.strokeStyle = `rgba(0,80,200,${0.14 + i * 0.03})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, wy);
        for (let wx = x; wx <= x + w; wx += 24) ctx.lineTo(wx, wy + Math.sin((wx - x) / 65 + t * 0.5 + i) * 16);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(0,200,255,0.5)"; ctx.shadowColor = "#00CCFF"; ctx.shadowBlur = 10; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(cx, cy, 85, 32, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + 35, cy - 18, 22, 11, -0.35, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (art === "crack") {
      ctx.fillStyle = "rgba(0,0,10,0.55)"; ctx.fillRect(x, y, w, h);
      const cracks: [number,number,number,number][] = [
        [cx,cy-65,cx+85,cy+45],[cx,cy-65,cx-65,cy+65],[cx-65,cy+65,cx+85,cy+45],
        [cx+85,cy+45,cx+130,cy-25],[cx-65,cy+65,cx-110,cy+18],
      ];
      ctx.strokeStyle = "rgba(255,255,255,0.32)"; ctx.lineWidth = 1;
      for (const c of cracks) { ctx.beginPath(); ctx.moveTo(c[0],c[1]); ctx.lineTo(c[2],c[3]); ctx.stroke(); }
      const figs: [number,number][] = [[cx-55,cy],[cx-12,cy],[cx+22,cy-5],[cx+55,cy+5]];
      ctx.strokeStyle = "rgba(0,255,136,0.45)"; ctx.lineWidth = 2;
      for (const [fx,fy] of figs) {
        ctx.beginPath(); ctx.arc(fx, fy-22, 9, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(fx, fy-13); ctx.lineTo(fx, fy+12); ctx.stroke();
      }
      ctx.font = "bold 17px Georgia, serif"; ctx.fillStyle = "rgba(255,220,50,0.5)"; ctx.textAlign = "center";
      ctx.fillText("DAD COME HOME", cx, cy + 68);
    } else if (art === "deep") {
      ctx.fillStyle = "rgba(0,0,25,0.65)"; ctx.fillRect(x, y, w, h);
      const pods2: [number,number][] = [[cx-110,cy+25],[cx+110,cy+25]];
      for (const [px2,py2] of pods2) {
        const pulse = 0.65 + Math.sin(t * 2.2) * 0.35;
        ctx.strokeStyle = `rgba(0,255,136,${pulse * 0.7})`; ctx.shadowColor = C_SAFE; ctx.shadowBlur = 20*pulse; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(px2, py2, 38, 24, 0, 0, Math.PI*2); ctx.stroke(); ctx.shadowBlur = 0;
      }
      const subY = cy - 50 + Math.sin(t * 0.6) * 8;
      ctx.strokeStyle = "rgba(0,200,255,0.6)"; ctx.shadowColor = "#00CCFF"; ctx.shadowBlur = 8; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, subY, 22, 9, 0, 0, Math.PI*2); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,50,50,0.12)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, 180, t*0.15, t*0.15 + Math.PI*1.2); ctx.stroke();
    } else if (art === "hospital") {
      ctx.fillStyle = "rgba(210,210,195,0.1)"; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(160,160,145,0.45)"; ctx.lineWidth = 1.5;
      ctx.strokeRect(cx-250, cy+20, 500, 120);
      ctx.strokeRect(cx-110, cy+30, 220, 65);
      ctx.beginPath(); ctx.arc(cx-65, cy+55, 13, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx-52, cy+58); ctx.lineTo(cx+90, cy+62); ctx.stroke();
      ctx.strokeStyle = "rgba(0,200,100,0.5)"; ctx.lineWidth = 1.5;
      const ekg = [0,0,0,12,-14,36,0,0,0,0,9,-18,0,0,0,0];
      ctx.beginPath(); ctx.moveTo(cx-90, cy-55);
      for (let i = 0; i < ekg.length; i++) ctx.lineTo(cx-90+i*14, cy-55+ekg[i]);
      ctx.stroke();
    } else if (art === "news") {
      ctx.fillStyle = "rgba(200,190,162,0.16)"; ctx.fillRect(cx-210, cy-115, 420, 215);
      ctx.strokeStyle = "rgba(140,130,110,0.5)"; ctx.lineWidth = 1; ctx.strokeRect(cx-210, cy-115, 420, 215);
      ctx.fillStyle = "rgba(50,40,30,0.82)"; ctx.font = "bold 11px serif"; ctx.textAlign = "center";
      ctx.fillText("THE MARIANA TIMES", cx, cy-95);
      ctx.fillStyle = "rgba(190,182,155,0.6)"; ctx.fillRect(cx-205, cy-87, 410, 1);
      ctx.font = "bold 10.5px serif"; ctx.fillStyle = "rgba(35,25,18,0.9)";
      ctx.fillText("MAN REMAINS IN COMA AFTER BOATING ACCIDENT", cx, cy-72);
      ctx.font = "9.5px serif"; ctx.fillStyle = "rgba(35,25,18,0.75)";
      ctx.fillText("Family of four perished. Sole survivor unresponsive.", cx, cy-52);
      ctx.fillText("Declared brain-dead. He was 38 years old.", cx, cy-34);
      ctx.fillStyle = "rgba(190,182,155,0.6)"; ctx.fillRect(cx-205, cy-8, 410, 1);
      ctx.font = "9px serif"; ctx.fillStyle = "rgba(35,25,18,0.6)";
      ctx.fillText("He survived them all.", cx, cy+10);
    }
    ctx.restore();
  }

  // ============================================================
  // MENU (on HUD canvas) — cockpit aesthetic
  // ============================================================
  private renderMenu() {
    const ctx = this.hudCtx;
    const t = Date.now() / 1000;

    // ── Deep-sea background ──
    const bg = ctx.createRadialGradient(GAME_W/2, GAME_H*0.42, 0, GAME_W/2, GAME_H*0.42, 720);
    bg.addColorStop(0,   'rgba(0,8,28,0.96)');
    bg.addColorStop(0.5, 'rgba(0,4,16,0.98)');
    bg.addColorStop(1,   'rgba(0,0,6,1.00)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, GAME_W, GAME_H);

    // Animated deep-sea current lines
    for (let i = 0; i < 7; i++) {
      const wy = 120 + i * 82 + Math.sin(t * 0.22 + i * 1.1) * 12;
      const alpha = 0.06 + i * 0.012;
      ctx.strokeStyle = `rgba(0,60,160,${alpha})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, wy);
      for (let wx = 0; wx <= GAME_W; wx += 32)
        ctx.lineTo(wx, wy + Math.sin(wx / 120 + t * 0.38 + i) * 18 + Math.sin(wx / 60 + t * 0.15) * 6);
      ctx.stroke();
    }

    // Expanding sonar ring from center
    const pr = ((t * 68) % 340) + 30;
    const ringA = Math.max(0, 0.28 - pr / 380);
    ctx.strokeStyle = `rgba(0,220,255,${ringA})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(GAME_W/2, GAME_H * 0.42, pr, 0, Math.PI * 2); ctx.stroke();
    const pr2 = ((t * 68 + 170) % 340) + 30;
    const ringA2 = Math.max(0, 0.14 - pr2 / 380);
    ctx.strokeStyle = `rgba(0,180,255,${ringA2})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(GAME_W/2, GAME_H * 0.42, pr2, 0, Math.PI * 2); ctx.stroke();

    // ── Title ──
    const titleY = GAME_H * 0.36;
    ctx.textAlign = 'center';
    // Outer glow
    ctx.shadowColor = '#004488'; ctx.shadowBlur = 60;
    ctx.fillStyle = '#001833'; ctx.font = 'bold 68px monospace';
    ctx.fillText('ECHOES OF THE DEEP', GAME_W/2, titleY);
    ctx.shadowBlur = 0;
    // Main title — cyan with fine amber underline
    ctx.shadowColor = '#00CCFF'; ctx.shadowBlur = 28;
    ctx.fillStyle = '#00E8FF'; ctx.font = 'bold 68px monospace';
    ctx.fillText('ECHOES OF THE DEEP', GAME_W/2, titleY);
    ctx.shadowBlur = 0;
    // Brass underline rule
    const lineW = 620;
    const grad = ctx.createLinearGradient(GAME_W/2 - lineW/2, 0, GAME_W/2 + lineW/2, 0);
    grad.addColorStop(0,    'rgba(100,80,40,0)');
    grad.addColorStop(0.15, 'rgba(160,130,70,0.85)');
    grad.addColorStop(0.5,  'rgba(200,168,80,0.95)');
    grad.addColorStop(0.85, 'rgba(160,130,70,0.85)');
    grad.addColorStop(1,    'rgba(100,80,40,0)');
    ctx.strokeStyle = grad; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(GAME_W/2 - lineW/2, titleY + 11); ctx.lineTo(GAME_W/2 + lineW/2, titleY + 11); ctx.stroke();

    // Sub-heading
    ctx.fillStyle = 'rgba(140,190,220,0.55)'; ctx.font = '14px monospace';
    ctx.fillText('DEEP-SEA EXPLORATION  ·  PSYCHOLOGICAL HORROR  ·  PUZZLE-SURVIVAL', GAME_W/2, titleY + 32);

    // ── Bottom cockpit panel ──
    const PANEL_Y = Math.floor(GAME_H * 0.64);
    const PANEL_H = GAME_H - PANEL_Y;

    // Trapezoid clip — same as the gameplay dashboard
    ctx.save();
    const TAPER = 10;
    ctx.beginPath();
    ctx.moveTo(TAPER, PANEL_Y); ctx.lineTo(GAME_W - TAPER, PANEL_Y);
    ctx.lineTo(GAME_W, GAME_H); ctx.lineTo(0, GAME_H);
    ctx.closePath(); ctx.clip();
    ctx.transform(1, 0, 0.012, 1, -PANEL_Y * 0.012, 0);

    // Panel base — aged gunmetal
    const baseGrad = ctx.createLinearGradient(0, PANEL_Y, 0, GAME_H);
    baseGrad.addColorStop(0,   '#1e2528');
    baseGrad.addColorStop(0.3, '#181e20');
    baseGrad.addColorStop(0.7, '#12171a');
    baseGrad.addColorStop(1,   '#0b0e0f');
    ctx.fillStyle = baseGrad; ctx.fillRect(0, PANEL_Y, GAME_W, PANEL_H);

    // Metal grain lines
    for (let i = 0; i < 5; i++) {
      const by = PANEL_Y + 12 + i * 30;
      ctx.strokeStyle = `rgba(255,255,255,${0.009 + i * 0.003})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(GAME_W, by); ctx.stroke();
    }

    // Side vignettes
    const vigL = ctx.createLinearGradient(0, PANEL_Y, 80, PANEL_Y);
    vigL.addColorStop(0, 'rgba(0,0,0,0.55)'); vigL.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vigL; ctx.fillRect(0, PANEL_Y, 80, PANEL_H);
    const vigR = ctx.createLinearGradient(GAME_W-80, PANEL_Y, GAME_W, PANEL_Y);
    vigR.addColorStop(0, 'rgba(0,0,0,0)'); vigR.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vigR; ctx.fillRect(GAME_W-80, PANEL_Y, 80, PANEL_H);

    // Top edge highlight (worn brass)
    const edgeH = ctx.createLinearGradient(0, PANEL_Y, 0, PANEL_Y + 7);
    edgeH.addColorStop(0, 'rgba(140,120,80,0.82)'); edgeH.addColorStop(1, 'rgba(50,42,28,0)');
    ctx.fillStyle = edgeH; ctx.fillRect(0, PANEL_Y, GAME_W, 7);
    ctx.strokeStyle = 'rgba(80,68,44,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, PANEL_Y + 7); ctx.lineTo(GAME_W, PANEL_Y + 7); ctx.stroke();

    // Rivets along top edge
    const rivetY = PANEL_Y + 4;
    for (let rx = 28; rx < GAME_W - 20; rx += 54) {
      const rg = ctx.createRadialGradient(rx-1, rivetY-1, 0, rx, rivetY, 5);
      rg.addColorStop(0, 'rgba(200,175,120,0.88)'); rg.addColorStop(0.45, 'rgba(105,90,58,0.65)');
      rg.addColorStop(1, 'rgba(30,25,15,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(rx, rivetY, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath(); ctx.ellipse(rx, rivetY+3, 3, 1.2, 0, 0, Math.PI*2); ctx.fill();
    }

    // Panel content — blinking prompt + controls
    const CY = PANEL_Y + 30;

    if (Math.sin(t * 2.4) > 0) {
      ctx.shadowColor = '#00FF88'; ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(0,255,136,0.92)'; ctx.font = 'bold 17px monospace'; ctx.textAlign = 'center';
      ctx.fillText('[ PRESS SPACE OR CLICK TO BEGIN ]', GAME_W/2, CY + 4);
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = 'rgba(160,148,100,0.48)'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    const ctrls = [
      'WASD — MOVE    SHIFT — BOOST    MOUSE — LOOK AROUND',
      'CLICK — SONAR PING    HOLD 1s — LARGE PING    F — FLARE    E — DOCK',
    ];
    ctrls.forEach((c, i) => ctx.fillText(c, GAME_W/2, CY + 30 + i * 16));

    // Credits line — bottom-right of panel
    ctx.fillStyle = 'rgba(120,106,70,0.38)'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
    ctx.fillText('SUBSEA INTERACTIVE  ·  ECHOES OF THE DEEP  ·  V1.0', GAME_W - 22, GAME_H - 10);

    ctx.restore();
  }

  // ============================================================
  // GAME OVER (on HUD canvas) — cockpit aesthetic
  // ============================================================
  private renderGameOver() {
    const ctx = this.hudCtx;
    const t = Date.now() / 1000;

    // Full-screen near-black overlay
    ctx.fillStyle = 'rgba(0,0,0,0.95)'; ctx.fillRect(0, 0, GAME_W, GAME_H);

    // Faint horizontal scan lines
    for (let sy = 0; sy < GAME_H; sy += 4) {
      ctx.fillStyle = 'rgba(255,0,0,0.018)';
      ctx.fillRect(0, sy, GAME_W, 2);
    }

    // ── Central cockpit-bezel card ──
    const CW = 580, CH = 220;
    const CX = GAME_W/2 - CW/2, CY = GAME_H/2 - CH/2 - 20;

    // Card shadow
    ctx.fillStyle = 'rgba(180,0,0,0.12)';
    ctx.fillRect(CX + 6, CY + 8, CW, CH);

    // Card base — same aged gunmetal as dashboard
    const baseGrad = ctx.createLinearGradient(CX, CY, CX, CY + CH);
    baseGrad.addColorStop(0,   '#23282a');
    baseGrad.addColorStop(0.4, '#1a1e20');
    baseGrad.addColorStop(1,   '#0e1112');
    ctx.fillStyle = baseGrad; ctx.fillRect(CX, CY, CW, CH);

    // Inner bevel highlight
    ctx.strokeStyle = 'rgba(200,0,0,0.45)'; ctx.lineWidth = 2;
    ctx.strokeRect(CX + 1, CY + 1, CW - 2, CH - 2);
    ctx.strokeStyle = 'rgba(80,0,0,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(CX + 4, CY + 4, CW - 8, CH - 8);

    // Top edge — brass-red highlight
    const edgeGrad = ctx.createLinearGradient(CX, CY, CX, CY + 6);
    edgeGrad.addColorStop(0, 'rgba(180,60,40,0.75)'); edgeGrad.addColorStop(1, 'rgba(60,20,10,0)');
    ctx.fillStyle = edgeGrad; ctx.fillRect(CX, CY, CW, 6);

    // Rivets — top edge
    const rivetY = CY + 4;
    for (let rx = CX + 18; rx < CX + CW - 10; rx += 40) {
      const rg = ctx.createRadialGradient(rx-1, rivetY-1, 0, rx, rivetY, 4);
      rg.addColorStop(0, 'rgba(200,120,100,0.85)'); rg.addColorStop(0.5, 'rgba(100,50,40,0.6)');
      rg.addColorStop(1, 'rgba(30,10,10,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(rx, rivetY, 3.5, 0, Math.PI*2); ctx.fill();
    }

    // Card content
    ctx.textAlign = 'center';
    // Header label
    ctx.fillStyle = 'rgba(160,148,100,0.55)'; ctx.font = '10px monospace';
    ctx.fillText('ALERT  ·  SUBSYSTEM FAILURE  ·  ALERT', GAME_W/2, CY + 24);
    // Thin separator
    ctx.strokeStyle = 'rgba(160,50,40,0.38)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX + 24, CY + 30); ctx.lineTo(CX + CW - 24, CY + 30); ctx.stroke();

    // Main title — red glow
    ctx.shadowColor = '#FF2200'; ctx.shadowBlur = 30;
    ctx.fillStyle = '#FF3322'; ctx.font = 'bold 44px monospace';
    ctx.fillText(this.gameOverReason === "hull" ? 'HULL FAILURE' : 'OXYGEN DEPLETED', GAME_W/2, CY + 82);
    ctx.shadowBlur = 0;

    // Quote
    ctx.fillStyle = 'rgba(100,180,220,0.55)'; ctx.font = 'italic 15px monospace';
    ctx.fillText(this.gameOverReason === "hull" ? '"The hull cannot take any more..."' : '"I\'m sorry..."', GAME_W/2, CY + 116);

    // Thin separator
    ctx.strokeStyle = 'rgba(80,60,40,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX + 24, CY + 132); ctx.lineTo(CX + CW - 24, CY + 132); ctx.stroke();

    // Blinking retry prompt
    if (Math.sin(t * 2.5) > 0) {
      ctx.shadowColor = '#00CC88'; ctx.shadowBlur = 12;
      ctx.fillStyle = 'rgba(0,200,130,0.88)'; ctx.font = 'bold 14px monospace';
      ctx.fillText('[ PRESS SPACE TO RETRY ]', GAME_W/2, CY + 158);
      ctx.shadowBlur = 0;
    }

    // Level indicator at bottom of card
    ctx.fillStyle = 'rgba(120,108,72,0.38)'; ctx.font = '9px monospace';
    ctx.fillText(`SECTOR ${['ALPHA','BETA','GAMMA'][this.lvlIdx] ?? 'UNKNOWN'}  ·  DEPTH ${[20,55,82][this.lvlIdx] ?? 0}m`, GAME_W/2, CY + CH - 10);
  }

  // ============================================================
  // LEVEL TRANSITION (on HUD canvas) — cockpit aesthetic
  // ============================================================
  private renderLevelTransition() {
    const ctx = this.hudCtx;
    const elapsed = Date.now() - this.transitionStartMs;
    const progress = Math.min(1, elapsed / this.transitionDurationMs); // 0→1 over full duration

    // Fade-in 0→0.25 / hold / fade-out 0.82→1
    let alpha = 1;
    if (progress < 0.12) alpha = progress / 0.12;
    else if (progress > 0.84) alpha = 1 - (progress - 0.84) / 0.16;
    alpha = Math.max(0, Math.min(1, alpha));

    // ── Full-screen deep-sea background ──
    ctx.globalAlpha = alpha;
    const bg = ctx.createRadialGradient(GAME_W/2, GAME_H*0.45, 0, GAME_W/2, GAME_H*0.45, 700);
    bg.addColorStop(0,   'rgba(0,6,22,0.97)');
    bg.addColorStop(0.55,'rgba(0,3,12,0.99)');
    bg.addColorStop(1,   'rgba(0,0,5,1.00)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, GAME_W, GAME_H);

    // Slow-drift current lines
    const tSec = Date.now() / 1000;
    for (let i = 0; i < 5; i++) {
      const wy = 80 + i * 110 + Math.sin(tSec * 0.18 + i * 1.4) * 8;
      ctx.strokeStyle = `rgba(0,50,140,${0.05 + i * 0.008})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, wy);
      for (let wx = 0; wx <= GAME_W; wx += 36)
        ctx.lineTo(wx, wy + Math.sin(wx / 130 + tSec * 0.28 + i) * 14);
      ctx.stroke();
    }

    // ── Central card ──
    const CW = 640, CH = 260;
    const CX = GAME_W/2 - CW/2, CY = GAME_H/2 - CH/2;

    // Card shadow
    ctx.fillStyle = 'rgba(0,120,200,0.10)';
    ctx.fillRect(CX + 8, CY + 10, CW, CH);

    // Card base — aged gunmetal aluminum
    const baseGrad = ctx.createLinearGradient(CX, CY, CX, CY + CH);
    baseGrad.addColorStop(0,   '#22292c');
    baseGrad.addColorStop(0.3, '#1a2022');
    baseGrad.addColorStop(0.7, '#14191a');
    baseGrad.addColorStop(1,   '#0d1011');
    ctx.fillStyle = baseGrad; ctx.fillRect(CX, CY, CW, CH);

    // Metal grain lines
    for (let i = 0; i < 4; i++) {
      const by = CY + 16 + i * 34;
      ctx.strokeStyle = `rgba(255,255,255,${0.008 + i * 0.003})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(CX, by); ctx.lineTo(CX + CW, by); ctx.stroke();
    }

    // Outer bezel — double bevel
    ctx.strokeStyle = 'rgba(0,160,220,0.55)'; ctx.lineWidth = 2;
    ctx.strokeRect(CX + 1, CY + 1, CW - 2, CH - 2);
    ctx.strokeStyle = 'rgba(0,60,100,0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(CX + 5, CY + 5, CW - 10, CH - 10);

    // Top edge — worn brass highlight
    const edgeGrad = ctx.createLinearGradient(CX, CY, CX, CY + 7);
    edgeGrad.addColorStop(0, 'rgba(140,122,78,0.88)'); edgeGrad.addColorStop(1, 'rgba(50,44,26,0)');
    ctx.fillStyle = edgeGrad; ctx.fillRect(CX, CY, CW, 7);
    ctx.strokeStyle = 'rgba(80,70,46,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX, CY + 7); ctx.lineTo(CX + CW, CY + 7); ctx.stroke();

    // Rivets — top edge
    const rivetY = CY + 4;
    for (let rx = CX + 20; rx < CX + CW - 12; rx += 48) {
      const rg = ctx.createRadialGradient(rx-1, rivetY-1, 0, rx, rivetY, 4.5);
      rg.addColorStop(0, 'rgba(200,178,128,0.88)'); rg.addColorStop(0.45, 'rgba(110,92,62,0.65)');
      rg.addColorStop(1, 'rgba(30,25,14,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(rx, rivetY, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.36)';
      ctx.beginPath(); ctx.ellipse(rx, rivetY+3, 3.2, 1.3, 0, 0, Math.PI*2); ctx.fill();
    }

    // ── Card content ──
    ctx.textAlign = 'center';

    // Header label row
    ctx.fillStyle = 'rgba(155,142,100,0.55)'; ctx.font = '10px monospace';
    ctx.fillText('NAVIGATION  ·  DEPTH CONTROL  ·  NAVIGATION', GAME_W/2, CY + 23);
    ctx.strokeStyle = 'rgba(80,70,46,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX + 20, CY + 29); ctx.lineTo(CX + CW - 20, CY + 29); ctx.stroke();

    // "DEPTH INCREASING" alert
    const lvlNames = ['LEVEL I — THE DESCENT', 'LEVEL II — THE PRESSURE ZONE', 'LEVEL III — THE ABYSS'];
    const depthVals = [20, 55, 82];
    const lvlLabel = lvlNames[this.transitionTargetLvl] ?? `LEVEL ${this.transitionTargetLvl + 1}`;
    const targetDepth = depthVals[this.transitionTargetLvl] ?? 0;

    ctx.shadowColor = '#00AAFF'; ctx.shadowBlur = 20;
    ctx.fillStyle = '#88CCFF'; ctx.font = 'bold 13px monospace';
    ctx.fillText('DEPTH INCREASING', GAME_W/2, CY + 56);
    ctx.shadowBlur = 0;

    // Level name — large, cyan
    ctx.shadowColor = '#00CCFF'; ctx.shadowBlur = 26;
    ctx.fillStyle = '#00E0FF'; ctx.font = 'bold 32px monospace';
    ctx.fillText(lvlLabel, GAME_W/2, CY + 98);
    ctx.shadowBlur = 0;

    // Thin separator
    ctx.strokeStyle = 'rgba(0,120,180,0.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX + 40, CY + 110); ctx.lineTo(CX + CW - 40, CY + 110); ctx.stroke();

    // ── Analog depth gauge sweep ──
    // Needle sweeps from 0 to targetDepth over the first 70% of transition
    const sweepProgress = Math.min(1, progress / 0.70);
    // Ease-out: fast then slow
    const easedSweep = 1 - Math.pow(1 - sweepProgress, 2.5);
    const displayDepth = Math.round(easedSweep * targetDepth);

    const GCX = GAME_W/2, GCY = CY + 168, GR = 38;
    const G_START = Math.PI * 0.72;   // ~130° — left side
    const G_SWEEP = Math.PI * 1.56;   // ~280° sweep arc

    // Gauge background track
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(GCX, GCY, GR - 5, G_START, G_START + G_SWEEP); ctx.stroke();

    // Depth colour: green → yellow → blue-white at depth
    const dNorm = displayDepth / 100;
    const gaugeColor = dNorm < 0.5 ? '#00FF88' : dNorm < 0.8 ? '#FFD700' : '#00CCFF';

    // Filled arc up to current value
    if (easedSweep > 0.005) {
      ctx.strokeStyle = gaugeColor; ctx.shadowColor = gaugeColor; ctx.shadowBlur = 8;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(GCX, GCY, GR - 5, G_START, G_START + easedSweep * G_SWEEP); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Tick marks (5 ticks)
    for (let ti = 0; ti <= 4; ti++) {
      const ta = G_START + (ti / 4) * G_SWEEP;
      const tLen = ti === 0 || ti === 4 || ti === 2 ? 6 : 4;
      ctx.strokeStyle = 'rgba(155,142,100,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(GCX + Math.cos(ta) * (GR - 1), GCY + Math.sin(ta) * (GR - 1));
      ctx.lineTo(GCX + Math.cos(ta) * (GR - 1 - tLen), GCY + Math.sin(ta) * (GR - 1 - tLen));
      ctx.stroke();
    }

    // Needle
    const needleAngle = G_START + easedSweep * G_SWEEP;
    ctx.strokeStyle = gaugeColor; ctx.shadowColor = gaugeColor; ctx.shadowBlur = 6;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(GCX - Math.cos(needleAngle) * (GR * 0.22), GCY - Math.sin(needleAngle) * (GR * 0.22));
    ctx.lineTo(GCX + Math.cos(needleAngle) * (GR - 8), GCY + Math.sin(needleAngle) * (GR - 8));
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Center hub
    ctx.fillStyle = '#3a3010'; ctx.beginPath(); ctx.arc(GCX, GCY, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(200,168,75,0.7)'; ctx.beginPath(); ctx.arc(GCX-0.8, GCY-0.8, 1.4, 0, Math.PI*2); ctx.fill();

    // Depth readout
    ctx.fillStyle = gaugeColor; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${displayDepth}m`, GCX, GCY + GR + 14);
    ctx.fillStyle = 'rgba(155,142,100,0.55)'; ctx.font = '8px monospace';
    ctx.fillText('DEPTH', GCX, GCY + GR + 24);

    // Bottom credits bar
    ctx.strokeStyle = 'rgba(80,70,46,0.32)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX + 20, CY + CH - 20); ctx.lineTo(CX + CW - 20, CY + CH - 20); ctx.stroke();
    ctx.fillStyle = 'rgba(120,108,70,0.36)'; ctx.font = '9px monospace';
    ctx.fillText('HULL PRESSURE NOMINAL  ·  LIFE SUPPORT STABLE  ·  PROCEEDING', GAME_W/2, CY + CH - 8);

    ctx.globalAlpha = 1;
  }

  // ============================================================
  // GLITCH EFFECT
  // ============================================================
  private renderGlitch() {
    const ctx = this.hudCtx;
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = `rgba(255,0,0,${0.03 + Math.random()*0.04})`;
    ctx.fillRect(3, 0, GAME_W, GAME_H);
    ctx.fillStyle = `rgba(0,255,255,${0.02 + Math.random()*0.03})`;
    ctx.fillRect(-3, 0, GAME_W, GAME_H);
    ctx.globalCompositeOperation = "source-over";
    // Random horizontal slice offsets
    for (let i = 0; i < 3; i++) {
      const gy = Math.random() * GAME_H;
      const gh = Math.random() * 18 + 4;
      const gx = (Math.random() - 0.5) * 24;
      try {
        const d = ctx.getImageData(0, gy, GAME_W, gh);
        ctx.clearRect(0, gy, GAME_W, gh);
        ctx.putImageData(d, gx, gy);
      } catch (_) { /* cross-origin guard */ }
    }
  }

  // ============================================================
  // LOOP
  // ============================================================
  private loop(ts: number) {
    const dt = Math.min(ts - this.lastT, 50);
    this.lastT = ts;
    this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame(ts2 => this.loop(ts2));
  }

  start() {
    if (this.webglFailed) return; // headless / no-GPU environment
    this.lastT = performance.now();
    this.loop(this.lastT);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    this.renderer.dispose();
  }
}

// ============================================================
// EXPORT
// ============================================================
export function initGame(threeCanvas: HTMLCanvasElement, hudCanvas: HTMLCanvasElement): () => void {
  const game = new EchoesGame(threeCanvas, hudCanvas);
  game.start();
  return () => game.destroy();
}
