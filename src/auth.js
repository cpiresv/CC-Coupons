import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  dataDir,
  portalUrl,
  timezone,
  prepareData,
  selectAccounts,
} from "./config.js";
import { requireCouponPage, waitForAccount, CheckError } from "./extraction.js";

const stateFile = (id) => path.join(dataDir, `${id}-state.json`);
export async function openProfile(id, { headed = false } = {}) {
  selectAccounts(id);
  prepareData();
  const dir = path.join(dataDir, "profiles", id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(dir, {
    channel: process.env.BROWSER_CHANNEL || "chrome",
    headless: !headed,
    args: ["--restore-last-session"],
    timezoneId: timezone,
    viewport: { width: 1360, height: 1000 },
    locale: "pt-PT",
    timeout: 30000,
  });
  try {
    const pages = context.pages();
    const page =
      pages.find((p) => p.url() === "about:blank") || (await context.newPage());
    for (const restored of pages) if (restored !== page) await restored.close();
    context.setDefaultTimeout(20000);
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}
export async function closeProfile(context) {
  // Retain session cookies without reopening old login tabs and their background requests.
  try {
    for (const page of context.pages()) await page.close();
  } finally {
    await context.close();
  }
}

export async function openCheckProfile(id) {
  if (id === "account-3") {
    // The overnight trial attaches only to the browser socket in this private profile.
    const file = path.join(dataDir, "profiles", id, "DevToolsActivePort");
    const endpoint = await readFile(file, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "";
    });
    const address = /^(\d{1,5})\r?\n(\/devtools\/browser\/[\da-f-]{36})\s*$/i.exec(endpoint);
    if (address && Number(address[1]) <= 65535) {
      const browser = await chromium.connectOverCDP(
        `ws://127.0.0.1:${address[1]}${address[2]}`, { timeout: 3000 },
      ).catch(() => null); // Chrome can leave the file behind after exit.
      if (browser) {
        try {
          const context = browser.contexts()[0];
          const hasPortalTab = context.pages().some((p) => new URL(p.url()).origin === new URL(portalUrl).origin);
          const client = await browser.newBrowserCDPSession();
          const url = `about:blank#${randomUUID()}`;
          const [page] = await Promise.all([
            context.waitForEvent("page", { predicate: p => p.url() === url, timeout: 10000 }),
            client.send("Target.createTarget", { url, background: true }),
          ]);
          return {
            context, page, source: hasPortalTab ? "open-tab" : "open-browser",
            async close() {
              try { await page.close(); } finally { await browser.close(); }
            },
          };
        } catch (error) {
          await browser.close();
          throw error;
        }
      }
    }
  }
  const context = await openProfile(id, { headed: process.env.HEADLESS === "false" });
  return { context, page: context.pages()[0], source: "reopened", close: () => closeProfile(context) };
}

export async function saveSession(context, id) {
  const tmp = stateFile(id) + ".tmp";
  await writeFile(tmp, JSON.stringify(await context.storageState()), {
    mode: 0o600,
  });
  await rename(tmp, stateFile(id));
}
export async function authenticate(id, onReady = () => {}) {
  const context = await openProfile(id, { headed: true });
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(portalUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.bringToFront();
    onReady();
    await waitForAccount(page, 15 * 60 * 1000);
    const accountPage = new URL(
      await page.locator("form").getAttribute("action"),
      page.url(),
    );
    if (
      accountPage.origin !== new URL(portalUrl).origin ||
      accountPage.pathname !== "/AMinhaConta.aspx"
    )
      throw new CheckError("LAYOUT_CHANGED");
    // Verification HTML cannot complete inside the site's AJAX response.
    await page.goto(accountPage.href, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await waitForAccount(page, 15 * 60 * 1000);
    await requireCouponPage(page);
  } finally {
    await saveSession(context, id).catch(() => {});
    await closeProfile(context);
  }
}
export async function importChrome(id, endpoint = "http://127.0.0.1:9333") {
  const url = new URL(endpoint);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("CDP must be local");
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
  let cookies;
  let localStorage;
  try {
    const page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => new URL(p.url()).origin === "https://cartaocontinente.pt");
    if (!page) throw new CheckError("NO_PORTAL_TAB");
    await requireCouponPage(page);
    cookies = (await page.context().cookies([
      portalUrl,
      "https://login.continente.pt/",
    ])).filter((c) =>
      ["cartaocontinente.pt", "login.continente.pt"].includes(
        c.domain.replace(/^\./, ""),
      ),
    );
    localStorage = await page.evaluate(() =>
      Object.entries(window.localStorage).map(([name, value]) => ({
        name,
        value,
      })),
    );
  } finally {
    await browser.close();
  }
  const context = await openProfile(id);
  try {
    await context.clearCookies();
    await context.addCookies(cookies);
    await context.addInitScript((items) => {
      if (location.origin === "https://cartaocontinente.pt")
        for (const { name, value } of items)
          window.localStorage.setItem(name, value);
    }, localStorage);
    const page = context.pages()[0];
    await page.goto(portalUrl, { waitUntil: "domcontentloaded" });
    await requireCouponPage(page);
    await saveSession(context, id);
  } finally {
    await closeProfile(context);
  }
}
export async function debugScreenshot(page, id) {
  const dir = path.join(dataDir, "debug");
  const filename = `${id}-${Date.now()}.png`;
  await page
    .screenshot({
      path: path.join(dir, filename),
      fullPage: false,
      mask: [
        page.locator(
          'input, textarea, iframe, [id*="wtHeader"], .account-side-menu',
        ),
      ],
      maskColor: "#202020",
    })
    .catch(() => {});
  const files = (await readdir(dir))
    .filter((f) => /^account-\d+-\d+\.png$/.test(f))
    .sort((a, b) => Number(a.split("-").pop().split(".")[0]) - Number(b.split("-").pop().split(".")[0]));
  for (const file of files.slice(0, -20)) await unlink(path.join(dir, file));
}
