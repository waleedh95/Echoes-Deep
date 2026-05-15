// ============================================================
// ECHOES OF THE DEEP — 3D Renderer Upgrade
// Two.js (first-person cockpit, wireframe echolocation)
// All gameplay mechanics preserved from 2D version.
// ============================================================
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

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

interface Ping { x: number; y: number; radius: number; maxRadius: number; type: "small" | "large" | "flare" }
interface RevealObj { lines: THREE.LineSegments; mat: THREE.LineBasicMaterial; cx: number; cy: number; alpha: number; baseAlpha: number }
interface EnemyObj { group: THREE.Group; mats: THREE.LineBasicMaterial[]; label: THREE.Sprite; labelMat: THREE.SpriteMaterial }
interface PodObj { group: THREE.Group; mat: THREE.LineBasicMaterial; light: THREE.PointLight; label: THREE.Sprite; labelMat: THREE.SpriteMaterial }
interface Ping3D { sphere: THREE.Mesh; mat: THREE.MeshBasicMaterial; maxR: number; radius: number; ox: number; oy: number }
interface FlareMesh { mesh: THREE.Mesh; light: THREE.PointLight }

interface Enemy {
  x: number; y: number; type: "drifter" | "stalker" | "leviathan";
  waypoints: Vec2[]; wpIdx: number; speed: number;
  state: "patrol" | "alert" | "hunt";
  visTimer: number; hitR: number; listenTimer: number; damagedAt: number;
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

type GameState = "MENU" | "PLAYING" | "CUTSCENE" | "CHOICE" | "ENDING_A" | "ENDING_B" | "GAME_OVER";

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
    const freq = type === "small" ? 1100 : 780, dur = type === "small" ? 0.5 : 1.3;
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.28, this.ctx.currentTime + dur);
    g.gain.setValueAtTime(0.4, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.connect(g); g.connect(this.master); osc.start(); osc.stop(this.ctx.currentTime + dur);
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
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 110;
    g.gain.setValueAtTime(0.25, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
    osc.connect(g); g.connect(this.master); osc.start(); osc.stop(this.ctx.currentTime + 0.35);
  }
  flatline() {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 440; g.gain.value = 0.26;
    osc.connect(g); g.connect(this.master); osc.start(); osc.stop(this.ctx.currentTime + 4);
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

function buildObstacleEdges(rect: Rect): { lines: THREE.LineSegments; mat: THREE.LineBasicMaterial } {
  const geo = new THREE.BoxGeometry(rect.w * WS, WALL_H, rect.h * WS);
  const edges = new THREE.EdgesGeometry(geo);
  const mat = wireMat(0x00DDFF);
  const lines = new THREE.LineSegments(edges, mat);
  lines.position.set((rect.x + rect.w / 2) * WS, WALL_H / 2, (rect.y + rect.h / 2) * WS);
  return { lines, mat };
}

function buildFloorCell(cx2d: number, cy2d: number, cellW: number, cellH: number): { lines: THREE.LineSegments; mat: THREE.LineBasicMaterial } {
  const geo = new THREE.PlaneGeometry(cellW * WS, cellH * WS, 2, 2);
  const edges = new THREE.EdgesGeometry(geo);
  const mat = wireMat(0x003366);
  const lines = new THREE.LineSegments(edges, mat);
  lines.rotation.x = -Math.PI / 2;
  lines.position.set(cx2d * WS, 0.02, cy2d * WS);
  return { lines, mat };
}

function buildCeilCell(cx2d: number, cy2d: number, cellW: number, cellH: number): { lines: THREE.LineSegments; mat: THREE.LineBasicMaterial } {
  const geo = new THREE.PlaneGeometry(cellW * WS, cellH * WS, 2, 2);
  const edges = new THREE.EdgesGeometry(geo);
  const mat = wireMat(0x001133);
  const lines = new THREE.LineSegments(edges, mat);
  lines.rotation.x = Math.PI / 2;
  lines.position.set(cx2d * WS, WALL_H - 0.02, cy2d * WS);
  return { lines, mat };
}

function buildStalactite(x3d: number, z3d: number, onFloor: boolean, height: number): { lines: THREE.LineSegments; mat: THREE.LineBasicMaterial } {
  const r = 0.1 + Math.random() * 0.15;
  const geo = new THREE.ConeGeometry(r, height, 5, 1);
  const edges = new THREE.EdgesGeometry(geo);
  const mat = wireMat(0x0055AA);
  const lines = new THREE.LineSegments(edges, mat);
  lines.position.set(x3d, onFloor ? height / 2 : WALL_H - height / 2, z3d);
  if (onFloor) lines.rotation.x = Math.PI;
  return { lines, mat };
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

function buildDrifterGroup(): { group: THREE.Group; mats: THREE.LineBasicMaterial[] } {
  const group = new THREE.Group();
  const mats: THREE.LineBasicMaterial[] = [];
  const makeM = () => { const m = wireMat(0xFF3333); mats.push(m); return m; };
  const coreGeo = new THREE.IcosahedronGeometry(1.8, 0);
  const coreEdge = new THREE.EdgesGeometry(coreGeo);
  group.add(new THREE.LineSegments(coreEdge, makeM()));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, tilt = (Math.random() - 0.5) * 1.5;
    const lGeo = new THREE.CylinderGeometry(0.04, 0.18, 2.5 + Math.random() * 1.5, 4);
    const lEdge = new THREE.EdgesGeometry(lGeo);
    const l = new THREE.LineSegments(lEdge, makeM());
    l.rotation.z = tilt; l.rotation.y = a;
    l.position.set(Math.cos(a) * 0.6, Math.sin(tilt) * 0.5, Math.sin(a) * 0.6);
    group.add(l);
  }
  return { group, mats };
}

function buildStalkerGroup(): { group: THREE.Group; mats: THREE.LineBasicMaterial[] } {
  const group = new THREE.Group();
  const mats: THREE.LineBasicMaterial[] = [];
  const makeM = () => { const m = wireMat(0xFF3333); mats.push(m); return m; };
  const bGeo = new THREE.SphereGeometry(1.1, 8, 8);
  const bEdge = new THREE.EdgesGeometry(bGeo);
  const body = new THREE.LineSegments(bEdge, makeM());
  body.scale.y = 2.2;
  group.add(body);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const tGeo = new THREE.CylinderGeometry(0.025, 0.12, 2.8 + Math.random() * 1.5, 4);
    const tEdge = new THREE.EdgesGeometry(tGeo);
    const t = new THREE.LineSegments(tEdge, makeM());
    t.position.set(Math.cos(a) * 0.5, -2.4, Math.sin(a) * 0.5);
    t.rotation.z = Math.cos(a) * 0.55;
    t.rotation.x = Math.sin(a) * 0.55;
    group.add(t);
  }
  return { group, mats };
}

function buildLeviathanGroup(): { group: THREE.Group; mats: THREE.LineBasicMaterial[] } {
  const group = new THREE.Group();
  const mats: THREE.LineBasicMaterial[] = [];
  const makeM = () => { const m = wireMat(0xFF3333); mats.push(m); return m; };
  for (let i = 0; i < 12; i++) {
    const r = 3 + i * 0.55;
    const sGeo = new THREE.SphereGeometry(r, 8, 6);
    const sEdge = new THREE.EdgesGeometry(sGeo);
    const seg = new THREE.LineSegments(sEdge, makeM());
    seg.position.z = -i * 4.5;
    group.add(seg);
  }
  // Eyes — always slightly visible (emissive spheres, not wireframe)
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x00FFFF });
  const eyeG = new THREE.SphereGeometry(0.55, 10, 10);
  const eyeL = new THREE.Mesh(eyeG, eyeM); eyeL.position.set(-3, 1, 0);
  const eyeR = new THREE.Mesh(eyeG.clone(), eyeM.clone()); eyeR.position.set(3, 1, 0);
  group.add(eyeL); group.add(eyeR);
  const eyeLightL = new THREE.PointLight(0x00FFFF, 0.8, 16);
  eyeLightL.position.copy(eyeL.position); group.add(eyeLightL);
  const eyeLightR = new THREE.PointLight(0x00FFFF, 0.8, 16);
  eyeLightR.position.copy(eyeR.position); group.add(eyeLightR);
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
  const colors = [0x00FFFF, 0x00DDFF, 0x55AAFF, 0x88FF88, 0xFF88FF, 0x44FFAA];
  let mi = 0;
  const nextMat = () => {
    const m = wireMat(colors[mi++ % colors.length], 0.18);
    return m;
  };

  // Hull (long box, oriented along X — the player approaches from the front so this is broadside)
  const hullGeo = new THREE.BoxGeometry(7, 1.6, 1.8);
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(hullGeo), nextMat())).position.set(0, 0.8, 0);
  // Bow taper (front of ship)
  const bowGeo = new THREE.BoxGeometry(1.4, 1.2, 1.2);
  const bow = new THREE.LineSegments(new THREE.EdgesGeometry(bowGeo), nextMat());
  bow.position.set(4.0, 0.7, 0); group.add(bow);
  // Deck superstructure (lower)
  const deckGeo = new THREE.BoxGeometry(4.0, 0.8, 1.4);
  const deck = new THREE.LineSegments(new THREE.EdgesGeometry(deckGeo), nextMat());
  deck.position.set(-0.5, 1.95, 0); group.add(deck);
  // Bridge (raised cabin)
  const bridgeGeo = new THREE.BoxGeometry(2.0, 1.0, 1.2);
  const bridge = new THREE.LineSegments(new THREE.EdgesGeometry(bridgeGeo), nextMat());
  bridge.position.set(-0.8, 2.85, 0); group.add(bridge);
  // Smokestack
  const stackGeo = new THREE.CylinderGeometry(0.28, 0.34, 1.2, 6);
  const stack = new THREE.LineSegments(new THREE.EdgesGeometry(stackGeo), nextMat());
  stack.position.set(-1.6, 3.85, 0); group.add(stack);
  // Crane / cargo arm
  const armGeo = new THREE.BoxGeometry(2.6, 0.12, 0.12);
  const arm = new THREE.LineSegments(new THREE.EdgesGeometry(armGeo), nextMat());
  arm.position.set(1.6, 3.2, 0); arm.rotation.z = -0.35; group.add(arm);
  // Mast (tall thin pole)
  const mastGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.5, 4);
  const mast = new THREE.LineSegments(new THREE.EdgesGeometry(mastGeo), nextMat());
  mast.position.set(0.4, 4.6, 0); group.add(mast);
  // Antenna spokes
  for (let i = 0; i < 3; i++) {
    const wGeo = new THREE.BoxGeometry(0.7, 0.04, 0.04);
    const w = new THREE.LineSegments(new THREE.EdgesGeometry(wGeo), nextMat());
    w.position.set(0.4, 4.6 + i * 0.5, 0); group.add(w);
  }
  // Rails along deck
  for (let side = -1; side <= 1; side += 2) {
    const railGeo = new THREE.BoxGeometry(7, 0.04, 0.04);
    const rail = new THREE.LineSegments(new THREE.EdgesGeometry(railGeo), nextMat());
    rail.position.set(0, 1.7, side * 0.85); group.add(rail);
  }

  // Hull text plane: "RESEARCH VESSEL ODYSSEY"
  const tex = makeTextTexture("RESEARCH VESSEL\nODYSSEY", 1024, 256, "#88EEFF", true);
  const textMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
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

function buildParticles(worldW: number, worldH: number): THREE.Points {
  const count = 300;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = Math.random() * worldW * WS;
    pos[i * 3 + 1] = Math.random() * WALL_H;
    pos[i * 3 + 2] = Math.random() * worldH * WS;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0x00DDFF, size: 0.06, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  return new THREE.Points(geo, mat);
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
  private particleSystem: THREE.Points | null = null;
  private leviathanModelPromise: Promise<THREE.Object3D> | null = null;
  private levelBuildToken = 0; // bumped each build3DScene; async work compares before mutating

  private async getLeviathanModelClone(): Promise<THREE.Object3D> {
    if (!this.leviathanModelPromise) {
      const url = `${import.meta.env.BASE_URL}leviathan.glb`;
      // eslint-disable-next-line no-console
      console.log("[leviathan] loading", url);
      const p = new Promise<THREE.Object3D>((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
          url,
          (gltf) => {
            // eslint-disable-next-line no-console
            console.log("[leviathan] loaded", gltf.scene);
            resolve(gltf.scene);
          },
          (xhr) => {
            if (xhr.total) {
              // eslint-disable-next-line no-console
              console.log(`[leviathan] ${Math.round((xhr.loaded / xhr.total) * 100)}%`);
            }
          },
          (err) => {
            // eslint-disable-next-line no-console
            console.error("[leviathan] load error:", err);
            reject(err);
          },
        );
      });
      // Self-heal: on failure, clear the cache so a later level entry can retry.
      p.catch(() => { if (this.leviathanModelPromise === p) this.leviathanModelPromise = null; });
      this.leviathanModelPromise = p;
    }
    const scene = await this.leviathanModelPromise;
    return SkeletonUtils.clone(scene);
  }

  // Mouse look (camera-relative)
  private yaw = Math.PI;   // start facing into tunnel (+Z)
  private pitch = 0;

  // Audio
  private audio = new AudioSys();
  private audioReady = false;

  // State
  private state: GameState = "MENU";
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

  // Interactables
  private nearPod: Lifepod | null = null;
  private nearNoise: NoiseObj | null = null;

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
    this.scene.background = new THREE.Color(0x000510);
    this.scene.fog = new THREE.FogExp2(0x000814, 0.013);

    // Camera
    this.camera = new THREE.PerspectiveCamera(75, GAME_W / GAME_H, 0.05, 500);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    // Scene group (level geometry)
    this.sceneGroup = new THREE.Group();
    this.scene.add(this.sceneGroup);

    // Dim ambient (only affects solid cockpit)
    this.scene.add(new THREE.AmbientLight(0x081020, 0.55));
    this.scene.add(new THREE.HemisphereLight(0x113355, 0x000511, 0.35));

    // Effect composer with bloom
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(GAME_W, GAME_H), 2.1, 0.6, 0.04);
    this.composer.addPass(bloom);

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
        this.pitch += e.movementY * MOUSE_SENS;
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
    this.levPulseTimer = 8000; this.levBlocked = false;
    this.nearPod = null; this.nearNoise = null;
    this.subtitle = ""; this.subTimer = 0;

    this.enemies = def.enemyDefs.map(e => ({ ...e, state: "patrol" as const, visTimer: 0, listenTimer: 0, damagedAt: 0 }));
    this.pods = def.pods.map(p => ({ ...p }));
    this.noiseObjs = (def.noiseObjs || []).map(o => ({ ...o }));
    this.dlgQueue = [...def.dialogue];

    this.camX = def.playerStart.x; this.camY = def.playerStart.y;
    this.yaw = Math.PI;   // face +Z (into tunnel)
    this.pitch = 0;

    // Build 3D scene
    this.build3DScene(def);
    this.state = "PLAYING";
  }

  private build3DScene(def: LevelData) {
    // Bump the build token so any in-flight async work from a prior level is ignored.
    const buildToken = ++this.levelBuildToken;
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

    // Color palette for variety (rainbow wireframe vibe matching reference image)
    const wallPalette = [0x00FFFF, 0x00DDFF, 0x44AAFF, 0x66FFCC, 0xFF55CC, 0x9966FF];

    // Obstacle boxes — base alpha so always faintly visible (deep ocean glow)
    let pi = 0;
    for (const rect of def.obstacles) {
      const c = wallPalette[pi++ % wallPalette.length];
      const baseAlpha = 0; // sonar-only reveal
      const geo = new THREE.BoxGeometry(rect.w * WS, WALL_H, rect.h * WS);
      const edges = new THREE.EdgesGeometry(geo);
      const mat = wireMat(c, baseAlpha);
      const lines = new THREE.LineSegments(edges, mat);
      lines.position.set((rect.x + rect.w / 2) * WS, WALL_H / 2, (rect.y + rect.h / 2) * WS);
      this.sceneGroup.add(lines);
      this.revealObjs.push({ lines, mat, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, alpha: baseAlpha, baseAlpha });
    }

    // Floor grid cells
    const fCols = Math.ceil(def.worldW / FLOOR_CELL);
    const fRows = Math.ceil(def.worldH / FLOOR_CELL);
    for (let row = 0; row < fRows; row++) {
      for (let col = 0; col < fCols; col++) {
        const cx = (col + 0.5) * FLOOR_CELL, cy = (row + 0.5) * FLOOR_CELL;
        const cellW = Math.min(FLOOR_CELL, def.worldW - col * FLOOR_CELL);
        const cellH = Math.min(FLOOR_CELL, def.worldH - row * FLOOR_CELL);
        const { lines, mat } = buildFloorCell(cx, cy, cellW, cellH);
        mat.opacity = 0;
        this.sceneGroup.add(lines);
        this.revealObjs.push({ lines, mat, cx, cy, alpha: 0, baseAlpha: 0 });
        if ((col + row) % 2 === 0) {
          const { lines: cl, mat: cm } = buildCeilCell(cx, cy, cellW * 2, cellH * 2);
          cm.opacity = 0;
          this.sceneGroup.add(cl);
          this.revealObjs.push({ lines: cl, mat: cm, cx, cy, alpha: 0, baseAlpha: 0 });
        }
      }
    }

    // Stalactites / stalagmites
    const stalaCount = Math.floor(def.worldW * def.worldH / 40000);
    for (let i = 0; i < stalaCount; i++) {
      const x3d = (50 + Math.random() * (def.worldW - 100)) * WS;
      const z3d = (50 + Math.random() * (def.worldH - 100)) * WS;
      const h = 0.8 + Math.random() * 3;
      const onFloor = Math.random() > 0.5;
      const { lines, mat } = buildStalactite(x3d, z3d, onFloor, h);
      mat.opacity = 0;
      this.sceneGroup.add(lines);
      const cx2d = x3d / WS, cy2d = z3d / WS;
      this.revealObjs.push({ lines, mat, cx: cx2d, cy: cy2d, alpha: 0, baseAlpha: 0 });
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
        // Leviathan: load FF7 Remake GLB model (fire-and-forget; placeholder until ready)
        const group = new THREE.Group();
        built = { group, mats: [] };
        // Pulsing red rim light so it still reads on sonar
        const rim = new THREE.PointLight(0xFF3344, 1.4, 30);
        rim.position.set(0, 4, 0);
        group.add(rim);
        this.getLeviathanModelClone().then((model) => {
          // Stale-load guard: drop the result if a new level has been built since.
          if (buildToken !== this.levelBuildToken) return;
          // Auto-fit to a target size, then drop to the floor
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const targetMax = 14; // big creature
          const s = targetMax / maxDim;
          model.scale.setScalar(s);
          // Recenter horizontally + put feet on ground
          const center = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
          model.position.set(-center.x, -box.min.y * s, -center.z);
          group.add(model);
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("Failed to load leviathan model:", err);
        });
      }
      const labelY = enemy.type === "leviathan" ? 11 : 3.4;
      const label = makeBillboard("THREAT DETECTED", "#FF4444", enemy.type === "leviathan" ? 6.5 : 4.2, enemy.type === "leviathan" ? 1.4 : 1.0);
      label.position.set(0, labelY, 0);
      built.group.add(label);
      built.group.visible = false;
      this.sceneGroup.add(built.group);
      this.enemyObjs.push({ group: built.group, mats: built.mats, label, labelMat: label.material as THREE.SpriteMaterial });
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
  }

  // ============================================================
  // GAME MECHANICS (2D logic unchanged)
  // ============================================================
  private emitSonar(type: "small" | "large") {
    if (this.levBlocked) { this.showSub("[ LEVIATHAN PULSE — SONAR DISRUPTED ]"); return; }
    const maxR = type === "small" ? SONAR_SMALL_R : SONAR_LARGE_R;
    this.pings.push({ x: this.px, y: this.py, radius: 0, maxRadius: maxR, type });
    this.noise = Math.min(100, this.noise + (type === "small" ? SONAR_SMALL_NOISE : SONAR_LARGE_NOISE));
    this.audio.sonar(type);
    // 3D ping sphere
    const sphereGeo = new THREE.SphereGeometry(0.5, 14, 10);
    const smat = new THREE.MeshBasicMaterial({ color: 0x00FFFF, wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const sphere = new THREE.Mesh(sphereGeo, smat);
    sphere.position.set(this.px * WS, EYE_H, this.py * WS);
    this.scene.add(sphere);
    this.ping3Ds.push({ sphere, mat: smat, maxR: maxR * WS, radius: 0, ox: this.px, oy: this.py });
  }

  private dropFlare() {
    if (this.flares <= 0) return;
    this.flares--;
    this.flareObjs.push({ x: this.px, y: this.py, vy: 18, timer: FLARE_DURATION, pingTimer: 0 });
    this.noise = Math.min(100, this.noise + 5);
    this.audio.flare();
    // 3D flare with FLARE label and orbital ring
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0xFF6600, blending: THREE.AdditiveBlending }));
    const light = new THREE.PointLight(0xFF6600, 2.5, 40 * WS * 80);
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
    if (this.lvlIdx === 0) this.startCS(CS1, () => this.loadLevel(1));
    else if (this.lvlIdx === 1) this.startCS(CS2, () => this.loadLevel(2));
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
    if (this.state !== "PLAYING") return;

    this.lvlTime += dt / 1000;
    this.updateDialogue();
    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updatePings(dt);
    this.updateFlares(dt);
    this.updateNoise(dt);
    this.updateO2(dt);
    this.updateCamera(dt);
    this.updateInteractables();
    this.updateLeviathan(dt);
    this.updatePings3D(dt);
    this.updateFlareMeshes(dt);
    this.updateRevealFade(dt);
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
    const def = this.lvlDef!; const dtS = dt / 1000;
    const boosting = this.keys["ShiftLeft"] || this.keys["ShiftRight"];
    const spd = PLAYER_SPEED * (boosting ? PLAYER_BOOST_MULT : 1);

    // Standard FPS controls: W=forward, S=back, A=strafe-left, D=strafe-right
    // Three.js default camera forward is (0,0,-1); rotated by yaw around Y =>
    //   forward3D = (-sin(yaw), 0, -cos(yaw))
    //   right3D   = ( cos(yaw), 0, -sin(yaw))
    // 2D world maps Z->Y, so 2D forward = (-sin(yaw), -cos(yaw))
    const fwdX  = -Math.sin(this.yaw);
    const fwdY  = -Math.cos(this.yaw);
    const rgtX  =  Math.cos(this.yaw);
    const rgtY  = -Math.sin(this.yaw);
    let ax = 0, ay = 0;
    if (this.keys["KeyW"] || this.keys["ArrowUp"])    { ax += fwdX * spd; ay += fwdY * spd; }
    if (this.keys["KeyS"] || this.keys["ArrowDown"])  { ax -= fwdX * spd; ay -= fwdY * spd; }
    if (this.keys["KeyA"] || this.keys["ArrowLeft"])  { ax -= rgtX * spd; ay -= rgtY * spd; }
    if (this.keys["KeyD"] || this.keys["ArrowRight"]) { ax += rgtX * spd; ay += rgtY * spd; }

    this.pvx += ax * dtS; this.pvy += ay * dtS;
    this.pvx *= PLAYER_FRICTION; this.pvy *= PLAYER_FRICTION;
    if (boosting && (ax || ay)) this.noise = Math.min(100, this.noise + 2.5 * dtS);

    const nx = this.px + this.pvx * dtS;
    const ny = this.py + this.pvy * dtS;
    const [rx, ry] = this.collide(nx, ny, PLAYER_SIZE, def.obstacles);
    this.px = Math.max(PLAYER_SIZE + 2, Math.min(def.worldW - PLAYER_SIZE - 2, rx));
    this.py = Math.max(PLAYER_SIZE + 2, Math.min(def.worldH - PLAYER_SIZE - 2, ry));
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
        this.audio.damage(); this.showSub("[ HULL BREACH — OXYGEN DEPLETED ]");
      }
      if (this.invTimer > 0) this.invTimer -= dt;

      // Sync 3D enemy position — always render, sonar controls brightness
      if (i < this.enemyObjs.length) {
        const eobj = this.enemyObjs[i];
        const sonarA = Math.min(1, e.visTimer / 900);
        // Base dim presence (0.08 min) so creature is always faintly visible; spikes on sonar
        const a = Math.max(0.08, sonarA);
        eobj.group.visible = true;
        eobj.group.position.set(e.x * WS, EYE_H * 0.5, e.y * WS);
        eobj.group.rotation.y += 0.012;
        for (const mat of eobj.mats) mat.opacity = a * (0.7 + Math.random() * 0.3);
        // THREAT DETECTED label — only show during sonar reveal
        eobj.labelMat.opacity = sonarA * (0.65 + Math.sin(Date.now() / 180) * 0.35);
        // Boost the rim light intensity: dim always, bright on sonar
        eobj.group.traverse((child) => {
          if ((child as THREE.PointLight).isPointLight) {
            (child as THREE.PointLight).intensity = 0.3 + sonarA * 2.8;
          }
        });
      }
    }
  }

  private updatePings(dt: number) {
    const tol = 28;
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      const speed = p.type === "small" ? 210 : 290;
      p.radius += speed * (dt / 1000);

      // Reveal obstacles / floor cells
      for (const ro of this.revealObjs) {
        const d = Math.hypot(ro.cx - p.x, ro.cy - p.y);
        if (Math.abs(d - p.radius) < tol) ro.alpha = Math.max(ro.alpha, 1);
      }
      // Reveal enemies
      for (const e of this.enemies) {
        const ed = Math.hypot(e.x - p.x, e.y - p.y);
        if (Math.abs(ed - p.radius) < tol + e.hitR) e.visTimer = p.type === "small" ? 2400 : 4200;
      }
      // Reveal pods
      for (let pi = 0; pi < this.pods.length; pi++) {
        const pod = this.pods[pi];
        if (pod.rescued) continue;
        const pd = Math.hypot(pod.x - p.x, pod.y - p.y);
        if (pd <= p.radius + 30) {
          pod.revealTimer = p.type === "small" ? 3800 : 6000;
          if (pi < this.podObjs.length) this.podObjs[pi].group.visible = true;
        }
      }
      // Reveal noise objects
      for (let ni = 0; ni < this.noiseObjs.length; ni++) {
        const o = this.noiseObjs[ni];
        if (o.silenced) continue;
        const od = Math.hypot(o.x - p.x, o.y - p.y);
        if (od <= p.radius + 22) o.revealTimer = 3200;
      }

      if (p.radius >= p.maxRadius) this.pings.splice(i, 1);
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
        this.pings.push({ x: f.x, y: f.y, radius: 0, maxRadius: 130, type: "flare" });
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

  private updatePings3D(dt: number) {
    const dtS = dt / 1000;
    for (let i = this.ping3Ds.length - 1; i >= 0; i--) {
      const p3 = this.ping3Ds[i];
      const speed3d = p3.maxR < SONAR_LARGE_R * WS * 0.9 ? 10.5 : 14.5;
      p3.radius += speed3d * dtS;
      p3.sphere.scale.setScalar(p3.radius);
      p3.mat.opacity = Math.max(0, 0.35 * (1 - p3.radius / p3.maxR));
      if (p3.radius >= p3.maxR) {
        this.scene.remove(p3.sphere);
        this.ping3Ds.splice(i, 1);
      }
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
    const fadeRate = 0.55 * (dt / 1000);
    for (const ro of this.revealObjs) {
      if (ro.alpha > ro.baseAlpha) {
        ro.alpha = Math.max(ro.baseAlpha, ro.alpha - fadeRate);
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

    // Update camera from 2D position
    this.camera.position.set(this.px * WS, EYE_H, this.py * WS);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Rotate radar sweep
    if (this.cockpitSweep) this.cockpitSweep.rotation.z += 0.025;

    // Animate particles
    if (this.particleSystem) {
      const pos = (this.particleSystem.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      for (let i = 1; i < pos.length; i += 3) {
        pos[i] += 0.0015;
        if (this.lvlDef && pos[i] > WALL_H) pos[i] = 0.05;
      }
      this.particleSystem.geometry.attributes.position.needsUpdate = true;
    }

    // Render 3D scene with bloom
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

    this.renderO2(42 + gx, 42 + gy);
    this.renderNoiseBar(GAME_W - 258 + gx, 18 + gy);
    this.renderLvlName(GAME_W / 2 + gx, 18 + gy);
    this.renderFlareHUD(18, GAME_H - 28);

    if (this.nearPod) this.renderPrompt(`[E] DOCK — ${this.nearPod.character}'S POD`);
    else if (this.nearNoise) this.renderPrompt("[E] SILENCE NOISE SOURCE");
    if (this.subTimer > 0 && this.subtitle) this.renderSubtitle();

    // Low O2 vignette pulse
    if (this.o2 < 20) {
      const pulse = 0.15 + Math.sin(Date.now() / 320) * 0.12;
      ctx.fillStyle = `rgba(255,0,0,${pulse})`;
      ctx.fillRect(0, 0, GAME_W, GAME_H);
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
    ctx.fillStyle = "rgba(0,255,136,0.92)"; ctx.font = "14px monospace"; ctx.textAlign = "center";
    ctx.fillText(text, GAME_W / 2, GAME_H - 60);
  }

  private renderSubtitle() {
    const ctx = this.hudCtx; const a = Math.min(1, this.subTimer / 500);
    const maxW = 820;
    const lines = this.wrapTxt(this.subtitle, maxW); const lh = 20;
    const totH = lines.length * lh; const sy = GAME_H - 30 - totH;
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
  // MENU (on HUD canvas)
  // ============================================================
  private renderMenu() {
    const ctx = this.hudCtx; const t = Date.now() / 1000;
    const g = ctx.createRadialGradient(GAME_W/2, GAME_H/2, 0, GAME_W/2, GAME_H/2, 640);
    g.addColorStop(0, "rgba(0,5,32,0.92)"); g.addColorStop(1, "rgba(0,0,0,0.98)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, GAME_W, GAME_H);
    for (let i = 0; i < 6; i++) {
      const wy = 170 + i*90 + Math.sin(t*0.28+i)*10;
      ctx.strokeStyle = `rgba(0,80,200,${0.14+i*0.02})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, wy);
      for (let wx = 0; wx <= GAME_W; wx += 28) ctx.lineTo(wx, wy + Math.sin(wx/110+t*0.45+i)*20);
      ctx.stroke();
    }
    const pr = ((t*72) % 320)+40;
    ctx.strokeStyle = `rgba(0,255,255,${Math.max(0,0.22-pr/370)})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(GAME_W/2, GAME_H/2-70, pr, 0, Math.PI*2); ctx.stroke();
    ctx.shadowColor = "#00FFFF"; ctx.shadowBlur = 34;
    ctx.fillStyle = "#00FFFF"; ctx.font = "bold 66px monospace"; ctx.textAlign = "center";
    ctx.fillText("ECHOES", GAME_W/2, GAME_H/2-82);
    ctx.fillStyle = "rgba(0,200,255,0.72)"; ctx.font = "bold 28px monospace";
    ctx.fillText("OF THE DEEP", GAME_W/2, GAME_H/2-30); ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,200,200,0.5)"; ctx.font = "12px monospace";
    ctx.fillText("Deep-Sea Exploration  ·  Psychological Horror  ·  Puzzle-Survival", GAME_W/2, GAME_H/2+10);
    if (Math.sin(t*2.2) > 0) {
      ctx.fillStyle = "rgba(0,255,136,0.88)"; ctx.font = "15px monospace";
      ctx.fillText("[ PRESS SPACE OR CLICK TO BEGIN ]", GAME_W/2, GAME_H/2+68);
    }
    ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.font = "11px monospace";
    const ctrls = ["WASD — MOVE (W=forward, S=back, A=left, D=right)    SHIFT — BOOST",
      "CLICK — sonar ping    HOLD 1s — large ping    F — flare",
      "E — interact / dock    MOUSE — look around (voice acting on)",];
    ctrls.forEach((c,i) => ctx.fillText(c, GAME_W/2, GAME_H/2+118+i*19));
  }

  // ============================================================
  // GAME OVER (on HUD canvas)
  // ============================================================
  private renderGameOver() {
    const ctx = this.hudCtx;
    ctx.fillStyle = "rgba(0,0,0,0.95)"; ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.fillStyle = "#FF3333"; ctx.shadowColor = "#FF3333"; ctx.shadowBlur = 22;
    ctx.font = "bold 46px monospace"; ctx.textAlign = "center";
    ctx.fillText("OXYGEN DEPLETED", GAME_W/2, GAME_H/2-36); ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,200,255,0.55)"; ctx.font = "15px monospace";
    ctx.fillText('"I\'m sorry..."', GAME_W/2, GAME_H/2+10);
    if (Math.sin(Date.now()/500) > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.58)"; ctx.font = "14px monospace";
      ctx.fillText("[ PRESS SPACE TO RETRY ]", GAME_W/2, GAME_H/2+60);
    }
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
