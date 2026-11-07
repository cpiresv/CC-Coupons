import express from "express";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { root, port, tailscaleHost, selectAccounts } from "./config.js";
import { openStore, dashboardData } from "./storage.js";
import { runChecks } from "./monitor.js";
import { isBusy } from "./lock.js";
import { activateCard } from "./cards.js";

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

export function createApp(db, check = runChecks, privateHost = tailscaleHost, activate = activateCard) {
  const app = express();
  let running = false;
  let pendingCheck;
  let manualCheck = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='manual_check'").get()?.value || "null");
  const saveCheck = () => db.prepare("INSERT INTO metadata(key,value) VALUES('manual_check',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify(manualCheck));
  if (manualCheck?.status === "running") {
    manualCheck = { ...manualCheck, status: "failed", error: "CHECK_INTERRUPTED", completedAt: new Date().toISOString() };
    saveCheck();
  }
  app.locals.finishCheck = () => pendingCheck;
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const privateHttps = privateHost && req.headers.host === privateHost &&
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
    if (!privateHttps && !localHosts().has(req.headers.host))
      return res.status(403).json({ error: "Local network access only" });
    if (
      req.headers.origin &&
      req.headers.origin !== `${privateHttps ? "https" : "http"}://${req.headers.host}`
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
    if (["/", "/index.html", "/sw.js", "/manifest.webmanifest"].includes(req.path))
      res.set("Cache-Control", "no-cache");
    next();
  });
  app.use(express.json({ limit: "4kb" }));
  app.get("/api/state", (_req, res) =>
    res.json({
      ...dashboardData(db),
      serverNow: Date.now(),
      running: running || isBusy(db),
      manualCheck,
      telegramConfigured: !!(
        process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
      ),
      dailyTime: process.env.DAILY_CHECK_TIME || "09:00",
    }),
  );
  app.post("/api/cards/:accountId/activate", async (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "JSON required" });
    const { accountId } = req.params;
    try {
      if (accountId === "all" || selectAccounts(accountId)[0].source !== "android") throw Error();
    } catch { return res.status(400).json({ error: "Invalid account" }); }
    if (running || isBusy(db)) return res.status(409).json({ error: "BUSY" });
    running = true;
    try {
      const card = await activate(db, accountId);
      res.json({ card, serverNow: Date.now() });
    } catch (error) {
      res.status(error.code === "BUSY" ? 409 : 502).json({
        error: ["BUSY", "AUTH_REQUIRED", "CARD_EXPIRED"].includes(error.code) ? error.code : "CARD_UNCONFIRMED",
      });
    } finally { running = false; }
  });
  app.get("/api/cards/:accountId/image", (req, res) => {
    const card = db.prepare("SELECT image FROM card_sessions WHERE account_id=? AND expires_at=? AND expires_at>?")
      .get(req.params.accountId, Number(req.query.expiresAt) || 0, Date.now());
    if (!card) return res.status(404).json({ error: "Card authorization expired or unavailable" });
    res.type("png").send(Buffer.from(card.image));
  });
  app.post("/api/check", async (req, res) => {
    if (!req.is("application/json"))
      return res.status(415).json({ error: "JSON required" });
    const id = req.body?.accountId || "all";
    let selected;
    try {
      selected = selectAccounts(id);
    } catch {
      return res.status(400).json({ error: "Invalid account" });
    }
    if (running || isBusy(db))
      return res
        .status(409)
        .json({ error: "A check or login is already running" });
    manualCheck = {
      id: randomUUID(), accountId: id, status: "running", startedAt: new Date().toISOString(),
      progress: Object.fromEntries(selected.map(account => [account.id, { stage: "queued" }])),
    };
    saveCheck();
    running = true;
    const asynchronous = req.get("Prefer") === "respond-async";
    if (asynchronous) res.status(202).json({ check: manualCheck, serverNow: Date.now() });
    pendingCheck = (async () => {
      try {
        const results = await check(db, id, {
          onProgress(accountId, update) { manualCheck.progress[accountId] = update; },
        });
        manualCheck = { ...manualCheck, status: "completed", results, completedAt: new Date().toISOString() };
      } catch {
        manualCheck = { ...manualCheck, status: "failed", error: "CHECK_FAILED", completedAt: new Date().toISOString() };
      } finally {
        running = false;
        saveCheck();
      }
    })().catch(() => console.error("Could not persist manual check status"));
    // Installed older dashboard versions still expect the completed response.
    if (!asynchronous) {
      await pendingCheck;
      if (manualCheck.status === "failed") res.status(500).json({ error: "Check failed. Previous data was retained." });
      else res.json({ results: manualCheck.results });
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
  const app = createApp(db);
  const server = app.listen(port, tailscaleHost ? "127.0.0.1" : "0.0.0.0", () => {
    if (tailscaleHost) console.log(`Dashboard: https://${tailscaleHost}`);
    else for (const host of localHosts()) console.log(`Dashboard: http://${host}`);
  });
  server.on("error", () => {
    console.error("Dashboard failed to bind the configured port.");
    db.close();
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      server.close(async () => {
        await app.locals.finishCheck();
        db.close();
        process.exit();
      }),
    );
}
