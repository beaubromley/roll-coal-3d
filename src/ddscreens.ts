// The directional driller's wall of screens, drawn in the EDR's style on the small cabin monitors.
import { Dd, OFFSETS, PLAN, PLAN_PTS, REF, TOL, planAt, vsOf, planFromWaypoints, planStats } from "./dd";
import { FORMATIONS, WELL, formationAt } from "./sim";

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
      // a geosteering section, in the style of the commercial tools: GR and rock-strength strips along the top, the section (TVD against vertical section) with the formation tops,
      // the target window and the plan and actual wellpaths, and a GR type log down the right with the zone shaded and the bit marked
      const bt = dd.bit, vsB = vsOf(bt), pl = planAt(bt.md);
      head(c, "GEOSTEERING", "TVD " + fmt(bt.tvd) + "  VS " + fmt(vsB) + " ft");
      const S = { x: 26, y: 40, w: 160, h: 108 }, T1 = { x: 26, y: 21, w: 160, h: 8 }, T2 = { x: 26, y: 30, w: 160, h: 8 }, L = { x: 192, y: 21, w: 58, h: 127 };
      const tv0 = bt.tvd - 230, tv1 = bt.tvd + 150, vs0 = vsB - 320, vs1 = vsB + 320;
      const sx = (vs: number) => S.x + ((vs - vs0) / (vs1 - vs0)) * S.w, sy = (tvd: number) => S.y + ((tvd - tv0) / (tv1 - tv0)) * S.h;
      const gr = (tvd: number) => 70 + 35 * Math.sin(tvd / 90) + 14 * Math.sin(tvd / 17) + 6 * Math.sin(tvd / 5.3);
      const grCol = (v: number) => { const k = Math.max(0, Math.min(1, (v - 35) / 110)); return `rgb(${Math.round(70 + 185 * k)},${Math.round(210 - 90 * k)},${Math.round(70 - 30 * k)})`; };
      // top strips along measured depth: GR and rock strength
      c.fillStyle = PANEL; c.fillRect(T1.x, T1.y, T1.w, T1.h + T2.h + 1);
      for (let i = 0; i < 80; i++) { const md = bt.md - 2000 + (i / 80) * 2000, p2 = planAt(Math.max(WELL.startDepth, md)); c.fillStyle = grCol(gr(p2.tvd)); c.fillRect(T1.x + (i / 80) * T1.w, T1.y, T1.w / 80 + 0.6, T1.h); const hd = formationAt(p2.tvd).hardness; c.fillStyle = `hsl(${Math.round(50 - 40 * Math.min(1, hd / 1.4))},85%,55%)`; c.fillRect(T1.x + (i / 80) * T2.w, T2.y, T2.w / 80 + 0.6, T2.h); }
      c.fillStyle = DIM; c.font = "6px monospace"; c.textAlign = "right"; c.fillText("GR", T1.x - 3, T1.y + 4); c.fillText("ROCK", T2.x - 3, T2.y + 4);
      // the section
      c.fillStyle = "#0a0d11"; c.fillRect(S.x, S.y, S.w, S.h); c.save(); c.beginPath(); c.rect(S.x, S.y, S.w, S.h); c.clip();
      c.strokeStyle = GRID; c.lineWidth = 1; for (let tv = Math.ceil(tv0 / 100) * 100; tv < tv1; tv += 100) { c.beginPath(); c.moveTo(S.x, sy(tv)); c.lineTo(S.x + S.w, sy(tv)); c.stroke(); }
      for (let v = Math.ceil(vs0 / 200) * 200; v < vs1; v += 200) { c.beginPath(); c.moveTo(sx(v), S.y); c.lineTo(sx(v), S.y + S.h); c.stroke(); }
      // the target window: plan TVD plus and minus 40 ft, shaded green, with dashed blue limits (it follows the plan)
      const pts: { x: number; y: number }[] = [];
      for (let md = Math.max(WELL.startDepth, bt.md - 1500); md < bt.md + 1800; md += 20) { const q = planAt(md); pts.push({ x: sx(vsOf(q)), y: sy(q.tvd) }); }
      if (pts.length > 1) {
        c.fillStyle = "rgba(61,220,132,0.16)"; c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y - 40 * (S.h / (tv1 - tv0))) : c.moveTo(q.x, q.y - 40 * (S.h / (tv1 - tv0))))); for (let i = pts.length - 1; i >= 0; i--) c.lineTo(pts[i].x, pts[i].y + 40 * (S.h / (tv1 - tv0))); c.closePath(); c.fill();
        c.strokeStyle = "#3d7fff"; c.setLineDash([4, 2]); c.lineWidth = 1; for (const off of [-40, 40]) { c.beginPath(); pts.forEach((q, i) => { const yy = q.y + off * (S.h / (tv1 - tv0)); i ? c.lineTo(q.x, yy) : c.moveTo(q.x, yy); }); c.stroke(); } c.setLineDash([]);
        c.strokeStyle = "#8a9098"; c.setLineDash([2, 2]); c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.stroke(); c.setLineDash([]);
      }
      // formation tops, dipping gently with vertical section, each labelled at the right in its own colour
      let prev = 0; const labels: [number, string, string][] = [];
      FORMATIONS.forEach((f, i) => { const next = FORMATIONS[i + 1]; if (!next) return; prev = f.limit; const yA = sy(prev + (vs0 - vsB) * 0.04), yB = sy(prev + (vs1 - vsB) * 0.04); if (Math.max(yA, yB) < S.y - 4 || Math.min(yA, yB) > S.y + S.h + 4) return; c.strokeStyle = next.color; c.lineWidth = 1.2; c.beginPath(); c.moveTo(S.x, yA); c.lineTo(S.x + S.w, yB); c.stroke(); labels.push([yB, next.name.toUpperCase(), next.color]); });
      // the wellpaths: the actual hole in black-and-white, the bit, and the plan ahead
      c.strokeStyle = TX; c.lineWidth = 2; c.beginPath(); dd.path.forEach((q, i) => { const x = sx(vsOf(q)), y = sy(q.tvd); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
      c.fillStyle = "#ffffff"; c.beginPath(); c.arc(sx(vsB), sy(bt.tvd), 2.8, 0, 6.3); c.fill(); c.strokeStyle = "#ff4a3a"; c.lineWidth = 1; c.stroke();
      c.restore(); c.strokeStyle = EDGE; c.strokeRect(S.x + 0.5, S.y + 0.5, S.w - 1, S.h - 1);
      c.font = "5.5px monospace"; c.textAlign = "left"; for (const [yy, name, col] of labels) if (yy > S.y + 3 && yy < S.y + S.h - 2) { c.fillStyle = "#0a0d11"; c.fillRect(S.x + S.w - 56, yy - 5, 56, 7); c.fillStyle = col; c.fillText(name.slice(0, 16), S.x + S.w - 55, yy - 1); }
      // axis ticks
      c.fillStyle = DIM; c.font = "6px monospace"; c.textAlign = "right"; for (let tv = Math.ceil(tv0 / 100) * 100; tv < tv1; tv += 100) c.fillText(String(tv), S.x - 3, sy(tv) + 2);
      c.textAlign = "center"; for (let v = Math.ceil(vs0 / 200) * 200; v < vs1; v += 200) c.fillText(String(v), sx(v), S.y + S.h + 7);
      c.textAlign = "left"; c.fillText("TVD", 2, S.y + 4); c.fillText("VS", S.x + S.w - 8, S.y + S.h + 7);
      // the type log: GR against TVD, the target zone shaded, the bit marked
      c.fillStyle = "#0a0d11"; c.fillRect(L.x, L.y, L.w, L.h); c.strokeStyle = EDGE; c.strokeRect(L.x + 0.5, L.y + 0.5, L.w - 1, L.h - 1);
      c.fillStyle = PANEL; c.fillRect(L.x + 1, L.y + 1, L.w - 2, 8); c.fillStyle = GRN; c.font = "bold 6px monospace"; c.textAlign = "center"; c.fillText("TYPE LOG  GR", L.x + L.w / 2, L.y + 5);
      const ty = (tvd: number) => L.y + 10 + ((tvd - tv0) / (tv1 - tv0)) * (L.h - 11);
      c.fillStyle = "rgba(61,220,132,0.2)"; c.fillRect(L.x + 1, ty(pl.tvd - 40), L.w - 2, ty(pl.tvd + 40) - ty(pl.tvd - 40));
      c.strokeStyle = "#3d7fff"; c.setLineDash([3, 2]); for (const off of [-40, 40]) { c.beginPath(); c.moveTo(L.x + 1, ty(pl.tvd + off)); c.lineTo(L.x + L.w - 1, ty(pl.tvd + off)); c.stroke(); } c.setLineDash([]);
      c.strokeStyle = "#e8d34a"; c.lineWidth = 1.2; c.beginPath(); for (let tv = tv0; tv <= tv1; tv += 2) { const x = L.x + 3 + (gr(tv) / 160) * (L.w - 6), y = ty(tv); tv === tv0 ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke();
      c.fillStyle = TX; c.beginPath(); c.moveTo(L.x + L.w - 1, ty(bt.tvd)); c.lineTo(L.x + L.w - 8, ty(bt.tvd) - 3.5); c.lineTo(L.x + L.w - 8, ty(bt.tvd) + 3.5); c.closePath(); c.fill();
      const tp = dd.toPlan; c.font = "bold 7px monospace"; c.textAlign = "left"; c.fillStyle = Math.abs(tp.high) > 30 ? RED : GRN; c.fillText(Math.abs(tp.high).toFixed(0) + " ft " + (tp.high >= 0 ? "HIGH" : "LOW") + " TO PLAN", S.x + 3, S.y + S.h - 3);
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

// ---------------------------------------------------------------------------------------------------- the plan editor (drawn on the console's main canvas)
export function planEditorMap(w: number, h: number) {
  const L = { x: 64, y: 28, w: w - 84, h: h - 52 }, vs0 = -100, vs1 = 1500, tv0 = 700, tv1 = 8900;
  return { L, X: (vs: number) => L.x + ((vs - vs0) / (vs1 - vs0)) * L.w, Y: (tvd: number) => L.y + ((tvd - tv0) / (tv1 - tv0)) * L.h, VS: (x: number) => vs0 + ((x - L.x) / L.w) * (vs1 - vs0), TV: (y: number) => tv0 + ((y - L.y) / L.h) * (tv1 - tv0), vs0, vs1, tv0, tv1 };
}
export function drawPlanEditor(c: CanvasRenderingContext2D, w: number, h: number, dd: Dd, wps: [number, number][], drag: number) {
  const m = planEditorMap(w, h), { L, X, Y } = m, st = planFromWaypoints(wps), ps = planStats(st);
  c.save(); c.textBaseline = "middle"; c.fillStyle = "#0b0e12"; c.fillRect(0, 0, w, h);
  c.fillStyle = "#14181e"; c.fillRect(0, 0, w, 24); c.fillStyle = TX; c.font = "bold 13px monospace"; c.textAlign = "left"; c.fillText("DIRECTIONAL PLAN EDITOR", 10, 12);
  c.fillStyle = DIM; c.font = "11px monospace"; c.textAlign = "right"; c.fillText("click: add a point · drag: move it · right-click: delete · then Apply plan", w - 10, 12);
  c.save(); c.beginPath(); c.rect(L.x, L.y, L.w, L.h); c.clip();
  let prev = 0; for (const f of FORMATIONS) { const a = Math.max(prev, m.tv0), z = Math.min(f.limit, m.tv1); prev = f.limit; if (z <= a) continue; c.fillStyle = f.color + "22"; c.fillRect(L.x, Y(a), L.w, Y(z) - Y(a)); c.strokeStyle = f.color + "88"; c.lineWidth = 1; c.beginPath(); c.moveTo(L.x, Y(z)); c.lineTo(L.x + L.w, Y(z)); c.stroke(); c.fillStyle = f.color; c.font = "10px monospace"; c.textAlign = "left"; if (Y(z) - Y(a) > 12) c.fillText(f.name, L.x + 4, Y(a) + 7); }
  c.strokeStyle = GRID; c.lineWidth = 1; for (let tv = 1000; tv < m.tv1; tv += 1000) { c.beginPath(); c.moveTo(L.x, Y(tv)); c.lineTo(L.x + L.w, Y(tv)); c.stroke(); } for (let v = 0; v <= m.vs1; v += 250) { c.beginPath(); c.moveTo(X(v), L.y); c.lineTo(X(v), L.y + L.h); c.stroke(); }
  // the hole so far, and the bit
  c.strokeStyle = GRN; c.lineWidth = 3; c.beginPath(); dd.path.forEach((q, i) => { const x = X(vsOf(q)), y = Y(q.tvd); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
  const bt = dd.bit; c.fillStyle = "#fff"; c.beginPath(); c.arc(X(vsOf(bt)), Y(bt.tvd), 5, 0, 6.3); c.fill();
  // the plan being drawn: white where it is gentle, amber past 3.5 degrees per 100 ft, red past 5
  c.lineWidth = 3; for (let i = 10; i < st.length; i += 5) { const dls = Math.abs(st[i].inc - st[i - 10].inc); c.strokeStyle = dls > 5 ? RED : dls > 3.5 ? AMB : "#e6ebf0"; c.beginPath(); c.moveTo(X(vsOf(st[i - 5])), Y(st[i - 5].tvd)); c.lineTo(X(vsOf(st[i])), Y(st[i].tvd)); c.stroke(); }
  c.restore(); c.strokeStyle = EDGE; c.strokeRect(L.x + 0.5, L.y + 0.5, L.w - 1, L.h - 1);
  wps.forEach((p, i) => { c.fillStyle = i === drag ? AMB : i === 0 ? "#8d98a5" : "#6cb4ff"; c.strokeStyle = "#0b0e12"; c.lineWidth = 2; c.beginPath(); c.arc(X(p[0]), Y(p[1]), 6, 0, 6.3); c.fill(); c.stroke(); c.fillStyle = TX; c.font = "bold 10px monospace"; c.textAlign = "left"; c.fillText(String(i + 1), X(p[0]) + 9, Y(p[1]) - 7); });
  c.fillStyle = DIM; c.font = "10px monospace"; c.textAlign = "right"; for (let tv = 1000; tv < m.tv1; tv += 1000) c.fillText(String(tv), L.x - 5, Y(tv)); c.textAlign = "center"; for (let v = 0; v <= m.vs1; v += 250) c.fillText(String(v), X(v), L.y + L.h + 10);
  c.textAlign = "left"; c.fillText("TVD ft", 6, L.y + 6); c.textAlign = "right"; c.fillText("vertical section, ft (west)", L.x + L.w, L.y + L.h + 22);
  // how the plan fares: build rate, kickoff, where it ends up, and how close it passes the offset wells
  let sf0 = 99, sf1 = 99; for (let k = 0; k < st.length; k += 5) { const p = st[k], r = 2 * 0.003 * p.md; sf0 = Math.min(sf0, dd.dist(p, OFFSETS[0]) / r); sf1 = Math.min(sf1, dd.dist(p, OFFSETS[1]) / r); }
  c.font = "bold 11px monospace"; c.textAlign = "left"; const bad = ps.maxDls > 5;
  c.fillStyle = bad ? RED : ps.maxDls > 3.5 ? AMB : GRN; c.fillText("MAX DLS " + ps.maxDls.toFixed(1) + "°/100 ft" + (bad ? " — too hard to build" : ""), L.x + 8, L.y + L.h - 40);
  c.fillStyle = TX; c.fillText("KOP " + (Number.isFinite(ps.kop) ? Math.round(ps.kop).toLocaleString("en-US") + " ft" : "none") + "   ends TVD " + Math.round(ps.tvdEnd).toLocaleString("en-US") + "  VS " + Math.round(ps.vsEnd) + "  INC " + ps.incEnd.toFixed(0) + "°", L.x + 8, L.y + L.h - 24);
  c.fillStyle = Math.min(sf0, sf1) < 1.5 ? (Math.min(sf0, sf1) < 1 ? RED : AMB) : GRN; c.fillText("closest to 502H: SF " + sf0.toFixed(2) + "   504H: SF " + sf1.toFixed(2), L.x + 8, L.y + L.h - 8);
  c.restore();
}
