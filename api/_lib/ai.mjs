// ИИ для Telegram-бота: Claude (Anthropic API). Ключ — секрет функций Supabase ANTHROPIC_API_KEY
// (тот же, что у ai-proxy), модель — TG_AI_MODEL или Claude Haiku 5.5 (самая дешёвая).
// Нет ключа — makeAI возвращает null, бот работает как раньше (команды «/»).
// Повторяющееся начало запроса (инструкции, список функций, история диалога) кэшируется — дешевле в 2–3 раза.
export const AI_MODEL = "claude-haiku-5-5";
const API = "https://api.anthropic.com/v1/messages";
// цена за 1 млн токенов, $ (вход / выход / запись в кэш / чтение из кэша)
export const PRICES = { "claude-haiku-5-5": { in: 0.10, out: 0.50, cw: 0.125, cr: 0.01 }, "claude-sonnet-5-5": { in: 2, out: 10, cw: 2.5, cr: 0.2 }, "claude-opus-5-5": { in: 4, out: 20, cw: 5, cr: 0.4 } };
export function aiCost(model, u) {
  const p = PRICES[model] || PRICES["claude-opus-5-5"]; // неизвестная модель — считаем по дорогой, чтобы лимит не превысить
  if (!u) return 0;
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + (u.cache_creation_input_tokens || 0) * p.cw + (u.cache_read_input_tokens || 0) * p.cr) / 1e6;
}
const EPH = { type: "ephemeral" };
// метка кэша — только на последнем блоке последнего сообщения (остальные сообщения — без меток)
function withCache(messages) {
  return messages.map((m, i) => {
    const last = i === messages.length - 1;
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content.map((b) => { const { cache_control, ...r } = b; return r; });
    if (last && blocks.length) blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: EPH };
    return { role: m.role, content: blocks };
  });
}

export function makeAI({ key, model = "", fetchImpl = globalThis.fetch } = {}) {
  key = String(key || "").trim();
  if (!key) return null;
  const mdl = String(model || "").trim() || AI_MODEL;
  async function call(body, meter) {
    const r = await fetchImpl(API, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: mdl, ...body }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error("AI " + r.status + (j && j.error && j.error.message ? ": " + j.error.message : "")); e.status = r.status; throw e; }
    if (meter && j && j.usage) { try { meter(aiCost(mdl, j.usage), j.usage); } catch (e) {} }
    return j;
  }
  // system: строка или [постоянная часть, меняющаяся часть] — постоянная кэшируется
  const sys = (system) => (Array.isArray(system) ? system.filter(Boolean).map((t, i) => ({ type: "text", text: t, ...(i === 0 ? { cache_control: EPH } : {}) })) : system);
  const toolsC = (tools) => tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: EPH } : t));
  // диалог с инструментами: модель сама вызывает функции бота (данные программы), пока не ответит текстом
  async function chat({ system, messages, tools = [], runTool, maxTurns = 8, maxTokens = 1500, meter = null }) {
    const msgs = messages.slice();
    const used = [];
    for (let turn = 0; turn < maxTurns; turn++) {
      const j = await call({ max_tokens: maxTokens, system: sys(system), messages: withCache(msgs), ...(tools.length ? { tools: toolsC(tools) } : {}) }, meter);
      const content = (j && j.content) || [];
      const calls = content.filter((c) => c.type === "tool_use");
      if (j.stop_reason !== "tool_use" || !calls.length) {
        return { text: content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim(), used };
      }
      msgs.push({ role: "assistant", content });
      const results = [];
      for (const c of calls) {
        let out;
        try { out = await runTool(c.name, c.input || {}); } catch (e) { out = "Xato: " + String((e && e.message) || e).slice(0, 300); }
        used.push({ name: c.name, input: c.input || {} });
        results.push({ type: "tool_result", tool_use_id: c.id, content: String(out == null ? "" : out).slice(0, 12000) });
      }
      msgs.push({ role: "user", content: results });
    }
    return { text: "", used };
  }
  // разбор в JSON: text — строка, или content — блоки (текст, фото, PDF)
  async function json({ system, text, content = null, maxTokens = 400, meter = null }) {
    const j = await call({ max_tokens: maxTokens, system, messages: [{ role: "user", content: content || text }] }, meter);
    const t = ((j && j.content) || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  }
  // короткий текст (комментарий к отчёту, письмо клиенту)
  async function text({ system, prompt, maxTokens = 600, meter = null }) {
    const j = await call({ max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }, meter);
    return ((j && j.content) || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  }
  return { chat, json, text, model: mdl };
}
