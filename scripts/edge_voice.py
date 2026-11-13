# توليد صوت الأستاذة مجاناً (بدون أي مفتاح) عبر Microsoft Edge TTS
# الاستعمال: python scripts/edge_voice.py            (صوت زارية السعودي)
#            python scripts/edge_voice.py --voice ar-EG-SalmaNeural
#            python scripts/edge_voice.py --sample     (عينات للاختيار)
import asyncio, hashlib, json, os, sys
try:
    import edge_tts
except ImportError:
    print("ثبّت المكتبة أولاً:  pip install edge-tts"); sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "public", "audio")
TEXTS = json.load(open(os.path.join(ROOT, "scripts", "texts.json"), encoding="utf-8"))
args = sys.argv[1:]
voice = args[args.index("--voice") + 1] if "--voice" in args else "ar-SA-ZariyahNeural"
rate = args[args.index("--rate") + 1] if "--rate" in args else "-8%"
FEMALE = ["ar-SA-ZariyahNeural", "ar-EG-SalmaNeural", "ar-AE-FatimaNeural", "ar-DZ-AminaNeural",
          "ar-MA-MounaNeural", "ar-JO-SanaNeural", "ar-LB-LaylaNeural", "ar-QA-AmalNeural", "ar-SY-AmanyNeural"]
h = lambda t: hashlib.sha1(t.encode("utf-8")).hexdigest()[:16]

async def one(text, out, v=voice):
    for k in range(4):
        try:
            await edge_tts.Communicate(text, v, rate=rate).save(out)
            if os.path.getsize(out) > 500: return True
        except Exception as e:
            print("  إعادة المحاولة:", e); await asyncio.sleep(2 + 3 * k)
    return False

async def main():
    os.makedirs(AUDIO, exist_ok=True)
    if "--sample" in args:
        os.makedirs(os.path.join(ROOT, "samples"), exist_ok=True)
        s = "مرحباً يا أبنائي. اليوم سنتعلم كيف نحسب القاسم المشترك الأكبر لعددين طبيعيين."
        for v in FEMALE:
            ok = await one(s, os.path.join(ROOT, "samples", v + ".mp3"), v)
            print(("✓ " if ok else "✗ ") + v)
        print("استمع إلى الملفات في مجلد samples ثم اختر الصوت."); return
    mp = os.path.join(AUDIO, "manifest.json")
    man = json.load(open(mp, encoding="utf-8")) if os.path.exists(mp) else {"voice": voice, "files": {}}
    if man.get("voice") != voice: man = {"voice": voice, "files": {}}
    todo = [t["text"] for t in TEXTS if not (man["files"].get(h(t["text"])) and os.path.exists(os.path.join(AUDIO, man["files"][h(t["text"])])))]
    todo = list(dict.fromkeys(todo)); n = len(todo); print(f"الصوت: {voice} — المتبقي {n} مقطعاً")
    sem = asyncio.Semaphore(4); done = 0
    async def job(t):
        nonlocal done
        async with sem:
            f = h(t) + ".mp3"
            if await one(t, os.path.join(AUDIO, f)):
                man["files"][h(t)] = f
            done += 1
            if done % 20 == 0 or done == n:
                json.dump(man, open(mp, "w", encoding="utf-8"), ensure_ascii=False)
                print(f"  {done}/{n}")
    await asyncio.gather(*(job(t) for t in todo))
    json.dump(man, open(mp, "w", encoding="utf-8"), ensure_ascii=False)
    print("انتهى ✓ — الآن ارفع مجلد public/audio إلى GitHub (أو أعد النشر).")

asyncio.run(main())
