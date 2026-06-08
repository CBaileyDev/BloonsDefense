// renderer/main.js
// Game controller — screen router, single game loop, lifecycle

import { start as startLoop, stop as stopLoop, toggleFPS } from './engine/game-loop.js';
import { initSplash, destroySplash } from './screens/splash.js';
import { initLoading, destroyLoading } from './screens/loading.js';
import { initMenu, destroyMenu } from './screens/menu.js';

// ── Screen registry ───────────────────────────────────────────────────────────
const SCREENS = {
  splash:  document.getElementById('screen-splash'),
  loading: document.getElementById('screen-loading'),
  menu:    document.getElementById('screen-menu'),
};

let currentScreen = null;

function goTo(to) {
  const next = SCREENS[to];
  const prev = currentScreen ? SCREENS[currentScreen] : null;

  if (prev) {
    prev.classList.remove('active');
    prev.classList.add('leaving');
    setTimeout(() => prev.classList.remove('leaving'), 700);
  }

  if (next) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        next.classList.add('active');
      });
    });
  }

  currentScreen = to;
}

// ── Game flow ─────────────────────────────────────────────────────────────────
function boot() {
  // Start the single centralized game loop
  startLoop();

  // 1. Splash
  goTo('splash');
  initSplash(() => {
    destroySplash();
    goTo('loading');
    startLoadingPhase();
  });
}

function startLoadingPhase() {
  initLoading(() => {
    destroyLoading();
    goTo('menu');
    initMenu();
  });
}

// ── Global keyboard ───────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'F11') {
    e.preventDefault();
    if (window.electronAPI) window.electronAPI.toggleFullscreen();
    else if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  if (e.key === 'Escape') {
    const modal = document.getElementById('modal-settings');
    if (modal && !modal.classList.contains('hidden')) modal.classList.add('hidden');
  }

  if (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'd') {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      toggleFPS();
    }
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (window.electronAPI) window.electronAPI.setTitle('Thornward');
  boot();
});
