// تحضير بنك التمارين مرة واحدة بالذكاء الاصطناعي (Claude API) وحفظه في public/exercises.json
// الاستعمال:  node scripts/exercises.mjs            (كل الدروس، 3 مستويات، 3 تمارين لكل مستوى)
//             node scripts/exercises.mjs --only div,pgcddef   (دروس محددة)
//             node scripts/exercises.mjs --redo                (إعادة توليد ما هو موجود)
// يتطلب ANTHROPIC_API_KEY في ملف .env
// ⚠ راجع التمارين بنفسك في الملف قبل نشرها للتلاميذ.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
loadEnv();
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "public", "exercises.json");
const LESSONS = JSON.parse(fs.readFileSync(path.join(HERE, "lessons.json"), "utf8"));
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
if (!KEY) { console.error("❌ ضع ANTHROPIC_API_KEY في ملف .env"); process.exit(1); }

const LEVELS = {
  easy: "تطبيقات مباشرة سهلة للفهم",
  exam: "تمارين متوسطة الصعوبة على نمط الفروض والاختبارات",
  bem:  "تمارين ووضعيات إدماجية على نمط شهادة التعليم المتوسط",
};
const N = parseInt(arg("--n") || "3");
const only = arg("--only") ? arg("--only").split(",") : null;
let bank = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

function prompt(L, lvlText) {
  return `أنت "الأستاذة"، أستاذة رياضيات جزائرية خبيرة في السنة الرابعة متوسط (منهاج الجيل الثاني) وفي التحضير لشهادة التعليم المتوسط.
حضّري ${N} تمارين جديدة حول درس «${L.title}» (${L.term}) من نوع: ${lvlText}.
ملخص الدرس كما دُرّس للتلاميذ:
"""${L.summary}"""
الشروط:
- نوّعي بين التطبيقات المباشرة، وفي آخرها وضعية (مسألة من الحياة اليومية للتلميذ الجزائري: الدينار، المدن، الرياضة، الفلاحة...) إذا سمح الدرس بذلك.
- صياغة أوراق الاختبارات الجزائرية: أسئلة مرقمة 1) 2) 3) ، أفعال: احسب، بيّن أن، استنتج، برّر.
- سلم تنقيط (points) لكل تمرين.
- حل نموذجي مفصل بطريقة التحرير المطلوبة في الامتحان (ذكر الخاصية، الحساب، الاستنتاج، الوحدة).
- ضعي كل الرموز والعلاقات الرياضية بين [[ و ]] مثل [[PGCD(84 ; 36) = 12]].
- لا تنسبي أي تمرين إلى امتحان حقيقي أو سنة معينة، ولا تذكري أسماء أساتذة أو كتب.
- تحققي بدقة من صحة كل الحسابات والأجوبة.
أعيدي JSON فقط: {"exercises":[{"kind":"تطبيق" أو "وضعية إدماجية","title":"عنوان قصير","points":عدد,"text":"نص التمرين مع الأسئلة","solution":"الحل النموذجي"}]}`;
}

async function call(p) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 6000, messages: [{ role: "user", content: p }] }),
  });
  if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 200));
  const j = await r.json();
  const t = (j.content || []).map(c => c.text || "").join("");
  const v = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  const list = (v.exercises || []).filter(x => x && x.text && x.solution);
  if (!list.length) throw new Error("empty");
  return { list, usage: j.usage };
}

let inTok = 0, outTok = 0, n = 0;
for (const L of LESSONS) {
  if (only && !only.includes(L.id)) continue;
  bank[L.id] = bank[L.id] || {};
  for (const [k, txt] of Object.entries(LEVELS)) {
    if (bank[L.id][k] && bank[L.id][k].length && !args.includes("--redo")) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { list, usage } = await call(prompt(L, txt));
        bank[L.id][k] = list; inTok += usage?.input_tokens || 0; outTok += usage?.output_tokens || 0; n++;
        fs.writeFileSync(OUT, JSON.stringify(bank, null, 1));
        console.log(`✅ ${L.id} / ${k} (${list.length})`);
        break;
      } catch (e) {
        console.log(`⚠ ${L.id} / ${k}: ${e.message}`);
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  }
}
console.log(`\nانتهى: ${n} طلب — ${inTok} رمز إدخال و ${outTok} رمز إخراج. الملف: public/exercises.json`);

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.resolve(HERE, "..", ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) {}
}
