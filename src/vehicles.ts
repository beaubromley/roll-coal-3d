import { Scene, MeshBuilder, StandardMaterial, Color3, TransformNode, Mesh, Vector3, ShadowGenerator } from "@babylonjs/core";
import type { AABB } from "./builder";
import { pushOutXZ } from "./builder";
import type { Player } from "./player";
import type { Game } from "./game";
import { F } from "./rig";

/**
 * Drivable things, GTA-style: walk up, press E, drive. E again to get out.
 *   F250 (lifted)  W/S gas+brake, A/D steer, Space handbrake, Shift boost
 *   Forklift       W/S, A/D, R/F raise / lower forks
 *   Manlift        W/S, A/D, R/F raise / lower the basket (can reach the drill floor)
 *   Driller's chair  W/S weight on bit, A/D pump rate, T autodriller
 * Camera: V switches chase / first person, mouse looks around.
 */

const FB = F + 25;
const mats = new Map<string, StandardMaterial>();
function mat(scene: Scene, hex: string, o: { emissive?: number; alpha?: number; spec?: number } = {}) {
  const key = hex + (o.emissive ?? "") + (o.alpha ?? "");
  let m = mats.get(key);
  if (!m) {
    m = new StandardMaterial("v" + key, scene);
    m.diffuseColor = Color3.FromHexString(hex);
    m.specularColor = new Color3(o.spec ?? 0.18, o.spec ?? 0.18, o.spec ?? 0.18);
    if (o.emissive) m.emissiveColor = Color3.FromHexString(hex).scale(o.emissive);
    if (o.alpha !== undefined) m.alpha = o.alpha;
    mats.set(key, m);
  }
  return m;
}

type Kind = "car" | "forklift" | "lift";

interface Veh {
  id: string; name: string; kind: Kind; root: TransformNode;
  x: number; z: number; yaw: number; speed: number; steer: number;
  wheelbase: number; maxFwd: number; maxRev: number; accel: number; radius: number; pts: number[];
  eye: { x: number; y: number; z: number }; camDist: number; camHeight: number;
  steerNodes: TransformNode[]; steerSign: number[]; spinNodes: TransformNode[]; wheelR: number[];
  boxes: AABB[]; boxH: number; solid: boolean;
  lift: number;                       // 0..1 for forks / basket
  liftNode?: TransformNode; scissor?: { a: TransformNode[]; b: TransformNode[]; L: number; platform: TransformNode };
  casters: Mesh[]; controls: string; platformY: number;
}

export class Vehicles {
  list: Veh[] = [];
  active: Veh | null = null;
  private world: AABB[];
  private hud: HTMLElement;
  private wasThird = true;
  private chair = { on: false, hidden: false };
  private chairPos: Vector3;
  private keyOff: (() => void)[] = [];
  private pressed = new Set<string>();
  private dmgCd = 0;
  private climb = { on: false, y: 0 };

  constructor(private scene: Scene, private colliders: AABB[], private player: Player, private game: Game) {
    this.world = colliders.slice();            // static world only (vehicles don't collide with their own boxes)
    this.chairPos = new Vector3(4.75, F + 0.5, -3.25);
    this.hud = document.createElement("div");
    this.hud.style.cssText = "position:fixed;top:96px;left:50%;transform:translateX(-50%);z-index:30;display:none;padding:8px 16px;background:rgba(10,16,24,.78);border:2px solid #f4c04a;color:#fff;font:700 13px/1.45 system-ui,sans-serif;letter-spacing:.5px;text-align:center;pointer-events:none;text-transform:none;white-space:pre;max-width:96vw";
    document.body.appendChild(this.hud);
    const down = (e: KeyboardEvent) => { this.pressed.add(e.code); if (this.riding && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault(); if (e.code === "KeyT" && this.chair.on && !e.repeat) this.toggleAuto(); };
    const up = (e: KeyboardEvent) => this.pressed.delete(e.code);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", () => this.pressed.clear());
    this.build();
  }

  get riding() { return !!this.active || this.chair.on || this.climb.on; }
  private k(...codes: string[]) { return codes.some((c) => this.pressed.has(c)); }

  setShadow(sg: ShadowGenerator) { for (const v of this.list) v.casters.forEach((m) => sg.addShadowCaster(m)); }

  // ---------------------------------------------------------------------------------------------- building
  private mk(v: Veh, m: Mesh, hex: string, parent: TransformNode, x: number, y: number, z: number, o: { emissive?: number; alpha?: number; spec?: number } = {}) {
    m.material = mat(this.scene, hex, o); m.parent = parent; m.position.set(x, y, z); v.casters.push(m); return m;
  }
  private box(v: Veh, p: TransformNode, hex: string, w: number, h: number, d: number, x: number, y: number, z: number, o = {}) {
    return this.mk(v, MeshBuilder.CreateBox("vb", { width: w, height: h, depth: d }, this.scene), hex, p, x, y, z, o);
  }
  private cyl(v: Veh, p: TransformNode, hex: string, dia: number, h: number, x: number, y: number, z: number, axis: "x" | "y" | "z" = "y", tess = 14, o = {}) {
    const c = this.mk(v, MeshBuilder.CreateCylinder("vc", { diameter: dia, height: h, tessellation: tess }, this.scene), hex, p, x, y, z, o);
    if (axis === "x") c.rotation.z = Math.PI / 2; else if (axis === "z") c.rotation.x = Math.PI / 2;
    return c;
  }
  private wheel(v: Veh, p: TransformNode, x: number, y: number, z: number, dia: number, width: number, steer: number | null, rim = "#9aa0a8") {
    const st = new TransformNode("steer", this.scene); st.parent = p; st.position.set(x, y, z);
    const sp = new TransformNode("spin", this.scene); sp.parent = st;
    this.cyl(v, sp, "#0d0d0f", dia, width, 0, 0, 0, "x", 18);
    this.cyl(v, sp, rim, dia * 0.58, width + 0.03, 0, 0, 0, "x", 12, { spec: 0.5 });
    this.cyl(v, sp, "#2a2d31", dia * 0.2, width + 0.06, 0, 0, 0, "x", 8);
    // lug marks so you can see it roll
    for (let i = 0; i < 4; i++) { const t = this.box(v, sp, "#3a3d42", width + 0.05, dia * 0.07, dia * 0.5, 0, 0, 0); t.rotation.x = (i * Math.PI) / 4; }
    v.spinNodes.push(sp); v.wheelR.push(dia / 2);
    if (steer !== null) { v.steerNodes.push(st); v.steerSign.push(steer); }
  }
  private blank(id: string, name: string, kind: Kind, x: number, z: number, yaw: number): Veh {
    const root = new TransformNode(id, this.scene); root.position.set(x, 0, z); root.rotation.y = yaw;
    return { id, name, kind, root, x, z, yaw, speed: 0, steer: 0, wheelbase: 3, maxFwd: 10, maxRev: 4, accel: 5, radius: 1, pts: [0],
      eye: { x: 0, y: 1.6, z: 0 }, camDist: 7, camHeight: 2.6, steerNodes: [], steerSign: [], spinNodes: [], wheelR: [], boxes: [], boxH: 2.5, solid: true,
      lift: 0, casters: [], controls: "", platformY: 0 };
  }

  private build() {
    this.list.push(this.buildF250(22, 22.8, Math.PI));
    this.list.push(this.buildForklift(14, 44, -0.6));
    this.list.push(this.buildManlift(-7, 13, 0.4));
    for (const v of this.list) {
      for (let i = 0; i < v.pts.length; i++) { const b: AABB = { x0: 0, x1: 0, y0: 0, y1: v.boxH, z0: 0, z1: 0 }; v.boxes.push(b); this.colliders.push(b); }
      this.place(v);
    }
  }

  private buildF250(x: number, z: number, yaw: number): Veh {
    const v = this.blank("f250", "Lifted F-250", "car", x, z, yaw), r = v.root;
    Object.assign(v, { wheelbase: 3.9, maxFwd: 26, maxRev: 8, accel: 9, radius: 1.15, pts: [2.0, 0, -2.0], camDist: 8.5, camHeight: 3.2, eye: { x: -0.5, y: 2.9, z: 0.15 }, boxH: 2.6,
      controls: "W/S gas & brake  ·  A/D steer  ·  SPACE handbrake  ·  SHIFT boost  ·  V camera  ·  E get out" });
    const BODY = "#9c1c16", CH = "#c4c8ce";
    this.box(v, r, "#22262c", 1.5, 0.28, 5.6, 0, 1.05, 0);                       // frame rails
    for (const az of [2.0, -2.0]) { this.cyl(v, r, "#2a2d31", 0.28, 2.3, 0, 0.66, az, "x", 10); this.cyl(v, r, "#555a60", 0.22, 0.9, 0.8, 0.92, az, "y", 8); this.cyl(v, r, "#555a60", 0.22, 0.9, -0.8, 0.92, az, "y", 8); }
    this.box(v, r, BODY, 2.15, 0.7, 5.9, 0, 1.6, -0.1);                          // lower body
    this.box(v, r, BODY, 2.05, 0.42, 1.85, 0, 2.15, 1.95);                       // hood
    this.box(v, r, "#1b1f25", 0.9, 0.12, 1.2, 0, 2.38, 2.0);                     // hood scoop
    this.box(v, r, BODY, 2.1, 1.0, 1.9, 0, 2.45, -0.35);                         // cab
    this.box(v, r, "#0e1114", 2.14, 0.08, 1.95, 0, 2.99, -0.35);                 // roof
    this.box(v, r, "#9fc3d6", 2.12, 0.55, 1.5, 0, 2.55, -0.3, { alpha: 0.55 });  // side + rear windows
    this.box(v, r, "#9fc3d6", 1.8, 0.5, 0.06, 0, 2.55, 0.64, { alpha: 0.55 });   // windshield
    for (const s of [-1, 1]) {                                                    // bed walls
      this.box(v, r, BODY, 0.12, 0.62, 2.7, s * 1.02, 2.15, -2.0);
      this.box(v, r, "#2a2d31", 0.14, 0.05, 2.72, s * 1.02, 2.5, -2.0);
      this.box(v, r, CH, 0.18, 0.5, 0.1, s * 1.05, 1.25, 0.95, { spec: 0.6 });   // running boards stay chrome
      this.box(v, r, CH, 0.4, 0.07, 1.6, s * 1.25, 1.2, -0.3, { spec: 0.6 });
    }
    this.box(v, r, BODY, 2.1, 0.62, 0.12, 0, 2.15, -3.32);                       // tailgate
    this.box(v, r, "#0b0d10", 1.9, 0.08, 2.6, 0, 1.9, -2.0);                     // bed floor
    this.box(v, r, CH, 2.35, 0.34, 0.3, 0, 1.2, 3.05, { spec: 0.7 });            // front bumper
    this.box(v, r, CH, 2.35, 0.3, 0.3, 0, 1.2, -3.3, { spec: 0.7 });             // rear bumper
    this.box(v, r, "#0b0d10", 1.3, 0.5, 0.1, 0, 1.95, 2.9);                      // grille
    this.box(v, r, CH, 1.4, 0.05, 0.12, 0, 2.2, 2.93, { spec: 0.7 });
    for (const s of [-1, 1]) {
      this.box(v, r, "#fff6c8", 0.4, 0.2, 0.08, s * 0.8, 2.0, 2.93, { emissive: 0.8 });   // headlights
      this.box(v, r, "#ff2a1a", 0.22, 0.26, 0.08, s * 0.92, 2.1, -3.37, { emissive: 0.7 }); // tail lights
      this.box(v, r, BODY, 0.1, 0.16, 0.26, s * 1.16, 2.7, 0.55);                // mirrors
      this.cyl(v, r, CH, 0.12, 2.6, s * 1.0, 2.9, -1.05, "y", 8, { spec: 0.7 });   // dual stacks
    }
    this.box(v, r, "#ffe9a8", 1.5, 0.12, 0.22, 0, 3.12, 0.4, { emissive: 0.9 });  // roof light bar
    for (let i = 0; i < 4; i++) this.cyl(v, r, "#ffe9a8", 0.2, 0.06, -0.55 + i * 0.37, 2.4, 3.0, "z", 10, { emissive: 0.9 }); // bumper pods
    this.box(v, r, "#14171c", 0.5, 0.25, 0.04, 0, 1.65, -3.4);
    const W = 1.35;
    for (const s of [-1, 1]) { this.wheel(v, r, s * 1.12, W / 2, 2.0, W, 0.55, 1); this.wheel(v, r, s * 1.12, W / 2, -2.0, W, 0.55, null); }
    return v;
  }

  private buildForklift(x: number, z: number, yaw: number): Veh {
    const v = this.blank("forklift", "Big Forklift", "forklift", x, z, yaw), r = v.root;
    Object.assign(v, { wheelbase: 2.6, maxFwd: 7, maxRev: 5, accel: 4, radius: 1.0, pts: [1.2, -0.4, -1.6], camDist: 7, camHeight: 2.8, eye: { x: 0, y: 2.45, z: -0.5 }, boxH: 2.6,
      controls: "W/S drive  ·  A/D steer  ·  R/F raise / lower forks  ·  V camera  ·  E get out" });
    const Y = "#e8a317", D = "#2b2f35";
    this.box(v, r, Y, 1.75, 0.65, 3.0, 0, 0.85, -0.2);                           // chassis
    this.box(v, r, D, 1.8, 1.0, 1.0, 0, 1.05, -1.85);                            // counterweight
    this.box(v, r, Y, 1.5, 0.5, 1.2, 0, 1.45, -1.0);                             // engine cover
    this.box(v, r, "#15171a", 0.7, 0.2, 0.6, 0, 1.45, -0.35);                    // seat
    this.box(v, r, "#15171a", 0.7, 0.6, 0.12, 0, 1.8, -0.7);                     // seat back
    this.cyl(v, r, "#15171a", 0.42, 0.06, 0, 1.75, 0.5, "y", 12).rotation.x = 0.6;   // steering wheel
    this.cyl(v, r, D, 0.07, 0.8, 0, 1.4, 0.55, "y", 6);
    for (const sx of [-0.78, 0.78]) for (const sz of [0.65, -0.95]) this.box(v, r, D, 0.08, 1.3, 0.08, sx, 1.95, sz);   // overhead guard posts
    this.box(v, r, D, 1.75, 0.07, 1.8, 0, 2.62, -0.15);                          // guard roof
    for (let i = 0; i < 5; i++) this.box(v, r, Y, 1.7, 0.03, 0.05, 0, 2.66, -0.9 + i * 0.4);
    this.sphere(v, r, "#ff8a1a", 0.22, 0, 2.78, -0.15, 0.9);                      // beacon
    this.box(v, r, "#fff6c8", 0.18, 0.12, 0.05, 0.6, 1.6, 0.66, { emissive: 0.8 }); this.box(v, r, "#fff6c8", 0.18, 0.12, 0.05, -0.6, 1.6, 0.66, { emissive: 0.8 });
    // mast and carriage
    const mast = new TransformNode("mast", this.scene); mast.parent = r; mast.position.set(0, 0, 1.6);
    for (const sx of [-0.55, 0.55]) { this.box(v, mast, D, 0.14, 4.1, 0.24, sx, 2.05, 0); this.box(v, mast, "#555a60", 0.1, 3.6, 0.16, sx * 0.5, 2.0, 0.18); }
    for (const y of [0.6, 2.0, 3.8]) this.box(v, mast, D, 1.3, 0.1, 0.22, 0, y, 0);
    const car = new TransformNode("carriage", this.scene); car.parent = mast; car.position.set(0, 0.2, 0.3); v.liftNode = car;
    this.box(v, car, D, 1.6, 0.9, 0.1, 0, 0.55, 0);
    for (const sx of [-0.5, 0.5]) { this.box(v, car, "#6a6f76", 0.18, 0.09, 1.7, sx, 0.05, 0.9, { spec: 0.4 }); this.box(v, car, "#6a6f76", 0.18, 0.7, 0.09, sx, 0.4, 0.07); }
    this.wheel(v, r, -0.82, 0.5, 0.95, 1.0, 0.42, null); this.wheel(v, r, 0.82, 0.5, 0.95, 1.0, 0.42, null);
    this.wheel(v, r, -0.78, 0.38, -1.6, 0.76, 0.34, 1); this.wheel(v, r, 0.78, 0.38, -1.6, 0.76, 0.34, 1);
    return v;
  }
  private sphere(v: Veh, p: TransformNode, hex: string, dia: number, x: number, y: number, z: number, em = 0) {
    return this.mk(v, MeshBuilder.CreateSphere("vs", { diameter: dia, segments: 8 }, this.scene), hex, p, x, y, z, em ? { emissive: em } : {});
  }

  private buildManlift(x: number, z: number, yaw: number): Veh {
    const v = this.blank("manlift", "Scissor Manlift", "lift", x, z, yaw), r = v.root;
    Object.assign(v, { wheelbase: 2.4, maxFwd: 3.2, maxRev: 2.4, accel: 2.5, radius: 0.95, pts: [0.9, -0.9], camDist: 9, camHeight: 3.4, eye: { x: 0, y: 1.6, z: 0.1 }, boxH: 1.3,
      controls: "W/S drive  ·  A/D steer  ·  R/F raise / lower the basket  ·  V camera  ·  E get out" });
    const O = "#e07a10", D = "#3d434b";
    this.box(v, r, O, 1.7, 0.55, 3.0, 0, 0.62, 0);
    this.box(v, r, D, 1.5, 0.1, 2.8, 0, 0.92, 0);
    for (const s of [-1, 1]) { this.wheel(v, r, s * 0.85, 0.36, 1.0, 0.72, 0.3, 1); this.wheel(v, r, s * 0.85, 0.36, -1.0, 0.72, 0.3, null); }
    const L = 2.7, levels = 4, A: TransformNode[] = [], B: TransformNode[] = [];
    for (let i = 0; i < levels; i++) for (const s of [-1, 1]) {
      const na = new TransformNode("sa", this.scene), nb = new TransformNode("sb", this.scene);
      na.parent = r; nb.parent = r; na.position.x = nb.position.x = s * 0.62;
      this.box(v, na, D, 0.12, 0.14, L, 0, 0, 0); this.box(v, nb, D, 0.12, 0.14, L, 0, 0, 0);
      A.push(na); B.push(nb);
    }
    const plat = new TransformNode("platform", this.scene); plat.parent = r;
    this.box(v, plat, "#5a6068", 1.8, 0.12, 2.7, 0, 0, 0, { spec: 0.3 });
    const rail = "#e8b923";
    for (const sx of [-0.88, 0.88]) for (const sz of [-1.3, 0, 1.3]) this.box(v, plat, rail, 0.06, 1.1, 0.06, sx, 0.58, sz);
    for (const sx of [-0.88, 0.88]) for (const y of [0.55, 1.12]) this.box(v, plat, rail, 0.05, 0.05, 2.62, sx, y, 0);
    for (const y of [0.55, 1.12]) { this.box(v, plat, rail, 1.76, 0.05, 0.05, 0, y, -1.3); this.box(v, plat, rail, 1.76, 0.05, 0.05, 0, y, 1.3); }
    this.box(v, plat, "#f2f2f2", 1.76, 0.18, 0.04, 0, 0.22, 1.3);                  // toe board
    this.box(v, plat, "#15171a", 0.5, 0.45, 0.3, 0.55, 0.38, 1.05); this.box(v, plat, "#c4231c", 0.12, 0.05, 0.12, 0.55, 0.64, 1.05);   // control box + e-stop
    this.box(v, plat, "#e07a10", 1.4, 0.04, 0.5, 0, 0.1, 1.55);                     // fold-out deck lip
    v.scissor = { a: A, b: B, L, platform: plat };
    v.lift = 0; this.setLift(v, 0);
    return v;
  }

  private setLift(v: Veh, t: number) {
    v.lift = Math.max(0, Math.min(1, t));
    if (v.kind === "forklift" && v.liftNode) v.liftNode.position.y = 0.2 + v.lift * 2.9;
    if (v.scissor) {
      const { a, b, L, platform } = v.scissor, levels = a.length / 2;
      const hl = 0.12 + v.lift * (2.15 - 0.12), th = Math.asin(Math.min(0.99, hl / L));
      a.forEach((n, i) => { const lv = Math.floor(i / 2); n.position.y = 0.98 + (lv + 0.5) * hl; n.rotation.x = th; });
      b.forEach((n, i) => { const lv = Math.floor(i / 2); n.position.y = 0.98 + (lv + 0.5) * hl; n.rotation.x = -th; });
      platform.position.y = 0.98 + levels * hl + 0.06;
      v.platformY = platform.position.y;
    }
  }

  // ---------------------------------------------------------------------------------------------- interaction
  interacts() {
    const out: { pos: () => Vector3; label: () => string; r: number; act: () => void; ok?: () => boolean }[] = [];
    for (const v of this.list) out.push({ pos: () => new Vector3(v.x, 1.4, v.z), label: () => `Drive the ${v.name}`, r: v.kind === "car" ? 4.2 : 3.4, act: () => this.enter(v), ok: () => !this.riding });
    out.push({ pos: () => new Vector3(4.75, F + 1.0, -3.25), label: () => "Sit in the driller's chair", r: 2.2, act: () => this.sit(), ok: () => !this.riding });
    out.push({ pos: () => new Vector3(-3.2, F + 1.2, -0.3), label: () => "Climb the ladder to the monkey board", r: 1.9, act: () => this.startClimb(F), ok: () => !this.riding && this.player.pos.y < F + 3 && this.player.pos.y > F - 0.5 });
    out.push({ pos: () => new Vector3(-3.2, FB + 1.2, 0.3), label: () => "Climb down to the drill floor", r: 2.0, act: () => this.startClimb(FB), ok: () => !this.riding && this.player.pos.y > FB - 1 });
    return out;
  }

  private place(v: Veh) {
    v.root.position.set(v.x, 0, v.z); v.root.rotation.y = v.yaw;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    v.pts.forEach((o, i) => {
      const b = v.boxes[i], cx = v.x + fx * o, cz = v.z + fz * o, h = v.radius * 0.85;
      b.x0 = cx - h; b.x1 = cx + h; b.z0 = cz - h; b.z1 = cz + h; b.y1 = v.solid ? v.boxH : 0;
    });
  }
  private setSolid(v: Veh, on: boolean) { v.solid = on; this.place(v); }

  enter(v: Veh) {
    if (this.riding) return;
    this.active = v; v.speed = 0; this.setSolid(v, false);
    this.wasThird = this.player.third; this.player.ride = true; this.player.third = true;
    this.player.yaw = v.yaw; this.player.pitch = 0.22;
    this.player.body.root.setEnabled(false);
    this.hud.style.display = "block";
    this.game.sfx.click();
    this.game.ui.toast(v.name.toUpperCase(), v.kind === "lift" ? "Raise the basket with R and reach the drill floor." : v.kind === "forklift" ? "R / F raise and lower the forks." : "Hold SHIFT for nitrous. Don't tell HSE.");
  }

  exit() {
    const v = this.active; if (!v) return;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const high = v.kind === "lift" && v.platformY > 1.2, base = high ? v.platformY : 0, off = v.kind === "lift" ? 1.9 : 2.4;
    // candidate exits as world offsets: sides first for cars, front / back / sides for the basket
    const tries: [number, number][] = v.kind === "lift"
      ? [[fx * off, fz * off], [-fx * off, -fz * off], [rx * 1.7, rz * 1.7], [-rx * 1.7, -rz * 1.7]]
      : [[-rx * off, -rz * off], [rx * off, rz * off], [-fx * 3.2, -fz * 3.2], [fx * 3.2, fz * 3.2]];
    let spot: Vector3 | null = null;
    for (const [dx, dz] of tries) {
      const px = v.x + dx, pz = v.z + dz, sup = this.player.support(px, pz, base + 0.2);
      if (pushOutXZ(this.world, { x: px, z: pz }, sup, 0.4, 0.5, 1.75)) continue;     // inside something
      if (high && Math.abs(sup - base) > 0.7) continue;                                 // nothing to step onto up here
      spot = new Vector3(px, sup, pz); break;
    }
    if (!spot) {
      if (high) { this.game.ui.toast("LOWER THE BASKET", "Nothing to step onto up here. Hold F, or line up with the drill floor."); return; }
      spot = new Vector3(v.x - rx * off, 0, v.z - rz * off);
    }
    this.active = null; this.setSolid(v, true); v.speed = 0;
    this.player.ride = false; this.player.third = this.wasThird;
    this.player.teleport(spot.x, spot.y, spot.z, v.yaw);
    this.hud.style.display = "none";
    this.game.sfx.click();
  }

  private sit() {
    if (this.riding) return;
    const drv = this.game.rig.humans.driller;
    this.chair.on = true; this.chair.hidden = drv.root.isEnabled(); drv.root.setEnabled(false);
    this.wasThird = this.player.third; this.player.third = false; this.player.ride = true;
    this.player.yaw = -0.97; this.player.pitch = 0.12;
    this.player.pos.set(this.chairPos.x, this.chairPos.y, this.chairPos.z);
    this.hud.style.display = "block";
    this.game.radio("dale", "Uh… that's my chair, boss. Fine. Don't touch the brake unless you mean it.", 7000);
  }
  private stand() {
    this.chair.on = false;
    if (this.chair.hidden) this.game.rig.humans.driller.root.setEnabled(true);
    this.player.ride = false; this.player.third = this.wasThird;
    this.player.teleport(4.3, F, -1.7, Math.PI);
    this.hud.style.display = "none";
  }
  private toggleAuto() {
    const s = this.game.sim.s;
    s.auto.on = !s.auto.on; this.game.sfx.click();
  }

  /** thrown out of the vehicle (the stand-down places the player afterwards) */
  eject() {
    const v = this.active; if (!v) return;
    v.speed = 0; this.active = null; this.setSolid(v, true);
    this.player.ride = false; this.player.third = this.wasThird; this.hud.style.display = "none";
    this.player.teleport(v.x, 0, v.z, v.yaw);
  }

  // ---- ladder to the monkey board ----
  private startClimb(y: number) {
    if (this.riding) return;
    this.climb.on = true; this.climb.y = y;
    this.wasThird = this.player.third; this.player.third = false; this.player.ride = true;
    this.player.yaw = 0; this.player.pitch = 0;
    this.hud.style.display = "block";
    this.game.sfx.click();
  }
  private finishClimb(top: boolean) {
    this.climb.on = false; this.hud.style.display = "none";
    this.player.ride = false; this.player.third = this.wasThird;
    if (top) this.player.teleport(-3.2, FB + 0.12, 0.55, 0); else this.player.teleport(-3.2, F, -0.75, Math.PI);
  }
  private updateClimb(dt: number) {
    const p = this.player, c = this.climb, joy = p.touchMove;
    const dir = (this.k("KeyW", "ArrowUp") ? 1 : 0) - (this.k("KeyS", "ArrowDown") ? 1 : 0) + (joy.y || 0);
    c.y += Math.max(-1, Math.min(1, dir)) * dt * (this.k("ShiftLeft", "ShiftRight") ? 4.6 : 2.3);
    if (c.y >= FB - 0.01 && dir > 0.2) { this.finishClimb(true); return; }
    if (c.y <= F + 0.01 && dir < -0.2) { this.finishClimb(false); return; }
    c.y = Math.max(F, Math.min(FB, c.y));
    p.pos.set(-3.2, c.y, -0.4); p.vel.setAll(0); p.grounded = true;
    const eye = new Vector3(-3.2, c.y + 1.5, -0.42);
    p.cam.position.copyFrom(eye); p.cam.setTarget(eye.add(p.lookDir()));
    this.hud.textContent = `CLIMBING   ${Math.round(c.y * 3.281)} FT\nW/S climb  ·  SHIFT climb faster  ·  keep going to the top or bottom`;
  }

  /** text for the E prompt while riding (null = none) */
  promptLabel(): string | null {
    if (this.climb.on) return this.climb.y > FB - 0.4 ? "Step onto the board" : this.climb.y < F + 0.4 ? "Step off the ladder" : null;
    return this.active ? "Get out" : "Stand up";
  }

  /** E while riding */
  leave() {
    if (this.climb.on) {
      if (this.climb.y > FB - 0.4) this.finishClimb(true);
      else if (this.climb.y < F + 0.4) this.finishClimb(false);
      else this.game.ui.toast("KEEP YOUR HANDS ON THE LADDER", "Climb to the top or back down. W / S.");
      return;
    }
    if (this.chair.on) this.stand(); else this.exit();
  }

  // ---------------------------------------------------------------------------------------------- simulation
  update(dt: number) {
    dt = Math.min(dt, 0.05);
    // idle vehicles keep their boxes / wheels honest
    if (this.climb.on) { this.updateClimb(dt); return; }
    if (this.chair.on) { this.updateChair(dt); return; }
    const v = this.active;
    if (!v) return;
    const p = this.player, joy = p.touchMove;
    let thr = (this.k("KeyW", "ArrowUp") ? 1 : 0) - (this.k("KeyS", "ArrowDown") ? 1 : 0) + (joy.y || 0);
    let str = (this.k("KeyD", "ArrowRight") ? 1 : 0) - (this.k("KeyA", "ArrowLeft") ? 1 : 0) + (joy.x || 0);
    thr = Math.max(-1, Math.min(1, thr)); str = Math.max(-1, Math.min(1, str));
    const boost = v.kind === "car" && this.k("ShiftLeft", "ShiftRight") ? 1.6 : 1;
    const hand = this.k("Space");
    let maxF = v.maxFwd * boost, maxR = v.maxRev;
    if (v.kind === "lift") { const k = 1 - v.lift * 0.75; maxF *= k; maxR *= k; }
    // longitudinal
    if (thr > 0) v.speed += (v.speed < 0 ? v.accel * 2.5 : v.accel * boost) * thr * dt;
    else if (thr < 0) v.speed -= (v.speed > 0 ? v.accel * 2.5 : v.accel * 0.8) * -thr * dt;
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), (1.6 + Math.abs(v.speed) * 0.12) * dt);
    if (hand) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 14 * dt);
    v.speed = Math.max(-maxR, Math.min(maxF, v.speed));
    // steering (speed-sensitive)
    const lock = v.kind === "car" ? 0.62 : 0.75, tgt = -str * lock / (1 + Math.abs(v.speed) * (v.kind === "car" ? 0.07 : 0.05));
    v.steer += (tgt - v.steer) * Math.min(1, dt * 7);
    // kinematic bicycle: yaw rate follows steer angle (screen-right = +yaw)
    const yawRate = (v.speed / v.wheelbase) * Math.tan(-v.steer);
    v.yaw += yawRate * dt * (hand && v.kind === "car" ? 1.5 : 1);
    v.x += Math.sin(v.yaw) * v.speed * dt; v.z += Math.cos(v.yaw) * v.speed * dt;
    // lift controls
    if (v.kind !== "car") { const d = (this.k("KeyR") ? 1 : 0) - (this.k("KeyF") ? 1 : 0); if (d) this.setLift(v, v.lift + d * dt * (v.kind === "lift" ? 0.11 : 0.35)); }
    // collisions
    let hit = false;
    for (const o of v.pts) {
      const q = { x: v.x + Math.sin(v.yaw) * o, z: v.z + Math.cos(v.yaw) * o }, ox = q.x, oz = q.z;
      if (pushOutXZ(this.world, q, 0, v.radius, 0.35, 3.2)) { v.x += q.x - ox; v.z += q.z - oz; hit = true; }
    }
    for (const w of this.list) {
      if (w === v) continue;
      const dx = v.x - w.x, dz = v.z - w.z, d = Math.hypot(dx, dz), min = v.radius + w.radius + 0.9;
      if (d < min && d > 0.001) { v.x += (dx / d) * (min - d); v.z += (dz / d) * (min - d); hit = true; }
    }
    this.dmgCd -= dt;
    const impact = Math.abs(v.speed);
    if (hit && impact > 4 && this.dmgCd <= 0) { this.dmgCd = 2.5; this.game.propertyDamage(impact); }
    if (hit && impact > 1.5) v.speed *= -0.25;
    else if (hit) v.speed *= 0.5;
    // people
    if (impact > 0.8) for (const h of this.game.peopleAt()) {
      if (h.y > 2.5) continue;
      for (const o of v.pts) {
        if (Math.hypot(h.x - (v.x + Math.sin(v.yaw) * o), h.z - (v.z + Math.cos(v.yaw) * o)) < v.radius + 0.35) { this.game.personStruck(h.name); return; }
      }
    }
    this.place(v);
    // wheels
    v.spinNodes.forEach((n, i) => { n.rotation.x += (v.speed / v.wheelR[i]) * dt; });
    v.steerNodes.forEach((n, i) => { n.rotation.y = v.steer * v.steerSign[i] * (v.kind === "forklift" ? -1 : 1) * 0.8; });
    // chassis roll / pitch for the big truck
    if (v.kind === "car") { v.root.rotation.z = -v.steer * v.speed * 0.006; v.root.rotation.x = -thr * 0.012 * Math.min(1, Math.abs(v.speed) / 8); }

    // the player rides along (everything else in the game keys off player.pos)
    const y = v.kind === "lift" ? v.platformY : 0;
    p.pos.set(v.x, y, v.z); p.vel.setAll(0); p.grounded = true;
    // camera
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    if (Math.abs(v.speed) > 1.2) {
      let d = v.yaw - p.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      p.yaw += d * Math.min(1, dt * 1.6 * Math.min(1, Math.abs(v.speed) / 7)) * (v.speed > 0 ? 1 : 0);
    }
    const cam = p.cam;
    if (p.third) {
      const tgtP = new Vector3(v.x, y + v.camHeight * 0.55 + (v.kind === "lift" ? 1.0 : 0), v.z);
      const back = p.lookDir().scale(-1);
      let dist = v.camDist + (v.kind === "lift" ? 0 : Math.abs(v.speed) * 0.06);
      const camP = tgtP.add(back.scale(dist));
      for (let dd = 1.5; dd <= dist; dd += 0.5) {
        const pt = tgtP.add(back.scale(dd));
        if (pt.y < 0.3 || this.world.some((c) => pt.x > c.x0 && pt.x < c.x1 && pt.y > c.y0 && pt.y < c.y1 && pt.z > c.z0 && pt.z < c.z1)) { dist = Math.max(1.5, dd - 0.5); break; }
      }
      const cp = tgtP.add(back.scale(dist)); void camP;
      cp.y = Math.max(0.5, cp.y);
      cam.position.copyFrom(cp); cam.setTarget(tgtP.add(p.lookDir().scale(2)));
    } else {
      const ex = v.x + fz * v.eye.x + fx * v.eye.z, ez = v.z - fx * v.eye.x + fz * v.eye.z;
      const eye = new Vector3(ex, y + v.eye.y, ez);
      cam.position.copyFrom(eye); cam.setTarget(eye.add(p.lookDir()));
    }
    const mph = Math.round(Math.abs(v.speed) * 2.237);
    const extra = v.kind === "forklift" ? `   FORKS ${(0.2 + v.lift * 2.9).toFixed(1)} m` : v.kind === "lift" ? `   BASKET ${(v.platformY * 3.281).toFixed(0)} ft` : "";
    this.hud.textContent = `${v.name.toUpperCase()}   ${mph} MPH${extra}\n${v.controls}`;
  }

  private updateChair(dt: number) {
    const s = this.game.sim.s, p = this.player;
    p.pos.set(this.chairPos.x, this.chairPos.y, this.chairPos.z); p.vel.setAll(0); p.grounded = true;
    const eye = new Vector3(4.75, F + 1.45, -3.25);
    p.cam.position.copyFrom(eye); p.cam.setTarget(eye.add(p.lookDir()));
    const busy = s.mode === "tripping" || s.mode === "casing";
    const up = (this.k("KeyW", "ArrowUp") ? 1 : 0) - (this.k("KeyS", "ArrowDown") ? 1 : 0);
    const fl = (this.k("KeyD", "ArrowRight") ? 1 : 0) - (this.k("KeyA", "ArrowLeft") ? 1 : 0);
    if (up && !s.auto.on && !busy) s.wobTarget = Math.max(0, Math.min(60, s.wobTarget + up * 8 * dt));
    if (fl) s.flowTarget = Math.max(400, Math.min(1000, s.flowTarget + fl * 150 * dt));
    this.hud.textContent = `DRILLER'S CHAIR — ${s.mode.toUpperCase()}   DEPTH ${Math.round(s.depth).toLocaleString()} ft   ROP ${Math.round(s.rop)} ft/hr\n`
      + `WOB ${s.wob.toFixed(1)} → ${s.wobTarget.toFixed(0)} klbs   PUMP ${Math.round(s.flowTarget)} gpm   SPP ${Math.round(s.spp)} psi   AUTO ${s.auto.on ? "ON" : "OFF"}\n`
      + `W/S weight on bit  ·  A/D pump rate  ·  T autodriller  ·  E stand up`;
  }
}
