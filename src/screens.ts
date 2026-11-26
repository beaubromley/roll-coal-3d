import { Scene, DynamicTexture } from "@babylonjs/core";
import { drawAutoBars, type AutoView } from "./recorder";
import { formationAt, WELL } from "./sim";
import { drawDd } from "./ddscreens";
import type { Dd } from "./dd";

/** Live data for the cabin's monitors. */
export interface ScreenData {
  depth: number; wob: number; rop: number; spp: number; flow: number; pit: number; mw: number; mode: string;
  rotating: boolean; kicking: boolean; dd: Dd; t: number; auto?: AutoView; wobSet?: number; motor?: number; dp?: number; torque?: number; tripping?: boolean; tripOut?: boolean; bitDepth?: number; casing?: "run" | "cement" | "done" | "none";
}

export type ScreenKind = "params" | "trends" | "pits" | "alarms" | "pumps" | "hookload" | "survey" | "toolface" | "gamma" | "mwd" | "steer" | "plan" | "edr" | "news" | "auto" | "geo" | "ac" | "systems" | "dirq" | "ddq" | "weight";

const W = 256, H = 160;
const BG = "#0b0e12", GRID = "rgba(120,140,160,0.22)", CY = "#2fd0d0", GR = "#22c06a", AM = "#e8d34a", RD = "#ff6a7a", TX = "#e6ebf0", DIM = "#8d98a5";

const hist = { rop: [] as number[], wob: [] as number[], spp: [] as number[], gr: [] as number[], res: [] as number[] };
const push = (a: number[], v: number, n = 90) => { a.push(v); if (a.length > n) a.shift(); };
let lastHist = -1;

/** Owns one canvas texture per monitor and redraws them from live data. */
export class Screens {
  private list: { kind: ScreenKind; mirror: boolean; tex: DynamicTexture; ctx: CanvasRenderingContext2D; w: number; h: number }[] = [];
  constructor(private scene: Scene) {}

  make(kind: ScreenKind, mirror = false, size?: [number, number]): DynamicTexture {
    const w = size ? size[0] : kind === "edr" || kind === "trends" ? 640 : W, h = size ? size[1] : kind === "edr" || kind === "trends" ? 364 : H;   // the EDR wall TV is big enough to deserve real resolution
    const tex = new DynamicTexture("scr_" + kind + this.list.length, { width: w, height: h }, this.scene, true);
    tex.anisotropicFilteringLevel = 8;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    this.list.push({ kind, mirror, tex, ctx, w, h });
    return tex;
  }

  update(d: ScreenData) {
    if (d.t - lastHist > 0.25) {
      lastHist = d.t;
      push(hist.rop, d.rop); push(hist.wob, d.wob); push(hist.spp, d.spp);
      push(hist.gr, 70 + 35 * Math.sin(d.depth / 90) + 14 * Math.sin(d.depth / 17) + (Math.random() - 0.5) * 12);
      push(hist.res, 8 + 5 * Math.sin(d.depth / 130 + 1) + (Math.random() - 0.5) * 2);
      pushEdr(d);
    }
    for (const s of this.list) { const c = s.ctx; c.save(); if (s.mirror) { c.translate(s.w, 0); c.scale(-1, 1); } if (s.kind === "edr" || s.kind === "trends") drawEdr(c, d, s.w, s.h); else if (s.kind === "weight") drawWeight(c, d, s.w, s.h); else { if (s.w !== W || s.h !== H) c.scale(s.w / W, s.h / H); draw(s.kind, c, d); } c.restore(); s.tex.update(); }
  }
}

function frame(c: CanvasRenderingContext2D, title: string, color = "#e6ebf0") {
  c.fillStyle = BG; c.fillRect(0, 0, W, H);
  c.fillStyle = "#14181e"; c.fillRect(0, 0, W, 18); c.fillStyle = "#2a313a"; c.fillRect(0, 18, W, 1);
  c.fillStyle = color; c.font = "bold 11px monospace"; c.textBaseline = "middle"; c.textAlign = "left"; c.fillText(title, 6, 9);
  const live = Math.floor(performance.now() / 650) % 2 === 0; c.fillStyle = live ? "#3ddc84" : "#1b5a38"; c.beginPath(); c.arc(W - 36, 9, 2.5, 0, 6.3); c.fill();
  c.fillStyle = "#3ddc84"; c.font = "bold 8px monospace"; c.textAlign = "right"; c.fillText("LIVE", W - 6, 9);
  c.strokeStyle = "#252c35"; c.lineWidth = 1; c.strokeRect(0.5, 0.5, W - 1, H - 1);
}
function bar(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number, max: number, col: string, label: string, unit: string) {
  c.fillStyle = DIM; c.font = "9px monospace"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(label, x, y - 6);
  c.fillStyle = "#0e1b2b"; c.fillRect(x, y, w, h); c.fillStyle = col; c.fillRect(x, y, Math.max(0, Math.min(1, v / max)) * w, h);
  c.fillStyle = TX; c.textAlign = "right"; c.fillText(`${Math.round(v)} ${unit}`, x + w, y - 6);
}
function trace(c: CanvasRenderingContext2D, a: number[], x: number, y: number, w: number, h: number, max: number, col: string, min = 0) {
  c.strokeStyle = GRID; c.strokeRect(x + 0.5, y + 0.5, w, h); c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath();
  a.forEach((v, i) => { const px = x + (i / 89) * w, py = y + h - ((v - min) / (max - min)) * h; i ? c.lineTo(px, Math.max(y, Math.min(y + h, py))) : c.moveTo(px, Math.max(y, Math.min(y + h, py))); }); c.stroke();
}

/** four screens in one view: each drawn at half size in its own quadrant */
function quad(c: CanvasRenderingContext2D, d: ScreenData, kinds: ScreenKind[]) {
  kinds.forEach((k, i) => { c.save(); c.translate((i % 2) * (W / 2), (i >> 1) * (H / 2)); c.beginPath(); c.rect(0, 0, W / 2, H / 2); c.clip(); c.scale(0.5, 0.5); draw(k, c, d); c.restore(); });
  c.strokeStyle = "#252c35"; c.lineWidth = 1; c.beginPath(); c.moveTo(W / 2 + 0.5, 0); c.lineTo(W / 2 + 0.5, H); c.moveTo(0, H / 2 + 0.5); c.lineTo(W, H / 2 + 0.5); c.stroke();
}

function draw(kind: ScreenKind, c: CanvasRenderingContext2D, d: ScreenData) {
  c.lineWidth = 1; c.textBaseline = "middle";
  if (kind === "systems") { quad(c, d, ["pits", "pumps", "hookload", "alarms"]); return; }
  if (kind === "dirq") { quad(c, d, ["steer", "plan", "geo", "ac"]); return; }
  if (kind === "ddq") { quad(c, d, ["toolface", "steer", "gamma", "mwd"]); return; }
  if (drawDd(kind, c, d.dd, d.t)) return;
  switch (kind) {
    case "params": {
      frame(c, "DRILLING PARAMETERS");
      c.fillStyle = TX; c.font = "bold 26px monospace"; c.textAlign = "left"; c.fillText(Math.round(d.depth).toLocaleString("en-US"), 8, 40);
      c.fillStyle = DIM; c.font = "10px monospace"; c.fillText("BIT DEPTH  FT", 8, 58);
      c.fillStyle = d.rotating ? GR : AM; c.textAlign = "right"; c.font = "bold 12px monospace"; c.fillText(d.mode.toUpperCase(), W - 8, 40);
      bar(c, 8, 82, 112, 8, d.wob, 60, CY, "WOB", "klbs"); bar(c, 136, 82, 112, 8, d.rop, 380, GR, "ROP", "ft/h");
      bar(c, 8, 112, 112, 8, d.spp, 4000, AM, "SPP", "psi"); bar(c, 136, 112, 112, 8, d.rotating ? 110 : 0, 160, CY, "RPM", "rpm");
      bar(c, 8, 140, 112, 8, d.flow, 1000, CY, "FLOW", "gpm"); bar(c, 136, 140, 112, 8, d.rotating ? 9 : 0, 20, GR, "TORQ", "kft-lb");
      break;
    }
    case "trends": break;   // the vertical EDR (drawEdr)
    case "pits": {
      frame(c, "PIT VOLUMES");
      for (let i = 0; i < 4; i++) { const x = 16 + i * 60, lv = Math.max(0.1, Math.min(0.95, (d.pit + [0, -40, -90, -140][i]) / 760));
        c.fillStyle = "#0e1b2b"; c.fillRect(x, 26, 34, 102); c.fillStyle = i === 0 ? (d.kicking ? RD : CY) : "#3aa0c8"; c.fillRect(x, 26 + 102 * (1 - lv), 34, 102 * lv);
        c.fillStyle = TX; c.font = "9px monospace"; c.textAlign = "center"; c.fillText(`${Math.round(lv * 760)}`, x + 17, 138); c.fillStyle = DIM; c.fillText(["ACT", "RSV", "TRIP", "SLUG"][i], x + 17, 150); }
      break;
    }
    case "auto": { if (d.auto) drawAutoBars(c, W, H, d.auto); else { frame(c, "AUTODRILLER"); } break; }
    case "edr": break;   // drawn by drawEdr (it has its own, bigger canvas)
    case "news": {
      const heads = [
        "PROPERTY TAX UP AGAIN: MAN LEARNS THE COUNTY OWNS HIS HOUSE",
        "INCOME TAX NOW RISING FASTER THAN THE PRICE OF A TACO",
        "SALES TAX ON SALES TAX? OFFICIALS: 'WE'RE STUDYING IT'",
        "NEW TAX ON TAXES: YOU PAY EXTRA FOR READING ABOUT THEM",
        "ESTATE TAX: GOVERNMENT WANTS DAD'S PICKUP TOO",
        "GAS TAX FIXES ROAD; ROAD STILL A POTHOLE; EXPERTS BAFFLED",
        "CAPITAL GAINS TAX ON GAINS YOU PLAN TO HAVE: THE 'HOPE TAX'",
        "SIN TAX EXPANDS TO INCLUDE CHEESE DIP",
        "SHADE TREE TAX PROPOSED: 'YOU'RE ENJOYING THAT, AREN'T YOU?'",
        "BREATHING TAX DEBUNKED; 'EXHALE SURCHARGE' STILL ON THE TABLE",
        "MAN FILES TAXES ON HIS TAX REFUND ON HIS TAX REFUND",
        "TOLL ROAD TO THE TOLL BOOTH GETS ITS OWN TOLL",
        "NEW WEEKEND TAX HITS SATURDAYS AND, FOR SOME REASON, KAYAKS",
        "ACCOUNTANT RUNS FOR OFFICE ON PLATFORM OF 'MORE FORMS'",
        "CORN TAX, WHEAT TAX, CORNBREAD TAX: 'FOR THE CHILDREN'",
        "DEATH TAX, BIRTH TAX, MID-LIFE CRISIS TAX: 'ALL OF THE ABOVE'",
        "DRILLING TAX ON THE TAX ON DRILLING: 'DRILL, BABY, DRILL (PAY)'",
        "TRUCK NUTS NOW TAXED AS 'CHROME'; OWNER: 'THEY'RE FOR FREEDOM'",
        "PUNDIT: THE WAR ON CHRISTMAS NOW COVERS ITCHY CHRISTMAS SWEATERS",
        "LOCAL MAN FINDS FREEDOM: REFUSES SEATBELT, SEAT, AND CAR",
        "'GET OFF MY LAWN' ACT PASSES; LAWN STILL NOT MOWED",
        "BIG GOVERNMENT TAXING SMALL GOVERNMENT TO FUND MEDIUM GOVERNMENT",
        "TOWN HALL: 'WHY IS THE GOVERNMENT SO BIG AND NEVER ANSWERS THE PHONE?'",
        "REGULATION TO REGULATE REGULATORS: ELEVEN FORMS TO FILE THE TWELFTH",
        "CABLE SPECIAL: 'IS YOUR LAWN MOWER LIBERAL? THE BLADES MAY KNOW'",
        "BOOTSTRAP PRICES SOAR; ECONOMISTS ADVISE PULLING HARDER",
        "MAN CELEBRATES INDEPENDENCE BY GRILLING AND SUING THE GRILL",
        "THE FREE MARKET FIXES EVERYTHING, SAYS MAN SELLING THE MARKET",
      ];
      const i = Math.floor(d.t / 7) % heads.length;
      c.fillStyle = "#0a1a3a"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#5a7ab8"; c.fillRect(150, 30, 90, 90); c.fillStyle = "#e0b48f"; c.beginPath(); c.arc(195, 56, 14, 0, 6.3); c.fill(); c.fillStyle = "#1a1a2a"; c.fillRect(173, 72, 44, 48);
      c.fillStyle = "#c01818"; c.fillRect(0, 0, W, 20); c.fillStyle = "#fff"; c.font = "bold 12px sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText("BREAKING", 6, 10);
      c.fillStyle = "#fff"; c.font = "bold 13px sans-serif"; const words = heads[i].split(" "); let line = "", y = 52;
      for (const w of words) { if ((line + w).length > 17) { c.fillText(line, 8, y); y += 17; line = ""; } line += w + " "; } c.fillText(line, 8, y);
      c.fillStyle = "#c01818"; c.fillRect(0, 124, W, 36); c.fillStyle = "#fff"; c.font = "bold 12px sans-serif"; c.fillText("FAUX NEWS 24", 6, 133);
      const tk = heads.join("   ●   "); const off = (d.t * 40) % (tk.length * 7); c.save(); c.beginPath(); c.rect(0, 140, W, 20); c.clip(); c.fillStyle = "#ffe04a"; c.fillText(tk + "   ●   " + tk, 6 - off, 150); c.restore();
      break;
    }
    case "alarms": {
      frame(c, "ALARM SUMMARY", d.kicking ? RD : GR);
      const rows: [string, boolean][] = [["PIT GAIN", d.kicking], ["FLOW OUT HIGH", d.kicking], ["STANDPIPE PRESSURE", d.spp > 3600], ["MUD WEIGHT", false], ["H2S", false], ["POWER", false], ["BOP ACCUM", false]];
      rows.forEach(([n, on], i) => { const y = 32 + i * 17; c.fillStyle = on ? RD : "#1c5a34"; c.beginPath(); c.arc(14, y, 5, 0, 6.3); c.fill(); c.fillStyle = on ? RD : TX; c.font = "11px monospace"; c.textAlign = "left"; c.fillText(n, 28, y); c.textAlign = "right"; c.fillStyle = on ? RD : DIM; c.fillText(on ? "ALARM" : "OK", W - 8, y); });
      break;
    }
    case "pumps": {
      frame(c, "MUD PUMPS");
      for (let i = 0; i < 3; i++) { const on = d.flow > 100; const x = 12 + i * 80; c.fillStyle = "#0e1b2b"; c.fillRect(x, 28, 66, 70); c.fillStyle = on ? GR : RD; c.fillRect(x, 28, 66, 4);
        const ph = (d.t * 6 + i * 2) % 6.28; c.strokeStyle = CY; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 8, 70 + Math.sin(ph) * 14); c.lineTo(x + 58, 70 - Math.sin(ph) * 14); c.stroke();
        c.fillStyle = TX; c.font = "10px monospace"; c.textAlign = "center"; c.fillText(`P${i + 1}  ${on ? Math.round(d.flow / 3) : 0} gpm`, x + 33, 112); }
      c.fillStyle = TX; c.font = "bold 14px monospace"; c.textAlign = "left"; c.fillText(`${Math.round(d.flow)} GPM`, 12, 136); c.fillStyle = AM; c.textAlign = "right"; c.fillText(`${Math.round(d.spp)} PSI`, W - 12, 136);
      break;
    }
    case "hookload": {
      frame(c, "HOOKLOAD / BLOCK");
      const hl = 180 + d.wob * -1 + 120, cx = 128, cy = 100;
      c.strokeStyle = GRID; c.lineWidth = 8; c.beginPath(); c.arc(cx, cy, 52, Math.PI, 0); c.stroke();
      c.strokeStyle = CY; c.beginPath(); c.arc(cx, cy, 52, Math.PI, Math.PI + Math.min(1, hl / 500) * Math.PI); c.stroke();
      c.fillStyle = TX; c.font = "bold 22px monospace"; c.textAlign = "center"; c.fillText(`${Math.round(hl)}`, cx, cy - 8); c.fillStyle = DIM; c.font = "10px monospace"; c.fillText("KLBS", cx, cy + 10);
      c.fillText(`BLOCK ${Math.round(40 + (d.depth % 93))} FT`, cx, 148);
      break;
    }
    case "survey": {
      frame(c, "WELLBORE · SECTION VIEW");
      c.strokeStyle = GRID; for (let i = 1; i < 5; i++) { c.beginPath(); c.moveTo(8, 18 + i * 28); c.lineTo(W - 8, 18 + i * 28); c.stroke(); }
      const pxPerFt = 120 / 9000, vs = (ft: number) => Math.sin((d.dd.inc * Math.PI) / 180) * ft * 0.25;
      c.strokeStyle = "#274055"; c.lineWidth = 3; c.beginPath(); c.moveTo(40, 24); c.lineTo(40 + vs(8500) * 0.01, 24 + 8500 * pxPerFt); c.stroke();
      c.strokeStyle = GR; c.lineWidth = 2.4; c.beginPath(); c.moveTo(40, 24);
      const steps = 24; for (let i = 1; i <= steps; i++) { const ft = (d.depth * i) / steps; c.lineTo(40 + vs(ft) * (1 + i / 60), 24 + ft * pxPerFt); } c.stroke();
      c.fillStyle = TX; c.font = "10px monospace"; c.textAlign = "right"; c.fillText(`MD ${Math.round(d.depth)}`, W - 8, 34); c.fillStyle = AM; c.fillText(`INC ${d.dd.inc.toFixed(1)}°`, W - 8, 50); c.fillText(`AZI ${d.dd.azi.toFixed(0)}°`, W - 8, 66);
      c.fillStyle = DIM; c.fillText(`TVD ${Math.round(d.depth * Math.cos((d.dd.inc * Math.PI) / 180))}`, W - 8, 82);
      break;
    }
    case "plan": {
      frame(c, "PLAN VIEW · TARGET");
      const cx = 128, cy = 92; c.strokeStyle = GRID; for (const r of [20, 40, 60]) { c.beginPath(); c.arc(cx, cy, r, 0, 6.3); c.stroke(); } c.beginPath(); c.moveTo(cx - 70, cy); c.lineTo(cx + 70, cy); c.moveTo(cx, cy - 70); c.lineTo(cx, cy + 70); c.stroke();
      const a = ((d.dd.azi - 90) * Math.PI) / 180, len = Math.min(58, d.depth / 160 * Math.sin((d.dd.inc * Math.PI) / 180) * 12 + 4);
      c.strokeStyle = GR; c.lineWidth = 2.4; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); c.stroke();
      c.fillStyle = RD; c.beginPath(); c.arc(cx - 40, cy, 4, 0, 6.3); c.fill(); c.fillStyle = DIM; c.font = "9px monospace"; c.textAlign = "left"; c.fillText("PLAN 270°", 10, 28);
      break;
    }
    case "toolface": {
      frame(c, "TOOLFACE");
      const cx = 128, cy = 90, r = 56; c.strokeStyle = GRID; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r, 0, 6.3); c.stroke(); c.beginPath(); c.arc(cx, cy, r * 0.5, 0, 6.3); c.stroke();
      c.fillStyle = DIM; c.font = "9px monospace"; c.textAlign = "center"; c.fillText("HS", cx, cy - r - 6); c.fillText("180", cx, cy + r + 8); c.fillText("R", cx + r + 9, cy); c.fillText("L", cx - r - 9, cy);
      const a = ((d.dd.tf - 90) * Math.PI) / 180; c.strokeStyle = d.dd.sliding ? GR : AM; c.lineWidth = 4; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); c.stroke();
      c.fillStyle = TX; c.font = "bold 13px monospace"; c.fillText(`${Math.round(d.dd.tf)}°`, cx, cy + 4); c.fillStyle = d.dd.sliding ? GR : AM; c.fillText(d.dd.sliding ? "SLIDING" : "ROTATING", cx, 150);
      break;
    }
    case "gamma": {
      frame(c, "GAMMA · RESISTIVITY", AM);
      c.strokeStyle = GRID; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(8 + i * 80, 22); c.lineTo(8 + i * 80, H - 6); c.stroke(); }
      const plot = (a: number[], max: number, col: string, x0: number) => { c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath(); a.forEach((v, i) => { const y = 24 + (i / 89) * 130, x = x0 + Math.max(0, Math.min(1, v / max)) * 76; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); };
      plot(hist.gr, 150, GR, 8); plot(hist.res, 20, CY, 168);
      c.fillStyle = GR; c.font = "9px monospace"; c.textAlign = "left"; c.fillText("GR api", 10, 30); c.fillStyle = CY; c.fillText("RES ohm-m", 170, 30);
      break;
    }
    case "mwd": {
      frame(c, "MWD SURVEYS");
      c.fillStyle = DIM; c.font = "9px monospace"; c.textAlign = "left"; c.fillText("MD      INC    AZI    DLS", 8, 28);
      for (let i = 0; i < 7; i++) { const md = Math.max(0, Math.round(d.depth / 93 - 6 + i) * 93), inc = Math.max(0, d.dd.inc + Math.sin(i + md) * 0.15), azi = d.dd.azi + Math.cos(i * 2 + md) * 1.2;
        c.fillStyle = i === 6 ? GR : TX; c.fillText(`${String(md).padStart(5)}  ${inc.toFixed(1).padStart(5)}  ${azi.toFixed(0).padStart(5)}  ${(Math.abs(Math.sin(md)) * 0.6).toFixed(1).padStart(4)}`, 8, 44 + i * 15); }
      break;
    }
    case "steer": {
      frame(c, "STEERING ADVISOR");
      c.font = "bold 13px monospace"; c.textAlign = "left";
      const off = Math.abs(((d.dd.azi - 270 + 540) % 360) - 180), bad = off > 15 || d.dd.inc > 6;
      c.fillStyle = bad ? RD : GR; c.fillText(bad ? "OFF PLAN" : "ON PLAN", 10, 36);
      c.font = "11px monospace"; c.fillStyle = TX; c.fillText(`Inc  ${d.dd.inc.toFixed(2)}°`, 10, 62); c.fillText(`Azi  ${d.dd.azi.toFixed(1)}°`, 10, 80); c.fillText(`Off plan ${off.toFixed(1)}°`, 10, 98);
      c.fillStyle = DIM; c.fillText("Slide to build / turn.", 10, 124); c.fillText("Rotate to hold.", 10, 140);
      c.strokeStyle = d.dd.sliding ? GR : AM; c.lineWidth = 3; c.strokeRect(150, 40, 90, 70); c.fillStyle = d.dd.sliding ? GR : AM; c.font = "bold 12px monospace"; c.textAlign = "center"; c.fillText(d.dd.sliding ? "SLIDE" : "ROTATE", 195, 75);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------------- the EDR: seven tracks of strip charts, time running down the screen, newest at the bottom
const EDR_N = 240;
interface Chan { name: string; unit: string; col: string; max: number; sp?: boolean; get: (d: ScreenData, s: { rop2: number; wob2: number }) => number; }
const EDR: [Chan, Chan][] = [
  [{ name: "Hookload", unit: "klb", col: "#6cb4ff", max: 750, get: (d) => trip(d).hook },
   { name: "Block Height", unit: "ft", col: "#d8dde3", max: 150, get: (d) => trip(d).block }],
  [{ name: "Inst ROP", unit: "ft/hr", col: "#22c06a", max: 500, get: (d) => d.rop },
   { name: "ROP Set Pt", unit: "ft/hr", col: "#ff6a7a", max: 500, sp: true, get: (d) => d.auto?.sp.rop ?? 0 }],
  [{ name: "WOB", unit: "klb", col: "#ffeb3b", max: 100, get: (d) => d.wob },
   { name: "WOB Set Pt", unit: "klb", col: "#2fd0d0", max: 100, sp: true, get: (d) => d.wobSet ?? d.wob }],
  [{ name: "Diff Press", unit: "psi", col: "#ff4dff", max: 2400, get: (d) => d.dp ?? 0 },
   { name: "Diff Limit", unit: "psi", col: "#2fd0d0", max: 2400, sp: true, get: (d) => d.auto?.sp.dp ?? 0 }],
  [{ name: "Torque", unit: "ft-lb", col: "#6cb4ff", max: 20000, get: (d) => d.torque ?? 0 },
   { name: "Torque Limit", unit: "ft-lb", col: "#f0922b", max: 20000, sp: true, get: (d) => d.auto?.sp.tq ?? 0 }],
  [{ name: "Rock Strength", unit: "psi", col: "#d8b96a", max: 15000, get: (d) => formationAt(d.depth).hardness * 11000 },
   { name: "Motor Life", unit: "%", col: "#22c06a", max: 100, get: (d) => d.motor ?? 100 }],
  [{ name: "Flow In", unit: "gpm", col: "#2fd0d0", max: 1000, get: (d) => d.flow },
   { name: "Pump Pressure", unit: "psi", col: "#22c06a", max: 8000, get: (d) => d.spp }],
  [{ name: "Total Volume", unit: "bbl", col: "#ff6a7a", max: 1000, get: (d) => d.pit },
   { name: "Flow Out", unit: "%", col: "#22c06a", max: 100, get: (d) => Math.min(100, d.flow / 16 + (d.kicking ? 18 : 0)) }],
];
/** hookload and block height. Drilling: the string hangs from the hook less the weight on bit, and the block creeps down. Tripping: a sawtooth: the block climbs with a stand
 *  (string weight on the hook; it shrinks as pipe comes out and grows as it goes in) and then drops back empty (just the block and top drive) for the next one. */
const STAND = 93, STROKE = 100, BLOCKS = 50;
let tripPh = 0;   // 0..1 through the current stand while tripping
function trip(d: ScreenData): { hook: number; block: number } {
  const bd = d.bitDepth ?? d.depth;
  // running casing: the same saw-tooth as running pipe in, in 80 ft doubles and a good deal heavier (the casing floats a little in the mud)
  if (d.casing === "run") {
    const u = 1 - ((bd % 80) + 80) % 80 / 80;
    const Wc = BLOCKS + 0.045 * bd;
    if (u < 0.88) return { hook: Wc, block: (u / 0.88) * STROKE };
    return { hook: BLOCKS, block: STROKE * (1 - (u - 0.88) / 0.12) };
  }
  if (d.casing === "cement") return { hook: BLOCKS + 0.04 * d.depth, block: 5 };   // landed and cementing: the string hangs steady and the block sits low
  if (d.casing === "done") return { hook: BLOCKS, block: 5 };
  const W = BLOCKS + 0.025 * bd;
  if (d.tripping) {
    // u runs 0..1 through each stand: upward while pulling out, downward while running in, then it wraps. Trips run far faster than the chart samples, so the stand phase advances
    // a fixed number of samples per stand (see pushEdr) instead of following the bit depth, which would alias into noise
    const u = tripPh;
    // block height: like drilling, only fast. Running in it ramps down the stand and skips back up; pulling out the ramp is inverted: low, ramping up, then skipping back low
    const block = 5 + u * (STROKE - 5);
    // hookload follows the string weight, so it is proportional to the depth of the bit. Pulling out is heavier (drag holds the pipe back), running in is lighter; each stand ramps the same way as the block
    const W0 = BLOCKS + 0.025 * bd, hook = d.tripOut === false ? W0 * 0.86 * (0.93 + 0.14 * u) : W0 * 1.16 * (0.93 + 0.14 * u);
    return { hook, block };
  }
  return { hook: W - d.wob * (d.rotating ? 1 : 0), block: 5 + (1 - ((((d.depth - WELL.startDepth) % STAND) + STAND) % STAND) / STAND) * (STROKE - 5) };   // starts at the top of a stand and comes down as the hole is made
}
const edrHist: number[][] = [];
/** the weight indicator: a big dial for hookload, with the weight on bit shown as the amber stretch between the hanging weight and the reading */
function drawWeight(c: CanvasRenderingContext2D, d: ScreenData, w: number, h: number) {
  const t = trip(d), free = d.tripping || d.casing === "run" ? t.hook : t.hook + (d.rotating ? d.wob : 0), MAX = 500;
  c.fillStyle = "#0b0e12"; c.fillRect(0, 0, w, h); c.textBaseline = "middle";
  c.fillStyle = "#14181e"; c.fillRect(0, 0, w, h * 0.09); c.fillStyle = "#e6ebf0"; c.font = "bold " + Math.round(h * 0.055) + "px monospace"; c.textAlign = "left"; c.fillText("WEIGHT INDICATOR", w * 0.04, h * 0.045);
  c.textAlign = "right"; c.fillStyle = "#8d98a5"; c.font = Math.round(h * 0.04) + "px monospace"; c.fillText("klb", w * 0.96, h * 0.045);
  const cx = w / 2, cy = h * 0.56, R = Math.min(w * 0.44, h * 0.46), a0 = (150 * Math.PI) / 180, a1 = (390 * Math.PI) / 180, ang = (v: number) => a0 + (Math.max(0, Math.min(MAX, v)) / MAX) * (a1 - a0);
  c.fillStyle = "#0e1217"; c.beginPath(); c.arc(cx, cy, R * 1.04, 0, 6.3); c.fill(); c.strokeStyle = "#252c35"; c.lineWidth = 2; c.stroke();
  c.lineWidth = R * 0.09; c.lineCap = "butt"; c.strokeStyle = "#1c5a34"; c.beginPath(); c.arc(cx, cy, R * 0.86, ang(0), ang(Math.min(free, MAX))); c.stroke();     // the hanging weight
  if (d.rotating && !d.tripping && d.wob > 0) { c.strokeStyle = "#ffb02a"; c.beginPath(); c.arc(cx, cy, R * 0.86, ang(t.hook), ang(free)); c.stroke(); }      // weight on bit
  c.lineWidth = 2; c.strokeStyle = "#8d98a5"; c.fillStyle = "#cfd6dc"; c.font = "bold " + Math.round(R * 0.11) + "px monospace"; c.textAlign = "center";
  for (let v = 0; v <= MAX; v += 25) { const a = ang(v), big = v % 100 === 0, r0 = R * (big ? 0.68 : 0.74), r1 = R * 0.79; c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke(); if (big) c.fillText(String(v), cx + Math.cos(a) * R * 0.56, cy + Math.sin(a) * R * 0.56); }
  const na = ang(t.hook); c.strokeStyle = "#ff4a3a"; c.lineWidth = Math.max(3, R * 0.03); c.beginPath(); c.moveTo(cx - Math.cos(na) * R * 0.12, cy - Math.sin(na) * R * 0.12); c.lineTo(cx + Math.cos(na) * R * 0.78, cy + Math.sin(na) * R * 0.78); c.stroke();
  c.fillStyle = "#cfd6dc"; c.beginPath(); c.arc(cx, cy, R * 0.07, 0, 6.3); c.fill();
  c.font = "bold " + Math.round(R * 0.26) + "px monospace"; c.fillStyle = "#e6ebf0"; c.textAlign = "center"; c.fillText(t.hook.toFixed(0), cx, cy + R * 0.38);
  c.font = Math.round(h * 0.045) + "px monospace"; c.fillStyle = "#8d98a5"; c.textAlign = "left"; c.fillText("WOB " + (d.rotating && !d.tripping ? d.wob.toFixed(1) : "0.0") + " klb", w * 0.04, h * 0.95); c.textAlign = "right"; c.fillText("BLOCK " + t.block.toFixed(0) + " ft", w * 0.96, h * 0.95);
}
const edrMode: number[] = [];   // 0 rotating, 1 sliding, 2 oscillating slide, 3 not drilling
const edrState = { rop2: 0, wob2: 0 };
function pushEdr(d: ScreenData) {
  if (d.tripping && d.casing !== "run") tripPh = ((tripPh + (d.tripOut === false ? -1 : 1) / 8) % 1 + 1) % 1;   // eight chart samples to a stand
  edrState.rop2 += (d.rop - edrState.rop2) * 0.12; edrState.wob2 += (d.wob * 0.95 - edrState.wob2) * 0.2;
  { const code = d.mode === "drilling" && d.rop > 0 ? (d.dd.mode === "slide" ? 1 : d.dd.mode === "osc" ? 2 : 0) : 3; edrMode.push(code); if (edrMode.length > EDR_N) edrMode.shift(); }
  const first = edrHist.length === 0;
  if (first) for (let i = 0; i < EDR.length * 2; i++) edrHist.push([]);
  EDR.forEach((pair, ti) => pair.forEach((ch, ci) => {
    const a = edrHist[ti * 2 + ci], v = Math.max(0, ch.get(d, edrState) + (ch.sp ? 0 : (Math.random() - 0.5) * ch.max * (d.tripping ? 0.003 : 0.012)));   // set points do not jitter
    if (first) for (let i = 0; i < EDR_N; i++) a.push(v); else { a.push(v); if (a.length > EDR_N) a.shift(); }
  }));
}
export function drawEdr(c: CanvasRenderingContext2D, d: ScreenData, w: number, h: number) {
  c.fillStyle = "#0b0e12"; c.fillRect(0, 0, w, h);
  c.textBaseline = "middle"; c.lineWidth = 1;
  // header
  c.fillStyle = "#14181e"; c.fillRect(0, 0, w, 30); c.fillStyle = "#2a313a"; c.fillRect(0, 30, w, 1);
  c.font = "bold 13px monospace"; c.textAlign = "left"; c.fillStyle = "#e6ebf0"; c.fillText("ARMADILLO 107", 10, 15);
  c.font = "11px monospace"; c.fillStyle = "#8d98a5"; c.fillText("COMPANY MAN 1H", 118, 15);
  c.fillStyle = "#8d98a5"; c.fillText("HOLE", 250, 15); c.fillStyle = "#e6ebf0"; c.font = "bold 13px monospace"; c.fillText(Math.round(d.depth).toLocaleString("en-US") + " ft", 288, 15);
  c.fillStyle = "#8d98a5"; c.font = "11px monospace"; c.fillText("BIT", 374, 15); c.fillStyle = "#3ddc84"; c.font = "bold 13px monospace"; c.fillText(Math.round(d.depth).toLocaleString("en-US") + " ft", 400, 15);
  c.fillStyle = "#8d98a5"; c.font = "11px monospace"; c.fillText("STATE", 490, 15); const drilling = d.mode === "drilling" && d.rop > 0, slid = drilling && d.dd.mode !== "rotate"; c.fillStyle = slid ? "#ffb02a" : d.rotating ? "#3ddc84" : "#8d98a5"; c.font = "bold 13px monospace"; c.fillText(d.tripping ? "Tripping" : drilling ? (d.dd.mode === "slide" ? "Slide Drill" : d.dd.mode === "osc" ? "Oscillating Slide" : "Rotary Drill") : d.mode, 532, 15);
  const live = Math.floor(d.t * 1.5) % 2 === 0; c.fillStyle = "#3ddc84"; c.font = "bold 10px monospace"; c.textAlign = "right"; c.fillText("LIVE", w - 8, 15); c.fillStyle = live ? "#3ddc84" : "#1b5a38"; c.beginPath(); c.arc(w - 40, 15, 3, 0, 6.3); c.fill();
  // layout
  const top = 34, tl = 36, bottom = 52, gap = 3, tw = (w - tl - gap * (EDR.length + 1)) / EDR.length, ph = h - top - bottom;
  c.fillStyle = "#8d98a5"; c.font = "9px monospace"; c.textAlign = "left";
  const mins0 = 11 * 60 + 5 + d.t / 60;
  for (let k = 0; k < 5; k++) { const y = top + 8 + (k / 4) * (ph - 16), m = mins0 - (4 - k) * 12, hh = Math.floor(m / 60) % 24, mm = Math.floor(m % 60); c.fillText(String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0"), 3, y); }
  // drilling-mode strip down the left: green rotating, amber sliding, cyan oscillating, grey when not drilling
  { const sx = tl - 10, ph2 = ph; edrMode.forEach((m, i) => { c.fillStyle = m === 0 ? "#22c06a" : m === 1 ? "#ffb02a" : m === 2 ? "#4fd6ff" : "#2a313a"; c.fillRect(sx, top + (i / EDR_N) * ph2, 7, ph2 / EDR_N + 1); }); c.fillStyle = "#8d98a5"; c.font = "7px monospace"; c.textAlign = "left"; c.fillText("MODE", sx - 6, top - 5); }
  EDR.forEach((pair, ti) => {
    const x = tl + gap + ti * (tw + gap);
    c.fillStyle = "#0e1217"; c.fillRect(x, top, tw, ph); c.strokeStyle = "#252c35"; c.strokeRect(x + 0.5, top + 0.5, tw - 1, ph - 1);
    c.strokeStyle = "#1a2028"; for (let k = 1; k < 5; k++) { const y = Math.round(top + (k / 5) * ph) + 0.5; c.beginPath(); c.moveTo(x, y); c.lineTo(x + tw, y); c.stroke(); }
    for (let k = 1; k < 4; k++) { const xx = Math.round(x + (k / 4) * tw) + 0.5; c.beginPath(); c.moveTo(xx, top); c.lineTo(xx, top + ph); c.stroke(); }
    pair.forEach((ch, ci) => {
      const a = edrHist[ti * 2 + ci]; if (!a) return;
      c.strokeStyle = ch.col; c.lineWidth = 1.3; c.beginPath();
      a.forEach((v, i) => { const px = x + 3 + Math.max(0, Math.min(1, v / ch.max)) * (tw - 6), py = top + (i / (EDR_N - 1)) * ph; i ? c.lineTo(px, py) : c.moveTo(px, py); }); c.stroke();
    });
    // readouts under the track: label small, value big, coloured like the trace
    pair.forEach((ch, ci) => {
      const y = top + ph + 3 + ci * 24, a = edrHist[ti * 2 + ci], v = a ? a[a.length - 1] : 0;
      c.fillStyle = "#12171d"; c.fillRect(x, y, tw, 22); c.fillStyle = ch.col; c.fillRect(x, y, 2, 22);
      c.font = "8px monospace"; c.textAlign = "center"; c.fillText(`${ch.name} (${ch.unit})`, x + tw / 2, y + 5);
      c.font = "bold 12px monospace"; c.fillText(ch.max >= 10000 ? String(Math.round(v)) : v >= 100 ? v.toFixed(0) : v.toFixed(1), x + tw / 2, y + 16);
    });
  });
}
