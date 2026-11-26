// Ertalabki hisobot (утренний отчёт): что было в программе за день — по журналу действий (audit_log),
// деньгам (finance_ops) и спискам от мастеров (usta_lists). Отправляет бот по расписанию
// (Аккаунты → Telegram-бот → «Отчёты в личный чат», по умолчанию в 09:30 — за вчера) и по команде /hisobot.
// Чистая функция: данные передаются готовыми, база здесь не читается (так её легко проверить).
import * as C from "./core.mjs";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const usd = (n) => C.fmtDot(C.round2(n)) + " $";
const dt = (iso) => (iso ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : "");
const cut = (t, n) => { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const num = (s) => { const v = Number(String(s || "").replace(/\s/g, "").replace(",", ".")); return isFinite(v) ? v : 0; };
export const WD_UZ = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];

// служебные и «технические» записи журнала — в отчёт не идут (вход, пароли, бэкапы, настройки бота)
const SKIP = /^(te_|Вход в систему|Облачный пароль введён|Неверный облачный пароль|Создан облачный пароль|Изменён облачный пароль|Сброшен облачный пароль|Автобэкап|Бэкап скачан|Excel-архив скачан|Telegram: (ссылка|подключён|отключён|отчёты|ИИ|аккаунт бота|группа)|Бот )/;
const opDay = (x) => String(x.op_date || x.created_at || "").slice(0, 10);
// день записи журнала по Ташкенту
export const logDay = (x) => new Date(x.ts || x.created_at || 0).toLocaleDateString("sv-SE", { timeZone: "Asia/Tashkent" });
const entName = (x) => { const s = String(x.entity || ""); const i = s.indexOf(":"); return i < 0 ? s : s.slice(i + 1); };
const who = (x) => String(x.user_name || "—").replace(/^Telegram:\s*/, "").trim() || "—";

// список «• …» не длиннее n строк, остальное — «… yana N ta»
const list = (rows, n = 8) => rows.length > n ? [...rows.slice(0, n), "   … yana " + (rows.length - n) + " ta"] : rows;

/**
 * day — «2026-11-25»; logs — записи audit_log за этот день; ops — все finance_ops (нормализованные);
 * usta — списки мастеров за день; ustaNew — сколько всего ещё не разобрано; objects — для названий;
 * money — показывать суммы (право «Финансы» / руководитель)
 */
export function morningBuild({ day, logs, ops, usta = [], ustaNew = 0, objects = [], suppliers = [], money = true }) {
  const L = ["🌅 <b>Ertalabki hisobot</b>", "Kecha — " + dt(day) + ", " + WD_UZ[new Date(day + "T12:00:00Z").getUTCDay()], ""];
  const ev = (logs || []).filter((x) => x && x.action && !SKIP.test(x.action) && logDay(x) === day);
  const used = new Set();
  const take = (re, extra = () => true) => ev.filter((x, i) => !used.has(x) && re.test(x.action) && extra(x)).map((x) => { used.add(x); return x; });
  const objN = new Map(objects.map((o) => [o.id, o.name || "—"]));
  const supN = new Map(suppliers.map((s) => [s.id, s.name || "—"]));
  let any = false;
  const sect = (title, rows) => { if (!rows.length) return; any = true; L.push(title, ...rows, ""); };

  // ---------- 1. Pul ----------
  const dayOps = (ops || []).filter((x) => !x.voided && opDay(x) === day);
  if (money && dayOps.length) {
    const sum = (f) => C.round2(dayOps.filter(f).reduce((a, x) => a + (Number(x.amount) || 0), 0));
    const inCl = sum((x) => x.type === "client_payment"), inCo = sum((x) => x.type === "company_income");
    const oSup = sum((x) => x.type === "supplier_payment"), oObj = sum((x) => x.type === "expense"), oBon = sum((x) => x.type === "bonus_payment"), oCo = sum((x) => x.type === "company_expense");
    const tin = C.round2(inCl + inCo), tout = C.round2(oSup + oObj + oBon + oCo);
    const part = (pairs) => pairs.filter(([, v]) => v > 0.004).map(([n, v]) => n + " " + usd(v)).join(" · ");
    const rows = [];
    if (tin > 0.004 || tout > 0.004) {
      rows.push("➕ Kirim: <b>" + usd(tin) + "</b>" + (tin > 0.004 ? " (" + part([["mijozlardan", inCl], ["kompaniya prixodi", inCo]]) + ")" : ""));
      rows.push("➖ Chiqim: <b>" + usd(tout) + "</b>" + (tout > 0.004 ? " (" + part([["postavshiklarga", oSup], ["obyekt rasxodlari", oObj], ["ustalarga bonus", oBon], ["kompaniya rasxodlari", oCo]]) + ")" : ""));
      rows.push("= Sof: <b>" + (tin - tout >= 0 ? "+" : "−") + usd(Math.abs(tin - tout)) + "</b>");
    }
    // кто заплатил (по объектам) и кому заплатили (поставщики)
    const by = (type, key, names) => { const m = new Map(); dayOps.filter((x) => x.type === type).forEach((x) => { const k = names.get(x[key]) || "—"; m.set(k, (m.get(k) || 0) + (Number(x.amount) || 0)); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const cl = by("client_payment", "object_id", objN), sp = by("supplier_payment", "supplier_id", supN);
    if (cl.length) rows.push("", "💳 <b>Mijozlar to'ladi</b> (" + cl.length + "):", ...list(cl.map(([n, v]) => "• " + esc(cut(n, 50)) + " — " + usd(v))));
    if (sp.length) rows.push("", "🏭 <b>Postavshiklarga to'landi</b> (" + sp.length + "):", ...list(sp.map(([n, v]) => "• " + esc(cut(n, 50)) + " — " + usd(v))));
    sect("💰 <b>Pul</b>", rows);
  }
  // деньги уже посчитаны из операций — те же действия в журнале не повторяем
  take(/^(Оплата клиента|Оплата поставщику|Telegram: (оплата клиента|расход|приход)|Расход компании|Приход компании|Выплата бонуса|Начислен бонус|Авто-бонус)/);

  // ---------- 2. Obyektlar ----------
  const isObj = (x) => /^object:/.test(x.entity || "");
  const uniq = (rows) => [...new Set(rows)];
  const objRows = [];
  const fresh = take(/^(Заявка сохранена|Создан объект)/, isObj);
  if (fresh.length) objRows.push("🆕 <b>Yangi obyekt / zayavka</b> (" + uniq(fresh.map(entName)).length + "):", ...list(uniq(fresh.map((x) => "• " + esc(cut(entName(x), 60)) + " — " + esc(who(x))))));
  const pst = take(/^Новая поставка/, isObj);
  if (pst.length) objRows.push("📦 <b>Yangi postavka</b> (" + pst.length + "):", ...list(pst.map((x) => {
    const d = String(x.detail || ""), no = (/поставка №\s*(\d+)/.exec(d) || [])[1], pz = (/позиций:\s*(\d+)/.exec(d) || [])[1], sm = (/на сумму\s*([\d\s.,]+)/.exec(d) || [])[1];
    return "• " + esc(cut(entName(x), 50)) + (no ? " — №" + no : "") + (pz ? ", " + pz + " poz." : "") + (money && sm ? ", " + usd(num(sm)) : "");
  })));
  const add = take(/^Добавлены позиции/, isObj);
  if (add.length) { const m = new Map(); add.forEach((x) => { const n = Number((/позиций:\s*(\d+)/.exec(x.detail || "") || [])[1]) || 0; m.set(entName(x), (m.get(entName(x)) || 0) + n); });
    objRows.push("➕ <b>Pozitsiya qo'shildi</b> (" + m.size + " obyekt):", ...list([...m.entries()].map(([n, k]) => "• " + esc(cut(n, 50)) + (k ? " — " + k + " poz." : "")))); }
  const dlv = take(/^(Товар отгружен|Отгрузка со склада)/, isObj);
  if (dlv.length) { const m = new Map(); dlv.forEach((x) => { const n = Number((/позиций:\s*(\d+)/.exec(x.detail || "") || [])[1]) || 0; m.set(entName(x), (m.get(entName(x)) || 0) + n); });
    objRows.push("🚚 <b>Yetkazildi</b> (" + m.size + " obyekt):", ...list([...m.entries()].map(([n, k]) => "• " + esc(cut(n, 50)) + (k ? " — " + k + " poz." : "")))); }
  const paid = take(/^Статус объекта: Оплачено/, isObj);
  if (paid.length) objRows.push("✅ <b>To'liq to'landi</b> (" + uniq(paid.map(entName)).length + "):", ...list(uniq(paid.map((x) => "• " + esc(cut(entName(x), 60))))));
  const ret = take(/^Возврат товара/, isObj);
  if (ret.length) objRows.push("↩️ <b>Qaytarildi</b> (" + ret.length + "):", ...list(ret.map((x) => { const sm = (/сумма:\s*([\d\s.,]+)/.exec(x.detail || "") || [])[1]; return "• " + esc(cut(entName(x), 50)) + (money && sm ? " — " + usd(num(sm)) : ""); })));
  const disc = take(/^Скидка/, isObj);
  if (disc.length && money) objRows.push("🏷 <b>Chegirma</b> (" + disc.length + "):", ...list(disc.map((x) => "• " + esc(cut(entName(x), 50)) + (num(x.detail) ? " — " + usd(num(x.detail)) : ""))));
  const st = take(/^Статус объекта: /, isObj);
  if (st.length) { const m = new Map(); st.forEach((x) => m.set(entName(x), x.action.replace(/^Статус объекта:\s*/, ""))); // последний статус за день
    objRows.push("🔁 <b>Holati o'zgardi</b> (" + m.size + "):", ...list([...m.entries()].map(([n, s]) => "• " + esc(cut(n, 50)) + " → " + esc(s)))); }
  const delO = take(/^(Удалён объект|Удалена поставка)/, isObj);
  if (delO.length) objRows.push("🗑 <b>O'chirildi</b> (" + delO.length + "):", ...list(delO.map((x) => "• " + esc(cut(entName(x), 50)) + (/поставка/.test(x.action) ? " — " + esc(x.action.replace(/^Удалена\s*/, "")) : " — obyekt") + " · " + esc(who(x)))));
  const rest = take(/./, isObj);
  if (rest.length) { const m = new Map(); rest.forEach((x) => m.set(entName(x), (m.get(entName(x)) || 0) + 1));
    objRows.push("✏️ <b>Boshqa o'zgarishlar</b> (narx, miqdor, pozitsiya…):", ...list([...m.entries()].sort((a, b) => b[1] - a[1]).map(([n, k]) => "• " + esc(cut(n, 50)) + " — " + k + " ta"))); }
  if (objRows.length) { any = true; L.push("🏠 <b>Obyektlar</b>", ...objRows.flatMap((r, i) => (i && /^[^\s•]/.test(r) ? ["", r] : [r])), ""); }

  // ---------- 3. Ustalardan ----------
  const ur = [];
  if (usta.length) ur.push(...list(usta.map((u) => "• " + esc(cut(u.usta_name, 30)) + (u.object_text ? " — " + esc(cut(u.object_text, 40)) : "") + " (" + (Array.isArray(u.lines) ? u.lines.length : 0) + " poz.)")));
  if (usta.length || ustaNew) ur.push((usta.length ? "" : "Kecha yangi ro'yxat yo'q. ") + "Ko'rib chiqilmagan: <b>" + ustaNew + "</b> ta");
  sect("🔧 <b>Ustalardan</b>" + (usta.length ? " — " + usta.length + " ta yangi ro'yxat" : ""), ur);

  // ---------- 4. Postavshiklar, sklad, tovarlar, ustalar ----------
  const sup = take(/поставщик/i);
  const supRows = sup.map((x) => "• " + esc(x.action) + (entName(x) ? ": " + esc(cut(entName(x), 50)) : ""));
  sect("🏭 <b>Postavshiklar</b>", list(uniq(supRows)));
  const wh = take(/^(Склад|Возврат поставщику со склада)/);
  if (wh.length) { const m = new Map(); wh.forEach((x) => m.set(x.action, (m.get(x.action) || 0) + 1)); sect("📦 <b>Sklad</b>", list([...m.entries()].map(([a, k]) => "• " + esc(a) + " — " + k + " ta"))); }
  const pr = take(/товар|Себестоимость|ИКПУ|Коды товаров/i, (x) => !isObj(x));
  if (pr.length) { const m = new Map(); pr.forEach((x) => m.set(x.action, (m.get(x.action) || 0) + 1)); sect("🏷 <b>Tovarlar bazasi</b>", list([...m.entries()].sort((a, b) => b[1] - a[1]).map(([a, k]) => "• " + esc(a) + " — " + k + " ta"))); }
  const ms = take(/мастер/i);
  sect("👷 <b>Ustalar (mastera)</b>", list(uniq(ms.map((x) => "• " + esc(x.action) + (entName(x) ? ": " + esc(cut(entName(x), 40)) : "")))));
  const other = take(/./);
  if (other.length) { const m = new Map(); other.forEach((x) => m.set(x.action, (m.get(x.action) || 0) + 1)); sect("📋 <b>Boshqa</b>", list([...m.entries()].map(([a, k]) => "• " + esc(cut(a, 70)) + (k > 1 ? " — " + k + " ta" : "")))); }

  // ---------- 5. Kim qancha ish qildi ----------
  if (ev.length) {
    const m = new Map(); ev.forEach((x) => m.set(who(x), (m.get(who(x)) || 0) + 1));
    sect("👥 <b>Kim qancha ish qildi</b>", [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, k]) => "• " + esc(n) + " — " + k + " ta amal"));
  }
  // ---------- 6. Diqqat ----------
  const warn = [];
  const bad = (logs || []).filter((x) => x && x.action === "Неверный облачный пароль" && logDay(x) === day);
  if (bad.length) warn.push("• Noto'g'ri parol: " + bad.length + " marta (" + esc(uniq(bad.map(who)).join(", ")) + ")");
  // скидки правят часто (удалить и ввести заново) — это не тревога; деньги, объекты, база — да
  const undo = ev.filter((x) => /^(Удалена операция: (?!Скидка)|Отменено: Оплата|Удалён объект|Удалены товары|Удалён (сотрудник|аккаунт|поставщик)|База очищена|База восстановлена)/.test(x.action));
  if (undo.length) warn.push("• O'chirish / bekor qilish: " + undo.length + " ta — dasturdagi «Журнал»da ko'ring");
  sect("⚠️ <b>Diqqat</b>", warn);

  if (!any) L.push("Kecha programmada hech qanday ish bo'lmadi.");
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
