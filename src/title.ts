import {
  Scene, Engine, Camera, FreeCamera, Vector3, Color3, Color4, MeshBuilder, Mesh, StandardMaterial, DynamicTexture, Texture,
  ParticleSystem, PointLight, HemisphericLight, DirectionalLight,
} from "@babylonjs/core";
import type { Rig, RigFrame } from "./rig";

/**
 * Title screen: the real rig, at night, in a lightning storm — rendered at chunky pixel resolution.
 * A slow camera orbit, a scrolling cloud deck, rain, and jagged 3D bolts that hit the derrick crown and the pad,
 * with flash lighting and thunder. The neon logo and menu are plain DOM on top.
 */
interface Bolt { meshes: Mesh[]; life: number; max: number }

export class TitleScene {
  onThunder: (delaySec: number) => void = () => {};
  running = false;
  private t = 0; private flash = 0; private shake = 0; private nextStrike = 0.8; private pending: { at: number; target: Vector3 | null }[] = [];
  private cam: FreeCamera;
  private clouds: { mesh: Mesh; tex: DynamicTexture; mat: StandardMaterial; speed: number }[] = [];
  private boltMat: StandardMaterial; private bolts: Bolt[] = [];
  private flashBall: Mesh; private ballT = 0;
  private strikeLight: PointLight;
  private rain: ParticleSystem; private rainEmitter = new Vector3();
  private timers: number[] = [];
  private saved = { fogDensity: 0, scaling: 1, cam: null as Camera | null };
  private seed = 7;

  constructor(private scene: Scene, private engine: Engine, private rig: Rig, private hemi: HemisphericLight, private sun: DirectionalLight, private playerCam: Camera, private isTouch: boolean) {
    this.mount();
    // camera
    this.cam = new FreeCamera("titleCam", new Vector3(0, 9, 80), scene);
    this.cam.minZ = 0.2; this.cam.maxZ = 2500; this.cam.fov = 0.85; this.cam.inputs.clear();
    // bolts + impact flash
    this.boltMat = new StandardMaterial("bolt", scene);
    this.boltMat.diffuseColor = Color3.Black(); this.boltMat.emissiveColor = new Color3(0.82, 0.92, 1); this.boltMat.disableLighting = true; this.boltMat.fogEnabled = false;
    this.flashBall = MeshBuilder.CreateSphere("flashball", { diameter: 3, segments: 8 }, scene);
    const fm = new StandardMaterial("fball", scene); fm.diffuseColor = Color3.Black(); fm.emissiveColor = new Color3(0.9, 0.95, 1); fm.disableLighting = true; fm.alpha = 0.8; fm.fogEnabled = false;
    this.flashBall.material = fm; this.flashBall.isPickable = false; this.flashBall.setEnabled(false);
    this.strikeLight = new PointLight("strikeLight", new Vector3(0, 40, 0), scene);
    this.strikeLight.diffuse = new Color3(0.7, 0.85, 1); this.strikeLight.specular = Color3.Black(); this.strikeLight.range = 140; this.strikeLight.intensity = 0;
    this.buildClouds();
    this.rain = this.buildRain();
    this.setActive(false);
  }

  // ---------------------------------------------------------------- DOM bits
  private mount() {
    const $ = (id: string) => document.getElementById(id)!;
    const letters = (el: HTMLElement, text: string) => {
      el.textContent = "";
      [...text].forEach((ch) => { const sp = document.createElement("span"); sp.className = "lt"; sp.textContent = ch === " " ? "\u00a0" : ch; el.appendChild(sp); });
    };
    letters($("l1"), "ROLL COAL,"); letters($("l2"), "MAKE HOLE");
    // clicking the 2 calls down a bolt on the derrick
    $("two").addEventListener("click", () => this.strike(true));
  }

  // ---------------------------------------------------------------- scene dressing
  private rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  private buildClouds() {
    const make = (name: string, y: number, radius: number, speed: number, density: number) => {
      const S = 512, tex = new DynamicTexture(name + "T", S, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
      tex.wrapU = Texture.WRAP_ADDRESSMODE; tex.wrapV = Texture.WRAP_ADDRESSMODE; tex.hasAlpha = true;
      const c = tex.getContext() as CanvasRenderingContext2D; c.clearRect(0, 0, S, S);
      for (let i = 0; i < density; i++) {
        const x = this.rnd() * S, yy = this.rnd() * S, r = 28 + this.rnd() * 90, a = 0.1 + this.rnd() * 0.22, tone = 150 + ((this.rnd() * 70) | 0);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const px = x + ox * S, py = yy + oy * S; if (px + r < 0 || px - r > S || py + r < 0 || py - r > S) continue;
          const g = c.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(${tone},${tone},${tone + 14},${a})`); g.addColorStop(1, `rgba(${tone},${tone},${tone + 14},0)`);
          c.fillStyle = g; c.fillRect(px - r, py - r, r * 2, r * 2);
        }
      }
      tex.update(); tex.uScale = 3; tex.vScale = 3;
      const mat = new StandardMaterial(name + "M", this.scene);
      mat.diffuseTexture = tex; mat.useAlphaFromDiffuseTexture = true; mat.disableLighting = true; mat.backFaceCulling = false; mat.fogEnabled = false;
      mat.emissiveColor = new Color3(0.1, 0.1, 0.14); mat.diffuseColor = Color3.Black();
      const mesh = MeshBuilder.CreateDisc(name, { radius, tessellation: 48, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      mesh.rotation.x = Math.PI / 2; mesh.position.y = y; mesh.material = mat; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
      this.clouds.push({ mesh, tex, mat, speed });
    };
    make("cloudLow", 78, 700, 0.006, 420); make("cloudHigh", 120, 900, -0.003, 360);
  }

  private buildRain(): ParticleSystem {
    const tex = new DynamicTexture("rainT", { width: 8, height: 64 }, this.scene, false);
    const c = tex.getContext() as CanvasRenderingContext2D; const g = c.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255,0.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(2, 0, 4, 64); tex.update(); tex.hasAlpha = true;
    const ps = new ParticleSystem("rain", this.isTouch ? 1400 : 2600, this.scene);
    ps.particleTexture = tex; ps.emitter = this.rainEmitter;
    ps.minEmitBox = new Vector3(-45, 14, -45); ps.maxEmitBox = new Vector3(45, 24, 45);
    ps.direction1 = new Vector3(-0.28, -1, 0.08); ps.direction2 = new Vector3(-0.18, -1, 0.2);
    ps.minEmitPower = 42; ps.maxEmitPower = 60; ps.minLifeTime = 0.45; ps.maxLifeTime = 0.7;
    ps.emitRate = this.isTouch ? 1100 : 2200;
    ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    ps.minScaleX = 0.05; ps.maxScaleX = 0.09; ps.minScaleY = 1.4; ps.maxScaleY = 2.6; ps.minSize = 1; ps.maxSize = 1;
    ps.color1 = new Color4(0.75, 0.85, 1, 0.55); ps.color2 = new Color4(0.85, 0.92, 1, 0.35); ps.colorDead = new Color4(0.7, 0.8, 1, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD; ps.gravity = new Vector3(0, -6, 0);
    return ps;
  }

  // ---------------------------------------------------------------- lightning
  private displace(a: Vector3, b: Vector3, jag: number, out: Vector3[]) {
    const len = Vector3.Distance(a, b);
    if (len < 5) { out.push(b); return; }
    const m = Vector3.Lerp(a, b, 0.5).add(new Vector3((this.rnd() - 0.5) * jag, (this.rnd() - 0.5) * jag * 0.35, (this.rnd() - 0.5) * jag));
    this.displace(a, m, jag * 0.55, out); this.displace(m, b, jag * 0.55, out);
  }

  /** hit the derrick crown (crown=true) or somewhere on / around the pad */
  strike(crown = false) {
    const cloudY = 80;
    let hit: Vector3;
    const r = this.rnd();
    if (crown || r < 0.45) hit = new Vector3(0, 47.5, -0.6);
    else if (r < 0.75) { const a = this.rnd() * Math.PI * 2, d = 18 + this.rnd() * 55; hit = new Vector3(Math.sin(a) * d, 0.2, Math.cos(a) * d); }
    else { const a = this.rnd() * Math.PI * 2, d = 160 + this.rnd() * 200; hit = new Vector3(Math.sin(a) * d, 0.2, Math.cos(a) * d); }   // far sheet strikes
    const far = Vector3.Distance(hit, this.cam.position) > 120;
    const start = new Vector3(hit.x + (this.rnd() - 0.5) * 50, cloudY, hit.z + (this.rnd() - 0.5) * 50);
    const pts: Vector3[] = [start]; this.displace(start, hit, far ? 60 : 26, pts);
    const meshes: Mesh[] = [];
    const radius = far ? 1.0 : 0.45;
    meshes.push(MeshBuilder.CreateTube("bolt", { path: pts, radius, tessellation: 4, cap: Mesh.NO_CAP }, this.scene));
    const nb = far ? 2 : 3 + ((this.rnd() * 3) | 0);
    for (let i = 0; i < nb; i++) {
      const s = pts[1 + ((this.rnd() * (pts.length - 3)) | 0)];
      const e = new Vector3(s.x + (this.rnd() - 0.5) * 55, Math.max(2, s.y - 18 - this.rnd() * 28), s.z + (this.rnd() - 0.5) * 55);
      const bp: Vector3[] = [s]; this.displace(s, e, 14, bp);
      meshes.push(MeshBuilder.CreateTube("boltb", { path: bp, radius: radius * 0.5, tessellation: 4, cap: Mesh.NO_CAP }, this.scene));
    }
    for (const m of meshes) { m.material = this.boltMat; m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
    this.bolts.push({ meshes, life: 0.55 + this.rnd() * 0.25, max: 0.7 });
    this.flash = Math.max(this.flash, far ? 0.55 : 1); this.shake = Math.max(this.shake, far ? 0.2 : 1);
    this.strikeLight.position.copyFrom(hit).addInPlaceFromFloats(0, 6, 0); this.strikeLight.intensity = far ? 3 : 10;
    if (!far) { this.flashBall.position.copyFrom(hit); this.flashBall.setEnabled(true); this.ballT = 0.35; }
    this.onThunder(Vector3.Distance(hit, this.cam.position) / 343 * 0.5);
  }

  // ---------------------------------------------------------------- lifecycle
  private setActive(on: boolean) {
    this.clouds.forEach((c) => c.mesh.setEnabled(on));
    if (on) this.rain.start(); else this.rain.stop();
    this.strikeLight.setEnabled(on);
  }

  start() {
    if (this.running) return;
    this.running = true; this.t = 0;
    this.saved.fogDensity = this.scene.fogDensity; this.saved.scaling = this.engine.getHardwareScalingLevel(); this.saved.cam = this.scene.activeCamera;
    this.scene.activeCamera = this.cam;
    this.applyPixelScale();
    window.addEventListener("resize", this.applyPixelScale);
    document.getElementById("view")?.classList.add("pix");
    this.setActive(true);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    window.removeEventListener("resize", this.applyPixelScale);
    document.getElementById("view")?.classList.remove("pix");
    this.engine.setHardwareScalingLevel(this.saved.scaling);
    this.scene.fogDensity = this.saved.fogDensity;
    this.scene.activeCamera = this.saved.cam ?? this.playerCam;
    this.setActive(false);
    this.bolts.forEach((b) => b.meshes.forEach((m) => m.dispose())); this.bolts = [];
    this.flashBall.setEnabled(false); this.strikeLight.intensity = 0;
    this.timers.forEach((t) => clearInterval(t)); this.timers = [];
    this.clouds.forEach((c) => { c.mesh.dispose(); c.tex.dispose(); c.mat.dispose(); }); this.clouds = [];
    this.rain.dispose();
  }

  /** chunky pixels: render at about 270 lines and let the browser scale up with nearest-neighbour */
  private applyPixelScale = () => {
    const lines = this.isTouch ? 220 : 270;
    this.engine.setHardwareScalingLevel(Math.max(2, (window.innerHeight * (window.devicePixelRatio || 1)) / lines));
    this.engine.resize();
  };

  /** the rig keeps busy while the camera orbits: night lamps on, top drive working */
  frameOverride(): Partial<RigFrame> {
    return { rotating: true, connecting: false, tripping: true, tripFrac: 0, standsRacked: 24, night: 1, pumpsOn: true, flaring: true };
  }

  /** runs after game.update each frame, so it overrides the day/night environment */
  update(dt: number) {
    if (!this.running) return;
    this.t += dt;
    const t = this.t;
    // orbit
    const a = 0.45 + t * 0.06, r = 66 + Math.sin(t * 0.13) * 6, h = 4.5 + Math.sin(t * 0.21) * 2.5;
    this.cam.position.set(Math.sin(a) * r, h, Math.cos(a) * r);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    if (this.shake > 0.01) this.cam.position.addInPlaceFromFloats((this.rnd() - 0.5) * this.shake * 1.1, (this.rnd() - 0.5) * this.shake * 0.7, (this.rnd() - 0.5) * this.shake * 1.1);
    this.cam.setTarget(new Vector3(0, 28 + Math.sin(t * 0.17) * 2.5, 0));
    this.rainEmitter.set(this.cam.position.x, this.cam.position.y, this.cam.position.z);
    // clouds roll
    for (const c of this.clouds) c.tex.uOffset += dt * c.speed;
    // scheduled strikes (+ the occasional double strike)
    this.nextStrike -= dt;
    if (this.nextStrike <= 0) { this.strike(false); if (this.rnd() < 0.5) this.pending.push({ at: t + 0.12 + this.rnd() * 0.2, target: null }); this.nextStrike = 0.55 + this.rnd() * 1.5; }
    for (const p of [...this.pending]) if (t >= p.at) { this.strike(this.rnd() < 0.5); this.pending.splice(this.pending.indexOf(p), 1); }
    // bolts fade with a flicker
    for (const b of [...this.bolts]) {
      b.life -= dt;
      const k = b.life / b.max, vis = k > 0.45 ? true : this.rnd() < k + 0.25;
      b.meshes.forEach((m) => m.setEnabled(vis));
      if (b.life <= 0) { b.meshes.forEach((m) => m.dispose()); this.bolts.splice(this.bolts.indexOf(b), 1); }
    }
    // impact ball
    if (this.ballT > 0) { this.ballT -= dt; const s = 1 + (0.35 - this.ballT) * 22; this.flashBall.scaling.setAll(s); (this.flashBall.material as StandardMaterial).alpha = Math.max(0, this.ballT / 0.35) * 0.8; if (this.ballT <= 0) this.flashBall.setEnabled(false); }
    // flash -> environment
    this.flash = Math.max(0, this.flash - dt * 3.4);
    this.strikeLight.intensity = Math.max(0, this.strikeLight.intensity - dt * 28);
    const f = this.flash, sceneCol = new Color3(0.035 + f * 0.5, 0.045 + f * 0.55, 0.1 + f * 0.7);
    this.scene.clearColor = new Color4(sceneCol.r, sceneCol.g, sceneCol.b, 1);
    this.scene.fogColor = sceneCol.clone(); this.scene.fogDensity = 0.0042;
    this.hemi.intensity = 0.3 + f * 1.2; this.sun.intensity = 0.1 + f * 1.4;
    this.sun.direction.set(-0.4, -1, -0.3);
    for (const c of this.clouds) c.mat.emissiveColor.set(0.09 + f * 0.75, 0.1 + f * 0.8, 0.14 + f * 0.95);
  }
}
