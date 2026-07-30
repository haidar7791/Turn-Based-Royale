import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

// ══════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════
const CONFIG = {
  MAP_SIZE: 400,
  TERRAIN_SEGMENTS: 80,
  TERRAIN_HEIGHT: 20,
  TREE_COUNT: 200,
  BUILDING_COUNT: 30,

  TOTAL_BOTS: 99,
  RENDER_BOTS: 22,
  PLAYER_SPEED: 8,
  PLAYER_RUN_SPEED: 15,
  PLAYER_HEIGHT: 1.8,
  CROUCH_HEIGHT: 1.1,
  JUMP_FORCE: 7,

  ZONE_INITIAL_RADIUS: 185,
  ZONE_MIN_RADIUS: 18,
  ZONE_SHRINK_RATE: 0.012,
  ZONE_DAMAGE_RATE: 6,
  ZONE_SHRINK_INTERVAL: 40,

  WEAPONS: {
    AK47:    { name: 'AK-47',   damage: 35,  range: 150, firerate: 0.12, recoil: 0.035, ammoType: '7.62mm',  magSize: 30, color: '#2a2a2a' },
    M416:    { name: 'M416',    damage: 28,  range: 180, firerate: 0.09, recoil: 0.022, ammoType: '5.56mm',  magSize: 30, color: '#1a1a2a' },
    AWM:     { name: 'AWM',     damage: 120, range: 400, firerate: 1.8,  recoil: 0.08,  ammoType: '.300Mag', magSize: 5,  color: '#0a1a0a' },
    UZI:     { name: 'UZI',     damage: 18,  range: 80,  firerate: 0.06, recoil: 0.018, ammoType: '9mm',     magSize: 25, color: '#2a1a0a' },
    SHOTGUN: { name: 'Shotgun', damage: 80,  range: 30,  firerate: 0.9,  recoil: 0.07,  ammoType: '12gauge', magSize: 6,  color: '#1a0a0a' },
  } as Record<string, { name:string; damage:number; range:number; firerate:number; recoil:number; ammoType:string; magSize:number; color:string }>,

  LOOT_COUNT: 70,
  BOT_SPEED: 3.5,
  BOT_SIGHT_RANGE: 60,
  BOT_SHOOT_RANGE: 50,
  BOT_ACCURACY: 0.3,
  BOT_REACTION_TIME: 0.9,
  BOT_COVER_RANGE: 35,

  SQUAD_COLORS: ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#c77dff','#ff9f43','#00d2d3','#ff6348'],
};

// ══════════════════════════════════════════════════════════
//  TYPES
// ══════════════════════════════════════════════════════════
type WeaponKey = keyof typeof CONFIG.WEAPONS;
type GamePhase = 'menu' | 'playing' | 'dead' | 'winner';

interface BotData {
  id: number;
  mesh: THREE.Group;
  hitbox: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  hp: number; maxHp: number;
  weapon: WeaponKey;
  currentAmmo: number;
  state: 'patrol' | 'chase' | 'attack' | 'flee' | 'cover';
  targetPos: THREE.Vector3;
  stateTimer: number;
  shootTimer: number;
  squad: number;
  alive: boolean;
  updateAccum: number;
  animTime: number;
  coverPoint: THREE.Vector3 | null;
  peekTimer: number;
  isPeeking: boolean;
}

interface BuildingAABB { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number; }
interface CoverPoint { pos: THREE.Vector3; occupiedBy: number; }

interface LootBox {
  id: number; mesh: THREE.Mesh;
  position: THREE.Vector3;
  weaponType: WeaponKey;
  picked: boolean;
}

interface Particle { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; maxLife: number; }
interface KillEntry { text: string; id: number; }

interface UIState {
  hp: number; maxHp: number;
  armor: number; armorLevel: number;
  currentWeapon: WeaponKey;
  currentAmmo: number; reserveAmmo: number;
  ammoType: string;
  isReloading: boolean; reloadProgress: number;
  bandages: number; healthKits: number;
  playersAlive: number; elapsed: number; kills: number;
  phase: GamePhase;
  zoneRadius: number; zoneWarning: boolean; zoneShrinking: boolean;
  nearLoot: string | null;
  hitMarker: boolean; isADS: boolean;
  kills_feed: KillEntry[];
  spread: boolean;
  inventoryOpen: boolean;
  weaponSlots: (WeaponKey | null)[];
  isCrouching: boolean; isSprinting: boolean;
}

// ══════════════════════════════════════════════════════════
//  NOISE
// ══════════════════════════════════════════════════════════
const noise2D = createNoise2D();

function getTerrainHeight(x: number, z: number): number {
  return (
    noise2D(x / 80, z / 80) * 0.6 +
    noise2D(x / 30, z / 30) * 0.3 +
    noise2D(x / 10, z / 10) * 0.1
  ) * CONFIG.TERRAIN_HEIGHT;
}

// ══════════════════════════════════════════════════════════
//  AUDIO
// ══════════════════════════════════════════════════════════
let audioCtx: AudioContext | null = null;
function getAudioCtx() { if (!audioCtx) audioCtx = new AudioContext(); return audioCtx; }
function playGunshot(type: WeaponKey) {
  try {
    const ctx = getAudioCtx();
    const bufSize = Math.floor(ctx.sampleRate * 0.18);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2.2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = type === 'SHOTGUN' ? 180 : type === 'AWM' ? 1400 : type === 'UZI' ? 550 : 750;
    filt.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (type === 'AWM' ? 0.65 : 0.3));
    src.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
    src.start();
  } catch (_) {}
}
function playHitMarker() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.frequency.value = 1100; osc.type = 'square';
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.07);
  } catch (_) {}
}
function playZoneBeep() {
  try {
    const ctx = getAudioCtx();
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 440 + i * 220; o.type = 'sine';
      const t = ctx.currentTime + i * 0.25;
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.22);
    }
  } catch (_) {}
}
function playReloadSound() {
  try {
    const ctx = getAudioCtx();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 180; o.type = 'square';
    g.gain.setValueAtTime(0.07, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.12);
  } catch (_) {}
}
function playFootstep() {
  try {
    const ctx = getAudioCtx();
    const bufSize = Math.floor(ctx.sampleRate * 0.06);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 1.5) * 0.15;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 300;
    const g = ctx.createGain(); g.gain.value = 0.4;
    src.connect(filt); filt.connect(g); g.connect(ctx.destination);
    src.start();
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
const WEAPON_KEYS = Object.keys(CONFIG.WEAPONS) as WeaponKey[];
function randomWeapon(): WeaponKey { return WEAPON_KEYS[Math.floor(Math.random() * WEAPON_KEYS.length)]; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function BatmosGame() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const minimapRef  = useRef<HTMLCanvasElement>(null);
  const threeRef    = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    clock: THREE.Clock;
    weaponGroup: THREE.Group;
    zoneRing: THREE.Mesh;
    muzzleLight: THREE.PointLight;
    playerHitbox: THREE.Mesh;
    bots: BotData[];
    lootBoxes: LootBox[];
    particles: Particle[];
    hitboxMeshes: THREE.Mesh[];
    buildingAABBs: BuildingAABB[];
    coverPoints: CoverPoint[];
    frameId: number;
    uiTimer: ReturnType<typeof setInterval>;
    minimapTimer: ReturnType<typeof setInterval>;
    botKillTimer: ReturnType<typeof setInterval>;
  } | null>(null);

  const gs = useRef({
    phase: 'menu' as GamePhase,
    hp: 100, maxHp: 100,
    armor: 0, armorLevel: 0,
    helmet: 0, helmetLevel: 0,
    position: new THREE.Vector3(0, 30, 10),
    velocity: new THREE.Vector3(),
    isGrounded: false,
    isSprinting: false,
    isCrouching: false,
    currentWeapon: 'AK47' as WeaponKey,
    weaponSlots: ['AK47', null, null] as (WeaponKey | null)[],
    currentAmmo: 30, reserveAmmo: 90,
    isReloading: false, reloadTimer: 0,
    bandages: 2, healthKits: 0,
    kills: 0, playersAlive: 100,
    elapsed: 0, yaw: 0, pitch: 0,
    recoilPitch: 0, recoilYaw: 0,
    shootCooldown: 0,
    isADS: false, currentFOV: 75,
    zone: { radius: CONFIG.ZONE_INITIAL_RADIUS, target: CONFIG.ZONE_INITIAL_RADIUS, cx: 0, cz: 0, timer: CONFIG.ZONE_SHRINK_INTERVAL, shrinking: false },
    keys: new Set<string>(),
    nearLootId: -1,
    hitMarkerTimer: 0, zoneShrinkBannerTimer: 0,
    footAccum: 0, killFeed: [] as KillEntry[], killFeedId: 0,
    spreadTimer: 0,
    inventoryOpen: false,
    shakeTimer: 0, shakeAmt: 0,
  });

  const [webglError, setWebglError] = useState(false);
  const [ui, setUI] = useState<UIState>({
    hp: 100, maxHp: 100, armor: 0, armorLevel: 0,
    currentWeapon: 'AK47', currentAmmo: 30, reserveAmmo: 90,
    ammoType: '7.62mm', isReloading: false, reloadProgress: 0,
    bandages: 2, healthKits: 0, playersAlive: 100, elapsed: 0, kills: 0,
    phase: 'menu', zoneRadius: CONFIG.ZONE_INITIAL_RADIUS,
    zoneWarning: false, zoneShrinking: false, nearLoot: null,
    hitMarker: false, isADS: false, kills_feed: [], spread: false,
    inventoryOpen: false, weaponSlots: ['AK47', null, null],
    isCrouching: false, isSprinting: false,
  });

  // ── Build humanoid bot mesh ──────────────────────────────
  const makeBotMesh = useCallback((squadColor: string): THREE.Group => {
    const g = new THREE.Group();
    const bodyMat  = new THREE.MeshLambertMaterial({ color: squadColor });
    const skinMat  = new THREE.MeshLambertMaterial({ color: 0xdda06a });
    const legMat   = new THREE.MeshLambertMaterial({ color: 0x222244 });
    const bootMat  = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const helmetMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(squadColor).multiplyScalar(0.6) });

    function box(w: number, h: number, d: number, mat: THREE.MeshLambertMaterial, x: number, y: number, z: number, shadow = true): THREE.Mesh {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      if (shadow) { m.castShadow = true; m.receiveShadow = true; }
      return m;
    }

    // Legs
    const legL = box(0.22, 0.62, 0.22, legMat, -0.14, 0.44, 0);
    const legR = box(0.22, 0.62, 0.22, legMat,  0.14, 0.44, 0);
    const bootL = box(0.24, 0.14, 0.28, bootMat, -0.14, 0.10, 0.03);
    const bootR = box(0.24, 0.14, 0.28, bootMat,  0.14, 0.10, 0.03);

    // Torso
    const torso = box(0.52, 0.62, 0.26, bodyMat, 0, 1.08, 0);
    // Belt
    const belt  = box(0.56, 0.10, 0.30, legMat, 0, 0.78, 0);

    // Arms (will animate)
    const armL = box(0.18, 0.54, 0.18, bodyMat, -0.36, 1.04, 0);
    const armR = box(0.18, 0.54, 0.18, bodyMat,  0.36, 1.04, 0);
    const handL = box(0.16, 0.16, 0.16, skinMat, -0.36, 0.73, 0);
    const handR = box(0.16, 0.16, 0.16, skinMat,  0.36, 0.73, 0);

    // Head
    const head    = box(0.30, 0.30, 0.28, skinMat, 0, 1.63, 0);
    const helmet  = box(0.36, 0.20, 0.36, helmetMat, 0, 1.77, 0);
    // Visor
    const visor = box(0.30, 0.08, 0.06, new THREE.MeshLambertMaterial({ color: 0x113311 }), 0, 1.65, -0.17);

    // Enemy marker dot
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.10, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2222 })
    );
    dot.position.set(0, 2.10, 0);

    g.add(legL, legR, bootL, bootR, belt, torso, armL, armR, handL, handR, head, helmet, visor, dot);
    // Tag parts for animation: indices 6=armL, 7=armR, 0=legL, 1=legR
    return g;
  }, []);

  // ── Initialize / restart game ──────────────────────────
  const initGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (threeRef.current) {
      const t = threeRef.current;
      cancelAnimationFrame(t.frameId);
      clearInterval(t.uiTimer);
      clearInterval(t.minimapTimer);
      clearInterval(t.botKillTimer);
      t.renderer.dispose();
    }

    const state = gs.current;
    state.phase = 'playing';
    state.hp = 100; state.maxHp = 100;
    state.armor = 0; state.armorLevel = 0;
    state.position.set((Math.random() - 0.5) * 60, 50, (Math.random() - 0.5) * 60);
    state.velocity.set(0, 0, 0);
    state.isGrounded = false; state.isSprinting = false; state.isCrouching = false;
    state.currentWeapon = 'AK47';
    state.weaponSlots = ['AK47', null, null];
    state.currentAmmo = 30; state.reserveAmmo = 90;
    state.isReloading = false; state.reloadTimer = 0;
    state.bandages = 2; state.healthKits = 0;
    state.kills = 0; state.playersAlive = 100;
    state.elapsed = 0; state.yaw = 0; state.pitch = 0;
    state.recoilPitch = 0; state.recoilYaw = 0; state.shootCooldown = 0;
    state.isADS = false; state.currentFOV = 75;
    state.zone = { radius: CONFIG.ZONE_INITIAL_RADIUS, target: CONFIG.ZONE_INITIAL_RADIUS, cx: 0, cz: 0, timer: CONFIG.ZONE_SHRINK_INTERVAL, shrinking: false };
    state.keys.clear(); state.nearLootId = -1; state.hitMarkerTimer = 0;
    state.zoneShrinkBannerTimer = 0; state.footAccum = 0;
    state.killFeed = []; state.killFeedId = 0; state.spreadTimer = 0;
    state.inventoryOpen = false; state.shakeTimer = 0; state.shakeAmt = 0;

    const W = window.innerWidth, H = window.innerHeight;
    const testCtx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!testCtx) { setWebglError(true); return; }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, context: testCtx as WebGL2RenderingContext });
    } catch (_) {
      try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false }); }
      catch (__) { setWebglError(true); return; }
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x7aabb5, 0.0028);
    scene.background = new THREE.Color(0x7eb8d4);

    const camera = new THREE.PerspectiveCamera(75, W / H, 0.1, 800);
    camera.position.copy(state.position);

    // ── LIGHTING ──────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x88aacc, 0.9));
    const sun = new THREE.DirectionalLight(0xfff8e0, 2.2);
    sun.position.set(120, 200, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.width  = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far  = 700;
    sun.shadow.camera.left = -260; sun.shadow.camera.right  = 260;
    sun.shadow.camera.top  =  260; sun.shadow.camera.bottom = -260;
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x87CEEB, 0x3d5c2e, 0.5));

    // ── TERRAIN with vertex colors ─────────────────────────
    const terrGeo = new THREE.PlaneGeometry(CONFIG.MAP_SIZE, CONFIG.MAP_SIZE, CONFIG.TERRAIN_SEGMENTS, CONFIG.TERRAIN_SEGMENTS);
    terrGeo.rotateX(-Math.PI / 2);
    const posAttr = terrGeo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i), z = posAttr.getZ(i);
      const h = getTerrainHeight(x, z);
      posAttr.setY(i, h);
      let r, g, b;
      if      (h < -1)  { r=0.25; g=0.30; b=0.55; }  // deep water edge
      else if (h < 1.5) { r=0.72; g=0.64; b=0.42; }  // sand
      else if (h < 7)   { r=0.22; g=0.38; b=0.16; }  // green grass
      else if (h < 13)  { r=0.18; g=0.29; b=0.13; }  // dark grass
      else if (h < 17)  { r=0.42; g=0.36; b=0.28; }  // rocky
      else              { r=0.82; g=0.80; b=0.80; }   // snow peak
      colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b;
    }
    terrGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrGeo.computeVertexNormals();
    const terrMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const terrain = new THREE.Mesh(terrGeo, terrMat);
    terrain.receiveShadow = true;
    scene.add(terrain);

    // ── WATER ──────────────────────────────────────────────
    const waterGeo = new THREE.PlaneGeometry(CONFIG.MAP_SIZE, CONFIG.MAP_SIZE);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshPhongMaterial({ color: 0x1a4a8a, transparent: true, opacity: 0.76, shininess: 80 });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = -1.5;
    scene.add(water);

    // ── TREES (3-layer canopy, InstancedMesh) ───────────────
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.40, 2.2, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, CONFIG.TREE_COUNT);
    trunkMesh.castShadow = true; trunkMesh.receiveShadow = true;

    const canopyLayers = [
      { geo: new THREE.ConeGeometry(2.8, 3.2, 7), offY: 4.5, scale: 1.0 },
      { geo: new THREE.ConeGeometry(2.2, 2.8, 7), offY: 6.5, scale: 0.88 },
      { geo: new THREE.ConeGeometry(1.5, 2.2, 7), offY: 8.2, scale: 0.72 },
    ];
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0x1a5c1a });
    const canopyMeshes = canopyLayers.map(l => {
      const m = new THREE.InstancedMesh(l.geo, canopyMat, CONFIG.TREE_COUNT);
      m.castShadow = true; return m;
    });

    const dummy = new THREE.Object3D();
    for (let i = 0; i < CONFIG.TREE_COUNT; i++) {
      const tx = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.9;
      const tz = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.9;
      const ty = getTerrainHeight(tx, tz);
      const treeScale = 0.7 + Math.random() * 0.7;
      dummy.scale.setScalar(treeScale);
      dummy.position.set(tx, ty + 1.1, tz); dummy.rotation.y = Math.random() * Math.PI * 2; dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);
      canopyLayers.forEach((l, ci) => {
        dummy.position.set(tx, ty + l.offY * treeScale, tz);
        dummy.scale.setScalar(treeScale * l.scale);
        dummy.updateMatrix();
        canopyMeshes[ci].setMatrixAt(i, dummy.matrix);
      });
    }
    dummy.scale.setScalar(1);
    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMeshes.forEach(m => { m.instanceMatrix.needsUpdate = true; scene.add(m); });
    scene.add(trunkMesh);

    // ── BUILDINGS with AABB collision & cover points ────────
    const buildingAABBs: BuildingAABB[] = [];
    const coverPoints: CoverPoint[] = [];
    const wallColors = [0x8a8a7a, 0x7a7060, 0x8a7060, 0x606870, 0x9a8870];

    for (let i = 0; i < CONFIG.BUILDING_COUNT; i++) {
      const bx = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.7;
      const bz = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.7;
      const bw = 5 + Math.random() * 10;
      const bh = 4 + Math.random() * 8;
      const bd = 5 + Math.random() * 10;
      const by = getTerrainHeight(bx, bz);
      const bColor = wallColors[i % wallColors.length];

      // Main walls
      const bGeo = new THREE.BoxGeometry(bw, bh, bd);
      const bMat = new THREE.MeshLambertMaterial({ color: bColor });
      const bMesh = new THREE.Mesh(bGeo, bMat);
      bMesh.position.set(bx, by + bh / 2, bz);
      bMesh.castShadow = true; bMesh.receiveShadow = true;
      scene.add(bMesh);

      // Roof slab
      const roofGeo = new THREE.BoxGeometry(bw + 0.5, 0.35, bd + 0.5);
      const roofMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(bColor).multiplyScalar(0.7) });
      const roofMesh = new THREE.Mesh(roofGeo, roofMat);
      roofMesh.position.set(bx, by + bh + 0.17, bz);
      roofMesh.castShadow = true; roofMesh.receiveShadow = true;
      scene.add(roofMesh);

      // Window accents (just dark patches)
      const wndColors = [0x112233, 0x223344];
      for (let wi = 0; wi < 2; wi++) {
        const wm = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 0.7, 0.05),
          new THREE.MeshLambertMaterial({ color: wndColors[wi % 2] })
        );
        wm.position.set(bx + (wi - 0.5) * bw * 0.4, by + bh * 0.6, bz - bd / 2 - 0.02);
        scene.add(wm);
      }

      buildingAABBs.push({
        minX: bx - bw / 2, maxX: bx + bw / 2,
        minZ: bz - bd / 2, maxZ: bz + bd / 2,
        maxY: by + bh,
      });

      // 4 cover points around building corners
      const offsets = [[-1, -1],[1, -1],[-1, 1],[1, 1]];
      for (const [ox, oz] of offsets) {
        coverPoints.push({
          pos: new THREE.Vector3(bx + ox * (bw / 2 + 1.2), by + 0.9, bz + oz * (bd / 2 + 1.2)),
          occupiedBy: -1,
        });
      }
    }

    // ── ZONE RING ──────────────────────────────────────────
    const ringGeo = new THREE.TorusGeometry(CONFIG.ZONE_INITIAL_RADIUS, 1.0, 8, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const zoneRing = new THREE.Mesh(ringGeo, ringMat);
    zoneRing.rotation.x = Math.PI / 2;
    zoneRing.position.y = 1;
    scene.add(zoneRing);

    // ── WEAPON ──────────────────────────────────────────────
    const weaponGroup = new THREE.Group();
    camera.add(weaponGroup);
    scene.add(camera);
    buildWeaponMesh(weaponGroup, state.currentWeapon);

    // ── MUZZLE FLASH ────────────────────────────────────────
    const muzzleLight = new THREE.PointLight(0xffee44, 0, 8);
    camera.add(muzzleLight);
    muzzleLight.position.set(0.2, -0.22, -0.85);

    // ── PLAYER HITBOX ───────────────────────────────────────
    const playerHitbox = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    scene.add(playerHitbox);

    // ── LOOT BOXES ──────────────────────────────────────────
    const lootBoxes: LootBox[] = [];
    const lootGeo = new THREE.BoxGeometry(0.85, 0.85, 0.85);
    for (let i = 0; i < CONFIG.LOOT_COUNT; i++) {
      const lx = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.85;
      const lz = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.85;
      const ly = getTerrainHeight(lx, lz) + 0.5;
      const lMat = new THREE.MeshPhongMaterial({ color: 0xdd8800, emissive: 0x442200, emissiveIntensity: 0.5, shininess: 60 });
      const lMesh = new THREE.Mesh(lootGeo, lMat);
      lMesh.position.set(lx, ly, lz);
      lMesh.castShadow = true;
      scene.add(lMesh);
      lootBoxes.push({ id: i, mesh: lMesh, position: new THREE.Vector3(lx, ly, lz), weaponType: randomWeapon(), picked: false });
    }

    // ── BOTS ────────────────────────────────────────────────
    const bots: BotData[] = [];
    const hitboxMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < CONFIG.RENDER_BOTS; i++) {
      const squad = i % CONFIG.SQUAD_COLORS.length;
      const bx = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.8;
      const bz = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.8;
      const by = getTerrainHeight(bx, bz) + 0.9;
      const mesh = makeBotMesh(CONFIG.SQUAD_COLORS[squad]);
      mesh.position.set(bx, by, bz);
      scene.add(mesh);
      const hb = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.35, 1.1, 4, 8),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hb.position.set(bx, by + 0.6, bz);
      scene.add(hb);
      hitboxMeshes.push(hb);
      const wType = randomWeapon();
      bots.push({
        id: i, mesh, hitbox: hb,
        position: new THREE.Vector3(bx, by, bz),
        velocity: new THREE.Vector3(),
        hp: 60 + Math.random() * 60, maxHp: 120,
        weapon: wType, currentAmmo: CONFIG.WEAPONS[wType].magSize,
        state: 'patrol', targetPos: new THREE.Vector3(bx, by, bz),
        stateTimer: Math.random() * 4, shootTimer: 1.0,
        squad, alive: true,
        updateAccum: Math.random() * 0.05,
        animTime: Math.random() * Math.PI * 2,
        coverPoint: null, peekTimer: 0, isPeeking: false,
      });
    }

    const particles: Particle[] = [];
    const clock = new THREE.Clock();

    // ── EVENT LISTENERS ────────────────────────────────────
    const onKeyDown = (e: KeyboardEvent) => {
      if (state.inventoryOpen && e.code !== 'KeyI' && e.code !== 'Tab') return;
      state.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'Tab') { e.preventDefault(); state.inventoryOpen = !state.inventoryOpen; }
      if (e.code === 'KeyI') { state.inventoryOpen = !state.inventoryOpen; }
      if (e.code === 'KeyF') pickupNearbyLoot(lootBoxes, scene, state, setUI);
      if (e.code === 'KeyR') tryReload(state);
      if (e.code === 'Digit1') switchWeapon(state, 0, weaponGroup);
      if (e.code === 'Digit2') switchWeapon(state, 1, weaponGroup);
      if (e.code === 'Digit3') switchWeapon(state, 2, weaponGroup);
      if (e.code === 'KeyC') { state.isCrouching = !state.isCrouching; }
      if (e.code === 'KeyH') useMedical(state, 'bandage');
      if (e.code === 'KeyG') useMedical(state, 'kit');
    };
    const onKeyUp = (e: KeyboardEvent) => { state.keys.delete(e.code); };
    const onMouseMove = (e: MouseEvent) => {
      if (state.phase !== 'playing' || state.inventoryOpen) return;
      state.yaw   -= e.movementX * 0.002;
      state.pitch -= e.movementY * 0.002;
      state.pitch = clamp(state.pitch, -Math.PI / 2.3, Math.PI / 2.3);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (state.inventoryOpen) return;
      if (e.button === 0) shoot(state, camera, bots, hitboxMeshes, scene, particles, weaponGroup, muzzleLight);
      if (e.button === 2) state.isADS = true;
    };
    const onMouseUp = (e: MouseEvent) => { if (e.button === 2) state.isADS = false; };
    const onContextMenu = (e: Event) => e.preventDefault();
    const onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('resize', onResize);
    canvas.addEventListener('click', () => { if (state.phase === 'playing' && !state.inventoryOpen) canvas.requestPointerLock(); });

    // ── UI UPDATE (10fps) ──────────────────────────────────
    const uiTimer = setInterval(() => {
      const s = gs.current;
      const wc = CONFIG.WEAPONS[s.currentWeapon];
      setUI({
        hp: Math.max(0, s.hp), maxHp: s.maxHp,
        armor: s.armor, armorLevel: s.armorLevel,
        currentWeapon: s.currentWeapon,
        currentAmmo: s.currentAmmo, reserveAmmo: s.reserveAmmo,
        ammoType: wc.ammoType, isReloading: s.isReloading,
        reloadProgress: s.isReloading ? (1 - s.reloadTimer / 2.0) : 0,
        bandages: s.bandages, healthKits: s.healthKits,
        playersAlive: s.playersAlive, elapsed: s.elapsed, kills: s.kills,
        phase: s.phase, zoneRadius: s.zone.radius,
        zoneWarning: Math.sqrt(s.position.x ** 2 + s.position.z ** 2) > s.zone.radius,
        zoneShrinking: s.zoneShrinkBannerTimer > 0,
        nearLoot: s.nearLootId >= 0 ? CONFIG.WEAPONS[lootBoxes[s.nearLootId]?.weaponType ?? 'AK47']?.name ?? null : null,
        hitMarker: s.hitMarkerTimer > 0, isADS: s.isADS,
        kills_feed: [...s.killFeed], spread: s.spreadTimer > 0,
        inventoryOpen: s.inventoryOpen,
        weaponSlots: [...s.weaponSlots],
        isCrouching: s.isCrouching, isSprinting: s.isSprinting,
      });
    }, 100);

    const minimapTimer = setInterval(() => drawMinimap(minimapRef.current, gs.current, bots, lootBoxes), 200);
    const botKillTimer = setInterval(() => {
      const s = gs.current;
      if (s.phase !== 'playing') return;
      if (s.playersAlive > CONFIG.RENDER_BOTS + 1) {
        const off = s.playersAlive - CONFIG.RENDER_BOTS - 1;
        if (off > 0 && Math.random() < 0.4) s.playersAlive = Math.max(CONFIG.RENDER_BOTS + 1, s.playersAlive - 1);
      }
    }, 18000 + Math.random() * 12000);

    // ── ANIMATION LOOP ─────────────────────────────────────
    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const raw = clock.getDelta();
      const delta = Math.min(raw, 0.05);
      const s = gs.current;
      if (s.phase !== 'playing') { renderer.render(scene, camera); return; }

      s.elapsed += delta;
      s.shootCooldown    = Math.max(0, s.shootCooldown - delta);
      s.hitMarkerTimer   = Math.max(0, s.hitMarkerTimer - delta);
      s.zoneShrinkBannerTimer = Math.max(0, s.zoneShrinkBannerTimer - delta);
      s.spreadTimer      = Math.max(0, s.spreadTimer - delta);
      s.shakeTimer       = Math.max(0, s.shakeTimer - delta);

      if (s.inventoryOpen) {
        renderer.render(scene, camera);
        return;
      }

      // Reload
      if (s.isReloading) {
        s.reloadTimer -= delta;
        if (s.reloadTimer <= 0) {
          const mag = CONFIG.WEAPONS[s.currentWeapon].magSize;
          const need = mag - s.currentAmmo;
          const take = Math.min(need, s.reserveAmmo);
          s.currentAmmo += take; s.reserveAmmo -= take;
          s.isReloading = false;
        }
      }

      // ADS FOV
      const targetFOV = s.isADS ? (s.currentWeapon === 'AWM' ? 15 : 42) : 75;
      s.currentFOV += (targetFOV - s.currentFOV) * 0.14;
      camera.fov = s.currentFOV;
      camera.updateProjectionMatrix();

      // Recoil recovery
      s.recoilPitch *= 0.85;
      s.recoilYaw   *= 0.85;

      // Camera shake
      const shakeX = s.shakeTimer > 0 ? (Math.random() - 0.5) * s.shakeAmt : 0;
      const shakeY = s.shakeTimer > 0 ? (Math.random() - 0.5) * s.shakeAmt : 0;

      // Camera rotation
      camera.quaternion.setFromEuler(new THREE.Euler(
        s.pitch + s.recoilPitch + shakeY,
        s.yaw + s.recoilYaw + shakeX,
        0, 'YXZ'
      ));

      // ── MOVEMENT ──────────────────────────────────────────
      s.isSprinting = (s.keys.has('ShiftLeft') || s.keys.has('ShiftRight')) && !s.isCrouching;
      const speed = s.isSprinting ? CONFIG.PLAYER_RUN_SPEED : s.isCrouching ? CONFIG.PLAYER_SPEED * 0.45 : CONFIG.PLAYER_SPEED;
      const forward = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
      const right   = new THREE.Vector3( Math.cos(s.yaw), 0, -Math.sin(s.yaw));
      const isMoving = s.keys.has('KeyW') || s.keys.has('KeyS') || s.keys.has('KeyA') || s.keys.has('KeyD');

      const prevPos = s.position.clone();
      if (s.keys.has('KeyW')) s.position.addScaledVector(forward, speed * delta);
      if (s.keys.has('KeyS')) s.position.addScaledVector(forward, -speed * delta * 0.7);
      if (s.keys.has('KeyA')) s.position.addScaledVector(right, -speed * delta);
      if (s.keys.has('KeyD')) s.position.addScaledVector(right,  speed * delta);

      // ── BUILDING COLLISION ────────────────────────────────
      const pRadius = 0.55;
      for (const ab of buildingAABBs) {
        const px = s.position.x, pz = s.position.z;
        if (px > ab.minX - pRadius && px < ab.maxX + pRadius &&
            pz > ab.minZ - pRadius && pz < ab.maxZ + pRadius &&
            s.position.y < ab.maxY + 0.5) {
          // Push out on the axis with least penetration
          const dx1 = px - (ab.minX - pRadius), dx2 = (ab.maxX + pRadius) - px;
          const dz1 = pz - (ab.minZ - pRadius), dz2 = (ab.maxZ + pRadius) - pz;
          const minD = Math.min(dx1, dx2, dz1, dz2);
          if (minD === dx1) s.position.x = ab.minX - pRadius;
          else if (minD === dx2) s.position.x = ab.maxX + pRadius;
          else if (minD === dz1) s.position.z = ab.minZ - pRadius;
          else s.position.z = ab.maxZ + pRadius;
        }
      }

      // ── GRAVITY & TERRAIN COLLISION ─────────────────────
      s.velocity.y -= 22 * delta;
      s.position.y += s.velocity.y * delta;

      // Multi-point terrain sampling (4 feet corners + center)
      const ph = s.isCrouching ? CONFIG.CROUCH_HEIGHT : CONFIG.PLAYER_HEIGHT;
      const sampOffsets = [[0,0],[0.25,0],[-0.25,0],[0,0.25],[0,-0.25]];
      let maxGround = -Infinity;
      for (const [ox, oz] of sampOffsets) {
        const h = getTerrainHeight(s.position.x + ox, s.position.z + oz);
        if (h > maxGround) maxGround = h;
      }
      if (s.position.y < maxGround + ph) {
        s.position.y = maxGround + ph;
        if (s.velocity.y < 0) s.velocity.y = 0;
        s.isGrounded = true;
      } else {
        s.isGrounded = false;
      }

      // Jump
      if ((s.keys.has('Space') || s.keys.has('KeyJ')) && s.isGrounded) {
        s.velocity.y = CONFIG.JUMP_FORCE;
        s.isGrounded = false;
      }

      // Map bounds
      const half = CONFIG.MAP_SIZE / 2 - 2;
      s.position.x = clamp(s.position.x, -half, half);
      s.position.z = clamp(s.position.z, -half, half);

      camera.position.copy(s.position);
      playerHitbox.position.set(s.position.x, s.position.y - ph * 0.3, s.position.z);

      // Weapon bob
      const bobFreq = s.isSprinting ? 12 : 8;
      const bobAmt  = isMoving ? (s.isSprinting ? 0.016 : 0.009) : 0.002;
      const adsOff  = s.isADS ? 0.14 : 0;
      weaponGroup.position.set(
        0.22 - adsOff, -0.22 + Math.sin(s.elapsed * bobFreq) * bobAmt - (s.isCrouching ? 0.04 : 0),
        s.isADS ? -0.38 : -0.5
      );
      weaponGroup.rotation.z = Math.sin(s.elapsed * bobFreq * 0.5) * (isMoving ? 0.014 : 0.003);
      muzzleLight.intensity *= 0.55;

      // Footsteps
      if (isMoving && s.isGrounded) {
        s.footAccum += delta;
        const rate = s.isSprinting ? 0.28 : 0.44;
        if (s.footAccum > rate) {
          s.footAccum = 0;
          spawnDust(s.position, particles, scene);
          playFootstep();
        }
      }

      // ── ZONE ──────────────────────────────────────────────
      s.zone.timer -= delta;
      if (s.zone.timer <= 0 && s.zone.radius > CONFIG.ZONE_MIN_RADIUS) {
        s.zone.timer = CONFIG.ZONE_SHRINK_INTERVAL;
        s.zone.target = Math.max(CONFIG.ZONE_MIN_RADIUS, s.zone.radius * 0.62);
        s.zone.shrinking = true; s.zoneShrinkBannerTimer = 3.5;
        playZoneBeep();
        s.zone.cx += (Math.random() - 0.5) * 30;
        s.zone.cz += (Math.random() - 0.5) * 30;
      }
      if (s.zone.shrinking) {
        s.zone.radius += (s.zone.target - s.zone.radius) * CONFIG.ZONE_SHRINK_RATE;
        if (Math.abs(s.zone.radius - s.zone.target) < 0.5) s.zone.shrinking = false;
      }
      const scaleFactor = s.zone.radius / CONFIG.ZONE_INITIAL_RADIUS;
      zoneRing.scale.set(scaleFactor, scaleFactor, scaleFactor);
      zoneRing.position.set(s.zone.cx, 1, s.zone.cz);

      const pd = Math.sqrt((s.position.x - s.zone.cx) ** 2 + (s.position.z - s.zone.cz) ** 2);
      if (pd > s.zone.radius) {
        s.hp -= CONFIG.ZONE_DAMAGE_RATE * delta;
        if (s.hp <= 0) s.phase = 'dead';
      }

      // ── LOOT pulse ─────────────────────────────────────────
      let closestLootDist = 2.8, closestLootId = -1;
      for (const lb of lootBoxes) {
        if (lb.picked) continue;
        lb.mesh.rotation.y += delta * 1.2;
        const ld = lb.position.distanceTo(s.position);
        if (ld < closestLootDist) { closestLootDist = ld; closestLootId = lb.id; }
        (lb.mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.35 + Math.sin(s.elapsed * 2.5) * 0.25;
      }
      s.nearLootId = closestLootId;

      // ── BOTS ──────────────────────────────────────────────
      for (const bot of bots) {
        if (!bot.alive) continue;
        bot.updateAccum += delta;
        if (bot.updateAccum < 0.05) continue;
        const dt = bot.updateAccum; bot.updateAccum = 0;

        const distToPlayer = bot.position.distanceTo(s.position);

        // ── AI State machine ──────────────────────────────
        if (bot.state === 'patrol') {
          bot.stateTimer -= dt;
          if (bot.stateTimer <= 0) {
            const a = Math.random() * Math.PI * 2;
            bot.targetPos.set(
              clamp(bot.position.x + Math.cos(a) * 25, -CONFIG.MAP_SIZE/2+5, CONFIG.MAP_SIZE/2-5),
              0,
              clamp(bot.position.z + Math.sin(a) * 25, -CONFIG.MAP_SIZE/2+5, CONFIG.MAP_SIZE/2-5)
            );
            bot.stateTimer = 3 + Math.random() * 4;
          }
          moveBotToward(bot, bot.targetPos, CONFIG.BOT_SPEED, dt, buildingAABBs);
          if (distToPlayer < CONFIG.BOT_SIGHT_RANGE) bot.state = 'chase';

        } else if (bot.state === 'chase') {
          moveBotToward(bot, s.position, CONFIG.BOT_SPEED * 1.35, dt, buildingAABBs);
          if (distToPlayer < CONFIG.BOT_SHOOT_RANGE) bot.state = 'attack';
          if (distToPlayer > CONFIG.BOT_SIGHT_RANGE * 1.6) bot.state = 'patrol';

        } else if (bot.state === 'attack') {
          bot.shootTimer -= dt;
          // Smart strafe
          const perp = new THREE.Vector3(-(s.position.z - bot.position.z), 0, s.position.x - bot.position.x).normalize();
          const strafeDir = Math.sin(s.elapsed * 1.8 + bot.id) > 0 ? 1 : -1;
          const newBx = clamp(bot.position.x + perp.x * CONFIG.BOT_SPEED * 0.4 * dt * strafeDir, -CONFIG.MAP_SIZE/2+2, CONFIG.MAP_SIZE/2-2);
          const newBz = clamp(bot.position.z + perp.z * CONFIG.BOT_SPEED * 0.4 * dt * strafeDir, -CONFIG.MAP_SIZE/2+2, CONFIG.MAP_SIZE/2-2);
          bot.position.x = newBx; bot.position.z = newBz;
          bot.position.y = getTerrainHeight(bot.position.x, bot.position.z) + 0.9;

          if (bot.shootTimer <= 0 && distToPlayer < CONFIG.BOT_SHOOT_RANGE) {
            bot.shootTimer = CONFIG.BOT_REACTION_TIME + Math.random() * 0.6;
            const wDmg = CONFIG.WEAPONS[bot.weapon].damage;
            // Distance-based accuracy: perfect at 5m, misses mostly at max range
            const accuracyFactor = 1.0 - clamp((distToPlayer - 5) / (CONFIG.BOT_SHOOT_RANGE - 5), 0, 1) * 0.78;
            if (Math.random() < accuracyFactor) {
              const dmg = wDmg * (0.6 + Math.random() * 0.4);
              if (s.armor > 0) {
                const absorbed = Math.min(s.armor, dmg * 0.55);
                s.armor -= absorbed; s.hp -= dmg - absorbed;
              } else { s.hp -= dmg; }
              if (s.hp <= 0) s.phase = 'dead';
            }
          }

          // Low HP → seek cover
          if (bot.hp < bot.maxHp * 0.38 && Math.random() < 0.015) {
            // Find nearest free cover point
            let bestCover: CoverPoint | null = null, bestDist = CONFIG.BOT_COVER_RANGE;
            for (const cp of coverPoints) {
              if (cp.occupiedBy !== -1 && cp.occupiedBy !== bot.id) continue;
              const d = cp.pos.distanceTo(bot.position);
              if (d < bestDist) { bestDist = d; bestCover = cp; }
            }
            if (bestCover) {
              if (bot.coverPoint) bot.coverPoint = null; // release old
              bestCover.occupiedBy = bot.id;
              bot.coverPoint = bestCover.pos;
              bot.state = 'cover';
              bot.peekTimer = 2.5;
              bot.isPeeking = false;
            }
          }
          if (bot.hp < bot.maxHp * 0.28) bot.state = 'flee';
          if (distToPlayer > CONFIG.BOT_SHOOT_RANGE * 1.5) bot.state = 'chase';

        } else if (bot.state === 'cover') {
          if (!bot.coverPoint) { bot.state = 'patrol'; }
          else {
            const distToCover = bot.position.distanceTo(bot.coverPoint);
            if (distToCover > 1.5) {
              // Move to cover
              moveBotToward(bot, bot.coverPoint, CONFIG.BOT_SPEED * 1.6, dt, buildingAABBs);
            } else {
              // At cover — peek cycle
              bot.peekTimer -= dt;
              if (bot.peekTimer <= 0) {
                bot.isPeeking = !bot.isPeeking;
                bot.peekTimer = bot.isPeeking ? 1.2 : 2.0;
              }
              if (bot.isPeeking) {
                // Peek out and shoot
                const peekDir = s.position.clone().sub(bot.position).normalize();
                bot.position.addScaledVector(peekDir, 1.8 * dt);
                bot.shootTimer -= dt;
                if (bot.shootTimer <= 0 && distToPlayer < CONFIG.BOT_SHOOT_RANGE * 1.2) {
                  bot.shootTimer = CONFIG.BOT_REACTION_TIME * 1.5;
                  const wDmg = CONFIG.WEAPONS[bot.weapon].damage;
                  const acc = 1.0 - clamp((distToPlayer - 5) / (CONFIG.BOT_SHOOT_RANGE - 5), 0, 1) * 0.7;
                  if (Math.random() < acc) {
                    const dmg = wDmg * 0.55;
                    if (s.armor > 0) { const abs = Math.min(s.armor, dmg * 0.55); s.armor -= abs; s.hp -= dmg - abs; }
                    else s.hp -= dmg;
                    if (s.hp <= 0) s.phase = 'dead';
                  }
                }
              }
            }
            // Leave cover when health recovers or player too far
            if ((bot.hp > bot.maxHp * 0.65 && distToPlayer < CONFIG.BOT_SHOOT_RANGE) || distToPlayer > 90) {
              // Release cover point
              for (const cp of coverPoints) { if (cp.occupiedBy === bot.id) cp.occupiedBy = -1; }
              bot.coverPoint = null;
              bot.state = distToPlayer < CONFIG.BOT_SHOOT_RANGE ? 'attack' : 'patrol';
            }
          }

        } else if (bot.state === 'flee') {
          const away = bot.position.clone().sub(s.position).normalize();
          bot.targetPos.set(
            clamp(bot.position.x + away.x * 40, -CONFIG.MAP_SIZE/2+2, CONFIG.MAP_SIZE/2-2),
            0,
            clamp(bot.position.z + away.z * 40, -CONFIG.MAP_SIZE/2+2, CONFIG.MAP_SIZE/2-2)
          );
          moveBotToward(bot, bot.targetPos, CONFIG.BOT_SPEED * 1.5, dt, buildingAABBs);
          if (distToPlayer > 90) bot.state = 'patrol';
        }

        // Zone damage to bot
        const bdist = Math.sqrt((bot.position.x - s.zone.cx) ** 2 + (bot.position.z - s.zone.cz) ** 2);
        if (bdist > s.zone.radius) {
          bot.hp -= 8 * dt;
          if (bot.hp <= 0) {
            for (const cp of coverPoints) { if (cp.occupiedBy === bot.id) cp.occupiedBy = -1; }
            killBot(bot, bots, scene, s);
          }
        }

        // Bot animation (walk cycle)
        const isWalking = bot.state !== 'cover' || bot.isPeeking;
        if (isWalking) bot.animTime += dt * (bot.state === 'chase' ? 10 : 7);
        const swing = isWalking ? Math.sin(bot.animTime) * 0.35 : 0;
        const legL = bot.mesh.children[0] as THREE.Mesh;
        const legR = bot.mesh.children[1] as THREE.Mesh;
        const armL = bot.mesh.children[6] as THREE.Mesh;
        const armR = bot.mesh.children[7] as THREE.Mesh;
        legL.rotation.x =  swing;
        legR.rotation.x = -swing;
        armL.rotation.x = -swing * 0.5;
        armR.rotation.x =  swing * 0.5;

        // Update mesh position
        bot.mesh.position.copy(bot.position);
        bot.hitbox.position.set(bot.position.x, bot.position.y + 0.6, bot.position.z);
        // Face direction
        if (bot.state === 'attack' || bot.state === 'cover') {
          bot.mesh.lookAt(new THREE.Vector3(s.position.x, bot.position.y, s.position.z));
        } else {
          const td = bot.targetPos.clone().sub(bot.position); td.y = 0;
          if (td.lengthSq() > 0.01) bot.mesh.lookAt(bot.mesh.position.clone().add(td));
        }
      }

      // ── PARTICLES ─────────────────────────────────────────
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= delta;
        if (p.life <= 0) { scene.remove(p.mesh); p.mesh.geometry.dispose(); particles.splice(i, 1); continue; }
        p.velocity.y -= 14 * delta;
        p.mesh.position.addScaledVector(p.velocity, delta);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / p.maxLife;
      }

      // Win check
      if (s.playersAlive <= 1 && bots.filter(b => b.alive).length === 0) s.phase = 'winner';

      renderer.render(scene, camera);
    };

    animate();
    threeRef.current = {
      renderer, scene, camera, clock, weaponGroup, zoneRing, muzzleLight,
      playerHitbox, bots, lootBoxes, particles, hitboxMeshes,
      buildingAABBs, coverPoints, frameId, uiTimer, minimapTimer, botKillTimer,
    };

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frameId);
      clearInterval(uiTimer); clearInterval(minimapTimer); clearInterval(botKillTimer);
      renderer.dispose();
    };
  }, [makeBotMesh]);

  // ── Shoot ───────────────────────────────────────────────
  function shoot(
    state: typeof gs.current, camera: THREE.PerspectiveCamera,
    bots: BotData[], hitboxMeshes: THREE.Mesh[], scene: THREE.Scene,
    particles: Particle[], weaponGroup: THREE.Group, muzzleLight: THREE.PointLight,
  ) {
    if (state.phase !== 'playing') return;
    if (state.shootCooldown > 0 || state.isReloading) return;
    if (state.currentAmmo <= 0) { tryReload(state); return; }

    const wCfg = CONFIG.WEAPONS[state.currentWeapon];
    state.shootCooldown = wCfg.firerate;
    state.currentAmmo--;

    // Recoil: pitch + yaw drift + screen shake
    const recoilMult = state.isADS ? 0.50 : 1.0;
    state.recoilPitch += wCfg.recoil * recoilMult;
    state.recoilYaw   += (Math.random() - 0.5) * wCfg.recoil * 0.4 * recoilMult;
    state.shakeAmt = wCfg.recoil * 0.8 * recoilMult;
    state.shakeTimer = 0.08;
    state.spreadTimer = 0.35;

    playGunshot(state.currentWeapon);
    muzzleLight.intensity = 4.0;
    muzzleLight.color.setHex(state.currentWeapon === 'AWM' ? 0xffffff : 0xffee44);

    // Muzzle flash geo pulse
    const flash = weaponGroup.children.find(c => (c as any).__isFlash) as THREE.Mesh | undefined;
    if (flash) { flash.scale.setScalar(1.5); setTimeout(() => flash.scale.setScalar(0.01), 60); }

    const spreadCount = state.currentWeapon === 'SHOTGUN' ? 8 : 1;
    const raycaster = new THREE.Raycaster();
    raycaster.far = wCfg.range;
    let hit = false;

    for (let ss = 0; ss < spreadCount; ss++) {
      const spr = state.currentWeapon === 'SHOTGUN' ? 0.13 : (state.isADS ? 0.008 : 0.022);
      const dir = new THREE.Vector3((Math.random() - 0.5) * spr * 2, (Math.random() - 0.5) * spr * 2, -1).normalize();
      dir.applyQuaternion(camera.quaternion);
      raycaster.set(camera.position, dir);
      const intersects = raycaster.intersectObjects(hitboxMeshes, false);
      for (const ix of intersects) {
        for (let bi = 0; bi < hitboxMeshes.length; bi++) {
          if (ix.object === hitboxMeshes[bi] && bots[bi].alive) {
            const dmg = wCfg.damage * (0.85 + Math.random() * 0.3);
            bots[bi].hp -= dmg;
            spawnBlood(ix.point, particles, scene);
            hit = true;
            if (bots[bi].hp <= 0) killBot(bots[bi], bots, scene, state);
            break;
          }
        }
      }
    }
    if (hit) { state.hitMarkerTimer = 0.28; playHitMarker(); }

    // Tracer
    const end = new THREE.Vector3(0, 0, -Math.min(wCfg.range, 80));
    end.applyQuaternion(camera.quaternion).add(camera.position);
    const tGeo = new THREE.BufferGeometry().setFromPoints([camera.position.clone(), end]);
    const tMat = new THREE.LineBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.65 });
    const tracer = new THREE.Line(tGeo, tMat);
    scene.add(tracer);
    setTimeout(() => { scene.remove(tracer); tGeo.dispose(); tMat.dispose(); }, 100);

    if (state.currentAmmo <= 0 && state.reserveAmmo > 0) tryReload(state);
  }

  useEffect(() => { const cleanup = initGame(); return cleanup; }, []); // eslint-disable-line

  const handleStartGame = () => { gs.current.phase = 'playing'; canvasRef.current?.requestPointerLock(); };
  const handleRestart = () => { initGame(); };

  const elapsed = ui.elapsed;
  const mm = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const ss_str = Math.floor(elapsed % 60).toString().padStart(2, '0');
  const hpPct    = (ui.hp / ui.maxHp) * 100;
  const armorPct = Math.min(100, (ui.armor / 80) * 100);

  if (webglError) {
    return (
      <div id="batmos-root" style={{ display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16 }}>
        <div style={{ fontSize:'3rem', fontFamily:'Segoe UI,Arial,sans-serif', color:'#00ff88', textShadow:'0 0 20px #00ff88' }} dir="rtl">بتموس</div>
        <div style={{ color:'#ff6666', fontSize:'1.1rem', fontFamily:'Segoe UI,Arial,sans-serif', textAlign:'center', maxWidth:420, lineHeight:1.7 }} dir="rtl">
          ⚠ متصفحك لا يدعم WebGL<br/>
          <span style={{ color:'#888', fontSize:'0.9rem' }}>يتطلب هذا الإصدار ثلاثي الأبعاد دعم WebGL 2.<br/>يرجى فتح اللعبة في متصفح حديث (Chrome / Firefox / Edge).</span>
        </div>
        <button className="btn-play" onClick={() => { setWebglError(false); initGame(); }} dir="rtl" style={{ marginTop:8 }}>إعادة المحاولة</button>
      </div>
    );
  }

  return (
    <div id="batmos-root">
      <canvas id="game-canvas" ref={canvasRef} />

      {/* ── HUD ─────────────────────────────────────────────── */}
      {ui.phase === 'playing' && (
        <div className="hud">
          {/* Crosshair */}
          {!ui.inventoryOpen && (
            <div className={`crosshair${ui.spread ? ' spread' : ''}`}>
              <div className="ch-line ch-top" /><div className="ch-line ch-bottom" />
              <div className="ch-line ch-left" /><div className="ch-line ch-right" />
            </div>
          )}

          {ui.hitMarker && !ui.inventoryOpen && <div className="hit-marker" />}

          {/* AWM scope */}
          {ui.isADS && ui.currentWeapon === 'AWM' && !ui.inventoryOpen && (
            <div className="scope-overlay"><div className="scope-bg" /><div className="scope-lines" /></div>
          )}

          {/* Status panel */}
          <div className="hud-panel status-panel">
            <div className="bar-label"><span>HP</span><span style={{ color: hpPct > 50 ? '#44ff44' : hpPct > 25 ? '#ffaa00' : '#ff4444' }}>{Math.ceil(ui.hp)}/{ui.maxHp}</span></div>
            <div className="bar-track"><div className="bar-fill bar-hp" style={{ width:`${hpPct}%`, background: hpPct > 60 ? '#44aa44' : hpPct > 30 ? '#ffaa00' : '#ff4444' }} /></div>
            {ui.armorLevel > 0 && (
              <><div className="bar-label"><span>Armor Lv.{ui.armorLevel}</span><span style={{ color:'#4488ff' }}>{Math.ceil(ui.armor)}</span></div>
              <div className="bar-track"><div className="bar-fill bar-armor" style={{ width:`${armorPct}%` }} /></div></>
            )}
            <div style={{ fontSize:10, color:'#555', marginTop:4 }}>
              {ui.bandages > 0 && <span style={{ marginRight:8 }}>💊 ×{ui.bandages} [H]</span>}
              {ui.healthKits > 0 && <span>🩺 ×{ui.healthKits} [G]</span>}
            </div>
            <div style={{ fontSize:9, color:'#334', marginTop:3 }}>
              {ui.isCrouching && <span style={{ color:'#ffaa44' }}>⬇ منحنٍ </span>}
              {ui.isSprinting && <span style={{ color:'#44ffaa' }}>⚡ جري </span>}
            </div>
          </div>

          {/* Top-center */}
          <div className="hud-panel alive-panel">
            <div className="alive-count">{ui.playersAlive}</div>
            <div className="alive-label">لاعب على قيد الحياة</div>
            <div className="timer">{mm}:{ss_str}</div>
          </div>

          {/* Minimap */}
          <div className="minimap-container hud-panel" style={{ padding:4 }}>
            <canvas ref={minimapRef} className="minimap-canvas" width={128} height={128} />
            <div className="minimap-label">خريطة | {Math.ceil(ui.zoneRadius)}m</div>
          </div>

          {/* Kill feed */}
          <div className="killfeed" style={{ top:168 }}>
            {ui.kills_feed.slice(-5).map(k => <div key={k.id} className="kill-entry">{k.text}</div>)}
          </div>

          {/* Zone warnings */}
          {ui.zoneWarning && <div className="zone-warning" dir="rtl">⚠ خارج المنطقة الآمنة — تتلقى ضرراً!</div>}
          {ui.zoneShrinking && <div className="zone-shrink-banner" dir="rtl">🔵 المنطقة الآمنة تتقلص!</div>}

          {/* Loot prompt */}
          {ui.nearLoot && !ui.inventoryOpen && (
            <div className="loot-prompt" dir="rtl">اضغط F للنهب: {ui.nearLoot}</div>
          )}

          {/* Weapon panel */}
          <div className="hud-panel weapon-panel">
            <span className="weapon-name">{CONFIG.WEAPONS[ui.currentWeapon].name}</span>
            {ui.isReloading ? (
              <div className="reload-bar-wrap" dir="rtl">جار إعادة التحميل...
                <div className="reload-bar-track"><div className="reload-bar-fill" style={{ width:`${ui.reloadProgress * 100}%` }} /></div>
              </div>
            ) : (
              <span className="ammo-display">
                <span className="ammo-cur">{ui.currentAmmo}</span>
                <span className="ammo-sep"> / </span>
                <span className="ammo-res">{ui.reserveAmmo}</span>
              </span>
            )}
            <span className="ammo-type">{ui.ammoType}</span>
          </div>

          {/* Inventory quick bar */}
          <div className="hud-panel inventory-panel">
            {ui.weaponSlots.map((w, i) => (
              <div key={i} className={`weapon-slot${ui.currentWeapon === w && w ? ' active' : ''}${!w ? ' empty' : ''}`}>
                <span className="slot-num">{i + 1}</span>
                <span>{w ? CONFIG.WEAPONS[w].name : '— فارغ —'}</span>
              </div>
            ))}
            <div className="healing-items" dir="rtl">
              <div className="heal-row"><span>ضمادة</span><span>{ui.bandages}</span></div>
              <div className="heal-row"><span>حقيبة إسعاف</span><span>{ui.healthKits}</span></div>
            </div>
          </div>

          {/* Controls reminder */}
          <div style={{ position:'absolute', bottom:12, right:12, fontSize:9, color:'#333', textAlign:'right', lineHeight:1.8 }}>
            WASD حركة · SHIFT جري · C انحناء · SPACE قفز<br/>
            CLICK نار · RMB تصويب · F نهب · R إعادة تحميل · I/TAB جرد<br/>
            H ضمادة · G حقيبة إسعاف
          </div>
        </div>
      )}

      {/* ── INVENTORY MODAL ──────────────────────────────────── */}
      {ui.phase === 'playing' && ui.inventoryOpen && (
        <div className="inventory-modal" dir="rtl">
          <div className="inv-header">
            <span>🎒 الجرد</span>
            <button className="inv-close" onClick={() => { gs.current.inventoryOpen = false; }}>✕</button>
          </div>

          <div className="inv-body">
            {/* Weapons */}
            <div className="inv-section">
              <div className="inv-section-title">🔫 الأسلحة</div>
              {ui.weaponSlots.map((w, i) => (
                <div key={i} className={`inv-weapon-row${ui.currentWeapon === w && w ? ' inv-active' : ''}`}
                  onClick={() => {
                    if (!w) return;
                    const t = threeRef.current;
                    if (!t) return;
                    switchWeapon(gs.current, i, t.weaponGroup);
                  }}
                >
                  <div className="inv-slot-badge">{i + 1}</div>
                  {w ? (
                    <div className="inv-weapon-info">
                      <div className="inv-weapon-name">{CONFIG.WEAPONS[w].name}</div>
                      <div className="inv-weapon-stats">
                        <span>⚡ {CONFIG.WEAPONS[w].damage}</span>
                        <span>🎯 {CONFIG.WEAPONS[w].range}m</span>
                        <span>🔴 {CONFIG.WEAPONS[w].ammoType}</span>
                        {ui.currentWeapon === w && (
                          <span className="inv-ammo-count">💥 {ui.currentAmmo}/{ui.reserveAmmo}</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="inv-weapon-empty">— فارغ —</div>
                  )}
                </div>
              ))}
            </div>

            {/* Medical & Armor */}
            <div className="inv-section">
              <div className="inv-section-title">🏥 الإسعافات والدرع</div>
              <div className="inv-item-row">
                <span>💊 ضمادة</span>
                <span className="inv-qty">{ui.bandages}×</span>
                <button className="inv-use-btn" onClick={() => useMedical(gs.current, 'bandage')}
                  disabled={ui.bandages === 0}>استخدم [H]</button>
              </div>
              <div className="inv-item-row">
                <span>🩺 حقيبة إسعاف</span>
                <span className="inv-qty">{ui.healthKits}×</span>
                <button className="inv-use-btn" onClick={() => useMedical(gs.current, 'kit')}
                  disabled={ui.healthKits === 0}>استخدم [G]</button>
              </div>
              <div className="inv-item-row">
                <span>🛡️ درع</span>
                <span className="inv-qty">Lv.{ui.armorLevel} — {Math.ceil(ui.armor)}/80</span>
              </div>
            </div>

            {/* Stats */}
            <div className="inv-section inv-stats-section">
              <div className="inv-section-title">📊 الإحصاء</div>
              <div className="inv-stat-row"><span>قتلى:</span><span style={{ color:'#ff6b6b' }}>{ui.kills}</span></div>
              <div className="inv-stat-row"><span>الوقت:</span><span>{mm}:{ss_str}</span></div>
              <div className="inv-stat-row"><span>لاعبون متبقون:</span><span style={{ color:'#00ff88' }}>{ui.playersAlive}</span></div>
              <div className="inv-stat-row"><span>HP:</span><span style={{ color: hpPct > 50 ? '#44ff44' : '#ff4444' }}>{Math.ceil(ui.hp)}/{ui.maxHp}</span></div>
            </div>
          </div>
          <div className="inv-footer">اضغط I أو TAB للإغلاق · انقر على سلاح لتجهيزه</div>
        </div>
      )}

      {/* ── OVERLAYS ─────────────────────────────────────────── */}
      {ui.phase === 'menu' && (
        <div className="overlay menu-overlay">
          <div className="menu-title" dir="rtl">بتموس</div>
          <div className="menu-subtitle" dir="rtl">باتل رويال ثلاثي الأبعاد — 100 لاعب</div>
          <button className="btn-play" onClick={handleStartGame} dir="rtl">انقر للعب</button>
          <div className="menu-controls">
            WASD — Move &nbsp;|&nbsp; Mouse — Aim &nbsp;|&nbsp; LMB — Fire &nbsp;|&nbsp; RMB — ADS<br/>
            F — Loot &nbsp;|&nbsp; R — Reload &nbsp;|&nbsp; Space — Jump &nbsp;|&nbsp; C — Crouch &nbsp;|&nbsp; Shift — Sprint<br/>
            I/TAB — Inventory &nbsp;|&nbsp; H — Bandage &nbsp;|&nbsp; G — Health Kit
          </div>
        </div>
      )}

      {ui.phase === 'dead' && (
        <div className="overlay dead-overlay">
          <div className="overlay-title" style={{ color:'#ff4444' }} dir="rtl">💀 لقد سقطت في المعركة</div>
          <div className="overlay-sub" dir="rtl">حاول مرة أخرى</div>
          <div className="overlay-stats">
            قتلت: {ui.kills} لاعب<br/>الوقت: {mm}:{ss_str}<br/>لاعبون متبقون: {ui.playersAlive}
          </div>
          <button className="btn-restart" onClick={handleRestart} dir="rtl">العب مجدداً</button>
        </div>
      )}

      {ui.phase === 'winner' && (
        <div className="overlay win-overlay">
          <div className="overlay-title" style={{ color:'#ffd700', textShadow:'0 0 30px #ffd700' }}>🏆 Winner Winner Chicken Dinner! 🏆</div>
          <div className="overlay-title" style={{ color:'#00ff88', fontSize:'2rem' }} dir="rtl">أنت البطل! — بتموس</div>
          <div className="overlay-stats" style={{ color:'#aaa' }}>قتلت: {ui.kills} لاعب<br/>الوقت: {mm}:{ss_str}</div>
          <button className="btn-restart" onClick={handleRestart} dir="rtl">العب مجدداً</button>
        </div>
      )}

      {'ontouchstart' in window && ui.phase === 'playing' && !ui.inventoryOpen && (
        <MobileControls gameState={gs.current} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  MOBILE CONTROLS
// ══════════════════════════════════════════════════════════
function MobileControls({ gameState }: { gameState: ReturnType<typeof useRef<any>>['current'] }) {
  const joyRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  return (
    <div className="mobile-controls">
      <div className="joystick-zone"
        onTouchStart={e => {
          const t = e.changedTouches[0];
          const rect = joyRef.current!.getBoundingClientRect();
          const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
          const dx = clamp((t.clientX - cx) / 60, -1, 1), dz = clamp((t.clientY - cy) / 60, -1, 1);
          if (dx < -0.3) gameState.keys.add('KeyA'); else gameState.keys.delete('KeyA');
          if (dx > 0.3)  gameState.keys.add('KeyD'); else gameState.keys.delete('KeyD');
          if (dz < -0.3) gameState.keys.add('KeyW'); else gameState.keys.delete('KeyW');
          if (dz > 0.3)  gameState.keys.add('KeyS'); else gameState.keys.delete('KeyS');
        }}
        onTouchEnd={() => {
          ['KeyW','KeyS','KeyA','KeyD'].forEach(k => gameState.keys.delete(k));
          if (dotRef.current) dotRef.current.style.transform = 'translate(-50%,-50%)';
        }}
      >
        <div ref={joyRef} className="joystick-outer"><div ref={dotRef} className="joystick-inner" /></div>
      </div>
      <div className="mobile-buttons">
        <div className="mobile-btn btn-fire" onTouchStart={() => gameState.keys.add('__fire')} onTouchEnd={() => gameState.keys.delete('__fire')}>FIRE</div>
        <div className="mobile-btn btn-jump" onTouchStart={() => gameState.keys.add('Space')} onTouchEnd={() => gameState.keys.delete('Space')}>JUMP</div>
        <div className="mobile-btn btn-crouch" onTouchStart={() => { gameState.isCrouching = !gameState.isCrouching; }}>CROUCH</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  STANDALONE HELPERS
// ══════════════════════════════════════════════════════════
function moveBotToward(bot: BotData, target: THREE.Vector3, speed: number, dt: number, buildingAABBs: BuildingAABB[]) {
  const dir = target.clone().sub(bot.position); dir.y = 0;
  if (dir.lengthSq() < 0.5) return;
  dir.normalize();

  const newX = clamp(bot.position.x + dir.x * speed * dt, -CONFIG.MAP_SIZE/2+2, CONFIG.MAP_SIZE/2-2);
  const newZ = clamp(bot.position.z + dir.z * speed * dt, -CONFIG.MAP_SIZE/2+2, CONFIG.MAP_SIZE/2-2);
  const bRadius = 0.45;

  // Building push-out for bots
  let finalX = newX, finalZ = newZ;
  for (const ab of buildingAABBs) {
    if (finalX > ab.minX - bRadius && finalX < ab.maxX + bRadius &&
        finalZ > ab.minZ - bRadius && finalZ < ab.maxZ + bRadius) {
      // Simple deflection: try just X or just Z movement
      const testX = clamp(bot.position.x + dir.x * speed * dt, -CONFIG.MAP_SIZE/2+2, CONFIG.MAP_SIZE/2-2);
      const testZ = bot.position.z;
      const xOk = !(testX > ab.minX - bRadius && testX < ab.maxX + bRadius && testZ > ab.minZ - bRadius && testZ < ab.maxZ + bRadius);
      if (xOk) { finalX = testX; finalZ = bot.position.z; }
      else { finalX = bot.position.x; finalZ = newZ; }
      break;
    }
  }
  bot.position.x = finalX; bot.position.z = finalZ;
  bot.position.y = getTerrainHeight(bot.position.x, bot.position.z) + 0.9;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function killBot(bot: BotData, _bots: BotData[], scene: THREE.Scene, state: any) {
  bot.alive = false;
  scene.remove(bot.mesh); scene.remove(bot.hitbox);
  state.playersAlive = Math.max(1, state.playersAlive - 1);
  if (state.kills !== undefined) {
    state.kills++;
    const entry: KillEntry = { text: `Bot-${bot.id} eliminated`, id: state.killFeedId++ };
    state.killFeed.push(entry);
    if (state.killFeed.length > 6) state.killFeed.shift();
  }
}

function tryReload(state: any) {
  if (state.isReloading || state.reserveAmmo <= 0) return;
  if (state.currentAmmo >= CONFIG.WEAPONS[state.currentWeapon].magSize) return;
  state.isReloading = true; state.reloadTimer = 2.0;
  playReloadSound();
}

function switchWeapon(state: any, slot: number, weaponGroup: THREE.Group) {
  if (!state.weaponSlots[slot]) return;
  state.currentWeapon = state.weaponSlots[slot];
  state.currentAmmo = CONFIG.WEAPONS[state.currentWeapon].magSize;
  buildWeaponMesh(weaponGroup, state.currentWeapon);
}

function useMedical(state: any, type: 'bandage' | 'kit') {
  if (type === 'bandage' && state.bandages > 0 && state.hp < state.maxHp) {
    state.bandages--; state.hp = Math.min(state.maxHp, state.hp + 25);
  } else if (type === 'kit' && state.healthKits > 0) {
    state.healthKits--; state.hp = state.maxHp;
  }
}

function pickupNearbyLoot(lootBoxes: LootBox[], scene: THREE.Scene, state: any, _setUI: any) {
  if (state.nearLootId < 0) return;
  const lb = lootBoxes[state.nearLootId];
  if (!lb || lb.picked) return;
  lb.picked = true; scene.remove(lb.mesh); lb.mesh.geometry.dispose();

  const roll = Math.random();
  if (roll < 0.45) {
    const newWeapon = lb.weaponType;
    const empty = state.weaponSlots.findIndex((s: WeaponKey | null) => s === null);
    if (empty >= 0) { state.weaponSlots[empty] = newWeapon; }
    else { state.weaponSlots[0] = newWeapon; }
    state.currentWeapon = newWeapon;
    state.currentAmmo = CONFIG.WEAPONS[newWeapon].magSize;
    state.reserveAmmo = CONFIG.WEAPONS[newWeapon].magSize * 3;
    const entry: KillEntry = { text: `وجدت ${CONFIG.WEAPONS[newWeapon].name}!`, id: state.killFeedId++ };
    state.killFeed.push(entry);
    if (state.killFeed.length > 6) state.killFeed.shift();
  } else if (roll < 0.62) {
    state.armor = Math.min(80, state.armor + 40); state.armorLevel = Math.min(3, state.armorLevel + 1);
  } else if (roll < 0.76) { state.healthKits++; }
  else if (roll < 0.92) { state.bandages++; }
  else { state.reserveAmmo += CONFIG.WEAPONS[state.currentWeapon].magSize * 2; }
  state.nearLootId = -1;
}

function buildWeaponMesh(group: THREE.Group, weapon: WeaponKey) {
  while (group.children.length) group.remove(group.children[0]);
  const cfg = CONFIG.WEAPONS[weapon];
  const mat = new THREE.MeshLambertMaterial({ color: cfg.color });

  // Main body
  let bodyGeo: THREE.BufferGeometry;
  if      (weapon === 'AWM')    bodyGeo = new THREE.BoxGeometry(0.05, 0.055, 0.62);
  else if (weapon === 'SHOTGUN') bodyGeo = new THREE.BoxGeometry(0.08, 0.10, 0.40);
  else if (weapon === 'UZI')     bodyGeo = new THREE.BoxGeometry(0.08, 0.09, 0.22);
  else                           bodyGeo = new THREE.BoxGeometry(0.06, 0.06, 0.48);
  const body = new THREE.Mesh(bodyGeo, mat);
  group.add(body);

  // Barrel
  const barrelLen = weapon === 'AWM' ? 0.30 : weapon === 'SHOTGUN' ? 0.22 : 0.16;
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, barrelLen, 6),
    new THREE.MeshLambertMaterial({ color: '#111' })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -(barrelLen / 2 + (bodyGeo as any).parameters.depth / 2);
  group.add(barrel);

  // Scope for AWM / M416
  if (weapon === 'AWM' || weapon === 'M416') {
    const scope = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.036, weapon === 'AWM' ? 0.22 : 0.14),
      new THREE.MeshLambertMaterial({ color: '#111' })
    );
    scope.position.set(0, 0.05, -0.05);
    group.add(scope);
    // Lens glint
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.01, 8),
      new THREE.MeshBasicMaterial({ color: weapon === 'AWM' ? 0x4488ff : 0x228844 })
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.05, -0.05 - (weapon === 'AWM' ? 0.115 : 0.075));
    group.add(lens);
  }

  // Grip
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.07, 0.06),
    new THREE.MeshLambertMaterial({ color: '#1a1410' })
  );
  grip.position.set(0, -0.05, 0.06);
  group.add(grip);

  // Muzzle flash placeholder (hidden)
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0 })
  );
  (flash as any).__isFlash = true;
  flash.position.z = -(barrelLen + (bodyGeo as any).parameters.depth / 2 + 0.02);
  flash.scale.setScalar(0.01);
  group.add(flash);
}

function spawnBlood(point: THREE.Vector3, particles: Particle[], scene: THREE.Scene) {
  for (let i = 0; i < 6; i++) {
    const geo = new THREE.SphereGeometry(0.07 + Math.random() * 0.05, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xcc1111, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(point);
    scene.add(mesh);
    particles.push({
      mesh, life: 0.38, maxLife: 0.38,
      velocity: new THREE.Vector3((Math.random()-0.5)*7, Math.random()*5+1, (Math.random()-0.5)*7),
    });
    if (particles.length > 140) { const old = particles.shift()!; scene.remove(old.mesh); old.mesh.geometry.dispose(); }
  }
}

function spawnDust(pos: THREE.Vector3, particles: Particle[], scene: THREE.Scene) {
  for (let i = 0; i < 2; i++) {
    const geo = new THREE.SphereGeometry(0.12, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0x8a7a5a, transparent: true, opacity: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x+(Math.random()-0.5)*0.5, pos.y-CONFIG.PLAYER_HEIGHT+0.1, pos.z+(Math.random()-0.5)*0.5);
    scene.add(mesh);
    particles.push({
      mesh, life: 0.5, maxLife: 0.5,
      velocity: new THREE.Vector3((Math.random()-0.5)*1.5, 0.5+Math.random(), (Math.random()-0.5)*1.5),
    });
    if (particles.length > 140) { const old = particles.shift()!; scene.remove(old.mesh); old.mesh.geometry.dispose(); }
  }
}

function drawMinimap(canvas: HTMLCanvasElement | null, state: any, bots: BotData[], lootBoxes: LootBox[]) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const S = 128, half = CONFIG.MAP_SIZE / 2;
  const toMM = (w: number) => ((w + half) / CONFIG.MAP_SIZE) * S;

  ctx.fillStyle = '#1a2e1a'; ctx.fillRect(0, 0, S, S);

  // Zone
  ctx.beginPath();
  const cx = toMM(state.zone.cx), cy = toMM(state.zone.cz);
  const r = (state.zone.radius / CONFIG.MAP_SIZE) * S;
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,136,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(0,100,200,0.06)'; ctx.fill();

  // Loot
  for (const lb of lootBoxes) {
    if (lb.picked) continue;
    ctx.fillStyle = '#ffaa00';
    ctx.fillRect(toMM(lb.position.x)-1, toMM(lb.position.z)-1, 2, 2);
  }

  // Bots
  for (const bot of bots) {
    if (!bot.alive) continue;
    ctx.fillStyle = bot.state === 'cover' ? '#ff8800' : '#ff4444';
    ctx.beginPath(); ctx.arc(toMM(bot.position.x), toMM(bot.position.z), 2, 0, Math.PI * 2); ctx.fill();
  }

  // Player
  const px = toMM(state.position.x), pz = toMM(state.position.z);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(px, pz, 3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, pz);
  ctx.lineTo(px - Math.sin(state.yaw) * 8, pz - Math.cos(state.yaw) * 8);
  ctx.stroke();
  ctx.fillStyle = '#446644'; ctx.font = '9px monospace'; ctx.fillText('N', S/2-3, 10);
}
