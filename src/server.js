import express from "express";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { root, port, selectAccounts } from "./config.js";
import { openStore, dashboardData } from "./storage.js";
import { runChecks } from "./monitor.js";
import { isBusy } from "./lock.js";

function localHosts() {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(
      (entry) =>
        entry.family === "IPv4" &&
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(entry.address),
    )
    .map((entry) => entry.address);
  return new Set(
    ["127.0.0.1", "localhost", ...addresses].map((host) => `${host}:${port}`),
  );
}

export function createApp(db, check = runChecks) {
  const app = express();
  let running = false;
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (!localHosts().has(req.headers.host))
      return res.status(403).json({ error: "Local network access only" });
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}`
    )
      return res.status(403).json({ error: "Origin rejected" });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ error: "Origin rejected" });
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://appcartao.cdn.mc.pt; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "4kb" }));
  app.get("/api/state", (_req, res) =>
    res.json({
      ...dashboardData(db),
      running: running || isBusy(db),
      telegramConfigured: !!(
        process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
      ),
      dailyTime: process.env.DAILY_CHECK_TIME || "09:00",
    }),
  );
  app.post("/api/check", async (req, res) => {
    if (!req.is("application/json"))
      return res.status(415).json({ error: "JSON required" });
    const id = req.body?.accountId || "all";
    try {
      selectAccounts(id);
    } catch {
      return res.status(400).json({ error: "Invalid account" });
    }
    if (running)
      return res
        .status(409)
        .json({ error: "A check or login is already running" });
    running = true;
    try {
      const results = await check(db, id);
      res.json({ results });
    } catch (e) {
      res
        .status(e.code === "BUSY" ? 409 : 500)
        .json({
          error:
            e.code === "BUSY"
              ? "A check or login is already running"
              : "Check failed. Previous data was retained.",
        });
    } finally {
      running = false;
    }
  });
  app.use(express.static(path.join(root, "dist"), { index: "index.html" }));
  app.use((err, req, res, _next) =>
    res.status(400).json({ error: "Invalid request" }),
  );
  return app;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openStore();
  const server = createApp(db).listen(port, "0.0.0.0", () => {
    for (const host of localHosts()) console.log(`Dashboard: http://${host}`);
  });
  server.on("error", () => {
    console.error("Dashboard failed to bind the configured port.");
    db.close();
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      server.close(() => {
        db.close();
        process.exit();
      }),
    );
}
