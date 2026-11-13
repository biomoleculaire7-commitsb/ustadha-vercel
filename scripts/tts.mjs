// توليد صوت الأستاذة لكل الدروس مرة واحدة وحفظه في public/audio
// الاستعمال:
//   عينات للمقارنة:   node scripts/tts.mjs --sample
//   توليد كل الدروس:  node scripts/tts.mjs --voice <اسم الصوت>
// المزوّد: ضع في ملف .env أو في الطرفية أحد الخيارين:
//   Azure : AZURE_SPEECH_KEY=...  AZURE_SPEECH_REGION=westeurope
//   Google: GOOGLE_TTS_KEY=...
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

const ROOT = path.resolve(HERE, "..");
const AUDIO = path.join(ROOT, "public", "audio");
const TEXTS = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "texts.json"), "utf8"));
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const provider = process.env.AZURE_SPEECH_KEY ? "azure" : process.env.GOOGLE_TTS_KEY ? "google" : null;
if (!provider) { console.error("❌ ضع AZURE_SPEECH_KEY و AZURE_SPEECH_REGION ، أو GOOGLE_TTS_KEY في ملف .env"); process.exit(1); }
const RATE = parseFloat(arg("--rate") || "0.95");

const hash = (t) => crypto.createHash("sha1").update(t, "utf8").digest("hex").slice(0, 16);
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function listVoices() {
  if (provider === "azure") {
    const r = await fetch(`https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY } });
    if (!r.ok) throw new Error("Azure voices: " + r.status + " " + await r.text());
    const v = await r.json();
    return v.filter(x => /^ar-/.test(x.Locale) && x.Gender === "Female").map(x => ({ name: x.ShortName, lang: x.Locale, label: x.LocalName || x.DisplayName }));
  } else {
    const r = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=ar&key=${process.env.GOOGLE_TTS_KEY}`);
    if (!r.ok) throw new Error("Google voices: " + r.status + " " + await r.text());
    const v = (await r.json()).voices || [];
    return v.filter(x => x.ssmlGender === "FEMALE").map(x => ({ name: x.name, lang: x.languageCodes[0], label: x.name }));
  }
}

async function synth(text, voice, lang) {
  if (provider === "azure") {
    const pct = Math.round((RATE - 1) * 100);
    const ssml = `<speak version="1.0" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${pct >= 0 ? "+" : ""}${pct}%">${esc(text)}</prosody></voice></speak>`;
    const r = await fetch(`https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "ustadha-tts" },
      body: ssml,
    });
    if (!r.ok) throw new Error("Azure " + r.status + " " + await r.text());
    return Buffer.from(await r.arrayBuffer());
  } else {
    const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_KEY}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { text }, voice: { languageCode: lang, name: voice }, audioConfig: { audioEncoding: "MP3", speakingRate: RATE } }),
    });
    if (!r.ok) throw new Error("Google " + r.status + " " + await r.text());
    return Buffer.from((await r.json()).audioContent, "base64");
  }
}

const SAMPLE = "السلام عليكم يا أبنائي. اليوم سندرس القاسم المشترك الأكبر لعددين. اثنا عشر يساوي ثلاثة في أربعة، إذن ثلاثة قاسم للعدد اثني عشر. هل فهمتم؟ لنحل تمريناً معاً.";

if (args.includes("--sample")) {
  const voices = await listVoices();
  console.log(`🔎 ${voices.length} صوت نسائي عربي متاح عند ${provider}:`);
  voices.forEach(v => console.log("   -", v.name, `(${v.lang})`));
  const out = path.join(ROOT, "samples"); fs.mkdirSync(out, { recursive: true });
  const pick = voices.slice(0, parseInt(arg("--max") || "8"));
  for (const v of pick) {
    try { fs.writeFileSync(path.join(out, v.name + ".mp3"), await synth(SAMPLE, v.name, v.lang)); console.log("✅", v.name); }
    catch (e) { console.log("⚠", v.name, e.message.slice(0, 120)); }
  }
  console.log(`\n🎧 استمع إلى الملفات في المجلد samples ثم شغّل:\n   node scripts/tts.mjs --voice <الاسم>`);
  process.exit(0);
}

const voice = arg("--voice");
if (!voice) { console.error("❌ حدّد الصوت: node scripts/tts.mjs --voice ar-SA-ZariyahNeural   (أو شغّل --sample أولاً)"); process.exit(1); }
const lang = voice.split("-").slice(0, 2).join("-");
fs.mkdirSync(AUDIO, { recursive: true });
const manPath = path.join(AUDIO, "manifest.json");
let man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, "utf8")) : { files: {} };
if (man.voice && man.voice !== voice) { console.log("ℹ صوت مختلف عن السابق: سأعيد توليد كل الملفات."); man = { files: {} }; }
man.voice = voice; man.rate = RATE;

const todo = TEXTS.filter(t => !man.files[hash(t.text)] || !fs.existsSync(path.join(AUDIO, man.files[hash(t.text)])));
const chars = todo.reduce((n, t) => n + t.text.length, 0);
console.log(`🎙 ${todo.length} جملة (${chars} حرف) بالصوت ${voice} …`);
let done = 0, fail = 0;
async function worker() {
  while (todo.length) {
    const t = todo.shift(); const h = hash(t.text); const f = h + ".mp3";
    for (let attempt = 0; attempt < 4; attempt++) {
      try { fs.writeFileSync(path.join(AUDIO, f), await synth(t.text, voice, lang)); man.files[h] = f; done++; break; }
      catch (e) { if (attempt === 3) { fail++; console.log("⚠", t.lesson, e.message.slice(0, 100)); } else await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); }
    }
    if (done % 25 === 0) { fs.writeFileSync(manPath, JSON.stringify(man)); process.stdout.write(`\r   ${done} ✓  ${fail} ✗`); }
  }
}
await Promise.all([1, 2, 3, 4].map(worker));
fs.writeFileSync(manPath, JSON.stringify(man));
console.log(`\n✅ انتهى: ${done} ملف جديد، ${fail} فشل. الملفات في public/audio`);

function loadEnv() {
  try {
    const p = path.resolve(HERE, "..", ".env");
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) {}
}
