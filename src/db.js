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
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
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
