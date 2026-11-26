/** Pixel-art mission cards: a 192x108 scene drawn for each job, shown (scaled up, nearest-neighbour) when a job is handed out. */
const W = 192, H = 108;
type C = CanvasRenderingContext2D;
const R = (c: C, col: string, x: number, y: number, w: number, h: number) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const rnd = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function mix(a: string, b: string, t: number) {
  const p = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
const sky = (c: C, top: string, bot: string, to = 74) => { for (let y = 0; y < to; y += 2) R(c, mix(top, bot, y / to), 0, y, W, 2); };
const ground = (c: C, col: string, y = 74, dark?: string) => { R(c, col, 0, y, W, H - y); if (dark) for (let x = 0; x < W; x += 6) R(c, dark, x, y + 2 + ((x * 7) % 11), 3, 1); };
const disc = (c: C, col: string, cx: number, cy: number, r: number) => { for (let dy = -r; dy <= r; dy++) { const w = Math.round(Math.sqrt(r * r - dy * dy)); R(c, col, cx - w, cy + dy, w * 2 + 1, 1); } };
const line = (c: C, col: string, x0: number, y0: number, x1: number, y1: number, th = 1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) R(c, col, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, th, th); };
function derrick(c: C, x: number, base: number, h: number, col = "#2a2f38", hi = "#e8a21c") {
  for (let i = 0; i < h; i++) { const hw = 2 + (h - i) * 0.26; R(c, col, x - hw, base - i, 2, 1); R(c, col, x + hw - 1, base - i, 2, 1); if (i % 9 === 0) R(c, col, x - hw, base - i, hw * 2, 1); }
  R(c, hi, x - 3, base - h - 3, 6, 3); R(c, "#ff4a3a", x - 1, base - h - 6, 2, 3);
}
function deer(c: C, x: number, y: number, col = "#8a5a32", s = 1) {
  R(c, col, x, y, 18 * s, 8 * s); R(c, col, x + 14 * s, y - 7 * s, 4 * s, 9 * s); R(c, col, x + 14 * s, y - 10 * s, 7 * s, 4 * s);
  for (const lx of [1, 4, 13, 16]) R(c, col, x + lx * s, y + 8 * s, 1.6 * s, 9 * s);
  R(c, "#e8dcc0", x, y + 2 * s, 2 * s, 3 * s); R(c, "#1a1008", x + 19 * s, y - 9 * s, 1 * s, 1 * s);
  for (const ax of [15, 19]) { R(c, "#d8c8a0", x + ax * s, y - 15 * s, 1 * s, 6 * s); R(c, "#d8c8a0", x + (ax - 2) * s, y - 15 * s, 3 * s, 1 * s); R(c, "#d8c8a0", x + (ax + 1) * s, y - 12 * s, 3 * s, 1 * s); }
}
function tree(c: C, x: number, base: number, h: number, a: string, b: string) { R(c, "#4a3322", x - 1, base - h * 0.4, 3, h * 0.4); disc(c, a, x, base - h * 0.6, h * 0.34); disc(c, b, x - 2, base - h * 0.7, h * 0.22); }
function turbine(c: C, x: number, base: number, h: number, t: number) {
  R(c, "#e8eaec", x - 1, base - h, 3, h); R(c, "#c8ccd0", x, base - h, 1, h);
  for (let k = 0; k < 3; k++) { const a = t + (k * Math.PI * 2) / 3; line(c, "#f4f6f8", x + 1, base - h, x + 1 + Math.cos(a) * h * 0.55, base - h + Math.sin(a) * h * 0.55, 2); }
  disc(c, "#9aa4ae", x + 1, base - h, 2);
}

type Scene = (c: C) => void;
const SCENES: Record<string, Scene> = {
  // the gate shack and a big hard hat
  ppe: (c) => {
    sky(c, "#3a3f78", "#f0a050"); disc(c, "#ffd88a", 176, 46, 9); ground(c, "#3a2c20", 74, "#4a3a2c");
    R(c, "#5a6270", 14, 52, 50, 24); R(c, "#3a4250", 12, 48, 54, 5); R(c, "#9fd3e8", 20, 58, 14, 9); R(c, "#9fd3e8", 40, 58, 14, 9);
    R(c, "#e8a21c", 90, 26, 4, 50); for (let i = 0; i < 4; i++) R(c, i % 2 ? "#1b1e23" : "#e8a21c", 70 + i * 4, 24, 4, 3);
    const cx = 120, by = 66;
    for (let y = by - 20; y <= by; y++) { const dy = by - y, hw = Math.round(Math.sqrt(Math.max(0, 22 * 22 - dy * dy * 1.2))); R(c, "#ffd21a", cx - hw, y, hw * 2, 1); }
    R(c, "#e6b800", cx - 3, by - 22, 6, 22); R(c, "#fff0a0", cx - 14, by - 15, 5, 2); R(c, "#ffd21a", cx - 30, by, 60, 4); R(c, "#c9a000", cx - 30, by + 3, 60, 2);
    R(c, "#3ddc84", cx + 22, by - 30, 4, 12); R(c, "#3ddc84", cx + 18, by - 22, 4, 4);
  },
  // the autodriller: a dial and four set-point bars
  auto: (c) => {
    R(c, "#10151c", 0, 0, W, H); R(c, "#1b2430", 8, 8, 176, 92); R(c, "#06090d", 12, 12, 168, 84);
    disc(c, "#1f2c3a", 58, 58, 34); disc(c, "#06090d", 58, 58, 30);
    for (let a = -2.4; a <= 2.4; a += 0.3) { const x0 = 58 + Math.sin(a) * 26, y0 = 58 - Math.cos(a) * 26, x1 = 58 + Math.sin(a) * 30, y1 = 58 - Math.cos(a) * 30; line(c, a > 1.2 ? "#ff5a5a" : "#6ff08c", x0, y0, x1, y1); }
    line(c, "#ffd24a", 58, 58, 58 + Math.sin(0.7) * 24, 58 - Math.cos(0.7) * 24, 2); disc(c, "#ffd24a", 58, 58, 3);
    const cols = ["#6ff08c", "#4ad8ff", "#f4c04a", "#ff9f43"], hs = [52, 38, 60, 30];
    cols.forEach((col, i) => { R(c, "#1a2430", 106 + i * 18, 22, 12, 62); R(c, col, 106 + i * 18, 84 - hs[i], 12, hs[i]); R(c, "#fff", 104 + i * 18, 84 - hs[i] - 1, 16, 2); });
    R(c, "#6ff08c", 20, 90, 30, 3); R(c, "#ff5a5a", 150, 90, 24, 3);
  },
  // a kick: alarm light and mud blowing out of the hole
  kick: (c) => {
    sky(c, "#2a0e12", "#6a2a1e"); ground(c, "#2c2218", 74); derrick(c, 96, 74, 56);
    for (let i = 0; i < 40; i++) { const a = rnd(i + 3)() * 1.2 - 0.6, d = 6 + ((i * 13) % 30); R(c, i % 3 ? "#6b4a2a" : "#3a2a1a", 96 + Math.sin(a) * d * 1.4, 60 - d, 2, 3); }
    disc(c, "#ff3a2a", 28, 24, 8); disc(c, "#ffb0a0", 28, 24, 3); for (let k = 0; k < 8; k++) line(c, "#ff5a4a", 28, 24, 28 + Math.cos(k * 0.8) * 18, 24 + Math.sin(k * 0.8) * 18);
  },
  // the asteroid
  // a comet the size of Texas, burning in over the rig: a jagged glowing head, a long streaming tail, sparks, and a lit horizon
  armageddon: (c) => {
    sky(c, "#07030f", "#d4501a", 84);
    const rn = rnd(11); for (let i = 0; i < 60; i++) { const x = rn() * W, y = rn() * 60; R(c, rn() < 0.2 ? "#ffd8a0" : "#fff", x, y, 1, 1); }
    // the glow of the horizon, and a hot haze low in the sky
    for (let y = 56; y < 84; y++) { c.fillStyle = "rgba(255,140,40," + ((y - 56) / 28) * 0.28 + ")"; c.fillRect(0, y, W, 1); }
    const hx = 124, hy = 38, dx = 0.93, dy = -0.37;   // the head, and the direction the tail streams (up and to the right)
    // the tail: hundreds of streaks fanning out behind it, white-hot near the head and fading to red
    const rt = rnd(3);
    for (let i = 0; i < 900; i++) {
      const d = Math.pow(rt(), 0.7) * 150, spread = (rt() - 0.5) * (6 + d * 0.34), px = hx + dx * d - dy * spread, py = hy + dy * d + dx * spread, u = d / 150;
      const col = u < 0.12 ? "#fff6d0" : u < 0.3 ? "#ffd070" : u < 0.55 ? "#ff9a30" : u < 0.8 ? "#e5481a" : "#8a2a1a";
      if (px > -2 && px < W && py > -2 && py < H) R(c, col, px, py, rt() < 0.4 ? 2 : 1, 1);
    }
    for (let k = 0; k < 7; k++) line(c, k < 2 ? "#fff0b0" : k < 4 ? "#ffb040" : "#e5481a", hx, hy + (k - 3) * 2.2, hx + dx * (60 + k * 14), hy + dy * (60 + k * 14) + (k - 3) * 2.6, 1);
    // the coma: soft rings of fire round the head
    for (const [r, col] of [[38, "rgba(255,90,20,0.10)"], [30, "rgba(255,130,30,0.16)"], [24, "rgba(255,180,60,0.22)"], [19, "rgba(255,226,140,0.3)"]] as [number, string][]) { c.fillStyle = col; for (let yy = -r; yy <= r; yy++) { const w = Math.round(Math.sqrt(r * r - yy * yy)); c.fillRect(hx - w, hy + yy, w * 2 + 1, 1); } }
    // the rock: a jagged lump, lit orange on the side that is burning (down-left, the way it is flying) and dark on the other
    const nz = rnd(17), jag: number[] = []; for (let i = 0; i < 24; i++) jag.push(0.78 + nz() * 0.42);
    const rad = (ang: number) => { const f = ((ang + Math.PI) / (Math.PI * 2)) * 24, i0 = Math.floor(f) % 24, i1 = (i0 + 1) % 24, k = f - Math.floor(f); return 16 * (jag[i0] * (1 - k) + jag[i1] * k); };
    for (let yy = -22; yy <= 22; yy++) for (let xx = -22; xx <= 22; xx++) {
      const d = Math.hypot(xx, yy); if (d > rad(Math.atan2(yy, xx))) continue;
      const lit = (-xx * -dx + yy * -dy) / (d || 1) * -1;   // toward the leading (down-left) edge
      const l = Math.max(0, Math.min(1, 0.5 + 0.5 * ((-xx * dx - yy * dy) / (d + 4)) * -1));
      const base = l > 0.78 ? "#ffcf70" : l > 0.62 ? "#e8802a" : l > 0.45 ? "#8a5236" : l > 0.3 ? "#5a3a2c" : "#2c1c1a";
      void lit; R(c, base, hx + xx, hy + yy, 1, 1);
    }
    for (const [cx, cy, cr] of [[-4, -3, 4], [5, 4, 3], [-1, 7, 2], [6, -5, 2]] as number[][]) disc(c, "#2a1a18", hx + cx, hy + cy, cr);
    disc(c, "#fff4c0", hx - 7, hy + 4, 2);
    // sparks and burning fragments breaking off
    const rs = rnd(23); for (let i = 0; i < 26; i++) { const d = 14 + rs() * 40, an = Math.atan2(dy, dx) + (rs() - 0.5) * 1.4; R(c, rs() < 0.5 ? "#ffd070" : "#ff6a20", hx + Math.cos(an) * d, hy + Math.sin(an) * d, 1 + (rs() < 0.3 ? 1 : 0), 1); }
    for (const [fx, fy] of [[102, 52], [96, 60], [108, 62]] as number[][]) { disc(c, "#ff8a30", fx, fy, 1); R(c, "#ffd070", fx + 2, fy - 1, 3, 1); }
    ground(c, "#1a0e0a", 84, "#2a1810"); derrick(c, 40, 84, 36, "#0c0806");
    for (let x = 0; x < W; x += 3) R(c, "rgba(255,120,40,0.4)", x, 84, 2, 1);
  },
  deer: (c) => {
    sky(c, "#4a5a9a", "#f0b070"); ground(c, "#5a6a32", 70, "#6a7a3c"); derrick(c, 160, 70, 40, "#22262e");
    R(c, "#9aa0a8", 30, 66, 40, 5); R(c, "#e8a21c", 34, 58, 6, 8); deer(c, 84, 52, "#8a5a32", 1.5);
  },
  // AGI Drilling: a clean white tower, a cyan laser, an android
  secrets: (c) => {
    sky(c, "#050a18", "#10303f", 78); const r = rnd(9); for (let i = 0; i < 30; i++) R(c, "#cfeaff", r() * W, r() * 46, 1, 1);
    ground(c, "#0a1620", 78); for (let x = 0; x < W; x += 12) R(c, "#1b8aa0", x, 78, 1, H - 78);
    for (let y = 18; y < 78; y++) { const hw = 3 + (78 - y) * 0.09; R(c, "#e6eef6", 56 - hw, y, hw * 2, 1); if (y % 8 === 0) R(c, "#2ee6ff", 56 - hw, y, hw * 2, 1); }
    disc(c, "#2ee6ff", 56, 14, 6); disc(c, "#c8fbff", 56, 14, 3); R(c, "#2ee6ff", 55, 0, 2, 8); R(c, "#2ee6ff", 54, 78, 4, 30);
    R(c, "#e6eef6", 120, 54, 18, 22); R(c, "#aab6c4", 120, 36, 18, 16); R(c, "#10151c", 122, 41, 14, 5); R(c, "#ff3ad6", 124, 43, 3, 2); R(c, "#ff3ad6", 131, 43, 3, 2); R(c, "#ff3ad6", 128, 28, 2, 8);
    R(c, "#e6eef6", 108, 56, 8, 18); R(c, "#e6eef6", 142, 56, 8, 18); R(c, "#2a3446", 122, 76, 6, 16); R(c, "#2a3446", 130, 76, 6, 16);
    R(c, "#3ddc84", 160, 62, 20, 14); R(c, "#06101a", 162, 64, 16, 8); R(c, "#6ff08c", 164, 66, 8, 1); R(c, "#6ff08c", 164, 69, 12, 1);
  },
  inspect: (c) => {
    sky(c, "#4a8ad8", "#d8ecff"); R(c, "#fff", 18, 22, 22, 5); R(c, "#fff", 26, 18, 14, 5); R(c, "#fff", 140, 14, 26, 5); ground(c, "#7a6a4a", 80, "#8a7a56");
    derrick(c, 80, 80, 70); for (const [x, y] of [[74, 62], [86, 46], [76, 32], [84, 22]]) { disc(c, "#ff3a2a", x, y, 2); }
    const dx = 134, dy = 36; R(c, "#1b1e23", dx - 7, dy, 14, 4); R(c, "#e8ecef", dx - 11, dy - 2, 8, 1); R(c, "#e8ecef", dx + 3, dy - 2, 8, 1); R(c, "#2a7cff", dx - 1, dy + 4, 3, 3);
    for (let k = 0; k < 6; k++) R(c, "rgba(255,255,255,.35)", dx - 2 - k * 3, dy + 7 + k * 3, 6 + k, 1);
  },
  hunt: (c) => {
    sky(c, "#7a9a6a", "#e8d8a0"); ground(c, "#3a4a22", 76, "#4a5a2a");
    for (let i = 0; i < 12; i++) tree(c, 8 + i * 17 + (i % 3) * 3, 76 + (i % 2) * 6, 34 + (i * 7) % 16, "#2c4a22", "#3d5a2a");
    deer(c, 96, 68, "#8a5a32", 0.9);
    disc(c, "#00000000", 104, 66, 1); for (let a = 0; a < 6.3; a += 0.12) R(c, "#111", 104 + Math.cos(a) * 24, 66 + Math.sin(a) * 24, 2, 2);
    R(c, "#111", 104, 38, 1, 56); R(c, "#111", 76, 66, 56, 1);
  },
  windmill: (c) => {
    sky(c, "#4a8ad8", "#f0e0b8"); ground(c, "#a08a58", 78, "#b09a68"); turbine(c, 54, 78, 54, 0.5); turbine(c, 122, 78, 40, 1.4); turbine(c, 164, 78, 30, 2.2);
    R(c, "#e5483b", 80, 82, 22, 14); R(c, "#fff", 84, 86, 14, 2); R(c, "#fff", 84, 90, 8, 2);
  },
  // Old Sixty
  sixty: (c) => {
    sky(c, "#6a8ab8", "#c8dcee", 40); for (let y = 40; y < H; y += 2) R(c, mix("#3a7a9a", "#0a2a3a", (y - 40) / 68), 0, y, W, 2);
    R(c, "#2a4a5a", 0, 40, W, 1);
    const bx = 56, by = 70;
    for (let x = 0; x < 84; x++) { const u = x / 84, hh = Math.round(14 * Math.sin(Math.PI * Math.pow(u, 0.8))); R(c, "#4a5a46", bx + x, by - hh, 1, hh * 2); R(c, "#b8b8a0", bx + x, by + hh * 0.3, 1, hh * 0.7); }
    R(c, "#3a4a38", bx + 82, by - 8, 14, 16); R(c, "#4a5a46", bx + 84, by - 6, 12, 12); R(c, "#fff", bx + 18, by - 5, 3, 3); R(c, "#111", bx + 19, by - 4, 1, 1);
    for (let k = 0; k < 4; k++) { R(c, "#3a4a38", bx + 18 + k * 3, by + 6, 1, 9); } R(c, "#4a5a46", bx + 2, by - 12, 14, 6);
    line(c, "#e8f0f4", 150, 18, 150, 38); disc(c, "#e5483b", 150, 40, 3); R(c, "#fff", 148, 40, 5, 1);
  },
};
const DEFAULT: Scene = (c) => { sky(c, "#2a3a6a", "#f0a050"); disc(c, "#ffd88a", 140, 60, 12); ground(c, "#3a2c20", 74, "#4a3a2c"); derrick(c, 80, 74, 52); };

export function drawMissionArt(cv: HTMLCanvasElement, id: string) {
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d")!; c.imageSmoothingEnabled = false; c.clearRect(0, 0, W, H);
  (SCENES[id] ?? DEFAULT)(c);
  for (let y = 0; y < H; y += 2) { c.fillStyle = "rgba(0,0,0,0.10)"; c.fillRect(0, y, W, 1); }
}
