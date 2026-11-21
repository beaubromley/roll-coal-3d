import { Scene, FreeCamera, Vector3 } from "@babylonjs/core";
import type { AABB } from "./builder";
import { Human } from "./npcs";

const R = 0.35, EYE = 1.62, STEP = 0.5, HEAD = 1.75, G = 20;

export class Player {
  pos = new Vector3(0, 0, 100);
  vel = new Vector3();
  yaw = Math.PI; // facing -z (toward the rig)
  pitch = 0.15;
  grounded = true;
  third = true;
  cam: FreeCamera;
  body: Human;
  keys = new Set<string>();
  locked = false;
  touch = false;                       // touch device: no pointer lock, on-screen controls
  touchMove = { x: 0, y: 0 };          // analog joystick, x = strafe right, y = forward
  onLockLost: () => void = () => {};   // pointer lock dropped without us asking (browser Esc)
  private intentionalUnlock = false;
  dragging = false;
  private lx = 0; private ly = 0;
  lockFailed = false;
  onLockFailed: () => void = () => {};
  enabled = true;
  /** true while a vehicle (or the driller chair) owns position and camera */
  ride = false;
  gScale = 1;
  private camY: number | null = null;
  moved = 0;
  private fallStart = 0;
  onFall: (m: number) => void = () => {};
  onJump: () => void = () => {};
  stepAcc = 0;
  onStep: () => void = () => {};

  constructor(private scene: Scene, private canvas: HTMLCanvasElement, public colliders: AABB[]) {
    this.cam = new FreeCamera("cam", new Vector3(0, 2, 100), scene);
    this.cam.minZ = 0.08; this.cam.maxZ = 1800; this.cam.fov = 0.95;
    this.cam.inputs.clear();
    scene.activeCamera = this.cam;
    this.body = new Human(scene, { shirt: "#2f5f8f", pants: "#8a7a5a", hat: "#f4f4f4", skin: "#e0b48f", vest: true, detail: true });
    this.body.setPPE(false);   // hard hat, vest and glasses come from the gate shack after sign-in
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "KeyV" && !e.repeat && this.enabled) this.third = !this.third;
      if (["Space", "ArrowUp", "ArrowDown"].includes(e.code) && this.locked) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("pointerlockchange", () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked) { const wanted = this.intentionalUnlock; this.intentionalUnlock = false; if (!wanted) this.onLockLost(); }
    });
    // Pointer-lock look (normal browsers).
    document.addEventListener("pointerlockerror", () => this.failLock());
    document.addEventListener("mousemove", (e) => {
      if (!this.enabled || !this.locked) return;
      this.yaw += e.movementX * 0.0022;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + e.movementY * 0.0022));
    });
    // Fallback for browsers/panes that refuse pointer lock (e.g. embedded previews): click-and-drag to look.
    // Uses Pointer Events because some embedded panes only deliver those.
    canvas.addEventListener("pointerdown", (e) => { if (e.button === 0 && !this.locked && !this.touch) { this.dragging = true; this.lx = e.clientX; this.ly = e.clientY; } });
    const endDrag = () => { this.dragging = false; };
    window.addEventListener("pointerup", endDrag); window.addEventListener("pointercancel", endDrag);
    window.addEventListener("pointermove", (e) => {
      if (!this.dragging || this.locked || !this.enabled) return;
      this.yaw += (e.clientX - this.lx) * 0.0022;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + (e.clientY - this.ly) * 0.0022));
      this.lx = e.clientX; this.ly = e.clientY;
    });
  }

  private failLock() { if (!this.lockFailed) { this.lockFailed = true; this.onLockFailed(); } }
  lock() {
    if (this.locked || this.touch) return;
    try {
      const r: any = this.canvas.requestPointerLock?.();
      if (r && typeof r.catch === "function") r.catch(() => this.failLock());
      else if (!this.canvas.requestPointerLock) this.failLock();
    } catch { this.failLock(); }
  }
  unlock() { if (this.locked) { this.intentionalUnlock = true; document.exitPointerLock?.(); } }

  teleport(x: number, y: number, z: number, yaw?: number) {
    this.pos.set(x, y, z); this.vel.setAll(0); this.grounded = false; this.fallStart = y;
    if (yaw !== undefined) this.yaw = yaw;
  }

  forward() { return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  eyePos() { return new Vector3(this.pos.x, this.pos.y + EYE, this.pos.z); }
  lookDir() {
    const cp = Math.cos(this.pitch);
    return new Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  support(x: number, z: number, feet: number): number {
    let best = 0;
    for (const c of this.colliders) {
      if (c.y1 > feet + STEP + 0.001 || c.y1 <= best) continue;
      if (x > c.x0 - R * 0.55 && x < c.x1 + R * 0.55 && z > c.z0 - R * 0.55 && z < c.z1 + R * 0.55) best = c.y1;
    }
    return best;
  }

  private resolveXZ(feet: number) {
    for (let it = 0; it < 3; it++) {
      for (const c of this.colliders) {
        if (c.y1 <= feet + STEP || c.y0 >= feet + HEAD) continue;
        const cx = Math.max(c.x0, Math.min(this.pos.x, c.x1));
        const cz = Math.max(c.z0, Math.min(this.pos.z, c.z1));
        const dx = this.pos.x - cx, dz = this.pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = R - d;
          this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push;
        } else {
          // centre inside the box: push out along the shallowest axis
          const px = Math.min(this.pos.x - c.x0, c.x1 - this.pos.x), pz = Math.min(this.pos.z - c.z0, c.z1 - this.pos.z);
          if (px < pz) this.pos.x += (this.pos.x - c.x0 < c.x1 - this.pos.x ? -(px + R) : px + R);
          else this.pos.z += (this.pos.z - c.z0 < c.z1 - this.pos.z ? -(pz + R) : pz + R);
        }
      }
    }
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    if (this.ride) { this.body.root.setEnabled(false); return; }
    let ix = 0, iz = 0;
    if (this.enabled) {
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) iz += 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) iz -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) ix += 1;
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) ix -= 1;
    }
    const joy = this.enabled && (this.touchMove.x !== 0 || this.touchMove.y !== 0);
    if (joy) { ix += this.touchMove.x; iz += this.touchMove.y; }
    const len = Math.hypot(ix, iz);
    const sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const speed = (sprint ? 6.2 : 3.6) * (joy ? Math.min(1, Math.max(0.35, len)) : 1);
    let vx = 0, vz = 0;
    if (len > 0) {
      ix /= len; iz /= len;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      vx = (fz * ix + fx * iz) * speed; vz = (-fx * ix + fz * iz) * speed;
    }
    // jump
    if (this.enabled && this.grounded && this.keys.has("Space")) { this.vel.y = 5.0; this.grounded = false; this.fallStart = this.pos.y; this.onJump(); }
    this.vel.y -= G * this.gScale * dt;

    const feet = this.pos.y;
    // axis-separated horizontal motion + resolve
    this.pos.x += vx * dt; this.pos.z += vz * dt;
    this.resolveXZ(feet);
    // walking down stairs: stay glued to the next tread instead of free-falling onto it (no bouncing)
    let snapped = false;
    if (this.grounded && this.vel.y <= 0) {
      const s2 = this.support(this.pos.x, this.pos.z, this.pos.y);
      const drop = this.pos.y - s2;
      if (drop > 0.0005 && drop <= STEP) { this.pos.y = s2; this.vel.y = 0; snapped = true; this.fallStart = s2; }
    }
    // vertical
    const prevY = this.pos.y;
    if (!snapped) this.pos.y += this.vel.y * dt;
    const sup = this.support(this.pos.x, this.pos.z, prevY);
    if (snapped || (this.pos.y <= sup + 0.0001 && this.vel.y <= 0)) {
      if (!this.grounded) {
        const fall = this.fallStart - sup;
        if (fall > 3.2) this.onFall(fall);
      }
      this.pos.y = sup; this.vel.y = 0; this.grounded = true;
    } else {
      if (this.grounded && this.vel.y <= 0) this.fallStart = prevY;
      this.grounded = false;
      if (this.vel.y > 0) this.fallStart = Math.max(this.fallStart, this.pos.y);
    }
    // walked off an edge: grounded -> falling with proper fallStart
    if (!this.grounded && this.vel.y <= 0 && this.fallStart < this.pos.y) this.fallStart = this.pos.y;

    const moving = len > 0 && this.grounded;
    if (moving) { this.stepAcc += dt * speed; if (this.stepAcc > 1.9) { this.stepAcc = 0; this.onStep(); } }
    this.moved = moving ? speed : 0;

    // smoothed height for the camera so steps don't jolt the view
    if (this.camY === null || Math.abs(this.pos.y - this.camY) > 2.5) this.camY = this.pos.y;
    else this.camY += (this.pos.y - this.camY) * Math.min(1, dt * 14);
    // body
    this.body.root.position.copyFrom(this.pos);
    if (len > 0) {
      const target = Math.atan2(vx, vz);
      let d = target - this.body.root.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.body.root.rotation.y += d * Math.min(1, dt * 12);
    }
    this.body.animate(dt, moving ? speed : 0);
    this.body.root.setEnabled(this.third);

    // camera
    const eye = new Vector3(this.pos.x, (this.camY ?? this.pos.y) + EYE, this.pos.z);
    if (!this.third) {
      this.cam.position.copyFrom(eye);
      this.cam.setTarget(eye.add(this.lookDir()));
    } else {
      const target = new Vector3(this.pos.x, (this.camY ?? this.pos.y) + 1.55, this.pos.z);
      const back = this.lookDir().scale(-1);
      const sideOff = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).scale(0.45);
      const anchor = target.add(sideOff);
      let dist = 3.6;
      // march the camera back until it hits something
      for (let d = 0.4; d <= 3.6; d += 0.2) {
        const p = anchor.add(back.scale(d));
        let hit = p.y < 0.25;
        if (!hit) for (const c of this.colliders) {
          if (p.x > c.x0 - 0.15 && p.x < c.x1 + 0.15 && p.y > c.y0 - 0.1 && p.y < c.y1 + 0.15 && p.z > c.z0 - 0.15 && p.z < c.z1 + 0.15) { hit = true; break; }
        }
        if (hit) { dist = Math.max(0.5, d - 0.3); break; }
      }
      const cp = anchor.add(back.scale(dist));
      cp.y = Math.max(0.3, cp.y);
      this.cam.position.copyFrom(cp);
      this.cam.setTarget(target.add(this.lookDir().scale(4)));
      if (dist < 1.1) this.body.root.setEnabled(false);
    }
  }
}
