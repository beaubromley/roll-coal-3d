import { ParticleSystem, Color4, DynamicTexture, Scene, MeshBuilder, StandardMaterial, Color3, TransformNode, Mesh, Vector3, ShadowGenerator } from "@babylonjs/core";
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
import { RYAW, rv } from "./rigxf";
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
  boxes: AABB[]; boxH: number; solid: boolean; prevTop?: number; vyG?: number; lockedBy?: string; gate?: TransformNode; gateA?: number; gateOpen?: boolean; gy?: number; wasWet?: boolean; air?: boolean; airT?: number; vyEst?: number; slope?: number; base?: { m: Mesh; s: Vector3; r: Vector3 }[]; px?: number; pz?: number; dents?: number; dentCd: number; home?: { x: number; z: number; yaw: number };
  /** backhoe: either driving with the stabilizers up, or dug in with them down (no driving) and the hoe arm working */
  bh?: { tip: TransformNode; dirt: Mesh; load: number; swing: TransformNode; boom: TransformNode; stick: TransformNode; bucket: TransformNode; stabs: TransformNode[]; dig: boolean; stab: number; boomA: number; stickA: number; bucketA: number; swingA: number };
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
  private world: AABB[]; private ramps: AABB[] = []; private coalPS: ParticleSystem[] = []; private pendingJump: { v: Veh; t: number } | null = null; private dalePing = false; private digCd = 0; private coalT = 0; private lastSp = 0;
  /** ground height over the hills; vehicles ride up and down them and pitch with the slope */
  terrain: ((x: number, z: number) => number) | null = null;
  private hud: HTMLElement;
  private wasThird = true;
  private chair = { on: false, hidden: false, idx: 0 };
  /** 0 = driller's chair, 1 / 2 = the directional drillers' seats */
  private seats = [
    { name: "Driller's chair", pos: rv(4.5, F + 0.5, -3.2), yaw: -Math.PI / 2 + RYAW, npc: "driller", off: rv(4.8, F, -1.1) },
    { name: "Directional driller's seat", pos: rv(5.4, F + 0.5, -4.7), yaw: Math.PI / 2 + RYAW, npc: "dd1", off: rv(4.9, F, -3.75) },
  ];
  /** steering the well from the DD seat */
  get dd() { return this.game.dd; }
  private ddKeys: Record<string, boolean> = {};
  private keyOff: (() => void)[] = [];
  private pressed = new Set<string>();
  private dmgCd = 0; private xWas = false;
  private liftSpace = true;
  /** get-in / get-out animation: eased camera, plus the body walking to / from the vehicle */
  private blend: { t: number; dur: number; fromPos: Vector3; fromTgt: Vector3; body?: { from: Vector3; to: Vector3; mode: "in" | "out" } } | null = null;
  private uiKind = "";
  /** pedals: travel 0..1; reverse only engages after the brake has been released at a stop */
  private gas = 0; private brk = 0; private revArm = true; private spaceWas = false;
  private pallets: TransformNode[] = []; private held: TransformNode | null = null; private palletVs: Veh[] = []; private palletVy = new Map<TransformNode, number>();
  private mudPallets = new Set<TransformNode>();
  get palletHeld() { return !!this.held; }
  private climb = { on: false, y: 0 };
  private zip = { on: false, t: 0 };

  private dash: HTMLDivElement;
  constructor(private scene: Scene, private colliders: AABB[], private player: Player, private game: Game) {
    this.world = colliders.filter((c) => !c.ramp); this.ramps = colliders.filter((c) => c.ramp);            // static world only (vehicles don't collide with their own boxes)
    this.hud = document.createElement("div");
    this.hud.style.cssText = "position:fixed;top:96px;left:50%;transform:translateX(-50%);z-index:30;display:none;padding:8px 16px;background:rgba(10,16,24,.78);border:2px solid #f4c04a;color:#fff;font:700 13px/1.45 system-ui,sans-serif;letter-spacing:.5px;text-align:center;pointer-events:none;text-transform:none;white-space:pre-wrap;max-width:94vw";
    document.body.appendChild(this.hud);
    this.dash = document.createElement("div");
    this.dash.style.cssText = "position:fixed;right:22px;bottom:22px;z-index:30;display:none;width:290px;padding:10px 12px 8px;background:rgba(10,16,24,.84);border:2px solid #f4c04a;color:#fff;font:700 12px/1.4 system-ui,sans-serif;letter-spacing:.4px;pointer-events:none";
    document.body.appendChild(this.dash);
    const down = (e: KeyboardEvent) => { this.pressed.add(e.code); if (this.riding && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault(); if (e.code === "Tab" && this.chair.on) { e.preventDefault(); if (!e.repeat) this.game.flipSeat(); } if (e.code === "KeyT" && this.chair.on && this.chair.idx === 0 && !e.repeat) this.toggleAuto(); if (e.code === "KeyC" && this.chair.on && this.chair.idx === 0 && !e.repeat && !this.game.ui.panelOpen) this.game.openCabin(); };
    const up = (e: KeyboardEvent) => this.pressed.delete(e.code);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", () => this.pressed.clear());
    this.build();
  }

  get riding() { return !!this.active || this.chair.on || this.climb.on || this.zip.on; }
  private k(...codes: string[]) { return codes.some((c) => this.pressed.has(c)); }

  setShadow(sg: ShadowGenerator) { for (const v of [...this.list, ...this.palletVs]) v.casters.forEach((m) => sg.addShadowCaster(m)); }

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
      lift: 0, ext: 0, tilt: 0, casters: [], controls: "", platformY: 0, alt: 0, vy: 0, rotors: [], returning: false, dentCd: 0 };
  }

  private build() {
    this.list.push(this.buildF250(-14.0, 40.0, Math.PI * 1.5 + RYAW));
    this.list.push(this.buildForklift(-45, 10, -Math.PI / 2));
    this.list.push(this.buildManlift(-7, 13, 0.4));
    this.buildPallet(-46.5, -9, -Math.PI / 2);
    for (let i = 0; i < 8; i++) this.buildPallet(11.9 + i * 2.3, -61.4, i % 2 ? 0.04 : -0.03, true);   // mud products in the yard
    this.list.push(this.buildBackhoe(-42, -61, 0));   // parked by the cuttings pit under the shakers
    this.list.push(this.buildBeater(-48.5, 229, Math.PI / 2 + 0.25));   // Hank's old pickup, beside the farmhouse
    this.list.push(this.buildDrone(-20.5, 36.4, Math.PI / 2 + RYAW));
    for (const v of this.list) {
      v.home = { x: v.x, z: v.z, yaw: v.yaw };
      for (let i = 0; i < v.pts.length; i++) { const b: AABB = { x0: 0, x1: 0, y0: 0, y1: v.boxH, z0: 0, z1: 0 }; v.boxes.push(b); this.colliders.push(b); }
      this.place(v);
    }
  }

  /** Hank's old pickup: a faded, rust-spotted stock-height beater, with a mismatched door, a cracked windshield and a crooked bumper. It runs. Mostly. */
  private buildBeater(x: number, z: number, yaw: number): Veh {
    const v = this.blank("hank", "Hank's old pickup", "car", x, z, yaw), r = v.root;
    Object.assign(v, { wheelbase: 3.3, maxFwd: 21, maxRev: 6, accel: 5, radius: 1.0, pts: [1.5, 0, -1.8], camDist: 11, camHeight: 3.4, eye: { x: -0.42, y: 2.05, z: 0.05 }, boxH: 2.2, lockedBy: "hankFriend",
      controls: "W gas  ·  S brake / reverse  ·  A/D steer  ·  SPACE handbrake  ·  V camera  ·  E get out" });
    const PAINT = "#7c4a2e", RUST = "#5a3320", DOOR = "#56705a", GLASS = "#9fb4b8";
    this.box(v, r, "#1c1d20", 1.45, 0.25, 4.6, 0, 0.62, -0.1);                              // frame
    this.box(v, r, PAINT, 1.95, 0.55, 4.7, 0, 0.98, -0.1);                                  // lower body
    const hood = this.box(v, r, "#6e432a", 1.85, 0.3, 1.5, 0, 1.38, 1.45); hood.rotation.x = 0.03;
    this.box(v, r, "#15161a", 1.4, 0.4, 0.1, 0, 1.12, 2.22);                                // grille
    this.box(v, r, "#8a8378", 1.9, 0.18, 0.2, 0, 0.72, 2.4).rotation.z = 0.05;               // crooked front bumper
    this.box(v, r, "#8a8378", 1.9, 0.16, 0.2, 0, 0.74, -2.5);                               // rear bumper
    for (const s of [-1, 1]) this.cyl(v, r, "#d8d4c0", 0.3, 0.1, s * 0.62, 1.22, 2.25, "z", 12);   // round headlights, a little yellow
    this.box(v, r, PAINT, 1.8, 0.9, 1.5, 0, 1.78, -0.35);                                   // cab
    this.box(v, r, "#2a2d31", 1.84, 0.07, 1.55, 0, 2.28, -0.35);                            // roof
    this.box(v, r, GLASS, 1.7, 0.55, 0.06, 0, 1.85, 0.42, { alpha: 0.5 });                  // windshield
    this.box(v, r, "#15161a", 0.04, 0.4, 0.05, 0.3, 1.86, 0.44).rotation.z = 0.7;            // a crack
    this.box(v, r, GLASS, 1.84, 0.5, 1.1, 0, 1.85, -0.4, { alpha: 0.45 });                  // side windows
    this.box(v, r, DOOR, 0.06, 0.8, 0.9, 0.93, 1.35, -0.05);                                // the right door came off another truck
    this.box(v, r, RUST, 0.06, 0.3, 0.5, -0.93, 1.15, 0.1); this.box(v, r, RUST, 0.7, 0.05, 0.6, 0.3, 1.66, 1.55);   // rust patches
    for (const s of [-1, 1]) { this.box(v, r, PAINT, 0.12, 0.5, 2.0, s * 0.94, 1.25, -2.0); this.box(v, r, "#4a4c52", 0.1, 0.4, 0.5, s * 0.96, 0.95, 1.15); }   // bed sides, front fenders
    this.box(v, r, "#2a2d31", 1.7, 0.08, 2.1, 0, 1.0, -2.0);                                // bed floor
    this.box(v, r, PAINT, 1.9, 0.5, 0.1, 0, 1.25, -0.99);                                   // headboard
    this.box(v, r, RUST, 0.4, 0.4, 0.12, -0.5, 1.15, -3.1).rotation.z = 0.2;                 // half a tailgate
    this.cyl(v, r, "#555a60", 0.1, 1.2, 0.55, 1.65, -1.0, "y", 8, { spec: 0.4 });            // one exhaust stack
    const W = 0.84;
    for (const s of [-1, 1]) { this.wheel(v, r, s * 0.95, W / 2, 1.5, W, 0.3, 1, "#6a6e75"); this.wheel(v, r, s * 0.95, W / 2, -1.7, W, 0.3, null, "#6a6e75"); }
    return v;
  }

  private buildF250(x: number, z: number, yaw: number): Veh {
    const v = this.blank("f250", "Lifted F-250", "car", x, z, yaw), r = v.root;
    Object.assign(v, { wheelbase: 5.0, maxFwd: 40.2, maxRev: 8, accel: 9, radius: 1.15, pts: [2.0, 0, -2.0, -3.4], camDist: 14, camHeight: 4.6, eye: { x: -0.5, y: 2.9, z: 0.15 }, boxH: 2.6,
      controls: "W gas  ·  S brake / reverse  ·  A/D steer  ·  SPACE handbrake  ·  V camera  ·  E get out" });
    const BODY = "#9c1c16", CH = "#c4c8ce", EXT = 1.5;                            // EXT: a proper long bed
    this.box(v, r, "#22262c", 1.5, 0.28, 5.6 + EXT, 0, 1.05, -EXT / 2);          // frame rails
    for (const az of [2.0, -2.0 - 1.0]) { this.cyl(v, r, "#2a2d31", 0.28, 2.3, 0, 0.66, az, "x", 10); this.cyl(v, r, "#555a60", 0.22, 0.9, 0.8, 0.92, az, "y", 8); this.cyl(v, r, "#555a60", 0.22, 0.9, -0.8, 0.92, az, "y", 8); }
    this.box(v, r, BODY, 2.15, 0.7, 5.9 + EXT, 0, 1.6, -0.1 - EXT / 2);             // lower body
    this.box(v, r, BODY, 2.05, 0.42, 1.85, 0, 2.15, 1.95);                       // hood
    this.box(v, r, "#1b1f25", 0.9, 0.12, 1.2, 0, 2.38, 2.0);                     // hood scoop
    this.box(v, r, BODY, 2.1, 1.0, 1.9, 0, 2.45, -0.35);                         // cab
    this.box(v, r, "#0e1114", 2.14, 0.08, 1.95, 0, 2.99, -0.35);                 // roof
    this.box(v, r, "#9fc3d6", 2.12, 0.55, 1.5, 0, 2.55, -0.3, { alpha: 0.55 });  // side + rear windows
    this.box(v, r, "#9fc3d6", 1.8, 0.5, 0.06, 0, 2.55, 0.64, { alpha: 0.55 });   // windshield
    for (const s of [-1, 1]) {                                                    // bed walls
      this.box(v, r, BODY, 0.12, 0.62, 2.7 + EXT, s * 1.02, 2.15, -2.0 - EXT / 2);
      this.box(v, r, "#2a2d31", 0.14, 0.05, 2.72 + EXT, s * 1.02, 2.5, -2.0 - EXT / 2);
      this.box(v, r, CH, 0.18, 0.5, 0.1, s * 1.05, 1.25, 0.95, { spec: 0.6 });   // running boards stay chrome
      this.box(v, r, CH, 0.4, 0.07, 1.6, s * 1.25, 1.2, -0.3, { spec: 0.6 });
    }
    this.box(v, r, BODY, 2.1, 0.62, 0.12, 0, 2.15, -3.32 - EXT);                 // tailgate
    this.box(v, r, "#0b0d10", 1.9, 0.08, 2.6 + EXT, 0, 1.9, -2.0 - EXT / 2);     // bed floor
    this.box(v, r, BODY, 2.1, 0.62, 0.12, 0, 2.15, -0.68);                       // bed headboard
    for (const s of [-1, 1]) this.box(v, r, BODY, 0.3, 0.5, 1.3, s * 1.05, 1.95, -3.0, { spec: 0.1 });   // rear fenders
    this.box(v, r, CH, 2.35, 0.34, 0.3, 0, 1.2, 3.05, { spec: 0.7 });            // front bumper
    this.box(v, r, CH, 2.35, 0.3, 0.3, 0, 1.2, -3.3 - EXT, { spec: 0.7 });        // rear bumper
    this.box(v, r, "#0b0d10", 1.3, 0.5, 0.1, 0, 1.95, 2.9);                      // grille
    this.box(v, r, CH, 1.4, 0.05, 0.12, 0, 2.2, 2.93, { spec: 0.7 });
    for (const s of [-1, 1]) {
      this.box(v, r, "#fff6c8", 0.4, 0.2, 0.08, s * 0.8, 2.0, 2.93, { emissive: 0.8 });   // headlights
      this.box(v, r, "#ff2a1a", 0.22, 0.26, 0.08, s * 0.92, 2.1, -3.37 - EXT, { emissive: 0.7 }); // tail lights
      this.box(v, r, BODY, 0.1, 0.16, 0.26, s * 1.16, 2.7, 0.55);                // mirrors
      this.cyl(v, r, CH, 0.12, 2.6, s * 1.0, 2.9, -1.05, "y", 8, { spec: 0.7 });   // dual stacks
    }
    this.box(v, r, "#ffe9a8", 1.5, 0.12, 0.22, 0, 3.12, 0.4, { emissive: 0.9 });  // roof light bar
    for (let i = 0; i < 4; i++) this.cyl(v, r, "#ffe9a8", 0.2, 0.06, -0.55 + i * 0.37, 2.4, 3.0, "z", 10, { emissive: 0.9 }); // bumper pods
    this.box(v, r, "#14171c", 0.5, 0.25, 0.04, 0, 1.65, -3.4 - EXT);
    // the dual stacks can roll coal: two black plumes from the stack tops when you floor it
    { const tex = new DynamicTexture("coalT", { width: 64, height: 64 }, this.scene, false); const c = tex.getContext() as CanvasRenderingContext2D, gr = c.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.5, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); tex.hasAlpha = true; tex.update();
      for (const s of [-1, 1]) {
        const em = MeshBuilder.CreateBox("stackem", { size: 0.05 }, this.scene); em.parent = r; em.position.set(s * 1.0, 4.25, -1.05); em.isVisible = false; em.isPickable = false;
        const ps = new ParticleSystem("truckcoal", 160, this.scene); ps.particleTexture = tex; ps.emitter = em;
        ps.minEmitBox = new Vector3(-0.05, 0, -0.05); ps.maxEmitBox = new Vector3(0.05, 0, 0.05);
        ps.direction1 = new Vector3(-0.15, 1, -0.5); ps.direction2 = new Vector3(0.15, 1.3, -0.1);
        ps.minEmitPower = 3; ps.maxEmitPower = 6; ps.minLifeTime = 1.2; ps.maxLifeTime = 2.6; ps.minSize = 0.5; ps.maxSize = 1.1; ps.addSizeGradient(0, 0.5); ps.addSizeGradient(1, 3.0);
        ps.color1 = new Color4(0.03, 0.03, 0.03, 0.85); ps.color2 = new Color4(0.1, 0.1, 0.09, 0.7); ps.colorDead = new Color4(0.2, 0.2, 0.2, 0);
        ps.gravity = new Vector3(0, 0.6, 0); ps.minAngularSpeed = -0.8; ps.maxAngularSpeed = 0.8; ps.blendMode = ParticleSystem.BLENDMODE_STANDARD; ps.emitRate = 0; ps.updateSpeed = 0.02;
        ps.start(); this.coalPS.push(ps);
      } }
    const W = 1.35;
    for (const s of [-1, 1]) { this.wheel(v, r, s * 1.12, W / 2, 2.0, W, 0.55, 1); this.wheel(v, r, s * 1.12, W / 2, -3.0, W, 0.55, null); }
    return v;
  }

  /** Backhoe-loader: front bucket, rear hoe folded up, stabilizer legs, enclosed cab. Forward is +z. */
  private buildBackhoe(x: number, z: number, yaw: number): Veh {
    const v = this.blank("backhoe", "Backhoe", "car", x, z, yaw), r = v.root;
    Object.assign(v, { wheelbase: 2.4, maxFwd: 11, maxRev: 5, accel: 4, radius: 1.3, pts: [2.0, 0, -2.2], camDist: 12, camHeight: 4.0, eye: { x: 0, y: 2.25, z: -0.15 }, boxH: 2.6,
      controls: "W gas  ·  S brake / reverse  ·  A/D steer  ·  SPACE handbrake  ·  X dig / drive (dig: WASD + arrows)  ·  V camera  ·  E get out" });
    const Y = "#e8b100", D = "#2a2d31", G = "#9fc3d6", H = "#bfc3c8";
    this.box(v, r, D, 1.5, 0.3, 4.2, 0, 0.7, -0.2);                                  // frame
    this.box(v, r, Y, 2.0, 0.7, 3.0, 0, 1.15, -0.3);                                 // body
    this.box(v, r, Y, 1.5, 0.55, 1.4, 0, 1.35, 1.4);                                 // engine hood
    this.box(v, r, D, 1.2, 0.08, 0.9, 0, 1.66, 1.4);                                 // hood vent
    this.box(v, r, "#0b0d10", 1.3, 0.35, 0.1, 0, 1.3, 2.15);                         // grille
    this.cyl(v, r, H, 0.12, 0.9, 0.55, 2.0, 1.9, "y", 8, { spec: 0.7 });             // exhaust stack
    // cab: glass box with dark pillars and a roof, and a seat inside
    this.box(v, r, G, 1.7, 1.45, 1.6, 0, 2.1, -0.3, { alpha: 0.45 });
    for (const sx of [-0.84, 0.84]) for (const sz of [-1.05, 0.45]) this.box(v, r, D, 0.08, 1.5, 0.08, sx, 2.1, sz);
    this.box(v, r, D, 1.9, 0.1, 1.85, 0, 2.88, -0.3);
    this.box(v, r, "#3b3f46", 0.7, 0.15, 0.6, 0, 1.58, -0.15);                       // seat cushion
    this.box(v, r, "#3b3f46", 0.7, 0.55, 0.12, 0, 1.9, -0.5);                        // seat back
    this.box(v, r, "#ffe9a8", 1.0, 0.1, 0.2, 0, 2.97, 0.4, { emissive: 0.9 });       // work light
    // front loader: two lift arms, a wide bucket on a hinge, hydraulic rams
    for (const sx of [-1, 1]) {
      const arm = this.box(v, r, Y, 0.16, 0.22, 2.6, sx * 1.02, 1.05, 2.0); arm.rotation.x = 0.1;
      this.cyl(v, r, H, 0.1, 1.3, sx * 0.9, 1.35, 1.7, "z", 8, { spec: 0.7 });
    }
    this.box(v, r, Y, 2.3, 0.5, 0.18, 0, 0.5, 3.35);                                 // bucket back
    this.box(v, r, Y, 2.3, 0.08, 0.7, 0, 0.27, 3.6);                                 // bucket floor
    for (const sx of [-1.14, 1.14]) this.box(v, r, Y, 0.06, 0.45, 0.7, sx, 0.5, 3.6);
    this.box(v, r, H, 2.3, 0.05, 0.1, 0, 0.26, 3.98, { spec: 0.6 });                  // cutting edge
    // rear hoe: a swing frame carrying a boom, a stick and a bucket, each on its own pivot so the arm can really dig
    const swing = new TransformNode("hoeSwing", this.scene); swing.parent = r; swing.position.set(0, 1.5, -2.0);
    this.box(v, swing, D, 1.1, 0.6, 0.8, 0, -0.3, 0);
    const boom = new TransformNode("hoeBoom", this.scene); boom.parent = swing; boom.position.set(0, 0.15, -0.3);
    this.box(v, boom, Y, 0.3, 0.3, 2.6, 0, 0, -1.3);
    this.cyl(v, boom, H, 0.1, 1.2, 0.22, 0.12, -0.8, "z", 8, { spec: 0.7 });
    const stick = new TransformNode("hoeStick", this.scene); stick.parent = boom; stick.position.set(0, 0, -2.6);
    this.box(v, stick, Y, 0.24, 0.24, 2.0, 0, 0, -1.0);
    const bucket = new TransformNode("hoeBucket", this.scene); bucket.parent = stick; bucket.position.set(0, 0, -2.0);
    this.box(v, bucket, D, 0.7, 0.5, 0.55, 0, -0.18, -0.12); this.box(v, bucket, H, 0.7, 0.06, 0.1, 0, -0.45, -0.3, { spec: 0.6 });
    const tip = new TransformNode("hoeTip", this.scene); tip.parent = bucket; tip.position.set(0, -0.45, -0.42);   // the cutting edge
    const dirt = this.box(v, bucket, "#6e5238", 0.58, 0.3, 0.4, 0, -0.28, -0.2); dirt.isVisible = false;   // dirt in the bucket
    const stabs: TransformNode[] = [];
    for (const sx of [-1, 1]) {   // stabilizers: a leg and pad on a hinge at the frame, folded up for driving and swung down to dig in
      const st = new TransformNode("stab", this.scene); st.parent = r; st.position.set(sx * 1.2, 0.95, -2.1); stabs.push(st);
      this.box(v, st, Y, 0.2, 0.2, 0.9, sx * 0.1, 0, 0);
      this.box(v, st, D, 0.18, 0.9, 0.18, sx * 0.5, -0.45, 0); this.box(v, st, D, 0.7, 0.08, 0.7, sx * 0.5, -0.9, 0);
    }
    v.bh = { tip, dirt, load: 0, swing, boom, stick, bucket, stabs, dig: false, stab: 0, boomA: 0.55, stickA: 1.9, bucketA: 0.9, swingA: 0 };
    this.poseHoe(v);
    // wheels: small steered fronts, big rears
    for (const s of [-1, 1]) { this.wheel(v, r, s * 0.98, 0.5, 1.4, 1.0, 0.42, 1); this.wheel(v, r, s * 1.05, 0.8, -1.0, 1.6, 0.6, null); }
    return v;
  }

  /** Quadcopter on its dock beside the company man trailer. */
  private buildDrone(x: number, z: number, yaw: number): Veh {
    const v = this.blank("drone", "Survey Drone", "drone", x, z, yaw), r = v.root;
    Object.assign(v, { radius: 0.6, pts: [0], boxH: 0.5, camDist: 7, camHeight: 1.2, eye: { x: 0, y: 0, z: 0.35 }, maxFwd: 17, maxRev: 8, accel: 8, alt: 0.14, dock: { x, z, yaw },
      controls: "W/S up / down  ·  A/D turn  ·  ↑ fly forward  ·  ↓ brake / back up  ·  V camera  ·  E redock" });
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

  private buildPallet(x: number, z: number, yaw: number, mud = false) {
    const v = this.blank("pallet", mud ? "Mud pallet" : "Pipe pallet", "car", x, z, yaw); this.palletVs.push(v);
    const r = v.root; this.pallets.push(r); if (mud) this.mudPallets.add(r);
    this.box(v, r, "#8a6a40", 1.5, 0.14, 1.2, 0, 0.12, 0);
    for (const sx of [-0.6, 0, 0.6]) this.box(v, r, "#6e5230", 0.18, 0.12, 1.2, sx, 0.05, 0);
    if (mud) {
      const cols = ["#d9d3c2", "#b9b3a2", "#c8a870", "#9aa0a8"];
      for (let layer = 0; layer < 4; layer++) for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) {
        this.box(v, r, cols[(i + k + layer) % 4], 0.46, 0.2, 0.52, -0.5 + i * 0.5 + (layer % 2) * 0.03, 0.29 + layer * 0.21, -0.28 + k * 0.56);
      }
      this.box(v, r, "#e8b923", 1.46, 0.03, 0.04, 0, 1.08, 0.2);   // strap
      return;
    }
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
    const f = this.forkPos(v);
    if (!this.held) {
      let best: TransformNode | null = null, bd = 1.4;
      for (const pl of this.pallets) {
        const pp = pl.getAbsolutePosition(), d = Math.hypot(f.x - pp.x, f.z - pp.z);
        if (d < bd && Math.abs(f.y - (pp.y + 0.1)) < 0.6) { bd = d; best = pl; }
      }
      if (best) {
        best.setParent(v.tiltNode!); this.held = best; this.palletVy.set(best, 0); this.game.sfx.click();
        this.game.ui.toast(this.mudPallets.has(best) ? "MUD PALLET LOADED" : "PIPE PALLET LOADED", "Boom up, tilt back, and mind the people.");
      } else this.game.ui.toast("NO LOAD", "Drive the forks under a pallet, level with it, then press SPACE.");
      return;
    }
    const pl = this.held, h = pl.getAbsolutePosition().y;
    pl.setParent(null); this.held = null; this.palletVy.set(pl, 0);
    const fw = pl.getDirection(Vector3.Forward()); pl.rotationQuaternion = null; pl.rotation.set(0, Math.atan2(fw.x, fw.z), 0);
    this.game.sfx.click();
    if (this.mudPallets.has(pl)) this.game.mudPalletSet(pl.position.x, pl.position.z);
    if (h > 1.5) { this.game.inc(1, "DROPPED OBJECT"); this.game.sim.addCost(12000); this.game.radio("earl", "That pallet came off the forks from " + Math.round(h * 3.28) + " feet. Set it down, don't drop it.", 7000); }
  }
  private updatePallet(dt: number) {
    for (const pl of this.pallets) {
      if (pl === this.held) continue;
      const p = pl.position;
      if (p.y > 0.001) { const vy = (this.palletVy.get(pl) ?? 0) - 9.8 * dt; p.y = Math.max(0, p.y + vy * dt); this.palletVy.set(pl, p.y === 0 ? 0 : vy); }
    }
  }

  private sphere(v: Veh, p: TransformNode, hex: string, dia: number, x: number, y: number, z: number, em = 0) {
    return this.mk(v, MeshBuilder.CreateSphere("vs", { diameter: dia, segments: 8 }, this.scene), hex, p, x, y, z, em ? { emissive: em } : {});
  }

  private buildManlift(x: number, z: number, yaw: number): Veh {
    const v = this.blank("manlift", "Scissor Manlift", "lift", x, z, yaw), r = v.root;
    Object.assign(v, { wheelbase: 2.4, maxFwd: 3.2, maxRev: 2.4, accel: 2.5, radius: 0.95, pts: [0.9, -0.9], camDist: 14, camHeight: 4.8, eye: { x: 0, y: 1.6, z: 0.1 }, boxH: 1.3,
      controls: "W gas  ·  S brake / reverse  ·  A/D steer  ·  R/F raise / lower the basket  ·  E opens the gate (at height)  ·  SPACE jump out" });
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
    for (const sx of [-0.88, 0.88]) for (const sz of [-1.3, 0, 1.3]) { if (sx > 0 && sz === 0) continue; this.box(v, plat, rail, 0.06, 1.1, 0.06, sx, 0.58, sz); }
    for (const y of [0.55, 1.12]) this.box(v, plat, rail, 0.05, 0.05, 2.62, -0.88, y, 0);
    // the right-hand side is a gate on a hinge at the back corner post: it swings open when you get out
    const gate = new TransformNode("basketGate", this.scene); gate.parent = plat; gate.position.set(0.88, 0, -1.3);
    for (const y of [0.55, 1.12]) this.box(v, gate, rail, 0.05, 0.05, 2.6, 0, y, 1.3);
    this.box(v, gate, rail, 0.06, 1.1, 0.06, 0, 0.58, 1.3);
    v.gate = gate; v.gateA = 0; v.gateOpen = false;
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
    for (const v of this.list) if (v.lockedBy) out.push({ pos: () => new Vector3(v.x, 1.4, v.z), label: () => "Hank's old pickup (ask Hank first)", r: 4.2, ok: () => !this.riding && !this.game.flags[v.lockedBy!], act: () => { this.game.sfx.click(); this.game.ui.toast("HANK'S TRUCK", "It's Hank's. Make friends with Hank and he'll hand you the keys."); } });
    for (const v of this.list) out.push({ pos: () => new Vector3(v.x, 1.4, v.z), label: () => v.kind === "drone" ? "Pilot the drone" : `Drive the ${v.name}`, r: v.kind === "car" ? 4.2 : v.kind === "drone" ? 3.2 : 3.4, act: () => this.enter(v), ok: () => !this.riding && !v.returning && (!v.lockedBy || !!this.game.flags[v.lockedBy]) });
    out.push({ pos: () => rv(0, FB + 1.0, 5.2), label: () => "Ride the Geronimo line (emergency escape)", r: 2.0, act: () => this.startZip(), ok: () => !this.riding && this.player.pos.y > FB - 1 });
    this.seats.forEach((st, i) => out.push({ pos: () => new Vector3(st.pos.x, F + 1.0, st.pos.z), label: () => i === 0 ? "Sit in the driller's chair" : "Sit in the directional driller's seat", r: i === 0 ? 2.6 : 1.5, act: () => this.sit(i), ok: () => !this.riding }));
    out.push({ pos: () => rv(-3.62, F + 1.2, 2.4), label: () => "Climb the ladder to the monkey board", r: 1.9, act: () => this.startClimb(F), ok: () => !this.riding && this.player.pos.y < F + 3 && this.player.pos.y > F - 0.5 });
    out.push({ pos: () => rv(-3.0, FB + 1.2, 2.3), label: () => "Climb down to the drill floor", r: 2.0, act: () => this.startClimb(FB), ok: () => !this.riding && this.player.pos.y > FB - 1 });
    return out;
  }

  private place(v: Veh) {
    v.root.position.set(v.x, v.kind === "drone" ? v.alt : v.gy ?? 0, v.z); v.root.rotation.y = v.yaw;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    v.pts.forEach((o, i) => {
      const b = v.boxes[i], cx = v.x + fx * o, cz = v.z + fz * o, h = v.radius * 0.85;
      b.x0 = cx - h; b.x1 = cx + h; b.z0 = cz - h; b.z1 = cz + h; b.y1 = v.solid ? v.boxH : 0;
    });
  }
  /** apply the backhoe's arm angles and stabilizer position to its pivots */
  /** the circles that make up the active vehicle's body (for things it can run over), and how fast it is going */
  footprint(): { x: number; z: number; r: number; y: number; speed: number } | null { const v = this.active; if (!v || v.kind === "drone") return null; return { x: v.x, z: v.z, r: v.radius, y: v.gy ?? 0, speed: Math.abs(v.speed) }; }
  bodyCircles(): { x: number; z: number; r: number }[] { const v = this.active; if (!v) return []; return v.pts.map((o) => ({ x: v.x + Math.sin(v.yaw) * o, z: v.z + Math.cos(v.yaw) * o, r: v.radius })); }
  /** knock the speed off whatever you're driving (a cow, a fence, a bad decision) */
  slow(f: number) { if (this.active) this.active.speed *= f; }
  private poseHoe(v: Veh) {
    const h = v.bh; if (!h) return;
    if (!this.game.outskirts.diggingOn) { this.game.ui.toast("NO DIGGING", "The landowner won't let anyone dig up the lease. The backhoe is just a backhoe."); return; }
    h.swing.rotation.y = h.swingA; h.boom.rotation.x = -h.boomA; h.stick.rotation.x = h.stickA; h.bucket.rotation.x = h.bucketA;
    h.stabs.forEach((s, i) => { s.rotation.z = (i ? -1 : 1) * (1 - h.stab) * 1.45; });   // 0 = folded up and in, 1 = planted
  }
  /** dig mode: swing with A/D, boom R/F, stick T/G, bucket Y/H. Legs ease down or up with the mode. */
  private hoe(v: Veh, dt: number) {
    const h = v.bh; if (!h) return;
    h.stab += ((h.dig ? 1 : 0) - h.stab) * Math.min(1, dt * 2.5);
    if (h.dig && h.stab > 0.9) {
      const d = (a: string, b: string) => (this.k(a) ? 1 : 0) - (this.k(b) ? 1 : 0), cl = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
      // WASD first: W/S lower and raise the boom, A/D swing the arm. The arrow keys are the second stick: up/down reach the stick out and in, left/right open and curl the bucket.
      // (R/F, T/G and Y/H still work as before)
      h.boomA = cl(h.boomA + (d("KeyW", "KeyS") + d("KeyR", "KeyF")) * dt * 0.7, -0.35, 1.0);
      h.stickA = cl(h.stickA + (d("ArrowDown", "ArrowUp") + d("KeyG", "KeyT")) * dt * 0.9, 0.4, 2.3);
      h.bucketA = cl(h.bucketA + (d("ArrowRight", "ArrowLeft") + d("KeyY", "KeyH")) * dt * 1.2, -0.4, 1.7);
      h.swingA = cl(h.swingA + d("KeyA", "KeyD") * dt * 0.8, -1.3, 1.3);
    }
    this.poseHoe(v);
    // digging: when the cutting edge goes below the ground inside the dig site it scrapes dirt into the bucket; open the bucket over the ground to dump a mound
    if (h.dig && h.stab > 0.9) {
      for (const n of [v.root, h.swing, h.boom, h.stick, h.bucket, h.tip]) n.computeWorldMatrix(true);
      const o = this.game.outskirts, tp = h.tip.getAbsolutePosition(), inSite = o.inDig(tp.x, tp.z), ground = inSite ? o.digHeight(tp.x, tp.z) : 0, CAP = 3;
      this.digCd -= dt;
      if (tp.y < ground - 0.03 && inSite) {
        const got = o.digAt(tp.x, tp.y, tp.z, dt);
        if (got > 0.002) { h.load = Math.min(CAP, h.load + got); if (this.digCd <= 0) { this.digCd = 0.45; this.game.sfx.thud(); } }
        if (h.load >= CAP - 0.01 && this.digCd <= 0) { this.digCd = 2.5; this.game.ui.toast("BUCKET FULL", "Swing over and open the bucket (Y/H) to dump a mound."); }
      } else if (tp.y < 0 && !inSite && this.digCd <= 0) { this.digCd = 4; this.game.ui.toast("DIG SITE ONLY", "The landowner would like his lease back in one piece. Dig inside the marked dig site by the gate road."); }
      else if (h.load > 0.01 && h.bucketA < 0.25 && tp.y > ground - 0.2) {
        if (inSite) { const amt = Math.min(h.load, 1.6 * dt); o.pileAt(tp.x, tp.z, amt); h.load -= amt; } else if (this.digCd <= 0) { this.digCd = 4; this.game.ui.toast("DUMP IT IN THE DIG SITE", "Open the bucket over the marked ground, not the lease."); }
      }
      h.dirt.isVisible = h.load > 0.02; h.dirt.scaling.y = 0.2 + (h.load / CAP) * 1.1;
    }
  }
  /** X swaps the backhoe between driving (legs up) and digging (legs down, parked) */
  private swapHoe(v: Veh) {
    const h = v.bh; if (!h) return;
    if (!h.dig && Math.abs(v.speed) > 1.5) { this.game.ui.toast("TOO FAST", "Slow to a stop before setting the stabilizers."); return; }
    h.dig = !h.dig;
    this.game.ui.toast(h.dig ? "DIG MODE" : "DRIVE MODE", h.dig ? "Stabilizers down, no driving. W/S boom · A/D swing · arrows: ↑↓ stick, ←→ bucket (curl to scoop, open to dump). Put the edge into the ground away from the pad, road and buildings · X to drive." : "Stabilizers up. X to dig again.");
    this.game.sfx.click();
  }
  /** a crash crumples the panels it hit: nearby body parts are pushed in, squashed along the impact direction and knocked slightly out of true. Nothing is added to the truck. */
  private dent(v: Veh, px: number, pz: number, o: number, speed: number) {
    if (v.id !== "f250") return;
    const len = Math.hypot(px, pz) || 1, dx = -px / len, dz = -pz / len;           // direction from the truck toward what it hit (world)
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const df = dx * fx + dz * fz, dr = dx * rx + dz * rz;                          // in the truck's own frame: forward, right
    const big = Math.min(1, speed / 14), r = (a: number) => (Math.random() - 0.5) * a;
    // where it hit, in the truck's frame
    let hx: number, hy = 1.9, hz: number;
    if (Math.abs(df) > 0.65) { hz = df > 0 ? 3.1 : -4.88; hx = Math.max(-0.95, Math.min(0.95, dr * 0.9)); }
    else { hx = dr > 0 ? 1.1 : -1.1; hz = Math.max(-4.2, Math.min(2.6, o)); }
    const inX = -dr, inZ = -df, il = Math.hypot(inX, inZ) || 1, ix = inX / il, iz = inZ / il;
    const parts = v.root.getChildren().filter((n) => n instanceof Mesh) as Mesh[];
    if (!v.base) v.base = parts.map((m) => ({ m, s: m.scaling.clone(), r: m.rotation.clone() }));
    for (const part of parts) {
      const p = part.position, dist = Math.hypot(p.x - hx, (p.y - hy) * 0.7, p.z - hz), w = Math.exp(-((dist / 2.3) ** 2));
      if (w < 0.04) continue;
      const a = w * (0.1 + 0.2 * big), base = v.base.find((b) => b.m === part);
      p.x += ix * a * 0.6; p.z += iz * a * 0.6;                                      // pushed in
      if (Math.abs(ix) > Math.abs(iz)) part.scaling.x = Math.max((base?.s.x ?? 1) * 0.55, part.scaling.x * (1 - a * 0.7)); else part.scaling.z = Math.max((base?.s.z ?? 1) * 0.55, part.scaling.z * (1 - a * 0.7));   // squashed
      const lim = 0.5, br = base?.r;
      part.rotation.x = br ? Math.max(br.x - lim, Math.min(br.x + lim, part.rotation.x + r(a * 1.2))) : part.rotation.x;   // buckled
      part.rotation.z = br ? Math.max(br.z - lim, Math.min(br.z + lim, part.rotation.z + r(a * 1.4))) : part.rotation.z;
      part.rotation.y = br ? Math.max(br.y - lim, Math.min(br.y + lim, part.rotation.y + r(a * 0.9))) : part.rotation.y;
    }
    v.dents = (v.dents ?? 0) + 1;
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
    if (k >= 1) {
      this.blend = null; const showBody = !!this.active && this.showsDriver(this.active);
      this.player.bodyHold = showBody; this.player.body.root.scaling.setAll(1);
      if ((this.active && !showBody) || this.chair.on || this.climb.on || this.zip.on) this.player.body.root.setEnabled(false);
    }
  }

  /** who is visible at the controls: everything except the drone and the lifted pickup (the cab is too low for a hard hat) */
  private showsDriver(v: Veh) { return v.kind !== "drone" && v.id !== "f250" && v.id !== "hank"; }   // (the trucks are closed cabs: no driver poking out of the roof)

  enter(v: Veh) {
    if (this.riding) return;
    const here = this.player.pos.clone();
    this.startBlend(0.6, { from: here, to: new Vector3(v.x, v.kind === "drone" ? 0 : here.y, v.z), mode: "in" }); this.player.bodyHold = true;
    this.active = v; v.speed = 0; this.setSolid(v, false); if (v.gate) v.gateOpen = false;
    this.wasThird = this.player.third; this.player.ride = true; this.player.third = true;
    this.player.yaw = v.yaw; this.player.pitch = 0.22;
    if (!this.blend && !this.showsDriver(v)) this.player.body.root.setEnabled(false);
    this.hud.style.display = "block";
    this.game.sfx.click();
    this.game.ui.toast(v.name.toUpperCase(), v.kind === "drone" ? "W / S climb and descend, A / D turn, arrow keys fly forward and back. E sends it home." : v.kind === "lift" ? "R / F raise and lower the basket. SPACE jumps you out." : v.kind === "forklift" ? "R/F boom, T/G extend, Y/H tilt, SPACE to pick up the pipe pallet." : "W is the gas, S is brake then reverse. Steer with A and D.");
  }

  /** manlift: leap out of the basket in the direction you are looking. Only a jump gets you out up high, and a long fall is on you. */
  private jumpOut(v: Veh) {
    const p = this.player, dir = new Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));   // out through the gate: the basket's right-hand side
    v.gateOpen = true;
    const from = new Vector3(v.x, v.platformY + 0.05, v.z).add(dir.scale(1.0));
    this.active = null; this.setSolid(v, true); v.speed = 0;
    p.ride = false; p.third = this.wasThird; this.hud.style.display = "none"; this.dash.style.display = "none";
    p.teleport(from.x, from.y, from.z, p.yaw);
    p.vel.set(dir.x * 3.2, 3.2, dir.z * 3.2); p.grounded = false;
    this.startBlend(0.45); this.game.sfx.click();
    if (v.platformY > 3) this.game.radio("earl", "You JUMPED out of the manlift. From " + Math.round(v.platformY * 3.28) + " feet. Tell me that wasn't on the JSA.", 7000);
  }

  /** the drone flies itself home; the pilot stands at the dock */
  private dockDrone(v: Veh) {
    this.active = null; v.returning = true; v.speed = 0; v.vy = 0; this.setSolid(v, false);
    this.player.ride = false; this.player.third = this.wasThird; this.hud.style.display = "none"; this.dash.style.display = "none";
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
    this.player.body.seated = false; this.player.bodyHold = false;
    this.player.ride = false; this.player.third = this.wasThird;
    this.startBlend(0.55, { from: new Vector3(v.x, spot.y, v.z), to: spot, mode: "out" });
    this.player.teleport(spot.x, spot.y, spot.z, v.yaw);
    this.player.body.root.scaling.setAll(0.2); this.exitPop = 0.35;
    this.hud.style.display = "none"; this.dash.style.display = "none";
    this.game.sfx.click();
  }
  private exitPop = 0;

  /** sitting in any chair (the driller's or a directional driller's) */
  inChair() { return this.chair.on; }
  isSeated(i = 0) { return this.chair.on && this.chair.idx === i; }
  /** the driller's chair and the console are one thing: sitting down puts the console in front of you (C opens the panel again) */
  sit(i = 0, quiet = false) {
    if (this.riding) return;
    const st = this.seats[i], npc = this.game.rig.humans[st.npc];
    this.chair.on = true; this.chair.idx = i; this.chair.hidden = npc.root.isEnabled(); npc.root.setEnabled(false);
    this.wasThird = this.player.third; this.player.third = false; this.player.ride = true;
    this.player.yaw = st.yaw; this.player.pitch = 0.12;
    this.player.pos.set(st.pos.x, st.pos.y, st.pos.z);
    this.hud.style.display = "block";
    if (quiet) { /* flipping seats: no commentary */ } else if (i === 0 && !this.dalePing) { this.dalePing = true; this.game.radio("dale", "Uh… that's my chair, boss. Fine. Don't touch the brake unless you mean it.", 7000); }
    else this.game.radio("tex", "That's the steering seat. Small corrections, boss. Toolface is not a suggestion.", 7000);
  }
  /** flip between the driller's chair and the directional driller's seat */
  flipSeat() { if (!this.chair.on) return; const to = this.chair.idx === 0 ? 1 : 0; this.stand(); this.sit(to, true); }
  private stand() {
    const st = this.seats[this.chair.idx];
    this.chair.on = false;
    if (this.chair.hidden) this.game.rig.humans[st.npc].root.setEnabled(true);
    this.player.ride = false; this.player.third = this.wasThird;
    this.player.teleport(st.off.x, st.off.y, st.off.z, Math.PI + RYAW);
    this.hud.style.display = "none"; this.dash.style.display = "none";
  }
  private toggleAuto() {
    const s = this.game.sim.s;
    s.auto.on = !s.auto.on; this.game.sfx.click();
  }

  /** thrown out of the vehicle (the stand-down places the player afterwards) */
  /** throw the player out of the vehicle (reset = send the vehicle back where it started, e.g. after it hits somebody) */
  eject(reset = false) {
    const v = this.active; if (!v) return;
    const px = v.x, pz = v.z, pyaw = v.yaw;
    v.speed = 0; v.steer = 0; this.active = null;
    if (reset && v.home) { v.x = v.home.x; v.z = v.home.z; v.yaw = v.home.yaw; v.gy = 0; }
    this.setSolid(v, true);
    this.player.ride = false; this.player.third = this.wasThird; this.hud.style.display = "none"; this.dash.style.display = "none";
    this.player.teleport(px, 0, pz, pyaw);
  }

  // ---- Geronimo line: ride the escape cable from the board down to the landing pad ----
  private startZip() {
    if (this.riding) return;
    this.zip.on = true; this.zip.t = 0;
    this.wasThird = this.player.third; this.player.third = false; this.player.ride = true;
    this.player.yaw = RYAW; this.player.pitch = 0.12;
    this.hud.style.display = "block"; this.game.sfx.click();
    this.game.radio("earl", "GERONIMO! Hold on, boss. Knees together, and don't let go of the lanyard.", 6000);
  }
  private updateZip(dt: number) {
    const z = this.zip, p = this.player; z.t = Math.min(1, z.t + dt / 9);
    const e = Math.pow(z.t, 1.35), zz = 5.7 + (38.6 - 5.7) * e, lineY = (FB + 2.6) + (0.55 - (FB + 2.6)) * ((zz - 5.7) / (38.6 - 5.7));
    const y = Math.max(0.4, lineY - 1.7);
    p.pos.set(-zz, y, 0); p.vel.setAll(0); p.grounded = true;
    const eye = new Vector3(-zz, y + 1.45, 0);
    p.cam.position.copyFrom(eye); p.cam.setTarget(eye.add(p.lookDir()));
    this.hud.textContent = `GERONIMO LINE   ${Math.max(0, Math.round((y) * 3.281))} FT   HOLD ON\nlook around with the mouse / drag`;
    if (z.t >= 1) {
      z.on = false; this.hud.style.display = "none"; this.dash.style.display = "none"; p.ride = false; p.third = this.wasThird;
      p.teleport(-36.9, 0.4, 0, RYAW);
      this.game.ui.toast("TOUCHDOWN", "The Geronimo line works. Now walk back up the ladder.");
      this.game.gain(0.05, 2);
    }
  }

  // ---- ladder to the monkey board ----
  private startClimb(y: number) {
    if (this.riding) return;
    this.climb.on = true; this.climb.y = y;
    this.wasThird = this.player.third; this.player.third = false; this.player.ride = true;
    this.player.yaw = Math.PI / 2 + RYAW; this.player.pitch = 0;
    this.hud.style.display = "block";
    this.game.sfx.click();
  }
  private finishClimb(top: boolean) {
    this.climb.on = false; this.hud.style.display = "none"; this.dash.style.display = "none";
    this.player.ride = false; this.player.third = this.wasThird;
    if (top) { const q = rv(-2.6, FB + 0.12, 2.2); this.player.teleport(q.x, q.y, q.z, Math.PI / 2 + RYAW); } else { const q = rv(-3.9, F, 2.4); this.player.teleport(q.x, q.y, q.z, Math.PI / 2 + RYAW); }
  }
  private updateClimb(dt: number) {
    const p = this.player, c = this.climb, joy = p.touchMove;
    const dir = (this.k("KeyW", "ArrowUp") ? 1 : 0) - (this.k("KeyS", "ArrowDown") ? 1 : 0) + (joy.y || 0);
    c.y += Math.max(-1, Math.min(1, dir)) * dt * (this.k("ShiftLeft", "ShiftRight") ? 4.6 : 2.3);
    if (c.y >= FB - 0.01 && dir > 0.2) { this.finishClimb(true); return; }
    if (c.y <= F + 0.01 && dir < -0.2) { this.finishClimb(false); return; }
    c.y = Math.max(F, Math.min(FB, c.y));
    const cp = rv(-3.62, c.y, 2.4); p.pos.set(cp.x, cp.y, cp.z); p.vel.setAll(0); p.grounded = true;
    const eye = new Vector3(cp.x, c.y + 1.5, cp.z);
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
    const lv = this.active;
    if (lv && lv.kind === "lift" && lv.platformY > 1.2) {
      lv.gateOpen = !lv.gateOpen;   // E only works the gate; the jump is yours (SPACE)
      this.game.ui.toast(lv.gateOpen ? "GATE OPEN" : "GATE CLOSED", lv.gateOpen ? "No steps up here. Press SPACE when you're ready to jump. E closes the gate." : "Back inside the basket.");
      return;
    }
    if (lv && lv.kind === "lift" && lv.gate) lv.gateOpen = true;
    if (this.chair.on) this.stand(); else this.exit();
  }

  // ---------------------------------------------------------------------------------------------- simulation
  update(dt: number) {
    dt = Math.min(dt, 0.05);
    if (this.riding) this.hud.style.display = this.game.ui.panelOpen ? "none" : "block";   // the key hints sit under a console, not on top of it
    // the basket gate swings open and shut, and a pending jump goes once the gate is open
    for (const gv of this.list) if (gv.gate) { gv.gateA = (gv.gateA ?? 0) + ((gv.gateOpen ? 1 : 0) - (gv.gateA ?? 0)) * Math.min(1, dt * 7); gv.gate.rotation.y = (gv.gateA ?? 0) * 1.25; }
    if (this.pendingJump) { this.pendingJump.t -= dt; if (this.pendingJump.t <= 0) { const pj = this.pendingJump; this.pendingJump = null; if (this.active === pj.v) this.jumpOut(pj.v); } }
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
    const dr = v.kind === "drone";                              // drone: W/S climb and descend, the arrow keys (gas / brake pedals on touch) fly it
    const gasIn = Math.max(0, Math.min(1, ((dr ? this.k("ArrowUp") : this.k("KeyW", "ArrowUp")) ? 1 : 0) + Math.max(0, jyv)));
    const brkIn = Math.max(0, Math.min(1, ((dr ? this.k("ArrowDown") : this.k("KeyS", "ArrowDown")) ? 1 : 0) + Math.max(0, -jyv)));
    const str = Math.max(-1, Math.min(1, (this.k("KeyD", "ArrowRight") ? 1 : 0) - (this.k("KeyA", "ArrowLeft") ? 1 : 0) + (joy.x || 0)));
    this.gas += (gasIn - this.gas) * Math.min(1, dt * 9); this.brk += (brkIn - this.brk) * Math.min(1, dt * 9);
    let maxF = v.maxFwd, maxR = v.maxRev;
    if (v.kind === "lift") { const k = 1 - v.lift * 0.75; maxF *= k; maxR *= k; }
    // gas pedal
    // above 60 mph (26.8 m/s) the big truck pulls harder and harder against the air: acceleration tapers off toward the 90 mph top end
    const taper = v.id === "f250" && v.speed > 26.8 ? Math.max(0.12, 1 - ((v.speed - 26.8) / 13.4) * 0.88) : 1;
    if (gasIn > 0) v.speed += (v.speed < -0.3 ? v.accel * 3 : v.accel * taper) * this.gas * dt;
    // brake / reverse pedal: brakes while rolling forward; reverse only after it has been released at a stop
    if (brkIn > 0) {
      if (v.speed > 0.4) { v.speed -= (v.kind === "car" ? 16 : 10) * this.brk * dt; this.revArm = false; }
      else if (this.revArm || v.speed < -0.05) { v.speed -= v.accel * 0.7 * this.brk * dt; this.revArm = true; }
      else v.speed *= Math.max(0, 1 - dt * 10);
    } else if (v.speed < 0.4) this.revArm = true;
    if (gasIn === 0 && brkIn === 0) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), (1.6 + Math.abs(v.speed) * 0.12) * dt);
    if (v.bh) { const x = this.k("KeyX"); if (x && !this.xWas) this.swapHoe(v); this.xWas = x; }
    if (v.id === "f250") {   // roll coal: floor it while somewhere between about 15 and 48 mph and the stacks belch black smoke
      const acc = (v.speed - this.lastSp) / Math.max(dt, 1e-3); this.lastSp = v.speed;
      const mph = v.speed * 2.237;
      if (gasIn > 0.6 && mph > 15 && mph < 48 && acc > 2.6) this.coalT = 0.9; else this.coalT = Math.max(0, this.coalT - dt);
      for (const ps of this.coalPS) ps.emitRate = this.coalT > 0 ? 230 : 0;
    }
    const hand = v.kind === "car" && this.k("Space");
    if (hand) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 12 * dt);
    v.speed = Math.max(-maxR, Math.min(maxF, v.speed));
    if (v.bh?.dig) v.speed = 0;   // dug in: no driving
    const thr = gasIn - brkIn;
    if (v.kind === "drone") this.flyDrone(v, dt, str); else {
    // steering (speed-sensitive)
    const lock = v.kind === "car" ? 0.62 : 0.75, tgt = -str * lock / (1 + Math.abs(v.speed) * (v.kind === "car" ? 0.07 : 0.05));
    v.steer += (tgt - v.steer) * Math.min(1, dt * 7);
    // kinematic bicycle: yaw rate follows steer angle (screen-right = +yaw)
    if (v.bh) this.hoe(v, dt);
    const yawRate = (v.speed / v.wheelbase) * Math.tan(-v.steer) * (hand && Math.abs(v.speed) > 4 ? 2.7 : 1);   // pulling the handbrake in a turn kicks the tail out
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
    // and nobody drives out through the cliffs
    { const B = this.player.bound; if (B && v.kind !== "lift") { const r = Math.hypot(v.x, v.z); if (r > B) { v.x *= B / r; v.z *= B / r; v.speed *= -0.2; } } }
    // trucks float: in the pond they ride the water, slow, rather than sinking to the bed
    let wet = false;
    if (this.terrain && v.kind !== "lift" && this.terrain(v.x, v.z) < -1.2) {
      wet = true; v.speed *= Math.max(0, 1 - 1.4 * dt); const cap = 8; if (Math.abs(v.speed) > cap) v.speed = Math.sign(v.speed) * cap;
      if (!v.wasWet && Math.abs(v.speed) > 1) this.game.ui.toast("SPLASH", "The truck floats. Mostly. It is not a boat.");
    }
    v.wasWet = wet;
    // drive-over ramps: ride up whatever drivable surface is underfoot
    if (v.kind !== "lift") {
      let top = this.terrain ? Math.max(this.terrain(v.x, v.z), -1.2) : 0; for (const c of this.ramps) if (v.x > c.x0 && v.x < c.x1 && v.z > c.z0 && v.z < c.z1 && c.y1 > top) top = c.y1;
      let gy0 = v.gy ?? 0;
      const stepDist = v.px === undefined ? 0 : Math.hypot(v.x - v.px, v.z - (v.pz ?? v.z));
      // too steep to climb, at any speed (a crawl must not get up a wall one small step at a time): look at the slope under and just ahead of the truck, and refuse it if the way on is uphill
      let steepUp = false;
      if (this.terrain && v.px !== undefined && !v.air) {
        const mx = v.x - v.px, mz = v.z - (v.pz ?? v.z), ml = Math.hypot(mx, mz);
        if (ml > 1e-5) {
          const T = this.terrain, ux = mx / ml, uz = mz / ml;
          for (const k of [0, 1.8]) { const px = v.x + ux * k, pz = v.z + uz * k, gx = (T(px + 1, pz) - T(px - 1, pz)) / 2, gz = (T(px, pz + 1) - T(px, pz - 1)) / 2; if (Math.hypot(gx, gz) > 0.75 && gx * ux + gz * uz > 0.2 * Math.hypot(gx, gz)) steepUp = true; }
        }
      }
      if (v.px !== undefined && (steepUp || top - gy0 > 0.12 + stepDist * 0.7)) {
        // the ground ahead is a wall (a cliff, a mesa side): the truck stops against it instead of driving up it
        v.x = v.px; v.z = v.pz!; if (Math.abs(v.speed) > 6) this.game.propertyDamage(Math.abs(v.speed) * 0.4); v.speed *= -0.25; v.vyG = 0;
        top = this.terrain ? Math.max(this.terrain(v.x, v.z), -1.2) : 0; for (const c of this.ramps) if (v.x > c.x0 && v.x < c.x1 && v.z > c.z0 && v.z < c.z1 && c.y1 > top) top = c.y1;
        gy0 = v.gy ?? 0;
      }
      if (v.air) {
        // airborne: gravity, until the ground comes back up to meet you
        v.vy -= 18 * dt; v.gy = gy0 + v.vy * dt; v.airT = (v.airT ?? 0) + dt;
        if (v.gy <= top) {
          const imp = -v.vy, air = v.airT ?? 0;
          v.gy = top; v.air = false; v.vy = 0; v.airT = 0; v.vyEst = 0; v.vyG = 0; v.prevTop = top;   // landed: forget the climb rate from before the jump, or the truck re-launches off it
          if (imp > 6) this.game.sfx.thud();
          if (air > 0.6) this.game.ui.toast("AIR TIME " + air.toFixed(1) + " s", imp > 15 ? "…and a very hard landing." : air > 1.4 ? "That's a lot of air. The truck is proud of you." : "Nice jump.");
          if (imp > 17) { v.speed *= 0.8; this.game.propertyDamage(imp * 0.5); }
        }
      } else {
        // the ground dropped away faster than the truck can follow while it was going up: that's a launch
        const rate = v.prevTop === undefined ? 0 : (top - v.prevTop) / Math.max(dt, 1e-3);   // how fast the ground under us is rising
        const vyg = v.vyG ?? 0, pred = gy0 + vyg * dt - 9 * dt * dt;                  // where a free-flying truck with that vertical speed would be next frame
        let topR = 0; for (const c of this.ramps) if (v.x > c.x0 && v.x < c.x1 && v.z > c.z0 && v.z < c.z1 && c.y1 > topR) topR = c.y1;
        const onRamp = topR > 0.01 && topR >= top - 0.01;
        if (Math.abs(v.speed) > 8 && ((!onRamp && vyg > 1.2 && pred > top + 0.003) || (gy0 - top > 0.3 && vyg > -2))) { v.air = true; v.vy = Math.max(0, vyg); v.airT = 0; }
        else { v.gy = Math.abs(top - gy0) < 0.3 ? top : gy0 + (top - gy0) * Math.min(1, dt * 30); v.vyG = onRamp ? (v.gy - gy0) / Math.max(dt, 1e-3) : rate; }
        v.prevTop = top;
      }
    }
    // collisions
    let hit = false, pushX = 0, pushZ = 0, hitO = 0;
    for (const o of v.pts) {
      const q = { x: v.x + Math.sin(v.yaw) * o, z: v.z + Math.cos(v.yaw) * o }, ox = q.x, oz = q.z;
      if (pushOutXZ(this.world, q, v.gy ?? 0, v.radius, 0.35, 3.2)) { v.x += q.x - ox; v.z += q.z - oz; hit = true; if (Math.hypot(q.x - ox, q.z - oz) > Math.hypot(pushX, pushZ)) { pushX = q.x - ox; pushZ = q.z - oz; hitO = o; } }
    }
    if (hit && Math.abs(v.speed) > 2.5 && v.dentCd <= 0) { v.dentCd = 0.35; this.dent(v, pushX, pushZ, hitO, Math.abs(v.speed)); }
    for (const w of this.list) {
      if (w === v) continue;
      const dx = v.x - w.x, dz = v.z - w.z, d = Math.hypot(dx, dz), min = v.radius + w.radius + 0.9;
      if (d < min && d > 0.001) { v.x += (dx / d) * (min - d); v.z += (dz / d) * (min - d); hit = true; }
    }
    this.dmgCd -= dt; v.dentCd -= dt;
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
    this.place(v); v.px = v.x; v.pz = v.z;
    // wheels
    v.spinNodes.forEach((n, i) => { n.rotation.x += (v.speed / v.wheelR[i]) * dt; });
    v.steerNodes.forEach((n, i) => { n.rotation.y = -v.steer * v.steerSign[i] * 0.8; });
    // chassis roll / pitch for the big truck
    if (v.kind === "car") {
      let slope = 0;
      if (this.terrain) { const L = v.wheelbase * 0.5, fx = Math.sin(v.yaw), fz = Math.cos(v.yaw); slope = Math.atan2(this.terrain(v.x + fx * L, v.z + fz * L) - this.terrain(v.x - fx * L, v.z - fz * L), 2 * L); }
      if (v.air) slope = Math.atan2(v.vy, Math.max(5, Math.abs(v.speed)));   // nose follows the flight path
      v.slope = (v.slope ?? 0) + (slope - (v.slope ?? 0)) * Math.min(1, dt * (v.air ? 4 : 8));
      v.root.rotation.z = -v.steer * v.speed * 0.006; v.root.rotation.x = -thr * 0.012 * Math.min(1, Math.abs(v.speed) / 8) - v.slope;
    }

    }
    // the player rides along (everything else in the game keys off player.pos)
    const y = v.kind === "lift" ? v.platformY : v.kind === "drone" ? v.alt : v.gy ?? 0;
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
    // the driver is visible, seated at the wheel (standing in the manlift basket); first person hides the body
    if (this.showsDriver(v) && !this.blend) {
      const seat = v.id === "backhoe" ? { x: 0, y: 0.52, z: -0.15 } : v.kind === "car" ? { x: -0.5, y: 1.35, z: -0.12 } : v.kind === "forklift" ? { x: -0.75, y: 1.0, z: 0.3 } : { x: 0, y: 0.05, z: 0 };
      const bd = this.player.body, ry = v.yaw;
      bd.root.setEnabled(p.third); bd.seated = v.kind !== "lift";
      bd.root.position.set(v.x + fz * seat.x + fx * seat.z, y + seat.y, v.z - fx * seat.x + fz * seat.z); bd.root.rotation.y = ry;
      bd.animate(dt, 0);
    }
    const mph = Math.round(Math.abs(v.speed) * 2.237);
    const extra = v.kind === "drone" ? "" : v.kind === "forklift" ? `   FORKS ${(this.forkPos(v).y * 3.281).toFixed(0)} ft   REACH ${(v.ext * 3.4 * 3.281).toFixed(0)} ft${this.palletHeld ? "   LOAD ON" : ""}` : v.kind === "lift" ? `   BASKET ${(v.platformY * 3.281).toFixed(0)} ft` : "";
    const bar = (t: number) => "■".repeat(Math.round(t * 5)) + "□".repeat(5 - Math.round(t * 5));
    if (v.kind === "drone") { this.hud.textContent = this.dronePrompt + `   GAS ${bar(this.gas)}  BRAKE ${bar(this.brk)}` + (document.body.classList.contains("touch") ? "" : "\n" + v.controls); return; }
    this.hud.style.display = "none"; this.dashUpdate(v, mph);
  }

  /** the driving panel: speed and pedals for every ground vehicle, plus a live side view of the Skytrak's boom and forks or the manlift's basket */
  private dashUpdate(v: Veh, mph: number) {
    const d = this.dash; d.style.display = "block";
    const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);
    const bar = (label: string, x: number, col: string) => `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><span style="width:44px;color:#9fb4c8;font-size:10px">${label}</span><div style="flex:1;height:7px;background:#1b2836"><div style="height:100%;width:${pct(x)}%;background:${col}"></div></div></div>`;
    let diagram = "", extra = "";
    if (v.kind === "forklift") {
      const fp = this.forkPos(v), ang = v.lift * 1.5 - 0.34, L = 52 + v.ext * 46, P = { x: 86, y: 84 };
      const tip = { x: P.x + L * Math.cos(ang), y: P.y - L * Math.sin(ang) }, tr = v.tilt * 0.45;
      const fe = { x: tip.x + 34 * Math.cos(tr), y: tip.y + 34 * Math.sin(tr) };
      const gy = 124, tipY = Math.min(gy, tip.y);
      let near = false; if (!this.held) for (const pl of this.pallets) { const pp = pl.getAbsolutePosition(); if (Math.hypot(fp.x - pp.x, fp.z - pp.z) < 1.4 && Math.abs(fp.y - (pp.y + 0.1)) < 0.6) near = true; }
      const loadSvg = this.held ? `<g transform="translate(${(tip.x + fe.x) / 2} ${(tip.y + fe.y) / 2 - 8}) rotate(${(tr * 180) / Math.PI})"><rect x="-17" y="-8" width="34" height="16" fill="${this.mudPallets.has(this.held) ? "#c9bfa4" : "#8d9299"}" stroke="#333"/><rect x="-17" y="6" width="34" height="3" fill="#8a6a40"/></g>` : "";
      diagram = `<svg viewBox="0 0 270 138" width="100%" style="display:block;margin:4px 0 2px;background:#0b141e;border:1px solid #243649">
        <line x1="0" y1="${gy}" x2="270" y2="${gy}" stroke="#6b5a48" stroke-width="3"/>
        <rect x="14" y="88" width="94" height="24" rx="3" fill="#e8b923"/><rect x="18" y="64" width="34" height="26" rx="3" fill="#cfa51c"/><rect x="24" y="68" width="22" height="14" fill="#7fb6d4"/>
        <circle cx="32" cy="116" r="10" fill="#15171a"/><circle cx="92" cy="116" r="10" fill="#15171a"/><circle cx="32" cy="116" r="4" fill="#777"/><circle cx="92" cy="116" r="4" fill="#777"/>
        <line x1="${P.x}" y1="${P.y}" x2="${tip.x}" y2="${tip.y}" stroke="#e8b923" stroke-width="9" stroke-linecap="round"/>
        <line x1="${P.x}" y1="${P.y}" x2="${P.x + (tip.x - P.x) * 0.55}" y2="${P.y + (tip.y - P.y) * 0.55}" stroke="#a88410" stroke-width="5" stroke-linecap="round"/>
        <circle cx="${P.x}" cy="${P.y}" r="5" fill="#333"/>
        <line x1="${tip.x - 8 * Math.sin(tr)}" y1="${tip.y - 8 * Math.cos(tr)}" x2="${tip.x + 12 * Math.sin(tr)}" y2="${tip.y + 12 * Math.cos(tr)}" stroke="#bbb" stroke-width="3"/>
        <line x1="${tip.x}" y1="${tip.y}" x2="${fe.x}" y2="${fe.y}" stroke="#ddd" stroke-width="3" stroke-linecap="round"/>
        ${loadSvg}
        <line x1="${tip.x}" y1="${tipY}" x2="${tip.x}" y2="${gy}" stroke="#4fd6ff" stroke-dasharray="3 3" stroke-width="1"/>
        <text x="${Math.min(236, tip.x + 4)}" y="${Math.max(14, tipY - 6)}" fill="#4fd6ff" font-size="10" font-family="monospace">${(fp.y * 3.281).toFixed(1)} ft</text>
        <circle cx="256" cy="14" r="5" fill="${this.held ? "#2fd05a" : near ? "#f4c04a" : "#3a4a5c"}"/>
      </svg>`;
      extra = `<div style="display:flex;justify-content:space-between;color:#cfe6f7"><span>BOOM ${Math.round((ang * 180) / Math.PI)}°</span><span>REACH ${(v.ext * 3.4 * 3.281).toFixed(0)} ft</span><span>TILT ${Math.round((v.tilt * 0.45 * 180) / Math.PI)}°</span></div><div style="color:${this.held ? "#2fd05a" : near ? "#f4c04a" : "#9fb4c8"}">${this.held ? "LOAD ON THE FORKS: SPACE sets it down" : near ? "PALLET IN REACH: press SPACE to pick up" : "No load. Drive the forks under a pallet."}</div>`;
    } else if (v.kind === "lift") {
      diagram = `<div style="display:flex;gap:10px;align-items:flex-end;margin:6px 0"><div style="width:34px;height:96px;background:#0b141e;border:1px solid #243649;position:relative"><div style="position:absolute;left:0;right:0;bottom:0;height:${pct(v.lift)}%;background:#e8b923"></div></div><div style="font-size:22px;color:#e8b923">${(v.platformY * 3.281).toFixed(0)} ft</div><div style="color:#9fb4c8;font-size:10px">basket height<br>R / F raise and lower</div></div>`;
    }
    d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline"><span style="color:#f4c04a">${v.name.toUpperCase()}</span><span style="font-size:20px">${mph}<small style="font-size:10px;color:#9fb4c8"> MPH</small></span></div>${bar("GAS", this.gas, "#2fd05a")}${bar("BRAKE", this.brk, "#e5483b")}${diagram}${extra}${document.body.classList.contains("touch") ? "" : `<div style="color:#9fb4c8;font-size:10px;margin-top:4px;font-weight:600">${v.controls}</div>`}`;
  }

  /** quadcopter flight: W/S speed, A/D yaw, R/F climb and descend */
  private flyDrone(v: Veh, dt: number, str: number) {
    v.yaw += str * 1.7 * dt;
    const up = Math.max(-1, Math.min(1, (this.k("KeyW", "KeyR", "Space") ? 1 : 0) - (this.k("KeyS", "KeyF") ? 1 : 0) + (this.player.touchMove.y || 0)));
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

  private wobHold = { dir: 0, t: 0 };
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
      else if (up && !s.auto.on && !busy) {
        // like the original console: one klb per press, then hold-to-repeat after 0.3 s at 20 per second
        const dir = Math.sign(up);
        if (dir !== this.wobHold.dir) { this.wobHold.dir = dir; this.wobHold.t = 0.3; s.wobTarget = Math.max(0, Math.min(80, Math.round(s.wobTarget) + dir)); }
        else { this.wobHold.t -= dt; while (this.wobHold.t <= 0) { this.wobHold.t += 0.05; s.wobTarget = Math.max(0, Math.min(80, Math.round(s.wobTarget) + dir)); } }
      } else this.wobHold.dir = 0;
      if (side) s.flowTarget = Math.max(400, Math.min(1000, s.flowTarget + side * 150 * dt));
      this.hud.textContent = `DRILLER'S CHAIR — ${s.mode.toUpperCase()}   DEPTH ${Math.round(s.depth).toLocaleString()} ft   ROP ${Math.round(s.rop)} ft/hr\n`
        + `WOB ${s.wob.toFixed(1)} → ${s.wobTarget.toFixed(0)} klbs   PUMP ${Math.round(s.flowTarget)} gpm   SPP ${Math.round(s.spp)} psi   AUTO ${s.auto.on ? "ON" : "OFF"}\n`
        + `W/S weight on bit  ·  A/D pump rate  ·  SPACE brake  ·  T autodriller  ·  C console panel  ·  TAB to the DD seat  ·  E stand up`;
      return;
    }
    // directional driller / MWD seat: A/D turn the toolface, 1 / 2 / 3 (or S / W) pick rotate / slide / oscillating slide, K shoots a check shot; clicking a screen opens the full console
    const d = this.dd, drilling = s.mode === "drilling" && s.rop > 0;
    const hit = (code: string) => { const on = this.k(code), was = this.ddKeys[code]; this.ddKeys[code] = on; return on && !was; };
    if (side) d.setTf(d.tfSet + side * 90 * dt);
    if (hit("Digit1") || hit("KeyS")) d.setMode("rotate"); if (hit("Digit2") || hit("KeyW")) d.setMode("slide"); if (hit("Digit3")) d.setMode("osc");
    if (hit("KeyK")) d.checkShot();
    const sv = d.lastSurvey, tp = d.toPlan;
    this.hud.textContent = `${st.name.toUpperCase()} — ${d.mode === "rotate" ? "ROTATING" : d.mode === "slide" ? "SLIDING" : "OSCILLATING SLIDE"}   INC ${d.inc.toFixed(1)}°   AZI ${sv.azi.toFixed(0)}° (survey)   TOOLFACE set ${d.tfSet.toFixed(0)}° / ${d.tf.toFixed(0)}°\n`
      + `${Math.round(s.depth).toLocaleString()} ft   ROP ${Math.round(s.rop)} ft/hr   ${tp.dist.toFixed(0)} ft off plan   SF ${Math.min(...d.acNow.map((a) => a.sf)).toFixed(2)}   ${drilling ? "" : "(drill to see the well respond)"}\n`
      + `A/D toolface  ·  1 rotate · 2 slide · 3 oscillate  ·  K check shot  ·  click a screen for the console  ·  TAB to the driller's chair  ·  E stand up`;
  }
}
