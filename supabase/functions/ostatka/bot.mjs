// Бот остатка — логика Telegram (без сети: tg/upload/file/db/later передаются снаружи — index.js или тест).
// Пользователь сам говорит, что это: «prixod» → дальше файлы прихода, «rasxod» → файлы расхода (режим 30 минут).
// Файлы без режима ждут (kind = null), пока не напишут «prixod»/«rasxod». /ostatka → итог + Excel.
// Кто может пользоваться — решает руководитель в программе: Аккаунты → «Бот остатка» (requests.mode = te_os);
// бот пишет туда, кто ему писал, и сколько фактур у каждого (requests.mode = te_ospend).
import * as C from "./core.mjs";

export const OS_MODE = "te_os", OS_PEND_MODE = "te_ospend";
const MODE_TTL = 30 * 60 * 1000;
const KINDS = ["prixod", "rasxod"];
const ICON = { prixod: "📥 PRIXOD", rasxod: "📤 RASXOD" };

const HELP =
  "Salom! Men ostatka hisoblovchi botman.\n\n" +
  "1️⃣ «prixod» deb yozing (yoki /prixod) va prixod fakturalarini (.xls) tashlang.\n" +
  "2️⃣ «rasxod» deb yozing (yoki /rasxod) va rasxod fakturalarini tashlang.\n" +
  "   Bittalab, ko'plab yoki ZIP qilib tashlash mumkin. Avval fayllarni tashlab, keyin «bu prixod edi» deb yozsangiz ham bo'ladi.\n" +
  "3️⃣ /ostatka — qoldiqni hisoblab, Excel qilib beraman.\n\n" +
  "/fakturalar — ro'yxat · /ochir 20/26 — fakturani o'chirish · /tozalash ha — hammasini o'chirish";

export function detectKind(t) {
  const s = String(t || "").toLowerCase();
  if (/pr[iy]xod|prihod|приход|kirim/.test(s)) return "prixod";
  if (/ras[xh]od|расход|chiqim/.test(s)) return "rasxod";
  return null;
}

// db: { cfg(mode) → lines|null, setCfg(mode, lines), chat(id) → row|null, saveChat(row), invoices(chat, {kind?}) → [], insert(rows) → inserted uids,
//       existing(chat, uids) → [{uid, kind}], setKind(chat, kind) → n, del(chat, number) → [rows], clear(chat), counts(chat) → {prixod, rasxod, wait} }
export function makeOstatkaBot({ db, tg, upload, file, later }) {
  const send = (chat, text) => tg("sendMessage", { chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true });
  const sendLong = async (chat, text) => { for (let i = 0; i < text.length; i += 4000) await send(chat, text.slice(i, i + 4000)); };
  const who = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id);

  async function allowed(user) {
    const cfg = (await db.cfg(OS_MODE)) || {};
    return (cfg.allowed || []).some((a) => String(a.id) === String(user.id));
  }
  // кто писал боту — для списка «Разрешить» в программе (не чаще раза в час на человека)
  async function noteSeen(user, chatId, extra) {
    const p = (await db.cfg(OS_PEND_MODE)) || {};
    const seen = Array.isArray(p.seen) ? p.seen : [];
    const i = seen.findIndex((s) => String(s.id) === String(user.id));
    const now = new Date().toISOString();
    const row = { id: String(user.id), name: who(user), username: user.username || "", chat: String(chatId), at: now, ...(extra || {}) };
    if (i >= 0) {
      const old = seen[i];
      if (!extra && Date.now() - Date.parse(old.at || 0) < 3600e3 && old.name === row.name) return;
      seen[i] = { ...old, ...row };
    } else seen.push(row);
    await db.setCfg(OS_PEND_MODE, { ...p, seen: seen.slice(-100) });
  }
  async function refreshStats(user, chatId) {
    const c = await db.counts(chatId);
    await noteSeen(user, chatId, { stats: { ...c, at: new Date().toISOString() } });
  }

  async function getMode(chatId) {
    const r = await db.chat(chatId);
    return r && KINDS.includes(r.mode) && Date.now() - Date.parse(r.mode_at || 0) < MODE_TTL ? r.mode : null;
  }
  async function setMode(chatId, kind, name) {
    const r = (await db.chat(chatId)) || { chat_id: chatId };
    await db.saveChat({ ...r, mode: kind, mode_at: new Date().toISOString(), name: name || r.name || null });
  }

  // ---------------------------------------------------------------- файлы
  // одна фактура → строка отчёта; kind = null — ждёт «prixod»/«rasxod»
  async function addInvoices(chatId, kind, items) {
    const out = [], rows = [];
    for (const it of items) {
      let inv;
      try { inv = C.parseInvoice(it.bytes); }
      catch (e) { out.push({ bad: `❌ ${it.name}: ${e instanceof C.ParseError ? e.message : "faylni o'qib bo'lmadi"}` }); continue; }
      rows.push({ chat_id: chatId, kind, uid: C.invoiceUid(inv), number: inv.number, date: inv.date, supplier: inv.supplier, supplier_inn: inv.supplier_inn,
        buyer: inv.buyer, buyer_inn: inv.buyer_inn, total: inv.total, file_name: it.name, lines: inv.lines });
    }
    // одна и та же фактура в одной пачке — один раз
    const uniq = [...new Map(rows.map((r) => [r.uid, r])).values()];
    const have = new Map((await db.existing(chatId, uniq.map((r) => r.uid))).map((r) => [r.uid, r.kind]));
    const fresh = uniq.filter((r) => !have.has(r.uid));
    for (const r of rows) if (have.has(r.uid)) out.push({ bad: `♻️ №${r.number} ${C.ruDate(r.date)} — avval ${have.get(r.uid) || "kutishda"} sifatida yuborilgan, takror olinmadi` });
    if (fresh.length) await db.insert(fresh);
    for (const r of fresh) out.push({ kind, ok: `№${r.number} ${C.ruDate(r.date)} — ${C.shortName(r.supplier).slice(0, 24)} → ${C.shortName(r.buyer).slice(0, 24)} — ${C.money(r.total)} so'm` });
    return out;
  }

  // Ответ на пачку файлов — одним сообщением: ждём 4 секунды тишины (каждый файл — отдельный запрос Telegram)
  async function queue(chatId, lines) {
    const r = (await db.chat(chatId)) || { chat_id: chatId };
    const stamp = new Date().toISOString();
    await db.saveChat({ ...r, batch: [...(Array.isArray(r.batch) ? r.batch : []), ...lines], batch_at: stamp });
    later(async () => {
      await new Promise((res) => setTimeout(res, 4000));
      const cur = await db.chat(chatId);
      if (!cur || cur.batch_at !== stamp || !Array.isArray(cur.batch) || !cur.batch.length) return; // пришли ещё файлы — отчитается последний
      await db.saveChat({ ...cur, batch: [], batch_at: null });
      await sendLong(chatId, report(cur.batch));
    });
  }
  function report(items) {
    const out = [];
    for (const k of KINDS) {
      const ok = items.filter((x) => x.ok && x.kind === k);
      if (ok.length) out.push(`${ICON[k]} ga qo'shildi: ${ok.length} ta`, ...ok.map((x) => "  " + x.ok), "");
    }
    const wait = items.filter((x) => x.ok && !x.kind);
    if (wait.length) out.push(`⏳ ${wait.length} ta faktura kutib turibdi. Bular PRIXODmi yoki RASXODmi?`, "«prixod» yoki «rasxod» deb yozing.", "");
    const bad = items.filter((x) => x.bad);
    if (bad.length) out.push(`⚠️ Qabul qilinmadi: ${bad.length} ta`, ...bad.map((x) => "  " + x.bad), "");
    if (!wait.length) out.push("Hisoblash uchun: /ostatka");
    return out.join("\n").trim();
  }

  async function onDocument(msg) {
    const chatId = msg.chat.id, doc = msg.document, name = doc.file_name || "fayl";
    let kind = detectKind(msg.caption);
    if (kind) await setMode(chatId, kind, who(msg.from));
    else {
      kind = await getMode(chatId);
      if (kind) await setMode(chatId, kind, who(msg.from)); // пока шлют файлы — режим не истекает
    }
    let items;
    if (/\.zip$/i.test(name)) {
      const { bytes } = await file(doc.file_id);
      try { items = await C.unzip(bytes); } catch (e) { return queue(chatId, [{ bad: `❌ ${name}: ZIP fayl buzilgan` }]); }
      if (!items.length) return queue(chatId, [{ bad: `❌ ${name}: ZIP ichida .xls faktura topilmadi` }]);
    } else if (/\.(xls|html?)$/i.test(name)) {
      if (doc.file_size > 19e6) return queue(chatId, [{ bad: `❌ ${name}: fayl juda katta` }]);
      const { bytes } = await file(doc.file_id);
      items = [{ name, bytes }];
    } else return queue(chatId, [{ bad: `❌ ${name}: faqat .xls fakturalar yoki .zip qabul qilinadi` }]);
    await queue(chatId, await addInvoices(chatId, kind, items));
    await refreshStats(msg.from, chatId);
  }

  // ---------------------------------------------------------------- команды
  async function switchKind(msg, kind) {
    const chatId = msg.chat.id;
    await setMode(chatId, kind, who(msg.from));
    const n = await db.setKind(chatId, kind); // ожидавшие файлы — в этот вид
    await send(chatId, `${ICON[kind]} rejimi.` + (n ? ` Kutib turgan ${n} ta faktura ${kind.toUpperCase()} ga qo'shildi.` : "") +
      `\nEndi tashlagan fayllaringiz ham ${kind.toUpperCase()} bo'ladi (30 daqiqa).` + (n ? "\nHisoblash uchun: /ostatka" : ""));
    if (n) await refreshStats(msg.from, chatId);
  }

  async function cmdOstatka(msg) {
    const chatId = msg.chat.id;
    const invs = (await db.invoices(chatId)).filter((i) => i.kind);
    if (!invs.length) return send(chatId, "Hali faktura yo'q. «prixod» deb yozib, fakturalarni tashlang.");
    const cfg = (await db.cfg(OS_MODE)) || {};
    const res = C.compute(invs, cfg.aliases || {});
    await send(chatId, C.summaryText(res));
    await upload("sendDocument", { chat_id: chatId, caption: "To'liq jadval: Ostatka / Prixod / Rasxod" },
      { field: "document", bytes: C.writeXlsx(res), name: "Ostatka.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  async function cmdList(msg) {
    const chatId = msg.chat.id, invs = await db.invoices(chatId);
    if (!invs.length) return send(chatId, "Hali faktura yo'q.");
    const out = [];
    for (const k of [...KINDS, null]) {
      const part = invs.filter((i) => (i.kind || null) === k).sort((a, b) => a.date.localeCompare(b.date));
      if (!part.length && !k) continue;
      out.push(`${k ? ICON[k] : "⏳ KUTISHDA"} — ${part.length} ta, ${C.money(part.reduce((a, i) => a + Number(i.total), 0))} so'm`);
      for (const i of part) out.push(`  №${i.number}  ${C.ruDate(i.date)}  ${C.shortName(k === "rasxod" ? i.buyer : i.supplier).slice(0, 28)}  ${C.money(i.total)}`);
      out.push("");
    }
    const m = await getMode(chatId);
    out.push("Hozirgi rejim: " + (m ? m.toUpperCase() : "tanlanmagan"));
    await sendLong(chatId, out.join("\n"));
  }

  async function cmdDelete(msg, arg) {
    const chatId = msg.chat.id, number = String(arg || "").trim().replace(/^№\s*/, "");
    if (!number) return send(chatId, "Qaysi faktura? Masalan: /ochir 20/26");
    const gone = await db.del(chatId, number);
    if (!gone.length) return send(chatId, `№${number} topilmadi. Ro'yxat: /fakturalar`);
    await send(chatId, "🗑 O'chirildi:\n" + gone.map((r) => `${r.kind || "kutishda"}: №${r.number} ${C.ruDate(r.date)} (${C.shortName(r.supplier).slice(0, 25)})`).join("\n"));
    await refreshStats(msg.from, chatId);
  }

  async function cmdClear(msg, arg) {
    const chatId = msg.chat.id;
    if (String(arg || "").trim().toLowerCase() !== "ha") return send(chatId, "Hamma fakturalar o'chadi. Rostdan ham bo'lsa, shunday yozing:\n/tozalash ha");
    await db.clear(chatId);
    await send(chatId, "🧹 Hammasi tozalandi. «prixod» deb yozib, yangidan boshlang.");
    await refreshStats(msg.from, chatId);
  }

  async function handle(upd) {
    const msg = upd.message;
    if (!msg || !msg.from || msg.from.is_bot) return;
    const chatId = msg.chat.id;
    if (!(await allowed(msg.from))) {
      await noteSeen(msg.from, chatId);
      return send(chatId, `⛔ Sizga hali ruxsat berilmagan.\nSizning Telegram ID: ${msg.from.id}\n\nRahbar Thermo AI OS'da ruxsat beradi: Аккаунты → «Бот остатка» → «Разрешить».`);
    }
    if (msg.document) return onDocument(msg);
    const t = String(msg.text || "").trim();
    if (!t) return;
    const m = t.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
    if (m) {
      const [, cmd, arg] = m;
      switch (cmd.toLowerCase()) {
        case "start": case "help": case "yordam": await refreshStats(msg.from, chatId); return send(chatId, HELP);
        case "prixod": return switchKind(msg, "prixod");
        case "rasxod": return switchKind(msg, "rasxod");
        case "ostatka": return cmdOstatka(msg);
        case "fakturalar": return cmdList(msg);
        case "ochir": return cmdDelete(msg, arg);
        case "tozalash": return cmdClear(msg, arg);
        default: return send(chatId, "Bunday buyruq yo'q. Yordam: /start");
      }
    }
    const kind = detectKind(t);
    if (kind) return switchKind(msg, kind);
    return send(chatId, "Tushunmadim 🙂 «prixod» yoki «rasxod» deb yozing, keyin fayllarni tashlang. Yordam: /start");
  }

  return { handle };
}

// ---------------------------------------------------------------- база через PostgREST (ключ service role — только на сервере)
export function makeDb({ url, key }) {
  const H = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
  const q = async (path, opt = {}) => {
    const r = await fetch(url + "/rest/v1/" + path, { ...opt, headers: { ...H, ...(opt.headers || {}) } });
    const t = await r.text();
    if (!r.ok) throw new Error("db " + r.status + ": " + t.slice(0, 200));
    return t ? JSON.parse(t) : null;
  };
  const enc = encodeURIComponent;
  const cfgRow = async (mode) => ((await q(`requests?select=id,lines&mode=eq.${mode}&order=created_at.asc&limit=1`)) || [])[0] || null;
  return {
    async cfg(mode) { const r = await cfgRow(mode); return r && r.lines && !Array.isArray(r.lines) ? r.lines : null; },
    async setCfg(mode, lines) {
      const r = await cfgRow(mode);
      if (r) await q(`requests?id=eq.${r.id}`, { method: "PATCH", body: JSON.stringify({ lines }) });
      else await q("requests", { method: "POST", body: JSON.stringify({ mode, source: "config", lines }) });
    },
    async chat(id) { return ((await q(`ostatka_chats?chat_id=eq.${id}&limit=1`)) || [])[0] || null; },
    async saveChat(row) {
      await q("ostatka_chats?on_conflict=chat_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }) });
    },
    async invoices(chat) { return (await q(`ostatka_invoices?chat_id=eq.${chat}&select=kind,uid,number,date,supplier,buyer,total,file_name,lines&order=date.asc`)) || []; },
    async existing(chat, uids) {
      if (!uids.length) return [];
      const list = uids.map((u) => '"' + u.replace(/"/g, '\\"') + '"').join(",");
      return (await q(`ostatka_invoices?chat_id=eq.${chat}&uid=in.(${enc(list)})&select=uid,kind`)) || [];
    },
    async insert(rows) { await q("ostatka_invoices?on_conflict=chat_id,uid", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(rows) }); },
    async setKind(chat, kind) {
      const r = await q(`ostatka_invoices?chat_id=eq.${chat}&kind=is.null&select=uid`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ kind }) });
      return (r || []).length;
    },
    async del(chat, number) {
      return (await q(`ostatka_invoices?chat_id=eq.${chat}&number=eq.${enc(number)}&select=kind,number,date,supplier`, { method: "DELETE", headers: { Prefer: "return=representation" } })) || [];
    },
    async clear(chat) { await q(`ostatka_invoices?chat_id=eq.${chat}`, { method: "DELETE" }); },
    async counts(chat) {
      const rows = (await q(`ostatka_invoices?chat_id=eq.${chat}&select=kind,total`)) || [];
      const c = { prixod: 0, rasxod: 0, wait: 0, prixod_sum: 0, rasxod_sum: 0 };
      for (const r of rows) { if (r.kind === "prixod") { c.prixod++; c.prixod_sum += Number(r.total); } else if (r.kind === "rasxod") { c.rasxod++; c.rasxod_sum += Number(r.total); } else c.wait++; }
      c.prixod_sum = Math.round(c.prixod_sum); c.rasxod_sum = Math.round(c.rasxod_sum);
      return c;
    },
  };
}
