import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { build } from "vite";
import { chromium } from "playwright";

test("Built PWA survives an offline browser restart and reconnects without replaying checks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cc-coupons-pwa-"));
  let server, context;
  try {
    await build({ build: { outDir: path.join(directory, "dist") }, logLevel: "silent" });
    let checks = 0;
    let unavailable = false;
    let manualCheck = null;
    const app = express();
    app.use("/api/state", (_req, res, next) => unavailable ? res.sendStatus(503) : next());
    app.get("/api/state", (_req, res) => res.json({
      accounts: [{ id: "account-1", name: "Conta de teste", auth: "ready", last_success: new Date().toISOString() }],
      coupons: [{ accountId: "account-1", key: "test", code: "test", brand: "Continente",
        title: "Oferta de teste", description: "Condições de teste", discount: "5 €",
        startDate: "2020-01-01", endDate: "2099-12-31", firstSeen: "2020-01-01T12:00:00Z",
        present: true, status: "available", imageUrl: null }],
      events: [], notifications: [], running: manualCheck?.status === "running", manualCheck, dailyTime: "09:00", telegramConfigured: false,
    }));
    app.post("/api/check", (_req, res) => {
      checks++;
      manualCheck = { id: "test", status: "running", startedAt: new Date().toISOString() };
      res.status(202).json({ check: manualCheck, serverNow: Date.now() });
    });
    app.use(express.static(path.join(directory, "dist")));
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const launch = () => chromium.launchPersistentContext(path.join(directory, "browser"), {
      channel: "chrome", headless: true, viewport: { width: 390, height: 844 },
    });
    context = await launch();
    let page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.getByRole("heading", { name: "Continente · 1 cupão", exact: true }).waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const manifest = await page.evaluate(async () =>
      (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
    assert.equal(manifest.display, "standalone");
    const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    for (const { src, sizes } of [...manifest.icons, { src: touchIcon, sizes: "180x180" }]) {
      assert.equal(await page.evaluate(async (src) => {
        const image = new Image(); image.src = src; await image.decode();
        return `${image.naturalWidth}x${image.naturalHeight}`;
      }, src), sizes);
      assert.equal(await page.evaluate(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 100;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, 100, 100);
        const light = (x, y) => context.getImageData(x, y, 1, 1).data.slice(0, 3).every(channel => channel > 200);
        return light(50, 31) && light(50, 69) && !light(50, 85);
      }, src), true, `${src} must show one complete ticket`);
    }
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    assert.deepEqual(installabilityErrors, []);
    assert.equal(await page.getByRole("button", { name: "Verificar cupões" }).isEnabled(), true);
    await context.close();

    context = await launch();
    await context.setOffline(true);
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.getByText(/A mostrar a cópia guardada/).waitFor();
    assert.equal(await page.locator(".coupon").count(), 1);
    assert.equal(await page.getByRole("button", { name: "Verificar cupões" }).isDisabled(), true);
    await page.locator(".coupon summary").click();
    await page.locator(".details-body").getByText("test", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Comparar contas", exact: true }).click();
    await page.locator(".comparison .brand").waitFor();
    await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(async () => {
      try { await fetch("/api/check", { method: "POST" }); return true; } catch { return false; }
    }), false);
    await context.setOffline(false);
    await page.getByText(/Última sincronização com o Mac/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Verificar cupões" }).isEnabled(), true);
    assert.equal(checks, 0);
    await page.getByRole("button", { name: "Verificar cupões" }).click();
    await page.getByText(/A verificar cupões no Mac/).waitFor();
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("cc-coupons-state-v1"))?.data?.manualCheck?.id === "test");
    unavailable = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.getByText("Volte a ligar ao Mac para confirmar o estado da última verificação.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Verificar cupões" }).isDisabled(), true);
    assert.equal(checks, 1);
    manualCheck = { ...manualCheck, status: "completed", results: [], completedAt: new Date().toISOString() };
    unavailable = false;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.getByText(/Verificação concluída em/).waitFor();
    assert.equal(checks, 1);
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("PWA upgrades existing tabs automatically without clearing data or replaying checks", { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cc-coupons-update-"));
  let server, browser;
  try {
    for (const version of ["first", "second"]) {
      await build({
        build: { outDir: path.join(directory, version) }, logLevel: "silent",
        plugins: [{ name: "test-version", transformIndexHtml: html => html.replace("<head>", `<head><meta name="test-version" content="${version}">`) }],
      });
    }
    const legacyWorker = `
      const CACHE = 'cc-coupons-shell-legacy';
      self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.add('/'))));
      self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
      self.addEventListener('fetch', event => {
        if (event.request.method === 'GET' && new URL(event.request.url).pathname === '/')
          event.respondWith(caches.open(CACHE).then(cache => cache.match('/')));
      });`;
    let version = "legacy", broken = false, workerRequests = 0, writes = 0;
    const app = express();
    app.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
    app.get("/sw.js", async (_req, res) => {
      workerRequests++;
      let source = version === "legacy" ? legacyWorker : await readFile(path.join(directory, version, "sw.js"), "utf8");
      if (broken) source = source.replace('const ASSETS = [', 'const ASSETS = ["/missing-release-file.js",');
      res.type("application/javascript").send(source);
    });
    app.get("/missing-release-file.js", (_req, res) => res.sendStatus(503));
    app.get("/api/state", (_req, res) => res.json({
      accounts: [{ id: "account-1", name: "Conta de teste", auth: "ready" }],
      coupons: [{ accountId: "account-1", key: "test", code: "test", brand: "Continente",
        title: "Oferta de teste", description: "Condições de teste", discount: "5 €",
        startDate: "2020-01-01", endDate: "2099-12-31", firstSeen: "2020-01-01T12:00:00Z",
        present: true, status: "available", imageUrl: null }],
      events: [], notifications: [], running: true, serverNow: Date.now(),
      manualCheck: { id: "in-progress", status: "running", startedAt: new Date().toISOString() },
    }));
    app.post(/.*/, (_req, res) => { writes++; res.sendStatus(500); });
    app.get("/", (_req, res, next) => version === "legacy"
      ? res.send("<!doctype html><h1>Old dashboard</h1><script>navigator.serviceWorker.register('/sw.js')</script>")
      : next());
    app.use((req, res, next) => express.static(path.join(directory, version))(req, res, next));
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext();
    const page = await context.newPage(), other = await context.newPage();
    const errors = [];
    for (const tab of [page, other]) {
      tab.setDefaultTimeout(10000);
      tab.on("pageerror", error => errors.push(error.message));
      await tab.clock.install();
      await tab.goto(url);
      await tab.waitForFunction(() => !!navigator.serviceWorker.controller);
    }
    await page.evaluate(() => {
      document.cookie = "update-test=keep; SameSite=Strict; path=/";
      localStorage.setItem("update-test", "keep");
    });
    const expectVersion = async (tab, expected) => {
      await tab.waitForFunction(expected => document.querySelector('meta[name="test-version"]')?.content === expected, expected);
      await tab.getByText(/A verificar cupões no Mac/).waitFor();
      assert.equal(await tab.evaluate(() => localStorage.getItem("update-test")), "keep");
      assert.match(await tab.evaluate(() => document.cookie), /update-test=keep/);
    };
    // A normal reload discovers the updater even while another legacy tab stays open.
    version = "first";
    await page.reload();
    await expectVersion(page, "first");
    await expectVersion(other, "first");

    // An incomplete release must leave the working offline shell installed.
    broken = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const failed = new Promise(resolve => registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker.addEventListener("statechange", () => { if (worker.state === "redundant") resolve(); });
      }, { once: true }));
      await registration.update();
      await failed;
    });
    assert.equal(await page.locator('meta[name="test-version"]').getAttribute("content"), "first");
    await context.setOffline(true);
    await page.reload();
    await page.getByText(/A mostrar a cópia guardada/).waitFor();
    assert.equal(await page.locator(".coupon").count(), 1);
    broken = false;
    await context.setOffline(false);
    await page.getByText(/A verificar cupões no Mac/).waitFor();
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());

    // The foreground timer discovers the next release without a manual reload.
    version = "second";
    await page.clock.fastForward(60000);
    await expectVersion(page, "second");
    await expectVersion(other, "second");
    const cacheNames = await page.evaluate(() => caches.keys());
    assert.equal(cacheNames.filter(name => name.startsWith("cc-coupons-shell-")).length, 1);
    let reloads = 0;
    page.on("domcontentloaded", () => reloads++);
    const before = workerRequests;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    assert(workerRequests > before);
    assert.equal(reloads, 0);
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
