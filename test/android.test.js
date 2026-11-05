import test from "node:test";
import assert from "node:assert/strict";
import { androidTarget, collectAndroidCoupons, couponTapRange, layoutNodes, parseAndroidCoupon } from "../src/android.js";
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

function fakeDevice({ duplicate = false, wrongTotal = false, ignoredTap = false, partialDetail = false, reordered = false, ignoredBacks = 0 } = {}) {
  const stores = ["Continente", "Galp"];
  const offers = [
    [{ code: "10000001" }, { code: duplicate ? "10000001" : "10000002", discount: "35 %", ...(duplicate ? {} : { date: "de 9 a 19 de novembro de 2026" }) }],
    [{ code: "20000001", brand: "Galp", discount: "0.1 €" }],
  ];
  let screen = "home", store = 0, index = 0;
  const taps = [];
  const read = () => screen === "home" ? [node("b30-CouponsLink", "Cupões")]
    : screen === "details" ? detail(reordered ? offers[store].length - index : index + 1, wrongTotal ? 99 : offers[store].length, offers[store][index])
      : [node("", "CouponsList"), ...stores.map((s, i) => node(`l1-1_${i}-SelectInsigniaLink2`, s)),
        node("", `Desconto 10 % em Cartão na marca ${stores[store]}`),
        ...offers[store].map((_, i) => node(`l3-2_${i}-seeDetail`, "Saiba mais"))];
  return {
    taps, read: async () => read(),
    async waitFor(predicate) {
      const ns = read();
      if (partialDetail && screen === "details")
        assert.equal(predicate(ns.filter((n) => !n["resource-id"].endsWith("-Date"))), false);
      if (!predicate(ns)) throw new CheckError("LAYOUT_CHANGED");
      return ns;
    },
    async tap(n) {
      assert.ok(n); const id = n["resource-id"]; taps.push(id);
      if (id.endsWith("-Back") && ignoredBacks-- > 0) return;
      if (id.endsWith("-CouponsLink") || id.endsWith("-Back")) screen = "list";
      else if (id.endsWith("-SelectInsigniaLink2")) { store = stores.indexOf(n.text); screen = "list"; }
      else if (id.endsWith("-seeDetail")) { index = ignoredTap ? 0 : Number(id.match(/_(\d+)-seeDetail$/)[1]); screen = "details"; }
      else assert.fail(`Unexpected action ${id}`);
    },
  };
}

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
