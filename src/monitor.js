import { appendFile } from "node:fs/promises";
import path from "node:path";
import { selectAccounts, dataDir, portalUrl } from "./config.js";
import {
  openCheckProfile,
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
  saveBalance,
  recordFailure,
  queueSavedExpiryReminders,
} from "./storage.js";
import { acquireLock } from "./lock.js";
import { flushNotifications } from "./notifications.js";
import { checkAndroid } from "./android.js";

export async function log(event, account, code, count, source) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    account,
    code,
    count,
    source,
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
    // Keep the lock until every device has finished, even if a worker throws.
    const checks = await Promise.allSettled(selected.map(async (account) => {
      await log("check_started", account.id, undefined, undefined, account.source);
      let succeeded = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        let profile;
        let page;
        try {
          let coupons;
          if (account.source === "android") {
            coupons = await checkAndroid(account.id, (balance) => saveBalance(db, account.id, balance));
          } else {
            profile = await openCheckProfile(account.id);
            page = profile.page;
            coupons = await withVerificationCheck(page, async () => {
              const response = await page.goto(portalUrl, {
                waitUntil: "domcontentloaded",
                timeout: 45000,
              });
              if (response && !response.ok())
                throw new CheckError("NETWORK_ERROR");
              return extractCoupons(page);
            });
            await saveSession(profile.context, account.id);
          }
          const changes = saveSnapshot(db, account.id, coupons);
          await log("check_success", account.id, undefined, coupons.length, profile?.source || account.source);
          succeeded = true;
          return {
            accountId: account.id,
            ok: true,
            count: coupons.length,
            changes: changes.length,
          };
        } catch (error) {
          const code = safeCode(error);
          const retryable = [
            "TIMEOUT",
            "ANDROID_UNAVAILABLE",
            "NETWORK_ERROR",
            "SITE_UNAVAILABLE",
            "CHECK_FAILED",
          ].includes(code);
          if (!retryable || attempt === 2) {
            if (page) await debugScreenshot(page, account.id);
            recordFailure(db, account.id, code);
            await log("check_failed", account.id, code, undefined, profile?.source || account.source);
            return { accountId: account.id, ok: false, code };
          }
        } finally {
          if (profile) {
            // A failed extraction can still renew or revoke the browser session.
            if (!succeeded)
              await saveSession(profile.context, account.id).catch(() => {});
            await profile.close().catch(() => {});
          }
        }
        await new Promise((resolve) =>
          setTimeout(resolve, (attempt + 1) * 5000),
        );
      }
      throw new Error("CHECK_FAILED");
    }));
    const results = checks.map((check) => {
      if (check.status === "rejected") throw check.reason;
      return check.value;
    });
    queueSavedExpiryReminders(db);
    await flushNotifications(db);
    return results;
  } finally {
    release();
  }
}
