import { MeshBuilder, StandardMaterial, Color3, Vector3, Mesh, TransformNode, Quaternion } from "@babylonjs/core";
import { Human } from "./npcs";
import { $ } from "./ui";

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);

/**
 * The finale, played as A.J.: the shuttle launches off the helipad, the debris field brings it down short of the site, you take the
 * Armadillo across the asteroid (a long ramp and a canyon you have to jump on thrusters), drill 800 ft at Harry's site, and when the
 * remote detonator is smashed Harry takes your place. Everything lives around the asteroid origin O.
 */
export class Finale {
  private g: any;
  private O = { x: 4000, z: 4000 };
  // course, in metres along +z from the crash site
  private readonly RAMP0 = 232; private readonly GAP0 = 260; private readonly GAP1 = 370; private readonly SITE_Z = 600;
  private readonly RAMP_H = 3.4;
  built = false; arrived = false; drawDone = false;
  mode: "off" | "launch" | "walk" | "drive" | "site" = "off";
  armPos = v3(4000, 1.2, 4018);
  private arm!: TransformNode; private wheels: TransformNode[] = []; private thrustFlames: Mesh[] = [];
  private d = { x: 0, z: 0, y: 0, yaw: 0, speed: 0, vy: 0, fuel: 1, thrusting: false, onRamp: false };
  private keys = new Set<string>();
  private hud: HTMLDivElement;
  private shakeAmt = 0;
  private sparks: Mesh[] = [];
  private freedom: TransformNode | null = null; private freedomUp = false; private freedomV = 0;
  private harry: Human | null = null; private harryFlung = 0;
  private lastDrive = 0;
  earth: Mesh | null = null;

  constructor(g: any) {
    this.g = g;
    window.addEventListener("keydown", (e) => { this.keys.add(e.code); if (this.mode === "drive" && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault(); });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    this.hud = document.createElement("div");
    this.hud.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:30;display:none;min-width:340px;padding:10px 16px;background:rgba(10,16,24,.84);border:2px solid #f4c04a;color:#fff;font:700 13px/1.5 system-ui,sans-serif;letter-spacing:.5px;text-align:center;pointer-events:none";
    document.body.appendChild(this.hud);
  }

  // ------------------------------------------------------------------------------------------------ the pad and the launch
  /** the shuttle comes down on the helipad and waits */
  callShuttle() {
    const st = this.g.rig.shuttleState;
    if (st.phase !== "hidden") return;
    st.node.setEnabled(true); st.node.position.set(63, 130, 57.5); st.node.rotation.set(0, 0, 0); st.v = 0; st.t = 0; st.phase = "landing";
    this.g.sfx.horn();
    this.g.radio("nasa", "The shuttle is on its way down to your pad, Company Man. It'll take you up to meet the others.", 9000);
  }

  /** boarding: the launch is seen from the ground, then the debris field takes the shuttle down and you wake up on the surface */
  launch(done: () => void) {
    const g = this.g, st = g.rig.shuttleState;
    if (st.phase !== "landed") { g.ui.toast("HOLD ON", "The shuttle is still landing"); return; }
    this.mode = "launch"; g.player.enabled = false; g.player.unlock();
    g.player.ride = true; g.player.third = false; g.player.body.root.setEnabled(false);
    g.player.teleport(34, 0.5, 52, Math.atan2(63 - 34, 57.5 - 52)); g.player.pitch = -0.1;
    g.sfx.horn(); g.ui.toast("T-MINUS ZERO", "Main engine start");
    g.radio("nasa", "T-minus ten. Nine. Eight… We have main engine start. And liftoff of the shuttle Independence!", 7000);
    setTimeout(() => { st.phase = "launching"; st.v = 0; st.t = 0; this.shakeAmt = 0.35; g.sfx.thud(); }, 2500);
    // while it climbs the pad shakes; the view follows it up
    const follow = setInterval(() => { if (this.mode !== "launch") { clearInterval(follow); return; } const y = st.node.position.y; g.player.pitch = Math.max(-1.25, -Math.atan2(Math.max(0, y - 2), 30) * 0.9); this.shakeAmt = Math.max(0.05, 0.35 - y * 0.001); }, 50);
    setTimeout(() => g.radio("nasa", "Passing the speed of sound… Independence and Freedom are go for the slingshot around the Moon.", 7000), 9000);
    setTimeout(() => { $("fade").style.transition = "opacity 1.4s"; $("fade").style.background = "#000"; $("fade").style.opacity = "1"; }, 12500);
    setTimeout(() => { clearInterval(follow); this.arrive(done); }, 14500);
  }

  // ------------------------------------------------------------------------------------------------ the surface
  private arrive(done: () => void) {
    const g = this.g;
    this.build();
    this.mode = "walk"; this.shakeAmt = 0;
    g.rig.shuttleState.phase = "hidden"; g.rig.shuttleState.node.setEnabled(false);
    g.astMode = true; g.sim.s.paused = true; g.rig.humans.vp.root.setEnabled(false);
    g.player.ride = false; g.player.body.root.setEnabled(true); g.player.body.setSuit(true);
    g.player.teleport(this.O.x - 8, 0.6, this.O.z - 6, Math.PI * 0.25); g.player.third = true; g.player.gScale = 0.35; g.player.pitch = 0.12;
    g.player.colliders.push(...g.colliders);
    g.scene.fogDensity = 0.0006;
    $("fade").style.background = "#000"; $("fade").style.opacity = "0"; g.player.enabled = true; g.player.lock();
    g.ui.toast("THE DEBRIS FIELD", "Independence is down, miles short of the target");
    g.radio("nasa", "Independence, Independence, do you copy? You came down twenty-six miles from the site. We've lost the others.", 9000);
    setTimeout(() => g.radio("bear", "A.J., we're alive. Me, you, and Lev. The Armadillo made it. It's right there in the wreck.", 9000), 5000);
    setTimeout(() => g.radio("lev", "Is good. Is very good. Is only a little on fire.", 8000), 13000);
    setTimeout(() => g.radio("harry", "A.J., it's iron under us, not ferrite. My rig's cooked. You've got the other Armadillo. Get over here, son.", 10000), 22000);
    done();
  }

  build() {
    if (this.built) return; this.built = true;
    const g = this.g, sc = g.scene, { x: ox, z: oz } = this.O;
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const mat = (hex: string, em?: string) => { const m = new StandardMaterial("fm", sc); m.diffuseColor = Color3.FromHexString(hex); m.specularColor = new Color3(0.05, 0.05, 0.05); if (em) m.emissiveColor = Color3.FromHexString(em); return m; };
    const rock = mat("#4a4540"), dark = mat("#26221f"), lava = mat("#000000", "#ff4a10"); lava.disableLighting = true;
    // two slabs of asteroid with the canyon between them (box tops are the ground; the sides are the canyon walls)
    const slab = (z0: number, z1: number, name: string) => { const b = MeshBuilder.CreateBox(name, { width: 900, height: 60, depth: z1 - z0 }, sc); b.material = rock; b.position.set(ox, -30, oz + (z0 + z1) / 2); b.freezeWorldMatrix(); b.isPickable = false; return b; };
    slab(-350, this.GAP0, "astA"); slab(this.GAP1, 900, "astB");
    const chasm = MeshBuilder.CreateGround("chasm", { width: 900, height: this.GAP1 - this.GAP0 }, sc); chasm.material = lava; chasm.position.set(ox, -52, oz + (this.GAP0 + this.GAP1) / 2); chasm.isPickable = false;
    // a long launch ramp at the lip of the canyon
    const rl = this.GAP0 - this.RAMP0, ang = Math.atan2(this.RAMP_H, rl), rlen = Math.hypot(rl, this.RAMP_H);
    const ramp = MeshBuilder.CreateBox("ramp", { width: 26, height: 1.2, depth: rlen }, sc); ramp.material = mat("#5a544c");
    ramp.rotation.x = -ang; ramp.position.set(ox, this.RAMP_H / 2 - 0.55, oz + this.RAMP0 + rl / 2 + 0.1); ramp.freezeWorldMatrix();
    for (const s of [-1, 1]) { const rail = MeshBuilder.CreateBox("rrail", { width: 0.8, height: 0.9, depth: rlen }, sc); rail.material = mat("#e8b923"); rail.rotation.x = -ang; rail.position.set(ox + s * 12.5, this.RAMP_H / 2 + 0.1, oz + this.RAMP0 + rl / 2); rail.freezeWorldMatrix(); }
    const sign = MeshBuilder.CreatePlane("rsign", { width: 14, height: 3 }, sc); sign.position.set(ox, 8, oz + this.GAP0 - 8); sign.material = mat("#000000", "#ff7a1a");
    // scattered boulders (kept off the driving line)
    for (let i = 0; i < 160; i++) {
      const zz = -300 + rnd() * 1100, xx = (rnd() - 0.5) * 760; if (Math.abs(xx) < 20 || (zz > this.GAP0 - 20 && zz < this.GAP1 + 8)) continue;
      const s = 1.5 + rnd() * 9, b = MeshBuilder.CreatePolyhedron("boulder", { type: (rnd() * 6) | 0, size: s }, sc); b.material = rnd() < 0.15 ? dark : rock;
      b.position.set(ox + xx, s * 0.4, oz + zz); b.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); b.freezeWorldMatrix(); b.isPickable = false;
      if (Math.abs(xx) > 25) g.colliders.push({ x0: ox + xx - s * 0.7, x1: ox + xx + s * 0.7, y0: 0, y1: s * 0.9, z0: oz + zz - s * 0.7, z1: oz + zz + s * 0.7 });
    }
    // Earth in the sky, small and blue, with the sun behind us
    const earth = MeshBuilder.CreateSphere("earth", { diameter: 220, segments: 24 }, sc); const em = new StandardMaterial("earthm", sc);
    em.emissiveColor = new Color3(0.14, 0.34, 0.8); em.diffuseColor = Color3.Black(); em.disableLighting = true; earth.material = em; earth.position.set(-520, 360, 640); earth.infiniteDistance = true; earth.isPickable = false; earth.alwaysSelectAsActiveMesh = true; this.earth = earth;
    const cl = MeshBuilder.CreateSphere("earthc", { diameter: 224, segments: 12 }, sc); const cm = new StandardMaterial("earthcm", sc); cm.emissiveColor = new Color3(0.9, 0.95, 1); cm.diffuseColor = Color3.Black(); cm.alpha = 0.22; cm.disableLighting = true; cl.material = cm; cl.parent = earth; cl.isPickable = false;
    g.colliders.push({ x0: ox - 460, x1: ox + 460, y0: -5, y1: 40, z0: oz + this.GAP0, z1: oz + this.GAP1 });   // nobody walks into the canyon
    this.buildWreck(mat);
    this.buildArmadillo(mat);
    // Harry's site, past the canyon, with the Freedom standing next to it
    g.buildAsteroidSite(ox, oz + this.SITE_Z);
    g.arm.console = v3(ox + 4, 1.8, oz + this.SITE_Z + 4.6);
    const fr = g.rig.shuttleState.node.clone("freedom", null)!; fr.setEnabled(true); fr.position.set(ox + 34, 0.2, oz + this.SITE_Z - 12); fr.rotation.set(0, 0, 0); this.freedom = fr;
    const hh = new Human(sc, { shirt: "#e07010", pants: "#d0d0d0", hat: null, skin: "#d9a77f", scale: 1.04 });
    hh.root.position.set(ox + 2.5, 0.5, oz + this.SITE_Z + 5.5); hh.root.rotation.y = Math.PI; g.armCrew.push(hh); this.harry = hh;
    for (const h of g.armCrew as Human[]) h.setSuit(true);
  }

  private buildWreck(mat: (hex: string, em?: string) => StandardMaterial) {
    const g = this.g, sc = g.scene, { x: ox, z: oz } = this.O;
    const hull = mat("#d8dbe0"), burnt = mat("#2a2623"), fire = mat("#000000", "#ff6a1a"); fire.disableLighting = true;
    const bit = (m: StandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => { const b = MeshBuilder.CreateBox("wreck", { width: w, height: h, depth: d }, sc); b.material = m; b.position.set(ox + x, y, oz + z); b.rotation.set(rx, ry, rz); b.isPickable = false; return b; };
    const fus = MeshBuilder.CreateCylinder("wfus", { diameter: 5, height: 16, tessellation: 14 }, sc); fus.material = hull; fus.rotation.z = Math.PI / 2 - 0.25; fus.rotation.y = 0.4; fus.position.set(ox - 10, 2.6, oz - 14); fus.isPickable = false;
    bit(burnt, 4.2, 4.2, 6, -3, 1.4, -17, 0.2, 0.3, 0.1); bit(hull, 9, 0.4, 5, -13, 3.5, -9, 0.3, 0.6, 0.35); bit(hull, 7, 0.4, 4, -9, 1.2, -22, -0.2, 0.2, -0.3); bit(burnt, 0.5, 6, 3, -17, 3.4, -18, 0, 0, 0.5); bit(hull, 2.5, 2, 2.5, 2, 0.8, -10, 0.4, 0.5, 0.2);
    this.sparks = [];
    for (const [x, z] of [[-6, -12], [-14, -16], [-3, -16], [-9, -8]]) { const f = MeshBuilder.CreateBox("wfire", { width: 1.4, height: 2.2, depth: 1.4 }, sc); f.material = fire; f.position.set(ox + x, 1.4, oz + z); f.isPickable = false; this.sparks.push(f); }
    g.colliders.push({ x0: ox - 18, x1: ox - 2, y0: 0, y1: 5, z0: oz - 24, z1: oz - 6 });
    // Bear and Lev, in suits, standing by the Armadillo
    for (const [who, x, z] of [["bear", 4, 8], ["lev", -4, 10]] as [string, number, number][]) {
      const h = new Human(sc, { shirt: who === "bear" ? "#c4561a" : "#2a4a7a", pants: "#d0d0d0", hat: null, skin: "#d9a77f", vest: false, scale: who === "bear" ? 1.06 : 0.98 }); h.setSuit(true);
      h.root.position.set(ox + x, 0.5, oz + z); h.root.rotation.y = Math.PI * 0.8; (g.armCrew as Human[]).push(h);
    }
  }

  /** the Armadillo: a six-wheeled armoured drill truck with a derrick on the back and thruster rockets under the tail (forward is +z) */
  private buildArmadillo(mat: (hex: string, em?: string) => StandardMaterial) {
    const g = this.g, sc = g.scene, { x: ox, z: oz } = this.O;
    const root = new TransformNode("armadillo", sc); this.arm = root;
    const W = mat("#e9edf1"), O = mat("#e07010"), K = mat("#202428"), S = mat("#8a9099");
    const gl = new StandardMaterial("armglass", sc); gl.diffuseColor = new Color3(0.55, 0.75, 0.9); gl.alpha = 0.45; gl.specularColor = new Color3(1, 1, 1);
    const hl = mat("#000000", "#fff3c0"); hl.disableLighting = true;
    const box = (m: StandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => { const b = MeshBuilder.CreateBox("arm", { width: w, height: h, depth: d }, sc); b.material = m; b.parent = root; b.position.set(x, y, z); b.rotation.x = rx; b.isPickable = false; return b; };
    const cyl = (m: StandardMaterial, dia: number, h: number, x: number, y: number, z: number, ax: "x" | "y" | "z" = "y", dTop?: number) => { const c = MeshBuilder.CreateCylinder("arm", { diameterTop: dTop ?? dia, diameterBottom: dia, height: h, tessellation: 16 }, sc); c.material = m; c.parent = root; c.position.set(x, y, z); if (ax === "x") c.rotation.z = Math.PI / 2; if (ax === "z") c.rotation.x = Math.PI / 2; c.isPickable = false; return c; };
    box(W, 3.4, 1.3, 7, 0, 1.55, -0.3); box(O, 3.42, 0.25, 7.02, 0, 1.15, -0.3);                      // hull and its orange belt
    box(W, 2.9, 0.8, 1.8, 0, 1.45, 3.9, 0.12);                                                         // sloped nose
    box(gl, 2.6, 1.1, 2.6, 0, 2.75, 1.7); box(K, 2.8, 0.12, 2.8, 0, 3.35, 1.7);                       // cab and roof
    for (const s of [-1, 1]) { box(K, 0.1, 1.2, 0.1, s * 1.3, 2.75, 0.45); box(K, 0.1, 1.2, 0.1, s * 1.3, 2.75, 2.95); }
    for (const s of [-1, 1]) { const l = MeshBuilder.CreateBox("armhl", { width: 0.5, height: 0.25, depth: 0.1 }, sc); l.material = hl; l.parent = root; l.position.set(s * 1.0, 1.7, 4.75); }
    for (const s of [-1, 1]) for (const z of [-0.05, 0]) void z;
    // derrick on the back: four legs, a crown, and a drill pipe down the middle
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const b = MeshBuilder.CreateCylinder("armleg", { diameter: 0.18, height: 8.4, tessellation: 6 }, sc); b.material = O; b.parent = root; b.position.set(sx * 0.7, 6.2, -2.4 + sz * 0.7); b.isPickable = false; }
    box(O, 1.9, 0.5, 1.9, 0, 10.4, -2.4); cyl(S, 0.28, 8.5, 0, 6.3, -2.4);
    // six wheels
    this.wheels = [];
    for (const sx of [-1, 1]) for (const z of [3.1, 0.2, -2.9]) {
      const w = new TransformNode("armwheel", sc); w.parent = root; w.position.set(sx * 2.05, 0.8, z);
      const tire = MeshBuilder.CreateCylinder("armtire", { diameter: 1.6, height: 0.8, tessellation: 18 }, sc); tire.material = K; tire.rotation.z = Math.PI / 2; tire.parent = w; tire.isPickable = false;
      const hub = MeshBuilder.CreateCylinder("armhub", { diameter: 0.7, height: 0.85, tessellation: 10 }, sc); hub.material = S; hub.rotation.z = Math.PI / 2; hub.parent = w; hub.isPickable = false;
      this.wheels.push(w);
    }
    // thruster rockets under the tail, with flames that light up when you fire them
    this.thrustFlames = [];
    for (const s of [-1, 1]) {
      cyl(K, 0.9, 1.3, s * 1.0, 1.4, -4.1, "z", 0.5);
      const f = MeshBuilder.CreateCylinder("armflame", { diameterTop: 0.8, diameterBottom: 0.1, height: 1, tessellation: 10 }, sc);
      const fm = new StandardMaterial("armfm", sc); fm.disableLighting = true; fm.emissiveColor = new Color3(1, 0.65, 0.2); fm.alpha = 0.9; fm.backFaceCulling = false; fm.fogEnabled = false;
      f.material = fm; f.parent = root; f.rotation.x = Math.PI / 2; f.position.set(s * 1.0, 1.4, -4.8); f.scaling.set(1, 0.0001, 1); f.isPickable = false; this.thrustFlames.push(f);
    }
    root.position.set(ox + 6, 0, oz + 16); root.rotation.y = Math.PI * 0.1;
    this.armPos = v3(ox + 6, 1.4, oz + 16);
    g.colliders.push({ x0: ox + 3.5, x1: ox + 8.5, y0: 0, y1: 3.4, z0: oz + 11, z1: oz + 21 });
  }

  // ------------------------------------------------------------------------------------------------ driving
  private groundY(zr: number): number {
    if (zr < this.RAMP0) return 0;
    if (zr < this.GAP0) return ((zr - this.RAMP0) / (this.GAP0 - this.RAMP0)) * this.RAMP_H;
    if (zr < this.GAP1) return -100;
    return 0;
  }
  startDrive() {
    const g = this.g, d = this.d;
    g.player.enabled = false; g.player.ride = true; g.player.third = false; g.player.body.root.setEnabled(false); g.player.unlock();
    d.x = this.arm.position.x - this.O.x; d.z = this.arm.position.z - this.O.z; d.y = 0; d.yaw = 0; d.speed = 0; d.vy = 0; d.fuel = 1; d.thrusting = false; d.onRamp = false;
    this.mode = "drive"; this.hud.style.display = "block"; g.player.lock();
    g.ui.toast("ARMADILLO", "W gas · A/D steer · hold SPACE for thrusters in the air");
    g.radio("bear", "Floor it, A.J. There's a canyon up ahead. Hit the ramp fast and light the thrusters!", 9000);
    g.radio("lev", "In Russia, canyon jumps YOU.", 7000);
  }

  private driveStep(dt: number) {
    const g = this.g, d = this.d, k = this.keys;
    const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const steer = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const gy = this.groundY(d.z), grounded = d.y <= gy + 0.04 && d.vy <= 0.5 && gy > -50;
    d.thrusting = false;
    if (grounded) {
      d.y = gy;
      if (fwd > 0) d.speed += 20 * dt; else if (fwd < 0) d.speed -= (d.speed > 0 ? 34 : 14) * dt; else d.speed *= Math.exp(-0.6 * dt);
      d.speed = Math.max(-9, Math.min(44, d.speed));
      d.yaw += steer * (0.95 - Math.min(0.6, Math.abs(d.speed) / 60)) * dt * (d.speed >= 0 ? 1 : -1) * Math.min(1, Math.abs(d.speed) / 3);
      d.fuel = Math.min(1, d.fuel + 0.6 * dt); d.vy = 0;
    } else {
      d.vy -= 9 * dt;
      if (k.has("Space") && d.fuel > 0) { d.vy += 13 * dt; d.fuel = Math.max(0, d.fuel - dt / 1.6); d.thrusting = true; }
      d.yaw += steer * 0.35 * dt;
    }
    // leaving the end of the ramp: the slope sets the climb
    const nx = d.x + Math.sin(d.yaw) * d.speed * dt, nz = d.z + Math.cos(d.yaw) * d.speed * dt, ngy = this.groundY(nz);
    if (grounded && d.z >= this.RAMP0 && ngy < d.y - 0.3) { d.vy = Math.max(0, d.speed) * (this.RAMP_H / (this.GAP0 - this.RAMP0)); }
    const prevY = d.y;
    d.x = Math.max(-320, Math.min(320, nx)); d.z = nz; d.y += d.vy * dt;
    const g2 = this.groundY(d.z);
    if (g2 > -50 && d.y <= g2 && d.vy <= 0) {
      if (prevY >= g2 - 0.15) { if (d.vy < -13) { g.ui.toast("HARD LANDING", "The Armadillo takes a beating"); this.shakeAmt = 0.4; } d.y = g2; d.vy = 0; }
      else { d.y = -47; this.shakeAmt = 0.6; }                                   // came in below the lip: that is the canyon wall
    }
    if (d.y < -46) {
      g.ui.toast("INTO THE CANYON", "Back to the start of the run-up. Hit it faster and use the thrusters.");
      g.radio("bear", "We didn't make it. Okay. Okay. Back up and go again, A.J.", 7000);
      d.x = 0; d.z = 20; d.y = 0; d.speed = 0; d.vy = 0; d.yaw = 0; d.fuel = 1; this.shakeAmt = 0.5;
    }
    if (d.z > this.GAP1 && d.vy === 0 && !this.flags_cleared) { this.flags_cleared = true; g.ui.toast("YOU MADE IT", "Across the canyon!"); g.radio("bear", "YEAH! A.J.! That's how you do it!", 7000); g.radio("harry", "I see you, kid! Bring it in!", 7000); }
    this.arm.position.set(this.O.x + d.x, d.y, this.O.z + d.z); this.arm.rotation.y = d.yaw; this.arm.rotation.x = Math.max(-0.5, Math.min(0.5, -d.vy * 0.03));
    const spin = d.speed * dt / 0.8; this.wheels.forEach((w) => { w.rotation.x += spin; });
    this.thrustFlames.forEach((f) => { const L = d.thrusting ? 3.2 + Math.random() * 1.2 : 0.0001; f.scaling.set(1, L, 1); f.position.z = -4.4 - L / 2; });
    // arrival at Harry's site
    if (d.z >= this.SITE_Z - 24 && d.y <= 0.05) this.stopDrive();
    this.lastDrive = d.speed;
  }
  private flags_cleared = false;

  private stopDrive() {
    const g = this.g;
    this.mode = "site"; this.arrived = true; this.hud.style.display = "none";
    this.arm.position.set(this.O.x + 8, 0, this.O.z + this.SITE_Z - 16); this.arm.rotation.set(0, Math.PI * 0.2, 0);
    g.player.ride = false; g.player.body.root.setEnabled(true); g.player.third = true; g.player.enabled = true;
    g.player.teleport(this.O.x + 2, 0.6, this.O.z + this.SITE_Z - 8, Math.PI); g.player.lock();
    g.radio("harry", "A.J.! Thank God. Get on that console and make that hole. Eight hundred feet. Not one foot less.", 10000);
  }

  /** where the objective arrow should point while you are crossing the asteroid */
  siteTarget(): Vector3 { return v3(this.O.x, 1, this.O.z + this.SITE_Z); }

  // ------------------------------------------------------------------------------------------------ the drill-site events
  gasPocket() {
    const g = this.g;
    g.ui.toast("GAS POCKET!", "Everything shakes");
    this.shakeAmt = 0.8; g.sfx.thud(); g.sfx.horn();
    $("fade").style.transition = "opacity .1s"; $("fade").style.background = "#ffb060"; $("fade").style.opacity = "0.85";
    setTimeout(() => { $("fade").style.transition = "opacity .6s"; $("fade").style.opacity = "0"; $("fade").style.background = "#000"; }, 260);
    g.radio("max", "HARRY! The rig's going up! The gas, it's — I can't hold her —", 6000);
    setTimeout(() => g.radio("harry", "Max! MAX! …Oh, God. Keep drilling, boys. Keep drilling.", 8000), 4200);
    g.arm.bit = Math.max(10, g.arm.bit - 35); g.arm.pauseT = 4;
  }

  /** at 800 ft: the storm smashes the remote detonator, someone must stay behind, and the straws are rigged */
  detonatorFails() {
    const g = this.g;
    this.shakeAmt = 0.7; g.sfx.horn();
    g.ui.toast("ASTEROID STORM", "Debris is hitting the site");
    g.radio("nasa", "Harry, you've hit eight hundred! But the storm — we've lost the remote detonator signal.", 8000);
    setTimeout(() => g.say("harry", "The circuit's smashed. Somebody has to stay behind and trigger the bomb by hand. Nobody likes it. We draw straws.", [
      { label: "Take the left straw", run: () => this.straw() }, { label: "Take the middle straw", run: () => this.straw() }, { label: "Take the right straw", cls: "alt", run: () => this.straw() },
    ], "The Straw Draw"), 3200);
  }
  private straw() {
    const g = this.g;
    g.say("chick", "Short straw. It's A.J.'s. …Kid, I'm sorry.", [{ label: "…Okay.", run: () => {
      g.say("harry", "Hold on. I'll take A.J. down and help him set it. He's never done this by hand.", [{ label: "Follow Harry to the airlock", run: () => this.airlock() }], "Harry");
    } }], "The Straw Draw");
  }
  private airlock() {
    const g = this.g;
    $("fade").style.transition = "opacity .8s"; $("fade").style.background = "#000"; $("fade").style.opacity = "1";
    setTimeout(() => {
      g.say("harry", "A.J. — look at me. You take care of my little girl. You're the son I never had.", [{ label: "Harry, what are you —", run: () => {
        g.say("aj", "HARRY! HARRY, NO! Open the hatch! HARRY!", [{ label: "Watch Freedom lift off", run: () => this.liftoff() }], "The Airlock");
      } }], "The Surface");
    }, 900);
  }
  private liftoff() {
    const g = this.g, fr = this.freedom!;
    // you are on the Freedom as it climbs away; Harry is left beside the drill
    g.player.teleport(this.O.x + 40, 0.6, this.O.z + this.SITE_Z - 50, Math.atan2(-6, 38)); g.player.third = false; g.player.pitch = -0.2;
    $("fade").style.transition = "opacity 1.2s"; $("fade").style.opacity = "0";
    if (this.harry) { this.harry.root.position.set(this.O.x + 6, 0.5, this.O.z + this.SITE_Z + 6); this.harry.root.setEnabled(true); }
    this.freedomUp = true; this.freedomV = 0; g.sfx.thud(); this.shakeAmt = 0.35;
    g.radio("nasa", "Freedom is clear of the blast radius. Harry — you're on your own. Thirty seconds.", 7000);
    setTimeout(() => this.eruption(), 7000);
    void fr;
  }
  private eruption() {
    const g = this.g;
    this.shakeAmt = 0.9; g.sfx.horn(); this.harryFlung = 1;
    g.ui.toast("GAS ERUPTION", "Harry is thrown across the rock");
    g.radio("harry", "Come on, Grace… come on, baby girl… Daddy's gotta press the button.", 6000);
    setTimeout(() => {
      g.mini.mash({ eyebrow: "Harry Stamper", title: "Crawl to the Detonator", intro: "The blast threw it out of reach. Crawl across the rock and press the button before the clock hits zero.", seconds: 9, label: "crawl!" }, () => {
        g.radio("harry", "…I'm coming, Grace.", 4000);
        setTimeout(() => g.detonate(), 700);
      });
    }, 1800);
  }

  // ------------------------------------------------------------------------------------------------ per frame
  update(dt: number) {
    const g = this.g;
    if (this.mode === "off") return;
    if (this.mode === "drive") this.driveStep(dt);
    // camera
    const p = g.player, cam = p.cam;
    if (this.mode === "drive") {
      const d = this.d, back = 17, up = 6.2, dirx = Math.sin(d.yaw), dirz = Math.cos(d.yaw);
      const tx = this.O.x + d.x, tz = this.O.z + d.z;
      cam.position.set(tx - dirx * back, d.y + up, tz - dirz * back);
      cam.setTarget(v3(tx + dirx * 14, d.y + 1.5 + Math.max(0, d.vy) * 0.2, tz + dirz * 14));
      this.hud.innerHTML = `<div style="color:#f4c04a">ARMADILLO</div><div style="font-size:22px">${Math.round(Math.abs(d.speed))} <small style="font-size:11px;color:#9fb4c8">m/s</small></div>`
        + `<div style="display:flex;align-items:center;gap:8px;margin-top:4px"><span style="font-size:11px;color:#9fb4c8">THRUSTERS</span><div style="flex:1;height:8px;background:#1b2836"><div style="height:100%;width:${Math.round(d.fuel * 100)}%;background:${d.thrusting ? "#ffb23a" : "#e07010"}"></div></div></div>`
        + `<div style="font-size:11px;color:#9fb4c8;font-weight:600;margin-top:4px">W gas · S brake · A/D steer · hold SPACE in the air for thrusters · ${Math.max(0, Math.round(this.RAMP0 - d.z))} m to the ramp</div>`;
    } else if (this.mode === "launch") {
      // the camera stays on the pad looking at the shuttle: nothing to do
    }
    // fires on the wreck flicker
    this.sparks.forEach((f, i) => { const s = 0.8 + Math.sin(performance.now() * 0.01 + i * 2) * 0.25 + Math.random() * 0.15; f.scaling.set(s, s * 1.3, s); });
    // the Freedom climbing away, and Harry being thrown
    if (this.freedomUp && this.freedom) {
      this.freedomV += 9 * dt; this.freedom.position.y += this.freedomV * dt;
      const fl = this.freedom.getChildMeshes().filter((m) => m.name === "shflame"); fl.forEach((m) => { const L = 22 * (0.85 + Math.random() * 0.3); m.scaling.set(1, L, 1); m.position.y = -L / 2 + 0.6; });
      if (this.freedom.position.y > 600) this.freedomUp = false;
    }
    if (this.harryFlung > 0 && this.harry) { this.harryFlung = Math.max(0, this.harryFlung - dt * 0.8); this.harry.root.position.z -= 9 * dt * this.harryFlung; this.harry.root.rotation.z = Math.min(1.5, this.harry.root.rotation.z + dt * 4); }
    // camera shake (explosions, launch, hard landings)
    if (this.shakeAmt > 0.002) {
      cam.position.addInPlace(v3((Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt));
      this.shakeAmt *= Math.exp(-1.6 * dt);
    }
    void Quaternion;
  }
}
