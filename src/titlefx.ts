// Animated 8-bit lightning, embers and explosion glow drawn over the original title art.
// Rendered on a tiny canvas and scaled up with `image-rendering: pixelated` so it matches the pixel art.
const W = 352, H = 192;

type Pt = [number, number];
interface Bolt { main: Pt[]; branches: Pt[][]; life: number; max: number; color: string; core: string; seed: number }

export class TitleFx {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bolts: Bolt[] = [];
  private embers: { x: number; y: number; vy: number; ph: number; c: string }[] = [];
  private sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
  private t = 0; private next = 0.4; private flash = 0; private raf = 0; private last = 0;
  private running = false;
  onThunder: () => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas; canvas.width = W; canvas.height = H;
    this.ctx = canvas.getContext("2d")!;
    const cols = ["#ff9a1f", "#ffcf3a", "#ff6a1a", "#fff1a8"];
    for (let i = 0; i < 70; i++) this.embers.push({ x: Math.random() * W, y: Math.random() * H, vy: 6 + Math.random() * 22, ph: Math.random() * 6, c: cols[(Math.random() * cols.length) | 0] });
  }

  start() { if (this.running) return; this.running = true; this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.t += dt;
    this.update(dt); this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** jagged bolt by midpoint displacement */
  private makeBolt(): Bolt {
    const x0 = 20 + Math.random() * (W - 40), y0 = -4;
    const x1 = x0 + (Math.random() - 0.5) * 120, y1 = H * (0.72 + Math.random() * 0.2);
    const gen = (a: Pt, b: Pt, disp: number, out: Pt[]) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 7) { out.push(b); return; }
      const m: Pt = [(a[0] + b[0]) / 2 + (Math.random() - 0.5) * disp, (a[1] + b[1]) / 2 + (Math.random() - 0.5) * disp * 0.5];
      gen(a, m, disp * 0.55, out); gen(m, b, disp * 0.55, out);
    };
    const main: Pt[] = [[x0, y0]]; gen([x0, y0], [x1, y1], 46, main);
    const branches: Pt[][] = [];
    const nb = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < nb; i++) {
      const s = main[2 + ((Math.random() * (main.length - 4)) | 0)];
      const e: Pt = [s[0] + (Math.random() - 0.5) * 90, s[1] + 22 + Math.random() * 45];
      const br: Pt[] = [s]; gen(s, e, 22, br); branches.push(br);
    }
    const cyan = Math.random() < 0.45;
    return { main, branches, life: 0.5 + Math.random() * 0.3, max: 0, color: cyan ? "#46d2ff" : "#ffe94a", core: cyan ? "#e8fbff" : "#fffbe0", seed: Math.random() };
  }

  private update(dt: number) {
    this.next -= dt;
    if (this.next <= 0) {
      const b = this.makeBolt(); b.max = b.life; this.bolts.push(b);
      if (Math.random() < 0.35) { const c = this.makeBolt(); c.max = c.life; this.bolts.push(c); }
      this.flash = 1; this.onThunder();
      const end = b.main[b.main.length - 1];
      for (let i = 0; i < 26; i++) this.sparks.push({ x: end[0], y: end[1], vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 70, life: 0.4 + Math.random() * 0.5 });
      this.next = 0.45 + Math.random() * 1.6;
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 140 * dt; s.life -= dt; }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    for (const e of this.embers) { e.y -= e.vy * dt; e.x += Math.sin(this.t * 1.6 + e.ph) * 6 * dt; if (e.y < -2) { e.y = H + 2; e.x = Math.random() * W; } }
  }

  private px(x: number, y: number, col: string, a = 1) {
    const c = this.ctx; c.globalAlpha = a; c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  private line(a: Pt, b: Pt, col: string, a_: number, thick: number) {
    const c = this.ctx;
    let x0 = Math.round(a[0]), y0 = Math.round(a[1]); const x1 = Math.round(b[0]), y1 = Math.round(b[1]);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    c.globalAlpha = a_; c.fillStyle = col;
    for (let n = 0; n < 600; n++) {
      c.fillRect(x0 - ((thick - 1) >> 1), y0 - ((thick - 1) >> 1), thick, thick);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  private draw() {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    c.globalCompositeOperation = "lighter";
    // sky flash
    if (this.flash > 0) { c.globalAlpha = this.flash * 0.16; c.fillStyle = "#9fc8ff"; c.fillRect(0, 0, W, H); }
    // pulsing explosions (match the baked-in art positions)
    const glow = (x: number, y: number, r: number, a: number, col: string) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)");
      c.globalAlpha = a; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const pul = (ph: number) => 0.5 + 0.5 * Math.sin(this.t * 5 + ph) * (0.7 + 0.3 * Math.sin(this.t * 13 + ph * 2));
    glow(W * 0.22, H * 0.9, 46, 0.1 + 0.2 * pul(0), "#ff7a1a");
    glow(W * 0.75, H * 0.89, 44, 0.1 + 0.2 * pul(2), "#ff7a1a");
    glow(W * 0.92, H * 0.07, 40, 0.08 + 0.18 * pul(4), "#ffb02a");
    // bolts
    for (const b of this.bolts) {
      const k = b.life / b.max;
      const a = k > 0.55 ? 1 : (Math.random() < 0.7 ? k + 0.25 : 0.15);
      const draw = (pts: Pt[], w: number) => {
        for (let i = 1; i < pts.length; i++) {
          this.line(pts[i - 1], pts[i], b.color, a * 0.22, w + 4);
          this.line(pts[i - 1], pts[i], b.color, a * 0.7, w + 1);
          this.line(pts[i - 1], pts[i], b.core, a, w);
        }
      };
      draw(b.main, 1); for (const br of b.branches) draw(br, 1);
    }
    // sparks + embers
    for (const s of this.sparks) this.px(s.x, s.y, "#ffd36a", Math.min(1, s.life * 2));
    for (const e of this.embers) this.px(e.x, e.y, e.c, 0.45 + 0.5 * Math.abs(Math.sin(this.t * 4 + e.ph)));
    c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
  }
}
