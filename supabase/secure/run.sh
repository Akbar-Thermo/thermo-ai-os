#!/usr/bin/env bash
# Включение / откат защиты базы из GitHub Actions (кнопка Run workflow) — см. .github/workflows/db-secure.yml.
# Пароль базы берётся из секрета репозитория SUPABASE_DB_PASSWORD (в логах не печатается).
# Адрес API и публичный ключ — из .env.txt, адрес подключения к базе — из supabase/.temp/pooler-url.
set -euo pipefail
cd "$(dirname "$0")/../.."
step="${1:-status}"
envval() { grep -E "^$1=" .env.txt | head -1 | cut -d= -f2- | tr -d '\r'; }
URL="${TE_URL:-$(envval VITE_SUPABASE_URL)}"
ANON="${TE_ANON:-$(envval VITE_SUPABASE_ANON_KEY)}"
ORIGIN="${TE_ORIGIN:-https://thermo-ai-os.vercel.app}"
POOL="$(cat supabase/.temp/pooler-url 2>/dev/null || true)"   # postgresql://postgres.<ref>@host:5432/postgres
PGHOST="${TE_PGHOST:-$(echo "$POOL" | sed -E 's#^postgres(ql)?://[^@]*@([^:/]+).*#\2#')}"
PGPORT="${TE_PGPORT:-$(echo "$POOL" | sed -E 's#^.*:([0-9]+)/.*$#\1#')}"
PGUSER="${TE_PGUSER:-$(echo "$POOL" | sed -E 's#^postgres(ql)?://([^@:]+).*#\2#')}"
export PGHOST PGPORT PGUSER PGDATABASE=postgres PGSSLMODE="${TE_SSL:-require}" PGCONNECT_TIMEOUT=15
# секрет SUPABASE_DB_URL (Supabase → Connect → Session pooler) — если задан, подключаемся по нему
DB_URL="${SUPABASE_DB_URL:-}"
q() { if [ -n "$DB_URL" ]; then psql "$DB_URL" -v ON_ERROR_STOP=1 -qtA "$@"; else psql -v ON_ERROR_STOP=1 -qtA "$@"; fi; }
say() { echo "▶ $*"; }
fail() { echo "::error::$*"; exit 1; }

check_api_closed() {
  # без входа API должен отвечать te_session_required; te_status — secure:true (PostgREST перечитывает схему за секунды)
  for i in $(seq 1 20); do
    body=$(curl -s "$URL/rest/v1/users?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" || true)
    st=$(curl -s -X POST "$URL/rest/v1/rpc/te_status" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "content-type: application/json" -d '{}' || true)
    if echo "$body" | grep -q te_session_required && echo "$st" | grep -q '"secure": *true'; then return 0; fi
    sleep 3
  done
  echo "users без входа: ${body:0:120}"; echo "te_status: ${st:0:120}"
  return 1
}

case "$step" in
  connect)
    [ -n "${PGPASSWORD:-}" ] || [ -n "$DB_URL" ] || fail "Нет секрета SUPABASE_DB_PASSWORD (GitHub → Settings → Secrets and variables → Actions)"
    [ -n "$URL" ] && [ -n "$ANON" ] || fail "Не найден адрес Supabase или ключ в .env.txt"
    err=$(q -c "select 1" 2>&1 >/dev/null) || {
      case "$err" in
        *"password authentication failed"*) fail "Неверный пароль базы: сбросьте его в Supabase (Database → Settings) и вставьте в секрет SUPABASE_DB_PASSWORD" ;;
        *"Tenant or user not found"*) fail "Адрес подключения устарел: добавьте секрет SUPABASE_DB_URL (Supabase → Connect → Session pooler)" ;;
        *) fail "Не удалось подключиться к базе: $(echo "$err" | tr '\n' ' ' | sed -E 's/.*FATAL: *//' | cut -c1-200)" ;;
      esac; }
    say "Подключение к базе: OK ($(q -c "select count(*) from public.users") аккаунтов, $(q -c "select count(*) from public.products") товаров)"
    ;;
  cors)
    # сайт отправляет токен входа в заголовке x-te-session — шлюз Supabase должен его пропускать
    allow=$(curl -s -o /dev/null -D - -X OPTIONS "$URL/rest/v1/users" -H "Origin: $ORIGIN" -H "Access-Control-Request-Method: GET" \
      -H "Access-Control-Request-Headers: apikey,authorization,content-type,x-client-info,x-te-session" | tr -d '\r' | grep -i '^access-control-allow-headers:' || true)
    echo "$allow"
    if echo "$allow" | grep -qiE 'x-te-session|: *\*'; then say "Заголовок x-te-session разрешён: OK"
    else fail "Шлюз Supabase не пропускает заголовок x-te-session — защиту включать нельзя (сайт перестанет работать)"; fi
    ;;
  apply)
    say "Включаю защиту…"
    q -f supabase/secure/01_sessions.sql
    if check_api_closed; then say "Защита включена: без входа база закрыта, вход — через сервер"
    else
      echo "::error::Проверка после включения не прошла — откатываю"
      q -f supabase/secure/rollback.sql
      fail "Защита НЕ включена (всё возвращено как было)"
    fi
    ;;
  rollback)
    say "Откат защиты…"
    q -f supabase/secure/rollback.sql
    say "Готово: всё как было до защиты"
    ;;
  status)
    on=$(q -c "select to_regproc('public.te_status') is not null")
    if [ "$on" = "t" ]; then
      say "Защита: ВКЛЮЧЕНА · активных сессий: $(q -c "select count(*) from public.te_sessions where expires_at > now()")"
    else say "Защита: выключена (старый режим)"; fi
    ;;
  *) fail "неизвестный шаг: $step" ;;
esac
