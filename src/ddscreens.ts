// The directional driller's wall of screens, drawn in the EDR's style on the small cabin monitors.
import { Dd, OFFSETS, PLAN, PLAN_PTS, REF, TOL, planAt, vsOf } from "./dd";
import { FORMATIONS, WELL } from "./sim";

const W = 256, H = 160;
const BG = "#0b0e12", PANEL = "#0e1217", EDGE = "#252c35", GRID = "#1a2028", TX = "#e6ebf0", DIM = "#8d98a5";
const GRN = "#3ddc84", AMB = "#e8d34a", RED = "#ff5a4a", BLU = "#6cb4ff", CYN = "#2fd0d0", PNK = "#ff6a7a";
export const DD_KINDS = ["survey", "toolface", "plan", "steer", "geo", "ac"];

function head(c: CanvasRenderingContext2D, title: string, right = "") {
  c.fillStyle = BG; c.fillRect(0, 0, W, H);
  c.fillStyle = "#14181e"; c.fillRect(0, 0, W, 18); c.fillStyle = EDGE; c.fillRect(0, 18, W, 1);
  c.textBaseline = "middle"; c.font = "bold 11px monospace"; c.textAlign = "left"; c.fillStyle = TX; c.fillText(title, 6, 9);
  if (right) { c.textAlign = "right"; c.fillStyle = DIM; c.font = "9px monospace"; c.fillText(right, W - 6, 9); }
  c.strokeStyle = EDGE; c.lineWidth = 1; c.strokeRect(0.5, 0.5, W - 1, H - 1);
}
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sfCol = (sf: number) => (sf < 1 ? RED : sf < 1.5 ? AMB : GRN);

/** returns true when this kind is one of the directional screens */
export function drawDd(kind: string, c: CanvasRenderingContext2D, dd: Dd, t: number): boolean {
  c.lineWidth = 1; c.textBaseline = "middle";
  switch (kind) {
    case "survey": {
      head(c, "MWD SURVEY", dd.lastSurvey.auto ? "last: connection" : "last: check shot");
      const s = dd.lastSurvey, rows: [string, string, string, number, boolean][] = [
        ["Gtotal", fmt(s.g, 1), "mG", Math.abs(s.g - REF.g) / TOL.g, Math.abs(s.g - REF.g) <= TOL.g],
        ["Btotal", fmt(s.b), "nT", Math.abs(s.b - REF.b) / TOL.b, Math.abs(s.b - REF.b) <= TOL.b],
        ["Dip", s.dip.toFixed(2), "°", Math.abs(s.dip - REF.dip) / TOL.dip, Math.abs(s.dip - REF.dip) <= TOL.dip],
      ];
      rows.forEach(([n, v, u, r, ok], i) => {
        const y = 32 + i * 22;
        c.textAlign = "left"; c.font = "9px monospace"; c.fillStyle = DIM; c.fillText(n, 8, y - 6);
        c.font = "bold 15px monospace"; c.fillStyle = ok ? TX : RED; c.fillText(v, 8, y + 6); c.font = "9px monospace"; c.fillStyle = DIM; c.fillText(u, 8 + v.length * 9 + 4, y + 7);
        // tolerance bar: centre = reference, the ends are the limits
        const x0 = 124, w = 126; c.fillStyle = PANEL; c.fillRect(x0, y - 2, w, 8); c.strokeStyle = EDGE; c.strokeRect(x0 + 0.5, y - 1.5, w - 1, 7);
        c.fillStyle = "#1c5a34"; c.fillRect(x0 + w * 0.25, y - 2, w * 0.5, 8);
        const px = x0 + w / 2 + Math.max(-1, Math.min(1, ((n === "Gtotal" ? s.g - REF.g : n === "Btotal" ? s.b - REF.b : s.dip - REF.dip) / (n === "Gtotal" ? TOL.g : n === "Btotal" ? TOL.b : TOL.dip)))) * w * 0.25;
        c.fillStyle = ok ? GRN : RED; c.fillRect(px - 1.5, y - 4, 3, 12);
        void r;
      });
      c.textAlign = "left"; c.font = "bold 10px monospace"; c.fillStyle = s.ok ? GRN : RED; c.fillText(s.ok ? "QC PASS" : "QC FAIL — SHOOT AGAIN", 124, 28 + 22 * 3 - 4);
      // the last few stations
      c.font = "8px monospace"; c.fillStyle = DIM; c.fillText("   MD     INC    AZI    QC", 6, 102);
      dd.surveys.slice(-4).reverse().forEach((q, i) => {
        c.fillStyle = q.ok ? TX : RED; c.fillText(`${fmt(q.md).padStart(6)}  ${q.inc.toFixed(1).padStart(5)}  ${q.azi.toFixed(1).padStart(5)}   ${q.ok ? "ok" : "FAIL"} ${q.auto ? "" : "*"}`, 6, 114 + i * 11);
      });
      c.fillStyle = DIM; c.textAlign = "right"; c.fillText(`since survey ${Math.round(dd.bit.md - s.md)} ft`, W - 6, 152);
      return true;
    }
    case "toolface": {
      head(c, "TOOLFACE", dd.mode === "rotate" ? "ROTATING" : dd.mode === "slide" ? "SLIDING" : "OSC SLIDE");
      const cx = 78, cy = 92, R = 56;
      c.fillStyle = PANEL; c.beginPath(); c.arc(cx, cy, R, 0, 6.3); c.fill(); c.strokeStyle = EDGE; c.stroke();
      for (let a = 0; a < 360; a += 30) { const r = (a - 90) * Math.PI / 180; c.beginPath(); c.moveTo(cx + Math.cos(r) * (R - (a % 90 ? 4 : 8)), cy + Math.sin(r) * (R - (a % 90 ? 4 : 8))); c.lineTo(cx + Math.cos(r) * R, cy + Math.sin(r) * R); c.stroke(); }
      c.font = "bold 9px monospace"; c.textAlign = "center"; c.fillStyle = DIM;
      c.fillText("HS", cx, cy - R + 14); c.fillText("R", cx + R - 12, cy + 1); c.fillText("LS", cx, cy + R - 14); c.fillText("L", cx - R + 12, cy + 1);
      const needle = (deg: number, col: string, len: number, w: number) => { const r = (deg - 90) * Math.PI / 180; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(r) * len, cy + Math.sin(r) * len); c.stroke(); c.lineWidth = 1; };
      needle(dd.tfSet, AMB, R - 6, 2); needle(dd.tf, CYN, R - 14, 4);
      c.textAlign = "left"; c.font = "9px monospace"; c.fillStyle = DIM; c.fillText("SET", 150, 40); c.fillText("ACTUAL", 150, 78);
      c.font = "bold 18px monospace"; c.fillStyle = AMB; c.fillText(Math.round(dd.tfSet) + "°", 150, 54); c.fillStyle = CYN; c.fillText(Math.round(dd.tf) + "°", 150, 92);
      c.font = "9px monospace"; c.fillStyle = DIM; c.fillText(dd.mode === "rotate" ? "toolface idle" : "build " + (Math.cos(dd.tf * Math.PI / 180) * (dd.mode === "slide" ? 3 : 2.2)).toFixed(1) + "°/100", 150, 114);
      c.fillText(dd.mode === "rotate" ? "" : "turn  " + (Math.sin(dd.tf * Math.PI / 180) * (dd.mode === "slide" ? 3 : 2.2)).toFixed(1) + "°/100", 150, 126);
      return true;
    }
    case "plan": {
      head(c, "DIRECTIONAL PLAN", `KOP ${fmt(PLAN.kop)}  BUR ${PLAN.bur}°/100`);
      // left: plan view, north up
      const L = { x: 6, y: 24, w: 100, h: 100 };
      c.fillStyle = PANEL; c.fillRect(L.x, L.y, L.w, L.h); c.strokeStyle = EDGE; c.strokeRect(L.x + 0.5, L.y + 0.5, L.w - 1, L.h - 1);
      const b = dd.bit, pn = (n: number) => L.y + L.h / 2 - ((n - b.n) / 90) * (L.h / 2), pe = (e: number) => L.x + L.w / 2 + ((e - b.e) / 90) * (L.w / 2);
      c.save(); c.beginPath(); c.rect(L.x, L.y, L.w, L.h); c.clip();
      c.strokeStyle = GRID; for (let k = -90; k <= 90; k += 30) { c.beginPath(); c.moveTo(pe(b.e + k), L.y); c.lineTo(pe(b.e + k), L.y + L.h); c.moveTo(L.x, pn(b.n + k)); c.lineTo(L.x + L.w, pn(b.n + k)); c.stroke(); }
      OFFSETS.forEach((o, i) => { c.strokeStyle = i ? "#8a5a5a" : PNK; c.setLineDash([3, 2]); c.beginPath(); o.pts.forEach((q, k) => { const x = pe(q.e), y = pn(q.n); k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.setLineDash([]); });
      c.strokeStyle = "#5b6672"; c.beginPath(); PLAN_PTS.forEach((q, k) => { const x = pe(q.e), y = pn(q.n); k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
      c.strokeStyle = GRN; c.lineWidth = 2; c.beginPath(); dd.path.forEach((q, k) => { const x = pe(q.e), y = pn(q.n); k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.lineWidth = 1;
      c.fillStyle = TX; c.beginPath(); c.arc(pe(b.e), pn(b.n), 3, 0, 6.3); c.fill();
      c.restore();
      c.font = "8px monospace"; c.fillStyle = DIM; c.textAlign = "left"; c.fillText("PLAN VIEW  N↑  ±90 ft", L.x + 2, L.y + L.h + 8);
      // right: section (vertical section vs TVD) with the whole plan, the actual hole and the bit
      const S = { x: 114, y: 24, w: 136, h: 100 }, vsMax = Math.max(1200, vsOf(PLAN_PTS[PLAN_PTS.length - 1]));
      c.fillStyle = PANEL; c.fillRect(S.x, S.y, S.w, S.h); c.strokeStyle = EDGE; c.strokeRect(S.x + 0.5, S.y + 0.5, S.w - 1, S.h - 1);
      const sx = (vs: number) => S.x + 4 + (vs / vsMax) * (S.w - 8), sy = (tvd: number) => S.y + 4 + ((tvd - WELL.startDepth) / (8800 - WELL.startDepth)) * (S.h - 8);
      c.strokeStyle = "#5b6672"; c.beginPath(); PLAN_PTS.forEach((q, k) => { const x = sx(vsOf(q)), y = sy(q.tvd); k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
      c.strokeStyle = GRN; c.lineWidth = 2; c.beginPath(); dd.path.forEach((q, k) => { const x = sx(vsOf(q)), y = sy(q.tvd); k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.lineWidth = 1;
      c.fillStyle = AMB; c.fillRect(S.x + 2, sy(PLAN.kop) - 0.5, 8, 1); c.font = "7px monospace"; c.textAlign = "left"; c.fillText("KOP", S.x + 12, sy(PLAN.kop));
      c.fillStyle = TX; c.beginPath(); c.arc(sx(vsOf(b)), sy(b.tvd), 3, 0, 6.3); c.fill();
      c.fillStyle = DIM; c.font = "8px monospace"; c.fillText("SECTION  TVD↓  VS→", S.x + 2, S.y + S.h + 8);
      const d = dd.toPlan, col = d.dist > PLAN.tol ? RED : d.dist > PLAN.tol * 0.6 ? AMB : GRN;
      c.font = "bold 9px monospace"; c.fillStyle = col; c.textAlign = "left";
      c.fillText(`${Math.abs(d.right).toFixed(0)} ft ${d.right >= 0 ? "RIGHT" : "LEFT"}   ${Math.abs(d.high).toFixed(0)} ft ${d.high >= 0 ? "HIGH" : "LOW"}   ${d.dist.toFixed(0)} ft off plan`, 6, 150);
      return true;
    }
    case "steer": {
      head(c, "STEERING", dd.mode === "rotate" ? "ROTATE" : dd.mode === "slide" ? "SLIDE" : "OSCILLATING SLIDE");
      const modes: [string, string][] = [["rotate", "ROTATE"], ["slide", "SLIDE"], ["osc", "OSC SLIDE"]];
      modes.forEach(([m, label], i) => { const x = 8 + i * 82, on = dd.mode === m; c.fillStyle = on ? "#1c5a34" : PANEL; c.fillRect(x, 26, 76, 22); c.strokeStyle = on ? GRN : EDGE; c.strokeRect(x + 0.5, 26.5, 75, 21); c.fillStyle = on ? TX : DIM; c.font = "bold 10px monospace"; c.textAlign = "center"; c.fillText(label, x + 38, 37); });
      const rows: [string, string][] = [["INC", dd.inc.toFixed(2) + "°"], ["AZI (surveyed)", dd.lastSurvey.azi.toFixed(1) + "°"], ["PLAN INC", planAt(dd.bit.md).inc.toFixed(1) + "°"], ["ROP FACTOR", dd.mode === "rotate" ? "100 %" : dd.mode === "slide" ? "60 %" : "80 %"]];
      rows.forEach(([k, v], i) => { c.textAlign = "left"; c.font = "9px monospace"; c.fillStyle = DIM; c.fillText(k, 10, 68 + i * 20); c.textAlign = "right"; c.font = "bold 13px monospace"; c.fillStyle = TX; c.fillText(v, 246, 68 + i * 20); });
      c.textAlign = "left"; c.font = "8px monospace"; c.fillStyle = DIM; c.fillText("click a screen to change mode, toolface, take a check shot", 8, 150);
      return true;
    }
    case "geo": {
      head(c, "GEOSTEERING", "formation · TVD");
      const b = dd.bit, top = 24, bot = 150, tv0 = Math.max(WELL.startDepth, b.tvd - 700), tv1 = tv0 + 1100, ty = (tvd: number) => top + ((tvd - tv0) / (tv1 - tv0)) * (bot - top);
      // formation column
      let prev = 0; FORMATIONS.forEach((f) => { const a = Math.max(prev, tv0), z = Math.min(f.limit, tv1); prev = f.limit; if (z <= a) return; c.fillStyle = f.color + "55"; c.fillRect(6, ty(a), 70, ty(z) - ty(a)); c.strokeStyle = EDGE; c.strokeRect(6.5, ty(a) + 0.5, 69, ty(z) - ty(a)); if (ty(z) - ty(a) > 10) { c.fillStyle = TX; c.font = "8px monospace"; c.textAlign = "left"; c.fillText(f.name.slice(0, 11), 9, ty(a) + 7); } });
      // target window: the plan's TVD ahead of the bit is the corridor; the landing zone is Avalon A
      const landTop = FORMATIONS[FORMATIONS.length - 2].limit; c.fillStyle = "rgba(61,220,132,0.12)"; c.fillRect(80, ty(landTop), 90, ty(tv1) - ty(landTop)); c.strokeStyle = GRN; c.setLineDash([3, 2]); c.beginPath(); c.moveTo(80, ty(landTop)); c.lineTo(170, ty(landTop)); c.stroke(); c.setLineDash([]);
      c.fillStyle = GRN; c.font = "8px monospace"; c.textAlign = "left"; c.fillText("LANDING TARGET", 84, ty(landTop) + 8);
      // plan tvd vs actual at the bit, and the bit
      const p = planAt(b.md); c.strokeStyle = "#5b6672"; c.beginPath(); c.moveTo(80, ty(p.tvd)); c.lineTo(170, ty(p.tvd)); c.stroke(); c.fillStyle = DIM; c.fillText("plan", 144, ty(p.tvd) - 4);
      c.fillStyle = TX; c.beginPath(); c.moveTo(80, ty(b.tvd)); c.lineTo(92, ty(b.tvd) - 5); c.lineTo(92, ty(b.tvd) + 5); c.closePath(); c.fill(); c.fillStyle = TX; c.fillText("BIT", 95, ty(b.tvd) + 3);
      // gamma along the way
      c.strokeStyle = AMB; c.lineWidth = 1.2; c.beginPath(); dd.path.forEach((q, k) => { if (q.tvd < tv0) return; const gr = 70 + 35 * Math.sin(q.tvd / 90) + 14 * Math.sin(q.tvd / 17), x = 178 + (gr / 160) * 68, y = ty(q.tvd); k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
      c.fillStyle = DIM; c.font = "8px monospace"; c.textAlign = "left"; c.fillText("GR", 178, 30);
      const tp = dd.toPlan; c.font = "bold 9px monospace"; c.fillStyle = Math.abs(tp.high) > 30 ? RED : GRN; c.textAlign = "right"; c.fillText(`${Math.abs(tp.high).toFixed(0)} ft ${tp.high >= 0 ? "HIGH" : "LOW"} TO PLAN`, W - 6, 154);
      return true;
    }
    case "ac": {
      head(c, "ANTI-COLLISION", "ladder: centre to centre, ft");
      const X = { x: 8, y: 24, w: 168, h: 112 }, b = dd.bit, mdMax = 8700;
      c.fillStyle = PANEL; c.fillRect(X.x, X.y, X.w, X.h); c.strokeStyle = EDGE; c.strokeRect(X.x + 0.5, X.y + 0.5, X.w - 1, X.h - 1);
      const mx = (md: number) => X.x + ((md - WELL.startDepth) / (mdMax - WELL.startDepth)) * X.w, cy = (ctc: number) => X.y + X.h - Math.min(1, ctc / 140) * X.h;
      c.strokeStyle = GRID; for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(X.x, X.y + (k / 4) * X.h); c.lineTo(X.x + X.w, X.y + (k / 4) * X.h); c.stroke(); }
      OFFSETS.forEach((o, i) => {
        const col = i ? "#9a6a6a" : PNK;
        c.strokeStyle = col; c.setLineDash([3, 2]); c.beginPath(); dd.planCtc[i].forEach((ctc, k) => { const md = WELL.startDepth + k * 50; const x = mx(md), y = cy(ctc); k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.setLineDash([]);
        c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); dd.ac[i].forEach((r, k) => { if (k % 2) return; const x = mx(r.md), y = cy(r.ctc); k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.lineWidth = 1;
      });
      c.strokeStyle = "#fff"; c.beginPath(); c.moveTo(mx(b.md), X.y); c.lineTo(mx(b.md), X.y + X.h); c.stroke();
      c.fillStyle = DIM; c.font = "8px monospace"; c.textAlign = "left"; c.fillText("MD →", X.x + 2, X.y + X.h + 8);
      dd.acNow.forEach((a, i) => {
        const y = 32 + i * 50; c.textAlign = "left"; c.font = "8px monospace"; c.fillStyle = DIM; c.fillText(OFFSETS[i].name, 182, y);
        c.font = "bold 16px monospace"; c.fillStyle = sfCol(a.sf); c.fillText("SF " + a.sf.toFixed(2), 182, y + 14);
        c.font = "9px monospace"; c.fillStyle = TX; c.fillText(Math.round(a.ctc) + " ft ctc", 182, y + 28);
        if (a.sf < 1) { c.fillStyle = Math.floor(t * 2) % 2 ? RED : "#5a1a14"; c.fillRect(182, y + 33, 68, 9); c.fillStyle = "#fff"; c.font = "bold 8px monospace"; c.fillText(a.sf < 0.6 ? "STOP" : "STEER AWAY", 185, y + 38); }
      });
      return true;
    }
  }
  return false;
}
