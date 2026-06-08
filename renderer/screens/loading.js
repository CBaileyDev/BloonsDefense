// screens/loading.js
// GPU-accelerated loading screen — canvas-only bloon parade, hex grid, energy bar
// Zero DOM animation, single game loop system

import { ParticlePool, drawBloon } from '../engine/renderer.js';
import { addSystem, removeSystem, getFPS, isFPSVisible } from '../engine/game-loop.js';

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
  'Bloons Reborn features 12 unique monkey classes never seen before.',
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
let systemFn  = null;
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

// Hex grid state
let hexPhase = 0;

// ── Init ──────────────────────────────────────────────────────────────────────
export async function initLoading(onComplete) {
  const canvas = document.getElementById('loading-canvas');
  pool = new ParticlePool(canvas, 800);
  elapsedT  = 0;
  progress  = 0;
  targetPct = 0;
  stepIdx   = 0;
  tipIdx    = 0;
  nextTip   = 3;
  resolved  = false;
  hexPhase  = 0;
  onDoneCb  = onComplete;

  // Init parade
  for (let i = 0; i < PARADE_MAX; i++) _resetParade(i, true);

  // Set initial tip
  const tipEl = document.getElementById('loading-tip-text');
  if (tipEl) tipEl.textContent = TIPS[0];

  // Register system
  systemFn = (dt) => _tick(dt);
  addSystem(systemFn);

  // Run fake loading sequence
  _runLoadSequence();
}

export function destroyLoading() { _cleanup(); }

function _cleanup() {
  if (systemFn) removeSystem(systemFn);
  if (pool) pool.destroy();
  systemFn = null;
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
  _cleanup();
  if (onDoneCb) onDoneCb();
}

function _setStatus(text) {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = text;
}

function _wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Tick ───────────────────────────────────────────────────────────────────────
function _tick(dt) {
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
  hexPhase += dt;

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

  // Spawn bar energy particles along progress fill
  if (progress > 2) {
    const barEl = document.getElementById('loading-bar-fill');
    if (barEl) {
      const barRect = barEl.getBoundingClientRect();
      const ex = barRect.right;
      const ey = barRect.top + 5;
      
      // Emit glowing energy sparks from the filling edge
      const count = Math.random() < 0.5 ? 4 : 6;
      for (let i = 0; i < count; i++) {
        const shapeType = Math.random() < 0.4 ? 3 : (Math.random() < 0.2 ? 1 : 0); // 3=glow, 1=star, 0=circle
        const angle = (Math.random() - 0.5) * Math.PI;
        const speed = Math.random() * 2 + 1;
        
        // Color palette matching the loading progress gradient (purple to cyan)
        const rVal = Math.random() < 0.5 ? 6 : 124;
        const gVal = Math.random() < 0.5 ? 182 : 58;
        const bVal = Math.random() < 0.5 ? 212 : 237;

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

  // Draw
  _draw(W, H);
}

function _draw(W, H) {
  const ctx = pool.ctx;
  const dpr = pool._dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // A. Background
  const bg = ctx.createLinearGradient(0, 0, W * 0.3, H);
  bg.addColorStop(0, '#08081a');
  bg.addColorStop(0.5, '#0d0b2a');
  bg.addColorStop(1, '#08081a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // B. Hex grid
  _drawHexGrid(ctx, W, H);

  // C. Center glow
  ctx.globalAlpha = 0.15;
  const cg = ctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.4, 300);
  cg.addColorStop(0, 'rgba(124,58,237,0.4)');
  cg.addColorStop(0.5, 'rgba(6,182,212,0.15)');
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // D. Particles
  pool.draw();

  // E. Bloon parade at bottom
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const paradeY0 = H - 55;
  for (let i = 0; i < PARADE_MAX; i++) {
    const def = BLOON_DEFS[paradeType[i]];
    const by = paradeY0 + Math.sin(paradeBob[i]) * 6;
    drawBloon(ctx, paradeX[i], by, paradeSize[i], def.r, def.g, def.b, 0.6);
  }

  // F. Scanline overlay
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 4) {
    ctx.fillRect(0, y, W, 2);
  }
  ctx.globalAlpha = 1;
}

function _drawHexGrid(ctx, W, H) {
  ctx.save();
  
  // Pulse frequency speeds up as loading progress completes
  const pulseFreq = 1.5 + (progress / 100) * 3.5;
  const pulseFactor = Math.sin(hexPhase * pulseFreq);
  
  // Shift color from purple (124, 58, 237) to cyan (6, 182, 212) based on progress
  const ratio = progress / 100;
  const rColor = Math.round(124 * (1 - ratio) + 6 * ratio);
  const gColor = Math.round(58 * (1 - ratio) + 182 * ratio);
  const bColor = Math.round(237 * (1 - ratio) + 212 * ratio);
  
  // Pulse opacity in sync with progress percentage
  const minAlpha = 0.04;
  const maxAlpha = 0.04 + ratio * 0.12;
  const baseAlpha = minAlpha + (pulseFactor * 0.5 + 0.5) * (maxAlpha - minAlpha);

  const hexR = 40;
  const hexW = hexR * 2;
  const hexH = Math.sqrt(3) * hexR;
  const cols = Math.ceil(W / (hexW * 0.75)) + 2;
  const rows = Math.ceil(H / hexH) + 2;
  const scrollY = (hexPhase * 15) % hexH;

  // Energy sweep wave position moving top-to-bottom across the screen
  const sweepY = (hexPhase * 180) % (H + 300) - 150;

  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      const ox = col * hexW * 0.75;
      const oy = row * hexH + (col % 2 ? hexH * 0.5 : 0) - scrollY;
      
      // Calculate distance from this cell to the energy sweep wave front
      const dist = Math.abs(oy - sweepY);
      const sweepHighlight = dist < 160 ? (1 - dist / 160) : 0;
      const finalAlpha = Math.min(1.0, baseAlpha + sweepHighlight * 0.28);
      
      ctx.strokeStyle = `rgba(${rColor},${gColor},${bColor},${finalAlpha})`;
      ctx.lineWidth = 0.5 + sweepHighlight * 1.5;
      
      _hexPath(ctx, ox, oy, hexR);
      ctx.stroke();
      
      // Add glowing grid cell fill when the energy wave sweeps past
      if (sweepHighlight > 0.05) {
        ctx.fillStyle = `rgba(${rColor},${gColor},${bColor},${sweepHighlight * 0.04})`;
        ctx.fill();
      }
    }
  }
  
  // Draw the bright visual line of the energy sweep wave itself
  const sweepGrad = ctx.createLinearGradient(0, sweepY - 30, 0, sweepY + 30);
  sweepGrad.addColorStop(0, `rgba(${rColor},${gColor},${bColor},0)`);
  sweepGrad.addColorStop(0.5, `rgba(${rColor},${gColor},${bColor},${0.18 + ratio * 0.15})`);
  sweepGrad.addColorStop(1, `rgba(${rColor},${gColor},${bColor},0)`);
  ctx.fillStyle = sweepGrad;
  ctx.fillRect(0, sweepY - 30, W, 60);

  ctx.restore();
}

function _hexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(ang);
    const y = cy + r * Math.sin(ang);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function _resetParade(i, seed) {
  const W = pool?.W ?? 1440;
  paradeX[i] = seed ? Math.random() * W : -(20 + Math.random() * 60);
  paradeType[i] = (Math.random() * BLOON_DEFS.length) | 0;
  paradeSize[i] = 14 + Math.random() * 12;
  paradeSpeed[i] = 0.6 + Math.random() * 0.8;
  paradeBob[i] = Math.random() * 6.28;
}
