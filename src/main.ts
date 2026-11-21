import {
  Engine, Scene, Color4, Color3, Vector3, HemisphericLight, DirectionalLight, ShadowGenerator, GlowLayer, Mesh,
} from "@babylonjs/core";
import { buildRig } from "./rig";
import { Player } from "./player";
import { Sim, WELL } from "./sim";
import { Sfx } from "./audio";
import { UI, $ } from "./ui";
import { Game } from "./game";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, antialias: true }, true);
engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio > 1.5 ? 1.25 : 1));
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

const rig = buildRig(scene);
const player = new Player(scene, canvas, rig.colliders);
const sim = new Sim();
const sfx = new Sfx();
const ui = new UI();
const game = new Game(scene, rig, player, sim, sfx, ui, { hemi, sun });
(window as any).__game = { game, sim, player, rig, scene };

// shadows
const sg = new ShadowGenerator(2048, sun);
sg.usePercentageCloserFiltering = true;
sg.bias = 0.0006; sg.normalBias = 0.02;
sg.transparencyShadow = false;
rig.merged.forEach((m: Mesh) => sg.addShadowCaster(m));
player.body.setShadow(sg);
Object.values(rig.humans).forEach((h) => h.setShadow(sg));
scene.meshes.forEach((m) => { if (m.name === "ground" || m.name === "padmesh" || m.name === "road") m.receiveShadows = true; });

const glow = new GlowLayer("glow", scene, { mainTextureFixedSize: 512, blurKernelSize: 24 });
glow.intensity = 0.45;

// spawn at the lease-road gate looking at the rig
player.teleport(0, 0.5, 112, Math.PI);

// ---- start / intro ----
$("loading").style.display = "none";
$("intro").style.display = "grid";
$("startBtn").addEventListener("click", () => {
  sfx.init();
  $("intro").style.display = "none";
  $("hud").style.display = "block";
  game.started = true;
  player.lock();
  ui.toast("ROLL COAL, MAKE HOLE", "Walk to the gate shack and sign in.");
});
canvas.addEventListener("click", () => { if (game.started && !ui.panelOpen) player.lock(); });
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyE" && !e.repeat) game.interact();
  if (e.code === "KeyM" && !e.repeat) sfx.setMuted(!sfx.muted);
});
window.addEventListener("resize", () => engine.resize());

// ---- main loop ----
let clock = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  clock += dt;
  player.update(dt);
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
  sfx.engine(Math.min(1, s.rop / 200));
  // keep the shadow frustum centred on the player
  sun.position = player.pos.subtract(sun.direction.scale(110));
  scene.render();
});
