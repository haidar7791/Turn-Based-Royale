import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

// ══════════════════════════════════════════════════════════
//  CONFIG — edit these to tune the game
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
  BOT_SIGHT_RANGE: 55,
  BOT_SHOOT_RANGE: 45,
  BOT_ACCURACY: 0.35,
  BOT_REACTION_TIME: 0.9,

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
  hp: number;
  maxHp: number;
  weapon: WeaponKey;
  currentAmmo: number;
  state: 'patrol' | 'chase' | 'attack' | 'flee';
  targetPos: THREE.Vector3;
  stateTimer: number;
  shootTimer: number;
  squad: number;
  alive: boolean;
  updateAccum: number;
}

interface LootBox {
  id: number;
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  weaponType: WeaponKey;
  picked: boolean;
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface KillEntry { text: string; id: number; }

interface UIState {
  hp: number;
  maxHp: number;
  armor: number;
  armorLevel: number;
  currentWeapon: WeaponKey;
  currentAmmo: number;
  reserveAmmo: number;
  ammoType: string;
  isReloading: boolean;
  reloadProgress: number;
  bandages: number;
  healthKits: number;
  playersAlive: number;
  elapsed: number;
  kills: number;
  phase: GamePhase;
  zoneRadius: number;
  zoneWarning: boolean;
  zoneShrinking: boolean;
  nearLoot: string | null;
  hitMarker: boolean;
  isADS: boolean;
  kills_feed: KillEntry[];
  spread: boolean;
}

// ══════════════════════════════════════════════════════════
//  NOISE — declared once at module scope so terrain height
//          can be sampled from helper functions
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
//  AUDIO  (Web Audio API — fully synthesized)
// ══════════════════════════════════════════════════════════
let audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}
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
  } catch (_) { /* ignore */ }
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
  } catch (_) { /* ignore */ }
}
function playZoneBeep() {
  try {
    const ctx = getAudioCtx();
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 440 + i * 220; o.type = 'sine';
      const t = ctx.currentTime + i * 0.25;
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.22);
    }
  } catch (_) { /* ignore */ }
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
  } catch (_) { /* ignore */ }
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
    frameId: number;
    uiTimer: ReturnType<typeof setInterval>;
    minimapTimer: ReturnType<typeof setInterval>;
    botKillTimer: ReturnType<typeof setInterval>;
    footAccum: number;
  } | null>(null);

  // All mutable game state in a ref (no React re-renders)
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
    weaponSlots: ['AK47'] as (WeaponKey | null)[],
    currentAmmo: 30,
    reserveAmmo: 90,
    isReloading: false,
    reloadTimer: 0,
    bandages: 2, healthKits: 0,
    kills: 0, playersAlive: 100,
    elapsed: 0,
    yaw: 0, pitch: 0,
    recoilPitch: 0,
    shootCooldown: 0,
    isADS: false,
    currentFOV: 75,
    zone: { radius: CONFIG.ZONE_INITIAL_RADIUS, target: CONFIG.ZONE_INITIAL_RADIUS, cx: 0, cz: 0, timer: CONFIG.ZONE_SHRINK_INTERVAL, shrinking: false },
    keys: new Set<string>(),
    nearLootId: -1,
    hitMarkerTimer: 0,
    zoneShrinkBannerTimer: 0,
    footAccum: 0,
    killFeed: [] as KillEntry[],
    killFeedId: 0,
    spreadTimer: 0,
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
  });

  // ── Build a bot mesh ──
  const makeBotMesh = useCallback((squadColor: string): THREE.Group => {
    const g = new THREE.Group();
    const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8);
    const bodyMat = new THREE.MeshLambertMaterial({ color: squadColor });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    g.add(body);
    const headGeo = new THREE.SphereGeometry(0.22, 8, 8);
    const headMat = new THREE.MeshLambertMaterial({ color: '#f0c090' });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.8;
    g.add(head);
    // Indicator dot above head
    const dotGeo = new THREE.SphereGeometry(0.1, 6, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color: '#ff0000' });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.y = 2.3;
    g.add(dot);
    return g;
  }, []);

  // ── Initialize / restart game ──
  const initGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Clean up previous
    if (threeRef.current) {
      const t = threeRef.current;
      cancelAnimationFrame(t.frameId);
      clearInterval(t.uiTimer);
      clearInterval(t.minimapTimer);
      clearInterval(t.botKillTimer);
      t.renderer.dispose();
    }

    // ── Reset game state ──
    const state = gs.current;
    state.phase = 'playing';
    state.hp = 100; state.maxHp = 100;
    state.armor = 0; state.armorLevel = 0;
    state.position.set((Math.random() - 0.5) * 60, 40, (Math.random() - 0.5) * 60);
    state.velocity.set(0, 0, 0);
    state.isGrounded = false; state.isSprinting = false; state.isCrouching = false;
    state.currentWeapon = 'AK47';
    state.weaponSlots = ['AK47', null, null];
    state.currentAmmo = 30; state.reserveAmmo = 90;
    state.isReloading = false; state.reloadTimer = 0;
    state.bandages = 2; state.healthKits = 0;
    state.kills = 0; state.playersAlive = 100;
    state.elapsed = 0; state.yaw = 0; state.pitch = 0;
    state.recoilPitch = 0; state.shootCooldown = 0;
    state.isADS = false; state.currentFOV = 75;
    state.zone = { radius: CONFIG.ZONE_INITIAL_RADIUS, target: CONFIG.ZONE_INITIAL_RADIUS, cx: 0, cz: 0, timer: CONFIG.ZONE_SHRINK_INTERVAL, shrinking: false };
    state.keys.clear();
    state.nearLootId = -1; state.hitMarkerTimer = 0; state.zoneShrinkBannerTimer = 0;
    state.footAccum = 0; state.killFeed = []; state.killFeedId = 0; state.spreadTimer = 0;

    // ── Three.js setup ──
    const W = window.innerWidth, H = window.innerHeight;

    // WebGL support check
    const testCtx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!testCtx) { setWebglError(true); return; }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, context: testCtx as WebGL2RenderingContext });
    } catch (_) {
      try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false }); }
      catch (__) { setWebglError(true); return; }
    }
    renderer!.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x7aabb5, 0.003);
    scene.background = new THREE.Color(0x87CEEB);

    const camera = new THREE.PerspectiveCamera(75, W / H, 0.1, 800);
    camera.position.copy(state.position);

    // Lighting
    scene.add(new THREE.AmbientLight(0x404040, 1.2));
    const sun = new THREE.DirectionalLight(0xfff8e0, 1.8);
    sun.position.set(100, 200, 80);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x87CEEB, 0x3d5c2e, 0.6));

    // ── TERRAIN ──
    const terrGeo = new THREE.PlaneGeometry(CONFIG.MAP_SIZE, CONFIG.MAP_SIZE, CONFIG.TERRAIN_SEGMENTS, CONFIG.TERRAIN_SEGMENTS);
    terrGeo.rotateX(-Math.PI / 2);
    const pos = terrGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, getTerrainHeight(x, z));
    }
    terrGeo.computeVertexNormals();
    const terrMat = new THREE.MeshLambertMaterial({ color: 0x3d5c2e });
    const terrain = new THREE.Mesh(terrGeo, terrMat);
    scene.add(terrain);

    // ── WATER ──
    const waterGeo = new THREE.PlaneGeometry(CONFIG.MAP_SIZE, CONFIG.MAP_SIZE);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshPhongMaterial({ color: 0x1a4a7a, transparent: true, opacity: 0.78 });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = -1.5;
    scene.add(water);

    // ── TREES (InstancedMesh) ──
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 2, 6);
    const canopyGeo = new THREE.ConeGeometry(2.5, 4, 7);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5c3a1e }), CONFIG.TREE_COUNT);
    const canopyMesh = new THREE.InstancedMesh(canopyGeo, new THREE.MeshLambertMaterial({ color: 0x1a4d1a }), CONFIG.TREE_COUNT);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < CONFIG.TREE_COUNT; i++) {
      const tx = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.9;
      const tz = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.9;
      const ty = getTerrainHeight(tx, tz);
      dummy.position.set(tx, ty + 1, tz); dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(tx, ty + 4, tz); dummy.updateMatrix();
      canopyMesh.setMatrixAt(i, dummy.matrix);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
    scene.add(trunkMesh); scene.add(canopyMesh);

    // ── BUILDINGS ──
    for (let i = 0; i < CONFIG.BUILDING_COUNT; i++) {
      const bx = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.7;
      const bz = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.7;
      const bw = 5 + Math.random() * 10, bh = 4 + Math.random() * 8, bd = 5 + Math.random() * 10;
      const by = getTerrainHeight(bx, bz);
      const bGeo = new THREE.BoxGeometry(bw, bh, bd);
      const bMat = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(0, 0, 0.3 + Math.random() * 0.15) });
      const bMesh = new THREE.Mesh(bGeo, bMat);
      bMesh.position.set(bx, by + bh / 2, bz);
      scene.add(bMesh);
    }

    // ── ZONE RING ──
    const ringGeo = new THREE.TorusGeometry(CONFIG.ZONE_INITIAL_RADIUS, 1.0, 8, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const zoneRing = new THREE.Mesh(ringGeo, ringMat);
    zoneRing.rotation.x = Math.PI / 2;
    zoneRing.position.y = 1;
    scene.add(zoneRing);

    // ── WEAPON (camera child) ──
    const weaponGroup = new THREE.Group();
    camera.add(weaponGroup);
    scene.add(camera);
    buildWeaponMesh(weaponGroup, state.currentWeapon);

    // ── MUZZLE FLASH LIGHT ──
    const muzzleLight = new THREE.PointLight(0xffff00, 0, 6);
    camera.add(muzzleLight);
    muzzleLight.position.set(0.2, -0.22, -0.85);

    // ── PLAYER HITBOX (invisible, for bot raycasting) ──
    const playerHitbox = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    scene.add(playerHitbox);

    // ── LOOT BOXES ──
    const lootBoxes: LootBox[] = [];
    const lootGeo = new THREE.BoxGeometry(0.85, 0.85, 0.85);
    for (let i = 0; i < CONFIG.LOOT_COUNT; i++) {
      const lx = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.85;
      const lz = (Math.random() - 0.5) * CONFIG.MAP_SIZE * 0.85;
      const ly = getTerrainHeight(lx, lz) + 0.5;
      const lMat = new THREE.MeshPhongMaterial({ color: 0xaa6600, emissive: 0x553300, emissiveIntensity: 0.5 });
      const lMesh = new THREE.Mesh(lootGeo, lMat);
      lMesh.position.set(lx, ly, lz);
      scene.add(lMesh);
      lootBoxes.push({ id: i, mesh: lMesh, position: new THREE.Vector3(lx, ly, lz), weaponType: randomWeapon(), picked: false });
    }

    // ── BOTS ──
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
        new THREE.CapsuleGeometry(0.35, 1.0, 4, 8),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hb.position.set(bx, by + 0.5, bz);
      scene.add(hb);
      hitboxMeshes.push(hb);
      const wType = randomWeapon();
      bots.push({
        id: i, mesh, hitbox: hb,
        position: new THREE.Vector3(bx, by, bz),
        velocity: new THREE.Vector3(),
        hp: 60 + Math.random() * 60,
        maxHp: 120,
        weapon: wType,
        currentAmmo: CONFIG.WEAPONS[wType].magSize,
        state: 'patrol',
        targetPos: new THREE.Vector3(bx, by, bz),
        stateTimer: Math.random() * 4,
        shootTimer: 1.0,
        squad, alive: true,
        updateAccum: Math.random() * 0.05,
      });
    }

    const particles: Particle[] = [];
    const clock = new THREE.Clock();

    // ── EVENT LISTENERS ──
    const onKeyDown = (e: KeyboardEvent) => {
      state.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyF') pickupNearbyLoot(lootBoxes, scene, state, setUI);
      if (e.code === 'KeyR') tryReload(state);
      if (e.code === 'Digit1') switchWeapon(state, 0, weaponGroup);
      if (e.code === 'Digit2') switchWeapon(state, 1, weaponGroup);
      if (e.code === 'Digit3') switchWeapon(state, 2, weaponGroup);
      if (e.code === 'KeyC') { state.isCrouching = !state.isCrouching; }
    };
    const onKeyUp = (e: KeyboardEvent) => { state.keys.delete(e.code); };
    const onMouseMove = (e: MouseEvent) => {
      if (state.phase !== 'playing') return;
      state.yaw   -= e.movementX * 0.002;
      state.pitch -= e.movementY * 0.002;
      state.pitch = clamp(state.pitch, -Math.PI / 2.3, Math.PI / 2.3);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) shoot(state, camera, bots, hitboxMeshes, scene, particles, weaponGroup, muzzleLight);
      if (e.button === 2) { state.isADS = true; }
    };
    const onMouseUp = (e: MouseEvent) => { if (e.button === 2) state.isADS = false; };
    const onContextMenu = (e: Event) => e.preventDefault();
    const onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('resize', onResize);

    // Pointer lock
    canvas.addEventListener('click', () => {
      if (state.phase === 'playing') canvas.requestPointerLock();
    });

    // ── UI UPDATE (10fps) ──
    const uiTimer = setInterval(() => {
      const s = gs.current;
      const wc = CONFIG.WEAPONS[s.currentWeapon];
      setUI({
        hp: Math.max(0, s.hp), maxHp: s.maxHp,
        armor: s.armor, armorLevel: s.armorLevel,
        currentWeapon: s.currentWeapon,
        currentAmmo: s.currentAmmo, reserveAmmo: s.reserveAmmo,
        ammoType: wc.ammoType,
        isReloading: s.isReloading,
        reloadProgress: s.isReloading ? (1 - s.reloadTimer / 2.0) : 0,
        bandages: s.bandages, healthKits: s.healthKits,
        playersAlive: s.playersAlive,
        elapsed: s.elapsed, kills: s.kills,
        phase: s.phase,
        zoneRadius: s.zone.radius,
        zoneWarning: (() => {
          const d = Math.sqrt(s.position.x ** 2 + s.position.z ** 2);
          return d > s.zone.radius;
        })(),
        zoneShrinking: s.zoneShrinkBannerTimer > 0,
        nearLoot: s.nearLootId >= 0 ? CONFIG.WEAPONS[lootBoxes[s.nearLootId]?.weaponType ?? 'AK47']?.name ?? null : null,
        hitMarker: s.hitMarkerTimer > 0,
        isADS: s.isADS,
        kills_feed: [...s.killFeed],
        spread: s.spreadTimer > 0,
      });
    }, 100);

    // ── MINIMAP (5fps) ──
    const minimapTimer = setInterval(() => drawMinimap(minimapRef.current, gs.current, bots, lootBoxes), 200);

    // ── OFF-SCREEN BOT DEATHS (simulate distant combat) ──
    const botKillTimer = setInterval(() => {
      const s = gs.current;
      if (s.phase !== 'playing') return;
      if (s.playersAlive > CONFIG.RENDER_BOTS + 1) {
        const offscreen = s.playersAlive - CONFIG.RENDER_BOTS - 1;
        if (offscreen > 0 && Math.random() < 0.4) s.playersAlive = Math.max(CONFIG.RENDER_BOTS + 1, s.playersAlive - 1);
      }
    }, 18000 + Math.random() * 12000);

    // ── ANIMATION LOOP ──
    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const raw = clock.getDelta();
      const delta = Math.min(raw, 0.05);
      const s = gs.current;
      if (s.phase !== 'playing') return;

      s.elapsed += delta;
      s.shootCooldown = Math.max(0, s.shootCooldown - delta);
      s.hitMarkerTimer = Math.max(0, s.hitMarkerTimer - delta);
      s.zoneShrinkBannerTimer = Math.max(0, s.zoneShrinkBannerTimer - delta);
      s.spreadTimer = Math.max(0, s.spreadTimer - delta);

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
      const targetFOV = s.isADS ? (s.currentWeapon === 'AWM' ? 15 : 45) : 75;
      s.currentFOV += (targetFOV - s.currentFOV) * 0.12;
      camera.fov = s.currentFOV;
      camera.updateProjectionMatrix();

      // Recoil recovery
      s.recoilPitch *= 0.88;

      // Camera rotation
      camera.quaternion.setFromEuler(new THREE.Euler(s.pitch + s.recoilPitch, s.yaw, 0, 'YXZ'));

      // Movement
      const speed = s.isSprinting && !s.isCrouching ? CONFIG.PLAYER_RUN_SPEED : (s.isCrouching ? CONFIG.PLAYER_SPEED * 0.5 : CONFIG.PLAYER_SPEED);
      const forward = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
      const right   = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
      const isMoving = s.keys.has('KeyW') || s.keys.has('KeyS') || s.keys.has('KeyA') || s.keys.has('KeyD');

      if (s.keys.has('KeyW')) s.position.addScaledVector(forward, speed * delta);
      if (s.keys.has('KeyS')) s.position.addScaledVector(forward, -speed * delta * 0.7);
      if (s.keys.has('KeyA')) s.position.addScaledVector(right, -speed * delta);
      if (s.keys.has('KeyD')) s.position.addScaledVector(right, speed * delta);
      s.isSprinting = s.keys.has('ShiftLeft') || s.keys.has('ShiftRight');

      // Gravity
      s.velocity.y -= 20 * delta;
      s.position.y += s.velocity.y * delta;

      // Ground
      const groundY = getTerrainHeight(s.position.x, s.position.z);
      const ph = s.isCrouching ? 0.9 : CONFIG.PLAYER_HEIGHT;
      if (s.position.y < groundY + ph) {
        s.position.y = groundY + ph;
        s.velocity.y = 0;
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
      const bobAmt = isMoving ? (s.isSprinting ? 0.014 : 0.008) : 0.002;
      weaponGroup.position.set(0.22, -0.22 + Math.sin(s.elapsed * (s.isSprinting ? 12 : 8)) * bobAmt, -0.5);
      weaponGroup.rotation.z = Math.sin(s.elapsed * (s.isSprinting ? 12 : 8) * 0.5) * (isMoving ? 0.012 : 0.003);

      // Muzzle flash decay
      muzzleLight.intensity *= 0.6;

      // Footsteps
      if (isMoving && s.isGrounded) {
        s.footAccum += delta;
        if (s.footAccum > (s.isSprinting ? 0.3 : 0.45)) {
          s.footAccum = 0;
          spawnDust(s.position, particles, scene);
        }
      }

      // ── ZONE ──
      s.zone.timer -= delta;
      if (s.zone.timer <= 0 && s.zone.radius > CONFIG.ZONE_MIN_RADIUS) {
        s.zone.timer = CONFIG.ZONE_SHRINK_INTERVAL;
        s.zone.target = Math.max(CONFIG.ZONE_MIN_RADIUS, s.zone.radius * 0.62);
        s.zone.shrinking = true;
        s.zoneShrinkBannerTimer = 3.5;
        playZoneBeep();
        // Shift zone center slightly
        s.zone.cx += (Math.random() - 0.5) * 30;
        s.zone.cz += (Math.random() - 0.5) * 30;
      }
      if (s.zone.shrinking) {
        s.zone.radius += (s.zone.target - s.zone.radius) * CONFIG.ZONE_SHRINK_RATE;
        if (Math.abs(s.zone.radius - s.zone.target) < 0.5) s.zone.shrinking = false;
      }

      // Zone ring update
      const scaleFactor = s.zone.radius / CONFIG.ZONE_INITIAL_RADIUS;
      zoneRing.scale.set(scaleFactor, scaleFactor, scaleFactor);
      zoneRing.position.set(s.zone.cx, 1, s.zone.cz);

      // Zone damage to player
      const pd = Math.sqrt((s.position.x - s.zone.cx) ** 2 + (s.position.z - s.zone.cz) ** 2);
      if (pd > s.zone.radius) {
        s.hp -= CONFIG.ZONE_DAMAGE_RATE * delta;
        if (s.hp <= 0) { s.phase = 'dead'; }
      }

      // ── LOOT pulse & proximity ──
      let closestLootDist = 2.5, closestLootId = -1;
      for (const lb of lootBoxes) {
        if (lb.picked) continue;
        const ld = lb.position.distanceTo(s.position);
        if (ld < closestLootDist) { closestLootDist = ld; closestLootId = lb.id; }
        (lb.mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.4 + Math.sin(s.elapsed * 2.5) * 0.3;
      }
      s.nearLootId = closestLootId;

      // ── BOTS ──
      for (const bot of bots) {
        if (!bot.alive) continue;
        bot.updateAccum += delta;
        if (bot.updateAccum < 0.05) continue;
        const dt = bot.updateAccum; bot.updateAccum = 0;

        const distToPlayer = bot.position.distanceTo(s.position);

        if (bot.state === 'patrol') {
          bot.stateTimer -= dt;
          if (bot.stateTimer <= 0) {
            const a = Math.random() * Math.PI * 2;
            bot.targetPos.set(bot.position.x + Math.cos(a) * 25, 0, bot.position.z + Math.sin(a) * 25);
            bot.targetPos.x = clamp(bot.targetPos.x, -CONFIG.MAP_SIZE / 2 + 5, CONFIG.MAP_SIZE / 2 - 5);
            bot.targetPos.z = clamp(bot.targetPos.z, -CONFIG.MAP_SIZE / 2 + 5, CONFIG.MAP_SIZE / 2 - 5);
            bot.stateTimer = 3 + Math.random() * 4;
          }
          moveBotToward(bot, bot.targetPos, CONFIG.BOT_SPEED, dt);
          if (distToPlayer < CONFIG.BOT_SIGHT_RANGE) bot.state = 'chase';
        } else if (bot.state === 'chase') {
          moveBotToward(bot, s.position, CONFIG.BOT_SPEED * 1.35, dt);
          if (distToPlayer < CONFIG.BOT_SHOOT_RANGE) bot.state = 'attack';
          if (distToPlayer > CONFIG.BOT_SIGHT_RANGE * 1.6) bot.state = 'patrol';
        } else if (bot.state === 'attack') {
          bot.shootTimer -= dt;
          // Strafe
          const perp = new THREE.Vector3(-(s.position.z - bot.position.z), 0, s.position.x - bot.position.x).normalize();
          bot.position.addScaledVector(perp, CONFIG.BOT_SPEED * 0.45 * dt * (Math.sin(s.elapsed * 2 + bot.id) > 0 ? 1 : -1));
          bot.position.x = clamp(bot.position.x, -CONFIG.MAP_SIZE / 2 + 2, CONFIG.MAP_SIZE / 2 - 2);
          bot.position.z = clamp(bot.position.z, -CONFIG.MAP_SIZE / 2 + 2, CONFIG.MAP_SIZE / 2 - 2);
          bot.position.y = getTerrainHeight(bot.position.x, bot.position.z) + 0.9;

          if (bot.shootTimer <= 0 && distToPlayer < CONFIG.BOT_SHOOT_RANGE) {
            bot.shootTimer = CONFIG.BOT_REACTION_TIME + Math.random() * 0.6;
            const wDmg = CONFIG.WEAPONS[bot.weapon].damage;
            const spread = CONFIG.BOT_ACCURACY;
            const dirToPlayer = s.position.clone().sub(bot.position).normalize();
            dirToPlayer.x += (Math.random() - 0.5) * spread * 2;
            dirToPlayer.z += (Math.random() - 0.5) * spread * 2;
            // Simple distance-based hit check
            const hitChance = 1 - clamp(distToPlayer / CONFIG.BOT_SHOOT_RANGE, 0, 1) * 0.7;
            if (Math.random() < hitChance) {
              const dmg = wDmg * 0.65;
              if (s.armor > 0) {
                const absorbed = Math.min(s.armor, dmg * 0.6);
                s.armor -= absorbed;
                s.hp -= dmg - absorbed;
              } else {
                s.hp -= dmg;
              }
              if (s.hp <= 0) { s.phase = 'dead'; }
            }
          }
          if (bot.hp < bot.maxHp * 0.28) bot.state = 'flee';
          if (distToPlayer > CONFIG.BOT_SHOOT_RANGE * 1.5) bot.state = 'chase';
        } else if (bot.state === 'flee') {
          const awayFromPlayer = bot.position.clone().sub(s.position).normalize();
          bot.targetPos.set(bot.position.x + awayFromPlayer.x * 40, 0, bot.position.z + awayFromPlayer.z * 40);
          moveBotToward(bot, bot.targetPos, CONFIG.BOT_SPEED * 1.5, dt);
          if (distToPlayer > 90) bot.state = 'patrol';
        }

        // Bot zone damage
        const bdist = Math.sqrt((bot.position.x - s.zone.cx) ** 2 + (bot.position.z - s.zone.cz) ** 2);
        if (bdist > s.zone.radius) {
          bot.hp -= 8 * dt;
          if (bot.hp <= 0) killBot(bot, bots, scene, s);
        }

        // Update mesh
        bot.mesh.position.copy(bot.position);
        bot.hitbox.position.set(bot.position.x, bot.position.y + 0.5, bot.position.z);
        // Face movement direction
        if (bot.state !== 'attack') {
          const td = bot.targetPos.clone().sub(bot.position); td.y = 0;
          if (td.lengthSq() > 0.01) bot.mesh.lookAt(bot.mesh.position.clone().add(td));
        } else {
          bot.mesh.lookAt(new THREE.Vector3(s.position.x, bot.position.y, s.position.z));
        }
      }

      // ── PARTICLES ──
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= delta;
        if (p.life <= 0) { scene.remove(p.mesh); p.mesh.geometry.dispose(); particles.splice(i, 1); continue; }
        p.velocity.y -= 12 * delta;
        p.mesh.position.addScaledVector(p.velocity, delta);
        const t = p.life / p.maxLife;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = t;
      }

      // Win check
      if (s.playersAlive <= 1 && bots.filter(b => b.alive).length === 0) {
        s.phase = 'winner';
      }

      renderer.render(scene, camera);
    };

    animate();
    threeRef.current = { renderer, scene, camera, clock, weaponGroup, zoneRing, muzzleLight, playerHitbox, bots, lootBoxes, particles, hitboxMeshes, frameId, uiTimer, minimapTimer, botKillTimer, footAccum: 0 };

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frameId);
      clearInterval(uiTimer);
      clearInterval(minimapTimer);
      clearInterval(botKillTimer);
      renderer.dispose();
    };
  }, [makeBotMesh]);

  // Shoot via closure using current refs
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
    state.recoilPitch += wCfg.recoil * (state.isADS ? 0.55 : 1.0);
    state.spreadTimer = 0.3;
    playGunshot(state.currentWeapon);
    muzzleLight.intensity = 3.0;

    const spreadCount = state.currentWeapon === 'SHOTGUN' ? 8 : 1;
    const raycaster = new THREE.Raycaster();
    raycaster.far = wCfg.range;
    let hit = false;

    for (let s = 0; s < spreadCount; s++) {
      const spread = state.currentWeapon === 'SHOTGUN' ? 0.12 : 0.0;
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * spread * 2,
        (Math.random() - 0.5) * spread * 2,
        -1
      ).normalize();
      dir.applyQuaternion(camera.quaternion);
      raycaster.set(camera.position, dir);

      const intersects = raycaster.intersectObjects(hitboxMeshes, false);
      for (const ix of intersects) {
        // Find which bot
        for (let bi = 0; bi < hitboxMeshes.length; bi++) {
          if (ix.object === hitboxMeshes[bi] && bots[bi].alive) {
            const dmg = wCfg.damage * (0.85 + Math.random() * 0.3);
            bots[bi].hp -= dmg;
            spawnBlood(ix.point, particles, scene);
            hit = true;
            if (bots[bi].hp <= 0) {
              killBot(bots[bi], bots, scene, state);
            }
            break;
          }
        }
      }
    }
    if (hit) { state.hitMarkerTimer = 0.25; playHitMarker(); }

    // Muzzle flash tracer
    const end = new THREE.Vector3(0, 0, -Math.min(wCfg.range, 80));
    end.applyQuaternion(camera.quaternion).add(camera.position);
    const tracerGeo = new THREE.BufferGeometry().setFromPoints([camera.position.clone(), end]);
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.7 });
    const tracer = new THREE.Line(tracerGeo, tracerMat);
    scene.add(tracer);
    setTimeout(() => { scene.remove(tracer); tracerGeo.dispose(); tracerMat.dispose(); }, 120);

    if (state.currentAmmo <= 0 && state.reserveAmmo > 0) tryReload(state);
  }

  useEffect(() => {
    const cleanup = initGame();
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStartGame = () => {
    gs.current.phase = 'playing';
    canvasRef.current?.requestPointerLock();
  };

  const handleRestart = () => { initGame(); };

  const elapsed = ui.elapsed;
  const mm = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const ss = Math.floor(elapsed % 60).toString().padStart(2, '0');
  const hpPct = (ui.hp / ui.maxHp) * 100;
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

      {/* ── HUD ── */}
      {ui.phase === 'playing' && (
        <div className="hud">
          {/* Crosshair */}
          <div className={`crosshair${ui.spread ? ' spread' : ''}`}>
            <div className="ch-line ch-top" />
            <div className="ch-line ch-bottom" />
            <div className="ch-line ch-left" />
            <div className="ch-line ch-right" />
          </div>

          {/* Hit marker */}
          {ui.hitMarker && <div className="hit-marker" />}

          {/* AWM scope */}
          {ui.isADS && ui.currentWeapon === 'AWM' && (
            <div className="scope-overlay">
              <div className="scope-bg" />
              <div className="scope-lines" />
            </div>
          )}

          {/* Top-left: status */}
          <div className="hud-panel status-panel">
            <div className="bar-label"><span>HP</span><span style={{ color: hpPct > 50 ? '#44ff44' : hpPct > 25 ? '#ffaa00' : '#ff4444' }}>{Math.ceil(ui.hp)}/{ui.maxHp}</span></div>
            <div className="bar-track"><div className="bar-fill bar-hp" style={{ width: `${hpPct}%`, background: hpPct > 60 ? '#44aa44' : hpPct > 30 ? '#ffaa00' : '#ff4444' }} /></div>
            {ui.armorLevel > 0 && (
              <>
                <div className="bar-label"><span>Armor Lv.{ui.armorLevel}</span><span style={{ color: '#4488ff' }}>{Math.ceil(ui.armor)}</span></div>
                <div className="bar-track"><div className="bar-fill bar-armor" style={{ width: `${armorPct}%` }} /></div>
              </>
            )}
            <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>
              {ui.bandages > 0 && <span style={{ marginRight: 8 }}>💊 ×{ui.bandages}</span>}
              {ui.healthKits > 0 && <span style={{ marginRight: 8 }}>🩺 ×{ui.healthKits}</span>}
            </div>
          </div>

          {/* Top-center */}
          <div className="hud-panel alive-panel">
            <div className="alive-count">{ui.playersAlive}</div>
            <div className="alive-label">لاعب على قيد الحياة</div>
            <div className="timer">{mm}:{ss}</div>
          </div>

          {/* Top-right: minimap */}
          <div className="minimap-container hud-panel" style={{ padding: 4 }}>
            <canvas ref={minimapRef} className="minimap-canvas" width={128} height={128} />
            <div className="minimap-label">خريطة | {Math.ceil(ui.zoneRadius)}m</div>
          </div>

          {/* Kill feed */}
          <div className="killfeed" style={{ top: 168 }}>
            {ui.kills_feed.slice(-5).map(k => (
              <div key={k.id} className="kill-entry">{k.text}</div>
            ))}
          </div>

          {/* Zone warning */}
          {ui.zoneWarning && (
            <div className="zone-warning" dir="rtl">⚠ خارج المنطقة الآمنة — تتلقى ضرراً!</div>
          )}
          {ui.zoneShrinking && (
            <div className="zone-shrink-banner" dir="rtl">🔵 المنطقة الآمنة تتقلص!</div>
          )}

          {/* Loot prompt */}
          {ui.nearLoot && (
            <div className="loot-prompt" dir="rtl">اضغط F للنهب: {ui.nearLoot}</div>
          )}

          {/* Bottom-center: weapon */}
          <div className="hud-panel weapon-panel">
            <span className="weapon-name">{CONFIG.WEAPONS[ui.currentWeapon].name}</span>
            {ui.isReloading ? (
              <div className="reload-bar-wrap" dir="rtl">
                جار إعادة التحميل...
                <div className="reload-bar-track"><div className="reload-bar-fill" style={{ width: `${ui.reloadProgress * 100}%` }} /></div>
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

          {/* Bottom-left: inventory */}
          <div className="hud-panel inventory-panel">
            {['AK47', 'M416', 'SHOTGUN'].map((w, i) => (
              <div key={w} className={`weapon-slot${ui.currentWeapon === w ? ' active' : ''}`}>
                <span className="slot-num">{i + 1}</span>
                <span>{CONFIG.WEAPONS[w as WeaponKey].name}</span>
              </div>
            ))}
            <div className="healing-items" dir="rtl">
              <div className="heal-row"><span>ضمادة</span><span>{ui.bandages}</span></div>
              <div className="heal-row"><span>حقيبة إسعاف</span><span>{ui.healthKits}</span></div>
            </div>
          </div>

          {/* Controls reminder */}
          <div style={{ position: 'absolute', bottom: 12, right: 12, fontSize: 9, color: '#333', textAlign: 'right', lineHeight: 1.7 }}>
            WASD حركة · SHIFT جري · C انحناء · SPACE قفز<br />
            CLICK نار · RMB تصويب · F نهب · R إعادة تحميل
          </div>
        </div>
      )}

      {/* ── OVERLAYS ── */}
      {ui.phase === 'menu' && (
        <div className="overlay menu-overlay">
          <div className="menu-title" dir="rtl">بتموس</div>
          <div className="menu-subtitle" dir="rtl">باتل رويال ثلاثي الأبعاد — 100 لاعب</div>
          <button className="btn-play" onClick={handleStartGame} dir="rtl">انقر للعب</button>
          <div className="menu-controls">
            WASD — Move &nbsp;|&nbsp; Mouse — Aim &nbsp;|&nbsp; LMB — Fire &nbsp;|&nbsp; RMB — ADS<br />
            F — Loot &nbsp;|&nbsp; R — Reload &nbsp;|&nbsp; Space — Jump &nbsp;|&nbsp; C — Crouch &nbsp;|&nbsp; Shift — Sprint
          </div>
        </div>
      )}

      {ui.phase === 'dead' && (
        <div className="overlay dead-overlay">
          <div className="overlay-title" style={{ color: '#ff4444' }} dir="rtl">💀 لقد سقطت في المعركة</div>
          <div className="overlay-sub" dir="rtl">حاول مرة أخرى</div>
          <div className="overlay-stats">
            قتلت: {ui.kills} لاعب<br />
            الوقت: {mm}:{ss}<br />
            لاعبون متبقون: {ui.playersAlive}
          </div>
          <button className="btn-restart" onClick={handleRestart} dir="rtl">العب مجدداً</button>
        </div>
      )}

      {ui.phase === 'winner' && (
        <div className="overlay win-overlay">
          <div className="overlay-title" style={{ color: '#ffd700', textShadow: '0 0 30px #ffd700' }}>
            🏆 Winner Winner Chicken Dinner! 🏆
          </div>
          <div className="overlay-title" style={{ color: '#00ff88', fontSize: '2rem' }} dir="rtl">أنت البطل! — بتموس</div>
          <div className="overlay-stats" style={{ color: '#aaa' }}>
            قتلت: {ui.kills} لاعب<br />
            الوقت: {mm}:{ss}
          </div>
          <button className="btn-restart" onClick={handleRestart} dir="rtl">العب مجدداً</button>
        </div>
      )}

      {/* Mobile controls (touch only) */}
      {'ontouchstart' in window && ui.phase === 'playing' && (
        <MobileControls gameState={gs.current} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  MOBILE CONTROLS COMPONENT
// ══════════════════════════════════════════════════════════
function MobileControls({ gameState }: { gameState: ReturnType<typeof useRef<any>>['current'] }) {
  const joyRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const touchId = useRef<number | null>(null);

  return (
    <div className="mobile-controls">
      <div
        className="joystick-zone"
        onTouchStart={e => {
          const t = e.changedTouches[0]; touchId.current = t.identifier;
          const rect = joyRef.current!.getBoundingClientRect();
          const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
          const dx = clamp((t.clientX - cx) / 60, -1, 1);
          const dz = clamp((t.clientY - cy) / 60, -1, 1);
          if (dx < -0.3) gameState.keys.add('KeyA'); else gameState.keys.delete('KeyA');
          if (dx > 0.3)  gameState.keys.add('KeyD'); else gameState.keys.delete('KeyD');
          if (dz < -0.3) gameState.keys.add('KeyW'); else gameState.keys.delete('KeyW');
          if (dz > 0.3)  gameState.keys.add('KeyS'); else gameState.keys.delete('KeyS');
        }}
        onTouchEnd={() => {
          touchId.current = null;
          gameState.keys.delete('KeyW'); gameState.keys.delete('KeyS');
          gameState.keys.delete('KeyA'); gameState.keys.delete('KeyD');
          if (dotRef.current) dotRef.current.style.transform = 'translate(-50%,-50%)';
        }}
      >
        <div ref={joyRef} className="joystick-outer">
          <div ref={dotRef} className="joystick-inner" />
        </div>
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
//  STANDALONE HELPERS (outside component to avoid closure issues)
// ══════════════════════════════════════════════════════════
function moveBotToward(bot: BotData, target: THREE.Vector3, speed: number, dt: number) {
  const dir = target.clone().sub(bot.position); dir.y = 0;
  if (dir.lengthSq() < 0.5) return;
  dir.normalize();
  bot.position.addScaledVector(dir, speed * dt);
  bot.position.x = clamp(bot.position.x, -CONFIG.MAP_SIZE / 2 + 2, CONFIG.MAP_SIZE / 2 - 2);
  bot.position.z = clamp(bot.position.z, -CONFIG.MAP_SIZE / 2 + 2, CONFIG.MAP_SIZE / 2 - 2);
  bot.position.y = getTerrainHeight(bot.position.x, bot.position.z) + 0.9;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function killBot(bot: BotData, _bots: BotData[], scene: THREE.Scene, state: any) {
  bot.alive = false;
  scene.remove(bot.mesh);
  scene.remove(bot.hitbox);
  state.playersAlive = Math.max(1, state.playersAlive - 1);
  if ((state as any).kills !== undefined) {
    (state as any).kills++;
    const entry: KillEntry = { text: `Bot-${bot.id} eliminated`, id: (state as any).killFeedId++ };
    (state as any).killFeed.push(entry);
    if ((state as any).killFeed.length > 6) (state as any).killFeed.shift();
  }
}

function tryReload(state: any) {
  if (state.isReloading || state.reserveAmmo <= 0) return;
  if (state.currentAmmo >= CONFIG.WEAPONS[state.currentWeapon].magSize) return;
  state.isReloading = true;
  state.reloadTimer = 2.0;
  playReloadSound();
}

function switchWeapon(state: any, slot: number, weaponGroup: THREE.Group) {
  if (!state.weaponSlots[slot]) return;
  state.currentWeapon = state.weaponSlots[slot];
  state.currentAmmo = CONFIG.WEAPONS[state.currentWeapon].magSize;
  buildWeaponMesh(weaponGroup, state.currentWeapon);
}

function pickupNearbyLoot(lootBoxes: LootBox[], scene: THREE.Scene, state: any, setUI: any) {
  if (state.nearLootId < 0) return;
  const lb = lootBoxes[state.nearLootId];
  if (!lb || lb.picked) return;
  lb.picked = true;
  scene.remove(lb.mesh);
  lb.mesh.geometry.dispose();

  const roll = Math.random();
  if (roll < 0.45) {
    // Weapon
    const newWeapon = lb.weaponType;
    const empty = state.weaponSlots.findIndex((s: WeaponKey | null) => s === null);
    if (empty >= 0) { state.weaponSlots[empty] = newWeapon; }
    else { state.weaponSlots[0] = newWeapon; state.currentWeapon = newWeapon; }
    state.currentWeapon = newWeapon;
    state.currentAmmo = CONFIG.WEAPONS[newWeapon].magSize;
    state.reserveAmmo = CONFIG.WEAPONS[newWeapon].magSize * 3;
    const entry: KillEntry = { text: `وجدت ${CONFIG.WEAPONS[newWeapon].name}!`, id: state.killFeedId++ };
    state.killFeed.push(entry);
    if (state.killFeed.length > 6) state.killFeed.shift();
  } else if (roll < 0.65) {
    // Armor
    state.armor = Math.min(80, state.armor + 40);
    state.armorLevel = Math.min(3, state.armorLevel + 1);
  } else if (roll < 0.80) {
    // Health kit
    state.healthKits++;
  } else if (roll < 0.95) {
    // Bandage
    state.bandages++;
  } else {
    // Ammo
    state.reserveAmmo += CONFIG.WEAPONS[state.currentWeapon].magSize * 2;
  }
  state.nearLootId = -1;
}

function buildWeaponMesh(group: THREE.Group, weapon: WeaponKey) {
  while (group.children.length) group.remove(group.children[0]);
  const cfg = CONFIG.WEAPONS[weapon];
  const mat = new THREE.MeshLambertMaterial({ color: cfg.color });
  let geo: THREE.BufferGeometry;
  if (weapon === 'AWM') {
    geo = new THREE.BoxGeometry(0.05, 0.055, 0.62);
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.18), new THREE.MeshLambertMaterial({ color: '#111' }));
    scope.position.set(0, 0.04, -0.05);
    group.add(scope);
  } else if (weapon === 'SHOTGUN') {
    geo = new THREE.BoxGeometry(0.08, 0.10, 0.40);
  } else if (weapon === 'UZI') {
    geo = new THREE.BoxGeometry(0.08, 0.09, 0.22);
  } else {
    geo = new THREE.BoxGeometry(0.06, 0.06, 0.48);
  }
  const body = new THREE.Mesh(geo, mat);
  const barrelGeo = new THREE.CylinderGeometry(0.015, 0.015, weapon === 'AWM' ? 0.25 : 0.15, 6);
  const barrel = new THREE.Mesh(barrelGeo, new THREE.MeshLambertMaterial({ color: '#111' }));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = weapon === 'AWM' ? -0.44 : -0.28;
  group.add(body); group.add(barrel);
}

function spawnBlood(point: THREE.Vector3, particles: Particle[], scene: THREE.Scene) {
  for (let i = 0; i < 5; i++) {
    const geo = new THREE.SphereGeometry(0.08, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xcc1111, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(point);
    scene.add(mesh);
    particles.push({
      mesh, life: 0.35, maxLife: 0.35,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4 + 1, (Math.random() - 0.5) * 6),
    });
    if (particles.length > 120) {
      const old = particles.shift()!;
      scene.remove(old.mesh); old.mesh.geometry.dispose();
    }
  }
}

function spawnDust(pos: THREE.Vector3, particles: Particle[], scene: THREE.Scene) {
  for (let i = 0; i < 2; i++) {
    const geo = new THREE.SphereGeometry(0.12, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0x8a7a5a, transparent: true, opacity: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x + (Math.random() - 0.5) * 0.5, pos.y - CONFIG.PLAYER_HEIGHT + 0.1, pos.z + (Math.random() - 0.5) * 0.5);
    scene.add(mesh);
    particles.push({
      mesh, life: 0.5, maxLife: 0.5,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.5 + Math.random(), (Math.random() - 0.5) * 1.5),
    });
    if (particles.length > 120) {
      const old = particles.shift()!;
      scene.remove(old.mesh); old.mesh.geometry.dispose();
    }
  }
}

function drawMinimap(canvas: HTMLCanvasElement | null, state: any, bots: BotData[], lootBoxes: LootBox[]) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const S = 128, half = CONFIG.MAP_SIZE / 2;
  const toMM = (w: number) => ((w + half) / CONFIG.MAP_SIZE) * S;

  ctx.fillStyle = '#1a2e1a';
  ctx.fillRect(0, 0, S, S);

  // Zone circle
  ctx.beginPath();
  const cx = toMM(state.zone.cx), cy = toMM(state.zone.cz);
  const r = (state.zone.radius / CONFIG.MAP_SIZE) * S;
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,136,255,0.8)'; ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,100,200,0.06)'; ctx.fill();

  // Loot boxes
  for (const lb of lootBoxes) {
    if (lb.picked) continue;
    ctx.fillStyle = '#ffaa00';
    ctx.fillRect(toMM(lb.position.x) - 1, toMM(lb.position.z) - 1, 2, 2);
  }

  // Bots
  for (const bot of bots) {
    if (!bot.alive) continue;
    ctx.fillStyle = '#ff4444';
    const bx = toMM(bot.position.x), bz = toMM(bot.position.z);
    ctx.beginPath(); ctx.arc(bx, bz, 2, 0, Math.PI * 2); ctx.fill();
  }

  // Player
  const px = toMM(state.position.x), pz = toMM(state.position.z);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(px, pz, 3, 0, Math.PI * 2); ctx.fill();

  // Direction line
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, pz);
  ctx.lineTo(px - Math.sin(state.yaw) * 8, pz - Math.cos(state.yaw) * 8);
  ctx.stroke();

  // North label
  ctx.fillStyle = '#446644'; ctx.font = '9px monospace';
  ctx.fillText('N', S / 2 - 3, 10);
}
