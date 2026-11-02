// Google Gemini (бесплатный уровень) — чтение списков для сметы: фото, PDF, текст → JSON.
// Ключ — секрет функций Supabase GEMINI_API_KEY (Google AI Studio); модель — GEMINI_MODEL или «gemini-flash-latest».
// Лимит бесплатного уровня кончился (429) — пробует облегчённую модель, потом бот переходит на Claude.
// Внимание: на бесплатном уровне Google может использовать присланное для улучшения своих продуктов.
export const GEMINI_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];
export function makeGemini({ key, model = "", fetchImpl = globalThis.fetch } = {}) {
  key = String(key || "").trim();
  if (!key) return null;
  const models = [...new Set([String(model || "").trim(), ...GEMINI_MODELS].filter(Boolean))];
  async function json({ system, text, content = null, maxTokens = 4000 }) {
    const parts = [];
    for (const b of content || [{ type: "text", text: String(text || "") }]) {
      if (b.type === "text") parts.push({ text: b.text });
      else if (b.source && b.source.type === "base64") parts.push({ inline_data: { mime_type: b.source.media_type, data: b.source.data } });
    }
    let last = null;
    for (const m of models) {
      const r = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent", {
        method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: Math.max(maxTokens, 8000), temperature: 0 } }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { last = new Error("Gemini " + r.status + (j && j.error && j.error.message ? ": " + String(j.error.message).slice(0, 160) : "")); if ([404, 429, 500, 503].includes(r.status)) continue; throw last; }
      const t = ((((j && j.candidates) || [])[0] || {}).content || {}).parts || [];
      const s = t.map((p) => (p.thought ? "" : p.text || "")).join("");
      const a = s.indexOf("{"), z = s.lastIndexOf("}");
      if (a < 0 || z <= a) return null;
      try { return JSON.parse(s.slice(a, z + 1)); } catch (e) { return null; }
    }
    throw last || new Error("Gemini: no model");
  }
  return { json, name: "gemini" };
}
