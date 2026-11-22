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

export const formationAt = (d: number) => FORMATIONS.find((f) => d < f.limit) ?? FORMATIONS[FORMATIONS.length - 1];

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
export const STALL_DP = 1650;

export type Mode = "idle" | "drilling" | "connection" | "tripping" | "shutin" | "killing" | "casing" | "done";

export interface SimState {
  t: number;              // game minutes since 05:30 day 1
  depth: number; mode: Mode;
  wob: number; wobTarget: number; flow: number; flowTarget: number;
  mw: number; mwTarget: number; lcm: number; lcmTarget: number;
  bit: number; rop: number; spp: number;
  pit: number;            // active pit volume bbl
  pitBase: number;
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
  };
  casing: { progress: number; phase: "none" | "run" | "cement" | "done" };
  stats: { connections: number; feetDrilled: number; npt: number; kicksKilled: number; trips: number; stalls: number };
  paused: boolean;
  dp: number; stallT: number;
  auto: { on: boolean; wob: number; rop: number; dp: number; limit: "" | "WOB" | "ROP" | "DIFF" };
}

export type SimEvent =
  | { type: "kickAlarm" } | { type: "autoShutIn" } | { type: "lossStart" } | { type: "lossHealed" }
  | { type: "connection" } | { type: "bitDead" } | { type: "tripDone" } | { type: "formation"; name: string }
  | { type: "td" } | { type: "casingDone" } | { type: "killDone"; good: boolean } | { type: "fractured" }
  | { type: "blackout" } | { type: "stall" };

export class Sim {
  s: SimState;
  events: SimEvent[] = [];
  private dist = 0;
  hold: number | null = null;
  accumDead = false;
  private lastForm = "";
  constructor() {
    this.s = {
      t: 0, depth: WELL.startDepth, mode: "idle",
      wob: 0, wobTarget: 18, flow: 550, flowTarget: 550,
      mw: 9.0, mwTarget: 9.0, lcm: 0, lcmTarget: 0,
      bit: 100, rop: 0, spp: 0, pit: 600, pitBase: 600, cost: 2_050_000, fuel: 5200, accum: 3000,
      connTimer: 0, needTrip: false, tripT: 0, tripTotal: 0, tripOut: true, standsRacked: 0,
      kick: { active: false, gain: 0, alarm: false, alarmT: 0, shut: false, shutT: 0, pore: 8.6, sidpp: 0, sicp: 0, count: 0, gasPocketDone: false },
      loss: { active: false, rate: 0, healed: 0, total: 0 },
      kill: { stage: "none", kmw: 0, progress: 0, choke: 0.5, dpp: 0, dppTarget: 0, cp: 0, cpIdeal: 0, dist: 0, inBand: 0, total: 0, maasp: 2300, fractured: false, scr: 900, spm: 30, pumping: false },
      casing: { progress: 0, phase: "none" },
      stats: { connections: 0, feetDrilled: 0, npt: 0, kicksKilled: 0, trips: 0, stalls: 0 },
      paused: true,
      dp: 0, stallT: 0,
      auto: { on: false, wob: 20, rop: 200, dp: 1200, limit: "" },
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
    this.dist = 0;
  }

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

  startCasing() { const s = this.s; s.mode = "casing"; s.casing = { progress: 0, phase: "run" }; }

  step(dt: number) { // dt in game minutes
    const s = this.s;
    if (s.paused || s.mode === "done") return;
    s.t += dt;
    // spread cost
    s.cost += (WELL.spreadPerDay / 1440) * dt;
    if (s.fuel > 0) s.fuel -= (s.mode === "idle" ? 1.2 : 2.6) * dt;
    if (s.fuel <= 0 && s.mode !== "idle") { s.fuel = 0; this.events.push({ type: "blackout" }); }
    if (!this.accumDead && s.accum < 3000) s.accum = Math.min(3000, s.accum + 15 * dt);

    // mud property lags
    const dmw = s.mwTarget - s.mw; s.mw += Math.sign(dmw) * Math.min(Math.abs(dmw), 0.04 * dt);
    const dl = s.lcmTarget - s.lcm; s.lcm += Math.sign(dl) * Math.min(Math.abs(dl), 0.6 * dt);
    const df = s.flowTarget - s.flow; s.flow += Math.sign(df) * Math.min(Math.abs(df), 25 * dt);
    if (s.lcm > 0 && s.loss.active === false) s.lcm = Math.max(s.lcmTarget, s.lcm - 0.01 * dt); // slow decay

    const f = this.form;
    if (f.name !== this.lastForm) { this.lastForm = f.name; this.events.push({ type: "formation", name: f.name }); }

    // ---- pressure window ----
    const circulating = s.mode === "drilling" || s.mode === "connection";
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
      if (eff > frac) {
        const rate = lossRateAt(s.depth) * (1 + (eff - frac) * 3) * Math.max(0.05, 1 - s.lcm / 70);
        if (!s.loss.active) { s.loss.active = true; s.loss.healed = 0; this.events.push({ type: "lossStart" }); }
        s.loss.rate = rate;
        const lostBbl = (rate / 60) * dt; s.pit -= lostBbl; s.loss.total += lostBbl;
        s.cost += lostBbl * 100;
        s.loss.healed += (s.lcm / 30) * dt * 0.6;
        if (s.loss.healed > 25 && s.lcm > 20) { s.loss.active = false; s.loss.rate = 0; this.events.push({ type: "lossHealed" }); }
      } else if (s.loss.active) { s.loss.active = false; s.loss.rate = 0; this.events.push({ type: "lossHealed" }); }
      if (!s.loss.active && s.pit < s.pitBase && !s.kick.active) s.pit = Math.min(s.pitBase, s.pit + 0.8 * dt); // top up
    }

    // ---- modes ----
    switch (s.mode) {
      case "drilling": {
        const flowF = Math.max(0.5, Math.min(1.6, 1 + ((s.flow - 550) / 550) * 0.6));
        const mudF = 1.1 - s.mw * 0.015;
        const bitF = 0.35 + 0.65 * (s.bit / 100);
        const wopt = woptFor(f), fac = flowF * mudF * bitF;
        // motor stalled: pick up off bottom and wait it out
        if (s.stallT > 0) {
          s.stallT -= dt; s.stats.npt += dt / 60; s.wob = Math.max(0, s.wob - 10 * dt); s.rop = 0; s.dp = 0; s.spp = 900;
          break;
        }
        // AUTODRILLER: hold the lowest of the WOB set point, the WOB that would exceed the ROP limit, and the WOB that would exceed the diff limit
        if (s.auto.on) {
          const effMax = (s.auto.rop * f.hardness) / (6 * Math.max(0.05, fac));
          const wRop = effMax <= wopt ? effMax : wopt + (effMax - wopt) / 0.3;
          const wDp = (s.auto.dp * (f.hardness / 1.5)) / 12;
          const w = Math.min(s.auto.wob, wRop, wDp);
          s.auto.limit = w === s.auto.wob ? "WOB" : w === wRop ? "ROP" : "DIFF";
          s.wobTarget = Math.max(0, Math.round(w * 10) / 10);
        } else s.auto.limit = "";
        s.wob += Math.sign(s.wobTarget - s.wob) * Math.min(Math.abs(s.wobTarget - s.wob), 3 * dt);
        const eff = s.wob <= wopt ? s.wob : wopt + (s.wob - wopt) * 0.3;
        s.dp = diffPressure(s.wob, f) * (1 + (Math.random() * 0.15 - 0.075));
        if (s.dp > STALL_DP && Math.random() < 1 - Math.exp(-0.5 * dt)) {
          s.stallT = 12; s.stats.stalls++; s.cost += 8000; this.events.push({ type: "stall" });
        }
        let rop = eff > 0 ? (eff * 6) / f.hardness : 0;
        rop = Math.min(380, rop * fac);
        if (s.needTrip || s.fuel <= 0) rop = 0;
        s.rop = rop;
        const dd = (rop / 60) * dt;
        s.depth = Math.min(this.hold ?? WELL.td, s.depth + dd); s.stats.feetDrilled += dd;
        this.dist += dd;
        const wear = 2.4 * Math.pow(Math.max(s.wob, 0) / 20, 2.2) * f.abrasiveness * (dd > 0 ? 1 : 0);
        s.bit = Math.max(0, s.bit - wear * (dt / 60) * (rop > 0 ? 1 : 0));
        if (s.bit < 8 && !s.needTrip) { s.needTrip = true; this.events.push({ type: "bitDead" }); }
        if (this.dist >= WELL.stand) { this.dist = 0; s.mode = "connection"; s.connTimer = 3; s.stats.connections++; this.events.push({ type: "connection" }); }
        if (s.depth >= WELL.td) { s.mode = "idle"; s.rop = 0; this.events.push({ type: "td" }); }
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
          s.bit = 100; s.needTrip = false; s.mode = "drilling"; s.cost += 15000 + 25000; s.standsRacked = 40;
          this.events.push({ type: "tripDone" });
        }
        s.spp = 0;
        break;
      }
      case "shutin": s.rop = 0; s.stats.npt += dt / 60; s.spp = 0; break;
      case "killing": this.stepKill(dt); s.stats.npt += dt / 60; break;
      case "casing": {
        s.rop = 0;
        const rate = s.casing.phase === "run" ? 1 / (14 * 60) : 1 / (4 * 60);
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
    const total = 71; // sim minutes to circulate bottoms-up: 71 s at 1x, exactly a third of the original ~214 s
    k.progress = Math.min(1, k.progress + dt / total);
    const p = k.progress;
    const icp = s.kick.sidpp + k.scr, fcp = k.scr * (s.mw > 0 ? (k.kmw / Math.max(1, s.mw)) : 1);
    k.dppTarget = p < 0.5 ? icp + (fcp - icp) * (p / 0.5) : fcp;
    k.cpIdeal = s.kick.sicp * (1 + 0.28 * Math.sin(Math.PI * p)) - s.kick.sidpp * Math.min(1, p / 0.5) * 0.85;
    // disturbance: gas expansion makes casing pressure wander
    this.dist += (Math.random() - 0.5) * 0.9 * dt;
    this.dist *= 1 - 0.02 * dt;
    const d = this.dist * 65;
    const target = k.cpIdeal * (0.35 + 1.3 * k.choke) + d;
    k.cp += (target - k.cp) * Math.min(1, 0.5 * dt);
    k.dpp = k.dppTarget + (k.cp - k.cpIdeal) * 0.9;
    s.spp = k.dpp;
    k.total += dt; if (Math.abs(k.dpp - k.dppTarget) <= 120) k.inBand += dt;
    if (k.cp > k.maasp && !k.fractured) { k.fractured = true; this.events.push({ type: "fractured" }); s.cost += 220000; s.pit -= 120; }
    // kill mud displaces the hole: mud weight in the system moves to KMW
    if (p > 0.5) { s.mw += (k.kmw - s.mw) * Math.min(1, 0.04 * dt); }
    s.kick.gain = Math.max(0, s.kick.gain * (1 - p * 0.02 * dt));
    if (k.progress >= 1) {
      const frac = k.inBand / Math.max(1, k.total);
      const good = frac > 0.7 && !k.fractured;
      k.stage = "flowcheck"; k.pumping = false; s.mode = "shutin";
      s.mw = Math.max(s.mw, k.kmw - 0.1); s.mwTarget = Math.max(s.mwTarget, s.mw);
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
