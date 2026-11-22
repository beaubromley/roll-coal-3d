import type { Game } from "./game";
import { woptFor, formationAt } from "./sim";

export interface MiniResult { score: number; skipped: boolean; value?: number; extra?: number }
type Done = (r: MiniResult) => void;

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [b[i], b[j]] = [b[j], b[i]]; } return b; };

/**
 * Task minigames. Every one ends in { score 0..1 } or { skipped: true } when the player takes the "wing it" shortcut —
 * the caller decides what a good, bad or skipped result means (and what shows up later).
 */
export class Mini {
  private timers: number[] = [];
  private keyOff: (() => void)[] = [];
  private alive = false;

  constructor(private g: Game) {}

  /** called whenever the panel closes */
  cleanup() {
    this.alive = false;
    this.timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    this.timers = [];
    this.keyOff.forEach((f) => f()); this.keyOff = [];
  }
  private later(fn: () => void, ms: number) { const t = window.setTimeout(() => { if (this.alive) fn(); }, ms); this.timers.push(t); }
  private key(fn: (e: KeyboardEvent) => void) {
    const h = (e: KeyboardEvent) => { if (!e.repeat) fn(e); };
    window.addEventListener("keydown", h); this.keyOff.push(() => window.removeEventListener("keydown", h));
  }

  private shell(eyebrow: string, title: string, intro: string, body: string, extraBtns = "") {
    return `<div class="eyebrow">${eyebrow}</div><h2>${title}</h2><p>${intro}</p>${body}
      <div class="btns">${extraBtns}<button class="b alt" id="mgSkip">WING IT</button></div>
      <div class="hint" style="margin-top:8px">Shortcut: skip the work and take your chances. It might be fine. It might come back later.</div>`;
  }
  private open(html: string, tick?: (dt: number) => void, wide = false) {
    this.cleanup(); this.alive = true;
    return this.g.openMini(html, tick, wide);
  }
  private end(done: Done, r: MiniResult, msg = "", ms = 900) {
    if (!this.alive) return;
    const res = document.getElementById("mgResult");
    if (res && msg) res.innerHTML = msg;
    this.alive = false;                      // stop tick logic, keep the panel up briefly
    window.setTimeout(() => { this.g.closeMini(); done(r); }, msg ? ms : 0);
  }
  private skip(done: Done, p: HTMLElement) { p.querySelector<HTMLButtonElement>("#mgSkip")!.onclick = () => { this.g.sfx.click(); this.end(done, { score: 0, skipped: true }); }; }

  // ---------------------------------------------------------------- 1. SEQUENCE (Simon)
  sequence(o: { eyebrow: string; title: string; intro: string; labels: string[]; length: number }, done: Done) {
    const seq = Array.from({ length: o.length }, () => (Math.random() * o.labels.length) | 0);
    let idx = 0, mistakes = 0, input = false;
    const pads = o.labels.map((l, i) => `<button class="pad" data-i="${i}">${l}</button>`).join("");
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, `<div class="pads">${pads}</div><div id="mgResult" class="hint">Watch…</div>`));
    this.skip(done, p);
    const els = [...p.querySelectorAll<HTMLButtonElement>(".pad")];
    const light = (i: number, on: boolean) => els[i].classList.toggle("lit", on);
    seq.forEach((s, k) => { this.later(() => { light(s, true); this.g.sfx.click(); }, 700 + k * 800); this.later(() => light(s, false), 700 + k * 800 + 450); });
    this.later(() => { input = true; document.getElementById("mgResult")!.textContent = "Your turn — repeat it."; }, 700 + seq.length * 800);
    els.forEach((el) => el.onclick = () => {
      if (!input) return;
      const i = Number(el.dataset.i);
      light(i, true); this.later(() => light(i, false), 160);
      if (i === seq[idx]) { idx++; this.g.sfx.click(); if (idx >= seq.length) { input = false; this.end(done, { score: mistakes ? 0.6 : 1, skipped: false }, mistakes ? "Got it, eventually." : "Clean."); } }
      else { mistakes++; this.g.sfx.bad(); idx = 0; document.getElementById("mgResult")!.textContent = "Wrong — start again."; if (mistakes >= 3) { input = false; this.end(done, { score: 0.2, skipped: false }, "That's… a signature, technically."); } }
    });
  }

  // ---------------------------------------------------------------- 1b. SIGN SHEET (draw a signature on paper)
  signSheet(o: { eyebrow: string; title: string; intro: string }, done: Done) {
    const W = 560, H = 300, dpr = Math.min(2, window.devicePixelRatio || 1);
    const body = `<div style="display:flex;justify-content:center;margin:10px 0"><canvas id="sheet" width="${W * dpr}" height="${H * dpr}" style="width:min(100%,${W}px);aspect-ratio:${W}/${H};background:#f4efe1;border:2px solid #9a8f74;box-shadow:0 6px 18px rgba(0,0,0,.45);touch-action:none;cursor:crosshair"></canvas></div>
      <div id="mgResult" class="hint">Sign on the line, then initial in the box.</div>`;
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, body, `<button class="b alt" id="sgClear">Clear</button><button class="b" id="sgDone" style="display:none" disabled>Hand it back</button>`), undefined, true);
    this.skip(done, p);
    const cv = p.querySelector<HTMLCanvasElement>("#sheet")!, ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const SIG = { x: 40, y: 150, w: 330, h: 70 }, INI = { x: 410, y: 130, w: 110, h: 90 };   // fields; y,h = box the pen should stay in
    type Pt = { x: number; y: number };
    let strokes: Pt[][] = [], cur: Pt[] | null = null;
    const paper = () => {
      ctx.fillStyle = "#f4efe1"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(60,80,120,.18)"; ctx.lineWidth = 1;
      for (let y = 34; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.fillStyle = "#222"; ctx.font = "bold 17px Georgia, serif"; ctx.textAlign = "left";
      ctx.fillText("SITE VISITOR / CONTRACTOR SIGN-IN SHEET", 24, 32);
      ctx.font = "13px Georgia, serif"; ctx.fillStyle = "#444";
      ctx.fillText("Al Drilling · Rig 107 · I have read the site safety rules and agree to follow them.", 24, 56);
      ctx.fillText("Name: ____COMPANY MAN____      Date: ________      Badge #: 0001", 24, 90);
      ctx.fillStyle = "rgba(180,40,30,.85)"; ctx.font = "bold 22px Georgia, serif"; ctx.fillText("X", 20, SIG.y + SIG.h - 14);
      ctx.strokeStyle = "#222"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(SIG.x, SIG.y + SIG.h - 10); ctx.lineTo(SIG.x + SIG.w, SIG.y + SIG.h - 10); ctx.stroke();
      ctx.strokeRect(INI.x, INI.y + 0, INI.w, INI.h);
      ctx.fillStyle = "#444"; ctx.font = "12px Georgia, serif"; ctx.fillText("Signature", SIG.x, SIG.y + SIG.h + 8); ctx.fillText("Initials", INI.x, INI.y + INI.h + 18);
      ctx.fillStyle = "rgba(180,40,30,.8)"; ctx.font = "bold 13px Georgia, serif"; ctx.fillText("SIGN HERE ▸", SIG.x, SIG.y - 6); ctx.fillText("INITIAL ▾", INI.x, INI.y - 6);
      ctx.strokeStyle = "#101c4a"; ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const s of strokes) { ctx.beginPath(); s.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); if (s.length === 1) ctx.lineTo(s[0].x + 0.1, s[0].y); ctx.stroke(); }
    };
    const inBox = (q: Pt, b: { x: number; y: number; w: number; h: number }) => q.x >= b.x - 6 && q.x <= b.x + b.w + 6 && q.y >= b.y - 4 && q.y <= b.y + b.h + 4;
    const len = (pts: Pt[]) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; };
    const stats = () => {
      const all = strokes.flat(); const sig = all.filter((q) => q.x < INI.x - 10), ini = all.filter((q) => q.x >= INI.x - 10);
      const sigLen = strokes.reduce((a, s) => a + (s[0].x < INI.x - 10 ? len(s) : 0), 0), iniLen = strokes.reduce((a, s) => a + (s[0].x >= INI.x - 10 ? len(s) : 0), 0);
      return { sigLen, iniLen, sigIn: sig.length ? sig.filter((q) => inBox(q, SIG)).length / sig.length : 0, iniIn: ini.length ? ini.filter((q) => inBox(q, INI)).length / ini.length : 0 };
    };
    const refresh = () => {
      paper();
      const st = stats(), ok = st.sigLen > 70 && st.iniLen > 18;
      (p.querySelector("#sgDone") as HTMLButtonElement).disabled = !ok;
      const r = document.getElementById("mgResult");
      if (r && this.alive) r.textContent = ok ? "Signed. Handing it back…" : st.sigLen > 70 ? "Now initial in the box." : "Sign on the line, then initial in the box.";
    };
    const pt = (e: PointerEvent): Pt => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); cur = [pt(e)]; strokes.push(cur); refresh(); e.preventDefault(); };
    cv.onpointermove = (e) => { if (!cur) return; cur.push(pt(e)); paper(); };
    let finishing = false;
    const finish = () => {
      if (finishing) return; const st = stats(); if (!(st.sigLen > 70 && st.iniLen > 18)) return;
      finishing = true;                                         // signed and initialled: hand it back automatically
      const score = clamp(0.15 + 0.85 * ((st.sigIn + st.iniIn) / 2) ** 1.5, 0, 1);
      this.later(() => this.end(done, { score, skipped: false }, score >= 0.75 ? "Neat. Roy actually nods." : score >= 0.4 ? "Legible enough." : "That's… all over the page.", 900), 450);
    };
    const up = () => { if (cur) { cur = null; this.g.sfx.click(); refresh(); finish(); } };
    cv.onpointerup = up; cv.onpointercancel = up;
    p.querySelector<HTMLButtonElement>("#sgClear")!.onclick = () => { strokes = []; cur = null; refresh(); };
    p.querySelector<HTMLButtonElement>("#sgDone")!.onclick = () => {
      const st = stats(); if (!(st.sigLen > 70 && st.iniLen > 18)) return;
      // neat = stayed on the line / in the box
      const score = clamp(0.15 + 0.85 * ((st.sigIn + st.iniIn) / 2) ** 1.5, 0, 1);
      this.end(done, { score, skipped: false }, score >= 0.75 ? "Neat. Roy actually nods." : score >= 0.4 ? "Legible enough." : "That's… all over the page.");
    };
    refresh();
  }

  // ---------------------------------------------------------------- 2. PICK (quiz)
  pick(o: { eyebrow: string; title: string; intro: string; options: { label: string; correct: boolean }[]; need: number }, done: Done) {
    const opts = shuffle(o.options);
    const picked = new Set<number>();
    const list = opts.map((x, i) => `<button class="b alt opt" data-i="${i}">${x.label}</button>`).join("");
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, `<div class="btns" id="opts">${list}</div><div id="mgResult" class="hint">Pick ${o.need}.</div>`, `<button class="b" id="mgGo">SUBMIT</button>`));
    this.skip(done, p);
    p.querySelectorAll<HTMLButtonElement>(".opt").forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.i);
      if (picked.has(i)) { picked.delete(i); b.classList.add("alt"); } else if (picked.size < o.need) { picked.add(i); b.classList.remove("alt"); }
      this.g.sfx.click();
    });
    p.querySelector<HTMLButtonElement>("#mgGo")!.onclick = () => {
      let right = 0, wrong = 0; picked.forEach((i) => (opts[i].correct ? right++ : wrong++));
      const score = clamp((right - wrong * 0.5) / o.need, 0, 1);
      p.querySelectorAll<HTMLButtonElement>(".opt").forEach((b, i) => { b.disabled = true; b.style.outline = opts[i].correct ? "3px solid var(--green)" : picked.has(i) ? "3px solid var(--red)" : "none"; });
      this.end(done, { score, skipped: false }, score >= 0.99 ? "Perfect." : score > 0.5 ? "Mostly right." : "Not great.", 1400);
    };
  }

  // ---------------------------------------------------------------- 3. HOLD-TO-FILL (dosing)
  holdFill(o: { eyebrow: string; title: string; intro: string; unit: string; max: number; target: number; band: number; rate?: number; hold?: string }, done: Done) {
    let v = 0, holding = false, over = false, t = 0;
    const tp = (o.target / o.max) * 100, bp = (o.band / o.max) * 100;
    const body = `<div class="fillwrap"><div class="fillbar"><div class="fillband" style="left:${tp - bp}%;width:${bp * 2}%"></div><div class="fillfill" id="ff"></div></div>
      <div class="fillnum"><b id="fv">0.0</b> ${o.unit} <span class="hint">target ${o.target.toFixed(1)} ± ${o.band.toFixed(1)}</span></div></div>
      <div class="btns"><button class="b" id="mgHold" style="min-width:60%;min-height:60px">${o.hold ?? "HOLD TO ADD"}</button></div><div id="mgResult" class="hint">Hold the button, release when you hit the band. One shot.</div>`;
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, body));
    this.skip(done, p);
    const btn = p.querySelector<HTMLButtonElement>("#mgHold")!;
    const down = () => { if (this.alive && !over) holding = true; };
    const up = () => {
      if (!holding || !this.alive) return; holding = false; over = true;
      const err = Math.abs(v - o.target), score = clamp(1 - err / (o.band * 3), 0, 1);
      const msg = err <= o.band ? "In the band." : v < o.target ? "Came up short." : "Overshot.";
      this.end(done, { score, skipped: false, value: v }, `${msg} (${v.toFixed(2)} ${o.unit})`);
    };
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); down(); });
    window.addEventListener("pointerup", up); this.keyOff.push(() => window.removeEventListener("pointerup", up));
    this.key((e) => { if (e.code === "Space") { e.preventDefault(); down(); } });
    const ku = (e: KeyboardEvent) => { if (e.code === "Space") up(); };
    window.addEventListener("keyup", ku); this.keyOff.push(() => window.removeEventListener("keyup", ku));
    const ff = p.querySelector<HTMLElement>("#ff")!, fv = p.querySelector<HTMLElement>("#fv")!;
    const r = (o.rate ?? 0.35) * o.max;
    (this.g as any).miniTick = (dt: number) => {
      if (!this.alive) return; t += dt;
      if (holding) { v = Math.min(o.max, v + r * dt * (0.8 + 0.4 * Math.sin(t * 5.3) + 0.15 * Math.sin(t * 13))); }
      ff.style.width = (v / o.max) * 100 + "%"; fv.textContent = v.toFixed(2);
      if (v >= o.max && holding) up();
    };
  }

  // ---------------------------------------------------------------- 4. RHYTHM (count the joints)
  rhythm(o: { eyebrow: string; title: string; intro: string; count: number; unit: string }, done: Done) {
    const N = o.count, SP = 190, ZONE = 46;
    const joints: { x: number; hit: boolean; passed: boolean; el: HTMLElement }[] = [];
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, `<div class="belt" id="belt"><div class="beltzone"></div></div><div class="fillnum"><b id="rc">0</b> / ${N} ${o.unit}</div><div id="mgResult" class="hint">Press SPACE (or tap COUNT) as each one crosses the line.</div>`, `<button class="b" id="mgCount">COUNT</button>`));
    this.skip(done, p);
    const belt = p.querySelector<HTMLElement>("#belt")!, W = () => belt.clientWidth || 560;
    let gx = W() + 60;
    for (let i = 0; i < N; i++) { const el = document.createElement("div"); el.className = "joint"; belt.appendChild(el); joints.push({ x: gx, hit: false, passed: false, el }); gx += 125 + (i % 3) * 22; }   // always at least a joint-width of clear belt between them
    let hits = 0, misses = 0;
    const press = () => {
      if (!this.alive) return;
      const zx = 90; let best: typeof joints[0] | null = null, bd = 1e9;
      for (const j of joints) if (!j.hit && !j.passed) { const d = Math.abs(j.x - zx); if (d < bd) { bd = d; best = j; } }
      if (best && bd <= ZONE) { best.hit = true; best.el.classList.add("hit"); hits++; this.g.sfx.click(); p.querySelector("#rc")!.textContent = String(hits); }
      else { misses++; this.g.sfx.bad(); }
    };
    this.key((e) => { if (e.code === "Space") { e.preventDefault(); press(); } });
    p.querySelector<HTMLButtonElement>("#mgCount")!.addEventListener("pointerdown", (e) => { e.preventDefault(); press(); });
    (this.g as any).miniTick = (dt: number) => {
      if (!this.alive) return;
      let left = 0;
      for (const j of joints) { j.x -= SP * dt; j.el.style.transform = `translateX(${j.x}px)`; if (!j.hit && !j.passed && j.x < 90 - ZONE) { j.passed = true; j.el.classList.add("miss"); } if (j.x > -60) left++; }
      if (left === 0) { const score = clamp((hits - misses * 0.25) / N, 0, 1); this.end(done, { score, skipped: false, value: hits }, hits === N ? "Every joint accounted for." : `Counted ${hits} of ${N}.`); }
    };
  }

  // ---------------------------------------------------------------- 4b. TALLY (count the pipe in the bundle)
  /** An end-on view of a bundle of casing joints. Tap each one to tag it (so you never lose count), then report your total.
   *  The truck's ticket claims a number that may not match what is really on the truck. */
  tally(o: { eyebrow: string; title: string; intro: string; count: number; claim: number }, done: Done) {
    const N = o.count;
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro,
      `<div class="ticketline">DELIVERY TICKET: <b>${o.claim}</b> joints</div><div class="bundle" id="bundle"></div>
       <div class="fillnum">Tagged: <b id="tcnt">0</b></div><div id="mgResult" class="hint">Tap each joint as you count it. Tap a tagged joint to untag it. Missed some? Keep looking: they are packed in tight.</div>`,
      `<button class="b" id="tUntag">Clear tags</button><button class="b green" id="tDone">REPORT COUNT</button>`), undefined, true);
    this.skip(done, p);
    const bundle = p.querySelector<HTMLElement>("#bundle")!;
    // hex-packed rows of different lengths, with a little hand-stacked jitter, laid out from N
    const rows: number[] = []; let left = N, w = Math.max(3, Math.round(Math.sqrt(N * 1.4)));
    for (let r = 0; left > 0; r++) { const n = Math.min(left, r % 2 ? w - 1 : w); rows.push(n); left -= n; }
    const D = 38, tagged = new Set<number>(), els: HTMLElement[] = [];
    bundle.style.height = (rows.length * (D * 0.88) + 22) + "px";
    let idx = 0;
    rows.forEach((n, r) => {
      const x0 = (bundle.clientWidth || 520) / 2 - (n * D) / 2;
      for (let i = 0; i < n; i++) {
        const k = idx++, el = document.createElement("button"); el.className = "pipe";
        el.style.cssText = `left:${x0 + i * D + (Math.random() - 0.5) * 3}px;top:${8 + r * D * 0.88 + (Math.random() - 0.5) * 3}px;width:${D - 3}px;height:${D - 3}px`;
        el.addEventListener("pointerdown", (e) => {
          e.preventDefault(); if (!this.alive) return;
          if (tagged.has(k)) { tagged.delete(k); el.classList.remove("tag"); el.textContent = ""; } else { tagged.add(k); el.classList.add("tag"); this.g.sfx.click(); }
          // numbered in the order tapped so the count is visible on the pipe itself
          let n2 = 0; for (const j of [...tagged]) { n2++; els[j].textContent = String(n2); }
          p.querySelector("#tcnt")!.textContent = String(tagged.size);
        });
        bundle.appendChild(el); els.push(el);
      }
    });
    p.querySelector<HTMLButtonElement>("#tUntag")!.onclick = () => { tagged.clear(); els.forEach((e) => { e.classList.remove("tag"); e.textContent = ""; }); p.querySelector("#tcnt")!.textContent = "0"; };
    p.querySelector<HTMLButtonElement>("#tDone")!.onclick = () => {
      const n = tagged.size, off = Math.abs(n - N), score = clamp(1 - off / 4, 0, 1);
      this.end(done, { score, skipped: false, value: n, extra: N }, off === 0 ? `Exactly ${N}. ${N === o.claim ? "The ticket was right." : `The ticket said ${o.claim}: it was wrong.`}` : `You said ${n}. There were ${N}.`, 1800);
    };
  }

  // ---------------------------------------------------------------- 5. MASH (jammed latch)
  mash(o: { eyebrow: string; title: string; intro: string; seconds: number; label: string }, done: Done) {
    let prog = 0, last = "", t = o.seconds;
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, `<div class="fillbar big"><div class="fillfill" id="mf"></div></div><div class="btns"><button class="b" id="mA">◀ A</button><button class="b" id="mD">D ▶</button></div><div id="mgResult" class="hint">Alternate A and D (or tap the buttons) as fast as you can — ${o.label}</div>`));
    this.skip(done, p);
    const hit = (k: string) => { if (!this.alive || k === last) return; last = k; prog = Math.min(100, prog + 7); this.g.sfx.click(); };
    this.key((e) => { if (e.code === "KeyA" || e.code === "ArrowLeft") hit("A"); if (e.code === "KeyD" || e.code === "ArrowRight") hit("D"); });
    p.querySelector<HTMLButtonElement>("#mA")!.addEventListener("pointerdown", (e) => { e.preventDefault(); hit("A"); });
    p.querySelector<HTMLButtonElement>("#mD")!.addEventListener("pointerdown", (e) => { e.preventDefault(); hit("D"); });
    const mf = p.querySelector<HTMLElement>("#mf")!;
    (this.g as any).miniTick = (dt: number) => {
      if (!this.alive) return; t -= dt; mf.style.width = prog + "%";
      if (prog >= 100) { this.end(done, { score: clamp(0.6 + t / o.seconds * 0.4, 0, 1), skipped: false }, "It gives!"); return; }
      prog = Math.max(0, prog - 14 * dt);
      if (t <= 0) this.end(done, { score: 0.15, skipped: false }, "Out of time.");
    };
  }

  // ---------------------------------------------------------------- 6. REACTION
  reaction(o: { eyebrow: string; title: string; intro: string; rounds: number; goText: string; window?: number; feints?: number }, done: Done) {
    // `window` = how many ms you get to react; `feints` = chance (0..1) of a fake-out before each real strike, which you must NOT react to
    const WIN = o.window ?? 650, FEINT = o.feints ?? 0;
    let round = 0, wins = 0, armed = false, fake = false, t0 = 0;
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, `<div class="react" id="react">wait for it…</div><div id="mgResult" class="hint">Round 1 of ${o.rounds}. Click only when it says ${o.goText}${FEINT ? ". It will fake you out." : "."}</div>`));
    this.skip(done, p);
    const box = p.querySelector<HTMLElement>("#react")!;
    const status = () => { const r = document.getElementById("mgResult"); if (r && this.alive) r.textContent = `Round ${Math.min(round + 1, o.rounds)} of ${o.rounds}. ${wins} dodged.`; };
    const strike = () => {
      armed = true; t0 = performance.now(); box.textContent = o.goText; box.className = "react go"; this.g.sfx.horn();
      this.later(() => { if (armed) { armed = false; round++; box.textContent = "too slow"; box.className = "react bad"; status(); this.later(next, 600); } }, WIN);
    };
    const next = () => {
      if (round >= o.rounds) return this.end(done, { score: wins / o.rounds, skipped: false }, `${wins} of ${o.rounds}.`);
      armed = false; fake = false; box.textContent = "wait for it…"; box.className = "react";
      const wait = 900 + Math.random() * 2000;
      if (Math.random() < FEINT) {
        // a feint: it lunges and stops short. Clicking now is a flinch.
        this.later(() => { fake = true; box.textContent = "ssss…"; box.className = "react fake"; this.later(() => { fake = false; box.textContent = "wait for it…"; box.className = "react"; this.later(strike, 350 + Math.random() * 1100); }, 380 + Math.random() * 250); }, wait * 0.7);
      } else this.later(strike, wait);
    };
    box.addEventListener("pointerdown", (e) => {
      e.preventDefault(); if (!this.alive) return;
      if (armed) { armed = false; wins++; round++; box.textContent = `${Math.round(performance.now() - t0)} ms`; box.className = "react ok"; status(); this.later(next, 600); }
      else if (fake || box.className === "react") { round++; fake = false; box.textContent = fake ? "flinched" : "too early"; box.className = "react bad"; this.g.sfx.bad(); status(); this.later(next, 700); }
    });
    next();
  }

  // ---------------------------------------------------------------- 7. WIRES
  wires(o: { eyebrow: string; title: string; intro: string; clue: string; fixed?: boolean; colors: { name: string; hex: string; correct: boolean }[] }, done: Done) {
    const ws = o.fixed ? o.colors : shuffle(o.colors);
    const html = ws.map((w, i) => `<button class="wire" data-i="${i}" style="--w:${w.hex}"><span>${w.name}</span></button>`).join("");
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, `<div class="note">${o.clue}</div><div class="wires">${html}</div><div id="mgResult" class="hint">Cut one. You only get one.</div>`));
    this.skip(done, p);
    p.querySelectorAll<HTMLButtonElement>(".wire").forEach((b) => b.onclick = () => {
      const w = ws[Number(b.dataset.i)]; b.classList.add("cut");
      this.end(done, { score: w.correct ? 1 : 0, skipped: false }, w.correct ? "Snip. Silence." : "Snip… that was the wrong one.", 1300);
    });
  }

  // ---------------------------------------------------------------- 8. TYPING
  typing(o: { eyebrow: string; title: string; intro: string; text: string; seconds: number }, done: Done) {
    let t = o.seconds, typed = "";
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, `<div class="typetext" id="tt"></div><input id="ti" class="typein" autocomplete="off" autocapitalize="off" spellcheck="false" /><div class="fillnum"><b id="tl">${o.seconds}</b>s</div><div id="mgResult" class="hint">Type it exactly.</div>`));
    this.skip(done, p);
    const ti = p.querySelector<HTMLInputElement>("#ti")!, tt = p.querySelector<HTMLElement>("#tt")!;
    const draw = () => {
      let h = ""; for (let i = 0; i < o.text.length; i++) { const ch = o.text[i] === " " ? "&nbsp;" : o.text[i]; h += i < typed.length ? `<span class="${typed[i] === o.text[i] ? "tg" : "tb"}">${ch}</span>` : `<span>${ch}</span>`; } tt.innerHTML = h;
    };
    draw(); setTimeout(() => ti.focus(), 50);
    ti.addEventListener("input", () => {
      typed = ti.value; draw();
      if (typed.length >= o.text.length) { let ok = 0; for (let i = 0; i < o.text.length; i++) if (typed[i] === o.text[i]) ok++; this.end(done, { score: clamp(ok / o.text.length, 0, 1) * (0.7 + 0.3 * (t / o.seconds)), skipped: false }, ok === o.text.length ? "Flawless." : "Good enough for Houston."); }
    });
    (this.g as any).miniTick = (dt: number) => {
      if (!this.alive) return; t -= dt; (p.querySelector("#tl") as HTMLElement).textContent = String(Math.max(0, Math.ceil(t)));
      if (t <= 0) { let ok = 0; for (let i = 0; i < typed.length && i < o.text.length; i++) if (typed[i] === o.text[i]) ok++; this.end(done, { score: clamp(ok / o.text.length, 0, 1) * 0.6, skipped: false }, "Time."); }
    };
  }

  // ---------------------------------------------------------------- 9. WHACK (click the moving targets)
  whack(o: { eyebrow: string; title: string; intro: string; label: string; count: number; seconds: number; speed?: number; size?: number; life?: number }, done: Done) {
    const SPD = o.speed ?? 1, SZ = o.size ?? 40, LIFE = o.life ?? 1e9;
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, `<div class="arena" id="arena"></div><div class="fillnum"><b id="wh">0</b> / ${o.count} <span class="hint" id="wt"></span></div><div id="mgResult" class="hint">Click every ${o.label} before the time runs out.</div>`));
    this.skip(done, p);
    const arena = p.querySelector<HTMLElement>("#arena")!;
    const ts: { x: number; y: number; vx: number; vy: number; el: HTMLElement; dead: boolean; born: number }[] = [];
    let spawned = 0, hits = 0, t = o.seconds, spawnT = 0;
    const spawn = () => {
      const el = document.createElement("button"); el.className = "tgt"; el.textContent = o.label.slice(0, 1).toUpperCase(); el.style.width = el.style.height = SZ + "px"; el.style.fontSize = Math.round(SZ * 0.5) + "px"; arena.appendChild(el);
      const W = arena.clientWidth || 520, H = arena.clientHeight || 200;
      const o2 = { x: Math.random() * (W - SZ), y: Math.random() * (H - SZ), vx: (Math.random() - 0.5) * 160 * SPD, vy: (Math.random() - 0.5) * 110 * SPD, el, dead: false, born: t };
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); if (o2.dead || !this.alive) return; o2.dead = true; el.classList.add("dead"); hits++; this.g.sfx.click(); p.querySelector("#wh")!.textContent = String(hits); });
      ts.push(o2); spawned++;
    };
    (this.g as any).miniTick = (dt: number) => {
      if (!this.alive) return; t -= dt; spawnT -= dt;
      const W = arena.clientWidth || 520, H = arena.clientHeight || 200;
      if (spawned < o.count && spawnT <= 0) { spawn(); spawnT = (o.seconds * 0.7) / o.count; }
      for (const q of ts) { if (q.dead) continue; if (q.born - t > LIFE) { q.dead = true; q.el.classList.add("dead"); q.el.style.opacity = "0.12"; continue; }   // it slipped away
        q.x += q.vx * dt; q.y += q.vy * dt; if (q.x < 0 || q.x > W - SZ) q.vx *= -1; if (q.y < 0 || q.y > H - SZ) q.vy *= -1; q.x = clamp(q.x, 0, W - SZ); q.y = clamp(q.y, 0, H - SZ); q.el.style.transform = `translate(${q.x}px,${q.y}px)`; }
      (p.querySelector("#wt") as HTMLElement).textContent = `${Math.max(0, Math.ceil(t))}s`;
      if (hits >= o.count || t <= 0 || (spawned >= o.count && ts.every((q) => q.dead))) this.end(done, { score: hits / o.count, skipped: false, value: hits }, hits === o.count ? "All of them." : `${hits} of ${o.count}.`);
    };
  }

  // ---------------------------------------------------------------- 9b. SLIPS (timing bar)
  slips(done: Done) {
    let t = 0, hits = 0, tries = 0;
    const p = this.open(this.shell("Drill Floor", "Pull the Slips", "The floorhands are in the porta john and a connection is up. Hit SET SLIPS while the marker is in the green. Three clean sets.",
      `<div class="slipbar"><div class="zone"></div><div class="mk" id="mk"></div></div><div class="row"><span>Clean sets</span><b id="sh">0 / 3</b></div><div id="mgResult" class="hint">Space or tap.</div>`, `<button class="b" id="mgSet">SET SLIPS</button>`));
    this.skip(done, p);
    const act = () => {
      if (!this.alive) return; tries++;
      const pos = (Math.sin(t * 3.1) + 1) / 2, ok = pos > 0.42 && pos < 0.58;
      const res = document.getElementById("mgResult")!;
      if (ok) { hits++; res.textContent = "Slips set. Clean."; this.g.sfx.good(); } else { res.textContent = pos < 0.5 ? "Too early — the string bounced." : "Too late — pipe's sliding!"; this.g.sfx.bad(); this.g.sim.addCost(2000); }
      document.getElementById("sh")!.textContent = `${hits} / 3`;
      if (hits >= 3) this.end(done, { score: clamp(3 / tries, 0.3, 1), skipped: false, value: tries }, "Pipe is hung in the slips.");
    };
    this.key((e) => { if (e.code === "Space") { e.preventDefault(); act(); } });
    p.querySelector<HTMLButtonElement>("#mgSet")!.addEventListener("pointerdown", (e) => { e.preventDefault(); act(); });
    const mk = p.querySelector<HTMLElement>("#mk")!;
    this.g.miniTick = (dt: number) => { if (!this.alive) return; t += dt; mk.style.left = `calc(${((Math.sin(t * 3.1) + 1) / 2) * 100}% - 3px)`; };
  }

  // ---------------------------------------------------------------- 10. DRILL-OFF TEST (autodriller)
  drillOff(done: Done) {
    const s = this.g.sim.s, f = formationAt(s.depth), wopt = woptFor(f);
    const W0 = Math.min(70, wopt * 2.1), rate = 4.2;                     // klbs/s bleeding off
    const fac = (this.g.sim as any).ropFactor?.() ?? 1;
    const ropAt = (w: number) => { const e = w <= wopt ? w : wopt + (w - wopt) * 0.3; return Math.min(380, (e * 6 / f.hardness) * fac) * (1 + (Math.random() - 0.5) * 0.08); };
    const pts: [number, number][] = []; let w = W0, marked: number | null = null, t = 0, running = true;
    const p = this.open(this.shell("Autodriller", "Drill-Off Test", "Lock the brake and let the string drill off weight. Plot ROP against WOB, then mark where adding weight stops paying — the knee of the curve.",
      `<canvas id="dochart" width="600" height="230" class="dochart"></canvas><div class="fillnum">WOB <b id="dow">${W0.toFixed(0)}</b> klbs · ROP <b id="dor">0</b> ft/hr</div><div id="mgResult" class="hint">Click MARK when ROP starts to fall off steeply as weight comes off.</div>`,
      `<button class="b" id="doMark">MARK OPTIMUM</button>`), undefined, true);
    this.skip(done, p);
    const cv = p.querySelector<HTMLCanvasElement>("#dochart")!, c = cv.getContext("2d")!;
    const maxR = ropAt(W0 + 0.01) * 1.25 + 40;
    const X = (wv: number) => 40 + ((W0 - wv) / W0) * 540, Y = (r: number) => 210 - (r / Math.max(120, maxR)) * 190;
    const draw = () => {
      c.clearRect(0, 0, 600, 230); c.fillStyle = "#0b1118"; c.fillRect(0, 0, 600, 230);
      c.strokeStyle = "#243445"; c.lineWidth = 1; for (let i = 0; i <= 6; i++) { c.beginPath(); c.moveTo(40 + i * 90, 10); c.lineTo(40 + i * 90, 210); c.stroke(); }
      c.fillStyle = "#93a4b5"; c.font = "11px sans-serif"; for (let i = 0; i <= 6; i++) c.fillText(String(Math.round(W0 - (i / 6) * W0)), 34 + i * 90, 224);
      c.fillText("WOB (klbs) →  weight bleeds off", 220, 12);
      c.strokeStyle = "#f4c04a"; c.lineWidth = 2; c.beginPath(); pts.forEach((q, i) => { const x = X(q[0]), y = Y(q[1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
      if (marked !== null) { c.strokeStyle = "#3dbb6a"; c.beginPath(); c.moveTo(X(marked), 10); c.lineTo(X(marked), 210); c.stroke(); }
    };
    const mark = () => {
      if (!this.alive || marked !== null || pts.length < 8) return;
      marked = w; running = false; draw();
      const err = Math.abs(marked - wopt), score = clamp(1 - err / 9, 0, 1);
      this.g.flags.drillOffWopt = Math.round(marked);
      this.end(done, { score, skipped: false, value: marked, extra: wopt }, err <= 3 ? `Right on the knee: about ${marked.toFixed(0)} klbs.` : err <= 7 ? `Close — call it ${marked.toFixed(0)} klbs.` : `Noisy data. You read ${marked.toFixed(0)} klbs.`, 1800);
    };
    p.querySelector<HTMLButtonElement>("#doMark")!.onclick = mark;
    this.key((e) => { if (e.code === "Space") { e.preventDefault(); mark(); } });
    (this.g as any).miniTick = (dt: number) => {
      if (!this.alive || !running) return; t += dt; w = Math.max(2, W0 - rate * t); const r = ropAt(w); pts.push([w, r]);
      p.querySelector("#dow")!.textContent = w.toFixed(0); p.querySelector("#dor")!.textContent = String(Math.round(r)); draw();
      if (w <= 3) { running = false; this.end(done, { score: 0.1, skipped: false }, "The string drilled off before you marked anything."); }
    };
  }
}
