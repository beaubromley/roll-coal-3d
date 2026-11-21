import { Scene, MeshBuilder, StandardMaterial, Color3, TransformNode, Mesh, Vector3 } from "@babylonjs/core";
import type { Kit } from "./models";

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
}

export class Human {
  root: TransformNode;
  legL!: TransformNode; legR!: TransformNode; armL!: TransformNode; armR!: TransformNode;
  /** set by main once the Blender kit has loaded; Humans built afterwards use the jointed model */
  static kit: Kit | null = null;
  kneeL: TransformNode | null = null; kneeR: TransformNode | null = null; elbowL: TransformNode | null = null; elbowR: TransformNode | null = null;
  meshes: Mesh[] = [];
  phase = Math.random() * 6;
  walking = false;
  constructor(public scene: Scene, o: HumanOpts) {
    this.root = new TransformNode("human", scene);
    if (Human.kit) { this.fromKit(Human.kit, o); return; }
    const mk = (mesh: Mesh, hex: string, parent: TransformNode) => {
      mesh.material = m(scene, hex); mesh.parent = parent; this.meshes.push(mesh); return mesh;
    };
    const torso = MeshBuilder.CreateBox("t", { width: 0.5, height: 0.66, depth: 0.28 }, scene);
    torso.position.y = 1.12; mk(torso, o.shirt, this.root);
    if (o.vest) {
      const v = MeshBuilder.CreateBox("v", { width: 0.52, height: 0.5, depth: 0.3 }, scene);
      v.position.y = 1.15; mk(v, "#e8f542", this.root);
      const st = MeshBuilder.CreateBox("vs", { width: 0.53, height: 0.07, depth: 0.31 }, scene);
      st.position.y = 1.12; mk(st, "#cfd3d6", this.root);
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
      hat.position.y = 1.68; mk(hat, o.hat, this.root);
      const brim = MeshBuilder.CreateCylinder("brim", { diameter: 0.38, height: 0.025, tessellation: 20 }, scene);
      brim.position.y = 1.68; mk(brim, o.hat, this.root);
      const bill = MeshBuilder.CreateBox("bill", { width: 0.2, height: 0.02, depth: 0.1 }, scene);
      bill.position.set(0, 1.675, 0.2); mk(bill, o.hat, this.root);
      const ridge = MeshBuilder.CreateBox("rdg", { width: 0.035, height: 0.025, depth: 0.28 }, scene);
      ridge.position.set(0, 1.84, 0); mk(ridge, o.hat, this.root);
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
    this.root.scaling.setAll(o.scale ?? 1);
  }
  /** Jointed Blender model: hips, KNEES, ankles, shoulders, ELBOWS, wrists are real pivots. */
  private fromKit(kit: Kit, o: HumanOpts) {
    const sc = this.scene, root = this.root;
    const colors: Record<string, string> = {
      shirt: o.shirt, pants: o.pants, hat: o.hat ?? "#f4f4f4", skin: o.skin ?? "#d9a77f", vest: "#e8f542", stripe: "#cfd3d6",
      glove: "#2b2118", boot: "#2a1d12", belt: "#1e1a16", dark: "#101012", steel: "#9aa0a8",
    };
    const piv = (name: string, parent: TransformNode, x: number, y: number, z = 0) => { const n = new TransformNode(name, sc); n.parent = parent; n.position.set(x, y, z); return n; };
    const put = (part: string, parent: TransformNode, flip = false) => {
      const tpl = kit.templates.get(part); if (!tpl) return;
      const mat = part.slice(part.lastIndexOf("_") + 1);
      const c = tpl.clone(part + "_h", parent) as Mesh;
      c.setEnabled(true); c.isPickable = false; c.material = m(sc, colors[mat] ?? "#808080"); c.receiveShadows = true;
      if (flip) c.scaling.x = -1;
      this.meshes.push(c);
    };
    for (const p of ["torso_shirt", "pelvis_pants", "belt_belt", "buckle_dark", "neck_skin", "head_skin", "nose_skin", "eyes_dark"]) put(p, root);
    if (o.vest) { put("vest_vest", root); put("stripe_stripe", root); }
    if (o.hat) put("hat_hat", root);
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
    this.root.scaling.setAll(o.scale ?? 1);
  }
  setShadow(gen: { addShadowCaster(m: Mesh): void }) { this.meshes.forEach((x) => gen.addShadowCaster(x)); }
  animate(dt: number, speed: number) {
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
