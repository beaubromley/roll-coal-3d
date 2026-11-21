import {
  Engine, Scene, Color4, Color3, Vector3, HemisphericLight, DirectionalLight, ShadowGenerator, GlowLayer, Mesh,
} from "@babylonjs/core";
import { buildRig } from "./rig";
import { Player } from "./player";
import { Sim, WELL } from "./sim";
import { Sfx } from "./audio";
import { UI, $ } from "./ui";
import { Game } from "./game";
import { TitleFx } from "./titlefx";
import { TouchControls, detectTouch } from "./touch";
import { Graphics, QUALITY_NAMES } from "./graphics";
import { Kit } from "./models";
import { CharKit } from "./chars";
import { Human } from "./npcs";

const isTouch = detectTouch();
document.body.classList.toggle("touch", isTouch);

const canvas = document.getElementById("view") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, antialias: !isTouch }, true);
// Phones: render at roughly 1.3x CSS pixels instead of the full device ratio.
engine.setHardwareScalingLevel(isTouch ? Math.max(1.2, window.devicePixelRatio / 1.3) : Math.max(1, window.devicePixelRatio > 1.5 ? 1.25 : 1));
const scene = new Scene(engine);
scene.clearColor = new Color4(0.5, 0.7, 0.9, 1);
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogDensity = 0.0016;
scene.fogColor = new Color3(0.6, 0.75, 0.9);

const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
hemi.groundColor = new Color3(0.35, 0.3, 0.25);
hemi.specular = Color3.Black();
const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, -0.45), scene);
sun.position = new Vector3(60, 120, 60);
sun.intensity = 1.1;
sun.shadowMinZ = 1; sun.shadowMaxZ = 400;

// Blender-authored props and jointed crew (falls back to procedural geometry if the models can't load)
const kit = await Kit.load(scene);
Human.kit = kit;
Human.char = await CharKit.load(scene, new URLSearchParams(location.search).get("char") ?? "worker.glb");
const rig = buildRig(scene, { bump: !isTouch, kit });
const player = new Player(scene, canvas, rig.colliders);
player.touch = isTouch;
if (isTouch) player.lockFailed = true;      // never show the "mouse capture" hint on a phone
const sim = new Sim();
const sfx = new Sfx();
const ui = new UI();
const game = new Game(scene, rig, player, sim, sfx, ui, { hemi, sun });
game.isTouch = isTouch;
(window as any).__game = { game, sim, player, rig, scene, kit };

// shadows (cheaper on phones)
const sg = new ShadowGenerator(isTouch ? 1024 : 2048, sun);
if (isTouch) sg.usePoissonSampling = true; else sg.usePercentageCloserFiltering = true;
sg.bias = 0.0006; sg.normalBias = 0.02;
sg.transparencyShadow = false;
rig.merged.forEach((m: Mesh) => sg.addShadowCaster(m));
kit?.casters.forEach((m) => sg.addShadowCaster(m));
player.body.setShadow(sg);
game.veh.setShadow(sg);
Object.values(rig.humans).forEach((h) => h.setShadow(sg));
scene.meshes.forEach((m) => { if (m.name === "ground" || m.name === "padmesh" || m.name === "road") m.receiveShadows = true; });

const glow = new GlowLayer("glow", scene, { mainTextureFixedSize: 512, blurKernelSize: 24 });
glow.intensity = 0.45;

// post-processing / detail level (LOW on phones by default; change it from the pause menu)
const gfx = new Graphics(scene, player.cam, glow, rig);
const gfxLabel = () => { $("pGfx").textContent = "GRAPHICS: " + QUALITY_NAMES[gfx.level]; };
gfx.set(Graphics.saved(isTouch, String((engine.getGlInfo?.() ?? {}).renderer ?? ""))); gfxLabel();
$("pGfx").addEventListener("click", () => { gfx.cycle(); gfxLabel(); });
(window as any).__gfx = gfx;

// spawn at the lease-road gate looking at the rig
player.teleport(0, 0.5, 112, Math.PI);

// ---- touch controls ----
let touch: TouchControls | null = null;
if (isTouch) {
  touch = new TouchControls(player, game);
  document.addEventListener("touchmove", (e) => { if (!(e.target as HTMLElement).closest("#panel, .pbox, #controls")) e.preventDefault(); }, { passive: false });
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  $("pressstart").textContent = "TAP CLOCK IN";
  const cl = document.querySelector("#controls .clist");
  if (cl) cl.innerHTML = "<span>STICK</span><em>MOVE</em><span>DRAG</span><em>LOOK</em><span>USE</span><em>INTERACT</em><span>JUMP</span><em>JUMP</em><span>RUN</span><em>SPRINT</em><span>CAM</span><em>1ST / 3RD</em>";
}

// ---- start / intro ----
$("loading").style.display = "none";
$("intro").style.display = "grid";
const fx = new TitleFx($("titleFx") as HTMLCanvasElement);
fx.onThunder = () => {
  const st = $("stage"); st.classList.remove("shake"); void st.offsetWidth; st.classList.add("shake");
  setTimeout(() => sfx.thunder(), 120);
};
fx.start();
const introOpen = () => $("intro").style.display !== "none";
$("ctrlBtn").addEventListener("click", () => { sfx.init(); sfx.click(); $("controls").style.display = "flex"; $("btnrow").style.visibility = "hidden"; $("pressstart").style.visibility = "hidden"; });
$("ctrlBack").addEventListener("click", () => { sfx.click(); $("controls").style.display = "none"; $("btnrow").style.visibility = "visible"; $("pressstart").style.visibility = "visible"; });
window.addEventListener("keydown", (e) => {
  if (!introOpen() || e.repeat) return;
  const inControls = $("controls").style.display !== "none";
  if (inControls && (e.code === "Escape" || e.code === "Enter")) $("ctrlBack").click();
  else if (!inControls && (e.code === "Enter" || e.code === "Space")) { e.preventDefault(); $("startBtn").click(); }
});
$("startBtn").addEventListener("click", () => {
  sfx.init(); sfx.good(); fx.stop();
  $("intro").style.display = "none";
  $("hud").style.display = "block";
  game.started = true;
  if (isTouch) { try { (document.documentElement as any).requestFullscreen?.({ navigationUI: "hide" })?.catch?.(() => {}); } catch { /* not supported (iOS) */ } }
  player.lock();
  ui.toast("ROLL COAL, MAKE HOLE 2", isTouch ? "Stick to move, drag to look. Walk to the gate shack." : "Walk to the gate shack and sign in.");
});
player.onLockFailed = () => ui.toast("MOUSE CAPTURE UNAVAILABLE", "Click and drag to look around");
canvas.addEventListener("click", () => { if (game.started && !ui.panelOpen && !game.paused) player.lock(); });

// ---- pause: Esc / P, lost mouse capture, or the tab going to the background ----
player.onLockLost = () => { if (game.started && !ui.panelOpen && !game.flags.finish) game.togglePause(true); };
document.addEventListener("visibilitychange", () => { if (document.hidden && game.started && !game.flags.finish) game.togglePause(true, { allowPanel: true }); });
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "KeyE") game.interact();
  if (e.code === "KeyM") { sfx.setMuted(!sfx.muted); if (game.paused) $("pSound").textContent = sfx.muted ? "SOUND: OFF" : "SOUND: ON"; }
  if ((e.code === "Escape" || e.code === "KeyP") && game.started && !game.flags.finish) {
    if (game.paused) game.togglePause(false);
    else if (!ui.panelOpen && performance.now() - ui.closedAt > 250) game.togglePause(true);   // Esc that just closed a panel must not also pause
  }
});
window.addEventListener("resize", () => engine.resize());

// ---- main loop ----
let clock = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  clock += dt;
  player.update(dt);
  game.veh.update(dt);
  const ts = game.timeScale();
  let left = dt * ts;
  while (left > 0) { const step = Math.min(1, left); sim.step(step); left -= step; }
  const s = sim.s;
  rig.update(dt, {
    depth: s.depth, startDepth: WELL.startDepth,
    rotating: s.mode === "drilling" && s.wob > 0 && s.rop > 0,
    connecting: s.mode === "connection", tripping: s.mode === "tripping", tripFrac: 0,
    standsRacked: s.standsRacked, night: game.nightFactor, t: clock, pumpsOn: s.mode !== "idle", flaring: true,
  });
  game.update(dt, dt);
  touch?.update();
  sfx.engine(Math.min(1, s.rop / 200));
  // keep the shadow frustum centred on the player
  sun.position = player.pos.subtract(sun.direction.scale(110));
  scene.render();
});
