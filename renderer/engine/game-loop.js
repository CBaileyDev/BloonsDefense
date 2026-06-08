// engine/game-loop.js
// Single centralized game loop — one RAF to rule them all
// Fixed-timestep update, variable-rate render, zero GC per frame

const FIXED_DT = 1 / 120; // 120 Hz physics
const MAX_DT   = 0.1;     // clamp spiral-of-death

const systems = new Set();
let running     = false;
let rafId       = null;
let lastTime    = 0;
let accumulator = 0;
let virtualTime = 0;
let frameCount  = 0;
let fpsTime     = 0;
let currentFPS  = 60;
let fpsVisible  = false;

/** @param {(dt: number, time: number) => void} fn */
export function addSystem(fn) { systems.add(fn); }

/** @param {(dt: number, time: number) => void} fn */
export function removeSystem(fn) { systems.delete(fn); }

export function start() {
  if (running) return;
  running     = true;
  lastTime    = performance.now() / 1000;
  virtualTime = lastTime;
  fpsTime     = lastTime;
  accumulator = 0;
  rafId       = requestAnimationFrame(tick);
}

export function stop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

export function getFPS() { return currentFPS; }

export function isFPSVisible() { return fpsVisible; }

export function toggleFPS() {
  fpsVisible = !fpsVisible;
  const el = document.getElementById('fps-counter');
  if (el) {
    if (fpsVisible) {
      el.classList.remove('hidden');
      el.textContent = `${currentFPS} FPS`;
    } else {
      el.classList.add('hidden');
    }
  }
  const toggleInput = document.getElementById('toggle-fps');
  if (toggleInput) {
    toggleInput.checked = fpsVisible;
  }
  return fpsVisible;
}

function tick(nowMs) {
  if (!running) return;
  rafId = requestAnimationFrame(tick);

  const now = nowMs / 1000;
  let dt = now - lastTime;
  lastTime = now;

  // Clamp to prevent spiral
  if (dt > MAX_DT) dt = MAX_DT;

  // FPS counter
  frameCount++;
  const elapsed = now - fpsTime;
  if (elapsed >= 1.0) {
    currentFPS = Math.round(frameCount / elapsed);
    frameCount = 0;
    fpsTime = now;
  }

  // Physics accumulator loop
  accumulator += dt;
  while (accumulator >= FIXED_DT) {
    virtualTime += FIXED_DT;
    for (const sys of systems) {
      sys(FIXED_DT, virtualTime);
    }
    accumulator -= FIXED_DT;
  }
}

