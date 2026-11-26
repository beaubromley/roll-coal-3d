// "Big Al Drilling": a big golden driller beside a derrick (a nod to Tulsa's Golden Driller), and the company's motto.
// The name is set in mixed case on purpose: in a sans-serif face a lowercase l and a capital I look the same, so "Big Al" reads as "Big AI".

const GOLD = "#e8b923", GOLD_D = "#b98a14", OUT = "#3a2a08", NAVY = "#14253a";

/** the driller: x = centre, top = y of the top of the hard hat, s = height in px */
export function drawDriller(c: CanvasRenderingContext2D, x: number, top: number, s: number) {
  c.save(); c.lineJoin = "round"; c.lineCap = "round";
  const lw = Math.max(1.5, s * 0.018), P = (u: number) => u * s;
  const stroke = (col: string) => { c.fillStyle = col; c.strokeStyle = OUT; c.lineWidth = lw; c.fill(); c.stroke(); };
  // boots
  for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(x + sx * P(0.085), top + P(0.975), P(0.075), P(0.032), 0, 0, 6.3); stroke(GOLD_D); }
  // legs
  for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(x + sx * P(0.02), top + P(0.6)); c.lineTo(x + sx * P(0.13), top + P(0.6)); c.lineTo(x + sx * P(0.145), top + P(0.95)); c.lineTo(x + sx * P(0.03), top + P(0.95)); c.closePath(); stroke(GOLD); }
  // belt and buckle
  c.beginPath(); c.rect(x - P(0.155), top + P(0.57), P(0.31), P(0.045)); stroke(GOLD_D); c.beginPath(); c.rect(x - P(0.02), top + P(0.572), P(0.04), P(0.04)); stroke("#f6d86a");
  // left arm on the hip, right arm up on the derrick
  c.lineWidth = P(0.075); c.strokeStyle = OUT; c.beginPath(); c.moveTo(x - P(0.15), top + P(0.3)); c.lineTo(x - P(0.23), top + P(0.44)); c.lineTo(x - P(0.14), top + P(0.56)); c.stroke();
  c.lineWidth = P(0.055); c.strokeStyle = GOLD; c.beginPath(); c.moveTo(x - P(0.15), top + P(0.3)); c.lineTo(x - P(0.23), top + P(0.44)); c.lineTo(x - P(0.14), top + P(0.56)); c.stroke();
  c.lineWidth = P(0.075); c.strokeStyle = OUT; c.beginPath(); c.moveTo(x + P(0.15), top + P(0.3)); c.lineTo(x + P(0.27), top + P(0.2)); c.lineTo(x + P(0.36), top + P(0.1)); c.stroke();
  c.lineWidth = P(0.055); c.strokeStyle = GOLD; c.beginPath(); c.moveTo(x + P(0.15), top + P(0.3)); c.lineTo(x + P(0.27), top + P(0.2)); c.lineTo(x + P(0.36), top + P(0.1)); c.stroke();
  c.beginPath(); c.arc(x + P(0.375), top + P(0.085), P(0.04), 0, 6.3); stroke(GOLD);   // the hand
  // torso: a work shirt with two pockets
  c.beginPath(); c.moveTo(x - P(0.15), top + P(0.27)); c.lineTo(x + P(0.15), top + P(0.27)); c.lineTo(x + P(0.155), top + P(0.58)); c.lineTo(x - P(0.155), top + P(0.58)); c.closePath(); stroke(GOLD);
  c.lineWidth = lw * 0.8; c.strokeStyle = GOLD_D; for (const sx of [-1, 1]) c.strokeRect(x + sx * P(0.075) - P(0.03), top + P(0.35), P(0.06), P(0.06));
  // neck, head, beard, and the hard hat
  c.beginPath(); c.rect(x - P(0.03), top + P(0.235), P(0.06), P(0.05)); stroke(GOLD_D);
  c.beginPath(); c.ellipse(x, top + P(0.185), P(0.075), P(0.09), 0, 0, 6.3); stroke(GOLD);
  c.beginPath(); c.moveTo(x - P(0.07), top + P(0.2)); c.quadraticCurveTo(x, top + P(0.3), x + P(0.07), top + P(0.2)); c.quadraticCurveTo(x, top + P(0.23), x - P(0.07), top + P(0.2)); stroke(GOLD_D);
  c.beginPath(); c.arc(x, top + P(0.12), P(0.09), Math.PI, 0); c.closePath(); stroke("#f6d86a");
  c.beginPath(); c.rect(x - P(0.115), top + P(0.115), P(0.23), P(0.022)); stroke(GOLD_D);
  c.restore();
}

/** a drilling derrick: a tapering lattice tower with a crown block */
export function drawDerrick(c: CanvasRenderingContext2D, x: number, top: number, w: number, h: number) {
  c.save(); c.strokeStyle = "#cfd6dc"; c.lineWidth = Math.max(1.5, h * 0.012); c.lineJoin = "round";
  c.beginPath(); c.moveTo(x - w * 0.08, top); c.lineTo(x - w * 0.5, top + h); c.moveTo(x + w * 0.08, top); c.lineTo(x + w * 0.5, top + h); c.stroke();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const y0 = top + (h * i) / n, y1 = top + (h * (i + 1)) / n, k0 = 0.08 + (0.42 * i) / n, k1 = 0.08 + (0.42 * (i + 1)) / n;
    c.beginPath(); c.moveTo(x - w * k0, y0); c.lineTo(x + w * k1, y1); c.moveTo(x + w * k0, y0); c.lineTo(x - w * k1, y1); c.moveTo(x - w * k1, y1); c.lineTo(x + w * k1, y1); c.stroke();
  }
  c.fillStyle = "#e0701a"; c.fillRect(x - w * 0.12, top - h * 0.035, w * 0.24, h * 0.04);
  c.restore();
}

/** the whole logo on a sign: navy field, gold frame, the driller and his derrick on the left, the name and the motto on the right */
export function drawBigAlLogo(c: CanvasRenderingContext2D, w: number, h: number, opts: { rig?: boolean; motto?: boolean } = {}) {
  c.fillStyle = NAVY; c.fillRect(0, 0, w, h);
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(255,255,255,0.10)"); g.addColorStop(1, "rgba(0,0,0,0.22)"); c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.strokeStyle = GOLD; c.lineWidth = Math.max(4, h * 0.03); c.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08);
  c.strokeStyle = "rgba(232,185,35,0.45)"; c.lineWidth = Math.max(1.5, h * 0.01); c.strokeRect(h * 0.09, h * 0.09, w - h * 0.18, h - h * 0.18);
  const art = h * 0.78, ax = h * 0.58;
  drawDerrick(c, ax + art * 0.46, h * 0.1, art * 0.45, art * 0.9);
  drawDriller(c, ax, h * 0.12, art * 0.86);
  const tx = ax + art * 0.62, tw = w - tx - h * 0.12;
  c.textBaseline = "alphabetic"; c.textAlign = "left";
  const big = Math.min(h * 0.4, tw / 3.6);
  c.font = `bold ${big}px Arial, Helvetica, sans-serif`; c.fillStyle = GOLD; c.fillText("BIG AL", tx, h * 0.42);
  c.font = `bold ${big * 0.5}px Arial, Helvetica, sans-serif`; c.fillStyle = "#f4efe1"; c.fillText("DRILLING", tx, h * 0.42 + big * 0.5);
  if (opts.rig) { c.font = `bold ${big * 0.26}px Arial, Helvetica, sans-serif`; c.fillStyle = "#9fb4c8"; c.fillText("RIG 107", tx + big * 2.0, h * 0.42 + big * 0.5); }
  if (opts.motto !== false) { c.font = `italic bold ${big * 0.4}px Arial, Helvetica, sans-serif`; c.fillStyle = "#ffd24a"; c.fillText("AL IS THE FUTURE.", tx, h * 0.88); }
}

/** a long, low band for the cabin walls: a small driller, the name and the rig number */
export function drawBigAlBand(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = "#14253a"; c.fillRect(0, 0, w, h);
  c.strokeStyle = GOLD; c.lineWidth = Math.max(3, h * 0.05); c.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
  drawDriller(c, h * 0.85, h * 0.1, h * 0.84);
  c.textBaseline = "middle"; c.textAlign = "left"; const fs = h * 0.5;
  c.font = `bold ${fs}px Arial, Helvetica, sans-serif`; c.fillStyle = GOLD; c.fillText("BIG AL", h * 1.45, h * 0.52);
  const wBig = c.measureText("BIG AL ").width; c.fillStyle = "#f4efe1"; c.fillText("DRILLING", h * 1.45 + wBig, h * 0.52);
  c.textAlign = "right"; c.font = `bold ${h * 0.3}px Arial, Helvetica, sans-serif`; c.fillStyle = "#9fb4c8"; c.fillText("RIG 107", w - h * 0.3, h * 0.52);
}
