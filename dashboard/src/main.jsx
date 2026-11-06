import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./style.css";
createRoot(document.getElementById("root")).render(<App />);
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => {
    let timer, updating = false;
    const update = async () => {
      clearTimeout(timer);
      if (document.hidden || !navigator.onLine || updating) return;
      updating = true;
      try {
        await registration.update();
      } catch {
        // Keep the installed version when the Mac cannot be reached.
      } finally {
        updating = false;
        if (!document.hidden && navigator.onLine) timer = setTimeout(update, 60000);
      }
    };
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", () => clearTimeout(timer));
    update();
  }).catch((error) => {
    console.error("Offline setup failed", error);
  });
}
