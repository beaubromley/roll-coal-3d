import {
  Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, Quaternion,
  DynamicTexture, TransformNode, VertexBuffer,
} from "@babylonjs/core";

export interface AABB { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; /** a drivable surface: vehicles ride up it instead of being blocked */ ramp?: boolean }

export interface MatOpts { emissive?: string; alpha?: number; spec?: number; tex?: any; unlit?: boolean }

/**
 * Collects primitive meshes per material and merges them so the whole rig is a handful of draw calls.
 * Solid boxes also register AABB colliders for the first-person controller.
 */
export class Builder {
  colliders: AABB[] = [];
  /** room roofs, kept as separate meshes so the game can hide a roof while the player is inside that room */
  roofs: { mesh: Mesh; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }[] = [];
  merged: Mesh[] = [];
  private groups = new Map<string, Mesh[]>();
  private tiles = new Map<string, number>();
  /** world-space texture tile size (m) for a material: merged geometry gets box-projected UVs so texel density is uniform */
  setTile(key: string, metres: number) { this.tiles.set(key, metres); }
  private mats = new Map<string, StandardMaterial>();

  /** world offset applied to everything built inside at() */
  ox = 0; oz = 0;
  /** quarter-turn applied to everything built while set (0 or -PI/2): local (x, z) -> (-z, x) */
  rot = 0;
  private tx(x: number, z: number): [number, number] { return this.rot ? [-z, x] : [x, z]; }
  at(dx: number, dz: number, fn: () => void) { const a = this.ox, c = this.oz; this.ox += dx; this.oz += dz; try { fn(); } finally { this.ox = a; this.oz = c; } }

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
    cx += this.ox; cz += this.oz;
    [cx, cz] = this.tx(cx, cz);
    const mesh = MeshBuilder.CreateBox("b", { width: w, height: h, depth: d }, this.scene);
    mesh.position.set(cx, cy, cz);
    mesh.rotation.y = rotY + this.rot;
    this.push(m, mesh);
    if (solid && rotY === 0) {
      const hw = (this.rot ? d : w) / 2, hd = (this.rot ? w : d) / 2;
      this.colliders.push({ x0: cx - hw, x1: cx + hw, y0: cy - h / 2, y1: cy + h / 2, z0: cz - hd, z1: cz + hd });
    }
  }

  /** smooth sloped plank spanning z0 (at y0) to z1 (at y1), top surface on the line */
  ramp(m: string, cx: number, w: number, z0: number, y0: number, z1: number, y1: number, t = 0.1) {
    cx += this.ox; z0 += this.oz; z1 += this.oz;
    const rawZ = (z0 + z1) / 2, rawCx = cx;
    const dz = z1 - z0, dy = y1 - y0, len = Math.hypot(dz, dy);
    const mesh = MeshBuilder.CreateBox("ramp", { width: w, height: t, depth: len }, this.scene);
    const ang = Math.atan2(-dy, dz); // +z end lower when dy < 0
    mesh.rotation.x = ang;
    const rzp = rawZ + (t / 2) * Math.sin(ang);
    const [px, pz] = this.tx(rawCx, rzp);
    mesh.position.set(px, (y0 + y1) / 2 - (t / 2) * Math.cos(ang), pz); mesh.rotation.y = this.rot;
    this.push(m, mesh);
  }

  /** min/max based box */
  slab(m: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, solid = false) {
    this.box(m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, solid);
  }

  /** a walk- and drive-up slope: a run of low steps along z from (z0,y0) to (z1,y1), flagged so vehicles rise over it */
  rampSolid(cx: number, w: number, z0: number, y0: number, z1: number, y1: number, steps = 10) {
    for (let k = 0; k < steps; k++) {
      const za = z0 + ((z1 - z0) * k) / steps, zb = z0 + ((z1 - z0) * (k + 1)) / steps;
      const top = y0 + ((y1 - y0) * (Math.abs(y1 - y0) && (y1 > y0 ? k + 1 : k)) ) / steps;
      this.deck(cx - w / 2, Math.min(za, zb), cx + w / 2, Math.max(za, zb), top);
    }
  }
  /** a flat drivable top at height y over a footprint (min/max corners) */
  deck(x0: number, z0: number, x1: number, z1: number, y: number) {
    const [ax, az] = this.tx(x0 + this.ox, z0 + this.oz), [bx, bz] = this.tx(x1 + this.ox, z1 + this.oz);
    this.colliders.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: 0, y1: y, z0: Math.min(az, bz), z1: Math.max(az, bz), ramp: true });
  }

  /** invisible collider only */
  blocker(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const [ax, az] = this.tx(x0 + this.ox, z0 + this.oz), [bx, bz] = this.tx(x1 + this.ox, z1 + this.oz);
    this.colliders.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0, y1, z0: Math.min(az, bz), z1: Math.max(az, bz) });
  }

  cyl(m: string, cx: number, cy: number, cz: number, dia: number, h: number,
      o: { axis?: "x" | "y" | "z"; tess?: number; solid?: boolean; dia2?: number } = {}) {
    cx += this.ox; cz += this.oz;
    [cx, cz] = this.tx(cx, cz);
    const mesh = MeshBuilder.CreateCylinder("c", {
      diameterTop: o.dia2 ?? dia, diameterBottom: dia, height: h, tessellation: Math.max(o.tess ?? 10, dia > 0.5 ? 20 : 12),
    }, this.scene);
    mesh.position.set(cx, cy, cz);
    if (o.axis === "x") mesh.rotation.z = Math.PI / 2;
    if (o.axis === "z") mesh.rotation.x = Math.PI / 2;
    mesh.rotation.y = this.rot;
    this.push(m, mesh);
    if (o.solid) {
      const r = dia / 2;
      let hx = o.axis === "x" ? h / 2 : r; const hy = (!o.axis || o.axis === "y") ? h / 2 : r; let hz = o.axis === "z" ? h / 2 : r;
      if (this.rot) [hx, hz] = [hz, hx];
      this.colliders.push({ x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy, z0: cz - hz, z1: cz + hz });
    }
  }

  sphere(m: string, cx: number, cy: number, cz: number, dia: number, seg = 14) {
    cx += this.ox; cz += this.oz;
    [cx, cz] = this.tx(cx, cz);
    const mesh = MeshBuilder.CreateSphere("s", { diameter: dia, segments: seg }, this.scene);
    mesh.position.set(cx, cy, cz);
    this.push(m, mesh);
  }

  /** thin cylinder between two points */
  beam(m: string, a: Vector3, b: Vector3, t = 0.1, tess = 5) {
    if (this.ox || this.oz) { const o = new Vector3(this.ox, 0, this.oz); a = a.add(o); b = b.add(o); }
    if (this.rot) { a = new Vector3(-a.z, a.y, a.x); b = new Vector3(-b.z, b.y, b.x); }
    const dir = b.subtract(a);
    const len = dir.length();
    if (len < 1e-4) return;
    const mesh = MeshBuilder.CreateCylinder("beam", { diameter: t, height: len, tessellation: Math.max(tess, 8) }, this.scene);
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
         topY: number, width = 1.2, rise = 0.26, run = 0.3, botY = 0, under = false) {
    const n = Math.round((topY - botY) / rise);
    const dx = dir === "+x" ? 1 : dir === "-x" ? -1 : 0;
    const dz = dir === "+z" ? 1 : dir === "-z" ? -1 : 0;
    const alongX = dx !== 0;
    for (let k = 1; k <= n; k++) {
      const top = topY - k * rise;
      const cx = x + dx * (k - 0.5) * run, cz = z + dz * (k - 0.5) * run;
      const w = alongX ? run : width, d = alongX ? width : run;
      this.box(m, cx, top - 0.03, cz, w, 0.06, d);
      const y0 = under ? Math.max(0, top - 0.15) : 0;   // under = true: only the tread is solid, so you can walk beneath the flight
      this.blocker(cx - w / 2, y0, cz - d / 2, cx + w / 2, top, cz + d / 2);
      // handrails on both sides are solid, from the tread up past hip height
      for (const s of [-1, 1]) {
        const ox = alongX ? 0 : s * (width / 2 + 0.05), oz = alongX ? s * (width / 2 + 0.05) : 0;
        this.blocker(cx + ox - (alongX ? w / 2 : 0.06), y0, cz + oz - (alongX ? 0.06 : d / 2), cx + ox + (alongX ? w / 2 : 0.06), top + 1.7, cz + oz + (alongX ? 0.06 : d / 2));
      }
    }
    const ex = x + dx * n * run, ez = z + dz * n * run;
    const off = width / 2;
    const ox = alongX ? 0 : off, oz = alongX ? off : 0;
    for (const s of [-1, 1]) {
      this.beam(matSide, new Vector3(x + s * ox, topY - 0.1, z + s * oz), new Vector3(ex + s * ox, botY + 0.1, ez + s * oz), 0.1);
      this.beam(matSide, new Vector3(x + s * ox, topY + 1.0, z + s * oz), new Vector3(ex + s * ox, botY + 1.0, ez + s * oz), 0.05);
      // a vertical post at each end of the handrail, so it never floats
      const px0 = x + s * ox, pz0 = z + s * oz, px1 = ex + s * ox, pz1 = ez + s * oz;
      this.box(matSide, px0, topY + 0.45, pz0, 0.07, 1.1, 0.07); this.box(matSide, px1, botY + 0.55, pz1, 0.07, 1.1, 0.07);
    }
  }

  /**
   * Enterable room with a door gap. door side is the wall that holds the opening.
   */
  room(opts: {
    x0: number; z0: number; x1: number; z1: number; y0: number; h: number;
    wall: string; roof: string; floor: string; glass?: string;
    door: { side: "+x" | "-x" | "+z" | "-z"; c: number; w: number };
    /** glazed openings in a wall: centre c along the wall, width w, from height y0 to y1 above the floor */
    windows?: { side: "+x" | "-x" | "+z" | "-z"; c: number; w: number; y0: number; y1: number }[];
  }) {
    const { x0, z0, x1, z1, y0, h, wall, roof, floor, door } = opts;
    const T = 0.12;
    this.slab(floor, x0, y0 - 0.1, z0, x1, y0, z1, true);
    this.roofSlab(roof, x0 - 0.15, y0 + h, z0 - 0.15, x1 + 0.15, y0 + h + 0.12, z1 + 0.15, [x0, z0, x1, z1], y0);
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
      const wins = (opts.windows ?? []).filter((w) => w.side === side).sort((p, q) => p.c - q.c);
      // a run of solid wall from s to e, with any windows cut into it: strips under and over each one, and a pane of glass in the opening
      const emitRange = (s: number, e: number) => {
        let cur = s;
        for (const w of wins) {
          if (w.c - w.w / 2 < s - 1e-6 || w.c + w.w / 2 > e + 1e-6) continue;
          emit(cur, w.c - w.w / 2); cur = w.c + w.w / 2;
          const strip = (ya: number, yb: number, mat: string, th: number) => {
            if (alongZ) this.slab(mat, fixed - th / 2, y0 + ya, w.c - w.w / 2, fixed + th / 2, y0 + yb, w.c + w.w / 2);
            else this.slab(mat, w.c - w.w / 2, y0 + ya, fixed - th / 2, w.c + w.w / 2, y0 + yb, fixed + th / 2);
          };
          strip(0, w.y0, wall, T); strip(w.y1, h, wall, T); strip(w.y0, w.y1, "glass", T / 3);
          if (alongZ) this.blocker(fixed - T / 2, y0, w.c - w.w / 2, fixed + T / 2, y0 + h, w.c + w.w / 2); else this.blocker(w.c - w.w / 2, y0, fixed - T / 2, w.c + w.w / 2, y0 + h, fixed + T / 2);
        }
        emit(cur, e);
      };
      if (!hasDoor) emitRange(a, b);
      else {
        emitRange(a, door.c - door.w / 2);
        emitRange(door.c + door.w / 2, b);
        // lintel
        const ly0 = y0 + 2.1;
        if (alongZ) this.slab(wall, fixed - T / 2, ly0, door.c - door.w / 2, fixed + T / 2, y0 + h, door.c + door.w / 2);
        else this.slab(wall, door.c - door.w / 2, ly0, fixed - T / 2, door.c + door.w / 2, y0 + h, fixed + T / 2);
      }
    };
    (["+x", "-x", "+z", "-z"] as const).forEach(wallLine);
  }

  /** a roof slab as its own (unmerged) mesh, registered with the footprint of the room under it */
  private roofSlab(m: string, ax0: number, ay0: number, az0: number, ax1: number, ay1: number, az1: number, foot: number[], floorY: number) {
    const [wx, wz] = this.tx((ax0 + ax1) / 2 + this.ox, (az0 + az1) / 2 + this.oz);
    const w = ax1 - ax0, d = az1 - az0;
    const mesh = MeshBuilder.CreateBox("roof", { width: this.rot ? d : w, height: ay1 - ay0, depth: this.rot ? w : d }, this.scene);
    mesh.position.set(wx, (ay0 + ay1) / 2, wz); mesh.material = this.getMat(m); mesh.receiveShadows = true; mesh.isPickable = false;
    const [p1x, p1z] = this.tx(foot[0] + this.ox, foot[1] + this.oz), [p2x, p2z] = this.tx(foot[2] + this.ox, foot[3] + this.oz);
    this.roofs.push({ mesh, x0: Math.min(p1x, p2x), x1: Math.max(p1x, p2x), z0: Math.min(p1z, p2z), z1: Math.max(p1z, p2z), y0: floorY - 0.3, y1: ay1 + 0.6 });
  }

  label(text: string, x: number, y: number, z: number, w: number, h: number, rotY: number,
        bg = "#1b2a3a", fg = "#ffffff", fontPx = 56) {
    x += this.ox; z += this.oz;
    [x, z] = this.tx(x, z); rotY += this.rot;
    // 1024px-wide texture, 16x anisotropic: stays crisp at grazing angles instead of smearing out
    const TW = 1024, TH = Math.max(64, Math.round(TW * (h / w))), k = TW / 512;
    const tex = new DynamicTexture("lbl", { width: TW, height: TH }, this.scene, true);
    tex.anisotropicFilteringLevel = 16;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, TW, TH);
    { const gr = ctx.createLinearGradient(0, 0, 0, TH); gr.addColorStop(0, "rgba(255,255,255,0.16)"); gr.addColorStop(0.5, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(0,0,0,0.2)"); ctx.fillStyle = gr; ctx.fillRect(0, 0, TW, TH); }
    ctx.strokeStyle = fg; ctx.lineWidth = 12; ctx.strokeRect(10, 10, TW - 20, TH - 20);
    ctx.globalAlpha = 0.45; ctx.lineWidth = 3; ctx.strokeRect(26, 26, TW - 52, TH - 52); ctx.globalAlpha = 0.85;
    ctx.fillStyle = fg; for (const [rx, ry] of [[22, 22], [TW - 22, 22], [22, TH - 22], [TW - 22, TH - 22]]) { ctx.beginPath(); ctx.arc(rx, ry, 6, 0, 6.3); ctx.fill(); }
    ctx.globalAlpha = 1;
    const px = Math.round(fontPx * k * 1.12);
    ctx.fillStyle = fg; ctx.font = `bold ${px}px Arial, Helvetica, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lines = text.split("\n");
    // shrink to fit so long lines are never cut off at the sign edge
    const widest = Math.max(...lines.map((ln) => ctx.measureText(ln).width));
    const fit = Math.min(1, (TW - 70) / widest, (TH - 50) / (lines.length * px * 1.1));
    ctx.font = `bold ${Math.floor(px * fit)}px Arial, Helvetica, sans-serif`;
    const lh = Math.floor(px * fit) * 1.12;
    lines.forEach((ln, i) => ctx.fillText(ln, TW / 2, TH / 2 + (i - (lines.length - 1) / 2) * lh));
    tex.update();
    const mat = new StandardMaterial("lblm", this.scene);
    mat.diffuseTexture = tex; mat.emissiveTexture = tex; mat.specularColor = Color3.Black();
    mat.emissiveColor = new Color3(0.8, 0.8, 0.8);   // bright so it reads in shade and at night
    const root = new TransformNode("label", this.scene);
    root.position.set(x, y, z); root.rotation.y = rotY;
    // one plane per side so the text is readable (not mirrored) from either side
    const p = MeshBuilder.CreatePlane("label", { width: w, height: h }, this.scene);
    p.material = mat; p.parent = root; p.position.z = -0.012;
    const back = MeshBuilder.CreatePlane("labelB", { width: w, height: h }, this.scene);
    back.material = mat; back.parent = root; back.position.z = 0.012; back.rotation.y = Math.PI;
    return p;
  }

  /** a sign you paint yourself: draw(ctx, w, h) gets a canvas at the sign's aspect */
  art(draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, x: number, y: number, z: number, w: number, h: number, rotY: number) {
    x += this.ox; z += this.oz;
    [x, z] = this.tx(x, z); rotY += this.rot;
    const TW = 1024, TH = Math.max(64, Math.round(TW * (h / w)));
    const tex = new DynamicTexture("art", { width: TW, height: TH }, this.scene, true);
    tex.anisotropicFilteringLevel = 16;
    draw(tex.getContext() as CanvasRenderingContext2D, TW, TH); tex.update();
    const mat = new StandardMaterial("artm", this.scene);
    mat.diffuseTexture = tex; mat.emissiveTexture = tex; mat.specularColor = Color3.Black(); mat.emissiveColor = new Color3(0.8, 0.8, 0.8);
    const root = new TransformNode("art", this.scene); root.position.set(x, y, z); root.rotation.y = rotY;
    const p = MeshBuilder.CreatePlane("art", { width: w, height: h }, this.scene); p.material = mat; p.parent = root; p.position.z = -0.012;
    const back = MeshBuilder.CreatePlane("artB", { width: w, height: h }, this.scene); back.material = mat; back.parent = root; back.position.z = 0.012; back.rotation.y = Math.PI;
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
          const tile = this.tiles.get(key); if (tile) applyWorldUV(mm, tile);
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

/** Box-project UVs from world position + dominant normal axis (merged meshes have baked world-space vertices). */
export function applyWorldUV(mesh: Mesh, tile: number) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind), nor = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos || !nor) return;
  const n = pos.length / 3, uv = new Float32Array(n * 2), inv = 1 / tile;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const ax = Math.abs(nor[i * 3]), ay = Math.abs(nor[i * 3 + 1]), az = Math.abs(nor[i * 3 + 2]);
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u * inv; uv[i * 2 + 1] = v * inv;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uv, false);
}
