import { Scene, MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode, Mesh, VertexBuffer, VertexData } from "@babylonjs/core";
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
    const { x, z } = RIVAL, R = (dx: number, dz: number) => new Vector3(x + dx, 0, z + dz);
    b.slab("pad", x - 22, 0, z - 22, x + 22, 0.1, z + 22);
    // substructure and rig floor
    b.slab("bddblk", x - 5, 0, z - 5, x + 5, 3.2, z + 5, true); b.slab("bddred", x - 5.1, 3.2, z - 5.1, x + 5.1, 3.4, z + 5.1);
    // the mast: four legs leaning in, braced, with a crown
    const legs: [number, number][] = [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]];
    for (const [lx, lz] of legs) b.beam("bddred", new Vector3(x + lx, 3.4, z + lz), new Vector3(x + lx * 0.4, 27, z + lz * 0.4), 0.28, 6);
    for (const y of [8, 14, 20]) { const k = 1 - (y - 3.4) / 23.6 * 0.6; for (let i = 0; i < 4; i++) { const [ax, az] = legs[i], [cx2, cz2] = legs[(i + 1) % 4 === 2 ? 3 : (i + 1) % 4]; if (i === 2) continue; b.beam("bddsteel", new Vector3(x + ax * k, y, z + az * k), new Vector3(x + cx2 * k, y, z + cz2 * k), 0.1, 5); } }
    b.slab("bddblk", x - 1.2, 27, z - 1.2, x + 1.2, 28.2, z + 1.2); b.cyl("bddsteel", x, 14, z, 0.3, 26, { tess: 8 });
    b.label("BIG DADDY\nDRILLING", x + 5.12, 5.6, z, 5.4, 1.8, Math.PI / 2, "#a01818", "#ffffff", 56);
    // doghouse, tanks, trailers, a light tower
    b.slab("bddblk", x + 8, 0.1, z - 4, x + 14, 3.2, z + 1, true); b.slab("bddred", x + 8, 3.2, z - 4, x + 14, 3.4, z + 1);
    b.slab("bddsteel", x - 18, 0.1, z - 10, x - 11, 3.5, z - 4, true); b.slab("bddred", x - 18, 3.5, z - 10, x - 11, 3.7, z - 4);
    for (let i = 0; i < 3; i++) b.cyl("bddsteel", x - 14 + i * 4.2, 2.1, z + 12, 3.6, 4.2, { tess: 16, solid: true });
    b.cyl("bddsteel", x + 15, 5, z + 14, 0.3, 10, { tess: 6 }); b.slab("bulb", x + 14, 10, z + 13.8, x + 16, 10.4, z + 14.2);
    // chain-link-ish fence all round, a gate toward the lease (+x side), warning signs
    const F = 25;
    for (let i = -F; i <= F; i += 5) for (const [px, pz] of [[x + i, z - F], [x + i, z + F], [x - F, z + i], [x + F, z + i]] as [number, number][]) b.slab("bddsteel", px - 0.08, 0, pz - 0.08, px + 0.08, 2.0, pz + 0.08);
    for (const y of [0.5, 1.0, 1.5, 2.0]) {
      b.beam("bddsteel", R(-F, -F).add(new Vector3(0, y, 0)), R(F, -F).add(new Vector3(0, y, 0)), 0.03); b.beam("bddsteel", R(-F, F).add(new Vector3(0, y, 0)), R(F, F).add(new Vector3(0, y, 0)), 0.03);
      b.beam("bddsteel", R(-F, -F).add(new Vector3(0, y, 0)), R(-F, F).add(new Vector3(0, y, 0)), 0.03);
      b.beam("bddsteel", R(F, -F).add(new Vector3(0, y, 0)), R(F, -4).add(new Vector3(0, y, 0)), 0.03); b.beam("bddsteel", R(F, 4).add(new Vector3(0, y, 0)), R(F, F).add(new Vector3(0, y, 0)), 0.03);   // gate gap
    }
    b.blocker(x - F, 0, z - F, x + F, 2.0, z - F + 0.2); b.blocker(x - F, 0, z + F - 0.2, x + F, 2.0, z + F); b.blocker(x - F, 0, z - F, x - F + 0.2, 2.0, z + F);
    b.blocker(x + F - 0.2, 0, z - F, x + F, 2.0, z - 4); b.blocker(x + F - 0.2, 0, z + 4, x + F, 2.0, z + F);
    b.label("WE'RE NOT HIRING.\nYOU'RE NOT WELCOME.", x + F + 0.3, 2.6, z - 7, 3.4, 1.2, Math.PI / 2, "#1c1c1e", "#ff5a4a", 36);
    b.label("NO COMPANY MEN\nTRESPASSERS WILL BE DRUG TESTED", x + F + 0.3, 2.6, z + 7, 3.4, 1.2, Math.PI / 2, "#a01818", "#ffffff", 28);
    // the crew: red hard hats, patrolling inside the wire, and a big toolpusher at the gate
    const mk = (hx: number, hz: number, sc: number, wps: [number, number][]) => {
      const h = new Human(this.scene, { shirt: "#7a1010", pants: "#222222", hat: "#a01818", skin: pick(["#d9a77f", "#b98b63", "#e0b48f"]), vest: true, scale: sc });
      h.root.position.set(x + hx, 0.1, z + hz); this.guards.push({ h, x: x + hx, z: z + hz, wp: wps.map(([a, c]) => [x + a, z + c] as [number, number]), i: 0 });
    };
    mk(14, 8, 1.0, [[14, 8], [14, 18], [4, 18], [4, 8]]); mk(-12, -14, 1.02, [[-12, -14], [-4, -14], [-4, -20], [-12, -20]]); mk(8, -16, 0.98, [[8, -16], [18, -16], [18, -8], [8, -8]]); mk(-8, 12, 1.0, [[-8, 12], [-20, 12], [-20, 20], [-8, 20]]);
    this.rusty = new Human(this.scene, { shirt: "#1c1c1e", pants: "#3a3a3a", hat: "#a01818", skin: "#c99870", vest: true, scale: 1.12 });
    this.rusty.root.position.set(x + F - 3, 0.1, z); this.rusty.root.rotation.y = Math.PI / 2;
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
    out.push({ pos: () => v(POND.x + POND.rx + 8, 1.7, POND.z), label: () => "Fish off the dock", r: 3.4, act: () => {
      g.sfx.click(); fishN++;
      const catches = ["A boot. Left foot.", "A tiny catfish. You let it go. It looks relieved.", "Nothing. You feel calmer anyway.", "A lost drill bit. This is, technically, a fishing job.", "A large bass. It's the size of your radio.", "A rubber duck. One of the ducks is staring at you."];
      g.ui.toast("FISHING", catches[(fishN - 1) % catches.length]); if (fishN % 3 === 0 && cdOk("fishgain", 30)) g.gain(0, 3); } });
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
    out.push({ pos: () => this.rusty.root.position.add(v(0, 1.2, 0)), label: () => "Talk to the Big Daddy toolpusher", r: 3.4, act: () => this.talkRusty(rustN++) });
    out.push({ pos: () => v(RIVAL.x + 26.5, 1.4, RIVAL.z + 8), label: () => "Spy on their rig", r: 3.4, act: () => {
      g.sfx.click(); g.ui.toast("YOU SQUINT", pick(["They're at 2,100 feet. Their 'depth' board looks hand-painted.", "Their derrick is taller than ours. You decide it's a safety issue.", "Their crew all have the same haircut. It's unsettling.", "Everything is red. Even the coffee pot."])); if (cdOk("spy", 20)) g.gain(0, -1); } });
    // the cattle: the nearest one, wherever it is
    out.push({ pos: () => { const c = this.cows[this.nearCow]; return c ? v(c.x, 1.3, c.z) : v(0, -999, 0); }, label: () => "Moo at the cow", r: 3.2, ok: () => { const c = this.cows[this.nearCow]; return !!c && Math.hypot(c.x - g.player.pos.x, c.z - g.player.pos.z) < 4.2; }, act: () => {
      g.sfx.click(); const c = this.cows[this.nearCow]; if (!c) return;
      g.ui.toast("MOOOOO", pick(["The cow moos back. It's not impressed.", "It looks at you for a very long time.", "You've made a friend. Possibly.", "The herd turns to look. All of it."]));
      for (const o of this.cows) if (Math.hypot(o.x - c.x, o.z - c.z) < 14) { o.flee = 2.5; o.h = Math.atan2(o.x - g.player.pos.x, o.z - g.player.pos.z); } } });
    return out;
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
    const L = ["You've got a lot of nerve showing up here in that sad little hard hat.", "We're drilling twice as fast as you. Three times, if you ask Houston. Houston likes us.", "Don't make me call Big Daddy. He's in a meeting. With a bigger rig.", "Go home, Company Man. Take your sad little pad with you."];
    g.say("rival" as any, L[n % L.length], [
      { label: "Nice fence.", run: () => g.radio("rival" as any, "It's not for you. It's for everybody like you.", 5000) },
      { label: "Make a rude gesture", cls: "alt", run: () => { g.gain(0, 2); g.ui.toast("+2 MORALE", "Mature. The crew will hear about it."); for (const gd of this.guards) { gd.i = 0; } } },
    ] as any, "Rusty — Big Daddy Drilling");
  }

  // ---------------------------------------------------------------------------------------------- per frame
  update(dt: number) {
    const g = this.g, p = g.player; this.t += dt;
    const px = p.pos.x, pz = p.pos.z;
    // discoveries
    for (const [name, x, z, r] of [["PRIVATE POND", POND.x, POND.z, 60], ["THE BREAKS: GOOD HILLS FOR A TRUCK", 190, -70, 70], ["HANK'S FARMSTEAD", FARM.x, FARM.z, 40], ["OLD GRAIN SILOS", SILOS.x, SILOS.z, 30], ["BIG DADDY DRILLING: HOSTILE", RIVAL.x, RIVAL.z, 55], ["EL FUEGO TACOS", TACO.x, TACO.z, 30], ["THE HOME PASTURE: A LOT OF CATTLE", 150, 210, 60]] as [string, number, number, number][]) {
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
    const gx = RIVAL.x + 25, gz = RIVAL.z;
    if (near(gx, gz, 42) && (this.cd["rivaltaunt"] ?? -99) + 15 < this.t) {
      this.cd["rivaltaunt"] = this.t; g.radio("rival" as any, pick(["HEY! Company Man! Wrong lease!", "That's a nice little rig. Did you build it out of Legos?", "We're going to drill past you. Underneath you. Just so you know.", "Keep walking. Keep driving. Keep… being small."]), 6500);
    }
    for (const gd of this.guards) {
      const hunting = near(RIVAL.x, RIVAL.z, 34) && near(gx, gz, 30) && !riding;
      let tx: number, tz: number, sp: number;
      if (hunting) { tx = px; tz = pz; sp = 3.2; } else { const [wx, wz] = gd.wp[gd.i]; tx = wx; tz = wz; sp = 1.1; if (Math.hypot(wx - gd.h.root.position.x, wz - gd.h.root.position.z) < 0.6) gd.i = (gd.i + 1) % gd.wp.length; }
      const hx = gd.h.root.position.x, hz = gd.h.root.position.z, dx = tx - hx, dz = tz - hz, dd = Math.hypot(dx, dz);
      if (hunting && dd < 1.7) {
        if ((this.cd["shove"] ?? -99) + 12 < this.t) {
          this.cd["shove"] = this.t; const ux = (px - hx) / (dd || 1), uz = (pz - hz) / (dd || 1);
          p.teleport(px + ux * 16, 0.5, pz + uz * 16, Math.atan2(ux, uz)); g.gain(0, -3); g.sfx.thud(); g.ui.toast("SHOVED OFF BIG DADDY'S LEASE", "“And stay off!”");
          g.radio("rival" as any, "That's what you get, Company Man.", 5000);
        }
        gd.h.animate(dt, 0); continue;
      }
      if (dd > 0.3) { const k = Math.min(1, sp * dt / dd); gd.h.root.position.x += dx * k; gd.h.root.position.z += dz * k; const want = Math.atan2(dx, dz); let a = want - gd.h.root.rotation.y; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; gd.h.root.rotation.y += a * Math.min(1, dt * 8); gd.h.animate(dt, sp); } else gd.h.animate(dt, 0);
    }
    // the people who stand still still breathe
    this.hank.animate(dt, 0); this.lupe.animate(dt, 0); this.rusty.animate(dt, 0);
    this.hank.armR.rotation.x = -0.6; this.hank.elbowR!.rotation.x = -1.2;
  }

  private vehSpeed() { const p = this.g.player; const now = performance.now(); const last = (this as any)._lp ?? { x: p.pos.x, z: p.pos.z, t: now }; const dt = Math.max(0.001, (now - last.t) / 1000); const s = Math.hypot(p.pos.x - last.x, p.pos.z - last.z) / dt; (this as any)._lp = { x: p.pos.x, z: p.pos.z, t: now }; return Math.min(60, s); }
}
