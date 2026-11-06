import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { activateCard, cardBounds, openCardScreen } from "../src/cards.js";
import { openStore, dashboardData } from "../src/storage.js";
import { acquireLock, isBusy } from "../src/lock.js";
import { createApp } from "../src/server.js";
import { port } from "../src/config.js";

const execute = promisify(execFile);
const node = (id, text, bounds) => ({ "resource-id": id, text, bounds });
const home = [node("UseCardLink", "Usar Cartão")];
const selection = [node("b38-Skip", "Saltar"), node("b38-SelectAll3", "Selecionar todos")];
const authorized = [node("", "UseCardCode", "[0,0][600,1000]"),
  node("UniqueCodeParentContainer", "", "[50,200][550,600]"), node("", "codigo de barras")];

function fakeDevice(capture) {
  let screen = home;
  const taps = [];
  return { taps, capture, closed: false,
    async waitFor(predicate) { assert.equal(predicate(screen), true); return screen; },
    async tap(target) {
      taps.push(target["resource-id"]);
      screen = target["resource-id"] === "UseCardLink" ? selection : authorized;
    },
    async close() { this.closed = true; },
  };
}

test("Card navigation skips coupons and validates the observed authorization bounds", async () => {
  const device = fakeDevice();
  assert.deepEqual(await openCardScreen(device), authorized);
  assert.deepEqual(device.taps, ["UseCardLink", "b38-Skip"]);
  assert.deepEqual(cardBounds(authorized), [50, 200, 550, 600, 600, 1000]);
  for (const bounds of [undefined, "[0,0][0,0]", "[0,0][601,1000]", "[0,700][550,600]"])
    assert.throws(() => cardBounds([authorized[0], node("UniqueCodeParentContainer", "", bounds)]), { code: "LAYOUT_CHANGED" });
  assert.throws(() => cardBounds([authorized[0], { ...authorized[1], hidden: true }]), { code: "LAYOUT_CHANGED" });
});

test("Real macOS recognition confirms the timer and barcode; activation persists without renewing or crossing accounts", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cc-card-test-"));
  const db = openStore(":memory:");
  try {
    const file = path.join(directory, "screen.png");
    await execute("/usr/bin/swift", ["test/fixtures/card-image.swift", file, "09:47"]);
    const device = fakeDevice(async () => readFile(file));
    const before = Date.now();
    const card = await activateCard(db, "account-1", async (id) => { assert.equal(id, "account-1"); return device; });
    assert.equal(device.closed, true);
    assert.equal(isBusy(db), false);
    assert.ok(card.expiresAt >= before + 586000 && card.expiresAt <= Date.now() + 586000);
    assert.deepEqual({ ...await activateCard(db, "account-1", () => assert.fail("must reuse existing authorization")) }, card);
    const state = dashboardData(db);
    assert.equal(state.accounts[0].card.expiresAt, card.expiresAt);
    assert.equal(state.accounts[1].card, null);
    const png = db.prepare("SELECT image FROM card_sessions").get().image;
    assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    for (const timer of ["00:00", "10:01", "invalid"]) {
      await execute("/usr/bin/swift", ["test/fixtures/card-image.swift", file, timer]);
      const failed = fakeDevice(async () => readFile(file));
      await assert.rejects(activateCard(db, "account-2", async () => failed), { code: "CARD_UNCONFIRMED" });
      assert.equal(failed.closed, true);
      assert.equal(isBusy(db), false);
      assert.equal(dashboardData(db).accounts[1].card, null);
    }
    assert.equal(dashboardData(db).accounts[0].card.expiresAt, card.expiresAt);
    const release = acquireLock(db);
    await assert.rejects(activateCard(db, "account-2", () => assert.fail()), { code: "BUSY" });
    release();
    await assert.rejects(activateCard(db, "all", () => assert.fail()), { code: "INVALID_ACCOUNT" });
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Card API enforces account, origin, JSON, operation locks and image expiry", async () => {
  const db = openStore(":memory:");
  let finish, calls = 0, fail = false;
  const expiresAt = Date.now() + 600000;
  const server = createApp(db, async () => [], "", async (_db, id) => {
    calls++;
    if (fail) throw Error("sensitive internal details");
    await new Promise(resolve => { finish = resolve; });
    db.prepare("INSERT INTO card_sessions VALUES(?,?,?)").run(id, expiresAt, Buffer.from("image"));
    return { expiresAt };
  }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const headers = { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json" };
  const request = (pathname, { method = "GET", extra = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${server.address().port}${pathname}`, { method, headers: { ...headers, ...extra } }, res => {
      const chunks = []; res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject); req.end(body);
  });
  const activate = (id, options = {}) => request(`/api/cards/${id}/activate`, { method: "POST", body: "{}", ...options });
  try {
    for (const id of ["all", "account-4", "constructor"]) assert.equal((await activate(id)).status, 400);
    assert.equal((await activate("account-1", { extra: { Origin: "https://evil.test" } })).status, 403);
    assert.equal((await activate("account-1", { extra: { "Content-Type": "text/plain" } })).status, 415);
    const release = acquireLock(db);
    assert.equal((await activate("account-1")).status, 409);
    release();
    const pending = activate("account-1");
    while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(JSON.parse((await request("/api/state")).body).running, true);
    assert.equal((await activate("account-2")).status, 409);
    assert.equal((await request("/api/check", { method: "POST", body: "{}" })).status, 409);
    finish();
    assert.equal((await pending).status, 200);
    assert.equal(calls, 1);
    const image = await request(`/api/cards/account-1/image?expiresAt=${expiresAt}`);
    assert.equal(image.status, 200);
    assert.equal(image.headers["cache-control"], "no-store");
    assert.equal(image.headers["content-type"], "image/png");
    assert.equal((await request(`/api/cards/account-2/image?expiresAt=${expiresAt}`)).status, 404);
    assert.equal((await request(`/api/cards/account-1/image?expiresAt=${expiresAt - 1}`)).status, 404);
    db.prepare("UPDATE card_sessions SET expires_at=?").run(Date.now() - 1);
    assert.equal((await request(`/api/cards/account-1/image?expiresAt=${expiresAt}`)).status, 404);
    fail = true;
    const failure = await activate("account-2");
    assert.equal(failure.status, 502);
    assert.deepEqual(JSON.parse(failure.body), { error: "CARD_UNCONFIRMED" });
    assert.equal(JSON.parse((await request("/api/state")).body).running, false);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});
