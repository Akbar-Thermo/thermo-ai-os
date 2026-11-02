// Telegram-бот Thermo: в разрешённой группе находит расходы/приходы в сообщениях («taksi 50 000», «prixod 500$ …»),
// спрашивает кнопками и после «✅» вносит в программу (Финансы → расход/приход компании); считает кассу так же,
// как программа (тот же код — core.mjs), и отвечает на команды: /kassa /bugun /qarz /postavshik /obyekt /yordam.
// Группы разрешает руководитель в программе (Аккаунты → Telegram-бот); бот сам записывает группы, куда его добавили.
import * as C from "./core.mjs";
import { createHash } from "node:crypto";
import { VOICES, DEF_VOICE } from "./voice.mjs";

export const CFG_MODE = "te_tg";        // разрешённые группы — меняет руководитель (lines.allowed = [{ id, title }])
export const PEND_MODE = "te_tgpend";   // группы, куда добавили бота, — пишет бот (lines.groups = [{ id, title, at }])
export const LINK_MODE = "te_tglink";   // одноразовые ссылки «Telegram ulash» (программа): lines = { user_id, hash, exp }
export const USERS_MODE = "te_tgusers"; // кто чей: lines.links = { <telegram id>: { user_id, tg, at } } (пишет бот)
export const REMIND_MODE = "te_tgremind"; // напоминания «/eslat»: lines = { tg, user_id, at, text } (пишет бот)
export const RATE_MODE = "te_rate";       // курс для бота «/kurs 12 650»: lines = { rate, at, by }
export const LOG_MODE = "te_tg";        // скрытая запись журнала: entity «tg:<группа>:<сообщение>», detail — id операции
export const MEM_MODE = "te_tgmem";     // память диалога с ИИ (зашифрована ключом бота): lines = { tg, user_id, at, enc, voice }
export const AIU_MODE = "te_tgai";      // расход ИИ за месяц: lines = { month, usd, claude, speech, calls, sec, chars, users, prev }
export const QUEUE_MODE = "te_tgq";     // сообщения группы с суммой (для «что не внесено»): lines = { chat, msg, date, from, text }
export const ACT_MODE = "te_tgact";
export const SMETA_BOT = "@thermo_smeta_bot"; // смета — только в отдельном боте
// бот поставщиков: группы ↔ поставщики и группа расходов (руководитель), группы бота, что уже предложено/отправлено, заказы, накладные
export const ZK_CFG = "te_zk", ZK_PEND = "te_zkpend", ZK_ST = "te_zkst", ZK_ORD = "te_zkord", ZK_INV = "te_zkinv";
export const MATCH_MODE = "te_tgmatch";  // память смет: «как написали» → какой товар взяли: lines.m = { ключ: [product_id, раз, дата] }
export const RULES_MODE = "te_tgrules";  // правила «что у кого брать»: lines.rules = [{ id, q, sup, by, at }]
// ключ памяти: слова названия без порядка, латиница/кириллица одинаково («Труба PPR 20» = «ppr truba 20»)
export const mkey = (s) => [...new Set(low(C.translit(String(s || ""))).replace(/[^\p{L}\p{N}/.]+/gu, " ").split(" ").filter(Boolean))].sort().join(" ");     // действие, предложенное ботом, ждёт «✅»: lines = { tg, user_id, kind, data, exp }

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
// сумма явно есть: валюта / «ming», «mln» / число от 1000 — «2 ta truba 50» не считается
export function moneyLike(text) {
  const p = parseMoney(text); if (!p) return null;
  return /\$/.test(text) || new RegExp(AMOUNT_WORDS.source, "iu").test(low(text)) || p.v >= 1000 ? p : null;
}
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
  dostavka: ["dostavka", "доставка", "yetkazish", "етказиш"],
  eslat: ["eslat", "eslatma", "эслат", "напомни", "remind"],
  q: ["q", "qidir", "qidiruv", "поиск", "search", "izla"],
  hafta: ["hafta", "ҳафта", "хафта", "неделя", "week"],
  oy: ["oy", "ой", "месяц", "month"],
  kurs: ["kurs", "курс", "rate"],
  smeta: ["smeta", "смета", "estimate"],
  nakladnoy: ["nakladnoy", "nakladnaya", "накладная", "накладной", "nakladnoi"],
  yangi: ["yangi", "янги", "new", "reset", "новый"],
  ovoz: ["ovoz", "овоз", "voice", "голос"],
  qoida: ["qoidalar", "qoida", "rules", "правила"],
  eslab: ["eslab", "eslabqol", "запомни"],
  tekshir: ["tekshir", "текшир", "tekshirish", "kiritilmagan", "сверка", "проверка"],
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
  if (cmd && !["kassa", "bugun", "yordam", "id", "narx", "sklad", "dostavka", "eslat", "q", "hafta", "oy", "kurs"].includes(cmd.name)) { const a = findAmount(cmd.arg); if (a && (a.v >= 1000 || a.cur)) { const m = parseMoney(body); if (m) return { money: m }; } }
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
  "• /obyekt — obyektlar: holati, to'lovlar, materiallar, 💳 to'lov qo'shish, 📄 Excel, 📤 mijozga xabar",
  "• /dostavka — yetkazishlar, «✅ Yetkazildi» · /narx <i>tovar</i> — narxlar · /sklad <i>tovar</i> — ombor",
  "• /q <i>so'z</i> — hamma joydan qidirish · /hafta, /oy — davr hisoboti · /kurs — kurs (<code>/kurs 12 650</code>)",
  "• /eslat <code>15:00 matn</code> — eslatma (<code>ertaga 10:00 …</code>, <code>30 daqiqa …</code>, <code>05.11 9:00 …</code>)",
  "• /tekshir <code>23.10</code> — guruhda yozilgan, lekin dasturga kiritilmagan rasxod/prixodlar → belgilab, bitta tugma bilan kiritish",
  "  eski xabarlar uchun: Telegram Desktop → guruh → ⋮ → Export chat history → JSON → <code>result.json</code> faylini shu chatga yuboring",
  "• 📷 Nakladnoy rasmi yoki PDF — o'qib, obyektga yoki Sklad Thermo'ga qo'shadi (/nakladnoy)",
  "• 📋 Smeta — alohida botda: " + SMETA_BOT,
  "",
  "<b>AI</b> — «/» siz oddiy so'z yoki 🎙 ovozli xabar bilan:",
  "• <i>Gulnoraning qarzi qancha?</i> · <i>Nega bu oy foyda kam?</i> · <i>PPR 20 truba qaysi postavshikda arzon?</i>",
  "• <i>Akmalga 500$ naqd to'lov qo'sh</i> · <i>Sergeli obyekti yetkazildi</i> — bot kartochka ko'rsatadi, ✅ bosilmaguncha hech narsa yozilmaydi",
  "• <i>Gulnoraga qarz haqida ruscha xabar yoz</i> · <i>ertaga 10 da Akmalga qo'ng'iroq qilishni eslat</i>",
  "• savol bo'lmasa — «Заметки»ga zametka bo'lib tushadi · /yangi — suhbatni yangidan boshlash · /ovoz — javoblar ovoz bilan",
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
  { command: "dostavka", description: "Yetkazishlar" },
  { command: "q", description: "Hamma joydan qidirish (/q Gulnora)" },
  { command: "hafta", description: "Shu hafta: kirim-chiqim" },
  { command: "oy", description: "Shu oy: kirim-chiqim" },
  { command: "kurs", description: "Kurs (/kurs 12 650 — yangisi)" },
  { command: "eslat", description: "Eslatma (/eslat 15:00 matn)" },
  { command: "tekshir", description: "Guruhda kiritilmagan rasxodlar (/tekshir 23.10)" },
  { command: "nakladnoy", description: "Nakladnoy rasmidan kirim" },
  { command: "yangi", description: "Suhbatni yangidan boshlash" },
  { command: "ovoz", description: "Javoblar ovoz bilan: yoqish / o'chirish" },
  { command: "yordam", description: "Qanday ishlatish" },
];
// какой раздел программы нужен для вопроса (как вкладки в программе)
export const NEED = { kassa: "finance", bugun: "finance", hafta: "finance", oy: "finance", kurs: "finance", qarz: "objects", postavshik: "suppliers", obyekt: "objects", narx: "products", sklad: "wh", dostavka: "delivery", smeta: "products", tekshir: "finance", qoida: "products", eslab: "products" };
export const canAsk = (acc, name) => !NEED[name] || !!acc && (acc.base === "boss" || (acc.tabs || []).includes(NEED[name]));
export const isFull = (acc) => !!acc && (acc.base === "boss" || C.PERMS.every((p) => acc.perms && acc.perms[p.id]));
// кнопки с вопросами внизу личного чата — только те, что человеку открыты
export function qkb(acc) {
  const b = ["kassa", "bugun", "qarz", "postavshik", "obyekt", "dostavka", "narx", "sklad", "q"].filter((n) => canAsk(acc, n)).concat("yordam").map((n) => ({ text: "/" + n }));
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
  const r = (lines && lines.report) || {}, d = r.daily || {}, b = r.debts || {}, k = r.risk || {};
  return { daily: { on: d.on !== false, time: HM.test(d.time || "") ? d.time : "21:30", ai: d.ai !== false }, debts: { on: b.on !== false, time: HM.test(b.time || "") ? b.time : "10:00", days: Number(b.days) > 0 ? Number(b.days) : 14 },
    risk: { on: k.on !== false, dow: Number(k.dow) >= 0 && Number(k.dow) <= 6 ? Number(k.dow) : 1, time: HM.test(k.time || "") ? k.time : "09:00" }, to: Array.isArray(r.to) ? r.to.map(String) : null };
}
// ИИ (Аккаунты → Telegram-бот): лимит расходов в месяц ($), голос ответа, когда отвечать голосом
export function aiCfg(lines) {
  const a = (lines && lines.ai) || {}, lim = Number(a.limit);
  return { limit: a.limit == null || a.limit === "" || !(lim >= 0) ? 10 : lim, voice: VOICES[a.voice] ? a.voice : DEF_VOICE, speak: a.speak === "never" ? "never" : "voice" };
}
export const dowOf = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
export const tzTime = (d = new Date()) => d.toLocaleTimeString("sv-SE", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" });
const mins = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
export const isDue = (hm, t) => mins(hm) >= mins(t) && mins(hm) - mins(t) < 120; // окно 2 часа: опоздавший запуск всё же отправит
export const isMonday = (iso) => new Date(iso + "T12:00:00Z").getUTCDay() === 1;
// «/eslat …»: когда (по Ташкенту) и что напомнить. «15:00 …», «ertaga 10:00 …», «05.11 9:00 …», «30 daqiqa …», «2 soat …»
export function parseRemind(arg, nowD = new Date()) {
  let s = String(arg || "").trim(); if (!s) return null;
  const today = tzDate(nowD);
  const toUtc = (day, hm) => new Date(day + "T" + hm + ":00+05:00");
  let m = /^(\d+)\s*(daqiqa|daq|min|минут[а-я]*|мин)\.?(?:dan(?=\s))?\s*(?:keyin(?=\s))?(?=\s|$)\s*(.*)$/i.exec(s) || /^(\d+)\s*(soat|час[а-я]*|h)\.?(?:dan(?=\s))?\s*(?:keyin(?=\s))?(?=\s|$)\s*(.*)$/i.exec(s);
  if (m) { const n = Number(m[1]) * (/^(soat|час|h)/i.test(m[2]) ? 60 : 1); return n > 0 && m[3].trim() ? { at: new Date(nowD.getTime() + n * 60e3), text: m[3].trim() } : null; }
  let day = today;
  m = /^(ertaga|эртага|завтра)\s+(.*)$/i.exec(s); if (m) { day = addDays(today, 1); s = m[2]; }
  else { m = /^(bugun|бугун|сегодня)\s+(.*)$/i.exec(s); if (m) s = m[2]; }
  m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s+(.*)$/.exec(s);
  if (m) { const y = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : today.slice(0, 4); day = y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); s = m[4]; }
  m = /^(\d{1,2})[:.](\d{2})\s+(.+)$/.exec(s);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  let at = toUtc(day, m[1].padStart(2, "0") + ":" + m[2]);
  if (isNaN(at)) return null;
  if (at.getTime() <= nowD.getTime() && day === today && !/^(bugun|бугун|сегодня)/i.test(String(arg).trim())) at = new Date(at.getTime() + 864e5); // время прошло — завтра
  return at.getTime() > nowD.getTime() ? { at, text: m[3].trim() } : null;
}
// base64 (память диалога, фото и PDF для ИИ) — работает и в Node, и в Deno
export const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));
// список без ИИ: «truba PPR 20 — 50 m», «kran 1/2 10 ta» → { name, qty, unit }
export function parseList(text) {
  return String(text || "").split(/\n|;/).map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s+/, "").trim()).filter(Boolean).map((l) => {
    const m = /^(.*?)[\s—–:-]+(\d+(?:[.,]\d+)?)\s*(ta|та|шт|dona|дона|m|м|metr|метр|kg|кг|pcs)?\.?\s*$/i.exec(l);
    return m && m[1].trim() ? { name: m[1].replace(/[\s—–:-]+$/, "").trim(), qty: toNum(m[2]), unit: (m[3] || "").toLowerCase() } : { name: l, qty: 1, unit: "" };
  });
}
export const isLastDay = (iso) => addDays(iso, 1).slice(5, 7) !== iso.slice(5, 7);
export const PROMPTS = [
  { name: "obyekt", mark: "🔍 Obyekt qidirish", hint: "nomi, mijoz yoki telefonni yozing", ph: "masalan: Yunusobod" },
  { name: "narx", mark: "💲 Narx qidirish", hint: "tovar nomini yozing", ph: "masalan: kran 32" },
  { name: "sklad", mark: "📦 Sklad qidirish", hint: "tovar nomini yozing", ph: "masalan: truba 25" },
  { name: "q", mark: "🔍 Qidirish", hint: "obyekt, mijoz, tovar yoki postavshik", ph: "masalan: Gulnora" },
];
export const SMETA_MARK = "📋 Smeta:", NAK_MARK = "🧾 Nakladnoy:", OBJ_PICK_MARK = "🏠 Obyektni tanlang", NEWOBJ_MARK = "🆕 Yangi obyekt";
// «Yunusobod 5-kv, Gulnora, 90 123 45 67» → { name, client, phone }
export function parseNewObj(t) {
  const parts = String(t || "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  const isPh = (x) => /^\+?[\d\s()-]{7,}$/.test(x) && (x.match(/\d/g) || []).length >= 7;
  const phone = parts.find(isPh) || "", rest = parts.filter((x) => x !== phone);
  return { name: (rest[0] || "").slice(0, 120), client: (rest[1] || "").slice(0, 80), phone: phone.replace(/\s+/g, " ").slice(0, 30), address: rest.slice(2).join(", ").slice(0, 160) };
}
export const linkHash = (token) => createHash("sha256").update("tglink:" + token, "utf8").digest("hex");
export async function setupMenu(tg) {
  for (const scope of [{ type: "default" }, { type: "all_group_chats" }, { type: "all_chat_administrators" }]) await tg("deleteMyCommands", { scope });
  await tg("setMyCommands", { commands: MENU, scope: { type: "all_private_chats" } });
}

// ---------- бот ----------
// upload(method, params, { name, bytes, mime, field }) — отправка файла в Telegram (Excel клиенту, голосовое)
// file(file_id) → { bytes, path } — скачать файл из Telegram (голосовое, фото накладной, PDF)
// ai — makeAI (ai.mjs): свободные вопросы в личном чате и разбор «/…» без суммы цифрами; нет ключа — null
// voice — makeVoice (voice.mjs): распознавание голосовых и ответ голосом; memKey — ключ шифрования памяти диалога
// reader — makeGemini (gemini.mjs): чтение списков для сметы (бесплатно), при ошибке — Claude
// smeta: true — отдельный бот смет (@…smeta_bot): только личный чат, любой текст / фото / PDF / голос → смета
// zakaz: true — бот поставщиков (@…: заказы в группы поставщиков, их накладные → группа расходов)
export function makeBot({ db, tg, now = () => new Date(), upload = null, ai = null, file = null, voice = null, memKey = "", reader = null, smeta = false, zakaz = false }) {
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
  async function setRate() { try { const r = (await db.select("requests", "mode=eq." + RATE_MODE + "&select=id,lines&limit=1"))[0]; return r || null; } catch (e) { return null; } }
  async function lastRate() {
    const sr = await setRate();
    if (sr && sr.lines && Number(sr.lines.rate) >= 1000) return Number(sr.lines.rate);
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

  // ---------- бот поставщиков (zakaz): заказы в группы поставщиков, их накладные → группа расходов ----------
  async function zkCfg() {
    const rows = await db.select("requests", "mode=in.(" + ZK_CFG + "," + ZK_PEND + "," + ZK_ST + ")&select=id,mode,lines");
    const c = rows.find((r) => r.mode === ZK_CFG), p = rows.find((r) => r.mode === ZK_PEND), st = rows.find((r) => r.mode === ZK_ST);
    const L = (c && c.lines && typeof c.lines === "object" && !Array.isArray(c.lines) ? c.lines : {}) || {};
    return { c, p, st, sup: L.sup || {}, exp: L.exp ? String(L.exp) : "", to: Array.isArray(L.to) ? L.to.map(String) : null, groups: (p && p.lines && Array.isArray(p.lines.groups) ? p.lines.groups : []), k: (st && st.lines && st.lines.k) || {} };
  }
  async function zkPending(z, chat) {
    const gs = z.groups.filter((g) => String(g.id) !== String(chat.id));
    const groups = [...gs, { id: String(chat.id), title: chat.title || "", at: now().toISOString() }].slice(-60);
    if (z.p) await db.update("requests", "id=eq." + z.p.id, { lines: { ...(z.p.lines || {}), groups } });
    else await db.insert("requests", { mode: ZK_PEND, source: "config", lines: { groups } });
  }
  async function zkSaveName() {
    const me = await botMe(); if (!me) return;
    const z = await zkCfg();
    if (z.p && z.p.lines && z.p.lines.bot === me) return;
    if (z.p) await db.update("requests", "id=eq." + z.p.id, { lines: { ...(z.p.lines || {}), bot: me } });
    else await db.insert("requests", { mode: ZK_PEND, source: "config", lines: { groups: [], bot: me } });
  }
  const zkWho = (P, z) => P.all().filter((m) => (z.to ? z.to.includes(String(m.user.id)) : isFull(m.acc)) && canAsk(m.acc, "obyekt") && money$(m.acc));
  const zkItems = (b, sup) => b.items.filter((i) => i && i.supplier_id && !i.from_warehouse && !C.isShipped(i) && (!sup || i.supplier_id === sup));
  async function zkSetK(key, val) {
    const z = await zkCfg();
    const k = { ...z.k, [key]: val };
    if (z.st) await db.update("requests", "id=eq." + z.st.id, { lines: { ...z.st.lines, k } }); else await db.insert("requests", { mode: ZK_ST, source: "config", lines: { k, init_at: now().toISOString() } });
  }
  // раз в 5 минут: новые поставки согласованных объектов → предложение «отправить поставщикам?» (в первый раз — всё старое помечается)
  async function zkTick() {
    const z = await zkCfg();
    const [objs, sups] = await Promise.all([db.all("objects"), db.all("suppliers", "", "id,name")]);
    const sn = new Map(sups.map((s) => [s.id, s.name]));
    const groupOf = new Map(Object.entries(z.sup).map(([chat, sid]) => [sid, chat]));
    const title = (chat) => ((z.groups.find((g) => String(g.id) === String(chat)) || {}).title || "guruh");
    const k = { ...z.k }, init = !z.st, fresh = [];
    for (const o of objs) {
      if (!C.isLive(o) || o.status === "closed") continue;
      for (const b of C.objBatches(o)) {
        const key = o.id + ":" + b.no;
        if (k[key] || !zkItems(b).length) continue;
        if (init) k[key] = "o"; else fresh.push({ o, b, key });
      }
    }
    if (init) { await db.insert("requests", { mode: ZK_ST, source: "config", lines: { k, init_at: now().toISOString() } }); return []; }
    if (!fresh.length) return [];
    const P = await people(), who = zkWho(P, z), sent = [];
    for (const f of fresh.slice(0, 5)) {
      const bySup = new Map(); zkItems(f.b).forEach((i) => { if (!bySup.has(i.supplier_id)) bySup.set(i.supplier_id, []); bySup.get(i.supplier_id).push(i); });
      const L = ["📦 <b>Yangi postavka</b> · " + esc(f.o.name || "—") + " · " + f.b.no + "-postavka" + (f.b.date ? " (" + dt(String(f.b.date).slice(0, 10)) + ")" : ""), "", "Postavshiklarga buyurtma yuboraymi?",
        ...[...bySup].map(([sid, its]) => "• " + esc(sn.get(sid) || "?") + " — " + its.length + " poz. → " + (groupOf.get(sid) ? "«" + esc(title(groupOf.get(sid))) + "»" : "⚠️ guruhi ulanmagan"))];
      let got = 0;
      for (const m of who) { try { await send(m.tg, L.join("\n"), { reply_markup: { inline_keyboard: [[{ text: "✅ Yuborish", callback_data: "zs:" + f.o.id + ":" + f.b.no }, { text: "❌ Kerak emas", callback_data: "zx:" + f.o.id + ":" + f.b.no }]] } }); got++; sent.push(m.tg); } catch (e) { /* человек ещё не открыл бота */ } }
      if (got) { k[f.key] = "p"; await zkSetK(f.key, "p"); }
    }
    return sent;
  }
  async function zkSend(oid, no, me) {
    const z = await zkCfg(), key = oid + ":" + no;
    if (z.k[key] === "s") return { already: true };
    const o = (await db.select("objects", "id=eq." + oid + "&select=*"))[0];
    if (!o) throw new Error("obyekt topilmadi");
    const b = C.objBatches(o).find((x) => x.no === no);
    if (!b) throw new Error("postavka topilmadi");
    const [sups, prods] = await Promise.all([db.all("suppliers", "", "id,name"), db.all("products", "", "id,code")]);
    const sn = new Map(sups.map((s) => [s.id, s.name])), code = new Map(prods.map((p) => [p.id, p.code]));
    const groupOf = new Map(Object.entries(z.sup).map(([chat, sid]) => [sid, chat]));
    const bySup = new Map(); zkItems(b).forEach((i) => { if (!bySup.has(i.supplier_id)) bySup.set(i.supplier_id, []); bySup.get(i.supplier_id).push(i); });
    const ok = [], miss = [];
    for (const [sid, its] of bySup) {
      const chat = groupOf.get(sid);
      if (!chat) { miss.push(sn.get(sid) || "?"); continue; }
      const t = ["🧾 <b>Buyurtma · Thermo Engineering</b>", "Obyekt: <b>" + esc(o.name || "—") + "</b> · №" + esc(o.id.slice(0, 4).toUpperCase()) + "-" + no, "",
        ...its.map((i, n) => (n + 1) + ". " + esc(i.name) + (i.size && !String(i.name).includes(i.size) ? " " + esc(i.size) : "") + " — <b>" + C.fmt(Number(i.qty) || 0) + " " + esc(i.unit || "шт") + "</b>" + (code.get(i.product_id) ? " <i>(kod " + esc(code.get(i.product_id)) + ")</i>" : "")),
        "", "Nakladnoyni shu xabarga <b>javob qilib</b> yuboring 🙏"].join("\n");
      try {
        const r = await send(chat, cut(t, 4000));
        await db.insert("requests", { mode: ZK_ORD, source: "config", lines: { obj: o.id, name: o.name || "", batch: no, sup: sid, chat: String(chat), msg: r && r.message_id, items: its.map((i) => ({ id: i.id, product_id: i.product_id || null, name: i.name, qty: Number(i.qty) || 0, unit: i.unit || "шт" })), at: now().toISOString(), by: me.name } });
        ok.push(sn.get(sid) || "?");
      } catch (e) { miss.push((sn.get(sid) || "?") + " (" + String(e.message || e).slice(0, 60) + ")"); }
    }
    await zkSetK(key, "s");
    try { await db.insert("audit_log", { action: "Telegram: заказ поставщикам", entity: "object:" + (o.name || ""), detail: "поставка №" + no + " → " + (ok.join(", ") || "—") + (miss.length ? "; не отправлено: " + miss.join(", ") : ""), user_name: me.name, role: "telegram", ts: now().toISOString() }); } catch (e) {}
    return { ok, miss, name: o.name || "" };
  }
  // накладная из группы поставщика → читаем (ИИ), находим объект → в группу расходов с «✅ Kiritish»
  function zkCaption(L) {
    const it = L.items || [];
    const tot = it.reduce((a, x) => a + (Number(x.qty) || 0) * (Number(x.price) || 0), 0);
    const totU = it.reduce((a, x) => a + (Number(x.qty) || 0) * (Number(x.cost) || 0), 0);
    const lines = ["🧾 <b>Nakladnoy</b> · " + esc(L.supName || "?") + (L.number ? " · №" + esc(L.number) : "") + (/^\d{4}-\d{2}-\d{2}$/.test(L.date || "") ? " · " + dt(L.date) : ""),
      L.obj ? "🏠 <b>" + esc(L.name || "—") + "</b> · " + L.batch + "-postavka" : "🏠 Obyekt: ❓ — pastdan tanlang",
      it.length ? "Summa: <b>" + (L.cur === "uzs" ? sum(tot) + "</b> ≈ " + usd(totU) : usd(tot) + "</b>") + " · " + it.length + " poz." : "Summa: o'qilmadi (rasmni ko'ring)"];
    if (L.diff && L.diff.length) lines.push("⚠️ " + L.diff.slice(0, 4).join("; "));
    if (L.done) lines.push("✅ Kiritildi (" + esc(L.done) + ")" + (L.res ? ": " + esc(L.res) : ""));
    if (L.skip) lines.push("❌ Kiritilmadi (" + esc(L.skip) + ")");
    return cut(lines.join("\n"), 1000);
  }
  const tok = (s) => new Set(mkey(s).split(" ").filter((w) => w.length > 1));
  const simil = (a, b) => { const A = tok(a), B = tok(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach((w) => { if (B.has(w)) n++; }); return (2 * n) / (A.size + B.size); };
  function zkDiff(ordItems, invItems) {
    const out = [];
    (ordItems || []).forEach((oi) => {
      const best = invItems.map((x) => ({ x, s: simil(oi.name, x.name) })).sort((a, b) => b.s - a.s)[0];
      if (!best || best.s < 0.5) out.push(cut(oi.name, 30) + " — nakladnoyda yo'q");
      else if (Math.abs((Number(best.x.qty) || 0) - (Number(oi.qty) || 0)) > 0.001) out.push(cut(oi.name, 30) + ": buyurtma " + C.fmt(oi.qty) + ", keldi " + C.fmt(best.x.qty));
    });
    return out;
  }
  async function zkKb(L, id) {
    if (L.done || L.skip) return { inline_keyboard: [] };
    if (!L.obj) {
      const ords = (await db.select("requests", "mode=eq." + ZK_ORD + "&select=id,lines")).filter((r) => (L.cands || []).includes(r.id));
      return { inline_keyboard: [...ords.map((r, i) => [{ text: cut("🏠 " + r.lines.name + " · " + r.lines.batch + "-post.", 50), callback_data: "zo:" + id + ":" + i }]), [{ text: "❌ Kerak emas", callback_data: "zn:" + id }]] };
    }
    return { inline_keyboard: [[...((L.items || []).length ? [{ text: "✅ Kiritish (tannarx)", callback_data: "zi:" + id }] : []), { text: "❌ Yo'q", callback_data: "zn:" + id }]] };
  }
  async function zkInvoice(msg, z, supId) {
    const chatId = String(msg.chat.id);
    const sups = await db.all("suppliers", "", "id,name");
    const supName = (sups.find((s) => s.id === supId) || {}).name || "";
    const ords = (await db.select("requests", "mode=eq." + ZK_ORD + "&select=id,lines")).filter((r) => r.lines && r.lines.sup === supId);
    const rq = msg.reply_to_message;
    let ord = rq ? ords.find((r) => String(r.lines.chat) === chatId && Number(r.lines.msg) === rq.message_id) || null : null;
    let inv = null;
    const m = meterNew(), src = mediaSource(msg);
    if (src && ai && file && (await aiState()).ok) {
      try {
        const f = await file(src.id);
        const block = src.pdf ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(f.bytes) } } : { type: "image", source: { type: "base64", media_type: src.mime, data: b64(f.bytes) } };
        inv = await ai.json({ system: NAK_SYS, content: [block, { type: "text", text: "Nakladnoy." + (msg.caption ? " Izoh: " + msg.caption : "") }], maxTokens: 6000, meter: m.fn });
      } catch (e) { console.error("zk read:", e && e.message); }
    }
    await spend(m, null);
    const raw = normItems(inv && inv.items);
    const prices0 = raw.map((i) => i.price).filter((x) => x > 0).sort((a, b) => a - b);
    const cur = inv && inv.currency === "usd" ? "usd" : inv && inv.currency === "uzs" ? "uzs" : (prices0[Math.floor(prices0.length / 2)] || 0) >= 1000 ? "uzs" : "usd";
    const rate = cur === "uzs" ? await rateAt(tzDate(now())) : 0;
    const items = raw.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, price: i.price, cost: cur === "uzs" ? (rate >= 1000 ? C.round2(i.price / rate) : 0) : C.round2(i.price) }));
    let cands = [];
    if (!ord) {
      const recent = ords.filter((r) => now().getTime() - Date.parse(r.lines.at || 0) < 60 * 864e5).sort((a, b) => String(b.lines.at).localeCompare(String(a.lines.at)));
      if (items.length) {
        const sc = recent.map((r) => { const oi = r.lines.items || []; const hit = items.filter((x) => oi.some((y) => simil(x.name, y.name) >= 0.5)).length; return { r, s: hit / Math.max(items.length, oi.length, 1) }; }).sort((a, b) => b.s - a.s);
        if (sc[0] && sc[0].s >= 0.5 && (!sc[1] || sc[1].s < sc[0].s * 0.7)) ord = sc[0].r;
      }
      if (!ord) cands = recent.slice(0, 6).map((r) => r.id);
    }
    const L = { sup: supId, supName, chat: chatId, msg: msg.message_id, ord: ord ? ord.id : null, obj: ord ? ord.lines.obj : null, name: ord ? ord.lines.name : "", batch: ord ? ord.lines.batch : null, cands, items, cur, rate, number: String((inv && inv.number) || "").slice(0, 40), date: (inv && inv.date) || "", diff: ord ? zkDiff(ord.lines.items, items) : [], at: now().toISOString() };
    const row = (await db.insert("requests", { mode: ZK_INV, source: "config", lines: L }))[0];
    if (z.exp) {
      const cap = zkCaption(L), kb = await zkKb(L, row.id);
      try { const r = await tg("copyMessage", { chat_id: z.exp, from_chat_id: chatId, message_id: msg.message_id, caption: cap, parse_mode: "HTML", reply_markup: kb }); if (r && r.message_id) await db.update("requests", "id=eq." + row.id, { lines: { ...L, exp: z.exp, expMsg: r.message_id } }); }
      catch (e) { console.error("zk copy:", e && e.message); try { await send(z.exp, cap, { reply_markup: kb }); } catch (e2) {} }
    }
    try { await send(chatId, "✅ Qabul qilindi" + (ord ? " · " + esc(ord.lines.name) : "") + ", rahmat!", { reply_to_message_id: msg.message_id }); } catch (e) {}
  }
  async function zkCallback(cq, ans) {
    const [act, id, n2] = String(cq.data || "").split(":");
    const me = await whoAmI(cq.from && cq.from.id);
    if (!me) return ans("Akkauntingiz ulanmagan (Thermo bot orqali ulang)", true);
    if (!(canAsk(me.acc, "obyekt") && money$(me.acc))) return ans("Bu bo'lim sizga ochilmagan", true);
    const m = cq.message || {};
    if (act === "zs" || act === "zx") {
      const key = id + ":" + n2;
      const edit = (text) => tg("editMessageText", { chat_id: m.chat.id, message_id: m.message_id, text, parse_mode: "HTML" }).catch(() => {});
      if (act === "zx") { await zkSetK(key, "x"); await edit("❌ Buyurtma yuborilmadi · " + esc(me.name)); return ans(); }
      await ans("Yuborilyapti…");
      try {
        const r = await zkSend(id, Number(n2), me);
        if (r.already) return edit("ℹ️ Bu postavka allaqachon yuborilgan.");
        return edit("✅ <b>Yuborildi</b> · " + esc(r.name) + " · " + n2 + "-postavka\n" + (r.ok.length ? "→ " + esc(r.ok.join(", ")) : "") + (r.miss.length ? "\n⚠️ Yuborilmadi (guruhi ulanmagan): " + esc(r.miss.join(", ")) : "") + "\nYubordi: " + esc(me.name));
      } catch (e) { return edit("⚠️ Yuborib bo'lmadi: " + esc(String(e.message || e)).slice(0, 200)); }
    }
    if (!/^[0-9a-f-]{36}$/i.test(id || "")) return ans();
    const row = (await db.select("requests", "id=eq." + id + "&mode=eq." + ZK_INV + "&select=id,lines"))[0];
    if (!row) return ans("Topilmadi", true);
    let L = row.lines;
    const editCap = async (LL) => { try { await tg("editMessageCaption", { chat_id: m.chat.id, message_id: m.message_id, caption: zkCaption(LL), parse_mode: "HTML", reply_markup: await zkKb(LL, row.id) }); } catch (e) { await tg("editMessageText", { chat_id: m.chat.id, message_id: m.message_id, text: zkCaption(LL), parse_mode: "HTML", reply_markup: await zkKb(LL, row.id) }).catch(() => {}); } };
    if (L.done || L.skip) return ans("Allaqachon belgilangan", true);
    if (act === "zn") { L = { ...L, skip: me.name }; await db.update("requests", "id=eq." + row.id, { lines: L }); await editCap(L); return ans(); }
    if (act === "zo") {
      const oid = (L.cands || [])[Number(n2)];
      const ord = oid && (await db.select("requests", "id=eq." + oid + "&select=id,lines"))[0];
      if (!ord) return ans("Topilmadi", true);
      L = { ...L, ord: ord.id, obj: ord.lines.obj, name: ord.lines.name, batch: ord.lines.batch, diff: zkDiff(ord.lines.items, L.items || []) };
      await db.update("requests", "id=eq." + row.id, { lines: L }); await editCap(L); return ans();
    }
    if (act !== "zi" || !L.obj) return ans();
    // «✅ Kiritish»: цены накладной → себестоимость позиций этой поставки у этого поставщика
    L = { ...L, done: me.name };
    await db.update("requests", "id=eq." + row.id, { lines: L }); // сразу — от двойного нажатия
    try {
      const o = (await db.select("objects", "id=eq." + L.obj + "&select=id,name,items"))[0];
      if (!o) throw new Error("obyekt topilmadi");
      const items = Array.isArray(o.items) ? o.items : [];
      const mine = items.filter((i) => i && (Number(i.batch_no) || 1) === Number(L.batch) && i.supplier_id === L.sup && !i.from_warehouse);
      const used = new Set(); let upd = 0, miss = 0;
      const patch = new Map();
      for (const x of L.items || []) {
        const best = mine.filter((i) => !used.has(i.id)).map((i) => ({ i, s: simil(x.name, i.name) })).sort((a, b) => b.s - a.s)[0];
        if (!best || best.s < 0.5 || !(x.cost > 0)) { miss++; continue; }
        used.add(best.i.id);
        if (Math.abs((Number(best.i.cost) || 0) - x.cost) > 0.004) { patch.set(best.i.id, x.cost); upd++; }
      }
      if (patch.size) await db.update("objects", "id=eq." + o.id, { items: items.map((i) => (i && patch.has(i.id) ? { ...i, cost: patch.get(i.id) } : i)) });
      L.res = "tannarx yangilandi: " + upd + " poz." + (miss ? ", mos kelmadi: " + miss : "");
      await db.update("requests", "id=eq." + row.id, { lines: L });
      try { await db.insert("audit_log", { action: "Накладная поставщика (Telegram)", entity: "object:" + (o.name || ""), detail: (L.supName || "") + (L.number ? " №" + L.number : "") + " · поставка №" + L.batch + " · " + L.res, user_name: me.name, role: "telegram", ts: now().toISOString() }); } catch (e) {}
      await editCap(L);
      return ans("Kiritildi");
    } catch (e) {
      L = { ...L, done: null };
      await db.update("requests", "id=eq." + row.id, { lines: L });
      return ans("Xato: " + String(e.message || e).slice(0, 150), true);
    }
  }
  async function onZakazMessage(msg) {
    const chat = msg.chat || {};
    if (msg.from && msg.from.is_bot) return;
    if (chat.type === "private") {
      const me = await whoAmI(msg.from && msg.from.id);
      return send(chat.id, me ? "📦 <b>Thermo postavka</b>\n\nDasturda yangi postavka saqlanganda sizga shu yerda xabar beraman — «✅ Yuborish» bosilsa, buyurtmani har bir postavshikning guruhiga yuboraman.\nPostavshik nakladnoyni guruhga tashlasa, uni obyekt nomi bilan rasxodlar guruhiga yuboraman; u yerda «✅ Kiritish» — obyekt tannarxini nakladnoy bo'yicha yangilaydi.\n\nGuruhlar: dasturda <b>Аккаунты → Бот поставщиков</b>." : LOCKED);
    }
    if (chat.type !== "group" && chat.type !== "supergroup") return;
    if (msg.new_chat_members || msg.left_chat_member) return;
    const z = await zkCfg();
    if (msg.migrate_to_chat_id) return;
    if (!z.groups.some((g) => String(g.id) === String(chat.id) && g.title === (chat.title || ""))) await zkPending(z, chat);
    const sup = z.sup[String(chat.id)];
    if (!sup || !(msg.photo || msg.document)) return;
    return zkInvoice(msg, z, sup);
  }
  // ---------- отдельный бот смет ----------
  const SMETA_HELLO = "📋 <b>Thermo smeta</b>\n\nTovarlar ro'yxatini yuboring — bazadagi narxlar bilan smeta va dasturga import qilinadigan Excel qaytaraman.\n\n• matn: <code>truba PPR 20 — 50 m, kran 1/2 — 10 ta</code>\n• 📷 rasm yoki PDF (qo'lda yozilgan ro'yxat ham)\n• 🎙 ovozli xabar\n\nPostavshikni yozsangiz, narxni o'shandan olaman: <i>Water Pro dan, bo'lmasa Akfa</i>.\nTayyor smetani «➕ Obyektga qo'shish» — mavjud obyektga, «🆕 Yangi obyekt» — yangi obyekt yaratib qo'shish mumkin.\n\n🧠 Bot eslab qoladi: qaysi tovar qaysi postavshikdan olingan (dasturdagi obyektlardan va siz tasdiqlagan smetalardan). Qoida ham berish mumkin: <code>eslab qol: PPR truba — Akfa dan, nasos — Wilo dan</code> · ro'yxat: /qoidalar";
  async function onSmetaMessage(msg) {
    const chat = msg.chat || {};
    if (chat.type !== "private" || (msg.from && msg.from.is_bot)) return;
    const text = String(msg.text || "").trim();
    const lk = /^\/start(?:@\w+)?\s+L([A-Za-z0-9_-]{16,64})$/.exec(text);
    if (lk) return doLink(msg, lk[1]);
    const me = await whoAmI(msg.from && msg.from.id);
    if (!me) return send(chat.id, "🔒 Smeta botidan foydalanish uchun avval asosiy Thermo botiga akkauntingizni ulang (rahbar: <b>Аккаунты → Telegram-бот → Подключить</b>). Ulangandan keyin bu bot sizni o'zi taniydi.");
    if (!canAsk(me.acc, "smeta")) return send(chat.id, "🔒 Smeta sizga ochilmagan (dasturda «Товары» bo'limi kerak).");
    if (msg.photo || msg.document) return mediaSource(msg) ? onDoc(msg, me, "smeta") : send(chat.id, "Rasm (JPG, PNG) yoki PDF yuboring.");
    if (msg.voice || msg.audio) {
      if (!voice || !file) return send(chat.id, "🎙 Ovozni tushunish uchun ovoz xizmati ulanmagan — matn bilan yozing.");
      const v = msg.voice || msg.audio;
      if ((Number(v.duration) || 0) > 300) return send(chat.id, "🎙 5 daqiqagacha bo'lgan ovozli xabar yuboring.");
      typing(chat.id); const m = meterNew();
      try {
        const f = await file(v.file_id);
        const r = await voice.transcribe(f.bytes, { name: msg.audio ? v.file_name || "audio.mp3" : "voice.ogg", mime: v.mime_type || "audio/ogg", sec: Number(v.duration) || 0 });
        m.speech += r.cost || 0; m.sec += r.sec || 0;
        if (!r.text) return send(chat.id, "🎙 Tushunmadim — aniqroq gapiring yoki yozing.");
        await send(chat.id, "🎙 <i>" + esc(cut(r.text, 1500)) + "</i>", { reply_to_message_id: msg.message_id });
        return await smetaFromText({ ...msg, text: r.text }, me, r.text, m);
      } catch (e) { console.error("smeta stt:", e && e.message); return send(chat.id, "⚠️ Ovozli xabarni o'qib bo'lmadi — matn bilan yozing."); }
      finally { await spend(m, me); }
    }
    if (!text) return;
    if (/^\/(start|yordam|help)\b/i.test(text)) return send(chat.id, SMETA_HELLO);
    const rq = msg.reply_to_message;
    if (rq && rq.from && rq.from.is_bot && String(rq.text || "").startsWith(OBJ_PICK_MARK)) return actObjSearch(msg, rq, me);
    if (rq && rq.from && rq.from.is_bot && String(rq.text || "").startsWith(NEWOBJ_MARK)) return actNewObj(msg, rq, me);
    if (/^\/(qoidalar|rules)\b/i.test(text)) return rulesList(chat.id, me);
    if (isTeach(text)) return teachRule(msg, me, text);
    return smetaFromText(msg, me, text.replace(/^\/smeta(?:@\w+)?\s*/i, "") || text);
  }

  async function onMessage(msg) {
    if (smeta) return onSmetaMessage(msg);
    if (zakaz) return onZakazMessage(msg);
    const chat = msg.chat || {};
    // личный чат: голосовые — распознаём; фото / PDF — только с подписью «/smeta», «/nakladnoy» (или ответом на вопрос бота)
    if (chat.type === "private" && !(msg.from && msg.from.is_bot)) {
      if (msg.voice || msg.audio || msg.video_note) { const me = await whoAmI(msg.from && msg.from.id); return me ? onVoice(msg, me) : send(chat.id, LOCKED); }
      if (msg.document && /\.json$/i.test(String(msg.document.file_name || ""))) { const me = await whoAmI(msg.from && msg.from.id); return me ? onExport(msg, me) : send(chat.id, LOCKED); }
      if (msg.document && /^messages\d*\.html?$/i.test(String(msg.document.file_name || ""))) return send(chat.id, "Bu HTML eksport. Telegram Desktop → Export chat history → pastda <b>Format: Machine-readable JSON</b> ni tanlang va <code>result.json</code> faylini yuboring.");
      if (msg.photo || msg.document) {
        const kind = mediaKind(msg); // «/smeta», «/nakladnoy» или ответ на вопрос бота; иначе ИИ сам поймёт, что на фото
        const me = await whoAmI(msg.from && msg.from.id);
        return me ? onDoc(msg, me, kind) : send(chat.id, LOCKED);
      }
    }
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
      if (!text.startsWith("/")) return handleText(msg, me);
      const pc = parseCommand(text); // в личном чате «/smeta … 1 500» — команда, а не расход
      if (!pc) return send(chat.id, money ? "Rasxod / prixod ishchi guruhda yoziladi: <code>/taksi 50 000</code>" : "Savolni tanlang 👇", { reply_markup: qkb(me.acc) });
      if (/^\/start\b/i.test(text)) return send(chat.id, "Savolni tanlang 👇", { reply_markup: qkb(me.acc) });
      if (pc.name === "yordam") return send(chat.id, HELP, { reply_markup: qkb(me.acc) });
      if (!canAsk(me.acc, pc.name)) return send(chat.id, "🔒 Bu bo'lim sizga ochilmagan.", { reply_markup: qkb(me.acc) });
      return runCommand(chat.id, msg, pc, me);
    }
    if (chat.type !== "group" && chat.type !== "supergroup") return;
    if (msg.migrate_to_chat_id) return migrate(await cfg(), chat.id, msg.migrate_to_chat_id);
    if (msg.new_chat_members || msg.left_chat_member) return; // добавление бота — в my_chat_member
    if (!text || msg.from && msg.from.is_bot) return;
    // «/» siz xabar: javob yo'q, lekin summa bo'lsa — eslab qoladi («/tekshir» — kiritilmaganlarni topish uchun)
    if (!text.startsWith("/")) { if (moneyLike(text)) { const cfq = await cfg(); if (isAllowed(cfq, chat.id)) await queueAdd(chat, msg, text); } return; }
    let money2 = money;
    if (!cmd && !money2 && ai && text.startsWith("/") && hasWords(slashText(text)) && slashText(text).length > 3) {
      const cf0 = await cfg();
      if (isAllowed(cf0, chat.id) && (await aiState()).ok) {
        const m0 = meterNew();
        try { money2 = await aiMoney(text, m0); } catch (e) { money2 = null; }
        await spend(m0, null);
        if (money2) { try { await db.insert("audit_log", { action: LOG_MODE, entity: "tgai:" + chat.id + ":" + msg.message_id, detail: JSON.stringify(money2), user_name: "Telegram-бот", role: "telegram", ts: now().toISOString() }); } catch (e) { money2 = null; } }
      }
    }
    if (!cmd && !money2) return;
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
    await queueAdd(chat, msg, text);
    const rate = money2.cur === "uzs" ? money2.rate || (await lastRate()) : 0;
    const v = view(money2, money2.dir, money2.cat, rate, nameOf(msg.from));
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
    let p = sl && sl.money;
    if (!p) { try { const r = (await db.select("audit_log", "action=eq." + LOG_MODE + "&entity=eq." + encodeURIComponent("tgai:" + chat.id + ":" + orig.message_id) + "&select=detail&limit=1"))[0]; p = r ? JSON.parse(r.detail) : null; } catch (e) { p = null; } }
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
  async function kassa(day) { return (await kassaState(day)).text; }
  async function kassaState(day) {
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
    return { text: head + "\n\n" + esc(rep.text), rep, open, pick, saved, notes };
  }
  // «🧾 Kassani yopish»: отчёт кассы в «Заметки» этого человека — как «Касса в заметки» в программе
  async function closeKassa(day, me) {
    const st = await kassaState(day);
    const mine = st.notes.filter((r) => r.lines.kassa.date === day && r.lines.user_id === me.user.id).sort((a, b) => String(b.lines.updated_at || "").localeCompare(String(a.lines.updated_at || "")))[0];
    const sv = st.saved || {};
    const lines = { title: "Kassa " + dt(day), text: st.rep.text, color: "#3ddc7d", pinned: false, shared: mine ? !!mine.lines.shared : false, user_id: me.user.id, author: me.name, updated_at: now().toISOString(),
      kassa: { date: day, open: st.open, openManual: !!sv.openManual, close: st.rep.close, conv: sv.conv || [], pick: st.pick, manual: sv.manual || [] } };
    if (mine) await db.update("requests", "id=eq." + mine.id, { lines: { ...mine.lines, ...lines, color: mine.lines.color || lines.color, pinned: !!mine.lines.pinned } });
    else await db.insert("requests", { mode: "te_note", source: "note", lines });
    return !!mine;
  }
  const kcKb = (day) => ({ inline_keyboard: [[{ text: "🧾 Kassani yopish", callback_data: "kc:" + day }]] });
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
    const text = ["💳 <b>Mijozlar qarzi</b>" + (q ? " · «" + esc(q) + "»" : "") + ": <b>" + usd(total) + "</b>", "", ...list, rows.length > 20 ? "… yana " + (rows.length - 20) + " ta" : ""].filter((x) => x !== "").join("\n");
    // «📤» — готовый текст клиенту о долге
    const kb = rows.filter((r) => r.f.clientDebt > 0.004).slice(0, 8).map((r) => [{ text: cut("📤 " + (r.o.name || "—") + " — " + usd(r.f.clientDebt), 60), callback_data: "mx:" + r.o.id }]);
    return kb.length ? { text, reply_markup: { inline_keyboard: kb } } : text;
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
    const kb = [[...(money$(acc) ? [{ text: "💳 To'lovlar", callback_data: "op:" + o.id }] : []), { text: "📦 Materiallar", callback_data: "om:" + o.id }]];
    if (money$(acc)) {
      const f = C.calcObject(o, data.finance_ops);
      kb.push([{ text: "➕ To'lov qo'shish", callback_data: "pa:" + o.id }, { text: "📄 Excel", callback_data: "ox:" + o.id }]);
      if (f.clientDebt > 0.004) kb.push([{ text: "📤 Mijozga xabar", callback_data: "mx:" + o.id }]);
    }
    kb.push([{ text: "⬅️ Orqaga", callback_data: "ol" }]);
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
      else if (cmd.name === "kassa") { const d0 = parseDay(cmd.arg, day); return send(chatId, cut(await kassa(d0), 4000), { reply_to_message_id: msg.message_id, reply_markup: kcKb(d0) }); }
      else if (cmd.name === "bugun") text = await today(parseDay(cmd.arg, day));
      else if (cmd.name === "qarz") { const r = await debts(cmd.arg); if (typeof r !== "string") return send(chatId, cut(r.text, 4000), { reply_to_message_id: msg.message_id, reply_markup: r.reply_markup }); text = r; }
      else if (cmd.name === "postavshik") text = await supDebts(cmd.arg);
      else if (cmd.name === "obyekt") { const v = objList(await loadData(["objects"]), cmd.arg); return send(chatId, v.text, { reply_markup: v.reply_markup }); }
      else if (cmd.name === "dostavka") { const v = delivList(await loadData(["objects"])); return send(chatId, v.text, { reply_markup: v.reply_markup }); }
      else if (cmd.name === "eslat") return remind(chatId, msg, cmd.arg, me);
      else if (cmd.name === "q") { if (!cmd.arg) return ask(chatId, PROMPTS.find((x) => x.name === "q")); const v = await search(cmd.arg, acc); return send(chatId, cut(v.text, 4000), { reply_to_message_id: msg.message_id, ...(v.reply_markup ? { reply_markup: v.reply_markup } : {}) }); }
      else if (cmd.name === "hafta" || cmd.name === "oy") text = await period(cmd.name, acc);
      else if (cmd.name === "kurs") text = await kurs(cmd.arg, me);
      else if (!smeta && ["smeta", "qoida", "eslab"].includes(cmd.name)) text = "📋 Smeta, qoidalar va postavshik xotirasi — alohida botda: " + SMETA_BOT;
      else if (cmd.name === "smeta") {
        if (!cmd.arg) return send(chatId, SMETA_MARK + " ro'yxatni yuboring — matn, rasm yoki PDF.\nPostavshikni yozsangiz, o'shandan hisoblayman (masalan: <i>Water Pro dan</i>).", { reply_markup: { force_reply: true, input_field_placeholder: "truba PPR 20 — 50 m, kran 1/2 — 10 ta…" } });
        return smetaFromText(msg, me, cmd.arg);
      }
      else if (cmd.name === "nakladnoy") {
        if (!canNak(acc)) return send(chatId, "🔒 Bu bo'lim sizga ochilmagan.");
        return send(chatId, NAK_MARK + " nakladnoy rasmini yoki PDF faylini shu xabarga javob qilib yuboring.", { reply_markup: { force_reply: true, input_field_placeholder: "rasm yoki PDF" } });
      }
      else if (cmd.name === "tekshir") { try { return await reconcile(chatId, me, parseDay(cmd.arg, addDays(day, -30)), null); } catch (e) { text = "⚠️ Solishtirib bo'lmadi: " + esc(String(e.message || e)).slice(0, 200); } }
      else if (cmd.name === "qoida") return rulesList(chatId, me);
      else if (cmd.name === "eslab") { if (!cmd.arg) return send(chatId, "Masalan: <code>/eslab PPR truba — Akfa dan, nasos — Wilo dan</code>"); return teachRule(msg, me, cmd.arg); }
      else if (cmd.name === "yangi") { await memClear(chatId); text = "🧹 Suhbat yangidan boshlandi — oldingi gaplar unutildi."; }
      else if (cmd.name === "ovoz") {
        if (!voice || !voice.tts) text = "🔇 Ovozli javob uchun ovoz xizmati ulanmagan.";
        else { const on = await memVoice(chatId, me); text = on ? "🔊 Endi javoblar ovoz bilan ham keladi. O'chirish: /ovoz" : "🔇 Ovozli javob o'chirildi — faqat ovozli xabaringizga ovoz bilan javob beraman. Yoqish: /ovoz"; }
      }
      else if (cmd.name === "narx" || cmd.name === "sklad") {
        if (!cmd.arg) return ask(chatId, PROMPTS.find((x) => x.name === cmd.name));
        text = cmd.name === "narx" ? await prices(cmd.arg, acc) : await stock(cmd.arg);
      }
      else return;
    } catch (e) { text = "⚠️ Hisoblab bo'lmadi: " + esc(String(e.message || e)).slice(0, 300); }
    if (text.length > 4000) text = text.slice(0, 3990) + "\n…";
    return send(chatId, text, { reply_to_message_id: msg.message_id });
  }
  // ---------- оплата клиента из бота ----------
  const PAY_M = ["usd", "uzs", "card", "transfer"];
  const PAY_UZ = { usd: "naqd $", uzs: "naqd so'm", card: "karta", transfer: "perechisleniye" };
  const OBJ_URL = "https://thermo-ai-os.vercel.app/#o=";
  const payMethodOf = (text, cur) => { const h = guessMethod(text); return h === "card" ? "card" : h === "transfer" ? "transfer" : cur === "uzs" ? "uzs" : "usd"; };
  async function payView(o, text, mi, rate0) {
    const a = findAmount(text); if (!a) return null;
    const m = PAY_M[mi] || "usd";
    const cur = m === "usd" ? "usd" : m === "uzs" ? "uzs" : a.cur;
    const rate = cur === "uzs" ? findRate(text) || rate0 || (await lastRate()) : 0;
    const usdAmt = cur === "usd" ? C.round2(a.v) : rate >= 1000 ? C.round2(a.v / rate) : 0;
    const t = ["💳 <b>To'lov</b> · " + esc(o.name || "—") + (o.client ? " (" + esc(o.client) + ")" : ""),
      "<b>" + (cur === "uzs" ? sum(a.v) : usd(a.v)) + "</b>" + (cur === "uzs" ? (usdAmt ? " ≈ " + usd(usdAmt) + " (kurs " + C.fmtDot(rate) + ")" : " · ⚠️ kurs topilmadi") : "") + " · " + PAY_UZ[m],
      usdAmt ? "Kiritaymi?" : "Kursni qo'shib qayta yozing: <code>… kurs 12 600</code>"].join("\n");
    const kb = usdAmt ? [[{ text: "✅ Kiritish", callback_data: "pk:" + o.id + ":" + mi }, { text: "❌ Yo'q", callback_data: "px" }], [{ text: "🔁 Usul: " + PAY_UZ[PAY_M[(mi + 1) % 4]], callback_data: "pm:" + o.id + ":" + ((mi + 1) % 4) }]] : [[{ text: "❌ Yo'q", callback_data: "px" }]];
    return { text: t, reply_markup: { inline_keyboard: kb }, a, cur, rate, usdAmt, m };
  }
  async function payReply(msg, rq, me) {
    const link = (rq.entities || []).map((e) => e.url || "").find((u) => u.startsWith(OBJ_URL));
    const id = link && link.slice(OBJ_URL.length);
    const data = await loadData(["objects"]);
    const o = id && data.objects.find((x) => x.id === id);
    if (!o) return send(msg.chat.id, "Obyekt topilmadi.");
    const a = findAmount(msg.text);
    if (!a) return send(msg.chat.id, "Summa topilmadi. Masalan: <code>500$</code>, <code>1 200 000 so'm karta</code>", { reply_to_message_id: msg.message_id });
    const v = await payView(o, msg.text, PAY_M.indexOf(payMethodOf(msg.text, a.cur)));
    return send(msg.chat.id, v.text, { reply_to_message_id: msg.message_id, reply_markup: v.reply_markup });
  }
  async function payDo(cq, me, oid, mi, ans, edit) {
    const m = cq.message, orig = m.reply_to_message;
    if (!orig || !orig.text) { await edit("⚠️ Asl xabar o'chirilgan — kiritilmadi."); return ans(); }
    const key = "tgpay:" + m.chat.id + ":" + orig.message_id;
    const done = await db.select("audit_log", "action=eq." + LOG_MODE + "&entity=eq." + encodeURIComponent(key) + "&select=detail&limit=1");
    if (done.length) return ans("Allaqachon kiritilgan", true);
    const o = (await db.select("objects", "id=eq." + oid + "&select=id,name,client,status"))[0];
    if (!o) { await edit("Obyekt topilmadi (o'chirilgan)."); return ans(); }
    const v = await payView(o, orig.text, mi);
    if (!v || !(v.usdAmt > 0)) return ans("Summa yoki kurs topilmadi", true);
    const pay = { method: v.m, cur: v.cur, usd: v.cur === "usd" ? v.a.v : "", uzs: v.cur === "uzs" ? v.a.v : "", rate: v.cur === "uzs" ? v.rate : "" };
    const row = { type: "client_payment", object_id: o.id, ...C.payPatch(pay, "client_payment", false), op_date: tzDate(now()), note: "Telegram", user: me.name, user_name: me.name };
    let op;
    try { op = (await db.insert("finance_ops", row))[0]; } catch (e) { return ans("Xato: " + String(e.message || e).slice(0, 150), true); }
    const amt = v.cur === "uzs" ? sum(v.a.v) + " (" + usd(v.usdAmt) + ")" : usd(v.a.v);
    const ts = now().toISOString();
    try { await db.insert("audit_log", [{ action: "Telegram: оплата клиента", entity: "object:" + (o.name || ""), detail: amt.replace(/so'm/g, "сум") + " · " + PAY_UZ[v.m] + " · " + me.name, user_name: me.name, role: "telegram", ts }, { action: LOG_MODE, entity: key, detail: (op && op.id) || "", user_name: me.name, role: "telegram", ts }]); } catch (e) {}
    await edit("✅ <b>To'lov kiritildi</b> · " + esc(o.name || "") + "\n" + amt + " · " + PAY_UZ[v.m] + " · " + dt(row.op_date) + "\nKiritdi: " + esc(me.name),
      { inline_keyboard: [[...(op && op.id ? [{ text: "↩️ Bekor qilish", callback_data: "undo:" + op.id }] : []), { text: "⬅️ Obyektga", callback_data: "o:" + o.id }]] });
    return ans("Kiritildi");
  }
  // ---------- готовый текст клиенту о долге ----------
  async function clientMsg(o, data) {
    const f = C.calcObject(o, data.finance_ops);
    if (!(f.clientDebt > 0.004)) return null;
    const rate = await lastRate();
    return ["Assalomu alaykum" + (o.client ? ", " + esc(o.client) : "") + "!", "", "«" + esc(o.name || "") + "» obyekti bo'yicha to'lanmagan qoldiq: <b>" + usd(f.clientDebt) + "</b>" + (rate >= 1000 ? " (≈ " + sum(Math.round(f.clientDebt * rate / 1000) * 1000) + ")" : "") + ".", "", "Hurmat bilan, Thermo Engineering"].join("\n");
  }
  // ---------- доставка ----------
  const pendingItems = (o) => (Array.isArray(o.items) ? o.items : []).filter((i) => i && !i.from_warehouse && !C.isShipped(i));
  function delivList(data) {
    const list = data.objects.filter((o) => C.isLive(o) && o.status !== "closed" && pendingItems(o).length)
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 20);
    return { text: list.length ? "🚚 <b>Yetkazish kerak</b>: " + list.length + " ta obyekt" : "✅ Hammasi yetkazilgan.",
      reply_markup: { inline_keyboard: list.map((o) => [{ text: cut((o.name || "—") + " · " + pendingItems(o).length + " poz." + (o.address ? " · " + o.address : ""), 60), callback_data: "dv:" + o.id }]) } };
  }
  function delivCard(o, data) {
    const m = (data.masters || []).find((x) => x.id === o.master_id);
    const pend = pendingItems(o), batches = C.objBatches(o);
    const sn = new Map((data.suppliers || []).map((x) => [x.id, x.name]));
    const lines = ["🚚 <b>" + esc(o.name || "—") + "</b>", "Manzil: " + esc(o.address || "—"), "Mijoz: " + esc([o.client, o.phone].filter(Boolean).join(", ") || "—"),
      "Usta: " + esc([(m && m.name) || o.master, m && m.phone].filter(Boolean).join(", ") || "—")];
    const kb = [];
    const withPend = batches.filter((b) => b.items.some((i) => pend.includes(i)));
    withPend.forEach((b) => {
      lines.push("", "📦 <b>" + b.no + "-postavka</b>" + (b.date ? " · " + dt(String(b.date).slice(0, 10)) : ""));
      const g = new Map(); b.items.filter((i) => pend.includes(i)).forEach((i) => { const k = sn.get(i.supplier_id) || "—"; if (!g.has(k)) g.set(k, []); g.get(k).push(i); });
      g.forEach((items, k) => { lines.push("<i>" + esc(k) + "</i>"); items.forEach((i) => lines.push("• " + esc(cut(i.name, 70)) + " — <b>" + C.fmt(Number(i.qty) || 0) + " " + esc(i.unit || "шт") + "</b>")); });
      if (withPend.length > 1) kb.push([{ text: "✅ " + b.no + "-postavka yetkazildi", callback_data: "ds:" + o.id + ":" + b.no }]);
    });
    if (!pend.length) lines.push("", "✅ Hammasi yetkazilgan.");
    else kb.push([{ text: "✅ Hammasi yetkazildi (" + pend.length + ")", callback_data: "ds:" + o.id + ":0" }]);
    kb.push([{ text: "⬅️ Ro'yxat", callback_data: "dl" }]);
    let text = lines.join("\n"); if (text.length > 3900) text = text.slice(0, 3890) + "\n…";
    return { text, reply_markup: { inline_keyboard: kb } };
  }
  async function delivDo(o, no, me) {
    const fresh = (await db.select("objects", "id=eq." + o.id + "&select=id,name,items"))[0];
    if (!fresh) return 0;
    const day = tzDate(now());
    const inBatch = (i) => !no || (Number(i.batch_no) || 1) === no;
    let n = 0;
    const items = (Array.isArray(fresh.items) ? fresh.items : []).map((i) => { if (i && !i.from_warehouse && !C.isShipped(i) && inBatch(i)) { n++; return { ...i, shipped: true, shipped_date: day }; } return i; });
    if (!n) return 0;
    await db.update("objects", "id=eq." + o.id, { items });
    try { await db.insert("audit_log", { action: "Товар отгружен (доставщик)", entity: "object:" + (fresh.name || ""), detail: "позиций: " + n + ", дата: " + dt(day) + " · Telegram", user_name: me.name, role: "telegram", ts: now().toISOString() }); } catch (e) {}
    return n;
  }
  // ---------- напоминания ----------
  async function remind(chatId, msg, arg, me) {
    if (!arg) {
      const rows = (await db.select("requests", "mode=eq." + REMIND_MODE + "&select=id,lines")).filter((r) => r.lines && String(r.lines.tg) === String(chatId)).sort((a, b) => String(a.lines.at).localeCompare(String(b.lines.at)));
      const when = (iso) => dt(tzDate(new Date(iso))) + " " + tzTime(new Date(iso));
      if (!rows.length) return send(chatId, "⏰ Eslatmalar yo'q.\nMasalan: <code>/eslat 15:00 Gulnoraga qo'ng'iroq</code>, <code>/eslat ertaga 10:00 …</code>, <code>/eslat 30 daqiqa …</code>");
      return send(chatId, "⏰ <b>Eslatmalar</b>\n\n" + rows.map((r) => "• " + when(r.lines.at) + " — " + esc(r.lines.text)).join("\n"), { reply_markup: { inline_keyboard: rows.slice(0, 10).map((r) => [{ text: cut("❌ " + tzTime(new Date(r.lines.at)) + " " + r.lines.text, 60), callback_data: "rd:" + r.id }]) } });
    }
    const r = parseRemind(arg, now());
    if (!r) return send(chatId, "Vaqtni tushunmadim. Masalan: <code>/eslat 15:00 matn</code>, <code>/eslat ertaga 10:00 matn</code>, <code>/eslat 05.11 9:00 matn</code>, <code>/eslat 30 daqiqa matn</code>", { reply_to_message_id: msg.message_id });
    const row = (await db.insert("requests", { mode: REMIND_MODE, source: "config", lines: { tg: String(chatId), user_id: me.user.id, at: r.at.toISOString(), text: r.text.slice(0, 500) } }))[0];
    return send(chatId, "⏰ Eslatma qo'yildi: <b>" + dt(tzDate(r.at)) + " " + tzTime(r.at) + "</b>\n" + esc(r.text), { reply_to_message_id: msg.message_id, reply_markup: row && row.id ? { inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "rd:" + row.id }]] } : undefined });
  }
  // ---------- поиск везде ----------
  async function search(q, acc) {
    const need = []; const can = (n) => canAsk(acc, n);
    if (can("obyekt")) need.push("objects");
    const data = await loadData(need);
    const [prods, sups, wh] = await Promise.all([can("narx") ? db.all("products", "", "id,name,brand,size,unit,cost,price,supplier_id,status") : [], can("narx") || can("postavshik") || can("sklad") ? db.all("suppliers", "", "id,name") : [], can("sklad") ? db.all("warehouse", "", "id,name,qty,unit,supplier_id,product_id") : []]);
    const sn = new Map(sups.map((x) => [x.id, x.name]));
    const out = ["🔍 <b>«" + esc(q) + "»</b>"], kb = [];
    if (data.objects) {
      const ob = data.objects.filter((o) => hitAll(hay([o.name, o.client, o.phone, o.master, o.address]), q));
      if (ob.length) { out.push("", "🏠 <b>Obyektlar</b>: " + ob.length + " ta" + (ob.length > 6 ? " (birinchi 6 tasi — tugmalarda)" : "")); ob.slice(0, 6).forEach((o) => kb.push([{ text: cut((o.name || "—") + (o.client ? " · " + o.client : ""), 60), callback_data: "o:" + o.id }])); }
    }
    if (prods.length) {
      const fin = acc.base === "boss" || !!(acc.perms && acc.perms.fin);
      const val = (p) => (fin ? Number(p.cost) || 0 : C.retailOf(p));
      const pl = prods.filter((p) => p.status !== "archive" && hitAll(hay([p.name, p.brand, p.size, sn.get(p.supplier_id)]), q));
      if (pl.length) { out.push("", "💲 <b>Tovarlar</b>: " + pl.length + " ta"); pl.slice(0, 5).forEach((p) => out.push("• " + esc(cut(p.name, 70)) + " — " + esc(sn.get(p.supplier_id) || "—") + " · " + (val(p) > 0 ? usd(val(p)) : "—"))); if (pl.length > 5) out.push("… to'liq: <code>/narx " + esc(q) + "</code>"); }
    }
    if (can("postavshik")) {
      const sl = sups.filter((x) => hitAll(hay([x.name]), q));
      if (sl.length) { out.push("", "🚚 <b>Postavshiklar</b>"); sl.slice(0, 5).forEach((x) => out.push("• " + esc(x.name) + " — <code>/postavshik " + esc(x.name) + "</code>")); }
    }
    if (wh.length) {
      const wl = wh.filter((w) => Number(w.qty) > 0 && hitAll(hay([w.name]), q));
      if (wl.length) { out.push("", "📦 <b>Skladda</b>"); wl.slice(0, 5).forEach((w) => out.push("• " + esc(cut(w.name, 70)) + " — " + C.fmt(Number(w.qty)) + " " + esc(w.unit || "шт"))); }
    }
    if (out.length === 1) out.push("", "Hech narsa topilmadi.");
    return { text: out.join("\n"), reply_markup: kb.length ? { inline_keyboard: kb } : null };
  }
  // ---------- неделя / месяц ----------
  async function period(kind, acc) {
    const day = tzDate(now());
    const from = kind === "oy" ? day.slice(0, 8) + "01" : addDays(day, -((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7));
    const data = await loadData(["finance_ops"]);
    const ops = data.finance_ops.filter((x) => !x.voided && String(x.op_date || x.created_at || "").slice(0, 10) >= from && String(x.op_date || x.created_at || "").slice(0, 10) <= day);
    const salary = acc.base === "boss" || !!(acc.perms && acc.perms.salary);
    const sumT = (f) => C.round2(ops.filter(f).reduce((a, x) => a + (Number(x.amount) || 0), 0));
    const inCl = sumT((x) => x.type === "client_payment"), inCo = sumT((x) => x.type === "company_income");
    const outSup = sumT((x) => x.type === "supplier_payment"), outObj = sumT((x) => x.type === "expense"), outBon = sumT((x) => x.type === "bonus_payment");
    const exp = ops.filter((x) => x.type === "company_expense"), byCat = new Map();
    exp.forEach((x) => { const c = !salary && x.category === C.SALARY_CAT ? "Boshqa" : x.category || "Прочее"; byCat.set(c, (byCat.get(c) || 0) + (Number(x.amount) || 0)); });
    const outCo = C.round2(exp.reduce((a, x) => a + (Number(x.amount) || 0), 0));
    const tin = C.round2(inCl + inCo), tout = C.round2(outSup + outObj + outBon + outCo);
    const L = ["📈 <b>" + (kind === "oy" ? "Shu oy" : "Shu hafta") + "</b> · " + dt(from) + " — " + dt(day), "",
      "➕ <b>Kirim: " + usd(tin) + "</b>", "• mijozlardan: " + usd(inCl), ...(inCo ? ["• kompaniya prixodi: " + usd(inCo)] : []), "",
      "➖ <b>Chiqim: " + usd(tout) + "</b>", ...(outSup ? ["• postavshiklarga: " + usd(outSup)] : []), ...(outObj ? ["• obyekt rasxodlari: " + usd(outObj)] : []), ...(outBon ? ["• ustalarga bonus: " + usd(outBon)] : []),
      ...(outCo ? ["• kompaniya rasxodlari: " + usd(outCo)] : []), ...[...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, v]) => "   · " + esc(c) + ": " + usd(v)), "",
      "<b>Sof: " + (tin - tout >= 0 ? "+" : "−") + usd(Math.abs(tin - tout)) + "</b>"];
    return L.join("\n");
  }
  // ---------- курс ----------
  async function kurs(arg, me) {
    const cur = await lastRate();
    if (!arg) { const sr = await setRate(); return "💱 <b>Kurs: " + (cur ? C.fmtDot(cur) + " so'm" : "topilmadi") + "</b>" + (sr && sr.lines && sr.lines.by ? "\n(" + esc(sr.lines.by) + ", " + dt(tzDate(new Date(sr.lines.at))) + ")" : "") + "\nYangi kurs: <code>/kurs 12 650</code>"; }
    if (!(me.acc.base === "boss" || (me.acc.perms && me.acc.perms.fin))) return "🔒 Kursni faqat rahbar yoki moliya huquqi bor odam o'zgartiradi.";
    let r = toNum(String(arg).replace(/[^\d.,\s]/g, "").trim()); if (r > 0 && r < 100) r = Math.round(r * 1000);
    if (!(r >= 1000 && r < 100000)) return "Kursni so'mda yozing: <code>/kurs 12 650</code>";
    const sr = await setRate(), lines = { rate: r, at: now().toISOString(), by: me.name };
    if (sr) await db.update("requests", "id=eq." + sr.id, { lines }); else await db.insert("requests", { mode: RATE_MODE, source: "config", lines });
    try { await db.insert("audit_log", { action: "Telegram: курс", entity: "rate", detail: C.fmtDot(r) + " сум · " + me.name, user_name: me.name, role: "telegram", ts: now().toISOString() }); } catch (e) {}
    return "✅ Kurs: <b>" + C.fmtDot(r) + " so'm</b> — bot bundan keyin shu kurs bilan hisoblaydi.";
  }
  // ---------- ИИ ----------
  const untag = (t) => String(t || "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const WEEK_UZ = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
  const fin$ = (acc) => !!acc && (acc.base === "boss" || !!(acc.perms && acc.perms.fin));
  const canNak = (acc) => (canAsk(acc, "obyekt") && money$(acc)) || canAsk(acc, "sklad");
  const r4 = (x) => Math.round((Number(x) || 0) * 1e4) / 1e4;
  const typing = (chatId, action = "typing") => tg("sendChatAction", { chat_id: chatId, action }).catch(() => {});
  // смета: сначала бесплатный Gemini (если подключён), не получилось — Claude (в пределах лимита)
  const canRead = async () => !!reader || (!!ai && (await aiState()).ok);
  async function readJson(args) {
    if (reader) { try { const r = await reader.json(args); if (r) return r; } catch (e) { console.error("tg gemini:", e && e.message); } }
    if (ai && (await aiState()).ok) return ai.json(args);
    return null;
  }

  // ---- лимит расходов ИИ в месяц (Аккаунты → Telegram-бот) ----
  async function aiState() {
    let rows = [];
    try { rows = await db.select("requests", "mode=in.(" + CFG_MODE + "," + AIU_MODE + ")&select=id,mode,lines"); } catch (e) { rows = []; }
    const c = rows.find((r) => r.mode === CFG_MODE), u = rows.find((r) => r.mode === AIU_MODE);
    const cf = aiCfg(c && c.lines), month = tzDate(now()).slice(0, 7);
    const spent = u && u.lines && u.lines.month === month ? Number(u.lines.usd) || 0 : 0;
    return { cfg: cf, spent, ok: spent < cf.limit };
  }
  const meterNew = () => { const m = { claude: 0, speech: 0, calls: 0, sec: 0, chars: 0 }; m.fn = (c) => { m.claude += c; m.calls++; }; return m; };
  async function spend(m, me) {
    const cl = m.claude, sp = m.speech, calls = m.calls, sec = m.sec, chars = m.chars, add = r4(cl + sp);
    if (!(add > 0)) return;
    m.claude = 0; m.speech = 0; m.calls = 0; m.sec = 0; m.chars = 0; // один счётчик не записывается дважды
    try {
      const month = tzDate(now()).slice(0, 7);
      const u = (await db.select("requests", "mode=eq." + AIU_MODE + "&select=id,lines&limit=1"))[0];
      const old = u && u.lines && typeof u.lines === "object" && !Array.isArray(u.lines) ? u.lines : {};
      const prev = old.month && old.month !== month ? Object.fromEntries(Object.entries({ ...(old.prev || {}), [old.month]: r4(old.usd) }).slice(-6)) : old.prev || {};
      const cur = old.month === month ? old : { month, usd: 0, claude: 0, speech: 0, calls: 0, sec: 0, chars: 0, users: {}, prev };
      const users = { ...(cur.users || {}) };
      if (me && me.user) users[me.user.id] = r4((users[me.user.id] || 0) + add);
      const lines = { ...cur, usd: r4((cur.usd || 0) + add), claude: r4((cur.claude || 0) + cl), speech: r4((cur.speech || 0) + sp), calls: (cur.calls || 0) + calls, sec: Math.round((cur.sec || 0) + sec), chars: (cur.chars || 0) + chars, users, at: now().toISOString() };
      if (u) await db.update("requests", "id=eq." + u.id, { lines }); else await db.insert("requests", { mode: AIU_MODE, source: "config", lines });
    } catch (e) { console.error("tg ai usage:", e && e.message); }
  }
  const LIMIT_MSG = (st) => "⚠️ AI'ning oylik limiti tugadi (" + usd(st.cfg.limit) + ") — rahbar dasturda oshirishi mumkin: <b>Аккаунты → Telegram-бот</b>. Buyruqlar ishlayveradi — /yordam";

  // ---- память диалога: последние 12 реплик за 6 часов; в базе хранится только зашифрованной ----
  const MEM_TTL = 6 * 3600e3, MEM_N = 12;
  let memK = null;
  const memKeyP = () => memK || (memK = memKey ? crypto.subtle.digest("SHA-256", new TextEncoder().encode("thermo-mem:" + memKey)).then((h) => crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"])) : Promise.resolve(null));
  async function seal(obj) {
    const k = await memKeyP(); if (!k) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return b64(out);
  }
  async function unseal(s) {
    try {
      const k = await memKeyP(); if (!k || !s) return null;
      const u = unb64(s);
      return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(0, 12) }, k, u.subarray(12))));
    } catch (e) { return null; }
  }
  async function memRow(chatId) { const rows = await db.select("requests", "mode=eq." + MEM_MODE + "&select=id,lines"); return rows.find((r) => r.lines && String(r.lines.tg) === String(chatId)) || null; }
  async function memLoad(chatId, me) {
    try {
      const row = await memRow(chatId);
      if (!row) return { row: null, turns: [], voice: false };
      const mine = row.lines.user_id === me.user.id;
      const d = mine && now().getTime() - Date.parse(row.lines.at || 0) < MEM_TTL ? await unseal(row.lines.enc) : null;
      return { row, turns: d && Array.isArray(d.t) ? d.t : [], voice: mine && !!row.lines.voice };
    } catch (e) { return { row: null, turns: [], voice: false }; }
  }
  async function memSave(chatId, me, mem, turn) {
    try {
      const enc = await seal({ t: [...mem.turns, turn].slice(-MEM_N) });
      if (!enc) return;
      const lines = { tg: String(chatId), user_id: me.user.id, at: now().toISOString(), enc, voice: !!mem.voice };
      if (mem.row) await db.update("requests", "id=eq." + mem.row.id, { lines }); else await db.insert("requests", { mode: MEM_MODE, source: "config", lines });
    } catch (e) { console.error("tg mem:", e && e.message); }
  }
  async function memClear(chatId) {
    const row = await memRow(chatId); if (!row) return;
    if (row.lines.voice) await db.update("requests", "id=eq." + row.id, { lines: { ...row.lines, enc: "" } }); else await db.del("requests", "id=eq." + row.id);
  }
  async function memVoice(chatId, me) {
    const row = await memRow(chatId);
    const mine = !!row && row.lines.user_id === me.user.id;
    const on = !(mine && row.lines.voice);
    const lines = { ...(row ? row.lines : {}), tg: String(chatId), user_id: me.user.id, voice: on, ...(mine ? {} : { enc: "", at: now().toISOString() }) };
    if (row) await db.update("requests", "id=eq." + row.id, { lines }); else await db.insert("requests", { mode: MEM_MODE, source: "config", lines });
    return on;
  }

  // «/taksiga ellik ming berdim» — сумма словами: ИИ достаёт сумму, валюту, приход/расход, статью
  async function aiMoney(text, m) {
    const j = await ai.json({ system: ["Extract one money operation from a short message of a company's expense chat in Uzbekistan (Uzbek Latin/Cyrillic or Russian).",
      "Reply with JSON only: {\"ok\":true,\"amount\":number,\"currency\":\"uzs\"|\"usd\",\"direction\":\"out\"|\"in\",\"category\":\"<exact name from a list>\",\"method\":\"cash\"|\"card\"|\"transfer\"} or {\"ok\":false} when there is no clear amount of money.",
      "Words: ming/минг/тысяча = 1000, mln/million/миллион = 1 000 000, yarim = 0.5, so'm/сум = UZS, $/dollar = USD; a number ≥ 1000 without currency is UZS. direction in only for money received (prixod, kirim, tushdi, keldi, qarz qaytardi).",
      "Expense categories: " + expCats().join(" | "), "Income categories: " + incCats().join(" | ")].join("\n"), text: slashText(text), meter: m && m.fn });
    if (!j || !j.ok || !(Number(j.amount) > 0)) return null;
    const dir = j.direction === "in" ? "i" : "e", list = dir === "i" ? incCats() : expCats();
    let c = list.indexOf(String(j.category || "")); if (c < 0) c = guessCat(text, dir);
    return { v: Math.round(Number(j.amount) * 100) / 100, cur: j.currency === "usd" ? "usd" : "uzs", dir, method: j.method === "card" || j.method === "transfer" ? j.method : "cash", cat: c, rate: findRate(text), ai: true };
  }
  function aiTools(acc) {
    const T = [];
    const add = (need, name, description, props = {}, required = []) => { if (!need || canAsk(acc, need)) T.push({ name, description, input_schema: { type: "object", properties: props, required } }); };
    const dayP = { day: { type: "string", description: "YYYY-MM-DD (bo'sh — bugun)" } };
    const S = { type: "string" };
    add("kassa", "kassa", "Kassa hisoboti (naqd so'm, $, karta): ostatka, kirim, chiqim, yakun — bir kun uchun.", dayP);
    add("bugun", "day_flow", "Bir kundagi barcha kirim-chiqim operatsiyalari ro'yxati.", dayP);
    add("hafta", "period", "Shu hafta yoki shu oy: kirim, chiqim, rasxodlar turlari bo'yicha, sof natija.", { kind: { type: "string", enum: ["week", "month"] } }, ["kind"]);
    add("hafta", "compare_months", "Oxirgi oylarni solishtirish: kirim (mijozlar, kompaniya), chiqim turlari, kompaniya rasxodlari kategoriyalar bo'yicha, sof oqim" + (fin$(acc) ? ", shu oyda ochilgan obyektlar foydasi" : "") + ". «Nega bu oy foyda/kirim kam?» kabi savollar uchun.", { months: { type: "integer", description: "2–12, odatda 3" } });
    add("hafta", "top_expenses", "Davr ichidagi eng katta chiqimlar (kompaniya rasxodlari, postavshiklarga, obyekt rasxodlari, bonuslar) va kompaniya rasxodlari kategoriyalar bo'yicha.", { from: { type: "string", description: "YYYY-MM-DD (bo'sh — oy boshi)" }, to: { type: "string", description: "YYYY-MM-DD (bo'sh — bugun)" }, limit: { type: "integer" } });
    add("tekshir", "unentered_expenses", "Ishchi guruhda yozilgan, lekin dasturga kiritilmagan rasxod/prixodlarni topadi va foydalanuvchiga belgilab kiritish kartochkasini yuboradi (✅ bilan kiritiladi). from — qaysi sanadan (YYYY-MM-DD).", { from: { type: "string" } });
    add("kurs", "rate", "Joriy dollar kursi (so'm).");
    add("qarz", "client_debts", "Mijozlar qarzi (obyektlar bo'yicha). query — obyekt/mijoz nomi bo'yicha filtr.", { query: S });
    add("postavshik", "supplier_debts", "Postavshiklarga qarzlar. query — postavshik nomi.", { query: S });
    add("obyekt", "find_objects", "Obyektlarni qidirish (nomi, mijoz, telefon, usta, manzil). Natija: id, nomi, mijoz, holati, qarz.", { query: S }, ["query"]);
    add("obyekt", "object_details", "Bitta obyekt: summary — holati va summalar; payments — to'lovlar; materials — postavkalar va tovarlar.", { id: S, part: { type: "string", enum: ["summary", "payments", "materials"] } }, ["id"]);
    if (fin$(acc)) add("obyekt", "object_profit", "Obyektlar foydasi: sotuv, tannarx, foyda, marja %, qarz. sort: margin — eng past marja; profit — eng kam foyda; debt — eng katta qarz.", { sort: { type: "string", enum: ["margin", "profit", "debt"] }, limit: { type: "integer" }, all: { type: "boolean", description: "yopilgan obyektlar ham" } });
    if (money$(acc)) add("obyekt", "client_facts", "Mijozga xabar yozish uchun faktlar: obyekt, mijoz, jami, to'langan, qarz ($ va so'mda), oxirgi to'lov sanasi.", { id: S }, ["id"]);
    if (money$(acc)) add("obyekt", "propose_client_payment", "Mijoz to'lovini kiritish: foydalanuvchiga tasdiqlash kartochkasi yuboriladi, ✅ bosilgandan keyin dasturga yoziladi.", { object_id: S, amount: { type: "number" }, currency: { type: "string", enum: ["usd", "uzs"] }, method: { type: "string", enum: ["cash", "card", "transfer"] }, rate: { type: "number", description: "so'm kursi (agar aytilgan bo'lsa)" } }, ["object_id", "amount", "currency"]);
    add("narx", "product_prices", "Tovar narxlari postavshiklar bo'yicha (arzonidan), skladdagi soni bilan.", { query: S }, ["query"]);
    add("narx", "compare_prices", "Narxlarni solishtirish (40 tagacha tovar): nomi, brend, o'lcham, postavshik, narx, skladda. analogs=true — shu tovarning boshqa postavshiklardagi o'xshashlari.", { query: S, analogs: { type: "boolean" } }, ["query"]);
    add("sklad", "warehouse_stock", "Sklad Thermo'da bor tovarlar va qoldiq.", { query: S }, ["query"]);
    add("dostavka", "deliveries", "Yetkazilmagan tovarlari bor obyektlar va ular.");
    add("dostavka", "propose_delivered", "Obyekt tovarlarini «yetkazildi» deb belgilash: tasdiqlash kartochkasi yuboriladi. batch_no — postavka raqami (bo'sh — hammasi).", { object_id: S, batch_no: { type: "integer" } }, ["object_id"]);
    if (smeta) add("smeta", "make_estimate", "Tovarlar ro'yxatidan smeta: bazadagi tovarlarga moslab narx va jami summa; dasturga import qilinadigan Excel ham yuboriladi. suppliers — qaysi postavshik(lar)dan, foydalanuvchi aytgan tartibda (ixtiyoriy).", { items: { type: "array", items: { type: "object", properties: { name: S, qty: { type: "number" }, unit: S, code: S }, required: ["name"] } }, suppliers: S }, ["items"]);
    add(null, "save_note", "Foydalanuvchining eslab qolinadigan gapini dasturdagi «Заметки»ga saqlash (savol bo'lmasa).", { title: S, text: S }, ["text"]);
    add(null, "set_reminder", "Belgilangan vaqtda Telegram'da eslatma yuborish.", { at: { type: "string", description: "ISO vaqt, Toshkent: 2026-11-02T15:00:00+05:00" }, text: S }, ["at", "text"]);
    return T;
  }
  const TOOL_NEED = { kassa: "kassa", day_flow: "bugun", period: "hafta", compare_months: "hafta", top_expenses: "hafta", rate: "kurs", client_debts: "qarz", supplier_debts: "postavshik", find_objects: "obyekt", object_details: "obyekt", object_profit: "obyekt", client_facts: "obyekt", propose_client_payment: "obyekt", product_prices: "narx", compare_prices: "narx", warehouse_stock: "sklad", deliveries: "dostavka", propose_delivered: "dostavka", make_estimate: "smeta", unentered_expenses: "tekshir" };
  async function aiRun(name, a, me, msg, m) {
    const acc = me.acc, d0 = tzDate(now());
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(a.day || "")) ? a.day : d0;
    const NO = "Bu ma'lumot foydalanuvchiga ochilmagan.";
    if (TOOL_NEED[name] && !canAsk(acc, TOOL_NEED[name])) return NO;
    if (name === "object_profit" && !fin$(acc)) return NO;
    if ((name === "client_facts" || name === "propose_client_payment") && !money$(acc)) return NO;
    if (name === "kassa") return untag(await kassa(day));
    if (name === "day_flow") return untag(await today(day));
    if (name === "period") return untag(await period(a.kind === "month" ? "oy" : "hafta", acc));
    if (name === "compare_months") return compareMonths(Math.min(12, Math.max(2, Number(a.months) || 3)), acc);
    if (name === "top_expenses") return topExpenses(a.from, a.to, Math.min(40, Math.max(5, Number(a.limit) || 15)), acc);
    if (name === "rate") { const r = await lastRate(); return r ? "Kurs: " + r + " so'm" : "Kurs topilmadi"; }
    if (name === "client_debts") { const r = await debts(a.query || ""); return untag(typeof r === "string" ? r : r.text); }
    if (name === "supplier_debts") return untag(await supDebts(a.query || ""));
    if (name === "find_objects") {
      const data = await loadData(["objects", "finance_ops"]);
      const list = data.objects.filter((o) => hitAll(hay([o.name, o.client, o.phone, o.master, o.address]), a.query || ""));
      if (!list.length) return "Topilmadi.";
      return list.slice(0, 15).map((o) => { const f = C.calcObject(o, data.finance_ops); return [o.id, o.name, o.client || "", o.phone || "", C.stById(o.status).label, money$(acc) ? "qarz " + C.round2(f.clientDebt) + " $" : ""].join(" | "); }).join("\n") + (list.length > 15 ? "\n… yana " + (list.length - 15) : "");
    }
    if (name === "object_details") {
      const data = await loadData(["objects", "finance_ops", "masters"]);
      const o = data.objects.find((x) => x.id === a.id);
      if (!o) return "Obyekt topilmadi.";
      const v = a.part === "payments" ? (money$(acc) ? objPays(o, data) : objCard(o, data, acc)) : a.part === "materials" ? objMats(o, acc) : objCard(o, data, acc);
      return untag(v.text);
    }
    if (name === "object_profit") return objProfit(a.sort, Math.min(40, Math.max(5, Number(a.limit) || 15)), !!a.all);
    if (name === "client_facts") return clientFacts(a.id);
    if (name === "propose_client_payment") return proposePay(msg.chat.id, me, a);
    if (name === "product_prices") return untag(await prices(a.query || "", acc));
    if (name === "compare_prices") return comparePrices(a.query || "", !!a.analogs, acc);
    if (name === "warehouse_stock") return untag(await stock(a.query || ""));
    if (name === "deliveries") {
      const data = await loadData(["objects", "masters", "suppliers"]);
      const list = data.objects.filter((o) => C.isLive(o) && o.status !== "closed" && pendingItems(o).length);
      return list.length ? list.slice(0, 10).map((o) => "id " + o.id + "\n" + untag(delivCard(o, data).text)).join("\n\n") : "Hammasi yetkazilgan.";
    }
    if (name === "propose_delivered") return proposeDeliv(msg.chat.id, me, a);
    if (name === "unentered_expenses") {
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(a.from || "")) ? a.from : addDays(d0, -30);
      const r = await reconcile(msg.chat.id, me, from, null);
      return r && r.n ? "Kartochka yuborildi: " + r.n + " ta kiritilmagan topildi; foydalanuvchi belgilab ✅ bosadi." : "Natija foydalanuvchiga yuborildi (kiritilmagani yo'q yoki eski xabarlar uchun eksport fayli kerak).";
    }
    if (name === "make_estimate") return (await estimate(a.items, a.suppliers || "", me, msg.chat.id, m)).summary;
    if (name === "save_note") { await saveNote({ ...msg, text: [a.title, a.text].filter(Boolean).join("\n") }, me); return "Saqlandi (foydalanuvchiga tasdiq va tugmalar yuborildi)."; }
    if (name === "set_reminder") {
      const at = new Date(String(a.at || ""));
      if (isNaN(at) || at.getTime() <= now().getTime()) return "Vaqt noto'g'ri yoki o'tib ketgan.";
      const row = (await db.insert("requests", { mode: REMIND_MODE, source: "config", lines: { tg: String(msg.chat.id), user_id: me.user.id, at: at.toISOString(), text: String(a.text || "").slice(0, 500) } }))[0];
      await send(msg.chat.id, "⏰ Eslatma qo'yildi: <b>" + dt(tzDate(at)) + " " + tzTime(at) + "</b>\n" + esc(a.text || ""), { reply_markup: row && row.id ? { inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "rd:" + row.id }]] } : undefined });
      return "Qo'yildi (foydalanuvchiga tasdiq yuborildi).";
    }
    return "Noma'lum funksiya.";
  }
  // ---- данные для анализа ----
  const opDay = (x) => String(x.op_date || x.created_at || "").slice(0, 10);
  async function compareMonths(n, acc) {
    const fin = fin$(acc), salary = acc.base === "boss" || !!(acc.perms && acc.perms.salary);
    const data = await loadData(fin ? ["finance_ops", "objects"] : ["finance_ops"]);
    const day = tzDate(now()), months = [];
    let y = Number(day.slice(0, 4)), mo = Number(day.slice(5, 7));
    for (let i = 0; i < n; i++) { months.unshift(y + "-" + String(mo).padStart(2, "0")); if (--mo === 0) { mo = 12; y--; } }
    return months.map((mm) => {
      const ops = data.finance_ops.filter((x) => !x.voided && opDay(x).slice(0, 7) === mm);
      const s = (f) => C.round2(ops.filter(f).reduce((a, x) => a + (Number(x.amount) || 0), 0));
      const cats = new Map();
      ops.filter((x) => x.type === "company_expense").forEach((x) => { const c = !salary && x.category === C.SALARY_CAT ? "Boshqa" : x.category || "Прочее"; cats.set(c, (cats.get(c) || 0) + (Number(x.amount) || 0)); });
      const inCl = s((x) => x.type === "client_payment"), inCo = s((x) => x.type === "company_income"), sup = s((x) => x.type === "supplier_payment"), obj = s((x) => x.type === "expense"), bon = s((x) => x.type === "bonus_payment"), co = s((x) => x.type === "company_expense");
      let t = mm + (mm === day.slice(0, 7) ? " (joriy oy, " + Number(day.slice(8)) + "-kungacha)" : "") + ": kirim — mijozlardan " + inCl + " $, kompaniya prixodi " + inCo + " $; chiqim — postavshiklarga " + sup + " $, obyekt rasxodlari " + obj + " $, ustalarga bonus " + bon + " $, kompaniya rasxodlari " + co + " $" + (cats.size ? " (" + [...cats].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, v]) => c + " " + C.round2(v)).join(", ") + ")" : "") + "; sof pul oqimi " + C.round2(inCl + inCo - sup - obj - bon - co) + " $";
      if (fin) {
        const ob = data.objects.filter((o) => C.isLive(o) && String(o.created_at || "").slice(0, 7) === mm).map((o) => C.calcObject(o, data.finance_ops));
        const sale = ob.reduce((a, f) => a + f.saleNet, 0), gross = ob.reduce((a, f) => a + f.gross, 0);
        t += "; shu oyda ochilgan obyektlar: " + ob.length + " ta, sotuv " + C.round2(sale) + " $, foyda " + C.round2(gross) + " $" + (sale > 0 ? " (marja " + C.round2((gross / sale) * 100) + "%)" : "");
      }
      return t;
    }).join("\n");
  }
  async function topExpenses(from, to, limit, acc) {
    const day = tzDate(now());
    const f = /^\d{4}-\d{2}-\d{2}$/.test(from || "") ? from : day.slice(0, 8) + "01", t = /^\d{4}-\d{2}-\d{2}$/.test(to || "") ? to : day;
    const salary = acc.base === "boss" || !!(acc.perms && acc.perms.salary);
    const data = await loadData(["finance_ops", "objects", "suppliers"]);
    const on = new Map(data.objects.map((o) => [o.id, o.name])), sn = new Map(data.suppliers.map((s) => [s.id, s.name]));
    const ops = data.finance_ops.filter((x) => !x.voided && ["company_expense", "supplier_payment", "expense", "bonus_payment"].includes(x.type) && opDay(x) >= f && opDay(x) <= t && (salary || x.category !== C.SALARY_CAT));
    const cats = new Map();
    ops.filter((x) => x.type === "company_expense").forEach((x) => cats.set(x.category || "Прочее", (cats.get(x.category || "Прочее") || 0) + (Number(x.amount) || 0)));
    const tot = ops.reduce((a, x) => a + (Number(x.amount) || 0), 0);
    return [f + " — " + t + ": jami chiqim " + C.round2(tot) + " $",
      "Kompaniya rasxodlari kategoriyalar bo'yicha: " + ([...cats].sort((a, b) => b[1] - a[1]).map(([c, v]) => c + " " + C.round2(v) + " $").join(", ") || "yo'q"),
      "Eng kattalari:", ...ops.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, limit).map((x) => dt(opDay(x)) + " · " + C.opName(x) + " · " + C.round2(x.amount) + " $" + [x.category, on.get(x.object_id), sn.get(x.supplier_id)].filter(Boolean).map((v) => " · " + v).join("") + (x.note ? " · " + cut(x.note, 60) : ""))].join("\n");
  }
  async function objProfit(sort, limit, all) {
    const data = await loadData(["objects", "finance_ops"]);
    const rows = data.objects.filter((o) => C.isLive(o) && (all || o.status !== "closed")).map((o) => ({ o, f: C.calcObject(o, data.finance_ops) })).filter((r) => r.f.saleNet > 0.004);
    rows.sort(sort === "profit" ? (a, b) => a.f.gross - b.f.gross : sort === "debt" ? (a, b) => b.f.clientDebt - a.f.clientDebt : (a, b) => a.f.margin - b.f.margin);
    const S = rows.reduce((a, r) => a + r.f.saleNet, 0), G = rows.reduce((a, r) => a + r.f.gross, 0);
    return ["Obyektlar: " + rows.length + " ta, sotuv " + C.round2(S) + " $, foyda " + C.round2(G) + " $" + (S > 0 ? ", o'rtacha marja " + C.round2((G / S) * 100) + "%" : ""),
      ...rows.slice(0, limit).map((r) => r.o.name + (r.o.client ? " (" + r.o.client + ")" : "") + " · " + C.stById(r.o.status).label + " · sotuv " + C.round2(r.f.saleNet) + " $ · tannarx " + C.round2(r.f.costNet) + " $ · foyda " + C.round2(r.f.gross) + " $ · marja " + C.round2(r.f.margin) + "% · qarz " + C.round2(r.f.clientDebt) + " $ · id " + r.o.id)].join("\n");
  }
  async function comparePrices(q, analogs, acc) {
    const [prods, sups, wh] = await Promise.all([db.all("products", "", "id,code,sku,name,brand,size,unit,cost,price,supplier_id,status"), db.all("suppliers", "", "id,name"), db.all("warehouse", "", "id,product_id,qty")]);
    const act = prods.filter((p) => p.status !== "archive");
    const sn = new Map(sups.map((s) => [s.id, s.name]));
    const wq = new Map(); wh.forEach((w) => { if (w.product_id && Number(w.qty) > 0) wq.set(w.product_id, (wq.get(w.product_id) || 0) + Number(w.qty)); });
    const fin = fin$(acc);
    let list;
    if (analogs) { const base = act.filter((p) => hitAll(hay([p.name, p.brand, p.size]), q))[0]; list = C.buildMatcher(act)(base ? base.name + " " + (base.size || "") : q).map((r) => r.p); if (base && !list.includes(base)) list.unshift(base); }
    else list = act.filter((p) => hitAll(hay([p.name, p.brand, p.size, sn.get(p.supplier_id)]), q));
    if (!list.length) return "Topilmadi.";
    list.sort((a, b) => (C.retailOf(a) || 1e9) - (C.retailOf(b) || 1e9));
    return list.slice(0, 40).map((p) => [p.name, p.brand || "", p.size || "", sn.get(p.supplier_id) || "—", (fin ? "zakup " + C.round2(Number(p.cost) || 0) + " $, " : "") + "sotuv " + C.round2(C.retailOf(p)) + " $", wq.get(p.id) ? "skladda " + C.fmt(wq.get(p.id)) : ""].join(" | ")).join("\n") + (list.length > 40 ? "\n… yana " + (list.length - 40) : "");
  }
  async function clientFacts(id) {
    const data = await loadData(["objects", "finance_ops"]);
    const o = data.objects.find((x) => x.id === id);
    if (!o) return "Obyekt topilmadi.";
    const f = C.calcObject(o, data.finance_ops), rate = await lastRate();
    const last = data.finance_ops.filter((x) => x.object_id === o.id && x.type === "client_payment" && !x.voided).map(opDay).sort().pop();
    return ["Obyekt: " + (o.name || ""), "Mijoz: " + (o.client || "—"), o.address ? "Manzil: " + o.address : "", "Jami summa: " + C.round2(f.saleNet) + " $", "To'langan: " + C.round2(f.paidClient) + " $",
      "Qarz: " + C.round2(f.clientDebt) + " $" + (rate >= 1000 && f.clientDebt > 0 ? " ≈ " + C.fmtDot(Math.round((f.clientDebt * rate) / 1000) * 1000) + " so'm (kurs " + C.fmtDot(rate) + ")" : ""),
      "Oxirgi to'lov: " + (last ? dt(last) : "yo'q"), "Kompaniya: Thermo Engineering"].filter(Boolean).join("\n");
  }
  const AI_SYS = [
    "Sen Thermo Engineering kompaniyasining (Toshkent: isitish, suv ta'minoti, kanalizatsiya montaji) Telegram yordamchisisan. Kompaniya dasturidagi ma'lumotlar bilan ishlaysan.",
    "Qoidalar:",
    "- Raqam va faktlarni faqat funksiyalardan ol, o'zingdan to'qima. Kerakli funksiya yo'q bo'lsa — bu ma'lumot uning akkauntiga ochilmaganini ayt.",
    "- Dasturda summalar $ da; naqd pul so'mda ham bo'ladi.",
    "- Aniq obyekt yoki mijoz haqida so'ralsa: avval find_objects, keyin kerakli funksiya. Oldingi javoblardagi [ ] qavs ichidagi yozuvlar — sening ichki eslatmalaring (id va so'rovlar); ulardan foydalan, foydalanuvchiga ko'rsatma.",
    "- Guruhdagi kiritilmagan rasxodlar haqida so'ralsa (masalan «23-dan beri kiritilmaganlarni kirit») — unentered_expenses: bot guruh xabarlarini o'zi eslab qoladi va kartochka yuboradi. «Qila olmayman» dema.",
    "- Pul kiritish yoki «yetkazildi» belgilash so'ralsa — propose_client_payment / propose_delivered: ular tasdiqlash kartochkasini yuboradi, foydalanuvchi ✅ bosmaguncha hech narsa yozilmaydi. «Kiritildi» dema. Kompaniya rasxodi/prixodi faqat ishchi guruhda «/» bilan yoziladi (masalan /taksi 50 000).",
    "- Mijozga xabar yozish so'ralsa: client_facts dan faktlarni ol va mijozga yuborishga tayyor, xushmuomala xabar yoz (so'ralgan tilda, 3–6 jumla, oxirida «Hurmat bilan, Thermo Engineering» yoki «С уважением, Thermo Engineering»). Ichki ma'lumot (tannarx, foyda, marja, postavshik) mijoz xabariga yozilmaydi.",
    "- Tovarlar ro'yxatidan smeta so'ralsa — bu alohida botda: " + SMETA_BOT + " (ro'yxatni o'sha botga yuborishni ayt). Bitta tovar narxi so'ralsa — product_prices.",
    "- Tahlil savollarida (nega foyda kam, pul qayerga ketdi, qaysi obyekt foydasiz) — compare_months, top_expenses, object_profit dan raqam olib, qisqa xulosa ber: asosiy 2–3 sabab, raqamlar bilan.",
    "- Narx solishtirishda compare_prices: eng arzonini va farqini ayt; analog so'ralsa analogs=true.",
    "- Xabar savol emas, eslab qolinadigan gap (vazifa, g'oya, ma'lumot) bo'lsa — save_note. Belgilangan vaqtda eslatish so'ralsa — set_reminder (vaqt Toshkent, +05:00).",
    "- Javob: foydalanuvchi tilida (odatda o'zbekcha lotin), qisqa, oddiy matn — Markdown, jadval va ** belgilarsiz. Raqamlar: 1 250,50 $.",
    "- save_note, set_reminder, propose_*, make_estimate dan keyin kartochka foydalanuvchiga allaqachon yuborilgan — qo'shimcha javob yozma yoki bitta qisqa jumla yoz.",
  ].join("\n");
  const CARD_TOOLS = ["save_note", "set_reminder", "propose_client_payment", "propose_delivered", "make_estimate", "unentered_expenses"];
  async function aiAnswer(msg, me, opts = {}) {
    const chatId = msg.chat.id;
    const own = !opts.meter, m = opts.meter || meterNew();
    const st = await aiState();
    if (!st.ok) { if (own) await spend(m, me); await saveNote(msg, me); return send(chatId, LIMIT_MSG(st)); }
    typing(chatId);
    const mem = await memLoad(chatId, me);
    const nowD = now(), day = tzDate(nowD);
    const dyn = ["Foydalanuvchi: " + me.name + " (" + (me.acc.label || me.acc.id || "") + "). Bugun " + dt(day) + ", " + WEEK_UZ[dowOf(day)] + ", soat " + tzTime(nowD) + " (Toshkent).",
      opts.spoken ? "Bu xabar ovozdan matnga o'girilgan (so'zlarda xato bo'lishi mumkin — ma'nosiga qarab tushun). Javobing ovoz bilan ham o'qiladi: 1–4 qisqa jumla, ro'yxat va belgilarsiz." : ""].filter(Boolean).join("\n");
    const hist = [];
    mem.turns.forEach((t) => { hist.push({ role: "user", content: String(t.u || "…") }); hist.push({ role: "assistant", content: String(t.a || "…") + (t.x ? "\n[" + t.x + "]" : "") }); });
    const parts = [];
    const rq = msg.reply_to_message;
    if (rq && rq.text) parts.push("(Foydalanuvchi quyidagi xabarga javob yozyapti: «" + cut(untag(rq.text), 1500) + "»)");
    parts.push(String(msg.text || ""));
    let r;
    try { r = await ai.chat({ system: [AI_SYS, dyn], messages: [...hist, { role: "user", content: parts.join("\n\n") }], tools: aiTools(me.acc), runTool: (n, a) => aiRun(n, a, me, msg, m), meter: m.fn }); }
    catch (e) {
      console.error("tg ai:", e && e.message);
      if (own) await spend(m, me);
      return send(chatId, "⚠️ AI javob bermadi" + (e && /^AI (401|403)/.test(e.message || "") ? " (kalit ishlamayapti)" : e && /^AI 429/.test(e.message || "") ? " (juda ko'p so'rov — birozdan keyin)" : "") + ". Buyruqlar ishlayveradi — /yordam", { reply_markup: qkb(me.acc) });
    }
    const t = String(r.text || "").replace(/\*\*/g, "").trim();
    const quiet = r.used.some((u) => CARD_TOOLS.includes(u.name)) && t.length < 160;
    if (t && !quiet) await tg("sendMessage", { chat_id: chatId, text: cut(t, 4000), reply_to_message_id: msg.message_id, disable_web_page_preview: true });
    else if (!t && !r.used.length) await send(chatId, "Tushunmadim. /yordam");
    // голосом: на голосовое — всегда; на текст — если человек включил /ovoz
    if (t && !quiet && voice && voice.tts && upload && st.cfg.speak !== "never" && (opts.spoken || mem.voice)) {
      try {
        typing(chatId, "record_voice");
        const v = await voice.speak(t, st.cfg.voice);
        if (v) { m.speech += v.cost; m.chars += v.chars; await upload("sendVoice", { chat_id: chatId, reply_to_message_id: msg.message_id }, { name: "javob.ogg", bytes: v.bytes, mime: "audio/ogg", field: "voice" }); }
      } catch (e) { console.error("tg tts:", e && e.message); }
    }
    const x = r.used.filter((u) => u.input && (u.input.id || u.input.object_id || u.input.query)).map((u) => u.name + " " + JSON.stringify(u.input)).join("; ").slice(0, 600);
    await memSave(chatId, me, mem, { u: cut(String(msg.text || ""), 1200), a: cut(t || (r.used.length ? "(kartochka yuborildi: " + r.used.map((u) => u.name).join(", ") + ")" : "…"), 1500), x, at: now().toISOString() });
    if (own) await spend(m, me);
  }
  // ---- текст в личном чате: ответ на вопрос бота, иначе ИИ / заметка ----
  async function handleText(msg, me, opts = {}) {
    const rq = msg.reply_to_message, fromBot = rq && rq.from && rq.from.is_bot, rt = fromBot ? String(rq.text || "") : "";
    if (rt.startsWith("💳 To'lov qo'shish")) return payReply(msg, rq, me);
    if (rt.startsWith(OBJ_PICK_MARK)) return actObjSearch(msg, rq, me);
    if (rt.startsWith(NEWOBJ_MARK)) return actNewObj(msg, rq, me);
    if (rt.startsWith(SMETA_MARK)) return smeta ? smetaFromText(msg, me, msg.text, opts.meter) : send(msg.chat.id, "📋 Smeta — alohida botda: " + SMETA_BOT);
    if (rt.startsWith(NAK_MARK)) return send(msg.chat.id, "🧾 Nakladnoyning rasmini yoki PDF faylini yuboring (shu xabarga javob qilib).");
    const pr = fromBot ? PROMPTS.find((x) => rt.startsWith(x.mark)) : null;
    if (pr) return runCommand(msg.chat.id, msg, { name: pr.name, arg: msg.text }, me);
    if (ai) return aiAnswer(msg, me, opts);
    return saveNote(msg, me);
  }
  // ---- голосовые: речь → текст → как обычное сообщение; ответ — и голосом ----
  async function onVoice(msg, me) {
    const chatId = msg.chat.id, v = msg.voice || msg.audio || msg.video_note;
    if (!voice || !file) return send(chatId, "🎙 Ovozli xabarni tushunish uchun ovoz xizmati hali ulanmagan — matn bilan yozing.");
    if ((Number(v.duration) || 0) > 300) return send(chatId, "🎙 5 daqiqagacha bo'lgan ovozli xabar yuboring.");
    if ((Number(v.file_size) || 0) > 20e6) return send(chatId, "🎙 Fayl juda katta.");
    const st = await aiState();
    if (!st.ok) return send(chatId, LIMIT_MSG(st));
    typing(chatId);
    const m = meterNew();
    let r;
    try {
      const f = await file(v.file_id);
      r = await voice.transcribe(f.bytes, { name: msg.video_note ? "video.mp4" : msg.audio ? v.file_name || "audio.mp3" : "voice.ogg", mime: v.mime_type || (msg.video_note ? "video/mp4" : "audio/ogg"), sec: Number(v.duration) || 0 });
    } catch (e) {
      console.error("tg stt:", e && e.message);
      return send(chatId, "⚠️ Ovozli xabarni o'qib bo'lmadi" + (/STT (401|403)/.test((e && e.message) || "") ? " (ovoz kaliti ishlamayapti)" : "") + " — matn bilan yozing.");
    }
    m.speech += r.cost || 0; m.sec += r.sec || 0;
    if (!r.text) { await spend(m, me); return send(chatId, "🎙 Tushunmadim — aniqroq gapiring yoki yozing."); }
    await send(chatId, "🎙 <i>" + esc(cut(r.text, 1500)) + "</i>", { reply_to_message_id: msg.message_id });
    try { return await handleText({ ...msg, text: r.text }, me, { spoken: true, meter: m }); }
    finally { await spend(m, me); }
  }

  // ---------- смета и накладная (фото / PDF / текст) ----------
  function mediaKind(msg) {
    const cap = String(msg.caption || "").trim();
    const pc = cap.startsWith("/") ? parseCommand(cap) : null;
    if (pc && pc.name === "smeta") return "smeta";
    if (pc && pc.name === "nakladnoy") return "nak";
    const rq = msg.reply_to_message, t = rq && rq.from && rq.from.is_bot ? String(rq.text || "") : "";
    return t.startsWith(SMETA_MARK) ? "smeta" : t.startsWith(NAK_MARK) ? "nak" : "auto";
  }
  const IMG = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  function mediaSource(msg) {
    if (msg.photo && msg.photo.length) { const p = msg.photo[msg.photo.length - 1]; return { id: p.file_id, size: p.file_size || 0, mime: "image/jpeg" }; }
    const d = msg.document; if (!d) return null;
    const mt = String(d.mime_type || "").toLowerCase(), nm = String(d.file_name || "").toLowerCase();
    if (mt === "application/pdf" || nm.endsWith(".pdf")) return { id: d.file_id, size: d.file_size || 0, pdf: true };
    if (IMG.includes(mt)) return { id: d.file_id, size: d.file_size || 0, mime: mt };
    if (/\.(jpe?g)$/.test(nm)) return { id: d.file_id, size: d.file_size || 0, mime: "image/jpeg" };
    if (/\.png$/.test(nm)) return { id: d.file_id, size: d.file_size || 0, mime: "image/png" };
    return null;
  }
  const SMETA_SYS = "From the user's message or document (Uzbek/Russian), extract the list of goods for a price estimate (plumbing, heating, construction materials). Reply with JSON only: {\"suppliers\":\"supplier names the user asked to use, in the same order, or empty\",\"items\":[{\"name\":\"item name as written, with size/diameter\",\"qty\":number,\"unit\":\"шт|м|кг|компл|...\",\"code\":\"article/code if written, else empty\"}]}. qty default 1. Keep the original order, do not invent or merge items.";
  const NAK_SYS = "Extract a supplier invoice (накладная / hisob-faktura / счёт) from the image or PDF. Reply with JSON only: {\"supplier\":\"seller company name\",\"number\":\"invoice number or empty\",\"date\":\"YYYY-MM-DD or empty\",\"currency\":\"uzs\"|\"usd\",\"items\":[{\"name\":\"goods name with size\",\"qty\":number,\"unit\":\"шт|м|кг|...\",\"price\":number}],\"total\":number}. price — price per unit (without VAT if both are given). Numbers like «1 250 000,00» → 1250000. Use exactly what is written; do not invent lines.";
  async function onDoc(msg, me, kind) {
    if (kind === "auto" && msg.document && !mediaSource(msg)) return; // Excel, Word и т. п. без подписи — не читаем
    const chatId = msg.chat.id;
    if (!smeta && kind === "smeta") return send(chatId, "📋 Smeta — alohida botda: " + SMETA_BOT + " (rasmni o'sha botga yuboring).");
    if (kind === "auto" ? !canAsk(me.acc, "smeta") && !canNak(me.acc) : kind === "smeta" ? !canAsk(me.acc, "smeta") : !canNak(me.acc)) return send(chatId, "🔒 Bu bo'lim sizga ochilmagan.");
    if (!(ai || (reader && kind === "smeta")) || !file) return send(chatId, "⚠️ Rasm va PDF'ni o'qish uchun AI ulanmagan.");
    if (!(reader && kind === "smeta")) { const st = await aiState(); if (!st.ok) return send(chatId, LIMIT_MSG(st)); }
    const src = mediaSource(msg);
    if (!src) return send(chatId, "Faqat rasm (JPG, PNG) yoki PDF yuboring.");
    if (src.size > 15e6) return send(chatId, "Fayl juda katta — 15 MB gacha.");
    typing(chatId);
    let f;
    try { f = await file(src.id); } catch (e) { console.error("tg file:", e && e.message); return send(chatId, "⚠️ Faylni olib bo'lmadi — qaytadan yuboring."); }
    const block = src.pdf ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(f.bytes) } } : { type: "image", source: { type: "base64", media_type: src.mime, data: b64(f.bytes) } };
    const cap = String(msg.caption || "").replace(/^\/\S+\s*/, "").trim();
    const m = meterNew();
    try {
      // без подписи-команды: накладная поставщика или список товаров — определяет ИИ
      if (kind === "auto") {
        const j = await ai.json({ system: "Look at the image/PDF. Is it a supplier invoice (накладная, счёт-фактура, hisob-faktura: a seller's document with prices and totals) — \"invoice\"; a list of goods/materials to price (request, list, estimate, handwritten list) — \"list\"; or something else — \"other\". Reply with JSON only: {\"type\":\"invoice\"|\"list\"|\"other\"}", content: [block, { type: "text", text: cap || "?" }], maxTokens: 300, meter: m.fn });
        const t = j && j.type;
        kind = t === "invoice" && canNak(me.acc) ? "nak" : t === "list" && canAsk(me.acc, "smeta") ? "smeta" : t === "invoice" && canAsk(me.acc, "smeta") ? "smeta" : t === "list" && canNak(me.acc) ? "nak" : null;
        if (!smeta && kind === "smeta") return send(chatId, t === "list" ? "📋 Bu tovarlar ro'yxati — smeta uchun rasmni " + SMETA_BOT + " ga yuboring." : "Rasmda nakladnoy topilmadi.", { reply_to_message_id: msg.message_id });
        if (!kind) return send(chatId, "Rasmda tovarlar ro'yxati yoki nakladnoy topilmadi.\nSmeta uchun rasm ostiga <code>/smeta</code>, nakladnoy uchun <code>/nakladnoy</code> deb yozing.", { reply_to_message_id: msg.message_id });
      }
      if (kind === "smeta") {
        const j = await readJson({ system: SMETA_SYS, content: [block, { type: "text", text: "Ro'yxat shu faylda." + (cap ? " Izoh: " + cap : "") }], maxTokens: 6000, meter: m.fn });
        if (!j || !Array.isArray(j.items) || !j.items.length) return send(chatId, "📋 Ro'yxatni o'qib bo'lmadi — aniqroq rasm yuboring yoki matn bilan yozing.");
        await estimate(j.items, String(j.suppliers || "") || cap, me, chatId, m);
      } else await nakladnoy(chatId, me, block, cap, m);
    } catch (e) { console.error("tg doc:", e && e.message); await send(chatId, "⚠️ O'qib bo'lmadi: " + esc(String((e && e.message) || e)).slice(0, 200)); }
    finally { await spend(m, me); }
  }
  async function smetaFromText(msg, me, text, meter = null) {
    const chatId = msg.chat.id;
    if (!canAsk(me.acc, "smeta")) return send(chatId, "🔒 Bu bo'lim sizga ochilmagan.");
    const m = meter || meterNew();
    let items = null, hint = "";
    if (await canRead()) {
      typing(chatId);
      try { const j = await readJson({ system: SMETA_SYS, text: String(text || ""), maxTokens: 6000, meter: m.fn }); if (j && Array.isArray(j.items) && j.items.length) { items = j.items; hint = String(j.suppliers || ""); } } catch (e) { console.error("tg smeta:", e && e.message); }
    }
    if (!items) { items = parseList(text); hint = String(text || ""); }
    try { await estimate(items, hint, me, chatId, m); } finally { if (!meter) await spend(m, me); }
  }
  // позиции ↔ товары базы: сначала у названных поставщиков (по порядку), потом во всей базе; спорные — выбирает ИИ
  // постоянная память смет: что брали раньше (объекты программы), выученные «как написали → товар», правила «что у кого брать»
  async function smetaMem() {
    const [rows, objs] = await Promise.all([db.select("requests", "mode=in.(" + MATCH_MODE + "," + RULES_MODE + ")&select=id,mode,lines").catch(() => []), db.all("objects", "", "id,items").catch(() => [])]);
    const mr = rows.find((r) => r.mode === MATCH_MODE), rr = rows.find((r) => r.mode === RULES_MODE);
    const used = new Map();
    objs.forEach((o) => (Array.isArray(o.items) ? o.items : []).forEach((i) => { if (i && i.product_id) used.set(i.product_id, (used.get(i.product_id) || 0) + 1); }));
    return { map: (mr && mr.lines && mr.lines.m) || {}, rules: (rr && rr.lines && Array.isArray(rr.lines.rules) ? rr.lines.rules : []), used, mr, rr };
  }
  async function matchItems(items, hint, supId, m) {
    const [prods, sups, mem] = await Promise.all([db.all("products", "", "id,code,sku,name,brand,size,unit,cost,price,supplier_id,status"), db.all("suppliers", "", "id,name"), smetaMem()]);
    const act = prods.filter((p) => p.status !== "archive");
    const pById = new Map(act.map((p) => [p.id, p])), sById = new Map(sups.map((s) => [s.id, s]));
    const sn = new Map(sups.map((s) => [s.id, s.name]));
    let prefer = [];
    if (supId) prefer = sups.filter((s) => s.id === supId);
    else if (hint) {
      const h = " " + low(hint) + " ", ht = " " + low(C.translit(hint)) + " ";
      prefer = sups.map((s) => { const k = low(String(s.name || "")).trim(); const i = k.length >= 3 ? Math.max(h.indexOf(k), ht.indexOf(low(C.translit(k)))) : -1; return { s, i }; }).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i).map((x) => x.s);
    }
    // латиница и кириллица одинаково: «truba ppr 20» находит «Труба PPR 20 мм» (сравниваем в латинице)
    const mk = new Map(), lat = (t) => C.translit(String(t || ""));
    const actL = act.map((p) => ({ ...p, name: lat(p.name), size: lat(p.size) }));
    const matcher = (sid) => {
      if (!mk.has(sid)) { const f = C.buildMatcher(sid ? actL.filter((p) => p.supplier_id === sid) : actL); mk.set(sid, (name, code) => f(lat(name), code).map((r) => ({ ...r, p: pById.get(r.p.id) || r.p }))); }
      return mk.get(sid);
    };
    // почти одинаковые совпадения — берём товар, который чаще брали в объекты
    const pickUsed = (r) => { if (!r.length) return null; const top = r.filter((c) => c.score >= r[0].score - 0.04); return top.sort((a, b) => (mem.used.get(b.p.id) || 0) - (mem.used.get(a.p.id) || 0) || b.score - a.score)[0]; };
    const lines = items.map((it) => {
      let best = null; const cands = [];
      // 1) выучено: так уже писали, и взяли этот товар
      const lp = mem.map[mkey(it.name)] && pById.get(mem.map[mkey(it.name)][0]);
      if (lp && (!prefer.length || prefer.some((s) => s.id === lp.supplier_id))) return { it, best: { p: lp, score: 1, mem: true }, cands: [] };
      // 2) поставщики из сообщения, потом правила «что у кого брать»
      const ruleSups = mem.rules.filter((r) => r.q && hitAll(hay([it.name]), r.q)).map((r) => sById.get(r.sup)).filter(Boolean);
      const order = [...prefer, ...ruleSups.filter((s) => !prefer.some((x) => x.id === s.id))];
      for (const s of order) { const r = matcher(s.id)(it.name, it.code); const bp = pickUsed(r); if (bp && bp.score >= C.MATCH_OK) { best = { ...bp, mem: !prefer.some((x) => x.id === s.id) }; break; } cands.push(...r.slice(0, 3)); }
      if (!best) { const r = matcher("")(it.name, it.code); const bp = pickUsed(r); if (bp && bp.score >= C.MATCH_OK && !order.length) best = { ...bp, mem: (mem.used.get(bp.p.id) || 0) > 0 && bp.p.id !== (r[0] && r[0].p.id) }; else cands.push(...r.slice(0, 4)); }
      const seen = new Set();
      return { it, best, cands: cands.filter((c) => c.score >= C.MATCH_MIN && !seen.has(c.p.id) && seen.add(c.p.id)).sort((a, b) => b.score - a.score || (mem.used.get(b.p.id) || 0) - (mem.used.get(a.p.id) || 0)).slice(0, 5) };
    });
    const unclear = lines.filter((l) => !l.best && l.cands.length).slice(0, 80);
    if (unclear.length && m && (await canRead())) {
      try {
        const j = await readJson({ system: "You match requested plumbing/heating/construction goods to catalog products. For each numbered line choose the candidate that is the same product (same type, size/diameter, thread, material, power). If none fits, null. Reply with JSON only: {\"pick\":[{\"line\":0,\"cand\":0}]}", maxTokens: 2000, meter: m.fn,
          text: (prefer.length ? "Preferred suppliers (in order): " + prefer.map((s) => s.name).join(", ") + "\n\n" : "") + unclear.map((l, k) => k + ". " + l.it.name + (l.it.unit ? " (" + l.it.unit + ")" : "") + "\n" + l.cands.map((c, ci) => "   " + ci + ") " + c.p.name + (c.p.size ? " " + c.p.size : "") + " · " + (sn.get(c.p.supplier_id) || "")).join("\n")).join("\n") });
        (j && Array.isArray(j.pick) ? j.pick : []).forEach((x) => { const l = unclear[Number(x.line)]; const c = l && x.cand != null && x.cand !== "" ? l.cands[Number(x.cand)] : null; if (c) l.best = { ...c, ai: true }; });
      } catch (e) { console.error("tg match:", e && e.message); }
    }
    return { lines, prefer, sn, sups };
  }
  const UNIT = { ta: "шт", та: "шт", dona: "шт", дона: "шт", pcs: "шт", m: "м", metr: "м", метр: "м", kg: "кг" };
  const normItems = (items0) => (Array.isArray(items0) ? items0 : []).map((i) => ({ name: String((i && i.name) || "").replace(/\s+/g, " ").trim().slice(0, 200), qty: Number(i && i.qty) > 0 ? C.round2(Number(i.qty)) : 1, unit: (() => { const u = String((i && i.unit) || "").trim().toLowerCase().replace(/\.$/, ""); return UNIT[u] || u.slice(0, 12); })(), code: String((i && i.code) || "").trim().slice(0, 40), price: Number(i && i.price) > 0 ? Number(i.price) : 0 })).filter((i) => i.name).slice(0, 150);
  async function estimate(items0, hint, me, chatId, m) {
    const items = normItems(items0);
    if (!items.length) { await send(chatId, "📋 Ro'yxatda tovar topilmadi. Har qatorga bittadan yozing: <code>truba PPR 20 — 50 m</code>"); return { summary: "Ro'yxat bo'sh — foydalanuvchiga yozildi." }; }
    typing(chatId);
    const M = await matchItems(items, hint, null, m);
    const fin = fin$(me.acc);
    const rows = M.lines.map((l) => { const p = l.best && l.best.p; return { l, p, qty: l.it.qty, unit: l.it.unit || (p && p.unit) || "шт", price: p ? C.round2(C.retailOf(p)) : 0, cost: p ? Number(p.cost) || 0 : 0 }; });
    const total = rows.reduce((a, r) => a + r.qty * r.price, 0), totalC = rows.reduce((a, r) => a + r.qty * r.cost, 0);
    const miss = rows.filter((r) => !r.p).length, aiN = rows.filter((r) => r.l.best && r.l.best.ai).length;
    const other = (r) => r.p && M.prefer.length && !M.prefer.some((s) => s.id === r.p.supplier_id);
    const L = ["📋 <b>Smeta</b> · " + rows.length + " poz." + (M.prefer.length ? " · " + M.prefer.map((s) => esc(s.name)).join(", ") : ""), "",
      ...rows.map((r, i) => (i + 1) + ". " + (r.p ? esc(cut(r.p.name, 70)) + (r.l.best.ai ? " 🤖" : r.l.best.mem ? " 🧠" : "") : "⚠️ " + esc(cut(r.l.it.name, 70)) + " — <i>bazada yo'q</i>") + " — " + C.fmt(r.qty) + " " + esc(r.unit)
        + (r.p && r.price > 0 ? " × " + usd(r.price) + " = <b>" + usd(r.qty * r.price) + "</b>" : r.p ? " · narx yo'q" : "") + (other(r) ? " <i>(" + esc(M.sn.get(r.p.supplier_id) || "") + ")</i>" : "")),
      "", "Jami: <b>" + usd(total) + "</b>" + (fin && totalC > 0 ? "\nTannarx: " + usd(totalC) + " · foyda: " + usd(total - totalC) : ""),
      rows.some((r) => r.l.best && r.l.best.mem) ? "🧠 — oldin shunday olingan (bot eslab qolgan)" : "",
      miss ? "⚠️ Bazada topilmadi: " + miss + " ta — Excel'da narxsiz, dasturda to'g'rilang" : "", aiN ? "🤖 — AI tanlagan (" + aiN + " ta), tekshirib oling" : ""].filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== ""));
    let text = L.join("\n"); if (text.length > 4000) text = text.slice(0, 3900) + "\n… (to'liq ro'yxat — Excel'da)";
    let kb;
    if (canAsk(me.acc, "obyekt") && money$(me.acc)) {
      const row = await actNew(chatId, me, "items", { src: "smeta", items: rows.map((r) => ({ product_id: r.p ? r.p.id : null, name: r.p ? r.p.name : r.l.it.name, size: r.p ? r.p.size || "" : "", unit: r.unit, qty: r.qty, price: r.price, cost: r.cost, supplier_id: r.p ? r.p.supplier_id || null : null, q: r.l.it.name })) });
      if (row) kb = { inline_keyboard: [[{ text: "➕ Obyektga qo'shish", callback_data: "ao:" + row.id }, { text: "🆕 Yangi obyekt", callback_data: "ac:" + row.id }]] };
    }
    await send(chatId, text, kb ? { reply_markup: kb } : {});
    if (upload) {
      try {
        const table = [["Код", "Наименование", "Количество", "Ед. изм.", "Цена продажи", "Сумма", "Поставщик"],
          ...rows.map((r) => [r.p ? String(r.p.code || "") : "", r.p ? r.p.name : r.l.it.name, r.qty, r.unit, r.p && r.price > 0 ? r.price : "", r.p && r.price > 0 ? C.round2(r.qty * r.price) : "", r.p ? M.sn.get(r.p.supplier_id) || "" : ""])];
        const bytes = await C.tableXlsxBytes("Смета", table);
        await upload("sendDocument", { chat_id: chatId, caption: "📋 Smeta — dasturga: obyekt → «Импорт Excel»" }, { name: "Smeta_" + dt(tzDate(now())).replace(/\./g, "-") + ".xlsx", bytes, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      } catch (e) { console.error("tg smeta xlsx:", e && e.message); }
    }
    return { summary: "Smeta yuborildi (Excel bilan): " + rows.length + " poz., jami " + C.round2(total) + " $" + (miss ? ", bazada topilmadi: " + miss : "") + "." };
  }
  function findSupplier(sups, text) {
    const h = " " + low(text) + " ", ht = " " + low(C.translit(text)) + " ";
    const hits = sups.map((s) => ({ s, k: low(String(s.name || "")).trim() })).filter((x) => x.k.length >= 3 && (h.includes(x.k) || ht.includes(low(C.translit(x.k)))));
    const h0 = hits.sort((a, b) => b.k.length - a.k.length)[0];
    return h0 ? h0.s : null;
  }
  async function nakladnoy(chatId, me, block, cap, m) {
    const j = await ai.json({ system: NAK_SYS, content: [block, { type: "text", text: "Nakladnoy." + (cap ? " Izoh: " + cap : "") }], maxTokens: 6000, meter: m.fn });
    const raw = normItems(j && j.items);
    if (!raw.length) return send(chatId, "🧾 Nakladnoyni o'qib bo'lmadi — aniqroq rasm yuboring.");
    const sups = await db.all("suppliers", "", "id,name");
    const sup = findSupplier(sups, String((j && j.supplier) || "") + " " + cap);
    const prices0 = raw.map((i) => i.price).filter((x) => x > 0).sort((a, b) => a - b);
    const cur = j.currency === "usd" ? "usd" : j.currency === "uzs" ? "uzs" : (prices0[Math.floor(prices0.length / 2)] || 0) >= 1000 ? "uzs" : "usd";
    const rate = cur === "uzs" ? findRate(cap) || (await lastRate()) : 0;
    if (cur === "uzs" && !(rate >= 1000)) return send(chatId, "Kurs topilmadi — /kurs bilan kiriting yoki rasm ostiga «kurs 12 650» deb yozing.");
    const items = raw.map((i) => ({ ...i, cost: cur === "uzs" ? C.round2(i.price / rate) : C.round2(i.price) }));
    const M = await matchItems(items, "", sup ? sup.id : null, m);
    const rows = M.lines.map((l) => { const p = l.best && l.best.p; return { product_id: p ? p.id : null, name: p ? p.name : l.it.name, size: p ? p.size || "" : "", unit: l.it.unit || (p && p.unit) || "шт", qty: l.it.qty, cost: l.it.cost, price: p ? C.round2(C.retailOf(p)) || l.it.cost : l.it.cost, supplier_id: sup ? sup.id : p ? p.supplier_id || null : null, _p: !!p, _ai: !!(l.best && l.best.ai), _src: l.it.name, q: l.it.name }; });
    const tot = rows.reduce((a, r) => a + r.qty * r.cost, 0), totSrc = raw.reduce((a, i) => a + i.qty * i.price, 0);
    const jt = Number(j.total) || 0;
    const L = ["🧾 <b>Nakladnoy</b> · " + (sup ? esc(sup.name) : "postavshik: " + esc((j && j.supplier) || "?") + " <i>(bazada topilmadi)</i>") + (j.number ? " · №" + esc(j.number) : "") + (/^\d{4}-\d{2}-\d{2}$/.test(j.date || "") ? " · " + dt(j.date) : ""), "",
      ...rows.map((r, i) => (i + 1) + ". " + esc(cut(r.name, 70)) + (r._ai ? " 🤖" : "") + (r._p ? "" : " <i>(bazada yo'q — yangi)</i>") + " — " + C.fmt(r.qty) + " " + esc(r.unit) + " × " + usd(r.cost) + " = <b>" + usd(r.qty * r.cost) + "</b>"),
      "", "Jami: <b>" + usd(tot) + "</b>" + (cur === "uzs" ? " (" + sum(totSrc) + ", kurs " + C.fmtDot(rate) + ")" : ""),
      jt > 0 && Math.abs(jt - totSrc) > Math.max(1, jt * 0.01) ? "⚠️ Nakladnoydagi jami: " + (cur === "uzs" ? sum(jt) : usd(jt)) + " — tekshiring" : "", "", "Qayerga kiritamiz?"].filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== ""));
    let text = L.join("\n"); if (text.length > 4000) text = text.slice(0, 3900) + "\n…";
    const row = await actNew(chatId, me, "items", { src: "nak", items: rows.map(({ _p, _ai, _src, ...r }) => r), supplier_id: sup ? sup.id : null, supplier: sup ? sup.name : "", debt: !!sup, number: String(j.number || "").slice(0, 40) });
    const kb = [[...(canAsk(me.acc, "obyekt") && money$(me.acc) ? [{ text: "🏠 Obyektga", callback_data: "ao:" + row.id }, { text: "🆕 Yangi obyekt", callback_data: "ac:" + row.id }] : []), ...(canAsk(me.acc, "sklad") ? [{ text: "📦 Sklad Thermo'ga", callback_data: "aw:" + row.id }] : [])], [{ text: "❌ Bekor", callback_data: "an:" + row.id }]];
    return send(chatId, text, { reply_markup: { inline_keyboard: kb } });
  }

  // ---------- действия с подтверждением «✅» (ИИ, смета, накладная) ----------
  const ACT_TTL = 2 * 864e5, ACT_URL = "https://thermo-ai-os.vercel.app/#a=";
  async function actNew(chatId, me, kind, data) {
    return (await db.insert("requests", { mode: ACT_MODE, source: "config", lines: { tg: String(chatId), user_id: me.user.id, kind, data, exp: new Date(now().getTime() + ACT_TTL).toISOString() } }))[0] || null;
  }
  async function actGet(id, chatId, me) {
    if (!/^[0-9a-f-]{36}$/i.test(id || "")) return null;
    const row = (await db.select("requests", "id=eq." + id + "&mode=eq." + ACT_MODE + "&select=id,lines"))[0];
    if (!row || !row.lines || String(row.lines.tg) !== String(chatId) || row.lines.user_id !== me.user.id) return null;
    if (!(Date.parse(row.lines.exp || 0) > now().getTime())) { try { await db.del("requests", "id=eq." + row.id); } catch (e) {} return null; }
    return row;
  }
  async function actSet(row, patch) {
    const lines = { ...row.lines, data: { ...(row.lines.data || {}), ...patch } };
    await db.update("requests", "id=eq." + row.id, { lines });
    return { ...row, lines };
  }
  async function actCleanup() {
    try { for (const r of await db.select("requests", "mode=eq." + ACT_MODE + "&select=id,lines")) if (!(Date.parse((r.lines && r.lines.exp) || 0) > now().getTime())) await db.del("requests", "id=eq." + r.id); } catch (e) {}
  }
  const yesNo = (id) => [{ text: "✅ Kiritish", callback_data: "ax:" + id }, { text: "❌ Yo'q", callback_data: "an:" + id }];
  const PM_UZ = { usd: "naqd $", uzs: "naqd so'm", card: "karta", transfer: "perechisleniye" };
  async function proposePay(chatId, me, a) {
    const o = /^[0-9a-f-]{36}$/i.test(String(a.object_id || "")) ? (await db.select("objects", "id=eq." + a.object_id + "&select=id,name,client"))[0] : null;
    if (!o) return "Obyekt topilmadi — avval find_objects bilan id ni top.";
    const v = Number(a.amount);
    if (!(v > 0)) return "Summa noto'g'ri.";
    const cur = a.currency === "uzs" ? "uzs" : "usd";
    const method = a.method === "card" ? "card" : a.method === "transfer" ? "transfer" : cur;
    const rate = cur === "uzs" ? (Number(a.rate) >= 1000 ? Number(a.rate) : await lastRate()) : 0;
    const usdAmt = cur === "usd" ? C.round2(v) : rate >= 1000 ? C.round2(v / rate) : 0;
    if (!usdAmt) return "Kurs topilmadi — foydalanuvchidan kursni so'ra.";
    const row = await actNew(chatId, me, "pay", { object_id: o.id, name: o.name || "", v, cur, m: method, rate });
    await send(chatId, "💳 <b>To'lov</b> · " + esc(o.name || "—") + (o.client ? " (" + esc(o.client) + ")" : "") + "\n<b>" + (cur === "uzs" ? sum(v) + "</b> ≈ " + usd(usdAmt) + " (kurs " + C.fmtDot(rate) + ")" : usd(v) + "</b>") + " · " + PM_UZ[method] + "\nKiritaymi?", { reply_markup: { inline_keyboard: [yesNo(row.id)] } });
    return "Tasdiqlash kartochkasi yuborildi: " + (o.name || "") + ", " + (cur === "uzs" ? v + " so'm" : v + " $") + ". Foydalanuvchi ✅ bosishi kerak.";
  }
  async function proposeDeliv(chatId, me, a) {
    const data = await loadData(["objects"]);
    const o = data.objects.find((x) => x.id === a.object_id);
    if (!o) return "Obyekt topilmadi — avval deliveries yoki find_objects.";
    const no = Number(a.batch_no) || 0;
    const pend = pendingItems(o).filter((i) => !no || (Number(i.batch_no) || 1) === no);
    if (!pend.length) return "Bu obyektda yetkazilmagan tovar yo'q.";
    const row = await actNew(chatId, me, "dlv", { object_id: o.id, name: o.name || "", no });
    await send(chatId, "🚚 <b>" + esc(o.name || "—") + "</b>" + (no ? " · " + no + "-postavka" : "") + " — yetkazildi deb belgilaymi? " + pend.length + " poz.:\n" + pend.slice(0, 12).map((i) => "• " + esc(cut(i.name, 60)) + " — " + C.fmt(Number(i.qty) || 0) + " " + esc(i.unit || "шт")).join("\n") + (pend.length > 12 ? "\n…" : ""), { reply_markup: { inline_keyboard: [[{ text: "✅ Yetkazildi", callback_data: "ax:" + row.id }, { text: "❌ Yo'q", callback_data: "an:" + row.id }]] } });
    return "Tasdiqlash kartochkasi yuborildi (" + pend.length + " poz.). Foydalanuvchi ✅ bosishi kerak.";
  }
  function itemsConfirm(row, me) {
    const d = row.lines.data || {}, items = d.items || [];
    const sale = items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0), cost = items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0);
    if (d.target === "wh") {
      return { text: "📦 <b>Sklad Thermo'ga kirim</b> · " + items.length + " poz." + (d.supplier ? " · " + esc(d.supplier) : "") + "\nTannarx: <b>" + usd(cost) + "</b>" + (d.supplier_id ? "\nPostavshikka qarz: " + (d.debt ? "<b>yoziladi</b> (+" + usd(cost) + ")" : "yozilmaydi") : "") + "\nKiritaymi?",
        reply_markup: { inline_keyboard: [yesNo(row.id), ...(d.supplier_id ? [[{ text: d.debt ? "💳 Qarzga yozmaslik" : "💳 Qarzga yozish", callback_data: "ad:" + row.id }]] : [])] } };
    }
    const noPrice = items.filter((i) => !(Number(i.price) > 0)).length;
    if (d.newObj && !d.object_id) return { text: "🆕 <b>Yangi obyekt: " + esc(d.newObj.name) + "</b>" + (d.newObj.client ? "\nMijoz: " + esc(d.newObj.client) : "") + (d.newObj.phone ? " · " + esc(d.newObj.phone) : "") + (d.newObj.address ? "\nManzil: " + esc(d.newObj.address) : "") + "\n1-postavka: " + items.length + " poz. · sotuv <b>" + usd(sale) + "</b>" + (fin$(me.acc) && cost > 0 ? " · tannarx " + usd(cost) : "") + (noPrice ? "\n⚠️ Narxsiz: " + noPrice + " ta" : "") + "\nObyekt «qoralama» holatida yaratiladi. Yarataymi?",
      reply_markup: { inline_keyboard: [[{ text: "✅ Yaratish", callback_data: "ax:" + row.id }, { text: "❌ Yo'q", callback_data: "an:" + row.id }], [{ text: "✏️ Nomini o'zgartirish", callback_data: "ac:" + row.id }]] } };
    return { text: "🏠 <b>" + esc(d.object_name || "—") + "</b> — yangi postavka: " + items.length + " poz.\nSotuv: <b>" + usd(sale) + "</b>" + (fin$(me.acc) && cost > 0 ? " · tannarx " + usd(cost) : "") + (noPrice ? "\n⚠️ Narxsiz: " + noPrice + " ta — dasturda to'g'rilang" : "") + "\nKiritaymi?",
      reply_markup: { inline_keyboard: [yesNo(row.id), [{ text: "⬅️ Boshqa obyekt", callback_data: "ao:" + row.id }]] } };
  }
  const objBtn = (o) => cut((o.name || "—") + (o.client ? " · " + o.client : ""), 60);
  async function actObjSearch(msg, rq, me) {
    const chatId = msg.chat.id;
    const link = (rq.entities || []).map((e) => e.url || "").find((u) => u.startsWith(ACT_URL));
    const row = await actGet(link && link.slice(ACT_URL.length), chatId, me);
    if (!row) return send(chatId, "⌛️ So'rov eskirgan — qaytadan yuboring.");
    const data = await loadData(["objects"]);
    const list = data.objects.filter((o) => hitAll(hay([o.name, o.client, o.phone, o.master, o.address]), msg.text || "")).slice(0, 8);
    if (!list.length) return send(chatId, "🔍 «" + esc(msg.text || "") + "» bo'yicha obyekt topilmadi.", { reply_markup: { inline_keyboard: [[{ text: "🔍 Qayta qidirish", callback_data: "aq:" + row.id }]] } });
    await actSet(row, { cands: list.map((o) => o.id) });
    return send(chatId, OBJ_PICK_MARK + ":", { reply_markup: { inline_keyboard: [...list.map((o, i) => [{ text: objBtn(o), callback_data: "as:" + row.id + ":" + i }]), [{ text: "🔍 Qayta qidirish", callback_data: "aq:" + row.id }]] } });
  }
  // выучить: «как написали» → какой товар взяли (после «✅» — человек согласился с выбором)
  async function learn(items) {
    try {
      const add = (items || []).filter((i) => i && i.product_id && i.q && mkey(i.q));
      if (!add.length) return;
      const row = (await db.select("requests", "mode=eq." + MATCH_MODE + "&select=id,lines&limit=1"))[0];
      const m = { ...((row && row.lines && row.lines.m) || {}) }, day = tzDate(now());
      add.forEach((i) => { const k = mkey(i.q), o = m[k]; m[k] = [i.product_id, o && o[0] === i.product_id ? (Number(o[1]) || 0) + 1 : 1, day]; });
      const keys = Object.keys(m);
      if (keys.length > 4000) keys.sort((a, b) => String(m[a][2]).localeCompare(String(m[b][2]))).slice(0, keys.length - 4000).forEach((k) => delete m[k]);
      if (row) await db.update("requests", "id=eq." + row.id, { lines: { ...row.lines, m } }); else await db.insert("requests", { mode: MATCH_MODE, source: "config", lines: { m } });
    } catch (e) { console.error("tg learn:", e && e.message); }
  }
  async function itemsToObject(d, me) {
    const day = tzDate(now()), at = now().toISOString();
    const mkIt = (no) => (d.items || []).filter((i) => Number(i.qty) > 0).map((i) => ({ id: crypto.randomUUID(), product_id: i.product_id || null, name: i.name, size: i.size || "", unit: i.unit || "шт", qty: Number(i.qty), price: Number(i.price) || 0, cost: Number(i.cost) || 0, supplier_id: i.supplier_id || null,
      source_text: d.src === "nak" ? "Telegram: накладная" + (d.number ? " №" + d.number : "") : "Telegram: смета", confidence: 100, batch_no: no, batch_date: day, manual: true, shipped: false, added_at: at }));
    let o, no, add;
    if (d.newObj && !d.object_id) {
      // новый объект — сразу с позициями (черновик: склад не трогается, как в программе)
      add = mkIt(1); no = 1;
      if (!add.length) throw new Error("pozitsiyalar yo'q");
      o = (await db.insert("objects", { name: d.newObj.name, client: d.newObj.client || "", phone: d.newObj.phone || "", address: d.newObj.address || "", manager: me.name, status: "draft", items: add }))[0];
      if (!o) throw new Error("obyekt yaratilmadi");
      try { await db.insert("audit_log", { action: "Создан объект", entity: "object:" + (o.name || ""), detail: "из сметы Telegram · позиций: " + add.length, user_name: me.name, role: "telegram", ts: at }); } catch (e) {}
    } else {
      o = (await db.select("objects", "id=eq." + d.object_id + "&select=id,name,items"))[0];
      if (!o) throw new Error("obyekt topilmadi");
      const cur = Array.isArray(o.items) ? o.items : [];
      const nos = cur.map((i) => Number(i && i.batch_no) || 1); no = (nos.length ? Math.max(...nos) : 0) + 1;
      add = mkIt(no);
      if (!add.length) throw new Error("pozitsiyalar yo'q");
      await db.update("objects", "id=eq." + o.id, { items: [...cur, ...add] });
    }
    const sale = add.reduce((a, i) => a + i.qty * i.price, 0);
    try { await db.insert("audit_log", { action: "Новая поставка", entity: "object:" + (o.name || ""), detail: "поставка №" + no + ", позиций: " + add.length + ", на сумму " + C.fmt2(sale) + " · Telegram (" + (d.src === "nak" ? "накладная" : "смета") + ")", user_name: me.name, role: "telegram", ts: at }); } catch (e) {}
    await learn(d.items);
    return { no, n: add.length, name: o.name || "", sale, id: o.id, isNew: !!d.newObj && !d.object_id };
  }
  async function actNewObj(msg, rq, me) {
    const chatId = msg.chat.id;
    const link = (rq.entities || []).map((e) => e.url || "").find((u) => u.startsWith(ACT_URL));
    const row = await actGet(link && link.slice(ACT_URL.length), chatId, me);
    if (!row) return send(chatId, "⌛️ So'rov eskirgan — smetani qaytadan yuboring.");
    if (!(canAsk(me.acc, "obyekt") && money$(me.acc))) return send(chatId, "🔒 Bu bo'lim sizga ochilmagan.");
    const no = parseNewObj(msg.text);
    if (!no.name) return send(chatId, "Obyekt nomini yozing: <code>Yunusobod 5-kv, Gulnora, 90 123 45 67</code>");
    const r2 = await actSet(row, { newObj: no, object_id: null, target: "obj" });
    const v = itemsConfirm(r2, me);
    return send(chatId, v.text, { reply_markup: v.reply_markup });
  }
  // ---- правила «что у кого брать» (постоянная память) ----
  const isTeach = (t) => /^\s*(\/eslab|eslab\s*qol|эслаб\s*қол|запомни|doim|har\s*doim|доим|ҳар\s*доим|всегда)/i.test(String(t || ""));
  async function rulesRow() { return (await db.select("requests", "mode=eq." + RULES_MODE + "&select=id,lines&limit=1"))[0] || null; }
  async function rulesList(chatId, me, head = "") {
    const row = await rulesRow(), rules = (row && row.lines && row.lines.rules) || [];
    const sups = new Map((await db.all("suppliers", "", "id,name")).map((x) => [x.id, x.name]));
    const text = (head ? head + "\n\n" : "") + (rules.length ? "🧠 <b>Qaysi tovar qaysi postavshikdan</b>\n\n" + rules.map((r, i) => (i + 1) + ". " + esc(r.q) + " → <b>" + esc(sups.get(r.sup) || "?") + "</b>" + (r.by ? " <i>(" + esc(r.by) + ")</i>" : "")).join("\n")
      : "🧠 Qoidalar yo'q. Masalan: <code>eslab qol: PPR truba — Akfa dan, nasos — Wilo dan</code>") + "\n\nBundan tashqari bot dasturdagi obyektlarda qaysi tovar ko'p olinganini va siz tasdiqlagan smetalarni ham eslab qoladi.";
    const kb = rules.slice(0, 30).map((r, i) => [{ text: cut("❌ " + (i + 1) + ". " + r.q, 50), callback_data: "rx:" + r.id }]);
    return send(chatId, text, kb.length ? { reply_markup: { inline_keyboard: kb } } : {});
  }
  async function teachRule(msg, me, text) {
    const chatId = msg.chat.id;
    if (!canAsk(me.acc, "smeta")) return send(chatId, "🔒 Bu bo'lim sizga ochilmagan.");
    const body = String(text).replace(/^\s*\/eslab\S*\s*/i, "").trim();
    const sups = await db.all("suppliers", "", "id,name");
    let pairs = null;
    if (await canRead()) { const m = meterNew(); try { const j = await readJson({ system: "The user tells which supplier to use for which goods. Extract rules. Reply with JSON only: {\"rules\":[{\"match\":\"short key words of the goods as written (1–3 words, e.g. 'PPR truba', 'nasos')\",\"supplier\":\"supplier name as written\"}]}", text: body, maxTokens: 600, meter: m.fn }); if (j && Array.isArray(j.rules)) pairs = j.rules; } catch (e) {} await spend(m, me); }
    if (!pairs) pairs = body.replace(/^(eslab\s*qol|запомни|har\s*doim|doim|всегда)\s*[:,-]?\s*/i, "").split(/[;,\n]+/).map((x) => { const mm = /^(.*?)\s*[—–:-]+\s*(.+?)(?:\s*(?:dan|дан|от|у))?\s*$/i.exec(x.trim()); return mm ? { match: mm[1], supplier: mm[2] } : null; }).filter(Boolean);
    const ok = [], bad = [];
    pairs.forEach((p) => { const q = String((p && p.match) || "").replace(/^(eslab\s*qol|doim|har\s*doim)\s*[:,-]?\s*/i, "").trim().slice(0, 60); const s0 = findSupplier(sups, String((p && p.supplier) || "")); if (q && s0) ok.push({ id: Math.random().toString(36).slice(2, 10), q, sup: s0.id, by: me.name, at: now().toISOString() }); else if (p && p.supplier) bad.push(String(p.supplier)); });
    if (!ok.length) return send(chatId, "Tushunmadim. Masalan: <code>eslab qol: PPR truba — Akfa dan, nasos — Wilo dan</code>" + (bad.length ? "\n⚠️ Bazada yo'q postavshik: " + esc(bad.join(", ")) : ""));
    const row = await rulesRow();
    const old = ((row && row.lines && row.lines.rules) || []).filter((r) => !ok.some((n) => low(n.q) === low(r.q)));
    const lines = { rules: [...old, ...ok].slice(-200) };
    if (row) await db.update("requests", "id=eq." + row.id, { lines }); else await db.insert("requests", { mode: RULES_MODE, source: "config", lines });
    try { await db.insert("audit_log", { action: "Telegram: правило смет", entity: "smeta", detail: ok.map((r) => r.q + " → " + (sups.find((x) => x.id === r.sup) || {}).name).join("; "), user_name: me.name, role: "telegram", ts: now().toISOString() }); } catch (e) {}
    return rulesList(chatId, me, "✅ Eslab qoldim: " + ok.map((r) => esc(r.q) + " → " + esc((sups.find((x) => x.id === r.sup) || {}).name || "")).join(", ") + (bad.length ? "\n⚠️ Bazada yo'q postavshik: " + esc(bad.join(", ")) : ""));
  }
  async function ruleDel(cq, me, rid, ans, edit) {
    if (!canAsk(me.acc, "smeta")) return ans("Bu bo'lim sizga ochilmagan", true);
    const row = await rulesRow(); if (!row) return ans();
    const rules = ((row.lines && row.lines.rules) || []).filter((r) => r.id !== rid);
    await db.update("requests", "id=eq." + row.id, { lines: { ...row.lines, rules } });
    await edit("🗑 Qoida o'chirildi. Qolgan: " + rules.length + " ta — /qoidalar");
    return ans("O'chirildi");
  }
  async function itemsToWh(d, me) {
    const day = tzDate(now());
    let n = 0, cost = 0;
    for (const i of d.items || []) {
      const q = Number(i.qty) || 0, c = Number(i.cost) || 0;
      if (!(q > 0)) continue;
      const ex = i.product_id ? await db.select("warehouse", "product_id=eq." + i.product_id + "&select=id,qty")
        : (await db.select("warehouse", "name=eq." + encodeURIComponent(i.name) + "&select=id,qty,product_id,size")).filter((w) => !w.product_id && !String(w.size || ""));
      if (ex[0]) await db.update("warehouse", "id=eq." + ex[0].id, { qty: C.round2((Number(ex[0].qty) || 0) + q), cost: c, price: Number(i.price) || 0, ...(i.supplier_id ? { supplier_id: i.supplier_id } : {}) });
      else await db.insert("warehouse", { product_id: i.product_id || null, name: i.name, qty: q, cost: c, price: Number(i.price) || 0, unit: i.unit || "шт", size: "", supplier_id: i.supplier_id || null });
      await db.insert("wh_moves", { product_id: i.product_id || null, name: i.name, qty: q, dir: "in", object_id: null, object_name: null, op_date: day, user: me.name, note: "приход (Telegram, накладная" + (d.number ? " №" + d.number : "") + ")" });
      if (d.debt && i.supplier_id) await db.insert("finance_ops", { type: "wh_purchase", object_id: null, supplier_id: i.supplier_id, product_id: i.product_id || null, product_name: i.name, unit: i.unit || "шт", qty: q, cost_amount: C.round2(q * c), amount: C.round2(q * c), op_date: day, note: "Telegram: накладная" + (d.number ? " №" + d.number : ""), user: me.name });
      n++; cost += q * c;
    }
    try { await db.insert("audit_log", { action: "Склад: приход (Telegram)", entity: "warehouse", detail: "позиций: " + n + ", себест. " + C.fmt2(cost) + (d.supplier ? ", поставщик " + d.supplier + (d.debt ? " (в долг)" : "") : ""), user_name: me.name, role: "telegram", ts: now().toISOString() }); } catch (e) {}
    return { n, cost };
  }
  async function actCallback(cq, me, act, id, n2, ans, edit) {
    const chatId = cq.message.chat.id;
    const row = await actGet(id, chatId, me);
    if (!row) { await edit("⌛️ Bu so'rov eskirgan yoki allaqachon bajarilgan."); return ans(); }
    const d = row.lines.data || {}, kind = row.lines.kind;
    const objOk = canAsk(me.acc, "obyekt") && money$(me.acc);
    if (act === "an") { await db.del("requests", "id=eq." + row.id); await edit("❌ Bekor qilindi."); return ans(); }
    if (act === "ao") {
      if (!objOk) return ans("Bu bo'lim sizga ochilmagan", true);
      const data = await loadData(["objects"]);
      const list = data.objects.filter((o) => C.isLive(o) && o.status !== "closed").sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""))).slice(0, 8);
      await actSet(row, { cands: list.map((o) => o.id) });
      await send(chatId, OBJ_PICK_MARK + " — " + (d.items || []).length + " poz. qaysi obyektga?", { reply_markup: { inline_keyboard: [...list.map((o, i) => [{ text: objBtn(o), callback_data: "as:" + row.id + ":" + i }]), [{ text: "🔍 Qidirish", callback_data: "aq:" + row.id }]] } });
      return ans();
    }
    if (act === "ac") {
      if (!objOk) return ans("Bu bo'lim sizga ochilmagan", true);
      await send(chatId, NEWOBJ_MARK + ': <a href="' + ACT_URL + row.id + '">nomi, mijoz, telefon (vergul bilan)</a>\nMasalan: <code>Yunusobod 5-kv, Gulnora, 90 123 45 67</code>', { reply_markup: { force_reply: true, input_field_placeholder: "Nomi, mijoz, telefon" } });
      return ans();
    }
    if (act === "aq") { await send(chatId, OBJ_PICK_MARK + ": <a href=\"" + ACT_URL + row.id + "\">obyekt nomi, mijoz yoki telefonni yozing</a>", { reply_markup: { force_reply: true, input_field_placeholder: "masalan: Yunusobod" } }); return ans(); }
    if (act === "as") {
      if (!objOk) return ans("Bu bo'lim sizga ochilmagan", true);
      const oid = (d.cands || [])[Number(n2)];
      const o = oid && (await db.select("objects", "id=eq." + oid + "&select=id,name"))[0];
      if (!o) return ans("Obyekt topilmadi", true);
      const r2 = await actSet(row, { object_id: o.id, object_name: o.name || "", target: "obj", newObj: null });
      const v = itemsConfirm(r2, me); await edit(v.text, v.reply_markup); return ans();
    }
    if (act === "aw") {
      if (!canAsk(me.acc, "sklad")) return ans("Bu bo'lim sizga ochilmagan", true);
      const r2 = await actSet(row, { target: "wh" });
      const v = itemsConfirm(r2, me); await send(chatId, v.text, { reply_markup: v.reply_markup }); return ans();
    }
    if (act === "bt" || act === "ba" || act === "bp") {
      if (!canAsk(me.acc, "kassa")) return ans("Bu bo'lim sizga ochilmagan", true);
      const it = d.items || [], allOn = it.every((x) => x.on), k = Number(n2);
      if (act === "bp" && k === (Number(d.page) || 0)) return ans();
      const r2 = await actSet(row, act === "bp" ? { page: k } : { items: it.map((x, i) => (act === "ba" ? { ...x, on: !allOn } : i === k ? { ...x, on: !x.on } : x)) });
      const v = bulkView(r2); await edit(v.text, v.reply_markup); return ans();
    }
    if (act === "ad") { const r2 = await actSet(row, { debt: !d.debt }); const v = itemsConfirm(r2, me); await edit(v.text, v.reply_markup); return ans(!d.debt ? "Qarzga yoziladi" : "Qarzga yozilmaydi"); }
    if (act !== "ax") return ans();
    if (kind === "bulk" && !canAsk(me.acc, "kassa")) return ans("Bu bo'lim sizga ochilmagan", true);
    if ((kind === "pay" && !objOk) || (kind === "dlv" && !canAsk(me.acc, "dostavka")) || (kind === "items" && (d.target === "wh" ? !canAsk(me.acc, "sklad") : !objOk))) return ans("Bu bo'lim sizga ochilmagan", true);
    if (kind === "items" && d.target !== "wh" && !d.object_id && !(d.newObj && d.newObj.name)) return ans("Avval obyektni tanlang", true);
    const gone = await db.del("requests", "id=eq." + row.id);
    if (!gone || !gone.length) return ans("Allaqachon bajarilgan", true);
    try {
      if (kind === "pay") {
        const o = (await db.select("objects", "id=eq." + d.object_id + "&select=id,name"))[0];
        if (!o) { await edit("Obyekt topilmadi (o'chirilgan)."); return ans(); }
        const usdAmt = d.cur === "usd" ? C.round2(d.v) : C.round2(d.v / d.rate);
        const pay = { method: d.m, cur: d.cur, usd: d.cur === "usd" ? d.v : "", uzs: d.cur === "uzs" ? d.v : "", rate: d.cur === "uzs" ? d.rate : "" };
        const op = (await db.insert("finance_ops", { type: "client_payment", object_id: o.id, ...C.payPatch(pay, "client_payment", false), op_date: tzDate(now()), note: "Telegram (AI)", user: me.name, user_name: me.name }))[0];
        const amt = d.cur === "uzs" ? sum(d.v) + " (" + usd(usdAmt) + ")" : usd(d.v);
        try { await db.insert("audit_log", { action: "Telegram: оплата клиента", entity: "object:" + (o.name || ""), detail: amt.replace(/so'm/g, "сум") + " · " + PM_UZ[d.m] + " · " + me.name, user_name: me.name, role: "telegram", ts: now().toISOString() }); } catch (e) {}
        await edit("✅ <b>To'lov kiritildi</b> · " + esc(o.name || "") + "\n" + amt + " · " + PM_UZ[d.m] + " · " + dt(tzDate(now())) + "\nKiritdi: " + esc(me.name), { inline_keyboard: [[...(op && op.id ? [{ text: "↩️ Bekor qilish", callback_data: "undo:" + op.id }] : []), { text: "⬅️ Obyektga", callback_data: "o:" + o.id }]] });
        return ans("Kiritildi");
      }
      if (kind === "bulk") {
        await ans("Kiritilyapti…");
        const r = await bulkDo(d, me);
        await edit("✅ <b>Dasturga kiritildi: " + r.n + " ta</b> · " + usd(r.tot) + (r.skip ? "\n(" + r.skip + " tasi o'tkazildi: allaqachon kiritilgan yoki kurs topilmadi)" : "") + "\nKiritdi: " + esc(me.name) + "\nBekor qilish — dasturda (Финансы).");
        return;
      }
      if (kind === "dlv") {
        const n = await delivDo({ id: d.object_id }, Number(d.no) || 0, me);
        await edit(n ? "✅ <b>Yetkazildi</b> · " + esc(d.name || "") + " — " + n + " poz. · " + esc(me.name) : "Hammasi allaqachon belgilangan.");
        return ans(n ? "Belgilandi" : "");
      }
      if (kind === "items" && d.target === "wh") {
        const r = await itemsToWh(d, me);
        await learn(d.items);
        await edit("✅ <b>Sklad Thermo'ga kiritildi</b> · " + r.n + " poz. · " + usd(r.cost) + (d.supplier ? "\n" + esc(d.supplier) + (d.debt && d.supplier_id ? " — qarzga yozildi" : "") : "") + "\nKiritdi: " + esc(me.name));
        return ans("Kiritildi");
      }
      if (kind === "items") {
        const r = await itemsToObject(d, me);
        await edit("✅ <b>" + esc(r.name) + "</b> — " + (r.isNew ? "yangi obyekt yaratildi (qoralama), " : "") + r.no + "-postavka: " + r.n + " poz. · " + usd(r.sale) + "\nKiritdi: " + esc(me.name), { inline_keyboard: [[{ text: "⬅️ Obyektga", callback_data: "o:" + r.id }]] });
        return ans("Kiritildi");
      }
      return ans();
    } catch (e) {
      console.error("tg act:", e && e.message);
      await edit("⚠️ Yozilmadi: " + esc(String((e && e.message) || e)).slice(0, 300));
      return ans("Xato", true);
    }
  }
  // ---------- «что из группы не внесено»: сообщения с суммой → сверка с программой → ✅ всё сразу ----------
  async function queueAdd(chat, msg, text) {
    try { await db.insert("requests", { mode: QUEUE_MODE, source: "config", lines: { chat: String(chat.id), title: chat.title || "", msg: msg.message_id, date: tgDate(msg.date), from: nameOf(msg.from), text: String(text).slice(0, 500) } }); }
    catch (e) { console.error("tg queue:", e && e.message); }
  }
  // курс на дату: последняя операция программы с курсом не позже этого дня
  async function rateAt(day) {
    try { const r = (await db.select("finance_ops", "select=pay_rate,op_date&pay_rate=gte.1000&op_date=lte." + day + "&order=op_date.desc&limit=1"))[0]; if (r && Number(r.pay_rate) >= 1000) return Number(r.pay_rate); } catch (e) {}
    return lastRate();
  }
  const BULK_MAX = 400;
  // list: [{ chat, msg, date, from, text }] → кандидаты, которых нет в программе
  async function unentered(list) {
    const [done, ops] = await Promise.all([db.all("audit_log", "action=eq." + LOG_MODE, "entity"), db.all("finance_ops", "type=in.(company_expense,company_income)", "*")]);
    const keys = new Set(done.map((r) => r.entity));
    const seen = new Set(), out = [];
    for (const q of list) {
      const key = "tg:" + q.chat + ":" + q.msg;
      if (keys.has(key) || seen.has(key)) continue;
      seen.add(key);
      const p = moneyLike(slashText(q.text));
      if (!p) continue;
      const type = p.dir === "i" ? "company_income" : "company_expense";
      // в программе уже есть такая же сумма в тот же день (внесли вручную)? — сумы: по сумме в сумах или $ × курс
      const dup = ops.some((x) => {
        if (x.type !== type || String(x.op_date || "").slice(0, 10) !== q.date) return false;
        if (p.cur !== "uzs") return Math.abs((Number(x.amount) || 0) - p.v) < 0.01;
        if (String(x.pay_currency || "").toUpperCase() === "UZS" && Number(x.pay_amount) > 0) return Math.abs(Number(x.pay_amount) - p.v) < 1;
        const r = Number(x.pay_rate) || 0;
        if (r >= 1000) return Math.abs((Number(x.amount) || 0) * r - p.v) <= Math.max(1000, p.v * 0.01);
        return new RegExp("(^|\\D)" + C.fmt(p.v).replace(/\s/g, "[\\s\\u00a0\\u202f.,]?") + "(\\D|$)").test(String(x.reason || "") + " " + String(x.note || ""));
      });
      out.push({ chat: q.chat, msg: q.msg, date: q.date, from: q.from || "", text: String(q.text).slice(0, 300), v: p.v, cur: p.cur, dir: p.dir, cat: p.cat, method: p.method, rate: p.rate || 0, dup, on: !dup });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || Number(a.msg) - Number(b.msg));
  }
  // список по страницам (по 15 — сообщение Telegram не длиннее 4096 знаков); отметки и «✅» — на все страницы сразу
  const BULK_PAGE = 15;
  function bulkView(row) {
    const d = row.lines.data || {}, it = d.items || [];
    const pages = Math.max(1, Math.ceil(it.length / BULK_PAGE)), pg = Math.min(pages - 1, Math.max(0, Number(d.page) || 0));
    const a = pg * BULK_PAGE, part = it.slice(a, a + BULK_PAGE);
    const on = it.filter((x) => x.on);
    const tot = on.reduce((t, x) => { t[x.cur] = (t[x.cur] || 0) + x.v; return t; }, {});
    const L = ["📋 <b>Dasturga kiritilmagan</b> · " + dt(d.from) + " dan · <b>" + it.length + " ta</b>" + (pages > 1 ? " · " + (pg + 1) + "/" + pages + "-sahifa" : ""), "",
      ...part.map((x, k) => (a + k + 1) + ". " + (x.on ? "☑" : "☐") + " " + dt(x.date).slice(0, 5) + " · " + (x.dir === "i" ? "💰" : "💸") + " " + esc(((x.dir === "i" ? incCats() : expCats())[x.cat]) || "") + " · <b>" + (x.cur === "uzs" ? sum(x.v) : usd(x.v)) + "</b> · " + esc(cut(x.from, 18)) + " — <i>" + esc(cut(slashText(x.text).replace(/\s+/g, " "), 55)) + "</i>" + (x.dup ? " ⚠️ <i>dasturda o'xshashi bor</i>" : "")),
      "", "Belgilangan: <b>" + on.length + " ta</b>" + (on.length ? " (" + [tot.uzs ? sum(tot.uzs) : "", tot.usd ? usd(tot.usd) : ""].filter(Boolean).join(" + ") + ") — ✅ bosilsa, hammasi dasturga (Финансы) kiradi" : "")];
    let text = L.join("\n"); if (text.length > 4050) text = text.slice(0, 4000) + "\n…";
    const nums = part.map((x, k) => ({ text: (x.on ? "☑" : "☐") + (a + k + 1), callback_data: "bt:" + row.id + ":" + (a + k) }));
    const kb = []; for (let i = 0; i < nums.length; i += 5) kb.push(nums.slice(i, i + 5));
    if (pages > 1) kb.push([{ text: "‹ Oldingi", callback_data: "bp:" + row.id + ":" + ((pg + pages - 1) % pages) }, { text: (pg + 1) + "/" + pages, callback_data: "bp:" + row.id + ":" + pg }, { text: "Keyingi ›", callback_data: "bp:" + row.id + ":" + ((pg + 1) % pages) }]);
    kb.push([{ text: on.length === it.length ? "☐ Hammasini olib tashlash" : "☑ Hammasini belgilash", callback_data: "ba:" + row.id }]);
    kb.push([...(on.length ? [{ text: "✅ Kiritish (" + on.length + ")", callback_data: "ax:" + row.id }] : []), { text: "❌ Yopish", callback_data: "an:" + row.id }]);
    return { text, reply_markup: { inline_keyboard: kb } };
  }
  // from — с какого дня; list — из выгрузки чата (JSON) или null — из запомненных ботом сообщений
  async function reconcile(chatId, me, from, list) {
    if (!canAsk(me.acc, "kassa")) return send(chatId, "🔒 Bu bo'lim sizga ochilmagan.");
    typing(chatId);
    let src = list;
    let first = null;
    if (!src) {
      const rows = await db.select("requests", "mode=eq." + QUEUE_MODE + "&select=id,lines");
      src = rows.map((r) => r.lines || {}).filter((l) => l.date >= from);
      const all = rows.map((r) => (r.lines || {}).date).filter(Boolean).sort();
      first = all[0] || tzDate(now());
    } else src = src.filter((l) => l.date >= from);
    const cand = await unentered(src);
    const note = !list && first > from ? "\n\nℹ️ Bot guruh xabarlarini " + dt(first) + " dan beri eslab qoladi. Undan oldingilari uchun: Telegram Desktop → guruh → ⋮ → <b>Export chat history</b> → faqat matn, format <b>JSON</b> → <code>result.json</code> faylini shu chatga yuboring." : "";
    if (!cand.length) return send(chatId, "✅ " + dt(from) + " dan beri guruhda yozilgan rasxod/prixodlarning hammasi dasturda." + note);
    const items = cand.slice(0, BULK_MAX);
    const row = await actNew(chatId, me, "bulk", { from, items, more: cand.length > BULK_MAX });
    const v = bulkView(row);
    await send(chatId, v.text, { reply_markup: v.reply_markup });
    if (note) await send(chatId, note.trim());
    return { n: cand.length, on: items.filter((x) => x.on).length };
  }
  async function bulkDo(d, me) {
    const keysDone = new Set((await db.all("audit_log", "action=eq." + LOG_MODE, "entity")).map((r) => r.entity));
    let n = 0, tot = 0, skip = 0;
    for (const x of (d.items || []).filter((i) => i.on)) {
      const key = "tg:" + x.chat + ":" + x.msg;
      if (keysDone.has(key)) { skip++; continue; }
      const rate = x.cur === "uzs" ? x.rate || (await rateAt(x.date)) : 0;
      const pl = plan(x, x.dir, x.cat, rate);
      if (!(pl.usdAmt > 0)) { skip++; continue; }
      const type = x.dir === "i" ? "company_income" : "company_expense";
      const note = slashText(x.text).replace(/\s+/g, " ").trim().slice(0, 200) + " (Telegram: " + (x.from || "—") + ", " + dt(x.date) + ")";
      const op = (await db.insert("finance_ops", { type, object_id: null, category: pl.cat, ...(type === "company_expense" ? { size: pl.cat } : {}), ...C.payPatch(pl.pay, type, false), op_date: x.date, note, user: me.name, user_name: me.name }))[0];
      const ts = now().toISOString();
      try { await db.insert("audit_log", [{ action: x.dir === "i" ? "Telegram: приход" : "Telegram: расход", entity: "company:" + pl.cat, detail: (x.cur === "uzs" ? C.fmtDot(x.v) + " сум (" + C.fmt2(pl.usdAmt) + " $)" : C.fmt2(x.v) + " $") + " · " + note + " · сверка, внёс " + me.name, user_name: me.name, role: "telegram", ts }, { action: LOG_MODE, entity: key, detail: (op && op.id) || "", user_name: me.name, role: "telegram", ts }]); } catch (e) {}
      try { await db.del("requests", "mode=eq." + QUEUE_MODE + "&lines->>chat=eq." + encodeURIComponent(x.chat) + "&lines->>msg=eq." + x.msg); } catch (e) {}
      n++; tot += pl.usdAmt;
    }
    return { n, tot, skip };
  }
  // выгрузка истории группы из Telegram Desktop (result.json) — старые сообщения, которых бот не видел
  async function onExport(msg, me) {
    const chatId = msg.chat.id;
    if (!canAsk(me.acc, "kassa")) return send(chatId, "🔒 Bu bo'lim sizga ochilmagan.");
    if (!file) return send(chatId, "⚠️ Faylni olib bo'lmadi.");
    if ((Number(msg.document.file_size) || 0) > 20e6) return send(chatId, "Fayl 20 MB dan katta. Eksportda faqat matnni tanlang (rasm, video — yo'q) yoki davrni qisqartiring.");
    typing(chatId);
    let j;
    try { const f = await file(msg.document.file_id); j = JSON.parse(new TextDecoder().decode(f.bytes)); } catch (e) { return send(chatId, "⚠️ Faylni o'qib bo'lmadi. Telegram Desktop → Export chat history → format: <b>JSON</b> bo'lsin."); }
    if (!j || !Array.isArray(j.messages)) return send(chatId, "⚠️ Bu Telegram eksporti emas (result.json kerak).");
    const cf = await cfg();
    const eid = String(j.id || "");
    const g = cf.allowed.find((x) => [eid, "-" + eid, "-100" + eid].includes(String(x.id))) || cf.allowed.find((x) => x.title && j.name && low(x.title) === low(j.name)) || (cf.allowed.length === 1 ? cf.allowed[0] : null);
    if (!g) return send(chatId, "⚠️ Bu guruh dasturda ruxsat etilgan guruhlar ro'yxatida yo'q (Аккаунты → Telegram-бот).");
    const botId = String(memKey || "").split(":")[0];
    const txt = (t) => (Array.isArray(t) ? t.map((x) => (typeof x === "string" ? x : (x && x.text) || "")).join("") : String(t || ""));
    const list = j.messages.filter((m) => m && m.type === "message" && m.id && m.date && !(botId && m.from_id === "user" + botId))
      .map((m) => ({ chat: String(g.id), msg: m.id, date: String(m.date).slice(0, 10), from: String(m.from || ""), text: txt(m.text).trim() }))
      .filter((m) => m.text && !/^[💸💰✅❌↩️⛔🔒ℹ📊🧾⚠🗓]/u.test(m.text));
    const cap = String(msg.caption || "").trim();
    const dates = list.map((m) => m.date).sort();
    const from = cap ? parseDay(cap, tzDate(now())) : dates[0] || tzDate(now());
    try { return await reconcile(chatId, me, from, list); }
    catch (e) { console.error("tg export:", e && e.message); return send(chatId, "⚠️ Solishtirib bo'lmadi: " + esc(String((e && e.message) || e)).slice(0, 200)); }
  }
  // ---------- письмо клиенту (ИИ) ----------
  async function clientMsgAI(chatId, me, oid, lang, ans) {
    if (!ai) return ans("AI ulanmagan", true);
    const st = await aiState();
    if (!st.ok) return ans("AI oylik limiti tugagan", true);
    await ans("Yozyapman…");
    typing(chatId);
    const facts = await clientFacts(oid);
    if (/^Obyekt topilmadi/.test(facts)) return send(chatId, "Obyekt topilmadi.");
    const m = meterNew();
    try {
      const t = await ai.text({ system: "Sen Thermo Engineering kompaniyasi menejerisan. Mijozga Telegram/SMS uchun xabar yoz: xushmuomala, qisqa (3–6 jumla), aniq qarz summasi bilan, to'lovni muloyim so'rab. Faqat berilgan faktlardan foydalan. Ichki ma'lumot (tannarx, foyda, postavshik) yozma. Markdown'siz, faqat xabar matni; oxirida imzo: «Hurmat bilan, Thermo Engineering» (ruscha bo'lsa «С уважением, Thermo Engineering»).", prompt: (lang === "ru" ? "Til: rus tili." : "Til: o'zbek tili (lotin).") + "\n\n" + facts, maxTokens: 700, meter: m.fn });
      if (t) await tg("sendMessage", { chat_id: chatId, text: cut(t.replace(/\*\*/g, ""), 4000) });
    } catch (e) { await send(chatId, "⚠️ AI javob bermadi."); }
    finally { await spend(m, me); }
  }
  // ---------- еженедельные риски и комментарий к дневному отчёту ----------
  async function riskReport() {
    const data = await loadData(["objects", "finance_ops"]);
    const day = tzDate(now()), dnum = (iso) => Date.parse(String(iso).slice(0, 10) + "T12:00:00Z"), age = (iso) => Math.round((dnum(day) - dnum(iso)) / 864e5);
    const live = data.objects.filter((o) => C.isLive(o) && o.status !== "closed");
    const below = [];
    live.forEach((o) => (Array.isArray(o.items) ? o.items : []).forEach((i) => { const p = Number(i && i.price) || 0, c = Number(i && i.cost) || 0, q = Number(i && i.qty) || 0; if (p > 0 && c > 0 && q > 0 && p < c - 0.004) below.push({ o, i, loss: (c - p) * q }); }));
    below.sort((a, b) => b.loss - a.loss);
    const late = live.map((o) => { const old = pendingItems(o).filter((i) => i.batch_date && age(i.batch_date) >= 7); return { o, n: old.length, d: old.length ? Math.max(...old.map((i) => age(i.batch_date))) : 0 }; }).filter((r) => r.n).sort((a, b) => b.d - a.d);
    const lowM = live.map((o) => ({ o, f: C.calcObject(o, data.finance_ops) })).filter((r) => r.f.saleNet > 0.004 && r.f.margin < 10).sort((a, b) => a.f.margin - b.f.margin);
    const stale = data.objects.filter((o) => C.isLive(o)).map((o) => {
      const f = C.calcObject(o, data.finance_ops);
      const last = [String(o.created_at || "").slice(0, 10), ...data.finance_ops.filter((x) => x.object_id === o.id && x.type === "client_payment" && !x.voided).map(opDay)].filter(Boolean).sort().pop() || day;
      return { o, debt: f.clientDebt, d: age(last) };
    }).filter((r) => r.debt > 0.004 && r.d >= 30).sort((a, b) => b.debt - a.debt);
    if (!below.length && !late.length && !lowM.length && !stale.length) return null;
    const L = ["⚠️ <b>Haftalik nazorat · " + dt(day) + "</b>"];
    if (below.length) L.push("", "📉 <b>Tannarxdan arzon sotilgan</b> (" + below.length + " poz., zarar " + usd(below.reduce((a, r) => a + r.loss, 0)) + "):", ...below.slice(0, 10).map((r) => "• " + esc(r.o.name || "") + ": " + esc(cut(r.i.name, 50)) + " — sotuv " + usd(r.i.price) + " < tannarx " + usd(r.i.cost)));
    if (late.length) L.push("", "🚚 <b>7 kundan ko'p yetkazilmagan</b>:", ...late.slice(0, 10).map((r) => "• " + esc(r.o.name || "") + " — " + r.n + " poz., " + r.d + " kun"));
    if (lowM.length) L.push("", "💸 <b>Marjasi past (10% dan kam)</b>:", ...lowM.slice(0, 10).map((r) => "• " + esc(r.o.name || "") + " — marja " + C.round2(r.f.margin) + "%, foyda " + usd(r.f.gross)));
    if (stale.length) L.push("", "⏳ <b>Qarz bor, 30 kundan beri to'lov yo'q</b> (" + usd(stale.reduce((a, r) => a + r.debt, 0)) + "):", ...stale.slice(0, 10).map((r) => "• " + esc(r.o.name || "") + (r.o.client ? " (" + esc(r.o.client) + ")" : "") + " — " + usd(r.debt) + " · " + r.d + " kun"));
    return L.join("\n");
  }
  async function dailyComment(day) {
    try {
      if (!ai) return "";
      const st = await aiState(); if (!st.ok) return "";
      const data = await loadData(["finance_ops"]);
      const ops = data.finance_ops.filter((x) => !x.voided);
      const IN = ["client_payment", "company_income"], OUT = ["company_expense", "supplier_payment", "expense", "bonus_payment"];
      const per = (d, types) => ops.filter((x) => opDay(x) === d && types.includes(x.type)).reduce((a, x) => a + (Number(x.amount) || 0), 0);
      let si = 0, so = 0, n = 0;
      for (let k = 1; k <= 30; k++) { const d = addDays(day, -k); if (dowOf(d) === 0) continue; si += per(d, IN); so += per(d, OUT); n++; }
      const big = ops.filter((x) => opDay(x) === day && [...IN, ...OUT].includes(x.type) && x.category !== C.SALARY_CAT).sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 3).map((x) => C.opName(x) + " " + C.round2(x.amount) + " $" + (x.category ? " (" + x.category + ")" : ""));
      const m = meterNew();
      const t = await ai.text({ system: "Sen kompaniya rahbari uchun kunlik hisobotga izoh yozasan. O'zbek tilida (lotin), 1–2 qisqa jumla, oddiy matn, Markdown'siz. Faqat berilgan raqamlardan foydalan, taxmin qilma. Odatdagidan sezilarli farq (±30%) yoki katta operatsiya bo'lsa — shuni ayt; hammasi odatdagidek bo'lsa — qisqa shuni ayt.",
        prompt: "Bugun " + dt(day) + ": kirim " + C.round2(per(day, IN)) + " $, chiqim " + C.round2(per(day, OUT)) + " $.\nOxirgi 30 kun (yakshanbasiz) o'rtacha kunlik: kirim " + C.round2(si / Math.max(1, n)) + " $, chiqim " + C.round2(so / Math.max(1, n)) + " $.\nBugungi eng katta operatsiyalar: " + (big.join("; ") || "yo'q"), maxTokens: 400, meter: m.fn });
      await spend(m, null);
      return String(t || "").replace(/\*\*/g, "").trim().slice(0, 500);
    } catch (e) { console.error("tg daily ai:", e && e.message); return ""; }
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
    const chatId = cq.message.chat.id;
    const [id1, n2] = id.split(":");
    if (act === "rx") return ruleDel(cq, me, id, ans, edit);
    if (["ax", "an", "ao", "aq", "as", "aw", "ad", "bt", "ba", "bp", "ac"].includes(act)) return actCallback(cq, me, act, id1, n2, ans, edit);
    if (act === "undo") return undo(cq, id, me.name, ans, edit);
    if (act === "rd") {
      const row = (await db.select("requests", "id=eq." + id + "&mode=eq." + REMIND_MODE + "&select=id,lines"))[0];
      if (row && String(row.lines.tg) === String(chatId)) await db.del("requests", "id=eq." + id);
      await edit("❌ Eslatma bekor qilindi."); return ans();
    }
    if (act === "kc") {
      if (!canAsk(me.acc, "kassa") || !/^\d{4}-\d{2}-\d{2}$/.test(id)) return ans("Bu bo'lim sizga ochilmagan", true);
      const upd = await closeKassa(id, me);
      try { await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch (e) {}
      await send(chatId, "🧾 Kassa " + dt(id) + (upd ? " yangilandi" : " yopildi") + " — dasturdagi «Заметки»da saqlandi.");
      return ans("Saqlandi");
    }
    if (["dl", "dv", "ds"].includes(act)) {
      if (!canAsk(me.acc, "dostavka")) return ans("Bu bo'lim sizga ochilmagan", true);
      const data = await loadData(["objects", "masters", "suppliers"]);
      if (act === "dl") { const v = delivList(data); await edit(v.text, v.reply_markup); return ans(); }
      const o = data.objects.find((x) => x.id === id1);
      if (!o) { await edit("Obyekt topilmadi.", { inline_keyboard: [[{ text: "⬅️ Ro'yxat", callback_data: "dl" }]] }); return ans(); }
      if (act === "dv") { const v = delivCard(o, data); await edit(v.text, v.reply_markup); return ans(); }
      const n = await delivDo(o, Number(n2) || 0, me);
      const d2 = await loadData(["objects", "masters", "suppliers"]); const o2 = d2.objects.find((x) => x.id === id1) || o;
      const v = delivCard(o2, d2); await edit(v.text, v.reply_markup);
      return ans(n ? "Yetkazildi: " + n + " poz." : "Hammasi allaqachon belgilangan");
    }
    if (["pa", "pk", "pm", "px", "ox", "mx", "mxa"].includes(act)) {
      if (!canAsk(me.acc, "obyekt") || !money$(me.acc)) return ans("Bu bo'lim sizga ochilmagan", true);
      if (act === "px") { await edit("❌ Kiritilmadi."); return ans(); }
      const data = await loadData(act === "pa" || act === "pk" || act === "pm" ? ["objects"] : ["objects", "finance_ops"]);
      const o = data.objects.find((x) => x.id === id1);
      if (!o) return ans("Obyekt topilmadi", true);
      if (act === "pa") { await send(chatId, "💳 To'lov qo'shish · <a href=\"" + OBJ_URL + o.id + "\">" + esc(o.name || "—") + "</a>\nSummani yozing: <code>500$</code>, <code>1 200 000 so'm</code>, <code>300$ karta</code>", { reply_markup: { force_reply: true, input_field_placeholder: "masalan: 500$" } }); return ans(); }
      if (act === "pm") { const orig = cq.message.reply_to_message; const v = orig && (await payView(o, orig.text || "", Number(n2) || 0)); if (v) await edit(v.text, v.reply_markup); return ans(); }
      if (act === "pk") return payDo(cq, me, o.id, Number(n2) || 0, ans, edit);
      if (act === "mx") { const t = await clientMsg(o, data); if (!t) return ans("Qarz yo'q", true); await send(chatId, t, ai ? { reply_markup: { inline_keyboard: [[{ text: "✨ AI: o'zbekcha", callback_data: "mxa:" + o.id + ":uz" }, { text: "✨ AI: ruscha", callback_data: "mxa:" + o.id + ":ru" }]] } } : {}); return ans("Matn tayyor — nusxa oling yoki forward qiling"); }
      if (act === "mxa") return clientMsgAI(chatId, me, o.id, n2 === "ru" ? "ru" : "uz", ans);
      if (act === "ox") {
        if (!upload) return ans("Fayl yuborib bo'lmadi", true);
        const prods = await db.all("products", "", "id,code,name");
        const bytes = await C.clientSheetBytes(o, data.finance_ops.filter((x) => x.object_id === o.id), prods);
        await upload("sendDocument", { chat_id: chatId, caption: "📄 " + (o.name || "") + " — mijoz uchun" }, { name: "Объект_" + String(o.name || "obj").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) + ".xlsx", bytes, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        return ans("Excel yuborildi");
      }
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
  async function reminders(sent) {
    const rows = await db.select("requests", "mode=eq." + REMIND_MODE + "&select=id,lines");
    for (const r of rows) {
      if (!r.lines || !(Date.parse(r.lines.at) <= now().getTime())) continue;
      let gone = [];
      try { gone = await db.del("requests", "id=eq." + r.id); } catch (e) { continue; }
      if (!gone || !gone.length) continue; // уже отправил другой запуск
      try { await send(r.lines.tg, "⏰ <b>Eslatma</b>\n" + esc(r.lines.text || "")); sent.push(r.lines.tg); } catch (e) {}
    }
  }
  async function tick() {
    const sent = [];
    try { await reminders(sent); } catch (e) { console.error("tg reminders:", e && e.message); }
    const cf = await cfg();
    const rp = repCfg(cf.c && cf.c.lines);
    const day = tzDate(now()), hm = tzTime(now());
    const wantDaily = rp.daily.on && isDue(hm, rp.daily.time), wantDebts = rp.debts.on && isLastDay(day) && isDue(hm, rp.debts.time);
    const wantRisk = rp.risk.on && dowOf(day) === rp.risk.dow && isDue(hm, rp.risk.time);
    if (hm.slice(3) < "10") await actCleanup(); // раз в час: старые неподтверждённые действия
    if (hm === "03:00" || hm === "03:05") { try { await db.del("requests", "mode=eq." + QUEUE_MODE + "&created_at=lt." + new Date(now().getTime() - 120 * 864e5).toISOString()); } catch (e) {} }
    if (!wantDaily && !wantDebts && !wantRisk) return sent;
    const P = await people();
    const to = (need) => P.all().filter((m) => (rp.to ? rp.to.includes(String(m.user.id)) : isFull(m.acc)) && canAsk(m.acc, need));
    const blast = async (list, text, extra = {}) => { for (const m of list) { try { await send(m.tg, text.length > 4000 ? text.slice(0, 3990) + "\n…" : text, extra); sent.push(m.tg); } catch (e) { /* человек остановил бота */ } } };
    if (wantDaily && (await markOnce("rep:daily:" + day))) {
      const list = to("kassa");
      if (list.length) {
        const note = rp.daily.ai ? await dailyComment(day) : "";
        await blast(list, "📊 <b>Kunlik hisobot</b>\n\n" + (await kassa(day)) + "\n\n" + (await today(day)) + (note ? "\n\n🤖 " + esc(note) : ""), { reply_markup: kcKb(day) });
      }
    }
    if (wantRisk && (await markOnce("rep:risk:" + day))) {
      const list = to("obyekt").filter((m) => fin$(m.acc));
      const t = list.length ? await riskReport() : null;
      if (t) await blast(list, t);
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
      if (upd && upd.te_cron) return smeta ? undefined : zakaz ? zkTick() : tick();
      if (zakaz) {
        if (!menuDone) { menuDone = true; try { for (const scope of [{ type: "default" }, { type: "all_group_chats" }, { type: "all_private_chats" }]) await tg("deleteMyCommands", { scope }); await zkSaveName(); } catch (e) { menuDone = false; } }
        if (upd.callback_query) return /^z[sxnoi]:/.test(String(upd.callback_query.data || "")) ? zkCallback(upd.callback_query, (text, alert) => tg("answerCallbackQuery", { callback_query_id: upd.callback_query.id, text: text || "", show_alert: !!alert }).catch(() => {})) : undefined;
        if (upd.message) return onZakazMessage(upd.message);
        if (upd.my_chat_member) { const ch = upd.my_chat_member.chat || {}, st = upd.my_chat_member.new_chat_member && upd.my_chat_member.new_chat_member.status; if ((ch.type === "group" || ch.type === "supergroup") && (st === "member" || st === "administrator")) await zkPending(await zkCfg(), ch); }
        return;
      }
      if (!menuDone) { menuDone = true; try { if (smeta) { for (const scope of [{ type: "default" }, { type: "all_group_chats" }]) await tg("deleteMyCommands", { scope }); await tg("setMyCommands", { commands: [{ command: "start", description: "Qanday ishlatish" }, { command: "qoidalar", description: "Qaysi tovar qaysi postavshikdan" }], scope: { type: "all_private_chats" } }); } else { await setupMenu(tg); await saveBotName(); } } catch (e) { menuDone = false; } }
      if (smeta && upd.my_chat_member) return;
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
