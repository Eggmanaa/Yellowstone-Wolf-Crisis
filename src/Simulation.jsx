import { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import * as Tone from 'tone';

// ═══════════════════════════════════════════════════════════════════════════════
// YELLOWSTONE TROPHIC CASCADE — IMMERSIVE ECOSYSTEM SIMULATOR
// ═══════════════════════════════════════════════════════════════════════════════

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => a + (b - a) * t;

// Ideal-population score — used for species with a meaningful "ideal" count.
// At count=0: 0 pts (absence is bad).
// At count=ideal: max pts.
// At count=2×ideal: 0 pts (overpopulation cancels benefit).
// Beyond 2×ideal: gentle negative (overpop penalty, dragging down overall score).
function popScore(count, ideal, maxPts, overpopMult = 0.5) {
  if (count <= 0) return 0;
  if (count <= ideal) return (count / ideal) * maxPts;
  if (count <= ideal * 2) return (1 - (count - ideal) / ideal) * maxPts;
  return -((count - ideal * 2) / ideal) * maxPts * overpopMult;
}

// ─── Types ────────────────────────────────────────────────────────────────────
const WOLF = "wolf", ELK = "elk", TREE = "tree", BEAVER = "beaver",
  COYOTE = "coyote", FISH = "fish", BIRD = "bird", RABBIT = "rabbit",
  HUNTER = "hunter", BEAR = "bear";

// ─── Terrain constants (will be scaled to canvas size) ────────────────────────
const TERRAIN = {
  riverPct: 0.55,     // river at 55% from left
  riverBaseW: 22,
  mountainStartPct: 0.82,
};

// Meander curve — the river's centerline x at height y (deterministic).
// Gives the channel real bends instead of a ruler-straight band.
function riverXAt(W, y) {
  const RX = W * TERRAIN.riverPct;
  const amp = Math.min(26, W * 0.024);
  return RX + Math.sin(y * 0.0052 + 1.2) * amp + Math.sin(y * 0.0161 + 4.0) * amp * 0.35;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

function createEntity(type, x, y, W, H) {
  const RX = riverXAt(W, y ?? H * 0.5);
  const base = {
    id: Math.random().toString(36).slice(2, 9),
    type, x: x ?? 0, y: y ?? 0, age: 0, energy: 100, alive: true,
    vx: 0, vy: 0, targetX: null, targetY: null, state: "wander",
    stateTimer: 0,
  };
  switch (type) {
    case WOLF: return { ...base, x: x ?? rand(20, W * 0.8), y: y ?? rand(20, H - 20), speed: 1.8, energy: 120, maxEnergy: 150, huntCooldown: 0 };
    case ELK: return { ...base, x: x ?? rand(20, W * 0.48), y: y ?? rand(20, H - 20), speed: 1.4, maxEnergy: 120, grazeTimer: 0 };
    case TREE: return { ...base, x: x ?? rand(20, W * 0.78), y: y ?? rand(30, H - 20), growth: rand(0.3, 1), maxGrowth: 1, health: 100, speed: 0 };
    case BEAVER: return { ...base, x: x ?? RX + rand(-30, 30), y: y ?? rand(40, H - 40), speed: 0.6, maxEnergy: 100 };
    case COYOTE: return { ...base, x: x ?? rand(20, W * 0.8), y: y ?? rand(20, H - 20), speed: 1.5, maxEnergy: 100, huntCooldown: 0 };
    case FISH: return { ...base, x: x ?? RX + rand(-12, 12), y: y ?? rand(20, H - 20), speed: 1.0, maxEnergy: 80 };
    case BIRD: return { ...base, x: x ?? rand(W * 0.4, W * 0.78), y: y ?? rand(20, H - 20), speed: 2.0, maxEnergy: 60, flutterPhase: rand(0, Math.PI * 2) };
    case RABBIT: return { ...base, x: x ?? rand(20, W * 0.5), y: y ?? rand(20, H - 20), speed: 2.2, maxEnergy: 50 };
    case BEAR: return { ...base, x: x ?? rand(W * 0.3, W * 0.75), y: y ?? rand(20, H - 20), speed: 1.1, energy: 140, maxEnergy: 180, huntCooldown: 0 };
    case HUNTER: return { ...base, x: x ?? rand(10, 40), y: y ?? rand(40, H - 40), speed: 0.8, maxEnergy: 200, energy: 200, huntCooldown: 0, killCount: 0 };
    default: return base;
  }
}

function spawnMultiple(type, count, W, H) {
  return Array.from({ length: count }, () => createEntity(type, null, null, W, H));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function initEcosystem(W, H, mode = "noWolves") {
  if (mode === "noWolves") {
    // Default start: 1926 — wolves have been extirpated
    return {
      entities: [
        ...spawnMultiple(ELK, 65, W, H),
        ...spawnMultiple(TREE, 55, W, H),
        ...spawnMultiple(BEAVER, 3, W, H),
        ...spawnMultiple(COYOTE, 18, W, H),
        ...spawnMultiple(FISH, 12, W, H),
        ...spawnMultiple(BIRD, 8, W, H),
        ...spawnMultiple(RABBIT, 18, W, H),
        ...spawnMultiple(BEAR, 4, W, H),
      ],
      W, H, tick: 0, season: 0,
      vegetationHealth: 38, riverHealth: 42,
      riverWidth: TERRAIN.riverBaseW + 15,
      stats: { wolves: 0, elk: 65, trees: 55, beavers: 3, coyotes: 18, fish: 12, birds: 8, rabbits: 18, bears: 4, hunters: 0, vegetationHealth: 38, riverHealth: 42 },
      history: [], balanceScore: 22,
      particles: [],
    };
  }
  // "balanced" mode — full healthy ecosystem
  return {
    entities: [
      ...spawnMultiple(WOLF, 12, W, H),
      ...spawnMultiple(ELK, 45, W, H),
      ...spawnMultiple(TREE, 90, W, H),
      ...spawnMultiple(BEAVER, 8, W, H),
      ...spawnMultiple(COYOTE, 10, W, H),
      ...spawnMultiple(FISH, 22, W, H),
      ...spawnMultiple(BIRD, 15, W, H),
      ...spawnMultiple(RABBIT, 28, W, H),
      ...spawnMultiple(BEAR, 6, W, H),
    ],
    W, H, tick: 0, season: 0,
    vegetationHealth: 85, riverHealth: 90,
    riverWidth: TERRAIN.riverBaseW,
    stats: { wolves: 12, elk: 45, trees: 90, beavers: 8, coyotes: 10, fish: 22, birds: 15, rabbits: 28, bears: 6, hunters: 0, vegetationHealth: 85, riverHealth: 90 },
    history: [], balanceScore: 75,
    particles: [],
  };
}

// Scenario-specific ecosystem initialization — each scenario starts visibly different.
// This gives the player a clear sense that "the situation here is different" the moment
// they click a scenario card.
function initScenarioEcosystem(W, H, scenarioId) {
  if (scenarioId === "reintro") {
    // 1995: overrun, degraded, wolves gone, elk everywhere, few trees, coyote boom
    return {
      entities: [
        ...spawnMultiple(ELK, 75, W, H),
        ...spawnMultiple(TREE, 22, W, H),
        ...spawnMultiple(BEAVER, 2, W, H),
        ...spawnMultiple(COYOTE, 24, W, H),
        ...spawnMultiple(FISH, 8, W, H),
        ...spawnMultiple(BIRD, 5, W, H),
        ...spawnMultiple(RABBIT, 14, W, H),
        ...spawnMultiple(BEAR, 3, W, H),
      ],
      W, H, tick: 0, season: 0,
      vegetationHealth: 28, riverHealth: 35,
      riverWidth: TERRAIN.riverBaseW + 18, // wide, eroded banks
      stats: { wolves: 0, elk: 75, trees: 22, beavers: 2, coyotes: 24, fish: 8, birds: 5, rabbits: 14, bears: 3, hunters: 0, vegetationHealth: 28, riverHealth: 35 },
      history: [], balanceScore: 18, particles: [],
    };
  }
  if (scenarioId === "cwd") {
    // 2024: superficially healthy, wolves balanced, but elk crowded
    return {
      entities: [
        ...spawnMultiple(WOLF, 10, W, H),
        ...spawnMultiple(ELK, 55, W, H), // heavy herd, CWD risk
        ...spawnMultiple(TREE, 70, W, H),
        ...spawnMultiple(BEAVER, 7, W, H),
        ...spawnMultiple(COYOTE, 9, W, H),
        ...spawnMultiple(FISH, 18, W, H),
        ...spawnMultiple(BIRD, 12, W, H),
        ...spawnMultiple(RABBIT, 22, W, H),
        ...spawnMultiple(BEAR, 5, W, H),
      ],
      W, H, tick: 0, season: 0,
      vegetationHealth: 70, riverHealth: 80,
      riverWidth: TERRAIN.riverBaseW + 4,
      stats: { wolves: 10, elk: 55, trees: 70, beavers: 7, coyotes: 9, fish: 18, birds: 12, rabbits: 22, bears: 5, hunters: 0, vegetationHealth: 70, riverHealth: 80 },
      history: [], balanceScore: 60, particles: [],
    };
  }
  if (scenarioId === "drought") {
    // 2021: dry, stressed, narrow river, brittle vegetation, few fish
    return {
      entities: [
        ...spawnMultiple(ELK, 35, W, H),
        ...spawnMultiple(TREE, 30, W, H),
        ...spawnMultiple(BEAVER, 3, W, H),
        ...spawnMultiple(COYOTE, 12, W, H),
        ...spawnMultiple(FISH, 5, W, H), // collapsing
        ...spawnMultiple(BIRD, 6, W, H),
        ...spawnMultiple(RABBIT, 10, W, H),
        ...spawnMultiple(BEAR, 2, W, H),
      ],
      W, H, tick: 0, season: 0,
      vegetationHealth: 18, riverHealth: 22, // severely stressed
      riverWidth: Math.max(6, TERRAIN.riverBaseW - 8), // visibly narrow
      stats: { wolves: 0, elk: 35, trees: 30, beavers: 3, coyotes: 12, fish: 5, birds: 6, rabbits: 10, bears: 2, hunters: 0, vegetationHealth: 18, riverHealth: 22 },
      history: [], balanceScore: 22, particles: [],
    };
  }
  if (scenarioId === "poaching") {
    // 2008: healthy but actively under attack — hunters already in park
    const entities = [
      ...spawnMultiple(WOLF, 8, W, H),
      ...spawnMultiple(ELK, 45, W, H),
      ...spawnMultiple(TREE, 80, W, H),
      ...spawnMultiple(BEAVER, 8, W, H),
      ...spawnMultiple(COYOTE, 10, W, H),
      ...spawnMultiple(FISH, 20, W, H),
      ...spawnMultiple(BIRD, 14, W, H),
      ...spawnMultiple(RABBIT, 24, W, H),
      ...spawnMultiple(BEAR, 5, W, H),
    ];
    // Seed 5 hunters from the start — visually alarming
    for (let i = 0; i < 5; i++) entities.push(createEntity(HUNTER, null, null, W, H));
    return {
      entities, W, H, tick: 0, season: 0,
      vegetationHealth: 75, riverHealth: 85,
      riverWidth: TERRAIN.riverBaseW,
      stats: { wolves: 8, elk: 45, trees: 80, beavers: 8, coyotes: 10, fish: 20, birds: 14, rabbits: 24, bears: 5, hunters: 5, vegetationHealth: 75, riverHealth: 85 },
      history: [], balanceScore: 65, particles: [],
    };
  }
  if (scenarioId === "tourism") {
    // 2019: healthy ecosystem, but corridor region is empty of wolves/bears
    const corridorX = W * 0.40;
    const corridorW = W * 0.15;
    const inCorridor = (x) => Math.abs(x - corridorX) < corridorW / 2;
    const entities = [];
    // Place species but avoid corridor for wolves/bears
    for (let i = 0; i < 6; i++) {
      let e;
      do { e = createEntity(WOLF, null, null, W, H); } while (inCorridor(e.x));
      entities.push(e);
    }
    for (let i = 0; i < 4; i++) {
      let e;
      do { e = createEntity(BEAR, null, null, W, H); } while (inCorridor(e.x));
      entities.push(e);
    }
    entities.push(
      ...spawnMultiple(ELK, 42, W, H),
      ...spawnMultiple(TREE, 78, W, H),
      ...spawnMultiple(BEAVER, 7, W, H),
      ...spawnMultiple(COYOTE, 11, W, H),
      ...spawnMultiple(FISH, 18, W, H),
      ...spawnMultiple(BIRD, 13, W, H),
      ...spawnMultiple(RABBIT, 22, W, H),
    );
    return {
      entities, W, H, tick: 0, season: 0,
      vegetationHealth: 72, riverHealth: 82,
      riverWidth: TERRAIN.riverBaseW,
      stats: { wolves: 6, elk: 42, trees: 78, beavers: 7, coyotes: 11, fish: 18, birds: 13, rabbits: 22, bears: 4, hunters: 0, vegetationHealth: 72, riverHealth: 82 },
      history: [], balanceScore: 62, particles: [],
    };
  }
  // Fallback
  return initEcosystem(W, H, "noWolves");
}

function findNearest(e, entities, type, maxD = 999) {
  let best = null, bestD = maxD;
  for (const o of entities) {
    if (o.type !== type || !o.alive || o.id === e.id) continue;
    const d = dist(e, o);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

function moveToward(e, tx, ty, speed) {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  if (d < 2) return;
  e.vx = (dx / d) * speed;
  e.vy = (dy / d) * speed;
}

function wander(e, W, H) {
  e.stateTimer--;
  if (e.stateTimer <= 0 || !e.targetX) {
    e.targetX = clamp(e.x + rand(-120, 120), 15, W - 15);
    e.targetY = clamp(e.y + rand(-100, 100), 15, H - 15);
    e.stateTimer = randInt(60, 180);
  }
  moveToward(e, e.targetX, e.targetY, e.speed * 0.4);
}

function updateWolf(w, eco) {
  w.energy -= 0.15;
  w.huntCooldown = Math.max(0, w.huntCooldown - 1);
  const hunter = findNearest(w, eco.entities, HUNTER, 110);
  if (hunter) {
    const dx = w.x - hunter.x, dy = w.y - hunter.y, d = Math.hypot(dx, dy) || 1;
    w.vx = (dx / d) * w.speed * 1.6;
    w.vy = (dy / d) * w.speed * 1.6;
    w.state = "flee"; return;
  }
  if (w.energy < 65 && w.huntCooldown <= 0) {
    const prey = findNearest(w, eco.entities, ELK, 160);
    if (prey) {
      w.state = "chase";
      moveToward(w, prey.x, prey.y, w.speed);
      if (dist(w, prey) < 14) {
        prey.alive = false; prey.state = "dead";
        w.energy = Math.min(w.maxEnergy, w.energy + 60);
        w.huntCooldown = 120; w.state = "wander";
        eco.particles.push({ type: "kill", x: prey.x, y: prey.y, color: "#ef4444", icon: "💀", age: 0, maxAge: 90 });
      }
      return;
    }
    const coy = findNearest(w, eco.entities, COYOTE, 90);
    if (coy) {
      moveToward(w, coy.x, coy.y, w.speed * 0.8);
      if (dist(w, coy) < 16) { coy.energy -= 30; w.huntCooldown = 60; }
      return;
    }
  }
  w.state = "wander";
  wander(w, eco.W, eco.H);

  // Howl behavior — when pack is nearby, occasionally trigger howl pose
  if (w.howling) {
    w.howling--;
    if (w.howling <= 0) w.howling = 0;
  } else if (Math.random() < 0.002) {
    // Check pack presence — at least 2 other wolves within 80px
    let packNearby = 0;
    for (const o of eco.entities) {
      if (o.type === WOLF && o.alive && o.id !== w.id && dist(w, o) < 80) packNearby++;
      if (packNearby >= 2) break;
    }
    if (packNearby >= 2) w.howling = 180; // howl for ~3 seconds at 60fps
  }

  // Dynamic reproduction: more wolves = more breeding, but density-limited
  if (w.energy > 100 && Math.random() < 0.003) {
    const cnt = eco.entities.filter(e => e.type === WOLF && e.alive).length;
    const elkCnt = eco.entities.filter(e => e.type === ELK && e.alive).length;
    // Wolves reproduce more when prey is abundant, less when overcrowded
    const preyRatio = clamp(elkCnt / 30, 0.2, 2.0);
    const densityFactor = clamp(1.5 - cnt / 25, 0.1, 1.5);
    if (cnt < 50 && Math.random() < preyRatio * densityFactor) {
      eco.entities.push(createEntity(WOLF, w.x + rand(-20, 20), w.y + rand(-20, 20), eco.W, eco.H));
      w.energy -= 40;
      eco.particles.push({ type: "birth", x: w.x, y: w.y, color: "#94a3b8", icon: "🐺", age: 0, maxAge: 80 });
      // Pup birth narration — NarratorManager cooldown (20s/insight) prevents spam
      narrator.speak("pup_birth", "A new litter of pups has been born.", "event_pup_birth_0.mp3");
    }
  }
}

function updateElk(elk, eco) {
  elk.energy -= 0.08;
  elk.grazeTimer = Math.max(0, elk.grazeTimer - 1);
  const wolf = findNearest(elk, eco.entities, WOLF, 130);
  if (wolf) {
    const dx = elk.x - wolf.x, dy = elk.y - wolf.y, d = Math.hypot(dx, dy) || 1;
    elk.vx = (dx / d) * elk.speed * 1.4;
    elk.vy = (dy / d) * elk.speed * 1.4;
    elk.state = "flee"; return;
  }
  if (elk.energy < 85 && elk.grazeTimer <= 0) {
    const tree = findNearest(elk, eco.entities, TREE, 70);
    if (tree && tree.growth > 0.2) {
      elk.state = "graze";
      moveToward(elk, tree.x, tree.y, elk.speed * 0.5);
      if (dist(elk, tree) < 16) {
        tree.growth -= 0.012; tree.health -= 0.35;
        elk.energy = Math.min(elk.maxEnergy, elk.energy + 2);
        elk.grazeTimer = 10; eco.vegetationHealth -= 0.012;
        if (Math.random() < 0.08) eco.particles.push({ type: "growth", x: tree.x, y: tree.y - 10, color: "#854d0e", icon: "🍂", age: 20, maxAge: 70 });
      }
      return;
    }
  }
  elk.state = "wander";
  wander(elk, eco.W, eco.H);
  // Dynamic reproduction: elk breed faster with more elk and less predation, but density-limited
  if (elk.energy > 80 && Math.random() < 0.005) {
    const cnt = eco.entities.filter(e => e.type === ELK && e.alive).length;
    const wolfCnt = eco.entities.filter(e => e.type === WOLF && e.alive).length;
    // Elk reproduce faster without wolves (no fear effect), slower when overcrowded
    const fearFactor = wolfCnt < 3 ? 2.0 : wolfCnt < 8 ? 1.3 : 0.8;
    const densityFactor = clamp(1.8 - cnt / 60, 0.1, 2.0);
    const vegFactor = clamp(eco.vegetationHealth / 50, 0.3, 1.5); // need food to breed
    if (cnt < 150 && Math.random() < fearFactor * densityFactor * vegFactor) {
      eco.entities.push(createEntity(ELK, elk.x + rand(-20, 20), elk.y + rand(-20, 20), eco.W, eco.H));
      elk.energy -= 30;
      eco.particles.push({ type: "birth", x: elk.x, y: elk.y, color: "#a78bfa", icon: "🦌", age: 0, maxAge: 80 });
    }
  }
}

function updateTree(tree, eco) {
  if (tree.health <= 0) { tree.alive = false; return; }
  const vf = eco.vegetationHealth / 100;
  tree.growth = clamp(tree.growth + 0.0008 * vf, 0, tree.maxGrowth);
  tree.health = clamp(tree.health + 0.03, 0, 100);
  // Dynamic reproduction: more mature trees = more seed dispersal, density-limited
  if (tree.growth > 0.7 && Math.random() < 0.0012 * vf) {
    const cnt = eco.entities.filter(e => e.type === TREE && e.alive).length;
    const matureTrees = eco.entities.filter(e => e.type === TREE && e.alive && e.growth > 0.6).length;
    const seedFactor = clamp(matureTrees / 30, 0.3, 2.0);
    const elkCnt = eco.entities.filter(e => e.type === ELK && e.alive).length;
    const browsePressure = clamp(1.5 - elkCnt / 50, 0.2, 1.5); // heavy elk = fewer saplings survive
    if (cnt < 160 && Math.random() < seedFactor * browsePressure) {
      eco.entities.push(createEntity(TREE, tree.x + rand(-50, 50), tree.y + rand(-50, 50), eco.W, eco.H));
      eco.particles.push({ type: "growth", x: tree.x, y: tree.y, color: "#22c55e", icon: "🌱", age: 0, maxAge: 100 });
    }
  }
}

function updateBeaver(b, eco) {
  b.energy -= 0.05;
  const RX = riverXAt(eco.W, b.y);
  const nearRiver = Math.abs(b.x - RX) < 40;
  if (Math.abs(b.x - RX) > 60) moveToward(b, RX + rand(-25, 25), b.y + rand(-30, 30), b.speed);
  else wander(b, eco.W, eco.H);
  const tree = findNearest(b, eco.entities, TREE, 90);
  if (tree && tree.growth > 0.5) eco.riverHealth = clamp(eco.riverHealth + 0.006, 0, 100);

  // Tail-slap animation timer — fires occasionally when beaver is by the river
  if (b.tailSlap && b.tailSlap > 0) {
    b.tailSlap--;
  } else if (nearRiver && Math.random() < 0.003) {
    b.tailSlap = 30; // 0.5 second slap animation
  }
  // Dynamic reproduction: beavers breed when willows available, more beavers = more breeding (colony effect)
  if (b.energy > 60 && Math.random() < 0.0025) {
    const tc = eco.entities.filter(e => e.type === TREE && e.alive && e.growth > 0.4).length;
    const bc = eco.entities.filter(e => e.type === BEAVER && e.alive).length;
    const colonyFactor = clamp(bc / 4, 0.5, 1.8); // colony effect — more beavers = better breeding success
    const willowFactor = clamp(tc / 25, 0.2, 2.0);
    if (tc > 15 && bc < 25 && Math.random() < colonyFactor * willowFactor) {
      eco.entities.push(createEntity(BEAVER, b.x + rand(-15, 15), b.y + rand(-15, 15), eco.W, eco.H));
      b.energy -= 25;
      eco.particles.push({ type: "birth", x: b.x, y: b.y, color: "#fb923c", icon: "🦫", age: 0, maxAge: 80 });
    }
  }
}

function updateCoyote(c, eco) {
  c.energy -= 0.1;
  c.huntCooldown = Math.max(0, c.huntCooldown - 1);
  const wolf = findNearest(c, eco.entities, WOLF, 85);
  if (wolf) {
    const dx = c.x - wolf.x, dy = c.y - wolf.y, d = Math.hypot(dx, dy) || 1;
    c.vx = (dx / d) * c.speed * 1.3;
    c.vy = (dy / d) * c.speed * 1.3;
    c.state = "flee"; return;
  }
  if (c.energy < 70 && c.huntCooldown <= 0) {
    const r = findNearest(c, eco.entities, RABBIT, 110);
    if (r) {
      c.state = "chase";
      moveToward(c, r.x, r.y, c.speed);
      if (dist(c, r) < 11) { r.alive = false; c.energy = Math.min(c.maxEnergy, c.energy + 35); c.huntCooldown = 80; }
      return;
    }
  }
  c.state = "wander";
  wander(c, eco.W, eco.H);
  // Dynamic reproduction: coyotes boom without wolves (mesopredator release), density-scaled
  const wc = eco.entities.filter(e => e.type === WOLF && e.alive).length;
  const baseRate = wc < 3 ? 0.008 : wc < 8 ? 0.004 : 0.002;
  if (c.energy > 60 && Math.random() < baseRate) {
    const cnt = eco.entities.filter(e => e.type === COYOTE && e.alive).length;
    const cap = wc < 3 ? 45 : wc < 8 ? 20 : 14;
    const densityFactor = clamp(1.5 - cnt / (cap * 0.7), 0.1, 2.0);
    const rabbitCnt = eco.entities.filter(e => e.type === RABBIT && e.alive).length;
    const preyFactor = clamp(rabbitCnt / 15, 0.3, 1.5);
    if (cnt < cap && Math.random() < densityFactor * preyFactor) {
      eco.entities.push(createEntity(COYOTE, c.x + rand(-20, 20), c.y + rand(-20, 20), eco.W, eco.H));
      c.energy -= 25;
      eco.particles.push({ type: "birth", x: c.x, y: c.y, color: "#d97706", icon: "🐾", age: 0, maxAge: 80 });
    }
  }
}

function updateFish(f, eco) {
  f.energy -= 0.04;
  const RX = riverXAt(eco.W, f.y);
  const rw = eco.riverWidth;
  f.x = clamp(f.x + rand(-1.2, 1.2), RX - rw / 2 + 3, RX + rw / 2 - 3);
  f.y = clamp(f.y + rand(-1.8, 1.8), 5, eco.H - 5);
  // Dynamic reproduction: fish breed based on river health and population density
  const fishHealth = eco.riverHealth / 100;
  if (fishHealth > 0.4 && Math.random() < 0.004 * fishHealth) {
    const cnt = eco.entities.filter(e => e.type === FISH && e.alive).length;
    const densityFactor = clamp(1.6 - cnt / 25, 0.1, 2.0);
    const spawnFactor = clamp(cnt / 8, 0.3, 1.5); // need enough fish to find mates
    if (cnt < 45 && Math.random() < densityFactor * spawnFactor) {
      eco.entities.push(createEntity(FISH, f.x, f.y + rand(-10, 10), eco.W, eco.H));
      eco.particles.push({ type: "birth", x: f.x, y: f.y, color: "#67e8f9", icon: "🐟", age: 0, maxAge: 60 });
    }
  }
}

function updateBird(b, eco) {
  b.energy -= 0.04;
  b.flutterPhase += 0.12;
  const tree = findNearest(b, eco.entities, TREE, 130);
  if (tree && tree.growth > 0.5) {
    moveToward(b, tree.x + Math.sin(b.flutterPhase) * 25, tree.y - 12, b.speed * 0.3);
    b.energy = Math.min(b.maxEnergy, b.energy + 0.1);
  } else { wander(b, eco.W, eco.H); b.energy -= 0.05; }
  // Dynamic reproduction: birds breed based on tree availability, more birds = more breeding pairs
  const tc = eco.entities.filter(e => e.type === TREE && e.alive && e.growth > 0.5).length;
  if (b.energy > 35 && tc > 15 && Math.random() < 0.0025) {
    const cnt = eco.entities.filter(e => e.type === BIRD && e.alive).length;
    const nestFactor = clamp(tc / 25, 0.3, 2.0);
    const pairFactor = clamp(cnt / 6, 0.3, 1.5); // need enough birds to find mates
    const densityFactor = clamp(1.5 - cnt / 25, 0.1, 1.8);
    if (cnt < 40 && Math.random() < nestFactor * pairFactor * densityFactor) {
      eco.entities.push(createEntity(BIRD, b.x + rand(-20, 20), b.y + rand(-20, 20), eco.W, eco.H));
      b.energy -= 15;
      eco.particles.push({ type: "birth", x: b.x, y: b.y, color: "#fbbf24", icon: "🐦", age: 0, maxAge: 60 });
    }
  }
}

function updateRabbit(r, eco) {
  r.energy -= 0.06;
  const coy = findNearest(r, eco.entities, COYOTE, 65);
  if (coy) {
    const dx = r.x - coy.x, dy = r.y - coy.y, d = Math.hypot(dx, dy) || 1;
    r.vx = (dx / d) * r.speed; r.vy = (dy / d) * r.speed;
    r.state = "flee"; return;
  }
  r.state = "wander";
  wander(r, eco.W, eco.H);
  r.energy = Math.min(r.maxEnergy, r.energy + 0.05);
  // Dynamic reproduction: rabbits are prolific breeders, density and vegetation dependent
  if (r.energy > 30 && Math.random() < 0.007) {
    const cnt = eco.entities.filter(e => e.type === RABBIT && e.alive).length;
    const densityFactor = clamp(2.0 - cnt / 35, 0.1, 2.5);
    const vegFactor = clamp(eco.vegetationHealth / 40, 0.3, 1.5);
    const breedBoost = clamp(cnt / 10, 0.5, 1.8); // more rabbits = more encounters
    if (cnt < 80 && Math.random() < densityFactor * vegFactor * breedBoost) {
      eco.entities.push(createEntity(RABBIT, r.x + rand(-15, 15), r.y + rand(-15, 15), eco.W, eco.H));
      r.energy -= 15;
      eco.particles.push({ type: "birth", x: r.x, y: r.y, color: "#d1d5db", icon: "🐰", age: 0, maxAge: 60 });
    }
  }
}

function updateBear(bear, eco) {
  bear.energy -= 0.09;
  bear.huntCooldown = Math.max(0, bear.huntCooldown - 1);

  // Bears fish when near river
  const RX = eco.W * TERRAIN.riverPct;
  if (Math.abs(bear.x - RX) < 50 && bear.huntCooldown <= 0) {
    const fish = findNearest(bear, eco.entities, FISH, 40);
    if (fish && bear.energy < 120) {
      moveToward(bear, fish.x, fish.y, bear.speed * 0.8);
      if (dist(bear, fish) < 18) {
        fish.alive = false;
        bear.energy = Math.min(bear.maxEnergy, bear.energy + 30);
        bear.huntCooldown = 80;
        eco.particles.push({ type: "kill", x: fish.x, y: fish.y, color: "#67e8f9", icon: "🐟", age: 0, maxAge: 60 });
        return;
      }
      return;
    }
  }

  // Bears forage from vegetation (berries) when hungry
  if (bear.energy < 100 && eco.vegetationHealth > 30) {
    const tree = findNearest(bear, eco.entities, TREE, 80);
    if (tree && tree.growth > 0.6) {
      moveToward(bear, tree.x, tree.y, bear.speed * 0.5);
      if (dist(bear, tree) < 20) {
        bear.energy = Math.min(bear.maxEnergy, bear.energy + 1.5);
        // Bears don't damage trees as much as elk — they eat berries, not bark
        tree.growth -= 0.002;
      }
      return;
    }
  }

  // Bears avoid wolves in groups but occasionally contest kills
  const wolf = findNearest(bear, eco.entities, WOLF, 60);
  if (wolf) {
    const wolfCount = eco.entities.filter(e => e.type === WOLF && e.alive && dist(bear, e) < 80).length;
    if (wolfCount >= 3) {
      // Flee from wolf packs
      const dx = bear.x - wolf.x, dy = bear.y - wolf.y, d = Math.hypot(dx, dy) || 1;
      bear.vx = (dx / d) * bear.speed; bear.vy = (dy / d) * bear.speed;
      bear.state = "flee"; return;
    }
  }

  bear.state = "wander";
  wander(bear, eco.W, eco.H);

  // Dynamic reproduction: bears breed slowly, need good food supply
  if (bear.energy > 140 && Math.random() < 0.0015) {
    const cnt = eco.entities.filter(e => e.type === BEAR && e.alive).length;
    const foodScore = (eco.vegetationHealth / 100) * 0.5 + (eco.riverHealth / 100) * 0.5;
    const densityFactor = clamp(1.3 - cnt / 10, 0.1, 1.3);
    if (cnt < 18 && Math.random() < foodScore * densityFactor) {
      eco.entities.push(createEntity(BEAR, bear.x + rand(-25, 25), bear.y + rand(-25, 25), eco.W, eco.H));
      bear.energy -= 50;
      eco.particles.push({ type: "birth", x: bear.x, y: bear.y, color: "#92400e", icon: "🐻", age: 0, maxAge: 80 });
    }
  }
}

function updateHunter(h, eco) {
  h.huntCooldown = Math.max(0, h.huntCooldown - 1);
  if (h.huntCooldown <= 0) {
    const wolf = findNearest(h, eco.entities, WOLF, 190);
    if (wolf) {
      h.state = "chase";
      moveToward(h, wolf.x, wolf.y, h.speed);
      if (dist(h, wolf) < 28) { wolf.alive = false; h.huntCooldown = 200; h.killCount++; return; }
      return;
    }
    const elk = findNearest(h, eco.entities, ELK, 160);
    if (elk && Math.random() < 0.3) {
      h.state = "chase";
      moveToward(h, elk.x, elk.y, h.speed);
      if (dist(h, elk) < 22) { elk.alive = false; h.huntCooldown = 150; h.killCount++; }
      return;
    }
  }
  h.state = "wander";
  wander(h, eco.W, eco.H);
}

function tickEcosystem(eco) {
  eco.tick++;
  // Season increments every 1800 ticks = 30s at 60fps.
  // Full year = 4 seasons = 2 minutes. A 10-min game shows 5 full years.
  if (eco.tick % 1800 === 0) eco.season++;
  const { W, H } = eco;

  for (const e of eco.entities) {
    if (!e.alive) continue;
    switch (e.type) {
      case WOLF: updateWolf(e, eco); break;
      case ELK: updateElk(e, eco); break;
      case TREE: updateTree(e, eco); break;
      case BEAVER: updateBeaver(e, eco); break;
      case COYOTE: updateCoyote(e, eco); break;
      case FISH: updateFish(e, eco); break;
      case BIRD: updateBird(e, eco); break;
      case RABBIT: updateRabbit(e, eco); break;
      case BEAR: updateBear(e, eco); break;
      case HUNTER: updateHunter(e, eco); break;
    }
    if (e.speed > 0 && e.type !== TREE) {
      e.x = clamp(e.x + e.vx, 5, W - 5);
      e.y = clamp(e.y + e.vy, 5, H - 5);
      e.vx *= 0.92; e.vy *= 0.92;
    }
    if (e.energy <= 0 && e.type !== TREE) {
      e.alive = false;
      if (Math.random() < 0.5) eco.particles.push({ type: "kill", x: e.x, y: e.y, color: "#6b7280", icon: "💀", age: 0, maxAge: 70 });
    }
    e.age++;
  }

  eco.entities = eco.entities.filter(e => e.alive || e.age < 60);

  // Age and clean up particles
  for (const p of eco.particles) p.age++;
  eco.particles = eco.particles.filter(p => p.age < p.maxAge);
  if (eco.particles.length > 50) eco.particles = eco.particles.slice(-50);

  const treeCount = eco.entities.filter(e => e.type === TREE && e.alive).length;
  const avgGrowth = eco.entities.filter(e => e.type === TREE && e.alive).reduce((s, t) => s + t.growth, 0) / Math.max(treeCount, 1);
  eco.vegetationHealth = clamp(treeCount * 0.7 + avgGrowth * 25, 0, 100);

  const beaverCount = eco.entities.filter(e => e.type === BEAVER && e.alive).length;
  const fishCount = eco.entities.filter(e => e.type === FISH && e.alive).length;
  const bearCount = eco.entities.filter(e => e.type === BEAR && e.alive).length;
  // River target: vegetation (roots holding banks) + beavers (dams slow water) + fish (oxygen/algae cycling)
  const targetRiver = eco.vegetationHealth * 0.5 + beaverCount * 3 + Math.min(fishCount, 20) * 0.5;
  eco.riverHealth = clamp(eco.riverHealth + (targetRiver - eco.riverHealth) * 0.005, 0, 100);
  eco.riverWidth = TERRAIN.riverBaseW + (100 - eco.riverHealth) * 0.35;

  // Beaver collapse: no dams → river destabilizes (erosion, no wetlands)
  if (beaverCount === 0) {
    eco.riverHealth = clamp(eco.riverHealth - 0.015, 0, 100);
  } else if (beaverCount < 3) {
    eco.riverHealth = clamp(eco.riverHealth - 0.006, 0, 100);
  }

  // Fish collapse: indicator of broken stream chemistry; riparian zone degrades
  if (fishCount < 3) {
    eco.riverHealth = clamp(eco.riverHealth - 0.008, 0, 100);
  }

  // Bear absence: fewer carcasses for scavengers, less nutrient cycling; subtle veg drag
  if (bearCount === 0) {
    eco.vegetationHealth = clamp(eco.vegetationHealth - 0.003, 0, 100);
  }

  // Ecosystem cascade effects from species die-offs
  const rabbitCount = eco.entities.filter(e => e.type === RABBIT && e.alive).length;
  const birdCount = eco.entities.filter(e => e.type === BIRD && e.alive).length;
  const coyoteCount = eco.entities.filter(e => e.type === COYOTE && e.alive).length;

  // Bird die-off: reduced seed dispersal slows vegetation recovery
  if (birdCount < 4) {
    eco.vegetationHealth = clamp(eco.vegetationHealth - 0.008, 0, 100);
  }

  // Rabbit die-off: less soil aeration, slight vegetation impact
  if (rabbitCount < 5) {
    eco.vegetationHealth = clamp(eco.vegetationHealth - 0.004, 0, 100);
  }

  // Coyote extinction: rabbit population explodes, overgrazing intensifies
  // (This is handled naturally by the reproduction system — without coyote predation, rabbits breed unchecked)

  // Rabbit overpopulation: competes with elk for ground vegetation
  if (rabbitCount > 40) {
    eco.vegetationHealth = clamp(eco.vegetationHealth - 0.006 * (rabbitCount / 40), 0, 100);
  }

  // Natural tree spawning — driven by ecosystem health, elk browse pressure, and bird seed dispersal
  if (eco.tick % 80 === 0 && treeCount < 160) {
    const elkCount = eco.entities.filter(e => e.type === ELK && e.alive).length;
    const wolfCount = eco.entities.filter(e => e.type === WOLF && e.alive).length;
    const birdCount = eco.entities.filter(e => e.type === BIRD && e.alive).length;
    // Wolves create "ecology of fear" — elk avoid lingering near riverbanks, allowing saplings to grow
    const fearEffect = wolfCount > 0 ? clamp(wolfCount / 10, 0.3, 1.5) : 0.1;
    // Heavy elk browsing kills saplings
    const browsePressure = clamp(1.3 - elkCount / 55, 0.1, 1.3);
    // Birds disperse seeds — more birds = more saplings
    const seedDispersal = clamp(0.4 + birdCount / 20, 0.4, 1.5);
    // Base spawn chance depends on existing vegetation health
    const baseChance = eco.vegetationHealth > 20 ? 0.6 : 0.15;
    if (Math.random() < baseChance * fearEffect * browsePressure * seedDispersal) {
      const newTree = createEntity(TREE, null, null, W, H);
      eco.entities.push(newTree);
      eco.particles.push({ type: "growth", x: newTree.x, y: newTree.y, color: "#22c55e", icon: "🌱", age: 0, maxAge: 100 });
    }
  }

  // Auto-spawn/despawn hunters (historical hunting pressure simulation)
  if (eco.tick % 200 === 0) {
    const hunterCount = eco.entities.filter(e => e.type === HUNTER && e.alive).length;
    const wolfCount = eco.entities.filter(e => e.type === WOLF && e.alive).length;
    // Hunters appear when wolf population is notable, simulating conflict
    if (wolfCount > 6 && hunterCount < 6 && Math.random() < 0.35) {
      const h = createEntity(HUNTER, null, null, W, H);
      eco.entities.push(h);
      eco.particles.push({ type: "birth", x: h.x, y: h.y, color: "#ef4444", icon: "🎯", age: 0, maxAge: 80 });
    }
    // Small chance of hunter arriving regardless (random pressure)
    if (hunterCount < 3 && Math.random() < 0.12) {
      const h = createEntity(HUNTER, null, null, W, H);
      eco.entities.push(h);
    }
    // Hunters leave after a while or when wolves are scarce
    if (hunterCount > 0 && (wolfCount < 3 || Math.random() < 0.2)) {
      const hunter = eco.entities.find(e => e.type === HUNTER && e.alive);
      if (hunter) hunter.alive = false;
    }
  }

  // Sample stats every 20 ticks (~3x per simulated second) for near-real-time chart feel
  if (eco.tick % 20 === 0) {
    const stats = {
      wolves: eco.entities.filter(e => e.type === WOLF && e.alive).length,
      elk: eco.entities.filter(e => e.type === ELK && e.alive).length,
      trees: treeCount, beavers: beaverCount,
      coyotes: eco.entities.filter(e => e.type === COYOTE && e.alive).length,
      fish: eco.entities.filter(e => e.type === FISH && e.alive).length,
      birds: eco.entities.filter(e => e.type === BIRD && e.alive).length,
      rabbits: eco.entities.filter(e => e.type === RABBIT && e.alive).length,
      bears: eco.entities.filter(e => e.type === BEAR && e.alive).length,
      hunters: eco.entities.filter(e => e.type === HUNTER && e.alive).length,
      vegetationHealth: Math.round(eco.vegetationHealth),
      riverHealth: Math.round(eco.riverHealth),
    };
    eco.stats = stats;

    // Balance score components — total budget 105, clamped to 0-100.
    // Every species earns 0 pts when absent, max at ideal population, drops back
    // to 0 at 2x ideal, negative beyond (gentle overpop penalty).
    const ws = clamp(stats.wolves / 15, 0, 1) * 15 - (stats.wolves > 32 ? (stats.wolves - 32) * 0.3 : 0);  // wolves: plateau 15-32, overpop penalty after
    const es = popScore(stats.elk, 38, 15);      // elk (primary herbivore)
    const ts = clamp(stats.trees / 85, 0, 1) * 15;  // tree count (15, was 20)
    const vs = (eco.vegetationHealth / 100) * 5;    // vegetation HEALTH as its own component (NEW)
    const rs = (eco.riverHealth / 100) * 15;        // river health
    const bs = clamp(stats.beavers / 8, 0, 1) * 10; // beavers (ecosystem engineer)
    const bis = clamp(stats.birds / 12, 0, 1) * 8;  // songbirds
    const fs = clamp(stats.fish / 18, 0, 1) * 7;    // fish
    const cs = popScore(stats.coyotes, 8, 5);       // coyotes (FIXED: zero=0, was zero=3)
    const rbs = popScore(stats.rabbits, 22, 5);     // rabbits (FIXED: zero=0, was zero=1.3)
    const brs = clamp(stats.bears / 6, 0, 1) * 5;   // bears
    eco.balanceScore = clamp(Math.round(ws + es + ts + vs + rs + bs + bis + fs + cs + rbs + brs), 0, 100);

    // 600 samples × 0.33s = ~200s visible window — higher resolution, same time span
    if (eco.history.length > 600) eco.history.shift();
    eco.history.push({ t: eco.history.length, ...stats, score: eco.balanceScore });
  }
  return eco;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERLIN/SIMPLEX NOISE (2D value noise)
// ═══════════════════════════════════════════════════════════════════════════════

function perlinNoise(x, y, seed = 0) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 43.141) * 43758.5453;
  return n - Math.floor(n);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function noise2d(x, y, scale = 50) {
  const xi = Math.floor(x / scale);
  const yi = Math.floor(y / scale);
  const xf = (x / scale) - xi;
  const yf = (y / scale) - yi;

  const n00 = perlinNoise(xi, yi);
  const n10 = perlinNoise(xi + 1, yi);
  const n01 = perlinNoise(xi, yi + 1);
  const n11 = perlinNoise(xi + 1, yi + 1);

  const u = smoothstep(xf);
  const v = smoothstep(yf);

  const nx0 = lerp(n00, n10, u);
  const nx1 = lerp(n01, n11, u);
  return lerp(nx0, nx1, v);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANVAS RENDERER — DRAMATICALLY UPGRADED GRAPHICS
// ═══════════════════════════════════════════════════════════════════════════════

function lerpColor(a, b, t) {
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return `#${((rr << 16) | (rg << 8) | rb).toString(16).padStart(6, "0")}`;
}

// Convert a hex color (#rrggbb) to rgba(...) with the given alpha 0..1
function hexA(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC TERRAIN LAYER BUILDER — rasterizes the whole landscape once into an
// offscreen canvas at device resolution. Frees the per-frame budget for
// wildlife, water and weather, which is what makes the sim feel alive.
// ═══════════════════════════════════════════════════════════════════════════════
function buildTerrainLayer(W, H, dpr, vf, rh, RX, MX, scaledRW) {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(W * dpr));
  cv.height = Math.max(1, Math.round(H * dpr));
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  const bakedWarmth = 0.62; // fixed midday light; live drift is tinted per frame

  // ─── FULL TERRAIN BASE (entire canvas is ground — top-down view) ──────
  const meadowBase = lerpColor("#3d6b2e", "#5a9a40", vf);
  const meadowDark = lerpColor("#2a4a1e", "#3d7a2e", vf);
  const meadowLight = lerpColor("#4a7a36", "#6ab54a", vf);

  const baseGrad = ctx.createLinearGradient(0, 0, 0, H);
  baseGrad.addColorStop(0, lerpColor("#2e5420", "#4a8a35", vf));
  baseGrad.addColorStop(0.3, meadowBase);
  baseGrad.addColorStop(0.7, lerpColor("#355e28", "#4e9038", vf));
  baseGrad.addColorStop(1, lerpColor("#2a4a1e", "#3d7030", vf));
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, RX + scaledRW, H);  // overdraw under the channel — river paints on top

  // Forest side — DARKER, BLUER conifer canopy floor (visible distinction from meadow)
  const forestGrad = ctx.createLinearGradient(RX + scaledRW / 2, 0, MX, 0);
  forestGrad.addColorStop(0, lerpColor("#143316", "#1f4f24", vf));   // darker right at riverbank
  forestGrad.addColorStop(0.5, lerpColor("#0f2a14", "#1a4220", vf)); // deepest canopy
  forestGrad.addColorStop(1, lerpColor("#15321a", "#214d28", vf));   // softer toward mountains
  ctx.fillStyle = forestGrad;
  ctx.fillRect(RX - scaledRW, 0, MX - RX + scaledRW, H);

  // Background conifer silhouettes scattered across forest side — fills emptiness
  // These are NOT entities, just decorative background trees giving the forest density.
  const forestStart = RX + scaledRW / 2 + 34;
  const forestEnd = MX - 8;
  const forestArea = forestEnd - forestStart;
  if (forestArea > 0) {
    for (let i = 0; i < 90; i++) {
      // Pseudo-random scatter using deterministic hash
      const px = forestStart + ((i * 137.508 + 23) % forestArea);
      const py = ((i * 91.13 + 7) % H) | 0;
      const sz = 4 + ((i * 7) % 5);
      const shadeT = (i * 13) % 100 / 100;
      const baseGreen = lerpColor("#0d2c14", "#1e4224", vf);
      const lightGreen = lerpColor("#1e4a26", "#33643a", vf);
      // Conifer triangle (pointy)
      ctx.fillStyle = lerpColor(baseGreen, lightGreen, shadeT);
      ctx.beginPath();
      ctx.moveTo(px, py - sz);
      ctx.lineTo(px - sz * 0.7, py + sz * 0.7);
      ctx.lineTo(px + sz * 0.7, py + sz * 0.7);
      ctx.closePath();
      ctx.fill();
      // Highlight on one side
      ctx.fillStyle = `rgba(120, 180, 110, ${0.15 * vf})`;
      ctx.beginPath();
      ctx.moveTo(px - 0.5, py - sz + 1);
      ctx.lineTo(px - sz * 0.5, py + sz * 0.5);
      ctx.lineTo(px - 1, py + sz * 0.6);
      ctx.closePath();
      ctx.fill();
      // Tiny shadow at base
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.beginPath();
      ctx.ellipse(px, py + sz * 0.85, sz * 0.6, 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ─── Perlin noise terrain texture (FULL canvas, visible) ──────────────
  // Meadow noise — creates patches of lighter/darker grass, dirt
  const noiseStep = 6;
  for (let x = 0; x < RX + scaledRW; x += noiseStep) {
    for (let y = 0; y < H; y += noiseStep) {
      const nv = noise2d(x, y, 60);
      const nv2 = noise2d(x + 500, y + 300, 30); // second octave for detail
      const combined = nv * 0.7 + nv2 * 0.3;

      // Dirt patches where noise is low
      if (combined < 0.3) {
        ctx.fillStyle = lerpColor("#5c4a2a", "#6b5a34", vf);
        ctx.globalAlpha = (0.3 - combined) * 0.85;
        ctx.fillRect(x, y, noiseStep, noiseStep);
      }
      // Lush patches where noise is high
      else if (combined > 0.7) {
        ctx.fillStyle = meadowLight;
        ctx.globalAlpha = (combined - 0.7) * 0.65;
        ctx.fillRect(x, y, noiseStep, noiseStep);
      }
      // Subtle variation elsewhere
      else {
        ctx.fillStyle = combined > 0.5 ? meadowLight : meadowDark;
        ctx.globalAlpha = 0.08;
        ctx.fillRect(x, y, noiseStep, noiseStep);
      }
    }
  }
  ctx.globalAlpha = 1;

  // Large-scale rolling shade — soft valleys and rises across the meadow
  for (let x = 0; x < RX + scaledRW; x += 12) {
    for (let y = 0; y < H; y += 12) {
      const rv = noise2d(x + 900, y + 700, 150);
      if (rv < 0.42) {
        ctx.fillStyle = `rgba(15, 30, 12, ${((0.42 - rv) * 0.5).toFixed(3)})`;
        ctx.fillRect(x, y, 12, 12);
      } else if (rv > 0.62) {
        ctx.fillStyle = `rgba(190, 230, 150, ${((rv - 0.62) * 0.22).toFixed(3)})`;
        ctx.fillRect(x, y, 12, 12);
      }
    }
  }

  // Forest floor noise — darker, with needle/leaf litter feel
  for (let x = Math.floor(RX - scaledRW); x < MX; x += noiseStep) {
    for (let y = 0; y < H; y += noiseStep) {
      const nv = noise2d(x + 200, y + 100, 45);
      if (nv < 0.35) {
        ctx.fillStyle = "#1a2e15";
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x, y, noiseStep, noiseStep);
      } else if (nv > 0.65) {
        ctx.fillStyle = lerpColor("#2a5020", "#3a7030", vf);
        ctx.globalAlpha = 0.2;
        ctx.fillRect(x, y, noiseStep, noiseStep);
      }
    }
  }
  ctx.globalAlpha = 1;

  // ─── Mountain range (far right background — 3 parallax layers) ────────
  // Warm earthy grays — the Absaroka/Gallatin ranges as seen from the valley
  const mtBgGrad = ctx.createLinearGradient(MX, 0, W, 0);
  mtBgGrad.addColorStop(0, "#4a3d30");      // warm earth-tan near forest edge
  mtBgGrad.addColorStop(0.4, "#6e5f4e");    // mid-distance brown-gray
  mtBgGrad.addColorStop(1, "#9a8a78");      // furthest haze
  ctx.fillStyle = mtBgGrad;
  ctx.fillRect(MX, 0, W - MX, H);

  // FAR range — palest, smallest, most distant
  const farRange = (yPct) => MX + (W - MX) * 0.55 + Math.sin(yPct * 6.2 + 0.3) * (W - MX) * 0.08 + Math.sin(yPct * 18 + 1) * (W - MX) * 0.025;
  ctx.fillStyle = lerpColor("#8a8478", "#a09a8a", bakedWarmth);
  ctx.beginPath();
  ctx.moveTo(MX, 0);
  for (let y = 0; y <= H; y += 3) ctx.lineTo(farRange(y / H), y);
  ctx.lineTo(MX, H);
  ctx.closePath();
  ctx.fill();
  // Snow caps on far range — bright against warm rock
  ctx.fillStyle = "rgba(248, 252, 255, 0.85)";
  ctx.beginPath();
  for (let y = 0; y <= H; y += 4) {
    const r = farRange(y / H);
    const snowDepth = (W - MX) * 0.06 * (0.6 + Math.sin(y * 0.04) * 0.4);
    if (y === 0) ctx.moveTo(r, y); else ctx.lineTo(r, y);
    ctx.lineTo(r + snowDepth, y);
  }
  for (let y = H; y >= 0; y -= 6) ctx.lineTo(farRange(y / H), y);
  ctx.closePath();
  ctx.fill();

  // MID range — mid-tone, medium silhouette
  const midRange = (yPct) => MX + (W - MX) * 0.35 + Math.sin(yPct * 5.4 + 0.8) * (W - MX) * 0.11 + Math.sin(yPct * 13 + 2.2) * (W - MX) * 0.04;
  ctx.fillStyle = lerpColor("#5e5246", "#6e6256", bakedWarmth);
  ctx.beginPath();
  ctx.moveTo(MX, 0);
  for (let y = 0; y <= H; y += 3) ctx.lineTo(midRange(y / H), y);
  ctx.lineTo(MX, H);
  ctx.closePath();
  ctx.fill();
  // Snow on mid range — patchier but bright
  ctx.fillStyle = "rgba(240, 246, 250, 0.78)";
  ctx.beginPath();
  for (let y = 0; y <= H; y += 5) {
    const r = midRange(y / H);
    const sd = (W - MX) * 0.05 * (0.5 + Math.sin(y * 0.05 + 1.4) * 0.5);
    if (y === 0) ctx.moveTo(r, y); else ctx.lineTo(r, y);
    ctx.lineTo(r + sd, y);
  }
  for (let y = H; y >= 0; y -= 6) ctx.lineTo(midRange(y / H), y);
  ctx.closePath();
  ctx.fill();

  // NEAR range — darkest, sharpest peaks, casts toward viewer
  const nearRange = (yPct) => MX + (W - MX) * 0.12 + Math.sin(yPct * 4.6 + 1.7) * (W - MX) * 0.09 + Math.sin(yPct * 11 + 3.1) * (W - MX) * 0.035;
  ctx.fillStyle = lerpColor("#3f332a", "#4e4034", bakedWarmth);
  ctx.beginPath();
  ctx.moveTo(MX, 0);
  for (let y = 0; y <= H; y += 3) ctx.lineTo(nearRange(y / H), y);
  ctx.lineTo(MX, H);
  ctx.closePath();
  ctx.fill();
  // Ridge outline — separates the near range from the background haze
  ctx.strokeStyle = "rgba(25, 20, 15, 0.45)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let y = 0; y <= H; y += 3) {
    const x = nearRange(y / H);
    if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Sparse snow on near peaks (only at peak points where slope is steep)
  ctx.fillStyle = "rgba(230, 240, 245, 0.7)";
  for (let i = 0; i < 8; i++) {
    const py = (i + 0.5) * (H / 8);
    const px = nearRange(py / H);
    ctx.beginPath();
    ctx.ellipse(px + 4, py, 4, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rock texture detail on near range — small dark patches
  ctx.fillStyle = "rgba(20, 28, 35, 0.35)";
  for (let i = 0; i < 30; i++) {
    const py = (i * 87.13) % H;
    const px = nearRange(py / H) + 6 + ((i * 13.7) % 18);
    if (px > W - 4) continue;
    ctx.beginPath();
    ctx.ellipse(px, py, 1.5 + (i % 3), 1, i * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mountain-to-forest soft transition
  const mtTransGrad = ctx.createLinearGradient(MX - 35, 0, MX + 25, 0);
  mtTransGrad.addColorStop(0, "transparent");
  mtTransGrad.addColorStop(1, "rgba(35, 50, 42, 0.55)");
  ctx.fillStyle = mtTransGrad;
  ctx.fillRect(MX - 35, 0, 60, H);

  // ─── Wildflowers scattered across meadow (Yellowstone species) ─────────
  // Bigger clusters, more variety, more visible — real Yellowstone flowers:
  // Indian paintbrush (red), balsamroot (yellow), lupine (purple), fireweed (magenta)
  if (vf > 0.15) {
    const flowerColors = ["#dc2626", "#facc15", "#8b5cf6", "#ec4899", "#f97316", "#f8fafc"];
    for (let i = 0; i < Math.floor(180 * vf); i++) {
      const fx = (i * 191.23 + 13) % (RX - scaledRW / 2 - 34) + 10;
      const fy = (i * 137.891 + 7) % (H - 20) + 10;
      const nv = noise2d(fx, fy, 80);
      if (nv < 0.35) continue;
      const clr = flowerColors[i % flowerColors.length];
      ctx.fillStyle = clr;
      ctx.globalAlpha = vf * 0.8;
      // Main bloom
      ctx.beginPath();
      ctx.arc(fx, fy, 1.6 + nv * 0.8, 0, Math.PI * 2);
      ctx.fill();
      // Cluster — 3-5 nearby blooms make a wildflower patch
      if (nv > 0.55) {
        ctx.beginPath();
        ctx.arc(fx + 3, fy - 2, 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(fx - 2.5, fy + 2.5, 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(fx + 1.5, fy + 3, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      if (nv > 0.75) {
        ctx.beginPath();
        ctx.arc(fx - 4, fy - 1, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      // Highlight pixel on each bloom
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.globalAlpha = vf * 0.7;
      ctx.beginPath();
      ctx.arc(fx - 0.4, fy - 0.4, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ─── Rocky areas (scattered on both sides) ────────────────────────────
  ctx.fillStyle = "rgba(100, 110, 105, 0.2)";
  for (let i = 0; i < 45; i++) {
    const rx = (i * 277.13 + 31) % (W * 0.78) + 10;
    const ry = (i * 193.47 + 50) % (H - 20) + 10;
    if (Math.abs(rx - RX) < scaledRW / 2 + 38) continue;
    const sz = 1.5 + Math.sin(i * 7.3) * 1.5;
    ctx.beginPath();
    ctx.ellipse(rx, ry, sz * 1.3, sz, i * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── RIVER — meandering channel with wet banks and gravel ─────────────
  const bankW = scaledRW * 0.5;
  for (const side of [-1, 1]) {
    ctx.strokeStyle = "rgba(62, 50, 30, 0.38)";
    ctx.lineWidth = bankW;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let y = -8; y <= H + 8; y += 6) {
      const cx = riverXAt(W, y) + side * (scaledRW / 2 + bankW * 0.32);
      if (y === -8) ctx.moveTo(cx, y); else ctx.lineTo(cx, y);
    }
    ctx.stroke();
  }
  // gravel speckles along both banks
  const gravelShades = ["rgba(150,140,120,0.5)", "rgba(110,100,85,0.5)", "rgba(180,170,150,0.45)"];
  for (let i = 0; i < 130; i++) {
    const gy = (i * 61.7 + 9) % H;
    const side = i % 2 === 0 ? -1 : 1;
    const off = scaledRW / 2 + 2 + ((i * 13.3) % (bankW * 0.9));
    const gx = riverXAt(W, gy) + side * off;
    const gs = 0.6 + ((i * 7) % 10) / 9;
    ctx.fillStyle = gravelShades[i % 3];
    ctx.beginPath();
    ctx.ellipse(gx, gy, gs * 1.3, gs, i * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  // water — channel filled between the curved banks
  const waterDeep   = rh > 60 ? "#0d3a5c" : rh > 30 ? "#1a4a60" : "#5a4030";
  const waterMid    = rh > 60 ? "#1e5680" : rh > 30 ? "#2c5d75" : "#6e5040";
  const waterShallow = rh > 60 ? "#3a7ea0" : rh > 30 ? "#4a7e95" : "#8e6850";
  ctx.fillStyle = waterMid;
  ctx.beginPath();
  for (let y = -8; y <= H + 8; y += 5) {
    const cx = riverXAt(W, y) - scaledRW / 2;
    if (y === -8) ctx.moveTo(cx, y); else ctx.lineTo(cx, y);
  }
  for (let y = H + 8; y >= -8; y -= 5) {
    ctx.lineTo(riverXAt(W, y) + scaledRW / 2, y);
  }
  ctx.closePath();
  ctx.fill();
  // depth shading — dark channels along each bank, sunlit spine down the middle
  ctx.strokeStyle = waterDeep;
  ctx.lineWidth = scaledRW * 0.34;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let y = -8; y <= H + 8; y += 6) {
      const cx = riverXAt(W, y) + side * scaledRW * 0.31;
      if (y === -8) ctx.moveTo(cx, y); else ctx.lineTo(cx, y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = waterShallow;
  ctx.lineWidth = scaledRW * 0.22;
  ctx.beginPath();
  for (let y = -8; y <= H + 8; y += 6) {
    const cx = riverXAt(W, y);
    if (y === -8) ctx.moveTo(cx, y); else ctx.lineTo(cx, y);
  }
  ctx.stroke();
  // river stones hugging the curved banks
  ctx.fillStyle = "rgba(80, 90, 85, 0.4)";
  for (let i = 0; i < 34; i++) {
    const sy = (i * 127.1 + 20) % H;
    const cx = riverXAt(W, sy);
    const off = scaledRW / 2 + 3 + Math.sin(i * 5.3) * 2.5;
    const sz = 1.6 + Math.sin(i * 2.1) * 1.3;
    ctx.beginPath(); ctx.ellipse(cx - off, sy, sz, sz * 0.7, i * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + off, sy, sz, sz * 0.7, i * 0.3, 0, Math.PI * 2); ctx.fill();
  }

  return cv;
}

function renderEcosystem(ctx, eco) {
  const { W, H, vegetationHealth: vh, riverHealth: rh, riverWidth: rw, tick } = eco;
  const vf = vh / 100;
  const RX = W * TERRAIN.riverPct;
  const MX = W * TERRAIN.mountainStartPct;
  const scaledRW = rw * (W / 960);  // scale river width to canvas

  // ─── HiDPI: draw in CSS-pixel space, rasterize at device resolution ───
  const dpr = W > 0 ? ctx.canvas.width / W : 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // ─── SEASONAL CYCLE ──────────────────────────────────────────────────
  // season increments every 1800 ticks (30s). Full year = 2 minutes.
  // Derive continuous float so rendering transitions smoothly.
  const seasonFloat = (eco.season ?? 0) + (tick % 1800) / 1800;
  const seasonIdx = Math.floor(seasonFloat) % 4;  // 0=spring, 1=summer, 2=autumn, 3=winter
  const seasonT = seasonFloat % 1;                 // progress within current season (0-1)
  // Store on eco for drawTree access without threading through arg
  eco._seasonIdx = seasonIdx;
  eco._seasonT = seasonT;
  // Helper: blend current season with next for smooth color shifts
  const nextSeasonIdx = (seasonIdx + 1) % 4;
  // Ease the blend (cubic-ish) so the transition hits visibly but not all at once
  const blend = seasonT < 0.7 ? 0 : (seasonT - 0.7) / 0.3; // blend only in last 30%

  // ─── PER-SCENARIO PALETTE TINT — applied at end as overlay ─────────────
  const sid = eco.scenarioId;
  const scenarioOverlay = sid === "drought"  ? "rgba(218,165,90,0.16)"   // sepia/dust
                        : sid === "cwd"      ? "rgba(140,180,120,0.10)"  // sickly green
                        : sid === "poaching" ? "rgba(160,70,70,0.08)"    // tense red wash
                        : sid === "tourism"  ? "rgba(170,190,210,0.08)"  // hazy gray
                        : null;

  // ─── TIME-OF-DAY CYCLE — slow ambient warmth drift ─────────────────────
  // Cycles ~every 5 simulated minutes so a 10-min game shows 2 cycles.
  const todPhase = (Math.sin(tick * 0.00035) + 1) * 0.5; // 0=cool dawn, 1=warm noon
  const todWarmth = 0.4 + todPhase * 0.6;

  // ─── STATIC TERRAIN — cached offscreen layer ──────────────────────────
  // The full landscape (ground, noise fields, mountains, forest, riverbed,
  // wildflowers) is rasterized once and re-used every frame. Rebuilt only
  // when the landscape itself materially changes.
  const terrainKey = [Math.round(W), Math.round(H), Math.round(dpr * 4), Math.round(vf * 14), Math.round(scaledRW), rh > 60 ? 2 : rh > 30 ? 1 : 0].join("|");
  if (!eco._terrain || eco._terrain.key !== terrainKey) {
    eco._terrain = { key: terrainKey, cv: buildTerrainLayer(W, H, dpr, vf, rh, RX, MX, scaledRW) };
  }
  ctx.drawImage(eco._terrain.cv, 0, 0, W, H);

  // Live time-of-day tint over the mountain strip (keeps the slow
  // dawn-to-noon light drift alive on top of the baked lighting)
  ctx.fillStyle = todWarmth > 0.5
    ? `rgba(255, 214, 150, ${(todWarmth - 0.5) * 0.10})`
    : `rgba(90, 110, 160, ${(0.5 - todWarmth) * 0.10})`;
  ctx.fillRect(MX, 0, W - MX, H);

  // ─── CLOUD SHADOWS — soft shapes drifting across the valley ──────────
  for (let ci = 0; ci < 3; ci++) {
    const cw2 = W * (0.34 + ci * 0.09);
    const cx = ((tick * (0.14 + ci * 0.06) + ci * W * 0.45) % (W + cw2 * 2)) - cw2;
    const cy = H * (0.16 + ci * 0.3) + Math.sin(tick * 0.001 + ci * 2.4) * H * 0.05;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.42);
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, cw2 * 0.55);
    cg.addColorStop(0, "rgba(8, 14, 24, 0.10)");
    cg.addColorStop(0.7, "rgba(8, 14, 24, 0.055)");
    cg.addColorStop(1, "rgba(8, 14, 24, 0)");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, 0, cw2 * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ─── River with scenic water effects ──────────────────────────────────
  // River current — subtle wavy lines (less chaotic, more flowing)
  for (let layer = 0; layer < 3; layer++) {
    ctx.strokeStyle = `rgba(170, 220, 255, ${0.05 + rh * 0.0015 + layer * 0.008})`;
    ctx.lineWidth = 0.8 + layer * 0.3;
    for (let y = -20; y < H + 20; y += 18 + layer * 6) {
      ctx.beginPath();
      const phase = tick * (0.018 + layer * 0.005) + y * 0.025 + layer * 1.2;
      const amp = scaledRW * 0.10 * (1 - layer * 0.18);
      // Smoother wave with fewer points
      for (let dy = 0; dy < 14; dy += 3.5) {
        const cx = riverXAt(W, y + dy) + Math.sin(phase + dy * 0.3) * amp;
        if (dy === 0) ctx.moveTo(cx, y + dy);
        else ctx.lineTo(cx, y + dy);
      }
      ctx.stroke();
    }
  }

  // Caustic light highlights — bright moving spots on water surface
  for (let i = 0; i < 24; i++) {
    const causticPhase = tick * 0.018 + i * 1.7;
    const sy = ((tick * 0.6 + i * H / 24) % (H + 30)) - 15;
    const sx = riverXAt(W, sy) + Math.sin(causticPhase) * scaledRW * 0.32;
    const intensity = (Math.sin(causticPhase * 1.7) * 0.5 + 0.5);
    ctx.fillStyle = `rgba(220, 240, 255, ${(0.10 + rh * 0.002) * intensity})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 3 + intensity * 2, 1 + intensity * 0.5, tick * 0.01 + i, 0, Math.PI * 2);
    ctx.fill();
  }

  // Surface shimmer flecks (sparkle)
  ctx.fillStyle = `rgba(255, 255, 255, ${0.08 + rh * 0.002})`;
  for (let i = 0; i < 18; i++) {
    const sy = (tick * 0.45 + i * H / 18) % H;
    const sx = riverXAt(W, sy) + Math.sin(tick * 0.025 + i * 2.3) * scaledRW * 0.35;
    const sparkle = (Math.sin(tick * 0.08 + i) * 0.5 + 0.5);
    if (sparkle > 0.7) {
      ctx.beginPath();
      ctx.arc(sx, sy, 0.8 + sparkle * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Foam at edges
  ctx.fillStyle = `rgba(255, 255, 255, ${0.15 + rh * 0.002})`;
  for (let y = 0; y < H; y += 8) {
    const foamX1 = riverXAt(W, y) - scaledRW / 2 + Math.sin(tick * 0.04 + y * 0.03) * 2;
    const foamX2 = riverXAt(W, y) + scaledRW / 2 + Math.sin(tick * 0.04 + y * 0.03 + 1) * 2;
    ctx.fillRect(foamX1 - 1, y, 2, 1.5);
    ctx.fillRect(foamX2 - 1, y, 2, 1.5);
  }

  // ─── CATTAILS swaying along the banks ─────────────────────────────────
  for (let ct = 0; ct < 26; ct++) {
    const cy = (ct * 83.7 + 12) % H;
    const side = ct % 2 === 0 ? -1 : 1;
    const cx = riverXAt(W, cy) + side * (scaledRW / 2 + 3 + ((ct * 11) % 7));
    if (cx > MX - 12) continue;
    const reedSway = Math.sin(tick * 0.015 + ct * 1.9) * 2.2;
    const hgt = 9 + (ct * 5) % 6;
    ctx.strokeStyle = ct % 3 === 0 ? "#4d7c3a" : "#5d8c46";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + reedSway * 0.4, cy - hgt * 0.6, cx + reedSway, cy - hgt);
    ctx.moveTo(cx - 1.5, cy);
    ctx.quadraticCurveTo(cx - 1.5 + reedSway * 0.3, cy - hgt * 0.45, cx - 2.5 + reedSway * 0.8, cy - hgt * 0.75);
    ctx.stroke();
    if (ct % 2 === 0) {
      ctx.fillStyle = "#6b4423";
      ctx.save();
      ctx.translate(cx + reedSway * 0.85, cy - hgt + 1.5);
      ctx.rotate(reedSway * 0.06);
      ctx.beginPath();
      ctx.ellipse(0, 0, 1.1, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ─── Grass blades with animation ──────────────────────────────────────
  if (vf > 0.1) {
    ctx.globalAlpha = 0.3 + vf * 0.3;
    const grassColors = [
      lerpColor("#5a8a30", "#7aba50", vf),
      lerpColor("#4a7a28", "#6aaa40", vf),
      lerpColor("#3a6a20", "#5a9a38", vf),
    ];
    for (let i = 0; i < Math.floor(200 * vf); i++) {
      const gx = (i * 97.508 + 7) % (W * 0.78) + 10;
      const gy = (i * 73.33 + 11) % (H - 20) + 10;
      if (Math.abs(gx - riverXAt(W, gy)) < scaledRW / 2 + 10) continue;
      if (gx > MX - 10) continue;
      ctx.strokeStyle = grassColors[i % 3];
      ctx.lineWidth = 0.6 + Math.sin(i * 1.3) * 0.3;
      const sway = Math.sin(tick * 0.012 + gx * 0.04 + gy * 0.02) * 2.5;
      const bladeH = 5 + vf * 4 + Math.sin(i * 2.7) * 2;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + sway * 0.5, gy - bladeH * 0.6, gx + sway, gy - bladeH);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ─── Time-of-day ambient warmth — diagonal sun overlay ────────────────
  const sunR = Math.round(255 * (0.6 + todWarmth * 0.4));
  const sunG = Math.round(220 * (0.5 + todWarmth * 0.5));
  const sunB = Math.round(140 + (1 - todWarmth) * 80);
  const ambGrad = ctx.createLinearGradient(0, 0, W, H);
  ambGrad.addColorStop(0, `rgba(${sunR}, ${sunG}, ${sunB}, ${0.05 + todWarmth * 0.05})`);
  ambGrad.addColorStop(0.5, "transparent");
  ambGrad.addColorStop(1, `rgba(80, 100, 160, ${0.04 + (1 - todWarmth) * 0.05})`);
  ctx.fillStyle = ambGrad;
  ctx.fillRect(0, 0, W, H);

  // ─── SEASONAL OVERLAY — blend current → next for smooth transitions ───
  // Spring: faint cool-green, Summer: faint gold, Autumn: rich amber, Winter: cold blue
  const seasonOverlays = [
    "rgba(140, 200, 160, 0.05)",  // spring
    "rgba(250, 210, 120, 0.06)",  // summer
    "rgba(210, 130, 60, 0.18)",   // autumn — strong warm amber
    "rgba(170, 200, 230, 0.22)",  // winter — cold blue wash
  ];
  // Draw current season overlay
  ctx.fillStyle = seasonOverlays[seasonIdx];
  ctx.fillRect(0, 0, W, H);
  if (blend > 0) {
    ctx.fillStyle = seasonOverlays[nextSeasonIdx];
    ctx.globalAlpha = blend;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // ─── WINTER SNOW COVER — white overlay on meadow areas ────────────────
  if (seasonIdx === 3 || (seasonIdx === 2 && blend > 0.3)) {
    // Snow intensity: ramps up through late autumn → full in winter → melts in early spring
    let snowAlpha;
    if (seasonIdx === 2) snowAlpha = (blend - 0.3) * 0.6; // late autumn accumulation
    else snowAlpha = 0.65 - seasonT * 0.25; // winter → spring melt
    snowAlpha = clamp(snowAlpha, 0, 0.65);

    // Snow on meadow side (avoid river)
    ctx.fillStyle = `rgba(245, 250, 255, ${snowAlpha})`;
    ctx.fillRect(0, 0, RX - scaledRW / 2 - 28, H);

    // Snow patches — bright white on top of noise texture for depth
    ctx.fillStyle = `rgba(255, 255, 255, ${snowAlpha * 0.5})`;
    for (let i = 0; i < 120; i++) {
      const sx = (i * 187.3 + 17) % (RX - scaledRW / 2 - 20) + 10;
      const sy = (i * 113.7 + 11) % (H - 20) + 10;
      const nv = noise2d(sx, sy, 40);
      if (nv < 0.45) continue;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 4 + nv * 4, 2 + nv * 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Snow on forest floor (between river and mountains)
    ctx.fillStyle = `rgba(245, 250, 255, ${snowAlpha * 0.7})`;
    ctx.fillRect(RX + scaledRW / 2 + 28, 0, MX - RX - scaledRW / 2 - 28, H);

    // Falling snow particles drifting diagonally
    if (snowAlpha > 0.2) {
      ctx.fillStyle = `rgba(255, 255, 255, ${snowAlpha * 1.2})`;
      for (let i = 0; i < 60; i++) {
        const baseX = (i * 97 + 3) % W;
        const baseY = (i * 73 + 17) % H;
        const sx = (baseX + tick * 0.5 + Math.sin(tick * 0.01 + i) * 20) % W;
        const sy = (baseY + tick * 0.8) % H;
        ctx.beginPath();
        ctx.arc(sx, sy, 1 + (i % 3) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ─── AUTUMN GROUND TINT — golden wash on meadow ────────────────────────
  if (seasonIdx === 2 && blend < 0.3) {
    // Ramps up through early autumn, peaks mid, fades into snow in late autumn
    const autumnAlpha = seasonT < 0.5 ? seasonT * 0.4 : (1 - seasonT) * 0.4;
    ctx.fillStyle = `rgba(200, 140, 60, ${autumnAlpha})`;
    ctx.fillRect(0, 0, RX - scaledRW / 2 - 28, H);
  }

  // ─── AUTUMN LEAVES — drifting on the valley breeze ────────────────────
  if (seasonIdx === 2) {
    const leafColors = ["#d97706", "#dc2626", "#eab308", "#b45309"];
    for (let li = 0; li < 16; li++) {
      const lx = ((li * 173 + 40) + tick * (0.4 + (li % 4) * 0.13)) % (W + 30) - 15;
      const ly = ((li * 97 + 20) + tick * (0.5 + (li % 3) * 0.2)) % (H + 20) - 10;
      const flutter = Math.sin(tick * 0.05 + li * 1.7) * 3;
      ctx.save();
      ctx.translate(lx + flutter, ly);
      ctx.rotate(tick * 0.03 + li * 0.8);
      ctx.fillStyle = hexA(leafColors[li % 4], 0.7);
      ctx.beginPath();
      ctx.ellipse(0, 0, 2.6, 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ─── Tourism corridor (highway) — visible band for tourism scenario ────
  if (eco.scenarioId === "tourism") {
    const cx = W * 0.40;
    const cw = W * 0.15;
    // Asphalt band
    ctx.fillStyle = "rgba(60, 60, 70, 0.45)";
    ctx.fillRect(cx - cw / 2, 0, cw, H);
    // Lane markings (dashed yellow centerline)
    ctx.strokeStyle = "rgba(251, 191, 36, 0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([18, 12]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    ctx.stroke();
    ctx.setLineDash([]);
    // Edge lines
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - cw / 2 + 3, 0);
    ctx.lineTo(cx - cw / 2 + 3, H);
    ctx.moveTo(cx + cw / 2 - 3, 0);
    ctx.lineTo(cx + cw / 2 - 3, H);
    ctx.stroke();
    // Label at top
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🚗 HIGHWAY", cx, 18);
    ctx.textAlign = "left";
  }

  // ─── Entities sorted by depth ────────────────────────────────────────
  const sorted = eco.entities.filter(e => e.alive).sort((a, b) => {
    if (a.type === TREE && b.type !== TREE) return -1;
    if (b.type === TREE && a.type !== TREE) return 1;
    return a.y - b.y;
  });

  for (const e of sorted) {
    ctx.save();
    switch (e.type) {
      case TREE: drawTree(ctx, e, vf, tick, { idx: eco._seasonIdx ?? 0, t: eco._seasonT ?? 0 }); break;
      case WOLF: drawWolf(ctx, e, tick); break;
      case ELK: drawElk(ctx, e, tick); break;
      case BEAVER: drawBeaver(ctx, e, tick); break;
      case COYOTE: drawCoyote(ctx, e, tick); break;
      case FISH: drawFish(ctx, e, tick); break;
      case BIRD: drawBird(ctx, e, tick); break;
      case RABBIT: drawRabbit(ctx, e, tick); break;
      case BEAR: drawBear(ctx, e, tick); break;
      case HUNTER: drawHunter(ctx, e, tick); break;
    }
    ctx.restore();
  }

  // ─── Particle effects for dead entities ──────────────────────────────
  for (const e of eco.entities) {
    if (e.alive || e.type === TREE) continue;
    const fade = 1 - e.age / 60;
    if (fade <= 0) continue;
    ctx.globalAlpha = fade * 0.5;
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(e.x, e.y, 3, 0, Math.PI * 2);
    ctx.fill();
    for (let p = 0; p < 3; p++) {
      const px = e.x + Math.sin(e.age * 0.3 + p * 2) * (e.age * 0.3);
      const py = e.y + Math.cos(e.age * 0.3 + p * 2) * (e.age * 0.3);
      ctx.beginPath();
      ctx.arc(px, py, 1.5 * fade, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ─── Birth / Growth / Kill particle effects (canvas-drawn, no emoji) ──
  for (const p of eco.particles) {
    const t = p.age / p.maxAge;                   // 0 → 1 over lifetime
    const fade = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8; // ease in/out
    if (fade <= 0) continue;

    if (p.type === "birth") {
      // Expanding glow ring + 4 small rising motes (no text labels)
      const radius = 4 + p.age * 0.32;
      // Soft outer glow
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 1.6);
      glow.addColorStop(0, hexA(p.color, fade * 0.45));
      glow.addColorStop(1, hexA(p.color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 1.6, 0, Math.PI * 2);
      ctx.fill();
      // Crisp ring
      ctx.strokeStyle = hexA(p.color, fade * 0.85);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      // 4 motes rising upward & outward
      ctx.fillStyle = hexA(p.color, fade * 0.7);
      for (let s = 0; s < 4; s++) {
        const angle = (s / 4) * Math.PI * 2 + p.age * 0.04;
        const sr = radius * 0.7 + p.age * 0.1;
        const sx = p.x + Math.cos(angle) * sr;
        const sy = p.y + Math.sin(angle) * sr - p.age * 0.15;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.4 * fade, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (p.type === "growth") {
      // Sprouting: small leaf shape + curling tendril rising from p.x,p.y
      const rise = p.age * 0.18;
      const sway = Math.sin(p.age * 0.12) * 3;
      // Tendril stem
      ctx.strokeStyle = hexA("#22c55e", fade * 0.85);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(p.x + sway * 0.5, p.y - rise * 0.5, p.x + sway, p.y - rise);
      ctx.stroke();
      // Leaf at tip — pointed ellipse
      ctx.fillStyle = hexA("#4ade80", fade * 0.85);
      ctx.beginPath();
      ctx.ellipse(p.x + sway, p.y - rise - 1, 3, 1.5, Math.sin(p.age * 0.08) * 0.4, 0, Math.PI * 2);
      ctx.fill();
      // Highlight on leaf
      ctx.fillStyle = hexA("#86efac", fade * 0.6);
      ctx.beginPath();
      ctx.ellipse(p.x + sway - 0.5, p.y - rise - 1.5, 1.2, 0.6, Math.sin(p.age * 0.08) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === "kill") {
      // Red burst: dust puff + 6 expanding sparks, no skull text
      const kr = 2 + p.age * 0.35;
      // Dust cloud
      const dust = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, kr * 2.2);
      dust.addColorStop(0, `rgba(220, 110, 90, ${fade * 0.55})`);
      dust.addColorStop(1, "rgba(220, 110, 90, 0)");
      ctx.fillStyle = dust;
      ctx.beginPath();
      ctx.arc(p.x, p.y, kr * 2.2, 0, Math.PI * 2);
      ctx.fill();
      // Sparks
      ctx.fillStyle = `rgba(239, 68, 68, ${fade * 0.85})`;
      for (let s = 0; s < 6; s++) {
        const angle = (s / 6) * Math.PI * 2 + p.age * 0.04;
        const sx = p.x + Math.cos(angle) * kr;
        const sy = p.y + Math.sin(angle) * kr;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.8 * (1 - t), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ─── Firefly particles in healthy areas ───────────────────────────────
  if (vf > 0.5) {
    ctx.fillStyle = "#fef08a";
    for (let i = 0; i < Math.floor(12 * vf); i++) {
      const fx = (Math.sin(tick * 0.007 + i * 4.3) * 0.5 + 0.5) * (RX - scaledRW / 2 - 20) + 10;
      const fy = (Math.cos(tick * 0.005 + i * 3.1) * 0.5 + 0.5) * (H - 20) + 10;
      const flicker = Math.sin(tick * 0.1 + i * 7) * 0.5 + 0.5;
      ctx.globalAlpha = flicker * 0.4 * vf;
      ctx.beginPath();
      ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
      ctx.fill();
      // Glow
      ctx.globalAlpha = flicker * 0.1 * vf;
      ctx.beginPath();
      ctx.arc(fx, fy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ─── Vignette (darken edges/corners — stronger for atmospheric depth) ─
  const vigGrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.30, W / 2, H / 2, Math.max(W, H) * 0.78);
  vigGrad.addColorStop(0, "transparent");
  vigGrad.addColorStop(0.7, "rgba(12, 14, 18, 0.12)");
  vigGrad.addColorStop(1, "rgba(8, 10, 16, 0.30)");
  ctx.fillStyle = vigGrad;
  ctx.fillRect(0, 0, W, H);

  // ─── Edge fog (top + bottom haze for cinematic depth) ─────────────────
  const topFog = ctx.createLinearGradient(0, 0, 0, H * 0.12);
  topFog.addColorStop(0, "rgba(190, 205, 215, 0.20)");
  topFog.addColorStop(1, "rgba(190, 205, 215, 0)");
  ctx.fillStyle = topFog;
  ctx.fillRect(0, 0, W, H * 0.12);

  const botFog = ctx.createLinearGradient(0, H * 0.92, 0, H);
  botFog.addColorStop(0, "rgba(20, 30, 40, 0)");
  botFog.addColorStop(1, "rgba(20, 30, 40, 0.18)");
  ctx.fillStyle = botFog;
  ctx.fillRect(0, H * 0.92, W, H * 0.08);

  // ─── GOD RAYS — soft diagonal light shafts drifting over the valley ───
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.transform(1, 0, -0.32, 1, H * 0.32, 0);
  for (let gi = 0; gi < 3; gi++) {
    const gw = W * (0.09 + gi * 0.03);
    const gx = ((tick * (0.10 + gi * 0.04) + gi * W * 0.33) % (W + gw * 3)) - gw * 1.5;
    const gg = ctx.createLinearGradient(gx, 0, gx + gw, 0);
    gg.addColorStop(0, "rgba(255, 236, 190, 0)");
    gg.addColorStop(0.5, "rgba(255, 236, 190, 0.55)");
    gg.addColorStop(1, "rgba(255, 236, 190, 0)");
    ctx.fillStyle = gg;
    ctx.fillRect(gx, -H * 0.2, gw, H * 1.4);
  }
  ctx.restore();

  // ─── FILMIC GRADE — warm key light, cool shadow corners (soft-light) ──
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  const grade = ctx.createRadialGradient(W * 0.42, H * 0.36, 0, W * 0.42, H * 0.36, Math.max(W, H) * 0.8);
  grade.addColorStop(0, "rgba(255, 216, 150, 0.5)");
  grade.addColorStop(0.55, "rgba(128, 128, 128, 0)");
  grade.addColorStop(1, "rgba(45, 65, 115, 0.45)");
  ctx.fillStyle = grade;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // ─── Per-scenario palette tint (mood overlay) ─────────────────────────
  if (scenarioOverlay) {
    ctx.fillStyle = scenarioOverlay;
    ctx.fillRect(0, 0, W, H);
  }

  // ─── Atmospheric haze when ecosystem is degraded ──────────────────────
  if (vh < 40) {
    ctx.globalAlpha = (1 - vh / 40) * 0.15;
    ctx.fillStyle = "#8b6a3b";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

// ─── IMPROVED DRAWING FUNCTIONS ───────────────────────────────────────────

// Soft radial ground shadow — reads as ambient occlusion instead of a hard blob
function softShadow(ctx, x, y, rx, ry, a = 0.3) {
  if (rx <= 0.5) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, Math.max(0.08, ry / rx));
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(10, 16, 8, ${a})`);
  g.addColorStop(0.65, `rgba(10, 16, 8, ${a * 0.5})`);
  g.addColorStop(1, "rgba(10, 16, 8, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Articulated quadruped leg: hip → knee → foot driven by a gait phase.
// amp scales stride length (walk vs run). Draws limb + hoof/paw.
function drawLeg(ctx, hipX, hipY, phase, len, amp, color, hoofColor, thick) {
  const swing = Math.sin(phase) * amp;
  const lift = Math.max(0, Math.sin(phase + Math.PI / 2)) * amp;
  const kneeX = hipX + swing * len * 0.32;
  const kneeY = hipY + len * 0.52 - lift * len * 0.10;
  const footX = hipX + swing * len * 0.62;
  const footY = hipY + len - lift * len * 0.30;
  ctx.strokeStyle = color;
  ctx.lineWidth = thick;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.quadraticCurveTo(kneeX, kneeY, footX, footY);
  ctx.stroke();
  ctx.fillStyle = hoofColor;
  ctx.beginPath();
  ctx.ellipse(footX + 0.4, footY + 0.2, thick * 0.62, thick * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTree(ctx, tree, vf, tick, season) {
  const s = tree.growth;
  const h = 12 + s * 24;
  const w = 6 + s * 16;
  const healthy = tree.health > 50;
  const sway = Math.sin(tick * 0.008 + tree.x * 0.03) * s * 2;
  const seasonIdx = season?.idx ?? 0;   // 0=spring, 1=summer, 2=autumn, 3=winter
  const seasonT = season?.t ?? 0;        // progress within season
  // Use tree.id as a stable pseudo-random to vary autumn colors across trees
  const idHash = tree.id ? tree.id.charCodeAt(0) : 0;

  // Shadow
  softShadow(ctx, tree.x + 5, tree.y + 4, Math.max(3, w * 0.55 * s + 2), 3.2, 0.32);

  // Trunk with bark texture
  const trunkGrad = ctx.createLinearGradient(tree.x - w / 4, tree.y - h * 0.4, tree.x + w / 4, tree.y - h * 0.4);
  trunkGrad.addColorStop(0, healthy ? "#7c3f1e" : "#4a2910");
  trunkGrad.addColorStop(0.5, healthy ? "#5c3c10" : "#3d2a0a");
  trunkGrad.addColorStop(1, healthy ? "#4a2910" : "#2d1f07");
  const tw = 2 + s * 2;
  ctx.fillStyle = trunkGrad;
  ctx.fillRect(tree.x - tw / 2 + sway * 0.3, tree.y - h * 0.38, tw, h * 0.5);

  // Bark lines detail
  if (s > 0.4) {
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(tree.x - tw / 2 + sway * 0.3 + i * 0.6, tree.y - h * 0.38);
      ctx.lineTo(tree.x - tw / 2 + sway * 0.3 + i * 0.6, tree.y - h * 0.38 + h * 0.5);
      ctx.stroke();
    }
  }

  // Choose tree type (willow vs conifer based on position)
  const isConifer = tree.x > (ctx.canvas ? ctx.canvas.width / (ctx.getTransform().a || 1) : 500) * 0.6;

  if (isConifer) {
    // Pointed conifer canopy
    const baseGreen = healthy ? lerpColor("#166534", "#22c55e", s * vf) : lerpColor("#854d0e", "#a16207", s);

    // Layered fronds with drooping tips — reads as a real spruce
    for (let tier = 0; tier < 4; tier++) {
      const tT = tier / 3;
      const fw = w * (0.2 + tT * 0.34);
      const fy = tree.y - h * (0.66 - tT * 0.34);
      const fh = h * 0.16;
      const tipX = tree.x + sway * (1 - tT * 0.5);
      ctx.fillStyle = lerpColor(lerpColor(baseGreen, "#4ade80", 0.28 * (1 - tT)), "#0f3f1f", tT * 0.35);
      ctx.beginPath();
      ctx.moveTo(tipX, fy - fh);
      ctx.quadraticCurveTo(tree.x + sway - fw * 0.5, fy - fh * 0.2, tree.x + sway - fw, fy + fh * 0.55);
      ctx.quadraticCurveTo(tree.x + sway - fw * 0.45, fy + fh * 0.28, tree.x + sway, fy + fh * 0.34);
      ctx.quadraticCurveTo(tree.x + sway + fw * 0.45, fy + fh * 0.28, tree.x + sway + fw, fy + fh * 0.55);
      ctx.quadraticCurveTo(tree.x + sway + fw * 0.5, fy - fh * 0.2, tipX, fy - fh);
      ctx.closePath();
      ctx.fill();
    }
    // rim light on the sunlit edge
    ctx.strokeStyle = `rgba(190, 240, 190, ${0.28 * vf})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(tree.x + sway, tree.y - h * 0.68);
    ctx.lineTo(tree.x + sway - w * 0.4, tree.y - h * 0.1);
    ctx.stroke();

    // WINTER: snow dusting on conifer branches
    if (seasonIdx === 3 && s > 0.3) {
      ctx.fillStyle = "rgba(250, 253, 255, 0.85)";
      // Snow on top point
      ctx.beginPath();
      ctx.moveTo(tree.x + sway, tree.y - h * 0.62);
      ctx.lineTo(tree.x + sway - w * 0.18, tree.y - h * 0.5);
      ctx.lineTo(tree.x + sway + w * 0.18, tree.y - h * 0.5);
      ctx.closePath();
      ctx.fill();
      // Snow on middle layer (partial)
      ctx.globalAlpha = 0.75;
      ctx.fillRect(tree.x + sway - w * 0.25, tree.y - h * 0.5, w * 0.5, 1.5);
      // Snow on bottom layer (light dusting on tips)
      ctx.globalAlpha = 0.5;
      ctx.fillRect(tree.x + sway - w * 0.4, tree.y - h * 0.38, w * 0.8, 1);
      ctx.globalAlpha = 1;
    }
  } else {
    // Round willow/aspen canopy — DECIDUOUS, changes with seasons
    if (seasonIdx === 3) {
      // WINTER: bare branches only, no canopy
      ctx.strokeStyle = healthy ? "rgba(80, 55, 30, 0.9)" : "rgba(60, 40, 20, 0.8)";
      ctx.lineWidth = 0.8 + s * 0.5;
      ctx.lineCap = "round";
      // Main branch fork
      const trunkTop = tree.y - h * 0.38;
      ctx.beginPath();
      ctx.moveTo(tree.x + sway, trunkTop);
      ctx.quadraticCurveTo(tree.x + sway - w * 0.25, trunkTop - h * 0.2, tree.x + sway - w * 0.35, trunkTop - h * 0.35);
      ctx.moveTo(tree.x + sway, trunkTop);
      ctx.quadraticCurveTo(tree.x + sway + w * 0.25, trunkTop - h * 0.2, tree.x + sway + w * 0.35, trunkTop - h * 0.35);
      ctx.moveTo(tree.x + sway, trunkTop);
      ctx.lineTo(tree.x + sway + (idHash % 3 - 1) * 2, trunkTop - h * 0.4);
      // Small twigs
      ctx.moveTo(tree.x + sway - w * 0.2, trunkTop - h * 0.25);
      ctx.lineTo(tree.x + sway - w * 0.3, trunkTop - h * 0.38);
      ctx.moveTo(tree.x + sway + w * 0.2, trunkTop - h * 0.25);
      ctx.lineTo(tree.x + sway + w * 0.3, trunkTop - h * 0.38);
      ctx.stroke();
      // Snow clinging to branches
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.beginPath();
      ctx.ellipse(tree.x + sway - w * 0.2, trunkTop - h * 0.22, 1.5, 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(tree.x + sway + w * 0.2, trunkTop - h * 0.22, 1.5, 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(tree.x + sway, trunkTop - h * 0.4, 1.5, 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Seasonal canopy color — varies with idHash for autumn variety
      let baseGreen, darkGreen;
      if (seasonIdx === 2) {
        // AUTUMN — choose among gold, orange, red, deep amber varied per tree
        const autumnPalette = [
          { b: "#d97706", d: "#92400e" }, // orange
          { b: "#eab308", d: "#a16207" }, // gold
          { b: "#dc2626", d: "#991b1b" }, // red
          { b: "#b45309", d: "#78350f" }, // amber
        ];
        const p = autumnPalette[idHash % 4];
        // Blend from summer green → autumn color based on seasonT
        const greenBase = healthy ? lerpColor("#166534", "#22c55e", s * vf) : lerpColor("#854d0e", "#a16207", s);
        const greenDark = healthy ? lerpColor("#14532d", "#166534", s * vf) : lerpColor("#713f12", "#854d0e", s);
        baseGreen = lerpColor(greenBase, p.b, seasonT);
        darkGreen = lerpColor(greenDark, p.d, seasonT);
      } else if (seasonIdx === 1) {
        // SUMMER — lush full green
        baseGreen = healthy ? lerpColor("#1f7a3f", "#2fd96a", s * vf) : lerpColor("#854d0e", "#a16207", s);
        darkGreen = healthy ? lerpColor("#165a2d", "#1f7a3f", s * vf) : lerpColor("#713f12", "#854d0e", s);
      } else {
        // SPRING — fresh green (default)
        baseGreen = healthy ? lerpColor("#166534", "#22c55e", s * vf) : lerpColor("#854d0e", "#a16207", s);
        darkGreen = healthy ? lerpColor("#14532d", "#166534", s * vf) : lerpColor("#713f12", "#854d0e", s);
      }

      // Clustered 5-lobe canopy — organic mass, lit from upper-left
      const lobes = [
        { dx: 0, dy: -0.5, r: 0.55, c: 0.18 },
        { dx: -0.4, dy: -0.4, r: 0.42, c: 0.32 },
        { dx: 0.42, dy: -0.43, r: 0.44, c: 0.05 },
        { dx: -0.18, dy: -0.62, r: 0.38, c: 0.48 },
        { dx: 0.22, dy: -0.6, r: 0.36, c: 0.32 },
      ];
      for (let li = 0; li < lobes.length; li++) {
        const L = lobes[(li + idHash) % lobes.length];
        const jx = ((idHash * 7 + li * 13) % 10 - 5) * 0.04;
        ctx.fillStyle = lerpColor(darkGreen, baseGreen, L.c + 0.15);
        ctx.beginPath();
        ctx.ellipse(tree.x + sway + (L.dx + jx) * w, tree.y + L.dy * h, w * L.r + 1.5, h * L.r * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // sunlit crown lobe
      const topTint = seasonIdx === 2 ? "#fcd34d" : "#7ee2a0";
      ctx.fillStyle = lerpColor(baseGreen, topTint, 0.35);
      ctx.beginPath();
      ctx.ellipse(tree.x + sway - w * 0.18, tree.y - h * 0.62, w * 0.3, h * 0.2, -0.3, 0, Math.PI * 2);
      ctx.fill();
      // dappled inner shadow for depth
      ctx.fillStyle = "rgba(10, 30, 12, 0.25)";
      ctx.beginPath();
      ctx.ellipse(tree.x + sway + w * 0.2, tree.y - h * 0.34, w * 0.34, h * 0.22, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Highlight
  if (healthy && s > 0.5) {
    ctx.fillStyle = `rgba(74, 222, 128, ${0.2 * s})`;
    ctx.beginPath();
    ctx.ellipse(tree.x + sway - 3, tree.y - h * 0.58, w * 0.25, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Damaged tree: broken branches
  if (tree.health < 50 && tree.health > 20) {
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(tree.x + sway + (i % 2 ? -1 : 1) * w * 0.3, tree.y - h * 0.2 - i * 5);
      ctx.lineTo(tree.x + sway + (i % 2 ? -1 : 1) * w * 0.5, tree.y - h * 0.05 - i * 8);
      ctx.stroke();
    }
  }

  // Dead tree: skeleton only
  if (tree.health <= 20) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#5c3f2c";
    ctx.fillRect(tree.x - tw / 2 + sway * 0.3, tree.y - h * 0.35, tw, h * 0.5);
    ctx.globalAlpha = 1;
  }
}

function drawWolf(ctx, wolf, tick) {
  const facing = wolf.vx >= 0 ? 1 : -1;
  ctx.translate(wolf.x, wolf.y);
  ctx.scale(facing, 1);

  const running = wolf.state === "chase" || wolf.state === "flee";
  const gait = wolf.age * (running ? 0.42 : 0.13);
  const amp = running ? 1 : 0.55;
  const bodyBob = Math.sin(gait * 2) * (running ? 1.1 : 0.4);
  const stretch = running ? 1.08 : 1;

  softShadow(ctx, 0, 10.5, 15, 3.6, 0.34);

  // far-side legs (darker, behind body)
  drawLeg(ctx, -8.5, 3.5, gait + Math.PI, 8.5, amp, "#3f4c5c", "#22262e", 2.2);
  drawLeg(ctx, 7, 3.2, gait + Math.PI * 1.45, 8.8, amp, "#3f4c5c", "#22262e", 2.2);

  // bushy tail — three tapered layers; streams back at speed
  const tailBase = running ? 0.15 : -0.35;
  const wag = Math.sin(wolf.age * 0.09) * (running ? 0.06 : 0.16);
  const tailShades = ["#55636f", "#75828f", "#8d99a5"];
  for (let t = 0; t < 3; t++) {
    ctx.strokeStyle = tailShades[t];
    ctx.lineWidth = 4.2 - t * 1.1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-12 * stretch, -3);
    ctx.quadraticCurveTo(-17 - t * 0.5, -3 + (tailBase + wag) * 14, -20 - t * 1.2, -1 + (tailBase + wag) * 26);
    ctx.stroke();
  }

  // body — deep chest, tucked waist
  const bodyGrad = ctx.createLinearGradient(0, -9, 0, 4);
  bodyGrad.addColorStop(0, "#4e5a66");
  bodyGrad.addColorStop(0.62, "#7f8c98");
  bodyGrad.addColorStop(1, "#a9b4bf");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-12 * stretch, -4 + bodyBob * 0.4);
  ctx.bezierCurveTo(-9, -8 + bodyBob, -2, -8.6 + bodyBob, 3, -7.4 + bodyBob);
  ctx.bezierCurveTo(6.5, -6.8, 9.5, -5.4, 10.5, -3.4);
  ctx.bezierCurveTo(10.6, 0.2, 8.2, 2.3, 5.5, 2.9);
  ctx.bezierCurveTo(1.5, 3.6, -2.5, 2.7, -5.5, 1.8);
  ctx.bezierCurveTo(-9.5, 1.2, -12.5, -0.5, -12 * stretch, -4 + bodyBob * 0.4);
  ctx.closePath();
  ctx.fill();

  // dark dorsal saddle
  ctx.fillStyle = "rgba(46, 56, 68, 0.72)";
  ctx.beginPath();
  ctx.moveTo(-10, -5 + bodyBob * 0.6);
  ctx.quadraticCurveTo(-2, -8.8 + bodyBob, 6, -6.6 + bodyBob * 0.5);
  ctx.quadraticCurveTo(0, -4.5, -10, -5 + bodyBob * 0.6);
  ctx.fill();

  // rim light along the back
  ctx.strokeStyle = "rgba(226, 236, 246, 0.5)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-11, -5 + bodyBob * 0.5);
  ctx.quadraticCurveTo(-2, -8.9 + bodyBob, 5.5, -7 + bodyBob * 0.5);
  ctx.stroke();

  // near-side legs
  drawLeg(ctx, -7, 3.8, gait, 9.5, amp, "#5b6874", "#2b3038", 2.6);
  drawLeg(ctx, 6, 3.6, gait + Math.PI * 0.45, 9.8, amp, "#5b6874", "#2b3038", 2.6);

  // dust kicked up at speed
  if (running && wolf.age % 5 < 2) {
    ctx.fillStyle = "rgba(139, 117, 94, 0.3)";
    ctx.beginPath();
    ctx.arc(-13 - Math.sin(gait) * 3, 9, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // neck ruff + head
  const headLift = running ? 1.5 : 0;
  const hx = 12.5 + headLift, hy = -7.5 + headLift * 0.8 + bodyBob * 0.3;
  ctx.fillStyle = "#78858f";
  ctx.beginPath();
  ctx.ellipse(9, -5 + bodyBob * 0.3, 4.4, 5.2, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#828f9b";
  ctx.beginPath();
  ctx.ellipse(hx, hy, 4.6, 3.8, -0.15, 0, Math.PI * 2);
  ctx.fill();
  // muzzle wedge
  ctx.fillStyle = "#9aa5b0";
  ctx.beginPath();
  ctx.moveTo(hx + 2, hy - 2.2);
  ctx.quadraticCurveTo(hx + 7.5, hy - 0.8, hx + 8.2, hy + 0.6);
  ctx.lineTo(hx + 3.5, hy + 2.6);
  ctx.quadraticCurveTo(hx + 2, hy + 1.5, hx + 2, hy - 2.2);
  ctx.closePath();
  ctx.fill();
  // pale cheek/chin
  ctx.fillStyle = "#c9d1d9";
  ctx.beginPath();
  ctx.ellipse(hx + 2.2, hy + 1.8, 2.6, 1.5, 0.35, 0, Math.PI * 2);
  ctx.fill();
  // nose
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.ellipse(hx + 7.8, hy + 0.4, 1.1, 0.9, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // open jaw + teeth when chasing
  if (wolf.state === "chase") {
    ctx.fillStyle = "#7f1d1d";
    ctx.beginPath();
    ctx.moveTo(hx + 3.5, hy + 2.2);
    ctx.lineTo(hx + 7.6, hy + 1.4);
    ctx.lineTo(hx + 6.8, hy + 3.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f5f5f4";
    ctx.beginPath();
    ctx.moveTo(hx + 4.2, hy + 2.15); ctx.lineTo(hx + 4.9, hy + 3.05); ctx.lineTo(hx + 5.5, hy + 2.0);
    ctx.moveTo(hx + 5.9, hy + 1.9); ctx.lineTo(hx + 6.5, hy + 2.8); ctx.lineTo(hx + 7.0, hy + 1.7);
    ctx.closePath();
    ctx.fill();
  }
  // ears — pinned back in a chase
  const earBack = wolf.state === "chase" ? 2.2 : 0;
  ctx.fillStyle = "#5b6874";
  ctx.beginPath();
  ctx.moveTo(hx - 3.5 - earBack, hy - 2.5);
  ctx.lineTo(hx - 4.5 - earBack * 1.4, hy - 8.5 + earBack);
  ctx.lineTo(hx - 0.8 - earBack, hy - 3.6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(hx - 0.5 - earBack * 0.6, hy - 3.4);
  ctx.lineTo(hx + 0.8 - earBack, hy - 8.8 + earBack);
  ctx.lineTo(hx + 2.6, hy - 3.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#cbd5df";
  ctx.beginPath();
  ctx.moveTo(hx - 3.2 - earBack, hy - 3.2);
  ctx.lineTo(hx - 3.9 - earBack * 1.3, hy - 6.8 + earBack);
  ctx.lineTo(hx - 1.6 - earBack, hy - 3.8);
  ctx.closePath();
  ctx.fill();
  // amber eye
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.ellipse(hx + 1.2, hy - 1.4, 1.35, 1.1, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(hx + 1.6, hy - 1.4, 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(hx + 1.0, hy - 1.8, 0.32, 0, Math.PI * 2);
  ctx.fill();

  // chase pulse indicator (kept)
  if (wolf.state === "chase") {
    ctx.fillStyle = "rgba(239, 68, 68, 0.7)";
    ctx.beginPath();
    ctx.arc(0, -18, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // howl rings (kept)
  if (wolf.state === "wander" && wolf.howling) {
    const howlPhase = Math.sin(wolf.age * 0.04) * 0.5 + 0.5;
    ctx.strokeStyle = `rgba(226, 232, 240, ${0.55 * howlPhase})`;
    ctx.lineWidth = 1;
    for (let ring = 0; ring < 3; ring++) {
      const r = 6 + ring * 4 + howlPhase * 3;
      ctx.beginPath();
      ctx.arc(hx + 6, hy - 3, r, -Math.PI * 0.85, -Math.PI * 0.35);
      ctx.stroke();
    }
  }
}

function drawElk(ctx, elk, tick) {
  const facing = elk.vx >= 0 ? 1 : -1;
  ctx.translate(elk.x, elk.y);
  ctx.scale(facing, 1);

  const running = elk.state === "flee";
  const grazing = elk.state === "graze";
  const gait = elk.age * (running ? 0.4 : 0.1);
  const amp = running ? 1 : 0.5;
  const bob = Math.sin(gait * 2) * (running ? 1.2 : 0.35);

  softShadow(ctx, 0, 13.5, 18, 3.6, 0.38);

  // far legs
  drawLeg(ctx, -9.5, 4.5, gait + Math.PI, 10.5, amp, "#6b4a26", "#241a10", 2.4);
  drawLeg(ctx, 8, 4.2, gait + Math.PI * 1.45, 10.8, amp, "#6b4a26", "#241a10", 2.4);

  // cream rump patch — signature elk marking
  ctx.fillStyle = "#e8d9b5";
  ctx.beginPath();
  ctx.ellipse(-12.5, -2.5 + bob * 0.4, 4.2, 5.2, 0.25, 0, Math.PI * 2);
  ctx.fill();

  // body — barrel, shoulder hump, sloped rump
  const bodyGrad = ctx.createLinearGradient(0, -9, 0, 6);
  bodyGrad.addColorStop(0, "#9a6b35");
  bodyGrad.addColorStop(0.6, "#b08347");
  bodyGrad.addColorStop(1, "#8a6032");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-13, -2 + bob * 0.4);
  ctx.bezierCurveTo(-12, -7.5 + bob, -6, -9 + bob, 0, -8.6 + bob);
  ctx.bezierCurveTo(4, -8.4 + bob, 7, -9.6 + bob, 9.5, -7.8 + bob);
  ctx.bezierCurveTo(12, -5.5, 12.5, -0.5, 10.5, 2.8);
  ctx.bezierCurveTo(6, 5.6, -3, 5.8, -8, 4.4);
  ctx.bezierCurveTo(-11.5, 3.2, -13.5, 1.5, -13, -2 + bob * 0.4);
  ctx.closePath();
  ctx.fill();

  // rim light on back
  ctx.strokeStyle = "rgba(245, 226, 188, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-12, -4.5 + bob * 0.5);
  ctx.quadraticCurveTo(-2, -9.3 + bob, 8.5, -8.2 + bob * 0.6);
  ctx.stroke();

  // near legs
  drawLeg(ctx, -8, 5, gait, 11.5, amp, "#7a5228", "#2b1f12", 2.8);
  drawLeg(ctx, 7, 4.8, gait + Math.PI * 0.45, 11.8, amp, "#7a5228", "#2b1f12", 2.8);

  // dust when fleeing
  if (running && elk.age % 4 < 2) {
    ctx.fillStyle = "rgba(139, 117, 94, 0.35)";
    ctx.beginPath();
    ctx.arc(-14 - Math.sin(gait) * 3, 11, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // neck + head — raised normally, LOWERED to the grass when grazing
  const p = grazing ? (0.55 + Math.sin(elk.age * 0.05) * 0.45) : 0;
  const nx = 12.5 + p * 1.0, ny = -13 + p * 10;
  const hx = 16 + p * 1.5, hy = -16.5 + p * 23;

  // neck — dark brown mane (elk two-tone)
  ctx.strokeStyle = "#5b3d20";
  ctx.lineWidth = 6.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(8.5, -6 + bob * 0.5);
  ctx.quadraticCurveTo(nx - 1, ny + 2, nx, ny);
  ctx.stroke();

  // head — long muzzle, rotates down while grazing
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(p * 0.9 - 0.1);
  ctx.fillStyle = "#7a5228";
  ctx.beginPath();
  ctx.ellipse(0, 0, 5.4, 3.1, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8f6535";
  ctx.beginPath();
  ctx.ellipse(3.2, 1.6, 2.4, 1.6, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(4.8, 2.6, 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5b3d20";
  ctx.beginPath();
  ctx.ellipse(-3.4, -2.6, 1.5, 2.7, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(-0.6, -1.1, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,230,150,0.7)";
  ctx.beginPath();
  ctx.arc(-0.9, -1.4, 0.35, 0, Math.PI * 2);
  ctx.fill();

  // antlers — two beams swept back with tines (drawn in head space)
  ctx.strokeStyle = "#e2d9c8";
  ctx.lineWidth = 1.7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-1.5, -2.8);
  ctx.bezierCurveTo(-3.5, -8, -7.5, -11.5, -12.5, -12.5);
  ctx.moveTo(-2.8, -5.6); ctx.lineTo(-1.2, -9.2);
  ctx.moveTo(-4.8, -8.2); ctx.lineTo(-3.4, -12);
  ctx.moveTo(-7.6, -10.4); ctx.lineTo(-6.8, -14.4);
  ctx.moveTo(-10.4, -11.8); ctx.lineTo(-10.6, -15.8);
  ctx.stroke();
  ctx.strokeStyle = "#c9bfae";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0.6, -2.6);
  ctx.bezierCurveTo(-0.6, -7.5, -3.6, -11, -8, -13.6);
  ctx.moveTo(-0.6, -5.4); ctx.lineTo(1.4, -8.6);
  ctx.moveTo(-2.4, -8.0); ctx.lineTo(-1.0, -11.6);
  ctx.moveTo(-5.0, -10.6); ctx.lineTo(-4.4, -14.2);
  ctx.stroke();
  ctx.restore();

  // graze cue (kept)
  if (grazing) {
    ctx.fillStyle = "rgba(34, 197, 94, 0.5)";
    ctx.beginPath();
    ctx.arc(hx + 3, 11.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // alarm tail-flash when fleeing (kept)
  if (running) {
    ctx.fillStyle = "rgba(255, 245, 220, 0.9)";
    ctx.beginPath();
    ctx.ellipse(-13.5, -5 + bob * 0.4, 2.2, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBeaver(ctx, e, tick) {
  softShadow(ctx, e.x + 2, e.y + 5.5, 9, 2.5, 0.36);

  const slapActive = e.tailSlap && e.tailSlap > 0;
  const slapT = slapActive ? 1 - e.tailSlap / 30 : 0;
  const waddle = Math.sin(e.age * 0.15) * 0.08;

  // scaly paddle tail — lifts and slaps
  const tailLift = slapActive ? Math.sin(slapT * Math.PI) * 5 : 0;
  ctx.save();
  ctx.translate(e.x - 7, e.y + 1.5);
  ctx.rotate(0.28 - tailLift * 0.12 + waddle);
  const tailGrad = ctx.createLinearGradient(-9, 0, 0, 0);
  tailGrad.addColorStop(0, "#3f2c1e");
  tailGrad.addColorStop(1, "#5c3f2c");
  ctx.fillStyle = tailGrad;
  ctx.beginPath();
  ctx.ellipse(-4, -tailLift, 5.8, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.lineWidth = 0.5;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(-8.5, -tailLift + i * 1.1);
    ctx.lineTo(-0.5, -tailLift + i * 1.1);
    ctx.stroke();
  }
  ctx.restore();

  // slap ripples (kept)
  if (slapActive) {
    ctx.strokeStyle = `rgba(200, 230, 255, ${0.6 * (1 - slapT)})`;
    ctx.lineWidth = 1.2;
    for (let ring = 0; ring < 3; ring++) {
      const rad = 3 + slapT * 16 + ring * 4;
      ctx.beginPath();
      ctx.arc(e.x - 9, e.y + 3, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // chunky pear body
  const bg = ctx.createRadialGradient(e.x + 2, e.y - 2, 1, e.x, e.y, 9.5);
  bg.addColorStop(0, "#a8713f");
  bg.addColorStop(0.6, "#8b5a2b");
  bg.addColorStop(1, "#6e4520");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, 8, 5.4, waddle, 0, Math.PI * 2);
  ctx.fill();

  // wet-fur sheen
  ctx.strokeStyle = "rgba(230, 200, 160, 0.35)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(e.x - 1, e.y - 2.5, 5.5, 2.2, waddle - 0.15, Math.PI * 1.05, Math.PI * 1.9);
  ctx.stroke();

  // head
  ctx.fillStyle = "#7a4e24";
  ctx.beginPath();
  ctx.ellipse(e.x + 6.5, e.y - 1.5, 3.8, 3.2, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5c3a1a";
  ctx.beginPath();
  ctx.arc(e.x + 4.6, e.y - 4.2, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#96662f";
  ctx.beginPath();
  ctx.ellipse(e.x + 7.8, e.y + 0.2, 2, 1.6, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#241812";
  ctx.beginPath();
  ctx.ellipse(e.x + 9.8, e.y - 1.6, 1, 0.8, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(e.x + 6.2, e.y - 2.6, 0.95, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.arc(e.x + 5.9, e.y - 2.9, 0.35, 0, Math.PI * 2);
  ctx.fill();

  // buck teeth (kept)
  ctx.fillStyle = "#fef3c7";
  ctx.fillRect(e.x + 8.6, e.y + 0.4, 1.1, 2.6);
  ctx.fillRect(e.x + 9.9, e.y + 0.4, 1.1, 2.6);
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 0.4;
  ctx.strokeRect(e.x + 8.6, e.y + 0.4, 1.1, 2.6);
  ctx.strokeRect(e.x + 9.9, e.y + 0.4, 1.1, 2.6);

  // little front paws
  ctx.fillStyle = "#5c3f2c";
  ctx.beginPath(); ctx.ellipse(e.x + 4.5, e.y + 2.8, 1.3, 0.9, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(e.x + 6.8, e.y + 3, 1.3, 0.9, 0.3, 0, Math.PI * 2); ctx.fill();
}

function drawCoyote(ctx, e, tick) {
  const facing = e.vx >= 0 ? 1 : -1;
  ctx.translate(e.x, e.y);
  ctx.scale(facing, 1);

  const gait = e.age * 0.17;
  const amp = 0.7;
  const bob = Math.sin(gait * 2) * 0.4;

  softShadow(ctx, 0, 7.5, 10, 2.6, 0.28);

  // far legs — thin
  drawLeg(ctx, -5.5, 2.5, gait + Math.PI, 6.2, amp, "#a4713d", "#3a2a16", 1.5);
  drawLeg(ctx, 4.5, 2.3, gait + Math.PI * 1.45, 6.4, amp, "#a4713d", "#3a2a16", 1.5);

  // tail — carried LOW, black tip (coyote ID vs wolf)
  ctx.lineCap = "round";
  ctx.strokeStyle = "#c98d52";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-8, -0.5);
  ctx.quadraticCurveTo(-11.5, 3.5, -13, 6.5 + Math.sin(e.age * 0.1) * 1);
  ctx.stroke();
  ctx.strokeStyle = "#2b2018";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-12.4, 5.2);
  ctx.lineTo(-13.2, 7 + Math.sin(e.age * 0.1) * 1);
  ctx.stroke();

  // lean body
  const bodyGrad = ctx.createLinearGradient(0, -6, 0, 3);
  bodyGrad.addColorStop(0, "#9c7040");
  bodyGrad.addColorStop(0.55, "#c99a5e");
  bodyGrad.addColorStop(1, "#e8d3ae");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-8.5, -2 + bob * 0.4);
  ctx.bezierCurveTo(-6.5, -5.8 + bob, -1, -6.2 + bob, 3, -5.4 + bob);
  ctx.bezierCurveTo(6, -4.8, 7.5, -3, 7.8, -1.4);
  ctx.bezierCurveTo(8, 1, 6, 2.4, 3.5, 2.7);
  ctx.bezierCurveTo(0, 3.1, -3.5, 2.2, -5.5, 1.4);
  ctx.bezierCurveTo(-7.8, 0.5, -9, -0.5, -8.5, -2 + bob * 0.4);
  ctx.closePath();
  ctx.fill();

  // grizzled back wash
  ctx.fillStyle = "rgba(90, 80, 66, 0.35)";
  ctx.beginPath();
  ctx.moveTo(-7, -3 + bob * 0.5);
  ctx.quadraticCurveTo(-1, -6.3 + bob, 4.5, -4.8 + bob * 0.5);
  ctx.quadraticCurveTo(-1, -3.4, -7, -3 + bob * 0.5);
  ctx.fill();

  // near legs
  drawLeg(ctx, -4.5, 2.8, gait, 7, amp, "#b8834a", "#453218", 1.7);
  drawLeg(ctx, 4, 2.6, gait + Math.PI * 0.45, 7.2, amp, "#b8834a", "#453218", 1.7);

  // narrow head
  const hx = 9.5, hy = -4.5 + bob * 0.3;
  ctx.fillStyle = "#b8834a";
  ctx.beginPath();
  ctx.ellipse(hx, hy, 3.4, 2.7, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d9ad72";
  ctx.beginPath();
  ctx.moveTo(hx + 1.5, hy - 1.4);
  ctx.lineTo(hx + 6.2, hy + 0.4);
  ctx.lineTo(hx + 1.8, hy + 1.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(hx + 6, hy + 0.4, 0.55, 0, Math.PI * 2);
  ctx.fill();

  // oversized pointed ears (coyote signature)
  ctx.fillStyle = "#a4713d";
  ctx.beginPath();
  ctx.moveTo(hx - 2.8, hy - 1.6);
  ctx.lineTo(hx - 4.2, hy - 8);
  ctx.lineTo(hx - 0.6, hy - 2.4);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(hx - 0.2, hy - 2.3);
  ctx.lineTo(hx + 1.6, hy - 7.6);
  ctx.lineTo(hx + 2.6, hy - 1.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ecd3ae";
  ctx.beginPath();
  ctx.moveTo(hx - 2.6, hy - 2.2);
  ctx.lineTo(hx - 3.5, hy - 6.4);
  ctx.lineTo(hx - 1.3, hy - 2.7);
  ctx.closePath();
  ctx.fill();

  // eye
  ctx.fillStyle = "#f5c96b";
  ctx.beginPath();
  ctx.ellipse(hx + 0.7, hy - 0.9, 1, 0.85, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(hx + 1, hy - 0.9, 0.45, 0, Math.PI * 2);
  ctx.fill();
}

function drawFish(ctx, e, tick) {
  const phase = Math.sin(tick * 0.06 + e.id.charCodeAt(0)) * 2.5;
  // Cutthroat trout palette — visible against blue water
  // Deep olive back, silver-pink belly, distinct red gill stripe
  ctx.save();

  // Body — darker olive top half (visible against cyan river)
  const bodyGrad = ctx.createLinearGradient(e.x, e.y - 3, e.x, e.y + 3);
  bodyGrad.addColorStop(0, "#3a5a44");      // dark olive top
  bodyGrad.addColorStop(0.45, "#5c8050");   // mid olive
  bodyGrad.addColorStop(0.55, "#c8b890");   // pale belly line
  bodyGrad.addColorStop(1, "#e6dec5");      // cream belly
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, 7, 3, phase * 0.08, 0, Math.PI * 2);
  ctx.fill();

  // Red cutthroat slash under jaw (signature mark)
  ctx.strokeStyle = "rgba(220, 80, 70, 0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(e.x + 2, e.y + 1);
  ctx.lineTo(e.x + 4.5, e.y + 1.4);
  ctx.stroke();

  // Dark spots along back (trout pattern)
  ctx.fillStyle = "rgba(20, 30, 20, 0.7)";
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.arc(e.x + i * 1.5, e.y - 1.2, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tail — forked
  ctx.fillStyle = "#3a5a44";
  ctx.beginPath();
  ctx.moveTo(e.x - 7, e.y);
  ctx.lineTo(e.x - 10.5, e.y - 3.8);
  ctx.lineTo(e.x - 9, e.y);
  ctx.lineTo(e.x - 10.5, e.y + 3.8);
  ctx.closePath();
  ctx.fill();

  // Dorsal fin — top
  ctx.fillStyle = "#4a6a52";
  ctx.beginPath();
  ctx.moveTo(e.x - 1, e.y - 3);
  ctx.lineTo(e.x + 2, e.y - 4.2);
  ctx.lineTo(e.x + 3, e.y - 2.8);
  ctx.closePath();
  ctx.fill();

  // Pectoral fin (small)
  ctx.fillStyle = "rgba(70, 100, 80, 0.7)";
  ctx.beginPath();
  ctx.ellipse(e.x + 1, e.y + 2, 1.5, 0.7, 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Eye — bright
  ctx.fillStyle = "#fef3c7";
  ctx.beginPath();
  ctx.arc(e.x + 4, e.y - 0.7, 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(e.x + 4.2, e.y - 0.7, 0.55, 0, Math.PI * 2);
  ctx.fill();

  // surface ripple ring — expands and fades as the trout rises
  const ripT = (e.age % 70) / 70;
  if (ripT < 0.5) {
    ctx.strokeStyle = `rgba(210, 235, 255, ${0.4 * (1 - ripT * 2)})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, 4 + ripT * 14, (4 + ripT * 14) * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBird(ctx, e) {
  const wing = Math.sin(e.flutterPhase) * 7;
  const bob = Math.sin(e.flutterPhase * 0.7) * 2;
  // Mountain bluebird palette — vivid blue back, rust breast, white belly
  // Real Yellowstone songbird, much more visible than yellow-on-green
  ctx.save();

  // Shadow
  softShadow(ctx, e.x, e.y + 9, 5.5, 1.6, 0.22);

  // Body — rust breast, blue back
  const bodyGrad = ctx.createLinearGradient(e.x, e.y - 3 + bob, e.x, e.y + 3 + bob);
  bodyGrad.addColorStop(0, "#2563eb");      // bright blue back
  bodyGrad.addColorStop(0.5, "#3b82f6");
  bodyGrad.addColorStop(0.55, "#c2410c");   // rust breast line
  bodyGrad.addColorStop(1, "#fef3c7");      // pale belly
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + bob, 4.5, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head — bright blue
  ctx.fillStyle = "#1d4ed8";
  ctx.beginPath();
  ctx.arc(e.x + 3, e.y - 1.5 + bob, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Crown highlight
  ctx.fillStyle = "rgba(96, 165, 250, 0.7)";
  ctx.beginPath();
  ctx.arc(e.x + 2.5, e.y - 2.5 + bob, 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Beak — sharp dark triangle
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.moveTo(e.x + 5, e.y - 1.5 + bob);
  ctx.lineTo(e.x + 7.5, e.y - 1.2 + bob);
  ctx.lineTo(e.x + 5, e.y - 0.5 + bob);
  ctx.closePath();
  ctx.fill();

  // Wings — bright blue with curved motion + secondary feather detail
  ctx.strokeStyle = "#1e40af";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(e.x - 2, e.y + bob);
  ctx.quadraticCurveTo(e.x - 7, e.y - wing + bob, e.x - 9.5, e.y - wing * 0.6 + bob);
  ctx.moveTo(e.x + 1, e.y + bob);
  ctx.quadraticCurveTo(e.x + 5, e.y - wing + bob, e.x + 7.5, e.y - wing * 0.6 + bob);
  ctx.stroke();

  // Wing tip lighter highlight
  ctx.strokeStyle = "rgba(147, 197, 253, 0.8)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(e.x - 5, e.y - wing * 0.7 + bob);
  ctx.lineTo(e.x - 9, e.y - wing * 0.6 + bob);
  ctx.moveTo(e.x + 4, e.y - wing * 0.7 + bob);
  ctx.lineTo(e.x + 7, e.y - wing * 0.6 + bob);
  ctx.stroke();

  // wing motion blur on the downstroke
  if (wing > 3) {
    ctx.strokeStyle = "rgba(147, 197, 253, 0.3)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(e.x - 2, e.y + bob);
    ctx.quadraticCurveTo(e.x - 7, e.y - wing * 0.5 + bob, e.x - 9.5, e.y - wing * 0.3 + bob);
    ctx.moveTo(e.x + 1, e.y + bob);
    ctx.quadraticCurveTo(e.x + 5, e.y - wing * 0.5 + bob, e.x + 7.5, e.y - wing * 0.3 + bob);
    ctx.stroke();
  }

  // Tail feathers — split V
  ctx.strokeStyle = "#1e40af";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(e.x - 3, e.y + 1 + bob);
  ctx.lineTo(e.x - 5.5, e.y + 3.5 + bob);
  ctx.moveTo(e.x - 3, e.y + 1 + bob);
  ctx.lineTo(e.x - 5, e.y + 4.5 + bob);
  ctx.stroke();

  // Eye
  ctx.fillStyle = "#fef3c7";
  ctx.beginPath();
  ctx.arc(e.x + 3.4, e.y - 2.1 + bob, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(e.x + 3.6, e.y - 2.2 + bob, 0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawRabbit(ctx, e, tick) {
  const hopT = e.state === "flee" ? Math.sin(e.age * 0.3) : 0;
  const hop = Math.abs(hopT) * 4;
  const earTilt = e.state === "flee" ? -0.5 : 0;

  // Shadow
  softShadow(ctx, e.x, e.y + 5, 5.5, 2.0, 0.22);

  // Body
  ctx.fillStyle = "#e5e7eb";
  ctx.beginPath();
  ctx.ellipse(e.x, e.y - hop, 5.5 + hop * 0.35, 3.5 - hop * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = "#f3f4f6";
  ctx.beginPath();
  ctx.arc(e.x + 3.5, e.y - 2.5 - hop, 3, 0, Math.PI * 2);
  ctx.fill();

  // Ears - prominent
  ctx.fillStyle = "#d1d5db";
  ctx.beginPath();
  ctx.ellipse(e.x + 1.5, e.y - 8 - hop, 1.5, 4.5, -0.15 + earTilt, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(e.x + 4.5, e.y - 8 - hop, 1.5, 4.5, 0.15 + earTilt, 0, Math.PI * 2);
  ctx.fill();

  // Inner ears - pink
  ctx.fillStyle = "#fecaca";
  ctx.beginPath();
  ctx.ellipse(e.x + 1.5, e.y - 8 - hop, 0.75, 2.5, -0.15 + earTilt, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(e.x + 4.5, e.y - 8 - hop, 0.75, 2.5, 0.15 + earTilt, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = "#fda4af";
  ctx.beginPath();
  ctx.arc(e.x + 5, e.y - 2 - hop, 0.6, 0, Math.PI * 2);
  ctx.fill();

  // Cotton tail - fluffy
  ctx.fillStyle = "#f8f8f8";
  ctx.beginPath();
  ctx.arc(e.x - 5, e.y - hop, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.arc(e.x - 5.5, e.y - 1 - hop, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(e.x + 5.5, e.y - 3 - hop, 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fef3c7";
  ctx.beginPath();
  ctx.arc(e.x + 5.8, e.y - 3.3 - hop, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Whiskers
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(e.x + 5.5, e.y - 2.5 - hop);
  ctx.lineTo(e.x + 8, e.y - 2 - hop);
  ctx.moveTo(e.x + 5.5, e.y - 1.5 - hop);
  ctx.lineTo(e.x + 8, e.y - 1.5 - hop);
  ctx.stroke();
}

function drawBear(ctx, e, tick) {
  const facing = e.vx >= 0 ? 1 : -1;
  ctx.translate(e.x, e.y);
  ctx.scale(facing, 1);

  const gait = e.age * 0.09;
  const bob = Math.sin(gait * 2) * 0.8;
  const paceF = Math.sin(gait) * 2.6;
  const paceB = Math.sin(gait + Math.PI * 0.85) * 2.6;

  softShadow(ctx, 0, 11, 16, 3.8, 0.4);

  // far legs — thick columns
  ctx.strokeStyle = "#4a2f18";
  ctx.lineWidth = 4.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-8, 3); ctx.lineTo(-8 - paceB, 10.5);
  ctx.moveTo(7.5, 2.5); ctx.lineTo(7.5 - paceF, 10.5);
  ctx.stroke();

  // massive body — high shoulder hump, low rump
  const bodyGrad = ctx.createLinearGradient(0, -11, 0, 6);
  bodyGrad.addColorStop(0, "#7c5230");
  bodyGrad.addColorStop(0.55, "#6b4226");
  bodyGrad.addColorStop(1, "#503018");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-13.5, 0 + bob * 0.4);
  ctx.bezierCurveTo(-13.5, -6.5 + bob, -8, -8.5 + bob, -3.5, -8.2 + bob);
  ctx.bezierCurveTo(0.5, -11.8 + bob, 5, -11.4 + bob, 7, -8.2 + bob);
  ctx.bezierCurveTo(9.5, -6.5, 11, -3.5, 11, -1);
  ctx.bezierCurveTo(11, 2.8, 7, 5.4, 1, 5.6);
  ctx.bezierCurveTo(-5, 5.8, -13.5, 5, -13.5, 0 + bob * 0.4);
  ctx.closePath();
  ctx.fill();

  // shaggy belly fringe
  ctx.strokeStyle = "rgba(40, 24, 12, 0.5)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const fx = -9 + i * 3.6;
    ctx.beginPath();
    ctx.moveTo(fx, 4.6 + (i % 2) * 0.6);
    ctx.lineTo(fx - 0.8, 6.4 + (i % 2) * 0.6);
    ctx.stroke();
  }

  // rim light on the hump
  ctx.strokeStyle = "rgba(220, 190, 150, 0.4)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-3, -8.6 + bob);
  ctx.quadraticCurveTo(2.5, -11.9 + bob, 6.5, -8.6 + bob);
  ctx.stroke();

  // near legs + paws with claws
  ctx.strokeStyle = "#5c3a1e";
  ctx.lineWidth = 5.2;
  ctx.beginPath();
  ctx.moveTo(-6.5, 3.5); ctx.lineTo(-6.5 + paceB, 11);
  ctx.moveTo(9, 3); ctx.lineTo(9 + paceF, 11);
  ctx.stroke();
  ctx.fillStyle = "#3a2410";
  ctx.beginPath(); ctx.ellipse(-6.5 + paceB, 11.2, 3, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(9 + paceF, 11.2, 3, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#d6c9b0";
  ctx.lineWidth = 0.7;
  for (let c = 0; c < 3; c++) {
    ctx.beginPath();
    ctx.moveTo(9 + paceF + 1 + c, 10.8);
    ctx.lineTo(9 + paceF + 1.8 + c, 11.9);
    ctx.stroke();
  }

  // head — carried low and forward
  const hx = 13, hy = -3 + bob * 0.5;
  ctx.fillStyle = "#6b4226";
  ctx.beginPath();
  ctx.ellipse(hx, hy, 5, 4.2, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#a97b4a";
  ctx.beginPath();
  ctx.ellipse(hx + 3.8, hy + 1, 2.6, 1.8, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.ellipse(hx + 6, hy + 1.4, 1.15, 0.9, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7a4a2a";
  ctx.beginPath(); ctx.arc(hx - 2.6, hy - 4, 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#503018";
  ctx.beginPath(); ctx.arc(hx - 2.6, hy - 4, 1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath(); ctx.arc(hx + 0.6, hy - 1, 0.75, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath(); ctx.arc(hx + 0.35, hy - 1.25, 0.28, 0, Math.PI * 2); ctx.fill();
}

function drawHunter(ctx, e, tick) {
  const facing = e.vx >= 0 ? 1 : -1;
  ctx.translate(e.x, e.y);
  ctx.scale(facing, 1);
  const lp = Math.sin(e.age * 0.08) * 2.8;

  softShadow(ctx, 0, 12.5, 9, 2.8, 0.32);

  // legs — olive pants
  ctx.strokeStyle = "#4d5136";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-1.5, 4); ctx.lineTo(-2.5 + lp, 11);
  ctx.moveTo(1.5, 4); ctx.lineTo(2.5 - lp, 11);
  ctx.stroke();
  // boots
  ctx.fillStyle = "#2d2013";
  ctx.beginPath(); ctx.ellipse(-2.5 + lp + 0.8, 11.6, 2.2, 1.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(2.5 - lp + 0.8, 11.6, 2.2, 1.1, 0, 0, Math.PI * 2); ctx.fill();

  // torso — olive jacket under blaze-orange vest
  ctx.fillStyle = "#57603c";
  ctx.fillRect(-5, -7, 10, 12);
  ctx.fillStyle = "#f97316";
  ctx.fillRect(-3.6, -6.4, 7.2, 10.6);
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -6.4); ctx.lineTo(0, 4);
  ctx.stroke();

  // rear arm
  ctx.strokeStyle = "#4a5232";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-4, -3); ctx.lineTo(-6.5, 1.5);
  ctx.stroke();

  // rifle — slung, barrel up-forward
  ctx.strokeStyle = "#3f3f46";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.lineTo(14, -9);
  ctx.stroke();
  ctx.strokeStyle = "#7c4a1e";
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(2.5, 0);
  ctx.lineTo(8.5, -4.6);
  ctx.stroke();

  // front arm to the rifle
  ctx.strokeStyle = "#616b42";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(4, -3); ctx.lineTo(8, -4.5);
  ctx.stroke();
  ctx.fillStyle = "#e8b88a";
  ctx.beginPath(); ctx.arc(8.3, -4.6, 1.3, 0, Math.PI * 2); ctx.fill();

  // head + blaze cap
  ctx.fillStyle = "#e8b88a";
  ctx.beginPath();
  ctx.arc(0.5, -11, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f97316";
  ctx.beginPath();
  ctx.arc(0.5, -11.6, 4.05, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c2410c";
  ctx.fillRect(0.5, -12.4, 6.4, 1.4);
  // eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath(); ctx.arc(2.4, -10.6, 0.6, 0, Math.PI * 2); ctx.fill();
}

function getCascadeAlerts(stats) {
  const a = [];
  if (stats.wolves === 0) a.push({ sev: "crit", icon: "🐺", title: "Wolves Extinct", msg: "Without apex predators, elk explode, coyotes boom, and the entire food web collapses. This is exactly what happened from 1926–1995." });
  else if (stats.wolves < 4) a.push({ sev: "warn", icon: "🐺", title: "Wolf Population Critical", msg: "Too few wolves to form packs or maintain genetic diversity." });
  if (stats.elk > 85) a.push({ sev: "crit", icon: "🦌", title: "Elk Overpopulation", msg: "Massive herds are stripping willows and aspens bare. Riparian zones collapsing." });
  else if (stats.elk > 60) a.push({ sev: "warn", icon: "🦌", title: "Elk Numbers Rising", msg: "Insufficient predation pressure. Vegetation declining." });
  if (stats.vegetationHealth < 30) a.push({ sev: "crit", icon: "🌿", title: "Vegetation Collapse", msg: "Trees vanishing. Riverbanks erode. Beavers, songbirds, and fish lose habitat." });
  if (stats.riverHealth < 35) a.push({ sev: "warn", icon: "🏞️", title: "Rivers Destabilizing", msg: "Without vegetation and beaver dams, channels widen and shallow." });
  if (stats.coyotes > 28) a.push({ sev: "warn", icon: "🐾", title: "Mesopredator Release", msg: "Without wolves, coyotes boom and devastate small mammals and ground-nesting birds." });
  if (stats.hunters > 8) a.push({ sev: "warn", icon: "🎯", title: "Heavy Hunting Pressure", msg: "Wolves being removed faster than packs can reproduce." });
  if (stats.beavers < 2) a.push({ sev: "warn", icon: "🦫", title: "Beavers Disappearing", msg: "No willows = no dams. Wetlands drain." });
  return a;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOUNDSCAPE MANAGER (Tone.js)
// ═══════════════════════════════════════════════════════════════════════════════

class SoundscapeManager {
  constructor() {
    this.initialized = false;
    this.enabled = true;
    this.muted = false;
    this.masterVol = null;
    this.layers = {};
    this.lastTrigger = {};
    this.ideals = { wolves: 12, elk: 38, trees: 85, beavers: 8, coyotes: 8, fish: 18, birds: 12, rabbits: 22, bears: 6 };
  }

  async init() {
    if (this.initialized) return;
    // Ensure AudioContext is running (may already be resumed by gesture handler)
    await Tone.start();
    if (Tone.context.state !== 'running') {
      await Tone.context.resume();
    }

    this.masterVol = new Tone.Volume(-12).toDestination();

    // === HARMONY PAD (background drone shifts with ecosystem health) ===
    this.layers.pad = {
      synth: new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 1.5, decay: 1, sustain: 0.4, release: 3 }
      }).connect(new Tone.Volume(-22).connect(this.masterVol)),
      lastChord: null,
    };

    // === WOLF: haunting sine glides ===
    this.layers.wolf = {
      synth: new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.3, decay: 1.8, sustain: 0, release: 1.2 }
      }).connect(new Tone.Volume(-20).connect(this.masterVol)),
      vol: -20,
    };

    // === ELK: bugling membrane hits ===
    this.layers.elk = {
      synth: new Tone.MembraneSynth({
        pitchDecay: 0.08,
        octaves: 3,
        envelope: { attack: 0.01, decay: 0.6, sustain: 0, release: 0.4 }
      }).connect(new Tone.Volume(-24).connect(this.masterVol)),
      vol: -24,
    };

    // === BIRDS: high sine chirps ===
    this.layers.bird = {
      synth: new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.005, decay: 0.06, sustain: 0, release: 0.05 }
      }).connect(new Tone.Volume(-16).connect(this.masterVol)),
      vol: -16,
    };

    // === COYOTE: FM yips ===
    this.layers.coyote = {
      synth: new Tone.FMSynth({
        harmonicity: 3.5,
        modulationIndex: 8,
        oscillator: { type: 'sine' },
        modulation: { type: 'square' },
        envelope: { attack: 0.005, decay: 0.15, sustain: 0, release: 0.1 },
        modulationEnvelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.05 }
      }).connect(new Tone.Volume(-22).connect(this.masterVol)),
      vol: -22,
    };

    // === BEAVER: tail slap noise bursts ===
    const beaverFilter = new Tone.Filter({ frequency: 800, type: 'bandpass', Q: 2 }).connect(new Tone.Volume(-26).connect(this.masterVol));
    this.layers.beaver = {
      noise: new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.02 }
      }).connect(beaverFilter),
      vol: -26,
    };

    // === FISH: subtle splash ===
    const fishFilter = new Tone.Filter({ frequency: 3000, type: 'bandpass', Q: 1 }).connect(new Tone.Volume(-30).connect(this.masterVol));
    this.layers.fish = {
      noise: new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.03 }
      }).connect(fishFilter),
      vol: -30,
    };

    // === RABBIT: soft shuffle ===
    const rabbitFilter = new Tone.Filter({ frequency: 1200, type: 'lowpass' }).connect(new Tone.Volume(-32).connect(this.masterVol));
    this.layers.rabbit = {
      noise: new Tone.NoiseSynth({
        noise: { type: 'brown' },
        envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 }
      }).connect(rabbitFilter),
      vol: -32,
    };

    // === BEAR: deep rumble ===
    this.layers.bear = {
      synth: new Tone.Synth({
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.4, decay: 1.2, sustain: 0, release: 0.8 }
      }).connect(new Tone.Filter({ frequency: 200, type: 'lowpass' }).connect(new Tone.Volume(-24).connect(this.masterVol))),
      vol: -24,
    };

    // === AMBIENT: water (pink noise) ===
    const waterFilter = new Tone.Filter({ frequency: 1800, type: 'lowpass' }).connect(new Tone.Volume(-26).connect(this.masterVol));
    this.layers.water = {
      noise: new Tone.Noise("pink").connect(waterFilter),
      filter: waterFilter,
      baseVol: -26,
    };
    this.layers.water.noise.start();

    // === AMBIENT: wind (brown noise) ===
    const windFilter = new Tone.Filter({ frequency: 350, type: 'lowpass' }).connect(new Tone.Volume(-30).connect(this.masterVol));
    this.layers.wind = {
      noise: new Tone.Noise("brown").connect(windFilter),
      filter: windFilter,
      baseVol: -30,
    };
    this.layers.wind.noise.start();

    this.initialized = true;
  }

  _volScale(pop, ideal, baseVol) {
    const ratio = clamp(pop / Math.max(ideal, 1), 0, 2.5);
    // At 0 pop: -Infinity (silent). At ideal: baseVol. At 2.5x ideal: baseVol + 8dB (loud/dominant)
    if (pop === 0) return -80;
    return baseVol + (ratio - 1) * 6;
  }

  update(stats, alerts) {
    if (!this.initialized || !this.enabled || this.muted) return;
    const now = Date.now();

    // === HARMONY PAD: chord shifts with balance score ===
    const score = stats.vegetationHealth * 0.3 + stats.riverHealth * 0.2 +
      clamp(stats.wolves / 15, 0, 1) * 20 + clamp(stats.birds / 12, 0, 1) * 15 +
      clamp(stats.beavers / 8, 0, 1) * 15;
    let chord;
    if (score > 55) chord = ['C3', 'E3', 'G3'];         // Major — harmonious
    else if (score > 38) chord = ['C3', 'F3', 'G3'];    // Sus4 — tension
    else if (score > 20) chord = ['C3', 'Eb3', 'G3'];   // Minor — melancholy
    else chord = ['C3', 'Eb3', 'Gb3'];                  // Dim — dissonant
    const chordKey = chord.join(',');
    if (chordKey !== this.layers.pad.lastChord) {
      this.layers.pad.synth.triggerAttackRelease(chord, '2n');
      this.layers.pad.lastChord = chordKey;
    }

    // === WOLF HOWLS ===
    if (stats.wolves > 0) {
      const wolfIntensity = clamp(stats.wolves / this.ideals.wolves, 0.1, 2.5);
      const howlChance = 0.03 * wolfIntensity;
      if (Math.random() < howlChance && (now - (this.lastTrigger.wolf || 0)) > 8000) {
        const pitch = 150 + Math.random() * 130;
        this.layers.wolf.synth.frequency.value = pitch;
        this.layers.wolf.synth.frequency.exponentialRampToValueAtTime(pitch * 1.6, Tone.now() + 1.5);
        this.layers.wolf.synth.volume.value = this._volScale(stats.wolves, this.ideals.wolves, this.layers.wolf.vol);
        this.layers.wolf.synth.triggerAttackRelease(1.8);
        this.lastTrigger.wolf = now;
      }
    }

    // === ELK BUGLING ===
    if (stats.elk > 0) {
      const elkIntensity = clamp(stats.elk / this.ideals.elk, 0.1, 2.5);
      const bugleChance = 0.02 * elkIntensity;
      if (Math.random() < bugleChance && (now - (this.lastTrigger.elk || 0)) > 4000) {
        const note = ['C3', 'D3', 'E3', 'G3'][Math.floor(Math.random() * 4)];
        this.layers.elk.synth.volume.value = this._volScale(stats.elk, this.ideals.elk, this.layers.elk.vol);
        this.layers.elk.synth.triggerAttackRelease(note, '8n');
        this.lastTrigger.elk = now;
      }
    }

    // === BIRD CHIRPS (most frequent — the "life" sound) ===
    if (stats.birds > 0) {
      const birdIntensity = clamp(stats.birds / this.ideals.birds, 0.1, 2.5);
      const chirpChance = 0.15 * birdIntensity;
      if (Math.random() < chirpChance) {
        const baseNote = 1200 + Math.random() * 1200;
        this.layers.bird.synth.frequency.value = baseNote;
        this.layers.bird.synth.volume.value = this._volScale(stats.birds, this.ideals.birds, this.layers.bird.vol);
        this.layers.bird.synth.triggerAttackRelease('64n');
        // Sometimes do a quick trill (2-3 rapid chirps)
        if (Math.random() < 0.3 * birdIntensity) {
          setTimeout(() => {
            if (this.initialized && this.enabled) {
              this.layers.bird.synth.frequency.value = baseNote * 1.15;
              this.layers.bird.synth.triggerAttackRelease('64n');
            }
          }, 80);
          if (Math.random() < 0.4) {
            setTimeout(() => {
              if (this.initialized && this.enabled) {
                this.layers.bird.synth.frequency.value = baseNote * 1.3;
                this.layers.bird.synth.triggerAttackRelease('64n');
              }
            }, 160);
          }
        }
      }
    }

    // === COYOTE YIPS ===
    if (stats.coyotes > 0) {
      const coyIntensity = clamp(stats.coyotes / this.ideals.coyotes, 0.1, 2.5);
      const yipChance = 0.04 * coyIntensity;
      if (Math.random() < yipChance && (now - (this.lastTrigger.coyote || 0)) > 3000) {
        const yipNote = 400 + Math.random() * 400;
        this.layers.coyote.synth.frequency.value = yipNote;
        this.layers.coyote.synth.volume.value = this._volScale(stats.coyotes, this.ideals.coyotes, this.layers.coyote.vol);
        this.layers.coyote.synth.triggerAttackRelease('16n');
        // Pack yipping effect when many coyotes
        if (coyIntensity > 1.3 && Math.random() < 0.5) {
          setTimeout(() => {
            if (this.initialized && this.enabled) {
              this.layers.coyote.synth.frequency.value = yipNote * 1.2;
              this.layers.coyote.synth.triggerAttackRelease('16n');
            }
          }, 120);
        }
        this.lastTrigger.coyote = now;
      }
    }

    // === BEAVER TAIL SLAPS ===
    if (stats.beavers > 0) {
      const beaverChance = 0.012 * clamp(stats.beavers / this.ideals.beavers, 0.1, 2.0);
      if (Math.random() < beaverChance && (now - (this.lastTrigger.beaver || 0)) > 6000) {
        this.layers.beaver.noise.triggerAttackRelease('32n');
        this.lastTrigger.beaver = now;
      }
    }

    // === FISH SPLASHES ===
    if (stats.fish > 0) {
      const fishChance = 0.02 * clamp(stats.fish / this.ideals.fish, 0.1, 2.0);
      if (Math.random() < fishChance && (now - (this.lastTrigger.fish || 0)) > 4000) {
        this.layers.fish.noise.triggerAttackRelease('64n');
        this.lastTrigger.fish = now;
      }
    }

    // === RABBIT SHUFFLES ===
    if (stats.rabbits > 0) {
      const rabbitChance = 0.03 * clamp(stats.rabbits / this.ideals.rabbits, 0.1, 2.5);
      if (Math.random() < rabbitChance && (now - (this.lastTrigger.rabbit || 0)) > 2000) {
        this.layers.rabbit.noise.triggerAttackRelease('64n');
        this.lastTrigger.rabbit = now;
      }
    }

    // === BEAR GROWLS ===
    if (stats.bears > 0) {
      const bearChance = 0.008 * clamp(stats.bears / this.ideals.bears, 0.1, 2.0);
      if (Math.random() < bearChance && (now - (this.lastTrigger.bear || 0)) > 12000) {
        const growlPitch = 80 + Math.random() * 70;
        this.layers.bear.synth.frequency.value = growlPitch;
        this.layers.bear.synth.volume.value = this._volScale(stats.bears, this.ideals.bears, this.layers.bear.vol);
        this.layers.bear.synth.triggerAttackRelease(1.0);
        this.lastTrigger.bear = now;
      }
    }

    // === AMBIENT: water volume tracks river health ===
    const waterVol = this.layers.water.baseVol + (stats.riverHealth / 100) * 8;
    this.layers.water.noise.volume.value = waterVol;

    // === AMBIENT: wind louder when vegetation gone ===
    const windVol = this.layers.wind.baseVol + ((100 - stats.vegetationHealth) / 100) * 10;
    this.layers.wind.noise.volume.value = windVol;
  }

  setMute(muted) {
    this.muted = muted;
    if (this.initialized && this.masterVol) {
      this.masterVol.volume.value = muted ? -80 : -12;
    }
  }
}

const soundscape = new SoundscapeManager();

// ═══════════════════════════════════════════════════════════════════════════════
// NARRATOR MANAGER (Web Speech API)
// ═══════════════════════════════════════════════════════════════════════════════

class NarratorManager {
  constructor() {
    this.enabled = true;
    this.speaking = false;
    this.lastSpoken = {};
    this.minInterval = 20000; // 20s between same insight
    this.globalCooldown = 8000; // 8s between any narration
    this.lastAnySpoken = 0;
    this.currentAudio = null;
    this.audioCache = {};
    this.initialized = true; // No init needed for HTML5 Audio
  }

  init() {
    // No-op: HTML5 Audio doesn't need initialization
    this.initialized = true;
  }

  _getAudioUrl(filename) {
    return `/audio/${filename}`;
  }

  speak(insightId, text, audioFile) {
    if (!this.enabled) return;

    const now = Date.now();
    // Global cooldown
    if (now - this.lastAnySpoken < this.globalCooldown) return;
    // Per-insight cooldown
    if (this.lastSpoken[insightId] && now - this.lastSpoken[insightId] < this.minInterval) return;

    // Stop any current audio
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }

    // If we have a pre-generated audio file, use it
    if (audioFile) {
      const url = this._getAudioUrl(audioFile);
      let audio = this.audioCache[url];
      if (!audio) {
        audio = new Audio(url);
        audio.preload = 'auto';
        this.audioCache[url] = audio;
      } else {
        audio.currentTime = 0;
      }
      audio.volume = 0.85;
      this.currentAudio = audio;
      this.speaking = true;
      audio.play().catch(() => { this.speaking = false; });
      audio.onended = () => { this.speaking = false; this.currentAudio = null; };
      audio.onerror = () => { this.speaking = false; this.currentAudio = null; };
    }

    this.lastSpoken[insightId] = now;
    this.lastAnySpoken = now;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.stop();
    }
  }

  stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    this.speaking = false;
  }
}

const narrator = new NarratorManager();

// ═══════════════════════════════════════════════════════════════════════════════
// EDUCATIONAL INSIGHTS
// ═══════════════════════════════════════════════════════════════════════════════

const INSIGHTS = [
  {
    id: 'wolves_extinct',
    condition: (s) => s.wolves === 0,
    cooldown: 300,
    title: 'Trophic Cascade Begins',
    narrative: 'With no wolves to hunt elk, the herbivore population will explode unchecked. Vegetation will be stripped bare, rivers will destabilize, and the entire ecosystem unravels from the top down.',
    spokenLines: [
      'The wolves are gone. Without an apex predator, elk will multiply unchecked and begin stripping the land bare. This is how a trophic cascade begins.',
      'No more wolves. The top of the food chain just collapsed. Watch how every species below them starts to unravel.',
      'This is exactly what happened in Yellowstone in 1926. Every wolf was killed, and the whole ecosystem paid the price for 70 years.',
    ],
    audioFiles: ["wolves_extinct_0.mp3","wolves_extinct_1.mp3","wolves_extinct_2.mp3"],
    concept: 'Trophic Cascade',
    conceptDetail: 'Changes at the top of the food chain cascade down, dramatically altering lower trophic levels.',
    historicalNote: 'This happened in Yellowstone 1926-1995: after wolves were extirpated, elk populations surged from ~4,000 to over 25,000.',
    severity: 'critical'
  },
  {
    id: 'wolves_critical',
    condition: (s) => s.wolves > 0 && s.wolves < 4,
    cooldown: 250,
    title: 'Genetic Bottleneck Risk',
    narrative: 'Your wolf population is dangerously small. Pack structure collapses, genetic diversity plummets, and inbreeding weakens the population. A single disease could wipe them out entirely.',
    spokenLines: [
      'Only a handful of wolves remain. At this size, the pack loses genetic diversity and one disease outbreak could finish them off entirely.',
      'The wolf population is critically low. Without enough members to form stable packs, reproduction slows and inbreeding becomes a real threat.',
      'We are looking at a genetic bottleneck. When a population drops this low, even small setbacks can push them to extinction.',
    ],
    audioFiles: ["wolves_critical_0.mp3","wolves_critical_1.mp3","wolves_critical_2.mp3"],
    concept: 'Population Genetics',
    conceptDetail: 'Small populations lose genetic diversity, making them vulnerable to disease and environmental stress.',
    historicalNote: 'Real Yellowstone reintroduction began with just 14 wolves (from Canada) in 1995-96.',
    severity: 'warning'
  },
  {
    id: 'wolves_healthy',
    condition: (s) => s.wolves >= 10 && s.wolves <= 22,
    cooldown: 400,
    title: 'Keystone Species at Work',
    narrative: 'Wolves are a keystone species: their presence supports the entire ecosystem far beyond their numbers. They drive elk to fear certain areas (ecology of fear), preventing overgrazing and allowing vegetation to recover.',
    spokenLines: [
      'Wolves are thriving, and the ecosystem feels it. Just their presence changes elk behavior, keeping them away from riverbanks and letting the willows grow back.',
      'This is what a keystone species looks like. Wolves support far more life than their numbers suggest — the whole web depends on them.',
      'Healthy wolf packs are patrolling the valleys. Elk are steering clear of the riverbanks, and that gives the willows a chance to recover.',
    ],
    audioFiles: ["wolves_healthy_0.mp3","wolves_healthy_1.mp3","wolves_healthy_2.mp3"],
    concept: 'Keystone Species',
    conceptDetail: 'A species whose impact on the ecosystem is disproportionately large relative to its abundance.',
    historicalNote: 'Yellowstone wolves have supported recovery of willows, aspen, cottonwoods, and enabled beaver return.',
    severity: 'info'
  },
  {
    id: 'wolves_overpop',
    condition: (s) => s.wolves > 35,
    cooldown: 300,
    title: 'Predator Overpopulation',
    narrative: 'Too many wolves are depleting elk faster than reproduction can sustain. Prey availability will crash, forcing wolves to starve or move to other regions.',
    spokenLines: [
      'Too many wolves. They are hunting elk faster than the herd can reproduce. Soon prey will collapse, and the wolves themselves will starve.',
      'Predator overpopulation. In nature this self-corrects through starvation, but it is a painful process that takes the whole ecosystem down with it.',
      'The wolf population has overshot. This is the boom side of a classic predator-prey cycle. The bust is coming.',
    ],
    audioFiles: ["wolves_overpop_0.mp3","wolves_overpop_1.mp3","wolves_overpop_2.mp3"],
    concept: 'Predator-Prey Dynamics',
    conceptDetail: 'Predator and prey populations oscillate cyclically: more prey → more predators → predators eat prey → fewer predators.',
    historicalNote: 'Yellowstone\'s wolf population stabilized around 80-110 by 2000s, with natural predator-prey balance.',
    severity: 'warning'
  },
  {
    id: 'elk_overpop',
    condition: (s) => s.elk > 85,
    cooldown: 280,
    title: 'Elk Herbivory Crisis',
    narrative: 'Massive elk herds are stripping vegetation to nubs. Willows and aspens disappear, riparian zones collapse into bare banks, and erosion accelerates. Fish lose shade and stream integrity.',
    spokenLines: [
      'Elk herds are enormous now. They are devouring every willow and aspen in sight. The riverbanks are eroding and fish are losing the shade they need to survive.',
      'This is what carrying capacity looks like when it is exceeded. The elk are eating themselves out of house and home.',
      'Massive overgrazing. In the real Yellowstone, 25,000 elk stripped the park bare for decades. This is that same story playing out.',
    ],
    audioFiles: ["elk_overpop_0.mp3","elk_overpop_1.mp3","elk_overpop_2.mp3"],
    concept: 'Carrying Capacity',
    conceptDetail: 'The maximum population size an environment can sustain based on available resources.',
    historicalNote: 'Pre-wolf Yellowstone had 25,000+ elk destroying all woody vegetation; now stabilized at 4,000-8,000 with wolves.',
    severity: 'critical'
  },
  {
    id: 'elk_rising',
    condition: (s) => s.elk > 60 && s.elk <= 85,
    cooldown: 250,
    title: 'Insufficient Predation Pressure',
    narrative: 'Elk numbers are rising without enough wolf predation to control them. Vegetation health is declining rapidly. If this trend continues, overgrazing will destabilize the entire system.',
    spokenLines: [
      'Elk numbers are climbing fast. Without enough predators to keep them in check, overgrazing will start to destabilize the whole system.',
      'The elk are rising and predation pressure is not keeping up. This is the early warning sign before vegetation collapse.',
      'Not enough wolves to hold the elk back. If this continues, the trees will not survive the browsing pressure.',
    ],
    audioFiles: ["elk_rising_0.mp3","elk_rising_1.mp3","elk_rising_2.mp3"],
    concept: 'Predator-Prey Equilibrium',
    conceptDetail: 'Stable ecosystems maintain balance between predator and prey through density-dependent predation.',
    historicalNote: 'Yellowstone achieved balance around 2000-2010, with 50-80 wolves keeping elk at sustainable levels.',
    severity: 'warning'
  },
  {
    id: 'elk_balanced',
    condition: (s) => s.elk >= 30 && s.elk <= 60,
    cooldown: 350,
    title: 'Ecology of Fear',
    narrative: 'With predators present, elk avoid dangerous areas like river valleys, allowing willows and aspens to regenerate. Even without being hunted, fear of wolves changes elk behavior profoundly.',
    spokenLines: [
      'This is the ecology of fear in action. Elk are avoiding the river valleys because wolves patrol there. That alone lets the willows and aspens grow back.',
      'Notice the elk are not just being killed by wolves — they are changing their behavior. Fear itself reshapes the landscape.',
      'Wolves do not just reduce elk numbers. They move them. And that redistribution of grazing pressure is what lets the vegetation recover.',
    ],
    audioFiles: ["elk_balanced_0.mp3","elk_balanced_1.mp3","elk_balanced_2.mp3"],
    concept: 'Ecology of Fear',
    conceptDetail: 'Predator presence alters prey behavior (e.g., habitat use, foraging patterns) independent of predation mortality.',
    historicalNote: 'GPS-collared Yellowstone elk avoid river valleys 4-5x more often when wolves are present.',
    severity: 'info'
  },
  {
    id: 'vegetation_collapse',
    condition: (s) => s.vegetationHealth < 25,
    cooldown: 300,
    title: 'Vegetation Collapse Cascade',
    narrative: 'Tree cover has collapsed. Riverbanks erode without root systems. Beavers lose willows to build dams. Songbirds find no nesting sites. Fish lose riparian shade. The entire ecosystem is in freefall.',
    spokenLines: [
      'Vegetation has collapsed. Without trees to hold the banks, rivers erode. Beavers have no willows for dams, birds have no place to nest. Everything is connected.',
      'The trees are gone. This triggers a domino effect: no roots means eroding banks, no shade means warming rivers, no cover means declining wildlife.',
      'Yellowstone willows declined 99 percent between the 1920s and 1990s. You are watching the same pattern unfold right now.',
    ],
    audioFiles: ["vegetation_collapse_0.mp3","vegetation_collapse_1.mp3","vegetation_collapse_2.mp3"],
    concept: 'Ecosystem Engineer',
    conceptDetail: 'Species that create or maintain habitats, enabling other species to thrive (e.g., willows stabilize banks).',
    historicalNote: 'Yellowstone willows declined 99% from 1920s-1990s; recovery began only after wolf reintroduction.',
    severity: 'critical'
  },
  {
    id: 'vegetation_recovering',
    condition: (s) => s.vegetationHealth > 40 && s.vegetationHealth < 70,
    cooldown: 320,
    title: 'Vegetation Recovery Underway',
    narrative: 'Trees are recovering! Willows and aspens are regrowing, stabilizing riverbanks and creating habitat for countless species. This recovery took Yellowstone decades after wolves returned.',
    spokenLines: [
      'The trees are coming back. Willows and aspens are regrowing along the banks, stabilizing the soil. In real Yellowstone, this recovery took decades.',
      'Ecological succession is underway. The vegetation is slowly rebuilding, and with it, the entire food web gets stronger.',
      'Recovery is happening. Each tree that grows back holds a little more soil, shades a little more water, and shelters a few more birds.',
    ],
    audioFiles: ["vegetation_recovering_0.mp3","vegetation_recovering_1.mp3","vegetation_recovering_2.mp3"],
    concept: 'Ecological Succession',
    conceptDetail: 'The predictable sequence of species and ecosystem changes following disturbance or restoration.',
    historicalNote: 'Yellowstone aspen recovery accelerated 5-10 years after wolf reintroduction reduced elk browse.',
    severity: 'info'
  },
  {
    id: 'river_unstable',
    condition: (s) => s.riverHealth < 35,
    cooldown: 270,
    title: 'Riparian Zone Destruction',
    narrative: 'Rivers are destabilizing. Without willows to hold banks and beaver dams to slow flow, channels are widening, water clarity dropping, and temperature rising. Fish habitat is degrading rapidly.',
    spokenLines: [
      'The rivers are in trouble. Without tree roots and beaver dams, the channels are widening, water is warming, and fish habitat is falling apart.',
      'The riparian zone is collapsing. These riverside ecosystems are among the most productive on earth, and they are disappearing.',
      'River channels are braiding and widening — a classic sign of ecosystem degradation. Pre-wolf Yellowstone looked exactly like this.',
    ],
    audioFiles: ["river_unstable_0.mp3","river_unstable_1.mp3","river_unstable_2.mp3"],
    concept: 'Riparian Zone',
    conceptDetail: 'Transitional areas between terrestrial and aquatic ecosystems that regulate water quality, temperature, and structure.',
    historicalNote: 'Pre-wolf Yellowstone had braided, eroded channels; post-wolf recovery includes narrower, deeper streams with better structure.',
    severity: 'warning'
  },
  {
    id: 'beaver_decline',
    condition: (s) => s.beavers < 3,
    cooldown: 280,
    title: 'Beaver Disappearance',
    narrative: 'With few willows and aspens available, beavers cannot survive or reproduce. Dams are abandoned, wetlands drain, and water retention plummets. The landscape dries out further.',
    spokenLines: [
      'Beavers are vanishing. Without willows to eat and build with, their dams collapse. Wetlands drain, and the whole landscape dries out.',
      'No willows, no beavers. No beavers, no dams. No dams, no wetlands. The cascade keeps going deeper.',
      'Yellowstone went from 9,000 beaver ponds to nearly zero when the willows disappeared. You are seeing that same collapse.',
    ],
    audioFiles: ["beaver_decline_0.mp3","beaver_decline_1.mp3","beaver_decline_2.mp3"],
    concept: 'Ecosystem Engineering',
    conceptDetail: 'Beavers are the ultimate ecosystem engineers, creating wetlands that support fish, waterfowl, and vegetation.',
    historicalNote: 'Yellowstone had ~9,000 beaver ponds in 1800s, crashed to near zero by 1950s, now recovering toward ~4,000+.',
    severity: 'warning'
  },
  {
    id: 'beaver_returning',
    condition: (s) => s.beavers >= 5,
    cooldown: 350,
    title: 'Beaver Engineering',
    narrative: 'Beavers are building dams again! Their construction creates wetlands, raises water tables, slows erosion, and provides habitat for fish, amphibians, and migratory birds. One beaver is worth thousands of engineers.',
    spokenLines: [
      'Beavers are back at work building dams. Their wetlands raise water tables, slow erosion, and create habitat for dozens of other species. Nature is own best engineer.',
      'One beaver family can transform an entire valley. Their dams create ponds that support fish, amphibians, waterfowl, and dozens of insect species.',
      'Beaver engineering at its finest. These rodents reshape rivers more effectively than any human construction project.',
    ],
    audioFiles: ["beaver_returning_0.mp3","beaver_returning_1.mp3","beaver_returning_2.mp3"],
    concept: 'Ecosystem Engineer',
    conceptDetail: 'Beavers modify their environment more dramatically than any species except humans.',
    historicalNote: 'Beaver ponds in restored Yellowstone create oases of biodiversity in otherwise dry landscapes.',
    severity: 'info'
  },
  {
    id: 'songbird_decline',
    condition: (s) => s.birds < 6,
    cooldown: 250,
    title: 'Nesting Habitat Loss',
    narrative: 'Songbirds are disappearing. Mature willows and aspens that provide nesting sites are gone. Ground-nesting birds suffer heavy predation from coyotes. Bird diversity plummets.',
    spokenLines: [
      'Songbirds are disappearing. The mature trees they need for nesting are gone, and unchecked coyotes are picking off the ground-nesters.',
      'Birds are an indicator species. When they decline, it means the whole ecosystem is stressed. No trees, no nests, no birds.',
      'The silence is telling. In a healthy Yellowstone, you would hear dozens of bird species. When the trees go, the songs go with them.',
    ],
    audioFiles: ["songbird_decline_0.mp3","songbird_decline_1.mp3","songbird_decline_2.mp3"],
    concept: 'Indicator Species',
    conceptDetail: 'Species whose presence or abundance reflects ecosystem health; used to monitor environmental conditions.',
    historicalNote: 'Yellowstone songbird diversity increased after wolves returned and willows regrew.',
    severity: 'warning'
  },
  {
    id: 'coyote_boom',
    condition: (s) => s.coyotes > 28,
    cooldown: 300,
    title: 'Mesopredator Release',
    narrative: 'Without wolves to suppress them, coyotes boom explosively. They devastate ground-nesting songbirds and small mammals. This is called mesopredator release: mid-level predators run rampant without apex predator control.',
    spokenLines: [
      'Coyotes are booming. This is mesopredator release. Without wolves keeping them in check, coyotes devastate songbirds and small mammals.',
      'Mesopredator release in action. Remove the top predator and the mid-level ones explode. Coyotes are now the unchecked force in this ecosystem.',
      'From 1926 to 1995, Yellowstone coyote populations ran rampant with no wolf control. Rabbits and ground-nesting birds paid the price.',
    ],
    audioFiles: ["coyote_boom_0.mp3","coyote_boom_1.mp3","coyote_boom_2.mp3"],
    concept: 'Mesopredator Release',
    conceptDetail: 'When apex predators are removed, mid-level predators increase dramatically and overexploit prey.',
    historicalNote: 'Yellowstone coyote populations exploded 1926-1995; wolf return naturally suppressed coyote numbers.',
    severity: 'warning'
  },
  {
    id: 'rabbit_crash',
    condition: (s) => s.rabbits < 10,
    cooldown: 280,
    title: 'Secondary Cascade Effect',
    narrative: 'Rabbit populations have crashed—likely due to coyote overpredation. This cascades further: fewer rabbits means fewer predators survive, but also loss of food for other species.',
    spokenLines: [
      'Rabbit populations have crashed, likely from coyote overpredation. The cascade keeps rippling further down the food web.',
      'Another level of the food web has collapsed. Rabbits are victims of the same cascade that started with losing wolves.',
      'Small mammals crashing. This is a secondary trophic effect — the consequences of removing wolves reach species three or four links down the chain.',
    ],
    audioFiles: ["rabbit_crash_0.mp3","rabbit_crash_1.mp3","rabbit_crash_2.mp3"],
    concept: 'Cascading Trophic Effects',
    conceptDetail: 'Changes in one species ripple through the food web, affecting multiple trophic levels.',
    historicalNote: 'Small mammal populations in Yellowstone showed strong recovery correlating with wolf presence.',
    severity: 'warning'
  },
  {
    id: 'coyote_suppressed',
    condition: (s) => s.coyotes < 4 && s.wolves > 8,
    cooldown: 300,
    title: 'Coyote Suppression',
    narrative: 'Wolf dominance has drastically suppressed coyote numbers. While this is historically accurate, fewer coyotes means rabbits and rodents will multiply rapidly, increasing ground-level grazing pressure.',
    spokenLines: [
      'Wolves are dominating the landscape and coyotes are vanishing. Historically accurate, but watch the rabbit population — without coyotes to control them, rabbits will explode.',
      'Coyote suppression by wolves. This actually happened when wolves returned to Yellowstone. Small prey species boomed in response.',
      'The coyote population has collapsed under wolf pressure. Nature will compensate — expect a rabbit boom and shifts in ground-level vegetation.',
    ],
    audioFiles: ["coyote_suppressed_0.mp3"],
    concept: 'Intraguild Predation',
    conceptDetail: 'When apex predators suppress or kill mesopredators, releasing pressure on smaller prey species.',
    historicalNote: 'Yellowstone coyote numbers dropped by 50% within two years of wolf reintroduction in 1995.',
    severity: 'info'
  },
  {
    id: 'coyote_extinct',
    condition: (s) => s.coyotes === 0,
    cooldown: 350,
    title: 'Coyotes Gone',
    narrative: 'Coyotes have been completely eliminated. Without any mesopredator, small mammals will breed unchecked. This creates an unusual imbalance — even though wolves are present, the food web has a missing link.',
    spokenLines: [
      'Coyotes are completely gone. The mid-level of the food chain is empty. Rabbits and rodents are breeding with zero predation pressure.',
      'No coyotes at all. This is actually worse than it sounds. Every level of the food web plays a role, and this gap will ripple through the ecosystem.',
      'Complete coyote loss. In a healthy ecosystem, mesopredators like coyotes keep small mammals in check. Without them, expect cascading overpopulation below.',
    ],
    audioFiles: ["coyote_extinct_0.mp3"],
    concept: 'Food Web Completeness',
    conceptDetail: 'A healthy ecosystem needs all trophic levels — apex, meso, and prey — functioning in balance.',
    historicalNote: 'Even during peak wolf presence in Yellowstone, coyotes persisted at reduced numbers — their complete loss is an imbalance.',
    severity: 'warning'
  },
  {
    id: 'rabbit_boom',
    condition: (s) => s.rabbits > 45,
    cooldown: 280,
    title: 'Rabbit Overpopulation',
    narrative: 'Rabbit populations have exploded — likely from insufficient predation. Too many rabbits means heavy ground-level grazing, competing with elk for vegetation and degrading soil through overburrowing.',
    spokenLines: [
      'Rabbits everywhere. Without enough predators, their population has exploded. They are now competing with elk for ground vegetation.',
      'Rabbit overpopulation is stripping the ground cover. This adds yet another layer of grazing pressure on an already stressed ecosystem.',
      'Too many rabbits. In nature, coyotes, foxes, and raptors keep them balanced. Remove those controls, and the population spirals.',
    ],
    audioFiles: ["rabbit_boom_0.mp3"],
    concept: 'Herbivore Overcompensation',
    conceptDetail: 'When predation is removed, prey species overshoot their ecological carrying capacity, degrading their own habitat.',
    historicalNote: 'Rodent and rabbit populations in Yellowstone shifted measurably with changes in coyote and wolf numbers.',
    severity: 'warning'
  },
  {
    id: 'bird_extinction',
    condition: (s) => s.birds === 0,
    cooldown: 350,
    title: 'Silent Spring',
    narrative: 'All songbirds have disappeared. Without birds, seed dispersal drops dramatically, insect populations go unchecked, and the ecosystem loses a critical indicator species. The silence is deafening.',
    spokenLines: [
      'Every songbird is gone. This is a Silent Spring moment. Without birds, seed dispersal collapses and insect populations explode unchecked.',
      'Total bird loss. Rachel Carson warned about this. Birds are not just beautiful — they are essential for seed dispersal, insect control, and ecosystem monitoring.',
      'The forest is silent. No birdsong means no seed dispersal, no insect control. Vegetation recovery will slow dramatically without them.',
    ],
    audioFiles: ["bird_extinction_0.mp3"],
    concept: 'Ecosystem Services',
    conceptDetail: 'Birds provide critical services: seed dispersal, insect control, pollination support, and nutrient cycling.',
    historicalNote: 'Rachel Carson\'s Silent Spring warned of ecological collapse when bird populations crash.',
    severity: 'critical'
  },
  {
    id: 'rabbit_extinct',
    condition: (s) => s.rabbits === 0,
    cooldown: 350,
    title: 'Small Mammals Gone',
    narrative: 'Rabbits have been completely wiped out, likely by coyote overpredation. Without small herbivores, coyotes will starve and the food web loses another link. Soil health will decline without burrowing activity.',
    spokenLines: [
      'Rabbits are completely gone. Coyotes have nothing left to eat at the lower trophic level. Expect coyote starvation next.',
      'Small mammal extinction. Rabbits provided food for coyotes and aerated the soil through burrowing. Their loss cascades in both directions.',
      'No rabbits left. The food web just lost another critical link. Without prey, coyotes will decline. Without burrowing, soil health drops.',
    ],
    audioFiles: ["rabbit_extinct_0.mp3"],
    concept: 'Prey Base Collapse',
    conceptDetail: 'When prey species are eliminated, their predators decline and ecosystem functions they provided are lost.',
    historicalNote: 'Small mammal diversity in Yellowstone is a key indicator of overall ecosystem function.',
    severity: 'critical'
  },
  {
    id: 'fish_decline',
    condition: (s) => s.fish < 10,
    cooldown: 250,
    title: 'Aquatic Habitat Degradation',
    narrative: 'Fish populations are in freefall. Causes: rising water temperature from lack of riparian shade, erosion-caused siltation, poor water quality, and unstable stream structure. Fish are sentinel species for river health.',
    spokenLines: [
      'Fish are dying off. Warmer water, eroded banks, and silted streams are destroying their habitat. Fish are the canary in the coal mine for river health.',
      'The aquatic ecosystem is collapsing. Without shade from willows, water temperatures rise and dissolved oxygen drops. Fish cannot survive this.',
      'Yellowstone cutthroat trout nearly vanished when the riparian zone collapsed. They only recovered after wolves brought the willows back.',
    ],
    audioFiles: ["fish_decline_0.mp3"],
    concept: 'Indicator Species',
    conceptDetail: 'Fish health directly reflects water quality, temperature stability, and habitat complexity.',
    historicalNote: 'Yellowstone cutthroat trout recovered after willows regrew, providing shade and cooler water.',
    severity: 'critical'
  },
  {
    id: 'hunting_pressure',
    condition: (s) => s.hunters > 8,
    cooldown: 300,
    title: 'Historical Extirpation Campaign',
    narrative: 'Heavy hunting is eliminating wolves rapidly. This mirrors the 1914-1926 extirpation campaign when the U.S. government systematically killed every wolf in Yellowstone to protect livestock.',
    spokenLines: [
      'Heavy hunting is wiping out the wolves. This mirrors exactly what happened in 1914 to 1926, when the U.S. government exterminated every wolf in Yellowstone.',
      'Systematic wolf extermination. The government thought killing predators would help the park. Instead, it triggered the worst ecological crisis in Yellowstone history.',
      'Hunters are overwhelming the wolves. The last Yellowstone wolf was killed in 1926. It took 69 years before anyone tried to bring them back.',
    ],
    audioFiles: ["hunting_pressure_0.mp3"],
    concept: 'Human-Driven Extinction',
    conceptDetail: 'Species can be driven to extinction or near-extinction through deliberate human hunting.',
    historicalNote: 'Last Yellowstone wolf was killed in 1926; reintroduction took 69 years to achieve in 1995.',
    severity: 'critical'
  },
  {
    id: 'full_recovery',
    condition: (s) => s.wolves >= 12 && s.elk <= 55 && s.vegetationHealth > 70 && s.riverHealth > 65 && s.beavers > 5,
    cooldown: 500,
    title: 'Ecosystem Restoration Success',
    narrative: 'Your ecosystem has recovered! Wolves control elk, vegetation thrives, rivers stabilize, beavers engineer wetlands, and fish and birds return. This mirrors Yellowstone\'s real recovery from 1995 onward.',
    spokenLines: [
      'The ecosystem has recovered. Wolves control elk, vegetation thrives, rivers run clear, and beavers are engineering wetlands again. This is what Yellowstone looks like today.',
      'Ecosystem restoration success. Every link in the food chain is working. This is what balance looks like — and it all started with bringing back the wolves.',
      'You have recreated one of ecology is greatest success stories. The Yellowstone trophic cascade recovery proves that nature can heal when we give it the right tools.',
    ],
    audioFiles: ["full_recovery_0.mp3"],
    concept: 'Ecological Restoration',
    conceptDetail: 'Active intervention to restore degraded ecosystems to functional, healthy states.',
    historicalNote: 'Yellowstone\'s trophic cascade recovery is considered one of ecology\'s great success stories.',
    severity: 'info'
  },
  {
    id: 'wolves_reintroduced',
    condition: (s) => s.wolves > 0 && s.vegetationHealth < 40,
    cooldown: 400,
    title: '1995 Reintroduction',
    narrative: 'Wolves have returned to a degraded ecosystem. In real Yellowstone, 14 wolves from Canada were released in 1995-96. Their presence triggered ecosystem-wide recovery over the following decades.',
    spokenLines: [
      'Wolves are back in a damaged landscape. In 1995, just 14 Canadian wolves were released into Yellowstone. What followed was one of ecology is greatest recovery stories.',
      'Reintroduction into a degraded ecosystem. The wolves have their work cut out for them. But if history is any guide, their presence alone will start turning things around.',
      'Fourteen wolves changed everything. They were dropped into a broken Yellowstone and triggered a cascade of recovery that scientists are still studying today.',
    ],
    audioFiles: ["wolves_reintroduced_0.mp3"],
    concept: 'Keystone Species Reintroduction',
    conceptDetail: 'Restoring a keystone species can initiate cascading recovery throughout a damaged ecosystem.',
    historicalNote: 'The 1995 reintroduction was controversial but became a textbook example of successful restoration.',
    severity: 'info'
  },

  // ─── BEAR INSIGHTS ──────────────────────────────────────────────────
  {
    id: 'bear_thriving',
    condition: (s) => s.bears >= 5 && s.bears <= 10 && s.riverHealth > 50 && s.vegetationHealth > 50,
    cooldown: 400,
    title: 'Grizzly Bears Thriving',
    narrative: 'Grizzly bears are doing well. They are fishing in healthy rivers and foraging berries from recovering vegetation. Bears are a sign of a truly healthy, complete ecosystem.',
    spokenLines: [
      'Grizzly bears are thriving. Healthy rivers for fishing, abundant berries from recovering vegetation. This is a complete ecosystem.',
      'Bears are an iconic Yellowstone species. When they are doing well, it means both the aquatic and terrestrial food webs are functioning.',
      'The grizzlies are finding everything they need — fish, berries, space. A bear-friendly landscape is a healthy landscape.',
    ],
    audioFiles: ["bear_thriving_0.mp3"],
    concept: 'Umbrella Species',
    conceptDetail: 'Protecting habitat for wide-ranging species like grizzly bears also protects many other species that share the same habitat.',
    historicalNote: 'Yellowstone grizzly populations recovered from ~136 in 1975 to over 700 today, closely tied to ecosystem health.',
    severity: 'info'
  },
  {
    id: 'bear_starving',
    condition: (s) => s.bears > 0 && s.bears < 3 && (s.riverHealth < 40 || s.vegetationHealth < 30),
    cooldown: 300,
    title: 'Grizzly Bears Struggling',
    narrative: 'Grizzly bears are disappearing. Without healthy rivers for fish or vegetation for berries, they cannot sustain themselves. Bears need a functioning ecosystem to survive.',
    spokenLines: [
      'The grizzlies are starving. No fish in degraded rivers, no berries without vegetation. They need a complete ecosystem to survive.',
      'Bears are struggling because both their food sources are failing. This is what happens when the whole web breaks down.',
      'Grizzly bear decline is a red flag. It means neither the rivers nor the forests are healthy enough to support large omnivores.',
    ],
    audioFiles: ["bear_starving_0.mp3"],
    concept: 'Trophic Omnivory',
    conceptDetail: 'Omnivores like bears feed at multiple trophic levels. Their decline signals widespread ecosystem failure across multiple food chains.',
    historicalNote: 'Yellowstone grizzlies were nearly lost when whitebark pine and cutthroat trout — key food sources — declined simultaneously.',
    severity: 'warning'
  },

  // ─── PLAYER GUIDANCE INSIGHTS ───────────────────────────────────────
  {
    id: 'guide_add_wolves',
    condition: (s) => s.wolves < 5 && s.elk > 50 && s.vegetationHealth < 60,
    cooldown: 200,
    title: 'Strategy: Add Wolves',
    narrative: 'The ecosystem needs its apex predator. Adding wolves will control elk, reduce overgrazing, and start the cascade of recovery.',
    spokenLines: [
      'This ecosystem is crying out for wolves. The elk are out of control and vegetation is suffering. Try adding some wolves.',
      'Here is a strategy tip: wolves are the key to everything. Add a few and watch how they change elk behavior almost immediately.',
      'The system needs top-down pressure. Add wolves to bring elk under control and let the vegetation start recovering.',
    ],
    audioFiles: ["guide_add_wolves_0.mp3"],
    concept: 'Top-Down Regulation',
    conceptDetail: 'Apex predators regulate entire ecosystems from the top of the food chain down.',
    historicalNote: 'The decision to reintroduce wolves was the single most impactful conservation action in Yellowstone history.',
    severity: 'info'
  },
  {
    id: 'guide_patience_trees',
    condition: (s) => s.wolves >= 8 && s.elk <= 50 && s.vegetationHealth < 50,
    cooldown: 350,
    title: 'Recovery Takes Time',
    narrative: 'Wolves are controlling elk, but vegetation recovery is slow. Trees need time to grow. Consider adding some trees to accelerate the process.',
    spokenLines: [
      'Good news — wolves are keeping elk in check. But trees grow slowly. Consider planting some to speed up recovery.',
      'The predator-prey balance is improving, but vegetation lags behind. In real Yellowstone, willow recovery took over a decade.',
      'You have the wolves in place. Now the ecosystem needs time — or a little help. Try adding trees near the river.',
    ],
    audioFiles: ["guide_patience_trees_0.mp3"],
    concept: 'Recovery Time Lag',
    conceptDetail: 'Ecosystem recovery often lags behind the intervention that triggers it, especially for slow-growing species like trees.',
    historicalNote: 'Yellowstone aspen showed significant recovery only 10-15 years after wolf reintroduction.',
    severity: 'info'
  },
  {
    id: 'guide_river_help',
    condition: (s) => s.riverHealth < 40 && s.beavers < 4 && s.vegetationHealth > 35,
    cooldown: 280,
    title: 'Strategy: Beaver Power',
    narrative: 'Rivers are struggling. Beavers are nature\'s water engineers — their dams create wetlands, slow erosion, and raise water tables. The vegetation is recovering enough to support them.',
    spokenLines: [
      'The river needs help. Try adding beavers. Their dams create ponds that raise water tables and support fish.',
      'Vegetation is starting to recover, which means beavers can now find the willows they need for dam building. Add some beavers to boost river health.',
      'Beavers are the missing piece for river recovery. One beaver family can transform an entire stretch of waterway.',
    ],
    audioFiles: ["guide_river_help_0.mp3"],
    concept: 'Beaver Dam Ecology',
    conceptDetail: 'Beaver dams create complex wetland habitats that slow water flow, trap sediment, and support biodiversity.',
    historicalNote: 'Yellowstone beaver populations recovered naturally after willows regrew, but strategic reintroduction accelerated the process.',
    severity: 'info'
  },
  {
    id: 'guide_balance_close',
    condition: (s) => {
      const sc = (clamp(s.wolves / 15, 0, 1) * 15) + ((1 - Math.abs(s.elk - 38) / 38) * 15) + (clamp(s.trees / 85, 0, 1) * 20);
      return sc > 30 && sc < 50;
    },
    cooldown: 300,
    title: 'Getting Closer',
    narrative: 'The ecosystem is starting to find its rhythm. Key relationships are forming. Keep managing populations carefully — you\'re on the right track.',
    spokenLines: [
      'The ecosystem is starting to stabilize. Keep going — you are heading in the right direction.',
      'I can see the food web connections strengthening. Maintain this trajectory and balance will follow.',
      'Progress. The relationships between species are starting to work. Stay the course and watch the score climb.',
    ],
    audioFiles: ["guide_balance_close_0.mp3"],
    concept: 'Ecosystem Resilience',
    conceptDetail: 'Healthy ecosystems develop redundant connections that make them resistant to disturbance.',
    historicalNote: 'Yellowstone scientists tracked dozens of ecosystem health indicators over decades to measure recovery progress.',
    severity: 'info'
  },
  {
    id: 'guide_overadding',
    condition: (s) => s.wolves > 25 && s.elk < 20,
    cooldown: 250,
    title: 'Too Many Predators',
    narrative: 'You have added too many wolves for the available prey. The elk population is crashing. In nature, wolf packs would disperse or die off — balance requires restraint.',
    spokenLines: [
      'Careful — too many wolves and not enough elk. The predators are overpowering the system. Nature needs balance, not dominance.',
      'The wolf population has overshot. There are not enough elk to sustain them. Try letting the system self-correct.',
      'This is a common mistake. More wolves does not always mean better. The ecosystem needs the right ratio, not just more predators.',
    ],
    audioFiles: ["guide_overadding_0.mp3"],
    concept: 'Lotka-Volterra Dynamics',
    conceptDetail: 'Predator-prey cycles follow mathematical patterns where both populations oscillate. Adding too many predators crashes the cycle.',
    historicalNote: 'Yellowstone wolf packs naturally limit their size through territorial competition — typically 6-10 per pack.',
    severity: 'warning'
  },
  {
    id: 'guide_elk_no_wolves',
    condition: (s) => s.wolves === 0 && s.elk > 30 && s.elk < 50,
    cooldown: 250,
    title: 'Elk Without Predators',
    narrative: 'Elk populations are moderate now, but without wolves they will grow explosively. This is the calm before the storm — act quickly to introduce predators.',
    spokenLines: [
      'The elk numbers look manageable now, but without wolves this will not last. They will double and triple unchecked.',
      'Do not be fooled by the current elk count. Without wolf predation, exponential growth is coming. Introduce wolves now while you still can.',
      'This quiet period is temporary. Elk breed rapidly without fear of predators. The overgrazing crisis is just a few generations away.',
    ],
    audioFiles: ["guide_elk_no_wolves_0.mp3"],
    concept: 'Exponential Growth',
    conceptDetail: 'Without predation, herbivore populations grow exponentially until they crash by exceeding carrying capacity.',
    historicalNote: 'Yellowstone elk went from manageable numbers to 25,000 in just two decades after wolf removal.',
    severity: 'warning'
  },
  {
    id: 'guide_thriving',
    condition: (s) => s.vegetationHealth > 70 && s.riverHealth > 60 && s.wolves >= 8 && s.wolves <= 20 && s.beavers >= 4,
    cooldown: 500,
    title: 'Ecosystem Thriving',
    narrative: 'The ecosystem is in excellent shape. All the key connections are working: wolves regulate elk, trees stabilize rivers, beavers engineer wetlands. This is what a healthy Yellowstone looks like.',
    spokenLines: [
      'Beautiful. The ecosystem is thriving. Every link in the food chain is doing its job. This is what Yellowstone was meant to look like.',
      'You have achieved something remarkable. Wolves, elk, trees, beavers, fish, birds — all in harmony. Hold this balance.',
      'This is the Yellowstone that exists today thanks to wolf reintroduction. You are looking at one of nature is great success stories.',
    ],
    audioFiles: ["guide_thriving_0.mp3"],
    concept: 'Climax Community',
    conceptDetail: 'A stable ecosystem where species composition remains relatively constant — the end-point of ecological succession.',
    historicalNote: 'Modern Yellowstone is considered one of the most successful large-scale ecosystem restorations in history.',
    severity: 'info'
  }
];

// ═══════════════════════════════════════════════════════════════════════════════
// FOOD WEB DIAGRAM
// ═══════════════════════════════════════════════════════════════════════════════

function FoodWebDiagram({ stats }) {
  // Nodes — positions laid out in 4 trophic tiers
  // Tier 1 (top): apex predators + secondary consumers
  // Tier 2: primary consumers (herbivores, small prey)
  // Tier 3: producers + ecosystem components
  // Tier 4: environment (river)
  const nodes = [
    // Tier 1 — apex predators + mesopredators
    { id: 'wolf',   label: '🐺', name: 'Wolves',     x: 160, y: 35,  pop: stats.wolves,           ideal: 15 },
    { id: 'bear',   label: '🐻', name: 'Grizzlies',  x: 60,  y: 35,  pop: stats.bears,            ideal: 6 },
    { id: 'coyote', label: '🐾', name: 'Coyotes',    x: 260, y: 35,  pop: stats.coyotes,          ideal: 8 },
    // Tier 2 — primary consumers
    { id: 'elk',    label: '🦌', name: 'Elk',        x: 110, y: 100, pop: stats.elk,              ideal: 38 },
    { id: 'rabbit', label: '🐰', name: 'Rabbits',    x: 220, y: 100, pop: stats.rabbits,          ideal: 22 },
    { id: 'bird',   label: '🐦', name: 'Songbirds',  x: 30,  y: 100, pop: stats.birds,            ideal: 12 },
    // Tier 3 — producers & engineers
    { id: 'veg',    label: '🌿', name: 'Vegetation', x: 80,  y: 170, pop: stats.vegetationHealth, ideal: 80 },
    { id: 'beaver', label: '🦫', name: 'Beavers',    x: 200, y: 170, pop: stats.beavers,          ideal: 8 },
    // Tier 4 — aquatic
    { id: 'fish',   label: '🐟', name: 'Fish',       x: 280, y: 170, pop: stats.fish,             ideal: 18 },
    { id: 'river',  label: '🏞️', name: 'River',      x: 160, y: 230, pop: stats.riverHealth,      ideal: 85 },
  ];

  const getHealth = (pop, ideal) => {
    if (pop <= 0) return 'missing';
    const ratio = pop / ideal;
    if (ratio > 1.5 || ratio < 0.5) return 'critical';
    if (ratio > 1.2 || ratio < 0.75) return 'stressed';
    return 'healthy';
  };
  const getColor = (health) => {
    if (health === 'missing') return '#6b7280';   // gray — absent
    if (health === 'critical') return '#ef4444';   // red
    if (health === 'stressed') return '#eab308';   // yellow
    return '#22c55e';                              // green
  };

  // Edges — EVERY relationship in the game code. Color-coded by interaction type.
  // red    = predation (eats / kills)
  // green  = mutualism/positive (builds, supports, disperses seeds, engineers)
  // orange = damage (grazes/overbrowses)
  // blue   = competition/suppression
  const edges = [
    // Predation (red)
    { from: 'wolf', to: 'elk',      color: '#ef4444', type: 'eats' },
    { from: 'coyote', to: 'rabbit', color: '#ef4444', type: 'eats' },
    { from: 'bear', to: 'fish',     color: '#ef4444', type: 'eats' },
    // Competition / mesopredator suppression (blue)
    { from: 'wolf', to: 'coyote',   color: '#3b82f6', type: 'suppresses' },
    // Grazing / browse damage (orange)
    { from: 'elk', to: 'veg',       color: '#f97316', type: 'browses' },
    { from: 'rabbit', to: 'veg',    color: '#f97316', type: 'grazes' },
    { from: 'bear', to: 'veg',      color: '#f97316', type: 'forages' },
    // Positive / engineering / support (green)
    { from: 'bird', to: 'veg',      color: '#22c55e', type: 'disperses seeds' },
    { from: 'veg', to: 'beaver',    color: '#22c55e', type: 'provides food' },
    { from: 'veg', to: 'bird',      color: '#22c55e', type: 'provides nesting' },
    { from: 'beaver', to: 'river',  color: '#22c55e', type: 'builds dams' },
    { from: 'veg', to: 'river',     color: '#22c55e', type: 'holds banks' },
    { from: 'fish', to: 'river',    color: '#22c55e', type: 'stream health' },
  ];

  return (
    <div style={{ background: '#0f172a', borderRadius: 8, border: '1px solid #334155', padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1' }}>🕸️ Live Food Web</div>
        <div style={{ fontSize: 8, color: '#64748b' }}>Game + Real Ecology</div>
      </div>
      <svg width="320" height="260" style={{ display: 'block' }}>
        <defs>
          <marker id="arrow-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#ef4444" />
          </marker>
          <marker id="arrow-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#22c55e" />
          </marker>
          <marker id="arrow-orange" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#f97316" />
          </marker>
          <marker id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#3b82f6" />
          </marker>
        </defs>
        {/* Edges */}
        {edges.map((e, i) => {
          const fromN = nodes.find(n => n.id === e.from);
          const toN = nodes.find(n => n.id === e.to);
          // Shorten the line so arrow doesn't overlap node circle
          const dx = toN.x - fromN.x, dy = toN.y - fromN.y;
          const len = Math.hypot(dx, dy);
          const ux = dx / len, uy = dy / len;
          const x1 = fromN.x + ux * 14, y1 = fromN.y + uy * 14;
          const x2 = toN.x - ux * 16, y2 = toN.y - uy * 16;
          const markerId = e.color === '#ef4444' ? 'arrow-red' : e.color === '#22c55e' ? 'arrow-green' : e.color === '#f97316' ? 'arrow-orange' : 'arrow-blue';
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={e.color} strokeWidth="1.5" opacity="0.7" markerEnd={`url(#${markerId})`}>
              <title>{nodes.find(n => n.id === e.from).name} {e.type} {nodes.find(n => n.id === e.to).name}</title>
            </line>
          );
        })}
        {/* Nodes */}
        {nodes.map(n => {
          const health = getHealth(n.pop, n.ideal);
          const color = getColor(health);
          const popLabel = (n.id === 'veg' || n.id === 'river') ? `${Math.round(n.pop)}%` : String(n.pop);
          return (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r="13" fill={color} fillOpacity="0.25" stroke={color} strokeWidth="2" />
              <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize="14">{n.label}</text>
              <text x={n.x} y={n.y + 26} textAnchor="middle" fontSize="8" fill="#cbd5e1" fontWeight="600">{popLabel}</text>
            </g>
          );
        })}
      </svg>
      {/* Legend */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 8, color: '#94a3b8', marginTop: 4 }}>
        <div><span style={{ color: '#ef4444' }}>→</span> predation</div>
        <div><span style={{ color: '#22c55e' }}>→</span> supports/builds</div>
        <div><span style={{ color: '#f97316' }}>→</span> grazes/browses</div>
        <div><span style={{ color: '#3b82f6' }}>→</span> suppresses</div>
      </div>
      <div style={{ fontSize: 8, color: '#64748b', marginTop: 3, textAlign: 'center' }}>
        Circle color: <span style={{ color: '#22c55e' }}>healthy</span> · <span style={{ color: '#eab308' }}>stressed</span> · <span style={{ color: '#ef4444' }}>critical</span> · <span style={{ color: '#6b7280' }}>missing</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const SPECIES = [
  { type: WOLF, icon: "🐺", label: "Wolves", key: "wolves", color: "#94a3b8", desc: "Apex predator. Controls elk, suppresses coyotes." },
  { type: ELK, icon: "🦌", label: "Elk", key: "elk", color: "#a78bfa", desc: "Primary herbivore. Grazes willows and aspens." },
  { type: BEAVER, icon: "🦫", label: "Beavers", key: "beavers", color: "#fb923c", desc: "Build dams from willows. Create wetland habitat." },
  { type: COYOTE, icon: "🐾", label: "Coyotes", key: "coyotes", color: "#d97706", desc: "Mesopredator. Boom without wolf suppression." },
  { type: FISH, icon: "🐟", label: "Fish", key: "fish", color: "#67e8f9", desc: "Need cool, shaded, stable water." },
  { type: BIRD, icon: "🐦", label: "Songbirds", key: "birds", color: "#fbbf24", desc: "Need mature trees for nesting." },
  { type: RABBIT, icon: "🐰", label: "Rabbits", key: "rabbits", color: "#d1d5db", desc: "Prey for coyotes. Population indicator." },
  { type: BEAR, icon: "🐻", label: "Grizzlies", key: "bears", color: "#92400e", desc: "Omnivore. Fishes, forages berries, competes with wolves." },
];

// Locked species shown as info-only in panel
const LOCKED_SPECIES = [
  { type: TREE, icon: "🌲", label: "Trees", key: "trees", color: "#22c55e", desc: "Grow naturally from ecosystem health. Cannot be planted." },
  { type: HUNTER, icon: "🎯", label: "Hunters", key: "hunters", color: "#ef4444", desc: "Auto — appear when wolves are present. Simulates historical hunting pressure." },
];

function getScoreColor(s) { return s >= 75 ? "#22c55e" : s >= 50 ? "#eab308" : s >= 25 ? "#f97316" : "#ef4444"; }
function getScoreLabel(s) { return s >= 85 ? "Pristine Balance" : s >= 70 ? "Healthy" : s >= 50 ? "Stressed" : s >= 25 ? "Degraded" : "Collapsing"; }

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const SCENARIOS = [
  {
    id: "reintro",
    title: "1995 Reintroduction",
    emoji: "🐺",
    year: "1995",
    difficulty: "Standard",
    blurb: "The canonical crisis. No wolves. Elk overrun the park. Rivers eroding. Restore the cascade.",
    learning: "Trophic cascade, keystone species, predator-prey dynamics",
    introAudio: "scenario_reintro_0.mp3",
    introLine: "Welcome to Yellowstone, 1995. For seventy years, wolves have been absent from this park. Elk have overrun the valleys and stripped the willows bare. Rivers are collapsing without roots to hold them. Your mission: add wolves from the panel, click the map to release them, and restore the balance of this ecosystem.",
  },
  {
    id: "cwd",
    title: "Chronic Wasting Disease",
    emoji: "🧬",
    year: "2024",
    difficulty: "Hard",
    blurb: "A healthy ecosystem under hidden threat. CWD kills denser elk herds. Keep populations spread out.",
    learning: "Disease ecology, density-dependent mortality",
    introAudio: "scenario_cwd_0.mp3",
    introLine: "Yellowstone, 2024. The ecosystem looks healthy, but a silent threat is spreading. Chronic Wasting Disease is a fatal prion illness that kills elk faster when the herd is crowded. Your mission: keep the elk population balanced and moderate. Too many elk means faster spread. Too few means predators will starve.",
  },
  {
    id: "drought",
    title: "Mega-Drought Summer",
    emoji: "☀️",
    year: "2021",
    difficulty: "Hard",
    blurb: "Dry river, cracked earth, withered meadows. Rebuild the ecosystem with half the water.",
    learning: "Abiotic factors, climate stress, ecosystem resilience",
    introAudio: "scenario_drought_0.mp3",
    introLine: "The summer of 2021. The worst drought in twelve hundred years grips the American West. The Yellowstone River runs shallow. Grass is cracking. Fish are dying. Your mission: stabilize this ecosystem under extreme climate stress. Every choice matters when there is no room for error.",
  },
  {
    id: "poaching",
    title: "Poaching Crisis",
    emoji: "🎯",
    year: "2008",
    difficulty: "Hard",
    blurb: "A healthy park under attack. Illegal hunters are picking off wolves. Replace them faster than they fall.",
    learning: "Human-wildlife conflict, conservation policy",
    introAudio: "scenario_poaching_0.mp3",
    introLine: "Yellowstone, 2008. A healthy wolf population has drawn unwanted attention. Poachers have crossed into the park with rifles, and they are hunting your wolves one by one. Your mission: release new wolves faster than the poachers can take them out, while protecting the rest of the food web.",
  },
  {
    id: "tourism",
    title: "Tourist Pressure",
    emoji: "🚗",
    year: "2019",
    difficulty: "Medium",
    blurb: "A busy highway cuts through the middle of the range. Wolves and bears cannot cross it. Work around the barrier.",
    learning: "Habitat fragmentation, edge effects",
    introAudio: "scenario_tourism_0.mp3",
    introLine: "Summer 2019, peak tourist season. A busy highway runs through the heart of wolf country. Wolves and bears avoid the noise and traffic. Your mission: rebuild a working ecosystem despite the broken territory. You may need to place predators on both sides of the road to cover the range.",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// REAL-WORLD DATA COMPARISON MOMENTS
// ═══════════════════════════════════════════════════════════════════════════════

const DATA_MOMENTS = [
  {
    id: "wolf_pack",
    trigger: (s) => s.wolves >= 8,
    title: "Your pack vs. real Yellowstone",
    yourStat: (s) => `${s.wolves} wolves`,
    realStat: "1997 (2 years post-reintroduction): 21 wolves in 2 packs. By 2022: 95 wolves in 9 packs.",
    audioFile: "data_wolf_milestone_0.mp3",
  },
  {
    id: "elk_collapse",
    trigger: (s) => s.elk < 25 && s.wolves >= 4,
    title: "Elk populations: your game vs. reality",
    yourStat: (s) => `${s.elk} elk remaining`,
    realStat: "Real Yellowstone elk peaked at 19,000 in 1994. By 2013: 6,000. Wolves, drought, and bears restored balance together.",
    audioFile: "data_elk_collapse_0.mp3",
  },
  {
    id: "beaver_return",
    trigger: (s) => s.beavers >= 10,
    title: "The beaver comeback",
    yourStat: (s) => `${s.beavers} beaver colonies`,
    realStat: "In 1996, only 1 colony remained. By 2020: 9 colonies rebuilt 62 miles of stream habitat.",
    audioFile: "data_beaver_return_0.mp3",
  },
  {
    id: "veg_recovery",
    trigger: (s) => s.vegetationHealth >= 80,
    title: "Willow thickets return",
    yourStat: (s) => `Vegetation health: ${Math.round(s.vegetationHealth)}%`,
    realStat: "In real Yellowstone, willow thickets along streams doubled between 2001 and 2015 after wolves reduced elk browsing.",
    audioFile: "data_veg_recovery_0.mp3",
  },
  {
    id: "pre_wolf_lesson",
    trigger: (s) => s.elk > 100,
    title: "This is what pre-wolf Yellowstone looked like",
    yourStat: (s) => `${s.elk} elk (unchecked)`,
    realStat: "Pre-wolf Yellowstone: elk reached 19,000. They destroyed willow groves so completely that beavers disappeared within a decade.",
    audioFile: "data_pre_wolf_lesson_0.mp3",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO TICK EFFECTS
// ═══════════════════════════════════════════════════════════════════════════════

// Applied every tick during "playing" state. Scenario-specific events mutate eco.
function applyScenarioEffects(eco, scenarioId, scenarioTick) {
  if (scenarioId === "cwd") {
    // Chronic Wasting Disease: every 30s, kill 2-4 random elk. Density-dependent.
    if (scenarioTick % 1800 === 0 && scenarioTick > 0) {
      const elks = eco.entities.filter(e => e.type === ELK && e.alive);
      if (elks.length > 0) {
        const density = elks.length / 50; // 1.0 = 50 elk
        const toKill = Math.min(elks.length, 2 + Math.floor(density * 2 + Math.random() * 2));
        const shuffled = [...elks].sort(() => Math.random() - 0.5).slice(0, toKill);
        for (const e of shuffled) {
          e.alive = false;
          eco.particles.push({ type: "kill", x: e.x, y: e.y, color: "#7c3aed", icon: "🦠", age: 0, maxAge: 90 });
        }
        narrator.speak("cwd_spread", "Chronic Wasting Disease is spreading.", "event_cwd_spread_0.mp3");
      }
    }
  } else if (scenarioId === "drought") {
    // Mega-Drought: permanent half-rate veg regen, shrinks river, periodic dry spells
    eco.vegetationHealth = clamp(eco.vegetationHealth - 0.006, 0, 100); // constant drain
    // Every 45s: visible "dry spell" drop
    if (scenarioTick % 2700 === 0 && scenarioTick > 0) {
      eco.vegetationHealth = clamp(eco.vegetationHealth - 8, 0, 100);
      eco.riverHealth = clamp(eco.riverHealth - 6, 0, 100);
      narrator.speak("drought_dry_spell", "Another dry spell.", "event_drought_dry_spell_0.mp3");
    }
    // River critical narration — fires when riverHealth first drops below 20
    if (eco.riverHealth < 20 && !eco._riverCriticalFired) {
      eco._riverCriticalFired = true;
      narrator.speak("drought_river_critical", "The river is critical.", "event_drought_river_critical_0.mp3");
    }
    if (eco.riverHealth > 35) eco._riverCriticalFired = false;
  } else if (scenarioId === "poaching") {
    // Poaching: hunters spawn 3x more aggressively and specifically pursue wolves
    if (scenarioTick % 600 === 0 && scenarioTick > 0) {
      const wolves = eco.entities.filter(e => e.type === WOLF && e.alive).length;
      const hunters = eco.entities.filter(e => e.type === HUNTER && e.alive).length;
      // Spawn up to 3 hunters if there are wolves to target
      if (wolves > 0 && hunters < 8) {
        const toSpawn = Math.min(3, 8 - hunters);
        for (let i = 0; i < toSpawn; i++) {
          eco.entities.push(createEntity(HUNTER, null, null, eco.W, eco.H));
        }
      }
    }
    // Wolf loss to hunter — check periodically if wolf count dropped suddenly with hunters present
    if (scenarioTick % 180 === 0) {
      const wolvesAlive = eco.entities.filter(e => e.type === WOLF && e.alive).length;
      const huntersAlive = eco.entities.filter(e => e.type === HUNTER && e.alive).length;
      const prevWolves = eco._lastWolfCountPoach ?? wolvesAlive;
      if (huntersAlive > 0 && wolvesAlive < prevWolves && prevWolves - wolvesAlive >= 1) {
        narrator.speak("poach_wolf_lost", "A wolf has been taken by poachers.", "event_poach_wolf_lost_0.mp3");
      }
      eco._lastWolfCountPoach = wolvesAlive;
    }
  } else if (scenarioId === "tourism") {
    // Tourism corridor: a vertical band through the middle of the map
    // stresses animals that enter it. Width = 15% of canvas, centered at 40%.
    const corridorX = eco.W * 0.40;
    const corridorW = eco.W * 0.15;
    let enteredCorridor = false;
    for (const e of eco.entities) {
      if (!e.alive) continue;
      if (e.type === WOLF || e.type === BEAR) {
        const dx = Math.abs(e.x - corridorX);
        if (dx < corridorW / 2) {
          // Drain energy while inside corridor
          if (e.energy !== undefined) e.energy -= 0.35;
          // Nudge them out
          const push = e.x < corridorX ? -0.8 : 0.8;
          e.vx = (e.vx || 0) + push;
          enteredCorridor = true;
        }
      }
    }
    // Corridor stress narration — cooldown-managed by NarratorManager
    if (enteredCorridor && scenarioTick % 90 === 0) {
      narrator.speak("tourism_corridor", "Animals entering the tourist corridor are stressed.", "event_tourism_corridor_0.mp3");
    }
    // Fragmentation narration — periodic reminder
    if (scenarioTick % 3600 === 0 && scenarioTick > 0) {
      narrator.speak("tourism_fragmentation", "The corridor is fragmenting the habitat.", "event_tourism_fragmentation_0.mp3");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL EVENTS — fire in any scenario (winter kill, wildfire)
// ═══════════════════════════════════════════════════════════════════════════════

function applyGlobalEvents(eco, tick) {
  // Winter kill: every ~2 minutes (7200 ticks), cull weakest 8-12% of elk if herd is large
  if (tick > 0 && tick % 7200 === 0) {
    const elks = eco.entities.filter(e => e.type === ELK && e.alive);
    if (elks.length >= 35) {
      // Kill 8-12% of the herd — target lowest-energy elk (simulates weak animals not surviving winter)
      const killCount = Math.floor(elks.length * (0.08 + Math.random() * 0.04));
      elks.sort((a, b) => (a.energy ?? 100) - (b.energy ?? 100));
      for (let i = 0; i < killCount; i++) {
        elks[i].alive = false;
        eco.particles.push({ type: "kill", x: elks[i].x, y: elks[i].y, color: "#e0e7ff", icon: "❄️", age: 0, maxAge: 90 });
      }
      narrator.speak("winter_kill", "Harsh winter.", "event_winter_kill_0.mp3");
    }
  }

  // Wildfire: ~0.3% chance per 600 ticks (~10s) check, only if veg is abundant
  if (tick > 0 && tick % 600 === 0) {
    const trees = eco.entities.filter(e => e.type === TREE && e.alive);
    if (trees.length >= 45 && Math.random() < 0.18) {
      // Pick a random fire center; burn trees within radius
      const center = trees[Math.floor(Math.random() * trees.length)];
      const radius = 120;
      let burned = 0;
      for (const t of trees) {
        const dx = t.x - center.x, dy = t.y - center.y;
        if (dx * dx + dy * dy < radius * radius) {
          t.health = 0;
          t.alive = false;
          eco.particles.push({ type: "kill", x: t.x, y: t.y, color: "#f97316", icon: "🔥", age: 0, maxAge: 120 });
          burned++;
          if (burned >= 10) break; // cap per event
        }
      }
      if (burned > 0) {
        narrator.speak("wildfire", "Wildfire in the aspen grove.", "event_wildfire_0.mp3");
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT - FULL SCREEN LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════

export default function Simulation() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const ecoRef = useRef(null);
  const animRef = useRef(null);
  const insightCounterRef = useRef({});
  const [canvasSize, setCanvasSize] = useState({ w: 1280, h: 720, lw: 1280, lh: 720 });
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState({ wolves: 0, elk: 65, trees: 55, beavers: 3, coyotes: 18, fish: 12, birds: 8, rabbits: 18, bears: 4, hunters: 0, vegetationHealth: 38, riverHealth: 42 });
  const [history, setHistory] = useState([]);
  const [score, setScore] = useState(22);
  const [alerts, setAlerts] = useState([]);
  const [selectedTool, setSelectedTool] = useState(WOLF);
  const [chartTab, setChartTab] = useState("predprey");
  const [showHelp, setShowHelp] = useState(true);
  const [showChart, setShowChart] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [portraitDismissed, setPortraitDismissed] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [audioInit, setAudioInit] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [narratorEnabled, setNarratorEnabled] = useState(true);
  const [narratorActive, setNarratorActive] = useState(false);
  const [spokenSubtitle, setSpokenSubtitle] = useState(null);
  const [showWeb, setShowWeb] = useState(false);
  const [showLearn, setShowLearn] = useState(false);
  const [currentInsight, setCurrentInsight] = useState(null);
  const [insightLog, setInsightLog] = useState([]);
  const [insightTimer, setInsightTimer] = useState(0);

  // Game state — victory/loss
  const [gameTimer, setGameTimer] = useState(0); // ticks elapsed
  const [gameState, setGameState] = useState("ready"); // ready | playing | won | lost
  const [lossReason, setLossReason] = useState(null); // "time" | "collapse"
  const [healthyStreak, setHealthyStreak] = useState(0); // consecutive ticks in "healthy" zone
  const GAME_DURATION = 36000; // 10 min at 60fps (600 seconds)
  const WIN_THRESHOLD = 75; // balance score needed
  const WIN_STREAK_NEEDED = 900; // must hold healthy for 15 seconds (900 frames)
  const COLLAPSE_THRESHOLD = 25; // score below this = collapse risk
  const COLLAPSE_DURATION = 1800; // 30 seconds below threshold = loss
  const gameTimerRef = useRef(0);
  const healthyStreakRef = useRef(0);
  const collapseStreakRef = useRef(0);

  // Global event tick tracking (for winter kill, wildfire)
  const globalEventTickRef = useRef(0);

  // Scenario system
  const [scenarioId, setScenarioId] = useState("reintro");
  const [showScenarioPicker, setShowScenarioPicker] = useState(false);
  const scenarioEventTickRef = useRef(0);

  // Real-world data comparison cards
  const [dataCard, setDataCard] = useState(null);
  const dataCardShownRef = useRef({}); // track which cards already shown this session
  const dataCardTimerRef = useRef(0);

  // Responsive canvas sizing with ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      const rect = containerRef.current.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // World scale: small screens view the same desktop-proportioned world,
      // uniformly scaled down — terrain, trees and animals shrink together
      // instead of desktop-sized sprites crowding a tiny map.
      const scale = clamp(h / 640, 0.45, 1.15);
      const lw = Math.max(320, Math.round(w / scale));
      const lh = Math.max(240, Math.round(h / scale));
      setCanvasSize({ w, h, lw, lh });
      const canvas = canvasRef.current;
      if (canvas && ecoRef.current) {
        // Canvas rasterizes at device resolution; the renderer maps the
        // logical world onto it (canvas.width / eco.W), covering HiDPI + zoom.
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const eco = ecoRef.current;
        eco.W = lw;
        eco.H = lh;
        for (const e of eco.entities) {
          e.x = clamp(e.x, 8, lw - 8);
          e.y = clamp(e.y, 8, lh - 8);
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Detect mobile and orientation
  useEffect(() => {
    const checkMobile = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth < 900;
      const isTablet = hasTouch && window.innerWidth < 1400;
      const mobile = isSmallScreen || isTablet;
      const portrait = window.innerHeight > window.innerWidth;
      setIsMobile(mobile);
      setIsPortrait(portrait);
      if (mobile) setPanelCollapsed(true);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', () => setTimeout(checkMobile, 100));
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);

  // Init ecosystem when canvas size is known
  useEffect(() => {
    if (!ecoRef.current && canvasSize.w > 0) {
      ecoRef.current = initEcosystem(canvasSize.lw ?? canvasSize.w, canvasSize.lh ?? canvasSize.h, "noWolves");
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) renderEcosystem(ctx, ecoRef.current);
    }
  }, [canvasSize]);

  const loop = useCallback(() => {
    const eco = ecoRef.current;
    if (!eco || !canvasRef.current) return;
    for (let i = 0; i < speed; i++) tickEcosystem(eco);
    const ctx = canvasRef.current.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, eco.W, eco.H);
      renderEcosystem(ctx, eco);
    }
    setStats({ ...eco.stats });
    setHistory([...eco.history]);
    setScore(eco.balanceScore);
    const newAlerts = getCascadeAlerts(eco.stats);
    setAlerts(newAlerts);

    // Game timer and win/loss logic
    if (gameState === "playing") {
      gameTimerRef.current += speed;
      if (gameTimerRef.current % 60 === 0) setGameTimer(gameTimerRef.current);

      // Track healthy streak
      if (eco.balanceScore >= WIN_THRESHOLD) {
        healthyStreakRef.current += speed;
      } else {
        healthyStreakRef.current = 0;
      }
      setHealthyStreak(healthyStreakRef.current); // every frame — drives the victory countdown

      // Track collapse streak — score below threshold for sustained period
      if (eco.balanceScore < COLLAPSE_THRESHOLD) {
        collapseStreakRef.current += speed;
      } else {
        collapseStreakRef.current = 0;
      }

      // Scenario-specific effects
      scenarioEventTickRef.current += speed;
      applyScenarioEffects(eco, scenarioId, scenarioEventTickRef.current);

      // Global events (winter kill, wildfire) — active in any scenario
      globalEventTickRef.current += speed;
      applyGlobalEvents(eco, globalEventTickRef.current);

      // Check for real-world data moment triggers every 180 ticks (3s)
      if (eco.tick % 180 === 0 && !dataCard) {
        for (const m of DATA_MOMENTS) {
          if (dataCardShownRef.current[m.id]) continue;
          if (m.trigger(eco.stats)) {
            dataCardShownRef.current[m.id] = true;
            setDataCard(m);
            dataCardTimerRef.current = 600; // 10s auto-dismiss
            // Speak the data audio if available (silent until MP3 exists)
            if (narratorEnabled && m.audioFile) {
              narrator.speak(m.id, m.realStat, m.audioFile);
            }
            break;
          }
        }
      }

      // Auto-dismiss data card
      if (dataCardTimerRef.current > 0) {
        dataCardTimerRef.current -= speed;
        if (dataCardTimerRef.current <= 0) setDataCard(null);
      }

      // Win condition: held healthy for required streak
      if (healthyStreakRef.current >= WIN_STREAK_NEEDED) {
        setGameState("won");
        setLossReason(null);
        setRunning(false);
        setHealthyStreak(healthyStreakRef.current);
        // Play win reflection audio (silent if file missing)
        if (narratorEnabled) {
          narrator.speak("win_reflection", "Real Yellowstone's cascade took fifteen years, from 1995 to 2010. You did it in minutes.", "data_win_reflection_0.mp3");
        }
      }
      // Loss: ecosystem collapsed (sustained very low score)
      else if (collapseStreakRef.current >= COLLAPSE_DURATION) {
        setGameState("lost");
        setLossReason("collapse");
        setRunning(false);
      }
      // Loss: time ran out
      else if (gameTimerRef.current >= GAME_DURATION) {
        setGameState("lost");
        setLossReason("time");
        setRunning(false);
        setGameTimer(gameTimerRef.current);
      }
    }

    // Update soundscape every 60 ticks
    if (audioInit && eco.tick % 60 === 0) {
      soundscape.update(eco.stats, newAlerts);
    }

    // Check for insights every 120 ticks
    if (eco.tick % 120 === 0) {
      for (const insight of INSIGHTS) {
        if (!insightCounterRef.current[insight.id]) insightCounterRef.current[insight.id] = 0;
        insightCounterRef.current[insight.id]++;
        if (insight.condition(eco.stats) && insightCounterRef.current[insight.id] >= insight.cooldown / 120) {
          setCurrentInsight(insight);
          setInsightTimer(12 * 60); // 12 seconds at 60 fps
          setInsightLog(prev => [insight, ...prev.slice(0, 7)]);
          insightCounterRef.current[insight.id] = 0;
          // Speak the insight via narrator (pre-generated audio files)
          if (narratorEnabled && insight.audioFiles && insight.audioFiles.length > 0) {
            // Pick a random audio file from what's available
            const audioIdx = Math.floor(Math.random() * insight.audioFiles.length);
            const audioFile = insight.audioFiles[audioIdx];
            // Use matching spoken line text for subtitle (fall back to first line)
            const line = insight.spokenLines[audioIdx] || insight.spokenLines[0];
            narrator.speak(insight.id, line, audioFile);
            setNarratorActive(true);
            setSpokenSubtitle(line);
            setTimeout(() => { setNarratorActive(false); setSpokenSubtitle(null); }, 10000);
          }
          break;
        }
      }
    }

    animRef.current = requestAnimationFrame(loop);
  }, [speed, audioInit, narratorEnabled, gameState, scenarioId, dataCard]);

  useEffect(() => {
    if (running) animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [running, loop]);

  const handleCanvasClick = (e) => {
    const eco = ecoRef.current;
    if (!eco || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = eco.W / rect.width;
    const scaleY = eco.H / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    eco.entities.push(createEntity(selectedTool, x, y, eco.W, eco.H));
    eco.particles.push({ type: "birth", x, y, color: "#60a5fa", icon: SPECIES.find(s => s.type === selectedTool)?.icon || "✨", age: 0, maxAge: 60 });

    if (!running) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, eco.W, eco.H);
        renderEcosystem(ctx, eco);
      }
      recountStats(eco);
    }
  };

  function recountStats(eco) {
    const s = {
      wolves: eco.entities.filter(e => e.type === WOLF && e.alive).length,
      elk: eco.entities.filter(e => e.type === ELK && e.alive).length,
      trees: eco.entities.filter(e => e.type === TREE && e.alive).length,
      beavers: eco.entities.filter(e => e.type === BEAVER && e.alive).length,
      coyotes: eco.entities.filter(e => e.type === COYOTE && e.alive).length,
      fish: eco.entities.filter(e => e.type === FISH && e.alive).length,
      birds: eco.entities.filter(e => e.type === BIRD && e.alive).length,
      rabbits: eco.entities.filter(e => e.type === RABBIT && e.alive).length,
      bears: eco.entities.filter(e => e.type === BEAR && e.alive).length,
      hunters: eco.entities.filter(e => e.type === HUNTER && e.alive).length,
      vegetationHealth: Math.round(eco.vegetationHealth),
      riverHealth: Math.round(eco.riverHealth),
    };
    setStats(s);
    setAlerts(getCascadeAlerts(s));
  }

  const resetAllStreaks = () => {
    gameTimerRef.current = 0;
    healthyStreakRef.current = 0;
    collapseStreakRef.current = 0;
    scenarioEventTickRef.current = 0;
    dataCardShownRef.current = {};
    setGameTimer(0);
    setHealthyStreak(0);
    setLossReason(null);
    setDataCard(null);
  };

  const handleReset = () => {
    cancelAnimationFrame(animRef.current);
    setRunning(false);
    narrator.stop();
    ecoRef.current = initEcosystem(canvasSize.lw ?? canvasSize.w, canvasSize.lh ?? canvasSize.h, "noWolves");
    const eco = ecoRef.current;
    setStats(eco.stats);
    setHistory([]);
    setScore(eco.balanceScore);
    setAlerts([]);
    setGameState("ready");
    resetAllStreaks();
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.clearRect(0, 0, eco.W, eco.H); renderEcosystem(ctx, eco); }
  };

  const handleStartGame = () => {
    if (gameState === "won" || gameState === "lost") {
      handleReset();
    }
    setGameState("playing");
    resetAllStreaks();
    setRunning(true);
  };

  // Start a specific scenario — called from intro picker
  const startScenario = (scenario) => {
    cancelAnimationFrame(animRef.current);
    narrator.stop();
    // Initialize ecosystem with scenario-specific starting state
    ecoRef.current = initScenarioEcosystem(canvasSize.lw ?? canvasSize.w, canvasSize.lh ?? canvasSize.h, scenario.id);
    const eco = ecoRef.current;
    eco.scenarioId = scenario.id; // stored on eco for rendering (e.g., tourism corridor)

    setStats(eco.stats);
    setHistory([]);
    setScore(eco.balanceScore);
    setAlerts([]);
    resetAllStreaks();
    setGameState("playing");
    setRunning(true);
    // Play scenario intro audio (silent until MP3 exists)
    if (narratorEnabled && scenario.introAudio) {
      narrator.speak(`scenario_${scenario.id}`, scenario.introLine, scenario.introAudio);
      setNarratorActive(true);
      setSpokenSubtitle(scenario.introLine);
      setTimeout(() => { setNarratorActive(false); setSpokenSubtitle(null); }, 18000);
    }
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.clearRect(0, 0, eco.W, eco.H); renderEcosystem(ctx, eco); }
  };

  const handlePreset = (preset) => {
    cancelAnimationFrame(animRef.current);
    setRunning(false);
    narrator.stop();
    setGameState("ready");
    setGameTimer(0);
    setHealthyStreak(0);
    gameTimerRef.current = 0;
    healthyStreakRef.current = 0;

    const mode = preset === "balanced" ? "balanced" : "noWolves";
    ecoRef.current = initEcosystem(canvasSize.lw ?? canvasSize.w, canvasSize.lh ?? canvasSize.h, mode);
    const eco = ecoRef.current;
    const { W: cw, H: ch } = eco;

    if (preset === "noWolves") {
      // Already set up by initEcosystem("noWolves")
    } else if (preset === "heavyHunting") {
      for (let i = 0; i < 12; i++) eco.entities.push(createEntity(HUNTER, null, null, cw, ch));
    } else if (preset === "recovery") {
      // Degraded ecosystem with wolves just reintroduced
      eco.entities = eco.entities.filter(e => e.type !== WOLF);
      eco.entities = eco.entities.filter(e => {
        if (e.type === TREE) return Math.random() > 0.5;
        if (e.type === BEAVER) return Math.random() > 0.7;
        if (e.type === BIRD) return Math.random() > 0.6;
        if (e.type === FISH) return Math.random() > 0.5;
        return true;
      });
      eco.vegetationHealth = 25; eco.riverHealth = 30;
      for (let i = 0; i < 14; i++) eco.entities.push(createEntity(WOLF, null, null, cw, ch));
    }

    setStats(eco.stats);
    setHistory([]);
    setScore(eco.balanceScore);
    setAlerts([]);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.clearRect(0, 0, eco.W, eco.H); renderEcosystem(ctx, eco); }
    recountStats(eco);
  };

  const handleAudioToggle = async () => {
    if (!audioInit) {
      try {
        // Resume context synchronously for iOS
        if (typeof Tone !== 'undefined' && Tone.context) {
          Tone.context.resume();
        }
        await soundscape.init();
        setAudioInit(true);
      } catch (e) {
        console.error('Audio init failed:', e);
      }
    } else {
      setAudioMuted(!audioMuted);
      soundscape.setMute(!audioMuted);
    }
  };

  const handleNarratorToggle = () => {
    const next = !narratorEnabled;
    setNarratorEnabled(next);
    narrator.setEnabled(next);
    if (!next) setNarratorActive(false);
    if (next) narrator.init();
  };

  // Init narrator on mount
  useEffect(() => { narrator.init(); }, []);

  // ─── INTRO NARRATION SEQUENCE ──────────────────────────────────────
  const INTRO_LINES = [
    { delay: 0, text: "Welcome to Yellowstone, 1926. The last wolf has just been killed.", audio: "intro_0.mp3" },
    { delay: 8000, text: "For decades, the government hunted every wolf in the park to protect livestock. Now the ecosystem is paying the price.", audio: "intro_1.mp3" },
    { delay: 18000, text: "Without wolves, elk are multiplying unchecked. They are devouring the willows and aspens that hold the riverbanks together.", audio: "intro_2.mp3" },
    { delay: 28000, text: "Your mission: restore this ecosystem. Add wolves and other species to bring the food web back into balance.", audio: "intro_3.mp3" },
    { delay: 37000, text: "Reach a balance score of 75 and hold it for 20 seconds to win. Good luck, ranger.", audio: "intro_4.mp3" },
  ];
  const introPlayedRef = useRef(false);

  const playIntroNarration = useCallback(() => {
    if (introPlayedRef.current) return;
    introPlayedRef.current = true;
    narrator.init();
    // Init audio — MUST call Tone.start() synchronously within gesture for iOS/Safari
    if (!audioInit) {
      // Synchronously create/resume AudioContext in the gesture handler
      if (typeof Tone !== 'undefined' && Tone.context && Tone.context.state !== 'running') {
        Tone.context.resume();
      }
      soundscape.init().then(() => {
        setAudioInit(true);
      }).catch(e => console.error('Audio init failed:', e));
    }
    INTRO_LINES.forEach(({ delay, text, audio }) => {
      setTimeout(() => {
        if (narratorEnabled) {
          narrator.speak('intro_' + delay, text, audio);
          setSpokenSubtitle(text);
          setNarratorActive(true);
          setTimeout(() => setNarratorActive(false), 6000);
          // Clear subtitle after line duration
          setTimeout(() => setSpokenSubtitle(prev => prev === text ? null : prev), 9000);
        }
      }, delay);
    });
  }, [narratorEnabled, audioInit]);

  // Update insight timer
  useEffect(() => {
    if (insightTimer > 0) {
      const timeout = setTimeout(() => setInsightTimer(insightTimer - 1), 16);
      return () => clearTimeout(timeout);
    } else if (currentInsight && insightTimer === 0) {
      setCurrentInsight(null);
    }
  }, [insightTimer, currentInsight]);

  // Reset insight counters on reset
  useEffect(() => {
    insightCounterRef.current = {};
  }, []);

  const selectedInfo = SPECIES.find(s => s.type === selectedTool);

  // ─── STYLES (mobile-responsive) ──────────────────────────────────────
  const m = isMobile;
  const S = {
    root: { width: "100vw", height: "100dvh", display: "flex", flexDirection: "column", background: "radial-gradient(1300px 700px at 75% -12%, #142137 0%, #0a0f1a 55%)", overflow: "hidden", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#e2e8f0", position: "relative" },
    topBar: { display: "flex", alignItems: "center", gap: m ? 4 : 10, padding: m ? "4px 8px" : "6px 16px", background: "linear-gradient(180deg, rgba(17,26,44,0.97), rgba(12,18,32,0.94))", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderBottom: "1px solid rgba(148,163,184,0.12)", boxShadow: "0 4px 18px rgba(0,0,0,0.35)", flexShrink: 0, height: m ? "auto" : 46, minHeight: m ? 34 : 46, zIndex: 10, overflowX: m ? "auto" : "visible", overflowY: "hidden", WebkitOverflowScrolling: "touch", flexWrap: m ? "wrap" : "nowrap" },
    main: { flex: 1, display: "flex", overflow: "hidden", position: "relative", minHeight: 0 },
    panel: { width: m ? 0 : (panelCollapsed ? 44 : 210), background: "linear-gradient(180deg, rgba(15,23,42,0.98), rgba(11,17,30,0.98))", borderRight: m ? "none" : "1px solid rgba(148,163,184,0.10)", display: "flex", flexDirection: "column", flexShrink: 0, transition: "width 0.25s cubic-bezier(0.4,0,0.2,1)", overflow: "hidden", zIndex: 5 },
    canvasWrap: { flex: 1, position: "relative", overflow: "hidden", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", paddingBottom: m ? 58 : 0 },
    bottomDock: { display: m ? "flex" : "none", position: m ? "fixed" : "static", bottom: 0, left: 0, right: 0, height: 58, background: "rgba(12,18,32,0.96)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderTop: "1px solid rgba(148,163,184,0.16)", boxShadow: "0 -6px 24px rgba(0,0,0,0.4)", overflowX: "auto", overflowY: "hidden", WebkitOverflowScrolling: "touch", alignItems: "center", padding: "0 8px", gap: 8, flexShrink: 0, zIndex: 20 },
    dockSpeciesBtn: (active, color) => ({ minWidth: 48, width: 48, height: 48, borderRadius: "50%", border: active ? `2px solid ${color}` : "2px solid rgba(71,85,105,0.6)", background: active ? `radial-gradient(circle at 35% 30%, ${color}45, ${color}18)` : "rgba(30,41,59,0.7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, cursor: "pointer", flexShrink: 0, boxShadow: active ? `0 0 16px ${color}60, inset 0 0 8px ${color}30` : "inset 0 1px 0 rgba(255,255,255,0.05)" }),
    btn: (active, color) => ({ padding: m ? "4px 8px" : "5px 12px", borderRadius: 8, border: active ? `1px solid ${color}` : "1px solid rgba(148,163,184,0.18)", background: active ? `${color}22` : "rgba(30,41,59,0.35)", color: active ? color : "#94a3b8", fontSize: m ? 10 : 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", minHeight: m ? 28 : "auto", boxShadow: active ? `0 0 10px ${color}28, inset 0 0 8px ${color}14` : "none" }),
    btnSolid: (bg) => ({ padding: m ? "5px 10px" : "6px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)", background: `linear-gradient(180deg, ${bg}, ${bg}cc)`, color: "#fff", fontSize: m ? 11 : 12, fontWeight: 700, cursor: "pointer", minHeight: m ? 28 : "auto", boxShadow: `0 2px 12px ${bg}55, inset 0 1px 0 rgba(255,255,255,0.22)`, textShadow: "0 1px 2px rgba(0,0,0,0.35)" }),
  };

  return (
    <div style={S.root}>
      {/* ═══ PORTRAIT LOCK — FULL SCREEN BLOCKER ═══ */}
      {isMobile && isPortrait && (
        <div style={{
          position: "fixed", inset: 0, background: "linear-gradient(135deg, #0a0f1a 0%, #1a1040 50%, #0a0f1a 100%)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          zIndex: 200, padding: 32, textAlign: "center",
        }}>
          <div style={{ fontSize: 64, marginBottom: 20, animation: "rotatePhone 2s ease-in-out infinite" }}>📱</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0", margin: "0 0 12px" }}>Rotate Your Device</h2>
          <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.6, maxWidth: 280, margin: "0 0 20px" }}>
            This ecosystem simulation requires landscape mode to display properly.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(30,41,59,0.8)", borderRadius: 12, padding: "10px 20px", border: "1px solid #334155" }}>
            <span style={{ fontSize: 20 }}>↻</span>
            <span style={{ fontSize: 13, color: "#60a5fa", fontWeight: 600 }}>Turn your phone sideways</span>
          </div>
        </div>
      )}

      {/* ═══ TOP BAR ═══ */}
      <div style={S.topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: m ? 2 : 6 }}>
          <span style={{ fontSize: m ? 15 : 19, filter: "drop-shadow(0 0 8px rgba(251,191,36,0.4))" }}>🐺</span>
          <div style={{ lineHeight: 1 }}>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: m ? 13 : 16, fontWeight: 900, letterSpacing: 1, background: "linear-gradient(120deg, #fde68a, #f59e0b 55%, #ef4444)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              YELLOWSTONE
            </div>
            {!m && <div style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: 3.6, color: "#64748b", marginTop: 2 }}>WOLF CRISIS</div>}
          </div>
        </div>

        {/* Score */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(30,41,59,0.65)", border: "1px solid rgba(148,163,184,0.14)", borderRadius: 99, padding: "3px 12px", boxShadow: `0 0 16px ${getScoreColor(score)}2e` }}>
          <span style={{ fontSize: 9, color: "#7c8ba1", fontWeight: 800, letterSpacing: 1.2 }}>BALANCE</span>
          <div style={{ width: 64, height: 6, background: "rgba(51,65,85,0.8)", borderRadius: 99, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.4)" }}>
            <div style={{ height: "100%", width: `${score}%`, background: `linear-gradient(90deg, ${getScoreColor(score)}aa, ${getScoreColor(score)})`, borderRadius: 99, transition: "width 0.3s", boxShadow: `0 0 8px ${getScoreColor(score)}90` }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 800, color: getScoreColor(score), fontVariantNumeric: "tabular-nums", textShadow: `0 0 10px ${getScoreColor(score)}55` }}>{score}</span>
          <span style={{ fontSize: 10, color: getScoreColor(score), fontWeight: 600 }}>{getScoreLabel(score)}</span>
        </div>

        {/* Game timer */}
        {gameState === "playing" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(30,41,59,0.65)", border: "1px solid rgba(148,163,184,0.14)", borderRadius: 99, padding: "3px 12px" }}>
            <span style={{ fontSize: 9, color: "#7c8ba1", fontWeight: 800, letterSpacing: 1.2 }}>TIME</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: gameTimerRef.current > GAME_DURATION * 0.8 ? "#ef4444" : "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>
              {Math.max(0, Math.ceil((GAME_DURATION - gameTimerRef.current) / 60))}s
            </span>
            <div style={{ width: 50, height: 5, background: "#334155", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.max(0, (1 - gameTimerRef.current / GAME_DURATION)) * 100}%`, background: gameTimerRef.current > GAME_DURATION * 0.8 ? "#ef4444" : "#60a5fa", borderRadius: 3, transition: "width 0.3s" }} />
            </div>
            {score >= WIN_THRESHOLD && (
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 10, color: "#22c55e", fontWeight: 700 }}>✓ HOLDING</span>
                <div style={{ width: 40, height: 5, background: "#334155", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (healthyStreakRef.current / WIN_STREAK_NEEDED) * 100)}%`, background: "#22c55e", borderRadius: 3 }} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scenario pill */}
        {gameState === "playing" && (() => {
          const sc = SCENARIOS.find(s => s.id === scenarioId);
          return sc ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(30,41,59,0.65)", border: "1px solid rgba(148,163,184,0.14)", borderRadius: 99, padding: "3px 12px" }} title={sc.blurb}>
              <span style={{ fontSize: 14 }}>{sc.emoji}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#cbd5e1" }}>{sc.title}</span>
            </div>
          ) : null;
        })()}

        {/* Sim controls */}
        {gameState === "ready" ? (
          <button className="ub" onClick={handleStartGame} style={S.btnSolid("#16a34a")}>▶ Start</button>
        ) : gameState === "playing" ? (
          <button className="ub" onClick={() => setRunning(!running)} style={S.btnSolid(running ? "#dc2626" : "#16a34a")}>
            {running ? "⏸ Pause" : "▶ Resume"}
          </button>
        ) : (
          <button className="ub" onClick={handleStartGame} style={S.btnSolid("#3b82f6")}>🔄 New Challenge</button>
        )}
        <button className="ub" onClick={handleReset} style={S.btn(false, "#64748b")}>Reset</button>

        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#475569" }}>Speed</span>
          {[1, 2, 4].map(s => (
            <button className="ub" key={s} onClick={() => setSpeed(s)} style={{ ...S.btn(speed === s, "#eab308"), padding: "2px 8px", fontSize: 10 }}>{s}x</button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <button className="ub" onClick={handleAudioToggle} style={S.btn(audioInit, "#a78bfa")} title={audioInit ? (audioMuted ? 'Unmute' : 'Mute') : 'Click for sound'}>
          {audioInit ? (audioMuted ? '🔇' : '🔊') : '🔇'}{!m && ' Sound'}
        </button>
        <button className="ub" onClick={handleNarratorToggle} style={{ ...S.btn(narratorEnabled, "#f472b6"), position: "relative" }} title={narratorEnabled ? 'Mute narrator' : 'Enable narrator'}>
          {narratorEnabled ? '🎙️' : '🔕'}{!m && ' Narrator'}
          {narratorActive && narratorEnabled && <span style={{ position: "absolute", top: -2, right: -2, width: 7, height: 7, borderRadius: "50%", background: "#f472b6", animation: "pulse 1s infinite" }} />}
        </button>
        <button className="ub" onClick={() => setShowWeb(!showWeb)} style={S.btn(showWeb, "#fb923c")} title="Food Web Diagram">🕸️ {m ? "" : "Web"}</button>
        {!m && <button className="ub" onClick={() => setShowLearn(!showLearn)} style={S.btn(showLearn, "#60a5fa")}>📚 Learn</button>}
        <button className="ub" onClick={() => setShowChart(!showChart)} style={S.btn(showChart, "#60a5fa")} title="Predator-Prey Chart (toggle on/off)">📊 {m ? "" : "Chart"}</button>
        <button className="ub" onClick={() => setShowHelp(true)} style={S.btn(false, "#64748b")}>{m ? '?' : '?'}</button>
      </div>

      {/* ═══ MAIN AREA ═══ */}
      <div style={S.main}>
        {/* ─── Left Panel (desktop only) ─── */}
        {!m && (
        <div style={S.panel}>
          <button className="ub" onClick={() => setPanelCollapsed(!panelCollapsed)} style={{ background: "transparent", border: "none", color: "#64748b", padding: "8px", cursor: "pointer", fontSize: 14, textAlign: "center" }}>
            {panelCollapsed ? "▸" : "◂"}
          </button>

          {!panelCollapsed && (
            <>
              {/* Add mode label */}
              <div style={{ padding: "6px 8px", margin: "0 8px 8px", borderRadius: 9, background: "linear-gradient(135deg, rgba(22,101,52,0.9), rgba(13,148,136,0.55))", border: "1px solid rgba(74,222,128,0.35)", textAlign: "center", fontSize: 11, fontWeight: 700, color: "#bbf7d0", textShadow: "0 1px 2px rgba(0,0,0,0.4)", animation: "glowBreathe 3s ease-in-out infinite" }}>
                + Click to Add Species
              </div>

              {/* Species buttons */}
              <div style={{ flex: 1, overflowY: "auto", padding: "0 6px" }}>
                {SPECIES.map(sp => (
                  <button className="ub" key={sp.type} onClick={() => setSelectedTool(sp.type)} style={{
                    display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "5px 7px", borderRadius: 6, marginBottom: 2,
                    border: selectedTool === sp.type ? `2px solid ${sp.color}` : "2px solid transparent",
                    background: selectedTool === sp.type ? `${sp.color}15` : "transparent",
                    color: "#e2e8f0", cursor: "pointer", textAlign: "left",
                  }}>
                    <span style={{ fontSize: 16, filter: selectedTool === sp.type ? `drop-shadow(0 0 6px ${sp.color})` : "none" }}>{sp.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600 }}>{sp.label}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: selectedTool === sp.type ? sp.color : "#64748b", background: "rgba(51,65,85,0.5)", borderRadius: 99, padding: "1px 8px", fontVariantNumeric: "tabular-nums" }}>{stats[sp.key] ?? 0}</span>
                  </button>
                ))}
              </div>

              {/* Locked species (hunters - auto-controlled) */}
              <div style={{ padding: "2px 6px", marginTop: 2 }}>
                {LOCKED_SPECIES.map(sp => (
                  <div key={sp.type} style={{
                    display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "5px 7px", borderRadius: 6,
                    background: "rgba(239,68,68,0.08)", border: "1px dashed #47415530", opacity: 0.7,
                  }}>
                    <span style={{ fontSize: 15 }}>{sp.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: sp.color }}>{sp.label} <span style={{ fontSize: 8, color: "#64748b" }}>AUTO</span></div>
                      <div style={{ fontSize: 9, color: "#64748b" }}>{stats[sp.key] ?? 0} active</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Selected info */}
              {selectedInfo && (
                <div style={{ padding: "8px 10px", borderTop: "1px solid #1e293b", fontSize: 10, color: "#64748b", lineHeight: 1.4 }}>
                  <span style={{ color: selectedInfo.color, fontWeight: 700 }}>{selectedInfo.icon} {selectedInfo.label}:</span> {selectedInfo.desc}
                </div>
              )}

              {/* Env stats */}
              <div style={{ padding: "6px 10px", borderTop: "1px solid #1e293b" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
                  <span style={{ color: "#34d399" }}>🌿 Vegetation</span>
                  <span style={{ color: "#34d399", fontWeight: 700 }}>{stats.vegetationHealth}%</span>
                </div>
                <div style={{ height: 6, background: "rgba(30,41,59,0.8)", borderRadius: 99, overflow: "hidden", marginBottom: 5, boxShadow: "inset 0 1px 2px rgba(0,0,0,0.4)" }}>
                  <div style={{ height: "100%", width: `${stats.vegetationHealth}%`, background: "linear-gradient(90deg, #10b981, #34d399)", borderRadius: 99, boxShadow: "0 0 8px rgba(52,211,153,0.5)", transition: "width 0.4s" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
                  <span style={{ color: "#60a5fa" }}>🏞️ River</span>
                  <span style={{ color: "#60a5fa", fontWeight: 700 }}>{stats.riverHealth}%</span>
                </div>
                <div style={{ height: 6, background: "rgba(30,41,59,0.8)", borderRadius: 99, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.4)" }}>
                  <div style={{ height: "100%", width: `${stats.riverHealth}%`, background: "linear-gradient(90deg, #3b82f6, #60a5fa)", borderRadius: 99, boxShadow: "0 0 8px rgba(96,165,250,0.5)", transition: "width 0.4s" }} />
                </div>
              </div>
            </>
          )}
        </div>
        )}

        {/* ─── Canvas & Bottom Dock Container ─── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, minWidth: 0 }}>
          {/* ─── Canvas ─── */}
          <div ref={containerRef} style={{ ...S.canvasWrap, flex: 1 }}>
          <canvas
            ref={canvasRef}
            width={Math.round(canvasSize.w * Math.min((typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1, 2))}
            height={Math.round(canvasSize.h * Math.min((typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1, 2))}
            onClick={handleCanvasClick}
            style={{ display: "block", width: "100%", height: "100%", cursor: "crosshair" }}
          />

          {/* Tool cursor label + compact HUD */}
          <div style={{ position: "absolute", top: m ? 4 : 8, left: m ? 4 : 8, pointerEvents: "none", zIndex: 3 }}>
            <div style={{ background: "rgba(13,19,32,0.82)", backdropFilter: "blur(8px)", borderRadius: 99, padding: m ? "3px 10px" : "4px 13px", fontSize: m ? 10 : 11, fontWeight: 600, color: "#cbd5e1", border: `1px solid ${selectedInfo?.color ?? "#334155"}55`, boxShadow: `0 0 12px ${selectedInfo?.color ?? "#000"}25`, marginBottom: 4 }}>
              + {selectedInfo?.icon} {selectedInfo?.label}
            </div>
            {/* Mini population HUD (especially useful on mobile) */}
            {m && running && (
              <div style={{ background: "rgba(15,23,42,0.85)", borderRadius: 6, padding: "4px 8px", border: "1px solid #1e293b", display: "flex", flexWrap: "wrap", gap: "3px 8px", maxWidth: 180 }}>
                <span style={{ fontSize: 9, color: "#94a3b8" }}>🐺{stats.wolves}</span>
                <span style={{ fontSize: 9, color: "#a78bfa" }}>🦌{stats.elk}</span>
                <span style={{ fontSize: 9, color: "#22c55e" }}>🌲{stats.trees}</span>
                <span style={{ fontSize: 9, color: "#fb923c" }}>🦫{stats.beavers}</span>
                <span style={{ fontSize: 9, color: "#d97706" }}>🐾{stats.coyotes}</span>
                <span style={{ fontSize: 9, color: "#67e8f9" }}>🐟{stats.fish}</span>
                <span style={{ fontSize: 9, color: "#fbbf24" }}>🐦{stats.birds}</span>
                <span style={{ fontSize: 9, color: "#92400e" }}>🐻{stats.bears}</span>
              </div>
            )}
          </div>

          {/* Victory countdown — visible while balance is held at the win threshold */}
          {gameState === "playing" && score >= WIN_THRESHOLD && (() => {
            const victorySeconds = Math.max(1, Math.ceil((WIN_STREAK_NEEDED - healthyStreak) / 60));
            const victoryProgress = Math.min(1, healthyStreak / WIN_STREAK_NEEDED);
            const urgent = victorySeconds <= 5;
            const ringC = urgent ? "#fbbf24" : "#22c55e";
            return (
              <>
                {/* soft green glow around the whole valley while holding */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5, boxShadow: `inset 0 0 90px ${urgent ? "rgba(251,191,36,0.28)" : "rgba(34,197,94,0.24)"}` }} />
                <div style={{
                  position: "absolute", top: m ? 44 : 14, left: "50%", zIndex: 7, pointerEvents: "none",
                  display: "flex", alignItems: "center", gap: m ? 8 : 11,
                  background: "rgba(6, 30, 16, 0.88)", backdropFilter: "blur(10px)",
                  border: `1px solid ${urgent ? "rgba(251,191,36,0.6)" : "rgba(34,197,94,0.55)"}`,
                  borderRadius: 99, padding: m ? "6px 13px" : "8px 18px",
                  animation: `victoryPulse ${urgent ? 0.55 : 1.3}s ease-in-out infinite`,
                }}>
                  <svg width={m ? 30 : 40} height={m ? 30 : 40} viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="16" fill="none" stroke={`${ringC}33`} strokeWidth="4" />
                    <circle cx="20" cy="20" r="16" fill="none" stroke={ringC} strokeWidth="4" strokeLinecap="round"
                      strokeDasharray={Math.PI * 32} strokeDashoffset={Math.PI * 32 * (1 - victoryProgress)}
                      transform="rotate(-90 20 20)" style={{ transition: "stroke-dashoffset 0.15s linear" }} />
                    <text x="20" y="25.5" textAnchor="middle" fill={urgent ? "#fde68a" : "#bbf7d0"} fontSize="14" fontWeight="800">{victorySeconds}</text>
                  </svg>
                  <div style={{ lineHeight: 1.25 }}>
                    <div style={{ fontSize: m ? 10 : 12, fontWeight: 800, color: urgent ? "#fde68a" : "#86efac", letterSpacing: 1.2 }}>
                      ECOSYSTEM IN BALANCE
                    </div>
                    <div style={{ fontSize: m ? 9 : 10.5, fontWeight: 600, color: urgent ? "#fbbf24" : "#4ade80" }}>
                      {urgent ? `Almost there — ${victorySeconds}s!` : `Victory in ${victorySeconds}s — hold steady`}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

          {/* Alerts overlay */}
          {alerts.length > 0 && (
            <div style={{ position: "absolute", bottom: m ? 62 : 12, left: 12, maxWidth: 340, pointerEvents: "none", zIndex: 4 }}>
              {alerts.slice(0, 3).map((a, i) => (
                <div key={i} style={{
                  background: "rgba(13,19,32,0.9)",
                  border: "1px solid rgba(148,163,184,0.14)",
                  borderLeft: `3px solid ${a.sev === "crit" ? "#ef4444" : "#eab308"}`,
                  borderRadius: 10, padding: "7px 11px", marginBottom: 5, backdropFilter: "blur(8px)",
                  boxShadow: "0 6px 18px rgba(0,0,0,0.35)", animation: "slideInLeft 0.3s ease",
                }}>
                  <span style={{ fontWeight: 700, fontSize: 11, color: a.sev === "crit" ? "#fca5a5" : "#fcd34d" }}>{a.icon} {a.title}</span>
                  <span style={{ fontSize: 10, color: "#d6d3d1", marginLeft: 6 }}>{a.msg}</span>
                </div>
              ))}
            </div>
          )}

          {/* Narrator subtitle bar */}
          {spokenSubtitle && narratorEnabled && (
            <div style={{
              position: "absolute", bottom: alerts.length > 0 ? (m ? 110 : 80) : (m ? 62 : 16), left: "50%", transform: "translateX(-50%)",
              maxWidth: m ? "92%" : "70%", background: "rgba(0,0,0,0.82)", borderRadius: m ? 8 : 10, padding: m ? "6px 12px" : "10px 20px",
              border: "1px solid rgba(244,114,182,0.3)", backdropFilter: "blur(8px)", zIndex: 5, pointerEvents: "none",
              animation: "subtitleFadeIn 0.4s ease-out",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: m ? 11 : 14 }}>🎙️</span>
                <span style={{ fontSize: m ? 10 : 12, color: "#f1f5f9", lineHeight: 1.4, fontStyle: "italic" }}>{spokenSubtitle}</span>
              </div>
            </div>
          )}

          {/* Season & Year indicator */}
          {running && ecoRef.current && (
            <div style={{
              position: "absolute", top: 8, right: 8, background: "rgba(13,19,32,0.82)", backdropFilter: "blur(8px)", borderRadius: 99,
              padding: "4px 14px", fontSize: 11, color: "#94a3b8", pointerEvents: "none", border: "1px solid rgba(148,163,184,0.16)",
              boxShadow: "0 4px 14px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontWeight: 700, color: ["#86efac","#22c55e","#f97316","#93c5fd"][Math.floor(ecoRef.current.season % 4)] }}>
                {["Spring","Summer","Autumn","Winter"][Math.floor(ecoRef.current.season % 4)]}
              </span>
              <span style={{ color: "#64748b" }}>Year {Math.floor(ecoRef.current.season / 4) + 1}</span>
            </div>
          )}

          {/* Food Web overlay */}
          {showWeb && (
            <div style={{ position: "absolute", bottom: 12, right: 12, zIndex: 6, pointerEvents: "auto" }}>
              <FoodWebDiagram stats={stats} />
            </div>
          )}

          {/* Learning panel */}
          {showLearn && (
            <div style={{ position: "absolute", top: 12, right: 12, width: 320, maxHeight: "calc(100vh - 80px)", background: "rgba(15,23,42,0.96)", borderRadius: 12, padding: 14, border: "1px solid #334155", backdropFilter: "blur(8px)", zIndex: 6, overflow: "hidden", display: "flex", flexDirection: "column", pointerEvents: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa" }}>📚 Ecological Insights</span>
                <button className="ub" onClick={() => setShowLearn(false)} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>

              {currentInsight && (
                <div style={{ background: "#1e293b", borderRadius: 8, padding: 10, marginBottom: 10, borderLeft: `3px solid ${currentInsight.severity === 'critical' ? '#ef4444' : currentInsight.severity === 'warning' ? '#eab308' : '#34d399'}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: currentInsight.severity === 'critical' ? '#fca5a5' : currentInsight.severity === 'warning' ? '#fcd34d' : '#86efac', marginBottom: 4 }}>{currentInsight.title}</div>
                  <div style={{ fontSize: 10, color: "#cbd5e1", marginBottom: 6, lineHeight: 1.4 }}>{currentInsight.narrative}</div>
                  <div style={{ fontSize: 9, padding: 6, background: "#0f172a", borderRadius: 4, marginBottom: 4 }}>
                    <div style={{ color: "#60a5fa", fontWeight: 600 }}>Concept: {currentInsight.concept}</div>
                    <div style={{ color: "#94a3b8", fontSize: 8, marginTop: 2 }}>{currentInsight.conceptDetail}</div>
                  </div>
                  <div style={{ fontSize: 9, color: "#64748b", fontStyle: 'italic' }}>Yellowstone: {currentInsight.historicalNote}</div>
                </div>
              )}

              {insightLog.length > 0 && (
                <div style={{ flex: 1, overflowY: "auto", borderTop: "1px solid #334155", paddingTop: 10 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Recent Insights</div>
                  {insightLog.map((insight, i) => (
                    <div key={i} style={{ fontSize: 9, padding: 6, background: "#0f172a", borderRadius: 4, marginBottom: 4, cursor: 'pointer', borderLeft: `2px solid ${insight.severity === 'critical' ? '#ef4444' : insight.severity === 'warning' ? '#eab308' : '#34d399'}` }}>
                      <div style={{ fontWeight: 600, color: "#cbd5e1", marginBottom: 2 }}>{insight.title}</div>
                      <div style={{ color: "#94a3b8", fontSize: 8 }}>{insight.narrative.substring(0, 60)}...</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chart overlay */}
          {showChart && (
            <div style={{ position: "absolute", top: 12, right: 12, width: 360, background: "rgba(15,23,42,0.94)", borderRadius: 12, padding: 14, border: "1px solid #334155", backdropFilter: "blur(8px)", zIndex: 6 }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                {[
                  { key: "predprey", label: "Predator/Prey" },
                  { key: "meso", label: "Mesopredators" },
                  { key: "habitat", label: "Habitat" },
                  { key: "balance", label: "Score" },
                ].map(t => (
                  <button className="ub" key={t.key} onClick={() => setChartTab(t.key)} style={{
                    padding: "3px 9px", borderRadius: 5, border: "none", fontSize: 10, fontWeight: 600, cursor: "pointer",
                    background: chartTab === t.key ? "#334155" : "transparent", color: chartTab === t.key ? "#fff" : "#64748b",
                  }}>{t.label}</button>
                ))}
                <div style={{ flex: 1 }} />
                <button className="ub" onClick={() => setShowChart(false)} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>
              <div style={{ height: 180 }}>
                {history.length < 2 ? (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 11 }}>
                    Run simulation to see trends...
                  </div>
                ) : chartTab === "predprey" ? (
                  <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
                    <div style={{ fontSize: 10, color: "#cbd5e1", fontWeight: 700, textAlign: "center", padding: "2px 0 0" }}>
                      Predator-Prey Dynamics
                      <div style={{ fontSize: 8, color: "#64748b", fontWeight: 400 }}>Lotka-Volterra Oscillation</div>
                    </div>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history} margin={{ top: 6, right: 10, left: 22, bottom: 18 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="t" stroke="#475569" fontSize={8} tickLine={false} label={{ value: "Time (simulated years)", position: "insideBottom", offset: -4, fill: "#64748b", fontSize: 8 }} />
                        <YAxis stroke="#475569" fontSize={8} tickLine={false} label={{ value: "Population Density", angle: -90, position: "insideLeft", offset: 10, fill: "#64748b", fontSize: 8, style: { textAnchor: "middle" } }} />
                        <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 9 }} />
                        <Legend wrapperStyle={{ fontSize: 9, paddingLeft: 8 }} verticalAlign="top" align="right" />
                        <Line type="natural" dataKey="elk" stroke="#fbbf24" strokeWidth={3} dot={false} name="Prey (Elk)" isAnimationActive={false} />
                        <Line type="natural" dataKey="wolves" stroke="#3b82f6" strokeWidth={3} dot={false} name="Predator (Wolves)" isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : chartTab === "meso" ? (
                  <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
                    <div style={{ fontSize: 10, color: "#cbd5e1", fontWeight: 700, textAlign: "center", padding: "2px 0 0" }}>
                      Mesopredators & Small Prey
                      <div style={{ fontSize: 8, color: "#64748b", fontWeight: 400 }}>Watch coyotes boom when wolves decline</div>
                    </div>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history} margin={{ top: 6, right: 10, left: 10, bottom: 14 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="t" stroke="#475569" fontSize={8} tickLine={false} />
                        <YAxis stroke="#475569" fontSize={8} tickLine={false} />
                        <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 9 }} />
                        <Legend wrapperStyle={{ fontSize: 9 }} />
                        <Line type="natural" dataKey="coyotes" stroke="#d97706" strokeWidth={2} dot={false} name="Coyotes" />
                        <Line type="natural" dataKey="rabbits" stroke="#d1d5db" strokeWidth={2} dot={false} name="Rabbits" />
                        <Line type="natural" dataKey="birds" stroke="#fbbf24" strokeWidth={2} dot={false} name="Songbirds" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : chartTab === "habitat" ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="t" stroke="#475569" fontSize={8} tickLine={false} />
                      <YAxis stroke="#475569" fontSize={8} tickLine={false} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 9 }} />
                      <Legend wrapperStyle={{ fontSize: 9 }} />
                      <Area type="monotone" dataKey="vegetationHealth" stroke="#34d399" fill="#34d39920" strokeWidth={2} name="Vegetation %" />
                      <Area type="monotone" dataKey="riverHealth" stroke="#60a5fa" fill="#60a5fa20" strokeWidth={2} name="River Health %" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="t" stroke="#475569" fontSize={8} tickLine={false} />
                      <YAxis stroke="#475569" fontSize={8} tickLine={false} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 9 }} />
                      <Area type="monotone" dataKey="score" stroke="#eab308" fill="#eab30820" strokeWidth={2} name="Ecosystem Balance" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}
          </div>

          {/* ─── Bottom Dock (Mobile Species Selection) ─── */}
          {m && (
            <div style={S.bottomDock}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 6px", minWidth: 60, borderRight: "1px solid #334155" }}>
                {selectedInfo && (
                  <>
                    <span style={{ fontSize: 16 }}>{selectedInfo.icon}</span>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: selectedInfo.color, whiteSpace: "nowrap" }}>{selectedInfo.label}</div>
                      <div style={{ fontSize: 9, color: "#64748b" }}>{stats[selectedInfo.key] ?? 0}</div>
                    </div>
                  </>
                )}
              </div>
              {SPECIES.map(sp => (
                <button className="ub" key={sp.type} onClick={() => setSelectedTool(sp.type)}
                  style={S.dockSpeciesBtn(selectedTool === sp.type, sp.color)}
                  title={`${sp.label} (${stats[sp.key] ?? 0})`}
                >{sp.icon}</button>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 6px", borderLeft: "1px solid #334155", fontSize: 10, color: "#64748b" }}>
                <span>🌲 {stats.trees ?? 0}</span>
                <span>🎯 {stats.hunters ?? 0}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ VICTORY MODAL ═══ */}
      {gameState === "won" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "linear-gradient(160deg, #0f2a1a, #101b2e 70%)", borderRadius: 20, padding: m ? 20 : 34, maxWidth: m ? "90vw" : 520, margin: 20, border: "1px solid rgba(34,197,94,0.5)", boxShadow: "0 0 60px rgba(34,197,94,0.22), 0 30px 90px rgba(0,0,0,0.6)", textAlign: "center", animation: "popIn 0.45s cubic-bezier(0.34, 1.4, 0.64, 1)" }}>
            <div style={{ fontSize: m ? 36 : 50, marginBottom: 12, filter: "drop-shadow(0 6px 20px rgba(34,197,94,0.45))" }}>🐺🌲🏔️</div>
            <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: m ? 20 : 28, fontWeight: 900, margin: "0 0 8px", color: "#86efac", textShadow: "0 0 24px rgba(34,197,94,0.4)" }}>Ecosystem Restored!</h2>
            <p style={{ fontSize: m ? 12 : 14, color: "#cbd5e1", lineHeight: 1.6, margin: "0 0 16px" }}>
              You achieved a balanced ecosystem and held it stable. Wolves are controlling elk, vegetation is thriving, rivers are healthy, and the entire food web is functioning.
            </p>
            <p style={{ fontSize: m ? 10 : 12, color: "#94a3b8", margin: "0 0 16px", padding: m ? "8px 10px" : "10px 14px", background: "#0f172a", borderRadius: 8, lineHeight: 1.5 }}>
              <strong style={{ color: "#60a5fa" }}>In real Yellowstone:</strong> This recovery took from 1995 to roughly 2010 — about 15 years. You did it in {Math.floor(gameTimerRef.current / 60)} seconds ({Math.round(GAME_DURATION / 60 - gameTimerRef.current / 60)}s remaining)!
            </p>
            <div style={{ display: "flex", gap: m ? 6 : 10, justifyContent: "center", flexDirection: m ? "column" : "row", flexWrap: "wrap" }}>
              <button className="ub" onClick={handleStartGame} style={{ padding: m ? "8px 16px" : "10px 22px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #16a34a, #0d9488)", color: "#fff", fontWeight: 700, fontSize: m ? 12 : 14, cursor: "pointer" }}>
                Play Again
              </button>
              <button className="ub" onClick={() => { handleReset(); setShowHelp(true); }} style={{ padding: m ? "8px 16px" : "10px 22px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", fontWeight: 700, fontSize: m ? 12 : 14, cursor: "pointer" }}>
                🏞️ New Scenario
              </button>
              <button className="ub" onClick={() => { handleReset(); setShowHelp(false); }} style={{ padding: m ? "8px 16px" : "10px 22px", borderRadius: 8, border: "1px solid #334155", background: "transparent", color: "#94a3b8", fontWeight: 600, fontSize: m ? 11 : 13, cursor: "pointer" }}>
                Free Play
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ LOSS MODAL ═══ */}
      {gameState === "lost" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "linear-gradient(160deg, #2a0f0f, #101b2e 70%)", borderRadius: 20, padding: m ? 20 : 34, maxWidth: m ? "90vw" : 520, margin: 20, border: "1px solid rgba(239,68,68,0.5)", boxShadow: "0 0 60px rgba(239,68,68,0.2), 0 30px 90px rgba(0,0,0,0.6)", textAlign: "center", animation: "popIn 0.45s cubic-bezier(0.34, 1.4, 0.64, 1)" }}>
            <div style={{ fontSize: m ? 36 : 50, marginBottom: 12, filter: "drop-shadow(0 6px 20px rgba(239,68,68,0.4))" }}>{lossReason === "collapse" ? "🏜️💀" : "⏰💀"}</div>
            <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: m ? 20 : 28, fontWeight: 900, margin: "0 0 8px", color: "#fca5a5" }}>
              {lossReason === "collapse" ? "Ecosystem Collapsed" : "Time Expired"}
            </h2>
            <p style={{ fontSize: m ? 12 : 14, color: "#cbd5e1", lineHeight: 1.6, margin: "0 0 16px" }}>
              {lossReason === "collapse"
                ? `The balance score stayed below ${COLLAPSE_THRESHOLD} for too long. The ecosystem is past the point of recovery.`
                : `Time ran out before you could stabilize the ecosystem. You needed ${WIN_THRESHOLD}+ balance held for ${Math.round(WIN_STREAK_NEEDED / 60)} seconds.`}
            </p>
            <p style={{ fontSize: m ? 10 : 12, color: "#94a3b8", margin: "0 0 8px", lineHeight: 1.5 }}>
              <strong>Your final score:</strong> <span style={{ color: getScoreColor(score), fontWeight: 700, fontSize: m ? 14 : 16 }}>{score}</span>
            </p>
            <p style={{ fontSize: m ? 9 : 11, color: "#64748b", margin: "0 0 16px", padding: m ? "6px 10px" : "8px 12px", background: "#0f172a", borderRadius: 8 }}>
              <strong style={{ color: "#eab308" }}>Hint:</strong> {score < 40 ? "Try adding wolves early — they control elk and trigger the whole cascade of recovery." : score < 60 ? "You're on the right track. Focus on getting wolves and elk balanced first, then let vegetation recover." : "So close! Once the balance score hits " + WIN_THRESHOLD + ", you need to hold it steady. Avoid adding too many of any one species."}
            </p>
            <div style={{ display: "flex", gap: m ? 6 : 10, justifyContent: "center", flexDirection: m ? "column" : "row", flexWrap: "wrap" }}>
              <button className="ub" onClick={handleStartGame} style={{ padding: m ? "8px 16px" : "10px 22px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #dc2626, #ea580c)", color: "#fff", fontWeight: 700, fontSize: m ? 12 : 14, cursor: "pointer" }}>
                Try Again
              </button>
              <button className="ub" onClick={() => { handleReset(); setShowHelp(true); }} style={{ padding: m ? "8px 16px" : "10px 22px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", fontWeight: 700, fontSize: m ? 12 : 14, cursor: "pointer" }}>
                🏞️ New Scenario
              </button>
              <button className="ub" onClick={() => { handleReset(); setShowHelp(false); }} style={{ padding: m ? "8px 16px" : "10px 22px", borderRadius: 8, border: "1px solid #334155", background: "transparent", color: "#94a3b8", fontWeight: 600, fontSize: m ? 11 : 13, cursor: "pointer" }}>
                Free Play
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ INTRO / SCENARIO PICKER MODAL ═══ */}
      {showHelp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 12 }}>
          <div style={{ background: "linear-gradient(165deg, #13203a 0%, #0d1526 55%, #0f1a2e 100%)", borderRadius: 20, padding: m ? "18px 16px 14px" : "26px 30px 22px", maxWidth: m ? "94vw" : 730, width: "100%", margin: 12, border: "1px solid rgba(148,163,184,0.16)", boxShadow: "0 30px 90px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.05)", maxHeight: "92vh", overflowY: "auto", animation: "popIn 0.4s cubic-bezier(0.34, 1.4, 0.64, 1)" }}>
            <div style={{ textAlign: "center", marginBottom: m ? 10 : 14 }}>
              <div style={{ fontSize: m ? 30 : 42, marginBottom: 4, filter: "drop-shadow(0 6px 18px rgba(249,115,22,0.35))" }}>🐺🏔️</div>
              <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: m ? 22 : 32, fontWeight: 900, letterSpacing: 0.3, margin: "0 0 6px", background: "linear-gradient(120deg, #fde68a 0%, #f59e0b 45%, #ef4444 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Yellowstone Wolf Crisis
              </h2>
              <p style={{ fontSize: m ? 10 : 12, color: "#94a3b8", margin: "0 0 4px" }}>
                Reach <strong style={{ color: "#22c55e" }}>{WIN_THRESHOLD}+</strong> balance and hold it for <strong>{Math.round(WIN_STREAK_NEEDED / 60)}s</strong> to win. <strong>{Math.round(GAME_DURATION / 60)}s</strong> time limit. <strong style={{ color: "#ef4444" }}>Score below {COLLAPSE_THRESHOLD}</strong> for too long = ecosystem collapse.
              </p>
            </div>
            <div style={{ fontSize: m ? 10 : 11, color: "#64748b", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", margin: "0 0 8px", textAlign: "center" }}>Choose Your Scenario</div>
            <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))", gap: m ? 8 : 10 }}>
              {SCENARIOS.map(sc => (
                <button
                  className="ub card-lift"
                  key={sc.id}
                  onClick={() => { setShowHelp(false); setScenarioId(sc.id); startScenario(sc); }}
                  style={{
                    padding: m ? "10px 12px" : "13px 15px",
                    borderRadius: 13,
                    border: scenarioId === sc.id ? "2px solid #22c55e" : "1px solid rgba(148,163,184,0.15)",
                    background: "linear-gradient(150deg, rgba(30,41,59,0.55), rgba(15,23,42,0.92))",
                    boxShadow: "0 4px 14px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)",
                    color: "#e2e8f0",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: m ? 18 : 22 }}>{sc.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: m ? 12 : 14, fontWeight: 700, color: "#fff" }}>{sc.title}</div>
                      <div style={{ fontSize: m ? 9 : 10, color: "#64748b" }}>{sc.year} · <span style={{ color: sc.difficulty === "Hard" ? "#ef4444" : sc.difficulty === "Medium" ? "#eab308" : "#22c55e" }}>{sc.difficulty}</span></div>
                    </div>
                  </div>
                  <div style={{ fontSize: m ? 10 : 11, color: "#cbd5e1", lineHeight: 1.4, marginBottom: 4 }}>{sc.blurb}</div>
                  <div style={{ fontSize: m ? 9 : 10, color: "#64748b", fontStyle: "italic" }}>Teaches: {sc.learning}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ REAL-WORLD DATA CARD ═══ */}
      {dataCard && (
        <div style={{ position: "fixed", top: m ? 58 : 78, right: m ? 8 : 16, maxWidth: m ? 280 : 340, background: "linear-gradient(135deg, #0c1d3a, #1e293b)", borderRadius: 10, padding: m ? "10px 12px" : "12px 14px", border: "1px solid #3b82f6", boxShadow: "0 4px 16px rgba(59, 130, 246, 0.3)", zIndex: 50, animation: "fadeInUp 0.4s ease-out" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
            <div style={{ fontSize: m ? 9 : 10, color: "#60a5fa", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Real Yellowstone Data</div>
            <button className="ub" onClick={() => setDataCard(null)} style={{ background: "none", border: "none", color: "#64748b", fontSize: 14, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: m ? 11 : 13, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{dataCard.title}</div>
          <div style={{ fontSize: m ? 10 : 11, color: "#fbbf24", marginBottom: 6 }}>Your game: <strong>{dataCard.yourStat(stats)}</strong></div>
          <div style={{ fontSize: m ? 10 : 11, color: "#cbd5e1", lineHeight: 1.5, background: "#0f172a", padding: "6px 8px", borderRadius: 6 }}>{dataCard.realStat}</div>
        </div>
      )}
    </div>
  );
}
