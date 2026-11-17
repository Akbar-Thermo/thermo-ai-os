// Tekshiruv: node usta/test_engine.cjs
const fs = require("fs"), path = require("path");
const S = path.join(__dirname, "src");
eval(fs.readFileSync(path.join(S, "vocab.js"), "utf8") + fs.readFileSync(path.join(S, "engine.js"), "utf8") + ";globalThis.E=ENGINE;");
const cases = [
  ["troynik 25 10 ta", "Тройник ППР", "25", 10],
  ["тройник 25*20 5шт", "Тройник ППР переходной", "25×20", 5],
  ["тройнк 32", "Тройник ППР", "32", null],
  ["kran sharovoy 1/2 vn nar 4ta", "Кран шаровой", '1/2"', 4],
  ["кран шаравой 3/4 бабочка 2", "Кран шаровой", '3/4"', 2],
  ["amerikanka 25 3/4 2 ta", "Американка ППР", '25×3/4"', 2],
  ["американка 1/2", "Американка (латунь)", '1/2"', null],
  ["otvod 20 30ta", "Отвод ППР (угол)", "20", 30],
  ["ugolok 25 45", "Отвод ППР (угол)", "25", null],
  ["ppr truba 25 100 m", "Труба ППР PN20 (горячая вода)", "25", 100],
  ["armirovanniy truba 32 50m", "Труба ППР PN25 армированная", "32", 50],
  ["metalloplast 16 200м", "Труба металлопластиковая", "16×2", 200],
  ["press troynik 20", "Пресс тройник", "20×2", null],
  ["rasshiritelniy bak 24 l", "Бак расширительный (отопление)", "24 л", null],
  ["расширбак 50", "Бак расширительный (отопление)", "50 л", null],
  ["kotyol 24 kvt dvuxkonturniy", "Котёл газовый настенный", "24 кВт", null],
  ["nasos 25-60 180", "Насос циркуляционный", "25-60 180", null],
  ["kollektor 1 5 vixod", "Коллектор распределительный", '1"', null],
  ["radiator 22 500x1000 6 ta", "Радиатор панельный", "500×1000", 6],
  ["maevskiy 1/2 10ta", "Кран Маевского", '1/2"', 10],
  ["vozduxootvodchik", "Воздухоотводчик автоматический", "", null],
  ["obratniy klapan 1 dyuym", "Клапан обратный", '1"', null],
  ["zaglushka 20 5", "Заглушка ППР", "20", 5],
  ["нипель 1/2", "Ниппель", '1/2"', null],
  ["bochonok 3/4 4", "Бочонок", '3/4"', 4],
  ["перходник 32 25", "Муфта ППР переходная", "32×25", null],
  ["клипса 20 100шт", "Клипса ППР (крепление трубы)", "20", 100],
  ["kanal truba 110 2", "Труба канализационная", "110", 2],
  ["лён 2", "Лён сантехнический", "", 2],
  ["gaz shlang 1.5 m", "Шланг газовый", "1,5 м", null],
  ["xomut 1 1/4 10", "Хомут с резиной (металл)", '1 1/4"', 10],
  ["водарозетка 20", "Водорозетка ППР (настенный угольник)", '20×1/2"', null],
  ["udlinitel 1/2 15mm 4ta", "Удлинитель", '1/2"', 4],
  ["sharovoy kran 1.1/4", "Кран шаровой", '1 1/4"', null],
];
let ok = 0;
for (const [q, name, size, qty] of cases) {
  const r = E.suggest(q, 3)[0];
  const got = r ? [r.it.name, r.size, r.qty] : ["—"];
  const pass = r && r.it.name === name && r.size === size && (qty == null || r.qty === qty);
  if (pass) ok++;
  console.log((pass ? "ok  " : "FAIL") + "  " + q.padEnd(34) + " → " + (r ? E.lineText({ it: r.it, vars: r.vars, size: r.size }) + " | " + r.qty + " " + r.unit + " (" + r.score.toFixed(2) + ")" : "—") + (pass ? "" : "   ожидалось: " + name + " " + size + " " + qty));
}
console.log(ok + "/" + cases.length);
console.log("complete('трой')", E.complete("трой"), "complete('kol')", E.complete("kol"));
process.exit(ok === cases.length ? 0 : 1);
