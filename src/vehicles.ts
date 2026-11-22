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
 *   Driller's chair  W/S weight on bit, A/D pump rate, SPACE brake, T autodriller
 *   DD / MWD seats  A/D toolface, W slide (steer), S rotate (straighten)
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

type Kind = "car" | "forklift" | "lift" | "drone";

interface Veh {
  id: string; name: string; kind: Kind; root: TransformNode;
  x: number; z: number; yaw: number; speed: number; steer: number;
  wheelbase: number; maxFwd: number; maxRev: number; accel: number; radius: number; pts: number[];
  eye: { x: number; y: number; z: number }; camDist: number; camHeight: number;
  steerNodes: TransformNode[]; steerSign: number[]; spinNodes: TransformNode[]; wheelR: number[];
  boxes: AABB[]; boxH: number; solid: boolean;
  lift: number;                       // 0..1 boom angle / basket height
  ext: number; tilt: number;                   // telehandler: boom extension 0..1, fork tilt -1..1
  boomPivot?: TransformNode; boomIn?: TransformNode; tiltNode?: TransformNode; forkMark?: TransformNode;
  liftNode?: TransformNode; scissor?: { a: TransformNode[]; b: TransformNode[]; L: number; platform: TransformNode };
  casters: Mesh[]; controls: string; platformY: number;
  /** drone: altitude, vertical speed, rotor discs, dock pose, flying home */
  alt: number; vy: number; rotors: TransformNode[]; dock?: { x: number; z: number; yaw: number }; returning: boolean;
}

export class Vehicles {
  list: Veh[] = [];
  active: Veh | null = null;
  private world: AABB[];
  private hud: HTMLElement;
  private wasThird = true;
  private chair = { on: false, hidden: false, idx: 0 };
  /** 0 = driller's chair, 1 / 2 = the directional drillers' seats */
  private seats = [
    { name: "Driller's chair", pos: new Vector3(4.75, F + 0.5, -3.25), yaw: -0.97, npc: "driller", off: new Vector3(4.3, F, -1.7) },
    { name: "Directional driller's seat", pos: new Vector3(4.8, F + 0.5, -4.62), yaw: Math.PI, npc: "dd1", off: new Vector3(4.8, F, -3.4) },
    { name: "MWD seat", pos: new Vector3(5.6, F + 0.5, -4.62), yaw: Math.PI, npc: "dd2", off: new Vector3(5.6, F, -3.4) },
  ];
  /** steering the well from the DD seat */
  private dd = { inc: 2.1, azi: 270, tf: 0, sliding: false, warned: 0 };
  private keyOff: (() => void)[] = [];
  private pressed = new Set<string>();
  private dmgCd = 0;
  private liftSpace = true;
  /** get-in / get-out animation: eased camera, plus the body walking to / from the vehicle */
  private blend: { t: number; dur: number; fromPos: Vector3; fromTgt: Vector3; body?: { from: Vector3; to: Vector3; mode: "in" | "out" } } | null = null;
  private uiKind = "";
  /** pedals: travel 0..1; reverse only engages after the brake has been released at a stop */
  private gas = 0; private brk = 0; private revArm = true; private spaceWas = false;
  private pallet!: TransformNode; private palletHeld = false; private palletVy = 0; private palletV!: Veh;
  private climb = { on: false, y: 0 };
  private zip = { on: false, t: 0 };

  constructor(private scene: Scene, private colliders: AABB[], private player: Player, private game: Game) {
    this.world = colliders.slice();            // static world only (vehicles don't collide with their own boxes)
    this.hud = document.createElement("div");
    this.hud.style.cssText = "position:fixed;top:96px;left:50%;transform:translateX(-50%);z-index:30;display:none;padding:8px 16px;background:rgba(10,16,24,.78);border:2px solid #f4c04a;color:#fff;font:700 13px/1.45 system-ui,sans-serif;letter-spacing:.5px;text-align:center;pointer-events:none;text-transform:none;white-space:pre-wrap;max-width:94vw";
    document.body.appendChild(this.hud);
    const down = (e: KeyboardEvent) => { this.pressed.add(e.code); if (this.riding && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault(); if (e.code === "KeyT" && this.chair.on && this.chair.idx === 0 && !e.repeat) this.toggleAuto(); };
    const up = (e: KeyboardEvent) => this.pressed.delete(e.code);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", () => this.pressed.clear());
    this.build();
  }

  get riding() { return !!this.active || this.chair.on || this.climb.on || this.zip.on; }
  private k(...codes: string[]) { return codes.some((c) => this.pressed.has(c)); }

  setShadow(sg: ShadowGenerator) { for (const v of [...this.list, this.palletV]) v.casters.forEach((m) => sg.addShadowCaster(m)); }

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
      lift: 0, ext: 0, tilt: 0, casters: [], controls: "", platformY: 0, alt: 0, vy: 0, rotors: [], returning: false };
  }

  private build() {
    this.list.push(this.buildF250(22, 22.8, Math.PI));
    this.list.push(this.buildForklift(14, 44, -0.6));
    this.list.push(this.buildManlift(-7, 13, 0.4));
    this.buildPallet(9.2, 51.5, -0.6);
    this.list.push(this.buildDrone(26.6, 10.2, Math.PI / 2));
    for (const v of this.list) {
      for (let i = 0; i < v.pts.length; i++) { const b: AABB = { x0: 0, x1: 0, y0: 0, y1: v.boxH, z0: 0, z1: 0 }; v.boxes.push(b); this.colliders.push(b); }
      this.place(v);
    }
  }

  private buildF250(x: number, z: number, yaw: number): Veh {
    const v = this.blank("f250", "Lifted F-250", "car", x, z, yaw), r = v.root;
    Object.assign(v, { wheelbase: 3.9, maxFwd: 26, maxRev: 8, accel: 9, radius: 1.15, pts: [2.0, 0, -2.0], camDist: 14, camHeight: 4.6, eye: { x: -0.5, y: 2.9, z: 0.15 }, boxH: 2.6,
      controls: "W gas  ·  S brake / reverse  ·  A/D steer  ·  V camera  ·  E get out" });
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

  /** Quadcopter on its dock beside the company man trailer. */
  private buildDrone(x: number, z: number, yaw: number): Veh {
    const v = this.blank("drone", "Survey Drone", "drone", x, z, yaw), r = v.root;
    Object.assign(v, { radius: 0.6, pts: [0], boxH: 0.5, camDist: 7, camHeight: 1.2, eye: { x: 0, y: 0, z: 0.35 }, maxFwd: 17, maxRev: 8, accel: 8, alt: 0.14, dock: { x, z, yaw },
      controls: "W fly forward · S brake / back up · A/D turn · R/F up / down · V camera (drone cam) · E redock" });
    // dock: a round pad with an H and a controller box
    const pad = new TransformNode("dockpad", this.scene); pad.position.set(x, 0, z);
    const pv = this.blank("dock", "dock", "car", x, z, 0);
    this.cyl(pv, pad, "#2a2f36", 2.6, 0.08, 0, 0.04, 0, "y", 24);
    this.cyl(pv, pad, "#f0b400", 2.3, 0.02, 0, 0.09, 0, "y", 24);
    this.cyl(pv, pad, "#2a2f36", 2.1, 0.02, 0, 0.1, 0, "y", 24);
    this.box(pv, pad, "#f0b400", 0.12, 0.02, 0.9, -0.4, 0.115, 0); this.box(pv, pad, "#f0b400", 0.12, 0.02, 0.9, 0.4, 0.115, 0); this.box(pv, pad, "#f0b400", 0.8, 0.02, 0.12, 0, 0.115, 0);
    this.box(pv, pad, "#15171a", 0.4, 0.5, 0.3, 1.6, 0.25, 0); this.box(pv, pad, "#2a7cff", 0.3, 0.02, 0.2, 1.6, 0.51, 0, { emissive: 0.9 });
    // body
    const D = "#1b1e23", G = "#7a828c";
    this.box(v, r, D, 0.55, 0.16, 0.7, 0, 0.18, 0);
    this.box(v, r, G, 0.46, 0.08, 0.6, 0, 0.3, -0.03);
    this.box(v, r, "#2a7cff", 0.2, 0.03, 0.05, 0, 0.35, 0.28, { emissive: 0.9 });
    this.box(v, r, "#ff2a1a", 0.06, 0.04, 0.06, -0.2, 0.2, -0.35, { emissive: 0.9 }); this.box(v, r, "#2aff5a", 0.06, 0.04, 0.06, 0.2, 0.2, -0.35, { emissive: 0.9 });
    // gimbal camera under the nose
    this.sphere(v, r, "#0e1013", 0.2, 0, 0.1, 0.36, 0); this.sphere(v, r, "#2a7cff", 0.07, 0, 0.1, 0.45, 0.6);
    // arms, motors, rotors, landing legs
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const arm = this.box(v, r, D, 0.08, 0.06, 0.78, 0, 0.2, 0); arm.position.set(sx * 0.33, 0.2, sz * 0.33); arm.rotation.y = sx * sz * Math.PI / 4 * -1 + Math.PI / 2 * 0;
      this.cyl(v, r, "#444a52", 0.16, 0.12, sx * 0.62, 0.26, sz * 0.62, "y", 10);
      const rot = new TransformNode("rotor", this.scene); rot.parent = r; rot.position.set(sx * 0.62, 0.35, sz * 0.62); v.rotors.push(rot);
      this.box(v, rot, "#d8dce0", 0.9, 0.012, 0.07, 0, 0, 0); this.box(v, rot, "#d8dce0", 0.07, 0.012, 0.9, 0, 0, 0).rotation.y = 0;
      this.cyl(v, rot, "#9fd3e8", 0.92, 0.008, 0, 0.0, 0, "y", 20, { alpha: 0.18 });
      this.box(v, r, D, 0.04, 0.2, 0.04, sx * 0.3, 0.06, sz * 0.3);
    }
    return v;
  }

  private buildPallet(x: number, z: number, yaw: number) {
    const v = this.blank("pallet", "Pipe pallet", "car", x, z, yaw); this.palletV = v;
    const r = v.root; this.pallet = r;
    this.box(v, r, "#8a6a40", 1.5, 0.14, 1.2, 0, 0.12, 0);
    for (const sx of [-0.6, 0, 0.6]) this.box(v, r, "#6e5230", 0.18, 0.12, 1.2, sx, 0.05, 0);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 5 - (row % 2); i++) {
      this.cyl(v, r, "#8d9299", 0.24, 1.4, 0, 0.32 + row * 0.22, -0.46 + i * 0.235 + (row % 2) * 0.12, "x", 8);
    }
    this.box(v, r, "#e8b923", 1.46, 0.03, 0.04, 0, 0.62, 0.55);   // strap
  }

  /** SkyTrak-style telehandler: side cab, pivoting telescopic boom, tilting fork carriage. */
  private buildForklift(x: number, z: number, yaw: number): Veh {
    const v = this.blank("forklift", "SkyTrak Telehandler", "forklift", x, z, yaw), r = v.root;
    Object.assign(v, { wheelbase: 3.2, maxFwd: 9, maxRev: 5, accel: 3.6, radius: 1.2, pts: [1.8, 0, -1.8], camDist: 16, camHeight: 5.0, eye: { x: -0.75, y: 2.6, z: 0.45 }, boxH: 2.5,
      controls: "W gas · S brake/reverse · A/D steer · R/F boom · T/G extend · Y/H tilt · SPACE pick up / set down · E get out" });
    const Y = "#f0b400", D = "#25282d", G = "#d4d7da";
    this.box(v, r, D, 2.0, 0.3, 5.2, 0, 0.7, 0);                                  // axle frame
    this.box(v, r, Y, 2.2, 0.8, 5.4, 0, 1.15, 0);                                 // chassis
    this.box(v, r, Y, 1.3, 1.1, 1.9, 0, 2.0, -1.75);                              // boom tower / engine
    this.box(v, r, D, 2.1, 0.7, 0.5, 0, 1.25, -2.85);                             // counterweight
    this.cyl(v, r, "#9aa0a8", 0.14, 0.9, 0.45, 2.85, -2.2, "y", 8, { spec: 0.6 });     // exhaust
    // left-side cab
    this.box(v, r, Y, 1.0, 0.5, 1.6, -0.75, 1.75, 0.6);
    this.box(v, r, "#9fc3d6", 1.02, 1.05, 1.5, -0.75, 2.45, 0.6, { alpha: 0.5 });
    for (const sx of [-1.24, -0.26]) for (const sz of [-0.12, 1.32]) this.box(v, r, D, 0.07, 1.1, 0.07, sx, 2.45, sz);
    this.box(v, r, D, 1.1, 0.07, 1.7, -0.75, 3.02, 0.6);
    this.box(v, r, "#15171a", 0.55, 0.18, 0.55, -0.75, 2.0, 0.35);                // seat
    this.box(v, r, "#15171a", 0.55, 0.6, 0.1, -0.75, 2.35, 0.1);
    this.cyl(v, r, "#15171a", 0.36, 0.05, -0.75, 2.4, 0.8, "y", 12).rotation.x = 0.7;     // steering wheel
    this.box(v, r, "#ff8a1a", 0.14, 0.12, 0.14, -0.75, 3.14, 0.6, { emissive: 0.9 });  // beacon
    this.box(v, r, "#fff6c8", 0.4, 0.18, 0.06, -0.7, 1.35, 2.72, { emissive: 0.8 }); this.box(v, r, "#fff6c8", 0.4, 0.18, 0.06, 0.7, 1.35, 2.72, { emissive: 0.8 });
    this.box(v, r, "#ff2a1a", 0.3, 0.16, 0.06, -0.8, 1.3, -3.12, { emissive: 0.7 }); this.box(v, r, "#ff2a1a", 0.3, 0.16, 0.06, 0.8, 1.3, -3.12, { emissive: 0.7 });
    this.box(v, r, D, 1.6, 0.2, 0.3, 0, 0.85, 2.85);                              // front bumper
    // telescopic boom: outer section pivots on the tower, inner section slides out, carriage tilts on the nose
    const pivot = new TransformNode("boomPivot", this.scene); pivot.parent = r; pivot.position.set(0, 2.3, -2.1); v.boomPivot = pivot;
    this.box(v, pivot, Y, 0.62, 0.66, 3.8, 0, 0, 1.9);
    this.box(v, pivot, D, 0.7, 0.2, 0.6, 0, 0.3, 0.2);
    const inner = new TransformNode("boomIn", this.scene); inner.parent = pivot; v.boomIn = inner;
    this.box(v, inner, G, 0.46, 0.5, 3.8, 0, 0, 2.3, { spec: 0.4 });
    this.cyl(v, pivot, "#9aa0a8", 0.14, 1.9, 0, -0.95, 1.4, "y", 8, { spec: 0.6 }).rotation.x = 0.25;   // lift ram
    const tilt = new TransformNode("tilt", this.scene); tilt.parent = inner; tilt.position.set(0, 0, 4.2); v.tiltNode = tilt;
    this.box(v, tilt, D, 0.5, 0.5, 0.4, 0, 0, -0.15);                              // head
    this.box(v, tilt, D, 1.7, 0.95, 0.1, 0, -0.1, 0.2);                            // carriage back plate
    for (const sx of [-0.55, 0.55]) {
      this.box(v, tilt, "#6a6f76", 0.17, 0.09, 1.7, sx, -0.5, 1.05, { spec: 0.4 });  // forks
      this.box(v, tilt, "#6a6f76", 0.17, 0.75, 0.09, sx, -0.15, 0.27, { spec: 0.4 });
    }
    const mark = new TransformNode("forkMark", this.scene); mark.parent = tilt; mark.position.set(0, -0.5, 1.2); v.forkMark = mark;
    for (const s of [-1, 1]) { this.wheel(v, r, s * 1.12, 0.63, 1.8, 1.26, 0.52, 1); this.wheel(v, r, s * 1.12, 0.63, -1.8, 1.26, 0.52, null); }
    this.setBoom(v);
    return v;
  }
  private setBoom(v: Veh) {
    if (!v.boomPivot || !v.boomIn || !v.tiltNode) return;
    v.boomPivot.rotation.x = 0.34 - v.lift * 1.5;   // negative x raises the +z end; lift 0 = nose just above the ground
    v.boomIn.position.z = v.ext * 3.4;
    v.tiltNode.rotation.x = v.tilt * 0.45;         // positive tips the fork tips down
  }
  private forkPos(v: Veh): Vector3 { v.root.computeWorldMatrix(true); v.forkMark!.computeWorldMatrix(true); return v.forkMark!.getAbsolutePosition().clone(); }

  private grab(v: Veh) {
    const f = this.forkPos(v), pl = this.pallet;
    if (!this.palletHeld) {
      const pp = pl.getAbsolutePosition();
      if (Math.hypot(f.x - pp.x, f.z - pp.z) < 1.4 && Math.abs(f.y - (pp.y + 0.1)) < 0.6) {
        pl.setParent(v.tiltNode!); this.palletHeld = true; this.game.sfx.click();
        this.game.ui.toast("PIPE PALLET LOADED", "Boom up, tilt back, and mind the people.");
      } else this.game.ui.toast("NO LOAD", "Drive the forks under the pallet, level with it, then press SPACE.");
      return;
    }
    const h = pl.getAbsolutePosition().y;
    pl.setParent(null); this.palletHeld = false; this.palletVy = 0;
    const fw = pl.getDirection(Vector3.Forward()); pl.rotationQuaternion = null; pl.rotation.set(0, Math.atan2(fw.x, fw.z), 0);
    this.game.sfx.click();
    if (h > 1.5) { this.game.inc(1, "DROPPED OBJECT"); this.game.sim.addCost(12000); this.game.radio("earl", "That pallet came off the forks from " + Math.round(h * 3.28) + " feet. Set it down, don't drop it.", 7000); }
  }
  private updatePallet(dt: number) {
    if (this.palletHeld || !this.pallet) return;
    const p = this.pallet.position;
    if (p.y > 0.001) { this.palletVy -= 9.8 * dt; p.y = Math.max(0, p.y + this.palletVy * dt); if (p.y === 0) { this.palletVy = 0; if (this.palletFell > 1.5) { this.game.sfx.thud(); } } }
  }
  private palletFell = 0;

  private sphere(v: Veh, p: TransformNode, hex: string, dia: number, x: number, y: number, z: number, em = 0) {
    return this.mk(v, MeshBuilder.CreateSphere("vs", { diameter: dia, segments: 8 }, this.scene), hex, p, x, y, z, em ? { emissive: em } : {});
  }

  private buildManlift(x: number, z: number, yaw: number): Veh {
    const v = this.blank("manlift", "Scissor Manlift", "lift", x, z, yaw), r = v.root;
    Object.assign(v, { wheelbase: 2.4, maxFwd: 3.2, maxRev: 2.4, accel: 2.5, radius: 0.95, pts: [0.9, -0.9], camDist: 14, camHeight: 4.8, eye: { x: 0, y: 1.6, z: 0.1 }, boxH: 1.3,
      controls: "W gas  ·  S brake / reverse  ·  A/D steer  ·  R/F raise / lower the basket  ·  SPACE jump out  ·  E get out (basket down)" });
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
    if (v.kind === "forklift") this.setBoom(v);
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
    for (const v of this.list) out.push({ pos: () => new Vector3(v.x, 1.4, v.z), label: () => v.kind === "drone" ? "Pilot the drone" : `Drive the ${v.name}`, r: v.kind === "car" ? 4.2 : v.kind === "drone" ? 3.2 : 3.4, act: () => this.enter(v), ok: () => !this.riding && !v.returning });
    out.push({ pos: () => new Vector3(-5.0, FB + 1.0, 5.1), label: () => "Ride the Geronimo line (emergency escape)", r: 2.0, act: () => this.startZip(), ok: () => !this.riding && this.player.pos.y > FB - 1 });
    this.seats.forEach((st, i) => out.push({ pos: () => new Vector3(st.pos.x, F + 1.0, st.pos.z), label: () => i === 0 ? "Sit in the driller's chair" : i === 1 ? "Sit in the directional driller's seat" : "Sit in the MWD seat", r: i === 0 ? 2.2 : 1.5, act: () => this.sit(i), ok: () => !this.riding }));
    out.push({ pos: () => new Vector3(-4.0, F + 1.2, -0.3), label: () => "Climb the ladder to the monkey board", r: 1.9, act: () => this.startClimb(F), ok: () => !this.riding && this.player.pos.y < F + 3 && this.player.pos.y > F - 0.5 });
    out.push({ pos: () => new Vector3(-4.0, FB + 1.2, 0.3), label: () => "Climb down to the drill floor", r: 2.0, act: () => this.startClimb(FB), ok: () => !this.riding && this.player.pos.y > FB - 1 });
    return out;
  }

  private place(v: Veh) {
    v.root.position.set(v.x, v.kind === "drone" ? v.alt : 0, v.z); v.root.rotation.y = v.yaw;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    v.pts.forEach((o, i) => {
      const b = v.boxes[i], cx = v.x + fx * o, cz = v.z + fz * o, h = v.radius * 0.85;
      b.x0 = cx - h; b.x1 = cx + h; b.z0 = cz - h; b.z1 = cz + h; b.y1 = v.solid ? v.boxH : 0;
    });
  }
  private setSolid(v: Veh, on: boolean) { v.solid = on; this.place(v); }

  private startBlend(dur: number, body?: { from: Vector3; to: Vector3; mode: "in" | "out" }) {
    const cam = this.player.cam;
    this.blend = { t: 0, dur, fromPos: cam.position.clone(), fromTgt: cam.getTarget().clone(), body };
  }
  /** call after all cameras have been placed for the frame */
  postCamera(dt: number) {
    const b = this.blend; if (!b) return;
    b.t += dt; const k = Math.min(1, b.t / b.dur), e = k * k * (3 - 2 * k), cam = this.player.cam;
    const tgt = cam.getTarget().clone();
    cam.position.copyFrom(Vector3.Lerp(b.fromPos, cam.position, e)); cam.setTarget(Vector3.Lerp(b.fromTgt, tgt, e));
    if (b.body) {
      const body = this.player.body.root, m = b.body.mode;
      const f = m === "in" ? Math.min(1, k * 1.6) : Math.max(0, 1 - k * 1.6), ee = f * f * (3 - 2 * f);
      if (m === "in") {
        body.setEnabled(k < 0.65); body.position.copyFrom(Vector3.Lerp(b.body.from, b.body.to, Math.min(1, k * 1.5))); body.scaling.setAll(Math.max(0.05, 1 - ee * 0.95));
        const d = b.body.to.subtract(b.body.from); if (d.lengthSquared() > 0.01) body.rotation.y = Math.atan2(d.x, d.z);
        this.player.body.animate(dt, 2.6);
      } else { body.scaling.setAll(1 - ee * 0.9); }
    }
    if (k >= 1) { this.blend = null; this.player.bodyHold = false; this.player.body.root.scaling.setAll(1); if (this.active || this.chair.on || this.climb.on || this.zip.on) this.player.body.root.setEnabled(false); }
  }

  enter(v: Veh) {
    if (this.riding) return;
    const here = this.player.pos.clone();
    this.startBlend(0.6, { from: here, to: new Vector3(v.x, v.kind === "drone" ? 0 : here.y, v.z), mode: "in" }); this.player.bodyHold = true;
    this.active = v; v.speed = 0; this.setSolid(v, false);
    this.wasThird = this.player.third; this.player.ride = true; this.player.third = true;
    this.player.yaw = v.yaw; this.player.pitch = 0.22;
    if (!this.blend) this.player.body.root.setEnabled(false);
    this.hud.style.display = "block";
    this.game.sfx.click();
    this.game.ui.toast(v.name.toUpperCase(), v.kind === "drone" ? "W forward, A/D turn, R/F up and down. E sends it home." : v.kind === "lift" ? "R / F raise and lower the basket. SPACE jumps you out." : v.kind === "forklift" ? "R/F boom, T/G extend, Y/H tilt, SPACE to pick up the pipe pallet." : "W is the gas, S is brake then reverse. Steer with A and D.");
  }

  /** manlift: leap out of the basket in the direction you are looking. Only a jump gets you out up high, and a long fall is on you. */
  private jumpOut(v: Veh) {
    const p = this.player, dir = new Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const from = new Vector3(v.x, v.platformY + 0.05, v.z).add(dir.scale(1.0));
    this.active = null; this.setSolid(v, true); v.speed = 0;
    p.ride = false; p.third = this.wasThird; this.hud.style.display = "none";
    p.teleport(from.x, from.y, from.z, p.yaw);
    p.vel.set(dir.x * 3.2, 3.2, dir.z * 3.2); p.grounded = false;
    this.startBlend(0.45); this.game.sfx.click();
    if (v.platformY > 3) this.game.radio("earl", "You JUMPED out of the manlift. From " + Math.round(v.platformY * 3.28) + " feet. Tell me that wasn't on the JSA.", 7000);
  }

  /** the drone flies itself home; the pilot stands at the dock */
  private dockDrone(v: Veh) {
    this.active = null; v.returning = true; v.speed = 0; v.vy = 0; this.setSolid(v, false);
    this.player.ride = false; this.player.third = this.wasThird; this.hud.style.display = "none";
    const d = v.dock!; this.player.teleport(d.x + 1.9, 0, d.z + 1.1, -Math.PI / 2 - 0.4);
    this.game.sfx.click(); this.game.ui.toast("DRONE RETURNING", "Redocking at the company man trailer.");
  }
  private flyHome(v: Veh, dt: number) {
    const d = v.dock!, dx = d.x - v.x, dz = d.z - v.z, dist = Math.hypot(dx, dz);
    let tilt = 0;
    if (dist > 0.7) {
      const cruise = Math.max(v.alt, 22);                                // climb clear of everything first, then fly home
      if (v.alt < cruise - 0.5 && dist > 3) v.alt = Math.min(cruise, v.alt + 8 * dt);
      else { const sp = Math.min(16, 3 + dist * 1.2) * dt; v.x += (dx / dist) * Math.min(dist, sp); v.z += (dz / dist) * Math.min(dist, sp); tilt = 0.18; }
    } else {
      v.x = d.x; v.z = d.z;
      let dy = d.yaw - v.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; v.yaw += dy * Math.min(1, dt * 3);
      v.alt = Math.max(0.14, v.alt - 3.5 * dt);
      if (v.alt <= 0.14) { v.returning = false; this.setSolid(v, true); v.alt = 0.14; this.game.ui.toast("DOCKED", "Drone is back on the pad."); }
    }
    v.root.rotation.x = tilt; v.rotors.forEach((n, i) => { n.rotation.y += (i % 2 ? 1 : -1) * 70 * dt; });
    this.place(v);
  }

  exit() {
    const v = this.active; if (!v) return;
    if (v.kind === "drone") { this.dockDrone(v); return; }
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const high = v.kind === "lift" && v.platformY > 1.2;
    if (high) { this.game.ui.toast("YOU'RE IN THE BASKET", "Lower it to the ground to step out, or press SPACE to jump out."); return; }
    const off = v.kind === "lift" ? 1.9 : 2.4;
    const tries: [number, number][] = v.kind === "lift"
      ? [[fx * off, fz * off], [-fx * off, -fz * off], [rx * 1.7, rz * 1.7], [-rx * 1.7, -rz * 1.7]]
      : [[-rx * off, -rz * off], [rx * off, rz * off], [-fx * 3.2, -fz * 3.2], [fx * 3.2, fz * 3.2]];
    let spot: Vector3 | null = null;
    for (const [dx, dz] of tries) {
      const px = v.x + dx, pz = v.z + dz, sup = this.player.support(px, pz, 0.2);
      if (pushOutXZ(this.world, { x: px, z: pz }, sup, 0.4, 0.5, 1.75)) continue;     // inside something
      spot = new Vector3(px, sup, pz); break;
    }
    if (!spot) spot = new Vector3(v.x - rx * off, 0, v.z - rz * off);
    this.active = null; this.setSolid(v, true); v.speed = 0;
    this.player.ride = false; this.player.third = this.wasThird;
    this.startBlend(0.55, { from: new Vector3(v.x, spot.y, v.z), to: spot, mode: "out" });
    this.player.teleport(spot.x, spot.y, spot.z, v.yaw);
    this.player.body.root.scaling.setAll(0.2); this.exitPop = 0.35;
    this.hud.style.display = "none";
    this.game.sfx.click();
  }
  private exitPop = 0;

  private sit(i = 0) {
    if (this.riding) return;
    const st = this.seats[i], npc = this.game.rig.humans[st.npc];
    this.chair.on = true; this.chair.idx = i; this.chair.hidden = npc.root.isEnabled(); npc.root.setEnabled(false);
    this.wasThird = this.player.third; this.player.third = false; this.player.ride = true;
    this.player.yaw = st.yaw; this.player.pitch = 0.12;
    this.player.pos.set(st.pos.x, st.pos.y, st.pos.z);
    this.hud.style.display = "block";
    if (i === 0) this.game.radio("dale", "Uh… that's my chair, boss. Fine. Don't touch the brake unless you mean it.", 7000);
    else this.game.radio("tex", i === 1 ? "That's the steering seat. Small corrections, boss. Toolface is not a suggestion." : "That's Priya's seat. She's going to want it back.", 7000);
  }
  private stand() {
    const st = this.seats[this.chair.idx];
    this.chair.on = false;
    if (this.chair.hidden) this.game.rig.humans[st.npc].root.setEnabled(true);
    this.player.ride = false; this.player.third = this.wasThird;
    this.player.teleport(st.off.x, st.off.y, st.off.z, Math.PI);
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

  // ---- Geronimo line: ride the escape cable from the board down to the landing pad ----
  private startZip() {
    if (this.riding) return;
    this.zip.on = true; this.zip.t = 0;
    this.wasThird = this.player.third; this.player.third = false; this.player.ride = true;
    this.player.yaw = 0; this.player.pitch = 0.12;
    this.hud.style.display = "block"; this.game.sfx.click();
    this.game.radio("earl", "GERONIMO! Hold on, boss. Knees together, and don't let go of the lanyard.", 6000);
  }
  private updateZip(dt: number) {
    const z = this.zip, p = this.player; z.t = Math.min(1, z.t + dt / 9);
    const e = Math.pow(z.t, 1.35), zz = 5.5 + (46 - 5.5) * e, lineY = (FB + 2.6) + (0.55 - (FB + 2.6)) * ((zz - 5.5) / (46 - 5.5));
    const y = Math.max(0.4, lineY - 1.7);
    p.pos.set(-5.0, y, zz); p.vel.setAll(0); p.grounded = true;
    const eye = new Vector3(-5.0, y + 1.45, zz);
    p.cam.position.copyFrom(eye); p.cam.setTarget(eye.add(p.lookDir()));
    this.hud.textContent = `GERONIMO LINE   ${Math.max(0, Math.round((y) * 3.281))} FT   HOLD ON\nlook around with the mouse / drag`;
    if (z.t >= 1) {
      z.on = false; this.hud.style.display = "none"; p.ride = false; p.third = this.wasThird;
      p.teleport(-5.0, 0.4, 43.4, Math.PI);
      this.game.ui.toast("TOUCHDOWN", "The Geronimo line works. Now walk back up the ladder.");
      this.game.gain(0.05, 2);
    }
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
    if (top) this.player.teleport(-4.0, FB + 0.12, 0.55, 0); else this.player.teleport(-4.0, F, -0.75, Math.PI);
  }
  private updateClimb(dt: number) {
    const p = this.player, c = this.climb, joy = p.touchMove;
    const dir = (this.k("KeyW", "ArrowUp") ? 1 : 0) - (this.k("KeyS", "ArrowDown") ? 1 : 0) + (joy.y || 0);
    c.y += Math.max(-1, Math.min(1, dir)) * dt * (this.k("ShiftLeft", "ShiftRight") ? 4.6 : 2.3);
    if (c.y >= FB - 0.01 && dir > 0.2) { this.finishClimb(true); return; }
    if (c.y <= F + 0.01 && dir < -0.2) { this.finishClimb(false); return; }
    c.y = Math.max(F, Math.min(FB, c.y));
    p.pos.set(-4.0, c.y, -0.4); p.vel.setAll(0); p.grounded = true;
    const eye = new Vector3(-4.0, c.y + 1.5, -0.42);
    p.cam.position.copyFrom(eye); p.cam.setTarget(eye.add(p.lookDir()));
    this.hud.textContent = `CLIMBING   ${Math.round(c.y * 3.281)} FT\nW/S climb  ·  SHIFT climb faster  ·  keep going to the top or bottom`;
  }

  /** text for the E prompt while riding (null = none) */
  promptLabel(): string | null {
    if (this.zip.on) return null;
    if (this.climb.on) return this.climb.y > FB - 0.4 ? "Step onto the board" : this.climb.y < F + 0.4 ? "Step off the ladder" : null;
    return this.active ? "Get out" : "Stand up";
  }

  /** E while riding */
  leave() {
    if (this.zip.on) { this.game.ui.toast("HOLD ON", "You are on the Geronimo line."); return; }
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
    if (this.exitPop > 0) { this.exitPop -= dt; const k = 1 - Math.max(0, this.exitPop) / 0.35; this.player.body.root.scaling.setAll(0.2 + 0.8 * k * k * (3 - 2 * k)); if (this.exitPop <= 0) this.player.body.root.scaling.setAll(1); }
    this.updatePallet(dt);
    for (const d of this.list) if (d.kind === "drone" && d.returning) this.flyHome(d, dt);
    const kind = this.active?.kind ?? "";
    if (kind !== this.uiKind) {
      const bt = document.querySelectorAll<HTMLButtonElement>("#tlift .td");
      if (bt.length >= 2) { bt[0].innerHTML = kind === "drone" ? "UP &#9650;" : "BOOM &#9650;"; bt[1].innerHTML = kind === "drone" ? "DOWN &#9660;" : "BOOM &#9660;"; }
      this.uiKind = kind; document.body.classList.toggle("driving", !!kind); if (kind) document.body.dataset.veh = kind; else delete document.body.dataset.veh; }
    // idle vehicles keep their boxes / wheels honest
    if (this.zip.on) { this.updateZip(dt); return; }
    if (this.climb.on) { this.updateClimb(dt); return; }
    if (this.chair.on) { this.updateChair(dt); return; }
    const v = this.active;
    if (!v) return;
    const p = this.player, joy = p.touchMove;
    const jyv = v.kind === "drone" ? 0 : (joy.y || 0);          // the drone's stick climbs and descends; its pedals fly it
    const gasIn = Math.max(0, Math.min(1, (this.k("KeyW", "ArrowUp") ? 1 : 0) + Math.max(0, jyv)));
    const brkIn = Math.max(0, Math.min(1, (this.k("KeyS", "ArrowDown") ? 1 : 0) + Math.max(0, -jyv)));
    const str = Math.max(-1, Math.min(1, (this.k("KeyD", "ArrowRight") ? 1 : 0) - (this.k("KeyA", "ArrowLeft") ? 1 : 0) + (joy.x || 0)));
    this.gas += (gasIn - this.gas) * Math.min(1, dt * 9); this.brk += (brkIn - this.brk) * Math.min(1, dt * 9);
    let maxF = v.maxFwd, maxR = v.maxRev;
    if (v.kind === "lift") { const k = 1 - v.lift * 0.75; maxF *= k; maxR *= k; }
    // gas pedal
    if (gasIn > 0) v.speed += (v.speed < -0.3 ? v.accel * 3 : v.accel) * this.gas * dt;
    // brake / reverse pedal: brakes while rolling forward; reverse only after it has been released at a stop
    if (brkIn > 0) {
      if (v.speed > 0.4) { v.speed -= (v.kind === "car" ? 16 : 10) * this.brk * dt; this.revArm = false; }
      else if (this.revArm || v.speed < -0.05) { v.speed -= v.accel * 0.7 * this.brk * dt; this.revArm = true; }
      else v.speed *= Math.max(0, 1 - dt * 10);
    } else if (v.speed < 0.4) this.revArm = true;
    if (gasIn === 0 && brkIn === 0) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), (1.6 + Math.abs(v.speed) * 0.12) * dt);
    v.speed = Math.max(-maxR, Math.min(maxF, v.speed));
    const thr = gasIn - brkIn;
    if (v.kind === "drone") this.flyDrone(v, dt, str); else {
    // steering (speed-sensitive)
    const lock = v.kind === "car" ? 0.62 : 0.75, tgt = -str * lock / (1 + Math.abs(v.speed) * (v.kind === "car" ? 0.07 : 0.05));
    v.steer += (tgt - v.steer) * Math.min(1, dt * 7);
    // kinematic bicycle: yaw rate follows steer angle (screen-right = +yaw)
    const yawRate = (v.speed / v.wheelbase) * Math.tan(-v.steer);
    v.yaw += yawRate * dt;
    v.x += Math.sin(v.yaw) * v.speed * dt; v.z += Math.cos(v.yaw) * v.speed * dt;
    // lift controls
    if (v.kind === "lift") {
      const d = (this.k("KeyR") ? 1 : 0) - (this.k("KeyF") ? 1 : 0); if (d) this.setLift(v, v.lift + d * dt * 0.11);
      const sp = this.k("Space"); if (sp && !this.liftSpace) { this.liftSpace = true; this.jumpOut(v); return; } this.liftSpace = sp;
    }
    if (v.kind === "forklift") {
      const d = (this.k("KeyR") ? 1 : 0) - (this.k("KeyF") ? 1 : 0), e = (this.k("KeyT") ? 1 : 0) - (this.k("KeyG") ? 1 : 0), t = (this.k("KeyY") ? 1 : 0) - (this.k("KeyH") ? 1 : 0);
      if (d || e || t) {
        const old = { l: v.lift, e: v.ext, t: v.tilt };
        v.lift = Math.max(0, Math.min(1, v.lift + d * dt * 0.28)); v.ext = Math.max(0, Math.min(1, v.ext + e * dt * 0.4)); v.tilt = Math.max(-1, Math.min(1, v.tilt + t * dt * 0.9));
        this.setBoom(v);
        if (this.forkPos(v).y < 0.04 && (d < 0 || e)) { v.lift = old.l; v.ext = old.e; this.setBoom(v); }   // forks stop at the ground
      }
      const sp = this.k("Space"); if (sp && !this.spaceWas) this.grab(v); this.spaceWas = sp;
    }
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
    v.steerNodes.forEach((n, i) => { n.rotation.y = -v.steer * v.steerSign[i] * 0.8; });
    // chassis roll / pitch for the big truck
    if (v.kind === "car") { v.root.rotation.z = -v.steer * v.speed * 0.006; v.root.rotation.x = -thr * 0.012 * Math.min(1, Math.abs(v.speed) / 8); }

    }
    // the player rides along (everything else in the game keys off player.pos)
    const y = v.kind === "lift" ? v.platformY : v.kind === "drone" ? v.alt : 0;
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
    const extra = v.kind === "drone" ? "" : v.kind === "forklift" ? `   FORKS ${(this.forkPos(v).y * 3.281).toFixed(0)} ft   REACH ${(v.ext * 3.4 * 3.281).toFixed(0)} ft${this.palletHeld ? "   LOAD ON" : ""}` : v.kind === "lift" ? `   BASKET ${(v.platformY * 3.281).toFixed(0)} ft` : "";
    const bar = (t: number) => "■".repeat(Math.round(t * 5)) + "□".repeat(5 - Math.round(t * 5));
    if (v.kind === "drone") { this.hud.textContent = this.dronePrompt + `   GAS ${bar(this.gas)}  BRAKE ${bar(this.brk)}` + (document.body.classList.contains("touch") ? "" : "\n" + v.controls); return; }
    this.hud.textContent = `${v.name.toUpperCase()}   ${mph} MPH${extra}   GAS ${bar(this.gas)}  BRAKE ${bar(this.brk)}${document.body.classList.contains("touch") ? "" : "\n" + v.controls}`;
  }

  /** quadcopter flight: W/S speed, A/D yaw, R/F climb and descend */
  private flyDrone(v: Veh, dt: number, str: number) {
    v.yaw += str * 1.7 * dt;
    const up = Math.max(-1, Math.min(1, (this.k("KeyR", "Space") ? 1 : 0) - (this.k("KeyF") ? 1 : 0) + (this.player.touchMove.y || 0)));
    v.vy += (up * 5 - v.vy) * Math.min(1, dt * 4);
    v.alt = Math.max(0.14, Math.min(90, v.alt + v.vy * dt)); if (v.alt <= 0.14 && v.vy < 0) v.vy = 0;
    v.x += Math.sin(v.yaw) * v.speed * dt; v.z += Math.cos(v.yaw) * v.speed * dt;
    // collisions: anything solid in the band around the drone's altitude
    let hit = false;
    const q = { x: v.x, z: v.z }, ox = q.x, oz = q.z;
    if (pushOutXZ(this.world, q, v.alt - 0.4, v.radius, 0, 0.8)) { v.x += q.x - ox; v.z += q.z - oz; hit = true; }
    this.dmgCd -= dt;
    const impact = Math.abs(v.speed);
    if (hit && impact > 4 && this.dmgCd <= 0) { this.dmgCd = 2.5; this.game.propertyDamage(impact * 0.6); }
    if (hit && impact > 1.5) v.speed *= -0.25; else if (hit) v.speed *= 0.5;
    // low flying hits people
    if (v.alt < 2.2 && impact > 2) for (const h of this.game.peopleAt()) {
      if (h.y > 2.5) continue;
      if (Math.hypot(h.x - v.x, h.z - v.z) < v.radius + 0.4) { this.game.personStruck(h.name); return; }
    }
    v.root.rotation.x = Math.max(-0.35, Math.min(0.35, v.speed * 0.025)); v.root.rotation.z = -str * 0.18;
    v.rotors.forEach((n, i) => { n.rotation.y += (i % 2 ? 1 : -1) * (v.alt > 0.2 ? 90 : 25) * dt; });
    this.place(v);
    const mph = Math.round(impact * 2.237);
    this.dronePrompt = `${v.name.toUpperCase()}   ALT ${Math.round(v.alt * 3.281)} FT   ${mph} MPH`;
  }
  private dronePrompt = "";

  private updateChair(dt: number) {
    const s = this.game.sim.s, p = this.player, st = this.seats[this.chair.idx];
    p.pos.set(st.pos.x, st.pos.y, st.pos.z); p.vel.setAll(0); p.grounded = true;
    const eye = new Vector3(st.pos.x, F + 1.38, st.pos.z);
    p.cam.position.copyFrom(eye); p.cam.setTarget(eye.add(p.lookDir()));
    const jy = p.touchMove.y || 0, jx = p.touchMove.x || 0;
    const up = Math.max(-1, Math.min(1, (this.k("KeyW", "ArrowUp") ? 1 : 0) - (this.k("KeyS", "ArrowDown") ? 1 : 0) + jy));
    const side = Math.max(-1, Math.min(1, (this.k("KeyD", "ArrowRight") ? 1 : 0) - (this.k("KeyA", "ArrowLeft") ? 1 : 0) + jx));
    if (this.chair.idx === 0) {
      const busy = s.mode === "tripping" || s.mode === "casing";
      if (this.k("Space")) { s.wobTarget = Math.max(0, s.wobTarget - 30 * dt); if (s.auto.on) s.auto.on = false; }   // set the brake: weight comes right off
      else if (up && !s.auto.on && !busy) s.wobTarget = Math.max(0, Math.min(60, s.wobTarget + up * 8 * dt));
      if (side) s.flowTarget = Math.max(400, Math.min(1000, s.flowTarget + side * 150 * dt));
      this.hud.textContent = `DRILLER'S CHAIR — ${s.mode.toUpperCase()}   DEPTH ${Math.round(s.depth).toLocaleString()} ft   ROP ${Math.round(s.rop)} ft/hr\n`
        + `WOB ${s.wob.toFixed(1)} → ${s.wobTarget.toFixed(0)} klbs   PUMP ${Math.round(s.flowTarget)} gpm   SPP ${Math.round(s.spp)} psi   AUTO ${s.auto.on ? "ON" : "OFF"}\n`
        + `W/S weight on bit  ·  A/D pump rate  ·  SPACE brake  ·  T autodriller  ·  E stand up`;
      return;
    }
    // directional driller / MWD seat: pick a toolface and slide to steer; rotating straightens the hole back up
    const d = this.dd, drilling = s.mode === "drilling" && s.rop > 0;
    d.tf = (d.tf + side * 90 * dt + 360) % 360;
    d.sliding = up > 0;
    if (d.sliding && drilling) {
      const rate = s.rop / 3600 * 3.0;                             // deg per foot drilled, scaled by ROP
      d.inc = Math.max(0, Math.min(90, d.inc + Math.cos(d.tf * Math.PI / 180) * rate * dt * 12));
      d.azi = (d.azi + Math.sin(d.tf * Math.PI / 180) * rate * dt * 12 / Math.max(2, Math.sin(Math.max(2, d.inc) * Math.PI / 180) * 20) + 360) % 360;
    } else if (up < 0 && drilling) d.inc = Math.max(0, d.inc - 0.4 * dt);
    d.warned -= dt;
    const off = Math.abs(((d.azi - 270 + 540) % 360) - 180);
    if ((d.inc > 6 || off > 15) && d.warned <= 0) { d.warned = 40; this.game.radio("tex", d.inc > 6 ? "We're building angle, boss. That's a lot of curve for a vertical section." : "Azimuth is wandering off the plan. The lease line is that way.", 6500); }
    this.hud.textContent = `${st.name.toUpperCase()} — ${d.sliding && drilling ? "SLIDING" : "ROTATING"}   INC ${d.inc.toFixed(1)}°   AZI ${d.azi.toFixed(0)}° (plan 270°)   TOOLFACE ${d.tf.toFixed(0)}°\n`
      + `DEPTH ${Math.round(s.depth).toLocaleString()} ft   ROP ${Math.round(s.rop)} ft/hr   ${drilling ? "" : "(drill to see the well respond)"}\n`
      + `A/D set toolface  ·  W hold to slide / steer  ·  S rotate (straighten up)  ·  E stand up`;
  }
}
