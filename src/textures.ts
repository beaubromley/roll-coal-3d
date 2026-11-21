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
 * Painted/galvanized steel panels: seams, rivets, scratches, rain streaks and grime.
 * Neutral light-gray diffuse so the material's own colour tints it; bump carries seams, rivets and scratches.
 */
export function metalPanels(scene: Scene): DetailTex {
  const S = 512;
  const d = mk(scene, S, "metalD"), b = mk(scene, S, "metalB");
  d.c.fillStyle = "#e4e4e4"; d.c.fillRect(0, 0, S, S);
  b.c.fillStyle = "#808080"; b.c.fillRect(0, 0, S, S);
  // big soft grime blotches
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S, r = 40 + rnd() * 90, a = 0.04 + rnd() * 0.08;
    wrap(S, x, y, r, (px, py) => {
      const g = d.c.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(60,50,40,${a})`); g.addColorStop(1, "rgba(60,50,40,0)");
      d.c.fillStyle = g; d.c.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  // fine speckle
  for (let i = 0; i < 5000; i++) {
    const x = rnd() * S, y = rnd() * S, v = rnd() < 0.5 ? 0 : 255, a = 0.04 + rnd() * 0.07;
    d.c.fillStyle = `rgba(${v},${v},${v},${a})`; d.c.fillRect(x, y, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
    b.c.fillStyle = `rgba(${v},${v},${v},${a * 1.4})`; b.c.fillRect(x, y, 1, 1);
  }
  // vertical rain streaks
  for (let i = 0; i < 60; i++) {
    const x = rnd() * S, y0 = rnd() * S, len = 40 + rnd() * 160, w = 1 + rnd() * 2.5;
    const g = d.c.createLinearGradient(0, y0, 0, y0 + len); g.addColorStop(0, "rgba(70,55,40,0.0)"); g.addColorStop(0.2, "rgba(70,55,40,0.16)"); g.addColorStop(1, "rgba(70,55,40,0)");
    wrap(S, x, y0 + len / 2, len / 2 + 4, (px) => { d.c.fillStyle = g; d.c.fillRect(px, y0, w, len); });
  }
  // rust spots near seams
  for (let i = 0; i < 14; i++) {
    const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 18;
    wrap(S, x, y, r, (px, py) => {
      const g = d.c.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, "rgba(140,70,30,0.35)"); g.addColorStop(1, "rgba(140,70,30,0)");
      d.c.fillStyle = g; d.c.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  // scratches
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, len = 10 + rnd() * 50, light = rnd() < 0.5;
    wrap(S, x, y, len, (px, py) => {
      for (const ctx of [d.c, b.c]) {
        ctx.strokeStyle = light ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.stroke();
      }
    });
  }
  // panel seams (2x2 panels per tile) + rivets
  const P = S / 2;
  for (let i = 0; i < 2; i++) {
    const p = i * P;
    d.c.fillStyle = "rgba(20,20,24,0.45)"; d.c.fillRect(p - 1, 0, 3, S); d.c.fillRect(0, p - 1, S, 3);
    b.c.fillStyle = "rgba(0,0,0,0.9)"; b.c.fillRect(p - 1, 0, 3, S); b.c.fillRect(0, p - 1, S, 3);
    b.c.fillStyle = "rgba(255,255,255,0.35)"; b.c.fillRect(p + 2, 0, 1, S); b.c.fillRect(0, p + 2, S, 1);
  }
  for (let px = 0; px < 2; px++) for (let py = 0; py < 2; py++) {
    for (let k = 0; k < 8; k++) for (const [rx, ry] of [[(k + 0.5) / 8 * P, 10], [(k + 0.5) / 8 * P, P - 10], [10, (k + 0.5) / 8 * P], [P - 10, (k + 0.5) / 8 * P]]) {
      const x = px * P + rx, y = py * P + ry;
      d.c.fillStyle = "rgba(0,0,0,0.28)"; d.c.beginPath(); d.c.arc(x, y, 2.6, 0, 6.3); d.c.fill();
      b.c.fillStyle = "rgba(255,255,255,0.95)"; b.c.beginPath(); b.c.arc(x, y, 2.6, 0, 6.3); b.c.fill();
    }
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
