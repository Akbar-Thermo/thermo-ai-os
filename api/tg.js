// Telegram-бот Thermo (вебхук). Подключение: GitHub → Actions → «Telegram-бот» → ULASH.
// Переменные Vercel (Settings → Environment Variables): TELEGRAM_BOT_TOKEN — токен бота;
// TG_BOT_LOGIN / TG_BOT_PASSWORD — аккаунт программы для бота (нужен, если в базе включена защита входа);
// адрес базы и публичный ключ — те же, что у сайта (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
process.env.TZ = "Asia/Tashkent";
import { createHash } from "node:crypto";
import { makeRest } from "./_lib/rest.mjs";
import { makeBot } from "./_lib/bot.mjs";

const clean = (s) => String(s || "").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "");
const TOKEN = clean(process.env.TELEGRAM_BOT_TOKEN).replace(/^bot(?=\d)/i, "");
// секрет вебхука выводится из токена — Telegram присылает его в заголовке, чужие запросы отбрасываются
const SECRET = TOKEN ? createHash("sha256").update("thermo-tg:" + TOKEN).digest("hex").slice(0, 48) : "";
const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const LOGIN = String(process.env.TG_BOT_LOGIN || "").trim();
const PASS = String(process.env.TG_BOT_PASSWORD || "");

async function tg(method, payload) {
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok && !/message is not modified/.test(j.description || "")) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
let bot = null;
const getBot = () => bot || (bot = makeBot({ db: makeRest({ url: URL_, anon: ANON, login: LOGIN, password: PASS }), tg }));

export default async function handler(req, res) {
  if (req.method !== "POST") {
    // проверка состояния (без секретов): есть ли токен, база, аккаунт бота
    return res.status(200).json({ ok: true, bot: !!TOKEN, db: !!(URL_ && ANON), account: !!(LOGIN && PASS) });
  }
  if (!TOKEN || req.headers["x-telegram-bot-api-secret-token"] !== SECRET) return res.status(401).json({ ok: false });
  let upd = req.body;
  if (typeof upd === "string") { try { upd = JSON.parse(upd); } catch (e) { upd = null; } }
  if (upd) {
    try { await getBot().handle(upd); }
    catch (e) {
      console.error("tg:", e && e.message);
      const chat = (upd.message && upd.message.chat) || (upd.callback_query && upd.callback_query.message && upd.callback_query.message.chat);
      if (chat && /^(NO_DB|NO_ACCOUNT|LOGIN)/.test(e.message || "")) { try { await tg("sendMessage", { chat_id: chat.id, text: "⚠️ " + e.message.replace(/^\w+: /, "") }); } catch (e2) {} }
    }
  }
  return res.status(200).json({ ok: true });
}
