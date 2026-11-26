import type { Game } from "./game";
import { WELL } from "./sim";
import type { HatKind } from "./npcs";

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
  { id: "secrets", name: "Laser Focus", desc: "Steal AGI Drilling's laser secrets.", check: (g) => g.doneIds.has("secrets") },
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
  { id: "thrown", name: "Persona Non Grata", desc: "Get thrown out of AGI Drilling's lease.", secret: true },
  { id: "nightcall", name: "Dead of Night", desc: "Call the engineer between 11pm and 5am and say never mind.", secret: true },
  { id: "bag1", name: "Dinner Is Served", desc: "Bag an animal." },
  { id: "variety", name: "Full Game Bag", desc: "Bag five different kinds of animal." },
  { id: "trophy", name: "Trophy Buck", desc: "Bag the prize buck.", secret: true },
  { id: "td", name: "Total Depth", desc: `Reach ${WELL.td.toLocaleString("en-US")} feet.`, check: (g) => g.sim.s.depth >= WELL.td - 1 },
];

/** the hats: the company hard hat is always yours, the rest are won with achievements */
export interface Hat { id: HatKind; name: string; icon: string; ach?: string }
export const HATS: Hat[] = [
  { id: "hardhat", name: "Company Hard Hat", icon: "⛑️" },
  { id: "cone", name: "Safety Cone", icon: "🚧", ach: "hardhat" },
  { id: "beanie", name: "Safety Orange Beanie", icon: "🧶", ach: "kill" },
  { id: "cowboy", name: "Cowboy Hat", icon: "🤠", ach: "hunt" },
  { id: "cap", name: "Roll Coal Trucker Cap", icon: "🧢", ach: "coal" },
  { id: "helmet", name: "Space Helmet", icon: "👨‍🚀", ach: "pew" },
  { id: "tophat", name: "Executive Top Hat", icon: "🎩", ach: "world" },
  { id: "robot", name: "Robot Head", icon: "🤖", ach: "secrets" },
  { id: "sombrero", name: "Taco Tuesday Sombrero", icon: "🌮", ach: "taco" },
  { id: "fur", name: "Squatch Fur Hat", icon: "🦧", ach: "bigfoot" },
  { id: "bucket", name: "Old Sixty Bucket Hat", icon: "🎣", ach: "sixty" },
  { id: "party", name: "Zero Harm Party Hat", icon: "🥳", ach: "zero" },
  { id: "tinfoil", name: "Tinfoil Hat", icon: "🛸", ach: "nightcall" },
  { id: "crown", name: "Trophy Crown", icon: "👑", ach: "trophy" },
];

export function checkAchievements(g: Game) {
  for (const a of ACHIEVEMENTS) if (a.check && !g.hasAward(a.id) && a.check(g)) g.award(a.id);
}
