// The high-score board: talks to /api/scores (a Vercel function backed by a small Turso table). If that is not set up (local dev, or no database yet) the board just stays hidden.
export interface ScoreRow { name: string; score: number; grade: string; depth: number; hours: number; cost: number; sig?: string | null }
export interface ScorePost { score: number; grade: string; depth: number; hours: number; cost: number; approval: number; incidents: number; signature?: string }

/** where the last board came from: the online table, or this browser's own list (used whenever the online one is not reachable, e.g. in local dev) */
export let scoresAreLocal = false;
const LOCAL_KEY = "rcmh2.localscores";
const readLocal = (): ScoreRow[] => { try { const j = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; } };
const sortRows = (rows: ScoreRow[]) => rows.sort((x, y) => y.score - x.score);

export async function fetchScores(): Promise<ScoreRow[] | null> {
  try { const r = await fetch("/api/scores", { cache: "no-store" }); if (r.ok) { const j = await r.json(); if (Array.isArray(j.scores)) { scoresAreLocal = false; return j.scores; } } } catch { /* fall through to the local list */ }
  scoresAreLocal = true; return sortRows(readLocal()).slice(0, 10);
}
export async function postScore(name: string, s: ScorePost): Promise<number | null> {
  try { const r = await fetch("/api/scores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ...s }) }); if (r.ok) { const j = await r.json(); if (typeof j.rank === "number") return j.rank; } } catch { /* fall through to the local list */ }
  // not reachable: keep it in this browser instead (wipe localStorage key "rcmh2.localscores" to clear them)
  const rows = readLocal(); rows.push({ name, score: s.score, grade: s.grade, depth: s.depth, hours: s.hours, cost: s.cost, sig: s.signature ?? null });
  const all = sortRows(rows).slice(0, 50); try { localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  scoresAreLocal = true; return all.findIndex((x) => x.name === name && x.score === s.score) + 1 || all.length;
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
