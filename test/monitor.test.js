import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const directory = mkdtempSync(path.join(os.tmpdir(), "cc-monitor-"));
process.env.DATA_DIR = directory;
after(() => rmSync(directory, { recursive: true, force: true }));

let checkAndroid;
let flushNotifications;
mock.module("../src/android.js", {
  namedExports: { checkAndroid: (...args) => checkAndroid(...args) },
});
mock.module("../src/notifications.js", {
  namedExports: { flushNotifications: (...args) => flushNotifications(...args) },
});
const { runChecks } = await import("../src/monitor.js");
const { runScheduledChecks } = await import("../src/schedule.js");
const { openStore, saveSnapshot, saveBalance, dashboardData } = await import("../src/storage.js");
const { acquireLock, isBusy } = await import("../src/lock.js");
const { CheckError, normalizeCoupon } = await import("../src/extraction.js");
const ids = ["account-1", "account-2", "account-3"];
const coupon = normalizeCoupon({
  date: "de 26 de Outubro a 8 de Novembro de 2026",
  description: "NUMA COMPRA SUPERIOR A 20€ NO CONTINENTE",
  code: "Código: 10000001",
  image: "https://appcartao.cdn.mc.pt/continente_5E.png",
}, "Continente");

async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail("Timed out waiting for check progress");
}

test("accounts run one at a time, retain failed data, and notify once after cleanup", async () => {
  const db = openStore(":memory:");
  saveSnapshot(db, "account-2", [coupon]);
  const gates = new Map(ids.map(id => [id, Promise.withResolvers()]));
  const started = [];
  const active = new Set();
  const progress = new Map(ids.map(id => [id, []]));
  let flushes = 0;
  checkAndroid = async (id, _onBalance, onProgress) => {
    assert.equal(active.size, 0);
    started.push(id);
    active.add(id);
    onProgress({ stage: "coupons", brand: "Continente", read: 0, total: 1 });
    try {
      return await gates.get(id).promise;
    } finally {
      active.delete(id);
    }
  };
  flushNotifications = async () => {
    assert.equal(active.size, 0);
    assert.equal(isBusy(db), true);
    flushes++;
  };
  const run = runChecks(db, "all", {
    scheduledDay: "2026-11-05",
    onProgress: (id, step) => progress.get(id).push(step),
  });
  try {
    await until(() => started.length === 1);
    assert.deepEqual(started, ["account-1"]);
    await assert.rejects(runChecks(db), { code: "BUSY" });
    gates.get("account-1").resolve([coupon]);
    await until(() => started.length === 2);
    assert.deepEqual(started, ["account-1", "account-2"]);
    assert.equal(isBusy(db), true);
    assert.equal(flushes, 0);
    gates.get("account-2").reject(new CheckError("AUTH_REQUIRED"));
    await until(() => started.length === 3);
    assert.deepEqual(started, ids);
    gates.get("account-3").resolve([coupon]);
    const results = await run;
    assert.deepEqual(results, [
      { accountId: "account-1", ok: true, count: 1, changes: 1 },
      { accountId: "account-2", ok: false, code: "AUTH_REQUIRED" },
      { accountId: "account-3", ok: true, count: 1, changes: 1 },
    ]);
    assert.deepEqual(progress.get("account-3"), [
      { stage: "opening" }, { stage: "coupons", brand: "Continente", read: 0, total: 1 },
      { stage: "saving" }, { stage: "done", count: 1 },
    ]);
    assert.deepEqual(progress.get("account-2").at(-1), { stage: "failed" });
    assert.equal(db.prepare("SELECT present FROM coupons WHERE account_id='account-2'").get().present, 1);
    assert.equal(flushes, 1);
    assert.equal(isBusy(db), false);
    assert.deepEqual(await runChecks(db, "all", { scheduledDay: "2026-11-05" }), []);
    assert.equal(started.length, 3);
    assert.equal(flushes, 1);
    assert.equal(isBusy(db), false);
  } finally {
    for (const gate of gates.values()) gate.resolve([coupon]);
    await run.catch(() => {});
    db.close();
  }
});

test("unexpected worker failure keeps the lock until the other accounts finish", async () => {
  const db = openStore(":memory:");
  const failed = Promise.withResolvers();
  db.function("failure_seen", () => { failed.resolve(); return 1; });
  db.exec(`CREATE TRIGGER fail_account_1 BEFORE UPDATE ON accounts
    WHEN NEW.id='account-1' BEGIN
      SELECT failure_seen();
      SELECT RAISE(ABORT, 'simulated storage failure');
    END`);
  const gates = new Map(ids.map(id => [id, Promise.withResolvers()]));
  const started = [];
  checkAndroid = id => {
    started.push(id);
    return gates.get(id).promise;
  };
  let flushes = 0;
  flushNotifications = async () => { flushes++; };
  const run = runChecks(db);
  const rejected = assert.rejects(run, /simulated storage failure/);
  try {
    await until(() => started.length === 1);
    gates.get("account-1").reject(new CheckError("LAYOUT_CHANGED"));
    await failed.promise;
    await until(() => started.length === 2);
    assert.equal(isBusy(db), true);
    await assert.rejects(runChecks(db), { code: "BUSY" });
    gates.get("account-2").resolve([coupon]);
    await until(() => started.length === 3);
    gates.get("account-3").resolve([coupon]);
    await rejected;
    assert.equal(db.prepare("SELECT count(*) AS n FROM accounts WHERE auth='ready'").get().n, 2);
    assert.equal(flushes, 0);
    assert.equal(isBusy(db), false);
  } finally {
    for (const gate of gates.values()) gate.resolve([coupon]);
    await run.catch(() => {});
    db.close();
  }
});

test("a selected account does not start the other devices", async () => {
  const db = openStore(":memory:");
  const started = [];
  checkAndroid = async id => { started.push(id); return [coupon]; };
  flushNotifications = async () => {};
  try {
    const results = await runChecks(db, "account-2");
    assert.deepEqual(started, ["account-2"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    assert.equal(isBusy(db), false);
  } finally {
    db.close();
  }
});

test("a temporary Android control failure retries without manual login", async (t) => {
  const db = openStore(":memory:");
  const firstAttempt = Promise.withResolvers();
  let attempts = 0;
  checkAndroid = async () => {
    if (++attempts === 1) {
      firstAttempt.resolve();
      throw new CheckError("ANDROID_UNAVAILABLE");
    }
    return [coupon];
  };
  flushNotifications = async () => {};
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = runChecks(db, "account-2");
  try {
    await firstAttempt.promise;
    await new Promise(setImmediate);
    t.mock.timers.tick(5000);
    const results = await run;
    assert.equal(attempts, 2);
    assert.equal(results[0].ok, true);
    assert.equal(db.prepare("SELECT failures FROM accounts WHERE id='account-2'").get().failures, 0);
    assert.equal(isBusy(db), false);
  } finally {
    t.mock.timers.reset();
    db.close();
  }
});

test("the scheduled check retries a busy lock and still runs only once per day", async (t) => {
  const db = openStore(":memory:");
  const release = acquireLock(db);
  const started = [];
  checkAndroid = async id => { started.push(id); return [coupon]; };
  flushNotifications = async () => {};
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = runScheduledChecks(db);
  run.catch(() => {});
  try {
    await new Promise(setImmediate);
    release();
    t.mock.timers.tick(59_999);
    assert.deepEqual(started, []);
    t.mock.timers.tick(1);
    assert.equal((await run).length, 3);
    assert.deepEqual(started, ids);
    assert.deepEqual(await runScheduledChecks(db), []);
  } finally {
    release();
    t.mock.timers.reset();
    db.close();
  }
});

test("Daily checks save balances independently from coupon success, and manual checks refresh them too", async () => {
  const db = openStore(":memory:");
  const checkedAt = new Date().toISOString();
  saveBalance(db, "account-2", { cents: 1234, checkedAt: "2026-11-05T09:00:00.000Z" });
  checkAndroid = async (id, onBalance) => {
    onBalance(id === "account-2" ? null : { cents: id === "account-1" ? 0 : 9876, checkedAt });
    if (id === "account-3") throw new CheckError("LAYOUT_CHANGED");
    return [coupon];
  };
  flushNotifications = async () => {};
  try {
    const results = await runChecks(db, "all", { scheduledDay: "2026-11-06" });
    assert.deepEqual(results.map(result => result.ok), [true, true, false]);
    const balances = dashboardData(db).accounts.map(a => ({ ...a.balance }));
    assert.deepEqual(balances, [
      { cents: 0, checkedAt, error: 0 },
      { cents: 1234, checkedAt: "2026-11-05T09:00:00.000Z", error: 1 },
      { cents: 9876, checkedAt, error: 0 },
    ]);
    checkAndroid = async (_id, onBalance) => { onBalance({ cents: 5678, checkedAt }); return [coupon]; };
    await runChecks(db, "account-2");
    assert.equal(dashboardData(db).accounts[1].balance.cents, 5678);
    assert.equal(dashboardData(db).accounts[1].balance.error, 0);
  } finally { db.close(); }
});
