/** Illustrated story intro: procedurally drawn pixel-art slides (192x108, scaled up with nearest-neighbour). */
const W = 192, H = 108;

type Ctx = CanvasRenderingContext2D;
const R = (c: Ctx, col: string, x: number, y: number, w: number, h: number) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const rnd = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function sky(c: Ctx, top: string, mid: string, bot: string) {
  const bands = 18;
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1), col = t < 0.5 ? mix(top, mid, t * 2) : mix(mid, bot, (t - 0.5) * 2);
    R(c, col, 0, (i * H * 0.7) / bands, W, H / bands * 0.7 + 1);
  }
}
function mix(a: string, b: string, t: number) {
  const p = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/** a square-headed suit robot executive */
function robot(c: Ctx, x: number, y: number, suit: string, eye: string, tie: string, scale = 1) {
  const s = scale;
  R(c, "#2a2f38", x - 1 * s, y + 20 * s, 12 * s, 2 * s);                  // seat shadow
  R(c, suit, x, y + 10 * s, 10 * s, 11 * s);                              // torso
  R(c, "#e8ecef", x + 3 * s, y + 10 * s, 4 * s, 7 * s);                   // shirt
  R(c, tie, x + 4.5 * s, y + 11 * s, 1 * s, 6 * s);                       // tie
  R(c, "#aab4be", x + 1 * s, y, 8 * s, 8 * s);                            // head
  R(c, "#7e8995", x + 1 * s, y + 7 * s, 8 * s, 1 * s);
  R(c, "#1b1f26", x + 2 * s, y + 2 * s, 6 * s, 3 * s);                    // visor
  R(c, eye, x + 3 * s, y + 3 * s, 1 * s, 1 * s); R(c, eye, x + 6 * s, y + 3 * s, 1 * s, 1 * s);
  R(c, "#aab4be", x + 4.5 * s, y - 2 * s, 1 * s, 2 * s); R(c, eye, x + 4 * s, y - 3 * s, 2 * s, 1 * s);   // antenna
  R(c, suit, x - 2 * s, y + 11 * s, 2 * s, 7 * s); R(c, suit, x + 10 * s, y + 11 * s, 2 * s, 7 * s);        // arms
}

function slideBoardroom(c: Ctx) {
  sky(c, "#10182e", "#1d2b4d", "#2a3b66");
  R(c, "#0f1626", 0, 0, W, H);
  // window wall with city lights
  R(c, "#16223c", 8, 8, 176, 52);
  const r = rnd(7);
  for (let i = 0; i < 120; i++) { const x = 10 + r() * 172, y = 40 + r() * 20; R(c, r() < 0.5 ? "#ffd24a" : "#7fd7ff", x, y, 1, 2); }
  for (let i = 0; i < 9; i++) { const x = 10 + i * 19, h = 12 + ((i * 37) % 22); R(c, "#0c1424", x, 60 - h, 16, h); for (let k = 0; k < 6; k++) R(c, "#ffd24a", x + 2 + (k % 3) * 5, 60 - h + 3 + ((k / 3) | 0) * 6, 2, 2); }
  R(c, "#3a4a78", 8, 8, 176, 1); R(c, "#3a4a78", 8, 59, 176, 1); for (const x of [8, 66, 124, 183]) R(c, "#3a4a78", x, 8, 1, 52);
  // wall screen
  R(c, "#0b0e14", 60, 14, 72, 30); R(c, "#14304f", 62, 16, 68, 26);
  R(c, "#7fd7ff", 66, 20, 20, 2); R(c, "#7fd7ff", 66, 25, 36, 2); R(c, "#ffd24a", 66, 30, 28, 2);
  for (let i = 0; i < 6; i++) R(c, i % 2 ? "#4aff8a" : "#7fd7ff", 104 + i * 4, 38 - i * 3 - (i % 3), 3, 4 + i * 3);
  R(c, "#ff5a5a", 112, 20, 12, 8); R(c, "#fff", 114, 22, 8, 1); R(c, "#fff", 114, 25, 5, 1);
  // table
  R(c, "#3b2a1c", 18, 76, 156, 8); R(c, "#4e3826", 18, 74, 156, 3); R(c, "#2a1d12", 30, 84, 6, 20); R(c, "#2a1d12", 156, 84, 6, 20);
  // robots
  robot(c, 34, 52, "#1d2b4d", "#ff4a4a", "#c4231c", 1.5); robot(c, 86, 50, "#2d3a2d", "#4aff8a", "#e8b923", 1.7); robot(c, 142, 52, "#3a2d4a", "#7fd7ff", "#2f7d3e", 1.5);
  // tablets & mugs on the table
  for (const x of [38, 92, 146]) { R(c, "#0b0e14", x, 70, 14, 5); R(c, "#7fd7ff", x + 1, 71, 12, 3); }
  R(c, "#f2f2f2", 70, 70, 4, 4); R(c, "#f2f2f2", 124, 70, 4, 4);
}

function slideContract(c: Ctx, reveal = false) {
  R(c, "#20150e", 0, 0, W, H); for (let y = 0; y < H; y += 6) R(c, "#271a11", 0, y, W, 3);        // desk wood
  R(c, "#000000", 30, 8, 134, 96); R(c, "#f4efe1", 27, 5, 134, 96); R(c, "#e4dcc6", 27, 99, 134, 2);   // the paper
  R(c, "#222", 36, 14, 70, 3);
  for (let y = 22; y < 40; y += 4) R(c, "#8a8a8a", 36, y, y % 8 ? 96 : 112, 1);
  // the contractor name, set in a plain sans-serif where lowercase l and capital I are the same stick
  c.save(); c.textBaseline = "alphabetic"; c.font = "bold 17px Arial, Helvetica, sans-serif"; c.fillStyle = "#14161c"; c.fillText("Al Drilling, LLC", 36, 62); c.restore();
  R(c, "#222", 36, 66, 112, 1);
  for (let y = 70; y < 80; y += 4) R(c, "#8a8a8a", 36, y, 90, 1);
  if (reveal) {
    c.strokeStyle = "#e8442a"; c.lineWidth = 1.5; c.beginPath(); c.ellipse(46, 56, 10, 9, 0, 0, 6.3); c.stroke();
    R(c, "#e8442a", 46, 44, 1, 3);
    // thought bubble: what the agents read
    R(c, "#fff9c8", 100, 24, 52, 16); R(c, "#e8442a", 100, 24, 52, 1); R(c, "#e8442a", 100, 39, 52, 1); R(c, "#e8442a", 100, 24, 1, 16); R(c, "#e8442a", 151, 24, 1, 16);
    c.save(); c.font = "bold 11px Arial, Helvetica, sans-serif"; c.fillStyle = "#b3231c"; c.fillText("AI!?", 106, 36); c.restore();
    R(c, "#fff9c8", 98, 40, 4, 3); R(c, "#fff9c8", 94, 44, 3, 2);
    R(c, "#e8442a", 128, 30, 18, 1);
  }
  // signature and approval stamp
  R(c, "#222", 40, 90, 50, 1); R(c, "#101c4a", 42, 85, 3, 4); R(c, "#101c4a", 45, 83, 5, 2); R(c, "#101c4a", 50, 85, 4, 4); R(c, "#101c4a", 54, 84, 6, 2);
  R(c, "#2f7d3e", 112, 78, 40, 16); R(c, "#f4efe1", 114, 80, 36, 12); R(c, "#2f7d3e", 118, 84, 28, 2); R(c, "#2f7d3e", 118, 88, 18, 2);
  // robot hand with a pen
  R(c, "#aab4be", 150, 70, 20, 7); R(c, "#7e8995", 150, 76, 20, 1); R(c, "#1d2b4d", 168, 66, 14, 15); R(c, "#101c4a", 142, 84, 2, 10); R(c, "#ffd24a", 142, 82, 2, 3);
}

function slideRig(c: Ctx) {
  sky(c, "#2b1b3d", "#a2506a", "#f0a050");
  R(c, "#fff1a8", 150, 48, 14, 14); R(c, "#ffe27a", 152, 50, 10, 10);                        // low sun
  R(c, "#6a3a2f", 0, 66, W, 6); R(c, "#8a5a3a", 0, 70, W, 40);                              // mesa and ground
  R(c, "#a56e45", 0, 76, W, 2); R(c, "#a56e45", 0, 88, W, 2);
  // rig
  const bx = 70;
  R(c, "#16223c", bx - 24, 62, 50, 8); R(c, "#0c1424", bx - 24, 62, 50, 2); R(c, "#3a4a78", bx - 20, 60, 42, 2);
  for (let y = 12; y < 60; y += 4) { R(c, "#e07a10", bx - 6 + (y - 12) / 16, y, 1, 4); R(c, "#e07a10", bx + 6 - (y - 12) / 16, y, 1, 4); R(c, "#d9d9d9", bx - 5 + (y - 12) / 16, y, 10 - (y - 12) / 8, 1); }
  R(c, "#e07a10", bx - 7, 12, 14, 3); R(c, "#ff4a4a", bx - 1, 8, 2, 4);
  R(c, "#e8b923", bx - 3, 44, 6, 5);
  // the sign
  R(c, "#0b0e14", 100, 64, 76, 22); R(c, "#233a52", 102, 66, 72, 18); R(c, "#ffd24a", 104, 70, 6, 10); R(c, "#ffd24a", 112, 70, 6, 10); for (let i = 0; i < 6; i++) R(c, "#ffd24a", 124 + i * 8, 70, 5, 3 + (i % 2));
  R(c, "#ffd24a", 124, 76, 46, 2); R(c, "#0b0e14", 104, 86, 2, 8); R(c, "#0b0e14", 172, 86, 2, 8);
  // robot execs with tablets in pressed suits and hard hats
  const hat = (x: number, y: number) => { R(c, "#f2f2f2", x, y - 3, 10, 3); R(c, "#d9d9d9", x - 1, y - 1, 12, 1); };
  robot(c, 24, 70, "#1d2b4d", "#ff4a4a", "#c4231c", 1); hat(25, 70); robot(c, 46, 72, "#2d3a2d", "#4aff8a", "#e8b923", 1); hat(47, 72); robot(c, 150, 74, "#3a2d4a", "#7fd7ff", "#2f7d3e", 1); hat(151, 74);
  for (const x of [26, 48, 152]) R(c, "#7fd7ff", x, 86 + (x === 26 ? -6 : x === 48 ? -4 : -3), 6, 4);
  // speech bubbles
  const bub = (x: number, y: number, w: number) => { R(c, "#f2f2f2", x, y, w, 9); R(c, "#f2f2f2", x + 3, y + 9, 3, 2); R(c, "#222", x + 3, y + 3, w - 6, 1); R(c, "#222", x + 3, y + 5, w - 12, 1); };
  bub(8, 40, 30); bub(40, 44, 26); bub(130, 48, 34);
}

function slideYou(c: Ctx) {
  sky(c, "#15213c", "#43507c", "#d98a58");
  R(c, "#2a1d12", 0, 78, W, 30); R(c, "#3b2a1c", 0, 82, W, 2);
  // distant rig silhouette
  const bx = 150; for (let y = 36; y < 78; y += 4) { R(c, "#0e1424", bx - 5 + (y - 36) / 14, y, 1, 4); R(c, "#0e1424", bx + 5 - (y - 36) / 14, y, 1, 4); }
  R(c, "#0e1424", bx - 6, 34, 12, 3); R(c, "#0e1424", bx - 22, 76, 44, 4); R(c, "#ff4a4a", bx - 1, 30, 2, 3);
  // lifted truck
  R(c, "#000", 20, 92, 98, 3);
  R(c, "#c4231c", 26, 66, 86, 12); R(c, "#9c1c16", 26, 76, 86, 6); R(c, "#c4231c", 62, 56, 38, 12); R(c, "#9fc3d6", 66, 58, 14, 8); R(c, "#9fc3d6", 82, 58, 14, 8);
  R(c, "#22262c", 22, 82, 94, 4); R(c, "#ffe9a8", 108, 70, 4, 4); R(c, "#ff2a1a", 26, 70, 2, 4);
  R(c, "#14171c", 64, 54, 36, 2); for (const x of [38, 94]) { R(c, "#0d0d0f", x - 2, 76, 20, 20); R(c, "#9aa0a8", x + 3, 81, 10, 10); R(c, "#2a2d31", x + 6, 84, 4, 4); }
  R(c, "#ffe9a8", 70, 52, 24, 2);                                                           // light bar
  // you, leaning on the hood: hard hat, vest-free
  R(c, "#2f5f8f", 44, 48, 12, 14); R(c, "#8a7a5a", 44, 62, 12, 10); R(c, "#e0b48f", 46, 38, 8, 9); R(c, "#2a1c10", 46, 37, 8, 3); R(c, "#f4f4f4", 45, 34, 10, 5); R(c, "#d9d9d9", 43, 38, 14, 1);
  R(c, "#1b1f26", 47, 41, 6, 2); R(c, "#2f5f8f", 40, 50, 4, 10); R(c, "#2f5f8f", 56, 50, 4, 10); R(c, "#2b2118", 40, 60, 4, 3);
  // clipboard
  R(c, "#6a4a2a", 36, 54, 8, 10); R(c, "#f4efe1", 37, 55, 6, 8); R(c, "#222", 38, 57, 4, 1); R(c, "#222", 38, 59, 3, 1);
  // stars
  const r = rnd(11); for (let i = 0; i < 40; i++) R(c, "#fff", r() * W, r() * 30, 1, 1);
}

const SLIDES: { draw: (c: Ctx) => void; text: string }[] = [
  { draw: slideBoardroom, text: "Houston. A brand-new oil and gas operator. Every executive is an AI agent." },
  { draw: slideContract, text: "They wanted AI for everything, so they hired the best-sounding drilling contractor on the list…" },
  { draw: (c) => slideContract(c, true), text: "…and signed \"AI Drilling.\" The contract says AL Drilling. A lowercase L. Nobody read it." },
  { draw: slideRig, text: "Rig 107, west Texas. A real crew, a real well, and executives who answer every problem with \"Great insight!\"" },
  { draw: slideYou, text: "You're the Company Man. Keep it all together." },
];

export class Story {
  private i = 0; private done: () => void = () => {}; private typing = 0; private full = ""; private n = 0;
  private root = document.getElementById("story")!;
  private cv = document.getElementById("storyCv") as HTMLCanvasElement;
  private cap = document.getElementById("storyCap")!;
  private key = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === "Escape") { e.preventDefault(); this.end(); }
    else if (e.code === "Enter" || e.code === "Space" || e.code === "ArrowRight") { e.preventDefault(); this.next(); }
  };

  play(done: () => void) {
    this.done = done; this.i = 0;
    this.cv.width = W; this.cv.height = H;
    this.root.style.display = "grid"; this.root.classList.remove("out");
    document.getElementById("storyNext")!.onclick = () => this.next();
    document.getElementById("storySkip")!.onclick = () => this.end();
    window.addEventListener("keydown", this.key);
    this.show();
  }

  private show() {
    const s = SLIDES[this.i];
    this.cv.classList.remove("in"); void this.cv.offsetWidth; this.cv.classList.add("in");
    const c = this.cv.getContext("2d")!; c.clearRect(0, 0, W, H); s.draw(c);
    // vignette + scanlines baked into the pixels
    for (let y = 0; y < H; y += 2) { c.fillStyle = "rgba(0,0,0,0.10)"; c.fillRect(0, y, W, 1); }
    this.full = s.text; this.n = 0; this.cap.textContent = "";
    clearInterval(this.typing);
    this.typing = window.setInterval(() => { this.n++; this.cap.textContent = this.full.slice(0, this.n); if (this.n >= this.full.length) clearInterval(this.typing); }, 24);
    document.getElementById("storyDots")!.innerHTML = SLIDES.map((_, k) => `<i class="${k === this.i ? "on" : ""}"></i>`).join("");
    (document.getElementById("storyNext") as HTMLElement).textContent = this.i === SLIDES.length - 1 ? "START SHIFT" : "NEXT";
  }

  private next() {
    if (this.n < this.full.length) { this.n = this.full.length; this.cap.textContent = this.full; clearInterval(this.typing); return; }
    if (++this.i >= SLIDES.length) { this.end(); return; }
    this.show();
  }

  private end() {
    clearInterval(this.typing); window.removeEventListener("keydown", this.key);
    this.root.classList.add("out");
    window.setTimeout(() => { this.root.style.display = "none"; this.done(); }, 450);
  }
}
