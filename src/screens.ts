import { Scene, DynamicTexture } from "@babylonjs/core";

/** Live data for the cabin's monitors. */
export interface ScreenData {
  depth: number; wob: number; rop: number; spp: number; flow: number; pit: number; mw: number; mode: string;
  rotating: boolean; kicking: boolean; dd: { inc: number; azi: number; tf: number; sliding: boolean }; t: number;
}

export type ScreenKind = "params" | "trends" | "pits" | "alarms" | "pumps" | "hookload" | "survey" | "toolface" | "gamma" | "mwd" | "steer" | "plan" | "edr" | "news";

const W = 256, H = 160;
const BG = "#050a12", GRID = "rgba(120,170,220,0.16)", CY = "#4fd6ff", GR = "#5dff8a", AM = "#ffb02a", RD = "#ff5a4a", TX = "#cfe6f7", DIM = "#6f8aa1";

const hist = { rop: [] as number[], wob: [] as number[], spp: [] as number[], gr: [] as number[], res: [] as number[] };
const push = (a: number[], v: number, n = 90) => { a.push(v); if (a.length > n) a.shift(); };
let lastHist = -1;

/** Owns one canvas texture per monitor and redraws them from live data. */
export class Screens {
  private list: { kind: ScreenKind; mirror: boolean; tex: DynamicTexture; ctx: CanvasRenderingContext2D }[] = [];
  constructor(private scene: Scene) {}

  make(kind: ScreenKind, mirror = false): DynamicTexture {
    const tex = new DynamicTexture("scr_" + kind + this.list.length, { width: W, height: H }, this.scene, true);
    tex.anisotropicFilteringLevel = 8;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    this.list.push({ kind, mirror, tex, ctx });
    return tex;
  }

  update(d: ScreenData) {
    if (d.t - lastHist > 0.5) {
      lastHist = d.t;
      push(hist.rop, d.rop); push(hist.wob, d.wob); push(hist.spp, d.spp);
      push(hist.gr, 70 + 35 * Math.sin(d.depth / 90) + 14 * Math.sin(d.depth / 17) + (Math.random() - 0.5) * 12);
      push(hist.res, 8 + 5 * Math.sin(d.depth / 130 + 1) + (Math.random() - 0.5) * 2);
    }
    for (const s of this.list) { const c = s.ctx; c.save(); if (s.mirror) { c.translate(W, 0); c.scale(-1, 1); } draw(s.kind, c, d); c.restore(); s.tex.update(); }
  }
}

function frame(c: CanvasRenderingContext2D, title: string, color = CY) {
  c.fillStyle = BG; c.fillRect(0, 0, W, H);
  c.fillStyle = "#0e1b2b"; c.fillRect(0, 0, W, 18); c.fillStyle = color; c.font = "bold 11px monospace"; c.textBaseline = "middle"; c.textAlign = "left"; c.fillText(title, 6, 9);
  c.strokeStyle = GRID; c.lineWidth = 1; c.strokeRect(0.5, 0.5, W - 1, H - 1);
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

function draw(kind: ScreenKind, c: CanvasRenderingContext2D, d: ScreenData) {
  c.lineWidth = 1; c.textBaseline = "middle";
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
    case "trends": {
      frame(c, "REAL-TIME TRENDS");
      trace(c, hist.rop, 8, 26, 240, 34, 380, GR); trace(c, hist.wob, 8, 68, 240, 34, 60, CY); trace(c, hist.spp, 8, 110, 240, 34, 4000, AM);
      c.font = "9px monospace"; c.textAlign = "right"; c.fillStyle = GR; c.fillText("ROP", W - 8, 32); c.fillStyle = CY; c.fillText("WOB", W - 8, 74); c.fillStyle = AM; c.fillText("SPP", W - 8, 116);
      break;
    }
    case "pits": {
      frame(c, "PIT VOLUMES");
      for (let i = 0; i < 4; i++) { const x = 16 + i * 60, lv = Math.max(0.1, Math.min(0.95, (d.pit + [0, -40, -90, -140][i]) / 760));
        c.fillStyle = "#0e1b2b"; c.fillRect(x, 26, 34, 102); c.fillStyle = i === 0 ? (d.kicking ? RD : CY) : "#3aa0c8"; c.fillRect(x, 26 + 102 * (1 - lv), 34, 102 * lv);
        c.fillStyle = TX; c.font = "9px monospace"; c.textAlign = "center"; c.fillText(`${Math.round(lv * 760)}`, x + 17, 138); c.fillStyle = DIM; c.fillText(["ACT", "RSV", "TRIP", "SLUG"][i], x + 17, 150); }
      break;
    }
    case "edr": {
      frame(c, "EDR · RIG 107 · LIVE");
      trace(c, hist.rop, 8, 26, 148, 34, 380, GR); trace(c, hist.wob, 8, 66, 148, 34, 60, CY); trace(c, hist.spp, 8, 108, 240, 40, 4000, AM);
      c.font = "bold 9px monospace"; c.textAlign = "left"; c.fillStyle = GR; c.fillText(`ROP ${Math.round(d.rop)}`, 12, 33); c.fillStyle = CY; c.fillText(`WOB ${Math.round(d.wob)}`, 12, 73); c.fillStyle = AM; c.fillText(`SPP ${Math.round(d.spp)}`, 12, 115);
      c.fillStyle = TX; c.textAlign = "right"; c.fillText(`${Math.round(d.depth)} FT`, W - 8, 9);
      // rig-floor camera footage, top right: dusk sky, mast, and a top drive that rides up and down with the hole
      { const x = 164, y = 24, w = 84, h = 76; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
        const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "#27324a"); g.addColorStop(1, "#6b5a48"); c.fillStyle = g; c.fillRect(x, y, w, h);
        c.strokeStyle = "#e8742a"; c.lineWidth = 3; c.beginPath(); c.moveTo(x + 26, y + h); c.lineTo(x + 38, y); c.moveTo(x + 58, y + h); c.lineTo(x + 46, y); c.stroke();
        c.strokeStyle = "#cfd6dc"; c.lineWidth = 1; for (let k = 0; k < 6; k++) { const yy = y + 6 + k * 12; c.beginPath(); c.moveTo(x + 30 + k * 0.7, yy); c.lineTo(x + 54 - k * 0.7, yy + 6); c.stroke(); }
        const ty = y + 12 + ((d.depth % 93) / 93) * 40 + (d.rotating ? Math.sin(d.t * 30) * 0.6 : 0);
        c.fillStyle = "#c9ccd0"; c.fillRect(x + 36, ty, 12, 10); c.fillStyle = "#e8b923"; c.fillRect(x + 40, ty + 10, 4, y + h - ty - 22);
        c.fillStyle = "#2a2f36"; c.fillRect(x, y + h - 14, w, 14); c.fillStyle = "#c4561a"; c.fillRect(x + 8, y + h - 24, 5, 10); c.fillRect(x + 66, y + h - 24, 5, 10);
        c.fillStyle = "rgba(255,255,255,0.05)"; for (let k = 0; k < h; k += 3) c.fillRect(x, y + k, w, 1);
        c.restore(); c.strokeStyle = GRID; c.strokeRect(x + 0.5, y + 0.5, w, h);
        c.fillStyle = (Math.floor(d.t * 1.6) % 2) ? RD : "#5a1a14"; c.beginPath(); c.arc(x + 8, y + 7, 3, 0, 6.3); c.fill();
        c.fillStyle = TX; c.font = "bold 8px monospace"; c.textAlign = "left"; c.fillText("CAM 1 · RIG FLOOR", x + 14, y + 8); }
      break;
    }
    case "news": {
      const heads = ["MAN WINS ARGUMENT WITH GPS, GPS DEMANDS RECOUNT", "BIGFOOT SPOTTED IN PERMIAN WALMART, BUYS ONLY ICE", "SENATOR CHALLENGES THE MOON TO A DEBATE", "GOAT ELECTED MAYOR; VOTER TURNOUT UP 400%", "SCIENTISTS CONFIRM MONDAY STILL MONDAY", "LOCAL TRUCK 'JUST NEEDS A LITTLE FREON'", "TOWN BANS SUNDAY AFTER 'TOO MANY MONDAYS'", "EXPERT: PROBABLY FINE. ANOTHER EXPERT: PROBABLY NOT",
        "TAXES: STILL EVIL, EXPERTS CONFIRM", "BREAKING: TAXES FOUND TO BE THE DEVIL'S ARITHMETIC", "WHY ARE TAXES EVIL? 'JUST ARE,' SAYS PANEL", "NEW STUDY: ALL EVIL TRACES BACK TO THE TAX CODE", "TAX MAN SEEN CACKLING NEAR PERMIAN ROYALTY CHECK", "TAXES: THEY TAKE YOUR MONEY AND NEVER EVEN SAY THANKS"];
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
