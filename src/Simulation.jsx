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

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

function createEntity(type, x, y, W, H) {
  const RX = W * TERRAIN.riverPct;
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
  const RX = eco.W * TERRAIN.riverPct;
  if (Math.abs(b.x - RX) > 60) moveToward(b, RX + rand(-25, 25), b.y + rand(-30, 30), b.speed);
  else wander(b, eco.W, eco.H);
  const tree = findNearest(b, eco.entities, TREE, 90);
  if (tree && tree.growth > 0.5) eco.riverHealth = clamp(eco.riverHealth + 0.006, 0, 100);
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
  const RX = eco.W * TERRAIN.riverPct;
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
  if (eco.tick % 300 === 0) eco.season++;
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
  const targetRiver = eco.vegetationHealth * 0.6 + beaverCount * 3;
  eco.riverHealth = clamp(eco.riverHealth + (targetRiver - eco.riverHealth) * 0.005, 0, 100);
  eco.riverWidth = TERRAIN.riverBaseW + (100 - eco.riverHealth) * 0.35;

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

  if (eco.tick % 60 === 0) {
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

    const ws = clamp(stats.wolves / 15, 0, 1) * 15 - (stats.wolves > 32 ? (stats.wolves - 32) * 0.3 : 0);
    const es = (1 - Math.abs(stats.elk - 38) / 38) * 15;
    const ts = clamp(stats.trees / 85, 0, 1) * 20;
    const rs = (eco.riverHealth / 100) * 15;
    const bs = clamp(stats.beavers / 8, 0, 1) * 10;
    const bis = clamp(stats.birds / 12, 0, 1) * 8;
    const fs = clamp(stats.fish / 18, 0, 1) * 7;
    const cs = (1 - Math.abs(stats.coyotes - 8) / 20) * 5;
    const rbs = (1 - Math.abs(stats.rabbits - 22) / 30) * 5;
    const brs = clamp(stats.bears / 6, 0, 1) * 5; // bears contribute to balance
    eco.balanceScore = clamp(Math.round(ws + es + ts + rs + bs + bis + fs + cs + rbs + brs), 0, 100);

    if (eco.history.length > 200) eco.history.shift();
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

function renderEcosystem(ctx, eco) {
  const { W, H, vegetationHealth: vh, riverHealth: rh, riverWidth: rw, tick } = eco;
  const vf = vh / 100;
  const RX = W * TERRAIN.riverPct;
  const MX = W * TERRAIN.mountainStartPct;
  const scaledRW = rw * (W / 960);  // scale river width to canvas

  // ─── FULL TERRAIN BASE (entire canvas is ground — top-down view) ──────
  // Meadow covers left side, forest covers right of river, mountains far right
  const meadowBase = lerpColor("#3d6b2e", "#5a9a40", vf);
  const meadowDark = lerpColor("#2a4a1e", "#3d7a2e", vf);
  const meadowLight = lerpColor("#4a7a36", "#6ab54a", vf);

  // Fill entire canvas with base meadow gradient
  const baseGrad = ctx.createLinearGradient(0, 0, 0, H);
  baseGrad.addColorStop(0, lerpColor("#2e5420", "#4a8a35", vf));
  baseGrad.addColorStop(0.3, meadowBase);
  baseGrad.addColorStop(0.7, lerpColor("#355e28", "#4e9038", vf));
  baseGrad.addColorStop(1, lerpColor("#2a4a1e", "#3d7030", vf));
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, RX - scaledRW / 2, H);

  // Forest side — slightly darker, bluer green
  const forestBase = lerpColor("#1e3a1a", "#2d5a28", vf);
  const forestGrad = ctx.createLinearGradient(RX + scaledRW / 2, 0, MX, 0);
  forestGrad.addColorStop(0, lerpColor("#1e4a22", "#2d6a30", vf));
  forestGrad.addColorStop(1, lerpColor("#1a3518", "#265a24", vf));
  ctx.fillStyle = forestGrad;
  ctx.fillRect(RX + scaledRW / 2, 0, MX - RX - scaledRW / 2, H);

  // ─── Perlin noise terrain texture (FULL canvas, visible) ──────────────
  // Meadow noise — creates patches of lighter/darker grass, dirt
  const noiseStep = 6;
  for (let x = 0; x < RX - scaledRW / 2; x += noiseStep) {
    for (let y = 0; y < H; y += noiseStep) {
      const nv = noise2d(x, y, 60);
      const nv2 = noise2d(x + 500, y + 300, 30); // second octave for detail
      const combined = nv * 0.7 + nv2 * 0.3;

      // Dirt patches where noise is low
      if (combined < 0.3) {
        ctx.fillStyle = lerpColor("#5c4a2a", "#6b5a34", vf);
        ctx.globalAlpha = (0.3 - combined) * 0.6;
        ctx.fillRect(x, y, noiseStep, noiseStep);
      }
      // Lush patches where noise is high
      else if (combined > 0.7) {
        ctx.fillStyle = meadowLight;
        ctx.globalAlpha = (combined - 0.7) * 0.5;
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

  // Forest floor noise — darker, with needle/leaf litter feel
  for (let x = Math.floor(RX + scaledRW / 2); x < MX; x += noiseStep) {
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

  // ─── Mountain range (far right background strip) ──────────────────────
  // Mountain base — dark rocky ground
  const mtGrad = ctx.createLinearGradient(MX, 0, W, 0);
  mtGrad.addColorStop(0, "#2a3a2e");
  mtGrad.addColorStop(0.3, "#3a4a48");
  mtGrad.addColorStop(0.7, "#4a5a58");
  mtGrad.addColorStop(1, "#3a4a48");
  ctx.fillStyle = mtGrad;
  ctx.fillRect(MX, 0, W - MX, H);

  // Mountain ridge silhouettes (multiple overlapping ranges for depth)
  // Far range
  ctx.fillStyle = "#5a6a68";
  ctx.beginPath();
  ctx.moveTo(MX, 0);
  for (let y = 0; y <= H; y += 3) {
    const pct = y / H;
    const ridge = MX + (W - MX) * 0.3 + Math.sin(pct * 7 + 1.2) * (W - MX) * 0.15 + Math.sin(pct * 15) * (W - MX) * 0.05;
    ctx.lineTo(ridge, y);
  }
  ctx.lineTo(MX, H);
  ctx.closePath();
  ctx.fill();

  // Snow caps on ridges
  ctx.fillStyle = "rgba(220, 230, 240, 0.3)";
  ctx.beginPath();
  ctx.moveTo(MX, 0);
  for (let y = 0; y <= H; y += 3) {
    const pct = y / H;
    const ridge = MX + (W - MX) * 0.3 + Math.sin(pct * 7 + 1.2) * (W - MX) * 0.15 + Math.sin(pct * 15) * (W - MX) * 0.05;
    ctx.lineTo(ridge, y);
  }
  for (let y = H; y >= 0; y -= 3) {
    const pct = y / H;
    const ridge = MX + (W - MX) * 0.3 + Math.sin(pct * 7 + 1.2) * (W - MX) * 0.15 + Math.sin(pct * 15) * (W - MX) * 0.05;
    ctx.lineTo(ridge + (W - MX) * 0.08, y);
  }
  ctx.closePath();
  ctx.fill();

  // Near range (darker)
  ctx.fillStyle = "#3a4a42";
  ctx.beginPath();
  ctx.moveTo(MX, 0);
  for (let y = 0; y <= H; y += 3) {
    const pct = y / H;
    const ridge = MX + (W - MX) * 0.15 + Math.sin(pct * 5 + 0.5) * (W - MX) * 0.1 + Math.sin(pct * 12 + 2) * (W - MX) * 0.04;
    ctx.lineTo(ridge, y);
  }
  ctx.lineTo(MX, H);
  ctx.closePath();
  ctx.fill();

  // Mountain-to-forest transition (soft gradient)
  const mtTransGrad = ctx.createLinearGradient(MX - 30, 0, MX + 20, 0);
  mtTransGrad.addColorStop(0, "transparent");
  mtTransGrad.addColorStop(1, "rgba(42, 58, 46, 0.6)");
  ctx.fillStyle = mtTransGrad;
  ctx.fillRect(MX - 30, 0, 50, H);

  // ─── Wildflowers scattered across meadow ──────────────────────────────
  if (vf > 0.2) {
    const flowerColors = ["#e87474", "#eab038", "#78d878", "#d8a0e0", "#f0d060"];
    for (let i = 0; i < Math.floor(100 * vf); i++) {
      const fx = (i * 191.23 + 13) % (RX - scaledRW / 2 - 20) + 10;
      const fy = (i * 137.891 + 7) % (H - 20) + 10;
      const nv = noise2d(fx, fy, 80);
      if (nv < 0.4) continue;  // only in certain patches
      ctx.fillStyle = flowerColors[i % flowerColors.length];
      ctx.globalAlpha = vf * 0.6;
      ctx.beginPath();
      ctx.arc(fx, fy, 1.2 + nv, 0, Math.PI * 2);
      ctx.fill();
      // Some flowers in small clusters
      if (nv > 0.65) {
        ctx.beginPath();
        ctx.arc(fx + 3, fy - 2, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(fx - 2, fy + 2, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ─── Rocky areas (scattered on both sides) ────────────────────────────
  ctx.fillStyle = "rgba(100, 110, 105, 0.2)";
  for (let i = 0; i < 45; i++) {
    const rx = (i * 277.13 + 31) % (W * 0.78) + 10;
    const ry = (i * 193.47 + 50) % (H - 20) + 10;
    if (Math.abs(rx - RX) < scaledRW / 2 + 10) continue;
    const sz = 1.5 + Math.sin(i * 7.3) * 1.5;
    ctx.beginPath();
    ctx.ellipse(rx, ry, sz * 1.3, sz, i * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── River with scenic water effects ──────────────────────────────────
  // Muddy banks (gradient transition from ground to water)
  const bankW = scaledRW * 0.4;
  const leftBankGrad = ctx.createLinearGradient(RX - scaledRW / 2 - bankW, 0, RX - scaledRW / 2, 0);
  leftBankGrad.addColorStop(0, "transparent");
  leftBankGrad.addColorStop(0.5, "rgba(80, 65, 40, 0.25)");
  leftBankGrad.addColorStop(1, "rgba(60, 50, 30, 0.4)");
  ctx.fillStyle = leftBankGrad;
  ctx.fillRect(RX - scaledRW / 2 - bankW, 0, bankW, H);

  const rightBankGrad = ctx.createLinearGradient(RX + scaledRW / 2, 0, RX + scaledRW / 2 + bankW, 0);
  rightBankGrad.addColorStop(0, "rgba(60, 50, 30, 0.4)");
  rightBankGrad.addColorStop(0.5, "rgba(80, 65, 40, 0.25)");
  rightBankGrad.addColorStop(1, "transparent");
  ctx.fillStyle = rightBankGrad;
  ctx.fillRect(RX + scaledRW / 2, 0, bankW, H);

  // River water — gradient across width
  const waterDeep = rh > 60 ? "#1a5fb8" : rh > 30 ? "#2a6ab8" : "#6a5030";
  const waterLight = rh > 60 ? "#3a8ae8" : rh > 30 ? "#4a90d0" : "#8a7050";
  const riverGrad = ctx.createLinearGradient(RX - scaledRW / 2, 0, RX + scaledRW / 2, 0);
  riverGrad.addColorStop(0, lerpColor(waterDeep, "#2a3a2a", 0.3));
  riverGrad.addColorStop(0.2, waterDeep);
  riverGrad.addColorStop(0.5, waterLight);
  riverGrad.addColorStop(0.8, waterDeep);
  riverGrad.addColorStop(1, lerpColor(waterDeep, "#2a3a2a", 0.3));
  ctx.fillStyle = riverGrad;
  ctx.fillRect(RX - scaledRW / 2, 0, scaledRW, H);

  // River current — flowing lines
  for (let layer = 0; layer < 4; layer++) {
    ctx.strokeStyle = `rgba(140, 200, 255, ${0.06 + rh * 0.002 + layer * 0.01})`;
    ctx.lineWidth = 0.6 + layer * 0.2;
    for (let y = -20; y < H + 20; y += 10 + layer * 4) {
      ctx.beginPath();
      const phase = tick * (0.025 + layer * 0.008) + y * 0.05 + layer * 1.2;
      const amp = scaledRW * 0.12 * (1 - layer * 0.15);
      for (let dy = 0; dy < 8; dy += 1.5) {
        const cx = RX + Math.sin(phase + dy * 0.4) * amp;
        ctx.lineTo(cx, y + dy);
      }
      ctx.stroke();
    }
  }

  // Shimmer highlights on water
  ctx.fillStyle = `rgba(255, 255, 255, ${0.04 + rh * 0.002})`;
  for (let i = 0; i < 15; i++) {
    const sx = RX + Math.sin(tick * 0.02 + i * 3.7) * scaledRW * 0.3;
    const sy = (tick * 0.5 + i * H / 15) % H;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 2, 0.8, tick * 0.01 + i, 0, Math.PI * 2);
    ctx.fill();
  }

  // River stones along banks
  ctx.fillStyle = "rgba(80, 90, 85, 0.35)";
  for (let i = 0; i < 30; i++) {
    const sy = (i * 127.1 + 20) % H;
    const leftS = RX - scaledRW / 2 - 4 + Math.sin(i * 5.3) * 3;
    const rightS = RX + scaledRW / 2 + 4 + Math.sin(i * 3.7) * 3;
    const sz = 2 + Math.sin(i * 2.1) * 1.5;
    ctx.beginPath(); ctx.ellipse(leftS, sy, sz, sz * 0.7, i * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(rightS, sy, sz, sz * 0.7, i * 0.3, 0, Math.PI * 2); ctx.fill();
  }

  // Foam at edges
  ctx.fillStyle = `rgba(255, 255, 255, ${0.15 + rh * 0.002})`;
  for (let y = 0; y < H; y += 8) {
    const foamX1 = RX - scaledRW / 2 + Math.sin(tick * 0.04 + y * 0.03) * 2;
    const foamX2 = RX + scaledRW / 2 + Math.sin(tick * 0.04 + y * 0.03 + 1) * 2;
    ctx.fillRect(foamX1 - 1, y, 2, 1.5);
    ctx.fillRect(foamX2 - 1, y, 2, 1.5);
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
      if (Math.abs(gx - RX) < scaledRW / 2 + 12) continue;
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

  // ─── Ambient light overlay (warm upper-left, cool lower-right) ────────
  const ambGrad = ctx.createLinearGradient(0, 0, W, H);
  ambGrad.addColorStop(0, `rgba(255, 220, 150, ${0.04 * vf})`);
  ambGrad.addColorStop(0.5, "transparent");
  ambGrad.addColorStop(1, `rgba(100, 120, 180, ${0.04 * vf})`);
  ctx.fillStyle = ambGrad;
  ctx.fillRect(0, 0, W, H);

  // ─── Entities sorted by depth ────────────────────────────────────────
  const sorted = eco.entities.filter(e => e.alive).sort((a, b) => {
    if (a.type === TREE && b.type !== TREE) return -1;
    if (b.type === TREE && a.type !== TREE) return 1;
    return a.y - b.y;
  });

  for (const e of sorted) {
    ctx.save();
    switch (e.type) {
      case TREE: drawTree(ctx, e, vf, tick); break;
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

  // ─── Birth / Growth / Kill particle effects ───────────────────────────
  for (const p of eco.particles) {
    const t = p.age / p.maxAge; // 0 → 1 over lifetime
    const fade = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8; // fade in then out

    if (p.type === "birth") {
      // Expanding ring + rising text
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = fade * 0.7;
      const radius = 4 + p.age * 0.25;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      // Inner sparkles
      for (let s = 0; s < 4; s++) {
        const angle = (s / 4) * Math.PI * 2 + p.age * 0.05;
        const sr = radius * 0.6;
        const sx = p.x + Math.cos(angle) * sr;
        const sy = p.y + Math.sin(angle) * sr;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = fade * 0.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Rising label
      if (p.age < 50) {
        ctx.globalAlpha = fade * 0.9;
        ctx.fillStyle = p.color;
        ctx.font = "bold 10px sans-serif";
        ctx.fillText("+" + p.icon, p.x + 8, p.y - 6 - p.age * 0.2);
      }
    } else if (p.type === "growth") {
      // Green sprouting effect — expanding rings with leaf symbol
      ctx.globalAlpha = fade * 0.6;
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 1.2;
      const gr = 3 + p.age * 0.15;
      ctx.beginPath();
      ctx.arc(p.x, p.y, gr, 0, Math.PI * 2);
      ctx.stroke();
      // Small green dots rising like growth
      for (let s = 0; s < 3; s++) {
        const gy = p.y - p.age * 0.12 - s * 5;
        const gx = p.x + Math.sin(p.age * 0.1 + s * 2) * 4;
        ctx.fillStyle = "#4ade80";
        ctx.globalAlpha = fade * 0.4;
        ctx.beginPath();
        ctx.arc(gx, gy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (p.age < 60) {
        ctx.globalAlpha = fade * 0.8;
        ctx.fillStyle = "#22c55e";
        ctx.font = "9px sans-serif";
        ctx.fillText("🌱", p.x - 5, p.y - 8 - p.age * 0.15);
      }
    } else if (p.type === "kill") {
      // Red burst effect
      ctx.globalAlpha = fade * 0.8;
      ctx.fillStyle = "#ef4444";
      const kr = 2 + p.age * 0.3;
      for (let s = 0; s < 6; s++) {
        const angle = (s / 6) * Math.PI * 2 + p.age * 0.03;
        const sx = p.x + Math.cos(angle) * kr;
        const sy = p.y + Math.sin(angle) * kr;
        ctx.beginPath();
        ctx.arc(sx, sy, 2 * (1 - t), 0, Math.PI * 2);
        ctx.fill();
      }
      if (p.age < 40) {
        ctx.globalAlpha = fade * 0.9;
        ctx.fillStyle = "#fca5a5";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText("💀", p.x + 6, p.y - 4 - p.age * 0.15);
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

  // ─── Vignette (darken edges/corners) ──────────────────────────────────
  const vigGrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
  vigGrad.addColorStop(0, "transparent");
  vigGrad.addColorStop(1, "rgba(10, 15, 20, 0.3)");
  ctx.fillStyle = vigGrad;
  ctx.fillRect(0, 0, W, H);

  // ─── Atmospheric haze when ecosystem is degraded ──────────────────────
  if (vh < 40) {
    ctx.globalAlpha = (1 - vh / 40) * 0.15;
    ctx.fillStyle = "#8b6a3b";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

// ─── IMPROVED DRAWING FUNCTIONS ───────────────────────────────────────────

function drawTree(ctx, tree, vf, tick) {
  const s = tree.growth;
  const h = 12 + s * 24;
  const w = 6 + s * 16;
  const healthy = tree.health > 50;
  const sway = Math.sin(tick * 0.008 + tree.x * 0.03) * s * 2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(tree.x + 5, tree.y + 4, w * 0.5 * s, 3, 0, 0, Math.PI * 2);
  ctx.fill();

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
  const isConifer = tree.x > (ctx.canvas?.width ?? 500) * 0.6;

  if (isConifer) {
    // Pointed conifer canopy
    const baseGreen = healthy ? lerpColor("#166534", "#22c55e", s * vf) : lerpColor("#854d0e", "#a16207", s);

    // Bottom canopy layer
    ctx.fillStyle = lerpColor(baseGreen, "#0f3f1f", 0.3);
    ctx.beginPath();
    ctx.moveTo(tree.x + sway, tree.y - h * 0.38);
    ctx.lineTo(tree.x + sway - w * 0.45, tree.y + 2);
    ctx.lineTo(tree.x + sway + w * 0.45, tree.y + 2);
    ctx.closePath();
    ctx.fill();

    // Middle canopy
    ctx.fillStyle = baseGreen;
    ctx.beginPath();
    ctx.moveTo(tree.x + sway, tree.y - h * 0.5);
    ctx.lineTo(tree.x + sway - w * 0.35, tree.y - 3);
    ctx.lineTo(tree.x + sway + w * 0.35, tree.y - 3);
    ctx.closePath();
    ctx.fill();

    // Top canopy point
    ctx.fillStyle = lerpColor(baseGreen, "#4ade80", 0.3);
    ctx.beginPath();
    ctx.moveTo(tree.x + sway, tree.y - h * 0.62);
    ctx.lineTo(tree.x + sway - w * 0.22, tree.y - h * 0.4);
    ctx.lineTo(tree.x + sway + w * 0.22, tree.y - h * 0.4);
    ctx.closePath();
    ctx.fill();
  } else {
    // Round willow/aspen canopy
    const baseGreen = healthy ? lerpColor("#166534", "#22c55e", s * vf) : lerpColor("#854d0e", "#a16207", s);
    const darkGreen = healthy ? lerpColor("#14532d", "#166534", s * vf) : lerpColor("#713f12", "#854d0e", s);

    // Bottom canopy layer
    ctx.fillStyle = darkGreen;
    ctx.beginPath();
    ctx.ellipse(tree.x + sway, tree.y - h * 0.35, w / 2 + 2, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Middle canopy
    ctx.fillStyle = baseGreen;
    ctx.beginPath();
    ctx.ellipse(tree.x + sway, tree.y - h * 0.48, w / 2 - 0.5, h * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Top canopy
    ctx.fillStyle = lerpColor(baseGreen, "#4ade80", 0.2);
    ctx.beginPath();
    ctx.ellipse(tree.x + sway - 1, tree.y - h * 0.58, w / 2 - 2, h * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
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

  const isRunning = wolf.state === "chase" || wolf.state === "flee";
  const legPhase = isRunning ? Math.sin(wolf.age * 0.3) * 6 : Math.sin(wolf.age * 0.08) * 2.5;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 8, 11, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail - bushy
  ctx.strokeStyle = "#8b7355";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-9, -3);
  ctx.quadraticCurveTo(-16, -12, -14, -18 + Math.sin(wolf.age * 0.1) * 2);
  ctx.stroke();

  // Fur outline
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, -2, 11, 7, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Front legs (detailed)
  ctx.strokeStyle = "#3d4a5c";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-5, 4); ctx.lineTo(-5 + legPhase, 11);
  ctx.moveTo(2, 4); ctx.lineTo(2 - legPhase * 0.8, 11);
  ctx.stroke();

  // Hind legs
  ctx.beginPath();
  ctx.moveTo(-8, 3); ctx.lineTo(-8 + legPhase * 0.5, 10);
  ctx.moveTo(5, 3); ctx.lineTo(5 - legPhase * 0.5, 10);
  ctx.stroke();

  // Paw prints trail when running
  if (isRunning && wolf.age % 5 < 2) {
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.beginPath();
    ctx.arc(-8 - legPhase * 2, 11, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body with gradient (darker back, lighter belly)
  const bodyGrad = ctx.createLinearGradient(0, -6, 0, 2);
  bodyGrad.addColorStop(0, "#5c6b7a");
  bodyGrad.addColorStop(1, "#a8adb8");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, -2, 11, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Lighter belly
  ctx.fillStyle = "rgba(220, 220, 220, 0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 1, 7, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head with detail
  ctx.fillStyle = "#7a8592";
  ctx.beginPath();
  ctx.ellipse(10, -6, 5.5, 4.5, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // Muzzle
  ctx.fillStyle = "#c0c5d0";
  ctx.beginPath();
  ctx.ellipse(14, -5, 3, 2.2, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = "#2d2d2d";
  ctx.beginPath();
  ctx.arc(15.5, -5, 0.8, 0, Math.PI * 2);
  ctx.fill();

  // Teeth when chasing
  if (wolf.state === "chase") {
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(13.5, -4.5, 1.5, 0.8);
    ctx.fillRect(15, -4.5, 1.5, 0.8);
  }

  // Ears with inner color
  ctx.fillStyle = "#5c6b7a";
  ctx.beginPath();
  ctx.moveTo(8, -11); ctx.lineTo(6, -17); ctx.lineTo(4.5, -10); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(11, -11); ctx.lineTo(13.5, -17); ctx.lineTo(11.5, -10); ctx.fill();

  // Inner ears
  ctx.fillStyle = "#d0d0d0";
  ctx.beginPath();
  ctx.moveTo(8, -11); ctx.lineTo(6.5, -14); ctx.lineTo(5.5, -10); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(11, -11); ctx.lineTo(12.5, -14); ctx.lineTo(11.5, -10); ctx.fill();

  // Eye - glowing amber
  ctx.fillStyle = "#fcd34d";
  ctx.beginPath();
  ctx.arc(12, -7, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(12.3, -7, 0.8, 0, Math.PI * 2);
  ctx.fill();

  // Glow around eye
  ctx.strokeStyle = "rgba(252, 211, 77, 0.4)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(12, -7, 2.2, 0, Math.PI * 2);
  ctx.stroke();

  // State indicator
  if (wolf.state === "chase") {
    ctx.fillStyle = "rgba(239, 68, 68, 0.7)";
    ctx.beginPath();
    ctx.arc(0, -16, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawElk(ctx, elk, tick) {
  const facing = elk.vx >= 0 ? 1 : -1;
  ctx.translate(elk.x, elk.y);
  ctx.scale(facing, 1);

  const isRunning = elk.state === "flee";
  const lp = isRunning ? Math.sin(elk.age * 0.3) * 7 : Math.sin(elk.age * 0.06) * 2.5;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(0, 11, 13, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs with hooves
  ctx.strokeStyle = "#6b4423";
  ctx.lineWidth = 2.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-7, 3); ctx.lineTo(-7 + lp, 12);
  ctx.moveTo(-2, 3); ctx.lineTo(-2 - lp * 0.6, 12);
  ctx.moveTo(4, 3); ctx.lineTo(4 + lp * 0.6, 12);
  ctx.moveTo(9, 3); ctx.lineTo(9 - lp * 0.4, 12);
  ctx.stroke();

  // Hooves
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  [-7 + lp, -2 - lp * 0.6, 4 + lp * 0.6, 9 - lp * 0.4].forEach((hx) => {
    ctx.moveTo(hx, 12);
    ctx.arc(hx, 12.5, 1.8, 0, Math.PI * 2);
  });
  ctx.fill();

  // Dust particles when fleeing
  if (isRunning && elk.age % 4 < 2) {
    ctx.fillStyle = "rgba(139, 117, 94, 0.3)";
    ctx.beginPath();
    ctx.arc(-10 - lp, 8, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body
  const bodyGrad = ctx.createRadialGradient(0, -2, 2, 0, -2, 15);
  bodyGrad.addColorStop(0, "#c67c3b");
  bodyGrad.addColorStop(1, "#8b5a23");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, -2, 14, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Lighter belly patch
  ctx.fillStyle = "rgba(200, 150, 100, 0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 2, 10, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Thick neck
  ctx.fillStyle = "#a86f38";
  ctx.beginPath();
  ctx.moveTo(9, -6);
  ctx.quadraticCurveTo(14, -14, 12, -16);
  ctx.quadraticCurveTo(9, -13, 8, -6);
  ctx.fill();

  // Head
  ctx.fillStyle = "#8b5a23";
  ctx.beginPath();
  ctx.ellipse(12, -16, 5, 4.5, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // Multi-point antlers
  ctx.strokeStyle = "#e0ddd9";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(12, -20);
  ctx.lineTo(9, -27); ctx.moveTo(9, -24); ctx.lineTo(6, -26);
  ctx.moveTo(12, -20);
  ctx.lineTo(16, -27); ctx.moveTo(16, -24); ctx.lineTo(19, -26);
  ctx.moveTo(9, -26); ctx.lineTo(7, -30);
  ctx.moveTo(16, -26); ctx.lineTo(18, -30);
  ctx.stroke();

  // Eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(14, -15, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.arc(14.4, -15.4, 0.5, 0, Math.PI * 2);
  ctx.fill();

  // Grazing indicator
  if (elk.state === "graze") {
    ctx.fillStyle = "rgba(34, 197, 94, 0.6)";
    ctx.beginPath();
    ctx.arc(12, 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBeaver(ctx, e, tick) {
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(e.x + 3, e.y + 5, 7, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Flat tail with texture
  ctx.fillStyle = "#5c3f2c";
  ctx.beginPath();
  ctx.ellipse(e.x - 8, e.y + 1.5, 6, 2.5, 0.25, 0, Math.PI * 2);
  ctx.fill();

  // Tail detail lines
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(e.x - 8 - 2.5, e.y - 0.5 + i * 0.6);
    ctx.lineTo(e.x - 8 + 2.5, e.y - 0.5 + i * 0.6);
    ctx.stroke();
  }

  // Body
  const bg = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 7);
  bg.addColorStop(0, "#b8704d");
  bg.addColorStop(1, "#8b5a2b");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, 7, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Fur texture
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, 7, 4.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Ear
  ctx.fillStyle = "#8b5a2b";
  ctx.beginPath();
  ctx.arc(e.x - 2, e.y - 3, 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(e.x + 4, e.y - 1, 1.1, 0, Math.PI * 2);
  ctx.fill();

  // Front feet
  ctx.fillStyle = "#5c3f2c";
  ctx.beginPath();
  ctx.ellipse(e.x + 3, e.y + 3.5, 1.5, 1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(e.x - 1, e.y + 3.5, 1.5, 1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Buck teeth - more prominent
  ctx.fillStyle = "#fef3c7";
  ctx.fillRect(e.x + 5.5, e.y + 0.2, 1.2, 2.5);
  ctx.fillRect(e.x + 7, e.y + 0.2, 1.2, 2.5);

  // Teeth detail
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(e.x + 5.5, e.y + 1); ctx.lineTo(e.x + 6.7, e.y + 1);
  ctx.moveTo(e.x + 7, e.y + 1); ctx.lineTo(e.x + 8.2, e.y + 1);
  ctx.stroke();
}

function drawCoyote(ctx, e, tick) {
  const facing = e.vx >= 0 ? 1 : -1;
  ctx.translate(e.x, e.y);
  ctx.scale(facing, 1);

  const lp = Math.sin(e.age * 0.15) * 3.5;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 6, 7, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Slender legs (distinct from wolf)
  ctx.strokeStyle = "#d47c3b";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-3, 2.5); ctx.lineTo(-3 + lp, 8);
  ctx.moveTo(3, 2.5); ctx.lineTo(3 - lp, 8);
  ctx.stroke();

  // Bushy tail
  ctx.strokeStyle = "#e89556";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-6, -1);
  ctx.quadraticCurveTo(-12, -8, -10, -11 + Math.sin(e.age * 0.1) * 1.5);
  ctx.stroke();

  // Body - more orange/tan
  const bodyGrad = ctx.createRadialGradient(0, -1, 0, 0, -1, 9);
  bodyGrad.addColorStop(0, "#e89556");
  bodyGrad.addColorStop(1, "#d97706");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, -1, 8, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = "#ca8a04";
  ctx.beginPath();
  ctx.ellipse(7, -4, 4, 3.2, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Pointy muzzle
  ctx.fillStyle = "#f0a952";
  ctx.beginPath();
  ctx.moveTo(9.5, -3.5);
  ctx.lineTo(13, -2.8);
  ctx.lineTo(9.5, -1.5);
  ctx.fill();

  // Nose
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(13.2, -3, 0.5, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.fillStyle = "#b45309";
  ctx.beginPath();
  ctx.moveTo(5, -7.5); ctx.lineTo(3.5, -12); ctx.lineTo(2, -6.5); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8.5, -7.5); ctx.lineTo(10, -12); ctx.lineTo(8, -6.5); ctx.fill();

  // Eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(8, -4.5, 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fef3c7";
  ctx.beginPath();
  ctx.arc(8.2, -4.7, 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawFish(ctx, e, tick) {
  const phase = Math.sin(tick * 0.05 + e.id.charCodeAt(0)) * 2;
  ctx.globalAlpha = 0.8;

  // Body with gradient
  const fg = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 6);
  fg.addColorStop(0, "#a5f3fc");
  fg.addColorStop(1, "#0891b2");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, 6, 3, phase * 0.08, 0, Math.PI * 2);
  ctx.fill();

  // Scales effect (tiny lines)
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 0.4;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(e.x - 2 + i * 1.5, e.y - 1);
    ctx.lineTo(e.x - 2 + i * 1.5, e.y + 1);
    ctx.stroke();
  }

  // Tail fin with detail
  ctx.fillStyle = "#67e8f9";
  ctx.beginPath();
  ctx.moveTo(e.x - 6, e.y);
  ctx.lineTo(e.x - 9.5, e.y - 3.5);
  ctx.lineTo(e.x - 9.5, e.y + 3.5);
  ctx.closePath();
  ctx.fill();

  // Tail fin lines
  ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(e.x - 6, e.y);
  ctx.lineTo(e.x - 9.5, e.y - 3.5);
  ctx.moveTo(e.x - 6, e.y);
  ctx.lineTo(e.x - 9.5, e.y + 3.5);
  ctx.stroke();

  // Dorsal fin
  ctx.fillStyle = "rgba(167, 243, 252, 0.6)";
  ctx.beginPath();
  ctx.moveTo(e.x - 1, e.y - 3);
  ctx.lineTo(e.x + 1, e.y - 3.5);
  ctx.lineTo(e.x + 1.5, e.y - 2.5);
  ctx.closePath();
  ctx.fill();

  // Eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(e.x + 3, e.y - 0.8, 0.8, 0, Math.PI * 2);
  ctx.fill();

  // Bubble trail
  if (tick % 5 === 0) {
    ctx.fillStyle = "rgba(167, 243, 252, 0.3)";
    ctx.beginPath();
    ctx.arc(e.x - 8, e.y + Math.sin(tick * 0.1) * 2, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function drawBird(ctx, e) {
  const wing = Math.sin(e.flutterPhase) * 6;
  const bob = Math.sin(e.flutterPhase * 0.7) * 2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + 9, 4, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = "#fcd34d";
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + bob, 4, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc(e.x + 3, e.y - 1.5 + bob, 2.3, 0, Math.PI * 2);
  ctx.fill();

  // Beak
  ctx.fillStyle = "#b45309";
  ctx.beginPath();
  ctx.moveTo(e.x + 5, e.y - 1.5 + bob);
  ctx.lineTo(e.x + 7.5, e.y - 0.8 + bob);
  ctx.lineTo(e.x + 5, e.y - 0.3 + bob);
  ctx.fill();

  // Wings with curved motion
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(e.x - 2, e.y + bob);
  ctx.quadraticCurveTo(e.x - 6, e.y - wing + bob, e.x - 8, e.y - wing * 0.6 + bob);
  ctx.moveTo(e.x + 1, e.y + bob);
  ctx.quadraticCurveTo(e.x + 5, e.y - wing + bob, e.x + 6.5, e.y - wing * 0.6 + bob);
  ctx.stroke();

  // Tail feathers
  ctx.strokeStyle = "#f97316";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(e.x - 3, e.y + 1 + bob);
  ctx.lineTo(e.x - 4.5, e.y + 3 + bob);
  ctx.stroke();

  // Eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(e.x + 3.5, e.y - 2.2 + bob, 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fef3c7";
  ctx.beginPath();
  ctx.arc(e.x + 3.8, e.y - 2.4 + bob, 0.25, 0, Math.PI * 2);
  ctx.fill();
}

function drawRabbit(ctx, e, tick) {
  const hop = e.state === "flee" ? Math.abs(Math.sin(e.age * 0.3)) * 4 : 0;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + 5, 5, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = "#e5e7eb";
  ctx.beginPath();
  ctx.ellipse(e.x, e.y - hop, 5.5, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = "#f3f4f6";
  ctx.beginPath();
  ctx.arc(e.x + 3.5, e.y - 2.5 - hop, 3, 0, Math.PI * 2);
  ctx.fill();

  // Ears - prominent
  ctx.fillStyle = "#d1d5db";
  ctx.beginPath();
  ctx.ellipse(e.x + 1.5, e.y - 8 - hop, 1.5, 4.5, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(e.x + 4.5, e.y - 8 - hop, 1.5, 4.5, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // Inner ears - pink
  ctx.fillStyle = "#fecaca";
  ctx.beginPath();
  ctx.ellipse(e.x + 1.5, e.y - 8 - hop, 0.75, 2.5, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(e.x + 4.5, e.y - 8 - hop, 0.75, 2.5, 0.15, 0, Math.PI * 2);
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
  ctx.translate(e.x, e.y);
  const bob = Math.sin(e.age * 0.04) * 1.5;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 10, 10, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  const lp = Math.sin(e.age * 0.08) * 3;
  ctx.fillStyle = "#5c3a1e";
  ctx.beginPath(); ctx.ellipse(-6 + lp, 9, 3, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(6 - lp, 9, 3, 4, 0, 0, Math.PI * 2); ctx.fill();

  // Body — large, brown
  const bodyGrad = ctx.createRadialGradient(0, bob, 2, 0, bob, 12);
  bodyGrad.addColorStop(0, "#8B6914");
  bodyGrad.addColorStop(0.5, "#6B4226");
  bodyGrad.addColorStop(1, "#4a2d14");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, bob, 10, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = "#5c3a1e";
  ctx.beginPath();
  ctx.ellipse(0, bob - 9, 6, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.fillStyle = "#7a4a2a";
  ctx.beginPath(); ctx.arc(-4.5, bob - 13, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4.5, bob - 13, 2.5, 0, Math.PI * 2); ctx.fill();

  // Snout
  ctx.fillStyle = "#92400e";
  ctx.beginPath();
  ctx.ellipse(0, bob - 7, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.ellipse(0, bob - 7.5, 1.2, 0.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(-2.5, bob - 10, 0.8, 0, Math.PI * 2);
  ctx.arc(2.5, bob - 10, 0.8, 0, Math.PI * 2);
  ctx.fill();

  // Hump (grizzly characteristic)
  ctx.fillStyle = "#6B4226";
  ctx.beginPath();
  ctx.ellipse(-1, bob - 4, 5, 3, -0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawHunter(ctx, e, tick) {
  ctx.translate(e.x, e.y);
  const lp = Math.sin(e.age * 0.06) * 2.5;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 12, 7, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.strokeStyle = "#5c4a2d";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-2.5, 5); ctx.lineTo(-2.5 + lp, 11);
  ctx.moveTo(2.5, 5); ctx.lineTo(2.5 - lp, 11);
  ctx.stroke();

  // Boots
  ctx.fillStyle = "#3d2a0a";
  ctx.fillRect(-4.5, 10, 4.5, 2.5);
  ctx.fillRect(0, 10, 4.5, 2.5);

  // Body — red jacket
  const bodyGrad = ctx.createLinearGradient(0, -8, 0, 2);
  bodyGrad.addColorStop(0, "#ef4444");
  bodyGrad.addColorStop(1, "#dc2626");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-5, -6);
  ctx.lineTo(5, -6);
  ctx.lineTo(5, 5);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();

  // Jacket detail
  ctx.strokeStyle = "#b91c1c";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(0, 5);
  ctx.stroke();

  // Arms
  ctx.strokeStyle = "#9d2d2d";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-5, -2); ctx.lineTo(-8, 2);
  ctx.moveTo(5, -2); ctx.lineTo(13, -4);
  ctx.stroke();

  // Rifle barrel
  ctx.strokeStyle = "#404040";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(5, -2);
  ctx.lineTo(18, -6);
  ctx.stroke();

  // Rifle stock
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(5, -2);
  ctx.lineTo(11, -4);
  ctx.stroke();

  // Scope
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(14, -5.5, 1.5, 0, Math.PI * 2);
  ctx.stroke();

  // Head
  ctx.fillStyle = "#fed7aa";
  ctx.beginPath();
  ctx.arc(0, -12, 5, 0, Math.PI * 2);
  ctx.fill();

  // Hat
  ctx.fillStyle = "#991b1b";
  ctx.fillRect(-6, -18, 12, 5);
  ctx.fillRect(-5, -16, 10, 3);

  // Brim
  ctx.fillStyle = "#7f1d1d";
  ctx.fillRect(-8, -15, 16, 1.5);

  // Face
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(-1.5, -11, 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(1.5, -11, 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  ctx.strokeStyle = "#1c1917";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(0, -10, 0.8, 0, Math.PI);
  ctx.stroke();

  // Danger aura - pulsing
  ctx.strokeStyle = `rgba(239, 68, 68, ${0.4 + Math.sin(tick * 0.05) * 0.2})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, -4, 24, 0, Math.PI * 2);
  ctx.stroke();

  // Concentric danger circles
  ctx.strokeStyle = `rgba(239, 68, 68, ${0.2 + Math.sin(tick * 0.05 + 0.3) * 0.1})`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(0, -4, 18, 0, Math.PI * 2);
  ctx.stroke();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CASCADE ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

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
    await Tone.start();

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
    this.queue = [];
    this.lastSpoken = {};
    this.minInterval = 20000; // 20s between same insight
    this.globalCooldown = 8000; // 8s between any narration
    this.lastAnySpoken = 0;
    this.voice = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized || !window.speechSynthesis) return;
    // Pick a calm, clear voice
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) return;
      // Prefer English voices with "natural" or "Google" or "Samantha"
      this.voice = voices.find(v => /samantha|google.*us|natural|daniel/i.test(v.name) && /en/i.test(v.lang))
        || voices.find(v => /en[-_]us/i.test(v.lang))
        || voices.find(v => /en/i.test(v.lang))
        || voices[0];
      this.initialized = true;
    };
    pickVoice();
    if (!this.initialized) {
      window.speechSynthesis.onvoiceschanged = pickVoice;
    }
  }

  speak(insightId, text) {
    if (!this.enabled || !window.speechSynthesis) return;
    if (!this.initialized) this.init();

    const now = Date.now();
    // Global cooldown
    if (now - this.lastAnySpoken < this.globalCooldown) return;
    // Per-insight cooldown
    if (this.lastSpoken[insightId] && now - this.lastSpoken[insightId] < this.minInterval) return;

    // Cancel any current speech to keep things snappy
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 1.0;
    utterance.volume = 0.85;
    if (this.voice) utterance.voice = this.voice;

    utterance.onstart = () => { this.speaking = true; };
    utterance.onend = () => { this.speaking = false; };
    utterance.onerror = () => { this.speaking = false; };

    window.speechSynthesis.speak(utterance);
    this.lastSpoken[insightId] = now;
    this.lastAnySpoken = now;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      this.speaking = false;
    }
  }

  stop() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
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
  const nodes = [
    { id: 'wolf', label: '🐺', x: 125, y: 30, pop: stats.wolves, ideal: 15 },
    { id: 'elk', label: '🦌', x: 60, y: 80, pop: stats.elk, ideal: 45 },
    { id: 'veg', label: '🌿', x: 30, y: 150, pop: stats.vegetationHealth, ideal: 80 },
    { id: 'river', label: '🏞️', x: 125, y: 150, pop: stats.riverHealth, ideal: 85 },
    { id: 'beaver', label: '🦫', x: 190, y: 80, pop: stats.beavers, ideal: 8 },
    { id: 'fish', label: '🐟', x: 200, y: 150, pop: stats.fish, ideal: 20 },
    { id: 'bird', label: '🐦', x: 90, y: 30, pop: stats.birds, ideal: 15 },
    { id: 'coyote', label: '🐾', x: 190, y: 30, pop: stats.coyotes, ideal: 10 },
    { id: 'rabbit', label: '🐰', x: 150, y: 80, pop: stats.rabbits, ideal: 25 },
    { id: 'bear', label: '🐻', x: 55, y: 30, pop: stats.bears, ideal: 6 },
  ];

  const getHealth = (pop, ideal) => {
    const ratio = pop / ideal;
    if (ratio > 1.3 || ratio < 0.6) return 'critical';
    if (ratio > 1.1 || ratio < 0.8) return 'stressed';
    return 'healthy';
  };

  const getColor = (health) => {
    if (health === 'critical') return '#ef4444';
    if (health === 'stressed') return '#eab308';
    return '#22c55e';
  };

  const edges = [
    { from: 'wolf', to: 'elk' },
    { from: 'wolf', to: 'coyote' },
    { from: 'elk', to: 'veg' },
    { from: 'veg', to: 'river' },
    { from: 'veg', to: 'beaver' },
    { from: 'veg', to: 'bird' },
    { from: 'beaver', to: 'river' },
    { from: 'river', to: 'fish' },
    { from: 'coyote', to: 'rabbit' },
    { from: 'bear', to: 'fish' },
    { from: 'bear', to: 'veg' },
  ];

  return (
    <svg width="250" height="200" style={{ background: '#0f172a', borderRadius: 8, border: '1px solid #334155', padding: 8 }}>
      {edges.map((e, i) => {
        const fromN = nodes.find(n => n.id === e.from);
        const toN = nodes.find(n => n.id === e.to);
        return (
          <line key={i} x1={fromN.x} y1={fromN.y} x2={toN.x} y2={toN.y} stroke="#475569" strokeWidth="1" opacity="0.6" />
        );
      })}
      {nodes.map(n => {
        const health = getHealth(n.pop, n.ideal);
        const color = getColor(health);
        return (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r="12" fill={color} opacity="0.3" stroke={color} strokeWidth="2" />
            <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize="14">{n.label}</text>
          </g>
        );
      })}
    </svg>
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
// MAIN COMPONENT - FULL SCREEN LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════

export default function Simulation() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const ecoRef = useRef(null);
  const animRef = useRef(null);
  const insightCounterRef = useRef({});
  const [canvasSize, setCanvasSize] = useState({ w: 1280, h: 720 });
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
  const [healthyStreak, setHealthyStreak] = useState(0); // consecutive ticks in "healthy" zone
  const GAME_DURATION = 25200; // ~7 min at 60fps (420 seconds)
  const WIN_THRESHOLD = 70; // balance score needed
  const WIN_STREAK_NEEDED = 900; // must hold healthy for 15 seconds (900 frames)
  const gameTimerRef = useRef(0);
  const healthyStreakRef = useRef(0);

  // Responsive canvas sizing with ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      const rect = containerRef.current.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      setCanvasSize({ w, h });
      const canvas = canvasRef.current;
      if (canvas && ecoRef.current) {
        canvas.width = w;
        canvas.height = h;
        ecoRef.current.W = w;
        ecoRef.current.H = h;
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Detect mobile and orientation
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 900 || ('ontouchstart' in window && window.innerWidth < 1200);
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
      ecoRef.current = initEcosystem(canvasSize.w, canvasSize.h, "noWolves");
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
      if (healthyStreakRef.current % 60 === 0) setHealthyStreak(healthyStreakRef.current);

      // Win condition: held healthy for required streak
      if (healthyStreakRef.current >= WIN_STREAK_NEEDED) {
        setGameState("won");
        setRunning(false);
        setHealthyStreak(healthyStreakRef.current);
      }
      // Loss condition: time ran out
      else if (gameTimerRef.current >= GAME_DURATION) {
        setGameState("lost");
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
          // Speak the insight via narrator (random line from pool)
          if (narratorEnabled && insight.spokenLines && insight.spokenLines.length > 0) {
            const line = insight.spokenLines[Math.floor(Math.random() * insight.spokenLines.length)];
            narrator.speak(insight.id, line);
            setNarratorActive(true);
            setSpokenSubtitle(line);
            setTimeout(() => { setNarratorActive(false); setSpokenSubtitle(null); }, 10000);
          }
          break;
        }
      }
    }

    animRef.current = requestAnimationFrame(loop);
  }, [speed, audioInit, narratorEnabled]);

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

  const handleReset = () => {
    cancelAnimationFrame(animRef.current);
    setRunning(false);
    narrator.stop();
    ecoRef.current = initEcosystem(canvasSize.w, canvasSize.h, "noWolves");
    const eco = ecoRef.current;
    setStats(eco.stats);
    setHistory([]);
    setScore(eco.balanceScore);
    setAlerts([]);
    setGameState("ready");
    setGameTimer(0);
    setHealthyStreak(0);
    gameTimerRef.current = 0;
    healthyStreakRef.current = 0;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.clearRect(0, 0, eco.W, eco.H); renderEcosystem(ctx, eco); }
  };

  const handleStartGame = () => {
    if (gameState === "won" || gameState === "lost") {
      handleReset();
    }
    setGameState("playing");
    gameTimerRef.current = 0;
    healthyStreakRef.current = 0;
    setGameTimer(0);
    setHealthyStreak(0);
    setRunning(true);
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
    ecoRef.current = initEcosystem(canvasSize.w, canvasSize.h, mode);
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
    { delay: 0, text: "Welcome to Yellowstone, 1926. The last wolf has just been killed." },
    { delay: 8000, text: "For decades, the government hunted every wolf in the park to protect livestock. Now the ecosystem is paying the price." },
    { delay: 18000, text: "Without wolves, elk are multiplying unchecked. They are devouring the willows and aspens that hold the riverbanks together." },
    { delay: 28000, text: "Your mission: restore this ecosystem. Add wolves and other species to bring the food web back into balance." },
    { delay: 37000, text: "Reach a balance score of 75 and hold it for 20 seconds to win. Good luck, ranger." },
  ];
  const introPlayedRef = useRef(false);

  const playIntroNarration = useCallback(async () => {
    if (introPlayedRef.current) return;
    introPlayedRef.current = true;
    narrator.init();
    // Auto-init audio on first interaction
    if (!audioInit) {
      try {
        await soundscape.init();
        setAudioInit(true);
      } catch (e) { console.error('Audio init failed:', e); }
    }
    INTRO_LINES.forEach(({ delay, text }) => {
      setTimeout(() => {
        if (narratorEnabled) {
          narrator.speak('intro_' + delay, text);
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
    root: { width: "100vw", height: "100vh", display: "flex", flexDirection: "column", background: "#0a0f1a", overflow: "hidden", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: "#e2e8f0", position: "relative" },
    topBar: { display: m ? "flex" : "flex", flexDirection: m ? "row" : "row", alignItems: "center", gap: m ? 4 : 10, padding: m ? "4px 8px" : "8px 16px", background: "#0f172a", borderBottom: "1px solid #1e293b", flexShrink: 0, height: m ? "auto" : 40, minHeight: m ? 34 : 40, zIndex: 10, overflowX: m ? "auto" : "visible", overflowY: "hidden", WebkitOverflowScrolling: "touch", flexWrap: m ? "wrap" : "nowrap" },
    main: { flex: 1, display: "flex", overflow: "hidden", position: "relative", minHeight: 0 },
    panel: { width: m ? 0 : (panelCollapsed ? 44 : 200), background: "#0f172a", borderRight: m ? "none" : "1px solid #1e293b", display: "flex", flexDirection: "column", flexShrink: 0, transition: "width 0.2s ease", overflow: "hidden", zIndex: 5 },
    canvasWrap: { flex: 1, position: "relative", overflow: "hidden", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" },
    bottomDock: { display: m ? "flex" : "none", height: 50, background: "rgba(15,23,42,0.95)", borderTop: "1px solid #1e293b", overflowX: "auto", overflowY: "hidden", WebkitOverflowScrolling: "touch", alignItems: "center", padding: "0 8px", gap: 8, flexShrink: 0, zIndex: 5 },
    dockSpeciesBtn: (active, color) => ({ minWidth: 44, width: 44, height: 44, borderRadius: "50%", border: active ? `3px solid ${color}` : "2px solid #334155", background: active ? `${color}25` : "rgba(30,41,59,0.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, cursor: "pointer", flexShrink: 0, transition: "all 0.15s ease", boxShadow: active ? `0 0 8px ${color}40` : "none" }),
    btn: (active, color) => ({ padding: m ? "4px 8px" : "4px 12px", borderRadius: 6, border: active ? `1px solid ${color}` : "1px solid #334155", background: active ? `${color}20` : "transparent", color: active ? color : "#94a3b8", fontSize: m ? 10 : 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", minHeight: m ? 28 : "auto" }),
    btnSolid: (bg) => ({ padding: m ? "5px 10px" : "6px 14px", borderRadius: 6, border: "none", background: bg, color: "#fff", fontSize: m ? 11 : 12, fontWeight: 700, cursor: "pointer", minHeight: m ? 28 : "auto" }),
  };

  return (
    <div style={S.root}>
      {/* ═══ PORTRAIT ORIENTATION BANNER ═══ */}
      {isMobile && isPortrait && !portraitDismissed && (
        <div style={{
          background: "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(249,115,22,0.15))",
          borderBottom: "1px solid #dc2626",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          zIndex: 50,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#fca5a5" }}>
            <span style={{ fontSize: 16 }}>📱</span>
            <span>Rotate to landscape for best experience</span>
          </div>
          <button
            onClick={() => setPortraitDismissed(true)}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 18,
              padding: 0,
              display: "flex",
              alignItems: "center"
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ═══ TOP BAR ═══ */}
      <div style={S.topBar}>
        <div style={{ fontSize: 14, fontWeight: 800, background: "linear-gradient(135deg, #60a5fa, #34d399)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          YELLOWSTONE
        </div>

        {/* Score */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1e293b", borderRadius: 6, padding: "3px 10px" }}>
          <span style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>BALANCE</span>
          <div style={{ width: 60, height: 5, background: "#334155", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${score}%`, background: getScoreColor(score), borderRadius: 3, transition: "width 0.3s" }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 800, color: getScoreColor(score) }}>{score}</span>
          <span style={{ fontSize: 10, color: getScoreColor(score), fontWeight: 600 }}>{getScoreLabel(score)}</span>
        </div>

        {/* Game timer */}
        {gameState === "playing" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1e293b", borderRadius: 6, padding: "3px 10px" }}>
            <span style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>TIME</span>
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

        {/* Sim controls */}
        {gameState === "ready" ? (
          <button onClick={handleStartGame} style={S.btnSolid("#16a34a")}>▶ Start</button>
        ) : gameState === "playing" ? (
          <button onClick={() => setRunning(!running)} style={S.btnSolid(running ? "#dc2626" : "#16a34a")}>
            {running ? "⏸ Pause" : "▶ Resume"}
          </button>
        ) : (
          <button onClick={handleStartGame} style={S.btnSolid("#3b82f6")}>🔄 New Challenge</button>
        )}
        <button onClick={handleReset} style={S.btn(false, "#64748b")}>Reset</button>

        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#475569" }}>Speed</span>
          {[1, 2, 4].map(s => (
            <button key={s} onClick={() => setSpeed(s)} style={{ ...S.btn(speed === s, "#eab308"), padding: "2px 8px", fontSize: 10 }}>{s}x</button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Scenarios — hidden on mobile, shown on desktop */}
        {!m && <>
          <span style={{ fontSize: 10, color: "#475569" }}>Scenarios:</span>
          <button onClick={() => handlePreset("balanced")} style={S.btn(false, "#22c55e")}>Balanced</button>
          <button onClick={() => handlePreset("noWolves")} style={S.btn(false, "#ef4444")}>No Wolves</button>
          <button onClick={() => handlePreset("heavyHunting")} style={S.btn(false, "#f97316")}>Heavy Hunt</button>
          <button onClick={() => handlePreset("recovery")} style={S.btn(false, "#3b82f6")}>Recovery</button>
        </>}

        <button onClick={handleAudioToggle} style={S.btn(audioInit, "#a78bfa")} title={audioInit ? (audioMuted ? 'Unmute' : 'Mute') : 'Click for sound'}>
          {audioInit ? (audioMuted ? '🔇' : '🔊') : '🔇'}{!m && ' Sound'}
        </button>
        <button onClick={handleNarratorToggle} style={{ ...S.btn(narratorEnabled, "#f472b6"), position: "relative" }} title={narratorEnabled ? 'Mute narrator' : 'Enable narrator'}>
          {narratorEnabled ? '🎙️' : '🔕'}{!m && ' Narrator'}
          {narratorActive && narratorEnabled && <span style={{ position: "absolute", top: -2, right: -2, width: 7, height: 7, borderRadius: "50%", background: "#f472b6", animation: "pulse 1s infinite" }} />}
        </button>
        {!m && <button onClick={() => setShowWeb(!showWeb)} style={S.btn(showWeb, "#fb923c")}>🕸️ Web</button>}
        {!m && <button onClick={() => setShowLearn(!showLearn)} style={S.btn(showLearn, "#60a5fa")}>📚 Learn</button>}
        {!m && <button onClick={() => setShowChart(!showChart)} style={S.btn(showChart, "#60a5fa")}>📊</button>}
        <button onClick={() => setShowHelp(true)} style={S.btn(false, "#64748b")}>{m ? '?' : '?'}</button>
      </div>

      {/* ═══ MAIN AREA ═══ */}
      <div style={S.main}>
        {/* ─── Left Panel (desktop only) ─── */}
        {!m && (
        <div style={S.panel}>
          <button onClick={() => setPanelCollapsed(!panelCollapsed)} style={{ background: "transparent", border: "none", color: "#64748b", padding: "8px", cursor: "pointer", fontSize: 14, textAlign: "center" }}>
            {panelCollapsed ? "▸" : "◂"}
          </button>

          {!panelCollapsed && (
            <>
              {/* Add mode label */}
              <div style={{ padding: "5px 8px", margin: "0 8px 6px", borderRadius: 6, background: "#166534", textAlign: "center", fontSize: 11, fontWeight: 700, color: "#86efac" }}>
                + Click to Add Species
              </div>

              {/* Species buttons */}
              <div style={{ flex: 1, overflowY: "auto", padding: "0 6px" }}>
                {SPECIES.map(sp => (
                  <button key={sp.type} onClick={() => setSelectedTool(sp.type)} style={{
                    display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "5px 7px", borderRadius: 6, marginBottom: 2,
                    border: selectedTool === sp.type ? `2px solid ${sp.color}` : "2px solid transparent",
                    background: selectedTool === sp.type ? `${sp.color}15` : "transparent",
                    color: "#e2e8f0", cursor: "pointer", textAlign: "left",
                  }}>
                    <span style={{ fontSize: 15 }}>{sp.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600 }}>{sp.label}</div>
                      <div style={{ fontSize: 9, color: "#64748b" }}>{stats[sp.key] ?? 0}</div>
                    </div>
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
                <div style={{ height: 3, background: "#1e293b", borderRadius: 2, overflow: "hidden", marginBottom: 4 }}>
                  <div style={{ height: "100%", width: `${stats.vegetationHealth}%`, background: "#34d399", borderRadius: 2 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
                  <span style={{ color: "#60a5fa" }}>🏞️ River</span>
                  <span style={{ color: "#60a5fa", fontWeight: 700 }}>{stats.riverHealth}%</span>
                </div>
                <div style={{ height: 3, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${stats.riverHealth}%`, background: "#60a5fa", borderRadius: 2 }} />
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
            width={canvasSize.w}
            height={canvasSize.h}
            onClick={handleCanvasClick}
            style={{ display: "block", cursor: "crosshair", imageRendering: "crisp-edges" }}
          />

          {/* Tool cursor label + compact HUD */}
          <div style={{ position: "absolute", top: m ? 4 : 8, left: m ? 4 : 8, pointerEvents: "none", zIndex: 3 }}>
            <div style={{ background: "rgba(15,23,42,0.88)", borderRadius: 6, padding: m ? "3px 8px" : "4px 10px", fontSize: m ? 10 : 11, color: "#94a3b8", border: "1px solid #334155", marginBottom: 4 }}>
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

          {/* Alerts overlay */}
          {alerts.length > 0 && (
            <div style={{ position: "absolute", bottom: 12, left: 12, maxWidth: 340, pointerEvents: "none", zIndex: 4 }}>
              {alerts.slice(0, 3).map((a, i) => (
                <div key={i} style={{
                  background: a.sev === "crit" ? "rgba(69,10,10,0.94)" : "rgba(66,32,6,0.94)",
                  border: `1px solid ${a.sev === "crit" ? "#dc2626" : "#ca8a04"}`,
                  borderRadius: 8, padding: "7px 11px", marginBottom: 5, backdropFilter: "blur(5px)",
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
              position: "absolute", bottom: alerts.length > 0 ? (m ? 50 : 80) : (m ? 8 : 16), left: "50%", transform: "translateX(-50%)",
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
              position: "absolute", top: 8, right: 8, background: "rgba(15,23,42,0.85)", borderRadius: 8,
              padding: "4px 12px", fontSize: 11, color: "#94a3b8", pointerEvents: "none", border: "1px solid #334155",
              display: "flex", alignItems: "center", gap: 8,
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
                <button onClick={() => setShowLearn(false)} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}>✕</button>
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
                  { key: "habitat", label: "Habitat" },
                  { key: "balance", label: "Score" },
                ].map(t => (
                  <button key={t.key} onClick={() => setChartTab(t.key)} style={{
                    padding: "3px 9px", borderRadius: 5, border: "none", fontSize: 10, fontWeight: 600, cursor: "pointer",
                    background: chartTab === t.key ? "#334155" : "transparent", color: chartTab === t.key ? "#fff" : "#64748b",
                  }}>{t.label}</button>
                ))}
                <div style={{ flex: 1 }} />
                <button onClick={() => setShowChart(false)} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>
              <div style={{ height: 180 }}>
                {history.length < 2 ? (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 11 }}>
                    Run simulation to see trends...
                  </div>
                ) : chartTab === "predprey" ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="t" stroke="#475569" fontSize={8} tickLine={false} />
                      <YAxis stroke="#475569" fontSize={8} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 9 }} />
                      <Legend wrapperStyle={{ fontSize: 9 }} />
                      <Line type="monotone" dataKey="wolves" stroke="#94a3b8" strokeWidth={2} dot={false} name="Wolves" />
                      <Line type="monotone" dataKey="elk" stroke="#a78bfa" strokeWidth={2} dot={false} name="Elk" />
                      <Line type="monotone" dataKey="coyotes" stroke="#d97706" strokeWidth={1.5} dot={false} name="Coyotes" strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="rabbits" stroke="#d1d5db" strokeWidth={1} dot={false} name="Rabbits" strokeDasharray="2 2" />
                    </LineChart>
                  </ResponsiveContainer>
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
                <button key={sp.type} onClick={() => setSelectedTool(sp.type)}
                  style={S.dockSpeciesBtn(selectedTool === sp.type, sp.color)}
                  title={`${sp.label} (${stats[sp.key] ?? 0})`}
                >{sp.icon}</button>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "0 6px", borderLeft: "1px solid #334155", fontSize: 10, color: "#64748b" }}>
                🎯 {stats.hunters ?? 0}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ VICTORY MODAL ═══ */}
      {gameState === "won" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "linear-gradient(135deg, #0f2a1a, #1e293b)", borderRadius: 16, padding: m ? 20 : 32, maxWidth: m ? "90vw" : 500, margin: 20, border: "2px solid #22c55e", textAlign: "center" }}>
            <div style={{ fontSize: m ? 36 : 48, marginBottom: 12 }}>🐺🌲🏔️</div>
            <h2 style={{ fontSize: m ? 18 : 24, fontWeight: 800, margin: "0 0 8px", color: "#86efac" }}>Ecosystem Restored!</h2>
            <p style={{ fontSize: m ? 12 : 14, color: "#cbd5e1", lineHeight: 1.6, margin: "0 0 16px" }}>
              You achieved a balanced ecosystem and held it stable. Wolves are controlling elk, vegetation is thriving, rivers are healthy, and the entire food web is functioning.
            </p>
            <p style={{ fontSize: m ? 10 : 12, color: "#94a3b8", margin: "0 0 16px", padding: m ? "8px 10px" : "10px 14px", background: "#0f172a", borderRadius: 8, lineHeight: 1.5 }}>
              <strong style={{ color: "#60a5fa" }}>In real Yellowstone:</strong> This recovery took from 1995 to roughly 2010 — about 15 years. You did it in {Math.floor(gameTimerRef.current / 60)} seconds ({Math.round(GAME_DURATION / 60 - gameTimerRef.current / 60)}s remaining)!
            </p>
            <div style={{ display: "flex", gap: m ? 6 : 10, justifyContent: "center", flexDirection: m ? "column" : "row" }}>
              <button onClick={handleStartGame} style={{ padding: m ? "8px 16px" : "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #16a34a, #0d9488)", color: "#fff", fontWeight: 700, fontSize: m ? 12 : 14, cursor: "pointer" }}>
                Play Again
              </button>
              <button onClick={() => { handleReset(); setShowHelp(false); }} style={{ padding: m ? "8px 16px" : "10px 24px", borderRadius: 8, border: "1px solid #334155", background: "transparent", color: "#94a3b8", fontWeight: 600, fontSize: m ? 11 : 13, cursor: "pointer" }}>
                Free Play
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ LOSS MODAL ═══ */}
      {gameState === "lost" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "linear-gradient(135deg, #2a0f0f, #1e293b)", borderRadius: 16, padding: m ? 20 : 32, maxWidth: m ? "90vw" : 500, margin: 20, border: "2px solid #ef4444", textAlign: "center" }}>
            <div style={{ fontSize: m ? 36 : 48, marginBottom: 12 }}>💀🏜️</div>
            <h2 style={{ fontSize: m ? 18 : 24, fontWeight: 800, margin: "0 0 8px", color: "#fca5a5" }}>Ecosystem Collapsed</h2>
            <p style={{ fontSize: m ? 12 : 14, color: "#cbd5e1", lineHeight: 1.6, margin: "0 0 16px" }}>
              Time ran out before you could stabilize the ecosystem. The balance score needed to reach {WIN_THRESHOLD} and hold for {Math.round(WIN_STREAK_NEEDED / 60)} seconds.
            </p>
            <p style={{ fontSize: m ? 10 : 12, color: "#94a3b8", margin: "0 0 8px", lineHeight: 1.5 }}>
              <strong>Your final score:</strong> <span style={{ color: getScoreColor(score), fontWeight: 700, fontSize: m ? 14 : 16 }}>{score}</span>
            </p>
            <p style={{ fontSize: m ? 9 : 11, color: "#64748b", margin: "0 0 16px", padding: m ? "6px 10px" : "8px 12px", background: "#0f172a", borderRadius: 8 }}>
              <strong style={{ color: "#eab308" }}>Hint:</strong> {score < 40 ? "Try adding wolves early — they control elk and trigger the whole cascade of recovery." : score < 60 ? "You're on the right track. Focus on getting wolves and elk balanced first, then let vegetation recover." : "So close! Once the balance score hits " + WIN_THRESHOLD + ", you need to hold it steady. Avoid adding too many of any one species."}
            </p>
            <div style={{ display: "flex", gap: m ? 6 : 10, justifyContent: "center", flexDirection: m ? "column" : "row" }}>
              <button onClick={handleStartGame} style={{ padding: m ? "8px 16px" : "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #dc2626, #ea580c)", color: "#fff", fontWeight: 700, fontSize: m ? 12 : 14, cursor: "pointer" }}>
                Try Again
              </button>
              <button onClick={() => { handleReset(); setShowHelp(false); }} style={{ padding: m ? "8px 16px" : "10px 24px", borderRadius: 8, border: "1px solid #334155", background: "transparent", color: "#94a3b8", fontWeight: 600, fontSize: m ? 11 : 13, cursor: "pointer" }}>
                Free Play
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ INTRO / HELP MODAL ═══ */}
      {showHelp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => { setShowHelp(false); playIntroNarration(); handleStartGame(); }}>
          <div style={{ background: "linear-gradient(135deg, #0f172a, #1e293b)", borderRadius: 16, padding: m ? "20px 18px 16px" : "28px 28px 20px", maxWidth: m ? "90vw" : 500, margin: 16, border: "1px solid #334155", textAlign: "center", maxHeight: m ? "90vh" : "auto", overflowY: m ? "auto" : "visible" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: m ? 32 : 40, marginBottom: 8 }}>🐺🏔️</div>
            <h2 style={{ fontSize: m ? 16 : 20, fontWeight: 800, margin: "0 0 6px", background: "linear-gradient(135deg, #ef4444, #f97316)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Yellowstone, 1926
            </h2>
            <p style={{ fontSize: m ? 11 : 13, color: "#94a3b8", margin: "0 0 14px", fontStyle: "italic" }}>The last wolf has been killed.</p>

            <div style={{ fontSize: m ? 11 : 12, lineHeight: 1.7, color: "#cbd5e1", textAlign: "left" }}>
              <p style={{ margin: "0 0 10px" }}>The U.S. government has systematically exterminated every wolf in Yellowstone. Elk herds are exploding, devouring the willows and aspens. Rivers are eroding. The ecosystem is collapsing.</p>
              <p style={{ margin: "0 0 10px" }}><strong style={{ color: "#60a5fa" }}>Your mission:</strong> Restore the ecosystem by reintroducing species. Reach a balance score of <strong>{WIN_THRESHOLD}+</strong> and hold it steady for <strong>{Math.round(WIN_STREAK_NEEDED / 60)}s</strong> to win. You have <strong>{Math.round(GAME_DURATION / 60)}s</strong> ({Math.round(GAME_DURATION / 3600)} minutes) before the ecosystem collapses beyond recovery.</p>
              <p style={{ margin: "0 0 10px", padding: m ? "6px 10px" : "8px 12px", background: "#0f172a", borderRadius: 8, fontSize: m ? 9 : 11 }}>
                <strong style={{ color: "#60a5fa" }}>The Cascade:</strong> Wolves → Elk → Vegetation → Rivers → Beavers/Fish/Songbirds
                <br />
                <strong style={{ color: "#f97316" }}>Side Effect:</strong> No wolves → Coyote boom → Rabbit/bird decline
              </p>
              <p style={{ margin: "0 0 6px", fontSize: m ? 9 : 11, color: "#64748b" }}>Select species from the panel, click the map to add them. Tap <strong>Start Challenge</strong> to begin the timer.</p>
            </div>
            <button onClick={() => { setShowHelp(false); playIntroNarration(); handleStartGame(); }} style={{ width: "100%", padding: m ? "10px 0" : "12px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #16a34a, #0d9488)", color: "#fff", fontWeight: 700, fontSize: m ? 13 : 15, cursor: "pointer", marginTop: 10 }}>
              Begin Restoration
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
