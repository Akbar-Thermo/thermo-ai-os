// Telegram-бот Thermo — функция Supabase (Edge Function). Тот же бот, что api/tg.js (Vercel), — код из api/_lib
// копируется сюда при выкладке (GitHub → Actions → «Telegram-бот» → ULASH). Секреты функции ставит тот же workflow:
// TELEGRAM_BOT_TOKEN, TG_BOT_LOGIN, TG_BOT_PASSWORD (+ адрес базы и публичный ключ сайта — TG_DB_URL / TG_DB_KEY).
// ИИ и голос (секреты функций Supabase, ставит руководитель): ANTHROPIC_API_KEY — Claude; AZURE_SPEECH_KEY +
// AZURE_SPEECH_REGION — голосовые (узбекский: распознавание и ответ голосом); GROQ_API_KEY — запасное распознавание.
import { createHash } from "node:crypto";
import { makeRest } from "./_lib/rest.mjs";
import { makeBot } from "./_lib/bot.mjs";
import { makeAI } from "./_lib/ai.mjs";
import { makeVoice } from "./_lib/voice.mjs";

const env = (k) => (Deno.env.get(k) || "").trim();
const TOKEN = env("TELEGRAM_BOT_TOKEN").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "").replace(/^bot(?=\d)/i, "");
const SECRET = TOKEN ? createHash("sha256").update("thermo-tg:" + TOKEN).digest("hex").slice(0, 48) : "";
const URL_ = env("TG_DB_URL") || env("SUPABASE_URL");
const ANON = env("TG_DB_KEY") || env("SUPABASE_ANON_KEY");
const LOGIN = env("TG_BOT_LOGIN"), PASS = Deno.env.get("TG_BOT_PASSWORD") || "";
// ИИ (Claude): ключ — общий секрет функций проекта ANTHROPIC_API_KEY; модель — только Claude Haiku 5.5
const AI = makeAI({ key: env("ANTHROPIC_API_KEY"), model: "claude-haiku-5-5" }); // только Haiku 5.5
// голос: Azure Speech (узбекский — распознавание и ответ голосом) или Groq (только распознавание)
const VOICE = makeVoice({ azureKey: env("AZURE_SPEECH_KEY"), azureRegion: env("AZURE_SPEECH_REGION"), groqKey: env("GROQ_API_KEY") });

async function tg(method, payload) {
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok && !/message is not modified/.test(j.description || "")) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
// файл в Telegram (Excel клиенту, голосовой ответ) — multipart
async function upload(method, params, file) {
  const fd = new FormData();
  Object.entries(params || {}).forEach(([k, v]) => fd.append(k, String(v)));
  fd.append(file.field || "document", new Blob([file.bytes], { type: file.mime || "application/octet-stream" }), file.name || "file");
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
// скачать файл из Telegram (голосовое, фото накладной, PDF); в тексте ошибки нет адреса с токеном
async function download(fileId) {
  const f = await tg("getFile", { file_id: fileId });
  if (!f || !f.file_path) throw new Error("getFile: нет файла");
  let r;
  try { r = await fetch("https://api.telegram.org/file/bot" + TOKEN + "/" + f.file_path); } catch (e) { throw new Error("download: нет связи"); }
  if (!r.ok) throw new Error("download " + r.status);
  return { bytes: new Uint8Array(await r.arrayBuffer()), path: f.file_path };
}
let bot = null;
const getBot = () => bot || (bot = makeBot({ db: makeRest({ url: URL_, anon: ANON, login: LOGIN, password: PASS }), tg, upload, ai: AI, file: download, voice: VOICE, memKey: TOKEN }));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// ?tick=1 — расписание без секрета (sinov-база: pg_cron); делает то же, что обычный запуск по расписанию, не чаще раза в 30 с
let lastTick = 0;
Deno.serve(async (req) => {
  const qs = new URL(req.url).searchParams;
  if (qs.get("tick") === "1") {
    if (TOKEN && Date.now() - lastTick > 30e3) { lastTick = Date.now(); try { await getBot().handle({ te_cron: 1 }); } catch (e) { console.error("tg tick:", e && e.message); } }
    if (TOKEN && env("ZAKAZ_BOT_TOKEN")) { const zt = env("ZAKAZ_BOT_TOKEN").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "").replace(/^bot(?=\d)/i, ""); try { await fetch(env("SUPABASE_URL") + "/functions/v1/zakaz", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": createHash("sha256").update("thermo-zakaz:" + zt).digest("hex").slice(0, 48) }, body: "{\"te_cron\":1}" }); } catch (e) {} }
    return json(200, { ok: true });
  }
  if (req.method !== "POST") {
    const st = { ok: true, bot: !!TOKEN, db: !!(URL_ && ANON), account: !!(LOGIN && PASS), ai: !!AI, voice: VOICE ? VOICE.provider + (VOICE.tts ? "+tts" : "") : false };
    // ?setup=1 — подключить вебхук этого бота к этой функции (токен не показывается)
    if (TOKEN && qs.get("setup") === "1") {
      try {
        await tg("setWebhook", { url: env("SUPABASE_URL") + "/functions/v1/tg", secret_token: SECRET, allowed_updates: ["message", "callback_query", "my_chat_member"] });
        const me = await tg("getMe", {});
        return json(200, { ...st, webhook: "ok", username: me && me.username });
      } catch (e) { return json(200, { ...st, webhook: "error: " + String(e.message || e).slice(0, 200) }); }
    }
    return json(200, st);
  }
  if (!TOKEN || req.headers.get("x-telegram-bot-api-secret-token") !== SECRET) return json(401, { ok: false });
  let upd = null;
  try { upd = await req.json(); } catch (e) { upd = null; }
  // расписание будит и бота поставщиков (функция «zakaz»), если он подключён
  if (upd && upd.te_cron && env("ZAKAZ_BOT_TOKEN")) {
    const zt = env("ZAKAZ_BOT_TOKEN").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "").replace(/^bot(?=\d)/i, "");
    try { await fetch(env("SUPABASE_URL") + "/functions/v1/zakaz", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": createHash("sha256").update("thermo-zakaz:" + zt).digest("hex").slice(0, 48) }, body: "{\"te_cron\":1}" }); } catch (e) { console.error("tg→zakaz:", e && e.message); }
  }
  if (upd) {
    try { await getBot().handle(upd); }
    catch (e) {
      console.error("tg:", e && e.message);
      const chat = (upd.message && upd.message.chat) || (upd.callback_query && upd.callback_query.message && upd.callback_query.message.chat);
      if (chat && /^(NO_DB|NO_ACCOUNT|LOGIN)/.test((e && e.message) || "")) { try { await tg("sendMessage", { chat_id: chat.id, text: "⚠️ " + e.message.replace(/^\w+: /, "") }); } catch (e2) {} }
    }
  }
  return json(200, { ok: true });
});
