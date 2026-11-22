import { Scene, DynamicTexture, Texture } from "@babylonjs/core";

export interface DetailTex { diffuse: DynamicTexture; bump: DynamicTexture }

function mk(scene: Scene, size: number, name: string): { tex: DynamicTexture; c: CanvasRenderingContext2D } {
  const tex = new DynamicTexture(name, size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE; tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return { tex, c: tex.getContext() as CanvasRenderingContext2D };
}

let seed = 1337;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** draw a feature at all 9 wrap offsets so the tile has no visible seam */
function wrap(size: number, x: number, y: number, r: number, fn: (x: number, y: number) => void) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const px = x + ox * size, py = y + oy * size;
    if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
    fn(px, py);
  }
}

/**
 * Brushed galvanized plate: long horizontal brushing, plate seams with raised weld beads, hex bolt heads, edge grime and light rust at the bolts.
 * Neutral light-gray diffuse so the material's own colour tints it; the bump carries brushing, welds and bolts.
 */
export function metalPanels(scene: Scene): DetailTex {
  const S = 512;
  const d = mk(scene, S, "metalD"), b = mk(scene, S, "metalB");
  d.c.fillStyle = "#dcdfe2"; d.c.fillRect(0, 0, S, S);
  b.c.fillStyle = "#808080"; b.c.fillRect(0, 0, S, S);
  // slow tonal drift so large surfaces don't read as one flat colour
  for (let i = 0; i < 14; i++) {
    const x = rnd() * S, y = rnd() * S, r = 70 + rnd() * 120, a = 0.03 + rnd() * 0.05, dark = rnd() < 0.6;
    wrap(S, x, y, r, (px, py) => {
      const g = d.c.createRadialGradient(px, py, 0, px, py, r); const c = dark ? "40,48,58" : "255,255,255";
      g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`);
      d.c.fillStyle = g; d.c.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  // brushing: many long, thin, nearly horizontal strokes
  for (let i = 0; i < 1300; i++) {
    const x = rnd() * S, y = rnd() * S, len = 60 + rnd() * 220, light = rnd() < 0.5, a = 0.025 + rnd() * 0.07;
    wrap(S, x + len / 2, y, len / 2 + 2, (px, py) => {
      d.c.strokeStyle = light ? `rgba(255,255,255,${a})` : `rgba(20,30,40,${a})`; d.c.lineWidth = 1;
      d.c.beginPath(); d.c.moveTo(px - len / 2, py); d.c.lineTo(px + len / 2, py + (rnd() - 0.5) * 1.2); d.c.stroke();
      b.c.strokeStyle = light ? `rgba(255,255,255,${a * 1.5})` : `rgba(0,0,0,${a * 1.5})`; b.c.beginPath(); b.c.moveTo(px - len / 2, py); b.c.lineTo(px + len / 2, py); b.c.stroke();
    });
  }
  // plate seams: one vertical and one horizontal weld per tile, wavy raised bead with dark toe lines either side
  for (const v of [S / 2]) {
    for (let y = 0; y < S; y += 2) {
      const wob = Math.sin(y * 0.35) * 1.6 + Math.sin(y * 0.11) * 1.2;
      d.c.fillStyle = "rgba(60,64,70,0.55)"; d.c.fillRect(v - 5, y, 2, 2); d.c.fillRect(v + 4, y, 2, 2);
      d.c.fillStyle = "rgba(235,238,240,0.7)"; d.c.fillRect(v - 3 + wob, y, 7, 2);
      b.c.fillStyle = "rgba(255,255,255,0.9)"; b.c.fillRect(v - 3 + wob, y, 7, 2);
      b.c.fillStyle = "rgba(0,0,0,0.8)"; b.c.fillRect(v - 6, y, 2, 2); b.c.fillRect(v + 5, y, 2, 2);
    }
    for (let x = 0; x < S; x += 2) {
      const wob = Math.sin(x * 0.3) * 1.6 + Math.sin(x * 0.09) * 1.2;
      d.c.fillStyle = "rgba(60,64,70,0.55)"; d.c.fillRect(x, v - 5, 2, 2); d.c.fillRect(x, v + 4, 2, 2);
      d.c.fillStyle = "rgba(235,238,240,0.7)"; d.c.fillRect(x, v - 3 + wob, 2, 7);
      b.c.fillStyle = "rgba(255,255,255,0.9)"; b.c.fillRect(x, v - 3 + wob, 2, 7);
      b.c.fillStyle = "rgba(0,0,0,0.8)"; b.c.fillRect(x, v - 6, 2, 2); b.c.fillRect(x, v + 5, 2, 2);
    }
  }
  // plate edge at the tile border: dark seam so neighbouring tiles read as separate plates
  d.c.fillStyle = "rgba(25,28,32,0.5)"; d.c.fillRect(0, 0, S, 3); d.c.fillRect(0, 0, 3, S);
  b.c.fillStyle = "rgba(0,0,0,0.85)"; b.c.fillRect(0, 0, S, 3); b.c.fillRect(0, 0, 3, S);
  // hex bolt heads along the seams and edges (with a rust ring around some)
  const hex = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => { c.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + 0.5; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } c.closePath(); c.fill(); };
  const bolts: [number, number][] = [];
  for (let t = 32; t < S; t += 64) { bolts.push([t, 14], [t, S - 14], [14, t], [S - 14, t], [t, S / 2 - 16], [t, S / 2 + 16], [S / 2 - 16, t], [S / 2 + 16, t]); }
  for (const [x, y] of bolts) wrap(S, x, y, 10, (px, py) => {
    if (rnd() < 0.35) { const g = d.c.createRadialGradient(px, py, 3, px, py, 11); g.addColorStop(0, "rgba(150,80,35,0.4)"); g.addColorStop(1, "rgba(150,80,35,0)"); d.c.fillStyle = g; d.c.fillRect(px - 12, py - 12, 24, 24); }
    d.c.fillStyle = "rgba(70,74,80,0.85)"; hex(d.c, px, py, 5.2); d.c.fillStyle = "rgba(210,214,218,0.9)"; hex(d.c, px - 0.6, py - 0.6, 3.6);
    b.c.fillStyle = "rgba(255,255,255,0.95)"; hex(b.c, px, py, 5.2); b.c.fillStyle = "rgba(0,0,0,0.5)"; b.c.beginPath(); b.c.arc(px, py, 1.4, 0, 6.3); b.c.fill();
  });
  // a few vertical rain runs from the bolts
  for (let i = 0; i < 22; i++) {
    const x = (bolts[(rnd() * bolts.length) | 0] ?? [0, 0])[0] + (rnd() - 0.5) * 4, y0 = rnd() * S, len = 30 + rnd() * 110;
    const g = d.c.createLinearGradient(0, y0, 0, y0 + len); g.addColorStop(0, "rgba(90,70,50,0)"); g.addColorStop(0.2, "rgba(90,70,50,0.14)"); g.addColorStop(1, "rgba(90,70,50,0)");
    wrap(S, x, y0 + len / 2, len / 2 + 3, (px) => { d.c.fillStyle = g; d.c.fillRect(px, y0, 1.5, len); });
  }
  d.tex.update(); b.tex.update();
  return { diffuse: d.tex, bump: b.tex };
}

/** Corrugated sheet (tanks, trailers): ribs + weathering. */
export function corrugated(scene: Scene): DetailTex {
  const S = 256;
  const d = mk(scene, S, "corrD"), b = mk(scene, S, "corrB");
  const ribs = 16, rh = S / ribs;
  for (let i = 0; i < ribs; i++) {
    const y = i * rh;
    const gd = d.c.createLinearGradient(0, y, 0, y + rh); gd.addColorStop(0, "#f2f2f2"); gd.addColorStop(0.5, "#c9c9c9"); gd.addColorStop(1, "#f2f2f2");
    d.c.fillStyle = gd; d.c.fillRect(0, y, S, rh);
    const gb = b.c.createLinearGradient(0, y, 0, y + rh); gb.addColorStop(0, "#000"); gb.addColorStop(0.5, "#fff"); gb.addColorStop(1, "#000");
    b.c.fillStyle = gb; b.c.fillRect(0, y, S, rh);
  }
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S, y0 = rnd() * S, len = 30 + rnd() * 120;
    const g = d.c.createLinearGradient(0, y0, 0, y0 + len); g.addColorStop(0, "rgba(90,70,50,0)"); g.addColorStop(0.3, "rgba(90,70,50,0.18)"); g.addColorStop(1, "rgba(90,70,50,0)");
    wrap(S, x, y0 + len / 2, len / 2, (px) => { d.c.fillStyle = g; d.c.fillRect(px, y0, 1 + rnd() * 2, len); });
  }
  for (let i = 0; i < 2500; i++) { d.c.fillStyle = `rgba(0,0,0,${rnd() * 0.07})`; d.c.fillRect(rnd() * S, rnd() * S, 1, 1); }
  d.tex.update(); b.tex.update();
  return { diffuse: d.tex, bump: b.tex };
}

/** Planks / pallets */
export function woodGrain(scene: Scene): DetailTex {
  const S = 256;
  const d = mk(scene, S, "woodD"), b = mk(scene, S, "woodB");
  d.c.fillStyle = "#d8cfc2"; d.c.fillRect(0, 0, S, S); b.c.fillStyle = "#808080"; b.c.fillRect(0, 0, S, S);
  const planks = 4, ph = S / planks;
  for (let p = 0; p < planks; p++) {
    const y = p * ph, tone = 200 + ((rnd() * 40) | 0);
    d.c.fillStyle = `rgb(${tone},${tone - 8},${tone - 20})`; d.c.fillRect(0, y + 1, S, ph - 2);
    for (let i = 0; i < 40; i++) {
      const yy = y + 2 + rnd() * (ph - 4), a = 0.06 + rnd() * 0.12;
      d.c.strokeStyle = `rgba(70,45,25,${a})`; d.c.lineWidth = 1; d.c.beginPath(); d.c.moveTo(0, yy);
      for (let x = 0; x <= S; x += 32) d.c.lineTo(x, yy + Math.sin(x * 0.05 + i) * 1.5); d.c.stroke();
      b.c.strokeStyle = `rgba(0,0,0,${a * 1.6})`; b.c.beginPath(); b.c.moveTo(0, yy); b.c.lineTo(S, yy); b.c.stroke();
    }
    d.c.fillStyle = "rgba(30,20,10,0.55)"; d.c.fillRect(0, y, S, 2); b.c.fillStyle = "#000"; b.c.fillRect(0, y, S, 2);
  }
  d.tex.update(); b.tex.update();
  return { diffuse: d.tex, bump: b.tex };
}
