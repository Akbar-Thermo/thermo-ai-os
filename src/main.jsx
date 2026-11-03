import "./testmode.js"; // sinov rejimi (?sinov=1) — до всего остального
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);
