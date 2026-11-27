import { clockString, WELL } from "./sim";
import type { ScreenData } from "./screens";

/** The two monitors on the company man's desk, drawn in the same 256 x 160 space as the other screens. */
const W = 256, H = 160;

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** WellView-style daily drilling report. */
export function drawWellView(c: CanvasRenderingContext2D, d: ScreenData) {
  const simT = d.simT ?? 0, cs = clockString(simT), cost = d.cost ?? 0;
  c.fillStyle = "#0f1822"; c.fillRect(0, 0, W, H);
  // title bar
  c.fillStyle = "#16467a"; c.fillRect(0, 0, W, 17);
  c.fillStyle = "#fff"; c.font = "bold 9px sans-serif"; c.textBaseline = "middle"; c.textAlign = "left"; c.fillText("WellView · Daily Drilling Report", 5, 8.5);
  c.textAlign = "right"; c.font = "8px sans-serif"; c.fillText(`Day ${cs.day}  ${cs.hhmm}`, W - 5, 8.5);
  // well header block
  c.fillStyle = "#16212d"; c.fillRect(0, 17, W, 28);
  c.fillStyle = "#e8eef5"; c.textAlign = "left"; c.font = "bold 8px sans-serif"; c.fillText("AL DRILLING · RIG 107", 5, 25);
  c.font = "7px sans-serif"; c.fillStyle = "#a8b9ca"; c.fillText("Well: Delaware 8500 #1H   Operator: AI agents   Status: " + (d.mode === "idle" ? "Waiting" : d.mode === "drilling" ? "Drilling" : d.mode), 5, 34);
  c.fillText(`Contractor: AL Drilling   Planned TD ${WELL.td.toLocaleString("en-US")} ft   AFE ${money(WELL.afe)}`, 5, 41);
  // KPI tiles
  const tiles: [string, string, string][] = [
    ["Depth MD", Math.round(d.depth).toLocaleString("en-US") + " ft", "#7cc0ff"],
    ["ROP now", Math.round(d.rop) + " ft/hr", d.rop > 0 ? "#3ddc84" : "#9aaec1"],
    ["Mud wt", d.mw.toFixed(1) + " ppg", "#7cc0ff"],
    ["Cost", money(cost), cost > WELL.afe ? "#ff6a5a" : "#7cc0ff"],
  ];
  tiles.forEach(([k, v, col], i) => {
    const x = 4 + i * 62;
    c.fillStyle = "#1b2836"; c.fillRect(x, 49, 58, 26); c.strokeStyle = "#33485c"; c.strokeRect(x + 0.5, 49.5, 58, 26);
    c.fillStyle = "#9aaec1"; c.font = "6.5px sans-serif"; c.textAlign = "left"; c.fillText(k, x + 4, 55);
    c.fillStyle = col; c.font = "bold 10px sans-serif"; c.fillText(v, x + 4, 67);
  });
  // cost vs AFE and days vs plan bars
  const bar = (y: number, label: string, frac: number, right: string, col: string) => {
    c.fillStyle = "#a8b9ca"; c.font = "6.5px sans-serif"; c.textAlign = "left"; c.fillText(label, 5, y);
    c.fillStyle = "#2a3a4b"; c.fillRect(62, y - 3, 130, 6); c.fillStyle = col; c.fillRect(62, y - 3, Math.max(1, Math.min(1, frac) * 130), 6);
    c.fillStyle = "#e8eef5"; c.textAlign = "right"; c.fillText(right, W - 5, y);
  };
  bar(84, "Cost vs AFE", cost / WELL.afe, Math.round((cost / WELL.afe) * 100) + "%", cost > WELL.afe ? "#ff6a5a" : "#4a9bef");
  const days = simT / 1440;
  bar(94, "Days vs plan (4)", days / 4, days.toFixed(1) + " d", days > 4 ? "#ff6a5a" : "#4a9bef");
  bar(104, "Hole drilled", (d.depth - WELL.startDepth) / (WELL.td - WELL.startDepth), Math.round(((d.depth - WELL.startDepth) / (WELL.td - WELL.startDepth)) * 100) + "%", "#3ddc84");
  // operations summary
  c.fillStyle = "#16467a"; c.fillRect(0, 111, W, 10); c.fillStyle = "#fff"; c.font = "bold 6.5px sans-serif"; c.textAlign = "left"; c.fillText("OPERATIONS SUMMARY", 5, 116);
  const act: Record<string, string> = { idle: "Rig up / waiting on orders", drilling: "Drilling 8-3/4\" hole, sliding as needed", connection: "Making a connection: slips, break, stab, make up", tripping: "Tripping pipe", shutin: "Well shut in: waiting on pressures", killing: "Circulating the kick out, Driller's Method", casing: "Running 9-5/8\" casing", done: "Cement in place: rig release" };
  c.fillStyle = "#e8eef5"; c.font = "7px sans-serif";
  c.fillText(cs.hhmm + "  " + (act[d.mode] ?? d.mode), 5, 127);
  c.fillStyle = "#a8b9ca"; c.fillText("06:00  Safety meeting; JSA reviewed; coffee consumed", 5, 136);
  c.fillText("Remarks: AI operator requests \"a quick one-pager.\"", 5, 145);
  c.fillStyle = "#2f4052"; c.fillRect(0, 151, W, 1); c.fillStyle = "#9aaec1"; c.font = "6px sans-serif"; c.fillText(`Report 1 of 1   ·   printed by nobody   ·   page ${(Math.floor(d.t / 4) % 3) + 1}/3`, 5, 156);
}

/** a stand-in arcade attract screen for the original "Roll Coal, Make Hole": a pixel rig, a bit going down, the title and a blinking prompt */
export function drawRcmh1(c: CanvasRenderingContext2D, d: ScreenData) {
  const t = d.t, px = (col: string, x: number, y: number, w: number, h: number) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  // sky and ground, retro low-res
  px("#241a3a", 0, 0, W, 70); px("#5a2e5a", 0, 40, W, 16); px("#b8505a", 0, 56, W, 10); px("#f0a050", 0, 66, W, 6);
  px("#6a4a32", 0, 72, W, 20); px("#4a3322", 0, 92, W, 68);
  for (let i = 0; i < 6; i++) px("#3a281a", 0, 100 + i * 11, W, 1);                         // strata lines
  // rig (left): derrick triangle + floor
  const bx = 60;
  for (let y = 12; y < 72; y += 3) { const half = 3 + (y - 12) * 0.16; px("#e07a10", bx - half, y, 1.5, 3); px("#e07a10", bx + half - 1.5, y, 1.5, 3); if ((y / 3) % 2 === 0) px("#d9d9d9", bx - half, y, half * 2, 1); }
  px("#e8b923", bx - 8, 10, 16, 3); px("#ff4a4a", bx - 1, 6, 2, 4); px("#3a4a78", bx - 22, 70, 44, 4);
  // drill string and bit going down, looping
  const depth = 20 + ((t * 18) % 70);
  px("#aab4be", bx - 1, 74, 2, depth - 12); px("#e8b923", bx - 3, 74 + depth - 14, 6, 6);
  for (let i = 0; i < 4; i++) px("#ffe27a", bx - 4 + ((t * 30 + i * 7) % 8), 74 + depth - 4 + ((i * 3) % 4), 1, 1);   // sparks
  // title and depth meter
  c.textBaseline = "middle"; c.textAlign = "center"; c.fillStyle = "#ffd24a"; c.font = "bold 15px monospace"; c.fillText("ROLL COAL,", 166, 28);
  c.fillStyle = "#ff6a2a"; c.fillText("MAKE HOLE", 166, 46);
  c.fillStyle = "#cfd8e0"; c.font = "bold 8px monospace"; c.textAlign = "left"; c.fillText("DEPTH", 130, 80); c.fillStyle = "#76ff03"; c.font = "bold 12px monospace"; c.fillText(String(Math.round(1000 + depth * 90 + (t * 40) % 90)).padStart(5, "0") + " FT", 130, 93);
  c.fillStyle = "#cfd8e0"; c.font = "bold 8px monospace"; c.fillText("SCORE", 130, 108); c.fillStyle = "#ffd24a"; c.font = "bold 10px monospace"; c.fillText(String(Math.floor(t * 120) % 1000000).padStart(6, "0"), 130, 120);
  if (Math.floor(t * 2) % 2 === 0) { c.textAlign = "center"; c.fillStyle = "#fff"; c.font = "bold 9px monospace"; c.fillText("PRESS START", 190, 148); }
  // scanlines for the CRT look
  c.fillStyle = "rgba(0,0,0,0.18)"; for (let y = 0; y < H; y += 2) c.fillRect(0, y, W, 1);
}
