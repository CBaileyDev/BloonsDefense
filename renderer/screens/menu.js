// screens/menu.js
// Main menu — GPU canvas bloons, parallax via canvas transform, no backdrop-filter

import { ParticlePool, drawBloon } from '../engine/renderer.js';
import { addSystem, removeSystem, getFPS, isFPSVisible, toggleFPS } from '../engine/game-loop.js';

// ── Floating bloons (canvas) ──────────────────────────────────────────────────
const BLOON_DEFS = [
  { r: 231, g: 76,  b: 60  },
  { r: 52,  g: 152, b: 219 },
  { r: 39,  g: 174, b: 96  },
  { r: 243, g: 156, b: 18  },
  { r: 155, g: 89,  b: 182 },
  { r: 230, g: 126, b: 34  },
  { r: 26,  g: 188, b: 156 },
  { r: 253, g: 121, b: 168 },
  { r: 108, g: 92,  b: 231 },
  { r: 162, g: 155, b: 254 },
];

const MAX_FLOATERS = 18;
const fX     = new Float32Array(MAX_FLOATERS);
const fY     = new Float32Array(MAX_FLOATERS);
const fVx    = new Float32Array(MAX_FLOATERS);
const fVy    = new Float32Array(MAX_FLOATERS);
const fSize  = new Float32Array(MAX_FLOATERS);
const fType  = new Uint8Array(MAX_FLOATERS);
const fPhase = new Float32Array(MAX_FLOATERS);
const fAlpha = new Float32Array(MAX_FLOATERS);

let pool        = null;
let systemFn    = null;
let elapsedT    = 0;
let toastTimeout = null;
let lastFPS     = -1;

// Parallax
let mouseX = 0.5, mouseY = 0.5;
let smoothX = 0.5, smoothY = 0.5;

// ── Init ──────────────────────────────────────────────────────────────────────
export function initMenu() {
  // Canvas overlay for floating bloons + ambient particles
  const canvas = document.getElementById('menu-canvas');
  if (canvas) {
    pool = new ParticlePool(canvas, 600);

    // Init floaters
    for (let i = 0; i < MAX_FLOATERS; i++) _resetFloater(i, true);

    systemFn = (dt) => _tick(dt);
    addSystem(systemFn);
  }

  // Parallax mouse tracking (via CSS transform on bg image, not canvas)
  document.getElementById('screen-menu')?.addEventListener('mousemove', _onMouse);

  _initSettings();
  _initFullscreen();
  _initNavButtons();
  _initPlatformBadge();
  _initNewsTicker();
}

export function destroyMenu() {
  if (systemFn) removeSystem(systemFn);
  if (pool) pool.destroy();
  document.getElementById('screen-menu')?.removeEventListener('mousemove', _onMouse);

  // Clean up nav button tilt listeners
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    if (btn._onMouseMove) btn.removeEventListener('mousemove', btn._onMouseMove);
    if (btn._onMouseLeave) btn.removeEventListener('mouseleave', btn._onMouseLeave);
    btn._onMouseMove = null;
    btn._onMouseLeave = null;
  });

  systemFn = null;
  pool = null;
}

// ── Mouse handler for parallax ────────────────────────────────────────────────
function _onMouse(e) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  mouseX = e.clientX / W;
  mouseY = e.clientY / H;
}

// ── Tick ───────────────────────────────────────────────────────────────────────
function _tick(dt) {
  if (!pool) return;
  elapsedT += dt;
  const W = pool.W;
  const H = pool.H;

  // Update FPS counter
  const fpsEl = document.getElementById('fps-counter');
  if (fpsEl && isFPSVisible()) {
    const current = getFPS();
    if (current !== lastFPS) {
      fpsEl.textContent = `${current} FPS`;
      lastFPS = current;
    }
  }

  // Smooth parallax
  smoothX += (mouseX - smoothX) * dt * 3;
  smoothY += (mouseY - smoothY) * dt * 3;

  // Apply parallax to bg image via CSS transform (cheap, GPU-composited)
  const bg = document.getElementById('menu-bg-img');
  if (bg) {
    const px = -(smoothX - 0.5) * 24;
    const py = -(smoothY - 0.5) * 16;
    bg.style.transform = `translate(calc(-5% + ${px}px), calc(-5% + ${py}px)) scale(1.1)`;
  }

  // Update floaters
  for (let i = 0; i < MAX_FLOATERS; i++) {
    fY[i] += fVy[i] * dt * 60;
    fX[i] += fVx[i] * dt * 60 + Math.sin(fPhase[i]) * 0.2;
    fPhase[i] += dt * 1.2;

    // Fade in/out at edges
    const distFromTop = fY[i] / H;
    const distFromBot = 1 - distFromTop;
    fAlpha[i] = Math.min(1, distFromBot * 5, distFromTop * 5) * 0.55;

    if (fY[i] < -80) _resetFloater(i, false);
  }

  // Ambient particles — sparse
  if (Math.random() < 0.25) {
    pool.emitOne({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.1,
      vy: -(Math.random() * 0.15 + 0.02),
      size: Math.random() * 3 + 1,
      life: 1,
      decay: 0.3 + Math.random() * 0.3,
      r: 124, g: 58, b: 237,
      shape: Math.random() < 0.4 ? 3 : 0,
    });
  }

  pool.update(dt);
  _draw(W, H);
}

function _draw(W, H) {
  const ctx = pool.ctx;
  const dpr = pool._dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Ambient particles
  pool.draw();

  // Floating bloons
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < MAX_FLOATERS; i++) {
    if (fAlpha[i] < 0.01) continue;
    const def = BLOON_DEFS[fType[i]];
    drawBloon(ctx, fX[i], fY[i], fSize[i], def.r, def.g, def.b, fAlpha[i]);
  }
}

function _resetFloater(i, seed) {
  const W = pool?.W ?? 1440;
  const H = pool?.H ?? 900;
  fType[i]  = (Math.random() * BLOON_DEFS.length) | 0;
  fSize[i]  = 14 + Math.random() * 24;
  fPhase[i] = Math.random() * 6.28;
  fAlpha[i] = 0;
  fX[i]     = Math.random() * W;
  fY[i]     = seed ? Math.random() * H : H + 20 + Math.random() * 80;
  fVx[i]    = (Math.random() - 0.5) * 0.25;
  fVy[i]    = -(Math.random() * 0.4 + 0.15);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
export function showToast(msg, icon = '🔔', duration = 2800) {
  const toast   = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  const toastIco = document.getElementById('toast-icon');
  if (!toast) return;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastMsg.textContent = msg;
  toastIco.textContent = icon;
  toast.classList.add('show');
  toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Settings ──────────────────────────────────────────────────────────────────
function _initSettings() {
  const modal    = document.getElementById('modal-settings');
  const backdrop = document.getElementById('settings-backdrop');
  const fpsToggle = document.getElementById('toggle-fps');

  const open  = () => {
    if (fpsToggle) fpsToggle.checked = isFPSVisible();
    modal?.classList.remove('hidden');
  };
  const close = () => modal?.classList.add('hidden');

  document.getElementById('btn-settings')?.addEventListener('click', open);
  document.getElementById('btn-settings-close')?.addEventListener('click', close);
  document.getElementById('btn-settings-cancel')?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);

  if (fpsToggle) {
    fpsToggle.addEventListener('change', () => {
      const visible = isFPSVisible();
      if (fpsToggle.checked !== visible) {
        toggleFPS();
      }
    });
  }

  document.getElementById('btn-settings-save')?.addEventListener('click', () => {
    close();
    showToast('Settings saved!', '✅');
  });

  ['music-vol', 'sfx-vol'].forEach(id => {
    const slider = document.getElementById(id);
    const valEl  = document.getElementById(id + '-val');
    if (!slider || !valEl) return;
    slider.addEventListener('input', () => {
      valEl.textContent = slider.value + '%';
    });
  });

  document.getElementById('btn-fs-modal')?.addEventListener('click', _doFullscreen);
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
function _initFullscreen() {
  document.getElementById('btn-fullscreen-toggle')?.addEventListener('click', _doFullscreen);
}

async function _doFullscreen() {
  if (window.electronAPI) {
    const isFS = await window.electronAPI.toggleFullscreen();
    showToast(isFS ? 'Fullscreen enabled' : 'Windowed mode', '⛶');
  } else {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
}

// ── Nav buttons ───────────────────────────────────────────────────────────────
function _initNavButtons() {
  const stubs = [
    ['btn-play',         'Map Selection is coming soon! 🗺️',      '🗺️'],
    ['btn-heroes',       'Heroes are being trained… 🦸',           '🦸'],
    ['btn-monkeys',      'Monkey Upgrades coming in v0.2! 🐒',     '🐒'],
    ['btn-shop',         'Trophy Store opens soon! 🏪',            '🏪'],
    ['btn-daily',        'Daily Quests arriving next update! 📅',  '📅'],
    ['btn-odyssey',      'Odyssey Mode coming soon! 🌊',           '🌊'],
    ['btn-coop',         'Co-op Mode in development! 🤝',          '🤝'],
    ['btn-achievements', 'Achievement tracking coming soon! 🎖',   '🎖'],
    ['btn-collection',   'Collection browser in v0.3! 📚',         '📚'],
    ['btn-leaderboard',  'Leaderboard launches at v1.0! 📊',       '📊'],
  ];

  stubs.forEach(([id, msg, icon]) => {
    document.getElementById(id)?.addEventListener('click', () => showToast(msg, icon));
  });

  // 3D Tilt Effect on hover
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    const onMouseMove = (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;

      // Normalised coordinates relative to center (-0.5 to 0.5)
      const relativeX = (x / w) - 0.5;
      const relativeY = (y / h) - 0.5;

      // Maximum angle of tilt (12 degrees)
      const maxTilt = 12;
      const tiltX = -relativeY * maxTilt;
      const tiltY = relativeX * maxTilt;

      // Apply 3D perspective and rotation transforms
      btn.style.transform = `perspective(400px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) scale3d(1.03, 1.03, 1.03)`;
      
      // Update custom properties for follow-pointer radial gradient shine
      btn.style.setProperty('--mouse-x', `${((x / w) * 100).toFixed(1)}%`);
      btn.style.setProperty('--mouse-y', `${((y / h) * 100).toFixed(1)}%`);
    };

    const onMouseLeave = () => {
      btn.style.transform = 'perspective(400px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
      btn.style.setProperty('--mouse-x', '50%');
      btn.style.setProperty('--mouse-y', '50%');
    };

    // Remove old listeners if they were somehow already attached
    if (btn._onMouseMove) btn.removeEventListener('mousemove', btn._onMouseMove);
    if (btn._onMouseLeave) btn.removeEventListener('mouseleave', btn._onMouseLeave);

    btn.addEventListener('mousemove', onMouseMove);
    btn.addEventListener('mouseleave', onMouseLeave);

    // Save references to handlers for clean up
    btn._onMouseMove = onMouseMove;
    btn._onMouseLeave = onMouseLeave;
  });
}

// ── Platform badge ────────────────────────────────────────────────────────────
async function _initPlatformBadge() {
  const badge  = document.getElementById('platform-badge');
  const infoEl = document.getElementById('platform-info-modal');
  if (!badge) return;

  if (window.electronAPI) {
    try {
      const info = await window.electronAPI.getPlatformInfo();
      badge.textContent = info.isMac
        ? `macOS · ${info.isArm ? 'Apple Silicon Optimized' : 'Intel'}`
        : 'Windows · x64';
      if (infoEl) infoEl.textContent = `${info.platform}/${info.arch} · Electron ${info.electronVersion}`;
    } catch { badge.textContent = 'Desktop App'; }
  } else {
    badge.textContent = 'Browser Preview';
  }
}

// ── News ticker ───────────────────────────────────────────────────────────────
function _initNewsTicker() {
  const el = document.getElementById('news-ribbon-text');
  if (!el) return;
  el.textContent = [
    '🎉 Welcome to Bloons Reborn Alpha!',
    '🗺️ 3 new maps launching next update',
    '🐒 Chrono Monkey class revealed',
    '💎 Complete the Daily Quest to earn free gems',
    '🎯 New Bloon type: Phantom Bloon',
    '🌊 Odyssey Mode now supports custom loadouts',
    '⚔️ Hero progression system coming in v0.2.0',
  ].join('  ·  ');
}
