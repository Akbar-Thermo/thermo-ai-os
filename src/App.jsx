import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { db } from "./db.js";

/* ============================================================
   THERMO ENGINEERING — AI Procurement & Finance OS
   DATA LAYER = Supabase (db импортируется из ./db.js)
   ============================================================ */

const SEGMENTS = ["бюджет", "эконом", "комфорт", "премиум"];
const OBJ_STATUSES = [
  { id: "draft", label: "Черновик", c: "#9a9a9a" },
  { id: "review", label: "На проверке", c: "#ffb020" },
  { id: "approved", label: "Согласовано", c: "#ffffff" },
  { id: "partial", label: "Частично оплачено", c: "#ff707b" },
  { id: "paid", label: "Оплачено", c: "#3ddc7d" },
  { id: "shipped", label: "Отгружено", c: "#d6d6d6" },
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
const OBJECT_OP_TYPES = ["client_payment", "supplier_payment", "return", "discount", "expense", "bonus"];
const ROLES = [
  { id: "manager", label: "Менеджер", tabs: ["request", "objects", "products", "wh", "suppliers", "masters"] },
  { id: "boss", label: "Руководитель", tabs: ["dash", "request", "objects", "products", "wh", "suppliers", "masters", "finance", "log", "admin"] },
];
const MANAGER_OP_TYPES = ["client_payment", "return", "discount"];
const CONF_THRESHOLD = 80;
const EXPENSE_CATEGORIES = ["Зарплата", "Аренда", "Коммунальные", "Обед / питание", "Транспорт / ГСМ", "Связь / интернет", "Налоги", "Реклама", "Хозрасходы", "Прочее"];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
:root{
  --bg:#070707; --panel:#121212; --panel2:#1a1a1a; --line:#262626; --line2:#383838;
  --txt:#ffffff; --mut:#9a9a9a; --acc:#ff1f30; --acc2:#ff707b; --ok:#3ddc7d; --warn:#ffb020; --bad:#ff4d5e;
  --mono:'JetBrains Mono',monospace; --sans:'Manrope',sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
.te{font-family:var(--sans);background:var(--bg);color:var(--txt);min-height:100vh;font-size:14px;
  background-image:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(255,31,48,.10),transparent),
  repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,.015) 40px)}
.hdr{display:flex;align-items:center;gap:14px;padding:14px 22px;border-bottom:2px solid var(--acc);flex-wrap:wrap;position:sticky;top:0;background:rgba(7,7,7,.94);backdrop-filter:blur(8px);z-index:50;box-shadow:0 6px 24px rgba(255,31,48,.12)}
.logo{font-weight:800;letter-spacing:.5px;font-size:17px;color:#fff}
.logo span{color:var(--acc)}
.logo small{display:block;font-weight:500;color:var(--mut);font-size:10px;letter-spacing:2px;text-transform:uppercase}
.tabs{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}
.tab{padding:8px 14px;border-radius:8px;border:1px solid transparent;color:var(--mut);cursor:pointer;font-weight:600;font-size:13px;background:none;font-family:var(--sans)}
.burger{display:none;align-items:center;justify-content:center;width:38px;height:38px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:#fff;cursor:pointer;font-size:18px;margin-left:auto}
@media(max-width:820px){
  .tabs{display:none;position:absolute;top:100%;left:0;right:0;flex-direction:column;flex-wrap:nowrap;gap:0;margin:0;background:#0c0c0c;border-bottom:2px solid var(--acc);box-shadow:0 16px 30px rgba(0,0,0,.6);padding:6px;z-index:60}
  .tabs.open{display:flex}
  .tab{width:100%;text-align:left;padding:12px 14px;border-radius:6px}
  .burger{display:flex}
}
.tab:hover{color:var(--txt);background:var(--panel2)}
.tab.on{color:#fff;border-color:var(--acc);background:var(--acc);box-shadow:0 4px 16px rgba(255,31,48,.35)}
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
table.t tr:hover td{background:rgba(255,255,255,.02)}
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
.pick-row:hover{background-color:#241112 !important}
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
async function restoreFromSupabase(dump) {
  if (!dump.tables) throw new Error("Неверный формат бэкапа");
  for (const t of TABLES) {
    if (!Array.isArray(dump.tables[t])) continue;
    // Удаляем все существующие записи и вставляем из бэкапа
    const { data: existing } = await db.from(t).select();
    for (const row of (existing || [])) {
      await db.from(t).delete().eq("id", row.id);
    }
    for (const row of dump.tables[t]) {
      await db.from(t).insert(row);
    }
  }
}
async function importBackup(file) {
  const text = await file.text();
  const dump = JSON.parse(text);
  await restoreFromSupabase(dump);
}


/* ============ HELPERS ============ */
const fmt = (n) => (Number(n) || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const fmt2 = (n) => (Number(n) || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => fmt(n) + " сум";
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
    clientDebt: Math.max(0, saleNet - paidClient),
    supplierDebt: Math.max(0, costNet - paidSup),
  };
}
function supplierStats(sup, objects, ops) {
  let purchases = 0;
  objects.forEach((ob) => {
    if (ob.status === "cancelled") return;
    (ob.items || []).forEach((i) => { if (i.supplier_id === sup.id && !i.from_warehouse) purchases += (i.qty || 0) * (i.cost || 0); });
  });
  const o = ops.filter((x) => !x.voided && x.supplier_id === sup.id);
  const paid = o.filter((x) => x.type === "supplier_payment").reduce((a, x) => a + (x.amount || 0), 0);
  const returns = o.filter((x) => x.type === "return").reduce((a, x) => a + (x.cost_amount || 0), 0);
  return { purchases, paid, returns, debt: Math.max(0, purchases - returns - paid) };
}
function masterStats(m, objects, ops) {
  const objs = objects.filter((o) => o.status !== "cancelled" && (o.master_id === m.id || (o.master && o.master === m.name)));
  let sale = 0, gross = 0, net = 0, accrued = 0, clientDebt = 0;
  const rows = objs.map((o) => {
    const f = calcObject(o, ops);
    sale += f.saleNet; gross += f.gross; net += f.net; accrued += f.bonus; clientDebt += f.clientDebt;
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
function downloadXLSX(filename, rows, sheetName) {
  try {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName || "Лист1");
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
function ProductPicker({ products, onPick, placeholder }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    if (q.length < 2) return [];
    const s = q.toLowerCase();
    return products.filter((p) => p.status !== "archive" && (p.name + " " + (p.alt_names || "") + " " + p.code).toLowerCase().includes(s)).slice(0, 8);
  }, [q, products]);
  return (
    <div style={{ position: "relative", minWidth: 220, flex: 1, zIndex: hits.length ? 999 : "auto" }}>
      <input className="inp" placeholder={placeholder || "Поиск товара для добавления…"} value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <div style={{ position: "absolute", top: "105%", left: 0, right: 0, backgroundColor: "#101010", border: "1px solid var(--acc)", borderRadius: 8, zIndex: 1000, maxHeight: 260, overflow: "auto", boxShadow: "0 16px 44px rgba(0,0,0,.95), 0 0 0 1px rgba(255,31,48,.15)", isolation: "isolate" }}>
          {hits.map((p) => (
            <div key={p.id} className="clk pick-row" style={{ padding: "9px 11px", borderBottom: "1px solid var(--line)", backgroundColor: "#101010" }}
              onClick={() => { onPick(p); setQ(""); }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#fff" }}>{p.name}</div>
              <div className="xs mono" style={{ color: "#b9b9b9" }}>{p.size} · {money(p.price)} · ост. {p.stock}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ PRODUCTS TAB ============ */
function ProductsTab({ data, reload, toast }) {
  const { products, suppliers } = data;
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState("");
  const [supF, setSupF] = useState("");
  const [brandF, setBrandF] = useState("");
  const [edit, setEdit] = useState(null);
  const [imp, setImp] = useState(false);
  const [sel, setSel] = useState([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const brands = useMemo(() => [...new Set(products.map((p) => p.brand).filter(Boolean))].sort(), [products]);
  const list = products.filter((p) =>
    (!seg || p.segment === seg) &&
    (!supF || p.supplier_id === supF) &&
    (!brandF || p.brand === brandF) &&
    (!q || (p.name + " " + (p.alt_names || "") + " " + p.code + " " + (p.category || "")).toLowerCase().includes(q.toLowerCase()))
  );
  const supName = (id) => (suppliers.find((s) => s.id === id) || {}).name || "—";
  const allSel = list.length > 0 && list.every((p) => sel.includes(p.id));
  const toggleAll = () => setSel(allSel ? sel.filter((id) => !list.some((p) => p.id === id)) : [...new Set([...sel, ...list.map((p) => p.id)])]);
  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const doDelete = async () => {
    for (const id of sel) await db.from("products").delete().eq("id", id);
    setConfirmDel(false); setSel([]); await reload(); toast("Удалено товаров: " + sel.length);
  };
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>База товаров <span className="mut sm">({products.length})</span></h2>
        <input className="inp" style={{ maxWidth: 200 }} placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp" style={{ maxWidth: 140 }} value={seg} onChange={(e) => setSeg(e.target.value)}>
          <option value="">Все сегменты</option>
          {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
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
        <button className="btn pri" onClick={() => setEdit({ segment: "комфорт", unit: "шт", status: "active", stock: 0, cost: 0, price: 0 })}>+ Товар</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th style={{width:28}}><input type="checkbox" checked={allSel} onChange={toggleAll} title="Выбрать все отфильтрованные" /></th><th>Код</th><th>Бренд</th><th>Поставщик</th><th>Наименование</th><th>Размер/Ø</th><th>Ед.изм</th><th style={{textAlign:"right"}}>Себестоимость</th><th style={{textAlign:"right"}}>Розничная</th><th>Сегмент</th><th></th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} style={{ opacity: p.status === "archive" ? 0.45 : 1, background: sel.includes(p.id) ? "rgba(255,31,48,.07)" : "none" }}>
                <td><input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} /></td>
                <td className="mono xs">{p.code}</td>
                <td className="sm">{p.brand}</td>
                <td className="sm">{supName(p.supplier_id)}</td>
                <td><div style={{ fontWeight: 600 }}>{p.name}</div>{(p.category || p.alt_names) && <div className="xs mut">{[p.category, p.alt_names].filter(Boolean).join(" · ")}</div>}</td>
                <td className="mono xs">{p.size}</td>
                <td className="sm">{p.unit}</td>
                <td className="num">{fmt2(p.cost)}</td>
                <td className="num">{fmt2(p.price)}</td>
                <td><Badge c="#ffffff">{p.segment}</Badge></td>
                <td><button className="btn xs" onClick={() => setEdit(p)}>ред.</button></td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={11} className="mut" style={{ textAlign: "center", padding: 26 }}>Ничего не найдено</td></tr>}
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
            <button className="btn" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={doDelete}>Удалить {sel.length}</button>
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
        <Fld label="Сегмент"><select className="inp" value={v.segment} onChange={set("segment")}>{SEGMENTS.map((s) => <option key={s}>{s}</option>)}</select></Fld>
        <Fld label="Поставщик"><select className="inp" value={v.supplier_id || ""} onChange={set("supplier_id")}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>
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
  const fRef = useRef(null);

  const num = (v) => Number(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")) || 0;

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
      if (products.length) await db.from("products").insert(products);
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
    if (out.length) await db.from("products").insert(out);
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
              <select className="inp" value={sid} onChange={(e) => setSid(e.target.value)}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
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
              <select className="inp" style={{ maxWidth: 280 }} value={sid} onChange={(e) => setSid(e.target.value)}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
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
              {busy ? <span><span className="spin" /> Импортирую…</span> : "Импортировать " + dataRows.length + " строк →"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ============ SUPPLIERS TAB ============ */
function SuppliersTab({ data, reload, toast, fin = true }) {
  const { suppliers, objects, finance_ops, products } = data;
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [pay, setPay] = useState(null);
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Поставщики</h2>
        <button className="btn pri" onClick={() => setEdit({ status: "active", segment: "комфорт", currency: "сум" })}>+ Поставщик</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Поставщик</th><th>Контакт</th><th>Сегмент</th><th>Условия</th><th style={{textAlign:"right"}}>Закупки</th><th style={{textAlign:"right"}}>Оплачено</th><th style={{textAlign:"right"}}>Возвраты</th><th style={{textAlign:"right"}}>Долг</th><th style={{textAlign:"right"}}>Товаров</th><th></th></tr></thead>
          <tbody>
            {suppliers.map((s) => {
              const st = supplierStats(s, objects, finance_ops);
              const cnt = products.filter((p) => p.supplier_id === s.id).length;
              return (
                <tr key={s.id}>
                  <td style={{ fontWeight: 700 }}>{s.name}</td>
                  <td className="sm">{s.contact}<div className="xs mut mono">{s.phone}</div></td>
                  <td><Badge c="#ffffff">{s.segment}</Badge></td>
                  <td className="sm mut">{s.terms}</td>
                  <td className="num">{fmt(st.purchases)}</td>
                  <td className="num" style={{ color: "var(--ok)" }}>{fmt(st.paid)}</td>
                  <td className="num">{fmt(st.returns)}</td>
                  <td className="num" style={{ color: st.debt > 0 ? "var(--bad)" : "var(--mut)", fontWeight: 700 }}>{fmt(st.debt)}</td>
                  <td className="num">{cnt}</td>
                  <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                    <button className="btn xs" style={{ color: "var(--ok)" }} onClick={() => setPay(s)}>💵 оплата</button>
                    <button className="btn xs" onClick={() => setEdit(s)}>ред.</button>
                    {fin && <button className="btn xs dng" onClick={() => setDel(s)}>✕</button>}
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pay && <SupplierPayModal s={pay} objects={objects} ops={finance_ops} fin={fin} onClose={() => setPay(null)}
        onSave={async (op) => { await db.from("finance_ops").insert(cleanUuids(op)); await logAction("Оплата поставщику", "supplier:" + pay.name, fmt(op.amount) + " · " + (op.note || "")); await reload(); toast("Оплата поставщику записана"); }}
        onEditPay={async (o, patch) => {
          const log = [...(o.edit_log || []), { at: new Date().toISOString(), before: { amount: o.amount, op_date: o.op_date, note: o.note } }];
          await db.from("finance_ops").update({ ...patch, edited: true, edit_log: log }).eq("id", o.id);
          await logAction("Изменена оплата поставщику", "supplier:" + pay.name, "было " + fmt(o.amount) + " → стало " + fmt(patch.amount)); await reload(); toast("Оплата изменена");
        }}
        onVoidPay={async (o) => {
          await db.from("finance_ops").update({ voided: true }).eq("id", o.id);
          await logAction("Сторно оплаты поставщику", "supplier:" + pay.name, fmt(o.amount)); await reload(); toast("Оплата сторнирована");
        }} />}
      {del && (() => {
        const st = supplierStats(del, objects, finance_ops);
        const cnt = products.filter((p) => p.supplier_id === del.id).length;
        return (
          <Modal title="Удалить поставщика" onClose={() => setDel(null)} w={480}>
            <p style={{ marginBottom: 8 }}>Удалить поставщика <b style={{ color: "var(--bad)" }}>{del.name}</b>?</p>
            {st.debt > 0 && <p className="sm" style={{ color: "var(--warn)", marginBottom: 6 }}>⚠ Текущий долг поставщику: {fmt(st.debt)} — он исчезнет из учёта долгов.</p>}
            {cnt > 0 && <p className="sm mut" style={{ marginBottom: 6 }}>К нему привязано товаров: {cnt} — они останутся в базе без поставщика.</p>}
            <p className="sm mut" style={{ marginBottom: 12 }}>История финансовых операций сохранится. Действие необратимо.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setDel(null)}>Отмена</button>
              <button className="btn" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={async () => {
                await db.from("products").update({ supplier_id: null }).eq("supplier_id", del.id);
                await db.from("suppliers").delete().eq("id", del.id);
                setDel(null); await reload(); toast("Поставщик удалён");
              }}>Удалить</button>
            </div>
          </Modal>
        );
      })()}
      {edit && (
        <Modal title={edit.id ? "Поставщик" : "Новый поставщик"} onClose={() => setEdit(null)}>
          <SupplierForm s={edit} onSave={async (v) => {
            if (v.id) await db.from("suppliers").update(v).eq("id", v.id);
            else await db.from("suppliers").insert(v);
            setEdit(null); await reload(); toast("Сохранено");
          }} />
        </Modal>
      )}
    </div>
  );
}
function SupplierPayModal({ s, objects, ops, onClose, onSave, onEditPay, onVoidPay, fin }) {
  const st = supplierStats(s, objects, ops);
  const [amount, setAmount] = useState(st.debt || 0);
  const [opDate, setOpDate] = useState(today());
  const [note, setNote] = useState("");
  const [user, setUser] = useState(CURRENT_USER ? (CURRENT_USER.name || CURRENT_USER.username) : "");
  const [edit, setEdit] = useState(null);
  const history = ops.filter((o) => o.supplier_id === s.id && (o.type === "supplier_payment" || o.type === "return"))
    .sort((a, b) => String(b.op_date || b.created_at).localeCompare(String(a.op_date || a.created_at)));
  const objName = (id) => (objects.find((o) => o.id === id) || {}).name || "—";
  return (
    <Modal title={"Оплата поставщику — " + s.name} onClose={onClose} w={640}>
      <div className="kpis sect" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <div className="kpi"><div className="l">Закупки</div><div className="v">{fmt(st.purchases)}</div></div>
        <div className="kpi"><div className="l">Оплачено</div><div className="v" style={{ color: "var(--ok)" }}>{fmt(st.paid)}</div></div>
        <div className="kpi"><div className="l">Текущий долг</div><div className="v" style={{ color: st.debt > 0 ? "var(--bad)" : "var(--mut)" }}>{fmt(st.debt)}</div></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
        <Fld label="Сумма оплаты"><input type="number" className="inp" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} /></Fld>
        <Fld label="Дата оплаты"><input type="date" className="inp" value={opDate} onChange={(e) => setOpDate(e.target.value)} /></Fld>
        <Fld label="Комментарий"><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="часть / аванс / закрытие…" /></Fld>
        <Fld label="Кто оплатил"><input className="inp" value={user} onChange={(e) => setUser(e.target.value)} /></Fld>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn xs" onClick={() => setAmount(st.debt)}>= весь долг</button>
        <button className="btn xs" onClick={() => setAmount(Math.round(st.debt / 2 * 100) / 100)}>= половина</button>
        <button className="btn pri" disabled={!amount} onClick={() => { onSave({ type: "supplier_payment", supplier_id: s.id, object_id: null, amount, op_date: opDate || today(), note, user }); setAmount(0); }}>Записать оплату</button>
      </div>
      <h3 style={{ margin: "16px 0 8px" }}>История оплат и возвратов</h3>
      <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
        <table className="t">
          <thead><tr><th>Дата</th><th>Тип</th><th style={{textAlign:"right"}}>Сумма</th><th>Детали</th><th></th></tr></thead>
          <tbody>
            {history.map((o) => (
              edit && edit.id === o.id ? (
                <tr key={o.id} style={{ background: "rgba(255,31,48,.06)" }}>
                  <td><input type="date" className="inp" style={{ fontSize: 11 }} value={(edit.op_date || "").slice(0,10)} onChange={(e) => setEdit({ ...edit, op_date: e.target.value })} /></td>
                  <td className="sm">Оплата</td>
                  <td><input type="number" className="inp num" style={{ width: 100 }} value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: Number(e.target.value) || 0 })} /></td>
                  <td><input className="inp" style={{ fontSize: 11 }} value={edit.note || ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></td>
                  <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                    <button className="btn xs pri" onClick={async () => { await onEditPay(o, { amount: edit.amount, op_date: edit.op_date, note: edit.note }); setEdit(null); }}>✓</button>
                    <button className="btn xs" onClick={() => setEdit(null)}>✕</button>
                  </div></td>
                </tr>
              ) : (
              <tr key={o.id} style={{ opacity: o.voided ? 0.4 : 1, textDecoration: o.voided ? "line-through" : "none" }}>
                <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                <td className="sm">{o.type === "supplier_payment" ? "Оплата" : "Возврат (−долг)"}{o.edited && <span className="xs" style={{ color: "var(--warn)" }}> изм.</span>}</td>
                <td className="num" style={{ fontWeight: 700, color: o.type === "supplier_payment" ? "var(--ok)" : "var(--acc2)" }}>{fmt(o.type === "return" ? o.cost_amount : o.amount)}</td>
                <td className="xs mut">{[o.object_id ? objName(o.object_id) : "", o.product_name, o.note].filter(Boolean).join(" · ")}</td>
                <td>{o.type === "supplier_payment" && !o.voided && (
                  <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                    <button className="btn xs" onClick={() => setEdit({ id: o.id, amount: o.amount, op_date: (o.op_date || o.created_at || "").slice(0,10), note: o.note })}>ред.</button>
                    {fin && <button className="btn xs dng" onClick={() => onVoidPay(o)}>сторно</button>}
                  </div>
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
function SupplierForm({ s, onSave }) {
  const [v, setV] = useState({ ...s });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Fld label="Название"><input className="inp" value={v.name || ""} onChange={set("name")} /></Fld>
        <Fld label="Контактное лицо"><input className="inp" value={v.contact || ""} onChange={set("contact")} /></Fld>
        <Fld label="Телефон"><input className="inp" value={v.phone || ""} onChange={set("phone")} /></Fld>
        <Fld label="Сегмент"><select className="inp" value={v.segment} onChange={set("segment")}>{SEGMENTS.map((x) => <option key={x}>{x}</option>)}</select></Fld>
        <Fld label="Условия оплаты"><input className="inp" value={v.terms || ""} onChange={set("terms")} /></Fld>
        <Fld label="Статус"><select className="inp" value={v.status} onChange={set("status")}><option value="active">активен</option><option value="inactive">неактивен</option></select></Fld>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn pri" disabled={!v.name} onClick={() => onSave(v)}>Сохранить</button>
      </div>
    </div>
  );
}

/* ============ REQUEST WIZARD (заявка → AI extraction → AI match) ============ */
function RequestWizard({ data, reload, toast, openObject }) {
  const { products, suppliers, objects, masters } = data;
  const [step, setStep] = useState(0);
  const [objId, setObjId] = useState("");
  const [newObj, setNewObj] = useState({ name: "", client: "", phone: "", master: "", master_id: "", manager: "", address: "", segment: "комфорт" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lines, setLines] = useState([]); // { product_id, name, size, unit, qty, price, manual }
  const [catF, setCatF] = useState("");

  const activeObjects = objects.filter((o) => !["closed", "cancelled"].includes(o.status));
  const selObj = objects.find((o) => o.id === objId);
  const segment = selObj ? selObj.segment : newObj.segment;
  const prodById = (id) => products.find((p) => p.id === id);
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products]);

  const addFromBase = (p) => {
    setLines((prev) => {
      const ex = prev.find((l) => l.product_id === p.id);
      if (ex) return prev.map((l) => (l.product_id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { id: uuid(), product_id: p.id, name: p.name, size: p.size, unit: p.unit, qty: 1, price: p.price, manual: false }];
    });
  };
  const addManualLine = () => {
    setLines((prev) => [...prev, { id: uuid(), product_id: null, name: "", size: "", unit: "шт", qty: 1, price: 0, manual: true }]);
  };
  const setLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setLines((prev) => prev.filter((l) => l.id !== id));

  const filteredProducts = useMemo(() => {
    let pool = products.filter((p) => p.status !== "archive");
    if (catF) pool = pool.filter((p) => p.category === catF);
    return pool;
  }, [products, catF]);

  const save = async () => {
    if (!lines.length) { setErr("Добавьте хотя бы одну позицию"); return; }
    const incomplete = lines.find((l) => !l.product_id && (!l.name || !l.name.trim()));
    if (incomplete) { setErr("Заполните название для всех ручных позиций"); return; }
    setBusy(true); setErr("");
    try {
      let obj = selObj;
      if (!obj) {
        const objData = cleanUuids({ ...newObj, status: "draft", items: [] });
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
        return {
          id: uuid(), product_id: p ? p.id : null, name: p ? p.name : l.name, size: p ? p.size : l.size, unit: p ? p.unit : l.unit,
          qty: l.qty, price: l.price, cost: p ? p.cost : 0, supplier_id: p ? p.supplier_id : null,
          source_text: p ? p.name : l.name, confidence: 100,
          batch_no: batchNo, batch_date: today(),
        };
      });
      await db.from("objects").update({ items: [...(obj.items || []), ...items] }).eq("id", obj.id);
      await db.from("requests").insert(cleanUuids({
        object_id: obj.id, segment, mode: "manual", source: "manual",
        lines: lines.map((l) => ({ source: l.name, ai_product_id: null, final_product_id: l.product_id, confidence: 100, corrected: false })),
      }));
      await logAction("Заявка сохранена", "object:" + obj.name, "поставка №" + batchNo + ", позиций: " + items.length);
      toast("Поставка №" + batchNo + " сохранена: " + items.length + " поз. → «" + obj.name + "»");
      setStep(0); setLines([]); setObjId("");
      await reload();
      openObject(obj.id);
    } catch (e) { setErr("Ошибка сохранения: " + e.message); }
    setBusy(false);
  };

  const totalCost = lines.reduce((a, l) => { const p = l.product_id ? prodById(l.product_id) : null; return a + l.qty * (p ? p.cost : 0); }, 0);
  const totalSale = lines.reduce((a, l) => a + l.qty * (Number(l.price) || 0), 0);

  return (
    <div>
      <h2>Новая заявка</h2>
      <div className="steps">
        {["Объект и сегмент", "Подбор товаров"].map((s, i) => (
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
                <Fld label="Название объекта"><input className="inp" value={newObj.name} onChange={(e) => setNewObj({ ...newObj, name: e.target.value })} placeholder="Дом, ул. Чиланзар 12" /></Fld>
                <Fld label="Клиент"><input className="inp" value={newObj.client} onChange={(e) => setNewObj({ ...newObj, client: e.target.value })} /></Fld>
                <Fld label="Телефон клиента"><input className="inp" value={newObj.phone} onChange={(e) => setNewObj({ ...newObj, phone: e.target.value })} /></Fld>
                <Fld label="Мастер"><select className="inp" value={newObj.master_id} onChange={(e) => { const m = masters.find((x) => x.id === e.target.value); setNewObj({ ...newObj, master_id: e.target.value, master: m ? m.name : "" }); }}>
                  <option value="">—</option>{masters.filter((m) => m.status === "active").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Fld>
                <Fld label="Менеджер"><input className="inp" value={newObj.manager} onChange={(e) => setNewObj({ ...newObj, manager: e.target.value })} /></Fld>
                <Fld label="Адрес"><input className="inp" value={newObj.address} onChange={(e) => setNewObj({ ...newObj, address: e.target.value })} /></Fld>
                <Fld label="Сегмент"><select className="inp" value={newObj.segment} onChange={(e) => setNewObj({ ...newObj, segment: e.target.value })}>{SEGMENTS.map((s) => <option key={s}>{s}</option>)}</select></Fld>
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
            <h3 style={{ marginRight: "auto" }}>Подбор товаров · сегмент <Badge c="#ffffff">{segment}</Badge></h3>
          </div>

          <div className="row" style={{ marginBottom: 12, gap: 10 }}>
            <select className="inp" style={{ maxWidth: 220 }} value={catF} onChange={(e) => setCatF(e.target.value)}>
              <option value="">Все категории</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
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
                <thead><tr><th>Товар</th><th style={{ width: 90 }}>Кол-во</th><th style={{ width: 110, textAlign: "right" }}>Цена</th><th style={{ textAlign: "right" }}>Себестоимость</th><th style={{ textAlign: "right" }}>Сумма (себест.)</th><th>Ост.</th><th></th></tr></thead>
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
                                <input className="inp" style={{ width: 70 }} placeholder="ед." value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value })} />
                              </div>
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
                        <td><input type="number" className="inp" style={{ textAlign: "right" }} value={l.price} onChange={(e) => setLine(l.id, { price: Number(e.target.value) || 0 })} /></td>
                        <td className="num">{p ? fmt2(p.cost) : "—"}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{p ? fmt(l.qty * p.cost) : "—"}</td>
                        <td className="num" style={{ color: p && p.stock < l.qty ? "var(--bad)" : "var(--ok)" }}>{p ? p.stock : "—"}</td>
                        <td><button className="btn xs dng" onClick={() => removeLine(l.id)}>✕</button></td>
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
              Позиций: {lines.length} · Себестоимость: <span style={{ color: "var(--acc2)" }}>{money(totalCost)}</span> · Продажа: <span style={{ color: "var(--ok)" }}>{money(totalSale)}</span>
            </div>
          </div>

          <div className="row" style={{ marginTop: 16, justifyContent: "space-between" }}>
            <button className="btn" onClick={() => setStep(0)}>← Назад</button>
            <button className="btn pri" disabled={busy || !lines.length} onClick={save}>
              {busy ? <span><span className="spin" /> Сохраняю…</span> : "Сохранить в объект ✓"}
            </button>
          </div>
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
          <thead><tr><th>Объект</th><th>Клиент</th><th>Мастер</th><th>Сегмент</th><th>Статус</th><th style={{textAlign:"right"}}>Сумма товара</th>{fin && <th style={{textAlign:"right"}}>Прибыль</th>}<th style={{textAlign:"right"}}>Долг клиента</th><th>Дата</th><th></th></tr></thead>
          <tbody>
            {objects.map((o) => {
              const f = calcObject(o, finance_ops);
              const st = stById(o.status);
              return (
                <tr key={o.id} className="clk" onClick={() => setOpenId(o.id)}>
                  <td style={{ fontWeight: 700 }}>{o.name}<div className="xs mut">{o.address}</div></td>
                  <td className="sm">{o.client}</td>
                  <td className="sm">{o.master}</td>
                  <td><Badge c="#ffffff">{o.segment}</Badge></td>
                  <td><Badge c={st.c}>{st.label}</Badge></td>
                  <td className="num">{fmt(f.saleNet)}</td>
                  {fin && <td className="num" style={{ color: f.net >= 0 ? "var(--ok)" : "var(--bad)" }}>{fmt(f.net)}</td>}
                  <td className="num" style={{ color: f.clientDebt > 0 ? "var(--bad)" : "var(--mut)" }}>{fmt(f.clientDebt)}</td>
                  <td className="xs mut mono">{dt(o.created_at)}</td>
                  <td><button className="btn xs dng" onClick={(e) => { e.stopPropagation(); setDelObj(o); }}>✕</button></td>
                </tr>
              );
            })}
            {!objects.length && <tr><td colSpan={fin ? 10 : 9} className="mut" style={{ textAlign: "center", padding: 30 }}>Объектов пока нет — создайте через «Новая заявка»</td></tr>}
          </tbody>
        </table>
      </div>
      {delObj && (() => { const f = calcObject(delObj, finance_ops); return (
        <Modal title="Удалить объект" onClose={() => setDelObj(null)} w={460}>
          <p style={{ marginBottom: 6 }}>Удалить объект <b style={{ color: "var(--bad)" }}>{delObj.name}</b> ({delObj.client})?</p>
          {(f.clientDebt > 0 || f.supplierDebt > 0) && <p className="sm" style={{ color: "var(--warn)", marginBottom: 6 }}>⚠ По объекту есть долги — клиента: {fmt(f.clientDebt)}, поставщикам: {fmt(f.supplierDebt)}.</p>}
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
  const toggleBatch = (no) => setClosedBatches({ ...closedBatches, [no]: !closedBatches[no] });
  const [editItem, setEditItem] = useState(null);
  const [addItems, setAddItems] = useState(false);
  const [impItems, setImpItems] = useState(false);
  const [delSelf, setDelSelf] = useState(false);
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
  const addManualItems = async (rows) => {
    const exNos = (obj.items || []).map((i) => i.batch_no || 1);
    const batchNo = exNos.length ? Math.max(...exNos) + 1 : 1;
    const items = rows.map((r) => ({
      id: uuid(), product_id: r.product_id || null, name: r.name, size: r.size, unit: r.unit || "шт",
      qty: r.qty, price: r.price, cost: r.cost, supplier_id: r.supplier_id || null,
      source_text: "добавлено вручную", confidence: 100, batch_no: batchNo, batch_date: today(), manual: true,
    }));
    await db.from("objects").update({ items: [...(obj.items || []), ...items] }).eq("id", obj.id);
    await reload(); toast("Добавлено вручную: " + items.length + " поз. (Поставка №" + batchNo + ")");
  };
  const voidOp = async (id) => {
    const op = ops.find((x) => x.id === id);
    await db.from("finance_ops").update({ voided: true }).eq("id", id);
    if (op && op.type === "return" && op.product_id) {
      const { data: ex } = await db.from("warehouse").select().eq("product_id", op.product_id);
      if (ex.length) await db.from("warehouse").update({ qty: Math.max(0, (ex[0].qty || 0) - (op.qty || 0)) }).eq("id", ex[0].id);
      await db.from("wh_moves").insert({ product_id: op.product_id, name: op.product_name, qty: op.qty, dir: "out", object_id: obj.id, object_name: obj.name, op_date: today(), user: "boss", note: "сторно возврата" });
    }
    await reload(); toast("Операция сторнирована (след сохранён)");
  };
  const safe = (s) => String(s || "object").replace(/[^a-zа-яё0-9_-]+/gi, "_").slice(0, 40);
  const exportClient = () => {
    const rows = [
      ["СПЕЦИФИКАЦИЯ", obj.name],
      ["Клиент", obj.client || ""],
      ["Дата", new Date().toLocaleDateString("ru-RU")],
      [],
    ];
    let n = 1;
    batches.forEach((b) => {
      rows.push(["ПОСТАВКА №" + b.no + " от " + dt(b.date)]);
      rows.push(["№", "Наименование", "Кол-во", "Ед.", "Цена", "Сумма"]);
      let sub = 0;
      b.items.forEach((i) => {
        const s = Math.round(i.qty * i.price * 100) / 100; sub += s;
        rows.push([n++, i.name, i.qty, i.unit, i.price, s]);
      });
      rows.push(["", "", "", "", "Итого по поставке №" + b.no, Math.round(sub * 100) / 100]);
      rows.push([]);
    });
    const returns = ops.filter((o) => o.type === "return" && !o.voided);
    if (returns.length) {
      rows.push(["ВОЗВРАТЫ"]);
      rows.push(["Дата", "Наименование", "Кол-во", "", "", "Сумма"]);
      returns.forEach((o) => rows.push([dt(o.op_date || o.created_at), o.product_name || "", o.qty || "", "", "", -(o.amount || 0)]));
      rows.push(["", "", "", "", "Итого возвратов", -f.retSale]);
      rows.push([]);
    }
    rows.push(["", "", "", "", "Итого по объекту", f.sale]);
    if (f.discount) rows.push(["", "", "", "", "Скидка", -f.discount]);
    if (f.retSale) rows.push(["", "", "", "", "Возвраты", -f.retSale]);
    rows.push(["", "", "", "", "К ОПЛАТЕ", f.saleNet]);
    const r = downloadXLSX("Спецификация_" + safe(obj.name) + ".xlsx", rows, "Клиенту");
    toast(r === "xlsx" ? "Excel для клиента скачан" : r === "csv" ? "Excel заблокирован — скачан CSV" : "Скачивание заблокировано браузером");
  };
  const exportDelivery = () => {
    const rows = [["ЛИСТ ДОСТАВКИ", obj.name], ["Адрес", obj.address || ""], ["Клиент / тел.", (obj.client || "") + " / " + (obj.phone || "")], ["Мастер", obj.master || ""], []];
    batches.forEach((b) => {
      rows.push(["══ ПОСТАВКА №" + b.no + " · " + dt(b.date) + " ══"]);
      const g = {};
      b.items.forEach((i) => {
        const k = i.from_warehouse ? "СКЛАД THERMO" : supName(i.supplier_id);
        (g[k] = g[k] || []).push(i);
      });
      Object.entries(g).forEach(([s, items]) => {
        rows.push(["ПОСТАВЩИК: " + s]);
        rows.push(["Наименование", "Размер", "Кол-во", "Ед."]);
        items.forEach((i) => rows.push([i.name, i.size || "", i.qty, i.unit]));
        rows.push([]);
      });
    });
    const r = downloadXLSX("Доставка_" + safe(obj.name) + ".xlsx", rows, "Доставка");
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
            {obj.client} · {obj.phone} · менеджер: {obj.manager || "—"} · <Badge c="#ffffff">{obj.segment}</Badge> · мастер:{" "}
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
        {onDelete && <button className="btn dng" onClick={() => setDelSelf(true)}>🗑 Удалить объект</button>}
      </div>

      <div className="kpis sect">
        <KPI l="Сумма товара (нетто)" v={f.saleNet} />
        {fin && <KPI l="Себестоимость" v={f.costNet} />}
        {fin && <KPI l="Валовая прибыль" v={f.gross} c={f.gross >= 0 ? "var(--ok)" : "var(--bad)"} />}
        {fin && <KPI l={"Маржа " + f.margin.toFixed(1) + "%"} v={f.net} c={f.net >= 0 ? "var(--ok)" : "var(--bad)"} />}
        <KPI l="Оплачено клиентом" v={f.paidClient} c="var(--ok)" />
        <KPI l="Долг клиента" v={f.clientDebt} c={f.clientDebt > 0 ? "var(--bad)" : "var(--mut)"} />
        <KPI l="Долг поставщикам" v={f.supplierDebt} c={f.supplierDebt > 0 ? "var(--warn)" : "var(--mut)"} />
        {fin && <KPI l="Бонус мастеру" v={f.bonus} />}
      </div>

      <div className="row sect" style={{ marginBottom: 8 }}>
        <h3 style={{ marginRight: "auto" }}>Материалы объекта</h3>
        <ProductPicker products={products} placeholder="+ добавить товар из базы…" onPick={(p) => addManualItems([{ product_id: p.id, name: p.name, size: p.size, unit: p.unit, qty: 1, price: p.price, cost: p.cost, supplier_id: p.supplier_id }])} />
        <button className="btn" onClick={() => setAddItems(true)}>+ Список вручную</button>
        <button className="btn" onClick={() => setImpItems(true)}>📊 Импорт Excel</button>
      </div>
      <div className="card sect" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Товар</th><th>Размер</th><th style={{width:90}}>Кол-во</th><th>Ед.</th>{fin && <th style={{textAlign:"right"}}>Закуп</th>}<th style={{textAlign:"right"}}>Цена</th><th style={{textAlign:"right"}}>Сумма</th><th>Поставщик</th><th>AI</th><th></th></tr></thead>
          <tbody>
            {batches.map((b) => (
              <React.Fragment key={b.no}>
                {batches.length > 1 || (obj.items || []).some((i) => i.batch_no) ? (
                  <tr className="clk" onClick={() => toggleBatch(b.no)}>
                    <td colSpan={fin ? 10 : 9} style={{ background: "rgba(255,31,48,.08)", fontWeight: 800, fontSize: 12, letterSpacing: ".5px", userSelect: "none" }}>
                      {closedBatches[b.no] ? "▸" : "▾"} 🚚 ПОСТАВКА №{b.no} · {dt(b.date)} · позиций: {b.items.length} · на сумму {fmt(b.items.reduce((a, i) => a + i.qty * i.price, 0))}
                      <span className="xs mut" style={{ fontWeight: 500 }}>  — нажмите чтобы {closedBatches[b.no] ? "раскрыть" : "свернуть"}</span>
                    </td>
                  </tr>
                ) : null}
                {!closedBatches[b.no] && b.items.map((i) => (
              <tr key={i.id}>
                <td style={{ fontWeight: 600 }}>{i.name}{i.from_warehouse && <Badge c="#3ddc7d"> склад</Badge>}<div className="xs mut">{i.from_warehouse ? "со склада Thermo" : "из заявки: " + i.source_text}</div></td>
                <td className="mono xs">{i.size}</td>
                <td><input type="number" className="inp" value={i.qty} onChange={(e) => setItemQty(i.id, Number(e.target.value) || 0)} /></td>
                <td className="sm">{i.unit}</td>
                {fin && <td className="num mut">{fmt(i.cost)}</td>}
                <td><input type="number" className="inp num" style={{ width: 104, textAlign: "right" }} value={i.price} onChange={(e) => setItemPrice(i.id, Number(e.target.value) || 0)} /></td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(i.qty * i.price)}</td>
                <td className="sm">{supName(i.supplier_id)}</td>
                <td><Conf v={i.confidence || 100} /></td>
                <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                  <button className="btn xs" onClick={() => setEditItem(i)}>ред.</button>
                  <button className="btn xs dng" onClick={() => delItem(i.id)}>✕</button>
                </div></td>
              </tr>
                ))}
              </React.Fragment>
            ))}
            {!(obj.items || []).length && <tr><td colSpan={fin ? 10 : 9} className="mut" style={{ textAlign: "center", padding: 22 }}>Материалов нет — добавьте через «Новая заявка»</td></tr>}
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
            {ops.filter((o) => fin || MANAGER_OP_TYPES.includes(o.type)).slice().reverse().map((o) => (
              <tr key={o.id} style={{ opacity: o.voided ? 0.4 : 1, textDecoration: o.voided ? "line-through" : "none" }}>
                <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                <td>{opLabel(o.type)}{o.type === "return" && o.product_name ? <div className="xs mut">{o.product_name} × {o.qty}</div> : null}{o.edited && <div className="xs" style={{ color: "var(--warn)" }}>изменено</div>}</td>
                <td className="num" style={{ fontWeight: 700, color: o.type === "client_payment" ? "var(--ok)" : "inherit" }}>{fmt(o.amount)}</td>
                <td className="xs mut">{[o.supplier_id ? supName(o.supplier_id) : "", o.item_name, o.reason, o.note].filter(Boolean).join(" · ")}</td>
                <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                  {!o.voided && (fin || MANAGER_OP_TYPES.includes(o.type)) && <button className="btn xs" onClick={() => setEditOp(o)}>✎</button>}
                  {fin && !o.voided && <button className="btn xs dng" onClick={() => voidOp(o.id)}>сторно</button>}
                </div></td>
              </tr>
            ))}
            {!ops.length && <tr><td colSpan={5} className="mut" style={{ textAlign: "center", padding: 20 }}>Операций нет</td></tr>}
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
      {editItem && <ItemEditModal item={editItem} suppliers={suppliers} fin={fin} onClose={() => setEditItem(null)} onSave={async (it) => { await saveItem(it); setEditItem(null); }} />}
      {addItems && <AddItemsModal products={products} suppliers={suppliers} onClose={() => setAddItems(false)} onSave={async (rows) => { await addManualItems(rows); setAddItems(false); }} />}
      {impItems && <ObjectExcelImport products={products} suppliers={suppliers} onClose={() => setImpItems(false)} onSave={async (rows) => { await addManualItems(rows); setImpItems(false); }} />}
      {editOp && <EditOpModal op={editOp} suppliers={suppliers} isReturn={editOp.type === "return"} onClose={() => setEditOp(null)} onSave={async (patch) => {
        const log = [...(editOp.edit_log || []), { at: new Date().toISOString(), before: { amount: editOp.amount, op_date: editOp.op_date, note: editOp.note, reason: editOp.reason } }];
        await db.from("finance_ops").update({ ...patch, edited: true, edit_log: log }).eq("id", editOp.id);
        await logAction("Изменена операция: " + opLabel(editOp.type), "object", "было " + fmt(editOp.amount) + (patch.amount != null ? " → " + fmt(patch.amount) : ""));
        setEditOp(null); await reload(); toast("Операция изменена (история сохранена)");
      }} />}
      {opForm && opForm.type === "return" && <ReturnForm obj={obj} ops={ops} onClose={() => setOpForm(null)} onSave={async (list) => {
        await db.from("finance_ops").insert(list.map(cleanUuids));
        await warehouseIn(list, obj.name);
        await logAction("Возврат товара", "object:" + obj.name, "позиций: " + list.length + ", сумма: " + fmt(list.reduce((a,x)=>a+(x.amount||0),0)));
        setOpForm(null); await reload(); toast("Возврат оформлен: " + list.length + " поз. → Склад Thermo");
      }} />}
      {opForm && opForm.type !== "return" && <OpForm obj={obj} type={opForm.type} suppliers={suppliers} onClose={() => setOpForm(null)}
        onSave={async (op) => {
          if (op.type === "bonus") op.master_id = obj.master_id || null;
          await db.from("finance_ops").insert(cleanUuids(op)); await logAction(opLabel(op.type), "object:" + obj.name, fmt(op.amount) + (op.note ? " · " + op.note : "")); setOpForm(null); await reload(); toast("Операция добавлена");
        }} />}
    </div>
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
        <Fld label="Поставщик"><select className="inp" value={v.supplier_id || ""} onChange={set("supplier_id")}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>
      </div>
      <p className="xs mut" style={{ marginTop: 8 }}>Сумма позиции: {fmt(v.qty * v.price)}{fin ? " · прибыль: " + fmt(v.qty * (v.price - v.cost)) : ""}</p>
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
      price: map.price != null ? num(cell(row, "price")) : (prod ? prod.price : 0),
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

  return (
    <Modal title="Импорт позиций на объект из Excel" onClose={onClose} w={900}>
      {err && <div className="card sect" style={{ borderColor: "var(--bad)", color: "var(--bad)", padding: 10 }}>{err}</div>}
      {!rows && (
        <div>
          <div className="card clk" style={{ borderStyle: "dashed", textAlign: "center", padding: 34 }} onClick={() => fRef.current.click()}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>📊</div>
            <div style={{ fontWeight: 800 }}>Выбрать файл Excel (.xlsx / .xls / .csv)</div>
            <div className="xs mut" style={{ marginTop: 4 }}>Список материалов по объекту. Совпавшие по названию товары подтянут цены из базы; цена/себестоимость из файла, если есть, имеют приоритет.</div>
          </div>
          <input ref={fRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={onFile} />
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
            <button className="btn pri" disabled={map.name == null || !preview.length} onClick={run}>Добавить {preview.length} поз. на объект →</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
function AddItemsModal({ products, suppliers, onClose, onSave }) {
  const [rows, setRows] = useState([]);
  const addRow = (r) => setRows([...rows, r]);
  const blank = () => addRow({ product_id: null, name: "", size: "", unit: "шт", qty: 1, cost: 0, price: 0, supplier_id: "" });
  const upd = (i, k, val) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  const del = (i) => setRows(rows.filter((_, j) => j !== i));
  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);
  return (
    <Modal title="Добавить позиции вручную" onClose={onClose} w={860}>
      <div className="row" style={{ marginBottom: 10 }}>
        <ProductPicker products={products} placeholder="найти товар в базе и добавить строку…" onPick={(p) => addRow({ product_id: p.id, name: p.name, size: p.size, unit: p.unit, qty: 1, cost: p.cost, price: p.price, supplier_id: p.supplier_id })} />
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
                <td><select className="inp" value={r.supplier_id || ""} onChange={(e) => upd(i, "supplier_id", e.target.value)}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
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
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn pri" disabled={!rows.filter((r) => r.name).length} onClick={() => onSave(rows.filter((r) => r.name))}>Добавить в объект (новая поставка)</button>
        </div>
      </div>
    </Modal>
  );
}
function EditOpModal({ op, suppliers, isReturn, onClose, onSave }) {
  const [v, setV] = useState({
    amount: op.amount || 0, op_date: (op.op_date || op.created_at || "").slice(0, 10),
    note: op.note || "", reason: op.reason || "", supplier_id: op.supplier_id || "", item_name: op.item_name || "", user: op.user || "",
  });
  return (
    <Modal title={"Редактировать: " + opLabel(op.type)} onClose={onClose} w={520}>
      {isReturn && <p className="sm" style={{ color: "var(--warn)", marginBottom: 10 }}>⚠ У возврата можно изменить только дату, причину и комментарий. Количество/сумму меняйте через сторно и новый возврат — иначе разойдётся склад.</p>}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {!isReturn && <Fld label="Сумма"><input type="number" className="inp" value={v.amount} onChange={(e) => setV({ ...v, amount: Number(e.target.value) || 0 })} /></Fld>}
        <Fld label="Дата операции"><input type="date" className="inp" value={v.op_date} onChange={(e) => setV({ ...v, op_date: e.target.value })} /></Fld>
        {op.type === "supplier_payment" && <Fld label="Поставщик"><select className="inp" value={v.supplier_id} onChange={(e) => setV({ ...v, supplier_id: e.target.value })}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>}
        {op.type === "bonus" && <Fld label="Предмет"><input className="inp" value={v.item_name} onChange={(e) => setV({ ...v, item_name: e.target.value })} /></Fld>}
        {(isReturn || op.reason != null) && <Fld label="Причина"><input className="inp" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Fld>}
        <Fld label="Комментарий"><input className="inp" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Fld>
        <Fld label="Ответственный"><input className="inp" value={v.user} onChange={(e) => setV({ ...v, user: e.target.value })} /></Fld>
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
          onSave(patch);
        }}>Сохранить</button>
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
  const [user, setUser] = useState(obj.manager || "manager");
  const setRet = (idx, val) => setRows(rows.map((r, j) => (j === idx ? { ...r, ret: Math.max(0, Math.min(Number(val) || 0, r.avail)) } : r)));
  const totalSum = rows.reduce((a, r) => a + r.ret * (r.item.price || 0), 0);
  const totalCnt = rows.filter((r) => r.ret > 0).length;
  const batch = uuid();
  const submit = () => {
    const list = rows.filter((r) => r.ret > 0).map((r) => ({
      object_id: obj.id, type: "return", batch_id: batch,
      item_id: r.item.id, product_id: r.item.product_id, product_name: r.item.name,
      unit: r.item.unit, size: r.item.size,
      qty: r.ret, amount: r.ret * (r.item.price || 0), cost_amount: r.ret * (r.item.cost || 0),
      supplier_id: r.item.supplier_id || null, reason, op_date: opDate || today(), user,
    }));
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
      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
        <Fld label="Причина (общая)"><input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="брак / не подошло / излишек" /></Fld>
        <Fld label="Дата возврата"><input type="date" className="inp" value={opDate} onChange={(e) => setOpDate(e.target.value)} /></Fld>
        <Fld label="Ответственный"><input className="inp" value={user} onChange={(e) => setUser(e.target.value)} /></Fld>
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
  const [v, setV] = useState({ amount: 0, note: "", reason: "", supplier_id: "", item_id: items[0] ? items[0].id : "", qty: 1, item_name: "", op_date: today(), user: obj.manager || "manager" });
  const isReturn = type === "return";
  const isSupPay = type === "supplier_payment";
  const isBonus = type === "bonus";
  const item = items.find((i) => i.id === v.item_id);
  const retAmount = item ? v.qty * item.price : 0;
  const submit = () => {
    const base = { object_id: obj.id, type, note: v.note, reason: v.reason, user: v.user, op_date: v.op_date || today() };
    if (isReturn && item) {
      onSave({ ...base, amount: retAmount, cost_amount: v.qty * item.cost, qty: v.qty, product_id: item.product_id, product_name: item.name, supplier_id: item.supplier_id });
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
            <Fld label="Сумма"><input type="number" className="inp" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Fld>
            {isSupPay && <Fld label="Поставщик"><select className="inp" value={v.supplier_id} onChange={(e) => setV({ ...v, supplier_id: e.target.value })}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>}
            {isBonus && <Fld label="Предмет (если бонус вещью)"><input className="inp" value={v.item_name} onChange={(e) => setV({ ...v, item_name: e.target.value })} placeholder="инструмент / предмет — опц." /></Fld>}
            <div style={{ gridColumn: "1/-1" }}><Fld label="Комментарий"><input className="inp" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Fld></div>
          </>
        )}
        <Fld label="Дата операции"><input type="date" className="inp" value={v.op_date} onChange={(e) => setV({ ...v, op_date: e.target.value })} /></Fld>
        <Fld label="Ответственный"><input className="inp" value={v.user} onChange={(e) => setV({ ...v, user: e.target.value })} /></Fld>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" onClick={submit} disabled={isReturn ? !item || !v.qty : !Number(v.amount)}>Сохранить</button>
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
                <td className="num" style={{ color: f.clientDebt > 0 ? "var(--bad)" : "var(--mut)" }}>{fmt(f.clientDebt)}</td>
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
                <td className="xs mut">{[o.item_name, o.note].filter(Boolean).join(" · ")}</td>
              </tr>
            ))}
            {!payOps.length && <tr><td colSpan={5} className="mut" style={{ textAlign: "center", padding: 20 }}>Операций нет</td></tr>}
          </tbody>
        </table>
      </div>}
      {fin && payForm && (
        <Modal title={"Выплата бонуса — " + m.name} onClose={() => setPayForm(false)} w={460}>
          <BonusPayForm debt={st.debtToMaster} onSave={async (amount, note, opDate) => {
            await db.from("finance_ops").insert({ type: "bonus_payment", master_id: m.id, object_id: null, amount, note, op_date: opDate || today(), user: "fin" });
            setPayForm(false); await reload(); toast("Выплата записана");
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
  const [amount, setAmount] = useState(debt || 0);
  const [note, setNote] = useState("");
  const [opDate, setOpDate] = useState(today());
  return (
    <div>
      <div className="sm mut" style={{ marginBottom: 10 }}>Текущий долг мастеру: <b className="mono" style={{ color: "var(--warn)" }}>{fmt(debt)}</b></div>
      <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <Fld label="Сумма выплаты"><input type="number" className="inp" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} /></Fld>
        <Fld label="Дата выплаты"><input type="date" className="inp" value={opDate} onChange={(e) => setOpDate(e.target.value)} /></Fld>
        <Fld label="Комментарий"><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="наличные / карта / за объект…" /></Fld>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button className="btn pri" disabled={!amount} onClick={() => onSave(amount, note, opDate)}>Выплатить</button>
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
  const { warehouse, wh_moves, objects } = data;
  const [issue, setIssue] = useState(false);
  const stock = warehouse.filter((w) => (w.qty || 0) > 0);
  const totalCost = stock.reduce((a, w) => a + w.qty * (w.cost || 0), 0);
  const totalSale = stock.reduce((a, w) => a + w.qty * (w.price || 0), 0);
  const KPI = ({ l, v, c }) => <div className="kpi"><div className="l">{l}</div><div className="v" style={{ color: c }}>{fmt(v)}</div></div>;
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
          <thead><tr><th>Товар</th><th>Размер</th><th style={{textAlign:"right"}}>Кол-во</th><th>Ед.</th><th style={{textAlign:"right"}}>Закуп</th><th style={{textAlign:"right"}}>Продажа</th><th style={{textAlign:"right"}}>Сумма (закуп)</th></tr></thead>
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
              </tr>
            ))}
            {!stock.length && <tr><td colSpan={7} className="mut" style={{ textAlign: "center", padding: 26 }}>Склад пуст — товары появляются автоматически при возвратах с объектов</td></tr>}
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
    </div>
  );
}
function IssueForm({ stock, objects, onClose, onSave }) {
  const targets = objects.filter((o) => !["closed", "cancelled"].includes(o.status));
  const [objId, setObjId] = useState(targets[0] ? targets[0].id : "");
  const [user, setUser] = useState("manager");
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
        <Fld label="Ответственный"><input className="inp" value={user} onChange={(e) => setUser(e.target.value)} /></Fld>
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
function Dashboard({ data }) {
  const { objects, finance_ops, products, suppliers } = data;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mgr, setMgr] = useState("");
  const inRange = (s) => {
    const d = (s || "").slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  const objs = objects.filter((o) =>
    o.status !== "cancelled" &&
    inRange(o.created_at) &&
    (!mgr || o.manager === mgr)
  );
  const tot = { sale: 0, gross: 0, net: 0, cdebt: 0 };
  const byMgr = {}, byMaster = {}, byProd = {};
  objs.forEach((o) => {
    const f = calcObject(o, finance_ops);
    tot.sale += f.saleNet; tot.gross += f.gross; tot.net += f.net; tot.cdebt += f.clientDebt;
    const m = o.manager || "—", ms = o.master || "—";
    byMgr[m] = (byMgr[m] || { sale: 0, net: 0, n: 0 }); byMgr[m].sale += f.saleNet; byMgr[m].net += f.net; byMgr[m].n++;
    byMaster[ms] = (byMaster[ms] || { sale: 0, n: 0 }); byMaster[ms].sale += f.saleNet; byMaster[ms].n++;
    (o.items || []).forEach((i) => {
      byProd[i.name] = byProd[i.name] || { qty: 0, sale: 0, margin: 0 };
      byProd[i.name].qty += i.qty; byProd[i.name].sale += i.qty * i.price;
      byProd[i.name].margin += i.qty * (i.price - i.cost);
    });
  });
  const sdebt = suppliers.reduce((a, s) => a + supplierStats(s, objs, finance_ops).debt, 0);
  const companyExp = finance_ops.filter((o) => o.type === "company_expense" && !o.voided && inRange(o.op_date || o.created_at)).reduce((a, o) => a + (o.amount || 0), 0);
  const topProd = Object.entries(byProd).sort((a, b) => b[1].sale - a[1].sale).slice(0, 7);
  const lowMargin = Object.entries(byProd).filter(([, v]) => v.sale > 0).sort((a, b) => (a[1].margin / a[1].sale) - (b[1].margin / b[1].sale)).slice(0, 5);
  const managers = [...new Set(objects.map((o) => o.manager).filter(Boolean))];
  const objByProfit = objs.map((o) => ({ o, f: calcObject(o, finance_ops) })).sort((a, b) => b.f.net - a.f.net).slice(0, 7);
  const KPI = ({ l, v, c, suf }) => <div className="kpi"><div className="l">{l}</div><div className="v" style={{ color: c }}>{fmt(v)}{suf || ""}</div></div>;
  return (
    <div>
      <div className="row sect">
        <h2 style={{ marginRight: "auto" }}>Дашборд руководителя</h2>
        <select className="inp" style={{ maxWidth: 180 }} value={mgr} onChange={(e) => setMgr(e.target.value)}>
          <option value="">Все менеджеры</option>{managers.map((m) => <option key={m}>{m}</option>)}
        </select>
      </div>
      <div className="row sect" style={{ gap: 8, padding: "8px 10px", background: "var(--panel2)", borderRadius: 8 }}>
        <span className="sm" style={{ fontWeight: 700 }}>Период:</span>
        <Fld label="С даты"><input type="date" className="inp" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} /></Fld>
        <Fld label="По дату"><input type="date" className="inp" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} /></Fld>
        <div style={{ display: "flex", gap: 4, alignSelf: "flex-end", flexWrap: "wrap" }}>
          <button className="btn xs" onClick={() => { const d = new Date(); setFrom(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10)); setTo(today()); }}>Этот месяц</button>
          <button className="btn xs" onClick={() => { setFrom(new Date(Date.now() - 7 * 86400000).toISOString().slice(0,10)); setTo(today()); }}>7 дней</button>
          <button className="btn xs" onClick={() => { setFrom(new Date(Date.now() - 30 * 86400000).toISOString().slice(0,10)); setTo(today()); }}>30 дней</button>
          <button className="btn xs" onClick={() => { setFrom(""); setTo(""); }}>Весь период</button>
        </div>
      </div>
      <div className="kpis sect">
        <KPI l="Выручка" v={tot.sale} />
        <KPI l="Валовая прибыль" v={tot.gross} c="#fff" />
        <KPI l="Прибыль по объектам" v={tot.net} c={tot.net >= 0 ? "var(--ok)" : "var(--bad)"} />
        <KPI l="Расходы компании" v={companyExp} c={companyExp > 0 ? "var(--bad)" : "var(--mut)"} />
        <KPI l="Чистая прибыль (итог)" v={tot.net - companyExp} c={(tot.net - companyExp) >= 0 ? "var(--ok)" : "var(--bad)"} />
        <KPI l="Маржа" v={tot.sale ? (tot.gross / tot.sale) * 100 : 0} suf="%" />
        <KPI l="Долги клиентов" v={tot.cdebt} c={tot.cdebt > 0 ? "var(--bad)" : "var(--mut)"} />
        <KPI l="Долги поставщикам" v={sdebt} c={sdebt > 0 ? "var(--warn)" : "var(--mut)"} />
        <KPI l="Объектов" v={objs.length} />
      </div>
      <div className="split sect">
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Продажи по менеджерам</h3>
          <table className="t"><thead><tr><th>Менеджер</th><th style={{textAlign:"right"}}>Объектов</th><th style={{textAlign:"right"}}>Выручка</th><th style={{textAlign:"right"}}>Прибыль</th></tr></thead>
            <tbody>{Object.entries(byMgr).sort((a,b)=>b[1].sale-a[1].sale).map(([m, v]) => <tr key={m}><td>{m}</td><td className="num">{v.n}</td><td className="num">{fmt(v.sale)}</td><td className="num" style={{color:"var(--ok)"}}>{fmt(v.net)}</td></tr>)}
            {!Object.keys(byMgr).length && <tr><td colSpan={4} className="mut sm" style={{padding:14}}>Нет данных</td></tr>}</tbody></table>
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Продажи по мастерам</h3>
          <table className="t"><thead><tr><th>Мастер</th><th style={{textAlign:"right"}}>Объектов</th><th style={{textAlign:"right"}}>Выручка</th></tr></thead>
            <tbody>{Object.entries(byMaster).sort((a,b)=>b[1].sale-a[1].sale).map(([m, v]) => <tr key={m}><td>{m}</td><td className="num">{v.n}</td><td className="num">{fmt(v.sale)}</td></tr>)}
            {!Object.keys(byMaster).length && <tr><td colSpan={3} className="mut sm" style={{padding:14}}>Нет данных</td></tr>}</tbody></table>
        </div>
      </div>
      <div className="split sect">
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Топ товары по выручке</h3>
          <table className="t"><tbody>{topProd.map(([n, v]) => <tr key={n}><td className="sm">{n}</td><td className="num">{v.qty} ед</td><td className="num">{fmt(v.sale)}</td></tr>)}
          {!topProd.length && <tr><td className="mut sm" style={{padding:14}}>Нет данных</td></tr>}</tbody></table>
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Объекты по прибыли</h3>
          <table className="t"><tbody>{objByProfit.map(({ o, f }) => <tr key={o.id}><td className="sm">{o.name}</td><td><Badge c={stById(o.status).c}>{stById(o.status).label}</Badge></td><td className="num" style={{color:f.net>=0?"var(--ok)":"var(--bad)"}}>{fmt(f.net)}</td></tr>)}
          {!objByProfit.length && <tr><td className="mut sm" style={{padding:14}}>Нет данных</td></tr>}</tbody></table>
        </div>
      </div>
      {lowMargin.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>⚠ Товары с низкой маржей</h3>
          <table className="t"><tbody>{lowMargin.map(([n, v]) => <tr key={n}><td className="sm">{n}</td><td className="num">{((v.margin / v.sale) * 100).toFixed(1)}%</td><td className="num">{fmt(v.margin)}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

/* ============ FINANCE TAB ============ */
function CompanyExpenseForm({ onClose, onSave }) {
  const [v, setV] = useState({ category: "Зарплата", amount: 0, op_date: today(), note: "", user: CURRENT_USER ? (CURRENT_USER.name || CURRENT_USER.username) : "" });
  return (
    <Modal title="Расход компании" onClose={onClose} w={520}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Fld label="Категория"><select className="inp" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Fld>
        <Fld label="Сумма"><input type="number" className="inp" value={v.amount} onChange={(e) => setV({ ...v, amount: Number(e.target.value) || 0 })} /></Fld>
        <Fld label="Дата"><input type="date" className="inp" value={v.op_date} onChange={(e) => setV({ ...v, op_date: e.target.value })} /></Fld>
        <Fld label="Кто внёс"><input className="inp" value={v.user} onChange={(e) => setV({ ...v, user: e.target.value })} /></Fld>
        <div style={{ gridColumn: "1/-1" }}><Fld label="Комментарий"><input className="inp" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="за июнь / Шерзоду / свет+вода…" /></Fld></div>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn pri" disabled={!v.amount} onClick={() => onSave({ type: "company_expense", object_id: null, category: v.category, amount: v.amount, op_date: v.op_date || today(), note: v.note, user: v.user })}>Сохранить</button>
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
      <div className="row sect">
        <h3 style={{ marginRight: "auto" }}>Расходы компании <span className="mut sm">(зарплата, аренда, коммунальные, обед и т.д.)</span></h3>
        <button className="btn pri" onClick={() => setExpForm(true)}>+ Добавить расход</button>
      </div>
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
      <div className="kpis sect">
        <div className="kpi"><div className="l">Всего расходов{(from || to) ? " за период" : ""}</div><div className="v" style={{ color: "var(--bad)" }}>{fmt(totalExp)}</div></div>
        {EXPENSE_CATEGORIES.filter((c) => byCat[c]).slice(0, 5).map((c) => (
          <div key={c} className="kpi"><div className="l">{c}</div><div className="v">{fmt(byCat[c])}</div></div>
        ))}
      </div>
      <div className="card sect" style={{ padding: 0, overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>Дата</th><th>Категория</th><th style={{textAlign:"right"}}>Сумма</th><th>Комментарий</th><th>Кто</th><th></th></tr></thead>
          <tbody>
            {genExpenses.slice().reverse().map((o) => (
              <tr key={o.id}>
                <td className="xs mono mut">{dt(o.op_date || o.created_at)}</td>
                <td className="sm" style={{ fontWeight: 600 }}>{o.category || "Прочее"}</td>
                <td className="num" style={{ fontWeight: 700, color: "var(--bad)" }}>{fmt(o.amount)}</td>
                <td className="xs mut">{o.note}</td>
                <td className="xs mut">{o.user}</td>
                <td><button className="btn xs dng" onClick={async () => { await db.from("finance_ops").update({ voided: true }).eq("id", o.id); await logAction("Сторно расхода", "company:" + (o.category || ""), fmt(o.amount)); await reload(); toast("Расход сторнирован"); }}>сторно</button></td>
              </tr>
            ))}
            {!genExpenses.length && <tr><td colSpan={6} className="mut" style={{ textAlign: "center", padding: 22 }}>Расходов нет — добавьте через «+ Добавить расход»</td></tr>}
          </tbody>
        </table>
      </div>
      {expForm && <CompanyExpenseForm onClose={() => setExpForm(false)} onSave={async (op) => {
        await db.from("finance_ops").insert(cleanUuids(op));
        await logAction("Расход компании: " + op.category, "company", fmt(op.amount) + (op.note ? " · " + op.note : ""));
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
            <tbody>{suppliers.map((s) => { const st = supplierStats(s, objects, finance_ops); return <tr key={s.id}><td>{s.name}<div className="xs mut">{s.terms}</div></td><td className="num">{fmt(st.purchases)}</td><td className="num">{fmt(st.paid)}</td><td className="num" style={{color:st.debt>0?"var(--bad)":"var(--mut)",fontWeight:700}}>{fmt(st.debt)}</td></tr>; })}</tbody></table>
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
                <td className="xs mut">{[supName(o.supplier_id), o.product_name, o.item_name, o.reason, o.note].filter(Boolean).join(" · ")}</td>
                <td className="xs mut">{o.user}</td>
              </tr>
            ))}
            {!finance_ops.length && <tr><td colSpan={6} className="mut" style={{ textAlign: "center", padding: 22 }}>Операций нет</td></tr>}
          </tbody>
        </table>
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

  const toast = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3500); };
  const reload = async () => {
    const out = {};
    for (const t of TABLES) {
      const { data: d } = await db.from(t).select().order("created_at", { ascending: true });
      out[t] = d;
    }
    setData(out);
  };
  const [bootErr, setBootErr] = useState("");
  const restoreRef = useRef(null);
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
  const [backupOpen, setBackupOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const onRestore = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { await importBackup(f); await reload(); toast("База восстановлена из бэкапа"); setBootErr(""); }
    catch (err) { toast("Ошибка: " + err.message); }
    e.target.value = "";
  };

  const roleTabs = (ROLES.find((r) => r.id === role) || ROLES[0]).tabs;
  const TAB_LABELS = { request: "Новая заявка", dash: "Дашборд", objects: "Объекты", products: "Товары", wh: "Склад Thermo", suppliers: "Поставщики", masters: "Мастера", finance: "Финансы", log: "Журнал", admin: "Аккаунты" };
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
    <div className="te">
      <style>{CSS}</style>
      <div className="hdr">
        <div className="logo">THERMO<span>•</span>ENGINEERING<small>AI procurement & finance OS</small></div>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{currentUser.name || currentUser.username}</div>
            <div className="xs mut">{role === "boss" ? "Руководитель" : "Менеджер"}</div>
          </div>
          <button className="btn xs" onClick={doLogout} title="Выйти">Выйти</button>
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
        {tab === "request" && <RequestWizard data={data} reload={reload} toast={toast} openObject={(id) => { setOpenId(id); setTab("objects"); }} />}
        {tab === "products" && <ProductsTab data={data} reload={reload} toast={toast} />}
        {tab === "suppliers" && <SuppliersTab data={data} reload={reload} toast={toast} fin={role === "boss"} />}
        {tab === "masters" && <MastersTab data={data} reload={reload} toast={toast} fin={role === "boss"} openObject={(id) => { setOpenId(id); setTab("objects"); }} />}
        {tab === "wh" && <WarehouseTab data={data} reload={reload} toast={toast} openObject={(id) => { setOpenId(id); setTab("objects"); }} />}
        {tab === "log" && <LogTab data={data} />}
        {tab === "admin" && <AdminTab data={data} reload={reload} toast={toast} currentUser={currentUser} />}
        {tab === "finance" && <FinanceTab data={data} reload={reload} toast={toast} />}
      </div>
      {backupOpen && <BackupModal data={data} onClose={() => setBackupOpen(false)} toast={toast} onFilePick={() => restoreRef.current.click()} onRestoreText={async (text) => {
        const dump = JSON.parse(text);
        await restoreFromSupabase(dump); await reload(); setBackupOpen(false); toast("База восстановлена");
      }} />}
      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
function BackupModal({ data, onClose, toast, onFilePick, onRestoreText }) {
  const [json] = useState(() => {
    const dump = { _app: "ThermoAI", _date: new Date().toISOString(), tables: {} };
    TABLES.forEach((t) => { dump.tables[t] = data[t] || []; });
    return JSON.stringify(dump);
  });
  const [restoreTxt, setRestoreTxt] = useState("");
  const [err, setErr] = useState("");
  const taRef = useRef(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); toast("Скопировано в буфер"); return; } catch (e) {}
    try { taRef.current.select(); document.execCommand("copy"); toast("Скопировано в буфер"); } catch (e) { toast("Выделите текст и скопируйте вручную"); }
  };
  return (
    <Modal title="Бэкап и восстановление базы" onClose={onClose} w={680}>
      <h3 style={{ marginBottom: 6 }}>Сохранить</h3>
      <p className="xs mut" style={{ marginBottom: 8 }}>Скопируйте текст бэкапа и сохраните в заметки/файл, или попробуйте скачать файлом.</p>
      <textarea ref={taRef} readOnly className="inp" style={{ minHeight: 110, fontSize: 10 }} value={json} onFocus={(e) => e.target.select()} />
      <div className="row" style={{ marginTop: 8, marginBottom: 18 }}>
        <button className="btn pri" onClick={copy}>📋 Копировать бэкап</button>
        <button className="btn" onClick={() => { tryDownloadBackup(json) ? toast("Файл скачан") : toast("Скачивание заблокировано — используйте «Копировать»"); }}>⬇ Скачать файлом</button>
        <span className="xs mut">{Math.round(json.length / 1024)} КБ</span>
      </div>
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
    </Modal>
  );
}

export default function App() {
  return <ErrBoundary><AppInner /></ErrBoundary>;
}
