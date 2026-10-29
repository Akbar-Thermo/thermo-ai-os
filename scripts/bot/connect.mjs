// Подключение Telegram-бота к программе: GitHub → Actions → «Telegram-бот» → ULASH / HOLAT / UZISH.
// ULASH — Telegram будет присылать сообщения групп на сайт (вебхук /api/tg) + меню команд бота;
// HOLAT — проверить: подключён ли, видит ли сайт токен / базу / аккаунт бота; UZISH — отключить.
// В логах (репозиторий открытый) — никаких токенов и данных.
import { createHash } from "node:crypto";
const MODE = (process.argv[2] || "HOLAT").toUpperCase();
const SITE = String(process.env.SITE_URL || "https://thermo-ai-os.vercel.app").replace(/\/+$/, "");
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
  try { const r = await fetch(SITE + "/api/tg"); return r.ok ? await r.json() : { http: r.status }; } catch (e) { return { error: e.message }; }
}
if (!TOKEN) { fail("Нет секрета TELEGRAM_BOT_TOKEN"); process.exit(); }
const me = await tg("getMe");
log("Бот: @" + me.username);
const h = await site();
log("Сайт " + SITE + "/api/tg: " + JSON.stringify(h));
if (MODE === "ULASH") {
  if (!h.ok) fail("Сайт не отвечает на /api/tg — дождитесь окончания выкладки на Vercel и запустите снова");
  else {
    if (!h.bot) fail("На Vercel нет переменной TELEGRAM_BOT_TOKEN: Vercel → проект → Settings → Environment Variables → добавить, затем Redeploy");
    if (!h.account) console.log("::warning::Нет TG_BOT_LOGIN / TG_BOT_PASSWORD на Vercel — нужны, если в базе включена защита входа");
  }
  await tg("setWebhook", { url: SITE + "/api/tg", secret_token: SECRET, allowed_updates: ["message", "callback_query", "my_chat_member"], drop_pending_updates: true });
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
  const on = /\/api\/tg$/.test(w.url || "");
  log(on ? "✅ Bot ulangan: " + w.url : "Bot ulanmagan" + (w.url ? " (boshqa manzil: " + w.url + ")" : ""));
  log("Navbatda xabarlar: " + (w.pending_update_count || 0) + (w.last_error_message ? " · oxirgi xato: " + w.last_error_message + " (" + new Date(w.last_error_date * 1000).toISOString() + ")" : ""));
  if (h.ok) log("Sayt: token " + (h.bot ? "✓" : "✗") + " · baza " + (h.db ? "✓" : "✗") + " · bot akkaunti " + (h.account ? "✓" : "—"));
}
