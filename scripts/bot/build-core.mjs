// Сборка api/_lib/core.mjs — расчёты программы (касса, долги, способы оплаты) для Telegram-бота.
// Запускается перед сборкой сайта (npm run build), поэтому бот всегда считает так же, как программа.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
try {
await build({
  entryPoints: [resolve(root, "scripts/bot/core-entry.js")],
  outfile: resolve(root, "api/_lib/core.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node18", jsx: "automatic", logLevel: "warning",
  external: ["xlsx"], // Excel боту не нужен (загружается только при выгрузке)
  nodePaths: process.env.NODE_PATH ? process.env.NODE_PATH.split(":") : [],
  // клиент Supabase боту не нужен (базу читает pg) — заглушка, как в ночном бэкапе
  alias: { "@supabase/supabase-js": resolve(root, "scripts/nightly/supabase-stub.js") },
  define: { "import.meta.env.VITE_SUPABASE_URL": '"http://localhost"', "import.meta.env.VITE_SUPABASE_ANON_KEY": '"x"', "process.env.NODE_ENV": '"production"' },
  banner: { js: "// СОБРАНО АВТОМАТИЧЕСКИ из src/App.jsx (scripts/bot/build-core.mjs) — не править вручную\n" },
});
console.log("bot core: api/_lib/core.mjs");
} catch (e) {
  // сайт всё равно собирается: бот возьмёт ранее собранный api/_lib/core.mjs из репозитория
  console.warn("bot core: не собран (" + (e.message || e).split("\n")[0] + ") — используется версия из репозитория");
}
