import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
    const app = express();
    app.use("/api/state", (_req, res, next) => unavailable ? res.sendStatus(503) : next());
    app.get("/api/state", (_req, res) => res.json({
      accounts: [{ id: "account-1", name: "Conta de teste", auth: "ready", last_success: new Date().toISOString() }],
      coupons: [{ accountId: "account-1", key: "test", code: "test", brand: "Continente",
        title: "Oferta de teste", description: "Condições de teste", discount: "5 €",
        startDate: "2020-01-01", endDate: "2099-12-31", firstSeen: "2020-01-01T12:00:00Z",
        present: true, status: "available", imageUrl: null }],
      events: [], notifications: [], running: false, dailyTime: "09:00", telegramConfigured: false,
    }));
    app.post("/api/check", (_req, res) => { checks++; unavailable = true; res.json({ results: [] }); });
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
    await page.getByText("Verificação concluída no Mac. Volte a ligar para receber os cupões atualizados.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Verificar cupões" }).isDisabled(), true);
    assert.equal(checks, 1);
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
