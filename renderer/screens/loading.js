// screens/loading.js
// GPU-accelerated loading screen — canvas-only bloon parade, hex grid, energy bar
// Zero DOM animation, single game loop system

import { ParticlePool, drawBloon } from '../engine/renderer.js';
import { addSystem, removeSystem, addRenderSystem, removeRenderSystem, getFPS, isFPSVisible } from '../engine/game-loop.js';

// ── Tips ──────────────────────────────────────────────────────────────────────
const TIPS = [
  'Place towers near bends in the path for maximum dart coverage!',
  'Some bloons are immune to certain attack types — upgrade wisely!',
  'Your hero gains XP every round — keep them on the field!',
  'Combining overlapping tower ranges creates deadly kill zones.',
  'Crystal Bloons refract energy attacks — use physical projectiles.',
  'The Void Bloon absorbs magic — pierce it with titanium darts.',
  'Round 100 boss: The Mega Leviathan Bloon. You have been warned.',
  'Farming for cash in early rounds snowballs your late-game power.',
  'Upgrade monkeys before placing new ones for better value.',
  'Co-op allows you to share the upgrade path with a teammate!',
  'Thornward features 12 unique monkey classes never seen before.',
  'The Phantom Bloon is invisible until hit — area-of-effect towers are key!',
];

const LOAD_STEPS = [
  'Initializing game engine…',
  'Loading bloon definitions…',
  'Calibrating tower upgrade trees…',
  'Generating map terrain data…',
  'Warming up GPU particle pipeline…',
  'Loading monkey roster…',
  'Compiling render shaders…',
  'Syncing hero ability trees…',
  'Preloading audio buffers…',
  'Preparing map selection UI…',
  'Finalizing asset cache…',
  'Almost ready…',
];

const BLOON_DEFS = [
  { r: 231, g: 76,  b: 60  },
  { r: 52,  g: 152, b: 219 },
  { r: 39,  g: 174, b: 96  },
  { r: 243, g: 156, b: 18  },
  { r: 155, g: 89,  b: 182 },
  { r: 230, g: 126, b: 34  },
  { r: 26,  g: 188, b: 156 },
  { r: 253, g: 121, b: 168 },
];

// ── State ─────────────────────────────────────────────────────────────────────
let pool      = null;
let updateFn  = null;
let renderFn  = null;
let elapsedT  = 0;
let progress  = 0; // 0..100
let lastFPS   = -1;
let targetPct = 0;
let stepIdx   = 0;
let tipIdx    = 0;
let nextTip   = 3;
let resolved  = false;
let onDoneCb  = null;

// Bloon parade — canvas-drawn conveyor belt across bottom
const PARADE_MAX   = 10;
const paradeX      = new Float32Array(PARADE_MAX);
const paradeY      = new Float32Array(PARADE_MAX);
const paradeType   = new Uint8Array(PARADE_MAX);
const paradeSize   = new Float32Array(PARADE_MAX);
const paradeSpeed  = new Float32Array(PARADE_MAX);
const paradeBob    = new Float32Array(PARADE_MAX);

// Cached geometry of the progress bar track (avoids per-frame layout reflow).
// Invalidated on resize and re-read lazily once the element has a real size.
let barTrackRect = null;
let onResize = null;

// ── Init ──────────────────────────────────────────────────────────────────────
export function initLoading(onComplete) {
  const canvas = document.getElementById('loading-canvas');
  pool = new ParticlePool(canvas, 800);
  elapsedT  = 0;
  progress  = 0;
  targetPct = 0;
  stepIdx   = 0;
  tipIdx    = 0;
  nextTip   = 3;
  resolved  = false;
  onDoneCb  = onComplete;

  // Init parade
  for (let i = 0; i < PARADE_MAX; i++) _resetParade(i, true);

  // Set initial tip
  const tipEl = document.getElementById('loading-tip-text');
  if (tipEl) tipEl.textContent = TIPS[0];

  // Invalidate cached bar geometry on resize
  barTrackRect = null;
  onResize = () => { barTrackRect = null; };
  window.addEventListener('resize', onResize);

  // Register fixed-step update + once-per-frame render
  updateFn = (dt) => _update(dt);
  renderFn = () => { if (pool) _draw(pool.W, pool.H); };
  addSystem(updateFn);
  addRenderSystem(renderFn);

  // Run fake loading sequence
  _runLoadSequence();
}

export function destroyLoading() { _cleanup(); }

function _cleanup() {
  if (updateFn) removeSystem(updateFn);
  if (renderFn) removeRenderSystem(renderFn);
  if (onResize) window.removeEventListener('resize', onResize);
  if (pool) pool.destroy();
  updateFn = null;
  renderFn = null;
  onResize = null;
  pool     = null;
}

// ── Load sequence ─────────────────────────────────────────────────────────────
async function _runLoadSequence() {
  // Preload real assets
  const realAssets = [
    { name: 'Game Logo',       src: 'assets/images/game_logo.png' },
    { name: 'Menu Background', src: 'assets/images/menu_bg.png'   },
  ];

  const total = realAssets.length + LOAD_STEPS.length;
  let done = 0;

  for (const asset of realAssets) {
    await new Promise(r => {
      const img = new Image();
      img.onload = img.onerror = r;
      img.src = asset.src;
    });
    done++;
    targetPct = (done / total) * 100;
    _setStatus(`Loading ${asset.name}…`);
    await _wait(60);
  }

  for (const step of LOAD_STEPS) {
    await _wait(100 + Math.random() * 140);
    done++;
    targetPct = (done / total) * 100;
    _setStatus(step);
  }

  await _wait(300);
  targetPct = 100;
  _setStatus('Ready!');
  await _wait(500);

  resolved = true;
  // Teardown is handled by the onComplete callback (destroyLoading()).
  if (onDoneCb) onDoneCb();
}

function _setStatus(text) {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = text;
}

function _wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Update (fixed timestep) ─────────────────────────────────────────────────────
function _update(dt) {
  if (!pool || resolved) return;
  elapsedT += dt;

  // Update FPS counter
  const fpsEl = document.getElementById('fps-counter');
  if (fpsEl && isFPSVisible()) {
    const current = getFPS();
    if (current !== lastFPS) {
      fpsEl.textContent = `${current} FPS`;
      lastFPS = current;
    }
  }
  const W = pool.W;
  const H = pool.H;

  // Smooth progress bar
  progress += (targetPct - progress) * dt * 4;
  if (Math.abs(progress - targetPct) < 0.5) progress = targetPct;

  // Update DOM progress
  const fill = document.getElementById('loading-bar-fill');
  const pctEl = document.getElementById('loading-pct');
  if (fill) fill.style.width = `${progress}%`;
  if (pctEl) pctEl.textContent = `${Math.round(progress)}%`;

  // Rotate tips
  if (elapsedT > nextTip) {
    nextTip = elapsedT + 3.5;
    tipIdx = (tipIdx + 1) % TIPS.length;
    const tipEl = document.getElementById('loading-tip-text');
    if (tipEl) {
      tipEl.style.transition = 'opacity 0.25s, transform 0.25s';
      tipEl.style.opacity = '0';
      tipEl.style.transform = 'translateY(6px)';
      setTimeout(() => {
        tipEl.textContent = TIPS[tipIdx];
        tipEl.style.opacity = '1';
        tipEl.style.transform = 'translateY(0)';
      }, 260);
    }
  }

  // Spawn bar energy particles along the filling edge.
  // Uses cached track geometry + the progress value so we never call
  // getBoundingClientRect (which would force a layout reflow every step).
  if (progress > 2) {
    if (!barTrackRect || barTrackRect.width === 0) {
      const trackEl = document.getElementById('loading-bar-track');
      const r = trackEl ? trackEl.getBoundingClientRect() : null;
      if (r && r.width > 0) barTrackRect = r;
    }
    if (barTrackRect) {
      const ex = barTrackRect.left + barTrackRect.width * (progress / 100);
      const ey = barTrackRect.top + barTrackRect.height * 0.5;

      // Emit glowing energy sparks from the filling edge
      const count = Math.random() < 0.5 ? 4 : 6;
      for (let i = 0; i < count; i++) {
        const shapeType = Math.random() < 0.4 ? 3 : (Math.random() < 0.2 ? 1 : 0); // 3=glow, 1=star, 0=circle
        const angle = (Math.random() - 0.5) * Math.PI;
        const speed = Math.random() * 2 + 1;
        
        // Forest firefly palette matching the progress gradient (mint to gold)
        const gold = Math.random() < 0.5;
        const rVal = gold ? 245 : 52;
        const gVal = gold ? 200 : 211;
        const bVal = gold ? 90  : 153;

        pool.emitOne({
          x: ex + (Math.random() - 0.5) * 4,
          y: ey + (Math.random() - 0.5) * 8,
          vx: Math.cos(angle) * speed * 0.5 + (Math.random() * 0.5),
          vy: Math.sin(angle) * speed - 0.5,
          size: Math.random() * 5 + 2,
          life: 1.0,
          decay: 1.2 + Math.random() * 1.5,
          r: rVal,
          g: gVal,
          b: bVal,
          gravity: 0.08,
          rotation: Math.random() * 6.28,
          spin: (Math.random() - 0.5) * 2,
          shape: shapeType,
        });
      }
    }
  }

  // Update parade
  for (let i = 0; i < PARADE_MAX; i++) {
    paradeX[i] += paradeSpeed[i] * dt * 60;
    paradeBob[i] += dt * 2;
    if (paradeX[i] > W + 50) _resetParade(i, false);
  }

  // Update particles
  pool.update(dt);
}

// ── Render (once per frame) ─────────────────────────────────────────────────────
// The canvas is transparent and composites on top of the forest background image
// (DOM layer behind it), so we only draw the ambient fireflies + bloon parade.
function _draw(W, H) {
  if (!pool) return;
  const ctx = pool.ctx;
  const dpr = pool._dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Ambient particles (energy sparks / fireflies)
  pool.draw();

  // Bloon parade drifting along the forest path
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const paradeY0 = H - 55;
  for (let i = 0; i < PARADE_MAX; i++) {
    const def = BLOON_DEFS[paradeType[i]];
    const by = paradeY0 + Math.sin(paradeBob[i]) * 6;
    drawBloon(ctx, paradeX[i], by, paradeSize[i], def.r, def.g, def.b, 0.6);
  }
}

function _resetParade(i, seed) {
  const W = pool?.W ?? 1440;
  paradeX[i] = seed ? Math.random() * W : -(20 + Math.random() * 60);
  paradeType[i] = (Math.random() * BLOON_DEFS.length) | 0;
  paradeSize[i] = 14 + Math.random() * 12;
  paradeSpeed[i] = 0.6 + Math.random() * 0.8;
  paradeBob[i] = Math.random() * 6.28;
}
