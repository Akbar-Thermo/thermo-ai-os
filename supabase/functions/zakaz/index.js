// Thermo postavka — бот поставщиков (функция Supabase «zakaz»). Тот же код, что у бота «tg» (api/_lib), в режиме zakaz:
// накладная из группы поставщика → сначала в личный чат «Объект выбирает» (догадка бота отмечена ✅) → после выбора в группу расходов;
// прайс поставщика — запоминает, «prayslar» в личном чате → себестоимость товаров. Заказы поставщикам не отправляет.
// Секреты функций (руководитель ставит сам): ZAKAZ_BOT_TOKEN — токен бота от @BotFather. ИИ — только Claude Haiku 5.5.
// Excel (прайсы в .xlsx): index.ts кладёт библиотеку в globalThis.TE_XLSX. Подключение: один раз ?setup=1.
import { createHash } from "node:crypto";
import { makeRest } from "../tg/_lib/rest.mjs";
import { makeBot } from "../tg/_lib/bot.mjs";
import { makeAI } from "../tg/_lib/ai.mjs";
import { makeVoice } from "../tg/_lib/voice.mjs";

const env = (k) => (Deno.env.get(k) || "").trim();
const TOKEN = env("ZAKAZ_BOT_TOKEN").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "").replace(/^bot(?=\d)/i, "");
const SECRET = TOKEN ? createHash("sha256").update("thermo-zakaz:" + TOKEN).digest("hex").slice(0, 48) : "";
const URL_ = env("TG_DB_URL") || env("SUPABASE_URL");
const ANON = env("TG_DB_KEY") || env("SUPABASE_ANON_KEY");
const LOGIN = env("TG_BOT_LOGIN"), PASS = Deno.env.get("TG_BOT_PASSWORD") || "";
const AI = makeAI({ key: env("ANTHROPIC_API_KEY"), model: "claude-haiku-5-5" }); // только Haiku 5.5
const VOICE = makeVoice({ azureKey: env("AZURE_SPEECH_KEY"), azureRegion: env("AZURE_SPEECH_REGION"), groqKey: env("GROQ_API_KEY") });

async function tg(method, payload) {
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok && !/message is not modified/.test(j.description || "")) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
async function upload(method, params, file) {
  const fd = new FormData();
  Object.entries(params || {}).forEach(([k, v]) => fd.append(k, String(v)));
  fd.append(file.field || "document", new Blob([file.bytes], { type: file.mime || "application/octet-stream" }), file.name || "file");
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
async function download(fileId) {
  const f = await tg("getFile", { file_id: fileId });
  if (!f || !f.file_path) throw new Error("getFile: нет файла");
  let r;
  try { r = await fetch("https://api.telegram.org/file/bot" + TOKEN + "/" + f.file_path); } catch (e) { throw new Error("download: нет связи"); }
  if (!r.ok) throw new Error("download " + r.status);
  return { bytes: new Uint8Array(await r.arrayBuffer()), path: f.file_path };
}
let bot = null;
// Excel → строки всех листов (библиотека из index.ts; нет — Excel не читается)
function sheet(bytes) {
  const X = globalThis.TE_XLSX;
  if (!X || !X.read) return null;
  const wb = X.read(bytes, { type: "array" });
  return wb.SheetNames.map((n) => X.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }));
}
const getBot = () => bot || (bot = makeBot({ db: makeRest({ url: URL_, anon: ANON, login: LOGIN, password: PASS }), tg, upload, ai: AI, file: download, voice: VOICE, memKey: TOKEN, sheet, zakaz: true }));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  // старые вкладки программы ещё могут «будить» бота (?poke=1) — больше ничего не делает
  if (new URL(req.url).searchParams.get("poke") === "1") return new Response("ok", { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
  if (req.method !== "POST") {
    const st = { ok: true, bot: !!TOKEN, db: !!(URL_ && ANON), account: !!(LOGIN && PASS), model: AI ? AI.model : false, voice: !!VOICE, excel: !!(globalThis.TE_XLSX && globalThis.TE_XLSX.read) };
    // ?setup=1 — подключить вебхук этого бота к этой функции (токен не показывается)
    if (TOKEN && new URL(req.url).searchParams.get("setup") === "1") {
      const base = env("SUPABASE_URL");
      try {
        await tg("setWebhook", { url: base + "/functions/v1/zakaz", secret_token: SECRET, allowed_updates: ["message", "callback_query", "my_chat_member"], drop_pending_updates: true });
        const me = await tg("getMe", {});
        return json(200, { ...st, webhook: "ok", username: me && me.username });
      } catch (e) { return json(200, { ...st, webhook: "error: " + String(e.message || e).slice(0, 200) }); }
    }
    // ?recaption=1 — подписи уже отправленных в группу расходов накладных — заново, по текущему виду (только правка своих сообщений)
    if (TOKEN && new URL(req.url).searchParams.get("recaption") === "1") {
      try { return json(200, { ok: true, recaption: await getBot().handle({ te_recaption: true }) }); }
      catch (e) { return json(200, { ok: false, error: String(e.message || e).slice(0, 200) }); }
    }
    return json(200, st);
  }
  if (!TOKEN || req.headers.get("x-telegram-bot-api-secret-token") !== SECRET) return json(401, { ok: false });
  let upd = null;
  try { upd = await req.json(); } catch (e) { upd = null; }
  if (upd) {
    try { await getBot().handle(upd); }
    catch (e) {
      console.error("zakaz:", e && e.message);
      const chat = (upd.message && upd.message.chat) || (upd.callback_query && upd.callback_query.message && upd.callback_query.message.chat);
      if (chat && chat.type === "private") { try { await tg("sendMessage", { chat_id: chat.id, text: "⚠️ Xato: " + String((e && e.message) || e).replace(/^\w+: /, "").slice(0, 200) }); } catch (e2) {} }
    }
  }
  return json(200, { ok: true });
});
