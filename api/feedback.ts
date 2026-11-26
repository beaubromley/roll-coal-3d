// Feedback from the title screen: a tiny Vercel function in front of a Turso table. Uses the same TURSO_DATABASE_URL / TURSO_AUTH_TOKEN as the scores.
import { createClient } from "@libsql/client";

const SCHEMA = `CREATE TABLE IF NOT EXISTS roll_coal_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,
  message TEXT NOT NULL,
  name TEXT,
  version TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`;

let db: ReturnType<typeof createClient> | null = null;
let ready: Promise<unknown> | null = null;
function client() {
  const url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("not configured");
  if (!db) db = createClient({ url, authToken });
  if (!ready) ready = db.execute(SCHEMA);
  return db;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  try {
    const d = client(); await ready;
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
    const message = String(b.message ?? "").trim().slice(0, 2000);
    if (!message) { res.status(400).json({ error: "message required" }); return; }
    const kinds = (Array.isArray(b.kinds) ? b.kinds : [b.kind]).filter((k: unknown) => ["bug", "idea", "balance", "other"].includes(k as string));
    const kind = kinds.length ? kinds.join(",") : "other";
    const name = String(b.name ?? "").replace(/[^\w .'-]/g, "").trim().slice(0, 30);
    const version = String(b.version ?? "").replace(/[^\w.-]/g, "").slice(0, 20);
    await d.execute({ sql: "INSERT INTO roll_coal_feedback (kind, message, name, version) VALUES (?, ?, ?, ?)", args: [kind, message, name, version] });
    res.status(200).json({ ok: true });
  } catch (e: any) {
    res.status(e?.message === "not configured" ? 503 : 500).json({ error: "feedback unavailable" });
  }
}
