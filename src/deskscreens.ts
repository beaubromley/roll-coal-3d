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

/** The original "Roll Coal, Make Hole" driller's console: the drilling recorder, the drilling window, the mode buttons. It runs a little self-playing demo. */
export function drawRcmh1(c: CanvasRenderingContext2D, d: ScreenData) {
  const t = d.t, G = "#8aff4a", DG = "#2d6a1c", INK = "#14100c", PX = "'Press Start 2P', ui-monospace, monospace";
  const box = (x: number, y: number, w: number, h: number, fill: string, stroke?: string, lw = 1) => { c.fillStyle = fill; c.fillRect(x, y, w, h); if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw); } };
  const text = (str: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = "left") => { c.font = `${size}px ${PX}`; c.fillStyle = col; c.textAlign = align; c.textBaseline = "middle"; c.fillText(str, x, y); };
  const mode = Math.floor(t / 4) % 4;                       // 0,2 rotate  1 slide left  3 slide right
  const sliding = mode === 1 ? -1 : mode === 3 ? 1 : 0;
  const rop = 250 + 40 * Math.sin(t * 0.7) + (sliding ? -90 : 0), wob = 15 + (sliding ? -3 : 0) + Math.sin(t) * 0.6, dp = 780 + 70 * Math.sin(t * 0.9);
  const depth = 730 + ((t * 9) % 400);
  box(0, 0, 256, 160, INK);
  // drilling recorder: four traces scroll across a green grid
  box(3, 3, 250, 41, "#1a130d", "#4a3828", 1);
  text("\u25C6 DRILLING RECORDER \u25C6", 128, 8, 5.5, G, "center");
  box(8, 13, 240, 28, "#07120a");
  c.strokeStyle = "rgba(60,150,70,0.35)"; c.lineWidth = 0.5;
  for (let i = 0; i <= 20; i++) { c.beginPath(); c.moveTo(8 + i * 12, 13); c.lineTo(8 + i * 12, 41); c.stroke(); }
  for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(8, 13 + i * 7); c.lineTo(248, 13 + i * 7); c.stroke(); }
  const trace = (col: string, base: number, amp: number, f: number, ph: number) => { c.strokeStyle = col; c.lineWidth = 1.1; c.beginPath(); for (let x = 0; x <= 240; x += 3) { const tt = t * 1.4 - (240 - x) * 0.04; const y = base - amp * Math.sin(tt * f + ph) - amp * 0.4 * Math.sin(tt * f * 2.3 + ph * 2); x ? c.lineTo(8 + x, y) : c.moveTo(8 + x, y); } c.stroke(); };
  trace("#9be84a", 20, 2.2, 0.6, 0); trace("#e8d34a", 25, 1.6, 0.5, 1); trace("#e254d8", 31, 2.6, 0.8, 2); trace("#4fe0e8", 37, 0.6, 0.3, 3);
  text("ROP", 10, 16, 3.6, "#9be84a"); text("WOB", 10, 22, 3.6, "#e8d34a"); text("DIFF P", 10, 28, 3.6, "#e254d8"); text("FLOW", 10, 34, 3.6, "#4fe0e8");
  // readouts
  const ro: [string, string, string][] = [["DEPTH", Math.round(depth) + " ft", "#4fe0e8"], ["ROP", Math.round(rop) + " ft/hr", "#9be84a"], ["WOB", wob.toFixed(0) + " klbs", "#9be84a"], ["DIFF PRESS", Math.round(dp) + " psi", "#e254d8"], ["FLOW", "550 gpm", "#4fe0e8"], ["MUD WT", "8.5 ppg", "#cfd8e0"]];
  ro.forEach(([k, v, col], i) => { const x = 8 + i * 41; text(k, x, 48, 3.4, col); text(v, x, 54, 4.2, col); });
  // the hole: orange above ground, dark rock below, dotted squares
  box(0, 59, 256, 14, "#e8a46a"); box(0, 73, 256, 47, "#202020");
  c.fillStyle = "rgba(255,255,255,0.18)"; for (let y = 61; y < 73; y += 10) for (let x = 14; x < 256; x += 15) c.fillRect(x, y, 3, 3);
  c.fillStyle = "rgba(255,255,255,0.14)"; for (let y = 78; y < 118; y += 10) for (let x = 6; x < 256; x += 15) c.fillRect(x, y, 3, 3);
  const bx = 128 + sliding * 6 * Math.sin((t % 4) * 0.8), by = 78 + ((t * 8) % 30);
  box(bx - 1.5, 59, 3, by - 59, "#8aa0b2"); box(bx - 4, by - 4, 8, 6, "#46525e"); box(bx - 5, by + 2, 10, 2.5, "#2a2f35");
  c.strokeStyle = "#ff4a4a"; c.lineWidth = 1; c.setLineDash([3, 2]); c.beginPath(); c.moveTo(128, by + 6); c.lineTo(128, 118); c.stroke(); c.setLineDash([]);
  // drilling window
  box(4, 60, 66, 56, "#0d1410", "#3a4a3a", 1); text("DRILLING WINDOW", 37, 64, 3.8, G, "center");
  c.fillStyle = "rgba(60,140,60,0.28)"; c.fillRect(24, 68, 22, 44);
  c.strokeStyle = "rgba(120,200,120,0.5)"; c.lineWidth = 0.5; c.setLineDash([2, 2]); c.beginPath(); c.moveTo(22, 68); c.lineTo(22, 112); c.moveTo(48, 68); c.lineTo(48, 112); c.stroke(); c.setLineDash([]);
  const wx = 35 + sliding * 9 * Math.sin((t % 4) * 0.8) + Math.sin(t * 2.3) * 1.2;
  c.strokeStyle = "#ff4a4a"; c.lineWidth = 1; c.beginPath(); c.moveTo(35, 68); c.lineTo(35, 112); c.stroke();
  c.fillStyle = "#e8f0f4"; c.beginPath(); c.moveTo(wx - 3, 86); c.lineTo(wx + 3, 86); c.lineTo(wx, 92); c.closePath(); c.fill();
  text(Math.round(Math.abs(wx - 35) * 1.3 + 13) + " ft", 37, 110, 3.8, "#cfeccf", "center");
  box(190, 62, 62, 14, "#0a1208", G, 1); text(sliding ? (sliding < 0 ? "SLIDING L" : "SLIDING R") : "ROTATING", 221, 69.5, 5, G, "center");
  // console
  c.fillStyle = G; c.fillRect(0, 120, 256, 1.2);
  text("DRILLER'S CONSOLE", 6, 127, 5.5, G); box(196, 122, 36, 10, "#0e1a0a", G, 1); text("PAUSE", 214, 127.5, 3.8, G, "center"); box(236, 122, 14, 10, "#0e1a0a", G, 1); text("\u2013", 243, 127, 5, G, "center");
  c.fillStyle = G; c.fillRect(0, 133, 256, 0.8);
  const btn = (x: number, y: number, w: number, h: number, l1: string, on = false) => { box(x, y, w, h, on ? G : "#0e1a0a", G, 1); text(l1, x + w / 2, y + h / 2, 3.4, on ? INK : G, "center"); };
  text("DRILLING MODE", 33, 137, 3.2, "#9fd88a", "center");
  btn(6, 140, 20, 16, "SLIDE L", sliding < 0); btn(28, 140, 20, 16, "ROTATE", sliding === 0); btn(50, 140, 20, 16, "SLIDE R", sliding > 0);
  text("WOB: " + wob.toFixed(0) + " KLBS", 98, 137, 3.2, "#9fd88a", "center"); btn(80, 140, 17, 16, "WOB +", true); btn(99, 140, 17, 16, "WOB -");
  text("FLOW: 550 GPM", 146, 137, 3.2, "#9fd88a", "center"); btn(128, 140, 17, 16, "FLOW +"); btn(147, 140, 17, 16, "FLOW -");
  text("MUD WT: 8.5 PPG", 196, 137, 3.2, "#9fd88a", "center"); btn(178, 140, 17, 16, "MW +"); btn(197, 140, 17, 16, "MW -");
  text("LCM: 0", 234, 137, 3.2, "#9fd88a", "center"); btn(218, 140, 15, 16, "LCM +"); btn(235, 140, 15, 16, "LCM -");
  // CRT scanlines
  c.fillStyle = "rgba(0,0,0,0.16)"; for (let y = 0; y < H; y += 2) c.fillRect(0, y, W, 1);
}
