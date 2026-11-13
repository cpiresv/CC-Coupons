import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { balanceBounds, parseBalance, readAndroidBalance } from "../src/balance.js";
import { openStore, saveBalance, dashboardData, recordFailure } from "../src/storage.js";

const execute = promisify(execFile);
const screen = [
  { text: "HomePage", bounds: "[0,0][600,1000]" },
  { "resource-id": "Right", bounds: "[350,150][560,300]" },
  { "resource-id": "BottomLeft", text: "Já ganhou 987,65 €" },
];

test("Balance parsing preserves cents and zero and rejects ambiguous or invalid amounts", () => {
  for (const [text, cents] of [["15,83 €", 1583], ["0,00 €", 0], ["1.234,56 €", 123456], ["1\u00a0234,56\u00a0€", 123456], ["1234,56 €", 123456]])
    assert.equal(parseBalance(text), cents);
  for (const invalid of [null, 0, "", "15.83 €", "15,8 €", "-15,83 €", "15,83", "Já ganhou 517,71 €", "15,83 € 20,00 €", "12.34,56 €", "9007199254740991,00 €"])
    assert.throws(() => parseBalance(invalid), { code: "BALANCE_UNCONFIRMED" });
  assert.deepEqual(balanceBounds(screen), [350, 150, 560, 300, 600, 1000]);
  const unnamedScreen = { class: "android.webkit.WebView", bounds: screen[0].bounds };
  assert.deepEqual(balanceBounds([unnamedScreen, { "resource-id": "TooltipBalance" }, ...screen.slice(1)]),
    [350, 150, 560, 300, 600, 1000]);
  assert.throws(() => balanceBounds([unnamedScreen, ...screen.slice(1)]), { code: "BALANCE_UNCONFIRMED" });
  for (const altered of [screen.slice(1), [...screen, screen[1]], [screen[0], { ...screen[1], hidden: true }], [screen[0], { ...screen[1], bounds: "[0,0][601,1000]" }]])
    assert.throws(() => balanceBounds(altered), { code: "BALANCE_UNCONFIRMED" });
});

test("Balances remain isolated and keep their amount and timestamp through failed reads and coupon checks", () => {
  const db = openStore(":memory:");
  try {
    const checkedAt = "2026-11-06T09:00:00.000Z";
    saveBalance(db, "account-1", { cents: 1583, checkedAt });
    saveBalance(db, "account-2", { cents: 0, checkedAt });
    saveBalance(db, "account-1", null);
    saveBalance(db, "account-3", null);
    recordFailure(db, "account-2", "LAYOUT_CHANGED");
    const balances = () => dashboardData(db).accounts.map(a => a.balance && { ...a.balance });
    assert.deepEqual(balances(), [
      { cents: 1583, checkedAt, error: 1 }, { cents: 0, checkedAt, error: 0 },
      { cents: null, checkedAt: null, error: 1 },
    ]);
    for (const invalid of [undefined, { cents: -1, checkedAt }, { cents: 1.1, checkedAt }, { cents: 100, checkedAt: "invalid" }, { cents: 100, checkedAt: 0 }])
      assert.throws(() => saveBalance(db, "account-1", invalid), /INVALID_BALANCE/);
    assert.equal(balances()[0].cents, 1583);
    saveBalance(db, "account-1", { cents: 0, checkedAt: "2026-11-07T09:00:00.000Z" });
    assert.equal(balances()[0].cents, 0);
    assert.equal(balances()[0].error, 0);
    assert.throws(() => saveBalance(db, "account-4", { cents: 100, checkedAt }));
  } finally { db.close(); }
});

test("Only confirmed changes from each account's saved balance create history and alerts", () => {
  const db = openStore(":memory:");
  const at = (day) => `2026-11-${day}T09:00:00.000Z`;
  const save = (accountId, cents, day) => saveBalance(db, accountId, { cents, checkedAt: at(day) });
  const history = () => dashboardData(db).balanceChanges.map(({ id, ...change }) => change);
  try {
    db.exec("UPDATE accounts SET name='Conta 1' WHERE id='account-1'; UPDATE accounts SET name='Conta 2' WHERE id='account-2'");
    db.prepare("INSERT INTO account_balances(account_id,cents,checked_at) VALUES(?,?,?)")
      .run("account-1", 0, at(10));
    saveBalance(db, "account-2", null);
    save("account-2", 900, 11);
    save("account-1", 0, 11);
    assert.deepEqual(history(), []);
    assert.deepEqual(dashboardData(db).notifications, []);
    assert.equal(dashboardData(db).accounts[0].balance.checkedAt, at(11));

    save("account-1", 555, 12);
    saveBalance(db, "account-1", null);
    save("account-2", 0, 13);
    save("account-1", 300, 13);
    save("account-1", 300, 13);
    save("account-1", 555, 12);

    assert.deepEqual(history(), [
      { accountId: "account-1", previousCents: 555, cents: 300, checkedAt: at(13) },
      { accountId: "account-2", previousCents: 900, cents: 0, checkedAt: at(13) },
      { accountId: "account-1", previousCents: 0, cents: 555, checkedAt: at(12) },
    ]);
    assert.equal(dashboardData(db).accounts[0].balance.cents, 300);
    const alerts = db.prepare("SELECT id,message FROM outbox WHERE state='pending' ORDER BY rowid").all();
    assert.deepEqual(alerts.map(alert => [alert.id, alert.message.replaceAll("\u00a0", " ")]), [
      ["balance:1", "Conta 1 · Saldo em cartão\nVariação: +5,55 €\nNovo saldo: 5,55 €"],
      ["balance:2", "Conta 2 · Saldo em cartão\nVariação: -9,00 €\nNovo saldo: 0,00 €"],
      ["balance:3", "Conta 1 · Saldo em cartão\nVariação: -2,55 €\nNovo saldo: 3,00 €"],
    ]);
  } finally { db.close(); }
});

test("macOS reads the spendable balance region without using lifetime savings or inventing zero", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cc-balance-test-"));
  try {
    const filename = path.join(directory, "screen.png");
    const device = {
      async waitFor(predicate) {
        assert.equal(predicate([...screen, screen[1]]), false);
        assert.equal(predicate(screen), true);
        return screen;
      },
      capture: () => readFile(filename),
    };
    for (const [amount, cents] of [["15,83 €", 1583], ["0,00 €", 0]]) {
      await execute("/usr/bin/swift", ["test/fixtures/balance-image.swift", filename, amount]);
      const before = Date.now();
      const balance = await readAndroidBalance(device);
      assert.equal(balance.cents, cents);
      assert.ok(Date.parse(balance.checkedAt) >= before && Date.parse(balance.checkedAt) <= Date.now());
    }
    const zero = await readFile(filename);
    await execute("/usr/bin/swift", ["test/fixtures/balance-image.swift", filename, "••,•• €"]);
    await assert.rejects(execute("/usr/bin/swift", ["src/read-balance.swift", filename, ...balanceBounds(screen).map(String)]));
    const loading = await readFile(filename);
    let captures = 0, readinessChecks = 0;
    const waitFor = device.waitFor;
    device.waitFor = (...args) => { readinessChecks++; return waitFor(...args); };
    device.capture = async () => {
      if (++captures === 1) throw Error("Android screenshot unavailable");
      return captures === 2 ? loading : zero;
    };
    assert.equal((await readAndroidBalance(device)).cents, 0);
    assert.equal(captures, 3);
    assert.equal(readinessChecks, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
