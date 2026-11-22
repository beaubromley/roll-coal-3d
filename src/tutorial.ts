import type { Game } from "./game";
import type { Player } from "./player";
import type { Vector3 } from "@babylonjs/core";

const KEY = "rcmh2.tutorial.done";

/** First-run guide: look, walk, run, head for the gate, use something. Each step completes itself when you do it. */
export class Tutorial {
  private i = -1;
  private el: HTMLElement;
  private lookAcc = 0; private walkAcc = 0; private runT = 0; private doneT = 0;
  private ly = 0; private lp = 0; private lx = 0; private lz = 0;
  private used = false;
  private touch: boolean;

  constructor(private game: Game, private player: Player, touch: boolean) {
    this.touch = touch;
    this.el = document.getElementById("tut")!;
    document.getElementById("tutSkip")!.addEventListener("click", () => this.finish(false));
    game.onInteract = () => { this.used = true; };
  }

  static seen(): boolean { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } }

  start() {
    if (Tutorial.seen()) return;
    this.i = 0; this.ly = this.player.yaw; this.lp = this.player.pitch; this.lx = this.player.pos.x; this.lz = this.player.pos.z;
    this.el.style.display = "block"; this.render();
  }

  private steps(): { text: () => string; done: () => boolean }[] {
    const t = this.touch, g = this.game, gate = g.rig.spots.gate as Vector3;
    const dist = () => Math.round(Math.hypot(gate.x - this.player.pos.x, gate.z - this.player.pos.z) * 3.281);
    return [
      { text: () => t ? "LOOK: drag your finger on the right side of the screen" : "LOOK: move the mouse (click the game first)", done: () => this.lookAcc > 1.0 },
      { text: () => t ? "WALK: hold the left thumb stick" : "WALK: W A S D", done: () => this.walkAcc > 8 },
      { text: () => t ? "RUN: tap RUN, or push the stick all the way out" : "RUN: hold SHIFT while you walk", done: () => this.runT > 1.2 },
      { text: () => `GO TO THE GATE: follow the gold arrow and beam, ${dist()} ft`, done: () => dist() < 22 },
      { text: () => t ? "USE: tap the glowing gold USE button" : "USE: press E when the gold prompt shows up", done: () => this.used },
      { text: () => "NICE. Your job card is top-left. Gold pins show where each job is. Good luck, Company Man.", done: () => this.doneT > 8 },
    ];
  }

  private render() {
    const s = this.steps(), n = s.length;
    (this.el.querySelector(".tt") as HTMLElement).textContent = s[this.i].text();
    (this.el.querySelector(".ts") as HTMLElement).textContent = `TUTORIAL ${Math.min(this.i + 1, n)} / ${n}`;
    document.getElementById("tb-run")?.classList.toggle("tuthi", this.touch && this.i === 2);
  }

  finish(auto: boolean) {
    this.i = -1; this.el.style.display = "none"; document.getElementById("tb-run")?.classList.remove("tuthi");
    try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ }
    if (auto) this.game.sfx.good();
  }

  update(dt: number) {
    if (this.i < 0) return;
    const p = this.player, g = this.game;
    if (g.paused || g.ui.panelOpen) return;
    this.lookAcc += Math.abs(p.yaw - this.ly) + Math.abs(p.pitch - this.lp); this.ly = p.yaw; this.lp = p.pitch;
    this.walkAcc += Math.min(2, Math.hypot(p.pos.x - this.lx, p.pos.z - this.lz)); this.lx = p.pos.x; this.lz = p.pos.z;
    if (p.sprinting) this.runT += dt; else this.runT = Math.max(0, this.runT - dt * 0.5);
    const s = this.steps();
    if (this.i === s.length - 1) this.doneT += dt;
    if (s[this.i].done()) {
      this.i++;
      if (this.i >= s.length) { this.finish(true); return; }
      g.sfx.click();
    }
    this.render();
  }
}
