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

  // ================================================================ 2. morning meeting — a logic puzzle: who goes where
  M({ id: "meeting", title: "Morning Meeting", sub: "Work out who goes where on today's tour. Everyone has opinions about it.", trigger: gap(2), a: 0.15, m: 4, steps: [
    { text: "Walk to the rig floor and find the doghouse", at: () => rv(-4.3, F + 1.2, -3.0), label: "Plan the tour", r: 3.5, act: (done) => {
      g.mini.assign({ eyebrow: "Pre-tour meeting", title: "Crew Assignments", intro: "Earl slaps four names and four stations on the whiteboard and walks off. \"Make it work.\" Use the clues.",
        people: ["Dale (driller)", "Earl (toolpusher)", "Marcus (mud engineer)", "Jimbo (floorhand)"], slots: ["The brake", "The rig floor", "The mud pits", "The pipe deck"], solution: [0, 1, 2, 3],
        clues: [
          "Dale won't carry pipe or stand in mud.",
          "Earl would never run the brake. \"Not my job.\"",
          "Jimbo's back is bad: no rig floor, no mud pits.",
          "Marcus is allergic to grease: not the rig floor, not the pipe deck, and he can't run the brake.",
          "Whoever is on the rig floor is not the driller.",
        ] }, (r) => {
        if (r.skipped) {
          g.shortcutToast("You pointed at names at random and called it a plan.");
          g.radio("earl", "Marcus is on the pipe deck? He's allergic to… never mind. It's your whiteboard.");
          g.addDebt({ id: "pinch", afterMin: 240, chance: 0.55, run: () => { g.radio("jimbo", "Boss, Dewayne pinched his hand in the tongs. Nobody put the right person on the pipe deck. He's fine. He says it's fine.", 9000); g.inc(1, "FIRST AID CASE"); g.gain(0, -5); } });
        } else if (good(r)) { g.gain(0.3, 3); g.radio("earl", "That actually works. Dale on the brake, me on the floor, Marcus in his mud. Nobody's allergic to anything."); }
        else { g.gain(0.05, 0); g.radio("earl", "Fine. I fixed it. Don't make me redo your whiteboard."); }
        g.radio("earl", "Watch the Delaware at 6,000 ft: pore 10.8, frac 12.0. There may be a gas stringer past 7,000. Weight up before we get there.", 12000);
        done();
      });
    } },
  ] });

  // ================================================================ 3. casing — pack the truck, then count what showed up
  M({ id: "casing", title: "Order Casing", sub: "Houston wants casing on location before TD. Pack the truck to the number, then count what shows up.", trigger: gap(3), a: 0.3, m: 0, steps: [
    { text: "Order casing at the computer in your trailer", at: sy(S.desk), label: "Order 9⅝″ casing", r: 3, act: (done) => {
      g.mini.orderCasing({ eyebrow: "Casing Order", title: "Pack the Truck", intro: "The hole is 8,500 ft and a joint runs about 40 ft, so you need roughly 215–235 joints with a little spare. Mix bundle sizes to land in the range. The truck only holds so many bundles.", min: 215, max: 235, maxBundles: 9, sizes: [30, 24, 18, 12, 8, 5] }, (r) => {
        if (r.skipped) {
          const n = [186, 204, 241, 268, 226][(Math.random() * 5) | 0];
          g.shortcutToast("You told the vendor \"about enough\" and hung up.");
          g.casingPicked(n);
        } else g.casingPicked(r.value ?? 224);
        done();
      });
    }, watch: () => g.casingOrder > 0 },
    { text: "Count the casing joints off the truck", at: sy(S.casing), label: "Check the casing tally", r: 5, enter: () => { g.rig.setCasingTruck(true); g.radio("brent", "Casing's on location. Please verify the tally. And be nice to the driver, he's been talking about his boat since Pecos."); }, act: (done) => {
      // the truck really carries 23-29 joints; the ticket claims the number you ordered (usually a little different)
      const real = 23 + ((Math.random() * 7) | 0), claim = Math.max(20, real + [0, 0, 1, -1, 2, -2][(Math.random() * 6) | 0]);
      g.mini.tally({ eyebrow: "Casing Tally", title: "Count the Joints", intro: "The driver has the bundle stacked end-on. The ticket says one number, the pipe may say another. Tag every joint, then report your count.", count: real, claim }, (r) => {
        if (r.skipped) {
          g.shortcutToast("You signed the ticket without counting.");
          g.radio("earl", "Signed. Whatever's on that truck is now the company's problem. Yours, specifically.");
          g.addDebt({ id: "tally", atDepth: 8200, chance: real !== claim || g.flags.shortCasing ? 1 : 0.5, run: () => { g.radio("brent", "The casing is SIX joints short. Hot-shot truck from Odessa. Somebody signed this tally.", 11000); sim.addCost(60000); sim.s.t += 360; g.inc(1, "SHORT CASING TALLY"); } });
        } else if (good(r)) { g.gain(0.3, 0); g.radio("marcus", real === claim ? `${real} joints, just like the ticket. He'll never forgive you for counting.` : `Ticket said ${claim}, you counted ${real}. Nice catch. That's a phone call to the vendor.`); if (real < claim) sim.addCost(-4000); }
        else { g.gain(0.05, 0); g.radio("marcus", `You said ${r.value}. There were ${r.extra}. Close enough for a Company Man.`); if (Math.abs((r.value ?? real) - real) >= 3) g.addDebt({ id: "tally2", atDepth: 8200, chance: 0.7, run: () => { g.radio("brent", "The joint count at TD doesn't match your tally. We're paying for it.", 9000); sim.addCost(24000); } }); }
        done();
      });
    } },
  ] });

  // ================================================================ 4. autodriller — set the limits and engage it
  M({ id: "auto", title: "Set the Autodriller", sub: "Set the autodriller's WOB, ROP, differential-pressure and torque limits, then engage it.", trigger: gap(3), a: 0.35, m: 0, steps: [
    { text: "Set the autodriller limits at the driller's console and engage it", at: sy(S.cabin), label: "Driller's console", r: 3.5, act: () => g.openCabin(), watch: () => s.auto.on },
  ], end: () => g.radio("dale", "Autodriller's in control. I can finally drink my coffee while it's hot. Keep an eye on those limits — it will run right up to every one of them.") });

  // ================================================================ 5. shakers — clear the blinded screen (Lights-Out puzzle)
  M({ id: "shakers", title: "Check the Shakers", sub: "Climb the pit roof. The shaker screen is blinded with gumbo and the mud is running over the side.", trigger: gap(3), a: 0.2, m: 3, steps: [
    { text: "Climb the tanks and clear the shale shaker screen", at: sy(S.shakers), label: "Shale shakers", r: 3.8, act: (done) => {
      g.mini.lightsOut({ eyebrow: "Shale Shakers", title: "Clear the Screen", intro: "Gumbo has plugged the shaker screen in patches. Flushing a cell clears it, but it also flips the four cells around it, so a clear one clogs again. Get the whole screen clean.", size: 4 }, (r) => {
        if (r.skipped) {
          g.shortcutToast("You told Marcus the screen looked fine.");
          g.radio("marcus", "Looks fine to you? It's mostly mud. Okay. …I'll note that.");
          g.flags.screenTorn = false;
          g.addDebt({ id: "screens", atDepth: s.depth + 700, chance: 0.65, run: () => { g.radio("marcus", "The blinded screen just dumped mud over the side of the shaker. We lost about 120 barrels.", 10000); s.pit = Math.max(150, s.pit - 120); sim.addCost(30000); } });
        } else { g.flags.screenTorn = false; g.flags.screensFixed = true; sim.addCost(1200); if (good(r)) g.gain(0.2, 2); }
        g.flags.shakersLooked = true; done();
      });
    }, watch: () => !!g.flags.shakersLooked },
  ], end: () => g.radio("marcus", "Screen's clean and the mud's back over the shaker where it belongs. That's more than the last Company Man ever did.") });

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
      { text: "Tour stop 2: the BOP — show her how it closes", at: sy(S.bop), label: "Give the tour: the BOP", r: 6, act: (done) => g.mini.pipes({ eyebrow: "Intern Tour — Stop 2", title: "Line Up the Closing Unit", intro: "Madison asks how the BOP actually closes. Show her: turn the sections of hydraulic line until the accumulator is connected all the way across to the BOP.", from: "ACCUM", to: "BOP", cols: 5, rows: 4 }, (r) => {
        if (r.skipped) return internSkip(done);
        if (good(r)) { g.gain(0.2, 3); g.radio("tyler", "So the accumulator pushes fluid to the BOP and the BOP closes. Got it. Brayden is touching it."); } else { g.gain(0.05, 0); g.radio("tyler", "…so it works eventually?"); }
        done(); }) },
      { text: "Tour stop 3: the rig floor", at: () => rv(2.3, F + 1.0, 2.6), label: "Give the tour: drill floor", r: 4, act: (done) => g.tourStop("tyler", "Stop 3 — Drill floor", "'Can I push the big red button?'", [["No. There's no button. It's a rotary table.", "Brayden: 'So it IS a button.' You let it go.", 0.1, 2], ["Sure. Press it.", "The fire alarm goes off. For three seconds. Everyone looks at you.", -0.15, 6]], done) },
      { text: "Tour stop 4: muster point — head count", at: sy(S.muster), label: "Give the tour: muster", r: 5, act: (done) => g.mini.whack({ eyebrow: "Intern Tour — Stop 4", title: "Head Count", intro: "Muster drill! TWENTY interns just scattered across the muster area and they will not hold still. Tap every one of them before they wander off. Tap fast.", label: "intern", count: 20, seconds: 17, speed: 2.4, size: 30, life: 2.6 }, (r) => {
        if (r.skipped) return internSkip(done);
        if (good(r)) { g.gain(0.25, 4); g.radio("tyler", "Three. All present. I did not know it was a game."); } else { g.gain(0, 0); g.radio("earl", "You lost an intern at a muster drill. Impressive."); g.inc(1, "MISSING HEAD AT MUSTER"); }
        done(); }) },
    ], end: () => g.despawnInterns() });

  // ================================================================ 7. porta john — set the slips while Dale bobs the string, then free the floorhands
  M({ id: "porta", title: "Porta John Standoff", sub: "Both floorhands are locked in the porta john, a connection is up, and Dale is \"helping\" by bobbing the string.", trigger: gap(3), a: 0.4, m: 6,
    start: () => { g.rig.setPortaLocked(true); H.hand1.root.setEnabled(false); H.hand2.root.setEnabled(false); g.radio("dale", "BOSS! Jimbo and Dewayne are locked in the porta john and I've got a connection up! I'll hold the pipe for you, but somebody's gotta set the slips!", 11000); },
    steps: [
      { text: "Go to the drill floor and set the slips (Dale will fake you out)", at: () => rv(1.9, F + 1.0, 1.4), label: "Set the slips", r: 4, act: (done) => g.mini.slips((r) => {
        if (r.skipped) {
          g.shortcutToast("You eyeballed the slips and waved Dale on.");
          g.radio("dale", "You sure? That wasn't set. …Okay. It's your pipe.");
          g.addDebt({ id: "slips", afterMin: 45, chance: 0.5, run: () => { g.radio("dale", "WE DROPPED THE STRING! The pipe walked right through the slips! Fishing job, boss!", 11000); sim.addCost(120000); sim.s.t += 300; sim.s.stats.npt += 5; g.inc(1, "DROPPED PIPE IN THE HOLE"); } });
        } else if (r.score === 0) { g.radio("dale", "THE STRING'S GONE! You set it on moving pipe — it walked right through the slips! Fishing job!", 11000); sim.addCost(120000); sim.s.t += 300; sim.s.stats.npt += 5; g.inc(1, "DROPPED PIPE IN THE HOLE"); }
        else if (good(r)) { g.gain(0.2, 2); g.radio("dale", "Clean set. I was just messing with you. A little."); }
        else { g.gain(0.05, 0); g.radio("dale", "Took you a couple of tries. The pipe's hung. That's what matters."); }
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

  // ================================================================ 17. windmill off location
  M({ id: "windmill", title: "Windmill Shutdown", sub: "A wind turbine off the lease is shredding birds and the EPA has noticed. It's the company's windmill. Of course it is.", trigger: gap(5), a: 0.3, m: 4,
    start: () => { g.radio("earl", "Environmental called. There's a wind turbine out west of the lease and the ground under it is… feathers. Take the pickup, drive out there, and shut it off. The truck's by the company man trailer.", 12000); },
    steps: [
      { text: "Drive out to the wind turbine west of the lease (use the pickup)", at: sy(S.windmill), label: "Shut off the windmill", r: 6, act: (done) => g.mini.mash({ eyebrow: "Wind Turbine 7", title: "Main Brake", intro: "The brake lever is stiff and the blades are still turning. Heave it over, alternating left and right, before the next bird flies in.", seconds: 10, label: "pull the brake lever" }, (r) => {
        const off = () => { g.rig.setWindmill(false); };
        if (r.skipped) { off(); g.shortcutToast("You hit the E-stop and walked away."); g.radio("earl", "You just slammed a 1.5 megawatt generator to a stop with the emergency button. Somebody will hear about that.", 9000); g.addDebt({ id: "wmgear", afterMin: 60, chance: 0.5, run: () => { g.radio("brent", "The turbine's gearbox is toast. Our name is on the work order.", 9000); sim.addCost(35000); } }); g.gain(-0.05, 0); }
        else if (r.score > 0.35) { off(); g.gain(0.3, 5); g.radio("earl", "Blades are coasting down. Good. Nobody tell the birds, they're past caring.", 8000); }
        else { off(); g.gain(0.05, 1); g.radio("earl", "It took you ten minutes and a lot of swearing, but it's stopped.", 7000); }
        done(); }) },
    ] });

  // ================================================================ snake — trap it in the doghouse (hex pen puzzle)
  M({ id: "snake", title: "Rattlesnake in the Doghouse", sub: "It's under the table. The crew is standing on the benches. Someone has to box it in.", trigger: gap(8), a: 0.3, m: 6,
    start: () => { g.spawnSnake(); g.radio("jimbo", "BOSS. There's a snake in the doghouse. It's a rattler. It's rattling.", 9000); },
    steps: [{ text: "Go to the doghouse and box the snake in", at: () => rv(-4.3, F + 0.6, -3.2), label: "Handle the snake", r: 3.5, act: (done) => g.mini.snakeTrap({ eyebrow: "Doghouse", title: "Trap the Rattler", intro: "It's loose and it wants out. Drop crates on the floor tiles to wall it in. It slides one tile toward the nearest way out every time you place one, so think two moves ahead." }, (r) => {
      const bite = (why: string) => { g.radio("jimbo", why, 8000); g.inc(1, "SNAKEBITE — FIRST AID"); sim.addCost(12000); g.gain(0, -4); };
      if (r.skipped) { g.shortcutToast("You decided to just walk past it."); g.radio("earl", "Walking past a rattlesnake. Bold."); g.addDebt({ id: "bite", afterMin: 15, chance: 0.5, run: () => bite("It got you in the boot, boss. The BOOT. Count your blessings.") }); }
      else if (good(r)) { g.gain(0.4, 4); g.radio("earl", "Boxed it in with a few crates and a lot of nerve. Wildlife control is on the way. The crew's cheering."); }
      else bite("It slipped out through the gap and got your ankle on the way. You're fine. The boot is not.");
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

  // ================================================================ 16. ARMAGEDDON (finale)
  M({ id: "armageddon", title: "Finish the Well", sub: "Drill to TD, then run casing and cement.", trigger: () => g.flags.chainDone === true, a: 1.0, m: 20,
    start: () => { g.hold = null; sim.hold = null; g.radio("dale", "Released the hold. We're drilling to TD, boss.", 8000); },
    steps: [
      { text: "Drill to TD (8,500 ft): set weight at the driller's console", at: sy(S.cabin), label: "Driller's console", r: 3.5, act: () => g.openCabin(), watch: () => s.depth >= WELL.td - 0.5 && (s.mode === "idle" || s.mode === "casing" || s.mode === "done") },   // (casing may already be running or finished by the time the finale begins)
      { text: "Run the casing & cement at the console", at: sy(S.cabin), label: "Driller's console — run casing", r: 3.5, act: () => g.openCabin(), watch: () => s.mode === "casing" || s.mode === "done" },
      { text: "Casing & cement in the hole…", watch: () => s.casing.phase === "done" || s.mode === "done" },
      { text: "Answer the phone in your trailer", at: sy(S.phone), label: "Answer the phone", r: 3, enter: () => { g.sfx.horn(); g.spawnAsteroid(); g.sim.s.paused = true; g.flags.ringing = true; g.flags.ringT = 0; g.flags.ringLast = 0; g.flags.ringNag = false; g.radio("earl", "Phone's ringing in your trailer. Caller ID says… the White House? Head to the company man trailer, boss.", 11000); }, act: (done0) => {
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
      { text: "The detonator is smashed. Draw straws.", watch: () => !!g.flags.finish },
    ] });

  g.missionTotal = g.queue.length;
}
