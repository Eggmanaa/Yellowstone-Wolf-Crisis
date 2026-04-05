import { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

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
  HUNTER = "hunter";

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

function initEcosystem(W, H) {
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
    ],
    W, H, tick: 0, season: 0,
    vegetationHealth: 85, riverHealth: 90,
    riverWidth: TERRAIN.riverBaseW,
    stats: { wolves: 12, elk: 45, trees: 90, beavers: 8, coyotes: 10, fish: 22, birds: 15, rabbits: 28, hunters: 0, vegetationHealth: 85, riverHealth: 90 },
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
  if (w.energy > 120 && Math.random() < 0.003) {
    const cnt = eco.entities.filter(e => e.type === WOLF && e.alive).length;
    if (cnt < 45) { eco.entities.push(createEntity(WOLF, w.x + rand(-20, 20), w.y + rand(-20, 20), eco.W, eco.H)); w.energy -= 40; }
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
      }
      return;
    }
  }
  elk.state = "wander";
  wander(elk, eco.W, eco.H);
  if (elk.energy > 90 && Math.random() < 0.005) {
    const cnt = eco.entities.filter(e => e.type === ELK && e.alive).length;
    if (cnt < 130) { eco.entities.push(createEntity(ELK, elk.x + rand(-20, 20), elk.y + rand(-20, 20), eco.W, eco.H)); elk.energy -= 30; }
  }
}

function updateTree(tree, eco) {
  if (tree.health <= 0) { tree.alive = false; return; }
  const vf = eco.vegetationHealth / 100;
  tree.growth = clamp(tree.growth + 0.0005 * vf, 0, tree.maxGrowth);
  tree.health = clamp(tree.health + 0.02, 0, 100);
  if (tree.growth > 0.8 && Math.random() < 0.001 * vf) {
    const cnt = eco.entities.filter(e => e.type === TREE && e.alive).length;
    if (cnt < 150) eco.entities.push(createEntity(TREE, tree.x + rand(-50, 50), tree.y + rand(-50, 50), eco.W, eco.H));
  }
}

function updateBeaver(b, eco) {
  b.energy -= 0.05;
  const RX = eco.W * TERRAIN.riverPct;
  if (Math.abs(b.x - RX) > 60) moveToward(b, RX + rand(-25, 25), b.y + rand(-30, 30), b.speed);
  else wander(b, eco.W, eco.H);
  const tree = findNearest(b, eco.entities, TREE, 90);
  if (tree && tree.growth > 0.5) eco.riverHealth = clamp(eco.riverHealth + 0.006, 0, 100);
  if (b.energy > 70 && Math.random() < 0.002) {
    const tc = eco.entities.filter(e => e.type === TREE && e.alive && e.growth > 0.4).length;
    const bc = eco.entities.filter(e => e.type === BEAVER && e.alive).length;
    if (tc > 20 && bc < 22) { eco.entities.push(createEntity(BEAVER, b.x + rand(-15, 15), b.y + rand(-15, 15), eco.W, eco.H)); b.energy -= 25; }
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
  const wc = eco.entities.filter(e => e.type === WOLF && e.alive).length;
  const rr = wc < 3 ? 0.007 : 0.002;
  if (c.energy > 70 && Math.random() < rr) {
    const cnt = eco.entities.filter(e => e.type === COYOTE && e.alive).length;
    const cap = wc < 3 ? 40 : 16;
    if (cnt < cap) { eco.entities.push(createEntity(COYOTE, c.x + rand(-20, 20), c.y + rand(-20, 20), eco.W, eco.H)); c.energy -= 25; }
  }
}

function updateFish(f, eco) {
  f.energy -= 0.04;
  const RX = eco.W * TERRAIN.riverPct;
  const rw = eco.riverWidth;
  f.x = clamp(f.x + rand(-1.2, 1.2), RX - rw / 2 + 3, RX + rw / 2 - 3);
  f.y = clamp(f.y + rand(-1.8, 1.8), 5, eco.H - 5);
  if (eco.riverHealth > 50 && Math.random() < 0.003) {
    const cnt = eco.entities.filter(e => e.type === FISH && e.alive).length;
    if (cnt < 40) eco.entities.push(createEntity(FISH, f.x, f.y + rand(-10, 10), eco.W, eco.H));
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
  const tc = eco.entities.filter(e => e.type === TREE && e.alive && e.growth > 0.5).length;
  if (b.energy > 40 && tc > 20 && Math.random() < 0.002) {
    const cnt = eco.entities.filter(e => e.type === BIRD && e.alive).length;
    if (cnt < 35) { eco.entities.push(createEntity(BIRD, b.x + rand(-20, 20), b.y + rand(-20, 20), eco.W, eco.H)); b.energy -= 15; }
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
  if (r.energy > 35 && Math.random() < 0.006) {
    const cnt = eco.entities.filter(e => e.type === RABBIT && e.alive).length;
    if (cnt < 65) { eco.entities.push(createEntity(RABBIT, r.x + rand(-15, 15), r.y + rand(-15, 15), eco.W, eco.H)); r.energy -= 15; }
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
      case HUNTER: updateHunter(e, eco); break;
    }
    if (e.speed > 0 && e.type !== TREE) {
      e.x = clamp(e.x + e.vx, 5, W - 5);
      e.y = clamp(e.y + e.vy, 5, H - 5);
      e.vx *= 0.92; e.vy *= 0.92;
    }
    if (e.energy <= 0 && e.type !== TREE) e.alive = false;
    e.age++;
  }

  eco.entities = eco.entities.filter(e => e.alive || e.age < 60);

  const treeCount = eco.entities.filter(e => e.type === TREE && e.alive).length;
  const avgGrowth = eco.entities.filter(e => e.type === TREE && e.alive).reduce((s, t) => s + t.growth, 0) / Math.max(treeCount, 1);
  eco.vegetationHealth = clamp(treeCount * 0.7 + avgGrowth * 25, 0, 100);

  const beaverCount = eco.entities.filter(e => e.type === BEAVER && e.alive).length;
  const targetRiver = eco.vegetationHealth * 0.6 + beaverCount * 3;
  eco.riverHealth = clamp(eco.riverHealth + (targetRiver - eco.riverHealth) * 0.005, 0, 100);
  eco.riverWidth = TERRAIN.riverBaseW + (100 - eco.riverHealth) * 0.35;

  if (eco.tick % 100 === 0 && eco.vegetationHealth > 30 && treeCount < 130) {
    eco.entities.push(createEntity(TREE, null, null, W, H));
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
    eco.balanceScore = clamp(Math.round(ws + es + ts + rs + bs + bis + fs + cs + rbs), 0, 100);

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

  // ─── Background: sky gradient ─────────────────────────────────────────
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  skyGrad.addColorStop(0, "#0a1428");
  skyGrad.addColorStop(0.5, "#142a52");
  skyGrad.addColorStop(1, "transparent");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Base sky
  ctx.fillStyle = "#0f1d38";
  ctx.fillRect(0, 0, W, H);

  // ─── Atmospheric ambient light gradient ───────────────────────────────
  const ambGrad = ctx.createLinearGradient(0, 0, W, H);
  ambGrad.addColorStop(0, `rgba(96, 165, 250, ${0.05 * vf})`);
  ambGrad.addColorStop(1, `rgba(139, 92, 246, ${0.03 * vf})`);
  ctx.fillStyle = ambGrad;
  ctx.fillRect(0, 0, W, H);

  // ─── Mountain range with snow detail ──────────────────────────────────
  ctx.fillStyle = "#0f1d38";
  ctx.beginPath();
  ctx.moveTo(MX, H);
  for (let x = MX; x <= W; x += 2) {
    const pct = (x - MX) / (W - MX);
    const peak = H * 0.12 + Math.sin(pct * 5 + 0.8) * H * 0.14 + Math.sin(pct * 11.3) * H * 0.05 + Math.sin(pct * 23) * H * 0.02;
    ctx.lineTo(x, peak);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // Snow caps with detail
  ctx.fillStyle = "rgba(226, 232, 240, 0.4)";
  ctx.beginPath();
  ctx.moveTo(MX, H);
  for (let x = MX; x <= W; x += 2) {
    const pct = (x - MX) / (W - MX);
    const peak = H * 0.12 + Math.sin(pct * 5 + 0.8) * H * 0.14 + Math.sin(pct * 11.3) * H * 0.05 + Math.sin(pct * 23) * H * 0.02;
    ctx.lineTo(x, peak);
  }
  for (let x = W; x >= MX; x -= 2) {
    const pct = (x - MX) / (W - MX);
    const peak = H * 0.12 + Math.sin(pct * 5 + 0.8) * H * 0.14 + Math.sin(pct * 11.3) * H * 0.05 + Math.sin(pct * 23) * H * 0.02;
    ctx.lineTo(x, peak + H * 0.06);
  }
  ctx.closePath();
  ctx.fill();

  // ─── Mountain rock shading ───────────────────────────────────────────
  ctx.strokeStyle = "rgba(30, 41, 59, 0.6)";
  ctx.lineWidth = 0.8;
  for (let x = MX; x <= W; x += 8) {
    const pct = (x - MX) / (W - MX);
    const peak = H * 0.12 + Math.sin(pct * 5 + 0.8) * H * 0.14 + Math.sin(pct * 11.3) * H * 0.05 + Math.sin(pct * 23) * H * 0.02;
    const slopeH = H * 0.08;
    ctx.beginPath();
    ctx.moveTo(x, peak);
    ctx.lineTo(x + 12, peak + slopeH);
    ctx.stroke();
  }

  // ─── Ground — meadow with Perlin noise texture ────────────────────────
  const meadowColor = lerpColor("#1a2e1a", "#2d5a2e", vf);
  const meadowGrad = ctx.createRadialGradient(W * 0.25, H * 0.5, 0, W * 0.25, H * 0.5, W * 0.4);
  meadowGrad.addColorStop(0, lerpColor("#1a3a1a", "#3a7a3e", vf));
  meadowGrad.addColorStop(1, meadowColor);
  ctx.fillStyle = meadowGrad;
  ctx.fillRect(0, H * 0.4, RX - rw / 2, H * 0.6);

  // Add perlin noise texture to meadow
  for (let x = 0; x < RX - rw / 2; x += 4) {
    for (let y = H * 0.4; y < H; y += 4) {
      const nv = noise2d(x, y, 40);
      const intensity = (nv - 0.5) * 0.3;
      const color = lerpColor(meadowColor, "#0a1408", intensity + 0.5);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(x, y, 4, 4);
    }
  }
  ctx.globalAlpha = 1;

  // ─── Ground — forest side ────────────────────────────────────────────
  const forestColor = lerpColor("#0f2415", "#1a3a2a", vf);
  ctx.fillStyle = forestColor;
  ctx.fillRect(RX + rw / 2, H * 0.4, MX - RX - rw / 2, H * 0.6);

  // Forest perlin texture
  for (let x = RX + rw / 2; x < MX; x += 4) {
    for (let y = H * 0.4; y < H; y += 4) {
      const nv = noise2d(x, y, 35);
      const intensity = (nv - 0.5) * 0.4;
      const color = lerpColor(forestColor, "#051008", intensity + 0.5);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x, y, 4, 4);
    }
  }
  ctx.globalAlpha = 1;

  // ─── Wildflowers (colored dots) on meadow ──────────────────────────
  if (vf > 0.2) {
    ctx.globalAlpha = vf * 0.4;
    const flowerColors = ["#f87171", "#fbbf24", "#4ade80", "#38bdf8"];
    for (let i = 0; i < Math.floor(40 * vf); i++) {
      const fx = (i * 191.23) % (RX - rw / 2 - 10) + 10;
      const fy = (i * 137.891 + 20) % (H * 0.5) + H * 0.4;
      ctx.fillStyle = flowerColors[Math.floor((fx + fy) / 100) % flowerColors.length];
      ctx.beginPath();
      ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ─── Rocky areas ──────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(71, 85, 105, 0.15)";
  for (let i = 0; i < 30; i++) {
    const rx = (i * 277.13) % (RX - rw / 2 - 10) + 10;
    const ry = (i * 193.47 + 50) % (H * 0.3) + H * 0.5;
    ctx.beginPath();
    ctx.arc(rx, ry, 2 + Math.sin(i) * 1, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── River with advanced animation and effects ─────────────────────
  // River glow/aura
  const glowColor = rh > 50 ? "rgba(37, 99, 235, 0.12)" : "rgba(251, 146, 60, 0.08)";
  const glowGrad = ctx.createLinearGradient(RX - rw, H * 0.4, RX + rw, H * 0.4);
  glowGrad.addColorStop(0, "transparent");
  glowGrad.addColorStop(0.2, glowColor);
  glowGrad.addColorStop(0.5, glowColor);
  glowGrad.addColorStop(0.8, glowColor);
  glowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(RX - rw * 1.2, H * 0.4, rw * 2.4, H * 0.6);

  // River water main color
  const rc = rh > 60 ? "#1d4ed8" : rh > 30 ? "#2563eb" : "#7c2d12";
  const riverGrad = ctx.createLinearGradient(RX - rw / 2, H * 0.4, RX + rw / 2, H * 0.4);
  riverGrad.addColorStop(0, lerpColor("#0f172a", rc, 0.4));
  riverGrad.addColorStop(0.5, rc);
  riverGrad.addColorStop(1, lerpColor("#0f172a", rc, 0.4));
  ctx.fillStyle = riverGrad;
  ctx.fillRect(RX - rw / 2, H * 0.4, rw, H * 0.6);

  // River flowing current with multiple sine layers
  ctx.strokeStyle = `rgba(147, 197, 253, ${0.15 + rh * 0.004})`;
  ctx.lineWidth = 0.7;
  for (let layer = 0; layer < 3; layer++) {
    for (let y = H * 0.4 - 10; y < H; y += 8 + layer * 3) {
      ctx.beginPath();
      const phase = tick * (0.02 + layer * 0.005) + y * 0.06 + layer * 0.4;
      const amp = (rw * 0.2) * (1 - layer * 0.2);
      for (let x = RX - rw / 2 - 20; x <= RX + rw / 2 + 20; x += 3) {
        const sx = RX + Math.sin(phase + x * 0.008) * amp + Math.sin(phase * 0.5 + x * 0.015) * amp * 0.5;
        ctx.lineTo(sx, y);
      }
      ctx.stroke();
    }
  }

  // River stones along banks
  ctx.fillStyle = "rgba(51, 65, 85, 0.4)";
  for (let i = 0; i < 20; i++) {
    const sy = (i * 227.1) % H + H * 0.4;
    const leftStone = RX - rw / 2 - 8;
    const rightStone = RX + rw / 2 + 8;
    ctx.beginPath();
    ctx.arc(leftStone, sy, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rightStone, sy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Foam/white water at edges
  ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + rh * 0.003})`;
  for (let y = H * 0.4; y < H; y += 15) {
    for (let i = 0; i < 3; i++) {
      const fx = RX - rw / 2 - 3 - i * 1.5 + Math.sin(tick * 0.05 + y * 0.02) * 2;
      const fy = y + Math.sin(tick * 0.08 + i * 0.4) * 3;
      ctx.fillRect(fx, fy, 2, 1);
    }
    for (let i = 0; i < 3; i++) {
      const fx = RX + rw / 2 + 3 + i * 1.5 - Math.sin(tick * 0.05 + y * 0.02) * 2;
      const fy = y + Math.sin(tick * 0.08 + i * 0.4) * 3;
      ctx.fillRect(fx, fy, 2, 1);
    }
  }

  // ─── Grass detail with sway ───────────────────────────────────────────
  if (vf > 0.15) {
    ctx.globalAlpha = vf * 0.3;
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 0.7;
    for (let i = 0; i < Math.floor(120 * vf); i++) {
      const gx = (i * 137.508) % (RX - rw / 2 - 10) + 10;
      const gy = (i * 89.33 + 17) % (H * 0.25) + H * 0.55;
      if (Math.abs(gx - RX) < rw / 2 + 8) continue;
      if (gx > MX) continue;
      const sway = Math.sin(tick * 0.015 + gx * 0.05) * 2 + Math.sin(tick * 0.008 + i) * 1;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + sway - 1.5, gy - 6 * vf);
      ctx.moveTo(gx + 2.5, gy);
      ctx.lineTo(gx + 2.5 + sway + 1.2, gy - 5 * vf);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
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
      case TREE: drawTree(ctx, e, vf, tick); break;
      case WOLF: drawWolf(ctx, e, tick); break;
      case ELK: drawElk(ctx, e, tick); break;
      case BEAVER: drawBeaver(ctx, e, tick); break;
      case COYOTE: drawCoyote(ctx, e, tick); break;
      case FISH: drawFish(ctx, e, tick); break;
      case BIRD: drawBird(ctx, e, tick); break;
      case RABBIT: drawRabbit(ctx, e, tick); break;
      case HUNTER: drawHunter(ctx, e, tick); break;
    }
    ctx.restore();
  }

  // ─── Particle effects for dead entities ──────────────────────────────
  for (const e of eco.entities) {
    if (e.alive || e.type === TREE) continue;
    const fade = 1 - e.age / 60;
    if (fade <= 0) continue;
    ctx.globalAlpha = fade * 0.6;
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(e.x, e.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ─── Vignette effect (darken edges) ───────────────────────────────────
  const vigGrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
  vigGrad.addColorStop(0, "transparent");
  vigGrad.addColorStop(1, "rgba(15, 23, 42, 0.35)");
  ctx.fillStyle = vigGrad;
  ctx.fillRect(0, 0, W, H);

  // ─── Atmospheric haze (health-dependent) ──────────────────────────────
  if (vh < 40) {
    ctx.globalAlpha = (1 - vh / 40) * 0.2;
    ctx.fillStyle = "#8b5a2b";
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
// UI CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const SPECIES = [
  { type: WOLF, icon: "🐺", label: "Wolves", key: "wolves", color: "#94a3b8", desc: "Apex predator. Controls elk, suppresses coyotes." },
  { type: ELK, icon: "🦌", label: "Elk", key: "elk", color: "#a78bfa", desc: "Primary herbivore. Grazes willows and aspens." },
  { type: HUNTER, icon: "🎯", label: "Hunters", key: "hunters", color: "#ef4444", desc: "Removes wolves and elk. Disrupts natural balance." },
  { type: TREE, icon: "🌲", label: "Trees", key: "trees", color: "#22c55e", desc: "Willows & aspens. Stabilize riverbanks." },
  { type: BEAVER, icon: "🦫", label: "Beavers", key: "beavers", color: "#fb923c", desc: "Build dams from willows. Create wetland habitat." },
  { type: COYOTE, icon: "🐾", label: "Coyotes", key: "coyotes", color: "#d97706", desc: "Mesopredator. Boom without wolf suppression." },
  { type: FISH, icon: "🐟", label: "Fish", key: "fish", color: "#67e8f9", desc: "Need cool, shaded, stable water." },
  { type: BIRD, icon: "🐦", label: "Songbirds", key: "birds", color: "#fbbf24", desc: "Need mature trees for nesting." },
  { type: RABBIT, icon: "🐰", label: "Rabbits", key: "rabbits", color: "#d1d5db", desc: "Prey for coyotes. Population indicator." },
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
  const [canvasSize, setCanvasSize] = useState({ w: 1280, h: 720 });
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState({ wolves: 12, elk: 45, trees: 90, beavers: 8, coyotes: 10, fish: 22, birds: 15, rabbits: 28, hunters: 0, vegetationHealth: 85, riverHealth: 90 });
  const [history, setHistory] = useState([]);
  const [score, setScore] = useState(75);
  const [alerts, setAlerts] = useState([]);
  const [selectedTool, setSelectedTool] = useState(WOLF);
  const [toolMode, setToolMode] = useState("add");
  const [chartTab, setChartTab] = useState("predprey");
  const [showHelp, setShowHelp] = useState(true);
  const [showChart, setShowChart] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

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

  // Init ecosystem when canvas size is known
  useEffect(() => {
    if (!ecoRef.current && canvasSize.w > 0) {
      ecoRef.current = initEcosystem(canvasSize.w, canvasSize.h);
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
    setAlerts(getCascadeAlerts(eco.stats));
    animRef.current = requestAnimationFrame(loop);
  }, [speed]);

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

    if (toolMode === "add") {
      eco.entities.push(createEntity(selectedTool, x, y, eco.W, eco.H));
    } else {
      let bestI = -1, bestD = 35;
      for (let i = 0; i < eco.entities.length; i++) {
        const ent = eco.entities[i];
        if (ent.type !== selectedTool || !ent.alive) continue;
        const d = dist({ x, y }, ent);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI >= 0) eco.entities[bestI].alive = false;
    }

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
    ecoRef.current = initEcosystem(canvasSize.w, canvasSize.h);
    const eco = ecoRef.current;
    setStats(eco.stats);
    setHistory([]);
    setScore(75);
    setAlerts([]);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.clearRect(0, 0, eco.W, eco.H); renderEcosystem(ctx, eco); }
  };

  const handlePreset = (preset) => {
    handleReset();
    const eco = ecoRef.current;
    if (!eco) return;
    const { W: cw, H: ch } = eco;
    if (preset === "noWolves") {
      eco.entities = eco.entities.filter(e => e.type !== WOLF);
      for (let i = 0; i < 35; i++) eco.entities.push(createEntity(ELK, null, null, cw, ch));
    } else if (preset === "heavyHunting") {
      for (let i = 0; i < 12; i++) eco.entities.push(createEntity(HUNTER, null, null, cw, ch));
    } else if (preset === "recovery") {
      eco.entities = eco.entities.filter(e => e.type !== WOLF);
      eco.entities = eco.entities.filter(e => {
        if (e.type === TREE) return Math.random() > 0.6;
        if (e.type === BEAVER) return Math.random() > 0.8;
        if (e.type === BIRD) return Math.random() > 0.7;
        if (e.type === FISH) return Math.random() > 0.6;
        return true;
      });
      for (let i = 0; i < 45; i++) eco.entities.push(createEntity(ELK, null, null, cw, ch));
      for (let i = 0; i < 18; i++) eco.entities.push(createEntity(COYOTE, null, null, cw, ch));
      eco.vegetationHealth = 25; eco.riverHealth = 30;
      for (let i = 0; i < 14; i++) eco.entities.push(createEntity(WOLF, null, null, cw, ch));
    }
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.clearRect(0, 0, eco.W, eco.H); renderEcosystem(ctx, eco); }
    recountStats(eco);
  };

  const selectedInfo = SPECIES.find(s => s.type === selectedTool);

  // ─── STYLES ──────────────────────────────────────────────────────────
  const S = {
    root: { width: "100vw", height: "100vh", display: "flex", flexDirection: "column", background: "#0a0f1a", overflow: "hidden", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: "#e2e8f0", position: "relative" },
    topBar: { display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", background: "#0f172a", borderBottom: "1px solid #1e293b", flexShrink: 0, height: 40, zIndex: 10 },
    main: { flex: 1, display: "flex", overflow: "hidden", position: "relative", minHeight: 0 },
    panel: { width: panelCollapsed ? 44 : 200, background: "#0f172a", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", flexShrink: 0, transition: "width 0.2s ease", overflow: "hidden", zIndex: 5 },
    canvasWrap: { flex: 1, position: "relative", overflow: "hidden", minHeight: 0, minWidth: 0 },
    btn: (active, color) => ({ padding: "4px 12px", borderRadius: 6, border: active ? `1px solid ${color}` : "1px solid #334155", background: active ? `${color}20` : "transparent", color: active ? color : "#94a3b8", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }),
    btnSolid: (bg) => ({ padding: "6px 14px", borderRadius: 6, border: "none", background: bg, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }),
  };

  return (
    <div style={S.root}>
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

        {/* Sim controls */}
        <button onClick={() => setRunning(!running)} style={S.btnSolid(running ? "#dc2626" : "#16a34a")}>
          {running ? "⏸ Pause" : "▶ Run"}
        </button>
        <button onClick={handleReset} style={S.btn(false, "#64748b")}>Reset</button>

        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#475569" }}>Speed</span>
          {[1, 2, 4].map(s => (
            <button key={s} onClick={() => setSpeed(s)} style={{ ...S.btn(speed === s, "#eab308"), padding: "2px 8px", fontSize: 10 }}>{s}x</button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Scenarios */}
        <span style={{ fontSize: 10, color: "#475569" }}>Scenarios:</span>
        <button onClick={() => handlePreset("balanced")} style={S.btn(false, "#22c55e")}>Balanced</button>
        <button onClick={() => handlePreset("noWolves")} style={S.btn(false, "#ef4444")}>No Wolves</button>
        <button onClick={() => handlePreset("heavyHunting")} style={S.btn(false, "#f97316")}>Heavy Hunt</button>
        <button onClick={() => handlePreset("recovery")} style={S.btn(false, "#3b82f6")}>Recovery</button>

        <button onClick={() => setShowChart(!showChart)} style={S.btn(showChart, "#60a5fa")}>📊</button>
        <button onClick={() => setShowHelp(true)} style={S.btn(false, "#64748b")}>?</button>
      </div>

      {/* ═══ MAIN AREA ═══ */}
      <div style={S.main}>
        {/* ─── Left Panel ─── */}
        <div style={S.panel}>
          <button onClick={() => setPanelCollapsed(!panelCollapsed)} style={{ background: "transparent", border: "none", color: "#64748b", padding: "8px", cursor: "pointer", fontSize: 14, textAlign: "center" }}>
            {panelCollapsed ? "▸" : "◂"}
          </button>

          {!panelCollapsed && (
            <>
              {/* Mode toggle */}
              <div style={{ display: "flex", margin: "0 8px 6px", borderRadius: 6, overflow: "hidden", border: "1px solid #334155" }}>
                {["add", "remove"].map(mode => (
                  <button key={mode} onClick={() => setToolMode(mode)} style={{
                    flex: 1, padding: "5px 0", border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer",
                    background: toolMode === mode ? (mode === "add" ? "#166534" : "#991b1b") : "#1e293b",
                    color: toolMode === mode ? "#fff" : "#64748b",
                  }}>
                    {mode === "add" ? "+ Add" : "- Remove"}
                  </button>
                ))}
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

        {/* ─── Canvas ─── */}
        <div ref={containerRef} style={S.canvasWrap}>
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            onClick={handleCanvasClick}
            style={{ display: "block", cursor: toolMode === "add" ? "crosshair" : "pointer", imageRendering: "crisp-edges" }}
          />

          {/* Tool cursor label */}
          <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(15,23,42,0.88)", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#94a3b8", pointerEvents: "none", border: "1px solid #334155" }}>
            {toolMode === "add" ? "+" : "-"} {selectedInfo?.icon} {selectedInfo?.label}
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
      </div>

      {/* ═══ HELP MODAL ═══ */}
      {showHelp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setShowHelp(false)}>
          <div style={{ background: "#1e293b", borderRadius: 16, padding: 28, maxWidth: 540, margin: 20, border: "1px solid #334155" }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 12px", background: "linear-gradient(135deg, #60a5fa, #34d399)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Yellowstone Trophic Cascade
            </h2>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: "#cbd5e1" }}>
              <p style={{ margin: "0 0 10px" }}><strong>Your goal:</strong> Achieve ecosystem balance (score 85+) by managing species populations.</p>
              <p style={{ margin: "0 0 10px" }}><strong>Select a species</strong> from the left panel, choose <strong>Add</strong> or <strong>Remove</strong>, then <strong>click the ecosystem</strong> to place or remove them.</p>
              <p style={{ margin: "0 0 10px" }}><strong>Hit Run</strong> and watch the cascade unfold. Wolves hunt elk, elk graze trees, trees stabilize rivers, rivers support fish and beavers. Remove wolves and the whole system unravels.</p>
              <p style={{ margin: "0 0 10px" }}><strong>Try the scenarios</strong> to see historical events play out, then experiment with your own interventions.</p>
              <p style={{ margin: "0 0 8px", padding: "8px 12px", background: "#0f172a", borderRadius: 8, fontSize: 12 }}>
                <strong style={{ color: "#60a5fa" }}>The Cascade:</strong> Wolves → Elk → Vegetation → Rivers → Beavers/Fish/Songbirds
                <br />
                <strong style={{ color: "#f97316" }}>Side Effect:</strong> No wolves → Coyote boom → Rabbit/bird decline
              </p>
            </div>
            <button onClick={() => setShowHelp(false)} style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #16a34a, #0d9488)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", marginTop: 8 }}>
              Start Exploring
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
