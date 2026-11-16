// ===== Infografika: sof SVG (PNG/PDF ga aylantirish oson bo'lishi uchun) =====
const RENDER = (() => {
  const W = 1425, H = 1050, M = 56, CW = W - 2 * M;
  const FONT = "'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif";
  const C = { bg: "#F5F3EE", panel: "#FDFCFA", border: "#E2DED6", ink: "#14213D", muted: "#5B6472", grid: "#E4E0D8",
    accent: "#B5471B", navy: "#14213D" };
  const SERIES = { ebA: "#8F3A14", ebB: "#E8590C", hpA: "#1F5F9E", hpB: "#5B9BD5", gbA: "#1E6B3A", gbB: "#6FBF73" };

  let ctx = null;
  function tw(str, size, weight = 400, ls = 0) {
    if (!ctx) ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${weight} ${size}px ${FONT}`;
    return ctx.measureText(String(str)).width + ls * String(str).length;
  }
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const r1 = (n) => Math.round(n * 10) / 10;

  function fmt(n, d = 0) {
    if (n === null || n === undefined || !isFinite(n)) return "—";
    const s = Math.abs(n).toFixed(d);
    let [i, f] = s.split(".");
    i = i.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    const neg = n < 0 && parseFloat(s) !== 0;
    return (neg ? "−" : "") + i + (f ? "," + f : "");
  }
  const mln = (n, d = 1) => fmt(n / 1e6, d);

  function txt(x, y, s, o = {}) {
    const { size = 14, weight = 400, fill = C.ink, anchor = "start", ls = 0, op = 1 } = o;
    return `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor !== "start" ? ` text-anchor="${anchor}"` : ""}${ls ? ` letter-spacing="${ls}"` : ""}${op !== 1 ? ` opacity="${op}"` : ""}>${esc(s)}</text>`;
  }
  function fitSize(s, maxW, size, weight = 400, min = 9, ls = 0) {
    while (size > min && tw(s, size, weight, ls) > maxW) size -= 0.5;
    return size;
  }
  function wrap(s, maxW, size, weight = 400) {
    const words = String(s).split(" ");
    const lines = []; let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (cur && tw(t, size, weight) > maxW) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  // Matnni berilgan qator soniga sig'diradi (kerak bo'lsa shriftni kichraytiradi)
  function para(x, y, s, maxW, o = {}) {
    let { size = 13, weight = 400, fill = C.muted, lh = 1.3, maxLines = 99, min = 9.5, anchor = "start" } = o;
    let lines = wrap(s, maxW, size, weight);
    while (lines.length > maxLines && size > min) { size -= 0.5; lines = wrap(s, maxW, size, weight); }
    const step = size * lh;
    return { svg: lines.map((l, i) => txt(x, y + i * step, l, { size, weight, fill, anchor })).join(""), h: lines.length * step, lines: lines.length, size };
  }
  function panel(x, y, w, h, fill = C.panel, stroke = C.border, r = 14) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  }
  function niceMax(v) {
    if (!(v > 0)) return { max: 1, step: 0.2 };
    const raw = v / 4.5, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw);
    return { max: Math.ceil(v / step - 1e-9) * step, step };
  }
  const tickFmt = (v, step) => fmt(v, step < 1 ? (step < 0.1 ? 2 : 1) : 0);

  function header(L, o, title, lead, pageNo) {
    let s = `<defs><linearGradient id="acc${pageNo}" x1="0" x2="1"><stop offset="0" stop-color="#8F3A14"/><stop offset="0.5" stop-color="#E8590C"/><stop offset="1" stop-color="#1F5F9E"/></linearGradient></defs>`;
    s += `<rect width="${W}" height="${H}" fill="${C.bg}"/><rect width="${W}" height="10" fill="url(#acc${pageNo})"/>`;
    // o'ng tomon: kompaniya, klient, izoh
    const right = W - M;
    let rightW = 0, nameX = right;
    const prof = o.profile || {};
    if (prof.logo && prof.logo.data) {
      const lh = 46, lw = Math.min(190, lh * (prof.logo.w / prof.logo.h || 1));
      const hh = lw / (prof.logo.w / prof.logo.h || 1);
      s += `<image href="${prof.logo.data}" x="${r1(right - lw)}" y="${r1(26 + (lh - hh) / 2)}" width="${r1(lw)}" height="${r1(hh)}" preserveAspectRatio="xMidYMid meet"/>`;
      nameX = right - lw - 12; rightW = lw + 12;
    }
    if (prof.company) {
      const sz = fitSize(prof.company, 330, 20, 800, 13);
      s += txt(nameX, 56, prof.company, { size: sz, weight: 800, anchor: "end" });
      rightW += tw(prof.company, sz, 800);
    }
    const line2 = [o.input.client ? `${L.clientLbl}: ${o.input.client}` : "", o.date || ""].filter(Boolean).join(" · ");
    if (line2) { const sz = fitSize(line2, 520, 14, 600, 10); s += txt(right, 84, line2, { size: sz, weight: 600, fill: C.muted, anchor: "end" }); rightW = Math.max(rightW, tw(line2, sz, 600)); }
    if (lead) { const sz = fitSize(lead, 560, 14, 400, 10); s += txt(right, 105, lead, { size: sz, fill: C.muted, anchor: "end" }); rightW = Math.max(rightW, tw(lead, sz, 400)); }
    // chap tomon
    const leftW = CW - Math.min(rightW, 560) - 36;
    const eb = [L.ebCalc, L.city, L.heatingOnly, L.tariffsFrom(o.tariffs.date), o.res.customer === "biz" ? L.tarBiz : L.tarRes].join(" · ").toUpperCase();
    const es = fitSize(eb, leftW, 14, 700, 9, 2.4);
    s += txt(M, 58, eb, { size: es, weight: 700, fill: C.accent, ls: 2.4 * es / 14 });
    const ts = fitSize(title, leftW, 40, 800, 20);
    s += txt(M, 104, title, { size: ts, weight: 800 });
    return s;
  }
  function footer(L, o, pageNo, pages) {
    const prof = o.profile || {};
    const left = [prof.manager, prof.phone].filter(Boolean).join(" · ");
    let s = "";
    if (left) s += txt(M, 1034, left, { size: 13.5, weight: 700 });
    s += txt(W - M, 1034, [prof.company, `${pageNo}/${pages}`].filter(Boolean).join(" · "), { size: 12, fill: C.muted, anchor: "end" });
    return s;
  }
  const vName = (L, v) => `${L.sys[v.sys]} · ${L.stateL[v.state]}`;
  const vShort = (L, v) => `${L.abbr[v.sys]}, ${L.stateL[v.state]}`;

  // Jadval (ikkala sahifada bir xil ko'rinishda)
  function table(L, x, y, w, h, title, vars, rows, labelW, note) {
    let s = panel(x, y, w, h) + txt(x + 28, y + 38, title.toUpperCase(), { size: 16, weight: 800, ls: 0.5 });
    const n = vars.length, left = x + 28, right = x + w - 26;
    const colW = (right - left - labelW) / n;
    const colR = (i) => left + labelW + colW * (i + 1);
    const hs = n > 4 ? 12.5 : 13.5, ss = n > 4 ? 11.5 : 12.5;
    const headBottom = y + 126;
    const heads = vars.map((v) => {
      // eng uzun so'z ustunga sig'masa, shrift kichrayadi (ustunlar bir-biriga yopishmasligi uchun)
      const longest = (str) => str.split(" ").reduce((m, w) => (w.length > m.length ? w : m), "");
      const hsz = fitSize(longest(L.sys[v.sys]), colW - 12, hs, 700, 9.5), ssz = fitSize(longest(L.stateL[v.state]), colW - 12, ss, 400, 9);
      const nameLines = wrap(L.sys[v.sys], colW - 8, hsz, 700), stLines = wrap(L.stateL[v.state], colW - 8, ssz, 400);
      return { nameLines, stLines, hsz, ssz, total: nameLines.length * (hsz + 2) + stLines.length * (ssz + 2) };
    });
    const maxTotal = Math.max(...heads.map((h) => h.total));
    vars.forEach((v, i) => {
      const { nameLines, stLines, total, hsz: hs, ssz: ss } = heads[i];
      let yy = headBottom - 10 - total + hs;
      s += `<rect x="${r1(colR(i) - 18)}" y="${r1(headBottom - 10 - maxTotal - 12)}" width="18" height="6" rx="3" fill="${SERIES[v.id]}"/>`;
      for (const l of nameLines) { s += txt(colR(i), yy, l, { size: hs, weight: 700, anchor: "end" }); yy += hs + 2; }
      yy += ss - hs;
      for (const l of stLines) { s += txt(colR(i), yy, l, { size: ss, fill: C.muted, anchor: "end" }); yy += ss + 2; }
    });
    let yy = headBottom;
    const avail = y + h - 18 - (note ? 20 : 0) - headBottom;
    const fs = n > 4 ? 13.5 : 15, ls = 13.5;
    const laid = rows.map((r) => ({ r, lines: wrap(r.label, labelW - 12, r.bold ? ls + 0.5 : ls, r.bold ? 700 : 400) }));
    const need = laid.reduce((a, q) => a + Math.max(1, q.lines.length) * 17 + 12, 0);
    const pad = Math.max(8, Math.min(26, 12 + (avail - need) / rows.length));
    for (const { r, lines } of laid) {
      const rh = lines.length * 17 + pad;
      s += `<line x1="${left}" x2="${right}" y1="${r1(yy)}" y2="${r1(yy)}" stroke="${C.border}" stroke-width="1.5"/>`;
      const base = yy + rh / 2 - (lines.length - 1) * 8.5 + 5;
      lines.forEach((l, i) => { s += txt(left + 2, base + i * 17, l, { size: r.bold ? ls + 0.5 : ls, weight: r.bold ? 700 : 400, fill: r.bold ? C.ink : C.muted }); });
      r.cells.forEach((c, i) => {
        const size = r.big ? fs + 3 : fs;
        s += txt(colR(i), yy + rh / 2 + size * 0.36, c, { size: fitSize(c, colW - 6, size, r.bold ? 700 : 400), weight: r.bold ? 700 : 400, anchor: "end" });
      });
      yy += rh;
    }
    if (note) s += txt(left, y + h - 16, note, { size: 11.5, fill: C.muted });
    return s;
  }

  // ---------- 1-sahifa ----------
  function page1(L, o) {
    const { res, input } = o;
    const vars = res.variants, n = vars.length;
    const obj = (input.object || "").trim() || L.defObject;
    const title = `${obj}${input.area ? " " + fmt(CALC.num(input.area)) + " m²" : ""}: ${L.titleSeason}`.toUpperCase();
    let s = header(L, o, title, res.customer === "biz" ? L.leadBiz : L.leadRes, 1);

    // kartochkalar
    const worst = vars.reduce((a, v) => (v.tot.cost > a.tot.cost ? v : a), vars[0]);
    const best = vars.reduce((a, v) => (v.tot.cost < a.tot.cost ? v : a), vars[0]);
    const cy = 124, ch = 158, gap = n > 4 ? 14 : 20, cw = (CW - gap * (n - 1)) / n;
    vars.forEach((v, i) => {
      const x = M + i * (cw + gap), pad = n > 4 ? 18 : 26;
      s += `<clipPath id="cc${i}"><rect x="${r1(x)}" y="${cy}" width="${r1(cw)}" height="${ch}" rx="14"/></clipPath>`;
      s += panel(r1(x), cy, r1(cw), ch) + `<rect x="${r1(x)}" y="${cy}" width="${r1(cw)}" height="10" fill="${SERIES[v.id]}" clip-path="url(#cc${i})"/>`;
      const inner = cw - 2 * pad;
      s += txt(x + pad, cy + 40, L.sys[v.sys], { size: fitSize(L.sys[v.sys], inner, 19, 800, 12), weight: 800 });
      const sub = L.cardSub(L.state[v.state], fmt(v.load, v.load % 1 ? 1 : 0));
      s += txt(x + pad, cy + 60, sub, { size: fitSize(sub, inner, 14, 400, 9.5), fill: C.muted });
      if (v.equip !== null && v.equip !== undefined) {
        const eq = L.cardEquip(fmt(v.equip, v.equip % 1 ? 1 : 0));
        s += txt(x + pad, cy + 80, eq, { size: fitSize(eq, inner, 14, 700, 9.5), weight: 700 });
      }
      const big = mln(v.tot.cost), unit = n > 4 ? L.mln : L.unitSeason;
      let bs = n > 4 ? 34 : 38;
      const us = n > 4 ? 12.5 : 14;
      while (bs > 22 && tw(big, bs, 800) + 8 + tw(unit, us) > inner) bs -= 1;
      s += txt(x + pad, cy + 120, big, { size: bs, weight: 800 });
      s += txt(x + pad + tw(big, bs, 800) + 8, cy + 120, unit, { size: us, fill: C.muted });
      const d = v === worst ? L.baseline : L.vsBase(fmt((1 - v.tot.cost / worst.tot.cost) * 100));
      s += txt(x + pad, cy + 144, d, { size: fitSize(d, inner, 14.5, 700, 10), weight: 700 });
    });

    // diagramma
    const py = 298, ph = 538, chartW = n > 4 ? 540 : 664, tx = M + chartW + 16, tW = CW - chartW - 16;
    s += panel(M, py, chartW, ph);
    s += txt(M + 28, py + 38, L.chartTitle.toUpperCase(), { size: fitSize(L.chartTitle.toUpperCase(), chartW - 56, 16, 800, 11, 0.5), weight: 800, ls: 0.5 });
    let lx = M + 28, ly = py + 64;
    for (const v of vars) {
      const lab = vShort(L, v), wI = 20 + tw(lab, 13.5) + 22;
      if (lx + wI - 22 > M + chartW - 20) { lx = M + 28; ly += 22; }
      s += `<rect x="${r1(lx)}" y="${ly - 11}" width="13" height="13" rx="3" fill="${SERIES[v.id]}"/>` + txt(lx + 20, ly, lab, { size: 13.5, fill: C.muted });
      lx += wI;
    }
    const plotT = ly + 26, plotB = py + ph - 46, plotL = M + 62, plotR = M + chartW - 22;
    const maxV = Math.max(...vars.flatMap((v) => v.rows.map((r) => r.cost))) / 1e6;
    const nm = niceMax(maxV);
    const ys = (val) => plotB - (val / nm.max) * (plotB - plotT);
    for (let t = 0; t <= nm.max + 1e-9; t += nm.step) {
      s += `<line x1="${plotL}" x2="${plotR}" y1="${r1(ys(t))}" y2="${r1(ys(t))}" stroke="${t === 0 ? "#C9C4BA" : C.grid}" stroke-width="${t === 0 ? 1.5 : 1.2}"/>`;
      s += txt(plotL - 10, ys(t) + 4, tickFmt(t, nm.step), { size: 12, fill: C.muted, anchor: "end" });
    }
    const months = res.months, gw = (plotR - plotL) / months.length;
    const bw = Math.min(30, (gw * 0.8 - (n - 1) * 2) / n), groupW = n * bw + (n - 1) * 2;
    months.forEach((m, mi) => {
      const gx = plotL + mi * gw + (gw - groupW) / 2;
      vars.forEach((v, vi) => {
        const val = v.rows[mi].cost / 1e6, x0 = gx + vi * (bw + 2), y0 = ys(val), rr = Math.min(4, bw / 2, Math.max(0, plotB - y0));
        s += `<path d="M${r1(x0)},${r1(plotB)} V${r1(y0 + rr)} Q${r1(x0)},${r1(y0)} ${r1(x0 + rr)},${r1(y0)} H${r1(x0 + bw - rr)} Q${r1(x0 + bw)},${r1(y0)} ${r1(x0 + bw)},${r1(y0 + rr)} V${r1(plotB)} Z" fill="${SERIES[v.id]}"><title>${esc(`${L.monthsFull[m.key]} · ${vName(L, v)}: ${fmt(val, 1)} ${L.mln}`)}</title></path>`;
      });
      s += txt(plotL + mi * gw + gw / 2, plotB + 26, L.months[m.key], { size: 14.5, weight: 700, fill: C.muted, anchor: "middle" });
    });

    // jadval
    const hasGas = vars.some((v) => v.sys === "gb"), hasEl = vars.some((v) => v.sys !== "gb");
    const rows = [];
    const eqCell = (v) => (v.equip === null || v.equip === undefined ? "—" : fmt(v.equip, v.equip % 1 ? 1 : 0));
    rows.push({ label: L.rEquip, cells: vars.map(eqCell) });
    rows.push({ label: L.rHeat, cells: vars.map((v) => fmt(v.tot.heat)) });
    if (hasEl) rows.push({ label: L.rElHeat, cells: vars.map((v) => (v.sys === "gb" ? "—" : fmt(v.tot.elHeat))) });
    if (hasGas) rows.push({ label: L.rGasHeat, cells: vars.map((v) => (v.sys === "gb" ? fmt(v.tot.gasHeat) : "—")) });
    if (res.baseEl > 0) rows.push({ label: L.rElTot, cells: vars.map((v) => fmt(v.tot.el)), bold: true });
    if (hasEl) rows.push({ label: L.rAvgEl, cells: vars.map((v) => (v.sys === "gb" && !(res.baseEl > 0) ? "—" : fmt(v.avgEl))) });
    rows.push({ label: L.rHeatPrice, cells: vars.map((v) => fmt(v.heatPrice)) });
    if (hasEl) rows.push({ label: L.rPeak, cells: vars.map((v) => (v.peak === null ? "—" : "~" + fmt(v.peak))) });
    rows.push({ label: L.rJan, cells: vars.map((v) => mln(v.jan)) });
    rows.push({ label: L.rTotal, cells: vars.map((v) => mln(v.tot.cost)), bold: true, big: true });
    s += table(L, tx, py, tW, ph, L.tableTitle, vars, rows, n > 4 ? 178 : n > 2 ? 232 : 300);

    // xulosalar
    const by = 852, bh = 112, bgap = 20, bw3 = (CW - 2 * bgap) / 3;
    const box = (i, fill, stroke, bigFill, txtFill, big, body) => {
      const x = M + i * (bw3 + bgap);
      let q = panel(r1(x), by, r1(bw3), bh, fill, stroke);
      q += txt(x + 28, by + 40, big, { size: fitSize(big, bw3 - 56, 26, 800, 14), weight: 800, fill: bigFill });
      q += para(x + 28, by + 62, body, bw3 - 56, { size: 14, fill: txtFill, maxLines: 3, lh: 1.25 }).svg;
      return q;
    };
    const get = (id) => vars.find((v) => v.id === id);
    const stList = res.states.map((st) => st.key);
    s += box(0, C.navy, C.navy, "#F6A04D", "#D8DEE9", L.c1Big(mln(Math.round(worst.tot.cost / 1e5) * 1e5 - Math.round(best.tot.cost / 1e5) * 1e5)),
      n > 1 ? L.c1Txt(vName(L, best), vName(L, worst), fmt(worst.tot.cost / best.tot.cost, 1), mln(worst.jan), mln(best.jan)) : vName(L, best));
    const pairs = stList.map((k) => ({ k, eb: get("eb" + k), hp: get("hp" + k) })).filter((p) => p.eb && p.hp);
    if (pairs.length) {
      const rd = (x) => Math.round(x / 1e5) * 1e5;
      const sav = pairs.map((p) => mln(rd(p.eb.tot.cost) - rd(p.hp.tot.cost))).join(" / ");
      const pct = pairs.map((p) => "−" + fmt((1 - p.hp.tot.cost / p.eb.tot.cost) * 100) + " %").join(" / ");
      const stTxt = pairs.map((p) => L.stateL[p.k]).join(" / ");
      const tier = res.customer === "res" && pairs.some((p) => Math.max(...p.eb.rows.map((r) => r.el)) > 5000);
      s += box(1, "#FDEFE4", "#F2C9A8", C.accent, C.ink, L.c2Big(sav), L.c2Txt(stTxt, pct) + (tier ? " " + L.c2Tier : ""));
      const conn = pairs.map((p) => `${fmt(p.eb.peak)} → ${fmt(p.hp.peak)}`).join(" / ");
      s += box(2, "#EAF1FB", "#BCD3EE", "#1F5F9E", C.ink, L.c3Big(conn), L.c3Txt(stTxt));
    } else {
      const hp = vars.map((v) => `${vShort(L, v)}: ${fmt(v.heatPrice)} ${L.sum}`).join("; ");
      s += box(1, "#FDEFE4", "#F2C9A8", C.accent, C.ink, L.c2AltBig, hp + ".");
      s += box(2, "#EAF1FB", "#BCD3EE", "#1F5F9E", C.ink, L.c3AltBig(fmt(res.seasonDays)), L.c3AltTxt(fmt(res.tIn), fmt(res.tDes)));
    }

    // izoh
    const ov = input.ov || {};
    const defDays = res.months.every((m) => m.days === CALC.DEFAULT_MONTHS.find((d) => d.key === m.key).days);
    let foot = res.baseEl > 0 ? L.footBase(fmt(res.baseEl)) : "";
    if (hasGas && res.baseGas > 0) foot += L.footBaseGas(fmt(res.baseGas));
    foot += L.footCommon(fmt(res.tIn), fmt(res.tDes), defDays ? L.seasonDates : L.seasonDays(fmt(res.seasonDays)), fmt(res.gain, 2));
    if (vars.some((v) => v.sys === "hp")) {
      const bk = stList.map((k) => fmt(res.hpInfo[k].backup, res.hpInfo[k].backup % 1 ? 1 : 0) + " %").join(" / ");
      foot += L.footHp(res.supply, bk);
      if (res.months.some((m) => CALC.num(ov["cop_" + m.key]) !== null)) foot += L.footHpManual;
    }
    if (hasGas) foot += L.footGb(fmt(res.effGb * 100), fmt(res.gasKwh, 1));
    foot += L.footEnd;
    s += para(M, 986, foot.trim(), CW, { size: 12, maxLines: 3, lh: 1.3, min: 9 }).svg;
    s += footer(L, o, 1, 2);
    return svgWrap(s);
  }

  // ---------- 2-sahifa ----------
  function page2(L, o) {
    const { res, input, tariffs } = o;
    const vars = res.variants, n = vars.length;
    let s = header(L, o, L.title2.toUpperCase(), L.lead2(fmt(res.growth * 100, (res.growth * 100) % 1 ? 1 : 0), fmt(res.usd)), 2);
    const known = vars.filter((v) => v.priceKnown);
    const Y = res.years;

    // chiziqli grafiklar: har bir holat uchun alohida, umumiy shkala
    const gy = 124, gh = 340, states = res.states, gGap = 20, gW = (CW - gGap * (states.length - 1)) / states.length;
    const maxV = Math.max(1, ...known.map((v) => v.cum[Y])) / 1e6;
    const nm = niceMax(maxV);
    states.forEach((st, si) => {
      const x = M + si * (gW + gGap);
      s += panel(r1(x), gy, r1(gW), gh);
      const ttl = `${L.cumTitle} · ${L.state[st.key]} · ${fmt(st.load, st.load % 1 ? 1 : 0)} ${L.kw}`;
      s += txt(x + 28, gy + 38, ttl.toUpperCase(), { size: fitSize(ttl.toUpperCase(), gW - 56, 15, 800, 10, 0.4), weight: 800, ls: 0.4 });
      const pL = x + 78, pR = x + gW - 196, pT = gy + 66, pB = gy + gh - 50;
      const xs = (yr) => pL + (yr / Y) * (pR - pL), ys = (val) => pB - (val / nm.max) * (pB - pT);
      for (let t = 0; t <= nm.max + 1e-9; t += nm.step) {
        s += `<line x1="${r1(pL)}" x2="${r1(pR)}" y1="${r1(ys(t))}" y2="${r1(ys(t))}" stroke="${t === 0 ? "#C9C4BA" : C.grid}" stroke-width="${t === 0 ? 1.5 : 1.2}"/>`;
        s += txt(pL - 10, ys(t) + 4, tickFmt(t, nm.step), { size: 12, fill: C.muted, anchor: "end" });
      }
      for (let yr = 0; yr <= Y; yr++) s += txt(xs(yr), pB + 22, String(yr), { size: 12, fill: C.muted, anchor: "middle" });
      s += txt(pR + 12, pB + 22, L.yearAxis, { size: 12, fill: C.muted });
      const mine = known.filter((v) => v.state === st.key);
      // oxirgi nuqta yozuvlari (ustma-ust tushmasligi uchun suriladi)
      const labs = mine.map((v) => ({ v, y: ys(v.cum[Y] / 1e6) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 34) labs[i].y = labs[i - 1].y + 34;
      const over = labs.length ? labs[labs.length - 1].y - (pB - 4) : 0;
      if (over > 0) labs.forEach((l) => (l.y -= over));
      for (const v of mine) {
        const pts = v.cum.slice(0, Y + 1).map((c, yr) => `${r1(xs(yr))},${r1(ys(c / 1e6))}`).join(" ");
        s += `<polyline points="${pts}" fill="none" stroke="${SERIES[v.id]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><title>${esc(vName(L, v))}</title></polyline>`;
        s += `<circle cx="${r1(xs(Y))}" cy="${r1(ys(v.cum[Y] / 1e6))}" r="5" fill="${SERIES[v.id]}" stroke="${C.panel}" stroke-width="2"/>`;
        s += `<circle cx="${r1(xs(0))}" cy="${r1(ys(v.cum[0] / 1e6))}" r="4" fill="${SERIES[v.id]}" stroke="${C.panel}" stroke-width="2"/>`;
      }
      for (const l of labs) {
        const yEnd = ys(l.v.cum[Y] / 1e6);
        s += `<line x1="${r1(xs(Y) + 7)}" y1="${r1(yEnd)}" x2="${r1(pR + 20)}" y2="${r1(l.y - 4)}" stroke="${SERIES[l.v.id]}" stroke-width="1.2"/>`;
        s += txt(pR + 26, l.y - 2, L.sys[l.v.sys], { size: fitSize(L.sys[l.v.sys], 160, 13.5, 700, 10), weight: 700 });
        s += txt(pR + 26, l.y + 14, `${mln(l.v.cum[Y], 0)} ${L.mln}`, { size: 12.5, fill: C.muted });
      }
      // kesishish nuqtalari (oqlanish)
      for (const p of res.paybacks.filter((p) => p && p.state === st.key && p.kind === "years" && p.known && p.years <= Y && p.years > 0)) {
        const a = vars.find((v) => v.id === p.a), fl = Math.floor(p.years), fr = p.years - fl;
        const cy0 = a.cum[fl] + (a.cum[Math.min(fl + 1, 30)] - a.cum[fl]) * fr;
        const cx = xs(p.years), cyy = ys(cy0 / 1e6), lab = L.yearsShort(fmt(p.years, 1));
        s += `<circle cx="${r1(cx)}" cy="${r1(cyy)}" r="6" fill="${C.panel}" stroke="${C.ink}" stroke-width="2"/>`;
        const lw = tw(lab, 12.5, 700) + 14;
        s += `<rect x="${r1(cx - lw / 2)}" y="${r1(cyy - 34)}" width="${r1(lw)}" height="21" rx="6" fill="${C.ink}"/>` + txt(cx, cyy - 19, lab, { size: 12.5, weight: 700, fill: "#fff", anchor: "middle" });
      }
      if (!mine.length) s += txt(x + gW / 2, gy + gh / 2, L.pbNoPrice, { size: 14, fill: C.muted, anchor: "middle" });
    });

    // jadval: uskuna narxi va 10 yillik jami
    const ty = 480, th = 356, tW = 806, hasInsul = res.insulUsd > 0 && vars.some((v) => v.state === "B");
    const dash = L.noPriceCell;
    const rows = [
      { label: L.rEquip, cells: vars.map((v) => (v.equip === null || v.equip === undefined ? dash : fmt(v.equip, v.equip % 1 ? 1 : 0))) },
      { label: L.rCapUsd, cells: vars.map((v) => (v.priceKnown ? "$" + fmt(v.capexUsd) + (hasInsul && v.state === "B" ? "†" : "") : dash)) },
      { label: L.rCapSum, cells: vars.map((v) => (v.priceKnown ? mln(v.capex) : dash)) },
      { label: L.rYear1, cells: vars.map((v) => mln(v.tot.cost)) },
      { label: L.rPay10, cells: vars.map((v) => mln(v.cum[Y] - v.capex, 0)) },
      { label: L.rTot10, cells: vars.map((v) => (v.priceKnown ? mln(v.cum[Y], 0) : dash)), bold: true, big: true },
    ];
    s += table(L, M, ty, tW, th, L.capTable, vars, rows, n > 4 ? 200 : 260, hasInsul ? L.insulIncl : "");

    // oqlanish muddati
    const px = M + tW + 16, pw = CW - tW - 16;
    s += panel(px, ty, pw, th) + txt(px + 28, ty + 38, L.pbTitle.toUpperCase(), { size: 16, weight: 800, ls: 0.5 });
    const pbs = res.paybacks.filter(Boolean);
    const itemH = Math.min(90, (th - 64) / Math.max(1, pbs.length));
    pbs.forEach((p, i) => {
      const a = vars.find((v) => v.id === p.a), b = vars.find((v) => v.id === p.b);
      const y0 = ty + 60 + i * itemH + Math.max(0, (itemH - 64) / 2), iw = pw - 56;
      if (i) s += `<line x1="${px + 28}" x2="${px + pw - 26}" y1="${r1(ty + 60 + i * itemH - 4)}" y2="${r1(ty + 60 + i * itemH - 4)}" stroke="${C.border}" stroke-width="1.5"/>`;
      s += `<rect x="${px + 28}" y="${r1(y0 + 3)}" width="12" height="12" rx="3" fill="${SERIES[a.id]}"/><rect x="${px + 44}" y="${r1(y0 + 3)}" width="12" height="12" rx="3" fill="${SERIES[b.id]}"/>`;
      const head = `${L.sys[a.sys]} ${L.vs} ${L.sys[b.sys].toLowerCase()} · ${L.stateL[p.state]}`;
      s += txt(px + 64, y0 + 14, head, { size: fitSize(head, iw - 36, 13, 600, 9.5), weight: 600, fill: C.muted });
      let big, det;
      if (!p.known) { big = null; det = L.pbNoPrice; }
      else if (p.kind === "years") { big = p.years <= Y ? L.pbYears(fmt(p.years, 1)) : L.pbLong(fmt(p.years, 0)); det = L.pbExtra(fmt(p.extra / res.usd), mln(p.saving1)); }
      else if (p.kind === "always") { big = L.pbAlways; det = L.pbAlwaysTxt; }
      else { big = L.pbNever; det = L.pbNeverTxt(fmt(p.extra / res.usd), mln(-p.saving1)); }
      if (big === null) { s += txt(px + 28, y0 + 40, det, { size: fitSize(det, iw, 14, 600, 9.5), weight: 600, fill: C.muted }); return; }
      const bigTxt = `${L.sys[a.sys]}: ${big.charAt(0).toLowerCase() + big.slice(1)}`;
      s += txt(px + 28, y0 + 38, bigTxt, { size: fitSize(bigTxt, iw, 17, 800, 11), weight: 800 });
      s += txt(px + 28, y0 + 56, det, { size: fitSize(det, iw, 12.5, 400, 9.5), fill: C.muted });
    });
    if (!pbs.length) s += para(px + 28, ty + 70, L.pbNoPrice, pw - 56, { size: 13.5 }).svg;

    // tariflar va farazlar
    const ay = 852, ah = 150;
    s += panel(M, ay, CW, ah) + txt(M + 28, ay + 36, L.asTitle.toUpperCase(), { size: 16, weight: 800, ls: 0.5 });
    const rng = (tiers, above) => { let prev = 0; return tiers.map(([u, p]) => { const t = u >= CALC.INF / 2 ? `${fmt(prev)}+` : `${fmt(prev ? prev + 1 : 0)}–${fmt(u)}`; prev = u; return `${t}: ${fmt(p)}`; }).join("; "); };
    const colW = [400, 420, CW - 56 - 400 - 420 - 48];
    let cx = M + 28;
    const hasGasV = vars.some((v) => v.sys === "gb");
    const elTxt = res.customer === "biz" ? L.asElecBiz(fmt(tariffs.elecBiz)) : rng(tariffs.elecRes) + ".";
    s += txt(cx, ay + 60, L.asElec, { size: 13, weight: 700 }) + para(cx, ay + 80, elTxt, colW[0], { size: 12.5, maxLines: 4, lh: 1.32 }).svg;
    cx += colW[0] + 24;
    if (hasGasV) {
      const gTxt = res.customer === "biz" ? L.asGasBiz(fmt(tariffs.gasBiz)) : rng(CALC.gasTiers(tariffs, true)) + ". " + L.asGasNorm(fmt(tariffs.gasNormWinter), fmt(tariffs.gasNormOther));
      s += txt(cx, ay + 60, L.asGas, { size: 13, weight: 700 }) + para(cx, ay + 80, gTxt, colW[1], { size: 12.5, maxLines: 4, lh: 1.32 }).svg;
      cx += colW[1] + 24;
    }
    s += para(cx, ay + 60, L.asMethod + L.footEnd, M + CW - 28 - cx, { size: 12.5, maxLines: 5, lh: 1.32 }).svg;
    s += footer(L, o, 2, 2);
    return svgWrap(s);
  }

  function svgWrap(inner) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT.replace(/"/g, "'")}">${inner}</svg>`;
  }
  function pages(L, o) { return o.res.variants.length ? [page1(L, o), page2(L, o)] : []; }

  return { pages, fmt, mln, SERIES, W, H, vName };
})();
