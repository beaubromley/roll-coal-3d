// The high-score board: talks to /api/scores (a Vercel function backed by a small Turso table). If that is not set up (local dev, or no database yet) the board just stays hidden.
export interface ScoreRow { name: string; score: number; grade: string; depth: number; hours: number; cost: number; sig?: string | null }
export interface ScorePost { score: number; grade: string; depth: number; hours: number; cost: number; approval: number; incidents: number; signature?: string }

export async function fetchScores(): Promise<ScoreRow[] | null> {
  try { const r = await fetch("/api/scores", { cache: "no-store" }); if (!r.ok) return null; const j = await r.json(); return Array.isArray(j.scores) ? j.scores : null; } catch { return null; }
}
export async function postScore(name: string, s: ScorePost): Promise<number | null> {
  try { const r = await fetch("/api/scores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ...s }) }); if (!r.ok) return null; const j = await r.json(); return typeof j.rank === "number" ? j.rank : null; } catch { return null; }
}
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
export function renderScores(el: HTMLElement, rows: ScoreRow[], mine?: number) {
  el.innerHTML = `<div class="sbh">TOP HANDS</div>` + (rows.length ? rows.map((r, i) => `<div class="sbr${mine === i + 1 ? " me" : ""}"><span>${i + 1}</span><b>${esc(r.name)}${r.sig && r.sig.startsWith("data:image/png;base64,") ? ` <img class="sig" src="${r.sig}" alt=""/>` : ""}</b><em>${r.grade}</em><i>${r.score.toFixed(1)}</i></div>`).join("") : `<div class="sbr"><b>No scores yet. Be the first.</b></div>`);
}
/** the end screen: show the board, and let the player post this run under a name */
export async function setupBoard(run: ScorePost) {
  const box = document.getElementById("endboard"), top = document.getElementById("endtop"), form = document.getElementById("endsubmit"), name = document.getElementById("endname") as HTMLInputElement | null, send = document.getElementById("endsend") as HTMLButtonElement | null;
  if (!box || !top || !form || !name || !send) return;
  const rows = await fetchScores(); if (!rows) return;   // not set up: no board
  box.style.display = "block"; renderScores(top, rows);
  if (run.signature) form.insertAdjacentHTML("afterbegin", `<img class="sig mine" src="${run.signature}" alt="your signature" title="your signature, from the sign-in sheet"/>`);
  try { name.value = localStorage.getItem("rcmh2.name") ?? ""; } catch { /* ignore */ }
  send.onclick = async () => {
    const n = name.value.trim(); if (!n) { name.focus(); return; }
    send.disabled = true; send.textContent = "Posting…";
    try { localStorage.setItem("rcmh2.name", n); } catch { /* ignore */ }
    const rank = await postScore(n, run);
    if (rank === null) { send.disabled = false; send.textContent = "Try again"; return; }
    form.style.display = "none"; const fresh = await fetchScores(); renderScores(top, fresh ?? rows, rank <= 10 ? rank : undefined);
    if (rank > 10) top.insertAdjacentHTML("beforeend", `<div class="sbr"><b>You placed #${rank}</b></div>`);
  };
}
