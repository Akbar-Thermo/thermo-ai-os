/* Usta ro'yxati — tanib olish: usta yozgan qatordan tovar turi, variant, o'lcham va miqdorni topadi.
   Xato yozilgan so'z (1–2 harf), lotin/kirill, o'zbekcha so'zlar — hammasi lug'atdagi umumiy nomga keltiriladi. */
var ENGINE = (function (V) {
  // ---------- matnni tekislash ----------
  var LAT1 = { a: "а", b: "б", c: "ц", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "х", z: "з" };
  var VOW = /[aeiouаеёиоуыэюя]/;
  function translit(w) {
    w = w.replace(/o['ʻ`’]/g, "о").replace(/g['ʻ`’]/g, "г").replace(/['ʻ`’]/g, "");
    var out = "", i = 0;
    while (i < w.length) {
      var two = w.substr(i, 2), ch = w[i];
      var map2 = { sh: "ш", ch: "ч", zh: "ж", kh: "х", ts: "ц", yo: "е", yu: "ю", ya: "я", ye: "е" };
      if (map2[two] && !(two === "ts" && i > 0 && !VOW.test(w[i - 1]) && false)) { out += map2[two]; i += 2; continue; }
      if (ch === "y") { out += i > 0 && VOW.test(w[i - 1]) ? "й" : "ы"; i++; continue; }
      out += LAT1[ch] || ch; i++;
    }
    return out;
  }
  var LOOK = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" };
  function word(w) {
    w = w.replace(/ё/g, "е");
    if (/[a-z]/.test(w) && /[а-я]/.test(w)) w = w.replace(/[a-z]/g, function (c) { return LOOK[c] || c; });
    else if (/[a-z]/.test(w)) w = translit(w);
    return w.replace(/[ьъ]/g, "");
  }
  function base(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е")
      .replace(/[″”“„«»]|''/g, '"').replace(/(\d)\s*(?:x|х|\*|×)\s*(?=\d)/g, "$1×")
      .replace(/(\d)\s+на\s+(?=\d)/g, "$1×");
  }
  var STOP = { "для": 1, "с": 1, "со": 1, "и": 1, "на": 1, "из": 1, "под": 1, "kerak": 1, "керак": 1, "нужно": 1, "надо": 1, "ham": 1, "хам": 1, "va": 1, "ва": 1, "bilan": 1, "билан": 1, "uchun": 1, "учун": 1, "кк": 1, "нужен": 1, "нужна": 1, "нужны": 1, "kerakli": 1, "керакли": 1, "пожалуйста": 1, "iltimos": 1, "илтимос": 1, "yana": 1, "яна": 1, "еще": 1, "тоже": 1, "шт": 1, "штук": 1, "ta": 1, "та": 1, "dona": 1, "дона": 1, "kotelga": 1 };
  // ko'p ishlatiladigan tovarlar teng holatda oldinda chiqadi
  var POP = { "Тройник ППР": 4, "Труба ППР PN20 (горячая вода)": 4, "Труба ППР PN25 армированная": 3, "Отвод ППР (угол)": 4, "Муфта ППР": 4, "Кран шаровой": 4, "Радиатор панельный": 3, "Коллектор распределительный": 3, "Американка ППР": 3, "Адаптер ППР с резьбой (муфта комбинированная)": 3, "Котёл газовый настенный": 3, "Насос циркуляционный": 3, "Бак расширительный (отопление)": 3, "Труба металлопластиковая": 2, "Заглушка ППР": 2, "Клипса ППР (крепление трубы)": 2, "Муфта ППР переходная": 2 };

  // ---------- o'lcham va miqdor ----------
  var UNIT_W = [
    [/^(шт|штук|штуки|штука|ta|та|dona|дона|дан|sht|pcs)\.?$/, ""],
    [/^(м|м\.|метр|метра|метров|metr|m|pm|п\.?м|пог)$/, "м"],
    [/^(комп|компл|комплект|komplekt|kompl|komp|набор)\.?$/, "комп"],
    [/^(секц|секция|секции|секций|seksiya|sekciya|sektsiya|sek)\.?$/, "секц"],
    [/^(м2|м²|кв\.?м|kv\.?m)$/, "м²"],
    [/^(рулон|rulon|пачка|pachka|уп|упак|кг|kg)\.?$/, "*"],
  ];
  // raqamdan keyingi o'lcham birligi: 24 kvt, 50 l, 15 mm, 6 bar, 5 vixod
  function SUF(t) {
    t = t.replace(/\.$/, "");
    if (/^(квт|kvt|kw|кв|kvt)$/.test(t)) return "кВт";
    if (/^(л|l|литр|litr|lit)$/.test(t)) return "л";
    if (/^(мм|mm)$/.test(t)) return "мм";
    if (/^(см|sm|cm)$/.test(t)) return "см";
    if (/^(бар|bar)$/.test(t)) return "бар";
    if (/^(ва|va)$/.test(t)) return "ВА";
    if (/^(а|a|amper|ампер)$/.test(t)) return "А";
    if (/^(вых|выход|выхода|выходов|vixod|vыход|vihod|chiqish|chiqishli|чикиш)$/.test(t)) return "вых.";
    if (/^(гр|градус|gradus|°)$/.test(t)) return "°";
    return "";
  }
  function unitOf(t) { for (var i = 0; i < UNIT_W.length; i++) if (UNIT_W[i][0].test(t)) return UNIT_W[i][1] === "*" ? t.replace(/\.$/, "") : UNIT_W[i][1]; return null; }
  function sizeKey(s) {
    return String(s).toLowerCase().replace(/ё/g, "е").replace(/[″”"]/g, "").replace(/^тип\s*/, "").replace(/\s*(квт|л|мм|см|м|вых\.?|ва|а|бар|°)$/g, "")
      .replace(/\s+/g, " ").replace(/,/g, ".").replace(/х|x|\*/g, "×").trim();
  }
  // "1.1/4", "1-1/4", "1 1/4" → "1 1/4"
  function fixFrac(s) { return s.replace(/(^|[^\d\/])(\d)\s*[\.\-,]?\s*(1\/4|1\/2|3\/4)(?!\d)/g, "$1$2 $3"); }
  // qatordan: { words: [...], sizes: [...], qty, unit }
  function parse(line) {
    var s = fixFrac(base(line));
    s = s.replace(/(\d)\s*(ta|та|dona|дона|шт|штук|sht|m|м|метр|metr|комп|компл|kompl|секц)(?![a-zа-я])/g, "$1 $2");
    s = s.replace(/(\d)\s*(?:дюйм|duym|dyuym|дм)/g, '$1"');
    // qisman so'z oxirida raqam: "dn50", "ду50", "d20", "ø20"
    s = s.replace(/(^|\s)(?:dn|ду|ду\.|d|ф|ø)\s?(\d{2,3})(?=\s|$)/g, function (m, a, n) { return a + (Number(n) >= 50 && /dn|ду/.test(m) ? "dn" + n : n); });
    var raw = s.split(/[\s,;:=]+|(?<=[^\d])-(?=\d)|(?<=\d)-(?=\D)|—|–/).filter(Boolean);
    var toks = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (/^\d$/.test(t) && /^(1\/4|1\/2|3\/4)"?$/.test(raw[i + 1] || "")) { toks.push(t + " " + raw[i + 1]); i++; continue; }
      toks.push(t);
    }
    var words = [], sizes = [], qty = null, unit = null, nums = [];
    for (var j = 0; j < toks.length; j++) {
      var t2 = toks[j].replace(/^[(\[]+|[)\].]+$/g, "");
      if (!t2) continue;
      var u = unitOf(t2);
      if (u !== null) {
        var prev = nums.length ? nums[nums.length - 1] : null;
        if (prev && prev.j === j - 1 && /^\d+([.,]\d+)?$/.test(prev.v)) { qty = Number(prev.v.replace(",", ".")); unit = u || unit; nums.pop(); sizes.pop(); }
        else if (u) unit = u;
        continue;
      }
      if (/^x\d+$|^×\d+$/.test(t2) && j === toks.length - 1) { qty = Number(t2.slice(1)); continue; }
      var su = SUF(t2);
      if (su && nums.length && nums[nums.length - 1].j === j - 1 && /^\d+([.,]\d+)?$/.test(nums[nums.length - 1].v)) {
        var nv = nums[nums.length - 1].v.replace(".", ",") + " " + su; nums[nums.length - 1].v = nv; sizes[sizes.length - 1] = nv; continue;
      }
      if (/\d/.test(t2) && /^[\d\/×".,\s-]+$|^dn\d+$|^м\d+$|^\d+-\d+$/.test(t2)) {
        var v = t2.replace(/^м(\d+)$/, "М$1").replace(/^dn/, "DN");
        sizes.push(v); nums.push({ v: v, j: j });
        continue;
      }
      if (/^\d+([.,]\d+)?(мм|mm|см|sm|cm|л|l|квт|kvt|kw|кв|ва|va|бар|bar|а|a|вых|vixod|chiqish|гр)\.?$/.test(t2)) {
        var n = t2.match(/^\d+([.,]\d+)?/)[0], rest = t2.slice(n.length).replace(/\.$/, "");
        var sv = n + " " + (SUF(rest) || rest); sizes.push(sv); nums.push({ v: sv, j: j });
        continue;
      }
      var w = word(t2.replace(/[^a-zа-я0-9\/'ʻ`’-]/g, ""));
      if (w && !STOP[w]) words.push(w);
    }
    return { words: words, sizes: sizes, qty: qty, unit: unit };
  }

  // ---------- so'zlarni solishtirish ----------
  function dl(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 0; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      var rowMin = 1e9;
      for (j = 1; j <= b.length; j++) {
        var c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        if (d[i][j] < rowMin) rowMin = d[i][j];
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }
  function sim(w, a, last) {
    if (w === a) return 1;
    if (w.length >= 2 && a.indexOf(w) === 0) return (last ? 0.9 : 0.8) + 0.1 * (w.length / a.length);
    if (a.length >= 4 && w.indexOf(a) === 0 && w.length - a.length <= 3) return 0.85;
    if (w.length >= 4) {
      var d = dl(w, a, 2);
      if (d === 1) return 0.78;
      if (d === 2 && w.length >= 7) return 0.62;
      if (last && a.length > w.length && dl(w, a.slice(0, w.length), 1) <= 1) return 0.66;
    }
    return 0;
  }
  // ---------- indeks ----------
  var ITEMS = V.ITEMS.map(function (r, idx) {
    var al = [r[1].replace(/[()\/,]/g, " ")].concat(r[2].split("|"));
    var aliases = al.map(function (a) { return base(a).split(/[\s\-]+/).map(word).filter(function (x) { return x && !STOP[x] && !/^\d/.test(x); }); }).filter(function (x) { return x.length; });
    var vars = (r[4] || []).map(function (g) {
      return g.map(function (opt) {
        var keys = [opt].concat(((V.VAR_ALIAS[opt] || "") + "").split(" ")).filter(Boolean).map(function (k) { return word(base(k).replace(/[\s\-]+/g, "/")); });
        if (/\//.test(opt)) keys.push(word(base(opt).replace(/\//g, "")));
        base(opt).split(/[\s()]+/).forEach(function (w0) { var w1 = word(w0); if (w1.length >= 4 && !STOP[w1]) keys.push(w1); });
        var num = /\d/.test(opt) ? sizeKey(opt) : "", un = /\d/.test(opt) ? opt.replace(/[\d\s,.\/×-]/g, "") : "";
        return { opt: opt, keys: keys, num: num, unit: un, bare: /^(|°|тип|"+)$/.test(un) };
      });
    });
    var sizes = (r[3] || []).map(function (s) { return { s: s, k: sizeKey(s) }; });
    return { i: idx, cat: r[0], name: r[1], sizes: sizes, vars: vars, unit: r[5] || "шт", aliases: aliases };
  });
  var DICT = {}; // hamma so'zlar (avtomatik davom ettirish uchun)
  // faqat tovar nomlaridagi so'zlar (ko'rsatishga yaroqli ruscha so'zlar)
  var SHOW = {}; // tekislangan so'z → ko'rsatiladigan shakli (ниппел → ниппель)
  ITEMS.forEach(function (it) { base(it.name).replace(/[()\/,]/g, " ").split(/[\s\-]+/).forEach(function (w0) { var w = word(w0); if (w.length >= 4 && /^[а-я]+$/.test(w)) { DICT[w] = (DICT[w] || 0) + 1 + (POP[it.name] || 0); SHOW[w] = w0; } }); });

  function textScore(it, words) {
    if (!words.length) return 0;
    var best = 0, bestCov = 0;
    for (var k = 0; k < it.aliases.length; k++) {
      var A = it.aliases[k], used = {}, sum = 0, miss = 0;
      for (var q = 0; q < words.length; q++) {
        var bw = 0, bj = -1;
        for (var j = 0; j < A.length; j++) { var v = sim(words[q], A[j], q === words.length - 1); if (v > bw) { bw = v; bj = j; } }
        if (bj >= 0) used[bj] = 1; else miss++;
        sum += bw;
      }
      var cov = Object.keys(used).length / A.length;
      var hitN = words.length - miss; if (!hitN) continue;
      var sc = (sum / hitN) * (0.82 + 0.18 * cov) - 0.14 * miss;
      if (sc > best || (sc === best && cov > bestCov)) { best = sc; bestCov = cov; }
    }
    return best;
  }
  // variantlar: so'zlar ichidan topish (1–3 so'zli bo'lak)
  function takeVars(it, words) {
    var chosen = [], left = words.slice();
    it.vars.forEach(function (g, gi) {
      for (var len = 3; len >= 1; len--) {
        for (var s = 0; s + len <= left.length; s++) {
          var a = left.slice(s, s + len), k1 = a.join("/"), k2 = a.join("");
          for (var o = 0; o < g.length; o++) {
            if (g[o].keys.indexOf(k1) >= 0 || g[o].keys.indexOf(k2) >= 0) { chosen[gi] = g[o].opt; left.splice(s, len); return; }
            if (len === 1 && k1.length >= 5 && g[o].keys.some(function (k) { return k.length >= 5 && dl(k1, k, k1.length >= 9 ? 2 : 1) <= (k1.length >= 9 ? 2 : 1); })) { chosen[gi] = g[o].opt; left.splice(s, len); return; }
          }
        }
      }
    });
    return { chosen: chosen, left: left };
  }
  // o'lcham: qatordagi raqamlardan tovarning o'lchamlariga mosini topish
  function takeSize(it, sizes, qtyKnown) {
    var res = { size: "", used: 0, matched: false, extraVars: [] };
    if (!sizes.length) return res;
    var keys = sizes.map(sizeKey);
    var tries = [];
    for (var len = Math.min(3, keys.length); len >= 1; len--) for (var s = 0; s + len <= keys.length; s++) { tries.push({ s: s, len: len, k: keys.slice(s, s + len).join("×") }); if (len > 1) tries.push({ s: s, len: len, k: keys.slice(s, s + len).join(" ") }); }
    for (var t = 0; t < tries.length; t++) {
      for (var z = 0; z < it.sizes.length; z++) if (it.sizes[z].k === tries[t].k) { res.size = it.sizes[z].s; res.used = tries[t]; res.matched = true; return res; }
    }
    // bitta raqam o'lchamning boshi bo'lsa va bunday o'lcham bitta bo'lsa: 16 → 16×2, 20 → 20×1/2"
    for (var u = 0; u < keys.length; u++) {
      var hit = it.sizes.filter(function (z) { return z.k.indexOf(keys[u] + "×") === 0 || z.k.indexOf(keys[u] + " ") === 0; });
      if (hit.length === 1) { res.size = hit[0].s; res.used = { s: u, len: 1 }; res.matched = true; return res; }
    }
    // o'lchamlari bor tovar, mos kelmadi: yozilganini o'zgartirmasdan qoldiramiz
    return res;
  }
  function prettySize(v) {
    return v.replace(/(^|×)(\d+ )?(1\/4|1\/2|3\/4|3\/8)(?!")/g, '$1$2$3"').replace(/(^|×)(\d)(?=×|$)/g, function (m, a, d) { return a + d; });
  }
  // asosiy: qatorni tushunish → eng yaxshi variantlar
  function suggest(line, limit) {
    var P = parse(line);
    var out = [];
    ITEMS.forEach(function (it) {
      var tv = takeVars(it, P.words);
      var ts = textScore(it, tv.left.length ? tv.left : P.words);
      if (ts < 0.45) return;
      var sz = takeSize(it, P.sizes);
      var score = ts;
      if (P.sizes.length && it.sizes.length) score += sz.matched ? 0.12 : -0.12;
      score += tv.chosen.filter(Boolean).length * 0.03;
      score += (POP[it.name] || 0) * 0.008 - it.i * 0.00005; // teng bo'lsa — ko'p ishlatiladigani, keyin lug'atdagi tartib
      // qolgan raqamlar: miqdor yoki o'lcham
      var restSizes = P.sizes.slice();
      if (sz.matched) restSizes.splice(sz.used.s, sz.used.len);
      var qty = P.qty, size = sz.size, unit = P.unit || it.unit, vars = tv.chosen.slice();
      // raqamli variant: 45 → 45°, 15 мм, 5 вых., тип 22
      it.vars.forEach(function (g, gi) {
        if (vars[gi]) return;
        for (var r = 0; r < restSizes.length; r++) {
          var tk = sizeKey(restSizes[r]), tu = String(restSizes[r]).replace(/[\d\s,.\/×"-]/g, "");
          var o = g.find(function (x) { return x.num && x.num === tk && (tu ? tu === x.unit : x.bare); });
          if (o) { vars[gi] = o.opt; restSizes.splice(r, 1); score += 0.03; return; }
        }
      });
      // "1.5 m" shlang: miqdor emas, uzunlik (tovar donada sotiladi)
      if (qty != null && P.unit && P.unit !== it.unit) {
        var qk = sizeKey(String(qty)), zz = it.sizes.find(function (z) { return z.k === qk; });
        if (!size && zz) { size = zz.s; qty = null; unit = it.unit; }
        else it.vars.forEach(function (g, gi) { if (qty == null || vars[gi]) return; var o = g.find(function (x) { return x.num === qk && x.unit === P.unit; }); if (o) { vars[gi] = o.opt; qty = null; unit = it.unit; } });
      }
      if (qty == null && restSizes.length && /^\d+([.,]\d+)?$/.test(restSizes[restSizes.length - 1]) && (sz.matched || !it.sizes.length || restSizes.length > 1)) qty = Number(restSizes.pop().replace(",", "."));
      if (!size && restSizes.length) { size = prettySize(restSizes.join("×")); }
      out.push({ it: it, score: score, vars: vars, size: size, sizeOk: !!sz.matched, qty: qty, unit: unit });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    // bir xil turdagi takrorlarni olib tashlash
    return out.slice(0, limit || 6);
  }
  // qatorni ko'rsatish matni
  function lineText(r) {
    var parts = [r.name || r.it.name];
    (r.vars || []).forEach(function (v) { if (v) parts.push(v); });
    if (r.size) parts.push(r.size);
    return parts.join(" ");
  }
  // oxirgi so'zni davom ettirish (telefon klaviaturasidagi kabi)
  function complete(line) {
    var m = String(line).match(/([^\s\d]+)$/);
    if (!m || m[1].length < 2 || unitOf(m[1].toLowerCase()) !== null || SUF(m[1].toLowerCase())) return [];
    var w = word(base(m[1])), res = [];
    if (STOP[w]) return [];
    Object.keys(DICT).forEach(function (d) { if (d !== w && d.indexOf(w) === 0 && d.length > w.length + 1) res.push([d, DICT[d]]); });
    res.sort(function (a, b) { return b[1] - a[1] || a[0].length - b[0].length; });
    return res.slice(0, 3).map(function (x) { return SHOW[x[0]] || x[0]; });
  }
  function parseQty(v) { var n = Number(String(v).replace(",", ".").replace(/[^\d.]/g, "")); return n > 0 ? n : 0; }
  return { suggest: suggest, parse: parse, lineText: lineText, complete: complete, items: ITEMS, cats: V.CATS, sizeKey: sizeKey, parseQty: parseQty, word: word };
})(VOCAB);
if (typeof module !== "undefined") module.exports = ENGINE;
