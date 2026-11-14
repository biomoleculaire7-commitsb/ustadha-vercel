import { verify, redis, dbReady } from "./_lib.js";
const PER_STUDENT_DAY = parseInt(process.env.ASK_PER_STUDENT_DAY || "5");
// خادم «اسأل الأستاذة» (اختياري). يعمل إذا أضفت ANTHROPIC_API_KEY (مدفوع) أو GEMINI_API_KEY (مجاني بحدود) في إعدادات Vercel.
// حدود لحماية الميزانية: عدد الأسئلة لكل زائر في الساعة، وحد يومي عام.
const FORMAT = "\nأعد JSON فقط بدون أي نص آخر، بالشكل: {\"title\":\"...\",\"steps\":[...]}\nكل خطوة كائن فيه \"t\" (النوع) و \"say\" (ما تقوله الأستاذة بصوت عالٍ: جملة أو جملتان بالعربية الفصحى البسيطة، بلا رموز رياضية، تُكتب الأعداد والرموز بالكلمات لأنها تُقرأ صوتياً).\nالأنواع المسموحة:\n- {\"t\":\"title\",\"text\":\"...\",\"say\":\"...\"} عنوان على السبورة\n- {\"t\":\"text\",\"text\":\"...\",\"say\":\"...\"} سطر شرح قصير بالعربية (ضع أي رموز أو علاقات رياضية داخله بين [[ و ]]، وكذلك في box)\n- {\"t\":\"math\",\"text\":\"...\",\"say\":\"...\"} سطر رياضي بالرموز اللاتينية (يُكتب من اليسار لليمين) مثل \"(x + 3)² = x² + 6x + 9\". يمكن عدة أسطر بفاصل \\n. استعمل ² ³ √ × ÷ ≤ ≥ ≠ π والفاصلة العشرية ,\n- {\"t\":\"box\",\"text\":\"...\",\"say\":\"...\"} تعريف أو خاصية أو قاعدة مهمة داخل إطار\n- {\"t\":\"figure\",\"shapes\":[...],\"say\":\"...\"} شكل هندسي في مساحة إحداثيات عرضها 300 وارتفاعها 200 (y نحو الأسفل). الأشكال:\n   {\"type\":\"line\",\"x1\":..,\"y1\":..,\"x2\":..,\"y2\":..,\"color\":\"chalk|yellow|pink|blue|green\",\"dashed\":false}\n   {\"type\":\"rect\",\"x\":..,\"y\":..,\"w\":..,\"h\":..} ، {\"type\":\"circle\",\"cx\":..,\"cy\":..,\"r\":..} ، {\"type\":\"polygon\",\"points\":\"x,y x,y x,y\"}\n   {\"type\":\"point\",\"x\":..,\"y\":..,\"label\":\"A\",\"dx\":0,\"dy\":-8} ، {\"type\":\"label\",\"x\":..,\"y\":..,\"text\":\"5 cm\"}\n   تأكد أن الإحداثيات صحيحة هندسياً وأن الشكل داخل المساحة.\n- {\"t\":\"question\",\"text\":\"...\",\"answer\":\"...\",\"say\":\"...\",\"sayAnswer\":\"...\"} سؤال للتلاميذ؛ في answer ضع الأجزاء الرياضية بين [[ و ]]\n- {\"t\":\"clear\",\"say\":\"...\"} مسح السبورة (استعمله حين تمتلئ، كل 7 إلى 9 خطوات تقريباً)\n- {\"t\":\"stage\",\"s\":\"tahyia|situation|hawsala|istithmar\",\"say\":\"...\"} إعلان مرحلة من مراحل الحصة";
const PER_HOUR = parseInt(process.env.ASK_PER_HOUR || "15");
const PER_DAY_TOTAL = parseInt(process.env.ASK_PER_DAY || "500");
async function callModel(prompt) {
  const key = process.env.ANTHROPIC_API_KEY, gkey = process.env.GEMINI_API_KEY;
  if (key) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 2500, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) throw new Error("Claude " + r.status + ": " + (await r.text()).slice(0, 300));
    const j = await r.json();
    return (j.content || []).map(c => c.text || "").join("");
  }
  const m = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": gkey, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4000 } }),
  });
  if (!r.ok) throw new Error("Gemini " + r.status + ": " + (await r.text()).slice(0, 300));
  const j = await r.json();
  return ((((j.candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || "").join("");
}
const hits = new Map(); let day = "", dayCount = 0;

export default async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY, gkey = process.env.GEMINI_API_KEY;
  if (req.method === "GET" && req.query && req.query.test) {
    if (!process.env.ADMIN_PASSWORD || req.query.test !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: "كلمة السر خاطئة" });
    try { const t = await callModel('أعد JSON فقط: {"ok":"مرحبا"}'); return res.status(200).json({ works: true, model: process.env.ANTHROPIC_API_KEY ? "claude" : "gemini", reply: t.slice(0, 200) }); }
    catch (e) { return res.status(200).json({ works: false, error: String(e.message || e) }); }
  }
  if (req.method === "GET") return res.status(key || gkey ? 200 : 404).json({ ok: !!(key || gkey) });
  if (!key && !gkey) return res.status(404).json({ error: "disabled" });
  if (req.method !== "POST") return res.status(405).end();
  const tk = verify((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  if (!tk) return res.status(401).json({ error: "auth" });

  let refund = null;
  if (dbReady()) {
    try {
      const k = "ask:" + tk.id + ":" + new Date().toISOString().slice(0, 10);
      const n = await redis("INCR", k); if (n === 1) await redis("EXPIRE", k, 90000);
      const g = "ask:all:" + new Date().toISOString().slice(0, 10);
      const m = await redis("INCR", g); if (m === 1) await redis("EXPIRE", g, 90000);
      if (n > PER_STUDENT_DAY || m > PER_DAY_TOTAL) { await redis("DECR", k); await redis("DECR", g); return res.status(429).json({ error: "rate" }); }
      refund = async () => { try { await redis("DECR", k); await redis("DECR", g); } catch (e) {} };
    } catch (e) {}
  }
  const ip = tk.id || "x";
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; }
  if (h.length >= PER_HOUR || dayCount >= PER_DAY_TOTAL) return res.status(429).json({ error: "rate" });
  h.push(now); hits.set(ip, h); dayCount++;

  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const title = String(b.title || "").slice(0, 200), board = String(b.board || "").slice(0, 1500), q = String(b.question || "").slice(0, 300);
  if (!q) return res.status(400).json({ error: "empty" });

  const prompt = `أنت "الأستاذة"، أستاذة رياضيات جزائرية صبورة ومشجّعة للسنة الرابعة متوسط.
أنت الآن تشرحين درس «${title}». هذا ما هو مكتوب على السبورة حالياً:
"""${board}"""
سأل تلميذ الأستاذة: «${q}»
أجيبيه بالشرح على السبورة في 3 إلى 8 خطوات (بدون خطوات stage)، بأبسط طريقة، مع مثال إن لزم. إذا كان السؤال خارج الرياضيات، أعيديه بلطف إلى الدرس في خطوة text واحدة. لا تبدئي بخطوة clear.
${FORMAT}`;

  try {
    const t = await callModel(prompt);
    return res.status(200).json(JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)));
  } catch (e) {
    if (refund) await refund();
    return res.status(502).json({ error: "failed", detail: String(e.message || e).slice(0, 300) });
  }
}
