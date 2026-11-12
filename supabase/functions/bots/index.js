// Thermo bots — пульт всех Telegram-ботов для программы (Аккаунты → «Боты»). Сами боты не трогаются:
// функция читает их токены из общих секретов функций и спрашивает Telegram (getMe / getWebhookInfo),
// «Подключить» — открывает ?setup=1 нужной функции, «Остановить» — снимает вебхук (бот молчит, сообщения
// Telegram копит до 24 часов; «Подключить» снова включает бота, накопленное при этом сбрасывается).
// Доступ — только руководитель: заголовок x-te-session (сессия программы) проверяется по te_sessions + users.
// Вызов: POST { action: "status" } | { action: "setup" | "stop", bot: "<функция>" }. verify_jwt выключен — проверка своя.

const env = (k) => (Deno.env.get(k) || "").trim();
const URL_ = env("SUPABASE_URL"), KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const clean = (t) => t.replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "").replace(/^bot(?=\d)/i, "");
// все боты проекта: функция Supabase → секрет(ы) с токеном
const BOTS = [
  { slug: "tg", title: "Касса (Telegram-бот)", secrets: ["TELEGRAM_BOT_TOKEN"] },
  { slug: "zakaz", title: "Бот поставщиков", secrets: ["ZAKAZ_BOT_TOKEN"] },
  { slug: "smeta", title: "Бот смет", secrets: ["SMETA_BOT_TOKEN"] },
  { slug: "ostatka", title: "Бот остатка", secrets: ["OSTATKA_BOT_TOKEN", "OSTATKA_bot"] },
];
const tokenOf = (b) => { for (const s of b.secrets) { const v = clean(env(s)); if (v) return v; } return ""; };

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-te-session, authorization, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function rest(path) {
  const r = await fetch(URL_ + "/rest/v1/" + path, { headers: { apikey: KEY, Authorization: "Bearer " + KEY } });
  if (!r.ok) throw new Error("db " + r.status);
  return r.json();
}
// живая сессия программы и роль «руководитель»
async function boss(token) {
  if (!/^[0-9a-f]{32,128}$/i.test(token || "")) return null;
  const s = (await rest(`te_sessions?token=eq.${token}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=user_id&limit=1`))[0];
  if (!s) return null;
  const u = (await rest(`users?id=eq.${s.user_id}&select=id,name,username,role,status&limit=1`))[0];
  return u && u.role === "boss" && (!u.status || u.status === "active") ? u : null;
}

async function tg(token, method, payload) {
  const r = await fetch("https://api.telegram.org/bot" + token + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}

async function statusOf(b) {
  const token = tokenOf(b), want = URL_ + "/functions/v1/" + b.slug;
  const out = { slug: b.slug, title: b.title, secret: b.secrets[0], token: !!token };
  // сама функция: отвечает ли и что у неё настроено (без токенов)
  try {
    const r = await fetch(want, { signal: AbortSignal.timeout(8000) });
    out.fn = r.ok ? await r.json().catch(() => ({ ok: false })) : { ok: false, status: r.status };
  } catch (e) { out.fn = { ok: false, error: "не отвечает" }; }
  if (!token) return { ...out, state: "no_token" };
  try {
    const [me, wh] = await Promise.all([tg(token, "getMe"), tg(token, "getWebhookInfo")]);
    out.username = me.username; out.name = me.first_name;
    out.pending = wh.pending_update_count || 0;
    if (wh.last_error_date && Date.now() / 1000 - wh.last_error_date < 86400) { out.error = wh.last_error_message || "ошибка"; out.error_at = new Date(wh.last_error_date * 1000).toISOString(); }
    const url = String(wh.url || "").split("?")[0];
    out.state = !url ? "stopped" : url === want ? (out.error && out.pending ? "errors" : "ok") : "elsewhere";
    if (out.state === "elsewhere") out.webhook = url.replace(/^https:\/\/([^/]+).*/, "$1"); // чужой адрес — только домен
  } catch (e) { out.state = "bad_token"; out.error = String(e.message || e).slice(0, 150); }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(200, { ok: true, bots: BOTS.map((b) => b.slug) });
  let body = {};
  try { body = await req.json(); } catch (e) {}
  let u = null;
  try { u = await boss(req.headers.get("x-te-session")); } catch (e) { return json(500, { ok: false, error: "База недоступна" }); }
  if (!u) return json(403, { ok: false, error: "Только для руководителя (войдите в программу заново)" });

  const b = BOTS.find((x) => x.slug === body.bot);
  try {
    if (body.action === "status") return json(200, { ok: true, bots: await Promise.all(BOTS.map(statusOf)) });
    if (!b) return json(400, { ok: false, error: "Нет такого бота" });
    const token = tokenOf(b);
    if (!token) return json(200, { ok: false, error: "Токен не задан: секрет " + b.secrets[0] });
    if (body.action === "setup") {
      const r = await fetch(URL_ + "/functions/v1/" + b.slug + "?setup=1");
      const j = await r.json().catch(() => ({}));
      return json(200, { ok: j.webhook === "ok", error: j.webhook === "ok" ? undefined : String(j.webhook || "функция не ответила"), bot: await statusOf(b) });
    }
    if (body.action === "stop") {
      await tg(token, "deleteWebhook", { drop_pending_updates: false });
      return json(200, { ok: true, bot: await statusOf(b) });
    }
    return json(400, { ok: false, error: "Неизвестное действие" });
  } catch (e) { return json(200, { ok: false, error: String(e.message || e).slice(0, 200) }); }
});
