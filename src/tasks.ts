import { Vector3 } from "@babylonjs/core";
import { rv } from "./rigxf";
import { FOREST_CAMP } from "./outskirts";
import type { Game, Mission } from "./game";
import { F } from "./rig";
import { WELL, FORMATIONS, formationAt } from "./sim";
import type { MiniResult } from "./minigames";

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
const good = (r: MiniResult) => !r.skipped && r.score >= 0.75;
const bad = (r: MiniResult) => !r.skipped && r.score < 0.4;

/**
 * The job chain. Every job has a minigame and a "wing it" shortcut. Shortcuts resolve instantly but register a
 * hidden consequence (a "debt") that may come due later — a short casing tally at TD, a stalled motor, a dropped string.
 */
export function defineMissions(g: Game) {
  const S = g.rig.spots, H = g.rig.humans, sim = g.sim, s = g.sim.s;
  const sy = (sp: Vector3) => () => sp;
  const gap = (n: number) => () => g.sinceDone() >= n;
  const M = (m: Mission) => g.queue.push(m);
  const SD = (m: Mission) => { m.side = true; g.sideList.push(m); };

  // ================================================================ 1. gate sign-in — Simon says
  M({ id: "ppe", title: "Hard Hat Area", sub: "Check in at the gate shack. Safety first. Then second. Then also third.", trigger: () => true, a: 0.1, m: 0, steps: [
    { text: "Sign in at the gate", at: sy(S.gate), label: "Sign in & suit up", r: 3.2, act: (done) => {
      g.mini.signSheet({ eyebrow: "Gate Shack", title: "Sign In", intro: "Roy slides the sign-in sheet under the glass with a pen on a chain. \"Sign on the line. Initial in the box. Stay inside the lines, boss.\"" }, (r) => {
        if (r.skipped) {
          g.shortcutToast("You scribbled something and walked in.");
          g.radio("roy", "That's not a signature, that's a seismograph. …Fine. Go on in.");
          g.addDebt({ id: "ppe", afterMin: 150, chance: 0.7, run: () => { g.radio("roy", "HSE just called. Somebody never really signed the sheet. The auditor has feelings about it.", 9000); g.inc(1, "UNSIGNED SIGN-IN SHEET"); sim.addCost(15000); } });
        } else if (good(r)) g.gain(0.15, 2);
        else if (bad(r)) { g.radio("roy", "That signature is all over the page. Welcome aboard."); g.gain(-0.05, 0); }
        // signed in: now (and only now) he gets a hard hat and safety glasses
        g.player.body.setPPE(true);
        g.ui.toast("PPE ISSUED", "Roy hands you a hard hat and safety glasses.");
        sim.start(); g.radio("earl", "Company Man's on location. Clock's running, boss — and it's about $80,000 a day.");
        done();
      });
    } },
  ] });

  // ================================================================ 4. autodriller — set the limits and engage it
  M({ id: "auto", title: "Set the Autodriller", sub: "Set the autodriller's WOB, ROP, differential-pressure and torque limits, then engage it.", trigger: gap(3), a: 0.35, m: 0, steps: [
    { text: "Set the autodriller limits at the driller's console and engage it", at: sy(S.cabin), label: "Driller's console", r: 3.5, act: () => g.openCabin(), watch: () => s.auto.on },
  ], end: () => g.radio("dale", "Autodriller's in control. I can finally drink my coffee while it's hot. Keep an eye on those limits — it will run right up to every one of them.") });

  // ================================================================ 9. kill the well (unchanged flow; dosing at the hopper)
  M({ id: "kick", title: "Kill the Well", sub: "The well is kicking. Shut it in, record the pressures, weight up to the kill weight and circulate it out through the choke.", trigger: () => s.kick.alarm || s.kick.active || s.kick.shut || s.kill.stage !== "none", priority: true, a: 1.0, m: 10,
    start: () => { g.sfx.horn(); g.ui.toast("KICK!", "Pit gain — flow check!"); g.radio("dale", "PIT GAIN! She's flowing! BOSS — shut it in!", 10000); },
    steps: [
      { text: "Shut in the well at the driller's console", at: sy(S.cabin), label: "Driller's console — SHUT IN", r: 3.5, act: () => g.openCabin(), watch: () => s.kick.shut },
      { text: "Record SIDPP & SICP at the choke panel", at: sy(S.choke), label: "Choke panel", r: 4, act: () => g.openChoke(), watch: () => s.kill.stage === "weightup" || s.kill.stage === "circ" },
      { text: "Weight up to kill weight at the mud hopper", at: sy(S.hopper), label: "Mud hopper", r: 3.8, act: () => g.openHopper(), watch: () => s.mw >= s.kill.kmw - 0.1 && s.kill.kmw > 0 },
      { text: "Circulate the kick out through the choke", at: sy(S.choke), label: "Choke panel — circulate", r: 4, act: () => g.openChoke(), watch: () => s.kill.stage === "flowcheck" },
      { text: "Flow-check and open the BOP at the console", at: sy(S.cabin), label: "Driller's console", r: 3.5, act: () => g.openCabin(), watch: () => s.kill.stage === "none" && !s.kick.shut },
    ], end: () => { g.holdPending = true; } });

  // ================================================================ 11. deer (world chase)
  SD({ id: "deer", auto: () => g.sinceDone() >= 10 && s.depth > 1500 && !g.flags.finish, side: true, title: "Deer on Location", sub: "A deer wandered onto the pad. Nobody has the number for wildlife control. It's now a Company Man issue.", trigger: gap(8), a: 0.3, m: 6,
    start: () => { g.rig.deerNode.setEnabled(true); g.rig.deerNode.position.set(34, 0, -48); g.deer = { target: null, shoo: 0 }; g.radio("marcus", "There's a deer by the tank battery. It's… looking at me. Do deer do that?"); },
    steps: [{ text: "Shoo the deer off location (3 times)", at: () => g.rig.deerNode.position.add(v3(0, 1.3, 0)), label: "Shoo deer", r: 5, act: () => {
      const d = g.deer; d.shoo++; const dp = g.rig.deerNode.position, pp = g.player.pos;
      const away = dp.subtract(pp); away.y = 0; away.normalize();
      // a short hop away from you (9, 12, then 15 m), turning aside from anything too steep to climb or too wet to wade
      const T = g.outskirts.terrain, base = Math.atan2(away.x, away.z), dist = 6 + d.shoo * 3;
      let best: Vector3 | null = null;
      for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4]) {
        const ang = base + da; let ok = true, py = T(dp.x, dp.z);
        for (let k = 1; k <= 6; k++) { const x = dp.x + Math.sin(ang) * dist * k / 6, z = dp.z + Math.cos(ang) * dist * k / 6, y = T(x, z); if (y - py > 0.5 * dist / 6 || y < -0.3 || Math.abs(x) > 60 && Math.abs(x) < 62) { ok = false; break; } py = y; }
        if (ok) { best = v3(dp.x + Math.sin(ang) * dist, 0, dp.z + Math.cos(ang) * dist); break; }
      }
      d.target = best ?? dp.clone(); g.sfx.click();
      const quips = ["You wave your hands. The deer stares.", "You yell 'HYAH!' It takes two steps.", "You throw your hard hat. Not the best idea."];
      g.ui.toast("SHOO!", quips[Math.min(2, d.shoo - 1)]);
    }, watch: () => g.deer.shoo >= 3 && !!g.deer.target && g.rig.deerNode.position.subtract(g.deer.target).length() < 1.5 }],
    end: () => { g.rig.deerNode.setEnabled(false); g.radio("earl", "That deer has more seniority than you at this company, and it still left."); } });

  // ================================================================ 16. ARMAGEDDON (finale)
  M({ id: "armageddon", title: "Save the World", sub: "Drill to TD, then run casing and cement.", trigger: () => g.flags.chainDone === true, a: 1.0, m: 20,
    start: () => { g.hold = null; sim.hold = null; g.radio("dale", "Released the hold. We're drilling to TD, boss.", 8000); },
    steps: [
      { text: "Drill to TD (8,500 ft): set weight at the driller's console", at: sy(S.cabin), label: "Driller's console", r: 3.5, act: () => g.openCabin(), watch: () => s.depth >= WELL.td - 0.5 && (s.mode === "idle" || s.mode === "casing" || s.mode === "done") },   // (casing may already be running or finished by the time the finale begins)
      { text: "Run the casing & cement at the console", at: sy(S.cabin), label: "Driller's console — run casing", r: 3.5, act: () => g.openCabin(), watch: () => s.mode === "casing" || s.mode === "done" },
      { text: "Casing & cement in the hole…", watch: () => s.casing.phase === "done" || s.mode === "done" },
      { text: "Answer the phone (the one in your trailer)", at: sy(S.phone), label: "Answer the phone", r: 3, enter: () => { g.sfx.horn(); g.spawnAsteroid(); g.sim.s.paused = true; g.flags.ringing = true; g.flags.ringT = 0; g.flags.ringLast = 0; g.flags.ringNag = false; g.ui.toast("YOUR PHONE IS RINGING", "Answer it at the phone in your trailer."); g.radio("earl", "Boss, your phone's ringing. Caller ID says… the White House? Pick it up.", 11000); }, act: (done0) => {
        g.flags.ringing = false; const done = () => done0();
        g.say("president", "We are faced with the very gravest of challenges. An asteroid the size of Texas is on a collision course with Earth. NASA's best astronauts can't drill. You're the best Company Man we've got, and you just delivered an 8,500-foot hole under budget-ish.", [
          { label: "Is this covered under the AFE?", cls: "alt", run: () => { g.radio("brent", "It is not. But I'll allow it."); done(); } },
          { label: "Where do I sign?", cls: "green", run: () => { g.radio("earl", "Well, boss. It's been a good tour."); done(); } },
        ], "Incoming call — Priority One");
      } },
      { text: "Board the space shuttle at the helipad", at: sy(S.helipad), label: "Board the shuttle", r: 9, enter: () => { g.finale.callShuttle(); },
        act: (done) => { if (g.rig.shuttleState.phase !== "landed") { g.ui.toast("HOLD ON", "The shuttle is still coming down"); return; } if (g.active) g.active.m.title = "Armageddon"; g.finale.launch(done); } },
      { text: "Get in the Armadillo", at: () => g.finale.armPos, label: "Climb into the Armadillo", r: 5, act: (done) => { g.finale.startDrive(); done(); } },
      { text: "Drive to Harry's rig: hit the ramp fast and hold SPACE for thrusters to jump the canyon", at: () => g.finale.siteTarget(), watch: () => g.finale.arrived },
      { text: "Drill 800 feet at the console", at: () => g.arm.console, label: "Take the driller's seat", r: 4, act: () => g.openArm(), watch: () => g.arm.depth >= 799.5 },
      { text: "The detonator is smashed. Lower the bomb while Harry rigs the manual trigger", at: () => g.finale.holePos(), label: "Lower the bomb", r: 6, act: (done) => { g.finale.startRun(); done(); } },
      { text: "RUN to the Freedom!", at: () => g.finale.shipPos(), watch: () => g.finale.runDone || !!g.flags.finish },
      { text: "Watch the Freedom lift off", watch: () => !!g.flags.finish },
    ] });

  // ================================================================ side: steal Singularity's laser secrets (a run-around, not a sneak)
  SD({ id: "secrets", title: "Steal the Laser", sub: "Singularity's laser drills 14,000 feet in nine minutes. Their rig floor has the schematics. Run in, climb up, grab them, run out. The androids will try to throw you out. Try as many times as it takes.", trigger: () => false, auto: () => g.sinceDone() >= 8 && s.depth > 3500 && !g.flags.finish, a: 0.4, m: 10,
    start: () => { g.flags.raidOn = true; g.flags.secretsGot = false; g.radio("earl", "Don't sneak, they see everything. RUN. Gate, stairs, grab the files, and out again.", 8000); },
    steps: [
      { text: "Run through Singularity's gate", at: () => g.outskirts.gatePos(), watch: () => g.outskirts.inLease() },
      { text: "Climb either staircase to the rig floor (front or back)", at: () => g.outskirts.stairsBase(), watch: () => g.player.pos.y > 7.4 },
      { text: "Grab the secrets from the data terminal on the north side of the floor", at: () => g.outskirts.terminalPos(), watch: () => !!g.flags.secretsGot },
      { text: "RUN for the gate. Don't get caught.", at: () => g.outskirts.gatePos(), watch: () => g.outskirts.outsideGate() },
    ], end: () => { g.flags.raidOn = false; g.flags.laserUnlocked = true; g.flags.laserOn = false; g.radio("dale", "You got the LASER?! Boss, there's a laser switch on the driller's console now. Three hundred feet an hour and the bit never wears. I need to sit down.", 12000); g.ui.toast("LASER DRILLING UNLOCKED", "Driller's console: Switch to LASER drilling."); } });

  // ================================================================ side: derrick inspection with the drone
  SD({ id: "inspect", title: "Derrick Inspection", sub: "Safety wants the mast inspected, and nobody wants to climb it. Fly the drone up the derrick and photograph the five defects.", trigger: () => false, auto: () => g.sinceDone() >= 5 && s.depth > 1200 && !g.flags.finish, a: 0.45, m: 3,
    start: () => { g.flags.inspOn = true; g.flags.inspTags = [false, false, false, false, false]; g.flags.inspDone = false; g.radio("earl", "Safety wants a derrick inspection. Nobody's climbing that mast on my watch. The drone's at the pad by the gate. Fly it up and photograph every defect. They'll be marked in red.", 12000); },
    steps: [
      { text: "Take the drone from its dock by the gate", at: () => { const d = g.veh.list.find((q) => q.kind === "drone"); return d ? v3(d.x, 1.4, d.z) : v3(-20, 1.4, 36); }, watch: () => !!g.veh.active && g.veh.active.kind === "drone" },
      { text: "Fly up the mast and photograph all five defects (get within a few metres of each red marker)", at: () => { const R = g.rig.inspect, tg: boolean[] = g.flags.inspTags ?? []; const i = R.pts.findIndex((_, k) => !tg[k]); return i >= 0 ? R.pts[i] : R.pts[0]; }, watch: () => !!g.flags.inspDone },
      { text: "Bring the drone home (press E)", watch: () => !g.veh.active || g.veh.active.kind !== "drone" },
    ], end: () => { g.flags.inspOn = false; g.rig.inspect.marks.forEach((m) => m.setEnabled(false)); g.radio("earl", "Five defects, all documented. Maintenance will fix three of them. We'll see about the bird.", 8000); } });

  // ================================================================ side: hunting with Hank (you spot, he shoots)
  SD({ id: "hunt", title: "Hunt with Hank", sub: "Hank wants company in the forest. You spot, he shoots. His aim is a known problem.", trigger: () => false, auto: () => !!g.flags.hankFriend && g.sinceDone() >= 8 && s.depth > 3000 && !g.flags.finish, a: 0.3, m: 8,
    start: () => { g.radio("hank" as any, "Company Man. You and me, hunters' camp in the south forest. I shoot, you spot. Don't tell anybody what happens next. Bring your good eyes.", 11000); },
    steps: [
      { text: "Meet Hank at the hunters' camp in the south forest", at: () => v3(FOREST_CAMP.x, 1, FOREST_CAMP.z), label: "Hunters' camp", r: 7, act: (done) => { g.ui.toast("HANK", "About time. Binoculars up."); done(); } },
      { text: "Spot the game for Hank (three of them)", at: () => v3(FOREST_CAMP.x, 1, FOREST_CAMP.z), label: "Spot the game", r: 7, act: (done) => g.mini.reaction({ eyebrow: "The Hunt", title: "Spot the Deer", intro: "Hank is on the rifle. Something moves between the trees. Call it the instant you see it.", rounds: 3, goText: "THERE!" }, (r: any) => {
        if (r && r.skipped) { g.radio("hank" as any, "You didn't see one thing. Not one. The deer saw YOU.", 6000); done(); return; }
        if (r.score >= 0.6) g.radio("hank" as any, "Good eyes. I shot at two of 'em. Neither noticed.", 7000); else g.radio("hank" as any, "You pointed at a bush. I shot the bush. It was a good bush.", 7000);
        setTimeout(() => { g.radio("hank" as any, "…And that's the Henderson's cow. Whoops. That was a good one too. Put it on the rig's tab.", 8000); g.sim.addCost(1800); g.ui.toast("COW DAMAGE", "$1,800 to a neighbour. Hank sends his regards."); }, 7500);
        done(); }) },
    ] });

  // ================================================================ side: windmill shutdown (four turbines, each a lockout / tagout)
  {
    const lo = (title: string, what: () => void, done: () => void, i: number) => g.lockout(title, (mistakes) => {
      what(); g.flags["wm" + i] = true; if (mistakes === 0) { g.gain(0.1, 2); g.radio("earl", "Clean lockout. Zero mistakes. I'd put that on a wall.", 6000); } else { g.sim.addCost(mistakes * 800); g.radio("earl", "You got there. With " + mistakes + " mistake" + (mistakes > 1 ? "s" : "") + ". The incident report is mostly blank.", 6000); }
      done();
    });
    const turb = (i: number, label: string): any => ({ text: "Shut down " + label + " (lockout / tagout)", at: () => g.outskirts.turbinePos(i), label: "Lock out the turbine", r: 4, act: (done: () => void) => lo("Wind Turbine " + (i + 2), () => { g.outskirts.turbs[i].on = false; }, done, i), watch: () => !!g.flags["wm" + i] });
    SD({ id: "windmill", title: "Windmill Shutdown", sub: "The EPA says the company's wind turbines are killing birds. They aren't the company's. Nobody can prove that. Lock them out, one by one.", trigger: () => false, auto: () => g.sinceDone() >= 6 && s.depth > 2200 && !g.flags.finish, a: 0.5, m: 6,
      start: () => { g.radio("earl", "Environmental's on the phone. Four wind turbines across the lease country, all shredding birds, and the paperwork has our name on it. Take a truck. Lock them out. Do it right, they're 1.5 megawatts each.", 13000); },
      steps: [
        { text: "Shut down the turbine west of the lease (lockout / tagout)", at: sy(S.windmill), label: "Lock out the turbine", r: 6, act: (done: () => void) => lo("Wind Turbine 1", () => g.rig.setWindmill(false), done, 9), watch: () => !!g.flags.wm9 },
        turb(0, "the turbine up in the northwest corner"), turb(1, "the turbine out in the southwest flats"), turb(2, "the turbine in the far southeast"),
      ], end: () => { g.radio("brent", "The EPA closed the file. They didn't say why. I'd stop asking.", 8000); } });
  }

  // ================================================================ side: the big catfish
  SD({ id: "sixty", title: "Old Sixty", sub: "Hank has been after a sixty-pound catfish for thirty years. Cast far over the dark water, sink the bait deep, and fight him.", trigger: () => false, auto: () => !!g.flags.hankFriend && g.sinceDone() >= 4 && !g.flags.finish, a: 0.4, m: 10,
    start: () => { g.flags.sixtyOn = true; g.radio("hank" as any, "There's a catfish in my pond. Sixty pounds. Name's Old Sixty. I've been after him thirty years. He lives in the deep water, past five meters. Cast far, and sink it. He'll hit hard.", 12000); },
    steps: [{ text: "Land Old Sixty: cast far over the dark water (hold to charge) and sink the bait past 5 m (R / F)", at: () => v3(-128, 1.2, 190), watch: () => !!g.flags.sixty }],
    end: () => { g.sim.addCost(-0); } });

  g.missionTotal = g.queue.length;
}
