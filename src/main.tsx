import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Gespeichertes Farbschema vor dem ersten Zeichnen setzen, damit nichts aufblitzt
try {
  const theme = localStorage.getItem("mc-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  /* ohne Speicher gilt das System-Schema */
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
