// Подключение Telegram-бота к программе: GitHub → Actions → «Telegram-бот» → ULASH / HOLAT / UZISH.
// ULASH — Telegram будет присылать сообщения групп на сайт (вебхук /api/tg) + меню команд бота;
// HOLAT — проверить: подключён ли, видит ли сайт токен / базу / аккаунт бота; UZISH — отключить.
// В логах (репозиторий открытый) — никаких токенов и данных.
import { createHash } from "node:crypto";
const MODE = (process.argv[2] || "HOLAT").toUpperCase();
const SITE = String(process.env.SITE_URL || "https://thermo-ai-os.vercel.app").replace(/\/+$/, "");
// адрес бота: функция Supabase (BOT_URL ставит workflow) или сайт на Vercel (/api/tg)
const BOT_URL = String(process.env.BOT_URL || SITE + "/api/tg").replace(/\/+$/, "");
const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "").replace(/^bot(?=\d)/i, "");
const SECRET = createHash("sha256").update("thermo-tg:" + TOKEN).digest("hex").slice(0, 48);
const log = (s) => console.log(s);
const fail = (s) => { console.log("::error::" + s); process.exitCode = 1; };
async function tg(method, body) {
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
async function site() {
  try { const r = await fetch(BOT_URL); return r.ok ? await r.json() : { http: r.status }; } catch (e) { return { error: e.message }; }
}
// любая ошибка — понятной строкой в итог (без токенов)
process.on("unhandledRejection", (e) => { fail(String((e && e.message) || e).replace(/bot\d+:[\w-]+/g, "bot<TOKEN>")); process.exit(1); });
if (!TOKEN) { fail("Нет секрета TELEGRAM_BOT_TOKEN"); process.exit(); }
let me;
try { me = await tg("getMe"); }
catch (e) { fail("Telegram tokenni qabul qilmadi (" + e.message + ") — GitHub'dagi TELEGRAM_BOT_TOKEN BotFather bergan token bilan bir xil ekanini tekshiring"); process.exit(); }
log("Бот: @" + me.username);
const h = await site();
log("Бот-сервер " + BOT_URL.replace(/^https:\/\/([a-z0-9]{4})[a-z0-9]*/, "https://$1…") + ": " + JSON.stringify(h));
if (MODE === "ULASH") {
  if (!h.ok) { fail("Бот-сервер не отвечает — проверьте шаг выкладки выше"); process.exit(); }
  if (!h.bot) fail("У бот-сервера нет TELEGRAM_BOT_TOKEN");
  if (!h.account) console.log("::warning::Нет TG_BOT_LOGIN / TG_BOT_PASSWORD — нужны, если в базе включена защита входа");
  try { await tg("setWebhook", { url: BOT_URL, secret_token: SECRET, allowed_updates: ["message", "callback_query", "my_chat_member"], drop_pending_updates: true }); }
  catch (e) { fail("Telegram vebxukni o'rnatmadi: " + e.message); process.exit(); }
  await tg("setMyCommands", { commands: [
    { command: "kassa", description: "Bugungi kassa (kassa kecha / kassa 28.10)" },
    { command: "bugun", description: "Bugungi kirim-chiqim" },
    { command: "qarz", description: "Mijozlar qarzi (qarz Aziz)" },
    { command: "postavshik", description: "Postavshiklarga qarz" },
    { command: "obyekt", description: "Obyekt holati (obyekt nomi)" },
    { command: "yordam", description: "Qanday ishlatish" },
    { command: "id", description: "Chat ID" },
  ] });
  log("✅ Ulandi. Endi botni guruhga qo'shing va admin qiling, keyin dasturda Аккаунты → Telegram-бот → «Разрешить».");
} else if (MODE === "UZISH") {
  await tg("deleteWebhook", { drop_pending_updates: false });
  log("Bot dasturdan uzildi (guruh xabarlari endi kelmaydi). Ночной бэкап ishlashda davom etadi.");
} else {
  const w = await tg("getWebhookInfo");
  const on = /\/api\/tg$|\/functions\/v1\/tg$/.test(w.url || "");
  const mask = (u) => String(u || "").replace(/^https:\/\/([a-z0-9]{4})[a-z0-9]*/, "https://$1…");
  log(on ? "✅ Bot ulangan: " + mask(w.url) : "Bot ulanmagan" + (w.url ? " (boshqa manzil: " + mask(w.url) + ")" : ""));
  log("Navbatda xabarlar: " + (w.pending_update_count || 0) + (w.last_error_message ? " · oxirgi xato: " + w.last_error_message + " (" + new Date(w.last_error_date * 1000).toISOString() + ")" : ""));
  if (h.ok) log("Bot-server: token " + (h.bot ? "✓" : "✗") + " · baza " + (h.db ? "✓" : "✗") + " · bot akkaunti " + (h.account ? "✓" : "—"));
}
