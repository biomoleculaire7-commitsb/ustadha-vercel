// الدخول برمز تفعيل فقط (بدون رقم مدرسي ولا اسم) + تجربة مجانية مرتبطة بالجهاز
import { dbReady, redis, getStudent, putStudent, sign, limited, body } from "./_lib.js";

const MAX_DEV = () => Math.max(1, parseInt(process.env.CODE_DEVICES || "2"));
const fmt = c => c.slice(0, 4) + "-" + c.slice(4);

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ pay: process.env.PAY_INFO || "", trialDays: parseInt(process.env.TRIAL_DAYS || "0") });
  if (req.method !== "POST") return res.status(405).end();
  if (!dbReady()) return res.status(503).json({ error: "db" });
  if (limited(req, "login:", 20, 15 * 60e3)) return res.status(429).json({ error: "rate" });
  const b = body(req);
  const device = String(b.device || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
  if (device.length < 8) return res.status(400).json({ error: "device" });
  const pay = process.env.PAY_INFO || "";

  let st;
  if (b.trial) {
    const days = parseInt(process.env.TRIAL_DAYS || "0");
    st = await getStudent("t:" + device);
    if (!st) {
      if (days <= 0) return res.status(403).json({ error: "notrial", pay });
      st = { id: "t:" + device, nom: "تجربة", prenom: "", status: "active", plan: "trial", created: Date.now(), until: Date.now() + days * 864e5 };
      await putStudent(st);
    }
  } else {
    const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 8) return res.status(400).json({ error: "badcode" });
    const raw = await redis("GET", "code:" + code);
    if (!raw) return res.status(403).json({ error: "badcode" });
    const rec = JSON.parse(raw);
    st = await getStudent("c:" + code);
    if (!st) {
      st = { id: "c:" + code, nom: rec.note || "رمز " + fmt(code), prenom: "", code, status: "active", plan: rec.plan || "paid", until: rec.until || null, created: Date.now(), devices: [] };
      rec.usedAt = Date.now(); rec.usedBy = st.id; await redis("SET", "code:" + code, JSON.stringify(rec));
    }
    st.devices = st.devices || [];
    if (!st.devices.includes(device)) {
      if (st.devices.length >= MAX_DEV()) return res.status(403).json({ error: "devices", max: MAX_DEV() });
      st.devices.push(device);
    }
    await putStudent(st);
  }
  if (st.status === "disabled") return res.status(403).json({ status: "disabled" });
  if (st.until && Date.now() > st.until) return res.status(403).json({ status: "expired", trial: st.plan === "trial", pay });

  const exp = Math.min(st.until || Infinity, Date.now() + 30 * 864e5);
  st.lastLogin = Date.now(); await putStudent(st);
  return res.status(200).json({ token: sign({ id: st.id, exp }), nom: "", prenom: "", plan: st.plan || "", until: st.until || null });
}
