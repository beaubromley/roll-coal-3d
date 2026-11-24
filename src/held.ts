import { Scene, MeshBuilder, StandardMaterial, Color3, TransformNode, Mesh, DynamicTexture } from "@babylonjs/core";
import type { Player } from "./player";

/**
 * Things the Company Man carries: a phone, a tally book and a 4-gas monitor.
 * Chunky, flat-shaded and a little too bright, like props out of GTA III. Q cycles through them.
 * In first person they ride on the camera (drawn over the world); in third person they sit in the right hand.
 */
export type HeldKind = "none" | "phone" | "tally" | "gas";
const ORDER: HeldKind[] = ["none", "phone", "tally", "gas"];
const NAMES: Record<HeldKind, string> = { none: "HANDS FREE", phone: "CELL PHONE", tally: "TALLY BOOK", gas: "4-GAS MONITOR" };

export interface HeldWorld { kicking(): boolean; ringing(): boolean; clock(): string; depth(): number }

export class Held {
  kind: HeldKind = "none";
  private fp: Partial<Record<HeldKind, TransformNode>> = {};
  private tp: Partial<Record<HeldKind, TransformNode>> = {};
  private tex: { phone: DynamicTexture; tally: DynamicTexture; gas: DynamicTexture };
  private t = 0; private lastDraw = 0;

  constructor(private scene: Scene, private player: Player, private w: HeldWorld) {
    scene.setRenderingAutoClearDepthStencil(1, true, true, true);   // the first-person group is always drawn on top of the world
    const mk = () => new DynamicTexture("heldtex", { width: 128, height: 128 }, scene, false);
    this.tex = { phone: mk(), tally: mk(), gas: mk() };
    for (const k of ["phone", "tally", "gas"] as const) { this.fp[k] = this.build(k, true); this.tp[k] = this.build(k, false); }
    this.apply();
  }

  cycle() {
    this.kind = ORDER[(ORDER.indexOf(this.kind) + 1) % ORDER.length];
    this.apply();
    return NAMES[this.kind];
  }

  private mat(hex: string, emissive = 0) {
    const m = new StandardMaterial("held" + hex, this.scene);
    const c = Color3.FromHexString(hex); m.diffuseColor = c; m.specularColor = new Color3(0, 0, 0); m.emissiveColor = c.scale(emissive);
    return m;
  }
  private box(parent: TransformNode, hex: string, w: number, h: number, d: number, x: number, y: number, z: number, fpv: boolean, emissive = 0.25) {
    const b = MeshBuilder.CreateBox("held", { width: w, height: h, depth: d }, this.scene);
    b.material = this.mat(hex, emissive); b.position.set(x, y, z); b.parent = parent; b.isPickable = false;
    if (fpv) b.renderingGroupId = 1;
    return b;
  }
  private screen(parent: TransformNode, tex: DynamicTexture, w: number, h: number, x: number, y: number, z: number, fpv: boolean) {
    const s = MeshBuilder.CreatePlane("heldscr", { width: w, height: h }, this.scene);
    const m = new StandardMaterial("heldscr", this.scene); m.diffuseTexture = tex; m.emissiveTexture = tex; m.specularColor = new Color3(0, 0, 0); m.disableLighting = true;
    s.material = m; s.position.set(x, y, z); s.parent = parent; s.isPickable = false;
    if (fpv) s.renderingGroupId = 1;
    return s;
  }

  /** first person: parented to the camera, offset low and to the right. third person: parented to the right elbow so it sits in the hand. */
  private build(kind: "phone" | "tally" | "gas", fpv: boolean): TransformNode {
    const root = new TransformNode("held_" + kind, this.scene);
    if (fpv) {
      root.parent = this.player.cam;
      root.position.set(0.17, -0.15, 0.4); root.rotation.set(-0.45, -0.3, 0.05); root.scaling.setAll(0.62);
    } else {
      root.parent = this.player.body.elbowR;
      root.position.set(0, -0.31, 0.07); root.rotation.set(-1.25, 0, 0); root.scaling.setAll(1.0);
    }
    const f = fpv;
    if (kind === "phone") {
      this.box(root, "#1c2430", 0.075, 0.15, 0.014, 0, 0, 0, f, 0.1);            // slab
      this.box(root, "#0c1118", 0.082, 0.157, 0.008, 0, 0, 0.004, f, 0.05);      // bumper
      this.screen(root, this.tex.phone, 0.065, 0.125, 0, 0.002, -0.0085, f);
      this.box(root, "#d8dde3", 0.014, 0.014, 0.004, 0, -0.068, -0.0085, f, 0.5);  // home dot
    } else if (kind === "tally") {
      this.box(root, "#e8a21c", 0.115, 0.15, 0.022, 0, 0, 0, f, 0.35);           // cover
      this.box(root, "#f4efe1", 0.105, 0.14, 0.016, 0.004, 0, 0.001, f, 0.45);   // pages
      this.box(root, "#1a1a1a", 0.014, 0.15, 0.026, -0.052, 0, 0, f, 0.1);       // spine
      this.screen(root, this.tex.tally, 0.095, 0.125, 0.005, 0, -0.0095, f);
      this.box(root, "#2a3e8c", 0.007, 0.12, 0.007, 0.062, 0.01, -0.012, f, 0.4); // a pen clipped on
    } else {
      this.box(root, "#f1c40f", 0.09, 0.15, 0.05, 0, 0, 0, f, 0.4);              // body
      this.box(root, "#1b1b1b", 0.1, 0.045, 0.058, 0, -0.058, 0, f, 0.1);        // rubber boot
      this.box(root, "#1b1b1b", 0.1, 0.03, 0.058, 0, 0.074, 0, f, 0.1);          // top bumper
      this.screen(root, this.tex.gas, 0.07, 0.07, 0, 0.012, -0.0255, f);
      this.box(root, "#d63a2c", 0.018, 0.018, 0.012, 0.03, 0.058, -0.02, f, 0.9); // alarm lamp (the lid blinks it)
      this.box(root, "#c9ccd1", 0.012, 0.012, 0.006, -0.02, -0.052, -0.026, f, 0.3);
      this.box(root, "#c9ccd1", 0.012, 0.012, 0.006, 0.02, -0.052, -0.026, f, 0.3);
    }
    for (const m of root.getChildMeshes()) if (m instanceof Mesh && m.name === "held") m.convertToFlatShadedMesh();
    root.setEnabled(false);
    return root;
  }

  private apply() {
    const first = !this.player.third;
    for (const k of ["phone", "tally", "gas"] as const) {
      this.fp[k]!.setEnabled(this.kind === k && first);
      this.tp[k]!.setEnabled(this.kind === k && !first);
    }
  }

  /** redraw the little screens a few times a second, and keep the right set showing for the camera mode */
  update(dt: number, visible: boolean) {
    this.t += dt;
    const first = !this.player.third;
    for (const k of ["phone", "tally", "gas"] as const) {
      this.fp[k]!.setEnabled(visible && this.kind === k && first);
      this.tp[k]!.setEnabled(visible && this.kind === k && !first);
    }
    if (!visible || this.kind === "none" || this.t - this.lastDraw < 0.2) return;
    this.lastDraw = this.t;
    const flash = Math.floor(this.t * 3) % 2 === 0;
    if (this.kind === "phone") {
      const c = this.tex.phone.getContext() as CanvasRenderingContext2D, W = 128;
      const ring = this.w.ringing();
      c.fillStyle = ring ? (flash ? "#1d7a3b" : "#0f4a24") : "#0b1d33"; c.fillRect(0, 0, W, W);
      c.fillStyle = "#ffffff"; c.textAlign = "center"; c.font = "bold 30px Arial"; c.fillText(this.w.clock(), W / 2, 40);
      c.font = "bold 13px Arial"; c.fillStyle = ring ? "#ffffff" : "#8fb4d8";
      c.fillText(ring ? "THE WHITE HOUSE" : "NO SERVICE", W / 2, 70); c.fillText(ring ? "INCOMING CALL" : "1 BAR (MAYBE)", W / 2, 90);
      if (ring) { c.fillStyle = "#e5483b"; c.fillRect(24, 100, 34, 18); c.fillStyle = "#3dbb6a"; c.fillRect(70, 100, 34, 18); }
      this.tex.phone.update();
    } else if (this.kind === "tally") {
      const c = this.tex.tally.getContext() as CanvasRenderingContext2D, W = 128;
      c.fillStyle = "#f4efe1"; c.fillRect(0, 0, W, W);
      c.strokeStyle = "#7aa6d6"; c.lineWidth = 1; for (let y = 22; y < W; y += 12) { c.beginPath(); c.moveTo(4, y); c.lineTo(W - 4, y); c.stroke(); }
      c.fillStyle = "#2a2a2a"; c.font = "bold 12px monospace"; c.textAlign = "left"; c.fillText("PIPE TALLY", 6, 14);
      c.font = "11px monospace"; const d = Math.round(this.w.depth());
      ["#1  40.12", "#2  39.87", "#3  40.31", "#4  41.02", "#5  39.95", "#6  40.20", "#7  ...", "TD  " + d + " ft"].forEach((l, i) => c.fillText(l, 8, 34 + i * 12));
      this.tex.tally.update();
    } else {
      const c = this.tex.gas.getContext() as CanvasRenderingContext2D, W = 128;
      const bad = this.w.kicking();
      c.fillStyle = "#101a10"; c.fillRect(0, 0, W, W);
      c.fillStyle = bad ? (flash ? "#ff5a3d" : "#9a2c1c") : "#7dff7d"; c.font = "bold 20px monospace"; c.textAlign = "left";
      const rows: [string, string][] = [["O2", bad ? "19.1" : "20.9"], ["LEL", bad ? "12" : "0"], ["H2S", bad ? "11" : "0"], ["CO", bad ? "27" : "0"]];
      rows.forEach(([n, v], i) => { c.fillText(n, 6, 28 + i * 30); c.textAlign = "right"; c.fillText(v, W - 6, 28 + i * 30); c.textAlign = "left"; });
      if (bad) { c.fillStyle = flash ? "#ff5a3d" : "#101a10"; c.fillRect(0, 0, W, 6); }
      this.tex.gas.update();
    }
  }
}
