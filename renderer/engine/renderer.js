// engine/renderer.js
// GPU-optimized Canvas 2D particle renderer
// - Pre-allocated Float32Array pool (zero GC per frame)
// - Batch draw by shape
// - Single canvas, composited layers
// - Metal-backed via Chromium on M5

// Particle data layout in Float32Array (stride = 14 floats per particle):
// [0]  x
// [1]  y
// [2]  vx
// [3]  vy
// [4]  size
// [5]  life       (0..1, fades to 0)
// [6]  decay      (life lost per second)
// [7]  r          (0..255)
// [8]  g
// [9]  b
// [10] gravity
// [11] rotation
// [12] spin       (rad/sec)
// [13] shape      (0=circle, 1=star, 2=ring, 3=glow)

const STRIDE = 14;
const MAX_DEFAULT = 2000;

export let lastLightningTime = 0;

export class ParticlePool {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} maxParticles
   */
  constructor(canvas, maxParticles = MAX_DEFAULT) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.max    = maxParticles;
    this.data   = new Float32Array(maxParticles * STRIDE);
    this.count  = 0;
    this.W      = 0;
    this.H      = 0;
    this._dpr   = 1;

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  _resize() {
    this._dpr = window.devicePixelRatio || 1;
    const w = this.canvas.parentElement?.clientWidth  || window.innerWidth;
    const h = this.canvas.parentElement?.clientHeight || window.innerHeight;
    this.canvas.width  = w * this._dpr;
    this.canvas.height = h * this._dpr;
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.W = w;
    this.H = h;
  }

  /** Emit a batch of particles */
  emit(configs) {
    for (const c of configs) {
      if (this.count >= this.max) break;
      const i = this.count * STRIDE;
      this.data[i]      = c.x      ?? 0;
      this.data[i + 1]  = c.y      ?? 0;
      this.data[i + 2]  = c.vx     ?? 0;
      this.data[i + 3]  = c.vy     ?? 0;
      this.data[i + 4]  = c.size   ?? 3;
      this.data[i + 5]  = c.life   ?? 1;
      this.data[i + 6]  = c.decay  ?? 0.5;
      this.data[i + 7]  = c.r      ?? 124;
      this.data[i + 8]  = c.g      ?? 58;
      this.data[i + 9]  = c.b      ?? 237;
      this.data[i + 10] = c.gravity ?? 0;
      this.data[i + 11] = c.rotation ?? 0;
      this.data[i + 12] = c.spin   ?? 0;
      this.data[i + 13] = c.shape  ?? 0;
      this.count++;
    }
  }

  /** Emit a single particle */
  emitOne(c) {
    if (this.count >= this.max) return;
    const i = this.count * STRIDE;
    this.data[i]      = c.x      ?? 0;
    this.data[i + 1]  = c.y      ?? 0;
    this.data[i + 2]  = c.vx     ?? 0;
    this.data[i + 3]  = c.vy     ?? 0;
    this.data[i + 4]  = c.size   ?? 3;
    this.data[i + 5]  = c.life   ?? 1;
    this.data[i + 6]  = c.decay  ?? 0.5;
    this.data[i + 7]  = c.r      ?? 124;
    this.data[i + 8]  = c.g      ?? 58;
    this.data[i + 9]  = c.b      ?? 237;
    this.data[i + 10] = c.gravity ?? 0;
    this.data[i + 11] = c.rotation ?? 0;
    this.data[i + 12] = c.spin   ?? 0;
    this.data[i + 13] = c.shape  ?? 0;
    this.count++;
  }

  /** Update all particles — compact dead ones via swap-and-pop (zero alloc) */
  update(dt) {
    let i = 0;
    while (i < this.count) {
      const o = i * STRIDE;

      // Integrate
      this.data[o + 3] += this.data[o + 10] * dt; // vy += gravity*dt
      this.data[o]     += this.data[o + 2] * dt * 60; // x += vx * dt * 60
      this.data[o + 1] += this.data[o + 3] * dt * 60; // y += vy * dt * 60
      this.data[o + 5] -= this.data[o + 6] * dt;      // life -= decay * dt
      this.data[o + 11]+= this.data[o + 12]* dt;      // rotation += spin * dt

      // Dead? swap-and-pop
      if (this.data[o + 5] <= 0) {
        this.count--;
        if (i < this.count) {
          // Copy last particle into this slot
          const last = this.count * STRIDE;
          for (let j = 0; j < STRIDE; j++) {
            this.data[o + j] = this.data[last + j];
          }
        }
        // Don't increment i — re-check this slot
      } else {
        i++;
      }
    }
  }

  /** Draw all particles — batched, minimal state changes.
   *  Does NOT clear the canvas: callers clear once at the top of their own
   *  frame draw, so the particle layer composites on top of whatever was
   *  already painted (background, nebula, hex grid, etc). */
  draw() {
    const ctx = this.ctx;
    const dpr = this._dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sort by shape to batch draws (simple counting sort for 4 shapes)
    // Actually for <2000 particles, iterating once per shape is fine
    // Shape 3 (glow) first as underlayer
    this._drawShape(ctx, 3); // glow
    this._drawShape(ctx, 0); // circles
    this._drawShape(ctx, 2); // rings
    this._drawShape(ctx, 1); // stars

    // Flash-decay overlay animation for lightning strikes
    const timeSinceStrike = performance.now() - lastLightningTime;
    const duration = 250; // ms
    if (timeSinceStrike < duration) {
      const flashAlpha = (1 - timeSinceStrike / duration) * 0.25; // max overlay opacity of 0.25
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.restore();
    }
  }

  _drawShape(ctx, shape) {
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      if (this.data[o + 13] !== shape) continue;

      const x    = this.data[o];
      const y    = this.data[o + 1];
      const size = this.data[o + 4];
      const life = this.data[o + 5];
      const r    = this.data[o + 7] | 0;
      const g    = this.data[o + 8] | 0;
      const b    = this.data[o + 9] | 0;
      const rot  = this.data[o + 11];
      const alpha = Math.min(1, life);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      if (rot !== 0) ctx.rotate(rot);

      const color = `rgb(${r},${g},${b})`;

      if (shape === 0) {
        // Circle — simple filled arc
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.5, 0, 6.2832);
        ctx.fill();
      } else if (shape === 1) {
        // Star
        ctx.fillStyle = color;
        this._star(ctx, 0, 0, size * 0.3, size * 0.6, 5);
        ctx.fill();
      } else if (shape === 2) {
        // Ring
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(0.5, size * 0.12);
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.5, 0, 6.2832);
        ctx.stroke();
      } else if (shape === 3) {
        // Soft glow — radial gradient
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
        grad.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.4})`);
        grad.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 0.1})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(-size, -size, size * 2, size * 2);
      }

      ctx.restore();
    }
  }

  _star(ctx, cx, cy, r1, r2, pts) {
    ctx.beginPath();
    const step = Math.PI / pts;
    for (let i = 0; i < pts * 2; i++) {
      const r   = i & 1 ? r1 : r2;
      const ang = i * step - 1.5708;
      const px  = cx + Math.cos(ang) * r;
      const py  = cy + Math.sin(ang) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  clear() { this.count = 0; }

  destroy() {
    window.removeEventListener('resize', this._resize);
    this.clear();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

// ── Helper: draw a procedural bloon on any canvas ctx ─────────────────────────
export function drawBloon(ctx, x, y, radius, r, g, b, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);

  // Drop shadow beneath the bloon (slightly offset down/right, blurred using radial gradient)
  const shadowX = radius * 0.15;
  const shadowY = radius * 0.2;
  const shadowGrad = ctx.createRadialGradient(
    shadowX, shadowY, 0,
    shadowX, shadowY, radius * 1.2
  );
  shadowGrad.addColorStop(0, `rgba(0, 0, 0, ${alpha * 0.35})`);
  shadowGrad.addColorStop(0.6, `rgba(0, 0, 0, ${alpha * 0.12})`);
  shadowGrad.addColorStop(1, `rgba(0, 0, 0, 0)`);
  ctx.fillStyle = shadowGrad;
  ctx.beginPath();
  ctx.ellipse(shadowX, shadowY, radius * 1.05, radius * 1.15, 0, 0, 6.2832);
  ctx.fill();

  // Animated balloon string (subtle swaying motion using a sine wave based on time and position phase)
  const time = performance.now() / 1000;
  // Unique phase offset per bloon so they don't sway in sync
  const phase = time * 3.5 + (x * 0.05) + (y * 0.02);
  
  ctx.strokeStyle = `rgba(200, 200, 200, ${alpha * 0.5})`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  // String starts at the bottom of the knot (around y = radius * 1.25)
  ctx.moveTo(0, radius * 1.25);
  // Define control points and end point for swaying curve
  const cp1x = Math.sin(phase) * radius * 0.15;
  const cp1y = radius * 1.6;
  const cp2x = Math.cos(phase * 0.8) * radius * 0.15;
  const cp2y = radius * 2.0;
  const endX = Math.sin(phase * 1.2) * radius * 0.25;
  const endY = radius * 2.4;
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
  ctx.stroke();

  // Body with 3D radial gradient (light center, base color, dark edge shadow, and subtle rim light)
  const bodyGrad = ctx.createRadialGradient(
    -radius * 0.3, -radius * 0.3, radius * 0.05,
    -radius * 0.1, -radius * 0.1, radius * 1.2
  );
  bodyGrad.addColorStop(0, `rgba(${Math.min(255, r + 150)}, ${Math.min(255, g + 150)}, ${Math.min(255, b + 150)}, ${alpha})`);
  bodyGrad.addColorStop(0.25, `rgba(${Math.min(255, r + 70)}, ${Math.min(255, g + 70)}, ${Math.min(255, b + 70)}, ${alpha})`);
  bodyGrad.addColorStop(0.65, `rgba(${r}, ${g}, ${b}, ${alpha})`);
  bodyGrad.addColorStop(0.9, `rgba(${Math.max(0, r - 55)}, ${Math.max(0, g - 55)}, ${Math.max(0, b - 55)}, ${alpha})`);
  bodyGrad.addColorStop(1, `rgba(${Math.min(255, r + 25)}, ${Math.min(255, g + 25)}, ${Math.min(255, b + 25)}, ${alpha * 0.75})`); // Rim light

  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 1.15, 0, 0, 6.2832);
  ctx.fill();

  // Specular reflection spot (bright, sharp white ellipse at top-left)
  const specGrad = ctx.createRadialGradient(
    -radius * 0.35, -radius * 0.4, 0,
    -radius * 0.35, -radius * 0.4, radius * 0.3
  );
  specGrad.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.95})`);
  specGrad.addColorStop(0.3, `rgba(255, 255, 255, ${alpha * 0.7})`);
  specGrad.addColorStop(1, `rgba(255, 255, 255, 0)`);
  ctx.fillStyle = specGrad;
  ctx.beginPath();
  ctx.ellipse(-radius * 0.35, -radius * 0.4, radius * 0.3, radius * 0.2, -0.5, 0, 6.2832);
  ctx.fill();

  // Knot with 3D gradient matching balloon tone
  const knotGrad = ctx.createLinearGradient(-radius * 0.15, radius * 1.1, radius * 0.15, radius * 1.3);
  knotGrad.addColorStop(0, `rgba(${Math.max(0, r - 80)}, ${Math.max(0, g - 80)}, ${Math.max(0, b - 80)}, ${alpha})`);
  knotGrad.addColorStop(0.5, `rgba(${Math.max(0, r - 30)}, ${Math.max(0, g - 30)}, ${Math.max(0, b - 30)}, ${alpha})`);
  knotGrad.addColorStop(1, `rgba(${Math.max(0, r - 100)}, ${Math.max(0, g - 100)}, ${Math.max(0, b - 100)}, ${alpha})`);
  
  ctx.fillStyle = knotGrad;
  ctx.beginPath();
  ctx.moveTo(-radius * 0.15, radius * 1.1);
  ctx.lineTo(0, radius * 1.3);
  ctx.lineTo(radius * 0.15, radius * 1.1);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ── Procedural lightning bolt ─────────────────────────────────────────────────
export function drawLightning(ctx, x1, y1, x2, y2, opts = {}) {
  const {
    width = 2,
    segments = 8,
    jitter = 60,
    r = 192, g = 132, b = 252,
    alpha = 0.7,
    glowRadius = 14,
  } = opts;

  lastLightningTime = performance.now();

  function drawSingleBolt(ctx, sx1, sy1, sx2, sy2, boltWidth, boltAlpha, isChild = false) {
    const points = [{ x: sx1, y: sy1 }];
    const dx = sx2 - sx1;
    const dy = sy2 - sy1;
    const distance = Math.hypot(dx, dy);
    
    const boltSegments = isChild ? Math.max(3, Math.round(segments * 0.6)) : segments;
    const boltJitter = isChild ? jitter * 0.6 : jitter;

    for (let i = 1; i < boltSegments; i++) {
      const t = i / boltSegments;
      points.push({
        x: sx1 + dx * t + (Math.random() - 0.5) * boltJitter,
        y: sy1 + dy * t + (Math.random() - 0.5) * boltJitter * 0.3,
      });
    }
    points.push({ x: sx2, y: sy2 });

    // Draw main stroke with glow shadow
    ctx.save();
    ctx.globalAlpha = boltAlpha;
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = boltWidth;
    ctx.shadowColor = `rgb(${r},${g},${b})`;
    ctx.shadowBlur = isChild ? glowRadius * 0.5 : glowRadius;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    // Draw thinner, brighter core
    ctx.globalAlpha = boltAlpha * 0.9;
    ctx.strokeStyle = `rgb(${Math.min(255, r + 60)},${Math.min(255, g + 60)},255)`;
    ctx.lineWidth = boltWidth * 0.4;
    ctx.shadowBlur = isChild ? glowRadius * 0.25 : glowRadius * 0.5;
    ctx.stroke();
    ctx.restore();

    // If main bolt, generate branches
    if (!isChild) {
      for (let i = 1; i < points.length - 1; i++) {
        // 25% chance to spawn a child bolt from each joint
        if (Math.random() < 0.25) {
          const startPt = points[i];
          const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.2;
          const branchLength = distance * (0.3 + Math.random() * 0.3) * (1 - i / points.length);
          const bx2 = startPt.x + Math.cos(angle) * branchLength;
          const by2 = startPt.y + Math.sin(angle) * branchLength;

          drawSingleBolt(ctx, startPt.x, startPt.y, bx2, by2, boltWidth * 0.6, boltAlpha * 0.8, true);
        }
      }
    }
  }

  drawSingleBolt(ctx, x1, y1, x2, y2, width, alpha, false);
}
