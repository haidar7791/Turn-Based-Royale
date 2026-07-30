import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

// ══════════════════════════════════════════════════════════
//  ANIMAL DEFINITIONS
// ══════════════════════════════════════════════════════════
const ANIMALS = {
  deer:    { nameAr:'غزال',   nameEn:'Deer',    icon:'🦌', eyeH:1.0,  speed:7,  runSpeed:14, diet:'herb', bodyHex:0xc8a060, desc:'عاشب سريع، تهرب من المفترسين', predatedBy:['leopard','lion','tiger','bear'] },
  rabbit:  { nameAr:'أرنب',  nameEn:'Rabbit',  icon:'🐇', eyeH:0.35, speed:9,  runSpeed:18, diet:'herb', bodyHex:0xd4c09a, desc:'صغير وسريع جداً، خطر دائم يحدق به', predatedBy:['leopard','eagle','lion','tiger','bear'] },
  giraffe: { nameAr:'زرافة', nameEn:'Giraffe', icon:'🦒', eyeH:4.5,  speed:5,  runSpeed:9,  diet:'herb', bodyHex:0xe8c040, desc:'طويل القامة، يرى بعيداً، ندرة الأعداء', predatedBy:['lion'] },
  falcon:  { nameAr:'صقر',   nameEn:'Falcon',  icon:'🦅', eyeH:0.7,  speed:9,  runSpeed:20, diet:'carn', bodyHex:0x7a5030, desc:'طير صياد سريع، يصطاد فرائس صغيرة',   predatedBy:['eagle'] },
  eagle:   { nameAr:'نسر',   nameEn:'Eagle',   icon:'🦅', eyeH:0.9,  speed:8,  runSpeed:18, diet:'carn', bodyHex:0x3a2810, desc:'ملك الطيور، لا أعداء طبيعيين',        predatedBy:[] },
  leopard: { nameAr:'فهد',   nameEn:'Leopard', icon:'🐆', eyeH:0.9,  speed:10, runSpeed:19, diet:'carn', bodyHex:0xd4a030, desc:'مفترس أنيق وسريع، يتسلق الصخور',     predatedBy:['lion','tiger'] },
  tiger:   { nameAr:'نمر',   nameEn:'Tiger',   icon:'🐯', eyeH:1.0,  speed:9,  runSpeed:17, diet:'carn', bodyHex:0xe07830, desc:'مفترس ضخم، قوي وذكي',                predatedBy:[] },
  lion:    { nameAr:'أسد',   nameEn:'Lion',    icon:'🦁', eyeH:1.1,  speed:8,  runSpeed:15, diet:'carn', bodyHex:0xd4a855, desc:'ملك الغابة، لا يهاب شيئاً',           predatedBy:[] },
  bear:    { nameAr:'دب',    nameEn:'Bear',    icon:'🐻', eyeH:1.5,  speed:6,  runSpeed:12, diet:'omni', bodyHex:0x5a3820, desc:'آكل للكل، قوي وصبور',                predatedBy:[] },
} as const;

type AnimalKey = keyof typeof ANIMALS;
type Gender = 'male' | 'female';
type GamePhase = 'select' | 'playing' | 'dead' | 'mated';
type BotRole = 'predator' | 'prey' | 'mate' | 'neutral';
type BotState = 'wander' | 'flee' | 'chase' | 'attack' | 'idle';

// ══════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════
const CFG = {
  MAP_SIZE: 400,
  TERRAIN_SEGS: 80,
  TERRAIN_H: 18,
  TREE_COUNT: 180,
  ROCK_COUNT: 40,
  FOOD_COUNT: 50,
  WATER_LEVEL: 1.4,
  BOT_COUNT: 14,
  HUNGER_DRAIN: 1.0,     // per second
  THIRST_DRAIN: 1.3,
  POWER_DRAIN_HUNGRY: 2.5,
  POWER_DRAIN_THIRSTY: 3.0,
  PREDATOR_SIGHT: 55,
  PREDATOR_ATTACK_RANGE: 3.5,
  PREDATOR_ATK_DMG: 18,
  PREDATOR_ATK_RATE: 1.8,
  PREY_FLEE_DIST: 30,
  MATE_INTERACT_DIST: 4.5,
  EAT_RANGE: 3.0,
  WATER_DRINK_RANGE: 6.0,
  EAT_HUNGER: 40,
  EAT_POWER: 10,
  DRINK_THIRST: 50,
  DRINK_POWER: 5,
  MATING_POWER_BONUS: 25,
  QUEST_SURVIVE_SEC: 45,
  JUMP_FORCE: 6,
  GRAVITY: -18,
};

// ══════════════════════════════════════════════════════════
//  TYPES
// ══════════════════════════════════════════════════════════
interface BotAnimal {
  id: number;
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  role: BotRole;
  animalKey: AnimalKey;
  gender: Gender;
  hp: number;
  alive: boolean;
  state: BotState;
  targetPos: THREE.Vector3;
  stateTimer: number;
  attackTimer: number;
  animT: number;
}

interface FoodNode {
  id: number;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  kind: 'grass' | 'meat' | 'berry';
  eaten: boolean;
  respawn: number;
}

interface QuestStep {
  id: string;
  textAr: string;
  target: number;
  progress: number;
  done: boolean;
}

interface SurvivalState {
  power: number;
  hunger: number;
  thirst: number;
  phase: GamePhase;
  animal: AnimalKey;
  gender: Gender;
  surviveTimer: number;
  quests: QuestStep[];
  allQuestsDone: boolean;
  mateFound: boolean;
  elapsed: number;
  attackFlash: number;
}

// ══════════════════════════════════════════════════════════
//  TERRAIN NOISE  (fixed seed via closure)
// ══════════════════════════════════════════════════════════
const noise2D = createNoise2D();

function terrainH(x: number, z: number): number {
  return (
    noise2D(x / 80, z / 80) * 0.55 +
    noise2D(x / 30, z / 30) * 0.30 +
    noise2D(x / 10, z / 10) * 0.15
  ) * CFG.TERRAIN_H;
}

// ══════════════════════════════════════════════════════════
//  MESH BUILDERS
// ══════════════════════════════════════════════════════════
function mat(hex: number, rough = 0.85, metal = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
}

/** Build a simple recognizable animal mesh */
function makeAnimalMesh(key: AnimalKey, scale = 1.0): THREE.Group {
  const g = new THREE.Group();
  const a = ANIMALS[key];
  const c = a.bodyHex;
  const dark = new THREE.Color(c).multiplyScalar(0.6).getHex();
  const light = new THREE.Color(c).multiplyScalar(1.3).getHex();

  if (key === 'rabbit') {
    // body
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), mat(c));
    body.position.y = 0.28;
    g.add(body);
    // head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat(c));
    head.position.set(0, 0.65, 0.2);
    g.add(head);
    // ears
    for (let s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.38, 6), mat(light));
      ear.position.set(s * 0.1, 1.0, 0.15);
      ear.rotation.z = s * 0.15;
      g.add(ear);
    }
    // legs
    for (let [sx, sz] of [[-1,1],[1,1],[-1,-1],[1,-1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.25, 5), mat(dark));
      leg.position.set(sx * 0.14, 0.08, sz * 0.14);
      g.add(leg);
    }
  } else if (key === 'giraffe') {
    // body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 1.4), mat(c));
    body.position.y = 2.4;
    g.add(body);
    // neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 2.4, 7), mat(light));
    neck.position.set(0, 3.9, 0.4);
    neck.rotation.x = -0.35;
    g.add(neck);
    // head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.7), mat(c));
    head.position.set(0, 5.1, 0.9);
    g.add(head);
    // horns
    for (let s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 5), mat(dark));
      h.position.set(s * 0.12, 5.42, 0.85);
      g.add(h);
    }
    // legs
    for (let [sx, sz] of [[-1,1],[1,1],[-1,-1],[1,-1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 2.2, 6), mat(dark));
      leg.position.set(sx * 0.3, 1.1, sz * 0.5);
      g.add(leg);
    }
  } else if (key === 'falcon' || key === 'eagle') {
    // body
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), mat(c));
    body.scale.set(1, 0.8, 1.4);
    body.position.y = 0.38;
    g.add(body);
    // head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat(dark));
    head.position.set(0, 0.7, 0.3);
    g.add(head);
    // beak
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), mat(0xffaa00));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.68, 0.56);
    g.add(beak);
    // wings
    for (let s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.45), mat(light));
      wing.position.set(s * 0.8, 0.4, 0);
      wing.rotation.z = s * 0.25;
      g.add(wing);
    }
    // tail
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.4), mat(dark));
    tail.position.set(0, 0.35, -0.55);
    g.add(tail);
  } else {
    // Generic quadruped (deer, leopard, tiger, lion, bear)
    const isBear = key === 'bear';
    const bW = isBear ? 0.9 : 0.65;
    const bH = isBear ? 0.75 : 0.55;
    const bL = isBear ? 1.1 : 1.0;
    const bodyY = isBear ? 1.0 : 0.9;

    const body = new THREE.Mesh(new THREE.BoxGeometry(bW, bH, bL), mat(c));
    body.position.y = bodyY;
    g.add(body);

    // head
    const headS = isBear ? 0.38 : 0.28;
    const head = new THREE.Mesh(new THREE.SphereGeometry(headS, 8, 6), mat(c));
    head.position.set(0, bodyY + 0.4, 0.55 + (isBear ? 0.1 : 0));
    g.add(head);

    // snout
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.22), mat(dark));
    snout.position.set(0, bodyY + 0.3, 0.8 + (isBear ? 0.1 : 0));
    g.add(snout);

    // ears
    if (key !== 'lion') {
      for (let s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 5), mat(dark));
        ear.position.set(s * (headS * 0.65), bodyY + 0.7, 0.52);
        g.add(ear);
      }
    } else {
      // lion mane
      const mane = new THREE.Mesh(new THREE.SphereGeometry(0.44, 8, 6), mat(0x6b3a10));
      mane.position.copy(head.position);
      mane.position.y -= 0.05;
      g.add(mane);
    }

    // antlers for deer
    if (key === 'deer') {
      for (let s of [-1, 1]) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.5, 4), mat(0x8b6a3a));
        ant.position.set(s * 0.18, bodyY + 0.9, 0.5);
        ant.rotation.z = s * 0.4;
        g.add(ant);
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.28, 4), mat(0x8b6a3a));
        branch.position.set(s * 0.32, bodyY + 1.1, 0.5);
        branch.rotation.set(0, 0, s * 0.9);
        g.add(branch);
      }
    }

    // stripes/spots for tiger & leopard
    if (key === 'tiger' || key === 'leopard') {
      for (let i = 0; i < 4; i++) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(key === 'tiger' ? 0.67 : 0.12, 0.07, 0.12),
          mat(key === 'tiger' ? 0x2a1a00 : 0x4a2a00)
        );
        stripe.position.set(0, bodyY + 0.25 - i * 0.12, bL * 0.4 - i * 0.22);
        g.add(stripe);
      }
    }

    // legs
    const legH = isBear ? 0.85 : 0.75;
    const legY = bodyY - bH / 2 - legH / 2 + 0.05;
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as [number,number][]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, legH, 6), mat(dark));
      leg.position.set(sx * (bW * 0.38), legY, sz * (bL * 0.33));
      g.add(leg);
    }

    // tail
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 0.5, 5), mat(dark));
    tail.position.set(0, bodyY + 0.1, -bL * 0.55);
    tail.rotation.x = 0.6;
    g.add(tail);
  }

  g.traverse(c => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  g.scale.setScalar(scale);
  return g;
}

// ══════════════════════════════════════════════════════════
//  QUEST FACTORY
// ══════════════════════════════════════════════════════════
function makeQuests(animal: AnimalKey): QuestStep[] {
  const a = ANIMALS[animal];
  const foodName = a.diet === 'herb' ? 'العشب' : a.diet === 'carn' ? 'اللحم' : 'الطعام';
  return [
    { id:'eat',     textAr:`كُل ${foodName} 3 مرات`,              target:3,  progress:0, done:false },
    { id:'drink',   textAr:'اشرب من الماء مرتين',                  target:2,  progress:0, done:false },
    { id:'survive', textAr:`انجُ ${CFG.QUEST_SURVIVE_SEC} ثانية`,  target:CFG.QUEST_SURVIVE_SEC, progress:0, done:false },
    { id:'mate',    textAr:'ابحث عن شريك من نفس النوع',            target:1,  progress:0, done:false },
  ];
}

// ══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function BatmosGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<SurvivalState>({
    power: 100, hunger: 100, thirst: 100,
    phase: 'select', animal: 'deer', gender: 'male',
    surviveTimer: 0, quests: [], allQuestsDone: false, mateFound: false,
    elapsed: 0, attackFlash: 0,
  });
  const [ui, setUi] = useState<SurvivalState>(stateRef.current);
  const [selAnimal, setSelAnimal] = useState<AnimalKey>('deer');
  const [selGender, setSelGender] = useState<Gender>('male');
  const [interaction, setInteraction] = useState<string>('');
  const [showQuests, setShowQuests] = useState(false);

  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    terrain: THREE.Mesh;
    bots: BotAnimal[];
    foods: FoodNode[];
    waterMeshes: THREE.Mesh[];
    clock: THREE.Clock;
    camPitch: number; camYaw: number;
    playerPos: THREE.Vector3;
    playerVel: THREE.Vector3;
    onGround: boolean;
    keys: Record<string, boolean>;
    animFrame: number;
    pointerLocked: boolean;
    mateBot: BotAnimal | null;
  } | null>(null);

  // ── POINTER LOCK ──────────────────────────────────────
  useEffect(() => {
    const onPL = () => { if (threeRef.current) threeRef.current.pointerLocked = true; };
    const onPLE = () => { if (threeRef.current) threeRef.current.pointerLocked = false; };
    document.addEventListener('pointerlockchange', onPL);
    document.addEventListener('pointerlockerror', onPLE);
    return () => {
      document.removeEventListener('pointerlockchange', onPL);
      document.removeEventListener('pointerlockerror', onPLE);
    };
  }, []);

  // ── START GAME ────────────────────────────────────────
  const startGame = useCallback((animal: AnimalKey, gender: Gender) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const S = CFG.MAP_SIZE;
    const quests = makeQuests(animal);

    stateRef.current = {
      power: 100, hunger: 100, thirst: 100,
      phase: 'playing', animal, gender,
      surviveTimer: 0, quests, allQuestsDone: false, mateFound: false,
      elapsed: 0, attackFlash: 0,
    };
    setUi({ ...stateRef.current });

    // ── THREE SETUP ──────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setClearColor(0x87ceeb);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.008);

    // Lights
    const ambient = new THREE.AmbientLight(0xffeedd, 0.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.8);
    sun.position.set(120, 200, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 500;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -200;
    sun.shadow.camera.right = sun.shadow.camera.top = 200;
    scene.add(sun);

    const sky = new THREE.HemisphereLight(0x87ceeb, 0x4a7a3a, 0.5);
    scene.add(sky);

    const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 600);

    // ── TERRAIN ──────────────────────────────────────
    const tGeo = new THREE.PlaneGeometry(S, S, CFG.TERRAIN_SEGS, CFG.TERRAIN_SEGS);
    tGeo.rotateX(-Math.PI / 2);
    const pos = tGeo.attributes.position;
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainH(x, z);
      pos.setY(i, h);
      const t = Math.max(0, Math.min(1, (h - CFG.TERRAIN_H * 0.05) / (CFG.TERRAIN_H * 0.85)));
      let r, gr, b;
      if (h < CFG.WATER_LEVEL + 0.5) { r=0.76; gr=0.70; b=0.50; }       // sand
      else if (t < 0.35)              { r=0.28; gr=0.52; b=0.22; }       // grass
      else if (t < 0.65)              { r=0.45; gr=0.40; b=0.30; }       // dirt/rock
      else if (t < 0.85)              { r=0.55; gr=0.50; b=0.45; }       // grey rock
      else                            { r=0.92; gr=0.93; b=0.97; }       // snow
      colors.push(r, gr, b);
    }
    tGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    tGeo.computeVertexNormals();
    const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    terrain.receiveShadow = true;
    scene.add(terrain);

    // ── WATER PLANE ──────────────────────────────────
    const waterGeo = new THREE.PlaneGeometry(S, S);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x2a6fa8, transparent: true, opacity: 0.72,
      roughness: 0.1, metalness: 0.2,
    });
    const waterPlane = new THREE.Mesh(waterGeo, waterMat);
    waterPlane.position.y = CFG.WATER_LEVEL;
    scene.add(waterPlane);

    // ── TREES ────────────────────────────────────────
    for (let i = 0; i < CFG.TREE_COUNT; i++) {
      const tx = (Math.random() - 0.5) * (S - 20);
      const tz = (Math.random() - 0.5) * (S - 20);
      const ty = terrainH(tx, tz);
      if (ty < CFG.WATER_LEVEL + 0.4) continue;
      const tg = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.35, 2.2 + Math.random() * 1.5, 7),
        mat(0x5a3a1a)
      );
      trunk.position.y = 1.3;
      trunk.castShadow = true;
      tg.add(trunk);
      const layers = 2 + Math.floor(Math.random() * 2);
      for (let l = 0; l < layers; l++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(1.8 - l * 0.35, 2.0 - l * 0.2, 7),
          mat(Math.random() > 0.3 ? 0x2d6a2d : 0x1e5c1e)
        );
        cone.position.y = 2.8 + l * 1.2;
        cone.castShadow = true;
        tg.add(cone);
      }
      tg.position.set(tx, ty, tz);
      scene.add(tg);
    }

    // ── ROCKS ────────────────────────────────────────
    for (let i = 0; i < CFG.ROCK_COUNT; i++) {
      const rx = (Math.random() - 0.5) * (S - 20);
      const rz = (Math.random() - 0.5) * (S - 20);
      const ry = terrainH(rx, rz);
      if (ry < CFG.WATER_LEVEL) continue;
      const s = 0.5 + Math.random() * 1.8;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(s, 0),
        mat(0x808070 + Math.floor(Math.random() * 0x101010))
      );
      rock.position.set(rx, ry + s * 0.4, rz);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.castShadow = true; rock.receiveShadow = true;
      scene.add(rock);
    }

    // ── FOOD NODES ───────────────────────────────────
    const aDef = ANIMALS[animal];
    const foods: FoodNode[] = [];
    for (let i = 0; i < CFG.FOOD_COUNT; i++) {
      const fx = (Math.random() - 0.5) * (S - 30);
      const fz = (Math.random() - 0.5) * (S - 30);
      const fy = terrainH(fx, fz);
      if (fy < CFG.WATER_LEVEL + 0.5) continue;

      const kind: FoodNode['kind'] = aDef.diet === 'herb' ? 'grass' : aDef.diet === 'carn' ? 'meat' : (Math.random() > 0.5 ? 'grass' : 'berry');
      let fMesh: THREE.Mesh;
      if (kind === 'grass') {
        fMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.7, 0.25, 8), mat(0x44aa44));
      } else if (kind === 'meat') {
        fMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.6), mat(0xaa3322));
      } else {
        fMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 5), mat(0x8b44aa));
      }
      fMesh.position.set(fx, fy + 0.15, fz);
      fMesh.castShadow = true;
      scene.add(fMesh);
      foods.push({ id: i, mesh: fMesh, pos: new THREE.Vector3(fx, fy, fz), kind, eaten: false, respawn: 0 });
    }

    // ── BOT ANIMALS ──────────────────────────────────
    const predatorKeys: AnimalKey[] = aDef.predatedBy as unknown as AnimalKey[];
    const preyKeys: AnimalKey[] = (Object.keys(ANIMALS) as AnimalKey[]).filter(k =>
      (ANIMALS[k].predatedBy as readonly string[]).includes(animal)
    );
    const mateGender: Gender = gender === 'male' ? 'female' : 'male';

    const bots: BotAnimal[] = [];
    let mateBot: BotAnimal | null = null;

    for (let i = 0; i < CFG.BOT_COUNT; i++) {
      let bx = (Math.random() - 0.5) * (S - 40);
      let bz = (Math.random() - 0.5) * (S - 40);
      let by = terrainH(bx, bz);
      while (by < CFG.WATER_LEVEL + 1) {
        bx = (Math.random() - 0.5) * (S - 40);
        bz = (Math.random() - 0.5) * (S - 40);
        by = terrainH(bx, bz);
      }

      // decide role
      let role: BotRole;
      let bKey: AnimalKey;
      let bGender: Gender = Math.random() > 0.5 ? 'male' : 'female';

      const r = Math.random();
      if (i === 0 && predatorKeys.length === 0) {
        // eagle/tiger/lion/bear: spawn rival of same species
        role = 'predator'; bKey = animal;
      } else if (!mateBot && i < 3) {
        // guaranteed mate early
        role = 'mate'; bKey = animal; bGender = mateGender;
      } else if (predatorKeys.length > 0 && r < 0.4) {
        role = 'predator';
        bKey = predatorKeys[Math.floor(Math.random() * predatorKeys.length)];
      } else if (preyKeys.length > 0 && r < 0.7) {
        role = 'prey';
        bKey = preyKeys[Math.floor(Math.random() * preyKeys.length)];
      } else {
        role = 'neutral';
        bKey = (Object.keys(ANIMALS) as AnimalKey[])[Math.floor(Math.random() * 9)];
      }

      const bSize = ANIMALS[bKey].speed / 8;  // rough scale from speed
      const mesh = makeAnimalMesh(bKey, bSize * 0.9 + 0.1);

      // tint predators red-ish, prey green-ish, mate golden
      if (role === 'predator') {
        mesh.traverse(c => { if ((c as THREE.Mesh).isMesh) { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial; m.emissive = new THREE.Color(0x330000); m.emissiveIntensity = 0.3; }});
      } else if (role === 'mate') {
        mesh.traverse(c => { if ((c as THREE.Mesh).isMesh) { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial; m.emissive = new THREE.Color(0x223300); m.emissiveIntensity = 0.4; }});
      }

      mesh.position.set(bx, by, bz);
      scene.add(mesh);

      const bot: BotAnimal = {
        id: i, mesh, pos: new THREE.Vector3(bx, by, bz),
        vel: new THREE.Vector3(), role, animalKey: bKey, gender: bGender,
        hp: 100, alive: true,
        state: 'wander', targetPos: new THREE.Vector3(bx, by, bz),
        stateTimer: Math.random() * 3, attackTimer: 0, animT: Math.random() * 10,
      };
      bots.push(bot);
      if (role === 'mate' && !mateBot) mateBot = bot;
    }

    // ── PLAYER START ─────────────────────────────────
    let startX = 0, startZ = 0;
    while (terrainH(startX, startZ) < CFG.WATER_LEVEL + 1) {
      startX = (Math.random() - 0.5) * 60;
      startZ = (Math.random() - 0.5) * 60;
    }
    const playerPos = new THREE.Vector3(startX, terrainH(startX, startZ) + aDef.eyeH, startZ);
    const playerVel = new THREE.Vector3();

    camera.position.copy(playerPos);

    threeRef.current = {
      renderer, scene, camera, terrain, bots, foods,
      waterMeshes: [waterPlane],
      clock: new THREE.Clock(),
      camPitch: 0, camYaw: 0,
      playerPos, playerVel,
      onGround: true,
      keys: {},
      animFrame: 0,
      pointerLocked: false,
      mateBot,
    };

    // ── INPUT ─────────────────────────────────────────
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (stateRef.current.phase !== 'playing') return;
      threeRef.current!.keys[e.code] = down;
      if (down && e.code === 'KeyQ') setShowQuests(v => !v);
      if (down && e.code === 'KeyF') handleInteract();
      if (down && e.code === 'Space') {
        const t = threeRef.current!;
        if (t.onGround) { t.playerVel.y = CFG.JUMP_FORCE; t.onGround = false; }
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (!threeRef.current?.pointerLocked) return;
      const t = threeRef.current;
      t.camYaw -= e.movementX * 0.002;
      t.camPitch -= e.movementY * 0.002;
      t.camPitch = Math.max(-1.4, Math.min(1.4, t.camPitch));
    };
    const onResize = () => {
      if (!threeRef.current) return;
      const { renderer, camera } = threeRef.current;
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    };

    window.addEventListener('keydown', e => onKey(e, true));
    window.addEventListener('keyup',   e => onKey(e, false));
    window.addEventListener('mousemove', onMouse);
    window.addEventListener('resize', onResize);
    canvas.addEventListener('click', () => {
      if (stateRef.current.phase === 'playing') canvas.requestPointerLock();
    });

    // ── GAME LOOP ──────────────────────────────────────
    function gameLoop() {
      const t = threeRef.current!;
      const dt = Math.min(t.clock.getDelta(), 0.05);
      const st = stateRef.current;
      if (st.phase !== 'playing') { t.renderer.render(t.scene, t.camera); t.animFrame = requestAnimationFrame(gameLoop); return; }

      st.elapsed += dt;
      const aDef2 = ANIMALS[st.animal];

      // ── PLAYER MOVEMENT ──────────────────────────
      const isRun = t.keys['ShiftLeft'] || t.keys['ShiftRight'];
      const speed = isRun ? aDef2.runSpeed : aDef2.speed;
      const forward = new THREE.Vector3(-Math.sin(t.camYaw), 0, -Math.cos(t.camYaw));
      const right   = new THREE.Vector3(Math.cos(t.camYaw), 0, -Math.sin(t.camYaw));
      const move = new THREE.Vector3();
      if (t.keys['KeyW'] || t.keys['ArrowUp'])    move.add(forward);
      if (t.keys['KeyS'] || t.keys['ArrowDown'])  move.sub(forward);
      if (t.keys['KeyA'] || t.keys['ArrowLeft'])  move.sub(right);
      if (t.keys['KeyD'] || t.keys['ArrowRight']) move.add(right);
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);

      t.playerVel.y += CFG.GRAVITY * dt;
      t.playerPos.add(move);
      t.playerPos.y += t.playerVel.y * dt;

      // terrain collision
      const groundY = terrainH(t.playerPos.x, t.playerPos.z);
      const eyeBase = groundY + aDef2.eyeH;
      if (t.playerPos.y < eyeBase) {
        t.playerPos.y = eyeBase;
        t.playerVel.y = 0;
        t.onGround = true;
      } else {
        t.onGround = false;
      }

      // map boundary
      const B = CFG.MAP_SIZE / 2 - 5;
      t.playerPos.x = Math.max(-B, Math.min(B, t.playerPos.x));
      t.playerPos.z = Math.max(-B, Math.min(B, t.playerPos.z));

      // camera
      t.camera.position.copy(t.playerPos);
      const qYaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), t.camYaw);
      const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), t.camPitch);
      t.camera.quaternion.copy(qYaw).multiply(qPitch);

      // ── SURVIVAL DRAIN ──────────────────────────
      st.hunger = Math.max(0, st.hunger - CFG.HUNGER_DRAIN * dt);
      st.thirst = Math.max(0, st.thirst - CFG.THIRST_DRAIN * dt);
      if (st.hunger <= 0) st.power = Math.max(0, st.power - CFG.POWER_DRAIN_HUNGRY * dt);
      if (st.thirst <= 0) st.power = Math.max(0, st.power - CFG.POWER_DRAIN_THIRSTY * dt);
      if (st.attackFlash > 0) st.attackFlash -= dt;

      // ── QUEST: SURVIVE ──────────────────────────
      const sQ = st.quests.find(q => q.id === 'survive');
      if (sQ && !sQ.done) {
        sQ.progress = Math.min(sQ.target, sQ.progress + dt);
        if (sQ.progress >= sQ.target) sQ.done = true;
        st.surviveTimer = sQ.progress;
      }

      // ── INTERACTION HINTS ───────────────────────
      let hint = '';
      // near food?
      for (const f of t.foods) {
        if (f.eaten) continue;
        if (t.playerPos.distanceTo(f.pos) < CFG.EAT_RANGE) {
          hint = 'اضغط [F] للأكل 🍃';
          break;
        }
      }
      // near water?
      if (!hint) {
        const curGroundY = terrainH(t.playerPos.x, t.playerPos.z);
        // sample 8 points around player for water
        let nearWater = false;
        for (let a2 = 0; a2 < 8; a2++) {
          const ang = (a2 / 8) * Math.PI * 2;
          const sx = t.playerPos.x + Math.cos(ang) * CFG.WATER_DRINK_RANGE;
          const sz = t.playerPos.z + Math.sin(ang) * CFG.WATER_DRINK_RANGE;
          if (terrainH(sx, sz) < CFG.WATER_LEVEL + 0.3) { nearWater = true; break; }
        }
        if (curGroundY < CFG.WATER_LEVEL + 1.5) nearWater = true;
        if (nearWater) hint = 'اضغط [F] للشرب 💧';
      }
      // near mate?
      if (!hint && t.mateBot && t.mateBot.alive && st.allQuestsDone) {
        if (t.playerPos.distanceTo(t.mateBot.pos) < CFG.MATE_INTERACT_DIST + 1) {
          hint = 'اضغط [F] للتزاوج 💚';
        }
      } else if (!hint && t.mateBot && t.mateBot.alive && !st.allQuestsDone) {
        if (t.playerPos.distanceTo(t.mateBot.pos) < CFG.MATE_INTERACT_DIST) {
          // progress mate quest
          const mQ = st.quests.find(q => q.id === 'mate');
          if (mQ && !mQ.done) { mQ.progress = 1; mQ.done = true; }
          hint = '💚 وجدت شريكاً! أكمل المهام أولاً';
        }
      }
      setInteraction(hint);

      // ── FOOD RESPAWN ─────────────────────────────
      for (const f of t.foods) {
        if (f.eaten) {
          f.respawn -= dt;
          if (f.respawn <= 0) {
            f.eaten = false;
            f.mesh.visible = true;
          }
        }
      }

      // ── BOT UPDATE ──────────────────────────────
      for (const bot of t.bots) {
        if (!bot.alive) continue;
        bot.animT += dt;
        bot.stateTimer -= dt;
        if (bot.attackTimer > 0) bot.attackTimer -= dt;

        const distToPlayer = bot.pos.distanceTo(t.playerPos);

        // state machine
        if (bot.role === 'predator') {
          if (bot.state !== 'attack' && distToPlayer < CFG.PREDATOR_SIGHT) {
            bot.state = distToPlayer < CFG.PREDATOR_ATTACK_RANGE ? 'attack' : 'chase';
          } else if (bot.state === 'chase' && distToPlayer > CFG.PREDATOR_SIGHT * 1.3) {
            bot.state = 'wander'; bot.stateTimer = 3;
          } else if (bot.state === 'attack' && distToPlayer > CFG.PREDATOR_ATTACK_RANGE * 1.5) {
            bot.state = 'chase';
          }
          if (bot.stateTimer <= 0 && bot.state === 'wander') {
            bot.targetPos.set(
              bot.pos.x + (Math.random() - 0.5) * 40,
              0,
              bot.pos.z + (Math.random() - 0.5) * 40
            );
            bot.stateTimer = 3 + Math.random() * 3;
          }
          if (bot.state === 'attack' && bot.attackTimer <= 0) {
            st.power = Math.max(0, st.power - CFG.PREDATOR_ATK_DMG);
            st.attackFlash = 0.25;
            bot.attackTimer = CFG.PREDATOR_ATK_RATE;
          }
        } else if (bot.role === 'prey') {
          if (distToPlayer < CFG.PREY_FLEE_DIST) {
            bot.state = 'flee';
            const awayDir = bot.pos.clone().sub(t.playerPos).normalize();
            bot.targetPos.copy(bot.pos).addScaledVector(awayDir, 30);
          } else if (bot.stateTimer <= 0) {
            bot.state = 'wander';
            bot.targetPos.set(
              bot.pos.x + (Math.random() - 0.5) * 30,
              0,
              bot.pos.z + (Math.random() - 0.5) * 30
            );
            bot.stateTimer = 2 + Math.random() * 3;
          }
        } else {
          // neutral / mate: wander gently
          if (bot.stateTimer <= 0) {
            bot.targetPos.set(
              bot.pos.x + (Math.random() - 0.5) * 25,
              0,
              bot.pos.z + (Math.random() - 0.5) * 25
            );
            bot.stateTimer = 4 + Math.random() * 4;
          }
          bot.state = 'wander';
        }

        // move bot
        if (bot.state !== 'attack' && bot.state !== 'idle') {
          const bSpeed = ANIMALS[bot.animalKey].speed * (bot.state === 'flee' ? 1.3 : 0.7);
          const dir = bot.targetPos.clone().sub(bot.pos);
          dir.y = 0;
          if (dir.lengthSq() > 0.25) {
            dir.normalize().multiplyScalar(bSpeed * dt);
            bot.pos.add(dir);
          }
          // boundary
          const B2 = CFG.MAP_SIZE / 2 - 8;
          bot.pos.x = Math.max(-B2, Math.min(B2, bot.pos.x));
          bot.pos.z = Math.max(-B2, Math.min(B2, bot.pos.z));
        }

        // snap to terrain
        const bGround = terrainH(bot.pos.x, bot.pos.z);
        bot.pos.y = bGround;
        bot.mesh.position.copy(bot.pos);

        // rotate toward target
        if (bot.state !== 'idle') {
          const dir2 = bot.targetPos.clone().sub(bot.pos); dir2.y = 0;
          if (dir2.lengthSq() > 0.1) {
            const targetAngle = Math.atan2(dir2.x, dir2.z);
            bot.mesh.rotation.y = targetAngle;
          }
        }

        // walking animation (leg oscillation)
        const walkSpeed = bot.state === 'wander' ? 2 : 4;
        bot.mesh.children.forEach((child, ci) => {
          if (ci >= 6 && ci <= 9) { // legs
            (child as THREE.Mesh).rotation.x = Math.sin(bot.animT * walkSpeed + ci * Math.PI / 2) * 0.4;
          }
        });
      }

      // ── CHECK DEATH ─────────────────────────────
      if (st.power <= 0) {
        st.phase = 'dead';
        setUi({ ...st });
        t.renderer.render(t.scene, t.camera);
        return;
      }

      // ── CHECK ALL QUESTS DONE ───────────────────
      if (!st.allQuestsDone && st.quests.every(q => q.done)) {
        st.allQuestsDone = true;
      }

      t.renderer.render(t.scene, t.camera);
      setUi({ ...st });
      t.animFrame = requestAnimationFrame(gameLoop);
    }

    // store cleanup refs
    const cleanupListeners = () => {
      window.removeEventListener('keydown', e => onKey(e, true));
      window.removeEventListener('keyup',   e => onKey(e, false));
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('resize', onResize);
    };

    // store cleanup in ref for use by restart
    (threeRef.current as any)._cleanup = () => {
      cancelAnimationFrame(threeRef.current?.animFrame ?? 0);
      cleanupListeners();
      renderer.dispose();
    };

    // kick off
    threeRef.current!.animFrame = requestAnimationFrame(gameLoop);

  }, []);

  // ── INTERACTION HANDLER ───────────────────────────────
  const handleInteract = useCallback(() => {
    const t = threeRef.current;
    const st = stateRef.current;
    if (!t || st.phase !== 'playing') return;

    // try eat
    for (const f of t.foods) {
      if (f.eaten) continue;
      if (t.playerPos.distanceTo(f.pos) < CFG.EAT_RANGE) {
        f.eaten = true;
        f.mesh.visible = false;
        f.respawn = 25 + Math.random() * 15;
        st.hunger = Math.min(100, st.hunger + CFG.EAT_HUNGER);
        st.power  = Math.min(100, st.power  + CFG.EAT_POWER);
        const eQ = st.quests.find(q => q.id === 'eat');
        if (eQ && !eQ.done) { eQ.progress = Math.min(eQ.target, eQ.progress + 1); if (eQ.progress >= eQ.target) eQ.done = true; }
        setUi({ ...st });
        return;
      }
    }

    // try drink
    const curGY = terrainH(t.playerPos.x, t.playerPos.z);
    let nearWater = curGY < CFG.WATER_LEVEL + 1.5;
    if (!nearWater) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        if (terrainH(t.playerPos.x + Math.cos(ang) * CFG.WATER_DRINK_RANGE, t.playerPos.z + Math.sin(ang) * CFG.WATER_DRINK_RANGE) < CFG.WATER_LEVEL + 0.3) { nearWater = true; break; }
      }
    }
    if (nearWater) {
      st.thirst = Math.min(100, st.thirst + CFG.DRINK_THIRST);
      st.power  = Math.min(100, st.power  + CFG.DRINK_POWER);
      const dQ = st.quests.find(q => q.id === 'drink');
      if (dQ && !dQ.done) { dQ.progress = Math.min(dQ.target, dQ.progress + 1); if (dQ.progress >= dQ.target) dQ.done = true; }
      setUi({ ...st });
      return;
    }

    // try mate
    if (t.mateBot && t.mateBot.alive && st.allQuestsDone) {
      if (t.playerPos.distanceTo(t.mateBot.pos) < CFG.MATE_INTERACT_DIST + 1) {
        st.power = Math.min(100, st.power + CFG.MATING_POWER_BONUS);
        st.phase = 'mated';
        setUi({ ...st });
      }
    }
  }, []);

  // ── RESTART ───────────────────────────────────────────
  const restart = useCallback(() => {
    if (threeRef.current) {
      cancelAnimationFrame(threeRef.current.animFrame);
      threeRef.current.renderer.dispose();
      threeRef.current.scene.clear();
      threeRef.current = null;
    }
    setShowQuests(false);
    setInteraction('');
    stateRef.current.phase = 'select';
    setUi({ ...stateRef.current, phase: 'select' });
  }, []);

  // ── CLEANUP on unmount ───────────────────────────────
  useEffect(() => {
    return () => {
      if (threeRef.current) {
        cancelAnimationFrame(threeRef.current.animFrame);
        threeRef.current.renderer.dispose();
      }
    };
  }, []);

  // ═══════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════
  const phase = ui.phase;
  const aDef = ANIMALS[ui.animal] || ANIMALS.deer;
  const questsDoneCount = ui.quests.filter(q => q.done).length;

  return (
    <div id="batmos-root">
      {/* THREE.JS CANVAS — always mounted */}
      <canvas id="game-canvas" ref={canvasRef} />

      {/* ── CHARACTER SELECTION ────────────────────── */}
      {phase === 'select' && (
        <div className="overlay select-overlay">
          <div className="select-panel">
            <div className="select-title">🌿 عالم البرية</div>
            <div className="select-subtitle">اختر حيوانك وابدأ رحلة البقاء</div>

            <div className="animal-grid">
              {(Object.keys(ANIMALS) as AnimalKey[]).map(key => {
                const a = ANIMALS[key];
                return (
                  <div
                    key={key}
                    className={`animal-card${selAnimal === key ? ' selected' : ''}`}
                    onClick={() => setSelAnimal(key)}
                  >
                    <div className="animal-icon">{a.icon}</div>
                    <div className="animal-name">{a.nameAr}</div>
                    <div className="animal-desc">{a.desc}</div>
                    <div className="animal-diet">
                      {a.diet === 'herb' ? '🌿 عاشب' : a.diet === 'carn' ? '🥩 لاحم' : '🍃 كل الأطعمة'}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="gender-row">
              <span className="gender-label">الجنس:</span>
              <button
                className={`gender-btn${selGender === 'male' ? ' active' : ''}`}
                onClick={() => setSelGender('male')}
              >♂ ذكر</button>
              <button
                className={`gender-btn${selGender === 'female' ? ' active' : ''}`}
                onClick={() => setSelGender('female')}
              >♀ أنثى</button>
            </div>

            {selAnimal && (
              <div className="animal-preview-bar">
                <span>{ANIMALS[selAnimal].icon} {ANIMALS[selAnimal].nameAr}</span>
                <span>السرعة: {'▮'.repeat(Math.round(ANIMALS[selAnimal].speed / 2))}</span>
                <span>ارتفاع الرؤية: {ANIMALS[selAnimal].eyeH}م</span>
              </div>
            )}

            <button className="btn-start" onClick={() => startGame(selAnimal, selGender)}>
              🌿 ابدأ الرحلة
            </button>
          </div>
        </div>
      )}

      {/* ── IN-GAME HUD ─────────────────────────────── */}
      {phase === 'playing' && (
        <>
          <div className="hud">
            {/* TOP-LEFT: Survival bars */}
            <div className="survival-panel hud-panel">
              <div className="animal-id">{aDef.icon} {aDef.nameAr} — {ui.gender === 'male' ? '♂' : '♀'}</div>

              <div className="bar-row">
                <span className="bar-label-txt">❤️ القوة</span>
                <div className="bar-track">
                  <div className="bar-fill bar-power" style={{ width: `${ui.power}%`, background: ui.power < 25 ? '#ff3333' : ui.power < 50 ? '#ffaa00' : '#44dd44' }} />
                </div>
                <span className="bar-val">{Math.round(ui.power)}%</span>
              </div>
              <div className="bar-row">
                <span className="bar-label-txt">🍖 الجوع</span>
                <div className="bar-track">
                  <div className="bar-fill bar-hunger" style={{ width: `${ui.hunger}%`, background: ui.hunger < 20 ? '#ff6600' : '#c8a030' }} />
                </div>
                <span className="bar-val">{Math.round(ui.hunger)}%</span>
              </div>
              <div className="bar-row">
                <span className="bar-label-txt">💧 العطش</span>
                <div className="bar-track">
                  <div className="bar-fill bar-thirst" style={{ width: `${ui.thirst}%`, background: ui.thirst < 20 ? '#ff6600' : '#3399dd' }} />
                </div>
                <span className="bar-val">{Math.round(ui.thirst)}%</span>
              </div>
            </div>

            {/* TOP-CENTER: Quest progress badge */}
            <div className="quest-badge hud-panel">
              <span>📋 المهام: {questsDoneCount} / {ui.quests.length}</span>
              {ui.allQuestsDone && <span className="quest-done-badge">✅ جاهز للتزاوج!</span>}
              <div className="quest-hint">اضغط [Q] لعرض التفاصيل</div>
            </div>

            {/* TOP-RIGHT: Timer */}
            <div className="timer-panel hud-panel">
              ⏱ {Math.floor(ui.elapsed / 60)}:{String(Math.floor(ui.elapsed % 60)).padStart(2,'0')}
            </div>

            {/* Crosshair (paw print style) */}
            <div className="crosshair-dot" />

            {/* Center interaction prompt */}
            {interaction && <div className="interact-prompt">{interaction}</div>}

            {/* Attack flash overlay */}
            {ui.attackFlash > 0 && <div className="attack-vignette" style={{ opacity: ui.attackFlash * 3 }} />}

            {/* Low hunger/thirst warnings */}
            {ui.hunger < 15 && <div className="warn-banner warn-hunger">⚠️ أنت جائع جداً! ابحث عن غذاء</div>}
            {ui.thirst < 15 && !ui.hunger && <div className="warn-banner warn-thirst">⚠️ أنت عطشان جداً! ابحث عن ماء</div>}

            {/* Controls hint */}
            <div className="controls-hint">
              WASD حركة · Shift ركض · Space قفز · F تفاعل · Q مهام
            </div>
          </div>

          {/* Quest Panel (toggle) */}
          {showQuests && (
            <div className="quest-panel">
              <div className="quest-panel-header">
                📋 مهام البقاء
                <button className="quest-close" onClick={() => setShowQuests(false)}>✕</button>
              </div>
              <div className="quest-list">
                {ui.quests.map(q => (
                  <div key={q.id} className={`quest-item${q.done ? ' done' : ''}`}>
                    <span className="quest-status">{q.done ? '✅' : '⬜'}</span>
                    <div className="quest-text">
                      <div>{q.textAr}</div>
                      {!q.done && (
                        <div className="quest-prog-bar">
                          <div className="quest-prog-fill" style={{ width: `${(q.progress / q.target) * 100}%` }} />
                        </div>
                      )}
                    </div>
                    <span className="quest-count">{q.done ? '✓' : `${Math.floor(q.progress)}/${q.target}`}</span>
                  </div>
                ))}
              </div>
              {ui.allQuestsDone && (
                <div className="quest-panel-footer">
                  💚 اقترب من الشريك الذهبي واضغط [F] للتزاوج!
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── DEAD OVERLAY ──────────────────────────── */}
      {phase === 'dead' && (
        <div className="overlay dead-overlay">
          <div className="overlay-title" style={{ color: '#ff4444' }}>💀 لقيت حتفك</div>
          <div className="overlay-sub">لم تستطع الصمود في عالم البرية</div>
          <div className="overlay-stats">
            <div>🕐 عشت: {Math.floor(ui.elapsed / 60)}:{String(Math.floor(ui.elapsed % 60)).padStart(2,'0')}</div>
            <div>📋 مهام أنجزت: {questsDoneCount} / {ui.quests.length}</div>
          </div>
          <button className="btn-restart" onClick={restart}>🔄 حاول مجدداً</button>
        </div>
      )}

      {/* ── MATED / WIN OVERLAY ─────────────────── */}
      {phase === 'mated' && (
        <div className="overlay mated-overlay">
          <div className="mated-emoji">💚</div>
          <div className="overlay-title" style={{ color: '#44ff88' }}>تكوّنت الأسرة!</div>
          <div className="overlay-sub">لقد وجدت شريكك وكوّنتم أسرة في عالم البرية</div>
          <div className="mated-bonus">+{CFG.MATING_POWER_BONUS}% قوة 🎉</div>
          <div className="overlay-stats">
            <div>🐾 حيوانك: {aDef.nameAr} ({ui.gender === 'male' ? 'ذكر' : 'أنثى'})</div>
            <div>⏱ الوقت: {Math.floor(ui.elapsed / 60)}:{String(Math.floor(ui.elapsed % 60)).padStart(2,'0')}</div>
          </div>
          <button className="btn-restart" onClick={restart}>🌿 رحلة جديدة</button>
        </div>
      )}
    </div>
  );
}
