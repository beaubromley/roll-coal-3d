import { Scene, MeshBuilder, StandardMaterial, Color3, TransformNode, Mesh, Vector3, VertexData } from "@babylonjs/core";
import type { Kit } from "./models";
import type { CharKit, CharInstance } from "./chars";
import { Quaternion } from "@babylonjs/core";

const matCache = new Map<string, StandardMaterial>();
function m(scene: Scene, hex: string) {
  let x = matCache.get(hex);
  if (!x) {
    x = new StandardMaterial("h" + hex, scene);
    x.diffuseColor = Color3.FromHexString(hex);
    x.specularColor = new Color3(0.04, 0.04, 0.04);
    matCache.set(hex, x);
  }
  return x;
}

/** a hex colour pushed toward white by t (0..1) */
function lighten(hex: string, t: number): string { return Color3.Lerp(Color3.FromHexString(hex), Color3.White(), t).toHexString(); }

export interface HumanOpts {
  shirt: string; pants: string; hat: string | null; skin?: string; vest?: boolean; scale?: number;
  /** extra face / clothing detail (the player's own body) */
  detail?: boolean;
  /** hair colour, headband colour (false = none), height multiplier: all random per person unless given */
  hair?: string; band?: string | false; height?: number;
  /** hat / vest / glasses start hidden until setPPE(true) */
  ppeOff?: boolean;
}


/** Full-brim hard hat (MSA V-Gard style): one smooth lathed shell with a tall dome, a wide brim that droops a little toward the edge, and a raised ridge
 *  running front to back over the crown. Parts are positioned relative to the brim line (y = 0) at the centre of the head. */
function hardHatParts(sc: Scene): { mesh: Mesh; x: number; y: number; z: number }[] {
  const prof: [number, number][] = [[0.205, -0.016], [0.205, -0.007], [0.17, 0.0], [0.145, 0.006], [0.139, 0.016], [0.137, 0.04], [0.133, 0.066], [0.124, 0.09], [0.108, 0.109], [0.085, 0.123], [0.055, 0.132], [0.025, 0.136], [0.0, 0.1365]];
  const shell = MeshBuilder.CreateLathe("hardhat", { shape: prof.map(([r, y]) => new Vector3(r, y, 0)), tessellation: 32, sideOrientation: 2 }, sc);
  shell.scaling.z = 1.12;
  const out: { mesh: Mesh; x: number; y: number; z: number }[] = [{ mesh: shell, x: 0, y: 0, z: -0.006 }];
  // the crown ridge: short raised segments that follow the curve of the dome from the front to the back
  const crown = (r: number) => { for (let i = 0; i < prof.length - 1; i++) { const [r0, y0] = prof[i], [r1, y1] = prof[i + 1]; if (r <= r0 && r >= r1) return y1 + ((y0 - y1) * (r - r1)) / (r0 - r1); } return 0.1365; };
  for (const zz of [-0.125, -0.085, -0.045, -0.005, 0.035, 0.075, 0.115]) {
    const r = Math.abs(zz) / 1.12, h = crown(Math.min(0.139, r)), h2 = crown(Math.min(0.139, r + 0.02));
    const seg = MeshBuilder.CreateBox("hhridge", { width: 0.034, height: 0.013, depth: 0.05 }, sc);
    seg.rotation.x = Math.atan2(h2 - h, 0.02) * (zz > 0 ? 1 : -1) * -1;
    out.push({ mesh: seg, x: 0, y: h + 0.004, z: zz - 0.006 });
  }
  // a slim, lighter band around the base of the dome where it meets the brim, and a small green maker mark on the right side
  const band = MeshBuilder.CreateCylinder("hhband", { diameter: 0.29, height: 0.012, tessellation: 28 }, sc); band.scaling.z = 1.12;
  out.push({ mesh: band, x: 0, y: 0.012, z: -0.006 });
  const mark = MeshBuilder.CreateBox("hhmark", { width: 0.004, height: 0.016, depth: 0.04 }, sc);
  out.push({ mesh: mark, x: 0.142, y: 0.03, z: -0.03 });
  return out;
}

export class Human {
  root: TransformNode;
  legL!: TransformNode; legR!: TransformNode; armL!: TransformNode; armR!: TransformNode;
  /** set by main once the Blender kit has loaded; Humans built afterwards use the jointed model */
  static kit: Kit | null = null;
  /** use the smooth hand-built character (rounded limbs, soft shading) instead of the faceted rigged model; ?rigged=1 brings the old one back */
  static smooth = true;
  /** rigged character model; when present it replaces the Blender kit / procedural body */
  static char: CharKit | null = null;
  private ch: CharInstance | null = null;
  private chState = "";
  private chSat = false;
  private bones: Record<string, TransformNode | null> = {};
  kneeL: TransformNode | null = null; kneeR: TransformNode | null = null; elbowL: TransformNode | null = null; elbowR: TransformNode | null = null;
  meshes: Mesh[] = [];
  /** hard hat, vest, safety glasses: toggled together */
  ppe: Mesh[] = [];
  /** the hair cap: hidden under a hard hat so strands never poke through it */
  hairCap: Mesh | null = null; hairBack: Mesh | null = null;
  /** rigged model: the hair meshes (hidden under a hard hat so they cannot clip through the dome as the head moves) */
  hairMeshes: Mesh[] = [];
  /** the spacesuit for the finale: a glass helmet, neck ring and life-support pack, with the clothes turned white and the hard hat, vest and glasses put away */
  suitParts: Mesh[] = []; suitOn = false; private ppeOn = false;
  private suitBase: { re: RegExp; hex: string }[] = []; private suitCloth: any[] = [];
  private suitSwap: { mesh: Mesh; orig: any }[] = [];
  setSuit(on: boolean) {
    this.suitOn = on;
    if (this.suitSwap.length) { const white = m(this.scene, "#eef1f4"); for (const s of this.suitSwap) s.mesh.material = on ? white : s.orig; }
    this.suitParts.forEach((p) => p.setEnabled(on));
    for (const mt of this.suitCloth) { const base = this.suitBase.find((s) => s.re.test(String(mt.name).replace(/_c\d+$/, ""))); mt.set(on ? "#eef1f4" : base?.hex ?? "#808080"); }
    if (on) this.ppe.forEach((x) => x.setEnabled(false)); else this.setPPE(this.ppeOn);
  }
  phase = Math.random() * 6;
  walking = false;
  /** sitting pose (thighs forward, knees bent, hands on the controls) */
  seated = false;
  constructor(public scene: Scene, o: HumanOpts) {
    this.root = new TransformNode("human", scene);
    if (Human.smooth) { this.fromSmooth(o); return; }
    if (Human.char) { this.fromChar(Human.char, o); return; }
    if (Human.kit) { this.fromKit(Human.kit, o); return; }
    const mk = (mesh: Mesh, hex: string, parent: TransformNode) => {
      mesh.material = m(scene, hex); mesh.parent = parent; this.meshes.push(mesh); return mesh;
    };
    const torso = MeshBuilder.CreateBox("t", { width: 0.5, height: 0.66, depth: 0.28 }, scene);
    torso.position.y = 1.12; mk(torso, o.shirt, this.root);
    if (o.vest) {
      const v = MeshBuilder.CreateBox("v", { width: 0.52, height: 0.5, depth: 0.3 }, scene);
      v.position.y = 1.15; this.ppe.push(mk(v, "#e8f542", this.root));
      const st = MeshBuilder.CreateBox("vs", { width: 0.53, height: 0.07, depth: 0.31 }, scene);
      st.position.y = 1.12; this.ppe.push(mk(st, "#cfd3d6", this.root));
    }
    const skin = o.skin ?? "#d9a77f";
    const head = MeshBuilder.CreateSphere("hd", { diameter: 0.25, segments: 16 }, scene);
    head.position.y = 1.62; head.scaling.set(0.92, 1.05, 1); mk(head, skin, this.root);
    const neck = MeshBuilder.CreateCylinder("nk", { diameter: 0.11, height: 0.1, tessellation: 10 }, scene);
    neck.position.y = 1.47; mk(neck, skin, this.root);
    for (const sx of [-1, 1]) {
      const eye = MeshBuilder.CreateSphere("ey", { diameter: 0.032, segments: 6 }, scene);
      eye.position.set(sx * 0.046, 1.635, 0.108); mk(eye, "#15110e", this.root);
    }
    const nose = MeshBuilder.CreateBox("ns", { width: 0.03, height: 0.05, depth: 0.04 }, scene);
    nose.position.set(0, 1.605, 0.125); mk(nose, skin, this.root);
    const belt = MeshBuilder.CreateBox("bt", { width: 0.52, height: 0.06, depth: 0.3 }, scene);
    belt.position.y = 0.82; mk(belt, "#1e1a16", this.root);
    const buckle = MeshBuilder.CreateBox("bk", { width: 0.07, height: 0.05, depth: 0.02 }, scene);
    buckle.position.set(0, 0.82, 0.155); mk(buckle, "#b8b8b8", this.root);
    if (o.hat) {
      for (const p of hardHatParts(scene)) {
        p.mesh.position.set(p.x, 1.672 + p.y, p.z);
        mk(p.mesh, p.mesh.name === "hhband" ? "#e6e9ec" : p.mesh.name === "hhmark" ? "#2fb37a" : o.hat, this.root); this.ppe.push(p.mesh);
      }
    }
    const limb = (name: string, w: number, h: number, d: number, x: number, y: number, hex: string) => {
      const pivot = new TransformNode(name, scene);
      pivot.parent = this.root; pivot.position.set(x, y, 0);
      const b = MeshBuilder.CreateBox(name + "m", { width: w, height: h, depth: d }, scene);
      b.position.y = -h / 2; mk(b, hex, pivot);
      return pivot;
    };
    for (const sx of [-1, 1]) {
      const sh = MeshBuilder.CreateSphere("sh", { diameter: 0.17, segments: 10 }, scene);
      sh.position.set(sx * 0.33, 1.42, 0); mk(sh, o.shirt, this.root);
    }
    this.legL = limb("lL", 0.19, 0.8, 0.22, -0.13, 0.8, o.pants);
    this.legR = limb("lR", 0.19, 0.8, 0.22, 0.13, 0.8, o.pants);
    this.armL = limb("aL", 0.13, 0.6, 0.15, -0.33, 1.42, o.shirt);
    this.armR = limb("aR", 0.13, 0.6, 0.15, 0.33, 1.42, o.shirt);
    for (const arm of [this.armL, this.armR]) {
      const hand = MeshBuilder.CreateSphere("hn", { diameter: 0.11, segments: 10 }, scene);
      hand.position.y = -0.64; mk(hand, "#2b2118", arm);   // work gloves
      const cuff = MeshBuilder.CreateCylinder("cf", { diameter: 0.14, height: 0.04, tessellation: 12 }, scene);
      cuff.position.y = -0.57; mk(cuff, o.shirt, arm);
    }
    const bootL = MeshBuilder.CreateBox("bl", { width: 0.2, height: 0.1, depth: 0.3 }, scene);
    bootL.position.set(0, -0.78, 0.04); mk(bootL, "#2a1d12", this.legL);
    for (const leg of [this.legL, this.legR]) {
      const sole = MeshBuilder.CreateBox("sl", { width: 0.21, height: 0.035, depth: 0.32 }, scene);
      sole.position.set(0, -0.83, 0.04); mk(sole, "#0e0b08", leg);
      const knee = MeshBuilder.CreateSphere("kn", { diameter: 0.2, segments: 8 }, scene);
      knee.position.set(0, -0.42, 0.02); knee.scaling.set(1, 0.7, 0.9); mk(knee, o.pants, leg);
    }
    const bootR = bootL.clone("br"); bootR.parent = this.legR; this.meshes.push(bootR);
    this.addDetail(o);
    this.root.scaling.setAll(o.scale ?? 1);
  }
  /** The smooth character: capsule limbs with proper knees and elbows, a tapered torso, a real head with hair, ears, nose, brows and eyes, a collared shirt, belt,
   *  trousers and shoes, all with soft shading. Hard hat, vest, glasses and the spacesuit are separate parts. Proportions: about 1.78 m, facing +z. */
  private fromSmooth(o: HumanOpts) {
    const sc = this.scene, skin = o.skin ?? "#d9a77f";
    const seed = ++Human.count, rnd = (n: number) => { const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
    const hairCol = o.hair ?? ["#1c130c", "#3b2616", "#5a3a20", "#8a6a3a", "#c9a45a", "#6a2e14", "#7d7d7d", "#0b0b0b"][Math.floor(rnd(1) * 8) % 8];
    const mk = (mesh: Mesh, hex: string, parent: TransformNode = this.root) => { mesh.material = m(sc, hex); mesh.parent = parent; mesh.isPickable = false; this.meshes.push(mesh); return mesh; };
    const cap = (r: number, h: number, hex: string, parent: TransformNode, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const c = MeshBuilder.CreateCapsule("cap", { radius: r, height: h, tessellation: 16, subdivisions: 2, capSubdivisions: 6 }, sc); c.position.set(x, y, z); c.scaling.set(sx, sy, sz); return mk(c, hex, parent);
    };
    const ball = (dia: number, hex: string, parent: TransformNode, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 16) => {
      const b = MeshBuilder.CreateSphere("ball", { diameter: dia, segments: seg }, sc); b.position.set(x, y, z); b.scaling.set(sx, sy, sz); return mk(b, hex, parent);
    };
    const cyl = (dTop: number, dBot: number, h: number, hex: string, parent: TransformNode, x: number, y: number, z: number, sz = 1) => {
      const c = MeshBuilder.CreateCylinder("cy", { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: 20 }, sc); c.position.set(x, y, z); c.scaling.z = sz; return mk(c, hex, parent);
    };
    const swap: Mesh[] = [];   // the clothes that turn white under a spacesuit
    const cloth = (mesh: Mesh) => { swap.push(mesh); return mesh; };
    const shoeCol = "#3a2a1c", beltCol = "#2a1d12";
    // ---- limbs are continuous tapered tubes: each joint is a sphere exactly as wide as the limb, so there are no bulbs at the knees, elbows or shoulders
    const tube = (rTop: number, rBot: number, len: number, hex: string, parent: TransformNode, x: number, y: number, z: number, sz = 1) => {
      const c = MeshBuilder.CreateCylinder("tube", { diameterTop: rTop * 2, diameterBottom: rBot * 2, height: len, tessellation: 20 }, sc); c.position.set(x, y, z); c.scaling.z = sz; return mk(c, hex, parent);
    };
    const joint = (r: number, hex: string, parent: TransformNode, x: number, y: number, z: number, sz = 1) => ball(r * 2, hex, parent, x, y, z, 1, 1, sz, 14);
    // legs: hip pivot at 0.92 m, thigh 0.42, knee, shin 0.42, so the ankle is 0.08 m off the ground and the shoe sits right on the shin
    const leg = (side: number) => {
      const hip = new TransformNode("hip", sc); hip.parent = this.root; hip.position.set(side * 0.092, 0.92, 0);
      cloth(joint(0.088, o.pants, hip, 0, 0, 0));
      cloth(tube(0.088, 0.064, 0.42, o.pants, hip, 0, -0.21, 0));
      const knee = new TransformNode("knee", sc); knee.parent = hip; knee.position.set(0, -0.42, 0);
      cloth(joint(0.064, o.pants, knee, 0, 0, 0));
      cloth(tube(0.064, 0.05, 0.42, o.pants, knee, 0, -0.21, 0));
      cloth(tube(0.058, 0.066, 0.05, o.pants, knee, 0, -0.395, 0));                          // hem, a touch fuller than the shin
      ball(1, shoeCol, knee, 0, -0.455, 0.052, 0.104, 0.072, 0.25);                          // heel and arch
      ball(1, shoeCol, knee, 0, -0.455, 0.145, 0.095, 0.064, 0.14);                          // toe box
      const sole = tube(0.052, 0.053, 0.02, "#161210", knee, 0, -0.488, 0.08); sole.scaling.z = 2.7;
      return { hip, knee };
    };
    const L = leg(-1), R = leg(1);
    this.legL = L.hip; this.legR = R.hip; this.kneeL = L.knee; this.kneeR = R.knee;
    // torso: one lofted body (hips, waist, chest, shoulder line) so it flows from the trousers into the neck
    {
      const prof: [number, number][] = [[0.0, 0.9], [0.125, 0.92], [0.128, 0.97], [0.118, 1.05], [0.122, 1.14], [0.136, 1.26], [0.146, 1.36], [0.13, 1.43], [0.085, 1.47], [0.06, 1.49], [0.0, 1.495]];
      const lathe = MeshBuilder.CreateLathe("torso", { shape: prof.map(([r, y]) => new Vector3(r, y, 0)), tessellation: 28 }, sc);
      lathe.scaling.set(1.5, 1, 0.8); cloth(mk(lathe, o.shirt));
      const seat = MeshBuilder.CreateLathe("seat", { shape: [[0.0, 0.82], [0.12, 0.85], [0.135, 0.92], [0.13, 0.99], [0.0, 1.0]].map(([r, y]) => new Vector3(r, y, 0)), tessellation: 24 }, sc);
      seat.scaling.set(1.45, 1, 0.82); cloth(mk(seat, o.pants));
    }
    cyl(0.416, 0.41, 0.06, beltCol, this.root, 0, 1.0, 0, 0.58);                             // belt: wide enough to sit outside the hips and shirt at the sides
    { const bk = MeshBuilder.CreateBox("bk", { width: 0.06, height: 0.045, depth: 0.014 }, sc); bk.position.set(0, 1.0, 0.126); mk(bk, "#c8c8c8"); }
    cyl(0.07, 0.078, 0.1, skin, this.root, 0, 1.52, 0.004);                                  // neck
    cloth(cyl(0.15, 0.17, 0.04, o.shirt, this.root, 0, 1.485, 0.004, 0.95));                 // collar
    for (const s of [-1, 1]) { const cf = MeshBuilder.CreateBox("cf", { width: 0.05, height: 0.012, depth: 0.075 }, sc); cf.position.set(s * 0.034, 1.482, 0.07); cf.rotation.set(0.5, 0, -s * 0.5); cloth(mk(cf, o.shirt)); }   // collar points
    { const pk = MeshBuilder.CreateBox("pk", { width: 0.075, height: 0.075, depth: 0.012 }, sc); pk.position.set(-0.09, 1.3, 0.108); cloth(mk(pk, o.shirt)); }                                                                  // shirt pocket
    // arms: shoulder pivot, upper arm 0.29, elbow, forearm 0.26, hand
    const arm = (side: number) => {
      const sh = new TransformNode("shoulder", sc); sh.parent = this.root; sh.position.set(side * 0.215, 1.385, 0);
      cloth(joint(0.054, o.shirt, sh, 0, 0, 0));
      cloth(tube(0.054, 0.045, 0.29, o.shirt, sh, 0, -0.145, 0));
      const el = new TransformNode("elbow", sc); el.parent = sh; el.position.set(0, -0.29, 0);
      cloth(joint(0.045, o.shirt, el, 0, 0, 0));
      cloth(tube(0.045, 0.036, 0.26, o.shirt, el, 0, -0.13, 0));
      cloth(tube(0.04, 0.042, 0.03, o.shirt, el, 0, -0.245, 0));                              // cuff
      ball(0.082, "#2b2118", el, 0, -0.29, 0.006, 1, 1.2, 0.85);                              // gloved hand
      return { sh, el };
    };
    const AL = arm(-1), AR = arm(1);
    this.armL = AL.sh; this.armR = AR.sh; this.elbowL = AL.el; this.elbowR = AR.el;
    // ---- head: skull, jaw, ears, nose, brows, eyes, mouth, hair
    const HY = 1.665, HAIR_TILT = 0.55;
    ball(0.225, skin, this.root, 0, HY, 0, 0.9, 1.1, 1.0, 22);                              // skull
    ball(0.19, skin, this.root, 0, HY - 0.06, 0.012, 0.95, 0.88, 0.98, 20);                 // lower face: a soft rounded jaw that blends into the skull, no pointy chin
    for (const s of [-1, 1]) {
      ball(0.05, skin, this.root, s * 0.102, HY - 0.005, -0.004, 0.45, 1, 0.8, 10);       // ears
      ball(0.026, "#f4f4f2", this.root, s * 0.04, HY + 0.012, 0.099, 1, 0.8, 0.5, 10);     // eye whites
      ball(0.015, "#2a1d12", this.root, s * 0.04, HY + 0.012, 0.105, 1, 1, 0.6, 10);      // irises
      const br = MeshBuilder.CreateBox("br", { width: 0.05, height: 0.01, depth: 0.016 }, sc); br.position.set(s * 0.042, HY + 0.044, 0.1); br.rotation.z = -s * 0.08; mk(br, hairCol);
    }
    ball(0.034, skin, this.root, 0, HY - 0.025, 0.114, 0.85, 1.3, 1.25, 10);                // nose
    { const mo = MeshBuilder.CreateBox("mo", { width: 0.05, height: 0.008, depth: 0.012 }, sc); mo.position.set(0, HY - 0.074, 0.1); mk(mo, "#8a4a3a"); }
    {   // hair: a front cap with a clean hairline above the brows, and the back half of the head covered down to the nape, both a hair's width outside the skull
      const cap = MeshBuilder.CreateSphere("hair", { diameter: 1, segments: 28, slice: 0.256 }, sc);   // concentric with the skull, cut off at the hairline
      cap.scaling.set(0.216, 0.262, 0.238); cap.position.set(0, HY, 0); this.hairCap = mk(cap, hairCol);
      const back = MeshBuilder.CreateSphere("hairback", { diameter: 1, segments: 28, slice: 0.5 }, sc);
      back.scaling.set(0.216, 0.232, 0.236); back.position.set(0, HY + 0.014, -0.002); back.rotation.x = -Math.PI / 2; mk(back, hairCol);
      this.hairBack = back;
    }
    // ---- PPE: vest, hard hat, safety glasses (hidden until setPPE(true))
    const ppeAdd = (mesh: Mesh) => { this.ppe.push(mesh); return mesh; };
    if (o.vest) {
      const v = cap(0.16, 0.5, "#e8f542", this.root, 0, 1.24, 0, 1.34, 1, 0.9); ppeAdd(v);
      for (const y of [1.14, 1.3]) { const s = cyl(0.37, 0.37, 0.05, "#cfd3d6", this.root, 0, y, 0, 0.72); ppeAdd(s); }
    }
    if (o.hat) for (const p of hardHatParts(sc)) { p.mesh.position.set(p.x, HY + 0.072 + p.y, p.z); ppeAdd(mk(p.mesh, p.mesh.name === "hhband" ? "#e6e9ec" : p.mesh.name === "hhmark" ? "#2fb37a" : o.hat, this.root)); }
    // safety glasses: one clear wraparound lens that follows the curve of the face, with a dark brow bar along the top edge and temple arms back to the ears
    {
      const gm = new StandardMaterial("lensglass", sc); gm.diffuseColor = new Color3(0.1, 0.17, 0.24); gm.emissiveColor = new Color3(0.03, 0.07, 0.11); gm.alpha = 0.5; gm.specularColor = new Color3(1, 1, 1); gm.specularPower = 80; gm.backFaceCulling = false;
      const arcMesh = (h: number, dy: number, sx: number, sz: number, arc: number) => {
        const c = MeshBuilder.CreateCylinder("lensarc", { diameter: 1, height: h, tessellation: 48, arc, enclose: false, sideOrientation: Mesh.DOUBLESIDE }, sc);
        c.scaling.set(sx, 1, sz); c.position.set(0, HY + dy, 0); c.rotation.y = Math.PI + (Math.PI / 2 - arc * Math.PI); return c;   // centre the arc on the face
      };
      const lens = arcMesh(0.036, 0.008, 0.222, 0.246, 0.3); lens.material = gm; lens.parent = this.root; ppeAdd(lens);
      ppeAdd(mk(arcMesh(0.011, 0.0285, 0.224, 0.248, 0.3), "#15171a"));      // brow bar
      for (const s of [-1, 1]) {
        const tp = MeshBuilder.CreateBox("temple", { width: 0.006, height: 0.01, depth: 0.1 }, sc); tp.position.set(s * 0.1, HY + 0.018, -0.012); tp.rotation.y = 0; ppeAdd(mk(tp, "#15171a"));
      }
    }
    // ---- the finale's spacesuit parts (hidden), and what to whiten
    {
      const sp: Mesh[] = [];
      const helm = ball(0.37, "#ffffff", this.root, 0, HY + 0.01, 0.01, 1, 1, 1, 18);
      const gm = new StandardMaterial("helmglass", sc); gm.diffuseColor = new Color3(0.72, 0.86, 0.95); gm.alpha = 0.3; gm.specularColor = new Color3(1, 1, 1); gm.specularPower = 40; helm.material = gm; sp.push(helm);
      sp.push(cyl(0.22, 0.24, 0.07, "#e6eaee", this.root, 0, 1.5, 0.004));
      const pack = MeshBuilder.CreateBox("lpack", { width: 0.36, height: 0.5, depth: 0.2 }, sc); pack.position.set(0, 1.22, -0.2); sp.push(mk(pack, "#e6eaee"));
      const chest = MeshBuilder.CreateBox("lchest", { width: 0.17, height: 0.12, depth: 0.04 }, sc); chest.position.set(0, 1.28, 0.125); sp.push(mk(chest, "#e07010"));
      sp.forEach((x) => x.setEnabled(false)); this.suitParts = sp;
      this.suitSwap = swap.map((mesh) => ({ mesh, orig: mesh.material }));
    }
    this.root.scaling.setAll(o.scale ?? 1);
  }

  /** Rigged, skinned character: real animation clips, with PPE that follows the head / chest bones. */
  private fromChar(ck: CharKit, o: HumanOpts) {
    const sc = this.scene, c = ck.instantiate(1.78);
    this.ch = c; c.holder.parent = this.root;
    for (const m of c.meshes) this.meshes.push(m as Mesh);
    // bone names differ between rigs (Mixamo vs Quaternius): look each role up under both
    const alias: Record<string, string[]> = {
      Head: ["Head_end", "HeadTop_End", "Head"], Spine2: ["Chest", "Spine2", "Torso"],
      LeftArm: ["UpperArm.L", "LeftArm"], RightArm: ["UpperArm.R", "RightArm"], LeftForeArm: ["LowerArm.L", "LeftForeArm"], RightForeArm: ["LowerArm.R", "RightForeArm"],
      LeftFoot: ["Foot.L", "LeftFoot"], RightFoot: ["Foot.R", "RightFoot"], LeftLegEnd: ["LowerLeg.L_end", "LeftFoot"], RightLegEnd: ["LowerLeg.R_end", "RightFoot"], LeftFootEnd: ["Foot.L_end", "LeftToeBase", "LeftToe_End"], RightFootEnd: ["Foot.R_end", "RightToeBase", "RightToe_End"],
      LeftHand: ["Wrist.L", "LeftHand"], RightHand: ["Wrist.R", "RightHand"],
      LeftUpLeg: ["UpperLeg.L", "LeftUpLeg"], RightUpLeg: ["UpperLeg.R", "RightUpLeg"], LeftLeg: ["LowerLeg.L", "LeftLeg"], RightLeg: ["LowerLeg.R", "RightLeg"],
    };
    for (const [k, names] of Object.entries(alias)) this.bones[k] = names.map((n) => c.bone(n)).find(Boolean) ?? null;
    // flat-colour models (Quaternius): tint clothes per person, and drop any bundled hat so the hard hat reads
    const tint = (re: RegExp, hex: string | undefined) => { if (hex) for (const mt of c.materials) if (re.test(mt.name)) mt.set(hex); };
    // the model's materials: Brown = shirt (and gloves), LightBlue = overalls, Beige = cuffs, Skin, Eyebrows = hair, Red = headband, Brown2 = boots
    const seed = ++Human.count, rnd = (n: number) => { const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
    const pick = <T,>(a: T[], n: number) => a[Math.floor(rnd(n) * a.length) % a.length];
    const hair = o.hair ?? pick(["#1c130c", "#3b2616", "#6a4a2a", "#a07a3a", "#d2b06a", "#7a2e14", "#8d8d8d", "#0b0b0b"], 1);
    const band = o.band !== undefined ? o.band : rnd(2) < 0.3 ? pick(["#b3231c", "#1d6fb5", "#2f7d3e", "#e8b923"], 3) : false;
    const boots = pick(["#2a1d12", "#3a2a1c", "#1a1a1a", "#4a3a2a"], 4);
    tint(/^Brown2/, boots); tint(/^Brown(?!2)/, o.shirt); tint(/^Beige/, o.shirt); tint(/^LightBlue/, o.pants); tint(/^Skin/, o.skin); tint(/^Eyebrows/, hair);
    // Boots: the model's own feet are hidden. Our own boots hang off the SHIN bone (the one thing every clip animates correctly):
    // planted at the shin's lower end, tilted with the shin, always facing the way the body faces. No foot bones, no skinning.
    for (const mesh of c.meshes) if (/feet/i.test(mesh.name)) mesh.setEnabled(false);
    const bootParts: { node: TransformNode; knee: TransformNode | null | undefined; end: TransformNode | null | undefined; prev: Quaternion | null }[] = [];
    for (const side of ["Left", "Right"]) {
      const node = new TransformNode("boot", sc); node.parent = this.root;
      const part = (mesh: Mesh, hex: string, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { mesh.material = m(sc, hex); mesh.parent = node; mesh.position.set(x, y, z); mesh.scaling.set(sx, sy, sz); this.meshes.push(mesh); return mesh; };
      const toeCol = lighten(boots, 0.16), solCol = "#0c0b0a";
      part(MeshBuilder.CreateCylinder("bsh", { diameterTop: 0.1, diameterBottom: 0.116, height: 0.17, tessellation: 18 }, sc), boots, 0, 0.12, 0.0);      // tapered shaft, under the pant cuff
      part(MeshBuilder.CreateSphere("bfo", { diameter: 1, segments: 16 }, sc), boots, 0, 0.068, 0.085, 0.118, 0.098, 0.3);                               // rounded foot (an ellipsoid: no square edges)
      part(MeshBuilder.CreateBox("bto2", { width: 0.05, height: 0.012, depth: 0.1 }, sc), "#b9a98c", 0, 0.118, 0.065).rotation.x = -0.5;                // tongue
      for (let li = 0; li < 3; li++) part(MeshBuilder.CreateBox("bla", { width: 0.075, height: 0.008, depth: 0.012 }, sc), "#d8cfba", 0, 0.12 + li * 0.012, 0.045 + li * 0.04).rotation.x = -0.45;   // laces
      part(MeshBuilder.CreateSphere("bto", { diameter: 1, segments: 14 }, sc), toeCol, 0, 0.056, 0.2, 0.112, 0.082, 0.13);                              // toe cap, a shade lighter
      part(MeshBuilder.CreateCylinder("bhe", { diameter: 0.118, height: 0.034, tessellation: 18 }, sc), solCol, 0, 0.017, -0.035);                     // round heel block
      part(MeshBuilder.CreateCylinder("bso", { diameter: 1, height: 0.028, tessellation: 28 }, sc), solCol, 0, 0.014, 0.1, 0.122, 1, 0.33);              // oval sole: round in plan, wider at the ball of the foot
      bootParts.push({ node, knee: this.bones[side + "Leg"], end: this.bones[side + "LegEnd"], prev: null });
    }
    sc.onAfterAnimationsObservable.add(() => {
      if (!this.root.isEnabled()) return;
      this.root.computeWorldMatrix(true);
      const inv = this.root.getWorldMatrix().clone().invert(), q = new Quaternion(), fwd = new Vector3(0, 0, 1);
      for (const bp of bootParts) {
        if (!bp.knee || !bp.end) continue;
        bp.knee.computeWorldMatrix(true); bp.end.computeWorldMatrix(true);
        const e = Vector3.TransformCoordinates(bp.end.getAbsolutePosition(), inv), k = Vector3.TransformCoordinates(bp.knee.getAbsolutePosition(), inv);
        const up = k.subtract(e); if (up.lengthSquared() < 1e-6) continue; up.normalize();
        // a foot does not swing as far as the shin does while running: blend the shin direction with straight up, so the boot stays under the leg instead of flicking
        up.scaleInPlace(0.8).addInPlace(new Vector3(0, 0.2, 0)).normalize();
        const f = fwd.subtract(up.scale(Vector3.Dot(fwd, up))); if (f.lengthSquared() < 1e-6) continue; f.normalize();   // body-forward made perpendicular to the shin
        Quaternion.FromLookDirectionLHToRef(f.scale(-1), up, q);   // (this helper points -z along the look direction here, so give it the opposite)
        // low-pass the orientation too, so a fast shin swing cannot make the boot twitch
        bp.node.position.copyFrom(e);
        bp.prev = bp.prev ? Quaternion.Slerp(bp.prev, q, 0.75) : q.clone();
        bp.node.rotationQuaternion = bp.prev.clone();
      }
    });
    if (band) tint(/^Red/, band);
    else for (const mesh of c.meshes) if (/^Red/.test(String((mesh.material as any)?.name ?? "").replace(/_c\d+$/, ""))) mesh.setEnabled(false);
    const sy = o.height ?? 0.95 + rnd(5) * 0.11, sx = 0.95 + rnd(6) * 0.14;
    this.chBuild = new Vector3(sy, sy, sy);   // uniform only: non-uniform scale on the root shears every rotating limb and foot (looks like smeared boots while running)
    for (const mesh of c.meshes) if (/head/i.test(mesh.name) && /^Beige/.test(String((mesh.material as any)?.name ?? "").replace(/_c\d+$/, ""))) mesh.setEnabled(false);
    this.hairMeshes = c.meshes.filter((x) => /^Eyebrows/.test(String((x.material as any)?.name ?? "").replace(/_cd+$/, ""))) as Mesh[];
    const mk = (mesh: Mesh, hex: string) => { mesh.material = m(sc, hex); mesh.parent = this.root; this.meshes.push(mesh); this.ppe.push(mesh); return mesh; };
    const parts: { mesh: Mesh; bone: string; off: Vector3 }[] = [];
    const add = (mesh: Mesh, hex: string, bone: string, x: number, y: number, z: number) => { mk(mesh, hex); parts.push({ mesh, bone, off: new Vector3(x, y, z) }); return mesh; };
    const hatCol = o.hat ?? "#f4f4f4";
    if (o.hat) {
      const BRIM_Y = -0.13;
      for (const p of hardHatParts(sc)) add(p.mesh, p.mesh.name === "hhband" ? "#e6e9ec" : p.mesh.name === "hhmark" ? "#2fb37a" : hatCol, "Head", p.x, BRIM_Y + p.y, p.z);
    }
    if (o.vest) {
      add(MeshBuilder.CreateBox("v", { width: 0.4, height: 0.5, depth: 0.25 }, sc), "#e8f542", "Spine2", 0, -0.04, 0.02);
      add(MeshBuilder.CreateBox("vs1", { width: 0.41, height: 0.06, depth: 0.26 }, sc), "#cfd3d6", "Spine2", 0, -0.12, 0.02);
      add(MeshBuilder.CreateBox("vs2", { width: 0.41, height: 0.06, depth: 0.26 }, sc), "#cfd3d6", "Spine2", 0, 0.08, 0.02);
    }
    if (o.detail) {
      for (const sx of [-1, 1]) {
        add(MeshBuilder.CreateBox("gl", { width: 0.068, height: 0.04, depth: 0.018 }, sc), "#a9dcf0", "Head", sx * 0.042, -0.16, 0.105);
        add(MeshBuilder.CreateBox("glr", { width: 0.074, height: 0.008, depth: 0.022 }, sc), "#15171a", "Head", sx * 0.042, -0.14, 0.106);
        add(MeshBuilder.CreateBox("glt", { width: 0.01, height: 0.012, depth: 0.1 }, sc), "#15171a", "Head", sx * 0.092, -0.16, 0.055);
      }
      add(MeshBuilder.CreateBox("glb", { width: 0.03, height: 0.01, depth: 0.02 }, sc), "#15171a", "Head", 0, -0.153, 0.108);
    }
    // spacesuit parts (hidden until setSuit(true)); they are not part of the PPE set
    {
      const sp: Mesh[] = [];
      const helm = add(MeshBuilder.CreateSphere("helm", { diameter: 0.4, segments: 18 }, sc), "#ffffff", "Head", 0, -0.115, 0.01);
      const gm = new StandardMaterial("helmglass", sc); gm.diffuseColor = new Color3(0.72, 0.86, 0.95); gm.alpha = 0.3; gm.specularColor = new Color3(1, 1, 1); gm.specularPower = 40; helm.material = gm; sp.push(helm);
      sp.push(add(MeshBuilder.CreateCylinder("hring", { diameter: 0.28, height: 0.07, tessellation: 20 }, sc), "#e6eaee", "Head", 0, -0.3, 0.0));
      sp.push(add(MeshBuilder.CreateBox("lpack", { width: 0.38, height: 0.52, depth: 0.2 }, sc), "#e6eaee", "Spine2", 0, -0.02, -0.22));
      sp.push(add(MeshBuilder.CreateBox("lpackb", { width: 0.3, height: 0.1, depth: 0.22 }, sc), "#9aa3ad", "Spine2", 0, -0.2, -0.22));
      sp.push(add(MeshBuilder.CreateBox("lchest", { width: 0.18, height: 0.13, depth: 0.04 }, sc), "#e07010", "Spine2", 0, 0.04, 0.16));
      sp.forEach((m) => m.setEnabled(false)); this.suitParts = sp; this.ppe = this.ppe.filter((x) => !sp.includes(x));
      this.suitBase = [{ re: /^Brown(?!2)/, hex: o.shirt }, { re: /^Beige/, hex: o.shirt }, { re: /^LightBlue/, hex: o.pants }];
      this.suitCloth = (c.materials as any[]).filter((mt) => this.suitBase.some((s) => s.re.test(String(mt.name).replace(/_c\d+$/, ""))));
    }
    this.chParts = parts;
    this.ppeLocal = new Vector3();
    const sc0 = o.scale ?? 1;
    this.root.scaling.set(this.chBuild.x * sc0, this.chBuild.y * sc0, this.chBuild.z * sc0);
  }
  static count = 0;
  private chBuild = new Vector3(1, 1, 1);
  private chParts: { mesh: Mesh; bone: string; off: Vector3 }[] = [];
  private ppeLocal!: Vector3;

  /** rotate `bone` so the segment from it to `child` points along `dir` (world space) */
  private aim(bone: TransformNode | null | undefined, child: TransformNode | null | undefined, dir: Vector3) {
    if (!bone || !child || !bone.parent) return;
    const par = bone.parent as TransformNode;
    par.computeWorldMatrix(true); bone.computeWorldMatrix(true); child.computeWorldMatrix(true);
    const now = child.getAbsolutePosition().subtract(bone.getAbsolutePosition());
    if (now.lengthSquared() < 1e-8) return;
    now.normalize();
    const dw = new Quaternion(); Quaternion.FromUnitVectorsToRef(now, dir, dw);
    const pr = new Quaternion(); par.getWorldMatrix().decompose(undefined, pr, undefined);
    const local = bone.rotationQuaternion ?? Quaternion.FromEulerVector(bone.rotation);
    bone.rotationQuaternion = Quaternion.Inverse(pr).multiply(dw).multiply(pr).multiply(local);
    bone.computeWorldMatrix(true);
  }

  private chSatWait = 0;
  private animateChar(dt: number, speed: number) {
    const c = this.ch!;
    const next = this.seated ? "sit" : speed < 0.15 ? "idle" : speed < 4.4 ? "walk" : "run";
    const grp = { idle: c.idle, walk: c.walk ?? c.idle, run: c.run ?? c.walk, sit: c.idle } as Record<string, any>;
    if (next !== this.chState) {
      for (const g of [c.idle, c.walk, c.run]) g?.stop();

      this.chState = next;
      const g = grp[next]; g?.start(true, 1, g.from, g.to, false);
      if (next === "idle" && !c.idle && c.walk) { c.walk.start(true); c.walk.goToFrame(c.walk.from); c.walk.pause(); }
      if (next === "sit") { g?.goToFrame(g.from); g?.pause(); this.chSat = false; this.chSatWait = 3; }
    }
    if (next === "walk" && c.walk) c.walk.speedRatio = Math.max(0.6, Math.min(1.5, speed / 2.6));
    if (next === "run" && grp.run) grp.run.speedRatio = Math.max(0.7, speed / 5.2);
    // wait a few frames before aiming the limbs: the bones only catch up with a freshly set body rotation after a render, and aiming off stale bone matrices left the legs pointing backward
    if (next === "sit" && !this.chSat && this.chSatWait-- <= 0) {
      // freeze the idle pose, then aim each limb segment in world space (bone axes differ between rigs, so no hard-coded axes):
      // thighs point forward, shins straight down, upper arms forward-down, forearms forward
      this.root.computeWorldMatrix(true);
      const fwd = this.root.getDirection(Vector3.Forward()); fwd.y = 0; fwd.normalize();
      const down = new Vector3(0, -1, 0);
      for (const side of ["Left", "Right"]) {
        this.aim(this.bones[side + "UpLeg"], this.bones[side + "Leg"], fwd);
        this.aim(this.bones[side + "Leg"], this.bones[side + "Foot"], down);
        this.aim(this.bones[side + "Arm"], this.bones[side + "ForeArm"], fwd.scale(0.55).add(down.scale(0.85)).normalize());
        this.aim(this.bones[side + "ForeArm"], this.bones[side + "Hand"], fwd.scale(0.95).add(down.scale(0.3)).normalize());
      }
      this.chSat = true;
    }
    // PPE follows the bones (positions taken in this person's local space)
    if (this.chParts.length) {
      this.root.computeWorldMatrix(true);
      const inv = this.root.getWorldMatrix().clone().invert();
      const cache: Record<string, Vector3> = {};
      for (const p of this.chParts) {
        const b = this.bones[p.bone]; if (!b) continue;
        const pos = cache[p.bone] ?? (cache[p.bone] = Vector3.TransformCoordinates(b.getAbsolutePosition(), inv));
        p.mesh.position.set(pos.x + p.off.x, pos.y + p.off.y, pos.z + p.off.z);
      }
    }
  }

  /** Jointed Blender model: hips, KNEES, ankles, shoulders, ELBOWS, wrists are real pivots. */
  private fromKit(kit: Kit, o: HumanOpts) {
    const sc = this.scene, root = this.root;
    const colors: Record<string, string> = {
      shirt: o.shirt, pants: o.pants, hat: o.hat ?? "#f4f4f4", skin: o.skin ?? "#d9a77f", vest: "#e8f542", stripe: "#cfd3d6",
      glove: "#2b2118", boot: "#2a1d12", belt: "#1e1a16", dark: "#101012", steel: "#9aa0a8",
    };
    const piv = (name: string, parent: TransformNode, x: number, y: number, z = 0) => { const n = new TransformNode(name, sc); n.parent = parent; n.position.set(x, y, z); return n; };
    const put = (part: string, parent: TransformNode, flip = false): Mesh | undefined => {
      const tpl = kit.templates.get(part); if (!tpl) return undefined;
      const mat = part.slice(part.lastIndexOf("_") + 1);
      const c = tpl.clone(part + "_h", parent) as Mesh;
      c.setEnabled(true); c.isPickable = false; c.material = m(sc, colors[mat] ?? "#808080"); c.receiveShadows = true;
      if (flip) c.scaling.x = -1;
      this.meshes.push(c);
      return c;
    };
    for (const p of ["torso_shirt", "pelvis_pants", "belt_belt", "buckle_dark", "neck_skin", "head_skin", "nose_skin", "eyes_dark"]) put(p, root);
    if (o.vest) for (const p of ["vest_vest", "stripe_stripe"]) { const c = put(p, root); if (c) this.ppe.push(c); }
    if (o.hat) { const c = put("hat_hat", root); if (c) this.ppe.push(c); }
    const leg = (side: number) => {
      const hip = piv("hip", root, side * 0.12, 0.9);
      put("thigh_pants", hip);
      const knee = piv("knee", hip, 0, -0.44);
      put("shin_pants", knee); put("kneepad_dark", knee);
      const ankle = piv("ankle", knee, 0, -0.4);
      put("boot_boot", ankle); put("sole_dark", ankle);
      return { hip, knee };
    };
    const arm = (side: number) => {
      const sh = piv("shoulder", root, side * 0.31, 1.42);
      put("upperarm_shirt", sh);
      const el = piv("elbow", sh, 0, -0.3);
      put("forearm_shirt", el);
      const wr = piv("wrist", el, 0, -0.26);
      put("hand_glove", wr, side < 0);
      return { sh, el };
    };
    const L = leg(-1), R = leg(1), aL = arm(-1), aR = arm(1);
    this.legL = L.hip; this.legR = R.hip; this.kneeL = L.knee; this.kneeR = R.knee;
    this.armL = aL.sh; this.armR = aR.sh; this.elbowL = aL.el; this.elbowR = aR.el;
    this.addDetail(o);
    this.root.scaling.setAll(o.scale ?? 1);
  }
  /** Show or hide the hard hat, vest and safety glasses (the player gets them at the gate). */
  setPPE(on: boolean) { this.ppeOn = on; if (this.suitOn) return; this.ppe.forEach((x) => x.setEnabled(on)); /* the hair stays: the hat sits over the top of it and the back still shows below the brim */ }

  /** Extra face, clothing and gear detail. Parts hang off the root or the arm pivots so they work with both body builds. */
  private addDetail(o: HumanOpts) {
    if (!o.detail) return;
    const sc = this.scene, skin = o.skin ?? "#d9a77f";
    const add = (mesh: Mesh, hex: string, parent: TransformNode = this.root, ppe = false) => {
      mesh.material = m(sc, hex); mesh.parent = parent; this.meshes.push(mesh); if (ppe) this.ppe.push(mesh); return mesh;
    };
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string, parent?: TransformNode, ppe = false) => {
      const b = MeshBuilder.CreateBox("dt", { width: w, height: h, depth: d }, sc); b.position.set(x, y, z); return add(b, hex, parent, ppe);
    };
    const ball = (dia: number, x: number, y: number, z: number, hex: string, sx = 1, sy = 1, sz = 1, parent?: TransformNode, ppe = false) => {
      const b = MeshBuilder.CreateSphere("dt", { diameter: dia, segments: 10 }, sc); b.position.set(x, y, z); b.scaling.set(sx, sy, sz); return add(b, hex, parent, ppe);
    };
    const ring = (dia: number, hgt: number, y: number, hex: string, parent: TransformNode = this.root) => {
      const c = MeshBuilder.CreateCylinder("dt", { diameter: dia, height: hgt, tessellation: 14 }, sc); c.position.y = y; return add(c, hex, parent);
    };
    // head: hair, ears, brows, mouth, stubble
    const hair = MeshBuilder.CreateSphere("hair", { diameter: 0.268, segments: 12, slice: 0.58 }, sc);
    hair.position.set(0, 1.645, -0.012); hair.scaling.set(0.92, 1, 1.02); add(hair, "#3b2a1c"); this.hairCap = hair;
    box(0.13, 0.06, 0.045, 0, 1.612, -0.092, "#3b2a1c");                       // hair down the back of the neck
    for (const sx of [-1, 1]) {
      ball(0.05, sx * 0.118, 1.615, 0.0, skin, 0.5, 1, 0.8);               // ears
      box(0.05, 0.011, 0.014, sx * 0.046, 1.668, 0.112, "#2a1d12");        // eyebrows
      ball(0.012, sx * 0.046, 1.635, 0.116, "#ffffff");                    // eye whites catch the light
    }
    box(0.07, 0.012, 0.014, 0, 1.562, 0.112, "#7a4a3a");                    // mouth
    box(0.11, 0.045, 0.02, 0, 1.54, 0.1, "#8a6a50");                        // stubble on the chin
    // shirt: collar, pocket, flap, company badge, ID on a lanyard
    ring(0.17, 0.035, 1.455, o.shirt);
    box(0.115, 0.115, 0.014, -0.115, 1.27, 0.147, o.shirt);
    box(0.12, 0.025, 0.018, -0.115, 1.325, 0.149, "#101012");
    box(0.07, 0.04, 0.01, -0.115, 1.255, 0.156, "#e8f542");                  // pocket notebook
    box(0.05, 0.016, 0.01, -0.095, 1.325, 0.152, "#c8c8c8");                 // pen clip
    box(0.08, 0.05, 0.012, 0.11, 1.28, 0.147, "#f2f2f2");                    // name patch
    box(0.06, 0.012, 0.014, 0.11, 1.29, 0.153, "#233a52");
    box(0.012, 0.18, 0.012, 0.02, 1.34, 0.145, "#c4561a");                   // lanyard
    box(0.065, 0.08, 0.008, 0.02, 1.22, 0.15, "#ffffff");                    // ID card
    // belt gear: radio holster + antenna, tool pouch, tape measure, pants pockets
    box(0.07, 0.13, 0.05, 0.24, 0.84, 0.03, "#15171a");
    box(0.012, 0.16, 0.012, 0.255, 0.99, 0.035, "#15171a");
    box(0.1, 0.1, 0.07, -0.23, 0.82, 0.05, "#3a2a1c");
    box(0.06, 0.05, 0.04, -0.17, 0.82, 0.14, "#e8b923");
    for (const sx of [-1, 1]) box(0.1, 0.014, 0.014, sx * 0.14, 0.72, 0.14, "#1a2230");
    // arms: reflective sleeve bands, cuffs, wristwatch
    for (const arm of [this.armL, this.armR]) {
      ring(0.145, 0.035, -0.24, "#cfd3d6", arm);
      ring(0.142, 0.045, -0.54, o.shirt, arm);
    }
    ring(0.15, 0.035, -0.5, "#1a1a1c", this.armL);
    box(0.07, 0.02, 0.07, 0, -0.5, 0.05, "#9aa0a8", this.armL);
    // safety glasses ride with the PPE
    // wraparound lenses (slightly curved: flattened ellipsoids that follow the face), a dark brow rim, a bridge, and temples that hug the head to the ears
    for (const sx of [-1, 1]) {
      const lens = ball(0.072, sx * 0.043, 1.664, 0.119, "#a9dcf0", 1, 0.5, 0.3, undefined, true);
      lens.rotation.y = sx * 0.28;
      box(0.072, 0.007, 0.012, sx * 0.044, 1.681, 0.126, "#15171a", undefined, true).rotation.y = sx * 0.28;   // upper rim
      box(0.07, 0.005, 0.01, sx * 0.044, 1.645, 0.122, "#2a2d31", undefined, true).rotation.y = sx * 0.28;     // lower rim, thinner
      const tp = box(0.009, 0.012, 0.11, sx * 0.098, 1.668, 0.06, "#15171a", undefined, true); tp.rotation.y = sx * -0.38;   // temple arm
      ball(0.016, sx * 0.012, 1.652, 0.127, "#d9d9d9", 0.6, 1, 0.6, undefined, true);                           // nose pad
    }
    box(0.026, 0.008, 0.012, 0, 1.667, 0.129, "#15171a", undefined, true);                                        // bridge
  }
  setShadow(gen: { addShadowCaster(m: Mesh): void }) { this.meshes.forEach((x) => gen.addShadowCaster(x)); }
  /** raise the right hand to use what it holds: the phone to the ear, the tally book up to write in, the gas monitor out in front */
  handPose: "phone" | "tally" | "gas" | "rod" | "gun" | null = null; private handLeft = 0; private handW = 0;
  useHand(kind: "phone" | "tally" | "gas" | "rod" | "gun", secs: number) { this.handPose = kind; this.handLeft = secs; }
  private applyHand(dt: number) {
    if (this.handLeft > 0) this.handLeft -= dt;
    this.handW += ((this.handLeft > 0 ? 1 : 0) - this.handW) * Math.min(1, dt * 9);
    if (this.handW < 0.01 || !this.handPose || !this.armR || !this.elbowR || this.ch) return;
    const T = { phone: { s: -0.35, z: 0.45, e: -2.45 }, tally: { s: -0.95, z: 0.1, e: -1.5 }, gas: { s: -1.25, z: 0.05, e: -0.35 }, rod: { s: -1.0, z: 0.08, e: -0.6 }, gun: { s: -1.4, z: 0.05, e: -0.15 } }[this.handPose];
    const w = this.handW;
    this.armR.rotation.x += (T.s - this.armR.rotation.x) * w; this.armR.rotation.z = T.z * w; this.elbowR.rotation.x += (T.e - this.elbowR.rotation.x) * w;
  }
  animate(dt: number, speed: number) { this.baseAnimate(dt, speed); this.applyHand(dt); }
  private baseAnimate(dt: number, speed: number) {
    if (this.ch) { this.animateChar(dt, speed); return; }
    if (this.seated) {
      this.phase += dt * 1.2;
      this.legL.rotation.x = this.legR.rotation.x = -1.5;
      if (this.kneeL && this.kneeR && this.elbowL && this.elbowR) {
        this.kneeL.rotation.x = this.kneeR.rotation.x = 1.5; this.elbowL.rotation.x = this.elbowR.rotation.x = -0.7;
      }
      this.armL.rotation.x = this.armR.rotation.x = -0.75 + Math.sin(this.phase) * 0.04;
      return;
    }
    if (speed > 0.15) {
      this.phase += dt * (4 + speed * 1.6);
      const amp = Math.min(0.9, 0.3 + speed * 0.1);
      const s = Math.sin(this.phase) * amp;
      this.legL.rotation.x = s; this.legR.rotation.x = -s;
      this.armL.rotation.x = -s * 0.8; this.armR.rotation.x = s * 0.8;
      if (this.kneeL && this.kneeR && this.elbowL && this.elbowR) {
        const c = Math.cos(this.phase), run = Math.min(1, speed / 6);
        // knee flexes while that leg swings forward to the next step, with a slight bend at heel strike
        this.kneeL.rotation.x = 0.08 + Math.max(0, -c) * (0.9 + 0.6 * run) * amp * 1.4;
        this.kneeR.rotation.x = 0.08 + Math.max(0, c) * (0.9 + 0.6 * run) * amp * 1.4;
        // elbows stay bent and pump with the stride
        this.elbowL.rotation.x = -(0.25 + 0.5 * run + Math.max(0, s) * 0.5);
        this.elbowR.rotation.x = -(0.25 + 0.5 * run + Math.max(0, -s) * 0.5);
      }
    } else {
      if (this.kneeL && this.kneeR && this.elbowL && this.elbowR) {
        this.kneeL.rotation.x = 0.05; this.kneeR.rotation.x = 0.05; this.elbowL.rotation.x = -0.12; this.elbowR.rotation.x = -0.12;
      }
      this.phase += dt * 1.2;
      const s = Math.sin(this.phase) * 0.03;
      this.legL.rotation.x = 0; this.legR.rotation.x = 0;
      this.armL.rotation.x = s; this.armR.rotation.x = -s;
    }
  }
  pos(): Vector3 { return this.root.position; }
}
