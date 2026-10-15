// ============================================================
// db.js — облачный адаптер вместо локального хранилища
// Сохраняет тот же интерфейс, что в прототипе:
//   await db.from('products').select().eq('status','active').order('created_at')
//   await db.from('objects').insert({...})  // вернёт вставленную строку
//   await db.from('finance_ops').update({...}).eq('id', id)
//   await db.from('masters').delete().eq('id', id)
// Поэтому код компонентов менять НЕ нужно.
// ============================================================
import { createClient } from "@supabase/supabase-js";

// .env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// Сессия входа (когда в базе включена защита): токен уходит с каждым запросом в заголовке x-te-session.
// Ответ «te_session_required» (сессия истекла / аккаунт отключён) — событие te-session-lost, программа просит войти снова.
let TE_SESSION = null;
export const setSession = (t) => { TE_SESSION = t || null; };
export const getSession = () => TE_SESSION;
const teFetch = (input, init = {}) => {
  let opts = init;
  if (TE_SESSION) {
    const h = new Headers(init.headers || (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined));
    h.set("x-te-session", TE_SESSION);
    opts = { ...init, headers: h };
  }
  return fetch(input, opts).then((res) => {
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      res.clone().json().then((j) => {
        if (j && /te_session_required/.test(String(j.message || ""))) { try { window.dispatchEvent(new Event("te-session-lost")); } catch (e) {} }
      }).catch(() => {});
    }
    return res;
  });
};
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { global: { fetch: teFetch } }
);

class Query {
  constructor(table) { this.table = table; this.op = "select"; this.rows = null; this.patch = null; this.filters = []; this.ord = null; }
  select() { this.op = "select"; return this; }
  insert(rows) { this.op = "insert"; this.rows = rows; return this; }
  update(patch) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(k, v) { this.filters.push(["eq", k, v]); return this; }
  neq(k, v) { this.filters.push(["neq", k, v]); return this; }
  ilike(k, v) { this.filters.push(["ilike", k, "%" + String(v).replace(/%/g, "") + "%"]); return this; }
  order(k, o) { this.ord = [k, !o || o.ascending !== false]; return this; }

  _apply(q) {
    for (const [fn, k, v] of this.filters) q = q[fn](k, v);
    if (this.ord) q = q.order(this.ord[0], { ascending: this.ord[1] });
    return q;
  }
  async _exec() {
    let q;
    if (this.op === "select") {
      q = this._apply(supabase.from(this.table).select("*"));
    } else if (this.op === "insert") {
      q = supabase.from(this.table).insert(this.rows).select();
    } else if (this.op === "update") {
      q = this._apply(supabase.from(this.table).update(this.patch)).select();
    } else if (this.op === "delete") {
      q = this._apply(supabase.from(this.table).delete());
    }
    const { data, error } = await q;
    if (error) console.error("[db]", this.table, error.message);
    return { data: data || [], error };
  }
  then(res, rej) { return this._exec().then(res, rej); }
}

export const db = { from: (t) => new Query(t) };
export { supabase };
