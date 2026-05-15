// ============================================================
// ECHOES OF THE DEEP — Complete Game Engine
// HTML5 Canvas + Web Audio API
// ============================================================

const GAME_W = 1280;
const GAME_H = 720;
const PLAYER_SIZE = 15;
const PLAYER_SPEED = 190;
const PLAYER_BOOST_MULT = 2.0;
const PLAYER_FRICTION = 0.86;
const O2_DRAIN_NORMAL = 1 / 3;
const O2_DRAIN_BOOST = 1.0;
const O2_LOSS_HIT = 15;
const NOISE_DECAY = 5;
const SONAR_SMALL_R = 160;
const SONAR_LARGE_R = 360;
const SONAR_SMALL_NOISE = 5;
const SONAR_LARGE_NOISE = 25;
const SONAR_SMALL_FADE = 3500;
const SONAR_LARGE_FADE = 5500;
const FLARE_DURATION = 8000;
const FLARE_PING_INTERVAL = 1500;
const INTERACT_RADIUS = 65;

const C_ENV = "#00FFFF";
const C_SAFE = "#00FF88";
const C_DANGER = "#FF3333";
const C_PLAYER = "#00CCFF";
const C_FLARE = "#FF8800";
const C_BG = "#00000A";

// ============================================================
// TYPES
// ============================================================

interface Vec2 { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }

interface WallSeg {
  x1: number; y1: number; x2: number; y2: number;
  alpha: number;
}

interface Ping {
  x: number; y: number;
  radius: number; maxRadius: number;
  type: "small" | "large" | "flare";
}

interface Enemy {
  x: number; y: number;
  type: "drifter" | "stalker" | "leviathan";
  waypoints: Vec2[];
  wpIdx: number;
  speed: number;
  state: "patrol" | "alert" | "hunt";
  visTimer: number;
  hitR: number;
  shape: Vec2[];
  listenTimer: number;
  damagedAt: number;
}

interface Lifepod {
  x: number; y: number;
  id: string;
  rescued: boolean;
  revealTimer: number;
  character: string;
  commsLine: string;
}

interface NoiseObj {
  x: number; y: number;
  id: string;
  silenced: boolean;
  noiseRate: number;
  revealTimer: number;
}

interface Flare {
  x: number; y: number;
  vy: number;
  timer: number;
  pingTimer: number;
}

interface DialogueCue { time: number; text: string }

interface LevelData {
  id: number;
  name: string;
  worldW: number;
  worldH: number;
  playerStart: Vec2;
  obstacles: Rect[];
  enemyDefs: Array<Omit<Enemy, "state" | "visTimer" | "shape" | "listenTimer" | "damagedAt">>;
  pods: Lifepod[];
  noiseObjs?: NoiseObj[];
  o2Start: number;
  dialogue: DialogueCue[];
}

interface CutscenePanel {
  text: string;
  speaker: string;
  art: "memory1" | "memory2" | "memory3" | "hospital" | "newspaper";
  badge?: string;
}

type GameState =
  | "MENU" | "PLAYING" | "CUTSCENE"
  | "CHOICE" | "ENDING_A" | "ENDING_B"
  | "GAME_OVER" | "TRANSITION";

// ============================================================
// AUDIO
// ============================================================

class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enemyGain: GainNode | null = null;
  private breathOsc: OscillatorNode | null = null;

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.65;
    this.master.connect(this.ctx.destination);
    this.startOcean();
  }

  resume() { this.ctx?.resume(); }

  private startOcean() {
    if (!this.ctx || !this.master) return;
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    const g = this.ctx.createGain();
    g.gain.value = 0.12;
    o1.type = "sine"; o1.frequency.value = 38;
    o2.type = "sine"; o2.frequency.value = 52;
    lfo.type = "sine"; lfo.frequency.value = 0.08;
    lfoG.gain.value = 7;
    lfo.connect(lfoG);
    lfoG.connect(o1.frequency);
    lfoG.connect(o2.frequency);
    o1.connect(g); o2.connect(g);
    g.connect(this.master);
    o1.start(); o2.start(); lfo.start();

    // Noise texture
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 3, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.25;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const flt = this.ctx.createBiquadFilter();
    flt.type = "lowpass"; flt.frequency.value = 180;
    const ng = this.ctx.createGain(); ng.gain.value = 0.04;
    src.connect(flt); flt.connect(ng); ng.connect(this.master);
    src.start();
  }

  startBreathing() {
    if (!this.ctx || !this.master) return;
    this.enemyGain = this.ctx.createGain();
    this.enemyGain.gain.value = 0;
    this.enemyGain.connect(this.master);
    const osc = this.ctx.createOscillator();
    const flt = this.ctx.createBiquadFilter();
    flt.type = "bandpass"; flt.frequency.value = 350; flt.Q.value = 2;
    osc.type = "sawtooth"; osc.frequency.value = 55;
    osc.connect(flt); flt.connect(this.enemyGain);
    this.breathOsc = osc;
    osc.start();
    const breathe = () => {
      if (!this.ctx || !this.enemyGain) return;
      const t = this.ctx.currentTime;
      this.enemyGain.gain.setValueAtTime(0, t);
      this.enemyGain.gain.linearRampToValueAtTime(0.07, t + 2);
      this.enemyGain.gain.linearRampToValueAtTime(0, t + 4.2);
    };
    breathe();
    setInterval(breathe, 4200);
  }

  sonar(type: "small" | "large") {
    if (!this.ctx || !this.master) return;
    const freq = type === "small" ? 1100 : 780;
    const dur = type === "small" ? 0.5 : 1.3;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.28, this.ctx.currentTime + dur);
    g.gain.setValueAtTime(0.4, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(); osc.stop(this.ctx.currentTime + dur);
  }

  damage() {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth"; osc.frequency.value = 75;
    g.gain.setValueAtTime(0.5, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.9);
    osc.connect(g); g.connect(this.master);
    osc.start(); osc.stop(this.ctx.currentTime + 0.9);
  }

  dock() {
    if (!this.ctx || !this.master) return;
    [440, 554, 660].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      const t = this.ctx!.currentTime + i * 0.14;
      osc.frequency.value = f; osc.type = "sine";
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.28, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(g); g.connect(this.master!);
      osc.start(t); osc.stop(t + 0.6);
    });
  }

  alarm() {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "square"; osc.frequency.value = 880;
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.18, t);
    g.gain.setValueAtTime(0, t + 0.12);
    g.gain.setValueAtTime(0.18, t + 0.24);
    g.gain.setValueAtTime(0, t + 0.36);
    osc.connect(g); g.connect(this.master);
    osc.start(); osc.stop(t + 0.5);
  }

  flare() {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 110;
    g.gain.setValueAtTime(0.25, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
    osc.connect(g); g.connect(this.master);
    osc.start(); osc.stop(this.ctx.currentTime + 0.35);
  }

  flatline() {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 440;
    g.gain.value = 0.28;
    osc.connect(g); g.connect(this.master);
    osc.start(); osc.stop(this.ctx.currentTime + 4);
  }
}

// ============================================================
// LEVEL DATA
// ============================================================

function makeWalls(obs: Rect[]): WallSeg[] {
  const segs: WallSeg[] = [];
  for (const o of obs) {
    segs.push({ x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y, alpha: 0 });
    segs.push({ x1: o.x + o.w, y1: o.y, x2: o.x + o.w, y2: o.y + o.h, alpha: 0 });
    segs.push({ x1: o.x + o.w, y1: o.y + o.h, x2: o.x, y2: o.y + o.h, alpha: 0 });
    segs.push({ x1: o.x, y1: o.y + o.h, x2: o.x, y2: o.y, alpha: 0 });
  }
  return segs;
}

function makeEnemyShape(type: string): Vec2[] {
  const count = type === "leviathan" ? 18 : type === "stalker" ? 12 : 9;
  const base = type === "leviathan" ? 65 : type === "stalker" ? 26 : 20;
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const r = base * (0.5 + Math.random() * 0.9);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}

function level1(): LevelData {
  const obs: Rect[] = [
    // World boundary
    { x: 0, y: 0, w: 800, h: 50 },
    { x: 0, y: 2950, w: 800, h: 50 },
    { x: 0, y: 50, w: 50, h: 2900 },
    { x: 750, y: 50, w: 50, h: 2900 },
    // Left interior wall — corridor at x=310-490 (180px wide, centered at 400)
    { x: 50, y: 50, w: 260, h: 830 },    // y:50-880
    { x: 50, y: 1080, w: 260, h: 620 },  // y:1080-1700 (gap 880-1080 = side tunnel left)
    { x: 50, y: 1820, w: 260, h: 1130 }, // y:1820-2950
    // Right interior wall
    { x: 490, y: 50, w: 260, h: 1330 },  // y:50-1380
    { x: 490, y: 1580, w: 260, h: 1370 }, // y:1580-2950 (gap 1380-1580 = side tunnel right)
    // Left side tunnel dead end walls
    { x: 50, y: 880, w: 130, h: 40 },
    { x: 50, y: 1040, w: 130, h: 40 },
    // Right side tunnel dead end walls
    { x: 620, y: 1380, w: 130, h: 40 },
    { x: 620, y: 1540, w: 130, h: 40 },
    // Narrowing passage mid-descent
    { x: 310, y: 1700, w: 55, h: 100 },
    { x: 435, y: 1720, w: 55, h: 80 },
    // Research station ruins near pod
    { x: 330, y: 2280, w: 55, h: 45 },
    { x: 410, y: 2240, w: 70, h: 35 },
    { x: 355, y: 2360, w: 40, h: 75 },
    { x: 430, y: 2370, w: 50, h: 55 },
    { x: 310, y: 2460, w: 30, h: 60 },
    { x: 460, y: 2440, w: 30, h: 50 },
    // Scattered rocks
    { x: 330, y: 480, w: 28, h: 22 },
    { x: 440, y: 1100, w: 22, h: 28 },
    { x: 370, y: 2050, w: 30, h: 20 },
    { x: 420, y: 650, w: 20, h: 30 },
  ];

  return {
    id: 1,
    name: "LEVEL I — THE DESCENT",
    worldW: 800,
    worldH: 3000,
    playerStart: { x: 400, y: 160 },
    obstacles: obs,
    enemyDefs: [
      {
        x: 400, y: 1300,
        type: "drifter",
        waypoints: [{ x: 400, y: 1000 }, { x: 400, y: 1700 }, { x: 380, y: 1350 }, { x: 420, y: 1350 }],
        wpIdx: 0,
        speed: 38,
        hitR: 32,
      },
    ],
    pods: [
      {
        x: 400, y: 2800, id: "sara", rescued: false, revealTimer: 0,
        character: "SARA",
        commsLine: '"...is someone there?... please..."',
      },
    ],
    o2Start: 100,
    dialogue: [
      { time: 1.5, text: "TAP LEFT CLICK to emit sonar. Hold 1 second for large ping. Stay quiet." },
      { time: 9, text: 'Elias: "Rescue mission CREST-7. Descending to sector nine. Comms are degraded."' },
      { time: 22, text: 'Elias: "Oxygen nominal. Keeping the acoustic signature low."' },
      { time: 48, text: 'Elias: "Signal. Something survived down here."' },
    ],
  };
}

function level2(): LevelData {
  const obs: Rect[] = [
    // Boundary
    { x: 0, y: 0, w: 2000, h: 55 },
    { x: 0, y: 1345, w: 2000, h: 55 },
    { x: 0, y: 55, w: 55, h: 1290 },
    { x: 1945, y: 55, w: 55, h: 1290 },
    // Vertical dividers creating maze corridors
    // Divider 1: x=420, gaps at y=400-600 and y=900-1100
    { x: 420, y: 55, w: 45, h: 345 },
    { x: 420, y: 600, w: 45, h: 300 },
    { x: 420, y: 1100, w: 45, h: 245 },
    // Horizontal wall segment top-left zone
    { x: 55, y: 510, w: 145, h: 38 },
    { x: 280, y: 510, w: 90, h: 38 },
    // Divider 2: x=820, gaps at y=200-400 and y=750-950
    { x: 820, y: 55, w: 45, h: 145 },
    { x: 820, y: 400, w: 45, h: 350 },
    { x: 820, y: 950, w: 45, h: 395 },
    // Puzzle room walls (x=1040-1220, y=620-1020)
    { x: 1040, y: 620, w: 38, h: 400 },
    { x: 1220, y: 620, w: 38, h: 400 },
    { x: 1078, y: 620, w: 142, h: 38 },
    { x: 1078, y: 982, w: 142, h: 38 },
    // Divider 3: x=1440, gaps at y=310-530 and y=820-1040
    { x: 1440, y: 55, w: 45, h: 255 },
    { x: 1440, y: 530, w: 45, h: 290 },
    { x: 1440, y: 1040, w: 45, h: 305 },
    // Dead ends / extra walls
    { x: 55, y: 820, w: 220, h: 38 },
    { x: 1510, y: 280, w: 435, h: 38 },
    { x: 1600, y: 900, w: 345, h: 38 },
    // Pre-Noah passage narrowing
    { x: 1620, y: 1060, w: 325, h: 38 },
    { x: 1620, y: 1180, w: 325, h: 38 },
    // Scattered obstacles
    { x: 580, y: 200, w: 180, h: 45 },
    { x: 900, y: 1050, w: 120, h: 45 },
    { x: 1120, y: 200, w: 45, h: 260 },
    { x: 640, y: 780, w: 30, h: 30 },
    { x: 1300, y: 500, w: 25, h: 35 },
  ];

  return {
    id: 2,
    name: "LEVEL II — THE PRESSURE ZONE",
    worldW: 2000,
    worldH: 1400,
    playerStart: { x: 160, y: 200 },
    obstacles: obs,
    enemyDefs: [
      {
        x: 580, y: 220,
        type: "stalker",
        waypoints: [
          { x: 160, y: 220 }, { x: 760, y: 220 },
          { x: 760, y: 460 }, { x: 160, y: 460 },
        ],
        wpIdx: 0, speed: 62, hitR: 26,
      },
      {
        x: 1130, y: 820,
        type: "stalker",
        waypoints: [
          { x: 1085, y: 720 }, { x: 1175, y: 720 },
          { x: 1175, y: 940 }, { x: 1085, y: 940 },
        ],
        wpIdx: 0, speed: 54, hitR: 26,
      },
    ],
    pods: [
      {
        x: 1870, y: 1240, id: "noah", rescued: false, revealTimer: 0,
        character: "NOAH",
        commsLine: '"Dad? ...Dad, is that you?"',
      },
    ],
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
    // Boundary
    { x: 0, y: 0, w: 2400, h: 55 },
    { x: 0, y: 1345, w: 2400, h: 55 },
    { x: 0, y: 55, w: 55, h: 1290 },
    { x: 2345, y: 55, w: 55, h: 1290 },
    // Entry corridor narrowing
    { x: 55, y: 55, w: 65, h: 545 },
    { x: 55, y: 760, w: 65, h: 585 },
    // Cavern rock formations
    { x: 950, y: 180, w: 85, h: 210 },
    { x: 1150, y: 820, w: 105, h: 155 },
    { x: 1450, y: 260, w: 75, h: 195 },
    { x: 1640, y: 720, w: 95, h: 125 },
    { x: 1320, y: 1020, w: 125, h: 105 },
    { x: 780, y: 920, w: 55, h: 80 },
    { x: 680, y: 480, w: 50, h: 65 },
    // Near Mia — more obstacles
    { x: 1780, y: 480, w: 55, h: 80 },
    { x: 2040, y: 920, w: 65, h: 50 },
    { x: 2120, y: 380, w: 75, h: 60 },
    { x: 1870, y: 700, w: 40, h: 90 },
    // Stalactites top
    { x: 380, y: 55, w: 55, h: 130 },
    { x: 700, y: 55, w: 35, h: 105 },
    { x: 1100, y: 55, w: 60, h: 95 },
    { x: 1720, y: 55, w: 45, h: 140 },
    { x: 2020, y: 55, w: 55, h: 85 },
    // Stalactites bottom
    { x: 340, y: 1215, w: 65, h: 130 },
    { x: 820, y: 1250, w: 45, h: 95 },
    { x: 1220, y: 1230, w: 70, h: 115 },
    { x: 1920, y: 1260, w: 55, h: 85 },
  ];

  return {
    id: 3,
    name: "LEVEL III — THE ABYSS",
    worldW: 2400,
    worldH: 1400,
    playerStart: { x: 150, y: 700 },
    obstacles: obs,
    enemyDefs: [
      {
        x: 1200, y: 700,
        type: "leviathan",
        waypoints: [
          { x: 1200, y: 280 }, { x: 1820, y: 360 }, { x: 2100, y: 700 },
          { x: 1820, y: 1040 }, { x: 1200, y: 1120 }, { x: 580, y: 1040 },
          { x: 360, y: 700 }, { x: 580, y: 360 }, { x: 1200, y: 280 },
        ],
        wpIdx: 0, speed: 32, hitR: 85,
      },
    ],
    pods: [
      {
        x: 720, y: 700, id: "liam", rescued: false, revealTimer: 0,
        character: "LIAM",
        commsLine: '"It\'s dark. I don\'t like the dark."',
      },
      {
        x: 1960, y: 700, id: "mia", rescued: false, revealTimer: 0,
        character: "MIA",
        commsLine: '"The fishies are sleeping. Are you sleeping too?"',
      },
    ],
    o2Start: 68,
    dialogue: [
      { time: 2, text: 'LIAM [COMM]: "It\'s dark. I don\'t like the dark. Is someone there?"' },
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
  {
    text: "The ocean is silent.\nThe pressure builds.\nSix thousand meters and descending.",
    speaker: "NARRATOR", art: "memory1",
  },
  {
    text: '"Survivor located. Beginning dock sequence."\n\nHer vital signs are faint.\nBut she is breathing.',
    speaker: "ELIAS", art: "memory1", badge: "[ SARA — RESCUED ]",
  },
  {
    text: "A memory — unasked for:\nA boat. Afternoon light.\nA family laughing.\n\nHis hand reaches toward someone—\n\nThe image cuts to black.",
    speaker: "NARRATOR", art: "memory1",
  },
  {
    text: '"I found one."\n\nStatic.\n\n"I\'ll find the rest."',
    speaker: "ELIAS", art: "memory2",
  },
];

const CS2: CutscenePanel[] = [
  {
    text: "The debris field groans.\nMetal against stone.\nHe is somewhere behind it.",
    speaker: "NARRATOR", art: "memory2",
  },
  {
    text: "A child's drawing, remembered:\nA submarine, in blue crayon.\nTwo words beneath it:\n\n\"DAD COME HOME\"",
    speaker: "NARRATOR", art: "memory2",
  },
  {
    text: "The image cracks.\nLike glass.\nLike something that was never whole\nbut held together anyway.",
    speaker: "NARRATOR", art: "memory2",
  },
  {
    text: '"You\'re safe now."\n\nHis voice catches.\nJust for a moment.\nHe clears his throat.\n\n"I\'ve got you."',
    speaker: "ELIAS", art: "memory3", badge: "[ NOAH — RESCUED ]",
  },
];

const END_A: CutscenePanel[] = [
  {
    text: "One pod docked.\nOne pod's light goes dark.\n\nHe made his choice.\nHe begins the ascent.",
    speaker: "NARRATOR", art: "memory3",
  },
  {
    text: "The ocean dissolves.\nThe wireframes collapse.\n\nA hospital room forms\nin the silence.",
    speaker: "NARRATOR", art: "hospital",
  },
  {
    text: '"His brain activity just spiked."\n\nA pause.\n\n"Then flatlined."',
    speaker: "DOCTOR", art: "hospital",
  },
  {
    text: "A newspaper clipping:\n\n\"MAN, 38, REMAINS IN COMA AFTER BOATING ACCIDENT\nFAMILY OF FOUR PERISHED. PRONOUNCED BRAIN-DEAD TODAY.\"\n\nThe date is ten years ago.",
    speaker: "NARRATOR", art: "newspaper",
  },
  {
    text: "He saved one.\n\nIn his mind,\nthat was enough\nto finally let go.",
    speaker: "NARRATOR", art: "newspaper",
  },
];

const END_B: CutscenePanel[] = [
  {
    text: "He reroutes the oxygen.\n\nThe HUD flickers red.\nHis vision blurs at the edges.",
    speaker: "NARRATOR", art: "memory3",
  },
  {
    text: "Both pods lock in.\n\nChildren's voices —\ndistorted, dreamy:\n\n\"...Dad?\"",
    speaker: "NARRATOR", art: "memory3",
  },
  {
    text: "The wireframe ocean\ndissolves into white.\n\nEverything\ndissolves into white.",
    speaker: "NARRATOR", art: "hospital",
  },
  {
    text: "A heart monitor flatlines.\n\nThe nurse gasps.\n\nThen:\n\nSilence.",
    speaker: "NARRATOR", art: "hospital",
  },
  {
    text: "In a child's bedroom:\nthe same clipping, pinned to a corkboard.\n\nTwo crayon drawings beside it.\nTwo submarines.\nTwo stick figures inside.",
    speaker: "NARRATOR", art: "newspaper",
  },
  {
    text: "He saved them all.\n\nEven if only in the place\nthat mattered.",
    speaker: "NARRATOR", art: "newspaper",
  },
];

// ============================================================
// MAIN GAME CLASS
// ============================================================

class EchoesGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audio = new AudioSys();

  // State
  private state: GameState = "MENU";
  private lvlIdx = 0;
  private lvlDef: LevelData | null = null;
  private lvlTime = 0;

  // Player
  private px = 400; private py = 400;
  private pvx = 0;  private pvy = 0;
  private pAngle = 0;
  private o2 = 100;
  private flares = 3;
  private invTimer = 0;

  // Noise
  private noise = 0;
  private alarmTimer = 0;

  // World
  private walls: WallSeg[] = [];
  private enemies: Enemy[] = [];
  private pods: Lifepod[] = [];
  private noiseObjs: NoiseObj[] = [];
  private pings: Ping[] = [];
  private flareObjs: Flare[] = [];

  // Camera
  private camX = 400; private camY = 400;

  // Input
  private keys: Record<string, boolean> = {};
  private mouse = { x: 0, y: 0, downAt: 0, held: false };
  private audioReady = false;

  // HUD
  private subtitle = ""; private subTimer = 0;
  private dlgQueue: DialogueCue[] = [];
  private glitchTimer = 0;
  private hudGlitch = false;

  // Cutscene
  private csPanels: CutscenePanel[] = [];
  private csPanelIdx = 0;
  private csTextLen = 0;
  private csTextTimer = 0;
  private csPhase: "typing" | "waiting" = "typing";
  private csCallback: (() => void) | null = null;

  // Puzzle (level 2)
  private puzzleDone = false;

  // Level 3 choice
  private choiceVisible = false;
  private sacrificing = false;
  private transitioning = false;

  // Leviathan
  private levPulseTimer = 8000;
  private levBlocked = false;

  // Near interactable
  private nearPod: Lifepod | null = null;
  private nearNoise: NoiseObj | null = null;

  // RAF
  private rafId = 0;
  private lastT = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.setupCanvas();
    this.bindInput();
  }

  // ============================================================
  // SETUP
  // ============================================================

  private setupCanvas() {
    this.canvas.width = GAME_W;
    this.canvas.height = GAME_H;
    const resize = () => {
      const sx = window.innerWidth / GAME_W;
      const sy = window.innerHeight / GAME_H;
      const s = Math.min(sx, sy);
      this.canvas.style.width = `${GAME_W * s}px`;
      this.canvas.style.height = `${GAME_H * s}px`;
    };
    resize();
    window.addEventListener("resize", resize);
  }

  private bindInput() {
    const kd = (e: KeyboardEvent) => {
      this.keys[e.code] = true;
      this.ensureAudio();

      if (this.state === "MENU" && (e.code === "Space" || e.code === "Enter"))
        this.startGame();

      if (this.state === "CUTSCENE" && (e.code === "Space" || e.code === "Enter"))
        this.advanceCS();

      if (this.state === "ENDING_A" && (e.code === "Space" || e.code === "Enter"))
        this.advanceCS();

      if (this.state === "ENDING_B" && (e.code === "Space" || e.code === "Enter"))
        this.advanceCS();

      if (this.state === "GAME_OVER" && e.code === "Space")
        this.loadLevel(this.lvlIdx);

      if (this.state === "PLAYING") {
        if (e.code === "KeyF") this.dropFlare();
        if (e.code === "KeyE") this.interact();
      }

      if (this.state === "CHOICE") {
        if (e.code === "KeyE") this.makeChoice("A");
        if (e.code === "KeyQ") this.makeChoice("B");
        if (e.code === "KeyR") this.makeChoice("BOTH");
      }
    };
    const ku = (e: KeyboardEvent) => { this.keys[e.code] = false; };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    const mm = (e: MouseEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) * (GAME_W / r.width);
      this.mouse.y = (e.clientY - r.top) * (GAME_H / r.height);
      if (this.state === "PLAYING" || this.state === "CHOICE") {
        this.pAngle = Math.atan2(this.mouse.y - GAME_H / 2, this.mouse.x - GAME_W / 2);
      }
    };
    const md = () => {
      this.ensureAudio();
      this.mouse.held = true;
      this.mouse.downAt = Date.now();
      if (this.state === "MENU") this.startGame();
      if (this.state === "CUTSCENE" || this.state === "ENDING_A" || this.state === "ENDING_B")
        this.advanceCS();
    };
    const mu = () => {
      if (this.state === "PLAYING" && this.mouse.held) {
        const held = Date.now() - this.mouse.downAt;
        this.emitSonar(held >= 900 ? "large" : "small");
      }
      this.mouse.held = false;
    };
    this.canvas.addEventListener("mousemove", mm);
    this.canvas.addEventListener("mousedown", md);
    this.canvas.addEventListener("mouseup", mu);
  }

  private ensureAudio() {
    if (this.audioReady) return;
    this.audio.init();
    this.audio.resume();
    this.audio.startBreathing();
    this.audioReady = true;
  }

  // ============================================================
  // LEVEL MANAGEMENT
  // ============================================================

  private startGame() {
    this.loadLevel(0);
  }

  private loadLevel(idx: number) {
    this.lvlIdx = idx;
    const def = [level1(), level2(), level3()][idx];
    this.lvlDef = def;

    this.px = def.playerStart.x;
    this.py = def.playerStart.y;
    this.pvx = this.pvy = 0;
    this.o2 = def.o2Start;
    this.flares = 3;
    this.invTimer = 0;
    this.noise = 0;
    this.alarmTimer = 0;
    this.lvlTime = 0;
    this.pings = [];
    this.flareObjs = [];
    this.choiceVisible = false;
    this.sacrificing = false;
    this.transitioning = false;
    this.puzzleDone = false;
    this.levPulseTimer = 8000;
    this.levBlocked = false;
    this.nearPod = null;
    this.nearNoise = null;
    this.subtitle = "";
    this.subTimer = 0;

    this.walls = makeWalls(def.obstacles);

    this.enemies = def.enemyDefs.map(e => ({
      ...e,
      state: "patrol" as const,
      visTimer: 0,
      shape: makeEnemyShape(e.type),
      listenTimer: 0,
      damagedAt: 0,
    }));

    this.pods = def.pods.map(p => ({ ...p }));
    this.noiseObjs = (def.noiseObjs || []).map(o => ({ ...o }));
    this.dlgQueue = [...def.dialogue];

    this.camX = def.playerStart.x;
    this.camY = def.playerStart.y;

    this.state = "PLAYING";
  }

  // ============================================================
  // SONAR
  // ============================================================

  private emitSonar(type: "small" | "large") {
    if (this.levBlocked) {
      this.showSub("[ LEVIATHAN PULSE — SONAR DISRUPTED ]");
      return;
    }
    this.pings.push({
      x: this.px, y: this.py,
      radius: 0,
      maxRadius: type === "small" ? SONAR_SMALL_R : SONAR_LARGE_R,
      type,
    });
    this.noise = Math.min(100, this.noise + (type === "small" ? SONAR_SMALL_NOISE : SONAR_LARGE_NOISE));
    this.audio.sonar(type);
  }

  private dropFlare() {
    if (this.flares <= 0) return;
    this.flares--;
    this.flareObjs.push({ x: this.px, y: this.py, vy: 18, timer: FLARE_DURATION, pingTimer: 0 });
    this.noise = Math.min(100, this.noise + 5);
    this.audio.flare();
  }

  private interact() {
    if (this.transitioning) return;
    // Noise objects
    for (const o of this.noiseObjs) {
      if (o.silenced) continue;
      if (Math.hypot(o.x - this.px, o.y - this.py) < INTERACT_RADIUS) {
        o.silenced = true;
        this.showSub("[ NOISE SOURCE SILENCED ]");
        this.checkPuzzle();
        return;
      }
    }
    // Pods
    for (const p of this.pods) {
      if (p.rescued) continue;
      if (Math.hypot(p.x - this.px, p.y - this.py) < INTERACT_RADIUS) {
        // Level 2: require puzzle first for Noah
        if (this.lvlDef?.id === 2 && p.id === "noah" && !this.puzzleDone) {
          this.showSub("[ DEBRIS FIELD BLOCKING POD — SILENCE ALL NOISE SOURCES FIRST ]");
          return;
        }
        // Level 3: choice screen
        if (this.lvlDef?.id === 3) {
          this.state = "CHOICE";
          this.choiceVisible = true;
          return;
        }
        this.dockPod(p);
        return;
      }
    }
  }

  private dockPod(pod: Lifepod) {
    pod.rescued = true;
    this.o2 = Math.min(100, this.o2 + 20);
    this.showSub(pod.commsLine);
    this.audio.dock();
    if (this.pods.every(p => p.rescued)) {
      this.transitioning = true;
      setTimeout(() => this.completeLevel(), 2200);
    }
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
    this.state = "PLAYING";
    this.choiceVisible = false;
    this.transitioning = true;

    if (c === "BOTH") {
      this.sacrificing = true;
      this.showSub('Elias: "Rerouting suit oxygen... Locking both pods in."');
      for (const p of this.pods) p.rescued = true;
      setTimeout(() => {
        this.audio.flatline();
        this.startCS(END_B, () => { this.state = "MENU"; });
        this.state = "ENDING_B";
      }, 3000);
    } else {
      const podId = c === "A" ? "liam" : "mia";
      const pod = this.pods.find(p => p.id === podId)!;
      pod.rescued = true;
      this.audio.dock();
      this.showSub(`Elias: "Docking with ${pod.character}'s pod. Oxygen critical."`);
      setTimeout(() => {
        this.startCS(END_A, () => { this.state = "MENU"; });
        this.state = "ENDING_A";
      }, 3000);
    }
  }

  private triggerGameOver() {
    this.showSub('Elias: "I\'m sorry..."');
    this.transitioning = true;
    setTimeout(() => { this.state = "GAME_OVER"; }, 2200);
  }

  // ============================================================
  // CUTSCENE
  // ============================================================

  private startCS(panels: CutscenePanel[], cb: () => void) {
    this.csPanels = panels;
    this.csPanelIdx = 0;
    this.csTextLen = 0;
    this.csTextTimer = 0;
    this.csPhase = "typing";
    this.csCallback = cb;
    if (this.state !== "ENDING_A" && this.state !== "ENDING_B")
      this.state = "CUTSCENE";
  }

  private advanceCS() {
    if (this.csPhase === "typing") {
      this.csTextLen = this.csPanels[this.csPanelIdx].text.length;
      this.csPhase = "waiting";
    } else {
      this.csPanelIdx++;
      if (this.csPanelIdx >= this.csPanels.length) {
        this.csCallback?.();
        this.csCallback = null;
      } else {
        this.csTextLen = 0;
        this.csTextTimer = 0;
        this.csPhase = "typing";
      }
    }
  }

  private showSub(text: string, ms = 5000) {
    this.subtitle = text;
    this.subTimer = ms;
  }

  // ============================================================
  // UPDATE
  // ============================================================

  private update(dt: number) {
    const isCS = this.state === "CUTSCENE" || this.state === "ENDING_A" || this.state === "ENDING_B";

    if (this.state === "MENU") { return; }
    if (isCS) { this.updateCS(dt); return; }
    if (this.state === "GAME_OVER") return;
    if (this.state === "CHOICE") {
      this.updatePings(dt);
      this.updateWalls(dt);
      return;
    }
    if (this.state !== "PLAYING") return;

    this.lvlTime += dt / 1000;
    this.updateDialogue();
    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updatePings(dt);
    this.updateFlares(dt);
    this.updateNoise(dt);
    this.updateO2(dt);
    this.updateWalls(dt);
    this.updateCamera(dt);
    this.updateInteractables();
    this.updateHudGlitch(dt);
    this.updateLeviathan(dt);
    if (this.subTimer > 0) this.subTimer -= dt;
  }

  private updateDialogue() {
    for (let i = this.dlgQueue.length - 1; i >= 0; i--) {
      if (this.lvlTime >= this.dlgQueue[i].time) {
        this.showSub(this.dlgQueue[i].text, 6000);
        this.dlgQueue.splice(i, 1);
        break;
      }
    }
  }

  private updatePlayer(dt: number) {
    const def = this.lvlDef!;
    const dtS = dt / 1000;
    const boosting = this.keys["ShiftLeft"] || this.keys["ShiftRight"];
    const spd = PLAYER_SPEED * (boosting ? PLAYER_BOOST_MULT : 1);
    let ax = 0, ay = 0;
    if (this.keys["KeyW"] || this.keys["ArrowUp"]) ay -= spd;
    if (this.keys["KeyS"] || this.keys["ArrowDown"]) ay += spd;
    if (this.keys["KeyA"] || this.keys["ArrowLeft"]) ax -= spd;
    if (this.keys["KeyD"] || this.keys["ArrowRight"]) ax += spd;
    if (ax && ay) { ax *= 0.707; ay *= 0.707; }

    this.pvx += ax * dtS;
    this.pvy += ay * dtS;
    this.pvx *= PLAYER_FRICTION;
    this.pvy *= PLAYER_FRICTION;

    if (boosting && (ax || ay))
      this.noise = Math.min(100, this.noise + 2.5 * dtS);

    const nx = this.px + this.pvx * dtS;
    const ny = this.py + this.pvy * dtS;
    const [rx, ry] = this.collide(nx, ny, PLAYER_SIZE, def.obstacles);
    this.px = Math.max(PLAYER_SIZE + 2, Math.min(def.worldW - PLAYER_SIZE - 2, rx));
    this.py = Math.max(PLAYER_SIZE + 2, Math.min(def.worldH - PLAYER_SIZE - 2, ry));

    if (this.invTimer > 0) this.invTimer -= dt;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
  }

  private collide(x: number, y: number, r: number, obs: Rect[]): [number, number] {
    let rx = x, ry = y;
    for (const o of obs) {
      const cx = Math.max(o.x, Math.min(rx, o.x + o.w));
      const cy = Math.max(o.y, Math.min(ry, o.y + o.h));
      const dx = rx - cx, dy = ry - cy;
      const d = Math.hypot(dx, dy);
      if (d < r && d > 0) {
        const ov = r - d;
        rx += (dx / d) * ov;
        ry += (dy / d) * ov;
        if (Math.abs(dx) < Math.abs(dy)) this.pvx *= -0.3;
        else this.pvy *= -0.3;
      } else if (d === 0) {
        rx = o.x + o.w + r + 1;
      }
    }
    return [rx, ry];
  }

  private updateEnemies(dt: number) {
    const dtS = dt / 1000;
    for (const e of this.enemies) {
      if (e.visTimer > 0) e.visTimer -= dt;

      const dist = Math.hypot(e.x - this.px, e.y - this.py);

      // Determine state
      if (this.noise >= 61 && dist < 700) e.state = "hunt";
      else if (this.noise >= 31 && dist < 500) e.state = "alert";
      else e.state = "patrol";

      // Stalker listen pause
      if (e.type === "stalker" && e.state === "alert") {
        e.listenTimer -= dt;
        if (e.listenTimer < 0) e.listenTimer = 0;
      }

      let tx: number, ty: number, sm = 1;
      if (e.state === "hunt") {
        tx = this.px; ty = this.py; sm = 1.9;
      } else {
        const wp = e.waypoints[e.wpIdx];
        tx = wp.x; ty = wp.y;
        sm = e.state === "alert" ? 1.4 : 1;
      }

      // Stalker pauses when alert
      const pausing = e.type === "stalker" && e.state === "alert" && e.listenTimer > 0;
      if (!pausing) {
        const edx = tx - e.x, edy = ty - e.y, ed = Math.hypot(edx, edy);
        if (ed > 6) {
          e.x += (edx / ed) * e.speed * sm * dtS;
          e.y += (edy / ed) * e.speed * sm * dtS;
        } else if (e.state !== "hunt") {
          e.wpIdx = (e.wpIdx + 1) % e.waypoints.length;
          if (e.type === "stalker") e.listenTimer = 1800;
        }
      }

      // Player hit
      if (this.invTimer <= 0 && dist < e.hitR + PLAYER_SIZE * 0.8) {
        this.o2 = Math.max(0, this.o2 - O2_LOSS_HIT);
        this.invTimer = 2200;
        this.glitchTimer = 600;
        this.noise = Math.min(100, this.noise + 20);
        this.audio.damage();
        this.showSub("[ HULL BREACH — OXYGEN DEPLETED ]");
      }
    }
  }

  private updatePings(dt: number) {
    const def = this.lvlDef;
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      const speed = p.type === "small" ? 210 : 290;
      p.radius += speed * (dt / 1000);

      if (def) {
        const tol = 32;
        // Reveal walls
        for (const s of this.walls) {
          const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
          if (Math.abs(Math.hypot(mx - p.x, my - p.y) - p.radius) < tol)
            s.alpha = 1;
        }
        // Reveal enemies
        for (const e of this.enemies) {
          const ed = Math.hypot(e.x - p.x, e.y - p.y);
          if (Math.abs(ed - p.radius) < tol + e.hitR)
            e.visTimer = p.type === "small" ? 2200 : 3800;
        }
        // Reveal pods
        for (const pod of this.pods) {
          if (pod.rescued) continue;
          const pd = Math.hypot(pod.x - p.x, pod.y - p.y);
          if (pd <= p.radius + 24)
            pod.revealTimer = p.type === "small" ? 3500 : 5500;
        }
        // Reveal noise objects
        for (const o of this.noiseObjs) {
          if (o.silenced) continue;
          const od = Math.hypot(o.x - p.x, o.y - p.y);
          if (od <= p.radius + 20)
            o.revealTimer = 3000;
        }
      }

      if (p.radius >= p.maxRadius) this.pings.splice(i, 1);
    }
  }

  private updateFlares(dt: number) {
    const def = this.lvlDef!;
    for (let i = this.flareObjs.length - 1; i >= 0; i--) {
      const f = this.flareObjs[i];
      f.timer -= dt;
      f.vy += 18 * (dt / 1000);
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
    for (const o of this.noiseObjs) {
      if (!o.silenced) this.noise = Math.min(100, this.noise + o.noiseRate * (dt / 1000));
    }
  }

  private updateO2(dt: number) {
    if (this.sacrificing) return;
    const boosting = this.keys["ShiftLeft"] || this.keys["ShiftRight"];
    const mv = this.keys["KeyW"] || this.keys["KeyS"] || this.keys["KeyA"] || this.keys["KeyD"] ||
               this.keys["ArrowUp"] || this.keys["ArrowDown"] || this.keys["ArrowLeft"] || this.keys["ArrowRight"];
    const drain = (boosting && mv) ? O2_DRAIN_BOOST : O2_DRAIN_NORMAL;
    this.o2 = Math.max(0, this.o2 - drain * (dt / 1000));

    if (this.o2 < 20) {
      this.alarmTimer -= dt;
      if (this.alarmTimer <= 0) { this.alarmTimer = 2200; this.audio.alarm(); }
    }
    if (this.o2 <= 0 && !this.transitioning) this.triggerGameOver();
  }

  private updateWalls(dt: number) {
    for (const s of this.walls) if (s.alpha > 0) s.alpha = Math.max(0, s.alpha - 0.45 * (dt / 1000));
    for (const p of this.pods) if (p.revealTimer > 0) p.revealTimer -= dt;
    for (const o of this.noiseObjs) if (o.revealTimer > 0) o.revealTimer -= dt;
    for (const e of this.enemies) if (e.visTimer > 0) { /* handled in updateEnemies */ }
  }

  private updateCamera(dt: number) {
    const k = 5 * (dt / 1000);
    this.camX += (this.px - this.camX) * k;
    this.camY += (this.py - this.camY) * k;
  }

  private updateInteractables() {
    this.nearPod = null;
    this.nearNoise = null;
    if (!this.lvlDef) return;
    for (const p of this.pods) {
      if (!p.rescued && Math.hypot(p.x - this.px, p.y - this.py) < INTERACT_RADIUS) {
        this.nearPod = p; return;
      }
    }
    for (const o of this.noiseObjs) {
      if (!o.silenced && Math.hypot(o.x - this.px, o.y - this.py) < INTERACT_RADIUS) {
        this.nearNoise = o; return;
      }
    }
  }

  private updateHudGlitch(dt: number) {
    this.hudGlitch = false;
    this.glitchTimer -= dt;
    if (this.glitchTimer > 0) this.hudGlitch = true;
  }

  private updateLeviathan(dt: number) {
    if (this.lvlIdx !== 2) return;
    this.levPulseTimer -= dt;
    if (this.levPulseTimer <= 0) {
      this.levPulseTimer = 8000;
      this.levBlocked = true;
      this.glitchTimer = 1200;
      setTimeout(() => { this.levBlocked = false; }, 1100);
      this.showSub("[ LEVIATHAN PULSE — SONAR DISRUPTED ]");
    }
  }

  private updateCS(dt: number) {
    if (this.csPhase === "typing") {
      this.csTextTimer += dt;
      const chars = Math.floor(this.csTextTimer / 42);
      const max = this.csPanels[this.csPanelIdx]?.text.length ?? 0;
      if (chars >= max) {
        this.csTextLen = max;
        this.csPhase = "waiting";
      } else {
        this.csTextLen = chars;
      }
    }
    if (this.subTimer > 0) this.subTimer -= dt;
  }

  // ============================================================
  // RENDER
  // ============================================================

  private render() {
    const ctx = this.ctx;
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    if (this.state === "MENU") { this.rMenu(); return; }
    if (this.state === "CUTSCENE" || this.state === "ENDING_A" || this.state === "ENDING_B") {
      this.rCS(); return;
    }
    if (this.state === "GAME_OVER") { this.rGameOver(); return; }

    // World space
    ctx.save();
    ctx.translate(GAME_W / 2 - this.camX, GAME_H / 2 - this.camY);
    this.rWalls();
    this.rFlares();
    this.rPods();
    this.rNoiseObjs();
    this.rEnemies();
    this.rPings();
    this.rPlayer();
    ctx.restore();

    // Screen space
    this.rHUD();
    this.rScanlines();
    if (this.hudGlitch) this.rGlitch();
    if (this.state === "CHOICE") this.rChoice();
  }

  private rWalls() {
    const ctx = this.ctx;
    for (const s of this.walls) {
      if (s.alpha < 0.01) continue;
      ctx.strokeStyle = `rgba(0,255,255,${s.alpha})`;
      ctx.shadowColor = C_ENV;
      ctx.shadowBlur = s.alpha * 9;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  private rPings() {
    const ctx = this.ctx;
    for (const p of this.pings) {
      const a = Math.max(0, 1 - p.radius / p.maxRadius) * 0.45;
      const col = p.type === "flare" ? "255,136,0" : "0,255,255";
      ctx.strokeStyle = `rgba(${col},${a})`;
      ctx.shadowColor = p.type === "flare" ? C_FLARE : C_ENV;
      ctx.shadowBlur = 4;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  private rPlayer() {
    const ctx = this.ctx;
    if (this.invTimer > 0 && Math.floor(this.invTimer / 90) % 2 === 0) return;

    ctx.save();
    ctx.translate(this.px, this.py);
    ctx.rotate(this.pAngle);

    ctx.strokeStyle = C_PLAYER;
    ctx.shadowColor = C_PLAYER;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2;

    const r = PLAYER_SIZE;
    // Submarine body — hexagonal
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
      const pr = i % 2 === 0 ? r : r * 0.72;
      i === 0 ? ctx.moveTo(Math.cos(a) * pr, Math.sin(a) * pr)
              : ctx.lineTo(Math.cos(a) * pr, Math.sin(a) * pr);
    }
    ctx.closePath();
    ctx.stroke();

    // Nose
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(r + 11, -5);
    ctx.lineTo(r + 11, 5);
    ctx.closePath();
    ctx.stroke();

    // Stern fins
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, -r * 0.55);
    ctx.lineTo(-r * 1.3, -r * 0.55);
    ctx.moveTo(-r * 0.8, r * 0.55);
    ctx.lineTo(-r * 1.3, r * 0.55);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  private rEnemies() {
    const ctx = this.ctx;
    const t = Date.now() / 1000;
    for (const e of this.enemies) {
      if (e.visTimer <= 0) continue;
      const a = Math.min(1, e.visTimer / 800);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.strokeStyle = `rgba(255,51,51,${a})`;
      ctx.fillStyle = `rgba(255,51,51,${a * 0.08})`;
      ctx.shadowColor = C_DANGER;
      ctx.shadowBlur = 18 * a;
      ctx.lineWidth = 2;
      const shape = e.shape;
      ctx.beginPath();
      if (shape.length > 0) {
        const glitch = Math.sin(t * 7) * 3.5;
        ctx.moveTo(shape[0].x + glitch, shape[0].y);
        for (let i = 1; i < shape.length; i++) {
          const g = (Math.random() - 0.5) * 4;
          ctx.lineTo(shape[i].x + g, shape[i].y + g);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      // Extra wrong limbs
      const limbs = e.type === "leviathan" ? 5 : e.type === "stalker" ? 3 : 0;
      ctx.setLineDash([4, 4]);
      for (let i = 0; i < limbs; i++) {
        const la = (i / limbs) * Math.PI * 2 + t * 0.7;
        const ll = e.hitR * 1.8;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(la) * ll, Math.sin(la) * ll);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  private rPods() {
    const ctx = this.ctx;
    const t = Date.now() / 1000;
    for (const pod of this.pods) {
      if (pod.rescued) continue;
      const visible = pod.revealTimer > 0;
      if (!visible) continue;
      const a = Math.min(1, pod.revealTimer / 800);
      const pulse = 0.7 + Math.sin(t * 2.8) * 0.3;
      ctx.save();
      ctx.translate(pod.x, pod.y);
      ctx.strokeStyle = `rgba(0,255,136,${a * pulse})`;
      ctx.shadowColor = C_SAFE;
      ctx.shadowBlur = 22 * a * pulse;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 28, 19, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-12, 0); ctx.lineTo(12, 0);
      ctx.moveTo(0, -9); ctx.lineTo(0, 9);
      ctx.stroke();
      // Curled figure inside
      ctx.beginPath();
      ctx.arc(0, 3, 9, 0.1, Math.PI - 0.1);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  private rNoiseObjs() {
    const ctx = this.ctx;
    const t = Date.now() / 1000;
    for (const o of this.noiseObjs) {
      if (o.silenced || o.revealTimer <= 0) continue;
      const a = Math.min(1, o.revealTimer / 600);
      ctx.save();
      ctx.translate(o.x, o.y);
      const pulse = 0.6 + Math.sin(t * 5) * 0.4;
      ctx.strokeStyle = `rgba(255,200,0,${a * pulse})`;
      ctx.shadowColor = "#FFC800";
      ctx.shadowBlur = 12;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.beginPath();
      ctx.moveTo(-9, 0); ctx.lineTo(9, 0);
      ctx.moveTo(0, -9); ctx.lineTo(0, 9);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  private rFlares() {
    const ctx = this.ctx;
    const t = Date.now() / 1000;
    for (const f of this.flareObjs) {
      const pulse = 0.5 + Math.sin(t * 10) * 0.5;
      ctx.shadowColor = C_FLARE;
      ctx.shadowBlur = 14;
      ctx.fillStyle = `rgba(255,150,0,${pulse})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // ============================================================
  // HUD
  // ============================================================

  private rHUD() {
    if (this.state !== "PLAYING" && this.state !== "CHOICE") return;
    const gx = this.hudGlitch ? (Math.random() - 0.5) * 7 : 0;
    const gy = this.hudGlitch ? (Math.random() - 0.5) * 3 : 0;
    this.rO2(42 + gx, 42 + gy);
    this.rNoiseBar(GAME_W - 258 + gx, 18 + gy);
    this.rLvlName(GAME_W / 2 + gx, 18 + gy);
    this.rFlareHUD(18, GAME_H - 28);
    if (this.nearPod) this.rPrompt(`[E] DOCK — ${this.nearPod.character}'S POD`);
    else if (this.nearNoise) this.rPrompt("[E] SILENCE NOISE SOURCE");
    if (this.subTimer > 0 && this.subtitle) this.rSubtitle();
  }

  private rO2(cx: number, cy: number) {
    const ctx = this.ctx;
    const r = 32, o = this.o2 / 100;
    ctx.strokeStyle = "rgba(0,255,255,0.12)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
    const col = o > 0.5 ? "#00FF88" : o > 0.2 ? "#FFD700" : "#FF3333";
    ctx.strokeStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 9;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + o * Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#AAFFFF";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText("O2", cx, cy + 4);
    ctx.font = "9px monospace";
    ctx.fillText(`${Math.ceil(this.o2)}%`, cx, cy + 15);
  }

  private rNoiseBar(x: number, y: number) {
    const ctx = this.ctx;
    const w = 228, h = 18, n = this.noise / 100;
    ctx.fillStyle = "rgba(0,255,255,0.7)";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText("ACOUSTIC SIGNATURE", x, y + 10);
    ctx.fillStyle = "rgba(0,255,255,0.08)";
    ctx.fillRect(x, y + 14, w, h);
    const col = n <= 0.3 ? "#00FF88" : n <= 0.6 ? "#FFD700" : n <= 0.8 ? "#FF8800" : "#FF3333";
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 5;
    ctx.fillRect(x, y + 14, w * n, h);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y + 14, w, h);
    // Threshold lines
    ctx.strokeStyle = "rgba(255,255,100,0.35)";
    for (const pct of [0.3, 0.6, 0.8]) {
      ctx.beginPath();
      ctx.moveTo(x + w * pct, y + 14);
      ctx.lineTo(x + w * pct, y + 14 + h);
      ctx.stroke();
    }
    const label = n <= 0.3 ? "SAFE" : n <= 0.6 ? "CAUTION" : n <= 0.8 ? "DANGER" : "CRITICAL";
    ctx.fillStyle = col;
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.fillText(label, x + w, y + 46);
  }

  private rLvlName(cx: number, y: number) {
    if (!this.lvlDef) return;
    const ctx = this.ctx;
    let txt = this.lvlDef.name;
    if (this.hudGlitch && Math.random() < 0.4)
      txt = txt.replace(/[AEIOU]/g, () => String.fromCharCode(65 + Math.random() * 26));
    ctx.fillStyle = "rgba(0,255,255,0.65)";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(txt, cx, y + 14);
  }

  private rFlareHUD(x: number, y: number) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,255,255,0.6)";
    ctx.font = "12px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`FLARES: ${this.flares}`, x, y);
  }

  private rPrompt(text: string) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,255,136,0.9)";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, GAME_W / 2, GAME_H - 60);
  }

  private rSubtitle() {
    const ctx = this.ctx;
    const a = Math.min(1, this.subTimer / 500);
    const maxW = 820;
    const lines = this.wrapTxt(this.subtitle, maxW);
    const lh = 20;
    const totH = lines.length * lh;
    const sy = GAME_H - 30 - totH;

    ctx.fillStyle = `rgba(0,0,0,${a * 0.65})`;
    ctx.fillRect(GAME_W / 2 - maxW / 2 - 12, sy - 6, maxW + 24, totH + 12);
    ctx.fillStyle = `rgba(255,255,255,${a * 0.9})`;
    ctx.font = "13px monospace";
    ctx.textAlign = "center";
    for (let i = 0; i < lines.length; i++)
      ctx.fillText(lines[i], GAME_W / 2, sy + i * lh + 14);
  }

  private wrapTxt(text: string, maxW: number): string[] {
    const ctx = this.ctx;
    ctx.font = "13px monospace";
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur); cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ============================================================
  // CHOICE SCREEN
  // ============================================================

  private rChoice() {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    const px = 180, py = 165, pw = GAME_W - 360, ph = GAME_H - 330;
    ctx.fillStyle = "rgba(0,0,20,0.92)";
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = "#00FFFF";
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    ctx.fillStyle = "#FF3333";
    ctx.font = "bold 15px monospace";
    ctx.textAlign = "center";
    ctx.fillText("⚠  OXYGEN CRITICAL  —  DECISION REQUIRED  ⚠", GAME_W / 2, py + 40);

    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "13px monospace";
    ctx.fillText("Two lifepods detected. Oxygen insufficient for sequential rescue.", GAME_W / 2, py + 72);

    ctx.fillStyle = "#00FF88";
    ctx.font = "14px monospace";
    ctx.fillText("[E]  DOCK WITH POD A — Save LIAM   (O2: 12%)", GAME_W / 2, py + 120);
    ctx.fillText("[Q]  DOCK WITH POD B — Save MIA    (O2: 12%)", GAME_W / 2, py + 158);

    ctx.fillStyle = "#FFD700";
    ctx.fillText("[R]  REROUTE SUIT OXYGEN — Save BOTH  (Elias will not survive)", GAME_W / 2, py + 208);

    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.font = "11px monospace";
    ctx.fillText('LIAM  (Pod A)  — Age 7 — "It\'s dark. I don\'t like the dark."', GAME_W / 2, py + 252);
    ctx.fillText('MIA   (Pod B)  — Age 5 — "The fishies are sleeping. Are you sleeping too?"', GAME_W / 2, py + 274);
  }

  // ============================================================
  // CUTSCENE RENDER
  // ============================================================

  private rCS() {
    if (this.csPanelIdx >= this.csPanels.length) return;
    const ctx = this.ctx;
    const panel = this.csPanels[this.csPanelIdx];
    const t = Date.now() / 1000;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    const px = 90, py = 55, pw = GAME_W - 180, ph = GAME_H - 110;
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 4;
    ctx.strokeRect(px, py, pw, ph);

    // Art
    this.rCSArt(panel.art, px, py, pw, ph, t);

    // Gradient
    const g = ctx.createLinearGradient(px, py + ph - 220, px, py + ph);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.96)");
    ctx.fillStyle = g;
    ctx.fillRect(px, py + ph - 220, pw, 220);

    // Speaker
    if (panel.speaker !== "NARRATOR") {
      ctx.fillStyle = "#00FFFF";
      ctx.font = "bold 13px monospace";
      ctx.textAlign = "left";
      ctx.fillText(panel.speaker, px + 22, py + ph - 170);
    }

    // Text
    const display = panel.text.substring(0, this.csTextLen);
    ctx.fillStyle = "#FFF";
    ctx.font = "15px Georgia, serif";
    ctx.textAlign = "left";
    let lineY = py + ph - 148;
    for (const line of display.split("\n")) {
      ctx.fillText(line, px + 22, lineY);
      lineY += 23;
    }

    // Badge
    if (panel.badge && this.csPhase === "waiting") {
      ctx.fillStyle = "#00FF88";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(panel.badge, GAME_W / 2, py + ph - 16);
    }

    // Continue
    if (this.csPhase === "waiting" && Math.sin(t * 3) > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "11px monospace";
      ctx.textAlign = "right";
      ctx.fillText("[ SPACE / CLICK ] continue", px + pw - 18, py + ph - 16);
    }

    // Panel counter
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${this.csPanelIdx + 1} / ${this.csPanels.length}`, px + 18, py + 18);

    // Neon accent
    ctx.strokeStyle = "#00FFFF";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py + 28); ctx.lineTo(px + pw * 0.35, py + 28);
    ctx.stroke();

    this.rScanlines();
  }

  private rCSArt(art: string, x: number, y: number, w: number, h: number, t: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 2, y + 2, w - 4, h - 4);
    ctx.clip();
    const cx = x + w / 2, cy = y + h / 2 - 50;

    if (art === "memory1") {
      // Deep ocean descent
      for (let i = 0; i < 7; i++) {
        const wy = y + 60 + i * 45 + Math.sin(t * 0.4 + i) * 9;
        ctx.strokeStyle = `rgba(0,80,180,${0.15 + i * 0.03})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, wy);
        for (let wx = x; wx <= x + w; wx += 22)
          ctx.lineTo(wx, wy + Math.sin((wx - x) / 65 + t * 0.5 + i) * 16);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(0,200,255,0.55)";
      ctx.shadowColor = "#00CCFF"; ctx.shadowBlur = 12; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 85, 32, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx + 35, cy - 18, 22, 11, -0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Debris particles
      for (let i = 0; i < 18; i++) {
        const px2 = x + (i * 139 % w);
        const py2 = y + ((i * 223 + t * 28) % h);
        ctx.fillStyle = `rgba(0,180,255,0.18)`;
        ctx.fillRect(px2, py2, 2, 2);
      }

    } else if (art === "memory2") {
      // Cracking memory — family silhouettes
      ctx.fillStyle = "rgba(0,0,10,0.5)";
      ctx.fillRect(x, y, w, h);
      // Crack lines
      const cracks: [number, number, number, number][] = [
        [cx, cy - 65, cx + 85, cy + 45],
        [cx, cy - 65, cx - 65, cy + 65],
        [cx - 65, cy + 65, cx + 85, cy + 45],
        [cx + 85, cy + 45, cx + 130, cy - 25],
        [cx - 65, cy + 65, cx - 110, cy + 18],
      ];
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      for (const c of cracks) {
        ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(c[2], c[3]); ctx.stroke();
      }
      // Family figures
      const figs = [[cx - 55, cy], [cx - 12, cy], [cx + 22, cy - 5], [cx + 55, cy + 5]];
      ctx.strokeStyle = "rgba(0,255,136,0.5)"; ctx.lineWidth = 2;
      for (const [fx, fy] of figs) {
        ctx.beginPath(); ctx.arc(fx, fy - 22, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(fx, fy - 13); ctx.lineTo(fx, fy + 12); ctx.stroke();
      }
      ctx.font = "bold 17px Georgia, serif";
      ctx.fillStyle = "rgba(255,220,50,0.55)";
      ctx.textAlign = "center";
      ctx.fillText("DAD COME HOME", cx, cy + 68);

    } else if (art === "memory3") {
      // The abyss with two pods
      ctx.fillStyle = "rgba(0,0,25,0.6)"; ctx.fillRect(x, y, w, h);
      const pods: [number, number][] = [[cx - 110, cy + 25], [cx + 110, cy + 25]];
      for (const [px2, py2] of pods) {
        const pulse = 0.65 + Math.sin(t * 2.2) * 0.35;
        ctx.strokeStyle = `rgba(0,255,136,${pulse * 0.72})`;
        ctx.shadowColor = C_SAFE; ctx.shadowBlur = 22 * pulse; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(px2, py2, 38, 24, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // Submarine descending toward them
      const subY = cy - 50 + Math.sin(t * 0.6) * 8;
      ctx.strokeStyle = "rgba(0,200,255,0.6)"; ctx.shadowColor = "#00CCFF"; ctx.shadowBlur = 9; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, subY, 22, 9, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      // Leviathan hint
      const la = t * 0.15;
      ctx.strokeStyle = "rgba(255,50,50,0.12)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, 180, la, la + Math.PI * 1.2); ctx.stroke();

    } else if (art === "hospital") {
      ctx.fillStyle = "rgba(210,210,195,0.12)"; ctx.fillRect(x, y, w, h);
      // Room
      ctx.strokeStyle = "rgba(160,160,145,0.5)"; ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - 250, cy + 20, 500, 120);
      // Bed
      ctx.strokeRect(cx - 110, cy + 30, 220, 65);
      // Figure
      ctx.beginPath(); ctx.arc(cx - 65, cy + 55, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 52, cy + 58); ctx.lineTo(cx + 90, cy + 62); ctx.stroke();
      // EKG
      ctx.strokeStyle = "rgba(0,200,100,0.55)"; ctx.lineWidth = 1.5;
      const ekg = [0, 0, 0, 12, -14, 36, 0, 0, 0, 0, 9, -18, 0, 0, 0, 0];
      ctx.beginPath(); ctx.moveTo(cx - 90, cy - 55);
      for (let i = 0; i < ekg.length; i++) ctx.lineTo(cx - 90 + i * 14, cy - 55 + ekg[i]);
      ctx.stroke();
      // Monitor glow
      ctx.fillStyle = "rgba(0,200,100,0.08)";
      ctx.fillRect(cx - 95, cy - 80, 210, 50);
      // Scanlines
      for (let sy2 = y; sy2 < y + h; sy2 += 4) {
        ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect(x, sy2, w, 2);
      }

    } else if (art === "newspaper") {
      ctx.fillStyle = "rgba(200,190,162,0.18)"; ctx.fillRect(cx - 210, cy - 115, 420, 215);
      ctx.strokeStyle = "rgba(140,130,110,0.55)"; ctx.lineWidth = 1; ctx.strokeRect(cx - 210, cy - 115, 420, 215);
      ctx.fillStyle = "rgba(50,40,30,0.8)";
      ctx.font = "bold 11px serif"; ctx.textAlign = "center";
      ctx.fillText("THE MARIANA TIMES", cx, cy - 95);
      ctx.fillStyle = "rgba(190,182,155,0.6)"; ctx.fillRect(cx - 205, cy - 87, 410, 1);
      ctx.font = "bold 10.5px serif"; ctx.fillStyle = "rgba(35,25,18,0.9)";
      ctx.fillText("MAN REMAINS IN COMA AFTER BOATING ACCIDENT", cx, cy - 72);
      ctx.font = "9.5px serif"; ctx.fillStyle = "rgba(35,25,18,0.75)";
      ctx.fillText("Family of four perished. Sole survivor unresponsive.", cx, cy - 52);
      ctx.fillText("Declared brain-dead. Hospital staff report minimal activity.", cx, cy - 34);
      ctx.fillText("He was 38 years old.", cx, cy - 16);
      ctx.fillStyle = "rgba(190,182,155,0.6)"; ctx.fillRect(cx - 205, cy - 8, 410, 1);
      ctx.font = "9px serif"; ctx.fillStyle = "rgba(35,25,18,0.6)";
      ctx.fillText("He is survived by... he survived them all.", cx, cy + 10);
    }

    ctx.restore();
  }

  // ============================================================
  // MENU
  // ============================================================

  private rMenu() {
    const ctx = this.ctx;
    const t = Date.now() / 1000;

    // Background gradient
    const g = ctx.createRadialGradient(GAME_W / 2, GAME_H / 2, 0, GAME_W / 2, GAME_H / 2, 640);
    g.addColorStop(0, "#000520"); g.addColorStop(1, "#000000");
    ctx.fillStyle = g; ctx.fillRect(0, 0, GAME_W, GAME_H);

    // Wave lines
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const wy = 170 + i * 90 + Math.sin(t * 0.28 + i) * 10;
      ctx.strokeStyle = `rgba(0,80,200,${0.14 + i * 0.02})`;
      ctx.beginPath(); ctx.moveTo(0, wy);
      for (let wx = 0; wx <= GAME_W; wx += 28)
        ctx.lineTo(wx, wy + Math.sin(wx / 110 + t * 0.45 + i) * 20);
      ctx.stroke();
    }

    // Expanding ping decoration
    const pr = ((t * 72) % 320) + 40;
    ctx.strokeStyle = `rgba(0,255,255,${Math.max(0, 0.22 - pr / 370)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(GAME_W / 2, GAME_H / 2 - 70, pr, 0, Math.PI * 2); ctx.stroke();
    const pr2 = ((t * 72 + 160) % 320) + 40;
    ctx.strokeStyle = `rgba(0,255,255,${Math.max(0, 0.12 - pr2 / 370)})`;
    ctx.beginPath(); ctx.arc(GAME_W / 2, GAME_H / 2 - 70, pr2, 0, Math.PI * 2); ctx.stroke();

    // Title
    ctx.shadowColor = "#00FFFF"; ctx.shadowBlur = 32;
    ctx.fillStyle = "#00FFFF";
    ctx.font = "bold 66px monospace";
    ctx.textAlign = "center";
    ctx.fillText("ECHOES", GAME_W / 2, GAME_H / 2 - 85);
    ctx.fillStyle = "rgba(0,200,255,0.72)";
    ctx.font = "bold 28px monospace";
    ctx.fillText("OF THE DEEP", GAME_W / 2, GAME_H / 2 - 32);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(0,200,200,0.5)";
    ctx.font = "12px monospace";
    ctx.fillText("Deep-Sea Exploration  ·  Psychological Horror  ·  Puzzle-Survival", GAME_W / 2, GAME_H / 2 + 8);

    if (Math.sin(t * 2.2) > 0) {
      ctx.fillStyle = "rgba(0,255,136,0.85)";
      ctx.font = "15px monospace";
      ctx.fillText("[ PRESS SPACE OR CLICK TO BEGIN ]", GAME_W / 2, GAME_H / 2 + 68);
    }

    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.font = "11px monospace";
    const ctrls = [
      "WASD — MOVE        SHIFT — BOOST (loud!)",
      "CLICK — SONAR PING        HOLD 1s — LARGE PING",
      "F — DROP FLARE        E — INTERACT / DOCK",
    ];
    ctrls.forEach((c, i) => ctx.fillText(c, GAME_W / 2, GAME_H / 2 + 118 + i * 19));

    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.font = "10px monospace";
    ctx.fillText("Mouse controls submarine direction", GAME_W / 2, GAME_H / 2 + 184);

    this.rScanlines();
  }

  // ============================================================
  // GAME OVER
  // ============================================================

  private rGameOver() {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.96)";
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.fillStyle = "#FF3333";
    ctx.shadowColor = "#FF3333"; ctx.shadowBlur = 22;
    ctx.font = "bold 46px monospace";
    ctx.textAlign = "center";
    ctx.fillText("OXYGEN DEPLETED", GAME_W / 2, GAME_H / 2 - 36);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,200,255,0.55)";
    ctx.font = "15px monospace";
    ctx.fillText('"I\'m sorry..."', GAME_W / 2, GAME_H / 2 + 10);
    if (Math.sin(Date.now() / 500) > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.58)";
      ctx.font = "14px monospace";
      ctx.fillText("[ PRESS SPACE TO RETRY ]", GAME_W / 2, GAME_H / 2 + 60);
    }
    this.rScanlines();
  }

  // ============================================================
  // OVERLAYS
  // ============================================================

  private rScanlines() {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.038)";
    for (let y = 0; y < GAME_H; y += 3) ctx.fillRect(0, y, GAME_W, 1);
  }

  private rGlitch() {
    const ctx = this.ctx;
    for (let i = 0; i < 3; i++) {
      const gy = Math.random() * GAME_H;
      const gh = Math.random() * 22 + 4;
      const gx = (Math.random() - 0.5) * 22;
      try {
        const d = ctx.getImageData(0, gy, GAME_W, gh);
        ctx.clearRect(0, gy, GAME_W, gh);
        ctx.putImageData(d, gx, gy);
      } catch (_) { /* cross-origin guard */ }
    }
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "rgba(255,0,0,0.04)";
    ctx.fillRect(3, 0, GAME_W, GAME_H);
    ctx.globalCompositeOperation = "source-over";
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
    this.lastT = performance.now();
    this.loop(this.lastT);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
  }
}

// ============================================================
// EXPORT
// ============================================================

export function initGame(canvas: HTMLCanvasElement): () => void {
  const game = new EchoesGame(canvas);
  game.start();
  return () => game.destroy();
}
