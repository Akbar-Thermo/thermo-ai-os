// Бот остатка — расчёт (без внешних библиотек, работает и в Supabase Edge, и в Node для проверки).
// Счёт-фактура из Didox/my.soliq (.xls — на самом деле HTML с таблицей) → строки товаров;
// остаток по товару = приход − расход; сумма остатка — по средней цене прихода (с НДС);
// Excel (.xlsx) пишется вручную (простой ZIP без сжатия), ZIP от пользователя читается через DecompressionStream.

// ---------------------------------------------------------------- разбор счёт-фактуры

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const text = (html) => decode(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/[\s\u00a0]+/g, " ").trim();
const num = (s) => { const v = parseFloat(String(s || "").replace(/[\s\u00a0]/g, "").replace(",", ".")); return isFinite(v) ? v : null; };
export const stripPrefix = (n) => String(n || "").trim().replace(/^\d+\.\s*/, "");
export const shortName = (n) => String(n || "").replace(/MAS.ULIYATI CHEKLANGAN JAMIYATI?/gi, "MCHJ").replace(/"/g, "").trim();
const UNIT = { metr: "метр", "м": "метр", dona: "шт.", "шт": "шт.", kg: "килограмм" };
const normUnit = (u) => { const t = String(u || "").trim(); return UNIT[t.toLowerCase()] || t; };

export class ParseError extends Error {}

function bytesToHtml(bytes) {
  let s = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if ((s.match(/\uFFFD/g) || []).length > 20) s = new TextDecoder("windows-1251").decode(bytes);
  return s;
}

// Значение ячейки, стоящей сразу после ячейки с подписью (таблицы «Поставщик / Покупатель»)
function after(html, label) {
  const re = new RegExp("<td[^>]*>\\s*" + label + "\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>", "i");
  const m = html.match(re);
  return m ? text(m[1]) : "";
}

export function parseInvoice(bytes) {
  const html = typeof bytes === "string" ? bytes : bytesToHtml(bytes);
  const at = html.indexOf("be__products-table");
  if (at < 0) throw new ParseError("bu faylda hisob-faktura jadvali topilmadi");
  const tm = html.match(/class="be__title"[^>]*>([\s\S]*?)<\/div>/i);
  const title = tm ? text(tm[1]) : "";
  const m = title.match(/№\s*(\S+)\s+от\s+(\d{2}\.\d{2}\.\d{4})/);
  if (!m) throw new ParseError("faktura raqami/sanasi topilmadi");
  const supplier = after(html, "Поставщик:"), buyer = after(html, "Покупатель:");
  const sInn = after(html, "Идентификационный номер поставщика \\(ИНН\\):").replace(/\D/g, "");
  const bInn = after(html, "Идентификационный номер покупателя \\(ИНН\\):").replace(/\D/g, "");

  const end = html.indexOf("</table>", at);
  const table = html.slice(at, end < 0 ? undefined : end);
  let header = [], itogo = null;
  const lines = [];
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const c = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(text);
    if (!c.length) continue;
    if (c[0] === "№") header = c;
    else if (/^\d+$/.test(c[0]) && c.length >= 10) {
      const o = header.some((h) => /Штрих-код/i.test(h)) ? 1 : 0;
      lines.push({
        name: stripPrefix(c[1]), code: (c[2] || "").split(" - ")[0].trim(), unit: normUnit(c[3 + o]),
        qty: num(c[4 + o]) || 0, price: num(c[5 + o]) || 0, sum: num(c[6 + o]) || 0,
        vat_rate: c[7 + o] || "", vat: num(c[8 + o]) || 0, total: num(c[9 + o]) || 0,
      });
    } else if (/^Итого/.test(c[0])) {
      const ns = c.slice(1).map(num).filter((x) => x != null);
      itogo = ns.length ? ns[ns.length - 1] : null;
    }
  }
  if (!lines.length) throw new ParseError("fakturada tovar qatorlari topilmadi");
  const total = Math.round(lines.reduce((a, l) => a + l.total, 0) * 100) / 100;
  if (itogo != null && Math.abs(total - itogo) > 1) throw new ParseError("qatorlar yig'indisi 'Итого' bilan mos emas");
  const [d, mo, y] = m[2].split(".");
  return { number: m[1], date: `${y}-${mo}-${d}`, supplier, supplier_inn: sInn, buyer, buyer_inn: bInn, total, lines };
}

// ключ для «тот же счёт-фактура»: номер + дата + ИНН продавца
export const invoiceUid = (inv) => `${inv.number}|${inv.date}|${inv.supplier_inn}`;
export const ruDate = (iso) => { const [y, m, d] = String(iso).split("-"); return `${d}.${m}.${y}`; };

// ---------------------------------------------------------------- расчёт остатка

export const itemKey = (n) => stripPrefix(n).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "").replace(/[.,]+$/, "");
export const DEFAULT_ALIASES = { "Коллектор": "Коллектор из нержавеющый стали" };
export const aliasMap = (a) => Object.fromEntries(Object.entries({ ...DEFAULT_ALIASES, ...(a || {}) }).map(([k, v]) => [itemKey(k), itemKey(v)]));

export const ST = {
  none: "Prixodda yo'q (minus)",
  over: "Kamomad: prixoddan ko'p sotilgan",
  full: "Sotilmagan, to'liq qoldi",
  part: "Qisman qoldi",
  zero: "Qolmagan",
};
const ORDER = [ST.none, ST.over, ST.full, ST.part, ST.zero];
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 1e4) / 1e4;
const top = (cnt) => Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];

// invoices: [{ kind: "prixod"|"rasxod", number, date, supplier, buyer, total, lines }]
export function compute(invoices, aliases) {
  const al = aliasMap(aliases);
  const pr = invoices.filter((i) => i.kind === "prixod"), rs = invoices.filter((i) => i.kind === "rasxod");
  const items = new Map();
  for (const inv of [...pr, ...rs]) for (const l of inv.lines) {
    let k = itemKey(l.name); k = al[k] || k;
    let it = items.get(k);
    if (!it) items.set(k, (it = { names: {}, pu: {}, ru: {}, pq: 0, ps: 0, rq: 0, rs: 0, pinv: new Set(), rinv: new Set() }));
    it.names[l.name] = (it.names[l.name] || 0) + 1;
    if (inv.kind === "prixod") { it.pq += l.qty; it.ps += l.total; it.pinv.add(inv.number); it.pu[l.unit] = (it.pu[l.unit] || 0) + 1; }
    else { it.rq += l.qty; it.rs += l.total; it.rinv.add(inv.number); it.ru[l.unit] = (it.ru[l.unit] || 0) + 1; }
  }
  const rows = [];
  for (const it of items.values()) {
    const pq = r4(it.pq), rq = r4(it.rq), left = r4(pq - rq), avg = pq ? it.ps / pq : null;
    const status = pq === 0 ? ST.none : rq === 0 ? ST.full : left < 0 ? ST.over : Math.abs(left) < 1e-9 ? ST.zero : ST.part;
    const units = new Set([...Object.keys(it.pu), ...Object.keys(it.ru)]);
    rows.push({
      name: top(it.names), unit: top(Object.keys(it.pu).length ? it.pu : it.ru), pq, rq, left, avg,
      value: avg == null ? null : r2(left * avg), ps: r2(it.ps), rs: r2(it.rs), status,
      pinv: [...it.pinv].sort().join(", "), rinv: [...it.rinv].sort().join(", "),
      unitWarn: units.size > 1 ? [...units].sort().join(", ") : "",
    });
  }
  rows.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const sum = (a, f) => r2(a.reduce((s, x) => s + (f(x) || 0), 0));
  return {
    rows, prixod: pr, rasxod: rs,
    prixodTotal: sum(pr, (i) => i.total), rasxodTotal: sum(rs, (i) => i.total),
    stockValue: sum(rows.filter((r) => r.left > 0), (r) => r.value),
  };
}

export const money = (x) => Math.round(x || 0).toLocaleString("en-US").replace(/,/g, " ");
const g = (x) => String(r4(x));

export function summaryText(res) {
  const cnt = (s) => res.rows.filter((r) => r.status === s).length;
  const val = (s) => res.rows.filter((r) => r.status === s).reduce((a, r) => a + (r.value || 0), 0);
  const minus = res.rows.filter((r) => r.left < 0).sort((a, b) => (a.pq === 0) - (b.pq === 0) || a.left - b.left);
  const out = [
    "📦 OSTATKA",
    `Prixod: ${res.prixod.length} ta faktura — ${money(res.prixodTotal)} so'm`,
    `Rasxod: ${res.rasxod.length} ta faktura — ${money(res.rasxodTotal)} so'm`,
    "",
    `✅ Qolgan tovar (kirim narxida): ${money(res.stockValue)} so'm`,
    `• To'liq qolgan: ${cnt(ST.full)} xil — ${money(val(ST.full))} so'm`,
    `• Qisman qolgan: ${cnt(ST.part)} xil — ${money(val(ST.part))} so'm`,
    `• To'liq sotilgan: ${cnt(ST.zero)} xil`,
  ];
  if (minus.length) {
    out.push("", `⚠️ Minusda: ${minus.length} xil tovar (tekshiring):`);
    for (const r of minus.slice(0, 15)) out.push(`• ${r.name.slice(0, 60)} — ${g(r.left)} ${r.unit} (${r.pq === 0 ? "prixodi yo'q" : "ko'p sotilgan"})`);
    if (minus.length > 15) out.push(`… yana ${minus.length - 15} ta — Excel faylda`);
  }
  const warn = res.rows.filter((r) => r.unitWarn).length;
  if (warn) out.push("", `ℹ️ ${warn} ta tovar har xil o'lchovda yozilgan (Excel'da «Diqqat» ustuni).`);
  return out.join("\n");
}

// ---------------------------------------------------------------- Excel (.xlsx) без библиотек

const xesc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
const colName = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// стили: 0 — обычный, 1 — жирный, 2 — шапка (жирный + серый фон), 3 — деньги #,##0.00, 4 — дата, 5 — жирные деньги
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F3F3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
const isoToSerial = (iso) => { const [y, m, d] = iso.split("-").map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5; };

// cell: null | number | string | { f: "=…" , s } | { v, s } | { d: "2026-01-02" }
function sheetXml(rows, widths, freezeRow) {
  const out = [];
  rows.forEach((row, ri) => {
    if (!row) return;
    const cells = [];
    row.forEach((c, ci) => {
      if (c == null || c === "") return;
      const ref = colName(ci) + (ri + 1);
      let v = c, s = 0;
      if (typeof c === "object") { s = c.s || 0; v = c.f != null ? c : c.d != null ? c : c.v; }
      if (v && typeof v === "object" && v.f != null) cells.push(`<c r="${ref}" s="${s}"><f>${xesc(v.f.replace(/^=/, ""))}</f></c>`);
      else if (v && typeof v === "object" && v.d != null) cells.push(`<c r="${ref}" s="4"><v>${isoToSerial(v.d)}</v></c>`);
      else if (typeof v === "number") cells.push(`<c r="${ref}" s="${s}"><v>${v}</v></c>`);
      else if (v != null && v !== "") cells.push(`<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`);
    });
    out.push(`<row r="${ri + 1}">${cells.join("")}</row>`);
  });
  const pane = freezeRow ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
  const cols = widths ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${out.join("")}</sheetData></worksheet>`;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// простой ZIP без сжатия (Excel такие открывает)
export function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const [name, content] of files) {
    const data = typeof content === "string" ? enc.encode(content) : content, nm = enc.encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const csize = central.reduce((a, p) => a + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

function workbook(sheets) {
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  const wbr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zipStore([
    ["[Content_Types].xml", ct], ["_rels/.rels", rels], ["xl/workbook.xml", wb], ["xl/_rels/workbook.xml.rels", wbr], ["xl/styles.xml", STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.widths, s.freeze)]),
  ]);
}

export function writeXlsx(res, when = new Date()) {
  const M = (v) => (v == null ? null : { v, s: 3 }), H = (v) => ({ v, s: 2 });
  const n0 = 9, n1 = n0 + res.rows.length - 1;
  const stamp = new Date(when.getTime() + 5 * 36e5).toISOString().slice(0, 16).replace("T", " "); // Ташкент
  const main = [
    [{ v: `Prixod jami, so'm (QQS bilan) — ${res.prixod.length} ta faktura`, s: 0 }, { f: "=SUM(Prixod!M3:M100000)", s: 3 }],
    [`Rasxod jami, so'm (QQS bilan) — ${res.rasxod.length} ta faktura`, { f: "=SUM(Rasxod!M3:M100000)", s: 3 }],
    [{ v: "OSTATKA tannarxda, so'm (qolgan soni × o'rtacha kirim narxi)", s: 1 }, { f: `=SUMIF(E${n0}:E${n1},">0",G${n0}:G${n1})`, s: 5 }],
    ["Minusdagi tovarlar soni (tekshirish kerak)", { f: `=COUNTIF(E${n0}:E${n1},"<0")` }],
    [`Hisoblangan: ${stamp}`],
    null,
    [{ v: "Tovar bo'yicha ostatka (prixod − rasxod)", s: 1 }],
    ["Tovar nomi", "O'lchov", "Prixod soni", "Rasxod soni", "Ostatka soni", "O'rtacha kirim narxi (QQS bilan)", "Ostatka summasi (tannarxda)", "Prixod summa", "Rasxod summa", "Holat", "Prixod fakturalari", "Rasxod fakturalari", "Diqqat: har xil o'lchov"].map(H),
    ...res.rows.map((r, i) => {
      const R = n0 + i;
      return [r.name, r.unit, r.pq, r.rq, { f: `=C${R}-D${R}` }, M(r.avg == null ? null : r2(r.avg)), { f: `=IF(F${R}="","",E${R}*F${R})`, s: 3 }, M(r.ps), M(r.rs), r.status, r.pinv, r.rinv, r.unitWarn];
    }),
  ];
  const raw = (title, invs) => {
    const rows = [[{ v: `${title.toUpperCase()} — barcha fakturalar qatorlari`, s: 1 }],
      ["Faktura №", "Sana", "Kontragent", "Tovar nomi", "O'lchov", "Soni", "Narxi", "Summa (QQSsiz)", "QQS stavka", "QQS", "Katalog kodi", "Fayl", "Jami (QQS bilan)"].map(H)];
    for (const inv of [...invs].sort((a, b) => a.date.localeCompare(b.date))) {
      const cp = shortName(inv.kind === "rasxod" ? inv.buyer : inv.supplier);
      for (const l of inv.lines) rows.push([inv.number, { d: inv.date }, cp, l.name, l.unit, l.qty, M(l.price), M(l.sum), l.vat_rate, M(l.vat), l.code, inv.file_name || "", M(l.total)]);
    }
    return { name: title, rows, widths: [11, 11, 26, 55, 9, 9, 14, 16, 8, 14, 20, 30, 16], freeze: 2 };
  };
  return workbook([
    { name: "Ostatka", rows: main, widths: [60, 14, 11, 11, 12, 18, 18, 16, 16, 30, 28, 40, 22], freeze: 8 },
    raw("Prixod", res.prixod), raw("Rasxod", res.rasxod),
  ]);
}

// ---------------------------------------------------------------- чтение ZIP от пользователя

async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const out = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

// → [{ name, bytes }] только .xls/.html/.htm
export async function unzip(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new ParseError("ZIP fayl buzilgan");
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
    const rawName = b.subarray(p + 46, p + 46 + nlen);
    // Windows-архиватор без флага UTF-8 пишет кириллицу в cp866
    const name = new TextDecoder(flags & 0x800 ? "utf-8" : "ibm866").decode(rawName);
    p += 46 + nlen + xlen + clen;
    const base = name.split(/[\\/]/).pop();
    if (!base || !/\.(xls|html?)$/i.test(base)) continue;
    const lstart = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    const data = b.subarray(lstart, lstart + csize);
    if (method === 0) out.push({ name: base, bytes: data });
    else if (method === 8) out.push({ name: base, bytes: await inflateRaw(data) });
  }
  return out;
}
