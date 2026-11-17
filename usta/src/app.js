/* Usta ro'yxati — sahifa. Ma'lumot: localStorage (qoralama, ism/telefon, oldingi ro'yxatlar), yuborish — usta_submit (Supabase). */
(function () {
  var CFG = window.USTA_CFG || {};
  var E = ENGINE;
  var K = { draft: "usta.v1.draft", who: "usta.v1.who", lang: "usta.v1.lang", hist: "usta.v1.hist" };
  var load = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
  var store = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  var draft = load(K.draft, {});
  var S = {
    lang: load(K.lang, (navigator.language || "").indexOf("ru") === 0 ? "ru" : "uz"),
    who: load(K.who, { name: "", phone: "" }), editWho: false,
    object: draft.object || "", note: draft.note || "", lines: Array.isArray(draft.lines) ? draft.lines : [],
    hist: load(K.hist, []), fresh: null, sending: false,
  };
  if (!S.who.name || !S.who.phone) S.editWho = true;
  var T = function (k) { return (I18N[S.lang] || I18N.uz)[k] || k; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
  var fmtQ = function (n) { return n == null || n === "" ? "?" : String(Math.round(Number(n) * 1000) / 1000).replace(".", ","); };
  var save = function () { store(K.draft, { object: S.object, note: S.note, lines: S.lines }); };
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
    $("app").innerHTML =
      '<div class="wrap">' +
      '<div class="top"><div class="logo">T</div><div><h1>' + esc(T("title")) + '</h1><div class="s">' + esc(T("sub")) + '</div></div>' +
      '<div class="lang"><button data-l="uz" class="' + (S.lang === "uz" ? "on" : "") + '">UZ</button><button data-l="ru" class="' + (S.lang === "ru" ? "on" : "") + '">RU</button></div></div>' +
      '<div class="card" id="who"></div>' +
      '<div class="card"><div class="lbl">' + esc(T("object")) + '</div><input class="inp" id="obj" placeholder="' + esc(T("objectPh")) + '" value="' + esc(S.object) + '" maxlength="200"></div>' +
      '<div class="tools"><button class="btn" id="bCat">☰ ' + esc(T("catalog")) + '</button><button class="btn" id="bPaste">⧉ ' + esc(T("paste")) + '</button></div>' +
      '<div id="list"></div>' +
      '<div class="card" id="noteBox"><div class="lbl">' + esc(T("note")) + '</div><input class="inp" id="note" placeholder="' + esc(T("notePh")) + '" value="' + esc(S.note) + '" maxlength="1000"></div>' +
      '<div class="row" style="justify-content:space-between;margin-top:6px"><button class="link" id="bHist" style="margin-left:0">↺ ' + esc(T("history")) + '</button><button class="link" id="bClear">' + esc(T("clear")) + '</button></div>' +
      '</div>' +
      '<div class="dock"><div class="in"><div class="sug" id="sug"></div>' +
      '<div class="compose"><input class="inp" id="q" placeholder="' + esc(T("inputPh")) + '" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"><button class="btn pri" id="bAdd" aria-label="' + esc(T("add")) + '">+</button></div>' +
      '<div class="sendbar"><button class="btn pri big" id="bSend"></button></div></div></div>';
    document.querySelectorAll(".lang button").forEach(function (b) { b.onclick = function () { S.lang = b.dataset.l; store(K.lang, S.lang); shell(); }; });
    $("obj").oninput = function (e) { S.object = e.target.value; save(); };
    $("note").oninput = function (e) { S.note = e.target.value; save(); };
    $("bCat").onclick = function () { openCatalog(); };
    $("bPaste").onclick = openPaste;
    $("bHist").onclick = openHistory;
    $("bClear").onclick = function () { if (!S.lines.length) return; confirmSheet(T("clearQ"), function () { S.lines = []; save(); renderList(); }); };
    var q = $("q");
    q.oninput = renderSug;
    q.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); acceptTop(); } };
    q.onpaste = function (e) {
      var txt = (e.clipboardData || window.clipboardData).getData("text") || "";
      if (/\n/.test(txt.trim())) { e.preventDefault(); addMany(txt); }
    };
    $("bAdd").onclick = acceptTop;
    $("bSend").onclick = send;
    renderWho(); renderList(); renderSug();
  }

  function renderWho() {
    var w = $("who");
    if (!S.editWho) {
      w.innerHTML = '<div class="who"><div><div class="lbl" style="margin:0">' + esc(T("who")) + '</div><b>' + esc(S.who.name) + '</b> <span class="ph">' + esc(S.who.phone) + '</span></div><button class="link" id="bWho">' + esc(T("edit")) + '</button></div>';
      $("bWho").onclick = function () { S.editWho = true; renderWho(); };
      return;
    }
    w.innerHTML = '<div class="lbl">' + esc(T("who")) + '</div><div class="grid2">' +
      '<input class="inp" id="wName" placeholder="' + esc(T("name")) + '" value="' + esc(S.who.name) + '" maxlength="80" autocomplete="name">' +
      '<input class="inp" id="wPhone" type="tel" inputmode="tel" placeholder="+998 90 123 45 67" value="' + esc(S.who.phone) + '" maxlength="30" autocomplete="tel"></div>';
    $("wName").oninput = function (e) { S.who.name = e.target.value; store(K.who, S.who); };
    $("wPhone").oninput = function (e) { S.who.phone = e.target.value; store(K.who, S.who); };
  }

  // ---------- ro'yxat ----------
  function renderList() {
    var L = $("list");
    if (!S.lines.length) {
      L.innerHTML = '<div class="card empty"><b>' + esc(T("emptyT")) + '</b>' + esc(T("emptyD")) + '</div>';
    } else {
      L.innerHTML = S.lines.map(function (l, i) {
        var chips = (l.vars || []).filter(Boolean).map(function (v) { return '<span class="tag">' + esc(v) + '</span>'; }).join("") + (l.size ? '<span class="tag sz">' + esc(l.size) + '</span>' : "");
        if (!l.known) chips = '<span class="tag w">? ' + esc(T("unknown")) + '</span>';
        return '<div class="ln' + (l.known ? "" : " unk") + (S.fresh === l.id ? " fresh" : "") + '" data-id="' + l.id + '"><div class="n">' + (i + 1) + '</div>' +
          '<div class="t" data-act="edit"><div class="nm">' + esc(l.name) + '</div><div class="ch">' + chips + '</div></div>' +
          '<div class="qty' + (l.qty ? "" : " none") + '"><button data-act="minus">−</button><div class="v" data-act="edit">' + fmtQ(l.qty) + '<small>' + esc(l.unit || "") + '</small></div><button data-act="plus">+</button></div></div>';
      }).join("");
      L.querySelectorAll(".ln").forEach(function (el) {
        el.onclick = function (e) {
          var act = e.target.closest("[data-act]"); if (!act) return;
          var l = S.lines.find(function (x) { return x.id === el.dataset.id; }); if (!l) return;
          var a = act.dataset.act;
          if (a === "edit") return openPicker(l, false);
          var st = 1, cur = Number(l.qty) || 0;
          l.qty = a === "plus" ? cur + st : Math.max(0, cur - st);
          if (!l.qty) l.qty = a === "plus" ? 1 : null;
          save(); renderList();
        };
      });
      if (S.fresh) { var f = L.querySelector(".fresh"); if (f && f.scrollIntoView) f.scrollIntoView({ block: "nearest", behavior: "smooth" }); S.fresh = null; }
    }
    renderSend();
  }
  function renderSend() {
    var b = $("bSend"); if (!b) return;
    var n = S.lines.length;
    b.textContent = S.sending ? T("sending") : T("send") + (n ? " · " + n + " " + T("items") : "");
    b.disabled = S.sending;
  }
  function addLine(l) {
    l.id = l.id || uid();
    var same = l.known && S.lines.find(function (x) { return x.known && lineLabel(x) === lineLabel(l) && x.unit === l.unit; });
    if (same) { same.qty = (Number(same.qty) || 0) + (Number(l.qty) || 0) || null; S.fresh = same.id; }
    else { S.lines.push(l); S.fresh = l.id; }
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
  function renderSug() {
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
  function clearInput() { var q = $("q"); q.value = ""; renderSug(); }
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
      if (r && r.score >= 0.8) { var l = fromResult(r, row); if (l.qty == null) l.qty = null; S.lines.push(Object.assign(l, { id: uid() })); known++; }
      else S.lines.push(Object.assign(freeLine(row), { id: uid() }));
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
  function confirmSheet(text, yes) {
    sheet('<h3>' + esc(text) + '</h3><div class="acts"><button class="btn" id="cNo">' + esc(T("cancel")) + '</button><button class="btn pri" id="cYes">' + esc(T("yes")) + "</button></div>", function () {
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
      } else {
        h += '<h3>' + esc(T("unknown")) + "</h3>";
        h += '<input class="inp" id="pText" value="' + esc(l.name) + '" maxlength="200">';
        h += '<div class="sug" id="pSug" style="box-shadow:none;margin-top:8px"></div>';
      }
      var quick = l.unit === "м" ? [10, 20, 50, 100, 200] : [1, 2, 5, 10, 20, 50];
      h += '<div class="lbl grp">' + esc(T("qty")) + '</div><div class="qbig"><button id="pMinus">−</button><input class="inp" id="pQty" inputmode="decimal" value="' + (l.qty ? fmtQ(l.qty) : "") + '" placeholder="0"><button id="pPlus">+</button><span class="u">' + esc(l.unit) + "</span></div>";
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
      $("pMinus").onclick = function () { var v = qtyVal() || 0; qi.value = v > 1 ? fmtQ(v - 1) : ""; };
      $("pPlus").onclick = function () { var v = qtyVal() || 0; qi.value = fmtQ(v + 1); };
      root.querySelectorAll("[data-q]").forEach(function (b) { b.onclick = function () { qi.value = b.dataset.q; }; });
      qi.onkeydown = function (e) { if (e.key === "Enter") ok(); };
      $("pOk").onclick = ok;
      if ($("pCancel")) $("pCancel").onclick = function () { closeSheet(); $("q").focus(); };
      if ($("pDel")) $("pDel").onclick = function () { S.lines = S.lines.filter(function (x) { return x.id !== l.id; }); save(); closeSheet(); renderList(); };
      if (!it || !sizes.length || l.size) { if (!l.qty) setTimeout(function () { qi.focus(); }, 60); }
    }
    function qtyVal() { var q = $("pQty"); return q ? E.parseQty(q.value) : l.qty; }
    function ok() {
      l.qty = qtyVal();
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
  function openHistory() {
    var h = '<h3>' + esc(T("history")) + "</h3>";
    if (!S.hist.length) h += '<div class="d">' + esc(T("noHistory")) + "</div>";
    h += S.hist.map(function (x, i) {
      return '<div class="hist"><div class="t"><b>№' + esc(x.num) + " · " + esc(new Date(x.at).toLocaleDateString(S.lang === "ru" ? "ru-RU" : "uz-UZ")) + '</b>' + esc(x.object || "") + " · " + x.lines.length + " " + esc(T("items")) + '</div><button class="btn sm" data-h="' + i + '">' + esc(T("open")) + "</button></div>";
    }).join("");
    h += '<div class="acts"><button class="btn" id="hC">' + esc(T("back")) + "</button></div>";
    sheet(h, function (root) {
      $("hC").onclick = closeSheet;
      root.querySelectorAll("[data-h]").forEach(function (b) {
        b.onclick = function () {
          var x = S.hist[Number(b.dataset.h)];
          x.lines.forEach(function (l) { S.lines.push(Object.assign({}, l, { id: uid() })); });
          if (!S.object && x.object) S.object = x.object;
          save(); closeSheet(); shell();
        };
      });
    });
  }

  // ---------- yuborish ----------
  function listText(num) {
    var out = [T("txtList") + (num ? " №" + num : "")];
    out.push(T("txtUsta") + ": " + S.who.name.trim() + ", " + S.who.phone.trim());
    if (S.object.trim()) out.push(T("txtObj") + ": " + S.object.trim());
    out.push("");
    S.lines.forEach(function (l, i) { out.push((i + 1) + ". " + lineLabel(l) + " — " + fmtQ(l.qty) + " " + (l.unit || "")); });
    if (S.note.trim()) { out.push(""); out.push(T("txtNote") + ": " + S.note.trim()); }
    return out.join("\n");
  }
  function send() {
    if (S.sending) return;
    var d = digits(S.who.phone);
    if (S.who.name.trim().length < 2 || d.length < 9) { S.editWho = true; renderWho(); toast(d.length && d.length < 9 ? T("errPhone") : T("needWho")); (S.who.name.trim().length < 2 ? $("wName") : $("wPhone")).focus(); return; }
    if (!S.lines.length) { toast(T("needLines")); $("q").focus(); return; }
    var noQ = S.lines.find(function (l) { return !l.qty; });
    if (noQ) { toast(T("needQty")); openPicker(noQ, false); return; }
    S.sending = true; renderSend();
    var payload = { name: S.who.name.trim(), phone: S.who.phone.trim(), object: S.object.trim(), note: S.note.trim(), lines: S.lines.map(function (l) {
      return { name: l.name, vars: (l.vars || []).filter(Boolean).join(" "), size: l.size || "", qty: String(l.qty), unit: l.unit || "", raw: l.raw || "", known: !!l.known, cat: l.cat || "" };
    }) };
    fetch(CFG.url + "/rest/v1/rpc/usta_submit", {
      method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.key, Authorization: "Bearer " + CFG.key },
      body: JSON.stringify({ p: payload }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
      S.sending = false;
      if (!x.ok) { var m = String((x.j && x.j.message) || ""); renderSend(); toast(/usta_rate/.test(m) ? T("errRate") : /usta_phone/.test(m) ? T("errPhone") : T("err")); return; }
      var num = x.j && x.j.num;
      var text = listText(num);
      S.hist.unshift({ num: num, at: Date.now(), object: S.object.trim(), lines: S.lines.map(function (l) { return Object.assign({}, l); }) });
      S.hist = S.hist.slice(0, 10); store(K.hist, S.hist);
      S.editWho = false;
      S.lines = []; S.note = ""; S.object = ""; save();
      shell();
      sent(num, text);
    }).catch(function () { S.sending = false; renderSend(); toast(T("err")); });
  }
  function sent(num, text) {
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

  shell();
})();
