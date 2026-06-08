// screens/prototype.js
// "The Hollow" — a small walkable enchanted-forest vibe slice.
//
// Demonstrates the signature SECOND SIGHT mechanic: hold SPACE and the world
// shifts to an ethereal tint, the darkness lifts, and hidden spirits, runes,
// and paths that are invisible to normal eyes fade into view — fuelled by a
// vision meter you recharge by stepping on glowing mushrooms.
//
// Pure Canvas2D, driven by the shared game loop. Camera-culled, no per-frame
// allocations in the hot path — built to hold 60fps.

import { ParticlePool } from '../engine/renderer.js';
import { addSystem, removeSystem, addRenderSystem, removeRenderSystem, getFPS, isFPSVisible } from '../engine/game-loop.js';

// ── World tuning ────────────────────────────────────────────────────────────────
const WORLD_W = 2800;
const WORLD_H = 2000;
const PLAYER_SPEED = 165;        // px/sec
const SIGHT_DRAIN  = 0.26;       // energy/sec while active  (~3.8s from full)
const SIGHT_REGEN  = 0.045;      // passive trickle/sec when off
const PICKUP_DIST   = 44;
const SHROOM_RESPAWN = 13;       // sec for a drained charger-shroom to bloom again

// ── State ────────────────────────────────────────────────────────────────────────
let pool = null, updateFn = null, renderFn = null, onExit = null;
let clock = 0, lastFPS = -1, lastVisionPct = -1;

const player = { x: WORLD_W * 0.5, y: WORLD_H * 0.62, bob: 0, moving: false };
const cam = { x: 0, y: 0 };
let energy = 1;          // 0..1 vision meter
let sightFactor = 0;     // smoothed 0..1 (drives all the visuals)

const keys = new Set();

// World objects (generated once at init)
let trees = [], mushrooms = [], ferns = [], runes = [], spirits = [], clearings = [];
let pathPts = [];

// ── Init / destroy ───────────────────────────────────────────────────────────────
export function initPrototype(exitCb) {
  onExit = exitCb;
  const canvas = document.getElementById('proto-canvas');
  if (!canvas) return;

  pool = new ParticlePool(canvas, 500);
  _generateWorld();

  player.x = WORLD_W * 0.5;
  player.y = WORLD_H * 0.62;
  energy = 1; sightFactor = 0; clock = 0; lastVisionPct = -1;

  updateFn = (dt) => _update(dt);
  renderFn = () => { if (pool) _draw(pool.W, pool.H); };
  addSystem(updateFn);
  addRenderSystem(renderFn);

  window.addEventListener('keydown', _onKeyDown);
  window.addEventListener('keyup', _onKeyUp);
  document.getElementById('proto-back')?.addEventListener('click', _exit);
}

export function destroyPrototype() {
  if (updateFn) removeSystem(updateFn);
  if (renderFn) removeRenderSystem(renderFn);
  if (pool) pool.destroy();
  window.removeEventListener('keydown', _onKeyDown);
  window.removeEventListener('keyup', _onKeyUp);
  document.getElementById('proto-back')?.removeEventListener('click', _exit);
  keys.clear();
  pool = null; updateFn = null; renderFn = null; onExit = null;
  trees = []; mushrooms = []; ferns = []; runes = []; spirits = []; clearings = []; pathPts = [];
}

function _exit() { if (onExit) onExit(); }

// ── Input ────────────────────────────────────────────────────────────────────────
function _onKeyDown(e) {
  const k = e.key.toLowerCase();
  if (k === 'escape') { _exit(); return; }
  if (k === ' ' || k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') e.preventDefault();
  keys.add(k === ' ' ? 'space' : k);
}
function _onKeyUp(e) {
  const k = e.key.toLowerCase();
  keys.delete(k === ' ' ? 'space' : k);
}

// ── World generation ──────────────────────────────────────────────────────────────
function _rand(a, b) { return a + Math.random() * (b - a); }

function _generateWorld() {
  trees = []; mushrooms = []; ferns = []; runes = []; spirits = []; clearings = []; pathPts = [];

  // Soft lighter clearings in the moss
  for (let i = 0; i < 7; i++) {
    clearings.push({ x: _rand(200, WORLD_W - 200), y: _rand(200, WORLD_H - 200), r: _rand(220, 420) });
  }

  // A meandering path of waypoints across the world
  let px = 180, py = _rand(WORLD_H * 0.3, WORLD_H * 0.7);
  while (px < WORLD_W - 160) {
    pathPts.push({ x: px, y: py });
    px += _rand(170, 240);
    py += _rand(-150, 150);
    py = Math.max(220, Math.min(WORLD_H - 220, py));
  }
  // Glowing runes scattered along the path (hidden to normal sight)
  for (let i = 0; i < pathPts.length; i++) {
    if (i % 1 === 0) runes.push({ x: pathPts[i].x + _rand(-30, 30), y: pathPts[i].y + _rand(-30, 30), ph: _rand(0, 6.28), s: _rand(12, 20) });
  }

  // Trees — kept off the path centre so walking feels open
  for (let i = 0; i < 90; i++) {
    const x = _rand(60, WORLD_W - 60), y = _rand(80, WORLD_H - 60);
    if (_nearPath(x, y, 120)) continue;
    trees.push({ x, y, r: _rand(34, 64), tone: _rand(0, 1) });
  }
  trees.sort((a, b) => a.y - b.y);

  // Ferns — small bioluminescent shrubs
  for (let i = 0; i < 120; i++) {
    ferns.push({ x: _rand(40, WORLD_W - 40), y: _rand(60, WORLD_H - 40), s: _rand(10, 22), ph: _rand(0, 6.28), tint: Math.random() < 0.5 });
  }

  // Mushrooms — most decorative; some are "charger" shrooms that refill Sight
  const PALETTE = [[94, 234, 212], [130, 240, 200], [180, 150, 240], [255, 214, 120]];
  for (let i = 0; i < 46; i++) {
    const col = PALETTE[(Math.random() * PALETTE.length) | 0];
    const charger = i % 6 === 0; // ~8 chargers
    mushrooms.push({
      x: _rand(60, WORLD_W - 60), y: _rand(80, WORLD_H - 60),
      s: charger ? _rand(16, 22) : _rand(8, 15),
      r: charger ? 255 : col[0], g: charger ? 214 : col[1], b: charger ? 120 : col[2],
      ph: _rand(0, 6.28), charger, charged: true, respawnAt: 0,
    });
  }

  // Hidden spirits — only visible through Second Sight
  const cast = [
    { name: 'MYCEL, THE WHISPERER', line: '“You found the sight… few ever do.”' },
    { name: 'THE LOST WARDEN', line: '“I have guarded this path for a hundred winters.”' },
    { name: 'A FORGOTTEN CHILD', line: '“Will you stay and play awhile?”' },
    { name: 'THE MOSS KING', line: '“The Hollow remembers every footstep.”' },
    { name: 'EMBERWISP', line: '“Follow the runes. They lead somewhere true.”' },
  ];
  for (let i = 0; i < cast.length; i++) {
    let x, y, tries = 0;
    do { x = _rand(300, WORLD_W - 300); y = _rand(300, WORLD_H - 300); tries++; }
    while (tries < 20 && !_nearPath(x, y, 260));
    spirits.push({ x, y, ph: _rand(0, 6.28), name: cast[i].name, line: cast[i].line, hue: i });
  }
}

function _nearPath(x, y, dist) {
  for (const p of pathPts) {
    if ((p.x - x) ** 2 + (p.y - y) ** 2 < dist * dist) return true;
  }
  return false;
}

// ── Update ────────────────────────────────────────────────────────────────────────
function _update(dt) {
  if (!pool) return;
  clock += dt;
  const W = pool.W, H = pool.H;

  // FPS readout
  const fpsEl = document.getElementById('fps-counter');
  if (fpsEl && isFPSVisible()) {
    const cur = getFPS();
    if (cur !== lastFPS) { fpsEl.textContent = `${cur} FPS`; lastFPS = cur; }
  }

  // Movement (normalised diagonal)
  let dx = 0, dy = 0;
  if (keys.has('w') || keys.has('arrowup'))    dy -= 1;
  if (keys.has('s') || keys.has('arrowdown'))  dy += 1;
  if (keys.has('a') || keys.has('arrowleft'))  dx -= 1;
  if (keys.has('d') || keys.has('arrowright')) dx += 1;
  player.moving = (dx !== 0 || dy !== 0);
  if (player.moving) {
    const inv = 1 / Math.hypot(dx, dy);
    player.x += dx * inv * PLAYER_SPEED * dt;
    player.y += dy * inv * PLAYER_SPEED * dt;
    player.x = Math.max(40, Math.min(WORLD_W - 40, player.x));
    player.y = Math.max(40, Math.min(WORLD_H - 40, player.y));
    player.bob += dt * 9;
  }

  // Second Sight energy
  const want = keys.has('space') && energy > 0.001;
  if (want) energy = Math.max(0, energy - SIGHT_DRAIN * dt);
  else      energy = Math.min(1, energy + SIGHT_REGEN * dt);
  sightFactor += ((want ? 1 : 0) - sightFactor) * Math.min(1, dt * 6);

  // Charger-shroom pickups
  for (const m of mushrooms) {
    if (!m.charger) continue;
    if (!m.charged) { if (clock >= m.respawnAt) m.charged = true; continue; }
    if ((m.x - player.x) ** 2 + (m.y - player.y) ** 2 < PICKUP_DIST * PICKUP_DIST) {
      energy = 1; m.charged = false; m.respawnAt = clock + SHROOM_RESPAWN;
      // little burst
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * 6.28, sp = Math.random() * 2 + 0.5;
        pool.emitOne({
          x: (m.x - cam.x), y: (m.y - cam.y),
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.5,
          size: Math.random() * 5 + 2, life: 1, decay: 1.2 + Math.random(),
          r: 255, g: 214, b: 120, shape: 3,
        });
      }
    }
  }

  // Camera follows player, clamped to the world
  const tx = Math.max(0, Math.min(WORLD_W - W, player.x - W / 2));
  const ty = Math.max(0, Math.min(WORLD_H - H, player.y - H / 2));
  cam.x += (tx - cam.x) * Math.min(1, dt * 6);
  cam.y += (ty - cam.y) * Math.min(1, dt * 6);

  // Ambient motes (screen space). More — and violet — under Second Sight.
  const rate = 0.18 + sightFactor * 0.5;
  if (Math.random() < rate) {
    const violet = sightFactor > 0.4 && Math.random() < 0.5;
    const mint = Math.random() < 0.5;
    pool.emitOne({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.15, vy: -(Math.random() * 0.2 + 0.03),
      size: Math.random() * 3 + 1, life: 1, decay: 0.25 + Math.random() * 0.3,
      r: violet ? 180 : (mint ? 130 : 255),
      g: violet ? 150 : (mint ? 240 : 214),
      b: violet ? 240 : (mint ? 200 : 120),
      shape: Math.random() < 0.6 ? 3 : 0,
    });
  }

  pool.update(dt);

  // Vision meter (throttled DOM write)
  const pct = Math.round(energy * 100);
  if (pct !== lastVisionPct) {
    const fill = document.getElementById('proto-vision-fill');
    if (fill) fill.style.width = pct + '%';
    lastVisionPct = pct;
  }
}

// ── Render ────────────────────────────────────────────────────────────────────────
function _draw(W, H) {
  const ctx = pool.ctx, dpr = pool._dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const s = sightFactor;
  const t = clock;

  // ── World space ──
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(-cam.x, -cam.y);
  const vx0 = cam.x - 80, vy0 = cam.y - 80, vx1 = cam.x + W + 80, vy1 = cam.y + H + 80;
  const vis = (x, y, pad = 0) => x > vx0 - pad && x < vx1 + pad && y > vy0 - pad && y < vy1 + pad;

  // Ground base
  ctx.fillStyle = '#091410';
  ctx.fillRect(cam.x, cam.y, W, H);

  // Soft clearings
  for (const c of clearings) {
    if (!vis(c.x, c.y, c.r)) continue;
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
    g.addColorStop(0, 'rgba(30,64,42,0.5)');
    g.addColorStop(1, 'rgba(30,64,42,0)');
    ctx.fillStyle = g;
    ctx.fillRect(c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
  }

  // Path (faint dirt always; glows softly under sight)
  if (pathPts.length > 1) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(120,140,96,${0.10 + s * 0.18})`;
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.moveTo(pathPts[0].x, pathPts[0].y);
    for (let i = 1; i < pathPts.length; i++) ctx.lineTo(pathPts[i].x, pathPts[i].y);
    ctx.stroke();
  }

  // Runes along the path — mostly hidden, blaze under Second Sight
  const runeA = 0.05 + s * 0.85;
  for (const r of runes) {
    if (!vis(r.x, r.y, 30)) continue;
    const pulse = 0.6 + 0.4 * Math.sin(t * 2 + r.ph);
    const a = runeA * pulse;
    if (a < 0.02) continue;
    const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.s);
    g.addColorStop(0, `rgba(94,234,212,${a})`);
    g.addColorStop(1, 'rgba(94,234,212,0)');
    ctx.fillStyle = g;
    ctx.fillRect(r.x - r.s, r.y - r.s, r.s * 2, r.s * 2);
    ctx.strokeStyle = `rgba(150,255,230,${a})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.s * 0.5, 0, 6.2832);
    ctx.moveTo(r.x - r.s * 0.4, r.y); ctx.lineTo(r.x + r.s * 0.4, r.y);
    ctx.moveTo(r.x, r.y - r.s * 0.4); ctx.lineTo(r.x, r.y + r.s * 0.4);
    ctx.stroke();
  }

  // Ferns
  for (const f of ferns) {
    if (!vis(f.x, f.y, f.s)) continue;
    const sway = Math.sin(t * 1.3 + f.ph) * 0.25;
    ctx.strokeStyle = '#163a24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let b = -2; b <= 2; b++) {
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(f.x + b * f.s * 0.32 + sway * f.s, f.y - f.s);
    }
    ctx.stroke();
    // bioluminescent tip
    const ta = (f.tint ? 0.25 : 0.12) + s * 0.6;
    ctx.fillStyle = `rgba(${f.tint ? '120,240,200' : '94,234,212'},${ta})`;
    ctx.beginPath();
    ctx.arc(f.x + sway * f.s, f.y - f.s, 1.8, 0, 6.2832);
    ctx.fill();
  }

  // Mushrooms (glow boosted by sight + gentle pulse)
  for (const m of mushrooms) {
    if (!vis(m.x, m.y, m.s * 3)) continue;
    const lit = m.charger ? (m.charged ? 1 : 0.12) : 1;
    const pulse = 0.7 + 0.3 * Math.sin(t * (m.charger ? 3 : 1.6) + m.ph);
    const glowA = (0.12 + s * 0.5) * lit * pulse + (m.charger && m.charged ? 0.25 * pulse : 0);
    const gr = m.s * (m.charger ? 3.2 : 2.2);
    const g = ctx.createRadialGradient(m.x, m.y - m.s, 0, m.x, m.y - m.s, gr);
    g.addColorStop(0, `rgba(${m.r},${m.g},${m.b},${glowA})`);
    g.addColorStop(1, `rgba(${m.r},${m.g},${m.b},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(m.x - gr, m.y - m.s - gr, gr * 2, gr * 2);
    // stem + cap
    ctx.fillStyle = 'rgba(214,224,210,0.5)';
    ctx.fillRect(m.x - m.s * 0.14, m.y - m.s * 0.8, m.s * 0.28, m.s * 0.8);
    ctx.fillStyle = `rgba(${m.r},${m.g},${m.b},${0.55 + lit * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(m.x, m.y - m.s * 0.8, m.s * 0.7, m.s * 0.5, 0, Math.PI, 0);
    ctx.fill();
  }

  // Trees (static y-sorted) with the player slotted in by depth
  let playerDrawn = false;
  for (const tr of trees) {
    if (!playerDrawn && tr.y > player.y) { _drawPlayer(ctx, t); playerDrawn = true; }
    if (!vis(tr.x, tr.y, tr.r * 2)) continue;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(tr.x, tr.y + 4, tr.r * 0.7, tr.r * 0.22, 0, 0, 6.2832);
    ctx.fill();
    // trunk
    ctx.fillStyle = '#241a12';
    ctx.fillRect(tr.x - tr.r * 0.12, tr.y - tr.r * 0.9, tr.r * 0.24, tr.r * 0.9);
    // canopy
    const base = tr.tone < 0.5 ? '20,52,32' : '26,62,40';
    ctx.fillStyle = `rgb(${base})`;
    ctx.beginPath();
    ctx.arc(tr.x, tr.y - tr.r, tr.r, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = 'rgba(60,110,72,0.5)';
    ctx.beginPath();
    ctx.arc(tr.x - tr.r * 0.3, tr.y - tr.r * 1.25, tr.r * 0.55, 0, 6.2832);
    ctx.fill();
  }
  if (!playerDrawn) _drawPlayer(ctx, t);

  // Spirits — revealed by Second Sight
  if (s > 0.02) {
    for (const sp of spirits) {
      if (!vis(sp.x, sp.y, 80)) continue;
      _drawSpirit(ctx, sp, s, t);
    }
  }

  // ── Screen space overlays ──
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pSX = player.x - cam.x, pSY = player.y - cam.y;

  // Darkness / lantern mask: one radial gradient, transparent over the player
  // and clamped to a dark alpha past rOut (so screen corners stay dark) — this
  // darkens the world without erasing it. Second Sight widens the reveal.
  const rIn  = 90 + s * 230;
  const rOut = 320 + s * 380;
  const edge = 0.93 - s * 0.46;
  const dg = ctx.createRadialGradient(pSX, pSY, rIn, pSX, pSY, rOut);
  dg.addColorStop(0, 'rgba(2,5,3,0)');
  dg.addColorStop(1, `rgba(2,5,3,${edge})`);
  ctx.fillStyle = dg;
  ctx.fillRect(0, 0, W, H);

  // Warm lantern tint inside the ring
  const lg = ctx.createRadialGradient(pSX, pSY, 0, pSX, pSY, rIn * 1.5);
  lg.addColorStop(0, `rgba(255,196,110,${0.12 - s * 0.06})`);
  lg.addColorStop(1, 'rgba(255,196,110,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, W, H);

  // Particles (fireflies)
  pool.draw();

  // Second Sight colour wash + vignette
  if (s > 0.01) {
    ctx.globalCompositeOperation = 'screen';
    const tg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    tg.addColorStop(0, `rgba(60,150,150,${0.10 * s})`);
    tg.addColorStop(0.6, `rgba(70,90,170,${0.12 * s})`);
    tg.addColorStop(1, `rgba(120,80,190,${0.18 * s})`);
    ctx.fillStyle = tg;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Spirit names/whispers (screen space text)
  if (s > 0.25) {
    ctx.textAlign = 'center';
    for (const sp of spirits) {
      const sx = sp.x - cam.x, sy = sp.y - cam.y;
      if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) continue;
      const near = (sp.x - player.x) ** 2 + (sp.y - player.y) ** 2 < 220 * 220;
      ctx.globalAlpha = (s - 0.25) / 0.75;
      ctx.fillStyle = '#c9f5ec';
      ctx.font = '700 12px Orbitron, sans-serif';
      ctx.shadowColor = 'rgba(45,212,191,0.9)'; ctx.shadowBlur = 10;
      ctx.fillText(sp.name, sx, sy - 58);
      ctx.shadowBlur = 0;
      if (near) {
        ctx.fillStyle = 'rgba(220,235,228,0.85)';
        ctx.font = 'italic 12px Inter, sans-serif';
        ctx.fillText(sp.line, sx, sy - 40);
      }
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  }
}

// ── Player & spirit sprites ─────────────────────────────────────────────────────
function _drawPlayer(ctx, t) {
  const x = player.x;
  const bob = player.moving ? Math.sin(player.bob) * 2 : Math.sin(t * 1.5) * 1;
  const y = player.y + bob;

  // ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(player.x, player.y + 6, 11, 4, 0, 0, 6.2832);
  ctx.fill();

  // cloak body
  ctx.fillStyle = '#16302a';
  ctx.beginPath();
  ctx.moveTo(x - 11, y + 6);
  ctx.quadraticCurveTo(x, y - 6, x + 11, y + 6);
  ctx.lineTo(x + 8, y + 8);
  ctx.lineTo(x - 8, y + 8);
  ctx.closePath();
  ctx.fill();
  // hood
  ctx.fillStyle = '#1d3d34';
  ctx.beginPath();
  ctx.arc(x, y - 9, 7, 0, 6.2832);
  ctx.fill();
  ctx.fillStyle = 'rgba(10,18,16,0.9)';
  ctx.beginPath();
  ctx.arc(x, y - 8, 4, 0, 6.2832);
  ctx.fill();

  // lantern (warm point of light at the side)
  const lx = x + 12, ly = y - 2;
  const lf = 0.7 + 0.3 * Math.sin(t * 6);
  const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 16);
  g.addColorStop(0, `rgba(255,210,130,${0.9 * lf})`);
  g.addColorStop(1, 'rgba(255,210,130,0)');
  ctx.fillStyle = g;
  ctx.fillRect(lx - 16, ly - 16, 32, 32);
  ctx.fillStyle = '#ffe39a';
  ctx.beginPath();
  ctx.arc(lx, ly, 2.2, 0, 6.2832);
  ctx.fill();
}

function _drawSpirit(ctx, sp, s, t) {
  const bob = Math.sin(t * 1.2 + sp.ph) * 5;
  const x = sp.x, y = sp.y + bob;
  const a = Math.min(1, (s - 0.02) / 0.4) * (0.75 + 0.25 * Math.sin(t * 2 + sp.ph));

  // aura
  const g = ctx.createRadialGradient(x, y - 14, 0, x, y - 14, 54);
  g.addColorStop(0, `rgba(120,220,210,${0.32 * a})`);
  g.addColorStop(0.5, `rgba(110,150,230,${0.14 * a})`);
  g.addColorStop(1, 'rgba(110,150,230,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 54, y - 68, 108, 108);

  // body (tapering wisp)
  ctx.fillStyle = `rgba(200,240,235,${0.5 * a})`;
  ctx.beginPath();
  ctx.moveTo(x, y - 34);
  ctx.quadraticCurveTo(x + 14, y - 18, x + 9, y + 6);
  ctx.quadraticCurveTo(x, y + 16, x - 9, y + 6);
  ctx.quadraticCurveTo(x - 14, y - 18, x, y - 34);
  ctx.fill();
  // head
  ctx.fillStyle = `rgba(225,250,245,${0.8 * a})`;
  ctx.beginPath();
  ctx.arc(x, y - 32, 7, 0, 6.2832);
  ctx.fill();
  // eyes
  ctx.fillStyle = `rgba(60,120,140,${a})`;
  ctx.beginPath();
  ctx.arc(x - 2.4, y - 32, 1.1, 0, 6.2832);
  ctx.arc(x + 2.4, y - 32, 1.1, 0, 6.2832);
  ctx.fill();
}
