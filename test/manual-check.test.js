import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "vite";
import { chromium } from "playwright";
import { createApp } from "../src/server.js";
import { openStore } from "../src/storage.js";
import { acquireLock } from "../src/lock.js";
import { port } from "../src/config.js";

test("Manual checks acknowledge immediately, exclude other work, and retain their result across server restarts", async () => {
  const db = openStore(":memory:");
  let complete, calls = 0, fail = false;
  const app = createApp(db, (_db, _id, { onProgress }) => {
    calls++;
    if (fail) throw Error("private worker details");
    onProgress("account-1", { stage: "coupons", brand: "Galp", read: 1, total: 2 });
    return new Promise(resolve => { complete = resolve; });
  }, "");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const request = (pathname, method = "GET") => new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${server.address().port}${pathname}`, {
      method, headers: { Host: `localhost:${port}`, "Content-Type": "application/json", Prefer: "respond-async" },
    }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.setTimeout(3000, () => req.destroy(new Error("The response waited for coupon collection")));
    req.on("error", reject);
    req.end(method === "POST" ? "{}" : undefined);
  });
  try {
    const release = acquireLock(db);
    assert.equal((await request("/api/check", "POST")).status, 409);
    assert.equal(calls, 0);
    release();
    const accepted = await request("/api/check", "POST");
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.check.status, "running");
    assert.deepEqual(accepted.body.check.progress["account-1"], { stage: "queued" });
    assert.equal(calls, 1);
    const state = (await request("/api/state")).body;
    assert.equal(state.running, true);
    assert.equal(state.manualCheck.id, accepted.body.check.id);
    assert.deepEqual(state.manualCheck.progress["account-1"], { stage: "coupons", brand: "Galp", read: 1, total: 2 });
    assert.deepEqual(state.manualCheck.progress["account-2"], { stage: "queued" });
    assert.equal((await request("/api/check", "POST")).status, 409);
    assert.equal((await request("/api/cards/account-1/activate", "POST")).status, 409);
    let drained = false;
    app.locals.finishCheck().then(() => { drained = true; });
    assert.equal(drained, false);
    const results = [{ accountId: "account-1", ok: true, count: 17 }, { accountId: "account-2", ok: false, code: "AUTH_REQUIRED" }];
    complete(results);
    await app.locals.finishCheck();
    assert.equal(drained, true);
    const finished = (await request("/api/state")).body;
    assert.equal(finished.running, false);
    assert.deepEqual(finished.manualCheck.results, results);
    assert.equal(finished.manualCheck.status, "completed");
    assert.ok(finished.manualCheck.completedAt);
    createApp(db, async () => [], "");
    assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='manual_check'").get().value), finished.manualCheck);
    fail = true;
    assert.equal((await request("/api/check", "POST")).status, 202);
    await app.locals.finishCheck();
    const failed = (await request("/api/state")).body;
    assert.equal(failed.running, false);
    assert.equal(failed.manualCheck.status, "failed");
    assert.equal(failed.manualCheck.error, "CHECK_FAILED");
    assert.equal(JSON.stringify(failed).includes("private worker details"), false);
    db.prepare("UPDATE metadata SET value=? WHERE key='manual_check'").run(JSON.stringify(accepted.body.check));
    createApp(db, async () => [], "");
    const interrupted = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='manual_check'").get().value);
    assert.equal(interrupted.status, "failed");
    assert.equal(interrupted.error, "CHECK_INTERRUPTED");
  } finally {
    complete?.([]);
    await app.locals.finishCheck();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test("Manual refresh recovers a lost acknowledgement, offline status, page reloads, and account failures without replay", async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8000);
    let starts = 0, disconnected = false;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = { accounts: [
      { id: "account-1", name: "Conta de teste", auth: "ready", source: "android" },
      { id: "account-2", name: "Outra conta", auth: "ready", source: "android" },
    ],
      coupons: [], events: [], notifications: [], running: false, manualCheck: null, dailyTime: "09:00" };
    await page.route("**/api/state", route => disconnected ? route.abort("failed")
      : route.fulfill({ json: { ...state, serverNow: Date.now() } }));
    await page.route("**/api/check", route => {
      assert.equal(route.request().headers().prefer, "respond-async");
      starts++;
      state.running = true;
      state.manualCheck = {
        id: String(starts), accountId: "all", status: "running", startedAt: new Date().toISOString(),
        progress: { "account-1": { stage: "balance" }, "account-2": { stage: "opening" } },
      };
      return starts === 1 ? route.abort("failed")
        : route.fulfill({ status: 202, json: { check: state.manualCheck, serverNow: Date.now() } });
    });
    const refreshState = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.getByRole("button", { name: "Verificar cupões", exact: true }).click();
    await page.getByText(/Ligação interrompida.*estado da verificação/).waitFor();
    await refreshState();
    await page.getByText(/A verificar cupões no Mac/).waitFor();
    const progress = page.getByRole("list", { name: "Progresso por conta" });
    await progress.getByText("A ler o saldo").waitFor();
    await progress.getByText("A abrir a conta").waitFor();
    state.manualCheck.progress["account-1"] = { stage: "coupons", brand: "Galp", read: 1, total: 2 };
    await progress.getByText("A ler cupões · Galp (1/2)").waitFor();
    assert.equal(await page.getByRole("button", { name: "Operação em curso" }).isDisabled(), true);
    disconnected = true;
    await refreshState();
    await page.getByText("Volte a ligar ao Mac para confirmar o estado da última verificação.").waitFor();
    assert.equal(await progress.count(), 0);
    assert.equal(starts, 1);
    state.running = false;
    state.manualCheck = { ...state.manualCheck, status: "completed", results: [{ accountId: "account-1", ok: true }], completedAt: new Date().toISOString() };
    disconnected = false;
    await page.reload();
    await page.getByText(/Verificação concluída em/).waitFor();
    assert.equal(starts, 1);
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.getByRole("button", { name: "Verificar cupões", exact: true }).click();
    await page.getByText(/A verificar cupões no Mac/).waitFor();
    await page.reload();
    await page.getByText(/A verificar cupões no Mac/).waitFor();
    await progress.getByText("A ler o saldo").waitFor();
    state.running = false;
    state.manualCheck = { ...state.manualCheck, status: "completed", results: [{ accountId: "account-1", ok: false, code: "AUTH_REQUIRED" }], completedAt: new Date().toISOString() };
    await refreshState();
    await page.getByRole("alert").getByText(/Uma conta não pôde ser verificada/).waitFor();
    state.manualCheck = { ...state.manualCheck, status: "failed", error: "CHECK_INTERRUPTED", results: undefined };
    await refreshState();
    await page.getByRole("alert").getByText(/A verificação foi interrompida no Mac/).waitFor();
    assert.equal(starts, 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
