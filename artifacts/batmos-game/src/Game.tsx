import React, { useState } from 'react';
import './index.css';

// ----------------------------------------------------------------------------
// GAME CONFIGURATION
// ----------------------------------------------------------------------------
const CONFIG = {
  GRID_SIZE: 8,           // Grid dimensions (GRID_SIZE x GRID_SIZE)
  TOTAL_PLAYERS: 10,      // 1 human + 9 AI
  INITIAL_HEALTH: 100,    // Starting HP for all players
  INITIAL_SHIELD: 0,      // Starting shield
  ZONE_SHRINK_EVERY: 3,   // Rounds before zone shrinks
  LOOT_SPAWN_EVERY: 2,    // Rounds between new loot box spawns
  LOOT_BOXES_PER_SPAWN: 2,// How many loot boxes appear each time
  INITIAL_LOOT_COUNT: 6,  // Loot boxes at game start
  WEAPONS: {
    pistol:  { name: 'مسدس',  damage: 20, range: 2, emoji: '🔫' },
    rifle:   { name: 'بندقية', damage: 35, range: 4, emoji: '🎯' },
    grenade: { name: 'قنبلة', damage: 50, range: 3, emoji: '💣' },
  },
  SHIELD_AMOUNT: 30,       // Shield HP granted by a shield item
  HEAL_AMOUNT: 40,         // HP restored by healing
  ZONE_DAMAGE: 15,         // Damage per turn for being outside safe zone
  AI_SHOOT_CHANCE: 0.6,    // Probability AI shoots when player is in range
  AI_MOVE_TO_PLAYER_CHANCE: 0.3, // Probability AI moves toward player
};

// ----------------------------------------------------------------------------
// TYPES & INTERFACES
// ----------------------------------------------------------------------------
type WeaponType = keyof typeof CONFIG.WEAPONS;
type Phase = 'menu' | 'playing' | 'gameover_win' | 'gameover_lose';

interface Player {
  id: string;
  isHuman: boolean;
  x: number;
  y: number;
  health: number;
  shield: number;
  weapon: WeaponType | null;
  healthKits: number;
  alive: boolean;
}

interface LootBox {
  id: string;
  x: number;
  y: number;
}

interface GameState {
  phase: Phase;
  round: number;
  zoneRadius: number;
  players: Player[];
  loot: LootBox[];
  logs: string[];
}

// ----------------------------------------------------------------------------
// GAME LOGIC HELPER FUNCTIONS
// ----------------------------------------------------------------------------
const cloneState = (state: GameState): GameState => JSON.parse(JSON.stringify(state));

const getEmptyPos = (players: Player[], loot: LootBox[]): { x: number, y: number } | null => {
  const available = [];
  for (let x = 0; x < CONFIG.GRID_SIZE; x++) {
    for (let y = 0; y < CONFIG.GRID_SIZE; y++) {
      const occupiedByPlayer = players.some(pl => pl.alive && pl.x === x && pl.y === y);
      const occupiedByLoot = loot.some(lt => lt.x === x && lt.y === y);
      if (!occupiedByPlayer && !occupiedByLoot) {
        available.push({ x, y });
      }
    }
  }
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
};

const getValidAdjacentMoves = (x: number, y: number, players: Player[]) => {
  const moves = [
    { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }
  ].filter(m => m.x >= 0 && m.x < CONFIG.GRID_SIZE && m.y >= 0 && m.y < CONFIG.GRID_SIZE);
  return moves.filter(m => !players.some(p => p.alive && p.x === m.x && p.y === m.y));
};

const applyLoot = (player: Player, addLog: ((msg: string) => void) | null) => {
  const r = Math.random();
  if (r < 0.4) {
    const wList = Object.keys(CONFIG.WEAPONS) as WeaponType[];
    const chosen = wList[Math.floor(Math.random() * wList.length)];
    player.weapon = chosen;
    if (addLog && player.isHuman) addLog(`وجدت ${CONFIG.WEAPONS[chosen].name}!`);
  } else if (r < 0.7) {
    player.shield = Math.min(60, player.shield + CONFIG.SHIELD_AMOUNT);
    if (addLog && player.isHuman) addLog(`وجدت درعاً! (+${CONFIG.SHIELD_AMOUNT})`);
  } else {
    player.healthKits += 1;
    if (addLog && player.isHuman) addLog("وجدت حقيبة إسعافات!");
  }
};

const createInitialState = (): GameState => {
  const players: Player[] = [];
  const loot: LootBox[] = [];

  for (let i = 0; i < CONFIG.TOTAL_PLAYERS; i++) {
    const pos = getEmptyPos(players, loot);
    if (!pos) break;
    players.push({
      id: i === 0 ? 'human' : `AI-${i}`,
      isHuman: i === 0,
      x: pos.x,
      y: pos.y,
      health: CONFIG.INITIAL_HEALTH,
      shield: CONFIG.INITIAL_SHIELD,
      weapon: null,
      healthKits: 0,
      alive: true
    });
  }

  for (let i = 0; i < CONFIG.INITIAL_LOOT_COUNT; i++) {
    const pos = getEmptyPos(players, loot);
    if (pos) {
      loot.push({ id: `loot-init-${i}`, x: pos.x, y: pos.y });
    }
  }

  return {
    phase: 'playing',
    round: 1,
    zoneRadius: 4.5,
    players,
    loot,
    logs: ["بدأت المعركة! ابق على قيد الحياة."]
  };
};

const processTurn = (
  state: GameState, 
  humanAction: (draft: GameState, human: Player, addLog: (msg: string) => void) => void
): GameState => {
  const draft = cloneState(state);
  const addLog = (msg: string) => draft.logs.push(msg);
  const human = draft.players.find(p => p.isHuman);
  
  if (!human || !human.alive) return draft;

  // 1. Execute Human Action
  humanAction(draft, human, addLog);

  // Preliminary death check before AI turns
  draft.players.forEach(p => { if (p.health <= 0) p.alive = false; });
  if (!human.alive) { draft.phase = 'gameover_lose'; return draft; }

  // 2. Execute AI Actions
  draft.players.filter(p => !p.isHuman && p.alive).forEach(ai => {
    if (!human.alive) return;
    const distToHuman = Math.max(Math.abs(ai.x - human.x), Math.abs(ai.y - human.y));
    const aiWeapon = ai.weapon ? CONFIG.WEAPONS[ai.weapon] : { damage: 8, range: 1 };

    if (distToHuman <= aiWeapon.range && Math.random() < CONFIG.AI_SHOOT_CHANCE) {
      // AI Shoots
      const dmg = Math.min(human.shield, aiWeapon.damage);
      human.shield -= dmg;
      human.health -= (aiWeapon.damage - dmg);
      addLog(`العدو ${ai.id.replace('AI-', '')} أطلق النار عليك وأصاب بـ ${aiWeapon.damage} ضرر!`);
      if (human.health <= 0) human.alive = false;
    } else if (Math.random() < CONFIG.AI_MOVE_TO_PLAYER_CHANCE) {
      // AI Moves towards human
      const moves = getValidAdjacentMoves(ai.x, ai.y, draft.players);
      if (moves.length > 0) {
        moves.sort((a, b) => {
          const dA = Math.max(Math.abs(a.x - human.x), Math.abs(a.y - human.y));
          const dB = Math.max(Math.abs(b.x - human.x), Math.abs(b.y - human.y));
          return dA - dB;
        });
        ai.x = moves[0].x;
        ai.y = moves[0].y;
      }
    } else {
      // AI Moves randomly
      const moves = getValidAdjacentMoves(ai.x, ai.y, draft.players);
      if (moves.length > 0) {
        const m = moves[Math.floor(Math.random() * moves.length)];
        ai.x = m.x;
        ai.y = m.y;
      }
    }

    // AI Loot Auto-Pickup
    const lIdx = draft.loot.findIndex(l => l.x === ai.x && l.y === ai.y);
    if (lIdx !== -1) {
      draft.loot.splice(lIdx, 1);
      applyLoot(ai, null); // AI silently loots
    }
  });

  // Death check after AI actions
  draft.players.forEach(p => { if (p.health <= 0) p.alive = false; });
  if (!human.alive) { draft.phase = 'gameover_lose'; return draft; }

  // 3. Increment Round
  draft.round++;

  // 4. Zone logic
  if (draft.round % CONFIG.ZONE_SHRINK_EVERY === 0) {
    draft.zoneRadius = Math.max(1, draft.zoneRadius - 1);
    addLog("المنطقة الآمنة تتقلص!");
    draft.players.filter(p => p.alive).forEach(p => {
      const distToCenter = Math.sqrt(Math.pow(p.x - 3.5, 2) + Math.pow(p.y - 3.5, 2));
      if (distToCenter > draft.zoneRadius) {
        const dmg = Math.min(p.shield, CONFIG.ZONE_DAMAGE);
        p.shield -= dmg;
        p.health -= (CONFIG.ZONE_DAMAGE - dmg);
        if (p.isHuman) addLog(`لقد تعرضت لـ ${CONFIG.ZONE_DAMAGE} ضرر من المنطقة الخطرة!`);
        if (p.health <= 0) p.alive = false;
      }
    });
  }

  // 5. Loot Spawn
  if (draft.round % CONFIG.LOOT_SPAWN_EVERY === 0) {
    let spawned = 0;
    for (let i = 0; i < CONFIG.LOOT_BOXES_PER_SPAWN; i++) {
      const pos = getEmptyPos(draft.players, draft.loot);
      if (pos) {
        draft.loot.push({ id: `loot-${draft.round}-${i}`, x: pos.x, y: pos.y });
        spawned++;
      }
    }
    if (spawned > 0) addLog("ظهرت صناديق غنائم جديدة!");
  }

  // 6. Final Death & Win Checks
  draft.players.forEach(p => { if (p.health <= 0) p.alive = false; });
  if (!human.alive) {
    draft.phase = 'gameover_lose';
  } else {
    const enemiesAlive = draft.players.filter(p => !p.isHuman && p.alive).length;
    if (enemiesAlive === 0) draft.phase = 'gameover_win';
  }

  // Keep last 6 logs
  if (draft.logs.length > 6) {
    draft.logs = draft.logs.slice(draft.logs.length - 6);
  }

  return draft;
};

// ----------------------------------------------------------------------------
// REACT COMPONENT
// ----------------------------------------------------------------------------
export default function Game() {
  const [gameState, setGameState] = useState<GameState>({
    phase: 'menu',
    round: 0,
    zoneRadius: 0,
    players: [],
    loot: [],
    logs: []
  });
  
  const [actionMode, setActionMode] = useState<'idle' | 'moving'>('idle');

  // --- Actions ---
  const handleCellClick = (x: number, y: number) => {
    if (actionMode !== 'moving') return;
    const human = gameState.players.find(p => p.isHuman);
    if (!human || !human.alive) return;
    
    const dist = Math.abs(human.x - x) + Math.abs(human.y - y);
    if (dist !== 1) return; // Must be strictly adjacent
    
    // Cannot move to an occupied cell
    if (gameState.players.some(p => p.alive && p.x === x && p.y === y)) return;
    
    const nextState = processTurn(gameState, (draft, h, addLog) => {
      h.x = x;
      h.y = y;
      const lIdx = draft.loot.findIndex(l => l.x === x && l.y === y);
      if (lIdx !== -1) {
        draft.loot.splice(lIdx, 1);
        applyLoot(h, addLog);
      }
    });
    
    setGameState(nextState);
    setActionMode('idle');
  };

  const handleSearch = () => {
    const nextState = processTurn(gameState, (draft, h, addLog) => {
      const lIdx = draft.loot.findIndex(l => l.x === h.x && l.y === h.y);
      if (lIdx !== -1) {
        draft.loot.splice(lIdx, 1);
        applyLoot(h, addLog);
      } else {
        addLog("لا يوجد شيء هنا");
      }
    });
    setGameState(nextState);
    setActionMode('idle');
  };

  const handleShoot = () => {
    const nextState = processTurn(gameState, (draft, h, addLog) => {
      const wRange = h.weapon ? CONFIG.WEAPONS[h.weapon].range : 1;
      const wDamage = h.weapon ? CONFIG.WEAPONS[h.weapon].damage : 10;
      
      let target: Player | null = null;
      let minDist = Infinity;
      
      draft.players.forEach(p => {
        if (p.isHuman || !p.alive) return;
        const dist = Math.max(Math.abs(p.x - h.x), Math.abs(p.y - h.y)); // Chebyshev
        if (dist <= wRange && dist < minDist) {
          minDist = dist;
          target = p;
        }
      });
      
      if (target) {
        const dmg = Math.min(target!.shield, wDamage);
        target!.shield -= dmg;
        target!.health -= (wDamage - dmg);
        addLog(`أطلقت النار على العدو ${target!.id.replace('AI-', '')} وأصبت بـ ${wDamage} ضرر!`);
        if (target!.health <= 0) target!.alive = false;
      } else {
        addLog("لا يوجد عدو في مدى السلاح!");
      }
    });
    setGameState(nextState);
    setActionMode('idle');
  };

  const handleHeal = () => {
    const human = gameState.players.find(p => p.isHuman);
    if (!human || human.healthKits <= 0 || human.health >= 100) return;

    const nextState = processTurn(gameState, (draft, h, addLog) => {
      h.healthKits -= 1;
      h.health = Math.min(100, h.health + CONFIG.HEAL_AMOUNT);
      addLog(`استخدمت حقيبة إسعافات! (+${CONFIG.HEAL_AMOUNT} صحة)`);
    });
    setGameState(nextState);
    setActionMode('idle');
  };

  // --- Screens ---
  if (gameState.phase === 'menu') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-background text-foreground font-sans" dir="rtl">
        <div className="max-w-md w-full p-10 border border-border bg-card rounded-2xl text-center shadow-2xl flex flex-col gap-8">
          <h1 className="text-6xl font-black text-primary tracking-tighter drop-shadow-md">بتموس</h1>
          <p className="text-muted-foreground text-lg leading-relaxed px-4">
            لعبة البقاء التكتيكية. حارب، ابحث عن الموارد، وابق داخل المنطقة الآمنة. 
          </p>
          <button 
            onClick={() => setGameState(createInitialState())} 
            className="w-full py-5 mt-4 bg-primary text-primary-foreground font-black text-2xl rounded-xl hover:bg-primary/90 transition-all shadow-[0_0_20px_rgba(40,120,60,0.4)] hover:shadow-[0_0_30px_rgba(40,120,60,0.6)] transform hover:-translate-y-1 active:translate-y-0">
            ابدأ اللعبة
          </button>
        </div>
      </div>
    );
  }

  if (gameState.phase === 'gameover_win' || gameState.phase === 'gameover_lose') {
    const isWin = gameState.phase === 'gameover_win';
    const enemiesLeft = gameState.players.filter(p => !p.isHuman && p.alive).length;
    const enemiesDefeated = (CONFIG.TOTAL_PLAYERS - 1) - enemiesLeft;
    
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-background text-foreground relative overflow-hidden font-sans" dir="rtl">
        <div className={`absolute inset-0 ${isWin ? 'bg-yellow-500/5' : 'bg-red-500/5'}`} />
        <div className="max-w-lg w-full p-10 border border-border bg-card/90 backdrop-blur-md rounded-2xl text-center shadow-2xl flex flex-col gap-8 relative z-10">
          <h1 className={`text-4xl sm:text-5xl font-black ${isWin ? 'text-yellow-500 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]' : 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]'}`}>
            {isWin ? '🏆 Winner Winner Chicken Dinner! 🏆' : '💀 Game Over 💀'}
          </h1>
          <h2 className="text-2xl font-bold text-foreground">
            {isWin ? 'أنت البطل!' : 'لقد سقطت في المعركة'}
          </h2>
          <div className="grid grid-cols-2 gap-4 my-4">
            <div className="p-4 bg-background/50 rounded-xl border border-border">
              <div className="text-sm text-muted-foreground mb-1 font-bold">الجولات</div>
              <div className="text-3xl font-mono text-primary font-bold">{gameState.round}</div>
            </div>
            <div className="p-4 bg-background/50 rounded-xl border border-border">
              <div className="text-sm text-muted-foreground mb-1 font-bold">الأعداء المهزومين</div>
              <div className="text-3xl font-mono text-primary font-bold">{enemiesDefeated}</div>
            </div>
          </div>
          <button 
            onClick={() => setGameState(createInitialState())} 
            className="w-full py-5 bg-primary text-primary-foreground font-black text-xl rounded-xl hover:bg-primary/90 transition-all shadow-lg transform hover:-translate-y-1 active:translate-y-0">
            العب مرة أخرى
          </button>
        </div>
      </div>
    );
  }

  // --- Main Game Rendering ---
  const human = gameState.players.find(p => p.isHuman);
  const enemiesAlive = gameState.players.filter(p => !p.isHuman && p.alive).length;
  const humanWeapon = human?.weapon ? CONFIG.WEAPONS[human.weapon] : null;
  const isShrinkRound = gameState.round > 1 && gameState.round % CONFIG.ZONE_SHRINK_EVERY === 0;

  const renderCell = (x: number, y: number) => {
    // Distance from center (3.5, 3.5)
    const distToCenter = Math.sqrt(Math.pow(x - 3.5, 2) + Math.pow(y - 3.5, 2));
    const isSafe = distToCenter <= gameState.zoneRadius;
    
    const p = gameState.players.find(pl => pl.alive && pl.x === x && pl.y === y);
    const l = gameState.loot.find(lt => lt.x === x && lt.y === y);
    
    let content = null;
    let isVisibleEnemy = false;
    
    if (p) {
      if (p.isHuman) content = '🟢';
      else {
        const distToHuman = human ? Math.max(Math.abs(p.x - human.x), Math.abs(p.y - human.y)) : 0;
        if (distToHuman <= 3) {
          content = '🔴';
          isVisibleEnemy = true;
        }
      }
    } else if (l) {
      content = '📦';
    }

    const isAdjacent = human && Math.abs(human.x - x) + Math.abs(human.y - y) === 1;
    const isValidMove = actionMode === 'moving' && isAdjacent && !p;

    let cellClass = "w-[44px] h-[44px] sm:w-[56px] sm:h-[56px] flex items-center justify-center text-xl sm:text-2xl transition-colors cursor-default select-none border ";
    
    if (isSafe) {
      cellClass += "bg-blue-500/10 border-blue-500/20 ";
    } else {
      cellClass += "bg-red-950/40 border-red-900/50 ";
    }
    
    if (isValidMove) {
      cellClass += "ring-2 ring-blue-400 ring-inset cursor-pointer hover:bg-blue-500/30 z-10 shadow-[inset_0_0_15px_rgba(96,165,250,0.4)] ";
    }
    
    return (
      <div 
        key={`${x}-${y}`} 
        className={cellClass} 
        onClick={() => isValidMove && handleCellClick(x, y)}
      >
        {content && (
          <span className={`transform transition-transform ${p?.isHuman ? 'drop-shadow-[0_0_10px_rgba(34,197,94,0.8)] scale-110' : isVisibleEnemy ? 'drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 'drop-shadow-[0_0_8px_rgba(234,179,8,0.8)]'}`}>
            {content}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col font-sans" dir="rtl">
      {/* Header */}
      <header className="border-b border-border bg-card p-4 flex justify-between items-center shadow-lg relative z-20">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-primary drop-shadow-sm">بتموس</h1>
        <div className="flex gap-4 sm:gap-6 text-sm sm:text-base font-bold bg-background/80 px-5 py-2 rounded-full border border-border shadow-inner">
          <span className="flex items-center gap-2">
            الجولة 
            <span className={`font-mono transition-all duration-300 ${isShrinkRound ? 'text-destructive scale-110 drop-shadow-[0_0_5px_rgba(239,68,68,0.5)]' : 'text-primary'}`}>
              {gameState.round}
            </span>
          </span>
          <div className="w-[1px] bg-border self-stretch" />
          <span className="flex items-center gap-2">
            الباقين 
            <span className="font-mono text-destructive drop-shadow-sm">
              {enemiesAlive + 1}
            </span>
          </span>
        </div>
      </header>
      
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 flex flex-col lg:flex-row gap-6 sm:gap-8 lg:items-start">
        
        {/* Map Area */}
        <div className="flex-1 bg-card border border-border rounded-2xl p-4 sm:p-6 shadow-xl flex justify-center items-center overflow-x-auto min-h-[400px]">
          <div className="grid grid-cols-8 gap-0.5 sm:gap-1 bg-background p-1.5 sm:p-2 rounded-xl border border-border/80 shadow-[0_0_20px_rgba(0,0,0,0.5)]">
            {Array.from({ length: CONFIG.GRID_SIZE * CONFIG.GRID_SIZE }).map((_, i) => 
              renderCell(i % CONFIG.GRID_SIZE, Math.floor(i / CONFIG.GRID_SIZE))
            )}
          </div>
        </div>
        
        {/* Sidebar Area */}
        <div className="w-full lg:w-96 flex flex-col gap-4 sm:gap-6 shrink-0">
          
          {/* Status Panel */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-xl">
            <h2 className="text-xs font-black text-muted-foreground mb-4 uppercase tracking-widest">حالتك</h2>
            <div className="space-y-5">
              <div>
                <div className="flex justify-between text-sm mb-1.5 font-bold">
                  <span>الصحة</span>
                  <span className="font-mono bg-background px-2 py-0.5 rounded border border-border">{human?.health ?? 0}/100</span>
                </div>
                <div className="h-4 w-full bg-background rounded-full overflow-hidden border border-border/80 shadow-inner">
                  <div 
                    className={`h-full transition-all duration-300 ${human && human.health > 50 ? 'bg-green-500' : human && human.health > 20 ? 'bg-yellow-500' : 'bg-red-500'}`} 
                    style={{ width: `${Math.max(0, human?.health ?? 0)}%` }} 
                  />
                </div>
              </div>
              
              <div>
                <div className="flex justify-between text-sm mb-1.5 font-bold">
                  <span>الدرع</span>
                  <span className="font-mono text-blue-400 bg-background px-2 py-0.5 rounded border border-border">{human?.shield ?? 0}</span>
                </div>
                <div className="h-4 w-full bg-background rounded-full overflow-hidden border border-border/80 shadow-inner">
                  <div 
                    className="h-full bg-blue-500 transition-all duration-300 shadow-[inset_0_0_8px_rgba(255,255,255,0.2)]" 
                    style={{ width: `${Math.min(100, ((human?.shield ?? 0) / 60) * 100)}%` }} 
                  />
                </div>
              </div>
              
              <div className="flex flex-col gap-3 pt-4 border-t border-border/50">
                <div className="flex justify-between items-center text-sm bg-background p-2.5 rounded-lg border border-border">
                  <span className="font-bold text-muted-foreground">السلاح</span>
                  <span className="font-bold">{humanWeapon ? humanWeapon.name : 'أيدي فارغة'}</span>
                </div>
                <div className="flex justify-between items-center text-sm bg-background p-2.5 rounded-lg border border-border">
                  <span className="font-bold text-muted-foreground">حقائب إسعافات</span>
                  <span className="font-mono font-bold text-green-400 text-base">{human?.healthKits ?? 0}</span>
                </div>
                <div className="flex justify-between items-center text-xs text-blue-400/80 px-2 mt-1">
                  <span>نصف قطر المنطقة الآمنة</span>
                  <span className="font-mono">{gameState.zoneRadius.toFixed(1)}</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Actions Panel */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-xl relative overflow-hidden">
            <h2 className="text-xs font-black text-muted-foreground mb-4 uppercase tracking-widest">الإجراءات</h2>
            <div className="grid grid-cols-2 gap-3 relative z-10">
              <button 
                onClick={() => setActionMode(p => p === 'moving' ? 'idle' : 'moving')}
                className={`p-4 rounded-xl border-2 font-bold transition-all shadow-sm flex flex-col items-center justify-center gap-1.5 ${actionMode === 'moving' ? 'bg-blue-500/20 border-blue-500 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'bg-background border-border hover:bg-muted text-foreground'}`}>
                <span className="text-lg">① تحرك</span>
              </button>
              
              <button 
                onClick={handleSearch}
                className="p-4 rounded-xl border-2 border-border bg-background hover:bg-muted text-foreground font-bold transition-all shadow-sm text-lg active:scale-95">
                ② بحث
              </button>
              
              <button 
                onClick={handleShoot}
                className="p-4 rounded-xl border-2 border-destructive/50 bg-destructive/10 hover:bg-destructive/20 text-destructive font-bold transition-all shadow-sm text-lg active:scale-95 hover:border-destructive">
                ③ إطلاق نار
              </button>
              
              <button 
                onClick={handleHeal}
                disabled={!human || human.healthKits === 0 || human.health >= 100}
                className="p-4 rounded-xl border-2 border-green-500/50 bg-green-500/10 hover:bg-green-500/20 text-green-500 disabled:opacity-30 disabled:border-border disabled:bg-background disabled:text-muted-foreground disabled:cursor-not-allowed font-bold transition-all shadow-sm text-lg active:scale-95 hover:border-green-500">
                ④ علاج
              </button>
            </div>
            {actionMode === 'moving' && (
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-blue-500 text-blue-50 text-xs font-bold text-center animate-in slide-in-from-bottom-full z-20">
                اختر مربعاً مجاوراً على الخريطة للتحرك إليه
              </div>
            )}
          </div>
          
          {/* Battle Logs */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-xl flex-1 flex flex-col min-h-[220px]">
            <h2 className="text-xs font-black text-muted-foreground mb-4 uppercase tracking-widest">سجل المعركة</h2>
            <div className="flex-1 flex flex-col justify-end gap-2.5 overflow-hidden text-sm">
              {gameState.logs.map((log, i) => {
                // Style important events differently
                let logClass = "text-foreground/90";
                if (log.includes("تتقلص")) logClass = "text-blue-400 font-bold";
                else if (log.includes("أطلق النار عليك") || log.includes("تعرضت")) logClass = "text-destructive font-bold";
                else if (log.includes("أطلقت النار على")) logClass = "text-orange-400 font-bold";
                else if (log.includes("وجدت") || log.includes("استخدمت")) logClass = "text-green-400 font-bold";

                return (
                  <div key={i} className="flex gap-3 items-start animate-in slide-in-from-right-4 fade-in duration-300 bg-background/50 p-2 rounded-lg border border-border/50">
                    <span className="text-primary mt-1 shadow-sm opacity-70 text-[10px]">▶</span>
                    <span className={`leading-snug ${logClass}`}>{log}</span>
                  </div>
                );
              })}
            </div>
          </div>
          
        </div>
      </main>
    </div>
  );
}
