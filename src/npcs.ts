import { Scene, MeshBuilder, StandardMaterial, Color3, TransformNode, Mesh, Vector3 } from "@babylonjs/core";

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
  legL: TransformNode; legR: TransformNode; armL: TransformNode; armR: TransformNode;
  meshes: Mesh[] = [];
  phase = Math.random() * 6;
  walking = false;
  constructor(public scene: Scene, o: HumanOpts) {
    this.root = new TransformNode("human", scene);
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
  setShadow(gen: { addShadowCaster(m: Mesh): void }) { this.meshes.forEach((x) => gen.addShadowCaster(x)); }
  animate(dt: number, speed: number) {
    if (speed > 0.15) {
      this.phase += dt * (4 + speed * 1.6);
      const s = Math.sin(this.phase) * Math.min(0.9, 0.3 + speed * 0.1);
      this.legL.rotation.x = s; this.legR.rotation.x = -s;
      this.armL.rotation.x = -s * 0.8; this.armR.rotation.x = s * 0.8;
    } else {
      this.phase += dt * 1.2;
      const s = Math.sin(this.phase) * 0.03;
      this.legL.rotation.x = 0; this.legR.rotation.x = 0;
      this.armL.rotation.x = s; this.armR.rotation.x = -s;
    }
  }
  pos(): Vector3 { return this.root.position; }
}
