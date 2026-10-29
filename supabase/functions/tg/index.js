// Telegram-бот Thermo — функция Supabase (Edge Function). Тот же бот, что api/tg.js (Vercel), — код из api/_lib
// копируется сюда при выкладке (GitHub → Actions → «Telegram-бот» → ULASH). Секреты функции ставит тот же workflow:
// TELEGRAM_BOT_TOKEN, TG_BOT_LOGIN, TG_BOT_PASSWORD (+ адрес базы и публичный ключ сайта — TG_DB_URL / TG_DB_KEY).
// Фото чеков читает Claude, если в секретах функций есть ANTHROPIC_API_KEY (модель можно задать TG_AI_MODEL).
import { createHash } from "node:crypto";
import { makeRest } from "./_lib/rest.mjs";
import { makeBot } from "./_lib/bot.mjs";
import { makeReader } from "./_lib/receipt.mjs";

const env = (k) => (Deno.env.get(k) || "").trim();
const TOKEN = env("TELEGRAM_BOT_TOKEN").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "").replace(/^bot(?=\d)/i, "");
const SECRET = TOKEN ? createHash("sha256").update("thermo-tg:" + TOKEN).digest("hex").slice(0, 48) : "";
const URL_ = env("TG_DB_URL") || env("SUPABASE_URL");
const ANON = env("TG_DB_KEY") || env("SUPABASE_ANON_KEY");
const LOGIN = env("TG_BOT_LOGIN"), PASS = Deno.env.get("TG_BOT_PASSWORD") || "";
// чтение чеков (фото): ключ Anthropic — общий секрет функций проекта (его же использует ai-proxy)
const AI_KEY = env("ANTHROPIC_API_KEY"), AI_MODEL = env("TG_AI_MODEL");

async function tg(method, payload) {
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok && !/message is not modified/.test(j.description || "")) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
// файл из Telegram (фото чека) — по file_id
async function file(id) {
  const f = await tg("getFile", { file_id: id });
  if (!f || !f.file_path) throw new Error("getFile: file_path yo'q");
  let r;
  try { r = await fetch("https://api.telegram.org/file/bot" + TOKEN + "/" + f.file_path); }
  catch (e) { throw new Error("file: yuklab bo'lmadi"); } // в тексте ошибки был бы адрес с токеном
  if (!r.ok) throw new Error("file: " + r.status);
  return { bytes: new Uint8Array(await r.arrayBuffer()) };
}
let bot = null;
const getBot = () => bot || (bot = makeBot({ db: makeRest({ url: URL_, anon: ANON, login: LOGIN, password: PASS }), tg, file, reader: makeReader({ key: AI_KEY, model: AI_MODEL }) }));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(200, { ok: true, bot: !!TOKEN, db: !!(URL_ && ANON), account: !!(LOGIN && PASS), ai: !!AI_KEY });
  if (!TOKEN || req.headers.get("x-telegram-bot-api-secret-token") !== SECRET) return json(401, { ok: false });
  let upd = null;
  try { upd = await req.json(); } catch (e) { upd = null; }
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
