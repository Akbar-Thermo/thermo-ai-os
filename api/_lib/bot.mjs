// Telegram-бот Thermo: в разрешённой группе находит расходы/приходы в сообщениях («taksi 50 000», «prixod 500$ …»),
// спрашивает кнопками и после «✅» вносит в программу (Финансы → расход/приход компании); считает кассу так же,
// как программа (тот же код — core.mjs), и отвечает на команды: /kassa /bugun /qarz /postavshik /obyekt /yordam.
// Группы разрешает руководитель в программе (Аккаунты → Telegram-бот); бот сам записывает группы, куда его добавили.
import * as C from "./core.mjs";
import { createHash } from "node:crypto";

export const CFG_MODE = "te_tg";        // разрешённые группы — меняет руководитель (lines.allowed = [{ id, title }])
export const PEND_MODE = "te_tgpend";   // группы, куда добавили бота, — пишет бот (lines.groups = [{ id, title, at }])
export const LINK_MODE = "te_tglink";   // одноразовые ссылки «Telegram ulash» (программа): lines = { user_id, hash, exp }
export const USERS_MODE = "te_tgusers"; // кто чей: lines.links = { <telegram id>: { user_id, tg, at } } (пишет бот)
export const LOG_MODE = "te_tg";        // скрытая запись журнала: entity «tg:<группа>:<сообщение>», detail — id операции

// ---------- дата и числа ----------
export const tzDate = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tashkent" });
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dt = (iso) => (iso ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : "");
const sum = (n) => C.fmtDot(Math.round(n)) + " so'm";
const usd = (n) => C.fmtDot(C.round2(n)) + " $";
const low = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[ʻʼ‘’`´]/g, "'");

// «120 000», «120.000», «1,250.50», «12.5», «1.200.000,5» → число
export function toNum(s) {
  const t = String(s).replace(/[\s  ]/g, "");
  const last = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
  if (last < 0) return Number(t);
  const tail = t.slice(last + 1), head = t.slice(0, last).replace(/[.,]/g, "");
  if (tail.length === 3) return Number(head + tail); // разделитель тысяч
  return Number(head + "." + tail);
}
const CUR_RE = "(\\$|usd|у\\.?\\s?е\\.?|dollar|доллар|долл|sum|so'?m|сум|сўм|som)";
const MUL_RE = "(k|к|ming|минг|тыс\\.?|тысяч|mln|млн|million|миллион)";
const QTY_RE = /^\s*(ta|та|шт|dona|дона|kg|кг|metr|метр|м\b|m\b|litr|литр|л\b|x\b|х\b|pcs|pachka|пачка|qop|коп|қоп|kun|кун|soat|соат)/i;
// сумма из сообщения: число (с разделителями тысяч), «k/ming/mln», валюта рядом ($, sum, so'm…)
export function findAmount(text) {
  // ссылки не читаем: «https://promo.click.uz/2HUz/…» — не сумма
  const s = low(text).replace(/(?:https?:\/\/|www\.)\S+|\S+\.(?:uz|com|ru|org|net|me|io)(?:\/\S*)?/g, " ");
  // множитель и валюта — только целым словом («karta» — не «k», «summa» — не «sum»)
  const re = new RegExp("(\\$\\s*)?(\\d{1,3}(?:[ \\u00a0\\u202f.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d+)?)(?:\\s*" + MUL_RE + "(?![\\p{L}]))?(?:\\s*" + CUR_RE + "(?![\\p{L}]))?", "giu");
  const cands = [];
  let m;
  while ((m = re.exec(s))) {
    const after = s.slice(m.index + m[0].length);
    const before = s.slice(Math.max(0, m.index - 1), m.index);
    if (/[\d\p{L}]/u.test(before) && !m[1]) continue;           // часть слова/кода (например «ppr25»)
    if (!m[3] && !m[4] && /^\p{L}/u.test(after)) continue;      // цифра, слитая с буквами («2huz», «5a»), — не сумма
    if (!m[4] && !m[1] && QTY_RE.test(after)) continue;          // «2 ta», «10 m» — количество
    if (/^\s*[./-]\s*\d/.test(after) && !m[4]) continue;        // дата «28.10.2026» / «28/10»
    if (/^\d{1,2}[.,]\d{2}$/.test(m[2]) && !m[4] && !m[1] && /\b(kurs|курс)\b/.test(s.slice(Math.max(0, m.index - 8), m.index))) continue;
    let v = toNum(m[2]);
    if (!(v > 0)) continue;
    const mul = m[3] ? (/^(mln|млн|million|миллион)/.test(m[3]) ? 1e6 : 1000) : 1;
    v *= mul;
    const prevWord = s.slice(Math.max(0, m.index - 6), m.index);
    if (/(kurs|курс)\s*$/.test(prevWord)) continue;                // «kurs 12 600» — курс, не сумма
    const cur = m[1] || (m[4] && /^(\$|usd|у|dollar|доллар|долл)/.test(m[4])) ? "usd" : m[4] ? "uzs" : null;
    cands.push({ v, cur, marked: !!(m[1] || m[4] || m[3]) });
  }
  if (!cands.length) return null;
  const marked = cands.filter((c) => c.marked);
  const pick = (marked.length ? marked : cands).reduce((a, b) => (b.v > a.v ? b : a));
  return { v: pick.v, cur: pick.cur || (/\$|usd|dollar|доллар/.test(s) ? "usd" : pick.v >= 1000 ? "uzs" : "usd") };
}
export function findRate(text) {
  const m = /(?:kurs|курс)\s*[:=]?\s*(\d[\d\s.,]*)/i.exec(low(text));
  if (!m) return 0;
  const r = toNum(m[1].trim());
  return r > 0 && r < 100 ? Math.round(r * 1000) : r >= 1000 ? r : 0;
}
const has = (s, words) => words.some((w) => (w instanceof RegExp ? w.test(s) : s.includes(w)));
const IN_WORDS = ["prixod", "приход", "kirim", "кирим", "keldi", "келди", "tushdi", "тушди", "tushum", "тушум", "postuplen", "поступлен", "доход", "daromad", "даромад"];
const OUT_WORDS = ["rasxod", "расход", "chiqim", "чиқим", "chiqdi", "чиқди", "xarajat", "харажат", "potratil", "потрат"];
export function guessDir(text) {
  const s = low(text).trim();
  if (/^\+/.test(s)) return "i";
  if (/^[-−]/.test(s)) return "e";
  if (has(s, OUT_WORDS)) return "e";
  return has(s, IN_WORDS) ? "i" : "e";
}
export function guessMethod(text) {
  const s = low(text);
  if (has(s, ["karta", "карта", "card", "plastik", "пластик", "uzcard", "humo", "хумо", "click", "payme", "клик"])) return "card";
  if (has(s, ["perech", "перечис", "bank", "банк", "o'tkazma", "ўтказма", "utkazma", "hisob raqam", "счёт", "счет"])) return "transfer";
  return "cash";
}
// статьи расходов программы (без «Зарплата»: выплата зарплаты вносится в программе — с сотрудником)
export const expCats = () => C.EXPENSE_CATEGORIES.filter((c) => c !== C.SALARY_CAT);
export const incCats = () => C.INCOME_CATEGORIES.slice();
const CAT_WORDS = [
  ["Обед", ["obed", "abed", "обед", "tushlik", "тушлик", "ovqat", "овқат", "kafe", "кафе", "osh ", "плов", "palov", "somsa", "самса", "lavash", "лаваш"]],
  ["Заправка транспорта", ["benzin", "бензин", "zapravka", "заправка", "metan", "метан", "propan", "пропан", "yoqilg", "ёқилғ", "dizel", "дизел", "solyarka", "солярк", "zaryad"]],
  ["Доставка", ["dostavka", "доставк", "taksi", "такси", "taxi", "yetkaz", "етказ", "yuk ", "юк ", "gruz", "груз", "labo", "лабо", "damas", "дамас", "perevoz", "перевоз", "pochta", "почта", "yandex"]],
  ["Аренда", ["arenda", "аренд", "ijara", "ижара"]],
  ["Коммунальные", ["svet", "свет", "elektr", "электр", "kommunal", "коммунал", "gaz pul", "газ пул", "suv pul", "сув пул", "musor", "мусор", "chiqindi"]],
  ["Связь / интернет", ["internet", "интернет", "aloqa", "алоқа", "telefon", "телефон", "paynet", "пейнет", "beeline", "ucell", "uzmobile", "mobiuz", "связь", "sim-kart", "симкарт"]],
  ["Налоги", ["soliq", "солиқ", "nalog", "налог", "nds", "ндс"]],
  ["Реклама", ["reklama", "реклам", "target", "таргет", "smm", "banner", "баннер", "flaer", "флаер"]],
  ["Освежения", ["choy", "чой", "shakar", "шакар", "kofe", "кофе", "coffee", "suv ", "сув ", "voda", "вода", "pechene", "печенье", "konfet", "конфет", "shirinlik"]],
  ["Для showroom", ["showroom", "шоурум", "shourum", "shou-rum", "vitrina", "витрин"]],
  ["Хозрасходы", ["xoz", "хоз", "tozalash", "тозалаш", "moyka", "мойк", "kanstovar", "канц", "qog'oz", "қоғоз", "бумаг", "remont", "ремонт", "lampochka", "лампочк", "salfetka", "салфетк", "sovun", "совун", "perchatka", "перчатк", "skotch", "скотч"]],
];
const INC_WORDS = [
  ["Возврат долга", ["qarz qayt", "қарз қайт", "долг вернул", "возврат долга", "qarzini qayt"]],
  ["Займ", ["zaym", "займ", "qarz old", "қарз олд", "qarzga old", "в долг"]],
  ["Инвестиция / вложение", ["invest", "инвест", "вложен", "sarmoya", "сармоя"]],
  ["Аренда (доход)", ["ijara haqi", "аренда от", "ijaraga berdik"]],
  ["Продажа имущества", ["sotdik", "сотдик", "продали", "продажа"]],
];
export function guessCat(text, dir) {
  const s = low(text) + " ";
  const list = dir === "i" ? INC_WORDS : CAT_WORDS;
  const hit = list.find(([, w]) => has(s, w));
  const cats = dir === "i" ? incCats() : expCats();
  const name = hit ? hit[0] : "Прочее";
  const i = cats.indexOf(name);
  return i >= 0 ? i : cats.length - 1;
}
// в сообщении кроме суммы должно быть слово (за что / приход): «50000» или «50 000 сум» — не спрашиваем
const AMOUNT_WORDS = /(?<![\p{L}])(sum|so'?m|сум|сўм|som|usd|dollar|доллар|долл|у\.?е|k|к|ming|минг|тыс|тысяч|mln|млн|million|миллион)(?![\p{L}])/giu;
export const hasWords = (text) => /\p{L}{2,}/u.test(low(text).replace(AMOUNT_WORDS, " "));
export function parseMoney(text) {
  if (!hasWords(text)) return null;
  const a = findAmount(text);
  if (!a) return null;
  const dir = guessDir(text);
  return { v: a.v, cur: a.cur, dir, method: guessMethod(text), cat: guessCat(text, dir), rate: findRate(text) };
}

// ---------- команды ----------
const CMDS = {
  kassa: ["kassa", "касса", "kassani", "кассани"],
  bugun: ["bugun", "бугун", "сегодня", "today", "kun", "кун"],
  qarz: ["qarz", "қарз", "карз", "долг", "долги", "qarzlar", "қарзлар", "qarzdorlar"],
  postavshik: ["postavshik", "поставщик", "postavshiklar", "поставщики", "taminotchi", "ta'minotchi"],
  obyekt: ["obyekt", "объект", "obekt", "object", "obyektlar", "объекты"],
  narx: ["narx", "нарх", "цена", "narxi", "price"],
  sklad: ["sklad", "склад", "ombor", "омбор"],
  yordam: ["yordam", "ёрдам", "help", "помощь", "start", "buyruqlar"],
  id: ["id"],
};
export function parseCommand(text) {
  const s = String(text || "").trim();
  const m = /^\/([a-zа-яё_]+)(?:@\S+)?\s*(.*)$/is.exec(s);
  if (m) {
    const name = Object.keys(CMDS).find((k) => k === low(m[1]) || CMDS[k].includes(low(m[1])));
    return name ? { name, arg: m[2].trim() } : null;
  }
  const w = low(s).split(/\s+/);
  const name = Object.keys(CMDS).find((k) => k !== "id" && CMDS[k].includes(w[0].replace(/[?!.:,]+$/, "")));
  if (!name) return null;
  const arg = s.split(/\s+/).slice(1).join(" ").trim();
  // «qarz 500$ oldik» — это приход, а не вопрос
  if (name !== "kassa" && name !== "bugun") { const a = findAmount(arg); if (a && (a.v >= 1000 || a.cur)) return null; }
  return { name, arg };
}
export function parseDay(arg, today) {
  const s = low(arg).trim();
  if (!s || has(s, ["bugun", "бугун", "сегодня"])) return today;
  if (has(s, ["kecha", "кеча", "вчера"])) return addDays(today, -1);
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/.exec(s);
  if (m) { const y = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : today.slice(0, 4); return y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); }
  return today;
}
const words = (q) => low(q).split(/\s+/).filter(Boolean);
const hay = (parts) => { const t = low(parts.filter(Boolean).join(" ")); return t + " " + low(C.translit(t)); };
const hitAll = (h, q) => words(q).every((w) => h.includes(w) || h.includes(low(C.translit(w))));

// бот читает только сообщения, которые начинаются с «/»: «/kassa» — команда, «/taksi 50 000» — расход.
// Текст после «/» (и без «@имя_бота»): «/taksi@ThermoBot 50 000» → «taksi 50 000»
export const slashText = (t) => String(t || "").trim().replace(/^\/(\S*?)@\w+bot\b/i, "/$1").replace(/^\/\s*/, "");
export function parseSlash(text) {
  const t = String(text || "").trim();
  if (!t.startsWith("/")) return null;
  const cmd = parseCommand(t);
  const body = slashText(t);
  // «/qarz 500$ oldik», «/obyekt … 1 200 000» — это приход/расход, а не вопрос
  if (cmd && !["kassa", "bugun", "yordam", "id", "narx", "sklad"].includes(cmd.name)) { const a = findAmount(cmd.arg); if (a && (a.v >= 1000 || a.cur)) { const m = parseMoney(body); if (m) return { money: m }; } }
  if (cmd) return { cmd };
  const money = parseMoney(body);
  return money ? { money } : null;
}
export const HELP = [
  "🤖 <b>Thermo bot</b>",
  "",
  "<b>Ishchi guruhda</b> — rasxod / prixod (xabar «/» bilan boshlanadi):",
  "• <code>/taksi 50 000</code> · <code>/obed 120.000 sum</code> · <code>/benzin 200 000 karta</code>",
  "• <code>/prixod 500$ Jamol aka</code> · <code>/+300$ qarz qaytardi</code>",
  "Bot so'raydi — <b>✅ Kiritish</b> bosilsa, dasturga (Финансы) kiradi.",
  "",
  "<b>Shaxsiy chatda</b> — savollar (dasturdagi huquqlaringizga qarab):",
  "• /kassa — kassa (<code>/kassa kecha</code>, <code>/kassa 28.10</code>) · /bugun — kirim-chiqim",
  "• /qarz — mijozlar qarzi · /postavshik — postavshiklarga qarz",
  "• /obyekt — obyektlar (tugmalar bilan) · /narx <i>tovar</i> — narxlar · /sklad <i>tovar</i> — ombor",
  "• «/» siz oddiy matn — dasturdagi «Заметки»ga zametka bo'lib tushadi",
].join("\n");

// меню команд (подсказки после «/»): только в личном чате с ботом; в группах меню нет
export const MENU = [
  { command: "kassa", description: "Kassa (/kassa kecha, /kassa 28.10)" },
  { command: "bugun", description: "Bugungi kirim-chiqim" },
  { command: "qarz", description: "Mijozlar qarzi (/qarz Aziz)" },
  { command: "postavshik", description: "Postavshiklarga qarz" },
  { command: "obyekt", description: "Obyektlar" },
  { command: "narx", description: "Tovar narxi (/narx kran 32)" },
  { command: "sklad", description: "Omborda bormi (/sklad truba 25)" },
  { command: "yordam", description: "Qanday ishlatish" },
];
// какой раздел программы нужен для вопроса (как вкладки в программе)
export const NEED = { kassa: "finance", bugun: "finance", qarz: "objects", postavshik: "suppliers", obyekt: "objects", narx: "products", sklad: "wh" };
export const canAsk = (acc, name) => !NEED[name] || !!acc && (acc.base === "boss" || (acc.tabs || []).includes(NEED[name]));
export const isFull = (acc) => !!acc && (acc.base === "boss" || C.PERMS.every((p) => acc.perms && acc.perms[p.id]));
// кнопки с вопросами внизу личного чата — только те, что человеку открыты
export function qkb(acc) {
  const b = ["kassa", "bugun", "qarz", "postavshik", "obyekt", "narx", "sklad"].filter((n) => canAsk(acc, n)).concat("yordam").map((n) => ({ text: "/" + n }));
  const rows = []; for (let i = 0; i < b.length; i += 2) rows.push(b.slice(i, i + 2));
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}
export const QKB = qkb({ base: "boss", tabs: [] });
// быстрая заметка: первая строка — заголовок; длинная — начало по целым словам с «…», текст целиком (как в программе)
export function noteSplit(t) {
  const all = String(t || "").trim(); const [first, ...rest] = all.split("\n"); const f = first.trim();
  if (f.length <= 80) return { title: f, text: rest.join("\n").trim() };
  const cut = f.slice(0, 80); const sp = cut.lastIndexOf(" ");
  return { title: (sp > 30 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, "") + "…", text: all };
}
// расписание отчётов (Аккаунты → Telegram-бот): ежедневный — касса и кирим-чиқим; в последний день месяца — долги
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function repCfg(lines) {
  const r = (lines && lines.report) || {}, d = r.daily || {}, b = r.debts || {};
  return { daily: { on: d.on !== false, time: HM.test(d.time || "") ? d.time : "21:30" }, debts: { on: b.on !== false, time: HM.test(b.time || "") ? b.time : "10:00", days: Number(b.days) > 0 ? Number(b.days) : 14 }, to: Array.isArray(r.to) ? r.to.map(String) : null };
}
export const tzTime = (d = new Date()) => d.toLocaleTimeString("sv-SE", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" });
const mins = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
export const isDue = (hm, t) => mins(hm) >= mins(t) && mins(hm) - mins(t) < 120; // окно 2 часа: опоздавший запуск всё же отправит
export const isLastDay = (iso) => addDays(iso, 1).slice(5, 7) !== iso.slice(5, 7);
export const PROMPTS = [
  { name: "obyekt", mark: "🔍 Obyekt qidirish", hint: "nomi, mijoz yoki telefonni yozing", ph: "masalan: Yunusobod" },
  { name: "narx", mark: "💲 Narx qidirish", hint: "tovar nomini yozing", ph: "masalan: kran 32" },
  { name: "sklad", mark: "📦 Sklad qidirish", hint: "tovar nomini yozing", ph: "masalan: truba 25" },
];
export const linkHash = (token) => createHash("sha256").update("tglink:" + token, "utf8").digest("hex");
export async function setupMenu(tg) {
  for (const scope of [{ type: "default" }, { type: "all_group_chats" }, { type: "all_chat_administrators" }]) await tg("deleteMyCommands", { scope });
  await tg("setMyCommands", { commands: MENU, scope: { type: "all_private_chats" } });
}

// ---------- бот ----------
export function makeBot({ db, tg, now = () => new Date() }) {
  const nameOf = (u) => (u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || (u.username ? "@" + u.username : "") : "") || "—";
  const send = (chat, text, extra = {}) => tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  async function cfg() {
    const rows = await db.select("requests", "mode=in.(" + CFG_MODE + "," + PEND_MODE + ")&select=id,mode,lines&order=created_at.asc");
    const c = rows.find((r) => r.mode === CFG_MODE), p = rows.find((r) => r.mode === PEND_MODE);
    const allowed = c && c.lines && Array.isArray(c.lines.allowed) ? c.lines.allowed : [];
    const pending = p && p.lines && Array.isArray(p.lines.groups) ? p.lines.groups : [];
    return { c, p, allowed, pending };
  }
  const isAllowed = (cf, chatId) => cf.allowed.some((g) => String(g.id) === String(chatId));
  async function addPending(cf, chat) {
    if (cf.pending.some((g) => String(g.id) === String(chat.id))) return false;
    const groups = [...cf.pending, { id: String(chat.id), title: chat.title || "", at: now().toISOString() }].slice(-20);
    if (cf.p) await db.update("requests", "id=eq." + cf.p.id, { lines: { ...(cf.p.lines || {}), groups } });
    else await db.insert("requests", { mode: PEND_MODE, source: "config", lines: { groups } });
    return true;
  }
  async function migrate(cf, from, to) {
    if (!cf.c || !isAllowed(cf, from)) return;
    const allowed = cf.allowed.map((g) => (String(g.id) === String(from) ? { ...g, id: String(to) } : g));
    await db.update("requests", "id=eq." + cf.c.id, { lines: { ...cf.c.lines, allowed } });
  }
  // ---------- кто пишет: Telegram ↔ аккаунт программы (права — как в программе) ----------
  async function people() {
    const [rows, users] = await Promise.all([
      db.select("requests", "mode=in.(" + USERS_MODE + ",te_roles,te_perms)&select=id,mode,lines"),
      db.select("users", "select=id,username,name,role,status"),
    ]);
    const linkRow = rows.find((r) => r.mode === USERS_MODE) || null;
    const links = (linkRow && linkRow.lines && linkRow.lines.links && typeof linkRow.lines.links === "object" ? linkRow.lines.links : {}) || {};
    const data = { requests: rows };
    const roles = C.allRoles(data), uperms = C.userPermsOf(data);
    const live = (u) => !!u && (!u.status || u.status === "active") && u.role !== "staff";
    const nm = (u) => String((u && u.name) || "").trim() || (u && u.username) || "—";
    const accOf = (u) => C.accessOf(u, roles, uperms);
    const meOf = (tgId) => { const l = links[String(tgId)]; const u = l && users.find((x) => x.id === l.user_id); return live(u) ? { user: u, acc: accOf(u), name: nm(u), tg: String(tgId) } : null; };
    const all = () => Object.keys(links).map(meOf).filter(Boolean);
    return { linkRow, links, users, meOf, all, nm, accOf };
  }
  async function whoAmI(tgId) { try { return (await people()).meOf(tgId); } catch (e) { return null; } }
  const LOCKED = "🔒 Botdan foydalanish uchun akkauntingizni ulang: rahbar dasturda <b>Аккаунты → Telegram-бот</b> bo'limidan sizga «Ulash» havolasini beradi.";
  async function doLink(msg, token) {
    const chatId = msg.chat.id;
    const rows = await db.select("requests", "mode=eq." + LINK_MODE + "&select=id,lines");
    const h = linkHash(token);
    const row = rows.find((r) => r.lines && r.lines.hash === h);
    if (!row || !(Date.parse(row.lines.exp || 0) > now().getTime())) return send(chatId, "⛔️ Havola eskirgan yoki noto'g'ri. Rahbardan yangi havola so'rang (Аккаунты → Telegram-бот → «Ulash»).");
    const P = await people();
    const u = P.users.find((x) => x.id === row.lines.user_id);
    if (!u || (u.status && u.status !== "active")) return send(chatId, "⛔️ Bu akkaunt faol emas.");
    const tgName = msg.from.username ? "@" + msg.from.username : nameOf(msg.from);
    const links = {};
    Object.entries(P.links).forEach(([k, v]) => { if (v && v.user_id !== u.id && k !== String(msg.from.id)) links[k] = v; });
    links[String(msg.from.id)] = { user_id: u.id, tg: tgName, at: now().toISOString() };
    try {
      if (P.linkRow) await db.update("requests", "id=eq." + P.linkRow.id, { lines: { ...(P.linkRow.lines || {}), links } });
      else await db.insert("requests", { mode: USERS_MODE, source: "config", lines: { links } });
    } catch (e) { return send(chatId, "⚠️ Ulab bo'lmadi: " + esc(e.message).slice(0, 200)); }
    try { await db.del("requests", "id=eq." + row.id); } catch (e) {}
    try { await db.insert("audit_log", { action: "Telegram: подключён", entity: "user:" + u.id, detail: P.nm(u) + " ← Telegram " + tgName, user_name: "Telegram: " + tgName, role: "telegram", ts: now().toISOString() }); } catch (e) {}
    return send(chatId, "✅ Ulandi: <b>" + esc(P.nm(u)) + "</b>\nSavolni tanlang 👇", { reply_markup: qkb(P.accOf(u)) });
  }
  let meName = null;
  const botMe = async () => { if (meName === null) { try { const r = await tg("getMe", {}); meName = (r && r.username) || ""; } catch (e) { meName = ""; } } return meName; };
  const NOT_ALLOWED = "⛔️ Bu guruh hali ruxsat etilmagan.\nRahbar dasturda <b>Аккаунты → Telegram-бот</b> bo'limida shu guruhga ruxsat bersin — keyin bot ishlaydi.";

  // курс для сумм: из сообщения или последний курс из операций программы
  async function lastRate() {
    let rows = [];
    try { rows = await db.select("finance_ops", "select=pay_rate,reason,created_at&pay_rate=gte.1000&order=created_at.desc&limit=1"); } catch (e) { rows = []; }
    if (rows[0] && Number(rows[0].pay_rate) >= 1000) return Number(rows[0].pay_rate);
    try { rows = await db.select("finance_ops", "select=reason,created_at&reason=ilike.*" + encodeURIComponent("курс") + "*&order=created_at.desc&limit=20"); } catch (e) { rows = []; }
    for (const r of rows) { const m = /курс\s*([\d\s  .,]+)/.exec(r.reason || ""); if (m) { const v = toNum(m[1].trim()); if (v >= 1000) return v; } }
    return 0;
  }
  // что получится в программе: тип, статья, способ, сумма в $ (по курсу)
  function plan(p, d, c, rate) {
    const cats = d === "i" ? incCats() : expCats();
    const cat = cats[Math.min(Math.max(0, c), cats.length - 1)];
    const method = p.method === "card" ? "card" : p.method === "transfer" ? "transfer" : p.cur === "uzs" ? "uzs" : "usd";
    const pay = { method, cur: p.cur, usd: p.cur === "usd" ? p.v : "", uzs: p.cur === "uzs" ? p.v : "", rate: p.cur === "uzs" ? rate : "" };
    const usdAmt = p.cur === "usd" ? C.round2(p.v) : rate >= 1000 ? C.round2(p.v / rate) : 0;
    return { cat, cats, pay, usdAmt, method };
  }
  const METHOD_UZ = { cash: "naqd", card: "karta", transfer: "perechisleniye" };
  function view(p, d, c, rate, author) {
    const pl = plan(p, d, c, rate);
    const lines = [
      (d === "i" ? "💰 <b>Prixod</b>" : "💸 <b>Rasxod</b>") + " · " + esc(pl.cat),
      "<b>" + (p.cur === "uzs" ? sum(p.v) : usd(p.v)) + "</b>" + (p.cur === "uzs" ? (pl.usdAmt ? " ≈ " + usd(pl.usdAmt) + " (kurs " + C.fmtDot(rate) + ")" : " · ⚠️ kurs topilmadi") : "") + " · " + METHOD_UZ[p.method],
      "Kim: " + esc(author),
      p.cur === "uzs" && !pl.usdAmt ? "Xabarga kursni qo'shing: <code>kurs 12 600</code>" : "Dasturga kiritaymi?",
    ];
    const k = d + ":" + pl.cats.indexOf(pl.cat);
    const kb = p.cur === "uzs" && !pl.usdAmt ? [[{ text: "❌ Yo'q", callback_data: "no" }]] : [
      [{ text: "✅ Kiritish", callback_data: "ok:" + k }, { text: "❌ Yo'q", callback_data: "no" }],
      [{ text: d === "i" ? "🔁 Rasxod qilish" : "🔁 Prixod qilish", callback_data: "dir:" + k }, { text: "🏷 Kategoriya", callback_data: "cat:" + k }],
    ];
    return { text: lines.join("\n"), reply_markup: { inline_keyboard: kb } };
  }
  function catKeyboard(d, c) {
    const cats = d === "i" ? incCats() : expCats();
    const rows = [];
    for (let i = 0; i < cats.length; i += 2) rows.push(cats.slice(i, i + 2).map((x, j) => ({ text: (i + j === c ? "• " : "") + x, callback_data: "setc:" + d + ":" + (i + j) })));
    rows.push([{ text: "⬅️ Orqaga", callback_data: "setc:" + d + ":" + c }]);
    return { inline_keyboard: rows };
  }
  const tgDate = (unix) => tzDate(new Date((unix || 0) * 1000 || now().getTime()));

  async function onMessage(msg) {
    const chat = msg.chat || {};
    // фото, файлы, видео, голосовые — бот не читает и не отвечает (даже если есть подпись)
    if (msg.photo || msg.document || msg.video || msg.animation || msg.voice || msg.audio || msg.video_note || msg.sticker) return;
    const text = String(msg.text || "").trim();
    // обычные сообщения (без «/» в начале) бот не читает
    const sl = parseSlash(text);
    const cmd = sl && sl.cmd, money = sl && sl.money;
    if (cmd && cmd.name === "id") return send(chat.id, "ID: <code>" + esc(chat.id) + "</code>", { reply_to_message_id: msg.message_id });
    // личный чат с ботом: вопросы и заметки — только тем, чей Telegram подключён к аккаунту программы
    if (chat.type === "private") {
      if (msg.from && msg.from.is_bot) return;
      const lk = /^\/start(?:@\w+)?\s+L([A-Za-z0-9_-]{16,64})$/.exec(text);
      if (lk) return doLink(msg, lk[1]);
      const me = await whoAmI(msg.from && msg.from.id);
      if (!me) return text ? send(chat.id, LOCKED) : undefined;
      if (!text) return;
      if (!text.startsWith("/")) {
        // ответ на вопрос бота «🔍 … qidirish» — поиск; остальное — заметка
        const rq = msg.reply_to_message, pr = rq && rq.from && rq.from.is_bot ? PROMPTS.find((x) => String(rq.text || "").startsWith(x.mark)) : null;
        if (pr) return runCommand(chat.id, msg, { name: pr.name, arg: text }, me);
        return saveNote(msg, me);
      }
      if (!cmd) return send(chat.id, money ? "Rasxod / prixod ishchi guruhda yoziladi: <code>/taksi 50 000</code>" : "Savolni tanlang 👇", { reply_markup: qkb(me.acc) });
      if (/^\/start\b/i.test(text)) return send(chat.id, "Savolni tanlang 👇", { reply_markup: qkb(me.acc) });
      if (cmd.name === "yordam") return send(chat.id, HELP, { reply_markup: qkb(me.acc) });
      if (!canAsk(me.acc, cmd.name)) return send(chat.id, "🔒 Bu bo'lim sizga ochilmagan.", { reply_markup: qkb(me.acc) });
      return runCommand(chat.id, msg, cmd, me);
    }
    if (chat.type !== "group" && chat.type !== "supergroup") return;
    if (msg.migrate_to_chat_id) return migrate(await cfg(), chat.id, msg.migrate_to_chat_id);
    if (msg.new_chat_members || msg.left_chat_member) return; // добавление бота — в my_chat_member
    if (!text || msg.from && msg.from.is_bot) return;
    if (!cmd && !money) return;
    const cf = await cfg();
    if (!isAllowed(cf, chat.id)) {
      if (await addPending(cf, chat)) return send(chat.id, NOT_ALLOWED);
      return;
    }
    // в группе вопросы не отвечаем — только в личном чате с ботом (касса и долги не видны всей группе)
    if (cmd) {
      if (cmd.name === "yordam") return send(chat.id, HELP, { reply_to_message_id: msg.message_id });
      const me = await botMe();
      return send(chat.id, "🔒 Savollarni bot bilan shaxsiy chatda bering" + (me ? ": @" + esc(me) : "") + ".", { reply_to_message_id: msg.message_id, ...(me ? { reply_markup: { inline_keyboard: [[{ text: "Botga yozish", url: "https://t.me/" + me }]] } } : {}) });
    }
    const rate = money.cur === "uzs" ? money.rate || (await lastRate()) : 0;
    const v = view(money, money.dir, money.cat, rate, nameOf(msg.from));
    return send(chat.id, v.text, { reply_to_message_id: msg.message_id, reply_markup: v.reply_markup });
  }

  async function onCallback(cq) {
    const m = cq.message || {}, chat = m.chat || {};
    const ans = (text, alert) => tg("answerCallbackQuery", { callback_query_id: cq.id, text: text || "", show_alert: !!alert }).catch(() => {});
    const edit = (text, reply_markup) => tg("editMessageText", { chat_id: chat.id, message_id: m.message_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) });
    if (chat.type === "private") return privCallback(cq, ans, edit);
    const cf = await cfg();
    if (!isAllowed(cf, chat.id)) return ans("Bu guruh ruxsat etilmagan", true);
    const who = nameOf(cq.from);
    const [act, a1, a2] = String(cq.data || "").split(":");
    if (act === "undo") return undo(cq, a1, who, ans, edit);
    const orig = m.reply_to_message;
    if (!orig) { await edit("⚠️ Asl xabar o'chirilgan — kiritilmadi."); return ans(); }
    const sl = parseSlash(orig.text || "");
    const p = sl && sl.money;
    if (!p) { await edit("⚠️ Asl xabarda summa topilmadi — kiritilmadi."); return ans(); }
    const author = nameOf(orig.from);
    const rate = p.cur === "uzs" ? p.rate || (await lastRate()) : 0;
    const d = a1 === "i" ? "i" : "e", c = Number(a2) || 0;
    if (act === "no") { await edit("❌ Kiritilmadi · " + esc(who)); return ans(); }
    if (act === "dir") { const nd = d === "i" ? "e" : "i"; const v = view(p, nd, guessCat(slashText(orig.text), nd), rate, author); await edit(v.text, v.reply_markup); return ans(); }
    if (act === "cat") { await tg("editMessageReplyMarkup", { chat_id: chat.id, message_id: m.message_id, reply_markup: catKeyboard(d, c) }); return ans("Kategoriyani tanlang"); }
    if (act === "setc") { const v = view(p, d, c, rate, author); await edit(v.text, v.reply_markup); return ans(); }
    if (act !== "ok") return ans();
    // уже внесено (кнопку нажали дважды / двое одновременно)?
    const key = "tg:" + chat.id + ":" + orig.message_id;
    const done = await db.select("audit_log", "action=eq." + LOG_MODE + "&entity=eq." + encodeURIComponent(key) + "&select=detail&limit=1");
    if (done.length) { await ans("Allaqachon kiritilgan", true); return; }
    const pl = plan(p, d, c, rate);
    if (!(pl.usdAmt > 0)) return ans("Kurs topilmadi — xabarga «kurs 12 600» qo'shing", true);
    const type = d === "i" ? "company_income" : "company_expense";
    // нажал человек, подключённый к аккаунту программы, — операция от имени его аккаунта
    const meC = await whoAmI(cq.from && cq.from.id);
    const actor = meC ? meC.name : author;
    const note = slashText(orig.text).replace(/\s+/g, " ").trim().slice(0, 200) + " (Telegram: " + author + ")";
    const row = { type, object_id: null, category: pl.cat, ...(type === "company_expense" ? { size: pl.cat } : {}), ...C.payPatch(pl.pay, type, false), op_date: tgDate(orig.date), note, user: actor, user_name: actor };
    let op;
    try { op = (await db.insert("finance_ops", row))[0]; }
    catch (e) { await ans("Xato: dasturga yozilmadi", true); await send(chat.id, "⚠️ Dasturga yozilmadi: " + esc(e.message).slice(0, 300), { reply_to_message_id: orig.message_id }); return; }
    const amt = (p.cur === "uzs" ? sum(p.v) + " (" + usd(pl.usdAmt) + ")" : usd(p.v));
    const ts = now().toISOString();
    try {
      await db.insert("audit_log", [
        { action: d === "i" ? "Telegram: приход" : "Telegram: расход", entity: "company:" + pl.cat, detail: amt.replace(/so'm/g, "сум") + " · " + note + " · подтвердил " + who, user_name: meC ? meC.name : "Telegram: " + who, role: "telegram", ts },
        { action: LOG_MODE, entity: key, detail: (op && op.id) || "", user_name: "Telegram: " + who, role: "telegram", ts },
      ]);
    } catch (e) { /* журнал не обязателен для операции */ }
    await edit((d === "i" ? "✅ <b>Prixod kiritildi</b>" : "✅ <b>Rasxod kiritildi</b>") + " · " + esc(pl.cat) + "\n" + amt + " · " + METHOD_UZ[p.method] + " · " + dt(row.op_date) + "\nKim: " + esc(author) + " · tasdiqladi: " + esc(who),
      op && op.id ? { inline_keyboard: [[{ text: "↩️ Bekor qilish", callback_data: "undo:" + op.id }]] } : undefined);
    return ans("Kiritildi");
  }
  async function undo(cq, opId, who, ans, edit) {
    if (!/^[0-9a-f-]{36}$/i.test(opId || "")) return ans();
    const rows = await db.select("finance_ops", "id=eq." + opId + "&select=id,created_at,type,amount,category,note");
    const op = rows[0];
    if (!op) { await edit("↩️ Bekor qilingan (operatsiya dasturda yo'q) · " + esc(who)); return ans(); }
    if (now().getTime() - Date.parse(op.created_at || 0) > 3 * 864e5) return ans("3 kundan eski — dasturda o'chiring", true);
    await db.del("finance_ops", "id=eq." + opId);
    try { await db.insert("audit_log", { action: "Telegram: отменено", entity: "company:" + (op.category || ""), detail: C.fmt(op.amount) + " $ · " + (op.note || "") + " · отменил " + who, user_name: "Telegram: " + who, role: "telegram", ts: now().toISOString() }); } catch (e) {}
    await edit("↩️ <b>Bekor qilindi</b> · " + esc(who) + "\n<s>" + esc(op.note || "") + "</s>");
    return ans("Bekor qilindi");
  }

  // ---------- ответы на вопросы (тот же расчёт, что в программе) ----------
  async function loadData(need) {
    const out = {};
    const jobs = [];
    if (need.includes("objects")) jobs.push(db.all("objects").then((r) => { out.objects = r; }));
    if (need.includes("finance_ops")) jobs.push(db.all("finance_ops").then((r) => { out.finance_ops = r.map(C.normFinOp); }));
    if (need.includes("suppliers")) jobs.push(db.all("suppliers").then((r) => { out.suppliers = r; }));
    if (need.includes("masters")) jobs.push(db.all("masters").then((r) => { out.masters = r; }));
    if (need.includes("wh_moves")) jobs.push(db.all("wh_moves").then((r) => { out.wh_moves = r; }));
    if (need.includes("notes")) jobs.push(db.all("requests", "mode=eq.te_note").then((r) => { out.notes = r; }));
    await Promise.all(jobs);
    return out;
  }
  async function kassa(day) {
    const data = await loadData(["objects", "finance_ops", "suppliers", "masters", "notes"]);
    const ops = data.finance_ops;
    const notes = (data.notes || []).filter((r) => r.lines && r.lines.kassa && r.lines.kassa.date);
    const upd = (r) => String(r.lines.updated_at || r.created_at || "");
    const prev = notes.filter((r) => r.lines.kassa.date < day).sort((a, b) => b.lines.kassa.date.localeCompare(a.lines.kassa.date) || upd(b).localeCompare(upd(a)))[0];
    const same = notes.filter((r) => r.lines.kassa.date === day).sort((a, b) => upd(b).localeCompare(upd(a)))[0];
    const saved = same && same.lines.kassa;
    let chain = null;
    if (prev) {
      const pk = prev.lines.kassa, from = addDays(pk.date, 1), to = addDays(day, -1);
      const c0 = {}; C.KASSA_KEYS.forEach((k) => { c0[k] = Number(pk.close && pk.close[k]) || 0; });
      chain = from <= to ? C.kassaBal(c0, C.kassaOps(data, ops, from, to).filter((r) => r.def), []) : C.kassaBal(c0, [], []);
    }
    const zero = {}; C.KASSA_KEYS.forEach((k) => { zero[k] = 0; });
    const open = saved && saved.open && (saved.openManual || !chain) ? saved.open : chain || zero;
    const pick = (saved && saved.pick) || {};
    const sys = C.kassaOps(data, ops, day).map((r) => ({ ...r, on: Object.prototype.hasOwnProperty.call(pick, r.id) ? !!pick[r.id] : r.def }));
    const rep = C.kassaText({ open, sys, manual: (saved && saved.manual) || [], conv: (saved && saved.conv) || [] });
    const head = "🧾 <b>Kassa " + dt(day) + "</b>" + (saved ? " (dasturdagi hisobot, " + esc(same.lines.author || "") + ")" : prev ? " (ostatka — " + dt(prev.lines.kassa.date) + " hisobotidan)" : " (oldingi hisobot yo'q — ostatka 0 dan)");
    return head + "\n\n" + esc(rep.text);
  }
  async function today(day) {
    const data = await loadData(["objects", "finance_ops", "suppliers", "masters"]);
    const list = C.kassaOps(data, data.finance_ops, day);
    if (!list.length) return "📅 <b>" + dt(day) + "</b>: kirim-chiqim yo'q.";
    const tot = {};
    const line = (r) => { const k = r.dir + r.bucket; tot[k] = (tot[k] || 0) + r.amt; return (r.dir === "in" ? "➕ " : "➖ ") + C.fmtDot(r.amt) + (r.bucket === "usd" || r.bucket === "cardUsd" ? " $" : " so'm") + (r.bucket === "card" || r.bucket === "cardUsd" ? (r.transfer ? " (perech.)" : " (karta)") : "") + " — " + esc(r.label); };
    const ins = list.filter((r) => r.dir === "in").map(line), outs = list.filter((r) => r.dir !== "in").map(line);
    const tl = (dir) => ["uzs", "usd", "card", "cardUsd"].filter((b) => tot[dir + b]).map((b) => C.fmtDot(tot[dir + b]) + (b === "usd" || b === "cardUsd" ? " $" : " so'm") + (b.startsWith("card") ? " (karta/perech.)" : "")).join(", ") || "0";
    return ["📅 <b>" + dt(day) + "</b>", "", "<b>Kirim:</b> " + tl("in"), ...ins, "", "<b>Chiqim:</b> " + tl("out"), ...outs].join("\n");
  }
  async function debts(q) {
    const data = await loadData(["objects", "finance_ops"]);
    const rows = data.objects.filter((o) => C.isLive(o)).map((o) => ({ o, f: C.calcObject(o, data.finance_ops) }))
      .filter((r) => (q ? hitAll(hay([r.o.name, r.o.client, r.o.phone, r.o.master, r.o.address]), q) : r.f.clientDebt > 0.004))
      .sort((a, b) => b.f.clientDebt - a.f.clientDebt);
    if (!rows.length) return q ? "«" + esc(q) + "» bo'yicha obyekt topilmadi." : "✅ Mijozlarning qarzi yo'q.";
    const total = rows.reduce((a, r) => a + Math.max(0, r.f.clientDebt), 0);
    const list = rows.slice(0, 20).map((r, i) => (i + 1) + ". " + esc(r.o.name) + (r.o.client ? " (" + esc(r.o.client) + ")" : "") + " — " + (r.f.clientDebt > 0.004 ? "<b>" + usd(r.f.clientDebt) + "</b>" : r.f.clientDebt < -0.004 ? "ortiqcha to'lov " + usd(-r.f.clientDebt) : "qarz yo'q"));
    return ["💳 <b>Mijozlar qarzi</b>" + (q ? " · «" + esc(q) + "»" : "") + ": <b>" + usd(total) + "</b>", "", ...list, rows.length > 20 ? "… yana " + (rows.length - 20) + " ta" : ""].filter((x) => x !== "").join("\n");
  }
  async function supDebts(q) {
    const data = await loadData(["objects", "finance_ops", "suppliers", "wh_moves"]);
    const rows = data.suppliers.filter((s) => !q || hitAll(hay([s.name]), q)).map((s) => ({ s, st: C.supplierStats(s, data.objects, data.finance_ops, data.wh_moves) }))
      .filter((r) => q || r.st.debt > 0.004).sort((a, b) => b.st.balance - a.st.balance);
    if (!rows.length) return q ? "«" + esc(q) + "» bo'yicha postavshik topilmadi." : "✅ Postavshiklarga qarz yo'q.";
    const total = rows.reduce((a, r) => a + r.st.debt, 0);
    return ["🚚 <b>Postavshiklarga qarz</b>" + (q ? " · «" + esc(q) + "»" : "") + ": <b>" + usd(total) + "</b>", "",
      ...rows.slice(0, 20).map((r, i) => (i + 1) + ". " + esc(r.s.name) + " — " + (r.st.balance > 0.004 ? "<b>" + usd(r.st.balance) + "</b>" : r.st.balance < -0.004 ? "avans " + usd(-r.st.balance) : "qarz yo'q"))].join("\n");
  }
  // ---------- объекты: список кнопками → карточка → оплаты / материалы ----------
  const cut = (t, n) => { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  function objList(data, q) {
    const list = q ? data.objects.filter((o) => hitAll(hay([o.name, o.client, o.phone, o.master, o.address]), q))
      : data.objects.filter((o) => C.isLive(o)).sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
    const top = list.slice(0, 10);
    const text = q ? (top.length ? "🔍 «" + esc(q) + "»: " + list.length + " ta" + (list.length > 10 ? " (birinchi 10 tasi)" : "") : "🔍 «" + esc(q) + "» bo'yicha obyekt topilmadi.")
      : top.length ? "🏠 <b>Obyektlar</b> — oxirgi o'zgarganlar" : "Faol obyektlar yo'q.";
    const kb = top.map((o) => [{ text: cut((o.name || "—") + (o.client ? " · " + o.client : ""), 60), callback_data: "o:" + o.id }]);
    kb.push([{ text: "🔍 Qidirish", callback_data: "oq" }].concat(q ? [{ text: "🏠 Oxirgilar", callback_data: "ol" }] : []));
    return { text, reply_markup: { inline_keyboard: kb } };
  }
  const money$ = (acc) => !!acc && acc.base !== "driver"; // доставщик — без сумм
  function objCard(o, data, acc) {
    const st = C.stById(o.status);
    const mName = o.master || (((data.masters || []).find((m) => m.id === o.master_id) || {}).name || "");
    const lines = ["🏠 <b>" + esc(o.name || "—") + "</b> · " + esc(st.label),
      "Mijoz: " + esc([o.client, o.phone].filter(Boolean).join(", ") || "—") + (mName ? "\nUsta: " + esc(mName) : "") + (o.address ? "\nManzil: " + esc(o.address) : "")];
    if (money$(acc)) {
      const f = C.calcObject(o, data.finance_ops);
      lines.push("", "Summa: <b>" + usd(f.saleNet) + "</b>", "To'langan: " + usd(f.paidClient), f.clientDebt > 0.004 ? "<b>Qarz: " + usd(f.clientDebt) + "</b>" : f.clientDebt < -0.004 ? "Ortiqcha to'lov: " + usd(-f.clientDebt) : "Qarz yo'q");
      if (!C.isLive(o)) lines.push("<i>(hisobga olinmaydi)</i>");
    }
    const kb = [[...(money$(acc) ? [{ text: "💳 To'lovlar", callback_data: "op:" + o.id }] : []), { text: "📦 Materiallar", callback_data: "om:" + o.id }], [{ text: "⬅️ Orqaga", callback_data: "ol" }]];
    return { text: lines.join("\n"), reply_markup: { inline_keyboard: kb } };
  }
  const back = (id) => ({ inline_keyboard: [[{ text: "⬅️ Obyektga", callback_data: "o:" + id }, { text: "🏠 Ro'yxat", callback_data: "ol" }]] });
  function objPays(o, data) {
    const ops = data.finance_ops.filter((x) => x.object_id === o.id && ["client_payment", "return", "discount"].includes(x.type))
      .sort((a, b) => String(a.op_date || a.created_at || "").localeCompare(String(b.op_date || b.created_at || "")));
    const lines = ops.slice(-30).map((x) => "• " + dt(String(x.op_date || x.created_at || "").slice(0, 10)) + " · " + esc(C.opName(x)) + " · <b>" + usd(Number(x.amount) || 0) + "</b>" + (x.reason ? " <i>" + esc(cut(x.reason, 50)) + "</i>" : ""));
    return { text: "💳 <b>" + esc(o.name || "—") + "</b> — to'lovlar\n\n" + (lines.length ? (ops.length > 30 ? "… oldingi " + (ops.length - 30) + " ta\n" : "") + lines.join("\n") : "To'lovlar yo'q."), reply_markup: back(o.id) };
  }
  function objMats(o, acc) {
    const items = (Array.isArray(o.items) ? o.items : []).filter((i) => i && i.name);
    const by = new Map();
    items.forEach((i) => { const k = Number(i.batch_no) || 1; if (!by.has(k)) by.set(k, []); by.get(k).push(i); });
    const out = ["📦 <b>" + esc(o.name || "—") + "</b> — materiallar"];
    [...by.keys()].sort((a, b) => a - b).forEach((k) => {
      const list = by.get(k), d0 = list.map((i) => i.batch_date).filter(Boolean).sort()[0];
      out.push("", "<b>" + k + "-postavka</b>" + (d0 ? " · " + dt(String(d0).slice(0, 10)) : ""));
      list.forEach((i) => out.push("• " + esc(cut(i.name, 70)) + " — " + C.fmt(Number(i.qty) || 0) + " " + esc(i.unit || "шт") + (money$(acc) && Number(i.price) ? " · " + usd((Number(i.price) || 0) * (Number(i.qty) || 0)) : "")));
    });
    if (!items.length) out.push("", "Materiallar yo'q.");
    let text = out.join("\n"); if (text.length > 3900) text = text.slice(0, 3890) + "\n…";
    return { text, reply_markup: back(o.id) };
  }
  // ---------- цены и склад ----------
  async function prices(q, acc) {
    const [prods, sups, wh] = await Promise.all([db.all("products", "", "id,name,brand,size,unit,cost,price,supplier_id,status"), db.all("suppliers", "", "id,name"), db.all("warehouse", "", "id,product_id,qty")]);
    const sn = new Map(sups.map((x) => [x.id, x.name]));
    const wq = new Map(); wh.forEach((w) => { if (w.product_id && Number(w.qty) > 0) wq.set(w.product_id, (wq.get(w.product_id) || 0) + Number(w.qty)); });
    const fin = acc.base === "boss" || !!(acc.perms && acc.perms.fin);
    const val = (p) => (fin ? Number(p.cost) || 0 : C.retailOf(p));
    const list = prods.filter((p) => p.status !== "archive" && hitAll(hay([p.name, p.brand, p.size, sn.get(p.supplier_id)]), q))
      .sort((a, b) => (val(a) > 0 ? 0 : 1) - (val(b) > 0 ? 0 : 1) || val(a) - val(b));
    if (!list.length) return "💲 «" + esc(q) + "» bo'yicha tovar topilmadi.";
    return ["💲 <b>«" + esc(q) + "»</b> — " + (fin ? "zakup narxi" : "sotuv narxi") + ", arzonidan:", "",
      ...list.slice(0, 10).map((p, i) => (i + 1) + ". " + esc(cut(p.name, 80)) + " — " + esc(sn.get(p.supplier_id) || "—") + " · <b>" + (val(p) > 0 ? usd(val(p)) : "narx yo'q") + "</b>" + (wq.get(p.id) ? " · 📦 skladda: " + C.fmt(wq.get(p.id)) : "")),
      list.length > 10 ? "\n… yana " + (list.length - 10) + " ta — aniqroq yozing" : ""].filter((x) => x !== "").join("\n");
  }
  async function stock(q) {
    const [wh, sups] = await Promise.all([db.all("warehouse", "", "id,name,qty,unit,supplier_id,product_id"), db.all("suppliers", "", "id,name")]);
    const sn = new Map(sups.map((x) => [x.id, x.name]));
    const list = wh.filter((w) => Number(w.qty) > 0 && hitAll(hay([w.name, sn.get(w.supplier_id)]), q)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!list.length) return "📦 «" + esc(q) + "» — omborda yo'q.";
    return ["📦 <b>Sklad Thermo · «" + esc(q) + "»</b>", "", ...list.slice(0, 25).map((w) => "• " + esc(cut(w.name, 80)) + " — <b>" + C.fmt(Number(w.qty)) + " " + esc(w.unit || "шт") + "</b>" + (sn.get(w.supplier_id) ? " · " + esc(sn.get(w.supplier_id)) : "")), list.length > 25 ? "\n… yana " + (list.length - 25) + " ta" : ""].filter((x) => x !== "").join("\n");
  }
  // вопросы, на которые бот просит дописать слово (ответ на его сообщение — поиск)
  const ask = (chatId, pr) => send(chatId, pr.mark + ": " + pr.hint, { reply_markup: { force_reply: true, input_field_placeholder: pr.ph } });
  async function runCommand(chatId, msg, cmd, me) {
    const day = tzDate(now());
    const acc = me && me.acc;
    let text;
    try {
      if (cmd.name === "yordam") text = HELP;
      else if (cmd.name === "kassa") text = await kassa(parseDay(cmd.arg, day));
      else if (cmd.name === "bugun") text = await today(parseDay(cmd.arg, day));
      else if (cmd.name === "qarz") text = await debts(cmd.arg);
      else if (cmd.name === "postavshik") text = await supDebts(cmd.arg);
      else if (cmd.name === "obyekt") { const v = objList(await loadData(["objects"]), cmd.arg); return send(chatId, v.text, { reply_markup: v.reply_markup }); }
      else if (cmd.name === "narx" || cmd.name === "sklad") {
        if (!cmd.arg) return ask(chatId, PROMPTS.find((x) => x.name === cmd.name));
        text = cmd.name === "narx" ? await prices(cmd.arg, acc) : await stock(cmd.arg);
      }
      else return;
    } catch (e) { text = "⚠️ Hisoblab bo'lmadi: " + esc(String(e.message || e)).slice(0, 300); }
    if (text.length > 4000) text = text.slice(0, 3990) + "\n…";
    return send(chatId, text, { reply_to_message_id: msg.message_id });
  }
  // ---------- заметки из личного чата ----------
  const noteKb = (id, shared) => ({ inline_keyboard: [[{ text: shared ? "🔒 Faqat menga" : "👥 Hammaga ko'rinsin", callback_data: "ns:" + id }, { text: "🗑 O'chirish", callback_data: "nd:" + id }]] });
  async function saveNote(msg, me) {
    const { title, text } = noteSplit(msg.text);
    if (!title && !text) return;
    const lines = { title, text, color: "", pinned: false, shared: false, user_id: me.user.id, author: me.name, updated_at: now().toISOString(), via: "tg" };
    let row;
    try { row = (await db.insert("requests", { mode: "te_note", source: "note", lines }))[0]; }
    catch (e) { return send(msg.chat.id, "⚠️ Zametka saqlanmadi: " + esc(e.message).slice(0, 200), { reply_to_message_id: msg.message_id }); }
    return send(msg.chat.id, "📝 <b>Saqlandi</b> — dasturdagi «Заметки»da · 🔒 faqat sizga", { reply_to_message_id: msg.message_id, reply_markup: row && row.id ? noteKb(row.id, false) : undefined });
  }
  async function privCallback(cq, ans, edit) {
    const me = await whoAmI(cq.from && cq.from.id);
    if (!me) return ans("Akkaunt ulanmagan", true);
    const data0 = String(cq.data || ""), i = data0.indexOf(":");
    const act = i < 0 ? data0 : data0.slice(0, i), id = i < 0 ? "" : data0.slice(i + 1);
    if (act === "ns" || act === "nd") {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return ans();
      const row = (await db.select("requests", "id=eq." + id + "&mode=eq.te_note&select=id,lines"))[0];
      if (!row || !row.lines || row.lines.user_id !== me.user.id) { await edit("📝 Zametka topilmadi (o'chirilgan)."); return ans(); }
      try {
        if (act === "nd") { await db.del("requests", "id=eq." + id); await edit("🗑 Zametka o'chirildi."); return ans("O'chirildi"); }
        const shared = !row.lines.shared;
        await db.update("requests", "id=eq." + id, { lines: { ...row.lines, shared, updated_at: now().toISOString() } });
        await edit("📝 <b>Saqlandi</b> — dasturdagi «Заметки»da · " + (shared ? "👥 hammaga ko'rinadi" : "🔒 faqat sizga"), noteKb(id, shared));
        return ans(shared ? "Hammaga ko'rinadi" : "Faqat sizga");
      } catch (e) { return ans("Xato: " + String(e.message || e).slice(0, 150), true); }
    }
    if (!["ol", "oq", "o", "op", "om"].includes(act)) return ans();
    if (!canAsk(me.acc, "obyekt")) return ans("Bu bo'lim sizga ochilmagan", true);
    if (act === "oq") { await ask(cq.message.chat.id, PROMPTS[0]); return ans(); }
    const data = await loadData(act === "ol" ? ["objects"] : ["objects", "finance_ops", "masters"]);
    if (act === "ol") { const v = objList(data, ""); await edit(v.text, v.reply_markup); return ans(); }
    const o = data.objects.find((x) => x.id === id);
    if (!o) { await edit("Obyekt topilmadi (o'chirilgan bo'lishi mumkin).", { inline_keyboard: [[{ text: "🏠 Ro'yxat", callback_data: "ol" }]] }); return ans(); }
    const v = act === "o" ? objCard(o, data, me.acc) : act === "op" ? (money$(me.acc) ? objPays(o, data) : objCard(o, data, me.acc)) : objMats(o, me.acc);
    await edit(v.text, v.reply_markup);
    return ans();
  }
  // ---------- отчёты по расписанию (GitHub Actions будит функцию каждые 10 минут) ----------
  async function debtReport(days) {
    const data = await loadData(["objects", "finance_ops", "suppliers", "wh_moves"]);
    const day = tzDate(now()), dnum = (iso) => Date.parse(String(iso).slice(0, 10) + "T12:00:00Z");
    const cl = data.objects.filter((o) => C.isLive(o)).map((o) => {
      const f = C.calcObject(o, data.finance_ops);
      const last = [String(o.created_at || "").slice(0, 10), ...data.finance_ops.filter((x) => x.object_id === o.id && x.type === "client_payment").map((x) => String(x.op_date || x.created_at || "").slice(0, 10))].filter(Boolean).sort().pop() || day;
      return { o, debt: f.clientDebt, age: Math.round((dnum(day) - dnum(last)) / 864e5) };
    }).filter((r) => r.debt > 0.004 && r.age >= days).sort((a, b) => b.debt - a.debt);
    const sp = data.suppliers.map((s) => ({ s, st: C.supplierStats(s, data.objects, data.finance_ops, data.wh_moves) })).filter((r) => r.st.debt > 0.004).sort((a, b) => b.st.balance - a.st.balance);
    const t1 = cl.reduce((a, r) => a + r.debt, 0), t2 = sp.reduce((a, r) => a + r.st.debt, 0);
    return ["🗓 <b>Oy yakuni · qarzlar · " + dt(day) + "</b>", "",
      "💳 <b>Mijozlar</b> (" + days + " kundan oshgan): <b>" + usd(t1) + "</b>", ...(cl.length ? cl.slice(0, 25).map((r, i) => (i + 1) + ". " + esc(r.o.name) + (r.o.client ? " (" + esc(r.o.client) + ")" : "") + " — <b>" + usd(r.debt) + "</b> · " + r.age + " kun") : ["✅ yo'q"]),
      "", "🚚 <b>Postavshiklar</b>: <b>" + usd(t2) + "</b>", ...(sp.length ? sp.slice(0, 25).map((r, i) => (i + 1) + ". " + esc(r.s.name) + " — <b>" + usd(r.st.balance) + "</b>") : ["✅ yo'q"])].join("\n");
  }
  async function markOnce(key) {
    const done = await db.select("audit_log", "action=eq." + LOG_MODE + "&entity=eq." + encodeURIComponent(key) + "&select=id&limit=1");
    if (done.length) return false;
    await db.insert("audit_log", { action: LOG_MODE, entity: key, detail: "", user_name: "Telegram-бот", role: "telegram", ts: now().toISOString() });
    return true;
  }
  async function tick() {
    const cf = await cfg();
    const rp = repCfg(cf.c && cf.c.lines);
    const day = tzDate(now()), hm = tzTime(now());
    const sent = [];
    const wantDaily = rp.daily.on && isDue(hm, rp.daily.time), wantDebts = rp.debts.on && isLastDay(day) && isDue(hm, rp.debts.time);
    if (!wantDaily && !wantDebts) return sent;
    const P = await people();
    const to = (need) => P.all().filter((m) => (rp.to ? rp.to.includes(String(m.user.id)) : isFull(m.acc)) && canAsk(m.acc, need));
    const blast = async (list, text) => { for (const m of list) { try { await send(m.tg, text.length > 4000 ? text.slice(0, 3990) + "\n…" : text); sent.push(m.tg); } catch (e) { /* человек остановил бота */ } } };
    if (wantDaily && (await markOnce("rep:daily:" + day))) {
      const list = to("kassa");
      if (list.length) await blast(list, "📊 <b>Kunlik hisobot</b>\n\n" + (await kassa(day)) + "\n\n" + (await today(day)));
    }
    if (wantDebts && (await markOnce("rep:debts:" + day.slice(0, 7)))) {
      const list = to("qarz");
      if (list.length) await blast(list, await debtReport(rp.debts.days));
    }
    return sent;
  }

  // меню команд выставляется само один раз (после выкладки новой версии); имя бота — для ссылок «Ulash» в программе
  let menuDone = false;
  async function saveBotName() {
    const me = await botMe(); if (!me) return;
    const cf = await cfg();
    if (cf.p && cf.p.lines && cf.p.lines.bot === me) return;
    if (cf.p) await db.update("requests", "id=eq." + cf.p.id, { lines: { ...(cf.p.lines || {}), bot: me } });
    else await db.insert("requests", { mode: PEND_MODE, source: "config", lines: { groups: [], bot: me } });
  }
  return {
    async handle(upd) {
      if (upd && upd.te_cron) return tick();
      if (!menuDone) { menuDone = true; try { await setupMenu(tg); await saveBotName(); } catch (e) { menuDone = false; } }
      if (upd.callback_query) return onCallback(upd.callback_query);
      if (upd.message) return onMessage(upd.message);
      if (upd.my_chat_member) {
        const ch = upd.my_chat_member.chat || {}, st = upd.my_chat_member.new_chat_member && upd.my_chat_member.new_chat_member.status;
        if ((ch.type === "group" || ch.type === "supergroup") && (st === "member" || st === "administrator")) {
          const cf = await cfg();
          if (!isAllowed(cf, ch.id)) { await addPending(cf, ch); return send(ch.id, NOT_ALLOWED); }
          if (st === "member") return send(ch.id, "ℹ️ Guruhdagi barcha xabarlarni o'qishim uchun meni <b>admin</b> qiling (Guruh → Adminlar → qo'shish).");
        }
      }
    },
  };
}
