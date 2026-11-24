import { Scene, MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode, Mesh, VertexBuffer, VertexData, Quaternion } from "@babylonjs/core";
import { Builder, type AABB } from "./builder";
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
const HILLS: [number, number, number, number][] = [[150, -30, 8, 24], [198, -72, 11, 28], [160, -118, 7, 20], [235, -18, 9, 22], [118, -70, 6, 18]];   // x, z, height, spread
const POND = { x: -175, z: 165, rx: 27, rz: 20 };
const FARM = { x: -64, z: 236 };                      // the house; its porch faces +x, toward the lease road
const SILOS = { x: -93, z: 262 };
const RIVAL = { x: -215, z: -150 };                   // Big Daddy Drilling
const TACO = { x: -14, z: 118 };                      // by the gate
const PASTURE = { x0: 70, x1: 230, z0: 115, z1: 305 };

export class Outskirts {
  colliders: AABB[] = [];
  merged: Mesh[] = [];
  private g: Game; private scene: Scene;
  private cows: { n: TransformNode; x: number; z: number; h: number; sp: number; t: number; flee: number }[] = [];
  private ducks: { m: Mesh; a: number; r: number; w: number }[] = [];
  private guards: { h: Human; x: number; z: number; wp: [number, number][]; i: number }[] = [];
  private fut: { core: Mesh; glow: Mesh; ground: Mesh; ring: Mesh; drones: { m: Mesh; a: number; r: number; h: number; w: number }[]; arm: TransformNode; l1: TransformNode; l2: TransformNode } | null = null;
  private fish = { st: "idle" as "idle" | "fly" | "wait" | "bite", t: 0, bite: 0, sx: 0, sz: 0, bx: 0, bz: 0, caught: 0, best: 0, junk: 0 };
  private bobber!: Mesh; private fline!: Mesh; private ripple!: Mesh; private pole!: Mesh; private poleOwned = false;
  private hank!: Human; private lupe!: Human; private rusty!: Human;
  private nearCow = 0; private t = 0;
  private seen = new Set<string>();
  private cd: Record<string, number> = {};

  /** the ground height at (x, z): flat, except across the hills */
  terrain = (x: number, z: number): number => {
    if (x < 40 || x > 350 || z < -240 || z > 80) return 0;
    let h = 0;
    for (const [hx, hz, H, s] of HILLS) { const dx = x - hx, dz = z - hz; h += H * Math.exp(-(dx * dx + dz * dz) / (2 * s * s)); }
    return h < 0.04 ? 0 : h;
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
    this.hills(b);
    this.pond(b);
    this.farm(b);
    this.silos(b);
    this.rival(b);
    this.taco(b);
    this.merged = b.finish();
    this.colliders = b.colliders;
    this.cattle();
  }

  // ---------------------------------------------------------------------------------------------- hills
  private hills(b: Builder) {
    const sc = this.scene, W = 300, D = 300, N = 110, cx = 195, cz = -80;
    const m = MeshBuilder.CreateGround("hills", { width: W, height: D, subdivisions: N, updatable: true }, sc);
    m.position.set(cx, 0.03, cz);
    const pos = m.getVerticesData(VertexBuffer.PositionKind)!, uv = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length / 3; i++) {
      const x = pos[i * 3] + cx, z = pos[i * 3 + 2] + cz;
      pos[i * 3 + 1] = this.terrain(x, z);
      uv[i * 2] = (x + 3000) / 6000; uv[i * 2 + 1] = (z + 3000) / 6000;      // the same world-space texture as the plain ground, so there is no seam
    }
    m.updateVerticesData(VertexBuffer.PositionKind, pos); m.setVerticesData(VertexBuffer.UVKind, uv);
    const nrm: number[] = []; VertexData.ComputeNormals(pos, m.getIndices()!, nrm); m.updateVerticesData(VertexBuffer.NormalKind, nrm);
    const gm = sc.getMaterialByName("ground"); if (gm) m.material = gm;
    m.receiveShadows = true; m.isPickable = false; m.freezeWorldMatrix();
    // sagebrush on the slopes
    const sage = MeshBuilder.CreateSphere("sage", { diameter: 1, segments: 5 }, sc); sage.material = b.getMat("sage"); sage.setEnabled(false);
    for (let i = 0; i < 160; i++) {
      const x = rnd(55, 340), z = rnd(-225, 65), y = this.terrain(x, z);
      const s = sage.createInstance("sg" + i); s.position.set(x, y + 0.2, z); s.scaling.set(rnd(0.7, 1.6), rnd(0.4, 0.8), rnd(0.7, 1.6)); s.isPickable = false;
    }
  }

  // ---------------------------------------------------------------------------------------------- pond
  private pond(b: Builder) {
    const sc = this.scene, { x, z, rx, rz } = POND;
    const mud = MeshBuilder.CreateDisc("pondmud", { radius: 1, tessellation: 48 }, sc); mud.rotation.x = Math.PI / 2; mud.scaling.set(rx + 3, rz + 3, 1); mud.position.set(x, 0.05, z);
    const mm = new StandardMaterial("pondmudm", sc); mm.diffuseColor = Color3.FromHexString("#6e5a3d"); mm.specularColor = Color3.Black(); mud.material = mm; mud.isPickable = false;
    const water = MeshBuilder.CreateDisc("pondwater", { radius: 1, tessellation: 48 }, sc); water.rotation.x = Math.PI / 2; water.scaling.set(rx, rz, 1); water.position.set(x, 0.09, z);
    const wm = new StandardMaterial("pondwaterm", sc); wm.diffuseColor = Color3.FromHexString("#356f86"); wm.specularColor = new Color3(0.9, 0.9, 0.9); wm.specularPower = 60; wm.alpha = 0.88; wm.emissiveColor = new Color3(0.03, 0.08, 0.1);
    water.material = wm; water.isPickable = false;
    // cattails round the edge
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rnd(-0.05, 0.05), k = 1 + rnd(0.0, 0.14);
      const rx2 = x + Math.cos(a) * rx * k, rz2 = z + Math.sin(a) * rz * k, h = rnd(1.3, 2.2);
      b.cyl("reed", rx2, h / 2, rz2, 0.05, h, { tess: 5 }); b.cyl("dwood", rx2, h, rz2, 0.11, 0.35, { tess: 6 });
    }
    // a short dock, a rowboat and a fishing chair
    const dx = x + rx - 2, dz = z;
    b.slab("wood", dx - 1, 0.55, dz - 0.9, dx + 9, 0.65, dz + 0.9, false); for (let i = 0; i < 4; i++) { b.slab("dwood", dx - 0.6 + i * 2.8, 0, dz - 0.8, dx - 0.4 + i * 2.8, 0.6, dz - 0.6); b.slab("dwood", dx - 0.6 + i * 2.8, 0, dz + 0.6, dx - 0.4 + i * 2.8, 0.6, dz + 0.8); }
    b.slab("dsteel", dx + 7.4, 0.65, dz - 0.4, dx + 8.0, 1.0, dz + 0.1); b.slab("wood", dx + 6.0, 0.65, dz + 0.3, dx + 6.7, 1.15, dz + 0.9);
    b.slab("wood", dx + 2, 0.12, dz + 2.2, dx + 6.6, 0.45, dz + 3.3); b.slab("dwood", dx + 2, 0.42, dz + 2.2, dx + 6.6, 0.5, dz + 2.3); b.slab("dwood", dx + 2, 0.42, dz + 3.2, dx + 6.6, 0.5, dz + 3.3);
    b.label("PRIVATE POND\nNO FISHING (WE KNOW YOU WILL)", dx - 2.5, 1.9, dz - 3, 2.6, 0.9, Math.PI / 2, "#233a52", "#ffd24a", 36);
    b.slab("dwood", dx - 2.6, 0, dz - 3.1, dx - 2.45, 1.8, dz - 2.95);
    const woodM = new StandardMaterial("polem", sc); woodM.diffuseColor = Color3.FromHexString("#c9a15a"); woodM.specularColor = Color3.Black();
    this.pole = MeshBuilder.CreateCylinder("fishingpole", { diameterTop: 0.012, diameterBottom: 0.04, height: 2.3, tessellation: 6 }, sc); this.pole.material = woodM;
    this.pole.position.set(dx + 6.15, 1.75, dz + 1.15); this.pole.rotation.z = -0.22; this.pole.rotation.x = 0.1; this.pole.isPickable = false;
    const emi = (hex: string, alpha: number) => { const m = new StandardMaterial("fm" + hex, sc); m.emissiveColor = Color3.FromHexString(hex); m.disableLighting = true; m.alpha = alpha; m.backFaceCulling = false; return m; };
    this.bobber = MeshBuilder.CreateSphere("bobber", { diameter: 0.16, segments: 8 }, sc); this.bobber.material = emi("#e5483b", 1); this.bobber.isPickable = false; this.bobber.setEnabled(false);
    this.fline = MeshBuilder.CreateCylinder("fishline", { diameter: 0.012, height: 1, tessellation: 4 }, sc); this.fline.material = emi("#e8f0f4", 0.9); this.fline.isPickable = false; this.fline.setEnabled(false);
    this.ripple = MeshBuilder.CreateTorus("fripple", { diameter: 1, thickness: 0.04, tessellation: 20 }, sc); this.ripple.material = emi("#cfe8f4", 0.6); this.ripple.isPickable = false; this.ripple.setEnabled(false);
    for (let i = 0; i < 4; i++) {
      const m = MeshBuilder.CreateBox("duck", { width: 0.28, height: 0.2, depth: 0.42 }, sc);
      const dm = new StandardMaterial("duckm", sc); dm.diffuseColor = Color3.FromHexString(i % 2 ? "#6a5a3a" : "#2f6a3a"); dm.specularColor = Color3.Black(); m.material = dm; m.isPickable = false;
      const hd = MeshBuilder.CreateBox("duckh", { width: 0.14, height: 0.16, depth: 0.16 }, sc); hd.material = dm; hd.parent = m; hd.position.set(0, 0.17, 0.2);
      const bk = MeshBuilder.CreateBox("duckb", { width: 0.08, height: 0.04, depth: 0.1 }, sc); const bm = new StandardMaterial("duckbm", sc); bm.diffuseColor = Color3.FromHexString("#e0a020"); bk.material = bm; bk.parent = m; bk.position.set(0, 0.16, 0.32);
      this.ducks.push({ m, a: rnd(0, 6.28), r: rnd(0.2, 0.7), w: rnd(0.12, 0.25) * (i % 2 ? 1 : -1) });
    }
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
    b.slab("rust", x + 14, 0.5, z - 9, x + 16.2, 1.5, z - 4.6, true); b.slab("rust", x + 14.1, 1.5, z - 8.7, x + 16.1, 2.3, z - 6.9); b.slab("black", x + 14.2, 1.55, z - 8.6, x + 16, 2.2, z - 8.5);
    for (const wx of [14.3, 15.9]) for (const wz of [-8.3, -5.4]) b.cyl("black", x + wx + (wx > 15 ? 0.15 : -0.15), 0.4, z + wz, 0.8, 0.3, { axis: "x", tess: 12 });
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
    b.slab("futdark", x - 9.5, 7.7, z - 9.5, x + 9.5, 8.3, z + 9.5);
    b.slab("futglow", x - 9.55, 8.0, z - 9.55, x + 9.55, 8.08, z + 9.55);
    for (const s of [-1, 1]) { b.slab("futglass", x - 9.5, 8.3, z + s * 9.4 - 0.05, x + 9.5, 9.5, z + s * 9.4 + 0.05); b.slab("futglass", x + s * 9.4 - 0.05, 8.3, z - 9.5, x + s * 9.4 + 0.05, 9.5, z + 9.5); }
    // the tower: a tapering white hex shaft ringed with light, four slim pylons, an AI core on the crown
    b.cyl("futwhite", x, 28.5, z, 7.0, 40, { tess: 8, dia2: 2.6 });
    for (let y = 12; y < 48; y += 5) { const d = 7.0 - ((y - 8.5) / 40) * 4.4; b.cyl("futglow", x, y, z, d + 0.18, 0.22, { tess: 8 }); }
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.beam("futgrey", new Vector3(x + px * 8.2, 8.3, z + pz * 8.2), new Vector3(x + px * 1.3, 47, z + pz * 1.3), 0.4, 6);
    b.cyl("futdark", x, 48.6, z, 3.4, 1.6, { tess: 12 }); b.sphere("futglow", x, 51.5, z, 4.2, 18); b.beam("futglow", new Vector3(x, 53.3, z), new Vector3(x, 62, z), 0.12);
    b.label("BIG DADDY DRILLING\nA.I. · LASER-GUIDED · PRIVATE", x + 9.52, 12.5, z, 9.0, 2.4, Math.PI / 2, "#0b1220", "#2ee6ff", 44);
    // the AI core: a white dome with a glowing eye, off to the side
    b.sphere("futwhite", x + 24, 3.4, z - 12, 8, 18); b.cyl("futdark", x + 24, 0.2, z - 12, 9.0, 0.4, { tess: 18 });
    b.cyl("futglow", x + 28.1, 3.6, z - 12, 3.2, 0.25, { axis: "x", tess: 20 }); b.cyl("futdark", x + 28.2, 3.6, z - 12, 1.4, 0.3, { axis: "x", tess: 16 }); b.cyl("futmag", x + 28.35, 3.6, z - 12, 0.7, 0.2, { axis: "x", tess: 12 });
    b.label("B.D.A.I.\nBIG DADDY ARTIFICIAL INTELLIGENCE", x + 24, 8.6, z - 12, 6.4, 1.6, Math.PI / 2, "#0b1220", "#ff3ad6", 34);
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
    mk(16, 12, 1.05, [[16, 12], [16, 26], [4, 26], [4, 12]]); mk(-14, -22, 1.06, [[-14, -22], [-4, -22], [-4, -32], [-14, -32]]); mk(14, -26, 1.04, [[14, -26], [28, -26], [28, -12], [14, -12]]); mk(-14, 18, 1.05, [[-14, 18], [-30, 18], [-30, 30], [-14, 30]]);
    this.rusty = new Human(sc, { shirt: "#161c28", pants: "#2a3446", hat: "#2ee6ff", skin: "#d8e0e8", vest: false, scale: 1.14, hair: "#d8e0e8" });
    this.rusty.root.position.set(x + F - 3, 0.15, z); this.rusty.root.rotation.y = Math.PI / 2;
  }

  // ---------------------------------------------------------------------------------------------- the taco truck
  private taco(b: Builder) {
    const { x, z } = TACO;
    b.slab("tacowhite", x - 1.2, 0.9, z - 2.7, x + 1.2, 3.4, z + 2.7, true); b.slab("tacored", x - 1.22, 0.9, z - 2.7, x + 1.22, 1.5, z + 2.7);       // body with a red skirt
    b.slab("tacored", x - 1.1, 0.9, z + 2.7, x + 1.1, 2.7, z + 4.6, true); b.slab("glassd", x - 1.0, 1.7, z + 4.58, x + 1.0, 2.55, z + 4.64);       // cab
    b.slab("steel", x - 1.25, 0.8, z - 2.5, x + 1.25, 0.95, z + 4.7);
    for (const wx of [-1.3, 1.3]) for (const wz of [-1.6, 1.4, 3.8]) b.cyl("black", x + wx, 0.5, z + wz, 1.0, 0.36, { axis: "x", tess: 14 });
    b.slab("black", x + 1.22, 1.75, z - 1.6, x + 1.3, 2.65, z + 1.6);                                  // the serving window
    b.slab("tacored", x + 1.2, 2.9, z - 2.0, x + 3.2, 3.0, z + 2.0); for (const pz of [-1.9, 1.9]) b.slab("steel", x + 3.1, 0.9, z + pz - 0.04, x + 3.16, 2.9, z + pz + 0.04);   // awning
    for (let i = 0; i < 9; i++) b.slab("bulb", x + 3.05, 2.8, z - 1.9 + i * 0.475, x + 3.17, 2.88, z - 1.8 + i * 0.475);    // string lights
    b.slab("wood", x + 1.3, 1.5, z - 1.6, x + 1.9, 1.58, z + 1.6);                                       // counter
    b.slab("wood", x + 2.6, 0, z - 1.7, x + 3.0, 0.95, z + 1.7, true);                                   // front table
    b.slab("dwood", x + 1.22, 3.4, z - 0.1, x + 1.3, 4.9, z + 0.1); b.label("TACOS", x + 1.25, 4.5, z, 3.4, 1.1, Math.PI / 2, "#c8331f", "#ffe9a8", 70);
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
      this.cows.push({ n, x, z, h, sp: 0, t: rnd(0, 5), flee: 0 });
    }
  }

  // ---------------------------------------------------------------------------------------------- interactions
  interacts(): It[] {
    const g = this.g, v = (x: number, y: number, z: number) => new Vector3(x, y, z), cdOk = (k: string, s: number) => { const now = this.t; if ((this.cd[k] ?? -99) + s > now) return false; this.cd[k] = now; return true; };
    const out: It[] = [];
    // pond
    let skips = 0, fishN = 0;
    const shore = () => v(POND.x + POND.rx + 1.2, 1.2, POND.z + 6);
    out.push({ pos: shore, label: () => "Skip a rock", r: 3.2, act: () => {
      g.sfx.click(); const n = Math.floor(rnd(0, 8)); skips++; g.ui.toast(n === 0 ? "KERPLUNK" : `${n} SKIP${n > 1 ? "S" : ""}`, n === 0 ? "It sinks like a stone. It was a stone." : n >= 6 ? "Personal best. Nobody saw it." : "Not bad for a Company Man.");
      if (n >= 6 && cdOk("skipgain", 20)) g.gain(0, 2); } });
    void fishN;
    out.push({ pos: () => this.pole.getAbsolutePosition().add(v(0, -0.2, 0)), label: () => "Pick up the fishing pole", r: 3.0, ok: () => !this.poleOwned, act: () => {
      this.poleOwned = true; this.pole.setEnabled(false); g.held.owned.add("rod"); g.held.equip("rod"); g.sfx.good();
      g.ui.toast("FISHING POLE", "Face the pond and click to cast. When the bobber dips, click again to set the hook. Scroll or Q to put it away."); } });
    out.push({ pos: () => v(POND.x + POND.rx + 8, 1.7, POND.z), label: () => "Fishing spot", r: 3.4, act: () => {
      g.sfx.click(); g.ui.toast("FISHING", this.poleOwned ? "Hold the pole (scroll or Q), face the water and click to cast." : "You need a pole. There's one leaning by the chair on the dock."); } });
    // taco truck
    out.push({ pos: () => v(TACO.x + 3.2, 1.3, TACO.z), label: () => "Order tacos", r: 3.4, act: () => this.orderTacos() });
    // the landowner
    let hankN = 0;
    out.push({ pos: () => this.hank.root.position.add(v(0, 1.2, 0)), label: () => "Talk to Hank", r: 3.2, act: () => this.talkHank(hankN++) });
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
    out.push({ pos: () => this.rusty.root.position.add(v(0, 1.2, 0)), label: () => "Talk to R.U.S.T.Y. (Big Daddy supervisor unit)", r: 3.4, act: () => this.talkRusty(rustN++) });
    out.push({ pos: () => v(RIVAL.x + 47, 1.4, RIVAL.z + 8), label: () => "Spy on their rig", r: 3.4, act: () => {
      g.sfx.click(); g.ui.toast("YOU SQUINT", pick(["They're at 14,000 feet. In nine minutes. With a laser. Houston is not going to like this.", "The laser has no depth board. It has a feeling.", "Every worker on location is made of chrome. They look right through you.", "The rig is taller than ours. You decide it's a safety issue.", "Nobody here is wearing a hard hat. Nobody here is wearing anything. It's all very efficient."])); if (cdOk("spy", 20)) g.gain(0, -1); } });
    // the cattle: the nearest one, wherever it is
    out.push({ pos: () => { const c = this.cows[this.nearCow]; return c ? v(c.x, 1.3, c.z) : v(0, -999, 0); }, label: () => "Moo at the cow", r: 3.2, ok: () => { const c = this.cows[this.nearCow]; return !!c && Math.hypot(c.x - g.player.pos.x, c.z - g.player.pos.z) < 4.2; }, act: () => {
      g.sfx.click(); const c = this.cows[this.nearCow]; if (!c) return;
      g.ui.toast("MOOOOO", pick(["The cow moos back. It's not impressed.", "It looks at you for a very long time.", "You've made a friend. Possibly.", "The herd turns to look. All of it."]));
      for (const o of this.cows) if (Math.hypot(o.x - c.x, o.z - c.z) < 14) { o.flee = 2.5; o.h = Math.atan2(o.x - g.player.pos.x, o.z - g.player.pos.z); } } });
    return out;
  }

  /** left click with the fishing pole: cast, set the hook on a bite, or reel in */
  fishClick(): [string, string] | null {
    const g = this.g, p = g.player, f = this.fish;
    g.player.body.useHand("rod", 1.0);
    if (f.st === "idle") {
      let ok = false, tx = 0, tz = 0;
      for (const d of [9, 13, 6, 16, 4, 19]) { tx = p.pos.x + Math.sin(p.yaw) * d; tz = p.pos.z + Math.cos(p.yaw) * d; if (((tx - POND.x) / POND.rx) ** 2 + ((tz - POND.z) / POND.rz) ** 2 < 0.8) { ok = true; break; } }
      if (!ok) return ["NO WATER", "Face the pond and stand near the shore. You can't catch anything in dirt."];
      f.st = "fly"; f.t = 0; f.sx = p.pos.x; f.sz = p.pos.z; f.bx = tx; f.bz = tz; this.bobber.setEnabled(true); this.fline.setEnabled(true);
      return ["CAST", "Wait for the bobber to dip, then click to set the hook."];
    }
    if (f.st === "bite") {
      f.st = "idle"; this.bobber.setEnabled(false); this.fline.setEnabled(false); this.ripple.setEnabled(false);
      const T: [string, number, number, number, string][] = [["Bluegill", 0.3, 0.9, 30, "Small, shiny, offended."], ["Largemouth Bass", 1.5, 6, 22, "A proper fish."], ["Channel Catfish", 2, 12, 16, "It has whiskers and opinions."], ["Crappie", 0.5, 2, 14, "Perfectly fine."], ["Common Carp", 3, 18, 8, "A big, slow, unbothered fish."], ["Old Boot", 0, 0, 5, "Left foot. It's always the left foot."], ["Lost Drill Bit", 0, 0, 3, "Technically, a fishing job."], ["The Legendary “Big Daddy” Lunker", 30, 44, 2, "Not the rig. The fish. It's enormous and it looks unimpressed."]];
      let r = Math.random() * T.reduce((a, c) => a + c[3], 0), c = T[0]; for (const x of T) { r -= x[3]; if (r <= 0) { c = x; break; } }
      const [name, lo, hi, , quip] = c, lb = hi > 0 ? lo + Math.random() * (hi - lo) : 0;
      f.caught++; if (lb === 0) f.junk++; if (lb > f.best) { f.best = lb; }
      g.sfx.good();
      if (name.startsWith("The Legendary")) { g.gain(0, 5); g.radio("hank" as any, "THAT'S THE LUNKER! He's been in that pond since '94! Put him BACK, Company Man!", 7000); }
      else if (f.caught % 2 === 0) g.gain(0, 1);
      return [`CAUGHT: ${name.toUpperCase()}`, `${lb > 0 ? lb.toFixed(1) + " lb. " : ""}${quip}${lb > 0 && lb >= f.best ? " New personal best." : ""} (${f.caught} caught)`];
    }
    f.st = "idle"; this.bobber.setEnabled(false); this.fline.setEnabled(false); this.ripple.setEnabled(false);
    return ["REELED IN", f.st === "idle" ? "Nothing on the hook. Patience is a virtue. You are not virtuous." : ""];
  }
  private updateFishing(dt: number) {
    const g = this.g, p = g.player, f = this.fish;
    if (f.st === "idle") return;
    if (g.held.kind !== "rod" || Math.hypot(p.pos.x - f.sx, p.pos.z - f.sz) > 6) { f.st = "idle"; this.bobber.setEnabled(false); this.fline.setEnabled(false); this.ripple.setEnabled(false); g.ui.toast("FISHING", "You reel the line in."); return; }
    const tip = g.held.tipPos() ?? new Vector3(p.pos.x, p.pos.y + 1.6, p.pos.z);
    if (f.st === "fly") {
      f.t += dt / 0.6; const u = Math.min(1, f.t);
      this.bobber.position.set(tip.x + (f.bx - tip.x) * u, tip.y + (0.1 - tip.y) * u + Math.sin(Math.PI * u) * 2.4, tip.z + (f.bz - tip.z) * u);
      if (u >= 1) { f.st = "wait"; f.t = rnd(2.5, 7.5); g.sfx.click(); this.ripple.setEnabled(true); this.ripple.position.set(f.bx, 0.1, f.bz); this.ripple.scaling.set(0.3, 1, 0.3); }
    } else if (f.st === "wait") {
      f.t -= dt; this.bobber.position.set(f.bx, 0.1 + Math.sin(this.t * 2.2) * 0.015, f.bz);
      const k = ((this.t * 0.6) % 1); this.ripple.scaling.set(0.3 + k * 1.2, 1, 0.3 + k * 1.2); (this.ripple.material as StandardMaterial).alpha = 0.6 * (1 - k);
      if (f.t <= 0) { f.st = "bite"; f.bite = 1.3; g.sfx.thud(); g.ui.toast("BITE!", "Click now!"); }
    } else if (f.st === "bite") {
      f.bite -= dt; this.bobber.position.set(f.bx + Math.sin(this.t * 40) * 0.03, 0.02 + Math.sin(this.t * 25) * 0.04, f.bz);
      const k = ((this.t * 3) % 1); this.ripple.scaling.set(0.4 + k * 1.6, 1, 0.4 + k * 1.6); (this.ripple.material as StandardMaterial).alpha = 0.8 * (1 - k);
      if (f.bite <= 0) { f.st = "idle"; this.bobber.setEnabled(false); this.fline.setEnabled(false); this.ripple.setEnabled(false); g.ui.toast("IT GOT AWAY", "Too slow. It looked smug about it."); return; }
    }
    // the line, from the rod tip to the bobber
    const a = tip, b2 = this.bobber.position, d = b2.subtract(a), len = d.length();
    if (len > 0.05) { this.fline.position.copyFrom(a.add(b2).scale(0.5)); this.fline.scaling.y = len; if (!this.fline.rotationQuaternion) this.fline.rotationQuaternion = new Quaternion(); Quaternion.FromUnitVectorsToRef(Vector3.Up(), d.scale(1 / len), this.fline.rotationQuaternion); }
  }

  private orderTacos() {
    const g = this.g;
    g.say("taco" as any, "Buenos días, jefe. Best tacos east of the Pecos. What'll it be?", [
      { label: "Al pastor ($4)", cls: "green", run: () => { g.sim.addCost(4); g.gain(0, 5); g.radio("taco" as any, "Good choice. Don't tell Houston where you got them.", 6000); g.ui.toast("+5 MORALE", "Worth every peso."); } },
      { label: "Fish taco ($5)", run: () => { g.sim.addCost(5); g.gain(0, 2); g.radio("taco" as any, "It's Tuesday. It's… fine.", 5000); g.ui.toast("+2 MORALE", "Questionable, but warm."); } },
      { label: "The Suicide Taco ($6)", cls: "alt", run: () => { g.sim.addCost(6); g.gain(0, 8); g.radio("taco" as any, "No refunds.", 4000); g.ui.toast("+8 MORALE", "You can see through time."); setTimeout(() => g.radio("earl", "Boss, what is that smell? And why are you sweating?", 7000), 12000); } },
      { label: "Nothing, thanks", cls: "alt", run: () => { g.radio("taco" as any, "The offer stands. Always.", 4000); } },
    ] as any, "El Fuego Tacos");
  }

  private talkHank(n: number) {
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
    const L = ["GREETINGS, COMPANY MAN. I AM R.U.S.T.Y.: ROBOTIC UNIT FOR SUPERVISING TOUGH YOKELS. YOUR HARD HAT HAS A 3% PROBABILITY OF MATTERING.", "Our laser drills 14,000 feet in nine minutes. I ran the numbers on your rig. The numbers laughed. I do not laugh. The numbers did.", "Big Daddy is currently being a very large, very distant server. He has noted your trespass. He has noted it twice.", "Go home, Company Man. Take your sad little pad with you. I have already deprecated it."];
    g.say("rival" as any, L[n % L.length], [
      { label: "Nice fence.", run: () => g.radio("rival" as any, "IT IS AN ENERGY FENCE. IT IS NOT FOR YOU. IT IS FOR EVERYBODY WHO IS YOU.", 5000) },
      { label: "Make a rude gesture", cls: "alt", run: () => { g.gain(0, 2); g.ui.toast("+2 MORALE", "The android crew files a formal complaint. In triplicate."); for (const gd of this.guards) { gd.i = 0; } } },
    ] as any, "R.U.S.T.Y. — Big Daddy A.I.");
  }

  // ---------------------------------------------------------------------------------------------- per frame
  update(dt: number) {
    const g = this.g, p = g.player; this.t += dt;
    const px = p.pos.x, pz = p.pos.z;
    // discoveries
    for (const [name, x, z, r] of [["PRIVATE POND", POND.x, POND.z, 60], ["THE BREAKS: GOOD HILLS FOR A TRUCK", 190, -70, 70], ["HANK'S FARMSTEAD", FARM.x, FARM.z, 40], ["OLD GRAIN SILOS", SILOS.x, SILOS.z, 30], ["BIG DADDY DRILLING: HOSTILE · A.I. · LASERS", RIVAL.x, RIVAL.z, 80], ["EL FUEGO TACOS", TACO.x, TACO.z, 30], ["THE HOME PASTURE: A LOT OF CATTLE", 150, 210, 60]] as [string, number, number, number][]) {
      if (!this.seen.has(name) && Math.hypot(px - x, pz - z) < r) { this.seen.add(name); g.ui.toast("DISCOVERED", name); g.sfx.good(); }
    }
    // near enough to bother with the animations
    const near = (x: number, z: number, r: number) => Math.hypot(px - x, pz - z) < r;
    if (near(POND.x, POND.z, 120)) for (const d of this.ducks) { d.a += d.w * dt; const x = POND.x + Math.cos(d.a) * (POND.rx - 4) * (0.4 + d.r), z = POND.z + Math.sin(d.a) * (POND.rz - 3) * (0.4 + d.r); d.m.position.set(x, 0.14 + Math.sin(this.t * 2 + d.a) * 0.02, z); d.m.rotation.y = -d.a + (d.w > 0 ? 0 : Math.PI) + Math.PI / 2; }
    // the cattle wander, flee a bit when startled, and a truck that hits one is going to hear about it
    let best = 1e9; this.nearCow = 0;
    const riding = g.veh.riding, speed = Math.hypot(p.vel.x, p.vel.z);
    this.cows.forEach((c, i) => {
      const d = Math.hypot(c.x - px, c.z - pz); if (d < best) { best = d; this.nearCow = i; }
      if (d > 150) return;
      c.t -= dt;
      if (c.flee > 0) { c.flee -= dt; c.sp = 3.2; }
      else if (c.t <= 0) { c.t = rnd(2, 7); if (Math.random() < 0.55) { c.sp = 0; } else { c.sp = rnd(0.5, 0.9); c.h += rnd(-1.3, 1.3); } }
      const nx = c.x + Math.sin(c.h) * c.sp * dt, nz = c.z + Math.cos(c.h) * c.sp * dt;
      if (nx < PASTURE.x0 || nx > PASTURE.x1 || nz < PASTURE.z0 || nz > PASTURE.z1) c.h += Math.PI * 0.6; else { c.x = nx; c.z = nz; }
      c.n.position.set(c.x, 0, c.z); c.n.rotation.y = c.h;
      if (riding && d < 3.0 && this.vehSpeed() > 4 && ((this.cd["cow"] ?? -99) + 6 < this.t)) {
        this.cd["cow"] = this.t; c.flee = 3; c.h = Math.atan2(c.x - px, c.z - pz); g.sfx.thud(); g.sim.addCost(1800); g.inc(1, "CATTLE COLLISION");
        g.radio("hank" as any, "THAT'S MY HEIFER! Send the bill to Houston!", 6500); g.ui.toast("CATTLE COLLISION", "$1,800. The cow is fine. The cow is furious.");
      }
    });
    void speed;
    // Hank yells when you wander up to the porch
    if (near(FARM.x + 8, FARM.z, 26) && !riding && (this.cd["hankyell"] ?? -99) + 28 < this.t) {
      this.cd["hankyell"] = this.t; g.radio("hank" as any, pick(["GET OFF MY PORCH!", "I SEE YOU, COMPANY MAN!", "That's private property! The sign's right there!", "Don't make me go inside for my other shotgun!"]), 6000);
    }
    // the competitor: taunts as you approach, guards come out, and a shove if they reach you
    const gx = RIVAL.x + 44, gz = RIVAL.z;
    if (near(gx, gz, 55) && (this.cd["rivaltaunt"] ?? -99) + 15 < this.t) {
      this.cd["rivaltaunt"] = this.t; g.radio("rival" as any, pick(["INTRUDER DETECTED. HELLO, COMPANY MAN. YOU ARE WRONG LEASE.", "Your rig uses steel. We use light. Please compute the difference.", "Our laser reached TD while you were reading this. I'm joking. I do not joke. That was not a joke.", "Keep walking. Our models predict you will, anyway."]), 6500);
    }
    for (const gd of this.guards) {
      const hunting = near(RIVAL.x, RIVAL.z, 60) && near(gx, gz, 44) && !riding;
      let tx: number, tz: number, sp: number;
      if (hunting) { tx = px; tz = pz; sp = 3.2; } else { const [wx, wz] = gd.wp[gd.i]; tx = wx; tz = wz; sp = 1.1; if (Math.hypot(wx - gd.h.root.position.x, wz - gd.h.root.position.z) < 0.6) gd.i = (gd.i + 1) % gd.wp.length; }
      const hx = gd.h.root.position.x, hz = gd.h.root.position.z, dx = tx - hx, dz = tz - hz, dd = Math.hypot(dx, dz);
      if (hunting && dd < 1.7) {
        if ((this.cd["shove"] ?? -99) + 12 < this.t) {
          this.cd["shove"] = this.t; const ux = (px - hx) / (dd || 1), uz = (pz - hz) / (dd || 1);
          p.teleport(px + ux * 16, 0.5, pz + uz * 16, Math.atan2(ux, uz)); g.gain(0, -3); g.sfx.thud(); g.ui.toast("ESCORTED OFF BIG DADDY'S LEASE", "“ESCORT COMPLETE. HAVE A SUBOPTIMAL DAY.”");
          g.radio("rival" as any, "TRESPASSER REMOVED. EFFICIENCY RESTORED.", 5000);
        }
        gd.h.animate(dt, 0); continue;
      }
      if (dd > 0.3) { const k = Math.min(1, sp * dt / dd); gd.h.root.position.x += dx * k; gd.h.root.position.z += dz * k; const want = Math.atan2(dx, dz); let a = want - gd.h.root.rotation.y; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; gd.h.root.rotation.y += a * Math.min(1, dt * 8); gd.h.animate(dt, sp); } else gd.h.animate(dt, 0);
    }
    if (this.fut && near(RIVAL.x, RIVAL.z, 260)) {
      const f = this.fut, pulse = 0.5 + 0.5 * Math.sin(this.t * 7);
      f.core.scaling.x = f.core.scaling.z = 0.9 + 0.2 * pulse; f.glow.scaling.x = f.glow.scaling.z = 0.9 + 0.35 * Math.sin(this.t * 4.1 + 1); (f.ground.material as StandardMaterial).alpha = 0.35 + 0.3 * pulse; f.ground.scaling.x = f.ground.scaling.y = 4.2 + 0.7 * pulse;
      f.ring.rotation.y += dt * 1.6; f.ring.rotation.x = Math.sin(this.t * 0.9) * 0.35;
      for (const d of f.drones) { d.a += d.w * dt; d.m.position.set(RIVAL.x + Math.cos(d.a) * d.r, d.h + Math.sin(this.t * 2 + d.a) * 0.8, RIVAL.z + Math.sin(d.a) * d.r); d.m.rotation.y += dt * 2; }
      f.arm.rotation.y = Math.sin(this.t * 0.5) * 1.2; f.l1.rotation.x = -0.4 + Math.sin(this.t * 0.9) * 0.3; f.l2.rotation.x = 0.7 + Math.sin(this.t * 1.3) * 0.4;
    }
    this.updateFishing(dt);
    // the people who stand still still breathe
    this.hank.animate(dt, 0); this.lupe.animate(dt, 0); this.rusty.animate(dt, 0);
    this.hank.armR.rotation.x = -0.6; this.hank.elbowR!.rotation.x = -1.2;
  }

  private vehSpeed() { const p = this.g.player; const now = performance.now(); const last = (this as any)._lp ?? { x: p.pos.x, z: p.pos.z, t: now }; const dt = Math.max(0.001, (now - last.t) / 1000); const s = Math.hypot(p.pos.x - last.x, p.pos.z - last.z) / dt; (this as any)._lp = { x: p.pos.x, z: p.pos.z, t: now }; return Math.min(60, s); }
}
