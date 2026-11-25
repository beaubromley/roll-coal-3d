import { Scene, Vector3, Matrix, MeshBuilder, StandardMaterial, Color3, Mesh, DirectionalLight, HemisphericLight, Viewport, DynamicTexture, VertexBuffer, VertexData, Quaternion, ParticleSystem, Color4 } from "@babylonjs/core";
import { Rig, F } from "./rig";
import { Finale } from "./finale";
import { Player } from "./player";
import { drawAutoBars } from "./recorder";
import { setupBoard } from "./scores";
import { drawEdr, Screens, type ScreenData } from "./screens";
import { Dd, OFFSETS } from "./dd";
import { Sim, WELL, clockString, formationAt, poreAt, fracAt, STALL_DP, TORQUE_MAX } from "./sim";
import { Sfx } from "./audio";
import { UI, Who, Choice, $ } from "./ui";
import { Human } from "./npcs";
import { pushOutXZ } from "./builder";
import { Mini } from "./minigames";
import { Vehicles } from "./vehicles";
import { Outskirts } from "./outskirts";
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
interface Interactable { pos: () => Vector3; label: () => string; r: number; act: () => void; ok?: () => boolean; mission?: boolean; tv?: boolean }

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const money = (n: number) => "$" + (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : fmt(n));
const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export class Game {
  started = false;
  approval = 3; morale = 62; incidents = 0;
  interacts: Interactable[] = [];
  private chX = 0; private chY = 0; private hudDays = -1; private hudClock = ""; private hudCost = ""; private hudWell = "";
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
    this.player.canLock = () => !this.ui.panelOpen && !this.paused;
    this.finale = new Finale(this);
    this.ui.logClock = () => { const c = clockString(this.sim.s.t); return "Day " + c.day + " " + c.hhmm; };
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
  inc(n = 1, why = "") { this.incidents += n; this.flags.lastIncDay = clockString(this.sim.s.t).day; this.rig.setDaysSince(0); this.approval = clamp(this.approval - 0.3 * n, 0, 5); this.sfx.bad(); if (why) this.ui.toast("INCIDENT", why); }
  gain(a = 0, m = 0) { this.approval = clamp(this.approval + a, 0, 5); this.morale = clamp(this.morale + m, 0, 100); }
  say(who: Who, text: string, choices?: Choice[], eyebrow?: string, opts?: { closable?: boolean }) { this.player.enabled = false; this.player.unlock(); this.ui.say(who, text, choices, eyebrow, opts); this.sfx.radio(); }
  radio(who: Who, text: string, ms?: number) {
    // on the asteroid it is just you and Harry on the radio (and Houston)
    if (this.astMode && !["harry", "nasa"].includes(who as string)) who = "harry" as Who;
    this.ui.radio(who, text, ms); this.sfx.radio();
  }
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
    this.veh.eject(true);   // and the vehicle goes back where it started
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
  standDown(why: string, cost: number, lostSec: number, _reset: () => void) {
    this.sim.addCost(cost); this.sim.s.t += lostSec;
    this.flags.lastIncDay = clockString(this.sim.s.t).day; this.rig.setDaysSince(0);
    // everybody huddles in the safety trailer
    const h = this.rig.huddle, keys = ["pusher", "driller", "mudeng", "dd1", "hand1", "hand2", "hand3", "derrickman", "guard"];
    const saved: { m: Human; x: number; y: number; z: number; ry: number }[] = [];
    this.rig.huddleHold.on = true;
    const who = keys.map((k) => this.rig.humans[k]).filter((m) => m && m.root.isEnabled());
    who.forEach((m, i) => {
      saved.push({ m, x: m.root.position.x, y: m.root.position.y, z: m.root.position.z, ry: m.root.rotation.y });
      const a = (i / who.length) * Math.PI * 2 + 0.4; m.root.position.set(h.x + Math.cos(a) * 1.55, h.y, h.z + Math.sin(a) * 1.1); m.root.rotation.y = Math.atan2(h.x - m.root.position.x, h.z - m.root.position.z);
    });
    this.player.teleport(h.x, h.y + 0.05, h.z - 1.9, 0);
    this.say("earl", `${why} Alright, everybody in here. Sit, stand, I don't care. Days since our last incident: zero. We've been there before. Look: we're lucky nobody was seriously injured today. Lucky. Let's not make a habit of needing luck. Go home the way you came. Back to work.`, [
      { label: "Back to work", cls: "green", run: () => {
        this.rig.huddleHold.on = false;
        for (const s of saved) { s.m.root.position.set(s.x, s.y, s.z); s.m.root.rotation.y = s.ry; }
        this.player.teleport(h.exit.x, 0.5, h.exit.z, Math.PI);
      } },
    ], "Safety Stand Down", { closable: false });
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
  outskirts!: Outskirts;
  dd!: Dd;
  buildAmbient() {
    this.dd = new Dd(this);
    const S = this.rig.spots, H = this.rig.humans;
    // everything past the fence: its colliders join the world before the vehicles take their snapshot of it
    this.outskirts = new Outskirts(this);
    for (const c of this.outskirts.colliders) this.rig.colliders.push(c);
    this.player.terrain = this.outskirts.terrain;
    this.veh = new Vehicles(this.scene, this.rig.colliders, this.player, this);
    this.veh.terrain = this.outskirts.terrain;
    for (const it of this.veh.interacts()) this.interacts.push(it);
    for (const it of this.outskirts.interacts()) this.interacts.push(it);
    const add = (pos: () => Vector3, label: string | (() => string), r: number, act: () => void, ok?: () => boolean) =>
      this.interacts.push({ pos, label: typeof label === "string" ? () => label : label, r, act, ok });
    add(() => S.board, "Work the board — rack a stand", 3.2, () => this.workBoard(), () => this.player.pos.y > 20);
    // the console is the TVs in the driller's cabin: aim at one and click (or press E) and its screen opens, with the controls that go with it
    // (E only sits in a chair or stands up; while seated, clicking any screen opens them all)
    for (const m of this.rig.monitors) if (m.grp === "drill") this.interacts.push({ pos: () => m.pos, label: () => "Click: all screens  ·  E: stand up", r: 4.4, act: () => this.openCabin("all"), tv: true, ok: () => this.veh.isSeated(0) });
    for (const m of this.rig.monitors) if (m.grp === "dd") this.interacts.push({ pos: () => m.pos, label: () => "Click: the directional screens  ·  E: stand up", r: 4.4, act: () => this.openDdScreens(), tv: true, ok: () => this.veh.isSeated(1) || this.veh.isSeated(2) });
    add(() => S.hopper, "Mud hopper", 3.4, () => this.openHopper());
    add(() => S.frac, "Frac tanks: transfer to the pits", 4.2, () => this.openFrac());
    add(() => S.desk, "Computer — AFE & orders", 2.8, () => this.openDesk());
    add(() => S.phone, "Phone", 2.6, () => this.openPhone());
    add(() => S.catwalk, "Catwalk controls (ground station)", 3.0, () => this.openCatwalk(false));
    add(() => S.catremote, "Catwalk remote", 3.0, () => this.openCatwalk(true), () => this.player.pos.y > 6);
    add(() => S.donuts, "Donuts", 2.4, () => { this.sfx.click(); this.ui.toast("DONUTS", "“No thanks, I just started a new diet.”"); });
    add(() => S.printer, "Printer", 2.4, () => { this.sfx.click(); this.ui.toast("PRINTER", "It's been broken since last hitch."); });
    add(() => S.bunk, "Rack out", 2.8, () => this.openBunk());
    add(() => S.choke, "Choke panel", 3.2, () => this.openChoke());
    add(() => S.accumulator, "BOP accumulator", 3.2, () => this.openAccum());
    add(() => S.shakers, "Shale shakers", 3.4, () => this.openShakers());
    add(() => S.pits, "Pit levels", 3.2, () => this.openPits());
    add(() => S.pumps, "Mud pumps", 3.4, () => this.openPumps());
    add(() => S.gens, "Generators", 3.4, () => this.openGens());
    add(() => S.fuel, "Diesel tank", 3.4, () => this.openFuel());
    let knocks = 0;
    add(() => S.mudlog, "Knock on the mud logger's door", 1.6, () => {
      this.sfx.click(); this.ui.toast("KNOCK KNOCK", "The door is locked.");
      const n = knocks++;
      setTimeout(() => {
        this.radio("marcus", ["(muffled) Busy! I'm logging!", "(muffled) Go away, I'm in the middle of a sample.", "(muffled) …Fine. Report's coming under the door."][Math.min(n, 2)], 5000);
        if (n >= 2) setTimeout(() => this.openMudlog(), 1400);
      }, 1000);
    });
    add(() => S.bop, "BOP stack", 3.6, () => this.openBop());
    add(() => S.coffee, "Coffee", 2.2, () => { if (this.flags.coffeeEmpty) this.radio("earl", "Pot's empty. Somebody's going to have to make coffee."); else { this.gain(0, 3); this.ui.toast("+3 MORALE", "Tastes like diesel."); } });
    const talk = (key: "driller" | "pusher" | "mudeng" | "hand3" | "dd1", who: Who, lines: string[]) => {
      let i = 0;
      add(() => H[key].root.position.add(v3(0, 1.1, 0)), "Talk", 2.4, () => { this.radio(who, lines[i++ % lines.length], 6500); }, () => H[key].root.isEnabled());
    };
    talk("pusher", "earl", ["If it's not on the JSA, we don't do it.", "Your trailer's got the good chair. Don't tell the others.", "Walk the location. Then walk it again."]);
    talk("mudeng", "marcus", ["Mud's looking good. The mud is always looking good until it isn't.", "Delaware's coming up. You'll want ten-nine in the pits before six thousand.", "That's not 'sticky.' That's 'rheology.'"]);
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

  scrData?: ScreenData;
  private cabSel = -1;
  private cabGrid: { cv: HTMLCanvasElement; src: HTMLCanvasElement; kind: string }[] = [];
  /** the main view of a console: the EDR is drawn live at full size, any other screen is the monitor's own picture scaled up to fit */
  private drawMain(rc: HTMLCanvasElement | null, sel: { src: HTMLCanvasElement; kind: string } | undefined) {
    const rx = rc?.getContext("2d"); if (!rc || !rx || !sel) return;
    if (sel.kind === "edr" && this.scrData) { drawEdr(rx, this.scrData, rc.width, rc.height); return; }
    rx.fillStyle = "#06090d"; rx.fillRect(0, 0, rc.width, rc.height);
    const k = Math.min(rc.width / sel.src.width, rc.height / sel.src.height), w = sel.src.width * k, h = sel.src.height * k;
    rx.drawImage(sel.src, (rc.width - w) / 2, (rc.height - h) / 2, w, h);
  }
  /** move between the driller's chair and the directional driller's seat (Tab), with the right console open */
  flipSeat(withPanel = false) {
    if (!this.veh.inChair()) return;
    const toDd = this.veh.isSeated(0);
    this.ui.closePanel(); this.veh.flipSeat();
    if (withPanel) { if (toDd) this.openDdScreens(); else this.openCabin("all"); }
  }
  /** the directional drillers' screens and controls, from either of their seats: mode, toolface, check shots, the plan, surveys and anti-collision */
  openDdScreens() {
    const dd = this.dd;
    const p = this.open(`<div class="eyebrow">Directional Driller</div><h2>Directional Console</h2>
      <div class="cabwide"><div class="cabl">
      <div class="scrgrid" id="ddgrid" style="grid-template-columns:repeat(4,1fr)"></div>
        <div class="recwrap"><canvas id="ddmain" width="960" height="400"></canvas></div>
        <div class="cab-left" style="display:block">
          <div class="row"><span>Inclination</span><b id="d_inc"></b></div>
          <div class="row"><span>Azimuth (last survey)</span><b id="d_azi"></b></div>
          <div class="row"><span>Off the plan</span><b id="d_dev"></b></div>
          <div class="row"><span>Gtotal</span><b id="d_g"></b></div>
          <div class="row"><span>Btotal</span><b id="d_b"></b></div>
          <div class="row"><span>Dip</span><b id="d_dip"></b></div>
          <div class="row"><span id="d_n0"></span><b id="d_sf0"></b></div>
          <div class="row"><span id="d_n1"></span><b id="d_sf1"></b></div>
        </div></div>
        <div class="cab-right">
          <div class="hint">Drilling mode <span style="color:var(--dim)">(keys 1 · 2 · 3)</span></div>
          <div class="btns" style="margin:4px 0 10px"><button class="b" id="dm_rotate">Rotate</button><button class="b" id="dm_slide">Slide</button><button class="b" id="dm_osc">Oscillating slide</button></div>
          <div class="hint">Toolface: set <b id="d_tfs"></b> · actual <b id="d_tfa"></b> <span style="color:var(--dim)">(A / D)</span></div>
          <input type="range" id="dtf" min="0" max="359" step="1" value="${Math.round(dd.tfSet)}"/>
          <div class="btns" style="margin:4px 0"><button class="b alt" data-tf="-15">−15°</button><button class="b alt" data-tf="-5">−5°</button><button class="b alt" data-tf="5">+5°</button><button class="b alt" data-tf="15">+15°</button></div>
          <div class="btns" style="margin:4px 0 10px"><button class="b" data-tfa="0">High side (build)</button><button class="b" data-tfa="90">Right</button><button class="b" data-tfa="180">Low side (drop)</button><button class="b" data-tfa="270">Left</button></div>
          <div class="btns"><button class="b green" id="dcs">Take a check shot</button></div>
          <div class="hint" style="margin-top:6px">A check shot costs two minutes of rig time. The survey is also taken at every connection.</div>
        </div></div>
      <div class="btns"><button class="b alt" id="ddflip">Move to the driller's chair (Tab)</button><button class="b alt" data-close>Close</button></div>`, { wide: true, live: true });
    this.closeBtn(p);
    const q = <T extends HTMLElement>(id: string) => p.querySelector<T>("#" + id)!;
    q("ddflip").onclick = () => this.flipSeat(true);
    let ddSel = 0;
    const grid = q("ddgrid"), list: { cv: HTMLCanvasElement; src: HTMLCanvasElement; kind: string }[] = [];
    for (const m of this.rig.monitors.filter((x) => x.grp === "dd")) { const cv = document.createElement("canvas"); cv.width = 256; { const sc2 = m.tex.getContext().canvas as HTMLCanvasElement; cv.height = Math.round(256 * sc2.height / sc2.width); } cv.style.gridRow = String(m.slot![0] + 1); cv.style.gridColumn = (m.slot![1] + 1) + " / span " + (m.span ?? 1); cv.style.cursor = "pointer"; const idx = list.length; cv.onclick = () => { ddSel = idx; this.sfx.click(); }; grid.appendChild(cv); list.push({ cv, src: m.tex.getContext().canvas as HTMLCanvasElement, kind: m.kind }); }
    q("dm_rotate").onclick = () => dd.setMode("rotate"); q("dm_slide").onclick = () => dd.setMode("slide"); q("dm_osc").onclick = () => dd.setMode("osc");
    q<HTMLInputElement>("dtf").oninput = (ev) => dd.setTf(Number((ev.target as HTMLInputElement).value));
    p.querySelectorAll<HTMLButtonElement>("[data-tf]").forEach((b) => b.onclick = () => { dd.setTf(dd.tfSet + Number(b.dataset.tf)); this.sfx.click(); });
    p.querySelectorAll<HTMLButtonElement>("[data-tfa]").forEach((b) => b.onclick = () => { dd.setTf(Number(b.dataset.tfa)); this.sfx.click(); });
    q("dcs").onclick = () => dd.checkShot();
    (this.ui as any).panelTick = () => {
      list.forEach((g, i) => { g.cv.getContext("2d")?.drawImage(g.src, 0, 0, g.cv.width, g.cv.height); g.cv.style.outline = i === ddSel ? "2px solid #f4c04a" : "none"; });
      this.drawMain(q<HTMLCanvasElement>("ddmain"), list[ddSel]);
      const set = (id: string, v: string, cls = "") => { const e = q(id); e.textContent = v; e.className = cls; };
      const sv = dd.lastSurvey, tp = dd.toPlan;
      for (const m of ["rotate", "slide", "osc"] as const) q("dm_" + m).className = "b" + (dd.mode === m ? " green" : " alt");
      set("d_tfs", Math.round(dd.tfSet) + "°"); set("d_tfa", Math.round(dd.tf) + "°"); q<HTMLInputElement>("dtf").value = String(Math.round(dd.tfSet));
      set("d_inc", dd.inc.toFixed(2) + "°"); set("d_azi", sv.azi.toFixed(1) + "°  (" + Math.round(dd.bit.md - sv.md) + " ft ago)");
      set("d_dev", tp.dist.toFixed(0) + " ft " + (tp.right >= 0 ? "right" : "left") + ", " + Math.abs(tp.high).toFixed(0) + " " + (tp.high >= 0 ? "high" : "low"), tp.dist > 50 ? "bad" : tp.dist > 30 ? "warn" : "ok");
      set("d_g", sv.g.toFixed(1) + " mG", Math.abs(sv.g - 1000) <= 3 ? "ok" : "bad"); set("d_b", Math.round(sv.b).toLocaleString("en-US") + " nT", Math.abs(sv.b - 48000) <= 150 ? "ok" : "bad"); set("d_dip", sv.dip.toFixed(2) + "°", Math.abs(sv.dip - 59.4) <= 0.5 ? "ok" : "bad");
      dd.acNow.forEach((a, i) => { q("d_n" + i).textContent = "SF to " + OFFSETS[i].name; set("d_sf" + i, a.sf.toFixed(2) + "  (" + Math.round(a.ctc) + " ft)", a.sf < 1 ? "bad" : a.sf < 1.5 ? "warn" : "ok"); });
    };
  }
  openCabin(view: "all" | "params" | "trends" | "pits" | "alarms" = "all") {
    // the chair and the console are the same thing: opening the console sits you in the driller's chair
    if (!this.astMode && !this.veh.isSeated(0) && !this.veh.riding) this.veh.sit(0);
    const s = this.sim.s;
    const render = () => {
      const k = s.kick, a = s.auto;
      const busy = s.mode === "tripping" || s.mode === "casing";
      return `<div class="eyebrow">Driller's Cabin</div><h2>${{ all: "Driller's Console", params: "Drilling screen", trends: "Trends screen", pits: "Pits screen", alarms: "Alarms & well control" }[view]}</h2>
        <div class="cabwide"><div class="cabl">
        <div class="scrgrid" id="scrgrid"></div>
        ${view === "pits" || view === "alarms" ? "" : `<div class="recwrap"><canvas id="rec" width="960" height="460"></canvas></div>`}
          <div class="cab-left">
            <div class="row"><span>Depth</span><b id="c_depth"></b></div><div class="row"><span>Formation</span><b id="c_form"></b></div>
            <div class="row"><span>ROP</span><b id="c_rop"></b></div><div class="row"><span>Diff pressure</span><b id="c_dp"></b></div><div class="row"><span>Surface torque</span><b id="c_tq"></b></div>
            <div class="row"><span>Bit health</span><b id="c_bit"></b></div><div class="row"><span>Motor life</span><b id="c_motor"></b></div><div class="row"><span>Standpipe pressure</span><b id="c_spp"></b></div>
            <div class="row"><span>Mud weight</span><b id="c_mw"></b></div><div class="row"><span>Pit volume</span><b id="c_pit"></b></div>
            <div class="row"><span>Mode</span><b id="c_mode"></b></div>
          </div></div>
          <div class="cab-right">
            <div class="autobox cab-auto">
              <div class="row"><span>AUTODRILLER</span><b id="a_state" class="warn">${a.on ? "ON" : "OFF"}</b></div>
              <div style="position:relative;height:28px;margin-top:6px"><div style="position:absolute;left:38.5%;top:0;transform:translateX(-50%);display:flex;gap:3px"><button class="b alt" style="padding:2px 9px" data-ast="wob" data-d="1" title="WOB set point up">▲</button><button class="b alt" style="padding:2px 9px" data-ast="wob" data-d="-1" title="WOB set point down">▼</button></div><div style="position:absolute;left:15.4%;top:0;transform:translateX(-50%);display:flex;gap:3px"><button class="b alt" style="padding:2px 9px" data-ast="rop" data-d="1" title="ROP set point up">▲</button><button class="b alt" style="padding:2px 9px" data-ast="rop" data-d="-1" title="ROP set point down">▼</button></div><div style="position:absolute;left:61.5%;top:0;transform:translateX(-50%);display:flex;gap:3px"><button class="b alt" style="padding:2px 9px" data-ast="dp" data-d="1" title="DIFF set point up">▲</button><button class="b alt" style="padding:2px 9px" data-ast="dp" data-d="-1" title="DIFF set point down">▼</button></div><div style="position:absolute;left:84.6%;top:0;transform:translateX(-50%);display:flex;gap:3px"><button class="b alt" style="padding:2px 9px" data-ast="tq" data-d="1" title="TQ set point up">▲</button><button class="b alt" style="padding:2px 9px" data-ast="tq" data-d="-1" title="TQ set point down">▼</button></div></div>
              <canvas id="abars" width="480" height="260" style="width:100%;display:block;margin:4px 0 6px;background:#06090d;border:2px solid #000;border-radius:6px"></canvas>
              <div class="hint">Set points: WOB (klb) · ROP (ft/hr) · DIFF (psi, motor stalls at 2,100) · TQ (ft-lb, string twists off at 16,500)</div>
              <div class="hint" id="a_lim" style="min-height:18px"></div>
              <div class="btns"><button class="b ${a.on ? "red" : "green"}" id="a_toggle">${a.on ? "Disengage" : "Engage autodriller"}</button></div>
            </div>
            <div class="cab-manual"><div class="hint" style="margin-top:8px">Manual WOB: <b id="wv">${s.wobTarget}</b> klbs ${a.on ? "(autodriller in control)" : ""}</div>
            <input type="range" id="wob" min="0" max="60" step="1" value="${s.wobTarget}" ${busy || a.on ? "disabled" : ""}/>
            <div class="btns" style="margin:6px 0"><button class="b alt" id="wobDn" ${busy || a.on ? "disabled" : ""}>WOB ↓</button><button class="b" id="wobUp" ${busy || a.on ? "disabled" : ""}>WOB ↑</button></div>
            <div class="row" style="margin-top:6px"><span>LCM in system</span><b id="c_lcm"></b></div>
            <div class="btns" style="margin:4px 0"><button class="b alt" id="c_sweep">Send LCM sweep ($5,000)</button></div>
            <div class="hint" style="margin-top:6px">Pump rate: <b id="fv">${s.flowTarget}</b> gpm</div>
            <input type="range" id="flow" min="400" max="1000" step="50" value="${s.flowTarget}"/></div>
          </div>
        </div>
        <div class="btns" id="cbtn"></div>`;
    };
    const p = this.open(render(), { wide: true, live: true });
    const bind = () => {
      const q = <T extends HTMLElement>(id: string) => p.querySelector<T>("#" + id)!;
      { const grid = p.querySelector<HTMLElement>("#scrgrid"); this.cabGrid = [];
        if (grid) for (const m of this.rig.monitors.filter((x) => x.grp === "drill")) { const cv = document.createElement("canvas"); cv.width = 256; { const sc2 = m.tex.getContext().canvas as HTMLCanvasElement; cv.height = Math.round(256 * sc2.height / sc2.width); } cv.style.gridRow = String(m.slot![0] + 1); cv.style.gridColumn = (m.slot![1] + 1) + " / span " + (m.span ?? 1); cv.style.cursor = "pointer"; const idx = this.cabGrid.length; cv.onclick = () => { this.cabSel = idx; this.sfx.click(); }; grid.appendChild(cv); this.cabGrid.push({ cv, src: m.tex.getContext().canvas as HTMLCanvasElement, kind: m.kind }); }
        if (this.cabSel < 0 || this.cabSel >= this.cabGrid.length) this.cabSel = Math.max(0, this.cabGrid.findIndex((g) => g.kind === "edr")); }
      const sl = (id: string, out: string, apply: (v: number) => void) => { const el = q<HTMLInputElement>(id); el.oninput = () => { apply(Number(el.value)); q(out).textContent = el.value; }; };
      sl("wob", "wv", (v) => { s.wobTarget = v; });
      sl("flow", "fv", (v) => { s.flowTarget = v; });
      // autodriller set points: an up and a down arrow over each bar (hold to repeat)
      const SPEC: Record<string, { lo: number; hi: number; step: number; get: () => number; put: (v: number) => void }> = {
        wob: { lo: 5, hi: 60, step: 1, get: () => s.auto.wob, put: (v) => { s.auto.wob = v; } },
        rop: { lo: 40, hi: 380, step: 10, get: () => s.auto.rop, put: (v) => { s.auto.rop = v; } },
        dp: { lo: 300, hi: 2400, step: 50, get: () => s.auto.dp, put: (v) => { s.auto.dp = v; } },
        tq: { lo: 3000, hi: 20000, step: 250, get: () => s.auto.torque ?? 10000, put: (v) => { s.auto.torque = v; } },
      };
      p.querySelectorAll<HTMLButtonElement>("[data-ast]").forEach((btn) => {
        const sp = SPEC[btn.dataset.ast!], dir = Number(btn.dataset.d); let to = 0, iv = 0;
        const step = () => sp.put(Math.max(sp.lo, Math.min(sp.hi, sp.get() + dir * sp.step)));
        const stop = () => { clearTimeout(to); clearInterval(iv); };
        btn.addEventListener("pointerdown", (ev) => { ev.preventDefault(); step(); this.sfx.click(); to = window.setTimeout(() => { iv = window.setInterval(step, 70); }, 350); });
        for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, stop);
      });
      // WOB arrows, as on the original console: one klb a press, and hold to repeat after 0.3 s at 20 per second
      const holdBtn = (id: string, dir: number) => {
        const b = q<HTMLButtonElement>(id); let to = 0, iv = 0;
        const step = () => { if (s.mode === "tripping" || s.mode === "casing" || s.auto.on) return; s.wobTarget = Math.max(0, Math.min(80, Math.round(s.wobTarget) + dir)); q<HTMLInputElement>("wob").value = String(s.wobTarget); q("wv").textContent = String(s.wobTarget); };
        const stop = () => { clearTimeout(to); clearInterval(iv); };
        b.addEventListener("pointerdown", (ev) => { ev.preventDefault(); step(); to = window.setTimeout(() => { iv = window.setInterval(step, 50); }, 300); });
        for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, stop);
      };
      holdBtn("wobUp", 1); holdBtn("wobDn", -1);
      q<HTMLInputElement>("wob").onchange = () => { if (s.wobTarget > 40) this.radio("dale", "Forty-plus by hand? Your funeral, boss. Bit's gonna scream.", 6000); };
      q("c_sweep").onclick = () => { const r = this.sim.sweep(); if (r) { this.ui.toast("NO SWEEP", r); return; } this.sfx.click(); this.ui.toast("LCM SWEEP AWAY", "A 30 lb/bbl pill is going down the pipe. It will fade as it circulates out."); this.radio("marcus", "The pill is pumped. Watch the pits and the returns.", 6000); };
      q("a_toggle").onclick = () => {
        const a = s.auto;
        if (a.on) { a.on = false; this.sfx.click(); this.radio("dale", "Autodriller off. I've got the brake.", 4000); this.rerenderCabin(p, render, bind); return; }
        const notes: string[] = [];
        if (a.dp > STALL_DP - 150) notes.push("A diff limit that close to the motor's stall pressure (" + fmt(STALL_DP) + " psi) won't save the motor. That's not a limit, that's a suggestion.");
        if (a.rop < 100) notes.push("That ROP limit is going to strangle us. We'll crawl.");
        if ((a.torque ?? 10000) > TORQUE_MAX) notes.push("A torque limit over 16,500 won't save the string. It'll twist off first.");
        if (a.wob > 45) notes.push("Forty-five klbs on a bit that size is a lot of weight for not much hole.");
        a.on = true; this.sfx.good();
        this.radio("dale", notes.length ? notes[0] : "Autodriller's in. Set points look sane — nice.", 8000);
        if (!notes.length) this.gain(0.15, 0);
        this.rerenderCabin(p, render, bind);
      };
      const btns: string[] = [];
      if (s.kick.active && !s.kick.shut) btns.push(`<button class="b red" data-a="shut">SHUT IN THE WELL</button>`);
      if (s.kill.stage === "flowcheck") btns.push(`<button class="b green" data-a="open">Flow check OK — open BOP & resume</button>`);
      if ((s.mode === "drilling" || s.mode === "connection") && !s.kick.active) btns.push(`<button class="b alt" data-a="trip">Trip for a new bit</button>`);
      if (s.depth >= WELL.td - 0.5 && s.mode === "idle") btns.push(`<button class="b green" data-a="casing">Run 9⅝″ casing & cement</button>`);
      if (!this.astMode) btns.push(`<button class="b alt" data-a="flip">Move to the DD seat (Tab)</button>`);
      btns.push(`<button class="b alt" data-close>Close</button>`);
      const box = q("cbtn"); box.innerHTML = btns.join("");
      this.closeBtn(p);
      box.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => b.onclick = () => this.cabinAction(b.dataset.a!));
    };
    bind();
    let sig0 = "";
    const mirror = view === "all" ? null : this.rig.monitors.find((m) => m.cabin && m.kind === view);
    (this.ui as any).panelTick = () => {
      { const ac = p.querySelector<HTMLCanvasElement>("#abars"); if (ac) { const a = s.auto; drawAutoBars(ac.getContext("2d")!, ac.width, ac.height, { on: a.on, limit: a.limit, rop: s.rop, wob: s.wob, dp: s.dp, tq: s.torque, sp: { rop: a.rop, wob: a.wob, dp: a.dp, tq: a.torque ?? 10000 } }); } }
      this.cabGrid.forEach((g, i) => { g.cv.getContext("2d")?.drawImage(g.src, 0, 0, g.cv.width, g.cv.height); g.cv.style.outline = i === this.cabSel ? "2px solid #f4c04a" : "none"; });
      this.drawMain(p.querySelector<HTMLCanvasElement>("#rec"), this.cabGrid[this.cabSel]);
      { const cv = p.querySelector<HTMLCanvasElement>("#tvmirror"); const src = mirror?.tex.getContext().canvas as HTMLCanvasElement | undefined; if (cv && src) cv.getContext("2d")?.drawImage(src, 0, 0, cv.width, cv.height); }
      const sig = s.mode + s.kick.active + s.kick.shut + s.kill.stage + (s.depth >= WELL.td) + s.auto.on;
      if (sig !== sig0) { sig0 = sig; this.rerenderCabin(p, render, bind); }
      const set = (id: string, v: string, cls = "") => { const e = p.querySelector<HTMLElement>("#" + id); if (e) { e.textContent = v; if (cls !== undefined) e.className = cls; } };
      set("c_depth", fmt(s.depth) + " ft" + (s.mode === "tripping" ? "  ·  bit at " + fmt(this.sim.bitDepth) + " ft" : "")); set("c_form", formationAt(s.depth).name); set("c_rop", fmt(s.rop) + " ft/hr");
      set("c_dp", fmt(s.dp) + " psi" + (s.stallT > 0 ? " · STALLED" : ""), s.dp > STALL_DP * 0.9 || s.stallT > 0 ? "bad" : "");
      set("c_tq", fmt(s.torque) + " ft-lb", s.torque > TORQUE_MAX * 0.9 ? "bad" : "");
      set("c_bit", Math.round(s.bit) + "%", s.bit < 25 ? "bad" : ""); set("c_lcm", s.lcm.toFixed(0) + " lb/bbl", s.lcm > 5 ? "ok" : ""); set("c_motor", Math.round(s.motor) + "%", s.motor < 30 ? "bad" : s.motor < 60 ? "warn" : ""); set("c_spp", fmt(s.spp) + " psi"); set("c_mw", s.mw.toFixed(2) + " ppg");
      set("c_pit", fmt(s.pit) + " bbl", s.kick.active ? "bad" : ""); set("c_mode", s.mode.toUpperCase());
      const lim = p.querySelector<HTMLElement>("#a_lim");
      if (lim) lim.innerHTML = s.auto.on ? `Holding <b>${s.wobTarget.toFixed(1)}</b> klbs — limited by <b class="${s.auto.limit === "WOB" ? "ok" : "warn"}">${s.auto.limit === "WOB" ? "your WOB set point" : s.auto.limit === "ROP" ? "the ROP limit" : s.auto.limit === "TORQUE" ? "the torque limit" : "the diff-pressure limit"}</b>` : "";
    };
  }
  private rerenderCabin(p: HTMLElement, render: () => string, bind: () => void) {
    const ky = p.scrollTop; p.innerHTML = render(); bind(); p.scrollTop = ky;
  }
  cabinAction(a: string) {
    if (a === "flip") { this.flipSeat(true); return; }
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
  /** every line anyone has said, newest at the bottom, in case you missed one */
  openLog() {
    if (!this.started || this.ui.panelOpen) return;
    const rows = this.ui.log.map((l) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div style="font-size:11px;color:#9fb4c8;letter-spacing:.6px">${l.time} · <b style="color:var(--gold)">${l.name}</b></div><div>${l.text}</div></div>`).join("");
    const p = this.open(`<div class="eyebrow">Radio &amp; Chat</div><h2>Message Log</h2><div id="logbox" style="max-height:58vh;overflow-y:auto;margin:10px 0;padding-right:8px">${rows || '<p class="hint">Nobody has said anything yet.</p>'}</div><div class="btns"><button class="b alt" data-close>Close</button></div>`);
    this.closeBtn(p);
    const box = p.querySelector<HTMLElement>("#logbox"); if (box) box.scrollTop = box.scrollHeight;
  }
  openFrac() {
    const s = this.sim.s;
    const xfer = (n: number) => {
      const room = 900 - s.pit, amt = Math.max(0, Math.min(n, s.fracBbl, room));
      if (amt <= 0) { this.ui.toast(s.fracBbl <= 0 ? "FRAC TANKS EMPTY" : "PITS FULL", s.fracBbl <= 0 ? "Order more water at the frac tanks" : "Nothing more fits"); return; }
      s.fracBbl -= amt; s.pit += amt; s.cost += amt * 8; this.sfx.good();
      this.ui.toast("+" + Math.round(amt) + " BBL", "Transferred to the active pits");
      this.openFrac();
    };
    this.inspect("Frac Tanks", [["Frac tank volume", fmt(s.fracBbl) + " bbl", s.fracBbl < 150 ? "bad" : "ok"], ["Active pits", fmt(s.pit) + " bbl", s.pit < 150 ? "bad" : "ok"], ["Pits can hold", "about 900 bbl"]],
      `<p class="hint">Losses, trips and kills draw the pits down and nothing refills them by itself. Below about 120 bbl the pumps lose suction and drilling stops.</p>`,
      [{ label: "Transfer 100 bbl", cls: "green", run: () => xfer(100) }, { label: "Transfer 300 bbl", run: () => xfer(300) },
       { label: "Order 500 bbl of water ($4k)", cls: "alt", run: () => { s.fracBbl += 500; this.sim.addCost(4000); this.sfx.good(); this.ui.toast("WATER ORDERED", "A truck tops up the frac tanks: +500 bbl"); this.radio("brent", "Water hauler says he will fill the frac tanks. For a price. It is on the AFE.", 7000); this.openFrac(); } }]);
  }
  /** a pallet of mud product (from the yard) was set down: near the hopper it counts as delivered */
  mudPalletSet(x: number, z: number) {
    if (Math.hypot(x - 25, z + 21.5) < 4.5) {
      this.flags.mudPallets = ((this.flags.mudPallets as number) || 0) + 1;
      this.ui.toast("PALLET DELIVERED", "Mud products at the hopper: " + this.flags.mudPallets); this.gain(0.1, 2); this.sfx.good();
    }
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
    this.mini.holdFill({ eyebrow: "Mud Hopper", title: "Barite Feed", intro: `Raise the system by +${d.toFixed(2)} ppg. Hold the feed, release on the mark.`, unit: "ppg", max: d * 2.2, target: d, band: Math.max(0.05, d * 0.12), rate: 0.35, hold: "HOLD TO FEED" }, (r) => {
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

  /** the hydraulic catwalk: the ground station and the rig-floor remote are the same controls */
  openCatwalk(remote: boolean) {
    const c = this.rig.catwalk;
    const status = () => `Joint: <b>${{ idle: "none on the trough", kicking: "rolling in…", loaded: "loaded, ready to push", pushing: "riding up the ramp…" }[c.phase]}</b> · Delivered to the floor: <b>${c.delivered}</b>`;
    const p = this.open(`<div class="eyebrow">${remote ? "Rig floor remote" : "Catwalk · ground station"}</div><h2>HYDRAULIC CATWALK</h2>
      <p>The kick arm rolls a joint from the rack onto the trough. The pusher drives it up the ramp to the V-door. ${remote ? "You're on the floor with the remote, so you can run it without a hand on the ground." : "You're on the ground at the station; the remote on the rig floor does the same thing."}</p>
      <p id="cwStatus" class="hint">${status()}</p>
      <div class="btns"><button class="b" data-a="kick">1 · ROLL A JOINT ONTO THE TROUGH</button><button class="b green" data-a="push">2 · PUSH TO THE V-DOOR</button></div>
      <div class="btns"><button class="b alt" data-close>Close</button></div>`, { live: true });
    this.closeBtn(p);
    const say = (m: string | null) => { if (m) this.ui.toast("CATWALK", m); };
    p.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => b.onclick = () => {
      this.sfx.click();
      const a = b.dataset.a;
      if (a === "kick") say(c.kick()); else if (a === "push") say(c.push());
    });
    (this.ui as any).panelTick = () => { const e = p.querySelector<HTMLElement>("#cwStatus"); if (e) e.innerHTML = status(); };
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
    starT.uScale = 2; starT.vScale = 1; starT.wrapU = 1; starT.wrapV = 1;   // repeat (dynamic textures clamp by default, which left the second half of the sky empty)
    this.sky = { sun, sunMat, moon, glow, stars, starMat };
  }
  private updateSky(hour: number, night: number) {
    const k = this.sky; if (!k) return;
    const a = ((hour - 6.5) / 13.25) * Math.PI, d = new Vector3(Math.cos(a) * 0.8, Math.sin(a) * 0.95, 0.45).normalize();
    k.sun.position.copyFrom(d.scale(1000)); k.moon.position.copyFrom(d.scale(-1000));
    const dk = this.asteroidT >= 0 ? Math.min(1, this.asteroidT / 6) : 0;
    k.sun.setEnabled(!this.astMode && d.y > -0.1 && dk < 0.5); k.moon.setEnabled(!this.astMode && d.y < 0.1);
    k.sunMat.emissiveColor = Color3.Lerp(new Color3(1, 0.55, 0.28), new Color3(1, 1, 0.92), clamp(d.y * 3.2, 0, 1));
    k.starMat.alpha = this.astMode ? 1 : Math.max(clamp(night * 1.1 - 0.1, 0, 1), dk);
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
        approval: this.approval, morale: this.morale, incidents: this.incidents, flags, depthLog: this.depthLog, done: [...this.doneIds], realT: this.realT, fishing: this.outskirts.fishSave(),
        ppe: p.body.ppe.length ? p.body.ppe[0].isEnabled(false) : false, pos: onFoot ? [p.pos.x, p.pos.y, p.pos.z, p.yaw] : null }));
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
      this.outskirts.fishLoad(d.fishing); this.outskirts.afterLoad();
      this.doneIds = new Set<string>(d.done ?? []); this.depthLog = d.depthLog ?? [];
      this.queue = this.allMissions.filter((m) => !this.doneIds.has(m.id));
      this.missionNo = this.doneIds.size;
      this.rig.setWindmill(!this.doneIds.has("windmill"));
      this.player.body.setPPE(!!d.ppe || this.doneIds.has("ppe"));   // finishing the gate sign-in always means you have your PPE
      if (d.pos) {
        // drove (or wandered) way off the lease? Continue at the gate instead of out in the desert
        const far = Math.hypot(d.pos[0], d.pos[2] - 40) > 260;
        if (far) this.player.teleport(0, 0.5, 112, Math.PI); else this.player.teleport(d.pos[0], d.pos[1], d.pos[2], d.pos[3]);
      }
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
  /** interns stand on whatever is under them (they used to copy the player's height along the trail, which left them hovering when they cut a corner) */
  private internGround(p: Vector3, dt: number) {
    const g = this.player.support(p.x, p.z, p.y);
    if (g < p.y) p.y = Math.max(g, p.y - 14 * dt); else p.y += (g - p.y) * Math.min(1, dt * 10);
  }
  despawnInterns() { this.interns.forEach((h) => h.root.dispose()); this.interns = []; }
  spawnSnake() {
    const m = new StandardMaterial("snk", this.scene); m.diffuseColor = Color3.FromHexString("#7a6a3a");
    const root = MeshBuilder.CreateBox("snake", { width: 0.05, height: 0.05, depth: 0.05 }, this.scene); root.isVisible = false;
    for (let i = 0; i < 7; i++) { const sgm = MeshBuilder.CreateSphere("ss", { diameter: 0.14 - i * 0.008, segments: 4 }, this.scene); sgm.material = m; sgm.parent = root; sgm.position.set(Math.sin(i * 1.1) * 0.25 + i * 0.06, 0.07, i * 0.2 - 0.6); }
    root.position.set(-4.0, F, -3.7); this.snake = root;
  }
  despawnSnake() { this.snake?.dispose(); this.snake = null; }
  /** the asteroid hangs in the sky: a jagged, faceted rock with glowing cracks, and a long fiery tail streaming away behind it. It does not move. */
  asteroidTail: { mesh: Mesh; base: Vector3 }[] = [];
  asteroidPS: ParticleSystem | null = null;
  /** remove the sky asteroid and its tail */
  clearAsteroid() { this.asteroidT = -1; if (this.asteroid) { this.asteroid.dispose(); this.asteroid = null; } this.asteroidTail.forEach((tl) => tl.mesh.dispose()); this.asteroidTail = []; if (this.asteroidPS) { this.asteroidPS.dispose(); this.asteroidPS = null; } }
  spawnAsteroid() {
    const a = MeshBuilder.CreateIcoSphere("asteroid", { radius: 80, subdivisions: 4, flat: true, updatable: true }, this.scene);
    // lumpy, sharp shape: displace every vertex by a smooth function of its direction (so shared corners move together), then flat-shade it
    const pos = a.getVerticesData(VertexBuffer.PositionKind)!, idx = a.getIndices()!;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2], l = Math.hypot(x, y, z) || 1, nx = x / l, ny = y / l, nz = z / l;
      const n = 0.30 * Math.sin(nx * 5.1 + 1.3) * Math.cos(ny * 4.3 + 0.7) + 0.22 * Math.sin(nz * 7.7 + nx * 3.1) + 0.14 * Math.sin(nx * 13 + ny * 11 + nz * 9) + 0.07 * Math.sin(ny * 23 + nz * 19);
      const k = (1 + n) * (Math.abs(n) > 0.28 ? 1.12 : 1);
      pos[i] = nx * 80 * k * 1.1; pos[i + 1] = ny * 80 * k * 0.88; pos[i + 2] = nz * 80 * k;
    }
    a.updateVerticesData(VertexBuffer.PositionKind, pos);
    const nrm: number[] = []; VertexData.ComputeNormals(pos, idx, nrm); a.updateVerticesData(VertexBuffer.NormalKind, nrm);
    const m = new StandardMaterial("ast", this.scene); m.diffuseColor = Color3.FromHexString("#3b3029"); m.emissiveColor = Color3.FromHexString("#5a1e0a"); m.specularColor = new Color3(0.08, 0.06, 0.05);
    a.material = m; a.position.set(120, 420, -500); a.rotation.set(0.4, 0.8, 0.2); this.asteroid = a; this.asteroidT = 0; a.isPickable = false;
    // the tail: a long streak across the sky, built from tapered segments that fade out (additive, so it glows), plus a stream of embers
    const dir = new Vector3(0.85, 0.42, -0.3).normalize(), q = new Quaternion(); Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, q);
    this.asteroidTail = [];
    const N = 16, SEG = 120, lerpC = (u: number) => u < 0.35 ? Color3.Lerp(Color3.FromHexString("#fff0c0"), Color3.FromHexString("#ff8a2a"), u / 0.35) : Color3.Lerp(Color3.FromHexString("#ff8a2a"), Color3.FromHexString("#7a1a08"), (u - 0.35) / 0.65);
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 1) / N, w0 = 130 * Math.pow(1 - u0, 1.15) + 4, w1 = 130 * Math.pow(1 - u1, 1.15) + 4;
      const c = MeshBuilder.CreateCylinder("asttail", { diameterTop: w1, diameterBottom: w0, height: SEG * 1.05, tessellation: 12 }, this.scene);
      const cm = new StandardMaterial("asttailm", this.scene); cm.disableLighting = true; cm.emissiveColor = lerpC(u0).scale(0.9); cm.alpha = 0.24 * Math.pow(1 - u0, 1.6) + 0.015; cm.alphaMode = 1; cm.backFaceCulling = false; cm.disableDepthWrite = true; cm.fogEnabled = false;
      c.material = cm; c.isPickable = false; c.alwaysSelectAsActiveMesh = true;
      c.rotationQuaternion = q.clone(); c.position.copyFrom(a.position).addInPlace(dir.scale(60 + i * SEG + SEG / 2)); c.setParent(null);
      this.asteroidTail.push({ mesh: c, base: new Vector3(1, 1, 1) });
    }
    const pt = new DynamicTexture("emberT", { width: 64, height: 64 }, this.scene, false); { const c = pt.getContext() as CanvasRenderingContext2D; const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,240,200,1)"); g.addColorStop(0.35, "rgba(255,140,40,0.6)"); g.addColorStop(1, "rgba(255,60,10,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); pt.update(); pt.hasAlpha = true; }
    const ps = new ParticleSystem("comet", 900, this.scene); ps.particleTexture = pt; ps.emitter = a.position.clone();
    ps.minEmitBox = new Vector3(-50, -30, -50); ps.maxEmitBox = new Vector3(50, 30, 50);
    ps.direction1 = dir.add(new Vector3(-0.1, -0.1, -0.1)); ps.direction2 = dir.add(new Vector3(0.1, 0.1, 0.1));
    ps.minEmitPower = 260; ps.maxEmitPower = 460; ps.minLifeTime = 1.4; ps.maxLifeTime = 3.6; ps.emitRate = 220; ps.minSize = 26; ps.maxSize = 90;
    ps.color1 = new Color4(1, 0.8, 0.4, 0.85); ps.color2 = new Color4(1, 0.4, 0.1, 0.6); ps.colorDead = new Color4(0.25, 0.04, 0, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ONEONE; ps.gravity = Vector3.Zero(); ps.start(); this.asteroidPS = ps;
  }
  // ---------- ARMAGEDDON (finale, from the original "Roll Coal Make Hole") ----------
  arm = {
    site: null as Vector3 | null, console: v3(4000, 1.4, 4006), depth: 0, wob: 22, bit: 100, bombed: false, said: new Set<number>(), pauseT: 0,
    rig: null as any, pipe: null as Mesh | null, flash: 0,
  };
  armFormation(d: number) {
    return d < 150 ? { name: "Asteroid Crust", hard: 7, abr: 0.25 } : d < 560 ? { name: "Solid Iron Plate", hard: 12, abr: 0.55 } : { name: "Vibranium", hard: 15, abr: 1.0 };
  }
  buildAsteroidSite(ox = 4000, oz = 4000) {
    if (this.arm.site) return;
    const sc = this.scene;
    this.arm.site = v3(ox, 0, oz);
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
    // the driller's station: a desk, a chair and three live monitors (the same EDR, autodriller and parameters screens as the main rig)
    const desk = MeshBuilder.CreateBox("acon", { width: 4.2, height: 1.0, depth: 1.1 }, sc); desk.material = steel; desk.position.set(ox + 4, 0.75, oz + 3);
    this.colliders.push({ x0: ox + 1.9, x1: ox + 6.1, y0: 0.5, y1: 1.5, z0: oz + 2.4, z1: oz + 3.6 });
    const chair = MeshBuilder.CreateBox("achair", { width: 0.8, height: 0.9, depth: 0.8 }, sc); chair.material = orange; chair.position.set(ox + 4, 0.95, oz + 4.3);
    this.astScreens = new Screens(sc);
    (["params", "edr", "auto"] as const).forEach((k, i) => {
      const tex = this.astScreens!.make(k as any, false, [640, 400]);
      const m = new StandardMaterial("astscr" + i, sc); m.emissiveTexture = tex; m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black(); m.backFaceCulling = false;
      const pl = MeshBuilder.CreatePlane("ascr" + i, { width: 1.5, height: 0.94 }, sc); pl.material = m; pl.position.set(ox + 2.3 + i * 1.75, 2.0, oz + 2.62); pl.rotation.y = Math.PI;
      const fr = MeshBuilder.CreateBox("asfr" + i, { width: 1.62, height: 1.06, depth: 0.08 }, sc); fr.material = steel; fr.position.set(ox + 2.3 + i * 1.75, 2.0, oz + 2.54);
    });
    this.arm.console = v3(ox + 4, 1.8, oz + 4.6);
  }
  astScreens: Screens | null = null;
  armCrew: Human[] = [];
  finale!: Finale;
  colliders: import("./builder").AABB[] = [];
  callUp(done: () => void) { this.finale.launch(done); }
  /** (the old instant jump to the asteroid, no longer used) */
  private oldCallUp(done: () => void) {
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
      this.asteroidT = -1; if (this.asteroid) { this.asteroid.dispose(); this.asteroid = null; } this.asteroidTail.forEach((tl) => tl.mesh.dispose()); this.asteroidTail = [];
      this.astMode = true;
      this.sim.s.paused = true;
      $("fade").style.opacity = "0"; this.player.enabled = true; this.player.lock();
      this.ui.toast("ARMAGEDDON", "Low gravity. High stakes. Eight hundred feet.");
      this.radio("harry", "Alright, Company Man. You're the driller now. Get in that seat.", 8000);
      done();
    }, 1800);
  }
  astMode = false;
  /** the asteroid console is the real driller's console on the real well engine, just with a different hole */
  openArm() {
    if (!this.sim.astMode) { this.sim.beginAsteroid(); this.flags.armDrilling = true; this.stormT = 30; this.radio("harry", "That's it, A.J. Same as any hole. Crust first, then iron. Watch your diff pressure and your torque, and don't cook the bit. Eight hundred feet.", 11000); }
    this.openCabin("all");
  }
  stormT = 30;
  armUpdate(dt: number) {
    const a = this.arm, s = this.sim.s;
    if (!this.astMode) return;
    if (this.astScreens && this.scrData && a.site && Math.hypot(this.player.pos.x - a.console.x, this.player.pos.z - a.console.z) < 40) this.astScreens.update(this.scrData);
    if (!this.sim.astMode) return;
    a.depth = s.depth;
    if (a.bombed || this.flags.armTD) return;
    if (s.depth >= 560 && !this.flags.armGas) { this.flags.armGas = true; this.finale.gasPocket(); }
    if (s.depth >= 799.5 && !this.flags.armTD) { this.flags.armTD = true; this.ui.closePanel(); this.finale.detonatorFails(); return; }
    for (const d of [50, 100, 150, 250, 300, 400, 460, 500, 600, 625, 750, 790]) {
      if (s.depth >= d && !a.said.has(d)) { a.said.add(d); this.armSpeech(d); }
    }
    // the storm keeps throwing rock at the site
    this.stormT -= dt;
    if (this.stormT <= 0 && s.mode === "drilling") { this.stormT = 26 + Math.random() * 20; this.finale.debrisHit(); }
    if (a.pipe && a.site) { a.pipe.scaling.y = 20 + a.depth * 0.02; a.pipe.position.y = 10 - a.depth * 0.005; }
  }
  armSpeech(d: number) {
    const L: Record<number, [Who, string, number?]> = {
      50: ["harry", "That's the crust, A.J. Soft. Watch your diff pressure up here, it climbs fast in soft rock."],
      100: ["harry", "You're drilling like you've been doing it thirty years, son."],
      150: ["harry", "Solid iron now. Weight's harder to get, ROP's slower. Don't cook the bit."],
      250: ["nasa", "Harry, the debris field is getting thicker on your side of the rock. Keep it moving."],
      300: ["harry", "Halfway to the vein, kid. Keep an eye on your torque."],
      400: ["harry", "Iron-nickel vein coming up. It'll fight you. Ease the weight and let her cut."],
      460: ["harry", "Through the vein. Good hands, A.J."],
      500: ["harry", "I've drilled holes in the earth for thirty years. This is the best one yet."],
      600: ["harry", "Vibranium. Don't ask. It's hard, it's slow, and it's the last hundred feet that count."],
      625: ["harry", "I have never, NEVER missed a depth that I have aimed for. And by God, I am not gonna miss this one. We will make 800 feet.", 11000],
      750: ["nasa", "Fifty feet to go, Harry. The storm is almost on top of you. Hurry."],
      790: ["harry", "Ten more feet, A.J. Hold her steady. Hold her steady…"],
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
    void setupBoard({ score, grade, depth: s.stats.feetDrilled, hours: Math.floor(hours), cost: s.cost, approval: this.approval, incidents: this.incidents });
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
      const held = this.sim.s.depth > 8000 && !this.flags.chainDone;   // close to TD: the remaining jobs start straight away instead of waiting on their timers
      if (head && (head.trigger() || held)) { this.queue.splice(this.queue.indexOf(head), 1); this.beginMission(head); }
      else if (this.stack.length) this.nextFromStack();
    }
    const a = this.active;
    if (a) {
      const st = a.m.steps[a.i];
      if (st.watch && st.watch()) this.stepDone();
    }
    // release the hold chain: once all scripted jobs before the finale are done
    if (this.sim.s.depth > 8000 && !this.flags.chainDone && !this.queue.some((m) => !m.priority && m.id !== "armageddon") && !this.active) { this.flags.chainDone = true; this.holdPending = false; }
    // hold the bit off bottom while the cast of characters is still queued
    if (this.sim.s.depth > 8000 && !this.flags.chainDone && !this.flags.nearTD) { this.flags.nearTD = true; this.radio("dale", "Two hundred feet to TD, boss. Keep drilling. Wrap up whatever's on your plate and the finale starts when you're clear.", 11000); }
    if (this.sim.hold === 8300) this.sim.hold = null;   // saves from the old version came back stuck at 8,300 ft
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
    if (this.astMode && this.sim.astMode && s.mode !== "tripping") return 6;   // the asteroid hole goes at a finale pace
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
        case "dpSpike": if (this.realT - ((this.flags.lastSpikeT as number) || -99) > 5) { this.flags.lastSpikeT = this.realT; this.ui.toast("DIFF PRESSURE SPIKE!", "Reduce WOB"); this.sfx.bad(); } break;
        case "pitLow": this.radio("dale", "Pits are nearly dry, boss. Pumps are sucking air. I can't drill like this. Somebody run a transfer from the frac tanks behind the pits.", 12000); this.wake("PITS LOW"); break;
        case "autoShutIn": this.radio("dale", "I shut it in myself. Late. Got a bigger gain than I'd like.", 9000); this.inc(1); break;
        case "lossStart": this.radio("marcus", "We're losing returns! Pits are dropping — you're over frac. Back off the mud weight or pump LCM.", 10000); this.wake("LOSSES"); break;
        case "lossHealed": this.radio("marcus", "Losses healed. Pits are stable.", 6000); break;
        case "motorDead": this.radio("dale", "Motor's gone, boss. No more differential pressure, no more ROP. We have to trip for a new one.", 10000); this.wake("MOTOR DEAD"); break;
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
          this.internGround(p, realDt); h.animate(realDt, sp);
        } else { h.animate(realDt, 0); this.internGround(p, realDt); }
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
    this.armUpdate(realDt); this.armCrew.forEach((h) => h.animate(realDt, this.finale.harryRunning && h === this.finale.harryHuman ? 8 : 0)); this.finale.update(realDt);
    if (this.asteroid) {
      this.asteroidT += realDt;                                            // (the rock itself stays put: only the tail flickers)
      this.asteroidTail.forEach((tl, i) => { const f = 1 + Math.sin(this.asteroidT * (3.1 + i * 0.9) + i) * 0.08 + (Math.random() - 0.5) * 0.05; tl.mesh.scaling.set(f, 1, f); });
    }
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
    const dark = this.asteroidT >= 0 ? Math.min(1, this.asteroidT / 6) : 0;     // the asteroid is in the sky: the day goes dark
    if (dark > 0) col = Color3.Lerp(col, new Color3(0.012, 0.01, 0.022), dark);
    if (this.astMode) { col = new Color3(0.008, 0.007, 0.018); }
    this.scene.clearColor.set(col.r, col.g, col.b, 1);
    this.scene.fogColor = col.clone();
    this.env.hemi.intensity = this.astMode ? 0.32 : (0.5 + 0.4 * day) * (1 - 0.45 * dark);
    this.env.sun.intensity = this.astMode ? 1.15 : (0.2 + 1.05 * day) * (1 - 0.7 * dark);
    const az = (hour - 6.5) / 13.25 * Math.PI;
    const ex = Math.cos(az), ey = Math.max(0.12, elev);
    this.env.sun.direction.set(-ex * 0.8, -ey, -0.45);
    if (this.astMode) this.env.sun.direction.set(-0.55, -0.4, -0.65);
    (this.env.sun as any).__night = night;
    this.nightFactor = night;
    this.updateSky(hour, night);
  }
  nightFactor = 0;

  updateHud(dt: number) {
    const s = this.sim.s, c = clockString(s.t);
    const k = s.kick;
    const items = [
      { k: "Day " + c.day, v: c.hhmm }, { k: s.mode === "tripping" ? "Bit depth" : "Depth", v: fmt(this.sim.bitDepth) + " ft" }, { k: "ROP", v: fmt(s.rop) }, { k: "WOB", v: String(Math.round(s.wob)) },
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
    else if (s.pit < 120 && (s.mode === "drilling" || s.mode === "connection")) alert = "PITS RUN DRY — DRILLING STOPPED · TRANSFER FROM THE FRAC TANKS";
    else if (this.active?.m.id === "armageddon" && this.active.i === 0 && s.mode === "drilling" && s.wobTarget <= 0 && !s.auto.on && s.depth < WELL.td - 1) alert = "NO WEIGHT ON BIT — SET IT AT THE DRILLER'S CONSOLE (OR ENGAGE THE AUTODRILLER)";
    this.ui.setAlert(alert);
    this.sfx.alarmTick(dt, !!(k.active && !k.shut) || s.fuel <= 0);

    // nearest interactable
    const p = this.player, eye = p.eyePos(), fwd = p.third ? new Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)) : p.lookDir();
    const stepPos = this.active ? this.active.m.steps[this.active.i] : null;
    const cand: { it: Interactable; score: number }[] = [];
    const consider = (it: Interactable) => {
      if (it.ok && !it.ok()) return;
      const pos = it.pos(), d3 = pos.subtract(eye), dist = d3.length();
      // anything inside a room can only be used from inside that same room
      { const rm = this.roomAt(pos.x, pos.y, pos.z); if (rm && rm !== this.roomAt(p.pos.x, p.pos.y + 0.3, p.pos.z, 0.45)) return; }
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
    // nothing can be used through a wall: take the closest candidate that has a clear line from the eyes
    const seated = this.veh.inChair(), pool = this.veh.riding ? (seated ? cand.filter((c) => c.it.tv) : []) : cand;
    const clear = this.ui.panelOpen || !this.started || this.paused ? undefined : pool.find((c) => !this.blockedLOS(eye, c.it.pos()));
    this.nearest = clear?.it ?? null;
    this.ui.setPrompt(this.veh.riding && !this.ui.panelOpen && this.started && !this.paused && !(seated && this.nearest) ? this.veh.promptLabel() : this.nearest ? this.nearest.label() : null);

    // task arrows: one per open task (the active job plus any jobs it interrupted)
    const PAL = ["#f4c04a", "#4aa3e8", "#e5483b", "#3dbb6a", "#c77dff"];
    const markers: { title: string; pos: Vector3; color: string; primary: boolean }[] = [];
    const addM = (m: Mission, i: number, primary: boolean, ci: number) => {
      const at = m.steps[i]?.at?.();
      if (at) markers.push({ title: m.title, pos: at, color: PAL[ci % PAL.length], primary });
    };
    if (this.active) addM(this.active.m, this.active.i, true, 0);
    for (let j = this.stack.length - 1, c = 1; j >= 0; j--, c++) addM(this.stack[j].m, this.stack[j].i, false, c);
    // trouble that is not a job still points at where to go: low diesel, a dead bit, dry pits, a flat accumulator, lost returns
    {
      const sp = this.rig.spots, st = this.sim.s, ALERT = "#ff6a3d";
      const alert = (title: string, at: Vector3 | undefined) => { if (at) markers.push({ title, pos: at, color: ALERT, primary: false }); };
      if (st.fuel < 1200) alert(st.fuel <= 0 ? "OUT OF DIESEL" : "LOW DIESEL", sp.fuel);
      if (st.needTrip) alert("BIT DEAD: TRIP OUT", sp.cabin);
      if (st.pit < 150) alert("PITS LOW: FRAC TANKS", sp.frac);
      if (this.sim.accumDead || st.accum < 1200) alert("ACCUMULATOR", sp.accumulator);
      if (st.loss.active) alert("LOSSES: LCM AT THE HOPPER", sp.hopper);
    }
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

    if (!this.active && this.started && !this.astMode && !this.flags.finish) this.ui.tickIdleObjective(this.sim.s.depth > 8000 && !this.flags.chainDone ? `Drill to TD, and finish the open jobs (${this.queue.filter((m) => !m.priority && m.id !== "armageddon").length} left)` : `Drill to TD: ${fmt(this.sim.s.depth)} / 8,500 ft`);
    // roofs vanish while you are inside the room under them
    { const pp = p.pos; for (const r of this.rig.roofs) { const inside = pp.x > r.x0 && pp.x < r.x1 && pp.z > r.z0 && pp.z < r.z1 && pp.y > r.y0 && pp.y < r.y1; if (inside === r.mesh.isEnabled()) r.mesh.setEnabled(!inside); } }
    // casing and cement: show live progress, since there is nothing to click while it runs
    if (this.sim.s.mode === "casing" && this.started && !this.flags.finish) {
      const cs = this.sim.s.casing; this.ui.setSub((cs.phase === "run" ? "Running casing: " : "Pumping cement: ") + Math.round(cs.progress * 100) + "%");
    }
    // the White House call: the phone keeps ringing (and Earl keeps nagging) until it is answered
    if (this.flags.ringing && this.started && !this.ui.panelOpen) {
      this.flags.ringT = ((this.flags.ringT as number) || 0) + dt;
      const rt = this.flags.ringT as number, last = (this.flags.ringLast as number) ?? 0;
      if (rt - last >= 4) { this.flags.ringLast = rt; this.sfx.radio(); }
      if (rt > 25 && !this.flags.ringNag) { this.flags.ringNag = true; this.radio("earl", "Boss. Your phone. It has been ringing for a while. Go and answer it.", 9000); }
    }
    // district banner
    const d = this.district();
    if (d !== this.lastDistrict) { this.lastDistrict = d; this.ui.setDistrict(d); }
    {   // third-person-aim style reticle: a dot at screen centre that eases onto whatever you can use, and opens into a gold ring while it is locked on
      const ch = $("crosshair"), live = this.started && !this.ui.panelOpen && !this.paused && (!this.veh.riding || this.veh.inChair());
      ch.style.display = live ? "block" : "none";
      if (live) {
        const eng = this.scene.getEngine(), cam = this.player.cam, W = document.documentElement.clientWidth || 1, Hh = document.documentElement.clientHeight || 1;
        let tx = W / 2, ty = Hh / 2, lock = false;
        if (this.nearest) {
          const wp = this.nearest.pos();
          const sp = Vector3.Project(wp, Matrix.Identity(), this.scene.getTransformMatrix(), new Viewport(0, 0, eng.getRenderWidth(), eng.getRenderHeight()));
          const k = eng.getRenderWidth() / W, px = sp.x / k, py = sp.y / k;
          if (Vector3.Dot(wp.subtract(cam.position), cam.getForwardRay().direction) > 0 && px > 40 && px < W - 40 && py > 40 && py < Hh - 40) { tx = px; ty = py; lock = true; }
        }
        const f = Math.min(1, dt * 16); this.chX += (tx - this.chX) * f; this.chY += (ty - this.chY) * f;
        ch.style.left = this.chX + "px"; ch.style.top = this.chY + "px"; ch.classList.toggle("lock", lock);
      }
    }
    { // the corner: time of day and cost
      { const day = clockString(this.sim.s.t).day, d = Math.max(0, day - ((this.flags.lastIncDay as number | undefined) ?? -141)); if (d !== this.hudDays) { this.hudDays = d; this.rig.setDaysSince(d); } }
      { const s = this.sim.s, days = s.t / 1440, drilled = s.stats.feetDrilled, fmt0 = (n: number) => Math.round(n).toLocaleString("en-US");
        const dep = fmt0(s.depth) + " ft", dy = "Day " + (Math.floor(days) + 1) + (days > 0.05 && drilled > 1 ? "  ·  " + fmt0(drilled / days) + " ft/day" : ""), cf = "$" + fmt0(s.cost) + "  ·  $" + fmt0(s.cost / Math.max(1, s.depth)) + "/ft";
        const key = dep + dy + cf; if (key !== this.hudWell) { this.hudWell = key; $("ws_depth").textContent = dep; $("ws_days").textContent = dy; $("ws_cost").textContent = cf; } }
      const cs = "$" + Math.round(this.sim.s.cost).toLocaleString("en-US"); if (cs !== this.hudCost) { this.hudCost = cs; $("cost").textContent = cs; }
      const ck = clockString(this.sim.s.t).hhmm; if (ck !== this.hudClock) { this.hudClock = ck; $("clock").textContent = ck; }
    }
    if (this.started && !this.paused && !this.astMode) this.outskirts.update(Math.min(dt, 0.1));
    { const ev = this.rig.catwalk.takeEvent(); if (ev === "loaded") this.ui.toast("CATWALK", "Joint on the trough."); else if (ev === "delivered") { this.sfx.good(); this.ui.toast("JOINT ON THE FLOOR", "Right at the V-door. The floor hands thank you."); } }
    this.player.bound = this.astMode || this.finale.mode !== "off" ? null : 585;   // the cliffs ring the world
  }

  private beams: Mesh[] = [];
  /** Tall translucent light beam over each task target so you can spot it across the pad. */
  /** true when a solid wall-sized collider sits between the eyes and a spot (colliders that contain either end are ignored: you stand beside things, and spots sit on them) */
  roomAt(x: number, y: number, z: number, pad = 0) {
    for (const r of this.rig.roofs) if (x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad && y > r.y0 && y < r.y1 - 0.5) return r;
    return null;
  }
  blockedLOS(a: Vector3, b: Vector3): boolean {
    const d = b.subtract(a), len = d.length(); if (len < 0.5) return false;
    const n = Math.max(2, Math.ceil(len / 0.3)), E = 0.5;
    const cols = this.player.colliders;
    for (let i = 1; i < n; i++) {
      const t = i / n, x = a.x + d.x * t, y = a.y + d.y * t, z = a.z + d.z * t;
      if (len * (1 - t) < 0.6) break;                                   // the last bit before the spot is the spot's own surroundings
      for (const c of cols) {
        if (c.y1 - c.y0 < 1.0 || y < c.y0 || y > c.y1) continue;
        if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) continue;
        if (b.x > c.x0 - E && b.x < c.x1 + E && b.z > c.z0 - E && b.z < c.z1 + E && b.y > c.y0 - E && b.y < c.y1 + E) continue;   // target is on / in this object
        if (a.x > c.x0 && a.x < c.x1 && a.z > c.z0 && a.z < c.z1) continue;                                                      // we are inside it
        return true;
      }
    }
    return false;
  }

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
    if (x < -16 && x > -58 && z > 15 && z < 60) return "Camp";
    if (x > -1 && x < 32 && z < -54) return "Frac Tanks & Mud Yard";
    if (x > 38 && z < -20) return "Water Tanks";
    if (z < -17 && z > -28 && x > -19 && x < 20) return "Mud Tanks";
    if (x > 10 && x < 52 && z > -9 && z < 8.5) return "Power House";
    if (x > 8 && x < 23 && z < -9 && z > -16) return "Pump Room";
    if (x > -13 && x < -3 && z < -9 && z > -16) return "Choke Manifold";
    if (x < -16 && x > -36 && Math.abs(z) < 12) return "Pipe Racks";
    if (z < -17) return "Backyard";
    return "Location";
  }

  interact(fromMouse = false) {
    if (this.started && !this.paused && !this.ui.panelOpen && this.veh.riding) {
      if (this.veh.inChair()) { if (fromMouse) { if (this.nearest?.tv) { this.sfx.click(); this.nearest.act(); } } else this.veh.leave(); return; }
      if (!fromMouse) this.veh.leave();
      return;
    }
    if (!this.started || this.paused || this.ui.panelOpen || !this.nearest) return;
    this.sfx.click(); this.onInteract(); this.nearest.act();
  }
}
