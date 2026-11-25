// The drilling recorder: rock strength, WOB, differential pressure, torque and ROP on one strip chart, sampled fast enough to show the bounce.
import { FORMATIONS, formationAt, STALL_DP, TORQUE_MAX } from "./sim";

export interface RecSample { depth: number; wob: number; rop: number; dp: number; torque: number; bounce: number; stalled: boolean; drilling: boolean; }

const N = 240, HZ = 8;
const H = { hard: [] as number[], wob: [] as number[], dp: [] as number[], tq: [] as number[], rop: [] as number[], bounce: [] as number[], col: [] as string[] };
let acc = 0, cur: RecSample = { depth: 0, wob: 0, rop: 0, dp: 0, torque: 0, bounce: 0, stalled: false, drilling: false };
export const UCS = (h: number) => Math.round(h * 11000);   // rock strength in psi, from the formation's hardness

/** call every frame with real seconds and the live numbers */
export function recTick(dt: number, s: RecSample) {
  cur = s; acc += dt;
  while (acc >= 1 / HZ) {
    acc -= 1 / HZ;
    const f = formationAt(s.depth);
    const push = (a: number[], v: number) => { a.push(v); if (a.length > N) a.shift(); };
    push(H.hard, f.hardness); push(H.wob, s.wob); push(H.dp, s.dp); push(H.tq, s.torque); push(H.rop, s.rop); push(H.bounce, s.bounce);
    H.col.push(f.color); if (H.col.length > N) H.col.shift();
  }
}

export function drawRecorder(c: CanvasRenderingContext2D, w: number, h: number) {
  const sm = w < 400, fs = sm ? 8 : 11, pad = sm ? 3 : 6;
  c.save(); c.textBaseline = "middle"; c.lineWidth = 1;
  c.fillStyle = "#06090d"; c.fillRect(0, 0, w, h);
  const f = formationAt(cur.depth);
  const rows: { key: keyof typeof H; label: string; unit: string; col: string; max: number; v: number; lines?: [number, string][] }[] = [
    { key: "hard", label: "ROCK STRENGTH", unit: "psi", col: "#d8b96a", max: 1.4, v: f.hardness },
    { key: "wob", label: "WOB", unit: "klb", col: "#ffeb3b", max: 80, v: cur.wob },
    { key: "dp", label: "DIFF PRESS", unit: "psi", col: "#ff4dff", max: 2400, v: cur.dp, lines: [[1650, "#ffb02a"], [STALL_DP, "#ff4a3a"]] },
    { key: "tq", label: "TORQUE", unit: "ft-lb", col: "#4fd6ff", max: 20000, v: cur.torque, lines: [[TORQUE_MAX, "#ff4a3a"]] },
    { key: "rop", label: "ROP", unit: "ft/hr", col: "#76ff03", max: 600, v: cur.rop },
  ];
  const top = sm ? 14 : 22, gap = 3, rh = (h - top - gap * rows.length) / rows.length, lw = sm ? 0 : 118, x0 = pad + lw, x1 = w - pad - (sm ? 0 : 74);
  c.font = `bold ${fs}px monospace`; c.textAlign = "left"; c.fillStyle = "#8fb2cc"; c.fillText("DRILLING RECORDER", pad, top / 2);
  c.textAlign = "right"; const alert = cur.stalled ? "MOTOR STALLED" : cur.bounce > 0.12 ? "BIT BOUNCE — EASE OFF THE WEIGHT" : ""; c.fillStyle = "#ff4a3a"; if (alert && (Math.floor(performance.now() / 400) % 2 === 0 || sm)) c.fillText(alert, w - pad, top / 2);
  rows.forEach((r, i) => {
    const y = top + i * (rh + gap), a = H[r.key] as number[];
    c.fillStyle = "#0b1118"; c.fillRect(x0, y, x1 - x0, rh); c.strokeStyle = "#1c2a38"; c.strokeRect(x0 + 0.5, y + 0.5, x1 - x0 - 1, rh - 1);
    for (let k = 1; k < 6; k++) { const gx = x0 + ((x1 - x0) * k) / 6; c.beginPath(); c.moveTo(gx, y); c.lineTo(gx, y + rh); c.stroke(); }
    // rock strength: coloured formation bands behind the line
    if (r.key === "hard") { const bw = (x1 - x0) / N; H.col.forEach((col, k) => { c.fillStyle = col + "33"; c.fillRect(x0 + k * bw, y, bw + 1, rh); }); }
    for (const [lv, lc] of r.lines ?? []) { const ly = y + rh - Math.min(1, lv / r.max) * rh; c.strokeStyle = lc; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(x0, ly); c.lineTo(x1, ly); c.stroke(); c.setLineDash([]); }
    c.strokeStyle = r.col; c.lineWidth = sm ? 1.2 : 1.6; c.beginPath();
    a.forEach((v, k) => { const px = x0 + (k / (N - 1)) * (x1 - x0), py = y + rh - Math.max(0, Math.min(1, v / r.max)) * (rh - 2) - 1; k ? c.lineTo(px, py) : c.moveTo(px, py); }); c.stroke(); c.lineWidth = 1;
    if (!sm) {
      c.font = `bold ${fs}px monospace`; c.textAlign = "left"; c.fillStyle = r.col; c.fillText(r.label, pad, y + rh / 2);
      c.textAlign = "right"; c.fillStyle = "#e6f0f8";
      const txt = r.key === "hard" ? UCS(r.v).toLocaleString("en-US") : Math.round(r.v).toLocaleString("en-US");
      c.fillText(txt, w - pad - 28, y + rh / 2); c.fillStyle = "#6f8aa1"; c.font = `${fs - 2}px monospace`; c.textAlign = "left"; c.fillText(r.unit, w - pad - 25, y + rh / 2);
    } else { c.font = `bold ${fs}px monospace`; c.textAlign = "left"; c.fillStyle = r.col; c.fillText(r.label + " " + (r.key === "hard" ? UCS(r.v) : Math.round(r.v)), x0 + 3, y + 6); }
  });
  // what is coming: the next formation down the hole and how hard it is
  const next = FORMATIONS.find((q) => q.limit > cur.depth && q.name !== f.name) ?? null, nf = FORMATIONS[FORMATIONS.indexOf(f) + 1];
  void next;
  if (nf && !sm && !(cur.stalled || cur.bounce > 0.12)) { c.font = `${fs}px monospace`; c.textAlign = "left"; c.fillStyle = "#6f8aa1"; c.fillText(`${f.name} · ${UCS(f.hardness).toLocaleString("en-US")} psi    next: ${nf.name} in ${Math.max(0, Math.round(f.limit - cur.depth)).toLocaleString("en-US")} ft (${UCS(nf.hardness).toLocaleString("en-US")} psi${nf.hardness > f.hardness ? ", HARDER — watch the diff" : ", softer"})`, x0, 11); }
  c.restore();
}

export interface AutoView { on: boolean; limit: string; rop: number; wob: number; dp: number; tq: number; sp: { rop: number; wob: number; dp: number; tq: number } }

/** the autodriller's four bars: instantaneous ROP, WOB, diff and torque against their set points (dashed); the one holding the weight down lights up */
export function drawAutoBars(c: CanvasRenderingContext2D, w: number, h: number, a: AutoView) {
  const k = w / 480;
  c.save(); c.fillStyle = "#06090d"; c.fillRect(0, 0, w, h); c.textBaseline = "middle";
  const bars = [
    { k: "ROP", lim: "ROP", v: a.rop, sp: a.sp.rop, max: 600, col: "#76ff03" },
    { k: "WOB", lim: "WOB", v: a.wob, sp: a.sp.wob, max: 80, col: "#ffeb3b" },
    { k: "DIFF", lim: "DIFF", v: a.dp, sp: a.sp.dp, max: 2400, col: "#ff4dff" },
    { k: "TQ", lim: "TORQUE", v: a.tq, sp: a.sp.tq, max: 20000, col: "#4fd6ff" },
  ];
  const bw = 74 * k, gap = (w - bars.length * bw) / (bars.length + 1), top = 18 * k + 2, bot = h - 40 * k, bh = bot - top;
  bars.forEach((b, i) => {
    const x = gap + i * (bw + gap), hit = a.on && a.limit === b.lim, fy = (v: number) => bot - Math.max(0, Math.min(1, v / b.max)) * bh;
    if (hit) { c.fillStyle = b.col + "26"; c.fillRect(x - 10 * k, 2, bw + 20 * k, h - 4); c.strokeStyle = b.col; c.lineWidth = 2; c.strokeRect(x - 10 * k, 2, bw + 20 * k, h - 4); }
    c.fillStyle = "#0e1822"; c.fillRect(x, top, bw, bh);
    c.fillStyle = b.v > b.sp * 1.0001 ? "#ff4a3a" : b.col; const y = fy(b.v); c.fillRect(x, y, bw, bot - y);
    c.strokeStyle = "#1c2a38"; c.lineWidth = 1; for (let q = 1; q < 5; q++) { const gy = top + (q / 5) * bh; c.beginPath(); c.moveTo(x, gy); c.lineTo(x + bw, gy); c.stroke(); }
    const sy = fy(b.sp); c.strokeStyle = "#fff"; c.lineWidth = Math.max(1, 2 * k); c.setLineDash([6 * k, 4 * k]); c.beginPath(); c.moveTo(x - 6 * k, sy); c.lineTo(x + bw + 6 * k, sy); c.stroke(); c.setLineDash([]);
    c.textAlign = "center"; c.font = "bold " + Math.round(15 * k) + "px monospace"; c.fillStyle = hit ? b.col : "#cfe6f7"; c.fillText(b.k, x + bw / 2, h - 28 * k);
    c.font = "bold " + Math.round(13 * k) + "px monospace"; c.fillStyle = "#e6f0f8"; c.fillText(Math.round(b.v).toLocaleString("en-US"), x + bw / 2, h - 12 * k);
    c.font = Math.round(10 * k) + "px monospace"; c.fillStyle = "#cfe6f7"; c.fillText("SP " + Math.round(b.sp).toLocaleString("en-US"), x + bw / 2, top - 8 * k);
    if (hit) { c.font = "bold " + Math.round(11 * k) + "px monospace"; c.fillStyle = b.col; c.fillText("LIMITING", x + bw / 2, sy < top + 14 * k ? sy + 12 * k : sy - 9 * k); }
  });
  c.font = "bold " + Math.round(11 * k) + "px monospace"; c.textAlign = "left"; c.fillStyle = a.on ? "#3ddc84" : "#ffb02a"; c.fillText(a.on ? "AUTODRILLER ON" : "AUTODRILLER OFF", 4, 8 * k + 1);
  c.restore();
}
