import { ParticleSystem, Color4, DynamicTexture, Scene, MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode, Mesh, VertexBuffer, VertexData, Quaternion } from "@babylonjs/core";
import { Builder, type AABB } from "./builder";
import { Wildlife } from "./wildlife";
import { Ground } from "./ground";
import { Human } from "./npcs";
import type { Game } from "./game";

/**
 * Everything out past the fence: hills to drive around, a pond, a grumpy landowner's farmstead with old grain silos, a pasture full of cattle,
 * a hostile competitor's rig, and a taco truck by the gate. Each is its own little set of interactions.
 */
interface It { pos: () => Vector3; label: () => string; r: number; act: () => void; ok?: () => boolean }
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(l: T[]) => l[Math.floor(Math.random() * l.length)];

// ---- layout (world metres; the lease is x -60..60, z -66..62, the lease road runs +z from the gate) ----
const HILLS: [number, number, number, number][] = [
  [150, -30, 10, 20], [198, -72, 14, 22], [160, -118, 9, 17], [235, -18, 11, 18], [118, -70, 8, 15],                                                   // the Breaks, steeper than before
  [150, 45, 11, 19], [215, 70, 15, 21], [120, 108, 10, 17], [182, 142, 13, 19], [236, 172, 12, 18], [135, 205, 14, 20], [206, 238, 16, 21], [150, 278, 12, 18], [232, 292, 13, 19], [112, 322, 10, 17],   // and on north through the pasture
];
/** flat-topped mesas with sheer sides: x, z, half-width x, half-width z, height, edge softness (smaller = steeper) */
const MESAS: [number, number, number, number, number, number][] = [[305, 12, 26, 34, 12, 0.07], [296, 155, 30, 24, 15, 0.07], [292, 280, 26, 28, 13, 0.07], [95, -165, 24, 20, 11, 0.07]];
const POND = { x: -175, z: 165, rx: 68, rz: 52 };
const POND_DEPTH = 6, WATER_Y = -0.3;
/** the BOP cellar at the wellhead: 10 ft across, 6 ft deep */
const DIGGING = false;
const CELL_R = 1.525, CELL_D = 1.83, CELL_H = 6;
/** the deep hole, out toward the middle of the pond: the rare catches live here */
const DEEP = { x: POND.x - 18, z: POND.z - 6, r: 17, extra: 6.5 };
const FARM = { x: -64, z: 236 };                      // the house; its porch faces +x, toward the lease road
const SILOS = { x: -93, z: 262 };
const RIVAL = { x: -420, z: -300 };
export const FOREST_CAMP = { x: -40, z: -330 };   // the hunters' camp in the forest to the south                   // Singularity Drilling
const TACO = { x: -14, z: 192 };                      // up the lease road, well past the gate (you start outside its district)
const PASTURE = { x0: 70, x1: 230, z0: 115, z1: 305 };

export class Outskirts {
  colliders: AABB[] = [];
  merged: Mesh[] = [];
  private g: Game; private scene: Scene;
  private cows: { n: TransformNode; x: number; z: number; h: number; sp: number; t: number; flee: number; down: number }[] = [];
  private ducks: { m: Mesh; a: number; r: number; w: number }[] = [];
  private guards: { h: Human; x: number; z: number; wp: [number, number][]; i: number; up?: boolean }[] = [];
  /** the secrets job: the cool-down after somebody gets thrown out */
  private raidCd = 0;
  /** inside Singularity's fence */
  inLease() { const p = this.g.player.pos; return Math.abs(p.x - RIVAL.x) < 43 && Math.abs(p.z - RIVAL.z) < 43; }
  /** on the far side of their gate, with the data */
  outsideGate() { const p = this.g.player.pos; return p.x > RIVAL.x + 47 && Math.abs(p.z - RIVAL.z) < 30; }
  stairsBase() { return new Vector3(RIVAL.x + 20, 1.2, RIVAL.z); }
  terminalPos() { return new Vector3(RIVAL.x, 9.3, RIVAL.z + 6.4); }
  gatePos() { return new Vector3(RIVAL.x + 46, 1.2, RIVAL.z); }
  private fut: { core: Mesh; glow: Mesh; ground: Mesh; ring: Mesh; drones: { m: Mesh; a: number; r: number; h: number; w: number }[]; arm: TransformNode; l1: TransformNode; l2: TransformNode } | null = null;
  private fish = { st: "idle" as "idle" | "charge" | "fly" | "wait" | "bite", t: 0, bite: 0, sx: 0, sz: 0, bx: 0, bz: 0, caught: 0, best: 0, junk: 0, power: 0, pdir: 1, depth: 2, bed: 3 };
  private eHeld = false; private fishHud: HTMLDivElement | null = null;
  /** the rod in the angler's hands: one on the body (third person) and one on the camera (first person) */
  private rodBody: Mesh | null = null; private rodCam: Mesh | null = null;
  private makeRod(): Mesh {
    const m = MeshBuilder.CreateCylinder("heldrod", { diameterTop: 0.012, diameterBottom: 0.035, height: 2.3, tessellation: 6 }, this.scene);
    const mat = new StandardMaterial("heldrodm", this.scene); mat.diffuseColor = Color3.FromHexString("#c9a15a"); mat.specularColor = Color3.Black(); m.material = mat; m.isPickable = false; m.setEnabled(false);
    const reel = MeshBuilder.CreateCylinder("reel", { diameter: 0.1, height: 0.07, tessellation: 10 }, this.scene); const rm = new StandardMaterial("reelm", this.scene); rm.diffuseColor = Color3.FromHexString("#2b2f36"); reel.material = rm; reel.parent = m; reel.position.set(0.05, -0.6, 0); reel.rotation.z = Math.PI / 2; reel.isPickable = false;
    const grip = MeshBuilder.CreateCylinder("grip", { diameter: 0.05, height: 0.45, tessellation: 8 }, this.scene); grip.material = rm; grip.parent = m; grip.position.y = -0.95; grip.isPickable = false;
    return m;
  }
  private rodsFor(third: boolean): Mesh {
    const g = this.g;
    if (!this.rodBody) { this.rodBody = this.makeRod(); this.rodBody.parent = g.player.body.root; this.rodBody.position.set(0.28, 1.65, 1.04); this.rodBody.rotation.set(0.9, 0, 0); }
    if (!this.rodCam) { this.rodCam = this.makeRod(); this.rodCam.parent = g.player.cam; this.rodCam.position.set(0.42, -0.2, 1.5); this.rodCam.rotation.set(1.05, -0.12, 0); }
    return third ? this.rodBody : this.rodCam;
  }
  private bobber!: Mesh; private fline!: Mesh; private ripple!: Mesh; private pole!: Mesh;
  private floorBots: { h: Human; x: number; z: number; ph: number; ang: number }[] = [];
  private smoke: { ps: ParticleSystem; t: number; burst: number }[] = [];
  ground!: Ground; private blockedCells = new Set<number>(); private lastP: { x: number; z: number } | null = null;
  wild!: Wildlife;
  private hankSt = { mode: "porch" as "porch" | "chase", shotT: 1.2, yellT: 2, flinchT: 0, y: 0.55 };
  private fx!: { tracer: Mesh; flash: Mesh; puff: Mesh; tT: number; fT: number; pT: number };
  private hank!: Human; private lupe!: Human; private rusty!: Human;
  private nearCow = 0; private t = 0;
  private seen = new Set<string>();
  private cd: Record<string, number> = {};

  /** more wind turbines scattered over the landscape (the company's own is west of the lease): they turn until somebody shuts them down */
  turbs: { x: number; z: number; rot: TransformNode; on: boolean }[] = [];
  turbinePos(i: number) { const t = this.turbs[i]; return new Vector3(t.x, 1.5, t.z + 2.5); }
  private turbines(b: Builder) {
    b.defMat("wtwhite", "#e8eaec", { spec: 0.3 });
    for (const [x, z] of [[-290, 330], [-130, -210], [310, -340]] as [number, number][]) {
      b.cyl("wtwhite", x, 17, z, 2.2, 34, { tess: 14, dia2: 1.1 }); b.box("wtwhite", x, 35.2, z, 4.2, 2.2, 2.4); b.cyl("rust", x, 34.2, z + 1.4, 1.3, 0.6, { axis: "z", tess: 10 });
      b.blocker(x - 1.2, 0, z - 1.2, x + 1.2, 8, z + 1.2);
      const rot = new TransformNode("turbrot", this.scene); rot.position.set(x, 35.2, z + 2.0);
      const bm = new StandardMaterial("blade", this.scene); bm.diffuseColor = Color3.FromHexString("#f2f4f6"); bm.specularColor = Color3.Black();
      for (let k = 0; k < 3; k++) { const arm = new TransformNode("arm", this.scene); arm.parent = rot; arm.rotation.z = (k / 3) * Math.PI * 2; const bl = MeshBuilder.CreateBox("blade", { width: 0.7, height: 15, depth: 0.2 }, this.scene); bl.material = bm; bl.parent = arm; bl.position.y = 7.8; bl.isPickable = false; }
      const hub = MeshBuilder.CreateSphere("hub", { diameter: 1.6, segments: 8 }, this.scene); hub.material = bm; hub.parent = rot; hub.isPickable = false;
      this.turbs.push({ x, z, rot, on: true });
    }
  }
  /** "Bigfoot National Mesquite Forest" south of the lease: a thick stand of mesquite and oak, a hunters' camp, and something large that does not want to be seen */
  private forest(b: Builder) {
    for (const [k, c, o] of [["leaf", "#3d5a2a"], ["leaf2", "#2c4a22"], ["leaf3", "#55672f"], ["bark", "#4a3a28"], ["tent", "#c8a24a"], ["tentd", "#8a6a2a"], ["campfire", "#ff7a1a", { emissive: "#ff7a1a" }], ["flog", "#5a4128"], ["cooler", "#2c6fb5"]] as [string, string, { emissive?: string }?][]) b.defMat(k, c, o ?? {});
    let seed = 91; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const C = FOREST_CAMP;
    for (let gx = -340; gx < 340; gx += 13) for (let gz = -150; gz > -560; gz -= 13) {
      const x = gx + (R() - 0.5) * 10, z = gz + (R() - 0.5) * 10, h = 3.5 + R() * 3.5, w = 0.35 + R() * 0.3, big = 2.6 + R() * 2.4, mat = ["leaf", "leaf2", "leaf3"][(R() * 3) | 0], extra = R() < 0.5;
      if (R() < 0.38) continue;
      if (x > 30 && z > -250) continue;                           // the hills' country
      if (Math.hypot(x - RIVAL.x, z - RIVAL.z) < 150) continue;   // the rival's fence
      if (Math.hypot(x - C.x, z - C.z) < 17) continue;            // the camp's clearing
      if (Math.hypot(x, z) > 540) continue;                       // the cliffs
      b.cyl("bark", x, h / 2, z, w, h, { tess: 6, dia2: w * 0.6 });
      b.sphere(mat, x, h + big * 0.35, z, big, 8);
      if (extra) b.sphere(mat, x + (R() - 0.5) * 1.8, h + big * 0.1, z + (R() - 0.5) * 1.8, big * 0.7, 7);
      b.blocker(x - 0.3, 0, z - 0.3, x + 0.3, 4, z + 0.3);
    }
    // the hunters' camp: a tent, a fire ring with log seats, a cooler, and a sign
    b.box("tent", C.x - 4, 0.9, C.z + 1, 3.2, 1.8, 2.6, true); b.beam("tentd", new Vector3(C.x - 4, 1.9, C.z - 0.4), new Vector3(C.x - 4, 1.9, C.z + 2.4), 0.12);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.cyl("rust", C.x + Math.cos(a) * 1.1, 0.14, C.z + Math.sin(a) * 1.1, 0.4, 0.28, { tess: 6 }); }
    b.sphere("campfire", C.x, 0.35, C.z, 0.7, 6); for (const [dx, dz] of [[-2.2, 0.4], [2.0, -0.6], [0.4, 2.2]]) b.cyl("flog", C.x + dx, 0.22, C.z + dz, 0.45, 1.8, { axis: dx === 0.4 ? "x" : "z", tess: 7 });
    b.box("cooler", C.x - 2.2, 0.3, C.z - 2.2, 0.9, 0.6, 0.55, true);
    b.label("BIGFOOT NATIONAL\nMESQUITE FOREST", C.x + 4.5, 2.4, C.z - 3, 3.4, 1.0, 0, "#233a52", "#ffd24a", 44);
    b.slab("dwood", C.x + 4.4, 0, C.z - 3.05, C.x + 4.6, 2.2, C.z - 2.95);
    // something large, dark and hairy, standing a way off between the trees
    const bf = new TransformNode("bigfoot", this.scene), mk = (m: Mesh, x: number, y: number, z: number) => { m.parent = bf; m.position.set(x, y, z); m.material = mat; m.isPickable = false; return m; };
    const mat = new StandardMaterial("bigfootm", this.scene); mat.diffuseColor = Color3.FromHexString("#2b1f18"); mat.specularColor = Color3.Black();
    for (const s of [-1, 1]) { mk(MeshBuilder.CreateCylinder("bfl", { diameterTop: 0.45, diameterBottom: 0.38, height: 1.3, tessellation: 7 }, this.scene), s * 0.3, 0.65, 0); mk(MeshBuilder.CreateCylinder("bfa", { diameterTop: 0.3, diameterBottom: 0.26, height: 1.7, tessellation: 7 }, this.scene), s * 0.78, 1.55, 0.1).rotation.z = s * 0.14; }
    mk(MeshBuilder.CreateBox("bft", { width: 1.2, height: 1.5, depth: 0.7 }, this.scene), 0, 1.95, 0); mk(MeshBuilder.CreateSphere("bfh", { diameter: 0.62, segments: 8 }, this.scene), 0, 2.95, 0.05);
    for (const s of [-1, 1]) mk(MeshBuilder.CreateSphere("bfe", { diameter: 0.07, segments: 4 }, this.scene), s * 0.12, 3.0, 0.32).material = this.bfEye();
    bf.position.set(-120, 0, -430); this.bf = bf; this.bfPost = 0;
  }
  private bf: TransformNode | null = null; private bfPost = 0; private bfSeen = false; private bfRun = 0; private bfEyeMat: StandardMaterial | null = null;
  private bfEye() { if (!this.bfEyeMat) { const m = new StandardMaterial("bfeye", this.scene); m.emissiveColor = new Color3(1, 0.85, 0.3); m.diffuseColor = Color3.Black(); m.disableLighting = true; this.bfEyeMat = m; } return this.bfEyeMat; }
  /** Bigfoot keeps his distance: he stands about, and walks off when you get close, to turn up somewhere else a while later */
  private bigfootStep(dt: number) {
    const bf = this.bf; if (!bf) return; const g = this.g, p = g.player.pos, POSTS: [number, number][] = [[-120, -430], [70, -480], [-260, -190], [160, -420], [-20, -250], [-190, -440]];
    const d = Math.hypot(p.x - bf.position.x, p.z - bf.position.z);
    bf.position.y = Math.max(0, this.terrain(bf.position.x, bf.position.z));
    if (d < 70 && !this.bfSeen) { this.bfSeen = true; g.ui.toast("DISCOVERED", "BIGFOOT? (Something big is watching you from the trees.)"); g.sfx.good(); g.gain(0, 6); g.award("bigfoot"); }
    if (this.bfRun > 0) {
      this.bfRun -= dt; const dx = bf.position.x - p.x, dz = bf.position.z - p.z, l = Math.hypot(dx, dz) || 1; bf.position.x += (dx / l) * 11 * dt; bf.position.z += (dz / l) * 11 * dt; bf.rotation.y = Math.atan2(dx, dz); bf.position.x = Math.max(-460, Math.min(460, bf.position.x)); bf.position.z = Math.max(-520, Math.min(-130, bf.position.z));
      if (this.bfRun <= 0 || l > 90) { this.bfRun = 0; bf.setEnabled(false); setTimeout(() => { this.bfPost = (this.bfPost + 1 + ((Math.random() * 4) | 0)) % POSTS.length; bf.position.x = POSTS[this.bfPost][0]; bf.position.z = POSTS[this.bfPost][1]; bf.setEnabled(true); }, 25000 + Math.random() * 20000); }
    } else if (bf.isEnabled()) {
      bf.rotation.y = Math.atan2(p.x - bf.position.x, p.z - bf.position.z);   // he watches you
      if (d < 26) { this.bfRun = 6; if (Math.random() < 0.5) g.radio("hank" as any, "Did you see that? ...Nah. Probably a bear. A tall bear.", 5000); }
    }
  }

  /** the ground before anybody has dug: flat, except for the hills, the mesas and the pond basin */
  baseTerrain = (x: number, z: number): number => {
    {   // the pond is a real basin, with a deep hole near the middle
      const pu = ((x - POND.x) / POND.rx) ** 2 + ((z - POND.z) / POND.rz) ** 2;
      if (pu < 1) { let d = POND_DEPTH * (1 - pu); const dd = ((x - DEEP.x) ** 2 + (z - DEEP.z) ** 2) / (DEEP.r * DEEP.r); if (dd < 1) d += DEEP.extra * Math.pow(1 - dd, 1.4); return -d; }
    }
    if (x < 40 || x > 365 || z < -245 || z > 350) return 0;
    let h = 0;
    for (const [hx, hz, H, s] of HILLS) { const dx = x - hx, dz = z - hz; h += H * Math.exp(-(dx * dx + dz * dz) / (2 * s * s)); }
    for (const [mx, mz, rx, rz, H, ed] of MESAS) { const u = Math.pow(Math.pow(Math.abs(x - mx) / rx, 3) + Math.pow(Math.abs(z - mz) / rz, 3), 1 / 3); if (u < 1 + ed) { const k = Math.max(0, Math.min(1, (1 + ed - u) / (2 * ed))); h += H * k * k * (3 - 2 * k) * (0.96 + 0.04 * Math.sin(x * 0.4) * Math.cos(z * 0.35)); } }
    return h < 0.04 ? 0 : h;
  };
  /** the ground height at (x, z): the base ground plus whatever the backhoe has done to it */
  terrain = (x: number, z: number): number => {
    if (x * x + z * z < CELL_R * CELL_R) return -CELL_D;   // the cellar
    return this.baseTerrain(x, z) + (this.ground ? this.ground.delta(x, z) : 0);
  };

  constructor(g: Game) {
    this.g = g; this.scene = g.scene;
    const sc = this.scene, b = new Builder(sc);
    const mats: [string, string, { emissive?: string; alpha?: number; spec?: number }?][] = [
      ["concrete", "#a8a69c"], ["rust", "#8a4a2a"], ["wood", "#7a5a38"], ["dwood", "#4a3724"], ["siding", "#d9d2bd"], ["roofm", "#5a3a2e"], ["glassd", "#1d2630"], ["brick", "#8a5a46"],
      ["tacored", "#c8331f"], ["tacowhite", "#ece8de"], ["bulb", "#ffe9a8", { emissive: "#ffe9a8" }], ["bddred", "#a01818"], ["bddblk", "#1c1c1e"], ["bddsteel", "#7a7e85"],
      ["black", "#16181a"], ["steel", "#7b8087"], ["dsteel", "#3a3f45"], ["pad", "#4a443c"], ["flag", "#d8261c"], ["sign", "#d9cfae"], ["reed", "#8a7a3a"], ["sage", "#6a7a52"],
    ];
    for (const [k, c, o] of mats) b.defMat(k, c, o ?? {});
    window.addEventListener("keydown", (ev) => { if (ev.code === "KeyE") this.eHeld = true; const f = this.fish; if (f.st !== "idle" && f.st !== "charge") { if (ev.code === "KeyR") f.depth = Math.min(Math.max(0.5, f.bed - 0.15), f.depth + 0.5); if (ev.code === "KeyF") f.depth = Math.max(0.5, f.depth - 0.5); } });
    window.addEventListener("keyup", (ev) => { if (ev.code === "KeyE") this.eHeld = false; });
    window.addEventListener("mousedown", (ev) => { if (ev.button === 0) this.eHeld = true; }); window.addEventListener("mouseup", (ev) => { if (ev.button === 0) this.eHeld = false; });
    window.addEventListener("blur", () => { this.eHeld = false; });
    window.addEventListener("wheel", (ev) => { const f = this.fish; if (f.st !== "idle" && f.st !== "charge") f.depth = ev.deltaY > 0 ? Math.min(Math.max(0.5, f.bed - 0.15), f.depth + 0.5) : Math.max(0.5, f.depth - 0.5); }, { passive: true });
    this.hills(b);
    this.kickers(b);
    this.pond(b);
    this.farm(b);
    this.silos(b);
    this.rival(b);
    this.taco(b);
    this.forest(b); this.turbines(b);
    this.merged = b.finish();
    this.colliders = b.colliders;
    this.cattle();
    this.skyline();
    this.cellar();
    // the open ground is one diggable height field now (the old flat plane sinks out of the way underneath; the pad keeps its own mesh)
    { const og = sc.getMeshByName("ground"); if (og) og.setEnabled(false);
      // a safety floor half a metre under the open ground: whatever the height field misses (its far edge, a gap in a tile) shows sand, never the void. It has holes where the ground really is lower: the pond basin and the cellar.
      { const mat = sc.getMaterialByName("ground"), xs = [-3000, -245, -105, -4, 4, 3000], zs = [-3000, -4, 4, 110, 220, 3000];
        for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
          const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
          if ((x0 === -245 && z0 === 110) || (x0 === -4 && z0 === -4)) continue;
          const m = MeshBuilder.CreateGround("groundfloor", { width: x1 - x0, height: z1 - z0 }, sc); m.position.set((x0 + x1) / 2, -0.5, (z0 + z1) / 2);
          const uv: number[] = []; const p = m.getVerticesData("position")!; for (let k = 0; k < p.length; k += 3) uv.push((p[k] + m.position.x + 3000) / 6000, (p[k + 2] + m.position.z + 3000) / 6000);
          m.setVerticesData("uv", uv); if (mat) m.material = mat; m.receiveShadows = false; m.isPickable = false;
        } }
      this.ground = new Ground(sc, this.baseTerrain, sc.getMaterialByName("ground"), (x, z) => Math.abs(x) <= 60 && z >= -65 && z <= 65);
      this.buildBlocked([...g.rig.colliders, ...this.colliders]);
      this.ground.prime(DIGGING ? [{ x: 0, z: 112 }, { x: 0, z: 0 }] : []); }
    this.generatorSmoke();
    this.hankFx();
    this.wild = new Wildlife(g, this.scene, this.terrain, () => {});
  }

  /** the little things Hank's shotgun and yours leave behind: a flash, a tracer line, a puff of dust */
  private hankFx() {
    const sc = this.scene, em = (hex: string, a: number) => { const m = new StandardMaterial("fxm" + hex, sc); m.emissiveColor = Color3.FromHexString(hex); m.disableLighting = true; m.alpha = a; m.backFaceCulling = false; return m; };
    const tracer = MeshBuilder.CreateCylinder("tracer", { diameter: 0.035, height: 1, tessellation: 4 }, sc); tracer.material = em("#ffe9a0", 0.9);
    const flash = MeshBuilder.CreateSphere("muzzle", { diameter: 0.5, segments: 6 }, sc); flash.material = em("#ffb040", 0.95);
    const puff = MeshBuilder.CreateSphere("puff", { diameter: 1, segments: 6 }, sc); const pm = new StandardMaterial("puffm", sc); pm.diffuseColor = Color3.FromHexString("#9a8a6a"); pm.specularColor = Color3.Black(); pm.alpha = 0.7; puff.material = pm;
    for (const m of [tracer, flash, puff]) { m.isPickable = false; m.setEnabled(false); }
    this.fx = { tracer, flash, puff, tT: 0, fT: 0, pT: 0 };
  }
  /** a shot from o toward the target: flash at the muzzle, a tracer line, and a puff where it lands */
  private shotFx(o: Vector3, to: Vector3, puffAt: Vector3 | null) {
    const f = this.fx, d = to.subtract(o), len = d.length(); if (len < 0.1) return;
    f.tracer.setEnabled(true); f.tracer.position.copyFrom(o.add(to).scale(0.5)); f.tracer.scaling.y = len;
    if (!f.tracer.rotationQuaternion) f.tracer.rotationQuaternion = new Quaternion(); Quaternion.FromUnitVectorsToRef(Vector3.Up(), d.scale(1 / len), f.tracer.rotationQuaternion); f.tT = 0.1;
    f.flash.setEnabled(true); f.flash.position.copyFrom(o); f.fT = 0.08;
    if (puffAt) { f.puff.setEnabled(true); f.puff.position.copyFrom(puffAt); f.puff.scaling.setAll(0.4); f.pT = 0.6; }
  }
  private updateFx(dt: number) {
    const f = this.fx; if (!f) return;
    if (f.tT > 0) { f.tT -= dt; if (f.tT <= 0) f.tracer.setEnabled(false); }
    if (f.fT > 0) { f.fT -= dt; if (f.fT <= 0) f.flash.setEnabled(false); }
    if (f.pT > 0) { f.pT -= dt; const u = 1 - f.pT / 0.6; f.puff.scaling.setAll(0.4 + u * 1.6); (f.puff.material as StandardMaterial).alpha = 0.7 * (1 - u); if (f.pT <= 0) f.puff.setEnabled(false); }
  }

  // ---------------------------------------------------------------------------------------------- Hank, the shotgun, hunting
  afterLoad() { /* nothing to restore */ }
  private hankUpdate(dt: number, px: number, pz: number) {
    const g = this.g, h = this.hank, S = this.hankSt, f = g.flags;
    const hostile = !f.hankFriend && ((px - POND.x) / (POND.rx * 1.2)) ** 2 + ((pz - POND.z) / (POND.rz * 1.2)) ** 2 < 1;
    const hx = h.root.position.x, hz = h.root.position.z, porchX = FARM.x + 7.4, porchZ = FARM.z - 0.8;
    let tx = porchX, tz = porchZ, sp = 2.8, shooting = false;
    if (hostile) {
      S.mode = "chase"; const dd = Math.hypot(px - hx, pz - hz); shooting = true;
      if (dd > 9) { tx = px; tz = pz; sp = 4.4; } else { tx = hx; tz = hz; sp = 0; }
      S.shotT -= dt; S.yellT -= dt; S.flinchT -= dt;
      if (dd < 80 && S.shotT <= 0) {
        S.shotT = rnd(1.5, 2.3);
        const muz = h.root.position.add(new Vector3(0, 1.35, 0)).add(new Vector3(Math.sin(h.root.rotation.y) * 0.9, 0, Math.cos(h.root.rotation.y) * 0.9));
        // his aim is bad: it goes wide of you by several metres, every time
        const a = rnd(0, 6.283), off = rnd(3.2, 8.5), ix = px + Math.cos(a) * off, iz = pz + Math.sin(a) * off, iy = this.terrain(ix, iz);
        this.shotFx(muz, new Vector3(ix, iy + rnd(0, 1.0), iz), new Vector3(ix, iy + 0.3, iz)); g.sfx.gun();
        if (off < 4.8 && S.flinchT <= 0) { S.flinchT = 4; g.gain(0, -1); g.ui.toast("BANG!", "That one was close. Hank's aim is terrible. Hank is still trying to kill you."); }
      }
      if (S.yellT <= 0) { S.yellT = 7; g.radio("hank" as any, pick(["GET OFF MY POND!", "THAT'S MY POND, COMPANY MAN!", "I'LL TEACH YOU TO FISH!", "STAND STILL!", "BACK OFF MY WATER!"]), 4500); }
    } else if (S.mode === "chase" && Math.hypot(hx - porchX, hz - porchZ) < 1.0) S.mode = "porch";
    const dx = tx - hx, dz = tz - hz, dd2 = Math.hypot(dx, dz);
    if (dd2 > 0.3 && sp > 0) {
      const k = Math.min(1, (sp * dt) / dd2); h.root.position.x += dx * k; h.root.position.z += dz * k;
      let da = Math.atan2(dx, dz) - h.root.rotation.y; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; h.root.rotation.y += da * Math.min(1, dt * 8); h.animate(dt, sp);
    } else {
      h.animate(dt, 0);
      const face = hostile ? Math.atan2(px - hx, pz - hz) : Math.PI / 2; let da = face - h.root.rotation.y; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; h.root.rotation.y += da * Math.min(1, dt * 5);
    }
    const onPorch = Math.abs(h.root.position.x - porchX) < 3.2 && Math.abs(h.root.position.z - FARM.z) < 3.2;
    S.y += ((onPorch ? 0.55 : this.terrain(h.root.position.x, h.root.position.z)) - S.y) * Math.min(1, dt * 8); h.root.position.y = S.y;
    h.armR.rotation.x = shooting ? -1.3 : -0.6; h.elbowR!.rotation.x = shooting ? -0.3 : -1.2;
  }
  private talkHank() {
    const g = this.g, f = g.flags;
    if (f.hankFriend) {
      const L = ["Catch anything? Don't lie. I can see your hands.", "Leave the critters alone. The deer and I have an understanding.", "The truck's got a gas gauge that's a suggestion. Fill up before you go far.", "There's a big old fish in that pond. I call him Gerald. Don't tell Gerald I told you."];
      g.say("hank" as any, L[(this.cd["hanktalk"] = ((this.cd["hanktalk"] ?? -1) + 1)) % L.length], [{ label: "Will do, Hank.", cls: "green", run: () => {} }] as any, "Hank, your friend"); return;
    }
    const fr = (f.hankFr as number | undefined) ?? 0;
    const bump = (n: number, line: string) => { f.hankFr = Math.max(0, fr + n); g.radio("hank" as any, line, 5000); if ((f.hankFr as number) >= 3) setTimeout(() => this.befriend(), 900); else g.ui.toast("HANK", ["Still hostile.", "Thawing, a little.", "Almost there…"][Math.min(2, f.hankFr as number)]); };
    const stage = ["You're on my land. Again. And you were looking at my pond.", "Still here. Persistent for a Company Man, I'll give you that.", "…I'll hear you out. But that pond is MINE."][Math.min(2, fr)];
    const choices: { label: string; cls?: string; run: () => void }[] = [
      { label: "I'm sorry about the noise, sir.", run: () => bump((this.cd["hankpol"] ?? -99) + 20 < this.t ? 1 : 0, (this.cd["hankpol"] = this.t, "Hm. Sorry's a start.")) },
      { label: "What can I do to make it right?", run: () => bump((this.cd["hankhelp"] ?? -99) + 20 < this.t ? 1 : 0, (this.cd["hankhelp"] = this.t, "Show some respect. And bring somebody to this farm who isn't a Company Man.")) },
    ];
    if (((f.taco as number | undefined) ?? 0) > 0) choices.push({ label: "I brought you a taco.", cls: "green", run: () => { f.taco = (f.taco as number) - 1; bump(2, "…Is that al pastor? From the truck by the gate? Well, GOSH. Okay."); } });
    choices.push({ label: "We're drilling. It's legal.", cls: "alt", run: () => bump(-1, "So is my shotgun, son.") });
    g.say("hank" as any, stage, choices as any, "Hank — The Landowner");
  }
  private befriend() {
    const g = this.g, f = g.flags; if (f.hankFriend) return;
    g.say("hank" as any, "Alright. ALRIGHT. You're not like the rest of 'em. The pond's open to you now. Pole's on the dock. And watch out for the bears. They don't like you any more than I did.", [
      { label: "Thanks, Hank.", cls: "green", run: () => {
        f.hankFriend = true; g.sfx.good(); g.gain(0.3, 6);
        g.ui.toast("NEW FRIEND: HANK", "The old pickup is yours. The pond is open.");
        g.say("hank" as any, "And take the truck. It's an old beater. Keys are in it. She'll get you where you're going, mostly.", [{ label: "I'll bring her back.", cls: "green", run: () => g.radio("hank" as any, "Bring her back with all four wheels. I mean it.", 5000) }] as any, "Hank, your friend");
      } },
    ] as any, "Hank — The Landowner");
  }

  // ---------------------------------------------------------------------------------------------- the pond

  // ---------------------------------------------------------------------------------------------- roll coal
  /** the four generators' exhaust stacks idle with a thin grey wisp, and every so often one of them rolls coal: a thick black plume rolls out and drifts off downwind */
  private generatorSmoke() {
    const sc = this.scene;
    const tex = new DynamicTexture("smokeT", { width: 64, height: 64 }, sc, false);
    { const c = tex.getContext() as CanvasRenderingContext2D, gr = c.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.5, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); tex.hasAlpha = true; tex.update(); }
    for (let i = 0; i < 4; i++) {
      const tx = 15 + i * 7, ps = new ParticleSystem("coal" + i, 260, sc);
      ps.particleTexture = tex; ps.emitter = new Vector3(tx - 1.85, 7.0, -2.5);
      ps.minEmitBox = new Vector3(-0.1, 0, -0.1); ps.maxEmitBox = new Vector3(0.1, 0, 0.1);
      ps.direction1 = new Vector3(0.1, 1, -0.1); ps.direction2 = new Vector3(0.45, 1, 0.1);   // up, with the wind carrying it toward +x
      ps.minEmitPower = 2.2; ps.maxEmitPower = 4.5; ps.minLifeTime = 2.6; ps.maxLifeTime = 4.8; ps.minSize = 0.7; ps.maxSize = 1.6;
      ps.addSizeGradient(0, 0.6); ps.addSizeGradient(1, 3.6);
      ps.color1 = new Color4(0.04, 0.04, 0.04, 0.8); ps.color2 = new Color4(0.1, 0.1, 0.09, 0.7); ps.colorDead = new Color4(0.2, 0.2, 0.2, 0);
      ps.gravity = new Vector3(0.7, 0.5, 0.1); ps.minAngularSpeed = -0.6; ps.maxAngularSpeed = 0.6;
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD; ps.emitRate = 0; ps.updateSpeed = 0.02;
      ps.start(); this.smoke.push({ ps, t: rnd(8, 40) + i * 11, burst: 0 });
    }
  }

  /** a flat ring of ground between a circular hole (CELL_R) and a square outline (CELL_H), so a round hole can be cut in a flat plane */
  private holeRing(y: number, mat: import("@babylonjs/core").Material, uv: (x: number, z: number) => [number, number]) {
    const N = 48, pos: number[] = [], idx: number[] = [], uvs: number[] = [], nrm: number[] = [];
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th), k = CELL_H / Math.max(Math.abs(c), Math.abs(s));
      for (const [px, pz] of [[CELL_R * c, CELL_R * s], [k * c, k * s]]) { pos.push(px, y, pz); nrm.push(0, 1, 0); uvs.push(...uv(px, pz)); }
    }
    for (let i = 0; i < N; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }   // wound to face up
    const m = new Mesh("holering", this.scene); const vd = new VertexData(); vd.positions = pos; vd.indices = idx; vd.normals = nrm; vd.uvs = uvs; vd.applyToMesh(m);
    m.material = mat; m.overrideMaterialSideOrientation = 0; m.receiveShadows = true; m.isPickable = false; m.freezeWorldMatrix();   // (clockwise, so the real textured ground material shows it from above)
  }

  // ---------------------------------------------------------------------------------------------- the cellar
  /** a 10 ft diameter, 6 ft deep cellar at the wellhead: the pad and the ground are cut open, with a steel liner, a concrete floor, a collar, a ladder and a sump */
  private cellar() {
    const sc = this.scene, H = CELL_H;
    sc.getMeshByName("padmesh")?.setEnabled(false);
    const pmat = sc.getMaterialByName("pad");
    const piece = (x0: number, z0: number, x1: number, z1: number) => {
      const m = MeshBuilder.CreateGround("padpiece", { width: x1 - x0, height: z1 - z0, subdivisions: 1, updatable: true }, sc); m.position.set((x0 + x1) / 2, 0.04, (z0 + z1) / 2);
      const pos = m.getVerticesData(VertexBuffer.PositionKind)!, uv = new Float32Array((pos.length / 3) * 2);
      for (let i = 0; i < pos.length / 3; i++) { uv[i * 2] = (pos[i * 3] + m.position.x + 60) / 120; uv[i * 2 + 1] = (pos[i * 3 + 2] + m.position.z + 65) / 130; }
      m.setVerticesData(VertexBuffer.UVKind, uv); if (pmat) m.material = pmat; m.receiveShadows = true; m.isPickable = false; m.freezeWorldMatrix();
    };
    piece(-60, -65, -H, 65); piece(H, -65, 60, 65); piece(-H, H, H, 65); piece(-H, -65, H, -H);
    if (pmat) this.holeRing(0.04, pmat, (px, pz) => [(px + 60) / 120, (pz + 65) / 130]);
    const mat = (hex: string, em = 0) => { const m = new StandardMaterial("cell" + hex, sc); m.diffuseColor = Color3.FromHexString(hex); m.specularColor = Color3.Black(); if (em) m.emissiveColor = Color3.FromHexString(hex).scale(em); return m; };
    // the liner: a corrugated steel ring from the floor to just above the pad
    const wall = MeshBuilder.CreateCylinder("cellarwall", { diameter: CELL_R * 2, height: CELL_D + 0.12, tessellation: 40, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE }, sc);
    wall.material = mat("#7d8184", 0.15); wall.position.set(0, (-CELL_D + 0.12) / 2, 0); wall.isPickable = false;
    for (let k = 0; k < 7; k++) { const rib = MeshBuilder.CreateTorus("cellarrib", { diameter: CELL_R * 2 - 0.02, thickness: 0.06, tessellation: 40 }, sc); rib.material = mat("#686c70", 0.1); rib.position.y = -CELL_D + 0.2 + k * 0.27; rib.isPickable = false; }
    const collar = MeshBuilder.CreateTorus("cellarcollar", { diameter: CELL_R * 2 + 0.12, thickness: 0.24, tessellation: 40 }, sc); collar.material = mat("#9a9a92", 0.1); collar.position.y = 0.1; collar.isPickable = false;
    const floor = MeshBuilder.CreateDisc("cellarfloor", { radius: CELL_R, tessellation: 40 }, sc); floor.rotation.x = Math.PI / 2; floor.position.y = -CELL_D + 0.01; floor.material = mat("#6a6760"); floor.isPickable = false;
    const mud = MeshBuilder.CreateDisc("cellarmud", { radius: 0.9, tessellation: 24 }, sc); mud.rotation.x = Math.PI / 2; mud.position.set(0.5, -CELL_D + 0.02, 0.6); mud.material = mat("#2e2820"); mud.isPickable = false;
    const sump = MeshBuilder.CreateCylinder("cellarsump", { diameter: 0.55, height: 0.05, tessellation: 16 }, sc); sump.position.set(-1.0, -CELL_D + 0.03, -0.9); sump.material = mat("#16181a"); sump.isPickable = false;
    // a ladder bolted to the wall on the +x side
    const rail = (z: number) => { const r = MeshBuilder.CreateBox("cellarrail", { width: 0.05, height: CELL_D + 0.9, depth: 0.05 }, sc); r.material = mat("#e8b923", 0.3); r.position.set(CELL_R - 0.1, (-CELL_D + 0.9) / 2, z); r.isPickable = false; };
    rail(-0.25); rail(0.25);
    for (let y = -CELL_D + 0.25; y < 0.8; y += 0.3) { const r = MeshBuilder.CreateBox("cellarrung", { width: 0.05, height: 0.04, depth: 0.5 }, sc); r.material = mat("#e8b923", 0.3); r.position.set(CELL_R - 0.1, y, 0); r.isPickable = false; }
  }

  // ---------------------------------------------------------------------------------------------- the skyline
  /** layered mesas and cliffs round the horizon: sculpted ground, stepped like sedimentary strata, banded in rust, tan and brown */
  private skyline() {
    const sc = this.scene;
    const mat = new StandardMaterial("cliffm", sc); mat.specularColor = Color3.Black(); mat.backFaceCulling = false;
    const bands = ["#b0805c", "#9a6c4a", "#c4966c", "#8a5e42", "#d2a97c", "#7a5238", "#c0875f"].map((h) => Color3.FromHexString(h));
    const smooth = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const N = 72, count = 20;   // a full ring, overlapping, so there is no gap anywhere
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + 0.17, R = 740 + (i % 3) * 25, cx = Math.cos(ang) * R, cz = Math.sin(ang) * R;
      const W = 420 + ((i * 53) % 220), D = 150 + ((i * 37) % 50), H = 80 + ((i * 29) % 70), seed = i * 1.7;   // their inner faces start about 640 m out; the invisible wall is at 585
      const m = MeshBuilder.CreateGround("cliff" + i, { width: W, height: D, subdivisions: N, updatable: true }, sc);
      const pos = m.getVerticesData(VertexBuffer.PositionKind)!, col = new Float32Array((pos.length / 3) * 4);
      for (let k = 0; k < pos.length / 3; k++) {
        const x = pos[k * 3], z = pos[k * 3 + 2], nx = x / (W / 2), nz = z / (D / 2);
        const e = Math.pow(Math.pow(Math.abs(nx), 3.2) + Math.pow(Math.abs(nz), 3.2), 1 / 3.2), inside = 1 - e;
        const n = Math.sin(x * 0.031 + seed) * 0.5 + Math.sin(z * 0.047 + x * 0.013 + seed) * 0.3 + Math.sin((x + z) * 0.083 + seed * 2) * 0.2;
        const wob = Math.sin(x * 0.02 + seed * 3) * 0.045 + Math.sin(z * 0.05 + seed) * 0.03;   // the cliff line wanders
        let h = H * smooth(0.0, 0.2, inside + wob) * (0.88 + 0.12 * n);
        const step = H / 7; h = h * 0.4 + (Math.floor(h / step) * step + smooth(0.0, 1, (h % step) / step) * step * 0.35) * 0.6;   // terraces: ledges and talus
        if (inside < 0.02) h = 0;
        pos[k * 3 + 1] = h;
        const band = Math.min(bands.length - 1, Math.floor((h / H) * bands.length * 1.15 + n * 0.7)), c = bands[Math.max(0, band)], dust = h < 4 ? 0.55 : 1;
        col[k * 4] = c.r * dust + 0.05; col[k * 4 + 1] = c.g * dust + 0.04; col[k * 4 + 2] = c.b * dust + 0.03; col[k * 4 + 3] = 1;
      }
      m.updateVerticesData(VertexBuffer.PositionKind, pos); m.setVerticesData(VertexBuffer.ColorKind, col);
      const nrm: number[] = []; VertexData.ComputeNormals(pos, m.getIndices()!, nrm); m.updateVerticesData(VertexBuffer.NormalKind, nrm);
      m.material = mat; m.position.set(cx, -0.05, cz); m.rotation.y = -ang + Math.PI / 2; m.isPickable = false; m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true;
    }
  }

  // ---------------------------------------------------------------------------------------------- hills
  private hills(b: Builder) {
    const sc = this.scene;
    // sagebrush on the slopes
    const sage = MeshBuilder.CreateSphere("sage", { diameter: 1, segments: 5 }, sc); sage.material = b.getMat("sage"); sage.setEnabled(false);
    for (let i = 0; i < 260; i++) {
      const x = rnd(55, 350), z = rnd(-225, 340), y = this.terrain(x, z);
      const s = sage.createInstance("sg" + i); s.position.set(x, y + 0.2, z); s.scaling.set(rnd(0.7, 1.6), rnd(0.4, 0.8), rnd(0.7, 1.6)); s.isPickable = false;
    }
  }

  // ---------------------------------------------------------------------------------------------- digging
  /** cells (2 m) within 2.5 m of anything solid that exists at start-up: the backhoe may not dig there */
  private buildBlocked(cols: AABB[]) {
    for (const c of cols) {
      if (c.y1 - c.y0 < 0.4 && !c.ramp) continue;
      const x0 = Math.floor((c.x0 - 2.5) / 2), x1 = Math.floor((c.x1 + 2.5) / 2), z0 = Math.floor((c.z0 - 2.5) / 2), z1 = Math.floor((c.z1 + 2.5) / 2);
      if ((x1 - x0) * (z1 - z0) > 4000) continue;
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) this.blockedCells.add(cx * 100003 + cz);
    }
  }
  /** may the backhoe dig at this vertex? Not the pad, the lease road, the cellar, the water, anything solid, or past the cliffs */
  readonly diggingOn = DIGGING;
  canDig(x: number, z: number): boolean {
    if (!DIGGING) return false;   // digging is switched off (the ground is still the same height field, it just can't be changed)
    if (Math.abs(x) <= 62 && z >= -67 && z <= 67) return false;
    if (Math.abs(x) < 6 && z > 36) return false;
    if (((x - POND.x) / (POND.rx * 1.12)) ** 2 + ((z - POND.z) / (POND.rz * 1.12)) ** 2 < 1) return false;
    if (Math.hypot(x, z) > 560) return false;
    return !this.blockedCells.has(Math.floor(x / 2) * 100003 + Math.floor(z / 2));
  }
  digHeight(x: number, z: number): number { return this.terrain(x, z); }
  inDig(x: number, z: number) { return this.canDig(x, z); }
  digAt(tx: number, ty: number, tz: number, dt: number): number { return this.ground.dig(tx, ty, tz, dt, (i, j) => this.canDig(i, j)); }
  pileAt(tx: number, tz: number, amt: number) { this.ground.pile(tx, tz, amt, (i, j) => this.canDig(i, j)); }

  // ---------------------------------------------------------------------------------------------- kickers
  /** big steel-and-dirt launch ramps in the pasture, built to be hit at speed heading north: you get air, and the cattle are right where you land */
  private kickers(b: Builder) {
    b.defMat("kickdirt", "#8a7050"); b.defMat("kickyellow", "#e8b923");
    for (const [kx, z0, z1, H] of [[64, 132, 158, 6.5], [58, 212, 240, 7.5], [52, 292, 318, 7]] as [number, number, number, number][]) {
      b.rampSolid(kx, 10, z0, 0, z1, H, 30);
      b.ramp("kickdirt", kx, 10, z0, 0, z1, H, 0.3);
      for (const sx of [-4.7, 4.7]) b.ramp("kickyellow", kx + sx, 0.6, z0, 0.02, z1, H + 0.02, 0.12);
      for (let i = 0; i < 5; i++) { const u = (i + 0.5) / 5; b.ramp("kickyellow", kx, 3.2, z0 + (z1 - z0) * (u - 0.04), H * (u - 0.04) + 0.03, z0 + (z1 - z0) * (u + 0.04), H * (u + 0.04) + 0.03, 0.06); }   // chevrons
      b.slab("kickdirt", kx - 5.2, 0, z1, kx + 5.2, H - 0.1, z1 + 0.6);                     // the lip drops straight off
      b.label("SEND IT", kx, H + 1.6, z1 + 0.7, 3.2, 1.0, 0, "#7a1a14", "#ffe24a", 56);
      b.slab("dsteel", kx - 4.4, H - 0.1, z1 + 0.3, kx - 4.2, H + 1.7, z1 + 0.5); b.slab("dsteel", kx + 4.2, H - 0.1, z1 + 0.3, kx + 4.4, H + 1.7, z1 + 0.5);
    }
  }

  // ---------------------------------------------------------------------------------------------- pond
  private pond(b: Builder) {
    const sc = this.scene, { x, z, rx, rz } = POND;
    // 1. the basin itself is part of the ground height field (see ground.ts); this builds what sits on and in it
    // 2. the water: a lens of translucent teal a little below the bank, so the bed shows through and darkens with depth
    const water = MeshBuilder.CreateDisc("pondwater", { radius: 1, tessellation: 72 }, sc); water.rotation.x = Math.PI / 2; water.scaling.set(rx * 0.985, rz * 0.985, 1); water.position.set(x, WATER_Y, z);
    const wm = new StandardMaterial("pondwaterm", sc); wm.diffuseColor = Color3.FromHexString("#2c6f86"); wm.specularColor = new Color3(0.9, 0.9, 0.9); wm.specularPower = 70; wm.alpha = 0.72; wm.emissiveColor = new Color3(0.03, 0.09, 0.12);
    water.material = wm; water.isPickable = false;
    // cattails round the shore
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2 + rnd(-0.02, 0.02), k = 1.0 + rnd(-0.02, 0.1);
      const rx2 = x + Math.cos(a) * rx * k, rz2 = z + Math.sin(a) * rz * k, h = rnd(1.3, 2.2);
      b.cyl("reed", rx2, h / 2, rz2, 0.05, h, { tess: 5 }); b.cyl("dwood", rx2, h, rz2, 0.11, 0.35, { tess: 6 });
    }
    // 3. a long dock out over the water, with a rowboat, a bucket and a chair; the fishing pole leans on the rail toward the pond
    const sx = x + rx, dz = z, dk0 = sx - 16, dk1 = sx + 2.2;
    b.slab("wood", dk0, 0.55, dz - 0.9, dk1, 0.65, dz + 0.9, true);
    for (let i = 0; i < 7; i++) { const px = dk0 + 0.4 + i * 3.0; b.slab("dwood", px - 0.1, -3.4, dz - 0.85, px + 0.1, 0.6, dz - 0.65); b.slab("dwood", px - 0.1, -3.4, dz + 0.65, px + 0.1, 0.6, dz + 0.85); }
    b.slab("wood", dk1, 0, dz - 0.9, dk1 + 0.8, 0.32, dz + 0.9, true);
    b.slab("dsteel", sx - 1.2, 0.65, dz + 0.3, sx - 0.6, 1.0, dz + 0.8); b.slab("dwood", sx - 2.6, 0.65, dz - 0.7, sx - 1.9, 1.15, dz - 0.1); b.slab("dwood", sx - 2.6, 1.15, dz - 0.7, sx - 2.5, 1.7, dz - 0.1);
    b.slab("wood", dk0 + 1.5, -0.38, dz + 2.0, dk0 + 6.3, -0.08, dz + 3.2); b.slab("dwood", dk0 + 1.5, -0.1, dz + 2.0, dk0 + 6.3, 0.0, dz + 2.1); b.slab("dwood", dk0 + 1.5, -0.1, dz + 3.1, dk0 + 6.3, 0.0, dz + 3.2); b.slab("dwood", dk0 + 3.7, -0.1, dz + 2.0, dk0 + 3.9, 0.0, dz + 3.2);
    b.label("PRIVATE POND\nNO FISHING (WE KNOW YOU WILL)", sx + 3.2, 1.9, dz - 3.6, 2.6, 0.9, Math.PI / 2, "#233a52", "#ffd24a", 36);
    b.slab("dwood", sx + 3.1, 0, dz - 3.7, sx + 3.25, 1.8, dz - 3.55);
    const woodM = new StandardMaterial("polem", sc); woodM.diffuseColor = Color3.FromHexString("#c9a15a"); woodM.specularColor = Color3.Black();
    this.pole = MeshBuilder.CreateCylinder("fishingpole", { diameterTop: 0.012, diameterBottom: 0.04, height: 2.3, tessellation: 6 }, sc); this.pole.material = woodM;
    this.pole.position.set(sx - 1.6, 1.8, dz + 0.78); this.pole.rotation.z = 0.22; this.pole.isPickable = false;   // the top leans out toward the water (west)
    const emi = (hex: string, alpha: number) => { const m = new StandardMaterial("fm" + hex, sc); m.emissiveColor = Color3.FromHexString(hex); m.disableLighting = true; m.alpha = alpha; m.backFaceCulling = false; return m; };
    this.bobber = MeshBuilder.CreateSphere("bobber", { diameter: 0.16, segments: 8 }, sc); this.bobber.material = emi("#e5483b", 1); this.bobber.isPickable = false; this.bobber.setEnabled(false);
    this.fline = MeshBuilder.CreateCylinder("fishline", { diameter: 0.012, height: 1, tessellation: 4 }, sc); this.fline.material = emi("#e8f0f4", 0.9); this.fline.isPickable = false; this.fline.setEnabled(false);
    this.ripple = MeshBuilder.CreateTorus("fripple", { diameter: 1, thickness: 0.04, tessellation: 20 }, sc); this.ripple.material = emi("#cfe8f4", 0.6); this.ripple.isPickable = false; this.ripple.setEnabled(false);
    for (let i = 0; i < 9; i++) {
      const m = MeshBuilder.CreateBox("duck", { width: 0.28, height: 0.2, depth: 0.42 }, sc);
      const dm = new StandardMaterial("duckm", sc); dm.diffuseColor = Color3.FromHexString(i % 2 ? "#6a5a3a" : "#2f6a3a"); dm.specularColor = Color3.Black(); m.material = dm; m.isPickable = false;
      const hd = MeshBuilder.CreateBox("duckh", { width: 0.14, height: 0.16, depth: 0.16 }, sc); hd.material = dm; hd.parent = m; hd.position.set(0, 0.17, 0.2);
      const bk = MeshBuilder.CreateBox("duckb", { width: 0.08, height: 0.04, depth: 0.1 }, sc); const bkm = new StandardMaterial("duckbm", sc); bkm.diffuseColor = Color3.FromHexString("#e0a020"); bk.material = bkm; bk.parent = m; bk.position.set(0, 0.16, 0.32);
      this.ducks.push({ m, a: rnd(0, 6.28), r: rnd(0.2, 0.9), w: rnd(0.04, 0.12) * (i % 2 ? 1 : -1) });
    }
    // the deep hole: a darker patch of water with a buoy over it
    const dm = new StandardMaterial("deepm", sc); dm.diffuseColor = Color3.FromHexString("#0d3a4c"); dm.emissiveColor = new Color3(0.0, 0.03, 0.05); dm.specularColor = Color3.Black(); dm.alpha = 0.55;
    const dp = MeshBuilder.CreateDisc("deephole", { radius: 1, tessellation: 40 }, sc); dp.rotation.x = Math.PI / 2; dp.scaling.set(DEEP.r * 0.9, DEEP.r * 0.9, 1); dp.position.set(DEEP.x, WATER_Y + 0.01, DEEP.z); dp.material = dm; dp.isPickable = false;
    const bu = MeshBuilder.CreateSphere("buoy", { diameter: 0.8, segments: 8 }, sc); const bum = new StandardMaterial("buoym", sc); bum.diffuseColor = Color3.FromHexString("#e8501c"); bum.emissiveColor = new Color3(0.25, 0.08, 0.02); bu.material = bum; bu.position.set(DEEP.x, WATER_Y + 0.2, DEEP.z); bu.isPickable = false;
    const bp2 = MeshBuilder.CreateCylinder("buoypost", { diameter: 0.08, height: 2.2, tessellation: 6 }, sc); bp2.material = bum; bp2.position.set(DEEP.x, WATER_Y + 1.4, DEEP.z); bp2.isPickable = false;
    // swimming under the surface tints the screen
    const uw = document.createElement("div"); uw.id = "underwater"; uw.style.cssText = "position:fixed;inset:0;background:rgba(24,86,112,.5);pointer-events:none;display:none;z-index:4"; document.body.appendChild(uw);
  }

  // ---------------------------------------------------------------------------------------------- the farmstead
  private farm(b: Builder) {
    const { x, z } = FARM;
    // a plain farmhouse: the gable end and the porch face the lease road (+x)
    b.slab("siding", x - 6, 0, z - 5, x + 6, 3.0, z + 5, true);
    b.slab("brick", x - 6.05, 0, z - 5.05, x + 6.05, 0.5, z + 5.05);
    b.ramp("roofm", x, 13.2, z - 5.6, 3.0, z, 4.8, 0.2); b.ramp("roofm", x, 13.2, z + 5.6, 3.0, z, 4.8, 0.2);
    for (const [hw, y0, y1] of [[5.0, 3.0, 3.6], [3.9, 3.6, 4.2], [2.7, 4.2, 4.7]] as [number, number, number][]) { b.slab("siding", x + 5.9, y0, z - hw, x + 6.0, y1, z + hw); b.slab("siding", x - 6.0, y0, z - hw, x - 5.9, y1, z + hw); }
    b.slab("brick", x + 3.4, 3.0, z - 3.6, x + 4.2, 6.2, z - 2.8);                                   // chimney
    for (const wz of [-3.3, 3.3]) { b.slab("glassd", x + 6.0, 1.2, z + wz - 0.7, x + 6.06, 2.4, z + wz + 0.7); b.slab("dwood", x + 6.0, 2.4, z + wz - 0.8, x + 6.08, 2.5, z + wz + 0.8); }
    for (const wx of [-3, 0, 3]) for (const s of [-1, 1]) b.slab("glassd", x + wx - 0.7, 1.2, z + s * 5.0 - 0.05, x + wx + 0.7, 2.4, z + s * 5.0 + 0.05);
    b.slab("dwood", x + 5.98, 0.5, z - 0.6, x + 6.06, 2.5, z + 0.6);                                  // the front door, shut
    // porch
    b.slab("wood", x + 6, 0, z - 2.6, x + 8.6, 0.55, z + 2.6, true); b.slab("wood", x + 8.6, 0, z - 1.2, x + 9.3, 0.3, z + 1.2);
    for (const pz of [-2.5, 2.5]) b.slab("dwood", x + 8.4, 0.55, z + pz - 0.1, x + 8.6, 3.0, z + pz + 0.1); b.slab("dwood", x + 6, 3.0, z - 2.7, x + 8.7, 3.15, z + 2.7);
    b.slab("dwood", x + 7.0, 0.55, z + 1.4, x + 7.7, 1.0, z + 2.1); b.slab("dwood", x + 7.55, 1.0, z + 1.4, x + 7.7, 1.6, z + 2.1);          // a rocking chair
    b.label("NO TRESPASSING\nVIOLATORS WILL BE SHOT.\nSURVIVORS WILL BE SHOT AGAIN.", x + 12.5, 1.9, z + 8, 3.0, 1.3, Math.PI / 2, "#e8e0c4", "#7a1a14", 30);
    b.slab("dwood", x + 12.4, 0, z + 7.9, x + 12.6, 1.9, z + 8.1); b.slab("dwood", x + 12.4, 0, z + 5.9, x + 12.6, 1.9, z + 6.1);
    // mailbox at the road, a rusty pickup, a few fence posts with wire
    b.slab("dwood", 6.9, 0, 233.9, 7.1, 1.1, 234.1); b.slab("steel", 6.7, 1.1, 233.6, 7.3, 1.4, 234.4); b.slab("flag", 7.3, 1.25, 233.5, 7.38, 1.7, 233.6);
    // (Hank's old pickup is a real vehicle now, parked beside the house: see vehicles.ts)
    for (let i = 0; i < 9; i++) b.slab("dwood", x + 11 - 0.06, 0, z - 14 + i * 3.2 - 0.06, x + 11 + 0.06, 1.3, z - 14 + i * 3.2 + 0.06);
    b.beam("steel", new Vector3(x + 11, 1.15, z - 14), new Vector3(x + 11, 1.15, z + 11.6), 0.03); b.beam("steel", new Vector3(x + 11, 0.7, z - 14), new Vector3(x + 11, 0.7, z + 11.6), 0.03);
    // a hay barn out back
    b.slab("rust", x - 24, 0, z - 8, x - 12, 6.0, z + 4, true); b.ramp("dsteel", x - 18, 12.4, z - 8.2, 6.0, z - 2, 7.4, 0.15); b.ramp("dsteel", x - 18, 12.4, z + 4.2, 6.0, z - 2, 7.4, 0.15);
    for (let i = 0; i < 5; i++) b.slab("reed", x - 11.6, 0.2 + i * 0.01, z - 6 + i * 2.2, x - 10.2, 1.1, z - 5 + i * 2.2);   // hay bales out front
    // Hank, on the porch, with a shotgun
    this.hank = new Human(this.scene, { shirt: "#9a2a2a", pants: "#2f4a7a", hat: "#8a6a3a", skin: "#d9a77f", vest: false, scale: 1.06, hair: "#7a7a7a" });
    this.hank.root.position.set(x + 7.4, 0.55, z - 0.8); this.hank.root.rotation.y = Math.PI / 2;
    const gun = MeshBuilder.CreateBox("shotgun", { width: 0.04, height: 0.05, depth: 0.95 }, this.scene); const gmat = new StandardMaterial("gunm", this.scene); gmat.diffuseColor = Color3.FromHexString("#2a2a2a"); gun.material = gmat;
    gun.parent = this.hank.elbowR!; gun.position.set(0.02, -0.3, 0.3); gun.rotation.x = -0.3;
    this.hank.armR.rotation.x = -0.6; this.hank.elbowR!.rotation.x = -1.2;
  }

  // ---------------------------------------------------------------------------------------------- the old silos
  private silos(b: Builder) {
    const { x, z } = SILOS;
    [[-7, 21], [0, 24], [7, 18]].forEach(([dx, H], i) => {
      const sx = x + dx;
      b.cyl("concrete", sx, H / 2, z, 6.4, H, { tess: 22, solid: true });
      for (let y = 2; y < H; y += 3.2) b.cyl("rust", sx, y, z, 6.55, 0.28, { tess: 22 });
      b.cyl("rust", sx, H + 0.9, z, 6.4, 1.8, { tess: 22, dia2: 1.4 });
      b.cyl("steel", sx, H + 2.1, z, 0.2, 1.0, { tess: 6 });
      b.slab("dsteel", sx - 0.3, 0, z + 3.2, sx + 0.3, H - 1, z + 3.35);                              // a ladder up the front
      for (let y = 0.5; y < H - 1; y += 0.5) b.slab("steel", sx - 0.25, y, z + 3.3, sx + 0.25, y + 0.06, z + 3.5);
      if (i === 1) b.slab("black", sx - 0.8, 0, z + 3.0, sx + 0.8, 1.9, z + 3.2);                      // a little door at the base
    });
    b.slab("dsteel", x - 18, 0, z - 4, x - 11, 3.4, z + 4, true); b.ramp("rust", x - 14.5, 8, z - 4.3, 3.4, z, 4.4, 0.12); b.ramp("rust", x - 14.5, 8, z + 4.3, 3.4, z, 4.4, 0.12);   // the lean-to shed
    b.slab("rust", x + 11, 0, z - 2, x + 12.5, 1.4, z + 2, true);                                       // a feed hopper
    b.label("DANGER\nNOT A SAFE ECHO CHAMBER", x - 3.5, 2.4, z + 3.4, 2.6, 0.9, 0, "#7a1a14", "#ffffff", 34);
  }

  // ---------------------------------------------------------------------------------------------- the competitor
  private rival(b: Builder) {
    const { x, z } = RIVAL, sc = this.scene;
    for (const [k, c, o] of [["futwhite", "#eef3f8"], ["futdark", "#161c28"], ["futgrey", "#8a96a6"], ["futglow", "#2ee6ff", { emissive: "#2ee6ff" }], ["futmag", "#ff3ad6", { emissive: "#ff3ad6" }], ["futglass", "#7fe9ff", { alpha: 0.3, emissive: "#1b8aa0" }]] as [string, string, { emissive?: string; alpha?: number }][]) b.defMat(k, c, o);
    // a big dark pad with a glowing grid
    b.slab("futdark", x - 40, 0, z - 40, x + 40, 0.12, z + 40);
    for (let i = -40; i <= 40; i += 8) { b.slab("futglow", x + i - 0.04, 0.12, z - 40, x + i + 0.04, 0.15, z + 40); b.slab("futglow", x - 40, 0.12, z + i - 0.04, x + 40, 0.15, z + i + 0.04); }
    // the rig: a full-size drill floor on four big legs, with the laser firing straight down through the middle (open underneath so you can see it)
    for (const [lx, lz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) { b.slab("futwhite", x + lx - 0.8, 0.12, z + lz - 0.8, x + lx + 0.8, 7.7, z + lz + 0.8, true); b.slab("futglow", x + lx - 0.82, 3.0, z + lz - 0.82, x + lx + 0.82, 3.2, z + lz + 0.82); }
    b.slab("futdark", x - 9.5, 7.7, z - 9.5, x + 9.5, 8.3, z + 9.5, true);
    b.slab("futglow", x - 9.55, 8.0, z - 9.55, x + 9.55, 8.08, z + 9.55);
    for (const s of [-1, 1]) { b.slab("futglass", x - 9.5, 8.3, z + s * 9.4 - 0.05, x + 9.5, 9.5, z + s * 9.4 + 0.05); b.blocker(x - 9.5, 8.3, z + s * 9.4 - 0.2, x + 9.5, 10.2, z + s * 9.4 + 0.2); }
    for (const sx of [-1, 1]) for (const [a0, a1] of [[-9.5, -1.6], [1.6, 9.5]]) { b.slab("futglass", x + sx * 9.4 - 0.05, 8.3, z + a0, x + sx * 9.4 + 0.05, 9.5, z + a1); b.blocker(x + sx * 9.4 - 0.2, 8.3, z + a0, x + sx * 9.4 + 0.2, 10.2, z + a1); }   // both ends have a gap where a staircase comes up
    // two futuristic staircases to the rig floor (front and back): floating dark treads with a glowing lip on a white spine, light rails, a glowing landing pad
    for (const sg of [1, -1]) {
      const x0 = x + sg * 9.5, n = 32, rise = 0.26, run = 0.3;
      b.beam("futwhite", new Vector3(x0, 8.0, z), new Vector3(x0 + sg * n * run, 0.1, z), 0.42, 6);
      for (let k = 1; k <= n; k++) {
        const top = 8.3 - k * rise, cx = x0 + sg * (k - 0.5) * run;
        b.slab("futdark", cx - run / 2, top - 0.12, z - 1.2, cx + run / 2, top, z + 1.2, true);
        b.slab("futglow", cx - sg * run / 2 + (sg > 0 ? 0 : -0.04), top - 0.01, z - 1.2, cx - sg * run / 2 + (sg > 0 ? 0.04 : 0), top + 0.02, z + 1.2);
        for (const s2 of [-1, 1]) b.blocker(cx - run / 2, top - 0.12, z + s2 * 1.3 - 0.06, cx + run / 2, top + 1.7, z + s2 * 1.3 + 0.06);   // the light rails are solid
      }
      for (const s2 of [-1, 1]) {
        b.beam("futglow", new Vector3(x0, 9.3, z + s2 * 1.3), new Vector3(x0 + sg * n * run, 1.1, z + s2 * 1.3), 0.06, 5);
        b.beam("futglow", new Vector3(x0, 8.7, z + s2 * 1.3), new Vector3(x0 + sg * n * run, 0.5, z + s2 * 1.3), 0.04, 5);
        for (let k = 0; k <= n; k += 8) { const px = x0 + sg * k * run, py = 8.3 - k * rise; b.cyl("futwhite", px, py + 0.55, z + s2 * 1.3, 0.1, 1.1, { tess: 6 }); b.sphere("futglow", px, py + 1.15, z + s2 * 1.3, 0.22, 6); }
      }
      b.cyl("futglow", x0 + sg * (n * run + 1.2), 0.15, z, 3.2, 0.05, { tess: 24 }); b.cyl("futdark", x0 + sg * (n * run + 1.2), 0.1, z, 3.5, 0.06, { tess: 24 });
    }
    // the data terminal on the rig floor, against the north wall
    b.slab("futdark", x - 1.5, 8.3, z + 7.7, x + 1.5, 9.3, z + 8.9, true); b.slab("futglow", x - 1.5, 9.3, z + 7.7, x + 1.5, 9.36, z + 8.9);
    b.label("S.I.N.G. CORE ACCESS\nCLASSIFIED: LASER DRILLING", x, 8.85, z + 7.68, 2.8, 0.9, 0, "#06101a", "#ff3ad6", 30);
    // the tower: a tapering white hex shaft ringed with light, four slim pylons, an AI core on the crown
    b.cyl("futwhite", x, 28.5, z, 7.0, 40, { tess: 8, dia2: 2.6 });
    for (let y = 12; y < 48; y += 5) { const d = 7.0 - ((y - 8.5) / 40) * 4.4; b.cyl("futglow", x, y, z, d + 0.18, 0.22, { tess: 8 }); }
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.beam("futgrey", new Vector3(x + px * 8.2, 8.3, z + pz * 8.2), new Vector3(x + px * 1.3, 47, z + pz * 1.3), 0.4, 6);
    b.cyl("futdark", x, 48.6, z, 3.4, 1.6, { tess: 12 }); b.sphere("futglow", x, 51.5, z, 4.2, 18); b.beam("futglow", new Vector3(x, 53.3, z), new Vector3(x, 62, z), 0.12);
    b.label("SINGULARITY DRILLING\nA.I. · LASER-GUIDED · PRIVATE", x + 9.52, 12.5, z, 9.0, 2.4, Math.PI / 2, "#0b1220", "#2ee6ff", 44);
    // the AI core: a white dome with a glowing eye, off to the side
    b.sphere("futwhite", x + 24, 3.4, z - 12, 8, 18); b.cyl("futdark", x + 24, 0.2, z - 12, 9.0, 0.4, { tess: 18 });
    b.cyl("futglow", x + 28.1, 3.6, z - 12, 3.2, 0.25, { axis: "x", tess: 20 }); b.cyl("futdark", x + 28.2, 3.6, z - 12, 1.4, 0.3, { axis: "x", tess: 16 }); b.cyl("futmag", x + 28.35, 3.6, z - 12, 0.7, 0.2, { axis: "x", tess: 12 });
    b.label("S.I.N.G.\nSINGULARITY INTELLIGENCE NETWORK", x + 24, 8.6, z - 12, 6.4, 1.6, Math.PI / 2, "#0b1220", "#ff3ad6", 34);
    // cooling cells and white service modules
    for (let i = 0; i < 3; i++) { b.cyl("futwhite", x - 22 + i * 5, 3, z + 22, 3.8, 6, { tess: 16, solid: true }); b.cyl("futglow", x - 22 + i * 5, 4.4, z + 22, 3.95, 0.2, { tess: 16 }); b.cyl("futglow", x - 22 + i * 5, 1.6, z + 22, 3.95, 0.2, { tess: 16 }); }
    for (const [mx, mz] of [[-26, -14], [-26, -4], [24, 14]] as [number, number][]) { b.slab("futwhite", x + mx - 4, 0.12, z + mz - 3, x + mx + 4, 3.4, z + mz + 3, true); b.slab("futglass", x + mx + 3.96, 1.4, z + mz - 2.2, x + mx + 4.02, 2.6, z + mz + 2.2); b.slab("futglow", x + mx - 4.02, 3.2, z + mz - 3, x + mx + 4.02, 3.4, z + mz + 3); }
    // the energy fence: dark posts topped with light, two glowing rails, and a gate gap toward the lease on the +x side
    const F = 44;
    for (let i = -F; i <= F; i += 5.5) for (const [px, pz] of [[x + i, z - F], [x + i, z + F], [x - F, z + i], [x + F, z + i]] as [number, number][]) { b.slab("futdark", px - 0.12, 0, pz - 0.12, px + 0.12, 2.4, pz + 0.12); b.slab("futglow", px - 0.14, 2.4, pz - 0.14, px + 0.14, 2.6, pz + 0.14); }
    const rail = (ax: number, az: number, bx: number, bz: number) => { for (const y of [1.0, 2.0]) b.beam("futglow", new Vector3(ax, y, az), new Vector3(bx, y, bz), 0.07, 5); };
    rail(x - F, z - F, x + F, z - F); rail(x - F, z + F, x + F, z + F); rail(x - F, z - F, x - F, z + F); rail(x + F, z - F, x + F, z - 4); rail(x + F, z + 4, x + F, z + F);
    b.blocker(x - F, 0, z - F, x + F, 2.4, z - F + 0.2); b.blocker(x - F, 0, z + F - 0.2, x + F, 2.4, z + F); b.blocker(x - F, 0, z - F, x - F + 0.2, 2.4, z + F);
    b.blocker(x + F - 0.2, 0, z - F, x + F, 2.4, z - 4); b.blocker(x + F - 0.2, 0, z + 4, x + F, 2.4, z + F);
    b.label("HUMAN WORKFORCE: NOT REQUIRED.\nYOU ARE NOT REQUIRED.", x + F + 0.3, 2.9, z - 8, 4.2, 1.4, Math.PI / 2, "#0b1220", "#2ee6ff", 30);
    b.label("NO COMPANY MEN.\nTRESPASSERS WILL BE OPTIMIZED.", x + F + 0.3, 2.9, z + 8, 4.2, 1.4, Math.PI / 2, "#0b1220", "#ff3ad6", 30);
    // the laser itself, firing down from the rig floor into the hole, with a glow on the ground; and the animated bits (drones, a robot arm, a spinning halo)
    const emi = (hex: string, alpha: number) => { const m = new StandardMaterial("futbeam" + hex + alpha, sc); m.emissiveColor = Color3.FromHexString(hex); m.disableLighting = true; m.alpha = alpha; m.backFaceCulling = false; m.fogEnabled = false; return m; };
    const core = MeshBuilder.CreateCylinder("laserCore", { diameter: 0.7, height: 7.6, tessellation: 12 }, sc); core.material = emi("#c8fbff", 0.95); core.position.set(x, 3.9, z); core.isPickable = false;
    const glow = MeshBuilder.CreateCylinder("laserGlow", { diameter: 2.2, height: 7.6, tessellation: 14 }, sc); glow.material = emi("#2ee6ff", 0.28); glow.position.set(x, 3.9, z); glow.isPickable = false;
    const ground = MeshBuilder.CreateDisc("laserGround", { radius: 1, tessellation: 32 }, sc); ground.rotation.x = Math.PI / 2; ground.scaling.set(4.5, 4.5, 1); ground.position.set(x, 0.18, z); ground.material = emi("#2ee6ff", 0.5); ground.isPickable = false;
    const ring = MeshBuilder.CreateTorus("crownRing", { diameter: 8, thickness: 0.18, tessellation: 40 }, sc); ring.material = emi("#ff3ad6", 0.9); ring.position.set(x, 51.5, z); ring.isPickable = false;
    const sky = MeshBuilder.CreateCylinder("uplink", { diameter: 0.5, height: 120, tessellation: 8 }, sc); sky.material = emi("#2ee6ff", 0.18); sky.position.set(x, 112, z); sky.isPickable = false;
    const drones: { m: Mesh; a: number; r: number; h: number; w: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const d = MeshBuilder.CreateCylinder("rdrone", { diameter: 1.4, height: 0.3, tessellation: 12 }, sc); const dm = new StandardMaterial("rdm", sc); dm.diffuseColor = Color3.FromHexString("#eef3f8"); dm.emissiveColor = new Color3(0.1, 0.2, 0.25); d.material = dm; d.isPickable = false;
      const eye = MeshBuilder.CreateSphere("rdeye", { diameter: 0.45 }, sc); eye.material = emi("#2ee6ff", 1); eye.parent = d; eye.position.y = -0.2;
      drones.push({ m: d, a: i * 1.6, r: 14 + i * 3, h: 14 + i * 5, w: (i % 2 ? 0.5 : -0.4) });
    }
    const arm = new TransformNode("rarm", sc); arm.position.set(x + 6, 8.3, z + 3);
    const mkBox = (par: TransformNode, w: number, h: number, d: number, px: number, py: number, pz: number, hex: string) => { const k = MeshBuilder.CreateBox("rarmb", { width: w, height: h, depth: d }, sc); const m = new StandardMaterial("rarmm" + hex, sc); m.diffuseColor = Color3.FromHexString(hex); k.material = m; k.parent = par; k.position.set(px, py, pz); k.isPickable = false; return k; };
    mkBox(arm, 1.2, 0.8, 1.2, 0, 0.4, 0, "#161c28"); const l1 = new TransformNode("rarm1", sc); l1.parent = arm; l1.position.set(0, 0.9, 0); mkBox(l1, 0.5, 0.5, 4, 0, 0, 2, "#eef3f8");
    const l2 = new TransformNode("rarm2", sc); l2.parent = l1; l2.position.set(0, 0, 4); mkBox(l2, 0.4, 0.4, 3.4, 0, 0, 1.7, "#eef3f8"); mkBox(l2, 0.7, 0.7, 0.5, 0, 0, 3.5, "#2ee6ff");
    this.fut = { core, glow, ground, ring, drones, arm, l1, l2 };
    // the crew are androids: chrome skin, white suits, patrolling inside the fence, and a big supervisor unit at the gate
    const mk = (hx: number, hz: number, scl: number, wps: [number, number][]) => {
      const h = new Human(sc, { shirt: "#dfe8f2", pants: "#cfd8e2", hat: "#f4faff", skin: "#aab6c4", vest: false, scale: scl, hair: "#aab6c4" });
      h.root.position.set(x + hx, 0.15, z + hz); this.guards.push({ h, x: x + hx, z: z + hz, wp: wps.map(([a, c]) => [x + a, z + c] as [number, number]), i: 0 });
    };
    mk(-6, -6, 1.05, [[-6, -6], [6, -6], [6, 6], [-6, 6]]); this.guards[this.guards.length - 1].up = true; mk(6, 6, 1.05, [[6, 6], [-6, 6], [-6, -6], [6, -6]]); this.guards[this.guards.length - 1].up = true;
    mk(16, 12, 1.05, [[16, 12], [16, 26], [4, 26], [4, 12]]); mk(-14, -22, 1.06, [[-14, -22], [-4, -22], [-4, -32], [-14, -32]]); mk(14, -26, 1.04, [[14, -26], [28, -26], [28, -12], [14, -12]]); mk(-14, 18, 1.05, [[-14, 18], [-30, 18], [-30, 30], [-14, 30]]);
    // the drill floor is run entirely by robots: a working crew of androids at their stations around the hole
    for (const [i, [bx, bz]] of ([[-4, -3], [4, -3], [-4, 4], [4, 4], [0, -6.5]] as [number, number][]).entries()) {
      const h = new Human(sc, { shirt: "#dfe8f2", pants: "#cfd8e2", hat: "#f4faff", skin: "#aab6c4", vest: false, scale: 1.06, hair: "#aab6c4" });
      h.root.position.set(x + bx, 8.3, z + bz); h.root.rotation.y = Math.atan2(-bx, -bz);
      this.floorBots.push({ h, x: x + bx, z: z + bz, ph: i * 1.3, ang: h.root.rotation.y });
    }
    this.rusty = new Human(sc, { shirt: "#161c28", pants: "#2a3446", hat: "#2ee6ff", skin: "#d8e0e8", vest: false, scale: 1.14, hair: "#d8e0e8" });
    this.rusty.root.position.set(x + F - 3, 0.15, z); this.rusty.root.rotation.y = Math.PI / 2;
  }

  // ---------------------------------------------------------------------------------------------- the taco truck
  private taco(b: Builder) {
    const { x, z } = TACO;
    b.slab("tacowhite", x - 1.2, 0.9, z - 2.7, x + 1.2, 3.4, z + 2.7, true); b.slab("tacored", x - 1.22, 0.9, z - 2.73, x + 1.22, 1.5, z + 2.73);       // body with a red skirt
    b.slab("tacored", x - 1.1, 0.9, z + 2.7, x + 1.1, 2.7, z + 4.6, true); b.slab("glassd", x - 1.0, 1.7, z + 4.58, x + 1.0, 2.55, z + 4.64);       // cab
    b.slab("steel", x - 1.25, 0.8, z - 2.5, x + 1.25, 0.95, z + 4.7);
    for (const wx of [-1.3, 1.3]) for (const wz of [-1.6, 1.4, 3.8]) b.cyl("black", x + wx, 0.5, z + wz, 1.0, 0.36, { axis: "x", tess: 14 });
    b.slab("black", x + 1.22, 1.75, z - 1.6, x + 1.3, 2.65, z + 1.6);                                  // the serving window
    b.slab("tacored", x + 1.2, 2.9, z - 2.0, x + 3.2, 3.0, z + 2.0); for (const pz of [-1.9, 1.9]) b.slab("steel", x + 3.1, 0.9, z + pz - 0.04, x + 3.16, 2.9, z + pz + 0.04);   // awning
    for (let i = 0; i < 9; i++) b.slab("bulb", x + 3.05, 2.8, z - 1.9 + i * 0.475, x + 3.17, 2.88, z - 1.8 + i * 0.475);    // string lights
    b.slab("wood", x + 1.3, 1.5, z - 1.6, x + 1.9, 1.58, z + 1.6);                                       // counter
    b.slab("wood", x + 2.6, 0, z - 1.7, x + 3.0, 0.95, z + 1.7, true);                                   // front table
    b.slab("dwood", x + 1.2, 3.4, z - 0.1, x + 1.26, 4.9, z + 0.1); b.label("TACOS", x + 1.32, 4.5, z, 3.4, 1.1, Math.PI / 2, "#c8331f", "#ffe9a8", 70);
    b.label("EL FUEGO TACOS\nCASH ONLY · NO REFUNDS ON SPICE", x + 1.23, 3.15, z, 3.3, 0.5, Math.PI / 2, "#233a52", "#ffd24a", 24);
    for (const [sx, sz] of [[5.2, -3], [5.2, 3.6]]) { b.cyl("tacored", x + sx, 0.4, z + sz, 0.7, 0.1, { tess: 10 }); b.cyl("steel", x + sx, 0.2, z + sz, 0.12, 0.4, { tess: 6 }); }   // two stools
    this.lupe = new Human(this.scene, { shirt: "#ece8de", pants: "#2a2a2a", hat: null, skin: "#c99870", vest: false, scale: 1.0, hair: "#1a1a1a" });
    this.lupe.root.position.set(x + 2.0, 0.1, z - 0.2); this.lupe.root.rotation.y = Math.PI / 2;
  }

  // ---------------------------------------------------------------------------------------------- the cattle
  private cattle() {
    const sc = this.scene;
    const variants: [string, string][] = [["#f1efe8", "#1e1e1e"], ["#6b4a2b", "#e9e2d0"], ["#232323", "#3a3a3a"], ["#9a6a3a", "#f1efe8"]];
    const srcs = variants.map(([body, patch], vi) => {
      const mat = (hex: string) => { const m = new StandardMaterial("cow" + vi + hex, sc); m.diffuseColor = Color3.FromHexString(hex); m.specularColor = Color3.Black(); return m; };
      const bm = mat(body), pm = mat(patch), dk = mat("#1a1a1a"), pk = mat("#d9a0a0");
      const part = (w: number, h: number, d: number, m: StandardMaterial, x: number, y: number, z: number) => { const bx = MeshBuilder.CreateBox("cowp", { width: w, height: h, depth: d }, sc); bx.material = m; bx.position.set(x, y, z); bx.setEnabled(false); return bx; };
      return [
        part(0.78, 0.74, 1.7, bm, 0, 1.0, 0), part(0.2, 0.62, 0.2, bm, -0.26, 0.31, 0.6), part(0.2, 0.62, 0.2, bm, 0.26, 0.31, 0.6), part(0.2, 0.62, 0.2, bm, -0.26, 0.31, -0.6), part(0.2, 0.62, 0.2, bm, 0.26, 0.31, -0.6),
        part(0.42, 0.42, 0.55, bm, 0, 1.25, 1.05), part(0.06, 0.55, 0.06, dk, 0, 0.95, -0.9), part(0.8, 0.5, 0.6, pm, 0.0, 1.12, 0.1), part(0.34, 0.2, 0.2, pk, 0, 1.12, 1.36),
        part(0.08, 0.12, 0.16, dk, -0.24, 1.5, 0.95), part(0.08, 0.12, 0.16, dk, 0.24, 1.5, 0.95),
      ];
    });
    for (let i = 0; i < 38; i++) {
      const n = new TransformNode("cow" + i, sc), vs = srcs[i % srcs.length];
      vs.forEach((s, k) => { const ins = s.createInstance("c" + i + "_" + k); ins.parent = n; ins.isPickable = false; });
      const x = rnd(PASTURE.x0, PASTURE.x1), z = rnd(PASTURE.z0, PASTURE.z1), h = rnd(0, 6.28);
      n.position.set(x, 0, z); n.rotation.y = h; n.scaling.setAll(rnd(0.92, 1.12));
      this.cows.push({ n, x, z, h, sp: 0, t: rnd(0, 5), flee: 0, down: 0 });
    }
  }

  // ---------------------------------------------------------------------------------------------- interactions
  interacts(): It[] {
    const g = this.g, v = (x: number, y: number, z: number) => new Vector3(x, y, z), cdOk = (k: string, s: number) => { const now = this.t; if ((this.cd[k] ?? -99) + s > now) return false; this.cd[k] = now; return true; };
    const out: It[] = [];
    // the cellar ladder: down from the rim, up from the floor
    out.push({ pos: () => v(CELL_R + 0.5, 1.0, 0), label: () => "Climb down into the cellar", r: 2.0, ok: () => g.player.pos.y > -0.5 && Math.hypot(g.player.pos.x, g.player.pos.z) > CELL_R, act: () => { g.sfx.click(); g.player.teleport(CELL_R - 0.6, -CELL_D + 0.02, 0, -Math.PI / 2); } });
    out.push({ pos: () => v(CELL_R - 0.5, -CELL_D + 1.1, 0), label: () => "Climb up the ladder", r: 2.0, ok: () => g.player.pos.y < -0.5, act: () => { g.sfx.click(); g.player.teleport(CELL_R + 0.9, 0.05, 0, Math.PI / 2); } });
    // pond
    let skips = 0, fishN = 0;
    const shore = () => v(POND.x + POND.rx + 1.2, 1.2, POND.z + 6);
    out.push({ pos: shore, label: () => "Skip a rock", r: 3.2, act: () => {
      g.sfx.click(); const n = Math.floor(rnd(0, 8)); skips++; g.ui.toast(n === 0 ? "KERPLUNK" : `${n} SKIP${n > 1 ? "S" : ""}`, n === 0 ? "It sinks like a stone. It was a stone." : n >= 6 ? "Personal best. Nobody saw it." : "Not bad for a Company Man.");
      if (n >= 6 && cdOk("skipgain", 20)) g.gain(0, 2); } });
    void fishN;
    // fishing is something you do at the dock: stand at the end of it, E (or a click) to cast, again to set the hook when the bobber dips, again to reel in
    // fishing is something you do from anywhere along the shore (once Hank is a friend): hold to charge the cast, release to throw it, R / F or the wheel to set how deep the bait sinks
    out.push({ pos: () => this.shorePoint(), label: () => !g.flags.hankFriend ? "Hank's pond (make friends with Hank first)" : this.fish.st === "idle" ? "Fish the pond: hold to charge a cast" : this.fish.st === "bite" ? "SET THE HOOK!" : this.fish.st === "charge" ? "Release to cast" : "Reel in", r: 6, ok: () => this.nearShore(), act: () => {
      if (!g.flags.hankFriend) { g.sfx.click(); g.ui.toast("HANK'S POND", "Hank's pond, Hank's fish. Go and make friends with Hank first. (Not near the pond.)"); return; }
      const r = this.fishClick(); if (r) { g.sfx.click(); g.ui.toast(r[0], r[1]); } } });
    // taco truck
    out.push({ pos: () => v(TACO.x + 3.2, 1.3, TACO.z), label: () => "Order tacos", r: 3.4, act: () => this.orderTacos() });
    // the landowner
    let hankN = 0;
    out.push({ pos: () => this.hank.root.position.add(v(0, 1.2, 0)), label: () => "Talk to Hank", r: 3.2, act: () => { void hankN; this.talkHank(); } });
    out.push({ pos: () => v(FARM.x + 6.6, 1.3, FARM.z), label: () => "Knock on the farmhouse door", r: 2.6, act: () => { g.sfx.click(); g.ui.toast("KNOCK KNOCK", "Hank is already standing behind you."); if (cdOk("hankbehind", 10)) setTimeout(() => g.radio("hank" as any, "I'M RIGHT HERE.", 3500), 800); } });
    let mailN = 0;
    out.push({ pos: () => v(7, 1.2, 234), label: () => "Check the mailbox", r: 2.4, act: () => {
      g.sfx.click(); const L = ["Surface-damage claim #7 of 7. PAST DUE. Signed, Hank.", "A seed catalog. Somebody underlined 'BARBED WIRE'.", "A letter from Houston: 'We value our landowners.' It's addressed to 'Occupant'.", "A very small check. The memo line says 'for the noise'."];
      g.ui.toast("MAILBOX", L[mailN++ % L.length]); } });
    // silos
    out.push({ pos: () => v(SILOS.x, 1.4, SILOS.z + 4.4), label: () => "Shout into the silo", r: 3.2, act: () => {
      g.sfx.click(); g.ui.toast("YOU SHOUT", "“HELLO!”");
      ["HELLO…", "hello…", "…hello…"].forEach((t, i) => setTimeout(() => g.ui.toast("ECHO", t), 700 + i * 650));
      if (cdOk("silogain", 25)) setTimeout(() => g.gain(0, 1), 2500); } });
    // the competitor
    let rustN = 0;
    out.push({ pos: () => this.rusty.root.position.add(v(0, 1.2, 0)), label: () => "Talk to UNIT-9 (Singularity supervisor unit)", r: 3.4, act: () => this.talkRusty(rustN++) });
    out.push({ pos: () => v(RIVAL.x + 50, 1.4, RIVAL.z - 8), label: () => "Break into their rig (steal the laser secrets)", r: 3.6, ok: () => !g.doneIds.has("secrets") && !(g.active && g.active.m.id === "secrets"), act: () => { if (!g.startSide("secrets")) g.ui.toast("NOT NOW", "Finish what you're on first."); } });
    out.push({ pos: () => this.terminalPos(), label: () => "Grab Singularity's secrets", r: 3.4, ok: () => !!g.flags.raidOn && !g.flags.secretsGot, act: () => { g.flags.secretsGot = true; g.sfx.good(); g.ui.toast("GOT THE SECRETS", "Laser drilling schematics. NOW RUN!"); g.radio("rival" as any, "UNAUTHORIZED DATA TRANSFER. ALL UNITS: REMOVE THE COMPANY MAN.", 5000); } });
    out.push({ pos: () => v(RIVAL.x + 47, 1.4, RIVAL.z + 8), label: () => "Spy on their rig", r: 3.4, act: () => {
      g.sfx.click(); g.ui.toast("YOU SQUINT", pick(["They're at 14,000 feet. In nine minutes. With a laser. Houston is not going to like this.", "The laser has no depth board. It has a feeling.", "Every worker on location is made of chrome. They look right through you.", "The rig is taller than ours. You decide it's a safety issue.", "Nobody here is wearing a hard hat. Nobody here is wearing anything. It's all very efficient."])); if (cdOk("spy", 20)) g.gain(0, -1); } });
    // the cattle: the nearest one, wherever it is
    out.push({ pos: () => { const c = this.cows[this.nearCow]; return c ? v(c.x, 1.3, c.z) : v(0, -999, 0); }, label: () => "Moo at the cow", r: 3.2, ok: () => { const c = this.cows[this.nearCow]; return !!c && Math.hypot(c.x - g.player.pos.x, c.z - g.player.pos.z) < 4.2; }, act: () => {
      g.sfx.click(); const c = this.cows[this.nearCow]; if (!c) return;
      g.ui.toast("MOOOOO", pick(["The cow moos back. It's not impressed.", "It looks at you for a very long time.", "You've made a friend. Possibly.", "The herd turns to look. All of it."]));
      for (const o of this.cows) if (Math.hypot(o.x - c.x, o.z - c.z) < 14) { o.flee = 2.5; o.h = Math.atan2(o.x - g.player.pos.x, o.z - g.player.pos.z); } } });
    return out;
  }

  private nearShore() { const p = this.g.player.pos; const u = ((p.x - POND.x) / POND.rx) ** 2 + ((p.z - POND.z) / POND.rz) ** 2; return u < 1.7 && this.terrain(p.x, p.z) > -0.6; }
  private shorePoint() { const p = this.g.player.pos, dx = (p.x - POND.x) / POND.rx, dz = (p.z - POND.z) / POND.rz, l = Math.hypot(dx, dz) || 1; return new Vector3(POND.x + (dx / l) * POND.rx * 0.97, 1.2, POND.z + (dz / l) * POND.rz * 0.97); }
  fishSave() { return { caught: this.fish.caught, best: this.fish.best }; }
  fishLoad(d: { pole?: boolean; caught?: number; best?: number } | undefined) { if (!d) return; this.fish.caught = d.caught ?? 0; this.fish.best = d.best ?? 0; }
  private stopFishing() { const f = this.fish; f.st = "idle"; if (this.rodBody) this.rodBody.setEnabled(false); if (this.rodCam) this.rodCam.setEnabled(false); this.bobber.setEnabled(false); this.fline.setEnabled(false); this.ripple.setEnabled(false); if (this.fishHud) this.fishHud.style.display = "none"; }
  /** press: start charging a cast, set the hook on a bite, or reel in */
  fishClick(): [string, string] | null {
    const g = this.g, f = this.fish;
    if (f.st === "idle") { f.st = "charge"; f.power = 0; f.pdir = 1; return ["CHARGING", "Hold to power up, release to cast. The farther you cast, the deeper the water."]; }
    if (f.st === "charge") return null;
    if (f.st === "bite") {
      this.stopFishing();
      const deepHole = (f.bx - DEEP.x) ** 2 + (f.bz - DEEP.z) ** 2 < (DEEP.r * 1.05) ** 2, onBottom = f.depth >= f.bed - 1.4;
      const sixty = deepHole && f.depth >= 5 && !!g.flags.sixtyOn && !g.flags.sixty && Math.random() < 0.4;
      if (sixty) { this.fightSixty(); return ["HOOKED", "That's not a small fish."]; }
      // what is down there depends on how deep you fish: the shallows, the middle, the deep water, and the deep hole's bottom (lost steerable tools)
      let T: [string, number, number, number, string, string][];
      if (deepHole && onBottom) T = [["RSS Steering Pad", 18000, 30000, 26, "A hydraulically actuated pad. It still has a little give.", "pad"], ["RSS Bias Unit", 80000, 120000, 14, "The part that actually steers the bit. Tex has been looking for this.", "bias"], ["RSS Control Sub", 40000, 70000, 22, "Electronics. It stopped talking a long time ago.", "sub"], ["Complete RSS Tool", 250000, 400000, 3, "The whole thing. It looks promising. It always did.", "rss"], ["Pond Boot", 0, 0, 20, "Not RSS. Just a boot.", "boot"], ["Rusty Can", 0, 0, 15, "Beans. Possibly from a decade ago.", "can"]];
      else if (f.depth < 1.5) T = [["Bluegill", 0.3, 0.9, 40, "Small, shiny, offended.", "bluegill"], ["Crappie", 0.5, 2, 25, "Perfectly fine. Nobody has ever been excited about a crappie.", "crappie"], ["Largemouth Bass", 1.5, 6, 18, "A proper fish.", "bass"], ["Pond Boot", 0, 0, 10, "Left foot.", "boot"], ["Rusty Can", 0, 0, 7, "Spam, maybe.", "can"]];
      else if (f.depth < 4) T = [["Largemouth Bass", 1.5, 6, 34, "A proper fish.", "bass"], ["Channel Catfish", 2, 12, 28, "It has whiskers and opinions.", "catfish"], ["Crappie", 0.5, 2, 12, "Mid-depth crappie.", "crappie"], ["The Lunker", 9, 14, 3, "Old as the pond.", "lunker"], ["Pond Boot", 0, 0, 12, "Right foot this time.", "boot"], ["Rusty Can", 0, 0, 11, "Still sealed.", "can"]];
      else T = [["Channel Catfish", 6, 30, 46, "Big, slow and unimpressed.", "catfish"], ["Flathead Catfish", 12, 40, 14, "It eats other fish and holds a grudge.", "catfish"], ["Largemouth Bass", 3, 9, 20, "It came up from the cold water.", "bass"], ["The Lunker", 9, 16, 6, "Old as the pond.", "lunker"], ["Pond Boot", 0, 0, 8, "Waterlogged.", "boot"], ["Rusty Can", 0, 0, 6, "Nothing good lives in a can.", "can"]];
      let r = Math.random() * T.reduce((a, c) => a + c[3], 0), c = T[0]; for (const x of T) { r -= x[3]; if (r <= 0) { c = x; break; } }
      const [name, lo, hi, , quip, id] = c, val = lo + Math.random() * (hi - lo);
      f.caught++; g.sfx.good();
      let sub: string; const deep = deepHole && onBottom;
      if (deep) {
        const value = Math.round(val / 1000) * 1000;
        if (id === "rss") {
          // the whole tool: the vendor credits the lost-in-hole charge from the last well, and the credit lands on THIS well's AFE
          const credit = 500000; g.sim.addCost(-credit); g.gain(0, 8); g.award("rss");
          sub = `LIH credit: $${credit.toLocaleString("en-US")} for the tool lost in hole on the last well, applied to THIS well's AFE.`;
          g.radio("tex", "THAT'S THE WHOLE RSS! I'll never lose anything again. (I will. I'll lose it again.)", 7000);
          setTimeout(() => g.radio("brent", "Accounting says the vendor reverses the lost-in-hole charge from the last run. It lands on this well. Don't ask how that works.", 9000), 3500);
        } else if (value > 0) { g.sim.addCost(-Math.round(value * 0.25)); g.gain(0, 3); sub = `Est. value $${value.toLocaleString("en-US")}. Insurance recovery credits $${Math.round(value * 0.25).toLocaleString("en-US")} to the AFE.`; }
        else sub = "Worth nothing, and you got it from the bottom of the deep hole.";
      } else {
        if (val > f.best) f.best = val;
        if (id === "lunker") { g.gain(0, 5); g.radio("hank" as any, "THAT'S THE LUNKER! He's been in that pond since '94! Put him BACK, Company Man!", 7000); } else if (f.caught % 2 === 0 && val > 0) g.gain(0, 1);
        sub = val > 0 ? `${val.toFixed(1)} lb${val >= f.best ? ". New personal best." : "."}` : "No weight to speak of.";
      }
      this.showCatch(name, `${sub} ${quip}`, id, deep);
      return [`CAUGHT: ${name.toUpperCase()}`, `${quip} (${f.caught} caught)`];
    }
    this.stopFishing();
    return ["REELED IN", "Nothing on the hook. Patience is a virtue. You are not virtuous."];
  }
  /** Old Sixty, a sixty-pound catfish in the deep water: a fight you win by mashing */
  private fightSixty() {
    const g = this.g;
    g.ui.toast("OLD SIXTY!", "The line is screaming. Reel!"); g.sfx.thud();
    g.mini.mash({ eyebrow: "The Big Catfish", title: "Old Sixty", intro: "Sixty pounds of whiskers and bad attitude. Reel him in before the line breaks.", seconds: 9, label: "reel!" }, (r: any) => {
      if (r && r.skipped) { g.radio("hank" as any, "You let go of OLD SIXTY?! I've been after him for thirty years!", 6000); return; }
      if (r && r.score < 0.45) { g.ui.toast("LINE SNAPPED", "He's gone. He looked back at you."); g.radio("hank" as any, "He snapped it. He does that. Try again, he'll be back.", 6000); return; }
      g.flags.sixty = true; this.fish.caught++; g.sfx.good(); g.gain(0.4, 12);
      this.showCatch("OLD SIXTY", "62.4 lb. Whiskers like a Texas senator. Hank will want a photo.", "catfish", false, "THE BIG ONE");
      g.radio("hank" as any, "THAT'S HIM. THAT'S OLD SIXTY. Thirty years. Put him back, put him BACK, then take a picture first.", 9000);
    });
  }
  private catchEl: HTMLDivElement | null = null; private catchT = 0;
  /** a card with a picture of what you caught */
  private showCatch(name: string, sub: string, id: string, deep: boolean, head?: string) {
    if (!this.catchEl) {
      const d = document.createElement("div"); d.id = "catchcard";
      d.style.cssText = "position:fixed;left:50%;top:88px;transform:translateX(-50%);z-index:30;width:300px;padding:10px;border:3px solid #000;border-radius:10px;background:rgba(10,16,24,.92);box-shadow:0 0 0 2px rgba(244,192,74,.9),4px 6px 0 2px rgba(0,0,0,.6);color:#fff;text-align:center;font-family:inherit;pointer-events:none;transition:opacity .3s;opacity:0";
      d.innerHTML = '<div class="cc-k" style="font-size:11px;letter-spacing:2px;color:#f4c04a;font-weight:800"></div><canvas width="260" height="150" style="width:100%;border-radius:6px;margin:6px 0;background:#173a4a"></canvas><div class="cc-n" style="font-size:22px;font-weight:800;line-height:1.1"></div><div class="cc-s" style="font-size:12px;margin-top:4px;color:#cfe0ea"></div>';
      document.body.appendChild(d); this.catchEl = d;
    }
    const d = this.catchEl!;
    (d.querySelector(".cc-k") as HTMLElement).textContent = head ?? (deep ? "FROM THE DEEP HOLE" : "CAUGHT");
    (d.querySelector(".cc-n") as HTMLElement).textContent = name; (d.querySelector(".cc-s") as HTMLElement).textContent = sub;
    drawCatch(d.querySelector("canvas") as HTMLCanvasElement, id, deep);
    d.style.opacity = "1"; this.catchT = 5.5;
  }
  private updateFishing(dt: number) {
    if (this.catchT > 0) { this.catchT -= dt; if (this.catchT <= 0 && this.catchEl) this.catchEl.style.opacity = "0"; }
    const g = this.g, p = g.player, f = this.fish;
    if (!this.fishHud) { const d = document.createElement("div"); d.style.cssText = "position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:8;display:none;min-width:260px;padding:8px 14px;background:rgba(10,16,24,.88);border:2px solid #4fd6ff;color:#fff;font:700 13px system-ui,sans-serif;text-align:center;pointer-events:none"; document.body.appendChild(d); this.fishHud = d; }
    const hud = this.fishHud!;
    if (f.st === "idle") { hud.style.display = "none"; if (this.rodBody) this.rodBody.setEnabled(false); if (this.rodCam) this.rodCam.setEnabled(false); return; }
    if (Math.hypot(p.pos.x - f.sx, p.pos.z - f.sz) > 9 && f.st !== "charge") { this.stopFishing(); g.ui.toast("FISHING", "You reel the line in."); return; }
    // he holds a rod: the body turns to face the water, the right arm comes up, and the line runs from the rod tip
    p.body.root.rotation.y = p.yaw; p.body.useHand("rod", 0.4);
    const rod = this.rodsFor(p.third); this.rodBody!.setEnabled(p.third); this.rodCam!.setEnabled(!p.third);
    rod.computeWorldMatrix(true); const tip = Vector3.TransformCoordinates(new Vector3(0, 1.15, 0), rod.getWorldMatrix());
    hud.style.display = "block";
    if (f.st === "charge") {
      f.power += f.pdir * dt * 0.9; if (f.power >= 1) { f.power = 1; f.pdir = -1; } if (f.power <= 0) { f.power = 0; f.pdir = 1; }
      hud.innerHTML = '<div style="font-size:10px;letter-spacing:2px;color:#4fd6ff">CAST</div><div style="height:12px;background:#1b2836;margin:6px 0"><div style="height:100%;width:' + Math.round(f.power * 100) + '%;background:' + (f.power > 0.85 ? "#ff6a3d" : "#4fd6ff") + '"></div></div>release to throw';
      if (!this.eHeld) {
        const dist = 4 + f.power * 24, tx = p.pos.x + Math.sin(p.yaw) * dist, tz = p.pos.z + Math.cos(p.yaw) * dist;
        if (((tx - POND.x) / POND.rx) ** 2 + ((tz - POND.z) / POND.rz) ** 2 > 0.92) { this.stopFishing(); g.ui.toast("SPLASH IN THE DIRT", "You can't catch anything in dirt. Face the water, and charge it up."); return; }
        f.st = "fly"; f.t = 0; f.sx = p.pos.x; f.sz = p.pos.z; f.bx = tx; f.bz = tz; f.bed = Math.max(0.5, -this.baseTerrain(tx, tz)); f.depth = Math.min(f.depth, Math.max(0.5, f.bed - 0.3));
        this.bobber.setEnabled(true); this.fline.setEnabled(true); g.sfx.click();
      }
      return;
    }
    // R / F and the wheel set how deep the bait sinks (and so what is down there)
    hud.innerHTML = (f.st === "bite" ? '<div style="color:#ff6a3d;font-size:15px">BITE! CLICK NOW</div>' : '<div style="font-size:10px;letter-spacing:2px;color:#4fd6ff">LINE OUT</div>') + 'depth <b>' + f.depth.toFixed(1) + ' m</b> of ' + f.bed.toFixed(1) + ' m  ·  R deeper · F shallower · wheel';
    if (f.st === "fly") {
      f.t += dt / 0.6; const u = Math.min(1, f.t);
      this.bobber.position.set(tip.x + (f.bx - tip.x) * u, tip.y + (WATER_Y + 0.08 - tip.y) * u + Math.sin(Math.PI * u) * 2.4, tip.z + (f.bz - tip.z) * u);
      if (u >= 1) { f.st = "wait"; f.t = rnd(2.5, 7.5); g.sfx.click(); this.ripple.setEnabled(true); this.ripple.position.set(f.bx, WATER_Y + 0.02, f.bz); this.ripple.scaling.set(0.3, 1, 0.3); }
    } else if (f.st === "wait") {
      f.t -= dt; this.bobber.position.set(f.bx, WATER_Y + 0.08 + Math.sin(this.t * 2.2) * 0.015, f.bz);
      const k = ((this.t * 0.6) % 1); this.ripple.scaling.set(0.3 + k * 1.2, 1, 0.3 + k * 1.2); (this.ripple.material as StandardMaterial).alpha = 0.6 * (1 - k);
      if (f.t <= 0) { f.st = "bite"; f.bite = 1.3; g.sfx.thud(); g.ui.toast("BITE!", "Click now!"); }
    } else if (f.st === "bite") {
      f.bite -= dt; this.bobber.position.set(f.bx + Math.sin(this.t * 40) * 0.03, WATER_Y - 0.02 + Math.sin(this.t * 25) * 0.04, f.bz);
      const k = ((this.t * 3) % 1); this.ripple.scaling.set(0.4 + k * 1.6, 1, 0.4 + k * 1.6); (this.ripple.material as StandardMaterial).alpha = 0.8 * (1 - k);
      if (f.bite <= 0) { this.stopFishing(); g.ui.toast("IT GOT AWAY", "Too slow. It looked smug about it."); return; }
    }
    // the line, from the angler's hands to the bobber
    const a = tip, b2 = this.bobber.position, d = b2.subtract(a), len = d.length();
    if (len > 0.05) { this.fline.position.copyFrom(a.add(b2).scale(0.5)); this.fline.scaling.y = len; if (!this.fline.rotationQuaternion) this.fline.rotationQuaternion = new Quaternion(); Quaternion.FromUnitVectorsToRef(Vector3.Up(), d.scale(1 / len), this.fline.rotationQuaternion); }
  }

  private orderTacos() {
    const g = this.g;
    g.say("taco" as any, "Buenos días, jefe. Best tacos east of the Pecos. What'll it be?", [
      { label: "Al pastor ($4)", cls: "green", run: () => { g.sim.addCost(4); g.flags.taco = ((g.flags.taco as number | undefined) ?? 0) + 1; g.gain(0, 5); g.radio("taco" as any, "Good choice. Don't tell Houston where you got them.", 6000); g.ui.toast("+5 MORALE", "Worth every peso."); } },
      { label: "Fish taco ($5)", run: () => { g.sim.addCost(5); g.flags.taco = ((g.flags.taco as number | undefined) ?? 0) + 1; g.gain(0, 2); g.radio("taco" as any, "It's Tuesday. It's… fine.", 5000); g.ui.toast("+2 MORALE", "Questionable, but warm."); } },
      { label: "The Suicide Taco ($6)", cls: "alt", run: () => { g.sim.addCost(6); g.flags.taco = ((g.flags.taco as number | undefined) ?? 0) + 1; g.gain(0, 8); g.radio("taco" as any, "No refunds.", 4000); g.ui.toast("+8 MORALE", "You can see through time."); setTimeout(() => g.radio("earl", "Boss, what is that smell? And why are you sweating?", 7000), 12000); } },
      { label: "Nothing, thanks", cls: "alt", run: () => { g.radio("taco" as any, "The offer stands. Always.", 4000); } },
    ] as any, "El Fuego Tacos");
  }

  private talkHankOld(n: number) {
    const g = this.g;
    const L = ["You're on my land.", "I said, you're on my land.", "Your rig vibrates my windows. My wife's china is on the floor. I don't have a wife. I had one. The china was nice.", "Eleven times your people have driven across my pasture. ELEVEN.", "…You drilling for oil or just making noise?", "Fine. You seem all right. For a Company Man. Take a beer. It's warm."];
    const i = Math.min(n, L.length - 1);
    const choices = i < L.length - 1
      ? [{ label: "Sorry, sir.", run: () => g.radio("hank" as any, "Sorry don't fix my china.", 5000) }, { label: "We're drilling. It's legal.", cls: "alt", run: () => g.radio("hank" as any, "So is my shotgun.", 5000) }]
      : [{ label: "Take the beer", cls: "green", run: () => { g.gain(0, 4); g.ui.toast("+4 MORALE", "It is, in fact, warm."); g.radio("hank" as any, "Don't tell anybody I'm nice.", 5000); } }, { label: "No thanks", cls: "alt", run: () => {} }];
    g.say("hank" as any, L[i], choices as any, "Hank — The Landowner");
  }

  private talkRusty(n: number) {
    const g = this.g;
    const L = ["GREETINGS, COMPANY MAN. I AM UNIT-9, SUPERVISING UNIT FOR THIS LOCATION. YOUR HARD HAT HAS A 3% PROBABILITY OF MATTERING.", "Our laser drills 14,000 feet in nine minutes. I ran the numbers on your rig. The numbers laughed. I do not laugh. The numbers did.", "Singularity is currently being a very large, very distant server. He has noted your trespass. He has noted it twice.", "Go home, Company Man. Take your sad little pad with you. I have already deprecated it."];
    g.say("rival" as any, L[n % L.length], [
      { label: "Nice fence.", run: () => g.radio("rival" as any, "IT IS AN ENERGY FENCE. IT IS NOT FOR YOU. IT IS FOR EVERYBODY WHO IS YOU.", 5000) },
      { label: "Make a rude gesture", cls: "alt", run: () => { g.gain(0, 2); g.ui.toast("+2 MORALE", "The android crew files a formal complaint. In triplicate."); for (const gd of this.guards) { gd.i = 0; } } },
    ] as any, "UNIT-9 — Singularity A.I.");
  }

  /** caught: thrown out of the gate, and the job starts over (as many tries as you like) */
  private throwOut() {
    const g = this.g, p = g.player;
    this.raidCd = 6; g.flags.secretsGot = false; g.award("thrown");
    p.teleport(RIVAL.x + 52, 0.5, RIVAL.z + 2, Math.PI / 2); g.sfx.thud(); g.gain(0, -1);
    for (const gd of this.guards) gd.i = 0;
    g.ui.toast("THROWN OUT", pick(["Back to the gate. Try it again.", "ESCORT COMPLETE. Go again.", "They carried you out like a lawn chair. Go again."]));
    g.radio("rival" as any, "ESCORT COMPLETE. YOU MAY ATTEMPT TO TRESPASS AGAIN. IT WILL NOT HELP.", 4000);
    if (g.active && g.active.m.id === "secrets") { g.active.i = 0; g.ui.setMission(g.active.m.title, g.active.m.steps[0].text, g.jobLabel(g.active.m)); }
  }

  // ---------------------------------------------------------------------------------------------- per frame
  update(dt: number) {
    const g = this.g, p = g.player; this.t += dt;
    const px = p.pos.x, pz = p.pos.z;
    // discoveries
    for (const [name, x, z, r] of [["PRIVATE POND: THERE IS A DEEP HOLE", POND.x, POND.z, 120], ["THE BREAKS: GOOD HILLS FOR A TRUCK", 190, -70, 70], ["HANK'S FARMSTEAD", FARM.x, FARM.z, 40], ["OLD GRAIN SILOS", SILOS.x, SILOS.z, 30], ["SINGULARITY DRILLING: HOSTILE · A.I. · LASERS", RIVAL.x, RIVAL.z, 80], ["EL FUEGO TACOS", TACO.x, TACO.z, 30], ["BIGFOOT NATIONAL MESQUITE FOREST", 0, -300, 90], ["THE HUNTERS' CAMP", FOREST_CAMP.x, FOREST_CAMP.z, 22], ["THE HOME PASTURE: A LOT OF CATTLE", 150, 210, 60]] as [string, number, number, number][]) {
      if (!this.seen.has(name) && Math.hypot(px - x, pz - z) < r) { this.seen.add(name); g.ui.toast("DISCOVERED", name); g.sfx.good(); }
    }
    // near enough to bother with the animations
    const near = (x: number, z: number, r: number) => Math.hypot(px - x, pz - z) < r;
    if (near(POND.x, POND.z, 200)) for (const d of this.ducks) { d.a += d.w * dt; const x = POND.x + Math.cos(d.a) * (POND.rx - 6) * (0.3 + d.r * 0.6), z = POND.z + Math.sin(d.a) * (POND.rz - 5) * (0.3 + d.r * 0.6); d.m.position.set(x, WATER_Y + 0.06 + Math.sin(this.t * 2 + d.a) * 0.02, z); d.m.rotation.y = -d.a + (d.w > 0 ? 0 : Math.PI) + Math.PI / 2; }
    // the cattle wander, flee a bit when startled, and a truck that hits one is going to hear about it
    let best = 1e9; this.nearCow = 0;
    const riding = g.veh.riding, speed = Math.hypot(p.vel.x, p.vel.z), fp = riding ? g.veh.footprint() : null, bodies = riding ? g.veh.bodyCircles() : [];
    this.cows.forEach((c, i) => {
      const d = Math.hypot(c.x - px, c.z - pz); if (d < best) { best = d; this.nearCow = i; }
      if (d > 150) return;
      if (c.down > 0) { c.down -= dt; c.sp = 0; c.n.rotation.z = 1.5; c.n.position.set(c.x, this.terrain(c.x, c.z) + 0.42, c.z); if (c.down <= 0) { c.n.rotation.z = 0; c.n.position.y = this.terrain(c.x, c.z); c.flee = 0; } return; }
      c.t -= dt;
      if (c.flee > 0) { c.flee -= dt; c.sp = 3.2; }
      else if (c.t <= 0) { c.t = rnd(2, 7); if (Math.random() < 0.55) { c.sp = 0; } else { c.sp = rnd(0.5, 0.9); c.h += rnd(-1.3, 1.3); } }
      const nx = c.x + Math.sin(c.h) * c.sp * dt, nz = c.z + Math.cos(c.h) * c.sp * dt;
      if (nx < PASTURE.x0 || nx > PASTURE.x1 || nz < PASTURE.z0 || nz > PASTURE.z1) c.h += Math.PI * 0.6; else { c.x = nx; c.z = nz; }
      c.n.position.set(c.x, this.terrain(c.x, c.z), c.z); c.n.rotation.y = c.h;
      // run over by the truck: any part of its body, at any real speed, and not while it is in the air
      if (riding && c.down <= 0 && fp && fp.speed > 2 && p.pos.y < this.terrain(c.x, c.z) + 1.4) {
        const hit = bodies.some((bc) => Math.hypot(bc.x - c.x, bc.z - c.z) < bc.r + 0.9);
        if (hit) {
          c.down = 75; c.h = Math.atan2(c.x - px, c.z - pz); g.veh.slow(0.55); g.sfx.thud(); g.sim.addCost(5000); g.inc(1, "CATTLE COLLISION");
          g.radio("hank" as any, "THAT WAS MY BEST ONE!", 6500); g.ui.toast("CATTLE COLLISION", "You're down $5,000. The cow is also down.");
        }
      }
    });
    void speed;
    this.hankUpdate(dt, px, pz); this.updateFx(dt); this.wild.update(dt);
    // Hank yells when you wander up to the porch (he is hostile only by the pond, until you are friends)
    if (!g.flags.hankFriend && near(FARM.x + 8, FARM.z, 26) && !riding && (this.cd["hankyell"] ?? -99) + 28 < this.t) {
      this.cd["hankyell"] = this.t; g.radio("hank" as any, pick(["GET OFF MY PORCH!", "I SEE YOU, COMPANY MAN!", "That's private property! The sign's right there!", "Don't make me go inside for my other shotgun!"]), 6000);
    }
    // the competitor: taunts as you approach, guards come out, and a shove if they reach you
    const gx = RIVAL.x + 44, gz = RIVAL.z;
    if (near(gx, gz, 55) && (this.cd["rivaltaunt"] ?? -99) + 15 < this.t) {
      this.cd["rivaltaunt"] = this.t; g.radio("rival" as any, pick(["INTRUDER DETECTED. HELLO, COMPANY MAN. YOU ARE WRONG LEASE.", "Your rig uses steel. We use light. Please compute the difference.", "Our laser reached TD while you were reading this. I'm joking. I do not joke. That was not a joke.", "Keep walking. Our models predict you will, anyway."]), 6500);
    }
    // the guards: patrol; during the secrets job they chase you at a dead run, up either staircase and onto the rig floor; whoever reaches you throws you out
    const raid = !!g.flags.raidOn, X = RIVAL.x, Z = RIVAL.z;
    const stN = (qx: number, qz: number) => Math.abs(qz - Z) < 1.5 ? (qx > X + 9.5 && qx < X + 19.1 ? 1 : qx < X - 9.5 && qx > X - 19.1 ? -1 : 0) : 0;
    const stH = (qx: number, sg: number) => Math.max(0.15, 8.3 - (Math.abs(qx - (X + sg * 9.5)) / 0.3) * 0.26);
    const pUp = p.pos.y > 1.5 && (stN(px, pz) !== 0 || (Math.abs(px - X) < 9.6 && Math.abs(pz - Z) < 9.6));
    this.raidCd -= dt;
    for (const gd of this.guards) {
      const hunting = raid ? (this.inLease() && !riding) : (near(RIVAL.x, RIVAL.z, 60) && near(gx, gz, 44) && !riding);
      const hx = gd.h.root.position.x, hz = gd.h.root.position.z, sg0 = stN(hx, hz), stairs = sg0 !== 0;
      let tx: number, tz: number, sp: number;
      if (hunting) {
        sp = raid ? 7.6 : 3.2; tx = px; tz = pz;
        if (stairs) { const s = sg0, topM: [number, number] = [X + s * 9.2, Z], botM: [number, number] = [X + s * 19.7, Z]; [tx, tz] = pUp ? topM : botM; }
        else if (!!gd.up !== pUp) {
          // pick the staircase that is closer to this guard
          const mouths = [1, -1].map((s) => ({ s, top: [X + s * 9.2, Z] as [number, number], bot: [X + s * 19.7, Z] as [number, number] }));
          const dist = (m: [number, number]) => Math.hypot(hx - m[0], hz - m[1]);
          if (gd.up) { const c = mouths.sort((a, b) => dist(a.top) - dist(b.top))[0]; [tx, tz] = dist(c.top) < 1.0 ? c.bot : c.top; }
          else { const c = mouths.sort((a, b) => dist(a.bot) - dist(b.bot))[0]; [tx, tz] = dist(c.bot) < 1.0 ? c.top : c.bot; }
        }
      } else { const [wx, wz] = gd.wp[gd.i]; tx = wx; tz = wz; sp = 1.1; if (Math.hypot(wx - hx, wz - hz) < 0.6) gd.i = (gd.i + 1) % gd.wp.length; }
      if (!stairs) { tx = Math.max(X - 41, Math.min(X + 41, tx)); tz = Math.max(Z - 41, Math.min(Z + 41, tz)); }   // they never leave the wire
      const dx = tx - hx, dz = tz - hz, dd = Math.hypot(dx, dz);
      const gy = stairs ? stH(hx, sg0) : gd.up ? 8.3 : 0.15;
      if (hunting && Math.hypot(px - hx, pz - hz) < 1.7 && Math.abs(p.pos.y - gy) < 2.6) {
        if (raid) {
          if (this.raidCd <= 0) this.throwOut();
        } else if ((this.cd["shove"] ?? -99) + 12 < this.t) {
          this.cd["shove"] = this.t; const ux = (px - hx) / (Math.hypot(px - hx, pz - hz) || 1), uz = (pz - hz) / (Math.hypot(px - hx, pz - hz) || 1);
          p.teleport(px + ux * 16, 0.5, pz + uz * 16, Math.atan2(ux, uz)); g.gain(0, -3); g.sfx.thud(); g.ui.toast("ESCORTED OFF SINGULARITY'S LEASE", "“ESCORT COMPLETE. HAVE A SUBOPTIMAL DAY.”");
          g.radio("rival" as any, "TRESPASSER REMOVED. EFFICIENCY RESTORED.", 5000);
        }
        gd.h.root.position.y = gy; gd.h.animate(dt, 0); continue;
      }
      if (dd > 0.3) {
        const k = Math.min(1, sp * dt / dd); let nx = hx + dx * k, nz = hz + dz * k;
        if (!stairs && stN(nx, nz) === 0) { nx = Math.max(X - 41, Math.min(X + 41, nx)); nz = Math.max(Z - 41, Math.min(Z + 41, nz)); }
        gd.h.root.position.x = nx; gd.h.root.position.z = nz;
        const sn = stN(nx, nz); if (sn !== 0) { if (Math.abs(nx - (X + sn * 9.5)) <= 0.15) gd.up = true; if (Math.abs(nx - (X + sn * 19.1)) <= 0.15) gd.up = false; }
        const want = Math.atan2(dx, dz); let a = want - gd.h.root.rotation.y; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; gd.h.root.rotation.y += a * Math.min(1, dt * 8); gd.h.animate(dt, sp);
      } else gd.h.animate(dt, 0);
      const sn2 = stN(gd.h.root.position.x, gd.h.root.position.z);
      gd.h.root.position.y = sn2 !== 0 ? stH(gd.h.root.position.x, sn2) : gd.up ? 8.3 : 0.15;
    }
    if (this.fut && near(RIVAL.x, RIVAL.z, 260)) {
      const f = this.fut, pulse = 0.5 + 0.5 * Math.sin(this.t * 7);
      f.core.scaling.x = f.core.scaling.z = 0.9 + 0.2 * pulse; f.glow.scaling.x = f.glow.scaling.z = 0.9 + 0.35 * Math.sin(this.t * 4.1 + 1); (f.ground.material as StandardMaterial).alpha = 0.35 + 0.3 * pulse; f.ground.scaling.x = f.ground.scaling.y = 4.2 + 0.7 * pulse;
      f.ring.rotation.y += dt * 1.6; f.ring.rotation.x = Math.sin(this.t * 0.9) * 0.35;
      for (const d of f.drones) { d.a += d.w * dt; d.m.position.set(RIVAL.x + Math.cos(d.a) * d.r, d.h + Math.sin(this.t * 2 + d.a) * 0.8, RIVAL.z + Math.sin(d.a) * d.r); d.m.rotation.y += dt * 2; }
      for (const fb of this.floorBots) {
        fb.h.animate(dt, 0);
        const s = Math.sin(this.t * 1.7 + fb.ph);
        fb.h.armR.rotation.x = -1.0 + s * 0.45; fb.h.armL.rotation.x = -1.0 - s * 0.45;
        fb.h.elbowR!.rotation.x = -0.9 + s * 0.4; fb.h.elbowL!.rotation.x = -0.9 - s * 0.4;
        fb.h.root.position.x = fb.x + Math.sin(this.t * 0.4 + fb.ph) * 0.5; fb.h.root.position.z = fb.z + Math.cos(this.t * 0.4 + fb.ph) * 0.5;
      }
      f.arm.rotation.y = Math.sin(this.t * 0.5) * 1.2; f.l1.rotation.x = -0.4 + Math.sin(this.t * 0.9) * 0.3; f.l2.rotation.x = 0.7 + Math.sin(this.t * 1.3) * 0.4;
    }
    for (const T of this.turbs) if (T.on) T.rot.rotation.z += dt * 1.3;
    this.updateFishing(dt);
    this.bigfootStep(dt);
    { // the diggable ground follows the player (and a point ahead when going fast)
      const lp = this.lastP ?? { x: px, z: pz }, vx = (px - lp.x) / Math.max(dt, 1e-3), vz = (pz - lp.z) / Math.max(dt, 1e-3); this.lastP = { x: px, z: pz };
      const foc = [{ x: px, z: pz }], sp = Math.hypot(vx, vz); if (sp > 8) { const k = Math.min(60, sp * 1.2) / sp; foc.push({ x: px + vx * k, z: pz + vz * k }); }
      this.ground.update(dt, DIGGING ? foc : []);   // no digging: no fine chunks, just the one ground at 2 m (no level-of-detail seams)
    }
    { // roll coal
      const near = Math.hypot(px - 25, pz) < 260;
      for (const s of this.smoke) {
        if (!near) { s.ps.emitRate = 0; continue; }
        s.t -= dt;
        if (s.burst > 0) { s.burst -= dt; s.ps.emitRate = 150; }
        else {
          s.ps.emitRate = 0;
          if (s.t <= 0) { s.burst = rnd(1.1, 2.4); s.t = rnd(28, 80); if ((this.cd["coal"] ?? -999) + 150 < this.t) { this.cd["coal"] = this.t; g.radio("earl", pick(["That generator's rolling coal again. Nobody tell the EPA.", "Gen's burping black smoke, boss. It does that. It means it's working.", "That's just the generator clearing its throat. Black smoke is a sign of effort."]), 6500); } }
        }
      }
    }
    { const uw = document.getElementById("underwater"); if (uw) { const inPond = ((p.cam.position.x - POND.x) / POND.rx) ** 2 + ((p.cam.position.z - POND.z) / POND.rz) ** 2 < 1; uw.style.display = inPond && p.cam.position.y < WATER_Y ? "block" : "none"; } }
    // the people who stand still still breathe
    this.lupe.animate(dt, 0); this.rusty.animate(dt, 0);
  }

  private vehSpeed() { const p = this.g.player; const now = performance.now(); const last = (this as any)._lp ?? { x: p.pos.x, z: p.pos.z, t: now }; const dt = Math.max(0.001, (now - last.t) / 1000); const s = Math.hypot(p.pos.x - last.x, p.pos.z - last.z) / dt; (this as any)._lp = { x: p.pos.x, z: p.pos.z, t: now }; return Math.min(60, s); }
}

/** hand-drawn little pictures for the catch card: fish, junk, and pieces of rotary steerable systems */
function drawCatch(cv: HTMLCanvasElement, id: string, deep: boolean) {
  const c = cv.getContext("2d")!, W = cv.width, H = cv.height; c.clearRect(0, 0, W, H);
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, deep ? "#0a2a3a" : "#2a6f8a"); g.addColorStop(1, deep ? "#04141c" : "#123d4f"); c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 14; i++) { c.fillStyle = "rgba(255,255,255,.06)"; c.beginPath(); c.arc((i * 53) % W, (i * 31) % H, 3 + (i % 4), 0, 6.3); c.fill(); }
  c.save(); c.translate(W / 2, H / 2);
  if (id === "deer" || id === "bear" || id === "snake" || id === "bird") {
    const g2 = c.createLinearGradient(0, 0, 0, H); g2.addColorStop(0, "#9ab8c8"); g2.addColorStop(1, "#6a7a54"); c.fillStyle = g2; c.fillRect(-W / 2, -H / 2, W, H);
    const bx = (col: string, x: number, y: number, w: number, h: number) => { c.fillStyle = "#000"; c.fillRect(x - 2, y - 2, w + 4, h + 4); c.fillStyle = col; c.fillRect(x, y, w, h); };
    if (id === "deer") { bx("#8a6a45", -60, -10, 100, 46); bx("#cdb48a", -50, 24, 80, 14); bx("#8a6a45", 28, -48, 22, 50); bx("#8a6a45", 40, -62, 34, 22); for (const x of [-52, -36, 18, 30]) bx("#6a4e32", x, 34, 9, 44); bx("#e0d2b0", 44, -86, 5, 26); bx("#e0d2b0", 56, -84, 5, 24); bx("#e0d2b0", 36, -96, 24, 5); bx("#f2f2f2", -66, -6, 10, 14); }
    else if (id === "bear") { bx("#2e231b", -70, -26, 120, 70); bx("#2e231b", -46, -52, 56, 34); bx("#3a2c22", 44, -34, 44, 40); bx("#7a6a5a", 74, -18, 22, 16); for (const x of [-60, -30, 20, 44]) bx("#241b14", x, 40, 20, 38); bx("#2e231b", 50, -48, 9, 10); bx("#2e231b", 70, -48, 9, 10); }
    else if (id === "snake") { c.strokeStyle = "#000"; c.lineWidth = 22; c.lineCap = "round"; c.beginPath(); c.moveTo(-80, 20); c.bezierCurveTo(-40, -50, 0, 60, 40, -10); c.bezierCurveTo(60, -40, 80, 0, 90, -24); c.stroke(); c.strokeStyle = "#8a7648"; c.lineWidth = 16; c.stroke(); c.fillStyle = "#6a5a38"; for (let i = 0; i < 6; i++) { c.fillRect(-70 + i * 28, -4 + (i % 2) * 14, 10, 8); } c.fillStyle = "#d63a2c"; c.fillRect(84, -32, 12, 4); }
    else { c.fillStyle = "#000"; c.beginPath(); c.moveTo(-100, 10); c.lineTo(0, -34); c.lineTo(100, 10); c.lineTo(0, -4); c.closePath(); c.fill(); c.fillStyle = "#2a2420"; c.beginPath(); c.moveTo(-94, 8); c.lineTo(0, -28); c.lineTo(94, 8); c.lineTo(0, -8); c.closePath(); c.fill(); bx("#2a2420", -12, -12, 24, 36); bx("#b04a40", -7, 22, 14, 14); }
    c.restore(); return;
  }
  const fish = (body: string, belly: string, fin: string, len: number, tall: number, extra?: () => void) => {
    c.fillStyle = fin; c.beginPath(); c.moveTo(-len * 0.45, 0); c.lineTo(-len * 0.75, -tall * 0.7); c.lineTo(-len * 0.72, tall * 0.7); c.closePath(); c.fill();           // tail
    c.beginPath(); c.moveTo(-len * 0.1, -tall * 0.5); c.lineTo(len * 0.05, -tall * 0.95); c.lineTo(len * 0.2, -tall * 0.5); c.closePath(); c.fill();                    // dorsal
    c.fillStyle = body; c.beginPath(); c.ellipse(0, 0, len * 0.5, tall * 0.55, 0, 0, 6.3); c.fill();
    c.fillStyle = belly; c.beginPath(); c.ellipse(0, tall * 0.18, len * 0.46, tall * 0.3, 0, 0, Math.PI); c.fill();
    c.fillStyle = "#fff"; c.beginPath(); c.arc(len * 0.3, -tall * 0.12, tall * 0.11, 0, 6.3); c.fill(); c.fillStyle = "#000"; c.beginPath(); c.arc(len * 0.32, -tall * 0.12, tall * 0.06, 0, 6.3); c.fill();
    c.strokeStyle = "rgba(0,0,0,.4)"; c.lineWidth = 2; c.beginPath(); c.arc(len * 0.2, 0, tall * 0.45, -0.9, 0.9); c.stroke();
    extra?.();
  };
  const box = (col: string, x: number, y: number, w: number, h: number) => { c.fillStyle = "#000"; c.fillRect(x - 2, y - 2, w + 4, h + 4); c.fillStyle = col; c.fillRect(x, y, w, h); };
  if (id === "bluegill") fish("#4f7a3a", "#e89a2a", "#3f5f2e", 150, 90, () => { c.fillStyle = "#1a2a5a"; c.beginPath(); c.arc(60, 10, 10, 0, 6.3); c.fill(); });
  else if (id === "bass") fish("#5f7f35", "#d8dcb0", "#4a6a2a", 190, 80, () => { c.fillStyle = "rgba(20,40,10,.65)"; c.fillRect(-60, -6, 110, 8); });
  else if (id === "catfish") { fish("#4a4a52", "#b8b8c0", "#3a3a42", 190, 80); c.strokeStyle = "#222"; c.lineWidth = 3; for (const y of [-6, 8, 18]) { c.beginPath(); c.moveTo(92, y); c.quadraticCurveTo(112, y + 4, 120, y + 18); c.stroke(); } }
  else if (id === "crappie") fish("#bcc79a", "#eef0d4", "#9aa87a", 150, 100, () => { c.fillStyle = "rgba(50,60,30,.7)"; for (let i = 0; i < 14; i++) { c.beginPath(); c.arc(-40 + (i % 7) * 18, -20 + Math.floor(i / 7) * 24, 5, 0, 6.3); c.fill(); } });
  else if (id === "carp") fish("#c98a2a", "#f0d28a", "#b0701a", 210, 100, () => { c.fillStyle = "rgba(255,230,160,.5)"; for (let i = 0; i < 12; i++) { c.beginPath(); c.arc(-60 + (i % 6) * 22, -20 + Math.floor(i / 6) * 28, 8, 0, 6.3); c.fill(); } });
  else if (id === "lunker") { c.scale(1.25, 1.25); fish("#4b6b4a", "#c8d0b0", "#3a5a3a", 200, 96, () => { c.strokeStyle = "#e0e0d0"; c.lineWidth = 2; c.beginPath(); c.moveTo(-30, -30); c.lineTo(-10, -10); c.moveTo(0, 20); c.lineTo(30, 38); c.stroke(); }); }
  else if (id === "boot") { c.fillStyle = "#5a3a22"; c.beginPath(); c.moveTo(-50, -60); c.lineTo(10, -60); c.lineTo(14, 10); c.lineTo(70, 22); c.lineTo(70, 50); c.lineTo(-50, 50); c.closePath(); c.fill(); c.fillStyle = "#2a1a0e"; c.fillRect(-50, 38, 120, 12); c.fillStyle = "#cfcfcf"; for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(-24, -42 + i * 14, 3, 0, 6.3); c.fill(); } c.fillStyle = "#3a8a3a"; c.fillRect(-40, 10, 18, 6); }
  else if (id === "bit") { c.fillStyle = "#6a6e75"; c.fillRect(-26, -64, 52, 50); c.fillStyle = "#2a2d31"; c.beginPath(); c.moveTo(-60, -14); c.lineTo(60, -14); c.lineTo(46, 52); c.lineTo(-46, 52); c.closePath(); c.fill(); for (const [px, py] of [[-34, 10], [-12, 26], [12, 26], [34, 10], [0, 4]]) { c.fillStyle = "#e0b040"; c.beginPath(); c.arc(px, py, 9, 0, 6.3); c.fill(); c.fillStyle = "#8a6a20"; c.beginPath(); c.arc(px, py, 4, 0, 6.3); c.fill(); } }
  // ---- the deep hole: pieces of rotary steerable systems
  else if (id === "pad") { box("#7b8087", -80, -22, 160, 44); box("#3a3f45", -70, -14, 140, 8); box("#3a3f45", -70, 4, 140, 8); for (let i = -60; i <= 60; i += 24) box("#e0a030", i, -4, 10, 8); box("#b0261c", -86, -8, 8, 16); }
  else if (id === "bias") { box("#8d9299", -105, -26, 210, 52); box("#2c5d8a", -105, -26, 36, 52); for (const x of [-40, 10, 60]) box("#e0a030", x, -38, 30, 12); for (const x of [-40, 10, 60]) box("#e0a030", x, 26, 30, 12); box("#3a3f45", 70, -14, 36, 28); box("#b0261c", -112, -10, 8, 20); }
  else if (id === "shaft") { box("#aeb4ba", -110, -8, 220, 16); for (const x of [-80, -20, 40, 90]) box("#e0a030", x, -12, 8, 24); box("#3a3f45", -118, -14, 10, 28); box("#3a3f45", 108, -14, 10, 28); }
  else if (id === "pulser") { box("#3a3f45", -90, -30, 180, 60); box("#2c8a5a", -76, -22, 40, 44); box("#c8c8cc", -20, -14, 70, 28); box("#e0a030", 60, -22, 12, 44); c.fillStyle = "#3fd0ff"; for (let i = 0; i < 4; i++) c.fillRect(70 + i * 5, -8, 3, 16); }
  else if (id === "board") { box("#1d7a3b", -100, -56, 200, 112); for (const [x, y, w, h] of [[-80, -40, 36, 24], [-30, -40, 24, 24], [10, -20, 50, 36], [-70, 8, 28, 28], [30, 22, 36, 20], [-10, 30, 20, 16]]) box("#15171a", x, y, w, h); c.strokeStyle = "#d8b04a"; c.lineWidth = 2; for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(-96, -50 + i * 18); c.lineTo(96, -46 + i * 18); c.stroke(); } }
  else if (id === "turbine") { box("#7b8087", -80, -36, 160, 72); for (let i = 0; i < 8; i++) box("#c8ccd0", -70 + i * 18, -44, 8, 88); box("#3a3f45", -92, -14, 14, 28); box("#3a3f45", 78, -14, 14, 28); }
  else if (id === "rss") { box("#8d9299", -120, -22, 240, 44); box("#e0b040", -120, -22, 20, 44); box("#e0b040", -60, -22, 12, 44); box("#e0b040", 40, -22, 12, 44); box("#2c5d8a", 80, -22, 40, 44); for (const x of [-30, 10]) box("#e0a030", x, -34, 24, 12); box("#b0261c", -128, -8, 8, 16); c.fillStyle = "rgba(255,230,120,.25)"; c.beginPath(); c.arc(0, 0, 110, 0, 6.3); c.fill(); }
  c.restore();
}
