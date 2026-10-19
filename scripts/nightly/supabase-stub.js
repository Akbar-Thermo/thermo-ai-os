// Заглушка @supabase/supabase-js для сборки ночного Excel-архива (scripts/nightly/archive-entry.js).
// Из программы в ночной бэкап берётся только archiveBook — к базе он не ходит (базу читает psql).
// Настоящий клиент Supabase здесь не нужен и вредит: его realtime-часть на сервере GitHub (Node 20)
// падает при загрузке — «Node.js 20 detected without native WebSocket support».
const unavailable = () => { throw new Error("Supabase-клиент в ночном бэкапе не используется"); };
export function createClient() {
  return new Proxy({}, { get: (_, k) => (k === "then" ? undefined : unavailable) });
}
