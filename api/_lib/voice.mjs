// Голос для Telegram-бота: распознавание голосовых (речь → текст) и ответ голосом (текст → речь, узбекский голос).
// Azure Speech (AZURE_SPEECH_KEY + AZURE_SPEECH_REGION): узбекский распознаёт (uz-UZ) и говорит голосами
// Madina (женский) / Sardor (мужской); бесплатный уровень F0 — 5 часов распознавания и 0,5 млн символов речи в месяц.
// Без Azure распознавание может идти через Groq (GROQ_API_KEY, Whisper) — но ответить голосом тогда нельзя.
export const VOICES = { "uz-UZ-MadinaNeural": "ru-RU-SvetlanaNeural", "uz-UZ-SardorNeural": "ru-RU-DmitryNeural" };
export const DEF_VOICE = "uz-UZ-MadinaNeural";
// приблизительная цена (для лимита в программе), $: час распознавания / 1 млн символов речи
export const SPEECH_PRICE = { azureStt: 1, groqStt: 0.111, tts: 15 };
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// текст для озвучки: без смайликов, ссылок, служебных знаков; «$» — «dollar»
export function speakable(t, ru = false) {
  const D = ru ? " долларов" : " dollar";
  return String(t || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/(\d[\d\s  .,]*?)\s*\$/g, "$1" + D).replace(/\$\s*(\d[\d\s  .,]*\d|\d)/g, "$1" + D)
    .replace(/[•·*_#`|>]+/g, " ")
    .replace(/[ \t  ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}
// русский текст (кириллица без узбекских букв) — читается русским голосом той же пары
export const isRussian = (t) => /[а-яё]/i.test(t) && !/[ўқғҳ]/i.test(t) && (String(t).match(/[а-яё]/gi) || []).length > (String(t).match(/[a-z]/gi) || []).length;

export function makeVoice({ azureKey = "", azureRegion = "", groqKey = "", fetchImpl = globalThis.fetch } = {}) {
  azureKey = String(azureKey || "").trim(); azureRegion = String(azureRegion || "").trim().toLowerCase(); groqKey = String(groqKey || "").trim();
  const azure = !!(azureKey && /^[a-z0-9]+$/.test(azureRegion));
  if (!azure && !groqKey) return null;
  // речь → текст. bytes — файл голосового (OGG/OPUS из Telegram)
  async function transcribe(bytes, { name = "voice.ogg", mime = "audio/ogg", sec = 0 } = {}) {
    if (azure) {
      const url = "https://" + azureRegion + ".api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15";
      const go = async (locales) => {
        const fd = new FormData();
        fd.append("audio", new Blob([bytes], { type: mime }), name);
        fd.append("definition", JSON.stringify({ locales }));
        const r = await fetchImpl(url, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": azureKey }, body: fd });
        const j = await r.json().catch(() => null);
        if (!r.ok) { const e = new Error("STT " + r.status + (j && j.error && j.error.message ? ": " + j.error.message : "")); e.status = r.status; throw e; }
        return j;
      };
      let j;
      // узбекский или русский — сервис сам определяет язык; если так нельзя — только узбекский
      try { j = await go(["uz-UZ", "ru-RU"]); } catch (e) { if (e.status !== 400 && e.status !== 422) throw e; j = await go(["uz-UZ"]); }
      const text = ((j && j.combinedPhrases) || []).map((p) => p.text).join(" ").trim();
      const s = j && j.durationMilliseconds ? j.durationMilliseconds / 1000 : sec;
      return { text, sec: s, cost: (s / 3600) * SPEECH_PRICE.azureStt };
    }
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type: mime }), name);
    fd.append("model", "whisper-large-v3");
    fd.append("response_format", "json");
    fd.append("prompt", "Thermo Engineering: obyekt, kassa, qarz, postavshik, so'm, dollar, to'lov, sklad, smeta. Объект, касса, долг, поставщик.");
    const r = await fetchImpl("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + groqKey }, body: fd });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error("STT " + r.status + (j && j.error && j.error.message ? ": " + j.error.message : ""));
    return { text: String((j && j.text) || "").trim(), sec, cost: (Math.max(sec, 10) / 3600) * SPEECH_PRICE.groqStt };
  }
  // текст → голосовое (OGG/OPUS — Telegram показывает как голосовое сообщение)
  async function speak(text, voice = DEF_VOICE) {
    if (!azure) return null;
    const ru = isRussian(text);
    const t = speakable(text, ru).slice(0, 1500);
    if (!t) return null;
    const uz = VOICES[voice] ? voice : DEF_VOICE;
    const v = ru ? VOICES[uz] : uz, lang = v.slice(0, 5);
    const ssml = "<speak version='1.0' xml:lang='" + lang + "'><voice name='" + v + "'>" + xml(t) + "</voice></speak>";
    const r = await fetchImpl("https://" + azureRegion + ".tts.speech.microsoft.com/cognitiveservices/v1", {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": azureKey, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "ogg-48khz-16bit-mono-opus", "User-Agent": "thermo-bot" },
      body: ssml,
    });
    if (!r.ok) throw new Error("TTS " + r.status);
    return { bytes: new Uint8Array(await r.arrayBuffer()), chars: t.length, cost: (t.length / 1e6) * SPEECH_PRICE.tts };
  }
  return { stt: true, tts: azure, provider: azure ? "azure" : "groq", transcribe, speak };
}
