import { Scene, MeshBuilder, StandardMaterial, Color3, TransformNode, Mesh, Vector3 } from "@babylonjs/core";
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

export interface HumanOpts {
  shirt: string; pants: string; hat: string | null; skin?: string; vest?: boolean; scale?: number;
  /** extra face / clothing detail (the player's own body) */
  detail?: boolean;
  /** hair colour, headband colour (false = none), height multiplier: all random per person unless given */
  hair?: string; band?: string | false; height?: number;
  /** hat / vest / glasses start hidden until setPPE(true) */
  ppeOff?: boolean;
}


export class Human {
  root: TransformNode;
  legL!: TransformNode; legR!: TransformNode; armL!: TransformNode; armR!: TransformNode;
  /** set by main once the Blender kit has loaded; Humans built afterwards use the jointed model */
  static kit: Kit | null = null;
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
  phase = Math.random() * 6;
  walking = false;
  /** sitting pose (thighs forward, knees bent, hands on the controls) */
  seated = false;
  constructor(public scene: Scene, o: HumanOpts) {
    this.root = new TransformNode("human", scene);
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
      const hat = MeshBuilder.CreateSphere("hat", { diameter: 0.31, segments: 16, slice: 0.55 }, scene);
      hat.position.y = 1.68; this.ppe.push(mk(hat, o.hat, this.root));
      const brim = MeshBuilder.CreateCylinder("brim", { diameter: 0.38, height: 0.025, tessellation: 20 }, scene);
      brim.position.y = 1.68; this.ppe.push(mk(brim, o.hat, this.root));
      const bill = MeshBuilder.CreateBox("bill", { width: 0.2, height: 0.02, depth: 0.1 }, scene);
      bill.position.set(0, 1.675, 0.2); this.ppe.push(mk(bill, o.hat, this.root));
      const ridge = MeshBuilder.CreateBox("rdg", { width: 0.035, height: 0.025, depth: 0.28 }, scene);
      ridge.position.set(0, 1.84, 0); this.ppe.push(mk(ridge, o.hat, this.root));
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
  /** Rigged, skinned character: real animation clips, with PPE that follows the head / chest bones. */
  private fromChar(ck: CharKit, o: HumanOpts) {
    const sc = this.scene, c = ck.instantiate(1.78);
    this.ch = c; c.holder.parent = this.root;
    for (const m of c.meshes) this.meshes.push(m as Mesh);
    // bone names differ between rigs (Mixamo vs Quaternius): look each role up under both
    const alias: Record<string, string[]> = {
      Head: ["Head_end", "HeadTop_End", "Head"], Spine2: ["Chest", "Spine2", "Torso"],
      LeftArm: ["UpperArm.L", "LeftArm"], RightArm: ["UpperArm.R", "RightArm"], LeftForeArm: ["LowerArm.L", "LeftForeArm"], RightForeArm: ["LowerArm.R", "RightForeArm"],
      LeftHand: ["Wrist.L", "LeftHand"], RightHand: ["Wrist.R", "RightHand"], LeftFoot: ["Foot.L", "LeftFoot"], RightFoot: ["Foot.R", "RightFoot"],
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
    if (band) tint(/^Red/, band);
    else for (const mesh of c.meshes) if (/^Red/.test(String((mesh.material as any)?.name ?? "").replace(/_c\d+$/, ""))) mesh.setEnabled(false);
    const sy = o.height ?? 0.95 + rnd(5) * 0.11, sx = 0.95 + rnd(6) * 0.14;
    this.chBuild = new Vector3(sx, sy, sx);
    for (const mesh of c.meshes) if (/head/i.test(mesh.name) && /^Beige/.test(String((mesh.material as any)?.name ?? "").replace(/_c\d+$/, ""))) mesh.setEnabled(false);
    const mk = (mesh: Mesh, hex: string) => { mesh.material = m(sc, hex); mesh.parent = this.root; this.meshes.push(mesh); this.ppe.push(mesh); return mesh; };
    const parts: { mesh: Mesh; bone: string; off: Vector3 }[] = [];
    const add = (mesh: Mesh, hex: string, bone: string, x: number, y: number, z: number) => { mk(mesh, hex); parts.push({ mesh, bone, off: new Vector3(x, y, z) }); return mesh; };
    const hatCol = o.hat ?? "#f4f4f4";
    if (o.hat) {
      add(MeshBuilder.CreateSphere("hat", { diameter: 0.3, segments: 14, slice: 0.55 }, sc), hatCol, "Head", 0, -0.1, 0.0);
      add(MeshBuilder.CreateCylinder("brim", { diameter: 0.37, height: 0.022, tessellation: 20 }, sc), hatCol, "Head", 0, -0.095, 0.01);
      add(MeshBuilder.CreateBox("bill", { width: 0.2, height: 0.02, depth: 0.1 }, sc), hatCol, "Head", 0, -0.1, 0.17);
      add(MeshBuilder.CreateBox("rdg", { width: 0.035, height: 0.025, depth: 0.27 }, sc), hatCol, "Head", 0, 0.05, 0.0);
    }
    if (o.vest) {
      add(MeshBuilder.CreateBox("v", { width: 0.4, height: 0.5, depth: 0.25 }, sc), "#e8f542", "Spine2", 0, -0.04, 0.02);
      add(MeshBuilder.CreateBox("vs1", { width: 0.41, height: 0.06, depth: 0.26 }, sc), "#cfd3d6", "Spine2", 0, -0.12, 0.02);
      add(MeshBuilder.CreateBox("vs2", { width: 0.41, height: 0.06, depth: 0.26 }, sc), "#cfd3d6", "Spine2", 0, 0.08, 0.02);
    }
    if (o.detail) {
      add(MeshBuilder.CreateBox("gl", { width: 0.15, height: 0.05, depth: 0.03 }, sc), "#9fd3e8", "Head", 0, -0.12, 0.105);
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

  private animateChar(dt: number, speed: number) {
    const c = this.ch!;
    const next = this.seated ? "sit" : speed < 0.15 ? "idle" : speed < 2.6 ? "walk" : "run";
    const grp = { idle: c.idle, walk: c.walk ?? c.idle, run: c.run ?? c.walk, sit: c.idle } as Record<string, any>;
    if (next !== this.chState) {
      for (const g of [c.idle, c.walk, c.run]) g?.stop();
      this.chState = next;
      const g = grp[next]; g?.start(true, 1, g.from, g.to, false);
      if (next === "idle" && !c.idle && c.walk) { c.walk.start(true); c.walk.goToFrame(c.walk.from); c.walk.pause(); }
      if (next === "sit") { g?.goToFrame(g.from); g?.pause(); this.chSat = false; }
    }
    if (next === "walk" && c.walk) c.walk.speedRatio = Math.max(0.5, speed / 2.0);
    if (next === "run" && grp.run) grp.run.speedRatio = Math.max(0.6, speed / 5);
    if (next === "sit" && !this.chSat) {
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
  setPPE(on: boolean) { this.ppe.forEach((x) => x.setEnabled(on)); }

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
    const ball = (dia: number, x: number, y: number, z: number, hex: string, sx = 1, sy = 1, sz = 1, parent?: TransformNode) => {
      const b = MeshBuilder.CreateSphere("dt", { diameter: dia, segments: 8 }, sc); b.position.set(x, y, z); b.scaling.set(sx, sy, sz); return add(b, hex, parent);
    };
    const ring = (dia: number, hgt: number, y: number, hex: string, parent: TransformNode = this.root) => {
      const c = MeshBuilder.CreateCylinder("dt", { diameter: dia, height: hgt, tessellation: 14 }, sc); c.position.y = y; return add(c, hex, parent);
    };
    // head: hair, ears, brows, mouth, stubble
    const hair = MeshBuilder.CreateSphere("hair", { diameter: 0.268, segments: 12, slice: 0.58 }, sc);
    hair.position.set(0, 1.645, -0.012); hair.scaling.set(0.92, 1, 1.02); add(hair, "#3b2a1c");
    box(0.24, 0.07, 0.05, 0, 1.6, -0.1, "#3b2a1c");                       // hair down the back of the neck
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
    box(0.125, 0.04, 0.012, 0, 1.635, 0.122, "#9fd3e8", undefined, true);
    for (const sx of [-1, 1]) box(0.012, 0.012, 0.11, sx * 0.0625, 1.64, 0.07, "#15171a", undefined, true);
    box(0.014, 0.012, 0.014, 0, 1.64, 0.126, "#15171a", undefined, true);
  }
  setShadow(gen: { addShadowCaster(m: Mesh): void }) { this.meshes.forEach((x) => gen.addShadowCaster(x)); }
  animate(dt: number, speed: number) {
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
