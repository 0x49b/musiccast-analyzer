import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Apply the stored colour scheme and language before the first paint so nothing flashes
try {
  const theme = localStorage.getItem("mc-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  const lang = localStorage.getItem("mc-lang");
  if (lang === "de") document.documentElement.lang = "de";
} catch {
  /* without storage the system scheme and English apply */
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
