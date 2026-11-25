import { Vector3 } from "@babylonjs/core";
import { rv } from "./rigxf";
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

  // ================================================================ side: the big catfish
  SD({ id: "sixty", title: "Old Sixty", sub: "Hank has been after a sixty-pound catfish for thirty years. Cast far over the dark water, sink the bait deep, and fight him.", trigger: () => false, auto: () => !!g.flags.hankFriend && g.sinceDone() >= 4 && !g.flags.finish, a: 0.4, m: 10,
    start: () => { g.flags.sixtyOn = true; g.radio("hank" as any, "There's a catfish in my pond. Sixty pounds. Name's Old Sixty. I've been after him thirty years. He lives in the deep water, past five meters. Cast far, and sink it. He'll hit hard.", 12000); },
    steps: [{ text: "Land Old Sixty: cast far over the dark water (hold to charge) and sink the bait past 5 m (R / F)", at: () => v3(-128, 1.2, 190), watch: () => !!g.flags.sixty }],
    end: () => { g.sim.addCost(-0); } });

  g.missionTotal = g.queue.length;
}
