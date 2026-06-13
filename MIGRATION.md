# Перенос в облако: Supabase + Claude

Цель: данные в облаке, синхронная работа менеджера и руководителя с любого устройства, Claude (распознавание заявок и подбор) работает через защищённую серверную функцию.

## Шаг 1. Проект Supabase
1. supabase.com → New project. Записать пароль БД.
2. Project Settings → API: скопировать `Project URL` и `anon public` ключ.

## Шаг 2. Создать таблицы
Supabase → SQL Editor → New query → вставить всё из `schema.sql` → **Run**. Создадутся таблицы (включая `users` и `audit_log`).

## Шаг 3. Подключить Claude (ai-proxy)
Нужен платный API-ключ Anthropic (console.anthropic.com → API Keys → создать; пополнить баланс на $10–20 для начала).
```bash
npm i -g supabase
supabase login
supabase link --project-ref <ref из URL проекта>
supabase functions deploy ai-proxy --no-verify-jwt
supabase secrets set ANTHROPIC_API_KEY=sk-ant-ВАШ_КЛЮЧ
```

## Шаг 4. Три замены в `src/App.jsx`
Остальной код (объекты, склад, финансы, мастера, журнал, экспорты) не трогать.

**а) Подключить облачный адаптер.** Удалить локальный data-layer (блок от `const LS = "te:"` и класс `Q`, функции `persist`, `dbInit`, `probeStorage`, `tryGet`, `backupJSON`, `restoreFromText`, `exportBackup`/импорт-бэкап) и вместо `const db = { from: (t) => new Query(t) }` поставить вверху файла:
```js
import { db, supabase } from "./db";
```
> `db.js` уже реализует тот же интерфейс `db.from(...).select().eq().order()`, поэтому компоненты менять не нужно. Кнопку «Бэкап» и логику восстановления можно удалить — в облаке бэкап делает Supabase.

**б) Сессия/хранилище.** Строки, использующие `window.storage` для сессии входа, заменить на хранение в `localStorage` (или Supabase Auth — см. шаг 5). Для быстрого старта `localStorage` достаточно.

**в) Вызов Claude.** Функцию `claudeCall` заменить на:
```js
async function claudeCall(content, system) {
  const { data, error } = await supabase.functions.invoke("ai-proxy", { body: { content, system } });
  if (error) throw new Error(error.message);
  return data.text;
}
```
Формат `content` (текст/изображения/PDF) не меняется.

## Шаг 5. Аккаунты (по желанию — настоящая авторизация)
- Быстро: оставить текущий экран входа, таблица `users` в Supabase.
- Правильно: Supabase Authentication + таблица `profiles(role)`; роль читать после входа. Тогда разделение менеджер/руководитель закрепляется на уровне БД (RLS), а не только интерфейса.

## Шаг 6. Переменные окружения
Скопировать `.env.example` → `.env`, подставить значения:
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## Шаг 7. Хостинг
```bash
npm run build
```
Залить на Vercel или Cloudflare Pages (бесплатно), указать те же переменные окружения. Готово — открывается по ссылке на любом устройстве, данные общие и синхронные.

## Перенос данных
- Товары удобнее залить через «Импорт Excel» уже в боевой версии.
- Объекты/поставщиков/мастеров — при необходимости перенести скриптом из JSON-бэкапа прототипа (можно подготовить отдельно).

---

## Будущие обновления (после переноса)
- Правки интерфейса: изменили `App.jsx` → `git push` → Vercel сам пересобирает (~1 мин). Данные не трогаются.
- Новые поля в БД: одна команда `alter table ... add column ...` в Supabase. Колонки добавляем, существующие не ломаем.
- Функция Claude: меняется редко, `supabase functions deploy ai-proxy`.
- Код (Git) и данные (Supabase) разделены — обновление интерфейса никогда не затрагивает накопленные данные.
