// أدوات مشتركة: قاعدة البيانات (Upstash Redis عبر Vercel) + الرموز الموقعة
import crypto from "node:crypto";

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK_ = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const dbReady = () => !!(URL_ && TOK_ && process.env.AUTH_SECRET);

export async function redis(...cmd) {
  const r = await fetch(URL_, { method: "POST", headers: { authorization: "Bearer " + TOK_, "content-type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
export async function getStudent(id) { const v = await redis("GET", "student:" + id); return v ? JSON.parse(v) : null; }
export async function putStudent(st) { await redis("SET", "student:" + st.id, JSON.stringify(st)); await redis("SADD", "students", st.id); }

// توحيد كتابة الأسماء: حذف التشكيل، توحيد الهمزات والتاء المربوطة، الأحرف الصغيرة
export function normName(s) {
  return String(s || "").normalize("NFKD").replace(/[ً-ْٰـ]/g, "")
    .replace(/[̀-ͯ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .toLowerCase().replace(/[^a-zء-ي]+/g, " ").trim();
}

const b64 = (x) => Buffer.from(x).toString("base64url");
export function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", process.env.AUTH_SECRET).update(body).digest("base64url");
  return body + "." + mac;
}
export function verify(token) {
  try {
    const [body, mac] = String(token || "").split(".");
    const exp = crypto.createHmac("sha256", process.env.AUTH_SECRET).update(body).digest("base64url");
    if (!mac || mac.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(exp))) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch (e) { return null; }
}

const hits = new Map();
export function limited(req, key, max, windowMs) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "x";
  const k = key + ip, now = Date.now(), h = (hits.get(k) || []).filter(t => now - t < windowMs);
  h.push(now); hits.set(k, h);
  return h.length > max;
}
export const body = (req) => typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
