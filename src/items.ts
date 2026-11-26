/** Items: the cell phone (always yours) and the shotgun (a gift from Hank). Keys: 1 phone, 2 shotgun. The gun only fires out where the animals are. */
import { Scene, MeshBuilder, StandardMaterial, Color3, Vector3, Mesh } from "@babylonjs/core";
import type { Game } from "./game";
import { SPECIES_NAME, SPECIES_LB, type Species } from "./wildlife";
import { clockString } from "./sim";

type Held = "none" | "phone" | "shotgun";
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];

export class Items {
  held: Held = "none";
  private gunBody: Mesh | null = null; private gunCam: Mesh | null = null; private phoneBody: Mesh | null = null; private phoneCam: Mesh | null = null; private cool = 0; private bar: HTMLDivElement;
  private bagged = new Set<string>();

  constructor(private g: Game, private scene: Scene) {
    const d = document.createElement("div"); d.id = "itembar";
    d.style.cssText = "position:fixed;right:14px;bottom:150px;z-index:6;display:none;flex-direction:column;gap:6px;font:700 12px system-ui,sans-serif;color:#fff;pointer-events:auto;min-width:136px";
    document.body.appendChild(d); this.bar = d;
    // Q (or the mouse wheel) cycles through what is in your hands; a click uses it
    const ok = () => g.started && !g.paused && !g.ui.panelOpen && !g.veh.riding && !g.astMode && !g.flags.finish && !g.outskirts.isFishing();
    window.addEventListener("keydown", (e) => {
      if (e.repeat || !ok()) return;
      if (e.code === "KeyQ") this.cycle(1);
      else if (e.code === "Digit1") this.select("phone"); else if (e.code === "Digit2") this.select("shotgun"); else if (e.code === "Digit0") this.select("none");
    });
    window.addEventListener("wheel", (e) => { if (ok() && g.player.locked && Math.abs(e.deltaY) > 4) this.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    document.addEventListener("mousedown", (e) => { if (e.button !== 0 || !g.player.locked || !ok()) return; if (this.held === "shotgun") this.fire(); else if (this.held === "phone") this.phone(); });
  }

  private slots(): Held[] { return this.has("shotgun") ? ["none", "phone", "shotgun"] : ["none", "phone"]; }
  cycle(d: number) { const s = this.slots(), i = s.indexOf(this.held); this.setHeld(s[(i + d + s.length) % s.length]); }
  select(h: Held) { if (h === "shotgun" && !this.has("shotgun")) { this.g.ui.toast("NO SHOTGUN", "You don't have one. Hank might lend you his."); return; } this.setHeld(this.held === h ? "none" : h); }
  private setHeld(h: Held) {
    if (h === this.held) return; this.held = h; this.g.sfx.click();
    if (h === "phone") this.g.ui.toast("PHONE OUT", "Click to make a call. Q or the mouse wheel changes what you hold.");
    else if (h === "shotgun") this.g.ui.toast("SHOTGUN READY", this.huntOk() ? "Click to fire." : "You are too close to people to fire it. Take it out where the animals are.");
  }
  has(id: "phone" | "shotgun") { return id === "phone" || !!(this.g.flags.items && this.g.flags.items[id]); }
  give(id: "shotgun") { (this.g.flags.items ??= {})[id] = true; this.g.ui.toast("ITEM: SHOTGUN", "Hank gave you a shotgun. Press 2 to ready it. It only fires out where the animals are."); }

  // ---------------------------------------------------------------------------------------------- the shotgun
  /** shooting is only allowed out in the country where the animals are: not on the lease, the farm, the taco truck or the other company's fence */
  huntOk(): boolean {
    const p = this.g.player.pos, o = this.g.outskirts;
    if (this.g.veh.riding) return false;
    return Math.hypot(p.x, p.z) > 130 && !o.nearPeople(p.x, p.z);
  }
  /** a phone: a dark slab with a lit screen on both faces, so it reads whichever way the hand turns it */
  private makePhone(): Mesh {
    const body = new StandardMaterial("phm1", this.scene); body.diffuseColor = Color3.FromHexString("#14171c"); body.specularColor = new Color3(0.4, 0.4, 0.45);
    const scr = new StandardMaterial("phm2", this.scene); scr.emissiveColor = new Color3(0.2, 0.75, 1); scr.diffuseColor = Color3.Black(); scr.disableLighting = true;
    const m = MeshBuilder.CreateBox("phone", { width: 0.1, height: 0.2, depth: 0.018 }, this.scene); m.material = body; m.isPickable = false;
    for (const s of [-1, 1]) { const f = MeshBuilder.CreateBox("phscreen", { width: 0.084, height: 0.17, depth: 0.002 }, this.scene); f.material = scr; f.parent = m; f.position.z = s * 0.0095; f.isPickable = false; }
    m.setEnabled(false); return m;
  }
  private makeGun(): Mesh {
    const dark = new StandardMaterial("gunm1", this.scene); dark.diffuseColor = Color3.FromHexString("#1d2128"); dark.specularColor = new Color3(0.3, 0.3, 0.3);
    const wood = new StandardMaterial("gunm2", this.scene); wood.diffuseColor = Color3.FromHexString("#6a4228"); wood.specularColor = Color3.Black();
    const barrel = MeshBuilder.CreateBox("gunbarrel", { width: 0.05, height: 0.05, depth: 1.0 }, this.scene); barrel.material = dark;
    const pump = MeshBuilder.CreateBox("gunpump", { width: 0.07, height: 0.06, depth: 0.28 }, this.scene); pump.material = wood; pump.parent = barrel; pump.position.set(0, -0.05, 0.12);
    const stock = MeshBuilder.CreateBox("gunstock", { width: 0.06, height: 0.11, depth: 0.42 }, this.scene); stock.material = wood; stock.parent = barrel; stock.position.set(0, -0.04, -0.62);
    for (const m of [barrel, pump, stock]) { m.isPickable = false; } barrel.setEnabled(false); return barrel;
  }
  private fire() {
    const g = this.g, p = g.player;
    if (this.cool > 0 || !g.started || g.paused || g.ui.panelOpen) return;
    if (!this.huntOk()) { g.ui.toast("NOT HERE", "You can't fire a gun around people. Take it out where the animals are."); this.cool = 0.8; return; }
    this.cool = 0.9; g.sfx.gun(); g.stat("shots");
    const o = p.pos.add(new Vector3(0, 1.55, 0)), ray = p.cam.getForwardRay(200), d = ray.direction.clone().normalize();
    let hitAt: Vector3 | null = null;
    const sp = g.outskirts.wild.shoot(o, d);
    const to = o.add(d.scale(sp ? 30 : 60)); hitAt = sp ? null : to.clone();
    g.outskirts.shotFx(o.add(d.scale(0.8)).add(new Vector3(0, -0.15, 0)), to, hitAt);
    if (sp) this.onBagged(sp);
  }
  /** an animal went down */
  onBagged(k: Species) {
    const g = this.g, name = SPECIES_NAME[k], lb = SPECIES_LB[k];
    if (k === "snake" || k === "bird") { g.ui.toast("BAGGED: " + name.toUpperCase(), "Nobody was going to eat that."); return; }
    g.stat("bagged"); this.bagged.add(k); (g.flags.baggedKinds ??= {})[k] = true;
    if (g.active && g.active.m.id === "hunt") g.flags.huntBag = (g.flags.huntBag ?? 0) + 1;
    if (k === "prize") { g.ui.toast("PRIZE BUCK!", "A twelve-point monster, about " + lb + " lb. Hank is going to cry."); g.gain(0.3, 10); g.award("trophy"); g.logBonus("The prize buck", "+0.3 approval · +10 morale"); g.radio("hank" as any, "THAT'S… THAT'S HIM. THAT'S THE ONE. THIRTY YEARS. I'M NOT CRYING. IT'S ALLERGIES.", 9000); }
    else g.ui.toast("BAGGED: " + name.toUpperCase(), "About " + lb + " lb." + (lb < 10 ? " It was a small one." : lb > 150 ? " That's a lot of freezer." : ""));
    g.award("bag1"); if (Object.keys(g.flags.baggedKinds ?? {}).length >= 5) g.award("variety");
  }

  // ---------------------------------------------------------------------------------------------- the cell phone
  phone() {
    const g = this.g; g.sfx.click();
    const later = (f: () => void) => setTimeout(f, 60);
    const menu = () => g.say("me", "Who do you want to call?", [
      { label: "The Driller (Big Dale)", run: () => later(driller) },
      { label: "The Engineer (Marcus)", run: () => later(engineer) },
      { label: "The Directional Driller (Tex)", run: () => later(dd) },
      { label: "The Superintendent (Walt)", run: () => later(superintendent) },
      { label: "Houston", run: () => later(houston) },
      { label: "Mom", run: () => later(mom) },
      { label: "Never mind", cls: "alt" },
    ] as any, "Cell phone");
    const call = () => g.stat("calls");
    const s = g.sim.s;
    const dale = (text: string, back = true) => g.say("dale", text, [{ label: back ? "Anything else?" : "OK", cls: "alt", run: () => back && later(driller) }, { label: "That's all", cls: "alt" }] as any, "Big Dale — on the phone");
    const driller = () => g.say("dale", "Dale. Go ahead, boss.", [
      { label: "Shut in the well", cls: "red", run: () => { call(); if (!(s.kick.active || s.mode === "drilling")) { later(() => dale("Not much to shut in right now, boss.")); return; } g.cabinAction("shut"); } },
      { label: "More weight on bit (+5)", run: () => { call(); if (s.auto.on) { later(() => dale("The autodriller's running it, boss. Change the set point at the console, or I switch it off first.")); return; } s.wobTarget = clamp(s.wobTarget + 5, 0, 60); later(() => dale("WOB's at " + s.wobTarget + ". Watching the diff pressure.")); } },
      { label: "Less weight on bit (-5)", run: () => { call(); if (s.auto.on) { later(() => dale("The autodriller's running it, boss.")); return; } s.wobTarget = clamp(s.wobTarget - 5, 0, 60); later(() => dale("WOB's at " + s.wobTarget + ".")); } },
      { label: s.auto.on ? "Turn the autodriller off" : "Turn the autodriller on", run: () => { call(); s.auto.on = !s.auto.on; if (s.auto.on) g.flags.laserOn = false; later(() => dale(s.auto.on ? "Autodriller's on. Same set points as before." : "Autodriller's off. I've got the brake.")); } },
      { label: "Trip for a new bit", run: () => { call(); if (s.mode !== "drilling" && !s.needTrip) { later(() => dale("Can't trip right now, boss. Not while we're " + s.mode + ".")); return; } g.cabinAction("trip"); } },
      { label: "Flow check's good: open the BOP", run: () => { call(); if (s.kill.stage !== "flowcheck") { later(() => dale("Nothing to open, boss. We're not at the flow check.")); return; } g.cabinAction("open"); } },
      { label: "Never mind", cls: "alt", run: () => { call(); g.radio("dale", "Okay, boss. I'll be here.", 4000); } },
    ] as any, "Big Dale — Driller");
    const nextStep = (): string => {
      if (s.kick.active && !s.kick.shut) return "You've got a kick. Shut in the well at the driller's console. NOW.";
      if (s.kill.stage === "readings") return "You're shut in. Go to the choke panel and record the pressures.";
      if (s.kill.stage === "weightup") return "Weight the mud up to the kill weight at the mud hopper, then circulate.";
      if (s.kill.stage === "circ") return "Circulate the kick out. Keep the drill pipe pressure on target with the choke, and don't break down the shoe.";
      if (s.kill.stage === "flowcheck") return "Flow check it at the console and open the BOP.";
      if (g.active) { const st = g.active.m.steps[g.active.i]; return "Right now: " + g.active.m.title + ". " + (st ? st.text + "." : ""); }
      if (s.needTrip) return "The bit or the motor is done. Trip out for new ones.";
      if (s.fuel < 1800) return "Diesel's getting low. Order a delivery from the supply note.";
      if (s.depth >= 8300) return "Nearly at TD. Finish up any open jobs, then the big one starts.";
      return "Nothing's on fire. Keep drilling, keep the autodriller sane, and watch the pits for a gain.";
    };
    const engineer = () => g.say("marcus", "Marcus.", [
      { label: "What should I do next?", run: () => { call(); later(() => g.say("marcus", nextStep(), [{ label: "Thanks", cls: "green" }] as any, "Marcus — on the phone")); } },
      { label: "Never mind", cls: "alt", run: () => {
        call(); const h = clockString(s.t).hour % 24;
        if (h >= 23 || h < 5) { g.award("nightcall"); g.radio("marcus", "It's " + clockString(s.t).hhmm + ". You woke me up to say nevermind?", 7000); }
        else g.radio("marcus", "No problem. Call any time.", 4000);
      } },
    ] as any, "Marcus — Mud Engineer");
    const dd = () => g.say("tex", "Tex. Yeah?", [
      { label: "How's the well path?", run: () => { call(); later(() => g.say("tex", pick(["We're tracking the plan. I'm not going to say 'perfect', because the last time I said that it wasn't.", "A little high, a little right. Nothing a slide won't fix.", "Looking good. The offsets are staying clear of us, if that's what you're asking.", "Pretty close. I've seen worse. I've caused worse."]), [{ label: "Thanks, Tex", cls: "green" }] as any, "Tex — on the phone")); } },
      { label: "Rotate", run: () => { call(); g.dd.mode = "rotate"; g.radio("tex", "Rotating.", 3500); } },
      { label: "Slide", run: () => { call(); g.dd.mode = "slide"; g.radio("tex", "Sliding. It's slow, but it's pointed the right way.", 4500); } },
      { label: "Oscillate", run: () => { call(); g.dd.mode = "osc"; g.radio("tex", "Oscillating. The string's going to wiggle.", 4500); } },
      { label: "Never mind", cls: "alt", run: () => { call(); g.radio("tex", "Alright.", 3000); } },
    ] as any, "Tex — Directional Driller");
    const superintendent = () => g.say("super" as any, "Walt. Talk to me.", [
      { label: "Give me a status", run: () => { call(); later(() => g.say("super" as any, `We're at ${Math.round(s.depth).toLocaleString("en-US")} feet. Spent $${Math.round(s.cost / 1000).toLocaleString("en-US")}k against $${Math.round(3400)}k. ${s.cost > 3400000 ? "Houston's going to want to talk about that." : "Houston hasn't called yet. Keep it that way."}`, [{ label: "OK", cls: "green" }] as any, "Walt — on the phone")); } },
      { label: "I need more crew", run: () => { call(); later(() => g.say("super" as any, "Everybody I have is already on location. Including the guy who keeps eating lunch in my truck.", [{ label: "Fair", cls: "green" }] as any, "Walt — on the phone")); } },
      { label: "Never mind", cls: "alt", run: () => { call(); g.radio("super" as any, "Okay. I'm in the truck.", 3000); } },
    ] as any, "Walt — Superintendent");
    const houston = () => g.say("brent", "Houston office. This is Brent. Please hold. …Never mind, you're already on. How can I help?", [
      { label: "How is the office feeling about me?", run: () => { call(); later(() => g.say("brent", g.approval >= 4 ? "Chad used the word 'impressive' in a meeting. He used it correctly." : g.approval >= 2.5 ? "Neutral. Which in Houston is a compliment." : "There's a meeting about you. You're not invited.", [{ label: "Thanks, Brent", cls: "green" }] as any, "Brent — Houston Office")); } },
      { label: "Can I get more budget?", run: () => { call(); later(() => g.say("brent", "No. The AFE is the AFE. Chad said it with his whole face.", [{ label: "Worth a try", cls: "green" }] as any, "Brent — Houston Office")); } },
      { label: "Never mind", cls: "alt", run: () => { call(); g.radio("brent", "You called Houston to say nothing. We do that every day.", 4500); } },
    ] as any, "Houston Office");
    const mom = () => { call(); const first = !g.flags.momCalled; g.flags.momCalled = true; if (first) g.gain(0, 4); g.say("mom" as any, first ? "Oh, honey! Are you wearing your hard hat? Have you eaten? You sound tired. I'm proud of you. Call your father." : pick(["Are you wearing a hard hat? Don't lie.", "I saw an oil rig on the news. Was that yours?", "Your sister's having a baby. Or a dog. I'll call you back.", "Don't work too hard. Work a normal amount."]), [{ label: "Love you, Mom", cls: "green", run: () => { if (first) g.ui.toast("+4 MORALE", "Mom is proud of you."); } }] as any, "Mom"); };
    menu();
  }

  // ---------------------------------------------------------------------------------------------- per frame
  update(dt: number) {
    const g = this.g, p = g.player; this.cool -= dt;
    const show = g.started && !g.astMode && !g.flags.finish && !g.veh.riding;
    // the item bar: your hands, the phone and the shotgun down the right side. Click one to take it out (a second click on the phone calls)
    const names: Record<Held, string> = { none: "HANDS", phone: "PHONE", shotgun: "SHOTGUN" };
    const html = show ? this.slots().map((s) => `<div data-s="${s}" style="cursor:pointer;padding:6px 10px;background:rgba(10,16,24,.88);border:2px solid ${this.held === s ? "#f4c04a" : "#3a4a62"};opacity:${this.held === s ? 1 : 0.75}">${this.held === s ? "▶ " : ""}${names[s]}${this.held === s && s === "shotgun" ? (this.huntOk() ? " · click to fire" : " · not here") : this.held === s && s === "phone" ? " · click to call" : ""}</div>`).join("") + `<div style="font-size:10px;opacity:.75;text-align:center"><kbd>Q</kbd> or wheel to switch</div>` : "";
    if (this.bar.dataset.h !== html) {
      this.bar.dataset.h = html; this.bar.innerHTML = html; this.bar.style.display = html ? "flex" : "none";
      this.bar.querySelectorAll("kbd").forEach((k) => ((k as HTMLElement).style.cssText = "background:#f1f4f7;color:#111;padding:1px 5px;border-radius:3px;font:700 11px ui-monospace,Consolas,monospace"));
      this.bar.querySelectorAll<HTMLElement>("[data-s]").forEach((el) => { el.onclick = () => { const s = el.dataset.s as Held; if (this.held === s && s === "phone") this.phone(); else this.setHeld(s); }; });
    }
    if (!show && this.held === "shotgun") this.held = "none";
    // the gun in hand: on the camera in first person, on the body in third
    if (this.held === "shotgun") {
      if (!this.gunBody) { this.gunBody = this.makeGun(); this.gunBody.parent = p.body.root; this.gunBody.position.set(0.22, 1.18, 0.5); this.gunBody.rotation.set(0.12, 0.03, 0); }
      if (!this.gunCam) { this.gunCam = this.makeGun(); this.gunCam.parent = p.cam; this.gunCam.position.set(0.3, -0.26, 0.85); this.gunCam.rotation.set(0.05, -0.08, 0); }
      this.gunBody.setEnabled(p.third); this.gunCam.setEnabled(!p.third);
      p.body.root.rotation.y = p.yaw; p.body.useHand("gas", 0.4);
    } else {
      this.gunBody?.setEnabled(false); this.gunCam?.setEnabled(false);
      // the phone in hand: held up in front of you, on the camera in first person and in the hand in third
      if (this.held === "phone" && p.body.elbowR) {
        if (!this.phoneBody) { this.phoneBody = this.makePhone(); this.phoneBody.parent = p.body.elbowR; this.phoneBody.position.set(0, -0.3, 0.07); this.phoneBody.rotation.set(0.5, 0, 0); }
        if (!this.phoneCam) { this.phoneCam = this.makePhone(); this.phoneCam.parent = p.cam; this.phoneCam.position.set(0.17, -0.2, 0.5); this.phoneCam.rotation.set(-0.45, -0.15, 0); }
        this.phoneBody.setEnabled(p.third); this.phoneCam.setEnabled(!p.third);
        p.body.root.rotation.y = p.yaw; p.body.useHand("tally", 0.4);
      }
    }
    if (this.held !== "phone") { this.phoneBody?.setEnabled(false); this.phoneCam?.setEnabled(false); }
  }
}
