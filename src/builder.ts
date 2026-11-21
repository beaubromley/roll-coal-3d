import {
  Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, Quaternion,
  DynamicTexture, TransformNode,
} from "@babylonjs/core";

export interface AABB { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

export interface MatOpts { emissive?: string; alpha?: number; spec?: number; tex?: any; unlit?: boolean }

/**
 * Collects primitive meshes per material and merges them so the whole rig is a handful of draw calls.
 * Solid boxes also register AABB colliders for the first-person controller.
 */
export class Builder {
  colliders: AABB[] = [];
  merged: Mesh[] = [];
  private groups = new Map<string, Mesh[]>();
  private mats = new Map<string, StandardMaterial>();

  constructor(public scene: Scene) {}

  defMat(key: string, hex: string, o: MatOpts = {}): StandardMaterial {
    const m = new StandardMaterial("m_" + key, this.scene);
    m.diffuseColor = Color3.FromHexString(hex);
    const s = o.spec ?? 0.08;
    m.specularColor = new Color3(s, s, s);
    if (o.emissive) m.emissiveColor = Color3.FromHexString(o.emissive);
    if (o.alpha !== undefined) { m.alpha = o.alpha; m.backFaceCulling = false; }
    if (o.tex) m.diffuseTexture = o.tex;
    this.mats.set(key, m);
    return m;
  }

  getMat(key: string): StandardMaterial {
    const m = this.mats.get(key);
    if (!m) throw new Error("missing material " + key);
    return m;
  }

  private push(key: string, mesh: Mesh) {
    mesh.material = this.getMat(key);
    mesh.computeWorldMatrix(true);
    let g = this.groups.get(key);
    if (!g) { g = []; this.groups.set(key, g); }
    g.push(mesh);
  }

  /** center-based box */
  box(m: string, cx: number, cy: number, cz: number, w: number, h: number, d: number, solid = false, rotY = 0) {
    const mesh = MeshBuilder.CreateBox("b", { width: w, height: h, depth: d }, this.scene);
    mesh.position.set(cx, cy, cz);
    mesh.rotation.y = rotY;
    this.push(m, mesh);
    if (solid && rotY === 0) {
      this.colliders.push({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2, z0: cz - d / 2, z1: cz + d / 2 });
    }
  }

  /** min/max based box */
  slab(m: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, solid = false) {
    this.box(m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, solid);
  }

  /** invisible collider only */
  blocker(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.colliders.push({ x0, x1, y0, y1, z0, z1 });
  }

  cyl(m: string, cx: number, cy: number, cz: number, dia: number, h: number,
      o: { axis?: "x" | "y" | "z"; tess?: number; solid?: boolean; dia2?: number } = {}) {
    const mesh = MeshBuilder.CreateCylinder("c", {
      diameterTop: o.dia2 ?? dia, diameterBottom: dia, height: h, tessellation: o.tess ?? 10,
    }, this.scene);
    mesh.position.set(cx, cy, cz);
    if (o.axis === "x") mesh.rotation.z = Math.PI / 2;
    if (o.axis === "z") mesh.rotation.x = Math.PI / 2;
    this.push(m, mesh);
    if (o.solid) {
      const r = dia / 2;
      const hx = o.axis === "x" ? h / 2 : r, hy = (!o.axis || o.axis === "y") ? h / 2 : r, hz = o.axis === "z" ? h / 2 : r;
      this.colliders.push({ x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy, z0: cz - hz, z1: cz + hz });
    }
  }

  sphere(m: string, cx: number, cy: number, cz: number, dia: number, seg = 8) {
    const mesh = MeshBuilder.CreateSphere("s", { diameter: dia, segments: seg }, this.scene);
    mesh.position.set(cx, cy, cz);
    this.push(m, mesh);
  }

  /** thin cylinder between two points */
  beam(m: string, a: Vector3, b: Vector3, t = 0.1, tess = 5) {
    const dir = b.subtract(a);
    const len = dir.length();
    if (len < 1e-4) return;
    const mesh = MeshBuilder.CreateCylinder("beam", { diameter: t, height: len, tessellation: tess }, this.scene);
    mesh.position.copyFrom(a.add(b).scale(0.5));
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir.scale(1 / len), q);
    mesh.rotationQuaternion = q;
    this.push(m, mesh);
  }

  /** open-frame railing along an axis-aligned line, with a collider */
  rail(m: string, x0: number, z0: number, x1: number, z1: number, baseY: number, h = 1.1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 1.6));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      this.box(m, x, baseY + h / 2, z, 0.06, h, 0.06);
    }
    this.beam(m, new Vector3(x0, baseY + h, z0), new Vector3(x1, baseY + h, z1), 0.06);
    this.beam(m, new Vector3(x0, baseY + h * 0.5, z0), new Vector3(x1, baseY + h * 0.5, z1), 0.05);
    const pad = 0.1;
    this.blocker(Math.min(x0, x1) - pad, baseY, Math.min(z0, z1) - pad, Math.max(x0, x1) + pad, baseY + 1.7, Math.max(z0, z1) + pad);
  }

  /**
   * Grated staircase descending from (x,z) at topY to ground. dir = unit axis direction of descent.
   */
  stairs(m: string, matSide: string, x: number, z: number, dir: "+x" | "-x" | "+z" | "-z",
         topY: number, width = 1.2, rise = 0.26, run = 0.3) {
    const n = Math.round(topY / rise);
    const dx = dir === "+x" ? 1 : dir === "-x" ? -1 : 0;
    const dz = dir === "+z" ? 1 : dir === "-z" ? -1 : 0;
    const alongX = dx !== 0;
    for (let k = 1; k <= n; k++) {
      const top = topY - k * rise;
      const cx = x + dx * (k - 0.5) * run, cz = z + dz * (k - 0.5) * run;
      const w = alongX ? run : width, d = alongX ? width : run;
      this.box(m, cx, top - 0.03, cz, w, 0.06, d);
      this.blocker(cx - w / 2, 0, cz - d / 2, cx + w / 2, top, cz + d / 2);
    }
    const ex = x + dx * n * run, ez = z + dz * n * run;
    const off = width / 2;
    const ox = alongX ? 0 : off, oz = alongX ? off : 0;
    for (const s of [-1, 1]) {
      this.beam(matSide, new Vector3(x + s * ox, topY - 0.1, z + s * oz), new Vector3(ex + s * ox, 0.1, ez + s * oz), 0.1);
      this.beam(matSide, new Vector3(x + s * ox, topY + 1.0, z + s * oz), new Vector3(ex + s * ox, 1.0 + 0.0, ez + s * oz), 0.05);
    }
  }

  /**
   * Enterable room with a door gap. door side is the wall that holds the opening.
   */
  room(opts: {
    x0: number; z0: number; x1: number; z1: number; y0: number; h: number;
    wall: string; roof: string; floor: string; glass?: string;
    door: { side: "+x" | "-x" | "+z" | "-z"; c: number; w: number };
  }) {
    const { x0, z0, x1, z1, y0, h, wall, roof, floor, door } = opts;
    const T = 0.12;
    this.slab(floor, x0, y0 - 0.1, z0, x1, y0, z1, true);
    this.slab(roof, x0 - 0.15, y0 + h, z0 - 0.15, x1 + 0.15, y0 + h + 0.12, z1 + 0.15);
    const seg = (ax0: number, az0: number, ax1: number, az1: number) => {
      // wall segment between two points on an axis-aligned line
      const lowH = opts.glass ? 0.95 : h;
      this.slab(wall, Math.min(ax0, ax1) - (ax0 === ax1 ? T / 2 : 0), y0, Math.min(az0, az1) - (az0 === az1 ? T / 2 : 0),
        Math.max(ax0, ax1) + (ax0 === ax1 ? T / 2 : 0), y0 + lowH, Math.max(az0, az1) + (az0 === az1 ? T / 2 : 0));
      if (opts.glass) {
        this.slab(opts.glass, Math.min(ax0, ax1) - (ax0 === ax1 ? T / 3 : 0), y0 + lowH, Math.min(az0, az1) - (az0 === az1 ? T / 3 : 0),
          Math.max(ax0, ax1) + (ax0 === ax1 ? T / 3 : 0), y0 + h, Math.max(az0, az1) + (az0 === az1 ? T / 3 : 0));
      }
      this.blocker(Math.min(ax0, ax1) - T / 2, y0, Math.min(az0, az1) - T / 2, Math.max(ax0, ax1) + T / 2, y0 + h, Math.max(az0, az1) + T / 2);
    };
    const wallLine = (side: "+x" | "-x" | "+z" | "-z") => {
      const hasDoor = door.side === side;
      const alongZ = side === "+x" || side === "-x";
      const fixed = side === "+x" ? x1 : side === "-x" ? x0 : side === "+z" ? z1 : z0;
      const a = alongZ ? z0 : x0, b = alongZ ? z1 : x1;
      const emit = (s: number, e: number) => {
        if (e - s < 0.01) return;
        if (alongZ) seg(fixed, s, fixed, e); else seg(s, fixed, e, fixed);
      };
      if (!hasDoor) emit(a, b);
      else {
        emit(a, door.c - door.w / 2);
        emit(door.c + door.w / 2, b);
        // lintel
        const ly0 = y0 + 2.1;
        if (alongZ) this.slab(wall, fixed - T / 2, ly0, door.c - door.w / 2, fixed + T / 2, y0 + h, door.c + door.w / 2);
        else this.slab(wall, door.c - door.w / 2, ly0, fixed - T / 2, door.c + door.w / 2, y0 + h, fixed + T / 2);
      }
    };
    (["+x", "-x", "+z", "-z"] as const).forEach(wallLine);
  }

  label(text: string, x: number, y: number, z: number, w: number, h: number, rotY: number,
        bg = "#1b2a3a", fg = "#ffffff", fontPx = 56) {
    const tex = new DynamicTexture("lbl", { width: 512, height: Math.round(512 * (h / w)) }, this.scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = fg; ctx.lineWidth = 8; ctx.strokeRect(6, 6, 500, Math.round(512 * (h / w)) - 12);
    ctx.fillStyle = fg; ctx.font = `bold ${fontPx}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lines = text.split("\n");
    const ch = Math.round(512 * (h / w));
    lines.forEach((ln, i) => ctx.fillText(ln, 256, ch / 2 + (i - (lines.length - 1) / 2) * (fontPx + 6)));
    tex.update();
    const mat = new StandardMaterial("lblm", this.scene);
    mat.diffuseTexture = tex; mat.emissiveTexture = tex; mat.specularColor = Color3.Black();
    mat.emissiveColor = new Color3(0.55, 0.55, 0.55);
    const p = MeshBuilder.CreatePlane("label", { width: w, height: h }, this.scene);
    p.material = mat;
    p.position.set(x, y, z);
    p.rotation.y = rotY;
    return p;
  }

  finish(): Mesh[] {
    for (const [key, list] of this.groups) {
      // chunk to keep index buffers sane
      const CH = 1500;
      for (let i = 0; i < list.length; i += CH) {
        const part = list.slice(i, i + CH);
        const mm = Mesh.MergeMeshes(part, true, true, undefined, false, false);
        if (mm) {
          mm.material = this.getMat(key);
          mm.receiveShadows = true;
          mm.freezeWorldMatrix();
          this.merged.push(mm);
        }
      }
    }
    this.groups.clear();
    return this.merged;
  }
}

/** Push a circle (radius R) at p out of any solid collider it overlaps — used by NPCs, deer, interns. */
export function pushOutXZ(colliders: AABB[], p: { x: number; z: number }, feet: number, R = 0.35, step = 0.5, head = 1.75): boolean {
  let hit = false;
  for (let it = 0; it < 3; it++) {
    for (const c of colliders) {
      if (c.y1 <= feet + step || c.y0 >= feet + head) continue;
      const cx = Math.max(c.x0, Math.min(p.x, c.x1)), cz = Math.max(c.z0, Math.min(p.z, c.z1));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      hit = true;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), push = R - d; p.x += (dx / d) * push; p.z += (dz / d) * push; }
      else {
        const px = Math.min(p.x - c.x0, c.x1 - p.x), pz = Math.min(p.z - c.z0, c.z1 - p.z);
        if (px < pz) p.x += p.x - c.x0 < c.x1 - p.x ? -(px + R) : px + R; else p.z += p.z - c.z0 < c.z1 - p.z ? -(pz + R) : pz + R;
      }
    }
  }
  return hit;
}

export function node(name: string, scene: Scene, x = 0, y = 0, z = 0) {
  const n = new TransformNode(name, scene);
  n.position.set(x, y, z);
  return n;
}
