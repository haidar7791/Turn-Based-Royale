import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

// ══════════════════════════════════════════════════════════
//  ANIMAL DEFINITIONS  (camDist/camHeight for 3rd-person)
// ══════════════════════════════════════════════════════════
const ANIMALS = {
  deer:    { nameAr:'غزال',   nameEn:'Deer',    icon:'🦌', eyeH:1.0,  speed:7,  runSpeed:14, diet:'herb', bodyHex:0xc8a060, desc:'عاشب سريع، تهرب من المفترسين',        predatedBy:['leopard','lion','tiger','bear'],          camDist:5,  camHeight:2.5 },
  rabbit:  { nameAr:'أرنب',  nameEn:'Rabbit',  icon:'🐇', eyeH:0.35, speed:9,  runSpeed:18, diet:'herb', bodyHex:0xd4c09a, desc:'صغير وسريع جداً، خطر دائم يحدق به',   predatedBy:['leopard','eagle','lion','tiger','bear'],  camDist:3,  camHeight:1.5 },
  giraffe: { nameAr:'زرافة', nameEn:'Giraffe', icon:'🦒', eyeH:4.5,  speed:5,  runSpeed:9,  diet:'herb', bodyHex:0xe8c040, desc:'طويل القامة، يرى بعيداً، ندرة الأعداء', predatedBy:['lion'],                                   camDist:11, camHeight:7   },
  falcon:  { nameAr:'صقر',   nameEn:'Falcon',  icon:'🦅', eyeH:0.7,  speed:9,  runSpeed:20, diet:'carn', bodyHex:0x7a5030, desc:'طير صياد سريع، يصطاد فرائس صغيرة',     predatedBy:['eagle'],                                  camDist:5,  camHeight:2   },
  eagle:   { nameAr:'نسر',   nameEn:'Eagle',   icon:'🦅', eyeH:0.9,  speed:8,  runSpeed:18, diet:'carn', bodyHex:0x3a2810, desc:'ملك الطيور، لا أعداء طبيعيين',          predatedBy:[],                                         camDist:5,  camHeight:2   },
  leopard: { nameAr:'فهد',   nameEn:'Leopard', icon:'🐆', eyeH:0.9,  speed:10, runSpeed:19, diet:'carn', bodyHex:0xd4a030, desc:'مفترس أنيق وسريع، يتسلق الصخور',       predatedBy:['lion','tiger'],                           camDist:5,  camHeight:2   },
  tiger:   { nameAr:'نمر',   nameEn:'Tiger',   icon:'🐯', eyeH:1.0,  speed:9,  runSpeed:17, diet:'carn', bodyHex:0xe07830, desc:'مفترس ضخم، قوي وذكي',                   predatedBy:[],                                         camDist:7,  camHeight:2.5 },
  lion:    { nameAr:'أسد',   nameEn:'Lion',    icon:'🦁', eyeH:1.1,  speed:8,  runSpeed:15, diet:'carn', bodyHex:0xd4a855, desc:'ملك الغابة، لا يهاب شيئاً',             predatedBy:[],                                         camDist:7,  camHeight:2.5 },
  bear:    { nameAr:'دب',    nameEn:'Bear',    icon:'🐻', eyeH:1.5,  speed:6,  runSpeed:12, diet:'omni', bodyHex:0x5a3820, desc:'آكل للكل، قوي وصبور',                   predatedBy:[],                                         camDist:8,  camHeight:3   },
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
  TERRAIN_BASE: 4.2,
  TERRAIN_H: 7,
  TREE_COUNT: 200,
  ROCK_COUNT: 54,
  GRASS_PATCH_COUNT: 220,
  FOOD_COUNT: 50,
  WATER_LEVEL: 1.4,
  BOT_COUNT: 14,
  HUNGER_DRAIN: 1.0,
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
  id: number; mesh: THREE.Group; pos: THREE.Vector3; vel: THREE.Vector3;
  role: BotRole; animalKey: AnimalKey; gender: Gender;
  hp: number; alive: boolean; state: BotState;
  targetPos: THREE.Vector3; stateTimer: number; attackTimer: number; animT: number;
}
interface FoodNode {
  id: number; mesh: THREE.Mesh; pos: THREE.Vector3;
  kind: 'grass' | 'meat' | 'berry'; eaten: boolean; respawn: number;
}
interface QuestStep {
  id: string; textAr: string; target: number; progress: number; done: boolean;
}
interface SurvivalState {
  power: number; hunger: number; thirst: number;
  phase: GamePhase; animal: AnimalKey; gender: Gender;
  surviveTimer: number; quests: QuestStep[]; allQuestsDone: boolean;
  mateFound: boolean; elapsed: number; attackFlash: number;
}

// ══════════════════════════════════════════════════════════
//  TERRAIN NOISE
// ══════════════════════════════════════════════════════════
const noise2D = createNoise2D();
function terrainH(x: number, z: number): number {
  return CFG.TERRAIN_BASE + (
    noise2D(x / 135, z / 135) * 0.52 +
    noise2D(x / 55, z / 55) * 0.10 +
    noise2D(x / 24, z / 24) * 0.025
  ) * CFG.TERRAIN_H;
}

// Camera-relative bearing: 0 = straight ahead, positive = right
function getBearing(fromX: number, fromZ: number, toX: number, toZ: number, camYaw: number): number {
  const dx = toX - fromX, dz = toZ - fromZ;
  const fwd = -dx * Math.sin(camYaw) - dz * Math.cos(camYaw);
  const rgt =  dx * Math.cos(camYaw) - dz * Math.sin(camYaw);
  return Math.atan2(rgt, fwd);
}

// ══════════════════════════════════════════════════════════
//  MESH BUILDERS
// ══════════════════════════════════════════════════════════
function mat(hex: number, rough = 0.85, metal = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
}

function makeAnimalMesh(key: AnimalKey, scale = 1.0): THREE.Group {
  const g = new THREE.Group();
  const a = ANIMALS[key];
  const c = a.bodyHex;
  const dark  = new THREE.Color(c).multiplyScalar(0.6).getHex();
  const light = new THREE.Color(c).multiplyScalar(1.3).getHex();

  if (key === 'rabbit') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.28,8,6), mat(c));
    body.position.y = 0.28; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22,8,6), mat(c));
    head.position.set(0,0.65,0.2); g.add(head);
    for (const s of [-1,1]) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.03,0.38,6), mat(light));
      ear.position.set(s*0.1,1.0,0.15); ear.rotation.z = s*0.15; g.add(ear);
    }
    for (const [sx,sz] of [[-1,1],[1,1],[-1,-1],[1,-1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.04,0.25,5), mat(dark));
      leg.position.set(sx*0.14,0.08,sz*0.14); g.add(leg);
    }
  } else if (key === 'giraffe') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,1.4), mat(c));
    body.position.y = 2.4; g.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.28,2.4,7), mat(light));
    neck.position.set(0,3.9,0.4); neck.rotation.x = -0.35; g.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35,0.35,0.7), mat(c));
    head.position.set(0,5.1,0.9); g.add(head);
    for (const s of [-1,1]) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.3,5), mat(dark));
      h.position.set(s*0.12,5.42,0.85); g.add(h);
    }
    for (const [sx,sz] of [[-1,1],[1,1],[-1,-1],[1,-1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.08,2.2,6), mat(dark));
      leg.position.set(sx*0.3,1.1,sz*0.5); g.add(leg);
    }
  } else if (key === 'falcon' || key === 'eagle') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.35,8,6), mat(c));
    body.scale.set(1,0.8,1.4); body.position.y = 0.38; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2,8,6), mat(dark));
    head.position.set(0,0.7,0.3); g.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.07,0.22,5), mat(0xffaa00));
    beak.rotation.x = Math.PI/2; beak.position.set(0,0.68,0.56); g.add(beak);
    for (const s of [-1,1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.9,0.08,0.45), mat(light));
      wing.position.set(s*0.8,0.4,0); wing.rotation.z = s*0.25; g.add(wing);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.07,0.4), mat(dark));
    tail.position.set(0,0.35,-0.55); g.add(tail);
  } else {
    const isBear = key === 'bear';
    const bW = isBear ? 0.9 : 0.65, bH = isBear ? 0.75 : 0.55, bL = isBear ? 1.1 : 1.0;
    const bodyY = isBear ? 1.0 : 0.9;
    const body = new THREE.Mesh(new THREE.BoxGeometry(bW,bH,bL), mat(c));
    body.position.y = bodyY; g.add(body);
    const headS = isBear ? 0.38 : 0.28;
    const head = new THREE.Mesh(new THREE.SphereGeometry(headS,8,6), mat(c));
    head.position.set(0, bodyY+0.4, 0.55+(isBear?0.1:0)); g.add(head);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.15,0.22), mat(dark));
    snout.position.set(0, bodyY+0.3, 0.8+(isBear?0.1:0)); g.add(snout);
    if (key !== 'lion') {
      for (const s of [-1,1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08,0.18,5), mat(dark));
        ear.position.set(s*(headS*0.65), bodyY+0.7, 0.52); g.add(ear);
      }
    } else {
      const mane = new THREE.Mesh(new THREE.SphereGeometry(0.44,8,6), mat(0x6b3a10));
      mane.position.copy(head.position); mane.position.y -= 0.05; g.add(mane);
    }
    if (key === 'deer') {
      for (const s of [-1,1]) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.02,0.5,4), mat(0x8b6a3a));
        ant.position.set(s*0.18,bodyY+0.9,0.5); ant.rotation.z = s*0.4; g.add(ant);
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.28,4), mat(0x8b6a3a));
        branch.position.set(s*0.32,bodyY+1.1,0.5); branch.rotation.set(0,0,s*0.9); g.add(branch);
      }
    }
    if (key === 'tiger' || key === 'leopard') {
      for (let i = 0; i < 4; i++) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(key==='tiger'?0.67:0.12, 0.07, 0.12),
          mat(key==='tiger'?0x2a1a00:0x4a2a00)
        );
        stripe.position.set(0, bodyY+0.25-i*0.12, bL*0.4-i*0.22); g.add(stripe);
      }
    }
    const legH = isBear ? 0.85 : 0.75;
    const legY = bodyY - bH/2 - legH/2 + 0.05;
    for (const [sx,sz] of [[-1,1],[1,1],[-1,-1],[1,-1]] as [number,number][]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.07,legH,6), mat(dark));
      leg.position.set(sx*(bW*0.38), legY, sz*(bL*0.33)); g.add(leg);
    }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.02,0.5,5), mat(dark));
    tail.position.set(0, bodyY+0.1, -bL*0.55); tail.rotation.x = 0.6; g.add(tail);
  }

  g.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
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
    { id:'eat',     textAr:`كُل ${foodName} 3 مرات`,             target:3,  progress:0, done:false },
    { id:'drink',   textAr:'اشرب من الماء مرتين',                 target:2,  progress:0, done:false },
    { id:'survive', textAr:`انجُ ${CFG.QUEST_SURVIVE_SEC} ثانية`, target:CFG.QUEST_SURVIVE_SEC, progress:0, done:false },
    { id:'mate',    textAr:'ابحث عن شريك من نفس النوع',           target:1,  progress:0, done:false },
  ];
}

// ══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function BatmosGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef  = useRef<SurvivalState>({
    power:100, hunger:100, thirst:100,
    phase:'select', animal:'deer', gender:'male',
    surviveTimer:0, quests:[], allQuestsDone:false, mateFound:false,
    elapsed:0, attackFlash:0,
  });
  const [ui, setUi]           = useState<SurvivalState>(stateRef.current);
  const [selAnimal, setSelAnimal] = useState<AnimalKey>('deer');
  const [selGender, setSelGender] = useState<Gender>('male');
  const [interaction, setInteraction] = useState('');
  const [showQuests, setShowQuests]   = useState(false);

  // Touch state
  const touchMoveRef       = useRef({ x:0, y:0 });
  const touchSprintRef     = useRef(false);
  const camTouchRef        = useRef<{ id:number; lastX:number; lastY:number } | null>(null);
  const joystickCenterRef  = useRef<{ id:number; cx:number; cy:number } | null>(null);
  const [joystickKnob, setJoystickKnob] = useState({ x:0, y:0 });
  const [isTouchSprinting, setIsTouchSprinting] = useState(false);
  const [compassData, setCompassData] = useState<{
    foodAngle:number|null; waterAngle:number|null; mateAngle:number|null;
  }>({ foodAngle:null, waterAngle:null, mateAngle:null });

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
    playerMesh: THREE.Group | null;
    playerAnimT: number;
    playerFacing: number;
    onGround: boolean;
    keys: Record<string, boolean>;
    mouseButtonHeld: boolean;
    animFrame: number;
    pointerLocked: boolean;
    mateBot: BotAnimal | null;
    mateMarker: THREE.Group | null;
    compassTimer: number;
  } | null>(null);

  // ── POINTER LOCK ──────────────────────────────────────
  useEffect(() => {
    const onPL  = () => { if (threeRef.current) threeRef.current.pointerLocked = true; };
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
      power:100, hunger:100, thirst:100,
      phase:'playing', animal, gender,
      surviveTimer:0, quests, allQuestsDone:false, mateFound:false,
      elapsed:0, attackFlash:0,
    };
    setUi({ ...stateRef.current });

    // ── THREE SETUP ──────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x9dd9f7);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x9dd9f7, 0.004);

    // Fixed daylight keeps the landscape bright throughout the session.
    const ambient = new THREE.AmbientLight(0xfff4df, 0.8);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff5df, 2.0);
    sun.position.set(120, 200, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 500;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -200;
    sun.shadow.camera.right = sun.shadow.camera.top = 200;
    scene.add(sun);
    const sky = new THREE.HemisphereLight(0xb9e4ff, 0x66894a, 0.8);
    scene.add(sky);

    const camera = new THREE.PerspectiveCamera(70, canvas.clientWidth / canvas.clientHeight, 0.1, 600);

    // ── TERRAIN ──────────────────────────────────────
    const tGeo = new THREE.PlaneGeometry(S, S, CFG.TERRAIN_SEGS, CFG.TERRAIN_SEGS);
    tGeo.rotateX(-Math.PI / 2);
    const pos = tGeo.attributes.position;
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainH(x, z);
      pos.setY(i, h);
      const t2 = Math.max(0, (h - (CFG.WATER_LEVEL + 0.35)) / (CFG.TERRAIN_H * 0.58));
      let r, gr, b;
      if (h < CFG.WATER_LEVEL+0.5)  { r=0.76; gr=0.70; b=0.50; }
      else if (t2 < 0.72)            { r=0.34; gr=0.58; b=0.25; }
      else if (t2 < 1.05)            { r=0.47; gr=0.53; b=0.31; }
      else if (t2 < 1.35)            { r=0.58; gr=0.56; b=0.47; }
      else                           { r=0.86; gr=0.87; b=0.82; }
      colors.push(r, gr, b);
    }
    tGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    tGeo.computeVertexNormals();
    const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.9 }));
    terrain.receiveShadow = true;
    scene.add(terrain);

    // ── WATER ────────────────────────────────────────
    const waterGeo = new THREE.PlaneGeometry(S, S);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({ color:0x2a6fa8, transparent:true, opacity:0.72, roughness:0.1, metalness:0.2 });
    const waterPlane = new THREE.Mesh(waterGeo, waterMat);
    waterPlane.position.y = CFG.WATER_LEVEL;
    scene.add(waterPlane);

    // ── TREES ────────────────────────────────────────
    for (let i = 0; i < CFG.TREE_COUNT; i++) {
      const tx = (Math.random()-0.5)*(S-20), tz = (Math.random()-0.5)*(S-20);
      const ty = terrainH(tx, tz);
      if (ty < CFG.WATER_LEVEL+0.4) continue;
      const tg = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.35,2.2+Math.random()*1.5,7), mat(0x5a3a1a));
      trunk.position.y = 1.3; trunk.castShadow = true; tg.add(trunk);
      const layers = 2+Math.floor(Math.random()*2);
      for (let l = 0; l < layers; l++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.8-l*0.35, 2.0-l*0.2, 7), mat(Math.random()>0.3?0x2d6a2d:0x1e5c1e));
        cone.position.y = 2.8+l*1.2; cone.castShadow = true; tg.add(cone);
      }
      tg.position.set(tx, ty, tz); scene.add(tg);
    }

    // ── ROCKS ────────────────────────────────────────
    for (let i = 0; i < CFG.ROCK_COUNT; i++) {
      const rx = (Math.random()-0.5)*(S-20), rz = (Math.random()-0.5)*(S-20);
      const ry = terrainH(rx, rz);
      if (ry < CFG.WATER_LEVEL) continue;
      const s = 0.5+Math.random()*1.8;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s,0), mat(0x808070+Math.floor(Math.random()*0x101010)));
      rock.position.set(rx, ry+s*0.4, rz); rock.rotation.set(Math.random(),Math.random(),Math.random());
      rock.castShadow = true; rock.receiveShadow = true; scene.add(rock);
    }

    // ── SPARSE GRASS ──────────────────────────────────
    const grassGeometry = new THREE.ConeGeometry(0.075, 0.55, 3);
    grassGeometry.translate(0, 0.275, 0);
    const grassMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    const grass = new THREE.InstancedMesh(
      grassGeometry,
      grassMaterial,
      CFG.GRASS_PATCH_COUNT * 3,
    );
    grass.castShadow = false;
    grass.receiveShadow = false;
    const grassColors = [
      new THREE.Color(0x6f9d45),
      new THREE.Color(0x83aa4e),
      new THREE.Color(0x91ad59),
    ];
    const grassBlade = new THREE.Object3D();
    let grassIndex = 0;
    for (let patch = 0; patch < CFG.GRASS_PATCH_COUNT; patch++) {
      const gx = (Math.random() - 0.5) * (S - 20);
      const gz = (Math.random() - 0.5) * (S - 20);
      const gy = terrainH(gx, gz);
      if (gy < CFG.WATER_LEVEL + 0.3) continue;

      for (let blade = 0; blade < 3; blade++) {
        const angle = Math.random() * Math.PI * 2;
        const offset = 0.12 + Math.random() * 0.08;
        const bx = gx + Math.cos(angle) * offset;
        const bz = gz + Math.sin(angle) * offset;
        grassBlade.position.set(bx, terrainH(bx, bz), bz);
        grassBlade.rotation.set(
          (Math.random() - 0.5) * 0.25,
          angle,
          (Math.random() - 0.5) * 0.25,
        );
        grassBlade.scale.set(0.8 + Math.random() * 0.4, 0.7 + Math.random() * 0.6, 1);
        grassBlade.updateMatrix();
        grass.setMatrixAt(grassIndex, grassBlade.matrix);
        grass.setColorAt(grassIndex, grassColors[Math.floor(Math.random() * grassColors.length)]);
        grassIndex++;
      }
    }
    grass.count = grassIndex;
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    scene.add(grass);

    // ── FOOD NODES ───────────────────────────────────
    const aDef = ANIMALS[animal];
    const foods: FoodNode[] = [];
    for (let i = 0; i < CFG.FOOD_COUNT; i++) {
      const fx = (Math.random()-0.5)*(S-30), fz = (Math.random()-0.5)*(S-30);
      const fy = terrainH(fx, fz);
      if (fy < CFG.WATER_LEVEL+0.5) continue;
      const kind: FoodNode['kind'] = aDef.diet==='herb'?'grass':aDef.diet==='carn'?'meat':(Math.random()>0.5?'grass':'berry');
      let fMesh: THREE.Mesh;
      if (kind==='grass')      fMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9,0.7,0.25,8), mat(0x44aa44));
      else if (kind==='meat')  fMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.3,0.6), mat(0xaa3322));
      else                     fMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3,7,5), mat(0x8b44aa));
      fMesh.position.set(fx, fy+0.15, fz); fMesh.castShadow = true; scene.add(fMesh);
      foods.push({ id:i, mesh:fMesh, pos:new THREE.Vector3(fx,fy,fz), kind, eaten:false, respawn:0 });
    }

    // ── BOT ANIMALS ──────────────────────────────────
    const predatorKeys = aDef.predatedBy as unknown as AnimalKey[];
    const preyKeys = (Object.keys(ANIMALS) as AnimalKey[]).filter(k => (ANIMALS[k].predatedBy as readonly string[]).includes(animal));
    const mateGender: Gender = gender==='male'?'female':'male';
    const bots: BotAnimal[] = [];
    let mateBot: BotAnimal | null = null;

    for (let i = 0; i < CFG.BOT_COUNT; i++) {
      let bx=(Math.random()-0.5)*(S-40), bz=(Math.random()-0.5)*(S-40), by=terrainH(bx,bz);
      while (by < CFG.WATER_LEVEL+1) { bx=(Math.random()-0.5)*(S-40); bz=(Math.random()-0.5)*(S-40); by=terrainH(bx,bz); }
      let role: BotRole, bKey: AnimalKey;
      let bGender: Gender = Math.random()>0.5?'male':'female';
      const r = Math.random();
      if (i===0 && predatorKeys.length===0)  { role='predator'; bKey=animal; }
      else if (!mateBot && i<3)              { role='mate'; bKey=animal; bGender=mateGender; }
      else if (predatorKeys.length>0 && r<0.4) { role='predator'; bKey=predatorKeys[Math.floor(Math.random()*predatorKeys.length)]; }
      else if (preyKeys.length>0 && r<0.7)     { role='prey';     bKey=preyKeys[Math.floor(Math.random()*preyKeys.length)]; }
      else                                      { role='neutral';  bKey=(Object.keys(ANIMALS) as AnimalKey[])[Math.floor(Math.random()*9)]; }

      const bSize = ANIMALS[bKey].speed/8;
      const mesh = makeAnimalMesh(bKey, bSize*0.9+0.1);
      if (role==='predator') mesh.traverse(c => { if ((c as THREE.Mesh).isMesh) { const m=(c as THREE.Mesh).material as THREE.MeshStandardMaterial; m.emissive=new THREE.Color(0x330000); m.emissiveIntensity=0.3; }});
      else if (role==='mate') mesh.traverse(c => { if ((c as THREE.Mesh).isMesh) { const m=(c as THREE.Mesh).material as THREE.MeshStandardMaterial; m.emissive=new THREE.Color(0x223300); m.emissiveIntensity=0.4; }});
      mesh.position.set(bx,by,bz); scene.add(mesh);
      const bot: BotAnimal = {
        id:i, mesh, pos:new THREE.Vector3(bx,by,bz), vel:new THREE.Vector3(),
        role, animalKey:bKey, gender:bGender, hp:100, alive:true,
        state:'wander', targetPos:new THREE.Vector3(bx,by,bz),
        stateTimer:Math.random()*3, attackTimer:0, animT:Math.random()*10,
      };
      bots.push(bot);
      if (role==='mate' && !mateBot) mateBot = bot;
    }

    // ── MATE MARKER (golden floating ring) ───────────
    let mateMarker: THREE.Group | null = null;
    if (mateBot) {
      mateMarker = new THREE.Group();
      const ringGeo = new THREE.TorusGeometry(0.9, 0.18, 8, 18);
      const ringMat = new THREE.MeshStandardMaterial({ color:0xffd700, emissive:new THREE.Color(0xffd700), emissiveIntensity:0.9, metalness:0.3, roughness:0.4 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      mateMarker.add(ring);
      const arrowGeo = new THREE.ConeGeometry(0.35, 0.7, 6);
      const arrowMesh = new THREE.Mesh(arrowGeo, ringMat);
      arrowMesh.position.y = -1.1; // points downward
      mateMarker.add(arrowMesh);
      scene.add(mateMarker);
    }

    // ── PLAYER MESH (visible in 3rd-person) ──────────
    const playerMesh = makeAnimalMesh(animal, 1.0);
    scene.add(playerMesh);

    // ── PLAYER START ─────────────────────────────────
    let startX=0, startZ=0;
    while (terrainH(startX, startZ) < CFG.WATER_LEVEL+1) {
      startX=(Math.random()-0.5)*60; startZ=(Math.random()-0.5)*60;
    }
    const playerPos = new THREE.Vector3(startX, terrainH(startX,startZ)+aDef.eyeH, startZ);
    const playerVel = new THREE.Vector3();
    camera.position.copy(playerPos);

    threeRef.current = {
      renderer, scene, camera, terrain, bots, foods,
      waterMeshes:[waterPlane],
      clock:new THREE.Clock(),
      camPitch:0.35, camYaw:0,
      playerPos, playerVel,
      playerMesh, playerAnimT:0, playerFacing:Math.PI,
      onGround:true,
      keys:{},
      mouseButtonHeld:false,
      animFrame:0,
      pointerLocked:false,
      mateBot, mateMarker,
      compassTimer:0,
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
      const t = threeRef.current;
      if (!t || (!t.pointerLocked && !t.mouseButtonHeld)) return;
      t.camYaw -= e.movementX * 0.003;
      t.camPitch = Math.max(-0.2, Math.min(0.72, t.camPitch - e.movementY * 0.003));
    };
    const onResize = () => {
      const t = threeRef.current;
      if (!t) return;
      t.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
      t.camera.aspect = canvas.clientWidth / canvas.clientHeight;
      t.camera.updateProjectionMatrix();
    };
    window.addEventListener('keydown', e => onKey(e, true));
    window.addEventListener('keyup',   e => onKey(e, false));
    window.addEventListener('mousemove', onMouse);
    window.addEventListener('resize', onResize);
    canvas.addEventListener('mousedown', () => {
      if (stateRef.current.phase === 'playing') {
        threeRef.current!.mouseButtonHeld = true;
        canvas.requestPointerLock();
      }
    });
    canvas.addEventListener('mouseup', () => {
      if (threeRef.current) threeRef.current.mouseButtonHeld = false;
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
      const isRun = t.keys['ShiftLeft'] || t.keys['ShiftRight'] || touchSprintRef.current;
      const speed = isRun ? aDef2.runSpeed : aDef2.speed;
      const forward = new THREE.Vector3(-Math.sin(t.camYaw), 0, -Math.cos(t.camYaw));
      const right   = new THREE.Vector3( Math.cos(t.camYaw), 0, -Math.sin(t.camYaw));
      const move = new THREE.Vector3();

      // Keyboard
      if (t.keys['KeyW'] || t.keys['ArrowUp'])    move.add(forward);
      if (t.keys['KeyS'] || t.keys['ArrowDown'])  move.sub(forward);
      if (t.keys['KeyA'] || t.keys['ArrowLeft'])  move.sub(right);
      if (t.keys['KeyD'] || t.keys['ArrowRight']) move.add(right);

      // Touch joystick: up = forward, right = strafe
      const tj = touchMoveRef.current;
      if (Math.abs(tj.x) > 0.08 || Math.abs(tj.y) > 0.08) {
        move.addScaledVector(forward, -tj.y);
        move.addScaledVector(right, tj.x);
      }

      const isMoving = move.lengthSq() > 0.0001;
      if (isMoving) move.normalize().multiplyScalar(speed * dt);

      t.playerVel.y += CFG.GRAVITY * dt;
      t.playerPos.add(move);
      t.playerPos.y += t.playerVel.y * dt;

      // Terrain collision
      const groundY = terrainH(t.playerPos.x, t.playerPos.z);
      const eyeBase = groundY + aDef2.eyeH;
      if (t.playerPos.y < eyeBase) { t.playerPos.y = eyeBase; t.playerVel.y = 0; t.onGround = true; }
      else                         { t.onGround = false; }

      // Map boundary
      const B = CFG.MAP_SIZE / 2 - 5;
      t.playerPos.x = Math.max(-B, Math.min(B, t.playerPos.x));
      t.playerPos.z = Math.max(-B, Math.min(B, t.playerPos.z));

      // ── PLAYER MESH & WALKING ANIMATION ──────────
      if (t.playerMesh) {
        const feetY = terrainH(t.playerPos.x, t.playerPos.z);
        if (isMoving) {
          t.playerAnimT += dt;
          const freq = isRun ? 7 : 4;
          const bob = Math.abs(Math.sin(t.playerAnimT * freq)) * 0.08;
          t.playerMesh.position.set(t.playerPos.x, feetY + bob, t.playerPos.z);
          // Animate approximate leg children (last 4-5 before tail)
          const nc = t.playerMesh.children.length;
          t.playerMesh.children.forEach((child, ci) => {
            if (ci >= nc - 5 && ci <= nc - 2) {
              (child as THREE.Object3D).rotation.x = Math.sin(t.playerAnimT * freq + ci * 1.57) * 0.45;
            }
          });
          // Face movement direction
          t.playerFacing = Math.atan2(move.x, move.z);
        } else {
          t.playerMesh.position.set(t.playerPos.x, feetY, t.playerPos.z);
          const nc = t.playerMesh.children.length;
          t.playerMesh.children.forEach((child, ci) => {
            if (ci >= nc - 5 && ci <= nc - 2) {
              (child as THREE.Object3D).rotation.x *= 0.8;
            }
          });
        }
        t.playerMesh.rotation.y = t.playerFacing;
      }

      // ── THIRD-PERSON CAMERA ──────────────────────
      const camDist = aDef2.camDist;
      const camH    = aDef2.camHeight;
      const pitch   = Math.max(-0.2, Math.min(0.72, t.camPitch));
      const hDist   = camDist * Math.cos(pitch);
      const vDist   = camDist * Math.sin(pitch);
      const feetY2  = t.playerPos.y - aDef2.eyeH;
      t.camera.position.set(
        t.playerPos.x + Math.sin(t.camYaw) * hDist,
        feetY2 + camH + vDist,
        t.playerPos.z + Math.cos(t.camYaw) * hDist,
      );
      // Prevent camera clipping into terrain
      const camGround = terrainH(t.camera.position.x, t.camera.position.z);
      if (t.camera.position.y < camGround + 0.5) t.camera.position.y = camGround + 0.5;
      // Look at animal's body center
      t.camera.lookAt(new THREE.Vector3(t.playerPos.x, feetY2 + aDef2.eyeH * 0.55, t.playerPos.z));

      // ── MATE MARKER ──────────────────────────────
      if (t.mateMarker && t.mateBot && t.mateBot.alive) {
        const mH = ANIMALS[t.mateBot.animalKey].eyeH;
        t.mateMarker.position.set(
          t.mateBot.pos.x,
          t.mateBot.pos.y + mH * 2.0 + Math.sin(st.elapsed * 2.5) * 0.3,
          t.mateBot.pos.z,
        );
        t.mateMarker.rotation.y += dt * 2.2;
        t.mateMarker.visible = true;
      } else if (t.mateMarker) {
        t.mateMarker.visible = false;
      }

      // ── SURVIVAL DRAIN ───────────────────────────
      st.hunger = Math.max(0, st.hunger - CFG.HUNGER_DRAIN * dt);
      st.thirst = Math.max(0, st.thirst - CFG.THIRST_DRAIN * dt);
      if (st.hunger <= 0) st.power = Math.max(0, st.power - CFG.POWER_DRAIN_HUNGRY * dt);
      if (st.thirst <= 0) st.power = Math.max(0, st.power - CFG.POWER_DRAIN_THIRSTY * dt);
      if (st.attackFlash > 0) st.attackFlash -= dt;

      // ── QUEST: SURVIVE ───────────────────────────
      const sQ = st.quests.find(q => q.id==='survive');
      if (sQ && !sQ.done) { sQ.progress = Math.min(sQ.target, sQ.progress+dt); if (sQ.progress>=sQ.target) sQ.done=true; st.surviveTimer=sQ.progress; }

      // ── INTERACTION HINTS ────────────────────────
      let hint = '';
      for (const f of t.foods) {
        if (!f.eaten && t.playerPos.distanceTo(f.pos) < CFG.EAT_RANGE) { hint='اضغط زر التفاعل 🍃'; break; }
      }
      if (!hint) {
        let nearWater = false;
        const cgY = terrainH(t.playerPos.x, t.playerPos.z);
        if (cgY < CFG.WATER_LEVEL+1.5) nearWater = true;
        for (let a2=0; a2<8 && !nearWater; a2++) {
          const ang=(a2/8)*Math.PI*2;
          if (terrainH(t.playerPos.x+Math.cos(ang)*CFG.WATER_DRINK_RANGE, t.playerPos.z+Math.sin(ang)*CFG.WATER_DRINK_RANGE) < CFG.WATER_LEVEL+0.3) nearWater=true;
        }
        if (nearWater) hint='اضغط زر التفاعل 💧';
      }
      if (!hint && t.mateBot && t.mateBot.alive && st.allQuestsDone) {
        if (t.playerPos.distanceTo(t.mateBot.pos) < CFG.MATE_INTERACT_DIST+1) hint='اضغط زر التفاعل 💚';
      } else if (!hint && t.mateBot && t.mateBot.alive && !st.allQuestsDone) {
        if (t.playerPos.distanceTo(t.mateBot.pos) < CFG.MATE_INTERACT_DIST) {
          const mQ = st.quests.find(q=>q.id==='mate');
          if (mQ && !mQ.done) { mQ.progress=1; mQ.done=true; }
          hint='💚 وجدت شريكاً! أكمل المهام أولاً';
        }
      }
      setInteraction(hint);

      // ── FOOD RESPAWN ─────────────────────────────
      for (const f of t.foods) {
        if (f.eaten) { f.respawn-=dt; if (f.respawn<=0) { f.eaten=false; f.mesh.visible=true; } }
      }

      // ── BOT UPDATE ──────────────────────────────
      for (const bot of t.bots) {
        if (!bot.alive) continue;
        bot.animT += dt; bot.stateTimer -= dt;
        if (bot.attackTimer>0) bot.attackTimer-=dt;
        const distToPlayer = bot.pos.distanceTo(t.playerPos);
        if (bot.role==='predator') {
          if (bot.state!=='attack' && distToPlayer<CFG.PREDATOR_SIGHT) bot.state=distToPlayer<CFG.PREDATOR_ATTACK_RANGE?'attack':'chase';
          else if (bot.state==='chase' && distToPlayer>CFG.PREDATOR_SIGHT*1.3) { bot.state='wander'; bot.stateTimer=3; }
          else if (bot.state==='attack' && distToPlayer>CFG.PREDATOR_ATTACK_RANGE*1.5) bot.state='chase';
          if (bot.stateTimer<=0 && bot.state==='wander') { bot.targetPos.set(bot.pos.x+(Math.random()-0.5)*40,0,bot.pos.z+(Math.random()-0.5)*40); bot.stateTimer=3+Math.random()*3; }
          if (bot.state==='attack' && bot.attackTimer<=0) { st.power=Math.max(0,st.power-CFG.PREDATOR_ATK_DMG); st.attackFlash=0.25; bot.attackTimer=CFG.PREDATOR_ATK_RATE; }
        } else if (bot.role==='prey') {
          if (distToPlayer<CFG.PREY_FLEE_DIST) { bot.state='flee'; const awayDir=bot.pos.clone().sub(t.playerPos).normalize(); bot.targetPos.copy(bot.pos).addScaledVector(awayDir,30); }
          else if (bot.stateTimer<=0) { bot.state='wander'; bot.targetPos.set(bot.pos.x+(Math.random()-0.5)*30,0,bot.pos.z+(Math.random()-0.5)*30); bot.stateTimer=2+Math.random()*3; }
        } else {
          if (bot.stateTimer<=0) { bot.targetPos.set(bot.pos.x+(Math.random()-0.5)*25,0,bot.pos.z+(Math.random()-0.5)*25); bot.stateTimer=4+Math.random()*4; }
          bot.state='wander';
        }
        if (bot.state!=='attack' && bot.state!=='idle') {
          const bSpeed=ANIMALS[bot.animalKey].speed*(bot.state==='flee'?1.3:0.7);
          const dir=bot.targetPos.clone().sub(bot.pos); dir.y=0;
          if (dir.lengthSq()>0.25) { dir.normalize().multiplyScalar(bSpeed*dt); bot.pos.add(dir); }
          const B2=CFG.MAP_SIZE/2-8;
          bot.pos.x=Math.max(-B2,Math.min(B2,bot.pos.x)); bot.pos.z=Math.max(-B2,Math.min(B2,bot.pos.z));
        }
        const bGround=terrainH(bot.pos.x,bot.pos.z); bot.pos.y=bGround; bot.mesh.position.copy(bot.pos);
        if (bot.state!=='idle') {
          const dir2=bot.targetPos.clone().sub(bot.pos); dir2.y=0;
          if (dir2.lengthSq()>0.1) bot.mesh.rotation.y=Math.atan2(dir2.x,dir2.z);
        }
        const walkSpeed=bot.state==='wander'?2:4;
        bot.mesh.children.forEach((child,ci) => {
          if (ci>=6 && ci<=9) (child as THREE.Mesh).rotation.x=Math.sin(bot.animT*walkSpeed+ci*Math.PI/2)*0.4;
        });
      }

      // ── COMPASS UPDATE ───────────────────────────
      t.compassTimer += dt;
      if (t.compassTimer >= 0.2) {
        t.compassTimer = 0;
        const px=t.playerPos.x, pz=t.playerPos.z, cy=t.camYaw;
        // Nearest food
        let fAngle: number|null=null, fDist=Infinity;
        for (const f of t.foods) { if (!f.eaten) { const d=(f.pos.x-px)**2+(f.pos.z-pz)**2; if (d<fDist) { fDist=d; fAngle=getBearing(px,pz,f.pos.x,f.pos.z,cy); } } }
        // Nearest water (terrain scan)
        let wAngle: number|null=null, wDist=Infinity;
        for (let a=0;a<16;a++) {
          const ang=(a/16)*Math.PI*2;
          for (let r=10;r<=120;r+=10) {
            const wx=px+Math.cos(ang)*r, wz=pz+Math.sin(ang)*r;
            if (terrainH(wx,wz)<CFG.WATER_LEVEL) { const d=r*r; if (d<wDist) { wDist=d; wAngle=getBearing(px,pz,wx,wz,cy); } break; }
          }
        }
        const mAngle=(t.mateBot&&t.mateBot.alive)?getBearing(px,pz,t.mateBot.pos.x,t.mateBot.pos.z,cy):null;
        setCompassData({ foodAngle:fAngle, waterAngle:wAngle, mateAngle:mAngle });
      }

      // ── CHECK DEATH ──────────────────────────────
      if (st.power <= 0) { st.phase='dead'; setUi({...st}); t.renderer.render(t.scene,t.camera); return; }
      if (!st.allQuestsDone && st.quests.every(q=>q.done)) st.allQuestsDone=true;

      t.renderer.render(t.scene, t.camera);
      setUi({ ...st });
      t.animFrame = requestAnimationFrame(gameLoop);
    }

    (threeRef.current as any)._cleanup = () => {
      cancelAnimationFrame(threeRef.current?.animFrame ?? 0);
      window.removeEventListener('keydown', e => onKey(e, true));
      window.removeEventListener('keyup',   e => onKey(e, false));
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
    threeRef.current!.animFrame = requestAnimationFrame(gameLoop);
  }, []);

  // ── INTERACTION HANDLER ───────────────────────────────
  const handleInteract = useCallback(() => {
    const t = threeRef.current;
    const st = stateRef.current;
    if (!t || st.phase !== 'playing') return;
    for (const f of t.foods) {
      if (f.eaten) continue;
      if (t.playerPos.distanceTo(f.pos) < CFG.EAT_RANGE) {
        f.eaten=true; f.mesh.visible=false; f.respawn=25+Math.random()*15;
        st.hunger=Math.min(100,st.hunger+CFG.EAT_HUNGER); st.power=Math.min(100,st.power+CFG.EAT_POWER);
        const eQ=st.quests.find(q=>q.id==='eat'); if (eQ&&!eQ.done) { eQ.progress=Math.min(eQ.target,eQ.progress+1); if (eQ.progress>=eQ.target) eQ.done=true; }
        setUi({...st}); return;
      }
    }
    const curGY=terrainH(t.playerPos.x,t.playerPos.z);
    let nearWater=curGY<CFG.WATER_LEVEL+1.5;
    if (!nearWater) for (let a=0;a<8;a++) { const ang=(a/8)*Math.PI*2; if (terrainH(t.playerPos.x+Math.cos(ang)*CFG.WATER_DRINK_RANGE,t.playerPos.z+Math.sin(ang)*CFG.WATER_DRINK_RANGE)<CFG.WATER_LEVEL+0.3) { nearWater=true; break; } }
    if (nearWater) {
      st.thirst=Math.min(100,st.thirst+CFG.DRINK_THIRST); st.power=Math.min(100,st.power+CFG.DRINK_POWER);
      const dQ=st.quests.find(q=>q.id==='drink'); if (dQ&&!dQ.done) { dQ.progress=Math.min(dQ.target,dQ.progress+1); if (dQ.progress>=dQ.target) dQ.done=true; }
      setUi({...st}); return;
    }
    if (t.mateBot&&t.mateBot.alive&&st.allQuestsDone) {
      if (t.playerPos.distanceTo(t.mateBot.pos)<CFG.MATE_INTERACT_DIST+1) { st.power=Math.min(100,st.power+CFG.MATING_POWER_BONUS); st.phase='mated'; setUi({...st}); }
    }
  }, []);

  // ── JUMP HANDLER ─────────────────────────────────────
  const handleJump = useCallback(() => {
    const t = threeRef.current;
    if (!t) return;
    if (t.onGround) { t.playerVel.y = CFG.JUMP_FORCE; t.onGround = false; }
  }, []);

  // ── TOUCH: JOYSTICK ──────────────────────────────────
  const handleJoystickStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    joystickCenterRef.current = { id:touch.identifier, cx:rect.left+rect.width/2, cy:rect.top+rect.height/2 };
  }, []);
  const handleJoystickMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!joystickCenterRef.current) return;
    for (let i=0;i<e.changedTouches.length;i++) {
      const touch=e.changedTouches[i];
      if (touch.identifier!==joystickCenterRef.current.id) continue;
      const dx=touch.clientX-joystickCenterRef.current.cx, dy=touch.clientY-joystickCenterRef.current.cy;
      const maxR=42, dist=Math.sqrt(dx*dx+dy*dy);
      const nx=dist>maxR?dx/dist:dx/maxR, ny=dist>maxR?dy/dist:dy/maxR;
      touchMoveRef.current={x:nx,y:ny};
      setJoystickKnob({x:nx*maxR,y:ny*maxR});
      break;
    }
  }, []);
  const handleJoystickEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    for (let i=0;i<e.changedTouches.length;i++) {
      if (joystickCenterRef.current&&e.changedTouches[i].identifier===joystickCenterRef.current.id) {
        joystickCenterRef.current=null; touchMoveRef.current={x:0,y:0}; setJoystickKnob({x:0,y:0}); break;
      }
    }
  }, []);

  // ── TOUCH: CAMERA DRAG ───────────────────────────────
  const handleCamTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (camTouchRef.current) return;
    const touch=e.changedTouches[0];
    camTouchRef.current={id:touch.identifier,lastX:touch.clientX,lastY:touch.clientY};
  }, []);
  const handleCamTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!camTouchRef.current||!threeRef.current) return;
    for (let i=0;i<e.changedTouches.length;i++) {
      const touch=e.changedTouches[i];
      if (touch.identifier!==camTouchRef.current.id) continue;
      const dx=touch.clientX-camTouchRef.current.lastX, dy=touch.clientY-camTouchRef.current.lastY;
      const t=threeRef.current;
      t.camYaw-=dx*0.006;
      t.camPitch=Math.max(-0.2,Math.min(0.72,t.camPitch-dy*0.006));
      camTouchRef.current.lastX=touch.clientX; camTouchRef.current.lastY=touch.clientY;
      break;
    }
  }, []);
  const handleCamTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!camTouchRef.current) return;
    for (let i=0;i<e.changedTouches.length;i++) {
      if (e.changedTouches[i].identifier===camTouchRef.current.id) { camTouchRef.current=null; break; }
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
    touchMoveRef.current = {x:0,y:0};
    touchSprintRef.current = false;
    camTouchRef.current = null;
    joystickCenterRef.current = null;
    setJoystickKnob({x:0,y:0});
    setIsTouchSprinting(false);
    setShowQuests(false);
    setInteraction('');
    stateRef.current.phase = 'select';
    setUi({...stateRef.current, phase:'select'});
  }, []);

  // ── CLEANUP ───────────────────────────────────────────
  useEffect(() => {
    return () => { if (threeRef.current) { cancelAnimationFrame(threeRef.current.animFrame); threeRef.current.renderer.dispose(); } };
  }, []);

  // ═══════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════
  const phase = ui.phase;
  const aDef  = ANIMALS[ui.animal] || ANIMALS.deer;
  const questsDoneCount = ui.quests.filter(q=>q.done).length;

  return (
    <div id="batmos-root">
      <canvas id="game-canvas" ref={canvasRef} />

      {/* ── CAMERA DRAG ZONE (full screen, under HUD) ── */}
      {phase === 'playing' && (
        <div
          className="cam-drag-zone"
          onTouchStart={handleCamTouchStart}
          onTouchMove={handleCamTouchMove}
          onTouchEnd={handleCamTouchEnd}
          onTouchCancel={handleCamTouchEnd}
        />
      )}

      {/* ── CHARACTER SELECTION ─────────────────────── */}
      {phase === 'select' && (
        <div className="overlay select-overlay">
          <div className="select-panel">
            <div className="select-title">🌿 عالم البرية</div>
            <div className="select-subtitle">اختر حيوانك وابدأ رحلة البقاء</div>
            <div className="animal-grid">
              {(Object.keys(ANIMALS) as AnimalKey[]).map(key => {
                const a = ANIMALS[key];
                return (
                  <div key={key} className={`animal-card${selAnimal===key?' selected':''}`} onClick={() => setSelAnimal(key)}>
                    <div className="animal-icon">{a.icon}</div>
                    <div className="animal-name">{a.nameAr}</div>
                    <div className="animal-desc">{a.desc}</div>
                    <div className="animal-diet">{a.diet==='herb'?'🌿 عاشب':a.diet==='carn'?'🥩 لاحم':'🍃 كل الأطعمة'}</div>
                  </div>
                );
              })}
            </div>
            <div className="gender-row">
              <span className="gender-label">الجنس:</span>
              <button className={`gender-btn${selGender==='male'?' active':''}`} onClick={() => setSelGender('male')}>♂ ذكر</button>
              <button className={`gender-btn${selGender==='female'?' active':''}`} onClick={() => setSelGender('female')}>♀ أنثى</button>
            </div>
            {selAnimal && (
              <div className="animal-preview-bar">
                <span>{ANIMALS[selAnimal].icon} {ANIMALS[selAnimal].nameAr}</span>
                <span>السرعة: {'▮'.repeat(Math.round(ANIMALS[selAnimal].speed/2))}</span>
                <span>ارتفاع الرؤية: {ANIMALS[selAnimal].eyeH}م</span>
              </div>
            )}
            <button className="btn-start" onClick={() => startGame(selAnimal, selGender)}>🌿 ابدأ الرحلة</button>
          </div>
        </div>
      )}

      {/* ── IN-GAME HUD ──────────────────────────────── */}
      {phase === 'playing' && (
        <>
          <div className="hud">
            {/* Survival bars — top left */}
            <div className="survival-panel hud-panel">
              <div className="animal-id">{aDef.icon} {aDef.nameAr} — {ui.gender==='male'?'♂':'♀'}</div>
              <div className="bar-row">
                <span className="bar-label-txt">❤️ القوة</span>
                <div className="bar-track"><div className="bar-fill bar-power" style={{ width:`${ui.power}%`, background:ui.power<25?'#ff3333':ui.power<50?'#ffaa00':'#44dd44' }}/></div>
                <span className="bar-val">{Math.round(ui.power)}%</span>
              </div>
              <div className="bar-row">
                <span className="bar-label-txt">🍖 الجوع</span>
                <div className="bar-track"><div className="bar-fill" style={{ width:`${ui.hunger}%`, background:ui.hunger<20?'#ff6600':'#c8a030' }}/></div>
                <span className="bar-val">{Math.round(ui.hunger)}%</span>
              </div>
              <div className="bar-row">
                <span className="bar-label-txt">💧 العطش</span>
                <div className="bar-track"><div className="bar-fill" style={{ width:`${ui.thirst}%`, background:ui.thirst<20?'#ff6600':'#3399dd' }}/></div>
                <span className="bar-val">{Math.round(ui.thirst)}%</span>
              </div>
            </div>

            {/* Quest badge — top center */}
            <div className="quest-badge hud-panel">
              <span>📋 المهام: {questsDoneCount} / {ui.quests.length}</span>
              {ui.allQuestsDone && <span className="quest-done-badge">✅ جاهز للتزاوج!</span>}
            </div>

            {/* Timer — top right */}
            <div className="timer-panel hud-panel">⏱ {Math.floor(ui.elapsed/60)}:{String(Math.floor(ui.elapsed%60)).padStart(2,'0')}</div>

            {/* Interaction prompt */}
            {interaction && <div className="interact-prompt">{interaction}</div>}

            {/* Attack flash */}
            {ui.attackFlash > 0 && <div className="attack-vignette" style={{ opacity:ui.attackFlash*3 }}/>}

            {/* Warnings */}
            {ui.hunger < 15 && <div className="warn-banner warn-hunger">⚠️ أنت جائع جداً! ابحث عن غذاء</div>}
            {ui.thirst < 15 && !ui.hunger && <div className="warn-banner warn-thirst">⚠️ أنت عطشان جداً! ابحث عن ماء</div>}

            {/* Controls hint (keyboard) */}
            <div className="controls-hint">WASD · Shift ركض · Space قفز · F تفاعل · Q مهام</div>
          </div>

          {/* ── MINI COMPASS ─────────────────────────── */}
          <div className="mini-compass">
            <div className="compass-center-dot"/>
            {compassData.foodAngle !== null && (
              <div className="compass-indicator" style={{
                left:`calc(50% + ${Math.sin(compassData.foodAngle)*24}px)`,
                top:`calc(50% - ${Math.cos(compassData.foodAngle)*24}px)`,
              }}>🌿</div>
            )}
            {compassData.waterAngle !== null && (
              <div className="compass-indicator" style={{
                left:`calc(50% + ${Math.sin(compassData.waterAngle)*24}px)`,
                top:`calc(50% - ${Math.cos(compassData.waterAngle)*24}px)`,
              }}>💧</div>
            )}
            {compassData.mateAngle !== null && (
              <div className="compass-indicator" style={{
                left:`calc(50% + ${Math.sin(compassData.mateAngle)*24}px)`,
                top:`calc(50% - ${Math.cos(compassData.mateAngle)*24}px)`,
              }}>💛</div>
            )}
            <div className="compass-label-top">N</div>
          </div>

          {/* ── VIRTUAL JOYSTICK ─────────────────────── */}
          <div
            className="joystick-zone"
            onTouchStart={handleJoystickStart}
            onTouchMove={handleJoystickMove}
            onTouchEnd={handleJoystickEnd}
            onTouchCancel={handleJoystickEnd}
          >
            <div className="joystick-base">
              <div className="joystick-knob" style={{ transform:`translate(${joystickKnob.x}px, ${joystickKnob.y}px)` }}/>
            </div>
          </div>

          {/* ── ACTION BUTTONS ───────────────────────── */}
          <div className="action-buttons">
            <button
              className={`action-btn btn-sprint${isTouchSprinting?' active':''}`}
              onTouchStart={e => { e.preventDefault(); touchSprintRef.current=true; setIsTouchSprinting(true); }}
              onTouchEnd={e => { e.preventDefault(); touchSprintRef.current=false; setIsTouchSprinting(false); }}
              onTouchCancel={e => { e.preventDefault(); touchSprintRef.current=false; setIsTouchSprinting(false); }}
            ><span>🏃</span><span>ركض</span></button>
            <button
              className="action-btn btn-jump"
              onTouchStart={e => { e.preventDefault(); handleJump(); }}
            ><span>⬆️</span><span>قفز</span></button>
            <button
              className="action-btn btn-interact"
              onTouchStart={e => { e.preventDefault(); handleInteract(); }}
            ><span>🖐️</span><span>تفاعل</span></button>
            <button
              className="action-btn btn-quest"
              onPointerDown={() => setShowQuests(v => !v)}
            ><span>📋</span><span>مهام</span></button>
          </div>

          {/* Quest Panel */}
          {showQuests && (
            <div className="quest-panel">
              <div className="quest-panel-header">📋 مهام البقاء<button className="quest-close" onClick={() => setShowQuests(false)}>✕</button></div>
              <div className="quest-list">
                {ui.quests.map(q => (
                  <div key={q.id} className={`quest-item${q.done?' done':''}`}>
                    <span className="quest-status">{q.done?'✅':'⬜'}</span>
                    <div className="quest-text">
                      <div>{q.textAr}</div>
                      {!q.done && <div className="quest-prog-bar"><div className="quest-prog-fill" style={{ width:`${(q.progress/q.target)*100}%` }}/></div>}
                    </div>
                    <span className="quest-count">{q.done?'✓':`${Math.floor(q.progress)}/${q.target}`}</span>
                  </div>
                ))}
              </div>
              {ui.allQuestsDone && <div className="quest-panel-footer">💚 اقترب من الشريك الذهبي واضغط زر التفاعل!</div>}
            </div>
          )}
        </>
      )}

      {/* ── DEAD OVERLAY ─────────────────────────────── */}
      {phase === 'dead' && (
        <div className="overlay dead-overlay">
          <div className="overlay-title" style={{ color:'#ff4444' }}>💀 لقيت حتفك</div>
          <div className="overlay-sub">لم تستطع الصمود في عالم البرية</div>
          <div className="overlay-stats">
            <div>🕐 عشت: {Math.floor(ui.elapsed/60)}:{String(Math.floor(ui.elapsed%60)).padStart(2,'0')}</div>
            <div>📋 مهام أنجزت: {questsDoneCount} / {ui.quests.length}</div>
          </div>
          <button className="btn-restart" onClick={restart}>🔄 حاول مجدداً</button>
        </div>
      )}

      {/* ── MATED / WIN OVERLAY ──────────────────────── */}
      {phase === 'mated' && (
        <div className="overlay mated-overlay">
          <div className="mated-emoji">💚</div>
          <div className="overlay-title" style={{ color:'#44ff88' }}>تكوّنت الأسرة!</div>
          <div className="overlay-sub">لقد وجدت شريقك وكوّنتم أسرة في عالم البرية</div>
          <div className="mated-bonus">+{CFG.MATING_POWER_BONUS}% قوة 🎉</div>
          <div className="overlay-stats">
            <div>🐾 حيوانك: {aDef.nameAr} ({ui.gender==='male'?'ذكر':'أنثى'})</div>
            <div>⏱ الوقت: {Math.floor(ui.elapsed/60)}:{String(Math.floor(ui.elapsed%60)).padStart(2,'0')}</div>
          </div>
          <button className="btn-restart" onClick={restart}>🌿 رحلة جديدة</button>
        </div>
      )}
    </div>
  );
}
