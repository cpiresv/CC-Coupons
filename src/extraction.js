import { parseDateRange } from "./dates.js";

export class CheckError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export async function withVerificationCheck(page, action) {
  const errors = (await page.pageErrors?.()) || [];
  if (errors.some((error) => error.message.includes("winsocks is not defined")))
    throw new CheckError("MANUAL_VERIFICATION");
  let rejectChallenge;
  const challenge = new Promise((_, reject) => {
    rejectChallenge = reject;
  });
  const onError = (error) => {
    // The observed verification HTML breaks OutSystems AJAX with this error.
    if (error.message.includes("winsocks is not defined"))
      rejectChallenge(new CheckError("MANUAL_VERIFICATION"));
  };
  const onResponse = (response) => {
    // The portal's observed HTTP 247 verification response can leave a blank page without an error event.
    if (
      response.status() === 247 &&
      new URL(response.url()).origin === "https://cartaocontinente.pt"
    )
      rejectChallenge(new CheckError("MANUAL_VERIFICATION"));
  };
  page.on("pageerror", onError);
  page.on("response", onResponse);
  try {
    return await Promise.race([action(), challenge]);
  } finally {
    page.off("pageerror", onError);
    page.off("response", onResponse);
  }
}
// These image names and amounts were visually verified in the live portal on 2026-11-04.
const discounts = new Map([
  ["1e1e516f-547f-42d1-8633-0cb684232ead_continente_10pp.png", "10%"],
  ["2d946dd7-a605-461b-a3c4-89e61972bd10_continente_5E.png", "5 €"],
  ["d452f89f-8ac5-462e-bbf3-bc464e343c97_continente_25pp.png", "25%"],
  ["63081dd1-8558-4d1c-8c06-961d810ec4ca_continente_35pp.png", "35%"],
  ["12109eb2-0c37-4c90-b782-1657aaad0792_continente_20pp.png", "20%"],
  ["59e29c18-7ebf-4b56-9a21-c75459f6f125_continente_15pp.png", "15%"],
  ["8b7d05d3-cd56-4247-aa43-4515851f5593_2Euro.png", "2 €"],
  [
    "d2207d53-8fbb-4859-a206-26e88aea52d9_wells_0008_AF_15pp_PICTO_DESCONTO_WELLS.png",
    "15%",
  ],
  [
    "fc6ffcd5-cc48-430b-a7ef-76add6d9f82e_wells_0009_AF_10pp_PICTO_DESCONTO_WELLS.png",
    "10%",
  ],
  ["69ebc596-8d49-4108-a.png", "75 €"],
  ["cbb7569f-1dc0-4cb2-adb2-1136164b27e2_Wells_100euros.png", "100 €"],
  [
    "92e54c23-320d-484c-9f20-234e6a898c78_wells_0012_AF_30€_PICTO_DESCONTO_WELLS.png",
    "30 €",
  ],
]);

export function normalizeCoupon(row, brand) {
  const code = row.code?.match(/^Código:\s*(\d+)$/u)?.[1];
  if (!code || !row.description?.trim() || !row.image)
    throw new CheckError("LAYOUT_CHANGED");
  let image;
  let dates;
  try {
    image = new URL(row.image);
    dates = parseDateRange(row.date);
  } catch {
    throw new CheckError("LAYOUT_CHANGED");
  }
  if (image.origin !== "https://appcartao.cdn.mc.pt")
    throw new CheckError("LAYOUT_CHANGED");
  const discount =
    discounts.get(decodeURIComponent(image.pathname.split("/").pop())) || null;
  const description = row.description.trim().replace(/\s+/g, " ");
  const minimum = description.match(
    /(?:COMPRA|ABASTECIMENTO) SUPERIOR A (\d+(?:[,.]\d+)?)\s*(€|L)(?=\s|$)/u,
  );
  return {
    key: `${brand}:${code}:${dates.startDate}`,
    code,
    brand,
    title: description,
    description,
    ...dates,
    discount,
    discountSource: discount ? "visually-verified-image" : "image-only",
    imageUrl: image.href,
    minimumPurchase: minimum ? `Superior a ${minimum[1]} ${minimum[2]}` : null,
    activationRequired: null,
    activated: null,
    used: null,
  };
}

export async function waitForAccount(page, timeout = 15000) {
  const menu = page.locator(".MyAccountLeftMenu");
  const deadline = Date.now() + timeout;
  while (!(await menu.isVisible()) && Date.now() < deadline) {
    for (const frame of page.frames()) {
      let url;
      try {
        url = new URL(frame.url());
      } catch {
        continue;
      }
      if (url.origin !== "https://login.continente.pt") continue;
      const name = url.pathname === "/sso/keep-me-logged-in"
        ? /^(Sim, manter|Yes, keep me logged in)$/
        : url.pathname.startsWith("/sso/welcome-back/")
          ? /^(Continuar|Continue)$/
          : null;
      if (!name) continue;
      const button = frame.getByRole("button", { name });
      if (await button.isVisible() && await button.isEnabled())
        await button.click();
    }
    await page.waitForTimeout(250);
  }
  await menu.waitFor({ timeout: 1000 });
}

export async function requireCouponPage(page) {
  const heading = page
    .locator(".TituloDadosConta")
    .filter({ hasText: /^Os meus cupões$/ });
  if (!(await heading.isVisible())) {
    if (
      !(await page.locator(".MyAccountLeftMenu").isVisible()) &&
      (await page.locator(".MyAccount .Menu_TopMenu").isVisible()) &&
      !page
        .frames()
        .some((frame) => frame.url().startsWith("https://login.continente.pt/"))
    ) {
      const couponLink = page
        .locator(".MyAccount a")
        .filter({ hasText: /^Cupões$/ });
      if ((await couponLink.count()) === 1) {
        if (!(await couponLink.isVisible()))
          await page.locator(".MyAccount .Menu_TopMenu").click();
        await couponLink.click();
      }
    }
  }
  try {
    if (!(await heading.isVisible())) {
      await waitForAccount(page);
      await page
        .locator(".MyAccountLeftMenu a")
        .filter({ hasText: /^Cupões$/ })
        .click();
    }
    await heading.waitFor({ timeout: 15000 });
  } catch {
    if (
      (await page
        .locator('script[src="/kramericaindustries.ac_v2.lib.js"]')
        .count()) ||
      ((await page.pageErrors()) || []).some((error) =>
        error.message.includes("winsocks is not defined"),
      )
    )
      throw new CheckError("MANUAL_VERIFICATION");
    if (
      page.frames().some((frame) => {
        try {
          return new URL(frame.url()).origin === "https://login.continente.pt";
        } catch {
          return false;
        }
      })
    ) {
      throw new CheckError("AUTH_REQUIRED");
    }
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    if (/Sorry for any inconvenience\./i.test(text))
      throw new CheckError("SITE_UNAVAILABLE");
    if (
      (await page.locator('input[type="password"]').count()) ||
      /iniciar sessão|código.*(?:sms|verificação)/iu.test(text)
    ) {
      throw new CheckError("AUTH_REQUIRED");
    }
    if (/captcha|verify you are human|verifique que é humano/iu.test(text))
      throw new CheckError("MANUAL_VERIFICATION");
    throw new CheckError("LAYOUT_CHANGED");
  }
}

export async function extractCoupons(page) {
  await requireCouponPage(page);
  const brands = await page.locator(".insignia-name").allTextContents();
  if (
    !brands.length ||
    brands.length > 30 ||
    new Set(brands).size !== brands.length
  )
    throw new CheckError("LAYOUT_CHANGED");
  const coupons = [];
  for (const brandText of brands) {
    const brand = brandText.trim();
    const tab = page.locator(".insignia-name").filter({
      hasText: new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    });
    const active = await tab.locator("..").locator(".circle-active").count();
    if (!active) {
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/AMinhaConta.aspx" &&
            r.request().method() === "POST",
          { timeout: 20000 },
        ),
        tab.click(),
      ]);
      if (!response.ok()) throw new CheckError("NETWORK_ERROR");
      await tab
        .locator("..")
        .locator(".circle-active")
        .waitFor({ timeout: 15000 });
    }
    const container = page.locator('[id$="wtCouponsContainer"]');
    await container.waitFor({ timeout: 15000 });
    const rows = await container.locator(".new-coupon").evaluateAll((els) =>
      els.map((e) => ({
        date: e.querySelector(".coupon-date-info")?.textContent,
        description: e.querySelector(".coupon-descr")?.textContent,
        code: e.querySelector(".coupon-code")?.textContent,
        image: e.querySelector(".cupoes-insignias-image")?.src,
      })),
    );
    // shortcut: no authenticated empty-state has been observed; fail closed until its markup is verified.
    if (!rows.length) throw new CheckError("UNVERIFIED_EMPTY_STATE");
    for (const row of rows) coupons.push(normalizeCoupon(row, brand));
  }
  if (new Set(coupons.map((c) => c.key)).size !== coupons.length)
    throw new CheckError("DUPLICATE_COUPONS");
  return coupons;
}
