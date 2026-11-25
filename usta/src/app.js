/* Usta ro'yxati — sahifa. Ma'lumot: localStorage (qoralama, ism/telefon, oldingi ro'yxatlar), yuborish — usta_submit (Supabase). */
(function () {
  var CFG = window.USTA_CFG || {};
  var E = ENGINE;
  // ?preview=1 — rahbar ustaning sahifasini oldindan ko'radi: hech narsa yuborilmaydi, ma'lumot alohida saqlanadi
  var PREVIEW = /[?&]preview=1\b/.test(location.search);
  var KP = PREVIEW ? "usta.pv." : "usta.v1.";
  var K = { draft: KP + "draft", who: KP + "who", lang: "usta.v1.lang", hist: KP + "hist", key: KP + "key", lists: KP + "lists", sf: KP + "sf" };
  var load = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
  var store = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
  var draft = load(K.draft, {});
  // личная ссылка мастера: /usta/?k=КОД — имя и телефон подставляются сами, список приходит к нам «от его аккаунта»
  // yangi ko'rinish: /zokir-aka-k7m2p9x4qr8t (ustaning ismi + kod) — «usta» so'zisiz
  var urlKey = ""; try { urlKey = (new URLSearchParams(location.search).get("k") || "").trim(); var pm = location.pathname.match(/^\/([a-z0-9-]{1,40}-[a-z0-9]{12})\/?$/); if (!urlKey && pm) urlKey = pm[1]; } catch (e) {}
  var S = {
    lang: load(K.lang, (navigator.language || "").indexOf("ru") === 0 ? "ru" : "uz"),
    who: load(K.who, { name: "", phone: "" }), editWho: false,
    key: urlKey || load(K.key, ""), me: null, keyBad: false,
    listId: draft.listId || uid(),
    object: draft.object || "", note: draft.note || "", lines: Array.isArray(draft.lines) ? draft.lines : [],
    secs: Array.isArray(draft.secs) ? draft.secs : [], cur: draft.cur || "", view: "list",
    hist: load(K.hist, []), lists: load(K.lists, []), fresh: null, sending: false,
    sfs: (load(K.sf, {}).sfs || []), sbr: (load(K.sf, {}).sbr || {}),
  };
  if (!S.key && (!S.who.name || !S.who.phone)) S.editWho = true;
  var T = function (k) { return (I18N[S.lang] || I18N.uz)[k] || k; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  var fmtQ = function (n) { return n == null || n === "" ? "?" : String(Math.round(Number(n) * 1000) / 1000).replace(".", ","); };
  // черновик + он же в «Мои списки» (несколько списков хранятся в телефоне мастера)
  var save = function () {
    store(K.draft, { listId: S.listId, object: S.object, note: S.note, lines: S.lines, secs: S.secs, cur: S.cur });
    var rest = S.lists.filter(function (x) { return x.id !== S.listId; });
    if (S.lines.length || S.object.trim()) rest.unshift({ id: S.listId, at: Date.now(), object: S.object, note: S.note, lines: S.lines, secs: S.secs });
    S.lists = rest.slice(0, 50); store(K.lists, S.lists);
  };
  // количество можно считать: «12+8+6», «3*4», «2,5x4», «(2+3)*4»
  function calcQty(v) {
    var t = String(v == null ? "" : v).trim().replace(/,/g, ".").replace(/[xх×]/gi, "*").replace(/÷|:/g, "/").replace(/\s+/g, "");
    if (!t) return 0;
    if (!/^[\d.+\-*/()]+$/.test(t)) return E.parseQty(v);
    try { var n = Function('"use strict";return (' + t + ")")(); n = Math.round(Number(n) * 1000) / 1000; return isFinite(n) && n > 0 ? n : 0; } catch (e) { return 0; }
  }
  var isExpr = function (v) { return /\d\s*[+\-*/xх×]\s*[\d(]/i.test(String(v || "")); };
  // kompyuter: keng ekran — programmadagidek ko'rinish (shapka, jadval, o'ng panel); telefon — eskicha
  var DESK = window.matchMedia ? window.matchMedia("(min-width: 900px)") : { matches: false };
  var isDesk = function () { return !!DESK.matches; };
  // ---------- tovarlar bazasi (programmadagi «Товары», narxsiz) — faqat kompyuterda va shaxsiy havola bilan ----------
  // qidiruv programmadagidek: hamma so'zlar istalgan tartibda nomda/kodda/qo'shimcha nomlarda bo'lsa topiladi; lotincha ham («truba 25»)
  var BASE = null, baseLoading = false, SUPS = [], SUPN = {}, SUPC = {}, SUPB = {};
  // postavshik filtri (programmadagidek): belgilangan postavshiklar va ularning ichida brendlar
  var KB_RU = "йцукенгшщзхъфывапролджэячсмитьбюё", KB_EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
  function kbConv(str, from, to) { return String(str || "").toLowerCase().split("").map(function (c) { var i = from.indexOf(c); return i >= 0 ? to[i] : c; }).join(""); }
  function kbVariants(q) { var t = String(q || "").trim().toLowerCase(); if (!t) return []; var a = [t, kbConv(t, KB_RU, KB_EN), kbConv(t, KB_EN, KB_RU)]; return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function brandOf(b, sup) { b = String(b || "").trim(); return b && b.toLowerCase() !== String(sup || "").trim().toLowerCase() ? b : ""; }
  var TR_MAP = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o‘", қ: "q", ғ: "g‘", ҳ: "h" };
  function translit(t) { return t.replace(/[а-яёўқғҳ]/g, function (c) { return TR_MAP[c] != null ? TR_MAP[c] : c; }); }
  function baseText(r, supName) {
    var t = [r[1], r[5], r[6], r[4], r[3], supName].filter(Boolean).join(" ").toLowerCase().replace(/ё/g, "е");
    return t + " " + t.replace(/[\s\-_."']+/g, "") + (/[а-яё]/.test(t) ? " " + translit(t) : "");
  }
  function loadBase() {
    if (BASE || baseLoading || !S.me || !isDesk()) return;
    baseLoading = true;
    fetch(CFG.url + "/rest/v1/rpc/usta_catalog", {
      method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.key, Authorization: "Bearer " + CFG.key },
      body: JSON.stringify({ p_key: S.key }),
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      baseLoading = false;
      var rows = Array.isArray(j) ? j : j && Array.isArray(j.p) ? j.p : null;
      if (!rows || !rows.length) return;
      SUPS = j && Array.isArray(j.s) ? j.s.map(function (x) { return { id: x[0], name: x[1] }; }) : [];
      SUPN = {}; SUPS.forEach(function (x) { SUPN[x.id] = x.name; });
      BASE = rows.map(function (r) { var sup = r[7] || ""; return { id: r[0], name: r[1], unit: r[2] || "шт", brand: r[3] || "", size: r[4] || "", code: r[6] || "", sup: sup, t: baseText(r, SUPN[sup]) }; });
      SUPC = {}; var bm = {};
      BASE.forEach(function (p) { if (!p.sup) return; SUPC[p.sup] = (SUPC[p.sup] || 0) + 1; var x = (bm[p.sup] = bm[p.sup] || {}); var b = String(p.brand || "").trim(); x[b] = (x[b] || 0) + 1; });
      SUPB = {}; Object.keys(bm).forEach(function (id) { SUPB[id] = Object.keys(bm[id]).map(function (b) { return { b: b, n: bm[id][b] }; }).sort(function (a, c) { return c.n - a.n || a.b.localeCompare(c.b); }); });
      // postavshiklar — lotincha nomi bo'yicha alifbo tartibida (programmadagidek)
      SUPS.sort(function (a, b) { return translit(a.name.toLowerCase()).localeCompare(translit(b.name.toLowerCase()), "en", { numeric: true, sensitivity: "base" }); });
      S.sfs = S.sfs.filter(function (id) { return SUPN[id]; });
      if (isDesk()) { var c = $("bCat"); if (c) c.style.display = "none"; renderSupF(); renderSug(); }
    }).catch(function () { baseLoading = false; });
  }
  function baseFind(q) {
    var w = q.toLowerCase().replace(/ё/g, "е").trim().split(/\s+/).filter(Boolean);
    var sf = S.sfs.length > 0;
    if (!w.length && !sf) return [];
    var sfSet = {}; S.sfs.forEach(function (id) { sfSet[id] = 1; });
    var out = [];
    for (var i = 0; i < BASE.length; i++) {
      var p = BASE[i];
      if (sf && !sfSet[p.sup]) continue;
      var bf = S.sbr[p.sup]; if (bf && bf.length && bf.indexOf(String(p.brand || "").trim()) < 0) continue;
      var t = p.t, ok = true; for (var k = 0; k < w.length; k++) if (t.indexOf(w[k]) < 0) { ok = false; break; } if (ok) out.push(p);
    }
    return out;
  }
  function fromBase(p) { return { name: p.name, vars: [], size: "", qty: null, unit: p.unit, raw: "", known: true, cat: "", ii: -1, pid: p.id, brand: [p.code, brandOf(p.brand, SUPN[p.sup]), SUPN[p.sup]].filter(Boolean).join(" · ") }; }
  var digits = function (p) { return String(p || "").replace(/\D/g, ""); };
  function toast(msg) {
    var t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  function lineLabel(l) { return [l.name].concat(l.vars || []).filter(Boolean).join(" ") + (l.size ? " " + l.size : ""); }

  // ---------- skelet ----------
  function shell() {
    document.documentElement.lang = S.lang;
    document.title = T("title") + " — Thermo";
    document.body.classList.toggle("desk", isDesk());
    if (isDesk()) $("app").innerHTML =
      (PREVIEW ? '<div class="pvbar">' + esc(T("previewBar")) + "</div>" : "") +
      '<div class="dk"><header class="dh"><div class="dlogo">THERMO<span>•</span>ENGINEERING</div><div class="dtt">' + esc(T("title")) + '</div>' +
      '<div class="dwho" id="who"></div>' +
      '<div class="lang"><button data-l="uz" class="' + (S.lang === "uz" ? "on" : "") + '">UZ</button><button data-l="ru" class="' + (S.lang === "ru" ? "on" : "") + '">RU</button></div></header>' +
      '<div class="dbody">' +
      '<div class="dph"><h2>' + esc(T("title")) + '</h2><button class="btn" id="bHist">☰ ' + esc(T("myLists")) + '</button><button class="btn" id="bNew">+ ' + esc(T("newList")) + '</button></div>' +
      '<div class="card dobjc"><div id="whoCard"></div><div class="dgrid"><div class="fld"><label for="obj">' + esc(T("object")) + '</label><input class="inp" id="obj" placeholder="' + esc(T("objectPh")) + '" value="' + esc(S.object) + '" maxlength="200"></div>' +
      '<div class="fld"><label for="note">' + esc(T("note")) + '</label><input class="inp" id="note" placeholder="' + esc(T("notePh")) + '" value="' + esc(S.note) + '" maxlength="1000"></div></div></div>' +
      '<div class="card dpick"><div class="row dpickh"><h3>' + esc(T("pickT")) + '</h3><button class="btn" id="bCat">☰ ' + esc(T("catalog")) + '</button><button class="btn" id="bPaste">⧉ ' + esc(T("paste")) + '</button></div>' +
      '<div id="secbar"></div>' +
      '<div class="dsrch"><div class="srow"><div id="supf" class="supf"></div><input class="inp" id="q" placeholder="' + esc(T("searchPh")) + '" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div><div class="sug dsug" id="sug"></div></div>' +
      '<div id="list"></div>' +
      '<div class="row dfoot"><button class="btn xs" id="bManual">+ ' + esc(T("manualAdd")) + '</button><b class="dcount" id="dcount"></b></div>' +
      '<div class="row dact"><button class="btn" id="bClear">' + esc(T("clear")) + '</button><button class="btn pri" id="bSend"></button></div>' +
      '</div></div></div>';
    else $("app").innerHTML =
      (PREVIEW ? '<div class="pvbar">' + esc(T("previewBar")) + "</div>" : "") +
      '<div class="wrap">' +
      '<div class="top"><div class="logo">T</div><div><h1>' + esc(T("title")) + '</h1><div class="s">' + esc(T("sub")) + '</div></div>' +
      '<div class="lang"><button data-l="uz" class="' + (S.lang === "uz" ? "on" : "") + '">UZ</button><button data-l="ru" class="' + (S.lang === "ru" ? "on" : "") + '">RU</button></div></div>' +
      '<div class="card" id="who"></div>' +
      '<div class="card"><div class="lbl">' + esc(T("object")) + '</div><input class="inp" id="obj" placeholder="' + esc(T("objectPh")) + '" value="' + esc(S.object) + '" maxlength="200"></div>' +
      '<div class="tools"><button class="btn" id="bCat">☰ ' + esc(T("catalog")) + '</button><button class="btn" id="bPaste">⧉ ' + esc(T("paste")) + '</button></div>' +
      '<div id="secbar"></div>' +
      '<div id="list"></div>' +
      '<div class="card" id="noteBox"><div class="lbl">' + esc(T("note")) + '</div><input class="inp" id="note" placeholder="' + esc(T("notePh")) + '" value="' + esc(S.note) + '" maxlength="1000"></div>' +
      '<div class="row" style="justify-content:space-between;margin-top:6px"><button class="link" id="bHist" style="margin-left:0">☰ ' + esc(T("myLists")) + '</button><button class="link" id="bNew">+ ' + esc(T("newList")) + '</button><button class="link" id="bClear">' + esc(T("clear")) + '</button></div>' +
      '</div>' +
      '<div class="dock"><div class="in"><div class="sug" id="sug"></div>' +
      '<div class="compose"><input class="inp" id="q" placeholder="' + esc(T("inputPh")) + '" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"><button class="btn pri" id="bAdd" aria-label="' + esc(T("add")) + '">+</button></div>' +
      '<div class="sendbar"><button class="btn pri big" id="bSend"></button></div></div></div>';
    document.querySelectorAll(".lang button").forEach(function (b) { b.onclick = function () { S.lang = b.dataset.l; store(K.lang, S.lang); shell(); }; });
    $("obj").oninput = function (e) { S.object = e.target.value; save(); };
    $("note").oninput = function (e) { S.note = e.target.value; save(); };
    $("bCat").onclick = function () { openCatalog(); };
    $("bPaste").onclick = openPaste;
    if ($("bHist")) $("bHist").onclick = openHistory;
    $("bNew").onclick = newList;
    $("bClear").onclick = function () { if (!S.lines.length) return; confirmSheet(T("clearQ"), function () { S.lines = []; S.secs = []; S.cur = ""; S.view = "list"; save(); renderSecs(); renderList(); }); };
    var q = $("q");
    q.oninput = function () { S.hi = BASE ? -1 : 0; S.pend = null; renderSug(); };
    q.onfocus = function () { if (isDesk()) renderSug(); };
    q.onkeydown = function (e) {
      if (isDesk() && BASE) {
        if (e.key === "ArrowDown") { e.preventDefault(); moveBaseHi(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); moveBaseHi(-1); }
        else if (e.key === "PageDown") { e.preventDefault(); moveBaseHi(7); }
        else if (e.key === "PageUp") { e.preventDefault(); moveBaseHi(-7); }
        else if (e.key === "Enter") { e.preventDefault(); if (S.hi != null && S.hi >= 0 && baseHits[S.hi]) pickK(S.hi); }
        else if (e.key === "Escape") { e.preventDefault(); q.value = ""; S.hi = -1; renderSug(); }
        return;
      }
      if (isDesk() && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        var n = $("sug").querySelectorAll(".fr").length; if (!n) return;
        e.preventDefault(); S.hi = ((S.hi || 0) + (e.key === "ArrowDown" ? 1 : -1) + n) % n; paintHi(); return;
      }
      if (isDesk() && e.key === "Escape") { q.value = ""; renderSug(); return; }
      if (e.key === "Enter") { e.preventDefault(); if (isDesk()) pickK(S.hi || 0); else acceptTop(); }
    };
    q.onpaste = function (e) {
      var txt = (e.clipboardData || window.clipboardData).getData("text") || "";
      if (/\n/.test(txt.trim())) { e.preventDefault(); addMany(txt); }
    };
    if ($("bAdd")) $("bAdd").onclick = acceptTop;
    if ($("bManual")) $("bManual").onclick = function () { openPicker({ name: "", vars: [], size: "", qty: null, unit: "шт", raw: "", known: false, cat: "", ii: -1 }, true); };
    $("bSend").onclick = send;
    renderWho(); renderSecs(); renderList(); renderSug(); renderLists();
    if (isDesk() && !S.lines.length) setTimeout(function () { var q = $("q"); if (q) q.focus(); }, 0);
    if (isDesk() && BASE) { var bc = $("bCat"); if (bc) bc.style.display = "none"; }
    renderSupF();
    loadBase();
  }
  if (DESK.addEventListener) DESK.addEventListener("change", function () { closeSheet(); shell(); });
  // ---------- bo'limlar (qavat, xona…) va «Jami» ----------
  function secName(id) { var x = S.secs.find(function (s) { return s.id === id; }); return x ? x.name : T("noSec"); }
  function renderSecs() {
    var b = $("secbar"); if (!b) return;
    var h = '<div class="secbar"><div class="chips">';
    if (S.secs.length) {
      h += '<button class="chip' + (!S.cur ? " on" : "") + '" data-sec="">' + esc(T("noSec")) + "</button>";
      h += S.secs.map(function (x) { return '<button class="chip' + (S.cur === x.id ? " on" : "") + '" data-sec="' + x.id + '">' + esc(x.name) + "</button>"; }).join("");
    }
    h += '<button class="chip add" id="bSecAdd">+ ' + esc(T("addSec")) + "</button></div>";
    if (S.secs.length) h += '<div class="seg"><button class="' + (S.view === "list" ? "on" : "") + '" data-v="list">' + esc(T("viewList")) + '</button><button class="' + (S.view === "total" ? "on" : "") + '" data-v="total">Σ ' + esc(T("viewTotal")) + "</button></div>";
    b.innerHTML = h + "</div>";
    b.querySelectorAll("[data-sec]").forEach(function (c) { c.onclick = function () { var id = c.dataset.sec; if (id && S.cur === id) return editSec(id); S.cur = id; S.view = "list"; save(); renderSecs(); renderList(); }; });
    b.querySelectorAll("[data-v]").forEach(function (c) { c.onclick = function () { S.view = c.dataset.v; renderSecs(); renderList(); }; });
    $("bSecAdd").onclick = function () { editSec(null); };
  }
  function editSec(id) {
    var x = id ? S.secs.find(function (s) { return s.id === id; }) : null;
    sheet('<h3>' + esc(x ? T("secEdit") : T("addSec")) + '</h3><div class="d">' + esc(T("secD")) + '</div><input class="inp" id="sN" maxlength="40" placeholder="' + esc(T("secPh")) + '" value="' + esc(x ? x.name : "") + '">' +
      '<div class="acts">' + (x ? '<button class="btn" id="sDel">' + esc(T("del")) + "</button>" : '<button class="btn" id="sC">' + esc(T("cancel")) + "</button>") + '<button class="btn pri" id="sOk">' + esc(T("save")) + "</button></div>", function () {
      var n = $("sN"); setTimeout(function () { n.focus(); }, 60);
      var ok = function () { var v = n.value.trim(); if (!v) return; if (x) x.name = v; else { var s2 = { id: uid(), name: v }; S.secs.push(s2); S.cur = s2.id; } S.view = "list"; save(); closeSheet(); renderSecs(); renderList(); };
      n.onkeydown = function (e) { if (e.key === "Enter") ok(); };
      $("sOk").onclick = ok;
      if ($("sC")) $("sC").onclick = closeSheet;
      if ($("sDel")) $("sDel").onclick = function () {
        // bo'lim o'chirilsa, tovarlari yo'qolmaydi — «bo'limsiz»ga o'tadi
        S.lines.forEach(function (l) { if (l.sec === x.id) l.sec = ""; });
        S.secs = S.secs.filter(function (s) { return s.id !== x.id; }); if (S.cur === x.id) S.cur = ""; save(); closeSheet(); renderSecs(); renderList();
      };
    });
  }
  // jami: hamma bo'limlardagi bir xil tovar qo'shiladi (shu ro'yxat bizga yuboriladi)
  function totals() {
    var out = [];
    S.lines.forEach(function (l) {
      var key = (l.pid ? "p:" + l.pid : (l.known ? "k:" : "f:") + lineLabel(l).toLowerCase()) + "|" + (l.unit || "");
      var t = out.find(function (x) { return x._k === key; });
      if (t) { t.qty = Math.round(((Number(t.qty) || 0) + (Number(l.qty) || 0)) * 1000) / 1000; t.n++; }
      else out.push(Object.assign({}, l, { _k: key, n: 1, sec: "" }));
    });
    return out;
  }

  function renderWho() {
    var w = $("who");
    if (isDesk()) {
      var wc = $("whoCard"); wc.innerHTML = "";
      if (S.me) { w.innerHTML = '<span class="dwn">' + esc(S.me.name) + '</span><span class="tag ok">✓ ' + esc(T("myLink")) + "</span>"; return; }
      if (!S.editWho) { w.innerHTML = '<span class="dwn">' + esc(S.who.name) + '</span><span class="xs">' + esc(S.who.phone) + '</span><button class="link" id="bWho">' + esc(T("edit")) + "</button>"; $("bWho").onclick = function () { S.editWho = true; renderWho(); }; if (S.keyBad) wc.innerHTML = '<div class="keybad">' + esc(T("keyBad")) + "</div>"; return; }
      w.innerHTML = ""; w = wc;
    }
    if (S.me) {
      w.innerHTML = '<div class="who"><div><div class="lbl" style="margin:0">' + esc(T("who")) + '</div><b>' + esc(S.me.name) + '</b> <span class="ph">' + esc(S.me.phone) + '</span></div><span class="tag ok">✓ ' + esc(T("myLink")) + "</span></div>";
      return;
    }
    var warn = S.keyBad ? '<div class="keybad">' + esc(T("keyBad")) + "</div>" : "";
    if (!S.editWho) {
      w.innerHTML = warn + '<div class="who"><div><div class="lbl" style="margin:0">' + esc(T("who")) + '</div><b>' + esc(S.who.name) + '</b> <span class="ph">' + esc(S.who.phone) + '</span></div><button class="link" id="bWho">' + esc(T("edit")) + '</button></div>';
      $("bWho").onclick = function () { S.editWho = true; renderWho(); };
      return;
    }
    w.innerHTML = warn + (isDesk() ? '<div class="dgrid" style="margin-bottom:12px"><div class="fld"><label>' + esc(T("name")) + "</label>" : '<div class="lbl">' + esc(T("who")) + '</div><div class="grid2">') +
      '<input class="inp" id="wName" placeholder="' + esc(T("name")) + '" value="' + esc(S.who.name) + '" maxlength="80" autocomplete="name">' + (isDesk() ? '</div><div class="fld"><label>' + esc(T("phone")) + "</label>" : "") +
      '<input class="inp" id="wPhone" type="tel" inputmode="tel" placeholder="+998 90 123 45 67" value="' + esc(S.who.phone) + '" maxlength="30" autocomplete="tel"></div>' + (isDesk() ? "</div>" : "");
    $("wName").oninput = function (e) { S.who.name = e.target.value; store(K.who, S.who); };
    $("wPhone").oninput = function (e) { S.who.phone = e.target.value; store(K.who, S.who); };
  }

  // ---------- ro'yxat ----------
  function lineHtml(l, i, ro) {
    if (isDesk()) return lineDesk(l, i, ro);
    var chips = (l.vars || []).filter(Boolean).map(function (v) { return '<span class="tag">' + esc(v) + '</span>'; }).join("") + (l.size ? '<span class="tag sz">' + esc(l.size) + '</span>' : "");
    if (!l.known) chips = '<span class="tag w">? ' + esc(T("unknown")) + '</span>';
    if (ro && l.n > 1) chips += '<span class="tag">' + esc(T("fromSecs").replace("{n}", l.n)) + "</span>";
    var ex = !ro && l.expr && isExpr(l.expr) ? '<small class="ex">' + esc(l.expr) + "</small>" : "";
    return '<div class="ln' + (l.known ? "" : " unk") + (ro ? " ro" : "") + (S.fresh === l.id ? " fresh" : "") + '" data-id="' + l.id + '"><div class="n">' + (i + 1) + '</div>' +
      '<div class="t" data-act="edit"><div class="nm">' + esc(l.name) + '</div><div class="ch">' + chips + '</div></div>' +
      (ro ? '<div class="qty"><div class="v">' + fmtQ(l.qty) + "<small>" + esc(l.unit || "") + "</small></div></div>"
          : '<div class="qty' + (l.qty ? "" : " none") + '"><button data-act="minus">−</button><div class="v" data-act="edit">' + fmtQ(l.qty) + '<small>' + esc(l.unit || "") + '</small>' + ex + '</div><button data-act="plus">+</button></div>') + "</div>";
  }
  // kompyuter: jadval qatori — soni shu yerning o'zida yoziladi (12+8+6 ham), Enter — keyingi tovarni yozishga qaytadi
  function lineDesk(l, i, ro) {
    var sub = [(l.vars || []).filter(Boolean).join(" "), l.size, l.brand].filter(Boolean).join(" · ");
    if (ro && l.n > 1) sub += (sub ? " · " : "") + T("fromSecs").replace("{n}", l.n);
    var qv = l.expr && isExpr(l.expr) ? l.expr : l.qty ? fmtQ(l.qty) : "";
    return '<tr class="ln dr' + (l.known ? "" : " unk") + (ro ? " ro" : "") + (S.fresh === l.id ? " fresh" : "") + '" data-id="' + l.id + '"><td class="c-n">' + (i + 1) + "</td>" +
      '<td class="t"' + (ro ? "" : ' data-act="edit" title="' + esc(T("edit")) + '"') + '><div class="nm">' + esc(l.name) + "</div>" + (sub ? '<div class="sub">' + esc(sub) + "</div>" : "") + (l.known ? "" : '<div class="sub w">' + esc(T("unknown")) + "</div>") + "</td>" +
      (ro ? '<td class="c-q"><b>' + fmtQ(l.qty) + "</b></td>"
          : '<td class="c-q"><div class="dq"><input class="inp qin' + (l.qty ? "" : " none") + '" value="' + esc(qv) + '" placeholder="0" autocomplete="off" aria-label="' + esc(T("qty")) + '"><small class="res">' + (l.expr && isExpr(l.expr) ? "= " + fmtQ(l.qty) : "") + "</small></div></td>") +
      '<td class="c-u">' + esc(l.unit || "") + "</td>" +
      '<td class="c-x">' + (ro ? "" : '<button class="btn xs dng" data-act="del" title="' + esc(T("del")) + '" aria-label="' + esc(T("del")) + '">✕</button>') + "</td></tr>";
  }
  function deskTable(body) {
    return '<table class="t dt"><thead><tr><th class="c-n">№</th><th>' + esc(T("colItem")) + '</th><th class="c-q">' + esc(T("qty")) + '</th><th class="c-u">' + esc(T("unitCol")) + '</th><th class="c-x"></th></tr></thead><tbody>' + body + "</tbody></table>";
  }
  function bindQtyInputs(L) {
    L.querySelectorAll(".qin").forEach(function (inp) {
      var row = inp.closest(".ln"), res = row.querySelector(".res");
      var l = function () { return S.lines.find(function (x) { return x.id === row.dataset.id; }); };
      inp.oninput = function () { res.textContent = isExpr(inp.value) ? "= " + fmtQ(calcQty(inp.value)) : ""; };
      var commit = function () {
        var x = l(); if (!x) return; var v = inp.value.trim();
        x.qty = calcQty(v) || null; x.expr = isExpr(v) ? v : "";
        inp.classList.toggle("none", !x.qty); save(); renderSend();
      };
      inp.onchange = commit;
      inp.onkeydown = function (e) {
        if (e.key === "Enter") { e.preventDefault(); commit(); var q = $("q"); if (q) q.focus(); }
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          var all = Array.prototype.slice.call(L.querySelectorAll(".qin")), k = all.indexOf(inp) + (e.key === "ArrowDown" ? 1 : -1);
          if (all[k]) { e.preventDefault(); commit(); all[k].focus(); all[k].select(); }
        }
      };
      inp.onfocus = function () { inp.select(); };
    });
  }
  function renderList() {
    var L = $("list");
    if (S.view === "total" && S.lines.length) {
      var tt = totals();
      var rows = tt.map(function (l, i) { return lineHtml(l, i, true); }).join("");
      L.innerHTML = isDesk() ? '<div class="dtot">Σ ' + esc(T("totalD")) + "</div>" + deskTable(rows) : '<div class="sechd tot">Σ ' + esc(T("totalD")) + " · " + tt.length + " " + esc(T("items")) + "</div>" + rows;
      renderSend(); return;
    }
    if (!S.lines.length) {
      L.innerHTML = isDesk() ? '<div class="dempty">' + esc(T("emptyDk")) + "</div>" : '<div class="card empty"><b>' + esc(T("emptyT")) + '</b>' + esc(T("emptyD")) + '</div>';
    } else if (S.secs.length) {
      // bo'limlar bo'yicha: har bo'lim sarlavhasi bilan (bosilsa — yangi tovarlar shu bo'limga tushadi)
      var groups = [{ id: "", name: T("noSec") }].concat(S.secs), html = "", k = 0;
      groups.forEach(function (g) {
        var ls = S.lines.filter(function (l) { return (l.sec || "") === g.id; });
        if (!ls.length && S.cur !== g.id) return;
        if (isDesk()) {
          html += '<tr class="sechd' + (S.cur === g.id ? " on" : "") + '" data-sec="' + g.id + '"><td colspan="5">' + esc(g.name) + " <span>" + ls.length + "</span></td></tr>";
          if (!ls.length) html += '<tr class="secempty"><td colspan="5">' + esc(T("secEmpty")) + "</td></tr>";
        } else {
        html += '<div class="sechd' + (S.cur === g.id ? " on" : "") + '" data-sec="' + g.id + '">' + esc(g.name) + " <span>" + ls.length + "</span></div>";
        if (!ls.length) html += '<div class="secempty">' + esc(T("secEmpty")) + "</div>";
        }
        html += ls.map(function (l) { return lineHtml(l, k++, false); }).join("");
      });
      L.innerHTML = isDesk() ? deskTable(html) : html;
      L.querySelectorAll(".sechd[data-sec]").forEach(function (h) { h.onclick = function () { S.cur = h.dataset.sec; save(); renderSecs(); renderList(); }; });
    } else {
      var all = S.lines.map(function (l, i) { return lineHtml(l, i, false); }).join("");
      L.innerHTML = isDesk() ? deskTable(all) : all;
    }
    if (S.lines.length) {
      L.querySelectorAll(".ln").forEach(function (el) {
        el.onclick = function (e) {
          var act = e.target.closest("[data-act]"); if (!act) return;
          var l = S.lines.find(function (x) { return x.id === el.dataset.id; }); if (!l) return;
          var a = act.dataset.act;
          if (a === "edit") return openPicker(l, false);
          if (a === "del") { S.lines = S.lines.filter(function (x) { return x.id !== l.id; }); save(); renderList(); return; }
          var st = 1, cur = Number(l.qty) || 0;
          l.qty = a === "plus" ? cur + st : Math.max(0, cur - st);
          if (!l.qty) l.qty = a === "plus" ? 1 : null;
          l.expr = "";
          save(); renderList();
        };
      });
      bindQtyInputs(L);
      if (S.fresh) { var f = L.querySelector(".fresh"); if (f && f.scrollIntoView) f.scrollIntoView({ block: "nearest", behavior: "smooth" }); S.fresh = null; }
    }
    renderSend();
  }
  function renderSend() {
    var b = $("bSend"); if (!b) return;
    var n = S.secs.length ? totals().length : S.lines.length;
    var c = $("dcount"); if (c) c.textContent = T("positions") + ": " + n;
    b.textContent = S.sending ? T("sending") : isDesk() ? T("send") + " ✓" : T("send") + (n ? " · " + n + " " + T("items") : "");
    b.disabled = S.sending || (isDesk() && !S.lines.length);
  }
  function addLine(l) {
    l.id = l.id || uid();
    if (l.sec == null) l.sec = S.cur || "";
    if (S.view === "total") S.view = "list";
    var same = l.known && S.lines.find(function (x) { return x.known && (x.sec || "") === (l.sec || "") && (x.pid || "") === (l.pid || "") && lineLabel(x) === lineLabel(l) && x.unit === l.unit; });
    if (same) { same.qty = (Number(same.qty) || 0) + (Number(l.qty) || 0) || null; same.expr = ""; S.fresh = same.id; S.lastId = same.id; }
    else { S.lines.push(l); S.fresh = l.id; S.lastId = l.id; }
    save(); renderList();
  }

  // ---------- tavsiyalar ----------
  var lastRes = [];
  function fromResult(r, raw) {
    return { name: r.it.name, vars: r.it.vars.map(function (_, gi) { return r.vars[gi] || ""; }), size: r.size || "", qty: r.qty, unit: r.unit || r.it.unit, raw: raw, known: true, cat: r.it.cat, ii: r.it.i };
  }
  function freeLine(text) {
    var P = E.parse(text), name = text.trim().replace(/\s+/g, " ");
    // miqdorni nomdan olib tashlash: "maxsus kalit 2 ta" → "maxsus kalit"
    if (P.qty != null) { var n2 = name.replace(/[\s,;:-]*\d+([.,]\d+)?\s*(ta|та|dona|дона|шт|штук|sht|m|м|метр|metr|комп|компл|kompl)\.?\s*$/i, "").trim(); if (n2.length >= 2) name = n2; }
    return { name: name, vars: [], size: "", qty: P.qty, unit: P.unit || "шт", raw: text, known: false, cat: "", ii: -1 };
  }
  function paintHi() { $("sug").querySelectorAll(".fr").forEach(function (r, i) { r.classList.toggle("on", i === S.hi); if (i === S.hi && r.scrollIntoView) r.scrollIntoView({ block: "nearest" }); }); }
  var baseHits = [];
  function pickK(k) {
    var q = $("q").value; if (q.trim().length < 2) return;
    if (BASE) { var p = baseHits[k]; if (p) takeDesk(fromBase(p)); return; }
    var l = k < lastRes.length ? fromResult(lastRes[k], q) : freeLine(q);
    takeDesk(l);
  }
  // kompyuterda — programmadagi «Подбор товаров» kabi: tanlangan tovar uchun shu joyda «Miqdori: [ ] [Qo'shish] [Bekor]»
  function takeDesk(l) {
    var it = l.ii >= 0 ? E.items[l.ii] : null;
    if (it && it.sizes.length && !l.size) { clearInput(); openPicker(l, true); return; }
    if (l.qty) { addLine(l); backToSearch(); return; }
    S.pend = l; renderSug();
  }
  // programmadagidek: qo'shilgandan keyin qidiruv matni belgilangan holda qoladi — ro'yxatdan keyingisini olish yoki yangisini yozish mumkin
  function backToSearch() { var q = $("q"); if (!q) return; q.focus(); if (BASE) { q.select(); renderSug(); } else clearInput(); }
  function renderPend() {
    var l = S.pend, box = $("sug");
    box.dataset.q = "";
    box.innerHTML = '<div class="fpend"><div class="pnm">' + esc(lineLabel(l)) + (l.known ? "" : ' <span class="sub w">' + esc(T("unknown")) + "</span>") + "</div>" +
      '<div class="row" style="gap:8px;flex-wrap:nowrap"><span class="pl">' + esc(T("qtyColon")) + '</span><input class="inp" id="pq" autocomplete="off" placeholder="0" style="width:120px;font-weight:700;font-size:15px"><span class="pl">' + esc(l.unit || "шт") + "</span>" +
      '<button class="btn pri" id="pqOk">' + esc(T("add")) + '</button><button class="btn" id="pqNo">' + esc(T("cancel")) + '</button><b class="res" id="pqRes"></b></div>' +
      '<div class="ph2">' + esc(T("pendHint")) + "</div></div>";
    var pq = $("pq"), res = $("pqRes");
    var ok = function () { var v = pq.value.trim(), n = calcQty(v); if (!n) { pq.classList.add("bad"); pq.focus(); return; } l.qty = n; l.expr = isExpr(v) ? v : ""; S.pend = null; addLine(l); backToSearch(); };
    var no = function () { S.pend = null; backToSearch(); };
    var okb = $("pqOk");
    pq.oninput = function () { pq.classList.remove("bad"); res.textContent = isExpr(pq.value) ? "= " + fmtQ(calcQty(pq.value)) : ""; okb.disabled = !(calcQty(pq.value) > 0); };
    pq.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); ok(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); no(); } };
    $("pqOk").onclick = ok; $("pqNo").onclick = no;
    pq.value = "1";
    pq.focus(); pq.select();
  }
  // ---- programmadagi ProductPicker'ning aynan nusxasi (narxsiz): hamma topilganlar, qator 68px, 2 qatorli nom,
  // ostida «kod · brend · o'lcham · birlik»; ↑↓ (aylanib), PageUp/PageDown ±7, Enter — faqat tanlangan qator, Esc — tozalash
  var ROW = 68, BOX_H = 420, baseTop = 0;
  function paintBaseRows() {
    var inner = $("sug").querySelector(".pinner"); if (!inner) return;
    var start = Math.max(0, Math.floor(baseTop / ROW) - 8), end = Math.min(baseHits.length, Math.ceil((baseTop + BOX_H) / ROW) + 8), h = "";
    for (var i = start; i < end; i++) {
      var p = baseHits[i], sub = [p.code, brandOf(p.brand, SUPN[p.sup]), SUPN[p.sup]].filter(Boolean).join(" · ");
      h += '<div class="prow' + (i === S.hi ? " on" : "") + '" data-k="' + i + '" style="top:' + i * ROW + 'px" title="' + esc(p.name) + '"><div class="pick-name">' + esc(p.name) + '</div><div class="psub">' + esc(sub ? sub + " · " + p.unit : p.unit) + "</div></div>";
    }
    inner.innerHTML = h;
  }
  var SF = { open: false, q: "", act: -1, hov: null, bAct: -1 };
  function saveSF() { store(K.sf, { sfs: S.sfs, sbr: S.sbr }); }
  function supLabel() {
    if (!S.sfs.length) return T("allSups");
    if (S.sfs.length === 1) { var id = S.sfs[0], br = S.sbr[id]; return (SUPN[id] || "1") + (br && br.length ? " · " + (br.length === 1 ? (br[0] || T("noBrand")) : T("nBrands").replace("{n}", br.length)) : ""); }
    return T("nSups").replace("{n}", S.sfs.length);
  }
  function supList() {
    var qv = kbVariants(SF.q), sel = {}; S.sfs.forEach(function (id) { sel[id] = 1; });
    return SUPS.filter(function (x) { if (!qv.length) return true; var n = x.name.toLowerCase().replace(/ё/g, "е"), nl = translit(n); return qv.some(function (v) { return n.indexOf(v) >= 0 || nl.indexOf(v) >= 0; }); });
  }
  function renderSupF() {
    var w = $("supf"); if (!w) return;
    if (!BASE || !SUPS.length) { w.innerHTML = ""; w.style.display = "none"; $("q").placeholder = BASE ? T("searchPhBase") : T("searchPh"); return; }
    w.style.display = "";
    $("q").placeholder = S.sfs.length ? (S.sfs.length === 1 ? T("searchInSup") : T("searchInSups")) : T("searchPhBase");
    var h = '<button type="button" class="inp sup-filter' + (S.sfs.length ? " on" : "") + '" id="supBtn" title="' + esc(T("supTitle")) + '"><span>' + esc(supLabel()) + '</span><span class="mut">▾</span></button>';
    if (SF.open) {
      var list = supList(), hs = SF.hov && list.some(function (x) { return x.id === SF.hov; }) ? SF.hov : null, brands = hs ? SUPB[hs] || [] : [];
      h += '<div class="sup-pop"><input class="inp" id="supQ" autocomplete="off" placeholder="' + esc(T("supQPh")) + '" value="' + esc(SF.q) + '"><div class="sup-list">' +
        list.map(function (x, i) {
          var on = S.sfs.indexOf(x.id) >= 0, nb = (S.sbr[x.id] || []).length;
          return '<label class="pick-sup' + (hs === x.id || SF.act === i ? " hov" : "") + (on ? " sel" : "") + '" data-i="' + i + '" data-id="' + x.id + '"><input type="checkbox"' + (on ? " checked" : "") + '><span class="sn">' + esc(x.name) + (nb ? '<span class="sb"> · ' + esc(T("brandsN").replace("{n}", nb)) + "</span>" : "") + '</span><span class="xs mut">' + (SUPC[x.id] || 0) + "</span>" + ((SUPB[x.id] || []).length > 1 ? '<span class="xs mut">›</span>' : "") + "</label>";
        }).join("") + (list.length ? "" : '<div class="xs mut" style="padding:8px 6px">' + esc(T("notFoundBase")) + "</div>") + "</div>";
      if (hs && brands.length > 1) {
        h += '<div class="brand-fly"><div class="bfh">' + esc(T("brandsOf")) + " · " + esc(SUPN[hs]) + '</div><div class="bfl">' + brands.map(function (r, i) {
          var on = !!(S.sbr[hs] && S.sbr[hs].indexOf(r.b) >= 0);
          return '<label class="pick-sup' + (SF.bAct === i ? " hov" : "") + (on ? " sel" : "") + '" data-b="' + i + '"><input type="checkbox"' + (on ? " checked" : "") + '><span class="sn">' + esc(r.b || T("noBrand")) + '</span><span class="xs mut">' + r.n + "</span></label>";
        }).join("") + "</div>" + (S.sbr[hs] && S.sbr[hs].length ? '<button type="button" class="btn xs" id="bfAll" style="margin-top:6px">' + esc(T("allBrands")) + "</button>" : "") + "</div>";
      }
      h += '<div class="row sup-act"><button type="button" class="btn xs" id="supReset"' + (S.sfs.length ? "" : " disabled") + ">" + esc(T("reset")) + '</button><button type="button" class="btn xs pri" id="supDone">' + esc(T("done")) + "</button></div></div>";
    }
    w.innerHTML = h;
    $("supBtn").onclick = function () { SF.open = !SF.open; SF.q = ""; SF.act = -1; SF.bAct = -1; renderSupF(); if (SF.open) $("supQ").focus(); };
    if (!SF.open) return;
    var qi = $("supQ"), list2 = supList();
    var changed = function () { saveSF(); S.hi = -1; var q = $("q"); renderSug(); };
    var toggleSup = function (id) {
      var i = S.sfs.indexOf(id); if (i >= 0) { S.sfs.splice(i, 1); delete S.sbr[id]; } else S.sfs.push(id);
      SF.q = ""; SF.act = -1; SF.bAct = -1; changed(); renderSupF(); $("supQ").focus();
    };
    var toggleBrand = function (sid, b) {
      var cur = (S.sbr[sid] || []).slice(), k = cur.indexOf(b); if (k >= 0) cur.splice(k, 1); else cur.push(b);
      if (cur.length) S.sbr[sid] = cur; else delete S.sbr[sid];
      if (S.sfs.indexOf(sid) < 0) S.sfs.push(sid);
      changed(); renderSupF(); $("supQ").focus();
    };
    var done = function () { SF.open = false; SF.bAct = -1; renderSupF(); var q = $("q"); q.focus(); renderSug(); };
    w.querySelectorAll("[data-id]").forEach(function (l) {
      l.onmouseenter = function () { if (SF.hov !== l.dataset.id || SF.bAct >= 0) { SF.hov = l.dataset.id; SF.act = Number(l.dataset.i); SF.bAct = -1; renderSupF(); $("supQ").focus(); } };
      l.onclick = function (e) { e.preventDefault(); toggleSup(l.dataset.id); };
    });
    w.querySelectorAll("[data-b]").forEach(function (l) {
      var hs = SF.hov;
      l.onmouseenter = function () { if (SF.bAct !== Number(l.dataset.b)) { SF.bAct = Number(l.dataset.b); w.querySelectorAll("[data-b]").forEach(function (x) { x.classList.toggle("hov", x === l); }); } };
      l.onclick = function (e) { e.preventDefault(); toggleBrand(hs, SUPB[hs][Number(l.dataset.b)].b); };
    });
    if ($("bfAll")) $("bfAll").onclick = function () { delete S.sbr[SF.hov]; changed(); renderSupF(); };
    $("supReset").onclick = function () { S.sfs = []; S.sbr = {}; changed(); renderSupF(); };
    $("supDone").onclick = done;
    qi.oninput = function () { SF.q = qi.value; SF.act = SF.q.trim() ? 0 : -1; SF.hov = null; var l3 = supList(); if (SF.act === 0 && l3[0]) SF.hov = l3[0].id; SF.bAct = -1; renderSupF(); var n = $("supQ"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    qi.onkeydown = function (e) {
      var hs = SF.hov && list2.some(function (x) { return x.id === SF.hov; }) ? SF.hov : null, brands = hs ? SUPB[hs] || [] : [], inBr = SF.bAct >= 0 && hs && brands.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); var d = e.key === "ArrowDown" ? 1 : -1;
        if (inBr) SF.bAct = (SF.bAct + d + brands.length) % brands.length;
        else if (list2.length) { SF.act = SF.act < 0 ? (d > 0 ? 0 : list2.length - 1) : (SF.act + d + list2.length) % list2.length; SF.hov = list2[SF.act].id; }
        renderSupF(); $("supQ").focus(); scrollAct();
      } else if (e.key === "ArrowRight" && hs && brands.length > 1) { e.preventDefault(); SF.bAct = 0; renderSupF(); $("supQ").focus(); }
      else if (e.key === "ArrowLeft" && SF.bAct >= 0) { e.preventDefault(); SF.bAct = -1; renderSupF(); $("supQ").focus(); }
      else if ((e.key === "Enter" || (e.key === " " && !SF.q)) && (inBr || SF.act >= 0)) { e.preventDefault(); e.stopPropagation(); if (inBr) toggleBrand(hs, brands[SF.bAct].b); else if (list2[SF.act]) toggleSup(list2[SF.act].id); }
      else if (e.key === "Enter" && !SF.q.trim()) { e.preventDefault(); done(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(); }
    };
    function scrollAct() { w.querySelectorAll(".pick-sup.hov").forEach(function (el) { if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); }); }
  }
  document.addEventListener("mousedown", function (e) { if (SF.open && !e.target.closest("#supf")) { SF.open = false; renderSupF(); } });
  function renderSugBase(q, box) {
    var prev = box.querySelector(".plist"), keep = prev && box.dataset.q === q;
    baseHits = baseFind(q);
    if (!keep) { baseTop = 0; if (S.hi == null || S.hi >= baseHits.length) S.hi = -1; }
    box.dataset.q = q;
    if (!baseHits.length) { box.innerHTML = '<div class="phd"><span>' + esc(T("notFoundBase")) + "</span></div>"; return; }
    box.innerHTML = '<div class="phd"><span>' + esc(T("found")) + ": " + baseHits.length + "</span>" + (baseHits.length > 1 ? "<span>" + esc(T("pickHint")) + "</span>" : "") + "</div>" +
      '<div class="plist" style="max-height:' + BOX_H + 'px"><div class="pinner" style="height:' + baseHits.length * ROW + 'px"></div></div>';
    var list = box.querySelector(".plist");
    list.scrollTop = keep ? baseTop : 0;
    list.onscroll = function () { baseTop = list.scrollTop; paintBaseRows(); };
    var inner = box.querySelector(".pinner");
    inner.onmousedown = function (e) { e.preventDefault(); };
    inner.onclick = function (e) { var r = e.target.closest(".prow"); if (r) { S.hi = Number(r.dataset.k); pickK(S.hi); } };
    paintBaseRows();
  }
  function moveBaseHi(d) {
    var n = baseHits.length; if (!n) return;
    var i = S.hi == null ? -1 : S.hi;
    if (d === 1) i = i + 1 >= n ? 0 : i + 1; else if (d === -1) i = i <= 0 ? n - 1 : i - 1; else if (d === 7) i = Math.min(i + 7, n - 1); else i = Math.max(i - 7, 0);
    S.hi = i;
    var list = $("sug").querySelector(".plist");
    if (list) { var y = i * ROW; if (y < list.scrollTop) list.scrollTop = y; else if (y + ROW > list.scrollTop + list.clientHeight) list.scrollTop = y + ROW - list.clientHeight; baseTop = list.scrollTop; }
    paintBaseRows();
  }
  function renderSugDesk() {
    var q = $("q").value, box = $("sug");
    if (S.pend) return renderPend();
    if (BASE && (q.trim().length >= 2 || S.sfs.length)) return renderSugBase(q, box);
    if (q.trim().length < 2) { box.innerHTML = ""; lastRes = []; baseHits = []; return; }
    var res = E.suggest(q, 12), top = res[0] ? res[0].score : 0;
    lastRes = res.filter(function (r) { return r.score >= 0.55 && r.score >= top - 0.4; }).slice(0, 8);
    if (S.hi == null || S.hi > lastRes.length) S.hi = 0;
    var html = '<div class="fhd">' + (lastRes.length ? esc(T("found")) + ": " + lastRes.length : esc(T("notFound"))) + "</div>";
    html += lastRes.map(function (r, i) {
      var l = fromResult(r, q), sub = [l.vars.filter(Boolean).join(" "), l.size, l.qty != null ? fmtQ(l.qty) + " " + l.unit : l.unit].filter(Boolean).join(" · ");
      return '<div class="fr' + (i === S.hi ? " on" : "") + '" data-k="' + i + '"><b>' + esc(l.name) + '</b><div class="sub">' + esc(sub) + "</div></div>";
    }).join("");
    html += '<div class="fr free' + (S.hi === lastRes.length ? " on" : "") + '" data-k="' + lastRes.length + '"><b>«' + esc(q.trim()) + '»</b><div class="sub">' + esc(T("keepFree")) + "</div></div>";
    box.innerHTML = html;
    box.querySelectorAll(".fr").forEach(function (r) {
      r.onmousedown = function (e) { e.preventDefault(); };
      r.onmousemove = function () { var k = Number(r.dataset.k); if (S.hi !== k) { S.hi = k; paintHi(); } };
      r.onclick = function () { pickK(Number(r.dataset.k)); };
    });
  }
  function renderSug() {
    if (isDesk()) return renderSugDesk();
    var q = $("q").value, box = $("sug");
    if (q.trim().length < 2) { box.innerHTML = ""; lastRes = []; return; }
    var res = E.suggest(q, 8), top = res[0] ? res[0].score : 0;
    lastRes = res.filter(function (r) { return r.score >= 0.55 && r.score >= top - 0.35; }).slice(0, 5);
    var words = E.complete(q);
    var html = "";
    if (words.length) html += '<div class="words">' + words.map(function (w) { return '<button data-w="' + esc(w) + '">' + esc(w) + '…</button>'; }).join("") + "</div>";
    html += lastRes.map(function (r, i) {
      var l = fromResult(r, q);
      var extra = (l.vars.filter(Boolean).join(" ") + (l.size ? " " + l.size : "")).trim();
      return '<button class="sg' + (i === 0 && r.score >= 0.8 ? " top" : "") + '" data-i="' + i + '"><span class="nm">' + esc(l.name) + (extra ? ' <em>' + esc(extra) + "</em>" : "") + '</span><span class="q">' + (l.qty != null ? fmtQ(l.qty) + " " + esc(l.unit) : "") + "</span></button>";
    }).join("");
    html += '<button class="sg" data-free="1"><span class="nm" style="font-weight:500;color:var(--mut)">«' + esc(q.trim()) + '» — ' + esc(T("keep").toLowerCase()) + '</span></button>';
    box.innerHTML = html;
    box.querySelectorAll("[data-w]").forEach(function (b) {
      b.onmousedown = function (e) { e.preventDefault(); };
      b.onclick = function () { var inp = $("q"); inp.value = inp.value.replace(/([^\s\d]+)$/, b.dataset.w) + " "; inp.focus(); renderSug(); };
    });
    box.querySelectorAll("[data-i]").forEach(function (b) { b.onmousedown = function (e) { e.preventDefault(); }; b.onclick = function () { take(fromResult(lastRes[Number(b.dataset.i)], q)); }; });
    var fb = box.querySelector("[data-free]");
    fb.onmousedown = function (e) { e.preventDefault(); };
    fb.onclick = function () { take(freeLine(q)); };
  }
  function clearInput() { var q = $("q"); q.value = ""; S.hi = 0; renderSug(); }
  function take(l) {
    var it = l.ii >= 0 ? E.items[l.ii] : null;
    var needPick = (it && it.sizes.length && !l.size) || !l.qty;
    clearInput();
    if (needPick) openPicker(l, true); else { addLine(l); $("q").focus(); }
  }
  function acceptTop() {
    var q = $("q").value;
    if (q.trim().length < 2) return;
    if (lastRes[0] && lastRes[0].score >= 0.8) take(fromResult(lastRes[0], q));
    else take(freeLine(q));
  }
  function addMany(text) {
    var rows = String(text).split(/\r?\n/).map(function (s) { return s.replace(/^\s*(\d{1,3}[.)]|[-•*·–—])\s*/, "").trim(); }).filter(function (s) { return s.length >= 2; });
    var known = 0;
    rows.forEach(function (row) {
      var r = E.suggest(row, 1)[0];
      if (r && r.score >= 0.8) { var l = fromResult(r, row); if (l.qty == null) l.qty = null; S.lines.push(Object.assign(l, { id: uid(), sec: S.cur || "" })); known++; }
      else S.lines.push(Object.assign(freeLine(row), { id: uid(), sec: S.cur || "" }));
    });
    save(); renderList(); clearInput();
    toast(T("pasted").replace("{n}", rows.length).replace("{k}", known));
  }

  // ---------- oynalar (pastdan chiqadi) ----------
  function sheet(html, onMount) {
    closeSheet();
    var bg = document.createElement("div"); bg.className = "sheet-bg"; bg.id = "sheetBg";
    bg.innerHTML = '<div class="sheet">' + html + "</div>";
    bg.onclick = function (e) { if (e.target === bg) closeSheet(); };
    document.body.appendChild(bg); document.body.classList.add("lock"); // oyna ochiq — orqadagi sahifa qimirlamaydi
    if (onMount) onMount(bg.firstChild);
  }
  function closeSheet() { var b = $("sheetBg"); if (b) b.remove(); document.body.classList.remove("lock"); }
  function confirmSheet(text, yes, yesLabel) {
    sheet('<h3>' + esc(text) + '</h3><div class="acts"><button class="btn" id="cNo">' + esc(T("cancel")) + '</button><button class="btn pri" id="cYes">' + esc(yesLabel || T("yes")) + "</button></div>", function () {
      $("cNo").onclick = closeSheet; $("cYes").onclick = function () { closeSheet(); yes(); };
    });
  }
  // tovar: variant, o'lcham, miqdor
  function openPicker(l0, isNew) {
    var l = JSON.parse(JSON.stringify(l0));
    var it = l.ii >= 0 ? E.items[l.ii] : null;
    var sizes = it ? it.sizes.map(function (z) { return z.s; }) : [];
    var sizeFilter = "";
    function body() {
      var h = "";
      if (it) {
        h += '<h3>' + esc(it.name) + "</h3>";
        it.vars.forEach(function (g, gi) {
          h += '<div class="grp chips">' + g.map(function (o) { return '<button class="chip' + (l.vars[gi] === o.opt ? " on" : "") + '" data-g="' + gi + '" data-o="' + esc(o.opt) + '">' + esc(o.opt) + "</button>"; }).join("") + "</div>";
        });
        if (sizes.length) {
          var shown = sizes.filter(function (s) { return !sizeFilter || E.sizeKey(s).indexOf(E.sizeKey(sizeFilter)) >= 0; });
          h += '<div class="lbl grp">' + esc(T("size")) + "</div>";
          if (sizes.length > 20) h += '<input class="inp" id="pSf" inputmode="decimal" placeholder="' + esc(T("search")) + ' 500×1000" value="' + esc(sizeFilter) + '" style="margin-bottom:8px">';
          h += '<div class="chips" id="pSizes">' + shown.slice(0, 60).map(function (s) { return '<button class="chip' + (l.size === s ? " on" : "") + '" data-s="' + esc(s) + '">' + esc(s) + "</button>"; }).join("") + "</div>";
          var custom = l.size && sizes.indexOf(l.size) < 0 ? l.size : "";
          h += '<input class="inp" id="pSize" placeholder="' + esc(T("otherSize")) + '" value="' + esc(custom) + '" style="margin-top:8px">';
        } else {
          h += '<input class="inp" id="pSize" placeholder="' + esc(T("size")) + " (" + esc(T("otherSize")) + ')" value="' + esc(l.size) + '" style="margin-top:10px">';
        }
      } else if (l.pid) {
        h += "<h3>" + esc(l.name) + "</h3>" + (l.brand ? '<div class="d">' + esc(l.brand) + "</div>" : "");
      } else {
        h += '<h3>' + esc(T("unknown")) + "</h3>";
        h += '<input class="inp" id="pText" value="' + esc(l.name) + '" maxlength="200">';
        h += '<div class="sug" id="pSug" style="box-shadow:none;margin-top:8px"></div>';
      }
      var quick = l.unit === "м" ? [10, 20, 50, 100, 200] : [1, 2, 5, 10, 20, 50];
      h += '<div class="lbl grp">' + esc(T("qty")) + ' <span class="hint">' + esc(T("calcHint")) + '</span></div><div class="qbig"><button id="pMinus">−</button><input class="inp" id="pQty" inputmode="text" autocomplete="off" value="' + esc(l.expr && isExpr(l.expr) ? l.expr : l.qty ? fmtQ(l.qty) : "") + '" placeholder="0"><button id="pPlus">+</button><span class="u">' + esc(l.unit) + '</span></div><div class="calcres" id="pRes"></div>';
      h += '<div class="chips" style="margin-top:8px">' + quick.map(function (n) { return '<button class="chip" data-q="' + n + '">' + n + "</button>"; }).join("") + "</div>";
      h += '<div class="err" id="pErr"></div><div class="acts">' + (isNew ? '<button class="btn" id="pCancel">' + esc(T("cancel")) + "</button>" : '<button class="btn" id="pDel">' + esc(T("del")) + "</button>") + '<button class="btn pri" id="pOk">' + esc(isNew ? T("add") : T("save")) + "</button></div>";
      return h;
    }
    function mount(root) {
      root.innerHTML = body();
      root.querySelectorAll("[data-g]").forEach(function (b) { b.onclick = function () { var g = Number(b.dataset.g); l.vars[g] = l.vars[g] === b.dataset.o ? "" : b.dataset.o; mount(root); }; });
      root.querySelectorAll("[data-s]").forEach(function (b) { b.onclick = function () { l.size = l.size === b.dataset.s ? "" : b.dataset.s; l.qty = qtyVal(); mount(root); if (!l.qty) $("pQty").focus(); }; });
      var sf = $("pSf"); if (sf) sf.oninput = function () { sizeFilter = sf.value; l.qty = qtyVal(); var pos = sf.selectionStart; mount(root); var n = $("pSf"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
      var ps = $("pSize"); if (ps) ps.oninput = function () { l.size = ps.value.trim(); root.querySelectorAll("[data-s].on").forEach(function (x) { x.classList.remove("on"); }); };
      var pt = $("pText");
      if (pt) {
        var paint = function () {
          var box = $("pSug"), res = E.suggest(pt.value, 4).filter(function (r) { return r.score >= 0.55; });
          box.innerHTML = res.map(function (r, i) { var x = fromResult(r, pt.value); return '<button class="sg" data-r="' + i + '"><span class="nm">' + esc(lineLabel(x)) + "</span></button>"; }).join("");
          box.querySelectorAll("[data-r]").forEach(function (b) { b.onclick = function () { var x = fromResult(res[Number(b.dataset.r)], pt.value); x.id = l.id; if (x.qty == null) x.qty = qtyVal(); openPicker(x, isNew); }; });
        };
        pt.oninput = function () { l.name = pt.value; paint(); }; paint();
      }
      var qi = $("pQty");
      var showRes = function () { var r = $("pRes"); if (!r) return; r.textContent = isExpr(qi.value) ? "= " + fmtQ(calcQty(qi.value)) + " " + (l.unit || "") : ""; };
      qi.oninput = showRes; showRes();
      $("pMinus").onclick = function () { var v = qtyVal() || 0; qi.value = v > 1 ? fmtQ(v - 1) : ""; };
      $("pPlus").onclick = function () { var v = qtyVal() || 0; qi.value = fmtQ(v + 1); };
      root.querySelectorAll("[data-q]").forEach(function (b) { b.onclick = function () { qi.value = b.dataset.q; showRes(); }; });
      qi.onkeydown = function (e) { if (e.key === "Enter") ok(); };
      $("pOk").onclick = ok;
      if ($("pCancel")) $("pCancel").onclick = function () { closeSheet(); $("q").focus(); };
      if ($("pDel")) $("pDel").onclick = function () { S.lines = S.lines.filter(function (x) { return x.id !== l.id; }); save(); closeSheet(); renderList(); };
      if (!it || !sizes.length || l.size) { if (!l.qty) setTimeout(function () { qi.focus(); }, 60); }
    }
    function qtyVal() { var q = $("pQty"); return q ? calcQty(q.value) : l.qty; }
    function ok() {
      l.qty = qtyVal();
      var qv = $("pQty") ? $("pQty").value.trim() : ""; l.expr = isExpr(qv) ? qv : "";
      if (!l.known) { l.name = ($("pText").value || "").trim(); if (l.name.length < 2) return; }
      if (!l.qty) { $("pErr").textContent = T("needQty"); $("pQty").focus(); return; }
      closeSheet();
      if (isNew) { addLine(l); $("q").focus(); }
      else { var i = S.lines.findIndex(function (x) { return x.id === l.id; }); if (i >= 0) S.lines[i] = l; S.fresh = l.id; save(); renderList(); }
    }
    sheet("", mount);
  }
  function openCatalog(cat) {
    var html = "", items = E.items;
    if (!cat) {
      html = '<h3>' + esc(T("catalog")) + '</h3><input class="inp" id="cS" placeholder="' + esc(T("search")) + '" style="margin:8px 0">';
      html += '<div id="cList">' + E.cats.map(function (c) { var n = items.filter(function (i) { return i.cat === c[0]; }).length; return '<button class="cat" data-c="' + c[0] + '">' + esc(S.lang === "ru" ? c[2] : c[1]) + "<span>" + n + " ›</span></button>"; }).join("") + "</div>";
    } else {
      var c = E.cats.find(function (x) { return x[0] === cat; });
      html = '<div class="row"><button class="link" id="cBack" style="margin-left:0">‹ ' + esc(T("back")) + '</button></div><h3>' + esc(S.lang === "ru" ? c[2] : c[1]) + "</h3>";
      html += items.filter(function (i) { return i.cat === cat; }).map(function (i) { return '<button class="cat" data-i="' + i.i + '">' + esc(i.name) + "<span>›</span></button>"; }).join("");
    }
    sheet(html, function (root) {
      root.querySelectorAll("[data-c]").forEach(function (b) { b.onclick = function () { openCatalog(b.dataset.c); }; });
      bindItems(root);
      var back = $("cBack"); if (back) back.onclick = function () { openCatalog(); };
      var cs = $("cS");
      if (cs) cs.oninput = function () {
        var v = cs.value.trim();
        if (v.length < 2) { openCatalog(); setTimeout(function () { var n = $("cS"); n.value = v; n.focus(); }, 0); return; }
        $("cList").innerHTML = E.suggest(v, 12).filter(function (r) { return r.score >= 0.55; }).map(function (r) { return '<button class="cat" data-i="' + r.it.i + '">' + esc(r.it.name) + "<span>›</span></button>"; }).join("");
        bindItems(root);
      };
    });
    function bindItems(root) {
      root.querySelectorAll("[data-i]").forEach(function (b) {
        b.onclick = function () { var it = E.items[Number(b.dataset.i)]; openPicker({ name: it.name, vars: it.vars.map(function () { return ""; }), size: "", qty: null, unit: it.unit, raw: "", known: true, cat: it.cat, ii: it.i }, true); };
      });
    }
  }
  function openPaste() {
    sheet('<h3>' + esc(T("pasteT")) + '</h3><div class="d">' + esc(T("pasteD")) + '</div><textarea class="inp" id="pT" placeholder="troynik 25 10 ta\nkran 1/2 5 ta\n..."></textarea><div class="acts"><button class="btn" id="pC">' + esc(T("cancel")) + '</button><button class="btn pri" id="pA">' + esc(T("pasteBtn")) + "</button></div>", function () {
      $("pC").onclick = closeSheet;
      $("pA").onclick = function () { var v = $("pT").value; closeSheet(); if (v.trim()) addMany(v); };
      setTimeout(function () { $("pT").focus(); }, 60);
    });
  }
  function newList() {
    var go = function () { S.listId = uid(); S.lines = []; S.secs = []; S.cur = ""; S.object = ""; S.note = ""; S.view = "list"; save(); shell(); $("obj").focus(); };
    if (!S.lines.length) return go();
    confirmSheet(T("newListQ"), go, T("newList"));
  }
  function openList(x) {
    S.listId = x.id; S.object = x.object || ""; S.note = x.note || ""; S.lines = (x.lines || []).map(function (l) { return Object.assign({}, l); });
    S.secs = (x.secs || []).slice(); S.cur = ""; S.view = "list"; save(); closeSheet(); shell();
  }
  function listsHtml() {
    var dt = function (t) { return new Date(t).toLocaleDateString(S.lang === "ru" ? "ru-RU" : "uz-UZ"); };
    var drafts = S.lists.filter(function (x) { return x.id !== S.listId; });
    var h = '<div class="lbl grp">' + esc(T("drafts")) + "</div>";
    if (!drafts.length) h += '<div class="d">' + esc(T("noHistory")) + "</div>";
    h += drafts.map(function (x) {
      return '<div class="hist"><div class="t"><b>' + esc(x.object || T("noObject")) + "</b>" + esc(dt(x.at)) + " · " + (x.lines || []).length + " " + esc(T("items")) + (x.secs && x.secs.length ? " · " + x.secs.length + " " + esc(T("secs")) : "") + '</div><button class="btn sm" data-d="' + x.id + '">' + esc(T("open")) + '</button><button class="btn sm ghost" data-x="' + x.id + '" aria-label="' + esc(T("del")) + '">✕</button></div>';
    }).join("");
    h += '<div class="lbl grp">' + esc(T("sentLists")) + "</div>";
    if (!S.hist.length) h += '<div class="d">' + esc(T("noHistory")) + "</div>";
    h += S.hist.map(function (x, i) {
      return '<div class="hist"><div class="t"><b>№' + esc(x.num) + " · " + esc(dt(x.at)) + '</b>' + esc(x.object || "") + " · " + x.lines.length + " " + esc(T("items")) + '</div><button class="btn sm" data-h="' + i + '">' + esc(T("open")) + "</button></div>";
    }).join("");
    return h;
  }
  function bindLists(root, again) {
    root.querySelectorAll("[data-d]").forEach(function (b) { b.onclick = function () { save(); var x = S.lists.find(function (y) { return y.id === b.dataset.d; }); if (x) openList(x); }; });
    root.querySelectorAll("[data-x]").forEach(function (b) { b.onclick = function () { S.lists = S.lists.filter(function (y) { return y.id !== b.dataset.x; }); store(K.lists, S.lists); again(); }; });
    // yuborilgan ro'yxat — nusxa sifatida yangi ro'yxat bo'lib ochiladi (o'zgartirib, qayta yuborish mumkin)
    root.querySelectorAll("[data-h]").forEach(function (b) {
      b.onclick = function () {
        var x = S.hist[Number(b.dataset.h)]; save();
        openList({ id: uid(), object: x.object || "", note: "", lines: x.lines.map(function (l) { return Object.assign({}, l, { id: uid() }); }), secs: x.secs || [] });
      };
    });
  }
  function renderLists() { var d = $("dlists"); if (!d) return; d.innerHTML = listsHtml(); bindLists(d, renderLists); }
  function openHistory() {
    sheet('<h3>' + esc(T("myLists")) + "</h3>" + listsHtml() + '<div class="acts"><button class="btn" id="hC">' + esc(T("back")) + "</button></div>", function (root) {
      $("hC").onclick = closeSheet; bindLists(root, openHistory);
    });
  }

  // ---------- yuborish ----------
  function whoNow() { return S.me ? S.me : S.who; }
  function listText(num) {
    var w = whoNow(), out = [T("txtList") + (num ? " №" + num : "")];
    out.push(T("txtUsta") + ": " + String(w.name || "").trim() + (w.phone ? ", " + String(w.phone).trim() : ""));
    if (S.object.trim()) out.push(T("txtObj") + ": " + S.object.trim());
    out.push("");
    totals().forEach(function (l, i) { out.push((i + 1) + ". " + lineLabel(l) + " — " + fmtQ(l.qty) + " " + (l.unit || "")); });
    if (S.note.trim()) { out.push(""); out.push(T("txtNote") + ": " + S.note.trim()); }
    return out.join("\n");
  }
  function send() {
    if (S.sending) return;
    var d = digits(S.who.phone);
    if (!S.me && (S.who.name.trim().length < 2 || d.length < 9)) { S.editWho = true; renderWho(); toast(d.length && d.length < 9 ? T("errPhone") : T("needWho")); (S.who.name.trim().length < 2 ? $("wName") : $("wPhone")).focus(); return; }
    if (!S.lines.length) { toast(T("needLines")); $("q").focus(); return; }
    var noQ = S.lines.find(function (l) { return !l.qty; });
    if (noQ) {
      toast(T("needQty"));
      if (isDesk()) { if (S.view === "total") { S.view = "list"; renderSecs(); renderList(); } var f = document.querySelector('.ln[data-id="' + noQ.id + '"] .qin'); if (f) { f.focus(); return; } }
      openPicker(noQ, false); return;
    }
    if (PREVIEW) { sent("—", listText("")); return; }
    S.sending = true; renderSend();
    // bizga — jami (hamma bo'limlar qo'shilgan); bo'limlar faqat ustaning o'zida qoladi
    var payload = { key: S.me ? S.key : "", name: S.who.name.trim(), phone: S.who.phone.trim(), object: S.object.trim(), note: S.note.trim(), lines: totals().map(function (l) {
      return { name: l.name, vars: (l.vars || []).filter(Boolean).join(" "), size: l.size || "", qty: String(l.qty), unit: l.unit || "", raw: l.raw || "", known: !!l.known, cat: l.cat || "", pid: l.pid || "" };
    }) };
    fetch(CFG.url + "/rest/v1/rpc/usta_submit", {
      method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.key, Authorization: "Bearer " + CFG.key },
      body: JSON.stringify({ p: payload }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
      S.sending = false;
      if (!x.ok) { var m = String((x.j && x.j.message) || ""); renderSend(); if (/usta_key/.test(m)) { keyLost(); return; } toast(/usta_rate/.test(m) ? T("errRate") : /usta_phone/.test(m) ? T("errPhone") : T("err")); return; }
      var num = x.j && x.j.num;
      var text = listText(num);
      S.hist.unshift({ num: num, at: Date.now(), object: S.object.trim(), lines: S.lines.map(function (l) { return Object.assign({}, l); }), secs: S.secs.slice() });
      S.hist = S.hist.slice(0, 20); store(K.hist, S.hist);
      S.editWho = false;
      // yuborilgan ro'yxat «saqlanganlar»dan chiqadi (u endi «yuborilganlar»da)
      S.lists = S.lists.filter(function (y) { return y.id !== S.listId; }); store(K.lists, S.lists);
      S.listId = uid(); S.lines = []; S.secs = []; S.cur = ""; S.view = "list"; S.note = ""; S.object = ""; save();
      shell();
      sent(num, text);
    }).catch(function () { S.sending = false; renderSend(); toast(T("err")); });
  }
  function sent(num, text) {
    if (PREVIEW) {
      sheet('<h3>' + esc(T("previewSentT")) + '</h3><div class="d">' + esc(T("previewSentD")) + '</div><textarea class="inp" readonly style="min-height:220px;font-size:13px">' + esc(text) + '</textarea><div class="acts"><button class="btn pri" id="pvOk">OK</button></div>', function () { $("pvOk").onclick = closeSheet; });
      return;
    }
    sheet('<div class="center"><div class="ok-ic">✓</div><h3>' + esc(T("sentT")) + '</h3><div class="d" style="margin:0">' + esc(T("sentD")) + '</div><div class="num">№' + esc(num) + "</div></div>" +
      '<button class="btn pri big" id="sTg">' + esc(T("share")) + '</button><div class="acts"><button class="btn" id="sCopy">' + esc(T("copy")) + '</button><button class="btn" id="sNew">' + esc(T("newList")) + "</button></div>", function () {
      $("sTg").onclick = function () {
        if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
        window.open("https://t.me/share/url?url=" + encodeURIComponent(text), "_blank");
      };
      $("sCopy").onclick = function () {
        var done = function () { toast(T("copied")); };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); }); else { fallbackCopy(text); done(); }
      };
      $("sNew").onclick = function () { closeSheet(); $("q").focus(); };
    });
  }
  function fallbackCopy(t) { var a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); } catch (e) {} a.remove(); }

  function keyLost() { S.me = null; S.keyBad = true; S.key = ""; store(K.key, ""); if (!S.who.name || !S.who.phone) S.editWho = true; renderWho(); toast(T("keyBad")); }
  function checkKey() {
    if (!S.key) return;
    fetch(CFG.url + "/rest/v1/rpc/usta_me", {
      method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.key, Authorization: "Bearer " + CFG.key },
      body: JSON.stringify({ p_key: S.key }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
      if (x.ok && x.j && x.j.name) { S.me = { name: x.j.name, phone: x.j.phone || "" }; S.keyBad = false; store(K.key, S.key); S.editWho = false; renderWho(); loadBase(); return; }
      if (/usta_key/.test(String((x.j && x.j.message) || ""))) keyLost();
    }).catch(function () { /* internet yo'q — keyin yuborishda tekshiriladi */ if (S.key) { S.me = S.me || null; } });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && $("sheetBg")) { closeSheet(); var q = $("q"); if (q && isDesk()) q.focus(); }
  });
  shell();
  checkKey();
})();
