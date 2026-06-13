import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// --- window.storage shim (localStorage) ---
// Прототип использует window.storage. В обычном браузере его нет,
// поэтому подменяем на localStorage — приложение работает сразу, локально.
// При переходе на Supabase данные переносятся в облако (см. README, db.js).
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      const v = localStorage.getItem(key);
      return v == null ? null : { key, value: v };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return { key, value };
    },
    async delete(key) {
      localStorage.removeItem(key);
      return { key, deleted: true };
    },
    async list(prefix = "") {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      return { keys, prefix };
    },
  };
}

createRoot(document.getElementById("root")).render(<App />);
