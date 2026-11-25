import type { Game } from "./game";

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
      ctx.fillText("Big Al Drilling · Rig 107 · I have read the site safety rules and agree to follow them.", 24, 56);
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
    /** keep the signature (not the initials) from the first sheet of the run, as a small transparent PNG: it goes on the high-score board */
    const saveSig = () => {
      if (this.g.flags.sig) return;
      try {
        const off = document.createElement("canvas"); off.width = 360; off.height = 90; const o = off.getContext("2d")!;
        o.strokeStyle = "#101c4a"; o.lineWidth = 2.6; o.lineCap = "round"; o.lineJoin = "round"; o.translate(-(SIG.x - 10), -(SIG.y - 20));
        for (const s of strokes) { if (s[0].x >= INI.x - 10) continue; o.beginPath(); s.forEach((q, i) => (i ? o.lineTo(q.x, q.y) : o.moveTo(q.x, q.y))); if (s.length === 1) o.lineTo(s[0].x + 0.1, s[0].y); o.stroke(); }
        this.g.flags.sig = off.toDataURL("image/png");
      } catch { /* a missing signature is not the end of the world */ }
    };
    let finishing = false;
    const finish = () => {
      if (finishing) return; const st = stats(); if (!(st.sigLen > 70 && st.iniLen > 18)) return;
      finishing = true; saveSig();                              // signed and initialled: hand it back automatically
      const score = clamp(0.15 + 0.85 * ((st.sigIn + st.iniIn) / 2) ** 1.5, 0, 1);
      this.later(() => this.end(done, { score, skipped: false }, score >= 0.75 ? "Neat. Roy actually nods." : score >= 0.4 ? "Legible enough." : "That's… all over the page.", 900), 450);
    };
    const up = () => { if (cur) { cur = null; this.g.sfx.click(); refresh(); finish(); } };
    cv.onpointerup = up; cv.onpointercancel = up;
    p.querySelector<HTMLButtonElement>("#sgClear")!.onclick = () => { strokes = []; cur = null; refresh(); };
    p.querySelector<HTMLButtonElement>("#sgDone")!.onclick = () => {
      const st = stats(); if (!(st.sigLen > 70 && st.iniLen > 18)) return;
      saveSig();
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

  // ---------------------------------------------------------------- 9b. SLIPS: the real loop. The driller bobs the string and fakes you out.
  slips(done: Done) {
    // h = how far the joint is from the right height above the rotary (m); v = its speed. Slips only bite when it is level AND still.
    let h = 1.7, v = 0, t = 0, fails = 0, ok = false, finished = false;
    type Leg = { to: number; speed: number; hold: number };
    const fakeCount = 2 + ((Math.random() * 2) | 0);
    const legs: Leg[] = [];
    let side = Math.random() < 0.5 ? 1 : -1;
    for (let i = 0; i < fakeCount; i++) { legs.push({ to: side * (0.32 + Math.random() * 0.5), speed: 0.7 + Math.random() * 0.5, hold: 0.45 + Math.random() * 0.55 }); side *= -1; }
    legs.push({ to: 0, speed: 0.55, hold: 1.05 });                     // the real stop
    legs.push({ to: 1.7, speed: 0.9, hold: 0.2 });                      // …then he hoists it away again
    let li = 0, holdT = 0, ph = 0;
    const W = 300, H = 330;
    const body = `<div style="display:flex;justify-content:center;margin:8px 0"><canvas id="sl" width="${W}" height="${H}" style="width:min(100%,${W}px);aspect-ratio:${W}/${H};background:#0c1219;border:2px solid var(--line)"></canvas></div>
      <div class="row"><span>Sets that failed</span><b id="slf">0 / 3</b></div><div id="mgResult" class="hint">Dale is "helping". Wait until the joint is level with the bowl and has STOPPED, then set the slips. Moving pipe will jerk right out of them.</div>`;
    const p = this.open(this.shell("Drill Floor", "Set the Slips", "The floorhands are locked in the porta john, and Dale has been bobbing the string up and down for ten minutes, just to watch you flinch. Set the slips on the pipe body when the joint is steady at the right height.", body, `<button class="b" id="mgSet">SET SLIPS</button>`));
    this.skip(done, p);
    const cv = p.querySelector<HTMLCanvasElement>("#sl")!, c = cv.getContext("2d")!;
    const set = () => {
      if (!this.alive || finished) return;
      const good = Math.abs(h) < 0.1 && Math.abs(v) < 0.07;
      const res = document.getElementById("mgResult")!;
      if (good) { finished = true; ok = true; this.g.sfx.good(); this.end(done, { score: fails ? 0.65 : 1, skipped: false, value: fails }, "Slips are in. The pipe is hung."); return; }
      fails++; this.g.sfx.bad(); this.g.sim.addCost(3000);
      document.getElementById("slf")!.textContent = `${fails} / 3`;
      res.textContent = Math.abs(v) > 0.07 ? "The string was still moving. It tore through the slips." : "Wrong height. The slips grabbed the tool joint.";
      if (fails >= 3) { finished = true; this.end(done, { score: 0, skipped: false, value: fails }, "The pipe went right through. Fishing job."); }
    };
    this.key((e) => { if (e.code === "Space") { e.preventDefault(); set(); } });
    p.querySelector<HTMLButtonElement>("#mgSet")!.addEventListener("pointerdown", (e) => { e.preventDefault(); set(); });
    const px = 95;                              // pixels per metre
    this.g.miniTick = (dt: number) => {
      if (!this.alive || finished) return;
      t += dt; ph += dt;
      const leg = legs[li];
      if (Math.abs(h - leg.to) > 0.02 && holdT <= 0) { const dir = Math.sign(leg.to - h); v = dir * Math.min(leg.speed, Math.abs(leg.to - h) / Math.max(dt, 0.001) * 0.5 + 0.06); h += v * dt; if ((leg.to - h) * dir < 0) h = leg.to; }
      else { v = (Math.random() - 0.5) * (leg.to === 0 ? 0.02 : 0.1); h += v * dt; holdT += dt; if (holdT >= leg.hold) { li = li + 1 < legs.length ? li + 1 : 0; holdT = 0; if (li === 0) { /* he hoisted it out and started over */ legs.length = 0; let s2 = Math.random() < 0.5 ? 1 : -1; const n = 2 + ((Math.random() * 2) | 0); for (let i = 0; i < n; i++) { legs.push({ to: s2 * (0.32 + Math.random() * 0.5), speed: 0.7 + Math.random() * 0.5, hold: 0.45 + Math.random() * 0.55 }); s2 *= -1; } legs.push({ to: 0, speed: 0.55, hold: 1.05 }, { to: 1.7, speed: 0.9, hold: 0.2 }); h = 1.7; } } }
      // ---- draw
      const tableY = 262, jointY = tableY - 0.8 * px - h * px, cx = W / 2;
      c.clearRect(0, 0, W, H); c.fillStyle = "#0c1219"; c.fillRect(0, 0, W, H);
      const aligned = Math.abs(h) < 0.1 && Math.abs(v) < 0.07;
      // derrick shadow lines
      c.strokeStyle = "#16212d"; c.lineWidth = 1; for (let y = 10; y < H; y += 30) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      // pipe body (hangs down through the rotary)
      c.fillStyle = "#8d9299"; c.fillRect(cx - 12, 0, 24, tableY + 60);
      c.fillStyle = "#6a7078"; c.fillRect(cx + 3, 0, 9, tableY + 60);
      // hatched SLIPS ZONE on the body, between the table and the tool joint
      c.save(); c.beginPath(); c.rect(cx - 12, jointY + 36, 24, 62); c.clip();
      c.fillStyle = "rgba(244,192,74,.28)"; c.fillRect(cx - 12, jointY + 36, 24, 62);
      c.strokeStyle = "#f4c04a"; c.lineWidth = 3; for (let k = -80; k < 100; k += 11) { c.beginPath(); c.moveTo(cx - 14, jointY + 36 + k); c.lineTo(cx + 14, jointY + 36 + k + 24); c.stroke(); }
      c.restore();
      // tool joint (the fat upset end) with its yellow band
      c.fillStyle = "#a6acb4"; c.fillRect(cx - 19, jointY - 6, 38, 42); c.fillStyle = "#e8b923"; c.fillRect(cx - 19, jointY + 8, 38, 9);
      c.strokeStyle = "#2a2f35"; c.lineWidth = 2; c.strokeRect(cx - 19, jointY - 6, 38, 42);
      // rotary table + slip bowl
      c.fillStyle = "#2a3038"; c.fillRect(20, tableY, W - 40, 34); c.fillStyle = "#3a424c"; c.fillRect(20, tableY, W - 40, 8);
      c.fillStyle = "#0c1219"; c.fillRect(cx - 24, tableY, 48, 34);
      c.fillStyle = "#8d9299"; c.fillRect(cx - 12, tableY, 24, 34);
      c.strokeStyle = aligned ? "#3dbb6a" : "#f4c04a"; c.lineWidth = aligned ? 4 : 2; c.strokeRect(cx - 26, tableY - 3, 52, 8);
      // target gauge on the right: where the joint is vs where it should be
      c.fillStyle = "#16212d"; c.fillRect(W - 34, 20, 14, 230); c.fillStyle = "#3dbb6a55"; c.fillRect(W - 34, 20 + 115 - 9, 14, 18);
      const my = 20 + 115 - (h / 1.8) * 105; c.fillStyle = aligned ? "#3dbb6a" : "#fff"; c.fillRect(W - 38, my - 3, 22, 6);
      c.fillStyle = "#93a4b5"; c.font = "10px sans-serif"; c.fillText("LEVEL", W - 41, 14);
    };
  }

  // ---------------------------------------------------------------- 10. LIGHTS-OUT (flush a clogged shaker screen)
  lightsOut(o: { eyebrow: string; title: string; intro: string; size?: number }, done: Done) {
    const N = o.size ?? 4;
    const grid: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));
    const press = (g: boolean[][], x: number, y: number) => { for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < N && yy >= 0 && yy < N) g[yy][xx] = !g[yy][xx]; } };
    let par = 0; const lit = () => grid.flat().filter(Boolean).length;
    while (lit() < 4 || par < N + 2) { press(grid, (Math.random() * N) | 0, (Math.random() * N) | 0); par++; if (par > 40) break; }
    const start = grid.map((r) => [...r]);
    let moves = 0;
    const body = `<div class="lo-grid" id="lo" style="grid-template-columns:repeat(${N},1fr)"></div><div class="row"><span>Flushes</span><b id="lom">0</b></div><div id="mgResult" class="hint">Each flush clears a cell and its four neighbours — but also re-clogs any clear ones. Clear the whole screen.</div>`;
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, body, `<button class="b alt" id="loReset">RESET</button>`));
    this.skip(done, p);
    const box = p.querySelector<HTMLElement>("#lo")!;
    const draw = () => { box.innerHTML = grid.map((row, y) => row.map((on, x) => `<button class="lo ${on ? "on" : ""}" data-x="${x}" data-y="${y}"></button>`).join("")).join(""); box.querySelectorAll<HTMLButtonElement>(".lo").forEach((b) => b.onclick = () => click(Number(b.dataset.x), Number(b.dataset.y))); };
    const click = (x: number, y: number) => {
      if (!this.alive) return; press(grid, x, y); moves++; this.g.sfx.click(); document.getElementById("lom")!.textContent = String(moves); draw();
      if (lit() === 0) this.end(done, { score: moves <= par + 4 ? 1 : 0.7, skipped: false, value: moves }, "Screen is clean. Mud is flowing again.");
    };
    p.querySelector<HTMLButtonElement>("#loReset")!.onclick = () => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) grid[y][x] = start[y][x]; moves = 0; document.getElementById("lom")!.textContent = "0"; draw(); };
    draw();
  }

  // ---------------------------------------------------------------- 11. PIPES (rotate the lines to connect source to sink)
  pipes(o: { eyebrow: string; title: string; intro: string; from: string; to: string; cols?: number; rows?: number }, done: Done) {
    const C = o.cols ?? 5, R = o.rows ?? 4, N = 1, E = 2, S = 4, Wd = 8;
    const rot = (m: number) => ((m << 1) & 15) | ((m >> 3) & 1);
    // a random self-avoiding route from the top-left to the bottom-right, so it is always solvable
    let path: [number, number][] = [];
    for (let tries = 0; tries < 300; tries++) {
      path = [[0, 0]]; const seen = new Set(["0,0"]); let x = 0, y = 0, guard = 0;
      while ((x !== C - 1 || y !== R - 1) && guard++ < 60) {
        const opts = ([[1, 0], [0, 1], [-1, 0], [0, -1]] as [number, number][]).filter(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && nx < C && ny >= 0 && ny < R && !seen.has(nx + "," + ny); });
        if (!opts.length) break;
        const fwd = opts.filter(([dx, dy]) => dx > 0 || dy > 0), pool = Math.random() < 0.6 && fwd.length ? fwd : opts, [dx, dy] = pool[(Math.random() * pool.length) | 0];
        x += dx; y += dy; seen.add(x + "," + y); path.push([x, y]);
      }
      if (x === C - 1 && y === R - 1 && path.length >= C + R + 1) break;
      if (tries === 299) { path = []; for (let i = 0; i < C; i++) path.push([i, 0]); for (let j = 1; j < R; j++) path.push([C - 1, j]); }
    }
    const mask: number[][] = Array.from({ length: R }, () => Array(C).fill(0));
    const bit = (dx: number, dy: number) => (dx === 1 ? E : dx === -1 ? Wd : dy === 1 ? S : N);
    for (let i = 0; i < path.length; i++) {
      const [x, y] = path[i];
      if (i === 0) mask[y][x] |= Wd; if (i === path.length - 1) mask[y][x] |= E;
      if (i > 0) mask[y][x] |= bit(path[i - 1][0] - x, path[i - 1][1] - y);
      if (i < path.length - 1) mask[y][x] |= bit(path[i + 1][0] - x, path[i + 1][1] - y);
    }
    const onPath = new Set(path.map((q) => q[0] + "," + q[1]));
    const shapes = [5, 10, 3, 6, 12, 9, 7, 11, 13, 14];
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (!onPath.has(x + "," + y)) mask[y][x] = Math.random() < 0.12 ? 0 : shapes[(Math.random() * shapes.length) | 0];
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) for (let k = (Math.random() * 4) | 0; k > 0; k--) mask[y][x] = rot(mask[y][x]);
    const flow = (): Set<string> => {
      const seen = new Set<string>(); if (!(mask[0][0] & Wd)) return seen;
      const q: [number, number][] = [[0, 0]]; seen.add("0,0");
      while (q.length) {
        const [x, y] = q.pop()!, m = mask[y][x];
        for (const [dx, dy, b, ob] of [[1, 0, E, Wd], [-1, 0, Wd, E], [0, 1, S, N], [0, -1, N, S]] as [number, number, number, number][]) {
          const nx = x + dx, ny = y + dy; if (!(m & b) || nx < 0 || nx >= C || ny < 0 || ny >= R || seen.has(nx + "," + ny)) continue;
          if (mask[ny][nx] & ob) { seen.add(nx + "," + ny); q.push([nx, ny]); }
        }
      }
      return seen;
    };
    const svg = (m: number, wet: boolean) => {
      const col = wet ? "#4aa3e8" : "#8d9299", L = (x1: number, y1: number) => `<line x1="30" y1="30" x2="${x1}" y2="${y1}" stroke="${col}" stroke-width="12" stroke-linecap="round"/>`;
      return `<svg viewBox="0 0 60 60" width="100%" height="100%">${m & N ? L(30, 0) : ""}${m & E ? L(60, 30) : ""}${m & S ? L(30, 60) : ""}${m & Wd ? L(0, 30) : ""}${m ? `<circle cx="30" cy="30" r="8" fill="${col}"/>` : ""}</svg>`;
    };
    let moves = 0;
    const body = `<div class="pp-wrap"><div class="pp-end">${o.from}</div><div class="pp-grid" id="pp" style="grid-template-columns:repeat(${C},1fr)"></div><div class="pp-end">${o.to}</div></div><div class="row"><span>Turns</span><b id="ppm">0</b></div><div id="mgResult" class="hint">Click a section to rotate it. Connect the line all the way across.</div>`;
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, body));
    this.skip(done, p);
    const box = p.querySelector<HTMLElement>("#pp")!;
    const draw = () => {
      const wet = flow();
      box.innerHTML = mask.map((row, y) => row.map((m, x) => `<button class="pp ${wet.has(x + "," + y) ? "wet" : ""}" data-x="${x}" data-y="${y}">${svg(m, wet.has(x + "," + y))}</button>`).join("")).join("");
      box.querySelectorAll<HTMLButtonElement>(".pp").forEach((b) => b.onclick = () => { if (!this.alive) return; const x = Number(b.dataset.x), y = Number(b.dataset.y); mask[y][x] = rot(mask[y][x]); moves++; this.g.sfx.click(); document.getElementById("ppm")!.textContent = String(moves); draw(); });
      if (wet.has((C - 1) + "," + (R - 1)) && (mask[R - 1][C - 1] & E)) this.end(done, { score: moves <= path.length * 2 + 4 ? 1 : 0.75, skipped: false, value: moves }, "Pressure's through. The lines are lined up.");
    };
    draw();
  }

  // ---------------------------------------------------------------- 12. ASSIGN (logic puzzle: put everybody where they belong)
  assign(o: { eyebrow: string; title: string; intro: string; people: string[]; slots: string[]; clues: string[]; solution: number[] }, done: Done) {
    let tries = 0;
    const rows = o.people.map((n, i) => `<div class="asg"><span>${n}</span><select data-i="${i}"><option value="-1">— pick a station —</option>${o.slots.map((s, k) => `<option value="${k}">${s}</option>`).join("")}</select></div>`).join("");
    const body = `<div class="note"><b>Clues</b><ul style="margin:6px 0 0 18px;padding:0">${o.clues.map((c) => `<li>${c}</li>`).join("")}</ul></div>${rows}<div id="mgResult" class="hint">Everybody gets a different station.</div>`;
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, body, `<button class="b" id="asGo">ASSIGN THE CREW</button>`));
    this.skip(done, p);
    p.querySelector<HTMLButtonElement>("#asGo")!.onclick = () => {
      if (!this.alive) return;
      const pick = [...p.querySelectorAll<HTMLSelectElement>("select")].map((s) => Number(s.value));
      const res = document.getElementById("mgResult")!;
      if (pick.some((x) => x < 0)) { res.textContent = "Somebody still has no station."; return; }
      if (new Set(pick).size < pick.length) { res.textContent = "Two people can't hold the same station."; this.g.sfx.bad(); return; }
      const right = pick.filter((x, i) => x === o.solution[i]).length; tries++;
      if (right === o.solution.length) { this.end(done, { score: tries === 1 ? 1 : tries === 2 ? 0.8 : 0.6, skipped: false, value: tries }, "That works. Nobody is mad. Yet."); return; }
      this.g.sfx.bad();
      if (tries >= 3) { this.end(done, { score: 0.2, skipped: false, value: tries }, "Earl takes the list, sighs, and does it himself."); return; }
      res.textContent = `${right} of ${o.solution.length} are in the right spot. Reread the clues. (${3 - tries} tries left)`;
    };
  }

  // ---------------------------------------------------------------- 13. ORDER CASING (pack the truck to the number)
  orderCasing(o: { eyebrow: string; title: string; intro: string; min: number; max: number; maxBundles: number; sizes: number[] }, done: Done) {
    const qty = o.sizes.map(() => 0);
    const rows = o.sizes.map((s, i) => `<div class="asg"><span>${s}-joint bundle <small class="hint">(${(s * 40).toLocaleString()} ft)</small></span><span class="qty"><button class="b alt" data-i="${i}" data-d="-1">−</button><b id="q${i}">0</b><button class="b alt" data-i="${i}" data-d="1">+</button></span></div>`).join("");
    const body = `<div class="note">Target: <b>${o.min}–${o.max} joints</b> (the hole, plus a little spare). The truck takes <b>${o.maxBundles}</b> bundles at most.</div>${rows}
      <div class="row"><span>Total</span><b id="ot">0 joints · 0 bundles</b></div><div id="mgResult" class="hint">Mix bundle sizes to land in the range.</div>`;
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, body, `<button class="b green" id="ocGo" disabled>ORDER IT</button>`));
    this.skip(done, p);
    const calc = () => {
      const joints = qty.reduce((a, q, i) => a + q * o.sizes[i], 0), bundles = qty.reduce((a, q) => a + q, 0);
      const okRange = joints >= o.min && joints <= o.max && bundles <= o.maxBundles && bundles > 0;
      document.getElementById("ot")!.textContent = `${joints} joints · ${bundles} bundles`; document.getElementById("ot")!.className = okRange ? "ok" : bundles > o.maxBundles ? "bad" : "";
      (document.getElementById("ocGo") as HTMLButtonElement).disabled = !okRange;
      document.getElementById("mgResult")!.textContent = bundles > o.maxBundles ? "That's more bundles than the truck can carry." : joints > o.max ? "Too much casing — Houston will notice." : joints < o.min ? "Short. You'd be running to town for joints." : "That's a legitimate order.";
      return { joints, bundles };
    };
    p.querySelectorAll<HTMLButtonElement>("button[data-d]").forEach((b) => b.onclick = () => { const i = Number(b.dataset.i), d = Number(b.dataset.d); qty[i] = Math.max(0, qty[i] + d); document.getElementById("q" + i)!.textContent = String(qty[i]); this.g.sfx.click(); calc(); });
    p.querySelector<HTMLButtonElement>("#ocGo")!.onclick = () => { const r = calc(); if (r.joints >= o.min) this.end(done, { score: 1, skipped: false, value: r.joints }, `Ordered ${r.joints} joints.`); };
  }

  // ---------------------------------------------------------------- 14. TRAP THE SNAKE (hex pen puzzle: block it in before it reaches the edge)
  snakeTrap(o: { eyebrow: string; title: string; intro: string }, done: Done) {
    const W = 11, H = 9; let sx = 5, sy = 4, over = false;
    const blocked: boolean[][] = Array.from({ length: H }, () => Array(W).fill(false));
    for (let k = 0; k < 11; k++) { const x = (Math.random() * W) | 0, y = (Math.random() * H) | 0; if ((x === sx && y === sy) || (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1)) continue; blocked[y][x] = true; }
    const nb = (x: number, y: number): [number, number][] => (y % 2 === 0
      ? [[x - 1, y], [x + 1, y], [x - 1, y - 1], [x, y - 1], [x - 1, y + 1], [x, y + 1]]
      : [[x - 1, y], [x + 1, y], [x, y - 1], [x + 1, y - 1], [x, y + 1], [x + 1, y + 1]]).filter(([a, b]) => a >= 0 && a < W && b >= 0 && b < H) as [number, number][];
    const edge = (x: number, y: number) => x === 0 || y === 0 || x === W - 1 || y === H - 1;
    const dists = (): number[][] => {
      const d: number[][] = Array.from({ length: H }, () => Array(W).fill(Infinity)); const q: [number, number][] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (edge(x, y) && !blocked[y][x]) { d[y][x] = 0; q.push([x, y]); }
      for (let i = 0; i < q.length; i++) { const [x, y] = q[i]; for (const [a, b] of nb(x, y)) if (!blocked[b][a] && d[b][a] === Infinity) { d[b][a] = d[y][x] + 1; q.push([a, b]); } }
      return d;
    };
    const body = `<div class="hex" id="hx"></div><div id="mgResult" class="hint">Click a free tile to drop a crate on it. The rattler moves one tile every time you do. Pen it in before it reaches the edge.</div>`;
    const p = this.open(this.shell(o.eyebrow, o.title, o.intro, body));
    this.skip(done, p);
    const box = p.querySelector<HTMLElement>("#hx")!;
    const draw = () => {
      box.innerHTML = Array.from({ length: H }, (_, y) => `<div class="hr ${y % 2 ? "odd" : ""}">${Array.from({ length: W }, (_, x) => `<button class="hc ${blocked[y][x] ? "blk" : ""} ${x === sx && y === sy ? "snk" : ""} ${edge(x, y) ? "edg" : ""}" data-x="${x}" data-y="${y}">${x === sx && y === sy ? "🐍" : blocked[y][x] ? "" : ""}</button>`).join("")}</div>`).join("");
      box.querySelectorAll<HTMLButtonElement>(".hc").forEach((b) => b.onclick = () => click(Number(b.dataset.x), Number(b.dataset.y)));
    };
    const click = (x: number, y: number) => {
      if (!this.alive || over || blocked[y][x] || (x === sx && y === sy)) return;
      blocked[y][x] = true; this.g.sfx.click();
      const d = dists();
      if (d[sy][sx] === Infinity) { over = true; draw(); this.end(done, { score: 1, skipped: false }, "Penned in. It's mad, but it's contained.", 1400); return; }
      // the snake takes the shortest way out (random tie-break)
      const opts = nb(sx, sy).filter(([a, b]) => !blocked[b][a]); let best = Infinity; for (const [a, b] of opts) best = Math.min(best, d[b][a]);
      const pool = opts.filter(([a, b]) => d[b][a] === best); const [nx, ny] = pool[(Math.random() * pool.length) | 0];
      sx = nx; sy = ny;
      if (edge(sx, sy)) { over = true; draw(); this.end(done, { score: 0, skipped: false }, "It made it to the edge and slithered off. Into the gear.", 1400); return; }
      draw();
    };
    draw();
  }

}
