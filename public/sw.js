// Минимальный service worker: нужен только для установки как приложения.
// Ничего не кэширует — всегда берётся свежая версия с сервера.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
