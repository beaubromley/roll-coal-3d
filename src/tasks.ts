import { Vector3 } from "@babylonjs/core";
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

  // ================================================================ 2. safety meeting — spot the hazards
  M({ id: "meeting", title: "Morning Meeting", sub: "Give the safety talk in the doghouse. Nobody will remember it.", trigger: gap(2), a: 0.15, m: 4, steps: [
    { text: "Walk to the rig floor and find the doghouse", at: () => v3(-4.3, F + 1.2, -3.0), label: "Hold the safety meeting", r: 3.5, act: (done) => {
      g.mini.pick({ eyebrow: "Pre-tour meeting", title: "JSA Board", intro: "Earl pins up the job safety analysis for today's tour. Which THREE hazards actually belong on it?", need: 3, options: [
        { label: "Dropped objects", correct: true }, { label: "Pinch points", correct: true }, { label: "Slips, trips & falls", correct: true },
        { label: "Bad vibes", correct: false }, { label: "Brent's emails", correct: false }, { label: "Too much synergy", correct: false },
      ] }, (r) => {
        if (r.skipped) {
          g.shortcutToast("You told the crew to \"be careful\" and called it a JSA.");
          g.radio("earl", "'Be careful.' That's the whole JSA? …Alright. It's your name on it.");
          g.addDebt({ id: "pinch", afterMin: 240, chance: 0.5, run: () => { g.radio("jimbo", "Boss, Dewayne pinched his hand in the tongs. He's fine. He says it's fine.", 9000); g.inc(1, "FIRST AID CASE"); g.gain(0, -5); } });
        } else if (good(r)) { g.gain(0.3, 3); g.radio("earl", "Good JSA. That's the first one I've seen with the right hazards on it."); }
        else { g.gain(0.05, 0); g.radio("earl", "Half right. The other half is a cry for help."); }
        g.geoProg(done);
      });
    } },
  ] });

  // ================================================================ 3. casing — order, then count the joints
  M({ id: "casing", title: "Order Casing", sub: "Houston wants casing on location before TD. It's a phone call for them, a trailer for you.", trigger: gap(3), a: 0.3, m: 0, steps: [
    { text: "Order casing at the computer in your trailer", at: sy(S.desk), label: "Order 9⅝″ casing", r: 3, act: () => g.orderCasing(), watch: () => g.casingOrder > 0 },
    { text: "Wait for the casing truck…", watch: () => sim.s.t - g.orderT >= 50 },
    { text: "Count the casing joints off the truck", at: sy(S.casing), label: "Check the casing tally", r: 5, enter: () => { g.rig.setCasingTruck(true); g.radio("brent", "Casing's on location. Please verify the tally. And be nice to the driver, he's been talking about his boat since Pecos."); }, act: (done) => {
      g.mini.rhythm({ eyebrow: "Casing Tally", title: "Count the Joints", intro: "The driver is unloading joints one at a time. Hit COUNT as each one crosses the tally line.", count: 12, unit: "joints" }, (r) => {
        const short = g.casingOrder < 212;
        if (r.skipped) {
          g.shortcutToast("You signed the ticket without counting.");
          g.radio("earl", "Signed. Whatever's on that truck is now the company's problem. Yours, specifically.");
          g.addDebt({ id: "tally", atDepth: 8200, chance: short ? 1 : 0.6, run: () => { g.radio("brent", "The casing is SIX joints short. Hot-shot truck from Odessa. Somebody signed this tally.", 11000); sim.addCost(60000); sim.s.t += 360; g.inc(1, "SHORT CASING TALLY"); } });
        } else if (good(r)) { g.gain(0.3, 0); g.radio("marcus", "Every joint. He was one over. You counted it. He'll never forgive you."); }
        else { g.gain(0.1, 0); g.radio("marcus", `You counted ${r.value} of 12. Close enough for a Company Man.`); if ((r.value ?? 12) < 10) g.addDebt({ id: "tally2", atDepth: 8200, chance: 0.7, run: () => { g.radio("brent", "We're a couple of joints short at TD. Your tally said otherwise.", 9000); sim.addCost(24000); } }); }
        done();
      });
    } },
  ] });

  // ================================================================ 4. autodriller — drill-off, then set points
  M({ id: "auto", title: "Set the Autodriller", sub: "Find the right weight with a drill-off test, then set the autodriller's WOB, ROP and differential-pressure limits.", trigger: gap(3), a: 0.35, m: 0, steps: [
    { text: "Run a drill-off test at the driller's console", at: sy(S.cabin), label: "Drill-off test", r: 3.5, act: (done) => {
      g.say("dale", "Autodriller's off and we're drilling by the seat of our pants. Want a drill-off test to find the sweet spot? Or do you just want to guess the weights?", [
        { label: "Run the test", cls: "green", run: () => g.mini.drillOff((r) => {
          if (r.skipped) wingAuto(); else { const w = Math.round(r.value ?? 28); g.radio("dale", r.score > 0.7 ? `Knee's around ${w}. That tracks with what I'm feeling in the brake.` : `You're calling it ${w}. Okay. I'll… write that down.`); if (r.score < 0.4) g.flags.drillOffWopt = Math.round((r.value ?? 28)); }
          done();
        }) },
        { label: "Just guess", cls: "alt", run: () => { wingAuto(); done(); } },
      ], "Autodriller");
      function wingAuto() {
        g.shortcutToast("No test. You're guessing the set points.");
        g.radio("dale", "Guess it is. Whatever you give me, I'm running.");
        g.addDebt({ id: "wingauto", afterMin: 200, chance: 0.6, run: () => g.forceStall("MOTOR STALLED. Whoever picked those set points didn't run a drill-off, and the motor has opinions.") });
      }
    } },
    { text: "Set the autodriller set points and engage it", at: sy(S.cabin), label: "Driller's console", r: 3.5, act: () => g.openCabin(), watch: () => s.auto.on },
  ], end: () => g.radio("dale", "Autodriller's in control. I can finally drink my coffee while it's hot.") });

  // ================================================================ 5. shakers — ID the cuttings, then swap the screens
  M({ id: "shakers", title: "Check the Shakers", sub: "Climb the pit roof, identify the cuttings, and swap the torn screen.", trigger: gap(3), a: 0.2, m: 3, steps: [
    { text: "Climb the tanks and look at the shale shakers", at: sy(S.shakers), label: "Shale shakers", r: 3.8, act: (done) => {
      const cur = formationAt(s.depth).name;
      const others = FORMATIONS.map((f) => f.name).filter((n) => n !== cur);
      const opts = [{ label: cur, correct: true }, ...others.sort(() => Math.random() - 0.5).slice(0, 3).map((n) => ({ label: n, correct: false }))];
      g.mini.pick({ eyebrow: "Shale Shakers", title: "Identify the Cuttings", intro: "Marcus holds up a handful of wet cuttings. What formation is the bit in right now? (Check the mud logger if you're not sure.)", need: 1, options: opts }, (r) => {
        const swap = () => g.mini.sequence({ eyebrow: "Shale Shakers", title: "Swap the Screen", intro: "The center screen is torn. Unbolt the corners in the order Marcus calls them, then slide in the new one.", labels: ["NW", "NE", "SE", "SW"], length: 4 }, (r2) => {
          if (r2.skipped) { skip(); } else { g.flags.screenTorn = false; g.flags.screensFixed = true; sim.addCost(1200); if (good(r2)) g.gain(0.2, 2); }
          g.flags.shakersLooked = true; done();
        });
        if (r.skipped) { skip(); g.flags.shakersLooked = true; done(); return; }
        if (bad(r)) g.radio("marcus", "That's not even the right formation. Look at the color."); else if (good(r)) g.radio("marcus", `${cur}. Yep. You'd make a decent mud engineer.`);
        swap();
      });
      function skip() {
        g.shortcutToast("You told Marcus the screens looked fine.");
        g.radio("marcus", "Looks fine to you? Okay, it's your mud. …I'll note that.");
        g.flags.screenTorn = false;                       // mission can finish, but the screen is still torn
        g.addDebt({ id: "screens", atDepth: s.depth + 700, chance: 0.65, run: () => { g.radio("marcus", "Torn screen just dumped barite over the shaker. We lost about 120 barrels of mud.", 10000); s.pit = Math.max(150, s.pit - 120); sim.addCost(30000); } });
      }
    }, watch: () => !!g.flags.shakersLooked },
  ], end: () => g.radio("marcus", "Screens handled. That's four more tasks than the last Company Man ever did.") });

  // ================================================================ 6. interns
  const internSkip = (done: () => void) => {
    g.shortcutToast("You waved the interns on without a briefing.");
    g.radio("tyler", "So we can just… go anywhere? Cool.");
    g.addDebt({ id: "intern", afterMin: 60, chance: 0.6, run: () => { g.radio("earl", "Your intern is standing on the rotary table. In the red zone. Taking a selfie.", 9000); g.inc(1, "NEAR MISS: INTERN IN THE RED ZONE"); } });
    done();
  };
  M({ id: "interns", title: "Intern Tour", sub: "HR says: keep them alive, keep them off the rig floor, and never say 'figure it out.'", trigger: gap(3), a: 0.35, m: 5,
    start: () => { g.spawnInterns(); g.radio("brent", "Three summer interns are walking out to you. Please give them 'the full experience.' Please don't."); },
    steps: [
      { text: "Tour stop 1: the pipe racks", at: sy(S.tally), label: "Give the tour: pipe racks", r: 5, act: (done) => g.tourStop("tyler", "Stop 1 — Pipe racks", "'Is this where they keep the straws?'", [["Yes. Very big straws.", "Tyler writes that down. He does not realize it is a joke.", 0.05, 4], ["It's drill pipe. 30 feet each, 4 inches around.", "Tyler: 'That's what she said' — and then looks at Madison, who doesn't laugh.", 0.15, 1]], done) },
      { text: "Tour stop 2: the BOP stack — quiz them", at: sy(S.bop), label: "Give the tour: the BOP", r: 6, act: (done) => g.mini.pick({ eyebrow: "Intern Tour — Stop 2", title: "Pop Quiz", intro: "Madison asks: \"So what does a BOP actually do?\" Pick the right answer for the interns.", need: 1, options: [
        { label: "Seals the well if it kicks", correct: true }, { label: "Holds the mast up", correct: false }, { label: "Keeps the mud warm", correct: false }, { label: "It's mostly decorative", correct: false } ] }, (r) => {
        if (r.skipped) return internSkip(done);
        if (good(r)) { g.gain(0.2, 3); g.radio("tyler", "Seals the well. Got it. Brayden is touching it."); } else { g.gain(-0.05, 0); g.radio("tyler", "Wait, so it IS decorative?"); }
        done(); }) },
      { text: "Tour stop 3: the rig floor", at: () => v3(2.3, F + 1.0, 2.6), label: "Give the tour: drill floor", r: 4, act: (done) => g.tourStop("tyler", "Stop 3 — Drill floor", "'Can I push the big red button?'", [["No. There's no button. It's a rotary table.", "Brayden: 'So it IS a button.' You let it go.", 0.1, 2], ["Sure. Press it.", "The fire alarm goes off. For three seconds. Everyone looks at you.", -0.15, 6]], done) },
      { text: "Tour stop 4: muster point — head count", at: sy(S.muster), label: "Give the tour: muster", r: 5, act: (done) => g.mini.whack({ eyebrow: "Intern Tour — Stop 4", title: "Head Count", intro: "Muster drill! The interns won't hold still. Tap each intern to count them before the time runs out.", label: "intern", count: 3, seconds: 11 }, (r) => {
        if (r.skipped) return internSkip(done);
        if (good(r)) { g.gain(0.25, 4); g.radio("tyler", "Three. All present. I did not know it was a game."); } else { g.gain(0, 0); g.radio("earl", "You lost an intern at a muster drill. Impressive."); g.inc(1, "MISSING HEAD AT MUSTER"); }
        done(); }) },
    ], end: () => g.despawnInterns() });

  // ================================================================ 7. porta john — slips + stuck latch
  M({ id: "porta", title: "Porta John Standoff", sub: "Both floorhands are locked in the porta john. A connection is coming. Somebody has to pull the slips.", trigger: gap(3), a: 0.4, m: 6,
    start: () => { g.rig.setPortaLocked(true); H.hand1.root.setEnabled(false); H.hand2.root.setEnabled(false); g.radio("dale", "BOSS! Jimbo and Dewayne are locked in the porta john and we've got a connection coming! I can't leave the brake — somebody's gotta pull the slips!", 11000); },
    steps: [
      { text: "Go to the drill floor and pull the slips", at: () => v3(1.9, F + 1.0, 1.4), label: "Pull the slips", r: 4, act: (done) => g.mini.slips((r) => {
        if (r.skipped) {
          g.shortcutToast("You eyeballed the slips and waved Dale on.");
          g.radio("dale", "You sure? That wasn't set. …Okay. It's your pipe.");
          g.addDebt({ id: "slips", afterMin: 45, chance: 0.5, run: () => { g.radio("dale", "WE DROPPED THE STRING! The pipe walked right through the slips! Fishing job, boss!", 11000); sim.addCost(120000); sim.s.t += 300; sim.s.stats.npt += 5; g.inc(1, "DROPPED PIPE IN THE HOLE"); } });
        } else if (good(r)) g.gain(0.2, 2);
        done(); }) },
      { text: "Free the floorhands from the porta john", at: sy(S.porta), label: "Open the porta john", r: 3, act: (done) => g.mini.mash({ eyebrow: "Porta John", title: "Jammed Latch", intro: "\"The latch just… jammed. Both of us. At the same time. On the same trip.\" Rattle it loose.", seconds: 9, label: "the latch is stuck hard." }, (r) => {
        const free = () => { g.rig.setPortaLocked(false); H.hand1.root.setEnabled(true); H.hand2.root.setEnabled(true); };
        if (r.skipped) { free(); g.shortcutToast("You kicked the door in."); g.radio("jimbo", "You KICKED it? That's a $2,000 door, boss. Dewayne is crying a little."); sim.addCost(2000); g.gain(-0.1, -6); }
        else if (r.score > 0.3) { free(); g.gain(0.2, 8); g.radio("jimbo", "Dewayne says nobody saw anything. I say nobody saw anything."); }
        else { free(); g.radio("jimbo", "Took you the whole break, boss. We were gonna just wait."); g.gain(0, 2); }
        done(); }) },
    ] });

  // ================================================================ 8. weight up before the Delaware (hopper dosing)
  M({ id: "weightup", title: "Weight Up Before the Delaware", sub: "Pore pressure jumps at 6,000 ft. Get the mud to at least 10.9 ppg or the well will tell you about it.", trigger: () => s.depth >= 4650, priority: true, a: 0.5, m: 0,
    start: () => g.radio("marcus", "We're three-quarters of a mile from the Delaware. Pore pressure's 10.8 down there. Get ten-nine in the pits before six thousand. Feed barite at the hopper — hold the button and let go on the mark.", 12000),
    steps: [{ text: "Weight up the mud at the hopper (≥ 10.9 ppg)", at: sy(S.hopper), label: "Mud hopper", r: 3.8, act: () => g.openHopper(), watch: () => s.mw >= 10.85 || s.depth >= 6150 }],
    end: () => { if (s.mw < 10.85) g.radio("marcus", "You didn't make it. We'll find out what the formation thinks."); else { g.gain(0.4, 0); g.radio("marcus", "Mud's 10.9. We're ready for the Delaware. Mostly."); } } });

  // ================================================================ 9. kill the well (unchanged flow; dosing at the hopper)
  M({ id: "kick", title: "Kill the Well", sub: "The well is kicking. Shut it in, read the pressures, calculate the kill weight, weight up and circulate it out through the choke.", trigger: () => s.kick.alarm || s.kick.active || s.kick.shut || s.kill.stage !== "none", priority: true, a: 1.0, m: 10,
    start: () => { g.sfx.horn(); g.ui.toast("KICK!", "Pit gain — flow check!"); g.radio("dale", "PIT GAIN! She's flowing! BOSS — shut it in!", 10000); },
    steps: [
      { text: "Shut in the well at the driller's console", at: sy(S.cabin), label: "Driller's console — SHUT IN", r: 3.5, act: () => g.openCabin(), watch: () => s.kick.shut },
      { text: "Record SIDPP & SICP at the choke panel", at: sy(S.choke), label: "Choke panel", r: 4, act: () => g.openChoke(), watch: () => s.kill.stage === "calc" || s.kill.stage === "weightup" || s.kill.stage === "circ" },
      { text: "Calculate the kill mud weight", at: sy(S.choke), label: "Choke panel", r: 4, act: () => g.openChoke(), watch: () => s.kill.stage === "weightup" || s.kill.stage === "circ" },
      { text: "Weight up to kill weight at the mud hopper", at: sy(S.hopper), label: "Mud hopper", r: 3.8, act: () => g.openHopper(), watch: () => s.mw >= s.kill.kmw - 0.1 && s.kill.kmw > 0 },
      { text: "Circulate the kick out through the choke", at: sy(S.choke), label: "Choke panel — circulate", r: 4, act: () => g.openChoke(), watch: () => s.kill.stage === "flowcheck" },
      { text: "Flow-check and open the BOP at the console", at: sy(S.cabin), label: "Driller's console", r: 3.5, act: () => g.openCabin(), watch: () => s.kill.stage === "none" && !s.kick.shut },
    ], end: () => { g.holdPending = true; } });

  // ================================================================ 10. coffee — pour to the line
  M({ id: "coffee", title: "Coffee Crisis", sub: "Morale on this rig is a direct function of caffeine. The pot is empty.", trigger: gap(10), a: 0.2, m: 8,
    start: () => { g.flags.coffeeEmpty = true; g.radio("earl", "Pot's empty. Whoever took the last cup didn't refill it. Which means it was one of you.", 9000); },
    steps: [
      { text: "Brew a fresh pot in the doghouse", at: sy(S.coffee), label: "Brew coffee", r: 3, act: (done) => g.mini.holdFill({ eyebrow: "Doghouse", title: "Fill the Pot", intro: "The rig runs on diesel. The crew runs on this. Hold to pour water, release on the fill line.", unit: "cups", max: 14, target: 10, band: 0.9, rate: 0.3, hold: "HOLD TO POUR" }, (r) => {
        g.flags.coffeeEmpty = false;
        if (r.skipped) { g.shortcutToast("Instant coffee. Don't tell anyone."); g.gain(0, 2); g.addDebt({ id: "coffee", afterMin: 90, chance: 0.65, run: () => { g.radio("earl", "This coffee tastes like regret and powder. Morale is dropping.", 8000); g.gain(-0.2, -6); } }); }
        else if (good(r)) { g.gain(0.1, 5); g.radio("marcus", "Perfect pot. Dark. Like my soul."); }
        else if ((r.value ?? 0) > 10) { g.radio("marcus", "Watery. We'll call it tea."); g.gain(0, -1); } else { g.radio("marcus", "Thick enough to stand a spoon in."); g.gain(0, 1); }
        done(); }) },
      { text: "Deliver a cup to Earl", at: () => H.pusher.root.position.add(v3(0, 1.2, 0)), label: "Give Earl his coffee", r: 3.5, act: (done) => {
        g.say("earl", "…This is decaf.", [{ label: "It's the good decaf.", run: () => { g.gain(0.1, 6); done(); } }, { label: "Marcus used the good creamer.", cls: "alt", run: () => { g.gain(0.1, 4); g.radio("marcus", "I did not use the good creamer."); done(); } }], "Coffee");
      } },
    ] });

  // ================================================================ 11. deer (world chase)
  M({ id: "deer", title: "Deer on Location", sub: "A deer wandered onto the pad. Nobody has the number for wildlife control. It's now a Company Man issue.", trigger: gap(8), a: 0.3, m: 6,
    start: () => { g.rig.deerNode.setEnabled(true); g.rig.deerNode.position.set(34, 0, -48); g.deer = { target: null, shoo: 0 }; g.radio("marcus", "There's a deer by the tank battery. It's… looking at me. Do deer do that?"); },
    steps: [{ text: "Shoo the deer off location (3 times)", at: () => g.rig.deerNode.position.add(v3(0, 1.3, 0)), label: "Shoo deer", r: 5, act: () => {
      const d = g.deer; d.shoo++; const dp = g.rig.deerNode.position, pp = g.player.pos;
      const away = dp.subtract(pp); away.y = 0; away.normalize();
      d.target = dp.add(away.scale(14 + d.shoo * 6)); g.sfx.click();
      const quips = ["You wave your hands. The deer stares.", "You yell 'HYAH!' It takes two steps.", "You throw your hard hat. Not the best idea."];
      g.ui.toast("SHOO!", quips[Math.min(2, d.shoo - 1)]);
    }, watch: () => g.deer.shoo >= 3 && !!g.deer.target && g.rig.deerNode.position.subtract(g.deer.target).length() < 1.5 }],
    end: () => { g.rig.deerNode.setEnabled(false); g.radio("earl", "That deer has more seniority than you at this company, and it still left."); } });

  // ================================================================ 12. snake — reaction test
  M({ id: "snake", title: "Rattlesnake in the Doghouse", sub: "It's under the table. The crew is standing on the benches. Someone has to go in there.", trigger: gap(8), a: 0.3, m: 6,
    start: () => { g.spawnSnake(); g.radio("jimbo", "BOSS. There's a snake in the doghouse. It's a rattler. It's rattling.", 9000); },
    steps: [{ text: "Go to the doghouse and deal with the snake", at: () => v3(-4.3, F + 0.6, -3.2), label: "Handle the snake", r: 3.5, act: (done) => g.mini.reaction({ eyebrow: "Doghouse", title: "Snake Dance", intro: "It's coiled, and it's watching you. Wait for the strike, then jump back. Don't flinch early.", rounds: 3, goText: "STRIKE!" }, (r) => {
      const bite = (why: string) => { g.radio("jimbo", why, 8000); g.inc(1, "SNAKEBITE — FIRST AID"); sim.addCost(12000); g.gain(0, -4); };
      if (r.skipped) { g.shortcutToast("You decided to just walk past it."); g.radio("earl", "Walking past a rattlesnake. Bold."); g.addDebt({ id: "bite", afterMin: 15, chance: 0.5, run: () => bite("It got you in the boot, boss. The BOOT. Count your blessings.") }); }
      else if (good(r)) { g.gain(0.4, 4); g.radio("earl", "Dodged it. Sent it out with a broom. The crew's cheering."); }
      else if (bad(r)) bite("It got your ankle. You're fine. The boot is not.");
      else { g.gain(0.1, 2); g.radio("jimbo", "You got it out, but it took two tries and a lot of yelling."); }
      done(); }) }],
    end: () => g.despawnSnake() });

  // ================================================================ 13. gender reveal — cut the wire
  M({ id: "reveal", title: "Gender Reveal", sub: "A floorhand has brought a smoke cannon to the pipe deck. Nobody knows who approved it. Nobody did.", trigger: gap(8), a: 0.3, m: 10,
    steps: [{ text: "Defuse the gender reveal on the pipe deck", at: () => H.hand3.root.position.add(v3(0, 1.4, 0)), label: "Talk to Jimbo", r: 5, act: (done) => g.mini.wires({ eyebrow: "Stop Work Authority", title: "Cut the Wire", intro: "Jimbo's smoke cannon has a timer on it. He taped the instructions to the side.", fixed: true,
      clue: "\"Cut the trigger wire. It is NOT red, NOT blue, and NOT next to the green one.\"",
      colors: [{ name: "YELLOW", hex: "#e8c423", correct: true }, { name: "RED", hex: "#d63a2b", correct: false }, { name: "GREEN", hex: "#2f9a45", correct: false }, { name: "BLUE", hex: "#2f6fd6", correct: false }] }, (r) => {
      if (r.skipped) { g.shortcutToast("You just confiscated the cannon."); g.radio("jimbo", "You TOOK it? Boss, that's my sister-in-law's whole thing."); g.gain(0.05, -8); g.addDebt({ id: "cannon", afterMin: 100, chance: 0.5, run: () => { g.ui.toast("IT'S A… PIPE WRENCH?", "Blue smoke everywhere."); g.sfx.horn(); g.radio("marcus", "Somebody fired the confetti cannon at shift change. The H2S monitor went off. It's fine. It's fine.", 9000); g.inc(1, "UNAUTHORIZED PYROTECHNICS"); g.gain(-0.2, 8); } }); }
      else if (r.score >= 1) { g.gain(0.4, 4); g.radio("earl", "Good stop. The guy still wants the party. Can he just have cake?"); }
      else { g.ui.toast("IT'S A… PIPE WRENCH?", "Blue smoke everywhere."); g.sfx.horn(); g.radio("marcus", "The H2S monitor just went off. It's confetti. It's fine. It's fine."); g.gain(-0.4, 14); g.inc(1); }
      done(); }) }] });

  // ================================================================ 14. VP fly-in — keep his hands off the controls
  M({ id: "vp", title: "VP Fly-In", sub: "Chadwick from Houston is landing on the pad in a helicopter. In loafers. He wants to 'touch the rig.'", trigger: gap(8), a: 0.5, m: -5,
    start: () => { g.rig.heliState.node.setEnabled(true); g.rig.heliState.node.position.set(70, 80, 60); g.rig.heliState.phase = "landing"; g.radio("brent", "Chadwick's flying out. Today. He wants a 'quick walk-around.' Please have the rig look like it's going well.", 10000); },
    steps: [
      { text: "Meet Chadwick at the helipad", at: sy(S.helipad), label: "Greet the VP", r: 6, act: (done) => {
        H.vp.root.setEnabled(true);
        g.say("chad", "Great to be out in the field! Love the 'oil'. Where's my hard hat? I don't see a hard hat.", [
          { label: "Hand him your spare hard hat & vest", cls: "green", run: () => { g.gain(0.3, 0); done(); } },
          { label: "Send him to the gate for PPE", cls: "alt", run: () => { g.gain(-0.3, 4); g.radio("roy", "Is the VP here for a tour? He didn't sign in."); done(); } },
        ], "VP of Operations");
      } },
      { text: "Take Chadwick to the console — keep his hands off the controls", at: sy(S.cabin), label: "Show Chadwick the console", r: 3.5, act: (done) => g.mini.whack({ eyebrow: "VP of Operations", title: "Hands Off", intro: "Chadwick keeps reaching for the autodriller. Tap each reaching hand before it touches a control.", label: "reach", count: 6, seconds: 10 }, (r) => {
        const optimize = () => { const prev = s.wobTarget, wasAuto = s.auto.on; s.auto.on = false; s.wobTarget = 80; g.radio("dale", "EIGHTY?! He turned OFF the autodriller! BOSS! THE BIT IS CRYING!", 9000); sim.addCost(15000); setTimeout(() => { s.wobTarget = prev; s.auto.on = wasAuto; }, 10000); g.gain(0.1, -6); };
        if (r.skipped) { g.shortcutToast("You let Chadwick poke around. What could go wrong."); g.say("chad", "I'm increasing WOB to eighty for synergy.", [{ label: "…sure", cls: "red", run: () => { optimize(); done(); } }], "VP of Operations"); return; }
        if (good(r)) { g.gain(0.4, 3); g.radio("chad", "Oh these are good cookies. Who makes these? Let's scale this."); } else { optimize(); }
        done(); }) },
      { text: "Send Chadwick back to the helicopter", at: sy(S.helipad), label: "Walk Chadwick out", r: 6, act: (done) => {
        g.say("chad", "Fantastic visit. Super impressive. I have no idea what any of it does. Let's circle back.", [{ label: "Wave goodbye", run: () => { g.rig.heliState.phase = "leaving"; H.vp.root.setEnabled(false); done(); } }], "VP of Operations");
      } },
    ] });

  // ================================================================ 15. Houston — type the buzzwords
  M({ id: "houston", title: "Houston Calls", sub: "The office wants 'a quick one-pager' and 'a few bullets' — at 3 a.m., mid-sentence, on a Sunday.", trigger: gap(8), a: 0.4, m: -4,
    start: () => { g.flags.houstonPending = true; g.sfx.horn(); g.radio("earl", "Your phone in the trailer won't stop ringing. It's Houston. It's always Houston.", 9000); },
    steps: [{ text: "Answer the phone in your trailer", at: sy(S.phone), label: "Answer the phone", r: 3, watch: () => !!g.flags.houstonDone, act: () => g.say("brent", "Hey! Quick one. I need the one-pager typed into the system — word for word, the VP is very particular about the language. Can you do that right now, live?", [
      { label: "Fine. Go.", cls: "green", run: () => g.mini.typing({ eyebrow: "Houston", title: "The One-Pager", intro: "Type Brent's approved language exactly as written.", text: "We will leverage synergies to deliver value at scale", seconds: 16 }, (r) => {
        if (r.skipped) { g.shortcutToast("\"I'll send it later.\""); g.radio("brent", "Later. Okay. Great. I'll put a pin in it."); g.gain(-0.1, 0); g.addDebt({ id: "onepager", afterMin: 50, chance: 0.8, run: () => { g.radio("brent", "Just following up on the one-pager. Also following up on following up. Also the VP is cc'd.", 10000); g.gain(-0.4, -5); } }); }
        else if (good(r)) { g.gain(0.35, 0); g.radio("brent", "Flawless. Not a single typo. I'm forwarding this to people who don't read."); }
        else { g.gain(0.05, -2); g.radio("brent", "There are typos. Bring it to the Tuesday call."); }
        g.flags.houstonDone = true; }) },
      { label: "I'll send it later", cls: "alt", run: () => { g.shortcutToast("\"I'll send it later.\""); g.radio("brent", "Later. Okay. Great. I'll put a pin in it."); g.addDebt({ id: "onepager", afterMin: 50, chance: 0.8, run: () => { g.radio("brent", "Just following up on the one-pager. Also following up on following up. Also the VP is cc'd.", 10000); g.gain(-0.4, -5); } }); g.flags.houstonDone = true; } },
    ], "Houston") }],
    end: () => { g.flags.houstonPending = false; } });

  // ================================================================ 16. ARMAGEDDON (finale)
  M({ id: "armageddon", title: "Armageddon", sub: "Drill to TD, set casing, and then — apparently — save the planet.", trigger: () => g.flags.chainDone === true, a: 1.0, m: 20,
    start: () => { g.hold = null; sim.hold = null; g.radio("dale", "Released the hold. We're drilling to TD, boss.", 8000); },
    steps: [
      { text: "Drill to TD (8,500 ft)", watch: () => s.depth >= WELL.td - 0.5 && s.mode === "idle" },
      { text: "Run the casing & cement at the console", at: sy(S.cabin), label: "Driller's console — run casing", r: 3.5, act: () => g.openCabin(), watch: () => s.mode === "casing" || s.mode === "done" },
      { text: "Casing & cement in the hole…", watch: () => s.casing.phase === "done" || s.mode === "done" },
      { text: "Answer the phone in your trailer", at: sy(S.phone), label: "Answer the phone", r: 3, enter: () => { g.sfx.horn(); g.spawnAsteroid(); g.sim.s.paused = true; g.radio("earl", "Phone's ringing in your trailer. Caller ID says… the White House?", 9000); }, act: (done) => {
        g.say("president", "We are faced with the very gravest of challenges. An asteroid the size of Texas is on a collision course with Earth. NASA's best astronauts can't drill. You're the best Company Man we've got, and you just delivered an 8,500-foot hole under budget-ish.", [
          { label: "Is this covered under the AFE?", cls: "alt", run: () => { g.radio("brent", "It is not. But I'll allow it."); done(); } },
          { label: "Where do I sign?", cls: "green", run: () => { g.radio("earl", "Well, boss. It's been a good tour."); done(); } },
        ], "Incoming call — Priority One");
      } },
      { text: "Board the helicopter at the helipad", at: sy(S.helipad), label: "Board the helicopter", r: 7, enter: () => { g.rig.heliState.node.setEnabled(true); g.rig.heliState.node.position.set(70, 80, 60); g.rig.heliState.phase = "landing"; g.radio("president", "A chopper is en route. Godspeed, Company Man.", 8000); },
        act: (done) => { if (g.rig.heliState.phase !== "landed") { g.ui.toast("HOLD ON", "The helicopter is still landing"); return; } g.callUp(done); } },
      { text: "Walk to the drill console on the asteroid", at: () => g.arm.console, label: "Take the driller's seat", r: 4, act: () => g.openArm(), watch: () => g.arm.depth > 0 },
      { text: "Drill 800 feet through the asteroid", watch: () => g.arm.depth >= 800 },
      { text: "Plant the bomb and detonate", at: () => g.arm.console, label: "Detonate", r: 4, act: () => g.openArm() },
    ] });

  g.missionTotal = g.queue.length;
}
