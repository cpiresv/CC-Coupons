import { openStore } from "./storage.js";
import { selectAccounts } from "./config.js";
import { authenticate, importChrome } from "./auth.js";
import { runChecks, safeCode } from "./monitor.js";
import { acquireLock } from "./lock.js";

const [command, id = "all"] = process.argv.slice(2);
const db = openStore();
try {
  selectAccounts(id);
  if (command === "check") {
    const results = await runChecks(db, id);
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  } else if (["login", "import-chrome"].includes(command)) {
    if (command === "import-chrome" && id === "all")
      throw new Error("Import one account at a time");
    const release = acquireLock(db);
    try {
      for (const account of selectAccounts(id)) {
        if (command === "login")
          await authenticate(account.id, () =>
            console.log(
              `${account.name}: complete manual login and SMS in the separate browser. It closes automatically after success.`,
            ),
          );
        else await importChrome(account.id);
        db.prepare("UPDATE accounts SET auth='ready' WHERE id=?").run(
          account.id,
        );
        console.log(`${account.name}: session saved locally.`);
      }
    } finally {
      release();
    }
    const results = await runChecks(db, id);
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  } else {
    console.error(
      "Usage: npm run check|login|import-chrome -- account-1|account-2|all",
    );
    process.exitCode = 2;
  }
} catch (e) {
  console.error(
    e.code === "BUSY"
      ? "A check or login is already running."
      : safeCode(e) === "MANUAL_VERIFICATION"
        ? "Continente requires browser verification. The session was saved. Complete any verification shown on the website; another SMS login may not resolve this block."
        : `Operation failed: ${safeCode(e)}. No passwords or SMS codes are stored.`,
  );
  process.exitCode = 1;
} finally {
  db.close();
}
