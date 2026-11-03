// Sinov rejimi: https://thermo-ai-os.vercel.app/?sinov=1 — сайт работает с отдельной СИНОВ-базой (Supabase «thermo-sinov»),
// ничего в рабочей базе не меняется; ?sinov=0 или кнопка «Chiqish» — обратно в рабочую базу.
// Всё, что сайт хранит в браузере (вход, черновики, настройки), в синов-режиме лежит отдельно (префикс «sinov:»).
const KEY = "te:sinov";
let on = false;
try {
  const q = new URLSearchParams(location.search), s = q.get("sinov");
  if (s === "1") localStorage.setItem(KEY, "1");
  if (s === "0") localStorage.removeItem(KEY);
  on = localStorage.getItem(KEY) === "1";
  if (s != null) { q.delete("sinov"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }
} catch (e) { on = false; }
export const TEST = on;
// синов-база: адрес и публичный ключ (публичный — как у рабочей базы, он и так виден в коде сайта; данные закрыты входом)
export const TEST_DB = { url: "https://hwkawvwlqpntomdmwbwk.supabase.co", anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3a2F3dndscXBudG9tZG13YndrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2OTA3NTEsImV4cCI6MjEwOTI2Njc1MX0.4siLCxVLqQMng3V2O1uLpt7O57mkrZmCyVyY3IMEElU" };
if (TEST) {
  const P = "sinov:", S = Storage.prototype, g = S.getItem, st = S.setItem, rm = S.removeItem;
  S.getItem = function (k) { return k === KEY ? g.call(this, k) : g.call(this, P + k); };
  S.setItem = function (k, v) { return k === KEY ? st.call(this, k, v) : st.call(this, P + k, v); };
  S.removeItem = function (k) { return k === KEY ? rm.call(this, k) : rm.call(this, P + k); };
  try { document.title = "🧪 SINOV · " + document.title; } catch (e) {}
  const pill = () => {
    if (document.getElementById("te-sinov")) return;
    const d = document.createElement("div");
    d.id = "te-sinov";
    d.setAttribute("style", "position:fixed;left:12px;bottom:12px;z-index:99999;background:#ff1f30;color:#fff;font:700 13px/1 system-ui,sans-serif;padding:9px 12px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;gap:10px;align-items:center");
    d.innerHTML = "🧪 SINOV REJIMI — haqiqiy tizimga ta'sir qilmaydi <a href='?sinov=0' style='color:#fff;background:rgba(0,0,0,.25);padding:4px 9px;border-radius:999px;text-decoration:none'>Chiqish</a>";
    document.body.appendChild(d);
  };
  if (document.body) pill(); else document.addEventListener("DOMContentLoaded", pill);
}
