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
// CANVAS RENDERER — Enhanced Graphics
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

  // ─── Sky gradient ─────────────────────────────────────────────────────
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.3);
  skyGrad.addColorStop(0, "#0c1220");
  skyGrad.addColorStop(1, "transparent");
  ctx.fillStyle = "#0c1520";
  ctx.fillRect(0, 0, W, H);

  // ─── Mountain range background ────────────────────────────────────────
  ctx.fillStyle = "#1a2535";
  ctx.beginPath();
  ctx.moveTo(MX, H);
  for (let x = MX; x <= W; x += 3) {
    const pct = (x - MX) / (W - MX);
    const peak = H * 0.15 + Math.sin(pct * 4 + 1) * H * 0.12 + Math.sin(pct * 9) * H * 0.04;
    ctx.lineTo(x, peak);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // Snow caps
  ctx.fillStyle = "rgba(226, 232, 240, 0.25)";
  ctx.beginPath();
  ctx.moveTo(MX, H);
  for (let x = MX; x <= W; x += 3) {
    const pct = (x - MX) / (W - MX);
    const peak = H * 0.15 + Math.sin(pct * 4 + 1) * H * 0.12 + Math.sin(pct * 9) * H * 0.04;
    ctx.lineTo(x, peak);
  }
  for (let x = W; x >= MX; x -= 3) {
    const pct = (x - MX) / (W - MX);
    const peak = H * 0.15 + Math.sin(pct * 4 + 1) * H * 0.12 + Math.sin(pct * 9) * H * 0.04;
    ctx.lineTo(x, peak + H * 0.04);
  }
  ctx.closePath();
  ctx.fill();

  // ─── Ground — meadow ─────────────────────────────────────────────────
  const meadowColor = lerpColor("#2a3018", "#2d5a2e", vf);
  const meadowGrad = ctx.createRadialGradient(W * 0.25, H * 0.5, 0, W * 0.25, H * 0.5, W * 0.4);
  meadowGrad.addColorStop(0, lerpColor("#2a3018", "#3a6a3e", vf));
  meadowGrad.addColorStop(1, meadowColor);
  ctx.fillStyle = meadowGrad;
  ctx.fillRect(0, 0, RX - rw / 2, H);

  // ─── Ground — forest side ────────────────────────────────────────────
  ctx.fillStyle = lerpColor("#1e2518", "#1e3a1f", vf);
  ctx.fillRect(RX + rw / 2, 0, MX - RX - rw / 2, H);

  // ─── River with glow ─────────────────────────────────────────────────
  // River glow
  const glowGrad = ctx.createLinearGradient(RX - rw, 0, RX + rw, 0);
  glowGrad.addColorStop(0, "transparent");
  glowGrad.addColorStop(0.3, `rgba(37, 99, 235, ${0.08 + rh * 0.002})`);
  glowGrad.addColorStop(0.5, `rgba(37, 99, 235, ${0.15 + rh * 0.003})`);
  glowGrad.addColorStop(0.7, `rgba(37, 99, 235, ${0.08 + rh * 0.002})`);
  glowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(RX - rw, 0, rw * 2, H);

  // River water
  const rc = rh > 50 ? "#1d4ed8" : "#60a5fa";
  const riverGrad = ctx.createLinearGradient(RX - rw / 2, 0, RX + rw / 2, 0);
  riverGrad.addColorStop(0, lerpColor("#0f172a", rc, 0.5));
  riverGrad.addColorStop(0.5, rc);
  riverGrad.addColorStop(1, lerpColor("#0f172a", rc, 0.5));
  ctx.fillStyle = riverGrad;
  ctx.fillRect(RX - rw / 2, 0, rw, H);

  // River shimmer/ripples
  ctx.strokeStyle = `rgba(147, 197, 253, ${0.12 + rh * 0.003})`;
  ctx.lineWidth = 0.6;
  for (let y = -10; y < H + 10; y += 14) {
    ctx.beginPath();
    const phase = tick * 0.025 + y * 0.08;
    for (let dy = 0; dy < 12; dy += 2) {
      const sx = RX + Math.sin(phase + dy * 0.5) * (rw * 0.25);
      ctx.lineTo(sx, y + dy);
    }
    ctx.stroke();
  }

  // ─── Grass detail ─────────────────────────────────────────────────────
  if (vf > 0.15) {
    ctx.globalAlpha = vf * 0.4;
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 0.8;
    for (let i = 0; i < Math.floor(80 * vf); i++) {
      const gx = (i * 137.508) % (W * 0.78) + 10;
      const gy = (i * 89.33 + 17) % (H - 20) + 10;
      if (Math.abs(gx - RX) < rw / 2 + 8) continue;
      if (gx > MX) continue;
      const sway = Math.sin(tick * 0.015 + gx * 0.05) * 1.5;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + sway - 1, gy - 5 * vf);
      ctx.moveTo(gx + 3, gy);
      ctx.lineTo(gx + 3 + sway + 1.5, gy - 4 * vf);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ─── Entities sorted by depth ─────────────────────────────────────────
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
      case BEAVER: drawBeaver(ctx, e); break;
      case COYOTE: drawCoyote(ctx, e, tick); break;
      case FISH: drawFish(ctx, e, tick); break;
      case BIRD: drawBird(ctx, e); break;
      case RABBIT: drawRabbit(ctx, e, tick); break;
      case HUNTER: drawHunter(ctx, e, tick); break;
    }
    ctx.restore();
  }

  // ─── Particle effects for dead entities ───────────────────────────────
  for (const e of eco.entities) {
    if (e.alive || e.type === TREE) continue;
    const fade = 1 - e.age / 60;
    if (fade <= 0) continue;
    ctx.globalAlpha = fade * 0.5;
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(e.x, e.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ─── Drawing Functions (enhanced) ───────────────────────────────────────────

function drawTree(ctx, tree, vf, tick) {
  const s = tree.growth;
  const h = 10 + s * 20;
  const w = 5 + s * 14;
  const healthy = tree.health > 50;
  const sway = Math.sin(tick * 0.008 + tree.x * 0.03) * s * 1.5;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(tree.x + 4, tree.y + 3, w * 0.4 * s, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Trunk
  ctx.fillStyle = healthy ? "#5c3c10" : "#3d2a0a";
  const tw = 1.5 + s * 1.5;
  ctx.fillRect(tree.x - tw / 2 + sway * 0.3, tree.y - h * 0.35, tw, h * 0.45);

  // Canopy layers for depth
  const baseGreen = healthy
    ? lerpColor("#166534", "#22c55e", s * vf)
    : lerpColor("#854d0e", "#a16207", s);
  const darkGreen = healthy
    ? lerpColor("#14532d", "#166534", s * vf)
    : lerpColor("#713f12", "#854d0e", s);

  // Bottom canopy layer
  ctx.fillStyle = darkGreen;
  ctx.beginPath();
  ctx.ellipse(tree.x + sway, tree.y - h * 0.38, w / 2 + 1, h * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();

  // Top canopy layer
  ctx.fillStyle = baseGreen;
  ctx.beginPath();
  ctx.ellipse(tree.x + sway, tree.y - h * 0.5, w / 2 - 1, h * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  // Highlight
  if (healthy && s > 0.5) {
    ctx.fillStyle = `rgba(74, 222, 128, ${0.15 * s})`;
    ctx.beginPath();
    ctx.ellipse(tree.x + sway - 2, tree.y - h * 0.55, w * 0.2, h * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWolf(ctx, wolf, tick) {
  const facing = wolf.vx >= 0 ? 1 : -1;
  ctx.translate(wolf.x, wolf.y);
  ctx.scale(facing, 1);

  const isRunning = wolf.state === "chase" || wolf.state === "flee";
  const legPhase = isRunning ? Math.sin(wolf.age * 0.3) * 5 : Math.sin(wolf.age * 0.08) * 2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(0, 6, 8, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail
  ctx.strokeStyle = "#6b7280";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-8, -2);
  ctx.quadraticCurveTo(-13, -9, -11, -13);
  ctx.stroke();

  // Legs
  ctx.strokeStyle = "#4b5563";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-4, 3); ctx.lineTo(-4 + legPhase, 9);
  ctx.moveTo(0, 3); ctx.lineTo(0 - legPhase * 0.7, 9);
  ctx.moveTo(4, 3); ctx.lineTo(4 + legPhase * 0.5, 9);
  ctx.stroke();

  // Body
  const bodyGrad = ctx.createRadialGradient(0, -2, 0, 0, -2, 10);
  bodyGrad.addColorStop(0, "#9ca3af");
  bodyGrad.addColorStop(1, "#4b5563");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, -2, 9, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = "#9ca3af";
  ctx.beginPath();
  ctx.ellipse(8, -5, 4.5, 4, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // Muzzle
  ctx.fillStyle = "#d1d5db";
  ctx.beginPath();
  ctx.ellipse(11, -4, 2.5, 2, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.fillStyle = "#6b7280";
  ctx.beginPath();
  ctx.moveTo(7, -9); ctx.lineTo(5, -14); ctx.lineTo(4, -8); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, -9); ctx.lineTo(12, -14); ctx.lineTo(9, -8); ctx.fill();

  // Inner ears
  ctx.fillStyle = "#9ca3af";
  ctx.beginPath();
  ctx.moveTo(7.5, -9); ctx.lineTo(5.5, -12); ctx.lineTo(5, -8.5); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, -9); ctx.lineTo(11.5, -12); ctx.lineTo(9.5, -8.5); ctx.fill();

  // Eye - glowing amber
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.arc(9.5, -5.5, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(9.8, -5.5, 0.6, 0, Math.PI * 2);
  ctx.fill();

  // State indicator
  if (wolf.state === "chase") {
    ctx.fillStyle = "rgba(239, 68, 68, 0.6)";
    ctx.beginPath();
    ctx.arc(0, -14, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawElk(ctx, elk, tick) {
  const facing = elk.vx >= 0 ? 1 : -1;
  ctx.translate(elk.x, elk.y);
  ctx.scale(facing, 1);

  const isRunning = elk.state === "flee";
  const lp = isRunning ? Math.sin(elk.age * 0.3) * 6 : Math.sin(elk.age * 0.06) * 2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 9, 10, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-6, 3); ctx.lineTo(-6 + lp, 11);
  ctx.moveTo(-1, 3); ctx.lineTo(-1 - lp * 0.5, 11);
  ctx.moveTo(4, 3); ctx.lineTo(4 + lp * 0.5, 11);
  ctx.moveTo(8, 3); ctx.lineTo(8 - lp * 0.3, 11);
  ctx.stroke();

  // Hooves
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  [-6 + lp, -1 - lp * 0.5, 4 + lp * 0.5, 8 - lp * 0.3].forEach((hx, i) => {
    ctx.moveTo(hx + 1.5, 11);
    ctx.arc(hx, 11, 1.5, 0, Math.PI * 2);
  });
  ctx.fill();

  // Body
  const bodyGrad = ctx.createRadialGradient(0, -2, 0, 0, -2, 12);
  bodyGrad.addColorStop(0, "#b45309");
  bodyGrad.addColorStop(1, "#78350f");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, -2, 12, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Lighter belly
  ctx.fillStyle = "rgba(180, 130, 80, 0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 2, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Neck
  ctx.fillStyle = "#92400e";
  ctx.beginPath();
  ctx.moveTo(8, -5);
  ctx.quadraticCurveTo(12, -12, 10, -14);
  ctx.quadraticCurveTo(8, -12, 7, -5);
  ctx.fill();

  // Head
  ctx.fillStyle = "#78350f";
  ctx.beginPath();
  ctx.ellipse(10, -14, 4, 3.5, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // Antlers
  ctx.strokeStyle = "#e7e5e4";
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(10, -17);
  ctx.lineTo(7, -24); ctx.moveTo(7, -21); ctx.lineTo(4, -23);
  ctx.moveTo(10, -17);
  ctx.lineTo(14, -24); ctx.moveTo(14, -21); ctx.lineTo(17, -23);
  ctx.moveTo(7, -22); ctx.lineTo(5, -26);
  ctx.moveTo(14, -22); ctx.lineTo(16, -26);
  ctx.stroke();

  // Eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(12, -14, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath();
  ctx.arc(12.3, -14.3, 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Grazing indicator
  if (elk.state === "graze") {
    ctx.fillStyle = "rgba(34, 197, 94, 0.5)";
    ctx.beginPath();
    ctx.arc(12, 0, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBeaver(ctx, e) {
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.ellipse(e.x + 2, e.y + 4, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Flat tail
  ctx.fillStyle = "#6d3a0a";
  ctx.beginPath();
  ctx.ellipse(e.x - 7, e.y + 1, 5, 2, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Body
  const bg = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 6);
  bg.addColorStop(0, "#a0522d");
  bg.addColorStop(1, "#78350f");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(e.x + 3.5, e.y - 1, 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Teeth
  ctx.fillStyle = "#fef3c7";
  ctx.fillRect(e.x + 4.5, e.y + 0.5, 1, 2);
  ctx.fillRect(e.x + 6, e.y + 0.5, 1, 2);
}

function drawCoyote(ctx, e, tick) {
  const facing = e.vx >= 0 ? 1 : -1;
  ctx.translate(e.x, e.y);
  ctx.scale(facing, 1);

  const lp = Math.sin(e.age * 0.15) * 3;

  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.ellipse(0, 5, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.strokeStyle = "#b45309";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-3, 2.5); ctx.lineTo(-3 + lp, 7);
  ctx.moveTo(3, 2.5); ctx.lineTo(3 - lp, 7);
  ctx.stroke();

  // Tail
  ctx.strokeStyle = "#d97706";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-5, -1);
  ctx.quadraticCurveTo(-10, -6, -8, -9);
  ctx.stroke();

  // Body
  ctx.fillStyle = "#d97706";
  ctx.beginPath();
  ctx.ellipse(0, -1, 7, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = "#b45309";
  ctx.beginPath();
  ctx.ellipse(6, -3.5, 3.5, 3, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Pointy snout
  ctx.fillStyle = "#ca8a04";
  ctx.beginPath();
  ctx.moveTo(8, -3);
  ctx.lineTo(11, -2.5);
  ctx.lineTo(8, -1.5);
  ctx.fill();

  // Ears
  ctx.fillStyle = "#92400e";
  ctx.beginPath();
  ctx.moveTo(5, -7); ctx.lineTo(4, -11); ctx.lineTo(3, -6); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, -7); ctx.lineTo(9, -11); ctx.lineTo(7, -6); ctx.fill();

  // Eye
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(7, -4, 0.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawFish(ctx, e, tick) {
  const phase = Math.sin(tick * 0.05 + e.id.charCodeAt(0)) * 2;
  ctx.globalAlpha = 0.75;

  // Body
  const fg = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 5);
  fg.addColorStop(0, "#a5f3fc");
  fg.addColorStop(1, "#0891b2");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, 5, 2.5, phase * 0.05, 0, Math.PI * 2);
  ctx.fill();

  // Tail
  ctx.fillStyle = "#67e8f9";
  ctx.beginPath();
  ctx.moveTo(e.x - 5, e.y);
  ctx.lineTo(e.x - 8, e.y - 3);
  ctx.lineTo(e.x - 8, e.y + 3);
  ctx.closePath();
  ctx.fill();

  // Eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(e.x + 2.5, e.y - 0.5, 0.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

function drawBird(ctx, e) {
  const wing = Math.sin(e.flutterPhase) * 5;
  const bob = Math.sin(e.flutterPhase * 0.7) * 1.5;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.1)";
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + 8, 3, 1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + bob, 3.5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc(e.x + 2.5, e.y - 1.5 + bob, 2, 0, Math.PI * 2);
  ctx.fill();

  // Beak
  ctx.fillStyle = "#92400e";
  ctx.beginPath();
  ctx.moveTo(e.x + 4, e.y - 1.5 + bob);
  ctx.lineTo(e.x + 6.5, e.y - 1 + bob);
  ctx.lineTo(e.x + 4, e.y - 0.5 + bob);
  ctx.fill();

  // Wings
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(e.x - 2, e.y + bob);
  ctx.quadraticCurveTo(e.x - 5, e.y - wing + bob, e.x - 7, e.y - wing * 0.5 + bob);
  ctx.moveTo(e.x + 1, e.y + bob);
  ctx.quadraticCurveTo(e.x + 4, e.y - wing + bob, e.x + 5, e.y - wing * 0.5 + bob);
  ctx.stroke();

  // Eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(e.x + 3, e.y - 2 + bob, 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawRabbit(ctx, e, tick) {
  const hop = e.state === "flee" ? Math.abs(Math.sin(e.age * 0.3)) * 3 : 0;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + 4, 4, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = "#d1d5db";
  ctx.beginPath();
  ctx.ellipse(e.x, e.y - hop, 4.5, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = "#e5e7eb";
  ctx.beginPath();
  ctx.arc(e.x + 3, e.y - 2 - hop, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.fillStyle = "#d1d5db";
  ctx.beginPath();
  ctx.ellipse(e.x + 1.5, e.y - 7 - hop, 1.2, 3.5, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(e.x + 3.5, e.y - 7 - hop, 1.2, 3.5, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // Inner ears
  ctx.fillStyle = "#fecaca";
  ctx.beginPath();
  ctx.ellipse(e.x + 1.5, e.y - 7 - hop, 0.6, 2, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(e.x + 3.5, e.y - 7 - hop, 0.6, 2, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // Cotton tail
  ctx.fillStyle = "#f3f4f6";
  ctx.beginPath();
  ctx.arc(e.x - 4, e.y - hop, 2, 0, Math.PI * 2);
  ctx.fill();

  // Eye
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(e.x + 4.2, e.y - 2.5 - hop, 0.7, 0, Math.PI * 2);
  ctx.fill();
}

function drawHunter(ctx, e, tick) {
  ctx.translate(e.x, e.y);
  const lp = Math.sin(e.age * 0.06) * 2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(0, 10, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.strokeStyle = "#5c4a2d";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-2, 4); ctx.lineTo(-2 + lp, 10);
  ctx.moveTo(2, 4); ctx.lineTo(2 - lp, 10);
  ctx.stroke();

  // Boots
  ctx.fillStyle = "#3d2a0a";
  ctx.fillRect(-4, 9, 4, 2);
  ctx.fillRect(0, 9, 4, 2);

  // Body — red jacket
  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.roundRect(-4, -6, 8, 11, 2);
  ctx.fill();

  // Arms
  ctx.strokeStyle = "#b91c1c";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-4, -3); ctx.lineTo(-7, 1);
  ctx.moveTo(4, -3); ctx.lineTo(12, -5);
  ctx.stroke();

  // Rifle
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(4, -3);
  ctx.lineTo(16, -7);
  ctx.stroke();
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(4, -3);
  ctx.lineTo(10, -5);
  ctx.stroke();

  // Head
  ctx.fillStyle = "#fed7aa";
  ctx.beginPath();
  ctx.arc(0, -10, 4.5, 0, Math.PI * 2);
  ctx.fill();

  // Hat
  ctx.fillStyle = "#991b1b";
  ctx.fillRect(-6, -15, 12, 4);
  ctx.fillRect(-4, -17, 8, 3);

  // Face
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(-1.5, -10.5, 0.8, 0, Math.PI * 2);
  ctx.arc(1.5, -10.5, 0.8, 0, Math.PI * 2);
  ctx.fill();

  // Danger aura
  ctx.strokeStyle = `rgba(239, 68, 68, ${0.3 + Math.sin(tick * 0.05) * 0.15})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, -3, 20, 0, Math.PI * 2);
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
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function Simulation() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const ecoRef = useRef(null);
  const animRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ w: 960, h: 540 });
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

  // Responsive canvas sizing
  useEffect(() => {
    function resize() {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      setCanvasSize({ w, h });
      if (ecoRef.current) {
        ecoRef.current.W = w;
        ecoRef.current.H = h;
      }
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Init ecosystem when canvas size is known
  useEffect(() => {
    if (!ecoRef.current) {
      ecoRef.current = initEcosystem(canvasSize.w, canvasSize.h);
      // Initial render
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) renderEcosystem(ctx, ecoRef.current);
    }
  }, [canvasSize]);

  const loop = useCallback(() => {
    const eco = ecoRef.current;
    if (!eco) return;
    for (let i = 0; i < speed; i++) tickEcosystem(eco);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
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
    if (!eco) return;
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
      ctx.clearRect(0, 0, eco.W, eco.H);
      renderEcosystem(ctx, eco);
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
    topBar: { display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "#0f172a", borderBottom: "1px solid #1e293b", flexShrink: 0, zIndex: 10, flexWrap: "wrap" },
    main: { flex: 1, display: "flex", overflow: "hidden", position: "relative" },
    panel: { width: panelCollapsed ? 44 : 200, background: "#0f172a", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", flexShrink: 0, transition: "width 0.2s ease", overflow: "hidden", zIndex: 5 },
    canvasWrap: { flex: 1, position: "relative", overflow: "hidden" },
    btn: (active, color) => ({ padding: "4px 12px", borderRadius: 6, border: active ? `1px solid ${color}` : "1px solid #334155", background: active ? `${color}20` : "transparent", color: active ? color : "#94a3b8", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }),
    btnSolid: (bg) => ({ padding: "6px 16px", borderRadius: 6, border: "none", background: bg, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }),
  };

  return (
    <div style={S.root}>
      {/* ═══ TOP BAR ═══ */}
      <div style={S.topBar}>
        <div style={{ fontSize: 14, fontWeight: 800, background: "linear-gradient(135deg, #60a5fa, #34d399)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginRight: 8 }}>
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

        <div style={{ display: "flex", gap: 2, alignItems: "center", marginLeft: 4 }}>
          <span style={{ fontSize: 10, color: "#475569" }}>Speed</span>
          {[1, 2, 4].map(s => (
            <button key={s} onClick={() => setSpeed(s)} style={{ ...S.btn(speed === s, "#eab308"), padding: "2px 8px", fontSize: 10 }}>{s}x</button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Scenarios */}
        <span style={{ fontSize: 10, color: "#475569" }}>Scenarios:</span>
        <button onClick={() => handlePreset("balanced")} style={S.btn(false, "#22c55e")}>Balanced</button>
        <button onClick={() => handlePreset("noWolves")} style={S.btn(false, "#ef4444")}>No Wolves (1926)</button>
        <button onClick={() => handlePreset("heavyHunting")} style={S.btn(false, "#f97316")}>Heavy Hunting</button>
        <button onClick={() => handlePreset("recovery")} style={S.btn(false, "#3b82f6")}>1995 Recovery</button>

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
            style={{ width: "100%", height: "100%", display: "block", cursor: toolMode === "add" ? "crosshair" : "pointer" }}
          />

          {/* Tool cursor label */}
          <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(15,23,42,0.85)", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#94a3b8", pointerEvents: "none" }}>
            {toolMode === "add" ? "+" : "-"} {selectedInfo?.icon} {selectedInfo?.label} · Click to {toolMode}
          </div>

          {/* Alerts overlay */}
          {alerts.length > 0 && (
            <div style={{ position: "absolute", bottom: 8, left: 8, maxWidth: 350, pointerEvents: "none" }}>
              {alerts.slice(0, 3).map((a, i) => (
                <div key={i} style={{
                  background: a.sev === "crit" ? "rgba(69,10,10,0.92)" : "rgba(66,32,6,0.92)",
                  border: `1px solid ${a.sev === "crit" ? "#dc2626" : "#ca8a04"}`,
                  borderRadius: 8, padding: "6px 10px", marginBottom: 4, backdropFilter: "blur(4px)",
                }}>
                  <span style={{ fontWeight: 700, fontSize: 11 }}>{a.icon} {a.title}</span>
                  <span style={{ fontSize: 10, color: "#d6d3d1", marginLeft: 6 }}>{a.msg}</span>
                </div>
              ))}
            </div>
          )}

          {/* Chart overlay */}
          {showChart && (
            <div style={{ position: "absolute", top: 8, right: 8, width: 340, background: "rgba(15,23,42,0.92)", borderRadius: 10, padding: 12, border: "1px solid #334155", backdropFilter: "blur(6px)" }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                {[
                  { key: "predprey", label: "Predator/Prey" },
                  { key: "habitat", label: "Habitat" },
                  { key: "balance", label: "Score" },
                ].map(t => (
                  <button key={t.key} onClick={() => setChartTab(t.key)} style={{
                    padding: "3px 8px", borderRadius: 5, border: "none", fontSize: 10, fontWeight: 600, cursor: "pointer",
                    background: chartTab === t.key ? "#334155" : "transparent", color: chartTab === t.key ? "#fff" : "#64748b",
                  }}>{t.label}</button>
                ))}
                <div style={{ flex: 1 }} />
                <button onClick={() => setShowChart(false)} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>
              <div style={{ height: 160 }}>
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
