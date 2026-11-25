import {
  Scene, Mesh, MeshBuilder, Vector3, Quaternion, Color3, StandardMaterial, DynamicTexture,
  TransformNode, Matrix,
} from "@babylonjs/core";
import { Builder, AABB, node, pushOutXZ } from "./builder";
import { RYAW, rpos, rv } from "./rigxf";
import { Human } from "./npcs";
import type { Kit } from "./models";
import { corrugated, woodGrain, DetailTex } from "./textures";
import { Screens, ScreenKind } from "./screens";

export const F = 7.8; // drill floor height above ground (m) - 25.5 ft standard FlexRig-class floor
export const STAND_M = 28.35; // 93 ft stand

export interface RigFrame {
  depth: number; startDepth: number; rotating: boolean; connecting: boolean; tripping: boolean;
  tripFrac: number; standsRacked: number; night: number; t: number; pumpsOn: boolean; flaring: boolean; kicking?: boolean;
  /** live data for the cabin monitors; `near` = the player is close enough for them to be worth redrawing */
  screens?: import("./screens").ScreenData; near?: boolean;
}

export interface Rig {
  spots: Record<string, Vector3>;
  colliders: AABB[];
  roofs: { mesh: import("@babylonjs/core").Mesh; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }[];
  merged: Mesh[];
  humans: Record<string, Human>;
  update(dt: number, f: RigFrame): void;
  setPortaLocked(locked: boolean): void;
  setBump(on: boolean): void;
  setCasingTruck(on: boolean): void;
  /** the off-location windmill: spinning (true) or braked (false) */
  setWindmill(on: boolean): void;
  /** the live monitors (desk screens in the driller's cabin): what they show, and where they are in the world */
  monitors: { kind: ScreenKind; tex: DynamicTexture; pos: Vector3; cabin: boolean; grp: "drill" | "dd" | "tv"; slot?: [number, number]; span?: number }[];
  /** the safety trailer's "days since last incident" board */
  setDaysSince(n: number): void;
  /** the hydraulic catwalk's controls (the ground station and the rig-floor remote both drive these) */
  catwalk: { readonly phase: "idle" | "kicking" | "loaded" | "pushing"; readonly lowered: boolean; readonly delivered: number; takeEvent(): string; kick(): string | null; toggleLift(): void; push(): string | null };
  /** where the crew huddles inside the safety trailer (world coords, floor height) and where you step out */
  huddle: { x: number; y: number; z: number; exit: { x: number; z: number } };
  /** while on, the walking crew stand still (for the stand-down huddle) */
  huddleHold: { on: boolean };
  heliState: { phase: "hidden" | "landing" | "landed" | "leaving"; node: TransformNode };
  /** the finale's space shuttle: it comes down on the helipad, waits for you, then launches */
  shuttleState: { phase: "hidden" | "landing" | "landed" | "launching"; node: TransformNode; v: number; t: number };
  buildShuttle(): TransformNode;
  deerNode: TransformNode;
  windsock: TransformNode;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

function noiseTex(scene: Scene, base: string, speck: string[], n: number, size = 256, repeat = 24) {
  const t = new DynamicTexture("noise", size, scene, true);
  const c = t.getContext() as CanvasRenderingContext2D;
  c.fillStyle = base; c.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    c.fillStyle = speck[(Math.random() * speck.length) | 0];
    const s = 0.7 + Math.random() * 1.7;
    const px = Math.random() * size, py = Math.random() * size;
    // draw wrapped so the texture tiles seamlessly (clipped speckles left a faint grid line at every tile edge)
    for (const ox of [0, -size]) for (const oy of [0, -size]) c.fillRect(px + ox, py + oy, s, s);
  }
  t.update();
  t.wrapU = 1; t.wrapV = 1;   // WRAP: a DynamicTexture clamps by default, and clamped, every repeat past the first smears the edge texels into streaks
  t.anisotropicFilteringLevel = 4;
  t.uScale = repeat; t.vScale = repeat;
  return t;
}

function platTex(scene: Scene) {
  const size = 128;
  const t = new DynamicTexture("plate", size, scene, true);
  const c = t.getContext() as CanvasRenderingContext2D;
  c.fillStyle = "#4b5057"; c.fillRect(0, 0, size, size);
  c.strokeStyle = "#6a7078"; c.lineWidth = 3;
  for (let y = 0; y < size; y += 16) for (let x = 0; x < size; x += 16) {
    c.beginPath();
    if (((x + y) / 16) % 2) { c.moveTo(x + 3, y + 3); c.lineTo(x + 11, y + 11); } else { c.moveTo(x + 11, y + 3); c.lineTo(x + 3, y + 11); }
    c.stroke();
  }
  t.update(); t.wrapU = 1; t.wrapV = 1; t.uScale = 1; t.vScale = 1;
  return t;
}

export function buildRig(scene: Scene, opts: { bump?: boolean; kit?: Kit | null } = {}): Rig {
  const kit = opts.kit ?? null;
  const b = new Builder(scene);
  const spots: Record<string, Vector3> = {};

  // ---------- materials ----------
  const ground = new StandardMaterial("ground", scene);
  ground.diffuseTexture = noiseTex(scene, "#b59d78", ["#a58b66", "#c8b28c", "#8f7852", "#d6c4a0"], 5000, 256, 450);   // same tile size on a ground six times wider
  ground.specularColor = Color3.Black();
  const groundMesh = MeshBuilder.CreateGround("ground", { width: 6000, height: 6000 }, scene);   // wide enough that its edge is past the far plane and lost in the fog (no line on the horizon)
  groundMesh.material = ground; groundMesh.receiveShadows = true;

  const padMat = new StandardMaterial("pad", scene);
  padMat.diffuseTexture = noiseTex(scene, "#c9b48f", ["#bba57e", "#d8c8a6", "#a68f68", "#e1d3b4"], 4000, 256, 24);
  padMat.specularColor = Color3.Black();
  const pad = MeshBuilder.CreateGround("padmesh", { width: 120, height: 130 }, scene);
  pad.position.set(0, 0.04, 0); padMat.zOffset = -2; pad.material = padMat; pad.receiveShadows = false;

  const road = MeshBuilder.CreateGround("road", { width: 7, height: 300 }, scene);
  road.position.set(0, 0.08, 190);
  const rm = new StandardMaterial("roadm", scene);
  rm.diffuseTexture = noiseTex(scene, "#5a5650", ["#4a463f", "#6a665e", "#3d3a34"], 2500, 256, 8);
  { const rt = rm.diffuseTexture as DynamicTexture; rt.uScale = 3; rt.vScale = 129; rt.anisotropicFilteringLevel = 1; }   // the road is 7 m x 300 m: tile the texture to match, or it streaks
  rm.specularColor = Color3.Black(); rm.zOffset = -4; road.material = rm; road.receiveShadows = false;

  b.defMat("steel", "#7b8087"); b.defMat("dsteel", "#3a3f45"); b.defMat("black", "#16181a");
  b.defMat("orange", "#e0701a"); b.defMat("white", "#e3e5e8"); b.defMat("blue", "#2c5d8a"); b.defMat("navy", "#233a52");
  b.defMat("deck", "#52575e", { tex: platTex(scene) });
  b.defMat("yellow", "#e8b923"); b.defMat("red", "#b3231c"); b.defMat("green", "#2f7d3e"); b.defMat("pipe", "#8d9299", { spec: 0.3 });
  b.defMat("pipeband", "#e8b923"); b.defMat("tan", "#bfae8a"); b.defMat("trailer", "#d8d3c4"); b.defMat("trailer2", "#8a96a3");
  b.defMat("wood", "#7a5a38"); b.defMat("rust", "#8a4b2b"); b.defMat("tank", "#6b747c"); b.defMat("tankgreen", "#4d6a52");
  b.defMat("glass", "#9ccbe8", { alpha: 0.28, spec: 0.5 });
  b.defMat("screen", "#2a6a4a", { emissive: "#1f9a60" });
  b.defMat("screenb", "#1f4a8a", { emissive: "#2a7cff" }); b.defMat("screena", "#8a5a1f", { emissive: "#ffb02a" }); b.defMat("screenr", "#8a2a1f", { emissive: "#ff4a2a" });
  b.defMat("lamp", "#fff2c0", { emissive: "#ffe8a0" });
  b.defMat("beacon", "#ff2a1a", { emissive: "#ff2a1a" });
  b.defMat("cabinwall", "#cbd0d4"); b.defMat("poly", "#1d6fb5"); b.defMat("flaregray", "#5e6368");
  b.defMat("bopred", "#a8221c"); b.defMat("bopblue", "#244f8f"); b.defMat("accgreen", "#2e7a45");
  b.defMat("asphalt", "#3d3f42"); b.defMat("sack", "#c9c1a8"); b.defMat("lcm", "#a07844"); b.defMat("barite", "#7a7a7a");
  const lampMat = b.getMat("lamp");
  kit?.useLampMaterial(lampMat);

  // ---- surface detail: world-scaled panel/corrugation/wood textures with bump ----
  const co = corrugated(scene), wo = woodGrain(scene);
  const dressed: { mat: StandardMaterial; bump: DetailTex["bump"] }[] = [];
  const dress = (keys: string[], tex: DetailTex, tile: number, level: number, bump = true) => {
    for (const k of keys) {
      const m = b.getMat(k); m.diffuseTexture = tex.diffuse; b.setTile(k, tile);
      if (bump) {
        if (opts.bump !== false) { m.bumpTexture = tex.bump; tex.bump.level = level; }
        dressed.push({ mat: m, bump: tex.bump });
      }
    }
  };
  // metal stays smooth: plain painted colour, no panel/brush texture or bump, just a soft sheen
  for (const k of ["steel", "dsteel", "orange", "white", "blue", "navy", "red", "yellow", "bopred", "bopblue", "accgreen", "poly", "cabinwall", "flaregray", "tan", "trailer2", "black", "rust", "pipe", "pipeband"]) {
    const m = b.getMat(k); m.diffuseTexture = null; m.bumpTexture = null; m.specularColor = new Color3(0.2, 0.2, 0.2); m.specularPower = 48;
  }
  dress(["tank", "tankgreen", "trailer"], co, 1.4, 0.9);
  dress(["wood", "lcm"], wo, 1.2, 0.6);
  b.setTile("deck", 1.0);

  // The whole rig (everything from here to the pipe racks) is built facing +z and turned a quarter turn: V-door and racks point west.
  const rigRoot = new TransformNode("rigRoot", scene); rigRoot.rotation.y = RYAW;
  b.rot = RYAW;
  // ================= SUBSTRUCTURE (box-on-box) + DRILL FLOOR =================
  const FX = 6.5, FZ = 6.0;
  b.slab("deck", -FX, F - 0.25, -FZ, FX, F, FZ, true);
  // columns
  for (const x of [-6.0, -2.0, 2.0, 6.0]) for (const z of [-5.4, 0, 5.4]) {
    if (z === 0 && Math.abs(x) === 2) continue;
    b.slab("navy", x - 0.3, 0, z - 0.3, x + 0.3, F - 0.25, z + 0.3, true);
  }
  for (const y of [3.9, F - 0.7]) {
    for (const x of [-6, -2, 2, 6]) b.slab("blue", x - 0.2, y - 0.2, -5.6, x + 0.2, y + 0.2, 5.6);
    for (const z of [-5.4, 0, 5.4]) b.slab("blue", -6.2, y - 0.2, z - 0.2, 6.2, y + 0.2, z + 0.2);
  }
  // X braces on the back and side faces (front left open so you can see the BOP stack)
  const brace = (a: Vector3, c: Vector3) => b.beam("blue", a, c, 0.18, 4);
  for (const x of [-6.0, 6.0]) for (const z of [[-5.4, 0], [0, 5.4]]) {
    brace(v(x, 0.2, z[0]), v(x, 3.9, z[1])); brace(v(x, 0.2, z[1]), v(x, 3.9, z[0]));
    brace(v(x, 3.9, z[0]), v(x, F - 0.7, z[1])); brace(v(x, 3.9, z[1]), v(x, F - 0.7, z[0]));
  }
  for (const x of [[-6, -2], [-2, 2], [2, 6]]) {
    brace(v(x[0], 0.2, -5.4), v(x[1], 3.9, -5.4)); brace(v(x[1], 0.2, -5.4), v(x[0], 3.9, -5.4));
    brace(v(x[0], 3.9, -5.4), v(x[1], F - 0.7, -5.4)); brace(v(x[1], 3.9, -5.4), v(x[0], F - 0.7, -5.4));
  }
  // (the AL DRILLING board on the front of the substructure is gone)
  b.slab("steel", -6.5, 0, -6, -5.7, 0.3, 6); b.slab("steel", 5.7, 0, -6, 6.5, 0.3, 6);

  // ---- BOP stack in the cellar zone below the rotary ----
  // The stack stands on the wellhead in a 10 ft diameter, 6 ft deep cellar, so its bottom half is below ground; a longer bell nipple still reaches the floor.
  const CELL = 0;   // the wellhead sits at ground level and the stack stands on it; the cellar below holds just the casing stub and the ladder
  b.cyl("steel", 0, -0.92, 0, 0.5, 1.84, { tess: 12 });   // casing running down into the cellar
  if (kit) {
    const bopW = kit.place("bop", 0, -CELL, 0, RYAW);                     // Blender BOP stack: flanges, bonnets, hydraulics, valves
    bopW.scaling.set(1, 1, 1);
    b.blocker(-0.55, 1.35 - CELL, -0.45, 0.55, 2.65 - CELL, 0.45);
    b.cyl("steel", 0, 6.5, 0, 0.7, 2.6, { tess: 12 });                    // bell nipple extension up to the floor
  } else {
    b.cyl("steel", 0, 0.5 - CELL, 0, 1.0, 1.0, { tess: 14 });       // wellhead / casing head
    b.cyl("black", 0, 1.15 - CELL, 0, 1.3, 0.3, { tess: 14 });      // flange
    b.box("bopblue", 0, 2.0 - CELL, 0, 1.8, 1.3, 1.5, true);        // double ram body
    b.box("bopred", 0, 2.0 - CELL, 1.05, 1.0, 0.7, 0.6); b.box("bopred", 0, 2.0 - CELL, -1.05, 1.0, 0.7, 0.6);
    b.box("bopred", 1.2, 2.0 - CELL, 0, 0.6, 0.7, 1.0); b.box("bopred", -1.2, 2.0 - CELL, 0, 0.6, 0.7, 1.0);
    b.cyl("black", 0, 2.95 - CELL, 0, 1.3, 0.3, { tess: 14 });
    b.box("bopblue", 0, 3.6 - CELL, 0, 1.6, 0.9, 1.4);
    b.box("bopred", 1.0, 3.6 - CELL, 0, 0.5, 0.6, 0.9); b.box("bopred", -1.0, 3.6 - CELL, 0, 0.5, 0.6, 0.9);
    b.cyl("black", 0, 4.2 - CELL, 0, 1.3, 0.3, { tess: 14 });
    b.cyl("bopred", 0, 5.1 - CELL, 0, 1.5, 1.4, { tess: 16, dia2: 1.2 });  // annular
    b.cyl("steel", 0, 5.51, 0, 0.9, 3.08, { tess: 12 });            // bell nipple, long enough to reach the floor
  }
  // (the flowline from the bell nipple to the shaker header is built with the shakers, below)

  // ---- rotary table ----
  // rotary table: housing on the deck, the turning table on top, then the master bushing (with its four drive-pin lugs), the insert bowl, and the bore the pipe goes through
  b.box("dsteel", 0, F + 0.17, 0, 1.55, 0.34, 1.55);
  b.cyl("steel", 0, F + 0.37, 0, 1.28, 0.06, { tess: 24 });
  b.cyl("black", 0, F + 0.43, 0, 0.92, 0.12, { tess: 24 });                                   // master bushing
  for (const [lx, lz] of [[0.34, 0.34], [-0.34, 0.34], [0.34, -0.34], [-0.34, -0.34]]) b.box("steel", lx, F + 0.47, lz, 0.1, 0.08, 0.1);   // drive-pin lugs
  b.cyl("dsteel", 0, F + 0.46, 0, 0.58, 0.07, { tess: 20 });                                   // insert bowl rim
  b.cyl("black", 0, F + 0.497, 0, 0.42, 0.006, { tess: 20 });                                  // the bore: pipe passes through here
  const rotMark = MeshBuilder.CreateBox("rotmark", { width: 0.5, height: 0.03, depth: 0.1 }, scene);
  rotMark.position.set(0, F + 0.41, 0.52); rotMark.material = b.getMat("yellow"); rotMark.parent = rigRoot;
  // slips: three wedge segments with hinged yellow handles. They sit in the bowl around the pipe while a connection is made or on a trip, and lie next to the hole the rest of the time.
  const slips = node("slips", scene, 1.25, F + 0.01, -0.8); slips.parent = rigRoot;
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 + 0.5, sx = Math.sin(a), sz = Math.cos(a);
    const seg = MeshBuilder.CreateBox("slipseg", { width: 0.215, height: 0.34, depth: 0.075 }, scene);
    seg.material = b.getMat("dsteel"); seg.parent = slips; seg.position.set(sx * 0.135, 0.17, sz * 0.135); seg.rotation.y = a;
    const teeth = MeshBuilder.CreateBox("slipteeth", { width: 0.18, height: 0.24, depth: 0.012 }, scene);
    teeth.material = b.getMat("steel"); teeth.parent = slips; teeth.position.set(sx * 0.098, 0.15, sz * 0.098); teeth.rotation.y = a;
    const post = MeshBuilder.CreateBox("slipposts", { width: 0.03, height: 0.22, depth: 0.03 }, scene);
    post.material = b.getMat("yellow"); post.parent = slips; post.position.set(sx * 0.19, 0.42, sz * 0.19);
    const grip = MeshBuilder.CreateBox("slipgrip", { width: 0.13, height: 0.03, depth: 0.03 }, scene);
    grip.material = b.getMat("yellow"); grip.parent = slips; grip.position.set(sx * 0.19, 0.54, sz * 0.19); grip.rotation.y = a + Math.PI / 2;
    // hinge between this segment and the next: a pin and two straps across the gap, so the three segments are one linked set
    const m2 = a + Math.PI / 3, hx = Math.sin(m2), hz = Math.cos(m2);
    const pin = MeshBuilder.CreateCylinder("slippin", { diameter: 0.032, height: 0.38, tessellation: 8 }, scene);
    pin.material = b.getMat("steel"); pin.parent = slips; pin.position.set(hx * 0.118, 0.18, hz * 0.118);
    for (const hy of [0.06, 0.3]) {
      const strap = MeshBuilder.CreateBox("slipstrap", { width: 0.17, height: 0.035, depth: 0.024 }, scene);
      strap.material = b.getMat("dsteel"); strap.parent = slips; strap.position.set(hx * 0.128, hy, hz * 0.128); strap.rotation.y = m2;
    }
  }
  // red zone ring on the deck
  b.cyl("red", 0, F + 0.005, 0, 4.6, 0.01, { tess: 28 });
  b.cyl("deck", 0, F + 0.012, 0, 4.3, 0.01, { tess: 28 });

  // ---- deck railings ----
  const R = (x0: number, z0: number, x1: number, z1: number) => b.rail("yellow", x0, z0, x1, z1, F);
  R(-FX, -FZ, FX, -FZ);
  R(-FX, FZ, -2.2, FZ); R(2.2, FZ, FX, FZ);
  R(FX, 1.7, FX, 3.1); R(FX, 4.5, FX, FZ);
  R(-FX, -FZ, -FX, -1.6); R(-FX, -0.2, -FX, FZ);
  // stairs: east (to ground) and west
  b.stairs("dsteel", "yellow", FX, 3.8, "+x", F, 1.5);
  // the stairs off the pit side: one flight down to a landing level with the pit roofs, then a bridge straight over to the pits and a second flight down to the ground
  b.stairs("dsteel", "yellow", -FX, -0.9, "-x", F, 1.5, 0.26, 0.3, 2.78, true);
  {
    const LX0 = -15.4, LX1 = -12.2, LZ0 = -2.4, LZ1 = 0.6;
    b.slab("deck", LX0, 2.58, LZ0, LX1, 2.78, LZ1, true);                                              // landing
    for (const [px, pz] of [[LX0 + 0.12, LZ0 + 0.12], [LX1 - 0.12, LZ0 + 0.12], [LX0 + 0.12, LZ1 - 0.12], [LX1 - 0.12, LZ1 - 0.12]]) b.slab("dsteel", px - 0.1, 0, pz - 0.1, px + 0.1, 2.58, pz + 0.1);
    b.rail("yellow", LX1, LZ1, LX0 + 0.0, LZ1, 2.78, 1.1);                                              // south side, solid
    b.rail("yellow", LX1, LZ0, -13.05, LZ0, 2.78, 1.1); b.rail("yellow", -14.55, LZ0, LX0, LZ0, 2.78, 1.1);   // north side, open where flight B starts
    b.rail("yellow", LX0, LZ0, LX0, -1.65, 2.78, 1.1); b.rail("yellow", LX0, -0.15, LX0, LZ1, 2.78, 1.1);   // far end, open where the bridge starts
    b.stairs("dsteel", "yellow", -13.8, LZ0, "-z", 2.78, 1.5, 0.26, 0.3, 0, true);                                          // flight B: landing to the ground
    // bridge straight to the pit roofs
    b.slab("deck", -19.7, 2.63, -1.65, LX0, 2.78, -0.15, true);
    b.rail("yellow", LX0, -1.65, -19.6, -1.65, 2.78, 1.1); b.rail("yellow", LX0, -0.15, -19.6, -0.15, 2.78, 1.1);
    for (const px of [-16.9, -18.4]) for (const pz of [-1.55, -0.25]) b.slab("dsteel", px - 0.05, 0, pz - 0.05, px + 0.05, 2.63, pz + 0.05);
    b.label("TO PITS", -17.5, 3.9, -0.9, 1.4, 0.35, Math.PI / 2, "#233a52", "#ffd24a", 46);
  }
  // V-door pipe ramp (z=6 -> 18)
  {
    const n = 60, run = 0.2; // fine collision steps approximate a smooth slope
    b.ramp("deck", 0, 2.0, FZ, F, FZ + n * run, 0);
    for (let k = 1; k <= n; k++) {
      const top = F - (F / n) * k, cz = FZ + (k - 0.5) * run;
      // thin walking surface only: the space under the ramp stays open so you can run (or drive) through it
      b.blocker(-1.0, top - 0.12, cz - run / 2, 1.0, top, cz + run / 2);
      b.blocker(-1.2, top - 0.1, cz - run / 2, -1.0, top + 1.1, cz + run / 2); b.blocker(1.0, top - 0.1, cz - run / 2, 1.2, top + 1.1, cz + run / 2);   // side rails sit on the ramp
    }
    b.beam("yellow", v(-1.05, F + 0.9, FZ), v(-1.05, 0.9, FZ + n * run), 0.06);
    b.beam("yellow", v(1.05, F + 0.9, FZ), v(1.05, 0.9, FZ + n * run), 0.06);
    for (const sx of [-1.05, 1.05]) { b.box("yellow", sx, F + 0.45, FZ, 0.07, 0.9, 0.07); b.box("yellow", sx, 0.45, FZ + n * run, 0.07, 0.9, 0.07); }   // end posts, so the rails are not floating
    b.label("V-DOOR", 0, F + 2.4, 5.9, 2.0, 0.6, Math.PI, "#7a1a14", "#ffffff", 64);
    b.label("SLICK RAMP\nNO WALKING", 1.25, F + 1.2, 6.2, 1.0, 0.8, Math.PI, "#e8b923", "#111111", 38);
  }

  // ---- driller's cabin (glass, enterable, 4.2 x 5.7 m): the driller sits at the west glass facing the rotary; the directional driller
  //      and MWD hand sit back-to-back with him at a desk along the east wall ----
  const screens = new Screens(scene);
  b.slab("deck", 6.5, F - 0.25, -5.9, 6.95, F, 1.5, true);                     // floor carried out under the cabin's east end
  b.room({ x0: 2.7, z0: -5.9, x1: 6.9, z1: 1.5, y0: F + 0.025, h: 2.975, wall: "cabinwall", roof: "dsteel", floor: "dsteel", glass: "glass",
    door: { side: "+z", c: 4.8, w: 1.3 } });
  let scrN = 0;
  /** a live monitor: black bezel and a unique emissive material whose canvas texture is redrawn from the sim */
  const tvScreens = new Screens(scene);
  let tvT = 0, lastScr: import("./screens").ScreenData | undefined;
  const monitorList: Rig["monitors"] = [];
  const monitor = (face: "+x" | "-x", cx: number, cy: number, cz: number, w: number, h: number, kind: ScreenKind, scr: Screens = screens, slot?: [number, number], span?: number) => {
    const key = "scr" + scrN++, tex = scr.make(kind, false);
    monitorList.push({ kind, tex, pos: rpos(v(cx + (face === "+x" ? 0.3 : -0.3), cy, cz)), cabin: scr === screens, grp: scr !== screens ? "tv" : face === "+x" ? "drill" : "dd", slot, span });
    tex.wAng = Math.PI / 2;   // the box side faces map the canvas turned a quarter turn
    const m = b.defMat(key, "#000000"); m.emissiveTexture = tex; m.diffuseTexture = tex; m.diffuseColor.set(0.4, 0.4, 0.4); m.emissiveColor.set(0.85, 0.85, 0.85); m.specularColor.set(0, 0, 0);
    b.slab("black", cx - 0.04, cy - h / 2 - 0.03, cz - w / 2 - 0.03, cx + 0.04, cy + h / 2 + 0.03, cz + w / 2 + 0.03);
    if (face === "+x") b.slab(key, cx + 0.04, cy - h / 2, cz - w / 2, cx + 0.05, cy + h / 2, cz + w / 2);
    else b.slab(key, cx - 0.05, cy - h / 2, cz - w / 2, cx - 0.04, cy + h / 2, cz + w / 2);
    b.slab("dsteel", cx - 0.03, cy - h / 2 - 0.2, cz - 0.04, cx + 0.03, cy - h / 2 - 0.03, cz + 0.04);   // stand
  };
  // ---- driller's desk on the west glass: four live monitors low enough to see the rotary over, plus overhead displays ----
  // the four desk monitors are split two and two to the ends of the desk, so the middle (where the driller sits) is open glass onto the rotary and the floor
  const deskZ = [-5.45, -4.55, -1.85, -0.95];
  b.slab("dsteel", 2.8, F, -5.9, 3.6, F + 0.95, -0.5, true);
  b.slab("steel", 2.8, F + 0.95, -5.9, 3.6, F + 0.99, -0.5);
  // the wall of screens: four on the desk with a two-monitor gap in the middle to see the rotary through, six hung across the top
  (["params", "auto", "alarms", "pits"] as ScreenKind[]).forEach((k, i) => monitor("+x", 3.25, F + 1.32, deskZ[i], 0.85, 0.54, k, screens, [1, [0, 1, 4, 5][i]]));
  monitor("+x", 3.0, F + 2.12, -5.0, 1.72, 0.84, "edr", screens, [0, 0], 2);   // the two top left monitors are one big EDR
  (["pumps", "hookload", "steer", "plan"] as ScreenKind[]).forEach((k, i) => monitor("+x", 3.0, F + 2.35, -3.65 + i * 0.9, 0.82, 0.5, k, screens, [0, i + 2]));
  for (const mz of deskZ) b.slab("black", 3.55, F + 0.99, mz - 0.25, 3.85, F + 1.03, mz + 0.25);   // keyboards / panels under each monitor
  // driller's chair at (4.5, -3.2) facing west: joystick arms, throttle and brake
  b.cyl("black", 4.5, F + 0.25, -3.2, 0.14, 0.5, { tess: 8 }); b.slab("black", 4.1, F, -3.6, 4.9, F + 0.07, -2.8);
  b.slab("black", 4.2, F + 0.5, -3.5, 4.8, F + 0.6, -2.9); b.slab("black", 4.75, F + 0.6, -3.5, 4.85, F + 1.4, -2.9);
  b.slab("dsteel", 3.95, F + 0.75, -3.62, 4.4, F + 0.82, -3.5); b.slab("dsteel", 3.95, F + 0.75, -2.9, 4.4, F + 0.82, -2.78);
  b.cyl("steel", 4.0, F + 0.95, -3.56, 0.04, 0.25, { tess: 6 }); b.cyl("red", 4.0, F + 1.1, -3.56, 0.07, 0.07, { tess: 8 }); b.cyl("steel", 4.0, F + 0.95, -2.84, 0.04, 0.25, { tess: 6 });
  spots.cabin = v(3.7, F + 1.3, -3.2);
  // ---- directional driller / MWD desk along the east wall: they face east, back to the driller ----
  b.slab("dsteel", 6.0, F, -5.7, 6.8, F + 0.95, -1.6, true);
  b.slab("steel", 6.0, F + 0.95, -5.7, 6.8, F + 0.99, -1.6);
  ([["survey", -5.2], ["toolface", -4.45], ["steer", -3.7], ["gamma", -2.95]] as [ScreenKind, number][]).forEach(([k, z], i) => monitor("-x", 6.45, F + 1.32, z, 0.7, 0.5, k, screens, [1, i]));
  ([["plan", -5.0], ["geo", -4.0], ["ac", -3.0], ["mwd", -2.0]] as [ScreenKind, number][]).forEach(([k, z], i) => monitor("-x", 6.6, F + 2.1, z, 0.9, 0.5, k, screens, [0, i]));
  for (const z of [-5.0, -4.0, -3.0]) b.slab("black", 6.15, F + 0.99, z - 0.25, 6.4, F + 1.03, z + 0.25);
  for (const cz of [-4.7]) {                                                     // the directional driller's chair, facing the desk
    b.cyl("black", 5.4, F + 0.25, cz, 0.12, 0.5, { tess: 8 }); b.slab("black", 5.0, F, cz - 0.4, 5.8, F + 0.07, cz + 0.4);
    b.slab("black", 5.1, F + 0.5, cz - 0.3, 5.7, F + 0.58, cz + 0.3); b.slab("black", 5.05, F + 0.58, cz - 0.3, 5.15, F + 1.3, cz + 0.3);
  }
  // ---- room details: ceiling lights, A/C, fridge, wall clock, whiteboard, door mat ----
  b.slab("lamp", 3.9, F + 2.94, -4.4, 5.5, F + 3.0, -4.0); b.slab("lamp", 3.9, F + 2.94, -2.3, 5.5, F + 3.0, -1.9);
  b.slab("steel", 4.4, F + 3.12, -4.6, 5.8, F + 3.5, -3.4);
  b.slab("white", 6.4, F, 1.0, 6.8, F + 0.9, 1.4, true);
  b.slab("white", 3.0, F + 1.4, 1.42, 3.9, F + 2.2, 1.46); b.slab("red", 3.05, F + 1.45, 1.415, 3.4, F + 1.5, 1.45);     // whiteboard on the north wall
  b.slab("black", 3.0, F + 0.01, 0.8, 3.8, F + 0.03, 1.4);
  b.label("DRILLER", 4.8, F + 2.6, 1.58, 1.6, 0.4, Math.PI, "#233a52", "#ffd24a", 60);
  // company wrap on the outside walls: a dark band with the rig name
  const wrapBg = "#14253a", wrapFg = "#f4c04a";
  b.label("AL DRILLING RIG 107", 4.8, F + 0.52, -5.98, 4.0, 0.78, 0, wrapBg, wrapFg, 62);
  b.label("AL DRILLING RIG 107", 6.98, F + 0.52, -2.2, 7.0, 0.78, Math.PI / 2, wrapBg, wrapFg, 62);
  b.label("AL DRILLING\nRIG 107", 3.6, F + 0.52, 1.58, 1.9, 0.78, Math.PI, wrapBg, wrapFg, 42);

  // ---- doghouse (enterable) ----
  b.room({ x0: -6.0, z0: -5.8, x1: -2.6, z1: -2.4, y0: F + 0.025, h: 2.575, wall: "tan", roof: "dsteel", floor: "dsteel",
    door: { side: "+z", c: -4.3, w: 1.1 } });
  b.slab("wood", -5.8, F, -5.6, -3.0, F + 0.85, -4.9, true);                  // table
  b.slab("steel", -5.9, F, -3.6, -5.5, F + 0.5, -2.7);                         // bench
  b.slab("white", -3.3, F + 1.2, -5.74, -2.8, F + 2.0, -5.7);                  // whiteboard
  b.slab("black", -3.0, F + 0.85, -5.5, -2.7, F + 1.15, -5.2);                 // coffee maker
  b.slab("red", -2.98, F + 0.85, -5.48, -2.72, F + 1.0, -5.22);
  spots.doghouse = v(-4.4, F + 1.2, -5.2);
  spots.coffee = v(-2.85, F + 1.1, -5.3);
  b.label("DOGHOUSE", -4.3, F + 2.7, -2.3, 1.8, 0.45, Math.PI, "#233a52", "#ffd24a", 60);

  // ---- iron roughneck, setback, fingerboard ----
  b.slab("orange", -2.4, F, 0.6, -1.4, F + 0.7, 1.6, true);
  // ST-80 iron roughneck: rail-mounted pedestal, column, parallel-link boom, and a head with torque wrench (lower) and spinner (upper)
  b.slab("steel", -2.5, F, 0.5, -2.35, F + 0.12, 1.7); b.slab("steel", -1.45, F, 0.5, -1.3, F + 0.12, 1.7);        // floor rails
  b.label("ST-80", -1.9, F + 0.5, 1.72, 0.8, 0.26, Math.PI, "#233a52", "#ffd24a", 60);
  for (const z of [0.75, 1.45]) for (const x of [-2.42, -1.38]) b.cyl("black", x, F + 0.2, z, 0.28, 0.14, { axis: "x", tess: 10 });   // carriage wheels
  const rough = node("rough", scene, -1.6, F + 0.7, 1.0); rough.parent = rigRoot;
  {
    const mk = (m: Mesh, mat: string, x: number, y: number, z: number) => { m.material = b.getMat(mat); m.parent = rough; m.position.set(x, y, z); return m; };
    const bx = (w: number, h: number, d: number, mat: string, x: number, y: number, z: number) => mk(MeshBuilder.CreateBox("rb", { width: w, height: h, depth: d }, scene), mat, x, y, z);
    const cy = (dia: number, h: number, mat: string, x: number, y: number, z: number, tess = 12) => mk(MeshBuilder.CreateCylinder("rc", { diameter: dia, height: h, tessellation: tess }, scene), mat, x, y, z);
    cy(0.9, 0.16, "dsteel", 0, 0.08, 0);                          // turntable
    bx(0.5, 1.05, 0.5, "orange", 0, 0.68, 0);                     // column
    bx(0.62, 0.22, 0.62, "yellow", 0, 1.25, 0);                   // column cap
    bx(0.2, 0.2, 1.9, "orange", 0, 1.05, -0.95);                  // upper boom link
    bx(0.14, 0.14, 1.9, "orange", 0, 0.7, -0.95);                 // lower parallel link
    bx(0.12, 0.5, 0.12, "dsteel", 0, 0.88, -1.8);                 // head hanger
    cy(0.1, 0.6, "steel", 0.2, 0.9, -0.25, 8).rotation.x = Math.PI / 2;  // boom ram
    // head: lower torque wrench, upper spinning wrench, jaws and cylinders
    cy(0.8, 0.3, "dsteel", 0, 0.5, -1.9, 14);
    cy(0.62, 0.32, "yellow", 0, 0.9, -1.9, 14);
    cy(0.4, 0.34, "black", 0, 0.7, -1.9, 12);                     // throat between them
    for (const sx of [-1, 1]) {
      bx(0.22, 0.2, 0.14, "steel", sx * 0.3, 0.5, -1.62);          // lower jaws
      bx(0.2, 0.18, 0.12, "steel", sx * 0.24, 0.9, -1.64);         // upper jaws
      cy(0.08, 0.45, "steel", sx * 0.34, 0.7, -1.9, 8);            // hydraulic cylinders
      cy(0.14, 0.12, "red", sx * 0.34, 0.95, -1.9, 8);             // spinner motors
    }
    bx(0.4, 0.1, 0.5, "black", 0, 0.3, -1.65);                    // hose bundle tray
  }
  // ---- setback under the board: racked stands in two blocks either side of the V-door aisle (x -0.7..0.7), tops in the fingers above ----
  b.slab("dsteel", -2.9, F, 2.6, -0.7, F + 0.1, 5.8); b.slab("dsteel", 0.7, F, 2.6, 2.9, F + 0.1, 5.8);
  // (racked stands are solid one by one, only where a stand is actually standing: see setStands below)
  const FB = F + 25;
  // ---- monkey board, centred on the well (x = 0, the top drive's line): a central walkway with fingers either side, a stabbing board
  //      on the mast face right at the top drive, rails all round, and a ladder through the stabbing board ----
  b.slab("steel", -0.5, FB, 1.8, 0.5, FB + 0.12, 6.0);                                                       // centre walkway
  b.blocker(-0.5, FB - 0.15, 1.8, 0.5, FB + 0.12, 6.0);
  for (const [fx0, fx1] of [[-3.0, -0.5], [0.5, 3.0]] as [number, number][]) {
    b.slab("steel", fx0, FB, 1.8, fx1, FB + 0.08, 5.8);                                                      // finger deck
    const px0 = fx0 < 0 ? fx0 + 0.25 : fx0 + 1.5, px1 = fx0 < 0 ? fx1 - 1.5 : fx1 - 0.25;                       // columns where the pipe actually stands
    for (let i = 0; i < 11; i++) b.slab("dsteel", px0, FB + 0.08, 2.75 + i * 0.26, px1, FB + 0.34, 2.8 + i * 0.26);   // fingers (pipe slots between them)
    b.blocker(px0, FB - 0.15, 2.65, px1, FB + 1.8, 5.65);                                                    // racked pipe is solid; the rest of the board is walkable
    b.blocker(fx0, FB - 0.15, 1.8, fx1, FB + 0.08, 5.8);
  }
  b.rail("yellow", -3.0, 3.1, -3.0, 5.8, FB, 1.1); b.rail("yellow", 3.0, 1.8, 3.0, 5.8, FB, 1.1);            // outer rails (west rail opens for the ladder)
  b.rail("yellow", -3.0, 1.8, -3.0, 1.95, FB, 1.1);
  b.rail("yellow", -3.0, 5.8, -0.5, 5.8, FB, 1.1); b.rail("yellow", 0.5, 5.8, 3.0, 5.8, FB, 1.1);             // latches / back rail
  b.rail("yellow", -0.5, 6.0, 0.5, 6.0, FB, 1.1);                                                               // chain across the walkway end (the Geronimo post is right beside it)
  // (the little platform at the top drive end of the board is gone: the board starts at the walkway)
  // ladder through the stabbing board hatch: floor -> board at (0, 1.45), struts back to the mast
  b.beam("steel", v(-3.07, F, 2.12), v(-3.07, FB + 1.2, 2.12), 0.07); b.beam("steel", v(-3.07, F, 2.68), v(-3.07, FB + 1.2, 2.68), 0.07);
  for (let y = F + 0.3; y < FB + 0.95; y += 0.33) b.box("steel", -3.07, y, 2.4, 0.035, 0.035, 0.56);
  for (let y = F + 4; y < FB; y += 4.2) {
    const u = (y - F) / (46 - F);
    b.beam("steel", v(-3.07, y, 2.4), Vector3.Lerp(v(-2.0, F, 1.2), v(-1.2, 46, 0.4), u), 0.06);
  }
  b.label("LADDER TO BOARD", -3.55, F + 1.7, 2.4, 1.4, 0.3, -Math.PI / 2, "#233a52", "#ffd24a", 34);
  // Geronimo line: the derrickman's escape cable from the end of the walkway straight out to a ground anchor with a landing pad
  const GA = v(0, FB + 2.6, 5.7), GB = v(0, 0.55, 38.6);
  b.beam("steel", v(0.5, FB, 5.9), v(0.5, FB + 2.6, 5.9), 0.1); b.beam("steel", v(-0.5, FB, 5.9), v(-0.5, FB + 2.6, 5.9), 0.1); b.slab("steel", -0.6, FB + 2.5, 5.8, 0.6, FB + 2.6, 6.0);
  b.beam("black", GA, GB, 0.035, 5);                                                                          // the line
  b.box("yellow", 0, FB + 2.38, 5.7, 0.4, 0.16, 0.26);                                                        // trolley
  b.box("red", 0, FB + 1.9, 5.7, 0.04, 0.9, 0.04); b.box("black", 0, FB + 1.4, 5.7, 0.5, 0.1, 0.3);            // lanyard and harness seat
  b.cyl("dsteel", 0, 0.3, 38.6, 0.5, 0.6, { tess: 8 }); b.cyl("steel", 0, 1.2, 38.6, 0.14, 1.8, { tess: 6 });   // ground anchor
  b.slab("blue", -1.6, 0.0, 35.9, 1.6, 0.35, 38.0); b.slab("yellow", -1.7, 0.0, 35.8, 1.7, 0.06, 38.1);          // landing pad
  b.label("GERONIMO LINE\nESCAPE ONLY", 0, 2.7, 39.3, 2.4, 0.9, Math.PI, "#7a1a14", "#ffffff", 44);
  b.blocker(-0.3, 0, 38.35, 0.3, 2.0, 38.85);
  spots.board = v(0, FB + 1.0, 3.6);
  spots.geronimo = v(0, FB + 1.0, 5.2);
  spots.floorSetback = v(0, F + 1.0, 3.6);

  // stands (thin instances so we can show a count)
  const standBase = MeshBuilder.CreateCylinder("stand", { diameter: 0.2, height: 1, tessellation: 6 }, scene);
  standBase.material = b.getMat("pipe"); standBase.parent = rigRoot;
  standBase.isVisible = true;
  const standSlots: Vector3[] = [];
  for (let zi = 0; zi < 6; zi++) for (const x of [-2.6, -2.1, -1.6, -1.1, 1.1, 1.6, 2.1, 2.6]) standSlots.push(v(x, F + 0.1, 2.85 + zi * 0.5));
  const standMats = standSlots.map(() => Matrix.Identity());
  // one small solid box per stand slot (world axes: the rig is turned, so local x -> world z and local z -> world -x); it is only tall while a stand is in that slot
  const standBoxes: AABB[] = standSlots.map((p) => ({ x0: -(p.z + 0.14), x1: -(p.z - 0.14), z0: p.x - 0.14, z1: p.x + 0.14, y0: F, y1: F }));
  b.colliders.push(...standBoxes);
  standSlots.forEach((p, i) => { standBase.thinInstanceAdd(Matrix.Identity()); void p; void i; });
  let shownStands = -1;
  const setStands = (n: number) => {
    n = Math.max(0, Math.min(standSlots.length, Math.round(n)));
    if (n === shownStands) return;
    shownStands = n;
    standBoxes.forEach((bx, i) => { bx.y1 = i < n ? F + 2.2 : F; });
    standSlots.forEach((p, i) => {
      const hgt = STAND_M - 0.8;
      const mat = Matrix.Compose(new Vector3(1, i < n ? hgt : 0.0001, 1), Quaternion.Identity(), new Vector3(p.x, p.y + (i < n ? hgt / 2 : 0), p.z));
      standMats[i] = mat;
      standBase.thinInstanceSetMatrixAt(i, mat, i === standSlots.length - 1);
    });
  };
  setStands(40);

  // ================= MAST (cantilever, tapered lattice) =================
  const MH = 46; // crown height above ground
  const base = [v(-2.0, F, -2.6), v(2.0, F, -2.6), v(2.0, F, 1.2), v(-2.0, F, 1.2)];
  const top = [v(-1.2, MH, -1.6), v(1.2, MH, -1.6), v(1.2, MH, 0.4), v(-1.2, MH, 0.4)];
  const P = (i: number, u: number) => Vector3.Lerp(base[i], top[i], u);
  for (let i = 0; i < 4; i++) b.beam("orange", P(i, 0), P(i, 1), 0.34, 6);
  // Sparse lattice: open legs low down so the floor is easy to move around, then single diagonals higher up.
  const panels = 7;
  for (let k = 0; k < panels; k++) {
    const u0 = k / panels, u1 = (k + 1) / panels;
    if (k === 0) { // one tie ring just above the floor, no diagonals
      for (let i = 0; i < 4; i++) b.beam("white", P(i, 0.12), P((i + 1) % 4, 0.12), 0.1, 6);
      continue;
    }
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      b.beam("white", P(i, u0), P(j, u0), 0.1, 6);
      if ((i + k) % 2 === 0) b.beam("white", P(i, u0), P(j, u1), 0.09, 6);
      else b.beam("white", P(j, u0), P(i, u1), 0.09, 6);
    }
  }
  // mast legs as collision (you can't walk through the mast)
  for (let i = 0; i < 4; i++) b.blocker(base[i].x - 0.18, F, base[i].z - 0.18, base[i].x + 0.18, F + 4, base[i].z + 0.18);
  // crown block + beacon
  const CROWN_X = [-0.6, -0.2, 0.2, 0.6];
  b.slab("dsteel", -1.5, MH, -2.0, 1.5, MH + 1.1, 0.8);
  // crown sheaves: four discs on a shaft between two end plates, set on top of the crown frame, plus the fast-line sheave
  for (const px of [-0.82, 0.82]) b.slab("dsteel", px - 0.05, MH + 1.1, -1.25, px + 0.05, MH + 2.5, 0.65);
  for (const sx of CROWN_X) b.cyl("dsteel", sx, MH + 1.6, -0.3, 0.8, 0.18, { axis: "x", tess: 20 });
  b.cyl("steel", 0, MH + 1.6, -0.3, 0.1, 1.7, { axis: "x", tess: 8 });
  b.cyl("dsteel", -1.15, MH + 1.6, -0.3, 0.8, 0.14, { axis: "x", tess: 20 });
  b.slab("steel", -1.3, MH + 1.1, -1.25, -1.0, MH + 1.2, 0.65);
  b.sphere("beacon", 0, MH + 3.0, -0.3, 0.45);
  for (const [x, z] of [[-1.3, -1.8], [1.3, -1.8], [-1.3, 0.6], [1.3, 0.6]]) b.sphere("beacon", x, MH + 0.5, z, 0.25);
  // derrickman's cabin / stabbing board area & floodlights up the mast
  for (const y of [12, 22, 32, 40]) {
    b.box("lamp", -2.3, y, 1.6, 0.5, 0.2, 0.2); b.box("lamp", 2.3, y, 1.6, 0.5, 0.2, 0.2);
  }
  // standpipe up the right back leg + mud line from pumps
  b.beam("steel", v(2.7, 0.0, -3.2), v(2.7, F + 31, -3.2), 0.22);
  {   // pump discharge header, then the mud line across to the foot of the standpipe (which feeds the kelly hose and the top drive)
    b.beam("steel", v(9.0, 1.1, -14.0), v(9.0, 1.1, -10.0), 0.2);
    b.beam("steel", v(9.0, 1.1, -12.0), v(2.7, 1.1, -12.0), 0.2); b.beam("steel", v(2.7, 1.1, -12.0), v(2.7, 1.1, -3.2), 0.2);
    for (const [x, z] of [[9.0, -12.0], [2.7, -12.0], [2.7, -8.0]]) b.cyl("dsteel", x, 1.1, z, 0.46, 0.14, { tess: 12 });
    for (const z of [-11.2, -6.0]) b.slab("dsteel", 2.62, 0, z - 0.08, 2.78, 1.0, z + 0.08);
    b.label("MUD LINE TO STANDPIPE", 5.9, 1.6, -12.0, 3.2, 0.3, Math.PI, "#7a1a14", "#ffffff", 36);
  }
  // drawworks housing under the doghouse side + cable reels (visual)
  b.cyl("dsteel", -0.2, F + 0.9, -4.8, 1.8, 1.4, { axis: "x", tess: 14 });
  b.cyl("steel", -0.2, F + 0.9, -4.8, 1.2, 1.5, { axis: "x", tess: 10 });
  b.slab("dsteel", -1.3, F, -5.6, 0.9, F + 0.35, -3.9);
  spots.drawworks = v(-0.2, F + 1.4, -3.6);
  b.blocker(-1.1, F, -5.95, 0.7, F + 2.1, -3.65);                                          // the drawworks drum and housing are solid
  // drum flanges + spooled line, the fast line up to the crown, and the dead line to its anchor
  for (const x of [-1.0, 0.6]) b.cyl("steel", x, F + 0.9, -4.8, 2.3, 0.1, { axis: "x", tess: 18 });
  b.cyl("pipe", -0.2, F + 0.9, -4.8, 1.55, 1.5, { axis: "x", tess: 16 });
  b.beam("dsteel", v(-1.1, F + 1.75, -4.8), v(-1.15, MH + 1.6, -0.7), 0.05);               // fast line
  b.cyl("dsteel", 1.0, F + 0.3, -2.4, 0.5, 0.6, { tess: 10 }); b.slab("red", 0.8, F + 0.5, -2.6, 1.2, F + 0.62, -2.2);   // deadline anchor / weight indicator
  b.beam("dsteel", v(1.0, F + 0.6, -2.4), v(0.82, MH + 1.6, -0.7), 0.05);                  // dead line

  // ---- dynamic: top drive, block, cables, string, hose ----
  const td = node("topdrive", scene, 0, F + 20, 0); td.parent = rigRoot;   // centred on the well: the quill sits right over the string
  const tdSpin = node("tdspin", scene, 0, -0.75, 0); tdSpin.parent = td;       // everything below the gearbox that turns with the string
  {
    const put = (m: Mesh, mat: string, x: number, y: number, z: number, parent: TransformNode = td) => { m.material = b.getMat(mat); m.parent = parent; m.position.set(x, y, z); return m; };
    const bx = (w: number, h: number, d: number, mat: string, x: number, y: number, z: number, parent?: TransformNode) => put(MeshBuilder.CreateBox("tb", { width: w, height: h, depth: d }, scene), mat, x, y, z, parent);
    const cy = (dia: number, h: number, mat: string, x: number, y: number, z: number, tess = 12, parent?: TransformNode) => put(MeshBuilder.CreateCylinder("tc", { diameter: dia, height: h, tessellation: tess }, scene), mat, x, y, z, parent);
    // guide dolly: two side plates that ride the mast rails, with roller blocks
    for (const sx of [-1, 1]) { bx(0.12, 2.6, 0.7, "dsteel", sx * 0.62, 0.35, 0); for (const y of [-0.7, 1.4]) bx(0.2, 0.3, 0.8, "steel", sx * 0.7, y, 0); }
    bx(1.3, 0.3, 0.8, "dsteel", 0, 1.55, 0);                                 // dolly top crossbar
    bx(1.3, 0.3, 0.8, "dsteel", 0, -0.7, 0);                                 // dolly bottom crossbar
    // main gearbox and drive motor
    bx(0.95, 1.2, 0.85, "orange", 0, 0.3, 0);
    cy(0.75, 1.3, "dsteel", 0, 0.95, -0.55, 14).rotation.z = Math.PI / 2;     // AC motor, lying across the back
    for (let i = 0; i < 6; i++) cy(0.82, 0.05, "steel", -0.5 + i * 0.2, 0.95, -0.55, 14).rotation.z = Math.PI / 2;  // cooling fins
    cy(0.2, 0.4, "red", 0.75, 0.95, -0.55, 8).rotation.z = Math.PI / 2;       // blower
    // gooseneck and washpipe
    cy(0.3, 0.7, "steel", 0, 1.35, 0.1, 10);
    cy(0.22, 0.5, "steel", 0, 1.55, -0.18, 8).rotation.x = 0.9;
    // bails (links) up to the travelling block
    for (const sx of [-1, 1]) bx(0.09, 1.9, 0.12, "steel", sx * 0.55, 2.2, 0.15);
    // travelling block: sheave housing, sheaves, hook
    for (const sx of [-1, 1]) bx(0.1, 0.9, 0.95, "yellow", sx * 0.76, 3.4, 0);                // side plates
    bx(1.5, 0.08, 0.5, "yellow", 0, 3.84, 0); bx(1.5, 0.08, 0.5, "yellow", 0, 2.98, 0);       // top and bottom bars
    for (const sx of [-0.6, -0.2, 0.2, 0.6]) cy(0.8, 0.18, "dsteel", sx, 3.4, 0, 18).rotation.z = Math.PI / 2;   // sheaves
    cy(0.1, 1.5, "steel", 0, 3.4, 0, 8).rotation.z = Math.PI / 2;
    bx(0.4, 0.3, 0.4, "dsteel", 0, 2.9, 0);
    // pipe handler: link tilt arms, elevators
    for (const sx of [-1, 1]) {
      bx(0.07, 1.3, 0.09, "steel", sx * 0.62, -1.4, 0.35).rotation.x = 0.12;
      bx(0.2, 0.25, 0.55, "dsteel", sx * 0.35, -2.05, 0.7);
    }
    bx(0.9, 0.12, 0.35, "yellow", 0, -2.2, 0.75);
    // rotating stem under the gearbox: IBOP valve, saver sub, quill
    cy(0.38, 0.5, "red", 0, -0.2, 0, 12, tdSpin);                            // upper IBOP actuator
    cy(0.32, 0.4, "steel", 0, -0.62, 0, 10, tdSpin);                         // lower IBOP
    cy(0.28, 0.3, "dsteel", 0, -0.98, 0, 10, tdSpin);                        // saver sub
    cy(0.24, 0.15, "pipeband", 0, -1.2, 0, 10, tdSpin);                      // tool joint
  }
  const mkCable = (x: number, z: number) => {
    const c = MeshBuilder.CreateCylinder("cab", { diameter: 0.05, height: 1, tessellation: 5 }, scene);
    c.material = b.getMat("steel"); c.position.set(x, 0, z); c.parent = rigRoot; return c;
  };
  // eight reeved lines: each of the four sheave pairs carries a line on its near and far side
  const cables = CROWN_X.flatMap((x) => [mkCable(x, -0.7), mkCable(x, 0.1)]);
  const stringMesh = MeshBuilder.CreateCylinder("string", { diameter: 0.19, height: 1, tessellation: 8 }, scene);
  stringMesh.material = b.getMat("pipe"); stringMesh.position.set(0, 0, 0); stringMesh.parent = rigRoot;
  // the rotary (kelly) hose: a soft, flexible tube that sags in a loop between the standpipe and the gooseneck, so it follows the top drive up and down
  const hosePath = (a: Vector3, c2: Vector3) => {
    const len = Vector3.Distance(a, c2), sag = Math.min(4.2, 1.2 + len * 0.22), out = 0.5 + len * 0.03, pts: Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, bell = 4 * t * (1 - t), p = Vector3.Lerp(a, c2, t);
      p.y -= sag * bell; p.z += out * Math.sin(Math.PI * t) * 0.9; p.x += out * 0.55 * Math.sin(Math.PI * t);
      pts.push(p);
    }
    return pts;
  };
  let hose = MeshBuilder.CreateTube("hose", { path: hosePath(v(2.7, F + 29, -3.2), v(0, F + 26, -0.3)), radius: 0.1, tessellation: 8, updatable: true }, scene);
  hose.material = b.getMat("black"); hose.parent = rigRoot;
  // drill pipe tool-joint ring that shows on the string
  const joint = MeshBuilder.CreateCylinder("tj", { diameter: 0.27, height: 0.4, tessellation: 8 }, scene);
  joint.material = b.getMat("pipeband"); joint.parent = rigRoot;

  // ================= PIPE RACKS + HYDRAULIC CATWALK =================
  // Two empty racks flank the catwalk and feed it; the full pipe stacks live out at the edge of location, on the same line.
  const pipePos: Vector3[] = [];
  const rackStack = (sx: number, zc: number, full: boolean) => {
    const rx = sx * 6.5, dz = zc - 26;
    for (const z of [19, 26, 33]) b.slab("rust", rx - 3.3, 0, z + dz - 0.2, rx + 3.3, 0.5, z + dz + 0.2);
    // end stanchions that keep the stack from rolling off
    for (const ex of [-3.3, 3.3]) for (const z of [19, 26, 33]) b.slab("rust", rx + ex - 0.06, 0, z + dz - 0.1, rx + ex + 0.06, 2.0, z + dz + 0.1);
    if (!full) {
      // empty racks: low rails along the lip toward the catwalk, so a joint rolls in from the rack when the kick arms push it
      b.blocker(rx - 3.35, 0, 18.3, rx + 3.35, 0.6, 33.7);
      if (sx > 0) {
        // a few joints of drill pipe waiting on this rack, stacked toward the outer side so the kick arm has a clear lane to the trough
        const D = 0.27, PITCH = 0.285;
        for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 5 - layer; i++) {
          const px = rx - 2.1 + i * PITCH + layer * (PITCH / 2) + 1.2, py = 0.56 + D / 2 + layer * PITCH * 0.866;
          b.cyl("pipe", px, py, 26, D, 12.4, { axis: "z", tess: 6 }); b.cyl("pipeband", px, py, 20.1, D + 0.02, 0.4, { axis: "z", tess: 6 }); b.cyl("pipeband", px, py, 31.9, D + 0.02, 0.4, { axis: "z", tess: 6 });
        }
      }
      return;
    }
    // drill pipe, hex-packed (pitch ~ diameter) and parallel to the catwalk
    const D = 0.27, PITCH = 0.285;
    for (let layer = 0; layer < 6; layer++) {
      const n = 22 - layer;
      for (let i = 0; i < n; i++) {
        const x = rx - ((22 - 1) * PITCH) / 2 + i * PITCH + layer * (PITCH / 2), y = 0.5 + D / 2 + layer * PITCH * 0.866;
        if (kit) pipePos.push(rpos(v(x, y, zc)));
        else {
          b.cyl("pipe", x, y, zc, D, 15.2, { axis: "z", tess: 6 });
          b.cyl("pipeband", x, y, zc - 7.3, D + 0.02, 0.4, { axis: "z", tess: 6 });
          b.cyl("pipeband", x, y, zc + 7.3, D + 0.02, 0.4, { axis: "z", tess: 6 });
        }
      }
    }
    // solid so nobody walks through the stack
    b.blocker(rx - 3.35, 0, 18.3 + dz, rx + 3.35, 2.0, 33.7 + dz);
  };
  // the full stacks out at the pad edge lie with their pipe running across the line of the catwalk (parallel to the fence), two stacks side by side
  const fullStack = (xc: number, zc: number, full = true) => {
    const D = 0.27, PITCH = 0.285;
    for (const sxp of [-7.0, 0, 7.0]) b.slab("rust", xc + sxp - 0.2, 0, zc - 3.3, xc + sxp + 0.2, 0.5, zc + 3.3);
    for (const ez of [-3.3, 3.3]) for (const sxp of [-7.0, 0, 7.0]) b.slab("rust", xc + sxp - 0.1, 0, zc + ez - 0.06, xc + sxp + 0.1, 2.0, zc + ez + 0.06);
    if (!full) { b.blocker(xc - 7.65, 0, zc - 3.35, xc + 7.65, 0.6, zc + 3.35); return; }
    for (let layer = 0; layer < 6; layer++) {
      const n = 22 - layer;
      for (let i = 0; i < n; i++) {
        const z = zc - ((22 - 1) * PITCH) / 2 + i * PITCH + layer * (PITCH / 2), y = 0.5 + D / 2 + layer * PITCH * 0.866;
        if (kit) pipePos.push(rpos(v(xc, y, z)));
        else {
          b.cyl("pipe", xc, y, z, D, 15.2, { axis: "x", tess: 6 });
          b.cyl("pipeband", xc - 7.3, y, z, D + 0.02, 0.4, { axis: "x", tess: 6 });
          b.cyl("pipeband", xc + 7.3, y, z, D + 0.02, 0.4, { axis: "x", tess: 6 });
        }
      }
    }
    b.blocker(xc - 7.65, 0, zc - 3.35, xc + 7.65, 2.0, zc + 3.35);
  };
  for (const sx of [-1, 1]) rackStack(sx, 26, false);
  // out near the pad edge, end to end in one line: two full stacks, then (to the right, looking out from the rig) two empty racks
  fullStack(-8.2, 56); fullStack(8.2, 56);
  fullStack(23.8, 56, false); fullStack(39.4, 56, false);
  kit?.instances(["pipe_pipe", "band_band"], pipePos, false, RYAW + Math.PI / 2);   // (the stacks lie across the line of the catwalk)
  // the catwalk skid: a long steel base with a rear trough fixed to it, a hydraulic power unit, and the ground control station
  b.slab("dsteel", -1.1, 0, 18, 1.1, 0.45, 34, true);
  b.slab("steel", -0.6, 0.45, 24, 0.6, 0.55, 34);                                        // trough floor (rear half; the front half lifts)
  for (const sx of [-1, 1]) b.slab("dsteel", sx * 0.62 - 0.06, 0.45, 24, sx * 0.62 + 0.06, 1.0, 34);        // trough walls
  b.slab("dsteel", -0.7, 0.45, 33.9, 0.7, 1.1, 34.1);                                    // end stop
  b.blocker(-1.1, 0, 18, 1.1, 1.05, 34);
  b.slab("blue", 1.4, 0, 31.6, 2.6, 1.0, 33.8, true); b.slab("black", 1.5, 1.0, 31.8, 2.5, 1.2, 33.6);   // hydraulic power unit: tank on top
  b.cyl("steel", 2.0, 1.45, 32.7, 0.22, 0.5, { tess: 8 }); b.cyl("red", 1.7, 0.5, 31.4, 0.3, 0.3, { axis: "z", tess: 8 });
  b.slab("dsteel", -0.1, 0, 35.2, 0.1, 1.25, 35.4); b.slab("black", -0.6, 1.25, 35.0, 0.6, 1.75, 35.6);   // ground control station at the tail end: post and panel facing the catwalk
  b.slab("green", -0.45, 1.45, 34.94, -0.25, 1.6, 35.0); b.slab("yellow", -0.1, 1.45, 34.94, 0.1, 1.6, 35.0); b.slab("red", 0.25, 1.45, 34.94, 0.45, 1.6, 35.0);
  b.label("HYDRAULIC CATWALK\nCLEAR THE TROUGH BEFORE YOU PUSH", 0, 2.3, 35.7, 2.4, 0.8, 0, "#233a52", "#ffd24a", 28);
  spots.tally = v(0, 1.8, 50.8);
  spots.catwalk = v(0, 1.5, 36.3);
  spots.catremote = v(2.1, F + 1.25, 3.9);
  b.label("PIPE RACKS", 0, 3.2, 51.5, 3.2, 0.8, 0, "#233a52", "#ffd24a", 80);
  b.rot = 0;
  for (const k of ["cabin", "doghouse", "coffee", "board", "geronimo", "floorSetback", "drawworks", "tally", "catwalk", "catremote"]) spots[k] = rpos(spots[k]);

  // ---- the catwalk's moving parts ----
  const cwBlack = b.getMat("black"), cwSteel = b.getMat("steel"), cwDark = b.getMat("dsteel"), cwPipe = b.getMat("pipe"), cwRed = b.getMat("red"), cwYellow = b.getMat("yellow");
  void cwBlack;
  const cw = new TransformNode("catwalk", scene); cw.parent = rigRoot;
  const cwBox = (m: StandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number, par: TransformNode) => { const k = MeshBuilder.CreateBox("cwp", { width: w, height: h, depth: d }, scene); k.material = m; k.parent = par; k.position.set(x, y, z); k.isPickable = false; return k; };
  // front half of the trough: hinged at z = 24, its free end lowers to meet the ramp
  const front = new TransformNode("cwfront", scene); front.parent = cw; front.position.set(0, 0.5, 24);
  cwBox(cwSteel, 1.2, 0.1, 6, 0, 0.0, -3, front);
  for (const sx of [-1, 1]) cwBox(cwDark, 0.12, 0.55, 6, sx * 0.62, 0.22, -3, front);
  // hydraulic lift rams under it
  const rams = [-0.5, 0.5].map(() => { const r = MeshBuilder.CreateCylinder("cwram", { diameter: 0.14, height: 1, tessellation: 8 }, scene); r.material = cwPipe; r.parent = cw; r.isPickable = false; return r; });
  const ramBase = [-0.5, 0.5].map(() => { const r = MeshBuilder.CreateCylinder("cwramb", { diameter: 0.2, height: 0.8, tessellation: 8 }, scene); r.material = cwDark; r.parent = cw; r.isPickable = false; return r; });
  // kick arms: eight plates that swing up out of the trough walls and roll a joint in from the racks
  const arms: { n: TransformNode; sx: number }[] = [];
  for (const sx of [-1, 1]) for (const z of [20.4, 23.4, 26.6, 30.2]) {
    const n = new TransformNode("cwarm", scene); n.parent = cw; n.position.set(sx * 0.7, 0.62, z);
    cwBox(cwYellow, 0.95, 0.07, 0.34, sx * 0.5, 0, 0, n); arms.push({ n, sx });
  }
  // the pusher: a block and rod that drive the joint up the trough
  const pusher = cwBox(cwRed, 0.9, 0.3, 0.34, 0, 0.72, 33.5, cw);
  const pushRod = MeshBuilder.CreateCylinder("cwrod", { diameter: 0.12, height: 1, tessellation: 8 }, scene); pushRod.material = cwPipe; pushRod.parent = cw; pushRod.rotation.x = Math.PI / 2; pushRod.isPickable = false;
  // the joint of drill pipe itself
  const jt = MeshBuilder.CreateCylinder("cwjoint", { diameter: 0.24, height: 9.6, tessellation: 10 }, scene); jt.material = cwPipe; jt.parent = cw; jt.rotation.x = Math.PI / 2; jt.isPickable = false;
  for (const dy of [-4.4, 4.4]) { const r = MeshBuilder.CreateCylinder("cwjb", { diameter: 0.27, height: 0.4, tessellation: 10 }, scene); r.material = b.getMat("pipeband"); r.parent = jt; r.position.y = dy; r.isPickable = false; }
  jt.setEnabled(false);
  const catwalk = { phase: "idle" as "idle" | "kicking" | "loaded" | "pushing", lowered: true, tilt: 1, kick: 0, side: 1, roll: 0, jz: 29.5, push: 0, delivered: 0, event: "" };
  const RAMP_ANG = Math.atan2(F, 12);
  const catUpdate = (dt: number) => {
    // trough tilt: 0 level, 1 lowered onto the ramp (the far end drops about half a metre)
    const tgt = catwalk.lowered ? 1 : 0; catwalk.tilt += Math.sign(tgt - catwalk.tilt) * Math.min(Math.abs(tgt - catwalk.tilt), dt * 0.45);
    front.rotation.x = -catwalk.tilt * 0.082;
    const dropY = Math.sin(catwalk.tilt * 0.082) * 3;
    rams.forEach((r, i) => { const x = i ? 0.5 : -0.5, y0 = 0.1, y1 = 0.5 - dropY - 0.05; r.position.set(x, (y0 + y1) / 2, 21.0); r.scaling.y = Math.max(0.1, y1 - y0); });
    ramBase.forEach((r, i) => { r.position.set(i ? 0.5 : -0.5, 0.35, 21.0); });
    // kicking: the arm on the rack side lifts while the joint rolls across onto the trough
    if (catwalk.phase === "kicking") {
      catwalk.kick = Math.min(1, catwalk.kick + dt * 2.2); catwalk.roll = Math.min(1, catwalk.roll + dt * 0.7);
      const k = catwalk.roll;
      jt.setEnabled(true); jt.position.set(catwalk.side * (3.6 * (1 - k)), 0.75 - 0.08 * k + (1 - k) * 0.1, catwalk.jz); jt.rotation.set(Math.PI / 2, 0, 0);
      if (catwalk.roll >= 1) { catwalk.phase = "loaded"; catwalk.event = "loaded"; }
    } else catwalk.kick = Math.max(0, catwalk.kick - dt * 2.2);
    for (const a of arms) a.n.rotation.z = a.sx * catwalk.kick * 0.85 * (a.sx === catwalk.side ? 1 : 0);
    if (catwalk.phase === "pushing") {
      // the joint is a rigid 9.6 m pipe: its tail is pushed along the trough and its front end rides the surface (trough, then the slick ramp), so it never cuts through
      catwalk.push += dt * (catwalk.push > 17 ? 2.0 : 2.8);
      const L = 9.6, S = (z: number) => z >= 24 ? 0.67 : z >= 18 ? 0.18 + ((z - 18) / 6) * 0.49 : 0.18 + (18 - z) * (F / 12);
      const zt = catwalk.jz + 4.8 - catwalk.push, yt = S(zt);
      let lo = zt - L, hi = zt - 0.01;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (Math.hypot(zt - mid, yt - S(mid)) > L) lo = mid; else hi = mid; }
      const zf = (lo + hi) / 2, yf = S(zf);
      jt.position.set(0, (yt + yf) / 2, (zt + zf) / 2); jt.rotation.set(Math.PI / 2 + Math.atan2(yf - yt, zt - zf), 0, 0);
      const pz = zt + 0.3, py = S(Math.max(pz, 18.5)) + 0.03; pusher.position.set(0, py, Math.max(pz, 18.5)); pusher.setEnabled(pz >= 18.5);
      if (zt <= 6.6) { jt.setEnabled(false); catwalk.phase = "idle"; catwalk.delivered++; catwalk.event = "delivered"; catwalk.push = 0; pusher.setEnabled(true); pusher.position.y = 0.72; }
    } else { pusher.setEnabled(true); pusher.position.z += (33.5 - pusher.position.z) * Math.min(1, dt * 3); }
    { const pz = pusher.position.z + 0.17, py = pusher.position.y, dz = 34.1 - pz, dy = 0.72 - py, len = Math.max(0.1, Math.hypot(dz, dy));
      pushRod.scaling.y = len; pushRod.position.set(0, (0.72 + py) / 2, (34.1 + pz) / 2); pushRod.rotation.x = Math.PI / 2 + Math.atan2(py - 0.72, dz); }
  };
  const catCtl = {
    get phase() { return catwalk.phase; }, get lowered() { return catwalk.lowered; }, get delivered() { return catwalk.delivered; },
    takeEvent() { const e = catwalk.event; catwalk.event = ""; return e; },
    kick(): string | null { if (catwalk.phase !== "idle") return "There's already a joint on the trough."; catwalk.phase = "kicking"; catwalk.side = 1; catwalk.roll = 0; catwalk.kick = 0; catwalk.jz = 29.5; return null; },
    toggleLift(): void { catwalk.lowered = !catwalk.lowered; },
    push(): string | null { if (catwalk.phase === "idle") return "Nothing on the trough. Kick a joint over first."; if (catwalk.phase === "kicking") return "Wait for the joint to settle in the trough."; if (catwalk.phase === "pushing") return "It's already moving."; catwalk.phase = "pushing"; catwalk.push = 0; return null; },
  };

  // ================= PUMP ROOM (3 triplex mud pumps) =================
  const PDX = 21.5;   // pumps sit beside the mud hopper
  b.at(PDX, 0, () => {
  for (let i = 0; i < 3; i++) {
    const x = -10.5 + i * 3.6;
    if (kit) { kit.place("pump", x + PDX, 0, -12.0); b.blocker(x - 1.4, 0, -14.5, x + 1.4, 2.4, -9.5); }
    else {
      b.slab("dsteel", x - 1.4, 0, -14.5, x + 1.4, 0.35, -9.5, true);
      b.slab("red", x - 1.2, 0.35, -14.0, x + 1.2, 1.5, -11.6, true);
      b.slab("steel", x - 1.1, 0.35, -11.6, x + 1.1, 1.2, -10.0, true);
      b.cyl("black", x, 1.9, -12.6, 0.7, 2.0, { axis: "x", tess: 10 });
    }
  }
  b.slab("tan", -12.2, 3.6, -14.8, 0.2, 3.8, -9.2);               // roof (clears the pulsation dampeners)
  for (const [x, z] of [[-12.0, -14.6], [0.0, -14.6], [-12.0, -9.4], [0.0, -9.4]]) b.slab("dsteel", x - 0.1, 0, z - 0.1, x + 0.1, 3.6, z + 0.1);
  b.cyl("steel", -13.5, 1.2, -11.5, 1.1, 2.4, { tess: 10, solid: true });
  b.label("MUD PUMPS", -5.2, 3.7, -9.15, 3.0, 0.7, Math.PI, "#233a52", "#ffd24a", 70);
  });
  spots.pumps = v(-6.8 + PDX, 1.6, -9.2);

  // ================= MUD TANKS + SHAKERS + HOPPER =================
  // Pits: open-top steel tanks with grated walkways. The mud inside is a moving surface (scrolling texture) with agitator paddles turning at the surface.
  const tanks = [[-18, -9], [-9, 0], [0, 9], [9, 18]];
  const mudTex = noiseTex(scene, "#4a3826", ["#5d4630", "#3a2a1c", "#6e553a", "#2e2218", "#7a6244"], 2200, 256, 3);
  const mudMat = new StandardMaterial("pitmud", scene); mudMat.diffuseTexture = mudTex; mudMat.specularColor = new Color3(0.35, 0.3, 0.25); mudMat.specularPower = 24;
  const agiNodes: TransformNode[] = [];
  tanks.forEach(([x0, x1], i) => {
    const cx = (x0 + x1) / 2, W = x1 - x0 - 0.1;
    // tank shell: walls and floor, hollow, with a solid collider so nobody walks through the sides
    b.slab("tank", x0 + 0.05, 0.4, -26, x1 - 0.05, 2.7, -25.9);
    b.slab("tank", x0 + 0.05, 0.4, -19.7, x1 - 0.05, 2.7, -19.6);
    b.slab("tank", x0 + 0.05, 0.4, -26, x0 + 0.15, 2.7, -19.6);
    b.slab("tank", x1 - 0.15, 0.4, -26, x1 - 0.05, 2.7, -19.6);
    b.slab("steel", x0 + 0.05, 0, -26, x1 - 0.05, 0.4, -19.6);
    b.blocker(x0 + 0.05, 0.4, -26, x1 - 0.05, 2.78, -19.6);                       // sides and walking surface
    // the mud
    const mud = MeshBuilder.CreateGround("pitmud", { width: W - 0.3, height: 6.1 }, scene); mud.position.set(cx, 2.3, -22.8); mud.material = mudMat;
    // agitator: shaft down to turning paddles at the surface
    b.cyl("steel", cx, 3.3, -22.8, 0.2, 2.0, { tess: 8 });
    b.box("bopblue", cx, 4.3, -22.8, 0.7, 0.5, 0.5);
    b.blocker(cx - 0.4, 2.78, -23.2, cx + 0.4, 4.6, -22.4);
    const ag = node("agi" + i, scene, cx, 2.3, -22.8);
    for (let k = 0; k < 2; k++) {
      const blade = MeshBuilder.CreateBox("agb", { width: 2.8, height: 0.06, depth: 0.3 }, scene); blade.material = b.getMat("steel"); blade.parent = ag; blade.rotation.y = k * Math.PI / 2; blade.position.y = 0.02;
    }
    const hub = MeshBuilder.CreateCylinder("agh", { diameter: 0.32, height: 0.2, tessellation: 10 }, scene); hub.material = b.getMat("dsteel"); hub.parent = ag;
    agiNodes.push(ag);
    // grated walkway: bars along the tank with cross ties and a frame, so you can see the mud turning below
    const nb = Math.floor(W / 0.2);
    for (let k = 0; k <= nb; k++) b.box("dsteel", x0 + 0.1 + (W * k) / nb, 2.74, -22.8, 0.035, 0.06, 6.3);
    for (let z = -25.8; z <= -19.7; z += 1.2) b.box("steel", cx, 2.715, z, W, 0.035, 0.05);
    for (const zz of [-25.95, -19.65]) b.slab("steel", x0 + 0.05, 2.7, zz - 0.05, x1 - 0.05, 2.78, zz + 0.05);
    for (const xx of [x0 + 0.1, x1 - 0.1]) b.slab("steel", xx - 0.05, 2.7, -26, xx + 0.05, 2.78, -19.6);
    if (x0 === 0) b.rail("yellow", x0 + 1.8, -19.7, x1 - 0.05, -19.7, 2.78, 1.1);                  // open where the rig bridge lands
    else b.rail("yellow", x0 + 0.05, -19.7, x1 - 0.05, -19.7, 2.78, 1.1);
    b.rail("yellow", x0 + 0.05, -25.9, x1 - 0.05, -25.9, 2.78, 1.1);
  });
  // tank-roof stairs at east end
  b.stairs("dsteel", "yellow", 18.0, -22.8, "+x", 2.78, 1.1, 0.25, 0.3);
  b.rail("yellow", -17.95, -25.9, -17.95, -19.7, 2.78, 1.1);   // west end of the pit roof
  b.rail("yellow", 17.95, -25.9, 17.95, -23.5, 2.78, 1.1); b.rail("yellow", 17.95, -22.1, 17.95, -19.7, 2.78, 1.1);   // east end by the hopper: closed in except for the stairs
  b.label("ACTIVE PITS", 0, 1.8, -19.5, 3.0, 0.7, Math.PI, "#233a52", "#ffd24a", 70);

  // ---- shale shakers (linear-motion, three on pit 1): possum belly at the feed end, a screen deck on rubber mounts that rises toward the discharge,
  //      a pair of vibrator motors across the basket, and a discharge lip over a chute into the cuttings pit ----
  b.defMat("cuttings", "#4d443b");
  const flowY = 3.75;
  b.beam("steel", v(0, 6.0, 0), v(0, 6.0, -2.6), 0.42); b.cyl("dsteel", 0, 6.0, -1.3, 0.62, 0.12, { axis: "z", tess: 12 });   // flowline outlet on the bell nipple, with its flange
  b.beam("steel", v(0, 6.0, -2.6), v(-10.4, flowY, -20.1), 0.42);                                  // flow line from the bell nipple, over the choke manifold, to the shaker header
  b.beam("steel", v(-17.3, flowY, -20.1), v(-10.4, flowY, -20.1), 0.42);                           // header across the three shakers
  b.cyl("dsteel", -10.4, flowY, -20.1, 0.55, 0.08, { axis: "z", tess: 12 });
  for (const [px, pz] of [[-3.0, -9.0], [-7.0, -14.5]]) b.slab("dsteel", px - 0.1, 0, pz - 0.1, px + 0.1, 5.75 - ((Math.abs(px) / 10.4) * 2.25), pz + 0.1);   // flow-line supports
  b.label("FLOW LINE", -5.3, 4.9, -11.1, 1.8, 0.35, Math.PI / 2, "#7a1a14", "#ffffff", 40);
  for (const cx of [-16.6, -14.1, -11.6]) {
    b.blocker(cx - 0.95, 2.78, -25.5, cx + 0.95, 4.1, -20.5);
    b.slab("dsteel", cx - 0.95, 2.78, -25.5, cx + 0.95, 2.9, -20.5);                                 // skid
    for (const sx of [-0.72, 0.72]) for (const sz of [-21.4, -24.6]) b.cyl("black", cx + sx, 3.05, sz, 0.18, 0.3, { tess: 8 });   // rubber mounts
    for (const s of [-1, 1]) b.slab("steel", cx + s * 0.88 - 0.05, 3.2, -25.3, cx + s * 0.88 + 0.05, 3.75, -21.0);   // basket sides
    b.ramp("black", cx, 1.7, -21.0, 3.3, -25.3, 3.56, 0.06);                                        // screen deck, higher at the discharge end
    for (let k = 0; k < 4; k++) { const zz = -21.4 - k * 1.0, yy = 3.3 + ((zz * -1 - 21.0) / 4.3) * 0.26 + 0.045; b.box("steel", cx, yy, zz, 1.5, 0.02, 0.05); }   // screen panel frames
    b.slab("steel", cx - 0.85, 3.1, -20.95, cx + 0.85, 3.8, -20.45);                                 // possum belly (feed box)
    b.slab("dsteel", cx - 0.9, 3.8, -21.0, cx + 0.9, 3.86, -20.4);
    b.cyl("steel", cx, 3.55, -20.25, 0.38, 0.5, { axis: "z", tess: 12 });                           // inlet from the header
    b.slab("dsteel", cx - 0.95, 3.75, -23.45, cx + 0.95, 3.85, -22.95);                              // vibrator beam
    for (const s of [-1, 1]) { b.cyl("orange", cx + s * 0.4, 4.05, -23.2, 0.3, 0.55, { axis: "x", tess: 12 }); b.cyl("steel", cx + s * 0.72, 4.05, -23.2, 0.36, 0.1, { axis: "x", tess: 12 }); }   // vibrator motors and weights
    b.ramp("steel", cx, 1.7, -25.3, 3.56, -27.6, 1.3, 0.05);                                        // discharge lip and chute to the cuttings pit
    for (const s of [-1, 1]) b.slab("steel", cx + s * 0.85 - 0.04, 1.3, -27.6, cx + s * 0.85 + 0.04, 3.2, -25.3);
  }
  // cuttings pit under the chutes, with mounds where each chute lands
  const CP = { x0: -18.0, x1: -10.4, z0: -30.8, z1: -27.0 };
  b.slab("steel", CP.x0, 0, CP.z0, CP.x1, 0.2, CP.z1);
  b.slab("tank", CP.x0, 0.2, CP.z0, CP.x1, 1.3, CP.z0 + 0.12, true); b.slab("tank", CP.x0, 0.2, CP.z1 - 0.12, CP.x1, 1.3, CP.z1, true);
  b.slab("tank", CP.x0, 0.2, CP.z0, CP.x0 + 0.12, 1.3, CP.z1, true); b.slab("tank", CP.x1 - 0.12, 0.2, CP.z0, CP.x1, 1.3, CP.z1, true);
  b.slab("cuttings", CP.x0 + 0.12, 0.2, CP.z0 + 0.12, CP.x1 - 0.12, 0.85, CP.z1 - 0.12);
  for (const cx of [-16.6, -14.1, -11.6]) b.cyl("cuttings", cx, 1.05, -27.9, 1.7, 0.7, { tess: 12, dia2: 0.3 });
  b.label("CUTTINGS PIT", -10.33, 0.78, -28.9, 2.6, 0.5, Math.PI / 2, "#233a52", "#ffd24a", 50);   // on the east side wall, clear of the chutes

  // ---- a decanting centrifuge on a stand as high as the pits, with a solids tank underneath its discharge and a level centrate line into the last active tank ----
  const centri = (cx: number, cz: number, n: number) => {
    const Y = 2.78, CY = 2.4;
    // stand: legs, bracing, a walkable deck level with the pit roofs, rails, and a stair down on the south side
    b.slab("deck", cx - 2.9, Y - 0.2, cz - 1.5, cx + 2.0, Y, cz + 2.6, true);
    for (const px of [cx - 2.7, cx + 1.8]) for (const pz of [cz - 1.3, cz + 2.4]) b.slab("dsteel", px - 0.12, 0, pz - 0.12, px + 0.12, Y - 0.2, pz + 0.12, true);
    for (const pz of [cz - 1.3, cz + 2.4]) { b.beam("dsteel", v(cx - 2.7, 0.3, pz), v(cx + 1.8, Y - 0.5, pz), 0.07); b.beam("dsteel", v(cx + 1.8, 0.3, pz), v(cx - 2.7, Y - 0.5, pz), 0.07); }
    b.rail("yellow", cx - 2.9, cz + 2.6, cx + 2.0, cz + 2.6, Y, 1.1);
    b.rail("yellow", cx - 2.9, cz - 1.5, cx - 2.2, cz - 1.5, Y, 1.1); b.rail("yellow", cx - 1.0, cz - 1.5, cx + 2.0, cz - 1.5, Y, 1.1);
    b.rail("yellow", cx - 2.9, cz - 1.5, cx - 2.9, cz + 2.6, Y, 1.1);
    b.stairs("dsteel", "yellow", cx - 1.6, cz - 1.5, "-z", Y, 1.2, 0.26, 0.3, 0, true);
    // the machine, riding on the deck
    b.slab("dsteel", cx - 2.7, Y, cz - 1.2, cx + 1.9, Y + 0.3, cz + 1.2, true);                          // skid
    b.cyl("steel", cx - 0.3, Y + 1.25, cz, 0.9, 2.8, { axis: "x", tess: 20 });                          // bowl
    b.cyl("steel", cx + 1.55, Y + 1.25, cz, 0.35, 0.8, { axis: "x", tess: 16, dia2: 0.9 });             // conical beach, narrow end toward the solids discharge
    for (const dx of [-1.4, 0.8]) b.cyl("dsteel", cx + dx, Y + 1.25, cz, 1.02, 0.1, { axis: "x", tess: 20 });    // bearing rings
    b.slab("steel", cx - 1.7, Y + 0.3, cz - 0.55, cx + 1.0, Y + 0.8, cz + 0.55);                         // pedestal / hood
    b.box("orange", cx - 2.05, Y + 1.0, cz, 0.8, 0.9, 0.95);                                              // gearbox
    b.cyl("blue", cx - 2.7, Y + 1.0, cz, 0.7, 0.9, { axis: "x", tess: 14 });                              // main drive motor
    b.cyl("red", cx - 2.0, Y + 0.6, cz + 1.0, 0.5, 0.5, { axis: "z", tess: 12 });                         // back-drive motor
    b.slab("steel", cx + 1.5, Y + 0.6, cz - 0.3, cx + 2.1, Y + 1.0, cz + 0.3);                            // solids discharge housing, hanging off the end of the deck
    b.slab("steel", cx - 0.5, Y + 0.3, cz + 0.6, cx + 0.5, Y + 0.9, cz + 1.1);                            // liquid (centrate) discharge box
    b.cyl("red", cx + 0.2, Y + 0.55, cz + 1.9, 0.55, 0.7, { tess: 12 }); b.cyl("blue", cx + 0.2, Y + 0.9, cz + 1.9, 0.62, 0.3, { tess: 12 });   // feed pump
    b.beam("steel", v(cx + 0.2, Y + 0.9, cz + 1.9), v(cx + 0.2, Y + 0.9, cz + 2.6), 0.18);               // feed line stub toward the tanks
    b.beam("steel", v(cx, Y + 0.35, cz + 0.85), v(cx, CY, cz + 0.85), 0.18); b.beam("steel", v(cx, CY, cz + 0.85), v(cx, CY, cz + 1.1), 0.18);   // centrate drops through the deck
    b.label("CENTRIFUGE " + n, cx - 0.2, Y + 2.3, cz - 1.25, 2.4, 0.5, Math.PI, "#233a52", "#ffd24a", 46);
    // solids chute straight down into the solids tank below
    for (const [x0, z0, x1, z1] of [[cx + 2.0, cz - 0.3, cx + 2.55, cz - 0.24], [cx + 2.0, cz + 0.24, cx + 2.55, cz + 0.3], [cx + 2.0, cz - 0.3, cx + 2.06, cz + 0.3], [cx + 2.49, cz - 0.3, cx + 2.55, cz + 0.3]] as number[][]) b.slab("steel", x0, 1.55, z0, x1, Y + 1.0, z1);
    // solids tank: closed steel box on the ground under the chute, with a hatch on top
    const px0 = cx + 1.95, px1 = cx + 4.55, pz0 = cz - 1.3, pz1 = cz + 1.3;
    b.slab("tank", px0, 0.1, pz0, px1, 1.5, pz1, true);
    b.slab("steel", px0 - 0.05, 0.0, pz0 - 0.05, px1 + 0.05, 0.1, pz1 + 0.05);
    b.slab("dsteel", px0 + 0.1, 1.5, pz0 + 0.1, px1 - 0.1, 1.55, pz1 - 0.1);
    b.slab("steel", cx + 3.1, 1.55, cz + 0.4, cx + 4.0, 1.75, cz + 1.0);                                  // hatch
    b.label("SOLIDS", (px0 + px1) / 2, 1.05, pz0 - 0.07, 1.6, 0.5, Math.PI, "#7a1a14", "#ffffff", 42);
    // the solids heap under the chute is visible through the chute throat
    b.cyl("cuttings", cx + 2.28, 1.62, cz, 0.45, 0.14, { tess: 10, dia2: 0.3 });
  };
  centri(13.0, -31.0, 1);                                           // one centrifuge, down the back of the pits toward the mud hopper
  // centrate lines run level at the height of the active tanks and go into their back walls
  const CY2 = 2.4;
  b.beam("steel", v(13.0, CY2, -29.9), v(13.0, CY2, -26.05), 0.18);                          // centrate goes straight into the back wall of the last pit
  for (const pz of [-28.6, -27.0]) b.slab("dsteel", 13.0 - 0.06, 0, pz - 0.06, 13.0 + 0.06, CY2 - 0.1, pz + 0.06);

  // shale-shaker spot stays on the first pit roof
  spots.shakers = v(-13.7, 4.0, -19.9);
  spots.pits = v(4.5, 3.7, -20.2);
  // degasser (poor boy) + vent to flare
  b.cyl("tankgreen", 24, 2.5, -12, 1.6, 5, { tess: 12, solid: true });
  spots.gasbuster = v(24, 1.5, -10);
  // mud hopper + pallets
  b.slab("dsteel", 22.5, 0, -24, 24.5, 1.1, -22, true);
  b.cyl("steel", 23.5, 1.6, -23, 1.8, 1.0, { tess: 10, dia2: 0.4 });
  b.slab("steel", 23.2, 1.1, -23.3, 23.8, 1.5, -22.7);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    b.box(i % 2 ? "sack" : "barite", 27 + i * 0.95, 0.15 + 0.3 * j + 0.15, -22.5, 0.9, 0.3, 0.6, i === 0 && j === 0);
    b.box("lcm", 27 + i * 0.95, 0.15 + 0.3 * j + 0.15, -21.2, 0.9, 0.3, 0.6);
  }
  b.slab("wood", 26.5, 0, -23.3, 31.5, 0.15, -20.5);
  spots.hopper = v(23.5, 2.0, -21.2);
  b.label("MUD HOPPER\nBARITE / LCM", 23.5, 3.1, -21.9, 2.6, 1.0, Math.PI, "#233a52", "#ffd24a", 46);

  // ================= MUD PRODUCT YARD + FRAC TANKS (behind the pits) =================
  // frac tanks side by side at the back edge of location, with the mud products pallet lot right next to them
  const FZ0 = -64.4, FZ1 = -56.0;
  for (const x of [0, 3.5, 7.0]) b.slab("tank", x, 0.5, FZ0, x + 3.4, 3.4, FZ1, true);        // frac tanks, shoulder to shoulder
  for (const x of [0, 3.5, 7.0]) { b.slab("steel", x + 0.3, 0.2, FZ1, x + 3.1, 0.5, FZ1 + 0.6); b.cyl("steel", x + 1.7, 1.2, FZ1 + 0.2, 0.22, 0.9, { axis: "z", tess: 8 }); b.cyl("red", x + 1.7, 1.2, FZ1 + 0.6, 0.42, 0.04, { tess: 12 }); }
  b.label("FRAC TANKS\nWATER / MUD", 5.2, 3.0, FZ1 + 0.1, 3.0, 0.8, Math.PI, "#1d6fb5", "#ffffff", 44);
  b.beam("steel", v(-0.2, 0.9, FZ1 + 0.4), v(10.6, 0.9, FZ1 + 0.4), 0.18);                      // manifold line the tanks share
  b.beam("steel", v(1.7, 0.9, FZ1 + 0.4), v(1.7, 0.9, -26.9), 0.18);                            // transfer line to the pits
  for (let z = -54; z < -28; z += 4.5) b.slab("dsteel", 1.6, 0, z - 0.1, 1.8, 0.8, z + 0.1);
  spots.frac = v(1.7, 1.4, FZ1 - 0.2 + 2.0);
  b.slab("wood", 10.4, 0, -63.4, 30.6, 0.04, -59.4);                                            // lot boards
  b.label("MUD PRODUCTS\nSKYTRAK ONLY", 20.5, 2.6, -58.9, 3.4, 1.0, Math.PI, "#233a52", "#ffd24a", 44);

  // ================= POWER: 4 gensets + VFD house + fuel (east of the rig, in the gap between the pumps and the accumulator) =================
  for (let i = 0; i < 4; i++) {
    const tx = 15 + i * 7;                                       // genset centre x on the pad
    b.at(tx + 29.75, -2.5, () => {
      const z = 0;
      if (kit) { kit.place("genset", -29.75 + tx + 29.75, 0, z - 2.5); b.blocker(-33, 0, z - 3.0, -26.5, 3.1, z + 3.0); }
      else {
        b.slab("poly", -33, 0.3, z - 3.0, -26.5, 3.1, z + 3.0, true);
        b.slab("dsteel", -33, 0, z - 3.0, -26.5, 0.3, z + 3.0);
        b.cyl("black", -31.6, 5.0, z, 0.4, 3.6, { tess: 8 });
        b.slab("steel", -26.5, 1.0, z - 1.6, -26.3, 2.6, z + 1.6);
        b.slab("lamp", -26.3, 2.4, z - 0.2, -26.2, 2.55, z + 0.2);
      }
    });
  }
  b.at(87, 8, () => {
    b.slab("trailer2", -44, 0.5, -17, -36, 3.5, -7, true);
    b.slab("dsteel", -44, 0, -17, -36, 0.5, -7);
    b.label("VFD / SCR\nHIGH VOLTAGE", -35.9, 2.2, -12, 2.4, 1.0, Math.PI / 2, "#7a1a14", "#ffffff", 44);
  });
  b.cyl("white", 28, 2.2, 4.8, 3.2, 12, { axis: "x", tess: 14, solid: true });      // diesel tank, lying along x
  for (const x of [23, 33]) b.slab("dsteel", x - 0.5, 0, 3.2, x + 0.5, 0.7, 6.4);
  spots.gens = v(27, 1.6, 2.8);
  spots.fuel = v(28, 1.8, 7.2);
  b.label("DIESEL", 28, 4.2, 4.8, 2.0, 0.6, Math.PI, "#233a52", "#ffd24a", 70);

  // ================= ACCUMULATOR (Koomey) + CHOKE MANIFOLD =================
  b.at(25.5, -2, () => {
  b.slab("dsteel", -17, 0, 9, -9.5, 0.4, 14, true);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    b.cyl("accgreen", -16.2 + i * 1.0, 1.4, 10.2 + j * 2.0, 0.55, 2.0, { tess: 8 });
  }
  b.slab("accgreen", -11.5, 0.4, 9.6, -9.7, 2.0, 13.6, true);
  b.slab("black", -11.4, 1.2, 9.5, -9.8, 1.9, 9.58);
  b.cyl("white", -9.9, 1.3, 9.45, 0.4, 0.04, { axis: "z", tess: 12 });
  b.label("BOP ACCUMULATOR\n3000 PSI", -13.2, 3.6, 8.85, 3.4, 1.0, Math.PI, "#1d5a30", "#ffffff", 44);
  });
  spots.accumulator = v(-10.6 + 25.5, 1.4, 9.0 - 2);

  // choke manifold skid with a control panel
  b.at(-19.5, -20.9, () => {
  b.slab("dsteel", 8.5, 0, 6.5, 15.5, 0.35, 11.5, true);
  // Real layout: one inlet from the choke line feeds an upstream header; three parallel runs go to a downstream header --
  //   a hydraulic (remote) choke, a manual choke, and a straight-through bypass -- each between gate valves; gauges on the header;
  //   the downstream header leaves toward the mud-gas separator (poor boy), with the flare line off that.
  const PIPE = 0.2, PY = 1.0;
  const gateValve = (x: number, z: number) => {
    b.box("steel", x, PY, z, 0.34, 0.34, 0.4);
    for (const dz of [-0.24, 0.24]) b.cyl("dsteel", x, PY, z + dz, 0.38, 0.06, { axis: "z", tess: 12 });
    b.cyl("steel", x, PY + 0.32, z, 0.2, 0.3, { tess: 10 });
    b.cyl("dsteel", x, PY + 0.62, z, 0.05, 0.3, { tess: 6 });
    b.cyl("red", x, PY + 0.8, z, 0.36, 0.045, { tess: 14 });
  };
  const runs = [10.0, 11.5, 13.0];
  b.beam("steel", v(9.4, PY, 10.4), v(13.6, PY, 10.4), PIPE);                 // upstream header
  b.beam("steel", v(9.4, PY, 7.6), v(13.6, PY, 7.6), PIPE);                    // downstream header
  b.beam("steel", v(11.5, PY, 11.5), v(11.5, PY, 10.4), 0.26);                // inlet from the choke line
  b.cyl("dsteel", 11.5, PY, 11.45, 0.44, 0.07, { axis: "z", tess: 14 });       // inlet flange
  for (const x of runs) {
    b.beam("steel", v(x, PY, 10.4), v(x, PY, 7.6), PIPE);
    gateValve(x, 9.75); gateValve(x, 8.15);
  }
  // hydraulic choke on run 1: blue body, vertical actuator, hose back to the remote panel
  b.box("blue", 10.0, PY, 8.95, 0.5, 0.46, 0.55); b.cyl("blue", 10.0, PY + 0.55, 8.95, 0.3, 0.7, { tess: 10 }); b.cyl("black", 10.0, PY + 0.95, 8.95, 0.18, 0.14, { tess: 8 });
  b.beam("black", v(10.0, PY + 0.8, 8.95), v(14.3, 1.5, 10.15), 0.04);
  // manual choke on run 2: body with a big handwheel and a position indicator
  b.box("steel", 11.5, PY, 8.95, 0.5, 0.46, 0.55); b.cyl("steel", 11.5, PY + 0.45, 8.95, 0.22, 0.4, { tess: 10 }); b.cyl("red", 11.5, PY + 0.78, 8.95, 0.5, 0.05, { tess: 16 }); b.box("white", 11.5, PY + 0.55, 8.7, 0.1, 0.18, 0.02);
  // bypass (run 3) is a straight-through line, so it gets its own heavy flange spool where a choke would be
  b.cyl("dsteel", 13.0, PY, 8.95, 0.34, 0.5, { axis: "z", tess: 12 });
  // pressure gauges on the upstream header, with isolation stems
  for (const gx of [10.4, 12.6]) { b.beam("steel", v(gx, PY + 0.1, 10.4), v(gx, 1.62, 10.4), 0.07); b.cyl("white", gx, 1.7, 10.4, 0.3, 0.07, { axis: "z", tess: 14 }); b.cyl("black", gx, 1.7, 10.44, 0.24, 0.02, { axis: "z", tess: 12 }); }
  // skid posts
  for (const [x, z] of [[8.7, 6.7], [15.3, 6.7], [8.7, 11.3], [15.3, 11.3]]) b.slab("dsteel", x - 0.08, 0.35, z - 0.08, x + 0.08, 1.0, z + 0.08);
  // outlet from the downstream header, down and out toward the mud-gas separator
  b.beam("steel", v(9.4, PY, 7.6), v(8.6, PY, 7.6), PIPE); b.beam("steel", v(8.6, PY, 7.6), v(8.6, 0.6, 4.5), PIPE);
  b.sphere("steel", 8.6, PY, 7.6, 0.28); b.sphere("steel", 8.6, 0.6, 4.5, 0.28);
  b.slab("dsteel", 14.2, 0.35, 10.2, 15.4, 1.9, 11.4, true);          // remote choke console
  b.slab("screen", 14.3, 1.1, 10.15, 15.3, 1.8, 10.2);
  b.label("CHOKE MANIFOLD", 12, 3.0, 6.4, 3.4, 0.8, Math.PI, "#7a1a14", "#ffffff", 56);
  });
  spots.choke = v(14.8 - 19.5, 1.5, 9.6 - 20.9);
  // choke line from the BOP side outlet: HCR (hydraulic, from the accumulator) + manual gate valve, then pipe to the manifold inlet
  {
    const CP = 0.22, pts = [v(-1.5, 2.0 - CELL, 0), v(-4.2, 2.0 - CELL, 0), v(-4.2, 1.0, 0), v(-4.2, 1.0, -8.6), v(-8.0, 1.0, -8.6), v(-8.0, 1.0, -9.4)];
    for (let i = 0; i < pts.length - 1; i++) b.beam("steel", pts[i], pts[i + 1], CP);
    for (const p of pts.slice(1, -1)) b.sphere("steel", p.x, p.y, p.z, 0.3);
    b.box("bopred", -2.0, 2.0 - CELL, 0, 0.55, 0.5, 0.5); b.cyl("bopblue", -2.0, 2.5 - CELL, 0, 0.3, 0.6, { tess: 10 }); b.label("HCR", -2.0, 3.0 - CELL, 0, 0.5, 0.22, Math.PI, "#7a1a14", "#ffffff", 40);   // HCR valve + hydraulic actuator
    b.box("steel", -3.1, 2.0 - CELL, 0, 0.4, 0.4, 0.4); b.cyl("red", -3.1, 2.35 - CELL, 0, 0.4, 0.05, { tess: 14 });                                              // manual gate valve
    for (let z = -1.5; z > -8.5; z -= 2.8) b.slab("dsteel", -4.35, 0, z - 0.1, -4.05, 0.9, z + 0.1);                                                      // supports
    // flowline from the manifold outlet east to the mud-gas separator (the tall green tank), on supports
    const fl = [v(-10.9, 0.6, -16.4), v(24, 0.6, -16.4), v(24, 0.6, -13.6)];
    b.beam("steel", fl[0], fl[1], CP); b.beam("steel", fl[1], fl[2], CP); b.sphere("steel", 24, 0.6, -16.4, 0.3);
    for (let x = -9; x < 24; x += 3.6) b.slab("dsteel", x - 0.1, 0, -16.5, x + 0.1, 0.5, -16.3);
    b.label("TO MUD-GAS SEPARATOR", 6.5, 1.5, -16.4, 3.0, 0.4, Math.PI, "#233a52", "#ffd24a", 34);
    // flare line: off the manifold outlet, west past the pits, then straight out to the stack at the edge of location
    const fp = [v(-10.9, 0.6, -16.4), v(-22, 0.6, -16.4), v(-22, 0.6, -59.8)];
    b.beam("steel", fp[0], fp[1], CP); b.beam("steel", fp[1], fp[2], CP); b.sphere("steel", -22, 0.6, -16.4, 0.3);
    for (let z = -20; z > -58; z -= 4) b.slab("dsteel", -22.1, 0, z - 0.1, -21.9, 0.5, z + 0.1);
    for (let x = -13; x > -22; x -= 3.4) b.slab("dsteel", x - 0.1, 0, -16.5, x + 0.1, 0.5, -16.3);
    b.label("FLARE LINE", -22.3, 1.3, -38, 2.2, 0.4, -Math.PI / 2, "#7a1a14", "#ffffff", 36);
    // drive-over ramps where the low lines cross the lease: a wedge up, a plateau over the pipe, a wedge down
    const HW = 4;   // the ramps span the whole lane, not a narrow strip
    const cross = (X: number, Z: number) => {
      b.ramp("dsteel", X, HW * 2, Z - 1.9, 0, Z - 0.55, 0.8, 0.08); b.ramp("dsteel", X, HW * 2, Z + 1.9, 0, Z + 0.55, 0.8, 0.08);
      b.slab("yellow", X - HW, 0.74, Z - 0.55, X + HW, 0.82, Z + 0.55);
      for (const sx of [-HW + 0.1, HW - 0.1]) { b.slab("black", X + sx - 0.05, 0.82, Z - 0.5, X + sx + 0.05, 0.84, Z + 0.5); }
      b.rampSolid(X, HW * 2, Z - 1.9, 0, Z - 0.55, 0.8); b.rampSolid(X, HW * 2, Z + 1.9, 0, Z + 0.55, 0.8);
      b.deck(X - HW, Z - 0.55, X + HW, Z + 0.55, 0.82);
    };
    // the low pipes are solid between the ramps (the ramps carry you over them)
    const lowPipe = (x0: number, z0: number, x1: number, z1: number, gaps: number[], alongX: boolean) => {
      const a = alongX ? Math.min(x0, x1) : Math.min(z0, z1), e = alongX ? Math.max(x0, x1) : Math.max(z0, z1), fix = alongX ? z0 : x0;
      const cuts = gaps.filter((g) => g > a && g < e).sort((p, q) => p - q); let cur = a;
      for (const g of [...cuts, e + 99]) { const end = Math.min(e, g - HW); if (end > cur) { if (alongX) b.blocker(cur, 0, fix - 0.14, end, 0.75, fix + 0.14); else b.blocker(fix - 0.14, 0, cur, fix + 0.14, 0.75, end); } cur = g + HW; }
    };
    lowPipe(-10.9, -16.4, 24, -16.4, [-16, -4, 8, 18], true);                                    // flowline to the separator
    lowPipe(-22, -16.4, -10.9, -16.4, [-16], true); lowPipe(-22, -16.4, -22, -59.8, [-30, -44, -57], false);   // flare line, west and then out to the stack
    for (const X of [-16, -4, 8, 18]) cross(X, -16.4);                                            // flowline / flare line, crossing north-south
    b.rot = RYAW;                                                                                // the other lines run north-south, so their ramps cross east-west
    for (const Z of [-30, -44, -57]) cross(Z, 22);                                              // flare line at x = -22   (local x = world z, local z = -world x)
    for (const Z of [-34, -42, -50]) cross(Z, -1.7);                                            // frac transfer line at x = 1.7
    b.rot = 0;
  }
  spots.bop = v(-5.2, 2.5, 0);

  // ================= CAMP: trailers =================
  // company man trailer (enterable)
  const CDX = 12, CDZ = 10;   // trailers sit toward the corner of the pad
  const SAFE_DX = 3, SAFE_DZ = -46;   // the safety trailer sits out on the east side, beside the toolpusher's (where the skytrak used to park)
  const TP_DZ = -52;                  // the toolpusher's trailer moved there too
  b.rot = RYAW;   // the camp turns a quarter turn about the rig, same direction as the rig
  b.at(CDX, CDZ, () => {
  b.room({ x0: 30, z0: 8, x1: 33.6, z1: 20, y0: 0.8, h: 2.7, wall: "trailer", roof: "dsteel", floor: "dsteel",
    door: { side: "-x", c: 14, w: 1.1 }, windows: [{ side: "-x", c: 10.2, w: 2.4, y0: 1.75, y1: 3.1 }] });
  b.slab("steel", 29.9, 0, 8, 33.7, 0.7, 20);
  // porch: two steps, a deck, posts, a roof, and rails
  b.slab("deck", 26.6, 0.2, 12.4, 27.2, 0.27, 15.6, true);
  b.slab("deck", 27.2, 0.46, 12.4, 27.8, 0.54, 15.6, true);
  b.slab("deck", 27.8, 0.74, 12.2, 29.9, 0.8, 15.8, true); b.blocker(26.6, 0, 12.4, 27.2, 0.27, 15.6); b.blocker(27.2, 0, 12.4, 27.8, 0.54, 15.6); b.blocker(27.8, 0, 12.2, 29.9, 0.8, 15.8);
  for (const z of [12.3, 15.7]) { b.slab("dsteel", 27.85, 0.8, z - 0.05, 27.95, 3.3, z + 0.05); b.rail("yellow", 27.9, z, 29.9, z, 0.8, 1.0); }
  b.slab("dsteel", 27.7, 3.3, 12.1, 30.0, 3.4, 15.9);
  b.label("COMPANY MAN", 29.85, 3.9, 14, 3.4, 0.6, -Math.PI / 2, "#233a52", "#ffd24a", 56);
  // a pallet of PDC bits beside the porch, and three more showing off on the deck
  b.slab("wood", 24.0, 0, 16.6, 26.2, 0.14, 19.4, true);
  const pdc = (cx: number, cy: number, cz: number, rot: number) => {
    b.cyl("dsteel", cx, cy + 0.09, cz, 0.3, 0.18, { tess: 12 });
    b.cyl("steel", cx, cy + 0.23, cz, 0.44, 0.1, { tess: 14 });
    for (let k = 0; k < 6; k++) { const a = rot + k * Math.PI / 3, rx = Math.sin(a) * 0.15, rz = Math.cos(a) * 0.15;
      b.box("steel", cx + rx, cy + 0.32, cz + rz, 0.05, 0.07, 0.17, false, a);
      b.box("yellow", cx + Math.sin(a) * 0.2, cy + 0.34, cz + Math.cos(a) * 0.2, 0.06, 0.06, 0.04, false, a); }
  };
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) pdc(24.5 + i * 1.1, 0.14, 17.1 + j * 0.9, i + j);
  // two big TVs on the east wall: the EDR and the news
  monitor("-x", 33.46, 0.8 + 1.5, 11.6, 1.5, 0.85, "edr", tvScreens);
  monitor("-x", 33.46, 0.8 + 1.5, 15.0, 1.5, 0.85, "news", tvScreens);
  // one wrap-around desk: along the east wall under the TVs, round the south corner, and up the front wall under the window
  b.slab("wood", 32.7, 0.8, 8.4, 33.4, 1.55, 16.4, true);             // east run
  b.slab("wood", 30.2, 0.8, 8.4, 32.7, 1.55, 9.4, true);              // south run
  b.slab("wood", 30.2, 0.8, 9.4, 31.0, 1.55, 11.4, true);             // front run, under the window
  b.slab("black", 30.28, 1.55, 9.7, 30.4, 2.1, 10.7); b.slab("screen", 30.4, 1.6, 9.75, 30.44, 2.05, 10.65);   // the computer, facing into the room, on the front run
  b.slab("black", 30.5, 1.55, 9.8, 30.95, 1.6, 10.6);                 // keyboard
  b.slab("steel", 30.2, 0.8, 17.2, 31.6, 1.3, 19.8, true);            // bunk
  b.slab("white", 30.25, 1.3, 17.25, 31.55, 1.45, 19.75);
  // the bedroom: a partition across the north end with a doorway (the door stands open, swung back into the bedroom)
  b.slab("trailer", 30.0, 0.8, 16.94, 31.3, 3.5, 17.06, true); b.slab("trailer", 32.3, 0.8, 16.94, 33.6, 3.5, 17.06, true);
  b.slab("trailer", 31.3, 2.9, 16.94, 32.3, 3.5, 17.06);                                                // lintel
  b.slab("dsteel", 32.3, 0.8, 17.06, 32.38, 2.9, 18.06); b.slab("steel", 32.31, 1.7, 17.8, 32.4, 1.8, 17.95);   // the open door and its handle
  b.slab("steel", 31.3, 0.8, 16.9, 32.3, 0.84, 17.1);                                                   // threshold
  b.slab("black", 30.15, 1.7, 12.0, 30.3, 2.1, 12.4);                 // wall phone box
  b.slab("red", 30.17, 1.8, 12.05, 30.25, 1.95, 12.35);
  // a box of donuts on the back counter, and a printer on the end counter that has been out of order since forever
  b.defMat("donutbox", "#f2e6d0"); b.defMat("donutpink", "#f08ab0"); b.defMat("donutdough", "#c98a4b");
  b.slab("donutbox", 32.78, 1.55, 12.5, 33.34, 1.62, 13.9);
  [[13.0, 0], [13.45, 1]].forEach(([z, k]) => { for (const dx of [32.98, 33.18]) { b.cyl(k ? "donutpink" : "donutdough", dx, 1.66, z + (dx > 33 ? 0.12 : -0.12), 0.17, 0.05, { tess: 14 }); b.cyl("black", dx, 1.69, z + (dx > 33 ? 0.12 : -0.12), 0.05, 0.02, { tess: 8 }); } });
  b.cyl("donutpink", 33.08, 1.66, 12.72, 0.17, 0.05, { tess: 14 }); b.cyl("black", 33.08, 1.69, 12.72, 0.05, 0.02, { tess: 8 });
  b.slab("white", 31.1, 1.55, 8.55, 32.0, 1.95, 9.25, true);                                    // printer body
  b.slab("dsteel", 31.2, 1.95, 8.65, 31.9, 2.0, 9.1); b.slab("white", 31.3, 2.0, 8.7, 31.8, 2.28, 8.74);   // lid and a sheet of paper stuck in the tray
  b.slab("black", 31.95, 1.75, 8.9, 32.02, 1.9, 9.1); b.slab("red", 31.96, 1.82, 8.95, 32.03, 1.86, 9.0);    // control panel with its one red light
  b.slab("yellow", 31.1, 1.6, 9.24, 32.0, 1.7, 9.27); b.slab("yellow", 31.1, 1.8, 9.24, 32.0, 1.9, 9.27);    // caution tape
  spots.donuts = rv(33.0 + CDX, 1.9, 13.2 + CDZ);
  spots.printer = rv(31.5 + CDX, 2.0, 8.9 + CDZ);
  spots.desk = rv(31.3 + CDX, 2.0, 10.2 + CDZ);
  spots.bunk = rv(30.9 + CDX, 1.6, 18.4 + CDZ);
  spots.phone = rv(30.4 + CDX, 1.9, 12.2 + CDZ);
  // toolpusher trailer (solid)
  if (kit) { kit.place("trailer", -(30 + CDZ), 0, 31.8 + CDX, RYAW); b.blocker(29.9, 0, 24, 33.7, 3.6, 36); }
  else { b.slab("trailer", 30, 0.7, 24, 33.6, 3.6, 36, true); b.slab("steel", 29.9, 0, 24, 33.7, 0.7, 36, true); }
  b.label("DIRECTIONAL", 29.85, 3.9, 30, 3.4, 0.6, -Math.PI / 2, "#233a52", "#ffd24a", 52);
  b.label("NO ENTRY\nDIRECTIONAL DRILLERS AT WORK", 29.85, 2.5, 30, 3.0, 1.0, -Math.PI / 2, "#7a1a14", "#ffffff", 30);
  b.slab("red", 28.4, 0, 28.6, 28.5, 1.0, 28.7); b.slab("red", 28.4, 0, 31.3, 28.5, 1.0, 31.4); b.slab("yellow", 28.38, 0.8, 28.6, 28.52, 0.9, 31.4);   // a barrier rail across the front
  // the toolpusher's trailer, moved out east to where the skytrak used to park
  b.at(0, TP_DZ, () => {
    if (kit) { kit.place("trailer", 12, 0, 43.8, RYAW); b.blocker(29.9, 0, 24, 33.7, 3.6, 36); }
    else { b.slab("trailer", 30, 0.7, 24, 33.6, 3.6, 36, true); b.slab("steel", 29.9, 0, 24, 33.7, 0.7, 36, true); }
    b.label("TOOLPUSHER", 29.85, 3.9, 30, 3.4, 0.6, -Math.PI / 2, "#233a52", "#ffd24a", 56);
  });
  // mudlogger unit: out on the east edge, just south of the north-east corner of the location, turned a quarter turn, door facing west
  const rotSave = b.rot; b.rot = 0;
  b.at(2, 27, () => {
  // (raw coords; world = +12, +10) a sealed fifth-wheel trailer: gooseneck up front on landing legs, tandem axles at the back, a locked door
  b.slab("trailer2", 38.7, 1.1, 7.0, 41.3, 3.5, 17.0, true);                          // body
  b.slab("dsteel", 38.6, 3.5, 6.9, 41.4, 3.6, 17.1);                                  // roof
  b.slab("steel", 38.7, 0.95, 7.0, 41.3, 1.1, 17.0);                                  // frame
  b.slab("dsteel", 39.2, 0.8, 7.0, 40.8, 0.95, 8.8); b.cyl("black", 40.0, 0.7, 7.9, 0.3, 0.2, { tess: 10 });  // upper coupler plate + kingpin
  for (const sx of [39.2, 40.8]) { b.cyl("dsteel", sx, 0.55, 8.4, 0.22, 1.0, { tess: 8 }); b.slab("steel", sx - 0.3, 0, 8.1, sx + 0.3, 0.06, 8.7); }   // landing gear
  b.cyl("steel", 40.0, 0.85, 8.4, 0.08, 1.7, { axis: "x", tess: 6 });
  for (const wz of [14.8, 16.0]) for (const wx of [38.55, 41.45]) {
    b.cyl("black", wx, 0.5, wz, 1.0, 0.3, { axis: "x", tess: 18 }); b.cyl("steel", wx + (wx < 40 ? -0.16 : 0.16), 0.5, wz, 0.5, 0.04, { axis: "x", tess: 12 });
  }
  for (const wx of [38.35, 41.25]) b.slab("dsteel", wx, 0.98, 14.1, wx + 0.4, 1.06, 16.7);   // fenders
  b.slab("dsteel", 38.64, 1.15, 11.6, 38.72, 3.1, 12.8, true);                          // locked steel door
  b.slab("steel", 38.58, 2.0, 12.55, 38.66, 2.12, 12.75); b.slab("red", 38.55, 2.2, 12.5, 38.6, 2.3, 12.6); // handle and deadbolt
  b.slab("black", 38.62, 2.1, 9.2, 38.7, 2.8, 10.6); b.slab("black", 38.62, 2.1, 14.0, 38.7, 2.8, 15.0);    // dark windows
  b.slab("deck", 38.0, 0.0, 11.7, 38.6, 0.55, 12.7, true);                              // a stoop, for the knocking
  spots.mudlog = v(51.6, 1.5, 49.2);   // just outside the door (world coordinates: the trailer is no longer in the camp's turned frame)
  b.label("MUD LOGGING\nLOCKED • KNOCK", 38.55, 3.1, 8.6, 2.0, 0.7, -Math.PI / 2, "#233a52", "#ffd24a", 40);
  b.label("NO ADMITTANCE\nSAMPLES IN PROGRESS", 38.55, 3.1, 14.6, 1.6, 0.6, -Math.PI / 2, "#7a1a14", "#ffffff", 34);
  });
  b.rot = rotSave;
  // safety/change room + water frac tanks
  // the safety trailer: you can walk in (the stand-down huddle happens in here), with benches, a whiteboard and a steps-and-door on the camp side
  b.at(SAFE_DX, SAFE_DZ, () => {
  b.room({ x0: 37, z0: 20, x1: 43, z1: 28, y0: 0.7, h: 2.7, wall: "trailer", roof: "dsteel", floor: "dsteel", door: { side: "-x", c: 24, w: 1.1 } });
  b.slab("steel", 36.9, 0, 20, 43.1, 0.6, 28);
  b.slab("steel", 35.5, 0, 23.1, 36.2, 0.35, 24.9, true); b.slab("steel", 36.2, 0, 23.1, 36.95, 0.7, 24.9, true);
  b.label("SAFETY", 36.85, 3.8, 24, 2.4, 0.6, -Math.PI / 2, "#1d5a30", "#ffffff", 64);
  for (const bz of [20.3, 27.3]) b.slab("wood", 37.2, 0.7, bz, 42.8, 1.15, bz + 0.5, true);               // benches along the long walls
  b.slab("wood", 41.3, 0.7, 22.6, 42.1, 1.2, 25.4, true);                                                // a table with the sign-in binder
  b.label("SAFETY MEETING\nDON'T DIE.", 42.88, 2.3, 24, 4.2, 1.5, Math.PI / 2, "#e8e4d4", "#1d3a5a", 38);   // whiteboard on the back wall
  b.label("STOP WORK AUTHORITY", 37.12, 2.4, 21.6, 1.2, 0.5, -Math.PI / 2, "#1d5a30", "#ffffff", 22);
  });
  });
  b.rot = 0;
  for (let i = 0; i < 2; i++) b.slab("tank", 38 + i * 4.2, 0.5, -34, 41.7 + i * 4.2, 3.2, -26, true);
  // porta johns
  const PJX = 28.2, PJZ = -48.8;   // porta johns sit right beside the toolpusher's trailer (at its east end)
  b.rot = RYAW;
  b.at(PJX, PJZ, () => { for (let i = 0; i < 2; i++) { const z = 28 + i * 1.4;
    b.slab(i === 0 ? "poly" : "tankgreen", 14.2, 0, z, 15.4, 2.4, z + 1.2, true); } });
  const portaDoor = MeshBuilder.CreateBox("portadoor", { width: 0.05, height: 2.0, depth: 0.9 }, scene);
  portaDoor.material = b.getMat("white"); portaDoor.position.set(-(28.6 + PJZ), 1.1, 14.17 + PJX); portaDoor.rotation.y = RYAW;
  const portaLamp = MeshBuilder.CreateBox("portalamp", { width: 0.06, height: 0.14, depth: 0.14 }, scene);
  portaLamp.position.set(-(28.2 + PJZ), 1.9, 14.16 + PJX); portaLamp.rotation.y = RYAW;
  const lockMat = new StandardMaterial("lockm", scene); lockMat.emissiveColor = new Color3(1, 0.1, 0.1); lockMat.diffuseColor = Color3.Black();
  portaLamp.material = lockMat;
  spots.porta = rv(13.6 + PJX, 1.4, 28.6 + PJZ);
  b.label("PORTA\nJOHN", 14.1 + PJX, 2.7, 28.6 + PJZ, 1.1, 0.5, -Math.PI / 2, "#1d6fb5", "#ffffff", 44);
  b.rot = 0;
  // muster point
  b.at(-16, 0, () => {
    b.cyl("dsteel", 46, 1.7, 42, 0.12, 3.4, { tess: 6 });
    b.label("MUSTER\nPOINT A", 46, 3.5, 42, 2.4, 1.2, 0, "#1d7a3a", "#ffffff", 70);
    b.defMat("musterg", "#1fb34a");
    b.slab("musterg", 43, 0, 40, 49, 0.1, 44, true);                                   // a real raised pad you step up onto, in a colour that does not blend with the dirt
    for (const [x0, z0, x1, z1] of [[43, 40, 49, 40.2], [43, 43.8, 49, 44], [43, 40, 43.2, 44], [48.8, 40, 49, 44]] as number[][]) b.slab("yellow", x0, 0.1, z0, x1, 0.115, z1);   // painted border
  });
  spots.muster = v(30, 1.2, 40.6);
  // wind sock
  b.cyl("dsteel", 36, 3, 50, 0.1, 6, { tess: 6 });
  const windsock = node("windsock", scene, 36, 6, 50);
  {
    const sock = MeshBuilder.CreateCylinder("sock", { diameterTop: 0.15, diameterBottom: 0.5, height: 1.8, tessellation: 8 }, scene);
    sock.rotation.z = Math.PI / 2; sock.position.x = 0.9; sock.material = b.getMat("orange"); sock.parent = windsock;
  }
  // gate / guard shack
  b.room({ x0: 5, z0: 94, x1: 8.4, z1: 98, y0: 0.06, h: 2.6, wall: "trailer", roof: "dsteel", floor: "dsteel",
    door: { side: "-x", c: 96, w: 1.4 } });
  // no door: the opening is a window with a sill, a glass pane and a counter
  b.slab("trailer", 4.94, 0.06, 95.3, 5.06, 1.05, 96.7, true);
  b.slab("glass", 4.97, 1.05, 95.3, 5.03, 2.1, 96.7);
  b.blocker(4.85, 0, 95.3, 5.15, 3, 96.7);
  b.slab("steel", 4.55, 1.05, 95.2, 5.0, 1.1, 96.8);
  b.label("CHECK IN HERE", 4.9, 2.4, 96, 1.3, 0.3, -Math.PI / 2, "#233a52", "#ffd24a", 40);
  b.slab("wood", 6.5, 0.06, 96.8, 8.2, 1.0, 97.8, true);
  // two signs on posts beside the entry road, facing the traffic coming in from +z
  b.label("PPE REQUIRED\nHARD HAT • FRC\nGLASSES • GLOVES", 2.4, 2.25, 95.5, 2.2, 1.5, Math.PI, "#7a1a14", "#ffffff", 40);
  for (const x of [1.45, 3.35]) b.cyl("dsteel", x, 1.5, 95.42, 0.12, 3.0, { tess: 6 });
  b.beam("dsteel", v(1.3, 3.0, 95.42), v(3.5, 3.0, 95.42), 0.08);
  b.label("AL DRILLING • RIG 107\nAUTHORIZED PERSONNEL", -5.0, 3.0, 95.5, 3.2, 1.0, Math.PI, "#233a52", "#ffd24a", 40);
  for (const x of [-6.45, -3.55]) b.cyl("dsteel", x, 1.8, 95.42, 0.14, 3.6, { tess: 6 });
  b.beam("dsteel", v(-6.6, 3.55, 95.42), v(-3.4, 3.55, 95.42), 0.08);
  b.beam("dsteel", v(-6.6, 2.45, 95.42), v(-3.4, 2.45, 95.42), 0.08);
  spots.gate = v(4.1, 1.4, 96.0);
  // pad edge fence posts
  for (let i = -12; i <= 12; i++) { b.box("dsteel", i * 5, 0.8, 62, 0.1, 1.6, 0.1); b.box("dsteel", i * 5, 0.8, -66, 0.1, 1.6, 0.1); }
  b.blocker(-60, 0, 61.9, -8, 1.6, 62.1); b.blocker(8, 0, 61.9, 60, 1.6, 62.1); b.blocker(-60, 0, -66.1, 60, 1.6, -65.9);   // the fence is solid
  b.beam("dsteel", v(-60, 1.4, 62), v(-8, 1.4, 62), 0.04); b.beam("dsteel", v(8, 1.4, 62), v(60, 1.4, 62), 0.04);
  b.beam("dsteel", v(-60, 1.4, -66), v(60, 1.4, -66), 0.04);

  // light towers
  for (const [x, z] of [[-28, 32], [28, 46], [-30, -34], [30, -38], [-12, 62]]) {
    if (kit) {
      const phi = Math.atan2(-x, -z) + Math.PI / 2;
      kit.place("lighttower", x, 0, z, phi); b.blocker(x - 0.5, 0, z - 0.5, x + 0.5, 2.0, z + 0.5);
      // the model's four stabilizer pads sit 16 cm below the ends of their arms with nothing between: a short post joins each pad to its arm
      for (const al of [2.586, 3.698, 5.727, 6.839]) { const ang = al - phi; b.cyl("dsteel", x + Math.cos(ang) * 2.24, 0.22, z + Math.sin(ang) * 2.24, 0.17, 0.26, { tess: 8 }); }
    }
    else { b.cyl("dsteel", x, 4.5, z, 0.22, 9, { tess: 6 }); b.slab("lamp", x - 0.9, 9.0, z - 0.15, x + 0.9, 9.35, z + 0.15); }
  }

  // casing truck (hidden until you order casing)
  const casingTruck = node("casingtruck", scene, 21, 0, 40);
  {
    const cab = MeshBuilder.CreateBox("cab", { width: 2.4, height: 2.4, depth: 2.2 }, scene);
    cab.material = b.getMat("red"); cab.parent = casingTruck; cab.position.set(0, 1.7, 7.5);
    const bed = MeshBuilder.CreateBox("bed", { width: 2.5, height: 0.35, depth: 14 }, scene);
    bed.material = b.getMat("dsteel"); bed.parent = casingTruck; bed.position.set(0, 0.9, -0.2);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 6 - (i % 2); j++) {
      const c = MeshBuilder.CreateCylinder("csg", { diameter: 0.36, height: 12.4, tessellation: 8 }, scene);
      c.rotation.x = Math.PI / 2; c.material = b.getMat("pipe"); c.parent = casingTruck;
      c.position.set(-0.95 + j * 0.38 + (i % 2) * 0.19, 1.2 + i * 0.33, -0.4);
    }
    for (const z of [-4, -1, 5.5]) for (const x of [-1.2, 1.2]) {
      const w = MeshBuilder.CreateCylinder("w", { diameter: 1.1, height: 0.4, tessellation: 10 }, scene);
      w.rotation.z = Math.PI / 2; w.material = b.getMat("black"); w.parent = casingTruck; w.position.set(x, 0.55, z);
    }
  }
  casingTruck.setEnabled(false);
  // solid only while the truck is on location (collider boxes along its length: trailer, cab)
  const truckBoxes: AABB[] = [
    { x0: 19.55, x1: 22.45, y0: 0, y1: 0, z0: 32.8, z1: 46.0 },
    { x0: 19.6, x1: 22.4, y0: 0, y1: 0, z0: 46.0, z1: 49.0 },
  ];
  b.colliders.push(...truckBoxes);
  const setTruckSolid = (on: boolean) => { truckBoxes[0].y1 = on ? 3.2 : 0; truckBoxes[1].y1 = on ? 3.4 : 0; };
  // the tally spot sits beside the truck, not inside it
  spots.casing = v(18.3, 1.6, 39);

  // ================= far-field =================
  // flare stack
  b.cyl("flaregray", -22, 9, -64, 0.9, 18, { tess: 8 });
  b.cyl("steel", -22, 0.9, -61.4, 1.5, 3.2, { axis: "z", tess: 14, solid: true });                 // knockout drum
  for (const dz of [-62.6, -60.2]) b.slab("dsteel", -22.6, 0, dz - 0.1, -21.4, 0.3, dz + 0.1);
  for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) b.beam("steel", v(-22, 17, -64), v(-22 + dx * 2.2, 0.2, -64 + dz * 2.2), 0.05);   // guy wires
  b.label("FLARE", -22, 2.4, -66.2, 1.6, 0.5, 0, "#7a1a14", "#ffffff", 50);
  let flameK = 1;
  const flame = MeshBuilder.CreateCylinder("flame", { diameterTop: 0.1, diameterBottom: 1.3, height: 3, tessellation: 8 }, scene);
  const flameMat = new StandardMaterial("flamem", scene);
  flameMat.emissiveColor = new Color3(1, 0.55, 0.1); flameMat.diffuseColor = Color3.Black(); flameMat.alpha = 0.85;
  flame.material = flameMat; flame.position.set(-22, 19.5, -64);
  // pumpjacks
  const pumpjacks: TransformNode[] = [];
  for (const [x, z, r] of [[110, 40, -Math.PI / 2], [-120, 90, Math.PI / 2], [95, -90, -Math.PI / 2]]) {
    b.slab("dsteel", x - 2, 0, z - 1, x + 2, 0.5, z + 1);
    b.slab("blue", x - 0.2, 0, z - 0.2, x + 0.2, 4.2, z + 0.2);
    const walk = node("pj", scene, x, 4.2, z); walk.rotation.y = r;
    const beam = MeshBuilder.CreateBox("pjb", { width: 0.4, height: 0.5, depth: 7 }, scene);
    beam.material = b.getMat("blue"); beam.parent = walk;
    const head = MeshBuilder.CreateBox("pjh", { width: 0.5, height: 1.4, depth: 0.5 }, scene);
    head.material = b.getMat("blue"); head.parent = walk; head.position.z = 3.4; head.position.y = -0.5;
    pumpjacks.push(walk);
  }
  // scrub brush
  const scrub = MeshBuilder.CreateSphere("scrub", { diameter: 1, segments: 4 }, scene);
  const sm = new StandardMaterial("scrubm", scene); sm.diffuseColor = Color3.FromHexString("#6f7a4a"); sm.specularColor = Color3.Black();
  scrub.material = sm;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) {
    const x = (rnd() - 0.5) * 700, z = (rnd() - 0.5) * 700;
    if (Math.abs(x) < 70 && z > -75 && z < 110) continue; if (Math.abs(x) < 6 && z > 50) continue;
    const s = 0.8 + rnd() * 1.6;
    scrub.thinInstanceAdd(Matrix.Compose(new Vector3(s * 1.4, s * 0.7, s * 1.4), Quaternion.Identity(), new Vector3(x, s * 0.3, z)));
  }
  // helicopter (for the VP of Operations)
  const heli = node("heli", scene, 70, 80, 60);
  // a light turbine helicopter (Bell 407 style, forward is +z): rounded white cabin with a blue stripe and a wide glass bubble, engine cowl, a tapering
  // tail boom with fin, stabiliser and tail rotor, a mast and a two-blade main rotor, and skids on cross tubes. Skid bottoms sit 1.1 m below the origin.
  let heliRotor: TransformNode, heliTail: TransformNode, heliDisc: Mesh;
  {
    const put = (m: Mesh, mat: string, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { m.material = b.getMat(mat); m.parent = heli; m.position.set(x, y, z); m.scaling.set(sx, sy, sz); m.isPickable = false; return m; };
    const ell = (mat: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) => put(MeshBuilder.CreateSphere("hell", { diameter: 1, segments: 18 }, scene), mat, x, y, z, sx, sy, sz);
    const box = (mat: string, x: number, y: number, z: number, w: number, h: number, d: number) => put(MeshBuilder.CreateBox("hbox", { width: w, height: h, depth: d }, scene), mat, x, y, z);
    const tube = (mat: string, ax: "x" | "y" | "z", x: number, y: number, z: number, dia: number, len: number) => { const c = MeshBuilder.CreateCylinder("htube", { diameter: dia, height: len, tessellation: 10 }, scene); if (ax === "z") c.rotation.x = Math.PI / 2; if (ax === "x") c.rotation.z = Math.PI / 2; return put(c, mat, x, y, z); };
    ell("white", 0, 0.05, 0.1, 1.55, 1.45, 3.1);                                   // main cabin
    ell("white", 0, 0.78, -0.55, 1.05, 0.75, 1.9);                                  // engine cowl on top, behind the mast
    ell("glass", 0, 0.28, 1.0, 1.42, 1.0, 1.5);                                     // wide front windscreen bubble
    ell("bopblue", 0, -0.42, 0.1, 1.58, 0.28, 3.12);                                // blue belly stripe
    for (const s of [-1, 1]) { box("dsteel", s * 0.775, 0.1, -0.15, 0.03, 0.78, 0.04); box("dsteel", s * 0.775, 0.1, 0.55, 0.03, 0.78, 0.04); box("dsteel", s * 0.775, 0.46, 0.2, 0.03, 0.04, 0.72); box("dsteel", s * 0.775, -0.28, 0.2, 0.03, 0.04, 0.72); }   // door outlines
    const boom = MeshBuilder.CreateCylinder("hboom", { diameterTop: 0.34, diameterBottom: 0.14, height: 3.7, tessellation: 14 }, scene); boom.rotation.x = -Math.PI / 2;
    put(boom, "white", 0, 0.5, -3.3);                                                // tapering tail boom (wide end at the cabin)
    box("white", 0, 0.78, -5.0, 0.07, 0.95, 0.75);                                  // vertical fin
    box("white", 0, 0.38, -4.75, 1.3, 0.05, 0.4);                                   // horizontal stabiliser
    box("bopblue", 0, 1.1, -5.05, 0.075, 0.2, 0.45);                                // blue tip on the fin
    heliTail = new TransformNode("htail", scene); heliTail.parent = heli; heliTail.position.set(0.12, 0.85, -5.05);
    { const bl = MeshBuilder.CreateBox("htb", { width: 0.03, height: 1.1, depth: 0.08 }, scene); bl.material = b.getMat("black"); bl.parent = heliTail; const bl2 = bl.clone("htb2"); bl2.rotation.x = Math.PI / 2; bl2.parent = heliTail; }
    tube("steel", "y", 0, 1.35, -0.45, 0.2, 0.6);                                   // main-rotor mast
    heliRotor = new TransformNode("hrotor", scene); heliRotor.parent = heli; heliRotor.position.y = 1.68;
    { const hub = MeshBuilder.CreateCylinder("hhub", { diameter: 0.4, height: 0.16, tessellation: 12 }, scene); hub.material = b.getMat("black"); hub.parent = heliRotor;
      for (const r of [0, Math.PI / 2]) { const bl = MeshBuilder.CreateBox("hblade", { width: 10.4, height: 0.035, depth: 0.32 }, scene); bl.material = b.getMat("black"); bl.parent = heliRotor; bl.rotation.y = r; } }
    heliRotor.position.z = -0.45;
    heliDisc = MeshBuilder.CreateCylinder("hdisc", { diameter: 10.4, height: 0.01, tessellation: 40 }, scene);
    { const dm = new StandardMaterial("hdiscm", scene); dm.diffuseColor = new Color3(0.1, 0.1, 0.1); dm.alpha = 0.16; dm.backFaceCulling = false; heliDisc.material = dm; heliDisc.parent = heli; heliDisc.position.set(0, 1.68, -0.45); heliDisc.isPickable = false; }
    for (const s of [-1, 1]) tube("dsteel", "z", s * 0.82, -1.05, 0.1, 0.09, 3.4);   // skids
    tube("dsteel", "x", 0, -0.92, -0.55, 0.07, 1.74); tube("dsteel", "x", 0, -0.92, 0.85, 0.07, 1.74);   // cross tubes
    for (const s of [-1, 1]) for (const zz of [-0.55, 0.85]) { const st = MeshBuilder.CreateCylinder("hstrut", { diameter: 0.06, height: 0.5, tessellation: 8 }, scene); st.material = b.getMat("dsteel"); st.parent = heli; st.position.set(s * 0.74, -0.7, zz); st.rotation.z = s * 0.28; }
    ell("yellow", 0, 0.62, 1.85, 0.5, 0.05, 0.12);                                  // a landing-light strip in the nose
  }
  heli.setEnabled(false);
  // the space shuttle stack (vertical, nose up): orange external tank, two white boosters, and the orbiter against the tank. Origin = the base of the stack.
  const shuttle = node("shuttle", scene, 63, 0.17, 57.5);
  const flames: Mesh[] = [];
  {
    const put = (m: Mesh, mat: string, x: number, y: number, z: number) => { m.material = b.getMat(mat); m.parent = shuttle; m.position.set(x, y, z); m.isPickable = false; return m; };
    const cyl = (mat: string, x: number, y: number, z: number, dTop: number, dBot: number, h: number) => put(MeshBuilder.CreateCylinder("shc", { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: 24 }, scene), mat, x, y, z);
    const box = (mat: string, x: number, y: number, z: number, w: number, h: number, d: number) => put(MeshBuilder.CreateBox("shb", { width: w, height: h, depth: d }, scene), mat, x, y, z);
    cyl("orange", 0, 15, 0, 4.2, 4.2, 26); cyl("orange", 0, 31, 0, 0.5, 4.2, 6);                  // external tank and its nose
    for (const s of [-1, 1]) { cyl("white", s * 3.7, 12, 0, 2.4, 2.4, 22); cyl("white", s * 3.7, 25, 0, 0.3, 2.4, 4); cyl("black", s * 3.7, 0.9, 0, 1.4, 2.0, 1.6); cyl("steel", s * 2.0, 15, 0, 0.5, 0.5, 14); }   // boosters, noses, nozzles, struts
    cyl("white", 0, 11, 3.9, 3.4, 3.4, 18); cyl("white", 0, 22.5, 3.9, 0.5, 3.4, 5);              // orbiter fuselage and nose
    cyl("black", 0, 22.5, 3.9, 0.2, 3.5, 5.2).scaling.set(0.99, 0.99, 0.99);                      // (dark underside tiles hint)
    box("glass", 0, 20.2, 5.5, 2.0, 1.2, 0.5);                                                    // cockpit windows
    box("white", 0, 4.5, 4.1, 12.5, 0.4, 7.5); box("black", 0, 4.3, 4.1, 12.7, 0.2, 7.7);       // delta wing, black underside
    box("white", 0, 6.5, 8.0, 0.45, 8, 3.6);                                                      // vertical tail
    for (const s of [-1, 1]) cyl("dsteel", s * 1.1, 1.6, 3.6, 1.0, 1.4, 2.0);                    // main engines
    for (const [x, z, d, h] of [[0, 3.6, 3.2, 3], [-3.7, 0, 2.2, 2.6], [3.7, 0, 2.2, 2.6]] as number[][]) {
      const f = MeshBuilder.CreateCylinder("shflame", { diameterTop: d, diameterBottom: 0.2, height: 1, tessellation: 12 }, scene);
      const fm = new StandardMaterial("shfm", scene); fm.disableLighting = true; fm.emissiveColor = new Color3(1, 0.6, 0.2); fm.alpha = 0.85; fm.backFaceCulling = false; fm.fogEnabled = false;
      f.material = fm; f.parent = shuttle; f.position.set(x, 0, z); f.scaling.set(1, 0.0001, 1); f.isPickable = false; flames.push(f);
    }
  }
  shuttle.setEnabled(false);
  const shuttleState: Rig["shuttleState"] = { phase: "hidden", node: shuttle, v: 0, t: 0 };
  // a proper raised concrete pad (well clear of the ground surface so nothing flickers), with a painted ring and an H
  b.slab("dsteel", 56, 0.0, 54, 70, 0.16, 68, true);
  b.cyl("yellow", 63, 0.17, 61, 8, 0.02, { tess: 32 });
  b.cyl("dsteel", 63, 0.175, 61, 7.5, 0.02, { tess: 32 });
  for (const sx of [-1.4, 1.4]) b.slab("white", 63 + sx - 0.2, 0.17, 59.0, 63 + sx + 0.2, 0.19, 63.0);
  b.slab("white", 61.6, 0.17, 60.8, 64.4, 0.19, 61.2);
  spots.helipad = v(63, 1.0, 61);

  // deer
  const deerNode = node("deer", scene, 30, 0, -50);
  {
    const body = MeshBuilder.CreateBox("db", { width: 0.5, height: 0.6, depth: 1.3 }, scene);
    const dm = new StandardMaterial("deerm", scene); dm.diffuseColor = Color3.FromHexString("#9a6b3a"); dm.specularColor = Color3.Black();
    body.material = dm; body.parent = deerNode; body.position.y = 1.05;
    const neck = MeshBuilder.CreateBox("dn", { width: 0.2, height: 0.7, depth: 0.2 }, scene);
    neck.material = dm; neck.parent = deerNode; neck.position.set(0, 1.5, 0.6); neck.rotation.x = -0.4;
    const head = MeshBuilder.CreateBox("dh", { width: 0.22, height: 0.22, depth: 0.4 }, scene);
    head.material = dm; head.parent = deerNode; head.position.set(0, 1.85, 0.85);
    for (const [x, z] of [[-0.18, -0.5], [0.18, -0.5], [-0.18, 0.5], [0.18, 0.5]]) {
      const l = MeshBuilder.CreateBox("dl", { width: 0.1, height: 0.8, depth: 0.1 }, scene);
      l.material = dm; l.parent = deerNode; l.position.set(x, 0.4, z);
    }
  }
  deerNode.setEnabled(false);

  // ================= NPCs =================
  const humans: Record<string, Human> = {};
  const addH = (key: string, x: number, y: number, z: number, rotY: number, o: ConstructorParameters<typeof Human>[1]) => {
    const h = new Human(scene, o); h.root.position.set(x, y, z); h.root.rotation.y = rotY; humans[key] = h; return h;
  };
  const addR = (key: string, x: number, y: number, z: number, rotY: number, o: ConstructorParameters<typeof Human>[1]) => addH(key, -z, y, x, rotY + RYAW, o);
  addR("driller", 3.95, F, -2.3, -Math.PI / 2, { shirt: "#8a1f1a", pants: "#2c3e50", hat: "#f2f2f2", skin: "#c68b63" });          // standing at his console
  addR("dd1", 5.6, F, -3.85, Math.PI / 2, { shirt: "#2b4a66", pants: "#3a3a3a", hat: null, skin: "#8a5a3a" });                      // standing at the DD desk
  addR("hand1", -0.9, F, 2.4, 0.4, { shirt: "#c4561a", pants: "#2c3e50", hat: "#e8b923", skin: "#d9a77f" });
  addR("hand2", 0.0, F, 5.3, Math.PI, { shirt: "#c4561a", pants: "#2c3e50", hat: "#e8b923", skin: "#8a5a3a" });
  addR("derrickman", 0.0, FB + 0.12, 3.8, Math.PI, { shirt: "#c4561a", pants: "#2c3e50", hat: "#e8b923", skin: "#d9a77f" });
  addH("mudeng", -6, 2.78, -22.8, 1.2, { shirt: "#1d6fb5", pants: "#3a3a3a", hat: "#f2f2f2", skin: "#e0b48f" });
  addH("pusher", -40, 0, 39.5, -1.6 + RYAW, { shirt: "#3a5a3a", pants: "#4a3a2a", hat: "#d9d9d9", skin: "#b9805a" });
  addR("hand3", 2.1, 0, 20, 0, { shirt: "#c4561a", pants: "#2c3e50", hat: "#2fa84f", skin: "#d9a77f" });
  addH("guard", 6.0, 0, 96.0, -Math.PI / 2, { shirt: "#2d3a4a", pants: "#2d3a4a", hat: "#2d3a4a", skin: "#b9805a" });
  addH("vp", 63, 0, 61, 0, { shirt: "#e9eef3", pants: "#1a1f2a", hat: null, skin: "#e0b48f" });
  humans.vp.root.setEnabled(false);

  // ================= WINDMILL (off location, west of the pad) =================
  const WX = -300, WZ = 80, WH = 34;
  b.defMat("wmwhite", "#eef0f2", { spec: 0.25 }); b.defMat("wmgrey", "#b8bdc3");
  {
    for (let i = 0; i < 14; i++) {                                           // tapered tower, built from stacked cones' worth of tubes
      const r0 = 1.5 - i * 0.07, r1 = 1.5 - (i + 1) * 0.07, y0 = i * (WH / 14), y1 = (i + 1) * (WH / 14);
      b.cyl("wmwhite", WX, (y0 + y1) / 2, WZ, r0 * 2, y1 - y0 + 0.02, { tess: 12, dia2: r1 * 2 });
    }
    b.cyl("wmgrey", WX, 0.4, WZ, 3.6, 0.8, { tess: 14 });                       // foundation
    b.slab("wmgrey", WX - 0.7, 0.8, WZ - 0.05, WX + 0.7, 2.6, WZ + 0.05);        // door
    b.blocker(WX - 1.7, 0, WZ - 1.7, WX + 1.7, 3, WZ + 1.7);
    b.slab("wmwhite", WX - 1.0, WH - 0.2, WZ - 2.4, WX + 1.0, WH + 1.5, WZ + 1.6);   // nacelle
    b.slab("wmgrey", WX - 0.4, WH + 1.5, WZ - 1.8, WX + 0.4, WH + 1.9, WZ + 0.2);    // anemometer mount
    b.cyl("black", WX, WH + 2.3, WZ - 1.5, 0.08, 0.9, { tess: 6 });
    b.box("red", WX, WH + 2.9, WZ - 1.5, 0.35, 0.08, 0.08);
  }
  const wmRotor = node("wmrotor", scene, WX, WH + 0.6, WZ + 1.75);
  {
    const hub = MeshBuilder.CreateSphere("wmhub", { diameter: 1.6, segments: 10 }, scene); hub.material = b.getMat("wmwhite"); hub.parent = wmRotor; hub.scaling.z = 1.4;
    for (let i = 0; i < 3; i++) {
      const arm = node("wmblade" + i, scene); arm.parent = wmRotor; arm.rotation.z = (i * Math.PI * 2) / 3;
      const bl = MeshBuilder.CreateBox("wmb", { width: 0.9, height: 17, depth: 0.12 }, scene); bl.material = b.getMat("wmwhite"); bl.parent = arm; bl.position.y = 9.4; bl.rotation.y = 0.18;
      const tip = MeshBuilder.CreateBox("wmt", { width: 0.5, height: 2.2, depth: 0.13 }, scene); tip.material = b.getMat("red"); tip.parent = arm; tip.position.y = 17.4; tip.rotation.y = 0.18;
    }
  }
  wmRotor.rotation.y = 0;
  let wmSpin = 2.1, wmTarget = 2.1;
  spots.windmill = v(WX + 3.4, 1.2, WZ + 2.4);
  b.label("WIND TURBINE 7\nMAIN BRAKE / DISCONNECT", WX + 1.76, 1.8, WZ + 2.0, 1.9, 0.7, 0, "#7a1a14", "#ffffff", 30);
  b.slab("steel", WX + 1.7, 0.9, WZ + 1.5, WX + 2.5, 1.9, WZ + 1.9);                 // brake cabinet
  b.slab("red", WX + 1.75, 1.45, WZ + 1.9, WX + 2.45, 1.65, WZ + 1.95);
  b.blocker(WX + 1.7, 0, WZ + 1.5, WX + 2.5, 1.9, WZ + 1.9);

  // ================= DEAD BIRDS: only around the windmill, thickest at its base =================
  {
    b.defMat("bird1", "#5a5048"); b.defMat("bird2", "#8a8f94"); b.defMat("bird3", "#2e2a28"); b.defMat("bird4", "#c9c2b0"); b.defMat("birdw", "#463e38"); b.defMat("birdfeet", "#d9a441");
    let sd = 4242; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const open = (x: number, z: number) => !b.colliders.some((c) => c.y1 > 0.25 && x > c.x0 - 0.5 && x < c.x1 + 0.5 && z > c.z0 - 0.5 && z < c.z1 + 0.5);
    const bird = (x: number, z: number) => {
      const body = ["bird1", "bird2", "bird3", "bird4"][(r() * 4) | 0], rot = r() * Math.PI * 2, y = 0.09;
      const dx = Math.sin(rot), dz = Math.cos(rot), px = Math.cos(rot), pz = -Math.sin(rot);
      b.box(body, x, y, z, 0.1, 0.07, 0.2, false, rot);                                 // body, belly up
      b.box(body, x + dx * 0.13, y, z + dz * 0.13, 0.06, 0.05, 0.07, false, rot);       // head
      for (const s of [-1, 1]) {
        b.box("birdw", x + px * s * 0.12, y - 0.01, z + pz * s * 0.12, 0.16, 0.015, 0.14, false, rot + s * 0.5);   // wings splayed
        b.box("birdfeet", x - px * s * 0.03 - dx * 0.02, y + 0.07, z - pz * s * 0.03 - dz * 0.02, 0.012, 0.09, 0.012, false, rot); // legs pointing at the sky
      }
    };
    let placed = 0, tries = 0;
    while (placed < 130 && tries++ < 2000) { const a = r() * Math.PI * 2, d = 3 + Math.pow(r(), 1.3) * 28; const x = WX + Math.cos(a) * d, z = WZ + Math.sin(a) * d; if (open(x, z)) { bird(x, z); placed++; } }
  }

  const merged = b.finish();

  // porta-john helpers
  const setPortaLocked = (locked: boolean) => {
    portaDoor.rotation.y = (locked ? 0 : -1.5) + RYAW;
    portaDoor.position.x = -((locked ? 28.6 : 29.2) + PJZ);
    portaDoor.position.z = (locked ? 14.17 : 13.75) + PJX;
    lockMat.emissiveColor = locked ? new Color3(1, 0.1, 0.1) : new Color3(0.1, 0.9, 0.2);
  };
  setPortaLocked(false);

  const heliState: Rig["heliState"] = { phase: "hidden", node: heli };

  // walker paths
  const huddleHold = { on: false };
  const walkers = [
    { h: humans.hand3, pts: [v(2.1, 0, 20), v(2.1, 0, 29.5)].map(rpos), i: 0, speed: 1.1 },
    { h: humans.hand1, pts: [v(-0.4, F, 2.9), v(-0.4, F, 4.6), v(0.4, F, 4.6), v(0.4, F, 2.9)].map(rpos), i: 0, speed: 0.8 },
  ];

  let tdY = F + 24;
  // the top drive and the travelling block are solid: boxes (world axes: the rig is turned, local x -> world z, local z -> world -x) that ride up and down with them
  const tdBox: AABB = { x0: -0.7, x1: 0.75, z0: -0.75, z1: 0.75, y0: 0, y1: 0 };
  const blockBox: AABB = { x0: -0.18, x1: 0.78, z0: -0.8, z1: 0.8, y0: 0, y1: 0 };
  b.colliders.push(tdBox, blockBox);
  const tmpQ = new Quaternion();
  let scrT = 0;
  const update = (dt: number, f: RigFrame) => {
    // top drive position follows hole depth within the current stand
    const into = ((f.depth - f.startDepth) % 93 + 93) % 93;
    const targetY = f.tripping
      ? F + 3 + (0.5 + 0.5 * Math.sin(f.t * 3)) * 22
      : f.connecting ? F + 26 : F + 2.6 + (1 - into / 93) * 24;
    tdY += (targetY - tdY) * Math.min(1, dt * (f.connecting || f.tripping ? 2.5 : 8));
    mudTex.uOffset += dt * 0.012; mudTex.vOffset += dt * 0.008;
    agiNodes.forEach((n, i) => { n.rotation.y += dt * (1.1 + i * 0.07); });
    td.position.y = tdY;
    { const inHole = f.connecting || f.tripping; slips.position.set(inHole ? 0 : 1.25, inHole ? F + 0.4 : F + 0.01, inHole ? 0 : -0.8); slips.rotation.y = inHole ? 0 : 0.7; }
    tdBox.y0 = tdY - 2.3; tdBox.y1 = tdY + 1.8; blockBox.y0 = tdY + 2.85; blockBox.y1 = tdY + 3.9;
    tdSpin.rotation.y += f.rotating ? dt * 5 : 0;
    rotMark.rotation.y += f.rotating ? dt * 5 : 0;
    const blockY = tdY + 3.1;
    const lineBot = tdY + 3.4, lineTop = MH + 1.6;
    cables.forEach((c) => { c.position.y = (lineTop + lineBot) / 2; c.scaling.y = lineTop - lineBot; });
    const stringBottom = F - 7.3;
    stringMesh.position.y = (tdY - 1.5 + stringBottom) / 2;
    stringMesh.scaling.y = tdY - 1.5 - stringBottom;
    stringMesh.position.z = -0.3 + 0.3;
    stringMesh.position.z = 0; stringMesh.position.x = 0;
    joint.position.set(0, F + 0.9, 0); joint.isVisible = f.connecting || f.tripping;
    // rotary hose from standpipe to gooseneck
    const a = v(2.7, F + 29, -3.2), c2 = v(0, tdY + 1.2, -0.3);
    hose = MeshBuilder.CreateTube("hose", { path: hosePath(a, c2), radius: 0.1, instance: hose } as any, scene) as typeof hose;
    wmSpin += (wmTarget - wmSpin) * Math.min(1, dt * (wmTarget ? 0.5 : 0.35));   // spins down slowly after the brake is pulled
    wmRotor.rotation.z += wmSpin * dt;
    // cabin monitors: live data, redrawn about three times a second and only when someone is near
    scrT -= dt; if (scrT <= 0 && f.near && f.screens) { scrT = 0.33; screens.update(f.screens); }
    tvT -= dt; if (tvT <= 0) { tvT = 0.5; if (f.screens) lastScr = f.screens; if (lastScr) tvScreens.update({ ...lastScr, t: f.t }); }
    // iron roughneck swings in on connection
    rough.rotation.y = f.connecting ? -0.6 : 0;
    // pipe racked in the derrick is the inverse of the depth: lots of pipe on the board when the string is out of the hole, almost none when it is deep
    const rackedBase = Math.round(48 * Math.max(0, 1 - f.depth / 8500));
    setStands(f.tripping ? Math.max(rackedBase, f.standsRacked) : rackedBase);
    // night lighting
    const e = 0.15 + f.night * 0.85;
    lampMat.emissiveColor.set(1 * e, 0.92 * e, 0.62 * e);
    const bm = b.getMat("beacon"); const blink = Math.sin(f.t * 4) > 0.2 ? 1 : 0.15; bm.emissiveColor.set(blink, 0.1 * blink, 0.05 * blink);
    // taking a kick (or circulating one out): gas to the flare, a flame five times taller
    flameK += ((f.kicking ? 5 : 1) - flameK) * Math.min(1, dt * 2.5);
    const fy = (0.8 + Math.random() * 0.5) * flameK, fw = (0.8 + Math.random() * 0.4) * (1 + (flameK - 1) * 0.12);
    flame.scaling.set(fw, fy, fw); flame.position.y = 18 + 1.5 * fy;
    flame.setEnabled(f.flaring || true);
    pumpjacks.forEach((p, i) => { p.rotation.x = Math.sin(f.t * 0.9 + i) * 0.16; });
    windsock.rotation.y = Math.sin(f.t * 0.1) * 0.5 + 2.2;
    windsock.rotation.z = Math.sin(f.t * 2.0) * 0.06;
    catUpdate(dt);
    // NPC idle & walkers
    for (const k in humans) if (!walkers.some((w) => w.h === humans[k])) humans[k].animate(dt, 0);   // walkers animate below (idle every frame would restart their clip)
    for (const w of walkers) {
      if (huddleHold.on) { w.h.animate(dt, 0); continue; }
      const tgt = w.pts[w.i], p = w.h.root.position;
      const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.15) w.i = (w.i + 1) % w.pts.length;
      else { p.x += (dx / d) * w.speed * dt; p.z += (dz / d) * w.speed * dt; pushOutXZ(b.colliders, p, p.y, 0.35); w.h.root.rotation.y = Math.atan2(dx, dz); w.h.animate(dt, w.speed * 2); }
    }
    // space shuttle: lands on the pad on its engines, waits, then climbs away on a column of fire
    if (shuttleState.phase !== "hidden") {
      let flame = 0;
      if (shuttleState.phase === "landing") {
        shuttleState.v = Math.min(55, 55 * Math.max(0.12, (shuttle.position.y - 0.17) / 110)); shuttle.position.y = Math.max(0.17, shuttle.position.y - shuttleState.v * dt);
        flame = Math.min(1, (shuttle.position.y - 0.17) / 20 + 0.35);
        if (shuttle.position.y <= 0.18) { shuttleState.phase = "landed"; }
      } else if (shuttleState.phase === "launching") {
        shuttleState.t += dt; shuttleState.v += 9 * dt; shuttle.position.y += shuttleState.v * dt; flame = 1;
        shuttle.rotation.z = Math.sin(shuttleState.t * 31) * 0.004 * Math.min(1, shuttleState.t);
        if (shuttle.position.y > 700) { shuttleState.phase = "hidden"; shuttle.setEnabled(false); }
      }
      flames.forEach((fl, i) => { const L = (i === 0 ? 28 : 24) * flame * (0.85 + Math.random() * 0.3); fl.scaling.set(1 + Math.random() * 0.12, Math.max(0.0001, L), 1 + Math.random() * 0.12); fl.position.y = -L / 2 + 0.6; });
    }
    // helicopter
    if (heliState.phase === "landing") {
      heli.position.y = Math.max(1.28, heli.position.y - dt * 12);
      heli.position.x += (63 - heli.position.x) * Math.min(1, dt * 0.8); heli.position.z += (61 - heli.position.z) * Math.min(1, dt * 0.8);
      if (heli.position.y <= 1.33) heliState.phase = "landed";
    } else if (heliState.phase === "leaving") {
      heli.position.y += dt * 14; heli.position.x += dt * 18;
      if (heli.position.y > 90) { heliState.phase = "hidden"; heli.setEnabled(false); }
    }
    if (heliState.phase !== "hidden") {
      const spin = heliState.phase === "landed" ? 9 : 34;
      heliRotor.rotation.y += dt * spin; heliTail.rotation.x += dt * spin * 1.6;
      (heliDisc.material as StandardMaterial).alpha = heliState.phase === "landed" ? 0.1 : 0.2;
      heli.rotation.z = heliState.phase === "landed" ? 0 : Math.sin(f.t * 1.3) * 0.04;
    }
    void f.pumpsOn;
  };

  // the "days since last incident" board on the outside of the safety trailer
  const dsTex = new DynamicTexture("daysSign", { width: 512, height: 160 }, scene, true);
  const dsMat = new StandardMaterial("daysSignM", scene); dsMat.diffuseTexture = dsTex; dsMat.emissiveTexture = dsTex; dsMat.specularColor = Color3.Black(); dsMat.disableLighting = true;
  const dsPlane = MeshBuilder.CreatePlane("daysSign", { width: 5.0, height: 1.56 }, scene); dsPlane.material = dsMat; dsPlane.isPickable = false;
  { const sp = rv(48.8 + SAFE_DX, 3.15, 34 + SAFE_DZ); dsPlane.position.copyFrom(sp); dsPlane.rotation.y = 0; }
  const setDaysSince = (n: number) => {
    const c = dsTex.getContext() as CanvasRenderingContext2D;
    c.fillStyle = "#101418"; c.fillRect(0, 0, 512, 160); c.strokeStyle = "#ffffff"; c.lineWidth = 8; c.strokeRect(6, 6, 500, 148);
    c.fillStyle = "#ffffff"; c.font = "bold 30px Arial"; c.textAlign = "center"; c.fillText("DAYS SINCE LAST INCIDENT", 256, 44);
    c.fillStyle = n === 0 ? "#ff5a3d" : "#7dff7d"; c.font = "bold 92px monospace"; c.fillText(String(n).padStart(3, "0"), 256, 132);
    dsTex.update();
  };
  setDaysSince(142);
  const huddle = { ...(() => { const p = rv(40 + CDX + SAFE_DX, 0.75, 24 + CDZ + SAFE_DZ); return { x: p.x, y: 0.75, z: p.z }; })(), exit: (() => { const p = rv(33.5 + CDX + SAFE_DX, 0, 24 + CDZ + SAFE_DZ); return { x: p.x, z: p.z }; })() };

  return {
    spots, colliders: b.colliders, roofs: b.roofs, merged, humans, update, setDaysSince, huddle, huddleHold, monitors: monitorList, catwalk: catCtl,
    setPortaLocked, setBump: (on) => { for (const d of dressed) d.mat.bumpTexture = on ? d.bump : null; }, setCasingTruck: (on) => { casingTruck.setEnabled(on); setTruckSolid(on); }, setWindmill: (on) => { wmTarget = on ? 2.1 : 0; },
    heliState, shuttleState, buildShuttle: () => shuttle, deerNode, windsock,
  };
}
