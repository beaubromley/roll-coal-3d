/** Title-screen overlays: the save-slot picker and the feedback form. */
import type { Game } from "./game";

function overlay(html: string): HTMLDivElement {
  document.getElementById("tmenu")?.remove();
  const d = document.createElement("div"); d.id = "tmenu";
  d.innerHTML = `<div class="tbox">${html}</div>`;
  document.body.appendChild(d);
  d.addEventListener("mousedown", (e) => { if (e.target === d) d.remove(); });
  return d;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Pick one of the save slots. mode "new" starts a game in the slot (asking before it overwrites one), "continue" loads one. */
export function openSlotPicker(game: Game, mode: "new" | "continue", pick: (slot: number) => void) {
  const rows = [1, 2, 3].map((n) => {
    const info = game.slotInfo(n);
    const label = info ? `DAY ${info.day} · ${Math.round(info.depth).toLocaleString("en-US")} FT${info.done ? " · " + info.done + " JOBS" : ""}<small>${new Date(info.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>` : "EMPTY<small>nothing saved here</small>";
    const off = mode === "continue" && !info;
    return `<button class="tslot" data-n="${n}" ${off ? "disabled" : ""}><b>SLOT ${n}</b><span>${label}</span></button>`;
  }).join("");
  const d = overlay(`<div class="ttitle">${mode === "new" ? "START NEW: PICK A SLOT" : "CONTINUE: PICK A SAVE"}</div>${rows}<div class="thint" id="tmsg">${mode === "new" ? "Starting over a used slot replaces that save." : ""}</div><button class="tbtn2 alt" id="tmx">CANCEL</button>`);
  let armed = 0;
  d.querySelectorAll<HTMLButtonElement>(".tslot").forEach((b) => b.onclick = () => {
    const n = Number(b.dataset.n);
    if (mode === "new" && game.slotInfo(n) && armed !== n) { armed = n; (d.querySelector("#tmsg") as HTMLElement).textContent = "Slot " + n + " has a save. Press it again to replace it."; b.classList.add("warn"); return; }
    d.remove(); pick(n);
  });
  d.querySelector<HTMLElement>("#tmx")!.onclick = () => d.remove();
}

/** The feedback form: sent to the game's own feedback table. */
export function openFeedback(version: string) {
  const d = overlay(`<div class="ttitle">SUBMIT FEEDBACK</div>
    <div class="checks">
      <label><input type="checkbox" value="bug"/> A bug</label>
      <label><input type="checkbox" value="idea"/> An idea</label>
      <label><input type="checkbox" value="balance"/> Too hard / too easy</label>
      <label><input type="checkbox" value="other"/> Something else</label>
    </div>
    <textarea id="fbm" maxlength="2000" placeholder="Add a comment"></textarea>
    <input id="fbn" maxlength="30" placeholder="Your name (optional)"/>
    <div class="thint" id="fbs"></div>
    <div class="trow2"><button class="tbtn2" id="fbsend">SEND</button><button class="tbtn2 alt" id="fbx">CLOSE</button></div>`);
  const msg = d.querySelector<HTMLTextAreaElement>("#fbm")!, st = d.querySelector<HTMLElement>("#fbs")!, send = d.querySelector<HTMLButtonElement>("#fbsend")!;
  msg.focus();
  d.querySelector<HTMLElement>("#fbx")!.onclick = () => d.remove();
  d.addEventListener("keydown", (e) => { e.stopPropagation(); });   // typing here must not trigger the title's hotkeys
  send.onclick = async () => {
    const text = msg.value.trim(); if (!text) { st.textContent = "Write something first."; return; }
    send.disabled = true; st.textContent = "Sending…";
    try {
      const r = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kinds: [...d.querySelectorAll<HTMLInputElement>(".checks input:checked")].map((c) => c.value), message: text, name: (d.querySelector("#fbn") as HTMLInputElement).value, version }) });
      if (!r.ok) throw new Error(String(r.status));
      d.querySelector(".tbox")!.innerHTML = `<div class="ttitle">THANK YOU</div><div class="thint">Got it. We'll read it.</div><button class="tbtn2" id="fbdone">CLOSE</button>`;
      d.querySelector<HTMLElement>("#fbdone")!.onclick = () => d.remove();
    } catch {
      send.disabled = false; st.innerHTML = `Could not send (the feedback box only works on the live site). Your note: <i>${esc(text.slice(0, 80))}${text.length > 80 ? "…" : ""}</i>`;
    }
  };
}
