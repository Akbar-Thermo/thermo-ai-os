// ===== Hisoblash qismi (sof funksiyalar, brauzer va node'da bir xil ishlaydi) =====
const INF = 1e12;

const DEFAULT_TARIFFS = {
  date: "01.06.2026",
  // Aholi, elektr: [yuqori chegara kVt·soat/oy, so'm]
  elecRes: [[200, 650], [500, 900], [1000, 1100], [5000, 1600], [10000, 1900], [INF, 2200]],
  elecBiz: 1100,
  // Aholi, gaz: norma (noyabr–fevral / boshqa oylar) va pog'onalar
  gasNormWinter: 500,
  gasNormOther: 100,
  gasBasePrice: 1100,
  gasRes: [[2500, 2000], [5000, 2300], [10000, 2700], [INF, 3300]],
  gasBiz: 2000,
};

const DEFAULT_MONTHS = [
  { key: "nov", days: 30, full: 30, t: 9.4, winterNorm: true },
  { key: "dec", days: 31, full: 31, t: 4.4, winterNorm: true },
  { key: "jan", days: 31, full: 31, t: 2.8, winterNorm: true },
  { key: "feb", days: 28, full: 28, t: 4.4, winterNorm: true },
  { key: "mar", days: 18, full: 31, t: 8.0, winterNorm: false },
];

// PASRW seriyasi, COP (maksimal quvvatda), tashqi harorat bo'yicha
const COP_CURVES = {
  45: [[-15, 2.08], [-10, 2.28], [-7, 2.30], [-5, 2.35], [2, 2.76], [7, 2.92], [10, 3.23], [15, 3.84], [20, 4.25]],
  55: [[-15, 1.78], [-10, 1.90], [-5, 2.01], [2, 2.60], [7, 2.69]],
  70: [[-15, 1.05], [-10, 1.15], [-5, 1.47], [2, 1.73], [7, 1.88]],
};

// Modellar: tashqi harorat nuqtalari +7, +2, -5, -10, -15; [issiqlik quvvati], [elektr quvvati]
const HP_AMB = [7, 2, -5, -10, -15];
const HP_MODELS = [
  { id: "PASRW080", nom: 28, t: {
    45: { cap: [25.58, 22.56, 18.20, 16.91, 15.21], pow: [8.75, 8.16, 7.74, 7.41, 7.32] },
    55: { cap: [22.00, 19.69, 17.93, 16.30, 14.99], pow: [8.18, 7.56, 8.92, 8.60, 8.44] },
    70: { cap: [15.60, 14.21, 13.67, 10.42, 9.21], pow: [8.31, 8.20, 9.29, 9.09, 8.77] } } },
  { id: "PASRW150", nom: 50, t: {
    45: { cap: [48.5, 46.8, 36.4, 32.5, 28.3], pow: [16.4, 15.3, 14.7, 15.0, 14.5] },
    55: { cap: [46.0, 42.3, 32.8, 30.3, 26.6], pow: [18.6, 17.9, 16.8, 15.2, 16.0] },
    70: { cap: [36.0, 31.7, 25.0, 18.9, null], pow: [18.6, 17.7, 17.0, 17.3, null] } } },
  { id: "PASRW250", nom: 80, t: {
    45: { cap: [77.64, 56.62, 51.62, 49.26, 44.33], pow: [25.23, 21.76, 23.26, 22.75, 22.00] },
    55: { cap: [75.27, 55.21, 50.34, 42.27, 39.85], pow: [27.75, 24.05, 25.58, 25.82, 23.96] },
    70: { cap: [53.26, 46.04, 42.22, 24.93, null], pow: [24.36, 25.44, 28.64, 18.90, null] } } },
  { id: "PASRW350", nom: 110, t: {
    45: { cap: [105.58, 89.31, 74.13, 66.99, 60.29], pow: [34.31, 33.55, 33.36, 30.94, 29.92] },
    55: { cap: [97.15, 85.14, 68.46, 65.09, 58.57], pow: [42.19, 37.08, 34.79, 34.74, 36.81] },
    70: { cap: [72.43, 65.91, 57.42, 33.90, null], pow: [36.33, 36.42, 38.95, 25.71, null] } } },
];

const DEFAULT_INPUT = {
  client: "", object: "", area: "",
  customer: "res",            // res = aholi, biz = yur. shaxs
  loadA: 56, loadB: 36,       // izolyatsiyasiz / izolyatsiya bilan, kVt
  useA: true, useB: true,
  supply: 45,
  sys: { eb: true, hp: true, gb: true },
  price: { eb: [8000, null], hp: [40000, null], gb: [null, null] }, // $ : [izolyatsiyasiz, izolyatsiya bilan]; null = birinchisi bilan bir xil
  insulPrice: null,           // izolyatsiya ishlari narxi, $
  growth: 10,                 // tariflar o'sishi, %/yil
  usd: 12000,
  // Qo'lda o'zgartirishlar (null/undefined = avtomatik)
  ov: {},
};

// Avtomatik qiymatlar (qo'lda o'zgartirilmagan bo'lsa)
const AUTO = {
  tIn: 20, tDes: -14, gain: 0.85,
  baseElRes: 500, baseElBiz: 0,   // maishiy elektr, kVt·soat/oy
  baseGas: 0,                     // maishiy gaz, m³/oy
  effEb: 0.99, effGb: 0.92, gasKwh: 9.3,
  backupA: 3, backupB: 1,         // zaxira TEN ulushi, %
  coverMin: 0.75,                 // nasos tanlash: hisobiy haroratda yuklamaning kamida 75 %
  // Uskuna quvvati (faqat infografikada ko'rsatiladi, to'lovga ta'sir qilmaydi):
  // 56 kVt uy uchun elektr qozon 56, issiqlik nasosi 86, gaz qozon 60 kVt
  equipRatio: { eb: 1, hp: 86 / 56, gb: 1.08 },
};
function equipAuto(sys, load) { const l = num(load); return l > 0 ? Math.round(l * AUTO.equipRatio[sys]) : null; }

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function pick(ov, key, auto) {
  const n = num(ov ? ov[key] : null);
  return n === null ? auto : n;
}

function interp(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}
function copAuto(supply, t) { return interp(COP_CURVES[supply] || COP_CURVES[45], t); }

// Pog'onali to'lov: tiers = [[yuqori chegara, narx], ...]
function tiered(qty, tiers) {
  let rest = qty, prev = 0, sum = 0;
  const parts = [];
  for (const [upTo, price] of tiers) {
    const take = Math.max(0, Math.min(rest, upTo - prev));
    if (take > 0) { sum += take * price; parts.push({ from: prev, upTo, price, qty: take, sum: take * price }); }
    rest -= take; prev = upTo;
    if (rest <= 1e-9) break;
  }
  return { sum, parts };
}
function elecBill(kwh, tariffs, customer) {
  if (kwh <= 0) return 0;
  return customer === "biz" ? kwh * tariffs.elecBiz : tiered(kwh, tariffs.elecRes).sum;
}
function gasTiers(tariffs, winterNorm) {
  const norm = winterNorm ? tariffs.gasNormWinter : tariffs.gasNormOther;
  return [[norm, tariffs.gasBasePrice], ...tariffs.gasRes.filter(([u]) => u > norm)];
}
function gasBill(m3, tariffs, customer, winterNorm) {
  if (m3 <= 0) return 0;
  return customer === "biz" ? m3 * tariffs.gasBiz : tiered(m3, gasTiers(tariffs, winterNorm)).sum;
}

// Jadvaldagi hisobiy haroratga eng yaqin sovuqroq nuqta (ehtiyotkor yondashuv)
function designIndex(tDes) {
  let idx = 0;
  for (let i = 0; i < HP_AMB.length; i++) if (HP_AMB[i] >= tDes) idx = Math.min(i + 1, HP_AMB.length - 1);
  if (tDes >= HP_AMB[0]) idx = 0;
  return idx;
}
function modelAt(model, supply, tDes) {
  const tb = model.t[supply] || model.t[45];
  let i = designIndex(tDes);
  let limited = false;
  while (i > 0 && (tb.cap[i] === null || tb.cap[i] === undefined)) { i--; limited = true; }
  return { cap: tb.cap[i], pow: tb.pow[i], at: HP_AMB[i], limited };
}
// Nasosni avtomatik tanlash
function selectHp(load, supply, tDes, coverMin) {
  for (let n = 1; n <= 8; n++) {
    for (const m of HP_MODELS) {
      const a = modelAt(m, supply, tDes);
      if (a.cap * n >= coverMin * load) return { model: m.id, count: n };
    }
  }
  return { model: HP_MODELS[HP_MODELS.length - 1].id, count: 8 };
}

function compute(input, tariffs) {
  const ov = input.ov || {};
  const customer = input.customer === "biz" ? "biz" : "res";
  const tIn = pick(ov, "tIn", AUTO.tIn), tDes = pick(ov, "tDes", AUTO.tDes), gain = pick(ov, "gain", AUTO.gain);
  const baseEl = pick(ov, "baseEl", customer === "biz" ? AUTO.baseElBiz : AUTO.baseElRes);
  const baseGas = pick(ov, "baseGas", AUTO.baseGas);
  const effEb = pick(ov, "effEb", AUTO.effEb * 100) / 100;
  const effGb = pick(ov, "effGb", AUTO.effGb * 100) / 100;
  const gasKwh = pick(ov, "gasKwh", AUTO.gasKwh);
  const supply = [45, 55, 70].includes(+input.supply) ? +input.supply : 45;

  const months = DEFAULT_MONTHS.map((m) => {
    const days = pick(ov, "days_" + m.key, m.days);
    const t = pick(ov, "t_" + m.key, m.t);
    const copA = copAuto(supply, t);
    const cop = pick(ov, "cop_" + m.key, copA);
    return { key: m.key, days, full: m.full, t, cop, copAuto: copA, winterNorm: m.winterNorm,
      // maishiy iste'mol: to'liq oy uchun 30 kunlik me'yor bo'yicha, to'liq bo'lmagan oy uchun kunlar ulushi bo'yicha
      baseEl: baseEl * (days >= m.full ? days / 30 : days / m.full), baseGas: baseGas * (days >= m.full ? days / 30 : days / m.full) };
  });
  const seasonDays = months.reduce((s, m) => s + m.days, 0);

  const states = [];
  if (input.useA && num(input.loadA) > 0) states.push({ key: "A", load: num(input.loadA) });
  if (input.useB && num(input.loadB) > 0) states.push({ key: "B", load: num(input.loadB) });
  const systems = ["eb", "hp", "gb"].filter((s) => input.sys && input.sys[s]);

  const usd = num(input.usd) || 0;
  const insulUsd = num(input.insulPrice) || 0;
  const hpInfo = {};
  const variants = [];

  for (const st of states) {
    const dT = Math.max(1, tIn - tDes);
    const UA = st.load / dT;
    // Issiqlik nasosi tanlovi va quvvati
    const autoSel = selectHp(st.load, supply, tDes, AUTO.coverMin);
    const modelId = ov["hpModel" + st.key] || autoSel.model;
    const model = HP_MODELS.find((m) => m.id === modelId) || HP_MODELS[0];
    const countAuto = ov["hpModel" + st.key] ? Math.max(1, Math.ceil(AUTO.coverMin * st.load / modelAt(model, supply, tDes).cap)) : autoSel.count;
    const count = Math.max(1, Math.round(pick(ov, "hpCount" + st.key, countAuto)));
    const at = modelAt(model, supply, tDes);
    const capAuto = at.cap * count, powAuto = at.pow * count;
    const cap = pick(ov, "hpCap" + st.key, capAuto);
    const pow = pick(ov, "hpPow" + st.key, powAuto);
    const backupAuto = cap >= st.load ? 0 : (st.key === "A" ? AUTO.backupA : AUTO.backupB);
    const backup = pick(ov, "backup" + st.key, backupAuto) / 100;
    const hpPeak = cap >= st.load ? pow * st.load / cap : pow + (st.load - cap);
    hpInfo[st.key] = { model: model.id, count, autoModel: autoSel.model, autoCount: autoSel.count, countAuto,
      cap, pow, capAuto, powAuto, backup: backup * 100, backupAuto, peak: hpPeak, at: at.at, limited: at.limited,
      cover: cap / st.load };

    for (const sys of systems) {
      const rows = [];
      const tot = { heat: 0, elHeat: 0, el: 0, gasHeat: 0, gas: 0, cost: 0, baseCost: 0 };
      for (const m of months) {
        const heat = UA * Math.max(0, tIn - m.t) * 24 * m.days * gain;
        let elHeat = 0, gasHeat = 0;
        if (sys === "eb") elHeat = heat / effEb;
        else if (sys === "hp") elHeat = heat * (1 - backup) / m.cop + heat * backup;
        else gasHeat = heat / (gasKwh * effGb);
        const el = m.baseEl + elHeat;
        const gas = sys === "gb" ? m.baseGas + gasHeat : 0;
        const costEl = elecBill(el, tariffs, customer);
        const costGas = sys === "gb" ? gasBill(gas, tariffs, customer, m.winterNorm) : 0;
        const baseCost = elecBill(m.baseEl, tariffs, customer) + (sys === "gb" ? gasBill(m.baseGas, tariffs, customer, m.winterNorm) : 0);
        const cost = costEl + costGas;
        rows.push({ key: m.key, heat, elHeat, el, gasHeat, gas, costEl, costGas, cost, baseCost });
        tot.heat += heat; tot.elHeat += elHeat; tot.el += el; tot.gasHeat += gasHeat; tot.gas += gas;
        tot.cost += cost; tot.baseCost += baseCost;
      }
      const pr = (input.price && input.price[sys]) || [null, null];
      const p0 = num(pr[0]), p1 = num(pr[1]);
      const sysUsd = st.key === "A" ? p0 : (p1 === null ? p0 : p1);
      const priceKnown = sysUsd !== null;
      const capexUsd = (sysUsd || 0) + (st.key === "B" ? insulUsd : 0);
      const peak = sys === "eb" ? st.load : sys === "hp" ? hpPeak : null; // elektr qozon: o'rnatilgan quvvat = yuklama
      const peakGas = sys === "gb" ? st.load / (gasKwh * effGb) : null;
      variants.push({
        id: sys + st.key, sys, state: st.key, load: st.load, rows, tot,
        equip: pick(ov, "cap_" + sys + st.key, equipAuto(sys, st.load)),
        avgEl: tot.el > 0 ? elCost(rows) / tot.el : null,
        heatPrice: tot.heat > 0 ? (tot.cost - tot.baseCost) / tot.heat : null,
        peak, peakGas, jan: (rows.find((r) => r.key === "jan") || rows[0]).cost,
        capexUsd, capex: capexUsd * usd, priceKnown,
      });
    }
  }
  function elCost(rows) { return rows.reduce((s, r) => s + r.costEl, 0); }
  // tartib: tizim bo'yicha (EQ, IN, GQ), ichida izolyatsiyasiz → izolyatsiya bilan
  const ORDER = ["eb", "hp", "gb"];
  variants.sort((a, b) => ORDER.indexOf(a.sys) - ORDER.indexOf(b.sys) || a.state.localeCompare(b.state));

  // 10 yillik jami xarajat
  const g = (num(input.growth) || 0) / 100;
  const YEARS = 10;
  for (const v of variants) {
    v.cum = [v.capex];
    for (let y = 1; y <= 30; y++) v.cum.push(v.cum[y - 1] + v.tot.cost * Math.pow(1 + g, y - 1));
    v.total10 = v.cum[YEARS];
  }
  // Oqlanish muddati: qimmat uskuna (a) arzoniga (b) nisbatan
  function payback(a, b) {
    if (!a || !b) return null;
    const res = { a: a.id, b: b.id, state: a.state, extra: a.capex - b.capex, saving1: b.tot.cost - a.tot.cost, known: a.priceKnown && b.priceKnown };
    if (res.extra <= 0 && res.saving1 >= 0) { res.kind = "always"; res.years = 0; return res; }
    if (res.extra < 0 && res.saving1 < 0) return payback(b, a); // aksincha: arzon uskuna qimmat to'lov bilan
    if (res.saving1 <= 0) { res.kind = "never"; res.years = null; return res; }
    for (let y = 1; y <= 30; y++) {
      const d0 = a.cum[y - 1] - b.cum[y - 1], d1 = a.cum[y] - b.cum[y];
      if (d1 <= 0) { res.kind = "years"; res.years = y - 1 + d0 / (d0 - d1); return res; }
    }
    res.kind = "never"; res.years = null; return res;
  }
  const paybacks = [];
  for (const st of states) {
    const get = (s) => variants.find((v) => v.id === s + st.key);
    const hp = get("hp"), eb = get("eb"), gb = get("gb");
    if (hp && eb) paybacks.push(payback(hp, eb));
    if (hp && gb) paybacks.push(payback(hp, gb));
    if (!hp && eb && gb) paybacks.push(payback(gb, eb));
  }

  return { customer, tIn, tDes, gain, baseEl, baseGas, effEb, effGb, gasKwh, supply, months, seasonDays,
    states, systems, variants, hpInfo, paybacks, growth: g, usd, years: YEARS, insulUsd };
}

const CALC = { DEFAULT_TARIFFS, DEFAULT_MONTHS, DEFAULT_INPUT, AUTO, COP_CURVES, HP_MODELS, HP_AMB, INF,
  num, compute, equipAuto, tiered, elecBill, gasBill, gasTiers, copAuto, selectHp, modelAt };
if (typeof module !== "undefined" && module.exports) module.exports = CALC;
