// Ночной бэкап Thermo → Telegram.
// GitHub Actions запускает каждый день в 00:00 по Ташкенту (.github/workflows/nightly-backup.yml).
// Читает базу напрямую (psql, пароль — секрет SUPABASE_DB_PASSWORD), собирает:
//   · thermo_backup_ДАТА.json.gz — бэкап для восстановления (Журнал → Бэкап → выбрать файл), без паролей;
//   · thermo_arxiv_ДАТА.xlsx — Excel-архив всей базы (тот же, что кнопка «Excel-архив» в программе);
// и отправляет оба файла руководителю в Telegram (секреты TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).
// Режим «check»: проверить бота; если TELEGRAM_CHAT_ID ещё не задан — бот сам пишет каждому, кто нажал Start, его ID.
// В логах (репозиторий открытый) печатаются только количества — никаких данных.
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MODE = process.argv[2] || "backup";
// токен из @BotFather; лишние пробелы/кавычки/«bot» в начале при копировании — убираем
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "").replace(/^bot(?=\d)/i, "");
// получатели: один или несколько ID через запятую / пробел (например «123456789, 987654321»); можно и ID группы (-100…)
// «-100 1234567890» (пробел внутри ID группы) — склеиваем: короткий кусок (до 4 цифр или один «-») — начало следующего числа
function parseChats(raw) {
  const out = [];
  String(raw || "").replace(/[\u2212\u2012-\u2015]/g, "-").split(/[,;\n]+/).forEach((part) => {
    const toks = part.replace(/[^\d\s-]/g, " ").split(/\s+/).filter(Boolean);
    let acc = "";
    toks.forEach((t) => { acc += t; if (!/^-?\d{0,4}$/.test(acc)) { out.push(acc); acc = ""; } });
    if (acc) out.push(acc);
  });
  return [...new Set(out.filter((x) => /^-?\d{5,}$/.test(x)))];
}
const CHATS = parseChats(process.env.TELEGRAM_CHAT_ID);
// в логах (репозиторий открытый) ID не печатаем целиком — только конец и длину, чтобы найти ошибку в секрете
const maskId = (id) => "…" + String(id).slice(-4) + " (" + String(id).replace("-", "").length + " цифр" + (String(id).startsWith("-") ? ", с минусом" : "") + ")";
const NOT_FOUND_HINT = " — проверьте этот ID в секрете TELEGRAM_CHAT_ID: у человека — число из сообщения бота «Ваш TELEGRAM_CHAT_ID» (и он должен нажать в боте «Start»); у группы — число с минусом -100…, и бот должен состоять в группе";
// отправка с исправлением частой ошибки: ID группы скопирован без минуса — пробуем «-ID»
const fixedIds = {};
const migrated = new Set();
async function tgTo(id, method, fields, file) {
  const to = fixedIds[id] || id;
  try { return await tg(method, { ...fields, chat_id: to }, file); }
  catch (e) {
    // группу превратили в «супергруппу» (например, сменили фото/настройки) — у неё новый ID; Telegram его сообщает
    const nid = e.tg && e.tg.parameters && e.tg.parameters.migrate_to_chat_id;
    if (nid) {
      fixedIds[id] = String(nid);
      const r = await tg(method, { ...fields, chat_id: nid }, file);
      if (!migrated.has(id)) {
        migrated.add(id);
        console.log("::warning::ID группы " + maskId(id) + " сменился (группа стала супергруппой) — отправил на новый ID …" + String(nid).slice(-4) + ". Новый ID бот написал в группу — замените его в секрете TELEGRAM_CHAT_ID");
        try { await tg("sendMessage", { chat_id: nid, parse_mode: "HTML", text: "ℹ️ У группы новый ID: <code>" + nid + "</code> (нажмите — скопируется).\nЗамените им старый ID группы в GitHub → Settings → Secrets and variables → Actions → TELEGRAM_CHAT_ID. Бэкапы приходят и сейчас." }); } catch (e3) {}
      }
      return r;
    }
    if (!/chat not found/i.test(e.message) || String(to).startsWith("-")) throw /chat not found/i.test(e.message) ? new Error(e.message + NOT_FOUND_HINT) : e;
    let r;
    try { r = await tg(method, { ...fields, chat_id: "-" + to }, file); } catch (e2) { throw new Error(e.message + NOT_FOUND_HINT); }
    fixedIds[id] = "-" + to;
    console.log("::warning::ID " + maskId(id) + " указан без минуса — отправил на «-ID» (группа). Исправьте секрет TELEGRAM_CHAT_ID: поставьте минус в начале");
    return r;
  }
}
const CHAT = CHATS.join(",");
const TG = process.env.TE_TG_API || "https://api.telegram.org";
const TABLES = ["products", "suppliers", "objects", "finance_ops", "requests", "masters", "warehouse", "wh_moves", "users", "audit_log"];
const log = (s) => console.log("▶ " + s);
const fail = (s) => { console.log("::error::" + s); process.exitCode = 1; };

// без файла — обычный JSON (пустая multipart-форма Telegram отвергает с ошибкой 400), с файлом — multipart
async function tg(method, fields, file) {
  let opts;
  if (file) {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, String(v)));
    fd.append(file.field, new Blob([file.data]), file.name);
    opts = { method: "POST", body: fd };
  } else opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields || {}) };
  const r = await fetch(TG + "/bot" + TOKEN + "/" + method, opts);
  const txt = await r.text();
  let j = {}; try { j = JSON.parse(txt); } catch (e) {}
  if (!j.ok) {
    const why = j.description || (r.status + " " + txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80));
    const hint = r.status === 401 || r.status === 404 ? " — проверьте секрет TELEGRAM_BOT_TOKEN (весь токен из @BotFather, вида 123456:ABC…)" : "";
    const err = new Error("Telegram " + method + ": " + why + hint);
    err.tg = j;
    throw err;
  }
  return j.result;
}

// подключение к базе — как в supabase/secure/run.sh
// подключение: секрет SUPABASE_DB_URL (строка «Session pooler» из Supabase → Connect) — если задан; иначе адрес из supabase/.temp/pooler-url
const DB_URL = (process.env.SUPABASE_DB_URL || "").trim();
function pgEnv() {
  const pool = existsSync("supabase/.temp/pooler-url") ? readFileSync("supabase/.temp/pooler-url", "utf8").trim() : "";
  const m = /^postgres(?:ql)?:\/\/([^@:]+)[^@]*@([^:/]+):(\d+)\//.exec(pool) || [];
  const env = { ...process.env, PGDATABASE: "postgres", PGSSLMODE: process.env.TE_SSL || "require", PGCONNECT_TIMEOUT: "20" };
  if (DB_URL) return env;
  return { ...env, PGHOST: process.env.TE_PGHOST || m[2] || "", PGPORT: process.env.TE_PGPORT || m[3] || "5432", PGUSER: process.env.TE_PGUSER || m[1] || "" };
}
// понятная причина ошибки подключения (полностью, без обрезки)
function pgReason(stderr) {
  const t = String(stderr || "").replace(/\s+/g, " ").trim();
  const fatal = (/FATAL:\s*(.+?)(?:\s*psql:|$)/i.exec(t) || [])[1] || "";
  const why = fatal || t.replace(/^psql: error: /, "");
  if (/password authentication failed/i.test(t)) return "неверный пароль базы — в Supabase сбросьте пароль (Database → Settings → Reset database password) и вставьте новый в секрет SUPABASE_DB_PASSWORD [" + why + "]";
  if (/Tenant or user not found/i.test(t)) return "адрес подключения к базе устарел — добавьте секрет SUPABASE_DB_URL: Supabase → кнопка «Connect» → «Session pooler» → скопировать строку [" + why + "]";
  if (/circuit breaker|too many authentication|too many connections|max client/i.test(t)) return "Supabase временно ограничил подключения (было много неверных паролей или подключений) — подождите 30–60 минут [" + why + "]";
  if (/timeout|could not translate|Network is unreachable|could not connect/i.test(t)) return "база не отвечает (сеть / проект на паузе в Supabase) [" + why + "]";
  return why.slice(0, 300) || "ошибка psql";
}
function psqlJson(sql) {
  let out;
  const args = ["-v", "ON_ERROR_STOP=1", "-qtA", ...(DB_URL ? ["-d", DB_URL] : []), "-c", sql];
  try { out = execFileSync("psql", args, { env: pgEnv(), maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).toString().trim(); }
  catch (e) {
    const t = String(e.stderr || e.message || e);
    if (/connection to server|FATAL|could not connect|timeout|could not translate/i.test(t)) throw new Error("нет подключения к базе: " + pgReason(t));
    throw new Error(t.split("\n").map((l) => l.trim()).filter(Boolean)[0].slice(0, 300));
  }
  return JSON.parse(out || "null");
}
function readTable(t) {
  if (!psqlJson(`select to_json(to_regclass('public.${t}') is not null)`)) return [];
  try { return psqlJson(`select coalesce(json_agg(x), '[]'::json) from (select * from public.${t} order by created_at nulls first, id) x`); }
  catch (e) { return psqlJson(`select coalesce(json_agg(x), '[]'::json) from (select * from public.${t} order by id) x`); }
}
// дата дня, который закончился (Ташкент UTC+5, без перехода на летнее время)
const dayEnded = () => new Date(Date.now() + 5 * 3600e3 - 12 * 3600e3).toISOString().slice(0, 10);
const ru = (iso) => iso.split("-").reverse().join(".");

async function check() {
  if (!TOKEN) { fail("Нет секрета TELEGRAM_BOT_TOKEN"); return; }
  const me = await tg("getMe", {});
  log("Бот: @" + me.username);
  let okN = 0;
  for (const id of CHATS) {
    try { await tgTo(id, "sendMessage", { text: "✅ Бот бэкапов Thermo подключён. Каждый день в 00:00 сюда будут приходить бэкап базы и Excel-архив." }); okN++; }
    catch (e) { console.log("::warning::Получатель №" + (CHATS.indexOf(id) + 1) + " " + maskId(id) + ": не удалось отправить (" + e.message + ")"); }
  }
  if (CHATS.length) log("Тестовое сообщение отправлено получателям: " + okN + " из " + CHATS.length);
  if (okN < CHATS.length) fail("Не дошло до получателей: " + (CHATS.length - okN) + " из " + CHATS.length + " — какой именно и почему, см. предупреждения выше");
  // бот подключён к программе (Telegram-бот в группе, вебхук /api/tg) — его не отключаем; ID чата бот пишет сам на команду /id
  let hook = null;
  try { hook = await tg("getWebhookInfo", {}); } catch (e) {}
  if (hook && /\/api\/tg|\/functions\/v1\/tg/.test(hook.url || "")) {
    log("Бот подключён к программе (Telegram-бот, вебхук) — узнать ID чата: напишите боту /id");
    if (!CHATS.length) fail("Нет секрета TELEGRAM_CHAT_ID: напишите боту /id (в личке или в группе) и вставьте число в секрет");
    return;
  }
  // если у бота когда-то был webhook, getUpdates ничего не отдаёт — снимаем (сообщения не теряются)
  try { await tg("deleteWebhook", { drop_pending_updates: false }); } catch (e) {}
  const ups = await tg("getUpdates", { limit: 100, allowed_updates: ["message", "edited_message", "my_chat_member"] });
  // новые люди / группы, которые написали боту, но ещё не в списке получателей — им бот присылает их ID
  const chats = new Map();
  ups.forEach((u) => {
    const m = u.message || u.edited_message || u.my_chat_member;
    if (m && m.chat && ["private", "group", "supergroup"].includes(m.chat.type) && !CHATS.includes(String(m.chat.id)) && !Object.values(fixedIds).includes(String(m.chat.id))) chats.set(m.chat.id, m.chat);
  });
  log("Обновлений у бота: " + ups.length + ", новых чатов (ещё не получатели): " + chats.size);
  if (CHATS.length && !chats.size) return;
  if (!chats.size) {
    fail("Бот пока не видит ваших сообщений: напишите @" + me.username + " любое сообщение (например «salom») и запустите проверку снова. " +
      "Или узнайте свой ID у @userinfobot и вставьте его в секрет TELEGRAM_CHAT_ID");
    return;
  }
  for (const id of chats.keys()) {
    await tg("sendMessage", { chat_id: id, parse_mode: "HTML", text: "Ваш TELEGRAM_CHAT_ID: <code>" + id + "</code>" + (String(id).startsWith("-") ? " (вместе с минусом)" : "") + "\nНажмите на число — оно скопируется.\n\nДобавьте это число в GitHub → Settings → Secrets and variables → Actions → секрет TELEGRAM_CHAT_ID " +
      "(несколько получателей — через запятую: 111111111,222222222) и запустите проверку ещё раз." });
  }
  log("ID отправлен в Telegram (новых чатов: " + chats.size + "). Добавьте его в секрет TELEGRAM_CHAT_ID (через запятую) и запустите проверку снова.");
}

async function backup() {
  if (!TOKEN || !CHAT) { log("Ночной бэкап в Telegram ещё не настроен (нет секретов TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) — пропускаю"); return; }
  if (!process.env.PGPASSWORD && !/:[^:@\/]+@/.test(DB_URL)) throw new Error("Нет секрета SUPABASE_DB_PASSWORD");
  const day = dayEnded();
  const dump = { _app: "ThermoAI", _date: new Date().toISOString(), _note: "ночной бэкап (сервер), без паролей", tables: {} };
  for (const t of TABLES) dump.tables[t] = readTable(t);
  // пароли не отправляем: при восстановлении у существующих аккаунтов они сохраняются
  dump.tables.users = dump.tables.users.map(({ pass_hash, need_seed_pass, ...u }) => u);
  const counts = TABLES.map((t) => t + ": " + dump.tables[t].length).join(", ");
  log("Прочитано из базы — " + counts);
  if (!dump.tables.products.length && !dump.tables.objects.length) throw new Error("база вернулась пустой — бэкап не отправлен");
  const json = gzipSync(Buffer.from(JSON.stringify(dump)), { level: 9 });
  if (json.length > 49e6) throw new Error("файл бэкапа больше 50 МБ — Telegram не примет");
  // Excel-архив — дополнение: если он не собрался, бэкап базы (.json.gz) всё равно уходит, а в Telegram — пометка
  let xlsx = null, xErr = "";
  try {
    const bundle = process.env.TE_ARCHIVE_BUNDLE || ".nightly/archive.mjs";
    const { archiveBook } = await import(pathToFileURL(bundle).href);
    xlsx = Buffer.from(await archiveBook(dump.tables, "Ночной бэкап (сервер)").arrayBuffer());
    if (xlsx.length > 49e6) { xlsx = null; xErr = "Excel-архив больше 50 МБ — Telegram не примет"; }
  } catch (e) { xErr = "Excel-архив не собрался: " + String((e && e.message) || e).split("\n")[0].slice(0, 200); }
  if (xErr) console.log("::warning::" + xErr);
  const jName = "thermo_backup_" + day + ".json.gz", xName = "thermo_arxiv_" + day + ".xlsx";
  const T = dump.tables;
  const cap = "💾 Thermo — бэкап на конец дня " + ru(day) + "\n" +
    "Объектов: " + T.objects.length + " · операций: " + T.finance_ops.length + " · товаров: " + T.products.length + "\n" +
    "Восстановить: Журнал → Бэкап → «выбрать файл .json / .json.gz».";
  // первому получателю — загрузка файлов, остальным — те же файлы по file_id (без повторной загрузки)
  const xCap = "📊 Excel-архив всей базы на конец дня " + ru(day);
  let jId = null, xId = null, sent = 0;
  const fails = [];
  for (const id of CHATS) {
    try {
      const a = jId ? await tgTo(id, "sendDocument", { document: jId, caption: cap, disable_notification: true })
        : await tgTo(id, "sendDocument", { caption: cap, disable_notification: "true" }, { field: "document", name: jName, data: json });
      jId = jId || (a.document && a.document.file_id);
      sent++;
      if (xlsx) {
        const b = xId ? await tgTo(id, "sendDocument", { document: xId, caption: xCap, disable_notification: true })
          : await tgTo(id, "sendDocument", { caption: xCap, disable_notification: "true" }, { field: "document", name: xName, data: xlsx });
        xId = xId || (b.document && b.document.file_id);
      } else await tgTo(id, "sendMessage", { text: "⚠️ Бэкап базы отправлен. " + xErr + "\nПодробности: GitHub → Actions → «Ночной бэкап в Telegram»." });
    } catch (e) { fails.push("получатель №" + (CHATS.indexOf(id) + 1) + " " + maskId(id) + ": " + e.message); }
  }
  log("Отправлено в Telegram (получателей: " + sent + " из " + CHATS.length + "): " + jName + " (" + Math.round(json.length / 1024) + " КБ)" + (xlsx ? ", " + xName + " (" + Math.round(xlsx.length / 1024) + " КБ)" : " — без Excel-архива"));
  if (fails.length) { fails.forEach((f) => console.log("::warning::" + f)); if (!sent) throw new Error("не доставлено ни одному получателю"); }
}

try {
  if (MODE === "check") await check(); else await backup();
} catch (e) {
  fail("Ночной бэкап не удался: " + e.message);
  if (TOKEN && CHATS.length && MODE !== "check") for (const id of CHATS) { try { await tgTo(id, "sendMessage", { text: "⚠️ Ночной бэкап Thermo не удался: " + e.message + "\nПодробности: GitHub → Actions → «Ночной бэкап в Telegram»." }); } catch (e2) {} }
}
