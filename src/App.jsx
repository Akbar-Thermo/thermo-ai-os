import React, { useState, useEffect, useMemo, useRef, useDeferredValue, memo, useCallback, createContext, useContext } from "react";
import * as XLSX from "xlsx";
import * as dbModule from "./db.js";
// «сырой» клиент Supabase (db.js экспортирует его рядом с db) — нужен для постраничной загрузки (.range) и массового удаления (.in)
const sb = dbModule.supabase || null;
/* ---- Надёжная запись в базу ----
   1) Если в таблице Supabase нет какой-то колонки (ошибка PGRST204), запись повторяется без неё.
      Раньше такая запись целиком молча не сохранялась, а на экране всё равно писалось «Сохранено».
   2) Любая оставшаяся ошибка показывается на экране (событие te-db-error), а не только в консоли. */
const DB_MISSING = {};
let _lastDbErr = { m: "", at: 0 };
function dbErrText(t, e) {
  const m = String((e && e.message) || e || "");
  if ((e && e.code === "23503") || /foreign key/i.test(m)) return "Запись в «" + t + "» не изменена: на неё ссылаются другие данные.";
  if (/row-level security|permission denied/i.test(m) || (e && e.code === "42501")) return "Нет прав на запись в таблицу «" + t + "» (проверьте RLS в Supabase).";
  if (e && e.code === "NO_COLUMNS") return "Не сохранено: " + m + ".";
  return "Ошибка базы («" + t + "»): " + m;
}
function dbReport(t, e) {
  const msg = dbErrText(t, e), now = Date.now();
  if (msg === _lastDbErr.m && now - _lastDbErr.at < 4000) return;
  _lastDbErr = { m: msg, at: now };
  try { window.dispatchEvent(new CustomEvent("te-db-error", { detail: msg })); } catch (x) {}
}
function dbWrap(real) {
  return {
    from(t) {
      const calls = [];
      const strip = (col) => {
        let hit = false;
        calls.forEach(([m, a]) => {
          if (m !== "insert" && m !== "update") return;
          (Array.isArray(a[0]) ? a[0] : [a[0]]).forEach((o) => { if (o && Object.prototype.hasOwnProperty.call(o, col)) { delete o[col]; hit = true; } });
        });
        return hit;
      };
      const run = async () => {
        const miss = DB_MISSING[t] || (DB_MISSING[t] = new Set());
        const dropped = [];
        miss.forEach((c) => { if (strip(c)) dropped.push(c); });
        for (let attempt = 0; attempt < 15; attempt++) {
          // запись, у которой не осталось ни одной колонки, не отправляем — это ошибка, а не «успех»
          const w = calls.find(([m]) => m === "insert" || m === "update");
          if (w && (Array.isArray(w[1][0]) ? w[1][0].some((o) => !Object.keys(o).length) : !Object.keys(w[1][0] || {}).length)) {
            const r = { data: [], error: { message: "в таблице «" + t + "» нет колонок: " + dropped.join(", "), code: "NO_COLUMNS" }, dropped };
            dbReport(t, r.error); return r;
          }
          let qq = real.from(t);
          for (const [m, a] of calls) qq = qq[m](...a);
          const r = await qq;
          const e = r && r.error;
          const mm = e && /Could not find the '([^']+)' column/i.exec(e.message || "");
          if (mm && strip(mm[1])) { miss.add(mm[1]); dropped.push(mm[1]); console.warn("[db] в таблице " + t + " нет колонки «" + mm[1] + "» — запись повторена без неё"); continue; }
          if (e) dbReport(t, e);
          if (r && dropped.length) r.dropped = dropped;
          return r;
        }
        return { data: [], error: { message: "слишком много отсутствующих колонок в «" + t + "»" } };
      };
      const q = new Proxy({}, {
        get(_, prop) {
          if (prop === "then") return (res, rej) => run().then(res, rej);
          if (prop === "catch") return (rej) => run().catch(rej);
          if (typeof prop === "symbol") return undefined;
          return (...args) => {
            // копия данных записи: при повторе без колонки не портим объект вызывающего кода
            if ((prop === "insert" || prop === "update") && args[0] && typeof args[0] === "object")
              args = [Array.isArray(args[0]) ? args[0].map((r) => ({ ...r })) : { ...args[0] }, ...args.slice(1)];
            calls.push([prop, args]); return q;
          };
        },
      });
      return q;
    },
  };
}
const db = dbWrap(dbModule.db);

/* ============================================================
   THERMO ENGINEERING — AI Procurement & Finance OS
   DATA LAYER = Supabase (db импортируется из ./db.js)
   ============================================================ */

const SEGMENTS = ["эконом", "комфорт", "премиум"];
const OBJ_STATUSES = [
  { id: "draft", label: "Черновик", c: "#9a9a9a" },
  { id: "review", label: "На проверке", c: "#ffb020" },
  { id: "approved", label: "Согласовано", c: "#ffffff" },
  { id: "partial", label: "Частично оплачено", c: "#ff707b" },
  { id: "paid", label: "Оплачено", c: "#3ddc7d" },
  { id: "shipped", label: "Отгружено", c: "#d6d6d6" },
  { id: "settled", label: "Рассчитано", c: "#4db8ff" },
  { id: "closed", label: "Закрыто", c: "#3ddc7d" },
  { id: "cancelled", label: "Отменено", c: "#ff4d5e" },
];
const OP_TYPES = [
  { id: "client_payment", label: "Оплата клиента" },
  { id: "supplier_payment", label: "Оплата поставщику" },
  { id: "return", label: "Возврат товара" },
  { id: "discount", label: "Скидка" },
  { id: "expense", label: "Доп. расход" },
  { id: "bonus", label: "Бонус мастеру (начисление)" },
  { id: "bonus_payment", label: "Выплата бонуса мастеру" },
];
// бонусы мастеру начисляются и показываются только в разделе «Мастера»
// оплата поставщику — только из раздела «Поставщики» (кнопка на странице объекта убрана)
const OBJECT_OP_TYPES = ["client_payment", "return", "discount", "expense"];
const MASTER_ONLY_OPS = ["bonus", "bonus_payment"];
const ROLES = [
  { id: "manager", label: "Менеджер", tabs: ["request", "objects", "products", "wh", "suppliers", "masters", "finance"] },
  { id: "boss", label: "Руководитель", tabs: ["dash", "request", "objects", "products", "wh", "suppliers", "masters", "finance", "log", "admin"] },
];
const MANAGER_OP_TYPES = ["client_payment", "return", "discount"];
const CONF_THRESHOLD = 80;
const EXPENSE_CATEGORIES = ["Зарплата", "Аренда", "Коммунальные", "Обед / питание", "Транспорт / ГСМ", "Связь / интернет", "Налоги", "Реклама", "Хозрасходы", "Прочее"];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
:root{
  --bg:#f7f7f8; --panel:#ffffff; --panel2:#f1f1f3; --line:#e2e2e6; --line2:#d4d4da;
  --txt:#15151a; --mut:#6b6b73; --acc:#ff1f30; --acc2:#d6001a; --ok:#1f9d52; --warn:#b97300; --bad:#d6283b;
  --mono:'JetBrains Mono',monospace; --sans:'Manrope',sans-serif;
  --hdr-bg:#0c0c0c; --hdr-txt:#ffffff; --hdr-mut:#9a9a9a; --hdr-line:#262626; --hdr-panel2:#1a1a1a;
}
.te.dark{
  --bg:#111115; --panel:#1a1a20; --panel2:#222228; --line:#2e2e36; --line2:#3a3a44;
  --txt:#e8e8f0; --mut:#8888a0; --ok:#3ddc7d; --warn:#e6a020; --bad:#ff4d5e;
}
.te{--viz-s1:#2a78d6;--viz-s2:#eb6834;--viz-grid:#e1e0d9;--viz-axis:#c3c2b7}
.te.dark{--viz-s1:#3987e5;--viz-s2:#d95926;--viz-grid:#2c2c2a;--viz-axis:#383835}
@media(max-width:820px){.dash .kpi[style*="span 2"]{grid-column:auto!important}}
.te.dark table.t tr:hover td{background:rgba(255,255,255,.04)}
.te.dark .pick-row:hover{background-color:#2a1a1c !important}
*{box-sizing:border-box;margin:0;padding:0}
.te{font-family:var(--sans);background:var(--bg);color:var(--txt);min-height:100vh;font-size:14px}
.hdr{display:flex;align-items:center;gap:14px;padding:14px 22px;border-bottom:2px solid var(--acc);flex-wrap:wrap;position:sticky;top:0;background:var(--hdr-bg);z-index:50;box-shadow:0 6px 24px rgba(0,0,0,.18);transition:transform .25s ease}
@media(max-width:820px){.hdr.hide-on-scroll{transform:translateY(-100%)}}
.logo{font-weight:800;letter-spacing:.5px;font-size:17px;color:var(--hdr-txt)}
.logo span{color:var(--acc)}
.logo small{display:block;font-weight:500;color:var(--hdr-mut);font-size:10px;letter-spacing:2px;text-transform:uppercase}
.tabs{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}
.tab{padding:8px 14px;border-radius:8px;border:1px solid transparent;color:var(--hdr-mut);cursor:pointer;font-weight:600;font-size:13px;background:none;font-family:var(--sans)}
.burger{display:none;align-items:center;justify-content:center;width:38px;height:38px;border-radius:8px;border:1px solid var(--hdr-line);background:var(--hdr-panel2);color:var(--hdr-txt);cursor:pointer;font-size:18px;margin-left:auto}
@media(max-width:820px){
  .tabs{display:none;position:absolute;top:100%;left:0;right:0;flex-direction:column;flex-wrap:nowrap;gap:0;margin:0;background:var(--hdr-bg);border-bottom:2px solid var(--acc);box-shadow:0 16px 30px rgba(0,0,0,.6);padding:6px;z-index:60}
  .tabs.open{display:flex}
  .tab{width:100%;text-align:left;padding:12px 14px;border-radius:6px}
  .burger{display:flex}
}
.tab:hover{color:var(--hdr-txt);background:var(--hdr-panel2)}
.tab.on{color:#fff;border-color:var(--acc);background:var(--acc);box-shadow:0 4px 16px rgba(255,31,48,.35)}
.hdr .btn{background:var(--hdr-panel2);border-color:var(--hdr-line);color:var(--hdr-txt)}
.hdr .btn:hover{border-color:var(--acc);color:var(--acc)}
.hdr .mut{color:var(--hdr-mut)}
.body{padding:20px 22px;max-width:1280px;margin:0 auto}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.grid{display:grid;gap:12px}
h2{font-size:18px;font-weight:800;margin-bottom:4px}
h3{font-size:14px;font-weight:700}
.mut{color:var(--mut)}.sm{font-size:12px}.xs{font-size:11px}
.mono{font-family:var(--mono)}
.btn{padding:8px 14px;border-radius:8px;border:1px solid var(--line2);background:var(--panel2);color:var(--txt);cursor:pointer;font-weight:700;font-size:13px;font-family:var(--sans);white-space:nowrap}
.btn:hover{border-color:var(--acc);color:var(--acc2)}
.btn.pri{background:var(--acc);border-color:var(--acc);color:#fff;box-shadow:0 4px 14px rgba(255,31,48,.3)}
.btn.pri:hover{background:#ff3b4a;color:#fff}
.btn.dng{color:var(--bad)}
.btn:disabled{opacity:.45;cursor:default}
.btn.xs{padding:4px 9px;font-size:11px;border-radius:6px}
.inp,select.inp,textarea.inp{background:var(--panel2);border:1px solid var(--line2);border-radius:8px;color:var(--txt);padding:8px 10px;font-size:13px;font-family:var(--sans);outline:none;width:100%}
.inp:focus{border-color:var(--acc)}
textarea.inp{min-height:120px;font-family:var(--mono);font-size:12px;resize:vertical}
.fld{display:flex;flex-direction:column;gap:4px;min-width:0}
.fld label{font-size:11px;color:var(--mut);font-weight:700;text-transform:uppercase;letter-spacing:.5px}
table.t{width:100%;border-collapse:collapse;font-size:13px}
table.t th{font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:var(--mut);text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);font-weight:700}
table.t td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
.vt-box{overflow:auto;max-height:calc(100vh - 210px);min-height:320px}
table.vt{table-layout:fixed;width:100%;min-width:1040px}
table.vt thead th{position:sticky;top:0;z-index:2;background:var(--panel)}
table.vt td{padding:4px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table.vt td div{overflow:hidden;text-overflow:ellipsis}
table.t tr:hover td{background:rgba(0,0,0,.025)}
.num{font-family:var(--mono);font-size:12px;text-align:right;white-space:nowrap}
.bdg{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;border:1px solid}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.kpi .v{font-family:var(--mono);font-size:20px;font-weight:700;margin-top:4px}
.kpi .l{font-size:11px;color:var(--mut);font-weight:700;text-transform:uppercase;letter-spacing:.6px}
.modal-bg{position:fixed;inset:0;background:rgba(8,9,12,.7);display:flex;align-items:flex-start;justify-content:center;z-index:100;padding:30px 14px;overflow:auto;backdrop-filter:blur(3px)}
.modal{background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:20px;width:100%;box-shadow:0 30px 80px rgba(0,0,0,.6)}
.steps{display:flex;gap:6px;margin:10px 0 18px;flex-wrap:wrap}
.step{padding:6px 12px;border-radius:20px;font-size:12px;font-weight:700;border:1px solid var(--line);color:var(--mut)}
.step.on{border-color:var(--acc);color:#fff;background:var(--acc)}
.step.done{color:var(--ok);border-color:rgba(98,196,98,.4)}
.toast{position:fixed;bottom:20px;right:20px;background:var(--panel2);border:1px solid var(--acc);border-radius:10px;padding:12px 18px;font-weight:700;z-index:200;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.clk{cursor:pointer}
.sect{margin-bottom:18px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:820px){.split{grid-template-columns:1fr}.body{padding:14px}}
.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--mut);border-top-color:var(--acc);border-radius:50%;animation:sp 0.8s linear infinite;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
.conf{font-family:var(--mono);font-weight:700;font-size:12px}
.pick-row:hover{background-color:#fff0f1 !important}
table.t td{position:static}
`;

/* ============ DATA LAYER = Supabase (db из ./db.js) ============ */
const TABLES = ["products", "suppliers", "objects", "finance_ops", "requests", "masters", "warehouse", "wh_moves", "users", "audit_log"];
const uuid = () => {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
};
// Очищает uuid/foreign key поля: пустая строка "" → null (Supabase не принимает "" в uuid-колонках)
const cleanUuids = (obj) => {
  const UUID_FIELDS = ["id", "master_id", "supplier_id", "object_id", "product_id", "item_id"];
  const out = { ...obj };
  UUID_FIELDS.forEach((k) => { if (k in out && out[k] === "") out[k] = null; });
  return out;
};
let CURRENT_USER = null;
async function logAction(action, entity, detail) {
  try {
    await db.from("audit_log").insert({
      action, entity: entity || "", detail: detail || "",
      user_name: CURRENT_USER ? (CURRENT_USER.name || CURRENT_USER.username) : "—",
      role: CURRENT_USER ? CURRENT_USER.role : "—",
      ts: new Date().toISOString(),
    });
  } catch (e) { console.error("log", e); }
}
async function hashPass(pw) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("thermo:" + pw));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) { return "plain:" + pw; }
}
/* ---- Бэкап / восстановление всей базы (JSON) ---- */
function tryDownloadBackup(json) {
  try {
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "thermo_backup_" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return true;
  } catch (e) { console.error(e); return false; }
}
/* Загрузка ВСЕХ строк таблицы без лимита 1000.
   Supabase отдаёт максимум 1000 строк за запрос, поэтому читаем страницами.
   Сортировка created_at + id — стабильная (у строк из одного пакетного импорта created_at одинаковый). */
async function fetchAllRows(t) {
  if (!sb) {
    const { data } = await db.from(t).select().order("created_at", { ascending: true });
    return data || [];
  }
  const PAGE = 1000;
  const page = (from) => sb.from(t).select("*").order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1);
  // узнаём общее количество и грузим страницы параллельно
  const { count, error: cErr } = await sb.from(t).select("*", { count: "exact", head: true });
  if (!cErr && typeof count === "number") {
    const froms = [];
    for (let f = 0; f < count; f += PAGE) froms.push(f);
    const res = await Promise.all(froms.map(page));
    const bad = res.find((r) => r.error);
    const rows = [].concat(...res.map((r) => r.data || []));
    if (!bad && rows.length >= count) return rows;
  }
  // запасной вариант: по одной странице, пока не придёт пустая
  let rows = [], from = 0;
  for (let guard = 0; guard < 10000; guard++) {
    const { data, error } = await page(from);
    if (error) { console.error("[db]", t, error.message); break; }
    if (!data || !data.length) break;
    rows = rows.concat(data);
    from += data.length;
  }
  return rows;
}
/* Массовое удаление по id — пачками, а не по одной строке */
async function deleteByIds(t, ids) {
  if (!ids.length) return;
  if (!sb) { for (const id of ids) await db.from(t).delete().eq("id", id); return; }
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await sb.from(t).delete().in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
}
/* Восстановление из бэкапа.
   Раньше каждая таблица удалялась целиком и вставлялась заново, по порядку TABLES (товары раньше поставщиков).
   В базе связь products.supplier_id → suppliers стоит с ON DELETE SET NULL, поэтому удаление поставщиков
   обнуляло поставщика у ВСЕХ товаров (так 01.10 пропали 11 561 привязка).
   Теперь: записи бэкапа записываются поверх существующих (upsert по id), «родители» раньше зависимых,
   а удаляются только лишние записи, которых нет в бэкапе, — зависимые раньше «родителей». */
const RESTORE_ORDER = ["suppliers", "masters", "users", "products", "objects", "warehouse", "finance_ops", "requests", "wh_moves", "audit_log"];
async function restoreFromSupabase(dump) {
  if (!dump || !dump.tables) throw new Error("Неверный формат бэкапа");
  const tables = RESTORE_ORDER.filter((t) => Array.isArray(dump.tables[t]));
  if (sb) {
    for (const t of tables) {
      const rows = dump.tables[t];
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from(t).upsert(rows.slice(i, i + 500), { onConflict: "id" });
        if (error) throw new Error(t + ": " + error.message);
      }
    }
    for (const t of [...tables].reverse()) {
      const keep = new Set(dump.tables[t].map((r) => r.id));
      const existing = await fetchAllRows(t);
      await deleteByIds(t, existing.filter((r) => !keep.has(r.id)).map((r) => r.id));
    }
    return;
  }
  // без прямого клиента Supabase: удаляем зависимые → «родителей», вставляем «родителей» → зависимые
  for (const t of [...tables].reverse()) { const ex = await fetchAllRows(t); await deleteByIds(t, ex.map((r) => r.id)); }
  for (const t of tables) if (dump.tables[t].length) await batchInsert(t, dump.tables[t]);
}
async function importBackup(file) {
  const text = await file.text();
  const dump = JSON.parse(text);
  await restoreFromSupabase(dump);
}


/* ============ HELPERS ============ */
const fmt = (n) => (Number(n) || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const fmt2 = (n) => (Number(n) || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// валюта учёта — доллар США (себестоимость и цены в базе в $)
// розничная цена: если в базе не задана (0), берём себестоимость + стандартная наценка (как в «Новая заявка»)
const DEFAULT_MARKUP = 15;
const retailOf = (p) => (Number(p && p.price) > 0 ? Number(p.price) : Math.round((Number(p && p.cost) || 0) * (1 + DEFAULT_MARKUP / 100) * 100) / 100);
const money = (n) => ((Number(n) || 0) < 0 ? "−$" + fmt(-(Number(n) || 0)) : "$" + fmt(n));
const dt = (s) => (s ? new Date(s).toLocaleDateString("ru-RU") : "—");
const today = () => new Date().toISOString().slice(0, 10);
const stById = (id) => OBJ_STATUSES.find((s) => s.id === id) || OBJ_STATUSES[0];
const opLabel = (id) => (OP_TYPES.find((o) => o.id === id) || {}).label || id;

function calcObject(obj, ops) {
  const items = obj.items || [];
  let sale = 0, cost = 0;
  items.forEach((i) => { sale += (i.qty || 0) * (i.price || 0); cost += (i.qty || 0) * (i.cost || 0); });
  const o = (ops || []).filter((x) => x.object_id === obj.id && !x.voided);
  const sum = (t, f = "amount") => o.filter((x) => x.type === t).reduce((a, x) => a + (x[f] || 0), 0);
  const retSale = sum("return"), retCost = sum("return", "cost_amount");
  const discount = sum("discount"), expense = sum("expense"), bonus = sum("bonus");
  const paidClient = sum("client_payment"), paidSup = sum("supplier_payment");
  const saleNet = sale - retSale - discount;
  const costNet = cost - retCost;
  const gross = saleNet - costNet;
  const net = gross - expense - bonus;
  return {
    sale, cost, retSale, retCost, discount, expense, bonus, paidClient, paidSup,
    saleNet, costNet, gross, net,
    margin: saleNet > 0 ? (gross / saleNet) * 100 : 0,
    clientDebt: saleNet - paidClient,
    supplierDebt: Math.max(0, costNet - paidSup),
  };
}
/* Какие возвраты уменьшают долг поставщику.
   · Возврат со склада поставщику (Склад → «↩ поставщику», операция без object_id) — уменьшает.
   · Возврат с объекта «сразу поставщику» (в операции есть supplier_id, на склад не приходовался) — уменьшает.
   · Возврат клиента с объекта на Склад Thermo — НЕ уменьшает: товар остался у нас.
     Раньше он уменьшал долг, а при последующем возврате со склада поставщику долг уменьшался второй раз.
   Старые возвраты на склад хранили supplier_id в операции; их узнаём по записи прихода на склад (wh_moves)
   с тем же объектом, товаром, количеством и датой. */
let _retCache = { ops: null, wh: null, ids: null };
function supplierReturnIds(ops, whMoves) {
  if (_retCache.ops === ops && _retCache.wh === whMoves && _retCache.ids) return _retCache.ids;
  const key = (o) => o.object_id + "|" + (o.product_id || "") + "|" + Number(o.qty || 0) + "|" + String(o.op_date || o.created_at || "").slice(0, 10);
  const inWh = {};
  (whMoves || []).forEach((w) => { if (w.dir === "in" && w.object_id) { const k = key(w); inWh[k] = (inWh[k] || 0) + 1; } });
  const rets = (ops || []).filter((x) => x.type === "return");
  const take = (x) => { const k = key(x); if (inWh[k]) { inWh[k]--; return true; } return false; };
  rets.forEach((x) => { if (x.object_id && !x.supplier_id) take(x); });              // новые возвраты на склад
  rets.forEach((x) => { if (x.object_id && x.supplier_id && x.voided) take(x); });    // сторнированные
  const ids = new Set();
  rets.forEach((x) => {
    if (x.voided || !x.supplier_id) return;
    if (!x.object_id) { ids.add(x.id); return; }
    if (!take(x)) ids.add(x.id);
  });
  _retCache = { ops, wh: whMoves, ids };
  return ids;
}
function supplierStats(sup, objects, ops, whMoves) {
  let purchases = 0;
  objects.forEach((ob) => {
    if (ob.status === "cancelled") return;
    (ob.items || []).forEach((i) => { if (i.supplier_id === sup.id && !i.from_warehouse) purchases += (i.qty || 0) * (i.cost || 0); });
  });
  const ids = supplierReturnIds(ops, whMoves);
  const o = ops.filter((x) => !x.voided && x.supplier_id === sup.id);
  const paid = o.filter((x) => x.type === "supplier_payment").reduce((a, x) => a + (x.amount || 0), 0);
  const returns = o.filter((x) => x.type === "return" && ids.has(x.id)).reduce((a, x) => a + (x.cost_amount || 0), 0);
  const balance = purchases - returns - paid; // < 0 — переплата (аванс поставщику)
  return { purchases, paid, returns, balance, debt: Math.max(0, balance) };
}
function masterStats(m, objects, ops) {
  const objs = objects.filter((o) => o.status !== "cancelled" && (o.master_id === m.id || (o.master && o.master === m.name)));
  let sale = 0, gross = 0, net = 0, accrued = 0, clientDebt = 0;
  const rows = objs.map((o) => {
    const f = calcObject(o, ops);
    sale += f.saleNet; gross += f.gross; net += f.net; accrued += f.bonus; clientDebt += Math.max(0, f.clientDebt);
    return { o, f };
  });
  const direct = (ops || []).filter((x) => !x.voided && x.type === "bonus" && x.master_id === m.id && !x.object_id).reduce((a, x) => a + (x.amount || 0), 0);
  accrued += direct;
  const paid = (ops || []).filter((x) => !x.voided && x.type === "bonus_payment" && x.master_id === m.id).reduce((a, x) => a + (x.amount || 0), 0);
  return { rows, count: objs.length, sale, gross, net, accrued, direct, paid, clientDebt,
    debtToMaster: Math.max(0, accrued - paid),
    suggested: gross * ((m.bonus_percent || 0) / 100) };
}
/* ---- Склад Thermo: приход с возвратов, отгрузка на объекты ---- */
async function warehouseIn(returnOps, sourceObjName) {
  for (const op of returnOps) {
    const { data: ex } = await db.from("warehouse").select().eq("product_id", op.product_id);
    if (ex.length) {
      await db.from("warehouse").update({ qty: (ex[0].qty || 0) + op.qty, cost: op.cost_amount / op.qty || ex[0].cost, price: op.amount / op.qty || ex[0].price }).eq("id", ex[0].id);
    } else {
      await db.from("warehouse").insert({
        product_id: op.product_id, name: op.product_name, qty: op.qty,
        cost: op.qty ? op.cost_amount / op.qty : 0, price: op.qty ? op.amount / op.qty : 0,
        supplier_id: op.supplier_id || null, unit: op.unit || "шт", size: op.size || "",
      });
    }
    await db.from("wh_moves").insert({
      product_id: op.product_id, name: op.product_name, qty: op.qty, dir: "in",
      object_id: op.object_id, object_name: sourceObjName, op_date: op.op_date, user: op.user, note: "возврат с объекта",
    });
  }
}
async function warehouseOut(lines, targetObj, user) {
  for (const l of lines) {
    await db.from("warehouse").update({ qty: Math.max(0, l.row.qty - l.qty) }).eq("id", l.row.id);
    await db.from("wh_moves").insert({
      product_id: l.row.product_id, name: l.row.name, qty: l.qty, dir: "out",
      object_id: targetObj.id, object_name: targetObj.name, op_date: today(), user, note: "отгрузка на объект",
    });
  }
}
/* Лист Excel с нормальной вёрсткой:
   cols  — ширина колонок в символах (иначе подбирается по содержимому);
   money — номера колонок с суммами (формат 1 234,50);
   строка из одной ячейки (заголовок, «Клиент: …») растягивается на всю ширину таблицы. */
function makeSheet(rows, opts = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const nCols = opts.cols ? opts.cols.length : Math.max(1, ...rows.map((r) => r.length));
  const widths = opts.cols || Array.from({ length: nCols }, (_, c) =>
    Math.min(70, Math.max(6, ...rows.filter((r) => r.length > 1).map((r) => String(r[c] == null ? "" : r[c]).length + 2))));
  ws["!cols"] = widths.map((wch) => ({ wch }));
  const merges = [];
  rows.forEach((r, i) => { if (r.length === 1 && r[0] !== "" && r[0] != null && nCols > 1) merges.push({ s: { r: i, c: 0 }, e: { r: i, c: nCols - 1 } }); });
  (opts.merges || []).forEach((m) => merges.push(m));
  if (merges.length) ws["!merges"] = merges;
  (opts.money || []).forEach((c) => rows.forEach((r, i) => {
    const cell = ws[XLSX.utils.encode_cell({ r: i, c })];
    if (cell && cell.t === "n") cell.z = "#,##0.00";
  }));
  return ws;
}
function downloadXLSX(filename, rows, sheetName, opts) {
  try {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, makeSheet(rows, opts), sheetName || "Лист1");
    XLSX.writeFile(wb, filename);
    return "xlsx";
  } catch (e) {
    console.error(e);
    try { downloadCSV(filename.replace(/\.xlsx$/i, ".csv"), rows); return "csv"; } catch (e2) { console.error(e2); return false; }
  }
}
function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}
/* ============ EXCEL С РАМКАМИ ============
   Свой мини-генератор .xlsx (без сторонних библиотек): рамки, жирные заголовки, серая шапка,
   ширина колонок, объединённые строки, формат сумм. Строки описываются видом:
   title / info / section — одна ячейка на всю ширину; head — шапка таблицы; row — строка таблицы;
   total — итог (подпись на колонки 2…n-1, сумма в последней); blank — пустая строка.
   types — тип каждой колонки: c — по центру, t — текст, n — число, m — сумма. */
const XL_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const xlCrc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = XL_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function xlZip(files) { // ZIP без сжатия (stored)
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  files.forEach(([name, text]) => {
    const nb = enc.encode(name), data = enc.encode(text), crc = xlCrc32(data);
    const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
    parts.push(new Uint8Array(head), nb, data);
    central.push([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)], nb);
    off += head.length + nb.length + data.length;
  });
  let cenLen = 0;
  central.forEach((c, i) => { const a = i % 2 === 0 ? new Uint8Array(c) : c; parts.push(a); cenLen += a.length; });
  parts.push(new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cenLen), ...u32(off), ...u16(0)]));
  return new Blob(parts, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
const xlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const xlCol = (c) => { let s = ""; c++; while (c) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
// стили: 0 обычный, 1 заголовок 14 жирный, 2 жирный, 3 шапка, 4 текст в рамке, 5 число в рамке, 6 сумма в рамке,
//        7 подпись итога (жирный, вправо, рамка), 8 сумма итога (жирная, рамка), 9 по центру в рамке
const XL_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>'
  + '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E8E8"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
  + '<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
function xlSheetXml(rows, cols, types) {
  const n = cols.length, merges = [];
  const cell = (r, c, v, s) => {
    const ref = xlCol(c) + (r + 1);
    if (v === "" || v == null) return '<c r="' + ref + '" s="' + s + '"/>';
    if (typeof v === "number" && isFinite(v)) return '<c r="' + ref + '" s="' + s + '"><v>' + v + "</v></c>";
    return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + xlEsc(v) + "</t></is></c>";
  };
  const body = rows.map((row, r) => {
    const k = row.k, v = row.v || [];
    let cs = "";
    if (k === "title" || k === "info" || k === "section") {
      cs = cell(r, 0, v[0], k === "title" ? 1 : k === "section" ? 2 : 0);
      if (n > 1) merges.push("A" + (r + 1) + ":" + xlCol(n - 1) + (r + 1));
    } else if (k === "head") {
      cs = v.map((x, c) => cell(r, c, x, 3)).join("");
    } else if (k === "row") {
      cs = cols.map((_, c) => { const t = types[c] || "t"; return cell(r, c, v[c], t === "m" ? 6 : t === "n" ? 5 : t === "c" ? 9 : 4); }).join("");
    } else if (k === "total") {
      cs = cell(r, 0, "", 0);
      for (let c = 1; c < n - 1; c++) cs += cell(r, c, c === 1 ? v[0] : "", 7);
      cs += cell(r, n - 1, v[1], 8);
      if (n > 3) merges.push("B" + (r + 1) + ":" + xlCol(n - 2) + (r + 1));
    }
    const ht = k === "title" ? ' ht="22" customHeight="1"' : "";
    return '<row r="' + (r + 1) + '"' + ht + ">" + cs + "</row>";
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + "<cols>" + cols.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join("") + "</cols>"
    + "<sheetData>" + body + "</sheetData>"
    + (merges.length ? '<mergeCells count="' + merges.length + '">' + merges.map((m) => '<mergeCell ref="' + m + '"/>').join("") + "</mergeCells>" : "")
    + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>';
}
function styledXlsxBlob(sheetName, rows, cols, types) {
  const name = xlEsc(String(sheetName || "Лист1").replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  return xlZip([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + name + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ["xl/styles.xml", XL_STYLES],
    ["xl/worksheets/sheet1.xml", xlSheetXml(rows, cols, types)],
  ]);
}
// скачать таблицу с рамками; при ошибке — CSV
function downloadStyledXLSX(filename, sheetName, rows, cols, types) {
  try {
    const blob = styledXlsxBlob(sheetName, rows, cols, types);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return "xlsx";
  } catch (e) {
    console.error(e);
    try { downloadCSV(filename.replace(/\.xlsx$/i, ".csv"), rows.map((r) => (r.k === "total" ? ["", r.v[0], "", "", "", r.v[1]] : r.v || []))); return "csv"; } catch (e2) { console.error(e2); return false; }
  }
}
async function batchInsert(table, rows, chunkSize = 500, onProgress) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await db.from(table).insert(chunk);
    if (error) throw new Error("строки " + (i + 1) + "–" + (i + chunk.length) + ": " + error.message + (i ? " (первые " + i + " уже загружены)" : ""));
    if (onProgress) onProgress(i + chunk.length, rows.length);
  }
}

/* ============ SHARED UI ============ */
const Fld = ({ label, children }) => (<div className="fld"><label>{label}</label>{children}</div>);
const Badge = ({ c, children }) => (<span className="bdg" style={{ color: c, borderColor: c + "66", background: c + "14" }}>{children}</span>);
const Conf = ({ v }) => {
  const c = v >= CONF_THRESHOLD ? "var(--ok)" : v >= 50 ? "var(--warn)" : "var(--bad)";
  return <span className="conf" style={{ color: c }}>{v}%</span>;
};
function Modal({ title, onClose, children, w = 640 }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: w }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <h3>{title}</h3>
          <button className="btn xs" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
/* ============ ЛЮДИ (менеджеры / ответственные) ============
   Список собирается из того, что уже есть в базе: аккаунты, менеджеры объектов, ответственные в операциях.
   «+ добавить нового…» — новое имя сразу выбирается и сохраняется вместе с записью, после чего оно
   появляется в списке у всех. Отдельная таблица в базе не нужна. */
const PeopleCtx = createContext({ people: [], addPerson: () => {} });
const curUserName = () => (CURRENT_USER ? (CURRENT_USER.name || CURRENT_USER.username || "") : "");
function PersonSelect({ value, onChange, placeholder = "—", compact = false }) {
  const { people, addPerson } = useContext(PeopleCtx);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const opts = value && !people.includes(value) ? [value, ...people] : people;
  const cancel = () => { setAdding(false); setName(""); };
  const save = () => { const n = name.trim().replace(/\s+/g, " "); if (!n) return; addPerson(n); onChange(n); cancel(); };
  const small = { display: "inline-block", width: "auto", padding: "2px 6px", fontSize: 12 };
  if (adding && compact) return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input className="inp" style={{ ...small, width: 150 }} autoFocus placeholder="Имя и фамилия" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } else if (e.key === "Escape") cancel(); }} />
      <button className="btn xs pri" disabled={!name.trim()} onClick={save}>OK</button>
      <button className="btn xs" onClick={cancel}>✕</button>
    </span>
  );
  if (adding) return (
    <div className="card" style={{ padding: 8 }}>
      <input className="inp" autoFocus placeholder="Имя и фамилия" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); save(); } else if (e.key === "Escape") { e.stopPropagation(); cancel(); } }} />
      <div className="row" style={{ marginTop: 6, justifyContent: "flex-end", gap: 6 }}>
        <button className="btn xs" onClick={cancel}>Отмена</button>
        <button className="btn xs pri" disabled={!name.trim()} onClick={save}>Добавить</button>
      </div>
    </div>
  );
  return (
    <select className="inp" style={compact ? small : undefined} value={value || ""} onChange={(e) => { if (e.target.value === "__add__") setAdding(true); else onChange(e.target.value); }}>
      <option value="">{placeholder}</option>
      {opts.map((p) => <option key={p} value={p}>{p}</option>)}
      <option value="__add__">+ добавить нового…</option>
    </select>
  );
}

/* ============ СПОСОБЫ ОПЛАТЫ ============
   Учёт ведётся в $. Оплата в сумах (наличные сум, перечисление, карта в сумах) вводится в сумах + курс;
   в учёт идёт сумма, пересчитанная в $. Способ, сумма в сумах и курс сохраняются в операции
   (колонки pay_method / pay_currency / pay_amount / pay_rate, если они есть в базе) и всегда — текстом в reason.
   Поступления от клиентов — 4 способа; выплаты (поставщикам, расходы, бонусы мастерам) — $, карта, перечисление. */
// «Наличные» — одна кнопка с выбором валюты ($ / сум); внутри это два способа: usd и uzs
const PAY_METHODS = [
  { id: "usd", label: "Наличные $", cur: "usd" },
  { id: "uzs", label: "Наличные сум", cur: "uzs" },
  { id: "card", label: "Карта", cur: null }, // валюту выбирают
  { id: "transfer", label: "Перечисление", cur: null, def: "uzs" }, // валюту выбирают, по умолчанию сум
];
const OUT_METHODS = PAY_METHODS; // выплаты — теми же способами, что и поступления
const PAY_GROUPS = [
  { key: "cash", label: "Наличные", ids: ["usd", "uzs"] },
  { key: "card", label: "Карта", ids: ["card"] },
  { key: "transfer", label: "Перечисление", ids: ["transfer"] },
];
const PAY_IN_TYPES = ["client_payment"];
const PAY_OUT_TYPES = ["supplier_payment", "expense", "company_expense", "bonus_payment"];
const isPayType = (t) => PAY_IN_TYPES.includes(t) || PAY_OUT_TYPES.includes(t);
const payMethodsFor = (type) => (PAY_IN_TYPES.includes(type) ? PAY_METHODS : OUT_METHODS);
const PAY_USD_LABEL = { client_payment: "В долг клиента, $", supplier_payment: "В счёт долга поставщику, $", bonus_payment: "Выплата мастеру, $" };
const payUsdLabel = (type) => PAY_USD_LABEL[type] || "Расход, $";
const RATE_KEY = "te:usd_rate";
const lastRate = () => { try { return Number(localStorage.getItem(RATE_KEY)) || ""; } catch (e) { return ""; } };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const parseNum = (x) => Number(String(x || "").replace(/[\s\u00a0\u202f]/g, "").replace(",", ".")) || 0;
const payMethod = (id) => PAY_METHODS.find((m) => m.id === id) || PAY_METHODS[0];
// «… 1 260 000 сум × курс 12 600» в тексте операции
const SUM_RATE_RE = /([\d\s\u00a0\u202f.,]+)\s*\u0441\u0443\u043c\s*\u00d7\s*\u043a\u0443\u0440\u0441\s*([\d\s\u00a0\u202f.,]+)/;
// способ оплаты, записанный в операции: колонки pay_* или (если их нет в базе) текст в reason / category
function payInfo(op) {
  if (!op || (op.type && !isPayType(op.type))) return { id: null, cur: null, uzs: 0, rate: 0 }; // у возвратов/скидок reason — это причина
  let m = op.pay_method ? PAY_METHODS.find((x) => x.id === op.pay_method) : null;
  if (!m && op.type === "client_payment" && op.category) m = PAY_METHODS.find((x) => x.label === op.category);
  if (!m && op.reason) m = PAY_METHODS.find((x) => String(op.reason).startsWith(x.label));
  if (!m) return { id: null, cur: null, uzs: 0, rate: 0 };
  const r = op.reason ? SUM_RATE_RE.exec(op.reason) : null;
  const cur = op.pay_currency ? String(op.pay_currency).toLowerCase() : r ? "uzs" : m.cur || "usd";
  const uzs = cur === "uzs" ? (op.pay_currency && Number(op.pay_amount)) || (r ? parseNum(r[1]) : 0) : 0;
  const rate = cur === "uzs" ? Number(op.pay_rate) || (r ? parseNum(r[2]) : 0) : 0;
  return { id: m.id, label: m.label, cur, uzs, rate };
}
// подпись способа для списков: «Перечисление: 1 260 000 сум × курс 12 600», «Карта ($)», «Наличные $»
function payText(op) {
  const i = payInfo(op);
  if (!i.id) return "";
  return i.cur === "uzs" ? i.label + ": " + fmt(i.uzs) + " сум" + (i.rate ? " × курс " + fmt(i.rate) : "") : i.label + (payMethod(i.id).cur === null ? " ($)" : "");
}
// детали операции без повтора способа оплаты (он уже записан в reason)
const opDetails = (o, extra = []) => [...extra, o.item_name, payInfo(o).id ? payText(o) : o.reason, o.note].filter(Boolean).join(" · ");
function payInit(op, defUsd) {
  const i = payInfo(op);
  const method = i.id || "usd";
  const cur = i.id ? i.cur : payMethod(method).cur || "usd";
  return { method, cur, usd: op ? op.amount || "" : defUsd || "", uzs: i.uzs || "", rate: i.rate || lastRate() };
}
const payUsd = (p) => (p.cur === "uzs" ? (Number(p.rate) > 0 ? round2(Number(p.uzs) / Number(p.rate)) : 0) : round2(p.usd));
// подставить сумму в $ (кнопки «весь долг» и т.п.): при оплате в сумах пересчитывает по курсу
const paySetUsd = (p, usd) => ({ ...p, usd: round2(usd), uzs: p.cur === "uzs" && Number(p.rate) > 0 ? Math.round(usd * Number(p.rate)) : p.uzs });
// remember=false при исправлении старой операции: её курс не становится курсом по умолчанию для новых оплат
function payPatch(p, type = "client_payment", remember = true) {
  const m = payMethod(p.method), usd = payUsd(p);
  const reason = p.cur === "uzs" ? m.label + ": " + fmt(p.uzs) + " сум × курс " + fmt(p.rate) : m.label + (m.cur === null ? " ($)" : "");
  if (remember && p.cur === "uzs" && Number(p.rate) > 0) { try { localStorage.setItem(RATE_KEY, String(p.rate)); } catch (e) {} }
  const out = { amount: usd, reason, pay_method: m.id, pay_currency: p.cur.toUpperCase(),
    pay_amount: p.cur === "uzs" ? Number(p.uzs) || 0 : usd, pay_rate: p.cur === "uzs" ? Number(p.rate) || null : null };
  if (type === "client_payment") out.category = m.label; // у расходов компании category — это статья расхода
  return out;
}
function PayFields({ p, setP, methods = PAY_METHODS, usdLabel = "В долг клиента, $" }) {
  const m = payMethod(p.method);
  const ids = methods.map((x) => x.id);
  const groups = PAY_GROUPS.map((g) => ({ ...g, ids: g.ids.filter((id) => ids.includes(id)) })).filter((g) => g.ids.length);
  const group = groups.find((g) => g.ids.includes(p.method));
  const isCash = group && group.key === "cash";
  // наличные: валюта задаёт способ (usd / uzs); карта: валюта отдельно; перечисление — всегда сум
  const pickGroup = (g) => {
    if (g.key === "cash") { const id = p.cur === "uzs" && g.ids.includes("uzs") ? "uzs" : g.ids[0]; setP({ ...p, method: id, cur: payMethod(id).cur }); return; }
    const mm = payMethod(g.ids[0]); setP({ ...p, method: mm.id, cur: mm.cur || mm.def || p.cur || "usd" });
  };
  const setCur = (cur) => {
    if (isCash) { const id = cur === "uzs" ? "uzs" : "usd"; if (ids.includes(id)) setP({ ...p, method: id, cur }); return; }
    setP({ ...p, cur });
  };
  const usd = payUsd(p);
  return (
    <div style={{ gridColumn: "1/-1" }}>
      <Fld label="Способ оплаты">
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {groups.map((g) => <button key={g.key} type="button" className={"btn xs " + (group && group.key === g.key ? "pri" : "")} onClick={() => pickGroup(g)}>{g.label}</button>)}
          {(m.cur === null || (isCash && group.ids.length > 1)) && (
            <span className="row" style={{ gap: 4, marginLeft: 8 }}>
              <span className="xs mut">валюта:</span>
              <button type="button" className={"btn xs " + (p.cur === "usd" ? "pri" : "")} onClick={() => setCur("usd")}>$</button>
              <button type="button" className={"btn xs " + (p.cur === "uzs" ? "pri" : "")} onClick={() => setCur("uzs")}>сум</button>
            </span>
          )}
        </div>
      </Fld>
      {p.cur === "uzs" ? (
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginTop: 8 }}>
          <Fld label="Сумма, сум"><input type="number" className="inp" value={p.uzs} onChange={(e) => setP({ ...p, uzs: e.target.value })} placeholder="1 250 000" autoFocus /></Fld>
          <Fld label="Курс, сум за $1"><input type="number" className="inp" value={p.rate} onChange={(e) => setP({ ...p, rate: e.target.value })} placeholder="12 600" style={{ borderColor: Number(p.rate) > 0 ? undefined : "var(--bad)" }} /></Fld>
          <div className="fld"><label>{usdLabel}</label><div className="inp mono" style={{ background: "var(--panel2)", fontWeight: 800, color: usd > 0 ? "var(--ok)" : "var(--mut)" }}>{Number(p.rate) > 0 ? money(usd) : "введите курс"}</div></div>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "1fr 2fr", marginTop: 8 }}>
          <Fld label="Сумма, $"><input type="number" className="inp" value={p.usd} onChange={(e) => setP({ ...p, usd: e.target.value })} autoFocus /></Fld>
        </div>
      )}
    </div>
  );
}

/* Подтверждение отмены: введённые позиции не сохранятся */
function DiscardConfirm({ text, onStay, onDiscard }) {
  return (
    <div className="modal-bg" style={{ zIndex: 200 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onStay(); }}>
      <div className="modal" style={{ maxWidth: 420, marginTop: "18vh" }}>
        <h3 style={{ marginBottom: 10 }}>Отменить добавление товаров?</h3>
        <p className="sm mut">{text}</p>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
          <button className="btn" autoFocus onClick={onStay}>Нет, продолжить</button>
          <button className="btn dng" onClick={onDiscard}>Да, отменить</button>
        </div>
      </div>
    </div>
  );
}
function ProductPicker({ products, onPick, placeholder }) {
  // показываем ВСЕ найденные товары (без лимита). Список прокручивается, рисуются только видимые строки.
  // Поиск по словам: «труба 25» найдёт «ХВС ТРУБА PN16 - 25» (все слова, в любом порядке).
  const ROW = 50, BOX_H = 380;
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [top, setTop] = useState(0);
  const listRef = useRef(null);
  const idx = useMemo(() => products.map((p) => (p.name + " " + (p.alt_names || "") + " " + (p.code || "")).toLowerCase()), [products]);
  const hits = useMemo(() => {
    const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (q.trim().length < 2) return [];
    const out = [];
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      if (p.status === "archive") continue;
      const s = idx[i];
      if (words.every((w) => s.includes(w))) out.push(p);
    }
    return out;
  }, [q, products, idx]);
  useEffect(() => { setTop(0); if (listRef.current) listRef.current.scrollTop = 0; }, [q]);
  // при навигации стрелками держим активную строку в видимой области
  useEffect(() => {
    const el = listRef.current;
    if (activeIdx < 0 || !el) return;
    const y = activeIdx * ROW;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ROW > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW - el.clientHeight;
  }, [activeIdx]);
  const pick = (p) => { onPick(p); setQ(""); setActiveIdx(-1); };
  const onKeyDown = (e) => {
    if (!hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "PageDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 7, hits.length - 1)); }
    else if (e.key === "PageUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 7, 0)); }
    else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); pick(hits[activeIdx]); }
    else if (e.key === "Escape") { setQ(""); setActiveIdx(-1); }
  };
  const start = Math.max(0, Math.floor(top / ROW) - 8);
  const end = Math.min(hits.length, Math.ceil((top + BOX_H) / ROW) + 8);
  const noHits = q.trim().length >= 2 && !hits.length;
  return (
    <div style={{ position: "relative", minWidth: 220, flex: 1, zIndex: hits.length || noHits ? 999 : "auto" }}>
      <input className="inp" placeholder={placeholder || "Поиск товара для добавления…"} value={q}
        onChange={(e) => { setQ(e.target.value); setActiveIdx(-1); }}
        onKeyDown={onKeyDown} />
      {(hits.length > 0 || noHits) && (
        <div style={{ position: "absolute", top: "105%", left: 0, right: 0, backgroundColor: "var(--panel)", border: "1px solid var(--acc)", borderRadius: 8, zIndex: 1000, boxShadow: "0 16px 44px rgba(0,0,0,.18), 0 0 0 1px rgba(255,31,48,.15)", isolation: "isolate", overflow: "hidden" }}>
          <div className="xs mut" style={{ padding: "6px 11px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
            <span>{noHits ? "Ничего не найдено" : "Найдено: " + hits.length}</span>
            {hits.length > 1 && <span>↑↓ выбор · Enter добавить</span>}
          </div>
          {hits.length > 0 && (
            <div ref={listRef} onScroll={(e) => setTop(e.currentTarget.scrollTop)} style={{ maxHeight: BOX_H, overflow: "auto" }}>
              <div style={{ height: hits.length * ROW, position: "relative" }}>
                {hits.slice(start, end).map((p, k) => {
                  const i = start + k;
                  return (
                    <div key={p.id} className="clk pick-row" title={p.name}
                      style={{ position: "absolute", top: i * ROW, left: 0, right: 0, height: ROW, boxSizing: "border-box", padding: "7px 11px", borderBottom: "1px solid var(--line)", backgroundColor: i === activeIdx ? "rgba(255,31,48,.08)" : "var(--panel)", overflow: "hidden" }}
                      onClick={() => pick(p)}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--txt)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                      <div className="xs mono" style={{ color: "var(--mut)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[p.code, p.size].filter(Boolean).join(" · ")} · {Number(p.price) > 0 ? money(p.price) : "≈" + money(retailOf(p))} · ост. {p.stock}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============ PRODUCTS TAB ============ */
const PROD_ROW_H = 46;
// строка таблицы товаров — memo: при отметке одной галочки не перерисовываются остальные тысячи строк
const ProductRow = memo(function ProductRow({ p, checked, sup, onToggle, onEdit }) {
  return (
    <tr style={{ height: PROD_ROW_H, opacity: p.status === "archive" ? 0.45 : 1, background: checked ? "rgba(255,31,48,.07)" : "none" }}>
      <td><input type="checkbox" checked={checked} onChange={() => onToggle(p.id)} /></td>
      <td className="mono xs">{p.code}</td>
      <td className="sm">{p.brand}</td>
      <td className="sm">{sup}</td>
      <td title={p.name}><div style={{ fontWeight: 600 }}>{p.name}</div>{(p.category || p.alt_names) && <div className="xs mut">{[p.category, p.alt_names].filter(Boolean).join(" · ")}</div>}</td>
      <td className="mono xs">{p.size}</td>
      <td className="sm">{p.unit}</td>
      <td className="num">{fmt2(p.cost)}</td>
      <td className="num">{Number(p.price) > 0 ? fmt2(p.price) : <span className="mut" title={"Розничная цена не задана — при добавлении в объект: себестоимость + " + DEFAULT_MARKUP + "%"}>≈ {fmt2(retailOf(p))}</span>}</td>
      <td><button className="btn xs" onClick={() => onEdit(p)}>ред.</button></td>
    </tr>
  );
});
function ProductsTab({ data, reload, toast }) {
  const { products, suppliers } = data;
  const [q, setQ] = useState("");
  const [supF, setSupF] = useState("");
  const [brandF, setBrandF] = useState("");
  const [edit, setEdit] = useState(null);
  const [imp, setImp] = useState(false);
  const [sel, setSel] = useState([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // показываем ВСЕ товары одним списком с прокруткой; браузер рисует только видимые строки
  // (15 000 строк таблицы сразу — это секунды на каждое действие). Поиск откладывается, чтобы ввод не тормозил.
  const dq = useDeferredValue(q);
  const boxRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(700);
  useEffect(() => {
    const upd = () => { if (boxRef.current) setViewH(boxRef.current.clientHeight || 700); };
    upd(); window.addEventListener("resize", upd); return () => window.removeEventListener("resize", upd);
  }, []);
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = 0; setScrollTop(0); }, [dq, supF, brandF]);
  const brands = useMemo(() => [...new Set(products.map((p) => p.brand).filter(Boolean))].sort(), [products]);
  const searchIdx = useMemo(() => products.map((p) => (p.name + " " + (p.alt_names || "") + " " + p.code + " " + (p.category || "")).toLowerCase()), [products]);
  const list = useMemo(() => {
    const ql = dq.toLowerCase();
    return products.filter((p, i) =>
      (!supF || p.supplier_id === supF) &&
      (!brandF || p.brand === brandF) &&
      (!ql || searchIdx[i].includes(ql))
    );
  }, [products, searchIdx, dq, supF, brandF]);
  const supById = useMemo(() => { const m = {}; suppliers.forEach((s) => { m[s.id] = s.name; }); return m; }, [suppliers]);
  const supName = (id) => supById[id] || "—";
  const selSet = useMemo(() => new Set(sel), [sel]);
  const allSel = list.length > 0 && list.every((p) => selSet.has(p.id));
  const toggleAll = () => {
    if (allSel) { const ids = new Set(list.map((p) => p.id)); setSel(sel.filter((id) => !ids.has(id))); }
    else setSel([...new Set([...sel, ...list.map((p) => p.id)])]);
  };
  const toggle = useCallback((id) => setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])), []);
  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteByIds("products", sel);
      setConfirmDel(false); const n = sel.length; setSel([]); await reload(); toast("Удалено товаров: " + n);
    } catch (e) { toast("Ошибка удаления: " + e.message); }
    setDeleting(false);
  };
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>База товаров <span className="mut sm">({list.length !== products.length ? list.length + " из " + products.length : products.length})</span></h2>
        <input className="inp" style={{ maxWidth: 200 }} placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp" style={{ maxWidth: 170 }} value={supF} onChange={(e) => setSupF(e.target.value)}>
          <option value="">Все поставщики</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="inp" style={{ maxWidth: 150 }} value={brandF} onChange={(e) => setBrandF(e.target.value)}>
          <option value="">Все бренды</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        {sel.length > 0 && <button className="btn dng" onClick={() => setConfirmDel(true)}>🗑 Удалить ({sel.length})</button>}
        <button className="btn" onClick={() => setImp(true)}>Импорт Excel/CSV</button>
        <button className="btn pri" onClick={() => setEdit({ unit: "шт", status: "active", stock: 0, cost: 0, price: 0 })}>+ Товар</button>
      </div>
      <div className="card vt-box" ref={boxRef} style={{ padding: 0 }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <table className="t vt">
          <colgroup><col style={{ width: 36 }} /><col style={{ width: 110 }} /><col style={{ width: 110 }} /><col style={{ width: 140 }} /><col /><col style={{ width: 90 }} /><col style={{ width: 70 }} /><col style={{ width: 120 }} /><col style={{ width: 110 }} /><col style={{ width: 64 }} /></colgroup>
          <thead><tr><th><input type="checkbox" checked={allSel} onChange={toggleAll} title="Выбрать все отфильтрованные" /></th><th>Код</th><th>Бренд</th><th>Поставщик</th><th>Наименование</th><th>Размер/Ø</th><th>Ед.изм</th><th style={{textAlign:"right"}}>Себестоимость</th><th style={{textAlign:"right"}}>Розничная</th><th></th></tr></thead>
          <tbody>
            {(() => {
              const start = Math.max(0, Math.floor(scrollTop / PROD_ROW_H) - 15);
              const end = Math.min(list.length, Math.ceil((scrollTop + viewH) / PROD_ROW_H) + 15);
              return (<>
                {start > 0 && <tr style={{ height: start * PROD_ROW_H }}><td colSpan={10} style={{ padding: 0, border: 0 }} /></tr>}
                {list.slice(start, end).map((p) => (
                  <ProductRow key={p.id} p={p} checked={selSet.has(p.id)} sup={supName(p.supplier_id)} onToggle={toggle} onEdit={setEdit} />
                ))}
                {end < list.length && <tr style={{ height: (list.length - end) * PROD_ROW_H }}><td colSpan={10} style={{ padding: 0, border: 0 }} /></tr>}
              </>);
            })()}
            {!list.length && <tr><td colSpan={10} className="mut" style={{ textAlign: "center", padding: 26 }}>Ничего не найдено</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <ProductForm p={edit} suppliers={suppliers} onClose={() => setEdit(null)} onSave={async (vals) => {
        if (vals.id) await db.from("products").update(vals).eq("id", vals.id);
        else await db.from("products").insert({ ...vals, price_updated: new Date().toISOString() });
        setEdit(null); await reload(); toast("Товар сохранён");
      }} />}
      {imp && <ImportModal suppliers={suppliers} onClose={() => setImp(false)} onDone={async (n) => { setImp(false); await reload(); toast("Импортировано позиций: " + n); }} />}
      {confirmDel && (
        <Modal title="Подтверждение удаления" onClose={() => setConfirmDel(false)} w={440}>
          <p style={{ marginBottom: 6 }}>Удалить <b style={{ color: "var(--bad)" }}>{sel.length}</b> {sel.length === 1 ? "товар" : sel.length < 5 ? "товара" : "товаров"} из базы?</p>
          <p className="sm mut" style={{ marginBottom: 16 }}>Действие необратимо. Позиции, уже добавленные в объекты, в объектах останутся. Если товар может понадобиться позже — лучше перевести его в «архив» через редактирование.</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setConfirmDel(false)}>Отмена</button>
            <button className="btn" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} disabled={deleting} onClick={doDelete}>{deleting ? "Удаляю…" : "Удалить " + sel.length}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ProductForm({ p, suppliers, onClose, onSave }) {
  const [v, setV] = useState({ ...p });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const setN = (k) => (e) => setV({ ...v, [k]: Number(e.target.value) || 0 });
  return (
    <Modal title={v.id ? "Редактировать товар" : "Новый товар"} onClose={onClose} w={700}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <Fld label="Код"><input className="inp" value={v.code || ""} onChange={set("code")} /></Fld>
        <Fld label="Категория"><input className="inp" value={v.category || ""} onChange={set("category")} /></Fld>
        <Fld label="Бренд"><input className="inp" value={v.brand || ""} onChange={set("brand")} /></Fld>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Название"><input className="inp" value={v.name || ""} onChange={set("name")} /></Fld></div>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Альтернативные названия (для AI-поиска)"><input className="inp" value={v.alt_names || ""} onChange={set("alt_names")} placeholder="через запятую: батарея, радиатор…" /></Fld></div>
        <Fld label="Размер"><input className="inp" value={v.size || ""} onChange={set("size")} /></Fld>
        <Fld label="Ед. изм."><input className="inp" value={v.unit || ""} onChange={set("unit")} /></Fld>
        <Fld label="Поставщик"><select className="inp" value={v.supplier_id || ""} onChange={set("supplier_id")}><option value="">—</option>{activeSuppliers(suppliers, v.supplier_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>
        <Fld label="Закупочная цена"><input type="number" className="inp" value={v.cost || 0} onChange={setN("cost")} /></Fld>
        <Fld label="Цена продажи"><input type="number" className="inp" value={v.price || 0} onChange={setN("price")} /></Fld>
        <Fld label="Остаток"><input type="number" className="inp" value={v.stock || 0} onChange={setN("stock")} /></Fld>
        <Fld label="Мин. остаток"><input type="number" className="inp" value={v.min_stock || 0} onChange={setN("min_stock")} /></Fld>
        <Fld label="Статус"><select className="inp" value={v.status} onChange={set("status")}><option value="active">активен</option><option value="archive">архив</option></select></Fld>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" disabled={!v.name} onClick={() => onSave(v)}>Сохранить</button>
      </div>
    </Modal>
  );
}
function ImportModal({ suppliers, onClose, onDone }) {
  const FIELDS = [
    { id: "name", label: "Название*", kw: ["наименован", "назван", "товар", "name", "номенклат"] },
    { id: "cost", label: "Закуп. цена", kw: ["закуп", "приход", "опт", "cost", "себест"] },
    { id: "price", label: "Цена продажи", kw: ["продаж", "розниц", "цена", "price", "retail"] },
    { id: "supplier", label: "Поставщик", kw: ["поставщ", "supplier", "постав"] },
    { id: "category", label: "Категория", kw: ["категор", "группа", "category"] },
    { id: "size", label: "Размер", kw: ["размер", "диаметр", "size", "типоразмер"] },
    { id: "unit", label: "Ед. изм.", kw: ["ед", "изм", "unit"] },
    { id: "stock", label: "Остаток", kw: ["остат", "наличи", "кол-во", "количеств", "qty", "stock"] },
    { id: "brand", label: "Бренд", kw: ["бренд", "производ", "марка", "brand"] },
    { id: "code", label: "Код/Артикул", kw: ["код", "артикул", "sku", "art"] },
    { id: "segment", label: "Сегмент", kw: ["сегмент", "класс", "segment"] },
  ];
  const [rows, setRows] = useState(null);
  const [map, setMap] = useState({});
  const [hasHeader, setHasHeader] = useState(true);
  const [fname, setFname] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [txt, setTxt] = useState("");
  const [sid, setSid] = useState("");
  const [prog, setProg] = useState("");
  const fRef = useRef(null);

  const num =(v) => Number(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")) || 0;

  const guessMap = (header) => {
    const m = {};
    header.forEach((h, i) => {
      const hl = String(h || "").toLowerCase();
      for (const f of FIELDS) {
        if (m[f.id] == null && f.kw.some((k) => hl.includes(k))) { m[f.id] = i; break; }
      }
    });
    return m;
  };
  const onFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setErr(""); setFname(f.name);
    const r = new FileReader();
    r.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(r.result), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }).filter((row) => row.some((c) => String(c).trim() !== ""));
        if (!data.length) { setErr("Лист пустой"); return; }
        setRows(data);
        setMap(guessMap(data[0]));
        setHasHeader(true);
      } catch (e2) { setErr("Не удалось прочитать файл: " + e2.message); }
    };
    r.readAsArrayBuffer(f);
  };

  const dataRows = rows ? (hasHeader ? rows.slice(1) : rows) : [];
  const cols = rows ? Math.max(...rows.map((r) => r.length)) : 0;
  const header = rows ? (hasHeader ? rows[0] : Array.from({ length: cols }, (_, i) => "Колонка " + (i + 1))) : [];
  const cell = (row, fid) => (map[fid] == null ? "" : row[map[fid]]);

  const runExcel = async () => {
    if (map.name == null) { setErr("Укажите колонку «Название»"); return; }
    setBusy(true); setErr("");
    try {
      const supCache = {};
      suppliers.forEach((s) => { supCache[s.name.toLowerCase().trim()] = s.id; });
      const products = [];
      let newSups = 0;
      for (const row of dataRows) {
        const name = String(cell(row, "name") || "").trim();
        if (!name) continue;
        let supplier_id = sid || null;
        const supName = String(cell(row, "supplier") || "").trim();
        if (supName) {
          const key = supName.toLowerCase();
          if (!supCache[key]) {
            const { data: ins } = await db.from("suppliers").insert({ name: supName, segment: "комфорт", status: "active", terms: "", contact: "", phone: "" });
            supCache[key] = ins[0].id; newSups++;
          }
          supplier_id = supCache[key];
        }
        const segRaw = String(cell(row, "segment") || "").toLowerCase().trim();
        products.push({
          code: String(cell(row, "code") || "").trim() || "IMP-" + Math.random().toString(36).slice(2, 7).toUpperCase(),
          name, category: String(cell(row, "category") || "").trim(), size: String(cell(row, "size") || "").trim(),
          unit: String(cell(row, "unit") || "").trim() || "шт",
          segment: SEGMENTS.includes(segRaw) ? segRaw : "комфорт",
          cost: num(cell(row, "cost")), price: num(cell(row, "price")), stock: num(cell(row, "stock")),
          brand: String(cell(row, "brand") || "").trim(), supplier_id,
          status: "active", min_stock: 0, price_updated: new Date().toISOString(),
        });
      }
      if (products.length) await batchInsert("products", products, 500, (d, n) => setProg(d + " / " + n));
      onDone(products.length + (newSups ? " (+ новых поставщиков: " + newSups + ")" : ""));
    } catch (e) { setErr("Ошибка импорта: " + e.message); }
    setBusy(false);
  };

  const runPaste = async () => {
    const lines = txt.split("\n").map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const l of lines) {
      const c = l.split(/\t|;/).map((x) => x.trim());
      if (c.length < 4) continue;
      out.push({
        code: c[0] || "IMP-" + Math.random().toString(36).slice(2, 7).toUpperCase(),
        name: c[1], category: c[2] || "", size: c[3] || "", unit: c[4] || "шт",
        segment: SEGMENTS.includes(c[5]) ? c[5] : "комфорт",
        cost: num(c[6]), price: num(c[7]), stock: num(c[8]),
        brand: c[9] || "", supplier_id: sid || null, status: "active", min_stock: 0,
        price_updated: new Date().toISOString(),
      });
    }
    if (out.length) await batchInsert("products", out);
    onDone(out.length);
  };

  return (
    <Modal title="Импорт товаров из Excel" onClose={onClose} w={900}>
      {err && <div className="card sect" style={{ borderColor: "var(--bad)", color: "var(--bad)", padding: 10 }}>{err}</div>}
      {!rows && (
        <div>
          <div className="card clk" style={{ borderStyle: "dashed", textAlign: "center", padding: 34, marginBottom: 14 }} onClick={() => fRef.current.click()}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>📊</div>
            <div style={{ fontWeight: 800 }}>Выбрать файл Excel (.xlsx / .xls / .csv)</div>
            <div className="xs mut" style={{ marginTop: 4 }}>Один лист: наименования, цены, поставщики — колонки определятся автоматически</div>
          </div>
          <input ref={fRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={onFile} />
          <details>
            <summary className="sm mut clk" style={{ marginBottom: 8 }}>…или вставить текстом (TAB / « ; »)</summary>
            <Fld label="Поставщик для всех строк (опционально)">
              <select className="inp" value={sid} onChange={(e) => setSid(e.target.value)}><option value="">—</option>{activeSuppliers(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </Fld>
            <textarea className="inp" style={{ marginTop: 10, minHeight: 140 }} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={"TRB-040\tТруба PPR Ø40\tТрубы PPR\t40 мм\tм\tкомфорт\t30000\t45000\t500\tValtec"} />
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn pri" disabled={!txt.trim()} onClick={runPaste}>Импортировать текст</button>
            </div>
          </details>
        </div>
      )}
      {rows && (
        <div>
          <div className="row" style={{ marginBottom: 12 }}>
            <Badge c="#fff">{fname}</Badge>
            <span className="sm mut">строк данных: {dataRows.length}</span>
            <label className="sm clk" style={{ marginLeft: "auto" }}>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> первая строка — заголовки
            </label>
            <button className="btn xs" onClick={() => { setRows(null); setMap({}); }}>↺ другой файл</button>
          </div>
          <h3 style={{ marginBottom: 8 }}>Сопоставление колонок <span className="xs mut">(авто-определено — проверьте)</span></h3>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", marginBottom: 14 }}>
            {FIELDS.map((f) => (
              <Fld key={f.id} label={f.label}>
                <select className="inp" value={map[f.id] == null ? "" : map[f.id]} onChange={(e) => setMap({ ...map, [f.id]: e.target.value === "" ? null : Number(e.target.value) })}>
                  <option value="">— нет —</option>
                  {header.map((h, i) => <option key={i} value={i}>{String(h || "Колонка " + (i + 1)).slice(0, 28)}</option>)}
                </select>
              </Fld>
            ))}
          </div>
          {sid === "" && map.supplier == null && (
            <Fld label="Поставщик для всех строк (колонка не найдена)">
              <select className="inp" style={{ maxWidth: 280 }} value={sid} onChange={(e) => setSid(e.target.value)}><option value="">—</option>{activeSuppliers(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </Fld>
          )}
          <h3 style={{ margin: "12px 0 8px" }}>Предпросмотр (первые 5)</h3>
          <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
            <table className="t">
              <thead><tr><th>Название</th><th>Категория</th><th>Размер</th><th>Ед</th><th style={{textAlign:"right"}}>Закуп</th><th style={{textAlign:"right"}}>Продажа</th><th style={{textAlign:"right"}}>Остаток</th><th>Поставщик</th><th>Бренд</th></tr></thead>
              <tbody>
                {dataRows.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    <td className="sm" style={{ fontWeight: 600 }}>{String(cell(r, "name"))}</td>
                    <td className="sm">{String(cell(r, "category"))}</td>
                    <td className="mono xs">{String(cell(r, "size"))}</td>
                    <td className="sm">{String(cell(r, "unit")) || "шт"}</td>
                    <td className="num">{fmt(num(cell(r, "cost")))}</td>
                    <td className="num">{fmt(num(cell(r, "price")))}</td>
                    <td className="num">{fmt(num(cell(r, "stock")))}</td>
                    <td className="sm">{String(cell(r, "supplier"))}</td>
                    <td className="sm">{String(cell(r, "brand"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn pri" disabled={busy || map.name == null} onClick={runExcel}>
              {busy ? <span><span className="spin" /> Импортирую… {prog}</span> : "Импортировать " + dataRows.length + " строк →"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ============ SUPPLIERS TAB ============ */
function AktSverkaModal({ s, objects, ops, whMoves, products, onClose }) {
  // Received items (purchases) from all non-cancelled objects
  const received = [];
  objects.forEach((ob) => {
    if (ob.status === "cancelled") return;
    (ob.items || []).forEach((it) => {
      if (it.supplier_id === s.id && !it.from_warehouse) {
        received.push({ ...it, obj_name: ob.name, obj_id: ob.id, date: it.batch_date || ob.created_at });
      }
    });
  });
  // Возвраты поставщику (уменьшают долг). Возвраты клиентов на Склад Thermo долг не уменьшают — показаны отдельно
  const retIdsAkt = supplierReturnIds(ops, whMoves);
  const returns = ops.filter((o) => !o.voided && o.type === "return" && o.supplier_id === s.id && retIdsAkt.has(o.id));
  const itemSup = {};
  objects.forEach((ob) => (ob.items || []).forEach((it) => { itemSup[it.id] = it.supplier_id; }));
  const toWh = ops.filter((o) => !o.voided && o.type === "return" && o.object_id && !retIdsAkt.has(o.id) && (o.supplier_id === s.id || (o.item_id && itemSup[o.item_id] === s.id)));
  const toWhCost = toWh.reduce((a, o) => a + (o.cost_amount || 0), 0);
  // Payments to this supplier
  const payments = ops.filter((o) => !o.voided && o.type === "supplier_payment" && o.supplier_id === s.id);
  const totalReceived = received.reduce((a, it) => a + (it.qty || 0) * (it.cost || 0), 0);
  const totalReturns = returns.reduce((a, o) => a + (o.cost_amount || 0), 0);
  const totalPaid = payments.reduce((a, o) => a + (o.amount || 0), 0);
  const balance = totalReceived - totalReturns - totalPaid; // < 0 — переплата (аванс)
  // группировка полученных товаров: объект + номер поставки
  const batches = useMemo(() => {
    const m = new Map();
    received.forEach((it) => {
      const no = it.batch_no || 1;
      const key = it.obj_id + "#" + no;
      if (!m.has(key)) m.set(key, { key, obj_name: it.obj_name, no, date: it.date, items: [], sum: 0 });
      const g = m.get(key);
      g.items.push(it); g.sum += (it.qty || 0) * (it.cost || 0);
      if (it.date && (!g.date || it.date < g.date)) g.date = it.date;
    });
    return [...m.values()].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.obj_name.localeCompare(b.obj_name) || a.no - b.no);
  }, [objects, s.id]);
  // группировка возвратов по тем же поставкам: возврат с объекта хранит item_id → у позиции есть номер поставки
  const retGroups = useMemo(() => {
    const itemIdx = {};
    objects.forEach((ob) => (ob.items || []).forEach((it) => { itemIdx[it.id] = { ob, it }; }));
    const m = new Map();
    returns.forEach((o) => {
      let key, label, date, obName = "", no = null;
      let hit = o.item_id && itemIdx[o.item_id];
      if (!hit && o.object_id) {
        const ob = objects.find((x) => x.id === o.object_id);
        const it = ob && (ob.items || []).find((i) => i.product_id && i.product_id === o.product_id && i.supplier_id === s.id);
        if (it) hit = { ob, it };
        else if (ob) { key = ob.id + "#?"; obName = ob.name; label = ob.name + " · поставка не указана"; }
      }
      if (hit) {
        no = hit.it.batch_no || 1; obName = hit.ob.name;
        key = hit.ob.id + "#" + no; label = hit.ob.name + " · Поставка №" + no;
        date = hit.it.batch_date || hit.ob.created_at;
      }
      if (!key) { key = "wh"; label = "Со склада Thermo (возврат поставщику)"; }
      if (!m.has(key)) m.set(key, { key, label, obName, no, date, ops: [], sum: 0 });
      const g = m.get(key);
      g.ops.push(o); g.sum += o.cost_amount || 0;
      const d = o.op_date || o.created_at;
      if (!g.date || (g.no == null && d && d < g.date)) g.date = d;
    });
    return [...m.values()].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.label.localeCompare(b.label));
  }, [objects, ops, s.id, whMoves]);
  const retByKey = useMemo(() => { const r = {}; retGroups.forEach((g) => { r[g.key] = g.sum; }); return r; }, [retGroups]);
  const [closed, setClosed] = useState({});
  const [rClosed, setRClosed] = useState({});
  const allClosed = batches.length > 0 && batches.every((g) => closed[g.key]);
  const toggleAll = () => { const n = {}; if (!allClosed) batches.forEach((g) => { n[g.key] = true; }); setClosed(n); };
  return (
    <Modal title={"Акт-сверка: " + s.name} onClose={onClose} w={860}>
      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Получено товаров</div><div className="v">{fmt(totalReceived)}</div></div>
        <div className="kpi"><div className="l">Возвраты</div><div className="v" style={{ color: "var(--warn)" }}>{fmt(totalReturns)}</div></div>
        <div className="kpi"><div className="l">Оплачено</div><div className="v" style={{ color: "var(--ok)" }}>{fmt(totalPaid)}</div></div>
        <div className="kpi"><div className="l">{balance < 0 ? "Аванс (переплата)" : "Долг"}</div><div className="v" style={{ color: balColor(balance) }}>{signedMoney(balance)}</div></div>
      </div>
      <details open>
        <summary className="sm" style={{ cursor: "pointer", fontWeight: 700, marginBottom: 8 }}>
          Полученные товары по поставкам ({batches.length} {batches.length === 1 ? "поставка" : batches.length > 1 && batches.length < 5 ? "поставки" : "поставок"}, {received.length} поз.)
          {batches.length > 1 && <button className="btn xs" style={{ marginLeft: 10 }} onClick={(e) => { e.preventDefault(); toggleAll(); }}>{allClosed ? "Развернуть все" : "Свернуть все"}</button>}
        </summary>
        <div style={{ overflow: "auto", maxHeight: 440 }}>
          <table className="t"><thead><tr><th>Товар</th><th style={{textAlign:"right"}}>Кол-во</th><th>Ед.</th><th style={{textAlign:"right"}}>Себест.</th><th style={{textAlign:"right"}}>Сумма</th></tr></thead>
            <tbody>
              {batches.map((g) => (
                <React.Fragment key={g.key}>
                  <tr className="clk" onClick={() => setClosed((c) => ({ ...c, [g.key]: !c[g.key] }))} style={{ background: "rgba(255,31,48,.06)" }}>
                    <td colSpan={4} style={{ fontWeight: 700 }}>
                      <span className="mut" style={{ display: "inline-block", width: 14 }}>{closed[g.key] ? "▸" : "▾"}</span>
                      🚚 {g.obj_name} · Поставка №{g.no} · <span className="mono">{dt(g.date)}</span>
                      <span className="xs mut" style={{ fontWeight: 400 }}> · позиций: {g.items.length}</span>
                      {retByKey[g.key] > 0 && <span className="xs" style={{ fontWeight: 600, color: "var(--warn)" }}> · возврат −{fmt(retByKey[g.key])}</span>}
                    </td>
                    <td className="num" style={{ fontWeight: 800 }}>{fmt(g.sum)}</td>
                  </tr>
                  {!closed[g.key] && g.items.map((it, i) => (
                    <tr key={g.key + i}>
                      <td className="sm" style={{ paddingLeft: 28 }}>{it.name}{it.size && <div className="xs mut">{it.size}</div>}</td>
                      <td className="num">{it.qty}</td>
                      <td className="xs mut">{it.unit}</td>
                      <td className="num">{fmt(it.cost)}</td>
                      <td className="num">{fmt((it.qty || 0) * (it.cost || 0))}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {!received.length && <tr><td colSpan={5} className="mut sm" style={{padding:14}}>Нет поступлений</td></tr>}
              {received.length > 0 && <tr><td colSpan={4} style={{ fontWeight: 800, textAlign: "right" }}>Итого получено:</td><td className="num" style={{ fontWeight: 800 }}>{fmt(totalReceived)}</td></tr>}
            </tbody>
          </table>
        </div>
      </details>
      <details style={{ marginTop: 12 }}>
        <summary className="sm" style={{ cursor: "pointer", fontWeight: 700, marginBottom: 8 }}>Возвраты поставщику по поставкам ({returns.length})</summary>
        {toWh.length > 0 && <p className="xs mut" style={{ margin: "0 0 8px" }}>Ещё возвращено клиентами на Склад Thermo: {toWh.length} поз. на {fmt(toWhCost)} по себестоимости — долг поставщику они не уменьшают, пока товар не вернут поставщику (Склад Thermo → «↩ поставщику»).</p>}
        <div style={{ overflow: "auto", maxHeight: 360 }}>
        <table className="t"><thead><tr><th>Товар</th><th style={{textAlign:"right"}}>Кол-во</th><th style={{textAlign:"right"}}>Сумма (себест.)</th><th>Дата возврата</th><th>Причина</th></tr></thead>
          <tbody>
            {retGroups.map((g) => (
              <React.Fragment key={g.key}>
                <tr className="clk" onClick={() => setRClosed((c) => ({ ...c, [g.key]: !c[g.key] }))} style={{ background: "rgba(255,176,32,.09)" }}>
                  <td colSpan={2} style={{ fontWeight: 700 }}>
                    <span className="mut" style={{ display: "inline-block", width: 14 }}>{rClosed[g.key] ? "▸" : "▾"}</span>
                    ↩ {g.label}{g.no != null && g.date ? <> · <span className="mono">{dt(g.date)}</span></> : null}
                    <span className="xs mut" style={{ fontWeight: 400 }}> · позиций: {g.ops.length}</span>
                  </td>
                  <td className="num" style={{ fontWeight: 800, color: "var(--warn)" }}>−{fmt(g.sum)}</td>
                  <td colSpan={2}></td>
                </tr>
                {!rClosed[g.key] && g.ops.map((o) => (
                  <tr key={o.id}>
                    <td className="sm" style={{ paddingLeft: 28 }}>{o.product_name || "—"}{o.size && <div className="xs mut">{o.size}</div>}</td>
                    <td className="num">{o.qty || "—"}{o.unit ? <span className="xs mut"> {o.unit}</span> : null}</td>
                    <td className="num" style={{ color: "var(--warn)" }}>{fmt(o.cost_amount || 0)}</td>
                    <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                    <td className="xs mut">{[o.reason, o.note].filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
            {!returns.length && <tr><td colSpan={5} className="mut sm" style={{padding:14}}>Нет возвратов</td></tr>}
            {returns.length > 0 && <tr><td colSpan={2} style={{ fontWeight: 800, textAlign: "right" }}>Итого возвраты:</td><td className="num" style={{ fontWeight: 800, color: "var(--warn)" }}>−{fmt(totalReturns)}</td><td colSpan={2}></td></tr>}
          </tbody>
        </table>
        </div>
      </details>
      <details style={{ marginTop: 12 }}>
        <summary className="sm" style={{ cursor: "pointer", fontWeight: 700, marginBottom: 8 }}>Платежи ({payments.length})</summary>
        <table className="t"><thead><tr><th>Дата</th><th style={{textAlign:"right"}}>Сумма, $</th><th>Способ оплаты</th><th>Кто</th><th>Примечание</th></tr></thead>
          <tbody>{payments.map((o) => <tr key={o.id}><td className="xs mono mut">{dt(o.op_date||o.created_at)}</td><td className="num" style={{color:"var(--ok)",fontWeight:700}}>{fmt(o.amount)}</td><td className="xs">{payText(o) || <span className="mut">не указан</span>}</td><td className="xs mut">{o.user}</td><td className="xs mut">{o.note}</td></tr>)}
          {!payments.length && <tr><td colSpan={5} className="mut sm" style={{padding:14}}>Нет платежей</td></tr>}</tbody>
        </table>
      </details>
    </Modal>
  );
}
// поставщики для выбора в формах: неактивные скрыты (кроме уже выбранного)
const activeSuppliers = (suppliers, keepId) => suppliers.filter((s) => s.status !== "inactive" || (keepId && s.id === keepId));
const signedMoney = (b) => (b < 0 ? "−" + fmt(-b) : fmt(b));
const balColor = (b) => (b > 0 ? "var(--bad)" : b < 0 ? "var(--ok)" : "var(--mut)");

function SuppliersTab({ data, reload, toast, fin = true }) {
  const { suppliers, objects, finance_ops, products, wh_moves } = data;
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [delErr, setDelErr] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [pay, setPay] = useState(null);
  const [akt, setAkt] = useState(null);
  const [q, setQ] = useState("");
  const prodCnt = useMemo(() => { const m = {}; products.forEach((p) => { if (p.supplier_id) m[p.supplier_id] = (m[p.supplier_id] || 0) + 1; }); return m; }, [products]);
  const rows = useMemo(() => suppliers.map((s) => ({ s, st: supplierStats(s, objects, finance_ops, wh_moves) }))
    .sort((a, b) => ((a.s.status === "inactive") - (b.s.status === "inactive")) || String(a.s.name || "").localeCompare(String(b.s.name || ""), "ru")),
    [suppliers, objects, finance_ops, wh_moves]);
  const shown = rows.filter(({ s }) => !q || (String(s.name || "") + " " + (s.contact || "") + " " + (s.phone || "")).toLowerCase().includes(q.toLowerCase()));
  const tot = shown.reduce((a, { st }) => ({ purchases: a.purchases + st.purchases, paid: a.paid + st.paid, returns: a.returns + st.returns, debt: a.debt + st.debt }), { purchases: 0, paid: 0, returns: 0, debt: 0 });
  // оплаты поставщикам без указанного поставщика (форма объекта раньше это позволяла) — не уменьшают ничей долг
  const orphan = finance_ops.filter((o) => o.type === "supplier_payment" && !o.voided && !o.supplier_id);
  const objName = (id) => (objects.find((o) => o.id === id) || {}).name || "—";

  const assignOrphan = async (op, sid) => {
    if (!sid) return;
    const r = await db.from("finance_ops").update({ supplier_id: sid }).eq("id", op.id);
    if (r.error) return;
    await logAction("Оплате указан поставщик", "supplier:" + ((suppliers.find((x) => x.id === sid) || {}).name || ""), fmt(op.amount) + " · " + objName(op.object_id));
    await reload(); toast("Оплата привязана к поставщику");
  };
  const saveSupplier = async (v) => {
    const { id, created_at, ...vals } = v;
    const r = id ? await db.from("suppliers").update(vals).eq("id", id) : await db.from("suppliers").insert(vals);
    if (r.error) return r.error; // форма покажет ошибку и останется открытой
    await logAction(id ? "Изменён поставщик" : "Добавлен поставщик", "supplier:" + (vals.name || ""), "");
    setEdit(null); await reload();
    // предупреждаем, только если пользователь что-то ввёл в поле, которого нет в базе
    const lost = (r.dropped || []).filter((c) => vals[c] != null && String(vals[c]).trim() !== "");
    toast(lost.length ? "Поставщик сохранён. Не сохранено поле «" + lost.join(", ") + "» — такой колонки нет в базе" : "Поставщик сохранён");
    return null;
  };
  const deactivate = async (s) => {
    const r = await db.from("suppliers").update({ status: "inactive" }).eq("id", s.id);
    if (r.error) return;
    await logAction("Поставщик отключён", "supplier:" + s.name, "");
    setDel(null); setDelErr(""); await reload(); toast("«" + s.name + "» отмечен как неактивный — история и долги сохранены");
  };
  const doDelete = async (s) => {
    setDelBusy(true); setDelErr("");
    const ids = products.filter((p) => p.supplier_id === s.id).map((p) => p.id);
    let r = ids.length ? await db.from("products").update({ supplier_id: null }).eq("supplier_id", s.id) : { error: null };
    if (!r.error) r = await db.from("suppliers").delete().eq("id", s.id);
    if (r.error) {
      // откат: база не дала удалить — возвращаем товарам их поставщика
      if (ids.length) {
        if (sb) { for (let i = 0; i < ids.length; i += 200) await sb.from("products").update({ supplier_id: s.id }).in("id", ids.slice(i, i + 200)); }
        else { for (const pid of ids) await db.from("products").update({ supplier_id: s.id }).eq("id", pid); }
      }
      setDelErr("База не дала удалить поставщика (на него ссылаются оплаты или возвраты). Ничего не изменено. Можно отметить его как «неактивен» — он пропадёт из списков выбора, а история останется.");
      setDelBusy(false); await reload(); return;
    }
    await logAction("Удалён поставщик", "supplier:" + s.name, "товаров отвязано: " + ids.length);
    setDelBusy(false); setDel(null); await reload(); toast("Поставщик удалён");
  };

  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Поставщики <span className="mut sm">({suppliers.length})</span></h2>
        <input className="inp" style={{ maxWidth: 220 }} placeholder="Поиск поставщика…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn pri" onClick={() => setEdit({ status: "active" })}>+ Поставщик</button>
      </div>
      {orphan.length > 0 && (
        <div className="card sect" style={{ borderColor: "var(--warn)" }}>
          <div style={{ fontWeight: 800, color: "var(--warn)", marginBottom: 4 }}>⚠ Оплаты поставщикам без указанного поставщика: {orphan.length} на {fmt(orphan.reduce((a, o) => a + (o.amount || 0), 0))}</div>
          <p className="xs mut" style={{ marginBottom: 8 }}>Эти оплаты сделаны со страницы объекта без выбора поставщика, поэтому не уменьшают ничей долг. Укажите поставщика — долг пересчитается.</p>
          <table className="t"><thead><tr><th>Дата</th><th>Объект</th><th style={{ textAlign: "right" }}>Сумма</th><th>Комментарий</th><th>Поставщик</th></tr></thead>
            <tbody>{orphan.map((o) => (
              <tr key={o.id}>
                <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                <td className="sm">{objName(o.object_id)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(o.amount)}</td>
                <td className="xs mut">{o.note}</td>
                <td><select className="inp" defaultValue="" onChange={(e) => assignOrphan(o, e.target.value)}><option value="">— выбрать —</option>{activeSuppliers(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
              </tr>
            ))}</tbody></table>
        </div>
      )}
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Поставщик</th><th>Контакт</th><th>Условия</th><th style={{textAlign:"right"}}>Закупки</th><th style={{textAlign:"right"}}>Оплачено</th><th style={{textAlign:"right"}}>Возвраты</th><th style={{textAlign:"right"}}>Долг</th><th style={{textAlign:"right"}}>Товаров</th><th></th></tr></thead>
          <tbody>
            {shown.map(({ s, st }) => (
              <tr key={s.id} style={{ opacity: s.status === "inactive" ? 0.55 : 1 }}>
                <td style={{ fontWeight: 700 }}>{s.name}{s.status === "inactive" && <> <Badge c="#9a9a9a">неактивен</Badge></>}</td>
                <td className="sm">{s.contact}<div className="xs mut mono">{s.phone}</div></td>
                <td className="sm mut">{s.terms}</td>
                <td className="num">{fmt(st.purchases)}</td>
                <td className="num" style={{ color: "var(--ok)" }}>{fmt(st.paid)}</td>
                <td className="num">{fmt(st.returns)}</td>
                <td className="num" style={{ color: balColor(st.balance), fontWeight: 700 }} title={st.balance < 0 ? "переплата (аванс поставщику)" : ""}>{signedMoney(st.balance)}</td>
                <td className="num">{prodCnt[s.id] || 0}</td>
                <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                  <button className="btn xs" style={{ color: "var(--ok)" }} onClick={() => setPay(s)}>💵 оплата</button>
                  <button className="btn xs" onClick={() => setAkt(s)}>📋 акт</button>
                  <button className="btn xs" onClick={() => setEdit(s)}>ред.</button>
                  {fin && <button className="btn xs dng" onClick={() => { setDelErr(""); setDel(s); }}>✕</button>}
                </div></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={9} className="mut" style={{ textAlign: "center", padding: 24 }}>{suppliers.length ? "Ничего не найдено" : "Поставщиков пока нет — добавьте через «+ Поставщик»"}</td></tr>}
            {shown.length > 1 && (
              <tr style={{ background: "var(--panel2)" }}>
                <td colSpan={3} style={{ fontWeight: 800 }}>Итого{q ? " (по найденным)" : ""}</td>
                <td className="num" style={{ fontWeight: 800 }}>{fmt(tot.purchases)}</td>
                <td className="num" style={{ fontWeight: 800, color: "var(--ok)" }}>{fmt(tot.paid)}</td>
                <td className="num" style={{ fontWeight: 800 }}>{fmt(tot.returns)}</td>
                <td className="num" style={{ fontWeight: 800, color: tot.debt > 0 ? "var(--bad)" : "var(--mut)" }} title="сумма долгов (переплаты не вычитаются)">{fmt(tot.debt)}</td>
                <td colSpan={2}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {akt && <AktSverkaModal s={akt} objects={objects} ops={finance_ops} whMoves={wh_moves} products={products} onClose={() => setAkt(null)} />}
      {pay && <SupplierPayModal s={pay} objects={objects} ops={finance_ops} whMoves={wh_moves} fin={fin} onClose={() => setPay(null)}
        onSave={async (op) => {
          const r = await db.from("finance_ops").insert(cleanUuids(op));
          if (r.error) return false;
          await logAction("Оплата поставщику", "supplier:" + pay.name, fmt(op.amount) + " · " + payText(op) + (op.note ? " · " + op.note : "")); await reload(); toast("Оплата поставщику записана: " + fmt(op.amount) + " · " + payText(op)); return true;
        }}
        onEditPay={async (o, patch) => {
          const log = [...(o.edit_log || []), { at: new Date().toISOString(), before: { amount: o.amount, op_date: o.op_date, note: o.note, reason: o.reason } }];
          const r = await db.from("finance_ops").update({ ...patch, edited: true, edit_log: log }).eq("id", o.id);
          if (r.error) return false;
          await logAction("Изменена оплата поставщику", "supplier:" + pay.name, "было " + fmt(o.amount) + " (" + (payText(o) || "способ не указан") + ") → стало " + fmt(patch.amount) + " (" + payText({ ...o, ...patch }) + ")"); await reload();
          const noLog = r.dropped && r.dropped.includes("edit_log") && !window.__teNoLogWarned;
          if (noLog) window.__teNoLogWarned = true;
          toast(noLog ? "Оплата изменена (история изменений не сохраняется: в базе нет колонки edit_log)" : "Оплата изменена"); return true;
        }}
        onVoidPay={async (o) => {
          const r = await db.from("finance_ops").delete().eq("id", o.id);
          if (r.error) return false;
          await logAction("Удалена оплата поставщику", "supplier:" + pay.name, fmt(o.amount) + " от " + dt(o.op_date || o.created_at) + (payText(o) ? " · " + payText(o) : "") + (o.note ? " · " + o.note : "")); await reload(); toast("Оплата удалена"); return true;
        }} />}
      {del && (() => {
        const st = supplierStats(del, objects, finance_ops, wh_moves);
        const cnt = prodCnt[del.id] || 0;
        const nOps = finance_ops.filter((o) => o.supplier_id === del.id).length;
        return (
          <Modal title="Удалить поставщика" onClose={() => { if (!delBusy) { setDel(null); setDelErr(""); } }} w={500}>
            <p style={{ marginBottom: 8 }}>Удалить поставщика <b style={{ color: "var(--bad)" }}>{del.name}</b>?</p>
            {st.debt > 0 && <p className="sm" style={{ color: "var(--warn)", marginBottom: 6 }}>⚠ Текущий долг поставщику: {fmt(st.debt)} — он исчезнет из учёта долгов.</p>}
            {cnt > 0 && <p className="sm mut" style={{ marginBottom: 6 }}>К нему привязано товаров: {cnt} — они останутся в базе без поставщика.</p>}
            {nOps > 0 && <p className="sm mut" style={{ marginBottom: 6 }}>У поставщика есть операции (оплаты/возвраты): {nOps}. Если нужно только убрать его из списков — лучше «Сделать неактивным»: история и долг сохранятся.</p>}
            {delErr && <p className="sm" style={{ color: "var(--bad)", marginBottom: 8 }}>{delErr}</p>}
            <p className="sm mut" style={{ marginBottom: 12 }}>Удаление необратимо.</p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" disabled={delBusy} onClick={() => { setDel(null); setDelErr(""); }}>Отмена</button>
              {del.status !== "inactive" && <button className="btn" disabled={delBusy} onClick={() => deactivate(del)}>Сделать неактивным</button>}
              <button className="btn" disabled={delBusy} style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={() => doDelete(del)}>{delBusy ? "Удаляю…" : "Удалить"}</button>
            </div>
          </Modal>
        );
      })()}
      {edit && (
        <Modal title={edit.id ? "Поставщик" : "Новый поставщик"} onClose={() => setEdit(null)}>
          <SupplierForm s={edit} all={suppliers} onSave={saveSupplier} />
        </Modal>
      )}
    </div>
  );
}
function SupplierPayModal({ s, objects, ops, whMoves, onClose, onSave, onEditPay, onVoidPay, fin }) {
  const st = supplierStats(s, objects, ops, whMoves);
  const retIds = supplierReturnIds(ops, whMoves);
  const [pay, setPay] = useState(() => payInit(null, st.debt > 0 ? st.debt : 0));
  const [opDate, setOpDate] = useState(today());
  const [note, setNote] = useState("");
  const [user, setUser] = useState(curUserName());
  const [edit, setEdit] = useState(null); // { id, pay, op_date, note }
  const [voidAsk, setVoidAsk] = useState(null);
  const [busy, setBusy] = useState(false);
  const history = ops.filter((o) => o.supplier_id === s.id && (o.type === "supplier_payment" || (o.type === "return" && retIds.has(o.id))))
    .sort((a, b) => String(b.op_date || b.created_at).localeCompare(String(a.op_date || a.created_at)));
  const objName = (id) => (objects.find((o) => o.id === id) || {}).name || "—";
  const save = async () => {
    setBusy(true);
    const ok = await onSave({ type: "supplier_payment", supplier_id: s.id, object_id: null, ...payPatch(pay, "supplier_payment"), op_date: opDate || today(), note, user });
    if (ok) { setPay({ ...pay, usd: 0, uzs: "" }); setNote(""); }
    setBusy(false);
  };
  return (
    <Modal title={"Оплата поставщику — " + s.name} onClose={onClose} w={660}>
      <div className="kpis sect" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="kpi"><div className="l">Закупки</div><div className="v">{fmt(st.purchases)}</div></div>
        <div className="kpi"><div className="l">Возвраты</div><div className="v">{fmt(st.returns)}</div></div>
        <div className="kpi"><div className="l">Оплачено</div><div className="v" style={{ color: "var(--ok)" }}>{fmt(st.paid)}</div></div>
        <div className="kpi"><div className="l">{st.balance < 0 ? "Аванс (переплата)" : "Текущий долг"}</div><div className="v" style={{ color: balColor(st.balance) }}>{signedMoney(st.balance)}</div></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <PayFields p={pay} setP={setPay} methods={OUT_METHODS} usdLabel={payUsdLabel("supplier_payment")} />
        <Fld label="Дата оплаты"><input type="date" className="inp" value={opDate} onChange={(e) => setOpDate(e.target.value)} /></Fld>
        <Fld label="Комментарий"><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="часть / аванс / закрытие…" /></Fld>
        <Fld label="Кто оплатил"><PersonSelect value={user} onChange={setUser} /></Fld>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn xs" disabled={st.debt <= 0} onClick={() => setPay(paySetUsd(pay, st.debt))}>= весь долг</button>
        <button className="btn xs" disabled={st.debt <= 0} onClick={() => setPay(paySetUsd(pay, st.debt / 2))}>= половина</button>
        <button className="btn pri" disabled={!(payUsd(pay) > 0) || busy} onClick={save}>{busy ? "Записываю…" : "Записать оплату"}</button>
      </div>
      <h3 style={{ margin: "16px 0 8px" }}>История оплат и возвратов поставщику</h3>
      <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
        <table className="t">
          <thead><tr><th>Дата</th><th>Тип</th><th style={{textAlign:"right"}}>Сумма</th><th>Детали</th><th></th></tr></thead>
          <tbody>
            {history.map((o) => (
              edit && edit.id === o.id ? (
                <tr key={o.id} style={{ background: "rgba(255,31,48,.06)" }}>
                  <td colSpan={5} style={{ padding: 10 }}>
                    <div className="sm" style={{ fontWeight: 700, marginBottom: 6 }}>Изменить оплату от {dt(o.op_date || o.created_at)}</div>
                    <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                      <PayFields p={edit.pay} setP={(np) => setEdit({ ...edit, pay: np })} methods={OUT_METHODS} usdLabel={payUsdLabel("supplier_payment")} />
                      <Fld label="Дата оплаты"><input type="date" className="inp" value={(edit.op_date || "").slice(0,10)} onChange={(e) => setEdit({ ...edit, op_date: e.target.value })} /></Fld>
                      <Fld label="Комментарий"><input className="inp" value={edit.note || ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Fld>
                    </div>
                    <div className="row" style={{ gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
                      <button className="btn xs" onClick={() => setEdit(null)}>Отмена</button>
                      <button className="btn xs pri" disabled={!(payUsd(edit.pay) > 0)} onClick={async () => { if (await onEditPay(o, { ...payPatch(edit.pay, "supplier_payment", false), op_date: edit.op_date || today(), note: edit.note })) setEdit(null); }}>Сохранить</button>
                    </div>
                  </td>
                </tr>
              ) : (
              <tr key={o.id} style={{ opacity: o.voided ? 0.4 : 1, textDecoration: o.voided ? "line-through" : "none" }}>
                <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                <td className="sm">{o.type === "supplier_payment" ? "Оплата" : "Возврат (−долг)"}{o.edited && <span className="xs" style={{ color: "var(--warn)" }}> изм.</span>}</td>
                <td className="num" style={{ fontWeight: 700, color: o.type === "supplier_payment" ? "var(--ok)" : "var(--acc2)" }}>{fmt(o.type === "return" ? o.cost_amount : o.amount)}</td>
                <td className="xs mut">{[o.type === "return" ? (o.object_id ? "с объекта " + objName(o.object_id) : "со склада Thermo") : (o.object_id ? objName(o.object_id) : ""), o.product_name ? o.product_name + (o.qty ? " × " + o.qty : "") : "", o.type === "supplier_payment" ? payText(o) : "", o.note].filter(Boolean).join(" · ")}</td>
                <td>{o.type === "supplier_payment" && (
                  voidAsk === o.id ? (
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      <span className="xs" style={{ color: "var(--bad)" }}>Удалить?</span>
                      <button className="btn xs dng" onClick={async () => { if (await onVoidPay(o)) setVoidAsk(null); }}>Да</button>
                      <button className="btn xs" onClick={() => setVoidAsk(null)}>Нет</button>
                    </div>
                  ) : (
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      {!o.voided && <button className="btn xs" onClick={() => setEdit({ id: o.id, pay: payInit(o), op_date: (o.op_date || o.created_at || "").slice(0,10), note: o.note })}>ред.</button>}
                      {fin && <button className="btn xs dng" onClick={() => setVoidAsk(o.id)}>удалить</button>}
                    </div>
                  )
                )}</td>
              </tr>
              )
            ))}
            {!history.length && <tr><td colSpan={5} className="mut" style={{ textAlign: "center", padding: 18 }}>Операций нет</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
function SupplierForm({ s, all = [], onSave }) {
  const [v, setV] = useState({ status: "active", terms: "", contact: "", phone: "", note: "", ...s });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const name = String(v.name || "").trim();
  const dup = name && all.find((x) => x.id !== v.id && String(x.name || "").trim().toLowerCase() === name.toLowerCase());
  const save = async () => {
    setBusy(true); setErr("");
    const e = await onSave({ ...v, name });
    if (e) { setErr(dbErrText("suppliers", e)); setBusy(false); }
  };
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Fld label="Название"><input className="inp" value={v.name || ""} onChange={set("name")} autoFocus /></Fld>
        <Fld label="Контактное лицо"><input className="inp" value={v.contact || ""} onChange={set("contact")} /></Fld>
        <Fld label="Телефон"><input className="inp" value={v.phone || ""} onChange={set("phone")} /></Fld>
        <Fld label="Условия оплаты"><input className="inp" value={v.terms || ""} onChange={set("terms")} /></Fld>
        <Fld label="Статус"><select className="inp" value={v.status || "active"} onChange={set("status")}><option value="active">активен</option><option value="inactive">неактивен (скрыт из списков выбора)</option></select></Fld>
        <Fld label="Примечание"><input className="inp" value={v.note || ""} onChange={set("note")} /></Fld>
      </div>
      {dup && <p className="sm" style={{ color: "var(--warn)", marginTop: 10 }}>Поставщик «{dup.name}» уже есть — выберите другое название, чтобы закупки и долги не разделились на два поставщика.</p>}
      {err && <p className="sm" style={{ color: "var(--bad)", marginTop: 10 }}>{err}</p>}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn pri" disabled={!name || !!dup || busy} onClick={save}>{busy ? "Сохраняю…" : "Сохранить"}</button>
      </div>
    </div>
  );
}

/* ============ REQUEST WIZARD (ручной подбор товаров) ============ */
const WZ_KEY = "te:wz_draft";
const WZ_TABS_KEY = "te:wz_tabs";
const wzDraftKey = (id) => WZ_KEY + ":" + id;

/* Несколько заявок одновременно — вкладки */
function RequestTabs(props) {
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const [state, setState] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(WZ_TABS_KEY) || "null");
      if (saved && Array.isArray(saved.tabs) && saved.tabs.length) return saved;
    } catch {}
    // первый запуск: переносим старый единственный черновик в первую вкладку
    const id = newId();
    try {
      const old = localStorage.getItem(WZ_KEY);
      if (old) { localStorage.setItem(wzDraftKey(id), old); localStorage.removeItem(WZ_KEY); }
    } catch {}
    return { tabs: [{ id, n: 1 }], active: id, seq: 1 };
  });
  const [meta, setMeta] = useState({});
  const [closing, setClosing] = useState(null);
  const stateRef = useRef(state);
  // сохраняем сразу (синхронно): после сохранения заявки вкладка «Новая заявка» размонтируется,
  // и отложенный useEffect уже не успел бы записать новое состояние
  const commit = (next) => {
    stateRef.current = next;
    try { localStorage.setItem(WZ_TABS_KEY, JSON.stringify(next)); } catch {}
    setState(next);
  };
  useEffect(() => { try { localStorage.setItem(WZ_TABS_KEY, JSON.stringify(state)); } catch {} }, []);

  // заголовки неактивных вкладок читаем из сохранённых черновиков
  const titleOf = (t) => {
    const m = meta[t.id];
    if (m) return { title: m.title, count: m.count };
    try {
      const d = JSON.parse(localStorage.getItem(wzDraftKey(t.id)) || "{}");
      const o = d.objId && props.data.objects.find((x) => x.id === d.objId);
      return { title: (o ? o.name : d.newObj && d.newObj.name) || "", count: (d.lines || []).length };
    } catch { return { title: "", count: 0 }; }
  };

  const addTab = () => {
    const s = stateRef.current, id = newId(), n = Math.max(0, ...s.tabs.map((t) => t.n || 0)) + 1;
    commit({ tabs: [...s.tabs, { id, n }], active: id, seq: n });
  };
  const switchTab = (id) => commit({ ...stateRef.current, active: id });
  const removeTab = (id) => {
    try { localStorage.removeItem(wzDraftKey(id)); } catch {}
    setMeta((m) => { const c = { ...m }; delete c[id]; return c; });
    const s = stateRef.current;
    const idx = s.tabs.findIndex((t) => t.id === id);
    let tabs = s.tabs.filter((t) => t.id !== id), seq = s.seq;
    if (!tabs.length) { seq = 1; tabs = [{ id: newId(), n: 1 }]; }
    const active = s.active === id ? tabs[Math.max(0, idx - 1)].id : s.active;
    commit({ tabs, active, seq });
  };
  const askClose = (t) => {
    const m = titleOf(t);
    if (!m.title && !m.count) removeTab(t.id);
    else setClosing(t);
  };

  const active = state.tabs.find((t) => t.id === state.active) || state.tabs[0];
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 style={{ marginRight: "auto" }}>Новая заявка</h2>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        {state.tabs.map((t) => {
          const m = titleOf(t), on = t.id === active.id;
          return (
            <div key={t.id} className="clk" onClick={() => switchTab(t.id)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px 7px 12px", borderRadius: 8, maxWidth: 240,
                border: "1px solid " + (on ? "var(--acc)" : "var(--line)"), background: on ? "rgba(255,31,48,.08)" : "var(--panel)", fontWeight: on ? 700 : 500 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
                {m.title || "Заявка " + t.n}
              </span>
              {m.count > 0 && <span className="xs mut mono">{m.count}</span>}
              <span title="Закрыть заявку" onClick={(e) => { e.stopPropagation(); askClose(t); }}
                style={{ color: "var(--mut)", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>✕</span>
            </div>
          );
        })}
        <button className="btn xs" onClick={addTab} title="Открыть ещё одну заявку">+ Новая заявка</button>
      </div>
      <RequestWizard key={active.id} {...props} draftKey={wzDraftKey(active.id)}
        onMeta={(m) => setMeta((prev) => ({ ...prev, [active.id]: m }))}
        onSaved={() => removeTab(active.id)} />
      {closing && (
        <Modal title="Закрыть заявку?" onClose={() => setClosing(null)} w={420}>
          <p className="sm mut">Заявка «{titleOf(closing).title || "Заявка " + closing.n}» не сохранена. Все введённые данные и подобранные товары будут потеряны.</p>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
            <button className="btn" onClick={() => setClosing(null)}>Отмена</button>
            <button className="btn dng" onClick={() => { removeTab(closing.id); setClosing(null); }}>Закрыть</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RequestWizard({ data, reload, toast, openObject, draftKey = WZ_KEY, onMeta, onSaved }) {
  const { products, suppliers, objects, masters } = data;
  const [step, setStep] = useState(() => { try { return JSON.parse(localStorage.getItem(draftKey) || "{}").step || 0; } catch { return 0; } });
  const [objId, setObjId] = useState(() => { try { return JSON.parse(localStorage.getItem(draftKey) || "{}").objId || ""; } catch { return ""; } });
  const [newObj, setNewObj] = useState(() => { try { return JSON.parse(localStorage.getItem(draftKey) || "{}").newObj || { name: "", client: "", phone: "", master: "", master_id: "", manager: "", address: "" }; } catch { return { name: "", client: "", phone: "", master: "", master_id: "", manager: "", address: "" }; } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lines, setLines] = useState(() => { try { return JSON.parse(localStorage.getItem(draftKey) || "{}").lines || []; } catch { return []; } });
  const [delLine, setDelLine] = useState(null);
  const [markupModal, setMarkupModal] = useState(false);
  const [markup, setMarkup] = useState(15);
  const [markupCustom, setMarkupCustom] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  // добавление нового мастера прямо тут
  const [addingMaster, setAddingMaster] = useState(false);
  const [newMasterName, setNewMasterName] = useState("");
  const [newMasterPhone, setNewMasterPhone] = useState("");
  const [savingMaster, setSavingMaster] = useState(false);
  // Persist draft to localStorage
  useEffect(() => {
    try { localStorage.setItem(draftKey, JSON.stringify({ step, objId, newObj, lines })); } catch {}
  }, [step, objId, newObj, lines, draftKey]);
  const clearDraft = () => { try { localStorage.removeItem(draftKey); } catch {} };

  const activeObjects = objects.filter((o) => !["closed", "cancelled"].includes(o.status));
  const selObj = objects.find((o) => o.id === objId);
  const metaTitle = (selObj ? selObj.name : newObj.name) || "";
  useEffect(() => { if (onMeta) onMeta({ title: metaTitle, count: lines.length }); }, [metaTitle, lines.length]);
  const prodById = (id) => products.find((p) => p.id === id);

  const addFromBase = (p) => {
    setLines((prev) => {
      const ex = prev.find((l) => l.product_id === p.id);
      if (ex) return prev.map((l) => (l.product_id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { id: uuid(), product_id: p.id, name: p.name, size: p.size, unit: p.unit, qty: 1, cost: p.cost, manual: false }];
    });
  };
  const addManualLine = () => {
    setLines((prev) => [...prev, { id: uuid(), product_id: null, name: "", size: "", unit: "шт", qty: 1, cost: 0, supplier_id: null, manual: true }]);
  };
  const setLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const confirmRemoveLine = () => { if (delLine) { setLines((prev) => prev.filter((l) => l.id !== delLine)); setDelLine(null); } };

  const filteredProducts = useMemo(() => products.filter((p) => p.status !== "archive"), [products]);

  const saveNewMaster = async () => {
    if (!newMasterName.trim()) return;
    setSavingMaster(true);
    try {
      const { data: ins, error } = await db.from("masters").insert(cleanUuids({ name: newMasterName.trim(), phone: newMasterPhone.trim(), status: "active", specialty: "", bonus_percent: 0, note: "" }));
      if (error) throw new Error(error.message);
      const m = ins && ins[0];
      if (m) {
        setNewObj((prev) => ({ ...prev, master_id: m.id, master: m.name }));
        await reload();
        toast("Мастер «" + m.name + "» добавлен");
      }
      setAddingMaster(false); setNewMasterName(""); setNewMasterPhone("");
    } catch (e) { toast("Ошибка добавления мастера: " + e.message); }
    setSavingMaster(false);
  };

  const totalCost = lines.reduce((a, l) => a + l.qty * (Number(l.cost) || 0), 0);

  const doSave = async (saleK) => {
    setBusy(true); setErr("");
    try {
      let obj = selObj;
      if (!obj) {
        const objData = cleanUuids({ ...newObj, status: saveStatus || "draft", items: [] });
        const { data: ins, error: insErr } = await db.from("objects").insert(objData);
        if (insErr) throw new Error("Ошибка создания объекта: " + insErr.message);
        if (ins && ins[0]) {
          obj = ins[0];
        } else {
          const { data: found } = await db.from("objects").select().eq("name", newObj.name).order("created_at", { ascending: false });
          obj = found && found[0];
        }
        if (!obj) throw new Error("Объект создан, но не удалось прочитать. Проверьте RLS на таблице objects.");
      }
      const exNos = (obj.items || []).map((i) => i.batch_no || 1);
      const batchNo = exNos.length ? Math.max(...exNos) + 1 : 1;
      const items = lines.map((l) => {
        const p = l.product_id ? prodById(l.product_id) : null;
        const cost = p ? p.cost : (Number(l.cost) || 0);
        return {
          id: uuid(), product_id: p ? p.id : null, name: p ? p.name : l.name, size: p ? p.size : l.size, unit: p ? p.unit : l.unit,
          qty: l.qty, price: l.manualPrice != null ? l.manualPrice : Math.round(cost * saleK * 100) / 100, cost, supplier_id: p ? p.supplier_id : (l.supplier_id || null),
          source_text: p ? p.name : l.name, confidence: 100,
          batch_no: batchNo, batch_date: today(),
        };
      });
      const patch = { items: [...(obj.items || []), ...items] };
      if (saveStatus && saveStatus !== obj.status) patch.status = saveStatus;
      await db.from("objects").update(patch).eq("id", obj.id);
      await db.from("requests").insert(cleanUuids({
        object_id: obj.id, mode: "manual", source: "manual",
        lines: lines.map((l) => ({ source: l.name, ai_product_id: null, final_product_id: l.product_id, confidence: 100, corrected: false })),
      }));
      await logAction("Заявка сохранена", "object:" + obj.name, "поставка №" + batchNo + ", позиций: " + items.length);
      toast("Поставка №" + batchNo + " сохранена: " + items.length + " поз. → «" + obj.name + "»");
      setStep(0); setLines([]); setObjId(""); setMarkupModal(false);
      setNewObj({ name: "", client: "", phone: "", master: "", master_id: "", manager: "", address: "" });
      clearDraft();
      await reload();
      if (onSaved) onSaved();
      openObject(obj.id);
    } catch (e) { setErr("Ошибка сохранения: " + e.message); }
    setBusy(false);
  };

  const trySave = () => {
    if (!lines.length) { setErr("Добавьте хотя бы одну позицию"); return; }
    const incomplete = lines.find((l) => !l.product_id && (!l.name || !l.name.trim()));
    if (incomplete) { setErr("Заполните название для всех ручных позиций"); return; }
    setErr("");
    // статус спрашиваем при каждом сохранении: у нового объекта — выбрать обязательно, у существующего — текущий по умолчанию
    setSaveStatus(selObj ? (selObj.status || "draft") : "");
    setMarkupModal(true);
  };

  const effectiveMarkup = markupCustom !== "" ? Number(markupCustom) : markup;
  const saleK = 1 + (Number(effectiveMarkup) || 0) / 100;
  const totalSalePreview = Math.round(totalCost * saleK * 100) / 100;

  return (
    <div>
      <div className="steps">
        {["Объект", "Подбор товаров"].map((s, i) => (
          <div key={i} className={"step " + (i === step ? "on" : i < step ? "done" : "")}>{i + 1}. {s}</div>
        ))}
      </div>
      {err && <div className="card sect" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{err}</div>}

      {step === 0 && (
        <div className="card">
          <div className="split">
            <div>
              <h3 style={{ marginBottom: 10 }}>Существующий объект</h3>
              <select className="inp" value={objId} onChange={(e) => setObjId(e.target.value)}>
                <option value="">— создать новый —</option>
                {activeObjects.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.client})</option>)}
              </select>
            </div>
            {!objId && (
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <Fld label="Название объекта"><input className="inp" value={newObj.name} onChange={(e) => setNewObj({ ...newObj, name: e.target.value })} placeholder="Дом, ул. Чиланзар 12" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.closest(".grid").querySelectorAll("input,select")[1]?.focus(); }}} /></Fld>
                <Fld label="Клиент"><input className="inp" value={newObj.client} onChange={(e) => setNewObj({ ...newObj, client: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.closest(".grid").querySelectorAll("input,select")[2]?.focus(); }}} /></Fld>
                <Fld label="Телефон клиента"><input className="inp" value={newObj.phone} onChange={(e) => setNewObj({ ...newObj, phone: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.closest(".grid").querySelectorAll("input,select")[3]?.focus(); }}} /></Fld>
                <div className="fld">
                  <label>Мастер</label>
                  {!addingMaster ? (
                    <>
                      <select className="inp" value={newObj.master_id} onChange={(e) => {
                        if (e.target.value === "__add__") { setAddingMaster(true); return; }
                        const m = masters.find((x) => x.id === e.target.value);
                        setNewObj({ ...newObj, master_id: e.target.value, master: m ? m.name : "" });
                      }}>
                        <option value="">—</option>
                        {masters.filter((m) => m.status === "active").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        <option value="__add__">+ добавить нового мастера…</option>
                      </select>
                    </>
                  ) : (
                    <div className="card sect" style={{ padding: 10 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <input className="inp" placeholder="Имя мастера" value={newMasterName} onChange={(e) => setNewMasterName(e.target.value)} />
                        <input className="inp" placeholder="Телефон" value={newMasterPhone} onChange={(e) => setNewMasterPhone(e.target.value)} />
                      </div>
                      <div className="row" style={{ marginTop: 8, justifyContent: "flex-end", gap: 6 }}>
                        <button className="btn xs" onClick={() => { setAddingMaster(false); setNewMasterName(""); setNewMasterPhone(""); }}>Отмена</button>
                        <button className="btn xs pri" disabled={!newMasterName.trim() || savingMaster} onClick={saveNewMaster}>{savingMaster ? "Сохраняю…" : "Добавить"}</button>
                      </div>
                    </div>
                  )}
                </div>
                <Fld label="Менеджер"><PersonSelect value={newObj.manager} onChange={(m) => setNewObj({ ...newObj, manager: m })} /></Fld>
                <Fld label="Адрес"><input className="inp" value={newObj.address} onChange={(e) => setNewObj({ ...newObj, address: e.target.value })} /></Fld>
              </div>
            )}
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
            <button className="btn pri" disabled={!objId && !newObj.name} onClick={() => setStep(1)}>Далее →</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <h3 style={{ marginRight: "auto" }}>Подбор товаров</h3>
          </div>

          <div className="row" style={{ marginBottom: 12, gap: 10 }}>
            <ProductPicker products={filteredProducts} placeholder="Поиск товара по названию / коду — начните вводить…" onPick={addFromBase} />
          </div>

          {lines.length === 0 && (
            <div className="card sect mut" style={{ textAlign: "center", padding: 30 }}>
              Список пуст. Найдите товар через поиск выше или добавьте позицию вручную.
            </div>
          )}

          {lines.length > 0 && (
            <div style={{ overflow: "auto" }}>
              <table className="t">
                <thead><tr>
                  <th>Товар</th><th style={{ width: 90 }}>Кол-во</th><th style={{ width: 70 }}>Ед.</th><th style={{ textAlign: "right" }}>Себестоимость</th><th style={{ textAlign: "right", color: "var(--ok)" }}>Цена продажи</th><th style={{ textAlign: "right" }}>Сумма (себест.)</th><th>Ост.</th><th></th>
                </tr></thead>
                <tbody>
                  {lines.map((l) => {
                    const p = l.product_id ? prodById(l.product_id) : null;
                    return (
                      <tr key={l.id}>
                        <td style={{ minWidth: 240 }}>
                          {l.manual ? (
                            <>
                              <input className="inp" placeholder="Название товара" value={l.name} onChange={(e) => setLine(l.id, { name: e.target.value })} />
                              <div className="row" style={{ marginTop: 4, gap: 6 }}>
                                <input className="inp" style={{ width: 90 }} placeholder="размер" value={l.size} onChange={(e) => setLine(l.id, { size: e.target.value })} />
                                <input type="number" className="inp" style={{ width: 100 }} placeholder="себестоимость" value={l.cost} onChange={(e) => setLine(l.id, { cost: Number(e.target.value) || 0 })} />
                              </div>
                              <select className="inp" style={{ marginTop: 4 }} value={l.supplier_id || ""} onChange={(e) => setLine(l.id, { supplier_id: e.target.value || null })} title="Поставщик">
                                <option value="">— поставщик —</option>
                                {suppliers.filter((s) => s.status !== "inactive" || s.id === l.supplier_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </select>
                              <div className="xs mut" style={{ marginTop: 3 }}>добавлено вручную</div>
                            </>
                          ) : (
                            <>
                              <div style={{ fontWeight: 600 }}>{l.name}</div>
                              <div className="xs mut">{l.size}{p ? " · " + ((suppliers.find((s) => s.id === p.supplier_id) || {}).name || "") : ""}</div>
                            </>
                          )}
                        </td>
                        <td><input type="number" className="inp" value={l.qty} onChange={(e) => setLine(l.id, { qty: Number(e.target.value) || 0 })} /></td>
                        <td>
                          {l.manual
                            ? <input className="inp" style={{ width: 64 }} value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value })} />
                            : <span className="mut">{l.unit}</span>}
                        </td>
                        <td className="num">{fmt2(p ? p.cost : l.cost)}</td>
                        <td><input type="number" className="inp" style={{ width: 100, textAlign: "right", color: "var(--ok)", fontWeight: 700 }} placeholder="авто" value={l.manualPrice != null ? l.manualPrice : ""} onChange={(e) => setLine(l.id, { manualPrice: e.target.value === "" ? null : Number(e.target.value) })} title="Цена продажи (оставьте пустым — рассчитается по наценке)" /></td>
                        <td className="num" style={{ fontWeight: 700 }}>{fmt(l.qty * (p ? p.cost : l.cost))}</td>
                        <td className="num" style={{ color: p && p.stock < l.qty ? "var(--bad)" : "var(--ok)" }}>{p ? p.stock : "—"}</td>
                        <td><button className="btn xs dng" onClick={() => setDelLine(l.id)}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn xs" onClick={addManualLine}>+ добавить позицию вручную (нет в базе)</button>
            <div className="mono" style={{ fontWeight: 700, marginLeft: "auto" }}>
              Позиций: {lines.length} · Себестоимость: <span style={{ color: "var(--acc2)" }}>{money(totalCost)}</span>
            </div>
          </div>

          <div className="row" style={{ marginTop: 16, justifyContent: "space-between" }}>
            <button className="btn" onClick={() => setStep(0)}>← Назад</button>
            <button className="btn pri" disabled={busy || !lines.length} onClick={trySave}>
              {busy ? <span><span className="spin" /> Сохраняю…</span> : "Сохранить в объект ✓"}
            </button>
          </div>

          {delLine && (
            <Modal title="Удалить позицию?" onClose={() => setDelLine(null)} w={420}>
              <p className="sm mut">Позиция будет убрана из текущего списка заявки. Это действие нельзя отменить.</p>
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
                <button className="btn" onClick={() => setDelLine(null)}>Отмена</button>
                <button className="btn dng" onClick={confirmRemoveLine}>Удалить</button>
              </div>
            </Modal>
          )}

          {markupModal && (
            <Modal title="Сохранение в объект" onClose={() => setMarkupModal(false)} w={460}>
              <Fld label={"Статус объекта" + (selObj ? " «" + selObj.name + "»" : "")}>
                <select className="inp" autoFocus value={saveStatus} onChange={(e) => setSaveStatus(e.target.value)}
                  style={{ fontWeight: 700, color: saveStatus ? stById(saveStatus).c === "#ffffff" ? "var(--txt)" : stById(saveStatus).c : "var(--bad)", borderColor: saveStatus ? undefined : "var(--bad)" }}>
                  {!saveStatus && <option value="">— выберите статус —</option>}
                  {OBJ_STATUSES.map((st) => <option key={st.id} value={st.id} style={{ color: "var(--txt)" }}>{st.label}</option>)}
                </select>
              </Fld>
              <h3 style={{ margin: "14px 0 6px" }}>Наценка на розничную цену</h3>
              <p className="sm mut" style={{ marginBottom: 12 }}>Розничная цена каждой позиции = себестоимость + наценка. Применяется ко всему списку. После сохранения цены можно поправить вручную на странице объекта.</p>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <Fld label="Наценка, %">
                  <input type="number" className="inp" style={{ fontSize: 18, fontWeight: 700 }}
                    value={markupCustom !== "" ? markupCustom : markup}
                    onChange={(e) => { setMarkupCustom(e.target.value); }} />
                </Fld>
                <div className="fld"><label>Предпросмотр</label>
                  <div className="inp mono" style={{ background: "var(--panel)" }}>
                    <div className="xs mut">себест: {fmt(totalCost)}</div>
                    <div style={{ fontWeight: 700, color: "var(--ok)" }}>продажа: {fmt(totalSalePreview)}</div>
                  </div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                {[5, 10, 15, 20].map((x) => <button key={x} className={"btn xs " + (effectiveMarkup === x && markupCustom === "" ? "pri" : "")} onClick={() => { setMarkup(x); setMarkupCustom(""); }}>{x}%</button>)}
              </div>
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
                <button className="btn" onClick={() => setMarkupModal(false)}>Отмена</button>
                <button className="btn pri" disabled={busy || !saveStatus} title={!saveStatus ? "Выберите статус объекта" : ""} onClick={() => doSave(saleK)}>{busy ? "Сохраняю…" : "Применить и сохранить ✓"}</button>
              </div>
            </Modal>
          )}
        </div>
      )}
    </div>
  );
}

/* ============ OBJECTS TAB ============ */
function ObjectsTab({ data, reload, toast, openId, setOpenId, goRequest, fin = true }) {
  const { objects, finance_ops, suppliers } = data;
  const [delObj, setDelObj] = useState(null);
  const obj = objects.find((o) => o.id === openId);
  const removeObject = async (o) => {
    await db.from("finance_ops").delete().eq("object_id", o.id);
    await db.from("requests").delete().eq("object_id", o.id);
    await db.from("objects").delete().eq("id", o.id);
    await logAction("Удалён объект", "object:" + o.name, "клиент: " + (o.client || ""));
    await reload(); toast("Объект удалён");
  };
  if (obj) return <ObjectDetail obj={obj} data={data} reload={reload} toast={toast} fin={fin} back={() => setOpenId(null)} onDelete={async () => { await removeObject(obj); setOpenId(null); }} />;
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Объекты <span className="mut sm">({objects.length})</span></h2>
        <button className="btn pri" onClick={goRequest}>+ Новая заявка</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Объект</th><th>Клиент</th><th>Мастер</th><th>Статус</th><th style={{textAlign:"right"}}>Сумма товара</th><th style={{textAlign:"right"}}>Долг клиента</th><th>Дата</th><th></th></tr></thead>
          <tbody>
            {objects.map((o) => {
              const f = calcObject(o, finance_ops);
              const st = stById(o.status);
              return (
                <tr key={o.id} className="clk" onClick={() => setOpenId(o.id)}>
                  <td style={{ fontWeight: 700 }}>{o.name}<div className="xs mut">{o.address}</div></td>
                  <td className="sm">{o.client}</td>
                  <td className="sm">{o.master}</td>
                  <td><Badge c={st.c}>{st.label}</Badge></td>
                  <td className="num">{fmt(f.saleNet)}</td>
                  <td className="num" style={{ color: f.clientDebt > 0 ? "var(--bad)" : f.clientDebt < 0 ? "var(--ok)" : "var(--mut)" }}>{f.clientDebt < 0 ? "−" + fmt(Math.abs(f.clientDebt)) : fmt(f.clientDebt)}</td>
                  <td className="xs mut mono">{dt(o.created_at)}</td>
                  <td><button className="btn xs dng" onClick={(e) => { e.stopPropagation(); setDelObj(o); }}>✕</button></td>
                </tr>
              );
            })}
            {!objects.length && <tr><td colSpan={8} className="mut" style={{ textAlign: "center", padding: 30 }}>Объектов пока нет — создайте через «Новая заявка»</td></tr>}
          </tbody>
        </table>
      </div>
      {delObj && (() => { const f = calcObject(delObj, finance_ops); return (
        <Modal title="Удалить объект" onClose={() => setDelObj(null)} w={460}>
          <p style={{ marginBottom: 6 }}>Удалить объект <b style={{ color: "var(--bad)" }}>{delObj.name}</b> ({delObj.client})?</p>
          {(f.clientDebt > 0 || f.supplierDebt > 0) && <p className="sm" style={{ color: "var(--warn)", marginBottom: 6 }}>⚠ По объекту есть долги — клиента: {fmt(Math.max(0, f.clientDebt))}, поставщикам: {fmt(f.supplierDebt)}.</p>}
          <p className="sm mut" style={{ marginBottom: 14 }}>Будут удалены все материалы, финансовые операции и заявки этого объекта. Действие необратимо. Если объект просто завершён — лучше поставьте статус «Закрыто».</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setDelObj(null)}>Отмена</button>
            <button className="btn" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={async () => { await removeObject(delObj); setDelObj(null); }}>Удалить</button>
          </div>
        </Modal>
      ); })()}
    </div>
  );
}

function ObjectDetail({ obj, data, reload, toast, back, fin = true, onDelete }) {
  const { finance_ops, suppliers, products, masters } = data;
  const f = calcObject(obj, finance_ops);
  const ops = finance_ops.filter((o) => o.object_id === obj.id);
  const [opForm, setOpForm] = useState(null);
  const [closedBatches, setClosedBatches] = useState({});
  const [editOp, setEditOp] = useState(null);
  const [delAsk, setDelAsk] = useState(null);
  const toggleBatch = (no) => setClosedBatches({ ...closedBatches, [no]: !closedBatches[no] });
  const [editItem, setEditItem] = useState(null);
  const [addItems, setAddItems] = useState(false);
  const [impItems, setImpItems] = useState(false);
  const [delSelf, setDelSelf] = useState(false);
  const [delItemId, setDelItemId] = useState(null);
  const supName = (id) => (suppliers.find((s) => s.id === id) || {}).name || "—";

  const setStatus = async (s) => { await db.from("objects").update({ status: s }).eq("id", obj.id); await reload(); };
  const delItem = async (iid) => {
    await db.from("objects").update({ items: (obj.items || []).filter((i) => i.id !== iid) }).eq("id", obj.id);
    await reload();
  };
  const setItemQty = async (iid, qty) => {
    await db.from("objects").update({ items: (obj.items || []).map((i) => i.id === iid ? { ...i, qty } : i) }).eq("id", obj.id);
    await reload();
  };
  const setItemPrice = async (iid, price) => {
    await db.from("objects").update({ items: (obj.items || []).map((i) => i.id === iid ? { ...i, price } : i) }).eq("id", obj.id);
    await reload();
  };
  const saveItem = async (item) => {
    await db.from("objects").update({ items: (obj.items || []).map((i) => i.id === item.id ? item : i) }).eq("id", obj.id);
    await reload(); toast("Позиция обновлена");
  };
  // newBatch: true → создаём новую поставку с новым номером. false → добавляем в последнюю существующую поставку (или №1, если поставок ещё нет)
  const addManualItems = async (rows, newBatch) => {
    const exNos = (obj.items || []).map((i) => i.batch_no || 1);
    const lastNo = exNos.length ? Math.max(...exNos) : 0;
    const batchNo = newBatch ? lastNo + 1 : (lastNo || 1);
    const batchDate = newBatch || !lastNo ? today() : ((obj.items || []).find((i) => (i.batch_no || 1) === batchNo) || {}).batch_date || today();
    const items = rows.map((r) => ({
      id: uuid(), product_id: r.product_id || null, name: r.name, size: r.size, unit: r.unit || "шт",
      qty: r.qty, price: r.price, cost: r.cost, supplier_id: r.supplier_id || null,
      source_text: "добавлено вручную", confidence: 100, batch_no: batchNo, batch_date: batchDate, manual: true,
    }));
    await db.from("objects").update({ items: [...(obj.items || []), ...items] }).eq("id", obj.id);
    await reload(); toast((newBatch ? "Новая поставка №" + batchNo + ": " : "Добавлено в поставку №" + batchNo + ": ") + items.length + " поз.");
  };
  // удаление операции (вместо сторно). След остаётся в «Журнале».
  const deleteOp = async (op) => {
    // возврат, оприходованный на склад, — убираем со склада (если он не был сторнирован раньше)
    const wentToWh = op.type === "return" && !op.voided && !supplierReturnIds(finance_ops, data.wh_moves).has(op.id);
    const r = await db.from("finance_ops").delete().eq("id", op.id);
    if (r.error) return;
    if (wentToWh && op.product_id) {
      const { data: ex } = await db.from("warehouse").select().eq("product_id", op.product_id);
      if (ex && ex.length) await db.from("warehouse").update({ qty: Math.max(0, (ex[0].qty || 0) - (op.qty || 0)) }).eq("id", ex[0].id);
      await db.from("wh_moves").insert({ product_id: op.product_id, name: op.product_name, qty: op.qty, dir: "out", object_id: obj.id, object_name: obj.name, op_date: today(), user: curUserName(), note: "удалён возврат" });
    }
    await logAction("Удалена операция: " + opLabel(op.type), "object:" + obj.name,
      fmt(op.amount) + " от " + dt(op.op_date || op.created_at) + [op.product_name, op.reason, op.note].filter(Boolean).map((x) => " · " + x).join(""));
    setDelAsk(null); await reload(); toast("Операция удалена");
  };
  const safe = (s) => String(s || "object").replace(/[^a-zа-яё0-9_-]+/gi, "_").slice(0, 40);
  const exportClient = () => {
    const rows = [
      { k: "title", v: ["СПЕЦИФИКАЦИЯ: " + (obj.name || "")] },
      { k: "info", v: ["Клиент: " + (obj.client || "—") + (obj.phone ? " · тел. " + obj.phone : "")] },
      { k: "info", v: ["Дата: " + new Date().toLocaleDateString("ru-RU")] },
      { k: "blank" },
    ];
    const tot = (label, v) => rows.push({ k: "total", v: [label, v] });
    let n = 1;
    batches.forEach((b) => {
      rows.push({ k: "section", v: ["ПОСТАВКА №" + b.no + " от " + dt(b.date)] });
      rows.push({ k: "head", v: ["№", "Наименование", "Кол-во", "Ед.", "Цена", "Сумма"] });
      let sub = 0;
      b.items.forEach((i) => {
        const s = Math.round(i.qty * i.price * 100) / 100; sub += s;
        rows.push({ k: "row", v: [n++, i.name, i.qty, i.unit, i.price, s] });
      });
      tot("Итого по поставке №" + b.no, Math.round(sub * 100) / 100);
      rows.push({ k: "blank" });
    });
    const returns = ops.filter((o) => o.type === "return" && !o.voided);
    if (returns.length) {
      rows.push({ k: "section", v: ["ВОЗВРАТЫ"] });
      rows.push({ k: "head", v: ["№", "Наименование", "Кол-во", "Ед.", "Дата", "Сумма"] });
      returns.forEach((o, k) => rows.push({ k: "row", v: [k + 1, o.product_name || "", o.qty || "", o.unit || "", dt(o.op_date || o.created_at), -(o.amount || 0)] }));
      tot("Итого возвратов", -f.retSale);
      rows.push({ k: "blank" });
    }
    tot("Итого по объекту", f.sale);
    if (f.discount) tot("Скидка", -f.discount);
    if (f.retSale) tot("Возвраты", -f.retSale);
    tot("К ОПЛАТЕ", f.saleNet);
    const r = downloadStyledXLSX("Спецификация_" + safe(obj.name) + ".xlsx", "Клиенту", rows, [6, 60, 10, 7, 13, 15], ["c", "t", "n", "c", "m", "m"]);
    toast(r === "xlsx" ? "Excel для клиента скачан" : r === "csv" ? "Excel заблокирован — скачан CSV" : "Скачивание заблокировано браузером");
  };
  const exportDelivery = () => {
    const rows = [
      { k: "title", v: ["ЛИСТ ДОСТАВКИ: " + (obj.name || "")] },
      { k: "info", v: ["Адрес: " + (obj.address || "—")] },
      { k: "info", v: ["Клиент: " + (obj.client || "—") + (obj.phone ? " · тел. " + obj.phone : "")] },
      { k: "info", v: ["Мастер: " + (obj.master || "—")] },
      { k: "blank" },
    ];
    batches.forEach((b) => {
      rows.push({ k: "section", v: ["ПОСТАВКА №" + b.no + " от " + dt(b.date)] });
      const g = {};
      b.items.forEach((i) => {
        const k = i.from_warehouse ? "СКЛАД THERMO" : supName(i.supplier_id);
        (g[k] = g[k] || []).push(i);
      });
      Object.entries(g).forEach(([s, items]) => {
        rows.push({ k: "section", v: ["Поставщик: " + s] });
        rows.push({ k: "head", v: ["№", "Наименование", "Размер", "Кол-во", "Ед.", "Получено ✓"] });
        items.forEach((i, k) => rows.push({ k: "row", v: [k + 1, i.name, i.size || "", i.qty, i.unit, ""] }));
        rows.push({ k: "blank" });
      });
    });
    const r = downloadStyledXLSX("Доставка_" + safe(obj.name) + ".xlsx", "Доставка", rows, [6, 60, 14, 10, 7, 13], ["c", "t", "c", "n", "c", "c"]);
    toast(r === "xlsx" ? "Лист доставки скачан" : r === "csv" ? "Excel заблокирован — скачан CSV" : "Скачивание заблокировано браузером");
  };
  const batches = useMemo(() => {
    const map = {};
    (obj.items || []).forEach((i) => {
      const no = i.batch_no || 1;
      (map[no] = map[no] || { no, date: i.batch_date || obj.created_at, items: [] }).items.push(i);
    });
    return Object.values(map).sort((a, b) => a.no - b.no);
  }, [obj]);

  const KPI = ({ l, v, c }) => <div className="kpi"><div className="l">{l}</div><div className="v" style={{ color: c }}>{fmt(v)}</div></div>;
  return (
    <div>
      <div className="row sect">
        <button className="btn" onClick={back}>← Объекты</button>
        <div style={{ marginRight: "auto" }}>
          <h2>{obj.name}</h2>
          <div className="sm mut">
            {obj.client} · {obj.phone} · менеджер:{" "}
            <PersonSelect compact value={obj.manager || ""} onChange={async (m) => { await db.from("objects").update({ manager: m }).eq("id", obj.id); await reload(); }} />
            {" "}· мастер:{" "}
            <select className="inp" style={{ display: "inline-block", width: "auto", padding: "2px 6px", fontSize: 12 }} value={obj.master_id || ""}
              onChange={async (e) => { const m = masters.find((x) => x.id === e.target.value); await db.from("objects").update({ master_id: e.target.value || null, master: m ? m.name : obj.master }).eq("id", obj.id); await reload(); }}>
              <option value="">{obj.master && !obj.master_id ? obj.master + " (без привязки)" : "—"}</option>
              {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
        <select className="inp" style={{ maxWidth: 190 }} value={obj.status} onChange={(e) => setStatus(e.target.value)}>
          {OBJ_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button className="btn" onClick={exportClient}>⬇ Excel клиенту</button>
        <button className="btn" onClick={exportDelivery}>🚚 Лист доставки</button>
      </div>

      <div className="kpis sect">
        <KPI l="Сумма товара (нетто)" v={f.saleNet} />
        <KPI l="Оплачено клиентом" v={f.paidClient} c="var(--ok)" />
        <KPI l={f.clientDebt < 0 ? "Переплата клиента" : "Долг клиента"} v={f.clientDebt} c={f.clientDebt > 0 ? "var(--bad)" : f.clientDebt < 0 ? "var(--ok)" : "var(--mut)"} />
      </div>

      <div className="row sect" style={{ marginBottom: 8 }}>
        <h3 style={{ marginRight: "auto" }}>Материалы объекта</h3>
        <button className="btn" onClick={() => setAddItems(true)}>+ Список вручную</button>
        <button className="btn pri" onClick={() => setAddItems("newbatch")}>📦 Новая поставка</button>
        <button className="btn" onClick={() => setImpItems(true)}>📊 Импорт Excel</button>
      </div>
      <div className="card sect" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Товар</th><th>Размер</th><th style={{width:90}}>Кол-во</th><th>Ед.</th>{fin && <th style={{textAlign:"right"}}>Закуп</th>}<th style={{textAlign:"right"}}>Цена</th><th style={{textAlign:"right"}}>Сумма</th><th>Поставщик</th><th></th></tr></thead>
          <tbody>
            {batches.map((b) => (
              <React.Fragment key={b.no}>
                {batches.length > 1 || (obj.items || []).some((i) => i.batch_no) ? (
                  <tr className="clk" onClick={() => toggleBatch(b.no)}>
                    <td colSpan={fin ? 9 : 8} style={{ background: "rgba(255,31,48,.08)", fontWeight: 800, fontSize: 12, letterSpacing: ".5px", userSelect: "none" }}>
                      {closedBatches[b.no] ? "▸" : "▾"} 🚚 ПОСТАВКА №{b.no} · {dt(b.date)} · позиций: {b.items.length} · на сумму {fmt(b.items.reduce((a, i) => a + i.qty * i.price, 0))}
                      <span className="xs mut" style={{ fontWeight: 500 }}>  — нажмите чтобы {closedBatches[b.no] ? "раскрыть" : "свернуть"}</span>
                    </td>
                  </tr>
                ) : null}
                {!closedBatches[b.no] && b.items.map((i) => (
              <ObjectItemRow key={i.id} i={i} fin={fin} supName={supName} setItemQty={setItemQty} setItemPrice={setItemPrice} setEditItem={setEditItem} setDelItemId={setDelItemId} />
                ))}
              </React.Fragment>
            ))}
            {!(obj.items || []).length && <tr><td colSpan={fin ? 9 : 8} className="mut" style={{ textAlign: "center", padding: 22 }}>Материалов нет — добавьте через «Новая заявка»</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="row sect">
        <h3 style={{ marginRight: "auto" }}>Финансовые операции</h3>
        {OP_TYPES.filter((t) => (fin ? OBJECT_OP_TYPES : MANAGER_OP_TYPES).includes(t.id)).map((t) => <button key={t.id} className="btn xs" onClick={() => setOpForm({ type: t.id })}>+ {t.label}</button>)}
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Дата</th><th>Тип</th><th style={{textAlign:"right"}}>Сумма</th><th>Детали</th><th></th></tr></thead>
          <tbody>
            {ops.filter((o) => !MASTER_ONLY_OPS.includes(o.type) && (fin || MANAGER_OP_TYPES.includes(o.type))).slice().reverse().map((o) => (
              <tr key={o.id} style={{ opacity: o.voided ? 0.4 : 1, textDecoration: o.voided ? "line-through" : "none" }}>
                <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                <td>{opLabel(o.type)}{o.type === "return" && o.product_name ? <div className="xs mut">{o.product_name} × {o.qty}</div> : null}{o.edited && <div className="xs" style={{ color: "var(--warn)" }}>изменено</div>}</td>
                <td className="num" style={{ fontWeight: 700, color: o.type === "client_payment" ? "var(--ok)" : "inherit" }}>{fmt(o.amount)}</td>
                <td className="xs mut">{opDetails(o, [o.supplier_id ? supName(o.supplier_id) : ""])}</td>
                <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                  {!o.voided && (fin || MANAGER_OP_TYPES.includes(o.type)) && <button className="btn xs" onClick={() => setEditOp(o)}>✎</button>}
                  {fin && (delAsk === o.id ? (
                    <>
                      <span className="xs" style={{ color: "var(--bad)", textDecoration: "none" }}>Удалить?</span>
                      <button className="btn xs dng" onClick={() => deleteOp(o)}>Да</button>
                      <button className="btn xs" onClick={() => setDelAsk(null)}>Нет</button>
                    </>
                  ) : <button className="btn xs dng" onClick={() => setDelAsk(o.id)}>удалить</button>)}
                </div></td>
              </tr>
            ))}
            {!ops.filter((o) => !MASTER_ONLY_OPS.includes(o.type)).length && <tr><td colSpan={5} className="mut" style={{ textAlign: "center", padding: 20 }}>Операций нет</td></tr>}
          </tbody>
        </table>
      </div>
      {delSelf && (
        <Modal title="Удалить объект" onClose={() => setDelSelf(false)} w={460}>
          <p style={{ marginBottom: 6 }}>Удалить объект <b style={{ color: "var(--bad)" }}>{obj.name}</b>?</p>
          <p className="sm mut" style={{ marginBottom: 14 }}>Будут удалены все материалы, финансовые операции и заявки. Необратимо.</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setDelSelf(false)}>Отмена</button>
            <button className="btn" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={async () => { setDelSelf(false); await onDelete(); }}>Удалить</button>
          </div>
        </Modal>
      )}
      {delItemId && (
        <Modal title="Удалить позицию?" onClose={() => setDelItemId(null)} w={420}>
          <p className="sm mut">Позиция будет удалена из объекта. Это действие нельзя отменить.</p>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
            <button className="btn" onClick={() => setDelItemId(null)}>Отмена</button>
            <button className="btn dng" onClick={async () => { await delItem(delItemId); setDelItemId(null); }}>Удалить</button>
          </div>
        </Modal>
      )}
      {editItem && <ItemEditModal item={editItem} suppliers={suppliers} fin={fin} onClose={() => setEditItem(null)} onSave={async (it) => { await saveItem(it); setEditItem(null); }} />}
      {addItems && <AddItemsModal products={products} suppliers={suppliers} newBatch={addItems === "newbatch"} onClose={() => setAddItems(false)} onSave={async (rows) => { await addManualItems(rows, addItems === "newbatch"); setAddItems(false); }} />}
      {impItems && <ObjectExcelImport products={products} suppliers={suppliers} onClose={() => setImpItems(false)} onSave={async (rows) => { await addManualItems(rows); setImpItems(false); }} />}
      {editOp && <EditOpModal op={editOp} suppliers={suppliers} isReturn={editOp.type === "return"} onClose={() => setEditOp(null)} onSave={async (patch) => {
        const log = [...(editOp.edit_log || []), { at: new Date().toISOString(), before: { amount: editOp.amount, op_date: editOp.op_date, note: editOp.note, reason: editOp.reason } }];
        const r = await db.from("finance_ops").update({ ...patch, edited: true, edit_log: log }).eq("id", editOp.id);
        if (r.error) return;
        const pt = (o) => (isPayType(editOp.type) ? " (" + payText(o) + ")" : "");
        await logAction("Изменена операция: " + opLabel(editOp.type), "object:" + obj.name, "было " + fmt(editOp.amount) + pt(editOp) + (patch.amount != null ? " → " + fmt(patch.amount) + pt({ ...editOp, ...patch }) : ""));
        setEditOp(null); await reload(); toast("Операция изменена (история сохранена)");
      }} />}
      {opForm && opForm.type === "return" && <ReturnForm obj={obj} ops={ops} onClose={() => setOpForm(null)} onSave={async (list) => {
        const rows = list.map(({ _toWh, _supplier, ...op }) => cleanUuids(op));
        const r = await db.from("finance_ops").insert(rows);
        if (r.error) return; // ошибка уже показана на экране, окно остаётся открытым
        const toWh = list.filter((x) => x._toWh).map(({ _toWh, _supplier, ...op }) => ({ ...op, supplier_id: _supplier }));
        const toSup = list.length - toWh.length;
        if (toWh.length) await warehouseIn(toWh, obj.name);
        await logAction("Возврат товара", "object:" + obj.name, "позиций: " + list.length + (toWh.length ? ", на склад: " + toWh.length : "") + (toSup ? ", поставщику: " + toSup : "") + ", сумма: " + fmt(list.reduce((a,x)=>a+(x.amount||0),0)));
        setOpForm(null); await reload();
        toast("Возврат оформлен: " + list.length + " поз." + (toWh.length ? " → Склад Thermo: " + toWh.length : "") + (toSup ? " → поставщику: " + toSup + " (долг уменьшен)" : ""));
      }} />}
      {opForm && opForm.type !== "return" && <OpForm obj={obj} type={opForm.type} suppliers={suppliers} onClose={() => setOpForm(null)}
        onSave={async (op) => {
          if (op.type === "bonus") op.master_id = obj.master_id || null;
          const r = await db.from("finance_ops").insert(cleanUuids(op));
          if (r.error) return; // ошибка уже показана, окно остаётся открытым
          await logAction(opLabel(op.type), "object:" + obj.name, fmt(op.amount) + (isPayType(op.type) ? " · " + payText(op) : "") + (op.note ? " · " + op.note : "")); setOpForm(null); await reload(); toast("Операция добавлена");
        }} />}
    </div>
  );
}

// Строка таблицы материалов объекта: количество/цена редактируются свободно на экране,
// в базу уходят только по потере фокуса (onBlur) — чтобы не слать запрос на каждое нажатие клавиши
// и не ловить промежуточные значения вроде "1" при наборе "15".
function ObjectItemRow({ i, fin, supName, setItemQty, setItemPrice, setEditItem, setDelItemId }) {
  const [qty, setQty] = useState(i.qty);
  const [price, setPrice] = useState(i.price);
  useEffect(() => { setQty(i.qty); }, [i.qty]);
  useEffect(() => { setPrice(i.price); }, [i.price]);
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{i.name}{i.from_warehouse && <Badge c="#3ddc7d"> склад</Badge>}{i.from_warehouse && <div className="xs mut">со склада Thermo</div>}</td>
      <td className="mono xs">{i.size}</td>
      <td><input type="number" className="inp" value={qty} onChange={(e) => setQty(e.target.value)}
        onBlur={() => { const v = Number(qty) || 0; if (v !== i.qty) setItemQty(i.id, v); }} /></td>
      <td className="sm">{i.unit}</td>
      {fin && <td className="num mut">{fmt(i.cost)}</td>}
      <td><input type="number" className="inp num" style={{ width: 104, textAlign: "right" }} value={price} onChange={(e) => setPrice(e.target.value)}
        onBlur={() => { const v = Number(price) || 0; if (v !== i.price) setItemPrice(i.id, v); }} /></td>
      <td className="num" style={{ fontWeight: 700 }}>{fmt((Number(qty) || 0) * (Number(price) || 0))}</td>
      <td className="sm">{supName(i.supplier_id)}</td>
      <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
        <button className="btn xs" onClick={() => setEditItem(i)}>ред.</button>
        <button className="btn xs dng" onClick={() => setDelItemId(i.id)}>✕</button>
      </div></td>
    </tr>
  );
}
function ItemEditModal({ item, suppliers, fin, onClose, onSave }) {
  const [v, setV] = useState({ ...item });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const setN = (k) => (e) => setV({ ...v, [k]: Number(e.target.value) || 0 });
  return (
    <Modal title="Редактировать позицию" onClose={onClose} w={560}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Наименование"><input className="inp" value={v.name || ""} onChange={set("name")} /></Fld></div>
        <Fld label="Размер"><input className="inp" value={v.size || ""} onChange={set("size")} /></Fld>
        <Fld label="Ед. изм."><input className="inp" value={v.unit || ""} onChange={set("unit")} /></Fld>
        <Fld label="Количество"><input type="number" className="inp" value={v.qty || 0} onChange={setN("qty")} /></Fld>
        {fin && <Fld label="Себестоимость"><input type="number" className="inp" value={v.cost || 0} onChange={setN("cost")} /></Fld>}
        <Fld label="Цена продажи"><input type="number" className="inp" value={v.price || 0} onChange={setN("price")} /></Fld>
        <Fld label="Поставщик"><select className="inp" value={v.supplier_id || ""} onChange={set("supplier_id")}><option value="">—</option>{activeSuppliers(suppliers, v.supplier_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>
      </div>
      <p className="xs mut" style={{ marginTop: 8 }}>Сумма позиции: {fmt(v.qty * v.price)}</p>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" disabled={!v.name} onClick={() => onSave(v)}>Сохранить</button>
      </div>
    </Modal>
  );
}
function ObjectExcelImport({ products, suppliers, onClose, onSave }) {
  const FIELDS = [
    { id: "name", label: "Наименование*", kw: ["наименован", "назван", "товар", "name", "номенклат"] },
    { id: "qty", label: "Количество*", kw: ["кол-во", "количеств", "кол", "qty", "шт"] },
    { id: "price", label: "Цена продажи", kw: ["продаж", "розниц", "цена", "price"] },
    { id: "cost", label: "Себестоимость", kw: ["закуп", "себест", "приход", "cost", "опт"] },
    { id: "size", label: "Размер", kw: ["размер", "диаметр", "size"] },
    { id: "unit", label: "Ед. изм.", kw: ["ед", "изм", "unit"] },
    { id: "supplier", label: "Поставщик", kw: ["поставщ", "supplier"] },
  ];
  const [rows, setRows] = useState(null);
  const [map, setMap] = useState({});
  const [hasHeader, setHasHeader] = useState(true);
  const [fname, setFname] = useState("");
  const [err, setErr] = useState("");
  const fRef = useRef(null);
  const num = (v) => Number(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")) || 0;
  const findProd = (name) => {
    const s = String(name || "").toLowerCase().trim();
    if (!s) return null;
    return products.find((p) => p.name.toLowerCase() === s)
        || products.find((p) => p.name.toLowerCase().includes(s) || (p.alt_names || "").toLowerCase().includes(s)) || null;
  };
  const guessMap = (header) => {
    const m = {};
    header.forEach((h, i) => { const hl = String(h || "").toLowerCase(); for (const f of FIELDS) { if (m[f.id] == null && f.kw.some((k) => hl.includes(k))) { m[f.id] = i; break; } } });
    return m;
  };
  const onFile = (e) => {
    const f = e.target.files[0]; if (!f) return;
    setErr(""); setFname(f.name);
    const r = new FileReader();
    r.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(r.result), { type: "array" });
        const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }).filter((row) => row.some((c) => String(c).trim() !== ""));
        if (!data.length) { setErr("Лист пустой"); return; }
        setRows(data); setMap(guessMap(data[0])); setHasHeader(true);
      } catch (e2) { setErr("Не удалось прочитать файл: " + e2.message); }
    };
    r.readAsArrayBuffer(f);
  };
  const dataRows = rows ? (hasHeader ? rows.slice(1) : rows) : [];
  const header = rows ? (hasHeader ? rows[0] : (rows[0] || []).map((_, i) => "Колонка " + (i + 1))) : [];
  const cell = (row, fid) => (map[fid] == null ? "" : row[map[fid]]);
  const supByName = (nm) => { const s = suppliers.find((x) => x.name.toLowerCase().trim() === String(nm || "").toLowerCase().trim()); return s ? s.id : null; };

  const build = () => dataRows.map((row) => {
    const name = String(cell(row, "name") || "").trim();
    if (!name) return null;
    const prod = findProd(name);
    return {
      product_id: prod ? prod.id : null,
      name: prod ? prod.name : name,
      size: String(cell(row, "size") || (prod ? prod.size : "")).trim(),
      unit: String(cell(row, "unit") || (prod ? prod.unit : "шт")).trim() || "шт",
      qty: num(cell(row, "qty")) || 1,
      cost: map.cost != null ? num(cell(row, "cost")) : (prod ? prod.cost : 0),
      price: map.price != null ? num(cell(row, "price")) : (prod ? retailOf(prod) : 0),
      supplier_id: supByName(cell(row, "supplier")) || (prod ? prod.supplier_id : null),
      _matched: !!prod,
    };
  }).filter(Boolean);

  const run = () => {
    if (map.name == null) { setErr("Укажите колонку «Наименование»"); return; }
    const out = build().map(({ _matched, ...r }) => r);
    if (out.length) onSave(out);
  };
  const preview = rows ? build() : [];
  const matched = preview.filter((p) => p._matched).length;

  const [askCancel, setAskCancel] = useState(false);
  const tryClose = () => setAskCancel(true);
  return (
    <>
    <Modal title="Импорт позиций на объект из Excel" onClose={tryClose} w={900}>
      {err && <div className="card sect" style={{ borderColor: "var(--bad)", color: "var(--bad)", padding: 10 }}>{err}</div>}
      {!rows && (
        <div>
          <div className="card clk" style={{ borderStyle: "dashed", textAlign: "center", padding: 34 }} onClick={() => fRef.current.click()}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>📊</div>
            <div style={{ fontWeight: 800 }}>Выбрать файл Excel (.xlsx / .xls / .csv)</div>
            <div className="xs mut" style={{ marginTop: 4 }}>Список материалов по объекту. Совпавшие по названию товары подтянут цены из базы; цена/себестоимость из файла, если есть, имеют приоритет.</div>
          </div>
          <input ref={fRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={onFile} />
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={tryClose}>Отмена</button>
          </div>
        </div>
      )}
      {rows && (
        <div>
          <div className="row" style={{ marginBottom: 12 }}>
            <Badge c="#fff">{fname}</Badge>
            <span className="sm mut">строк: {dataRows.length} · совпало с базой: {matched}</span>
            <label className="sm clk" style={{ marginLeft: "auto" }}><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> первая строка — заголовки</label>
            <button className="btn xs" onClick={() => { setRows(null); setMap({}); }}>↺ другой файл</button>
          </div>
          <h3 style={{ marginBottom: 8 }}>Сопоставление колонок</h3>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", marginBottom: 14 }}>
            {FIELDS.map((f) => (
              <Fld key={f.id} label={f.label}>
                <select className="inp" value={map[f.id] == null ? "" : map[f.id]} onChange={(e) => setMap({ ...map, [f.id]: e.target.value === "" ? null : Number(e.target.value) })}>
                  <option value="">— нет —</option>
                  {header.map((h, i) => <option key={i} value={i}>{String(h || "Колонка " + (i + 1)).slice(0, 26)}</option>)}
                </select>
              </Fld>
            ))}
          </div>
          <h3 style={{ margin: "12px 0 8px" }}>Предпросмотр (первые 6)</h3>
          <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
            <table className="t">
              <thead><tr><th>Наименование</th><th>Размер</th><th style={{textAlign:"right"}}>Кол-во</th><th>Ед.</th><th style={{textAlign:"right"}}>Себест.</th><th style={{textAlign:"right"}}>Цена</th><th>База</th></tr></thead>
              <tbody>
                {preview.slice(0, 6).map((p, i) => (
                  <tr key={i}>
                    <td className="sm" style={{ fontWeight: 600 }}>{p.name}</td>
                    <td className="mono xs">{p.size}</td>
                    <td className="num">{p.qty}</td>
                    <td className="sm">{p.unit}</td>
                    <td className="num">{fmt(p.cost)}</td>
                    <td className="num">{fmt(p.price)}</td>
                    <td>{p._matched ? <Badge c="#3ddc7d">есть</Badge> : <Badge c="#ffb020">нет</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={tryClose}>Отмена</button>
            <button className="btn pri" disabled={map.name == null || !preview.length} onClick={run}>Добавить {preview.length} поз. на объект →</button>
          </div>
        </div>
      )}
    </Modal>
    {askCancel && <DiscardConfirm
      text={rows ? "Загруженный файл «" + fname + "» (" + dataRows.length + " строк) не будет добавлен в объект." : "Окно будет закрыто, в объект ничего не добавится."}
      onStay={() => setAskCancel(false)} onDiscard={onClose} />}
    </>
  );
}
function AddItemsModal({ products, suppliers, newBatch, onClose, onSave }) {
  const [rows, setRows] = useState([]);
  const addRow = (r) => setRows([...rows, r]);
  const blank = () => addRow({ product_id: null, name: "", size: "", unit: "шт", qty: 1, cost: 0, price: 0, supplier_id: "" });
  const upd = (i, k, val) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  const del = (i) => setRows(rows.filter((_, j) => j !== i));
  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);
  const [askCancel, setAskCancel] = useState(false);
  const tryClose = () => setAskCancel(true);
  return (
    <>
    <Modal title={newBatch ? "Новая поставка" : "Добавить позиции вручную"} onClose={tryClose} w={860}>
      <div className="row" style={{ marginBottom: 10 }}>
        <ProductPicker products={products} placeholder="найти товар в базе и добавить строку…" onPick={(p) => addRow({ product_id: p.id, name: p.name, size: p.size, unit: p.unit, qty: 1, cost: p.cost, price: retailOf(p), supplier_id: p.supplier_id })} />
        <button className="btn" onClick={blank}>+ Пустая строка (товара нет в базе)</button>
      </div>
      <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 360 }}>
        <table className="t">
          <thead><tr><th>Наименование</th><th style={{width:90}}>Размер</th><th style={{width:70}}>Ед.</th><th style={{width:80}}>Кол-во</th><th style={{width:110}}>Себест.</th><th style={{width:110}}>Цена</th><th style={{width:140}}>Поставщик</th><th></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input className="inp" value={r.name} onChange={(e) => upd(i, "name", e.target.value)} /></td>
                <td><input className="inp" value={r.size} onChange={(e) => upd(i, "size", e.target.value)} /></td>
                <td><input className="inp" value={r.unit} onChange={(e) => upd(i, "unit", e.target.value)} /></td>
                <td><input type="number" className="inp" value={r.qty} onChange={(e) => upd(i, "qty", Number(e.target.value) || 0)} /></td>
                <td><input type="number" className="inp num" value={r.cost} onChange={(e) => upd(i, "cost", Number(e.target.value) || 0)} /></td>
                <td><input type="number" className="inp num" value={r.price} onChange={(e) => upd(i, "price", Number(e.target.value) || 0)} /></td>
                <td><select className="inp" value={r.supplier_id || ""} onChange={(e) => upd(i, "supplier_id", e.target.value)}><option value="">—</option>{activeSuppliers(suppliers, r.supplier_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                <td><button className="btn xs dng" onClick={() => del(i)}>✕</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="mut" style={{ textAlign: "center", padding: 20 }}>Добавьте строки через поиск по базе или «Пустая строка»</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 14 }}>
        <div className="mono" style={{ fontWeight: 700 }}>Позиций: {rows.length} · Сумма: <span style={{ color: "var(--acc2)" }}>{money(total)}</span></div>
        <div className="row">
          <button className="btn" onClick={tryClose}>Отмена</button>
          <button className="btn pri" disabled={!rows.filter((r) => r.name).length} onClick={() => onSave(rows.filter((r) => r.name))}>{newBatch ? "Создать новую поставку" : "Добавить в текущую поставку"}</button>
        </div>
      </div>
    </Modal>
    {askCancel && <DiscardConfirm
      text={rows.length ? "Добавленные строки (" + rows.length + ") не будут сохранены в объект." : "Окно будет закрыто, в объект ничего не добавится."}
      onStay={() => setAskCancel(false)} onDiscard={onClose} />}
    </>
  );
}
function EditOpModal({ op, suppliers, isReturn, onClose, onSave }) {
  const usesPay = isPayType(op.type); // оплаты и расходы — со способом оплаты
  const [pay, setPay] = useState(() => payInit(op));
  const [v, setV] = useState({
    amount: op.amount || 0, op_date: (op.op_date || op.created_at || "").slice(0, 10),
    note: op.note || "", reason: op.reason || "", supplier_id: op.supplier_id || "", item_name: op.item_name || "", user: op.user || "",
  });
  return (
    <Modal title={"Редактировать: " + opLabel(op.type)} onClose={onClose} w={520}>
      {isReturn && <p className="sm" style={{ color: "var(--warn)", marginBottom: 10 }}>⚠ У возврата можно изменить только дату, причину и комментарий. Количество/сумму меняйте так: удалите возврат и оформите новый — иначе разойдётся склад.</p>}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {usesPay && <PayFields p={pay} setP={setPay} methods={payMethodsFor(op.type)} usdLabel={payUsdLabel(op.type)} />}
        {!isReturn && !usesPay && <Fld label="Сумма"><input type="number" className="inp" value={v.amount} onChange={(e) => setV({ ...v, amount: Number(e.target.value) || 0 })} /></Fld>}
        <Fld label="Дата операции"><input type="date" className="inp" value={v.op_date} onChange={(e) => setV({ ...v, op_date: e.target.value })} /></Fld>
        {op.type === "supplier_payment" && <Fld label="Поставщик"><select className="inp" value={v.supplier_id} onChange={(e) => setV({ ...v, supplier_id: e.target.value })}><option value="">—</option>{activeSuppliers(suppliers, v.supplier_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>}
        {op.type === "bonus" && <Fld label="Предмет"><input className="inp" value={v.item_name} onChange={(e) => setV({ ...v, item_name: e.target.value })} /></Fld>}
        {!usesPay && (isReturn || op.reason != null) && <Fld label="Причина"><input className="inp" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Fld>}
        <Fld label="Комментарий"><input className="inp" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Fld>
        <Fld label="Ответственный"><PersonSelect value={v.user} onChange={(u) => setV({ ...v, user: u })} /></Fld>
      </div>
      {op.edit_log && op.edit_log.length > 0 && (
        <div className="xs mut" style={{ marginTop: 10 }}>
          История изменений: {op.edit_log.map((l, i) => <div key={i}>· {new Date(l.at).toLocaleString("ru-RU")} — было: {fmt(l.before.amount)} от {dt(l.before.op_date)}</div>)}
        </div>
      )}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" onClick={() => {
          const patch = { op_date: v.op_date, note: v.note, reason: v.reason, user: v.user };
          if (!isReturn) patch.amount = v.amount;
          if (op.type === "supplier_payment") patch.supplier_id = v.supplier_id || null;
          if (op.type === "bonus") patch.item_name = v.item_name || null;
          if (usesPay) Object.assign(patch, payPatch(pay, op.type, false));
          onSave(patch);
        }} disabled={usesPay && !(payUsd(pay) > 0)}>Сохранить</button>
      </div>
    </Modal>
  );
}
function ReturnForm({ obj, ops, onClose, onSave }) {
  const items = obj.items || [];
  // уже возвращено по каждой позиции (несторнированные операции)
  const returned = {};
  ops.filter((o) => o.type === "return" && !o.voided).forEach((o) => {
    const key = o.item_id || o.product_id;
    returned[key] = (returned[key] || 0) + (o.qty || 0);
  });
  const [rows, setRows] = useState(items.map((i) => {
    const done = returned[i.id] || returned[i.product_id] || 0;
    return { item: i, done, avail: Math.max(0, i.qty - done), ret: 0 };
  }));
  const [reason, setReason] = useState("");
  const [opDate, setOpDate] = useState(today());
  const [user, setUser] = useState(obj.manager || curUserName());
  // куда уходит товар: на Склад Thermo (долг поставщику не меняется) или сразу поставщику (долг уменьшается)
  const [dest, setDest] = useState("wh");
  const setRet = (idx, val) => setRows(rows.map((r, j) => (j === idx ? { ...r, ret: Math.max(0, Math.min(Number(val) || 0, r.avail)) } : r)));
  const totalSum = rows.reduce((a, r) => a + r.ret * (r.item.price || 0), 0);
  const totalCnt = rows.filter((r) => r.ret > 0).length;
  const batch = uuid();
  const noSup = rows.filter((r) => r.ret > 0 && !r.item.supplier_id).length;
  const submit = () => {
    const list = rows.filter((r) => r.ret > 0).map((r) => {
      const toSup = dest === "sup" && !!r.item.supplier_id;
      return {
        object_id: obj.id, type: "return", batch_id: batch,
        item_id: r.item.id, product_id: r.item.product_id, product_name: r.item.name,
        unit: r.item.unit, size: r.item.size,
        qty: r.ret, amount: r.ret * (r.item.price || 0), cost_amount: r.ret * (r.item.cost || 0),
        // supplier_id в операции = товар ушёл поставщику (уменьшает его долг); у возврата на склад — пусто
        supplier_id: toSup ? r.item.supplier_id : null, reason, op_date: opDate || today(), user,
        _toWh: !toSup, _supplier: r.item.supplier_id || null,
      };
    });
    onSave(list);
  };
  return (
    <Modal title="Возврат товара (можно несколько позиций сразу)" onClose={onClose} w={780}>
      <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 14, maxHeight: 340 }}>
        <table className="t">
          <thead><tr><th>Товар</th><th style={{textAlign:"right"}}>В объекте</th><th style={{textAlign:"right"}}>Уже возвр.</th><th style={{textAlign:"right"}}>Доступно</th><th style={{width:100}}>Вернуть</th><th style={{textAlign:"right"}}>Сумма</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.item.id} style={{ background: r.ret > 0 ? "rgba(255,31,48,.07)" : "none", opacity: r.avail === 0 ? 0.45 : 1 }}>
                <td className="sm" style={{ fontWeight: 600 }}>{r.item.name}<div className="xs mut">{fmt(r.item.price)} / {r.item.unit}</div></td>
                <td className="num">{r.item.qty}</td>
                <td className="num mut">{r.done}</td>
                <td className="num">{r.avail}</td>
                <td><input type="number" className="inp" min={0} max={r.avail} value={r.ret} disabled={r.avail === 0}
                  onChange={(e) => setRet(i, e.target.value)} /></td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(r.ret * (r.item.price || 0))}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="mut" style={{ textAlign: "center", padding: 20 }}>В объекте нет материалов</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card sect" style={{ padding: 10, marginBottom: 12 }}>
        <div className="sm" style={{ fontWeight: 700, marginBottom: 6 }}>Куда вернуть товар?</div>
        <label className="clk sm" style={{ display: "block" }}><input type="radio" name="retdest" checked={dest === "wh"} onChange={() => setDest("wh")} /> <b>На склад Thermo</b> <span className="mut">— товар остаётся у вас, долг поставщику не меняется (вернуть поставщику можно позже: Склад Thermo → «↩ поставщику»)</span></label>
        <label className="clk sm" style={{ display: "block", marginTop: 4 }}><input type="radio" name="retdest" checked={dest === "sup"} onChange={() => setDest("sup")} /> <b>Сразу поставщику</b> <span className="mut">— товар уходит поставщику, его долг уменьшится на себестоимость</span></label>
        {dest === "sup" && noSup > 0 && <div className="xs" style={{ color: "var(--warn)", marginTop: 6 }}>У {noSup} поз. не указан поставщик — они будут оприходованы на склад.</div>}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
        <Fld label="Причина (общая)"><input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="брак / не подошло / излишек" /></Fld>
        <Fld label="Дата возврата"><input type="date" className="inp" value={opDate} onChange={(e) => setOpDate(e.target.value)} /></Fld>
        <Fld label="Ответственный"><PersonSelect value={user} onChange={setUser} /></Fld>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
        <div className="mono" style={{ fontWeight: 700 }}>Позиций: {totalCnt} · Итого возврат: <span style={{ color: "var(--bad)" }}>{money(totalSum)}</span></div>
        <div className="row">
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn pri" disabled={!totalCnt} onClick={submit}>Оформить возврат</button>
        </div>
      </div>
    </Modal>
  );
}
function OpForm({ obj, type, suppliers, onClose, onSave }) {
  const items = obj.items || [];
  // поставщики этого объекта — первыми в списке; если он один, выбран сразу
  const objSupIds = [...new Set(items.filter((i) => i.supplier_id && !i.from_warehouse).map((i) => i.supplier_id))];
  const supOpts = [...suppliers.filter((s) => objSupIds.includes(s.id)), ...activeSuppliers(suppliers).filter((s) => !objSupIds.includes(s.id))];
  const [v, setV] = useState({ amount: 0, note: "", reason: "", supplier_id: type === "supplier_payment" && objSupIds.length === 1 ? objSupIds[0] : "", item_id: items[0] ? items[0].id : "", qty: 1, item_name: "", op_date: today(), user: obj.manager || curUserName() });
  const isReturn = type === "return";
  const isSupPay = type === "supplier_payment";
  const isBonus = type === "bonus";
  const usesPay = isPayType(type); // клиент платит / оплата поставщику / доп. расход — со способом оплаты
  const [pay, setPay] = useState(() => payInit(null));
  const item = items.find((i) => i.id === v.item_id);
  const retAmount = item ? v.qty * item.price : 0;
  const submit = () => {
    const base = { object_id: obj.id, type, note: v.note, reason: v.reason, user: v.user, op_date: v.op_date || today() };
    if (isReturn && item) {
      onSave({ ...base, amount: retAmount, cost_amount: v.qty * item.cost, qty: v.qty, product_id: item.product_id, product_name: item.name, supplier_id: item.supplier_id });
    } else if (usesPay) {
      onSave({ ...base, ...payPatch(pay, type), supplier_id: isSupPay ? v.supplier_id || null : null });
    } else {
      onSave({ ...base, amount: Number(v.amount) || 0, supplier_id: isSupPay ? v.supplier_id || null : null, item_name: isBonus && v.item_name ? v.item_name : null });
    }
  };
  return (
    <Modal title={opLabel(type)} onClose={onClose} w={520}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {isReturn ? (
          <>
            <div style={{ gridColumn: "1/-1" }}><Fld label="Товар из объекта">
              <select className="inp" value={v.item_id} onChange={(e) => setV({ ...v, item_id: e.target.value })}>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} (в объекте: {i.qty} {i.unit})</option>)}
              </select></Fld></div>
            <Fld label="Количество"><input type="number" className="inp" value={v.qty} onChange={(e) => setV({ ...v, qty: Math.min(Number(e.target.value) || 0, item ? item.qty : 0) })} /></Fld>
            <Fld label="Сумма возврата"><div className="inp mono" style={{ background: "var(--panel)" }}>{fmt(retAmount)}</div></Fld>
            <div style={{ gridColumn: "1/-1" }}><Fld label="Причина"><input className="inp" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="брак / не подошло / излишек" /></Fld></div>
          </>
        ) : (
          <>
            {usesPay ? <PayFields p={pay} setP={setPay} methods={payMethodsFor(type)} usdLabel={payUsdLabel(type)} /> : <Fld label="Сумма"><input type="number" className="inp" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Fld>}
            {isSupPay && <Fld label="Поставщик (обязательно)"><select className="inp" value={v.supplier_id} onChange={(e) => setV({ ...v, supplier_id: e.target.value })} style={{ borderColor: v.supplier_id ? undefined : "var(--bad)" }}><option value="">— выберите поставщика —</option>{supOpts.map((s) => <option key={s.id} value={s.id}>{s.name}{objSupIds.includes(s.id) ? " · в этом объекте" : ""}</option>)}</select></Fld>}
            {isBonus && <Fld label="Предмет (если бонус вещью)"><input className="inp" value={v.item_name} onChange={(e) => setV({ ...v, item_name: e.target.value })} placeholder="инструмент / предмет — опц." /></Fld>}
            <div style={{ gridColumn: "1/-1" }}><Fld label="Комментарий"><input className="inp" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Fld></div>
          </>
        )}
        <Fld label="Дата операции"><input type="date" className="inp" value={v.op_date} onChange={(e) => setV({ ...v, op_date: e.target.value })} /></Fld>
        <Fld label="Ответственный"><PersonSelect value={v.user} onChange={(u) => setV({ ...v, user: u })} /></Fld>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" onClick={submit} disabled={isReturn ? !item || !v.qty : usesPay ? !(payUsd(pay) > 0) || (isSupPay && !v.supplier_id) : !Number(v.amount)} title={isSupPay && !v.supplier_id ? "Выберите поставщика — иначе оплата не уменьшит его долг" : ""}>Сохранить</button>
      </div>
    </Modal>
  );
}

/* ============ MASTERS TAB ============ */
function MastersTab({ data, reload, toast, openObject, fin = true }) {
  const { masters, objects, finance_ops } = data;
  const [openId, setOpenId] = useState(null);
  const [edit, setEdit] = useState(null);
  const m = masters.find((x) => x.id === openId);
  if (m) return <MasterDetail m={m} data={data} reload={reload} toast={toast} fin={fin} back={() => setOpenId(null)} openObject={openObject} onEdit={() => setEdit(m)} edit={edit} setEdit={setEdit} />;
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Мастера <span className="mut sm">({masters.length})</span></h2>
        {fin && <button className="btn pri" onClick={() => setEdit({ status: "active", bonus_percent: 10 })}>+ Мастер</button>}
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Мастер</th><th>Специализация</th>{fin && <th>% бонуса</th>}<th style={{textAlign:"right"}}>Объектов</th><th style={{textAlign:"right"}}>Сумма товаров</th>{fin && <th style={{textAlign:"right"}}>Вал. прибыль</th>}{fin && <th style={{textAlign:"right"}}>Бонус начислен</th>}{fin && <th style={{textAlign:"right"}}>Выплачено</th>}{fin && <th style={{textAlign:"right"}}>Долг мастеру</th>}<th></th></tr></thead>
          <tbody>
            {masters.map((x) => {
              const st = masterStats(x, objects, finance_ops);
              return (
                <tr key={x.id} className="clk" style={{ opacity: x.status === "active" ? 1 : 0.45 }} onClick={() => setOpenId(x.id)}>
                  <td style={{ fontWeight: 700 }}>{x.name}<div className="xs mut mono">{x.phone}</div></td>
                  <td className="sm">{x.specialty}</td>
                  {fin && <td className="num">{x.bonus_percent || 0}%</td>}
                  <td className="num">{st.count}</td>
                  <td className="num">{fmt(st.sale)}</td>
                  {fin && <td className="num">{fmt(st.gross)}</td>}
                  {fin && <td className="num">{fmt(st.accrued)}</td>}
                  {fin && <td className="num" style={{ color: "var(--ok)" }}>{fmt(st.paid)}</td>}
                  {fin && <td className="num" style={{ color: st.debtToMaster > 0 ? "var(--warn)" : "var(--mut)", fontWeight: 700 }}>{fmt(st.debtToMaster)}</td>}
                  <td>{fin && <button className="btn xs" onClick={(e) => { e.stopPropagation(); setEdit(x); }}>ред.</button>}</td>
                </tr>
              );
            })}
            {!masters.length && <tr><td colSpan={fin ? 10 : 5} className="mut" style={{ textAlign: "center", padding: 24 }}>Мастеров нет</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <MasterForm m={edit} onClose={() => setEdit(null)} onSave={async (v) => {
        if (v.id) await db.from("masters").update(v).eq("id", v.id);
        else await db.from("masters").insert(v);
        setEdit(null); await reload(); toast("Мастер сохранён");
      }} />}
    </div>
  );
}
function MasterDetail({ m, data, reload, toast, back, openObject, edit, setEdit, fin = true }) {
  const { objects, finance_ops } = data;
  const st = masterStats(m, objects, finance_ops);
  const [payForm, setPayForm] = useState(false);
  const [accForm, setAccForm] = useState(false);
  const [delForm, setDelForm] = useState(false);
  const payOps = finance_ops.filter((x) => x.master_id === m.id && ["bonus", "bonus_payment"].includes(x.type));
  const KPI = ({ l, v, c }) => <div className="kpi"><div className="l">{l}</div><div className="v" style={{ color: c }}>{fmt(v)}</div></div>;
  return (
    <div>
      <div className="row sect">
        <button className="btn" onClick={back}>← Мастера</button>
        <div style={{ marginRight: "auto" }}>
          <h2>{m.name} {m.status !== "active" && <Badge c="#9a9a9a">неактивен</Badge>}</h2>
          <div className="sm mut">{m.specialty} · {m.phone}{fin ? " · бонус по умолчанию: " + (m.bonus_percent || 0) + "% от валовой" : ""}{m.note ? " · " + m.note : ""}</div>
        </div>
        {fin && <button className="btn dng" onClick={() => setDelForm(true)}>Удалить</button>}
        {fin && <button className="btn" onClick={() => setEdit(m)}>Редактировать</button>}
        {fin && <button className="btn" onClick={() => setAccForm(true)}>+ Начислить бонус</button>}
        {fin && <button className="btn pri" onClick={() => setPayForm(true)}>Выплатить бонус</button>}
      </div>
      <div className="kpis sect">
        <KPI l="Объектов" v={st.count} />
        <KPI l="Сумма товаров по объектам" v={st.sale} />
        {fin && <KPI l="Валовая прибыль" v={st.gross} c="#fff" />}
        {fin && <KPI l="Бонус начислен" v={st.accrued} />}
        {fin && <KPI l={"Расчётный (" + (m.bonus_percent || 0) + "%)"} v={st.suggested} c="var(--mut)" />}
        {fin && <KPI l="Выплачено" v={st.paid} c="var(--ok)" />}
        {fin && <KPI l="Долг мастеру" v={st.debtToMaster} c={st.debtToMaster > 0 ? "var(--warn)" : "var(--mut)"} />}
        <KPI l="Долги клиентов (его объекты)" v={st.clientDebt} c={st.clientDebt > 0 ? "var(--bad)" : "var(--mut)"} />
      </div>
      <div className="card sect" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Объект</th><th>Клиент</th><th>Статус</th><th style={{textAlign:"right"}}>Сумма товара</th>{fin && <th style={{textAlign:"right"}}>Вал. прибыль</th>}{fin && <th style={{textAlign:"right"}}>Бонус начислен</th>}<th style={{textAlign:"right"}}>Долг клиента</th></tr></thead>
          <tbody>
            {st.rows.map(({ o, f }) => (
              <tr key={o.id} className="clk" onClick={() => openObject(o.id)}>
                <td style={{ fontWeight: 600 }}>{o.name}</td>
                <td className="sm">{o.client}</td>
                <td><Badge c={stById(o.status).c}>{stById(o.status).label}</Badge></td>
                <td className="num">{fmt(f.saleNet)}</td>
                {fin && <td className="num" style={{ color: f.gross >= 0 ? "var(--ok)" : "var(--bad)" }}>{fmt(f.gross)}</td>}
                {fin && <td className="num">{fmt(f.bonus)}</td>}
                <td className="num" style={{ color: f.clientDebt > 0 ? "var(--bad)" : f.clientDebt < 0 ? "var(--ok)" : "var(--mut)" }}>{f.clientDebt < 0 ? "−" + fmt(Math.abs(f.clientDebt)) : fmt(f.clientDebt)}</td>
              </tr>
            ))}
            {!st.rows.length && <tr><td colSpan={fin ? 7 : 5} className="mut" style={{ textAlign: "center", padding: 22 }}>Объектов не прикреплено — назначьте мастера в карточке объекта</td></tr>}
          </tbody>
        </table>
      </div>
      {fin && <h3 className="sect">Бонусы: начисления и выплаты</h3>}
      {fin && <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Дата</th><th>Тип</th><th>Объект</th><th style={{textAlign:"right"}}>Сумма</th><th>Комментарий</th></tr></thead>
          <tbody>
            {payOps.slice().reverse().map((o) => (
              <tr key={o.id} style={{ opacity: o.voided ? 0.4 : 1, textDecoration: o.voided ? "line-through" : "none" }}>
                <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                <td>{opLabel(o.type)}</td>
                <td className="sm">{(objects.find((x) => x.id === o.object_id) || {}).name || "—"}</td>
                <td className="num" style={{ fontWeight: 700, color: o.type === "bonus_payment" ? "var(--ok)" : "inherit" }}>{fmt(o.amount)}</td>
                <td className="xs mut">{[o.item_name, o.type === "bonus_payment" ? payText(o) : "", o.note].filter(Boolean).join(" · ")}</td>
              </tr>
            ))}
            {!payOps.length && <tr><td colSpan={5} className="mut" style={{ textAlign: "center", padding: 20 }}>Операций нет</td></tr>}
          </tbody>
        </table>
      </div>}
      {fin && payForm && (
        <Modal title={"Выплата бонуса — " + m.name} onClose={() => setPayForm(false)} w={560}>
          <BonusPayForm debt={st.debtToMaster} onSave={async (p) => {
            const r = await db.from("finance_ops").insert({ type: "bonus_payment", master_id: m.id, object_id: null, ...p, user: curUserName() || "fin" });
            if (r.error) return; // ошибка показана, окно остаётся открытым
            await logAction("Выплата бонуса мастеру", "master:" + m.name, fmt(p.amount) + " · " + payText(p) + (p.note ? " · " + p.note : ""));
            setPayForm(false); await reload(); toast("Выплата записана: " + fmt(p.amount) + " · " + payText(p));
          }} />
        </Modal>
      )}
      {edit && <MasterForm m={edit} onClose={() => setEdit(null)} onSave={async (v) => {
        await db.from("masters").update(v).eq("id", v.id);
        setEdit(null); await reload(); toast("Сохранено");
      }} />}
      {fin && accForm && (
        <Modal title={"Начислить бонус — " + m.name} onClose={() => setAccForm(false)} w={520}>
          <BonusAccrueForm objects={st.rows.map((r) => r.o)} onSave={async (op) => {
            await db.from("finance_ops").insert({ ...op, type: "bonus", master_id: m.id, user: "boss" });
            setAccForm(false); await reload(); toast("Бонус начислен");
          }} />
        </Modal>
      )}
      {fin && delForm && (
        <Modal title="Удалить мастера" onClose={() => setDelForm(false)} w={460}>
          <p style={{ marginBottom: 6 }}>Удалить мастера <b style={{ color: "var(--bad)" }}>{m.name}</b>?</p>
          <p className="sm mut" style={{ marginBottom: 8 }}>Его объекты останутся (имя сохранится текстом), история бонусов и выплат останется в финансах.</p>
          {st.debtToMaster > 0 && <p className="sm" style={{ color: "var(--warn)", marginBottom: 8 }}>⚠ По мастеру есть невыплаченный бонус: {fmt(st.debtToMaster)}</p>}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
            <button className="btn" onClick={() => setDelForm(false)}>Отмена</button>
            <button className="btn" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={async () => {
              await db.from("masters").delete().eq("id", m.id);
              await reload(); toast("Мастер удалён"); back();
            }}>Удалить</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function BonusAccrueForm({ objects, onSave }) {
  const [kind, setKind] = useState("money");
  const [itemName, setItemName] = useState("");
  const [amount, setAmount] = useState(0);
  const [objId, setObjId] = useState("");
  const [note, setNote] = useState("");
  const [opDate, setOpDate] = useState(today());
  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={"btn " + (kind === "money" ? "pri" : "")} onClick={() => setKind("money")}>💵 Деньгами</button>
        <button className={"btn " + (kind === "item" ? "pri" : "")} onClick={() => setKind("item")}>🛠 Инструмент / предмет</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {kind === "item" && <div style={{ gridColumn: "1/-1" }}><Fld label="Предмет">
          <input className="inp" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Перфоратор Bosch GBH 2-26 / набор ключей / телефон…" /></Fld></div>}
        <Fld label={kind === "item" ? "Цена предмета (вручную)" : "Сумма бонуса"}>
          <input type="number" className="inp" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} /></Fld>
        <Fld label="Привязать к объекту (опц.)">
          <select className="inp" value={objId} onChange={(e) => setObjId(e.target.value)}>
            <option value="">— без объекта —</option>
            {objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></Fld>
        <Fld label="Дата начисления"><input type="date" className="inp" value={opDate} onChange={(e) => setOpDate(e.target.value)} /></Fld>
        <Fld label="Комментарий"><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></Fld>
      </div>
      <p className="xs mut" style={{ marginTop: 8 }}>{kind === "item" ? "Предмет начислится как бонус по его цене и увеличит долг перед мастером — закроете его «выплатой» при передаче." : objId ? "Сумма уменьшит чистую прибыль выбранного объекта." : "Бонус без объекта — учитывается только в расчётах по мастеру."}</p>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button className="btn pri" disabled={!amount || (kind === "item" && !itemName)} onClick={() => onSave({ amount, item_name: kind === "item" ? itemName : null, object_id: objId || null, note, op_date: opDate || today() })}>Начислить</button>
      </div>
    </div>
  );
}
function BonusPayForm({ debt, onSave }) {
  const [pay, setPay] = useState(() => payInit(null, debt > 0 ? debt : 0));
  const [note, setNote] = useState("");
  const [opDate, setOpDate] = useState(today());
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <div className="sm mut" style={{ marginBottom: 10 }}>Текущий долг мастеру: <b className="mono" style={{ color: "var(--warn)" }}>{fmt(debt)}</b>
        {debt > 0 && <button type="button" className="btn xs" style={{ marginLeft: 8 }} onClick={() => setPay(paySetUsd(pay, debt))}>= весь долг</button>}</div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <PayFields p={pay} setP={setPay} methods={OUT_METHODS} usdLabel={payUsdLabel("bonus_payment")} />
        <Fld label="Дата выплаты"><input type="date" className="inp" value={opDate} onChange={(e) => setOpDate(e.target.value)} /></Fld>
        <Fld label="Комментарий"><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="за объект / аванс…" /></Fld>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button className="btn pri" disabled={!(payUsd(pay) > 0) || busy} onClick={async () => { setBusy(true); await onSave({ ...payPatch(pay, "bonus_payment"), note, op_date: opDate || today() }); setBusy(false); }}>{busy ? "Записываю…" : "Выплатить"}</button>
      </div>
    </div>
  );
}
function MasterForm({ m, onClose, onSave }) {
  const [v, setV] = useState({ ...m });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal title={v.id ? "Мастер" : "Новый мастер"} onClose={onClose} w={520}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Fld label="Имя"><input className="inp" value={v.name || ""} onChange={set("name")} /></Fld>
        <Fld label="Телефон"><input className="inp" value={v.phone || ""} onChange={set("phone")} /></Fld>
        <Fld label="Специализация"><input className="inp" value={v.specialty || ""} onChange={set("specialty")} /></Fld>
        <Fld label="% бонуса (от валовой)"><input type="number" className="inp" value={v.bonus_percent || 0} onChange={(e) => setV({ ...v, bonus_percent: Number(e.target.value) || 0 })} /></Fld>
        <Fld label="Статус"><select className="inp" value={v.status} onChange={set("status")}><option value="active">активен</option><option value="inactive">неактивен</option></select></Fld>
        <Fld label="Заметка"><input className="inp" value={v.note || ""} onChange={set("note")} /></Fld>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" disabled={!v.name} onClick={() => onSave(v)}>Сохранить</button>
      </div>
    </Modal>
  );
}

/* ============ СКЛАД THERMO ============ */
function WarehouseTab({ data, reload, toast, openObject }) {
  const { warehouse, wh_moves, objects, suppliers } = data;
  const [issue, setIssue] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [delRow, setDelRow] = useState(null);
  const [retForm, setRetForm] = useState(null);
  const stock = warehouse.filter((w) => (w.qty || 0) > 0);
  const totalCost = stock.reduce((a, w) => a + w.qty * (w.cost || 0), 0);
  const totalSale = stock.reduce((a, w) => a + w.qty * (w.price || 0), 0);
  const KPI = ({ l, v, c }) => <div className="kpi"><div className="l">{l}</div><div className="v" style={{ color: c }}>{fmt(v)}</div></div>;
  const saveRow = async (patch) => {
    await db.from("warehouse").update({ qty: patch.qty, cost: patch.cost, price: patch.price }).eq("id", editRow.id);
    await logAction("Склад: изменена позиция", editRow.name, "кол-во " + editRow.qty + " → " + patch.qty);
    setEditRow(null); await reload(); toast("Позиция обновлена");
  };
  const confirmDelRow = async () => {
    await db.from("warehouse").delete().eq("id", delRow.id);
    await db.from("wh_moves").insert(cleanUuids({ product_id: delRow.product_id, name: delRow.name, qty: delRow.qty, dir: "out", object_id: null, object_name: null, op_date: today(), user: CURRENT_USER ? (CURRENT_USER.name || CURRENT_USER.username) : "", note: "позиция удалена со склада вручную" }));
    await logAction("Склад: позиция удалена", delRow.name, "кол-во " + delRow.qty);
    setDelRow(null); await reload(); toast("Позиция удалена со склада");
  };
  // Возврат поставщику со склада: списываем количество и создаём финансовую операцию type:"return",
  // привязанную к supplier_id — она автоматически вычитается из долга поставщику (см. supplierStats: returns по cost_amount).
  const submitSupplierReturn = async (row, qty, supplierId, reason) => {
    const newQty = Math.max(0, row.qty - qty);
    const costAmount = qty * (row.cost || 0);
    // сначала финансовая операция: если она не сохранится, склад не трогаем
    const r = await db.from("finance_ops").insert(cleanUuids({
      type: "return", object_id: null, supplier_id: supplierId, product_id: row.product_id, product_name: row.name,
      qty, amount: qty * (row.price || 0), cost_amount: costAmount, reason: reason || "возврат поставщику со склада",
      op_date: today(), user: CURRENT_USER ? (CURRENT_USER.name || CURRENT_USER.username) : "",
    }));
    if (r.error) return;
    await db.from("warehouse").update({ qty: newQty }).eq("id", row.id);
    await db.from("wh_moves").insert(cleanUuids({ product_id: row.product_id, name: row.name, qty, dir: "out", object_id: null, object_name: null, op_date: today(), user: CURRENT_USER ? (CURRENT_USER.name || CURRENT_USER.username) : "", note: "возврат поставщику" }));
    await logAction("Возврат поставщику со склада", row.name, "кол-во " + qty + ", на сумму себест. " + fmt(costAmount));
    setRetForm(null); await reload(); toast("Возврат поставщику оформлен: −" + fmt(costAmount) + " к долгу");
  };
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Склад Thermo <span className="mut sm">(возвраты с объектов)</span></h2>
        <button className="btn pri" disabled={!stock.length} onClick={() => setIssue(true)}>→ Отправить на объект</button>
      </div>
      <div className="kpis sect">
        <KPI l="Позиций на складе" v={stock.length} />
        <KPI l="Единиц всего" v={stock.reduce((a, w) => a + w.qty, 0)} />
        <KPI l="Склад по закупу" v={totalCost} />
        <KPI l="Склад по продаже" v={totalSale} c="#fff" />
      </div>
      <div className="card sect" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Товар</th><th>Размер</th><th style={{textAlign:"right"}}>Кол-во</th><th>Ед.</th><th style={{textAlign:"right"}}>Закуп</th><th style={{textAlign:"right"}}>Продажа</th><th style={{textAlign:"right"}}>Сумма (закуп)</th><th></th></tr></thead>
          <tbody>
            {stock.map((w) => (
              <tr key={w.id}>
                <td style={{ fontWeight: 600 }}>{w.name}</td>
                <td className="mono xs">{w.size}</td>
                <td className="num" style={{ fontWeight: 700, color: "var(--acc2)" }}>{w.qty}</td>
                <td className="sm">{w.unit}</td>
                <td className="num">{fmt(w.cost)}</td>
                <td className="num">{fmt(w.price)}</td>
                <td className="num">{fmt(w.qty * (w.cost || 0))}</td>
                <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                  <button className="btn xs" onClick={() => setEditRow(w)}>ред.</button>
                  <button className="btn xs" onClick={() => setRetForm(w)}>↩ поставщику</button>
                  <button className="btn xs dng" onClick={() => setDelRow(w)}>✕</button>
                </div></td>
              </tr>
            ))}
            {!stock.length && <tr><td colSpan={8} className="mut" style={{ textAlign: "center", padding: 26 }}>Склад пуст — товары появляются автоматически при возвратах с объектов</td></tr>}
          </tbody>
        </table>
      </div>
      <h3 className="sect">История движений</h3>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Дата</th><th>Направление</th><th>Товар</th><th style={{textAlign:"right"}}>Кол-во</th><th>Объект</th><th>Кто</th></tr></thead>
          <tbody>
            {wh_moves.slice().reverse().map((mv) => (
              <tr key={mv.id}>
                <td className="xs mono mut">{dt(mv.op_date || mv.created_at)}</td>
                <td><Badge c={mv.dir === "in" ? "#3ddc7d" : "#ff707b"}>{mv.dir === "in" ? "⬇ Приход" : "⬆ Отгрузка"}</Badge><div className="xs mut">{mv.note}</div></td>
                <td className="sm">{mv.name}</td>
                <td className="num" style={{ fontWeight: 700 }}>{mv.qty}</td>
                <td className="sm clk" style={{ color: "var(--acc2)" }} onClick={() => mv.object_id && openObject(mv.object_id)}>{mv.object_name || "—"}</td>
                <td className="xs mut">{mv.user}</td>
              </tr>
            ))}
            {!wh_moves.length && <tr><td colSpan={6} className="mut" style={{ textAlign: "center", padding: 20 }}>Движений нет</td></tr>}
          </tbody>
        </table>
      </div>
      {issue && <IssueForm stock={stock} objects={objects} onClose={() => setIssue(false)} onSave={async (lines, targetObj, user) => {
        const exNos = (targetObj.items || []).map((i) => i.batch_no || 1);
        const batchNo = exNos.length ? Math.max(...exNos) + 1 : 1;
        const items = lines.map((l) => ({
          id: uuid(), product_id: l.row.product_id, name: l.row.name, size: l.row.size, unit: l.row.unit,
          qty: l.qty, price: l.row.price || 0, cost: l.row.cost || 0,
          supplier_id: l.row.supplier_id || null, from_warehouse: true,
          source_text: "со склада Thermo", confidence: 100,
          batch_no: batchNo, batch_date: today(),
        }));
        await db.from("objects").update({ items: [...(targetObj.items || []), ...items] }).eq("id", targetObj.id);
        await warehouseOut(lines, targetObj, user);
        setIssue(false); await reload();
        await logAction("Отгрузка со склада", "object:" + targetObj.name, "позиций: " + lines.length); toast("Отгружено на «" + targetObj.name + "»: " + lines.length + " поз.");
      }} />}
      {editRow && (
        <Modal title="Редактировать позицию склада" onClose={() => setEditRow(null)} w={460}>
          <WarehouseEditForm row={editRow} onCancel={() => setEditRow(null)} onSave={saveRow} />
        </Modal>
      )}
      {delRow && (
        <Modal title="Удалить позицию со склада?" onClose={() => setDelRow(null)} w={420}>
          <p className="sm mut">«{delRow.name}» ({delRow.qty} {delRow.unit}) будет полностью удалено со склада. Это действие нельзя отменить.</p>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
            <button className="btn" onClick={() => setDelRow(null)}>Отмена</button>
            <button className="btn dng" onClick={confirmDelRow}>Удалить</button>
          </div>
        </Modal>
      )}
      {retForm && (
        <Modal title={"Возврат поставщику — " + retForm.name} onClose={() => setRetForm(null)} w={480}>
          <SupplierReturnForm row={retForm} suppliers={suppliers} onCancel={() => setRetForm(null)} onSave={submitSupplierReturn} />
        </Modal>
      )}
    </div>
  );
}
function WarehouseEditForm({ row, onCancel, onSave }) {
  const [qty, setQty] = useState(row.qty);
  const [cost, setCost] = useState(row.cost);
  const [price, setPrice] = useState(row.price);
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Fld label="Количество"><input type="number" className="inp" value={qty} onChange={(e) => setQty(e.target.value)} /></Fld>
        <Fld label="Ед."><div className="inp mono" style={{ background: "var(--panel2)" }}>{row.unit}</div></Fld>
        <Fld label="Себестоимость"><input type="number" className="inp" value={cost} onChange={(e) => setCost(e.target.value)} /></Fld>
        <Fld label="Цена продажи"><input type="number" className="inp" value={price} onChange={(e) => setPrice(e.target.value)} /></Fld>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
        <button className="btn" onClick={onCancel}>Отмена</button>
        <button className="btn pri" onClick={() => onSave({ qty: Number(qty) || 0, cost: Number(cost) || 0, price: Number(price) || 0 })}>Сохранить</button>
      </div>
    </div>
  );
}
function SupplierReturnForm({ row, suppliers, onCancel, onSave }) {
  const [qty, setQty] = useState(Math.min(1, row.qty));
  const [supplierId, setSupplierId] = useState(row.supplier_id || "");
  const [reason, setReason] = useState("");
  const costAmount = (Number(qty) || 0) * (row.cost || 0);
  return (
    <div>
      <p className="sm mut" style={{ marginBottom: 12 }}>Сумма возврата по себестоимости будет вычтена из долга выбранному поставщику.</p>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Fld label="Поставщик">
          <select className="inp" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">—</option>
            {activeSuppliers(suppliers, supplierId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Fld>
        <Fld label={"Количество (на складе: " + row.qty + ")"}>
          <input type="number" className="inp" min={1} max={row.qty} value={qty} onChange={(e) => setQty(Math.max(0, Math.min(Number(e.target.value) || 0, row.qty)))} />
        </Fld>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Причина"><input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="брак / излишек / не подошло" /></Fld></div>
        <div className="fld"><label>Сумма (себестоимость)</label><div className="inp mono" style={{ background: "var(--panel2)" }}>{fmt(costAmount)}</div></div>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
        <button className="btn" onClick={onCancel}>Отмена</button>
        <button className="btn pri" disabled={!supplierId || !qty} onClick={() => onSave(row, Number(qty) || 0, supplierId, reason)}>Оформить возврат</button>
      </div>
    </div>
  );
}
function IssueForm({ stock, objects, onClose, onSave }) {
  const targets = objects.filter((o) => !["closed", "cancelled"].includes(o.status));
  const [objId, setObjId] = useState(targets[0] ? targets[0].id : "");
  const [user, setUser] = useState(curUserName());
  const [rows, setRows] = useState(stock.map((w) => ({ row: w, qty: 0 })));
  const setQty = (i, v) => setRows(rows.map((r, j) => (j === i ? { ...r, qty: Math.max(0, Math.min(Number(v) || 0, r.row.qty)) } : r)));
  const lines = rows.filter((r) => r.qty > 0);
  const total = lines.reduce((a, r) => a + r.qty * (r.row.price || 0), 0);
  const target = objects.find((o) => o.id === objId);
  return (
    <Modal title="Отгрузка со склада на объект" onClose={onClose} w={760}>
      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", marginBottom: 12 }}>
        <Fld label="Объект назначения">
          <select className="inp" value={objId} onChange={(e) => setObjId(e.target.value)}>
            {targets.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.client})</option>)}
          </select>
        </Fld>
        <Fld label="Ответственный"><PersonSelect value={user} onChange={setUser} /></Fld>
      </div>
      <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 320 }}>
        <table className="t">
          <thead><tr><th>Товар</th><th style={{textAlign:"right"}}>На складе</th><th style={{width:100}}>Отгрузить</th><th style={{textAlign:"right"}}>Цена</th><th style={{textAlign:"right"}}>Сумма</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.row.id} style={{ background: r.qty > 0 ? "rgba(61,220,125,.07)" : "none" }}>
                <td className="sm" style={{ fontWeight: 600 }}>{r.row.name}<div className="xs mut">{r.row.size} · {r.row.unit}</div></td>
                <td className="num">{r.row.qty}</td>
                <td><input type="number" className="inp" min={0} max={r.row.qty} value={r.qty} onChange={(e) => setQty(i, e.target.value)} /></td>
                <td className="num">{fmt(r.row.price)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(r.qty * (r.row.price || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
        <div className="mono" style={{ fontWeight: 700 }}>Позиций: {lines.length} · Сумма продажи: <span style={{ color: "var(--ok)" }}>{money(total)}</span></div>
        <div className="row">
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn pri" disabled={!lines.length || !target} onClick={() => onSave(lines, target, user)}>Отгрузить →</button>
        </div>
      </div>
    </Modal>
  );
}

/* ============ DASHBOARD ============ */
/* ============ DASHBOARD (в стиле BILLZ) ============
   Период + сравнение с предыдущим периодом той же длины, плитки с изменением в %,
   динамика продаж (выручка и валовая прибыль), рейтинги, остатки долгов и склада, выгрузка в Excel.
   Продажа датируется датой поставки (batch_date), возвраты / скидки / оплаты — датой операции. */
const DASH_PRESETS = [
  { id: "today", label: "Сегодня" }, { id: "yesterday", label: "Вчера" }, { id: "7d", label: "7 дней" },
  { id: "30d", label: "30 дней" }, { id: "month", label: "Этот месяц" }, { id: "prevmonth", label: "Прошлый месяц" },
  { id: "year", label: "Этот год" }, { id: "all", label: "Весь период" },
];
const RU_MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const dIso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const dToday = () => dIso(new Date());
const dAdd = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return dIso(d); };
const dDiff = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const dLabel = (s) => s.slice(8, 10) + "." + s.slice(5, 7);
function dashPreset(id) {
  const t = dToday(), d = new Date(t + "T00:00:00");
  switch (id) {
    case "today": return [t, t];
    case "yesterday": { const y = dAdd(t, -1); return [y, y]; }
    case "7d": return [dAdd(t, -6), t];
    case "30d": return [dAdd(t, -29), t];
    case "month": return [dIso(new Date(d.getFullYear(), d.getMonth(), 1)), t];
    case "prevmonth": return [dIso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), dIso(new Date(d.getFullYear(), d.getMonth(), 0))];
    case "year": return [dIso(new Date(d.getFullYear(), 0, 1)), t];
    default: return ["", ""];
  }
}
const fmtShort = (n) => {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e9) return s + (a / 1e9).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " млрд";
  if (a >= 1e6) return s + (a / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " млн";
  if (a >= 1e4) return s + Math.round(a / 1e3).toLocaleString("ru-RU") + " тыс";
  return s + a.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
};
const clientKey = (o) => {
  const ph = String(o.phone || "").replace(/\D/g, "");
  if (ph.length >= 7) return "p" + ph.slice(-9);
  const n = String(o.client || "").trim().toLowerCase();
  return n ? "n" + n : "o" + o.id;
};

// все события (продажи по позициям, операции) один раз; итоги по любому периоду считаются из них
function dashEvents(objects, ops, mgr) {
  const objById = {}, sales = [];
  objects.forEach((o) => {
    objById[o.id] = o;
    if (o.status === "cancelled" || (mgr && (o.manager || "") !== mgr)) return;
    (o.items || []).forEach((i) => {
      sales.push({ d: String(i.batch_date || o.created_at || "").slice(0, 10), o, i,
        rev: (i.qty || 0) * (i.price || 0), cost: (i.qty || 0) * (i.cost || 0), key: o.id + "#" + (i.batch_no || 1) });
    });
  });
  const objOps = [], compExp = [];
  ops.forEach((x) => {
    if (x.voided) return;
    const d = String(x.op_date || x.created_at || "").slice(0, 10);
    if (x.type === "company_expense") { if (!mgr) compExp.push({ ...x, d }); return; }
    const o = x.object_id && objById[x.object_id];
    if (!o || o.status === "cancelled" || (mgr && (o.manager || "") !== mgr)) return;
    objOps.push({ ...x, d, o });
  });
  // первая покупка клиента — по всем объектам, чтобы «новый клиент» не зависел от фильтра менеджера
  const firstBuy = {};
  objects.forEach((o) => {
    if (o.status === "cancelled") return;
    (o.items || []).forEach((i) => {
      const d = String(i.batch_date || o.created_at || "").slice(0, 10), k = clientKey(o);
      if (d && (!firstBuy[k] || d < firstBuy[k])) firstBuy[k] = d;
    });
  });
  return { sales, objOps, compExp, firstBuy };
}
function dashTotals(ev, from, to) {
  const inR = (d) => (!from || d >= from) && (!to || d <= to);
  let rev = 0, cost = 0, ret = 0, retCost = 0, retN = 0, disc = 0, exp = 0, bonus = 0, paid = 0, cexp = 0;
  const deals = new Set(), clients = new Set();
  ev.sales.forEach((s) => { if (!inR(s.d)) return; rev += s.rev; cost += s.cost; deals.add(s.key); clients.add(clientKey(s.o)); });
  ev.objOps.forEach((x) => {
    if (!inR(x.d)) return;
    const a = x.amount || 0;
    if (x.type === "return") { ret += a; retCost += x.cost_amount || 0; retN++; }
    else if (x.type === "discount") disc += a;
    else if (x.type === "expense") exp += a;
    else if (x.type === "bonus") bonus += a;
    else if (x.type === "client_payment") paid += a;
  });
  ev.compExp.forEach((x) => { if (inR(x.d)) cexp += x.amount || 0; });
  let newC = 0;
  clients.forEach((k) => { const f = ev.firstBuy[k]; if (f && inR(f)) newC++; });
  const netRev = rev - ret - disc, gross = netRev - (cost - retCost), net = gross - exp - bonus - cexp;
  return { rev, netRev, gross, net, margin: netRev > 0 ? (gross / netRev) * 100 : 0, deals: deals.size,
    avg: deals.size ? netRev / deals.size : 0, ret, retN, disc, paid, cexp, clients: clients.size, newC, repeatC: clients.size - newC };
}

function DashTile({ label, value, prev, good = "up", suffix = "", hero, note, compare, pp }) {
  let delta = null;
  if (compare && prev != null && pp) {
    const d = value - prev;
    delta = { t: (d >= 0 ? "▲ " : "▼ ") + Math.abs(d).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " п.п.", c: Math.abs(d) < 0.05 ? "var(--mut)" : d > 0 ? "var(--ok)" : "var(--bad)" };
  } else if (compare && prev != null) {
    if (!prev && !value) delta = { t: "без изменений", c: "var(--mut)" };
    else if (!prev) delta = { t: "▲ новое", c: good === "up" ? "var(--ok)" : "var(--bad)" };
    else {
      const p = ((value - prev) / Math.abs(prev)) * 100, up = p >= 0;
      const isGood = Math.abs(p) < 0.05 ? null : (up === (good === "up"));
      delta = isGood == null ? { t: "= без изменений", c: "var(--mut)" } : { t: (up ? "▲ " : "▼ ") + Math.abs(p).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%",
        c: isGood == null ? "var(--mut)" : isGood ? "var(--ok)" : "var(--bad)" };
    }
  }
  return (
    <div className="kpi" style={hero ? { gridColumn: "span 2" } : null}>
      <div className="l">{label}</div>
      <div className="v" style={hero ? { fontFamily: "var(--sans)", fontSize: 34, fontWeight: 800, lineHeight: 1.15 } : null}>
        {fmt(value)}{suffix}
      </div>
      {delta && (
        <div className="xs" style={{ marginTop: 4 }}>
          <b style={{ color: delta.c }}>{delta.t}</b>
          <span className="mut"> · было {fmt(prev)}{suffix}</span>
        </div>
      )}
      {note && <div className="xs mut" style={{ marginTop: 4 }}>{note}</div>}
    </div>
  );
}

// плавная кривая через точки (монотонная кубическая: без «выбросов» выше/ниже реальных значений)
function smoothPath(pts) {
  const n = pts.length;
  if (!n) return "";
  if (n === 1) return "M" + pts[0][0] + "," + pts[0][1];
  const sl = [], t = [];
  for (let i = 0; i < n - 1; i++) sl.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0] || 1));
  t[0] = sl[0]; t[n - 1] = sl[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / sl[i], b = t[i + 1] / sl[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * sl[i]; t[i + 1] = k * b * sl[i]; }
  }
  let d = "M" + pts[0][0] + "," + pts[0][1];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = (x1 - x0) / 3;
    d += "C" + (x0 + dx) + "," + (y0 + t[i] * dx) + " " + (x1 - dx) + "," + (y1 - t[i + 1] * dx) + " " + x1 + "," + y1;
  }
  return d;
}
// волнистый график: выручка и валовая прибыль по дням / неделям / месяцам, перекрестие и подсказка при наведении
function DashChart({ buckets }) {
  const boxRef = useRef(null);
  const [w, setW] = useState(800);
  const [hov, setHov] = useState(-1);
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const upd = () => setW(Math.max(260, el.clientWidth));
    upd();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(upd) : null;
    if (ro) ro.observe(el); else window.addEventListener("resize", upd);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener("resize", upd); };
  }, []);
  const H = 260, ml = 62, mr = 14, mt = 12, mb = 26;
  const pw = w - ml - mr, ph = H - mt - mb, n = buckets.length || 1;
  let hi = 0, lo = 0;
  buckets.forEach((b) => { hi = Math.max(hi, b.rev, b.gross); lo = Math.min(lo, b.rev, b.gross); });
  if (hi === 0 && lo === 0) hi = 1;
  const rawStep = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) || 10 * mag;
  const top = Math.ceil(hi / step) * step, bot = Math.floor(lo / step) * step;
  const y = (v) => mt + ((top - v) / (top - bot || 1)) * ph;
  const ticks = []; for (let v = bot; v <= top + step / 2; v += step) ticks.push(v);
  const band = pw / n;
  const x = (i) => ml + i * band + band / 2;
  const y0 = y(0);
  const series = [
    { k: "rev", c: "var(--viz-s1)", g: "dashGradRev" },
    { k: "gross", c: "var(--viz-s2)", g: "dashGradGross" },
  ].map((sr) => {
    const pts = buckets.map((b, i) => [x(i), y(b[sr.k])]);
    const line = smoothPath(pts);
    const area = pts.length > 1 ? line + "L" + pts[pts.length - 1][0] + "," + y0 + "L" + pts[0][0] + "," + y0 + "Z" : "";
    return { ...sr, pts, line, area };
  });
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 58))));
  const hb = buckets[hov];
  const hx = hov >= 0 ? x(hov) : 0;
  const tipLeft = hov < 0 ? 0 : hx + 12 + 180 <= w ? hx + 12 : Math.max(0, hx - 192);
  return (
    <div ref={boxRef} style={{ position: "relative" }} onMouseLeave={() => setHov(-1)}>
      <svg width={w} height={H} style={{ display: "block" }} role="img" aria-label="Динамика выручки и валовой прибыли">
        <defs>
          {series.map((sr) => (
            <linearGradient key={sr.g} id={sr.g} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sr.c} stopOpacity="0.28" />
              <stop offset="100%" stopColor={sr.c} stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={ml} x2={w - mr} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth="1" />
            <text x={ml - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--mut)" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtShort(v)}</text>
          </g>
        ))}
        {series.map((sr) => sr.area && <path key={"a" + sr.k} d={sr.area} fill={"url(#" + sr.g + ")"} stroke="none" />)}
        {series.map((sr) => <path key={"l" + sr.k} d={sr.line} fill="none" stroke={sr.c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {n === 1 && series.map((sr) => <circle key={"d" + sr.k} cx={sr.pts[0][0]} cy={sr.pts[0][1]} r="4" fill={sr.c} stroke="var(--panel)" strokeWidth="2" />)}
        {hov >= 0 && <line x1={hx} x2={hx} y1={mt} y2={mt + ph} stroke="var(--mut)" strokeWidth="1" strokeDasharray="3 3" />}
        {hov >= 0 && series.map((sr) => <circle key={"h" + sr.k} cx={sr.pts[hov][0]} cy={sr.pts[hov][1]} r="4.5" fill={sr.c} stroke="var(--panel)" strokeWidth="2" />)}
        {buckets.map((b, i) => (
          <g key={b.key}>
            {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--mut)">{b.label}</text>}
            <rect x={ml + i * band} y={mt} width={band} height={ph} fill="transparent" tabIndex={0}
              onMouseEnter={() => setHov(i)} onFocus={() => setHov(i)} onBlur={() => setHov(-1)} />
          </g>
        ))}
      </svg>
      {hb && (
        <div style={{ position: "absolute", top: 4, left: tipLeft, width: 180, pointerEvents: "none", background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 8, padding: "8px 10px", boxShadow: "0 8px 24px rgba(0,0,0,.15)", fontSize: 12, zIndex: 5 }}>
          <div className="mut" style={{ marginBottom: 4 }}>{hb.title}</div>
          <div className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 2, background: "var(--viz-s1)", display: "inline-block" }} /><b className="mono">{fmt(hb.rev)}</b><span className="mut">выручка</span></div>
          <div className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 2, background: "var(--viz-s2)", display: "inline-block" }} /><b className="mono">{fmt(hb.gross)}</b><span className="mut">вал. прибыль</span></div>
          <div className="mut" style={{ marginTop: 4 }}>поставок: {hb.deals}</div>
        </div>
      )}
    </div>
  );
}

// таблица рейтинга с полосой доли от лидера
function DashRank({ rows, cols, empty }) {
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.rev)));
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="t">
        <thead><tr><th>#</th>{cols.map((c) => <th key={c.k} style={c.num ? { textAlign: "right" } : null}>{c.l}</th>)}</tr></thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.key}>
              <td className="xs mut">{i + 1}</td>
              {cols.map((c, j) => (
                <td key={c.k} className={c.num ? "num" : "sm"} style={j === 0 ? { minWidth: 140 } : null}>
                  {c.f ? c.f(r) : r[c.k]}
                  {j === 0 && <div style={{ height: 4, borderRadius: 2, marginTop: 4, background: "var(--viz-s1)", width: Math.max(2, (Math.abs(r.rev) / max) * 100) + "%", opacity: 0.85 }} />}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={cols.length + 1} className="mut sm" style={{ padding: 14 }}>{empty || "Нет данных за период"}</td></tr>}
        </tbody>
      </table>
      {rows.length > 10 && <button className="btn xs" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? "Только топ-10" : "Показать все (" + rows.length + ")"}</button>}
    </div>
  );
}
function DashSeg({ value, onChange, opts }) {
  return (
    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      {opts.map(([id, l]) => <button key={id} className={"btn xs " + (value === id ? "pri" : "")} onClick={() => onChange(id)}>{l}</button>)}
    </div>
  );
}

// деньги по способам оплаты за период: поступления от клиентов и выплаты (поставщикам, расходы, бонусы мастерам).
// Правила как у дашборда: операции отменённых объектов не считаются; при фильтре по менеджеру — только его объекты.
const PAY_REP_KEYS = ["inUsd", "inUzs", "sup", "exp", "bonus", "outUsd", "outUzs", "n"];
function payReport(objects, ops, from, to, mgr) {
  const objById = {};
  objects.forEach((o) => { objById[o.id] = o; });
  const inR = (d) => (!from || d >= from) && (!to || d <= to);
  const blank = (id, label) => { const r = { id, label }; PAY_REP_KEYS.forEach((k) => { r[k] = 0; }); return r; };
  const rows = {};
  PAY_METHODS.forEach((m) => { rows[m.id] = blank(m.id, m.label); });
  rows.none = blank("none", "Не указан");
  ops.forEach((x) => {
    if (x.voided || !isPayType(x.type)) return;
    const d = String(x.op_date || x.created_at || "").slice(0, 10);
    if (!inR(d)) return;
    const o = x.object_id ? objById[x.object_id] : null;
    if (x.object_id && (!o || o.status === "cancelled")) return;
    if (mgr && (!o || (o.manager || "") !== mgr)) return;
    const i = payInfo(x), r = rows[i.id || "none"], a = Number(x.amount) || 0;
    r.n++;
    if (x.type === "client_payment") { r.inUsd += a; if (i.cur === "uzs") r.inUzs += i.uzs; return; }
    r.outUsd += a;
    if (i.cur === "uzs") r.outUzs += i.uzs;
    if (x.type === "supplier_payment") r.sup += a;
    else if (x.type === "bonus_payment") r.bonus += a;
    else r.exp += a;
  });
  const list = [...PAY_METHODS.map((m) => rows[m.id]), rows.none].filter((r) => r.id !== "none" || r.n > 0);
  const tot = blank("total", "Итого");
  list.forEach((r) => PAY_REP_KEYS.forEach((k) => { tot[k] += r[k]; }));
  return { list, tot };
}
function PayMethodsCard({ objects, ops, from, to, mgr }) {
  const rep = useMemo(() => payReport(objects, ops, from, to, mgr), [objects, ops, from, to, mgr]);
  const R = { textAlign: "right" };
  const uzsLine = (v) => (v > 0 ? <div className="xs mut" style={{ fontWeight: 400 }}>в т.ч. {fmt(v)} сум</div> : null);
  const num = (v, c) => <span style={{ color: v ? c : "var(--mut)" }}>{fmt(v)}</span>;
  const diff = (v) => <span style={{ color: v > 0 ? "var(--ok)" : v < 0 ? "var(--bad)" : "var(--mut)" }}>{(v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v))}</span>;
  const line = (r, total) => (
    <tr key={r.id} style={total ? { background: "var(--panel2)", fontWeight: 800 } : null}>
      <td className="sm" style={{ fontWeight: 700 }}>{r.label}{!total && r.n > 0 && <span className="xs mut" style={{ fontWeight: 400 }}> · операций: {r.n}</span>}</td>
      <td className="num">{num(r.inUsd, "var(--ok)")}{uzsLine(r.inUzs)}</td>
      <td className="num">{num(r.sup)}</td>
      <td className="num">{num(r.exp)}</td>
      <td className="num">{num(r.bonus)}</td>
      <td className="num">{num(r.outUsd, "var(--bad)")}{uzsLine(r.outUzs)}</td>
      <td className="num" style={{ fontWeight: 800 }}>{diff(r.inUsd - r.outUsd)}</td>
    </tr>
  );
  return (
    <div className="card sect">
      <div className="row" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ marginRight: "auto" }}>Деньги по способам оплаты</h3>
        <span className="xs mut">суммы в $ · оплаты в сумах пересчитаны по курсу операции</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead><tr><th>Способ оплаты</th><th style={R}>Поступило от клиентов</th><th style={R}>Поставщикам</th><th style={R} title="доп. расходы объектов и расходы компании">Расходы</th><th style={R}>Бонусы мастерам</th><th style={R}>Всего выплачено</th><th style={R}>Разница</th></tr></thead>
          <tbody>
            {rep.list.map((r) => line(r))}
            {line(rep.tot, true)}
          </tbody>
        </table>
      </div>
      {(rep.list.some((r) => r.id === "none") || mgr) && (
        <div className="xs mut" style={{ marginTop: 6 }}>
          {rep.list.some((r) => r.id === "none") && <div>«Не указан» — операции, записанные до того, как в программе появились способы оплаты. Оплатам клиентов и поставщикам способ можно указать через ✎ / «ред.».</div>}
          {mgr && <div>Фильтр по менеджеру: только операции его объектов — оплаты из раздела «Поставщики», расходы компании и бонусы мастерам не входят.</div>}
        </div>
      )}
    </div>
  );
}

function Dashboard({ data }) {
  const { objects, finance_ops, products, suppliers, warehouse = [] } = data;
  const [preset, setPreset] = useState("30d");
  const [range, setRange] = useState(() => dashPreset("30d"));
  const [mgr, setMgr] = useState("");
  const [prodView, setProdView] = useState("prod");
  const [peopleView, setPeopleView] = useState("mgr");
  const [showTable, setShowTable] = useState(false);
  const [from, to] = range;
  const pick = (id) => { setPreset(id); setRange(dashPreset(id)); };
  const setCustom = (f, t) => { setPreset("custom"); setRange([f, t]); };

  const prodMap = useMemo(() => { const m = {}; products.forEach((p) => { m[p.id] = p; }); return m; }, [products]);
  const supName = useMemo(() => { const m = {}; suppliers.forEach((s) => { m[s.id] = s.name; }); return m; }, [suppliers]);
  const ev = useMemo(() => dashEvents(objects, finance_ops, mgr), [objects, finance_ops, mgr]);
  const managers = useMemo(() => [...new Set(objects.map((o) => o.manager).filter(Boolean))].sort(), [objects]);

  // предыдущий период той же длины
  const compare = !!(from && to);
  const len = compare ? dDiff(from, to) + 1 : 0;
  const pFrom = compare ? dAdd(from, -len) : "", pTo = compare ? dAdd(from, -1) : "";
  const cur = useMemo(() => dashTotals(ev, from, to), [ev, from, to]);
  const prev = useMemo(() => (compare ? dashTotals(ev, pFrom, pTo) : null), [ev, pFrom, pTo, compare]);
  // поступления по способам оплаты (плитки): текущий и предыдущий период
  const payCur = useMemo(() => payReport(objects, finance_ops, from, to, mgr), [objects, finance_ops, from, to, mgr]);
  const payPrev = useMemo(() => (compare ? payReport(objects, finance_ops, pFrom, pTo, mgr) : null), [objects, finance_ops, pFrom, pTo, mgr, compare]);

  // корзины для графика
  const buckets = useMemo(() => {
    const dates = ev.sales.map((s) => s.d).filter(Boolean).sort();
    const f = from || dates[0] || dToday(), t = to || (dates.length && dates[dates.length - 1] > dToday() ? dates[dates.length - 1] : dToday());
    const days = dDiff(f, t) + 1;
    const gran = days <= 45 ? "day" : days <= 210 ? "week" : "month";
    const keyOf = (d) => {
      if (gran === "day") return d;
      if (gran === "month") return d.slice(0, 7);
      const dt = new Date(d + "T00:00:00"), wd = (dt.getDay() + 6) % 7; return dAdd(d, -wd);
    };
    const list = [], idx = {};
    let c = keyOf(f);
    for (let guard = 0; guard < 800; guard++) {
      if (c > t) break;
      let label, title;
      if (gran === "day") { label = dLabel(c); title = dt(c); }
      else if (gran === "week") { label = dLabel(c); title = "неделя с " + dt(c); }
      else { label = RU_MON[Number(c.slice(5, 7)) - 1] + " " + c.slice(2, 4); title = RU_MON[Number(c.slice(5, 7)) - 1] + " " + c.slice(0, 4); }
      idx[c] = list.length; list.push({ key: c, label, title, rev: 0, gross: 0, deals: 0, _d: new Set() });
      if (gran === "day") c = dAdd(c, 1);
      else if (gran === "week") c = dAdd(c, 7);
      else { const [yy, mm] = c.split("-").map(Number); c = mm === 12 ? (yy + 1) + "-01" : yy + "-" + String(mm + 1).padStart(2, "0"); }
    }
    const inR = (d) => d && d >= f && d <= t;
    ev.sales.forEach((s) => { if (!inR(s.d)) return; const b = list[idx[keyOf(s.d)]]; if (!b) return; b.rev += s.rev; b.gross += s.rev - s.cost; b._d.add(s.key); });
    ev.objOps.forEach((x) => {
      if (!inR(x.d)) return; const b = list[idx[keyOf(x.d)]]; if (!b) return;
      if (x.type === "return") { b.rev -= x.amount || 0; b.gross -= (x.amount || 0) - (x.cost_amount || 0); }
      else if (x.type === "discount") { b.rev -= x.amount || 0; b.gross -= x.amount || 0; }
    });
    list.forEach((b) => { b.deals = b._d.size; delete b._d; });
    return { list, gran };
  }, [ev, from, to]);

  // рейтинги за период
  const ranks = useMemo(() => {
    const inR = (d) => (!from || d >= from) && (!to || d <= to);
    const acc = (m, key, name, add) => { const r = m[key] || (m[key] = { key, name, rev: 0, cost: 0, qty: 0, _deals: new Set(), extra: {} }); add(r); };
    const prod = {}, cat = {}, brand = {}, mg = {}, ms = {}, cl = {}, sp = {};
    ev.sales.forEach((s) => {
      if (!inR(s.d)) return;
      const p = s.i.product_id ? prodMap[s.i.product_id] : null, q = s.i.qty || 0;
      const add = (r) => { r.rev += s.rev; r.cost += s.cost; r.qty += q; r._deals.add(s.key); };
      acc(prod, s.i.product_id || "n:" + s.i.name, s.i.name, (r) => { add(r); r.unit = s.i.unit; });
      acc(cat, (p && p.category) || "—", (p && p.category) || "Без категории", add);
      acc(brand, (p && p.brand) || "—", (p && p.brand) || "Без бренда", add);
      acc(mg, s.o.manager || "—", s.o.manager || "Без менеджера", add);
      acc(ms, s.o.master_id || s.o.master || "—", s.o.master || "Без мастера", add);
      acc(cl, clientKey(s.o), s.o.client || s.o.name, (r) => { add(r); r.phone = s.o.phone; });
      if (s.i.supplier_id && !s.i.from_warehouse) acc(sp, s.i.supplier_id, supName[s.i.supplier_id] || "—", add);
    });
    // возвраты и скидки уменьшают выручку того, к кому относятся
    ev.objOps.forEach((x) => {
      if (!inR(x.d) || (x.type !== "return" && x.type !== "discount")) return;
      const a = x.amount || 0, c = x.type === "return" ? x.cost_amount || 0 : 0, o = x.o;
      const sub = (m, key) => { if (m[key]) { m[key].rev -= a; m[key].cost -= c; } };
      sub(mg, o.manager || "—"); sub(ms, o.master_id || o.master || "—"); sub(cl, clientKey(o));
      if (x.type === "return") {
        const p = x.product_id ? prodMap[x.product_id] : null;
        sub(prod, x.product_id || "n:" + x.product_name); sub(cat, (p && p.category) || "—"); sub(brand, (p && p.brand) || "—");
        if (prod[x.product_id || "n:" + x.product_name]) prod[x.product_id || "n:" + x.product_name].qty -= x.qty || 0;
      }
    });
    const fin = (m) => Object.values(m).map((r) => ({ ...r, deals: r._deals.size, gross: r.rev - r.cost, margin: r.rev > 0 ? ((r.rev - r.cost) / r.rev) * 100 : 0, avg: r._deals.size ? r.rev / r._deals.size : 0 })).sort((a, b) => b.rev - a.rev);
    // долги клиентов и поставщикам — текущие, за всё время
    const cdebt = {};
    objects.forEach((o) => { if (o.status === "cancelled") return; const k = clientKey(o); cdebt[k] = (cdebt[k] || 0) + calcObject(o, finance_ops).clientDebt; });
    const clients = fin(cl).map((r) => ({ ...r, debt: cdebt[r.key] || 0 }));
    const sups = fin(sp).map((r) => { const s = suppliers.find((x) => x.id === r.key); return { ...r, debt: s ? supplierStats(s, objects, finance_ops, data.wh_moves).debt : 0 }; });
    return { prod: fin(prod), cat: fin(cat), brand: fin(brand), mgr: fin(mg), master: fin(ms), client: clients, sup: sups };
  }, [ev, from, to, prodMap, supName, objects, finance_ops, suppliers, data.wh_moves]);

  // остатки на сегодня (не зависят от периода)
  const bal = useMemo(() => {
    let cdebt = 0, overpay = 0;
    objects.forEach((o) => {
      if (o.status === "cancelled" || (mgr && (o.manager || "") !== mgr)) return;
      const d = calcObject(o, finance_ops).clientDebt; if (d > 0) cdebt += d; else overpay -= d;
    });
    const sdebt = suppliers.reduce((a, s) => a + supplierStats(s, objects, finance_ops, data.wh_moves).debt, 0);
    const whCost = warehouse.reduce((a, w) => a + (w.qty || 0) * (w.cost || 0), 0);
    const whQty = warehouse.filter((w) => (w.qty || 0) > 0).length;
    const active = objects.filter((o) => !["closed", "cancelled"].includes(o.status) && (!mgr || (o.manager || "") === mgr)).length;
    return { cdebt, overpay, sdebt, whCost, whQty, active };
  }, [objects, finance_ops, suppliers, warehouse, mgr, data.wh_moves]);

  const lowMargin = ranks.prod.filter((r) => r.rev > 0 && r.margin < 10).sort((a, b) => a.margin - b.margin).slice(0, 8);

  const periodTitle = compare ? (from === to ? dt(from) : dt(from) + " — " + dt(to)) : "весь период";
  const prevTitle = compare ? (pFrom === pTo ? dt(pFrom) : dt(pFrom) + " — " + dt(pTo)) : "";

  const exportXlsx = () => {
    try {
      const wb = XLSX.utils.book_new();
      const add = (name, rows) => XLSX.utils.book_append_sheet(wb, makeSheet(rows), name);
      const K = [["Показатель", "Период: " + periodTitle].concat(compare ? ["Пред. период: " + prevTitle, "Изменение, %"] : [])];
      const kp = [["Выручка (нетто)", "netRev"], ["Валовая прибыль", "gross"], ["Чистая прибыль", "net"], ["Маржа, %", "margin"], ["Поставок (продаж)", "deals"], ["Средний чек", "avg"], ["Клиентов", "clients"], ["Новых клиентов", "newC"], ["Поступило оплат", "paid"], ["Возвраты", "ret"], ["Скидки", "disc"], ["Расходы компании", "cexp"]];
      kp.forEach(([l, k]) => { const a = Math.round(cur[k] * 100) / 100; const row = [l, a]; if (compare) { const b = Math.round(prev[k] * 100) / 100; row.push(b, b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : ""); } K.push(row); });
      K.push([], ["На сегодня"], ["Долги клиентов", bal.cdebt], ["Переплаты клиентов", bal.overpay], ["Долги поставщикам", bal.sdebt], ["Склад (по себестоимости)", bal.whCost], ["Объектов в работе", bal.active]);
      add("Показатели", K);
      const pr = payReport(objects, finance_ops, from, to, mgr);
      add("Способы оплаты", [["Способ оплаты", "Поступило от клиентов, $", "в т.ч. сум", "Поставщикам, $", "Расходы, $", "Бонусы мастерам, $", "Всего выплачено, $", "в т.ч. сум", "Разница, $", "Операций"]]
        .concat([...pr.list, pr.tot].map((r) => [r.label, round2(r.inUsd), r.inUzs || "", round2(r.sup), round2(r.exp), round2(r.bonus), round2(r.outUsd), r.outUzs || "", round2(r.inUsd - r.outUsd), r.n])));
      add("Динамика", [["Период", "Выручка", "Валовая прибыль", "Поставок"]].concat(buckets.list.map((b) => [b.title, b.rev, b.gross, b.deals])));
      const sheet = (rows, extra = []) => [["Название", "Выручка", "Себестоимость", "Валовая прибыль", "Маржа, %", "Кол-во", "Поставок"].concat(extra.map((e) => e[0]))]
        .concat(rows.map((r) => [r.name, r.rev, r.cost, r.gross, Math.round(r.margin * 10) / 10, r.qty, r.deals].concat(extra.map((e) => e[1](r)))));
      add("Товары", sheet(ranks.prod)); add("Категории", sheet(ranks.cat)); add("Бренды", sheet(ranks.brand));
      add("Менеджеры", sheet(ranks.mgr)); add("Мастера", sheet(ranks.master));
      add("Клиенты", sheet(ranks.client, [["Телефон", (r) => r.phone || ""], ["Долг сейчас", (r) => r.debt]]));
      add("Поставщики", sheet(ranks.sup, [["Долг сейчас", (r) => r.debt]]));
      XLSX.writeFile(wb, "dashboard_" + (from || "all") + "_" + (to || dToday()) + ".xlsx");
    } catch (e) { console.error(e); alert("Не удалось выгрузить Excel: " + e.message); }
  };

  const money0 = (r) => fmt(r.rev);
  const prodCols = [
    { k: "name", l: prodView === "prod" ? "Товар" : prodView === "cat" ? "Категория" : "Бренд" },
    ...(prodView === "prod" ? [{ k: "qty", l: "Кол-во", num: true, f: (r) => fmt(r.qty) + (r.unit ? " " + r.unit : "") }] : [{ k: "deals", l: "Поставок", num: true }]),
    { k: "rev", l: "Выручка", num: true, f: money0 },
    { k: "gross", l: "Вал. прибыль", num: true, f: (r) => <span style={{ color: r.gross < 0 ? "var(--bad)" : undefined }}>{fmt(r.gross)}</span> },
    { k: "margin", l: "Маржа", num: true, f: (r) => r.margin.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%" },
  ];
  const peopleCols = {
    mgr: [{ k: "name", l: "Менеджер" }, { k: "deals", l: "Поставок", num: true }, { k: "rev", l: "Выручка", num: true, f: money0 }, { k: "avg", l: "Ср. чек", num: true, f: (r) => fmt(Math.round(r.avg)) }, { k: "gross", l: "Вал. прибыль", num: true, f: (r) => fmt(r.gross) }],
    master: [{ k: "name", l: "Мастер" }, { k: "deals", l: "Поставок", num: true }, { k: "rev", l: "Выручка", num: true, f: money0 }, { k: "avg", l: "Ср. чек", num: true, f: (r) => fmt(Math.round(r.avg)) }],
    client: [{ k: "name", l: "Клиент", f: (r) => <>{r.name}{r.phone && <div className="xs mut mono">{r.phone}</div>}</> }, { k: "deals", l: "Поставок", num: true }, { k: "rev", l: "Выручка", num: true, f: money0 }, { k: "debt", l: "Долг сейчас", num: true, f: (r) => <span style={{ color: r.debt > 0 ? "var(--bad)" : r.debt < 0 ? "var(--ok)" : "var(--mut)" }}>{r.debt < 0 ? "−" + fmt(-r.debt) : fmt(r.debt)}</span> }],
    sup: [{ k: "name", l: "Поставщик" }, { k: "deals", l: "Поставок", num: true }, { k: "rev", l: "Закуплено на продажу", num: true, f: (r) => fmt(r.cost) }, { k: "debt", l: "Долг сейчас", num: true, f: (r) => <span style={{ color: r.debt > 0 ? "var(--warn)" : "var(--mut)" }}>{fmt(r.debt)}</span> }],
  };
  const peopleRows = { mgr: ranks.mgr, master: ranks.master, client: ranks.client, sup: ranks.sup.map((r) => ({ ...r, rev: r.cost })) }[peopleView];

  return (
    <div className="dash">
      <div className="row sect" style={{ alignItems: "baseline" }}>
        <h2 style={{ marginRight: "auto" }}>Дашборд <span className="sm mut" style={{ fontWeight: 500 }}>· {periodTitle}{mgr ? " · " + mgr : ""}</span></h2>
        <button className="btn" onClick={exportXlsx}>⬇ Excel</button>
      </div>

      {/* фильтры — одна строка над всеми показателями */}
      <div className="card sect" style={{ padding: "10px 12px" }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {DASH_PRESETS.map((p) => <button key={p.id} className={"btn xs " + (preset === p.id ? "pri" : "")} onClick={() => pick(p.id)}>{preset === p.id ? "✓ " : ""}{p.label}</button>)}
          <span className="row" style={{ gap: 4, marginLeft: "auto" }}>
            <input type="date" className="inp" style={{ width: 140, padding: "4px 8px" }} value={from} onChange={(e) => setCustom(e.target.value, to || e.target.value)} aria-label="С даты" />
            <span className="mut">—</span>
            <input type="date" className="inp" style={{ width: 140, padding: "4px 8px" }} value={to} onChange={(e) => setCustom(from || e.target.value, e.target.value)} aria-label="По дату" />
            <select className="inp" style={{ width: 170, padding: "4px 8px" }} value={mgr} onChange={(e) => setMgr(e.target.value)}>
              <option value="">Все менеджеры</option>{managers.map((m) => <option key={m}>{m}</option>)}
            </select>
          </span>
        </div>
        {compare && <div className="xs mut" style={{ marginTop: 6 }}>Сравнение с предыдущим периодом: {prevTitle}{mgr ? " · расходы компании не учитываются при фильтре по менеджеру" : ""}</div>}
      </div>

      <div className="kpis sect">
        <DashTile hero label="Выручка" value={cur.netRev} prev={prev && prev.netRev} compare={compare} note={cur.ret || cur.disc ? "продажи " + fmt(cur.rev) + " − возвраты " + fmt(cur.ret) + " − скидки " + fmt(cur.disc) : null} />
        <DashTile label="Валовая прибыль" value={cur.gross} prev={prev && prev.gross} compare={compare} />
        <DashTile label="Чистая прибыль" value={cur.net} prev={prev && prev.net} compare={compare} note="после доп. расходов, бонусов и расходов компании" />
        <DashTile label="Маржа" value={Math.round(cur.margin * 10) / 10} prev={prev && Math.round(prev.margin * 10) / 10} suffix="%" compare={compare} pp />
        <DashTile label="Поставок (продаж)" value={cur.deals} prev={prev && prev.deals} compare={compare} />
        <DashTile label="Средний чек" value={Math.round(cur.avg)} prev={prev && Math.round(prev.avg)} compare={compare} />
        <DashTile label="Клиентов" value={cur.clients} prev={prev && prev.clients} compare={compare} note={"новых " + cur.newC + " · повторных " + cur.repeatC} />
        <DashTile label="Поступило оплат" value={cur.paid} prev={prev && prev.paid} compare={compare} />
        <DashTile label="Возвраты" value={cur.ret} prev={prev && prev.ret} good="down" compare={compare} note={cur.retN ? "операций: " + cur.retN : null} />
      </div>

      <h3 style={{ margin: "4px 0 8px" }}>Поступило по способам оплаты <span className="xs mut" style={{ fontWeight: 500 }}>· в $, оплаты в сумах — по курсу операции</span></h3>
      <div className="kpis sect">
        {payCur.list.filter((r) => r.id !== "none").map((r) => {
          const pr = payPrev && payPrev.list.find((x) => x.id === r.id);
          const parts = [r.inUzs > 0 ? "в т.ч. " + fmt(r.inUzs) + " сум" : "", "выплачено " + fmt(r.outUsd) + (r.outUzs > 0 ? " (" + fmt(r.outUzs) + " сум)" : "")].filter(Boolean);
          return <DashTile key={r.id} label={r.label} value={round2(r.inUsd)} prev={pr ? round2(pr.inUsd) : null} compare={compare} note={parts.join(" · ")} />;
        })}
      </div>

      <div className="card sect">
        <div className="row" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ marginRight: "auto" }}>Динамика продаж <span className="xs mut" style={{ fontWeight: 500 }}>по {buckets.gran === "day" ? "дням" : buckets.gran === "week" ? "неделям" : "месяцам"}</span></h3>
          <span className="row xs" style={{ gap: 12 }}>
            <span className="row" style={{ gap: 5 }}><span style={{ width: 14, height: 3, borderRadius: 2, background: "var(--viz-s1)", display: "inline-block" }} />Выручка</span>
            <span className="row" style={{ gap: 5 }}><span style={{ width: 14, height: 3, borderRadius: 2, background: "var(--viz-s2)", display: "inline-block" }} />Валовая прибыль</span>
          </span>
          <button className="btn xs" onClick={() => setShowTable(!showTable)}>{showTable ? "График" : "Таблица"}</button>
        </div>
        {!showTable ? <DashChart buckets={buckets.list} /> : (
          <div style={{ overflow: "auto", maxHeight: 300 }}>
            <table className="t"><thead><tr><th>Период</th><th style={{ textAlign: "right" }}>Выручка</th><th style={{ textAlign: "right" }}>Вал. прибыль</th><th style={{ textAlign: "right" }}>Поставок</th></tr></thead>
              <tbody>{buckets.list.map((b) => <tr key={b.key}><td className="sm">{b.title}</td><td className="num">{fmt(b.rev)}</td><td className="num">{fmt(b.gross)}</td><td className="num">{b.deals}</td></tr>)}</tbody></table>
          </div>
        )}
      </div>

      <PayMethodsCard objects={objects} ops={finance_ops} from={from} to={to} mgr={mgr} />

      <div className="kpis sect">
        <DashTile label="Долги клиентов" value={bal.cdebt} note={bal.overpay > 0 ? "переплаты: " + fmt(bal.overpay) + " · на сегодня" : "на сегодня"} />
        <DashTile label="Долги поставщикам" value={bal.sdebt} note="на сегодня" />
        <DashTile label="Склад Thermo" value={bal.whCost} note={"по себестоимости · позиций " + bal.whQty} />
        <DashTile label="Объектов в работе" value={bal.active} note="кроме закрытых и отменённых" />
      </div>

      <div className="split sect" style={{ alignItems: "start" }}>
        <div className="card" style={{ minWidth: 0 }}>
          <div className="row" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ marginRight: "auto" }}>Что продаётся</h3>
            <DashSeg value={prodView} onChange={setProdView} opts={[["prod", "Товары"], ["cat", "Категории"], ["brand", "Бренды"]]} />
          </div>
          <DashRank key={prodView} rows={ranks[prodView]} cols={prodCols} />
        </div>
        <div className="card" style={{ minWidth: 0 }}>
          <div className="row" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ marginRight: "auto" }}>Лучшие</h3>
            <DashSeg value={peopleView} onChange={setPeopleView} opts={[["mgr", "Менеджеры"], ["master", "Мастера"], ["client", "Клиенты"], ["sup", "Поставщики"]]} />
          </div>
          <DashRank key={peopleView} rows={peopleRows} cols={peopleCols[peopleView]} />
        </div>
      </div>

      {lowMargin.length > 0 && (
        <div className="card sect">
          <h3 style={{ marginBottom: 8 }}>⚠ Низкая маржа (меньше 10%) за период</h3>
          <table className="t"><thead><tr><th>Товар</th><th style={{ textAlign: "right" }}>Выручка</th><th style={{ textAlign: "right" }}>Вал. прибыль</th><th style={{ textAlign: "right" }}>Маржа</th></tr></thead>
            <tbody>{lowMargin.map((r) => <tr key={r.key}><td className="sm">{r.name}</td><td className="num">{fmt(r.rev)}</td><td className="num" style={{ color: r.gross < 0 ? "var(--bad)" : undefined }}>{fmt(r.gross)}</td><td className="num" style={{ color: r.margin < 0 ? "var(--bad)" : "var(--warn)" }}>{r.margin.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

/* ============ FINANCE TAB ============ */
function CompanyExpenseForm({ onClose, onSave }) {
  const [v, setV] = useState({ category: "Зарплата", op_date: today(), note: "", user: CURRENT_USER ? (CURRENT_USER.name || CURRENT_USER.username) : "" });
  const [pay, setPay] = useState(() => payInit(null));
  return (
    <Modal title="Расход компании" onClose={onClose} w={560}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Категория"><select className="inp" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Fld></div>
        <PayFields p={pay} setP={setPay} methods={OUT_METHODS} usdLabel={payUsdLabel("company_expense")} />
        <Fld label="Дата"><input type="date" className="inp" value={v.op_date} onChange={(e) => setV({ ...v, op_date: e.target.value })} /></Fld>
        <Fld label="Кто внёс"><PersonSelect value={v.user} onChange={(u) => setV({ ...v, user: u })} /></Fld>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Комментарий"><input className="inp" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="за июнь / Шерзоду / свет+вода…" /></Fld></div>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" disabled={!(payUsd(pay) > 0)} onClick={() => onSave({ type: "company_expense", object_id: null, category: v.category, ...payPatch(pay, "company_expense"), op_date: v.op_date || today(), note: v.note, user: v.user })}>Сохранить</button>
      </div>
    </Modal>
  );
}
function FinanceTab({ data, reload, toast }) {
  const { objects, finance_ops, suppliers } = data;
  const objName = (id) => (objects.find((o) => o.id === id) || {}).name || "—";
  const supName = (id) => (suppliers.find((s) => s.id === id) || {}).name || "";
  const clientDebts = objects.map((o) => ({ o, f: calcObject(o, finance_ops) })).filter((x) => x.f.clientDebt > 0 && x.o.status !== "cancelled");
  const [expForm, setExpForm] = useState(false);
  const [delExp, setDelExp] = useState(null);
  const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const inRange = (o) => {
    const d = (o.op_date || o.created_at || "").slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  // общие расходы компании = expense без привязки к объекту
  const genExpenses = finance_ops.filter((o) => o.type === "company_expense" && !o.voided && inRange(o));
  const byCat = {};
  genExpenses.forEach((o) => { byCat[o.category || "Прочее"] = (byCat[o.category || "Прочее"] || 0) + (o.amount || 0); });
  const totalExp = genExpenses.reduce((a, o) => a + (o.amount || 0), 0);
  return (
    <div>
      <h2 className="sect">Финансы и долги</h2>
      <div className="row sect" style={{ gap: 8, padding: "8px 10px", background: "var(--panel2)", borderRadius: 8 }}>
        <span className="sm" style={{ fontWeight: 700 }}>Период:</span>
        <Fld label="С даты"><input type="date" className="inp" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} /></Fld>
        <Fld label="По дату"><input type="date" className="inp" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} /></Fld>
        <div style={{ display: "flex", gap: 4, alignSelf: "flex-end", flexWrap: "wrap" }}>
          <button className="btn xs" onClick={() => { setFrom(monthStart()); setTo(today()); }}>Этот месяц</button>
          <button className="btn xs" onClick={() => { setFrom(new Date(Date.now() - 7 * 86400000).toISOString().slice(0,10)); setTo(today()); }}>7 дней</button>
          <button className="btn xs" onClick={() => { setFrom(new Date(Date.now() - 30 * 86400000).toISOString().slice(0,10)); setTo(today()); }}>30 дней</button>
          <button className="btn xs" onClick={() => { setFrom(""); setTo(""); }}>Весь период</button>
        </div>
      </div>
      <PayMethodsCard objects={objects} ops={finance_ops} from={from} to={to} />
      <div className="row sect">
        <h3 style={{ marginRight: "auto" }}>Расходы компании <span className="mut sm">(зарплата, аренда, коммунальные, обед и т.д.)</span></h3>
        <button className="btn pri" onClick={() => setExpForm(true)}>+ Добавить расход</button>
      </div>
      <div className="kpis sect">
        <div className="kpi"><div className="l">Всего расходов{(from || to) ? " за период" : ""}</div><div className="v" style={{ color: "var(--bad)" }}>{fmt(totalExp)}</div></div>
        {EXPENSE_CATEGORIES.filter((c) => byCat[c]).slice(0, 5).map((c) => (
          <div key={c} className="kpi"><div className="l">{c}</div><div className="v">{fmt(byCat[c])}</div></div>
        ))}
      </div>
      <div className="card sect" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Дата</th><th>Категория</th><th style={{textAlign:"right"}}>Сумма, $</th><th>Способ оплаты</th><th>Комментарий</th><th>Кто</th><th></th></tr></thead>
          <tbody>
            {genExpenses.slice().reverse().map((o) => (
              <tr key={o.id}>
                <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                <td className="sm" style={{ fontWeight: 600 }}>{o.category || "Прочее"}</td>
                <td className="num" style={{ fontWeight: 700, color: "var(--bad)" }}>{fmt(o.amount)}</td>
                <td className="xs">{payText(o) || <span className="mut">—</span>}</td>
                <td className="xs mut">{o.note}</td>
                <td className="xs mut">{o.user}</td>
                <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>{delExp === o.id ? (<>
                  <span className="xs" style={{ color: "var(--bad)" }}>Удалить?</span>
                  <button className="btn xs dng" onClick={async () => { const r = await db.from("finance_ops").delete().eq("id", o.id); if (r.error) return; await logAction("Удалён расход", "company:" + (o.category || ""), fmt(o.amount) + " от " + dt(o.op_date || o.created_at) + (o.note ? " · " + o.note : "")); setDelExp(null); await reload(); toast("Расход удалён"); }}>Да</button>
                  <button className="btn xs" onClick={() => setDelExp(null)}>Нет</button>
                </>) : <button className="btn xs dng" onClick={() => setDelExp(o.id)}>удалить</button>}</div></td>
              </tr>
            ))}
            {!genExpenses.length && <tr><td colSpan={7} className="mut" style={{ textAlign: "center", padding: 22 }}>Расходов нет — добавьте через «+ Добавить расход»</td></tr>}
          </tbody>
        </table>
      </div>
      {expForm && <CompanyExpenseForm onClose={() => setExpForm(false)} onSave={async (op) => {
        const r = await db.from("finance_ops").insert(cleanUuids(op));
        if (r.error) return; // ошибка показана, окно остаётся открытым
        await logAction("Расход компании: " + op.category, "company", fmt(op.amount) + " · " + payText(op) + (op.note ? " · " + op.note : ""));
        setExpForm(false); await reload(); toast("Расход добавлен");
      }} />}
      <div className="split sect">
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Долги клиентов</h3>
          <table className="t"><thead><tr><th>Объект</th><th>Клиент</th><th style={{textAlign:"right"}}>Продажа</th><th style={{textAlign:"right"}}>Оплачено</th><th style={{textAlign:"right"}}>Долг</th></tr></thead>
            <tbody>{clientDebts.map(({ o, f }) => <tr key={o.id}><td className="sm">{o.name}</td><td className="sm">{o.client}<div className="xs mut mono">{o.phone}</div></td><td className="num">{fmt(f.saleNet)}</td><td className="num">{fmt(f.paidClient)}</td><td className="num" style={{color:"var(--bad)",fontWeight:700}}>{fmt(f.clientDebt)}</td></tr>)}
            {!clientDebts.length && <tr><td colSpan={5} className="mut sm" style={{padding:14}}>Долгов нет 🎉</td></tr>}</tbody></table>
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Долги поставщикам</h3>
          <table className="t"><thead><tr><th>Поставщик</th><th style={{textAlign:"right"}}>Закупки</th><th style={{textAlign:"right"}}>Оплачено</th><th style={{textAlign:"right"}}>Долг</th></tr></thead>
            <tbody>{suppliers.map((s) => { const st = supplierStats(s, objects, finance_ops, data.wh_moves); return <tr key={s.id}><td>{s.name}<div className="xs mut">{s.terms}</div></td><td className="num">{fmt(st.purchases)}</td><td className="num">{fmt(st.paid)}</td><td className="num" style={{color:st.balance>0?"var(--bad)":st.balance<0?"var(--ok)":"var(--mut)",fontWeight:700}} title={st.balance<0?"переплата (аванс поставщику)":""}>{st.balance<0?"−"+fmt(-st.balance):fmt(st.balance)}</td></tr>; })}</tbody></table>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Дата</th><th>Объект</th><th>Тип</th><th style={{textAlign:"right"}}>Сумма</th><th>Детали</th><th>Кто</th></tr></thead>
          <tbody>
            {finance_ops.slice().reverse().map((o) => (
              <tr key={o.id} style={{ opacity: o.voided ? 0.4 : 1, textDecoration: o.voided ? "line-through" : "none" }}>
                <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                <td className="sm">{objName(o.object_id)}</td>
                <td>{opLabel(o.type)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(o.amount)}</td>
                <td className="xs mut">{opDetails(o, [supName(o.supplier_id), o.product_name])}</td>
                <td className="xs mut">{o.user}</td>
              </tr>
            ))}
            {!finance_ops.length && <tr><td colSpan={6} className="mut" style={{ textAlign: "center", padding: 22 }}>Операций нет</td></tr>}
          </tbody>
        </table>
      </div>
      <VozvratSection objects={objects} finance_ops={finance_ops} suppliers={suppliers} whMoves={data.wh_moves} />
    </div>
  );
}
function VozvratSection({ objects, finance_ops, suppliers, whMoves }) {
  const returns = finance_ops.filter((o) => !o.voided && o.type === "return");
  // уменьшают долг поставщику только возвраты поставщику; возврат клиента на склад — нет
  const supIds = supplierReturnIds(finance_ops, whMoves);
  const kind = (o) => (supIds.has(o.id) ? (o.object_id ? "с объекта → поставщику" : "со склада → поставщику") : "от клиента → на склад");
  const fromClients = returns.filter((o) => o.object_id);
  const totalSale = fromClients.reduce((a, o) => a + (o.amount || 0), 0);
  const toSup = returns.filter((o) => supIds.has(o.id));
  const totalCost = toSup.reduce((a, o) => a + (o.cost_amount || 0), 0);
  const bySupplier = {};
  toSup.forEach((o) => {
    const key = o.supplier_id || "__none__";
    if (!bySupplier[key]) bySupplier[key] = { name: o.supplier_id ? ((suppliers.find((s) => s.id === o.supplier_id) || {}).name || "Неизвестно") : "—", sale: 0, cost: 0, cnt: 0 };
    bySupplier[key].sale += o.amount || 0;
    bySupplier[key].cost += o.cost_amount || 0;
    bySupplier[key].cnt++;
  });
  return (
    <div className="card sect" style={{ marginTop: 18 }}>
      <h3 style={{ marginBottom: 12 }}>Возвраты товаров</h3>
      <div className="kpis" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="l">Всего возвратов</div><div className="v">{returns.length}</div></div>
        <div className="kpi"><div className="l">От клиентов (сумма продажи)</div><div className="v" style={{ color: "var(--warn)" }}>{fmt(totalSale)}</div></div>
        <div className="kpi"><div className="l">Поставщикам (себест., −долг)</div><div className="v">{fmt(totalCost)}</div></div>
      </div>
      <div className="split">
        <div>
          <div className="sm" style={{ fontWeight: 700, marginBottom: 6 }}>Возвращено поставщикам</div>
          <table className="t"><thead><tr><th>Поставщик</th><th style={{textAlign:"right"}}>Кол-во</th><th style={{textAlign:"right"}}>Себест.</th></tr></thead>
            <tbody>{Object.values(bySupplier).map((r, i) => <tr key={i}><td>{r.name}</td><td className="num">{r.cnt}</td><td className="num" style={{color:"var(--warn)"}}>{fmt(r.cost)}</td></tr>)}
            {!Object.keys(bySupplier).length && <tr><td colSpan={3} className="mut sm" style={{padding:12}}>Возвратов нет</td></tr>}</tbody>
          </table>
        </div>
        <div style={{ overflow: "auto", maxHeight: 320 }}>
          <div className="sm" style={{ fontWeight: 700, marginBottom: 6 }}>Все возвраты</div>
          <table className="t"><thead><tr><th>Дата</th><th>Объект</th><th>Товар</th><th>Куда</th><th style={{textAlign:"right"}}>Кол-во</th><th style={{textAlign:"right"}}>Себест.</th><th>Причина</th></tr></thead>
            <tbody>{returns.slice().reverse().map((o) => {
              const obj = objects.find((x) => x.id === o.object_id);
              return <tr key={o.id}><td className="xs mono mut">{dt(o.op_date||o.created_at)}</td><td className="sm">{obj ? obj.name : "—"}</td><td className="sm">{o.product_name||"—"}<div className="xs mut">{o.size||""}</div></td><td className="xs">{kind(o)}</td><td className="num">{o.qty||"—"}</td><td className="num" style={{color:"var(--warn)",fontWeight:700}}>{fmt(o.cost_amount||0)}</td><td className="xs mut">{o.reason||o.note||""}</td></tr>;
            })}
            {!returns.length && <tr><td colSpan={7} className="mut sm" style={{padding:14}}>Возвратов нет</td></tr>}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============ ЖУРНАЛ ДЕЙСТВИЙ ============ */
function LogTab({ data }) {
  const { audit_log } = data;
  const [q, setQ] = useState("");
  const [usr, setUsr] = useState("");
  const [days, setDays] = useState(0);
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const users = [...new Set(audit_log.map((l) => l.user_name).filter(Boolean))];
  const rows = audit_log
    .filter((l) => (!cutoff || new Date(l.ts).getTime() >= cutoff))
    .filter((l) => (!usr || l.user_name === usr))
    .filter((l) => (!q || (l.action + " " + l.entity + " " + l.detail).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const fmtTs = (s) => { try { return new Date(s).toLocaleString("ru-RU"); } catch (e) { return s; } };
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Журнал действий <span className="mut sm">({audit_log.length})</span></h2>
        <input className="inp" style={{ maxWidth: 220 }} placeholder="Поиск по журналу…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp" style={{ maxWidth: 180 }} value={usr} onChange={(e) => setUsr(e.target.value)}>
          <option value="">Все сотрудники</option>{users.map((u) => <option key={u}>{u}</option>)}
        </select>
        <select className="inp" style={{ maxWidth: 150 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={0}>Весь период</option><option value={1}>Сегодня</option><option value={7}>7 дней</option><option value={30}>30 дней</option>
        </select>
      </div>
      <div className="card sect" style={{ borderColor: "var(--line2)" }}>
        <p className="sm mut">Журнал фиксирует ключевые действия сотрудников: заявки, оплаты, возвраты, изменения и удаления, отгрузки со склада, операции с аккаунтами. Записи не редактируются.</p>
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th style={{width:150}}>Дата / время</th><th>Сотрудник</th><th>Роль</th><th>Действие</th><th>Объект/сущность</th><th>Детали</th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td className="xs mono mut">{fmtTs(l.ts)}</td>
                <td className="sm" style={{ fontWeight: 600 }}>{l.user_name}</td>
                <td><Badge c={l.role === "boss" ? "#ff707b" : "#fff"}>{l.role === "boss" ? "Рук." : l.role === "manager" ? "Менедж." : "—"}</Badge></td>
                <td className="sm">{l.action}</td>
                <td className="xs mut">{l.entity}</td>
                <td className="xs mut">{l.detail}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="mut" style={{ textAlign: "center", padding: 26 }}>Записей нет</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============ АДМИН: АККАУНТЫ ============ */
function AdminTab({ data, reload, toast, currentUser }) {
  const { users } = data;
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Аккаунты <span className="mut sm">({users.length})</span></h2>
        <button className="btn pri" onClick={() => setEdit({ role: "manager", status: "active" })}>+ Аккаунт</button>
      </div>
      <div className="card sect" style={{ borderColor: "var(--line2)" }}>
        <p className="sm mut">Руководитель создаёт логины и пароли вручную. Вход в систему — строго по паролю. <b style={{ color: "var(--warn)" }}>Прототип:</b> пароли хранятся локально и это не полноценная защита — на облаке (Supabase Auth) вход станет настоящим.</p>
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ opacity: u.status === "active" ? 1 : 0.45 }}>
                <td className="mono" style={{ fontWeight: 700 }}>{u.username}{u.id === currentUser.id && <span className="xs mut"> (вы)</span>}</td>
                <td className="sm">{u.name}</td>
                <td><Badge c={u.role === "boss" ? "#ff707b" : "#fff"}>{u.role === "boss" ? "Руководитель" : "Менеджер"}</Badge></td>
                <td className="sm">{u.status === "active" ? "активен" : "отключён"}</td>
                <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                  <button className="btn xs" onClick={() => setEdit(u)}>ред.</button>
                  {u.id !== currentUser.id && <button className="btn xs dng" onClick={() => setDel(u)}>✕</button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <UserForm u={edit} users={users} onClose={() => setEdit(null)} onSave={async (vals) => {
        if (vals.id) await db.from("users").update(vals).eq("id", vals.id);
        else await db.from("users").insert(vals);
        await logAction(vals.id ? "Изменён аккаунт" : "Создан аккаунт", "user:" + vals.username, "роль: " + vals.role);
        setEdit(null); await reload(); toast("Аккаунт сохранён");
      }} />}
      {del && (
        <Modal title="Удалить аккаунт" onClose={() => setDel(null)} w={420}>
          <p style={{ marginBottom: 14 }}>Удалить аккаунт <b style={{ color: "var(--bad)" }}>{del.username}</b> ({del.name})?</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setDel(null)}>Отмена</button>
            <button className="btn" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={async () => {
              await db.from("users").delete().eq("id", del.id); setDel(null); await reload(); toast("Аккаунт удалён");
            }}>Удалить</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function UserForm({ u, users, onClose, onSave }) {
  const [v, setV] = useState({ ...u });
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const submit = async () => {
    const uname = (v.username || "").trim().toLowerCase();
    if (!uname) return setErr("Укажите логин");
    if (users.some((x) => x.username === uname && x.id !== v.id)) return setErr("Такой логин уже есть");
    if (!v.id && !pw) return setErr("Задайте пароль");
    const out = { ...v, username: uname };
    if (pw) { out.pass_hash = await hashPass(pw); delete out.need_seed_pass; }
    onSave(out);
  };
  return (
    <Modal title={v.id ? "Аккаунт: " + v.username : "Новый аккаунт"} onClose={onClose} w={460}>
      {err && <p className="sm" style={{ color: "var(--bad)", marginBottom: 8 }}>{err}</p>}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Fld label="Логин"><input className="inp mono" value={v.username || ""} onChange={set("username")} placeholder="manager1" /></Fld>
        <Fld label="Имя сотрудника"><input className="inp" value={v.name || ""} onChange={set("name")} /></Fld>
        <Fld label="Роль"><select className="inp" value={v.role} onChange={set("role")}><option value="manager">Менеджер</option><option value="boss">Руководитель</option></select></Fld>
        <Fld label="Статус"><select className="inp" value={v.status} onChange={set("status")}><option value="active">активен</option><option value="disabled">отключён</option></select></Fld>
        <div style={{ gridColumn: "1/-1" }}><Fld label={v.id ? "Новый пароль (оставьте пустым — без изменений)" : "Пароль"}>
          <div style={{ position: "relative" }}>
            <input type={show ? "text" : "password"} className="inp mono" style={{ paddingRight: 38 }} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••" />
            <button type="button" onClick={() => setShow(!show)} title={show ? "Скрыть" : "Показать"}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "var(--mut)", padding: 4 }}>{show ? "🙈" : "👁"}</button>
          </div>
        </Fld></div>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" onClick={submit}>Сохранить</button>
      </div>
    </Modal>
  );
}
function LoginScreen({ users, onLogin }) {
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr("");
    const u = users.find((x) => x.username === username.trim().toLowerCase());
    if (!u) { setErr("Неверный логин или пароль"); setBusy(false); return; }
    if (u.status !== "active") { setErr("Аккаунт отключён"); setBusy(false); return; }
    // первый вход админа по сид-паролю
    if (!u.pass_hash && u.need_seed_pass) {
      if (pw === u.need_seed_pass) {
        await db.from("users").update({ pass_hash: await hashPass(pw), need_seed_pass: null }).eq("id", u.id);
        onLogin(u); return;
      }
      setErr("Неверный логин или пароль"); setBusy(false); return;
    }
    const h = await hashPass(pw);
    if (h === u.pass_hash) onLogin(u);
    else setErr("Неверный логин или пароль");
    setBusy(false);
  };
  return (
    <div className="te" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <style>{CSS}</style>
      <div className="card" style={{ width: 360, borderColor: "var(--acc)", boxShadow: "0 20px 60px rgba(255,31,48,.2)" }}>
        <div className="logo" style={{ textAlign: "center", marginBottom: 4 }}>THERMO<span>•</span>ENGINEERING<small>AI procurement & finance OS</small></div>
        <h3 style={{ textAlign: "center", margin: "16px 0 14px" }}>Вход в систему</h3>
        {err && <p className="sm" style={{ color: "var(--bad)", textAlign: "center", marginBottom: 10 }}>{err}</p>}
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          <Fld label="Логин"><input className="inp mono" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} autoFocus /></Fld>
          <Fld label="Пароль"><div style={{ position: "relative" }}>
            <input type={show ? "text" : "password"} className="inp mono" style={{ paddingRight: 38 }} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
            <button type="button" onClick={() => setShow(!show)} title={show ? "Скрыть" : "Показать"}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "var(--mut)", padding: 4 }}>{show ? "🙈" : "👁"}</button>
          </div></Fld>
        </div>
        <button className="btn pri" style={{ width: "100%", marginTop: 14 }} disabled={busy} onClick={submit}>{busy ? "Проверка…" : "Войти"}</button>
        {users.some((u) => u.need_seed_pass) && <p className="xs mut" style={{ textAlign: "center", marginTop: 12 }}>Первый вход: <b className="mono">admin</b> / <b className="mono">admin123</b> — затем смените пароль в «Аккаунты».</p>}
      </div>
    </div>
  );
}

/* ============ APP ============ */
class ErrBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error(err, info); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ fontFamily: "monospace", background: "#101216", color: "#e25563", minHeight: "100vh", padding: 24, fontSize: 13 }}>
          <div style={{ color: "#e8eaef", fontWeight: 700, marginBottom: 10 }}>Ошибка приложения — отправь этот текст в чат:</div>
          <pre style={{ whiteSpace: "pre-wrap" }}>{String(this.state.err && (this.state.err.stack || this.state.err.message || this.state.err))}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
function AppInner() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState({ products: [], suppliers: [], objects: [], finance_ops: [], requests: [], masters: [], warehouse: [], wh_moves: [], users: [], audit_log: [] });
  const [tab, setTab] = useState("dash");
  const [currentUser, setCurrentUser] = useState(null);
  const role = currentUser ? currentUser.role : "boss";
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState("");

  const toastTm = useRef(null);
  const toast = (m) => { setMsg(m); clearTimeout(toastTm.current); toastTm.current = setTimeout(() => setMsg(""), 3500); };
  // ошибки записи в базу — отдельным красным сообщением, его не перекрывает обычное «Сохранено»
  const [dbErr, setDbErr] = useState("");
  useEffect(() => {
    let tm;
    const h = (e) => { setDbErr(e.detail); clearTimeout(tm); tm = setTimeout(() => setDbErr(""), 9000); };
    window.addEventListener("te-db-error", h);
    return () => { window.removeEventListener("te-db-error", h); clearTimeout(tm); };
  }, []);
  const reload = async () => {
    const res = await Promise.all(TABLES.map((t) => fetchAllRows(t)));
    const out = {};
    TABLES.forEach((t, i) => { out[t] = res[i]; });
    setData(out);
  };
  const [bootErr, setBootErr] = useState("");
  const restoreRef = useRef(null);
  // список людей для полей «Менеджер» / «Ответственный»
  const [extraPeople, setExtraPeople] = useState(() => { try { return JSON.parse(localStorage.getItem("te:people") || "[]"); } catch { return []; } });
  const people = useMemo(() => {
    const set = new Set();
    const add = (n) => { const t = String(n || "").trim(); if (t && !["manager", "boss", "—", "-"].includes(t.toLowerCase())) set.add(t); };
    (data.users || []).filter((u) => u.status !== "inactive").forEach((u) => add(u.name || u.username));
    (data.objects || []).forEach((o) => add(o.manager));
    (data.finance_ops || []).forEach((o) => add(o.user));
    (data.wh_moves || []).forEach((m) => add(m.user));
    extraPeople.forEach(add);
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [data.users, data.objects, data.finance_ops, data.wh_moves, extraPeople]);
  const peopleCtx = useMemo(() => ({
    people,
    addPerson: (n) => setExtraPeople((prev) => { if (prev.includes(n)) return prev; const next = [...prev, n]; try { localStorage.setItem("te:people", JSON.stringify(next)); } catch {} return next; }),
  }), [people]);
  useEffect(() => {
    (async () => {
      try {
        await reload();
        // восстановить сессию из localStorage
        const uid = localStorage.getItem("te:session");
        if (uid) {
          const { data: users } = await db.from("users").select().eq("id", uid).eq("status", "active");
          if (users && users.length) { setCurrentUser(users[0]); CURRENT_USER = users[0]; }
        }
      } catch (e) {
        console.error(e); setBootErr(String(e && (e.message || e)));
      }
      setReady(true);
    })();
  }, []);
  const doLogin = async (u) => {
    setCurrentUser(u); CURRENT_USER = u;
    try { localStorage.setItem("te:session", u.id); } catch (e) {}
    await reload();
  };
  const doLogout = async () => {
    setCurrentUser(null); CURRENT_USER = null;
    try { localStorage.removeItem("te:session"); } catch (e) {}
  };
  const [darkMode, setDarkMode] = useState(() => { try { return localStorage.getItem("te:dark") === "1"; } catch { return false; } });
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("te:lang") || "ru"; } catch { return "ru"; } });
  const toggleDark = () => { setDarkMode((v) => { const n = !v; try { localStorage.setItem("te:dark", n ? "1" : "0"); } catch {} return n; }); };
  const toggleLang = () => { setLang((v) => { const n = v === "ru" ? "uz" : "ru"; try { localStorage.setItem("te:lang", n); } catch {} return n; }); };
  const L = (ru, uz) => lang === "uz" ? uz : ru;
  const [backupOpen, setBackupOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hdrHidden, setHdrHidden] = useState(false);
  const lastScrollY = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const goingDown = y > lastScrollY.current;
      // прячем только при заметном скролле вниз и не у самого верха страницы
      if (goingDown && y > 80) setHdrHidden(true);
      else if (!goingDown) setHdrHidden(false);
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // при открытии мобильного меню шапка всегда видна, чтобы не закрывать список вкладок
  useEffect(() => { if (mobileMenuOpen) setHdrHidden(false); }, [mobileMenuOpen]);
  // перед восстановлением: подтверждение + автоматически скачиваем бэкап текущей базы
  const confirmRestore = () => {
    if (!window.confirm("Восстановить базу из бэкапа?\n\nТекущие данные будут заменены содержимым бэкапа. Перед этим автоматически скачается бэкап текущей базы.")) return false;
    const cur = { _app: "ThermoAI", _date: new Date().toISOString(), _note: "автобэкап перед восстановлением", tables: {} };
    TABLES.forEach((t) => { cur.tables[t] = data[t] || []; });
    tryDownloadBackup(JSON.stringify(cur));
    return true;
  };
  const onRestore = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = "";
    if (!confirmRestore()) return;
    try { await importBackup(f); await reload(); toast("База восстановлена из бэкапа"); setBootErr(""); }
    catch (err) { toast("Ошибка: " + err.message); }
  };

  const roleTabs = (ROLES.find((r) => r.id === role) || ROLES[0]).tabs;
  const TAB_LABELS_RU = { request: "Новая заявка", dash: "Дашборд", objects: "Объекты", products: "Товары", wh: "Склад Thermo", suppliers: "Поставщики", masters: "Мастера", finance: "Финансы", log: "Журнал", admin: "Аккаунты" };
  const TAB_LABELS_UZ = { request: "Yangi ariza", dash: "Boshqaruv", objects: "Ob'ektlar", products: "Tovarlar", wh: "Ombor Thermo", suppliers: "Ta'minotchilar", masters: "Ustalar", finance: "Moliya", log: "Jurnal", admin: "Hisoblar" };
  const TAB_LABELS = lang === "uz" ? TAB_LABELS_UZ : TAB_LABELS_RU;
  const allTabs = roleTabs.map((id) => ({ id, label: TAB_LABELS[id] }));
  useEffect(() => { if (currentUser) { setTab(roleTabs[0]); setOpenId(null); } }, [currentUser]);

  if (!ready) return (
    <div className="te" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <style>{CSS}</style>
      <div className="mut"><span className="spin" /> Загрузка базы…</div>
    </div>
  );
  if (!currentUser) return <LoginScreen users={data.users || []} onLogin={doLogin} />;
  return (
    <PeopleCtx.Provider value={peopleCtx}>
    <div className={"te" + (darkMode ? " dark" : "")}>
      <style>{CSS}</style>
      <div className={"hdr" + (hdrHidden ? " hide-on-scroll" : "")}>
        <div className="logo">THERMO<span>•</span>ENGINEERING<small>AI procurement & finance OS</small></div>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{currentUser.name || currentUser.username}</div>
            <div className="xs mut">{role === "boss" ? (lang === "uz" ? "Rahbar" : "Руководитель") : (lang === "uz" ? "Menejer" : "Менеджер")}</div>
          </div>
          <button className="btn xs" onClick={toggleLang} title={lang === "ru" ? "Переключить на узбекский" : "Ruscha tilga o'tish"} style={{ fontWeight: 800 }}>{lang === "ru" ? "UZ" : "RU"}</button>
          <button className="btn xs" onClick={toggleDark} title={darkMode ? "Светлая тема" : "Тёмная тема"}>{darkMode ? "☀️" : "🌙"}</button>
          <button className="btn xs" onClick={doLogout} title={lang === "uz" ? "Chiqish" : "Выйти"}>{lang === "uz" ? "Chiqish" : "Выйти"}</button>
        </div>
        <div className={"tabs" + (mobileMenuOpen ? " open" : "")}>
          {allTabs.map((t) => <button key={t.id} className={"tab " + (tab === t.id ? "on" : "")} onClick={() => { setTab(t.id); if (t.id !== "objects") setOpenId(null); setMobileMenuOpen(false); }}>{t.label}</button>)}
        </div>
        <button className="burger" onClick={() => setMobileMenuOpen((v) => !v)} title="Меню">{mobileMenuOpen ? "✕" : "☰"}</button>
        <button className="btn xs" title="Бэкап и восстановление базы" onClick={() => setBackupOpen(true)}>💾 Бэкап</button>
        <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={onRestore} />
      </div>
      <div className="body">
        {bootErr && <div className="card sect" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>Ошибка подключения к Supabase: {bootErr}</div>}
        {tab === "dash" && <Dashboard data={data} />}
        {tab === "objects" && <ObjectsTab data={data} reload={reload} toast={toast} openId={openId} setOpenId={setOpenId} goRequest={() => setTab("request")} fin={role === "boss"} />}
        {tab === "request" && <RequestTabs data={data} reload={reload} toast={toast} openObject={(id) => { setOpenId(id); setTab("objects"); }} />}
        {tab === "products" && <ProductsTab data={data} reload={reload} toast={toast} />}
        {tab === "suppliers" && <SuppliersTab data={data} reload={reload} toast={toast} fin={role === "boss"} />}
        {tab === "masters" && <MastersTab data={data} reload={reload} toast={toast} fin={true} openObject={(id) => { setOpenId(id); setTab("objects"); }} />}
        {tab === "wh" && <WarehouseTab data={data} reload={reload} toast={toast} openObject={(id) => { setOpenId(id); setTab("objects"); }} />}
        {tab === "log" && <LogTab data={data} />}
        {tab === "admin" && <AdminTab data={data} reload={reload} toast={toast} currentUser={currentUser} />}
        {tab === "finance" && <FinanceTab data={data} reload={reload} toast={toast} />}
      </div>
      {backupOpen && <BackupModal data={data} onClose={() => setBackupOpen(false)} toast={toast} onFilePick={() => restoreRef.current.click()} onRestoreText={async (text) => {
        const dump = JSON.parse(text);
        if (!confirmRestore()) return;
        await restoreFromSupabase(dump); await reload(); setBackupOpen(false); toast("База восстановлена");
      }} onWipe={role === "boss" ? () => { setBackupOpen(false); setWipeOpen(true); } : null} />}
      {wipeOpen && role === "boss" && <WipeModal data={data} onClose={() => setWipeOpen(false)} onDone={async () => {
        await reload(); setWipeOpen(false); setOpenId(null); toast("База очищена. Товары, поставщики и мастера сохранены.");
      }} />}
      {msg && <div className="toast">{msg}</div>}
      {dbErr && <div className="toast" role="alert" title="Нажмите, чтобы закрыть" onClick={() => setDbErr("")}
        style={{ bottom: msg ? 84 : 20, borderColor: "var(--bad)", color: "var(--bad)", maxWidth: 460, cursor: "pointer" }}>⚠ {dbErr}</div>}
    </div>
    </PeopleCtx.Provider>
  );
}
/* ============ ОЧИСТКА БАЗЫ ============
   Удаляет рабочие данные (объекты, финансовые операции, заявки) → все долги клиентов и поставщикам = 0.
   Справочники сохраняются: товары (названия, цены), поставщики, мастера, аккаунты.
   Перед удалением автоматически скачивается бэкап. */
const WIPE_WORD = "ОЧИСТИТЬ";
function WipeModal({ data, onClose, onDone }) {
  const [wh, setWh] = useState(false);
  const [log, setLog] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const n = (t) => (data[t] || []).length;
  const ok = word.trim().toUpperCase() === WIPE_WORD;
  const run = async () => {
    setBusy(true); setErr("");
    try {
      setStep("Скачиваю бэкап…");
      const dump = { _app: "ThermoAI", _date: new Date().toISOString(), _note: "автобэкап перед очисткой", tables: {} };
      TABLES.forEach((t) => { dump.tables[t] = data[t] || []; });
      tryDownloadBackup(JSON.stringify(dump));
      const tables = ["finance_ops", "requests", "objects"];
      if (wh) tables.push("wh_moves", "warehouse");
      if (log) tables.push("audit_log");
      for (const t of tables) {
        setStep("Удаляю: " + t + "…");
        const rows = await fetchAllRows(t);
        await deleteByIds(t, rows.map((r) => r.id));
      }
      await logAction("База очищена", "", "удалено: " + tables.join(", "));
      setStep("");
      await onDone();
    } catch (e) { setErr("Ошибка очистки: " + e.message + ". Часть данных могла быть удалена — бэкап скачан, его можно восстановить."); }
    setBusy(false);
  };
  const Li = ({ children }) => <li style={{ margin: "3px 0" }}>{children}</li>;
  return (
    <Modal title="Очистка базы" onClose={busy ? () => {} : onClose} w={560}>
      <div className="card sect" style={{ borderColor: "var(--bad)", padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, color: "var(--bad)", marginBottom: 6 }}>Будет удалено безвозвратно:</div>
        <ul className="sm" style={{ paddingLeft: 18, margin: 0 }}>
          <Li>Объекты вместе с материалами и поставками — <b>{n("objects")}</b></Li>
          <Li>Финансовые операции: оплаты клиентов и поставщикам, возвраты, скидки, бонусы, расходы — <b>{n("finance_ops")}</b></Li>
          <Li>История заявок — <b>{n("requests")}</b></Li>
        </ul>
        <div className="sm" style={{ marginTop: 8 }}>→ Долги клиентов и долги поставщикам станут <b>0</b>.</div>
      </div>
      <div className="card sect" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, color: "var(--ok)", marginBottom: 6 }}>Сохранится:</div>
        <ul className="sm" style={{ paddingLeft: 18, margin: 0 }}>
          <Li>Товары — названия и цены ({n("products")})</Li>
          <Li>Поставщики ({n("suppliers")}), мастера ({n("masters")}), аккаунты ({n("users")})</Li>
        </ul>
      </div>
      <div className="sm" style={{ marginBottom: 12 }}>
        <label className="clk" style={{ display: "block", marginBottom: 4 }}><input type="checkbox" checked={wh} disabled={busy} onChange={(e) => setWh(e.target.checked)} /> Также очистить Склад Thermo (остатки {n("warehouse")} и движения {n("wh_moves")})</label>
        <label className="clk" style={{ display: "block" }}><input type="checkbox" checked={log} disabled={busy} onChange={(e) => setLog(e.target.checked)} /> Также очистить журнал действий ({n("audit_log")})</label>
      </div>
      <p className="xs mut" style={{ marginBottom: 10 }}>Перед очисткой автоматически скачается файл бэкапа — из него всё можно восстановить через «💾 Бэкап → выбрать файл .json».</p>
      <Fld label={"Для подтверждения введите слово " + WIPE_WORD}>
        <input className="inp" value={word} disabled={busy} onChange={(e) => setWord(e.target.value)} placeholder={WIPE_WORD} autoFocus />
      </Fld>
      {err && <p className="sm" style={{ color: "var(--bad)", marginTop: 8 }}>{err}</p>}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
        {step && <span className="sm mut" style={{ marginRight: "auto" }}><span className="spin" /> {step}</span>}
        <button className="btn" disabled={busy} onClick={onClose}>Отмена</button>
        <button className="btn dng" disabled={!ok || busy} onClick={run}>{busy ? "Очищаю…" : "Очистить базу"}</button>
      </div>
    </Modal>
  );
}
function BackupModal({ data, onClose, toast, onFilePick, onRestoreText, onWipe }) {
  // JSON бэкапа собирается только по кнопке — при большой базе (15 000+ товаров это несколько МБ)
  // вывод всего текста в поле при открытии окна подвешивал браузер
  const buildJson = () => {
    const dump = { _app: "ThermoAI", _date: new Date().toISOString(), tables: {} };
    TABLES.forEach((t) => { dump.tables[t] = data[t] || []; });
    return JSON.stringify(dump);
  };
  const totalRows = TABLES.reduce((a, t) => a + (data[t] || []).length, 0);
  const [manualJson, setManualJson] = useState("");
  const [restoreTxt, setRestoreTxt] = useState("");
  const [err, setErr] = useState("");
  const taRef = useRef(null);
  const download = () => { const ok = tryDownloadBackup(buildJson()); toast(ok ? "Файл бэкапа скачан" : "Скачивание заблокировано — используйте «Копировать»"); };
  const copy = async () => {
    const json = buildJson();
    try { await navigator.clipboard.writeText(json); toast("Бэкап скопирован в буфер (" + Math.round(json.length / 1024) + " КБ)"); return; } catch (e) {}
    setManualJson(json); toast("Автокопирование недоступно — выделите текст в поле и скопируйте вручную");
  };
  return (
    <Modal title="Бэкап и восстановление базы" onClose={onClose} w={680}>
      <h3 style={{ marginBottom: 6 }}>Сохранить</h3>
      <p className="xs mut" style={{ marginBottom: 8 }}>Скачайте файл бэкапа (рекомендуется) или скопируйте его текст. В бэкап входит вся база: {totalRows.toLocaleString("ru-RU")} записей, из них товаров {(data.products || []).length.toLocaleString("ru-RU")}.</p>
      <div className="row" style={{ marginTop: 8, marginBottom: manualJson ? 8 : 18 }}>
        <button className="btn pri" onClick={download}>⬇ Скачать файлом</button>
        <button className="btn" onClick={copy}>📋 Копировать бэкап</button>
      </div>
      {manualJson && <textarea ref={taRef} readOnly className="inp" style={{ minHeight: 90, fontSize: 10, marginBottom: 18 }} value={manualJson} onFocus={(e) => e.target.select()} />}
      <h3 style={{ marginBottom: 6 }}>Восстановить</h3>
      {err && <p className="sm" style={{ color: "var(--bad)", marginBottom: 6 }}>{err}</p>}
      <textarea className="inp" style={{ minHeight: 90, fontSize: 10 }} placeholder="Вставьте сюда текст бэкапа…" value={restoreTxt} onChange={(e) => setRestoreTxt(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn pri" disabled={!restoreTxt.trim()} onClick={async () => {
          try { setErr(""); await onRestoreText(restoreTxt); } catch (e) { setErr("Ошибка: " + e.message); }
        }}>⬆ Восстановить из текста</button>
        <button className="btn" onClick={onFilePick}>…или выбрать файл .json</button>
      </div>
      <p className="xs mut" style={{ marginTop: 10 }}>Восстановление полностью заменяет текущую базу содержимым бэкапа.</p>
      {onWipe && (
        <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px dashed var(--bad)" }}>
          <h3 style={{ marginBottom: 6, color: "var(--bad)" }}>Опасная зона</h3>
          <p className="xs mut" style={{ marginBottom: 8 }}>Очистка базы: удаляются объекты, оплаты и все долги клиентов и поставщикам. Товары (названия и цены), поставщики, мастера и аккаунты сохраняются.</p>
          <button className="btn dng" onClick={onWipe}>🧹 Очистить базу…</button>
        </div>
      )}
    </Modal>
  );
}

export default function App() {
  return <ErrBoundary><AppInner /></ErrBoundary>;
}
