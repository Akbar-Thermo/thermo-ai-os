// ===== Sayt: forma, tariflar, saqlash, yuklab olish =====
(() => {
  const LS = { state: "isitish.v1.state", tariffs: "isitish.v1.tariffs", profile: "isitish.v1.profile", saved: "isitish.v1.saved" };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* saqlash bo'lmasa ham ishlayveradi */ } };
  const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const { num, AUTO, DEFAULT_INPUT, DEFAULT_TARIFFS, DEFAULT_MONTHS, HP_MODELS, INF } = CALC;
  const fmt = RENDER.fmt, mln = RENDER.mln;

  const saved0 = load(LS.state, null) || {};
  const st = {
    lang: saved0.lang === "ru" ? "ru" : "uz",
    tab: "calc",
    input: Object.assign(clone(DEFAULT_INPUT), saved0.input || {}),
    tariffs: Object.assign(clone(DEFAULT_TARIFFS), load(LS.tariffs, null) || {}),
    profile: Object.assign({ company: "", manager: "", phone: "", logo: null }, load(LS.profile, null) || {}),
    saved: load(LS.saved, []) || [],
  };
  // Thermo AI OS ichida ochilganda: til programma tilidan, menejer va kompaniya — kirgan foydalanuvchidan
  const host = window.__ISITISH_HOST || null;
  if (host) {
    if (host.lang === "ru" || host.lang === "uz") st.lang = host.lang;
    if (!st.profile.manager && host.user) st.profile.manager = host.user;
    if (!st.profile.company && host.company) st.profile.company = host.company;
  }
  st.input.sys = Object.assign({ eb: true, hp: true, gb: true }, st.input.sys || {});
  st.input.price = Object.assign(clone(DEFAULT_INPUT.price), st.input.price || {});
  st.input.ov = st.input.ov || {};
  let L = I18N[st.lang], res = null, svgs = [];
  const root = document.getElementById("app");

  const getPath = (path) => path.split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), st);
  function setPath(path, val) {
    const ks = path.split("."); let o = st;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] === null || o[ks[i]] === undefined) o[ks[i]] = {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = val;
  }
  function persist() {
    store(LS.state, { lang: st.lang, input: st.input });
    store(LS.tariffs, st.tariffs); store(LS.profile, st.profile); store(LS.saved, st.saved);
  }
  const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`; };

  // ---------- forma qismlari ----------
  const val = (path) => { const v = getPath(path); return v === null || v === undefined ? "" : v; };
  const text = (label, path, ph = "", extra = "") => `<label class="fld"><span class="lbl">${esc(label)}</span><input type="text" data-path="${path}" value="${esc(val(path))}" placeholder="${esc(ph)}" ${extra}></label>`;
  const number = (label, path, ph = "") => text(label, path, ph, 'inputmode="decimal" autocomplete="off"');
  const seg = (path, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-set="${path}" data-val="${esc(v)}" class="${String(getPath(path)) === String(v) ? "on" : ""}" aria-pressed="${String(getPath(path)) === String(v)}">${esc(l)}</button>`).join("")}</div>`;
  const autoFld = (label, key, compact = false) => `<label class="fld auto${compact ? " compact" : ""}" data-auto="${key}">${label ? `<span class="lbl">${esc(label)}</span>` : ""}<span class="inp"><input type="text" inputmode="decimal" autocomplete="off" data-path="input.ov.${key}" value="${esc(val("input.ov." + key))}" aria-label="${esc(label || key)}"><button type="button" class="rst" data-reset="${key}" title="${esc(L.reset)}" aria-label="${esc(L.reset)}" hidden>↺</button></span>${compact ? "" : '<span class="hint"></span>'}</label>`;
  const capFld = (s, k) => `<span class="fld auto compact" data-auto="cap_${s}${k}"><span class="inp"><input type="text" inputmode="decimal" autocomplete="off" data-path="input.ov.cap_${s}${k}" value="${esc(val(`input.ov.cap_${s}${k}`))}" aria-label="${esc(`${L.sys[s]} — ${k === "A" ? L.equipA : L.equipB}, ${L.kw}`)}"><button type="button" class="rst" data-reset="cap_${s}${k}" title="${esc(L.reset)}" aria-label="${esc(L.reset)}" hidden>↺</button></span></span>`;
  const card = (title, body, cls = "") => `<section class="card ${cls}"><h2>${esc(title)}</h2>${body}</section>`;

  function formHtml() {
    const sysRow = (s) => `<div class="sysrow"><label class="chk"><input type="checkbox" data-path="input.sys.${s}" ${st.input.sys[s] ? "checked" : ""}><span class="dot" style="background:${RENDER.SERIES[s + "A"]}"></span>${esc(L.sys[s])}</label>
      <input type="text" inputmode="decimal" autocomplete="off" data-path="input.price.${s}.0" value="${esc(val(`input.price.${s}.0`))}" placeholder="$" aria-label="${esc(L.sys[s] + " — " + L.priceA)}">
      <input type="text" inputmode="decimal" autocomplete="off" data-path="input.price.${s}.1" data-priceb="${s}" value="${esc(val(`input.price.${s}.1`))}" aria-label="${esc(L.sys[s] + " — " + L.priceB)}"></div>`;
    const hpBlock = (k) => `<div class="sub"><h4>${esc(L.state[k])}</h4><div class="grid2">
      <label class="fld"><span class="lbl">${esc(L.hpModel)}</span><select data-path="input.ov.hpModel${k}" data-hpsel="${k}"><option value="">${esc(L.hpAuto)}</option>${HP_MODELS.map((m) => `<option value="${m.id}" ${st.input.ov["hpModel" + k] === m.id ? "selected" : ""}>${m.id} · ${m.nom} ${esc(L.kw)}</option>`).join("")}</select></label>
      ${autoFld(L.hpCount, "hpCount" + k)}${autoFld(L.hpCap, "hpCap" + k)}${autoFld(L.hpPow, "hpPow" + k)}${autoFld(L.backup, "backup" + k)}</div></div>`;
    return `
    ${card(L.secObject, `<div class="grid2">${text(L.client, "input.client", L.clientPh)}${text(L.object, "input.object", L.objectPh)}${number(L.area, "input.area", "450")}
      <div class="fld"><span class="lbl">${esc(L.customer)}</span>${seg("input.customer", [["res", L.custRes], ["biz", L.custBiz]])}</div></div>`)}
    ${card(L.secLoad, `<div class="loadrow"><label class="chk"><input type="checkbox" data-path="input.useA" ${st.input.useA ? "checked" : ""}>${esc(L.loadA)}</label><input type="text" inputmode="decimal" autocomplete="off" data-path="input.loadA" value="${esc(val("input.loadA"))}" aria-label="${esc(L.loadA)}"></div>
      <div class="loadrow"><label class="chk"><input type="checkbox" data-path="input.useB" ${st.input.useB ? "checked" : ""}>${esc(L.loadB)}</label><input type="text" inputmode="decimal" autocomplete="off" data-path="input.loadB" value="${esc(val("input.loadB"))}" aria-label="${esc(L.loadB)}"></div>
      <p class="hint">${esc(L.loadHint)}</p>
      <div class="fld"><span class="lbl">${esc(L.supply)}</span>${seg("input.supply", [[45, L.sup45], [55, L.sup55], [70, L.sup70]])}</div>`)}
    ${card(L.secSystems, `<div class="sysrow head"><span></span><span>${esc(L.priceA)}</span><span>${esc(L.priceB)}</span></div>${["eb", "hp", "gb"].map(sysRow).join("")}
      <p class="hint">${esc(L.priceHint)}</p>${number(L.insulPrice, "input.insulPrice", "0")}<p class="hint">${esc(L.insulHint)}</p>`)}
    ${card(L.secEquip, `<div class="sysrow head"><span></span><span>${esc(L.equipA)}</span><span>${esc(L.equipB)}</span></div>${["eb", "hp", "gb"].map((s) => `<div class="sysrow"><span class="chk"><span class="dot" style="background:${RENDER.SERIES[s + "A"]}"></span>${esc(L.sys[s])}</span>${capFld(s, "A")}${capFld(s, "B")}</div>`).join("")}<p class="hint">${esc(L.equipHint)}</p>`)}
    ${card(L.secTen, `<div class="grid2">${number(L.growth, "input.growth")}${number(L.usd, "input.usd")}</div>`)}
    ${card(L.secProfile, `<div class="grid2">${text(L.company, "profile.company")}${text(L.manager, "profile.manager")}${text(L.phone, "profile.phone", "+998")}
      <div class="fld"><span class="lbl">${esc(L.logo)}</span><div class="logo-row"><label class="btn small"><input type="file" accept="image/*" data-logo hidden>${esc(L.logoPick)}</label>${st.profile.logo ? `<img class="logo-prev" src="${st.profile.logo.data}" alt=""><button type="button" class="btn small ghost" data-logo-remove>${esc(L.logoRemove)}</button>` : ""}</div></div></div><p class="hint">${esc(L.profileHint)}</p>`)}
    <details class="card adv"><summary><h2>${esc(L.secAdvanced)}</h2></summary><p class="hint">${esc(L.advHint)}</p>
      <h3>${esc(L.grpClimate)}</h3><div class="grid3">${autoFld(L.tIn, "tIn")}${autoFld(L.tDes, "tDes")}${autoFld(L.gain, "gain")}</div>
      <h3>${esc(L.grpBase)}</h3><div class="grid2">${autoFld(L.baseEl, "baseEl")}${autoFld(L.baseGas, "baseGas")}</div>
      <h3>${esc(L.grpEff)}</h3><div class="grid3">${autoFld(L.effEb, "effEb")}${autoFld(L.effGb, "effGb")}${autoFld(L.gasKwh, "gasKwh")}</div>
      <h3>${esc(L.grpHp)}</h3>${hpBlock("A")}${hpBlock("B")}
      <h3>${esc(L.grpMonths)}</h3><div class="mtab"><span></span><span>${esc(L.colDays)}</span><span>${esc(L.colTemp)}</span><span>${esc(L.colCop)}</span>
        ${DEFAULT_MONTHS.map((m) => `<span class="mname">${esc(L.monthsFull[m.key])}</span>${autoFld("", "days_" + m.key, true)}${autoFld("", "t_" + m.key, true)}${autoFld("", "cop_" + m.key, true)}`).join("")}</div>
    </details>`;
  }

  function tariffsHtml() {
    const t = st.tariffs;
    const tn = (path, label) => `<input type="text" inputmode="decimal" autocomplete="off" data-tpath="${path}" value="${esc(getPath(path))}" aria-label="${esc(label)}">`;
    const changed = JSON.stringify(t) !== JSON.stringify(DEFAULT_TARIFFS);
    return `<div class="single">${card(L.tarTitle, `<p class="hint">${esc(L.tarHint)}</p>
      ${text(L.tarDate, "tariffs.date")}
      <h3>${esc(L.tarElecRes)}</h3><div class="ttab"><span class="th">${esc(L.tarUpTo)}</span><span class="th">${esc(L.tarPriceKwh)}</span>
        ${t.elecRes.map((r, i) => `${r[0] >= INF / 2 ? `<span class="tcell">${esc(L.tarAbove)}</span>` : tn(`tariffs.elecRes.${i}.0`, L.tarUpTo)}${tn(`tariffs.elecRes.${i}.1`, L.tarPriceKwh)}`).join("")}</div>
      <label class="fld narrow"><span class="lbl">${esc(L.tarElecBiz)}</span>${tn("tariffs.elecBiz", L.tarElecBiz)}</label>
      <h3>${esc(L.tarGasRes)}</h3><div class="grid3"><label class="fld"><span class="lbl">${esc(L.tarNormW)}</span>${tn("tariffs.gasNormWinter", L.tarNormW)}</label><label class="fld"><span class="lbl">${esc(L.tarNormO)}</span>${tn("tariffs.gasNormOther", L.tarNormO)}</label><label class="fld"><span class="lbl">${esc(L.tarGasBase)}</span>${tn("tariffs.gasBasePrice", L.tarGasBase)}</label></div>
      <div class="ttab"><span class="th">${esc(L.tarUpToM3)}</span><span class="th">${esc(L.tarPriceM3)}</span>
        ${t.gasRes.map((r, i) => `${r[0] >= INF / 2 ? `<span class="tcell">${esc(L.tarAbove)}</span>` : tn(`tariffs.gasRes.${i}.0`, L.tarUpToM3)}${tn(`tariffs.gasRes.${i}.1`, L.tarPriceM3)}`).join("")}</div>
      <label class="fld narrow"><span class="lbl">${esc(L.tarGasBiz)}</span>${tn("tariffs.gasBiz", L.tarGasBiz)}</label>
      <p class="hint">${esc(L.tarSource)}</p>
      <div class="actions">${changed ? `<span class="badge">${esc(L.tarChanged)}</span>` : ""}<button type="button" class="btn ghost" data-act="tar-reset">${esc(L.tarReset)}</button></div>`)}</div>`;
  }

  function savedHtml() {
    const items = st.saved.map((s) => `<li><div><b>${esc(s.name || L.unnamed)}</b><span class="hint">${esc(s.date)}</span></div><div class="actions"><button type="button" class="btn small" data-act="open" data-id="${esc(s.id)}">${esc(L.open)}</button><button type="button" class="btn small ghost" data-act="del" data-id="${esc(s.id)}">${esc(L.del)}</button></div></li>`).join("");
    return `<div class="single">${card(L.tabSaved, (st.saved.length ? `<ul class="saved">${items}</ul>` : `<p class="empty">${esc(L.savedEmpty)}</p>`) + `<p class="hint">${esc(L.savedNote)}</p>`)}</div>`;
  }

  function shell() {
    document.documentElement.lang = st.lang;
    document.title = L.appTitle;
    const tab = (id, label) => `<button type="button" class="tab ${st.tab === id ? "on" : ""}" data-tab="${id}" aria-current="${st.tab === id ? "page" : "false"}">${esc(label)}</button>`;
    let main;
    if (st.tab === "tariffs") main = tariffsHtml();
    else if (st.tab === "saved") main = savedHtml();
    else main = `<div class="cols"><form class="form" autocomplete="off" onsubmit="return false">${formHtml()}</form>
      <div class="out"><section class="card" id="result"></section>
        <section class="card"><div class="bar"><h2>${esc(L.preview)}</h2><div class="actions"><button type="button" class="btn" data-act="pdf">${esc(L.btnPdf)}</button><button type="button" class="btn ghost" data-act="save">${esc(L.btnSave)}</button><button type="button" class="btn ghost" data-act="new">${esc(L.btnNew)}</button></div></div>
        <div id="dlbar" class="dlbar" hidden><span></span><button type="button" class="btn" data-act="pending">${esc(L.saveNow)}</button></div><div id="pages"></div></section></div></div>`;
    root.className = st.tab === "calc" ? "split" : "";
    root.innerHTML = `<header class="top"><div class="brand"><span class="mark" aria-hidden="true"></span><div><h1>${esc(L.appTitle)}</h1><p>${esc(L.appSub)}</p></div></div>
      <div class="lang seg" role="group"><button type="button" data-lang="uz" class="${st.lang === "uz" ? "on" : ""}">O‘zbekcha</button><button type="button" data-lang="ru" class="${st.lang === "ru" ? "on" : ""}">Русский</button></div></header>
      <nav class="tabs">${tab("calc", L.tabCalc)}${tab("tariffs", L.tabTariffs)}${tab("saved", L.tabSaved)}</nav><main>${main}</main><div id="toast" role="status" aria-live="polite"></div>`;
    if (st.tab === "calc") update();
  }

  // ---------- qayta hisoblash ----------
  function autoValues() {
    const a = { tIn: AUTO.tIn, tDes: AUTO.tDes, gain: AUTO.gain, baseEl: st.input.customer === "biz" ? AUTO.baseElBiz : AUTO.baseElRes,
      baseGas: AUTO.baseGas, effEb: AUTO.effEb * 100, effGb: AUTO.effGb * 100, gasKwh: AUTO.gasKwh };
    for (const k of ["A", "B"]) {
      const h = res.hpInfo[k];
      a["hpCount" + k] = h ? h.countAuto : null; a["hpCap" + k] = h ? h.capAuto : null; a["hpPow" + k] = h ? h.powAuto : null;
      a["backup" + k] = h ? h.backupAuto : (k === "A" ? AUTO.backupA : AUTO.backupB);
    }
    for (const s of ["eb", "hp", "gb"]) for (const k of ["A", "B"]) a[`cap_${s}${k}`] = CALC.equipAuto(s, st.input["load" + k]);
    for (const m of res.months) { const d = DEFAULT_MONTHS.find((x) => x.key === m.key); a["days_" + m.key] = d.days; a["t_" + m.key] = d.t; a["cop_" + m.key] = m.copAuto; }
    return a;
  }
  const autoFmt = (v) => (v === null || v === undefined ? "—" : fmt(v, Math.abs(v % 1) < 1e-9 ? 0 : Math.abs((v * 10) % 1) < 1e-9 ? 1 : 2));

  function update() {
    res = CALC.compute(st.input, st.tariffs);
    persist();
    if (st.tab !== "calc") return;
    const a = autoValues();
    root.querySelectorAll("[data-auto]").forEach((el) => {
      const key = el.dataset.auto, inp = el.querySelector("input"), ov = num(st.input.ov[key]) !== null;
      inp.placeholder = autoFmt(a[key]);
      el.classList.toggle("is-ov", ov);
      el.querySelector(".rst").hidden = !ov;
      const hint = el.querySelector(".hint");
      if (hint) hint.textContent = ov ? `${L.manual} · ${L.auto}: ${autoFmt(a[key])}` : `${L.auto}: ${autoFmt(a[key])}`;
    });
    root.querySelectorAll("[data-priceb]").forEach((el) => { const p0 = num(st.input.price[el.dataset.priceb][0]); el.placeholder = p0 === null ? "$" : fmt(p0); el.title = p0 === null ? "" : L.sameAs; });
    root.querySelectorAll("[data-hpsel]").forEach((el) => { const h = res.hpInfo[el.dataset.hpsel]; el.options[0].textContent = h ? `${L.hpAuto} (${h.autoCount > 1 ? h.autoCount + " × " : ""}${h.autoModel})` : L.hpAuto; });

    const resultEl = document.getElementById("result"), pagesEl = document.getElementById("pages");
    if (!res.variants.length) {
      svgs = [];
      resultEl.innerHTML = `<h2>${esc(L.result)}</h2><p class="empty">${esc(L.noVariants)}</p>`;
      pagesEl.innerHTML = "";
      return;
    }
    const worst = Math.max(...res.variants.map((v) => v.tot.cost));
    resultEl.innerHTML = `<h2>${esc(L.result)} <span class="hint">· ${esc(L.mln)} ${esc(L.perSeason)}</span></h2><ul class="res">${res.variants.map((v) => `<li><span class="dot" style="background:${RENDER.SERIES[v.id]}"></span><span class="nm">${esc(RENDER.vName(L, v))}</span><span class="barwrap"><span class="barfill" style="width:${Math.max(2, v.tot.cost / worst * 100).toFixed(1)}%;background:${RENDER.SERIES[v.id]}"></span></span><b>${mln(v.tot.cost)}</b></li>`).join("")}</ul>`;
    svgs = RENDER.pages(L, { res, input: st.input, tariffs: st.tariffs, profile: st.profile, date: today() });
    schedulePrep();
    pagesEl.innerHTML = svgs.map((s, i) => `<figure class="page"><div class="sheet">${s}</div><figcaption><span>${i + 1}-${esc(L.page)}</span><button type="button" class="btn small" data-act="png" data-page="${i}">${esc(L.btnPng)}</button></figcaption></figure>`).join("");
  }

  // ---------- yuklab olish ----------
  // claude.ai artifakti: fayl faqat "downloads" xizmati orqali saqlanadi (oddiy <a download> u yerda bloklanadi).
  // Xizmat sahifa ochilganidan keyinroq paydo bo'ladi, shuning uchun "yo'q" javobi eslab qolinmaydi — har safar qayta so'raladi.
  // Thermo AI OS ichida (window.__ISITISH_HOST) va oddiy faylda — oddiy yuklab olish.
  const IN_THERMO = !!window.__ISITISH_HOST;
  let dlCap = null, dlWait = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function getDl() {
    if (dlCap) return Promise.resolve(dlCap);
    if (IN_THERMO) return Promise.resolve(null);
    if (!dlWait) dlWait = (async () => {
      for (let i = 0; i < 40 && !(window.claude && window.claude.use); i++) await sleep(100);
      if (!(window.claude && window.claude.use)) return null;
      try { const d = await window.claude.use("downloads"); if (d) dlCap = d; return d || null; } catch (e) { return null; }
    })().finally(() => { dlWait = null; });
    return dlWait;
  }
  getDl();
  function anchorSave(name, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "ok";
  }
  let pending = null; // saqlanmay qolgan tayyor fayl: tugma bosilganda qayta urinish uchun
  async function saveFile(name, blob) {
    if (IN_THERMO) return anchorSave(name, blob);
    const dl = await getDl();
    if (!dl) return window.claude ? "unavailable" : anchorSave(name, blob);
    try { await dl.save({ filename: name, data: blob }); hidePending(); return "ok"; }
    catch (e) {
      const code = (e && e.code) || "unknown";
      if (code === "declined") return "declined";
      if (code === "unavailable" || code === "not_granted" || code === "capability_disabled" || code === "capability_removed") return "unavailable";
      pending = { name, blob }; showPending(name);
      return "pending";
    }
  }
  function showPending(name) {
    const bar = document.getElementById("dlbar"); if (!bar) return;
    bar.querySelector("span").textContent = L.readyFile(name.split(".").pop().toUpperCase());
    bar.hidden = false;
  }
  function hidePending() { pending = null; const bar = document.getElementById("dlbar"); if (bar) bar.hidden = true; }
  function report(r) {
    toast(r === "ok" || r === "pending" ? "" : r === "declined" ? L.downloadDeclined : r === "unavailable" ? L.dlUnavailable : L.downloadFail);
  }
  function svgToCanvas(svg, scale) {
    return new Promise((ok, err) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = RENDER.W * scale; c.height = RENDER.H * scale;
        const g = c.getContext("2d"); g.fillStyle = "#F5F3EE"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); ok(c);
      };
      img.onerror = () => err(new Error("svg"));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }
  const canvasBlob = (c, type, q) => new Promise((ok, err) => c.toBlob((b) => (b ? ok(b) : err(new Error("blob"))), type, q));
  function makePdf(images, wPt, hPt) {
    const enc = new TextEncoder(), chunks = [], offsets = []; let off = 0;
    const push = (d) => { const b = typeof d === "string" ? enc.encode(d) : d; chunks.push(b); off += b.length; };
    const obj = (n, head, stream) => { offsets[n] = off; push(`${n} 0 obj\n${head}\n`); if (stream) { push("stream\n"); push(stream); push("\nendstream\n"); } push("endobj\n"); };
    push("%PDF-1.4\n");
    const n = images.length, kids = images.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
    images.forEach((im, i) => {
      const p = 3 + i * 3, content = enc.encode(`q ${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm /Im0 Do Q`);
      obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
      obj(p + 1, `<< /Length ${content.length} >>`, content);
      obj(p + 2, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`, im.bytes);
    });
    const xref = off, total = 3 + n * 3;
    push(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let i = 1; i < total; i++) push(String(offsets[i]).padStart(10, "0") + " 00000 n \n");
    push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: "application/pdf" });
  }
  const translit = { "‘": "", "’": "", "ʻ": "", "ʼ": "" };
  function fileBase() {
    const raw = (st.input.client || st.input.object || "hisob").trim();
    const cyr = "абвгдеёжзийклмнопрстуфхцчшщъыьэюяқғҳў", lat = ["a", "b", "v", "g", "d", "e", "yo", "j", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f", "x", "ts", "ch", "sh", "sh", "", "i", "", "e", "yu", "ya", "q", "g", "h", "o"];
    const s = raw.toLowerCase().split("").map((ch) => (ch in translit ? translit[ch] : cyr.indexOf(ch) >= 0 ? lat[cyr.indexOf(ch)] : ch)).join("").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    return `Isitish_${s || "hisob"}_${today().split(".").reverse().join("-")}`;
  }
  let busy = false;
  // Fonda tayyorlab qo'yish: infografika o'zgarib 1 soniya tinch tursa, PDF va PNG lar oldindan yasaladi.
  // Shunda tugma bosilganda fayl darhol saqlashga beriladi (kutib qolgan bosish brauzerda bekor bo'lib qolmaydi).
  let prep = { key: "", pdf: null, png: [] }, prepT = null, prepRun = 0;
  async function build(svgList) {
    const png = [], imgs = [];
    for (const sv of svgList) {
      const c = await svgToCanvas(sv, 2);
      png.push(await canvasBlob(c, "image/png"));
      const j = await canvasBlob(c, "image/jpeg", 0.93);
      imgs.push({ bytes: new Uint8Array(await j.arrayBuffer()), w: c.width, h: c.height });
    }
    return { pdf: makePdf(imgs, 285 / 25.4 * 72, 210 / 25.4 * 72), png };
  }
  function schedulePrep() {
    clearTimeout(prepT);
    const key = svgs.join("");
    if (!svgs.length || prep.key === key) return;
    prepT = setTimeout(async () => {
      const run = ++prepRun;
      try { const r = await build(svgs); if (run === prepRun && svgs.join("") === key) prep = { key, ...r }; } catch (e) { /* bosilganda qayta yasaladi */ }
    }, 1000);
  }
  async function ready() {
    const key = svgs.join("");
    if (prep.key === key && prep.pdf) return prep;
    const r = await build(svgs); prep = { key, ...r }; return prep;
  }
  async function exportPng(i) {
    if (busy || !svgs[i]) return; busy = true;
    try { const fresh = prep.key === svgs.join(""); if (!fresh) toast(L.working); const p = await ready(); report(await saveFile(`${fileBase()}_${i + 1}.png`, p.png[i])); }
    catch (e) { toast(L.downloadFail); } finally { busy = false; }
  }
  async function exportPdf() {
    if (busy || !svgs.length) return; busy = true;
    try { const fresh = prep.key === svgs.join(""); if (!fresh) toast(L.working); const p = await ready(); report(await saveFile(`${fileBase()}.pdf`, p.pdf)); }
    catch (e) { toast(L.downloadFail); } finally { busy = false; }
  }
  async function savePending() {
    if (!pending) return;
    const { name, blob } = pending;
    report(await saveFile(name, blob));
  }
  let toastT;
  function toast(msg) {
    const el = document.getElementById("toast"); if (!el) return;
    clearTimeout(toastT); el.textContent = msg; el.classList.toggle("show", !!msg);
    if (msg && msg !== L.working) toastT = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // ---------- hodisalar ----------
  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.tpath) { const n = num(t.value); if (n !== null && n >= 0) { setPath(t.dataset.tpath, n); res = CALC.compute(st.input, st.tariffs); persist(); } return; }
    if (!t.dataset.path || t.type === "checkbox" || t.type === "file") return;
    setPath(t.dataset.path, t.value);
    if (t.dataset.path.startsWith("tariffs.")) { persist(); return; }
    update();
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-logo]")) { const f = t.files && t.files[0]; if (f) readLogo(f); return; }
    if (t.dataset.tpath) { shell(); return; }
    if (t.type === "checkbox" && t.dataset.path) { setPath(t.dataset.path, t.checked); update(); }
    else if (t.tagName === "SELECT" && t.dataset.path) { setPath(t.dataset.path, t.value); update(); }
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.lang) { st.lang = b.dataset.lang; L = I18N[st.lang]; persist(); shell(); return; }
    if (b.dataset.tab) { st.tab = b.dataset.tab; shell(); return; }
    if (b.dataset.set) { const raw = b.dataset.val; setPath(b.dataset.set, /^\d+$/.test(raw) ? +raw : raw); b.parentElement.querySelectorAll("button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); }); update(); return; }
    if (b.dataset.reset) { delete st.input.ov[b.dataset.reset]; const inp = b.parentElement.querySelector("input"); inp.value = ""; update(); inp.focus(); return; }
    if (b.hasAttribute("data-logo-remove")) { st.profile.logo = null; persist(); shell(); return; }
    const act = b.dataset.act;
    if (act === "pending") savePending();
    else if (act === "png") exportPng(+b.dataset.page);
    else if (act === "pdf") exportPdf();
    else if (act === "save") {
      const name = [st.input.client, st.input.object].map((x) => (x || "").trim()).filter(Boolean).join(" · ");
      st.saved.unshift({ id: String(Date.now()), name, date: today(), input: clone(st.input) });
      st.saved = st.saved.slice(0, 60); persist(); toast(L.saved);
    } else if (act === "new") { st.input = clone(DEFAULT_INPUT); persist(); shell(); window.scrollTo(0, 0); }
    else if (act === "open") { const s = st.saved.find((x) => x.id === b.dataset.id); if (s) { st.input = Object.assign(clone(DEFAULT_INPUT), clone(s.input)); st.tab = "calc"; shell(); } }
    else if (act === "del") { st.saved = st.saved.filter((x) => x.id !== b.dataset.id); persist(); shell(); }
    else if (act === "tar-reset") { st.tariffs = clone(DEFAULT_TARIFFS); persist(); shell(); }
  });
  function readLogo(file) {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 480 / img.width, 240 / img.height), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        st.profile.logo = { data: c.toDataURL("image/png"), w: c.width, h: c.height }; persist(); shell();
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  shell();
  window.__isitish = { st, get res() { return res; }, get svgs() { return svgs; } };
})();
