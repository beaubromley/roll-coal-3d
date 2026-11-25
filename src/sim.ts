// Drilling + well-control simulation. Formulas ported/simplified from the original "Roll Coal Make Hole" engine.

export interface Formation {
  name: string; limit: number; color: string; hardness: number; abrasiveness: number;
}

export const FORMATIONS: Formation[] = [
  { name: "Rustler", limit: 719, color: "#f4a460", hardness: 0.25, abrasiveness: 0.2 },
  { name: "Salado Anhydrite", limit: 1066, color: "#fffacd", hardness: 0.8, abrasiveness: 0.6 },
  { name: "Castile Salt", limit: 4294, color: "#ffffe0", hardness: 0.5, abrasiveness: 0.7 },
  { name: "Bell Canyon", limit: 4519, color: "#bdb76b", hardness: 1.2, abrasiveness: 1.0 },
  { name: "Cherry Canyon", limit: 5450, color: "#cd853f", hardness: 0.6, abrasiveness: 1.3 },
  { name: "Delaware Sand", limit: 6821, color: "#daa520", hardness: 0.8, abrasiveness: 1.6 },
  { name: "Brushy Canyon", limit: 8156, color: "#8b7355", hardness: 0.7, abrasiveness: 1.2 },
  { name: "1st BSPG Lime", limit: 8375, color: "#dcdcdc", hardness: 1.1, abrasiveness: 1.8 },
  { name: "Avalon A", limit: 99999, color: "#a9a9a9", hardness: 0.6, abrasiveness: 1.0 },
];

export const WELL = {
  name: "Delaware Basin — Wolfcamp Horizontal (Intermediate Hole)",
  startDepth: 750,
  td: 8500,
  casingCost: 625000,
  afe: 3_400_000,
  spreadPerDay: 80000,
  stand: 93,
  gasPocket: { start: 7380, end: 7440, pore: 12.3 },
};

let formOverride: ((d: number) => Formation) | null = null;
/** the rock under the bit: the Delaware Basin, or (in the finale) the asteroid */
export const formationAt = (d: number): Formation => (formOverride ? formOverride(d) : FORMATIONS.find((f) => d < f.limit) ?? FORMATIONS[FORMATIONS.length - 1]);
const ASTEROID: Formation[] = [
  { name: "Asteroid Crust", limit: 150, color: "#6b5d52", hardness: 0.5, abrasiveness: 0.2 },
  { name: "Solid Iron Plate", limit: 400, color: "#8a8f98", hardness: 1.1, abrasiveness: 0.5 },
  { name: "Iron-Nickel Vein", limit: 460, color: "#c9a14a", hardness: 1.9, abrasiveness: 0.8 },
  { name: "Iron Plate", limit: 560, color: "#8a8f98", hardness: 1.2, abrasiveness: 0.6 },
  { name: "Vibranium", limit: 99999, color: "#7a4fd0", hardness: 1.5, abrasiveness: 0.9 },
];

export function poreAt(d: number): number {
  if (d >= WELL.gasPocket.start && d < WELL.gasPocket.end) return WELL.gasPocket.pore;
  if (d >= 6000) return 10.8;
  if (d >= 4300) return 9.2;
  return 8.6;
}
export function fracAt(d: number): number { return d >= 5500 ? 12.0 : 15.0; }
export function lossRateAt(d: number): number { return d >= 7500 ? 100 : d >= 5500 ? 30 : 15; }

export function ecdAt(flow: number, depth: number): number {
  const df = depth / 15000;
  const base = flow < 550 ? 0.3 : flow < 650 ? 0.6 : flow < 750 ? 1.0 : flow < 850 ? 1.3 : 2.0;
  return base * df;
}

/** WOB beyond this stops buying ROP (bit founders) but keeps wearing the bit — what a drill-off test finds. */
export const woptFor = (f: Formation) => Math.max(16, Math.min(42, 30 / Math.pow(f.hardness, 0.25)));
/** Mud-motor differential pressure from WOB and rock hardness (original game formula). */
export const diffPressure = (wob: number, f: Formation) => (wob > 0 ? (wob * 12) / (f.hardness / 1.5) : 0);
export const STALL_DP = 2100;   // the original game's motor stall pressure
/** surface torque (ft-lb): string drag grows with depth, bit torque with WOB and rock hardness */
export const torqueFor = (wob: number, f: Formation, depth: number) => 600 + depth * 0.35 + (wob > 0 ? wob * (160 + 120 * f.hardness) : 0);
export const TORQUE_MAX = 16500;

export type Mode = "idle" | "drilling" | "connection" | "tripping" | "shutin" | "killing" | "casing" | "done";

export interface SimState {
  t: number;              // game minutes since 05:30 day 1
  depth: number; mode: Mode;
  wob: number; wobTarget: number; flow: number; flowTarget: number;
  mw: number; mwTarget: number; lcm: number; lcmTarget: number;
  bit: number; rop: number; spp: number;
  pit: number;            // active pit volume bbl
  pitBase: number;
  fracBbl: number;        // water/mud left in the frac tanks behind the pits
  cost: number;
  fuel: number;           // gallons
  accum: number;          // accumulator psi
  connTimer: number;
  needTrip: boolean; tripT: number; tripTotal: number; tripOut: boolean; standsRacked: number;
  kick: {
    active: boolean; gain: number; alarm: boolean; alarmT: number; shut: boolean; shutT: number;
    pore: number; sidpp: number; sicp: number; count: number; gasPocketDone: boolean;
  };
  loss: { active: boolean; rate: number; healed: number; total: number };
  kill: {
    stage: "none" | "readings" | "calc" | "weightup" | "circ" | "flowcheck";
    kmw: number; progress: number; choke: number; dpp: number; dppTarget: number; cp: number; cpIdeal: number; dist: number;
    inBand: number; total: number; maasp: number; fractured: boolean; scr: number; spm: number; pumping: boolean;
    /** the pressures through the circulation, for the charts at the end: progress 0..1, drill pipe, its target, casing, bottom hole, and the pore / fracture pressures it must stay between */
    hist: { p: number; dpp: number; tgt: number; cp: number; bhp: number; pore: number; frac: number }[];
  };
  casing: { progress: number; phase: "none" | "run" | "cement" | "done" };
  stats: { connections: number; feetDrilled: number; npt: number; kicksKilled: number; trips: number; stalls: number };
  paused: boolean;
  dp: number; torque: number; stallT: number;
  /** mud-motor life, %: drains faster the closer the diff pressure runs to the stall, and each pressure spike takes a bite */
  motor: number;
  auto: { on: boolean; wob: number; rop: number; dp: number; torque: number; limit: "" | "WOB" | "ROP" | "DIFF" | "TORQUE" };
}

export type SimEvent =
  | { type: "kickAlarm" } | { type: "autoShutIn" } | { type: "lossStart" } | { type: "lossHealed" }
  | { type: "connection" } | { type: "bitDead" } | { type: "tripDone" } | { type: "formation"; name: string }
  | { type: "td" } | { type: "casingDone" } | { type: "killDone"; good: boolean } | { type: "fractured" }
  | { type: "blackout" } | { type: "motorDead" } | { type: "stall" } | { type: "pitLow" } | { type: "dpSpike" };

export class Sim {
  s: SimState;
  events: SimEvent[] = [];
  pitLowFlag = false;
  /** diff-pressure spike multiplier (the original game's DP spikes near the motor limit); decays back to 1 */
  spike = 1;
  private dist = 0;
  /** ROP multiplier from the directional driller: sliding and oscillating cost penetration rate */
  ropMul = 1;
  /** laser drilling (stolen from Singularity): a flat 300 ft/hr, no weight on bit, no bit wear, no motor wear */
  laser = false;
  /** the finale: the same well engine, drilling 800 ft of asteroid */
  astMode = false; private ropBase = 1;
  private get td() { return this.astMode ? 800 : WELL.td; }
  private ropN = 0;
  private killClock = 0; private histAt = -1; private dppQ: { t: number; v: number }[] = [];   // a slow random wobble on the penetration rate
  /** bit bounce (0..1): too much weight for the rock sets the string and the motor hammering; shows on the recorder and in the diff pressure and torque */
  bounce = 0; private bph = 0;
  /** autodriller: one PI loop per limit (ROP, diff, torque). Each holds the WOB that parameter would allow; the weight applied is the lowest of those and the WOB set point. */
  private pi = { rop: 0, dp: 0, tq: 0, on: false };
  hold: number | null = null;
  accumDead = false;
  private lastForm = "";
  constructor() {
    this.s = {
      t: 0, depth: WELL.startDepth, mode: "idle",
      wob: 0, wobTarget: 18, flow: 550, flowTarget: 550,
      mw: 9.0, mwTarget: 9.0, lcm: 0, lcmTarget: 0,
      bit: 100, rop: 0, spp: 0, pit: 600, pitBase: 600, fracBbl: 1000, cost: 2_050_000, fuel: 5200, accum: 3000,
      connTimer: 0, needTrip: false, tripT: 0, tripTotal: 0, tripOut: true, standsRacked: 0,
      kick: { active: false, gain: 0, alarm: false, alarmT: 0, shut: false, shutT: 0, pore: 8.6, sidpp: 0, sicp: 0, count: 0, gasPocketDone: false },
      loss: { active: false, rate: 0, healed: 0, total: 0 },
      kill: { stage: "none", kmw: 0, progress: 0, choke: 0.5, dpp: 0, dppTarget: 0, cp: 0, cpIdeal: 0, dist: 0, inBand: 0, total: 0, maasp: 2300, fractured: false, scr: 900, spm: 30, pumping: false, hist: [] },
      casing: { progress: 0, phase: "none" },
      stats: { connections: 0, feetDrilled: 0, npt: 0, kicksKilled: 0, trips: 0, stalls: 0 },
      paused: true,
      dp: 0, torque: 0, stallT: 0, motor: 100,
      auto: { on: false, wob: 20, rop: 200, dp: 1200, torque: 10000, limit: "" },
    };
  }

  get form() { return formationAt(this.s.depth); }
  get ecd() { return ecdAt(this.s.flow, this.s.depth); }
  get mwEff() { return this.s.mw + this.ecd + this.s.lcm * 0.003; }
  get pore() { return poreAt(this.s.depth); }
  get running() { return this.s.mode === "drilling" || this.s.mode === "connection"; }

  addCost(n: number) { this.s.cost += n; }
  drain(): SimEvent[] { const e = this.events; this.events = []; return e; }

  start() { this.s.mode = "drilling"; this.s.paused = false; }

  /** Driller shuts the well in (BOP annular closes). Needs accumulator pressure. */
  shutIn(late = false): boolean {
    const s = this.s;
    if (s.mode === "shutin" || s.mode === "killing") return true;
    if (s.accum < 1200) return false;
    s.mode = "shutin"; s.kick.shut = true; s.kick.shutT = s.t; s.accum -= 600;
    const pore = this.pore;
    const sidpp = Math.max(120, (pore - s.mw) * 0.052 * s.depth);
    s.kick.sidpp = sidpp;
    s.kick.sicp = sidpp + 90 + s.kick.gain * (late ? 14 : 9);
    s.kick.pore = pore;
    s.kill.stage = "readings";
    s.kill.maasp = 2300;
    return true;
  }

  /** KMW the crew should reach */
  killMudWeight(): number { return this.s.mw + this.s.kick.sidpp / (0.052 * this.s.depth); }

  beginCirculation() {
    const s = this.s;
    s.mode = "killing"; s.kill.stage = "circ"; s.kill.progress = 0; s.kill.inBand = 0; s.kill.total = 0;
    s.kill.choke = 0.5; s.kill.kmw = s.mwTarget; s.kill.pumping = true;
    s.kill.cp = s.kick.sicp; s.kill.dpp = s.kick.sidpp + s.kill.scr;
    this.dist = 0; this.killClock = 0; this.dppQ = []; s.kill.hist = []; this.histAt = -1;
  }

  /** where the bit is in the hole: the hole depth normally, but it comes up the hole on a trip out and goes back down on the way in */
  get bitDepth(): number {
    const s = this.s;
    if (s.mode !== "tripping") return s.depth;
    const frac = Math.min(1, s.tripT / Math.max(1, s.tripTotal));
    const out = Math.min(1, frac * (s.tripTotal / (s.tripTotal - 60 + 1e-6)));
    return frac < 0.5 ? s.depth * (1 - out) : s.depth * Math.min(1, (frac - 0.5) * 2);
  }

  /** true while the string is coming out of the hole, false while it is running back in */
  get tripGoingOut(): boolean { return Math.min(1, this.s.tripT / Math.max(1, this.s.tripTotal)) < 0.5; }

  openBopResume() {
    const s = this.s;
    s.kick.shut = false; s.kick.active = false; s.kick.gain = 0; s.kick.alarm = false;
    s.kill.stage = "none"; s.mode = "drilling"; s.kill.pumping = false; this.dist = 0;
  }

  startTrip() {
    const s = this.s;
    s.mode = "tripping"; s.tripT = 0; s.tripOut = true; s.stats.trips++;
    s.tripTotal = (s.depth * 2) / 2000 * 60 + 60; // minutes: round trip @ 2000 ft/hr + 1 hr bit change
  }

  /** an LCM sweep: a pill of lost-circulation material pumped round from the driller's console. It lifts the LCM in the system by 30 lb/bbl for a while (it fades as it circulates out) and costs $5,000. */
  sweep(): string | null {
    const s = this.s;
    if (s.mode !== "drilling" && s.mode !== "connection" && s.mode !== "idle") return "Not now. Circulate the pill when you are drilling or sitting on bottom.";
    if (s.lcm > s.lcmTarget + 12) return "The last sweep is still going round.";
    s.lcm = Math.min(80, s.lcm + 30); s.cost += 5000;
    return null;
  }

  /** start the asteroid hole: surface, a fresh bit and motor, and the rock changes with depth */
  beginAsteroid() {
    const s = this.s; this.astMode = true; formOverride = (d) => ASTEROID.find((f) => d < f.limit) ?? ASTEROID[ASTEROID.length - 1];
    this.ropBase = 5; s.depth = 0.1; s.mode = "drilling"; s.paused = false; s.wob = 0; s.wobTarget = 18; s.bit = 100; s.motor = 100; s.stallT = 0; s.needTrip = false;
    s.kick.active = false; s.kick.shut = false; s.kick.alarm = false; s.kick.gain = 0; s.fuel = 1e9; s.flow = s.flowTarget = 700; s.mw = s.mwTarget = 9; s.pit = 600; s.auto.on = false; this.dist = 0; this.hold = null;
  }
  /** debris hits the rig: a pressure spike and some motor damage */
  hit(motor: number) { this.spike = 1.35; this.s.motor = Math.max(0, this.s.motor - motor); }

  startCasing() { const s = this.s; s.mode = "casing"; s.casing = { progress: 0, phase: "run" }; }

  step(dt: number) { // dt in game minutes
    const s = this.s;
    if (s.paused || s.mode === "done") return;
    s.t += dt;
    // spread cost
    s.cost += (WELL.spreadPerDay / 1440) * dt;
    if (s.fuel > 0 && !this.astMode) s.fuel -= (s.mode === "idle" ? 1.2 : 2.6) * dt;
    if (s.fuel <= 0 && s.mode !== "idle") { s.fuel = 0; this.events.push({ type: "blackout" }); }
    if (!this.accumDead && s.accum < 3000) s.accum = Math.min(3000, s.accum + 15 * dt);

    // mud property lags
    const dmw = s.mwTarget - s.mw; s.mw += Math.sign(dmw) * Math.min(Math.abs(dmw), 0.6 * dt);   // weighting up takes a couple of seconds
    const dl = s.lcmTarget - s.lcm; s.lcm += Math.sign(dl) * Math.min(Math.abs(dl), 0.6 * dt);
    const df = s.flowTarget - s.flow; s.flow += Math.sign(df) * Math.min(Math.abs(df), 25 * dt);
    if (s.lcm > 0 && s.loss.active === false) s.lcm = Math.max(s.lcmTarget, s.lcm - 0.01 * dt); // slow decay

    const f = this.form;
    if (f.name !== this.lastForm) { this.lastForm = f.name; this.events.push({ type: "formation", name: f.name }); }

    // ---- pressure window ----
    const circulating = (s.mode === "drilling" || s.mode === "connection") && !this.astMode;
    if (circulating) {
      const eff = this.mwEff, pore = this.pore;
      if (!s.kick.active && eff < pore) {
        s.kick.active = true; s.kick.gain = 0; s.kick.count++;
        if (pore === WELL.gasPocket.pore) s.kick.gasPocketDone = true;
      }
      if (s.kick.active && !s.kick.shut) {
        const rate = Math.max(1.0, Math.min(14, (pore - eff) * 9 + 1.2));
        s.kick.gain += rate * dt; s.pit += rate * dt;
        if (!s.kick.alarm && s.kick.gain >= 6) { s.kick.alarm = true; s.kick.alarmT = s.t; this.events.push({ type: "kickAlarm" }); }
        if (s.kick.alarm && s.t - s.kick.alarmT > 25) { if (this.shutIn(true)) this.events.push({ type: "autoShutIn" }); }
      }
      const frac = fracAt(s.depth);
      // once enough LCM is in the system the fractures are sealed: losses stay healed instead of restarting the moment they stop
      if (eff > frac && !s.loss.active && s.lcm >= 20) { /* sealed */ }
      else if (eff > frac) {
        const rate = lossRateAt(s.depth) * (1 + (eff - frac) * 3) * Math.max(0.05, 1 - s.lcm / 70);
        if (!s.loss.active) { s.loss.active = true; s.loss.healed = 0; this.events.push({ type: "lossStart" }); }
        s.loss.rate = rate;
        const lostBbl = (rate / 60) * dt; s.pit -= lostBbl; s.loss.total += lostBbl;
        s.cost += lostBbl * 100;
        s.loss.healed += (s.lcm / 30) * dt * 0.6;
        if (s.loss.healed > 25 && s.lcm > 20) { s.loss.active = false; s.loss.rate = 0; this.events.push({ type: "lossHealed" }); }
      } else if (s.loss.active) { s.loss.active = false; s.loss.rate = 0; this.events.push({ type: "lossHealed" }); }
      // (no passive top-up any more: when the pits run low someone has to transfer from the frac tanks)
    }

    // ---- modes ----
    switch (s.mode) {
      case "drilling": {
        const flowF = Math.max(0.5, Math.min(1.6, 1 + ((s.flow - 550) / 550) * 0.6));
        const mudF = 1.1 - s.mw * 0.015;
        const bitF = 0.35 + 0.65 * (s.bit / 100);
        const fac = flowF * mudF * bitF;
        // pits run dry: the pumps lose suction and you cannot drill. Transfer from the frac tanks.
        if (s.pit < 120 && circulating) {
          if (!this.pitLowFlag) { this.pitLowFlag = true; this.events.push({ type: "pitLow" }); }
          s.rop = 0; s.wob = Math.max(0, s.wob - 8 * dt); s.dp = 0; s.torque = 0; s.stats.npt += dt / 60; break;
        } else if (s.pit > 180) this.pitLowFlag = false;
        // motor stalled: pick up off bottom and wait it out
        if (s.stallT > 0) {
          s.stallT -= dt; s.stats.npt += dt / 60; s.wob = Math.max(0, s.wob - 10 * dt); s.rop = 0; s.dp = 0; s.torque = 0; s.spp = 900;
          break;
        }
        // AUTODRILLER: hold the lowest of the WOB set point, the WOB that would exceed the ROP limit, and the WOB that would exceed the diff limit
        if (s.auto.on) {
          // proportional + integral, no derivative: error is how far under the limit the measured value is, as a fraction of the limit
          const P = this.pi, KP = 14, KI = 1.6;
          if (!P.on) { P.on = true; P.rop = P.dp = P.tq = Math.max(s.wobTarget, 1); }
          const loop = (u: number, meas: number, sp: number) => { const e = (sp - meas) / Math.max(sp, 1); return Math.max(0, Math.min(80, u + KI * e * dt * 10)) + 0 * KP; };
          const tq = s.auto.torque ?? 10000;
          P.rop = loop(P.rop, s.rop, s.auto.rop); P.dp = loop(P.dp, s.dp, s.auto.dp); P.tq = loop(P.tq, s.torque, tq);
          // the P term acts on the output right away; the integrators hold the long-term weight
          const out = (u: number, meas: number, sp: number) => Math.max(0, u + KP * Math.min(0.5, (sp - meas) / Math.max(sp, 1)));
          const cRop = out(P.rop, s.rop, s.auto.rop), cDp = out(P.dp, s.dp, s.auto.dp), cTq = out(P.tq, s.torque, tq);
          const w = Math.min(s.auto.wob, cRop, cDp, cTq);
          s.auto.limit = w === s.auto.wob ? "WOB" : w === cRop ? "ROP" : w === cDp ? "DIFF" : "TORQUE";
          // anti-windup: a loop that is not the limiting one never runs far ahead of the weight actually applied
          for (const k of ["rop", "dp", "tq"] as const) P[k] = Math.min(P[k], w + 6);
          s.wobTarget = Math.max(0, Math.min(80, Math.round(w * 10) / 10));
        } else { s.auto.limit = ""; this.pi.on = false; }
        s.wob = this.laser ? 0 : s.wobTarget;                   // like the original: weight is whatever you set, right now (the laser needs none)
        const eff = s.wob;                                      // and ROP is simply proportional to it (no founder knee)
        const baseDp = diffPressure(s.wob, f);
        // near the motor limit the pressure throws spikes, like the original; each decays back in a second or two
        if (baseDp >= 1850 && Math.random() < 1 - Math.exp(-(0.15 + (baseDp - 1850) / 220) * dt)) { this.spike = 1.12 + Math.random() * 0.2; this.events.push({ type: "dpSpike" }); s.motor = Math.max(0, s.motor - (5 + Math.random() * 5)); }
        this.spike = 1 + (this.spike - 1) * Math.exp(-1.3 * dt);
        // bounce: past the weight this rock wants, and the harder the rock the worse, the bit starts to hop
        this.bounce = Math.max(0, Math.min(1, (s.wob / woptFor(f) - 0.95) * (0.4 + f.hardness) * 1.4)); this.bph += dt * (7 + this.bounce * 5);
        const hop = this.bounce * Math.sin(this.bph) + this.bounce * 0.4 * Math.sin(this.bph * 2.3 + 1);
        s.dp = baseDp * (1 + (Math.random() * 0.15 - 0.075) + hop * 0.22) * this.spike;   // ±7.5 % noise every frame, plus the hop
        s.torque = torqueFor(s.wob, f, s.depth) * (1 + (Math.random() * 0.1 - 0.05) + hop * 0.18);
        if (this.laser) { s.dp = 180 + Math.random() * 30; s.torque = 400 + Math.random() * 60; }
        if (!this.laser && (s.dp >= STALL_DP && s.wob > 0) || (s.torque > TORQUE_MAX && Math.random() < 1 - Math.exp(-0.5 * dt))) {
          s.stallT = 12; s.stats.stalls++; s.cost += 8000; this.events.push({ type: "stall" });
        }
        // motor wear, by how hard the pressure is run (original tiers: under 1,000 psi almost none, 1,350 and 1,850 are the knees)
        if (!this.laser) s.motor = Math.max(0, s.motor - (s.dp < 1000 ? 0 : s.dp >= 1850 ? 0.25 : s.dp >= 1350 ? 0.05 : 0.01) * dt);
        if (s.motor <= 0 && !s.needTrip) { s.needTrip = true; this.events.push({ type: "motorDead" }); }
        let rop = eff > 0 ? (eff * 6) / f.hardness : 0;
        rop = Math.min(600, rop * fac * this.ropMul * this.ropBase);
        this.ropN = this.ropN * 0.93 + (Math.random() - 0.5) * 0.11;
        if (s.auto.on && s.auto.limit === "ROP") rop = Math.min(rop, s.auto.rop);   // held at the limit: dead flat
        else rop *= 1 + this.ropN * (1 + this.bounce);                                 // otherwise it wanders around with the rock and the bit
        if (this.laser) rop = 300;                                                     // 300 ft/hr, dead steady
        if (s.needTrip || s.fuel <= 0) rop = 0;
        s.rop = rop;
        const dd = (rop / 60) * dt;
        s.depth = Math.min(this.hold ?? this.td, s.depth + dd); s.stats.feetDrilled += dd;
        this.dist += dd;
        const wear = this.laser ? 0 : 2.4 * Math.pow(Math.max(s.wob, 0) / 20, 2.2) * f.abrasiveness * (dd > 0 ? 1 : 0);
        s.bit = Math.max(0, s.bit - wear * (dt / 60) * (rop > 0 ? 1 : 0));
        if (s.bit < 8 && !s.needTrip) { s.needTrip = true; this.events.push({ type: "bitDead" }); }
        if (this.dist >= WELL.stand) { this.dist = 0; s.mode = "connection"; s.connTimer = 3; s.stats.connections++; this.events.push({ type: "connection" }); }
        if (s.depth >= this.td) { s.mode = "idle"; s.rop = 0; if (!this.astMode) this.events.push({ type: "td" }); }
        s.spp = 1500 + s.flow * 0.9 + s.wob * 8 + (s.depth / 8500) * 400;
        break;
      }
      case "connection":
        s.rop = 0; s.wob = Math.max(0, s.wob - 6 * dt); s.connTimer -= dt;
        if (s.connTimer <= 0) s.mode = "drilling";
        s.spp = 900;
        break;
      case "tripping": {
        s.rop = 0; s.wob = 0; s.tripT += dt;
        const frac = Math.min(1, s.tripT / s.tripTotal);
        const outFrac = Math.min(1, frac * 2 * (s.tripTotal / (s.tripTotal - 60 + 1e-6)) * 0.5);
        s.standsRacked = frac < 0.5 ? Math.min(40, Math.round(outFrac * 80 * (s.depth / 8500))) : Math.round(40 * (1 - (frac - 0.5) * 2));
        if (s.tripT >= s.tripTotal) {
          s.bit = 100; s.motor = 100; s.needTrip = false; s.mode = "drilling"; s.cost += 15000 + 25000; s.standsRacked = 40;
          this.events.push({ type: "tripDone" });
        }
        s.spp = 0;
        break;
      }
      case "shutin": s.rop = 0; s.stats.npt += dt / 60; s.spp = 0; break;
      case "killing": this.stepKill(dt); s.stats.npt += dt / 60; break;
      case "casing": {
        s.rop = 0;
        const rate = s.casing.phase === "run" ? 1 / (6 * 60) : 1 / (2 * 60);   // about 36 s to run the casing and 12 s to cement it at the casing time scale
        s.casing.progress += rate * dt;
        if (s.casing.progress >= 1) {
          if (s.casing.phase === "run") { s.casing = { progress: 0, phase: "cement" }; }
          else { s.casing = { progress: 1, phase: "done" }; s.cost += WELL.casingCost; s.mode = "done"; this.events.push({ type: "casingDone" }); }
        }
        break;
      }
      default: s.rop = 0; break;
    }
  }

  // ---- driller's-method circulation with a manual choke ----
  private stepKill(dt: number) {
    const s = this.s, k = s.kill;
    const total = 35.5; // bottoms-up circulation takes about 36 s at 1x (half of what it was)
    k.progress = Math.min(1, k.progress + dt / total);
    const p = k.progress;
    const icp = s.kick.sidpp + k.scr, fcp = k.scr * (s.mw > 0 ? (k.kmw / Math.max(1, s.mw)) : 1);
    k.dppTarget = p < 0.5 ? icp + (fcp - icp) * (p / 0.5) : fcp;
    k.cpIdeal = s.kick.sicp * (1 + 0.28 * Math.sin(Math.PI * p)) - s.kick.sidpp * Math.min(1, p / 0.5) * 0.85;
    // disturbance: gas expansion makes casing pressure wander
    this.dist += (Math.random() - 0.5) * 0.45 * dt;   // calm: the gas still makes it wander, but gently
    this.dist *= 1 - 0.06 * dt;
    const d = this.dist * 65;
    // the choke setting that holds the right bottom-hole pressure moves as the gas comes up and the kill mud goes down: leaving the choke alone drifts out of the band
    const off = 0.12 * Math.sin(2 * Math.PI * p * 0.9);
    const target = k.cpIdeal * (0.35 + 1.3 * (k.choke - off)) + d;
    k.cp = target;                                  // the casing pressure answers the choke at once
    // the drill pipe gauge sees exactly the same change a few seconds later: the pressure wave has to travel down the pipe and back (casing +400 psi means drill pipe +400 psi)
    this.killClock += dt; this.dppQ.push({ t: this.killClock, v: k.cp - k.cpIdeal });
    while (this.dppQ.length > 1 && this.dppQ[1].t <= this.killClock - 3) this.dppQ.shift();
    k.dpp = k.dppTarget + (this.killClock >= 3 ? this.dppQ[0].v : 0);
    s.spp = k.dpp;
    // bottom hole pressure: the pipe's hydrostatic plus the drill pipe pressure. Holding the pipe on target keeps it just over the pore pressure; every psi of drift on the gauge is a psi on the formation
    if (this.killClock - this.histAt >= 0.4 || k.progress >= 1) {
      this.histAt = this.killClock; const pore = s.kick.pore * 0.052 * s.depth, frac = fracAt(s.depth) * 0.052 * s.depth;
      (k.hist ??= []).push({ p: k.progress, dpp: k.dpp, tgt: k.dppTarget, cp: k.cp, bhp: pore + 150 + (k.dpp - k.dppTarget), pore, frac });
    }
    k.total += dt; if (Math.abs(k.dpp - k.dppTarget) <= 120) k.inBand += dt;
    if (k.cp > k.maasp && !k.fractured) { k.fractured = true; this.events.push({ type: "fractured" }); s.cost += 220000; s.pit -= 120; }
    // kill mud displaces the hole: mud weight in the system moves to KMW
    if (p > 0.5) { s.mw += (k.kmw - s.mw) * Math.min(1, 0.04 * dt); }
    s.kick.gain = Math.max(0, s.kick.gain * (1 - p * 0.02 * dt));
    if (k.progress >= 1) {
      const frac = k.inBand / Math.max(1, k.total);
      const good = frac > 0.7 && !k.fractured;
      k.stage = "flowcheck"; k.pumping = false; s.mode = "shutin";
      // the kill leaves the hole overbalanced for good: the well must not kick again the moment it goes back to drilling
      const need = s.kick.pore + 0.3 - this.ecd - s.lcm * 0.003;
      s.mw = Math.max(s.mw, k.kmw - 0.1, need); s.mwTarget = Math.max(s.mwTarget, s.mw);
      if (!good) s.cost += 150000;
      s.kick.sidpp = 0; s.kick.sicp = 0; s.stats.kicksKilled++;
      this.events.push({ type: "killDone", good });
    }
  }
}

export function clockString(minutes: number): { day: number; hhmm: string; hour: number } {
  const total = 6 * 60 + 5 + minutes;
  const day = Math.floor(total / 1440) + 1;
  const m = Math.floor(total % 1440);
  const hh = Math.floor(m / 60), mm = m % 60;
  return { day, hhmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, hour: hh + mm / 60 };
}
