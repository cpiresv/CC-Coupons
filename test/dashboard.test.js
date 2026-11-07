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
        balance: id === 3 ? null : { cents: id === 1 ? 1583 : 0, checkedAt: "2026-11-04T11:58:00Z", error: id === 2 ? 1 : 0 },
      })),
      coupons: [
        offer("Continente", "account-1", "c1"),
        offer("Continente", "account-2", "c2", { status: "upcoming", startDate: "2026-11-09", isNew: false }),
        offer("Galp", "account-3", "g1", { discount: "0,1 €", description: "DESCONTO GALP/CONTINENTE 10 CENT/LT EM CARTAO CONTINENTE", expiring: true, imageUrl: null }),
        offer("Wells", "account-1", "w1", { status: "expired" }),
        offer("Pizza Hut", "account-1", "p1", { status: "upcoming", startDate: "2026-11-09", isNew: false }),
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
    const upcoming = page.locator(".coupon.upcoming");
    assert.equal(await upcoming.count(), 1);
    assert.equal(await upcoming.locator(".badge.upcoming").innerText(), "Em breve");
    assert.equal(await upcoming.locator(".status-label").innerText(), "Disponível a partir de");
    assert.equal(await upcoming.locator(".validity strong").innerText(), "9/11/2026");
    assert.equal(await upcoming.locator(".validity small").innerText(), "Até 30/11/2026");
    await upcoming.locator("summary").click();
    assert.equal(await upcoming.getByText("c2", { exact: true }).isVisible(), true);
    await upcoming.locator("summary").click();
    assert.equal(await page.locator(".coupon:not(.upcoming) .status-label").innerText(), "Disponíveis");
    const balances = page.locator(".account-balance strong");
    assert.deepEqual((await balances.allTextContents()).map(text => text.replace(/\s/g, " ")), ["15,83 €", "0,00 €", "Por verificar"]);
    assert.equal(await page.getByText("Não foi possível atualizar o saldo. O valor anterior foi mantido.").count(), 1);
    assert.equal(await page.getByText(/Saldo verificado:.*4\/11, 11:58/).count(), 2);
    for (const width of [320, 390, 440]) {
      await page.setViewportSize({ width, height: 844 });
      const boxes = await page.locator(".account").evaluateAll(elements =>
        elements.map(element => {
          const box = element.getBoundingClientRect();
          return { top: box.top, right: box.right };
        }));
      assert.equal(new Set(boxes.map(box => box.top)).size, 1);
      assert.ok(boxes.every(box => box.right <= width));
      assert.equal(await page.locator(".balance-checked").first().isVisible(), false);
      assert.equal(await page.locator(".connection").first().isVisible(), false);
      assert.equal(await page.getByRole("button", { name: "Usar cartão de Conta 1" }).isVisible(), true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(".impeccable/review", { recursive: true });
    await page.screenshot({ path: ".impeccable/review/balance-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole("link", { name: "CC Cupões, página inicial" }).count(), 1);
    await page.screenshot({ path: ".impeccable/review/balance-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Comparar contas", exact: true }).click();
    assert.equal(await page.locator(".compare-value .upcoming strong").innerText(), "5 €");
    assert.equal(await page.locator(".compare-value").getByRole("img", { name: "Em breve", exact: true }).count(), 1);
    assert.equal(await page.locator(".compare-value").getByRole("img", { name: "Disponível", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Cupões", exact: true }).click();
    const stores = page.getByRole("group", { name: "Filtrar por loja" });
    const headerAndAccounts = () => page.evaluate(() =>
      [".topbar", ".accounts", ".account .primary", ".page-heading .primary"]
        .map(selector => getComputedStyle(document.querySelector(selector)).backgroundColor));
    const initialColors = await headerAndAccounts();
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
    assert.equal(await stores.locator('[aria-pressed="true"] .store-circle')
      .evaluate(el => getComputedStyle(el).borderTopColor), "rgb(205, 70, 0)");
    assert.equal(await page.locator(".coupon .discount").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 240, 231)");
    assert.deepEqual(await headerAndAccounts(), initialColors);
    assert.equal((await page.locator(".coupon .discount strong").textContent()).trim(), "10 cênt./L");
    await page.locator(".coupon summary").click();
    assert.equal(await page.locator(".coupon summary").innerText(), "Condições");
    assert.equal(await page.locator(".coupon .details-body img").count(), 0);
    assert.equal(await page.locator(".coupon").getByText("g1", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("combobox", { name: /^Conta/ }).isVisible(), false);
    await page.locator(".filter-panel > summary").click();
    await page.getByRole("combobox", { name: /^Conta/ }).selectOption("account-1");
    await page.getByRole("heading", { name: "Galp · 0 cupões" }).waitFor();
    assert.equal(await page.locator(".coupon").count(), 0);
    assert.equal(await stores.getByRole("button", { name: "Galp", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Comparar contas", exact: true }).click();
    await page.locator(".comparison .brand").waitFor();
    assert.deepEqual(await page.locator(".comparison .brand").allTextContents(), ["Galp"]);
    assert.equal(await page.getByRole("img", { name: "Sem esta oferta", exact: true }).count(), 2);
    assert.equal((await page.locator(".compare-value").filter({hasText: "Conta 3"}).locator("strong").textContent()).trim(), "10 cênt./L");
    await page.getByRole("button", { name: "Histórico", exact: true }).click();
    await page.getByRole("heading", { name: "Últimas alterações · Galp" }).waitFor();
    assert.equal(await page.locator(".history article").count(), 0);
    await page.getByRole("combobox", { name: /^Conta/ }).selectOption("all");
    await page.locator(".history article").waitFor();
    assert.deepEqual(await page.locator(".history article h3").allTextContents(), ["desconto galp/continente 10 cent/lt em cartao continente"]);
    assert.match(await page.locator(".history article p").textContent(), /10 cênt\.\/L/);

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

    const continenteTitle = "NUMA COMPRA SUPERIOR A 20€ NO CONTINENTE";
    const wellsTitle = "NUMA COMPRA SUPERIOR A 5€ NAS LOJAS WELLS (NÃO ACUMULÁVEL COM OUTRAS PROMOÇÕES)";
    state = { ...state, coupons: [
      offer("Continente", "account-1", "regular"),
      offer("Continente", "account-1", "featured", { title: continenteTitle, discount: "5,00 €", endDate: "2026-12-31" }),
      offer("Continente", "account-2", "future", { title: continenteTitle, status: "upcoming", startDate: "2026-12-01", endDate: "2026-12-31" }),
      ...["removed", "used", "expired"].map(status => offer("Continente", "account-1", status, { title: continenteTitle, status, present: status !== "removed" })),
      offer("Continente", "account-1", "wrong-discount", { title: continenteTitle, discount: "75 €" }),
      offer("Continente", "account-1", "percentage", { title: continenteTitle, discount: "5 %" }),
      offer("Continente", "account-1", "wrong-threshold", { title: "NUMA COMPRA SUPERIOR A 200€ NO CONTINENTE" }),
      offer("Wells", "account-1", "wells-featured", { title: wellsTitle }),
      offer("Wells", "account-2", "wells-removed", { title: wellsTitle, status: "removed", present: false }),
      offer("Wells", "account-1", "wells-wrong-threshold", { title: "NUMA COMPRA SUPERIOR A 50€ NAS LOJAS WELLS" }),
      offer("Pizza Hut", "account-1", "other-store", { title: continenteTitle }),
    ] };
    await page.reload();
    await stores.getByRole("button", { name: /^Continente/ }).click();
    await page.locator(".filter-panel > summary").click();
    await page.getByRole("combobox", { name: /^Estado/ }).selectOption("all");
    await page.getByRole("heading", { name: "Continente · 9 cupões", exact: true }).waitFor();
    assert.equal(await page.locator(".coupon.featured").count(), 2);
    assert.equal(await page.locator(".coupon").first().locator(".discount strong").innerText(), "5,00 €");
    assert.equal(await page.locator(".coupon").first().getByText("Destaque", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Destaques primeiro", { exact: true }).count(), 0);
    assert.equal(await page.locator(".coupon.featured.upcoming").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(240, 241, 240)");
    await page.locator(".coupon.featured").first().locator("summary").click();
    assert.equal(await page.locator(".coupon.featured").first().getByText("featured", { exact: true }).isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole("button", { name: "Comparar contas", exact: true }).click();
    assert.equal(await page.locator(".compare-row:not(.compare-heading)").first().getByText("Destaque", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "Cupões", exact: true }).click();
    await stores.getByRole("button", { name: /^Wells/ }).click();
    assert.equal(await page.locator(".coupon.featured").count(), 1);
    assert.equal(await page.locator(".coupon.featured .discount").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(0, 119, 143)");
    assert.deepEqual(await headerAndAccounts(), initialColors);
    assert.equal(await page.locator(".coupon.featured h3").textContent(), wellsTitle.toLocaleLowerCase("pt-PT"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await stores.getByRole("button", { name: /^Pizza Hut/ }).click();
    assert.equal(await page.locator(".coupon.featured").count(), 0);

    state = { ...state, coupons: [
      offer("Galp", "account-1", "rate-8", { title: "A · Combustível 8 CENT/LT", discount: "0,08 €" }),
      offer("Galp", "account-1", "rate-10", { title: "B · Combustível 10CT/LT EM EVOLOGIC", discount: "0,10 €" }),
      offer("Galp", "account-1", "fixed", { title: "C · NUM ABASTECIMENTO SUPERIOR A 20L EM EVOLOGIC", discount: "2 €" }),
      offer("Galp", "account-1", "unknown", { title: "D · Combustível 10 CENT/LT", discount: null }),
      offer("Galp", "account-1", "fixed-with-rate", { title: "E · Bónus adicional ao desconto de 10CT/LT", discount: "2 €" }),
    ] };
    await page.reload();
    await page.getByRole("heading", { name: "Galp · 5 cupões", exact: true }).waitFor();
    assert.deepEqual((await page.locator(".coupon .discount strong").allTextContents()).map(text => text.trim()), ["8 cênt./L", "10 cênt./L", "2 €", "Ver imagem", "2 €"]);
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

test("Card activation shows a confirmed per-account timer across reload, sleep, offline and expiry", async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8000);
    let serverNow = Date.parse("2026-11-06T16:00:00Z"), activation, fail = false, offline = false;
    const state = {
      accounts: [1, 2, 3].map(id => ({ id: `account-${id}`, name: `Conta ${id}`, auth: "ready", source: "android", card: null })),
      coupons: [], events: [], notifications: [], running: false,
    };
    await page.clock.install({ time: new Date(serverNow + 120000) });
    await page.clock.pauseAt(new Date(serverNow + 120000));
    await page.route("**/api/state", route => offline ? route.abort() : route.fulfill({ json: { ...state, serverNow } }));
    await page.route("**/api/cards/*/activate", async route => {
      assert.equal(route.request().method(), "POST");
      assert.match(route.request().url(), /account-2\/activate$/);
      await new Promise(resolve => { activation = resolve; });
      if (fail) return route.fulfill({ status: 502, json: { error: "CARD_UNCONFIRMED" } });
      state.accounts[1].card = { expiresAt: serverNow + 600000 };
      await route.fulfill({ json: { card: state.accounts[1].card, serverNow } });
    });
    await page.route("**/api/cards/*/image?*", route => route.fulfill({ contentType: "image/svg+xml", body:
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="280" viewBox="0 0 500 280"><rect width="500" height="280" fill="white"/><text x="250" y="60" text-anchor="middle" font-family="sans-serif" font-size="32">123456</text>' +
      Array.from({ length: 42 }, (_, i) => `<rect x="${70 + i * 8}" y="90" width="${i % 3 + 2}" height="110"/>`).join("") +
      '<text x="250" y="250" text-anchor="middle" font-family="sans-serif" font-size="24">Código de teste</text></svg>' }));
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    await page.goto(url);
    const button = page.getByRole("button", { name: "Usar cartão de Conta 2", exact: true });
    await button.click();
    await button.and(page.locator('[aria-busy="true"]')).waitFor();
    const announcement = await page.locator(".account").nth(1).getByRole("status").elementHandle();
    assert.equal(await page.getByRole("button", { name: "Usar cartão de Conta 1" }).isDisabled(), true);
    assert.equal(await page.getByRole("timer").count(), 0);
    while (!activation) await new Promise(resolve => setTimeout(resolve, 5));
    activation();
    const timer = page.getByRole("timer", { name: "Tempo restante do cartão de Conta 2" });
    await timer.waitFor();
    assert.match(await announcement.innerText(), /Conta 2: cartão ativo/);
    assert.equal(await timer.innerText(), "10:00");
    assert.equal(await page.getByRole("timer").count(), 1);
    assert.match(await page.locator(".card-code").getAttribute("src"), /account-2\/image\?expiresAt=/);
    serverNow += 5000;
    await page.clock.fastForward(5000);
    assert.equal(await timer.innerText(), "09:55");
    await page.reload();
    await timer.waitFor();
    assert.equal(await timer.innerText(), "09:55");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(".impeccable/review", { recursive: true });
    await page.screenshot({ path: ".impeccable/review/mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: ".impeccable/review/desktop.png", fullPage: true });
    await page.setViewportSize({ width: 320, height: 700 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    offline = true;
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByText(/Sem ligação ao Mac. A mostrar/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Usar cartão de Conta 1" }).isDisabled(), true);
    // A suspended page resumes from absolute expiry, rather than replaying 595 ticks.
    serverNow += 600000;
    await page.clock.fastForward(600000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.getByText("Conta 2: autorização terminada. Ative o cartão novamente para usar saldo.").waitFor();
    assert.equal(await page.getByRole("timer").count(), 0);
    assert.equal(await page.locator(".card-code").count(), 0);
    offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByText(/Última sincronização com o Mac/).waitFor();
    fail = true; activation = undefined;
    await button.click();
    while (!activation) await new Promise(resolve => setTimeout(resolve, 5));
    activation();
    await page.getByRole("alert").filter({ hasText: "Não foi possível confirmar a ativação" }).waitFor();
    assert.equal(await page.getByRole("timer").count(), 0);
    assert.equal(await button.isEnabled(), true);
  } finally { await browser?.close(); await server.close(); }
});

test("Dashboard fits major responsive widths and keeps euro amounts on one line", async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    const accounts = [1, 2, 3].map(id => ({
      id: `account-${id}`, name: `Conta ${id} ···573`, auth: "ready", source: "android",
      last_success: "2026-11-07T09:07:00Z", balance: { cents: 2083, checkedAt: "2026-11-07T09:03:00Z" },
    }));
    await page.route("**/api/state", route => route.fulfill({ json: {
      accounts, running: false, notifications: [], events: [],
      coupons: ["100 €", "100,00 €", "10%"].map((discount, index) => ({
        accountId: accounts[index].id, brand: "Wells", key: `offer-${index}`,
        title: "Numa compra de aparelhos auditivos e acessórios nas lojas Wells",
        description: "Condições completas da oferta", discount, present: true,
        status: "available", startDate: "2026-10-19", endDate: "2099-11-19",
      })),
    } }));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.locator(".coupon").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [320, 360, 390, 440, 600, 760, 761, 768, 820, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of ["coupons", "compare", "filters", "details", "history"]) {
        await page.getByRole("button", { name: view === "compare" ? "Comparar contas" : "Cupões", exact: true }).click();
        if (view === "history") {
          await page.locator(".filter-panel").evaluate(element => { element.open = true; });
          await page.getByRole("button", { name: "Histórico", exact: true }).click();
        }
        await page.locator(".filter-panel").evaluate((element, open) => { element.open = open; }, view === "filters");
        await page.locator(".coupon details").evaluateAll((elements, open) =>
          elements.forEach(element => { element.open = open; }), view === "details");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px ${view}`);
        if (view !== "history") {
          const fits = await page.locator(".discount strong, .compare-value strong").evaluateAll(elements => elements.every(element => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const text = range.getBoundingClientRect();
            const badge = (element.closest(".compare-value") || element.parentElement).getBoundingClientRect();
            return range.getClientRects().length === 1 && text.left >= badge.left - 1 && text.right <= badge.right + 1;
          }));
          assert.equal(fits, true, `Discount amounts must fit at ${width}px`);
        }
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});
