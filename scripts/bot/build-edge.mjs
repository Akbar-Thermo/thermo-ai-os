// Сборка функции Supabase «tg» в один файл supabase/functions/tg/bundle/bot.js (коммитится в репозиторий):
// функция в Supabase — короткий index.ts, который импортирует этот файл с конкретного коммита (jsDelivr) —
// supabase/functions/tg/index.js + api/_lib (бот, REST) + расчёты программы (src/App.jsx) без React.
// Запуск: node scripts/bot/build-edge.mjs <выходной файл>
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2] || resolve(root, "supabase/functions/tg/bundle/bot.js");
const tmp = mkdtempSync(resolve(tmpdir(), "tgedge-"));
// React боту не нужен: расчёты кассы/долгов — обычные функции; компоненты не вызываются
writeFileSync(resolve(tmp, "react-stub.js"), `const f = () => undefined;
export const useState = f, useEffect = f, useRef = f, useMemo = f, useLayoutEffect = f, useId = f, useDeferredValue = f, useCallback = f, useContext = f, useReducer = f, useTransition = f, useSyncExternalStore = f;
export const createContext = () => ({ Provider: f, Consumer: f });
export const memo = (x) => x, forwardRef = (x) => x, lazy = (x) => x;
export const Fragment = "f", StrictMode = "s", Suspense = "u";
export const createElement = f, cloneElement = f, isValidElement = () => false, Children = {};
export const jsx = f, jsxs = f;
export class Component { constructor(p) { this.props = p; } }
export class PureComponent extends Component {}
export default { createElement: f, Fragment: "f", Component, PureComponent };
`);
const stub = resolve(tmp, "react-stub.js");
const coreFile = resolve(root, "api/_lib/core.mjs");
await build({
  entryPoints: [resolve(root, "supabase/functions/tg/index.js")], outfile: out,
  bundle: true, format: "esm", platform: "neutral", target: "es2022", minify: true, charset: "utf8", legalComments: "none", jsx: "automatic", logLevel: "warning",
  external: ["node:*", "xlsx"],
  alias: { react: stub, "react/jsx-runtime": stub, "react-dom": stub, "react-dom/client": stub, "@supabase/supabase-js": resolve(root, "scripts/nightly/supabase-stub.js") },
  define: { "import.meta.env.VITE_SUPABASE_URL": '"http://localhost"', "import.meta.env.VITE_SUPABASE_ANON_KEY": '"x"', "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "core-from-source", setup(b) { b.onResolve({ filter: /\/core\.mjs$/ }, () => ({ path: resolve(root, "scripts/bot/core-entry.js") })); } }],
  banner: { js: "// Thermo Telegram-бот (функция Supabase «tg») — собрано scripts/bot/build-edge.mjs, не править вручную\n" },
});
console.log("edge: " + out + " (core: " + coreFile.replace(root + "/", "") + " → из src/App.jsx)");
