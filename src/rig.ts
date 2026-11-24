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
  tripFrac: number; standsRacked: number; night: number; t: number; pumpsOn: boolean; flaring: boolean;
  /** live data for the cabin monitors; `near` = the player is close enough for them to be worth redrawing */
  screens?: import("./screens").ScreenData; near?: boolean;
}

export interface Rig {
  spots: Record<string, Vector3>;
  colliders: AABB[];
  merged: Mesh[];
  humans: Record<string, Human>;
  update(dt: number, f: RigFrame): void;
  setPortaLocked(locked: boolean): void;
  setBump(on: boolean): void;
  setCasingTruck(on: boolean): void;
  /** the off-location windmill: spinning (true) or braked (false) */
  setWindmill(on: boolean): void;
  heliState: { phase: "hidden" | "landing" | "landed" | "leaving"; node: TransformNode };
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
    const s = 1 + Math.random() * 3;
    c.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  t.update();
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
  t.update(); t.uScale = 1; t.vScale = 1;
  return t;
}

export function buildRig(scene: Scene, opts: { bump?: boolean; kit?: Kit | null } = {}): Rig {
  const kit = opts.kit ?? null;
  const b = new Builder(scene);
  const spots: Record<string, Vector3> = {};

  // ---------- materials ----------
  const ground = new StandardMaterial("ground", scene);
  ground.diffuseTexture = noiseTex(scene, "#b59d78", ["#a58b66", "#c8b28c", "#8f7852", "#d6c4a0"], 5000, 256, 40);
  ground.specularColor = Color3.Black();
  const groundMesh = MeshBuilder.CreateGround("ground", { width: 900, height: 900 }, scene);
  groundMesh.material = ground; groundMesh.receiveShadows = true;

  const padMat = new StandardMaterial("pad", scene);
  padMat.diffuseTexture = noiseTex(scene, "#c9b48f", ["#bba57e", "#d8c8a6", "#a68f68", "#e1d3b4"], 4000, 256, 14);
  padMat.specularColor = Color3.Black();
  const pad = MeshBuilder.CreateGround("padmesh", { width: 120, height: 130 }, scene);
  pad.position.set(0, 0.04, 0); padMat.zOffset = -2; pad.material = padMat; pad.receiveShadows = true;

  const road = MeshBuilder.CreateGround("road", { width: 7, height: 300 }, scene);
  road.position.set(0, 0.08, 190);
  const rm = new StandardMaterial("roadm", scene);
  rm.diffuseTexture = noiseTex(scene, "#5a5650", ["#4a463f", "#6a665e", "#3d3a34"], 2500, 256, 8);
  rm.specularColor = Color3.Black(); rm.zOffset = -4; road.material = rm; road.receiveShadows = true;

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
  b.label("AL DRILLING\nRIG 107", 0, 3.0, 5.7, 3.2, 1.2, Math.PI, "#233a52", "#ffd24a", 64);
  b.slab("steel", -6.5, 0, -6, -5.7, 0.3, 6); b.slab("steel", 5.7, 0, -6, 6.5, 0.3, 6);

  // ---- BOP stack in the cellar zone below the rotary ----
  if (kit) {
    kit.place("bop", 0, 0, 0, RYAW);                                      // Blender BOP stack: flanges, bonnets, hydraulics, valves
    b.blocker(-0.9, 1.35, -0.75, 0.9, 2.65, 0.75);
  } else {
    b.cyl("steel", 0, 0.5, 0, 1.0, 1.0, { tess: 14 });              // wellhead / casing head
    b.cyl("black", 0, 1.15, 0, 1.3, 0.3, { tess: 14 });             // flange
    b.box("bopblue", 0, 2.0, 0, 1.8, 1.3, 1.5, true);               // double ram body
    b.box("bopred", 0, 2.0, 1.05, 1.0, 0.7, 0.6); b.box("bopred", 0, 2.0, -1.05, 1.0, 0.7, 0.6);
    b.box("bopred", 1.2, 2.0, 0, 0.6, 0.7, 1.0); b.box("bopred", -1.2, 2.0, 0, 0.6, 0.7, 1.0);
    b.cyl("black", 0, 2.95, 0, 1.3, 0.3, { tess: 14 });
    b.box("bopblue", 0, 3.6, 0, 1.6, 0.9, 1.4);
    b.box("bopred", 1.0, 3.6, 0, 0.5, 0.6, 0.9); b.box("bopred", -1.0, 3.6, 0, 0.5, 0.6, 0.9);
    b.cyl("black", 0, 4.2, 0, 1.3, 0.3, { tess: 14 });
    b.cyl("bopred", 0, 5.1, 0, 1.5, 1.4, { tess: 16, dia2: 1.2 });  // annular
    b.cyl("steel", 0, 6.35, 0, 0.9, 1.4, { tess: 12 });             // bell nipple
  }
  // flowline to shakers
  b.beam("steel", v(0, 6.0, 0), v(0, 6.0, -8), 0.5); b.beam("steel", v(0, 6.0, -8), v(0, 3.4, -19), 0.5);
  b.beam("steel", v(0, 3.4, -19), v(-13.5, 3.3, -19.5), 0.5);

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
    const seg = MeshBuilder.CreateBox("slipseg", { width: 0.16, height: 0.34, depth: 0.075 }, scene);
    seg.material = b.getMat("dsteel"); seg.parent = slips; seg.position.set(sx * 0.135, 0.17, sz * 0.135); seg.rotation.y = a;
    const teeth = MeshBuilder.CreateBox("slipteeth", { width: 0.13, height: 0.24, depth: 0.012 }, scene);
    teeth.material = b.getMat("steel"); teeth.parent = slips; teeth.position.set(sx * 0.098, 0.15, sz * 0.098); teeth.rotation.y = a;
    const post = MeshBuilder.CreateBox("slipposts", { width: 0.03, height: 0.22, depth: 0.03 }, scene);
    post.material = b.getMat("yellow"); post.parent = slips; post.position.set(sx * 0.19, 0.42, sz * 0.19);
    const grip = MeshBuilder.CreateBox("slipgrip", { width: 0.13, height: 0.03, depth: 0.03 }, scene);
    grip.material = b.getMat("yellow"); grip.parent = slips; grip.position.set(sx * 0.19, 0.54, sz * 0.19); grip.rotation.y = a + Math.PI / 2;
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
  b.stairs("dsteel", "yellow", -FX, -0.9, "-x", F, 1.5, 0.26, 0.3, 2.78);
  {
    const LX0 = -15.4, LX1 = -12.2, LZ0 = -2.4, LZ1 = 0.6;
    b.slab("deck", LX0, 2.58, LZ0, LX1, 2.78, LZ1, true);                                              // landing
    for (const [px, pz] of [[LX0 + 0.12, LZ0 + 0.12], [LX1 - 0.12, LZ0 + 0.12], [LX0 + 0.12, LZ1 - 0.12], [LX1 - 0.12, LZ1 - 0.12]]) b.slab("dsteel", px - 0.1, 0, pz - 0.1, px + 0.1, 2.58, pz + 0.1);
    b.rail("yellow", LX1, LZ1, LX0 + 0.0, LZ1, 2.78, 1.1);                                              // south side, solid
    b.rail("yellow", LX1, LZ0, -13.05, LZ0, 2.78, 1.1); b.rail("yellow", -14.55, LZ0, LX0, LZ0, 2.78, 1.1);   // north side, open where flight B starts
    b.rail("yellow", LX0, LZ0, LX0, -1.65, 2.78, 1.1); b.rail("yellow", LX0, -0.15, LX0, LZ1, 2.78, 1.1);   // far end, open where the bridge starts
    b.stairs("dsteel", "yellow", -13.8, LZ0, "-z", 2.78, 1.5);                                          // flight B: landing to the ground
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
  const monitor = (face: "+x" | "-x", cx: number, cy: number, cz: number, w: number, h: number, kind: ScreenKind, scr: Screens = screens) => {
    const key = "scr" + scrN++, tex = scr.make(kind, false);
    tex.wAng = Math.PI / 2;   // the box side faces map the canvas turned a quarter turn
    const m = b.defMat(key, "#000000"); m.emissiveTexture = tex; m.diffuseTexture = tex; m.diffuseColor.set(0.4, 0.4, 0.4); m.emissiveColor.set(0.85, 0.85, 0.85); m.specularColor.set(0, 0, 0);
    b.slab("black", cx - 0.04, cy - h / 2 - 0.03, cz - w / 2 - 0.03, cx + 0.04, cy + h / 2 + 0.03, cz + w / 2 + 0.03);
    if (face === "+x") b.slab(key, cx + 0.04, cy - h / 2, cz - w / 2, cx + 0.05, cy + h / 2, cz + w / 2);
    else b.slab(key, cx - 0.05, cy - h / 2, cz - w / 2, cx - 0.04, cy + h / 2, cz + w / 2);
    b.slab("dsteel", cx - 0.03, cy - h / 2 - 0.2, cz - 0.04, cx + 0.03, cy - h / 2 - 0.03, cz + 0.04);   // stand
  };
  // ---- driller's desk on the west glass: four live monitors low enough to see the rotary over, plus overhead displays ----
  b.slab("dsteel", 2.8, F, -5.0, 3.6, F + 0.95, -1.4, true);
  b.slab("steel", 2.8, F + 0.95, -5.0, 3.6, F + 0.99, -1.4);
  (["params", "trends", "pits", "alarms"] as ScreenKind[]).forEach((k, i) => monitor("+x", 3.25, F + 1.32, -4.5 + i * 0.95, 0.85, 0.54, k));
  (["pumps", "hookload", "steer"] as ScreenKind[]).forEach((k, i) => monitor("+x", 3.0, F + 2.35, -4.3 + i * 1.3, 0.85, 0.52, k));
  for (let i = 0; i < 4; i++) { b.slab("black", 3.55, F + 0.99, -4.7 + i * 0.95, 3.85, F + 1.03, -4.2 + i * 0.95); }   // keyboards / panels
  // driller's chair at (4.5, -3.2) facing west: joystick arms, throttle and brake
  b.cyl("black", 4.5, F + 0.25, -3.2, 0.14, 0.5, { tess: 8 }); b.slab("black", 4.1, F, -3.6, 4.9, F + 0.07, -2.8);
  b.slab("black", 4.2, F + 0.5, -3.5, 4.8, F + 0.6, -2.9); b.slab("black", 4.75, F + 0.6, -3.5, 4.85, F + 1.4, -2.9);
  b.slab("dsteel", 3.95, F + 0.75, -3.62, 4.4, F + 0.82, -3.5); b.slab("dsteel", 3.95, F + 0.75, -2.9, 4.4, F + 0.82, -2.78);
  b.cyl("steel", 4.0, F + 0.95, -3.56, 0.04, 0.25, { tess: 6 }); b.cyl("red", 4.0, F + 1.1, -3.56, 0.07, 0.07, { tess: 8 }); b.cyl("steel", 4.0, F + 0.95, -2.84, 0.04, 0.25, { tess: 6 });
  spots.cabin = v(3.7, F + 1.3, -3.2);
  // ---- directional driller / MWD desk along the east wall: they face east, back to the driller ----
  b.slab("dsteel", 6.0, F, -5.7, 6.8, F + 0.95, -1.6, true);
  b.slab("steel", 6.0, F + 0.95, -5.7, 6.8, F + 0.99, -1.6);
  ([["survey", -5.2], ["toolface", -4.45], ["gamma", -3.7], ["mwd", -2.95]] as [ScreenKind, number][]).forEach(([k, z]) => monitor("-x", 6.45, F + 1.32, z, 0.7, 0.5, k));
  ([["plan", -4.8], ["steer", -3.3]] as [ScreenKind, number][]).forEach(([k, z]) => monitor("-x", 6.6, F + 2.1, z, 0.9, 0.5, k));
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
  b.room({ x0: -6.0, z0: -5.8, x1: -2.6, z1: -2.4, y0: F, h: 2.6, wall: "tan", roof: "dsteel", floor: "dsteel",
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
  b.blocker(-2.9, F, 2.55, -0.7, F + 2.2, 5.85); b.blocker(0.7, F, 2.55, 2.9, F + 2.2, 5.85);              // racked stands: not walkable
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
  standSlots.forEach((p, i) => { standBase.thinInstanceAdd(Matrix.Identity()); void p; void i; });
  let shownStands = -1;
  const setStands = (n: number) => {
    n = Math.max(0, Math.min(standSlots.length, Math.round(n)));
    if (n === shownStands) return;
    shownStands = n;
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
  // drawworks housing under the doghouse side + cable reels (visual)
  b.cyl("dsteel", -0.2, F + 0.9, -4.8, 1.8, 1.4, { axis: "x", tess: 14 });
  b.cyl("steel", -0.2, F + 0.9, -4.8, 1.2, 1.5, { axis: "x", tess: 10 });
  b.slab("dsteel", -1.3, F, -5.6, 0.9, F + 0.35, -3.9);
  spots.drawworks = v(-0.2, F + 1.4, -3.6);
  // drum flanges + spooled line, the fast line up to the crown, and the dead line to its anchor
  for (const x of [-1.0, 0.6]) b.cyl("steel", x, F + 0.9, -4.8, 2.3, 0.1, { axis: "x", tess: 18 });
  b.cyl("pipe", -0.2, F + 0.9, -4.8, 1.55, 1.5, { axis: "x", tess: 16 });
  b.beam("dsteel", v(-1.1, F + 1.75, -4.8), v(-1.15, MH + 1.6, -0.7), 0.05);               // fast line
  b.cyl("dsteel", 1.0, F + 0.3, -2.4, 0.5, 0.6, { tess: 10 }); b.slab("red", 0.8, F + 0.5, -2.6, 1.2, F + 0.62, -2.2);   // deadline anchor / weight indicator
  b.beam("dsteel", v(1.0, F + 0.6, -2.4), v(0.82, MH + 1.6, -0.7), 0.05);                  // dead line

  // ---- dynamic: top drive, block, cables, string, hose ----
  const td = node("topdrive", scene, 0, F + 20, -0.3); td.parent = rigRoot;
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
  const hose = MeshBuilder.CreateCylinder("hose", { diameter: 0.2, height: 1, tessellation: 6 }, scene);
  hose.material = b.getMat("black"); hose.parent = rigRoot;
  // drill pipe tool-joint ring that shows on the string
  const joint = MeshBuilder.CreateCylinder("tj", { diameter: 0.27, height: 0.4, tessellation: 8 }, scene);
  joint.material = b.getMat("pipeband"); joint.parent = rigRoot;

  // ================= PIPE RACKS + CATWALK =================
  const pipePos: Vector3[] = [];
  for (const sx of [-1, 1]) {
    const rx = sx * 6.5;
    for (const z of [19, 26, 33]) b.slab("rust", rx - 3.3, 0, z - 0.2, rx + 3.3, 0.5, z + 0.2);
    // end stanchions that keep the stack from rolling off
    for (const ex of [-3.3, 3.3]) for (const z of [19, 26, 33]) b.slab("rust", rx + ex - 0.06, 0, z - 0.1, rx + ex + 0.06, 2.0, z + 0.1);
    // drill pipe, hex-packed (pitch ~ diameter) and parallel to the catwalk
    const D = 0.27, PITCH = 0.285;
    for (let layer = 0; layer < 6; layer++) {
      const n = 22 - layer;
      for (let i = 0; i < n; i++) {
        const x = rx - ((22 - 1) * PITCH) / 2 + i * PITCH + layer * (PITCH / 2), y = 0.5 + D / 2 + layer * PITCH * 0.866;
        if (kit) pipePos.push(rpos(v(x, y, 26.0)));
        else {
          b.cyl("pipe", x, y, 26.0, D, 15.2, { axis: "z", tess: 6 });
          b.cyl("pipeband", x, y, 18.7, D + 0.02, 0.4, { axis: "z", tess: 6 });
          b.cyl("pipeband", x, y, 33.3, D + 0.02, 0.4, { axis: "z", tess: 6 });
        }
      }
    }
    // solid so nobody walks through the stack
    b.blocker(rx - 3.35, 0, 18.3, rx + 3.35, 2.0, 33.7);
  }
  kit?.instances(["pipe_pipe", "band_band"], pipePos, false, RYAW);
  b.slab("dsteel", -0.9, 0, 18, 0.9, 0.9, 34, true);
  b.slab("deck", -0.7, 0.9, 18, 0.7, 0.95, 34);
  b.cyl("pipe", 0, 1.15, 28, 0.24, 9.6, { axis: "z", tess: 6 });
  spots.tally = v(0, 1.8, 24);
  b.label("PIPE RACKS", 0, 3.2, 35, 3.2, 0.8, 0, "#233a52", "#ffd24a", 80);
  b.rot = 0;
  for (const k of ["cabin", "doghouse", "coffee", "board", "geronimo", "floorSetback", "drawworks", "tally"]) spots[k] = rpos(spots[k]);

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
  const tanks = [[-18, -9], [-9, 0], [0, 9], [9, 18]];
  tanks.forEach(([x0, x1], i) => {
    b.slab("tank", x0 + 0.05, 0.4, -26, x1 - 0.05, 2.7, -19.6, true);          // solid tank body (walkable roof is the deck below)
    b.slab("dsteel", x0 + 0.05, 2.7, -26, x1 - 0.05, 2.78, -19.6, true);
    b.slab("steel", x0 + 0.05, 0, -26, x1 - 0.05, 0.4, -19.6);
    if (x0 === 0) b.rail("yellow", x0 + 1.8, -19.7, x1 - 0.05, -19.7, 2.78, 1.1);                  // open where the rig bridge lands
    else b.rail("yellow", x0 + 0.05, -19.7, x1 - 0.05, -19.7, 2.78, 1.1);
    b.rail("yellow", x0 + 0.05, -25.9, x1 - 0.05, -25.9, 2.78, 1.1);
    b.cyl("steel", (x0 + x1) / 2, 3.5, -22.8, 0.2, 1.4, { tess: 6 });          // agitator shaft
    b.box("bopblue", (x0 + x1) / 2, 4.3, -22.8, 0.7, 0.5, 0.5);
    b.blocker((x0 + x1) / 2 - 0.4, 2.78, -23.2, (x0 + x1) / 2 + 0.4, 4.6, -22.4);   // agitator only, not the whole roof
    void i;
  });
  // tank-roof stairs at east end
  b.stairs("dsteel", "yellow", 18.0, -22.8, "+x", 2.78, 1.1, 0.25, 0.3);
  b.rail("yellow", -17.95, -25.9, -17.95, -19.7, 2.78, 1.1);   // west end of the pit roof
  b.label("ACTIVE PITS", 0, 1.8, -19.5, 3.0, 0.7, Math.PI, "#233a52", "#ffd24a", 70);
  // shale shakers on tank 1
  for (let i = 0; i < 3; i++) {
    const x = -16.6 + i * 2.5;
    b.slab("dsteel", x - 1.0, 2.78, -24.5, x + 1.0, 3.3, -21.0, true);
    b.slab("steel", x - 0.9, 3.3, -24.3, x + 0.9, 3.5, -21.2);
    b.slab("green", x - 0.8, 3.5, -24.2, x + 0.8, 3.58, -21.3);
  }
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
    const CP = 0.22, pts = [v(-1.5, 2.0, 0), v(-4.2, 2.0, 0), v(-4.2, 1.0, 0), v(-4.2, 1.0, -8.6), v(-8.0, 1.0, -8.6), v(-8.0, 1.0, -9.4)];
    for (let i = 0; i < pts.length - 1; i++) b.beam("steel", pts[i], pts[i + 1], CP);
    for (const p of pts.slice(1, -1)) b.sphere("steel", p.x, p.y, p.z, 0.3);
    b.box("bopred", -2.0, 2.0, 0, 0.55, 0.5, 0.5); b.cyl("bopblue", -2.0, 2.5, 0, 0.3, 0.6, { tess: 10 }); b.label("HCR", -2.0, 3.0, 0, 0.5, 0.22, Math.PI, "#7a1a14", "#ffffff", 40);   // HCR valve + hydraulic actuator
    b.box("steel", -3.1, 2.0, 0, 0.4, 0.4, 0.4); b.cyl("red", -3.1, 2.35, 0, 0.4, 0.05, { tess: 14 });                                              // manual gate valve
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
  }
  spots.bop = v(-5.2, 2.5, 0);

  // ================= CAMP: trailers =================
  // company man trailer (enterable)
  const CDX = 12, CDZ = 10;   // trailers sit toward the corner of the pad
  b.rot = RYAW;   // the camp turns a quarter turn about the rig, same direction as the rig
  b.at(CDX, CDZ, () => {
  b.room({ x0: 30, z0: 8, x1: 33.6, z1: 20, y0: 0.8, h: 2.7, wall: "trailer", roof: "dsteel", floor: "dsteel",
    door: { side: "-x", c: 14, w: 1.1 } });
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
  pdc(29.3, 0.8, 12.9, 0.3); pdc(29.3, 0.8, 15.0, 1.1); pdc(28.5, 0.8, 14.0, 2.0);
  // two big TVs on the east wall: the EDR and the news
  monitor("-x", 33.46, 0.8 + 1.5, 11.6, 1.5, 0.85, "edr", tvScreens);
  monitor("-x", 33.46, 0.8 + 1.5, 15.0, 1.5, 0.85, "news", tvScreens);
  b.slab("wood", 31.9, 0.8, 8.4, 33.4, 1.55, 10.6, true);             // desk
  b.slab("black", 32.4, 1.55, 8.5, 33.2, 2.1, 8.8); b.slab("screen", 32.45, 1.6, 8.8, 33.15, 2.05, 8.84);
  b.slab("steel", 30.2, 0.8, 17.2, 31.6, 1.3, 19.8, true);            // bunk
  b.slab("white", 30.25, 1.3, 17.25, 31.55, 1.45, 19.75);
  b.slab("black", 30.15, 1.7, 12.0, 30.3, 2.1, 12.4);                 // wall phone box
  b.slab("red", 30.17, 1.8, 12.05, 30.25, 1.95, 12.35);
  spots.desk = rv(32.7 + CDX, 2.0, 9.1 + CDZ);
  spots.bunk = rv(30.9 + CDX, 1.6, 18.4 + CDZ);
  spots.phone = rv(30.4 + CDX, 1.9, 12.2 + CDZ);
  // toolpusher trailer (solid)
  if (kit) { kit.place("trailer", -(30 + CDZ), 0, 31.8 + CDX, RYAW); b.blocker(29.9, 0, 24, 33.7, 3.6, 36); }
  else { b.slab("trailer", 30, 0.7, 24, 33.6, 3.6, 36, true); b.slab("steel", 29.9, 0, 24, 33.7, 0.7, 36, true); }
  b.label("TOOLPUSHER", 29.85, 3.9, 30, 3.4, 0.6, -Math.PI / 2, "#233a52", "#ffd24a", 56);
  // mudlogger unit (enterable)
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
  spots.mudlog = rv(49.6 - 12, 1.5, 22.2 - 10);
  b.label("MUD LOGGING\nLOCKED • KNOCK", 38.55, 3.1, 8.6, 2.0, 0.7, -Math.PI / 2, "#233a52", "#ffd24a", 40);
  b.label("NO ADMITTANCE\nSAMPLES IN PROGRESS", 38.55, 3.1, 14.6, 1.6, 0.6, -Math.PI / 2, "#7a1a14", "#ffffff", 34);
  // safety/change room + water frac tanks
  b.slab("trailer", 37, 0.7, 20, 43, 3.4, 28, true); b.label("SAFETY", 36.85, 3.8, 24, 2.4, 0.6, -Math.PI / 2, "#1d5a30", "#ffffff", 64);
  });
  b.rot = 0;
  for (let i = 0; i < 2; i++) b.slab("tank", 38 + i * 4.2, 0.5, -34, 41.7 + i * 4.2, 3.2, -26, true);
  // porta johns
  const PJX = 36.8, PJZ = -14;   // porta johns sit next to the trailers
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
    b.slab("green", 43, 0.02, 40, 49, 0.05, 44);
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
  b.beam("dsteel", v(-60, 1.4, 62), v(-8, 1.4, 62), 0.04); b.beam("dsteel", v(8, 1.4, 62), v(60, 1.4, 62), 0.04);
  b.beam("dsteel", v(-60, 1.4, -66), v(60, 1.4, -66), 0.04);

  // light towers
  for (const [x, z] of [[-28, 32], [28, 46], [-30, -34], [30, -38], [-12, 62]]) {
    if (kit) { kit.place("lighttower", x, 0, z, Math.atan2(-x, -z) + Math.PI / 2); b.blocker(x - 0.5, 0, z - 0.5, x + 0.5, 2.0, z + 0.5); }
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
  // distant mesas
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2 + 0.3, r = 420;
    const w = 90 + rnd() * 120, h = 14 + rnd() * 26;
    const mesa = MeshBuilder.CreateBox("mesa", { width: w, height: h, depth: 70 }, scene);
    const mm = new StandardMaterial("mesam", scene); mm.diffuseColor = Color3.FromHexString("#a07a58"); mm.specularColor = Color3.Black();
    mesa.material = mm; mesa.position.set(Math.cos(ang) * r, h / 2, Math.sin(ang) * r); mesa.rotation.y = -ang; mesa.freezeWorldMatrix();
  }

  // helicopter (for the VP of Operations)
  const heli = node("heli", scene, 70, 80, 60);
  {
    const body = MeshBuilder.CreateSphere("hb", { diameter: 2.4, segments: 8 }, scene);
    body.scaling.set(1, 0.9, 1.8); body.material = b.getMat("white"); body.parent = heli;
    const tail = MeshBuilder.CreateBox("ht", { width: 0.2, height: 0.3, depth: 3.6 }, scene);
    tail.material = b.getMat("white"); tail.parent = heli; tail.position.z = -3.2;
    const rotor = MeshBuilder.CreateBox("hr", { width: 9, height: 0.05, depth: 0.25 }, scene);
    rotor.material = b.getMat("black"); rotor.parent = heli; rotor.position.y = 1.2; rotor.name = "rotor";
    const sk = MeshBuilder.CreateBox("sk", { width: 1.8, height: 0.08, depth: 3 }, scene);
    sk.material = b.getMat("dsteel"); sk.parent = heli; sk.position.y = -1.2;
  }
  heli.setEnabled(false);
  b.slab("dsteel", 56, 0.0, 54, 70, 0.06, 68);
  b.cyl("yellow", 63, 0.07, 61, 8, 0.02, { tess: 24 });
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
  addR("hand3", 2.1, 0, 20, 0, { shirt: "#c4561a", pants: "#2c3e50", hat: "#e8b923", skin: "#d9a77f" });
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
  const walkers = [
    { h: humans.hand3, pts: [v(2.1, 0, 20), v(2.1, 0, 36), v(-2.1, 0, 36), v(-2.1, 0, 20), v(-2.1, 0, 36), v(2.1, 0, 36)].map(rpos), i: 0, speed: 1.1 },
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
    const dir = c2.subtract(a), len = dir.length();
    hose.position.copyFrom(a.add(c2).scale(0.5)); hose.scaling.y = len;
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir.scale(1 / len), tmpQ); hose.rotationQuaternion = tmpQ.clone();
    wmSpin += (wmTarget - wmSpin) * Math.min(1, dt * (wmTarget ? 0.5 : 0.35));   // spins down slowly after the brake is pulled
    wmRotor.rotation.z += wmSpin * dt;
    // cabin monitors: live data, redrawn about three times a second and only when someone is near
    scrT -= dt; if (scrT <= 0 && f.near && f.screens) { scrT = 0.33; screens.update(f.screens); }
    tvT -= dt; if (tvT <= 0) { tvT = 0.5; if (f.screens) lastScr = f.screens; if (lastScr) tvScreens.update({ ...lastScr, t: f.t }); }
    // iron roughneck swings in on connection
    rough.rotation.y = f.connecting ? -0.6 : 0;
    setStands(f.tripping ? f.standsRacked : 40 + Math.min(0, 0));
    // night lighting
    const e = 0.15 + f.night * 0.85;
    lampMat.emissiveColor.set(1 * e, 0.92 * e, 0.62 * e);
    const bm = b.getMat("beacon"); const blink = Math.sin(f.t * 4) > 0.2 ? 1 : 0.15; bm.emissiveColor.set(blink, 0.1 * blink, 0.05 * blink);
    flame.scaling.set(0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.5, 0.8 + Math.random() * 0.4);
    flame.setEnabled(f.flaring || true);
    pumpjacks.forEach((p, i) => { p.rotation.x = Math.sin(f.t * 0.9 + i) * 0.16; });
    windsock.rotation.y = Math.sin(f.t * 0.1) * 0.5 + 2.2;
    windsock.rotation.z = Math.sin(f.t * 2.0) * 0.06;
    // NPC idle & walkers
    for (const k in humans) if (!walkers.some((w) => w.h === humans[k])) humans[k].animate(dt, 0);   // walkers animate below (idle every frame would restart their clip)
    for (const w of walkers) {
      const tgt = w.pts[w.i], p = w.h.root.position;
      const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.15) w.i = (w.i + 1) % w.pts.length;
      else { p.x += (dx / d) * w.speed * dt; p.z += (dz / d) * w.speed * dt; pushOutXZ(b.colliders, p, p.y, 0.35); w.h.root.rotation.y = Math.atan2(dx, dz); w.h.animate(dt, w.speed * 2); }
    }
    // helicopter
    if (heliState.phase === "landing") {
      heli.position.y = Math.max(0.7, heli.position.y - dt * 12);
      heli.position.x += (63 - heli.position.x) * Math.min(1, dt * 0.8); heli.position.z += (61 - heli.position.z) * Math.min(1, dt * 0.8);
      if (heli.position.y <= 0.75) heliState.phase = "landed";
    } else if (heliState.phase === "leaving") {
      heli.position.y += dt * 14; heli.position.x += dt * 18;
      if (heli.position.y > 90) { heliState.phase = "hidden"; heli.setEnabled(false); }
    }
    if (heliState.phase !== "hidden") {
      const rotor = heli.getChildMeshes().find((m) => m.name === "rotor");
      if (rotor) rotor.rotation.y += dt * (heliState.phase === "landed" ? 6 : 30);
    }
    void f.pumpsOn;
  };

  return {
    spots, colliders: b.colliders, merged, humans, update,
    setPortaLocked, setBump: (on) => { for (const d of dressed) d.mat.bumpTexture = on ? d.bump : null; }, setCasingTruck: (on) => { casingTruck.setEnabled(on); setTruckSolid(on); }, setWindmill: (on) => { wmTarget = on ? 2.1 : 0; },
    heliState, deerNode, windsock,
  };
}
