// Чтение чеков для Telegram-бота: фото чека → сумма, валюта, где куплено, что, дата, способ оплаты, статья.
// Читает Claude (Anthropic API) — ключ ANTHROPIC_API_KEY из секретов функций Supabase (тот же, что у ai-proxy).
// Нет ключа — makeReader возвращает null, и бот фото не читает (текстовые сообщения работают как раньше).
export const RECEIPT_MODELS = ["claude-sonnet-4-6", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"];
export const MAX_IMAGE_BYTES = 3.7e6;   // base64 картинки в Anthropic API — до 5 МБ
export const MAX_PDF_BYTES = 20e6;

export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
// тип файла по первым байтам (Telegram-фото — всегда JPEG, документы — что прислали)
export function sniffMime(bytes, fallback = "") {
  const b = bytes || [];
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  return fallback;
}

const SYSTEM = "You read payment receipts for the expense log of a small company in Uzbekistan (Tashkent). Reply with exactly one JSON object and nothing else.";
export function receiptPrompt(cats, caption) {
  return [
    "Is this a receipt or a proof of payment: shop / fuel station / cash-register receipt, fiscal cheque (soliq.uz, OFD), invoice or nakladnaya with a total, a handwritten receipt, or a screenshot of a payment app (Click, Payme, Uzum, bank transfer)?",
    "Return JSON:",
    '{"receipt": true, "total": 125000, "currency": "UZS", "merchant": "who was paid", "what": "what was paid for, 2-6 words, in the language of the receipt", "date": "YYYY-MM-DD", "method": "cash|card|transfer|", "direction": "out|in", "category": "<one of the list>", "sure": true}',
    "- total = the final amount actually paid (ИТОГО, JAMI, Umumiy summa, Всего к оплате, To'lov summasi, Итого к оплате). Not a subtotal, not the VAT/НДС/QQS line, not cash handed over or change (сдача, qaytim).",
    "- UZS amounts often use spaces or dots as thousand separators and ,00 tiyin: return a plain number, e.g. 125000. currency is USD only if the receipt is in dollars ($, USD).",
    "- method: card for UzCard / Humo / Visa / plastik / Click / Payme / terminal; transfer for bank transfer / perechisleniye; cash for naqd / наличные; empty string if unknown.",
    "- direction: in only if the company clearly RECEIVED this money (e.g. an incoming transfer to us); otherwise out.",
    "- date: date on the receipt, empty string if not visible.",
    "- category: the best fit from this list: " + cats.join(" | "),
    "- sure: false if the total is hard to read or you are guessing.",
    'If the image is not a receipt or payment proof (a photo of a building, product, people, a chat, a document without a paid amount), return {"receipt": false}.',
    caption ? "The sender wrote this caption: «" + String(caption).slice(0, 300) + "»" : "",
  ].filter(Boolean).join("\n");
}

const num = (x) => {
  if (typeof x === "number") return x;
  const t = String(x == null ? "" : x).replace(/[^\d.,]/g, "");
  if (!t) return NaN;
  const last = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
  if (last < 0) return Number(t);
  const tail = t.slice(last + 1), head = t.slice(0, last).replace(/[.,]/g, "");
  return tail.length === 3 ? Number(head + tail) : Number(head + "." + tail);
};
const str = (x, n) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n);
// ответ модели → { receipt, v, cur, merchant, what, date, method, dir, cat, sure }
export function parseReceipt(text, cats = []) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let j;
  try { j = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  if (!j || j.receipt === false || j.receipt === "false") return { receipt: false };
  const v = Math.round(num(j.total) * 100) / 100;
  const curRaw = String(j.currency || "").toLowerCase();
  const cur = /usd|\$|dollar/.test(curRaw) ? "usd" : /uzs|sum|so'?m|сум/.test(curRaw) ? "uzs" : v >= 1000 ? "uzs" : "usd";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(j.date || "")) ? String(j.date) : "";
  const m = String(j.method || "").toLowerCase();
  const method = m === "card" || m === "transfer" || m === "cash" ? m : "";
  const cat = cats.includes(j.category) ? j.category : "";
  return { receipt: true, v: v > 0 ? v : 0, cur, merchant: str(j.merchant, 60), what: str(j.what, 80), date, method, dir: String(j.direction || "").toLowerCase() === "in" ? "i" : "e", cat, sure: j.sure !== false && j.sure !== "false" };
}

export function makeReader({ key, model = "", fetchImpl = globalThis.fetch } = {}) {
  key = String(key || "").trim();
  if (!key) return null;
  const models = model ? [model, ...RECEIPT_MODELS.filter((x) => x !== model)] : RECEIPT_MODELS;
  return async function read({ bytes, mime, caption = "", cats = [] }) {
    const data = toBase64(bytes);
    const block = mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mime, data } }
      : { type: "image", source: { type: "base64", media_type: mime, data } };
    let lastErr = "";
    for (const m of models) {
      const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: m, max_tokens: 600, system: SYSTEM, messages: [{ role: "user", content: [block, { type: "text", text: receiptPrompt(cats, caption) }] }] }),
      });
      const j = await r.json().catch(() => null);
      const err = j && j.error;
      // этой модели нет у аккаунта — следующая
      if (r.status === 404 || (err && err.type === "not_found_error")) { lastErr = "model " + m; continue; }
      if (!r.ok) { const e = new Error("AI " + r.status + (err && err.message ? ": " + err.message : "")); e.status = r.status; throw e; }
      const text = ((j && j.content) || []).filter((c) => c.type === "text").map((c) => c.text).join("");
      const out = parseReceipt(text, cats);
      if (!out) throw new Error("AI javobi tushunarsiz");
      return out;
    }
    throw new Error("AI: " + (lastErr || "model topilmadi"));
  };
}
