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
   THERMO ENGINEERING — Procurement & Finance OS
   DATA LAYER = Supabase (db импортируется из ./db.js)
   ============================================================ */

const SEGMENTS = ["эконом", "комфорт", "премиум"];
// в базе хранится «комфорт», на экране — «Стандарт»
const SEG_LABEL = { "эконом": "Эконом", "комфорт": "Стандарт", "премиум": "Премиум" };
const SEG_COLOR = { "эконом": "var(--t-info)", "комфорт": "var(--t-strong)", "премиум": "var(--t-violet)" };
const supSeg = (sup) => (sup && SEGMENTS.includes(sup.segment) ? sup.segment : "комфорт");
const OBJ_STATUSES = [
  { id: "draft", label: "Черновик", c: "var(--t-neutral)" },
  { id: "review", label: "На проверке", c: "var(--t-warn)" },
  { id: "approved", label: "Согласовано", c: "var(--t-strong)" },
  { id: "waiting", label: "В ожидании", c: "var(--t-violet)" },
  { id: "partial", label: "Частично оплачено", c: "var(--t-bad)" },
  { id: "paid", label: "Оплачено", c: "var(--t-ok)" },
  { id: "closed", label: "Закрыто", c: "var(--t-ok)" },
  { id: "cancelled", label: "Отменено", c: "var(--t-bad)" },
];
const OP_TYPES = [
  { id: "client_payment", label: "Оплата клиента" },
  { id: "supplier_payment", label: "Оплата поставщику" },
  { id: "return", label: "Возврат товара" },
  { id: "discount", label: "Скидка" },
  { id: "expense", label: "Доп. расход" },
  { id: "bonus", label: "Бонус мастеру (начисление)" },
  { id: "bonus_payment", label: "Выплата бонуса мастеру" },
  { id: "company_expense", label: "Расход компании" },
  { id: "wh_purchase", label: "Приход на склад (закупка)" },
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
const EXPENSE_CATEGORIES = ["Зарплата", "Аренда", "Коммунальные", "Обед / питание", "Доставка", "Заправка транспорта", "Освежения", "Связь / интернет", "Налоги", "Реклама", "Хозрасходы", "Прочее"];
// зарплату видит только руководитель
const SALARY_CAT = "Зарплата";
const isSalary = (o) => o && o.type === "company_expense" && o.category === SALARY_CAT;
// вид выплаты зарплаты и сотрудник. Сотрудники хранятся в таблице users с ролью staff (войти в систему не могут).
const SALARY_KINDS = ["Зарплата", "Аванс", "Премия"];
const STAFF_ROLE = "staff";
const isStaff = (u) => !!u && u.role === STAFF_ROLE;
// вид и сотрудник лежат в колонках item_name / product_name; если их нет в базе — в начале комментария «[Аванс · Имя]»
const SAL_NOTE_RE = /^\[([^·\]]+?)\s*·\s*([^\]]+)\]\s*/;
// в базе может не быть колонки category у finance_ops (тогда она отбрасывается при записи):
// статья расхода дублируется в size, а у старых записей зарплата узнаётся по виду выплаты и сотруднику
function normFinOp(o) {
  if (!o || o.type !== "company_expense" || o.category) return o;
  let cat = "";
  if (o.size && EXPENSE_CATEGORIES.includes(o.size)) cat = o.size;
  else if ((SALARY_KINDS.includes(o.item_name) && o.product_name) || SAL_NOTE_RE.test(o.note || "")) cat = SALARY_CAT;
  return cat ? { ...o, category: cat } : o;
}
function salaryInfo(o) {
  if (!isSalary(o)) return null;
  let kind = o.item_name || "", emp = o.product_name || "", note = o.note || "";
  const m = SAL_NOTE_RE.exec(note);
  if (m) { kind = kind || m[1].trim(); emp = emp || m[2].trim(); note = note.slice(m[0].length); }
  return { kind: kind || "Зарплата", emp, note };
}
function employeeList(data) {
  const set = new Set();
  (data.users || []).filter(isStaff).forEach((u) => { if (u.name) set.add(u.name.trim()); });
  (data.finance_ops || []).forEach((o) => { const i = salaryInfo(o); if (i && i.emp) set.add(i.emp); });
  return [...set].sort((a, b) => a.localeCompare(b, "ru"));
}
async function addEmployee(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  if (!n) return false;
  const r = await db.from("users").insert({ username: "staff-" + uuid().slice(0, 8), name: n, role: STAFF_ROLE, status: "inactive" });
  if (r.error) return false;
  await logAction("Добавлен сотрудник", "staff:" + n, "");
  return true;
}
function EmployeeSelect({ value, onChange, employees, onAdded }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = name.trim().replace(/\s+/g, " "); if (!n) return;
    setBusy(true);
    if (!employees.some((x) => x.toLowerCase() === n.toLowerCase())) { await addEmployee(n); if (onAdded) await onAdded(); }
    setBusy(false); onChange(n); setAdding(false); setName("");
  };
  if (adding) return (
    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <input className="inp" autoFocus placeholder="Имя и фамилия сотрудника" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } else if (e.key === "Escape") setAdding(false); }} />
      <button className="btn xs pri" disabled={!name.trim() || busy} onClick={save}>{busy ? "…" : "OK"}</button>
      <button className="btn xs" onClick={() => { setAdding(false); setName(""); }}>✕</button>
    </div>
  );
  return (
    <select className="inp" value={value || ""} style={{ borderColor: value ? undefined : "var(--bad)" }} onChange={(e) => { if (e.target.value === "__add__") setAdding(true); else onChange(e.target.value); }}>
      <option value="" disabled hidden>— выберите сотрудника —</option>
      {employees.map((x) => <option key={x} value={x}>{x}</option>)}
      <option value="__add__">+ добавить сотрудника…</option>
    </select>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
/* Премиум-тема: спокойные графитовые нейтральные тона без чистого белого и чёрного + фирменный красный Thermo #ff1f30
   (активная вкладка, главные кнопки, акценты). Цифры — табличные, без моноширинного шрифта. */
:root{
  --bg:#eef0ee; --panel:#fbfbfa; --panel2:#f3f5f3; --line:#e0e4e1; --line2:#cfd5d1;
  --txt:#1f2629; --mut:#66706f; --acc:#ff1f30; --acc2:#d6001a; --acc-tint:rgba(255,31,48,.06); --acc-ring:rgba(255,31,48,.22);
  --ok:#2c7a52; --warn:#99650f; --bad:#b33a3a;
  --t-neutral:#66706f; --t-ok:#2c7a52; --t-warn:#99650f; --t-bad:#b33a3a; --t-info:#2f6a9e; --t-violet:#6a55a3; --t-strong:#1f2629;
  --mono:'JetBrains Mono',ui-monospace,monospace; --sans:'Onest',system-ui,sans-serif;
  --hdr-bg:#1f2629; --hdr-txt:#eef1ef; --hdr-mut:#9aa5a3; --hdr-line:#334046; --hdr-panel2:#28323a;
  --shadow:0 1px 2px rgba(31,38,41,.05),0 2px 8px rgba(31,38,41,.04); --hover:rgba(31,38,41,.035);
}
.te.dark{
  --bg:#15191b; --panel:#1b2023; --panel2:#21282b; --line:#2b3438; --line2:#374247;
  --txt:#dfe4e2; --mut:#8d9896; --acc:#ff1f30; --acc2:#ff4553; --acc-tint:rgba(255,31,48,.09); --acc-ring:rgba(255,31,48,.32);
  --ok:#5fb88a; --warn:#d4a24c; --bad:#e07272;
  --t-neutral:#9aa5a3; --t-ok:#5fb88a; --t-warn:#d4a24c; --t-bad:#e07272; --t-info:#6ea9de; --t-violet:#a597de; --t-strong:#dfe4e2;
  --hdr-bg:#101416; --hdr-line:#253035; --hdr-panel2:#1b2327;
  --shadow:0 1px 2px rgba(0,0,0,.25); --hover:rgba(255,255,255,.035);
}
.te{--viz-s1:#2a78d6;--viz-s2:#eb6834;--viz-grid:#e1e4e1;--viz-axis:#c4cac6}
.te.dark{--viz-s1:#3987e5;--viz-s2:#d95926;--viz-grid:#2a3236;--viz-axis:#3a454a}
@media(max-width:820px){.dash .kpi[style*="span 2"]{grid-column:auto!important}}
*{box-sizing:border-box;margin:0;padding:0}
.te{font-family:var(--sans);background:var(--bg);color:var(--txt);min-height:100vh;font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased;font-feature-settings:"tnum" 1}
.te ::selection{background:var(--acc-ring)}
.hdr{display:flex;align-items:center;gap:14px;padding:12px 22px;border-bottom:2px solid var(--acc);flex-wrap:wrap;position:sticky;top:0;background:var(--hdr-bg);color:var(--hdr-txt);z-index:50;transition:transform .25s ease}
@media(max-width:820px){.hdr.hide-on-scroll{transform:translateY(-100%)}}
.logo{font-weight:800;letter-spacing:.4px;font-size:17px;color:var(--hdr-txt)}
.logo span{color:var(--acc)}
.te.dark .logo span{color:var(--acc)}
.logo small{display:block;font-weight:500;color:var(--hdr-mut);font-size:10px;letter-spacing:2px;text-transform:uppercase}
.tabs{display:flex;gap:2px;flex-wrap:wrap;margin-left:auto}
.tab{position:relative;padding:8px 12px;border-radius:8px;border:0;color:var(--hdr-mut);cursor:pointer;font-weight:600;font-size:13px;background:none;font-family:var(--sans)}
.burger{display:none;align-items:center;justify-content:center;width:38px;height:38px;border-radius:8px;border:1px solid var(--hdr-line);background:var(--hdr-panel2);color:var(--hdr-txt);cursor:pointer;font-size:18px;margin-left:auto}
.tab:hover{color:var(--hdr-txt);background:var(--hdr-panel2)}
.tab.on{color:#fff;background:var(--acc);box-shadow:0 4px 14px rgba(255,31,48,.28)}
@media(max-width:820px){
  .tabs{display:none;position:absolute;top:100%;left:0;right:0;flex-direction:column;flex-wrap:nowrap;gap:0;margin:0;background:var(--hdr-bg);border-bottom:2px solid var(--acc);box-shadow:0 16px 30px rgba(0,0,0,.35);padding:6px;z-index:60}
  .tabs.open{display:flex}
  .tab{width:100%;text-align:left;padding:12px 14px;border-radius:6px}
  .burger{display:flex}
}
.hdr .btn{background:var(--hdr-panel2);border-color:var(--hdr-line);color:var(--hdr-txt)}
.hdr .btn:hover{border-color:var(--acc);color:#fff}
.hdr .mut{color:var(--hdr-mut)}
.body{padding:22px 24px 40px;max-width:1300px;margin:0 auto}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:var(--shadow)}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.grid{display:grid;gap:12px}
h2{font-size:20px;font-weight:700;letter-spacing:-.2px;margin-bottom:4px}
h3{font-size:15px;font-weight:650}
.mut{color:var(--mut)}.sm{font-size:12.5px}.xs{font-size:11.5px}
.mono{font-family:var(--sans);font-variant-numeric:tabular-nums}
.btn{padding:8px 14px;border-radius:9px;border:1px solid var(--line2);background:var(--panel);color:var(--txt);cursor:pointer;font-weight:600;font-size:13px;font-family:var(--sans);white-space:nowrap;transition:background .12s,border-color .12s,color .12s}
.btn:hover{border-color:var(--mut);background:var(--panel2)}
.btn.pri{background:var(--acc);border-color:var(--acc);color:#fff;box-shadow:0 3px 10px rgba(255,31,48,.22)}
.btn.pri:hover{background:var(--acc2);border-color:var(--acc2);color:#fff}
.btn.dng{color:var(--bad)}
.btn.dng:hover{border-color:var(--bad)}
.btn:disabled{opacity:.45;cursor:default}
.btn.xs{padding:4px 9px;font-size:11.5px;border-radius:7px}
.btn:focus-visible,.tab:focus-visible,.inp:focus-visible,.burger:focus-visible{outline:2px solid var(--acc-ring);outline-offset:2px}
.inp,select.inp,textarea.inp{background:var(--panel);border:1px solid var(--line2);border-radius:9px;color:var(--txt);padding:8px 10px;font-size:13px;font-family:var(--sans);outline:none;width:100%;transition:border-color .12s,box-shadow .12s}
.inp:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-ring)}
textarea.inp{min-height:120px;font-family:var(--mono);font-size:12px;resize:vertical}
.fld{display:flex;flex-direction:column;gap:5px;min-width:0}
.fld label{font-size:12px;color:var(--mut);font-weight:600}
table.t{width:100%;border-collapse:collapse;font-size:13px}
table.t th{font-size:11.5px;color:var(--mut);text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);font-weight:600;background:var(--panel2)}
table.t td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
table.t tbody tr:last-child td{border-bottom:0}
.vt-box{overflow:auto;max-height:calc(100vh - 210px);min-height:320px}
table.vt{table-layout:fixed;width:100%;min-width:1040px}
table.vt thead th{position:sticky;top:0;z-index:2;background:var(--panel2)}
table.vt td{padding:4px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table.vt td div{overflow:hidden;text-overflow:ellipsis}
table.t tr:hover td{background:var(--hover)}
.num{font-variant-numeric:tabular-nums;font-size:13px;text-align:right;white-space:nowrap}
.bdg{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;border:1px solid}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;box-shadow:var(--shadow)}
.kpi .v{font-family:var(--sans);font-variant-numeric:tabular-nums;font-size:22px;font-weight:700;letter-spacing:-.3px;margin-top:4px}
.kpi .l{font-size:12px;color:var(--mut);font-weight:600}
.modal-bg{position:fixed;inset:0;background:rgba(18,24,27,.45);display:flex;align-items:flex-start;justify-content:center;z-index:100;padding:30px 14px;overflow:auto;backdrop-filter:blur(2px)}
.modal{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px;width:100%;box-shadow:0 24px 60px rgba(18,24,27,.22)}
.te.dark .modal{box-shadow:0 24px 60px rgba(0,0,0,.5)}
.steps{display:flex;gap:6px;margin:10px 0 18px;flex-wrap:wrap}
.step{padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid var(--line);color:var(--mut)}
.step.on{border-color:var(--acc);color:#fff;background:var(--acc)}
.step.done{color:var(--ok);border-color:var(--ok)}
.toast{position:fixed;bottom:20px;right:20px;background:var(--panel);color:var(--txt);border:1px solid var(--line2);border-left:3px solid var(--ok);border-radius:10px;padding:12px 18px;font-weight:600;z-index:200;box-shadow:0 12px 32px rgba(18,24,27,.18)}
.toast[role=alert]{border-left-color:var(--bad)}
.clk{cursor:pointer}
.sect{margin-bottom:18px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.split>*{min-width:0}
.split>.card{overflow-x:auto}
@media(max-width:820px){.split{grid-template-columns:1fr}.body{padding:14px 14px 32px}}
.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line2);border-top-color:var(--acc);border-radius:50%;animation:sp 0.8s linear infinite;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.hdr,.btn,.inp{transition:none}.spin{animation-duration:2s}}
.conf{font-variant-numeric:tabular-nums;font-weight:700;font-size:12px}
.pick-row:hover{background-color:var(--acc-tint) !important}
table.t td{position:static}
`;

/* ============ DATA LAYER = Supabase (db из ./db.js) ============ */
const TABLES = ["products", "suppliers", "objects", "finance_ops", "requests", "masters", "warehouse", "wh_moves", "users", "audit_log"];
// id записи всегда в формате UUID: колонки id в базе имеют тип uuid, другой формат база не примет
// (crypto.randomUUID есть не во всех браузерах — например, в старых Safari)
const uuid = () => {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
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
    const d = new Date();
    a.download = "thermo_backup_" + localIso(d) + "_" + String(d.getHours()).padStart(2, "0") + "-" + String(d.getMinutes()).padStart(2, "0") + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return true;
  } catch (e) { console.error(e); return false; }
}
// свежий бэкап прямо из базы (а не из данных на экране — они могли устареть: товары и журнал обновляются реже)
async function freshDump(note) {
  const dump = { _app: "ThermoAI", _date: new Date().toISOString(), tables: {} };
  if (note) dump._note = note;
  const res = await Promise.all(TABLES.map((t) => fetchAllRows(t)));
  TABLES.forEach((t, i) => { dump.tables[t] = res[i]; });
  return dump;
}
/* Загрузка ВСЕХ строк таблицы без лимита 1000.
   Supabase отдаёт максимум 1000 строк за запрос, поэтому читаем страницами.
   Сортировка created_at + id — стабильная (у строк из одного пакетного импорта created_at одинаковый).
   Ошибку загрузки не прячем (раньше при сбое сети таблица молча становилась пустой) — бросаем её,
   а reload() оставляет на экране прежние данные и показывает сообщение. */
async function fetchAllRows(t) {
  if (!sb) {
    const { data, error } = await db.from(t).select().order("created_at", { ascending: true });
    if (error) throw new Error(t + ": " + (error.message || error));
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
  // запасной вариант: по одной странице, пока не придёт неполная
  let rows = [], from = 0;
  for (let guard = 0; guard < 10000; guard++) {
    const { data, error } = await page(from);
    if (error) throw new Error(t + ": " + (error.message || error));
    if (!data || !data.length) break;
    rows = rows.concat(data);
    from += data.length;
    if (data.length < PAGE) break;
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
      let rows = dump.tables[t];
      for (let i = 0; i < rows.length; i += 500) {
        for (let attempt = 0; ; attempt++) {
          const { error } = await sb.from(t).upsert(rows.slice(i, i + 500), { onConflict: "id" });
          if (!error) break;
          // в бэкапе есть колонка, которой нет в базе (бэкап из другой версии) — восстанавливаем без неё
          const mm = /Could not find the '([^']+)' column/i.exec(error.message || "");
          if (!mm || attempt >= 15) throw new Error(t + ": " + error.message);
          rows = rows.map((r) => { const c = { ...r }; delete c[mm[1]]; return c; });
        }
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
// дата «ГГГГ-ММ-ДД» без сдвига: строку из поля даты показываем как есть,
// а new Date("2026-10-01") — это полночь по UTC, и западнее Гринвича дата съезжала бы на день назад
const dt = (s) => {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (m) return m[3] + "." + m[2] + "." + m[1];
  const d = new Date(s);
  return isNaN(d) ? String(s) : d.toLocaleDateString("ru-RU");
};
// сегодняшняя дата по местному времени. Раньше бралась дата по UTC (toISOString): в Ташкенте (UTC+5)
// с 00:00 до 05:00 операции записывались вчерашним числом, а «Этот месяц» начинался с последнего дня прошлого месяца
const localIso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const today = () => localIso(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localIso(d); };
// отгрузка: долг поставщику появляется только после «Отгрузить товар». Старые позиции (без пометки) считаются отгруженными
const isShipped = (i) => !!i && i.shipped !== false;
// убранные статусы: у старых объектов показываются как есть, в списках выбора — только если объект уже в таком статусе
const OLD_STATUSES = [
  { id: "shipped", label: "Отгружено (старый статус)", c: "var(--t-neutral)" },
  { id: "settled", label: "Рассчитано (старый статус)", c: "var(--t-neutral)" },
];
const stById = (id) => OBJ_STATUSES.find((s) => s.id === id) || OLD_STATUSES.find((s) => s.id === id) || OBJ_STATUSES[0];
const statusOptions = (cur) => { const old = OLD_STATUSES.find((s) => s.id === cur); return old ? [...OBJ_STATUSES, old] : OBJ_STATUSES; };
const opLabel = (id) => (OP_TYPES.find((o) => o.id === id) || {}).label || id;

// операции по объектам — индекс строится один раз на каждый загруженный список операций
// (раньше для каждого объекта перебирался весь список: при сотнях объектов и тысячах операций это заметно тормозило)
const _opsIdx = new WeakMap();
const opsOf = (ops, objId) => {
  if (!ops || !ops.length) return [];
  let m = _opsIdx.get(ops);
  if (!m) { m = new Map(); ops.forEach((x) => { if (x.object_id) { let a = m.get(x.object_id); if (!a) m.set(x.object_id, (a = [])); a.push(x); } }); _opsIdx.set(ops, m); }
  return m.get(objId) || [];
};
function calcObject(obj, ops) {
  const items = obj.items || [];
  let sale = 0, cost = 0;
  items.forEach((i) => { sale += (i.qty || 0) * (i.price || 0); cost += (i.qty || 0) * (i.cost || 0); });
  const o = opsOf(ops, obj.id).filter((x) => !x.voided);
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
    clientDebt: round2(saleNet - paidClient), // округление: без «долга» 0,0000001 от сложения дробных сумм
    supplierDebt: Math.max(0, round2(costNet - paidSup)),
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
    (ob.items || []).forEach((i) => { if (i.supplier_id === sup.id && !i.from_warehouse && isShipped(i)) purchases += (i.qty || 0) * (i.cost || 0); });
  });
  const ids = supplierReturnIds(ops, whMoves);
  const o = ops.filter((x) => !x.voided && x.supplier_id === sup.id);
  // закупка на Склад Thermo вручную — тоже долг поставщику
  purchases += o.filter((x) => x.type === "wh_purchase").reduce((a, x) => a + (x.cost_amount || 0), 0);
  const paid = o.filter((x) => x.type === "supplier_payment").reduce((a, x) => a + (x.amount || 0), 0);
  const returns = o.filter((x) => x.type === "return" && ids.has(x.id)).reduce((a, x) => a + (x.cost_amount || 0), 0);
  const balance = round2(purchases - returns - paid); // < 0 — переплата (аванс поставщику)
  return { purchases: round2(purchases), paid: round2(paid), returns: round2(returns), balance, debt: Math.max(0, balance) };
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
// строка склада для товара: по product_id, а у позиций «вручную» (товара нет в базе) — по названию.
// Раньше для ручной позиции шёл запрос product_id = null → ошибка базы на экране и новая строка-дубль на складе.
async function whFind(productId, name, size) {
  const r = productId ? await db.from("warehouse").select().eq("product_id", productId) : await db.from("warehouse").select().eq("name", name || "");
  if (r.error) return { error: r.error };
  const list = (r.data || []).filter((w) => (productId ? true : !w.product_id && String(w.size || "") === String(size || "")));
  return { row: list[0] || null };
}
// возвращает количество позиций, которые не удалось оприходовать (ошибка уже показана на экране)
async function warehouseIn(returnOps, sourceObjName) {
  let failed = 0;
  for (const op of returnOps) {
    const qty = Number(op.qty) || 0;
    if (qty <= 0) continue;
    const unitCost = (op.cost_amount || 0) / qty, unitPrice = (op.amount || 0) / qty;
    const f = await whFind(op.product_id, op.product_name, op.size);
    if (f.error) { failed++; continue; }
    let r;
    if (f.row) {
      // возврат не меняет текущую себестоимость и цену склада — только количество
      // (клиенту возврат засчитан по цене, по которой товар ему выдали; это в операции возврата)
      r = await db.from("warehouse").update({ qty: round2((Math.max(0, Number(f.row.qty) || 0)) + qty) }).eq("id", f.row.id);
    } else {
      // новая строка склада — по текущей себестоимости/цене товара из базы; если товара в базе нет — по позиции
      let cur = null;
      if (op.product_id) { const pr = await db.from("products").select().eq("id", op.product_id); cur = pr.data && pr.data[0] ? pr.data[0] : null; }
      const curCost = cur && Number(cur.cost) > 0 ? Number(cur.cost) : unitCost;
      const curPrice = cur && retailOf(cur) > 0 ? retailOf(cur) : unitPrice;
      r = await db.from("warehouse").insert(cleanUuids({
        product_id: op.product_id || null, name: op.product_name, qty,
        cost: round2(curCost), price: round2(curPrice),
        supplier_id: op.supplier_id || null, unit: op.unit || "шт", size: op.size || "",
      }));
    }
    if (r.error) { failed++; continue; }
    await db.from("wh_moves").insert(cleanUuids({
      product_id: op.product_id || null, name: op.product_name, qty, dir: "in",
      object_id: op.object_id || null, object_name: sourceObjName, op_date: op.op_date || today(), user: op.user || curUserName(), note: "возврат с объекта",
    }));
  }
  return failed;
}
// отгрузка со склада: остаток берём свежий из базы (на экране он мог устареть). Возвращает число ошибок.
// строки, которые есть на Складе Thermo, берём сначала со склада (fromWh !== false), остаток — у поставщика.
// mk(row, qty, whRow|null) → позиция объекта. Возвращает { items, whOut } (whOut — что списать со склада после сохранения).
function splitByWarehouse(rows, warehouse, mk) {
  const left = {}, items = [], whOut = [];
  rows.forEach((r) => {
    let q = Number(r.qty) || 0;
    if (r.product_id && r.fromWh !== false) {
      const w = (warehouse || []).find((x) => x.product_id === r.product_id && Number(x.qty) > 0);
      if (w) {
        if (left[w.id] == null) left[w.id] = Number(w.qty) || 0;
        const take = round2(Math.min(q, left[w.id]));
        if (take > 0) { items.push(mk(r, take, w)); whOut.push({ row: w, qty: take }); left[w.id] = round2(left[w.id] - take); q = round2(q - take); }
      }
    }
    if (q > 0) items.push(mk(r, q, null));
  });
  return { items, whOut };
}
const whItemPatch = (w) => ({ from_warehouse: true, cost: Number(w.cost) || 0, supplier_id: w.supplier_id || null, source_text: "со склада Thermo", shipped: undefined });
async function warehouseOut(lines, targetObj, user) {
  let failed = 0;
  for (const l of lines) {
    const cur = await db.from("warehouse").select().eq("id", l.row.id);
    const have = cur.data && cur.data[0] ? Number(cur.data[0].qty) || 0 : Number(l.row.qty) || 0;
    const r = await db.from("warehouse").update({ qty: Math.max(0, round2(have - l.qty)) }).eq("id", l.row.id);
    if (r.error) { failed++; continue; }
    await db.from("wh_moves").insert(cleanUuids({
      product_id: l.row.product_id || null, name: l.row.name, qty: l.qty, dir: "out",
      object_id: targetObj.id, object_name: targetObj.name, op_date: today(), user, note: "отгрузка на объект",
    }));
  }
  return failed;
}
/* Позиции объекта (items) меняются по СВЕЖЕЙ версии из базы, а не по копии с экрана:
   если другой сотрудник только что добавил поставку или поменял количество, его изменения не затрутся.
   change(items, obj) → новый список позиций. extra — другие поля объекта (статус и т.п.).
   Возвращает { obj } при успехе или { error } (ошибка уже показана на экране). */
async function updateObjectItems(objId, change, extra = {}) {
  const r = await db.from("objects").select().eq("id", objId);
  if (r.error) return { error: r.error };
  const cur = r.data && r.data[0];
  if (!cur) { const e = { message: "объект не найден — возможно, его удалили. Обновите страницу." }; dbReport("objects", e); return { error: e }; }
  const items = change(Array.isArray(cur.items) ? cur.items : [], cur);
  const u = await db.from("objects").update({ ...extra, items }).eq("id", objId);
  if (u.error) return { error: u.error };
  return { obj: { ...cur, ...extra, items } };
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
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); // сразу освобождать нельзя — Firefox не успевает начать скачивание
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
// шрифты: текст — Baskerville Old Face, числа — Times New Roman; красный — для возвратов
// стили: 0 обычный, 1 заголовок 14 жирный, 2 жирный, 3 шапка, 4 текст в рамке, 5 число в рамке, 6 сумма в рамке,
//        7 подпись итога (жирный, вправо, рамка), 8 сумма итога (жирная, рамка), 9 по центру в рамке;
//        10–14 — те же для чисел (Times New Roman), 15–21 — красные варианты
const XL_FONT = (name, b, sz, red, it) => "<font>" + (b ? "<b/>" : "") + (it ? "<i/>" : "") + '<sz val="' + sz + '"/>' + (red === 2 ? '<color rgb="FF00873C"/>' : red ? '<color rgb="FFC00000"/>' : "") + '<name val="' + name + '"/></font>';
const XL_TXT = "Baskerville Old Face", XL_NUM = "Times New Roman";
const XL_XF = (num, font, border, extra = "", align = "") => '<xf numFmtId="' + num + '" fontId="' + font + '" fillId="' + (extra === "fill" ? 2 : 0) + '" borderId="' + border + '" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' + (align ? "<alignment " + align + "/>" : "") + "</xf>";
const XL_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.00##"/></numFmts>'
  + '<fonts count="12">' + XL_FONT(XL_TXT, 0, 11) + XL_FONT(XL_TXT, 1, 11) + XL_FONT(XL_TXT, 1, 14) + XL_FONT(XL_NUM, 0, 11) + XL_FONT(XL_NUM, 1, 11)
  + XL_FONT(XL_TXT, 0, 11, 1) + XL_FONT(XL_NUM, 0, 11, 1) + XL_FONT(XL_TXT, 1, 11, 1) + XL_FONT(XL_NUM, 1, 11, 1)
  + XL_FONT(XL_NUM, 0, 11, 2) + XL_FONT(XL_NUM, 1, 11, 2) + XL_FONT(XL_TXT, 1, 28, 1, 1) + '</fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E8E8"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="32">'
  + XL_XF(0, 0, 0)                                                     // 0
  + XL_XF(0, 2, 0)                                                     // 1 заголовок
  + XL_XF(0, 1, 0)                                                     // 2 жирный
  + XL_XF(0, 1, 1, "fill", 'horizontal="center" vertical="center" wrapText="1"') // 3 шапка
  + XL_XF(0, 0, 1, "", 'vertical="center" wrapText="1"')                // 4 текст
  + XL_XF(0, 0, 1, "", 'horizontal="center" vertical="center"')         // 5 число
  + XL_XF(164, 0, 1, "", 'vertical="center"')                           // 6 сумма
  + XL_XF(0, 1, 1, "", 'horizontal="right" vertical="center"')          // 7 подпись итога
  + XL_XF(164, 1, 1)                                                    // 8 сумма итога
  + XL_XF(0, 0, 1, "", 'horizontal="center" vertical="center"')         // 9 по центру
  + XL_XF(0, 3, 1, "", 'horizontal="center" vertical="center"')         // 10 = 5 Times
  + XL_XF(164, 3, 1, "", 'vertical="center"')                           // 11 = 6 Times
  + XL_XF(164, 4, 1)                                                    // 12 = 8 Times
  + XL_XF(0, 3, 1, "", 'horizontal="center" vertical="center"')         // 13 = 9 Times
  + XL_XF(0, 3, 0)                                                      // 14 = 0 Times
  + XL_XF(0, 5, 1, "", 'vertical="center" wrapText="1"')                // 15 = 4 красный
  + XL_XF(0, 6, 1, "", 'horizontal="center" vertical="center"')         // 16 = 10 красный
  + XL_XF(164, 6, 1, "", 'vertical="center"')                           // 17 = 11 красный
  + XL_XF(0, 7, 1, "", 'horizontal="right" vertical="center"')          // 18 = 7 красный
  + XL_XF(164, 8, 1)                                                    // 19 = 12 красный
  + XL_XF(0, 6, 1, "", 'horizontal="center" vertical="center"')         // 20 = 13 красный
  + XL_XF(0, 5, 1, "", 'horizontal="center" vertical="center"')         // 21 = 9 красный
  + XL_XF(0, 7, 0)                                                      // 22 = 2 красный (раздел)
  + XL_XF(164, 9, 1, "", 'vertical="center"')                           // 23 = 11 зелёный (прибыль)
  + XL_XF(164, 10, 1)                                                   // 24 = 12 зелёный жирный
  + XL_XF(0, 11, 1, "", 'horizontal="center" vertical="center"')         // 25 шапка-логотип «Thermo Engineering»
  + XL_XF(165, 3, 1, "", 'vertical="center"')                           // 26 точная цена (до 4 знаков)
  + XL_XF(165, 6, 1, "", 'vertical="center"')                           // 27 = 26 красный
  + XL_XF(0, 1, 0, "", 'horizontal="center" vertical="center"')         // 28 итог внизу: подпись (жирный, по центру, без рамки)
  + XL_XF(164, 4, 0, "", 'vertical="center"')                           // 29 итог внизу: сумма (жирная, без рамки)
  + XL_XF(0, 7, 0, "", 'horizontal="center" vertical="center"')         // 30 = 28 красный
  + XL_XF(164, 8, 0, "", 'vertical="center"')                           // 31 = 29 красный
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
const XL_NUMSTYLE = { 0: 14, 5: 10, 6: 11, 8: 12, 9: 13 };
const XL_REDSTYLE = { 2: 22, 4: 15, 9: 21, 7: 18, 10: 16, 11: 17, 12: 19, 13: 20, 26: 27, 28: 30, 29: 31 };
const XL_GREENSTYLE = { 11: 23, 12: 24 };
const XL_BRAND = "Thermo Engineering";
function xlSheetXml(rows0, cols, types, opt = {}) {
  // каждая выгрузка начинается с шапки «Thermo Engineering»
  const rows = [{ k: "brand" }, ...rows0];
  const n = cols.length, merges = [];
  const green = new Set(opt.green || []); // колонки, где числа зелёные (например «Прибыль»)
  let red = false;
  const cell = (r, c, v, s) => {
    const ref = xlCol(c) + (r + 1);
    const isNum = typeof v === "number" && isFinite(v);
    // числа и строки только из цифр (даты, телефоны) — шрифтом для цифр
    if ((isNum || (typeof v === "string" && /^[\d\s.,:\/+\-−]+$/.test(v) && /\d/.test(v))) && XL_NUMSTYLE[s] != null) s = XL_NUMSTYLE[s];
    if (red && XL_REDSTYLE[s] != null) s = XL_REDSTYLE[s];
    else if (!red && green.has(c) && XL_GREENSTYLE[s] != null && !(typeof v === "number" && v < 0)) s = XL_GREENSTYLE[s];
    if (v === "" || v == null) return '<c r="' + ref + '" s="' + s + '"/>';
    if (isNum) return '<c r="' + ref + '" s="' + s + '"><v>' + v + "</v></c>";
    return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + xlEsc(v) + "</t></is></c>";
  };
  const body = rows.map((row, r) => {
    const k = row.k, v = row.v || [];
    red = !!row.red;
    let cs = "";
    if (k === "title" || k === "info" || k === "section") {
      cs = cell(r, 0, v[0], k === "title" ? 1 : k === "section" ? 2 : 0);
      if (n > 1) merges.push("A" + (r + 1) + ":" + xlCol(n - 1) + (r + 1));
    } else if (k === "brand") {
      cs = cols.map((_, c) => cell(r, c, c === 0 ? XL_BRAND : "", 25)).join("");
      if (n > 1) merges.push("A" + (r + 1) + ":" + xlCol(n - 1) + (r + 1));
    } else if (k === "head") {
      cs = v.map((x, c) => cell(r, c, x, 3)).join("");
    } else if (k === "row") {
      cs = cols.map((_, c) => { const t = types[c] || "t"; return cell(r, c, v[c], t === "p" ? (typeof v[c] === "number" ? 26 : 6) : t === "m" ? 6 : t === "n" ? 5 : t === "c" ? 9 : 4); }).join("");
    } else if (k === "sum") {
      // итоговая строка таблицы: подписи жирно вправо, числа жирно
      cs = cols.map((_, c) => { const x = v[c]; return cell(r, c, x, typeof x === "number" ? 8 : x ? 7 : 0); }).join("");
    } else if (k === "ftotal") {
      // итоговый блок внизу (шаблон клиента): подпись по центру колонок 3…n-1, сумма в последней, без рамок
      cs = cell(r, 0, "", 0) + cell(r, 1, "", 0);
      for (let c = 2; c < n - 1; c++) cs += cell(r, c, c === 2 ? v[0] : "", 28);
      cs += cell(r, n - 1, v[1], 29);
      if (n > 4) merges.push("C" + (r + 1) + ":" + xlCol(n - 2) + (r + 1));
    } else if (k === "total") {
      cs = cell(r, 0, "", 0);
      for (let c = 1; c < n - 1; c++) cs += cell(r, c, c === 1 ? v[0] : "", 7);
      cs += cell(r, n - 1, v[1], 8);
      if (n > 3) merges.push("B" + (r + 1) + ":" + xlCol(n - 2) + (r + 1));
    }
    // объединение ячеек внутри строки таблицы: merge: [[с, по], …] (номера колонок с 0)
    if ((k === "head" || k === "row" || k === "sum") && row.merge) row.merge.forEach(([a, b]) => merges.push(xlCol(a) + (r + 1) + ":" + xlCol(b) + (r + 1)));
    const ht = k === "brand" ? ' ht="42" customHeight="1"' : k === "title" ? ' ht="22" customHeight="1"' : "";
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
// несколько листов: sheets = [{ name, rows, cols, types, opt }]
function styledXlsxBook(sheets) {
  const used = new Set();
  const names = sheets.map((sh, i) => {
    let nm = String(sh.name || "Лист" + (i + 1)).replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
    while (used.has(nm)) nm = (nm.slice(0, 28) + " " + (i + 1));
    used.add(nm); return xlEsc(nm);
  });
  const ids = sheets.map((_, i) => i + 1);
  return xlZip([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ids.map((i) => '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + ids.map((i) => '<sheet name="' + names[i - 1] + '" sheetId="' + i + '" r:id="rId' + i + '"/>').join("") + '</sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ids.map((i) => '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + i + '.xml"/>').join("") + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ["xl/styles.xml", XL_STYLES],
    ...sheets.map((sh, i) => ["xl/worksheets/sheet" + (i + 1) + ".xml", xlSheetXml(sh.rows, sh.cols, sh.types, sh.opt)]),
  ]);
}
function styledXlsxBlob(sheetName, rows, cols, types, opt) {
  return styledXlsxBook([{ name: sheetName || "Лист1", rows, cols, types, opt }]);
}
// простая таблица (массив массивов) → строки генератора: 1-я строка — шапка, [] — пустая, [текст] — заголовок раздела
function xlFromTable(name, table) {
  const n = Math.max(1, ...table.map((r) => r.length));
  const types = [], cols = [];
  for (let c = 0; c < n; c++) {
    const nums = table.slice(1).map((r) => r[c]).filter((x) => typeof x === "number");
    types.push(nums.length ? (nums.some((x) => !Number.isInteger(x)) ? "m" : "n") : "t");
    cols.push(Math.min(48, Math.max(10, ...table.map((r) => String(r[c] == null ? "" : r[c]).length + 3))));
  }
  const rows = table.map((r, i) => {
    if (!r.length) return { k: "blank" };
    if (r.length === 1 && i > 0) return { k: "section", v: [r[0]] };
    if (i === 0) return { k: "head", v: [...r, ...Array(n - r.length).fill("")] };
    return { k: "row", v: r };
  });
  return { name, rows, cols, types };
}
function downloadBlob(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// скачать таблицу с рамками; при ошибке — CSV
function downloadStyledXLSX(filename, sheetName, rows, cols, types, opt) {
  try {
    const blob = styledXlsxBlob(sheetName, rows, cols, types, opt);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return "xlsx";
  } catch (e) {
    console.error(e);
    try { downloadCSV(filename.replace(/\.xlsx$/i, ".csv"), rows.map((r) => (r.k === "total" || r.k === "ftotal" ? ["", r.v[0], "", "", "", r.v[1]] : r.v || []))); return "csv"; } catch (e2) { console.error(e2); return false; }
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
// браузер (особенно Яндекс) по словам «Имя», «Телефон», «Адрес» в подписи поля включает свои подсказки
// (сохранённые номера/имена). Невидимый символ внутри этих слов не даёт браузеру их распознать, текст выглядит так же.
const NO_AUTOFILL_WORDS = /(тел)(ефон)|(им)(я)|(фам)(илия)|(отч)(ество)|(адр)(ес)|(поч)(та)|(e-?ma)(il)|(гор)(од)|(инд)(екс)/gi;
const noAutofillLabel = (t) => (typeof t === "string" ? t.replace(NO_AUTOFILL_WORDS, (m) => m.slice(0, Math.ceil(m.length / 2)) + "\u2060" + m.slice(Math.ceil(m.length / 2))) : t);
const Fld = ({ label, children }) => (<div className="fld"><label>{noAutofillLabel(label)}</label>{children}</div>);
// всем полям ввода в системе — отключаем автозаполнение браузера (кроме пароля на входе)
let NO_AF_SEQ = 0;
const noAutofillInput = (el) => {
  if (!el || el.tagName !== "INPUT" || el.dataset.teAf) return;
  const t = (el.type || "text").toLowerCase();
  if (["password", "hidden", "checkbox", "radio", "file", "date", "range", "color", "submit", "button"].includes(t)) return;
  el.dataset.teAf = "1";
  el.setAttribute("autocomplete", "off");
  el.setAttribute("autocorrect", "off");
  el.setAttribute("data-lpignore", "true");
  el.setAttribute("data-form-type", "other");
  if (!el.name || /tel|phone|mail|name|addr|fio|city|zip|login|user/i.test(el.name)) el.setAttribute("name", "te_f" + ++NO_AF_SEQ);
  const ph = el.getAttribute("placeholder");
  if (ph && NO_AUTOFILL_WORDS.test(ph)) { NO_AUTOFILL_WORDS.lastIndex = 0; el.setAttribute("placeholder", noAutofillLabel(ph)); }
  NO_AUTOFILL_WORDS.lastIndex = 0;
};
function NoAutofillGuard() {
  useEffect(() => {
    const scan = (root) => { if (root.tagName === "INPUT") noAutofillInput(root); if (root.querySelectorAll) root.querySelectorAll("input").forEach(noAutofillInput); };
    scan(document.body);
    const mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); })));
    mo.observe(document.body, { childList: true, subtree: true });
    const onFocus = (e) => noAutofillInput(e.target);
    document.addEventListener("focusin", onFocus, true);
    return () => { mo.disconnect(); document.removeEventListener("focusin", onFocus, true); };
  }, []);
  return null;
}
// бейдж: старые яркие hex-цвета переводятся в спокойные тона темы (читаются и в светлой, и в тёмной теме)
const BADGE_TONE = { "#fff": "--t-strong", "#ffffff": "--t-strong", "#9a9a9a": "--t-neutral", "#d6d6d6": "--t-neutral", "#ffb020": "--t-warn", "#ff707b": "--t-bad", "#ff4d5e": "--t-bad", "#3ddc7d": "--t-ok", "#4db8ff": "--t-info" };
const Badge = ({ c, children }) => {
  const col = String(c || "").startsWith("var(") ? c : BADGE_TONE[String(c || "").toLowerCase()] ? "var(" + BADGE_TONE[String(c).toLowerCase()] + ")" : c;
  return <span className="bdg" style={{ color: col, borderColor: "color-mix(in srgb, " + col + " 35%, transparent)", background: "color-mix(in srgb, " + col + " 9%, transparent)" }}>{children}</span>;
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
// поле «Клиент» с подсказками: клиенты из прошлых объектов (имя · телефон); выбор подставляет и телефон
function ClientInput({ value, objects, onChange, onPick, onEnter, phoneMode = false }) {
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(-1);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const clients = useMemo(() => {
    const m = new Map();
    objects.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).forEach((o) => {
      if (!String(o.client || "").trim()) return;
      const k = clientKey(o);
      const c = m.get(k);
      // объекты идут от новых к старым: мастер — из последнего объекта клиента, где он указан
      if (c) { c.n++; if (!c.phone && o.phone) c.phone = o.phone; if (!c.master_id && o.master_id) { c.master_id = o.master_id; c.master = o.master || ""; } }
      else m.set(k, { k, client: String(o.client).trim(), phone: o.phone || "", n: 1, last: o.name, master_id: o.master_id || "", master: o.master_id ? o.master || "" : "" });
    });
    return [...m.values()];
  }, [objects]);
  const q = String(value || "").trim().toLowerCase(), qd = q.replace(/\D/g, "");
  const hits = clients.filter((c) => (phoneMode ? c.phone : true) && (!q || (!phoneMode && c.client.toLowerCase().includes(q)) || (qd.length >= (phoneMode ? 1 : 3) && String(c.phone).replace(/\D/g, "").includes(qd)) || (phoneMode && !qd && c.client.toLowerCase().includes(q)))).slice(0, 8);
  const same = (c) => (phoneMode ? String(c.phone).replace(/\D/g, "") === qd && !!qd : c.client.toLowerCase() === q);
  const pick = (c) => { onPick(c); setOpen(false); setAct(-1); };
  return (
    <div ref={box} style={{ position: "relative" }}>
      <input className="inp" value={value || ""} autoComplete="off" autoCorrect="off" spellCheck={false} name={phoneMode ? "te_cl_n2" : "te_cl_n1"} id={phoneMode ? "te_cl_n2" : "te_cl_n1"} data-lpignore="true" data-form-type="other" placeholder={phoneMode ? "" : clients.length ? "начните вводить — список прошлых клиентов" : ""}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setAct(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); setOpen(true); setAct((i) => Math.min(hits.length - 1, i + 1)); }
          else if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); setAct((i) => Math.max(0, i - 1)); }
          else if (e.key === "Escape") setOpen(false);
          else if (e.key === "Enter") { e.preventDefault(); if (open && act >= 0 && hits[act]) pick(hits[act]); else { setOpen(false); onEnter && onEnter(e.target); } }
        }} />
      {open && hits.length > 0 && !(hits.length === 1 && same(hits[0])) && (
        <div style={{ position: "absolute", top: "105%", left: 0, right: 0, backgroundColor: "var(--panel)", border: "1px solid var(--acc)", borderRadius: 8, zIndex: 1000, boxShadow: "0 16px 44px rgba(0,0,0,.18)", overflow: "hidden", maxHeight: 300, overflowY: "auto" }}>
          <div className="xs mut" style={{ padding: "6px 11px", borderBottom: "1px solid var(--line)" }}>Клиенты из прошлых объектов</div>
          {hits.map((c, i) => (
            <div key={c.k} className="clk pick-row" style={{ padding: "7px 11px", borderBottom: "1px solid var(--line)", backgroundColor: i === act ? "var(--acc-tint)" : "var(--panel)" }}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{phoneMode ? c.phone : c.client}</div>
              <div className="xs mut">{[phoneMode ? c.client : c.phone, "объектов: " + c.n, c.last].filter(Boolean).join(" · ")}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// выбор мастера в том же виде, что и подсказки клиента/телефона: поиск + список (имя · телефон · специализация)
function MasterPicker({ masters, value, onChange, onAdd }) {
  const cur = masters.find((m) => m.id === value) || null;
  const [q, setQ] = useState(cur ? cur.name : "");
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(-1);
  useEffect(() => { setQ(cur ? cur.name : ""); }, [value, cur && cur.name]);
  const list = masters.filter((m) => m.status === "active");
  const qq = q.trim().toLowerCase();
  const typed = !cur || qq !== String(cur.name).toLowerCase();
  const hits = list.filter((m) => !typed || !qq || [m.name, m.phone, m.specialty].filter(Boolean).join(" ").toLowerCase().includes(qq));
  const rows = [...hits.map((m) => ({ m })), { add: true }];
  const pick = (r) => { setOpen(false); setAct(-1); if (r.add) { onAdd(); return; } onChange(r.m); setQ(r.m.name); };
  return (
    <div style={{ position: "relative" }}>
      <input className="inp" value={q} autoComplete="off" autoCorrect="off" spellCheck={false} name="te_ms_n" data-lpignore="true" data-form-type="other" placeholder="— выберите мастера —"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setAct(-1); if (!e.target.value.trim() && cur) onChange(null); }}
        onFocus={(e) => { setOpen(true); e.target.select(); }}
        onBlur={() => setTimeout(() => { setOpen(false); setQ(cur ? cur.name : ""); }, 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAct((i) => Math.min(rows.length - 1, i + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAct((i) => Math.max(0, i - 1)); }
          else if (e.key === "Escape") setOpen(false);
          else if (e.key === "Enter") { e.preventDefault(); const r = act >= 0 ? rows[act] : hits.length === 1 && typed ? rows[0] : null; if (r) pick(r); else setOpen(false); }
        }} />
      {open && (
        <div style={{ position: "absolute", top: "105%", left: 0, right: 0, backgroundColor: "var(--panel)", border: "1px solid var(--acc)", borderRadius: 8, zIndex: 1000, boxShadow: "0 16px 44px rgba(0,0,0,.18)", overflow: "hidden", maxHeight: 320, overflowY: "auto" }}>
          <div className="xs mut" style={{ padding: "6px 11px", borderBottom: "1px solid var(--line)" }}>{hits.length ? "Мастера" : "Не найдено"}</div>
          {rows.map((r, i) => (
            <div key={r.add ? "__add" : r.m.id} className="clk pick-row" style={{ padding: "7px 11px", borderBottom: "1px solid var(--line)", backgroundColor: i === act || (!r.add && r.m.id === value) ? "var(--acc-tint)" : "var(--panel)" }}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
              {r.add ? <div style={{ fontWeight: 600, fontSize: 13, color: "var(--acc)" }}>+ добавить нового мастера…</div> : <>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.m.name}{r.m.id === value ? " ✓" : ""}</div>
                {(r.m.phone || r.m.specialty) && <div className="xs mut">{[r.m.phone, r.m.specialty].filter(Boolean).join(" · ")}</div>}
              </>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function PersonSelect({ value, onChange, placeholder = "—", compact = false, hideEmpty = false }) {
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
      {hideEmpty ? <option value="" disabled hidden>{placeholder}</option> : <option value="">{placeholder}</option>}
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
  if (!op || (op.type && !isPayType(op.type) && op.type !== "bonus")) return { id: null, cur: null, uzs: 0, rate: 0 }; // начисление бонуса тоже может хранить способ (в отчёт по деньгам не входит) // у возвратов/скидок reason — это причина
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

/* Вопрос-подтверждение из любого места: const ok = await askConfirm({ title, text, items, ok }) */
let _confirmSet = null;
function askConfirm(o) {
  return new Promise((res) => { if (!_confirmSet) return res(window.confirm(o.title + "\n\n" + (o.text || ""))); _confirmSet({ ...o, res }); });
}
/* Единый вид выпадающих списков: вместо системного списка браузера у всех <select class="inp"> открывается
   наш список (как у подсказок клиента/мастера). Сам <select> остаётся настоящим — значение меняется через него
   и событие change, поэтому все обработчики onChange работают как раньше. На телефоне — системный список. */
const SEL_SETTER = typeof HTMLSelectElement !== "undefined" ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set : null;
function SelectPopupHost() {
  const [st, setSt] = useState(null); // { sel, rect, opts, q, act }
  const stRef = useRef(null);
  stRef.current = st;
  const listRef = useRef(null);
  const fine = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(pointer: fine)").matches : true;
  const optsOf = (sel) => [...sel.options].filter((o) => !o.hidden).map((o) => ({
    value: o.value, label: o.textContent, disabled: o.disabled,
    group: o.parentElement && o.parentElement.tagName === "OPTGROUP" ? o.parentElement.label : "",
  }));
  const open = (sel) => {
    const opts = optsOf(sel);
    if (!opts.length) return;
    const cur = opts.findIndex((o) => o.value === sel.value);
    setSt({ sel, rect: sel.getBoundingClientRect(), opts, q: "", act: cur >= 0 ? cur : opts.findIndex((o) => !o.disabled) });
  };
  const close = (refocus) => { const s0 = stRef.current; setSt(null); if (refocus && s0 && s0.sel && s0.sel.isConnected) s0.sel.focus(); };
  const choose = (o) => {
    const s0 = stRef.current;
    if (!s0 || !o || o.disabled) return;
    const sel = s0.sel;
    close(true);
    if (sel.value !== o.value && SEL_SETTER) { SEL_SETTER.call(sel, o.value); sel.dispatchEvent(new Event("change", { bubbles: true })); }
  };
  const shown = (s0) => {
    const q = (s0.q || "").trim().toLowerCase();
    return q ? s0.opts.filter((o) => o.label.toLowerCase().includes(q)) : s0.opts;
  };
  useEffect(() => {
    if (!fine) return;
    const isOurs = (t) => t && t.tagName === "SELECT" && t.classList.contains("inp") && !t.multiple && !t.disabled && !t.hasAttribute("data-native");
    const onDown = (e) => {
      const s0 = stRef.current;
      if (isOurs(e.target) && e.button === 0) {
        e.preventDefault();
        if (s0 && s0.sel === e.target) { close(true); return; }
        e.target.focus();
        open(e.target);
        return;
      }
      if (s0 && listRef.current && !listRef.current.contains(e.target)) close(false);
    };
    const onKey = (e) => {
      const s0 = stRef.current;
      if (!s0) {
        // открыть: ↓ / пробел / Alt+↓ на выбранном списке (Enter оставляем для перехода между полями)
        if (isOurs(e.target) && (e.key === "ArrowDown" || e.key === " " || (e.altKey && e.key === "ArrowDown"))) { e.preventDefault(); open(e.target); }
        return;
      }
      const list = shown(s0);
      const step = (d) => { let i = s0.act; for (let k = 0; k < list.length; k++) { i = (i + d + list.length) % list.length; if (!list[i].disabled) break; } setSt({ ...s0, act: i }); };
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); step(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); step(-1); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); choose(list[s0.act]); }
      else if (e.key === "Escape" || e.key === "Tab") { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); } close(e.key === "Escape"); }
      else if (e.key === "Backspace") { if (e.target === s0.sel) { e.preventDefault(); setSt({ ...s0, q: s0.q.slice(0, -1), act: 0 }); } }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && e.target === s0.sel) { e.preventDefault(); const q = s0.q + e.key; const l2 = shown({ ...s0, q }); setSt({ ...s0, q, act: Math.max(0, l2.findIndex((o) => !o.disabled)) }); }
    };
    const onScroll = (e) => { const s0 = stRef.current; if (s0 && !(listRef.current && listRef.current.contains(e.target))) close(false); };
    const onResize = () => { if (stRef.current) close(false); };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [fine]);
  useEffect(() => {
    if (!st || !listRef.current) return;
    const el = listRef.current.querySelector("[data-act='1']");
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [st && st.act, st && st.q]);
  if (!st) return null;
  const list = shown(st);
  const r = st.rect, vh = window.innerHeight, vw = window.innerWidth;
  const maxH = 320, below = vh - r.bottom - 8, up = below < 200 && r.top > below;
  const width = Math.max(r.width, 200);
  const left = Math.min(Math.max(8, r.left), vw - width - 8);
  const style = { position: "fixed", left, width, zIndex: 3000, backgroundColor: "var(--panel)", border: "1px solid var(--acc)", borderRadius: 8,
    boxShadow: "0 16px 44px rgba(0,0,0,.25)", overflow: "hidden", display: "flex", flexDirection: "column",
    ...(up ? { bottom: vh - r.top + 4, maxHeight: Math.min(maxH, r.top - 8) } : { top: r.bottom + 4, maxHeight: Math.min(maxH, Math.max(160, below)) }) };
  let lastGroup = null;
  return (
    <div ref={listRef} style={style} onMouseDown={(e) => e.preventDefault()}>
      {(st.q || st.opts.length > 10) && <div className="xs mut" style={{ padding: "6px 11px", borderBottom: "1px solid var(--line)" }}>{st.q ? "Поиск: «" + st.q + "» · найдено " + list.length : "Начните печатать для поиска"}</div>}
      <div style={{ overflowY: "auto" }}>
        {list.map((o, i) => {
          const head = o.group && o.group !== lastGroup ? <div key={"g" + i} className="xs mut" style={{ padding: "6px 11px", borderBottom: "1px solid var(--line)", fontWeight: 700 }}>{o.group}</div> : null;
          lastGroup = o.group;
          const isCur = o.value === st.sel.value;
          return (
            <React.Fragment key={i + ":" + o.value}>
              {head}
              <div data-act={i === st.act ? "1" : "0"} className={o.disabled ? "" : "clk pick-row"} onClick={() => choose(o)}
                style={{ padding: "8px 11px", borderBottom: "1px solid var(--line)", fontSize: 13, fontWeight: isCur ? 700 : 500,
                  color: o.disabled ? "var(--mut)" : o.value === "__add__" ? "var(--acc)" : "var(--txt)",
                  backgroundColor: i === st.act ? "var(--acc-tint)" : "var(--panel)", display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label || "—"}</span>
                {isCur && <span style={{ color: "var(--acc)" }}>✓</span>}
              </div>
            </React.Fragment>
          );
        })}
        {!list.length && <div className="xs mut" style={{ padding: "10px 11px" }}>Ничего не найдено</div>}
      </div>
    </div>
  );
}
function ConfirmHost() {
  const [c, setC] = useState(null);
  useEffect(() => { _confirmSet = setC; return () => { _confirmSet = null; }; }, []);
  if (!c) return null;
  const done = (v) => { c.res(v); setC(null); };
  return (
    <div className="modal-bg" style={{ zIndex: 300 }} onMouseDown={(e) => { if (e.target === e.currentTarget) done(false); }}>
      <div className="modal" style={{ maxWidth: 520, marginTop: "14vh" }}>
        <h3 style={{ marginBottom: 10, color: "var(--warn)" }}>⚠ {c.title}</h3>
        {c.text && <p className="sm" style={{ marginBottom: 8 }}>{c.text}</p>}
        {c.items && c.items.length > 0 && (
          <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 8 }}>
            <table className="t"><tbody>{c.items.map((x, i) => <tr key={i}><td className="sm">{x[0]}</td><td className="num sm" style={{ whiteSpace: "nowrap" }}>{x[1]}</td></tr>)}</tbody></table>
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14, gap: 8 }}>
          <button className="btn" autoFocus onClick={() => done(false)}>{c.cancel || "Нет, исправить"}</button>
          <button className="btn dng" onClick={() => done(true)}>{c.ok || "Да, сохранить"}</button>
        </div>
      </div>
    </div>
  );
}
// цена продажи ниже себестоимости — спрашиваем перед сохранением. rows: [{ name, price, cost }]
async function confirmLowPrice(rows) {
  const low = rows.filter((r) => Number(r.cost) > 0 && Number(r.price) < Number(r.cost) - 0.0001);
  if (!low.length) return true;
  return askConfirm({
    title: "Цена продажи ниже себестоимости",
    text: low.length === 1 ? "У этой позиции цена продажи меньше себестоимости — продажа будет в убыток. Сохранить всё равно?" : "У " + low.length + " позиций цена продажи меньше себестоимости — продажа будет в убыток. Сохранить всё равно?",
    items: low.slice(0, 50).map((r) => [r.name || "—", "цена " + money(r.price) + " · себест. " + money(r.cost)]),
  });
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
// текст для поиска товара: название, код, размер, бренд и ПОСТАВЩИК (по «water pro» находятся все товары
// поставщика Water Pro, а не только те, где это слово есть в названии) + слитная версия («waterpro» = «water pro»)
const prodSearchText = (p, supName) => {
  const t = [p.name, p.alt_names, p.code, p.sku, p.size, p.brand, p.category, supName].filter(Boolean).join(" ").toLowerCase().replace(/ё/g, "е");
  return t + " " + t.replace(/[\s\-_."']+/g, "");
};
const searchWords = (q) => q.toLowerCase().replace(/ё/g, "е").trim().split(/\s+/).filter(Boolean);
// остаток на Складе Thermo по товару (product_id → кол-во)
const whQtyMap = (warehouse) => { const m = {}; (warehouse || []).forEach((w) => { if (w.product_id && Number(w.qty) > 0) m[w.product_id] = (m[w.product_id] || 0) + Number(w.qty); }); return m; };
function ProductPicker({ products, onPick, placeholder, suppliers = [], closeOnPick = false, whQty = null }) {
  // показываем ВСЕ найденные товары (без лимита). Список прокручивается, рисуются только видимые строки.
  // Поиск по словам: «труба 25» найдёт «ХВС ТРУБА PN16 - 25» (все слова, в любом порядке).
  const ROW = 50, BOX_H = 380;
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [top, setTop] = useState(0);
  const listRef = useRef(null);
  const supName = useMemo(() => { const m = {}; suppliers.forEach((s) => { m[s.id] = s.name; }); return m; }, [suppliers]);
  const idx = useMemo(() => products.map((p) => prodSearchText(p, supName[p.supplier_id])), [products, supName]);
  // фильтр по поставщику: выбран поставщик — показываются только его товары (без ввода текста — все его товары)
  const [sf, setSf] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const active = q.trim().length >= 2 || (!!sf && open);
  const hits = useMemo(() => {
    const words = searchWords(q);
    if (!active) return [];
    const out = [];
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      if (p.status === "archive") continue;
      if (sf && p.supplier_id !== sf) continue;
      const s = idx[i];
      if (words.every((w) => s.includes(w))) out.push(p);
    }
    return out;
  }, [q, products, idx, sf, active]);
  useEffect(() => { setTop(0); if (listRef.current) listRef.current.scrollTop = 0; }, [q, sf]);
  // при навигации стрелками держим активную строку в видимой области
  useEffect(() => {
    const el = listRef.current;
    if (activeIdx < 0 || !el) return;
    const y = activeIdx * ROW;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ROW > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW - el.clientHeight;
  }, [activeIdx]);
  const pick = (p) => { onPick(p); setQ(""); setActiveIdx(-1); if (closeOnPick) setOpen(false); };
  const supCount = useMemo(() => { const m = {}; products.forEach((p) => { if (p.supplier_id && p.status !== "archive") m[p.supplier_id] = (m[p.supplier_id] || 0) + 1; }); return m; }, [products]);
  const onKeyDown = (e) => {
    if (!hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "PageDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 7, hits.length - 1)); }
    else if (e.key === "PageUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 7, 0)); }
    else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); pick(hits[activeIdx]); }
    else if (e.key === "Escape") { setQ(""); setActiveIdx(-1); setOpen(false); }
  };
  const start = Math.max(0, Math.floor(top / ROW) - 8);
  const end = Math.min(hits.length, Math.ceil((top + BOX_H) / ROW) + 8);
  const noHits = active && !hits.length;
  return (
    <div ref={boxRef} style={{ position: "relative", minWidth: 220, flex: 1, zIndex: hits.length || noHits ? 999 : "auto" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {suppliers.length > 0 && (
          <select className="inp" style={{ width: 190, flex: "0 0 auto" }} value={sf} title="Только товары этого поставщика"
            onChange={(e) => { setSf(e.target.value); setOpen(!!e.target.value); setActiveIdx(-1); }}>
            <option value="">Все поставщики</option>
            {suppliers.filter((x) => x.status !== "inactive" && supCount[x.id]).map((x) => <option key={x.id} value={x.id}>{x.name} ({supCount[x.id]})</option>)}
          </select>
        )}
        <input className="inp" style={{ flex: "1 1 180px", width: "auto", minWidth: 0 }} placeholder={sf ? "Поиск среди товаров поставщика…" : placeholder || "Поиск товара для добавления…"} value={q}
          onChange={(e) => { setQ(e.target.value); setActiveIdx(-1); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown} />
      </div>
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
                      style={{ position: "absolute", top: i * ROW, left: 0, right: 0, height: ROW, boxSizing: "border-box", padding: "7px 11px", borderBottom: "1px solid var(--line)", backgroundColor: i === activeIdx ? "var(--acc-tint)" : "var(--panel)", overflow: "hidden" }}
                      onClick={() => pick(p)}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--txt)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                      <div className="xs mono" style={{ color: "var(--mut)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[p.code, supName[p.supplier_id]].filter(Boolean).join(" · ")} · {Number(p.price) > 0 ? money(p.price) : "≈" + money(retailOf(p))}{Number(p.stock) > 0 ? " · ост. " + fmt(p.stock) : ""}{whQty && whQty[p.id] ? <b style={{ color: "var(--ok)" }}> · 🏬 есть на Складе Thermo: {fmt(whQty[p.id])}</b> : null}</div>
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
// коды товаров — порядковые номера 1, 2, 3…; новый товар получает «самый большой номер + 1»
const isSeqCode = (c) => /^\d+$/.test(String(c == null ? "" : c).trim());
const nextProductCode = (products) => (products || []).reduce((m, p) => (isSeqCode(p.code) ? Math.max(m, Number(p.code)) : m), 0) + 1;
const RU_COLLATOR = new Intl.Collator("ru");
// порядок для нумерации/сортировки: уже пронумерованные — по номеру, остальные — по дате добавления и названию
const productOrder = (a, b) => {
  const na = isSeqCode(a.code), nb = isSeqCode(b.code);
  if (na && nb) return Number(a.code) - Number(b.code);
  if (na !== nb) return na ? -1 : 1;
  const da = String(a.created_at || ""), db_ = String(b.created_at || "");
  return (da < db_ ? -1 : da > db_ ? 1 : 0) || RU_COLLATOR.compare(String(a.name || ""), String(b.name || ""));
};
// нужна ли перенумерация: коды не идут ровно 1…N
const codesNeedRenumber = (products) => { const s = [...products].sort(productOrder); return s.some((p, i) => String(p.code || "").trim() !== String(i + 1)); };
// строка таблицы товаров — memo: при отметке одной галочки не перерисовываются остальные тысячи строк
const ProductRow = memo(function ProductRow({ p, checked, sup, onToggle, onEdit }) {
  return (
    <tr style={{ height: PROD_ROW_H, opacity: p.status === "archive" ? 0.45 : 1, background: checked ? "var(--acc-tint)" : "none" }}>
      <td><input type="checkbox" checked={checked} onChange={() => onToggle(p.id)} /></td>
      <td className="mono xs">{p.code}</td>
      <td className="sm">{p.brand}</td>
      <td className="sm">{sup}</td>
      <td title={p.name}><div style={{ fontWeight: 600 }}>{p.name}</div>{(p.category || p.alt_names) && <div className="xs mut">{[p.category, p.alt_names].filter(Boolean).join(" · ")}</div>}</td>
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
  const sorted = useMemo(() => [...products].sort(productOrder), [products]); // по коду: 1, 2, 3…
  const needRenum = useMemo(() => codesNeedRenumber(products), [products]);
  const [renum, setRenum] = useState(null); // null | { busy, done, total, err }
  const searchIdx = useMemo(() => { const sn = {}; suppliers.forEach((x) => { sn[x.id] = x.name; }); return sorted.map((p) => prodSearchText(p, sn[p.supplier_id])); }, [sorted, suppliers]);
  const list = useMemo(() => {
    const qw = searchWords(dq);
    return sorted.filter((p, i) =>
      (!supF || p.supplier_id === supF) &&
      (!brandF || p.brand === brandF) &&
      (!qw.length || qw.every((w) => searchIdx[i].includes(w)))
    );
  }, [sorted, searchIdx, dq, supF, brandF]);
  // перенумеровать все коды 1…N (порядок: уже пронумерованные, затем по дате добавления и названию)
  const doRenumber = async () => {
    const all = [...products].sort(productOrder).map((p, i) => ({ p, code: String(i + 1) })).filter((x) => String(x.p.code || "").trim() !== x.code);
    const total = all.length;
    setRenum({ busy: true, done: 0, total, err: "" });
    try { tryDownloadBackup(JSON.stringify(await freshDump("автобэкап перед нумерацией кодов"))); }
    catch (e) { setRenum({ busy: false, done: 0, total, err: "не удалось сделать бэкап перед нумерацией (" + e.message + "), коды не изменены" }); return; }
    try {
      if (sb) {
        for (let i = 0; i < total; i += 500) {
          const chunk = all.slice(i, i + 500).map((x) => ({ ...x.p, code: x.code }));
          const { error } = await sb.from("products").upsert(chunk, { onConflict: "id" });
          if (error) throw new Error(error.message);
          setRenum({ busy: true, done: Math.min(total, i + 500), total, err: "" });
        }
      } else {
        for (let i = 0; i < total; i++) {
          const r = await db.from("products").update({ code: all[i].code }).eq("id", all[i].p.id);
          if (r.error) throw new Error(r.error.message);
          if (i % 50 === 0) setRenum({ busy: true, done: i + 1, total, err: "" });
        }
      }
      await logAction("Коды товаров пронумерованы 1…" + products.length, "products", "изменено кодов: " + total);
      setRenum(null); await reload("all"); toast("Коды товаров: 1 … " + products.length);
    } catch (e) {
      setRenum({ busy: false, done: 0, total, err: e.message }); await reload("all");
    }
  };
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
      await logAction("Удалены товары", "products", "количество: " + sel.length);
      setConfirmDel(false); const n = sel.length; setSel([]); await reload("all"); toast("Удалено товаров: " + n);
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
        {needRenum && products.length > 0 && <button className="btn" onClick={() => setRenum({ busy: false, done: 0, total: 0, err: "" })} title="Коды станут 1, 2, 3 … по порядку">№ Пронумеровать коды</button>}
        <button className="btn" onClick={() => setImp(true)}>Импорт Excel/CSV</button>
        <button className="btn pri" onClick={() => setEdit({ unit: "шт", status: "active", stock: 0, cost: 0, price: 0, code: String(nextProductCode(products)) })}>+ Товар</button>
      </div>
      <div className="card vt-box" ref={boxRef} style={{ padding: 0 }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <table className="t vt">
          <colgroup><col style={{ width: 36 }} /><col style={{ width: 110 }} /><col style={{ width: 110 }} /><col style={{ width: 140 }} /><col /><col style={{ width: 90 }} /><col style={{ width: 70 }} /><col style={{ width: 120 }} /><col style={{ width: 110 }} /><col style={{ width: 78 }} /></colgroup>
          <thead><tr><th><input type="checkbox" checked={allSel} onChange={toggleAll} title="Выбрать все отфильтрованные" /></th><th>Код</th><th>Бренд</th><th>Поставщик</th><th>Наименование</th><th>Ед.изм</th><th style={{textAlign:"right"}}>Себестоимость</th><th style={{textAlign:"right"}}>Розничная</th><th></th></tr></thead>
          <tbody>
            {(() => {
              const start = Math.max(0, Math.floor(scrollTop / PROD_ROW_H) - 15);
              const end = Math.min(list.length, Math.ceil((scrollTop + viewH) / PROD_ROW_H) + 15);
              return (<>
                {start > 0 && <tr style={{ height: start * PROD_ROW_H }}><td colSpan={9} style={{ padding: 0, border: 0 }} /></tr>}
                {list.slice(start, end).map((p) => (
                  <ProductRow key={p.id} p={p} checked={selSet.has(p.id)} sup={supName(p.supplier_id)} onToggle={toggle} onEdit={setEdit} />
                ))}
                {end < list.length && <tr style={{ height: (list.length - end) * PROD_ROW_H }}><td colSpan={9} style={{ padding: 0, border: 0 }} /></tr>}
              </>);
            })()}
            {!list.length && <tr><td colSpan={9} className="mut" style={{ textAlign: "center", padding: 26 }}>Ничего не найдено</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <ProductForm p={edit} products={products} suppliers={suppliers} onClose={() => setEdit(null)} onSave={async (vals) => {
        const { id, created_at, ...rest } = vals;
        const priceChanged = !id || Number(edit.cost) !== Number(rest.cost) || Number(edit.price) !== Number(rest.price);
        if (priceChanged) rest.price_updated = new Date().toISOString();
        const r = id ? await db.from("products").update(cleanUuids(rest)).eq("id", id) : await db.from("products").insert(cleanUuids(rest));
        if (r.error) return false; // ошибка показана, окно остаётся открытым
        await logAction(id ? "Изменён товар" : "Добавлен товар", "product:" + (rest.name || ""), "код " + (rest.code || "—") + (priceChanged && id ? " · себест. " + fmt2(rest.cost) + ", цена " + fmt2(rest.price) : ""));
        setEdit(null); await reload("all"); toast("Товар сохранён");
        return true;
      }} />}
      {renum && (
        <Modal title="Пронумеровать коды товаров" onClose={() => { if (!renum.busy) setRenum(null); }} w={500}>
          <p style={{ marginBottom: 8 }}>Коды всех товаров ({products.length}) станут <b>1, 2, 3 … {products.length}</b> по порядку.</p>
          <p className="sm mut" style={{ marginBottom: 8 }}>Порядок: товары, у которых уже есть номер, остаются по номеру; остальные — по дате добавления и по названию. Новые товары дальше получают следующий номер автоматически.</p>
          <p className="sm mut" style={{ marginBottom: 12 }}>Старые коды (IMP-…) заменятся. Перед началом автоматически скачается бэкап базы. Названия, цены, поставщики и объекты не меняются.</p>
          {renum.busy && <p className="sm" style={{ marginBottom: 10 }}>Записываю… {renum.done} / {renum.total}</p>}
          {renum.err && <p className="sm" style={{ color: "var(--bad)", marginBottom: 10 }}>Ошибка: {renum.err}. Часть кодов могла измениться — нажмите ещё раз, чтобы закончить.</p>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" disabled={renum.busy} onClick={() => setRenum(null)}>Отмена</button>
            <button className="btn pri" disabled={renum.busy} onClick={doRenumber}>{renum.busy ? "Нумерую…" : "Пронумеровать"}</button>
          </div>
        </Modal>
      )}
      {imp && <ImportModal products={products} suppliers={suppliers} onClose={() => setImp(false)} onDone={async (n) => { setImp(false); await logAction("Импорт товаров", "products", "позиций: " + n); await reload("all"); toast("Импортировано позиций: " + n); }} />}
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
function ProductForm({ p, products = [], suppliers, onClose, onSave }) {
  // числа храним строкой, пока их редактируют: поле можно очистить и набрать заново (раньше сразу вставал «0»)
  const [v, setV] = useState(() => ({ ...p, status: p.status || "active", cost: p.cost ?? 0, price: p.price ?? 0, stock: p.stock ?? 0, min_stock: p.min_stock ?? 0 }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const code = String(v.code || "").trim();
  const dupCode = code && products.find((x) => x.id !== v.id && String(x.code || "").trim() === code);
  const save = async () => {
    setBusy(true);
    const out = { ...v, name: String(v.name || "").trim(), code, cost: parseNum(v.cost), price: parseNum(v.price), stock: parseNum(v.stock), min_stock: parseNum(v.min_stock), supplier_id: v.supplier_id || null };
    const ok = await onSave(out);
    if (!ok) setBusy(false);
  };
  return (
    <Modal title={v.id ? "Редактировать товар" : "Новый товар"} onClose={onClose} w={700}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <Fld label="Код"><input className="inp" value={v.code || ""} onChange={set("code")} /></Fld>
        <Fld label="Категория"><input className="inp" value={v.category || ""} onChange={set("category")} /></Fld>
        <Fld label="Бренд"><input className="inp" value={v.brand || ""} onChange={set("brand")} /></Fld>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Название"><input className="inp" value={v.name || ""} onChange={set("name")} /></Fld></div>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Другие названия (для поиска)"><input className="inp" value={v.alt_names || ""} onChange={set("alt_names")} placeholder="через запятую: батарея, радиатор…" /></Fld></div>
        <Fld label="Ед. изм."><input className="inp" value={v.unit || ""} onChange={set("unit")} /></Fld>
        <Fld label="Поставщик"><select className="inp" value={v.supplier_id || ""} onChange={set("supplier_id")}><option value="">—</option>{activeSuppliers(suppliers, v.supplier_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>
        <Fld label="Себестоимость, $"><input type="number" className="inp" value={v.cost} onChange={set("cost")} /></Fld>
        <Fld label="Цена продажи, $"><input type="number" className="inp" value={v.price} onChange={set("price")} placeholder="0 — себест. + 15%" /></Fld>
        <Fld label="Остаток"><input type="number" className="inp" value={v.stock} onChange={set("stock")} /></Fld>
        <Fld label="Мин. остаток"><input type="number" className="inp" value={v.min_stock} onChange={set("min_stock")} /></Fld>
        <Fld label="Статус"><select className="inp" value={v.status} onChange={set("status")}><option value="active">активен</option><option value="archive">архив</option></select></Fld>
      </div>
      {dupCode && <p className="sm" style={{ color: "var(--warn)", marginTop: 10 }}>Код {code} уже есть у товара «{dupCode.name}». Лучше оставить коды разными.</p>}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" disabled={!String(v.name || "").trim() || busy} onClick={save}>{busy ? "Сохраняю…" : "Сохранить"}</button>
      </div>
    </Modal>
  );
}
// порядок проверки колонок при автоопределении: «Код / артикул» раньше названия —
// иначе заголовок «Код товара» принимался за название (в нём есть слово «товар»)
const fieldsByPriority = (fields) => [...fields].sort((a, b) => (a.id === "code" ? -1 : b.id === "code" ? 1 : 0));
function ImportModal({ products = [], suppliers, onClose, onDone }) {
  const prodList = products; // уже существующие товары (для следующего номера кода)
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
      for (const f of fieldsByPriority(FIELDS)) {
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
      let newSups = 0, code = nextProductCode(prodList);
      for (const row of dataRows) {
        const name = String(cell(row, "name") || "").trim();
        if (!name) continue;
        let supplier_id = sid || null;
        const supName = String(cell(row, "supplier") || "").trim();
        if (supName) {
          const key = supName.toLowerCase();
          if (!supCache[key]) {
            const { data: ins, error: sErr } = await db.from("suppliers").insert({ name: supName, status: "active", terms: "", contact: "", phone: "" });
            if (sErr || !ins || !ins[0]) throw new Error("не удалось добавить поставщика «" + supName + "»" + (sErr ? ": " + sErr.message : ""));
            supCache[key] = ins[0].id; newSups++;
          }
          supplier_id = supCache[key];
        }
        const segRaw = String(cell(row, "segment") || "").toLowerCase().trim();
        products.push({
          code: String(code++), // порядковый номер; код из файла (артикул) сохраняется в sku
          sku: String(cell(row, "code") || "").trim() || null,
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
    let code = nextProductCode(prodList);
    for (const l of lines) {
      const c = l.split(/\t|;/).map((x) => x.trim());
      if (c.length < 4 || !c[1]) continue;
      out.push({
        code: String(code++), sku: c[0] || null,
        name: c[1], category: c[2] || "", size: c[3] || "", unit: c[4] || "шт",
        segment: SEGMENTS.includes(c[5]) ? c[5] : "комфорт",
        cost: num(c[6]), price: num(c[7]), stock: num(c[8]),
        brand: c[9] || "", supplier_id: sid || null, status: "active", min_stock: 0,
        price_updated: new Date().toISOString(),
      });
    }
    if (!out.length) { setErr("Не найдено ни одной строки: нужно минимум 4 колонки через TAB или «;» (артикул, название, категория…)"); return; }
    setBusy(true); setErr("");
    try { await batchInsert("products", out, 500, (d, n) => setProg(d + " / " + n)); onDone(out.length); }
    catch (e) { setErr("Ошибка импорта: " + e.message); }
    setBusy(false);
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
              <button className="btn pri" disabled={!txt.trim() || busy} onClick={runPaste}>{busy ? <span><span className="spin" /> Импортирую… {prog}</span> : "Импортировать текст"}</button>
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
            {FIELDS.filter((f) => f.id !== "size").map((f) => (
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
              <thead><tr><th>Название</th><th>Категория</th><th>Ед</th><th style={{textAlign:"right"}}>Закуп</th><th style={{textAlign:"right"}}>Продажа</th><th style={{textAlign:"right"}}>Остаток</th><th>Поставщик</th><th>Бренд</th></tr></thead>
              <tbody>
                {dataRows.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    <td className="sm" style={{ fontWeight: 600 }}>{String(cell(r, "name"))}</td>
                    <td className="sm">{String(cell(r, "category"))}</td>
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
const fileSafe = (x) => String(x || "file").replace(/[^a-zа-яё0-9_-]+/gi, "_").slice(0, 40);
function AktSverkaModal({ s, objects, ops, whMoves, products, onClose, toast }) {
  // Received items (purchases) from all non-cancelled objects
  const received = [];
  objects.forEach((ob) => {
    if (ob.status === "cancelled") return;
    (ob.items || []).forEach((it) => {
      if (it.supplier_id === s.id && !it.from_warehouse && isShipped(it)) {
        received.push({ ...it, obj_name: ob.name, obj_id: ob.id, date: it.shipped_date || it.batch_date || ob.created_at });
      }
    });
  });
  // приходы на Склад Thermo вручную (закупка у поставщика)
  ops.filter((o) => !o.voided && o.type === "wh_purchase" && o.supplier_id === s.id).forEach((o) => {
    const q = Number(o.qty) || 0;
    received.push({ id: o.id, name: o.product_name || "—", qty: q, unit: o.unit || "шт", cost: q ? (o.cost_amount || 0) / q : 0, obj_name: "Склад Thermo", obj_id: "wh:" + o.id, batch_no: 1, date: o.op_date || o.created_at });
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
  const balance = round2(totalReceived - totalReturns - totalPaid); // < 0 — переплата (аванс)
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
  // акт сверки в Excel (с рамками) — чтобы отправить поставщику
  const exportAkt = () => {
    const rows = [
      { k: "title", v: ["АКТ СВЕРКИ: " + s.name] },
      { k: "info", v: ["Thermo Engineering · составлен " + new Date().toLocaleDateString("ru-RU") + " · суммы в $ по себестоимости"] },
      { k: "blank" },
      { k: "section", v: ["1. ПОЛУЧЕНО ТОВАРОВ"] },
      { k: "head", v: ["№", "Наименование", "Кол-во", "Ед.", "Себест.", "Сумма"] },
    ];
    let n = 1;
    batches.forEach((g) => {
      rows.push({ k: "section", v: [g.obj_name + " · Поставка №" + g.no + " от " + dt(g.date)] });
      g.items.forEach((it) => rows.push({ k: "row", v: [n++, it.name, Number(it.qty) || 0, it.unit || "", Number(it.cost) || 0, round2((it.qty || 0) * (it.cost || 0))] }));
    });
    if (!batches.length) rows.push({ k: "info", v: ["Поступлений нет"] });
    rows.push({ k: "total", v: ["Итого получено", round2(totalReceived)] }, { k: "blank" });
    rows.push({ k: "section", v: ["2. ВОЗВРАТЫ ПОСТАВЩИКУ"] });
    if (returns.length) {
      rows.push({ k: "head", v: ["№", "Наименование · дата", "Кол-во", "Ед.", "Себест.", "Сумма"] });
      returns.forEach((o, i) => rows.push({ k: "row", v: [i + 1, (o.product_name || "—") + " · " + dt(o.op_date || o.created_at), Number(o.qty) || 0, o.unit || "", o.qty ? round2((o.cost_amount || 0) / o.qty) : "", round2(o.cost_amount || 0)] }));
    } else rows.push({ k: "info", v: ["Возвратов нет"] });
    rows.push({ k: "total", v: ["Итого возвраты", round2(totalReturns)] }, { k: "blank" });
    rows.push({ k: "section", v: ["3. ОПЛАТЫ"] });
    if (payments.length) {
      rows.push({ k: "head", v: ["№", "Дата · способ оплаты · комментарий", "", "", "", "Сумма"] });
      [...payments].sort((a, b) => String(a.op_date || a.created_at).localeCompare(String(b.op_date || b.created_at)))
        .forEach((o, i) => rows.push({ k: "row", v: [i + 1, [dt(o.op_date || o.created_at), payText(o), o.note].filter(Boolean).join(" · "), "", "", "", round2(o.amount || 0)] }));
    } else rows.push({ k: "info", v: ["Оплат нет"] });
    rows.push({ k: "total", v: ["Итого оплачено", round2(totalPaid)] }, { k: "blank" });
    rows.push({ k: "total", v: ["Получено − возвраты − оплаты", round2(balance)] });
    rows.push({ k: "section", v: [balance > 0 ? "Долг Thermo Engineering перед " + s.name + ": " + fmt2(balance) + " $" : balance < 0 ? "Аванс (переплата) " + s.name + ": " + fmt2(-balance) + " $" : "Задолженности нет"] });
    rows.push({ k: "blank" }, { k: "blank" });
    rows.push({ k: "info", v: ["Thermo Engineering: ____________________          " + s.name + ": ____________________"] });
    const r = downloadStyledXLSX("Акт_сверки_" + fileSafe(s.name) + ".xlsx", "Акт сверки", rows, [6, 60, 10, 7, 13, 15], ["c", "t", "n", "c", "m", "m"]);
    if (toast) toast(r === "xlsx" ? "Акт сверки скачан" : r === "csv" ? "Excel заблокирован — скачан CSV" : "Скачивание заблокировано браузером");
  };
  return (
    <Modal title={"Акт-сверка: " + s.name} onClose={onClose} w={860}>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: -6, marginBottom: 10 }}><button className="btn xs" onClick={exportAkt}>⬇ Excel</button></div>
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
                  <tr className="clk" onClick={() => setClosed((c) => ({ ...c, [g.key]: !c[g.key] }))} style={{ background: "var(--acc-tint)" }}>
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
                      <td className="sm" style={{ paddingLeft: 28 }}>{it.name}</td>
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
                    <td className="sm" style={{ paddingLeft: 28 }}>{o.product_name || "—"}</td>
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
  // поле «Примечание» показываем, только если в таблице поставщиков есть колонка note (иначе текст не сохранится)
  const hasNoteCol = !suppliers.length || suppliers.some((x) => Object.prototype.hasOwnProperty.call(x, "note"));

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
      setDelBusy(false); await reload("all"); return;
    }
    await logAction("Удалён поставщик", "supplier:" + s.name, "товаров отвязано: " + ids.length);
    setDelBusy(false); setDel(null); await reload("all"); toast("Поставщик удалён");
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
                <td style={{ fontWeight: 700 }}>{s.name}{s.status === "inactive" && <> <Badge c="#9a9a9a">неактивен</Badge></>}{" "}<Badge c={SEG_COLOR[supSeg(s)]}>{SEG_LABEL[supSeg(s)]}</Badge></td>
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
      {akt && <AktSverkaModal s={akt} objects={objects} ops={finance_ops} whMoves={wh_moves} products={products} toast={toast} onClose={() => setAkt(null)} />}
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
          toast("Оплата изменена (было и стало — в «Журнале»)"); return true;
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
          <SupplierForm s={edit} all={suppliers} hasNote={hasNoteCol} onSave={saveSupplier} />
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
                <tr key={o.id} style={{ background: "var(--acc-tint)" }}>
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
function SupplierForm({ s, all = [], hasNote = true, onSave }) {
  const [v, setV] = useState(() => { const x = { status: "active", terms: "", contact: "", phone: "", ...s }; if (hasNote && x.note == null) x.note = ""; return x; });
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
        <Fld label="Сегмент (для расчёта «3 сегмента»)"><select className="inp" value={supSeg(v)} onChange={set("segment")}>{SEGMENTS.map((x) => <option key={x} value={x}>{SEG_LABEL[x]}</option>)}</select></Fld>
        {hasNote && <Fld label="Примечание"><input className="inp" value={v.note || ""} onChange={set("note")} /></Fld>}
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
                border: "1px solid " + (on ? "var(--acc)" : "var(--line)"), background: on ? "var(--acc-tint)" : "var(--panel)", fontWeight: on ? 700 : 500 }}>
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

/* ============ ИМПОРТ ЗАЯВКИ ИЗ EXCEL (Подбор товаров) ============
   Файл клиента/мастера со списком материалов → строки заявки. Каждая строка сопоставляется с базой:
   по коду (код/артикул), иначе по совпадению слов названия (размеры и цифры тоже учитываются).
   Найденное можно поправить вручную; не найденное добавляется как ручная позиция. */
const mtNorm = (s) => String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е").replace(/["'«»“”„`]/g, " ")
  .replace(/([a-zа-я])(\d)/g, "$1 $2").replace(/(\d)([a-zа-я])/g, "$1 $2").replace(/[^a-zа-я0-9/.,]+/g, " ").replace(/(^|\s)[.,/]+|[.,/]+(\s|$)/g, " ").trim();
// латиница, похожая на кириллицу («XBC» → «хвс»), и единицы измерения, которые не помогают искать
const MT_LAT = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" };
const MT_STOP = new Set(["мм", "см", "шт", "кг", "мм.", "см.", "шт.", "для", "из"]);
const mtTokens = (s) => [...new Set(mtNorm(s).split(/\s+/)
  .map((t) => (/^[abcehkmoptxy]+$/.test(t) ? t.replace(/./g, (ch) => MT_LAT[ch]) : t))
  .filter((t) => t && !MT_STOP.has(t) && (/\d/.test(t) || t.length >= 2)))];
function buildMatcher(products) {
  const toks = products.map((p) => mtTokens(p.name + " " + (p.size || "")));
  const index = new Map();
  toks.forEach((ts, i) => ts.forEach((t) => { let a = index.get(t); if (!a) index.set(t, (a = [])); a.push(i); }));
  const byCode = new Map();
  products.forEach((p, i) => { [p.code, p.sku].forEach((c) => { const k = String(c == null ? "" : c).trim().toLowerCase(); if (k && !byCode.has(k)) byCode.set(k, i); }); });
  const byName = new Map();
  products.forEach((p, i) => { const k = mtNorm(p.name); if (k && !byName.has(k)) byName.set(k, i); });
  // топ-кандидаты: { p, score 0..1 }
  return (name, code) => {
    const k = String(code == null ? "" : code).trim().toLowerCase();
    if (k && byCode.has(k)) return [{ p: products[byCode.get(k)], score: 1, by: "код" }];
    const exact = byName.get(mtNorm(name));
    const rt = mtTokens(name);
    if (!rt.length) return exact != null ? [{ p: products[exact], score: 1 }] : [];
    const hits = new Map();
    rt.forEach((t) => { const a = index.get(t); if (!a || a.length > 3000) return; a.forEach((i) => hits.set(i, (hits.get(i) || 0) + 1)); });
    const res = [];
    hits.forEach((common, i) => {
      const pt = toks[i];
      let score = (2 * common) / (rt.length + pt.length);
      const nums = rt.filter((t) => /\d/.test(t));
      if (nums.length && nums.some((n) => !pt.includes(n))) score *= 0.8; // размер/диаметр не совпал
      res.push({ p: products[i], score });
    });
    if (exact != null) res.push({ p: products[exact], score: 1 });
    res.sort((a, b) => b.score - a.score);
    const out = []; const seen = new Set();
    for (const r of res) { if (seen.has(r.p.id)) continue; seen.add(r.p.id); out.push(r); if (out.length >= 6) break; }
    return out;
  };
}
const MATCH_OK = 0.75, MATCH_MIN = 0.45;
// пометка строки в «Подбор товаров» — цвет только внутри кружка (по кругу: нет → красный → белый → нет)
const LINE_MARKS = [
  { id: "", dot: "" },
  { id: "r", dot: "#ff1f30" },
  { id: "w", dot: "#ffffff" },
];
/* ============ «3 сегмента»: тот же список в товарах поставщиков Эконом / Стандарт / Премиум ============
   Для каждой строки в каждом сегменте: если товар строки уже от поставщика этого сегмента — он сам,
   иначе — самый похожий по названию товар поставщиков этого сегмента (слова и цифры размеров; бренды не учитываются).
   Неподходящее совпадение можно заменить вручную. Цена = себестоимость + наценка. */
function SegmentCalc({ lines, products, suppliers, markup, picks, setPicks, onClose }) {
  const [mk, setMk] = useState(String(markup || 0));
  const [edit, setEdit] = useState(null); // { lineId, seg } — открыт поиск в ячейке
  const k = 1 + (parseNum(mk) || 0) / 100;
  const supById = useMemo(() => { const m = {}; suppliers.forEach((x) => { m[x.id] = x; }); return m; }, [suppliers]);
  const prodById = useMemo(() => { const m = {}; products.forEach((p) => { m[p.id] = p; }); return m; }, [products]);
  const segOfProd = (p) => (p && p.supplier_id && supById[p.supplier_id] ? supSeg(supById[p.supplier_id]) : null);
  // товары каждого сегмента (только активные поставщики) и их поисковики
  const segData = useMemo(() => {
    const out = {};
    SEGMENTS.forEach((sg) => {
      const list = products.filter((p) => { const sp = p.supplier_id && supById[p.supplier_id]; return sp && sp.status !== "inactive" && supSeg(sp) === sg; });
      out[sg] = { list, match: list.length ? buildMatcher(list) : () => [] };
    });
    return out;
  }, [products, supById]);
  // слова, которые не описывают сам товар: названия поставщиков и бренды
  const noise = useMemo(() => {
    const st = new Set();
    suppliers.forEach((x) => mtTokens(x.name).forEach((t) => st.add(t)));
    products.forEach((p) => { if (p.brand) mtTokens(p.brand).forEach((t) => st.add(t)); });
    return st;
  }, [suppliers, products]);
  const query = (l) => { const p = l.product_id ? prodById[l.product_id] : null; const nm = p ? p.name : l.name; return mtTokens(nm).filter((t) => /\d/.test(t) || !noise.has(t)).join(" "); };
  const auto = useMemo(() => {
    const res = {};
    lines.forEach((l) => {
      const p = l.product_id ? prodById[l.product_id] : null, own = segOfProd(p), q = query(l);
      res[l.id] = {};
      SEGMENTS.forEach((sg) => {
        if (p && own === sg) { res[l.id][sg] = { p, score: 1, own: true, cands: [] }; return; }
        const cands = q ? segData[sg].match(q).filter((c) => c.score >= MATCH_MIN) : [];
        res[l.id][sg] = { p: cands[0] ? cands[0].p : null, score: cands[0] ? cands[0].score : 0, cands };
      });
    });
    return res;
  }, [lines, segData, prodById, noise]);
  const cell = (l, sg) => {
    const pk = picks[l.id] && picks[l.id][sg];
    if (pk !== undefined) return { p: pk ? prodById[pk] : null, manual: true, cands: auto[l.id][sg].cands };
    return auto[l.id][sg];
  };
  const qty = (l) => Number(l.qty) || 0;
  const priceOf = (l, c) => (c.own && l.manualPrice != null && l.manualPrice !== "" ? parseNum(l.manualPrice) : round2((Number(c.p.cost) || 0) * k));
  const tot = SEGMENTS.map((sg) => {
    let sale = 0, cost = 0, found = 0;
    lines.forEach((l) => { const c = cell(l, sg); if (!c.p) return; found++; sale += qty(l) * priceOf(l, c); cost += qty(l) * (Number(c.p.cost) || 0); });
    return { sg, sale, cost, found, cnt: segData[sg].list.length };
  });
  const setPick = (lineId, sg, val) => setPicks((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] || {}), [sg]: val } }));
  return (
    <Modal title="Расчёт в трёх сегментах" onClose={onClose} w={1180}>
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        <p className="sm mut" style={{ marginRight: "auto", flex: "1 1 420px" }}>Для каждой позиции подобран похожий товар у поставщиков каждого сегмента. Сегмент поставщика задаётся в «Поставщики → ред.». Неподходящий товар замените в ячейке.</p>
        <Fld label="Наценка, %"><input type="number" className="inp" style={{ width: 110, fontWeight: 700 }} value={mk} onChange={(e) => setMk(e.target.value)} /></Fld>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 12 }}>
        {tot.map((t) => (
          <div key={t.sg} className="kpi" style={{ borderTop: "3px solid " + SEG_COLOR[t.sg] }}>
            <div className="l">{SEG_LABEL[t.sg]} <span className="xs mut">· поставщиков: {suppliers.filter((x) => x.status !== "inactive" && supSeg(x) === t.sg).length}</span></div>
            <div className="v">{fmt2(t.sale)}</div>
            <div className="xs mut">себестоимость {fmt2(t.cost)} · прибыль <b style={{ color: "var(--ok)" }}>{fmt2(t.sale - t.cost)}</b></div>
            <div className="xs" style={{ color: t.found < lines.length ? "var(--warn)" : "var(--ok)" }}>подобрано {t.found} из {lines.length}{t.found < lines.length ? " — остальные не входят в сумму" : ""}</div>
          </div>
        ))}
      </div>
      <div style={{ overflow: "auto", maxHeight: "55vh" }}>
        <table className="t" style={{ minWidth: 1000 }}>
          <thead><tr><th>Позиция заявки</th><th style={{ textAlign: "right" }}>Кол-во</th>{SEGMENTS.map((sg) => <th key={sg} style={{ minWidth: 260 }}>{SEG_LABEL[sg]}</th>)}</tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="sm" style={{ fontWeight: 600, minWidth: 200 }}>{l.name || "—"}</td>
                <td className="num">{fmt(qty(l))} <span className="xs mut">{l.unit}</span></td>
                {SEGMENTS.map((sg) => {
                  const c = cell(l, sg);
                  const isEdit = edit && edit.lineId === l.id && edit.seg === sg;
                  return (
                    <td key={sg} className="sm" style={{ verticalAlign: "top", background: c.p ? undefined : "color-mix(in srgb, var(--warn) 7%, transparent)" }}>
                      {c.p ? <>
                        <div style={{ fontWeight: 600 }}>{c.p.name}</div>
                        <div className="xs mut">{(supById[c.p.supplier_id] || {}).name || ""}{c.own ? " · товар из заявки" : c.manual ? " · выбрано вручную" : " · совпадение " + Math.round((c.score || 0) * 100) + "%"}</div>
                        <div className="xs mono">{fmt2(priceOf(l, c))} × {fmt(qty(l))} = <b>{fmt2(priceOf(l, c) * qty(l))}</b></div>
                      </> : <div className="xs" style={{ color: "var(--warn)" }}>не найдено</div>}
                      {isEdit ? (
                        <div style={{ marginTop: 4 }}>
                          {c.cands && c.cands.length > 0 && <select className="inp" style={{ marginBottom: 4 }} value="" onChange={(e) => { if (e.target.value) { setPick(l.id, sg, e.target.value); setEdit(null); } }}>
                            <option value="">— похожие —</option>
                            {c.cands.map((x) => <option key={x.p.id} value={x.p.id}>{x.p.name} · {(supById[x.p.supplier_id] || {}).name} ({Math.round(x.score * 100)}%)</option>)}
                          </select>}
                          <ProductPicker closeOnPick products={segData[sg].list} suppliers={suppliers.filter((x) => supSeg(x) === sg)} placeholder={"поиск в сегменте «" + SEG_LABEL[sg] + "»…"} onPick={(p) => { setPick(l.id, sg, p.id); setEdit(null); }} />
                          <div className="row" style={{ gap: 4, marginTop: 4 }}>
                            <button className="btn xs" onClick={() => { setPick(l.id, sg, ""); setEdit(null); }}>нет в сегменте</button>
                            {picks[l.id] && picks[l.id][sg] !== undefined && <button className="btn xs" onClick={() => { setPicks((prev) => { const n = { ...prev, [l.id]: { ...(prev[l.id] || {}) } }; delete n[l.id][sg]; return n; }); setEdit(null); }}>авто</button>}
                            <button className="btn xs" onClick={() => setEdit(null)}>закрыть</button>
                          </div>
                        </div>
                      ) : <button className="btn xs" style={{ marginTop: 4 }} onClick={() => setEdit({ lineId: l.id, seg: sg })}>заменить</button>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
function RequestExcelImport({ products, onClose, onAdd }) {
  const FIELDS = [
    { id: "name", label: "Наименование*", kw: ["наименован", "назван", "товар", "name", "номенклат", "материал"] },
    { id: "qty", label: "Количество", kw: ["кол-во", "количеств", "кол.", "кол", "qty", "сони", "soni"] },
    { id: "unit", label: "Ед. изм.", kw: ["ед", "изм", "unit"] },
    { id: "size", label: "Размер", kw: ["размер", "диаметр", "size"] },
    { id: "code", label: "Код / артикул", kw: ["код", "артикул", "code", "sku"] },
  ];
  const [rows, setRows] = useState(null);
  const [map, setMap] = useState({});
  const [hasHeader, setHasHeader] = useState(true);
  const [fname, setFname] = useState("");
  const [err, setErr] = useState("");
  const [pick, setPick] = useState({}); // номер строки → id товара | "" (ручная позиция)
  const [askCancel, setAskCancel] = useState(false);
  const fRef = useRef(null);
  const matcher = useMemo(() => buildMatcher(products), [products]);
  const num = (v) => Number(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")) || 0;
  const guessMap = (header) => {
    const m = {};
    header.forEach((h, i) => { const hl = String(h || "").toLowerCase(); for (const f of fieldsByPriority(FIELDS)) { if (m[f.id] == null && f.kw.some((k) => hl.includes(k))) { m[f.id] = i; break; } } });
    return m;
  };
  const onFile = (e) => {
    const f = e.target.files[0]; if (!f) return;
    setErr(""); setFname(f.name); setPick({});
    const r = new FileReader();
    r.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(r.result), { type: "array" });
        const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }).filter((row) => row.some((c) => String(c).trim() !== ""));
        if (!data.length) { setErr("В файле нет строк с данными"); return; }
        // строка заголовков — среди первых 10 строк та, где узнаётся больше всего колонок
        // (строки-заголовки документа вроде «Заявка на материалы» из одной ячейки пропускаются)
        let hi = 0, bestN = 0;
        data.slice(0, 10).forEach((row, i) => {
          if (row.filter((c) => String(c).trim() !== "").length < 2) return;
          const g = guessMap(row), n = Object.keys(g).length + (g.name != null ? 1 : 0);
          if (n > bestN) { bestN = n; hi = i; }
        });
        const body = data.slice(hi);
        const gm = guessMap(body[0]);
        if (gm.name == null) { // заголовков нет — берём самую «текстовую» колонку как название
          const n = Math.max(...body.map((r) => r.length));
          let best = 0, bestLen = -1;
          for (let c = 0; c < n; c++) { const len = body.reduce((a, r) => a + (isNaN(Number(r[c])) ? String(r[c] || "").length : 0), 0); if (len > bestLen) { bestLen = len; best = c; } }
          gm.name = best; setHasHeader(false);
        } else setHasHeader(true);
        setRows(body); setMap(gm);
      } catch (e2) { setErr("Не удалось прочитать файл: " + e2.message); }
    };
    r.readAsArrayBuffer(f);
  };
  const dataRows = rows ? (hasHeader ? rows.slice(1) : rows) : [];
  const header = rows ? (hasHeader ? rows[0] : (rows[0] || []).map((_, i) => "Колонка " + (i + 1))) : [];
  const cell = (row, fid) => (map[fid] == null ? "" : row[map[fid]]);
  const items = useMemo(() => dataRows.map((row, i) => {
    const name = String(cell(row, "name") || "").trim();
    if (!name || map.name == null) return null;
    const size = String(cell(row, "size") || "").trim();
    const cands = matcher(name + (size ? " " + size : ""), cell(row, "code"));
    const best = cands[0];
    const auto = best && best.score >= MATCH_MIN ? best.p.id : "";
    return { i, name, size, unit: String(cell(row, "unit") || "").trim(), qty: map.qty != null ? num(cell(row, "qty")) || 1 : 1, cands, auto };
  }).filter(Boolean), [rows, map, hasHeader, matcher]);
  const chosen = (it) => (pick[it.i] !== undefined ? pick[it.i] : it.auto);
  const nFound = items.filter((it) => chosen(it)).length;
  const nCheck = items.filter((it) => { const c = chosen(it); const cd = it.cands.find((x) => x.p.id === c); return c && pick[it.i] === undefined && cd && cd.score < MATCH_OK; }).length;
  const run = () => {
    const out = items.map((it) => {
      const id = chosen(it);
      const p = id ? products.find((x) => x.id === id) : null;
      return p ? { product_id: p.id, name: p.name, size: p.size, unit: p.unit, qty: it.qty, cost: p.cost }
        : { product_id: null, name: it.name, size: it.size, unit: it.unit || "шт", qty: it.qty, cost: 0 };
    });
    if (out.length) onAdd(out);
  };
  const pct = (s) => Math.round(s * 100) + "%";
  return (
    <>
    <Modal title="Заявка из Excel" onClose={() => (rows ? setAskCancel(true) : onClose())} w={1000}>
      {err && <div className="card sect" style={{ borderColor: "var(--bad)", color: "var(--bad)", padding: 10 }}>{err}</div>}
      {!rows && (
        <div>
          <div className="card clk" style={{ borderStyle: "dashed", textAlign: "center", padding: 34 }} onClick={() => fRef.current.click()}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>📊</div>
            <div style={{ fontWeight: 700 }}>Выбрать файл Excel (.xlsx / .xls / .csv)</div>
            <div className="xs mut" style={{ marginTop: 4 }}>Список материалов: наименование и количество (единица, код — если есть). Каждая строка найдётся в базе товаров; спорные совпадения можно поправить перед добавлением.</div>
          </div>
          <input ref={fRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={onFile} />
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}><button className="btn" onClick={onClose}>Отмена</button></div>
        </div>
      )}
      {rows && (
        <div>
          <div className="row" style={{ marginBottom: 12 }}>
            <Badge c="var(--t-strong)">{fname}</Badge>
            <span className="sm">строк: <b>{items.length}</b> · найдено в базе: <b style={{ color: "var(--ok)" }}>{nFound}</b>{nCheck > 0 && <> · проверьте: <b style={{ color: "var(--warn)" }}>{nCheck}</b></>} · ручных: <b>{items.length - nFound}</b></span>
            <label className="sm clk" style={{ marginLeft: "auto" }}><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> первая строка — заголовки</label>
            <button className="btn xs" onClick={() => { setRows(null); setMap({}); setPick({}); }}>↺ другой файл</button>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", marginBottom: 12 }}>
            {FIELDS.filter((f) => f.id !== "size").map((f) => (
              <Fld key={f.id} label={f.label}>
                <select className="inp" value={map[f.id] == null ? "" : map[f.id]} onChange={(e) => { setPick({}); setMap({ ...map, [f.id]: e.target.value === "" ? null : Number(e.target.value) }); }}>
                  <option value="">— нет —</option>
                  {header.map((h, i) => <option key={i} value={i}>{String(h || "Колонка " + (i + 1)).slice(0, 30)}</option>)}
                </select>
              </Fld>
            ))}
          </div>
          <div style={{ overflow: "auto", maxHeight: 440, border: "1px solid var(--line)", borderRadius: 10 }}>
            <table className="t">
              <thead><tr><th style={{ width: 34 }}>№</th><th>Из файла</th><th style={{ width: 70, textAlign: "right" }}>Кол-во</th><th style={{ minWidth: 330 }}>Товар в базе</th><th style={{ width: 116 }}>Совпадение</th></tr></thead>
              <tbody>
                {items.map((it, k) => {
                  const c = chosen(it), cd = it.cands.find((x) => x.p.id === c);
                  const tone = !c ? "var(--t-neutral)" : pick[it.i] !== undefined || (cd && cd.score >= MATCH_OK) ? "var(--t-ok)" : "var(--t-warn)";
                  return (
                    <tr key={it.i}>
                      <td className="xs mut">{k + 1}</td>
                      <td className="sm"><b style={{ fontWeight: 600 }}>{it.name}</b>{it.unit && <div className="xs mut">{it.unit}</div>}</td>
                      <td className="num">{fmt(it.qty)}</td>
                      <td>
                        <select className="inp" value={c} onChange={(e) => setPick({ ...pick, [it.i]: e.target.value })}>
                          {it.cands.map((x) => <option key={x.p.id} value={x.p.id}>{x.p.name} — код {x.p.code} ({x.by || pct(x.score)})</option>)}
                          <option value="">— нет в базе: добавить как ручную позицию —</option>
                        </select>
                      </td>
                      <td><Badge c={tone}>{!c ? "ручная" : pick[it.i] !== undefined ? "выбрано" : cd && cd.score >= MATCH_OK ? "найдено" : "проверьте"}</Badge></td>
                    </tr>
                  );
                })}
                {!items.length && <tr><td colSpan={5} className="mut" style={{ textAlign: "center", padding: 20 }}>Нет строк с наименованием — укажите колонку «Наименование»</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={() => setAskCancel(true)}>Отмена</button>
            <button className="btn pri" disabled={!items.length} onClick={run}>Добавить {items.length} поз. в заявку</button>
          </div>
        </div>
      )}
    </Modal>
    {askCancel && <DiscardConfirm text={"Строки из файла «" + fname + "» не будут добавлены в заявку."} onStay={() => setAskCancel(false)} onDiscard={onClose} />}
    </>
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
  const [xlImport, setXlImport] = useState(false);
  const [segCalc, setSegCalc] = useState(false);
  const [segPick, setSegPick] = useState({}); // ручной выбор в «3 сегмента»: { [lineId]: { [seg]: productId | "" } }
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
  const prodMap = useMemo(() => { const m = new Map(); products.forEach((p) => m.set(p.id, p)); return m; }, [products]);
  const prodById = (id) => prodMap.get(id);
  const qn = (x) => parseNum(x); // количество в строке хранится так, как его ввели (можно очистить поле)

  const addFromBase = (p) => {
    if (whQty[p.id]) toast("🏬 «" + p.name + "» есть на Складе Thermo: " + fmt(whQty[p.id]) + " " + (p.unit || "шт") + " — будет отдано со склада");
    setLines((prev) => {
      const ex = prev.find((l) => l.product_id === p.id);
      if (ex) return prev.map((l) => (l.product_id === p.id ? { ...l, qty: qn(l.qty) + 1 } : l));
      // новый товар — в начало списка (сверху)
      return [{ id: uuid(), product_id: p.id, name: p.name, size: p.size, unit: p.unit, qty: 1, cost: p.cost, supplier_id: null, manual: false }, ...prev];
    });
  };
  // строки из Excel: найденные товары складываются с уже выбранными, остальные — ручные позиции
  const addImported = (rows) => {
    setLines((prev) => {
      const next = prev.map((l) => ({ ...l })); // копии: исходный список не меняем
      rows.forEach((r) => {
        const ex = r.product_id ? next.find((l) => l.product_id === r.product_id) : null;
        if (ex) ex.qty = qn(ex.qty) + r.qty;
        else next.push({ id: uuid(), product_id: r.product_id, name: r.name, size: r.size || "", unit: r.unit || "шт", qty: r.qty, cost: r.cost || 0, supplier_id: null, manual: !r.product_id });
      });
      return next;
    });
    setXlImport(false);
    toast("Из Excel добавлено строк: " + rows.length + " (найдено в базе: " + rows.filter((r) => r.product_id).length + ")");
  };
  const addManualLine = () => {
    setLines((prev) => [{ id: uuid(), product_id: null, name: "", size: "", unit: "шт", qty: 1, cost: "", supplier_id: null, manual: true }, ...prev]);
  };
  // сколько такого товара лежит на Складе Thermo (возвраты) — можно отгрузить оттуда вместо закупки
  const whQty = useMemo(() => whQtyMap(data.warehouse), [data.warehouse]);
  const setLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  // перетаскивание строк (за «⠿») и цветная пометка строки
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const moveLine = (fromId, toId) => setLines((prev) => {
    if (!fromId || fromId === toId) return prev;
    const a = prev.slice(), i = a.findIndex((l) => l.id === fromId);
    if (i < 0) return prev;
    const [it] = a.splice(i, 1);
    const j = toId ? a.findIndex((l) => l.id === toId) : a.length;
    a.splice(j < 0 ? a.length : j, 0, it);
    return a;
  });
  const confirmRemoveLine = () => { if (delLine) { setLines((prev) => prev.filter((l) => l.id !== delLine)); setDelLine(null); } };

  const filteredProducts = useMemo(() => products.filter((p) => p.status !== "archive"), [products]);
  const supById = useMemo(() => { const m = {}; suppliers.forEach((x) => { m[x.id] = x; }); return m; }, [suppliers]);
  // поставщик строки: у товара из базы — его поставщик; если в базе не указан — выбранный в строке
  // в строке можно выбрать другого поставщика (если этот товар берут не у того, кто указан в базе)
  const lineSup = (l) => { const p = l.product_id ? prodById(l.product_id) : null; return l.supplier_id || (p && p.supplier_id) || null; };
  const noSupCount = lines.filter((l) => !lineSup(l)).length;
  const setSupForEmpty = (sid) => { if (sid) setLines((prev) => prev.map((l) => (lineSup(l) ? l : { ...l, supplier_id: sid }))); };

  // мастер клиента из его прошлого объекта — подставляется, если мастер ещё не выбран и он активен
  const clientMaster = (x, c) => {
    if (x.master_id || !c.master_id) return {};
    const m = masters.find((mm) => mm.id === c.master_id && mm.status === "active");
    return m ? { master_id: m.id, master: m.name } : {};
  };
  const saveNewMaster = async () => {
    if (!newMasterName.trim()) return;
    setSavingMaster(true);
    try {
      const { data: ins, error } = await db.from("masters").insert(cleanUuids({ name: newMasterName.trim(), phone: newMasterPhone.trim(), status: "active", specialty: "", bonus_percent: 0, note: "" }));
      if (error) throw new Error(error.message);
      const m = ins && ins[0];
      if (m) {
        setNewObj((prev) => ({ ...prev, master_id: m.id, master: m.name }));
        await logAction("Добавлен мастер", "master:" + m.name, "из новой заявки");
        await reload();
        toast("Мастер «" + m.name + "» добавлен");
      }
      setAddingMaster(false); setNewMasterName(""); setNewMasterPhone("");
    } catch (e) { toast("Ошибка добавления мастера: " + e.message); }
    setSavingMaster(false);
  };


  const doSave = async (saleK) => {
    setBusy(true); setErr("");
    try {
      let whOut = [];
      const mkItems = (batchNo) => {
        const sp = splitByWarehouse(lines.map((l) => ({ ...l, qty: qn(l.qty), product_id: l.product_id && prodById(l.product_id) ? l.product_id : null })), data.warehouse, (l, qty, w) => {
          const p = l.product_id ? prodById(l.product_id) : null;
          const cost = p ? Number(p.cost) || 0 : parseNum(l.cost);
          const it = {
            id: uuid(), product_id: p ? p.id : null, name: p ? p.name : String(l.name || "").trim(), size: p ? p.size : l.size, unit: p ? p.unit : l.unit,
            qty, price: l.manualPrice != null && l.manualPrice !== "" ? parseNum(l.manualPrice) : Math.round(cost * saleK * 100) / 100, cost,
            supplier_id: lineSup(l),
            source_text: p ? p.name : l.name, confidence: 100,
            batch_no: batchNo, batch_date: today(), shipped: false, added_at: new Date().toISOString(),
          };
          if (w) { Object.assign(it, whItemPatch(w)); delete it.shipped; }
          return it;
        });
        whOut = sp.whOut;
        return sp.items;
      };
      let obj = selObj, batchNo = 1, items;
      if (!obj) {
        // новый объект создаётся сразу вместе с позициями — одной записью (раньше объект создавался пустым,
        // а позиции дописывались вторым запросом; если он не проходил, объект оставался пустым)
        items = mkItems(1);
        const objData = cleanUuids({ ...newObj, name: String(newObj.name || "").trim(), status: saveStatus || "draft", items });
        const { data: ins, error: insErr } = await db.from("objects").insert(objData);
        if (insErr) throw new Error("объект не создан: " + (insErr.message || insErr));
        obj = ins && ins[0];
        if (!obj) {
          const { data: found } = await db.from("objects").select().eq("name", objData.name).order("created_at", { ascending: false });
          obj = found && found[0];
        }
        if (!obj) throw new Error("объект создан, но не удалось его прочитать. Проверьте RLS на таблице objects.");
        setObjId(obj.id); // если дальше что-то не так — повторное сохранение не создаст второй объект
      } else {
        // поставка добавляется к свежему списку позиций из базы: чужие изменения не затираются
        const extra = saveStatus && saveStatus !== obj.status ? { status: saveStatus } : {};
        const r = await updateObjectItems(obj.id, (cur) => {
          const exNos = cur.map((i) => i.batch_no || 1);
          batchNo = exNos.length ? Math.max(...exNos) + 1 : 1;
          items = mkItems(batchNo);
          return [...cur, ...items];
        }, extra);
        if (r.error) throw new Error("позиции не сохранены: " + (r.error.message || r.error) + ". Заявка осталась на экране — попробуйте ещё раз.");
      }
      // товар со Склада Thermo — списываем со склада (после того как позиции сохранены)
      const whFail = whOut.length ? await warehouseOut(whOut, obj, curUserName()) : 0;
      // история заявок — не критично: при ошибке поставка всё равно сохранена
      await db.from("requests").insert(cleanUuids({
        object_id: obj.id, mode: "manual", source: "manual",
        lines: lines.map((l) => ({ source: l.name, final_product_id: l.product_id, qty: qn(l.qty) })),
      }));
      // товарам без поставщика запоминаем выбранного поставщика — в следующий раз он подставится сам
      const link = {};
      lines.forEach((l) => { const p = l.product_id ? prodById(l.product_id) : null; if (p && !p.supplier_id && l.supplier_id) (link[l.supplier_id] = link[l.supplier_id] || []).push(p.id); });
      let linked = 0;
      for (const [sid, ids] of Object.entries(link)) {
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          if (sb) { const r = await sb.from("products").update({ supplier_id: sid }).in("id", chunk); if (!r.error) linked += chunk.length; }
          else for (const id of chunk) { const r = await db.from("products").update({ supplier_id: sid }).eq("id", id); if (!r.error) linked++; }
        }
      }
      await logAction("Заявка сохранена", "object:" + obj.name, "поставка №" + batchNo + ", позиций: " + items.length + (linked ? ", товарам указан поставщик: " + linked : ""));
      toast("Поставка №" + batchNo + " сохранена: " + items.length + " поз. → «" + obj.name + "»" + (whOut.length ? " · со Склада Thermo: " + whOut.length + " поз." : "") + (whFail ? " · ⚠ склад не списан у " + whFail + " поз." : ""));
      setStep(0); setLines([]); setObjId(""); setMarkupModal(false);
      setNewObj({ name: "", client: "", phone: "", master: "", master_id: "", manager: "", address: "" });
      clearDraft();
      await reload(linked ? "all" : undefined);
      if (onSaved) onSaved();
      openObject(obj.id);
    } catch (e) { setErr("Ошибка сохранения: " + e.message); setMarkupModal(false); }
    setBusy(false);
  };

  const trySave = () => {
    if (!lines.length) { setErr("Добавьте хотя бы одну позицию"); return; }
    const incomplete = lines.find((l) => !l.product_id && (!l.name || !l.name.trim()));
    if (incomplete) { setErr("Заполните название для всех ручных позиций"); return; }
    const zero = lines.find((l) => !(qn(l.qty) > 0));
    if (zero) { setErr("Укажите количество больше нуля: «" + (zero.name || "позиция без названия") + "»"); return; }
    setErr("");
    // статус в заявке не выбирается: новый объект — «Черновик», у существующего статус не меняется (меняют в карточке объекта)
    setSaveStatus(selObj ? (selObj.status || "draft") : "draft");
    setMarkupModal(true);
  };

  const effectiveMarkup = markupCustom !== "" ? Number(markupCustom) : markup;
  const saleK = 1 + (Number(effectiveMarkup) || 0) / 100;
  // предпросмотр продажи: строки с ручной ценой — по ней, остальные — себестоимость + наценка
  const totalSalePreview = Math.round(lines.reduce((acc, l) => {
    const p = l.product_id ? prodById(l.product_id) : null, c = p ? Number(p.cost) || 0 : parseNum(l.cost);
    const price = l.manualPrice != null && l.manualPrice !== "" ? parseNum(l.manualPrice) : Math.round(c * saleK * 100) / 100;
    return acc + qn(l.qty) * price;
  }, 0) * 100) / 100;

  return (
    <div>
      <div className="steps">
        {["Объект", "Подбор товаров"].map((s, i) => (
          <div key={i} className={"step " + (i === step ? "on" : i < step ? "done" : "")}>{i + 1}. {s}</div>
        ))}
      </div>
      {err && <div className="card sect" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{err}</div>}

      {step === 0 && (
        // Enter переходит к следующему полю; на последнем поле (или в выбранном существующем объекте) — «Далее»
        <div className="card" onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          const t = e.target;
          if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
          e.preventDefault();
          const card = e.currentTarget;
          const next = () => {
            const els = [...card.querySelectorAll("input:not([type=hidden]), select")].filter((x) => !x.disabled && x.offsetParent !== null);
            const i = els.indexOf(t);
            if (i < 0) return; // поле исчезло (например, открылась форма нового мастера)
            if (i < els.length - 1) { els[i + 1].focus(); if (els[i + 1].select && els[i + 1].tagName === "INPUT") els[i + 1].select(); }
            else { const b = card.querySelector("[data-next-step]"); if (b && !b.disabled) b.click(); }
          };
          setTimeout(next, 0); // после выбора из списка (клиент/телефон/мастер) поле успевает обновиться
        }}>
          <div>
            {objId && (
              // выбор существующего объекта убран; если заявка уже привязана к объекту — показываем его и даём вернуться к новому
              <div className="row" style={{ marginBottom: 14, gap: 8 }}>
                <div style={{ marginRight: "auto" }}><span className="mut sm">Объект: </span><b>{(activeObjects.find((o) => o.id === objId) || {}).name || "—"}</b></div>
                <button className="btn" onClick={() => setObjId("")}>+ Создать новый</button>
              </div>
            )}
            {!objId && (
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <Fld label="Название объекта"><input className="inp" value={newObj.name} onChange={(e) => setNewObj({ ...newObj, name: e.target.value })} placeholder="Дом, ул. Чиланзар 12" /></Fld>
                <Fld label="Клиент"><ClientInput value={newObj.client} objects={data.objects || []}
                  onChange={(v) => setNewObj((x) => ({ ...x, client: v }))}
                  onPick={(c) => setNewObj((x) => ({ ...x, client: c.client, phone: c.phone || x.phone, ...clientMaster(x, c) }))} /></Fld>
                <Fld label={"Теле\u2060фон клиента"}><ClientInput phoneMode value={newObj.phone} objects={data.objects || []}
                  onChange={(v) => setNewObj((x) => ({ ...x, phone: v }))}
                  onPick={(c) => setNewObj((x) => ({ ...x, phone: c.phone, client: x.client && x.client.trim() ? x.client : c.client, ...clientMaster(x, c) }))} /></Fld>
                <div className="fld">
                  <label>Мастер</label>
                  {!addingMaster ? (
                    <>
                      <MasterPicker masters={masters} value={newObj.master_id}
                        onChange={(m) => setNewObj((x) => ({ ...x, master_id: m ? m.id : "", master: m ? m.name : "" }))}
                        onAdd={() => setAddingMaster(true)} />
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
                <Fld label="Менеджер"><PersonSelect hideEmpty value={newObj.manager} onChange={(m) => setNewObj({ ...newObj, manager: m })} /></Fld>
                <Fld label="Адрес"><input className="inp" value={newObj.address} onChange={(e) => setNewObj({ ...newObj, address: e.target.value })} /></Fld>
              </div>
            )}
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
            <button className="btn pri" data-next-step disabled={!objId && !newObj.name} onClick={() => setStep(1)}>Далее →</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <h3 style={{ marginRight: "auto" }}>Подбор товаров</h3>
            <button className="btn" disabled={!lines.length} onClick={() => setSegCalc(true)} title="Посчитать список сразу в трёх сегментах поставщиков: Эконом / Стандарт / Премиум">⚖ 3 сегмента</button>
            <button className="btn" onClick={() => setXlImport(true)}>📊 Загрузить из Excel</button>
          </div>
          {segCalc && <SegmentCalc lines={lines} products={filteredProducts} suppliers={suppliers} markup={effectiveMarkup} picks={segPick} setPicks={setSegPick} onClose={() => setSegCalc(false)} />}
          {xlImport && <RequestExcelImport products={filteredProducts} onClose={() => setXlImport(false)} onAdd={addImported} />}

          <div className="row" style={{ marginBottom: 12, gap: 10 }}>
            <ProductPicker products={filteredProducts} suppliers={suppliers} whQty={whQty} placeholder="Поиск товара по названию / коду — начните вводить…" onPick={addFromBase} />
          </div>

          {lines.length === 0 && (
            <div className="card sect mut" style={{ textAlign: "center", padding: 30 }}>
              Список пуст. Найдите товар через поиск выше, загрузите список из Excel или добавьте позицию вручную.
            </div>
          )}

          {lines.length > 0 && noSupCount > 0 && (
            <div className="row sm" style={{ marginBottom: 10, gap: 8, padding: "8px 10px", border: "1px solid color-mix(in srgb, var(--warn) 45%, transparent)", borderRadius: 9, background: "color-mix(in srgb, var(--warn) 7%, transparent)" }}>
              <span style={{ color: "var(--warn)", fontWeight: 600 }}>Без поставщика: {noSupCount} поз.</span>
              <span className="xs mut" style={{ flex: "1 1 260px" }}>Закупка без поставщика не попадёт в его долг. Выберите поставщика сразу для всех:</span>
              <select className="inp" style={{ width: 200 }} value="" onChange={(e) => setSupForEmpty(e.target.value)}>
                <option value="">— всем без поставщика —</option>
                {activeSuppliers(suppliers).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          )}
          {lines.length > 0 && (
            <div style={{ overflow: "auto" }}>
              <table className="t" style={{ minWidth: 820 }}>
                <thead><tr>
                  <th style={{ width: 54 }} title="Перетащите за ⠿, чтобы поменять порядок; цветной кружок — выделить строку"></th><th>Товар</th><th style={{ width: 90 }}>Кол-во</th><th style={{ width: 70 }}>Ед.</th><th style={{ textAlign: "right", color: "var(--ok)" }}>Цена продажи</th><th title="Есть на Складе Thermo — отдаётся со склада (галочка)">Склад Thermo</th><th></th>
                </tr></thead>
                <tbody>
                  {lines.map((l) => {
                    const p = l.product_id ? prodById(l.product_id) : null;
                    const curSup = lineSup(l);
                    // поставщик — только для информации (выбор в строке убран по просьбе руководителя)
                    const supSel = curSup ? <div className="xs mut" style={{ marginTop: 3 }}>{(suppliers.find((x) => x.id === curSup) || {}).name || ""}</div> : null;
                    const mark = LINE_MARKS.find((m) => m.id === l.mark);
                    return (
                      <tr key={l.id} draggable={dragId === l.id}
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", l.id); } catch (er) {} }}
                        onDragOver={(e) => { if (!dragId) return; e.preventDefault(); if (overId !== l.id) setOverId(l.id); }}
                        onDrop={(e) => { e.preventDefault(); moveLine(dragId, l.id); setDragId(null); setOverId(null); }}
                        onDragEnd={() => { setDragId(null); setOverId(null); }}
                        style={{ opacity: dragId === l.id ? 0.45 : 1,
                          boxShadow: overId === l.id && dragId && dragId !== l.id ? "inset 0 3px 0 var(--acc)" : undefined }}>
                        <td style={{ whiteSpace: "nowrap", verticalAlign: "middle" }}>
                          <span title="Зажмите и перетащите, чтобы поменять место" onMouseDown={() => setDragId(l.id)} onMouseUp={() => { if (!overId) setDragId(null); }}
                            style={{ cursor: "grab", fontSize: 18, color: "var(--mut)", padding: "0 4px", userSelect: "none" }}>⠿</span>
                          <button type="button" title="Выделить строку цветом" onClick={() => { const i = LINE_MARKS.findIndex((m) => m.id === (l.mark || "")); setLine(l.id, { mark: LINE_MARKS[(i + 1) % LINE_MARKS.length].id }); }}
                            style={{ width: 16, height: 16, borderRadius: 8, border: "1.5px solid " + (mark && mark.dot ? (mark.id === "w" ? "#9a9a9a" : mark.dot) : "var(--line)"), background: mark && mark.dot ? mark.dot : "transparent", cursor: "pointer", verticalAlign: "middle", padding: 0 }} />
                        </td>
                        <td style={{ minWidth: 240 }}>
                          {l.manual ? (
                            <>
                              <input className="inp" placeholder="Название товара" value={l.name} onChange={(e) => setLine(l.id, { name: e.target.value })} />
                              {supSel}
                              <div className="xs mut" style={{ marginTop: 3 }}>добавлено вручную</div>
                            </>
                          ) : (
                            <>
                              <div style={{ fontWeight: 600 }}>{l.name}</div>
                              {!p && <div className="xs" style={{ color: "var(--warn)" }}>товара больше нет в базе — сохранится как ручная позиция</div>}
                              {supSel}
                            </>
                          )}
                        </td>
                        <td><input type="number" className="inp" value={l.qty} min={0} onChange={(e) => setLine(l.id, { qty: e.target.value })} style={{ borderColor: qn(l.qty) > 0 ? undefined : "var(--bad)" }} /></td>
                        <td>
                          {l.manual
                            ? <input className="inp" style={{ width: 64 }} value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value })} />
                            : <span className="mut">{l.unit}</span>}
                        </td>
                        <td><input type="number" className="inp" style={{ width: 100, textAlign: "right", fontWeight: 700, ...(l.manualPrice != null && l.manualPrice !== "" && parseNum(l.manualPrice) < (p ? Number(p.cost) || 0 : parseNum(l.cost)) ? { color: "var(--bad)", borderColor: "var(--bad)" } : { color: "var(--ok)" }) }} placeholder={l.manual ? "цена" : "авто"} value={l.manualPrice != null ? l.manualPrice : ""} onChange={(e) => setLine(l.id, { manualPrice: e.target.value === "" ? null : e.target.value })} title="Цена продажи (оставьте пустым — рассчитается по наценке)" /></td>
                        <td className="sm">{p && whQty[p.id] ? (
                          <label className="row" style={{ gap: 5, flexWrap: "nowrap", cursor: "pointer", color: l.fromWh !== false ? "var(--ok)" : "var(--mut)", fontWeight: 700 }} title="Отдать со Склада Thermo (снимите галочку — закупить у поставщика)">
                            <input type="checkbox" checked={l.fromWh !== false} onChange={(e) => setLine(l.id, { fromWh: e.target.checked })} />
                            <span>со склада: {fmt(Math.min(qn(l.qty), whQty[p.id]))}{qn(l.qty) > whQty[p.id] ? <span className="xs mut" style={{ fontWeight: 400 }}> (+{fmt(qn(l.qty) - whQty[p.id])} у пост.)</span> : null}</span>
                          </label>
                        ) : <span className="mut">—</span>}</td>
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
              Позиций: {lines.length}
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
              <h3 style={{ margin: "0 0 6px" }}>Наценка на розничную цену</h3>
              <p className="sm mut" style={{ marginBottom: 12 }}>Розничная цена каждой позиции = себестоимость + наценка. Применяется ко всему списку. После сохранения цены можно поправить вручную на странице объекта.</p>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <Fld label="Наценка, %">
                  <input type="number" className="inp" style={{ fontSize: 18, fontWeight: 700 }}
                    value={markupCustom !== "" ? markupCustom : markup}
                    onChange={(e) => { setMarkupCustom(e.target.value); }} />
                </Fld>
                <div className="fld"><label>Предпросмотр</label>
                  <div className="inp mono" style={{ background: "var(--panel)" }}>
                    <div style={{ fontWeight: 700, color: "var(--ok)" }}>продажа: {fmt(totalSalePreview)}</div>
                  </div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                {[5, 10, 15, 20].map((x) => <button key={x} className={"btn xs " + (effectiveMarkup === x && markupCustom === "" ? "pri" : "")} onClick={() => { setMarkup(x); setMarkupCustom(""); }}>{x}%</button>)}
              </div>
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
                <button className="btn" onClick={() => setMarkupModal(false)}>Отмена</button>
                <button className="btn pri" disabled={busy} onClick={async () => {
                  const rows = lines.map((l) => { const p = l.product_id ? prodById(l.product_id) : null, c = p ? Number(p.cost) || 0 : parseNum(l.cost);
                    return { name: p ? p.name : l.name, cost: c, price: l.manualPrice != null && l.manualPrice !== "" ? parseNum(l.manualPrice) : Math.round(c * saleK * 100) / 100 }; });
                  if (!(await confirmLowPrice(rows))) return;
                  doSave(saleK);
                }}>{busy ? "Сохраняю…" : "Применить и сохранить ✓"}</button>
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
  const [delBusy, setDelBusy] = useState(false);
  const [q, setQ] = useState("");
  const [stF, setStF] = useState("");
  const obj = objects.find((o) => o.id === openId);
  const opsCount = useMemo(() => { const m = {}; finance_ops.forEach((x) => { if (x.object_id) m[x.object_id] = (m[x.object_id] || 0) + 1; }); return m; }, [finance_ops]);
  // объект с оплатами/возвратами удаляет только руководитель; менеджер может удалить только «пустой» (ошибочный) объект
  const canDelete = (o) => fin || !opsCount[o.id];
  const removeObject = async (o) => {
    setDelBusy(true);
    // по шагам: при любой ошибке останавливаемся (ошибка уже показана на экране)
    let r = await db.from("finance_ops").delete().eq("object_id", o.id);
    if (!r.error) r = await db.from("requests").delete().eq("object_id", o.id);
    if (!r.error) r = await db.from("objects").delete().eq("id", o.id);
    setDelBusy(false);
    if (r.error) { await reload(); return false; }
    await logAction("Удалён объект", "object:" + o.name, "клиент: " + (o.client || "") + ", позиций: " + (o.items || []).length + ", операций: " + (opsCount[o.id] || 0));
    await reload(); toast("Объект удалён");
    return true;
  };
  if (obj) return <ObjectDetail obj={obj} data={data} reload={reload} toast={toast} fin={fin} back={() => setOpenId(null)} />;
  const ql = q.trim().toLowerCase();
  const shown = objects.filter((o) => (!stF || o.status === stF) && (!ql || [o.name, o.client, o.phone, o.address, o.master, o.manager].join(" ").toLowerCase().includes(ql)));
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Объекты <span className="mut sm">({shown.length !== objects.length ? shown.length + " из " + objects.length : objects.length})</span></h2>
        <input className="inp" style={{ maxWidth: 220 }} placeholder="Поиск: объект, клиент, телефон…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp" style={{ maxWidth: 180 }} value={stF} onChange={(e) => setStF(e.target.value)}>
          <option value="">Все статусы</option>
          {[...OBJ_STATUSES, ...OLD_STATUSES.filter((x) => objects.some((o) => o.status === x.id))].map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <button className="btn pri" onClick={goRequest}>+ Новая заявка</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Объект</th><th>Клиент</th><th>Мастер</th><th>Статус</th><th style={{textAlign:"right"}}>Сумма товара</th><th style={{textAlign:"right"}}>Долг клиента</th><th>Дата</th><th></th></tr></thead>
          <tbody>
            {shown.map((o) => {
              const f = calcObject(o, finance_ops);
              const st = stById(o.status);
              return (
                <tr key={o.id} className="clk" onClick={() => setOpenId(o.id)}>
                  <td style={{ fontWeight: 700 }}>{o.name}<div className="xs mut">{o.address}</div></td>
                  <td className="sm">{o.client}{o.phone && <div className="xs mut mono">{o.phone}</div>}</td>
                  <td className="sm">{o.master}</td>
                  <td><Badge c={st.c}>{st.label}</Badge></td>
                  <td className="num">{fmt(f.saleNet)}</td>
                  <td className="num" style={{ color: f.clientDebt > 0 ? "var(--bad)" : f.clientDebt < 0 ? "var(--ok)" : "var(--mut)" }}>{f.clientDebt < 0 ? "−" + fmt(Math.abs(f.clientDebt)) : fmt(f.clientDebt)}</td>
                  <td className="xs mut mono">{dt(o.created_at)}</td>
                  <td>{canDelete(o) ? <button className="btn xs dng" title="Удалить объект" onClick={(e) => { e.stopPropagation(); setDelObj(o); }}>✕</button> : null}</td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={8} className="mut" style={{ textAlign: "center", padding: 30 }}>{objects.length ? "Ничего не найдено" : "Объектов пока нет — создайте через «Новая заявка»"}</td></tr>}
          </tbody>
        </table>
      </div>
      {delObj && (() => { const f = calcObject(delObj, finance_ops); return (
        <Modal title="Удалить объект" onClose={() => { if (!delBusy) setDelObj(null); }} w={460}>
          <p style={{ marginBottom: 6 }}>Удалить объект <b style={{ color: "var(--bad)" }}>{delObj.name}</b> ({delObj.client})?</p>
          {(f.clientDebt > 0 || f.supplierDebt > 0) && <p className="sm" style={{ color: "var(--warn)", marginBottom: 6 }}>⚠ По объекту есть долги — клиента: {fmt(Math.max(0, f.clientDebt))}, поставщикам: {fmt(f.supplierDebt)}.</p>}
          <p className="sm mut" style={{ marginBottom: 14 }}>Будут удалены все материалы, финансовые операции ({opsCount[delObj.id] || 0}) и заявки этого объекта. Действие необратимо. Если объект просто завершён — лучше поставьте статус «Закрыто».</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" disabled={delBusy} onClick={() => setDelObj(null)}>Отмена</button>
            <button className="btn" disabled={delBusy} style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={async () => { if (await removeObject(delObj)) setDelObj(null); }}>{delBusy ? "Удаляю…" : "Удалить"}</button>
          </div>
        </Modal>
      ); })()}
    </div>
  );
}

function ObjectDetail({ obj, data, reload, toast, back, fin = true }) {
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
  const [delItemId, setDelItemId] = useState(null);
  const [shipForm, setShipForm] = useState(false);
  const [pctForm, setPctForm] = useState(false);
  const supName = (id) => (suppliers.find((s) => s.id === id) || {}).name || "—";
  const itemName = (iid) => ((obj.items || []).find((i) => i.id === iid) || {}).name || "";

  // любые изменения позиций — через свежую версию объекта из базы (updateObjectItems); true — сохранено
  const saveItems = async (change, extra) => {
    const r = await updateObjectItems(obj.id, change, extra);
    await reload();
    return !r.error;
  };
  const setStatus = async (s) => {
    const r = await db.from("objects").update({ status: s }).eq("id", obj.id);
    if (!r.error) await logAction("Статус объекта: " + stById(s).label, "object:" + obj.name, "было: " + stById(obj.status).label);
    await reload();
  };
  const setField = async (patch, what) => {
    const r = await db.from("objects").update(patch).eq("id", obj.id);
    if (!r.error) await logAction("Объект: " + what, "object:" + obj.name, Object.values(patch).filter((x) => x != null && typeof x !== "object").join(" · "));
    await reload();
  };
  const delItem = async (iid) => {
    const it = (obj.items || []).find((i) => i.id === iid) || {};
    const ok = await saveItems((cur) => cur.filter((i) => i.id !== iid));
    if (ok) { await logAction("Удалена позиция", "object:" + obj.name, (it.name || "") + " × " + fmt(it.qty) + " по " + fmt2(it.price)); toast("Позиция удалена"); }
    return ok;
  };
  const setItemQty = async (iid, qty) => {
    const ok = await saveItems((cur) => cur.map((i) => (i.id === iid ? { ...i, qty } : i)));
    if (ok) await logAction("Изменено количество", "object:" + obj.name, itemName(iid) + ": " + fmt(qty));
    return ok;
  };
  // возврат считается по цене продажи позиции: при изменении цены/себестоимости пересчитываем её возвраты,
  // иначе в Excel и в долге клиента возврат остаётся по старой цене
  const retMismatch = (list = obj.items || []) => ops.filter((o) => o.type === "return" && !o.voided && o.item_id).map((o) => {
    const it = list.find((i) => i.id === o.item_id);
    if (!it) return null;
    const q = Number(o.qty) || 0, amount = round2(q * (Number(it.price) || 0)), cost_amount = round2(q * (Number(it.cost) || 0));
    const patch = {};
    if (Math.abs(amount - (Number(o.amount) || 0)) > 0.004) patch.amount = amount;
    if (fin && Math.abs(cost_amount - (Number(o.cost_amount) || 0)) > 0.004) patch.cost_amount = cost_amount;
    return Object.keys(patch).length ? { o, it, patch } : null;
  }).filter(Boolean);
  const syncReturns = async (list) => {
    let n = 0;
    for (const { o, it, patch } of retMismatch(list)) {
      const r = await db.from("finance_ops").update(patch).eq("id", o.id);
      if (r.error) continue;
      n++;
      if (patch.amount != null) await logAction("Возврат пересчитан по цене продажи", "object:" + obj.name, (it.name || "") + " × " + fmt(o.qty) + ": было " + fmt2(o.amount) + " → стало " + fmt2(patch.amount));
    }
    return n;
  };
  const setItemPrice = async (iid, price) => {
    const ok = await saveItems((cur) => cur.map((i) => (i.id === iid ? { ...i, price } : i)));
    if (ok) {
      await logAction("Изменена цена", "object:" + obj.name, itemName(iid) + ": " + fmt2(price));
      if (await syncReturns((obj.items || []).map((i) => (i.id === iid ? { ...i, price } : i)))) { await reload(); toast("Возвраты по этой позиции пересчитаны по новой цене"); }
    }
    return ok;
  };
  const saveItem = async (item) => {
    const ok = await saveItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, ...item } : i)));
    if (ok) {
      await logAction("Изменена позиция", "object:" + obj.name, (item.name || "") + " × " + fmt(item.qty) + " по " + fmt2(item.price));
      const n = await syncReturns((obj.items || []).map((i) => (i.id === item.id ? { ...i, ...item } : i)));
      if (n) await reload();
      toast(n ? "Позиция обновлена, возвраты пересчитаны по новой цене" : "Позиция обновлена");
    }
    return ok;
  };
  // «Наценка от себестоимости»: цена каждой позиции = себестоимость × (1 + %/100) (всего объекта или одной поставки);
  // позиции без себестоимости не меняются; возвраты по изменённым позициям пересчитываются по новой цене
  const applyPercent = async (pct, batchNo) => {
    const k = 1 + pct / 100;
    const inScope = (i) => (batchNo == null || (i.batch_no || 1) === batchNo) && Number(i.cost) > 0;
    const before = (obj.items || []).filter(inScope).reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
    const newPrice = (i) => round2((Number(i.cost) || 0) * k);
    if (!(await confirmLowPrice((obj.items || []).filter(inScope).map((i) => ({ name: i.name, price: newPrice(i), cost: i.cost }))))) return false;
    const ok = await saveItems((cur) => cur.map((i) => (inScope(i) ? { ...i, price: newPrice(i) } : i)));
    if (!ok) return false;
    const after = (obj.items || []).filter(inScope).reduce((a, i) => a + (Number(i.qty) || 0) * newPrice(i), 0);
    await logAction("Наценка от себестоимости: " + fmt(pct) + "%", "object:" + obj.name, (batchNo == null ? "все поставки" : "поставка №" + batchNo) + ": было " + fmt2(before) + " → стало " + fmt2(after));
    const n = await syncReturns((obj.items || []).map((i) => (inScope(i) ? { ...i, price: newPrice(i) } : i)));
    if (n) await reload();
    toast("Наценка " + fmt(pct) + "% от себестоимости: " + fmt2(before) + " → " + fmt2(after) + (n ? " · возвраты пересчитаны" : ""));
    return true;
  };
  // «Отгрузить товар»: отмеченные позиции становятся отгруженными → появляется долг поставщикам
  const shipItems = async (ids, date, on = true) => {
    const set = new Set(ids);
    const ok = await saveItems((cur) => cur.map((i) => (set.has(i.id) ? (on ? { ...i, shipped: true, shipped_date: date || today() } : { ...i, shipped: false, shipped_date: null }) : i)));
    if (ok) {
      const list = (obj.items || []).filter((i) => set.has(i.id));
      const sum = list.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0);
      await logAction(on ? "Товар отгружен" : "Отгрузка отменена", "object:" + obj.name, "позиций: " + list.length + (fin ? ", себестоимость: " + fmt2(sum) : "") + (on ? ", дата: " + dt(date || today()) : ""));
      toast(on ? "Отгружено позиций: " + list.length + " — долг поставщикам обновлён" : "Отгрузка отменена: " + list.length + " поз.");
    }
    return ok;
  };
  // newBatch: true → создаём новую поставку с новым номером. false → добавляем в последнюю существующую поставку (или №1, если поставок ещё нет)
  const addManualItems = async (rows, newBatch) => {
    let batchNo = 1, whOut = [];
    const ok = await saveItems((cur) => {
      const exNos = cur.map((i) => i.batch_no || 1);
      const lastNo = exNos.length ? Math.max(...exNos) : 0;
      batchNo = newBatch ? lastNo + 1 : (lastNo || 1);
      const batchDate = newBatch || !lastNo ? today() : (cur.find((i) => (i.batch_no || 1) === batchNo) || {}).batch_date || today();
      const sp = splitByWarehouse(rows.map((r) => ({ ...r, qty: parseNum(r.qty) })), data.warehouse, (r, qty, w) => {
        const it = {
          id: uuid(), product_id: r.product_id || null, name: r.name, size: r.size, unit: r.unit || "шт",
          qty, price: parseNum(r.price), cost: parseNum(r.cost), supplier_id: r.supplier_id || null,
          source_text: "добавлено вручную", confidence: 100, batch_no: batchNo, batch_date: batchDate, manual: true, shipped: false, added_at: new Date().toISOString(),
        };
        if (w) { Object.assign(it, whItemPatch(w)); delete it.shipped; }
        return it;
      });
      whOut = sp.whOut;
      return [...cur, ...sp.items];
    });
    let whFail = 0;
    if (ok && whOut.length) { whFail = await warehouseOut(whOut, obj, curUserName()); await reload(); }
    if (ok) {
      await logAction(newBatch ? "Новая поставка" : "Добавлены позиции", "object:" + obj.name, "поставка №" + batchNo + ", позиций: " + rows.length);
      toast((newBatch ? "Новая поставка №" + batchNo + ": " : "Добавлено в поставку №" + batchNo + ": ") + rows.length + " поз." + (whOut.length ? " · со Склада Thermo: " + whOut.length + " поз." : "") + (whFail ? " · ⚠ склад не списан у " + whFail + " поз." : ""));
    }
    return ok;
  };
  // удаление операции (вместо сторно). След остаётся в «Журнале».
  const deleteOp = async (op) => {
    // возврат, оприходованный на склад, — убираем со склада (если он не был сторнирован раньше)
    const wentToWh = op.type === "return" && !op.voided && !supplierReturnIds(finance_ops, data.wh_moves).has(op.id);
    const r = await db.from("finance_ops").delete().eq("id", op.id);
    if (r.error) return;
    let whNote = "";
    if (wentToWh && (op.product_id || op.product_name)) {
      const w = await whFind(op.product_id, op.product_name, op.size);
      if (w.row) {
        const u = await db.from("warehouse").update({ qty: Math.max(0, round2((Number(w.row.qty) || 0) - (Number(op.qty) || 0))) }).eq("id", w.row.id);
        if (!u.error) {
          await db.from("wh_moves").insert(cleanUuids({ product_id: op.product_id || null, name: op.product_name, qty: op.qty, dir: "out", object_id: obj.id, object_name: obj.name, op_date: today(), user: curUserName(), note: "удалён возврат" }));
          whNote = " · со склада списано " + fmt(op.qty);
        }
      }
    }
    await logAction("Удалена операция: " + opLabel(op.type), "object:" + obj.name,
      fmt(op.amount) + " от " + dt(op.op_date || op.created_at) + [op.product_name, op.reason, op.note].filter(Boolean).map((x) => " · " + x).join("") + whNote);
    setDelAsk(null); await reload(); toast("Операция удалена" + whNote);
  };
  const safe = (s) => String(s || "object").replace(/[^a-zа-яё0-9_-]+/gi, "_").slice(0, 40);
  /* Excel клиенту — утверждённый шаблон (руководитель, 03.10.2026), менять только по его просьбе:
     ОБЪЕКТ: имя (крупно) · «Клиент: … · тел. …» и «Дата: …» жирным
     ПОСТАВКА №N от дата → № | Наименование | Кол-во | Ед. | Цена | Сумма → «Итого по поставке №N»
     возвраты по датам: «Дата: …» (красным) → ВОЗВРАТЫ → та же шапка, строки красным → «Итого возвратов :» (минусом)
     оплаты по датам: «Дата: …» → ОПЛАТЫ → № | Способ оплаты | Кол-во (сумма в валюте) | Курс | Сумма $ → «Итого оплачено :»
     итог (без рамок, подпись по центру, сумма справа): Сумма выданного товара: / Скидка: / Возвраты: (красным) / Оплачено: / Баланс : (или «Переплата клиента :»);
     «Баланс» = 0, пока оплат нет; после оплат — остаток к оплате
     шрифты: текст — Baskerville Old Face, числа — Times New Roman */
  const exportClient = () => {
    const rows = [
      { k: "title", v: ["ОБЪЕКТ: " + (obj.name || "")] },
      { k: "section", v: ["Клиент: " + (obj.client || "—") + (obj.phone ? " · тел. " + obj.phone : "")] },
      { k: "section", v: ["Дата: " + new Date().toLocaleDateString("ru-RU")] },
      { k: "blank" },
    ];
    const tot = (label, v, red) => rows.push({ k: "total", v: [label, v], red });
    const HEAD = ["№", "Наименование", "Кол-во", "Ед.", "Цена", "Сумма"];
    const opDay = (o) => String(o.op_date || o.created_at || "").slice(0, 10);
    const byDay = (list) => {
      const g = [];
      list.slice().sort((a, b) => opDay(a).localeCompare(opDay(b))).forEach((o) => {
        const last = g[g.length - 1];
        if (last && last.day === opDay(o)) last.ops.push(o); else g.push({ day: opDay(o), ops: [o] });
      });
      return g;
    };
    let n = 1;
    batches.forEach((b) => {
      rows.push({ k: "section", v: ["ПОСТАВКА №" + b.no + " от " + dt(b.date)] });
      rows.push({ k: "head", v: HEAD });
      let sub = 0;
      b.items.forEach((i) => {
        const s = Math.round(i.qty * i.price * 100) / 100; sub += s;
        rows.push({ k: "row", v: [n++, i.name, i.qty, i.unit, i.price, s] });
      });
      tot("Итого по поставке №" + b.no, Math.round(sub * 100) / 100);
      rows.push({ k: "blank" });
    });
    // возвраты — блоками по дате
    byDay(ops.filter((o) => o.type === "return" && !o.voided)).forEach(({ day, ops: list }) => {
      rows.push({ k: "section", v: ["Дата: " + dt(day)], red: true });
      rows.push({ k: "blank" });
      rows.push({ k: "section", v: ["ВОЗВРАТЫ"], red: true });
      rows.push({ k: "head", v: HEAD });
      let sub = 0;
      list.forEach((o, k) => {
        const amt = round2(o.amount || 0), q = Number(o.qty) || 0; sub += amt;
        rows.push({ k: "row", v: [k + 1, o.product_name || "", q || "", o.unit || "", q ? round2(amt / q) : "", amt], red: true });
      });
      tot("Итого возвратов :", -round2(sub), true);
      rows.push({ k: "blank" });
    });
    // оплаты клиента — блоками по дате: способ, сумма в валюте оплаты, курс, сумма в $
    byDay(ops.filter((o) => o.type === "client_payment" && !o.voided)).forEach(({ day, ops: list }) => {
      rows.push({ k: "section", v: ["Дата: " + dt(day)] });
      rows.push({ k: "blank" });
      rows.push({ k: "section", v: ["ОПЛАТЫ"] });
      rows.push({ k: "head", v: ["№", "Способ оплаты", "Кол-во", "Курс", "", "Сумма"], merge: [[3, 4]] });
      let sub = 0;
      list.forEach((o, k) => {
        const i = payInfo(o), usd = round2(o.amount || 0); sub += usd;
        const uzs = i.cur === "uzs";
        const label = i.id ? (payMethod(i.id).cur === null ? i.label + (uzs ? " сум" : " $") : i.label) : "Оплата";
        rows.push({ k: "row", v: [k + 1, label, uzs ? (i.uzs ? fmt(i.uzs) : "") : usd, uzs ? (i.rate ? fmt(i.rate) : "") : 1, "", usd], merge: [[3, 4]] });
      });
      tot("Итого оплачено :", round2(sub));
      rows.push({ k: "blank" });
    });
    // итоговый блок — как в утверждённом шаблоне: без рамок, подпись по центру, сумма справа
    const ftot = (label, v, red) => rows.push({ k: "ftotal", v: [label, v], red });
    ftot("Сумма выданного товара:", round2(f.sale));
    if (f.discount) ftot("Скидка:", -round2(f.discount));
    if (f.retSale) ftot("Возвраты:", -round2(f.retSale), true);
    ftot("Оплачено:", round2(f.paidClient));
    // по просьбе руководителя: пока клиент ничего не оплатил — «Баланс : 0», после оплат — остаток к оплате
    if (!(f.paidClient > 0)) ftot("Баланс :", 0);
    else ftot(f.clientDebt < 0 ? "Переплата клиента :" : "Баланс :", Math.abs(round2(f.clientDebt)));
    const r = downloadStyledXLSX("Объект_" + safe(obj.name) + ".xlsx", "Клиенту", rows, [6, 60, 10, 7, 13, 15], ["c", "t", "n", "c", "m", "m"]);
    toast(r === "xlsx" ? "Excel для клиента скачан" : r === "csv" ? "Excel заблокирован — скачан CSV" : "Скачивание заблокировано браузером");
  };
  // внутренний Excel: себестоимость, цена и наценка по каждой позиции (клиенту не отправлять)
  const exportCost = () => {
    const rows = [
      { k: "title", v: ["СЕБЕСТОИМОСТЬ И НАЦЕНКА: " + (obj.name || "")] },
      { k: "section", v: ["Клиент: " + (obj.client || "—") + (obj.phone ? " · тел. " + obj.phone : "")] },
      { k: "section", v: ["Дата: " + new Date().toLocaleDateString("ru-RU") + " · статус: " + stById(obj.status).label] },
      { k: "section", v: ["Внутренний документ — клиенту не отправлять"], red: true },
      { k: "blank" },
    ];
    const HEAD = ["№", "Наименование", "Кол-во", "Ед.", "Себест. за ед.", "Цена за ед.", "Наценка за ед.", "Наценка, %", "Сумма себест.", "Сумма продажи", "Прибыль"];
    const pct = (c, p) => (c > 0 ? round2(((p - c) / c) * 100) : "");
    let n = 1, tc = 0, ts = 0, noCost = 0;
    batches.forEach((b) => {
      rows.push({ k: "section", v: ["ПОСТАВКА №" + b.no + " от " + dt(b.date)] });
      rows.push({ k: "head", v: HEAD });
      let bc = 0, bs = 0;
      b.items.forEach((i) => {
        const q = Number(i.qty) || 0, c = Number(i.cost) || 0, p = Number(i.price) || 0;
        const sc = round2(q * c), ss = round2(q * p);
        bc += sc; bs += ss;
        if (!(c > 0)) noCost++;
        rows.push({ k: "row", v: [n++, i.name + (i.from_warehouse ? " (со склада)" : "") + (i.supplier_id ? " · " + supName(i.supplier_id) : ""), q, i.unit || "", Math.round(c * 10000) / 10000, p, Math.round((p - c) * 10000) / 10000, c > 0 ? pct(c, p) : "нет себест.", sc, ss, round2(ss - sc)], red: p < c || !(c > 0) });
      });
      tc += bc; ts += bs;
      rows.push({ k: "sum", v: ["", "Итого по поставке №" + b.no, "", "", "", "", "", pct(bc, bs), round2(bc), round2(bs), round2(bs - bc)], merge: [[1, 6]] });
      rows.push({ k: "blank" });
    });
    rows.push({ k: "head", v: ["", "ИТОГО ПО ОБЪЕКТУ", "", "", "", "", "", "Наценка, %", "Себест.", "Продажа", "Прибыль"], merge: [[1, 6]] });
    rows.push({ k: "sum", v: ["", "Товар выдан", "", "", "", "", "", pct(tc, ts), round2(tc), round2(ts), round2(ts - tc)], merge: [[1, 6]] });
    if (f.retSale) rows.push({ k: "sum", v: ["", "Возвраты", "", "", "", "", "", "", -round2(f.retCost), -round2(f.retSale), -round2(f.retSale - f.retCost)], merge: [[1, 6]], red: true });
    if (f.discount) rows.push({ k: "sum", v: ["", "Скидка клиенту", "", "", "", "", "", "", "", -round2(f.discount), -round2(f.discount)], merge: [[1, 6]] });
    rows.push({ k: "sum", v: ["", "Валовая прибыль", "", "", "", "", "", pct(f.costNet, f.saleNet), round2(f.costNet), round2(f.saleNet), round2(f.gross)], merge: [[1, 6]] });
    if (fin) {
      if (f.expense) rows.push({ k: "sum", v: ["", "Доп. расходы", "", "", "", "", "", "", "", "", -round2(f.expense)], merge: [[1, 6]] });
      if (f.bonus) rows.push({ k: "sum", v: ["", "Бонус мастеру", "", "", "", "", "", "", "", "", -round2(f.bonus)], merge: [[1, 6]] });
      rows.push({ k: "sum", v: ["", "Чистая прибыль (маржа " + fmt(round2(f.margin)) + "% от продажи)", "", "", "", "", "", "", "", "", round2(f.net)], merge: [[1, 6]] });
    }
    rows.push({ k: "blank" });
    rows.push({ k: "info", v: ["Наценка, % считается от себестоимости по фактическим ценам. Цена продажи округляется до центов, поэтому у дешёвых позиций (несколько центов) процент заметно отличается от заданного."] });
    if (noCost) rows.push({ k: "section", v: ["⚠ У " + noCost + " поз. не указана себестоимость — прибыль и наценка по ним завышены. Укажите себестоимость в объекте (кнопка «ред.»)."], red: true });
    const r = downloadStyledXLSX("Себестоимость_" + safe(obj.name) + ".xlsx", "Себестоимость", rows, [5, 46, 8, 6, 12, 12, 12, 11, 13, 13, 12], ["c", "t", "n", "c", "p", "m", "p", "m", "m", "m", "m"], { green: [10] });
    toast(r === "xlsx" ? "Excel с себестоимостью скачан" : r === "csv" ? "Excel заблокирован — скачан CSV" : "Скачивание заблокировано браузером");
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
        rows.push({ k: "head", v: ["№", "Наименование", "Кол-во", "Ед.", "Получено ✓"] });
        items.forEach((i, k) => rows.push({ k: "row", v: [k + 1, i.name, i.qty, i.unit, ""] }));
        rows.push({ k: "blank" });
      });
    });
    const r = downloadStyledXLSX("Доставка_" + safe(obj.name) + ".xlsx", "Доставка", rows, [6, 66, 10, 8, 15], ["c", "t", "n", "c", "c"]);
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

  const unshippedCnt = (obj.items || []).filter((i) => !isShipped(i)).length;
  const KPI = ({ l, v, c }) => <div className="kpi"><div className="l">{l}</div><div className="v" style={{ color: c }}>{fmt(v)}</div></div>;
  const shownOps = ops.filter((o) => !MASTER_ONLY_OPS.includes(o.type) && (fin || MANAGER_OP_TYPES.includes(o.type))).slice().reverse();
  return (
    <div>
      <div className="row sect">
        <button className="btn" onClick={back}>← Объекты</button>
        <div style={{ marginRight: "auto" }}>
          <h2>{obj.name}</h2>
          <div className="sm mut">
            {obj.client} · {obj.phone} · менеджер:{" "}
            <PersonSelect compact value={obj.manager || ""} onChange={(m) => setField({ manager: m || null }, "менеджер")} />
            {" "}· мастер:{" "}
            <select className="inp" style={{ display: "inline-block", width: "auto", padding: "2px 6px", fontSize: 12 }} value={obj.master_id || ""}
              onChange={(e) => { const m = masters.find((x) => x.id === e.target.value); setField({ master_id: e.target.value || null, master: m ? m.name : obj.master }, "мастер"); }}>
              <option value="">{obj.master && !obj.master_id ? obj.master + " (без привязки)" : "—"}</option>
              {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
        <select className="inp" style={{ maxWidth: 190 }} value={obj.status} onChange={(e) => setStatus(e.target.value)}>
          {statusOptions(obj.status).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button className="btn" onClick={exportClient}>⬇ Excel клиенту</button>
        <button className="btn" onClick={exportDelivery}>🚚 Лист доставки</button>
        <button className="btn" onClick={exportCost} title="Внутренний: себестоимость, цена и наценка по каждой позиции">📊 Excel себестоимость</button>
      </div>

      <div className="kpis sect">
        <KPI l="Сумма товара (нетто)" v={f.saleNet} />
        <KPI l="Оплачено клиентом" v={f.paidClient} c="var(--ok)" />
        <KPI l={f.clientDebt < 0 ? "Переплата клиента" : "Долг клиента"} v={Math.abs(f.clientDebt)} c={f.clientDebt > 0 ? "var(--bad)" : f.clientDebt < 0 ? "var(--txt)" : "var(--mut)"} />
      </div>

      <div className="row sect" style={{ marginBottom: 8 }}>
        <h3 style={{ marginRight: "auto" }}>Материалы объекта</h3>
        {(obj.items || []).some((i) => !i.from_warehouse) && <button className="btn" style={unshippedCnt ? { borderColor: "var(--warn)", color: "var(--warn)", fontWeight: 700 } : undefined} onClick={() => setShipForm(true)}>🚚 Отгрузить товар{unshippedCnt ? " (" + unshippedCnt + ")" : " ✓"}</button>}
        <button className="btn" onClick={() => setAddItems(true)}>+ Список вручную</button>
        <button className="btn pri" onClick={() => setAddItems("newbatch")}>📦 Новая поставка</button>
        <button className="btn" onClick={() => setImpItems(true)}>📊 Импорт Excel</button>
      </div>
      <div className="card sect" style={{ padding: 0, overflow: "auto" }}>
        <table className="t" style={{ minWidth: 760 }}>
          <thead><tr><th>Товар</th><th style={{width:90}}>Кол-во</th><th>Ед.</th><th style={{textAlign:"center",width:120}}>Цена</th><th style={{textAlign:"right"}}>Сумма</th><th></th></tr></thead>
          <tbody>
            {batches.map((b) => (
              <React.Fragment key={b.no}>
                {batches.length > 1 || (obj.items || []).some((i) => i.batch_no) ? (
                  <tr className="clk" onClick={() => toggleBatch(b.no)}>
                    <td colSpan={6} style={{ background: "var(--acc-tint)", fontWeight: 800, fontSize: 12, letterSpacing: ".5px", userSelect: "none" }}>
                      {closedBatches[b.no] ? "▸" : "▾"} 🚚 ПОСТАВКА №{b.no} · {dt(b.date)} · позиций: {b.items.length} · на сумму {fmt(b.items.reduce((a, i) => a + i.qty * i.price, 0))}
                      {b.items.some((i) => !isShipped(i)) ? <span style={{ color: "var(--warn)" }}> · не отгружено: {b.items.filter((i) => !isShipped(i)).length}</span> : b.items.some((i) => i.shipped) ? <span style={{ color: "var(--ok)" }}> · отгружено ✓</span> : null}
                      <span className="xs mut" style={{ fontWeight: 500 }}>  — нажмите чтобы {closedBatches[b.no] ? "раскрыть" : "свернуть"}</span>
                    </td>
                  </tr>
                ) : null}
                {!closedBatches[b.no] && b.items.map((i) => (
              <ObjectItemRow key={i.id} i={i} fin={fin} supName={supName} setItemQty={setItemQty} setItemPrice={setItemPrice} setEditItem={setEditItem} setDelItemId={setDelItemId} />
                ))}
              </React.Fragment>
            ))}
            {!(obj.items || []).length && <tr><td colSpan={6} className="mut" style={{ textAlign: "center", padding: 22 }}>Материалов нет — добавьте через «Новая заявка»</td></tr>}
          </tbody>
        </table>
      </div>

      {retMismatch().some((x) => x.patch.amount != null) && (
        <div className="card sect row" style={{ borderColor: "var(--warn)", gap: 10 }}>
          <div className="sm" style={{ marginRight: "auto" }}>⚠ Сумма возврата не совпадает с ценой продажи: {retMismatch().filter((x) => x.patch.amount != null).map(({ o, it, patch }) => (it.name || "").slice(0, 40) + " — возврат " + fmt2(o.amount) + ", по цене продажи " + fmt2(patch.amount)).join("; ")}</div>
          <button className="btn pri" onClick={async () => { const n = await syncReturns(); await reload(); toast(n ? "Возвраты пересчитаны по цене продажи: " + n : "Не удалось пересчитать"); }}>Пересчитать по цене продажи</button>
        </div>
      )}
      <div className="row sect">
        <h3 style={{ marginRight: "auto" }}>Финансовые операции</h3>
        {OP_TYPES.filter((t) => (fin ? OBJECT_OP_TYPES : MANAGER_OP_TYPES).includes(t.id)).map((t) => <React.Fragment key={t.id}>
          <button className="btn xs" onClick={() => setOpForm({ type: t.id })}>+ {t.label}</button>
          {t.id === "discount" && (obj.items || []).length > 0 && <button className="btn xs" onClick={() => setPctForm(true)} title="Цена продажи = себестоимость + наценка %">+ Наценка от себестоимости</button>}
        </React.Fragment>)}
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Дата</th><th>Тип</th><th style={{textAlign:"right"}}>Сумма</th><th>Детали</th><th></th></tr></thead>
          <tbody>
            {shownOps.map((o) => (
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
            {!shownOps.length && <tr><td colSpan={5} className="mut" style={{ textAlign: "center", padding: 20 }}>Операций нет</td></tr>}
          </tbody>
        </table>
      </div>
      {delItemId && (
        <Modal title="Удалить позицию?" onClose={() => setDelItemId(null)} w={420}>
          <p className="sm mut">Позиция будет удалена из объекта. Это действие нельзя отменить.</p>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
            <button className="btn" onClick={() => setDelItemId(null)}>Отмена</button>
            <button className="btn dng" onClick={async () => { const id = delItemId; setDelItemId(null); await delItem(id); }}>Удалить</button>
          </div>
        </Modal>
      )}
      {editItem && <ItemEditModal item={editItem} suppliers={suppliers} fin={fin} onClose={() => setEditItem(null)} onSave={async (it) => { if (await saveItem(it)) setEditItem(null); }} />}
      {pctForm && <PercentModal obj={obj} batches={batches} onClose={() => setPctForm(false)} onApply={async (pct, no) => { if (await applyPercent(pct, no)) setPctForm(false); }} />}
      {shipForm && <ShipModal obj={obj} batches={batches} fin={fin} supName={supName} onClose={() => setShipForm(false)}
        onShip={async (ids, date) => { if (await shipItems(ids, date, true)) setShipForm(false); }}
        onUnship={async (ids) => { await shipItems(ids, null, false); }} />}
      {addItems && <AddItemsModal products={products} suppliers={suppliers} whQty={whQtyMap(data.warehouse)} newBatch={addItems === "newbatch"} onClose={() => setAddItems(false)} onSave={async (rows) => { if (await addManualItems(rows, addItems === "newbatch")) setAddItems(false); }} />}
      {impItems && <ObjectExcelImport products={products} suppliers={suppliers} onClose={() => setImpItems(false)} onSave={async (rows) => { if (await addManualItems(rows, false)) setImpItems(false); }} />}
      {editOp && <EditOpModal op={editOp} suppliers={suppliers} isReturn={editOp.type === "return"} onClose={() => setEditOp(null)} onSave={async (patch) => {
        const log = [...(editOp.edit_log || []), { at: new Date().toISOString(), before: { amount: editOp.amount, op_date: editOp.op_date, note: editOp.note, reason: editOp.reason } }];
        const r = await db.from("finance_ops").update({ ...patch, edited: true, edit_log: log }).eq("id", editOp.id);
        if (r.error) return;
        const pt = (o) => (isPayType(editOp.type) ? " (" + payText(o) + ")" : "");
        await logAction("Изменена операция: " + opLabel(editOp.type), "object:" + obj.name, "было " + fmt(editOp.amount) + pt(editOp) + (patch.amount != null ? " → " + fmt(patch.amount) + pt({ ...editOp, ...patch }) : ""));
        setEditOp(null); await reload(); toast("Операция изменена (было и стало — в «Журнале»)");
      }} />}
      {opForm && opForm.type === "return" && <ReturnForm obj={obj} ops={ops} onClose={() => setOpForm(null)} onSave={async (list) => {
        const rows = list.map(({ _toWh, _supplier, ...op }) => cleanUuids(op));
        const r = await db.from("finance_ops").insert(rows);
        if (r.error) return; // ошибка уже показана на экране, окно остаётся открытым
        const toWh = list.filter((x) => x._toWh).map(({ _toWh, _supplier, ...op }) => ({ ...op, supplier_id: _supplier }));
        const toSup = list.length - toWh.length;
        const whFail = toWh.length ? await warehouseIn(toWh, obj.name) : 0;
        await logAction("Возврат товара", "object:" + obj.name, "позиций: " + list.length + (toWh.length ? ", на склад: " + toWh.length : "") + (toSup ? ", поставщику: " + toSup : "") + ", сумма: " + fmt(list.reduce((a,x)=>a+(x.amount||0),0)) + (whFail ? ", НЕ оприходовано на склад: " + whFail : ""));
        setOpForm(null); await reload();
        toast("Возврат оформлен: " + list.length + " поз." + (toWh.length ? " → Склад Thermo: " + (toWh.length - whFail) : "") + (toSup ? " → поставщику: " + toSup + " (долг уменьшен)" : "") + (whFail ? " · ⚠ на склад не записано: " + whFail + " — проверьте Склад" : ""));
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

function PercentModal({ obj, batches, onClose, onApply }) {
  const [pct, setPct] = useState("");
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);
  const p = parseNum(pct);
  const inBatch = (obj.items || []).filter((i) => scope === "all" || String(i.batch_no || 1) === scope);
  const list = inBatch.filter((i) => Number(i.cost) > 0);
  const noCost = inBatch.length - list.length;
  const before = list.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const cost = list.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0);
  const after = list.reduce((a, i) => a + (Number(i.qty) || 0) * round2((Number(i.cost) || 0) * (1 + p / 100)), 0);
  const valid = pct !== "" && p > -100;
  return (
    <Modal title="Наценка от себестоимости" onClose={onClose} w={500}>
      <p className="sm mut" style={{ marginBottom: 10 }}>Новая цена продажи каждой позиции = <b>себестоимость + наценка %</b>. Текущие цены продажи заменяются.</p>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Fld label="Наценка, %"><input type="number" className="inp" autoFocus style={{ fontSize: 18, fontWeight: 700 }} value={pct} onChange={(e) => setPct(e.target.value)} placeholder="например 20" /></Fld>
        <Fld label="К каким товарам">
          <select className="inp" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Все поставки объекта</option>
            {batches.length > 1 && batches.map((b) => <option key={b.no} value={String(b.no)}>Поставка №{b.no} · {dt(b.date)}</option>)}
          </select>
        </Fld>
      </div>
      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        {[10, 15, 20, 25, 30].map((x) => <button key={x} className={"btn xs " + (p === x && pct !== "" ? "pri" : "")} onClick={() => setPct(String(x))}>{x}%</button>)}
      </div>
      <div className="card" style={{ marginTop: 12, padding: "10px 12px" }}>
        <div className="sm">Позиций: <b>{list.length}</b>{noCost > 0 && <span style={{ color: "var(--warn)" }}> · без себестоимости: {noCost} (их цена не изменится)</span>}</div>
        <div className="sm">Себестоимость: <b className="mono">{fmt2(cost)}</b></div>
        <div className="sm">Сумма продажи сейчас: <b className="mono">{fmt2(before)}</b></div>
        <div className="sm">После наценки: <b className="mono" style={{ color: valid ? "var(--ok)" : "var(--mut)" }}>{fmt2(valid ? after : before)}</b>{valid && <span className="xs mut"> ({after - before >= 0 ? "+" : "−"}{fmt2(Math.abs(after - before))} к текущей · прибыль {fmt2(after - cost)})</span>}</div>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14, gap: 8 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" disabled={!valid || !list.length || busy} onClick={async () => { setBusy(true); await onApply(p, scope === "all" ? null : Number(scope)); setBusy(false); }}>{busy ? "Применяю…" : "Применить наценку " + (valid ? fmt(p) + "%" : "")}</button>
      </div>
    </Modal>
  );
}
function ShipModal({ obj, batches, fin, supName, onClose, onShip, onUnship }) {
  const items = (obj.items || []).filter((i) => !i.from_warehouse);
  const pending = items.filter((i) => !isShipped(i));
  const [sel, setSel] = useState(() => new Set(pending.map((i) => i.id)));
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(!pending.length);
  const toggle = (id) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const selSum = pending.filter((i) => sel.has(i.id)).reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0);
  const bySup = {};
  pending.filter((i) => sel.has(i.id)).forEach((i) => { const k = i.supplier_id ? supName(i.supplier_id) : "без поставщика"; bySup[k] = (bySup[k] || 0) + (Number(i.qty) || 0) * (Number(i.cost) || 0); });
  const done = items.filter((i) => isShipped(i) && i.shipped);
  return (
    <Modal title={"Отгрузить товар — " + obj.name} onClose={onClose} w={760}>
      <p className="sm mut" style={{ marginBottom: 10 }}>Долг перед поставщиками появляется только после отгрузки. Отметьте позиции, которые отгружаются клиенту.</p>
      {pending.length ? (<>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <button className="btn xs" onClick={() => setSel(new Set(pending.map((i) => i.id)))}>выбрать все</button>
          <button className="btn xs" onClick={() => setSel(new Set())}>снять все</button>
          <span className="xs mut" style={{ marginLeft: "auto" }}>Дата отгрузки</span>
          <input type="date" className="inp" style={{ width: 160 }} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="card" style={{ padding: 0, overflow: "auto", maxHeight: 380 }}>
          <table className="t">
            <thead><tr><th style={{ width: 34 }}></th><th>Товар</th><th style={{ textAlign: "right" }}>Кол-во</th><th>Поставщик</th>{fin && <th style={{ textAlign: "right" }}>Себест. сумма</th>}</tr></thead>
            <tbody>
              {batches.map((b) => {
                const list = b.items.filter((i) => !i.from_warehouse && !isShipped(i));
                if (!list.length) return null;
                const all = list.every((i) => sel.has(i.id));
                return (
                  <React.Fragment key={b.no}>
                    <tr className="clk" onClick={() => { const n = new Set(sel); list.forEach((i) => (all ? n.delete(i.id) : n.add(i.id))); setSel(n); }}>
                      <td style={{ background: "var(--acc-tint)" }}><input type="checkbox" readOnly checked={all} /></td>
                      <td colSpan={fin ? 4 : 3} style={{ background: "var(--acc-tint)", fontWeight: 800, fontSize: 12 }}>ПОСТАВКА №{b.no} · {dt(b.date)} · позиций: {list.length}</td>
                    </tr>
                    {list.map((i) => (
                      <tr key={i.id} className="clk" onClick={() => toggle(i.id)}>
                        <td><input type="checkbox" readOnly checked={sel.has(i.id)} /></td>
                        <td className="sm" style={{ fontWeight: 600 }}>{i.name}</td>
                        <td className="num">{fmt(i.qty)} {i.unit}</td>
                        <td className="sm">{i.supplier_id ? supName(i.supplier_id) : <span className="mut">—</span>}</td>
                        {fin && <td className="num">{fmt2((Number(i.qty) || 0) * (Number(i.cost) || 0))}</td>}
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {fin && sel.size > 0 && <div className="xs mut" style={{ marginTop: 8 }}>Долг поставщикам увеличится: {Object.entries(bySup).map(([k, v]) => k + " — " + fmt2(v)).join(" · ")} · всего <b>{fmt2(selSum)}</b></div>}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn pri" disabled={!sel.size || busy} onClick={async () => { setBusy(true); await onShip([...sel], date); setBusy(false); }}>{busy ? "Отгружаю…" : "🚚 Отгрузить (" + sel.size + ")"}</button>
        </div>
      </>) : <p className="sm" style={{ color: "var(--ok)", marginBottom: 8 }}>✓ Все позиции отгружены</p>}
      {done.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button className="btn xs" onClick={() => setShowDone(!showDone)}>{showDone ? "▾" : "▸"} Отгружено ранее ({done.length})</button>
          {showDone && <div className="card" style={{ padding: 0, overflow: "auto", maxHeight: 260, marginTop: 8 }}>
            <table className="t">
              <thead><tr><th>Товар</th><th style={{ textAlign: "right" }}>Кол-во</th><th>Поставщик</th><th>Дата отгрузки</th><th></th></tr></thead>
              <tbody>{done.map((i) => (
                <tr key={i.id}>
                  <td className="sm">{i.name}</td><td className="num">{fmt(i.qty)} {i.unit}</td>
                  <td className="sm">{i.supplier_id ? supName(i.supplier_id) : "—"}</td>
                  <td className="xs mono">{dt(i.shipped_date)}</td>
                  <td>{fin && <button className="btn xs" disabled={busy} onClick={async () => { setBusy(true); await onUnship([i.id]); setBusy(false); }}>отменить</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>}
        </div>
      )}
    </Modal>
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
      <td style={{ fontWeight: 600 }}>{i.name}{i.from_warehouse && <Badge c="#3ddc7d"> склад</Badge>}{i.from_warehouse && <div className="xs mut">со склада Thermo</div>}{!isShipped(i) && <div className="xs" style={{ color: "var(--warn)", fontWeight: 600 }}>не отгружено</div>}</td>
      <td><input type="number" className="inp" min={0} value={qty} onChange={(e) => setQty(e.target.value)}
        onBlur={async () => { const v = Math.max(0, parseNum(qty)); if (v !== Number(i.qty)) { if (!(await setItemQty(i.id, v))) setQty(i.qty); } else setQty(i.qty); }} /></td>
      <td className="sm">{i.unit}</td>
      <td style={{ textAlign: "center" }}><input type="number" className="inp num" min={0} style={{ width: 104, textAlign: "right", margin: "0 auto", display: "block" }} value={price} onChange={(e) => setPrice(e.target.value)}
        onBlur={async () => { const v = Math.max(0, parseNum(price)); if (v !== Number(i.price)) { if (!(await confirmLowPrice([{ name: i.name, price: v, cost: i.cost }])) || !(await setItemPrice(i.id, v))) setPrice(i.price); } else setPrice(i.price); }} /></td>
      <td className="num" style={{ fontWeight: 700 }}>{fmt((Number(qty) || 0) * (Number(price) || 0))}</td>
      <td><div className="row" style={{ gap: 4, flexWrap: "nowrap", justifyContent: "flex-end" }}>
        <button className="btn xs" onClick={() => setEditItem(i)}>ред.</button>
        <button className="btn xs dng" onClick={() => setDelItemId(i.id)}>✕</button>
      </div></td>
    </tr>
  );
}
function ItemEditModal({ item, suppliers, fin, onClose, onSave }) {
  const [v, setV] = useState({ ...item, qty: item.qty ?? 0, cost: item.cost ?? 0, price: item.price ?? 0 });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    const out = { ...v, name: String(v.name || "").trim(), qty: Math.max(0, parseNum(v.qty)), cost: parseNum(v.cost), price: parseNum(v.price), supplier_id: v.supplier_id || null };
    if (!(await confirmLowPrice([out]))) { setBusy(false); return; }
    await onSave(out);
    setBusy(false);
  };
  return (
    <Modal title="Редактировать позицию" onClose={onClose} w={560}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Наименование"><input className="inp" value={v.name || ""} onChange={set("name")} /></Fld></div>
        <Fld label="Ед. изм."><input className="inp" value={v.unit || ""} onChange={set("unit")} /></Fld>
        <Fld label="Количество"><input type="number" className="inp" min={0} value={v.qty} onChange={set("qty")} /></Fld>
        <Fld label="Себестоимость"><input type="number" className="inp" value={v.cost} onChange={set("cost")} /></Fld>
        <Fld label="Цена продажи"><input type="number" className="inp" value={v.price} onChange={set("price")} /></Fld>
        <Fld label="Поставщик"><select className="inp" value={v.supplier_id || ""} onChange={set("supplier_id")}><option value="">—</option>{activeSuppliers(suppliers, v.supplier_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>
      </div>
      <p className="xs mut" style={{ marginTop: 8 }}>Сумма позиции: {fmt(parseNum(v.qty) * parseNum(v.price))}</p>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" disabled={!String(v.name || "").trim() || busy} onClick={save}>{busy ? "Сохраняю…" : "Сохранить"}</button>
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
    { id: "code", label: "Код / артикул", kw: ["код", "артикул", "code", "sku"] },
  ];
  const [rows, setRows] = useState(null);
  const [map, setMap] = useState({});
  const [hasHeader, setHasHeader] = useState(true);
  const [fname, setFname] = useState("");
  const [err, setErr] = useState("");
  const fRef = useRef(null);
  const num = (v) => Number(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")) || 0;
  // сопоставление с базой — тем же поиском, что и в «Новая заявка → Загрузить из Excel» (слова, размеры, коды).
  // Раньше брался первый товар, в названии которого встречается строка: «Труба» подтягивала случайную трубу.
  const matcher = useMemo(() => buildMatcher(products.filter((p) => p.status !== "archive")), [products]);
  const findProd = (name, size, code) => {
    if (!String(name || "").trim()) return null;
    const best = matcher(String(name) + (size ? " " + size : ""), code)[0];
    return best && best.score >= MATCH_OK ? best.p : null;
  };
  const guessMap = (header) => {
    const m = {};
    header.forEach((h, i) => { const hl = String(h || "").toLowerCase(); for (const f of fieldsByPriority(FIELDS)) { if (m[f.id] == null && f.kw.some((k) => hl.includes(k))) { m[f.id] = i; break; } } });
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
  const supByName = (nm) => { const k = String(nm || "").toLowerCase().trim(); if (!k) return null; const s = suppliers.find((x) => String(x.name || "").toLowerCase().trim() === k); return s ? s.id : null; };
  const fileNum = (row, fid) => { if (map[fid] == null) return null; const raw = cell(row, fid); return String(raw == null ? "" : raw).trim() === "" ? null : num(raw); };

  const build = () => dataRows.map((row) => {
    const name = String(cell(row, "name") || "").trim();
    if (!name) return null;
    const prod = findProd(name, String(cell(row, "size") || "").trim(), cell(row, "code"));
    return {
      product_id: prod ? prod.id : null,
      name: prod ? prod.name : name,
      size: String(cell(row, "size") || (prod ? prod.size : "")).trim(),
      unit: String(cell(row, "unit") || (prod ? prod.unit : "шт")).trim() || "шт",
      qty: num(cell(row, "qty")) || 1,
      // число из файла, если в ячейке что-то есть; пустая ячейка — значение из базы товаров
      cost: fileNum(row, "cost") ?? (prod ? prod.cost : 0),
      price: fileNum(row, "price") ?? (prod ? retailOf(prod) : 0),
      supplier_id: supByName(cell(row, "supplier")) || (prod ? prod.supplier_id : null),
      _matched: !!prod,
    };
  }).filter(Boolean);

  const preview = useMemo(() => (rows ? build() : []), [rows, map, hasHeader, matcher, suppliers]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (map.name == null) { setErr("Укажите колонку «Наименование»"); return; }
    const out = preview.map(({ _matched, ...r }) => r);
    if (!(await confirmLowPrice(out))) return;
    if (!out.length) return;
    setBusy(true); await onSave(out); setBusy(false);
  };
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
            {FIELDS.filter((f) => f.id !== "size").map((f) => (
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
              <thead><tr><th>Наименование</th><th style={{textAlign:"right"}}>Кол-во</th><th>Ед.</th><th style={{textAlign:"right"}}>Себест.</th><th style={{textAlign:"right"}}>Цена</th><th>База</th></tr></thead>
              <tbody>
                {preview.slice(0, 6).map((p, i) => (
                  <tr key={i}>
                    <td className="sm" style={{ fontWeight: 600 }}>{p.name}</td>
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
            <button className="btn pri" disabled={map.name == null || !preview.length || busy} onClick={run}>{busy ? "Сохраняю…" : "Добавить " + preview.length + " поз. на объект →"}</button>
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
function AddItemsModal({ products, suppliers, newBatch, onClose, onSave, whQty = {} }) {
  const [rows, setRows] = useState([]);
  const addRow = (r) => setRows([...rows, r]);
  const blank = () => addRow({ product_id: null, name: "", size: "", unit: "шт", qty: 1, cost: 0, price: 0, supplier_id: "" });
  const upd = (i, k, val) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  const del = (i) => setRows(rows.filter((_, j) => j !== i));
  const total = rows.reduce((a, r) => a + parseNum(r.qty) * parseNum(r.price), 0);
  const valid = rows.filter((r) => String(r.name || "").trim() && parseNum(r.qty) > 0);
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const tryClose = () => setAskCancel(true);
  return (
    <>
    <Modal title={newBatch ? "Новая поставка" : "Добавить позиции вручную"} onClose={tryClose} w={860}>
      <div className="row" style={{ marginBottom: 10 }}>
        <ProductPicker products={products} suppliers={suppliers} whQty={whQty} placeholder="найти товар в базе и добавить строку…" onPick={(p) => addRow({ product_id: p.id, name: p.name, size: p.size, unit: p.unit, qty: 1, cost: p.cost, price: retailOf(p), supplier_id: p.supplier_id })} />
        <button className="btn" onClick={blank}>+ Пустая строка (товара нет в базе)</button>
      </div>
      <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 360 }}>
        <table className="t" style={{ minWidth: 760 }}>
          <thead><tr><th>Наименование</th><th style={{width:70}}>Ед.</th><th style={{width:80}}>Кол-во</th><th style={{width:110}}>Цена</th><th style={{width:140}}>Поставщик</th><th></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input className="inp" value={r.name} onChange={(e) => upd(i, "name", e.target.value)} />
                  {r.product_id && whQty[r.product_id] ? <label className="row xs" style={{ gap: 5, marginTop: 3, cursor: "pointer", color: r.fromWh !== false ? "var(--ok)" : "var(--mut)", fontWeight: 700 }}>
                    <input type="checkbox" checked={r.fromWh !== false} onChange={(e) => upd(i, "fromWh", e.target.checked)} />
                    🏬 со Склада Thermo (есть {fmt(whQty[r.product_id])}){parseNum(r.qty) > whQty[r.product_id] ? " · остальное у поставщика" : ""}
                  </label> : null}</td>
                <td><input className="inp" value={r.unit} onChange={(e) => upd(i, "unit", e.target.value)} /></td>
                <td><input type="number" className="inp" min={0} value={r.qty} onChange={(e) => upd(i, "qty", e.target.value)} style={{ borderColor: parseNum(r.qty) > 0 ? undefined : "var(--bad)" }} /></td>
                <td><input type="number" className="inp num" value={r.price} onChange={(e) => upd(i, "price", e.target.value)} /></td>
                <td><select className="inp" value={r.supplier_id || ""} onChange={(e) => upd(i, "supplier_id", e.target.value)}><option value="">—</option>{activeSuppliers(suppliers, r.supplier_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                <td><button className="btn xs dng" onClick={() => del(i)}>✕</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="mut" style={{ textAlign: "center", padding: 20 }}>Добавьте строки через поиск по базе или «Пустая строка»</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 14 }}>
        <div className="mono" style={{ fontWeight: 700 }}>Позиций: {rows.length} · Сумма: <span style={{ color: "var(--acc2)" }}>{money(total)}</span></div>
        <div className="row">
          <button className="btn" onClick={tryClose}>Отмена</button>
          <button className="btn pri" disabled={!valid.length || busy} onClick={async () => { if (!(await confirmLowPrice(valid.map((r) => ({ name: r.name, price: parseNum(r.price), cost: parseNum(r.cost) }))))) return; setBusy(true); await onSave(valid); setBusy(false); }}>{busy ? "Сохраняю…" : newBatch ? "Создать новую поставку" : "Добавить в текущую поставку"}</button>
        </div>
      </div>
    </Modal>
    {askCancel && <DiscardConfirm
      text={rows.length ? "Добавленные строки (" + rows.length + ") не будут сохранены в объект." : "Окно будет закрыто, в объект ничего не добавится."}
      onStay={() => setAskCancel(false)} onDiscard={onClose} />}
    </>
  );
}
function EditOpModal({ op, suppliers, isReturn, onClose, onSave, products = null, objects = null }) {
  // бонус мастеру: деньгами — со способом оплаты, предметом — название + цена
  const bonusItem = op.type === "bonus" && !!op.item_name;
  const bonusMoney = op.type === "bonus" && !op.item_name;
  const usesPay = isPayType(op.type) || bonusMoney; // оплаты и расходы — со способом оплаты
  const [pay, setPay] = useState(() => payInit(op));
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({
    amount: op.amount || 0, op_date: (op.op_date || op.created_at || "").slice(0, 10),
    note: op.note || "", reason: op.reason || "", supplier_id: op.supplier_id || "", item_name: op.item_name || "", user: op.user || "",
    object_id: op.object_id || "",
  });
  return (
    <Modal title={"Редактировать: " + opLabel(op.type)} onClose={onClose} w={520}>
      {isReturn && <p className="sm" style={{ color: "var(--warn)", marginBottom: 10 }}>⚠ У возврата можно изменить только дату, причину и комментарий. Количество/сумму меняйте так: удалите возврат и оформите новый — иначе разойдётся склад.</p>}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {bonusItem && products && <div style={{ gridColumn: "1/-1" }}><Fld label="Найти в товарах поставщиков (необязательно)">
          <ProductPicker closeOnPick products={products} suppliers={suppliers || []} placeholder="поиск товара: название, код, поставщик…"
            onPick={(p) => setV((x) => ({ ...x, item_name: p.name, amount: String(Number(p.cost) || retailOf(p) || x.amount) }))} />
        </Fld></div>}
        {bonusItem && <div style={{ gridColumn: "1/-1" }}><Fld label="Предмет (можно написать вручную)"><input className="inp" autoComplete="off" autoCorrect="off" spellCheck={false} name="te_bonus_thing_edit" data-lpignore="true" data-form-type="other" value={v.item_name} onChange={(e) => setV({ ...v, item_name: e.target.value })} /></Fld></div>}
        {usesPay && <PayFields p={pay} setP={setPay} methods={bonusMoney ? OUT_METHODS : payMethodsFor(op.type)} usdLabel={bonusMoney ? "Бонус, $" : payUsdLabel(op.type)} />}
        {!isReturn && !usesPay && <Fld label={bonusItem ? "Цена предмета, $" : "Сумма"}><input type="number" className="inp" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Fld>}
        {objects && (op.type === "bonus" || op.type === "bonus_payment") && <Fld label="Объект"><select className="inp" value={v.object_id} onChange={(e) => setV({ ...v, object_id: e.target.value })}>
          <option value="">— без объекта —</option>
          {objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select></Fld>}
        <Fld label="Дата операции"><input type="date" className="inp" value={v.op_date} onChange={(e) => setV({ ...v, op_date: e.target.value })} /></Fld>
        {op.type === "supplier_payment" && <Fld label="Поставщик"><select className="inp" value={v.supplier_id} onChange={(e) => setV({ ...v, supplier_id: e.target.value })}><option value="">—</option>{activeSuppliers(suppliers, v.supplier_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>}
        {bonusItem && !products && <Fld label="Предмет"><input className="inp" autoComplete="off" value={v.item_name} onChange={(e) => setV({ ...v, item_name: e.target.value })} /></Fld>}
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
        <button className="btn pri" onClick={async () => {
          const patch = { op_date: v.op_date, note: v.note, reason: v.reason, user: v.user };
          if (!isReturn) patch.amount = parseNum(v.amount);
          if (op.type === "supplier_payment") patch.supplier_id = v.supplier_id || null;
          if (bonusItem) patch.item_name = v.item_name.trim() || op.item_name;
          if (objects && (op.type === "bonus" || op.type === "bonus_payment")) patch.object_id = v.object_id || null;
          if (usesPay) Object.assign(patch, payPatch(pay, op.type, false));
          setBusy(true); await onSave(patch); setBusy(false);
        }} disabled={busy || (usesPay ? !(payUsd(pay) > 0) : !isReturn && !(parseNum(v.amount) > 0)) || (bonusItem && !v.item_name.trim())}>{busy ? "Сохраняю…" : "Сохранить"}</button>
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
    // неотгруженный товар клиенту не выдан — вернуть его нельзя
    return { item: i, done, avail: isShipped(i) ? Math.max(0, i.qty - done) : 0, ret: 0, notShipped: !isShipped(i) };
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
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
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
    await onSave(list);
    setBusy(false);
  };
  return (
    <Modal title="Возврат товара (можно несколько позиций сразу)" onClose={onClose} w={780}>
      <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 14, maxHeight: 340 }}>
        <table className="t">
          <thead><tr><th>Товар</th><th style={{textAlign:"right"}}>В объекте</th><th style={{textAlign:"right"}}>Уже возвр.</th><th style={{textAlign:"right"}}>Доступно</th><th style={{width:100}}>Вернуть</th><th style={{textAlign:"right"}}>Сумма</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.item.id} style={{ background: r.ret > 0 ? "var(--acc-tint)" : "none", opacity: r.avail === 0 ? 0.45 : 1 }}>
                <td className="sm" style={{ fontWeight: 600 }}>{r.item.name}<div className="xs mut">{fmt(r.item.price)} / {r.item.unit}{r.notShipped && <span style={{ color: "var(--warn)" }}> · не отгружено</span>}</div></td>
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
        <div className="mono" style={{ fontWeight: 700 }}>Позиций: {totalCnt} · Итого возврат: <span style={{ color: "var(--bad)" }}>{money(totalSum)}</span>
          <div className="xs mut" style={{ fontWeight: 400 }}>по цене, по которой товар выдан клиенту · себестоимость и цена товара в базе и на складе не меняются</div></div>
        <div className="row">
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn pri" disabled={!totalCnt || busy} onClick={submit}>{busy ? "Оформляю…" : "Оформить возврат"}</button>
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
  const [busy, setBusy] = useState(false);
  const item = items.find((i) => i.id === v.item_id);
  const retAmount = item ? v.qty * item.price : 0;
  const submit = async () => { setBusy(true); await submit0(); setBusy(false); };
  const submit0 = async () => {
    const base = { object_id: obj.id, type, note: v.note, reason: v.reason, user: v.user, op_date: v.op_date || today() };
    if (isReturn && item) {
      await onSave({ ...base, amount: retAmount, cost_amount: v.qty * item.cost, qty: v.qty, product_id: item.product_id, product_name: item.name, supplier_id: item.supplier_id });
    } else if (usesPay) {
      await onSave({ ...base, ...payPatch(pay, type), supplier_id: isSupPay ? v.supplier_id || null : null });
    } else {
      await onSave({ ...base, amount: parseNum(v.amount), supplier_id: isSupPay ? v.supplier_id || null : null, item_name: isBonus && v.item_name ? v.item_name : null });
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
        <button className="btn pri" onClick={submit} disabled={busy || (isReturn ? !item || !v.qty : usesPay ? !(payUsd(pay) > 0) || (isSupPay && !v.supplier_id) : !(parseNum(v.amount) > 0))} title={isSupPay && !v.supplier_id ? "Выберите поставщика — иначе оплата не уменьшит его долг" : ""}>{busy ? "Сохраняю…" : "Сохранить"}</button>
      </div>
    </Modal>
  );
}

/* ============ MASTERS TAB ============ */
function MastersTab({ data, reload, toast, openObject, fin = true, canDel = false }) {
  const { masters, objects, finance_ops } = data;
  const [openId, setOpenId] = useState(null);
  const [edit, setEdit] = useState(null);
  const m = masters.find((x) => x.id === openId);
  if (m) return <MasterDetail m={m} data={data} reload={reload} toast={toast} fin={fin} canDel={canDel} back={() => setOpenId(null)} openObject={openObject} edit={edit} setEdit={setEdit} />;
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Мастера <span className="mut sm">({masters.length})</span></h2>
        {fin && <button className="btn pri" onClick={() => setEdit({ status: "active", bonus_percent: 10 })}>+ Мастер</button>}
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Мастер</th><th>Специализация</th>{fin && <th>% бонуса</th>}<th style={{textAlign:"right"}}>Объектов</th><th style={{textAlign:"right"}}>Сумма товаров</th>{fin && <th style={{textAlign:"right"}}>Вал. прибыль</th>}{fin && <th style={{textAlign:"right"}}>Бонус начислен</th>}{fin && <th style={{textAlign:"right"}}>Выплачено</th>}{fin && <th style={{textAlign:"right"}}>Долг мастеру</th>}</tr></thead>
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
                </tr>
              );
            })}
            {!masters.length && <tr><td colSpan={fin ? 9 : 4} className="mut" style={{ textAlign: "center", padding: 24 }}>Мастеров нет</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <MasterForm m={edit} all={masters} onClose={() => setEdit(null)} onSave={async (v) => {
        const { id, created_at, ...rest } = v;
        const r = id ? await db.from("masters").update(rest).eq("id", id) : await db.from("masters").insert(rest);
        if (r.error) return false; // ошибка показана, окно остаётся открытым
        await logAction(id ? "Изменён мастер" : "Добавлен мастер", "master:" + (rest.name || ""), rest.phone || "");
        setEdit(null); await reload(); toast("Мастер сохранён"); return true;
      }} />}
    </div>
  );
}
function MasterDetail({ m, data, reload, toast, back, openObject, edit, setEdit, fin = true, canDel = false }) {
  const { objects, finance_ops } = data;
  const st = masterStats(m, objects, finance_ops);
  const [payForm, setPayForm] = useState(false);
  const [accForm, setAccForm] = useState(false);
  const [delForm, setDelForm] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delOp, setDelOp] = useState(null);
  const [editOp, setEditOp] = useState(null);
  const removeOp = async (o) => {
    const r = await db.from("finance_ops").delete().eq("id", o.id);
    if (r.error) return;
    await logAction("Удалена операция: " + opLabel(o.type), "master:" + m.name, fmt(o.amount) + " от " + dt(o.op_date || o.created_at) + (o.item_name ? " · " + o.item_name : "") + (o.note ? " · " + o.note : ""));
    setDelOp(null); await reload(); toast("Операция удалена");
  };
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
        {fin && <KPI l="Валовая прибыль" v={st.gross} c="var(--txt)" />}
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
          <thead><tr><th>Дата</th><th>Тип</th><th>Объект</th><th style={{textAlign:"right"}}>Сумма</th><th>Комментарий</th><th></th></tr></thead>
          <tbody>
            {payOps.slice().reverse().map((o) => (
              <tr key={o.id} style={{ opacity: o.voided ? 0.4 : 1, textDecoration: o.voided ? "line-through" : "none" }}>
                <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                <td>{opLabel(o.type)}</td>
                <td className="sm">{(objects.find((x) => x.id === o.object_id) || {}).name || "—"}</td>
                <td className="num" style={{ fontWeight: 700, color: o.type === "bonus_payment" ? "var(--ok)" : "inherit" }}>{fmt(o.amount)}</td>
                <td className="xs mut">{[o.item_name, o.type === "bonus_payment" || o.type === "bonus" ? payText(o) : "", o.note, o.user].filter(Boolean).join(" · ")}</td>
                <td><div className="row" style={{ gap: 4, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                  {delOp !== o.id && !o.voided && <button className="btn xs" onClick={() => setEditOp(o)}>изм.</button>}
                  {canDel && (delOp === o.id ? (<>
                    <span className="xs" style={{ color: "var(--bad)", textDecoration: "none" }}>Удалить?</span>
                    <button className="btn xs dng" onClick={() => removeOp(o)}>Да</button>
                    <button className="btn xs" onClick={() => setDelOp(null)}>Нет</button>
                  </>) : <button className="btn xs dng" onClick={() => setDelOp(o.id)}>удалить</button>)}
                </div></td>
              </tr>
            ))}
            {!payOps.length && <tr><td colSpan={6} className="mut" style={{ textAlign: "center", padding: 20 }}>Операций нет</td></tr>}
          </tbody>
        </table>
      </div>}
      {fin && editOp && <EditOpModal op={editOp} suppliers={data.suppliers} products={data.products} objects={st.rows.map((r) => r.o).concat(editOp.object_id && !st.rows.some((r) => r.o.id === editOp.object_id) ? objects.filter((x) => x.id === editOp.object_id) : [])}
        onClose={() => setEditOp(null)} onSave={async (patch) => {
          const o = editOp;
          const log = [...(o.edit_log || []), { at: new Date().toISOString(), before: { amount: o.amount, op_date: o.op_date, note: o.note, reason: o.reason, item_name: o.item_name || null, object_id: o.object_id || null } }];
          const r = await db.from("finance_ops").update(cleanUuids({ ...patch, edited: true, edit_log: log })).eq("id", o.id);
          if (r.error) return;
          const pt = (x) => (x.pay_method ? " (" + payText(x) + ")" : "");
          const nm = (x) => (x.item_name ? " «" + x.item_name + "»" : "");
          await logAction("Изменена операция: " + opLabel(o.type), "master:" + m.name, "было " + fmt(o.amount) + nm(o) + pt(o) + " → стало " + fmt(patch.amount) + nm({ ...o, ...patch }) + pt({ ...o, ...patch }));
          setEditOp(null); await reload(); toast("Изменено (было и стало — в «Журнале»)");
        }} />}
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
      {edit && <MasterForm m={edit} all={data.masters} onClose={() => setEdit(null)} onSave={async (v) => {
        const { id, created_at, ...rest } = v;
        const r = await db.from("masters").update(rest).eq("id", id);
        if (r.error) return false;
        // имя мастера хранится и текстом в объектах — обновляем его там, чтобы списки не расходились
        if (rest.name && rest.name !== m.name) await db.from("objects").update({ master: rest.name }).eq("master_id", id);
        await logAction("Изменён мастер", "master:" + (rest.name || ""), rest.name !== m.name ? "было: " + m.name : "");
        setEdit(null); await reload(); toast("Сохранено"); return true;
      }} />}
      {fin && accForm && (
        <Modal title={"Начислить бонус — " + m.name} onClose={() => setAccForm(false)} w={520}>
          <BonusAccrueForm objects={st.rows.map((r) => r.o)} products={data.products} suppliers={data.suppliers} onSave={async (op) => {
            const r = await db.from("finance_ops").insert(cleanUuids({ ...op, type: "bonus", master_id: m.id, user: curUserName() || "—" }));
            if (r.error) return false; // ошибка показана, окно остаётся открытым
            await logAction("Начислен бонус мастеру", "master:" + m.name, fmt(op.amount) + (op.item_name ? " · " + op.item_name : "") + (op.note ? " · " + op.note : ""));
            setAccForm(false); await reload(); toast("Бонус начислен"); return true;
          }} />
        </Modal>
      )}
      {fin && delForm && (
        <Modal title="Удалить мастера" onClose={() => setDelForm(false)} w={460}>
          <p style={{ marginBottom: 6 }}>Удалить мастера <b style={{ color: "var(--bad)" }}>{m.name}</b>?</p>
          <p className="sm mut" style={{ marginBottom: 8 }}>Его объекты останутся (имя сохранится текстом), история бонусов и выплат останется в финансах.</p>
          {st.debtToMaster > 0 && <p className="sm" style={{ color: "var(--warn)", marginBottom: 8 }}>⚠ По мастеру есть невыплаченный бонус: {fmt(st.debtToMaster)}</p>}
          {m.status === "active" && <p className="xs mut" style={{ marginBottom: 8 }}>Если мастер просто больше не работает — лучше «Сделать неактивным»: он пропадёт из списков выбора, а история останется.</p>}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10, gap: 8 }}>
            <button className="btn" disabled={delBusy} onClick={() => setDelForm(false)}>Отмена</button>
            {m.status === "active" && <button className="btn" disabled={delBusy} onClick={async () => {
              const r = await db.from("masters").update({ status: "inactive" }).eq("id", m.id);
              if (r.error) return;
              await logAction("Мастер отключён", "master:" + m.name, "");
              setDelForm(false); await reload(); toast("«" + m.name + "» отмечен как неактивный");
            }}>Сделать неактивным</button>}
            <button className="btn" disabled={delBusy} style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={async () => {
              setDelBusy(true);
              // имя мастера остаётся в его объектах текстом (ссылку база уберёт сама при удалении)
              if (st.count) await db.from("objects").update({ master: m.name }).eq("master_id", m.id);
              const r = await db.from("masters").delete().eq("id", m.id);
              setDelBusy(false);
              if (r.error) { await reload(); return; } // ошибка показана (на мастера ссылаются другие записи) — можно сделать его неактивным
              await logAction("Удалён мастер", "master:" + m.name, "объектов: " + st.count);
              await reload(); toast("Мастер удалён"); back();
            }}>{delBusy ? "Удаляю…" : "Удалить"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function BonusAccrueForm({ objects, onSave, products = [], suppliers = [] }) {
  const [kind, setKind] = useState("money");
  const [itemName, setItemName] = useState("");
  const [amount, setAmount] = useState("");
  const [objId, setObjId] = useState("");
  const [note, setNote] = useState("");
  const [opDate, setOpDate] = useState(today());
  const [busy, setBusy] = useState(false);
  // деньгами — со способом оплаты ($ / сум по курсу, карта, перечисление); предмет — по его цене в $
  const [pay, setPay] = useState(() => payInit(null));
  const a = kind === "money" ? payUsd(pay) : parseNum(amount);
  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={"btn " + (kind === "money" ? "pri" : "")} onClick={() => setKind("money")}>💵 Деньгами</button>
        <button className={"btn " + (kind === "item" ? "pri" : "")} onClick={() => setKind("item")}>🛠 Инструмент / предмет</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {kind === "item" && <div style={{ gridColumn: "1/-1" }}><Fld label="Найти в товарах поставщиков (необязательно)">
          <ProductPicker closeOnPick products={products} suppliers={suppliers} placeholder="поиск товара: название, код, поставщик…"
            onPick={(p) => { setItemName(p.name); setAmount(String(Number(p.cost) || retailOf(p) || "")); }} />
        </Fld></div>}
        {kind === "item" && <div style={{ gridColumn: "1/-1" }}><Fld label="Предмет (можно написать вручную)">
          <input className="inp" autoComplete="off" autoCorrect="off" spellCheck={false} name="te_bonus_thing" id="te_bonus_thing" data-lpignore="true" data-form-type="other" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Перфоратор Bosch GBH 2-26, набор ключей, дрель…" /></Fld></div>}
        {kind === "money" ? <PayFields p={pay} setP={setPay} methods={OUT_METHODS} usdLabel="Бонус, $" /> : <Fld label="Цена предмета, $">
          <input type="number" className="inp" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Fld>}
        <Fld label="Привязать к объекту (опц.)">
          <select className="inp" value={objId} onChange={(e) => setObjId(e.target.value)}>
            <option value="">— без объекта —</option>
            {objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></Fld>
        <Fld label="Дата начисления"><input type="date" className="inp" value={opDate} onChange={(e) => setOpDate(e.target.value)} /></Fld>
        <Fld label="Комментарий"><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></Fld>
      </div>
      <p className="xs mut" style={{ marginTop: 8 }}>{kind === "item" ? "Предмет начислится как бонус по его цене и увеличит долг перед мастером — закроете его «выплатой» при передаче." : objId ? "Сумма уменьшит чистую прибыль выбранного объекта." : "Бонус без объекта уменьшит чистую прибыль компании (Дашборд) и увеличит долг перед мастером."}</p>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button className="btn pri" disabled={!(a > 0) || (kind === "item" && !itemName.trim()) || busy} onClick={async () => {
          setBusy(true);
          const base = kind === "money" ? { ...payPatch(pay, "bonus") } : { amount: a, item_name: itemName.trim() };
          const ok = await onSave({ ...base, object_id: objId || null, note, op_date: opDate || today() });
          if (!ok) setBusy(false);
        }}>{busy ? "Записываю…" : "Начислить"}</button>
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
function MasterForm({ m, all = [], onClose, onSave }) {
  const [v, setV] = useState({ status: "active", ...m, bonus_percent: m.bonus_percent ?? 10 });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const name = String(v.name || "").trim();
  const dup = name && all.find((x) => x.id !== v.id && String(x.name || "").trim().toLowerCase() === name.toLowerCase());
  const save = async () => {
    setBusy(true);
    const ok = await onSave({ ...v, name, bonus_percent: parseNum(v.bonus_percent) });
    if (!ok) setBusy(false);
  };
  return (
    <Modal title={v.id ? "Мастер" : "Новый мастер"} onClose={onClose} w={520}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Fld label="Имя"><input className="inp" value={v.name || ""} onChange={set("name")} autoFocus /></Fld>
        <Fld label="Телефон"><input className="inp" value={v.phone || ""} onChange={set("phone")} /></Fld>
        <Fld label="Специализация"><input className="inp" value={v.specialty || ""} onChange={set("specialty")} /></Fld>
        <Fld label="% бонуса (от валовой)"><input type="number" className="inp" value={v.bonus_percent} onChange={set("bonus_percent")} /></Fld>
        <Fld label="Статус"><select className="inp" value={v.status || "active"} onChange={set("status")}><option value="active">активен</option><option value="inactive">неактивен</option></select></Fld>
        <Fld label="Заметка"><input className="inp" value={v.note || ""} onChange={set("note")} /></Fld>
      </div>
      {dup && <p className="sm" style={{ color: "var(--warn)", marginTop: 10 }}>Мастер «{dup.name}» уже есть — проверьте, не дубль ли это.</p>}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" disabled={!name || busy} onClick={save}>{busy ? "Сохраняю…" : "Сохранить"}</button>
      </div>
    </Modal>
  );
}

/* ============ СКЛАД THERMO ============ */
function WhInForm({ products, suppliers, warehouse, onClose, onSave }) {
  const [v, setV] = useState({ product_id: null, name: "", unit: "шт", qty: 1, cost: "", price: "", supplier_id: "", toDebt: true, op_date: today(), note: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const cur = v.product_id ? warehouse.find((w) => w.product_id === v.product_id) : null;
  const ok = v.name.trim() && parseNum(v.qty) > 0;
  return (
    <Modal title="Приход на склад вручную" onClose={onClose} w={620}>
      <Fld label="Найти товар в базе (или впишите название ниже)">
        <ProductPicker closeOnPick products={products} suppliers={suppliers} placeholder="поиск: название, код, поставщик…"
          onPick={(p) => { const w = warehouse.find((x) => x.product_id === p.id); setV({ ...v, product_id: p.id, name: p.name, unit: p.unit || "шт", cost: String(w ? w.cost : Number(p.cost) || ""), price: String(w ? w.price : retailOf(p) || ""), supplier_id: p.supplier_id || "" }); }} />
      </Fld>
      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr", marginTop: 8 }}>
        <Fld label="Название*"><input className="inp" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value, product_id: null })} placeholder="товар не из базы — впишите название" /></Fld>
        <Fld label="Кол-во*"><input type="number" className="inp" min={0} value={v.qty} onChange={set("qty")} style={{ borderColor: parseNum(v.qty) > 0 ? undefined : "var(--bad)" }} /></Fld>
        <Fld label="Ед."><input className="inp" value={v.unit} onChange={set("unit")} /></Fld>
        <Fld label="Себест. за ед., $"><input type="number" className="inp" value={v.cost} onChange={set("cost")} /></Fld>
        <Fld label="Цена за ед., $"><input type="number" className="inp" value={v.price} onChange={set("price")} /></Fld>
        <Fld label="Дата"><input type="date" className="inp" value={v.op_date} onChange={set("op_date")} /></Fld>
        <Fld label="Поставщик">
          <select className="inp" value={v.supplier_id} onChange={set("supplier_id")}><option value="">— без поставщика —</option>{activeSuppliers(suppliers, v.supplier_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </Fld>
        <div style={{ gridColumn: "span 2" }}><Fld label="Комментарий"><input className="inp" value={v.note} onChange={set("note")} placeholder="откуда товар, накладная…" /></Fld></div>
      </div>
      {v.supplier_id && <label className="row sm" style={{ gap: 6, marginTop: 6, cursor: "pointer" }}>
        <input type="checkbox" checked={v.toDebt} onChange={(e) => setV({ ...v, toDebt: e.target.checked })} />
        Куплено у поставщика — добавить в долг поставщику <b className="mono">{fmt2(parseNum(v.qty) * parseNum(v.cost))}</b>
      </label>}
      {cur && <p className="xs mut" style={{ marginTop: 6 }}>На складе уже есть {fmt(cur.qty)} {cur.unit} — количество прибавится, себестоимость и цена станут как указано выше.</p>}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14, gap: 8 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" disabled={!ok || busy} onClick={async () => { setBusy(true); const r = await onSave({ ...v, name: v.name.trim() }); if (!r) setBusy(false); }}>{busy ? "Сохраняю…" : "Оприходовать"}</button>
      </div>
    </Modal>
  );
}
function WarehouseTab({ data, reload, toast, openObject }) {
  const { warehouse, wh_moves, objects, suppliers } = data;
  const [issue, setIssue] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [delRow, setDelRow] = useState(null);
  const [retForm, setRetForm] = useState(null);
  const [allMoves, setAllMoves] = useState(false);
  const [inForm, setInForm] = useState(false);
  const stock = warehouse.filter((w) => (w.qty || 0) > 0);
  // приход вручную: товар из базы или новый; если строка склада есть — добавляем количество
  const submitIn = async (v) => {
    const qty = parseNum(v.qty), cost = parseNum(v.cost), price = parseNum(v.price);
    const f = await whFind(v.product_id || null, v.name, "");
    if (f.error) return false;
    let r;
    if (f.row) r = await db.from("warehouse").update({ qty: round2((Number(f.row.qty) || 0) + qty), cost, price, ...(v.supplier_id ? { supplier_id: v.supplier_id } : {}) }).eq("id", f.row.id);
    else r = await db.from("warehouse").insert(cleanUuids({ product_id: v.product_id || null, name: v.name, qty, cost, price, unit: v.unit || "шт", size: "", supplier_id: v.supplier_id || null }));
    if (r.error) return false;
    await db.from("wh_moves").insert(cleanUuids({ product_id: v.product_id || null, name: v.name, qty, dir: "in", object_id: null, object_name: null, op_date: v.op_date || today(), user: curUserName(), note: "приход вручную" + (v.note ? ": " + v.note : "") }));
    let debtNote = "";
    if (v.supplier_id && v.toDebt) {
      const o = await db.from("finance_ops").insert(cleanUuids({ type: "wh_purchase", object_id: null, supplier_id: v.supplier_id, product_id: v.product_id || null, product_name: v.name, unit: v.unit || "шт", qty, cost_amount: round2(qty * cost), amount: round2(qty * cost), op_date: v.op_date || today(), note: v.note || "", user: curUserName() }));
      debtNote = o.error ? " · ⚠ долг поставщику не записан" : " · долг поставщику +" + fmt2(qty * cost);
    }
    const supN = v.supplier_id ? (suppliers.find((x) => x.id === v.supplier_id) || {}).name : "";
    await logAction("Склад: приход вручную", v.name, "кол-во " + fmt(qty) + ", себест. " + fmt2(cost) + ", цена " + fmt2(price) + (supN ? ", поставщик " + supN + (v.toDebt ? " (в долг)" : "") : ""));
    setInForm(false); await reload(); toast("Приход на склад: " + v.name + " × " + fmt(qty) + debtNote);
    return true;
  };
  const moves = wh_moves.slice().reverse();
  const totalCost = stock.reduce((a, w) => a + w.qty * (w.cost || 0), 0);
  const totalSale = stock.reduce((a, w) => a + w.qty * (w.price || 0), 0);
  const KPI = ({ l, v, c }) => <div className="kpi"><div className="l">{l}</div><div className="v" style={{ color: c }}>{fmt(v)}</div></div>;
  const saveRow = async (patch) => {
    const r = await db.from("warehouse").update({ qty: patch.qty, cost: patch.cost, price: patch.price }).eq("id", editRow.id);
    if (r.error) return;
    const dq = round2(patch.qty - (Number(editRow.qty) || 0));
    // ручная правка количества — тоже движение склада, чтобы история сходилась с остатком
    if (dq) await db.from("wh_moves").insert(cleanUuids({ product_id: editRow.product_id || null, name: editRow.name, qty: Math.abs(dq), dir: dq > 0 ? "in" : "out", object_id: null, object_name: null, op_date: today(), user: curUserName(), note: "ручная корректировка остатка" }));
    await logAction("Склад: изменена позиция", editRow.name, "кол-во " + editRow.qty + " → " + patch.qty + ", себест. " + fmt2(patch.cost) + ", цена " + fmt2(patch.price));
    setEditRow(null); await reload(); toast("Позиция обновлена");
  };
  const confirmDelRow = async () => {
    const r = await db.from("warehouse").delete().eq("id", delRow.id);
    if (r.error) return;
    if (Number(delRow.qty) > 0) await db.from("wh_moves").insert(cleanUuids({ product_id: delRow.product_id, name: delRow.name, qty: delRow.qty, dir: "out", object_id: null, object_name: null, op_date: today(), user: curUserName(), note: "позиция удалена со склада вручную" }));
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
    const u = await db.from("warehouse").update({ qty: newQty }).eq("id", row.id);
    if (u.error) { await reload(); toast("Возврат записан в долг поставщика, но остаток склада не изменился — исправьте количество вручную (ред.)"); setRetForm(null); return; }
    await db.from("wh_moves").insert(cleanUuids({ product_id: row.product_id, name: row.name, qty, dir: "out", object_id: null, object_name: null, op_date: today(), user: curUserName(), note: "возврат поставщику" }));
    await logAction("Возврат поставщику со склада", row.name, "кол-во " + qty + ", на сумму себест. " + fmt(costAmount));
    setRetForm(null); await reload(); toast("Возврат поставщику оформлен: −" + fmt(costAmount) + " к долгу");
  };
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Склад Thermo <span className="mut sm">(возвраты с объектов и приход вручную)</span></h2>
        <button className="btn" onClick={() => setInForm(true)}>+ Приход вручную</button>
        <button className="btn pri" disabled={!stock.length} onClick={() => setIssue(true)}>→ Отправить на объект</button>
      </div>
      <div className="kpis sect">
        <KPI l="Позиций на складе" v={stock.length} />
        <KPI l="Единиц всего" v={stock.reduce((a, w) => a + w.qty, 0)} />
        <KPI l="Склад по закупу" v={totalCost} />
        <KPI l="Склад по продаже" v={totalSale} c="var(--txt)" />
      </div>
      <div className="card sect" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Товар</th><th style={{textAlign:"right"}}>Кол-во</th><th>Ед.</th><th style={{textAlign:"right"}}>Закуп</th><th style={{textAlign:"right"}}>Продажа</th><th style={{textAlign:"right"}}>Сумма (закуп)</th><th></th></tr></thead>
          <tbody>
            {stock.map((w) => (
              <tr key={w.id}>
                <td style={{ fontWeight: 600 }}>{w.name}</td>
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
            {(allMoves ? moves : moves.slice(0, 200)).map((mv) => (
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
        {moves.length > 200 && <div style={{ padding: 10 }}><button className="btn xs" onClick={() => setAllMoves(!allMoves)}>{allMoves ? "Показать последние 200" : "Показать все (" + moves.length + ")"}</button></div>}
      </div>
      {inForm && <WhInForm products={data.products || []} suppliers={suppliers} warehouse={warehouse} onClose={() => setInForm(false)} onSave={submitIn} />}
      {issue && <IssueForm stock={stock} objects={objects} onClose={() => setIssue(false)} onSave={async (lines, targetObj, user) => {
        let batchNo = 1;
        // сначала позиции в объект (по свежей версии объекта); если не записались — склад не трогаем
        const r = await updateObjectItems(targetObj.id, (cur) => {
          const exNos = cur.map((i) => i.batch_no || 1);
          batchNo = exNos.length ? Math.max(...exNos) + 1 : 1;
          return [...cur, ...lines.map((l) => ({
            id: uuid(), product_id: l.row.product_id || null, name: l.row.name, size: l.row.size, unit: l.row.unit,
            qty: l.qty, price: l.row.price || 0, cost: l.row.cost || 0,
            supplier_id: l.row.supplier_id || null, from_warehouse: true,
            source_text: "со склада Thermo", confidence: 100,
            batch_no: batchNo, batch_date: today(), added_at: new Date().toISOString(),
          }))];
        });
        if (r.error) { await reload(); return false; }
        const fail = await warehouseOut(lines, targetObj, user);
        setIssue(false); await reload();
        await logAction("Отгрузка со склада", "object:" + targetObj.name, "поставка №" + batchNo + ", позиций: " + lines.length + (fail ? ", остаток склада не списан: " + fail : ""));
        toast("Отгружено на «" + targetObj.name + "»: " + lines.length + " поз." + (fail ? " · ⚠ остаток склада не списан у " + fail + " поз. — поправьте вручную" : ""));
        return true;
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
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Fld label="Количество"><input type="number" className="inp" min={0} value={qty} onChange={(e) => setQty(e.target.value)} /></Fld>
        <Fld label="Ед."><div className="inp mono" style={{ background: "var(--panel2)" }}>{row.unit}</div></Fld>
        <Fld label="Себестоимость"><input type="number" className="inp" value={cost} onChange={(e) => setCost(e.target.value)} /></Fld>
        <Fld label="Цена продажи"><input type="number" className="inp" value={price} onChange={(e) => setPrice(e.target.value)} /></Fld>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
        <button className="btn" onClick={onCancel}>Отмена</button>
        <button className="btn pri" disabled={busy} onClick={async () => { setBusy(true); await onSave({ qty: Math.max(0, parseNum(qty)), cost: parseNum(cost), price: parseNum(price) }); setBusy(false); }}>{busy ? "Сохраняю…" : "Сохранить"}</button>
      </div>
    </div>
  );
}
function SupplierReturnForm({ row, suppliers, onCancel, onSave }) {
  const [qty, setQty] = useState(Math.min(1, row.qty));
  const [supplierId, setSupplierId] = useState(row.supplier_id || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
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
        <button className="btn pri" disabled={!supplierId || !qty || busy} onClick={async () => { setBusy(true); await onSave(row, Number(qty) || 0, supplierId, reason); setBusy(false); }}>{busy ? "Оформляю…" : "Оформить возврат"}</button>
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
  const [busy, setBusy] = useState(false);
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
                <td className="sm" style={{ fontWeight: 600 }}>{r.row.name}<div className="xs mut">{r.row.unit}</div></td>
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
          <button className="btn pri" disabled={!lines.length || !target || busy} onClick={async () => { setBusy(true); const ok = await onSave(lines, target, user); if (!ok) setBusy(false); }}>{busy ? "Отгружаю…" : "Отгрузить →"}</button>
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
// час события (местное время) для графика «по часам»: берём метку времени, только если она в тот же день, что и дата события
const hourOf = (d, ts) => { if (!ts) return 0; const t = new Date(ts); if (isNaN(t)) return 0; return localIso(t) === d ? t.getHours() : 0; };
function dashEvents(objects, ops, mgr) {
  const objById = {}, sales = [];
  objects.forEach((o) => {
    objById[o.id] = o;
    if (o.status === "cancelled" || (mgr && (o.manager || "") !== mgr)) return;
    (o.items || []).forEach((i) => {
      const d = String(i.batch_date || o.created_at || "").slice(0, 10);
      sales.push({ d, h: hourOf(d, i.added_at || ((i.batch_no || 1) === 1 ? o.created_at : null)), o, i,
        rev: (i.qty || 0) * (i.price || 0), cost: (i.qty || 0) * (i.cost || 0), key: o.id + "#" + (i.batch_no || 1) });
    });
  });
  const objOps = [], compExp = [], dirBonus = [];
  ops.forEach((x) => {
    if (x.voided) return;
    const d = String(x.op_date || x.created_at || "").slice(0, 10);
    if (x.type === "company_expense") { if (!mgr) compExp.push({ ...x, d }); return; }
    // бонус мастеру без объекта — тоже расход компании (раньше в чистую прибыль не попадал)
    if (x.type === "bonus" && !x.object_id) { if (!mgr) dirBonus.push({ ...x, d }); return; }
    const o = x.object_id && objById[x.object_id];
    if (!o || o.status === "cancelled" || (mgr && (o.manager || "") !== mgr)) return;
    objOps.push({ ...x, d, h: hourOf(d, x.created_at), o });
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
  return { sales, objOps, compExp, dirBonus, firstBuy };
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
  ev.dirBonus.forEach((x) => { if (inR(x.d)) bonus += x.amount || 0; });
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
    // один день — по часам
    const gran = days <= 1 ? "hour" : days <= 45 ? "day" : days <= 210 ? "week" : "month";
    if (gran === "hour") {
      const hh = (h) => String(h).padStart(2, "0") + ":00";
      const list = Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: hh(h), title: dt(f) + " " + hh(h) + "–" + String(h).padStart(2, "0") + ":59", rev: 0, gross: 0, deals: 0, _d: new Set() }));
      ev.sales.forEach((s) => { if (s.d !== f) return; const b = list[s.h || 0]; b.rev += s.rev; b.gross += s.rev - s.cost; b._d.add(s.key); });
      ev.objOps.forEach((x) => {
        if (x.d !== f) return; const b = list[x.h || 0];
        if (x.type === "return") { b.rev -= x.amount || 0; b.gross -= (x.amount || 0) - (x.cost_amount || 0); }
        else if (x.type === "discount") { b.rev -= x.amount || 0; b.gross -= x.amount || 0; }
      });
      list.forEach((b) => { b.deals = b._d.size; delete b._d; });
      return { list, gran };
    }
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
      const book = [];
      const add = (name, rows) => book.push(xlFromTable(name, rows));
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
      downloadBlob("dashboard_" + (from || "all") + "_" + (to || dToday()) + ".xlsx", styledXlsxBook(book));
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
        {compare && <div className="xs mut" style={{ marginTop: 6 }}>Сравнение с предыдущим периодом: {prevTitle}{mgr ? " · расходы компании и бонусы без объекта не учитываются при фильтре по менеджеру" : ""}</div>}
      </div>

      <div className="kpis sect">
        <DashTile hero label="Выручка" value={cur.netRev} prev={prev && prev.netRev} compare={compare} note={cur.ret || cur.disc ? "продажи " + fmt(cur.rev) + " − возвраты " + fmt(cur.ret) + " − скидки " + fmt(cur.disc) : null} />
        <DashTile label="Валовая прибыль" value={cur.gross} prev={prev && prev.gross} compare={compare} />
        <DashTile label="Чистая прибыль" value={cur.net} prev={prev && prev.net} compare={compare} note="после доп. расходов, бонусов мастерам и расходов компании" />
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
          <h3 style={{ marginRight: "auto" }}>Динамика продаж <span className="xs mut" style={{ fontWeight: 500 }}>по {buckets.gran === "hour" ? "часам" : buckets.gran === "day" ? "дням" : buckets.gran === "week" ? "неделям" : "месяцам"}</span></h3>
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
function CompanyExpenseForm({ onClose, onSave, boss = false, employees = [], onEmployeeAdded }) {
  const cats = boss ? EXPENSE_CATEGORIES : EXPENSE_CATEGORIES.filter((c) => c !== SALARY_CAT);
  const [v, setV] = useState({ category: cats[0], op_date: today(), note: "", user: curUserName(), kind: "Зарплата", emp: "" });
  const sal = v.category === SALARY_CAT;
  const [pay, setPay] = useState(() => payInit(null));
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Расход компании" onClose={onClose} w={560}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Категория"><select className="inp" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{cats.map((c) => <option key={c}>{c}</option>)}</select></Fld></div>
        {sal && <Fld label="Вид выплаты">
          <div className="row" style={{ gap: 4 }}>{SALARY_KINDS.map((k) => <button key={k} type="button" className={"btn xs " + (v.kind === k ? "pri" : "")} onClick={() => setV({ ...v, kind: k })}>{k}</button>)}</div>
        </Fld>}
        {sal && <Fld label="Сотрудник"><EmployeeSelect value={v.emp} onChange={(emp) => setV({ ...v, emp })} employees={employees} onAdded={onEmployeeAdded} /></Fld>}
        <PayFields p={pay} setP={setPay} methods={OUT_METHODS} usdLabel={payUsdLabel("company_expense")} />
        <Fld label="Дата"><input type="date" className="inp" value={v.op_date} onChange={(e) => setV({ ...v, op_date: e.target.value })} /></Fld>
        <Fld label="Кто внёс"><PersonSelect value={v.user} onChange={(u) => setV({ ...v, user: u })} /></Fld>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Комментарий"><input className="inp" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="за июнь / Шерзоду / свет+вода…" /></Fld></div>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" disabled={!(payUsd(pay) > 0) || busy || (sal && !v.emp)} title={sal && !v.emp ? "Выберите сотрудника" : ""} onClick={async () => {
          setBusy(true);
          const op = { type: "company_expense", object_id: null, category: v.category, size: v.category, ...payPatch(pay, "company_expense"), op_date: v.op_date || today(), note: v.note, user: v.user };
          if (sal) { op.item_name = v.kind; op.product_name = v.emp; }
          await onSave(op); setBusy(false);
        }}>{busy ? "Сохраняю…" : "Сохранить"}</button>
      </div>
    </Modal>
  );
}
function FinanceTab({ data, reload, toast, boss = false }) {
  const { objects, suppliers } = data;
  // менеджер не видит зарплату: расходы категории «Зарплата» скрыты из списков, итогов и «Деньги по способам оплаты»
  const finance_ops = useMemo(() => (boss ? data.finance_ops : data.finance_ops.filter((o) => !isSalary(o))), [data.finance_ops, boss]);
  const objName = (id) => (objects.find((o) => o.id === id) || {}).name || "—";
  const supName = (id) => (suppliers.find((s) => s.id === id) || {}).name || "";
  const clientDebts = objects.map((o) => ({ o, f: calcObject(o, finance_ops) })).filter((x) => x.f.clientDebt > 0.004 && x.o.status !== "cancelled");
  // поставщики с движением (закупки, оплаты или возвраты) — пустые строки не показываем
  const supRows = useMemo(() => suppliers.map((s) => ({ s, st: supplierStats(s, objects, finance_ops, data.wh_moves) }))
    .filter(({ st }) => st.purchases || st.paid || st.returns).sort((a, b) => b.st.balance - a.st.balance), [suppliers, objects, finance_ops, data.wh_moves]);
  const [expForm, setExpForm] = useState(false);
  const [delExp, setDelExp] = useState(null);
  const monthStart = () => { const d = new Date(); return localIso(new Date(d.getFullYear(), d.getMonth(), 1)); };
  const [opsAll, setOpsAll] = useState(false);
  const [opsQ, setOpsQ] = useState("");
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
  const employees = useMemo(() => employeeList(data), [data.users, data.finance_ops]);
  const [staffOpen, setStaffOpen] = useState(false);
  const [newEmp, setNewEmp] = useState("");
  const [delEmp, setDelEmp] = useState(null);
  const [staffEdit, setStaffEdit] = useState(false);
  const [renames, setRenames] = useState({});
  // переименование сотрудника: имя в списке и в его прошлых выплатах
  const renameEmployee = async (oldName, newName) => {
    const nn = String(newName || "").trim().replace(/\s+/g, " ");
    if (!nn || nn === oldName) return true;
    if (employees.some((x) => x.toLowerCase() === nn.toLowerCase())) { toast("Сотрудник «" + nn + "» уже есть"); return false; }
    const u = staffUser(oldName);
    if (u) { const r = await db.from("users").update({ name: nn }).eq("id", u.id); if (r.error) return false; }
    const ids = (data.finance_ops || []).filter((o) => o.type === "company_expense" && o.product_name === oldName).map((o) => o.id);
    for (const id of ids) await db.from("finance_ops").update({ product_name: nn }).eq("id", id);
    await logAction("Сотрудник переименован", "staff:" + nn, "было: " + oldName + (ids.length ? ", выплат: " + ids.length : ""));
    return true;
  };
  // выплаты по сотрудникам за период: зарплата / аванс / премия
  const staffRows = useMemo(() => {
    if (!boss) return [];
    const m = {};
    employees.forEach((n) => { m[n] = { name: n, Зарплата: 0, Аванс: 0, Премия: 0, total: 0 }; });
    genExpenses.forEach((o) => { const i = salaryInfo(o); if (!i || !i.emp) return; const r = m[i.emp] || (m[i.emp] = { name: i.emp, Зарплата: 0, Аванс: 0, Премия: 0, total: 0 }); r[SALARY_KINDS.includes(i.kind) ? i.kind : "Зарплата"] += o.amount || 0; r.total += o.amount || 0; });
    return Object.values(m).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ru"));
  }, [employees, genExpenses, boss]);
  const staffUser = (name) => (data.users || []).find((u) => isStaff(u) && String(u.name || "").trim() === name);
  const byCat = {};
  genExpenses.forEach((o) => { byCat[o.category || "Прочее"] = (byCat[o.category || "Прочее"] || 0) + (o.amount || 0); });
  const totalExp = genExpenses.reduce((a, o) => a + (o.amount || 0), 0);
  // общий список операций — тоже за выбранный период (раньше показывались все операции за всё время)
  const ql = opsQ.trim().toLowerCase();
  const periodOps = finance_ops.filter((o) => inRange(o) && (!ql || [objName(o.object_id), supName(o.supplier_id), opLabel(o.type), o.product_name, o.reason, o.note, o.user, o.category].join(" ").toLowerCase().includes(ql)))
    .sort((a, b) => String(b.op_date || b.created_at || "").localeCompare(String(a.op_date || a.created_at || "")) || String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return (
    <div>
      <h2 className="sect">Финансы и долги</h2>
      <div className="row sect" style={{ gap: 8, padding: "8px 10px", background: "var(--panel2)", borderRadius: 8 }}>
        <span className="sm" style={{ fontWeight: 700 }}>Период:</span>
        <Fld label="С даты"><input type="date" className="inp" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} /></Fld>
        <Fld label="По дату"><input type="date" className="inp" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} /></Fld>
        <div style={{ display: "flex", gap: 4, alignSelf: "flex-end", flexWrap: "wrap" }}>
          <button className="btn xs" onClick={() => { setFrom(monthStart()); setTo(today()); }}>Этот месяц</button>
          <button className="btn xs" onClick={() => { setFrom(daysAgo(6)); setTo(today()); }}>7 дней</button>
          <button className="btn xs" onClick={() => { setFrom(daysAgo(29)); setTo(today()); }}>30 дней</button>
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
        {[...EXPENSE_CATEGORIES, ...Object.keys(byCat).filter((c) => !EXPENSE_CATEGORIES.includes(c))].filter((c) => byCat[c]).slice(0, 6).map((c) => (
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
                <td className="sm" style={{ fontWeight: 600 }}>{o.category || "Прочее"}{salaryInfo(o) && salaryInfo(o).kind !== "Зарплата" ? <span className="mut" style={{ fontWeight: 500 }}> · {salaryInfo(o).kind}</span> : null}</td>
                <td className="num" style={{ fontWeight: 700, color: "var(--bad)" }}>{fmt(o.amount)}</td>
                <td className="xs">{payText(o) || <span className="mut">—</span>}</td>
                <td className="xs mut">{salaryInfo(o) ? <>{salaryInfo(o).emp && <b style={{ color: "var(--txt)" }}>{salaryInfo(o).emp}</b>}{salaryInfo(o).emp && salaryInfo(o).note ? " · " : ""}{salaryInfo(o).note}</> : o.note}</td>
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
      {boss && (
        <div className="card sect">
          <div className="row" style={{ marginBottom: staffOpen ? 8 : 0 }}>
            <h3 className="clk" style={{ marginRight: "auto" }} onClick={() => { setStaffOpen(!staffOpen); setStaffEdit(false); }}>{staffOpen ? "▾" : "▸"} Сотрудники и зарплата{(from || to) ? " за период" : ""} <span className="mut sm">({employees.length})</span></h3>
          </div>
          {staffOpen && (
            <div style={{ overflow: "auto" }}>
              <table className="t">
                <thead><tr><th>Сотрудник</th>{SALARY_KINDS.map((k) => <th key={k} style={{ textAlign: "right" }}>{k}</th>)}<th style={{ textAlign: "right" }}>Итого</th><th></th></tr></thead>
                <tbody>
                  {staffRows.map((r) => (
                    <tr key={r.name}>
                      <td className="sm" style={{ fontWeight: 600 }}>{staffEdit ? (
                        <input className="inp" style={{ maxWidth: 240 }} value={renames[r.name] != null ? renames[r.name] : r.name} onChange={(e) => setRenames({ ...renames, [r.name]: e.target.value })} />
                      ) : r.name}</td>
                      {SALARY_KINDS.map((k) => <td key={k} className="num">{r[k] ? fmt(r[k]) : <span className="mut">—</span>}</td>)}
                      <td className="num" style={{ fontWeight: 700 }}>{fmt(r.total)}</td>
                      <td>{staffEdit && staffUser(r.name) && (delEmp === r.name ? (
                        <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                          <span className="xs" style={{ color: "var(--bad)" }}>Убрать из списка?</span>
                          <button className="btn xs dng" onClick={async () => { const r2 = await db.from("users").delete().eq("id", staffUser(r.name).id); if (r2.error) return; await logAction("Удалён сотрудник", "staff:" + r.name, ""); setDelEmp(null); await reload(["users"]); toast("Сотрудник убран из списка (выплаты сохранены)"); }}>Да</button>
                          <button className="btn xs" onClick={() => setDelEmp(null)}>Нет</button>
                        </div>
                      ) : <button className="btn xs dng" title="Убрать из списка выбора" onClick={() => setDelEmp(r.name)}>✕</button>)}</td>
                    </tr>
                  ))}
                  {!staffRows.length && <tr><td colSpan={6} className="mut sm" style={{ padding: 14 }}>Сотрудников пока нет — нажмите «Изменить» и добавьте</td></tr>}
                </tbody>
              </table>
              {/* внизу — «Изменить»: переименование, удаление и добавление сотрудника */}
              {!staffEdit ? (
                <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                  <button className="btn" onClick={() => { setStaffEdit(true); setRenames({}); setNewEmp(""); }}>✎ Изменить</button>
                </div>
              ) : (
                <div className="card" style={{ marginTop: 10, padding: 10 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <input className="inp" style={{ maxWidth: 260 }} placeholder="Имя нового сотрудника" value={newEmp} onChange={(e) => setNewEmp(e.target.value)}
                      onKeyDown={async (e) => { if (e.key === "Enter" && newEmp.trim()) { if (await addEmployee(newEmp)) { setNewEmp(""); await reload(["users"]); toast("Сотрудник добавлен"); } } }} />
                    <button className="btn" disabled={!newEmp.trim() || employees.some((x) => x.toLowerCase() === newEmp.trim().toLowerCase())} onClick={async () => { if (await addEmployee(newEmp)) { setNewEmp(""); await reload(["users"]); toast("Сотрудник добавлен"); } }}>+ Добавить сотрудника</button>
                    <span style={{ marginLeft: "auto" }} />
                    <button className="btn" onClick={() => { setStaffEdit(false); setRenames({}); setDelEmp(null); }}>Отмена</button>
                    <button className="btn pri" onClick={async () => {
                      let n = 0;
                      for (const [oldN, newN] of Object.entries(renames)) { if (String(newN).trim() && String(newN).trim() !== oldN) { if (await renameEmployee(oldN, newN)) n++; } }
                      setStaffEdit(false); setRenames({}); setDelEmp(null);
                      if (n) { await reload(); toast("Переименовано: " + n); }
                    }}>Готово</button>
                  </div>
                  <p className="xs mut" style={{ marginTop: 6 }}>Имя можно исправить прямо в таблице; ✕ — убрать сотрудника из списка (его выплаты сохранятся).</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {expForm && <CompanyExpenseForm boss={boss} employees={employees} onEmployeeAdded={() => reload(["users"])} onClose={() => setExpForm(false)} onSave={async (op) => {
        const r = await db.from("finance_ops").insert(cleanUuids(op));
        if (r.error) return; // ошибка показана, окно остаётся открытым
        // в базе нет колонок для вида выплаты / сотрудника — сохраняем их в начале комментария
        if (op.product_name && r.dropped && (r.dropped.includes("item_name") || r.dropped.includes("product_name")) && r.data && r.data[0])
          await db.from("finance_ops").update({ note: "[" + op.item_name + " · " + op.product_name + "] " + (op.note || "") }).eq("id", r.data[0].id);
        await logAction("Расход компании: " + op.category + (op.product_name ? " · " + op.item_name + " · " + op.product_name : ""), "company", fmt(op.amount) + " · " + payText(op) + (op.note ? " · " + op.note : ""));
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
            <tbody>{supRows.map(({ s, st }) => <tr key={s.id}><td>{s.name}<div className="xs mut">{s.terms}</div></td><td className="num">{fmt(st.purchases)}</td><td className="num">{fmt(st.paid)}</td><td className="num" style={{color:st.balance>0?"var(--bad)":st.balance<0?"var(--ok)":"var(--mut)",fontWeight:700}} title={st.balance<0?"переплата (аванс поставщику)":""}>{st.balance<0?"−"+fmt(-st.balance):fmt(st.balance)}</td></tr>)}
            {!supRows.length && <tr><td colSpan={4} className="mut sm" style={{padding:14}}>Закупок и оплат поставщикам пока нет</td></tr>}
            {supRows.length > 1 && <tr style={{ background: "var(--panel2)" }}><td style={{ fontWeight: 800 }}>Итого долг</td><td className="num" style={{ fontWeight: 800 }}>{fmt(supRows.reduce((a, r) => a + r.st.purchases, 0))}</td><td className="num" style={{ fontWeight: 800 }}>{fmt(supRows.reduce((a, r) => a + r.st.paid, 0))}</td><td className="num" style={{ fontWeight: 800, color: "var(--bad)" }} title="сумма долгов (переплаты не вычитаются)">{fmt(supRows.reduce((a, r) => a + r.st.debt, 0))}</td></tr>}
            </tbody></table>
          {supRows.length < suppliers.length && <p className="xs mut" style={{ marginTop: 6 }}>Поставщики без закупок и оплат не показаны ({suppliers.length - supRows.length}).</p>}
        </div>
      </div>
      <div className="row sect" style={{ marginBottom: 8 }}>
        <h3 style={{ marginRight: "auto" }}>Все операции{(from || to) ? " за период" : ""} <span className="mut sm">({periodOps.length})</span></h3>
        <input className="inp" style={{ maxWidth: 240 }} placeholder="Поиск: объект, поставщик, комментарий…" value={opsQ} onChange={(e) => setOpsQ(e.target.value)} />
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Дата</th><th>Объект</th><th>Тип</th><th style={{textAlign:"right"}}>Сумма</th><th>Детали</th><th>Кто</th></tr></thead>
          <tbody>
            {(opsAll ? periodOps : periodOps.slice(0, 200)).map((o) => (
              <tr key={o.id} style={{ opacity: o.voided ? 0.4 : 1, textDecoration: o.voided ? "line-through" : "none" }}>
                <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                <td className="sm">{objName(o.object_id)}</td>
                <td>{opLabel(o.type)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(o.amount)}</td>
                <td className="xs mut">{opDetails(o, [supName(o.supplier_id), o.product_name])}</td>
                <td className="xs mut">{o.user}</td>
              </tr>
            ))}
            {!periodOps.length && <tr><td colSpan={6} className="mut" style={{ textAlign: "center", padding: 22 }}>Операций нет</td></tr>}
          </tbody>
        </table>
        {periodOps.length > 200 && <div style={{ padding: 10 }}><button className="btn xs" onClick={() => setOpsAll(!opsAll)}>{opsAll ? "Показать последние 200" : "Показать все (" + periodOps.length + ")"}</button></div>}
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
              return <tr key={o.id}><td className="xs mono mut">{dt(o.op_date||o.created_at)}</td><td className="sm">{obj ? obj.name : "—"}</td><td className="sm">{o.product_name||"—"}</td><td className="xs">{kind(o)}</td><td className="num">{o.qty||"—"}</td><td className="num" style={{color:"var(--warn)",fontWeight:700}}>{fmt(o.cost_amount||0)}</td><td className="xs mut">{o.reason||o.note||""}</td></tr>;
            })}
            {!returns.length && <tr><td colSpan={7} className="mut sm" style={{padding:14}}>Возвратов нет</td></tr>}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============ ЖУРНАЛ ДЕЙСТВИЙ ============ */
function LogTab({ data, reload }) {
  const { audit_log } = data;
  useEffect(() => { if (reload) reload(["audit_log"]); }, []); // журнал подгружается при открытии вкладки
  const [q, setQ] = useState("");
  const [usr, setUsr] = useState("");
  const [days, setDays] = useState(0);
  const [all, setAll] = useState(false);
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
            {(all ? rows : rows.slice(0, 300)).map((l) => (
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
        {rows.length > 300 && <div style={{ padding: 10 }}><button className="btn xs" onClick={() => setAll(!all)}>{all ? "Показать последние 300" : "Показать все (" + rows.length + ")"}</button></div>}
      </div>
    </div>
  );
}

/* ============ АДМИН: АККАУНТЫ ============ */
function AdminTab({ data, reload, toast, currentUser }) {
  const users = (data.users || []).filter((u) => !isStaff(u)); // сотрудники (для зарплаты) — не аккаунты
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Аккаунты <span className="mut sm">({users.length})</span></h2>
        <button className="btn pri" onClick={() => setEdit({ role: "manager", status: "active" })}>+ Аккаунт</button>
      </div>
      <div className="card sect" style={{ borderColor: "var(--line2)" }}>
        <p className="sm mut">Руководитель создаёт логины и пароли вручную. Вход в систему — строго по паролю (в базе хранится не сам пароль, а его хеш). Отключённый аккаунт войти не может.</p>
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
      {edit && <UserForm u={edit} users={users} self={currentUser} onClose={() => setEdit(null)} onSave={async (vals) => {
        const { id, created_at, ...rest } = vals;
        const r = id ? await db.from("users").update(rest).eq("id", id) : await db.from("users").insert(rest);
        if (r.error) return false; // ошибка показана, окно остаётся открытым
        await logAction(id ? "Изменён аккаунт" : "Создан аккаунт", "user:" + rest.username, "роль: " + rest.role + (rest.pass_hash ? ", пароль задан" : ""));
        setEdit(null); await reload(); toast("Аккаунт сохранён"); return true;
      }} />}
      {del && (
        <Modal title="Удалить аккаунт" onClose={() => setDel(null)} w={420}>
          <p style={{ marginBottom: 14 }}>Удалить аккаунт <b style={{ color: "var(--bad)" }}>{del.username}</b> ({del.name})?</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setDel(null)}>Отмена</button>
            <button className="btn" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={async () => {
              const r = await db.from("users").delete().eq("id", del.id);
              if (r.error) return;
              await logAction("Удалён аккаунт", "user:" + del.username, del.name || "");
              setDel(null); await reload(); toast("Аккаунт удалён");
            }}>Удалить</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function UserForm({ u, users, self, onClose, onSave }) {
  const [v, setV] = useState({ role: "manager", status: "active", ...u });
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const isSelf = !!(self && v.id && v.id === self.id); // себе нельзя снять роль руководителя или отключить вход
  const submit = async () => {
    const uname = (v.username || "").trim().toLowerCase();
    if (!uname) return setErr("Укажите логин");
    if (users.some((x) => String(x.username || "").toLowerCase() === uname && x.id !== v.id)) return setErr("Такой логин уже есть");
    if (!v.id && !pw) return setErr("Задайте пароль");
    if (pw && pw.length < 4) return setErr("Пароль слишком короткий — минимум 4 символа");
    const out = { ...v, username: uname, name: String(v.name || "").trim() };
    if (pw) { out.pass_hash = await hashPass(pw); out.need_seed_pass = null; }
    setBusy(true); setErr("");
    const ok = await onSave(out);
    if (!ok) setBusy(false);
  };
  return (
    <Modal title={v.id ? "Аккаунт: " + v.username : "Новый аккаунт"} onClose={onClose} w={460}>
      {err && <p className="sm" style={{ color: "var(--bad)", marginBottom: 8 }}>{err}</p>}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Fld label="Логин"><input className="inp mono" value={v.username || ""} onChange={set("username")} placeholder="manager1" /></Fld>
        <Fld label="Имя сотрудника"><input className="inp" value={v.name || ""} onChange={set("name")} /></Fld>
        <Fld label="Роль"><select className="inp" value={v.role} disabled={isSelf} title={isSelf ? "Свою роль изменить нельзя" : ""} onChange={set("role")}><option value="manager">Менеджер</option><option value="boss">Руководитель</option></select></Fld>
        <Fld label="Статус"><select className="inp" value={v.status} disabled={isSelf} title={isSelf ? "Свой аккаунт отключить нельзя" : ""} onChange={set("status")}><option value="active">активен</option><option value="disabled">отключён</option></select></Fld>
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
        <button className="btn pri" disabled={busy} onClick={submit}>{busy ? "Сохраняю…" : "Сохранить"}</button>
      </div>
    </Modal>
  );
}
function LoginScreen({ users, onLogin, bootErr, onRetry }) {
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr("");
    const u = users.find((x) => !isStaff(x) && String(x.username || "").trim().toLowerCase() === username.trim().toLowerCase());
    if (!u) { setErr("Неверный логин или пароль"); setBusy(false); return; }
    if (u.status !== "active") { setErr("Аккаунт отключён"); setBusy(false); return; }
    // первый вход админа по сид-паролю
    if (!u.pass_hash && u.need_seed_pass) {
      if (pw === u.need_seed_pass) {
        const r = await db.from("users").update({ pass_hash: await hashPass(pw), need_seed_pass: null }).eq("id", u.id);
        if (r.error) { setErr("Не удалось сохранить пароль — проверьте соединение"); setBusy(false); return; }
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
      <div className="card" style={{ width: 360, boxShadow: "0 24px 60px rgba(18,24,27,.16)" }}>
        <div className="logo" style={{ textAlign: "center", marginBottom: 4, color: "var(--txt)" }}>THERMO<span>•</span>ENGINEERING<small style={{ color: "var(--mut)" }}>procurement & finance OS</small></div>
        <h3 style={{ textAlign: "center", margin: "16px 0 14px" }}>Вход в систему</h3>
        {bootErr && (
          <div className="sm" style={{ color: "var(--bad)", textAlign: "center", marginBottom: 10 }}>
            Нет связи с базой данных: {bootErr}
            <div style={{ marginTop: 6 }}><button className="btn xs" onClick={onRetry}>↻ Повторить</button></div>
          </div>
        )}
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
  /* Перезагрузка данных из базы.
     · reload() — рабочие таблицы: поставщики, объекты, операции, мастера, склад, аккаунты. Товары (11 000+ строк),
       журнал и история заявок здесь не грузятся — после оплат, возвратов и т.п. они не меняются, а грузить их
       после каждого действия долго;
     · reload("all") — всё, вместе с товарами (после изменений в базе товаров, восстановления и т.д.);
     · reload(["audit_log"]) — только указанные таблицы.
     Если таблица не загрузилась (сбой сети), на экране остаются прежние данные и появляется сообщение — раньше таблица
     молча становилась пустой. Ответ более раннего запроса не перезаписывает более свежий. */
  const reloadSeq = useRef(0);
  const appliedSeq = useRef({});
  const lastFull = useRef(0);
  const reload = async (opt) => {
    const all = opt === "all";
    const tables = all ? TABLES : Array.isArray(opt) ? opt : TABLES.filter((t) => !["products", "audit_log", "requests"].includes(t));
    const seq = ++reloadSeq.current;
    const res = await Promise.all(tables.map((t) => fetchAllRows(t).then((rows) => ({ t, rows }), (err) => ({ t, err }))));
    const upd = {}, failed = [];
    res.forEach(({ t, rows, err }) => {
      if (err) { failed.push(t + " (" + String(err.message || err).replace(/^\w+: /, "") + ")"); return; }
      if ((appliedSeq.current[t] || 0) > seq) return;
      appliedSeq.current[t] = seq; upd[t] = t === "finance_ops" ? rows.map(normFinOp) : rows;
    });
    if (Object.keys(upd).length) setData((prev) => ({ ...prev, ...upd }));
    if (all && !failed.length) lastFull.current = Date.now();
    if (failed.length) {
      console.error("[reload]", failed);
      try { window.dispatchEvent(new CustomEvent("te-db-error", { detail: "Не удалось загрузить из базы: " + failed.join(", ") + ". Показаны прежние данные — проверьте интернет и обновите страницу." })); } catch (e) {}
    }
    return { ok: !failed.length, allFailed: failed.length === tables.length, failed };
  };
  const [bootErr, setBootErr] = useState("");
  const restoreRef = useRef(null);
  // список людей для полей «Менеджер» / «Ответственный»
  const [extraPeople, setExtraPeople] = useState(() => { try { return JSON.parse(localStorage.getItem("te:people") || "[]"); } catch { return []; } });
  const people = useMemo(() => {
    const set = new Set();
    const add = (n) => { const t = String(n || "").trim(); if (t && !["manager", "boss", "—", "-"].includes(t.toLowerCase())) set.add(t); };
    (data.users || []).filter((u) => u.status === "active").forEach((u) => add(u.name || u.username));
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
  const boot = async () => {
    try {
      const r = await reload("all");
      if (r.allFailed || (r.failed && r.failed.some((x) => x.startsWith("users")))) setBootErr(r.failed.join(", "));
      else setBootErr("");
      // восстановить сессию из localStorage
      const uid = localStorage.getItem("te:session");
      if (uid && !CURRENT_USER) {
        const { data: users } = await db.from("users").select().eq("id", uid).eq("status", "active");
        if (users && users.length) { setCurrentUser(users[0]); CURRENT_USER = users[0]; }
      }
    } catch (e) {
      console.error(e); setBootErr(String(e && (e.message || e)));
    }
    setReady(true);
  };
  useEffect(() => { boot(); }, []);
  // вернулись на вкладку браузера после перерыва — подтягиваем изменения других сотрудников
  useEffect(() => {
    const h = () => { if (document.visibilityState === "visible" && CURRENT_USER && Date.now() - lastFull.current > 120000) reload("all"); };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);
  const doLogin = async (u) => {
    setCurrentUser(u); CURRENT_USER = u;
    try { localStorage.setItem("te:session", u.id); } catch (e) {}
    await logAction("Вход в систему", "user:" + u.username, "");
    await reload("all");
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
  const confirmRestore = async () => {
    if (!window.confirm("Восстановить базу из бэкапа?\n\nТекущие данные будут заменены содержимым бэкапа. Перед этим автоматически скачается бэкап текущей базы.")) return false;
    try { tryDownloadBackup(JSON.stringify(await freshDump("автобэкап перед восстановлением"))); }
    catch (e) { toast("Восстановление отменено: не удалось сделать бэкап текущей базы (" + e.message + ")"); return false; }
    return true;
  };
  const onRestore = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = "";
    if (!(await confirmRestore())) return;
    try { await importBackup(f); await logAction("База восстановлена из бэкапа", "", f.name); await reload("all"); setBackupOpen(false); setOpenId(null); toast("База восстановлена из бэкапа"); setBootErr(""); }
    catch (err) { await reload("all"); toast("Ошибка восстановления: " + err.message); }
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
  if (!currentUser) return <LoginScreen users={data.users || []} onLogin={doLogin} bootErr={bootErr} onRetry={() => { setReady(false); boot(); }} />;
  return (
    <PeopleCtx.Provider value={peopleCtx}>
    <div className={"te" + (darkMode ? " dark" : "")}>
      <style>{CSS}</style>
      <div className={"hdr" + (hdrHidden ? " hide-on-scroll" : "")}>
        <div className="logo">THERMO<span>•</span>ENGINEERING<small>procurement & finance OS</small></div>
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
        {role === "boss" && <button className="btn xs" title="Бэкап и восстановление базы" onClick={() => setBackupOpen(true)}>💾 Бэкап</button>}
        <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={onRestore} />
      </div>
      <div className="body">
        {bootErr && <div className="card sect" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>Ошибка подключения к Supabase: {bootErr}</div>}
        {tab === "dash" && <Dashboard data={data} />}
        {tab === "objects" && <ObjectsTab data={data} reload={reload} toast={toast} openId={openId} setOpenId={setOpenId} goRequest={() => setTab("request")} fin={role === "boss"} />}
        {tab === "request" && <RequestTabs data={data} reload={reload} toast={toast} openObject={(id) => { setOpenId(id); setTab("objects"); }} />}
        {tab === "products" && <ProductsTab data={data} reload={reload} toast={toast} />}
        {tab === "suppliers" && <SuppliersTab data={data} reload={reload} toast={toast} fin={role === "boss"} />}
        {tab === "masters" && <MastersTab data={data} reload={reload} toast={toast} fin={true} canDel={role === "boss"} openObject={(id) => { setOpenId(id); setTab("objects"); }} />}
        {tab === "wh" && <WarehouseTab data={data} reload={reload} toast={toast} openObject={(id) => { setOpenId(id); setTab("objects"); }} />}
        {tab === "log" && <LogTab data={data} reload={reload} />}
        {tab === "admin" && <AdminTab data={data} reload={reload} toast={toast} currentUser={currentUser} />}
        {tab === "finance" && <FinanceTab data={data} reload={reload} toast={toast} boss={role === "boss"} />}
      </div>
      {backupOpen && role === "boss" && <BackupModal data={data} reload={reload} onClose={() => setBackupOpen(false)} toast={toast} onFilePick={() => restoreRef.current.click()} onRestoreText={async (text) => {
        const dump = JSON.parse(text);
        if (!(await confirmRestore())) return;
        try { await restoreFromSupabase(dump); } catch (e) { await reload("all"); throw e; }
        await logAction("База восстановлена из бэкапа", "", "из текста"); await reload("all"); setBackupOpen(false); setOpenId(null); toast("База восстановлена");
      }} onWipe={() => { setBackupOpen(false); setWipeOpen(true); }} />}
      {wipeOpen && role === "boss" && <WipeModal data={data} reload={reload} onClose={() => setWipeOpen(false)} onDone={async () => {
        await reload("all"); setWipeOpen(false); setOpenId(null); toast("База очищена. Товары, поставщики и мастера сохранены.");
      }} />}
      <ConfirmHost />
      <SelectPopupHost />
      <NoAutofillGuard />
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
function WipeModal({ data, reload, onClose, onDone }) {
  useEffect(() => { if (reload) reload(["requests", "audit_log", "warehouse", "wh_moves"]); }, []); // точные количества для подтверждения
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
    setStep("Скачиваю бэкап…");
    let dump;
    try { dump = await freshDump("автобэкап перед очисткой"); }
    catch (e) { setErr("Не удалось сделать бэкап перед очисткой (" + e.message + "). Ничего не удалено — проверьте интернет и попробуйте ещё раз."); setStep(""); setBusy(false); return; }
    if (!tryDownloadBackup(JSON.stringify(dump))) { setErr("Браузер не дал скачать бэкап — очистка отменена."); setStep(""); setBusy(false); return; }
    try {
      const tables = ["finance_ops", "requests", "objects"];
      if (wh) tables.push("wh_moves", "warehouse");
      if (log) tables.push("audit_log");
      for (const t of tables) {
        setStep("Удаляю: " + t + "…");
        await deleteByIds(t, (dump.tables[t] || []).map((r) => r.id));
        // строки, добавленные кем-то за эти секунды
        const rest = await fetchAllRows(t);
        if (rest.length) await deleteByIds(t, rest.map((r) => r.id));
      }
      await logAction("База очищена", "", "удалено: " + tables.join(", "));
      setStep("");
      await onDone();
    } catch (e) { setErr("Ошибка очистки: " + e.message + ". Часть данных могла быть удалена — бэкап скачан, из него всё можно восстановить."); setStep(""); }
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
/* Привязка товаров к поставщикам из файла бэкапа.
   01.10 при восстановлении базы у всех товаров пропал поставщик (ON DELETE SET NULL). Из бэкапа, где связи ещё были,
   поставщик возвращается только тем товарам, у которых его сейчас нет; остальные данные не меняются.
   Товар ищется по id, а если его переимпортировали — по названию и размеру (только если такое название одно). */
function RelinkSuppliers({ data, reload, toast }) {
  const products = data.products || [], suppliers = data.suppliers || [];
  const noSup = useMemo(() => products.filter((p) => !p.supplier_id).length, [products]);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState("");
  const [err, setErr] = useState("");
  const fRef = useRef(null);
  const onFile = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    setErr(""); setPlan(null);
    try {
      const dump = JSON.parse(await f.text());
      const bp = (dump && dump.tables && dump.tables.products) || [];
      const bs = (dump && dump.tables && dump.tables.suppliers) || [];
      if (!bp.length) throw new Error("в файле нет товаров — выберите файл бэкапа Thermo (thermo_backup_….json)");
      const supIds = new Set(suppliers.map((x) => x.id));
      const supByName = {}; suppliers.forEach((x) => { supByName[String(x.name || "").trim().toLowerCase()] = x.id; });
      const bsName = {}; bs.forEach((x) => { bsName[x.id] = String(x.name || "").trim().toLowerCase(); });
      const resolve = (sid) => (supIds.has(sid) ? sid : supByName[bsName[sid]] || null);
      const nkey = (p) => String(p.name || "").trim().toLowerCase().replace(/\s+/g, " ") + "|" + String(p.size || "").trim().toLowerCase();
      const cur = new Map(products.map((p) => [p.id, p]));
      const curByName = new Map(), dupCur = new Set();
      products.forEach((p) => { const k = nkey(p); if (curByName.has(k)) dupCur.add(k); else curByName.set(k, p); });
      const dupB = new Set(), seenB = new Set();
      bp.forEach((p) => { const k = nkey(p); if (seenB.has(k)) dupB.add(k); else seenB.add(k); });
      const bySup = {}, done = new Set();
      let n = 0, byName = 0, withSup = 0;
      bp.forEach((b) => {
        if (!b.supplier_id) return;
        withSup++;
        const sid = resolve(b.supplier_id); if (!sid) return;
        let p = cur.get(b.id), viaName = false;
        if (!p) { const k = nkey(b); if (!dupCur.has(k) && !dupB.has(k)) { p = curByName.get(k); viaName = true; } }
        if (!p || p.supplier_id || done.has(p.id)) return;
        done.add(p.id); (bySup[sid] = bySup[sid] || []).push(p.id); n++; if (viaName) byName++;
      });
      setPlan({ bySup, n, byName, withSup, fname: f.name, date: dump._date });
    } catch (e2) { setErr("Не удалось прочитать файл: " + e2.message); }
  };
  const run = async () => {
    setBusy(true); setErr("");
    let done = 0;
    try {
      for (const [sid, ids] of Object.entries(plan.bySup)) {
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          if (sb) { const r = await sb.from("products").update({ supplier_id: sid }).in("id", chunk); if (r.error) throw new Error(r.error.message); }
          else for (const id of chunk) { const r = await db.from("products").update({ supplier_id: sid }).eq("id", id); if (r.error) throw new Error(r.error.message || String(r.error)); }
          done += chunk.length; setProg(done + " / " + plan.n);
        }
      }
      await logAction("Восстановлена привязка товаров к поставщикам", "products", "товаров: " + done + " · файл " + plan.fname);
      setPlan(null); await reload("all"); toast("Поставщик восстановлен у " + done + " товаров");
    } catch (e) { setErr("Ошибка: " + e.message + ". Уже исправлено: " + done + ". Выберите файл ещё раз — продолжится с оставшихся."); setPlan(null); await reload("all"); }
    setBusy(false); setProg("");
  };
  return (
    <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
      <h3 style={{ marginBottom: 6 }}>Поставщики у товаров</h3>
      <p className="xs mut" style={{ marginBottom: 8 }}>
        {noSup ? <>Без поставщика: <b style={{ color: "var(--warn)" }}>{noSup.toLocaleString("ru-RU")}</b> из {products.length.toLocaleString("ru-RU")} товаров. Закупки таких товаров не попадают в долг поставщику. Поставщика можно вернуть из файла бэкапа, где он ещё был указан (например, thermo_backup_2026-10-01_2.json) — другие данные не изменятся.</>
          : <>У всех товаров указан поставщик ✓</>}
      </p>
      {err && <p className="sm" style={{ color: "var(--bad)", marginBottom: 6 }}>{err}</p>}
      {noSup > 0 && !plan && <button className="btn" disabled={busy} onClick={() => fRef.current.click()}>🔗 Восстановить из файла бэкапа…</button>}
      <input ref={fRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={onFile} />
      {plan && (
        <div className="card" style={{ padding: 10 }}>
          <div className="sm" style={{ marginBottom: 8 }}>Файл «{plan.fname}»{plan.date ? " (бэкап от " + dt(plan.date) + ")" : ""}: товаров с поставщиком — {plan.withSup.toLocaleString("ru-RU")}.{" "}
            {plan.n ? <>Можно восстановить поставщика у <b>{plan.n.toLocaleString("ru-RU")}</b> товаров{plan.byName ? " (из них по названию: " + plan.byName + ")" : ""}.</> : <b>Подходящих товаров нет — в этом файле поставщики тоже не указаны или товары другие.</b>}</div>
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            {busy && <span className="sm mut" style={{ marginRight: "auto" }}><span className="spin" /> {prog}</span>}
            <button className="btn" disabled={busy} onClick={() => setPlan(null)}>Отмена</button>
            {plan.n > 0 && <button className="btn pri" disabled={busy} onClick={run}>{busy ? "Записываю…" : "Восстановить у " + plan.n}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
function BackupModal({ data, reload, onClose, toast, onFilePick, onRestoreText, onWipe }) {
  // JSON бэкапа собирается только по кнопке — при большой базе (15 000+ товаров это несколько МБ)
  // вывод всего текста в поле при открытии окна подвешивал браузер. Данные берутся свежие из базы.
  const [packing, setPacking] = useState(false);
  const buildJson = async () => {
    setPacking(true); setErr("");
    try { return JSON.stringify(await freshDump()); }
    catch (e) { setErr("Не удалось прочитать базу для бэкапа: " + e.message); return null; }
    finally { setPacking(false); }
  };
  const totalRows = TABLES.reduce((a, t) => a + (data[t] || []).length, 0);
  const [manualJson, setManualJson] = useState("");
  const [restoreTxt, setRestoreTxt] = useState("");
  const [err, setErr] = useState("");
  const taRef = useRef(null);
  const download = async () => { const json = await buildJson(); if (!json) return; const ok = tryDownloadBackup(json); toast(ok ? "Файл бэкапа скачан" : "Скачивание заблокировано — используйте «Копировать»"); };
  const copy = async () => {
    const json = await buildJson(); if (!json) return;
    try { await navigator.clipboard.writeText(json); toast("Бэкап скопирован в буфер (" + Math.round(json.length / 1024) + " КБ)"); return; } catch (e) {}
    setManualJson(json); toast("Автокопирование недоступно — выделите текст в поле и скопируйте вручную");
  };
  return (
    <Modal title="Бэкап и восстановление базы" onClose={onClose} w={680}>
      <h3 style={{ marginBottom: 6 }}>Сохранить</h3>
      <p className="xs mut" style={{ marginBottom: 8 }}>Скачайте файл бэкапа (рекомендуется) или скопируйте его текст. В бэкап входит вся база: {totalRows.toLocaleString("ru-RU")} записей, из них товаров {(data.products || []).length.toLocaleString("ru-RU")}.</p>
      <div className="row" style={{ marginTop: 8, marginBottom: manualJson ? 8 : 18 }}>
        <button className="btn pri" disabled={packing} onClick={download}>{packing ? <span><span className="spin" /> Собираю…</span> : "⬇ Скачать файлом"}</button>
        <button className="btn" disabled={packing} onClick={copy}>📋 Копировать бэкап</button>
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
      <RelinkSuppliers data={data} reload={reload} toast={toast} />
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
