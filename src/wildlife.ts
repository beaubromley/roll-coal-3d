import { Scene, MeshBuilder, StandardMaterial, Color3, TransformNode, Vector3, Mesh } from "@babylonjs/core";
import type { Game } from "./game";

/**
 * The critters out past the fence: deer that bolt, bears that charge if you bother them, snakes that rattle and bite, and birds wheeling overhead.
 * They are what the shotgun is for (it will not fire at people).
 */
export type Species = "deer" | "bear" | "snake" | "bird";
export const SPECIES_NAME: Record<Species, string> = { deer: "Whitetail Buck", bear: "Black Bear", snake: "Rattlesnake", bird: "Turkey Vulture" };

interface Animal {
  kind: Species; n: TransformNode; x: number; z: number; y: number; h: number; sp: number; t: number; hp: number; down: number; r: number;
  state: "roam" | "flee" | "charge" | "retreat" | "dead"; cx: number; cz: number; ph: number; segs?: Mesh[]; wings?: Mesh[]; alt?: number; rad?: number; cool: number;
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Wildlife {
  animals: Animal[] = [];
  private mats = new Map<string, StandardMaterial>();
  private t = 0;

  constructor(private g: Game, private scene: Scene, private terrain: (x: number, z: number) => number, private onKill: (k: Species) => void) {
    // deer: small bands through the hills and the pasture edge
    for (const [x, z] of [[140, -60], [170, -20], [215, -100], [260, 40], [130, 180], [250, 150], [180, 300], [90, 340]] as [number, number][]) this.deer(x, z);
    for (const [x, z] of [[235, 10], [262, 232]] as [number, number][]) this.bear(x, z);
    for (let i = 0; i < 14; i++) { const near = i < 5; this.snake(near ? -93 + rnd(-45, 45) : rnd(100, 320), near ? 262 + rnd(-40, 40) : rnd(-120, 330)); }
    for (const [x, z, n] of [[150, -60, 4], [215, 150, 4], [-175, 165, 4], [-93, 262, 3]] as [number, number, number][]) for (let i = 0; i < n; i++) this.bird(x, z);
  }

  private mat(hex: string) { let m = this.mats.get(hex); if (!m) { m = new StandardMaterial("wl" + hex, this.scene); m.diffuseColor = Color3.FromHexString(hex); m.specularColor = Color3.Black(); this.mats.set(hex, m); } return m; }
  private box(p: TransformNode, hex: string, w: number, h: number, d: number, x: number, y: number, z: number) { const b = MeshBuilder.CreateBox("wl", { width: w, height: h, depth: d }, this.scene); b.material = this.mat(hex); b.parent = p; b.position.set(x, y, z); b.isPickable = false; return b; }
  private base(kind: Species, x: number, z: number, r: number, hp: number): Animal {
    const n = new TransformNode(kind, this.scene); const a: Animal = { kind, n, x, z, y: 0, h: rnd(0, 6.28), sp: 0, t: rnd(0, 4), hp, down: 0, r, state: "roam", cx: x, cz: z, ph: rnd(0, 6.28), cool: 0 };
    this.animals.push(a); return a;
  }
  private deer(x: number, z: number) {
    for (let i = 0; i < 2; i++) {
      const a = this.base("deer", x + rnd(-6, 6), z + rnd(-6, 6), 1.0, 1), n = a.n, c = "#8a6a45", pale = "#cdb48a";
      this.box(n, c, 0.55, 0.5, 1.15, 0, 0.95, 0); this.box(n, pale, 0.45, 0.2, 0.9, 0, 0.74, 0.02);
      this.box(n, c, 0.2, 0.5, 0.22, 0, 1.3, 0.58).rotation.x = -0.4; this.box(n, c, 0.22, 0.22, 0.4, 0, 1.58, 0.82); this.box(n, pale, 0.12, 0.1, 0.06, 0, 1.55, 1.05);
      for (const sx of [-1, 1]) for (const sz of [-0.42, 0.42]) this.box(n, "#6a4e32", 0.1, 0.72, 0.1, sx * 0.17, 0.36, sz);
      this.box(n, pale, 0.14, 0.2, 0.08, 0, 1.0, -0.62);
      if (i === 0) for (const sx of [-1, 1]) { const ant = this.box(n, "#e0d2b0", 0.04, 0.5, 0.04, sx * 0.1, 1.9, 0.78); ant.rotation.z = -sx * 0.35; this.box(n, "#e0d2b0", 0.04, 0.3, 0.04, sx * 0.2, 1.92, 0.7).rotation.z = -sx * 0.9; }
    }
  }
  private bear(x: number, z: number) {
    const a = this.base("bear", x, z, 1.5, 2), n = a.n;
    this.box(n, "#2e231b", 1.0, 0.95, 1.6, 0, 1.0, 0); this.box(n, "#2e231b", 0.8, 0.5, 0.7, 0, 1.55, 0.35); this.box(n, "#3a2c22", 0.55, 0.5, 0.55, 0, 1.3, 0.98); this.box(n, "#7a6a5a", 0.28, 0.2, 0.3, 0, 1.2, 1.33);
    for (const sx of [-1, 1]) { this.box(n, "#2e231b", 0.12, 0.12, 0.1, sx * 0.2, 1.6, 0.85); for (const sz of [-0.55, 0.6]) this.box(n, "#241b14", 0.3, 0.62, 0.3, sx * 0.32, 0.31, sz); }
    n.scaling.setAll(1.15);
  }
  private snake(x: number, z: number) {
    const a = this.base("snake", x, z, 0.5, 1); a.segs = [];
    for (let i = 0; i < 10; i++) { const s = MeshBuilder.CreateSphere("wl", { diameter: i === 0 ? 0.2 : 0.16 - i * 0.008, segments: 5 }, this.scene); s.material = this.mat(i % 2 ? "#6a5a38" : "#8a7648"); s.parent = a.n; s.isPickable = false; a.segs.push(s); }
  }
  private bird(cx: number, cz: number) {
    const a = this.base("bird", cx, cz, 0.8, 1); a.alt = rnd(16, 34); a.rad = rnd(16, 40); a.cx = cx + rnd(-20, 20); a.cz = cz + rnd(-20, 20); a.wings = [];
    this.box(a.n, "#2a2420", 0.2, 0.14, 0.42, 0, 0, 0); this.box(a.n, "#b04a40", 0.1, 0.1, 0.14, 0, 0.02, 0.28);
    for (const s of [-1, 1]) { const w = this.box(a.n, "#2a2420", 0.7, 0.03, 0.3, s * 0.4, 0.03, 0); a.wings.push(w); }
  }

  // ------------------------------------------------------------------------------------------ shooting
  /** a shot from `o` along the unit vector `d`: returns the animal hit (nearest first) */
  shoot(o: Vector3, d: Vector3): Species | null {
    let best: Animal | null = null, bt = 140;
    for (const a of this.animals) {
      if (a.state === "dead") continue;
      const c = new Vector3(a.x, a.y + (a.kind === "bird" ? 0 : a.kind === "snake" ? 0.1 : a.kind === "bear" ? 1.2 : 1.1), a.z), v = c.subtract(o), t = Vector3.Dot(v, d);
      if (t < 1 || t > bt) continue;
      const perp = Math.sqrt(Math.max(0, v.lengthSquared() - t * t));
      if (perp < a.r + 0.04 * t) { best = a; bt = t; }
    }
    if (!best) return null;
    best.hp--;
    if (best.hp <= 0) { this.kill(best); return best.kind; }
    if (best.kind === "bear") { best.state = "charge"; best.t = 14; }   // wounded and angry
    return null;
  }
  private kill(a: Animal) { a.state = "dead"; a.down = 80; this.onKill(a.kind); }

  // ------------------------------------------------------------------------------------------ per frame
  update(dt: number) {
    this.t += dt;
    const g = this.g, p = g.player, px = p.pos.x, pz = p.pos.z, riding = g.veh.riding;
    for (const a of this.animals) {
      const dx = px - a.x, dz = pz - a.z, d = Math.hypot(dx, dz);
      if (d > 260 && a.state !== "dead") { a.n.setEnabled(false); continue; }
      a.n.setEnabled(true); a.cool -= dt;
      if (a.state === "dead") {
        a.n.rotation.z = a.kind === "bird" ? 0 : 1.5; a.y = this.terrain(a.x, a.z) + (a.kind === "bird" ? 0.1 : a.kind === "snake" ? 0.04 : 0.45);
        a.n.position.set(a.x, a.y, a.z); a.down -= dt;
        if (a.down <= 0) { a.state = "roam"; a.hp = a.kind === "bear" ? 2 : 1; a.n.rotation.z = 0; a.x = a.cx + rnd(-20, 20); a.z = a.cz + rnd(-20, 20); }
        continue;
      }
      a.t -= dt;
      if (a.kind === "bird") {
        a.ph += dt * (0.25 + 8 / (a.rad ?? 20));
        a.x = a.cx + Math.cos(a.ph) * (a.rad ?? 20); a.z = a.cz + Math.sin(a.ph) * (a.rad ?? 20); a.y = this.terrain(a.x, a.z) + (a.alt ?? 25) + Math.sin(this.t * 0.7 + a.ph) * 1.5;
        a.n.position.set(a.x, a.y, a.z); a.n.rotation.y = -a.ph; a.n.rotation.z = 0.15;
        const flap = Math.sin(this.t * 2.2 + a.ph * 3) * 0.35; a.wings?.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * flap; });
        continue;
      }
      let speed = 0, tgt = a.h;
      if (a.kind === "deer") {
        const threat = d < (riding ? 70 : 42);
        if (threat) { a.state = "flee"; a.t = 3; }
        if (a.state === "flee") { tgt = Math.atan2(-dx, -dz) + Math.sin(this.t + a.ph) * 0.4; speed = 10; if (!threat && a.t <= 0) a.state = "roam"; }
        else { if (a.t <= 0) { a.t = rnd(2, 7); a.sp = Math.random() < 0.6 ? 0 : rnd(0.6, 1.2); a.h += rnd(-1.5, 1.5); } speed = a.sp; tgt = a.h; }
      } else if (a.kind === "bear") {
        if (a.state === "roam") { if (!riding && d < 16) { a.state = "charge"; a.t = 10; } else { if (a.t <= 0) { a.t = rnd(3, 8); a.sp = Math.random() < 0.5 ? 0 : 0.8; a.h += rnd(-1.5, 1.5); } speed = a.sp; tgt = a.h; } }
        else if (a.state === "charge") {
          tgt = Math.atan2(dx, dz); speed = 6.6; a.t -= 0;
          if (riding || a.t <= 0) { a.state = "retreat"; a.t = 12; }
          if (d < 2.3 && a.cool <= 0) {
            a.cool = 6; a.state = "retreat"; a.t = 18;
            const ux = dx / (d || 1), uz = dz / (d || 1); p.teleport(px + ux * 5, this.terrain(px + ux * 5, pz + uz * 5) + 0.3, pz + uz * 5, Math.atan2(-ux, -uz));
            g.inc(1, "BEAR ATTACK"); g.gain(0, -6); g.sfx.thud(); g.ui.toast("THE BEAR SWATS YOU", "It was more of a warning. A very firm one.");
          }
        } else if (a.state === "retreat") { tgt = Math.atan2(-dx, -dz); speed = 4; if (a.t <= 0) a.state = "roam"; }
      } else if (a.kind === "snake") {
        if (a.t <= 0) { a.t = rnd(2, 6); a.sp = Math.random() < 0.5 ? 0 : rnd(0.3, 0.8); a.h += rnd(-1.4, 1.4); }
        speed = a.sp; tgt = a.h;
        if (!riding && d < 5.5 && a.cool <= 0) { a.cool = 12; g.ui.toast("RATTLE", "Something nearby does not want you here."); }
        if (!riding && d < 1.3 && p.pos.y < this.terrain(a.x, a.z) + 0.6 && a.cool <= 8) { a.cool = 14; g.gain(0, -2); g.sfx.bad(); g.ui.toast("SNAKEBITE", "Not a good one. It looked embarrassed too."); }
      }
      // turn and move; stay off the pad, the road, and out of the water
      let da = tgt - a.h; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; a.h += da * Math.min(1, dt * (a.state === "roam" ? 2 : 6));
      const nx = a.x + Math.sin(a.h) * speed * dt, nz = a.z + Math.cos(a.h) * speed * dt, th = this.terrain(nx, nz);
      if (th < -0.3 || (Math.abs(nx) < 64 && nz > -70 && nz < 70) || (Math.abs(nx) < 6 && nz > 40) || Math.hypot(nx, nz) > 560 || th - a.y > 1.2) { a.h += Math.PI * 0.7; }
      else { a.x = nx; a.z = nz; }
      a.y = this.terrain(a.x, a.z);
      a.n.position.set(a.x, a.y, a.z); a.n.rotation.y = a.h;
      if (a.kind === "snake" && a.segs) a.segs.forEach((s, i) => { const k = i * 0.16; s.position.set(Math.sin(this.t * 3 + i * 0.8) * 0.12 * (0.4 + i * 0.1), 0.07, -k * 1.2); });
    }
  }
}
