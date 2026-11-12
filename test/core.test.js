import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseDateRange,
  expiresAt,
  expiring,
  couponStatus,
  localDay,
} from "../src/dates.js";
import {
  normalizeCoupon,
  extractCoupons,
  requireCouponPage,
} from "../src/extraction.js";
import {
  openStore,
  saveSnapshot,
  recordFailure,
  dashboardData,
  enqueue,
} from "../src/storage.js";
import { acquireLock } from "../src/lock.js";
import { flushNotifications } from "../src/notifications.js";
import { due, plist } from "../src/schedule.js";
import { createApp } from "../src/server.js";
import { port } from "../src/config.js";
import { chromium } from "playwright";

const now = new Date("2026-11-04T12:00:00Z");
const row = {
  date: "de 26 de Outubro a 8 de Novembro de 2026",
  description: "NUMA COMPRA SUPERIOR A 20€ NO CONTINENTE",
  code: "Código: 10000001",
  image:
    "https://appcartao.cdn.mc.pt/2d946dd7-a605-461b-a3c4-89e61972bd10_continente_5E.png",
};
const coupon = (extra = {}) => ({
  ...normalizeCoupon(row, "Continente"),
  ...extra,
});
const withDb = (fn) => {
  const db = openStore(":memory:");
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

test("Portuguese dates cover single month, two months and cross-year ranges", () => {
  assert.deepEqual(parseDateRange("de 9 a 19 de Novembro de 2026"), {
    startDate: "2026-11-09",
    endDate: "2026-11-19",
  });
  assert.deepEqual(parseDateRange(row.date), {
    startDate: "2026-10-26",
    endDate: "2026-11-08",
  });
  assert.deepEqual(parseDateRange("de 29 de Dezembro a 3 de Janeiro de 2027"), {
    startDate: "2026-12-29",
    endDate: "2027-01-03",
  });
  assert.throws(() => parseDateRange("de 31 a 32 de Novembro de 2026"));
  assert.throws(() => parseDateRange("de 9 a 8 de Novembro de 2026"));
});
test("Lisbon expiry includes the final day and respects summer/winter DST", () => {
  assert.equal(
    new Date(expiresAt("2026-07-01")).toISOString(),
    "2026-07-01T23:00:00.000Z",
  );
  assert.equal(
    new Date(expiresAt("2026-11-01")).toISOString(),
    "2026-11-02T00:00:00.000Z",
  );
  assert.equal(
    new Date(expiresAt("2026-03-29")).toISOString(),
    "2026-03-29T23:00:00.000Z",
  );
  assert.equal(
    new Date(expiresAt("2026-10-25")).toISOString(),
    "2026-10-26T00:00:00.000Z",
  );
  assert.equal(localDay(new Date("2026-07-01T23:30:00Z")), "2026-07-02");
});
test("48-hour expiry threshold and future eligibility are separate", () => {
  const c = coupon({ endDate: "2026-11-06" });
  assert.equal(expiring(c, new Date("2026-11-05T00:00:00Z")), true);
  assert.equal(expiring(c, new Date("2026-11-04T23:59:59Z")), false);
  assert.equal(expiring(c, new Date("2026-11-07T00:00:00Z")), false);
  assert.equal(
    couponStatus(coupon({ startDate: "2026-11-09" }), true, now),
    "upcoming",
  );
});
test("Observed image values and conditions are extracted without inventing activation state", () => {
  const c = coupon();
  assert.equal(c.discount, "5 €");
  assert.equal(c.minimumPurchase, "Superior a 20 €");
  assert.equal(c.activationRequired, null);
  assert.equal(c.used, null);
  assert.equal(
    normalizeCoupon(
      { ...row, description: "NUM ABASTECIMENTO SUPERIOR A 20L EM EVOLOGIC" },
      "Galp",
    ).minimumPurchase,
    "Superior a 20 L",
  );
  assert.equal(
    normalizeCoupon(
      { ...row, image: "https://appcartao.cdn.mc.pt/unknown_99.png" },
      "Continente",
    ).discount,
    null,
  );
  assert.throws(() =>
    normalizeCoupon(
      { ...row, image: "https://attacker.test/image.png" },
      "Continente",
    ),
  );
  assert.throws(() => normalizeCoupon({ ...row, code: "" }, "Continente"));
});
test("Accounts are isolated and repeated checks do not duplicate events or notifications", () =>
  withDb((db) => {
    saveSnapshot(db, "account-1", [coupon()], now);
    saveSnapshot(db, "account-2", [coupon()], now);
    assert.equal(saveSnapshot(db, "account-1", [coupon()], now).length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM coupons").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM events").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM outbox").get().n, 2);
  }));
test("Meaningful changes, removals and returns retain old snapshots", () =>
  withDb((db) => {
    const second = coupon({
      key: "Continente:10000002:2026-10-26",
      code: "10000002",
    });
    saveSnapshot(db, "account-1", [coupon(), second], now);
    const changes = saveSnapshot(
      db,
      "account-1",
      [coupon({ discount: "10 €" })],
      now,
    );
    assert.deepEqual(
      changes.map((c) => c.kind),
      ["changed", "removed"],
    );
    assert.equal(
      dashboardData(db, now).coupons.find((c) => c.code === "10000002").status,
      "removed",
    );
    assert.equal(
      JSON.parse(
        db.prepare("SELECT previous FROM events WHERE kind='changed'").get()
          .previous,
      ).discount,
      "5 €",
    );
    assert.equal(
      saveSnapshot(
        db,
        "account-1",
        [coupon({ discount: "10 €" }), second],
        now,
      )[0].kind,
      "returned",
    );
  }));
test("Known image URL churn is not a significant change; unknown image changes are", () =>
  withDb((db) => {
    saveSnapshot(db, "account-1", [coupon()], now);
    assert.equal(
      saveSnapshot(
        db,
        "account-1",
        [coupon({ imageUrl: row.image + "?version=2" })],
        now,
      ).length,
      0,
    );
    saveSnapshot(db, "account-1", [coupon({ discount: null })], now);
    assert.equal(
      saveSnapshot(
        db,
        "account-1",
        [coupon({ discount: null, imageUrl: row.image + "?version=3" })],
        now,
      )[0].kind,
      "changed",
    );
  }));
test("Empty, duplicate and failed extractions preserve the last confirmed data", () =>
  withDb((db) => {
    saveSnapshot(db, "account-1", [coupon()], now);
    assert.throws(() => saveSnapshot(db, "account-1", [], now));
    assert.throws(() =>
      saveSnapshot(db, "account-1", [coupon(), coupon()], now),
    );
    assert.throws(() =>
      saveSnapshot(
        db,
        "account-1",
        [coupon({ discount: "10 €" }), { key: "invalid" }],
        now,
      ),
    );
    recordFailure(db, "account-1", "LAYOUT_CHANGED", now);
    const state = dashboardData(db, now);
    assert.equal(state.coupons.length, 1);
    assert.equal(state.coupons[0].discount, "5 €");
    assert.equal(state.accounts[0].last_success, now.toISOString());
    assert.equal(state.accounts[0].error, "LAYOUT_CHANGED");
  }));
test("Expiry alerts are sent once for a coupon end date", () =>
  withDb((db) => {
    const c = coupon({ endDate: "2026-11-05" });
    saveSnapshot(db, "account-1", [c], now);
    saveSnapshot(db, "account-1", [c], now);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM outbox WHERE id LIKE 'expiry:%'").get()
        .n,
      1,
    );
  }));
test("Repeated errors and reauthentication alerts deduplicate by failure episode", () =>
  withDb((db) => {
    for (let i = 0; i < 4; i++) recordFailure(db, "account-1", "TIMEOUT", now);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM outbox").get().n, 1);
    recordFailure(db, "account-1", "AUTH_REQUIRED", now);
    recordFailure(db, "account-1", "AUTH_REQUIRED", now);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM outbox").get().n, 2);
    saveSnapshot(db, "account-1", [coupon()], now);
    recordFailure(db, "account-1", "AUTH_REQUIRED", now);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM outbox WHERE id LIKE 'auth:%'").get()
        .n,
      2,
    );
  }));
test("SQLite lock excludes other connections and recovers a dead owner", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-lock-"));
  const file = path.join(dir, "db.sqlite");
  const a = openStore(file),
    b = openStore(file);
  try {
    const release = acquireLock(a);
    assert.throws(() => acquireLock(b), { code: "BUSY" });
    release();
    a.prepare("INSERT INTO operation_lock VALUES(1,2147483647,'dead')").run();
    const release2 = acquireLock(b);
    release2();
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true });
  }
});
test("Telegram confirms sends before marking delivered and never repeats confirmed messages", async () => {
  const db = openStore(":memory:");
  try {
    enqueue(db, "one", "Test");
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return { ok: true, json: async () => ({ ok: true }) };
    };
    await flushNotifications(db, { token: "test", chatId: "1", fetchImpl });
    await flushNotifications(db, { token: "test", chatId: "1", fetchImpl });
    assert.equal(calls, 1);
    assert.equal(db.prepare("SELECT state FROM outbox").get().state, "sent");
  } finally {
    db.close();
  }
});
test("Ambiguous Telegram delivery is retained for review without blind retries", async () => {
  const db = openStore(":memory:");
  try {
    enqueue(db, "one", "Test");
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      throw Error("timeout");
    };
    await flushNotifications(db, { token: "test", chatId: "1", fetchImpl });
    await flushNotifications(db, { token: "test", chatId: "1", fetchImpl });
    assert.equal(calls, 1);
    assert.equal(
      db.prepare("SELECT state FROM outbox").get().state,
      "uncertain",
    );
  } finally {
    db.close();
  }
});
test("Missing Telegram configuration leaves queued messages unsent", async () => {
  const db = openStore(":memory:");
  try {
    enqueue(db, "one", "Test");
    assert.deepEqual(await flushNotifications(db, { token: "", chatId: "" }), {
      configured: false,
      sent: 0,
    });
    assert.equal(db.prepare("SELECT state FROM outbox").get().state, "pending");
  } finally {
    db.close();
  }
});
test("Scheduler uses Lisbon wall time including DST and generates a valid launchd shape", () => {
  assert.equal(due(new Date("2026-07-01T08:00:00Z"), "09:00"), true);
  assert.equal(due(new Date("2026-11-01T08:59:00Z"), "09:00"), false);
  assert.throws(() => due(now, "25:00"));
  assert.throws(() => plist("09:60"), /DAILY_CHECK_TIME/);
  const definition = plist("17:05");
  assert.match(definition, /<key>StartCalendarInterval<\/key><dict><key>Hour<\/key><integer>17<\/integer><key>Minute<\/key><integer>5<\/integer><\/dict>/);
  assert.match(definition, /<key>RunAtLoad<\/key><true\/>/);
  assert.doesNotMatch(definition, /<key>StartInterval<\/key>/);
});
test("LAN and Tailscale API accepts this Mac's addresses and rejects foreign hosts, origins, invalid accounts and concurrent checks", async (t) => {
  t.mock.method(os, "networkInterfaces", () => ({
    en0: [
      "192.168.1.10", "10.1.2.3", "172.16.0.2", "172.31.0.2",
      "172.15.0.2", "172.32.0.2", "100.100.10.10", "203.0.113.5",
      "100.64.0.1", "100.127.255.254", "100.63.255.254", "100.128.0.1",
    ].map((address) => ({ family: "IPv4", address })),
    lo0: [{ family: "IPv6", address: "::1" }],
  }));
  const db = openStore(":memory:");
  let resolve;
  const privateHost = "coupon-mac.tail1234.ts.net";
  const server = createApp(db, () => new Promise((r) => (resolve = r)), privateHost).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const rawFetch = (url, options = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(url, options, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode }));
      });
      req.on("error", reject);
      req.end(options.body);
    });
  const headers = {
    Host: `100.100.10.10:${port}`,
    Origin: `http://100.100.10.10:${port}`,
    "Content-Type": "application/json",
  };
  try {
    for (const host of [
      "127.0.0.1", "localhost", "192.168.1.10",
      "10.1.2.3", "172.16.0.2", "172.31.0.2",
      "100.100.10.10", "100.64.0.1", "100.127.255.254",
    ]) {
      assert.equal(
        (await rawFetch(url + "/api/state", {
          headers: { Host: `${host}:${port}` },
        })).status,
        200,
        host,
      );
    }
    for (const host of [
      "192.168.1.11", "172.15.0.2", "172.32.0.2",
      "100.100.10.11", "203.0.113.5", "100.63.255.254", "100.128.0.1",
    ]) {
      assert.equal(
        (await rawFetch(url + "/api/state", {
          headers: { Host: `${host}:${port}` },
        })).status,
        403,
        host,
      );
    }
    assert.equal(
      (await rawFetch(url + "/api/state", { headers: { Host: "evil.test" } }))
        .status,
      403,
    );
    assert.equal(
      (
        await rawFetch(url + "/api/state", {
          headers: { ...headers, Origin: "https://evil.test" },
        })
      ).status,
      403,
    );
    assert.equal((await rawFetch(url + "/api/state", { headers })).status, 200);
    assert.equal((await rawFetch(url + "/api/state", {
      headers: { Host: privateHost, Origin: `https://${privateHost}` },
    })).status, 200);
    for (const origin of [`http://${privateHost}`, "https://evil.test", "null"]) {
      assert.equal((await rawFetch(url + "/api/state", {
        headers: { Host: privateHost, Origin: origin, "X-Forwarded-Proto": "https" },
      })).status, 403);
    }
    assert.equal((await rawFetch(url + "/api/state", {
      headers: { Host: "other-mac.tail1234.ts.net", Origin: `https://${privateHost}` },
    })).status, 403);
    assert.equal((await rawFetch(url + "/api/state", {
      headers: { Host: privateHost, Origin: `https://${privateHost}`, "Sec-Fetch-Site": "cross-site" },
    })).status, 403);
    assert.equal(
      (await rawFetch(url + "/api/state", {
        headers: { ...headers, "Sec-Fetch-Site": "cross-site" },
      })).status,
      403,
    );
    assert.equal(
      (
        await rawFetch(url + "/api/check", {
          method: "POST",
          headers,
          body: JSON.stringify({ accountId: "../private" }),
        })
      ).status,
      400,
    );
    const first = rawFetch(url + "/api/check", {
      method: "POST",
      headers,
      body: "{}",
    });
    while (!resolve) await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      (
        await rawFetch(url + "/api/check", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      409,
    );
    resolve([]);
    assert.equal((await first).status, 200);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
test("Real browser extracts observed coupon markup and rejects an unverified empty state", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const heading =
      '<div class="TituloDadosConta">Os meus cupões</div><div><div class="circle-active"></div><div class="insignia-name">Continente</div></div>';
    await page.setContent(
      `${heading}<div id="test_wtCouponsContainer"><div class="new-coupon"><div class="coupon-date-info">${row.date}</div><div class="coupon-descr">${row.description}</div><div class="coupon-code">${row.code}</div><img class="cupoes-insignias-image" src="${row.image}"></div></div>`,
    );
    assert.equal((await extractCoupons(page))[0].code, "10000001");
    await page.setContent(
      `<div class="MyAccount"><button class="Menu_TopMenu" onclick="document.getElementById('homepage-coupons').hidden=false">A minha conta</button><a id="homepage-coupons" hidden href="#" onclick="document.getElementById('homepage-result').hidden=false;return false">Cupões</a></div><div id="homepage-result" hidden>${heading}</div>`,
    );
    await requireCouponPage(page);
    assert.equal(await page.locator(".TituloDadosConta").isVisible(), true);
    await page.setContent(
      `${heading}<div id="test_wtCouponsContainer">Aceda à App Cartão Continente</div>`,
    );
    await assert.rejects(extractCoupons(page), {
      code: "UNVERIFIED_EMPTY_STATE",
    });
  } finally {
    await browser.close();
  }
});

test("Observed browser verification stops checking and removes its listener", async () => {
  const { EventEmitter } = await import("node:events");
  const { withVerificationCheck } = await import("../src/extraction.js");
  const page = new EventEmitter();
  await assert.rejects(
    withVerificationCheck(page, async () => {
      queueMicrotask(() =>
        page.emit("pageerror", new Error("winsocks is not defined")),
      );
      await new Promise(() => {});
    }),
    { code: "MANUAL_VERIFICATION" },
  );
  assert.equal(page.listenerCount("pageerror"), 0);
  assert.equal(page.listenerCount("response"), 0);
});

test("Blank HTTP 247 verification responses stop extraction in a real browser", async () => {
  const { withVerificationCheck } = await import("../src/extraction.js");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://cartaocontinente.pt/**", (route) =>
      route.fulfill({
        status: 247,
        contentType: "text/html",
        body: "<html><body></body></html>",
      }),
    );
    await assert.rejects(
      withVerificationCheck(page, () =>
        page.goto("https://cartaocontinente.pt/AMinhaConta.aspx"),
      ),
      { code: "MANUAL_VERIFICATION" },
    );
    assert.equal(page.listenerCount("response"), 0);
  } finally {
    await browser.close();
  }
});

test("A verification error that already occurred prevents further coupon requests", async () => {
  const { EventEmitter } = await import("node:events");
  const { withVerificationCheck } = await import("../src/extraction.js");
  const page = new EventEmitter();
  page.pageErrors = async () => [new Error("winsocks is not defined")];
  let called = false;
  await assert.rejects(
    withVerificationCheck(page, () => {
      called = true;
    }),
    { code: "MANUAL_VERIFICATION" },
  );
  assert.equal(called, false);
});

test("Browser verification alerts explain the block without requesting another SMS login", () =>
  withDb((db) => {
    recordFailure(db, "account-2", "MANUAL_VERIFICATION", now);
    const message = db.prepare("SELECT message FROM outbox").get().message;
    assert.match(message, /Verificação do navegador necessária/);
    assert.doesNotMatch(message, /conclua o início de sessão/);
  }));

test("Telegram setup requires exactly one private human chat", async () => {
  const { findPrivateChat } = await import("../src/telegram-setup.js");
  const message = (id, type = "private") => ({
    message: { from: { id, is_bot: false }, chat: { id, type } },
  });
  assert.equal(findPrivateChat([message(123), message(123)]), "123");
  assert.equal(findPrivateChat([]), null);
  assert.equal(findPrivateChat([message(123), message(456)]), null);
  assert.equal(findPrivateChat([message(123, "group")]), null);
});

test("Expiry reminders survive a failed refresh and identify stale availability", async () => {
  const { queueSavedExpiryReminders } = await import("../src/storage.js");
  withDb((db) => {
    saveSnapshot(db, "account-1", [coupon({ endDate: "2026-11-08" })], now);
    recordFailure(db, "account-1", "SITE_UNAVAILABLE", now);
    const later = new Date("2026-11-07T12:00:00Z");
    queueSavedExpiryReminders(db, later);
    queueSavedExpiryReminders(db, later);
    const reminders = db
      .prepare("SELECT message FROM outbox WHERE id LIKE 'expiry:%'")
      .all();
    assert.equal(reminders.length, 1);
    assert.match(reminders[0].message, /Último registo confirmado/);
  });
});
