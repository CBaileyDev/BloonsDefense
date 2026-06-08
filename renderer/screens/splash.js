// screens/splash.js
// Premium cinematic splash screen — GPU canvas only, zero DOM animation
// Features: cosmic portal, swirling concentric particles, mouse ripples & shockwaves,
//           shifting multi-layered nebula background, shooting stars, and procedural logo/title.

import { ParticlePool, drawBloon, drawLightning } from '../engine/renderer.js';
import { addSystem, removeSystem, addRenderSystem, removeRenderSystem } from '../engine/game-loop.js';

// ── Bloon definitions ─────────────────────────────────────────────────────────
const BLOON_DEFS = [
  { r: 231, g: 76,  b: 60  }, // red
  { r: 52,  g: 152, b: 219 }, // blue
  { r: 39,  g: 174, b: 96  }, // green
  { r: 243, g: 156, b: 18  }, // yellow
  { r: 155, g: 89,  b: 182 }, // purple
  { r: 230, g: 126, b: 34  }, // orange
  { r: 26,  g: 188, b: 156 }, // teal
  { r: 253, g: 121, b: 168 }, // pink
];

// ── State ─────────────────────────────────────────────────────────────────────
let pool       = null;
let updateFn   = null;
let renderFn   = null;
let elapsedT   = 0;
let ready      = false; // true once intro animation done

// Floating bloons — small fixed-size array, no alloc per frame
const MAX_BLOONS = 16;
const bloonX    = new Float32Array(MAX_BLOONS);
const bloonY    = new Float32Array(MAX_BLOONS);
const bloonVx   = new Float32Array(MAX_BLOONS);
const bloonVy   = new Float32Array(MAX_BLOONS);
const bloonR    = new Float32Array(MAX_BLOONS);
const bloonType = new Uint8Array(MAX_BLOONS);  // index into BLOON_DEFS
const bloonSize = new Float32Array(MAX_BLOONS);
const bloonPhase= new Float32Array(MAX_BLOONS); // for wobble
let bloonCount  = 0;

// Energy rings (expanding outward from logo)
const MAX_RINGS = 4;
const ringRadius = new Float32Array(MAX_RINGS);
const ringLife   = new Float32Array(MAX_RINGS);
let ringCount    = 0;
let nextRing     = 2.0;

// ── Redesigned Features State (Zero Allocation Typed Arrays) ──────────────────
// Portal Swirling Particles
const MAX_PORTAL_PARTICLES = 250;
const portalR = new Float32Array(MAX_PORTAL_PARTICLES);
const portalTheta = new Float32Array(MAX_PORTAL_PARTICLES);
const portalSpeed = new Float32Array(MAX_PORTAL_PARTICLES);
const portalRadialSpeed = new Float32Array(MAX_PORTAL_PARTICLES);
const portalSize = new Float32Array(MAX_PORTAL_PARTICLES);
const portalColorR = new Uint8Array(MAX_PORTAL_PARTICLES);
const portalColorG = new Uint8Array(MAX_PORTAL_PARTICLES);
const portalColorB = new Uint8Array(MAX_PORTAL_PARTICLES);
const portalLife = new Float32Array(MAX_PORTAL_PARTICLES);
let portalCount = 0;

// Ripples & Shockwaves (Mouse interaction)
const MAX_RIPPLES = 12;
const rippleX = new Float32Array(MAX_RIPPLES);
const rippleY = new Float32Array(MAX_RIPPLES);
const rippleR = new Float32Array(MAX_RIPPLES);
const rippleLife = new Float32Array(MAX_RIPPLES);
const rippleMaxLife = new Float32Array(MAX_RIPPLES);
const rippleType = new Uint8Array(MAX_RIPPLES); // 0 = mouse ripple, 1 = click shockwave
let rippleCount = 0;

// Shooting Stars
const MAX_SHOOTING_STARS = 4;
const shootX = new Float32Array(MAX_SHOOTING_STARS);
const shootY = new Float32Array(MAX_SHOOTING_STARS);
const shootVx = new Float32Array(MAX_SHOOTING_STARS);
const shootVy = new Float32Array(MAX_SHOOTING_STARS);
const shootLength = new Float32Array(MAX_SHOOTING_STARS);
const shootLife = new Float32Array(MAX_SHOOTING_STARS);
let shootCount = 0;

// Logo Image ref from DOM
let logoImg = null;

// Transition state
let transitioning = false;
let transitionElapsed = 0;

// Event listener references for clean cleanup
let clickHandler = null;
let mouseMoveHandler = null;
let keyHandler = null;

// Pending timers + completion guard (so teardown can't leave them dangling)
let promptTimeout = null;
let transitionTimeout = null;
let completed = false;

// ── Init ──────────────────────────────────────────────────────────────────────
export function initSplash(onComplete) {
  const canvas = document.getElementById('splash-canvas');
  // Increased pool size to support click explosions
  pool = new ParticlePool(canvas, 2000);
  elapsedT = 0;
  ready = false;
  bloonCount = 0;
  ringCount  = 0;
  nextRing   = 2.0;

  portalCount = 0;
  rippleCount = 0;
  shootCount = 0;
  transitioning = false;
  transitionElapsed = 0;
  completed = false;
  promptTimeout = null;
  transitionTimeout = null;

  logoImg = document.getElementById('splash-logo-img');

  // Hide static DOM elements so they can be drawn procedurally on Canvas
  const logoWrap = document.getElementById('splash-logo-wrap');
  if (logoWrap) {
    logoWrap.style.opacity = '0';
    logoWrap.style.pointerEvents = 'none';
    logoWrap.style.position = 'absolute';
    logoWrap.style.transform = 'scale(0)';
  }
  const subtitle = document.getElementById('splash-subtitle');
  if (subtitle) {
    subtitle.style.opacity = '0';
    subtitle.style.pointerEvents = 'none';
    subtitle.style.position = 'absolute';
    subtitle.style.transform = 'scale(0)';
  }

  // Seed portal particles
  for (let i = 0; i < MAX_PORTAL_PARTICLES; i++) {
    _resetPortalParticle(i, true);
  }
  portalCount = MAX_PORTAL_PARTICLES;

  // Seed initial bloons
  for (let i = 0; i < MAX_BLOONS; i++) {
    _resetBloon(i, true);
  }
  bloonCount = MAX_BLOONS;

  // Seed initial starfield particles
  for (let i = 0; i < 160; i++) {
    _emitStar(pool.W, pool.H, true);
  }

  // Fade in the prompt after 2s
  promptTimeout = setTimeout(() => {
    promptTimeout = null;
    if (transitioning) return;
    ready = true;
    const prompt = document.getElementById('splash-click-prompt');
    if (prompt) {
      prompt.style.transition = 'opacity 0.8s';
      prompt.style.opacity = '1';
    }
  }, 2000);

  // Fixed-step update + once-per-frame render
  updateFn = (dt) => _update(dt);
  renderFn = () => { if (pool) _draw(pool.W, pool.H); };
  addSystem(updateFn);
  addRenderSystem(renderFn);

  // Redesigned transitions and interactions
  const startTransition = (mx, my) => {
    if (transitioning) return;
    transitioning = true;
    transitionElapsed = 0;

    // Hide prompt immediately
    const prompt = document.getElementById('splash-click-prompt');
    if (prompt) {
      prompt.style.transition = 'opacity 0.4s ease-out';
      prompt.style.opacity = '0';
    }

    // Spawn shockwave and particle burst
    _addRipple(mx, my, 1);
    _spawnClickBurst(mx, my);

    // Complete transition after 800ms (guarded against double-fire)
    transitionTimeout = setTimeout(() => {
      transitionTimeout = null;
      if (completed) return;
      completed = true;
      _cleanup();
      onComplete();
    }, 800);
  };

  clickHandler = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    startTransition(mx, my);
  };

  let lastMoveTime = 0;
  mouseMoveHandler = (e) => {
    if (!pool || transitioning) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const now = performance.now();
    if (now - lastMoveTime > 30) {
      lastMoveTime = now;
      _emitMouseTrail(mx, my);
    }
  };

  keyHandler = (e) => {
    if (['Enter', ' ', 'Escape'].includes(e.key)) {
      document.removeEventListener('keydown', keyHandler);
      // Trigger shockwave centered on portal
      startTransition(pool ? pool.W * 0.5 : window.innerWidth * 0.5, pool ? pool.H * 0.42 : window.innerHeight * 0.42);
    }
  };

  const screen = document.getElementById('screen-splash');
  if (screen) {
    screen.addEventListener('click', clickHandler);
    screen.addEventListener('mousemove', mouseMoveHandler);
  }
  document.addEventListener('keydown', keyHandler);
}

export function destroySplash() { _cleanup(); }

function _cleanup() {
  if (updateFn) removeSystem(updateFn);
  if (renderFn) removeRenderSystem(renderFn);
  if (pool) pool.destroy();
  if (promptTimeout) { clearTimeout(promptTimeout); promptTimeout = null; }
  if (transitionTimeout) { clearTimeout(transitionTimeout); transitionTimeout = null; }
  updateFn = null;
  renderFn = null;
  pool     = null;

  const screen = document.getElementById('screen-splash');
  if (screen) {
    if (clickHandler) screen.removeEventListener('click', clickHandler);
    if (mouseMoveHandler) screen.removeEventListener('mousemove', mouseMoveHandler);
  }
  if (keyHandler) document.removeEventListener('keydown', keyHandler);

  clickHandler = null;
  mouseMoveHandler = null;
  keyHandler = null;
}

// ── Update (fixed timestep) ─────────────────────────────────────────────────────
function _update(dt) {
  if (!pool) return;
  elapsedT += dt;
  if (transitioning) {
    transitionElapsed += dt;
  }
  const W = pool.W;
  const H = pool.H;

  // 1. Spawn ambient stars. The fixed loop steps at 120Hz, so one per step is
  //    already ~120/s — plenty, and keeps the pool from saturating.
  _emitStar(W, H, false);

  // 2. Energy rings around logo center
  if (elapsedT > nextRing && ringCount < MAX_RINGS) {
    ringRadius[ringCount] = 0;
    ringLife[ringCount]   = 1;
    ringCount++;
    nextRing = elapsedT + 1.5 + Math.random();
  }

  // 4. Update bloons
  for (let i = 0; i < bloonCount; i++) {
    bloonX[i] += bloonVx[i] * dt * 60;
    bloonY[i] += bloonVy[i] * dt * 60;
    bloonPhase[i] += dt * 1.5;
    bloonX[i] += Math.sin(bloonPhase[i]) * 0.3;

    // Recycle off-screen bloons
    if (bloonY[i] < -60 || bloonY[i] > H + 60 || bloonX[i] < -60 || bloonX[i] > W + 60) {
      _resetBloon(i, false);
    }
  }

  // 5. Update rings
  for (let i = 0; i < ringCount; i++) {
    ringRadius[i] += dt * 180;
    ringLife[i]   -= dt * 0.5;
    if (ringLife[i] <= 0) {
      // Swap-pop
      ringCount--;
      ringRadius[i] = ringRadius[ringCount];
      ringLife[i]   = ringLife[ringCount];
      i--;
    }
  }

  // 6. Update Swirling concentric portal particles
  for (let i = 0; i < portalCount; i++) {
    portalTheta[i] += portalSpeed[i] * dt;
    portalR[i]      += portalRadialSpeed[i] * dt;
    portalLife[i]   -= dt * 0.15;

    const isDead = portalLife[i] <= 0 ||
                   (portalRadialSpeed[i] < 0 && portalR[i] < 4) ||
                   (portalRadialSpeed[i] > 0 && portalR[i] > 320);

    if (isDead) {
      _resetPortalParticle(i, false);
    }
  }

  // 7. Update Ripples & Shockwaves
  for (let i = 0; i < rippleCount; i++) {
    rippleR[i]    += dt * (rippleType[i] === 1 ? 550 : 160);
    rippleLife[i] -= dt / rippleMaxLife[i];

    if (rippleLife[i] <= 0) {
      rippleCount--;
      if (i < rippleCount) {
        rippleX[i] = rippleX[rippleCount];
        rippleY[i] = rippleY[rippleCount];
        rippleR[i] = rippleR[rippleCount];
        rippleLife[i] = rippleLife[rippleCount];
        rippleMaxLife[i] = rippleMaxLife[rippleCount];
        rippleType[i] = rippleType[rippleCount];
      }
      i--;
    }
  }

  // 8. Update Shooting Stars
  if (Math.random() < 0.004 && shootCount < MAX_SHOOTING_STARS) {
    _spawnShootingStar(W, H);
  }

  for (let i = 0; i < shootCount; i++) {
    shootX[i]    += shootVx[i] * dt;
    shootY[i]    += shootVy[i] * dt;
    shootLife[i] -= dt * 1.6;

    if (shootLife[i] <= 0 || shootX[i] < -200 || shootY[i] > H + 200) {
      shootCount--;
      if (i < shootCount) {
        shootX[i] = shootX[shootCount];
        shootY[i] = shootY[shootCount];
        shootVx[i] = shootVx[shootCount];
        shootVy[i] = shootVy[shootCount];
        shootLength[i] = shootLength[shootCount];
        shootLife[i] = shootLife[shootCount];
      }
      i--;
    }
  }

  // 9. Update particles
  pool.update(dt);
}

// ── Render (once per frame) ─────────────────────────────────────────────────────
function _draw(W, H) {
  if (!pool) return;
  const ctx = pool.ctx;
  const dpr = pool._dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const cx = W * 0.5;
  const cy = H * 0.42;

  // A. Background base gradient
  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.8);
  bgGrad.addColorStop(0, '#130630');
  bgGrad.addColorStop(0.4, '#080318');
  bgGrad.addColorStop(1, '#030308');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // B. Deeper, rich glowing nebula effect with multi-layered slowly-shifting opacity
  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  // Layer 1: Deep Purple/Violet
  const shiftT1 = elapsedT * 0.25;
  const cx1 = cx - 120 + Math.cos(shiftT1) * 60;
  const cy1 = cy - 40 + Math.sin(shiftT1) * 30;
  const r1 = 400 + Math.sin(shiftT1 * 1.5) * 50;
  const nebGrad1 = ctx.createRadialGradient(cx1, cy1, 0, cx1, cy1, r1);
  const opacity1 = 0.22 + Math.sin(elapsedT * 0.3) * 0.05;
  nebGrad1.addColorStop(0, `rgba(124, 58, 237, ${opacity1})`);
  nebGrad1.addColorStop(0.5, `rgba(124, 58, 237, ${opacity1 * 0.45})`);
  nebGrad1.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = nebGrad1;
  ctx.fillRect(0, 0, W, H);

  // Layer 2: Glowing Cyan
  const shiftT2 = elapsedT * 0.18 + Math.PI;
  const cx2 = cx + 140 + Math.cos(shiftT2) * 50;
  const cy2 = cy + 60 + Math.sin(shiftT2) * 40;
  const r2 = 320 + Math.cos(shiftT2 * 1.2) * 40;
  const nebGrad2 = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, r2);
  const opacity2 = 0.16 + Math.cos(elapsedT * 0.25) * 0.04;
  nebGrad2.addColorStop(0, `rgba(6, 182, 212, ${opacity2})`);
  nebGrad2.addColorStop(0.4, `rgba(6, 182, 212, ${opacity2 * 0.4})`);
  nebGrad2.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = nebGrad2;
  ctx.fillRect(0, 0, W, H);

  // Layer 3: Vibrant Magenta
  const shiftT3 = elapsedT * 0.4;
  const cx3 = cx + Math.sin(shiftT3) * 20;
  const cy3 = cy + Math.cos(shiftT3) * 15;
  const r3 = 220 + Math.sin(shiftT3 * 2.0) * 30;
  const nebGrad3 = ctx.createRadialGradient(cx3, cy3, 0, cx3, cy3, r3);
  const opacity3 = 0.20 + Math.sin(elapsedT * 0.6) * 0.06;
  nebGrad3.addColorStop(0, `rgba(232, 121, 249, ${opacity3})`);
  nebGrad3.addColorStop(0.4, `rgba(232, 121, 249, ${opacity3 * 0.3})`);
  nebGrad3.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = nebGrad3;
  ctx.fillRect(0, 0, W, H);

  ctx.restore();

  // C. Shooting Stars
  for (let i = 0; i < shootCount; i++) {
    const alpha = shootLife[i];
    const sx = shootX[i];
    const sy = shootY[i];
    const vx = shootVx[i];
    const vy = shootVy[i];
    const len = shootLength[i];

    const angle = Math.atan2(vy, vx);
    const ex = sx - Math.cos(angle) * len;
    const ey = sy - Math.sin(angle) * len;

    const grad = ctx.createLinearGradient(sx, sy, ex, ey);
    grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    grad.addColorStop(0.2, `rgba(34, 211, 238, ${alpha * 0.7})`);
    grad.addColorStop(0.6, `rgba(124, 58, 237, ${alpha * 0.2})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();
  }

  // D. Pulsing Cosmic Portal Core
  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  const portalPulse = Math.sin(elapsedT * 4.0);
  const coreR = 70 + portalPulse * 8;
  const portalGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  portalGrad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  portalGrad.addColorStop(0.2, 'rgba(34, 211, 238, 0.75)');
  portalGrad.addColorStop(0.5, 'rgba(168, 85, 247, 0.45)');
  portalGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = portalGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, 6.2832);
  ctx.fill();

  // Spinning Concentric Portal Energy Rings
  const ringTypes = 3;
  for (let rIdx = 0; rIdx < ringTypes; rIdx++) {
    const scaleFactor = 0.75 + rIdx * 0.45;
    const baseRadius = 80 * scaleFactor;
    const currentRadius = baseRadius + Math.sin(elapsedT * 2.0 + rIdx) * 5;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(elapsedT * (0.4 + rIdx * 0.2) * (rIdx % 2 === 0 ? 1 : -1));

    ctx.setLineDash([30 + rIdx * 20, 15 + rIdx * 10, 5, 15]);
    ctx.strokeStyle = rIdx % 2 === 0 ? 'rgba(34, 211, 238, 0.5)' : 'rgba(168, 85, 247, 0.5)';
    ctx.lineWidth = 1.8 + (1.5 - rIdx * 0.4);
    ctx.shadowBlur = 10;
    ctx.shadowColor = rIdx % 2 === 0 ? '#22d3ee' : '#a855f7';

    ctx.beginPath();
    ctx.arc(0, 0, currentRadius, 0, 6.2832);
    ctx.stroke();
    ctx.restore();
  }

  // E. Swirling concentric portal particles (streaming in / out)
  ctx.lineWidth = 1.8;
  for (let i = 0; i < portalCount; i++) {
    const alpha = portalLife[i];
    if (alpha <= 0) continue;

    const theta = portalTheta[i];
    const r = portalR[i];

    const px = cx + Math.cos(theta) * r;
    const py = cy + Math.sin(theta) * r;

    // Previous frame offset for motion blur tail
    const prevTheta = theta - portalSpeed[i] * 0.016;
    const prevR = r - portalRadialSpeed[i] * 0.016;
    const ppx = cx + Math.cos(prevTheta) * prevR;
    const ppy = cy + Math.sin(prevTheta) * prevR;

    const cr = portalColorR[i];
    const cg = portalColorG[i];
    const cb = portalColorB[i];

    const particleGrad = ctx.createLinearGradient(px, py, ppx, ppy);
    particleGrad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${alpha})`);
    particleGrad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);

    ctx.strokeStyle = particleGrad;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ppx, ppy);
    ctx.stroke();

    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(px, py, portalSize[i] * 0.4, 0, 6.2832);
    ctx.fill();
  }

  ctx.restore();

  // F. Draw standard particle layers (stars + mouse trail + click embers)
  pool.draw();

  // G. Draw canvas bloons
  const bctx = pool.ctx;
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < bloonCount; i++) {
    const def = BLOON_DEFS[bloonType[i]];
    drawBloon(bctx, bloonX[i], bloonY[i], bloonSize[i], def.r, def.g, def.b, 0.75);
  }

  // H. Expanding Energy rings
  for (let i = 0; i < ringCount; i++) {
    bctx.save();
    bctx.globalAlpha = ringLife[i] * 0.35;
    bctx.strokeStyle = `rgba(124,58,237,${ringLife[i] * 0.6})`;
    bctx.lineWidth = 2 + ringLife[i] * 2;
    bctx.shadowColor = '#a855f7';
    bctx.shadowBlur = 16;
    bctx.beginPath();
    bctx.arc(cx, cy, ringRadius[i], 0, 6.2832);
    bctx.stroke();
    bctx.restore();
  }

  // I. Background Lightning bolts snaps
  if (Math.random() < 0.03 && elapsedT > 1) {
    const lx1 = cx + (Math.random() - 0.5) * 400;
    const ly1 = cy - 100 - Math.random() * 200;
    const lx2 = lx1 + (Math.random() - 0.5) * 200;
    const ly2 = ly1 + 200 + Math.random() * 150;
    drawLightning(bctx, lx1, ly1, lx2, ly2, {
      width: 1.5 + Math.random(),
      segments: 6 + (Math.random() * 4) | 0,
      jitter: 40 + Math.random() * 40,
      alpha: 0.4 + Math.random() * 0.3,
      glowRadius: 12,
    });
  }

  // J. Draw Mouse/Click Ripples & Shockwaves
  for (let i = 0; i < rippleCount; i++) {
    const alpha = rippleLife[i];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowBlur = rippleType[i] === 1 ? 25 * alpha : 10 * alpha;
    ctx.shadowColor = rippleType[i] === 1 ? '#a855f7' : '#06b6d4';

    ctx.beginPath();
    ctx.arc(rippleX[i], rippleY[i], rippleR[i], 0, 6.2832);

    if (rippleType[i] === 1) {
      // Shockwave ring
      ctx.strokeStyle = `rgba(168, 85, 247, ${alpha})`;
      ctx.lineWidth = 4 + alpha * 8;
      ctx.stroke();

      // Outer ripple
      ctx.beginPath();
      ctx.arc(rippleX[i], rippleY[i], rippleR[i] * 1.15, 0, 6.2832);
      ctx.strokeStyle = `rgba(6, 182, 212, ${alpha * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // Small mouse ripple
      ctx.strokeStyle = `rgba(6, 182, 212, ${alpha * 0.35})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  // K. Draw Logo & Subtitle procedurally with entry, bobbing, and exit animations
  if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
    ctx.save();

    const logoW = Math.max(320, Math.min(W * 0.42, 580));
    const aspectRatio = logoImg.naturalHeight / logoImg.naturalWidth;
    const logoH = logoW * aspectRatio;

    // Intro progress
    const introDuration = 1.2;
    const introT = Math.min(1.0, elapsedT / introDuration);
    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
    const easeProgress = easeOutCubic(introT);

    const logoOpacity = easeProgress;
    const scale = 0.78 + easeProgress * 0.22;
    let yOffset = (1 - easeProgress) * 35;

    // Bobbing offset
    const bobbing = Math.sin(elapsedT * 1.4) * 8;
    yOffset += bobbing * easeProgress;

    ctx.translate(cx, cy + yOffset);
    ctx.scale(scale, scale);

    // Click Transition Effect
    if (transitioning) {
      const outProgress = Math.min(1.0, transitionElapsed / 0.8);
      const zoom = 1.0 + outProgress * 0.15;
      ctx.scale(zoom, zoom);
      ctx.globalAlpha = logoOpacity * (1 - outProgress);
    } else {
      ctx.globalAlpha = logoOpacity;
    }

    // Shadow glow
    ctx.shadowColor = 'rgba(124, 58, 237, 0.75)';
    ctx.shadowBlur = 35;

    ctx.drawImage(logoImg, -logoW * 0.5, -logoH * 0.5, logoW, logoH);
    ctx.restore();

    // Procedural Subtitle Text
    if (elapsedT > 0.5) {
      ctx.save();

      const subtitleIntroT = Math.min(1.0, (elapsedT - 0.5) / 0.8);
      const subEase = easeOutCubic(subtitleIntroT);

      const subOpacity = subEase;
      const subYOffset = (1 - subEase) * 16 + bobbing * subEase;
      const subY = cy + logoH * 0.5 + 24 + subYOffset;

      ctx.translate(cx, subY);

      if (transitioning) {
        const outProgress = Math.min(1.0, transitionElapsed / 0.8);
        ctx.globalAlpha = subOpacity * (1 - outProgress);
      } else {
        ctx.globalAlpha = subOpacity;
      }

      const fontSize = Math.max(10, Math.min(W * 0.013, 15));
      ctx.font = `bold ${fontSize}px Orbitron`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(34, 211, 238, 0.95)';

      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 15;

      if ('letterSpacing' in ctx) {
        ctx.letterSpacing = '6px';
      }

      ctx.fillText('TOWER DEFENSE REIMAGINED', 0, 0);
      ctx.restore();
    }
  }

  // L. Vignette overlay
  const vigGrad = ctx.createRadialGradient(cx, H * 0.5, W * 0.25, cx, H * 0.5, W * 0.75);
  vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
  vigGrad.addColorStop(1, 'rgba(6,6,15,0.8)');
  ctx.fillStyle = vigGrad;
  ctx.fillRect(0, 0, W, H);

  // M. Transition black overlay
  if (transitioning) {
    const outProgress = Math.min(1.0, transitionElapsed / 0.8);
    ctx.fillStyle = `rgba(6, 6, 15, ${outProgress})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _emitStar(W, H, seed) {
  if (!pool) return;
  const r = Math.random();
  const colors = [
    [124, 58, 237],  // purple
    [168, 85, 247],  // light purple
    [6, 182, 212],   // cyan
    [34, 211, 238],  // light cyan
    [245, 158, 11],  // gold
    [252, 211, 77],  // light gold
    [232, 121, 249], // pink
    [255, 255, 255], // white
  ];
  const [cr, cg, cb] = colors[(Math.random() * colors.length) | 0];

  pool.emitOne({
    x:    seed ? Math.random() * W : (Math.random() < 0.5 ? -5 : W + 5),
    y:    seed ? Math.random() * H : Math.random() * H,
    vx:   (Math.random() - 0.5) * 0.3,
    vy:   -Math.random() * 0.3 - 0.05,
    size: r < 0.7 ? Math.random() * 2 + 0.8 : Math.random() * 5 + 2,
    life: seed ? Math.random() : 1,
    decay: Math.random() * 0.15 + 0.05,
    r: cr, g: cg, b: cb,
    gravity: 0,
    rotation: Math.random() * 6.28,
    spin: (Math.random() - 0.5) * 0.3,
    shape: r < 0.12 ? 1 : (r < 0.2 ? 3 : 0), // star, glow, or circle
  });
}

function _resetBloon(idx, seed) {
  const W = pool?.W ?? 1440;
  const H = pool?.H ?? 900;
  bloonType[idx] = (Math.random() * BLOON_DEFS.length) | 0;
  bloonSize[idx] = 12 + Math.random() * 20;
  bloonPhase[idx] = Math.random() * 6.28;

  if (seed) {
    bloonX[idx] = Math.random() * W;
    bloonY[idx] = Math.random() * H;
  } else {
    // Respawn at bottom
    bloonX[idx] = Math.random() * W;
    bloonY[idx] = H + 20 + Math.random() * 40;
  }
  bloonVx[idx] = (Math.random() - 0.5) * 0.3;
  bloonVy[idx] = -(Math.random() * 0.6 + 0.25);
}

function _resetPortalParticle(idx, seed) {
  portalTheta[idx] = Math.random() * Math.PI * 2;
  portalSize[idx]  = 1.2 + Math.random() * 2.5;
  portalLife[idx]  = seed ? Math.random() : 1.0;

  const isInward = Math.random() < 0.6; // 60% inwards, 40% outwards
  if (isInward) {
    portalR[idx] = seed ? Math.random() * 260 : 250 + Math.random() * 30;
    portalRadialSpeed[idx] = -(15 + Math.random() * 30);
  } else {
    portalR[idx] = seed ? Math.random() * 260 : 5 + Math.random() * 15;
    portalRadialSpeed[idx] = 20 + Math.random() * 40;
  }

  portalSpeed[idx] = (0.3 + Math.random() * 1.2) * (Math.random() < 0.5 ? 1 : -1);

  if (Math.random() < 0.5) {
    portalColorR[idx] = 6;
    portalColorG[idx] = 182;
    portalColorB[idx] = 212;
  } else {
    portalColorR[idx] = 168;
    portalColorG[idx] = 85;
    portalColorB[idx] = 247;
  }
}

function _addRipple(x, y, type) {
  if (rippleCount >= MAX_RIPPLES) return;
  rippleX[rippleCount] = x;
  rippleY[rippleCount] = y;
  rippleR[rippleCount] = 0;
  rippleLife[rippleCount] = 1.0;
  rippleMaxLife[rippleCount] = type === 1 ? 1.0 : 0.6;
  rippleType[rippleCount] = type;
  rippleCount++;
}

function _spawnShootingStar(W, H) {
  if (shootCount >= MAX_SHOOTING_STARS) return;
  shootX[shootCount] = W * (0.2 + Math.random() * 0.8);
  shootY[shootCount] = H * Math.random() * 0.2;
  const speed = 700 + Math.random() * 800;
  const angle = Math.PI * 0.8 + Math.random() * 0.15;
  shootVx[shootCount] = Math.cos(angle) * speed;
  shootVy[shootCount] = Math.sin(angle) * speed;
  shootLength[shootCount] = 120 + Math.random() * 100;
  shootLife[shootCount] = 1.0;
  shootCount++;
}

function _emitMouseTrail(x, y) {
  if (!pool) return;
  const colors = [
    [124, 58, 237], // purple
    [6, 182, 212],  // cyan
    [255, 255, 255] // white
  ];
  for (let i = 0; i < 2; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 1.5;
    const [cr, cg, cb] = colors[(Math.random() * colors.length) | 0];
    pool.emitOne({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 3 + 1,
      life: 0.5,
      decay: 1.0 + Math.random() * 1.0,
      r: cr, g: cg, b: cb,
      gravity: -0.05,
      rotation: Math.random() * 6.28,
      spin: (Math.random() - 0.5) * 0.2,
      shape: Math.random() < 0.3 ? 3 : 0, // glow or circle
    });
  }
  if (Math.random() < 0.25) {
    _addRipple(x, y, 0);
  }
}

function _spawnClickBurst(x, y) {
  if (!pool) return;
  const colors = [
    [124, 58, 237],  // purple
    [168, 85, 247],  // light purple
    [6, 182, 212],   // cyan
    [34, 211, 238],  // light cyan
    [245, 158, 11],  // gold
    [252, 211, 77],  // light gold
    [255, 255, 255], // white
  ];
  for (let i = 0; i < 50; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 8;
    const r = Math.random();
    const [cr, cg, cb] = colors[(Math.random() * colors.length) | 0];

    pool.emitOne({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: r < 0.5 ? Math.random() * 3 + 1 : Math.random() * 8 + 3,
      life: 1.0,
      decay: 0.8 + Math.random() * 1.5,
      r: cr, g: cg, b: cb,
      gravity: 0,
      rotation: Math.random() * 6.28,
      spin: (Math.random() - 0.5) * 0.5,
      shape: r < 0.2 ? 1 : (r < 0.4 ? 2 : (r < 0.6 ? 3 : 0)), // star, ring, glow, or circle
    });
  }
}
