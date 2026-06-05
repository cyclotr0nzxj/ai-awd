// AI-AWD Arena — Cyberpunk Particle System
// Canvas-based floating particles + neon grid for game atmosphere
// Inspired by CyberMatrix-Particles and Neon Grid Runner

class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.particles = [];
    this.lines = [];
    this.mouse = { x: -1000, y: -1000 };
    this.running = false;
    this.raf = null;
    this._resize();
    window.addEventListener("resize", () => this._resize());
    canvas.addEventListener("mousemove", (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
  }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  start(count = 60) {
    this.running = true;
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.5 + 0.2,
        pulse: Math.random() * Math.PI * 2,
      });
    }
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _loop() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this._loop());

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Draw neon grid
    ctx.strokeStyle = "rgba(0,229,255,0.04)";
    ctx.lineWidth = 0.5;
    const gridSize = 60;
    for (let x = gridSize; x < w; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = gridSize; y < h; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Draw particles
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      // Pulse alpha
      p.pulse += 0.02;
      const alpha = p.alpha + Math.sin(p.pulse) * 0.15;

      // Glow
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,229,255,${alpha * 0.15})`;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,229,255,${alpha})`;
      ctx.fill();
    }

    // Draw connections between nearby particles
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const a = this.particles[i];
        const b = this.particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(0,229,255,${0.04 * (1 - dist / 120)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    // Mouse interaction
    for (const p of this.particles) {
      const dx = p.x - this.mouse.x;
      const dy = p.y - this.mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 150) {
        p.vx += (dx / dist) * 0.05;
        p.vy += (dy / dist) * 0.05;
        p.vx *= 0.98;
        p.vy *= 0.98;
      }
    }
  }
}

// Attack line animation between combatants
function drawAttackLine(fromEl, toEl, color = "rgba(0,229,255,0.8)", duration = 1500) {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9998;";
  document.body.appendChild(canvas);
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const ctx = canvas.getContext("2d");
  const from = fromEl.getBoundingClientRect();
  const to = toEl.getBoundingClientRect();
  const x1 = from.left + from.width / 2;
  const y1 = from.top + from.height / 2;
  const x2 = to.left + to.width / 2;
  const y2 = to.top + to.height / 2;
  const start = performance.now();

  function frame(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Glow trail
    const cx = x1 + (x2 - x1) * progress;
    const cy = y1 + (y2 - y1) * progress;
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    gradient.addColorStop(0, "rgba(0,229,255,0)");
    gradient.addColorStop(progress - 0.1, "rgba(0,229,255,0.5)");
    gradient.addColorStop(progress, "rgba(0,230,118,0.9)");
    gradient.addColorStop(progress + 0.1, "rgba(0,229,255,0.5)");
    gradient.addColorStop(1, "rgba(0,229,255,0)");

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(0,229,255,0.6)";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(x1, y1);

    // Arc path
    const midX = (x1 + x2) / 2;
    const midY = Math.min(y1, y2) - 40;
    ctx.quadraticCurveTo(midX, midY, x2, y2);
    ctx.stroke();

    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      setTimeout(() => canvas.remove(), 300);
    }
  }

  requestAnimationFrame(frame);
}

// Glitch text effect
function glitchText(el) {
  el.classList.add("glitching");
  setTimeout(() => el.classList.remove("glitching"), 400);
}

// Expose for renderer
if (typeof window !== "undefined") {
  window.ParticleSystem = ParticleSystem;
  window.drawAttackLine = drawAttackLine;
  window.glitchText = glitchText;
}

// CommonJS for tests
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ParticleSystem, drawAttackLine, glitchText };
}
