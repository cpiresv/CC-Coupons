import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";

test("Store selection keeps coupons, comparison, history and account filters aligned on mobile", async () => {
  const server = await createServer({
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "silent",
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Synthetic offers keep this UI test independent of accounts and the live portal.
    const offer = (brand, accountId, key, extra = {}) => ({
      brand, accountId, key, code: key, title: `${brand} oferta de teste`,
      description: `${brand} condições de teste`, discount: "5 €",
      startDate: "2026-11-01", endDate: "2026-11-30",
      imageUrl: "/stores/continente.png", firstSeen: "2026-11-04T12:00:00Z",
      present: true, status: "available", isNew: true, expiring: false,
      ...extra,
    });
    let state = {
      accounts: [1, 2, 3].map((id) => ({
        id: `account-${id}`, name: `Conta ${id}`, auth: "ready",
        source: "android",
        last_success: "2026-11-04T12:00:00Z", error: null,
      })),
      coupons: [
        offer("Continente", "account-1", "c1"),
        offer("Continente", "account-2", "c2", { status: "upcoming", isNew: false }),
        offer("Galp", "account-3", "g1", { expiring: true, imageUrl: null }),
        offer("Wells", "account-1", "w1", { status: "expired" }),
        offer("Pizza Hut", "account-1", "p1", { status: "upcoming", isNew: false }),
        offer("Taco Bell", "account-2", "t1"),
        offer("KFC", "account-3", "k1"),
        offer("Pans & Company", "account-1", "pc1"),
      ],
      notifications: [], running: false, telegramConfigured: false, dailyTime: "09:00",
    };
    state.events = state.coupons.map((coupon, id) => ({
      id, account_id: coupon.accountId, kind: "new", at: "2026-11-04T12:00:00Z",
      payload: coupon, previous: null,
    }));
    await page.route("**/api/state", (route) => route.fulfill({ json: state }));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.getByRole("heading", { name: "Continente · 2 cupões" }).waitFor();
    const stores = page.getByRole("group", { name: "Filtrar por loja" });
    assert.deepEqual(await stores.locator("button > span:last-child").allTextContents(),
      ["Continente", "Galp", "Wells", "Pizza Hut", "Taco Bell", "KFC", "Pans & Company"]);
    assert.equal(await stores.getByRole("button", { name: /^Continente/ }).getAttribute("aria-pressed"), "true");
    assert.equal(await stores.getByRole("button", { name: "Galp: novos cupões" }).count(), 1);
    assert.equal(await stores.getByRole("button", { name: "Wells", exact: true }).count(), 1);
    assert.equal(await stores.locator(".store-circle img").count(), 7);
    await page.waitForFunction(() => [...document.querySelectorAll(".store-circle img")]
      .every((image) => image.complete && image.naturalWidth > 0));
    for (const [brand, filename] of [["Pizza Hut", "pizza-hut"], ["Taco Bell", "taco-bell"], ["KFC", "kfc"], ["Pans & Company", "pans-company"]]) {
      const button = stores.getByRole("button", { name: new RegExp(`^${brand}`) });
      assert.equal(await button.locator("img").getAttribute("src"), `/stores/${filename}.png`);
      await button.click();
      await page.getByRole("heading", { name: `${brand} · 1 cupão`, exact: true }).waitFor();
      assert.deepEqual(await page.locator(".coupon .brand").allTextContents(), [brand]);
    }

    await stores.getByRole("button", { name: /^Galp/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Galp · 1 cupão", exact: true }).waitFor();
    assert.deepEqual(await page.locator(".coupon .brand").allTextContents(), ["Galp"]);
    await page.locator(".coupon summary").click();
    assert.equal(await page.locator(".coupon summary").innerText(), "Condições");
    assert.equal(await page.locator(".coupon .details-body img").count(), 0);
    assert.equal(await page.locator(".coupon").getByText("g1", { exact: true }).count(), 1);
    await page.getByRole("combobox", { name: /^Conta/ }).selectOption("account-1");
    await page.getByRole("heading", { name: "Galp · 0 cupões" }).waitFor();
    assert.equal(await page.locator(".coupon").count(), 0);
    assert.equal(await stores.getByRole("button", { name: "Galp", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Comparar contas", exact: true }).click();
    await page.locator(".comparison .brand").waitFor();
    assert.deepEqual(await page.locator(".comparison .brand").allTextContents(), ["Galp"]);
    assert.equal(await page.getByText("Sem esta oferta", { exact: true }).count(), 2);
    assert.equal(await page.locator(".compare-value").filter({hasText: "Conta 3"}).getByText("5 €").count(), 1);
    await page.getByRole("button", { name: "Histórico", exact: true }).click();
    await page.getByRole("heading", { name: "Últimas alterações · Galp" }).waitFor();
    assert.equal(await page.locator(".history article").count(), 0);
    await page.getByRole("combobox", { name: /^Conta/ }).selectOption("all");
    await page.locator(".history article").waitFor();
    assert.deepEqual(await page.locator(".history article h3").allTextContents(), ["galp condições de teste"]);

    await page.getByRole("button", { name: "Cupões", exact: true }).click();
    await stores.getByRole("button", { name: "Wells", exact: true }).click();
    await page.getByRole("heading", { name: "Wells · 0 cupões" }).waitFor();
    await page.getByRole("button", { name: "Comparar contas", exact: true }).click();
    await page.getByText("Não existem ofertas atuais desta loja para comparar.").waitFor();
    await page.getByRole("button", { name: "Cupões", exact: true }).click();
    await page.getByRole("combobox", { name: /^Estado/ }).selectOption("all");
    await page.getByRole("heading", { name: "Wells · 1 cupão", exact: true }).waitFor();
    await page.getByLabel("Expira até", { exact: true }).fill("2026-11-15");
    await page.getByRole("heading", { name: "Wells · 0 cupões" }).waitFor();
    await page.getByRole("button", { name: "Limpar data" }).click();
    await page.getByRole("heading", { name: "Wells · 1 cupão", exact: true }).waitFor();
    await page.setViewportSize({ width: 320, height: 700 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    state = { ...state, coupons: [offer("TacoBell", "account-1", "t2"), offer("Pans&Company", "account-2", "pc2")] };
    await page.reload();
    await page.getByRole("heading", { name: "TacoBell · 1 cupão", exact: true }).waitFor();
    assert.equal(await stores.getByRole("button", { name: /^TacoBell/ }).locator("img").getAttribute("src"), "/stores/taco-bell.png");
    assert.equal(await stores.getByRole("button", { name: /^Pans&Company/ }).locator("img").getAttribute("src"), "/stores/pans-company.png");

    state = { ...state, coupons: [offer("Galp", "account-3", "g1")] };
    await page.reload();
    await page.getByRole("heading", { name: "Galp · 1 cupão", exact: true }).waitFor();
    assert.equal(await stores.getByRole("button").count(), 1);
    state = { ...state, coupons: [], events: [] };
    await page.reload();
    await page.getByRole("heading", { name: "Ainda não existem cupões confirmados" }).waitFor();
    assert.equal(await stores.count(), 0);
    await page.getByRole("button", { name: "Comparar contas", exact: true }).click();
    await page.getByText("As ofertas aparecerão aqui após a primeira verificação.").waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
