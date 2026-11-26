// High scores: a tiny Vercel function in front of a Turso table. Needs TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the project's environment.
import { createClient } from "@libsql/client";

const SCHEMA = `CREATE TABLE IF NOT EXISTS roll_coal_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score REAL NOT NULL,
  grade TEXT,
  depth INTEGER,
  hours INTEGER,
  cost INTEGER,
  approval REAL,
  incidents INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`;

let db: ReturnType<typeof createClient> | null = null;
let ready: Promise<unknown> | null = null;
const SIG_OK = (s: unknown) => typeof s === "string" && s.startsWith("data:image/png;base64,") && s.length < 60000 && /^[A-Za-z0-9+/=,:;]+$/.test(s);
function client() {
  const url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("not configured");
  if (!db) db = createClient({ url, authToken });
  if (!ready) ready = db.execute(SCHEMA).then(() => db!.execute("ALTER TABLE roll_coal_scores ADD COLUMN signature TEXT")).catch(() => {});   // (the column may already be there)
  return db;
}
const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const d = client(); await ready;
    if (req.method === "GET") {
      const r = await d.execute("SELECT name, score, grade, depth, hours, cost, signature, created_at FROM roll_coal_scores ORDER BY score DESC, id ASC LIMIT 10");
      res.status(200).json({ scores: r.rows.map((x: any) => ({ name: x.name, score: Number(x.score), grade: x.grade, depth: Number(x.depth), hours: Number(x.hours), cost: Number(x.cost), sig: x.signature ?? null, at: x.created_at })) });
      return;
    }
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
      const name = String(b.name ?? "").replace(/[^\w .'-]/g, "").trim().slice(0, 14);
      if (!name) { res.status(400).json({ error: "name required" }); return; }
      const grade = ["S", "A", "B", "C", "D", "F"].includes(b.grade) ? b.grade : "F";
      await d.execute({ sql: "INSERT INTO roll_coal_scores (name, score, grade, depth, hours, cost, approval, incidents, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [name, num(b.score, -1000, 1000), grade, num(b.depth, 0, 100000), num(b.hours, 0, 100000), num(b.cost, 0, 1e10), num(b.approval, 0, 10), num(b.incidents, 0, 1000), SIG_OK(b.signature) ? b.signature : null] });
      const r = await d.execute({ sql: "SELECT COUNT(*) AS n FROM roll_coal_scores WHERE score > ?", args: [num(b.score, -1000, 1000)] });
      res.status(200).json({ ok: true, rank: Number((r.rows[0] as any).n) + 1 });
      return;
    }
    res.status(405).json({ error: "method not allowed" });
  } catch (e: any) {
    res.status(e?.message === "not configured" ? 503 : 500).json({ error: e?.message === "not configured" ? "scores are not set up yet" : "scores unavailable" });
  }
}
