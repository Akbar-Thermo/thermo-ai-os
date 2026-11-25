# Usta ro'yxati: usta/src/* → public/usta/index.html (ochiq sahifa /usta/, kirish shart emas)
# Ishga tushirish: python3 usta/build.py   ·   Tanib olish tekshiruvi: node usta/test_engine.cjs
# Baza manzili va ochiq (anon) kalit .env.txt dan olinadi — ular Thermo AI OS sahifasida ham ochiq turadi.
import os, json, re
H = os.path.dirname(os.path.abspath(__file__)); S = os.path.join(H, "src"); ROOT = os.path.join(H, "..")
r = lambda f: open(os.path.join(S, f), encoding="utf-8").read()
env = {}
for line in open(os.path.join(ROOT, ".env.txt"), encoding="utf-8"):
    m = re.match(r"\s*([A-Z_]+)\s*=\s*(.+?)\s*$", line)
    if m: env[m.group(1)] = m.group(2)
cfg = {"url": env["VITE_SUPABASE_URL"].rstrip("/"), "key": env["VITE_SUPABASE_ANON_KEY"]}
html = f'''<!DOCTYPE html>
<html lang="uz"><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap" media="(min-width: 900px)">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5f5f5"><meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>Material ro'yxati — Thermo</title><style>{r("style.css")}</style></head>
<body><div id="app"></div>
<script>window.USTA_CFG = {json.dumps(cfg)};</script>
<script>{r("vocab.js")}</script><script>{r("engine.js")}</script><script>{r("i18n.js")}</script><script>{r("app.js")}</script>
</body></html>'''
out = os.path.join(ROOT, "public", "usta", "index.html")
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w", encoding="utf-8").write(html); print("public/usta/index.html", len(html))
