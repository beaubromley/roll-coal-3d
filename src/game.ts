import { Scene, Vector3, Matrix, MeshBuilder, StandardMaterial, Color3, Mesh, DirectionalLight, HemisphericLight, Viewport, DynamicTexture } from "@babylonjs/core";
import { Rig, F } from "./rig";
import { Player } from "./player";
import { Sim, WELL, clockString, formationAt, poreAt, fracAt, STALL_DP } from "./sim";
import { Sfx } from "./audio";
import { UI, Who, Choice, $ } from "./ui";
import { Human } from "./npcs";
import { pushOutXZ } from "./builder";
import { Mini } from "./minigames";
import { Vehicles } from "./vehicles";
import { defineMissions } from "./tasks";

export interface Step {
  text: string;
  at?: () => Vector3 | null;
  label?: string;
  r?: number;
  act?: (done: () => void) => void;
  watch?: () => boolean;
  enter?: () => void;
}
export interface Mission {
  id: string; title: string; sub: string; steps: Step[];
  trigger: () => boolean; start?: () => void; end?: () => void;
  a?: number; m?: number; priority?: boolean;
}
interface Interactable { pos: () => Vector3; label: () => string; r: number; act: () => void; ok?: () => boolean; mission?: boolean }

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const money = (n: number) => "$" + (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : fmt(n));
const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export class Game {
  started = false;
  approval = 3; morale = 62; incidents = 0;
  interacts: Interactable[] = [];
  queue: Mission[] = [];
  active: { m: Mission; i: number } | null = null;
  stack: { m: Mission; i: number }[] = [];
  missionNo = 0; missionTotal = 0;
  realT = 0; lastDone = 0;
  sleeping = false; sleepUntil = 0;
  live = false; // keep clock running while a panel is open
  interns: Human[] = []; trail: Vector3[] = []; trailT = 0;
  deer = { target: null as Vector3 | null, shoo: 0 };
  snake: Mesh | null = null;
  asteroid: Mesh | null = null; asteroidT = -1;
  orderT = -1; casingOrder = 0;
  kmwInput = 0;
  flags: Record<string, any> = {};
  nearest: Interactable | null = null;
  hold: number | null = null;
  holdPending = false;
  lastDistrict = "";
  chokeKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  env: { hemi: HemisphericLight; sun: DirectionalLight };
  slip = { t: 0, hits: 0, tries: 0, on: false };

  constructor(public scene: Scene, public rig: Rig, public player: Player, public sim: Sim, public sfx: Sfx, public ui: UI,
              env: { hemi: HemisphericLight; sun: DirectionalLight }) {
    this.env = env;
    this.ui.onPanelOpen = () => { this.player.enabled = false; this.player.unlock(); };
    this.ui.onPanelClose = () => { this.mini.cleanup(); this.miniTick = null; this.live = false; this.slip.on = false; if (this.chokeKeyHandler) { window.removeEventListener("keydown", this.chokeKeyHandler); this.chokeKeyHandler = null; } this.player.enabled = true; this.player.lock(); };
    this.player.onFall = (m) => this.fell(m);
    this.player.onRampFall = (h) => {
      this.sfx.thud(); this.sim.addCost(3000); this.inc(1, "SLIP ON V-DOOR RAMP");
      this.radio("earl", `You slid ${Math.round(h * 3.28)} feet down the V-door on your backside. That's a recordable. The ramp is greased on purpose, boss. The sign says so.`, 8000);
    };
    this.player.onStep = () => this.sfx.step();
    this.buildAmbient();
    this.buildMissions();
    this.buildSky();
    this.wirePause();
  }

  // ---------- minigames + shortcut debts ----------
  mini = new Mini(this);
  veh!: Vehicles;
  miniTick: ((dt: number) => void) | null = null;
  /** Consequences of taking the "wing it" shortcut: they come due later (sim minutes or depth), with a chance. */
  debts: { id: string; dueT?: number; dueDepth?: number; chance: number; run: () => void }[] = [];
  addDebt(d: { id: string; afterMin?: number; atDepth?: number; chance: number; run: () => void }) {
    this.debts.push({ id: d.id, dueT: d.afterMin !== undefined ? this.sim.s.t + d.afterMin : undefined, dueDepth: d.atDepth, chance: d.chance, run: d.run });
  }
  private processDebts() {
    if (!this.debts.length || this.paused) return;
    const s = this.sim.s;
    for (const d of [...this.debts]) {
      const due = (d.dueT !== undefined && s.t >= d.dueT) || (d.dueDepth !== undefined && s.depth >= d.dueDepth);
      if (!due) continue;
      this.debts.splice(this.debts.indexOf(d), 1);
      if (Math.random() <= d.chance) d.run();
    }
  }
  shortcutToast(what: string) { this.ui.toast("SHORTCUT TAKEN", what); this.sfx.click(); }
  openMini(html: string, tick?: (dt: number) => void, wide = false): HTMLElement {
    this.player.enabled = false; this.player.unlock(); this.live = false;
    const p = this.ui.panel(html, { wide, closable: false }); this.ui.closable = false;
    let last = performance.now();
    this.miniTick = tick ?? null;
    (this.ui as any).panelTick = () => { const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; this.miniTick?.(dt); };
    return p;
  }
  closeMini() { this.ui.closable = true; this.ui.closePanel(); }
  forceStall(why = "") {
    const s = this.sim.s; if (s.stallT > 0) return;
    s.stallT = 12; s.stats.stalls++; s.cost += 8000; s.auto.on = false;
    this.radio("dale", why || "Motor stalled! Picking up off bottom — somebody guessed wrong on those weights.", 9000);
  }

  // ---------- pause ----------
  paused = false;
  isTouch = false;
  private controlsHtml() {
    const rows: [string, string][] = this.isTouch
      ? [["STICK", "MOVE"], ["DRAG", "LOOK"], ["USE", "INTERACT"], ["JUMP", "JUMP"], ["RUN", "SPRINT"], ["CAM", "1ST / 3RD"], ["||", "PAUSE"]]
      : [["WASD", "MOVE"], ["SHIFT", "SPRINT"], ["MOUSE", "LOOK"], ["SPACE", "JUMP"], ["E", "INTERACT"], ["V", "1ST / 3RD"], ["ESC / P", "PAUSE"], ["M", "MUTE"]];
    return rows.map((r) => `<span>${r[0]}</span><em>${r[1]}</em>`).join("");
  }
  private wirePause() {
    $("pResume").addEventListener("click", () => this.togglePause(false));
    $("pCtrl").addEventListener("click", () => {
      const b = $("pctrlbox"); b.innerHTML = this.controlsHtml();
      b.style.display = b.style.display === "none" ? "grid" : "none";
    });
    $("pSound").addEventListener("click", () => { this.sfx.init(); this.sfx.setMuted(!this.sfx.muted); this.refreshPause(); });
    $("pQuit").addEventListener("click", () => location.reload());
  }
  // ---------- days vs depth curve (shown while paused) ----------
  depthLog: [number, number][] = [];            // [sim minutes, depth ft]
  private logT = -1;
  private sampleDepth() {
    const s = this.sim.s, last = this.depthLog[this.depthLog.length - 1];
    if (!last || s.t - last[0] >= 20 || Math.abs(s.depth - last[1]) >= 25) this.depthLog.push([s.t, s.depth]);
    if (this.depthLog.length > 4000) this.depthLog.splice(1, 2);
  }
  private drawCurve() {
    const cv = $("curve") as HTMLCanvasElement, c = cv.getContext("2d")!, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 560, H = 250, L = 56, T = 30, Rr = 14, B = 14;
    cv.width = W * dpr; cv.height = H * dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = this.sim.s, pts = this.depthLog.length ? [...this.depthLog, [s.t, s.depth] as [number, number]] : [[0, s.depth] as [number, number]];
    const daysNow = s.t / 1440, maxDays = Math.max(3, Math.ceil(daysNow * 1.15 + 0.5));
    const d0 = WELL.startDepth, d1 = WELL.td + 300;
    const X = (days: number) => L + (days / maxDays) * (W - L - Rr), Y = (d: number) => T + ((d - 0) / d1) * (H - T - B);   // depth increases DOWN the page
    c.clearRect(0, 0, W, H); c.fillStyle = "rgba(255,255,255,0.03)"; c.fillRect(L, T, W - L - Rr, H - T - B);
    c.font = "9px 'Press Start 2P', monospace"; c.textBaseline = "middle";
    // depth grid every 2,000 ft, labels on the left
    c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = 1;
    for (let d = 0; d <= d1; d += 2000) { const y = Y(d); c.beginPath(); c.moveTo(L, y); c.lineTo(W - Rr, y); c.stroke(); c.fillStyle = "#93a4b5"; c.textAlign = "right"; c.fillText(d.toLocaleString("en-US"), L - 6, y); }
    // day grid, labels along the TOP (the way a drilling curve is drawn)
    const step = maxDays > 12 ? 2 : 1; c.textAlign = "center";
    for (let d = 0; d <= maxDays; d += step) { const x = X(d); c.strokeStyle = "rgba(255,255,255,0.1)"; c.beginPath(); c.moveTo(x, T); c.lineTo(x, H - B); c.stroke(); c.fillStyle = "#93a4b5"; c.fillText(String(d), x, T - 12); }
    c.fillStyle = "#ffd24a"; c.textAlign = "left"; c.fillText("DAYS", L, 8); c.save(); c.translate(10, H / 2); c.rotate(-Math.PI / 2); c.textAlign = "center"; c.fillText("DEPTH (FT)", 0, 0); c.restore();
    // planned curve (dashed): spud to TD in 4 days
    c.setLineDash([5, 4]); c.strokeStyle = "rgba(122,215,255,0.8)"; c.lineWidth = 1.6; c.beginPath(); c.moveTo(X(0), Y(d0)); c.lineTo(X(4), Y(WELL.td)); c.stroke(); c.setLineDash([]);
    c.fillStyle = "rgba(122,215,255,0.9)"; c.textAlign = "left"; c.fillText("PLAN", X(4) + 6 > W - 56 ? W - 56 : X(4) + 6, Y(WELL.td) - 8);
    // TD line
    c.strokeStyle = "rgba(229,72,59,0.7)"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(L, Y(WELL.td)); c.lineTo(W - Rr, Y(WELL.td)); c.stroke();
    c.fillStyle = "#e5483b"; c.textAlign = "right"; c.fillText("TD", W - Rr - 2, Y(WELL.td) + 9);
    // actual curve: flat stretches are connections, trips and well control
    c.strokeStyle = "#76ff03"; c.lineWidth = 2.6; c.lineJoin = "round"; c.beginPath();
    pts.forEach((p, i) => { const x = X(p[0] / 1440), y = Y(p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
    const last = pts[pts.length - 1], lx = X(last[0] / 1440), ly = Y(last[1]);
    c.fillStyle = "#fff"; c.beginPath(); c.arc(lx, ly, 4.5, 0, 6.3); c.fill(); c.strokeStyle = "#76ff03"; c.lineWidth = 2; c.stroke();
    c.fillStyle = "#76ff03"; c.textAlign = lx > W - 150 ? "right" : "left"; c.fillText(`${Math.round(last[1]).toLocaleString("en-US")} FT`, lx + (lx > W - 150 ? -9 : 9), ly - 11);
  }
  private refreshPause() {
    const s = this.sim.s, c = clockString(s.t);
    $("pstat").innerHTML = `DAY ${c.day} · ${c.hhmm}<br/>${fmt(s.depth)} FT · ${money(s.cost)} / ${money(WELL.afe)}`;
    const a = this.active, st = a ? a.m.steps[a.i] : null;
    $("pjob").innerHTML = a ? `${a.m.title.toUpperCase()}<br/>&gt; ${st?.text ?? ""}` : "NO ACTIVE JOB";
    $("pSound").textContent = this.sfx.muted ? "SOUND: OFF" : "SOUND: ON";
  }
  /** Pause / resume. Ignored while a panel is open unless forced (tab hidden). */
  togglePause(force?: boolean, opts: { allowPanel?: boolean } = {}) {
    if (!this.started) return;
    const want = force ?? !this.paused;
    if (want === this.paused) return;
    if (want && this.ui.panelOpen && !opts.allowPanel) return;
    this.paused = want;
    document.body.classList.toggle("paused", want);
    if (want) {
      this.refreshPause(); $("pctrlbox").style.display = "none"; $("pause").style.display = "grid"; this.drawCurve();
      this.player.enabled = false; this.player.unlock();
      try { this.sfx.ctx?.suspend(); } catch { /* ignore */ }
    } else {
      $("pause").style.display = "none";
      this.player.enabled = !this.ui.panelOpen; this.player.lock();
      try { this.sfx.ctx?.resume(); } catch { /* ignore */ }
    }
  }

  // ---------- helpers ----------
  inc(n = 1, why = "") { this.incidents += n; this.approval = clamp(this.approval - 0.3 * n, 0, 5); this.sfx.bad(); if (why) this.ui.toast("INCIDENT", why); }
  gain(a = 0, m = 0) { this.approval = clamp(this.approval + a, 0, 5); this.morale = clamp(this.morale + m, 0, 100); }
  say(who: Who, text: string, choices?: Choice[], eyebrow?: string) { this.player.enabled = false; this.player.unlock(); this.ui.say(who, text, choices, eyebrow); this.sfx.radio(); }
  radio(who: Who, text: string, ms?: number) { this.ui.radio(who, text, ms); this.sfx.radio(); }
  open(html: string, o: { wide?: boolean; live?: boolean; tick?: () => void } = {}) {
    this.player.enabled = false; this.player.unlock(); this.live = !!o.live;
    const p = this.ui.panel(html, { wide: o.wide, tick: o.tick });
    this.sfx.click();
    return p;
  }
  closeBtn(p: HTMLElement) { p.querySelector<HTMLButtonElement>("[data-close]")?.addEventListener("click", () => this.ui.closePanel()); }
  sinceDone() { return this.realT - this.lastDone; }
  fell(m: number) {
    this.sfx.thud();
    this.inc(1, "FALL FROM HEIGHT");
    this.radio("earl", `You fell ${Math.round(m * 3.28)} feet. That's a recordable. Do the paperwork, Company Man.`);
    this.standDown(`You fell ${Math.round(m * 3.28)} feet. Someone has to call it in, and that someone is a lot of people.`, 5000, 900, () => this.player.teleport(28, 0.5, 14, Math.PI / 2));
  }
  /** Vehicle hit something solid: a property damage incident, no stand-down. */
  propertyDamage(speed: number) {
    const cost = Math.round((2500 + speed * 900) / 100) * 100;
    this.sim.addCost(cost); this.sfx.thud();
    this.inc(1, "PROPERTY DAMAGE");
    this.radio("earl", `You hit something near the ${this.district().toLowerCase()}. That's $${cost.toLocaleString("en-US")} in damage. Fill out the form.`, 7000);
  }
  /** Vehicle hit a person: out of the vehicle, mandatory safety stand down, then reset at the trailers. */
  personStruck(name: string) {
    this.veh.eject();
    this.sfx.thud();
    this.inc(2, "STRUCK BY VEHICLE");
    this.standDown(`${name} was struck by your vehicle. They're okay, mostly. All work on location is stopped until everyone has talked about it.`, 25000, 1800, () => this.player.teleport(28, 0.5, 14, Math.PI / 2));
  }
  /** people a vehicle can run over */
  peopleAt(): { name: string; x: number; y: number; z: number }[] {
    const out: { name: string; x: number; y: number; z: number }[] = [];
    const names: Record<string, string> = { hand1: "A floorhand", hand2: "A floorhand", hand3: "Jimbo", derrickman: "The derrickman", mudeng: "Marcus", pusher: "Earl", guard: "Roy", vp: "The VP", driller: "Dale", dd1: "Tex" };
    for (const [k, h] of Object.entries(this.rig.humans)) if (h.root.isEnabled()) out.push({ name: names[k] ?? "Someone", x: h.root.position.x, y: h.root.position.y, z: h.root.position.z });
    for (const h of this.interns) out.push({ name: "The intern", x: h.root.position.x, y: h.root.position.y, z: h.root.position.z });
    return out;
  }
  /** Mandatory pause. The panel can't be dismissed until the clock runs out; then `reset` puts you back. */
  standDown(why: string, cost: number, lostSec: number, reset: () => void) {
    this.sim.addCost(cost); this.sim.s.t += lostSec;
    let left = 8;
    const p = this.openMini(`<div class="eyebrow" style="color:#e5483b">Mandatory</div><h2>SAFETY STAND DOWN</h2>
      <p>${why}</p>
      <p>Work is stopped on location. Everyone gathers at the muster point to talk it through. Cost so far: <b>$${cost.toLocaleString("en-US")}</b> and about ${Math.round(lostSec / 60)} minutes of rig time.</p>
      <div class="btns"><button class="b" id="sdGo" disabled>STANDING DOWN… ${left}</button></div>`);
    const btn = p.querySelector<HTMLButtonElement>("#sdGo")!;
    const t = window.setInterval(() => {
      left--;
      if (left > 0) { btn.textContent = `STANDING DOWN… ${left}`; return; }
      window.clearInterval(t); btn.disabled = false; btn.textContent = "RETURN TO WORK";
    }, 1000);
    btn.onclick = () => { if (btn.disabled) return; window.clearInterval(t); this.closeMini(); reset(); this.radio("earl", "Alright. Everybody back to work. Be careful out there, Company Man.", 6000); };
  }

  /** derrick hand on the monkey board: latch each stand as it swings into the fingers */
  workBoard() {
    if (this.realT - ((this.flags.boardT as number | undefined) ?? -999) < 20) { this.radio("earl", "Board's full for now. Take a breath up there.", 5000); return; }
    this.flags.boardT = this.realT;
    this.mini.reaction({ eyebrow: "Monkey Board", title: "Rack the Stand", intro: "You're the derrick hand now, ninety feet up. A 93-foot stand swings in from the elevators. Hit LATCH the instant it reaches the finger.", rounds: 5, goText: "LATCH" }, (r) => {
      if (r.skipped) { this.shortcutToast("You waved at the stand."); this.radio("earl", "That stand is still swinging. Get off my board.", 6000); return; }
      if (r.score >= 0.7) { this.gain(0.15, 4); this.sfx.good(); this.radio("earl", "Clean racking. You'd make a decent derrick hand. Don't tell the derrickman.", 7000); }
      else if (r.score >= 0.4) { this.gain(0.03, 1); this.radio("earl", "It's racked. It's crooked. It's racked.", 6000); }
      else { this.inc(1, "DROPPED OBJECT"); this.sim.addCost(18000); this.radio("earl", "DROPPED OBJECT! Everybody clear the floor! …Who was on the board?", 8000); }
    });
  }

  // ---------- ambient interactables ----------
  buildAmbient() {
    const S = this.rig.spots, H = this.rig.humans;
    this.veh = new Vehicles(this.scene, this.rig.colliders, this.player, this);
    for (const it of this.veh.interacts()) this.interacts.push(it);
    const add = (pos: () => Vector3, label: string | (() => string), r: number, act: () => void, ok?: () => boolean) =>
      this.interacts.push({ pos, label: typeof label === "string" ? () => label : label, r, act, ok });
    add(() => S.board, "Work the board — rack a stand", 3.2, () => this.workBoard(), () => this.player.pos.y > 20);
    add(() => S.cabin, "Driller's console", 3.2, () => this.openCabin());
    add(() => S.hopper, "Mud hopper", 3.4, () => this.openHopper());
    add(() => S.desk, "Computer — AFE & orders", 2.8, () => this.openDesk());
    add(() => S.phone, "Phone", 2.6, () => this.openPhone());
    add(() => S.bunk, "Rack out", 2.8, () => this.openBunk());
    add(() => S.choke, "Choke panel", 3.2, () => this.openChoke());
    add(() => S.accumulator, "BOP accumulator", 3.2, () => this.openAccum());
    add(() => S.shakers, "Shale shakers", 3.4, () => this.openShakers());
    add(() => S.pits, "Pit levels", 3.2, () => this.openPits());
    add(() => S.pumps, "Mud pumps", 3.4, () => this.openPumps());
    add(() => S.gens, "Generators", 3.4, () => this.openGens());
    add(() => S.fuel, "Diesel tank", 3.4, () => this.openFuel());
    add(() => S.mudlog, "Mud logging unit", 2.8, () => this.openMudlog());
    add(() => S.bop, "BOP stack", 3.6, () => this.openBop());
    add(() => S.coffee, "Coffee", 2.2, () => { if (this.flags.coffeeEmpty) this.radio("earl", "Pot's empty. Somebody's going to have to make coffee."); else { this.gain(0, 3); this.ui.toast("+3 MORALE", "Tastes like diesel."); } });
    const talk = (key: "driller" | "pusher" | "mudeng" | "hand3" | "dd1", who: Who, lines: string[]) => {
      let i = 0;
      add(() => H[key].root.position.add(v3(0, 1.1, 0)), "Talk", 2.4, () => { this.radio(who, lines[i++ % lines.length], 6500); }, () => H[key].root.isEnabled());
    };
    talk("driller", "dale", ["Everything's green, boss. I'm just watching the numbers.", "You want more weight? Say it in the console, I can't read minds.", "I've drilled wells since before you had a hard hat. Just so you know."]);
    talk("pusher", "earl", ["If it's not on the JSA, we don't do it.", "Your trailer's got the good chair. Don't tell the others.", "Walk the location. Then walk it again."]);
    talk("mudeng", "marcus", ["Mud's looking good. The mud is always looking good until it isn't.", "Delaware's coming up. You'll want ten-nine in the pits before six thousand.", "That's not 'sticky.' That's 'rheology.'"]);
    talk("dd1", "tex", ["We're sliding, boss. Build rate's fine. Don't touch my toolface.", "Inclination is 2 degrees. That is, in this business, a vertical well.", "I steer a drill bit a mile down with a joystick. And you want me to fill out a JSA about the coffee."]);
    talk("hand3", "jimbo", ["Pipe's pipe, boss.", "I do not get paid enough for the forklift.", "Is it break time? It feels like break time."]);
  }

  openBunk() {
    const p = this.open(`<div class="eyebrow">Company Man Trailer</div><h2>Rack Out</h2><p>Sleep until something goes wrong. It will.</p>
      <div class="btns"><button class="b" data-s="1">Sleep (up to 6 hr)</button><button class="b alt" data-close>Not now</button></div>`);
    this.closeBtn(p);
    p.querySelector<HTMLButtonElement>("[data-s]")!.onclick = () => {
      this.ui.closePanel(); this.sleeping = true; this.sleepUntil = this.sim.s.t + 360;
      $("fade").style.opacity = "0.85"; this.player.enabled = false; this.player.unlock(); this.ui.toast("ZZZ…");
    };
  }
  wake(why: string) {
    if (!this.sleeping) return;
    this.sleeping = false; $("fade").style.opacity = "0"; this.player.enabled = true; this.ui.toast("WOKE UP", why);
  }

  // ---------- panels ----------
  statRow(k: string, v: string, cls = "") { return `<div class="row"><span>${k}</span><b class="${cls}">${v}</b></div>`; }

  openCabin() {
    const s = this.sim.s;
    const render = () => {
      const k = s.kick, a = s.auto, opt = this.flags.drillOffWopt as number | undefined;
      const busy = s.mode === "tripping" || s.mode === "casing";
      return `<div class="eyebrow">Driller's Cabin</div><h2>Driller's Console</h2>
        <div class="grid2">
          <div>
            <div class="row"><span>Depth</span><b id="c_depth"></b></div><div class="row"><span>Formation</span><b id="c_form"></b></div>
            <div class="row"><span>ROP</span><b id="c_rop"></b></div><div class="row"><span>Diff pressure</span><b id="c_dp"></b></div>
            <div class="row"><span>Bit health</span><b id="c_bit"></b></div><div class="row"><span>Standpipe pressure</span><b id="c_spp"></b></div>
            <div class="row"><span>Mud weight</span><b id="c_mw"></b></div><div class="row"><span>Pit volume</span><b id="c_pit"></b></div>
            <div class="row"><span>Mode</span><b id="c_mode"></b></div>
          </div>
          <div>
            <div class="autobox">
              <div class="row"><span>AUTODRILLER</span><b id="a_state" class="warn">${a.on ? "ON" : "OFF"}</b></div>
              <div class="hint">WOB set point: <b id="aw">${a.wob}</b> klbs${opt ? ` · drill-off knee ≈ ${opt}` : ""}</div>
              <input type="range" id="a_wob" min="5" max="60" step="1" value="${a.wob}" />
              <div class="hint">ROP limit: <b id="ar">${a.rop}</b> ft/hr</div>
              <input type="range" id="a_rop" min="40" max="380" step="10" value="${a.rop}" />
              <div class="hint">Differential pressure limit: <b id="ad">${a.dp}</b> psi <span style="color:var(--red)">(motor stalls above 1,650)</span></div>
              <input type="range" id="a_dp" min="300" max="2400" step="50" value="${a.dp}" />
              <div class="hint" id="a_lim" style="min-height:18px"></div>
              <div class="btns"><button class="b ${a.on ? "red" : "green"}" id="a_toggle">${a.on ? "Disengage" : "Engage autodriller"}</button><button class="b alt" id="a_test" ${busy ? "disabled" : ""}>Drill-off test</button></div>
            </div>
            <div class="hint" style="margin-top:8px">Manual WOB: <b id="wv">${s.wobTarget}</b> klbs ${a.on ? "(autodriller in control)" : ""}</div>
            <input type="range" id="wob" min="0" max="60" step="1" value="${s.wobTarget}" ${busy || a.on ? "disabled" : ""}/>
            <div class="hint" style="margin-top:6px">Pump rate: <b id="fv">${s.flowTarget}</b> gpm</div>
            <input type="range" id="flow" min="400" max="1000" step="50" value="${s.flowTarget}"/>
          </div>
        </div>
        <div class="btns" id="cbtn"></div>`;
    };
    const p = this.open(render(), { wide: true, live: true });
    const bind = () => {
      const q = <T extends HTMLElement>(id: string) => p.querySelector<T>("#" + id)!;
      const sl = (id: string, out: string, apply: (v: number) => void) => { const el = q<HTMLInputElement>(id); el.oninput = () => { apply(Number(el.value)); q(out).textContent = el.value; }; };
      sl("wob", "wv", (v) => { s.wobTarget = v; });
      sl("flow", "fv", (v) => { s.flowTarget = v; });
      sl("a_wob", "aw", (v) => { s.auto.wob = v; });
      sl("a_rop", "ar", (v) => { s.auto.rop = v; });
      sl("a_dp", "ad", (v) => { s.auto.dp = v; });
      q<HTMLInputElement>("wob").onchange = () => { if (s.wobTarget > 40) this.radio("dale", "Forty-plus by hand? Your funeral, boss. Bit's gonna scream.", 6000); };
      q("a_toggle").onclick = () => {
        const a = s.auto;
        if (a.on) { a.on = false; this.sfx.click(); this.radio("dale", "Autodriller off. I've got the brake.", 4000); this.rerenderCabin(p, render, bind); return; }
        const opt = this.flags.drillOffWopt as number | undefined, notes: string[] = [];
        if (a.dp > 1650) notes.push("A diff limit over 1,650 won't stop a motor stall. That's not a limit, that's a suggestion.");
        if (a.rop < 100) notes.push("That ROP limit is going to strangle us. We'll crawl.");
        if (opt && a.wob > opt + 6) notes.push(`Weight over the knee (≈${opt}) just wears the bit and buys nothing.`);
        if (opt && a.wob < opt - 8) notes.push(`We're leaving ROP on the table below ≈${opt} klbs.`);
        if (!opt) notes.push("No drill-off, so those weights are a guess. Hope you're feeling lucky.");
        a.on = true; this.sfx.good();
        this.radio("dale", notes.length ? notes[0] : "Autodriller's in. Set points look sane — nice.", 8000);
        if (!notes.length || notes.length === 1 && !!opt) this.gain(0.15, 0);
        this.rerenderCabin(p, render, bind);
      };
      q("a_test").onclick = () => this.mini.drillOff((r) => {
        if (r.skipped) { this.shortcutToast("Skipped the test."); this.radio("dale", "Guessing it is."); }
        else { this.gain(r.score > 0.7 ? 0.15 : 0, 0); this.radio("dale", r.score > 0.7 ? `Knee's around ${Math.round(r.value ?? 28)}. That tracks.` : `You're calling it ${Math.round(r.value ?? 28)}. Okay.`, 6000); }
        this.openCabin();
      });
      const btns: string[] = [];
      if (s.kick.active && !s.kick.shut) btns.push(`<button class="b red" data-a="shut">SHUT IN THE WELL</button>`);
      if (s.kill.stage === "flowcheck") btns.push(`<button class="b green" data-a="open">Flow check OK — open BOP & resume</button>`);
      if ((s.mode === "drilling" || s.mode === "connection") && !s.kick.active) btns.push(`<button class="b alt" data-a="trip">Trip for a new bit</button>`);
      if (s.depth >= WELL.td - 0.5 && s.mode === "idle") btns.push(`<button class="b green" data-a="casing">Run 9⅝″ casing & cement</button>`);
      btns.push(`<button class="b alt" data-close>Close</button>`);
      const box = q("cbtn"); box.innerHTML = btns.join("");
      this.closeBtn(p);
      box.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => b.onclick = () => this.cabinAction(b.dataset.a!));
    };
    bind();
    let sig0 = "";
    (this.ui as any).panelTick = () => {
      const sig = s.mode + s.kick.active + s.kick.shut + s.kill.stage + (s.depth >= WELL.td) + s.auto.on;
      if (sig !== sig0) { sig0 = sig; this.rerenderCabin(p, render, bind); }
      const set = (id: string, v: string, cls = "") => { const e = p.querySelector<HTMLElement>("#" + id); if (e) { e.textContent = v; if (cls !== undefined) e.className = cls; } };
      set("c_depth", fmt(s.depth) + " ft"); set("c_form", formationAt(s.depth).name); set("c_rop", fmt(s.rop) + " ft/hr");
      set("c_dp", fmt(s.dp) + " psi" + (s.stallT > 0 ? " · STALLED" : ""), s.dp > STALL_DP * 0.9 || s.stallT > 0 ? "bad" : "");
      set("c_bit", Math.round(s.bit) + "%", s.bit < 25 ? "bad" : ""); set("c_spp", fmt(s.spp) + " psi"); set("c_mw", s.mw.toFixed(2) + " ppg");
      set("c_pit", fmt(s.pit) + " bbl", s.kick.active ? "bad" : ""); set("c_mode", s.mode.toUpperCase());
      const lim = p.querySelector<HTMLElement>("#a_lim");
      if (lim) lim.innerHTML = s.auto.on ? `Holding <b>${s.wobTarget.toFixed(1)}</b> klbs — limited by <b class="${s.auto.limit === "WOB" ? "ok" : "warn"}">${s.auto.limit === "WOB" ? "your WOB set point" : s.auto.limit === "ROP" ? "the ROP limit" : "the diff-pressure limit"}</b>` : "";
    };
  }
  private rerenderCabin(p: HTMLElement, render: () => string, bind: () => void) {
    const ky = p.scrollTop; p.innerHTML = render(); bind(); p.scrollTop = ky;
  }
  cabinAction(a: string) {
    const s = this.sim.s;
    if (a === "shut") {
      if (!this.sim.shutIn(false)) {
        this.sfx.bad(); this.ui.closePanel();
        this.radio("dale", "BOP WON'T CLOSE — accumulator pressure is low! Somebody get to the accumulator!", 9000);
        this.flags.accumFailSeen = true;
        return;
      }
      this.ui.closePanel(); this.sfx.horn();
      this.radio("dale", "Well's shut in. Annular's closed. Now go read the pressures at the choke panel.", 8000);
    } else if (a === "open") {
      this.sim.openBopResume(); this.ui.closePanel(); this.gain(0.4, 8); this.radio("dale", "Flow check's dead. Back on bottom, boss. Nice work on the kill.");
      setTimeout(() => this.radio("marcus", "That gas pocket was only about 60 feet thick. Once we drill through it, dilute the mud back toward 11 ppg at the hopper — at this weight we're over frac and we'll lose returns.", 14000), 4000);
    } else if (a === "trip") {
      this.ui.closePanel(); this.sim.startTrip(); this.radio("dale", "Tripping out. See you in about nine hours of staring at pipe.");
    } else if (a === "casing") {
      this.ui.closePanel(); this.sim.startCasing(); this.flags.casingStarted = true;
    }
  }

  /** how many ppg the current situation demands (kill weight / Delaware), so the hopper can offer a matching dose */
  hopperNeed(): number {
    const s = this.sim.s;
    if (s.kill.stage === "weightup" && s.kill.kmw > 0) return Math.max(0, s.kill.kmw - s.mwTarget + 0.05);
    if (s.depth >= 4500 && s.depth < 6200) return Math.max(0, 10.9 - s.mwTarget + 0.05);
    return 0;
  }
  openHopper() {
    const s = this.sim.s;
    const render = () => {
      const need = this.hopperNeed(), last = this.flags.lastDose as string | undefined;
      return `<div class="eyebrow">Mud System</div><h2>Mud Hopper</h2>
      <div class="grid2"><div>
        <div class="row"><span>Mud weight (active)</span><b id="h_mw"></b></div>
        <div class="row"><span>Effective (w/ ECD)</span><b id="h_eff"></b></div>
        <div class="row"><span>LCM in system</span><b id="h_lcm"></b></div>
        ${last ? `<div class="row"><span>Last batch</span><b>${last}</b></div>` : ""}
      </div><div>
        <div class="row"><span>Pore pressure here</span><b>${poreAt(s.depth).toFixed(1)} ppg</b></div>
        <div class="row"><span>Fracture limit</span><b>${fracAt(s.depth).toFixed(1)} ppg</b></div>
        ${need > 0.05 ? `<div class="note">The job needs about <b>+${need.toFixed(2)} ppg</b> more.</div>` : ""}
        <p class="hint">Stay between the two. Under pore = kick. Over frac = losses. Weight-up isn't instant — it circulates in.</p>
      </div></div>
      <div class="hint" style="margin-top:8px">Feed barite — pick a dose, then hold the button and release on the mark:</div>
      <div class="btns">${[0.2, 0.5, 1.0, 1.5].map((d) => `<button class="b" data-dose="${d}">+${d} ppg</button>`).join("")}${need > 0.05 ? `<button class="b green" data-dose="${need.toFixed(2)}">Match the job (+${need.toFixed(2)})</button>` : ""}</div>
      <div class="btns"><button class="b alt" data-a="dn">−0.2 ppg dilute ($1k)</button><button class="b" data-a="lcm">LCM pill (+15 ppb, $20k)</button><button class="b alt" data-close>Close</button></div>`;
    };
    const p = this.open(render(), { live: true, wide: true });
    const wire = () => {
      this.closeBtn(p);
      p.querySelectorAll<HTMLButtonElement>("[data-dose]").forEach((b) => b.onclick = () => { this.sfx.click(); this.dose(Number(b.dataset.dose)); });
      p.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => b.onclick = () => {
        const a = b.dataset.a;
        if (a === "dn" && s.mwTarget > 8.4) { s.mwTarget = Math.round((s.mwTarget - 0.2) * 100) / 100; this.sim.addCost(1000); this.sfx.click(); }
        if (a === "lcm") { s.lcmTarget = Math.min(80, s.lcmTarget + 15); s.lcm = Math.min(80, s.lcm + 15); this.sim.addCost(20000); this.sfx.click(); setTimeout(() => (s.lcmTarget = Math.max(0, s.lcmTarget - 15)), 90000); }
      });
    };
    wire();
    (this.ui as any).panelTick = () => {
      const set = (id: string, v: string) => { const e = p.querySelector<HTMLElement>("#" + id); if (e) e.textContent = v; };
      set("h_mw", s.mw.toFixed(2) + " ppg"); set("h_eff", this.sim.mwEff.toFixed(2) + " ppg"); set("h_lcm", s.lcm.toFixed(0) + " ppb");
    };
  }
  /** feed barite: a hold-to-fill minigame; the "wing it" guess is off by a hidden amount that only shows up as the mud circulates */
  dose(d: number) {
    const s = this.sim.s;
    this.mini.holdFill({ eyebrow: "Mud Hopper", title: "Barite Feed", intro: `Raise the system by +${d.toFixed(2)} ppg. Hold the feed, release on the mark.`, unit: "ppg", max: d * 2.2, target: d, band: Math.max(0.05, d * 0.12), rate: 0.26, hold: "HOLD TO FEED" }, (r) => {
      let actual: number;
      if (r.skipped) {
        actual = d * (0.62 + Math.random() * 0.85);
        this.shortcutToast("You eyeballed the barite and dumped sacks.");
        this.radio("marcus", "Eyeballing it? Okay… we'll see what the mud says in a bit.", 7000);
        this.flags.lastDose = "~" + d.toFixed(2) + " ppg (guessed)";
      } else {
        actual = r.value ?? d;
        this.flags.lastDose = "+" + actual.toFixed(2) + " ppg";
        this.radio("marcus", r.score > 0.8 ? "Right on the number." : actual < d ? "A little light." : "A little heavy.", 5000);
      }
      s.mwTarget = Math.min(17, Math.round((s.mwTarget + actual) * 100) / 100);
      this.sim.addCost(30000 * actual);
      this.openHopper();
    });
  }

  openDesk() {
    const s = this.sim.s;
    const p = this.open(`<div class="eyebrow">Company Man Trailer</div><h2>Computer</h2>
      ${this.statRow("Cost to date", money(s.cost), s.cost > WELL.afe ? "bad" : "")}${this.statRow("AFE", money(WELL.afe))}
      ${this.statRow("Remaining depth", fmt(WELL.td - s.depth) + " ft")}${this.statRow("Casing ordered", this.casingOrder ? this.casingOrder + " joints" : "No", this.casingOrder ? "ok" : "warn")}
      <div class="btns">
        <button class="b" data-a="casing" ${this.casingOrder ? "disabled" : ""}>Order 9⅝″ casing</button>
        <button class="b alt" data-a="report">Submit daily report</button>
        <button class="b alt" data-close>Close</button></div>`);
    this.closeBtn(p);
    p.querySelector<HTMLButtonElement>("[data-a=report]")!.onclick = () => {
      this.ui.closePanel();
      const day = clockString(s.t).day;
      if (this.flags.lastReportDay === day) { this.radio("brent", "You already sent today's report. Please stop adding emoji."); return; }
      this.flags.lastReportDay = day; this.gain(0.25, 0); this.ui.toast("REPORT SUBMITTED", "Brent has opened it and not read it.");
    };
    p.querySelector<HTMLButtonElement>("[data-a=casing]")!.onclick = () => this.orderCasing();
  }
  orderCasing() {
    this.say("brent", "You need 9⅝″ casing on location before TD. Hole's 8,500 ft, joints are about 40 ft each, and you want a little spare. How many joints do you order?", [
      { label: "180 joints", cls: "alt", run: () => this.casingPicked(180) },
      { label: "225 joints", run: () => this.casingPicked(225) },
      { label: "400 joints (just in case)", cls: "alt", run: () => this.casingPicked(400) },
    ], "Order casing");
  }
  casingPicked(n: number) {
    this.casingOrder = n; this.orderT = this.sim.s.t;
    if (n === 225) { this.gain(0.25); this.radio("brent", "225 joints. Shockingly reasonable. Truck's about 25 minutes out."); }
    else if (n < 212) { this.flags.shortCasing = true; this.radio("brent", "180 joints? That's 7,200 feet. I'm not going to say anything. Truck's coming."); }
    else { this.sim.addCost(180000); this.radio("brent", "400 joints. You've ordered casing for a second well. Billing you for it. Truck's coming."); }
    this.sim.addCost(n * 20);
  }

  openPhone() {
    const m = this.flags.houstonPending;
    if (m) { this.flags.houstonPhone = true; return; }
    this.say("brent", "Hey. Just checking in. No reason. Okay, a little reason: what's the hole look like?", [
      { label: "Fine.", run: () => this.radio("brent", "Great. 'Fine' goes in the slide deck.") },
      { label: `${fmt(this.sim.s.depth)} ft, ${money(this.sim.s.cost)} spent`, run: () => this.radio("brent", "Wonderful. I'll forward that to someone who will ask you the same question.") },
    ], "Phone");
  }

  inspect(title: string, rows: [string, string, string?][], extra = "", btns: { label: string; run: () => void; cls?: string }[] = []) {
    const p = this.open(`<div class="eyebrow">Walk the Location</div><h2>${title}</h2>${rows.map((r) => this.statRow(r[0], r[1], r[2] ?? "")).join("")}${extra}
      <div class="btns">${btns.map((b, i) => `<button class="b ${b.cls ?? ""}" data-x="${i}">${b.label}</button>`).join("")}<button class="b alt" data-close>Close</button></div>`);
    this.closeBtn(p);
    p.querySelectorAll<HTMLButtonElement>("[data-x]").forEach((b) => b.onclick = () => { this.ui.closePanel(); btns[Number(b.dataset.x)].run(); });
  }
  openShakers() {
    const s = this.sim.s, f = formationAt(s.depth);
    const torn = this.flags.screenTorn !== false;
    this.flags.shakersLooked = true;
    this.inspect("Shale Shakers", [
      ["Cuttings", `<span style="color:${f.color}">■</span> ${f.name}`], ["Screen condition", torn ? "TORN — solids bypassing" : "Good", torn ? "bad" : "ok"],
      ["Gas units", s.kick.active ? "ELEVATED" : "Background", s.kick.active ? "bad" : ""],
    ], `<p class="hint">Cuttings tell you what the bit is eating. Torn screens tell you someone skipped rounds.</p>`,
      torn ? [{ label: "Replace screens ($1,200)", run: () => { this.flags.screenTorn = false; this.sim.addCost(1200); this.radio("marcus", "New screens in. Mud's cleaner. You're basically a mud engineer now."); this.flags.screensFixed = true; } }] : []);
  }
  openPits() { const s = this.sim.s; this.inspect("Active Pits", [["Volume", fmt(s.pit) + " bbl"], ["Gain / loss", (s.pit - s.pitBase >= 0 ? "+" : "") + fmt(s.pit - s.pitBase) + " bbl", Math.abs(s.pit - s.pitBase) > 8 ? "bad" : "ok"], ["Losses to date", fmt(s.loss.total) + " bbl"]], `<p class="hint">Pit gain is the first sign of a kick. Pit loss means you're over fracture pressure.</p>`); }
  openPumps() { const s = this.sim.s; this.inspect("Mud Pumps (3× triplex)", [["Standpipe pressure", fmt(s.spp) + " psi"], ["Pump rate", fmt(s.flow) + " gpm"], ["Liners", "OK", "ok"], ["Pulsation dampener", "Charged", "ok"]]); }
  openGens() { const s = this.sim.s; this.inspect("Generators (4× engine/gen)", [["Load", s.mode === "idle" ? "Low" : "Normal"], ["Coolant temp", "190 °F", "ok"], ["Fuel", fmt(s.fuel) + " gal", s.fuel < 1200 ? "bad" : "ok"]]); }
  openFuel() {
    const s = this.sim.s;
    this.inspect("Diesel Tank", [["Level", fmt(s.fuel) + " gal", s.fuel < 1200 ? "bad" : "ok"], ["Burn rate", "~160 gal/hr"]], "", [{ label: "Order 4,000 gal ($14k)", run: () => { s.fuel += 4000; this.sim.addCost(14000); this.radio("earl", "Fuel truck's here already. Don't ask how."); } }]);
  }
  openMudlog() { const s = this.sim.s; this.inspect("Mud Logging Unit", [["Formation", formationAt(s.depth).name], ["Pore pressure (est.)", poreAt(s.depth).toFixed(1) + " ppg"], ["Gas", s.kick.active ? "SPIKING" : "Background", s.kick.active ? "bad" : ""]], `<p class="hint">Dr. Pruitt: "Watch past 7,000 ft. I've seen gassy stringers in this part of the Delaware."</p>`); }
  openBop() { const s = this.sim.s; this.inspect("BOP Stack", [["Annular", s.kick.shut ? "CLOSED" : "Open", s.kick.shut ? "warn" : "ok"], ["Rams", "Open · tested", "ok"], ["Closing unit", fmt(s.accum) + " psi", s.accum < 1200 ? "bad" : "ok"]]); }
  openAccum() {
    const s = this.sim.s;
    this.inspect("BOP Accumulator (closing unit)", [["System pressure", fmt(s.accum) + " psi", s.accum < 1200 ? "bad" : "ok"], ["Precharge pump", this.sim.accumDead ? "TRIPPED" : "Ready", this.sim.accumDead ? "bad" : "ok"], ["Minimum to close BOP", "1,200 psi"]],
      `<p class="hint">If this is low when the well kicks, the BOP will not close.</p>`,
      this.sim.accumDead || s.accum < 2800 ? [{ label: "Reset breaker & recharge", cls: "green", run: () => { this.sim.accumDead = false; s.accum = 3000; this.flags.accumFixed = true; this.sfx.good(); this.radio("dale", "Accumulator's at three thousand. Thank you, boss."); } }] : []);
  }

  // ---------- CHOKE PANEL (kill the well) ----------
  openChoke() {
    const s = this.sim.s, k = s.kill;
    if (s.kick.shut && k.stage === "none") { k.stage = "readings"; if (!s.kick.shutT || s.kick.shutT > s.t) s.kick.shutT = s.t - 6; }   // shut in but the kill sheet was never opened (e.g. after a reload)
    if (s.kick.active && !s.kick.shut && k.stage === "none") {
      this.inspect("Remote Choke Panel", [["Well status", "FLOWING: not shut in", "bad"], ["Pit gain", fmt(s.kick.gain) + " bbl", "bad"]],
        `<p class="hint">Shut the well in first: Driller's console → <b>SHUT IN THE WELL</b>. Then come back here to record SIDPP and SICP.</p>`);
      return;
    }
    if (!s.kick.shut && k.stage === "none") {
      this.inspect("Remote Choke Panel", [["Well status", "Open · flowing normally", "ok"], ["Casing pressure", "0 psi"], ["Drill pipe pressure", fmt(s.spp) + " psi"]],
        `<p class="hint">Keep your hands off the choke unless the well is shut in. The choke panel is for well control only.</p>`);
      return;
    }
    const render = () => {
      let body = "";
      const stable = this.sim.s.t - s.kick.shutT >= 6;
      const ramp = clamp((this.sim.s.t - s.kick.shutT) / 5, 0, 1);
      const sidpp = Math.round(s.kick.sidpp * (k.stage === "readings" ? ramp : 1)), sicp = Math.round(s.kick.sicp * (k.stage === "readings" ? ramp : 1));
      if (k.stage === "readings") {
        body = `<p>Well is shut in. Let the pressures stabilize, then record <b>SIDPP</b> (drill pipe) and <b>SICP</b> (casing).</p>
        <div class="grid2"><div class="gauge"><div class="g-l">SIDPP</div><div class="g-v" id="g1">${sidpp}</div><div class="g-s">psi · drill pipe</div></div>
        <div class="gauge"><div class="g-l">SICP</div><div class="g-v" id="g2">${sicp}</div><div class="g-s">psi · casing</div></div></div>
        <div class="btns"><button class="b" id="rec" ${stable ? "" : "disabled"}>${stable ? "Record pressures" : "Stabilizing…"}</button></div>`;
      } else if (k.stage === "calc") {
        body = `<div class="grid2"><div class="gauge"><div class="g-l">SIDPP</div><div class="g-v">${Math.round(s.kick.sidpp)}</div></div><div class="gauge"><div class="g-l">Pit gain</div><div class="g-v">${s.kick.gain.toFixed(0)}</div><div class="g-s">bbl</div></div></div>
        <div class="note"><b>Kill mud weight</b> = current MW + SIDPP ÷ (0.052 × TVD)<br/>MW = <b>${s.mw.toFixed(2)}</b> ppg · SIDPP = <b>${Math.round(s.kick.sidpp)}</b> psi · TVD = <b>${fmt(s.depth)}</b> ft</div>
        <p>Enter the kill mud weight (ppg):</p><input type="number" step="0.1" id="kmw" value="${this.kmwInput ? this.kmwInput : ""}"/>
        <div class="btns"><button class="b" id="calc">Submit kill sheet</button></div><p class="hint" id="calcmsg"></p>`;
      } else if (k.stage === "weightup") {
        body = `<p>Kill sheet signed. Weight up the active system to <b>${k.kmw.toFixed(1)} ppg</b> at the mud hopper, then come back and start the circulation.</p>
        ${this.statRow("Current MW", s.mw.toFixed(2) + " ppg")}${this.statRow("Kill MW", k.kmw.toFixed(1) + " ppg")}
        <div class="btns"><button class="b" id="circ" ${s.mw >= k.kmw - 0.1 ? "" : "disabled"}>${s.mw >= k.kmw - 0.1 ? "Begin circulating the kick out" : "Waiting on mud weight…"}</button></div>`;
      } else if (k.stage === "circ") {
        const pct = Math.round((k.inBand / Math.max(1, k.total)) * 100);
        body = `<p>Circulate with the <b>Driller's Method</b>. Hold <b>drill pipe pressure</b> on the gold target line by working the choke — <b>close</b> it to raise pressure, <b>open</b> it to lower it. Keep casing pressure under <b>${k.maasp} psi</b> or you'll break down the shoe.</p>
        <div class="grid2"><div class="gauge"><div class="g-l">Drill pipe pressure</div><div class="g-v" id="gd">${Math.round(k.dpp)}</div><div class="g-s" id="gdt">target ${Math.round(k.dppTarget)}</div>
          <div class="chokebar"><div class="band" id="gband"></div><div class="tgt" id="gtgt"></div><div class="needle" id="gneedle"></div></div></div>
        <div class="gauge"><div class="g-l">Casing pressure</div><div class="g-v" id="gc">${Math.round(k.cp)}</div><div class="g-s" id="gct">MAASP ${k.maasp}</div></div></div>
        <div class="grid2" style="margin-top:12px"><div><div class="hint">Choke position: <b id="chv">${Math.round(k.choke * 100)}</b>% closed</div><input type="range" id="chk" min="0" max="100" value="${Math.round(k.choke * 100)}"/>
          <div class="btns"><button class="b alt" id="co">◀ Open (A)</button><button class="b alt" id="cc">Close (D) ▶</button></div></div>
        <div>${this.statRow("Circulation", Math.round(k.progress * 100) + "%")}${this.statRow("In band", pct + "%", pct > 70 ? "ok" : "bad")}${this.statRow("Mud weight", s.mw.toFixed(2) + " ppg")}</div></div>`;
      } else {
        body = `<div class="note" style="border-color:var(--green)"><b>Circulation complete.</b> Pressures bled to zero. Go to the Driller's console, flow-check the well and open the BOP.</div>`;
      }
      return `<div class="eyebrow">Well Control</div><h2>Remote Choke Panel</h2>${body}<div class="btns"><button class="b alt" data-close>Close</button></div>`;
    };
    const p = this.open(render(), { wide: true, live: true });
    const wire = () => {
      this.closeBtn(p);
      p.querySelector<HTMLButtonElement>("#rec")?.addEventListener("click", () => { k.stage = "calc"; this.sfx.click(); p.innerHTML = render(); wire(); });
      p.querySelector<HTMLButtonElement>("#calc")?.addEventListener("click", () => {
        const val = Number((p.querySelector("#kmw") as HTMLInputElement).value); this.kmwInput = val;
        const right = this.sim.killMudWeight();
        if (Math.abs(val - right) <= 0.15) { k.kmw = Math.ceil(right * 10) / 10 + 0.1; k.stage = "weightup"; this.sfx.good(); this.radio("marcus", `Kill weight ${k.kmw.toFixed(1)}. Bring me to the hopper — let's weight it up.`); p.innerHTML = render(); wire(); }
        else { this.sfx.bad(); p.querySelector("#calcmsg")!.innerHTML = `Not quite. Try again: ${s.mw.toFixed(2)} + ${Math.round(s.kick.sidpp)} ÷ (0.052 × ${fmt(s.depth)}).`; }
      });
      p.querySelector<HTMLButtonElement>("#circ")?.addEventListener("click", () => { this.sim.beginCirculation(); this.sfx.good(); p.innerHTML = render(); wire(); });
      const adj = (d: number) => { k.choke = clamp(k.choke + d, 0, 1); const r = p.querySelector<HTMLInputElement>("#chk"); if (r) r.value = String(Math.round(k.choke * 100)); };
      p.querySelector("#co")?.addEventListener("click", () => adj(-0.03));
      p.querySelector("#cc")?.addEventListener("click", () => adj(0.03));
      const slider = p.querySelector<HTMLInputElement>("#chk");
      if (slider) slider.oninput = () => { k.choke = Number(slider.value) / 100; };
    };
    wire();
    if (this.chokeKeyHandler) window.removeEventListener("keydown", this.chokeKeyHandler);
    this.chokeKeyHandler = (e) => { if (k.stage === "circ") { if (e.code === "KeyA" || e.code === "ArrowLeft") { k.choke = clamp(k.choke - 0.025, 0, 1); } if (e.code === "KeyD" || e.code === "ArrowRight") { k.choke = clamp(k.choke + 0.025, 0, 1); } } };
    window.addEventListener("keydown", this.chokeKeyHandler);
    let lastStage = k.stage;
    (this.ui as any).panelTick = () => {
      if (k.stage !== lastStage) { lastStage = k.stage; p.innerHTML = render(); wire(); return; }
      if (k.stage === "readings") {
        const stable = this.sim.s.t - s.kick.shutT >= 6, ramp = clamp((this.sim.s.t - s.kick.shutT) / 5, 0, 1);
        const g1 = p.querySelector("#g1"), g2 = p.querySelector("#g2"), rec = p.querySelector<HTMLButtonElement>("#rec");
        if (g1) g1.textContent = String(Math.round(s.kick.sidpp * ramp)); if (g2) g2.textContent = String(Math.round(s.kick.sicp * ramp));
        if (rec && stable && rec.disabled) { rec.disabled = false; rec.textContent = "Record pressures"; }
      } else if (k.stage === "weightup") {
        const c = p.querySelector<HTMLButtonElement>("#circ"); if (c && s.mw >= k.kmw - 0.1 && c.disabled) { c.disabled = false; c.textContent = "Begin circulating the kick out"; }
        const r = p.querySelectorAll(".row b"); if (r[0]) r[0].textContent = s.mw.toFixed(2) + " ppg";
      } else if (k.stage === "circ") {
        const set = (id: string, t: string) => { const e = p.querySelector(id); if (e) e.textContent = t; };
        set("#gd", String(Math.round(k.dpp))); set("#gdt", "target " + Math.round(k.dppTarget)); set("#gc", String(Math.round(k.cp))); set("#chv", String(Math.round(k.choke * 100)));
        const gc = p.querySelector<HTMLElement>("#gc"); if (gc) gc.style.color = k.cp > k.maasp * 0.9 ? "var(--red)" : "";
        const off = Math.abs(k.dpp - k.dppTarget); const gd = p.querySelector<HTMLElement>("#gd"); if (gd) gd.style.color = off <= 120 ? "var(--green)" : off <= 250 ? "var(--gold)" : "var(--red)";
        // bar: map ±400 psi around target to the bar width
        const needle = p.querySelector<HTMLElement>("#gneedle"), band = p.querySelector<HTMLElement>("#gband"), tgt = p.querySelector<HTMLElement>("#gtgt");
        if (needle && band && tgt) { const pos = clamp(50 + ((k.dpp - k.dppTarget) / 800) * 100, 0, 100); needle.style.left = pos + "%"; tgt.style.left = "50%"; band.style.left = "35%"; band.style.width = "30%"; }
        const sl = p.querySelector<HTMLInputElement>("#chk"); if (sl && document.activeElement !== sl) sl.value = String(Math.round(k.choke * 100));
        const r = p.querySelectorAll(".row b"); if (r[0]) { r[0].textContent = Math.round(k.progress * 100) + "%"; const pct = Math.round((k.inBand / Math.max(1, k.total)) * 100); r[1].textContent = pct + "%"; r[1].className = pct > 70 ? "ok" : "bad"; r[2].textContent = s.mw.toFixed(2) + " ppg"; }
      }
    };
  }

  // ---------- slips mini-game ----------
  openSlips(done: () => void) {
    this.slip = { t: 0, hits: 0, tries: 0, on: true };
    const p = this.open(`<div class="eyebrow">Drill Floor</div><h2>Pull the Slips</h2>
      <p>The floorhands are in the porta john. A connection's coming up and somebody has to set the slips on the pipe. Hit <b>SET SLIPS</b> when the marker is in the green zone. Three good sets.</p>
      <div class="slipbar"><div class="zone"></div><div class="mk" id="mk"></div></div>
      <div class="grid2"><div class="row"><span>Good sets</span><b id="sh">0 / 3</b></div><div class="row"><span>Attempts</span><b id="st">0</b></div></div>
      <div class="btns"><button class="b" id="setslips">SET SLIPS (Space)</button></div><p class="hint" id="slipmsg"></p>`, { closable: false } as any);
    this.ui.closable = false;
    const act = () => {
      if (!this.slip.on) return;
      this.slip.tries++;
      const pos = (Math.sin(this.slip.t * 3.1) + 1) / 2;
      const hit = pos > 0.42 && pos < 0.58;
      const msg = p.querySelector("#slipmsg")!;
      if (hit) { this.slip.hits++; msg.textContent = "Slips set. Clean."; this.sfx.good(); } else { msg.textContent = pos < 0.5 ? "Too early — the string bounced." : "Too late — pipe's sliding!"; this.sfx.bad(); this.sim.addCost(2000); }
      p.querySelector("#sh")!.textContent = this.slip.hits + " / 3"; p.querySelector("#st")!.textContent = String(this.slip.tries);
      if (this.slip.hits >= 3) { this.slip.on = false; window.removeEventListener("keydown", key); this.ui.closable = true; this.ui.closePanel(); done(); }
    };
    const key = (e: KeyboardEvent) => { if (e.code === "Space") { e.preventDefault(); act(); } };
    window.addEventListener("keydown", key);
    p.querySelector<HTMLButtonElement>("#setslips")!.onclick = act;
    (this.ui as any).panelTick = () => {
      this.slip.t += 1 / 60;
      const pos = (Math.sin(this.slip.t * 3.1) + 1) / 2;
      const mk = p.querySelector<HTMLElement>("#mk"); if (mk) mk.style.left = `calc(${pos * 100}% - 3px)`;
    };
  }

  // ---------- missions ----------
  buildMissions() { defineMissions(this); this.allMissions = [...this.queue]; }

  // ---------- sky: sun, moon and stars ----------
  private sky!: { sun: Mesh; sunMat: StandardMaterial; moon: Mesh; glow: Mesh; stars: Mesh; starMat: StandardMaterial };
  private buildSky() {
    const sc = this.scene;
    const tex = (size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) => { const t = new DynamicTexture("skytex", size, sc, true); draw(t.getContext() as CanvasRenderingContext2D, size); t.hasAlpha = true; t.update(); return t; };
    const mat = (t: DynamicTexture, emissive = new Color3(1, 1, 1)) => { const m = new StandardMaterial("skymat", sc); m.diffuseTexture = t; m.emissiveTexture = t; m.useAlphaFromDiffuseTexture = true; m.emissiveColor = emissive; m.disableLighting = true; m.fogEnabled = false; m.backFaceCulling = false; m.disableDepthWrite = true; m.specularColor = Color3.Black(); return m; };
    const disc = (size: number, mat_: StandardMaterial, name: string, dist: number) => { const p = MeshBuilder.CreatePlane(name, { size }, sc); p.material = mat_; p.billboardMode = Mesh.BILLBOARDMODE_ALL; p.infiniteDistance = true; p.isPickable = false; p.alwaysSelectAsActiveMesh = true; p.position.set(0, dist, 0); return p; };
    const sunT = tex(256, (c, s) => { const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, "rgba(255,255,240,1)"); g.addColorStop(0.16, "rgba(255,250,215,1)"); g.addColorStop(0.19, "rgba(255,225,150,0.55)"); g.addColorStop(0.5, "rgba(255,190,90,0.16)"); g.addColorStop(1, "rgba(255,170,60,0)"); c.fillStyle = g; c.fillRect(0, 0, s, s); });
    const sunMat = mat(sunT); const sun = disc(380, sunMat, "sun", 1000);
    const moonT = tex(256, (c, s) => { const g = c.createRadialGradient(s / 2, s / 2, s * 0.12, s / 2, s / 2, s / 2); g.addColorStop(0, "rgba(190,205,255,0.35)"); g.addColorStop(1, "rgba(190,205,255,0)"); c.fillStyle = g; c.fillRect(0, 0, s, s);
      c.beginPath(); c.arc(s / 2, s / 2, s * 0.17, 0, 6.3); c.fillStyle = "#e9ecf5"; c.fill();
      for (const [x, y, r] of [[-0.05, -0.05, 0.05], [0.07, 0.03, 0.035], [-0.02, 0.08, 0.04], [0.06, -0.09, 0.025], [-0.09, 0.02, 0.03]]) { c.beginPath(); c.arc(s / 2 + x * s, s / 2 + y * s, r * s, 0, 6.3); c.fillStyle = "rgba(150,160,185,0.55)"; c.fill(); } });
    const moonMat = mat(moonT); const moon = disc(300, moonMat, "moon", 1000); moon.setEnabled(false);
    const glow = moon;                                       // (the moon texture carries its own halo)
    const starT = tex(2048, (c, s) => { c.clearRect(0, 0, s, s); for (let i = 0; i < 1400; i++) { const x = Math.random() * s, y = Math.random() * s, r = 0.5 + Math.random() * 1.1, a = 0.4 + Math.random() * 0.6; c.fillStyle = `rgba(${200 + (Math.random() * 55) | 0},${210 + (Math.random() * 45) | 0},255,${a})`; c.beginPath(); c.arc(x, y, r, 0, 6.3); c.fill(); } });
    const starMat = mat(starT); starMat.alpha = 0;
    const stars = MeshBuilder.CreateSphere("stars", { diameter: 1700, segments: 16, sideOrientation: Mesh.BACKSIDE }, sc);
    stars.material = starMat; stars.infiniteDistance = true; stars.isPickable = false; stars.alwaysSelectAsActiveMesh = true; stars.renderingGroupId = 0;
    starT.uScale = 2; starT.vScale = 1;
    this.sky = { sun, sunMat, moon, glow, stars, starMat };
  }
  private updateSky(hour: number, night: number) {
    const k = this.sky; if (!k) return;
    const a = ((hour - 6.5) / 13.25) * Math.PI, d = new Vector3(Math.cos(a) * 0.8, Math.sin(a) * 0.95, 0.45).normalize();
    k.sun.position.copyFrom(d.scale(1000)); k.moon.position.copyFrom(d.scale(-1000));
    k.sun.setEnabled(!this.astMode && d.y > -0.1); k.moon.setEnabled(!this.astMode && d.y < 0.1);
    k.sunMat.emissiveColor = Color3.Lerp(new Color3(1, 0.55, 0.28), new Color3(1, 1, 0.92), clamp(d.y * 3.2, 0, 1));
    k.starMat.alpha = this.astMode ? 0 : clamp(night * 1.1 - 0.1, 0, 1);
  }

  // ---------- save / load ----------
  static SAVE_KEY = "rcmh2.save.v1";
  allMissions: Mission[] = []; doneIds = new Set<string>(); saveT = 0;
  onInteract: () => void = () => {};
  hasSave(): boolean { try { return !!localStorage.getItem(Game.SAVE_KEY); } catch { return false; } }
  clearSave() { try { localStorage.removeItem(Game.SAVE_KEY); } catch { /* ignore */ } }
  save() {
    if (!this.started || this.flags.finish || this.astMode || this.sleeping) return;
    try {
      const flags: Record<string, any> = {};
      for (const [k, v] of Object.entries(this.flags)) { try { JSON.stringify(v); flags[k] = v; } catch { /* skip things that can't be saved */ } }
      const p = this.player, onFoot = !this.veh.riding;
      localStorage.setItem(Game.SAVE_KEY, JSON.stringify({ v: 1, at: Date.now(), s: this.sim.s, hold: this.sim.hold, accumDead: this.sim.accumDead,
        approval: this.approval, morale: this.morale, incidents: this.incidents, flags, depthLog: this.depthLog, done: [...this.doneIds], realT: this.realT,
        ppe: p.body.ppe.length ? p.body.ppe[0].isEnabled() : false, pos: onFoot ? [p.pos.x, p.pos.y, p.pos.z, p.yaw] : null }));
    } catch { /* storage full or blocked */ }
  }
  load(): boolean {
    try {
      const raw = localStorage.getItem(Game.SAVE_KEY); if (!raw) return false;
      const d = JSON.parse(raw); if (d.v !== 1) return false;
      Object.assign(this.sim.s, d.s);      // keep the same state object: the job definitions hold a reference to it
      this.active = null; this.stack = []; this.ui.setMission("", "", "");   // jobs are re-evaluated from the restored state
      this.sim.hold = d.hold ?? null; this.sim.accumDead = !!d.accumDead;
      this.approval = d.approval; this.morale = d.morale; this.incidents = d.incidents; this.flags = d.flags ?? {}; this.realT = d.realT ?? 0;
      this.doneIds = new Set<string>(d.done ?? []); this.depthLog = d.depthLog ?? [];
      this.queue = this.allMissions.filter((m) => !this.doneIds.has(m.id));
      this.missionNo = this.doneIds.size;
      this.rig.setWindmill(!this.doneIds.has("windmill"));
      this.player.body.setPPE(!!d.ppe);
      if (d.pos) this.player.teleport(d.pos[0], d.pos[1], d.pos[2], d.pos[3]);
      return true;
    } catch { return false; }
  }

  geoProg(done: () => void) {
    const p = this.open(`<div class="eyebrow">Geologic Prognosis</div><h2>The Plan</h2>
      <p>Earl pins the geo-prog to the whiteboard. Your intermediate hole runs <b>750 → 8,500 ft</b> through the Delaware Basin.</p>
      ${this.statRow("Surface → 4,300 ft", "Salt & anhydrite · pore 8.6 ppg")}${this.statRow("4,300 → 6,000 ft", "Bell / Cherry Canyon · pore 9.2 ppg")}
      ${this.statRow("6,000 ft +", "Delaware sand · pore 10.8 ppg · frac 12.0 ppg", "warn")}
      ${this.statRow("7,000 ft +", "Gassy stringers possible · losses in Brushy Canyon", "bad")}
      <p class="hint">Keep mud weight above pore pressure and below fracture. Your mud weight starts at 9.0 ppg.</p>
      <div class="btns"><button class="b" id="geoOk">Got it</button></div>`, {});
    p.querySelector<HTMLButtonElement>("#geoOk")!.onclick = () => { this.ui.closePanel(); done(); };
  }

  tourStop(who: Who, title: string, q: string, opts: [string, string, number, number][], done: () => void) {
    this.say(who, `${q}`, opts.map((o) => ({ label: o[0], run: () => { this.radio("tyler", o[1], 8000); this.gain(o[2], o[3]); done(); } })), title);
  }
  houstonRound2(n: number) {
    const ans: [string, string][] = [["I'll put that in the slide deck.", "Perfect. One more thing: can we get the well done 'faster and cheaper but also safer'?"], ["Great. Bullets are the best.", "Perfect. One more thing: can we get the well done 'faster and cheaper but also safer'?"], ["Ha! Okay. Love the energy.", "Perfect. One more thing: can we get the well done 'faster and cheaper but also safer'?"]];
    this.radio("brent", ans[n - 1][0]);
    this.say("brent", ans[n - 1][1], [
      { label: "Yes. All three.", run: () => { this.gain(0.2, -2); this.finishHouston(); } },
      { label: "Pick two.", cls: "alt", run: () => { this.gain(0.4, 3); this.radio("brent", "…that's honestly the first honest answer I've gotten all week."); this.finishHouston(); } },
    ], "Houston");
  }
  finishHouston() { this.flags.houstonDone = true; }

  spawnInterns() {
    const cols = [["#2f6fa8", "#d9a77f"], ["#a82f6f", "#8a5a3a"], ["#3a8a3f", "#e0b48f"]];
    cols.forEach((c, i) => { const h = new Human(this.scene, { shirt: c[0], pants: "#3a3a3a", hat: "#f2f2f2", skin: c[1], vest: true, scale: 0.97 }); h.root.position.set(26 - i, 0, 14 + i); this.interns.push(h); });
    this.trail = []; for (let i = 0; i < 400; i++) this.trail.push(this.player.pos.clone());
  }
  despawnInterns() { this.interns.forEach((h) => h.root.dispose()); this.interns = []; }
  spawnSnake() {
    const m = new StandardMaterial("snk", this.scene); m.diffuseColor = Color3.FromHexString("#7a6a3a");
    const root = MeshBuilder.CreateBox("snake", { width: 0.05, height: 0.05, depth: 0.05 }, this.scene); root.isVisible = false;
    for (let i = 0; i < 7; i++) { const sgm = MeshBuilder.CreateSphere("ss", { diameter: 0.14 - i * 0.008, segments: 4 }, this.scene); sgm.material = m; sgm.parent = root; sgm.position.set(Math.sin(i * 1.1) * 0.25 + i * 0.06, 0.07, i * 0.2 - 0.6); }
    root.position.set(-4.0, F, -3.7); this.snake = root;
  }
  despawnSnake() { this.snake?.dispose(); this.snake = null; }
  spawnAsteroid() {
    const a = MeshBuilder.CreateSphere("asteroid", { diameter: 160, segments: 10 }, this.scene);
    const m = new StandardMaterial("ast", this.scene); m.diffuseColor = Color3.FromHexString("#4a3a32"); m.emissiveColor = Color3.FromHexString("#7a2a10");
    a.material = m; a.position.set(120, 420, -500); this.asteroid = a; this.asteroidT = 0;
  }
  // ---------- ARMAGEDDON (finale, from the original "Roll Coal Make Hole") ----------
  arm = {
    site: null as Vector3 | null, console: v3(4000, 1.4, 4006), depth: 0, wob: 22, bit: 100, bombed: false, said: new Set<number>(),
    rig: null as any, pipe: null as Mesh | null, flash: 0,
  };
  armFormation(d: number) {
    return d < 200 ? { name: "Asteroid Crust", hard: 7, abr: 0.25 } : d < 400 ? { name: "Metallic Core", hard: 10, abr: 0.5 } : { name: "Vibranium", hard: 15, abr: 1.0 };
  }
  buildAsteroidSite() {
    if (this.arm.site) return;
    const ox = 4000, oz = 4000, sc = this.scene;
    this.arm.site = v3(ox, 0, oz);
    const gm = new StandardMaterial("astg", sc); gm.diffuseColor = Color3.FromHexString("#3a2622"); gm.specularColor = Color3.Black();
    const ground = MeshBuilder.CreateGround("astground", { width: 400, height: 400 }, sc); ground.material = gm; ground.position.set(ox, 0, oz);
    const rm = new StandardMaterial("astr", sc); rm.diffuseColor = Color3.FromHexString("#2a1a18"); rm.emissiveColor = Color3.FromHexString("#2a0c06");
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 60; i++) {
      const a = rnd() * Math.PI * 2, r = 25 + rnd() * 160, s = 2 + rnd() * 9;
      const rock = MeshBuilder.CreateBox("rock", { width: s, height: s * (0.6 + rnd()), depth: s * (0.6 + rnd()) }, sc);
      rock.material = rm; rock.position.set(ox + Math.cos(a) * r, s * 0.3, oz + Math.sin(a) * r); rock.rotation.set(rnd() * 0.4, rnd() * 3, rnd() * 0.4); rock.freezeWorldMatrix();
    }
    // drill rig-lite: platform, mast, moving pipe, console
    const steel = new StandardMaterial("asts", sc); steel.diffuseColor = Color3.FromHexString("#8a9099");
    const orange = new StandardMaterial("asto", sc); orange.diffuseColor = Color3.FromHexString("#e0701a");
    const plat = MeshBuilder.CreateBox("plat", { width: 12, height: 0.5, depth: 12 }, sc); plat.material = steel; plat.position.set(ox, 0.25, oz);
    this.colliders.push({ x0: ox - 6, x1: ox + 6, y0: 0, y1: 0.5, z0: oz - 6, z1: oz + 6 });
    for (const [x, z] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) {
      const leg = MeshBuilder.CreateCylinder("al", { diameter: 0.35, height: 26, tessellation: 6 }, sc); leg.material = orange; leg.position.set(ox + x * 0.8, 13.2, oz + z * 0.8);
    }
    const pipe = MeshBuilder.CreateCylinder("apipe", { diameter: 0.3, height: 1, tessellation: 8 }, sc); pipe.material = steel; this.arm.pipe = pipe; pipe.position.set(ox, 10, oz); pipe.scaling.y = 20;
    const topd = MeshBuilder.CreateBox("atd", { width: 1.2, height: 2, depth: 1.2 }, sc); topd.material = orange; topd.position.set(ox, 22, oz); this.arm.rig = topd;
    const con = MeshBuilder.CreateBox("acon", { width: 3, height: 1.2, depth: 1.2 }, sc); con.material = steel; con.position.set(ox + 4, 1.1, oz + 3);
    const scr = MeshBuilder.CreateBox("ascr", { width: 2.6, height: 0.8, depth: 0.1 }, sc); const sm = new StandardMaterial("asscr", sc); sm.emissiveColor = Color3.FromHexString("#8a1f10"); sm.diffuseColor = Color3.Black(); scr.material = sm; scr.position.set(ox + 4, 1.95, oz + 3.65);
    this.colliders.push({ x0: ox + 2.5, x1: ox + 5.5, y0: 0.5, y1: 1.7, z0: oz + 2.4, z1: oz + 3.6 });
    this.arm.console = v3(ox + 4, 1.8, oz + 4.6);
    // crew in orange suits
    const crew: [number, number, string][] = [[-3, 3, "chick"], [3, 3.5, "bear"], [-4, -2, "rockhound"]];
    for (const [x, z] of crew) { const h = new Human(sc, { shirt: "#e07010", pants: "#d0d0d0", hat: "#f2f2f2", skin: "#d9a77f" }); h.root.position.set(ox + x, 0.5, oz + z); h.root.rotation.y = Math.PI; this.armCrew.push(h); }
  }
  armCrew: Human[] = [];
  colliders: import("./builder").AABB[] = [];
  callUp(done: () => void) {
    this.player.enabled = false; this.player.unlock();
    this.rig.humans.vp.root.setEnabled(false);
    $("fade").style.opacity = "1";
    this.radio("president", "Hold on to something, Company Man. This is going to be… a long commute.", 4000);
    setTimeout(() => {
      this.buildAsteroidSite();
      this.player.colliders.push(...this.colliders);
      this.rig.heliState.phase = "leaving";
      const o = this.arm.site!;
      this.player.teleport(o.x, 0.6, o.z + 8, Math.PI);
      this.player.gScale = 0.35; this.player.third = true;
      this.scene.fogDensity = 0.004;
      this.asteroidT = -1; if (this.asteroid) { this.asteroid.dispose(); this.asteroid = null; }
      this.astMode = true;
      this.sim.s.paused = true;
      $("fade").style.opacity = "0"; this.player.enabled = true; this.player.lock();
      this.ui.toast("ARMAGEDDON", "Low gravity. High stakes. Eight hundred feet.");
      this.radio("harry", "Alright, Company Man. You're the driller now. Get in that seat.", 8000);
      done();
    }, 1800);
  }
  astMode = false;
  openArm() {
    const a = this.arm;
    if (!a.bombed) { this.flags.armDrilling = true; a.depth = Math.max(a.depth, 0.1); }
    const render = () => {
      const f = this.armFormation(a.depth);
      return `<div class="eyebrow">ARMAGEDDON · Asteroid Drill</div><h2>${a.bombed ? "Detonation" : "Drilling Console"}</h2>
        ${this.statRow("Depth", a.depth.toFixed(0) + " / 800 ft")}${this.statRow("Formation", f.name)}${this.statRow("Bit health", Math.round(a.bit) + "%", a.bit < 25 ? "bad" : "")}
        ${a.depth >= 800 && !a.bombed ? `<div class="note">TD. Plant the bomb — it's the only casing this well gets. ($5,000,000)</div>` : `<div class="hint">WOB: <b id="aw">${a.wob}</b> klbs — harder rock wears the bit. Vibranium hardness: 15.</div><input type="range" id="awob" min="0" max="80" value="${a.wob}"/>`}
        <div class="btns">${a.depth >= 800 && !a.bombed ? `<button class="b red" id="bomb">Plant the bomb</button>` : ""}${a.bombed ? `<button class="b red" id="det">Detonate (Space)</button>` : ""}<button class="b alt" data-close>Close</button></div>`;
    };
    const p = this.open(render(), { live: false });
    const wire = () => {
      this.closeBtn(p);
      const w = p.querySelector<HTMLInputElement>("#awob"); if (w) w.oninput = () => { a.wob = Number(w.value); p.querySelector("#aw")!.textContent = w.value; };
      p.querySelector<HTMLButtonElement>("#bomb")?.addEventListener("click", () => { a.bombed = true; this.sim.addCost(5_000_000); this.ui.toast("BOMB PLANTED", "Press SPACE to detonate"); p.innerHTML = render(); wire(); });
      p.querySelector<HTMLButtonElement>("#det")?.addEventListener("click", () => this.detonate());
    };
    wire();
    const key = (e: KeyboardEvent) => { if (e.code === "Space" && a.bombed) { e.preventDefault(); window.removeEventListener("keydown", key); this.detonate(); } };
    if (a.bombed) window.addEventListener("keydown", key);
  }
  armUpdate(dt: number) {
    const a = this.arm;
    if (!this.astMode || a.bombed) return;
    if (a.depth > 0 || this.flags.armDrilling) {
      const f = this.armFormation(a.depth);
      const rop = Math.max(2, (a.wob * 6 / f.hard) * (0.35 + 0.65 * a.bit / 100)) * 1.0; // ft/min-ish
      a.depth = Math.min(800, a.depth + rop * dt * 1.2);
      a.bit = Math.max(0, a.bit - 1.3 * Math.pow(a.wob / 20, 2.2) * f.abr * dt * 0.35);
      if (a.bit <= 0) { a.bit = 100; this.radio("rockhound", "Bit's cooked! Swapped it for a new one. Don't tell the President.", 6000); this.sim.addCost(50000); }
    }
    for (const d of [50, 100, 150, 200, 250, 300, 400, 500, 550, 600, 625, 798, 799]) {
      if (a.depth >= d && !a.said.has(d)) { a.said.add(d); this.armSpeech(d); }
    }
    if (a.pipe && this.arm.site) { a.pipe.scaling.y = 20 + a.depth * 0.02; a.pipe.position.y = 10 - a.depth * 0.005; }
  }
  armSpeech(d: number) {
    const L: Record<number, [Who, string, number?]> = {
      50: ["president", "We are faced with the very gravest of challenges."], 100: ["chick", "You know, Harry, I swore I'd never drill again after that last one."],
      150: ["bear", "If this thing blows, I want my last meal to be a Twinkie."], 200: ["bear", "You stick that drill in the ground, and you make it sing!"],
      250: ["rockhound", "I'm not crazy, I'm just a little unwell."], 300: ["max", "I got a bad feeling about this rock, Harry."],
      400: ["harry", "I can't do it alone, Colonel. I need your help."],
      500: ["rockhound", "Guess what guys, it's time to embrace the horror! Look, we've got front row tickets to the end of the earth!"],
      550: ["chick", "Harry, you ever miss a depth?"], 600: ["harry", "Not once, Chick. Not once."],
      625: ["harry", "I have been drilling holes in the earth for 30 years. And I have never, NEVER missed a depth that I have aimed for. And by God, I am not gonna miss this one — I will make 800 feet.", 11000],
      798: ["president", "Mission accomplished. Godspeed, gentlemen."], 799: ["harry", "Yeah one more thing, um… none of them wanna pay taxes again."],
    };
    const e = L[d]; if (e) this.radio(e[0], e[1], e[2] ?? 7000);
  }
  detonate() {
    if (this.flags.finish) return;
    this.flags.finish = true; this.ui.closePanel();
    $("fade").style.transition = "opacity .15s"; $("fade").style.background = "#fff"; $("fade").style.opacity = "1";
    this.sfx.thud(); this.sfx.horn();
    setTimeout(() => {
      this.ui.panel(`<div class="eyebrow">Victory</div><div class="who"><img src="${import.meta.env.BASE_URL}portraits/nasa.jpg" alt=""/><div><h2 style="font-size:26px">BEN AFFLECK</h2><p>“I asked Michael why it was easier to train oil drillers to become astronauts than it was to train astronauts to become oil drillers, and he told me to shut the %$&! up. So that was the end of that talk.”</p></div></div><div class="btns"><button class="b" id="vc">Continue</button></div>`, { closable: false });
      $("fade").style.opacity = "0"; $("fade").style.background = "#000"; $("fade").style.transition = "opacity .5s";
      $("vc").onclick = () => { this.ui.closePanel(); this.showEnd(); };
    }, 1500);
  }

  showEnd() {
    this.clearSave();
    const s = this.sim.s, hours = s.t / 60;
    const over = s.cost - WELL.afe;
    const score = this.approval * 12 + this.morale * 0.3 - over / 70000 - this.incidents * 4 + s.stats.kicksKilled * 6;
    const grade = score > 80 ? "S" : score > 68 ? "A" : score > 56 ? "B" : score > 44 ? "C" : score > 30 ? "D" : "F";
    const rows: [string, string][] = [
      ["Depth drilled", fmt(s.stats.feetDrilled) + " ft"], ["Rig time", `${Math.floor(hours)} hr`], ["Final cost vs AFE", `${money(s.cost)} / ${money(WELL.afe)}`],
      ["Office approval", this.approval.toFixed(1) + " ★"], ["Crew morale", Math.round(this.morale) + "%"], ["Incidents", String(this.incidents)], ["Kicks killed", String(s.stats.kicksKilled)],
    ];
    $("endgrade").textContent = grade;
    $("endstats").innerHTML = rows.map((r) => `<div class="row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join("");
    $("endtitle").innerHTML = over <= 0 ? `Under <em>AFE</em>` : `Planet <em>Saved</em>`;
    $("end").style.display = "grid"; this.player.unlock(); this.started = false;
  }

  // ---------- mission engine ----------
  beginMission(m: Mission) {
    this.active = { m, i: 0 }; this.missionNo++;
    m.start?.();
    this.ui.setMission(m.title, m.steps[0].text, this.jobLabel(m));
    this.sfx.good(); this.ui.toast(m.title);
    m.steps[0].enter?.();
  }
  stepDone() {
    const a = this.active; if (!a) return;
    a.i++;
    if (a.i >= a.m.steps.length) {
      const m = a.m; m.end?.(); this.doneIds.add(m.id);
      this.gain(m.a ?? 0, m.m ?? 0); this.sfx.good(); this.ui.toast("JOB COMPLETE", m.title);
      this.active = null; this.lastDone = this.realT; this.save();
      if (!(m.priority)) { /* keep order */ }
      this.ui.setMission("", "", "");
      this.nextFromStack();
    } else {
      this.ui.setMission(a.m.title, a.m.steps[a.i].text, this.jobLabel(a.m));
      a.m.steps[a.i].enter?.();
    }
  }
  /** progress label: jobs finished so far, not the order they happened to start in (urgent ones interrupt the list) */
  jobLabel(m: Mission): string {
    const done = this.doneIds.size, total = this.missionTotal;
    return m.priority ? `URGENT · ${done} of ${total} jobs done` : `Job ${Math.min(total, done + 1)} of ${total}`;
  }
  nextFromStack() {
    const r = this.stack.pop();
    if (r) { this.active = r; this.ui.setMission(r.m.title, r.m.steps[r.i].text, this.jobLabel(r.m)); }
  }
  updateMissions() {
    // priority missions can interrupt
    for (const m of this.queue) {
      if (m.priority && m.trigger() && !(this.active && this.active.m === m)) {
        if (this.active) this.stack.push(this.active);
        this.queue.splice(this.queue.indexOf(m), 1); this.beginMission(m); break;
      }
    }
    if (!this.active) {
      const head = this.queue.find((m) => !m.priority);
      if (head && head.trigger()) { this.queue.splice(this.queue.indexOf(head), 1); this.beginMission(head); }
      else if (this.stack.length) this.nextFromStack();
    }
    const a = this.active;
    if (a) {
      const st = a.m.steps[a.i];
      if (st.watch && st.watch()) this.stepDone();
    }
    // release the hold chain: once all scripted jobs before the finale are done
    if (this.holdPending && !this.queue.some((m) => !m.priority && m.id !== "armageddon") && !this.active) { this.flags.chainDone = true; this.holdPending = false; }
    // hold the bit off bottom while the cast of characters is still queued
    if (this.sim.s.depth > 8000 && !this.flags.chainDone && !this.sim.hold) { this.sim.hold = 8300; this.radio("dale", "We're 200 feet off TD. Holding here till you've handled whatever's on your plate, boss.", 9000); }
    // random scripted hazards
    if (this.sim.s.depth >= 6600 && !this.flags.accumFault) { this.flags.accumFault = true; this.sim.accumDead = true; this.sim.s.accum = 900; }
    if (this.sim.s.depth >= 6900 && !this.flags.accumHint) { this.flags.accumHint = true; this.radio("dale", "Hey boss, somebody ought to walk the accumulator before we get into that gas zone.", 10000); }
    if (this.sim.s.fuel < 1200 && !this.flags.fuelWarn) { this.flags.fuelWarn = true; this.radio("earl", "Diesel's getting low. You'll want to order fuel from the tank.", 9000); }
  }

  // ---------- per-frame ----------
  timeScale(): number {
    const s = this.sim.s;
    if (!this.started || this.paused) return 0;
    if (this.ui.panelOpen && !this.live) return 0;
    if (this.sleeping) return 60;
    if (s.mode === "killing") return 1.0;             // circulating out the kick: about a minute, still slow enough to work the choke
    if (s.kick.alarm || s.mode === "shutin") return 0.7;
    if (s.mode === "tripping") return 8;
    if (s.mode === "casing") return 10;
    return 2;
  }

  processSimEvents() {
    for (const e of this.sim.drain()) {
      switch (e.type) {
        case "kickAlarm": this.wake("PIT GAIN!"); break;
        case "autoShutIn": this.radio("dale", "I shut it in myself. Late. Got a bigger gain than I'd like.", 9000); this.inc(1); break;
        case "lossStart": this.radio("marcus", "We're losing returns! Pits are dropping — you're over frac. Back off the mud weight or pump LCM.", 10000); this.wake("LOSSES"); break;
        case "lossHealed": this.radio("marcus", "Losses healed. Pits are stable.", 6000); break;
        case "bitDead": this.radio("dale", "Bit's done, boss. ROP fell off a cliff. We need to trip.", 10000); this.wake("BIT DEAD"); break;
        case "stall": this.radio("dale", "MOTOR STALL! Picking up off bottom. Too much weight for this rock — differential pressure spiked.", 9000); this.gain(0, -3); this.sfx.bad(); break;
        case "tripDone": this.radio("dale", "New bit's on bottom. Let's make hole.", 7000); break;
        case "fractured": this.radio("dale", "Casing pressure's too high — we just broke down the shoe!", 9000); this.inc(1, "SHOE BROKE DOWN"); break;
        case "killDone": this.radio("marcus", e.good ? "Kill's complete. Textbook." : "Kill's done, but that was ugly. Houston's going to ask.", 9000); if (!e.good) this.inc(1); this.sfx.good(); break;
        case "blackout": if (!this.flags.blackout) { this.flags.blackout = true; this.radio("earl", "We're out of diesel! Power's down, boss. Order fuel at the tank!", 10000); } break;
        case "td": this.radio("dale", "TD, boss. Eighty-five hundred feet. Circulate and condition?", 9000); break;
        case "casingDone": this.ui.toast("CASING & CEMENT IN PLACE"); break;
        default: break;
      }
    }
  }

  update(dt: number, realDt: number) {
    if (!this.paused) this.realT += realDt;
    this.trailT += realDt;
    document.body.classList.toggle("playing", this.started);
    document.body.classList.toggle("panelopen", this.ui.panelOpen);
    if (this.sleeping && (this.sim.s.t >= this.sleepUntil)) this.wake("Alarm clock");
    this.updateMissions();
    this.processDebts();
    this.processSimEvents();
    if (this.hold !== null) this.sim.hold = this.hold;
    if (this.sim.s.fuel > 0) this.flags.blackout = false;
    this.ui.tickPanel();
    // interns follow the player's trail
    if (this.interns.length) {
      if (this.trailT > 0.08) { this.trailT = 0; this.trail.push(this.player.pos.clone()); if (this.trail.length > 400) this.trail.shift(); }
      this.interns.forEach((h, i) => {
        const idx = Math.max(0, this.trail.length - 1 - 14 * (i + 1));
        const t = this.trail[idx], p = h.root.position, dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
        const target = this.player.pos;
        if (Math.hypot(target.x - p.x, target.z - p.z) > 2.2) {
          const sp = Math.min(6, Math.max(2.4, d * 4));
          if (d > 0.1) { p.x += (dx / d) * sp * realDt; p.z += (dz / d) * sp * realDt; pushOutXZ(this.player.colliders, p, p.y, 0.35); h.root.rotation.y = Math.atan2(dx, dz); }
          p.y += (t.y - p.y) * Math.min(1, realDt * 8); h.animate(realDt, sp);
        } else { h.animate(realDt, 0); p.y += (t.y - p.y) * Math.min(1, realDt * 8); }
      });
    }
    // deer wander
    const dn = this.rig.deerNode;
    if (dn.isEnabled()) {
      if (this.deer.target) {
        const d = this.deer.target.subtract(dn.position); d.y = 0; const l = d.length();
        if (l > 0.4) { dn.position.addInPlace(d.scale((7 * realDt) / l)); pushOutXZ(this.player.colliders, dn.position, 0, 0.8); dn.rotation.y = Math.atan2(d.x, d.z); }
      } else dn.rotation.y += Math.sin(this.realT * 0.7) * 0.003;
    }
    this.armUpdate(realDt); this.armCrew.forEach((h) => h.animate(realDt, 0));
    if (this.asteroid) { this.asteroidT += realDt; this.asteroid.position.y = 420 - this.asteroidT * 30; this.asteroid.position.x = 120 - this.asteroidT * 4; this.asteroid.rotation.y += realDt * 0.05; }
    this.updateEnv();
    this.sampleDepth();
    this.saveT += realDt; if (this.saveT > 12) { this.saveT = 0; this.save(); }
    this.updateHud(realDt);
  }

  updateEnv() {
    const s = this.sim.s, c = clockString(s.t), hour = c.hour;
    const elev = Math.sin(((hour - 6.5) / 13.25) * Math.PI);
    const day = clamp(elev * 3 + 0.25, 0, 1), night = clamp(1 - (elev + 0.15) / 0.3, 0, 1);
    const sky = (d: number, dawn: number) => {
      const night = new Color3(0.03, 0.05, 0.1), dawnC = new Color3(0.93, 0.6, 0.42), dayC = new Color3(0.53, 0.76, 0.93);
      const base = Color3.Lerp(night, dawnC, clamp(dawn * 1.4, 0, 1));
      return Color3.Lerp(base, dayC, d);
    };
    const dawn = clamp(1 - Math.abs(elev) * 4, 0, 1) * (elev > -0.2 ? 1 : 0);
    let col = sky(day, dawn);
    if (this.asteroidT >= 0) col = Color3.Lerp(col, new Color3(0.5, 0.15, 0.08), Math.min(0.7, this.asteroidT / 12));
    if (this.astMode) { col = new Color3(0.16, 0.04, 0.03); }
    this.scene.clearColor.set(col.r, col.g, col.b, 1);
    this.scene.fogColor = col.clone();
    this.env.hemi.intensity = this.astMode ? 0.55 : 0.5 + 0.4 * day;
    this.env.sun.intensity = this.astMode ? 0.5 : 0.2 + 1.05 * day;
    const az = (hour - 6.5) / 13.25 * Math.PI;
    const ex = Math.cos(az), ey = Math.max(0.12, elev);
    this.env.sun.direction.set(-ex * 0.8, -ey, -0.45);
    (this.env.sun as any).__night = night;
    this.nightFactor = night;
    this.updateSky(hour, night);
  }
  nightFactor = 0;

  updateHud(dt: number) {
    const s = this.sim.s, c = clockString(s.t);
    const k = s.kick;
    const items = [
      { k: "Day " + c.day, v: c.hhmm }, { k: "Depth", v: fmt(s.depth) + " ft" }, { k: "ROP", v: fmt(s.rop) }, { k: "WOB", v: String(Math.round(s.wob)) },
      { k: "MW ppg", v: s.mw.toFixed(1) }, { k: "SPP psi", v: fmt(s.spp) }, { k: "Diff psi", v: fmt(s.dp), warn: s.dp > STALL_DP * 0.9 }, { k: "Auto", v: s.auto.on ? "ON" : "OFF" }, { k: "Pits Δ", v: (s.pit - s.pitBase >= 0 ? "+" : "") + fmt(s.pit - s.pitBase), warn: k.active || s.loss.active },
      { k: "Bit", v: Math.round(s.bit) + "%", warn: s.bit < 20 }, { k: "Cost / AFE", v: money(s.cost) + "/" + (WELL.afe / 1e6).toFixed(1) + "M", warn: s.cost > WELL.afe },
    ];
    this.ui.setStrip(items);
    this.ui.setStars(this.approval); this.ui.setBars(this.morale, this.incidents);
    let alert: string | null = null;
    if (this.astMode) alert = null;
    else if (k.active && !k.shut) alert = "⚠ PIT GAIN — WELL FLOWING";
    else if (k.shut && s.kill.stage !== "flowcheck") alert = "WELL SHUT IN — KILL PROCEDURE";
    else if (s.loss.active) alert = "LOST CIRCULATION";
    else if (s.fuel <= 0) alert = "BLACKOUT — OUT OF DIESEL";
    else if (s.needTrip && s.mode !== "tripping") alert = "BIT DEAD — TRIP REQUIRED";
    this.ui.setAlert(alert);
    this.sfx.alarmTick(dt, !!(k.active && !k.shut) || s.fuel <= 0);

    // nearest interactable
    const p = this.player, eye = p.eyePos(), fwd = p.third ? new Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)) : p.lookDir();
    const stepPos = this.active ? this.active.m.steps[this.active.i] : null;
    const cand: { it: Interactable; score: number }[] = [];
    const consider = (it: Interactable) => {
      if (it.ok && !it.ok()) return;
      const pos = it.pos(), d3 = pos.subtract(eye), dist = d3.length();
      if (dist > it.r + 1 || Math.abs(pos.y - (p.pos.y + 1.2)) > 3.8) return;
      const hdist = Math.hypot(d3.x, d3.z);
      const dir = hdist > 0.01 ? new Vector3(d3.x / hdist, 0, d3.z / hdist) : fwd;
      const dot = Vector3.Dot(fwd.normalizeToNew().multiplyByFloats(1, 0, 1).normalize(), dir);
      if (dist > 1.6 && dot < 0.0) return;
      cand.push({ it, score: dist - dot * 2 - (it.mission ? 2.5 : 0) });
    };
    if (stepPos?.act && stepPos.at) {
      const at = stepPos.at;
      consider({ pos: () => at() ?? v3(0, -999, 0), label: () => stepPos.label ?? "Interact", r: stepPos.r ?? 3, act: () => stepPos.act!(() => this.stepDone()), mission: true });
    }
    for (const it of this.interacts) consider(it);
    cand.sort((a, b) => a.score - b.score);
    this.nearest = this.ui.panelOpen || !this.started || this.paused || this.veh.riding ? null : cand[0]?.it ?? null;
    this.ui.setPrompt(this.veh.riding && !this.ui.panelOpen && this.started && !this.paused ? this.veh.promptLabel() : this.nearest ? this.nearest.label() : null);

    // task arrows: one per open task (the active job plus any jobs it interrupted)
    const PAL = ["#f4c04a", "#4aa3e8", "#e5483b", "#3dbb6a", "#c77dff"];
    const markers: { title: string; pos: Vector3; color: string; primary: boolean }[] = [];
    const addM = (m: Mission, i: number, primary: boolean, ci: number) => {
      const at = m.steps[i]?.at?.();
      if (at) markers.push({ title: m.title, pos: at, color: PAL[ci % PAL.length], primary });
    };
    if (this.active) addM(this.active.m, this.active.i, true, 0);
    for (let j = this.stack.length - 1, c = 1; j >= 0; j--, c++) addM(this.stack[j].m, this.stack[j].i, false, c);
    const cam = this.scene.activeCamera!;
    const eng = this.scene.getEngine();
    const W = document.documentElement.clientWidth || 1, Hh = document.documentElement.clientHeight || 1;
    const scale = eng.getRenderWidth() / W;
    const vp = new Viewport(0, 0, eng.getRenderWidth(), eng.getRenderHeight());
    const fwdRay = cam.getForwardRay().direction;
    const show = this.started && !this.ui.panelOpen && !this.paused;
    const pins = markers.map((m) => {
      const wp = m.pos.add(v3(0, 1.4, 0));
      const sc = Vector3.Project(wp, Matrix.Identity(), this.scene.getTransformMatrix(), vp);
      let x = sc.x / scale, y = sc.y / scale;
      const ahead = Vector3.Dot(wp.subtract(cam.position), fwdRay) > 0;
      if (!ahead) { x = W - x; y = Hh - y; }
      const mX = 60, mT = 130, mB = 150;
      let edge = !ahead || x < mX || x > W - mX || y < mT || y > Hh - mB;
      const dx = x - W / 2, dy = y - Hh / 2;
      let px = x, py = y;
      if (edge) {
        const k = Math.min((W / 2 - mX) / Math.max(1, Math.abs(dx)), (dy < 0 ? Hh / 2 - mT : Hh / 2 - mB) / Math.max(1, Math.abs(dy)));
        px = W / 2 + dx * k; py = Hh / 2 + dy * k;
      }
      const dist = Math.round(Vector3.Distance(m.pos, p.pos) * 3.281);
      return { x: px, y: py, show: show && (edge || dist > 8), text: dist + " FT", title: m.title, color: m.color, edge, angle: Math.atan2(dx, -dy), primary: m.primary };
    });
    this.ui.setPins(pins);
    this.updateBeams(show ? markers : []);
    this.ui.drawMap(p.pos.x, p.pos.z, p.yaw, markers.map((m) => ({ x: m.pos.x, z: m.pos.z, color: m.color })));
    const target = markers[0]?.pos ?? null; void target;

    // district banner
    const d = this.district();
    if (d !== this.lastDistrict) { this.lastDistrict = d; this.ui.setDistrict(d); }
    $("crosshair").style.display = !p.third && this.started && !this.ui.panelOpen ? "block" : "none";
  }

  private beams: Mesh[] = [];
  /** Tall translucent light beam over each task target so you can spot it across the pad. */
  updateBeams(markers: { pos: Vector3; color: string; primary: boolean }[]) {
    while (this.beams.length < markers.length) {
      const m = MeshBuilder.CreateCylinder("beam", { diameter: 1.2, height: 70, tessellation: 12 }, this.scene);
      const mat = new StandardMaterial("beamm", this.scene);
      mat.disableLighting = true; mat.alpha = 0.2; mat.backFaceCulling = false; mat.disableDepthWrite = true;
      m.material = mat; m.isPickable = false; m.alwaysSelectAsActiveMesh = true;
      this.beams.push(m);
    }
    this.beams.forEach((b, i) => {
      const mk = markers[i];
      if (!mk) { b.setEnabled(false); return; }
      b.setEnabled(true);
      const c = Color3.FromHexString(mk.color);
      (b.material as StandardMaterial).emissiveColor = c;
      (b.material as StandardMaterial).alpha = mk.primary ? 0.22 : 0.12;
      b.scaling.x = b.scaling.z = mk.primary ? 1 : 0.6;
      b.position.set(mk.pos.x, mk.pos.y + 33, mk.pos.z);
    });
  }

  district(): string {
    if (this.astMode) return "Asteroid";
    const { x, y, z } = this.player.pos;
    if (y > 6 && Math.abs(x) < 7 && Math.abs(z) < 7) return "Drill Floor";
    if (Math.abs(x) < 7 && Math.abs(z) < 6.5) return "Substructure";
    if (z > 70) return "Lease Road";
    if (x > 27 && z > 4 && z < 40) return "Camp";
    if (x > 38 && z < -20) return "Water Tanks";
    if (z < -17 && z > -28 && x > -19 && x < 20) return "Mud Tanks";
    if (x < -18 && x > -45 && z < 4) return "Power House";
    if (z < -8 && z > -16 && x < 2 && x > -14) return "Pump Room";
    if (z > 12 && z < 38 && Math.abs(x) < 13) return "Pipe Racks";
    if (z < -17) return "Backyard";
    return "Location";
  }

  interact() {
    if (this.started && !this.paused && !this.ui.panelOpen && this.veh.riding) { this.veh.leave(); return; }
    if (!this.started || this.paused || this.ui.panelOpen || !this.nearest) return;
    this.sfx.click(); this.onInteract(); this.nearest.act();
  }
}
