const fs = require("fs"), vm = require("vm");
const mod = { exports: {} }; vm.runInNewContext(fs.readFileSync(__dirname + "/src/calc.js", "utf8"), { module: mod, Math, Number, JSON, String, parseFloat, isFinite });
const C = mod.exports;
const inp = JSON.parse(JSON.stringify(C.DEFAULT_INPUT));
const r = C.compute(inp, C.DEFAULT_TARIFFS);
const f = (x, d = 1) => (x / 1e6).toFixed(d);
for (const v of r.variants) {
  console.log(v.id, "heat", Math.round(v.tot.heat), "elHeat", Math.round(v.tot.elHeat), "el", Math.round(v.tot.el), "gas", Math.round(v.tot.gas),
    "avg", v.avgEl && Math.round(v.avgEl), "heatPrice", Math.round(v.heatPrice), "peak", v.peak && v.peak.toFixed(1), "jan", f(v.jan), "TOTAL", f(v.tot.cost),
    "months", v.rows.map(x => f(x.cost)).join(" "), "capex", f(v.capex), "10y", f(v.total10));
}
console.log(r.hpInfo);
console.log(r.paybacks);
// rasm bilan solishtirish
const exp = { ebA: 128.4, ebB: 77.0, hpA: 40.9, hpB: 24.6 };
let ok = true;
for (const k in exp) { const got = +f(r.variants.find(v => v.id === k).tot.cost); if (got !== exp[k]) { ok = false; console.log("MISMATCH", k, got, exp[k]); } }
console.log(ok ? "PICTURE MATCH OK" : "PICTURE MISMATCH");
// yur. shaxs
inp.customer = "biz"; const r2 = C.compute(inp, C.DEFAULT_TARIFFS);
console.log("biz", r2.variants.map(v => v.id + ":" + f(v.tot.cost)).join(" "));
// gaz pog'onalari: 700 m3 qishda = 950 000; boshqa oyda 1 310 000
console.log(C.gasBill(700, C.DEFAULT_TARIFFS, "res", true), C.gasBill(700, C.DEFAULT_TARIFFS, "res", false));
console.log(C.elecBill(18613, C.DEFAULT_TARIFFS, "res"));
