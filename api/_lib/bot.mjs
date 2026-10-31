// Telegram-бот Thermo: в разрешённой группе находит расходы/приходы в сообщениях («taksi 50 000», «prixod 500$ …»),
// спрашивает кнопками и после «✅» вносит в программу (Финансы → расход/приход компании); считает кассу так же,
// как программа (тот же код — core.mjs), и отвечает на команды: /kassa /bugun /qarz /postavshik /obyekt /yordam.
// Группы разрешает руководитель в программе (Аккаунты → Telegram-бот); бот сам записывает группы, куда его добавили.
import * as C from "./core.mjs";

export const CFG_MODE = "te_tg";        // разрешённые группы — меняет руководитель (lines.allowed = [{ id, title }])
export const PEND_MODE = "te_tgpend";   // группы, куда добавили бота, — пишет бот (lines.groups = [{ id, title, at }])
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
  if (cmd && cmd.name !== "kassa" && cmd.name !== "bugun" && cmd.name !== "yordam" && cmd.name !== "id") { const a = findAmount(cmd.arg); if (a && (a.v >= 1000 || a.cur)) { const m = parseMoney(body); if (m) return { money: m }; } }
  if (cmd) return { cmd };
  const money = parseMoney(body);
  return money ? { money } : null;
}
export const HELP = [
  "🤖 <b>Thermo bot</b>",
  "",
  "Bot faqat <b>/</b> bilan boshlangan xabarlarni o'qiydi.",
  "",
  "<b>Rasxod / prixod</b> — / dan keyin summa va nima uchunligini yozing:",
  "• <code>/taksi 50 000</code> · <code>/obed 120.000 sum</code> · <code>/benzin 200 000 karta</code>",
  "• <code>/prixod 500$ Jamol aka</code> · <code>/+300$ qarz qaytardi</code>",
  "Bot so'raydi — <b>✅ Kiritish</b> bosilsa, dasturga (Финансы) kiradi. Kategoriya va rasxod/prixodni tugmalar bilan o'zgartirsa bo'ladi.",
  "So'mdagi summa oxirgi kurs bilan $ ga o'giriladi (boshqa kurs: <code>… kurs 12 650</code>).",
  "",
  "<b>Savollar:</b>",
  "• /kassa — bugungi kassa (<code>/kassa kecha</code>, <code>/kassa 28.10</code>)",
  "• /bugun — bugungi kirim-chiqim",
  "• /qarz — mijozlar qarzi (<code>/qarz Aziz</code> — qidirish)",
  "• /postavshik — postavshiklarga qarz (<code>/postavshik KAS</code>)",
  "• /obyekt <i>nomi</i> — obyekt holati",
].join("\n");

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
    if (cf.p) await db.update("requests", "id=eq." + cf.p.id, { lines: { groups } });
    else await db.insert("requests", { mode: PEND_MODE, source: "config", lines: { groups } });
    return true;
  }
  async function migrate(cf, from, to) {
    if (!cf.c || !isAllowed(cf, from)) return;
    const allowed = cf.allowed.map((g) => (String(g.id) === String(from) ? { ...g, id: String(to) } : g));
    await db.update("requests", "id=eq." + cf.c.id, { lines: { ...cf.c.lines, allowed } });
  }
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
    if (chat.type === "private") {
      if (text.startsWith("/")) return send(chat.id, "Bu bot ishchi guruhda ishlaydi: guruhga qo'shing va admin qiling.\n\n" + HELP);
      return;
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
    if (cmd) return runCommand(chat.id, msg, cmd);
    const rate = money.cur === "uzs" ? money.rate || (await lastRate()) : 0;
    const v = view(money, money.dir, money.cat, rate, nameOf(msg.from));
    return send(chat.id, v.text, { reply_to_message_id: msg.message_id, reply_markup: v.reply_markup });
  }

  async function onCallback(cq) {
    const m = cq.message || {}, chat = m.chat || {};
    const ans = (text, alert) => tg("answerCallbackQuery", { callback_query_id: cq.id, text: text || "", show_alert: !!alert }).catch(() => {});
    const edit = (text, reply_markup) => tg("editMessageText", { chat_id: chat.id, message_id: m.message_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) });
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
    const note = slashText(orig.text).replace(/\s+/g, " ").trim().slice(0, 200) + " (Telegram: " + author + ")";
    const row = { type, object_id: null, category: pl.cat, ...(type === "company_expense" ? { size: pl.cat } : {}), ...C.payPatch(pl.pay, type, false), op_date: tgDate(orig.date), note, user: author, user_name: author };
    let op;
    try { op = (await db.insert("finance_ops", row))[0]; }
    catch (e) { await ans("Xato: dasturga yozilmadi", true); await send(chat.id, "⚠️ Dasturga yozilmadi: " + esc(e.message).slice(0, 300), { reply_to_message_id: orig.message_id }); return; }
    const amt = (p.cur === "uzs" ? sum(p.v) + " (" + usd(pl.usdAmt) + ")" : usd(p.v));
    const ts = now().toISOString();
    try {
      await db.insert("audit_log", [
        { action: d === "i" ? "Telegram: приход" : "Telegram: расход", entity: "company:" + pl.cat, detail: amt.replace(/so'm/g, "сум") + " · " + note + " · подтвердил " + who, user_name: "Telegram: " + who, role: "telegram", ts },
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
  async function objects(q) {
    if (!q) return "Obyekt nomini yozing: <code>obyekt Yunusabad</code>";
    const data = await loadData(["objects", "finance_ops", "masters"]);
    const mName = (id) => ((data.masters || []).find((m) => m.id === id) || {}).name || "";
    const rows = data.objects.filter((o) => hitAll(hay([o.name, o.client, o.phone, o.master, o.address]), q)).slice(0, 5);
    if (!rows.length) return "«" + esc(q) + "» bo'yicha obyekt topilmadi.";
    return rows.map((o) => {
      const f = C.calcObject(o, data.finance_ops), st = C.stById(o.status);
      return ["🏠 <b>" + esc(o.name) + "</b> · " + esc(st.label),
        "Mijoz: " + esc([o.client, o.phone].filter(Boolean).join(", ") || "—") + (o.master || o.master_id ? " · Usta: " + esc(o.master || mName(o.master_id)) : ""),
        "Summa: " + usd(f.saleNet) + " · To'langan: " + usd(f.paidClient) + " · " + (f.clientDebt > 0.004 ? "<b>Qarz: " + usd(f.clientDebt) + "</b>" : f.clientDebt < -0.004 ? "Ortiqcha: " + usd(-f.clientDebt) : "Qarz yo'q") + (C.isLive(o) ? "" : " (hisobga olinmaydi)")].join("\n");
    }).join("\n\n");
  }
  async function runCommand(chatId, msg, cmd) {
    const day = tzDate(now());
    let text;
    try {
      if (cmd.name === "yordam") text = HELP;
      else if (cmd.name === "kassa") text = await kassa(parseDay(cmd.arg, day));
      else if (cmd.name === "bugun") text = await today(parseDay(cmd.arg, day));
      else if (cmd.name === "qarz") text = await debts(cmd.arg);
      else if (cmd.name === "postavshik") text = await supDebts(cmd.arg);
      else if (cmd.name === "obyekt") text = await objects(cmd.arg);
      else return;
    } catch (e) { text = "⚠️ Hisoblab bo'lmadi: " + esc(String(e.message || e)).slice(0, 300); }
    if (text.length > 4000) text = text.slice(0, 3990) + "\n…";
    return send(chatId, text, { reply_to_message_id: msg.message_id });
  }

  return {
    async handle(upd) {
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
