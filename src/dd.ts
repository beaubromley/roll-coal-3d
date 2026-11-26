// The directional driller's world: the plan, the steering, MWD surveys (with Gtotal / Btotal / dip quality checks) and anti-collision against two offset wells.
import type { Game } from "./game";
import { FORMATIONS, formationAt, WELL } from "./sim";

export type DdMode = "rotate" | "slide" | "osc";
export interface Station { md: number; inc: number; azi: number; n: number; e: number; tvd: number }
export interface Survey extends Station { g: number; b: number; dip: number; ok: boolean; auto: boolean }
export interface Offset { name: string; short: string; pts: Station[] }

const RAD = Math.PI / 180;
/** the plan: hold two degrees (a nominal vertical) to the kickoff, then build three degrees per hundred feet on a 270° azimuth (due west) */
export const PLAN = { kop: 7200, bur: 3, inc: 2, azi: 270, tol: 50 };
/** reference field for quality control (Delaware Basin, approximate): total gravity 1000 mG, total field ~48,000 nT, dip ~59.4° */
export const REF = { g: 1000, b: 48000, dip: 59.4 };
export const TOL = { g: 3, b: 150, dip: 0.5 };
/** error ellipse radius, ft, at a measured depth: 0.3 % of depth, growing with every foot drilled since the last survey */
const ellipse = (md: number, sinceSurvey = 0) => 0.003 * md + 0.02 * sinceSurvey;

const smooth = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
function mc(a: Station, md: number, inc: number, azi: number): Station {   // balanced tangential
  const dmd = md - a.md, im = ((a.inc + inc) / 2) * RAD;
  let da = azi - a.azi; if (da > 180) da -= 360; if (da < -180) da += 360;
  const am = (a.azi + da / 2) * RAD;
  return { md, inc, azi, n: a.n + dmd * Math.sin(im) * Math.cos(am), e: a.e + dmd * Math.sin(im) * Math.sin(am), tvd: a.tvd + dmd * Math.cos(im) };
}
const planInc = (md: number) => (md < PLAN.kop ? PLAN.inc : PLAN.inc + ((md - PLAN.kop) * PLAN.bur) / 100);

function buildPlan(): Station[] {
  const out: Station[] = [{ md: WELL.startDepth, inc: PLAN.inc, azi: PLAN.azi, n: 0, e: 0, tvd: WELL.startDepth }];
  for (let md = WELL.startDepth + 10; md <= 8700; md += 10) out.push(mc(out[out.length - 1], md, planInc(md), PLAN.azi));
  return out;
}
export const PLAN_PTS = buildPlan();
export const planAt = (md: number): Station => PLAN_PTS[Math.max(0, Math.min(PLAN_PTS.length - 1, Math.round((md - WELL.startDepth) / 10)))];
/** vertical section: distance along the plan azimuth (west) */
export const vsOf = (s: { n: number; e: number }) => s.n * Math.cos(PLAN.azi * RAD) + s.e * Math.sin(PLAN.azi * RAD);

/** the plan can be redrawn: waypoints (vertical section, TVD) become a smooth table of stations every 10 ft of measured depth, on the plan azimuth */
export function planFromWaypoints(w: [number, number][]): Station[] {
  const pts = w.slice().sort((a, b) => a[1] - b[1]); if (!pts.length || pts[0][1] > WELL.startDepth) pts.unshift([0, WELL.startDepth]);
  const segs: { s0: number; len: number; inc: number }[] = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { const dv = pts[i][0] - pts[i - 1][0], dt = Math.max(1, pts[i][1] - pts[i - 1][1]), len = Math.hypot(dv, dt); segs.push({ s0: total, len, inc: Math.max(0, Math.min(88, Math.atan2(dv, dt) / RAD)) }); total += len; }
  if (!segs.length) segs.push({ s0: 0, len: 1, inc: 0 });
  const n = Math.ceil((8700 - WELL.startDepth) / 10) + 1, raw: number[] = [];
  for (let k = 0; k < n; k++) { const s = k * 10; let seg = segs[segs.length - 1]; for (const sg of segs) if (s < sg.s0 + sg.len) { seg = sg; break; } raw.push(seg.inc); }
  let inc = raw; for (let pass = 0; pass < 3; pass++) inc = inc.map((_, i) => { let a = 0, c = 0; for (let j = -6; j <= 6; j++) { const q = inc[Math.max(0, Math.min(n - 1, i + j))]; a += q; c++; } return a / c; });
  const out: Station[] = [{ md: WELL.startDepth, inc: inc[0], azi: PLAN.azi, n: 0, e: 0, tvd: WELL.startDepth }];
  for (let k = 1; k < n; k++) out.push(mc(out[k - 1], WELL.startDepth + k * 10, inc[k], PLAN.azi));
  return out;
}
export function planStats(st: Station[] = PLAN_PTS) {
  let maxDls = 0; for (let i = 10; i < st.length; i++) maxDls = Math.max(maxDls, Math.abs(st[i].inc - st[i - 10].inc));
  const inc0 = st[0].inc; const k = st.findIndex((s) => s.inc - inc0 > 3);
  const last = st[st.length - 1];
  return { maxDls, kop: k < 0 ? Infinity : st[k].md, tvdEnd: last.tvd, vsEnd: vsOf(last), incEnd: last.inc };
}
/** sample a station table into a few editable waypoints */
export function wpsOf(st: Station[], mds: number[] = [750, 3000, 6000, 7200, 7500, 7900, 8300, 8700]): [number, number][] { return mds.map((md) => { const p = st[Math.max(0, Math.min(st.length - 1, Math.round((md - WELL.startDepth) / 10)))]; return [Math.round(vsOf(p)), Math.round(p.tvd)] as [number, number]; }); }
export const DEFAULT_WPS = wpsOf(PLAN_PTS);
export function presetWps(kind: "early" | "straight"): [number, number][] {
  if (kind === "straight") return [[0, WELL.startDepth], [30, 4000], [60, 8800]];
  const st: Station[] = [{ md: WELL.startDepth, inc: 2, azi: PLAN.azi, n: 0, e: 0, tvd: WELL.startDepth }];
  for (let md = WELL.startDepth + 10; md <= 8700; md += 10) st.push(mc(st[st.length - 1], md, md < 5500 ? 2 : 2 + ((md - 5500) * 2.5) / 100, PLAN.azi));
  return wpsOf(st, [750, 3000, 5200, 5500, 6200, 7000, 7800, 8700]);
}

function offsetWell(name: string, short: string, shiftN: (md: number) => number): Offset {
  return { name, short, pts: PLAN_PTS.map((p) => ({ ...p, n: p.n + shiftN(p.md) })) };
}
/** two pad neighbours: 502H drifts in toward our hole through the middle section, 504H sits well clear on the other side */
export const OFFSETS: Offset[] = [
  offsetWell("Cactus 502H", "502H", (md) => 60 - 24 * smooth((md - 1500) / 3500) + Math.max(0, md - 5000) * 0.0075),
  offsetWell("Cactus 504H", "504H", () => -80),
];

export interface AcRow { ctc: number; sf: number; md: number }

export class Dd {
  mode: DdMode = "rotate";
  tfSet = 0; tf = 0;                 // toolface, degrees: 0 high side (build), 90 right, 180 low side (drop), 270 left
  inc = PLAN.inc; azi = PLAN.azi;     // the true hole
  path: Station[] = [{ md: WELL.startDepth, inc: PLAN.inc, azi: PLAN.azi, n: 0, e: 0, tvd: WELL.startDepth }];
  surveys: Survey[] = [];
  /** anti-collision history: for each offset, centre-to-centre distance and separation factor, every 10 ft drilled */
  ac: AcRow[][] = [[], []];
  acNow: AcRow[] = [{ ctc: 99, sf: 9, md: 0 }, { ctc: 99, sf: 9, md: 0 }];
  planCtc: number[][] = [[], []];
  /** with nobody in the seat the DD picks his own slides: about 6 % of the footage in the vertical hole, a lot more once the plan is building angle */
  private autoFt = 0; private autoNext = 120; private autoLen = 10; private wasSeated = false;
  warned = 0; acWarn = [0, 0]; collided = false; lastDepth = WELL.startDepth; wasConn = false; interference = 0;
  /** the waypoints of the plan as drawn (the editor starts from these) */
  wps: [number, number][] = DEFAULT_WPS.map((p) => [p[0], p[1]] as [number, number]);
  constructor(private g: Game) {
    this.takeSurvey(true);
    this.rebuildPlanCtc();
  }
  private rebuildPlanCtc() { this.planCtc = [[], []]; OFFSETS.forEach((o, i) => { for (let k = 0; k < PLAN_PTS.length; k += 5) this.planCtc[i].push(this.dist(PLAN_PTS[k], o)); }); }
  /** use a redrawn plan: the station table, the kickoff and the build rate all follow it */
  replan(w: [number, number][]) {
    const st = planFromWaypoints(w); PLAN_PTS.length = 0; PLAN_PTS.push(...st);
    const s = planStats(st); PLAN.inc = st[0].inc; PLAN.bur = Math.max(0.2, s.maxDls); PLAN.kop = Number.isFinite(s.kop) ? s.kop : 99999;
    this.wps = w.map((p) => [p[0], p[1]] as [number, number]); this.rebuildPlanCtc();
    return s;
  }
  get sliding() { return this.mode !== "rotate"; }
  get bit(): Station { return this.path[this.path.length - 1]; }
  get lastSurvey(): Survey { return this.surveys[this.surveys.length - 1]; }

  /** closest approach of a point to an offset well, ft (offsets are searched near the same depth) */
  dist(p: { n: number; e: number; tvd: number; md?: number }, o: Offset): number {
    const k0 = Math.max(0, Math.floor(((p.md ?? p.tvd) - 400 - WELL.startDepth) / 10)), k1 = Math.min(o.pts.length - 1, k0 + 80);
    let best = 1e9;
    for (let k = k0; k <= k1; k++) { const q = o.pts[k]; const d = Math.hypot(q.n - p.n, q.e - p.e, q.tvd - p.tvd); if (d < best) best = d; }
    return best;
  }
  /** separation factor to offset i from the bit now (the error ellipses of both wells, the bit's growing with feet since the last survey) */
  private measureAc(): AcRow[] {
    const b = this.bit, since = b.md - this.lastSurvey.md;
    return OFFSETS.map((o) => { const ctc = this.dist(b, o), r = ellipse(b.md, since) + ellipse(b.md); return { ctc, sf: ctc / r, md: b.md }; });
  }

  setMode(m: DdMode) {
    if (m === this.mode) return;
    this.mode = m; this.g.sfx.click();
    this.g.ui.toast(m === "rotate" ? "ROTATING" : m === "slide" ? "SLIDING" : "OSCILLATING SLIDE", m === "rotate" ? "Full speed, and the hole goes where it wants." : m === "slide" ? "Steering on the toolface. ROP takes a hit." : "Rocking the string: less drag and a steadier toolface, a bit slower than rotating.");
  }
  setTf(v: number) { this.tfSet = ((v % 360) + 360) % 360; }

  /** a survey: MWD readings at the bit with their noise, Gtotal / Btotal / dip quality checks, and a minimum-curvature position */
  takeSurvey(auto = false): Survey {
    const b = this.bit, rnd = () => Math.random() - 0.5;
    const near = this.acNow ? Math.min(...this.acNow.map((a) => a.ctc)) : 99;
    this.interference = 700 * Math.max(0, 1 - near / 50) + (Math.random() < 0.07 ? 350 + Math.random() * 400 : 0);   // casing next door, or just a bad shot
    const g = REF.g + rnd() * 3.2, bt = REF.b + rnd() * 90 + this.interference, dip = REF.dip + rnd() * 0.18 + this.interference * 0.0018;
    const inc = Math.max(0, b.inc + rnd() * 0.16), azi = (b.azi + rnd() * 0.9 + 360) % 360;
    const prev = this.surveys[this.surveys.length - 1];
    const pos = prev ? mc(prev, b.md, inc, azi) : { md: b.md, inc, azi, n: 0, e: 0, tvd: b.md };
    const ok = Math.abs(g - REF.g) <= TOL.g && Math.abs(bt - REF.b) <= TOL.b && Math.abs(dip - REF.dip) <= TOL.dip;
    const s: Survey = { ...pos, g, b: bt, dip, ok, auto };
    this.surveys.push(s); if (this.surveys.length > 60) this.surveys.shift();
    this.acNow = this.measureAc();
    return s;
  }
  checkShot() {
    const sim = this.g.sim, s = sim.s;
    if (s.mode !== "drilling" && s.mode !== "idle") { this.g.ui.toast("NO SURVEY NOW", "Pumps on, hole stable, drilling or idle. Not in the middle of this."); return; }
    const sv = this.takeSurvey(false);
    s.t += 2; sim.addCost(180);
    this.g.sfx.click();
    this.g.ui.toast(sv.ok ? "CHECK SHOT: GOOD" : "CHECK SHOT: FAILED QC", `Gtotal ${sv.g.toFixed(1)} mG  ·  Btotal ${Math.round(sv.b).toLocaleString("en-US")} nT  ·  dip ${sv.dip.toFixed(2)}°${sv.ok ? "" : " — out of tolerance, shoot another"}`);
    if (!sv.ok && this.interference > 400) this.g.radio("tex", "Btotal is way off. Either that's a bad shot or there's casing close by. Shoot it again.", 7000);
  }

  /** run every frame (real seconds): the hole grows with the feet drilled */
  update(dt: number) {
    if (this.g.astMode) return;   // on the asteroid nobody is steering
    const sim = this.g.sim, s = sim.s, drilling = s.mode === "drilling" && s.rop > 0;
    sim.ropMul = drilling ? (this.mode === "slide" ? 0.6 : this.mode === "osc" ? 0.8 : 1) : 1;
    // the tool face follows what the driller asked for, wandering with the weight on the bit (an oscillating slide keeps it steadier)
    const wander = (this.mode === "osc" ? 0.35 : 1) * (s.wob / 30) * 14;
    let dtf = ((this.tfSet - this.tf + 540) % 360) - 180;
    this.tf = (this.tf + dtf * Math.min(1, dt * 1.6) + (drilling && this.sliding ? (Math.random() - 0.5) * wander * dt * 8 : 0) + 360) % 360;
    // auto survey on every connection
    if (s.mode === "connection" && !this.wasConn) { const sv = this.takeSurvey(true); void sv; }
    this.wasConn = s.mode === "connection";
    const dft = s.depth - this.lastDepth; this.lastDepth = s.depth;
    const seated = this.g.veh.isSeated(1) || this.g.veh.isSeated(2);
    if (this.wasSeated && !seated) { this.mode = "rotate"; this.autoFt = 0; this.autoNext = this.nextRot(); }
    this.wasSeated = seated;
    if (!seated && drilling && dft > 0 && dft < 60) this.autoDd(dft);
    if (dft > 0 && dft < 60 && drilling) this.advance(dft);
    this.warnings(dt);
  }
  private slideFrac() { return Math.max(0.06, Math.min(0.9, 0.06 + (this.bit.md >= PLAN.kop ? PLAN.bur / 3.2 : 0))); }
  private nextRot() { const f = this.slideFrac(), len = this.autoLen; return len * (1 - f) / f * (0.7 + Math.random() * 0.6); }
  /** the toolface that corrects the hole back toward the plan (and away from a close offset well) */
  private wantedTf(): number {
    const b = this.bit, p = planAt(b.md), tp = this.toPlan;
    let da = PLAN.azi - this.azi; if (da > 180) da -= 360; if (da < -180) da += 360;
    let build = (p.inc - this.inc) + (b.md >= PLAN.kop ? PLAN.bur * 0.6 : 0) - tp.high / 25, turn = da * Math.sin(Math.max(this.inc, 3) * RAD) * 3 - tp.right / 12;
    if (this.acNow[0] && this.acNow[0].sf < 1.5) turn -= 4;   // 502H is to the north: turn left, away from it
    if (Math.abs(build) < 0.05 && Math.abs(turn) < 0.05) build = 0.1;
    return (Math.atan2(turn, build) / RAD + 360) % 360;
  }
  private autoDd(dft: number) {
    this.autoFt += dft;
    if (this.mode === "rotate") {
      if (this.autoFt >= this.autoNext) { this.autoFt = 0; this.autoLen = this.slideFrac() > 0.3 ? 30 + Math.random() * 20 : 6 + Math.random() * 8; this.mode = "slide"; this.tfSet = this.wantedTf(); }
    } else {
      this.tfSet = this.wantedTf();
      if (this.autoFt >= this.autoLen) { this.autoFt = 0; this.mode = "rotate"; this.autoNext = this.nextRot(); }
    }
  }
  private advance(dft: number) {
    const f = formationAt(this.g.sim.s.depth), s = this.g.sim.s;
    let inc = this.inc, azi = this.azi;
    if (this.sliding) {
      const dls = this.mode === "slide" ? 3.0 : 2.2;   // deg per 100 ft, at full toolface
      inc += (dls * Math.cos(this.tf * RAD) * dft) / 100;
      azi += (dls * Math.sin(this.tf * RAD) * dft) / 100 / Math.sin(Math.max(inc, 5) * RAD);
    } else {
      inc += ((s.wob - 22) * 0.0035 + (f.hardness - 0.7) * 0.12) * dft / 100;   // a rotating assembly goes where weight and rock send it
      azi += (0.35 * dft) / 100 / Math.sin(Math.max(inc, 5) * RAD) * 0.3;        // and walks a little to the right
    }
    this.inc = Math.max(0, Math.min(90, inc)); this.azi = ((azi % 360) + 360) % 360;
    // the path, a station for every ten feet
    let b = this.bit;
    while (s.depth - b.md >= 10) { b = mc(b, b.md + 10, this.inc, this.azi); this.path.push(b); this.record(b); }
  }
  private record(b: Station) {
    const since = b.md - this.lastSurvey.md;
    OFFSETS.forEach((o, i) => { const ctc = this.dist(b, o), r = ellipse(b.md, since) + ellipse(b.md); const row = { ctc, sf: ctc / r, md: b.md }; this.ac[i].push(row); this.acNow[i] = row; });
  }
  private warnings(dt: number) {
    this.warned -= dt; this.acWarn = this.acWarn.map((w) => w - dt);
    const g = this.g, b = this.bit, p = planAt(b.md), dev = Math.hypot(b.n - p.n, b.e - p.e, b.tvd - p.tvd);
    if (dev > PLAN.tol * 0.8 && this.warned <= 0) { this.warned = 50; g.radio("tex", dev > PLAN.tol ? "We're outside the plan corridor, boss. Lease line's that way. Steer back." : "We're drifting off the plan. Not an emergency yet.", 6500); }
    this.acNow.forEach((a, i) => {
      if (this.acWarn[i] > 0 || a.md === 0) return;
      const name = OFFSETS[i].name;
      if (a.sf < 0.6) { this.acWarn[i] = 45; g.radio("tex", `STOP DRILLING. Separation factor ${a.sf.toFixed(2)} to the ${name}, ${Math.round(a.ctc)} feet centre to centre. Take a check shot and steer away.`, 9000); }
      else if (a.sf < 1.0) { this.acWarn[i] = 60; g.radio("tex", `Separation factor's under one on the ${name}: ${a.sf.toFixed(2)}. Steer away from it.`, 8000); }
      else if (a.sf < 1.5) { this.acWarn[i] = 120; g.radio("tex", `Heads up: the ${name} is close. Separation factor ${a.sf.toFixed(2)}.`, 6500); }
    });
    const nearest = Math.min(...this.acNow.map((a) => a.ctc));
    if (nearest < 8 && !this.collided) {
      this.collided = true; g.inc(1, "WELL COLLISION"); g.sim.addCost(400000); g.sim.s.needTrip = true; g.sfx.bad();
      g.radio("tex", "WE HIT THE OFFSET. Mud's coming back wrong. Shut it down, boss. That's a call to the VP.", 10000);
    }
  }
  /** how far the bit is from the plan: high/low and left/right, ft */
  get toPlan() {
    const b = this.bit, p = planAt(b.md), dn = b.n - p.n, de = b.e - p.e, dt = b.tvd - p.tvd;
    // along the plan azimuth the plan's "right" is north (azimuth 270, facing west)
    return { right: dn, high: -dt, vs: vsOf(b) - vsOf(p), dist: Math.hypot(dn, de, dt) };
  }
  /** formation (and its limit) the bit is in */
  get form() { const f = formationAt(this.bit.tvd); return { f, i: FORMATIONS.indexOf(f) }; }
}
