import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { requireCouponPage, waitForAccount } from "../src/extraction.js";

test("Remembered login follows the site's welcome and persistence choices without entering credentials", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const choices = [];
    await page.exposeFunction("recordChoice", (choice) => choices.push(choice));
    await page.route("https://cartaocontinente.pt/**", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<iframe src="https://login.continente.pt/sso/welcome-back/test-client"></iframe>
        <div class="MyAccountLeftMenu" hidden>
          <a href="#" onclick="document.querySelector('.TituloDadosConta').hidden=false;return false">Cupões</a>
        </div>
        <div class="TituloDadosConta" hidden>Os meus cupões</div>
        <script>addEventListener('message', event => {
          if(event.origin === 'https://login.continente.pt' && event.data === 'signed-in')
            document.querySelector('.MyAccountLeftMenu').hidden=false;
        });</script>`,
    }));
    await page.route("https://login.continente.pt/**", (route) => {
      const welcome = new URL(route.request().url()).pathname.startsWith("/sso/welcome-back/");
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: welcome
          ? `<h1>Bem-vindo de volta!</h1><button onclick="recordChoice('continue').then(()=>location.href='/sso/keep-me-logged-in')">Continuar</button>`
          : `<h1>Manter sessão iniciada?</h1><button onclick="recordChoice('keep').then(()=>parent.postMessage('signed-in','https://cartaocontinente.pt'))">Sim, manter</button>`,
      });
    });
    await page.goto("https://cartaocontinente.pt/IniciarSessao.aspx");
    await requireCouponPage(page);
    assert.deepEqual(choices, ["continue", "keep"]);
    assert.equal(await page.locator(".TituloDadosConta").isVisible(), true);

    await page.route("https://unrelated.example/**", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<button onclick="recordChoice('wrong-origin')">Sim, manter</button>`,
    }));
    await page.setContent(`<iframe src="https://unrelated.example/sso/keep-me-logged-in"></iframe>`);
    await assert.rejects(waitForAccount(page, 300), { name: "TimeoutError" });
    assert.deepEqual(choices, ["continue", "keep"]);
  } finally {
    await browser.close();
  }
});
