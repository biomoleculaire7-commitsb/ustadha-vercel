import { dbReady, redis, getStudent, putStudent, normName, sign, limited, body } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ pay: process.env.PAY_INFO || "", trialDays: parseInt(process.env.TRIAL_DAYS || "0") });
  if (req.method !== "POST") return res.status(405).end();
  if (!dbReady()) return res.status(503).json({ error: "db" });
  if (limited(req, "login:", 20, 15 * 60e3)) return res.status(429).json({ error: "rate" });
  const b = body(req);
  const id = String(b.id || "").replace(/\D/g, "");
  const nom = String(b.nom || "").trim().slice(0, 60), prenom = String(b.prenom || "").trim().slice(0, 60);
  if (id.length !== 16 || !nom || !prenom) return res.status(400).json({ error: "invalid" });

  let st = await getStudent(id);
  // تفعيل برمز يرسله الأستاذ بعد الدفع (يُستعمل مرة واحدة فقط)
  const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code) {
    const raw = await redis("GET", "code:" + code);
    if (!raw) return res.status(403).json({ error: "badcode" });
    const rec = JSON.parse(raw);
    if (rec.usedBy && rec.usedBy !== id) return res.status(403).json({ error: "usedcode" });
    if (st && (normName(st.nom) !== normName(nom) || normName(st.prenom) !== normName(prenom))) return res.status(403).json({ error: "mismatch" });
    if (!rec.usedBy) {
      const claimed = await redis("SET", "codeuse:" + code, id, "NX");
      if (!claimed) return res.status(403).json({ error: "usedcode" });
      rec.usedBy = id; rec.usedName = nom + " " + prenom; rec.usedAt = Date.now();
      await redis("SET", "code:" + code, JSON.stringify(rec));
      st = { ...(st || { id, nom, prenom, created: Date.now() }), status: "active", plan: rec.plan || "paid", until: rec.until || null, activated: Date.now(), code };
      await putStudent(st);
    }
  }
  const trialDays = parseInt(process.env.TRIAL_DAYS || "0");
  if (!st) {
    if (trialDays > 0) {
      st = { id, nom, prenom, status: "active", plan: "trial", created: Date.now(), until: Date.now() + trialDays * 864e5 };
      await putStudent(st);
    } else {
      st = { id, nom, prenom, status: "pending", created: Date.now() };
      await putStudent(st);
      return res.status(403).json({ status: "pending", created: true, pay: process.env.PAY_INFO || "" });
    }
  }
  if (normName(st.nom) !== normName(nom) || normName(st.prenom) !== normName(prenom)) return res.status(403).json({ error: "mismatch" });
  if (st.status === "pending") return res.status(403).json({ status: "pending", pay: process.env.PAY_INFO || "" });
  if (st.status === "disabled") return res.status(403).json({ status: "disabled" });
  if (st.until && Date.now() > st.until) return res.status(403).json({ status: "expired", trial: st.plan === "trial", pay: process.env.PAY_INFO || "" });

  const exp = Math.min(st.until || Infinity, Date.now() + 30 * 864e5);
  st.lastLogin = Date.now(); await putStudent(st);
  return res.status(200).json({ token: sign({ id, exp }), nom: st.nom, prenom: st.prenom, plan: st.plan || "", until: st.until || null });
}
