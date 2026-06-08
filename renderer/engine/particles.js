// renderer/engine/particles.js
// Shared particle system — canvas-based, RAF-driven

export class ParticleSystem {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d', { willReadFrequently: false, alpha: true });
    this.particles = [];
    this.running   = false;
    this.rafId     = null;
    this.opts = {
      maxParticles: opts.maxParticles ?? 180,
      spawnRate:    opts.spawnRate    ?? 2,   // per frame
      ...opts,
    };

    this._resize = this._resize.bind(this);
    this._loop   = this._loop.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w   = this.canvas.parentElement?.clientWidth  || window.innerWidth;
    const h   = this.canvas.parentElement?.clientHeight || window.innerHeight;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.scale(dpr, dpr);
    this.W = w;
    this.H = h;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  destroy() {
    this.stop();
    this.particles = [];
    window.removeEventListener('resize', this._resize);
  }

  _loop() {
    if (!this.running) return;
    this._update();
    this._draw();
    this.rafId = requestAnimationFrame(this._loop);
  }

  _update() {
    // Spawn
    for (let i = 0; i < this.opts.spawnRate; i++) {
      if (this.particles.length < this.opts.maxParticles) {
        this.particles.push(this._spawn());
      }
    }

    // Update & prune
    this.particles = this.particles.filter(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += p.gravity ?? 0;
      p.life -= p.decay;
      p.size *= 0.998;
      p.rotation = (p.rotation ?? 0) + (p.spin ?? 0);
      return p.life > 0 && p.size > 0.3;
    });
  }

  _draw() {
    this.ctx.clearRect(0, 0, this.W, this.H);
    for (const p of this.particles) {
      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, p.life);
      this.ctx.translate(p.x, p.y);
      if (p.rotation) this.ctx.rotate(p.rotation);
      this.ctx.fillStyle = p.color;
      this.ctx.shadowColor = p.glow ?? p.color;
      this.ctx.shadowBlur  = p.glowRadius ?? 8;

      if (p.shape === 'star') {
        this._drawStar(this.ctx, 0, 0, p.size / 2, p.size, 5);
      } else if (p.shape === 'spark') {
        this.ctx.beginPath();
        this.ctx.moveTo(0, -p.size);
        this.ctx.lineTo(0,  p.size);
        this.ctx.strokeStyle = p.color;
        this.ctx.lineWidth   = p.size * 0.3;
        this.ctx.stroke();
      } else {
        // Default: circle
        this.ctx.beginPath();
        this.ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    }
  }

  _drawStar(ctx, x, y, r1, r2, points) {
    ctx.beginPath();
    const step = Math.PI / points;
    for (let i = 0; i < points * 2; i++) {
      const r    = i % 2 === 0 ? r2 : r1;
      const ang  = i * step - Math.PI / 2;
      const px   = x + Math.cos(ang) * r;
      const py   = y + Math.sin(ang) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  /** Override in subclasses */
  _spawn() {
    return {
      x: Math.random() * this.W,
      y: Math.random() * this.H,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -Math.random() * 0.8 - 0.2,
      size: Math.random() * 4 + 1,
      life: 1,
      decay: Math.random() * 0.005 + 0.002,
      color: '#7c3aed',
      glow: '#a855f7',
      glowRadius: 6,
      shape: 'circle',
      gravity: 0,
      rotation: 0,
      spin: (Math.random() - 0.5) * 0.04,
    };
  }
}

// ── Splash-specific star field ────────────────────────────────────────────────
export class StarFieldSystem extends ParticleSystem {
  constructor(canvas) {
    super(canvas, { maxParticles: 220, spawnRate: 3 });
  }

  _spawn() {
    const colors = [
      '#7c3aed', '#a855f7', '#06b6d4', '#22d3ee',
      '#f59e0b', '#fcd34d', '#e879f9', '#ffffff',
    ];
    const r = Math.random();
    return {
      x:    Math.random() * this.W,
      y:    Math.random() * this.H,
      vx:   (Math.random() - 0.5) * 0.3,
      vy:   -Math.random() * 0.4 - 0.05,
      size: r < 0.6 ? Math.random() * 2 + 0.5 : Math.random() * 4 + 2,
      life: 1,
      decay: Math.random() * 0.003 + 0.001,
      color: colors[Math.floor(Math.random() * colors.length)],
      glow:  colors[Math.floor(Math.random() * colors.length)],
      glowRadius: r < 0.8 ? 4 : 12,
      shape: r < 0.15 ? 'star' : 'circle',
      gravity: 0,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.02,
    };
  }
}

// ── Loading-screen ambient nebula ─────────────────────────────────────────────
export class NebulaDriftSystem extends ParticleSystem {
  constructor(canvas) {
    super(canvas, { maxParticles: 80, spawnRate: 1 });
  }

  _spawn() {
    const side = Math.random();
    const colors = ['rgba(124,58,237,', 'rgba(6,182,212,', 'rgba(168,85,247,'];
    const c = colors[Math.floor(Math.random() * colors.length)];
    return {
      x:    side < 0.5 ? -20 : this.W + 20,
      y:    Math.random() * this.H,
      vx:   side < 0.5 ? Math.random() * 0.5 + 0.1 : -(Math.random() * 0.5 + 0.1),
      vy:   (Math.random() - 0.5) * 0.2,
      size: Math.random() * 30 + 10,
      life: 0.15,
      decay: 0.0002,
      color: `${c}0.12)`,
      glow:  `${c}0.08)`,
      glowRadius: 20,
      shape: 'circle',
      gravity: 0,
      rotation: 0,
      spin: 0,
    };
  }
}
