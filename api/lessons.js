import fs from "node:fs";
import path from "node:path";
import { dbReady, verify, getStudent } from "./_lib.js";

let code = null;
export default async function handler(req, res) {
  if (!dbReady()) return res.status(503).json({ error: "db" });
  const p = verify((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  if (!p) return res.status(401).json({ error: "auth" });
  const st = await getStudent(p.id);
  if (!st || st.status !== "active") return res.status(403).json({ error: "inactive" });
  if (st.until && Date.now() > st.until) return res.status(403).json({ error: "expired" });
  if (!code) code = fs.readFileSync(path.join(process.cwd(), "private", "lessons.js"), "utf8");
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "private, no-store");
  return res.status(200).send(code);
}
