import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { root, dataDir, prepareData } from "./config.js";
import { lisbonParts, localDay } from "./dates.js";
import { openStore } from "./storage.js";
import { runChecks } from "./monitor.js";

export const label = "local.cc-coupons.daily";
function dailyTime(time = process.env.DAILY_CHECK_TIME || "09:00") {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("DAILY_CHECK_TIME must be HH:MM");
  return time;
}
export function due(now = new Date(), time) {
  const p = lisbonParts(now);
  return `${p.hour}:${p.minute}` >= dailyTime(time);
}
const xml = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export function plist(time) {
  const [hour, minute] = dailyTime(time).split(":").map(Number);
  const formulaNode = process.execPath.replace(/\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/, "/opt/$1/bin/node");
  const node = existsSync(formulaNode) ? formulaNode : process.execPath;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.join(root, "src/schedule.js"))}</string><string>tick</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>${xml(path.join(dataDir, "launchd.log"))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(dataDir, "launchd-error.log"))}</string>
</dict></plist>\n`;
}
export async function runScheduledChecks(db) {
  const scheduledDay = localDay();
  for (let retries = 0; ; retries++) {
    try {
      return await runChecks(db, "all", { scheduledDay });
    } catch (error) {
      if (error.code !== "BUSY" || retries >= 15) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 60_000));
    if (localDay() !== scheduledDay) return [];
  }
}
async function main(command) {
  prepareData();
  const destination = path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${label}.plist`,
  );
  const domain = `gui/${process.getuid()}`;
  if (command === "tick") {
    if (!due()) return;
    const db = openStore();
    try {
      const result = await runScheduledChecks(db);
      if (result.some((r) => !r.ok)) process.exitCode = 1;
    } finally {
      db.close();
    }
  } else if (command === "install") {
    if (process.platform !== "darwin")
      throw new Error("launchd requires macOS");
    const definition = plist();
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, definition, { mode: 0o600 });
    try {
      execFileSync("launchctl", ["bootout", `${domain}/${label}`], {
        stdio: "ignore",
      });
    } catch {}
    execFileSync("launchctl", ["bootstrap", domain, destination], {
      stdio: "inherit",
    });
    console.log(
      `Installed ${label}. Daily at ${dailyTime()} on the Mac’s local clock. Catches up after wake or login.`,
    );
  } else if (command === "uninstall") {
    try {
      execFileSync("launchctl", ["bootout", `${domain}/${label}`], {
        stdio: "ignore",
      });
    } catch {}
    await unlink(destination).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    console.log("Schedule removed. Local data retained.");
  } else if (command === "status") {
    execFileSync("launchctl", ["print", `${domain}/${label}`], {
      stdio: "inherit",
    });
  } else if (command === "print") console.log(plist());
  else throw new Error("Use install, uninstall, status or print");
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv[2]).catch((error) => {
    console.error(
      error.code === "BUSY" ? "Daily check could not start after 15 minutes because another operation held the lock."
        : "Scheduler failed. Check DAILY_CHECK_TIME and launchd setup.",
    );
    process.exitCode = 1;
  });
