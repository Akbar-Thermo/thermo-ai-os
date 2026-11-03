// Thermo postavka — бот поставщиков (функция Supabase «zakaz»). Тот же код, что у бота «tg» (api/_lib), в режиме zakaz:
// новые поставки → «✅ Yuborish» → заказ в группу каждого поставщика; накладная поставщика → группа расходов с объектом и «✅ Kiritish».
// Секреты функций (руководитель ставит сам): ZAKAZ_BOT_TOKEN — токен бота от @BotFather. ИИ — только Claude Haiku 5.5.
// Подключение: один раз открыть https://<проект>.supabase.co/functions/v1/zakaz?setup=1; программа будит при сохранении объекта (?poke=1),
// запасное расписание — функция «tg» каждые 5 минут.
import { createHash } from "node:crypto";
import { makeRest } from "../tg/_lib/rest.mjs";
import { makeBot } from "../tg/_lib/bot.mjs";
import { makeAI } from "../tg/_lib/ai.mjs";
import { makeVoice } from "../tg/_lib/voice.mjs";

const env = (k) => (Deno.env.get(k) || "").trim();
const TOKEN = env("ZAKAZ_BOT_TOKEN").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "").replace(/^bot(?=\d)/i, "");
const SECRET = TOKEN ? createHash("sha256").update("thermo-zakaz:" + TOKEN).digest("hex").slice(0, 48) : "";
const URL_ = env("TG_DB_URL") || env("SUPABASE_URL");
const ANON = env("TG_DB_KEY") || env("SUPABASE_ANON_KEY");
const LOGIN = env("TG_BOT_LOGIN"), PASS = Deno.env.get("TG_BOT_PASSWORD") || "";
const AI = makeAI({ key: env("ANTHROPIC_API_KEY"), model: "claude-haiku-5-5" }); // только Haiku 5.5
const VOICE = makeVoice({ azureKey: env("AZURE_SPEECH_KEY"), azureRegion: env("AZURE_SPEECH_REGION"), groqKey: env("GROQ_API_KEY") });

async function tg(method, payload) {
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok && !/message is not modified/.test(j.description || "")) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
async function upload(method, params, file) {
  const fd = new FormData();
  Object.entries(params || {}).forEach(([k, v]) => fd.append(k, String(v)));
  fd.append(file.field || "document", new Blob([file.bytes], { type: file.mime || "application/octet-stream" }), file.name || "file");
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
async function download(fileId) {
  const f = await tg("getFile", { file_id: fileId });
  if (!f || !f.file_path) throw new Error("getFile: нет файла");
  let r;
  try { r = await fetch("https://api.telegram.org/file/bot" + TOKEN + "/" + f.file_path); } catch (e) { throw new Error("download: нет связи"); }
  if (!r.ok) throw new Error("download " + r.status);
  return { bytes: new Uint8Array(await r.arrayBuffer()), path: f.file_path };
}
let bot = null;
const getBot = () => bot || (bot = makeBot({ db: makeRest({ url: URL_, anon: ANON, login: LOGIN, password: PASS }), tg, upload, ai: AI, file: download, voice: VOICE, memKey: TOKEN, zakaz: true }));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// «poke» из программы (объект сохранён): проверить новые поставки сейчас. Без секрета — но делает только то же,
// что расписание (предложение руководителю один раз на поставку), и не чаще одного прохода одновременно.
let running = null, again = false;
async function tickNow() {
  if (running) { again = true; return running; }
  running = (async () => { do { again = false; try { await getBot().handle({ te_cron: 1 }); } catch (e) { console.error("zakaz poke:", e && e.message); } } while (again); })();
  try { await running; } finally { running = null; }
}
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("poke") === "1") {
    if (TOKEN) await tickNow();
    return new Response("ok", { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  if (req.method !== "POST") {
    const st = { ok: true, bot: !!TOKEN, db: !!(URL_ && ANON), account: !!(LOGIN && PASS), model: AI ? AI.model : false, voice: !!VOICE };
    // ?setup=1 — подключить вебхук этого бота к этой функции (токен не показывается)
    if (TOKEN && new URL(req.url).searchParams.get("setup") === "1") {
      const base = env("SUPABASE_URL");
      try {
        await tg("setWebhook", { url: base + "/functions/v1/zakaz", secret_token: SECRET, allowed_updates: ["message", "callback_query", "my_chat_member"], drop_pending_updates: true });
        const me = await tg("getMe", {});
        return json(200, { ...st, webhook: "ok", username: me && me.username });
      } catch (e) { return json(200, { ...st, webhook: "error: " + String(e.message || e).slice(0, 200) }); }
    }
    return json(200, st);
  }
  if (!TOKEN || req.headers.get("x-telegram-bot-api-secret-token") !== SECRET) return json(401, { ok: false });
  let upd = null;
  try { upd = await req.json(); } catch (e) { upd = null; }
  if (upd) {
    try { await getBot().handle(upd); }
    catch (e) {
      console.error("zakaz:", e && e.message);
      const chat = (upd.message && upd.message.chat) || (upd.callback_query && upd.callback_query.message && upd.callback_query.message.chat);
      if (chat && chat.type === "private") { try { await tg("sendMessage", { chat_id: chat.id, text: "⚠️ Xato: " + String((e && e.message) || e).replace(/^\w+: /, "").slice(0, 200) }); } catch (e2) {} }
    }
  }
  return json(200, { ok: true });
});
