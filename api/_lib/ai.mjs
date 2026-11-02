// ИИ для Telegram-бота: Claude (Anthropic API). Ключ — секрет функций Supabase ANTHROPIC_API_KEY
// (тот же, что у ai-proxy), модель — TG_AI_MODEL или Claude Haiku 5.5 (самая дешёвая).
// Нет ключа — makeAI возвращает null, бот работает как раньше (команды «/»).
export const AI_MODEL = "claude-haiku-5-5";
const API = "https://api.anthropic.com/v1/messages";

export function makeAI({ key, model = "", fetchImpl = globalThis.fetch } = {}) {
  key = String(key || "").trim();
  if (!key) return null;
  const mdl = String(model || "").trim() || AI_MODEL;
  async function call(body) {
    const r = await fetchImpl(API, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: mdl, ...body }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error("AI " + r.status + (j && j.error && j.error.message ? ": " + j.error.message : "")); e.status = r.status; throw e; }
    return j;
  }
  // диалог с инструментами: модель сама вызывает функции бота (данные программы), пока не ответит текстом
  async function chat({ system, messages, tools = [], runTool, maxTurns = 6, maxTokens = 1500 }) {
    const msgs = messages.slice();
    const used = [];
    for (let turn = 0; turn < maxTurns; turn++) {
      const j = await call({ max_tokens: maxTokens, system, messages: msgs, ...(tools.length ? { tools } : {}) });
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
        used.push(c.name);
        results.push({ type: "tool_result", tool_use_id: c.id, content: String(out == null ? "" : out).slice(0, 12000) });
      }
      msgs.push({ role: "user", content: results });
    }
    return { text: "", used };
  }
  // одна строка → JSON (разбор свободного текста)
  async function json({ system, text, maxTokens = 400 }) {
    const j = await call({ max_tokens: maxTokens, system, messages: [{ role: "user", content: text }] });
    const t = ((j && j.content) || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  }
  return { chat, json, model: mdl };
}
