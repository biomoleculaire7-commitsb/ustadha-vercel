import { dbReady, getStudent, putStudent, normName, sign, limited, body } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!dbReady()) return res.status(503).json({ error: "db" });
  if (limited(req, "login:", 20, 15 * 60e3)) return res.status(429).json({ error: "rate" });
  const b = body(req);
  const id = String(b.id || "").replace(/\D/g, "");
  const nom = String(b.nom || "").trim().slice(0, 60), prenom = String(b.prenom || "").trim().slice(0, 60);
  if (id.length !== 16 || !nom || !prenom) return res.status(400).json({ error: "invalid" });

  let st = await getStudent(id);
  if (!st) {
    st = { id, nom, prenom, status: "pending", created: Date.now() };
    await putStudent(st);
    return res.status(403).json({ status: "pending", created: true });
  }
  if (normName(st.nom) !== normName(nom) || normName(st.prenom) !== normName(prenom)) return res.status(403).json({ error: "mismatch" });
  if (st.status === "pending") return res.status(403).json({ status: "pending" });
  if (st.status === "disabled") return res.status(403).json({ status: "disabled" });
  if (st.until && Date.now() > st.until) return res.status(403).json({ status: "expired" });

  const exp = Math.min(st.until || Infinity, Date.now() + 30 * 864e5);
  st.lastLogin = Date.now(); await putStudent(st);
  return res.status(200).json({ token: sign({ id, exp }), nom: st.nom, prenom: st.prenom });
}
