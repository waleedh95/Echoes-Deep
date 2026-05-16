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
const PANEL_Y = 500; // dashboard panel top — porthole window bottom
const PLAYER_SIZE = 15;
const PLAYER_SPEED = 210;
const PLAYER_BOOST_MULT = 2.0;
const PLAYER_FRICTION = 0.84;
const PLAYER_BOUNCE_RESTITUTION = 0.2; // fraction of normal velocity reflected on wall impact
const O2_DRAIN_NORMAL = 1 / 3;
const O2_DRAIN_BOOST = 1.0;
const O2_LOSS_HIT = 15;
const NOISE_DECAY = 5;
const SONAR_SMALL_R = 550;
const SONAR_LARGE_R = 3800; // covers entire map — full depth-scan on large ping
const SONAR_SMALL_NOISE = 5;
const SONAR_LARGE_NOISE = 25;
const FLARE_DURATION = 8000;
const FLARE_PING_INTERVAL = 1500;
const INTERACT_RADIUS = 65;
const AUTO_FORWARD_SPEED = 88;  // px/s constant thrust toward the lifepod
const AUTO_FORWARD_YAW = -Math.PI / 2; // camera always faces +px direction

// ── Leviathan 4-state AI constants ───────────────────────────────────────────
const LEV_HEAR_SMALL_PING  = 900;   // px — small sonar ping alert radius
const LEV_HEAR_LARGE_PING  = 99999; // covers whole level
const LEV_HEAR_COLLISION   = 450;   // wall/rock impact radius
const LEV_HEAR_FULL_SPEED  = 300;   // full-speed movement noise radius
const LEV_HEAR_FLARE       = 800;   // flare redirect radius
const LEV_ALERT_TIMEOUT    = 5000;  // ms — Alert → Patrol if no re-trigger
const LEV_HUNT_LOSS_TIME   = 8000;  // ms near-stillness before Hunt → Patrol
const LEV_PLAYER_SLOW_FRAC = 0.5;   // fraction of max speed = "slow"
const LEV_ATTACK_DIST      = 90;    // px — ram range trigger
const LEV_ATTACK_COOLDOWN  = 2200;  // ms — min gap between rams
const LEV_ATTACK_HULL_DMG  = 22;    // hull damage per ram
const LEV_ATTACK_O2_DMG    = 18;    // O2 loss per ram
const LEV_ATTACK_PUSHBACK  = 180;   // px — push-back after ram
const LEV_SPD_PATROL       = 1.0;   // speed multiplier in Patrol
const LEV_SPD_ALERT        = 1.4;   // speed multiplier in Alert
const LEV_SPD_HUNT         = 1.9;   // base Hunt speed
const LEV_SPD_HUNT_CLOSE   = 2.8;   // Hunt speed when close to player
const LEV_HUNT_CLOSE_DIST  = 380;   // px — distance where speed ramps up
const LEV_SPEED_NOISE_INTV = 220;   // ms between full-speed sound events
const LEV_OCCLUDER_MIN     = 140;   // px min dimension to count as occluder
const LEV_PROX_MAX_DIST    = 900;   // px — beyond this distance prox volume = 0

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
  uniform vec3  uPingColor[MAX_PINGS];
  uniform vec3  uObjectColor;
  varying vec3  vWorldPos;

  // Full-spectrum hue → RGB (smooth HSV-style rainbow)
  vec3 hueRGB(float h) {
    float r = abs(h * 6.0 - 3.0) - 1.0;
    float g = 2.0 - abs(h * 6.0 - 2.0);
    float b = 2.0 - abs(h * 6.0 - 4.0);
    return clamp(vec3(r, g, b), 0.0, 1.0);
  }

  void main() {
    float alpha = 0.0;
    vec3  col   = vec3(0.0);

    for (int i = 0; i < MAX_PINGS; i++) {
      float op = uPingOpacity[i];
      if (op < 0.004) continue;

      float dx   = vWorldPos.x - uPingOrigin[i].x;
      float dz   = vWorldPos.z - uPingOrigin[i].z;
      float dist = sqrt(dx * dx + dz * dz);
      float radius = uPingRadius[i];

      // ── Ring front: leading edge ──
      float ringDist = abs(dist - radius);
      float ringGlow = max(0.0, 1.0 - ringDist / 0.55) * op * 3.0;
      ringGlow = pow(ringGlow, 0.65);

      // ── Grid painted onto entire swept zone ──
      float gridGlow = 0.0;
      if (dist < radius) {
        float gridSz = 0.48;
        float lw     = 0.13;
        float gx = abs(fract(vWorldPos.x / gridSz + 0.5) - 0.5) * 2.0;
        float gz = abs(fract(vWorldPos.z / gridSz + 0.5) - 0.5) * 2.0;
        float lines = max(
          smoothstep(1.0 - lw * 2.4, 1.0, gx),
          smoothstep(1.0 - lw * 2.4, 1.0, gz)
        );
        float cross = min(
          smoothstep(1.0 - lw * 2.4, 1.0, gx) *
          smoothstep(1.0 - lw * 2.4, 1.0, gz) * 2.0, 1.0);
        gridGlow = (lines + cross * 0.7) * op * 1.5;
      }

      float glow = max(ringGlow, gridGlow);
      if (glow < 0.003) continue;
      alpha = max(alpha, min(glow, 0.80));

      // ── Spectral / rainbow colour — world-position-based ──
      float spectralT = fract(vWorldPos.x * 0.12 + vWorldPos.z * 0.08 + float(i) * 0.31);
      vec3  specColor = hueRGB(spectralT) * 1.1;   // subdued rainbow

      // Ring front: mostly rainbow + ping-type base, faintly tinted by object material
      // Grid behind ring: object material color
      float ringFrac   = ringGlow / (glow + 0.001);
      vec3  ringColor  = mix(uPingColor[i] * 1.2, uObjectColor * 1.2, 0.12);
      vec3  fillColor  = mix(uObjectColor * 1.3, ringColor, ringFrac);
      col += mix(fillColor, specColor, 0.20 + ringFrac * 0.55) * glow;
    }

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(min(col, vec3(2.0)), min(alpha, 1.0));
  }
`;

// Sonar grid fill colour palette — maps object category to RGB triple for uObjectColor.
// Defined at module level so scene-build and dynamic spawn sites share the same source.
const SONAR_OBJECT_PALETTE: Record<string, readonly [number, number, number]> = {
  shipwreck:  [0.72, 0.28, 0.08],  // rust-brown / corroded metal
  rock:       [0.30, 0.42, 0.55],  // slate blue-gray
  debris:     [0.62, 0.38, 0.12],  // corroded orange
  wall:       [0.28, 0.33, 0.40],  // stone gray
  floor:      [0.04, 0.38, 0.42],  // dark teal
  stalactite: [0.40, 0.18, 0.60],  // deep purple
  platform:   [0.45, 0.50, 0.58],  // steel gray
  default:    [0.04, 0.92, 1.00],  // sonar cyan
};

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
  ghostSpawned?: boolean;  // L3: ensure ghost echoes spawn exactly once per ping
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
  state: "patrol" | "alert" | "hunt" | "attacking";
  visTimer: number; hitR: number; listenTimer: number; damagedAt: number;
  roarTimer?: number;
  hearingDist?: number; alertDist?: number;
  // Leviathan 4-state AI fields
  lastSoundOrigin?: Vec2;    // world pos of last triggering sound event
  alertTimer?: number;       // ms countdown while in Alerted — returns to Patrol if expires
  lostSignalTimer?: number;  // ms of near-stillness while Hunting — decay to Patrol at 8s
  attackCooldown?: number;   // ms before can Attack again
  proximityVolume?: number;  // 0..1 ventilator gain for this leviathan
}

interface SoundEvent {
  type: "small_ping" | "large_ping" | "medium_ping" | "extra_large" | "collision" | "full_speed" | "flare";
  x: number; y: number;
  radius: number;
}
interface Lifepod { x: number; y: number; id: string; rescued: boolean; revealTimer: number; character: string; commsLine: string }
interface NoiseObj { x: number; y: number; id: string; silenced: boolean; noiseRate: number; revealTimer: number }
interface Flare { x: number; y: number; vy: number; timer: number; pingTimer: number }
interface DialogueCue { time: number; text: string }
interface GasPod { x: number; y: number; id: string; triggered: boolean }
interface SnapBranch { x: number; y: number; id: string; triggered: boolean }
interface PowerConduit { x: number; y: number; id: number; activated: boolean }
interface UnstableBuilding { obstacleIdx: number; cx: number; cy: number; collapsed: boolean }
interface GhostEcho3D { sphere: THREE.Mesh; mat: THREE.MeshBasicMaterial; radius: number; maxR: number; life: number }

interface LevelData {
  id: number; name: string; worldW: number; worldH: number;
  playerStart: Vec2; obstacles: Rect[];
  enemyDefs: Array<Omit<Enemy, "state" | "visTimer" | "listenTimer" | "damagedAt">>;
  pods: Lifepod[]; noiseObjs?: NoiseObj[]; o2Start: number; dialogue: DialogueCue[];
  flares?: number;
  /** Gold letter collectibles spelling a family member's name */
  letters?: string[];
  /** Level 1: exploding gas pod hazards */
  gasPods?: Array<{ x: number; y: number; id: string }>;
  /** Level 1: kelp snap-branch noise hazards */
  snapBranches?: Array<{ x: number; y: number; id: string }>;
  /** Level 2: index of the bulkhead door obstacle */
  bulkheadObstacleIdx?: number;
  /** Level 2: wreck positions for Graveyard Breathes events */
  wreckPositions?: Vec2[];
  /** Level 3: interactable power conduit defs */
  powerConduits?: Array<{ x: number; y: number; id: number }>;
  /** Level 3: obstacle indices that are city gates (removed when conduits activated) */
  gateObstacleIdxs?: number[];
  /** Level 3: obstacle indices that are unstable buildings */
  unstableObstacleData?: Array<{ obstacleIdx: number; cx: number; cy: number }>;
}
interface CutscenePanel { text: string; speaker: string; art: string; badge?: string }

interface LetterEntity {
  char: string;
  x: number; y: number;       // 2D world-space position
  collected: boolean;
  flashTimer: number;          // ms remaining for collection flash (0 = gone)
  revealAlpha: number;         // 0..1 — proximity-driven fade-in; 0 = invisible
}

type GameState = "MENU" | "STORE" | "PLAYING" | "CUTSCENE" | "DISCOVERY" | "COLLAPSE" | "GAME_OVER" | "LEVEL_TRANSITION";

// ============================================================
// PLAYER PROFILE (in-memory, set from store/auth)
// ============================================================
interface PlayerProfile {
  username: string;
  echoBalance: number;
  bonusFlares: number;
  sonarLevel: number;
}

const SONAR_CHARGE_RATES = [12.5, 15.38, 20.0, 28.57, 50.0]; // units/s for levels 0-4
let currentPlayerProfile: PlayerProfile | null = null;

export function setPlayerProfile(profile: PlayerProfile | null): void {
  currentPlayerProfile = profile;
  window.dispatchEvent(new CustomEvent("echoes:profile-changed", { detail: profile }));
}

export function getPlayerProfile(): PlayerProfile | null {
  return currentPlayerProfile;
}

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
  private _ambientCreakMinDelay = 7000;
  private _ambientCreakMaxDelay = 15000;

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

  setAmbientCreakLevel(lvlIdx: number) {
    if (!this.ctx) return;
    const g = this.getAmbientCreakGain();
    // Level 0 (Alpha): subtle creaks, long gaps
    // Level 1 (Beta): moderate — pressure building
    // Level 2 (Gamma): frequent & louder — maximum depth stress
    const cfg = [
      { gain: 0.12, minDelay: 12000, maxDelay: 22000 },
      { gain: 0.22, minDelay:  8000, maxDelay: 16000 },
      { gain: 0.34, minDelay:  5000, maxDelay: 11000 },
    ][lvlIdx] ?? { gain: 0.12, minDelay: 12000, maxDelay: 22000 };
    this._ambientCreakMinDelay = cfg.minDelay;
    this._ambientCreakMaxDelay = cfg.maxDelay;
    g.gain.linearRampToValueAtTime(cfg.gain, this.ctx.currentTime + 1.5);
  }

  private scheduleAmbientCreak() {
    if (!this.ctx) return;
    // Random interval driven by level — tighter at deeper sectors
    const delay = this._ambientCreakMinDelay + Math.random() * (this._ambientCreakMaxDelay - this._ambientCreakMinDelay);
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
  private breathGain: GainNode | null = null;
  private breathFlt: BiquadFilterNode | null = null;
  private breathTimer: ReturnType<typeof setTimeout> | null = null;
  private breathInterval = 4500;
  private _breathPeak = 0.06;
  private lastBreathTier = -1;

  resetBreathingTier() { this.lastBreathTier = -1; }

  startBreathing() {
    if (!this.ctx || !this.master) return;
    this.breathGain = this.ctx.createGain(); this.breathGain.gain.value = 0;
    this.breathFlt = this.ctx.createBiquadFilter(); this.breathFlt.type = "bandpass"; this.breathFlt.frequency.value = 340; this.breathFlt.Q.value = 2;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth"; osc.frequency.value = 52;
    osc.connect(this.breathFlt); this.breathFlt.connect(this.breathGain); this.breathGain.connect(this.master); osc.start();
    const breathe = () => {
      if (!this.ctx || !this.breathGain) return;
      const t = this.ctx.currentTime;
      const dur = Math.min(this.breathInterval / 1000, 4.5);
      this.breathGain.gain.setValueAtTime(0, t);
      this.breathGain.gain.linearRampToValueAtTime(this._breathPeak, t + dur * 0.42);
      this.breathGain.gain.linearRampToValueAtTime(0, t + dur);
      this.breathTimer = setTimeout(breathe, this.breathInterval);
    };
    breathe();
  }

  setBreathingO2(o2: number) {
    if (!this.ctx || !this.breathGain || !this.breathFlt) return;
    // 4 tiers: calm → slightly heavy → labored → desperate
    const tier = o2 > 60 ? 0 : o2 > 30 ? 1 : o2 > 10 ? 2 : 3;
    if (tier === this.lastBreathTier) return;
    this.lastBreathTier = tier;
    const cfgs = [
      { interval: 4500, peak: 0.06, freq: 340, q: 2.0 },
      { interval: 3800, peak: 0.09, freq: 305, q: 1.7 },
      { interval: 2700, peak: 0.14, freq: 255, q: 1.3 },
      { interval: 1900, peak: 0.20, freq: 200, q: 1.0 },
    ];
    const cfg = cfgs[tier];
    this.breathInterval = cfg.interval;
    this._breathPeak = cfg.peak;
    this.breathFlt.frequency.linearRampToValueAtTime(cfg.freq, this.ctx.currentTime + 1.5);
    this.breathFlt.Q.linearRampToValueAtTime(cfg.q, this.ctx.currentTime + 1.5);
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

  // ── LEVIATHAN RETREAT — muted receding growl fired on Hunt→Patrol (signal lost) ──
  leviathanRetreat() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const dur = 2.2;

    // Output at low gain — creature is receding
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.18, t0);
    out.gain.linearRampToValueAtTime(0.12, t0 + 0.4);
    out.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    // Heavy lowpass — muffled by distance
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(280, t0);
    lp.frequency.exponentialRampToValueAtTime(140, t0 + dur);
    lp.Q.value = 0.8;
    out.connect(lp); lp.connect(this.master);

    // Sub-bass: starts low, sweeps further down (creature moving away)
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(55, t0);
    sub.frequency.exponentialRampToValueAtTime(22, t0 + dur);
    const subG = ctx.createGain(); subG.gain.value = 0.6;
    sub.connect(subG); subG.connect(out);
    sub.start(t0); sub.stop(t0 + dur);

    // Sawtooth growl — slow LFO snarl, fades quickly
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(72, t0);
    saw.frequency.exponentialRampToValueAtTime(30, t0 + dur);
    const lfo = ctx.createOscillator();
    lfo.type = "sine"; lfo.frequency.value = 5;
    const lfoG = ctx.createGain(); lfoG.gain.value = 10;
    lfo.connect(lfoG); lfoG.connect(saw.frequency);
    const sawG = ctx.createGain(); sawG.gain.value = 0.28;
    saw.connect(sawG); sawG.connect(out);
    saw.start(t0); saw.stop(t0 + dur);
    lfo.start(t0); lfo.stop(t0 + dur);

    // Clean up
    saw.onended = () => {
      try {
        sub.disconnect(); subG.disconnect();
        saw.disconnect(); sawG.disconnect();
        lfo.disconnect(); lfoG.disconnect();
        out.disconnect(); lp.disconnect();
      } catch { /* nodes already disconnected */ }
    };
  }

  // ── LEVIATHAN DETECTION SCREECH — sharp alien shriek fired on Patrol→Alert ──
  leviathanDetectionScreech() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.6, t0);
    out.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);
    // Frequency-modulated shriek: fast descending sweep + harmonic overtones
    const osc1 = ctx.createOscillator(); osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(1800, t0);
    osc1.frequency.exponentialRampToValueAtTime(340, t0 + 0.65);
    const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 28;
    const lfoG = ctx.createGain(); lfoG.gain.value = 240;
    lfo.connect(lfoG); lfoG.connect(osc1.frequency);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1100; bp.Q.value = 1.5;
    const g1 = ctx.createGain(); g1.gain.value = 0.65;
    osc1.connect(bp); bp.connect(g1); g1.connect(out);
    // Noise burst — adds guttural gravel texture
    const nLen = Math.ceil(ctx.sampleRate * 0.55);
    const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nd = nBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1);
    const nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf;
    const nFlt = ctx.createBiquadFilter(); nFlt.type = "bandpass"; nFlt.frequency.value = 620; nFlt.Q.value = 2.5;
    const nG = ctx.createGain(); nG.gain.value = 0.35;
    nSrc.connect(nFlt); nFlt.connect(nG); nG.connect(out);
    // Sub-bass punch to feel the creature lurch
    const sub = ctx.createOscillator(); sub.type = "sine";
    sub.frequency.setValueAtTime(95, t0); sub.frequency.exponentialRampToValueAtTime(28, t0 + 0.55);
    const subG = ctx.createGain(); subG.gain.value = 0.45;
    sub.connect(subG); subG.connect(out);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200;
    out.connect(lp); lp.connect(this.master);
    osc1.start(t0); osc1.stop(t0 + 0.7);
    lfo.start(t0); lfo.stop(t0 + 0.7);
    nSrc.start(t0); nSrc.stop(t0 + 0.55);
    sub.start(t0); sub.stop(t0 + 0.55);
    nSrc.onended = () => { try { osc1.disconnect(); lfo.disconnect(); lfoG.disconnect(); bp.disconnect(); g1.disconnect(); nSrc.disconnect(); nFlt.disconnect(); nG.disconnect(); sub.disconnect(); subG.disconnect(); out.disconnect(); lp.disconnect(); } catch { /**/ } };
  }

  // ── LEVIATHAN ATTACK BURST — violent impact boom on ram ──
  leviathanAttackBurst() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime;
    // Deep sub-bass impact
    const subOsc = ctx.createOscillator(); subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(62, t0); subOsc.frequency.exponentialRampToValueAtTime(22, t0 + 0.55);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.8, t0); subG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    subOsc.connect(subG); subG.connect(this.master);
    subOsc.start(t0); subOsc.stop(t0 + 0.6);
    // Noise burst — body impact texture
    const nLen = Math.ceil(ctx.sampleRate * 0.38);
    const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nd = nBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1);
    const nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf;
    const nLp = ctx.createBiquadFilter(); nLp.type = "lowpass"; nLp.frequency.value = 300;
    const nG = ctx.createGain();
    nG.gain.setValueAtTime(0.7, t0); nG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);
    nSrc.connect(nLp); nLp.connect(nG); nG.connect(this.master);
    nSrc.start(t0); nSrc.stop(t0 + 0.38);
    // High guttural screech burst after impact
    const scOsc = ctx.createOscillator(); scOsc.type = "sawtooth";
    scOsc.frequency.setValueAtTime(220, t0 + 0.06); scOsc.frequency.exponentialRampToValueAtTime(85, t0 + 0.65);
    const scBp = ctx.createBiquadFilter(); scBp.type = "bandpass"; scBp.frequency.value = 380; scBp.Q.value = 3;
    const scG = ctx.createGain();
    scG.gain.setValueAtTime(0, t0); scG.gain.linearRampToValueAtTime(0.55, t0 + 0.08); scG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);
    scOsc.connect(scBp); scBp.connect(scG); scG.connect(this.master);
    scOsc.start(t0 + 0.06); scOsc.stop(t0 + 0.75);
    nSrc.onended = () => { try { subOsc.disconnect(); subG.disconnect(); nSrc.disconnect(); nLp.disconnect(); nG.disconnect(); scOsc.disconnect(); scBp.disconnect(); scG.disconnect(); } catch { /**/ } };
  }

  // ── LEVIATHAN PROXIMITY BREATHING — continuous ventilator layer tied to distance ──
  private levProxGain: GainNode | null = null;
  private levProxMaster: GainNode | null = null;

  initLeviathanProx() {
    if (!this.ctx || !this.master || this.levProxGain) return;
    const ctx = this.ctx;
    this.levProxMaster = ctx.createGain(); this.levProxMaster.gain.value = 0;
    this.levProxMaster.connect(this.master);
    // Low mechanical hum base
    const humOsc = ctx.createOscillator(); humOsc.type = "square"; humOsc.frequency.value = 42;
    const humFlt = ctx.createBiquadFilter(); humFlt.type = "lowpass"; humFlt.frequency.value = 110;
    const humG = ctx.createGain(); humG.gain.value = 0.028;
    humOsc.connect(humFlt); humFlt.connect(humG); humG.connect(this.levProxMaster); humOsc.start();
    // Creature breath noise layer
    const nBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const nd = nBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1);
    const nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf; nSrc.loop = true;
    const nFlt = ctx.createBiquadFilter(); nFlt.type = "bandpass"; nFlt.frequency.value = 160; nFlt.Q.value = 1.2;
    this.levProxGain = ctx.createGain(); this.levProxGain.gain.value = 0;
    nSrc.connect(nFlt); nFlt.connect(this.levProxGain); this.levProxGain.connect(this.levProxMaster);
    nSrc.start();
  }

  setLeviathanProxVolume(vol: number) {
    if (!this.ctx || !this.levProxMaster) return;
    const target = Math.max(0, Math.min(1, vol));
    this.levProxMaster.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.18);
    if (this.levProxGain) this.levProxGain.gain.linearRampToValueAtTime(target * 0.55, this.ctx.currentTime + 0.18);
  }

  // ── LEVIATHAN ALERT LAYER — mid-urgency thrum when creature is investigating ──
  private levAlertGain: GainNode | null = null;

  initLeviathanAlert() {
    if (!this.ctx || !this.master || this.levAlertGain) return;
    const ctx = this.ctx;
    this.levAlertGain = ctx.createGain(); this.levAlertGain.gain.value = 0;
    this.levAlertGain.connect(this.master);
    // Low sawtooth thrum at 28 Hz to create a continuous dread rumble (distinct from prox breathing)
    const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = 28;
    const flt = ctx.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 75;
    const g = ctx.createGain(); g.gain.value = 0.022;
    osc.connect(flt); flt.connect(g); g.connect(this.levAlertGain); osc.start();
  }

  setLeviathanAlertVolume(vol: number) {
    if (!this.ctx || !this.levAlertGain) return;
    this.levAlertGain.gain.linearRampToValueAtTime(Math.max(0, Math.min(0.55, vol)), this.ctx.currentTime + 0.5);
  }

  // ── LEVIATHAN PULSE — distinct sound cue fired when Level 3 sonar disruption pulse triggers ──
  leviathanPulse() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    // Layer 1: sub-bass impact thud — noise burst shaped into a deep concussive hit
    const impactDur = 0.9;
    const impactBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * impactDur), ctx.sampleRate);
    const impactData = impactBuf.getChannelData(0);
    for (let i = 0; i < impactData.length; i++) impactData[i] = (Math.random() * 2 - 1);
    const impactSrc = ctx.createBufferSource(); impactSrc.buffer = impactBuf;
    const impactLp = ctx.createBiquadFilter(); impactLp.type = "lowpass"; impactLp.frequency.value = 55;
    const impactEnv = ctx.createGain();
    impactEnv.gain.setValueAtTime(0.0001, t0);
    impactEnv.gain.linearRampToValueAtTime(0.55, t0 + 0.02);
    impactEnv.gain.exponentialRampToValueAtTime(0.001, t0 + impactDur);
    impactSrc.connect(impactLp); impactLp.connect(impactEnv); impactEnv.connect(this.master);
    impactSrc.start(t0); impactSrc.stop(t0 + impactDur);
    impactSrc.onended = () => { try { impactSrc.disconnect(); impactLp.disconnect(); impactEnv.disconnect(); } catch { /**/ } };

    // Layer 2: descending pitch sweep — oscillator falling from 90 Hz → 28 Hz over 1.1 s
    // (whale-call-meets-sonar, clearly different from the steady sawtooth alert rumble)
    const sweepOsc = ctx.createOscillator(); sweepOsc.type = "sine";
    sweepOsc.frequency.setValueAtTime(90, t0);
    sweepOsc.frequency.exponentialRampToValueAtTime(28, t0 + 1.1);
    const sweepFlt = ctx.createBiquadFilter(); sweepFlt.type = "bandpass"; sweepFlt.frequency.value = 60; sweepFlt.Q.value = 1.8;
    const sweepEnv = ctx.createGain();
    sweepEnv.gain.setValueAtTime(0.0001, t0);
    sweepEnv.gain.linearRampToValueAtTime(0.38, t0 + 0.04);
    sweepEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 1.2);
    sweepOsc.connect(sweepFlt); sweepFlt.connect(sweepEnv); sweepEnv.connect(this.master);
    sweepOsc.start(t0); sweepOsc.stop(t0 + 1.25);
    sweepOsc.onended = () => { try { sweepOsc.disconnect(); sweepFlt.disconnect(); sweepEnv.disconnect(); } catch { /**/ } };

    // Layer 3: metallic resonant sting — short high-pitched ring to sell the sonar disruption
    const ringOsc = ctx.createOscillator(); ringOsc.type = "sine"; ringOsc.frequency.value = 340;
    const ringFlt = ctx.createBiquadFilter(); ringFlt.type = "bandpass"; ringFlt.frequency.value = 340; ringFlt.Q.value = 12;
    const ringEnv = ctx.createGain();
    ringEnv.gain.setValueAtTime(0.0001, t0 + 0.03);
    ringEnv.gain.linearRampToValueAtTime(0.12, t0 + 0.07);
    ringEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    ringOsc.connect(ringFlt); ringFlt.connect(ringEnv); ringEnv.connect(this.master);
    ringOsc.start(t0 + 0.03); ringOsc.stop(t0 + 0.6);
    ringOsc.onended = () => { try { ringOsc.disconnect(); ringFlt.disconnect(); ringEnv.disconnect(); } catch { /**/ } };
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

  // Continuous low-amplitude ~200Hz flatline tone — runs for vitals phase duration
  flatline(durationMs = 2800) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const now = ctx.currentTime;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 200;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.08, now + 0.15);  // quick ramp to low amplitude
    g.gain.setValueAtTime(0.08, now + durationMs / 1000 - 0.2);
    g.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
    osc.connect(g); g.connect(this.master);
    osc.start(now); osc.stop(now + durationMs / 1000);
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
  gasPodExplosion() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime; const dur = 0.55;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.08));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 280;
    const env = ctx.createGain(); env.gain.setValueAtTime(0.75, t0); env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(hp); hp.connect(env); env.connect(this.master); src.start(t0); src.stop(t0 + dur);
    src.onended = () => { try { src.disconnect(); hp.disconnect(); env.disconnect(); } catch { /* gone */ } };
    const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = 75;
    const oscEnv = ctx.createGain(); oscEnv.gain.setValueAtTime(0.55, t0); oscEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    osc.connect(oscEnv); oscEnv.connect(this.master); osc.start(t0); osc.stop(t0 + 0.4);
    osc.onended = () => { try { osc.disconnect(); oscEnv.disconnect(); } catch { /* gone */ } };
  }
  snapBranchCrack() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime; const dur = 0.16;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.016));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 1.4;
    const env = ctx.createGain(); env.gain.setValueAtTime(0.52, t0); env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(bp); bp.connect(env); env.connect(this.master); src.start(t0); src.stop(t0 + dur);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); env.disconnect(); } catch { /* gone */ } };
  }
  wreckSettle() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime; const dur = 2.2 + Math.random() * 1.2;
    const centers = [60, 110, 280].map(f => f * (0.85 + Math.random() * 0.3));
    for (const fc of centers) {
      const bufLen = Math.ceil(ctx.sampleRate * dur);
      const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = fc; bp.Q.value = 11 + Math.random() * 7;
      const env = ctx.createGain(); env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(0.32, t0 + dur * 0.3); env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(bp); bp.connect(env); env.connect(this.master); src.start(t0); src.stop(t0 + dur);
      src.onended = () => { try { src.disconnect(); bp.disconnect(); env.disconnect(); } catch { /* gone */ } };
    }
  }
  conduitActivate() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = "sawtooth";
    osc.frequency.setValueAtTime(55, t0); osc.frequency.linearRampToValueAtTime(190, t0 + 0.65);
    const flt = ctx.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 900;
    const env = ctx.createGain(); env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(0.28, t0 + 0.12); env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
    osc.connect(flt); flt.connect(env); env.connect(this.master); osc.start(t0); osc.stop(t0 + 0.95);
    osc.onended = () => { try { osc.disconnect(); flt.disconnect(); env.disconnect(); } catch { /* gone */ } };
    const click = ctx.createOscillator(); click.type = "square"; click.frequency.value = 440;
    const cEnv = ctx.createGain(); cEnv.gain.setValueAtTime(0.18, t0 + 0.6); cEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.75);
    click.connect(cEnv); cEnv.connect(this.master); click.start(t0 + 0.6); click.stop(t0 + 0.8);
    click.onended = () => { try { click.disconnect(); cEnv.disconnect(); } catch { /* gone */ } };
  }
  buildingCollapse() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime;
    const dur = 1.8; const bufLen = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.55));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
    const env = ctx.createGain(); env.gain.setValueAtTime(0.7, t0); env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(lp); lp.connect(env); env.connect(this.master); src.start(t0); src.stop(t0 + dur);
    src.onended = () => { try { src.disconnect(); lp.disconnect(); env.disconnect(); } catch { /* gone */ } };
    const sub = ctx.createOscillator(); sub.type = "sine"; sub.frequency.value = 48;
    const subEnv = ctx.createGain(); subEnv.gain.setValueAtTime(0.6, t0); subEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
    sub.connect(subEnv); subEnv.connect(this.master); sub.start(t0); sub.stop(t0 + 1.0);
    sub.onended = () => { try { sub.disconnect(); subEnv.disconnect(); } catch { /* gone */ } };
  }
  speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (typeof SpeechSynthesisUtterance === "undefined") return;
    const noBrackets = text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
    if (!noBrackets) return;
    let voice: "elias" | "narrator" | "child" | "doctor" = "narrator";
    let speakText = noBrackets;
    const m = noBrackets.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
    if (m) {
      const sp = m[1].toUpperCase();
      speakText = m[2].replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, "").trim();
      if (sp === "ELIAS") voice = "elias";
      else if (sp === "MIA" || sp === "NOAH" || sp === "SARA") voice = "child";
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

  eliasReactionSara() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime;
    const exhaleLen = Math.ceil(ctx.sampleRate * 2.4);
    const exBuf = ctx.createBuffer(1, exhaleLen, ctx.sampleRate);
    const ed = exBuf.getChannelData(0);
    for (let i = 0; i < ed.length; i++) ed[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.7));
    const exSrc = ctx.createBufferSource(); exSrc.buffer = exBuf;
    const exFlt = ctx.createBiquadFilter(); exFlt.type = "bandpass"; exFlt.frequency.value = 310; exFlt.Q.value = 1.1;
    const exG = ctx.createGain();
    exG.gain.setValueAtTime(0, t0); exG.gain.linearRampToValueAtTime(0.28, t0 + 0.4); exG.gain.exponentialRampToValueAtTime(0.001, t0 + 2.4);
    exSrc.connect(exFlt); exFlt.connect(exG); exG.connect(this.master); exSrc.start(t0);
    exSrc.onended = () => { try { exSrc.disconnect(); exFlt.disconnect(); exG.disconnect(); } catch { /**/ } };
    const sobOsc = ctx.createOscillator(); sobOsc.type = "sine"; sobOsc.frequency.value = 185;
    const sobLfo = ctx.createOscillator(); sobLfo.type = "sine"; sobLfo.frequency.value = 5.5;
    const sobLfoG = ctx.createGain(); sobLfoG.gain.value = 18;
    sobLfo.connect(sobLfoG); sobLfoG.connect(sobOsc.frequency);
    const sobG = ctx.createGain();
    sobG.gain.setValueAtTime(0, t0 + 1.8); sobG.gain.linearRampToValueAtTime(0.14, t0 + 2.2); sobG.gain.exponentialRampToValueAtTime(0.001, t0 + 4.0);
    sobOsc.connect(sobG); sobG.connect(this.master); sobOsc.start(t0 + 1.8); sobOsc.stop(t0 + 4.0);
    sobLfo.start(t0 + 1.8); sobLfo.stop(t0 + 4.0);
    sobOsc.onended = () => { try { sobOsc.disconnect(); sobLfo.disconnect(); sobLfoG.disconnect(); sobG.disconnect(); } catch { /**/ } };
  }

  eliasReactionNoah() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime;
    const cryOsc = ctx.createOscillator(); cryOsc.type = "sawtooth";
    cryOsc.frequency.setValueAtTime(340, t0); cryOsc.frequency.exponentialRampToValueAtTime(220, t0 + 0.22);
    const cryFlt = ctx.createBiquadFilter(); cryFlt.type = "lowpass"; cryFlt.frequency.value = 800;
    const cryG = ctx.createGain();
    cryG.gain.setValueAtTime(0.38, t0); cryG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
    cryOsc.connect(cryFlt); cryFlt.connect(cryG); cryG.connect(this.master);
    cryOsc.start(t0); cryOsc.stop(t0 + 0.28);
    cryOsc.onended = () => { try { cryOsc.disconnect(); cryFlt.disconnect(); cryG.disconnect(); } catch { /**/ } };
    [1.0, 1.55, 2.1].forEach((tOff, i) => {
      const wOsc = ctx.createOscillator(); wOsc.type = "sine";
      wOsc.frequency.value = 240 - i * 30;
      const wG = ctx.createGain();
      wG.gain.setValueAtTime(0, t0 + tOff); wG.gain.linearRampToValueAtTime(0.09 - i * 0.02, t0 + tOff + 0.12);
      wG.gain.exponentialRampToValueAtTime(0.001, t0 + tOff + 0.45);
      wOsc.connect(wG); if (this.master) wG.connect(this.master); wOsc.start(t0 + tOff); wOsc.stop(t0 + tOff + 0.5);
      wOsc.onended = () => { try { wOsc.disconnect(); wG.disconnect(); } catch { /**/ } };
    });
  }

  eliasReactionMia() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const t0 = ctx.currentTime;
    const screamOsc = ctx.createOscillator(); screamOsc.type = "sawtooth";
    screamOsc.frequency.setValueAtTime(260, t0); screamOsc.frequency.linearRampToValueAtTime(420, t0 + 0.35); screamOsc.frequency.exponentialRampToValueAtTime(180, t0 + 0.9);
    const scFlt = ctx.createBiquadFilter(); scFlt.type = "bandpass"; scFlt.frequency.value = 600; scFlt.Q.value = 1.4;
    const scG = ctx.createGain();
    scG.gain.setValueAtTime(0, t0); scG.gain.linearRampToValueAtTime(0.55, t0 + 0.08); scG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.95);
    screamOsc.connect(scFlt); scFlt.connect(scG); scG.connect(this.master); screamOsc.start(t0); screamOsc.stop(t0 + 1.0);
    screamOsc.onended = () => { try { screamOsc.disconnect(); scFlt.disconnect(); scG.disconnect(); } catch { /**/ } };
    [2.2, 3.0, 3.8, 4.6].forEach((tOff, i) => {
      const sOsc = ctx.createOscillator(); sOsc.type = "sine"; sOsc.frequency.value = 200 - i * 15;
      const sLfo = ctx.createOscillator(); sLfo.type = "sine"; sLfo.frequency.value = 6 + i;
      const sLfoG = ctx.createGain(); sLfoG.gain.value = 12;
      sLfo.connect(sLfoG); sLfoG.connect(sOsc.frequency);
      const sG = ctx.createGain();
      sG.gain.setValueAtTime(0, t0 + tOff); sG.gain.linearRampToValueAtTime(0.10, t0 + tOff + 0.08); sG.gain.exponentialRampToValueAtTime(0.001, t0 + tOff + 0.55);
      sOsc.connect(sG); if (this.master) sG.connect(this.master); sOsc.start(t0 + tOff); sOsc.stop(t0 + tOff + 0.6);
      sLfo.start(t0 + tOff); sLfo.stop(t0 + tOff + 0.6);
      sOsc.onended = () => { try { sOsc.disconnect(); sLfo.disconnect(); sLfoG.disconnect(); sG.disconnect(); } catch { /**/ } };
    });
  }

  private lullabyGain: GainNode | null = null;
  private lullabyOscs: OscillatorNode[] = [];

  startLullaby() {
    if (!this.ctx || !this.master || this.lullabyGain) return;
    this.lullabyGain = this.ctx.createGain(); this.lullabyGain.gain.value = 0;
    // Connect directly to destination — bypasses master so Mia's dock can mute
    // everything else via master while lullaby stays audible independently
    this.lullabyGain.connect(this.ctx.destination);
    const freqs = [220, 277, 330, 369, 440, 369, 330, 277];
    freqs.forEach((f, i) => {
      const osc = this.ctx!.createOscillator(); osc.type = "sine"; osc.frequency.value = f;
      const g = this.ctx!.createGain(); g.gain.value = 0.06 / (i % 2 === 0 ? 1 : 1.4);
      const lfo = this.ctx!.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.6 + i * 0.08;
      const lfoG = this.ctx!.createGain(); lfoG.gain.value = 4;
      lfo.connect(lfoG); lfoG.connect(osc.frequency);
      osc.connect(g); g.connect(this.lullabyGain!);
      osc.start(); lfo.start();
      this.lullabyOscs.push(osc, lfo);
    });
  }

  setLullabyGain(v: number) {
    if (!this.ctx || !this.lullabyGain) return;
    this.lullabyGain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime + 1.2);
  }

  setMasterGain(target: number, rampSec: number) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(Math.max(0, target), now + rampSec);
  }

  private _ventilatorActive = false;

  // Shared ventilator engine — routes to `dest` so gameplay and collapse both reuse this logic.
  private _startVentilatorEngine(dest: AudioNode) {
    if (!this.ctx || this._ventilatorActive) return;
    this._ventilatorActive = true;
    const ctx = this.ctx;
    // Continuous low mechanical hum
    const humOsc = ctx.createOscillator(); humOsc.type = "square"; humOsc.frequency.value = 55;
    const humFlt = ctx.createBiquadFilter(); humFlt.type = "lowpass"; humFlt.frequency.value = 130;
    const humG = ctx.createGain(); humG.gain.value = 0.022;
    humOsc.connect(humFlt); humFlt.connect(humG); humG.connect(dest); humOsc.start();
    // Rhythmic breath cycle: inhale → hold → exhale, every 3.4 s
    const CYCLE = 3.4;
    const active = this; // guard: stop scheduling if engine replaced
    const scheduleBreath = (t0: number) => {
      if (!active._ventilatorActive || !this.ctx) return;
      const clickLen = Math.ceil(ctx.sampleRate * 0.045);
      const cBuf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
      const cd = cBuf.getChannelData(0);
      for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.007));
      const cSrc = ctx.createBufferSource(); cSrc.buffer = cBuf;
      const cFlt = ctx.createBiquadFilter(); cFlt.type = "highpass"; cFlt.frequency.value = 600;
      const cG = ctx.createGain(); cG.gain.value = 0.14;
      cSrc.connect(cFlt); cFlt.connect(cG); cG.connect(dest); cSrc.start(t0);
      cSrc.onended = () => { try { cSrc.disconnect(); cFlt.disconnect(); cG.disconnect(); } catch { /**/ } };
      const inLen = Math.ceil(ctx.sampleRate * 1.1);
      const inBuf = ctx.createBuffer(1, inLen, ctx.sampleRate);
      const ind = inBuf.getChannelData(0);
      for (let i = 0; i < ind.length; i++) ind[i] = Math.random() * 2 - 1;
      const inSrc = ctx.createBufferSource(); inSrc.buffer = inBuf;
      const inFlt = ctx.createBiquadFilter(); inFlt.type = "bandpass"; inFlt.frequency.value = 850; inFlt.Q.value = 0.65;
      const inG = ctx.createGain();
      inG.gain.setValueAtTime(0, t0 + 0.04); inG.gain.linearRampToValueAtTime(0.085, t0 + 0.32); inG.gain.linearRampToValueAtTime(0.065, t0 + 1.15);
      inSrc.connect(inFlt); inFlt.connect(inG); inG.connect(dest);
      inSrc.start(t0 + 0.04); inSrc.stop(t0 + 1.2);
      inSrc.onended = () => { try { inSrc.disconnect(); inFlt.disconnect(); inG.disconnect(); } catch { /**/ } };
      const exLen = Math.ceil(ctx.sampleRate * 0.9);
      const exBuf = ctx.createBuffer(1, exLen, ctx.sampleRate);
      const exd = exBuf.getChannelData(0);
      for (let i = 0; i < exd.length; i++) exd[i] = Math.random() * 2 - 1;
      const exSrc = ctx.createBufferSource(); exSrc.buffer = exBuf;
      const exFlt = ctx.createBiquadFilter(); exFlt.type = "bandpass"; exFlt.frequency.value = 620; exFlt.Q.value = 0.5;
      const exG = ctx.createGain();
      exG.gain.setValueAtTime(0.075, t0 + 1.7); exG.gain.exponentialRampToValueAtTime(0.001, t0 + 2.6);
      exSrc.connect(exFlt); exFlt.connect(exG); exG.connect(dest);
      exSrc.start(t0 + 1.7); exSrc.stop(t0 + 2.65);
      exSrc.onended = () => { try { exSrc.disconnect(); exFlt.disconnect(); exG.disconnect(); } catch { /**/ } };
      const c2Buf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
      const c2d = c2Buf.getChannelData(0);
      for (let i = 0; i < c2d.length; i++) c2d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.007));
      const c2Src = ctx.createBufferSource(); c2Src.buffer = c2Buf;
      const c2Flt = ctx.createBiquadFilter(); c2Flt.type = "highpass"; c2Flt.frequency.value = 600;
      const c2G = ctx.createGain(); c2G.gain.value = 0.09;
      c2Src.connect(c2Flt); c2Flt.connect(c2G); c2G.connect(dest); c2Src.start(t0 + 2.6);
      c2Src.onended = () => { try { c2Src.disconnect(); c2Flt.disconnect(); c2G.disconnect(); } catch { /**/ } };
      const delayMs = Math.max(0, (t0 + CYCLE - ctx.currentTime) * 1000);
      setTimeout(() => { if (this.ctx && active._ventilatorActive) scheduleBreath(this.ctx.currentTime); }, delayMs);
    };
    scheduleBreath(ctx.currentTime + 0.4);
  }

  ventilatorSound() {
    if (!this.ctx || !this.master) return;
    this._startVentilatorEngine(this.master);
  }

  // On Mia dock: fade all non-lullaby audio to 0 via master; lullaby stands alone
  miaDockedAudio() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 2.2);
    // Raise lullaby to clear audible level — it was always playing, now revealed
    if (this.lullabyGain) {
      this.lullabyGain.gain.cancelScheduledValues(now);
      this.lullabyGain.gain.setValueAtTime(this.lullabyGain.gain.value, now);
      this.lullabyGain.gain.linearRampToValueAtTime(0.55, now + 1.5);
    }
  }

  // Instant environmental cut — all audio silent immediately, ventilator starts at once
  collapseAudio() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    // Instant cut on master (1 frame ramp to avoid click)
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.04);
    // Kill lullaby immediately too (bypasses master)
    if (this.lullabyGain) {
      this.lullabyGain.gain.cancelScheduledValues(now);
      this.lullabyGain.gain.setValueAtTime(this.lullabyGain.gain.value, now);
      this.lullabyGain.gain.linearRampToValueAtTime(0, now + 0.04);
    }
    // Ventilator fires immediately as sole sound (bypasses master which is now 0)
    this._startVentilatorEngine(this.ctx.destination);
  }

  // Sara memory: kitchen ambience — low hum of appliances + AM-radio buzz texture
  saraMemoryAudio() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const master = this.master; const now = ctx.currentTime;
    // Appliance hum — 60Hz fundamental + harmonics (refrigerator/kettle character)
    [60, 120, 180].forEach((freq, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.045 / (i + 1), now + 1.2);
      g.gain.linearRampToValueAtTime(0.04 / (i + 1), now + 5.5); g.gain.linearRampToValueAtTime(0, now + 7);
      o.connect(g); g.connect(master); o.start(now); o.stop(now + 7);
    });
    // AM-radio texture — bandpass noise centered ~1.2kHz (mid-range crackle)
    const rLen = ctx.sampleRate * 7;
    const rBuf = ctx.createBuffer(1, rLen, ctx.sampleRate);
    const rd = rBuf.getChannelData(0);
    for (let i = 0; i < rd.length; i++) rd[i] = Math.random() * 2 - 1;
    const rSrc = ctx.createBufferSource(); rSrc.buffer = rBuf;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1200; bp.Q.value = 1.8;
    const rG = ctx.createGain();
    rG.gain.setValueAtTime(0, now); rG.gain.linearRampToValueAtTime(0.028, now + 1.5);
    rG.gain.linearRampToValueAtTime(0.022, now + 5); rG.gain.linearRampToValueAtTime(0, now + 6.5);
    rSrc.connect(bp); bp.connect(rG); rG.connect(this.master); rSrc.start(now); rSrc.stop(now + 7);
    // Occasional soft bubbling/percolating (kettle) — short sine bursts
    for (let b = 0; b < 6; b++) {
      const bt = now + 0.8 + b * 0.9 + Math.random() * 0.4;
      const bo = ctx.createOscillator(), bg = ctx.createGain();
      bo.type = "sine"; bo.frequency.value = 800 + Math.random() * 200;
      bg.gain.setValueAtTime(0, bt); bg.gain.linearRampToValueAtTime(0.025, bt + 0.04);
      bg.gain.linearRampToValueAtTime(0, bt + 0.18);
      bo.connect(bg); bg.connect(this.master); bo.start(bt); bo.stop(bt + 0.2);
    }
  }

  // Noah memory: dock ambience — water lapping + seagull tones + hum, cuts at memoryTime-fadeOut
  // cutAtMs: ms after audio starts when hum/water should cut (aligns with visual FADE_OUT_START)
  noahMemoryAudio(cutAtMs = 5800) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const now = ctx.currentTime;
    const CUT = now + cutAtMs / 1000;
    // Water lapping — low bandpass noise with slow LFO swell
    const wLen = ctx.sampleRate * 6;
    const wBuf = ctx.createBuffer(1, wLen, ctx.sampleRate);
    const wd = wBuf.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    const wSrc = ctx.createBufferSource(); wSrc.buffer = wBuf;
    const wFlt = ctx.createBiquadFilter(); wFlt.type = "bandpass"; wFlt.frequency.value = 320; wFlt.Q.value = 0.5;
    const wLfo = ctx.createOscillator(); wLfo.type = "sine"; wLfo.frequency.value = 0.35;
    const wLfoG = ctx.createGain(); wLfoG.gain.value = 60;
    wLfo.connect(wLfoG); wLfoG.connect(wFlt.frequency);
    const wG = ctx.createGain();
    wG.gain.setValueAtTime(0, now); wG.gain.linearRampToValueAtTime(0.06, now + 1.0);
    wG.gain.setValueAtTime(0.06, CUT - 0.05); wG.gain.linearRampToValueAtTime(0, CUT);
    wSrc.connect(wFlt); wFlt.connect(wG); wG.connect(this.master);
    wSrc.start(now); wSrc.stop(CUT + 0.1); wLfo.start(now); wLfo.stop(CUT + 0.1);
    // Seagull-like calls — short FM chirps at irregular intervals
    const callTimes = [0.6, 1.8, 2.5, 3.7, 4.3];
    for (const ct of callTimes) {
      if (now + ct >= CUT) break;
      const co = ctx.createOscillator(), cg = ctx.createGain();
      const mod = ctx.createOscillator(), modG = ctx.createGain();
      co.type = "sine"; co.frequency.value = 1400 + Math.random() * 300;
      mod.type = "sine"; mod.frequency.value = 8 + Math.random() * 4;
      modG.gain.value = 120; mod.connect(modG); modG.connect(co.frequency);
      cg.gain.setValueAtTime(0, now + ct); cg.gain.linearRampToValueAtTime(0.055, now + ct + 0.08);
      cg.gain.linearRampToValueAtTime(0, now + ct + 0.38);
      co.connect(cg); cg.connect(this.master); co.start(now + ct); co.stop(now + ct + 0.4);
      mod.start(now + ct); mod.stop(now + ct + 0.4);
    }
    // Distant low humming — Noah's ambient character tone, cut at 5s
    const hOsc = ctx.createOscillator(), hG = ctx.createGain();
    hOsc.type = "triangle"; hOsc.frequency.value = 185;
    hG.gain.setValueAtTime(0, now); hG.gain.linearRampToValueAtTime(0.04, now + 1.5);
    hG.gain.setValueAtTime(0.04, CUT - 0.05); hG.gain.linearRampToValueAtTime(0, CUT);
    hOsc.connect(hG); hG.connect(this.master); hOsc.start(now); hOsc.stop(CUT + 0.1);
  }

  // Mia memory: crayon scratching during hold → abrupt stop → 1s silence → music-box phrase
  miaMemoryAudio() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const master = this.master; const now = ctx.currentTime;
    // ── Crayon scratching bed: filtered noise bursts during memory hold (~6s) ──
    const SCRATCH_START = now + 1.5;  // starts after fade-in
    const SCRATCH_END   = now + 7.5;  // abrupt stop before silence
    const scratchBuf = ctx.createBuffer(1, ctx.sampleRate * 8, ctx.sampleRate);
    const sd = scratchBuf.getChannelData(0);
    // Sawtooth-ish noise with periodic amplitude modulation (crayon strokes)
    for (let i = 0; i < sd.length; i++) {
      const stroke = Math.abs(Math.sin(i / ctx.sampleRate * 4.2 * Math.PI * 2)); // ~4Hz strokes
      sd[i] = (Math.random() * 2 - 1) * stroke;
    }
    const scrSrc = ctx.createBufferSource(); scrSrc.buffer = scratchBuf;
    const scrFlt = ctx.createBiquadFilter(); scrFlt.type = "bandpass";
    scrFlt.frequency.value = 3200; scrFlt.Q.value = 0.9; // papery high-mid texture
    const scrG = ctx.createGain();
    scrG.gain.setValueAtTime(0, SCRATCH_START);
    scrG.gain.linearRampToValueAtTime(0.045, SCRATCH_START + 0.3);
    scrG.gain.setValueAtTime(0.045, SCRATCH_END - 0.02);
    scrG.gain.linearRampToValueAtTime(0, SCRATCH_END); // abrupt stop
    scrSrc.connect(scrFlt); scrFlt.connect(scrG); scrG.connect(master);
    scrSrc.start(SCRATCH_START); scrSrc.stop(SCRATCH_END + 0.05);
    // ── Music-box phrase: 3 notes after 1s silence following scratch stop ──
    const PHRASE_START = SCRATCH_END + 1.0;
    const notes = [1047, 1175, 988]; // C6, D6, B5
    notes.forEach((freq, i) => {
      const t = PHRASE_START + i * 0.55;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.type = "sine"; o2.frequency.value = freq * 1.003;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.025, t + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.2);
      o2.connect(g2); g2.connect(master); o2.start(t); o2.stop(t + 1.0);
    });
  }

  // Letter collection echo — soft underwater sine burst with delay tail
  playLetterEcho() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx; const now = ctx.currentTime;
    // Primary tone: ~200 Hz sine, short attack, fast decay
    const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = 200 + Math.random() * 30;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.22, now + 0.04);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    // Lowpass to keep it muffled / underwater
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 620;
    osc.connect(lp); lp.connect(env); env.connect(this.master);
    osc.start(now); osc.stop(now + 0.6);
    osc.onended = () => { try { osc.disconnect(); lp.disconnect(); env.disconnect(); } catch { /* gone */ } };
    // Echo tail: two delayed copies at lower volume
    for (let i = 1; i <= 2; i++) {
      const delay = i * 0.18 + Math.random() * 0.04;
      const echoOsc = ctx.createOscillator(); echoOsc.type = "sine";
      echoOsc.frequency.value = 200 + Math.random() * 25;
      const echoEnv = ctx.createGain();
      echoEnv.gain.setValueAtTime(0, now + delay);
      echoEnv.gain.linearRampToValueAtTime(0.07 / i, now + delay + 0.03);
      echoEnv.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.45);
      const echoLp = ctx.createBiquadFilter(); echoLp.type = "lowpass"; echoLp.frequency.value = 480;
      echoOsc.connect(echoLp); echoLp.connect(echoEnv); echoEnv.connect(this.master);
      echoOsc.start(now + delay); echoOsc.stop(now + delay + 0.5);
      echoOsc.onended = () => { try { echoOsc.disconnect(); echoLp.disconnect(); echoEnv.disconnect(); } catch { /* gone */ } };
    }
  }
}

// ============================================================
// LEVEL DATA
// ============================================================
function level1(): LevelData {
  // ── THE ABYSSAL FOREST ────────────────────────────────────────────────────
  // Layout: 3800×2200 world. Tunnel y=600–1700 (1100px tall).
  // Dense kelp columns divide the forest into three zones:
  //   Zone A (open kelp field, x=350–1750)
  //   Zone B (canyon choke point, x=1800–2350, ceiling/floor jut inward)
  //   Zone C (sparser kelp exit, x=2450–3600)
  // GasPods cluster around the canyon entrance; SnapBranches spread throughout.
  // Deterministic LCG seeded at a fixed value so the forest has consistent varied geometry
  let _seed = 9437;
  const rng = () => { _seed = (_seed * 1664525 + 1013904223) & 0xFFFFFFFF; return (_seed >>> 0) / 0xFFFFFFFF; };

  // Procedural kelp column generator — creates varied width/height/spacing columns
  const kelpCeil = (xStart: number, xEnd: number, count: number, yTop: number, hMin: number, hMax: number): Rect[] =>
    Array.from({ length: count }, (_, i) => {
      const span = (xEnd - xStart) / count;
      const x = Math.round(xStart + span * i + span * 0.12 + rng() * span * 0.76);
      const w = Math.round(24 + rng() * 18);
      const h = Math.round(hMin + rng() * (hMax - hMin));
      return { x, y: yTop, w, h };
    });

  const kelpFloor = (xStart: number, xEnd: number, count: number, yBottom: number, hMin: number, hMax: number): Rect[] =>
    Array.from({ length: count }, (_, i) => {
      const span = (xEnd - xStart) / count;
      const x = Math.round(xStart + span * i + span * 0.12 + rng() * span * 0.76);
      const w = Math.round(24 + rng() * 18);
      const h = Math.round(hMin + rng() * (hMax - hMin));
      return { x, y: yBottom - h, w, h };
    });

  // Zone A ceiling columns (indices 6–15): 10 columns, x=350–1750, drooping from ceiling at y=600
  const zA_ceil  = kelpCeil(350, 1750, 10, 600,  170, 270);
  // Zone A floor columns (indices 16–24): 9 columns, x=430–1700, rising from floor (y=1700)
  const zA_floor = kelpFloor(430, 1700, 9, 1700, 190, 270);
  // Zone C ceiling columns (indices 29–33): 5 columns, x=2440–3400, sparser/shorter
  const zC_ceil  = kelpCeil(2440, 3400, 5, 600,  140, 220);
  // Zone C floor columns (indices 34–38): 5 columns, x=2540–3400
  const zC_floor = kelpFloor(2540, 3400, 5, 1700, 140, 200);

  const obs: Rect[] = [
    // ── World boundary ─────────────────────────────────────────────────────
    { x: 0,    y: 0,    w: 3800, h: 55   }, // 0 top
    { x: 0,    y: 2145, w: 3800, h: 55   }, // 1 bottom
    { x: 0,    y: 55,   w: 55,   h: 2090 }, // 2 left
    { x: 3745, y: 55,   w: 55,   h: 2090 }, // 3 right
    // ── Ceiling rock — solid above y=600 ──────────────────────────────────
    { x: 55,   y: 55,   w: 3690, h: 545  }, // 4
    // ── Floor rock — solid below y=1700 ───────────────────────────────────
    { x: 55,   y: 1700, w: 3690, h: 445  }, // 5
    // ── Zone A: procedural ceiling kelp columns (indices 6–15) ────────────
    ...zA_ceil,
    // ── Zone A: procedural floor kelp columns (indices 16–24) ─────────────
    ...zA_floor,
    // ── Zone B: canyon choke — ceiling and floor jut inward ───────────────
    { x: 1800, y: 600,  w: 550,  h: 265  }, // 25 ceiling drops → opens at y=865
    { x: 1800, y: 1490, w: 550,  h: 210  }, // 26 floor rises → closes at y=1490
    // Secondary narrowing (rock outcrops)
    { x: 1980, y: 865,  w: 120,  h: 90   }, // 27 ceiling outcrop
    { x: 1980, y: 1400, w: 120,  h: 90   }, // 28 floor outcrop
    // ── Zone C: procedural sparser kelp columns (ceiling 29–33, floor 34–38)
    ...zC_ceil,
    ...zC_floor,
    // ── Pod approach — gentle narrowing ───────────────────────────────────
    { x: 3580, y: 600,  w: 165,  h: 100  }, // 39
    { x: 3580, y: 1610, w: 165,  h: 90   }, // 40
  ];
  return {
    id: 1, name: "LEVEL I — THE ABYSSAL FOREST", worldW: 3800, worldH: 2200,
    playerStart: { x: 200, y: 1150 },
    obstacles: obs,
    gasPods: [
      { x: 1870, y: 950,  id: "gp1" },
      { x: 2000, y: 1040, id: "gp2" },
      { x: 2110, y: 970,  id: "gp3" },
      { x: 2180, y: 1380, id: "gp4" },
      { x: 2080, y: 1300, id: "gp5" },
    ],
    snapBranches: [
      { x: 540,  y: 790,  id: "sb1"  },
      { x: 710,  y: 800,  id: "sb2"  },
      { x: 930,  y: 810,  id: "sb3"  },
      { x: 1190, y: 785,  id: "sb4"  },
      { x: 1450, y: 795,  id: "sb5"  },
      { x: 640,  y: 1510, id: "sb6"  },
      { x: 870,  y: 1500, id: "sb7"  },
      { x: 2600, y: 775,  id: "sb8"  },
      { x: 2900, y: 790,  id: "sb9"  },
      { x: 3200, y: 770,  id: "sb10" },
    ],
    enemyDefs: [
      {
        // Drifter 1: Zone A → choke corridor (~x1800-2200) → back.
        // Extended into the choke so both Drifters pressure the player simultaneously.
        x: 800, y: 1010, type: "drifter",
        waypoints: [
          { x: 350,  y: 900  }, { x: 700,  y: 790  }, { x: 1000, y: 1050 },
          { x: 1300, y: 910  }, { x: 1700, y: 1000 }, { x: 2000, y: 1100 },
          { x: 2200, y: 950  }, { x: 1800, y: 1180 }, { x: 1400, y: 1200 }, { x: 800, y: 1120 },
        ],
        wpIdx: 0, speed: 28, hitR: 38, hearingDist: 700, alertDist: 500,
      },
      {
        // Drifter 2: Zone C → choke corridor (~x1800-2400) → back.
        // Extended into the choke from the right so both overlap in the narrows.
        x: 2800, y: 1160, type: "drifter",
        waypoints: [
          { x: 3300, y: 1110 }, { x: 3000, y: 1010 }, { x: 2700, y: 910  },
          { x: 2400, y: 1000 }, { x: 2100, y: 1080 }, { x: 1900, y: 950  },
          { x: 2200, y: 1260 }, { x: 2600, y: 1310 }, { x: 3100, y: 1200 },
        ],
        wpIdx: 0, speed: 30, hitR: 38, hearingDist: 720, alertDist: 520,
      },
    ],
    pods: [{ x: 3660, y: 1150, id: "sara", rescued: false, revealTimer: 0, character: "SARA", commsLine: '"...Come home, Eli."' }],
    letters: ["S","A","R","A"],
    o2Start: 100,
    dialogue: [
      { time: 1.5, text: "WASD to navigate. Click to ping sonar. Hold 1 second for LARGE PING — reveals the whole cave." },
      { time: 8,   text: 'Elias: "The kelp columns… like a cathedral in stone. I\'ve never seen anything grow this deep."' },
      { time: 22,  text: 'Elias: "Something is watching from between the columns. Move slowly. The silence here is wrong."' },
      { time: 45,  text: 'Elias: "Gas pockets ahead. One wrong move and the whole canyon will hear me."' },
      { time: 70,  text: 'Elias: "Sara\'s signal. Not far now. I just have to get through."' },
      { time: 95,  text: 'Elias: "The bioluminescence… it pulses with every sound. The whole forest is listening."' },
    ],
  };
}
function level2(): LevelData {
  // ── THE IRON GRAVEYARD ────────────────────────────────────────────────────
  // Layout: 3600×2200 world. Approach corridor y=200–1700.
  // Shipwreck structures litter the seafloor. The main gauntlet is a sealed
  // submarine corridor (x=1400–2300) that the player must traverse.
  // A Stalker patrols the corridor interior; a bulkhead (obs[25]) blocks
  // the exit. The door only opens when the stalker is drawn 450px away.
  const obs: Rect[] = [
    // ── World boundary ─────────────────────────────────────────────────────
    { x: 0,    y: 0,    w: 3600, h: 55   }, // 0
    { x: 0,    y: 2145, w: 3600, h: 55   }, // 1
    { x: 0,    y: 55,   w: 55,   h: 2090 }, // 2
    { x: 3545, y: 55,   w: 55,   h: 2090 }, // 3
    // ── Deep trench ────────────────────────────────────────────────────────
    { x: 55,   y: 1750, w: 3490, h: 395  }, // 4
    // ── Ceiling plate ──────────────────────────────────────────────────────
    { x: 55,   y: 55,   w: 3490, h: 145  }, // 5
    // ── Tanker hull section 1 ──────────────────────────────────────────────
    { x: 300,  y: 700,  w: 700,  h: 40   }, // 6 upper hull plate
    { x: 300,  y: 900,  w: 700,  h: 40   }, // 7 lower hull plate
    { x: 300,  y: 740,  w: 40,   h: 160  }, // 8 fore bulkhead
    { x: 960,  y: 740,  w: 40,   h: 160  }, // 9 aft bulkhead
    // ── Propeller blade cluster ────────────────────────────────────────────
    { x: 100,  y: 1200, w: 180,  h: 22   }, // 10
    { x: 100,  y: 1300, w: 180,  h: 22   }, // 11
    { x: 180,  y: 1200, w: 22,   h: 120  }, // 12
    // ── Torpedo tube cluster ───────────────────────────────────────────────
    { x: 1100, y: 350,  w: 200,  h: 30   }, // 13
    { x: 1200, y: 380,  w: 200,  h: 25   }, // 14
    { x: 1100, y: 410,  w: 200,  h: 25   }, // 15
    // ── Main submarine wreck — gauntlet corridor ───────────────────────────
    { x: 1400, y: 500,  w: 900,  h: 35   }, // 16 top hull plate
    { x: 1400, y: 900,  w: 900,  h: 35   }, // 17 bottom hull plate
    { x: 1400, y: 535,  w: 35,   h: 365  }, // 18 fore bulkhead (entrance open above/below)
    // Interior bulkheads creating cover positions
    { x: 1650, y: 535,  w: 30,   h: 110  }, // 19 bulkhead A top
    { x: 1650, y: 760,  w: 30,   h: 140  }, // 20 bulkhead A bot
    { x: 1900, y: 535,  w: 30,   h: 130  }, // 21 bulkhead B top
    { x: 1900, y: 780,  w: 30,   h: 120  }, // 22 bulkhead B bot
    { x: 2100, y: 535,  w: 30,   h: 120  }, // 23 bulkhead C top
    { x: 2100, y: 770,  w: 30,   h: 130  }, // 24 bulkhead C bot
    // ── AFT BULKHEAD DOOR (idx=25) — blocks pod access ─────────────────────
    { x: 2300, y: 535,  w: 35,   h: 365  }, // 25 AFT BULKHEAD
    // ── Scattered wreck debris ─────────────────────────────────────────────
    { x: 700,  y: 1200, w: 260,  h: 30   }, // 26
    { x: 800,  y: 1100, w: 30,   h: 130  }, // 27
    { x: 1050, y: 1100, w: 200,  h: 30   }, // 28
    { x: 1050, y: 1130, w: 30,   h: 120  }, // 29
    // ── Girder cluster mid ─────────────────────────────────────────────────
    { x: 2400, y: 300,  w: 300,  h: 22   }, // 30
    { x: 2600, y: 200,  w: 22,   h: 200  }, // 31
    { x: 2700, y: 350,  w: 250,  h: 22   }, // 32
    // ── Stern section of second wreck ─────────────────────────────────────
    { x: 2800, y: 700,  w: 550,  h: 35   }, // 33
    { x: 2800, y: 1000, w: 550,  h: 35   }, // 34
    { x: 2800, y: 735,  w: 35,   h: 265  }, // 35
    { x: 3315, y: 735,  w: 35,   h: 265  }, // 36
    { x: 3000, y: 735,  w: 30,   h: 100  }, // 37
    { x: 3000, y: 900,  w: 30,   h: 100  }, // 38
    // ── Scattered hull plating ─────────────────────────────────────────────
    { x: 400,  y: 1450, w: 180,  h: 22   }, // 39
    { x: 550,  y: 1350, w: 22,   h: 120  }, // 40
    { x: 1600, y: 1300, w: 200,  h: 25   }, // 41
    { x: 2100, y: 1100, w: 250,  h: 22   }, // 42
    { x: 2500, y: 1400, w: 180,  h: 22   }, // 43
  ];
  return {
    id: 2, name: "LEVEL II — THE IRON GRAVEYARD", worldW: 3600, worldH: 2200,
    playerStart: { x: 200, y: 1100 },
    obstacles: obs,
    bulkheadObstacleIdx: 25,
    wreckPositions: [
      { x: 500,  y: 820 }, { x: 800,  y: 1150 }, { x: 1200, y: 380 },
      { x: 1700, y: 720 }, { x: 1950, y: 720 },  { x: 2050, y: 500 },
      { x: 2900, y: 870 }, { x: 3100, y: 870 },  { x: 2700, y: 370 },
    ],
    enemyDefs: [
      // Entry corridor stalker — guards the approach wreckage
      {
        x: 900, y: 800, type: "stalker",
        waypoints: [{ x: 400, y: 800 }, { x: 900, y: 800 }, { x: 800, y: 600 }, { x: 400, y: 600 }],
        wpIdx: 0, speed: 55, hitR: 26, hearingDist: 760, alertDist: 560,
      },
      // Gauntlet stalker (idx=1) — patrols inside the main sub corridor
      {
        x: 1700, y: 720, type: "stalker",
        waypoints: [
          { x: 1500, y: 720 }, { x: 2000, y: 720 },
          { x: 2200, y: 720 }, { x: 2000, y: 720 }, { x: 1500, y: 720 },
        ],
        wpIdx: 0, speed: 48, hitR: 26, hearingDist: 680, alertDist: 480,
      },
      // Graveyard Leviathan — sweeps the full Iron Graveyard world
      {
        x: 1800, y: 1400, type: "leviathan",
        waypoints: [
          { x: 300,  y: 1400 }, { x: 900,  y: 600  }, { x: 1800, y: 400  },
          { x: 2700, y: 600  }, { x: 3300, y: 1400 }, { x: 2700, y: 1600 },
          { x: 1800, y: 1650 }, { x: 900,  y: 1600 }, { x: 300,  y: 1400 },
        ],
        wpIdx: 0, speed: 52, hitR: 42, hearingDist: 900, alertDist: 700,
      },
    ],
    pods: [{ x: 3400, y: 860, id: "noah", rescued: false, revealTimer: 0, character: "NOAH", commsLine: '"Dad? Is that you?"' }],
    letters: ["N","O","A","H"],
    o2Start: 100,
    dialogue: [
      { time: 3,  text: 'Elias: "Ship graveyard. These wrecks could have been anything — tankers, warships, submarines."' },
      { time: 18, text: 'Elias: "Something is alive in the main wreck. I can hear its echoes before I can see it."' },
      { time: 35, text: 'Elias: "The wreck breathes. Metal settles. Creaks and groans I can\'t predict. I need to move between them."' },
      { time: 55, text: 'Elias: "Cut the engine. Let the stalker pass. If I use the flare now, it moves away — and the door opens."' },
      { time: 80, text: 'Elias: "Noah\'s signal. On the far side. Almost there."' },
    ],
    flares: 2,
  };
}
function level3(): LevelData {
  // ── THE DROWNED METROPOLIS ────────────────────────────────────────────────
  // Layout: 3800×2600 world. Tunnel y=400–2200 (1800px tall).
  // Submerged skyscrapers line both sides of the main avenue. Two power
  // conduits hidden off-path must both be activated to open the city gates
  // (obs[19] and obs[36]) that seal the final approach.
  // Three unstable buildings will collapse when struck by a large ping or
  // direct impact, generating massive noise events.
  const obs: Rect[] = [
    // ── World boundary ─────────────────────────────────────────────────────
    { x: 0,    y: 0,    w: 3800, h: 55   }, // 0
    { x: 0,    y: 2545, w: 3800, h: 55   }, // 1
    { x: 0,    y: 55,   w: 55,   h: 2490 }, // 2
    { x: 3745, y: 55,   w: 55,   h: 2490 }, // 3
    // ── Upper rock mass (y=55–400) ─────────────────────────────────────────
    { x: 55,   y: 55,   w: 3690, h: 345  }, // 4
    // ── Lower rock mass (y=2200–2545) ──────────────────────────────────────
    { x: 55,   y: 2200, w: 3690, h: 345  }, // 5
    // ── Left district skyscrapers (x=300–800) ─────────────────────────────
    { x: 300,  y: 400,  w: 80,   h: 600  }, // 6  tower A1 (top face)
    { x: 500,  y: 400,  w: 80,   h: 500  }, // 7  tower A2
    { x: 700,  y: 400,  w: 80,   h: 550  }, // 8  tower A3
    { x: 300,  y: 1600, w: 480,  h: 50   }, // 9  plaza floor
    { x: 300,  y: 1800, w: 80,   h: 400  }, // 10 tower A4 (base)
    { x: 500,  y: 1750, w: 80,   h: 450  }, // 11 tower A5
    { x: 700,  y: 1700, w: 80,   h: 500  }, // 12 tower A6
    // Interior braces
    { x: 380,  y: 900,  w: 120,  h: 30   }, // 13
    { x: 380,  y: 1400, w: 120,  h: 30   }, // 14
    { x: 620,  y: 800,  w: 80,   h: 30   }, // 15
    { x: 620,  y: 1500, w: 80,   h: 30   }, // 16
    // ── GATE 1 supports and door ───────────────────────────────────────────
    { x: 1400, y: 400,  w: 55,   h: 300  }, // 17 gate 1 support top
    { x: 1400, y: 1900, w: 55,   h: 300  }, // 18 gate 1 support bot
    { x: 1400, y: 700,  w: 55,   h: 1200 }, // 19 ← GATE 1 DOOR (idx=19)
    // ── Mid-left cluster B (x=1000–1300) ──────────────────────────────────
    { x: 1000, y: 400,  w: 90,   h: 520  }, // 20 tower B1
    { x: 1150, y: 400,  w: 90,   h: 480  }, // 21 UNSTABLE TOWER (idx=21, cx=1195,cy=640)
    { x: 1000, y: 1680, w: 90,   h: 520  }, // 22 tower B3
    { x: 1150, y: 1720, w: 90,   h: 480  }, // 23 tower B4
    { x: 1050, y: 1100, w: 200,  h: 35   }, // 24 cross-brace
    // Street debris
    { x: 900,  y: 950,  w: 180,  h: 25   }, // 25
    { x: 900,  y: 1450, w: 180,  h: 25   }, // 26
    // ── Mid-right cluster C (x=1700–2200) ─────────────────────────────────
    { x: 1700, y: 400,  w: 85,   h: 550  }, // 27 tower C1
    { x: 1900, y: 400,  w: 85,   h: 500  }, // 28 UNSTABLE TOWER (idx=28, cx=1942,cy=650)
    { x: 2100, y: 400,  w: 85,   h: 580  }, // 29 tower C3
    { x: 1700, y: 1700, w: 85,   h: 500  }, // 30
    { x: 1900, y: 1720, w: 85,   h: 480  }, // 31
    { x: 2100, y: 1650, w: 85,   h: 550  }, // 32
    { x: 1750, y: 1100, w: 250,  h: 30   }, // 33 cross-brace
    // ── GATE 2 supports and door ───────────────────────────────────────────
    { x: 2600, y: 400,  w: 55,   h: 300  }, // 34 gate 2 support top
    { x: 2600, y: 1900, w: 55,   h: 300  }, // 35 gate 2 support bot
    { x: 2600, y: 700,  w: 55,   h: 1200 }, // 36 ← GATE 2 DOOR (idx=36)
    // ── Right district cluster D (x=2800–3500) ─────────────────────────────
    { x: 2800, y: 400,  w: 85,   h: 520  }, // 37 tower D1
    { x: 2950, y: 400,  w: 85,   h: 480  }, // 38 UNSTABLE TOWER (idx=38, cx=2992,cy=640)
    { x: 3100, y: 400,  w: 85,   h: 550  }, // 39 tower D3
    { x: 3300, y: 400,  w: 85,   h: 500  }, // 40 tower D4
    { x: 2800, y: 1700, w: 85,   h: 500  }, // 41
    { x: 2950, y: 1720, w: 85,   h: 480  }, // 42
    { x: 3100, y: 1680, w: 85,   h: 520  }, // 43
    { x: 3300, y: 1700, w: 85,   h: 500  }, // 44
    // ── Basement corridor walls ────────────────────────────────────────────
    { x: 700,  y: 2100, w: 200,  h: 30   }, // 45
    { x: 1400, y: 2050, w: 200,  h: 30   }, // 46
    { x: 2200, y: 2080, w: 200,  h: 30   }, // 47
    // ── Upper access corridor walls ────────────────────────────────────────
    { x: 600,  y: 500,  w: 200,  h: 30   }, // 48
    { x: 1200, y: 550,  w: 200,  h: 30   }, // 49
    // ── Pod chamber narrowing ──────────────────────────────────────────────
    { x: 3600, y: 400,  w: 145,  h: 200  }, // 50
    { x: 3600, y: 2000, w: 145,  h: 200  }, // 51
  ];
  return {
    id: 3, name: "LEVEL III — THE DROWNED METROPOLIS", worldW: 3800, worldH: 2600,
    playerStart: { x: 200, y: 1300 },
    obstacles: obs,
    powerConduits: [
      { x: 750, y: 1050, id: 0 },  // left district alley — opens inner-gate; reachable from spawn
      { x: 2100, y: 1650, id: 1 }, // mid district alley — opens outer-gate; reachable after gate 1
    ],
    gateObstacleIdxs: [19, 36],
    unstableObstacleData: [
      { obstacleIdx: 21, cx: 1195, cy: 640 },
      { obstacleIdx: 28, cx: 1942, cy: 650 },
      { obstacleIdx: 38, cx: 2992, cy: 640 },
    ],
    enemyDefs: [
      // Left district patrol
      {
        x: 700, y: 1000, type: "stalker",
        waypoints: [{ x: 350, y: 900 }, { x: 1300, y: 900 }, { x: 1300, y: 1500 }, { x: 350, y: 1500 }],
        wpIdx: 0, speed: 52, hitR: 26, hearingDist: 700, alertDist: 500,
      },
      // Right district patrol
      {
        x: 3100, y: 1200, type: "stalker",
        waypoints: [{ x: 2700, y: 900 }, { x: 3600, y: 900 }, { x: 3600, y: 1800 }, { x: 2700, y: 1800 }],
        wpIdx: 0, speed: 58, hitR: 26, hearingDist: 750, alertDist: 550,
      },
      // City-wide Leviathan
      {
        x: 1900, y: 1300, type: "leviathan",
        waypoints: [
          { x: 500,  y: 800  }, { x: 1900, y: 500  }, { x: 3500, y: 800  },
          { x: 3500, y: 1800 }, { x: 1900, y: 2100 }, { x: 500,  y: 1800 },
        ],
        wpIdx: 0, speed: 52, hitR: 42, hearingDist: 900, alertDist: 700,
      },
    ],
    pods: [{ x: 3640, y: 1300, id: "mia", rescued: false, revealTimer: 0, character: "MIA", commsLine: '"I Will Miss You Dad."' }],
    letters: ["M","I","A"],
    o2Start: 60, flares: 2,
    dialogue: [
      { time: 2,  text: 'Elias: "A city. Submerged whole. Streets and towers still standing — like time stopped underwater."' },
      { time: 14, text: 'Elias: "I can hear… something. A melody. It\'s coming from deeper in."' },
      { time: 28, text: 'Elias: "Mia used to hum that. When she couldn\'t sleep. God."' },
      { time: 45, text: 'Elias: "The buildings are unstable. A loud ping could bring one down — and every creature here would hear it."' },
      { time: 65, text: 'Elias: "Power conduit — off the main avenue. Activating it should open the inner gate. Another must lie deeper."' },
      { time: 90, text: 'Elias: "Pod signal. It\'s her. She\'s been waiting for me."' },
    ],
  };
}

// ============================================================
// CUTSCENE DATA  (inter-level transition panels)
// ============================================================
const CS_INTRO: CutscenePanel[] = [
  { text: "The boat never made it back.\n\nA storm came from nowhere.\nThe sea took them — all four.\n\nOnly Elias surfaced.", speaker: "NARRATOR", art: "surface" },
  { text: "Three months in a hospital bed.\nThe doctors ran out of things to say.\n\n\"Brain activity — but no response.\nHe hears everything.\nHe just can't answer.\"", speaker: "NARRATOR", art: "hospital" },
  { text: "Then: a signal.\nDeep beneath the Mariana Trench — 11,000 metres.\nThree distinct life-signs, motionless.\n\nA mission no one else would take.", speaker: "NARRATOR", art: "briefing" },
  { text: '"They might still be down there.\n\nSara. Noah. Mia.\n\nI\'m coming."', speaker: "ELIAS", art: "ocean" },
];

const CS_SARA_TO_NOAH: CutscenePanel[] = [
  { text: "The ocean is silent.\n\nA pulse. A signal.\nAn echo of someone he loved.", speaker: "NARRATOR", art: "ocean" },
  { text: "A memory — unasked for:\nAfternoon light on the water.\nHer hand on his arm.\n\n\"You always come back.\"\n\nThe image cuts to black.", speaker: "NARRATOR", art: "crack" },
  { text: '"She\'s safe.\n\nOne more."\n\nHe descends.', speaker: "ELIAS", art: "crack" },
];
const CS_NOAH_TO_MIA: CutscenePanel[] = [
  { text: "Deeper.\n\nPressure builds at the hull.\nThe sonar reads less and less.", speaker: "NARRATOR", art: "deep" },
  { text: "A child's drawing, remembered:\nA submarine, in blue crayon.\nScrawled beneath it in unsteady letters:\n\n\"DAD COME HOME\"", speaker: "NARRATOR", art: "crack" },
  { text: '"Two down.\nOne more signal.\n\nHold on, Mia."', speaker: "ELIAS", art: "deep" },
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

function buildStalactiteMesh(x3d: number, z3d: number, onFloor: boolean, height: number, r?: number): THREE.Mesh {
  const radius = r ?? (0.1 + Math.random() * 0.15);
  const geo = new THREE.ConeGeometry(radius, height, 6, 1);
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

// ── Level-specific prop builders ─────────────────────────────────────────────

/** Tall kelp tree growing upward from y=0. Call with a seeded rng for determinism. */
function buildKelpTree(rng: () => number, fromCeiling = false): THREE.Group {
  const g = new THREE.Group();
  const h = 2.8 + rng() * 2.6; // 2.8–5.4 Three.js units tall
  const baseR = 0.12 + rng() * 0.10;
  // ── Trunk ──
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x1B4A20, emissive: 0x0A2A10, emissiveIntensity: 0.55, roughness: 0.85 });
  const trunkGeo = new THREE.CylinderGeometry(baseR * 0.55, baseR, h, 7);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = h / 2;
  g.add(trunk);
  // ── Fronds at 3-5 heights ──
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x1F7830, emissive: 0x0E5020, emissiveIntensity: 0.75, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const frondCount = 3 + Math.floor(rng() * 3);
  for (let f = 0; f < frondCount; f++) {
    const fy = (0.25 + rng() * 0.65) * h;
    const fw = 0.55 + rng() * 0.85;
    const fhh = 0.22 + rng() * 0.28;
    const baseAngle = rng() * Math.PI * 2;
    for (let side = 0; side < 2; side++) {
      const a = baseAngle + side * Math.PI;
      const frondGeo = new THREE.PlaneGeometry(fw, fhh);
      const frond = new THREE.Mesh(frondGeo, frondMat);
      frond.position.set(Math.cos(a) * (baseR + fw * 0.36), fy, Math.sin(a) * (baseR + fw * 0.36));
      frond.rotation.y = a + Math.PI / 2;
      frond.rotation.z = (side === 0 ? -1 : 1) * (0.18 + rng() * 0.28);
      g.add(frond);
    }
  }
  // ── Canopy bulge ──
  const capMat = new THREE.MeshStandardMaterial({ color: 0x22882E, emissive: 0x10601E, emissiveIntensity: 0.9, transparent: true, opacity: 0.80 });
  const capGeo = new THREE.SphereGeometry(0.38 + rng() * 0.28, 6, 5);
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.scale.set(1.6 + rng() * 0.5, 0.55 + rng() * 0.25, 1.6 + rng() * 0.5);
  cap.position.y = h + 0.1;
  g.add(cap);
  // Flip for ceiling-hanging variant
  if (fromCeiling) { g.rotation.z = Math.PI; }
  return g;
}

/** One wrecked submarine / cargo-ship section.  size ≈ 1.0 for a destroyer-class hull. */
function buildShipWreck(rng: () => number, size = 1.0): THREE.Group {
  const g = new THREE.Group();
  const rust = new THREE.MeshStandardMaterial({ color: 0x5C2800, emissive: 0x8B3A10, emissiveIntensity: 0.5, roughness: 0.95, metalness: 0.65 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2A1400, emissive: 0x3A1A06, emissiveIntensity: 0.3, roughness: 1, metalness: 0.5 });
  // ── Hull section ──
  const hw = 9 * size, hh = 1.6 * size, hd = 2.4 * size;
  const hullGeo = new THREE.BoxGeometry(hw, hh, hd);
  const hull = new THREE.Mesh(hullGeo, rust);
  hull.position.set(0, hh / 2 + 0.2, 0);
  hull.rotation.z = (rng() - 0.5) * 0.45;   // tilt
  hull.rotation.y = (rng() - 0.5) * 0.25;
  g.add(hull);
  // ── Frame ribs ──
  const ribCount = 5 + Math.floor(rng() * 4);
  for (let r = 0; r < ribCount; r++) {
    const rx = -hw / 2 + hw * ((r + 0.5) / ribCount);
    const ribGeo = new THREE.BoxGeometry(0.14, hh * 1.1, hd * 1.05);
    const rib = new THREE.Mesh(ribGeo, dark);
    rib.position.set(rx, 0, 0);
    hull.add(rib);
  }
  // ── Conning tower / superstructure ──
  const towGeo = new THREE.BoxGeometry(hw * 0.22, hh * 1.6, hd * 0.55);
  const tower = new THREE.Mesh(towGeo, rust);
  tower.position.set(hw * 0.08, hh * 1.3, 0);
  hull.add(tower);
  // ── Propeller stub ──
  const propGeo = new THREE.CylinderGeometry(0.12 * size, 0.12 * size, hw * 0.14, 6);
  propGeo.rotateZ(Math.PI / 2);
  const prop = new THREE.Mesh(propGeo, dark);
  prop.position.set(-hw * 0.56, -0.05, 0);
  hull.add(prop);
  // ── Torpedo tube cluster ──
  for (let t = 0; t < 3; t++) {
    const tubeGeo = new THREE.CylinderGeometry(0.09 * size, 0.09 * size, hw * 0.18, 6);
    tubeGeo.rotateZ(Math.PI / 2);
    const tube = new THREE.Mesh(tubeGeo, dark);
    tube.position.set(hw * 0.48, (-0.25 + t * 0.25) * size, (t - 1) * 0.35 * size);
    hull.add(tube);
  }
  // ── Ambient light under the wreck ──
  const wLight = new THREE.PointLight(0xFF4400, 1.4, 22 * WS);
  wLight.position.set(0, -1, 0);
  hull.add(wLight);
  return g;
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

// SARA's boat — loaded once at startup; full GLTF scene kept with original textures intact.
// The boat is exempt from sonar overlay — it renders as solid textured wood, not wireframe.
const _boatLoadPromise: Promise<THREE.Group | null> = (async () => {
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(
      `${import.meta.env.BASE_URL}old_wooden_boat_3d_model_model_1778916083601.glb`,
    );
    return gltf.scene;
  } catch {
    return null;
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

  // Camera orientation (yaw is locked to AUTO_FORWARD_YAW — submarine always faces forward)
  private yaw = AUTO_FORWARD_YAW;
  private pitch = 0;

  // Fluid physics
  private smoothFwd = 0;
  private smoothSide = 0;
  private prevYaw = AUTO_FORWARD_YAW;
  private cameraRoll = 0;
  private cameraPitchOff = 0;
  private subVertOff = 0;  // cosmetic vertical camera offset from W/S dodge input

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
  private engineCutActive = false;  // L2 stealth: Q toggles engine cut (zero thrust, near-silent)
  private o2 = 100; private flares = 3;
  private invTimer = 0; private glitchTimer = 0;
  // Store-driven profile values (read at game start)
  private bonusFlares = 0;
  private sonarChargeRate = SONAR_CHARGE_RATES[0]; // units/s — level 0 = 12.5 (8s recovery)
  // STORE button hitbox in game coords (1280x720), updated each renderMenu()
  private storeBtnRect: { x: number; y: number; w: number; h: number } | null = null;

  // Noise
  private noise = 0; private alarmTimer = 0;

  // Sound events (populated each frame, consumed by leviathan AI, cleared at end of update)
  private soundEvents: SoundEvent[] = [];
  private levSpeedNoiseTimer = 0; // countdown until next full-speed sound event (ms)

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
  private introPlayed = false;

  // Puzzle (L2)
  private puzzleDone = false;
  private transitioning = false;
  private levPulseTimer = 8000; private levBlocked = false;

  // Discovery sequence state
  private discoveryPhase: "vitals" | "farewell" | "memory" | "done" = "done";
  private discoveryTimer = 0;
  private discoverySurvivor: "sara" | "noah" | "mia" = "sara";
  private discoveryFarewellMsg = "";
  private discoveryPodAfter: (() => void) | null = null;
  private memoryFlashAlpha = 0;
  private memoryFlashPhase: "in" | "hold" | "out" = "in";

  // Flashback photo assets — preloaded once, used during memory flash phases
  private flashbackSaraImg: HTMLImageElement | null = null;
  private flashbackNoahImg: HTMLImageElement | null = null;
  private level2ConceptImg: HTMLImageElement | null = null;

  // Discovery subtitle queue — sequential timed lines shown automatically
  private discoverySubLines: Array<{ text: string; at: number; dur: number }> = [];
  private discoveryElapsed = 0;

  // Collapse ending state
  private collapseTimer = 0;
  private collapseWhite = 0;
  private collapseBlack = 0;

  // Per-level completion tracking (captured at completeLevel())
  private levelTimes: number[] = [0, 0, 0];        // seconds each level took
  private levelO2Remaining: number[] = [0, 0, 0];  // O2 at end of each level

  // Cached completion record — loaded once when entering the MENU state
  private _completionCache: { completedAt: number; levels: Array<{ name: string; depth: string; time: number; o2: number }> } | null | undefined = undefined;

  // Analog dashboard state
  private hullIntegrity = 100;
  private hullInDanger = false;  // tracks when hull is in the red zone to fire the sting once
  private sonarOverlayMat: THREE.ShaderMaterial | null = null;
  // Shared ping uniform containers — referenced by the base mat AND every clone so
  // updateSonarShader() writes them once and all overlay meshes see the update.
  private sonarPingUniforms: {
    uPingOrigin:  { value: THREE.Vector3[] };
    uPingRadius:  { value: number[] };
    uPingOpacity: { value: number[] };
    uPingColor:   { value: THREE.Vector3[] };
  } | null = null;
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
  private nearConduit: PowerConduit | null = null;

  // ── Level 1: Abyssal Forest hazards ───────────────────────────────────────
  private gasPods: GasPod[] = [];
  private gasPodMeshes: Array<{ mesh: THREE.Mesh; light: THREE.PointLight; id: string }> = [];
  private snapBranches: SnapBranch[] = [];
  private snapBranchMeshes: Array<{ mesh: THREE.Mesh; id: string }> = [];
  private sonicBloomGroup: THREE.Group | null = null;

  // ── Level 2: Iron Graveyard mechanics ─────────────────────────────────────
  private graveyardBreathTimer = 0;
  private wreckPositions: Vec2[] = [];
  // SARA's boat zone
  private _boatGroup: THREE.Group | null = null;
  private _boatWorldX = 0;   // 2D world-space coordinates for proximity check
  private _boatWorldY = 0;
  private _boatZoneActive = false;   // true while player is within the radius
  private _boatSpeedMult = 1.0;      // current multiplier applied to PLAYER_SPEED
  private _boatSpeedRampTimer = 0;   // ms elapsed in current speed ramp
  private _boatSpeedRampDur = 0;     // total ms of current ramp
  private _boatSpeedRampFrom = 1.0;  // starting value of current ramp
  private _boatSpeedRampTo = 1.0;    // target value of current ramp
  private bulkheadObstacleIdx = -1;
  private bulkheadMesh: THREE.Mesh | null = null;
  private bulkheadOpen = false;
  private bulkheadAnimTimer = 0;  // ms remaining in open animation (0 = idle/done)
  private bulkheadStalkerClearTimer = 0;
  private bulkheadFlareLured = false;  // bulkhead only opens after flare lures the stalker

  // ── Level 3: Drowned Metropolis mechanics ─────────────────────────────────
  private powerConduits: PowerConduit[] = [];
  private conduitMeshObjs: Array<{ mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; light: THREE.PointLight; id: number }> = [];
  private conduitHintShown = false;
  private gateObstacleIdxs: number[] = [];
  // Power-flow pulses: spheres that travel from conduit → gate to visualise wall current
  private _flowPulses: Array<{
    mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
    x0: number; y0: number; x1: number; y1: number;
    progress: number; speed: number;   // progress 0→1
    delay: number;                     // ms before this pulse starts
    active: boolean;
  }> = [];
  private unstableBuildings: UnstableBuilding[] = [];
  private obstacleMeshes: THREE.Mesh[] = [];
  private obstacleOverlayMeshes: THREE.Mesh[] = [];  // sonar twins — kept in lock-step with obstacleMeshes
  private ghostEchoes: GhostEcho3D[] = [];

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
  private _emergencyLightTimer = 0; // ms — red emergency interior lighting after hull damage
  private _hullWhiteFlash = 0;   // 1 = flash this frame, cleared after renderPortholeFrame (true single-frame latch)
  private _vuPeakNoise = 0;      // peak-hold value for VU noise meter (decays at 20 units/s)
  private _commsActive = false;  // true while survivor-contact discovery sequence is active
  private o2BezelPhase = 0;      // accumulated radians for O2 critical sine pulse

  // Hull collision damage state
  private hullDamageCooldown = 0;   // ms — min gap between damage ticks (spam prevention)
  private shakeTimer = 0;           // ms remaining for camera shake
  private shakeIntensity = 0;       // peak shake magnitude (Three.js units)
  private shakeDuration = 160;      // ms — total duration of current shake event (for decay calc)
  private gameOverReason: "oxygen" | "hull" | "ending" = "oxygen";
  private _endingEnteredAt = 0;

  // Letter collectibles (Levels 1–3 = task Levels 2–4)
  private letterEntities: LetterEntity[] = [];
  private nameStripAlpha = 0;      // 0 = hidden, 1 = full opacity
  private nameStripTimer = 0;      // ms: >0 = hold, then fade out
  private readonly NAME_STRIP_HOLD = 3000;   // ms full-name holds
  private readonly NAME_STRIP_FADE = 1000;   // ms fade-out duration
  private readonly LETTER_COLLECT_R = 70;    // px world units
  private readonly LETTER_FLASH_DUR = 1000;  // ms
  private readonly LETTER_REVEAL_FAR  = 380; // world units — start fading in
  private readonly LETTER_REVEAL_NEAR = 120; // world units — fully visible

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
    this._preloadFlashbackImages();
  }

  private _preloadFlashbackImages() {
    const base = (import.meta.env.BASE_URL as string) ?? "/";
    const sara = new Image();
    sara.src = `${base}assets/flashback_sara.jpg`;
    sara.onload = () => { this.flashbackSaraImg = sara; };
    sara.onerror = () => { /* silent — procedural scene renders as fallback */ };
    const noah = new Image();
    noah.src = `${base}assets/flashback_noah.webp`;
    noah.onload = () => { this.flashbackNoahImg = noah; };
    noah.onerror = () => { /* silent — procedural scene renders as fallback */ };
    const lvl2 = new Image();
    lvl2.src = `${base}assets/level2_concept.jpg`;
    lvl2.onload = () => { this.level2ConceptImg = lvl2; };
    lvl2.onerror = () => { /* silent fallback */ };
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
    this.scene.background = new THREE.Color(0x03111e);
    // Lighter fog — deep ocean is dimly visible, not pitch black
    this.scene.fog = new THREE.FogExp2(0x03111e, 0.055);

    // Camera
    this.camera = new THREE.PerspectiveCamera(75, GAME_W / GAME_H, 0.05, 500);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    // Scene group (level geometry)
    this.sceneGroup = new THREE.Group();
    this.scene.add(this.sceneGroup);

    // Stronger ambient so the ocean floor and walls are faintly readable without sonar
    this.scene.add(new THREE.AmbientLight(0x2255aa, 0.72));
    this.scene.add(new THREE.HemisphereLight(0x4477cc, 0x061828, 0.92));
    // Deep blue rim light from below — bioluminescent ocean floor glow
    const floorGlow = new THREE.PointLight(0x0044aa, 0.55, 40);
    floorGlow.position.set(0, -3, 0);
    this.scene.add(floorGlow);

    // Sub headlight — wider beam, longer throw for forward tunnel vision
    const headlight = new THREE.SpotLight(0xCCEEFF, 7.5, 26, Math.PI / 3.8, 0.35, 1.8);
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
      if (this.state === "MENU" && e.code === "KeyS") {
        this.state = "STORE";
        window.dispatchEvent(new CustomEvent("echoes:store-open"));
        return;
      }
      if (this.state === "MENU" && (e.code === "Space" || e.code === "Enter")) this.startGame();
      else if (this.state === "CUTSCENE" && (e.code === "Space" || e.code === "Enter")) this.advanceCS();
      else if (this.state === "GAME_OVER" && e.code === "Space") {
        if (this.gameOverReason === "ending") { this.state = "MENU"; }
        else this.loadLevel(this.lvlIdx);
      }
      if (this.state === "PLAYING") {
        if (e.code === "KeyF") this.dropFlare();
        if (e.code === "KeyE") this.interact();
        if (e.code === "KeyQ") {
          this.engineCutActive = !this.engineCutActive;
          this.showSub(this.engineCutActive ? "[ ENGINE CUT — COASTING SILENT ]" : "[ ENGINE ONLINE ]");
        }
      }
      if (this.state === "DISCOVERY" && e.code === "KeyE") {
        // Skip current phase immediately
        this.discoveryTimer = 0;
        this.discoverySubLines = [];
        this.subtitle = ""; this.subTimer = 0;
      }
    });
    window.addEventListener("keyup", (e) => { this.keys[e.code] = false; });

    // Mouse look — drag mouse to steer the submarine (yaw only; pitch is physics-driven)
    this.threeCanvas.addEventListener("mousemove", (e) => {
      if (this.state !== "PLAYING" || !this.mouseHeld) return;
      const sens = 0.0018;
      this.yaw -= e.movementX * sens;
    });

    this.threeCanvas.addEventListener("mousedown", (e) => {
      this.ensureAudio();
      this.mouseHeld = true;
      this.mouseDownAt = Date.now();
      if (this.state === "MENU") {
        // Translate viewport coords → game coords (1280x720). Canvas is uniformly scaled & centered.
        const rect = this.threeCanvas.getBoundingClientRect();
        const gx = (e.clientX - rect.left) / rect.width * GAME_W;
        const gy = (e.clientY - rect.top)  / rect.height * GAME_H;
        const r = this.storeBtnRect;
        if (r && gx >= r.x && gx <= r.x + r.w && gy >= r.y && gy <= r.y + r.h) {
          this.state = "STORE";
          window.dispatchEvent(new CustomEvent("echoes:store-open"));
          return;
        }
        this.startGame();
      } else if (this.state === "CUTSCENE") this.advanceCS();
    });

    // When store overlay closes, return to MENU state
    window.addEventListener("echoes:store-close", () => {
      if (this.state === "STORE") this.state = "MENU";
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
    // Lullaby is a constant background thread throughout the whole game — barely audible.
    // It was always playing. Level 4 proximity reveals it for what it is.
    this.audio.startLullaby();
    this.audio.setLullabyGain(0.025);
    this.audioReady = true;
  }

  // ============================================================
  // LEVEL MANAGEMENT
  // ============================================================
  private startGame() {
    this.levelTimes = [0, 0, 0];
    this.levelO2Remaining = [0, 0, 0];
    if (!this.introPlayed) {
      this.introPlayed = true;
      this.startCS(CS_INTRO, () => this.loadLevel(0));
    } else {
      this.loadLevel(0);
    }
  }

  private loadLevel(idx: number) {
    this.lvlIdx = idx;
    const def = [level1(), level2(), level3()][idx];
    this.lvlDef = def;

    // Reset 2D state
    this.px = def.playerStart.x; this.py = def.playerStart.y;
    this.pvx = this.pvy = 0;
    // Apply player profile: bonus flares stack on top of level defaults; sonar level sets charge rate.
    const profile = getPlayerProfile();
    this.bonusFlares = profile?.bonusFlares ?? 0;
    const lvl = Math.max(0, Math.min(4, profile?.sonarLevel ?? 0));
    this.sonarChargeRate = SONAR_CHARGE_RATES[lvl];
    this.o2 = def.o2Start; this.flares = (def.flares ?? 3) + this.bonusFlares;
    this.invTimer = 0; this.glitchTimer = 0;
    this.noise = 0; this.alarmTimer = 0; this.lvlTime = 0;
    this.soundEvents = []; this.levSpeedNoiseTimer = 0;
    this.pings = []; this.flareObjs = [];
    this.puzzleDone = false; this.transitioning = false;
    this.discoveryPhase = "done"; this.discoveryTimer = 0; this.discoveryPodAfter = null;
    this.collapseTimer = 0; this.collapseWhite = 0;
    this.hullIntegrity = 100; this.hullInDanger = false; this.sonarCharge = 100;
    this.hullDamageCooldown = 0; this.shakeTimer = 0; this.shakeIntensity = 0; this.shakeDuration = 160;
    this.gameOverReason = "oxygen";
    this.sonarSwitchAnim = 0; this.flareSwitchAnim = 0;
    this.valveSonarAngle = 0; this.valveFlareAngle = 0;
    const depthBase = [20, 55, 82][idx] ?? 20;
    this.gaugeDisplay = { o2: def.o2Start, depth: depthBase, sonarCharge: 100, hull: 100, flares: 3 };
    this.levPulseTimer = 8000; this.levBlocked = false;
    this.nearPod = null; this.nearNoise = null; this.nearConduit = null;
    this.subtitle = ""; this.subTimer = 0;
    // Level 1 — Abyssal Forest
    this.gasPods = (def.gasPods ?? []).map(g => ({ ...g, triggered: false }));
    this.gasPodMeshes = [];
    this.snapBranches = (def.snapBranches ?? []).map(s => ({ ...s, triggered: false }));
    this.snapBranchMeshes = [];
    this.sonicBloomGroup = null;
    // Level 2 — Iron Graveyard
    this.graveyardBreathTimer = 25000 + Math.random() * 35000;
    this.wreckPositions = [...(def.wreckPositions ?? [])];
    this.bulkheadObstacleIdx = def.bulkheadObstacleIdx ?? -1;
    this.bulkheadMesh = null; this.bulkheadOpen = false; this.bulkheadStalkerClearTimer = 0; this.bulkheadFlareLured = false;
    // SARA's boat zone — reset per level load
    // Defensive restore: if player leaves Level 2 while inside the zone, the
    // master gain is silenced; restore it immediately before the next level starts.
    if (this._boatZoneActive && this.audioReady) this.audio.setMasterGain(0.6, 0.5);
    this._boatGroup = null;
    this._boatWorldX = 0; this._boatWorldY = 0;
    this._boatZoneActive = false; this._boatSpeedMult = 1.0;
    this._boatSpeedRampTimer = 0; this._boatSpeedRampDur = 0;
    this._boatSpeedRampFrom = 1.0; this._boatSpeedRampTo = 1.0;
    // Level 3 — Drowned Metropolis
    this.powerConduits = (def.powerConduits ?? []).map(c => ({ ...c, activated: false }));
    this.conduitMeshObjs = [];
    this.conduitHintShown = false;
    this.gateObstacleIdxs = [...(def.gateObstacleIdxs ?? [])];
    this.unstableBuildings = (def.unstableObstacleData ?? []).map(u => ({ ...u, collapsed: false }));
    this.obstacleMeshes = [];
    this.obstacleOverlayMeshes = [];
    // Dispose any ghost echo meshes that haven't yet self-expired
    for (const ge of this.ghostEchoes) {
      this.sceneGroup.remove(ge.sphere);
      ge.sphere.geometry.dispose(); ge.mat.dispose();
    }
    this.ghostEchoes = [];
    this._bloomEventBuf = [];
    this._flowPulses = [];
    this.engineCutActive = false;  // always start each level with engines running

    this.activeFadeSet = new Set();
    this.boostPingCooldown = 0;
    this.enemies = def.enemyDefs.map(e => ({ ...e, state: "patrol" as const, visTimer: 0, listenTimer: 0, damagedAt: 0 }));
    this.pods = def.pods.map(p => ({ ...p }));
    this.noiseObjs = (def.noiseObjs || []).map(o => ({ ...o }));
    this.dlgQueue = [...def.dialogue];

    // Spawn gold letter collectibles for this level
    this.spawnLetters(def);
    this.nameStripAlpha = 0;
    this.nameStripTimer = 0;

    this.camX = def.playerStart.x; this.camY = def.playerStart.y;
    this.yaw = AUTO_FORWARD_YAW;
    this.pitch = 0;
    this.smoothFwd = 0; this.smoothSide = 0;
    this.prevYaw = AUTO_FORWARD_YAW;
    this.cameraRoll = 0; this.cameraPitchOff = 0; this.subVertOff = 0;

    // Reset breathing O2 tier so it recalculates on first updateO2 tick
    this.audio.resetBreathingTier();
    // Set ambient creak density/gain for this level
    if (this.audioReady) this.audio.setAmbientCreakLevel(idx);
    // Initialise leviathan proximity breath node and alert thrum layer
    if (this.audioReady) { this.audio.initLeviathanProx(); this.audio.initLeviathanAlert(); }

    // Reset hull stress state for new level
    this.hullStressTier = -1;
    this.hullStressTimer = 0;
    this.sharpTurnCooldown = 0;
    this.lastYawStress = AUTO_FORWARD_YAW;
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

  private spawnLetters(def: LevelData) {
    // Letter sequence comes from the level definition (Letters I, III, IV only)
    const seq = def.letters;
    if (!seq || seq.length === 0 || def.pods.length === 0) { this.letterEntities = []; return; }

    const start = def.playerStart;
    const pod   = def.pods[0];
    const n     = seq.length;

    // Unit vector along the start→pod direction
    const dx = pod.x - start.x;
    const dy = pod.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Perpendicular unit vector (rotate 90°)
    const perpX = -dy / len;
    const perpY =  dx / len;

    // Distribute evenly from 20% to 85% along the start→pod line
    // (avoids crowding on top of player spawn or inside the pod chamber)
    // Maximum lateral offset in world-grid units — keeps letters inside navigable corridors
    const MAX_PERP = 3.0;

    this.letterEntities = seq.map((char, i) => {
      const t = 0.20 + (i / (n - 1 || 1)) * 0.65;
      // Zigzag: alternate left/right; sine phase (1.9 rad ≈ irrational fraction of 2π)
      // gives non-repeating magnitude variation for any practical sequence length.
      const side = i % 2 === 0 ? +1 : -1;
      const magnitude = Math.min(1.5 + Math.sin(i * 1.9) * 0.7, MAX_PERP);
      const offsetX = perpX * side * magnitude;
      const offsetY = perpY * side * magnitude;
      return {
        char,
        x: start.x + dx * t + offsetX,
        y: start.y + dy * t + offsetY,
        collected: false,
        flashTimer: 0,
        revealAlpha: 0,
      };
    });
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
    // Ping uniforms are stored as shared containers so every cloned material
    // automatically sees per-frame updates from updateSonarShader().
    this.sonarPingUniforms = {
      uPingOrigin:  { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
      uPingRadius:  { value: [0, 0, 0, 0, 0] },
      uPingOpacity: { value: [0, 0, 0, 0, 0] },
      uPingColor:   { value: Array.from({ length: 5 }, () => new THREE.Vector3(0.04, 0.92, 1.0)) },
    };
    this.sonarOverlayMat = new THREE.ShaderMaterial({
      vertexShader:   SONAR_VERT,
      fragmentShader: SONAR_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
      side:           THREE.DoubleSide,
      uniforms: {
        ...this.sonarPingUniforms,
        // Per-mesh material identity colour (baked at construction time, not per-frame)
        uObjectColor: { value: new THREE.Vector3(0.04, 0.92, 1.0) },
      },
    });
    const omat = this.sonarOverlayMat;

    // Helper: clone the base sonar material with a per-category uObjectColor and
    // relink all ping uniforms to the shared containers so updateSonarShader()
    // writes them once and every clone sees the result automatically.
    const makeSonarMat = (category: string): THREE.ShaderMaterial => {
      const mat = omat!.clone();
      const pu = this.sonarPingUniforms!;
      mat.uniforms.uPingOrigin  = pu.uPingOrigin;
      mat.uniforms.uPingRadius  = pu.uPingRadius;
      mat.uniforms.uPingOpacity = pu.uPingOpacity;
      mat.uniforms.uPingColor   = pu.uPingColor;
      const rgb = SONAR_OBJECT_PALETTE[category] ?? SONAR_OBJECT_PALETTE["default"];
      mat.uniforms.uObjectColor = { value: new THREE.Vector3(rgb[0], rgb[1], rgb[2]) };
      return mat;
    };

    // Helper: add an overlay twin for any Mesh with a per-category material clone
    const addOverlay = (m: THREE.Mesh, category = "default") => {
      const ov = new THREE.Mesh(m.geometry, makeSonarMat(category));
      ov.position.copy(m.position);
      ov.rotation.copy(m.rotation);
      ov.scale.copy(m.scale);
      this.sceneGroup.add(ov);
    };

    // Muted deep-sea rock palette for solid lit walls
    const wallPalette = [0x2a3a4a, 0x223040, 0x304050, 0x1f2a35, 0x283848, 0x35455a];

    // Obstacle boxes — solid lit walls + sonar overlay twin (tracked in parallel for dynamic removal)
    this.obstacleMeshes = [];
    this.obstacleOverlayMeshes = [];
    let pi = 0;
    for (const rect of def.obstacles) {
      const c = wallPalette[pi++ % wallPalette.length];
      const obsMesh = buildObstacleMesh(rect, c);
      this.sceneGroup.add(obsMesh);
      this.obstacleMeshes.push(obsMesh);
      // Build overlay twin manually (not via addOverlay) so we retain a reference per obstacle index
      const ov = new THREE.Mesh(obsMesh.geometry, makeSonarMat("wall"));
      ov.position.copy(obsMesh.position); ov.rotation.copy(obsMesh.rotation); ov.scale.copy(obsMesh.scale);
      this.sceneGroup.add(ov);
      this.obstacleOverlayMeshes.push(ov);
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
        addOverlay(floorM, "floor");
        if ((col + row) % 2 === 0) {
          const ceilM = buildCeilMesh(cx, cy, cellW * 2, cellH * 2);
          this.sceneGroup.add(ceilM);
          addOverlay(ceilM, "floor");
        }
      }
    }

    // Stalactites / stalagmites — solid lit cones + sonar overlay twin
    // Seeded so positions and collision rects are deterministic across reloads.
    const stalaCount = Math.floor(def.worldW * def.worldH / 18000);
    const stalaRng = seededRng(7777 + def.id * 31);
    for (let i = 0; i < stalaCount; i++) {
      const x2d = 50 + stalaRng() * (def.worldW - 100);
      const z2d = 50 + stalaRng() * (def.worldH - 100);
      const h       = 0.8 + stalaRng() * 3;
      const r       = 0.1 + stalaRng() * 0.15;  // cone base radius in THREE units
      const onFloor = stalaRng() > 0.5;
      const stalaM  = buildStalactiteMesh(x2d * WS, z2d * WS, onFloor, h, r);
      this.sceneGroup.add(stalaM);
      addOverlay(stalaM, "stalactite");
      // Collision rect — radius in 2D px, generous enough to feel solid
      const cr = Math.max(10, (r / WS) + 8);
      def.obstacles.push({ x: x2d - cr, y: z2d - cr, w: cr * 2, h: cr * 2 });
    }

    // Bioluminescent point lights scattered throughout (always visible — deep ocean)
    this.sceneGroup.add(buildBioLights(def.worldW, def.worldH));

    // RESEARCH VESSEL ODYSSEY — featured wreck in level 1 (matches reference image)
    if (def.id === 1) {
      const ship = buildOdysseyShip();
      ship.position.set(1400 * WS, 0.05, 820 * WS);
      ship.rotation.y = 0.22;
      this.sceneGroup.add(ship);
      // Register ship geometry with the sonar overlay so it lights up on a ping
      ship.traverse(child => {
        if (child instanceof THREE.Mesh) addOverlay(child, "shipwreck");
      });
      const bulkLabel = makeBillboard("DATA BULKHEAD", "#FFAA22", 4, 0.9);
      bulkLabel.material.opacity = 0.85;
      bulkLabel.position.set(1400 * WS + 0.6, 1.4, 820 * WS + 1.2);
      this.sceneGroup.add(bulkLabel);
      const bulkCube = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.45, 0.2),
        new THREE.MeshBasicMaterial({ color: 0xFFAA22, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }),
      );
      bulkCube.position.set(1400 * WS + 0.6, 0.9, 820 * WS + 1.0);
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

    // Lifepods — per-survivor orientation
    for (const pod of this.pods) {
      const pobj = buildPodMesh();
      pobj.group.position.set(pod.x * WS, EYE_H * 0.6, pod.y * WS);
      if (pod.id === "sara") {
        pobj.group.rotation.z = 0.26; pobj.group.rotation.x = 0.08; // tilted, pinned
      } else if (pod.id === "noah") {
        pobj.group.rotation.y = 0.35; // wedged upright
      } else if (pod.id === "mia") {
        pobj.group.position.y = EYE_H * 0.15; pobj.group.rotation.x = -0.12; // on floor
      }
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

    // Particles removed — forest/wreck geometry replaces ambient clutter

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
    //
    // Level 1 is a cave tunnel (y=700–1300).  Scatter collision rects that cross
    // the main corridor are dropped so they never block the player's path.
    // Scatter *meshes* are kept — they decorate the cave walls visually.
    const TUNNEL_Y1 = 720, TUNNEL_Y2 = 1280; // passable corridor band
    for (const [sr, cat] of [
      [rocksR,     "rock"]     as const,
      [wallsR,     "wall"]     as const,
      [debrisR,    "debris"]   as const,
      [platformsR, "platform"] as const,
    ]) {
      for (const mesh of sr.meshes) {
        if (mesh instanceof THREE.LineSegments) continue; // shader handles terrain
        this.sceneGroup.add(mesh);
        addOverlay(mesh as THREE.Mesh, cat);
      }
      for (const rect of sr.rects) {
        // Drop scatter obstacle rects that would block the main tunnel on Level 1
        if (def.id === 1 && rect.y < TUNNEL_Y2 && rect.y + rect.h > TUNNEL_Y1) continue;
        def.obstacles.push(rect);
      }
    }

    // Lullaby is already running from ensureAudio — level 4 proximity will raise the gain

    // ── Level 1: Abyssal Forest — gas pod orbs + snap branch stubs + sonic bloom ──
    if (def.id === 1) {
      for (const gp of this.gasPods) {
        const geo = new THREE.SphereGeometry(0.32, 8, 8);
        const mat = new THREE.MeshStandardMaterial({ color: 0x88FF44, emissive: 0x336600, emissiveIntensity: 0.8, transparent: true, opacity: 0.88 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(gp.x * WS, EYE_H * 0.65, gp.y * WS);
        const light = new THREE.PointLight(0x88FF44, 1.4, 12 * WS);
        light.position.set(0, 0, 0);
        mesh.add(light);
        this.sceneGroup.add(mesh);
        addOverlay(mesh, "default");
        this.gasPodMeshes.push({ mesh, light, id: gp.id });
      }
      for (const sb of this.snapBranches) {
        const geo = new THREE.CylinderGeometry(0.03, 0.06, 1.4, 4);
        const mat = new THREE.MeshStandardMaterial({ color: 0x2A5C2A, emissive: 0x1A3A1A, emissiveIntensity: 0.3 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(sb.x * WS, EYE_H * 0.4, sb.y * WS);
        mesh.rotation.z = (Math.random() - 0.5) * 0.4;
        this.sceneGroup.add(mesh);
        addOverlay(mesh, "default");
        this.snapBranchMeshes.push({ mesh, id: sb.id });
      }
      const bloomGroup = new THREE.Group();
      for (let bi = 0; bi < 14; bi++) {
        const bGeo = new THREE.SphereGeometry(0.08 + Math.random() * 0.14, 5, 5);
        const bMat = new THREE.MeshBasicMaterial({ color: 0x44FFAA, transparent: true, opacity: 0.18 + Math.random() * 0.22, blending: THREE.AdditiveBlending });
        const bMesh = new THREE.Mesh(bGeo, bMat);
        const angle = (bi / 14) * Math.PI * 2;
        bMesh.position.set(Math.cos(angle) * (0.4 + Math.random() * 0.6), Math.random() * 1.2 - 0.6, Math.sin(angle) * (0.4 + Math.random() * 0.6));
        bloomGroup.add(bMesh);
      }
      bloomGroup.position.set(def.playerStart.x * WS, EYE_H, def.playerStart.y * WS);
      this.sceneGroup.add(bloomGroup);
      this.sonicBloomGroup = bloomGroup;

      // ── Kelp Forest — 30 floor trees + 20 ceiling trees throughout the tunnel ──
      // Seeded so the forest looks identical on every load.
      let _fSeed = 7331;
      const frng = () => { _fSeed = (_fSeed * 1664525 + 1013904223) & 0xFFFFFFFF; return (_fSeed >>> 0) / 0xFFFFFFFF; };
      // Floor trees: world y ≈ 1550-1700 (near floor), spread along full x range
      const floorTreeXs = [380,520,680,800,940,1080,1200,1380,1520,1650,1780,1920,2060,2200,2350,2500,2620,2780,2900,3050,3180,3320,3480,3580,3650];
      for (const tx of floorTreeXs) {
        const tz = 1560 + frng() * 120;   // near the south (floor) wall
        const tree = buildKelpTree(frng, false);
        tree.position.set(tx * WS + (frng() - 0.5) * 1.5, 0, tz * WS);
        tree.rotation.y = frng() * Math.PI * 2;
        this.sceneGroup.add(tree);
      }
      // Ceiling trees: world y ≈ 600-750 (near ceiling), hanging down
      const ceilTreeXs = [420,620,820,1050,1260,1460,1700,1880,2100,2320,2540,2720,2940,3150,3380,3560,3650,3700,460,720];
      for (const tx of ceilTreeXs) {
        const tz = 615 + frng() * 120;   // near the north (ceiling) wall
        const tree = buildKelpTree(frng, true);
        tree.position.set(tx * WS + (frng() - 0.5) * 1.5, WALL_H, tz * WS);
        tree.rotation.y = frng() * Math.PI * 2;
        this.sceneGroup.add(tree);
      }
    }

    // ── Level 2: Iron Graveyard — bulkhead door highlight + conduit hint ─────
    if (def.id === 2 && this.bulkheadObstacleIdx >= 0 && this.bulkheadObstacleIdx < this.obstacleMeshes.length) {
      const bMesh = this.obstacleMeshes[this.bulkheadObstacleIdx];
      // Swap material to amber-red for visual distinction
      const bMat = new THREE.MeshStandardMaterial({ color: 0xAA3300, emissive: 0xCC4400, emissiveIntensity: 0.65 });
      bMesh.material = bMat;
      this.bulkheadMesh = bMesh;
      const bLight = new THREE.PointLight(0xFF6600, 1.8, 14 * WS);
      bLight.position.copy(bMesh.position);
      this.sceneGroup.add(bLight);
      const bLabel = makeBillboard("AFT BULKHEAD — SEALED", "#FF6600", 3.8, 0.85);
      bLabel.position.set(bMesh.position.x, bMesh.position.y + 2.4, bMesh.position.z);
      this.sceneGroup.add(bLabel);
    }

    // ── Level 2: SARA's boat — textured GLB, exempt from sonar overlay ───────
    // Loaded via _boatLoadPromise which runs in parallel with _rockLoadPromise.
    // We await it here so we can clone the scene synchronously below.
    if (def.id === 2) {
      const boatScene = await _boatLoadPromise;
      if (buildToken !== this._sceneBuildToken) return; // guard against stale build
      if (boatScene) {
        const boatGroup = boatScene.clone(true);
        // Position: slightly off-centre ahead of Level 2 start, resting on the ocean floor
        const BOAT_X = 480, BOAT_Y = 1350;
        this._boatWorldX = BOAT_X;
        this._boatWorldY = BOAT_Y;
        boatGroup.position.set(BOAT_X * WS, 0, BOAT_Y * WS);
        boatGroup.rotation.y = Math.PI * 0.15;   // slight angle to the player's path
        boatGroup.rotation.z = 0.24;              // ~14° list to one side
        // Scale: GLB units to Three.js world units — boats are ~4-5m long
        boatGroup.scale.set(1.1, 1.1, 1.1);
        // Ensure original textures are kept — no sonar overlay applied
        boatGroup.traverse((child) => {
          const m = child as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow    = false;
            m.receiveShadow = false;
          }
        });
        this.sceneGroup.add(boatGroup);
        this._boatGroup = boatGroup;

        // ── "SARA" name plate — faded white canvas text on a small plane ─────
        const nc = document.createElement("canvas");
        nc.width = 256; nc.height = 64;
        const nctx = nc.getContext("2d")!;
        nctx.clearRect(0, 0, nc.width, nc.height);
        nctx.font = "bold 38px serif";
        nctx.textAlign = "left";
        nctx.textBaseline = "middle";
        nctx.fillStyle = "rgba(220,210,195,0.38)";  // faded, barely legible
        nctx.fillText("SARA", 14, 32);
        const nTex = new THREE.CanvasTexture(nc);
        const nGeo = new THREE.PlaneGeometry(1.4, 0.35);
        const nMat = new THREE.MeshBasicMaterial({
          map: nTex, transparent: true, depthWrite: false,
          blending: THREE.NormalBlending, side: THREE.DoubleSide,
        });
        const namePlane = new THREE.Mesh(nGeo, nMat);
        // Attach flat against the port hull side — angled outward
        namePlane.position.set(-0.05, 0.45, 0.9);
        namePlane.rotation.x = -0.15;
        namePlane.rotation.y = Math.PI * 0.5;
        boatGroup.add(namePlane);
      } else {
        // GLB failed to load — leave _boatWorldX/Y at 0 so the proximity zone
        // guard triggers correctly (no invisible slow/silence without the visual)
        this._boatGroup = null;
      }
    }

    // ── Level 2: Iron Graveyard — broken ship wrecks ─────────────────────────
    if (def.id === 2) {
      let _wSeed = 8821;
      const wrng = () => { _wSeed = (_wSeed * 1664525 + 1013904223) & 0xFFFFFFFF; return (_wSeed >>> 0) / 0xFFFFFFFF; };
      // Three distinct wrecks distributed along the level
      const wreckDefs = [
        { wx: 620,  wy: 1090, sz: 1.0 },   // bow section near Zone A entrance
        { wx: 1820, wy:  930, sz: 0.85 },  // mid-level wreck, partially tilted up
        { wx: 2950, wy: 1310, sz: 1.1 },   // stern wreck near exit
      ];
      for (const wd of wreckDefs) {
        const wreck = buildShipWreck(wrng, wd.sz);
        wreck.position.set(wd.wx * WS, 0, wd.wy * WS);
        wreck.rotation.y = wrng() * Math.PI * 2;
        this.sceneGroup.add(wreck);
        // Label so the player immediately knows what they're looking at
        const wLabel = makeBillboard("WRECK", "#FF6600", 4.2, 0.75);
        wLabel.position.set(wd.wx * WS, 4.5, wd.wy * WS);
        this.sceneGroup.add(wLabel);
      }
    }

    // ── Level 3: Drowned Metropolis — power conduit objects + gate door markers ─
    if (def.id === 3) {
      this.conduitMeshObjs = [];
      for (const cond of this.powerConduits) {
        const cGeo = new THREE.BoxGeometry(0.55, 0.9, 0.25);
        const cMat = new THREE.MeshStandardMaterial({ color: 0x224488, emissive: 0x002255, emissiveIntensity: 0.5 });
        const cMesh = new THREE.Mesh(cGeo, cMat);
        cMesh.position.set(cond.x * WS, EYE_H * 0.6, cond.y * WS);
        const cLight = new THREE.PointLight(0x2244FF, 0.8, 10 * WS);
        cLight.position.set(0, 0, 0);
        cMesh.add(cLight);
        const cLabel = makeBillboard("POWER CONDUIT — PRESS E", "#2266FF", 3.4, 0.8);
        cLabel.position.set(0, 1.6, 0);
        cMesh.add(cLabel);
        this.sceneGroup.add(cMesh);
        addOverlay(cMesh, "wall");
        this.conduitMeshObjs.push({ mesh: cMesh, mat: cMat, light: cLight, id: cond.id });
      }
      for (const gIdx of this.gateObstacleIdxs) {
        if (gIdx < this.obstacleMeshes.length) {
          const gMesh = this.obstacleMeshes[gIdx];
          const gMat = new THREE.MeshStandardMaterial({ color: 0x884400, emissive: 0xAA5500, emissiveIntensity: 0.55 });
          gMesh.material = gMat;
          const gLabel = makeBillboard("CITY GATE — LOCKED", "#FF8800", 4.0, 0.85);
          gLabel.position.set(gMesh.position.x, gMesh.position.y + 3.2, gMesh.position.z);
          this.sceneGroup.add(gLabel);
        }
      }
    }

    // Transition to PLAYING after the async scatter is done
    this.state = "PLAYING";
  }

  // ============================================================
  // GAME MECHANICS (2D logic unchanged)
  // ============================================================
  private emitSonar(type: "small" | "large") {
    if (this.levBlocked) { this.showSub("[ LEVIATHAN PULSE — SONAR DISRUPTED ]"); return; }
    if (this.sonarCharge < 100) {
      this.showSub(`[ SONAR RECHARGING — ${Math.round(this.sonarCharge)}% ]`);
      return;
    }
    const maxR = type === "small" ? SONAR_SMALL_R : SONAR_LARGE_R;
    const speed = type === "small" ? 240 : 520; // large ping sweeps whole map in ~7 s
    this.noise = Math.min(100, this.noise + (type === "small" ? SONAR_SMALL_NOISE : SONAR_LARGE_NOISE));
    // Emit discrete sound event for leviathan hearing system
    this.soundEvents.push({ type: type === "small" ? "small_ping" : "large_ping", x: this.px, y: this.py, radius: type === "small" ? LEV_HEAR_SMALL_PING : LEV_HEAR_LARGE_PING });
    this.audio.sonar(type);
    this.sonarCharge = 0; // drain fully — must wait for complete recharge before next ping
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
    const flareX = this.px, flareY = this.py;
    this.flareObjs.push({ x: flareX, y: flareY, vy: 18, timer: FLARE_DURATION, pingTimer: 0 });
    this.noise = Math.min(100, this.noise + 5);
    // Flare sound event — redirects any hunting Leviathan toward the flare landing position
    this.soundEvents.push({ type: "flare", x: flareX, y: flareY, radius: LEV_HEAR_FLARE });
    // Level 2: flare lure gate — only valid if the flare lands inside the gauntlet zone
    // (within 1000px of the bulkhead door at x≈2300) so far-away flares don't trivially open it.
    if (this.lvlIdx === 1 && !this.bulkheadOpen) {
      const BULKHEAD_X = 2317;  // centre of obs[25] x=2300+w/2
      const inGauntlet = Math.abs(flareX - BULKHEAD_X) < 1000;
      if (inGauntlet) {
        this.bulkheadFlareLured = true;
        // Immediately redirect the gauntlet stalker toward the flare
        const gs = this.enemies[1];
        if (gs && gs.state !== "hunt") {
          gs.lastSoundOrigin = { x: flareX, y: flareY };
          gs.state = "alert";
        }
      }
    }
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
    // Level 3: power conduit activation
    if (this.lvlIdx === 2) {
      for (const cond of this.powerConduits) {
        if (cond.activated) continue;
        if (Math.hypot(cond.x - this.px, cond.y - this.py) < INTERACT_RADIUS) {
          cond.activated = true;
          if (this.audioReady) this.audio.conduitActivate();
          const obj = this.conduitMeshObjs.find(c => c.id === cond.id);
          if (obj) {
            obj.mat.color.set(0x00FFAA);
            obj.mat.emissive.set(0x00AA55);
            obj.mat.emissiveIntensity = 1.2;
            obj.light.color.set(0x00FFAA);
            obj.light.intensity = 2.4;
          }
          // Power-flow animation: route current from this conduit toward the nearer gate
          // Gate 1 door centre: (1427, 1300), Gate 2 door centre: (2627, 1300)
          const gate1 = { x: 1427, y: 1300 }; const gate2 = { x: 2627, y: 1300 };
          const nearerGate = Math.hypot(cond.x - gate1.x, cond.y - gate1.y) <
                             Math.hypot(cond.x - gate2.x, cond.y - gate2.y) ? gate1 : gate2;
          this._spawnConduitFlow(cond.x, cond.y, nearerGate.x, nearerGate.y);
          // Sequential: each conduit opens its own gate (id 0 → gateObstacleIdxs[0], id 1 → gateObstacleIdxs[1])
          // This ensures conduit 1 (middle zone) is reachable only after conduit 0 opens gate 1.
          const assignedGateIdx = (this.lvlDef?.gateObstacleIdxs ?? [])[cond.id] ?? -1;
          if (assignedGateIdx >= 0) {
            this.lvlDef!.obstacles[assignedGateIdx] = { x: -9999, y: -9999, w: 1, h: 1 };
            if (assignedGateIdx < this.obstacleMeshes.length) {
              this.obstacleMeshes[assignedGateIdx].visible = false;
              this.syncObstacleOverlay(assignedGateIdx);
            }
            this.gateObstacleIdxs = this.gateObstacleIdxs.filter(i => i !== assignedGateIdx);
          }
          const allOn = this.powerConduits.every(c => c.activated);
          if (allOn) {
            this.showSub("[ BOTH CONDUITS ONLINE — ALL CITY GATES CLEAR ]");
          } else if (cond.id === 0) {
            this.showSub("[ INNER GATE OPEN — SECOND CONDUIT LIES AHEAD ]");
          } else {
            this.showSub("[ OUTER GATE OPEN — PATH TO POD CLEAR ]");
          }
          return;
        }
      }
    }
    // Level 2: bulkhead check
    if (this.lvlIdx === 1 && !this.bulkheadOpen) {
      const def = this.lvlDef;
      if (def && this.bulkheadObstacleIdx >= 0 && this.bulkheadObstacleIdx < def.obstacles.length) {
        const bRect = def.obstacles[this.bulkheadObstacleIdx];
        const bCX = bRect.x + bRect.w / 2;
        const bCY = bRect.y + bRect.h / 2;
        if (Math.hypot(bCX - this.px, bCY - this.py) < INTERACT_RADIUS + 60) {
          this.showSub("[ AFT BULKHEAD SEALED — LURE THE STALKER AWAY TO OPEN ]"); return;
        }
      }
    }
    for (const p of this.pods) {
      if (p.rescued) continue;
      if (Math.hypot(p.x - this.px, p.y - this.py) < INTERACT_RADIUS) {
        // Level 2: gates must be open
        if (this.lvlIdx === 1 && p.id === "noah" && !this.bulkheadOpen) {
          this.showSub("[ AFT BULKHEAD SEALED — LURE THE STALKER AWAY FIRST ]"); return;
        }
        // Level 3: outer gate (gateObstacleIdxs[1] = obs[36]) must be open to reach Mia
        if (this.lvlIdx === 2 && p.id === "mia") {
          const outerGateIdx = (this.lvlDef?.gateObstacleIdxs ?? [])[1] ?? -1;
          if (outerGateIdx >= 0 && this.gateObstacleIdxs.includes(outerGateIdx)) {
            this.showSub("[ OUTER GATE SEALED — FIND THE SECOND POWER CONDUIT ]"); return;
          }
        }
        this.dockPod(p); return;
      }
    }
  }


  private triggerBuildingCollapse(ub: UnstableBuilding) {
    if (ub.collapsed) return;
    ub.collapsed = true;
    if (this.audioReady) this.audio.buildingCollapse();
    if (!this.lvlDef) return;
    this.noise = Math.min(100, this.noise + 35);
    this.soundEvents.push({ type: "extra_large", x: ub.cx, y: ub.cy, radius: 650 });
    // Remove the original monolithic obstacle
    const obs = this.lvlDef.obstacles[ub.obstacleIdx];
    if (obs) this.lvlDef.obstacles[ub.obstacleIdx] = { x: -9999, y: -9999, w: 1, h: 1 };
    if (ub.obstacleIdx < this.obstacleMeshes.length) {
      this.obstacleMeshes[ub.obstacleIdx].visible = false;
      this.syncObstacleOverlay(ub.obstacleIdx);
    }
    // Spawn 4–6 debris slabs as persistent new collision rectangles
    const debrisCount = 4 + Math.floor(Math.random() * 3);
    const baseW = obs ? obs.w : 80;
    const baseH = obs ? obs.h : 200;
    for (let d = 0; d < debrisCount; d++) {
      const dw = 30 + Math.random() * 50;
      const dh = 18 + Math.random() * 38;
      const dx = ub.cx - baseW * 0.5 + Math.random() * (baseW + 80) - 40;
      const dy = ub.cy - baseH * 0.5 + Math.random() * (baseH + 80) - 40;
      const debrisRect = { x: dx - dw / 2, y: dy - dh / 2, w: dw, h: dh };
      // Push into live obstacles so collision detection picks them up immediately
      this.lvlDef.obstacles.push(debrisRect);
      // Visualise debris as a flat dark box in the 3D scene
      const geo = new THREE.BoxGeometry(dw * WS, 4 * WS, dh * WS);
      const mat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.9, metalness: 0.25 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((dx) * WS, (2 + Math.random() * 6) * WS, (dy) * WS);
      mesh.rotation.y = Math.random() * Math.PI;
      this.sceneGroup.add(mesh);   // sceneGroup is cleared on level load — no leak
      this.obstacleMeshes.push(mesh);
      // Sonar overlay twin for debris so pings illuminate new rubble correctly
      if (this.sonarOverlayMat && this.sonarPingUniforms) {
        const debrisMat = this.sonarOverlayMat.clone();
        const pu = this.sonarPingUniforms;
        debrisMat.uniforms.uPingOrigin  = pu.uPingOrigin;
        debrisMat.uniforms.uPingRadius  = pu.uPingRadius;
        debrisMat.uniforms.uPingOpacity = pu.uPingOpacity;
        debrisMat.uniforms.uPingColor   = pu.uPingColor;
        const debrisRgb = SONAR_OBJECT_PALETTE["debris"] ?? SONAR_OBJECT_PALETTE["default"];
        debrisMat.uniforms.uObjectColor = { value: new THREE.Vector3(debrisRgb[0], debrisRgb[1], debrisRgb[2]) };
        const ov = new THREE.Mesh(geo, debrisMat);
        ov.position.copy(mesh.position); ov.rotation.copy(mesh.rotation); ov.scale.copy(mesh.scale);
        this.sceneGroup.add(ov);
        this.obstacleOverlayMeshes.push(ov);
      }
    }
    this.showSub("[ STRUCTURAL COLLAPSE — MASSIVE ACOUSTIC SIGNATURE ]", 3500);
    // Prolonged screen shake — building comes down hard
    this.shakeTimer = 680; this.shakeDuration = 680; this.shakeIntensity = 0.11;
  }

  private dockPod(pod: Lifepod) {
    pod.rescued = true;
    this.transitioning = true;
    this.audio.dock();
    if (this.audioReady) this.audio.flatline(2800);
    const survivor = pod.id as "sara" | "noah" | "mia";
    // Mia dock audio is handled AFTER eliasReactionMia fires (in updateDiscovery vitals→farewell)
    const farewellMap: Record<string, string> = {
      sara: '"Come home, Eli."',
      noah: '"I got you."',
      mia:  '"Dada find me."',
    };
    this.triggerDiscovery(survivor, farewellMap[survivor] ?? pod.commsLine, () => {
      if (this.pods.every(p => p.rescued)) this.completeLevel();
      else { this.transitioning = false; this.state = "PLAYING"; }
    });
  }

  private triggerDiscovery(survivor: "sara" | "noah" | "mia", farewell: string, after: () => void) {
    this.discoverySurvivor = survivor;
    this.discoveryFarewellMsg = farewell;
    this.discoveryPodAfter = after;
    this.discoveryPhase = "vitals";
    this.discoveryTimer = 2800;
    this.discoveryElapsed = 0;
    this.state = "DISCOVERY";

    // Build timed subtitle queue for this survivor's full discovery arc
    // Times are ms from start of DISCOVERY state (vitals phase begins at 0)
    const vitalsEnd = 2800;
    const farewellDur = survivor === "mia" ? 5000 : 3000;
    const farewellStart = vitalsEnd;

    const lines: Array<{ text: string; at: number; dur: number }> = [];
    if (survivor === "sara") {
      // Vitals phase
      lines.push({ text: 'COMMS: "Survivor recovered. Docking arm locked."', at: 200, dur: 3500 });
      // Farewell phase — Elias reaction then AI sign-off
      lines.push({ text: 'Elias: *sharp trembling breath — chokes into a gasp*', at: farewellStart + 800, dur: 3500 });
      lines.push({ text: 'AI: "Survivor recovered."', at: farewellStart + farewellDur - 1200, dur: 2500 });
    } else if (survivor === "noah") {
      lines.push({ text: 'COMMS: [CRACKLE] "Dad? Is that you?"', at: 600, dur: 4000 });
      lines.push({ text: 'Elias: *short broken cry* "No… no no no—"', at: farewellStart + 600, dur: 3500 });
      lines.push({ text: 'AI: "Survivor recovered."', at: farewellStart + farewellDur - 1200, dur: 2500 });
    } else {
      // Mia
      lines.push({ text: 'COMMS: [lullaby fading from inside the pod…]', at: 800, dur: 3800 });
      lines.push({ text: 'Elias: *full screaming breakdown — mic overloads — quiet sobbing*', at: farewellStart + 500, dur: 4000 });
      lines.push({ text: 'AI: "Survivor recovered."', at: farewellStart + farewellDur - 1400, dur: 2500 });
    }
    this.discoverySubLines = lines;
  }

  private checkPuzzle() {
    if (this.noiseObjs.length === 0) return;
    if (this.noiseObjs.every(o => o.silenced) && !this.puzzleDone) {
      this.puzzleDone = true;
      this.showSub("[ ALL SOURCES SILENCED — DEBRIS FIELD DISINTEGRATING — POD RELEASED ]");
    }
  }

  // ── Level 1: Abyssal Forest mechanics ─────────────────────────────────────
  private updateGasPods(dt: number) {
    if (!this.lvlDef) return;
    for (const gp of this.gasPods) {
      if (gp.triggered) continue;
      const dist = Math.hypot(gp.x - this.px, gp.y - this.py);
      if (dist < 60) {
        gp.triggered = true;
        if (this.audioReady) this.audio.gasPodExplosion();
        // Noise burst
        this.noise = Math.min(100, this.noise + 28);
        this.soundEvents.push({ type: "large_ping", x: gp.x, y: gp.y, radius: 420 });
        // Hull damage
        this.hullIntegrity = Math.max(0, this.hullIntegrity - 12);
        this.gaugeVelocity.hull -= 45;
        this.hullBezelFlash = 480;
        this._emergencyLightTimer = Math.max(this._emergencyLightTimer, 2000);
        this._hullWhiteFlash = 1;
        this.shakeTimer = 260; this.shakeDuration = 260; this.shakeIntensity = 0.065;
        this.showSub("[ GAS POD DETONATED — ACOUSTIC SIGNATURE SPIKED ]", 2400);
        // Remove 3D mesh
        const mo = this.gasPodMeshes.find(m => m.id === gp.id);
        if (mo) { this.sceneGroup.remove(mo.mesh); mo.mesh.geometry.dispose(); }
      }
    }
  }

  private updateSnapBranches(dt: number) {
    if (!this.lvlDef) return;
    for (const sb of this.snapBranches) {
      if (sb.triggered) continue;
      const dist = Math.hypot(sb.x - this.px, sb.y - this.py);
      if (dist < 48) {
        sb.triggered = true;
        if (this.audioReady) this.audio.snapBranchCrack();
        // Large noise event — punishes reckless movement, full Drifter alert range
        this.noise = Math.min(100, this.noise + 28);
        this.soundEvents.push({ type: "large_ping", x: sb.x, y: sb.y, radius: 640 });
        this.showSub("[ KELP BRANCH SNAPPED — LARGE ACOUSTIC BURST ]", 2000);
        const mo = this.snapBranchMeshes.find(m => m.id === sb.id);
        if (mo) {
          const mat = (mo.mesh.material as THREE.MeshStandardMaterial);
          mat.color.set(0x885522); mat.emissive.set(0x220000);
        }
      }
    }
  }

  // Bloom event-magnitude buffer — rolling 3-second window of SoundEvent magnitudes
  // Populated from soundEvents just before they're cleared each frame in updateNoise.
  private _bloomEventBuf: Array<{ t: number; magnitude: number }> = [];

  // Weights map: how loud (0–100 normalised) each SoundEvent type counts as
  private static readonly BLOOM_MAG: Record<string, number> = {
    collision: 100, extra_large: 95, large_ping: 65, medium_ping: 42, full_speed: 40, flare: 55, small_ping: 20,
  };

  // Called from updateNoise each frame before soundEvents is cleared
  private _recordBloomEvents() {
    if (this.lvlIdx !== 0) return;   // only used on level 1
    const now = this.lvlTime;        // seconds
    for (const se of this.soundEvents) {
      const mag = EchoesGame.BLOOM_MAG[se.type] ?? 10;
      this._bloomEventBuf.push({ t: now, magnitude: mag });
    }
    // Prune stale entries (> 3 s old)
    this._bloomEventBuf = this._bloomEventBuf.filter(e => now - e.t <= 3.0);
  }

  // Returns summed event magnitude in the last 3 s, clamped to 0–100
  private _bloomMagnitudeSum(): number {
    const sum = this._bloomEventBuf.reduce((s, e) => s + e.magnitude, 0);
    // Normalise: a collision (100) is considered maximum stimulation
    return Math.min(100, sum);
  }

  private updateSonicBloom(_dt: number) {
    if (!this.sonicBloomGroup) return;
    const t = this.lvlTime;
    // Sum of SoundEvent magnitudes in the last 3 s drives pulse speed and brightness
    const recentNoise = this._bloomMagnitudeSum();       // 0–100
    const noiseFrac = recentNoise / 100;                  // 0–1
    // Speed: 1.2 rad/s at silence → 4.5 rad/s at full noise
    const pulseSpeed = 1.2 + noiseFrac * 3.3;
    // Peak opacity: 0.10 at silence → 0.48 at full noise
    const peakOpacity = 0.10 + noiseFrac * 0.38;
    this.sonicBloomGroup.children.forEach((child, i) => {
      const m = child as THREE.Mesh;
      const mat = m.material as THREE.MeshBasicMaterial;
      const phase = t * pulseSpeed + i * 0.45;
      // Brightness modulates between 55% and 100% of peakOpacity
      mat.opacity = Math.max(0.04, peakOpacity * (0.55 + 0.45 * Math.sin(phase)));
      // Scale similarly amplified by noise
      const scaleMod = 0.12 + noiseFrac * 0.18;
      m.scale.setScalar(1.0 + scaleMod * Math.sin(phase + i * 0.32));
    });
    this.sonicBloomGroup.position.set(this.px * WS, EYE_H, this.py * WS);
  }

  // ── Level 2: Iron Graveyard mechanics ─────────────────────────────────────
  private updateGraveyardBreath(dt: number) {
    this.graveyardBreathTimer -= dt;
    if (this.graveyardBreathTimer <= 0) {
      // 25–60 second window between events
      this.graveyardBreathTimer = 25000 + Math.random() * 35000;
      if (this.audioReady) this.audio.wreckSettle();
      // Pick a random wreck position to emanate from
      if (this.wreckPositions.length > 0) {
        const wp = this.wreckPositions[Math.floor(Math.random() * this.wreckPositions.length)];
        // Medium-strength event: dedicated type for tuning, audible to nearby creatures
        this.noise = Math.min(100, this.noise + 14);
        this.soundEvents.push({ type: "medium_ping", x: wp.x, y: wp.y, radius: 480 });
        // Brief camera shake — structural resonance from hull settling
        this.shakeTimer = 280; this.shakeDuration = 280; this.shakeIntensity = 0.035;
      }
    }
  }

  /**
   * Sync an overlay twin's position, rotation, scale, and visibility to its source obstacle mesh.
   * Call this whenever any obstacle mesh is repositioned, rescaled, or hidden so the sonar
   * grid stays aligned with the visible geometry.  Works for any index in the parallel
   * obstacleMeshes / obstacleOverlayMeshes arrays, including dynamically appended debris.
   */
  private syncObstacleOverlay(idx: number): void {
    const src = this.obstacleMeshes[idx];
    const ov  = this.obstacleOverlayMeshes[idx];
    if (!src || !ov) return;
    ov.position.copy(src.position);
    ov.rotation.copy(src.rotation);
    ov.scale.copy(src.scale);
    ov.visible = src.visible;
  }

  private updateBulkhead(dt: number) {
    // Animate door-shrink after open is triggered (scale Y 1 → 0 over 800ms, then hide)
    if (this.bulkheadAnimTimer > 0 && this.bulkheadMesh) {
      this.bulkheadAnimTimer = Math.max(0, this.bulkheadAnimTimer - dt);
      const progress = 1 - this.bulkheadAnimTimer / 800;  // 0→1
      const scaleY = Math.max(0.001, 1 - progress);
      this.bulkheadMesh.scale.set(1, scaleY, 1);
      // Keep overlay twin in sync so the sonar grid matches the shrinking door
      this.syncObstacleOverlay(this.bulkheadObstacleIdx);
      if (this.bulkheadAnimTimer <= 0) {
        this.bulkheadMesh.visible = false;
        this.syncObstacleOverlay(this.bulkheadObstacleIdx);
        this.showSub("[ AFT BULKHEAD OPEN — PATH CLEAR ]", 2200);
      }
    }
    if (this.bulkheadOpen || this.bulkheadObstacleIdx < 0 || !this.lvlDef) return;
    // bulkheadFlareLured is set eagerly in dropFlare() — soundEvents are already cleared by
    // the time this method runs so we do not scan them here.
    if (!this.bulkheadFlareLured) return;
    const gauntletStalker = this.enemies[1];
    if (!gauntletStalker) return;
    const bRect = this.lvlDef.obstacles[this.bulkheadObstacleIdx];
    if (!bRect) return;
    const bCX = bRect.x + bRect.w / 2;
    const bCY = bRect.y + bRect.h / 2;
    const stalkerDist = Math.hypot(gauntletStalker.x - bCX, gauntletStalker.y - bCY);
    if (stalkerDist > 450) {
      this.bulkheadStalkerClearTimer += dt;
      if (this.bulkheadStalkerClearTimer >= 2000) {
        this.bulkheadOpen = true;
        this.lvlDef.obstacles[this.bulkheadObstacleIdx] = { x: -9999, y: -9999, w: 1, h: 1 };
        // Overlay visibility is handled by the scale-sync animation in updateBulkhead — do not hide early
        // Kick off the door-shrink animation (0.8s scale-Y collapse)
        this.bulkheadAnimTimer = 800;
        this.showSub("[ AFT BULKHEAD DISENGAGING ]", 2800);
        if (this.audioReady) this.audio.conduitActivate();
      }
    } else {
      this.bulkheadStalkerClearTimer = 0;
    }
  }

  // ── Level 3: Drowned Metropolis mechanics ─────────────────────────────────

  // Spawn a stream of traveling pulse spheres from (srcX,srcY) → (dstX,dstY)
  private _spawnConduitFlow(srcX: number, srcY: number, dstX: number, dstY: number) {
    const COUNT = 7;
    for (let i = 0; i < COUNT; i++) {
      const geo = new THREE.SphereGeometry(0.22, 6, 5);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00FFCC, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(srcX * WS, EYE_H * 0.8, srcY * WS);
      this.sceneGroup.add(mesh);
      this._flowPulses.push({
        mesh, mat,
        x0: srcX, y0: srcY, x1: dstX, y1: dstY,
        progress: 0, speed: 0.00025 + Math.random() * 0.0001,
        delay: i * 280,   // stagger 280ms apart
        active: false,
      });
    }
  }

  private updatePowerConduits(dt: number) {
    if (!this.conduitHintShown) {
      const anyNear = this.powerConduits.some(c => Math.hypot(c.x - this.px, c.y - this.py) < 280);
      if (anyNear) {
        this.conduitHintShown = true;
        this.showSub("[ POWER CONDUIT NEARBY — PRESS E TO ACTIVATE ]", 3000);
      }
    }
    // Pulse the conduit lights (inactive conduits only)
    const t = this.lvlTime;
    for (const obj of this.conduitMeshObjs) {
      const cond = this.powerConduits.find(c => c.id === obj.id);
      if (!cond || cond.activated) continue;
      obj.light.intensity = 0.6 + 0.4 * Math.sin(t * 3.2 + obj.id);
    }
    // Animate power-flow pulse spheres conduit → gate
    for (let i = this._flowPulses.length - 1; i >= 0; i--) {
      const fp = this._flowPulses[i];
      if (fp.delay > 0) { fp.delay -= dt; continue; }
      fp.active = true;
      fp.progress = Math.min(1, fp.progress + fp.speed * dt);
      const px = fp.x0 + (fp.x1 - fp.x0) * fp.progress;
      const py = fp.y0 + (fp.y1 - fp.y0) * fp.progress;
      fp.mesh.position.set(px * WS, EYE_H * 0.8, py * WS);
      // Fade in at start, fade out near destination
      const fade = 1 - Math.abs(fp.progress - 0.5) * 2;
      fp.mat.opacity = Math.max(0, fade * 0.65);
      if (fp.progress >= 1) {
        this.sceneGroup.remove(fp.mesh);
        fp.mesh.geometry.dispose(); fp.mat.dispose();
        this._flowPulses.splice(i, 1);
      }
    }
  }

  private updateUnstableBuildings() {
    if (!this.lvlDef) return;
    const playerSpeed = Math.hypot(this.pvx, this.pvy);
    for (const ub of this.unstableBuildings) {
      if (ub.collapsed) continue;
      const r = this.lvlDef.obstacles[ub.obstacleIdx];
      if (!r || r.x === -9999) continue;
      // Trigger 1: high-speed player ramming (AABB edge proximity + force threshold)
      const nearX = Math.max(r.x, Math.min(this.px, r.x + r.w));
      const nearY = Math.max(r.y, Math.min(this.py, r.y + r.h));
      if (Math.hypot(nearX - this.px, nearY - this.py) < 8 && playerSpeed > 160) {
        this.triggerBuildingCollapse(ub); continue;
      }
      // Trigger 2: any qualifying large soundEvent (collision or large_ping) nearby
      for (const se of this.soundEvents) {
        if (se.type !== "large_ping" && se.type !== "medium_ping" && se.type !== "extra_large" && se.type !== "collision") continue;
        if (Math.hypot(se.x - ub.cx, se.y - ub.cy) < se.radius * 0.55) {
          this.triggerBuildingCollapse(ub); break;
        }
      }
    }
  }

  private updateGhostEchoes(dt: number) {
    for (let i = this.ghostEchoes.length - 1; i >= 0; i--) {
      const ge = this.ghostEchoes[i];
      ge.life -= dt;
      ge.radius = ge.maxR * (1 - ge.life / 1800);  // life starts at 1800ms — begins near-zero radius
      ge.mat.opacity = Math.max(0, (ge.life / 3200) * 0.22);
      ge.sphere.geometry.dispose();
      ge.sphere.geometry = new THREE.SphereGeometry(ge.radius * WS, 12, 8);
      if (ge.life <= 0) {
        this.sceneGroup.remove(ge.sphere);
        ge.sphere.geometry.dispose();
        ge.mat.dispose();
        this.ghostEchoes.splice(i, 1);
      }
    }
  }

  private completeLevel() {
    // Snapshot this level's time and remaining O2 before transitioning resets them
    this.levelTimes[this.lvlIdx] = this.lvlTime;
    this.levelO2Remaining[this.lvlIdx] = this.o2;

    if (this.lvlIdx === 0) {
      this.startCS(CS_SARA_TO_NOAH, () => this.showLevelTransition(1, () => this.loadLevel(1)));
    } else if (this.lvlIdx === 1) {
      this.startCS(CS_NOAH_TO_MIA, () => this.showLevelTransition(2, () => this.loadLevel(2)));
    } else if (this.lvlIdx === 2) {
      this.beginCollapse();
    }
  }

  private showLevelTransition(nextIdx: number, cb: () => void) {
    this.transitionTargetLvl = nextIdx;
    this.transitionStartMs = Date.now();
    this.transitionCallback = cb;
    this.state = "LEVEL_TRANSITION";
  }

  private beginCollapse() {
    this.state = "COLLAPSE";
    this.collapseTimer = 0;
    this.collapseWhite = 0;
    this.collapseBlack = 0;

    // Persist completion record to localStorage
    const LEVELS = [
      { name: "Sara",  depth: "20m" },
      { name: "Noah",  depth: "55m" },
      { name: "Mia",   depth: "82m" },
    ];
    const record = {
      completedAt: Date.now(),
      levels: LEVELS.map((l, i) => ({
        name:    l.name,
        depth:   l.depth,
        time:    Math.round(this.levelTimes[i]),
        o2:      Math.round(this.levelO2Remaining[i]),
      })),
    };
    try { localStorage.setItem("eotd_completion", JSON.stringify(record)); } catch (_) { /* storage unavailable */ }
    this._completionCache = record; // prime cache so next menu visit doesn't re-parse localStorage

    // Mute all game audio and leave only the ventilator — one sound, alone
    if (this.audioReady) this.audio.collapseAudio();
  }

  private _loadCompletionRecord(): { completedAt: number; levels: Array<{ name: string; depth: string; time: number; o2: number }> } | null {
    try {
      const raw = localStorage.getItem("eotd_completion");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== "object" || parsed === null ||
        typeof (parsed as Record<string, unknown>).completedAt !== "number" ||
        !Array.isArray((parsed as Record<string, unknown>).levels) ||
        ((parsed as Record<string, unknown>).levels as unknown[]).length !== 3
      ) return null;
      return parsed as { completedAt: number; levels: Array<{ name: string; depth: string; time: number; o2: number }> };
    } catch (_) { return null; }
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
    this.state = "CUTSCENE";
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
    if (this.state === "MENU" || this.state === "GAME_OVER") return;
    if (this.state === "CUTSCENE") { this.updateCS(dt); return; }
    if (this.state === "DISCOVERY") { this.updateDiscovery(dt); this.updatePings3D(dt); return; }
    if (this.state === "COLLAPSE") { this.updateCollapse(dt); return; }
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
    if (this.lvlIdx === 1) this.updateBoatZone(dt); // must run before updatePlayer + updateEnemies for frame-accurate zone state
    this.updatePlayer(dt);
    this.updateCameraPhysics(dt);
    this.updateFlares(dt);    // emit flare events BEFORE enemies consume them this frame
    this.updateEnemies(dt);   // consume all sound events (sonar, collision, movement, flares)
    this.updatePings(dt);
    if (this.lvlIdx === 2) this.updateUnstableBuildings(); // read soundEvents BEFORE updateNoise clears them
    this.updateNoise(dt);     // clear soundEvents at end of frame
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
    if (this.lvlIdx === 2) this.updateLullaby();
    this.updateLetters(dt);
    if (this.lvlIdx === 0) { this.updateGasPods(dt); this.updateSnapBranches(dt); this.updateSonicBloom(dt); }
    if (this.lvlIdx === 1) { this.updateGraveyardBreath(dt); this.updateBulkhead(dt); }
    if (this.lvlIdx === 2) { this.updatePowerConduits(dt); this.updateGhostEchoes(dt); }
  }

  private updateLetters(dt: number) {
    if (this.letterEntities.length === 0) return;

    // Tick down flash timers on already-collected letters
    // Also drive proximity-based reveal alpha for every uncollected letter
    const dtSec = dt / 1000;
    for (const letter of this.letterEntities) {
      if (letter.collected) {
        if (letter.flashTimer > 0) letter.flashTimer = Math.max(0, letter.flashTimer - dt);
        letter.revealAlpha = 1; // collected letters are always "revealed"
        continue;
      }
      // Compute how visible this letter should be based on distance to player
      const dist = Math.hypot(letter.x - this.px, letter.y - this.py);
      const far  = this.LETTER_REVEAL_FAR;
      const near = this.LETTER_REVEAL_NEAR;
      const targetAlpha = dist >= far ? 0 : dist <= near ? 1 : 1 - (dist - near) / (far - near);
      // Smoothly lerp toward target — fast approach, slow retreat
      const speed = targetAlpha > letter.revealAlpha ? 1.8 : 0.8;
      letter.revealAlpha += (targetAlpha - letter.revealAlpha) * Math.min(1, speed * dtSec);
      if (letter.revealAlpha < 0.005) letter.revealAlpha = 0;
    }

    // Find the next uncollected letter (strict-order collection)
    const nextIdx = this.letterEntities.findIndex(l => !l.collected);
    if (nextIdx === -1) {
      // All collected — tick the name-strip display timer
      if (this.nameStripTimer > 0) {
        this.nameStripTimer -= dt;
        if (this.nameStripTimer < 0) this.nameStripTimer = 0;
      } else {
        // Fade out
        this.nameStripAlpha = Math.max(0, this.nameStripAlpha - dt / this.NAME_STRIP_FADE);
      }
      return;
    }

    const next = this.letterEntities[nextIdx];
    const dist = Math.hypot(next.x - this.px, next.y - this.py);
    if (dist <= this.LETTER_COLLECT_R) {
      next.collected = true;
      next.flashTimer = this.LETTER_FLASH_DUR;
      if (this.audioReady) this.audio.playLetterEcho();

      // Check if this was the last letter
      const allDone = this.letterEntities.every(l => l.collected);
      if (allDone) {
        // Show full name for NAME_STRIP_HOLD ms, then fade
        this.nameStripAlpha = 1;
        this.nameStripTimer = this.NAME_STRIP_HOLD;
      } else {
        // Partial name — keep visible at full alpha
        this.nameStripAlpha = 1;
        this.nameStripTimer = 0; // no countdown until name is complete
      }
    }
  }

  private miaProximity = 0; // 0..1, drives Level 4 glitch intensity

  private updateBoatZone(dt: number) {
    // Only active when Level 2 has successfully placed the boat (non-zero position)
    if (this._boatWorldX === 0 && this._boatWorldY === 0) return;

    const ZONE_RADIUS  = 375;   // 2D px — enter/exit threshold
    const MUSIC_IN     = 0.08;  // master gain inside zone (≤10%)
    const MUSIC_NORMAL = 0.6;   // default master gain
    const ENTER_MS     = 2000;  // ms to ramp speed down to 0.4 on entry
    const EXIT_MS      = 1500;  // ms to ramp speed back to 1.0 on exit

    const dist     = Math.hypot(this.px - this._boatWorldX, this.py - this._boatWorldY);
    const wasActive = this._boatZoneActive;
    this._boatZoneActive = dist < ZONE_RADIUS;

    if (!wasActive && this._boatZoneActive) {
      // Entered — start a deterministic ramp from current speed to 0.4 over ENTER_MS
      this._boatSpeedRampFrom  = this._boatSpeedMult;
      this._boatSpeedRampTo    = 0.4;
      this._boatSpeedRampDur   = ENTER_MS;
      this._boatSpeedRampTimer = 0;
      if (this.audioReady) this.audio.setMasterGain(MUSIC_IN, ENTER_MS / 1000);
    } else if (wasActive && !this._boatZoneActive) {
      // Exited — start a deterministic ramp from current speed to 1.0 over EXIT_MS
      this._boatSpeedRampFrom  = this._boatSpeedMult;
      this._boatSpeedRampTo    = 1.0;
      this._boatSpeedRampDur   = EXIT_MS;
      this._boatSpeedRampTimer = 0;
      if (this.audioReady) this.audio.setMasterGain(MUSIC_NORMAL, 3.0);
    }

    // Advance the deterministic linear ramp
    if (this._boatSpeedRampDur > 0) {
      this._boatSpeedRampTimer = Math.min(this._boatSpeedRampTimer + dt, this._boatSpeedRampDur);
      const t = this._boatSpeedRampTimer / this._boatSpeedRampDur;
      this._boatSpeedMult = this._boatSpeedRampFrom + (this._boatSpeedRampTo - this._boatSpeedRampFrom) * t;
      if (this._boatSpeedRampTimer >= this._boatSpeedRampDur) {
        this._boatSpeedMult  = this._boatSpeedRampTo;
        this._boatSpeedRampDur = 0;  // ramp complete
      }
    }
  }

  private updateLullaby() {
    const miaPod = this.pods.find(p => p.id === "mia");
    if (!miaPod || miaPod.rescued) { this.miaProximity = 0; return; }
    const dist = Math.hypot(miaPod.x - this.px, miaPod.y - this.py);
    this.audio.setLullabyGain(Math.max(0, 1 - dist / 600) * 0.65);
    this.miaProximity = dist < 450 ? 1 - dist / 450 : 0;
    if (this.miaProximity > 0 && Math.random() < this.miaProximity * 0.09) {
      this.glitchTimer = Math.max(this.glitchTimer, 150 + this.miaProximity * 500);
    }
  }

  private updateDiscovery(dt: number) {
    const farewellTime = this.discoverySurvivor === "mia" ? 5000 : 3000;
    const memoryTime   = this.discoverySurvivor === "mia" ? 10000 : 8000; // 1s black + 1.5s in + hold + 2s out

    this.discoveryElapsed += dt;
    this.discoveryTimer -= dt;
    // Decrement subtitle timer (normally handled in PLAYING update branch only)
    if (this.subTimer > 0) this.subTimer = Math.max(0, this.subTimer - dt);

    // Fire any timed discovery subtitle lines
    for (let i = this.discoverySubLines.length - 1; i >= 0; i--) {
      const line = this.discoverySubLines[i];
      if (this.discoveryElapsed >= line.at) {
        this.showSub(line.text, line.dur);
        this.discoverySubLines.splice(i, 1);
      }
    }

    if (this.discoveryTimer <= 0) {
      if (this.discoveryPhase === "vitals") {
        if (this.audioReady) {
          if (this.discoverySurvivor === "sara") this.audio.eliasReactionSara();
          else if (this.discoverySurvivor === "noah") {
            this.audio.eliasReactionNoah();
          } else {
            // Mia: fire reaction first (routes through master), then mute master after scream
            this.audio.eliasReactionMia();
            setTimeout(() => { if (this.audioReady) this.audio.miaDockedAudio(); }, 1200);
          }
        }
        this.discoveryPhase = "farewell";
        this.discoveryTimer = farewellTime;
      } else if (this.discoveryPhase === "farewell") {
        this.discoveryPhase = "memory";
        this.discoveryTimer = memoryTime;
        this.memoryFlashAlpha = 0;
        this.memoryFlashPhase = "in";
        if (this.lvlIdx === 2) this.audio.setLullabyGain(0);
        // Ambient starts after 1s black silence window
        if (this.audioReady) {
          const survivor = this.discoverySurvivor;
          setTimeout(() => {
            if (!this.audioReady) return;
            if (survivor === "sara") this.audio.saraMemoryAudio();
            else if (survivor === "noah") this.audio.noahMemoryAudio();
            else if (survivor === "mia") this.audio.miaMemoryAudio();
          }, 1000);
        }
      } else if (this.discoveryPhase === "memory") {
        this.discoveryPhase = "done";
        this._commsActive = false;
        const cb = this.discoveryPodAfter;
        this.discoveryPodAfter = null;
        cb?.();
      }
    }
    if (this.discoveryPhase === "memory") {
      // Structure: 1000ms black silence → 1500ms fade in → hold → 1200ms fade out
      const elapsed = memoryTime - this.discoveryTimer;
      const BLACK_END = 1000, FADE_IN_END = 2500, FADE_OUT_START = memoryTime - 1200;
      if (elapsed < BLACK_END) {
        this.memoryFlashPhase = "in";
        this.memoryFlashAlpha = 0;
      } else if (elapsed < FADE_IN_END) {
        this.memoryFlashPhase = "in";
        this.memoryFlashAlpha = (elapsed - BLACK_END) / (FADE_IN_END - BLACK_END);
      } else if (elapsed < FADE_OUT_START) {
        this.memoryFlashPhase = "hold";
        this.memoryFlashAlpha = 1;
      } else {
        this.memoryFlashPhase = "out";
        this.memoryFlashAlpha = 1 - (elapsed - FADE_OUT_START) / 1200;
      }
      this.memoryFlashAlpha = Math.max(0, Math.min(1, this.memoryFlashAlpha));
    }
  }

  private updateCollapse(dt: number) {
    this.collapseTimer += dt;
    const TOTAL = 14000; // 6s fracture + 2s full white + 4s fade to black + 2s hold
    const pct = Math.min(1, this.collapseTimer / TOTAL);
    // Keep glitch active during fracture phase
    if (pct < 0.55) this.glitchTimer = 300;
    // White builds from 55-72% of TOTAL; then full white 72-86%; then fade to black 86-100%
    if (pct < 0.55) {
      this.collapseWhite = 0;
    } else if (pct < 0.72) {
      this.collapseWhite = (pct - 0.55) / 0.17;
    } else {
      this.collapseWhite = 1;
    }
    // collapseBlack: 86%→100% fade to black for end card
    this.collapseBlack = pct > 0.86 ? Math.min(1, (pct - 0.86) / 0.14) : 0;
    // Transition to GAME_OVER once sequence fully complete
    if (pct >= 1) {
      this.state = "GAME_OVER";
      this.gameOverReason = "ending";
      this._endingEnteredAt = Date.now();
    }
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

    // ── Raw key input axes ──
    // SAFETY: No Leviathan state (_updateLeviathanAI / updateLeviathan) ever
    // modifies this.keys, this.smoothFwd, this.smoothSide, this.pvx, or this.pvy
    // in a way that restricts player motion. WASD always drives the sub during
    // PLAYING state regardless of Leviathan patrol / alert / hunt / attacking.
    // The only intentional thrust suppression is engineCutActive (Q key, below).
    const rawFwd  = (this.keys["KeyW"] || this.keys["ArrowUp"]    ? 1 : 0)
                  - (this.keys["KeyS"] || this.keys["ArrowDown"]  ? 1 : 0);
    const rawSide = (this.keys["KeyD"] || this.keys["ArrowRight"] ? 1 : 0)
                  - (this.keys["KeyA"] || this.keys["ArrowLeft"]  ? 1 : 0);

    // ── Input smoothing ──
    const smoothRate = 1 - Math.pow(1 - INPUT_SMOOTH_K, dtS * 60);
    this.smoothFwd  += (rawFwd  - this.smoothFwd)  * smoothRate;
    this.smoothSide += (rawSide - this.smoothSide) * smoothRate;

    // ── Direction vectors from current yaw ──
    const fwdX =  -Math.sin(this.yaw);
    const fwdY =  -Math.cos(this.yaw);
    const rgtX =   Math.cos(this.yaw);
    const rgtY =  -Math.sin(this.yaw);

    // ── Apply force from smoothed input ──
    // Engine cut (Q): kills all thrust — sub coasts on inertia and goes nearly silent
    const engineCut = this.engineCutActive;
    const spd = PLAYER_SPEED * (boosting ? PLAYER_BOOST_MULT : 1) * this._boatSpeedMult;
    const forceX = engineCut ? 0 : (fwdX * this.smoothFwd + rgtX * this.smoothSide) * spd;
    const forceY = engineCut ? 0 : (fwdY * this.smoothFwd + rgtY * this.smoothSide) * spd;
    this.pvx += forceX * dtS;
    this.pvy += forceY * dtS;

    // Sprinting adds noise (suppressed during engine cut)
    if (!engineCut && boosting && (rawFwd || rawSide)) this.noise = Math.min(100, this.noise + 2.5 * dtS);

    // Boost auto-ping: while shift held, brief sonar dim-ping every 2 s
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

    // ── Non-linear drag ──
    const speed = Math.hypot(this.pvx, this.pvy);
    const dragRate = FLUID_BASE_DRAG + FLUID_SPEED_DRAG * speed * speed;
    const dragFactor = Math.max(0, 1 - dragRate * dtS);
    this.pvx *= dragFactor;
    this.pvy *= dragFactor;

    // Single-step reference position — used by hull-damage correction check below
    const nx = this.px + this.pvx * dtS;
    const ny = this.py + this.pvy * dtS;

    // ── Sub-stepped movement + solid obstacle collision ──
    // Split large-displacement frames into sub-steps so boost-speed movement
    // cannot tunnel through thin geometry in one tick.
    // On each sub-step hit the inward velocity component is reflected by
    // PLAYER_BOUNCE_RESTITUTION (small bounce) while tangential velocity is
    // preserved unchanged for natural wall-sliding.
    const MAX_STEP = PLAYER_SIZE * 0.5;
    const rawDist  = Math.hypot(this.pvx * dtS, this.pvy * dtS);
    const hasObs   = def.obstacles.length > 0;
    const steps    = hasObs ? Math.max(1, Math.min(4, Math.ceil(rawDist / MAX_STEP))) : 1;
    const subDtS   = dtS / steps;

    // Capture pre-collision velocity so damage severity uses the speed at impact,
    // not the already-zeroed velocity after wall cancellation.
    const preVx = this.pvx, preVy = this.pvy;

    for (let s = 0; s < steps; s++) {
      const stepNx = this.px + this.pvx * subDtS;
      const stepNy = this.py + this.pvy * subDtS;

      let fx: number, fy: number;
      if (hasObs) {
        const [rx, ry] = this.collide(stepNx, stepNy, PLAYER_SIZE, def.obstacles);
        fx = Math.max(PLAYER_SIZE + 2, Math.min(def.worldW - PLAYER_SIZE - 2, rx));
        fy = Math.max(PLAYER_SIZE + 2, Math.min(def.worldH - PLAYER_SIZE - 2, ry));
      } else {
        fx = Math.max(PLAYER_SIZE + 2, Math.min(def.worldW - PLAYER_SIZE - 2, stepNx));
        fy = Math.max(PLAYER_SIZE + 2, Math.min(def.worldH - PLAYER_SIZE - 2, stepNy));
      }

      // Cancel the inward velocity component and apply a small restitution so
      // the sub bounces subtly off surfaces rather than stopping dead.
      // Tangential velocity is preserved for natural wall-sliding.
      const scorrX = fx - stepNx;
      const scorrY = fy - stepNy;
      const scorrDist = Math.hypot(scorrX, scorrY);
      if (scorrDist > 0.01) {
        const normX = scorrX / scorrDist;
        const normY = scorrY / scorrDist;
        const inward = this.pvx * normX + this.pvy * normY;
        if (inward < 0) {
          // Remove the inward component and add a fraction back outward
          this.pvx -= inward * (1 + PLAYER_BOUNCE_RESTITUTION) * normX;
          this.pvy -= inward * (1 + PLAYER_BOUNCE_RESTITUTION) * normY;
        }
      }

      this.px = fx;
      this.py = fy;
    }

    // Full-speed movement emits periodic sound events for Leviathan alerting
    // Engine cut suppresses these emissions entirely — the primary stealth reward for L2
    this.levSpeedNoiseTimer -= dt;
    if (!this.engineCutActive && this.levSpeedNoiseTimer <= 0 && speed > PLAYER_SPEED * LEV_PLAYER_SLOW_FRAC) {
      this.levSpeedNoiseTimer = LEV_SPEED_NOISE_INTV;
      this.soundEvents.push({ type: "full_speed", x: this.px, y: this.py, radius: LEV_HEAR_FULL_SPEED });
    } else if (speed <= PLAYER_SPEED * LEV_PLAYER_SLOW_FRAC) {
      this.levSpeedNoiseTimer = 0;
    }

    // ── Hull collision damage ──
    if (this.hullDamageCooldown > 0) this.hullDamageCooldown -= dt;

    // Correction vector: how far we were pushed out of the obstacle/wall
    const corrX = this.px - nx;
    const corrY = this.py - ny;
    const corrDist = Math.hypot(corrX, corrY);

    if (hasObs && corrDist > 0.4 && this.hullDamageCooldown <= 0 && !this.transitioning) {
      // Use pre-collision velocity so severity reflects the speed at impact
      // (post-collision pvx/pvy has already had the inward component zeroed).
      const normX = corrX / corrDist, normY = corrY / corrDist;
      const approachVel = -(preVx * normX + preVy * normY);
      const isDirect = approachVel > 90; // px/s — head-on threshold

      const damage = isDirect ? 18 + Math.random() * 7 : 5 + Math.random() * 3;
      this.hullIntegrity = Math.max(0, this.hullIntegrity - damage);
      this.hullDamageCooldown = 600;

      // Spring kick on hull needle — overshoot effect
      this.gaugeVelocity.hull -= isDirect ? 65 : 28;
      this.hullBezelFlash = isDirect ? 620 : 340;
      this._emergencyLightTimer = Math.max(this._emergencyLightTimer, 2000);
      this._hullWhiteFlash = 1;

      // Camera shake — intensity and duration scale with severity
      this.shakeTimer = isDirect ? 320 : 160;
      this.shakeDuration = isDirect ? 320 : 160;
      this.shakeIntensity = isDirect ? 0.07 : 0.028;

      // Metallic impact sound
      if (this.audioReady) this.audio.impact(isDirect ? "direct" : "graze");
      // Collision sound event for leviathan alerting (direct impact only — grazes are quiet)
      if (isDirect) this.soundEvents.push({ type: "collision", x: this.px, y: this.py, radius: LEV_HEAR_COLLISION });
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
    const playerSpeed = Math.hypot(this.pvx, this.pvy);
    const playerIsSlow = playerSpeed < PLAYER_SPEED * LEV_PLAYER_SLOW_FRAC;

    // Freeze all enemy AI while inside SARA's boat zone — stillness, silence
    if (this._boatZoneActive) return;

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.visTimer > 0) e.visTimer -= dt;
      const dist = Math.hypot(e.x - this.px, e.y - this.py);

      if (e.type === "leviathan") {
        // ── 4-state Leviathan AI ─────────────────────────────────────────────
        this._updateLeviathanAI(e, dt, dtS, dist, playerIsSlow);
      } else {
        // ── Drifter / Stalker: original 3-threshold noise system ─────────────
        const hearingDist = e.hearingDist ?? 700;
        const alertDist   = e.alertDist   ?? 500;
        if (this.noise >= 61 && dist < hearingDist) e.state = "hunt";
        else if (this.noise >= 31 && dist < alertDist) e.state = "alert";
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

        // Player hit (drifter/stalker)
        if (this.invTimer <= 0 && dist < e.hitR + PLAYER_SIZE * 0.8) {
          this.o2 = Math.max(0, this.o2 - O2_LOSS_HIT); this.invTimer = 2200;
          this.glitchTimer = 700; this.noise = Math.min(100, this.noise + 20);
          this.hullIntegrity = Math.max(0, this.hullIntegrity - 14);
          this.gaugeVelocity.hull -= 55;
          this.gaugeVelocity.o2   -= 30;
          this.hullBezelFlash = 480;
          this._emergencyLightTimer = Math.max(this._emergencyLightTimer, 2000);
          this._hullWhiteFlash = 1;
          if (this.audioReady) this.audio.damage();
          this.showSub("[ HULL BREACH — OXYGEN DEPLETED ]");
        }
      }

      if (this.invTimer > 0) this.invTimer -= dt;

      // ── 3D visual sync — always render, sonar controls brightness ────────
      if (i < this.enemyObjs.length) {
        const eobj = this.enemyObjs[i];
        const sonarA = Math.min(1, e.visTimer / 900);
        const a = Math.max(0.08, sonarA);
        eobj.group.visible = true;

        let jx = 0, jy = 0, jz = 0;
        if (eobj.jitterTimer > 0) {
          eobj.jitterTimer -= dt;
          const jStr = (eobj.jitterTimer / 500) * 0.18 * WS;
          jx = (Math.random() - 0.5) * jStr;
          jy = (Math.random() - 0.5) * jStr * 0.5;
          jz = (Math.random() - 0.5) * jStr;
          if (eobj.jitterTimer <= 0) {
            for (const m of eobj.mats) m.color.set(0x00FFFF);
          }
        }
        eobj.group.position.set(e.x * WS + jx, EYE_H * 0.5 + jy, e.y * WS + jz);
        eobj.group.rotation.y += 0.012;

        if (eobj.jitterTimer > 0) {
          const flashPulse = 0.7 + Math.sin(Date.now() / 40) * 0.3;
          for (const mat of eobj.mats) mat.opacity = flashPulse;
        } else {
          for (const mat of eobj.mats) mat.opacity = a * (0.7 + Math.random() * 0.3);
        }
        eobj.labelMat.opacity = sonarA * (0.65 + Math.sin(Date.now() / 180) * 0.35);
        eobj.group.traverse((child) => {
          if ((child as THREE.PointLight).isPointLight) {
            (child as THREE.PointLight).intensity = 0.3 + sonarA * 2.8;
          }
        });

        // Bioluminescent pulse — state-driven rate for leviathans, fixed for others
        const bioMats = eobj.group.userData.bioMats as THREE.MeshBasicMaterial[] | undefined;
        if (bioMats) {
          let pulseHz: number, pulseMin: number, pulseRange: number;
          if (e.type === "leviathan") {
            if (e.state === "attacking") {
              // Full intensity flash on impact
              pulseHz = 1000 / 55; pulseMin = 0.85; pulseRange = 0.15;
            } else if (e.state === "hunt") {
              // Rapid near-blinding
              pulseHz = 1000 / 80; pulseMin = 0.60; pulseRange = 0.40;
            } else if (e.state === "alert") {
              // Medium/brighter
              pulseHz = 1000 / 200; pulseMin = 0.45; pulseRange = 0.45;
            } else {
              // Patrol: slow dim heartbeat
              pulseHz = 1000 / 500; pulseMin = 0.22; pulseRange = 0.38;
            }
          } else {
            pulseHz = 1000 / 280; pulseMin = 0.35; pulseRange = 0.55;
          }
          const pulse = 0.5 + 0.5 * Math.sin(Date.now() * pulseHz * Math.PI / 500);
          const alpha = pulseMin + pulse * pulseRange;
          for (const m of bioMats) m.opacity = Math.min(1, alpha + sonarA * 0.4);
        }
      }
    }
  }

  // ── Leviathan 4-state AI ──────────────────────────────────────────────────
  private _updateLeviathanAI(e: Enemy, dt: number, dtS: number, dist: number, playerIsSlow: boolean) {
    const hearingDist = e.hearingDist ?? 900;
    if (e.attackCooldown === undefined) e.attackCooldown = 0;
    if (e.lostSignalTimer === undefined) e.lostSignalTimer = 0;
    if (e.alertTimer === undefined) e.alertTimer = 0;
    if (e.proximityVolume === undefined) e.proximityVolume = 0;
    if (e.roarTimer === undefined) e.roarTimer = 14000;

    if (e.attackCooldown > 0) e.attackCooldown -= dt;

    switch (e.state) {
      case "patrol": {
        // Listen for any sound event in hearing range
        for (const se of this.soundEvents) {
          if (Math.hypot(se.x - e.x, se.y - e.y) <= se.radius) {
            if (se.type === "flare") {
              e.lastSoundOrigin = { x: se.x, y: se.y };
            } else {
              e.lastSoundOrigin = { x: se.x, y: se.y };
            }
            e.state = "alert";
            e.alertTimer = LEV_ALERT_TIMEOUT;
            if (this.audioReady) this.audio.leviathanDetectionScreech();
            break;
          }
        }
        if (e.state !== "patrol") break;
        // Roar rarely while on patrol
        e.roarTimer -= dt;
        if (e.roarTimer <= 0) {
          e.roarTimer = 14000 + Math.random() * 4000;
          if (this.audioReady) this.audio.leviathanRoar(1);
        }
        // Move along patrol waypoints
        const wp = e.waypoints[e.wpIdx];
        const edx = wp.x - e.x, edy = wp.y - e.y, ed = Math.hypot(edx, edy);
        if (ed > 8) {
          e.x += (edx / ed) * e.speed * LEV_SPD_PATROL * dtS;
          e.y += (edy / ed) * e.speed * LEV_SPD_PATROL * dtS;
        } else {
          e.wpIdx = (e.wpIdx + 1) % e.waypoints.length;
        }
        break;
      }

      case "alert": {
        // Roar occasionally in alert state
        e.roarTimer -= dt;
        if (e.roarTimer <= 0) {
          e.roarTimer = 7000 + Math.random() * 2500;
          if (this.audioReady) this.audio.leviathanRoar(1);
        }
        // Check for new sound events to re-trigger or redirect
        for (const se of this.soundEvents) {
          if (Math.hypot(se.x - e.x, se.y - e.y) <= se.radius) {
            e.lastSoundOrigin = { x: se.x, y: se.y };
            e.alertTimer = LEV_ALERT_TIMEOUT;
            break;
          }
        }
        // Move toward last heard sound origin
        const origin = e.lastSoundOrigin ?? e.waypoints[e.wpIdx];
        const odx = origin.x - e.x, ody = origin.y - e.y, od = Math.hypot(odx, ody);
        const arrivedAtOrigin = od <= 22;
        if (!arrivedAtOrigin) {
          e.x += (odx / od) * e.speed * LEV_SPD_ALERT * dtS;
          e.y += (ody / od) * e.speed * LEV_SPD_ALERT * dtS;
        }
        // Escalate to Hunt: player is within hearing range AND either a loud discrete
        // sound event was just heard (primary, event-driven) or global noise is very
        // high as a fallback for ambient accumulation (>= 72, stricter than old 48)
        const heardLoudSignal = this.soundEvents.some(se =>
          se.type !== "flare" && Math.hypot(se.x - e.x, se.y - e.y) <= se.radius
        );
        if (dist < hearingDist && (heardLoudSignal || this.noise >= 72)) {
          e.state = "hunt";
          e.lostSignalTimer = 0;
          if (this.audioReady) this.audio.leviathanRoar(2);
          break;
        }
        // Alert timer countdown — only starts once Leviathan arrives at the sound origin
        if (arrivedAtOrigin) {
          e.alertTimer -= dt;
          if (e.alertTimer <= 0) {
            e.state = "patrol";
            e.lastSoundOrigin = undefined;
          }
        }
        break;
      }

      case "hunt": {
        // Roar frequently during hunt
        e.roarTimer -= dt;
        if (e.roarTimer <= 0) {
          e.roarTimer = 3500 + Math.random() * 1200;
          if (this.audioReady) this.audio.leviathanRoar(2);
        }
        // Flare event immediately breaks Hunt → Alert toward flare
        for (const se of this.soundEvents) {
          if (se.type !== "flare") continue;
          if (Math.hypot(se.x - e.x, se.y - e.y) <= se.radius) {
            e.lastSoundOrigin = { x: se.x, y: se.y };
            e.state = "alert";
            e.alertTimer = LEV_ALERT_TIMEOUT;
            e.lostSignalTimer = 0;
            this.showSub("[ LEVIATHAN REDIRECTED — FLARE DEPLOYED ]", 2500);
            break;
          }
        }
        if (e.state !== "hunt") break;

        // Lost-signal timer: accumulate while player moves slowly
        if (playerIsSlow) {
          e.lostSignalTimer += dt;
          if (e.lostSignalTimer >= LEV_HUNT_LOSS_TIME) {
            e.state = "patrol";
            e.lostSignalTimer = 0;
            e.lastSoundOrigin = undefined;
            this.showSub("[ LEVIATHAN LOST SIGNAL — YOU SURVIVED ]", 3000);
            this.shakeTimer = 400;
            this.shakeDuration = 400;
            this.shakeIntensity = 0.03;
            if (this.audioReady) this.audio.leviathanRetreat();
            break;
          }
        } else {
          e.lostSignalTimer = Math.max(0, (e.lostSignalTimer ?? 0) - dt * 0.5);
        }

        // Obstacle occlusion: wide obstacle between creature and player → brief re-alert
        if (this._leviathanOccluded(e)) {
          e.state = "alert";
          e.lastSoundOrigin = { x: this.px, y: this.py };
          e.alertTimer = LEV_ALERT_TIMEOUT * 0.45;
          break;
        }

        // Speed ramps up as distance closes
        const closeFrac = Math.max(0, 1 - (dist - e.hitR) / (LEV_HUNT_CLOSE_DIST - e.hitR));
        const huntSpdMult = LEV_SPD_HUNT + (LEV_SPD_HUNT_CLOSE - LEV_SPD_HUNT) * closeFrac;
        const hdx = this.px - e.x, hdy = this.py - e.y, hd = Math.hypot(hdx, hdy);
        if (hd > e.hitR) {
          e.x += (hdx / hd) * e.speed * huntSpdMult * dtS;
          e.y += (hdy / hd) * e.speed * huntSpdMult * dtS;
        }
        // Trigger Attack when in ram range
        if (dist < LEV_ATTACK_DIST && e.attackCooldown <= 0) {
          e.state = "attacking";
        }
        break;
      }

      case "attacking": {
        // Apply hull & O2 damage once per attack (guarded by invTimer)
        if (this.invTimer <= 0) {
          this.hullIntegrity = Math.max(0, this.hullIntegrity - LEV_ATTACK_HULL_DMG);
          this.o2 = Math.max(0, this.o2 - LEV_ATTACK_O2_DMG);
          this.invTimer = 2200;
          this.glitchTimer = 900;
          this.gaugeVelocity.hull -= 75;
          this.gaugeVelocity.o2   -= 40;
          this.hullBezelFlash = 700;
          this._emergencyLightTimer = Math.max(this._emergencyLightTimer, 2000);
          this._hullWhiteFlash = 1;
          this.shakeTimer = 520;
          this.shakeDuration = 520;
          this.shakeIntensity = 0.13;
          if (this.audioReady) this.audio.leviathanAttackBurst();
          this.showSub("[ LEVIATHAN IMPACT — HULL BREACHED ]", 2500);
          // Push leviathan back away from player
          const pushD = Math.hypot(e.x - this.px, e.y - this.py);
          if (pushD > 1) {
            e.x += ((e.x - this.px) / pushD) * LEV_ATTACK_PUSHBACK;
            e.y += ((e.y - this.py) / pushD) * LEV_ATTACK_PUSHBACK;
          } else {
            e.x += LEV_ATTACK_PUSHBACK;
          }
        }
        e.attackCooldown = LEV_ATTACK_COOLDOWN;
        // Immediately return to Hunt — Leviathan is relentless
        e.state = "hunt";
        break;
      }
    }
  }

  // Returns true if any large obstacle blocks the direct line between leviathan and player
  private _leviathanOccluded(e: Enemy): boolean {
    if (!this.lvlDef) return false;
    for (const o of this.lvlDef.obstacles) {
      if (o.w < LEV_OCCLUDER_MIN && o.h < LEV_OCCLUDER_MIN) continue;
      if (this._segIntersectsRect(e.x, e.y, this.px, this.py, o)) return true;
    }
    return false;
  }

  // Liang-Barsky segment-rectangle intersection (returns true if they intersect)
  private _segIntersectsRect(x1: number, y1: number, x2: number, y2: number, r: Rect): boolean {
    const dx = x2 - x1, dy = y2 - y1;
    const xmin = r.x, xmax = r.x + r.w, ymin = r.y, ymax = r.y + r.h;
    let tmin = 0, tmax = 1;
    const pairs: [number, number][] = [[-dx, x1 - xmin], [dx, xmax - x1], [-dy, y1 - ymin], [dy, ymax - y1]];
    for (const [p, q] of pairs) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > tmax) return false; tmin = Math.max(tmin, t); }
      else { if (t < tmin) return false; tmax = Math.min(tmax, t); }
    }
    return tmin <= tmax;
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
          const dur = p.type === "large" ? 12000 : 9000;
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
            // Enemy fade: 5 s vis timer — long enough to plan an avoidance route
            e.visTimer = 5000;
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
          pod.revealTimer = p.type === "small" ? 10000 : 14000;
          if (pi < this.podObjs.length) this.podObjs[pi].group.visible = true;
        }
      }

      // ── Noise objects ──
      for (let ni = 0; ni < this.noiseObjs.length; ni++) {
        const o = this.noiseObjs[ni];
        if (o.silenced) continue;
        const od = Math.hypot(o.x - p.x, o.y - p.y);
        if (od >= inner - 18 && od <= outer + 18) o.revealTimer = 9000;
      }

      // ── Level 3: large ping can collapse nearby unstable buildings ──────────
      if (this.lvlIdx === 2 && p.type === "large") {
        for (const ub of this.unstableBuildings) {
          if (ub.collapsed) continue;
          const bd = Math.hypot(ub.cx - p.x, ub.cy - p.y);
          if (bd >= inner - 80 && bd <= outer + 80) {
            this.triggerBuildingCollapse(ub);
          }
        }
      }

      // ── Level 3: spawn 1–2 offset ghost echo rings on each ping ──────────────
      // Ghosts originate at plausible dead-end offsets, NOT at the player ping origin.
      // They are visually distinct (dimmer, slower) and decay quickly to deceive enemies.
      // ghostSpawned flag ensures exactly one ghost batch per ping, not per frame.
      // Only player-initiated pings (small/large) spawn ghost echoes — flare pings are excluded
      if (this.lvlIdx === 2 && (p.type === "small" || p.type === "large") && p.radius < p.maxRadius * 0.18 && !p.ghostSpawned) {
        p.ghostSpawned = true;
        // L3 Drowned Metropolis dead-end nodes: vetted positions at corridor termini,
        // flooded plazas and collapsed alcoves — ghost echoes are biased 70% toward
        // these so they plausibly suggest alternate routes rather than open water.
        const L3_DEAD_ENDS = [
          { x: 3420, y: 2200 }, // flooded south plaza (right district)
          { x:  380, y: 1820 }, // collapsed left alley
          { x: 1900, y:  320 }, // sunken station entrance (north)
          { x: 3150, y:  410 }, // upper-right substation
          { x: 1820, y: 2120 }, // central market dead-end
          { x:  750, y:  880 }, // conduit alcove (Conduit 0 recess)
          { x: 2100, y: 1500 }, // conduit alcove (Conduit 1 recess — mid district)
        ];
        const count = 1 + (Math.random() < 0.45 ? 1 : 0);
        for (let gi = 0; gi < count; gi++) {
          // 70% bias toward a dead-end node, 30% fully random direction
          let angle: number;
          if (Math.random() < 0.70) {
            const node = L3_DEAD_ENDS[Math.floor(Math.random() * L3_DEAD_ENDS.length)];
            angle = Math.atan2(node.y - p.y, node.x - p.x) + (Math.random() - 0.5) * 0.6;
          } else {
            angle = Math.random() * Math.PI * 2;
          }
          const offsetDist = (180 + Math.random() * 180);
          const ox = p.x + Math.cos(angle) * offsetDist;
          const oy = p.y + Math.sin(angle) * offsetDist;
          const ghostGeo = new THREE.SphereGeometry(0.5, 10, 7);
          const ghostMat = new THREE.MeshBasicMaterial({
            color: 0xAABBEE, wireframe: true, transparent: true,
            opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false,
          });
          const ghostSphere = new THREE.Mesh(ghostGeo, ghostMat);
          ghostSphere.position.set(ox * WS, EYE_H, oy * WS);
          this.sceneGroup.add(ghostSphere);  // sceneGroup cleared on level load
          // Fast decay: 1800ms life, smaller max radius than real pings
          const ghostMaxR = p.maxRadius * (0.45 + Math.random() * 0.25);
          this.ghostEchoes.push({ sphere: ghostSphere, mat: ghostMat, radius: 0, maxR: ghostMaxR, life: 1800 });
        }
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
        // Re-emit flare sound event from flare's current drifting position each ping cycle
        // so Leviathan continuously updates its redirect target as the flare moves
        this.soundEvents.push({ type: "flare", x: f.x, y: f.y, radius: LEV_HEAR_FLARE });
      }
      if (f.timer <= 0) this.flareObjs.splice(i, 1);
    }
  }

  private updateNoise(dt: number) {
    this.noise = Math.max(0, this.noise - NOISE_DECAY * (dt / 1000));
    for (const o of this.noiseObjs) if (!o.silenced) this.noise = Math.min(100, this.noise + o.noiseRate * (dt / 1000));
    // Record sound-event magnitudes into the Sonic Bloom rolling buffer (L1 only)
    this._recordBloomEvents();
    // Sound events are consumed once per frame by the leviathan AI — clear after each tick
    this.soundEvents = [];
  }

  private updateO2(dt: number) {
    const boosting = this.keys["ShiftLeft"] || this.keys["ShiftRight"];
    const mv = Object.keys(this.keys).some(k => this.keys[k] && ["KeyW","KeyS","KeyA","KeyD","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(k));
    const drain = (boosting && mv) ? O2_DRAIN_BOOST : O2_DRAIN_NORMAL;
    this.o2 = Math.max(0, this.o2 - drain * (dt / 1000));
    if (this.o2 < 20) { this.alarmTimer -= dt; if (this.alarmTimer <= 0) { this.alarmTimer = 2200; this.audio.alarm(); } }
    if (this.audioReady) this.audio.setBreathingO2(this.o2);
    if (this.o2 <= 0 && !this.transitioning) this.triggerGameOver();
  }

  private updateCamera(dt: number) {
    const k = 5 * (dt / 1000);
    this.camX += (this.px - this.camX) * k;
    this.camY += (this.py - this.camY) * k;
  }

  private updateInteractables() {
    this.nearPod = null; this.nearNoise = null; this.nearConduit = null;
    if (!this.lvlDef) return;
    for (const p of this.pods) {
      if (!p.rescued && Math.hypot(p.x - this.px, p.y - this.py) < INTERACT_RADIUS) { this.nearPod = p; return; }
    }
    for (const o of this.noiseObjs) {
      if (!o.silenced && Math.hypot(o.x - this.px, o.y - this.py) < INTERACT_RADIUS) { this.nearNoise = o; return; }
    }
    for (const c of this.powerConduits) {
      if (!c.activated && Math.hypot(c.x - this.px, c.y - this.py) < INTERACT_RADIUS) { this.nearConduit = c; return; }
    }
  }

  private updateLeviathan(dt: number) {
    // Sonar disruption pulse (level 2 only — the drifting ghost encounter)
    if (this.lvlIdx === 2) {
      this.levPulseTimer -= dt;
      if (this.levPulseTimer <= 0) {
        this.levPulseTimer = 8000; this.levBlocked = true; this.glitchTimer = 550;
        setTimeout(() => { this.levBlocked = false; }, 1100);
        if (this.audioReady) this.audio.leviathanPulse();
        this.showSub("[ LEVIATHAN PULSE — SONAR DISRUPTED ]");
      }
    }
    // Proximity audio: closest hunting/attacking leviathan drives the breath node volume
    // Alert audio layer: activate when any leviathan is investigating
    if (this.audioReady) {
      let minHuntDist = Infinity;
      let hasAlert = false;
      for (const e of this.enemies) {
        if (e.type !== "leviathan") continue;
        if (e.state === "hunt" || e.state === "attacking") {
          const d = Math.hypot(e.x - this.px, e.y - this.py);
          if (d < minHuntDist) minHuntDist = d;
        }
        if (e.state === "alert") hasAlert = true;
      }
      const proxVol = minHuntDist === Infinity ? 0 : Math.max(0, 1 - minHuntDist / LEV_PROX_MAX_DIST);
      this.audio.setLeviathanProxVolume(proxVol);
      // Alert layer: at medium volume when investigating, fade out when patrol/hunt
      this.audio.setLeviathanAlertVolume(hasAlert && minHuntDist === Infinity ? 0.45 : 0);
    }
  }

  private updateSonarShader() {
    if (!this.sonarOverlayMat) return;
    const u       = this.sonarOverlayMat.uniforms;
    const origins = u.uPingOrigin.value  as THREE.Vector3[];
    const radii   = u.uPingRadius.value  as number[];
    const ops     = u.uPingOpacity.value as number[];
    const colors  = u.uPingColor.value   as THREE.Vector3[];
    // Per-level base sonar colour (small/large pings)
    // L1 Abyssal Forest → blue-green; L2 Iron Graveyard → amber-rust; L3 Drowned Metropolis → grey-white
    type RGB = [number, number, number];
    const levelBaseSmall: RGB[] = [[0.04, 0.95, 0.75], [0.90, 0.52, 0.05], [0.72, 0.82, 0.90]];
    const levelBaseLarge: RGB[] = [[0.12, 1.00, 0.80], [1.00, 0.62, 0.08], [0.88, 0.94, 1.00]];
    const bs = levelBaseSmall[this.lvlIdx] ?? levelBaseSmall[0];
    const bl = levelBaseLarge[this.lvlIdx] ?? levelBaseLarge[0];
    for (let i = 0; i < 5; i++) {
      if (i < this.pings.length) {
        const p = this.pings[i];
        origins[i].set(p.x * WS, EYE_H, p.y * WS);
        radii[i] = p.radius * WS;
        ops[i]   = Math.max(0, 1.0 - Math.pow(p.radius / p.maxRadius, 5.0));
        if (p.type === "flare")       colors[i].set(1.0, 0.55, 0.0);
        else if (p.type === "large")  colors[i].set(bl[0], bl[1], bl[2]);
        else if (p.type === "boost")  colors[i].set(0.45, 0.45, 0.45);
        else                          colors[i].set(bs[0], bs[1], bs[2]);
      } else {
        origins[i].set(0, 0, 0);
        radii[i] = -1;
        ops[i]   = 0;
        colors[i].set(bs[0], bs[1], bs[2]);
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
    this.sonarCharge = Math.min(100, this.sonarCharge + this.sonarChargeRate * dtS);
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
    // Emergency lighting ticks down (set directly at hull-damage sites)
    if (this._emergencyLightTimer > 0) this._emergencyLightTimer = Math.max(0, this._emergencyLightTimer - dt);
    // _hullWhiteFlash is a single-frame latch; it is cleared by renderPortholeFrame each render pass.
    // VU peak-hold: instant rise, slow decay (20 units/s)
    if (this.noise > this._vuPeakNoise) this._vuPeakNoise = this.noise;
    else this._vuPeakNoise = Math.max(0, this._vuPeakNoise - 20 * dtS);

    // O2 critical pulse phase accumulator (1.4 Hz when below threshold)
    if (this.o2 < 20) {
      this.o2BezelPhase += dtS * Math.PI * 2 * 1.4;
    } else {
      // Decay phase back to zero so it restarts cleanly next time
      this.o2BezelPhase = 0;
    }

    // Dashboard flicker: any hunting/attacking leviathan jitters gauge needles
    const hasHuntingLev   = this.enemies.some(e => e.type === "leviathan" && e.state === "hunt");
    const hasAttackingLev = this.enemies.some(e => e.type === "leviathan" && e.state === "attacking");
    if (hasHuntingLev || hasAttackingLev) {
      const flickerAmt = hasAttackingLev ? 5.2 : 2.0;
      for (const k of Object.keys(this.gaugeVelocity) as Array<keyof typeof this.gaugeVelocity>) {
        this.gaugeVelocity[k] += (Math.random() - 0.5) * flickerAmt;
      }
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

  // ============================================================
  // SUBMARINE CONTROL PANEL (replaces analog dashboard)
  // ============================================================
  private renderControlPanel() {
    const ctx  = this.hudCtx;
    const PY   = PANEL_Y;                   // panel top Y = 500
    const PH   = GAME_H - PY;               // panel height = 220
    const now  = performance.now() / 1000;

    // ══════════════════════════════════════════════════════════════════════════
    // PANEL BASE — brushed steel gradient with inset panel sections
    // ══════════════════════════════════════════════════════════════════════════
    const baseGrad = ctx.createLinearGradient(0, PY, 0, GAME_H);
    baseGrad.addColorStop(0,    '#1a1d16');
    baseGrad.addColorStop(0.25, '#141710');
    baseGrad.addColorStop(0.65, '#0f120c');
    baseGrad.addColorStop(1,    '#090b08');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, PY, GAME_W, PH);

    // Panel top edge highlight
    ctx.strokeStyle = 'rgba(55,65,45,0.60)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, PY); ctx.lineTo(GAME_W, PY); ctx.stroke();

    // Metal grain lines (subtle horizontal)
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${(0.005 + i * 0.001).toFixed(3)})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, PY + 12 + i * 26);
      ctx.lineTo(GAME_W, PY + 12 + i * 26);
      ctx.stroke();
    }

    // Panel scratches
    const scrDefs: [number,number,number,number][] = [
      [55,8,185,20],[340,14,460,6],[725,18,860,10],[1060,12,1180,4],[1220,16,1270,24],
    ];
    ctx.lineWidth = 0.8;
    for (const [x1,y1,x2,y2] of scrDefs) {
      ctx.strokeStyle = 'rgba(255,255,255,0.015)';
      ctx.beginPath(); ctx.moveTo(x1, PY+y1); ctx.lineTo(x2, PY+y2); ctx.stroke();
    }

    // Rivets along top edge
    const rivetY = PY + 6;
    for (let rx = 30; rx < GAME_W - 25; rx += 55) {
      const rg = ctx.createRadialGradient(rx-1, rivetY-1, 0, rx, rivetY, 4);
      rg.addColorStop(0,   'rgba(120,130,100,0.80)');
      rg.addColorStop(0.5, 'rgba(45,50,35,0.55)');
      rg.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(rx, rivetY, 3.5, 0, Math.PI*2); ctx.fill();
    }

    // Section dividers (left at x=370, right at x=880)
    for (const dx of [370, 880]) {
      const divG = ctx.createLinearGradient(dx, PY, dx, GAME_H);
      divG.addColorStop(0, 'rgba(70,80,55,0.50)');
      divG.addColorStop(0.3, 'rgba(35,42,25,0.40)');
      divG.addColorStop(1, 'rgba(18,22,12,0.30)');
      ctx.strokeStyle = divG; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(dx, PY+6); ctx.lineTo(dx, GAME_H-6); ctx.stroke();
    }

    // Inset shadows for section panels
    for (const [sx, sw] of [[0, 370], [370, 510], [880, 400]] as [number,number][]) {
      const insetG = ctx.createLinearGradient(sx, PY, sx+sw, PY+PH);
      insetG.addColorStop(0, 'rgba(0,0,0,0.12)');
      insetG.addColorStop(0.08, 'rgba(0,0,0,0)');
      insetG.addColorStop(0.92, 'rgba(0,0,0,0)');
      insetG.addColorStop(1, 'rgba(0,0,0,0.08)');
      ctx.fillStyle = insetG;
      ctx.fillRect(sx, PY, sw, PH);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LEFT CLUSTER  (x: 0–370)
    // Depth Gauge | O2 Pressure Gauge | Hull LED Bar | Warning Lights
    // ══════════════════════════════════════════════════════════════════════════

    // ─────────────────────────────────────────────────────────────────────────
    // DEPTH GAUGE — large analog clock-face dial, center (105, 582), r=60
    // ─────────────────────────────────────────────────────────────────────────
    {
      const DCX = 108, DCY = 582, DR = 58;
      const depth = this.gaugeDisplay.depth;
      // Spec: 0–11,000 m oceanic scale face; actual gameplay depth 20-97 m.
      // Non-linear power mapping (exponent 0.30) stretches the low-depth range so
      // gameplay movement (20–97 m) occupies ~19–35% of the dial arc for readability.
      const depthF = Math.max(0, Math.min(1, Math.pow(depth / 11000, 0.30)));
      const SA = Math.PI * 0.78, SW = Math.PI * 1.44; // 259° sweep, bottom-left to bottom-right

      // Ambient glow
      const dGlowG = ctx.createRadialGradient(DCX, DCY, DR*0.5, DCX, DCY, DR*2.2);
      dGlowG.addColorStop(0, 'rgba(0,140,200,0.06)');
      dGlowG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dGlowG; ctx.beginPath(); ctx.arc(DCX, DCY, DR*2.2, 0, Math.PI*2); ctx.fill();

      // Silver bezel (thick ring)
      const bezG = ctx.createLinearGradient(DCX-DR, DCY-DR, DCX+DR, DCY+DR);
      bezG.addColorStop(0, '#4a4e42');
      bezG.addColorStop(0.35, '#3a3d30');
      bezG.addColorStop(0.65, '#2a2d22');
      bezG.addColorStop(1, '#1e2018');
      ctx.fillStyle = bezG;
      ctx.beginPath(); ctx.arc(DCX, DCY, DR+9, 0, Math.PI*2); ctx.fill();
      // Bezel specular
      ctx.strokeStyle = 'rgba(90,100,75,0.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(DCX, DCY, DR+8, -Math.PI*0.8, Math.PI*0.2); ctx.stroke();
      ctx.strokeStyle = 'rgba(12,14,10,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(DCX, DCY, DR+8, Math.PI*0.2, Math.PI*1.2); ctx.stroke();

      // Dark glass face
      const faceG = ctx.createRadialGradient(DCX-DR*0.3, DCY-DR*0.3, 0, DCX, DCY, DR);
      faceG.addColorStop(0, '#141810');
      faceG.addColorStop(0.7, '#0e1209');
      faceG.addColorStop(1, '#080a06');
      ctx.fillStyle = faceG; ctx.beginPath(); ctx.arc(DCX, DCY, DR, 0, Math.PI*2); ctx.fill();

      // Clipped dial content
      ctx.save(); ctx.beginPath(); ctx.arc(DCX, DCY, DR-1, 0, Math.PI*2); ctx.clip();

      // Tick marks — 0 to 11,000 m oceanic scale
      for (let t = 0; t <= 10; t++) {
        const ta = SA + (t/10) * SW;
        const major = (t % 5 === 0);
        ctx.strokeStyle = major ? 'rgba(180,195,155,0.85)' : 'rgba(100,115,80,0.50)';
        ctx.lineWidth = major ? 1.5 : 0.8;
        const inner = DR - (major ? 12 : 7);
        ctx.beginPath();
        ctx.moveTo(DCX + Math.cos(ta)*(DR-3), DCY + Math.sin(ta)*(DR-3));
        ctx.lineTo(DCX + Math.cos(ta)*inner, DCY + Math.sin(ta)*inner);
        ctx.stroke();
        if (major) {
          // Labels: 0, 2.5k, 5k, 7.5k, 10k, 11k at t=0,2,4,6,8,10
          const lbl = ['0','','2.5k','','5k','','7.5k','','10k','','11k'][t] ?? '';
          if (lbl) {
            ctx.fillStyle = 'rgba(140,155,115,0.65)'; ctx.font = '5px monospace'; ctx.textAlign = 'center';
            const lr = DR - 18;
            ctx.fillText(lbl, DCX + Math.cos(ta)*lr, DCY + Math.sin(ta)*lr + 2);
          }
        }
      }

      // Needle — spring-animated
      {
        const needleA = SA + depthF * SW;
        ctx.translate(DCX, DCY); ctx.rotate(needleA);
        // Shadow
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(1, 6); ctx.lineTo(1, -(DR-15)); ctx.stroke();
        // Needle body
        ctx.fillStyle = '#b8c890';
        ctx.shadowColor = 'rgba(180,200,140,0.4)'; ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.moveTo(-1.8, 7); ctx.lineTo(1.8, 7);
        ctx.lineTo(0.6, -(DR-14)); ctx.lineTo(-0.6, -(DR-14));
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore(); ctx.save(); ctx.beginPath(); ctx.arc(DCX, DCY, DR-1, 0, Math.PI*2); ctx.clip();
      }

      // Centre hub
      const hubG = ctx.createRadialGradient(DCX-2, DCY-2, 0, DCX, DCY, 7);
      hubG.addColorStop(0, '#5a5e4a'); hubG.addColorStop(1, '#1e2018');
      ctx.fillStyle = hubG; ctx.beginPath(); ctx.arc(DCX, DCY, 7, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = 'rgba(80,90,65,0.5)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(DCX, DCY, 7, 0, Math.PI*2); ctx.stroke();

      ctx.restore();

      // Label plate below dial
      ctx.fillStyle = 'rgba(25,30,18,0.75)'; ctx.beginPath(); ctx.roundRect(DCX-28, DCY+DR+4, 56, 15, 2); ctx.fill();
      ctx.fillStyle = 'rgba(160,180,130,0.75)'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
      ctx.fillText('DEPTH', DCX, DCY+DR+14);
      ctx.fillStyle = 'rgba(120,135,95,0.55)'; ctx.font = '6px monospace';
      ctx.fillText(`${depth.toFixed(0)}m`, DCX, DCY+DR+24);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // O2 PRESSURE GAUGE — smaller analog dial, center (240, 587), r=44
    // ─────────────────────────────────────────────────────────────────────────
    {
      const OCX = 243, OCY = 584, OR = 44;
      const o2F = Math.max(0, Math.min(1, this.gaugeDisplay.o2 / 100));
      const o2PulseA = this.o2 < 20 ? (0.7 + 0.3 * Math.sin(this.o2BezelPhase)) : 1;
      const o2Col = this.o2 > 50 ? '#30c848' : this.o2 > 20 ? '#e8a820' : '#ff3030';
      const o2GlowCol = this.o2 > 50 ? '#00ff60' : this.o2 > 20 ? '#ffb020' : '#ff2020';
      const SA = Math.PI * 0.78, SW = Math.PI * 1.44;

      // Glow
      if (this.o2 < 20) {
        ctx.shadowColor = o2GlowCol;
        ctx.shadowBlur = 12 + 6 * Math.sin(this.o2BezelPhase);
      }

      // Silver bezel
      const oBezG = ctx.createLinearGradient(OCX-OR, OCY-OR, OCX+OR, OCY+OR);
      oBezG.addColorStop(0, '#4a4e42'); oBezG.addColorStop(0.5, '#2e3228'); oBezG.addColorStop(1, '#1a1e14');
      ctx.fillStyle = oBezG; ctx.shadowBlur = ctx.shadowBlur; // keep glow
      ctx.beginPath(); ctx.arc(OCX, OCY, OR+7, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(80,90,65,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(OCX, OCY, OR+6, -Math.PI*0.8, Math.PI*0.2); ctx.stroke();

      // Face
      const oFaceG = ctx.createRadialGradient(OCX-OR*0.3, OCY-OR*0.3, 0, OCX, OCY, OR);
      const o2FaceLight = this.o2 > 50 ? '#0e1a0a' : this.o2 > 20 ? '#1a1506' : '#1a0808';
      const o2FaceDark  = this.o2 > 50 ? '#080e06' : this.o2 > 20 ? '#0f0e04' : '#0f0404';
      oFaceG.addColorStop(0, o2FaceLight); oFaceG.addColorStop(1, o2FaceDark);
      ctx.fillStyle = oFaceG; ctx.beginPath(); ctx.arc(OCX, OCY, OR, 0, Math.PI*2); ctx.fill();

      ctx.save(); ctx.beginPath(); ctx.arc(OCX, OCY, OR-1, 0, Math.PI*2); ctx.clip();
      ctx.globalAlpha = o2PulseA;

      // Arc track
      ctx.strokeStyle = 'rgba(30,40,25,0.40)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(OCX, OCY, OR-10, SA, SA+SW); ctx.stroke();
      if (o2F > 0.01) {
        ctx.strokeStyle = o2Col; ctx.shadowColor = o2GlowCol; ctx.shadowBlur = 6;
        ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(OCX, OCY, OR-10, SA, SA + o2F * SW); ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Tick marks
      for (let t = 0; t <= 4; t++) {
        const ta = SA + (t/4) * SW;
        ctx.strokeStyle = 'rgba(150,165,120,0.65)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(OCX + Math.cos(ta)*(OR-2), OCY + Math.sin(ta)*(OR-2));
        ctx.lineTo(OCX + Math.cos(ta)*(OR-8), OCY + Math.sin(ta)*(OR-8));
        ctx.stroke();
      }

      // Needle — save/restore so hub below is drawn in world space
      {
        const needleA = SA + o2F * SW;
        ctx.save();
        ctx.translate(OCX, OCY); ctx.rotate(needleA);
        ctx.fillStyle = o2Col;
        ctx.shadowColor = o2GlowCol; ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.moveTo(-1.5, 6); ctx.lineTo(1.5, 6);
        ctx.lineTo(0.5, -(OR-12)); ctx.lineTo(-0.5, -(OR-12));
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      ctx.globalAlpha = 1;
      const oHubG = ctx.createRadialGradient(OCX-2, OCY-2, 0, OCX, OCY, 5);
      oHubG.addColorStop(0, '#505545'); oHubG.addColorStop(1, '#1a1d14');
      ctx.fillStyle = oHubG; ctx.beginPath(); ctx.arc(OCX, OCY, 5, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      // Label plate
      ctx.fillStyle = 'rgba(25,30,18,0.75)'; ctx.beginPath(); ctx.roundRect(OCX-26, OCY+OR+4, 52, 15, 2); ctx.fill();
      ctx.fillStyle = o2Col; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
      ctx.fillText('O\u2082 PRESS', OCX, OCY+OR+14);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HULL INTEGRITY LED BAR — 10 vertical segments, x=320-334, y=508-692
    // ─────────────────────────────────────────────────────────────────────────
    {
      const BX = 320, BW = 14, BAR_Y = PY + 8, BAR_H = PH - 40;
      const SEG_COUNT = 10, SEG_H = Math.floor(BAR_H / SEG_COUNT) - 2;
      const hullF = Math.max(0, Math.min(1, this.gaugeDisplay.hull / 100));
      const litCount = Math.round(hullF * SEG_COUNT);

      // Bar housing
      ctx.fillStyle = 'rgba(10,12,8,0.85)'; ctx.beginPath(); ctx.roundRect(BX-2, BAR_Y-2, BW+4, BAR_H+4, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(50,58,38,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(BX-2, BAR_Y-2, BW+4, BAR_H+4, 3); ctx.stroke();

      for (let s = 0; s < SEG_COUNT; s++) {
        const segY = BAR_Y + (SEG_COUNT - 1 - s) * (SEG_H + 2);
        const lit  = s < litCount;
        const frac = s / SEG_COUNT;
        if (lit) {
          const segCol = frac < 0.3 ? '#22cc44' : frac < 0.7 ? '#44cc22' : '#88dd22';
          const segGlow = frac < 0.3 ? '#00ff44' : frac < 0.7 ? '#44ff22' : '#88ff22';
          ctx.fillStyle = segCol;
          ctx.shadowColor = segGlow; ctx.shadowBlur = 4;
          ctx.beginPath(); ctx.roundRect(BX, segY, BW, SEG_H, 1); ctx.fill();
          ctx.shadowBlur = 0;
          // Specular
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.beginPath(); ctx.roundRect(BX, segY, BW, 2, 1); ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(12,18,8,0.75)';
          ctx.beginPath(); ctx.roundRect(BX, segY, BW, SEG_H, 1); ctx.fill();
          ctx.strokeStyle = 'rgba(25,35,15,0.40)'; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.roundRect(BX, segY, BW, SEG_H, 1); ctx.stroke();
        }
      }

      // Label
      ctx.fillStyle = 'rgba(80,100,60,0.70)'; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
      ctx.fillText('HULL', BX + BW/2, BAR_Y + BAR_H + 10);
      ctx.fillText('INT', BX + BW/2, BAR_Y + BAR_H + 18);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WARNING LIGHT PANEL — 2×2 indicator bulbs at bottom-left
    // OXYGEN / HULL / NOISE / THREAT
    // ─────────────────────────────────────────────────────────────────────────
    {
      const WX = 18, WY = GAME_H - 40, WBULB = 16, WGAP = 36;
      const warnLabels = ['OXY','HUL','NOI','THR'];
      const warnCrit   = [
        this.o2 < 20,
        this.gaugeDisplay.hull < 25,
        this.noise > 72,
        this.enemies.some(e => e.type === 'leviathan' && (e.state === 'hunt' || e.state === 'attacking')),
      ];
      // Panel background
      ctx.fillStyle = 'rgba(8,10,6,0.80)'; ctx.beginPath(); ctx.roundRect(WX-6, WY-8, 92, 46, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(40,50,28,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(WX-6, WY-8, 92, 46, 3); ctx.stroke();

      for (let wi = 0; wi < 4; wi++) {
        const col = wi % 2, row = Math.floor(wi / 2);
        const bx = WX + col * WGAP, by = WY + row * 22;
        const crit = warnCrit[wi];
        const pulse = crit ? (0.5 + 0.5 * Math.sin(now * Math.PI * 2 * 1.0)) : 0;

        // Lens background
        const lensG = ctx.createRadialGradient(bx-2, by-2, 0, bx, by, WBULB*0.6);
        if (crit) {
          lensG.addColorStop(0, `rgba(255,50,0,${(0.7 + pulse * 0.3).toFixed(2)})`);
          lensG.addColorStop(0.5, `rgba(200,20,0,${(0.5 + pulse * 0.3).toFixed(2)})`);
          lensG.addColorStop(1, 'rgba(60,0,0,0.6)');
          ctx.shadowColor = '#ff2200';
          ctx.shadowBlur = 8 + pulse * 10;
        } else {
          lensG.addColorStop(0, 'rgba(30,40,20,0.60)');
          lensG.addColorStop(1, 'rgba(8,12,4,0.50)');
        }
        ctx.fillStyle = lensG;
        ctx.beginPath(); ctx.arc(bx, by, WBULB*0.6, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;

        // Lens glare highlight
        ctx.fillStyle = crit ? 'rgba(255,200,150,0.30)' : 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.arc(bx-3, by-3, WBULB*0.25, 0, Math.PI*2); ctx.fill();

        // Bezel ring
        ctx.strokeStyle = crit ? `rgba(160,40,0,${0.5 + pulse*0.4})` : 'rgba(40,50,28,0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(bx, by, WBULB*0.6, 0, Math.PI*2); ctx.stroke();

        // Label
        ctx.fillStyle = crit ? `rgba(255,80,40,${0.8+pulse*0.2})` : 'rgba(55,65,40,0.60)';
        ctx.font = 'bold 5px monospace'; ctx.textAlign = 'center';
        ctx.fillText(warnLabels[wi], bx, by + WBULB*0.6 + 7);
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CENTER CLUSTER  (x: 370–880)
    // Sonar CRT | Physical Buttons | Throttle Lever
    // ══════════════════════════════════════════════════════════════════════════

    // ─────────────────────────────────────────────────────────────────────────
    // SONAR CRT — phosphor-green display, center (625, 591), r=82
    // ─────────────────────────────────────────────────────────────────────────
    {
      const RCX = 625, RCY = 591, RR = 82;
      // 4-second revolution per spec: ω = 2π/4 = π/2 rad/s
      const sweep = now * (Math.PI / 2);

      // CRT green glow bleed onto dashboard around the screen
      const crtGlowG = ctx.createRadialGradient(RCX, RCY, RR*0.6, RCX, RCY, RR*2.5);
      crtGlowG.addColorStop(0, 'rgba(0,80,30,0.18)');
      crtGlowG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = crtGlowG; ctx.beginPath(); ctx.arc(RCX, RCY, RR*2.5, 0, Math.PI*2); ctx.fill();

      // Recessed metal bezel (outer ring)
      const crtBezG = ctx.createLinearGradient(RCX-RR, RCY-RR, RCX+RR, RCY+RR);
      crtBezG.addColorStop(0, '#3a3d30'); crtBezG.addColorStop(0.5, '#242820'); crtBezG.addColorStop(1, '#181b12');
      ctx.fillStyle = crtBezG;
      ctx.beginPath(); ctx.arc(RCX, RCY, RR+12, 0, Math.PI*2); ctx.fill();
      // Bezel highlight
      ctx.strokeStyle = 'rgba(75,85,58,0.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(RCX, RCY, RR+11, -Math.PI*0.7, Math.PI*0.3); ctx.stroke();
      ctx.strokeStyle = 'rgba(12,14,10,0.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(RCX, RCY, RR+11, Math.PI*0.3, Math.PI*1.3); ctx.stroke();

      // CRT phosphor face
      const rfGrad = ctx.createRadialGradient(RCX, RCY, 0, RCX, RCY, RR);
      rfGrad.addColorStop(0,   '#001a00');
      rfGrad.addColorStop(0.65, '#001200');
      rfGrad.addColorStop(1,   '#000c00');
      ctx.fillStyle = rfGrad;
      ctx.beginPath(); ctx.arc(RCX, RCY, RR, 0, Math.PI*2); ctx.fill();

      // Clip all sonar content to screen circle
      ctx.save();
      ctx.beginPath(); ctx.arc(RCX, RCY, RR, 0, Math.PI*2); ctx.clip();

      // CRT scan lines (horizontal, scrolling slowly)
      const scanOff = (now * 8) % 4;
      for (let sy = -RR + (scanOff % 4); sy < RR + 4; sy += 4) {
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(RCX-RR, RCY+sy); ctx.lineTo(RCX+RR, RCY+sy); ctx.stroke();
      }

      // Range rings
      for (let ring = 1; ring <= 4; ring++) {
        ctx.strokeStyle = `rgba(0,${140 - ring*20},${50 - ring*8},${(0.18 - ring*0.03).toFixed(2)})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.arc(RCX, RCY, (RR/4)*ring, 0, Math.PI*2); ctx.stroke();
      }
      // Cross-hair
      ctx.strokeStyle = 'rgba(0,120,45,0.12)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(RCX-RR, RCY); ctx.lineTo(RCX+RR, RCY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(RCX, RCY-RR); ctx.lineTo(RCX, RCY+RR); ctx.stroke();

      // Sweep wedge trailing fade (arc with alpha gradient — longer trail)
      const TRAIL_ANG = Math.PI * 0.72; // ~130° trail
      const TRAIL_STEPS = 28;
      for (let fade = 0; fade < TRAIL_STEPS; fade++) {
        const a0 = sweep - (fade/TRAIL_STEPS) * TRAIL_ANG;
        const a1 = sweep - ((fade+1)/TRAIL_STEPS) * TRAIL_ANG;
        const alpha = (1 - fade/TRAIL_STEPS) * 0.22;
        ctx.fillStyle = `rgba(0,255,80,${alpha.toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(RCX, RCY); ctx.arc(RCX, RCY, RR-1, a0, a1, true); ctx.closePath(); ctx.fill();
      }
      // Sweep leading line (bright phosphor green)
      ctx.strokeStyle = 'rgba(0,255,80,0.92)';
      ctx.shadowColor = '#00ff50'; ctx.shadowBlur = 8; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(RCX, RCY);
      ctx.lineTo(RCX + Math.cos(sweep)*(RR-1), RCY + Math.sin(sweep)*(RR-1));
      ctx.stroke(); ctx.shadowBlur = 0;

      // Enemy blips — red (flickering for enemies), green for objects
      const VIEW = 600, rScale = RR / VIEW;
      const sonarActive = this.sonarCharge < 100 || this.sonarSwitchAnim > 0;
      for (const e of this.enemies) {
        if (e.visTimer <= 0) continue;
        if (!sonarActive && e.visTimer < 4800) continue;
        const ex = RCX + (e.x - this.px) * rScale;
        const ey = RCY + (e.y - this.py) * rScale;
        const a  = Math.min(1, e.visTimer / 5000) * 0.95;
        // Enemy blips flicker/distort (red)
        const flicker = 0.7 + Math.random() * 0.3;
        ctx.fillStyle = `rgba(255,${Math.round(30 + Math.random()*40)},20,${(a * flicker).toFixed(2)})`;
        ctx.shadowColor = '#ff2000'; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Object blips — soft phosphor-green for sonar-detectable non-enemy objects
      // Letters (uncollected, within reveal radius) and lifepods (revealed, not rescued)
      for (const letter of this.letterEntities) {
        if (letter.collected || letter.revealAlpha < 0.05) continue;
        const lx = RCX + (letter.x - this.px) * rScale;
        const ly = RCY + (letter.y - this.py) * rScale;
        const a = letter.revealAlpha * 0.85;
        ctx.fillStyle = `rgba(0,230,120,${a.toFixed(2)})`;
        ctx.shadowColor = '#00e878'; ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.arc(lx, ly, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;
      }
      for (const pod of this.pods) {
        if (pod.rescued || pod.revealTimer <= 0) continue;
        const px2 = RCX + (pod.x - this.px) * rScale;
        const py2 = RCY + (pod.y - this.py) * rScale;
        const a = Math.min(1, pod.revealTimer / 5000) * 0.90;
        ctx.fillStyle = `rgba(0,220,180,${a.toFixed(2)})`;
        ctx.shadowColor = '#00dcb4'; ctx.shadowBlur = 7;
        ctx.beginPath(); ctx.arc(px2, py2, 3, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;
        // Small '+' marker (pod cross)
        ctx.strokeStyle = `rgba(0,220,180,${(a * 0.7).toFixed(2)})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(px2-5, py2); ctx.lineTo(px2+5, py2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px2, py2-5); ctx.lineTo(px2, py2+5); ctx.stroke();
      }

      // Player centre dot (bright green)
      ctx.fillStyle = 'rgba(0,255,100,0.92)';
      ctx.shadowColor = '#00ff64'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(RCX, RCY, 3, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;

      // Screen glare overlay (upper-left)
      const glareG = ctx.createRadialGradient(RCX - RR*0.55, RCY - RR*0.60, 0, RCX - RR*0.3, RCY - RR*0.3, RR*0.9);
      glareG.addColorStop(0, 'rgba(255,255,255,0.04)');
      glareG.addColorStop(0.5, 'rgba(200,255,220,0.018)');
      glareG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glareG; ctx.fillRect(RCX-RR, RCY-RR, RR*2, RR*2);

      ctx.restore(); // end sonar clip

      // Inner screen edge shadow
      ctx.strokeStyle = 'rgba(0,10,0,0.65)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(RCX, RCY, RR-1, 0, Math.PI*2); ctx.stroke();

      // Outer bezel ring stroke
      ctx.strokeStyle = 'rgba(0,100,38,0.38)';
      ctx.lineWidth = 2; ctx.shadowColor = 'rgba(0,200,75,0.20)'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(RCX, RCY, RR, 0, Math.PI*2); ctx.stroke();
      ctx.shadowBlur = 0;

      // Sonar charge arc (around the bezel, 12-o'clock clockwise)
      const sCF = Math.max(0, Math.min(1, this.gaugeDisplay.sonarCharge / 100));
      const sonarFull = sCF >= 0.99;
      const CRING_R = RR + 7;
      ctx.strokeStyle = 'rgba(0,45,18,0.45)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(RCX, RCY, CRING_R, 0, Math.PI*2); ctx.stroke();
      const cStart = -Math.PI / 2, cEnd = cStart + sCF * Math.PI * 2;
      const sonarGreen = sonarFull ? 255 : Math.round(140 + sCF * 115);
      ctx.strokeStyle = sonarFull
        ? `rgba(0,255,78,${(0.80 + 0.18 * Math.sin(now * Math.PI * 4)).toFixed(2)})`
        : `rgba(0,${sonarGreen},55,0.78)`;
      ctx.lineWidth = 4;
      if (sonarFull) { ctx.shadowColor = '#00ff50'; ctx.shadowBlur = 14 + 5 * Math.abs(Math.sin(now * Math.PI * 4)); }
      ctx.beginPath(); ctx.arc(RCX, RCY, CRING_R, cStart, cEnd); ctx.stroke();
      ctx.shadowBlur = 0;
      // End-cap dot
      if (sCF > 0.02 && !sonarFull) {
        const capX = RCX + Math.cos(cEnd) * CRING_R, capY = RCY + Math.sin(cEnd) * CRING_R;
        ctx.fillStyle = 'rgba(0,230,80,0.90)'; ctx.shadowColor = '#00e050'; ctx.shadowBlur = 7;
        ctx.beginPath(); ctx.arc(capX, capY, 2.5, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
      }

      // Corner bracket frame
      const BSIZ = RR + 16, ARM = 16;
      const bTop = Math.max(PY+4, RCY-BSIZ), bBot = Math.min(GAME_H-4, RCY+BSIZ);
      const bLeft = RCX-BSIZ, bRight = RCX+BSIZ;
      ctx.strokeStyle = 'rgba(0,165,70,0.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(bLeft+ARM, bTop); ctx.lineTo(bLeft, bTop); ctx.lineTo(bLeft, bTop+ARM); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bRight-ARM, bTop); ctx.lineTo(bRight, bTop); ctx.lineTo(bRight, bTop+ARM); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bLeft, bBot-ARM); ctx.lineTo(bLeft, bBot); ctx.lineTo(bLeft+ARM, bBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bRight, bBot-ARM); ctx.lineTo(bRight, bBot); ctx.lineTo(bRight-ARM, bBot); ctx.stroke();

      // Metal nameplate below sonar
      ctx.fillStyle = 'rgba(18,22,14,0.75)'; ctx.beginPath(); ctx.roundRect(RCX-74, PY+6, 148, 14, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(50,60,38,0.45)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.roundRect(RCX-74, PY+6, 148, 14, 2); ctx.stroke();
      ctx.fillStyle = 'rgba(0,200,75,0.60)'; ctx.font = '7px monospace'; ctx.textAlign = 'center';
      ctx.fillText('SONAR — ACTIVE MODE', RCX, PY+16);

      // SONAR charge % label
      const pct = Math.round(sCF * 100);
      ctx.font = 'bold 7px monospace';
      ctx.fillStyle = sonarFull ? 'rgba(0,255,78,0.92)' : 'rgba(0,185,65,0.65)';
      if (sonarFull) { ctx.shadowColor = '#00ff50'; ctx.shadowBlur = 7; }
      ctx.fillText(`${pct}%`, RCX, bBot + 10);
      ctx.shadowBlur = 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // THROTTLE LEVER — left of sonar, x=405
    // ─────────────────────────────────────────────────────────────────────────
    {
      const boosting = this.keys["ShiftLeft"] || this.keys["ShiftRight"];
      const TLX = 406, TLY = GAME_H - 14;
      const LEVER_BASE_H = 68;
      const LEVER_H = 46, LEVER_W = 8;
      const leverTilt = boosting ? -0.28 : 0.0; // lean forward when boost active
      const handleX = TLX + Math.sin(leverTilt) * LEVER_H;
      const handleY = TLY - LEVER_BASE_H/2 - LEVER_H * Math.cos(leverTilt);

      // Base slot
      ctx.fillStyle = '#0a0c08'; ctx.beginPath(); ctx.roundRect(TLX-10, TLY-LEVER_BASE_H, 20, LEVER_BASE_H, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(45,55,32,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(TLX-10, TLY-LEVER_BASE_H, 20, LEVER_BASE_H, 4); ctx.stroke();

      // Lever arm
      const armGrad = ctx.createLinearGradient(TLX, TLY-LEVER_BASE_H, handleX, handleY);
      armGrad.addColorStop(0, '#3a3d30'); armGrad.addColorStop(1, '#2a2d22');
      ctx.fillStyle = armGrad;
      ctx.beginPath();
      ctx.moveTo(TLX - LEVER_W/2, TLY - LEVER_BASE_H/2);
      ctx.lineTo(handleX - LEVER_W/2, handleY);
      ctx.lineTo(handleX + LEVER_W/2, handleY);
      ctx.lineTo(TLX + LEVER_W/2, TLY - LEVER_BASE_H/2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(60,70,45,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(TLX - LEVER_W/2, TLY - LEVER_BASE_H/2);
      ctx.lineTo(handleX - LEVER_W/2, handleY);
      ctx.lineTo(handleX + LEVER_W/2, handleY);
      ctx.lineTo(TLX + LEVER_W/2, TLY - LEVER_BASE_H/2);
      ctx.closePath(); ctx.stroke();

      // Handle grip
      const handleG = ctx.createRadialGradient(handleX-2, handleY-2, 0, handleX, handleY, 10);
      handleG.addColorStop(0, boosting ? '#556644' : '#4a4e3a');
      handleG.addColorStop(1, boosting ? '#2a3020' : '#1e2218');
      if (boosting) { ctx.shadowColor = '#88aa44'; ctx.shadowBlur = 8; }
      ctx.fillStyle = handleG;
      ctx.beginPath(); ctx.arc(handleX, handleY, 10, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(70,80,52,0.65)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(handleX, handleY, 10, 0, Math.PI*2); ctx.stroke();

      // Label
      ctx.fillStyle = 'rgba(70,80,55,0.60)'; ctx.font = '5px monospace'; ctx.textAlign = 'center';
      ctx.fillText('THRUST', TLX, TLY + 10);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PHYSICAL BUTTONS — PING / FLARE / BOOST (3 large raised buttons)
    // ─────────────────────────────────────────────────────────────────────────
    {
      const boosting = this.keys["ShiftLeft"] || this.keys["ShiftRight"];
      interface PhyBtn { label: string; icon: string; pressed: boolean; col: string; glowCol: string }
      const BUTTONS: PhyBtn[] = [
        { label: 'PING',  icon: '◎', pressed: this.sonarSwitchAnim > 0, col: '#004820', glowCol: '#00ff60' },
        { label: 'FLARE', icon: '⬡', pressed: this.flareSwitchAnim > 0, col: '#4a2800', glowCol: '#ff8800' },
        { label: 'BOOST', icon: '▶', pressed: boosting,                 col: '#002040', glowCol: '#00aaff' },
      ];
      const BW = 78, BH = 38, BTN_Y = GAME_H - 14 - BH/2;
      const BTN_CXS = [510, 625, 742];

      for (let bi = 0; bi < 3; bi++) {
        const btn = BUTTONS[bi];
        const bcx = BTN_CXS[bi], bcy = BTN_Y;
        const bx = bcx - BW/2, by = bcy - BH/2;
        const pressOff = btn.pressed ? 3 : 0; // simulate depression

        // Drop shadow (3D raised appearance)
        if (!btn.pressed) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.beginPath(); ctx.roundRect(bx+3, by+3, BW, BH, 5); ctx.fill();
        }

        // Button body
        const btnBaseG = ctx.createLinearGradient(bx, by+pressOff, bx, by+BH+pressOff);
        const [r,g,b] = btn.col.slice(1).match(/.{2}/g)!.map(h=>parseInt(h,16));
        btnBaseG.addColorStop(0, btn.pressed
          ? `rgba(${r+12},${g+12},${b+12},0.95)`
          : `rgba(${r+20},${g+20},${b+20},0.90)`);
        btnBaseG.addColorStop(1, btn.pressed
          ? `rgba(${r},${g},${b},0.90)`
          : `rgba(${Math.max(0,r-8)},${Math.max(0,g-8)},${Math.max(0,b-8)},0.85)`);
        ctx.fillStyle = btnBaseG;
        if (btn.pressed) { ctx.shadowColor = btn.glowCol; ctx.shadowBlur = 10; }
        ctx.beginPath(); ctx.roundRect(bx, by+pressOff, BW, BH, 5); ctx.fill();
        ctx.shadowBlur = 0;

        // Top highlight (simulates raised surface)
        if (!btn.pressed) {
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.beginPath(); ctx.roundRect(bx+2, by+2, BW-4, BH*0.35, [3,3,0,0]); ctx.fill();
        }

        // Border
        ctx.strokeStyle = btn.pressed
          ? btn.glowCol.replace(')', ',0.6)').replace('rgb', 'rgba')
          : `rgba(${r+60},${g+60},${b+60},0.45)`;
        ctx.lineWidth = btn.pressed ? 1.5 : 1;
        if (btn.pressed) { ctx.shadowColor = btn.glowCol; ctx.shadowBlur = 8; }
        ctx.beginPath(); ctx.roundRect(bx, by+pressOff, BW, BH, 5); ctx.stroke();
        ctx.shadowBlur = 0;

        // Icon
        ctx.fillStyle = btn.pressed
          ? btn.glowCol
          : `rgba(${r+80},${g+100},${b+80},0.75)`;
        ctx.font = btn.pressed ? 'bold 11px monospace' : '10px monospace';
        ctx.textAlign = 'center';
        if (btn.pressed) { ctx.shadowColor = btn.glowCol; ctx.shadowBlur = 8; }
        ctx.fillText(btn.icon, bcx - 12, bcy + pressOff + 5);
        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = btn.pressed
          ? btn.glowCol
          : `rgba(${r+80},${g+90},${b+80},0.80)`;
        ctx.font = 'bold 8px monospace';
        ctx.fillText(btn.label, bcx + 10, bcy + pressOff + 5);
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // RIGHT CLUSTER  (x: 880–1280)
    // VU Meter | Mission Clock | Comms Screen | Flare Slots
    // ══════════════════════════════════════════════════════════════════════════

    // ─────────────────────────────────────────────────────────────────────────
    // ACOUSTIC SIGNATURE VU METER — horizontal bar display
    // ─────────────────────────────────────────────────────────────────────────
    {
      const MX = 898, MY = PY + 10, MW = 220, MH = 44;
      const noise = Math.max(0, Math.min(1, this.noise / 100));
      const SEG_W = 9, SEG_GAP = 2, SEG_H = 26;
      const SEG_COUNT = Math.floor(MW / (SEG_W + SEG_GAP));
      const LIT = Math.round(noise * SEG_COUNT);

      // Background panel
      ctx.fillStyle = 'rgba(8,12,6,0.80)'; ctx.beginPath(); ctx.roundRect(MX, MY, MW, MH, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(38,50,28,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(MX, MY, MW, MH, 4); ctx.stroke();

      // Label
      ctx.fillStyle = 'rgba(80,100,60,0.65)'; ctx.font = '6px monospace'; ctx.textAlign = 'left';
      ctx.fillText('ACOUSTIC SIGNATURE', MX+5, MY+10);

      // Bars
      const peakHoldF = Math.max(0, Math.min(1, this._vuPeakNoise / 100));
      const peakHoldSeg = Math.round(peakHoldF * SEG_COUNT);
      for (let s = 0; s < SEG_COUNT; s++) {
        const sx = MX + 4 + s * (SEG_W + SEG_GAP);
        const frac = s / SEG_COUNT;
        const lit = s < LIT;
        if (lit) {
          // Per-segment jitter: each lit bar bounces ±2px at independent frequencies
          const jitter = Math.round(1.8 * Math.sin(now * (5.3 + s * 0.41) + s * 1.17));
          const segH = SEG_H + jitter;
          const sy = MY + MH - 6 - segH;
          const segCol = frac < 0.55 ? '#22cc44' : frac < 0.78 ? '#dd8820' : '#ff2222';
          const segGlow = frac < 0.55 ? '#00ff44' : frac < 0.78 ? '#ffaa20' : '#ff2222';
          ctx.fillStyle = segCol; ctx.shadowColor = segGlow; ctx.shadowBlur = frac > 0.77 ? 5 : 3;
          ctx.beginPath(); ctx.roundRect(sx, sy, SEG_W, segH, 1); ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          const sy = MY + MH - 6 - SEG_H;
          ctx.fillStyle = 'rgba(14,20,8,0.65)';
          ctx.beginPath(); ctx.roundRect(sx, sy, SEG_W, SEG_H, 1); ctx.fill();
        }
      }
      // Peak-hold needle — decaying white bar (held at _vuPeakNoise, decays 20 units/s)
      if (peakHoldF > 0.02) {
        const pnx = MX + 4 + peakHoldSeg * (SEG_W + SEG_GAP) - SEG_GAP;
        const peakHoldColor = peakHoldF > 0.78 ? 'rgba(255,80,80,0.80)' : 'rgba(255,255,255,0.60)';
        ctx.strokeStyle = peakHoldColor; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(pnx, MY + MH - 7 - SEG_H); ctx.lineTo(pnx, MY + MH - 7); ctx.stroke();
      }

      // dB label
      const dbVal = Math.round(noise * 80 + 20);
      ctx.fillStyle = noise > 0.72 ? '#ff4444' : 'rgba(100,120,75,0.65)'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'right';
      ctx.fillText(`${dbVal}dB`, MX+MW-4, MY+MH-4);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MISSION ELAPSED CLOCK — digital LED-style
    // ─────────────────────────────────────────────────────────────────────────
    {
      const CX = 1150, CY = PY + 10, CW = 122, CH = 44;
      const totalSec = Math.floor(this.lvlTime);
      const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
      const ss = (totalSec % 60).toString().padStart(2, '0');

      // Panel
      ctx.fillStyle = 'rgba(6,10,6,0.82)'; ctx.beginPath(); ctx.roundRect(CX, CY, CW, CH, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,100,35,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(CX, CY, CW, CH, 4); ctx.stroke();

      // Label
      ctx.fillStyle = 'rgba(0,130,45,0.60)'; ctx.font = '6px monospace'; ctx.textAlign = 'left';
      ctx.fillText('MISSION ELAPSED', CX+5, CY+10);

      // Clock digits
      ctx.fillStyle = '#00ff60'; ctx.shadowColor = '#00ff60'; ctx.shadowBlur = 8;
      ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${mm}:${ss}`, CX + CW/2, CY + CH - 8);
      ctx.shadowBlur = 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // COMMS SCREEN — small convex CRT, center (970, 621)
    // ─────────────────────────────────────────────────────────────────────────
    {
      const CSX = 895, CSY = PY + 62, CSW = 160, CSH = 96;
      // Active comms = set when entering DISCOVERY state, cleared when discovery ends
      const commActive = this._commsActive;

      // Panel / bezel
      const csBezG = ctx.createLinearGradient(CSX, CSY, CSX+CSW, CSY+CSH);
      csBezG.addColorStop(0, '#2a2d22'); csBezG.addColorStop(1, '#181b12');
      ctx.fillStyle = csBezG; ctx.beginPath(); ctx.roundRect(CSX-6, CSY-6, CSW+12, CSH+12, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(55,65,40,0.50)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(CSX-6, CSY-6, CSW+12, CSH+12, 5); ctx.stroke();

      // Screen face (slightly convex look)
      const csFaceG = ctx.createRadialGradient(CSX+CSW*0.5, CSY+CSH*0.5, 0, CSX+CSW*0.5, CSY+CSH*0.5, CSW*0.8);
      csFaceG.addColorStop(0, `rgba(0,${commActive?30:15},0,${commActive?0.95:0.90})`);
      csFaceG.addColorStop(1, 'rgba(0,4,0,0.98)');
      ctx.fillStyle = csFaceG; ctx.beginPath(); ctx.roundRect(CSX, CSY, CSW, CSH, 3); ctx.fill();

      // Screen glow bleed
      if (commActive) {
        ctx.shadowColor = '#00ff60'; ctx.shadowBlur = 12;
        ctx.strokeStyle = 'rgba(0,200,60,0.30)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(CSX, CSY, CSW, CSH, 3); ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.save(); ctx.beginPath(); ctx.roundRect(CSX, CSY, CSW, CSH, 3); ctx.clip();

      // CRT scan lines
      for (let sy = 0; sy < CSH; sy += 3) {
        ctx.strokeStyle = 'rgba(0,0,0,0.20)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(CSX, CSY+sy); ctx.lineTo(CSX+CSW, CSY+sy); ctx.stroke();
      }

      if (commActive) {
        // Oscilloscope waveform during dialogue
        ctx.strokeStyle = 'rgba(0,255,80,0.75)'; ctx.shadowColor = '#00ff60'; ctx.shadowBlur = 5;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const WMY = CSY + CSH * 0.5;
        ctx.moveTo(CSX, WMY);
        for (let wx = 0; wx <= CSW; wx += 2) {
          const wph = wx / CSW * Math.PI * 8 + now * Math.PI * 4;
          const amp = CSH * 0.22 * (0.6 + 0.4 * Math.sin(now * 3));
          ctx.lineTo(CSX + wx, WMY + Math.sin(wph) * amp * (0.5 + 0.5 * Math.sin(wph * 0.3)));
        }
        ctx.stroke(); ctx.shadowBlur = 0;
        // "SIGNAL ACTIVE" label
        ctx.fillStyle = 'rgba(0,200,70,0.70)'; ctx.font = '6px monospace'; ctx.textAlign = 'center';
        ctx.fillText('SIGNAL ACTIVE', CSX + CSW/2, CSY + 12);
      } else {
        // Static noise pattern
        const staticRes = 6;
        for (let sy2 = 0; sy2 < CSH; sy2 += staticRes) {
          for (let sx2 = 0; sx2 < CSW; sx2 += staticRes) {
            const rand = Math.random();
            if (rand > 0.82) {
              const a = (rand - 0.82) * 3.5 * 0.12;
              ctx.fillStyle = `rgba(0,${Math.round(180 + rand*75)},${Math.round(rand*40)},${a})`;
              ctx.fillRect(CSX+sx2, CSY+sy2, staticRes-1, staticRes-1);
            }
          }
        }
        // "STANDBY" label
        ctx.fillStyle = 'rgba(0,80,28,0.55)'; ctx.font = '6px monospace'; ctx.textAlign = 'center';
        ctx.fillText('COMMS — STANDBY', CSX + CSW/2, CSY + CSH/2 + 4);
      }

      // Screen glare
      const csGlareG = ctx.createRadialGradient(CSX+CSW*0.25, CSY+CSH*0.2, 0, CSX+CSW*0.25, CSY+CSH*0.2, CSW*0.5);
      csGlareG.addColorStop(0, 'rgba(255,255,255,0.04)');
      csGlareG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = csGlareG; ctx.fillRect(CSX, CSY, CSW, CSH);

      ctx.restore();

      // Label plate
      ctx.fillStyle = 'rgba(18,22,12,0.75)'; ctx.beginPath(); ctx.roundRect(CSX, CSY+CSH+2, CSW, 12, 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,140,50,0.55)'; ctx.font = '6px monospace'; ctx.textAlign = 'center';
      ctx.fillText('COMMUNICATIONS', CSX + CSW/2, CSY+CSH+10);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FLARE RESERVE SLOTS — 3 orange cylinders
    // ─────────────────────────────────────────────────────────────────────────
    {
      const FR_X0 = 1100, FR_Y = PY + 62, FR_W = 36, FR_H = 80, FR_GAP = 48;
      const flareCount = Math.max(0, Math.min(3, this.flares));
      const lowFlares = flareCount <= 1;

      ctx.fillStyle = 'rgba(8,10,6,0.70)'; ctx.beginPath(); ctx.roundRect(FR_X0-8, FR_Y-8, FR_GAP*2+FR_W+16, FR_H+32, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(40,50,28,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(FR_X0-8, FR_Y-8, FR_GAP*2+FR_W+16, FR_H+32, 4); ctx.stroke();

      ctx.fillStyle = 'rgba(70,80,55,0.60)'; ctx.font = '6px monospace'; ctx.textAlign = 'center';
      ctx.fillText('FLARE RESERVE', FR_X0 + FR_GAP + FR_W/2, FR_Y - 14);

      for (let fi = 0; fi < 3; fi++) {
        const fx = FR_X0 + fi * FR_GAP;
        const lit = fi < flareCount;

        if (lit) {
          // Cylinder glow
          const flarePulse = lowFlares && fi === 0 ? (0.7 + 0.3 * Math.abs(Math.sin(now * Math.PI * 2.5))) : 1;
          const flareGlow = ctx.createRadialGradient(fx+FR_W/2, FR_Y+FR_H/2, 4, fx+FR_W/2, FR_Y+FR_H/2, FR_W*0.9);
          flareGlow.addColorStop(0, `rgba(255,${lowFlares?80:140},0,${(0.25 * flarePulse).toFixed(2)})`);
          flareGlow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = flareGlow; ctx.beginPath(); ctx.arc(fx+FR_W/2, FR_Y+FR_H/2, FR_W*0.9, 0, Math.PI*2); ctx.fill();

          // Cylinder body
          const cylG = ctx.createLinearGradient(fx, FR_Y, fx+FR_W, FR_Y);
          cylG.addColorStop(0, `rgba(200,${lowFlares?60:100},0,0.90)`);
          cylG.addColorStop(0.35, `rgba(255,${lowFlares?100:150},20,0.95)`);
          cylG.addColorStop(0.7, `rgba(220,${lowFlares?70:115},5,0.90)`);
          cylG.addColorStop(1, `rgba(140,${lowFlares?35:65},0,0.80)`);
          if (lowFlares && fi === 0) { ctx.shadowColor = '#ff6600'; ctx.shadowBlur = 10 * flarePulse; }
          ctx.fillStyle = cylG; ctx.beginPath(); ctx.roundRect(fx, FR_Y, FR_W, FR_H, 6); ctx.fill();
          ctx.shadowBlur = 0;

          // Cylinder highlight
          const cylHL = ctx.createLinearGradient(fx, FR_Y, fx+FR_W*0.35, FR_Y);
          cylHL.addColorStop(0, 'rgba(255,255,200,0.20)');
          cylHL.addColorStop(1, 'rgba(255,255,200,0)');
          ctx.fillStyle = cylHL; ctx.beginPath(); ctx.roundRect(fx, FR_Y, FR_W*0.4, FR_H, [6,0,0,6]); ctx.fill();

          // Cap (top + bottom)
          ctx.fillStyle = `rgba(160,80,0,0.90)`;
          ctx.beginPath(); ctx.roundRect(fx+1, FR_Y, FR_W-2, 10, [6,6,0,0]); ctx.fill();
          ctx.beginPath(); ctx.roundRect(fx+1, FR_Y+FR_H-10, FR_W-2, 10, [0,0,6,6]); ctx.fill();

          // Number label
          ctx.fillStyle = 'rgba(255,200,100,0.85)'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
          ctx.fillText(`${fi+1}`, fx+FR_W/2, FR_Y+FR_H/2+4);
        } else {
          // Depleted slot — dark
          ctx.fillStyle = 'rgba(12,14,8,0.70)';
          ctx.beginPath(); ctx.roundRect(fx, FR_Y, FR_W, FR_H, 6); ctx.fill();
          ctx.strokeStyle = 'rgba(30,35,22,0.50)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(fx, FR_Y, FR_W, FR_H, 6); ctx.stroke();
          ctx.fillStyle = 'rgba(40,50,30,0.45)'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
          ctx.fillText('—', fx+FR_W/2, FR_Y+FR_H/2+3);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AMBIENT SONAR GLOW on dashboard surface
    // ─────────────────────────────────────────────────────────────────────────
    {
      const sonarGlowG = ctx.createRadialGradient(625, PY, 0, 625, PY, 160);
      sonarGlowG.addColorStop(0, 'rgba(0,80,30,0.10)');
      sonarGlowG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sonarGlowG; ctx.fillRect(465, PY, 320, PH);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EMERGENCY LIGHTING OVERLAY on dashboard
    // ─────────────────────────────────────────────────────────────────────────
    if (this._hullWhiteFlash > 0 || this._emergencyLightTimer > 0) {
      if (this._hullWhiteFlash > 0) {
        // Single-frame white flash on hull hit (full opacity, cleared after renderPortholeFrame)
        ctx.fillStyle = 'rgba(255,255,255,0.40)';
        ctx.fillRect(0, PY, GAME_W, PH);
      } else if (this._emergencyLightTimer > 0) {
        const emFade = this._emergencyLightTimer / 2000;
        ctx.fillStyle = `rgba(220,0,0,${(emFade * 0.14).toFixed(2)})`;
        ctx.fillRect(0, PY, GAME_W, PH);
      }
    }

    // Warning light glow bleed — any active warning bulb (OXY/HUL/NOI/THR)
    {
      const anyWarn = this.o2 < 20 || this.gaugeDisplay.hull < 25 || this.noise > 72
        || this.enemies.some(e => e.type === 'leviathan' && (e.state === 'hunt' || e.state === 'attacking'));
      if (anyWarn) {
        const warnBleed = 0.06 + 0.04 * Math.abs(Math.sin(now * Math.PI * 2));
        ctx.fillStyle = `rgba(220,30,0,${warnBleed.toFixed(2)})`;
        ctx.fillRect(0, PY, 370, PH);
      }
    }
  }

  // ── Porthole frame: thick oval metal submarine window ─────────────────────
  private renderPortholeFrame() {
    const ctx = this.hudCtx;
    // Porthole oval geometry: top y=30, bottom y=PANEL_Y, left x=80, right x=1200
    // Center (640, 265), rx=560, ry=235
    const OX = 640, OY = 265, ORX = 560, ORY = 235;
    const BEZEL_W = 26; // thickness of the oval metal bezel
    const now = performance.now() / 1000;

    // ── 1. Dark interior fill: viewport area minus the oval window (evenodd) ──
    ctx.save();
    const wallColor = ctx.createLinearGradient(0, 0, 0, PANEL_Y);
    wallColor.addColorStop(0, '#0d0f0e');
    wallColor.addColorStop(0.4, '#111410');
    wallColor.addColorStop(1, '#0a0c0a');
    ctx.fillStyle = wallColor;
    ctx.beginPath();
    ctx.rect(0, 0, GAME_W, PANEL_Y);
    ctx.ellipse(OX, OY, ORX, ORY, 0, 0, Math.PI * 2);
    ctx.fill('evenodd');
    ctx.restore();

    // ── 2. Emergency tint on interior walls (on hull damage) ─────────────────
    if (this._hullWhiteFlash > 0 || this._emergencyLightTimer > 0) {
      let wallFillStyle: string;
      if (this._hullWhiteFlash > 0) {
        // Single-frame white flash — full opacity, cleared after this render pass
        wallFillStyle = 'rgba(255,255,255,0.55)';
      } else {
        const fade = this._emergencyLightTimer / 2000;
        wallFillStyle = `rgba(180,0,0,${(fade * 0.18).toFixed(2)})`;
      }
      ctx.save();
      ctx.fillStyle = wallFillStyle;
      ctx.beginPath();
      ctx.rect(0, 0, GAME_W, PANEL_Y);
      ctx.ellipse(OX, OY, ORX, ORY, 0, 0, Math.PI * 2);
      ctx.fill('evenodd');
      ctx.restore();
    }
    // Clear single-frame latch — must be last operation in renderPortholeFrame
    this._hullWhiteFlash = 0;

    // ── 3. Ceiling strip (y 0–30): red emergency light bar + sensor mount ─────
    {
      const CY = 30;
      // Ceiling base material
      const ceilGrad = ctx.createLinearGradient(0, 0, 0, CY);
      ceilGrad.addColorStop(0, '#181b16'); ceilGrad.addColorStop(1, '#101310');
      ctx.fillStyle = ceilGrad;
      ctx.fillRect(0, 0, GAME_W, CY);

      // Red emergency light strip (LED bar)
      const emLit = this._emergencyLightTimer > 0;
      const redIntensity = emLit
        ? 0.65 + 0.3 * Math.abs(Math.sin(now * Math.PI * 2))
        : 0.18 + 0.06 * Math.abs(Math.sin(now * 0.4));
      const ledGrad = ctx.createLinearGradient(0, 0, GAME_W, 0);
      ledGrad.addColorStop(0,   `rgba(${emLit?'200,0,0':'80,12,12'},0)`);
      ledGrad.addColorStop(0.15, `rgba(${emLit?'200,0,0':'80,12,12'},${redIntensity.toFixed(2)})`);
      ledGrad.addColorStop(0.85, `rgba(${emLit?'200,0,0':'80,12,12'},${redIntensity.toFixed(2)})`);
      ledGrad.addColorStop(1,   `rgba(${emLit?'200,0,0':'80,12,12'},0)`);
      ctx.fillStyle = ledGrad;
      ctx.fillRect(0, 6, GAME_W, 10);

      // Mounted sensor/camera cylinder (center-right)
      const camX = GAME_W * 0.62;
      ctx.fillStyle = '#1e201a';
      ctx.beginPath(); ctx.roundRect(camX - 14, 2, 28, 22, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(80,90,70,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(camX - 14, 2, 28, 22, 3); ctx.stroke();
      // Camera lens
      const lensG = ctx.createRadialGradient(camX, 13, 0, camX, 13, 7);
      lensG.addColorStop(0, '#111'); lensG.addColorStop(0.6, '#0a0a08'); lensG.addColorStop(1, '#1a1c18');
      ctx.fillStyle = lensG; ctx.beginPath(); ctx.arc(camX, 13, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(60,70,55,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(camX, 13, 7, 0, Math.PI * 2); ctx.stroke();
      // Blinking status LED (blinks every 2s)
      const blinkPhase = Math.floor(now / 2) % 2;
      const blinkOn = blinkPhase === 0 && (now % 2) < 0.25;
      if (blinkOn) {
        ctx.fillStyle = 'rgba(0,200,80,0.9)';
        ctx.shadowColor = '#00c850'; ctx.shadowBlur = 6;
      } else {
        ctx.fillStyle = 'rgba(0,40,16,0.6)';
      }
      ctx.beginPath(); ctx.arc(camX + 10, 5, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      // 2-toggle panel (left of center)
      const tpX = GAME_W * 0.28;
      ctx.fillStyle = '#161814'; ctx.beginPath(); ctx.roundRect(tpX - 18, 3, 36, 22, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(55,65,50,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(tpX - 18, 3, 36, 22, 2); ctx.stroke();
      for (let ti = 0; ti < 2; ti++) {
        const tx = tpX - 8 + ti * 16;
        ctx.fillStyle = ti === 0 ? 'rgba(0,180,60,0.75)' : 'rgba(180,0,0,0.5)';
        ctx.beginPath(); ctx.roundRect(tx - 3, 6, 6, 16, 2); ctx.fill();
      }

      // Ceiling bottom edge — subtle separation line
      ctx.strokeStyle = 'rgba(40,50,35,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, CY); ctx.lineTo(GAME_W, CY); ctx.stroke();
    }

    // ── 4. Left wall strip (x 0–80, y 30–PANEL_Y) ───────────────────────────
    {
      const LW = 80, LH = PANEL_Y - 30, LY0 = 30;
      // Wall base
      const lwGrad = ctx.createLinearGradient(0, 0, LW, 0);
      lwGrad.addColorStop(0, '#0e1008'); lwGrad.addColorStop(1, '#141610');
      ctx.fillStyle = lwGrad;
      ctx.fillRect(0, LY0, LW, LH);

      // Vertical pipe (x=22, full height)
      const pipeG = ctx.createLinearGradient(16, 0, 30, 0);
      pipeG.addColorStop(0, '#2a2d28'); pipeG.addColorStop(0.4, '#3a3d36'); pipeG.addColorStop(1, '#1e2018');
      ctx.fillStyle = pipeG;
      ctx.fillRect(16, LY0, 14, LH);
      // Pipe segments/joints every 50px
      for (let jy = LY0 + 30; jy < PANEL_Y - 20; jy += 55) {
        ctx.fillStyle = '#1a1c16';
        ctx.fillRect(14, jy, 18, 8);
        ctx.strokeStyle = 'rgba(60,65,50,0.4)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(14, jy); ctx.lineTo(32, jy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(14, jy+8); ctx.lineTo(32, jy+8); ctx.stroke();
      }

      // Toggle-switch electrical panel (x=40-76, y=90-200)
      const tpY = LY0 + 60, tpH = 120;
      ctx.fillStyle = '#0e100c'; ctx.beginPath(); ctx.roundRect(40, tpY, 36, tpH, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(55,65,45,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(40, tpY, 36, tpH, 3); ctx.stroke();
      const togCols = ['rgba(0,180,60,0.75)', 'rgba(200,140,0,0.65)', 'rgba(0,180,60,0.75)', 'rgba(200,0,0,0.5)'];
      for (let ti = 0; ti < 4; ti++) {
        const togY = tpY + 15 + ti * 24;
        ctx.fillStyle = '#16180f'; ctx.beginPath(); ctx.roundRect(48, togY, 20, 14, 2); ctx.fill();
        // Toggle lever
        const togOn = (ti % 3) !== 1;
        ctx.fillStyle = togCols[ti];
        ctx.beginPath(); ctx.roundRect(50, togOn ? togY : togY + 6, 4, 8, 1); ctx.fill();
        // Label dot
        ctx.fillStyle = 'rgba(100,110,80,0.45)'; ctx.font = '5px monospace'; ctx.textAlign = 'left';
        ctx.fillText(['PWR','SYS','AUX','ALM'][ti], 58, togY + 9);
      }

      // Fire extinguisher silhouette (x=44-72, y=240-320)
      const feY = LY0 + 200;
      ctx.fillStyle = '#2a0808';
      ctx.beginPath(); ctx.roundRect(48, feY, 20, 62, 5); ctx.fill();
      ctx.fillStyle = '#380a0a'; ctx.beginPath(); ctx.roundRect(50, feY - 8, 16, 12, 4); ctx.fill();
      // Pin/handle
      ctx.strokeStyle = 'rgba(100,30,30,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(58, feY - 12); ctx.lineTo(58, feY - 20); ctx.stroke();
      ctx.strokeStyle = 'rgba(80,25,25,0.6)'; ctx.lineWidth = 1;
      // Cylinder band
      ctx.fillStyle = 'rgba(60,15,15,0.5)';
      ctx.fillRect(48, feY + 22, 20, 4);

      // Cable bundle (x=55-75, running along right edge of wall strip)
      for (let ci = 0; ci < 3; ci++) {
        ctx.strokeStyle = `rgba(${[30,25,40][ci]},${[30,30,28][ci]},${[18,20,15][ci]},0.6)`;
        ctx.lineWidth = ci === 0 ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(62 + ci*4, LY0 + 10);
        ctx.bezierCurveTo(64+ci*3, LY0+80, 60+ci*4, LY0+160, 63+ci*3, LY0+270);
        ctx.bezierCurveTo(65+ci*4, LY0+320, 61+ci*3, LY0+380, 64+ci*4, PANEL_Y-10);
        ctx.stroke();
      }

      // Right edge shadow of left wall (blend into 3D scene)
      const lwShadow = ctx.createLinearGradient(LW-20, 0, LW, 0);
      lwShadow.addColorStop(0, 'rgba(0,0,0,0)');
      lwShadow.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = lwShadow; ctx.fillRect(LW-20, LY0, 20, LH);
    }

    // ── 5. Right wall strip (x 1200–1280, y 30–PANEL_Y) ─────────────────────
    {
      const RX = 1200, RW = 80, LH = PANEL_Y - 30, LY0 = 30;
      const rwGrad = ctx.createLinearGradient(RX, 0, RX + RW, 0);
      rwGrad.addColorStop(0, '#141610'); rwGrad.addColorStop(1, '#0e1008');
      ctx.fillStyle = rwGrad; ctx.fillRect(RX, LY0, RW, LH);

      // Scratched metal lines (diagonal)
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
      for (let si = 0; si < 6; si++) {
        const sy = LY0 + si * 70;
        ctx.beginPath(); ctx.moveTo(RX+5, sy+10); ctx.lineTo(RX+RW-5, sy+45); ctx.stroke();
      }

      // Emergency placard (label sticker at top)
      const plY = LY0 + 15;
      ctx.fillStyle = '#1e0808'; ctx.beginPath(); ctx.roundRect(RX+8, plY, 64, 32, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(200,80,0,0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(RX+8, plY, 64, 32, 2); ctx.stroke();
      ctx.fillStyle = 'rgba(220,100,0,0.75)'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
      ctx.fillText('EMERGENCY', RX + 40, plY + 11);
      ctx.fillText('PROTOCOL 7', RX + 40, plY + 21);
      ctx.fillStyle = 'rgba(180,60,0,0.55)'; ctx.font = '5px monospace';
      ctx.fillText('AUTHORIZED USE ONLY', RX + 40, plY + 29);

      // Pressure valve wheel (x=1225, y=160-230)
      const vwX = RX + 25, vwY = LY0 + 150;
      const vwR = 22;
      // Wheel rim
      ctx.strokeStyle = 'rgba(50,55,42,0.8)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(vwX, vwY, vwR, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(65,70,52,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(vwX, vwY, vwR, 0, Math.PI * 2); ctx.stroke();
      // Spokes
      ctx.strokeStyle = 'rgba(55,60,45,0.65)'; ctx.lineWidth = 3;
      for (let sp = 0; sp < 6; sp++) {
        const sa = sp * Math.PI / 3 + now * 0.08;
        ctx.beginPath();
        ctx.moveTo(vwX + Math.cos(sa)*4, vwY + Math.sin(sa)*4);
        ctx.lineTo(vwX + Math.cos(sa)*(vwR-5), vwY + Math.sin(sa)*(vwR-5));
        ctx.stroke();
      }
      // Hub
      ctx.fillStyle = '#282a20'; ctx.beginPath(); ctx.arc(vwX, vwY, 5, 0, Math.PI * 2); ctx.fill();

      // Blinking green power LED (y=320)
      const ledY = LY0 + 290;
      const blinkOn = (now % 2) < 0.25;
      ctx.fillStyle = blinkOn ? 'rgba(0,230,80,0.9)' : 'rgba(0,40,15,0.5)';
      if (blinkOn) { ctx.shadowColor = '#00e850'; ctx.shadowBlur = 8; }
      ctx.beginPath(); ctx.arc(RX + 25, ledY, 4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,120,40,0.5)'; ctx.font = '5px monospace'; ctx.textAlign = 'left';
      ctx.fillText('PWR', RX + 33, ledY + 3);

      // Left edge shadow (blend into 3D scene)
      const rwShadow = ctx.createLinearGradient(RX, 0, RX + 20, 0);
      rwShadow.addColorStop(0, 'rgba(0,0,0,0.55)'); rwShadow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rwShadow; ctx.fillRect(RX, LY0, 20, LH);
    }

    // ── 6. Oval metal bezel (thick recessed ring) ─────────────────────────────
    {
      // Outer drop shadow / ambient occlusion
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 18; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 4;
      const bezOuter = ctx.createLinearGradient(OX - ORX, OY - ORY, OX + ORX, OY + ORY);
      bezOuter.addColorStop(0, '#2a2e28');
      bezOuter.addColorStop(0.35, '#1e211a');
      bezOuter.addColorStop(0.65, '#1a1d16');
      bezOuter.addColorStop(1, '#242720');
      ctx.fillStyle = bezOuter;
      ctx.beginPath();
      ctx.ellipse(OX, OY, ORX + BEZEL_W, ORY + BEZEL_W, 0, 0, Math.PI * 2);
      ctx.ellipse(OX, OY, ORX, ORY, 0, 0, Math.PI * 2);
      // Draw bezel ring using clip approach
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 18; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 4;
      ctx.beginPath();
      ctx.ellipse(OX, OY, ORX + BEZEL_W, ORY + BEZEL_W, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = bezOuter;
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      // Carve out the inner oval (glass area) — clear it
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.ellipse(OX, OY, ORX, ORY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();

      // Bezel inner rim: bright highlight at top-left, shadow at bottom-right
      const rimHighlight = ctx.createLinearGradient(OX - ORX, OY - ORY, OX + ORX, OY + ORY);
      rimHighlight.addColorStop(0, 'rgba(90,100,80,0.65)');
      rimHighlight.addColorStop(0.4, 'rgba(55,62,45,0.4)');
      rimHighlight.addColorStop(0.7, 'rgba(30,35,22,0.3)');
      rimHighlight.addColorStop(1, 'rgba(15,18,10,0.5)');
      ctx.strokeStyle = rimHighlight;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(OX, OY, ORX + 1, ORY + 1, 0, 0, Math.PI * 2); ctx.stroke();

      // Inner edge of bezel (subtle)
      ctx.strokeStyle = 'rgba(20,24,16,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(OX, OY, ORX - 1, ORY - 1, 0, 0, Math.PI * 2); ctx.stroke();
    }

    // ── 7. Bolts around the bezel ─────────────────────────────────────────────
    {
      const BOLT_COUNT = 12;
      const BOLT_R = ORX + BEZEL_W * 0.55;
      const BOLT_RY = ORY + BEZEL_W * 0.55;
      for (let b = 0; b < BOLT_COUNT; b++) {
        const ang = (b / BOLT_COUNT) * Math.PI * 2 - Math.PI / 2;
        const bx = OX + Math.cos(ang) * BOLT_R;
        const by = OY + Math.sin(ang) * BOLT_RY;
        // Bolt head
        const boltG = ctx.createRadialGradient(bx-1.5, by-1.5, 0, bx, by, 5.5);
        boltG.addColorStop(0, '#4a4e40');
        boltG.addColorStop(0.5, '#2a2e22');
        boltG.addColorStop(1, '#181a12');
        ctx.fillStyle = boltG;
        ctx.beginPath(); ctx.arc(bx, by, 5.5, 0, Math.PI * 2); ctx.fill();
        // Rust ring
        ctx.strokeStyle = 'rgba(60,25,10,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(bx, by, 5.5, 0, Math.PI * 2); ctx.stroke();
        // Cross-head slot
        ctx.strokeStyle = 'rgba(14,16,10,0.7)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(bx-3, by); ctx.lineTo(bx+3, by); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx, by-3); ctx.lineTo(bx, by+3); ctx.stroke();
      }
    }

    // ── 8. Rust streaks on bezel ──────────────────────────────────────────────
    {
      const RUSTS = [
        { ang: -0.3, len: 28 }, { ang: 0.8, len: 18 }, { ang: 2.1, len: 22 },
        { ang: 3.5, len: 14 }, { ang: 4.8, len: 20 }, { ang: -1.9, len: 16 },
      ];
      for (const r of RUSTS) {
        const bx = OX + Math.cos(r.ang) * (ORX + 4);
        const by = OY + Math.sin(r.ang) * (ORY + 4);
        const ex = bx + Math.cos(r.ang + 0.15) * r.len;
        const ey = by + Math.sin(r.ang + 0.15) * r.len;
        const rustGrad = ctx.createLinearGradient(bx, by, ex, ey);
        rustGrad.addColorStop(0, 'rgba(90,35,8,0.38)');
        rustGrad.addColorStop(0.5, 'rgba(65,22,5,0.22)');
        rustGrad.addColorStop(1, 'rgba(40,12,2,0)');
        ctx.strokeStyle = rustGrad; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
        // Rust dot at start
        ctx.fillStyle = 'rgba(85,30,6,0.30)';
        ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ── 9. Glass glare arc (upper-left) ──────────────────────────────────────
    {
      const glareX = OX - ORX * 0.55, glareY = OY - ORY * 0.72;
      const glareGrad = ctx.createRadialGradient(glareX, glareY, 0, glareX, glareY, 180);
      glareGrad.addColorStop(0, 'rgba(255,255,255,0.05)');
      glareGrad.addColorStop(0.5, 'rgba(200,220,255,0.018)');
      glareGrad.addColorStop(1, 'rgba(180,200,255,0)');
      ctx.save();
      ctx.beginPath(); ctx.ellipse(OX, OY, ORX, ORY, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = glareGrad;
      ctx.beginPath(); ctx.arc(glareX, glareY, 180, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // ── 10. Inner vignette shadow around porthole glass edge ─────────────────
    {
      ctx.save();
      ctx.beginPath(); ctx.ellipse(OX, OY, ORX, ORY, 0, 0, Math.PI * 2); ctx.clip();
      const vgGrad = ctx.createRadialGradient(OX, OY, ORX * 0.6, OX, OY, ORX);
      vgGrad.addColorStop(0, 'rgba(0,0,0,0)');
      vgGrad.addColorStop(0.7, 'rgba(0,0,0,0)');
      vgGrad.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vgGrad;
      ctx.beginPath(); ctx.ellipse(OX, OY, ORX, ORY, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // ============================================================
  // RENDER
  // ============================================================
  private render() {
    // Clear HUD canvas every frame
    this.hudCtx.clearRect(0, 0, GAME_W, GAME_H);

    if (this.state === "MENU" || this.state === "STORE") {
      this.renderer.render(this.scene, this.camera);
      this.renderMenu();
      return;
    }
    if (this.state === "CUTSCENE") {
      this.renderer.render(this.scene, this.camera);
      this.renderCS();
      return;
    }
    if (this.state === "DISCOVERY") {
      this._commsActive = true;
      this.renderer.render(this.scene, this.camera);
      this.renderDiscovery();
      // Render cockpit panel on top of discovery overlay so comms screen is visible
      // (dialog area is y=180–480; cockpit starts at y=500 — no overlap)
      this.renderControlPanel();
      this.renderPortholeFrame();
      // Draw timed subtitles fired by the discovery queue
      if (this.subTimer > 0 && this.subtitle) this.renderSubtitle();
      return;
    }
    if (this.state === "COLLAPSE") {
      this.renderer.render(this.scene, this.camera);
      this.renderCollapse();
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

    // Update camera from 2D position + buoyancy Y drift
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
  }

  // ============================================================
  // HUD (drawn on hudCanvas)
  // ============================================================
  private renderMiniMap() {
    const def = this.lvlDef;
    if (!def) return;
    const ctx = this.hudCtx;

    const MM_SIZE = 120;
    const MM_X    = 12;
    const MM_Y    = 12;
    const MM_CX   = MM_X + MM_SIZE / 2;
    const MM_CY   = MM_Y + MM_SIZE / 2;
    const HALF    = MM_SIZE / 2;        // 60 px
    const VIEW    = 500;                // world-units from center to edge
    const scale   = HALF / VIEW;

    // world → minimap pixel
    const wx = (wx: number) => MM_CX + (wx - this.px) * scale;
    const wy = (wy: number) => MM_CY + (wy - this.py) * scale;

    ctx.save();

    // Circular clip
    ctx.beginPath();
    ctx.arc(MM_CX, MM_CY, HALF, 0, Math.PI * 2);
    ctx.clip();

    // Background
    ctx.fillStyle = "rgba(0,8,18,0.84)";
    ctx.fillRect(MM_X, MM_Y, MM_SIZE, MM_SIZE);

    // Subtle grid
    ctx.strokeStyle = "rgba(0,180,200,0.06)";
    ctx.lineWidth = 0.5;
    for (let g = -2; g <= 2; g++) {
      const gx = MM_CX + g * (HALF / 2);
      const gy = MM_CY + g * (HALF / 2);
      ctx.beginPath(); ctx.moveTo(gx, MM_Y); ctx.lineTo(gx, MM_Y + MM_SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(MM_X, gy); ctx.lineTo(MM_X + MM_SIZE, gy); ctx.stroke();
    }

    // ── Sonar rings ──
    for (const p of this.pings) {
      const rx = wx(p.x);
      const ry = wy(p.y);
      const rMM = p.radius * scale;
      const progress = p.radius / p.maxRadius;
      const alpha = Math.max(0, 1 - progress);
      let ringColor: string;
      if (p.type === "flare")       ringColor = `rgba(255,140,0,${(alpha * 0.85).toFixed(3)})`;
      else if (p.type === "large")  ringColor = `rgba(0,230,255,${(alpha * 0.90).toFixed(3)})`;
      else if (p.type === "boost")  ringColor = `rgba(160,160,160,${(alpha * 0.75).toFixed(3)})`;
      else                          ringColor = `rgba(0,210,255,${(alpha * 0.85).toFixed(3)})`;

      ctx.strokeStyle = ringColor;
      ctx.shadowColor = ringColor;
      ctx.shadowBlur  = 5;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.arc(rx, ry, Math.max(0.5, rMM), 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ── Revealed terrain dots (cyan, fade with fadeTimer) ──
    for (const ro of this.revealObjs) {
      if (ro.fadeTimer <= 0) continue;
      const dotX = wx(ro.cx);
      const dotY = wy(ro.cy);
      const a = Math.min(1, ro.fadeTimer / ro.fadeDuration) * 0.55;
      ctx.fillStyle = `rgba(0,220,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Enemy dots (red, fade with visTimer) ──
    for (const e of this.enemies) {
      if (e.visTimer <= 0) continue;
      const dotX = wx(e.x);
      const dotY = wy(e.y);
      const a = Math.min(1, e.visTimer / 5000) * 0.9;
      ctx.fillStyle   = `rgba(255,50,50,${a.toFixed(3)})`;
      ctx.shadowColor = `rgba(255,50,50,0.7)`;
      ctx.shadowBlur  = 5;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // ── Letter collectible dots (gold, shown once proximally revealed) ──
    for (const letter of this.letterEntities) {
      if (letter.collected || letter.revealAlpha < 0.05) continue;
      const dotX = wx(letter.x);
      const dotY = wy(letter.y);
      const a = letter.revealAlpha * 0.85;
      ctx.fillStyle   = `rgba(255,210,50,${a.toFixed(3)})`;
      ctx.shadowColor = `rgba(255,200,0,${(a * 0.6).toFixed(3)})`;
      ctx.shadowBlur  = 4;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // ── Player dot ──
    ctx.fillStyle   = "rgba(0,255,180,0.95)";
    ctx.shadowColor = "rgba(0,255,180,0.7)";
    ctx.shadowBlur  = 7;
    ctx.beginPath();
    ctx.arc(MM_CX, MM_CY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();

    // Bezel ring
    ctx.strokeStyle = "rgba(0,200,230,0.45)";
    ctx.lineWidth   = 1.2;
    ctx.beginPath();
    ctx.arc(MM_CX, MM_CY, HALF, 0, Math.PI * 2);
    ctx.stroke();

    // Label
    ctx.fillStyle  = "rgba(0,200,230,0.50)";
    ctx.font       = "8px monospace";
    ctx.textAlign  = "center";
    ctx.fillText("SONAR", MM_CX, MM_Y + MM_SIZE + 11);
  }

  private renderHUD() {
    if (this.state !== "PLAYING") return;
    const ctx = this.hudCtx;
    const glitch = this.glitchTimer > 0;
    const gx = glitch ? (Math.random() - 0.5) * 8 : 0;
    const gy = glitch ? (Math.random() - 0.5) * 4 : 0;

    // Level name stays at top
    this.renderLvlName(GAME_W / 2 + gx, 18 + gy);

    // Mini-map (top-left, sonar ripple overlay)
    this.renderMiniMap();

    // Submarine control panel (bottom 20% of screen)
    this.renderControlPanel();

    // Porthole viewport frame (rounded corners above the panel)
    this.renderPortholeFrame();

    // Pod bearing indicator — top-right corner
    const unreachedPods = this.pods.filter(p => !p.rescued);
    if (unreachedPods.length > 0) {
      const nearestPod = unreachedPods.reduce((a, b) =>
        Math.hypot(a.x - this.px, a.y - this.py) < Math.hypot(b.x - this.px, b.y - this.py) ? a : b
      );
      const dx = nearestPod.x - this.px;
      const dy = nearestPod.y - this.py;
      const dist = Math.hypot(dx, dy);
      const bearingRad = Math.atan2(dx, -dy);
      const bearingDeg = Math.round(((bearingRad * 180 / Math.PI) + 360) % 360);
      const bearingStr = bearingDeg.toString().padStart(3, "0");
      const distM = Math.round(dist / 10) * 10;

      const bx = GAME_W - 152 + gx;
      const by = 14 + gy;
      ctx.fillStyle = "rgba(0,14,30,0.70)";
      ctx.fillRect(bx - 6, by, 146, 62);
      ctx.strokeStyle = "rgba(0,200,230,0.38)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 6, by, 146, 62);

      ctx.fillStyle = "rgba(0,200,230,0.60)";
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`POD SIGNAL — ${nearestPod.character}`, bx, by + 13);

      ctx.fillStyle = "#00EEFF";
      ctx.shadowColor = "#00EEFF";
      ctx.shadowBlur = 8;
      ctx.font = "bold 20px monospace";
      ctx.fillText(`BRG ${bearingStr}\u00B0`, bx, by + 38);
      ctx.shadowBlur = 0;

      ctx.fillStyle = "rgba(0,200,230,0.55)";
      ctx.font = "10px monospace";
      ctx.fillText(`${distM}m`, bx + 86, by + 38);
      ctx.fillText(`\u25B6 ${nearestPod.character}`, bx, by + 54);
    }

    if (this.nearPod) this.renderPrompt(`[E] DOCK — ${this.nearPod.character}'S POD`);
    else if (this.nearNoise) this.renderPrompt("[E] SILENCE NOISE SOURCE");
    else if (this.nearConduit) this.renderPrompt("[E] ACTIVATE POWER CONDUIT");
    if (this.subTimer > 0 && this.subtitle) this.renderSubtitle();

    // Gold letter collectibles — projected into viewport
    this.renderLetters();
    // Collected-name build-up strip at top of screen
    this.renderNameStrip();

    // Low O2 vignette pulse (only in the viewport area above the panel)
    if (this.o2 < 20) {
      const pulse = 0.15 + Math.sin(Date.now() / 320) * 0.12;
      ctx.fillStyle = `rgba(255,0,0,${pulse})`;
      ctx.fillRect(0, 0, GAME_W, PANEL_Y);
    }

    // Persistent Engine Cut badge — stays visible as long as Q is toggled on so
    // players always know thrust is disabled (one-time subtitle is not enough).
    if (this.engineCutActive) {
      const pulse = 0.55 + Math.abs(Math.sin(Date.now() / 600)) * 0.45;
      const badgeX = GAME_W / 2 - 72;
      const badgeY = 48;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "rgba(180,0,0,0.82)";
      ctx.strokeStyle = "#FF4444";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, 144, 22, 4);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#FFCCCC";
      ctx.shadowColor = "#FF4444";
      ctx.shadowBlur = 8;
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillText("\u26A0 ENGINE CUT — COASTING SILENT", GAME_W / 2, badgeY + 15);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Dashboard brightness dip: dim the control panel area when Leviathan is Hunt/Attack;
    // milder flicker when Alert (creature investigating)
    const levHunting = this.enemies.some(e => e.type === "leviathan" && (e.state === "hunt" || e.state === "attacking"));
    const levAlert   = !levHunting && this.enemies.some(e => e.type === "leviathan" && e.state === "alert");
    if (levHunting || levAlert) {
      const alpha = levHunting
        ? 0.10 + Math.abs(Math.sin(Date.now() / 80)) * 0.09
        : 0.035 + Math.abs(Math.sin(Date.now() / 420)) * 0.025;
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(0, PANEL_Y, GAME_W, GAME_H - PANEL_Y);
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

  private renderLetters() {
    if (this.letterEntities.length === 0) return;
    const ctx = this.hudCtx;
    const now = performance.now() / 1000;
    const panelY = PANEL_Y; // stay above control panel

    for (let i = 0; i < this.letterEntities.length; i++) {
      const letter = this.letterEntities[i];
      // Skip letters that were collected and whose flash has expired
      if (letter.collected && letter.flashTimer <= 0) continue;

      // Project 2D world position to screen via Three.js camera
      const bob = Math.sin(now * 1.8 + i * 0.9) * 8; // world-unit vertical bob
      const worldPos = new THREE.Vector3(letter.x * WS, EYE_H * 0.55 + bob * WS, letter.y * WS);
      const ndcPos = worldPos.clone().project(this.camera);

      // Cull if behind camera or off-screen
      if (ndcPos.z > 1) continue;
      const sx = (ndcPos.x * 0.5 + 0.5) * GAME_W;
      const sy = (-ndcPos.y * 0.5 + 0.5) * GAME_H;
      if (sx < -60 || sx > GAME_W + 60 || sy < 0 || sy > panelY) continue;

      // Skip letters that haven't been revealed yet by proximity
      if (letter.revealAlpha <= 0) continue;

      // Flash animation: letter briefly brightens then fades out
      let alpha = letter.revealAlpha;
      let scale = 1;
      if (letter.collected && letter.flashTimer > 0) {
        const t = letter.flashTimer / this.LETTER_FLASH_DUR; // 1→0
        alpha = t < 0.2 ? t / 0.2 : 1;  // quick fade-out at end
        scale = 1 + (1 - t) * 0.15;     // subtle size change, no ballooning
      }

      const fontSize = Math.round(28 * scale);

      // Faint gold radial glow halo — barely perceptible in the deep
      const glowR = 18 * scale;
      const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
      grd.addColorStop(0, `rgba(255,215,60,${0.10 * alpha})`);
      grd.addColorStop(1, `rgba(255,180,0,0)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Letter glyph
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "#FFD700";
      ctx.shadowBlur = letter.collected ? 6 : 3;
      ctx.fillStyle = letter.collected ? "#FFFFFF" : "#FFD700";
      ctx.fillText(letter.char, sx, sy);
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  private renderNameStrip() {
    if (this.nameStripAlpha <= 0) return;
    const ctx = this.hudCtx;

    const collectedLetters = this.letterEntities.filter(l => l.collected);
    if (collectedLetters.length === 0) return;

    const nameText = collectedLetters.map(l => l.char).join(" ");
    const allDone   = collectedLetters.length === this.letterEntities.length;

    // Determine effective alpha: full during partial, use nameStripAlpha during fade
    const alpha = allDone ? this.nameStripAlpha : Math.min(1, this.nameStripAlpha);

    const cx = GAME_W / 2;
    const cy = allDone ? 52 : 50; // slightly lower when complete (more prominent)
    const fontSize = allDone ? 26 : 20;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Background pill
    ctx.font = `bold ${fontSize}px monospace`;
    const tw = ctx.measureText(nameText).width;
    const pw = tw + 32, ph = fontSize + 14;
    const px = cx - pw / 2, py = cy - ph / 2;
    ctx.fillStyle = "rgba(0,8,20,0.72)";
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 6);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,200,40,${0.45})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 6);
    ctx.stroke();

    // Gold text with glow
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#FFD700";
    ctx.shadowBlur = allDone ? 18 : 8;
    ctx.fillStyle = allDone ? "#FFE87A" : "#FFD700";
    ctx.fillText(nameText, cx, cy);
    ctx.shadowBlur = 0;

    ctx.restore();
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
  // DISCOVERY SCREEN
  // ============================================================
  private renderDiscovery() {
    const ctx = this.hudCtx;
    const t = Date.now() / 1000;

    if (this.discoveryPhase === "memory") {
      this.renderMemoryFlash();
      return;
    }

    // Survivor labels — face is always blurred, identity hidden from Elias
    const survivorLabel: Record<string, string> = { sara: "Survivor One", noah: "Survivor Two", mia: "Survivor Three" };
    const survivorNum = survivorLabel[this.discoverySurvivor ?? ""] ?? "Survivor";
    const farewellTime = this.discoverySurvivor === "mia" ? 5000 : 3000;

    ctx.fillStyle = "rgba(0,0,0,0.94)"; ctx.fillRect(0, 0, GAME_W, GAME_H);

    const CW = 620, CH = 300;
    const CX = GAME_W / 2 - CW / 2, CY = GAME_H / 2 - CH / 2 - 30;

    ctx.fillStyle = "rgba(0,4,14,0.97)"; ctx.fillRect(CX, CY, CW, CH);
    ctx.strokeStyle = "#00FFFF"; ctx.lineWidth = 1.5; ctx.strokeRect(CX, CY, CW, CH);

    // Header
    ctx.fillStyle = "rgba(0,255,255,0.42)"; ctx.font = "10px monospace"; ctx.textAlign = "center";
    ctx.fillText("LIFEPOD  ·  BIOSCAN  ·  RESULT", GAME_W / 2, CY + 22);

    // Blurred face placeholder
    const faceCX = GAME_W / 2, faceCY = CY + 76, faceR = 32;
    const blurGrad = ctx.createRadialGradient(faceCX, faceCY, 0, faceCX, faceCY, faceR);
    blurGrad.addColorStop(0, "rgba(180,180,160,0.55)");
    blurGrad.addColorStop(0.5, "rgba(140,130,110,0.35)");
    blurGrad.addColorStop(1, "rgba(60,60,50,0.0)");
    ctx.fillStyle = blurGrad; ctx.beginPath(); ctx.arc(faceCX, faceCY, faceR, 0, Math.PI * 2); ctx.fill();
    // Motion blur strokes across face
    ctx.save(); ctx.globalAlpha = 0.18;
    for (let i = -3; i <= 3; i++) {
      ctx.fillStyle = "rgba(200,190,170,0.6)";
      ctx.fillRect(faceCX - faceR, faceCY + i * 6, faceR * 2, 3);
    }
    ctx.restore();

    // Survivor label — blinks at 1 Hz during vitals phase
    const survivorVisible = this.discoveryPhase !== "vitals" || Math.sin(t * Math.PI * 2) > 0;
    if (survivorVisible) {
      ctx.fillStyle = "rgba(150,220,255,0.82)"; ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
      ctx.fillText(survivorNum.toUpperCase(), GAME_W / 2, CY + 122);
    }

    if (this.discoveryPhase === "vitals") {
      // ── Sara vitals: level-2 concept image as dim background reference ──
      if (this.discoverySurvivor === "sara" && this.level2ConceptImg) {
        const img = this.level2ConceptImg;
        const scale = Math.max(CW / img.width, CH / img.height);
        const iw = img.width * scale, ih = img.height * scale;
        ctx.save();
        ctx.globalAlpha = 0.10;
        ctx.globalCompositeOperation = "screen";
        ctx.beginPath(); ctx.rect(CX, CY, CW, CH); ctx.clip();
        ctx.drawImage(img, CX + (CW - iw) / 2, CY + (CH - ih) / 2, iw, ih);
        ctx.restore();
      }

      // ── Mia vitals: glitch lines overlay ──
      if (this.discoverySurvivor === "mia") {
        ctx.save(); ctx.globalCompositeOperation = "destination-out";
        const glitchCount = Math.floor(3 + Math.random() * 5);
        for (let g = 0; g < glitchCount; g++) {
          const gy = Math.random() * GAME_H;
          ctx.fillStyle = `rgba(0,0,0,${0.35 + Math.random() * 0.45})`;
          ctx.fillRect(Math.random() * GAME_W * 0.3, gy, (0.25 + Math.random() * 0.6) * GAME_W, 1 + Math.random() * 3);
        }
        ctx.restore();
      }

      // ── Bioscan viewport — rectangular scan window with moving scanline ──
      const scanX = CX + 28, scanY = CY + 135, scanW = CW - 56, scanH = 68;
      ctx.save();
      ctx.strokeStyle = "rgba(0,200,200,0.28)"; ctx.lineWidth = 1;
      ctx.strokeRect(scanX, scanY, scanW, scanH);
      // Corner ticks
      const tick = 8;
      ctx.strokeStyle = "rgba(0,220,220,0.55)"; ctx.lineWidth = 1.5;
      [[scanX,scanY],[scanX+scanW,scanY],[scanX,scanY+scanH],[scanX+scanW,scanY+scanH]].forEach(([cx2,cy2],i) => {
        const sx = i % 2 === 0 ? 1 : -1, sy = i < 2 ? 1 : -1;
        ctx.beginPath(); ctx.moveTo(cx2, cy2); ctx.lineTo(cx2+sx*tick, cy2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx2, cy2); ctx.lineTo(cx2, cy2+sy*tick); ctx.stroke();
      });
      // Moving scanline — sweeps top→bottom, loops every 2s
      const scanPct = (t % 2) / 2;
      const scanLineY = scanY + scanPct * scanH;
      const scanGrad = ctx.createLinearGradient(0, scanLineY - 10, 0, scanLineY + 4);
      scanGrad.addColorStop(0, "rgba(0,255,200,0)");
      scanGrad.addColorStop(0.7, "rgba(0,255,200,0.18)");
      scanGrad.addColorStop(1, "rgba(0,255,200,0.06)");
      ctx.fillStyle = scanGrad; ctx.fillRect(scanX, scanLineY - 10, scanW, 14);
      ctx.strokeStyle = "rgba(0,255,200,0.45)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(scanX, scanLineY); ctx.lineTo(scanX + scanW, scanLineY); ctx.stroke();
      ctx.restore();

      // ── ECG flatline trace inside scan window ──
      const traceY = scanY + scanH / 2;
      const traceX0 = scanX + 6, traceX1 = scanX + scanW - 6;
      const traceW = traceX1 - traceX0;
      const decayAge = (2800 - this.discoveryTimer) / 2800;
      ctx.save();
      ctx.beginPath();
      const steps = 120;
      for (let s = 0; s <= steps; s++) {
        const px2 = traceX0 + (s / steps) * traceW;
        const nx = s / steps;
        const ghostEnv = Math.max(0, 1 - decayAge * 4) * Math.max(0, 1 - Math.abs(nx - 0.22) * 12);
        const py2 = traceY - ghostEnv * 18 * Math.sin(nx * Math.PI * 2 * 3) * (nx < 0.3 ? 1 : 0);
        if (s === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
      }
      ctx.strokeStyle = `rgba(255,60,60,${0.22 + Math.max(0, 1 - decayAge * 3) * 0.28})`; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
      // Solid flatline — glowing red
      ctx.save();
      ctx.shadowColor = "#FF0000"; ctx.shadowBlur = 6 + Math.sin(t * 5) * 3;
      ctx.strokeStyle = `rgba(255,30,30,${0.65 + Math.sin(t * 4) * 0.12})`; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(traceX0, traceY); ctx.lineTo(traceX1, traceY); ctx.stroke();
      ctx.restore();

      // ── Analog vitals needle gauge — pinned at zero ──
      const gaugeX = CX + CW - 70, gaugeY = CY + 82, gaugeR = 28;
      ctx.save();
      // Gauge face
      ctx.beginPath(); ctx.arc(gaugeX, gaugeY, gaugeR, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,4,14,0.85)"; ctx.fill();
      ctx.strokeStyle = "rgba(0,180,180,0.35)"; ctx.lineWidth = 1; ctx.stroke();
      // Tick marks
      for (let tk = 0; tk <= 10; tk++) {
        const angle = Math.PI * 0.8 + (tk / 10) * Math.PI * 1.4;
        const ir = gaugeR - (tk % 5 === 0 ? 7 : 4);
        ctx.strokeStyle = tk % 5 === 0 ? "rgba(0,200,200,0.55)" : "rgba(0,150,150,0.3)";
        ctx.lineWidth = tk % 5 === 0 ? 1.5 : 0.8;
        ctx.beginPath();
        ctx.moveTo(gaugeX + Math.cos(angle) * ir, gaugeY + Math.sin(angle) * ir);
        ctx.lineTo(gaugeX + Math.cos(angle) * (gaugeR - 2), gaugeY + Math.sin(angle) * (gaugeR - 2));
        ctx.stroke();
      }
      // Needle — pinned at zero (leftmost position = no vitals)
      const needleAngle = Math.PI * 0.8; // zero position
      ctx.strokeStyle = "#FF3333"; ctx.lineWidth = 1.5;
      ctx.shadowColor = "#FF0000"; ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(gaugeX, gaugeY);
      ctx.lineTo(gaugeX + Math.cos(needleAngle) * (gaugeR - 5), gaugeY + Math.sin(needleAngle) * (gaugeR - 5));
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Center dot
      ctx.fillStyle = "rgba(255,60,60,0.8)"; ctx.beginPath(); ctx.arc(gaugeX, gaugeY, 2.5, 0, Math.PI * 2); ctx.fill();
      // Label
      ctx.fillStyle = "rgba(0,180,180,0.45)"; ctx.font = "7px monospace"; ctx.textAlign = "center";
      ctx.fillText("BPM", gaugeX, gaugeY + gaugeR - 3);
      ctx.restore();

      // FLATLINE label
      ctx.fillStyle = "#FF2222"; ctx.font = "bold 28px monospace"; ctx.textAlign = "center";
      ctx.shadowColor = "#FF0000"; ctx.shadowBlur = 22 + Math.sin(t * 6) * 7;
      ctx.fillText("FLATLINE", GAME_W / 2, CY + 225);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,80,80,0.5)"; ctx.font = "10px monospace";
      ctx.fillText("VITAL SIGNS: NONE DETECTED", GAME_W / 2, CY + 244);
      ctx.fillStyle = "rgba(180,180,180,0.45)"; ctx.font = "italic 11px monospace";
      ctx.fillText("Survivor recovered.", GAME_W / 2, CY + 264);

    } else if (this.discoveryPhase === "farewell") {
      // Pod window message — "blood text" with smear brushstroke quality
      ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.font = "10px monospace";
      ctx.fillText("LAST RECORDED MESSAGE — POD INTERIOR", GAME_W / 2, CY + 148);

      const msgAlpha = Math.min(1, (farewellTime - this.discoveryTimer) / 700);
      const msg = this.discoveryFarewellMsg ?? "";

      // Render blood text with multiple offset layers for smear effect
      ctx.save();
      ctx.textAlign = "center";
      if (this.discoverySurvivor === "mia") {
        // Mia: shaky childlike letters — each character slightly offset
        ctx.font = "italic bold 22px Georgia, serif";
        const chars = msg.replace(/^"|"$/g, "");
        const charW = 13;
        const startX = GAME_W / 2 - (chars.length * charW) / 2;
        for (let ci = 0; ci < chars.length; ci++) {
          const jx = (Math.sin(ci * 3.7 + 1.1) * 2.8) * msgAlpha;
          const jy = (Math.cos(ci * 2.3 + 0.5) * 3.2) * msgAlpha;
          // Smear: two offset under-layers
          ctx.fillStyle = `rgba(140,20,10,${msgAlpha * 0.35})`;
          ctx.fillText(chars[ci], startX + ci * charW + 2.5 + jx, CY + 194 + 2 + jy);
          ctx.fillStyle = `rgba(180,30,15,${msgAlpha * 0.78})`;
          ctx.fillText(chars[ci], startX + ci * charW + jx, CY + 194 + jy);
        }
      } else {
        // Sara / Noah: italic handwritten smear
        ctx.font = "italic 21px Georgia, serif";
        // Smear shadow passes
        ctx.fillStyle = `rgba(130,18,8,${msgAlpha * 0.30})`; ctx.fillText(msg, GAME_W / 2 + 2.5, CY + 194 + 2.5);
        ctx.fillStyle = `rgba(160,22,10,${msgAlpha * 0.22})`; ctx.fillText(msg, GAME_W / 2 - 1.5, CY + 194 + 1.5);
        ctx.fillStyle = `rgba(200,35,20,${msgAlpha * 0.90})`; ctx.fillText(msg, GAME_W / 2, CY + 194);
      }
      ctx.restore();
    }
  }

  private renderMemoryFlash() {
    const ctx = this.hudCtx;
    const t = Date.now() / 1000;
    const a = this.memoryFlashAlpha ?? 0;

    // Always draw black — acts as the 1s silence cut and the fade envelope
    ctx.fillStyle = "rgba(0,0,0,1)"; ctx.fillRect(0, 0, GAME_W, GAME_H);
    if (a <= 0) return;

    ctx.save();
    ctx.globalAlpha = a;

    if (this.discoverySurvivor === "sara") {
      this.renderMemorySara(t);
    } else if (this.discoverySurvivor === "noah") {
      this.renderMemoryNoah(t, a);
    } else {
      this.renderMemoryMia(t);
    }

    ctx.restore();
  }

  private renderMemorySara(t: number) {
    const ctx = this.hudCtx;
    const cx = GAME_W / 2, cy = GAME_H / 2;

    if (this.flashbackSaraImg) {
      // ── Photo path: kitchen flashback photo fills canvas ──
      const img = this.flashbackSaraImg;
      // Scale to cover canvas preserving aspect ratio
      const scale = Math.max(GAME_W / img.width, GAME_H / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      const dx = (GAME_W - dw) / 2, dy = (GAME_H - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);

      // Warm film-grain overlay — faint noise canvas layer
      ctx.save();
      ctx.globalAlpha = 0.06 + Math.sin(t * 17.3) * 0.015;
      for (let gy = 0; gy < GAME_H; gy += 2) {
        for (let gx = 0; gx < GAME_W; gx += 2) {
          if (Math.random() > 0.5) {
            const v = Math.floor(Math.random() * 60);
            ctx.fillStyle = `rgba(${v + 180},${v + 140},${v + 60},0.55)`;
            ctx.fillRect(gx, gy, 2, 2);
          }
        }
      }
      ctx.restore();

      // Warm sepia overlay — push color toward kitchen warmth
      ctx.save(); ctx.globalAlpha = 0.18;
      ctx.fillStyle = "rgba(220,160,60,1)";
      ctx.globalCompositeOperation = "multiply";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.restore();

      // Soft vignette — dark edges, bright centre
      const vig = ctx.createRadialGradient(cx, cy, GAME_H * 0.2, cx, cy, GAME_H * 0.72);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.52)");
      ctx.fillStyle = vig; ctx.fillRect(0, 0, GAME_W, GAME_H);
    } else {
      // ── Procedural fallback: warm bleached kitchen-like scene ──
      const skyGrad = ctx.createLinearGradient(0, 0, 0, GAME_H);
      skyGrad.addColorStop(0, "rgba(255,248,220,1)");
      skyGrad.addColorStop(0.45, "rgba(255,220,140,0.95)");
      skyGrad.addColorStop(1, "rgba(180,130,80,0.8)");
      ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, GAME_W, GAME_H);

      const sunG = ctx.createRadialGradient(GAME_W * 0.78, GAME_H * 0.18, 0, GAME_W * 0.78, GAME_H * 0.18, 200);
      sunG.addColorStop(0, "rgba(255,255,240,0.92)"); sunG.addColorStop(0.3, "rgba(255,230,150,0.55)");
      sunG.addColorStop(1, "rgba(255,200,80,0)");
      ctx.fillStyle = sunG; ctx.fillRect(0, 0, GAME_W, GAME_H);

      // Blurred woman silhouette
      const figX = cx - 30, figY = cy + 12;
      const figGrad = ctx.createRadialGradient(figX, figY, 0, figX, figY + 20, 55);
      figGrad.addColorStop(0, "rgba(80,55,35,0.45)"); figGrad.addColorStop(1, "rgba(80,55,35,0)");
      ctx.fillStyle = figGrad; ctx.fillRect(figX - 35, figY - 45, 70, 80);
      ctx.save(); ctx.globalAlpha *= 0.38;
      for (let i = -5; i <= 5; i++) {
        ctx.fillStyle = "rgba(220,180,140,0.4)"; ctx.fillRect(figX - 28, figY - 58 + i * 5, 56, 4);
      }
      ctx.restore();

      // Vignette
      const vig = ctx.createRadialGradient(cx, cy, GAME_H * 0.25, cx, cy, GAME_H * 0.75);
      vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = vig; ctx.fillRect(0, 0, GAME_W, GAME_H);
    }

    // Film border scratch — always visible
    ctx.save(); ctx.globalAlpha = 0.06 + Math.abs(Math.sin(t * 23)) * 0.04;
    ctx.strokeStyle = "rgba(255,240,200,0.7)"; ctx.lineWidth = 1;
    const scratchX = cx + 80 + Math.sin(t * 31) * 60;
    ctx.beginPath(); ctx.moveTo(scratchX, 0); ctx.lineTo(scratchX + Math.sin(t) * 5, GAME_H); ctx.stroke();
    ctx.restore();
  }

  private renderMemoryNoah(t: number, globalAlpha: number) {
    const ctx = this.hudCtx;
    const cx = GAME_W / 2, cy = GAME_H / 2;

    if (this.flashbackNoahImg) {
      // ── Photo path: sunset dock photo fills canvas ──
      const img = this.flashbackNoahImg;
      const scale = Math.max(GAME_W / img.width, GAME_H / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      const dx = (GAME_W - dw) / 2, dy = (GAME_H - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);

      // Warm orange/gold color grade — multiply blend overlay (sunset dock vibe)
      ctx.save(); ctx.globalAlpha = 0.22;
      ctx.fillStyle = "rgba(255,140,30,1)";
      ctx.globalCompositeOperation = "multiply";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.restore();

      // Film grain
      ctx.save();
      ctx.globalAlpha = 0.05 + Math.abs(Math.sin(t * 19.7)) * 0.02;
      for (let gy = 0; gy < GAME_H; gy += 2) {
        for (let gx = 0; gx < GAME_W; gx += 2) {
          if (Math.random() > 0.5) {
            const v = Math.floor(Math.random() * 50);
            ctx.fillStyle = `rgba(${v + 200},${v + 130},${v + 40},0.55)`;
            ctx.fillRect(gx, gy, 2, 2);
          }
        }
      }
      ctx.restore();

      // Vintage vignette — stronger at corners, warm brown tone
      const vig = ctx.createRadialGradient(cx, cy, GAME_H * 0.18, cx, cy, GAME_H * 0.78);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(30,10,0,0.65)");
      ctx.fillStyle = vig; ctx.fillRect(0, 0, GAME_W, GAME_H);
    } else {
      // ── Procedural fallback: crayon submarine on paper ──
      const paper = ctx.createLinearGradient(0, 0, GAME_W, GAME_H);
      paper.addColorStop(0, "rgba(255,252,235,1)"); paper.addColorStop(1, "rgba(245,238,210,1)");
      ctx.fillStyle = paper; ctx.fillRect(0, 0, GAME_W, GAME_H);

      ctx.strokeStyle = "rgba(180,170,140,0.22)"; ctx.lineWidth = 1;
      for (let ly = 60; ly < GAME_H; ly += 28) { ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(GAME_W, ly); ctx.stroke(); }

      const subX = cx - 180, subY = cy - 55, subW = 360, subH = 80;
      for (let s = 0; s < 3; s++) {
        ctx.strokeStyle = `rgba(20,80,180,${0.55 - s * 0.12})`; ctx.lineWidth = 6 - s;
        ctx.beginPath(); ctx.roundRect(subX + s, subY + s, subW, subH, 12); ctx.stroke();
      }
      ctx.fillStyle = "rgba(60,120,220,0.12)"; ctx.beginPath(); ctx.roundRect(subX, subY, subW, subH, 12); ctx.fill();

      ctx.save(); ctx.textAlign = "center"; ctx.font = "bold 62px Georgia, serif";
      for (let ds = 2; ds >= 0; ds--) {
        ctx.fillStyle = `rgba(220,40,20,${0.72 - ds * 0.18})`;
        ctx.fillText("DAD", cx + ds * 1.5, cy + ds * 1.5);
      }
      ctx.restore();
    }

    // Glass crack effect — appears during hold phase regardless of photo/procedural
    if (this.memoryFlashPhase === "hold" || this.memoryFlashPhase === "out") {
      const crackProgress = this.memoryFlashPhase === "out" ? globalAlpha : Math.min(1, 0.7 + 0.3);
      const crackAlpha = this.memoryFlashPhase === "hold" ? Math.min(1, (1 - globalAlpha) * 3 + 0.25) : 1 - globalAlpha * 0.8;
      ctx.strokeStyle = `rgba(80,80,80,${crackAlpha * crackProgress * 0.75})`; ctx.lineWidth = 1.2;
      const cracks: [number,number,number,number][] = [
        [cx, cy-80, cx+120, cy+60], [cx, cy-80, cx-100, cy+80],
        [cx-100, cy+80, cx+120, cy+60], [cx+120, cy+60, cx+180, cy-20],
        [cx-100, cy+80, cx-160, cy+30], [cx, cy-80, cx+20, cy-160],
      ];
      for (const [x1,y1,x2,y2] of cracks) {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const midX = (x1+x2)/2, midY = (y1+y2)/2;
        ctx.beginPath(); ctx.moveTo(midX, midY);
        ctx.lineTo(midX + (y2-y1)*0.3, midY + (x1-x2)*0.3); ctx.stroke();
      }
    }
  }

  private renderMemoryMia(t: number) {
    const ctx = this.hudCtx;
    const cx = GAME_W / 2, cy = GAME_H / 2;

    // ── Warm cream background — soft-focus room ──
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, GAME_H * 0.9);
    bgGrad.addColorStop(0, "rgba(255,252,240,1)");
    bgGrad.addColorStop(0.7, "rgba(248,240,218,1)");
    bgGrad.addColorStop(1, "rgba(235,222,195,1)");
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, GAME_W, GAME_H);

    // ── White sheet of paper on the floor in front of the girl ──
    const paperX = cx - 130, paperY = cy + 30, paperW = 280, paperH = 200;
    ctx.save();
    ctx.shadowColor = "rgba(160,140,110,0.3)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.fillStyle = "rgba(255,255,250,0.96)"; ctx.fillRect(paperX, paperY, paperW, paperH);
    ctx.restore();
    // Paper edge
    ctx.strokeStyle = "rgba(220,210,190,0.6)"; ctx.lineWidth = 1;
    ctx.strokeRect(paperX, paperY, paperW, paperH);

    // ── Scattered colorful crayons on the floor around the paper ──
    const crayonColors = ["#E8332A","#2255CC","#22AA44","#DDCC11","#EE7711","#AA22CC","#FF88AA","#33BBDD"];
    const crayonData = [
      { x: paperX - 55, y: paperY + 60, rot: -0.55 },
      { x: paperX + paperW + 30, y: paperY + 40, rot: 0.38 },
      { x: paperX + 30, y: paperY + paperH + 25, rot: -0.12 },
      { x: paperX + paperW - 60, y: paperY + paperH + 28, rot: 0.65 },
      { x: paperX - 45, y: paperY + 140, rot: -0.9 },
      { x: paperX + paperW + 15, y: paperY + 120, rot: 0.25 },
      { x: cx - 10, y: paperY + paperH + 22, rot: -0.3 },
      { x: paperX + paperW + 40, y: paperY + 170, rot: -0.72 },
    ];
    for (let ci = 0; ci < crayonData.length; ci++) {
      const cd = crayonData[ci];
      const col = crayonColors[ci % crayonColors.length];
      ctx.save();
      ctx.translate(cd.x, cd.y); ctx.rotate(cd.rot);
      ctx.fillStyle = col; ctx.globalAlpha = 0.82;
      ctx.fillRect(-4, -35, 8, 40);
      ctx.fillStyle = "rgba(200,180,150,0.7)";
      ctx.fillRect(-4, -35, 8, 6);
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(-4, 5); ctx.lineTo(4, 5); ctx.lineTo(0, 16); ctx.fill();
      ctx.restore();
    }

    // ── Crayon drawings on the white paper — rough child scribbles ──
    ctx.save(); ctx.beginPath(); ctx.rect(paperX, paperY, paperW, paperH); ctx.clip();
    // House scribble
    ctx.strokeStyle = "rgba(220,50,30,0.65)"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
    const hx = paperX + 30, hy = paperY + 80;
    ctx.beginPath(); ctx.moveTo(hx, hy+60); ctx.lineTo(hx, hy); ctx.lineTo(hx+55, hy-38); ctx.lineTo(hx+110, hy); ctx.lineTo(hx+110, hy+60); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx+40, hy+60); ctx.lineTo(hx+40, hy+25); ctx.lineTo(hx+72, hy+25); ctx.lineTo(hx+72, hy+60); ctx.stroke();
    // Sun on paper
    ctx.strokeStyle = "rgba(220,180,10,0.75)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(paperX+paperW-55, paperY+45, 20, 0, Math.PI*2); ctx.stroke();
    for (let r = 0; r < 8; r++) {
      const ra = (r/8)*Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(paperX+paperW-55+Math.cos(ra)*22, paperY+45+Math.sin(ra)*22);
      ctx.lineTo(paperX+paperW-55+Math.cos(ra)*34, paperY+45+Math.sin(ra)*34);
      ctx.stroke();
    }
    ctx.restore();

    // ── Small girl silhouette — back view, hunched over drawing ──
    const gx = cx + 55, gy = cy - 30;
    // Dress/body
    ctx.save();
    ctx.fillStyle = "rgba(140,100,200,0.72)"; // purple dress silhouette
    ctx.beginPath();
    ctx.moveTo(gx - 28, gy + 90);
    ctx.quadraticCurveTo(gx - 38, gy + 55, gx - 18, gy + 20);
    ctx.quadraticCurveTo(gx, gy + 10, gx + 18, gy + 20);
    ctx.quadraticCurveTo(gx + 38, gy + 55, gx + 28, gy + 90);
    ctx.closePath(); ctx.fill();
    // Head
    ctx.fillStyle = "rgba(200,165,115,0.78)";
    ctx.beginPath(); ctx.ellipse(gx, gy + 2, 20, 22, 0, 0, Math.PI * 2); ctx.fill();
    // Hair — dark, falls forward (hunched over)
    ctx.fillStyle = "rgba(55,35,20,0.80)";
    ctx.beginPath();
    ctx.arc(gx, gy - 2, 21, Math.PI, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(gx-21, gy+2); ctx.quadraticCurveTo(gx-30, gy+30, gx-22, gy+50); ctx.lineTo(gx-14, gy+50); ctx.quadraticCurveTo(gx-20, gy+30, gx-12, gy+10); ctx.fill();
    ctx.beginPath(); ctx.moveTo(gx+21, gy+2); ctx.quadraticCurveTo(gx+30, gy+30, gx+20, gy+50); ctx.lineTo(gx+12, gy+50); ctx.quadraticCurveTo(gx+18, gy+30, gx+10, gy+10); ctx.fill();
    // Left arm reaching down to paper
    ctx.strokeStyle = "rgba(140,100,200,0.65)"; ctx.lineWidth = 10; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(gx-14, gy+36); ctx.quadraticCurveTo(gx-40, gy+60, gx-30, gy+82); ctx.stroke();
    // Tiny hand + crayon (red)
    ctx.fillStyle = "rgba(200,165,115,0.7)"; ctx.beginPath(); ctx.ellipse(gx-28, gy+86, 8, 6, -0.4, 0, Math.PI*2); ctx.fill();
    ctx.save(); ctx.translate(gx-28, gy+94); ctx.rotate(0.2);
    ctx.fillStyle = "#E8332A"; ctx.globalAlpha = 0.88; ctx.fillRect(-2, 0, 5, 18);
    ctx.fillStyle = "#E8332A"; ctx.beginPath(); ctx.moveTo(-2,18); ctx.lineTo(3,18); ctx.lineTo(0.5,26); ctx.fill();
    ctx.restore();
    ctx.restore();

    // ── Soft-focus vignette — warm edges ──
    const vig = ctx.createRadialGradient(cx, cy, GAME_H * 0.22, cx, cy, GAME_H * 0.75);
    const vp = 0.10 + Math.sin(t * 0.55) * 0.03;
    vig.addColorStop(0, "rgba(255,240,200,0)");
    vig.addColorStop(1, `rgba(180,140,80,${vp})`);
    ctx.fillStyle = vig; ctx.fillRect(0, 0, GAME_W, GAME_H);

    // ── Film grain ──
    ctx.save(); ctx.globalAlpha = 0.04 + Math.abs(Math.sin(t * 21)) * 0.015;
    for (let gy2 = 0; gy2 < GAME_H; gy2 += 3) {
      for (let gx2 = 0; gx2 < GAME_W; gx2 += 3) {
        if (Math.random() > 0.55) {
          const v = Math.floor(Math.random() * 40) + 160;
          ctx.fillStyle = `rgba(${v},${v-20},${v-50},0.5)`;
          ctx.fillRect(gx2, gy2, 3, 3);
        }
      }
    }
    ctx.restore();
  }

  // ============================================================
  // COLLAPSE SCREEN (The End)
  // ============================================================
  private renderCollapse() {
    const ctx = this.hudCtx;
    const TOTAL = 14000;
    const pct = Math.min(1, this.collapseTimer / TOTAL);

    // ── Phase 0–55%: Wireframe world fractures — dark base with tear artifacts ──
    if (pct < 0.72) {
      ctx.fillStyle = `rgba(0,0,0,${0.85 + pct * 0.14})`; ctx.fillRect(0, 0, GAME_W, GAME_H);
    }

    // Camera shake builds during fracture phase
    if (pct < 0.55) {
      const shakeStr = pct * 0.025;
      this.camera.position.x += (Math.random() - 0.5) * shakeStr;
      this.camera.position.y = 1.65 + (Math.random() - 0.5) * shakeStr * 0.5;
    }

    // ── Horizontal wireframe segment dropout + digital dust particles ──
    if (pct > 0.05 && pct < 0.58) {
      const intensity = (pct - 0.05) / 0.53;
      const tearCount = Math.floor(intensity * 32);
      ctx.save(); ctx.globalCompositeOperation = "destination-out";
      for (let i = 0; i < tearCount; i++) {
        const yPos = Math.random() * GAME_H;
        ctx.fillStyle = `rgba(0,0,0,${0.35 + Math.random() * 0.5})`;
        ctx.fillRect(Math.random() * GAME_W * 0.5, yPos, (0.2 + Math.random() * 0.8) * GAME_W, 1 + Math.random() * 3);
      }
      ctx.restore();

      // Digital dust particles drifting up as world dissolves
      ctx.save(); ctx.globalAlpha = intensity * 0.35;
      for (let d = 0; d < Math.floor(intensity * 18); d++) {
        const px2 = Math.random() * GAME_W;
        const py2 = Math.random() * GAME_H;
        ctx.fillStyle = `rgba(0,${Math.floor(Math.random()*80+80)},${Math.floor(Math.random()*100+120)},0.7)`;
        ctx.fillRect(px2, py2, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
      ctx.restore();
    }

    // ── White radial bloom — bleeds in from edges (55–72%) ──
    if (this.collapseWhite > 0) {
      // Radial from edges inward (not center outward)
      const edgeGrad = ctx.createRadialGradient(GAME_W/2, GAME_H/2, GAME_H * 0.1, GAME_W/2, GAME_H/2, GAME_H * 0.85);
      edgeGrad.addColorStop(0, `rgba(255,255,255,0)`);
      edgeGrad.addColorStop(1, `rgba(255,255,255,${this.collapseWhite})`);
      ctx.fillStyle = edgeGrad; ctx.fillRect(0, 0, GAME_W, GAME_H);
      // Then pure white flood once nearly full
      if (this.collapseWhite > 0.6) {
        ctx.fillStyle = `rgba(255,255,255,${(this.collapseWhite - 0.6) / 0.4})`; ctx.fillRect(0, 0, GAME_W, GAME_H);
      }
    }

    // ── Fade to black for end credits (86–100%) ──
    if (this.collapseBlack > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.collapseBlack})`; ctx.fillRect(0, 0, GAME_W, GAME_H);
      if (this.collapseBlack > 0.6) {
        const cardA = Math.min(1, (this.collapseBlack - 0.6) / 0.4);
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(160,155,150,${cardA * 0.55})`; ctx.font = "13px monospace";
        ctx.fillText("ECHOES  OF  THE  DEEP", GAME_W / 2, GAME_H / 2 - 8);
        ctx.fillStyle = `rgba(140,135,130,${cardA * 0.38})`; ctx.font = "10px monospace";
        ctx.fillText("2026", GAME_W / 2, GAME_H / 2 + 14);
      }
    }
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
    } else if (art === "surface") {
      ctx.fillStyle = "rgba(0,5,18,0.7)"; ctx.fillRect(x, y, w, h);
      // Stormy sky gradient
      const skyG = ctx.createLinearGradient(x, y, x, y + h * 0.55);
      skyG.addColorStop(0, "rgba(8,12,30,0.9)");
      skyG.addColorStop(1, "rgba(18,24,50,0.6)");
      ctx.fillStyle = skyG; ctx.fillRect(x, y, w, h * 0.55);
      // Ocean surface
      const seaG = ctx.createLinearGradient(x, y + h * 0.55, x, y + h);
      seaG.addColorStop(0, "rgba(0,25,80,0.88)");
      seaG.addColorStop(1, "rgba(0,5,28,0.98)");
      ctx.fillStyle = seaG; ctx.fillRect(x, y + h * 0.55, w, h * 0.45);
      // Churning wave lines
      for (let i = 0; i < 9; i++) {
        const wy = y + h * 0.52 + i * 22 + Math.sin(t * 0.55 + i * 0.9) * 7;
        const alpha = 0.12 + i * 0.025;
        ctx.strokeStyle = `rgba(80,140,255,${alpha})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x, wy);
        for (let wx = x; wx <= x + w; wx += 18)
          ctx.lineTo(wx, wy + Math.sin((wx - x) / 55 + t * 0.7 + i) * 10 + Math.sin((wx - x) / 28 + t * 0.3) * 4);
        ctx.stroke();
      }
      // Sinking boat wreckage — tilted hull
      const bx = cx - 10 + Math.sin(t * 0.4) * 4, by = y + h * 0.54 + Math.sin(t * 0.35) * 3;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(0.38 + Math.sin(t * 0.2) * 0.05);
      ctx.strokeStyle = "rgba(160,120,60,0.72)"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-46, 0); ctx.lineTo(46, 0); ctx.lineTo(32, 16); ctx.lineTo(-32, 16); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-10, -28); ctx.lineTo(12, -8); ctx.stroke();
      ctx.restore();
      // Lightning flash
      const lf = Math.max(0, Math.sin(t * 3.1 + 1.7) - 0.88) * 7;
      if (lf > 0) {
        ctx.strokeStyle = `rgba(200,220,255,${lf})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx + 80, y + 20); ctx.lineTo(cx + 60, y + 55); ctx.lineTo(cx + 72, y + 55); ctx.lineTo(cx + 48, y + 90); ctx.stroke();
      }
      // Rain streaks
      ctx.strokeStyle = "rgba(100,160,255,0.09)"; ctx.lineWidth = 1;
      for (let r = 0; r < 32; r++) {
        const rx = x + ((r * 53 + Math.floor(t * 12) * 17) % (w - 20));
        const ry = y + ((r * 37 + Math.floor(t * 12) * 11) % (h * 0.5));
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 4, ry + 16); ctx.stroke();
      }
    } else if (art === "briefing") {
      ctx.fillStyle = "rgba(2,8,20,0.85)"; ctx.fillRect(x, y, w, h);
      // Grid overlay — tactical map feel
      ctx.strokeStyle = "rgba(0,60,120,0.18)"; ctx.lineWidth = 1;
      for (let gx = x; gx <= x + w; gx += 32) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
      for (let gy = y; gy <= y + h; gy += 32) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
      // Depth contour arcs
      for (let d = 0; d < 5; d++) {
        const r = 60 + d * 55;
        const pulse = 0.08 + Math.sin(t * 0.8 + d * 0.6) * 0.04;
        ctx.strokeStyle = `rgba(0,180,255,${pulse})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy + 30, r, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
      }
      // Submarine silhouette — top-down schematic
      const subCy = cy - 10 + Math.sin(t * 0.5) * 5;
      ctx.strokeStyle = "rgba(0,220,255,0.65)"; ctx.shadowColor = "#00CCFF"; ctx.shadowBlur = 10; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, subCy, 50, 16, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx - 8, subCy - 9, 10, 5, -0.3, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      // Sonar ping from sub
      const pr3 = ((t * 55) % 180) + 20;
      const pa3 = Math.max(0, 0.4 - pr3 / 200);
      ctx.strokeStyle = `rgba(0,255,180,${pa3})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, subCy, pr3, 0, Math.PI * 2); ctx.stroke();
      // Mission coordinates block
      ctx.fillStyle = "rgba(0,30,60,0.75)"; ctx.fillRect(cx - 195, cy + 55, 170, 80);
      ctx.strokeStyle = "rgba(0,180,255,0.35)"; ctx.lineWidth = 1; ctx.strokeRect(cx - 195, cy + 55, 170, 80);
      ctx.font = "bold 9px monospace"; ctx.fillStyle = "rgba(0,220,255,0.75)"; ctx.textAlign = "left";
      ctx.fillText("MISSION ORDER — CLASSIFIED", cx - 188, cy + 70);
      ctx.fillStyle = "rgba(180,220,255,0.6)"; ctx.font = "9px monospace";
      ctx.fillText("TARGET DEPTH:  11,034 m", cx - 188, cy + 86);
      ctx.fillText("LIFE SIGNS:    3 (confirmed)", cx - 188, cy + 100);
      ctx.fillText("OPERATOR:      E. VANCE", cx - 188, cy + 114);
      ctx.fillText("STATUS:        SOLO / VOLUNTARY", cx - 188, cy + 128);
      // Blinking cursor
      if (Math.sin(t * 3) > 0) {
        ctx.fillStyle = "rgba(0,255,180,0.7)"; ctx.fillRect(cx + 25, cy + 56, 6, 10);
      }
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

    // ── Menu actions: BEGIN (Space) | SHOP (S) ─────────────────────────────
    if (Math.sin(t * 2.4) > 0) {
      ctx.shadowColor = '#00FF88'; ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(0,255,136,0.92)'; ctx.font = 'bold 17px monospace'; ctx.textAlign = 'center';
      ctx.fillText('[ PRESS SPACE OR CLICK TO BEGIN ]', GAME_W/2, CY + 4);
      ctx.shadowBlur = 0;
    }
    // Always-visible SHOP prompt (sits right below the BEGIN prompt so the
    // user cannot miss it).
    ctx.shadowColor = '#00CCFF'; ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(0,232,255,0.92)'; ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center';
    ctx.fillText('◈  PRESS  [ S ]  TO OPEN THE SHOP  ◈', GAME_W/2, CY + 24);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(160,148,100,0.48)'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    const ctrls = [
      'WASD — MOVE    SHIFT — BOOST    MOUSE — LOOK AROUND',
      'CLICK — SONAR PING    HOLD 1s — LARGE PING    F — FLARE    E — DOCK',
    ];
    ctrls.forEach((c, i) => ctx.fillText(c, GAME_W/2, CY + 50 + i * 16));

    // ── SUPPLY CACHE (STORE) BUTTON — top-right ────────────────────────────
    const profile = getPlayerProfile();
    const BTN_W = 200, BTN_H = 44;
    const BTN_X = GAME_W - BTN_W - 28;
    const BTN_Y = 28;
    this.storeBtnRect = { x: BTN_X, y: BTN_Y, w: BTN_W, h: BTN_H };

    // Button pulse
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    ctx.save();
    // Glow halo
    ctx.shadowColor = '#00CCFF'; ctx.shadowBlur = 14 + pulse * 10;
    // Button body
    ctx.fillStyle = 'rgba(0,28,48,0.85)';
    ctx.fillRect(BTN_X, BTN_Y, BTN_W, BTN_H);
    ctx.shadowBlur = 0;
    // Border
    ctx.strokeStyle = `rgba(0,232,255,${0.55 + pulse * 0.3})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(BTN_X + 0.5, BTN_Y + 0.5, BTN_W - 1, BTN_H - 1);
    // Inner border accent
    ctx.strokeStyle = 'rgba(0,232,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(BTN_X + 3.5, BTN_Y + 3.5, BTN_W - 7, BTN_H - 7);
    // Corner brackets (wireframe aesthetic)
    ctx.strokeStyle = '#00E8FF'; ctx.lineWidth = 1.5;
    const BR = 8;
    ctx.beginPath();
    ctx.moveTo(BTN_X, BTN_Y + BR); ctx.lineTo(BTN_X, BTN_Y); ctx.lineTo(BTN_X + BR, BTN_Y);
    ctx.moveTo(BTN_X + BTN_W - BR, BTN_Y); ctx.lineTo(BTN_X + BTN_W, BTN_Y); ctx.lineTo(BTN_X + BTN_W, BTN_Y + BR);
    ctx.moveTo(BTN_X + BTN_W, BTN_Y + BTN_H - BR); ctx.lineTo(BTN_X + BTN_W, BTN_Y + BTN_H); ctx.lineTo(BTN_X + BTN_W - BR, BTN_Y + BTN_H);
    ctx.moveTo(BTN_X + BR, BTN_Y + BTN_H); ctx.lineTo(BTN_X, BTN_Y + BTN_H); ctx.lineTo(BTN_X, BTN_Y + BTN_H - BR);
    ctx.stroke();
    // Label
    ctx.shadowColor = '#00CCFF'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#00E8FF';
    ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('◈  SUPPLY CACHE', BTN_X + BTN_W / 2, BTN_Y + BTN_H / 2);
    ctx.shadowBlur = 0;
    ctx.textBaseline = 'alphabetic';
    ctx.restore();

    // ── Echo balance pill (only when authenticated) ────────────────────────
    if (profile) {
      const PILL_W = 200, PILL_H = 28;
      const PILL_X = BTN_X;
      const PILL_Y = BTN_Y + BTN_H + 10;
      ctx.save();
      ctx.fillStyle = 'rgba(0,16,28,0.85)';
      ctx.fillRect(PILL_X, PILL_Y, PILL_W, PILL_H);
      ctx.strokeStyle = 'rgba(0,232,255,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(PILL_X + 0.5, PILL_Y + 0.5, PILL_W - 1, PILL_H - 1);
      // Username (left)
      ctx.fillStyle = 'rgba(127,169,185,0.85)';
      ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const uname = profile.username.length > 14 ? profile.username.slice(0, 13) + '…' : profile.username;
      ctx.fillText(uname.toUpperCase(), PILL_X + 10, PILL_Y + PILL_H / 2);
      // Balance (right)
      ctx.shadowColor = '#00CCFF'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#00E8FF';
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'right';
      ctx.fillText(`◈ ${profile.echoBalance.toLocaleString()}`, PILL_X + PILL_W - 10, PILL_Y + PILL_H / 2);
      ctx.shadowBlur = 0;
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
    }

    // ── Mission Log ── (visible only after a completed run)
    // Lazy-init: parse localStorage once per session, cache result thereafter
    if (this._completionCache === undefined) {
      this._completionCache = this._loadCompletionRecord();
    }
    const rec = this._completionCache;
    if (rec) {
      const ML_X = 36;
      const ML_Y = CY + 58;
      const ML_W = 330;
      const ML_H = 88;

      // Panel background
      ctx.fillStyle = 'rgba(0,20,10,0.72)';
      ctx.strokeStyle = 'rgba(0,200,100,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(ML_X, ML_Y, ML_W, ML_H);
      ctx.fill(); ctx.stroke();

      // Top accent bar
      ctx.fillStyle = 'rgba(0,200,100,0.18)';
      ctx.fillRect(ML_X, ML_Y, ML_W, 3);

      // Header
      ctx.shadowColor = '#00FF88'; ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(0,255,136,0.82)'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left';
      ctx.fillText('MISSION LOG  ——  COMPLETED', ML_X + 10, ML_Y + 14);
      ctx.shadowBlur = 0;

      // Timestamp
      const d = new Date(rec.completedAt);
      const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}  ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      ctx.fillStyle = 'rgba(120,160,120,0.55)'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(ts, ML_X + ML_W - 10, ML_Y + 14);

      // Divider
      ctx.strokeStyle = 'rgba(0,160,80,0.22)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ML_X + 10, ML_Y + 20); ctx.lineTo(ML_X + ML_W - 10, ML_Y + 20); ctx.stroke();

      // Level rows
      const ROW_NAMES = ['SARA', 'NOAH', 'MIA'];
      rec.levels.forEach((lvl, i) => {
        const ry = ML_Y + 33 + i * 17;
        const mins = Math.floor(lvl.time / 60);
        const secs = String(Math.floor(lvl.time % 60)).padStart(2, '0');
        const timeStr = `${mins}:${secs}`;
        const o2Str   = `O₂ ${lvl.o2}%`;

        // Name + depth
        ctx.fillStyle = 'rgba(180,220,190,0.72)'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'left';
        ctx.fillText(`${ROW_NAMES[i]}`, ML_X + 10, ry);
        ctx.fillStyle = 'rgba(120,160,130,0.50)'; ctx.font = '8px monospace';
        ctx.fillText(`${lvl.depth}`, ML_X + 48, ry);

        // Time
        ctx.fillStyle = 'rgba(140,200,160,0.60)'; ctx.textAlign = 'center';
        ctx.fillText(timeStr, ML_X + ML_W * 0.57, ry);

        // O2
        const o2Color = lvl.o2 > 50 ? 'rgba(0,220,120,0.65)' : lvl.o2 > 20 ? 'rgba(220,180,0,0.65)' : 'rgba(220,60,60,0.65)';
        ctx.fillStyle = o2Color; ctx.textAlign = 'right';
        ctx.fillText(o2Str, ML_X + ML_W - 10, ry);
      });
    }

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

    // ── Ending credits screen (post-collapse) ──
    if (this.gameOverReason === "ending") {
      ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
      const a = Math.min(1, (Date.now() - (this._endingEnteredAt ?? Date.now())) / 2000);
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(150,145,140,${a * 0.6})`; ctx.font = '15px monospace';
      ctx.fillText('ECHOES  OF  THE  DEEP', GAME_W/2, GAME_H/2 - 28);
      ctx.fillStyle = `rgba(120,115,110,${a * 0.38})`; ctx.font = '10px monospace';
      ctx.fillText('2026', GAME_W/2, GAME_H/2);
      if (a >= 1 && Math.sin(t * 1.5) > 0) {
        ctx.fillStyle = 'rgba(80,140,180,0.45)'; ctx.font = '11px monospace';
        ctx.fillText('[ PRESS SPACE TO RETURN TO MENU ]', GAME_W/2, GAME_H/2 + 44);
      }
      return;
    }

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
    ctx.fillText(`SECTOR ${['ALPHA','BETA','GAMMA'][this.lvlIdx] ?? 'UNKNOWN'}  ·  DEPTH ${[35,65,95][this.lvlIdx] ?? 0}m`, GAME_W/2, CY + CH - 10);
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
    const lvlNames = ['LEVEL I — THE ABYSSAL FOREST', 'LEVEL II — THE IRON GRAVEYARD', 'LEVEL III — THE DROWNED METROPOLIS'];
    const searchNames = ['Sara', 'Noah', 'Mia'];
    const depthVals = [35, 65, 95];
    const lvlLabel = lvlNames[this.transitionTargetLvl] ?? `LEVEL ${this.transitionTargetLvl + 1}`;
    const searchName = searchNames[this.transitionTargetLvl] ?? null;
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

    // "Searching for X…" — typewriter entrance, starts after card fades in
    if (searchName) {
      const TYPE_START = 0.15;  // card fully visible by ~0.12
      const TYPE_END   = 0.52;  // completes well before fade-out at 0.84
      if (progress >= TYPE_START) {
        const fullText   = `Searching for ${searchName}\u2026`;
        const typeT      = Math.min(1, (progress - TYPE_START) / (TYPE_END - TYPE_START));
        const charsToShow = Math.floor(typeT * fullText.length);
        const isTyping    = charsToShow < fullText.length;
        // Blinking underscore cursor at ~7 Hz while characters are still appearing
        const showCursor  = isTyping && (Math.floor(Date.now() / 75) % 2 === 0);
        const displayText = fullText.slice(0, charsToShow) + (showCursor ? '_' : '');
        ctx.shadowColor = '#C8A84B'; ctx.shadowBlur = 10;
        ctx.fillStyle = 'rgba(200,168,75,0.82)'; ctx.font = 'italic 13px monospace';
        ctx.fillText(displayText, GAME_W/2, CY + 126);
        ctx.shadowBlur = 0;
      }
    }

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
    // Base chromatic aberration
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = `rgba(255,0,0,${0.03 + Math.random()*0.04})`;
    ctx.fillRect(3, 0, GAME_W, GAME_H);
    ctx.fillStyle = `rgba(0,255,255,${0.02 + Math.random()*0.03})`;
    ctx.fillRect(-3, 0, GAME_W, GAME_H);
    ctx.globalCompositeOperation = "source-over";
    // Standard horizontal slice offsets
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
    if (this.lvlIdx === 2 && this.miaProximity > 0) { // Level 4 proximity wireframe post-FX
      const p = this.miaProximity;
      // Scanline tears: horizontal bands of darkness/static that deepen with proximity
      const tearCount = 2 + Math.floor(p * 8);
      for (let i = 0; i < tearCount; i++) {
        const ty = Math.random() * GAME_H;
        const th = 1 + Math.random() * (2 + p * 5);
        ctx.fillStyle = `rgba(0,0,0,${0.35 + Math.random() * p * 0.5})`;
        ctx.fillRect(0, ty, GAME_W, th);
      }
      // Wireframe edge breakup: thin cyan/white horizontal streaks (simulate geometry edge artifacts)
      const edgeCount = Math.floor(p * 6);
      for (let i = 0; i < edgeCount; i++) {
        const ey = Math.random() * GAME_H;
        const ew = (0.1 + Math.random() * 0.4) * GAME_W;
        const ex = Math.random() * (GAME_W - ew);
        ctx.fillStyle = `rgba(0,255,200,${0.04 + Math.random() * p * 0.10})`;
        ctx.fillRect(ex, ey, ew, 0.5 + Math.random());
      }
      // Full-screen geometry dissolve veil — increases with proximity
      if (p > 0.4) {
        const veil = (p - 0.4) / 0.6;
        ctx.fillStyle = `rgba(0,20,15,${veil * 0.18})`;
        ctx.fillRect(0, 0, GAME_W, GAME_H);
      }
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
