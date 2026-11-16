# Расчёт отопления: собирает isitish/src/* в один файл src/isitish.html (его показывает раздел «Расчёт отопления»)
# Запуск: python3 isitish/build.py   ·   Проверка расчёта: node isitish/test_calc.cjs
import os
H = os.path.dirname(os.path.abspath(__file__)); S = os.path.join(H, "src")
r = lambda f: open(os.path.join(S, f), encoding="utf-8").read()
html = f'''<!DOCTYPE html>
<html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Isitish kalkulyatori</title><style>{r("style.css")}</style></head>
<body><div id="app"></div>
<!--HOST-->
<script>{r("calc.js")}</script><script>{r("i18n.js")}</script><script>{r("render.js")}</script><script>{r("app.js")}</script>
</body></html>'''
out = os.path.join(H, "..", "src", "isitish.html")
open(out, "w", encoding="utf-8").write(html); print("src/isitish.html", len(html))
