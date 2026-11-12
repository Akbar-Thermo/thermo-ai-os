// Thermo ostatka — Telegram-бот остатка по счёт-фактурам (функция Supabase «ostatka»).
// «prixod» / «rasxod» + файлы .xls (или .zip) → /ostatka: итог и Excel. Без ИИ.
// Секрет функции (руководитель ставит сам): OSTATKA_BOT_TOKEN — токен бота от @BotFather.
// База: таблицы ostatka_invoices / ostatka_chats (supabase/ostatka/01_ostatka.sql) — только через ключ service role.
// Кто может пользоваться — программа: Аккаунты → «Бот остатка». Подключение: один раз ?setup=1.
import { createHash } from "node:crypto";
import { makeOstatkaBot, makeDb, OS_PEND_MODE } from "./bot.mjs";

const env = (k) => (Deno.env.get(k) || "").trim();
const TOKEN = env("OSTATKA_BOT_TOKEN").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "").replace(/^bot(?=\d)/i, "");
const SECRET = TOKEN ? createHash("sha256").update("thermo-ostatka:" + TOKEN).digest("hex").slice(0, 48) : "";
const URL_ = env("SUPABASE_URL"), KEY = env("SUPABASE_SERVICE_ROLE_KEY");

async function tg(method, payload) {
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
async function upload(method, params, f) {
  const fd = new FormData();
  Object.entries(params || {}).forEach(([k, v]) => fd.append(k, String(v)));
  fd.append(f.field || "document", new Blob([f.bytes], { type: f.mime || "application/octet-stream" }), f.name || "file");
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
async function file(fileId) {
  const f = await tg("getFile", { file_id: fileId });
  if (!f || !f.file_path) throw new Error("getFile: fayl yo'q");
  const r = await fetch("https://api.telegram.org/file/bot" + TOKEN + "/" + f.file_path);
  if (!r.ok) throw new Error("download " + r.status);
  return { bytes: new Uint8Array(await r.arrayBuffer()) };
}
// фоновая задача после ответа Telegram (отчёт о пачке файлов)
const later = (fn) => { const p = fn().catch((e) => console.error("ostatka later:", e && e.message)); try { EdgeRuntime.waitUntil(p); } catch (e) {} };

const db = URL_ && KEY ? makeDb({ url: URL_, key: KEY }) : null;
const bot = db && TOKEN ? makeOstatkaBot({ db, tg, upload, file, later }) : null;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    const st = { ok: true, bot: !!TOKEN, db: !!db };
    // ?setup=1 — подключить вебхук этого бота к этой функции (токен не показывается)
    if (TOKEN && new URL(req.url).searchParams.get("setup") === "1") {
      try {
        await tg("setWebhook", { url: URL_ + "/functions/v1/ostatka", secret_token: SECRET, allowed_updates: ["message"], max_connections: 1, drop_pending_updates: true });
        await tg("setMyCommands", { commands: [
          { command: "ostatka", description: "Qoldiqni hisoblash (Excel)" }, { command: "prixod", description: "Keyingi fayllar — prixod" },
          { command: "rasxod", description: "Keyingi fayllar — rasxod" }, { command: "fakturalar", description: "Fakturalar ro'yxati" },
          { command: "ochir", description: "Fakturani o'chirish: /ochir 20/26" }, { command: "tozalash", description: "Hammasini o'chirish: /tozalash ha" },
        ] });
        const me = await tg("getMe", {});
        // имя бота — в программу (карточка «Бот остатка»)
        if (db && me && me.username) { const p = (await db.cfg(OS_PEND_MODE)) || {}; await db.setCfg(OS_PEND_MODE, { ...p, bot: me.username }); }
        return json(200, { ...st, webhook: "ok", username: me && me.username });
      } catch (e) { return json(200, { ...st, webhook: "error: " + String(e.message || e).slice(0, 200) }); }
    }
    return json(200, st);
  }
  if (!TOKEN || req.headers.get("x-telegram-bot-api-secret-token") !== SECRET) return json(401, { ok: false });
  let upd = null;
  try { upd = await req.json(); } catch (e) { upd = null; }
  if (upd && bot) {
    try { await bot.handle(upd); }
    catch (e) {
      console.error("ostatka:", e && e.message);
      const chat = upd.message && upd.message.chat;
      if (chat) { try { await tg("sendMessage", { chat_id: chat.id, text: "⚠️ Xato: " + String((e && e.message) || e).replace(/^\w+: /, "").slice(0, 200) }); } catch (e2) {} }
    }
  }
  return json(200, { ok: true });
});
