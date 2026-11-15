// لوحة الأستاذ: قائمة التلاميذ، التفعيل، الإيقاف، الإضافة المسبقة
import crypto from "node:crypto";
import { dbReady, redis, getStudent, putStudent, limited, body } from "./_lib.js";

function okPass(p) {
  const a = Buffer.from(String(p || "")), b = Buffer.from(String(process.env.ADMIN_PASSWORD || ""));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!dbReady() || !process.env.ADMIN_PASSWORD) return res.status(503).json({ error: "config" });
  if (limited(req, "admin:", 120, 15 * 60e3)) return res.status(429).json({ error: "rate" });
  if (!okPass(req.headers["x-admin-password"])) return res.status(401).json({ error: "auth" });

  if (req.method === "GET") {
    const ids = (await redis("SMEMBERS", "students")) || [];
    const list = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const vals = await redis("MGET", ...chunk.map(x => "student:" + x));
      vals.forEach(v => v && list.push(JSON.parse(v)));
    }
    list.sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0) || (b.created || 0) - (a.created || 0));
    return res.status(200).json({ students: list });
  }
  if (req.method !== "POST") return res.status(405).end();

  const b = body(req);
  // رموز التفعيل
  if (b.action === "gencodes") {
    const n = Math.min(Math.max(parseInt(b.count) || 1, 1), 50), out = [];
    const AL = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let k = 0; k < n; k++) {
      let c = ""; const r = crypto.randomBytes(8); for (let j = 0; j < 8; j++) c += AL[r[j] % AL.length];
      const rec = { code: c, until: b.until || null, plan: b.plan === "free" ? "free" : "paid", created: Date.now(), note: String(b.note || "").slice(0, 60) };
      await redis("SET", "code:" + c, JSON.stringify(rec)); await redis("SADD", "codes", c); out.push(rec);
    }
    return res.status(200).json({ ok: true, codes: out });
  }
  if (b.action === "listcodes") {
    const cs = (await redis("SMEMBERS", "codes")) || [], list = [];
    for (let i = 0; i < cs.length; i += 50) { const v = await redis("MGET", ...cs.slice(i, i + 50).map(x => "code:" + x)); v.forEach(x => x && list.push(JSON.parse(x))); }
    list.sort((a, b) => (b.created || 0) - (a.created || 0));
    return res.status(200).json({ codes: list });
  }
  if (b.action === "delcode") { const c = String(b.code || "").toUpperCase(); await redis("DEL", "code:" + c); await redis("SREM", "codes", c); return res.status(200).json({ ok: true }); }
  const id = String(b.id || "").replace(/\D/g, "");
  if (id.length !== 16) return res.status(400).json({ error: "id" });
  let st = await getStudent(id);
  const plan = b.plan === "paid" ? "paid" : b.plan === "free" ? "free" : undefined;

  if (b.action === "add") {
    const nom = String(b.nom || "").trim(), prenom = String(b.prenom || "").trim();
    if (!nom || !prenom) return res.status(400).json({ error: "names" });
    st = { ...(st || { created: Date.now() }), id, nom, prenom, status: b.until ? "active" : "pending", until: b.until || null, ...(plan ? { plan } : {}) };
    await putStudent(st); return res.status(200).json({ ok: true, student: st });
  }
  if (!st) return res.status(404).json({ error: "notfound" });
  if (b.action === "activate") { st.status = "active"; st.until = b.until || null; st.activated = Date.now(); if (plan) st.plan = plan; }
  else if (b.action === "disable") st.status = "disabled";
  else if (b.action === "edit") { if (b.nom) st.nom = String(b.nom).trim(); if (b.prenom) st.prenom = String(b.prenom).trim(); }
  else if (b.action === "delete") { await redis("DEL", "student:" + id); await redis("SREM", "students", id); return res.status(200).json({ ok: true }); }
  else return res.status(400).json({ error: "action" });
  await putStudent(st);
  return res.status(200).json({ ok: true, student: st });
}
