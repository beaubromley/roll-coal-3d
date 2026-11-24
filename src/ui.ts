export const $ = (id: string) => document.getElementById(id) as HTMLElement;

export const CAST = {
  me: { name: "You (Company Man)", img: "me" },
  dale: { name: "Big Dale — Driller", img: "driller" },
  earl: { name: "Earl — Toolpusher", img: "pusher" },
  marcus: { name: "Marcus — Mud Engineer", img: "mud" },
  tex: { name: "Tex — Directional Driller", img: "driller" },
  jimbo: { name: "Jimbo — Floorhand", img: "hand" },
  brent: { name: "Brent — Houston Office", img: "office" },
  chad: { name: "Chadwick — VP of Ops", img: "vp" },
  tyler: { name: "Tyler — Intern", img: "intern" },
  nasa: { name: "NASA Liaison", img: "nasa" },
  geo: { name: "Dr. Pruitt — Mud Logger", img: "geo" },
  roy: { name: "Roy — Gate Guard", img: "pusher" },
  president: { name: "The President", img: "vp" },
  harry: { name: "Harry Stamper", img: "harry" },
  chick: { name: "Chick", img: "chick" },
  bear: { name: "Bear", img: "bear" },
  rockhound: { name: "Rockhound", img: "rockhound" },
  max: { name: "Max", img: "max" },
  ben: { name: "Ben Affleck", img: "nasa" },
} as const;
export type Who = keyof typeof CAST;

export interface PinData { x: number; y: number; show: boolean; text: string; title: string; color: string; edge: boolean; angle: number; primary: boolean }
export interface MapTarget { x: number; z: number; color: string }

export interface Choice { label: string; cls?: "alt" | "red" | "green"; run?: () => void; keep?: boolean; disabled?: boolean }

export class UI {
  panelOpen = false;
  /** called whenever a panel opens, so the game can free the mouse no matter which path opened it */
  onPanelOpen: () => void = () => {};
  onPanelClose: () => void = () => {};
  private toastT = 0;
  private radioQ: HTMLElement[] = [];
  private map = $("map") as HTMLCanvasElement;
  private mctx = this.map.getContext("2d")!;
  private stripHtml = "";
  private lastStars = -1;
  private panelTick: (() => void) | null = null;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.panelOpen) { this.closePanel(); }
    });
    $("panelwrap").addEventListener("mousedown", (e) => { if (e.target === $("panelwrap") && this.closable) this.closePanel(); });
  }
  closable = true;

  toast(title: string, sub = "") {
    const t = $("toast");
    t.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ""}`;
    t.classList.add("show");
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => t.classList.remove("show"), 3200);
  }

  radio(who: Who, text: string, ms = 7000) {
    const c = CAST[who];
    const el = document.createElement("div");
    el.className = "rmsg";
    el.innerHTML = `<img src="${import.meta.env.BASE_URL}portraits/${c.img}.jpg" alt=""/><div><div class="who">${c.name}</div><div class="txt">${text}</div></div>`;
    $("radio").appendChild(el);
    this.radioQ.push(el);
    while (this.radioQ.length > 4) this.radioQ.shift()!.remove();
    window.setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .5s"; window.setTimeout(() => el.remove(), 520); }, ms);
  }

  /** Open a modal panel. `tick` runs every frame while open (for live gauges). */
  panel(html: string, o: { wide?: boolean; closable?: boolean; tick?: () => void } = {}): HTMLElement {
    const p = $("panel");
    p.className = o.wide ? "wide" : "";
    p.innerHTML = html;
    $("panelwrap").style.display = "grid";
    this.panelOpen = true; this.closable = o.closable !== false; this.panelTick = o.tick ?? null;
    this.onPanelOpen();
    return p;
  }
  tickPanel() { if (this.panelOpen && this.panelTick) this.panelTick(); }
  closedAt = 0;
  closePanel() {
    if (!this.panelOpen) return;
    this.closedAt = performance.now();
    $("panelwrap").style.display = "none"; this.panelOpen = false; this.panelTick = null;
    this.onPanelClose();
  }

  /** Character dialog with choices. */
  say(who: Who, text: string, choices: Choice[] = [{ label: "OK" }], eyebrow = "", o: { closable?: boolean } = {}) {
    const c = CAST[who];
    const p = this.panel(`
      ${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}
      <div class="who"><img src="${import.meta.env.BASE_URL}portraits/${c.img}.jpg" alt=""/><div><h2 style="font-size:26px">${c.name}</h2><p>${text}</p></div></div>
      <div class="btns">${choices.map((ch, i) => `<button class="b ${ch.cls ?? ""}" data-i="${i}" ${ch.disabled ? "disabled" : ""}>${ch.label}</button>`).join("")}</div>`,
      { closable: o.closable ?? false });
    p.querySelectorAll<HTMLButtonElement>("button[data-i]").forEach((btn) => {
      btn.onclick = () => {
        const ch = choices[Number(btn.dataset.i)];
        if (!ch.keep) this.closePanel();
        ch.run?.();
      };
    });
    return p;
  }

  setMission(title: string, sub: string, count: string) {
    $("mtitle").textContent = title; $("msub").textContent = sub; $("mcount").textContent = count;
    $("mission").style.display = title ? "block" : "none";
  }
  setPrompt(label: string | null) {
    const el = $("prompt");
    if (!label) { el.style.display = "none"; return; }
    el.style.display = "flex"; $("plabel").textContent = label;
  }
  private pinEls: HTMLElement[] = [];
  /** One arrow per open task. `edge` pins hug the screen border and point toward an off-screen target. */
  setPins(list: PinData[]) {
    const host = $("pins");
    while (this.pinEls.length < list.length) {
      const el = document.createElement("div");
      el.className = "pin";
      el.innerHTML = `<div class="ptitle"></div><div class="parr"></div><div class="dia"></div><div class="pdist"></div>`;
      host.appendChild(el); this.pinEls.push(el);
    }
    this.pinEls.forEach((el, i) => {
      const p = list[i];
      if (!p || !p.show) { el.style.display = "none"; return; }
      el.style.display = "block"; el.style.left = p.x + "px"; el.style.top = p.y + "px";
      el.style.setProperty("--c", p.color);
      el.className = "pin" + (p.edge ? " edge" : "") + (p.primary ? "" : " sub");
      (el.children[0] as HTMLElement).textContent = p.title;
      (el.children[1] as HTMLElement).style.transform = `rotate(${p.angle}rad)`;
      (el.children[3] as HTMLElement).textContent = p.text;
    });
  }
  setStrip(items: { k: string; v: string; warn?: boolean }[]) {
    const h = items.map((i) => `<div class="${i.warn ? "warn" : ""}"><small>${i.k}</small><span>${i.v}</span></div>`).join("");
    if (h !== this.stripHtml) { this.stripHtml = h; $("strip").innerHTML = h; }
  }
  setStars(n: number) {
    const k = Math.round(n * 2) / 2;
    if (k === this.lastStars) return; this.lastStars = k;
    let h = "";
    for (let i = 1; i <= 5; i++) h += i <= Math.floor(k) ? "<b>★</b>" : (i - 0.5 === k ? "<b>⯨</b>" : "★");
    $("stars").innerHTML = h;
  }
  setBars(morale: number, incidents: number) {
    $("moraleFill").style.width = Math.max(0, Math.min(100, morale)) + "%";
    ($("moraleFill") as HTMLElement).style.background = morale > 55 ? "var(--green)" : morale > 28 ? "var(--gold)" : "var(--red)";
    $("moraleVal").textContent = Math.round(morale) + "%";
    $("incFill").style.width = Math.min(100, incidents * 12) + "%";
    $("incVal").textContent = String(incidents);
  }
  setAlert(text: string | null) {
    const a = $("alert");
    if (!text) { a.style.display = "none"; return; }
    a.style.display = "block"; a.textContent = text;
  }
  setDistrict(t: string) {
    const el = $("district"); el.textContent = t;
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");     // restarts the fade-in / hold / fade-out
  }

  drawMap(px: number, pz: number, yaw: number, targets: MapTarget[]) {
    const c = this.mctx, S = 300, scale = 1.57; // px per metre
    c.save(); c.clearRect(0, 0, S, S);
    c.fillStyle = "#cdb98f"; c.fillRect(0, 0, S, S);
    c.translate(S / 2, S / 2); c.rotate(-yaw); // heading-up
    const X = (x: number) => (x - px) * scale, Z = (z: number) => -(z - pz) * scale;
    const rect = (x0: number, z0: number, x1: number, z1: number, col: string) => { c.fillStyle = col; c.fillRect(X(x0), Z(z1), (x1 - x0) * scale, (z1 - z0) * scale); };
    // flip drawing frame so +z is "north"
    c.scale(1, 1);
    rect(-3.5, 40, 3.5, 400, "#6b665d");           // road
    rect(-60, -66, 60, 62, "#d8c8a6");               // pad
    rect(-6.5, -6, 6.5, 6, "#2c5d8a");               // substructure
    rect(-1, 6, 1, 34, "#7a5a38");                   // catwalk
    rect(-11, 17, -2, 34, "#8a4b2b"); rect(2, 17, 11, 34, "#8a4b2b"); // pipe racks
    rect(-18, -26, 18, -19.6, "#6b747c");            // tanks
    rect(-12, -14.5, 0, -9.5, "#a8221c");            // pumps
    rect(-33, -28, -26, 0, "#1d6fb5");               // gensets
    rect(-17, 9, -9.5, 14, "#2e7a45");               // accumulator
    rect(8.5, 6.5, 15.5, 11.5, "#a8221c");           // choke
    rect(30, 8, 33.6, 36, "#e0dccb"); rect(37, 8, 43, 28, "#9aa6b2"); // trailers
    rect(43, 40, 49, 44, "#2f9a4a");                 // muster
    rect(5, 94, 8.4, 98, "#e0dccb");
    c.restore();
    // task markers are drawn in screen space (always upright) and clamped to the map edge
    for (const t of targets) {
      const rx = (t.x - px) * scale, rz = -(t.z - pz) * scale;
      const cs = Math.cos(-yaw), sn = Math.sin(-yaw);
      const tx = rx * cs - rz * sn, tz = rx * sn + rz * cs;
      const d = Math.hypot(tx, tz), mr = S / 2 - 12, k = d > mr ? mr / d : 1;
      c.save(); c.translate(S / 2 + tx * k, S / 2 + tz * k); c.rotate(Math.PI / 4);
      c.fillStyle = t.color; c.strokeStyle = "#fff"; c.lineWidth = 2; c.fillRect(-5, -5, 10, 10); c.strokeRect(-5, -5, 10, 10); c.restore();
    }
    // player arrow (always up)
    c.save(); c.translate(S / 2, S / 2); c.fillStyle = "#fff"; c.strokeStyle = "#111"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath(); c.fill(); c.stroke(); c.restore();
  }
}
