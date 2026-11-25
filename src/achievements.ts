import type { Game } from "./game";
import { WELL } from "./sim";

export interface Ach { id: string; name: string; desc: string; secret?: boolean; check?: (g: Game) => boolean }

/** Achievements. Ones with a `check` are tested once a second; the rest are awarded by the thing that happens (g.award(id)). */
export const ACHIEVEMENTS: Ach[] = [
  { id: "hardhat", name: "Hard Hat Harry", desc: "Finish the Hard Hat Area job.", check: (g) => g.doneIds.has("ppe") },
  { id: "auto", name: "Set It & Forget It", desc: "Finish the autodriller job.", check: (g) => g.doneIds.has("auto") },
  { id: "ft500", name: "Making Hole", desc: "Drill your first 500 feet.", check: (g) => g.sim.s.stats.feetDrilled >= 500 },
  { id: "mile", name: "A Mile Down", desc: "Get past 5,280 feet.", check: (g) => g.sim.s.depth >= 5280 },
  { id: "deep", name: "Deep Pockets", desc: "Get past 8,000 feet.", check: (g) => g.sim.s.depth >= 8000 },
  { id: "kill", name: "Kill Switch", desc: "Kill a kick.", check: (g) => g.sim.s.stats.kicksKilled >= 1 },
  { id: "textbook", name: "Textbook", desc: "Kill a kick and hold the drill pipe pressure the whole way." },
  { id: "world", name: "Saved the World", desc: "Drill to TD and save the planet.", check: (g) => g.doneIds.has("armageddon") || !!g.flags.finish },
  { id: "zero", name: "Zero Harm", desc: "Finish the well with no recordable incidents.", check: (g) => !!g.flags.finish && g.incidents === 0 },
  { id: "deer", name: "Bambi's Bodyguard", desc: "Get the deer off the location.", check: (g) => g.doneIds.has("deer") },
  { id: "inspect", name: "Eagle Eye", desc: "Inspect the derrick with the drone.", check: (g) => g.doneIds.has("inspect") },
  { id: "hunt", name: "Hank's Wingman", desc: "Go hunting with Hank.", check: (g) => g.doneIds.has("hunt") },
  { id: "windmill", name: "Lockout Legend", desc: "Shut down the wind turbines the right way.", check: (g) => g.doneIds.has("windmill") },
  { id: "sixty", name: "Old Sixty", desc: "Land the sixty-pound catfish.", check: (g) => g.doneIds.has("sixty") },
  { id: "secrets", name: "Laser Focus", desc: "Steal Singularity's laser secrets.", check: (g) => g.doneIds.has("secrets") },
  { id: "pew", name: "Pew Pew", desc: "Drill with the laser.", secret: true },
  { id: "taco", name: "Taco Tuesday", desc: "Buy a taco.", check: (g) => ((g.flags.taco as number | undefined) ?? 0) >= 1 },
  { id: "tacos", name: "Taco Addict", desc: "Buy five tacos.", check: (g) => ((g.flags.taco as number | undefined) ?? 0) >= 5 },
  { id: "cast", name: "First Cast", desc: "Catch a fish.", check: (g) => g.outskirts.fishSave().caught >= 1 },
  { id: "angler", name: "Gone Fishin'", desc: "Catch ten fish.", check: (g) => g.outskirts.fishSave().caught >= 10 },
  { id: "rss", name: "RSS Retrieval", desc: "Get the rotary steerable out of the pond.", secret: true },
  { id: "bigfoot", name: "Squatch Watch", desc: "Spot Bigfoot.", secret: true },
  { id: "coal", name: "Roll Coal", desc: "Floor it and let the stacks belch.", secret: true },
  { id: "highway", name: "Highway Star", desc: "Get the F-250 past 80 mph.", check: (g) => { const v = g.veh.active; return !!v && v.id === "f250" && v.speed * 2.237 > 80; } },
  { id: "flyer", name: "High Flyer", desc: "Take the drone up 200 feet.", check: (g) => { const v = g.veh.active; return !!v && v.kind === "drone" && v.alt * 3.281 > 200; } },
  { id: "fall", name: "Recordable", desc: "Fall off something. It will be written up.", secret: true },
  { id: "thrown", name: "Persona Non Grata", desc: "Get thrown out of Singularity's lease.", secret: true },
  { id: "td", name: "Total Depth", desc: `Reach ${WELL.td.toLocaleString("en-US")} feet.`, check: (g) => g.sim.s.depth >= WELL.td - 1 },
];

export function checkAchievements(g: Game) {
  for (const a of ACHIEVEMENTS) if (a.check && !g.hasAward(a.id) && a.check(g)) g.award(a.id);
}
