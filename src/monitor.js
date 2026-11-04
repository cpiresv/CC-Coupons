import { appendFile } from "node:fs/promises";
import path from "node:path";
import { selectAccounts, dataDir, portalUrl } from "./config.js";
import {
  openProfile,
  closeProfile,
  saveSession,
  debugScreenshot,
} from "./auth.js";
import {
  extractCoupons,
  CheckError,
  withVerificationCheck,
} from "./extraction.js";
import {
  saveSnapshot,
  recordFailure,
  queueSavedExpiryReminders,
} from "./storage.js";
import { acquireLock } from "./lock.js";
import { flushNotifications } from "./notifications.js";

export async function log(event, account, code, count) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    account,
    code,
    count,
  });
  console.log(line);
  await appendFile(path.join(dataDir, "checks.log"), line + "\n", {
    mode: 0o600,
  });
}
export function safeCode(error) {
  if (error instanceof CheckError) return error.code;
  if (error.name === "TimeoutError") return "TIMEOUT";
  return "CHECK_FAILED";
}
export async function runChecks(db, id = "all", { scheduledDay } = {}) {
  const selected = selectAccounts(id);
  const release = acquireLock(db);
  const results = [];
  try {
    if (scheduledDay) {
      const last = db
        .prepare("SELECT value FROM metadata WHERE key='scheduled_day'")
        .get()?.value;
      if (last && last >= scheduledDay) return [];
      db.prepare(
        "INSERT INTO metadata VALUES('scheduled_day',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(scheduledDay);
    }
    for (const account of selected) {
      let succeeded = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        let context;
        let page;
        try {
          context = await openProfile(account.id, {
            headed: process.env.HEADLESS === "false",
          });
          page = context.pages()[0] || (await context.newPage());
          const coupons = await withVerificationCheck(page, async () => {
            const response = await page.goto(portalUrl, {
              waitUntil: "domcontentloaded",
              timeout: 45000,
            });
            if (response && !response.ok())
              throw new CheckError("NETWORK_ERROR");
            return extractCoupons(page);
          });
          await saveSession(context, account.id);
          const changes = saveSnapshot(db, account.id, coupons);
          results.push({
            accountId: account.id,
            ok: true,
            count: coupons.length,
            changes: changes.length,
          });
          await log("check_success", account.id, undefined, coupons.length);
          succeeded = true;
          break;
        } catch (error) {
          const code = safeCode(error);
          const retryable = [
            "TIMEOUT",
            "NETWORK_ERROR",
            "SITE_UNAVAILABLE",
            "CHECK_FAILED",
          ].includes(code);
          if (!retryable || attempt === 2) {
            if (page) await debugScreenshot(page, account.id);
            recordFailure(db, account.id, code);
            results.push({ accountId: account.id, ok: false, code });
            await log("check_failed", account.id, code);
            break;
          }
        } finally {
          if (context) {
            // A failed extraction can still renew or revoke the browser session.
            if (!succeeded)
              await saveSession(context, account.id).catch(() => {});
            await closeProfile(context).catch(() => {});
          }
        }
        await new Promise((resolve) =>
          setTimeout(resolve, (attempt + 1) * 5000),
        );
      }
      if (!succeeded && !results.some((r) => r.accountId === account.id))
        throw new Error("CHECK_FAILED");
    }
    queueSavedExpiryReminders(db);
    await flushNotifications(db);
    return results;
  } finally {
    release();
  }
}
