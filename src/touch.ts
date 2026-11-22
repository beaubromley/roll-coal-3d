import type { Player } from "./player";
import type { Game } from "./game";

/** True on phones/tablets (coarse primary pointer). `?touch=1` forces it for testing. */
export function detectTouch(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.get("touch") === "1") return true;
  if (q.get("touch") === "0") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const fine = window.matchMedia?.("(pointer: fine)").matches;
  return !!coarse || ("ontouchstart" in window && !fine);
}

/**
 * On-screen controls: floating left-thumb joystick, right-side drag-to-look, and Use / Jump / Run / Camera / Pause buttons.
 * All Pointer Events, with per-pointer tracking so move + look + a button can happen at once.
 */
export class TouchControls {
  private joyId = -1; private lookId = -1;
  private jx = 0; private jy = 0; private lx = 0; private ly = 0;
  private run = false;
  private held = new Set<string>();
  private hot = false; private lastLabel = "";
  private readonly RADIUS = 56;
  private readonly LOOK = 0.0052;

  constructor(private player: Player, private game: Game) {
    const $ = (id: string) => document.getElementById(id) as HTMLElement;
    const joyzone = $("joyzone"), base = $("joybase"), knob = $("joyknob"), look = $("lookzone");

    // ---- joystick (floating: appears where the thumb lands) ----
    joyzone.addEventListener("pointerdown", (e) => {
      if (this.joyId !== -1) return;
      this.joyId = e.pointerId; try { joyzone.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
      const r = joyzone.getBoundingClientRect();
      this.jx = e.clientX; this.jy = e.clientY;
      base.style.display = "block"; base.style.left = e.clientX - r.left + "px"; base.style.top = e.clientY - r.top + "px";
      knob.style.transform = "translate(0,0)";
      e.preventDefault();
    });
    joyzone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.joyId) return;
      let dx = e.clientX - this.jx, dy = e.clientY - this.jy;
      const d = Math.hypot(dx, dy);
      if (d > this.RADIUS) { dx = (dx / d) * this.RADIUS; dy = (dy / d) * this.RADIUS; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      let x = dx / this.RADIUS, y = -dy / this.RADIUS;
      const m = Math.hypot(x, y);
      if (m < 0.14) { x = 0; y = 0; }       // dead zone
      this.player.touchMove.x = x; this.player.touchMove.y = y;
      // pushing the stick all the way out auto-sprints
      this.player.stickSprint = false;   // running is only the RUN button (or Shift): pushing the stick all the way out just walks
    });
    const joyEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = -1; base.style.display = "none";
      this.player.touchMove.x = 0; this.player.touchMove.y = 0;
      this.player.stickSprint = false;
    };
    joyzone.addEventListener("pointerup", joyEnd); joyzone.addEventListener("pointercancel", joyEnd);

    // ---- look (drag anywhere that isn't the stick or a button) ----
    look.addEventListener("pointerdown", (e) => {
      if (this.lookId !== -1) return;
      this.lookId = e.pointerId; try { look.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ } this.lx = e.clientX; this.ly = e.clientY; e.preventDefault();
    });
    look.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.lookId || !this.player.enabled) return;
      this.player.yaw += (e.clientX - this.lx) * this.LOOK;
      this.player.pitch = Math.max(-1.3, Math.min(1.3, this.player.pitch + (e.clientY - this.ly) * this.LOOK));
      this.lx = e.clientX; this.ly = e.clientY;
    });
    const lookEnd = (e: PointerEvent) => { if (e.pointerId === this.lookId) this.lookId = -1; };
    look.addEventListener("pointerup", lookEnd); look.addEventListener("pointercancel", lookEnd);

    // ---- buttons ----
    const press = (el: HTMLElement, down: () => void, up?: () => void) => {
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ } down(); });
      const end = (e: PointerEvent) => { e.stopPropagation(); up?.(); };
      el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    };
    press($("tb-use"), () => this.game.interact());
    press($("tb-jump"), () => this.player.keys.add("Space"), () => this.player.keys.delete("Space"));
    press($("tb-run"), () => {
      this.run = !this.run; $("tb-run").classList.toggle("on", this.run); this.player.sprintLatch = this.run;
    });
    press($("tb-cam"), () => { this.player.third = !this.player.third; });
    press($("tb-pause"), () => this.game.togglePause(true));
    // steering strip: slide the finger left and right, any position along the strip is the steering angle (centre = straight)
    const steer = $("td-steer"), sknob = $("td-knob"); let steerId = -1;
    const setSteer = (e: PointerEvent) => {
      const r = steer.getBoundingClientRect(), half = r.width / 2 - 34;
      let x = (e.clientX - (r.left + r.width / 2)) / half; x = Math.max(-1, Math.min(1, x));
      if (Math.abs(x) < 0.06) x = 0;
      this.player.touchMove.x = x; sknob.style.transform = `translateX(${x * half}px)`;
    };
    steer.addEventListener("pointerdown", (e) => { if (steerId !== -1) return; e.preventDefault(); e.stopPropagation(); steerId = e.pointerId; try { steer.setPointerCapture(e.pointerId); } catch { /* synthetic */ } steer.classList.add("on"); setSteer(e); });
    steer.addEventListener("pointermove", (e) => { if (e.pointerId === steerId) setSteer(e); });
    const steerEnd = (e: PointerEvent) => { if (e.pointerId !== steerId) return; steerId = -1; steer.classList.remove("on"); this.player.touchMove.x = 0; sknob.style.transform = "translateX(0)"; };
    steer.addEventListener("pointerup", steerEnd); steer.addEventListener("pointercancel", steerEnd);
    // driving: each pedal / steer / boom button holds a key (the vehicle reads keys), released on lift-off
    document.querySelectorAll<HTMLButtonElement>("#drive .td").forEach((el) => {
      const code = el.dataset.key!;
      press(el, () => { this.held.add(code); el.classList.add("on"); window.dispatchEvent(new KeyboardEvent("keydown", { code })); },
        () => { this.held.delete(code); el.classList.remove("on"); window.dispatchEvent(new KeyboardEvent("keyup", { code })); });
    });
  }

  /** Called every frame: the USE button lights up and shows a label when something is in reach. */
  update() {
    const bc = document.body.classList, hidden = bc.contains("panelopen") || bc.contains("paused");
    if (hidden && (this.joyId !== -1 || this.lookId !== -1 || this.player.touchMove.x || this.player.touchMove.y)) {
      // the layer is about to vanish under a finger: its pointerup would never arrive, so let go of everything now
      this.joyId = -1; this.lookId = -1; this.player.touchMove.x = 0; this.player.touchMove.y = 0; this.player.stickSprint = false;
      document.getElementById("joybase")!.style.display = "none";
    }
    if (this.player.ride && this.player.sprintLatch) { this.player.sprintLatch = false; this.run = false; }       // getting in a vehicle ends the run
    document.getElementById("tb-run")!.classList.toggle("on", this.player.sprintLatch);                          // the button always shows the real state
    // got out of the vehicle (or it was taken away) while a button was down: let go of everything
    if (!document.body.classList.contains("driving") && this.player.touchMove.x && this.joyId === -1) { this.player.touchMove.x = 0; document.getElementById("td-knob")!.style.transform = "translateX(0)"; }
    if (this.held.size && !document.body.classList.contains("driving")) {
      for (const code of this.held) window.dispatchEvent(new KeyboardEvent("keyup", { code }));
      this.held.clear(); document.querySelectorAll("#drive .td.on").forEach((e) => e.classList.remove("on"));
    }
    const near = this.game.nearest;
    const use = document.getElementById("tb-use")!, hint = document.getElementById("tbhint")!;
    const hot = !!near;
    if (hot !== this.hot) { this.hot = hot; use.classList.toggle("hot", hot); }
    const label = near ? near.label() : "";
    if (label !== this.lastLabel) { this.lastLabel = label; hint.textContent = label; hint.style.display = label ? "block" : "none"; }
  }
}
