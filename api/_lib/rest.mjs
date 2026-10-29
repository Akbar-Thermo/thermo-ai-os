// Доступ бота к базе — так же, как у программы: через REST Supabase (адрес и публичный ключ сайта).
// Если в базе включена защита входа, бот входит своим аккаунтом программы (TG_BOT_LOGIN / TG_BOT_PASSWORD):
// все правила базы действуют и для него («кто» в операциях и журнале — этот аккаунт).
import { createHash } from "node:crypto";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export function makeRest({ url, anon, login, password, fetchImpl = globalThis.fetch }) {
  // нечаянный пробел / перевод строки при вставке логина и пароля в настройки — не мешает входу
  login = String(login || "").trim(); password = String(password || "").replace(/^[\s\u00a0\u200b\ufeff]+|[\s\u00a0\u200b\ufeff]+$/g, "");
  const base = String(url || "").replace(/\/+$/, "") + "/rest/v1/";
  let token = null;
  let secure = null;
  const missing = {}; // колонки, которых нет в базе (как в программе: запись повторяется без них)
  const headers = (extra) => ({ apikey: anon, Authorization: "Bearer " + anon, "Content-Type": "application/json", ...(token ? { "x-te-session": token } : {}), ...(extra || {}) });
  async function raw(method, path, body, extra) {
    const r = await fetchImpl(base + path, { method, headers: headers(extra), body: body == null ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    return { ok: r.ok, status: r.status, data, text, headers: r.headers };
  }
  async function ensure() {
    if (!url || !anon) throw new Error("NO_DB: нет адреса базы (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)");
    if (secure === null) {
      const s = await raw("POST", "rpc/te_status", {});
      secure = !!(s.ok && s.data && s.data.secure);
    }
    if (secure && !token) {
      if (!login || !password) throw new Error("NO_ACCOUNT: в базе включена защита входа — нужен аккаунт бота (TG_BOT_LOGIN / TG_BOT_PASSWORD)");
      const r = await raw("POST", "rpc/te_login", { p_username: login, p_hash: sha256("thermo:" + password) });
      if (!r.ok || !r.data || r.data.error || !r.data.token) throw new Error("LOGIN: бот не смог войти в программу (" + ((r.data && r.data.error) || r.status) + ") — проверьте TG_BOT_LOGIN / TG_BOT_PASSWORD и что аккаунт активен");
      token = r.data.token;
    }
  }
  async function call(method, path, body, extra) {
    await ensure();
    let r = await raw(method, path, body, extra);
    if (!r.ok && /te_session_required/.test(r.text) && secure) { token = null; await ensure(); r = await raw(method, path, body, extra); }
    return r;
  }
  const fail = (what, r) => { const e = new Error(what + ": " + ((r.data && (r.data.message || r.data.hint)) || r.text || r.status)); e.status = r.status; e.body = r.data; return e; };
  // все строки таблицы — страницами по 1000 (больше REST за раз не отдаёт)
  async function all(table, query = "") {
    let out = [];
    for (let from = 0; from < 2000000; from += 1000) {
      const q = table + "?select=*" + (query ? "&" + query : "") + "&order=created_at.asc,id.asc&offset=" + from + "&limit=1000";
      let r = await call("GET", q);
      if (!r.ok && r.status === 400 && /created_at/.test(r.text)) r = await call("GET", table + "?select=*" + (query ? "&" + query : "") + "&order=id.asc&offset=" + from + "&limit=1000");
      if (!r.ok) throw fail(table, r);
      out = out.concat(r.data || []);
      if (!r.data || r.data.length < 1000) break;
    }
    return out;
  }
  async function select(table, query) {
    const r = await call("GET", table + "?" + query);
    if (!r.ok) throw fail(table, r);
    return r.data || [];
  }
  const strip = (table, row) => { const m = missing[table]; if (!m) return row; const o = { ...row }; m.forEach((c) => delete o[c]); return o; };
  async function insert(table, row) {
    for (let k = 0; k < 15; k++) {
      const r = await call("POST", table, Array.isArray(row) ? row.map((x) => strip(table, x)) : strip(table, row), { Prefer: "return=representation" });
      const mm = !r.ok && /Could not find the '([^']+)' column/i.exec(r.text);
      if (mm) { (missing[table] = missing[table] || new Set()).add(mm[1]); continue; }
      if (!r.ok) throw fail(table, r);
      return r.data || [];
    }
    throw new Error(table + ": слишком много отсутствующих колонок");
  }
  async function update(table, filter, patch) {
    for (let k = 0; k < 15; k++) {
      const r = await call("PATCH", table + "?" + filter, strip(table, patch), { Prefer: "return=representation" });
      const mm = !r.ok && /Could not find the '([^']+)' column/i.exec(r.text);
      if (mm) { (missing[table] = missing[table] || new Set()).add(mm[1]); continue; }
      if (!r.ok) throw fail(table, r);
      return r.data || [];
    }
    throw new Error(table + ": слишком много отсутствующих колонок");
  }
  async function del(table, filter) {
    const r = await call("DELETE", table + "?" + filter, null, { Prefer: "return=representation" });
    if (!r.ok) throw fail(table, r);
    return r.data || [];
  }
  return { all, select, insert, update, del, isSecure: () => secure };
}
