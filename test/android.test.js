import test from "node:test";
import assert from "node:assert/strict";
import { androidTarget, collectAndroidCoupons, couponNavigationSwipe, couponTapRange, layoutNodes, parseAndroidCoupon, waitForAndroid } from "../src/android.js";
import { openStore, saveSnapshot, dashboardData } from "../src/storage.js";
import { CheckError } from "../src/extraction.js";

test("Every Android account has separate device storage and port; Account 3 retains its existing target", () => {
  const targets = [1, 2, 3].map((id) => androidTarget(`account-${id}`));
  for (const key of ["port", "serial", "avd", "profile"])
    assert.equal(new Set(targets.map((target) => target[key])).size, 3);
  assert.equal(targets[2].serial, "emulator-5556");
  assert.equal(targets[2].avd, "cc_coupons_account_3");
  assert.ok(targets.every((target, i) => target.profile.endsWith(`/android/account-${i + 1}.avd`)));
  for (const invalid of [undefined, "all", "account-4", "../account-3", "constructor", "__proto__"])
    assert.throws(() => androidTarget(invalid), { code: "INVALID_ACCOUNT" });
});

const node = (id, text, extra = {}) => ({ "resource-id": id, text, ...extra });
test("Readiness waits recover temporary reader failures without restarting Android", async () => {
  const rootError = Object.assign(new CheckError("ANDROID_UNAVAILABLE"), { cause: { stderr: "Could not obtain layout root\n" } });
  const screen = [node("b30-CouponsLink", "Cupões")];
  const reads = [new CheckError("TIMEOUT"), rootError, screen];
  const device = { async read() {
    const result = reads.shift();
    if (result instanceof Error) throw result;
    return result;
  } };
  assert.deepEqual(await waitForAndroid(device, ns => ns === screen), screen);
  assert.equal(reads.length, 0);
  await assert.rejects(waitForAndroid({ read: async () => { throw rootError; } }, () => false, { timeout: 50 }), { code: "ANDROID_UNAVAILABLE" });
  await assert.rejects(waitForAndroid({ read: async () => { throw new CheckError("ANDROID_DEVICE_MISMATCH"); } }, () => false), { code: "ANDROID_DEVICE_MISMATCH" });
  await assert.rejects(waitForAndroid({ read: async () => [node("login", "Iniciar sessão")] }, () => false), { code: "AUTH_REQUIRED" });
  await assert.rejects(waitForAndroid({ read: async () => [] }, () => false, { timeout: 50 }), { code: "LAYOUT_CHANGED" });
});

test("Observed connection-error dialogs retry in the app, with a fixed limit", async () => {
  const screen = [node("b30-CouponsLink", "Cupões")];
  const retry = node("android:id/button1", "Tentar Novamente");
  let dialog = [node("android:id/message", "Code:(CECE001) The connection has timed out"), retry];
  let taps = 0;
  const device = {
    read: async () => taps ? screen : [...dialog, ...screen],
    tap: async n => { assert.equal(n, retry); taps++; },
  };
  assert.deepEqual(await waitForAndroid(device, ns => ns.some(n => n.text === "Cupões")), screen);
  assert.equal(taps, 1);
  taps = 0;
  device.read = async () => dialog;
  await assert.rejects(waitForAndroid(device, () => false), { code: "NETWORK_ERROR" });
  assert.equal(taps, 2);
  taps = 0;
  dialog = [node("android:id/message", "Não estamos a conseguir estabelecer ligação, por favor, tente mais tarde. Code:(OEAE001)"), retry];
  device.read = async () => taps ? screen : dialog;
  assert.deepEqual(await waitForAndroid(device, ns => ns === screen), screen);
  assert.equal(taps, 1);
});

test("Coupon navigation rejects clipped links but permits the last item above fixed controls", () => {
  const range = couponTapRange([0, 252, 1082, 2402], 1981);
  const safe = (y) => y > range[0] && y < range[1];
  assert.equal(safe(281), false);
  assert.equal(safe(145), false);
  assert.equal(safe(391), true);
  assert.equal(safe(1780), true);
  assert.equal(safe(2045), false);
  for (const invalid of [undefined, NaN, 252, 2402])
    assert.throws(() => couponTapRange([0, 252, 1082, 2402], invalid), { code: "LAYOUT_CHANGED" });
});

const brands = ["Continente", "Galp", "Wells", "Pizza Hut", "Taco Bell", "KFC", "Pans & Company"];
function storeRow(offset = 0, scrollY = 0) {
  const geometry = (left, top, right, bottom) => {
    left = Math.max(44, left); right = Math.min(973, right); top = Math.max(252, top);
    return right <= left || bottom <= top ? { hidden: true, "off-screen": true }
      : { bounds: `[${left},${top}][${right},${bottom}]`, center: `[${Math.round((left + right) / 2)},${Math.round((top + bottom) / 2)}]` };
  };
  return [
    node("b1-Content", "", { bounds: "[0,252][1082,2402]" }),
    node("UseCardLink", "", { bounds: "[299,1981][782,2110]" }),
    node("InsigniaList", "", geometry(44, 262 - scrollY, 973, 504 - scrollY)),
    ...brands.map((brand, i) => node(`l1-1_${i}-SelectInsigniaLink2`, brand,
      geometry(44 + i * 231 - offset, 262 - scrollY, 228 + i * 231 - offset, 504 - scrollY))),
  ];
}

test("Store navigation reveals hidden and clipped tabs in both directions, after revealing the row", () => {
  const first = "l1-1_0-SelectInsigniaLink2", last = "l1-1_6-SelectInsigniaLink2";
  assert.equal(couponNavigationSwipe(storeRow(), first), null);
  const right = couponNavigationSwipe(storeRow(), last);
  assert.ok(right[0] > right[2] && right[1] === right[3]);
  assert.ok(right[0] < 973 && right[2] > 44 && right[1] > 359 && right[1] < 504);
  const left = couponNavigationSwipe(storeRow(641), first);
  assert.ok(left[0] < left[2] && left[1] === left[3]);
  assert.equal(couponNavigationSwipe(storeRow(641), last), null);
  // A partially clipped tab has coordinates but still needs a horizontal swipe.
  const clipped = "l1-1_4-SelectInsigniaLink2";
  assert.equal(storeRow().find((n) => n["resource-id"] === clipped).hidden, undefined);
  assert.ok(couponNavigationSwipe(storeRow(), clipped)[0] > couponNavigationSwipe(storeRow(), clipped)[2]);
  const vertical = couponNavigationSwipe(storeRow(0, 400), last);
  assert.ok(vertical[0] === vertical[2] && vertical[1] < vertical[3]);
  for (const invalid of [[], storeRow().filter((n) => n["resource-id"] !== "UseCardLink"), storeRow(5000)])
    assert.throws(() => couponNavigationSwipe(invalid, last), { code: "LAYOUT_CHANGED" });
  for (const [y, direction] of [[281, 1], [1780, 0], [2045, -1]]) {
    const swipe = couponNavigationSwipe([...storeRow(), node("l3-2_0-seeDetail", "", { center: `[500,${y}]` })], "l3-2_0-seeDetail");
    if (!direction) assert.equal(swipe, null);
    else assert.equal(Math.sign(swipe[3] - swipe[1]), direction);
  }
});

function detail(index, total, { code = "10000001", brand = "Continente", discount = "10 %", date = "de 26 de outubro a 8 de novembro de 2026", description = "NUMA COMPRA NO CONTINENTE" } = {}) {
  return [
    node("", "CouponDetail"),
    node(`splide9-slide${index}`, `${index} of ${total}`, { bounds: "[63,399][1021,1976]" }),
    node("l1-13_0-InsigniaImage", brand),
    node("l1-13_0-b8-Image", `Desconto ${discount} em Cartão na marca ${brand}`),
    node("l1-13_0-b9-ConditionsContainer", description),
    node("l1-13_0-b6-Date", date),
    node("l1-13_0-VoucherCode", `Código: ${code}`),
    node("b3-Back", "Voltar página anterior"),
  ];
}

test("Android details supply exact codes, future discounts and dates without inventing images or activation", () => {
  const coupon = parseAndroidCoupon(detail(2, 9, {
    code: "10000002", discount: "35 %", date: "de 9 a 19 de novembro de 2026",
    description: "EM REFRIGERANTES DA MARCA CONTINENTE",
  }), "Continente");
  assert.equal(coupon.discount, "35%");
  assert.equal(coupon.startDate, "2026-11-09");
  assert.equal(coupon.endDate, "2026-11-19");
  assert.equal(coupon.key, "Continente:10000002:2026-11-09");
  assert.equal(coupon.imageUrl, null);
  assert.equal(coupon.activated, null);
  assert.equal(coupon.used, null);
  assert.equal(parseAndroidCoupon(detail(1, 1, { brand: "Galp", discount: "0.1 €" }), "Galp").discount, "0,1 €");
  assert.equal(parseAndroidCoupon(detail(1, 1, { brand: "Pizza Hut", description: "5EUR NUMA COMPRA SUPERIOR A 20EUR NA PIZZA HUT." }), "Pizza Hut").minimumPurchase, "Superior a 20 €");
  for (const suffix of ["-VoucherCode", "-ConditionsContainer", "-Image", "-Date"])
    assert.throws(() => parseAndroidCoupon(detail(1, 1).filter((n) => !n["resource-id"].endsWith(suffix)), "Continente"), { code: "LAYOUT_CHANGED" });
  assert.throws(() => parseAndroidCoupon(detail(1, 1, { date: "de 32 a 34 de novembro de 2026" }), "Continente"), { code: "LAYOUT_CHANGED" });
  assert.throws(() => layoutNodes({ stale: true }), { code: "LAYOUT_CHANGED" });
  assert.equal(layoutNodes([{ content: [{ children: detail(1, 1) }] }]).length, 10);
});

function fakeDevice({ duplicate = false, wrongTotal = false, ignoredTap = false, partialDetail = false, reordered = false, ignoredBacks = 0, overflowStores = false } = {}) {
  const stores = overflowStores ? brands : ["Continente", "Galp"];
  const offers = [
    [{ code: "10000001" }, { code: duplicate ? "10000001" : "10000002", discount: "35 %", ...(duplicate ? {} : { date: "de 9 a 19 de novembro de 2026" }) }],
    [{ code: "20000001", brand: "Galp", discount: "0.1 €" }],
    ...(overflowStores ? brands.slice(2).map((brand, i) => [{ code: String(30000001 + i), brand }]) : []),
  ];
  let screen = "home", store = 0, index = 0, offset = 0, scrollY = 0;
  const taps = [], swipes = [];
  const read = () => screen === "home" ? [node("b30-CouponsLink", "Cupões")]
    : screen === "details" ? detail(reordered ? offers[store].length - index : index + 1, wrongTotal ? 99 : offers[store].length, offers[store][index])
      : [node("", "CouponsList"), ...(overflowStores ? storeRow(offset, scrollY) : stores.map((s, i) => node(`l1-1_${i}-SelectInsigniaLink2`, s))),
        node("", `Desconto 10 % em Cartão na marca ${stores[store]}`),
        ...offers[store].map((_, i) => node(`l3-2_${i}-seeDetail`, "Saiba mais"))];
  return {
    taps, swipes, read: async () => read(),
    async waitFor(predicate) {
      const ns = read();
      if (partialDetail && screen === "details") {
        assert.equal(predicate(ns.filter((n) => !n["resource-id"].endsWith("-Date"))), false);
        assert.equal(predicate(ns.map((n) => n["resource-id"].endsWith("-Back") ? { ...n, hidden: true, "off-screen": true } : n)), false);
      }
      if (!predicate(ns)) throw new CheckError("LAYOUT_CHANGED");
      return ns;
    },
    async tap(n, snapshot) {
      assert.ok(snapshot.includes(n), "Navigation must reuse the latest verified screen");
      assert.ok(n); const id = n["resource-id"]; taps.push(id);
      if (id.endsWith("-Back") && ignoredBacks-- > 0) return;
      if (id.endsWith("-CouponsLink") || id.endsWith("-Back")) {
        screen = "list";
        if (id.endsWith("-Back")) scrollY = 400;
      }
      else if (id.endsWith("-SelectInsigniaLink2")) {
        if (overflowStores) for (let attempt = 0; ; attempt++) {
          assert.ok(attempt < 20, "Store navigation must converge");
          const swipe = couponNavigationSwipe(read(), id);
          if (!swipe) break;
          swipes.push(swipe);
          offset = Math.max(0, Math.min(641, offset + swipe[0] - swipe[2]));
          scrollY = Math.max(0, scrollY + swipe[1] - swipe[3]);
        }
        store = stores.indexOf(n.text); screen = "list";
      }
      else if (id.endsWith("-seeDetail")) { index = ignoredTap ? 0 : Number(id.match(/_(\d+)-seeDetail$/)[1]); screen = "details"; }
      else assert.fail(`Unexpected action ${id}`);
    },
  };
}

test("Navigation handles a vanished target when the app has already changed screens, with bounded retries", async () => {
  const error = Object.assign(new CheckError("ANDROID_UNAVAILABLE"), { cause: { stderr: "No matching elements\n" } });
  const device = fakeDevice(), tap = device.tap;
  let stale = true;
  device.tap = async (...args) => {
    await tap(...args);
    if (stale) { stale = false; throw error; }
  };
  assert.equal((await collectAndroidCoupons(device)).length, 3);
  const stuck = fakeDevice();
  let attempts = 0;
  stuck.tap = async () => { attempts++; throw error; };
  await assert.rejects(collectAndroidCoupons(stuck), { code: "ANDROID_UNAVAILABLE" });
  assert.equal(attempts, 3);
});

test("Collection discovers all seven stores and queues new coupons after navigating off-screen tabs", async () => {
  const device = fakeDevice({ overflowStores: true });
  const coupons = await collectAndroidCoupons(device);
  assert.deepEqual([...new Set(coupons.map((c) => c.brand))], brands);
  assert.equal(coupons.length, 8);
  assert.ok(device.swipes.some(([x1, y1, x2, y2]) => x1 > x2 && y1 === y2));
  assert.ok(device.swipes.some(([x1, y1, x2, y2]) => x1 === x2 && y1 < y2));
  const db = openStore(":memory:");
  try {
    saveSnapshot(db, "account-3", coupons, new Date("2026-11-05T12:00:00Z"));
    assert.equal(db.prepare("SELECT count(*) n FROM events").get().n, 8);
    assert.equal(db.prepare("SELECT count(*) n FROM outbox").get().n, 8);
    assert.equal(saveSnapshot(db, "account-3", coupons).length, 0);
  } finally { db.close(); }
});

test("Android collection opens every store's list entries and validates details before saving atomically", async () => {
  const device = fakeDevice();
  const coupons = await collectAndroidCoupons(device);
  assert.equal(coupons.length, 3);
  assert.deepEqual(coupons.map((c) => c.brand), ["Continente", "Continente", "Galp"]);
  const db = openStore(":memory:");
  try {
    saveSnapshot(db, "account-3", coupons, new Date("2026-11-05T12:00:00Z"));
    assert.equal(saveSnapshot(db, "account-3", coupons).length, 0);
    const state = dashboardData(db, new Date("2026-11-05T12:00:00Z"));
    assert.equal(state.accounts.find((a) => a.id === "account-3").source, "android");
    assert.equal(state.accounts.find((a) => a.id === "account-3").auth, "ready");
    assert.deepEqual(state.coupons.map((c) => c.status), ["available", "upcoming", "available"]);
    assert.equal(db.prepare("SELECT count(*) n FROM events").get().n, 3);
    assert.equal(state.accounts.find((a) => a.id === "account-1").last_success, null);
  } finally { db.close(); }
  assert.ok(device.taps.every((id) => !/Check|UseCard|Archive|Like/.test(id)));
  await assert.rejects(collectAndroidCoupons(fakeDevice({ duplicate: true })), { code: "DUPLICATE_COUPONS" });
  await assert.rejects(collectAndroidCoupons(fakeDevice({ wrongTotal: true })), { code: "LAYOUT_CHANGED" });
  await assert.rejects(collectAndroidCoupons(fakeDevice({ ignoredTap: true })), { code: "DUPLICATE_COUPONS" });
  assert.equal((await collectAndroidCoupons(fakeDevice({ partialDetail: true }))).length, 3);
  assert.equal((await collectAndroidCoupons(fakeDevice({ reordered: true }))).length, 3);
  assert.equal((await collectAndroidCoupons(fakeDevice({ ignoredBacks: 2 }))).length, 3);
  await assert.rejects(collectAndroidCoupons(fakeDevice({ ignoredBacks: 3 })), { code: "LAYOUT_CHANGED" });
});
