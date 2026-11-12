import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { dataDir, root, prepareData } from "./config.js";
import { CheckError } from "./extraction.js";

const execute = promisify(execFile);
const visible = (node) => !node.hidden && !node["off-screen"];

export function parseBalance(amount) {
  const match = typeof amount === "string" && amount.trim().match(/^(\d+|\d{1,3}(?:[.\s]\d{3})+),(\d{2})\s*€$/u);
  if (!match) throw new CheckError("BALANCE_UNCONFIRMED");
  const cents = Number(match[1].replace(/[.\s]/gu, "")) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(cents)) throw new CheckError("BALANCE_UNCONFIRMED");
  return cents;
}

function homeScreen(nodes) {
  const namedScreen = nodes.find((n) => n.text === "HomePage" && visible(n));
  if (namedScreen || !nodes.some((n) => n["resource-id"] === "TooltipBalance" && visible(n))) return namedScreen;
  return nodes.find((n) => n.class === "android.webkit.WebView" && visible(n));
}

export function balanceBounds(nodes) {
  const bounds = (node) => node?.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.slice(1).map(Number);
  const right = nodes.filter((n) => n["resource-id"] === "Right" && visible(n));
  const region = right.length === 1 && bounds(right[0]);
  const screen = bounds(homeScreen(nodes));
  if (!region || !screen || screen[0] !== 0 || screen[1] !== 0 ||
      ![...region, ...screen].every(Number.isSafeInteger) || region[2] <= region[0] || region[3] <= region[1] ||
      region[2] > screen[2] || region[3] > screen[3]) throw new CheckError("BALANCE_UNCONFIRMED");
  return [...region, screen[2], screen[3]];
}

export async function readAndroidBalance(device) {
  let bounds;
  await device.waitFor((nodes) => {
    if (!nodes.some((n) => n["resource-id"] === "BottomLeft" && visible(n) &&
        (n.text || n["content-desc"])?.startsWith("Já ganhou"))) return false;
    try {
      bounds = balanceBounds(nodes);
      return true;
    } catch (error) {
      if (error.code !== "BALANCE_UNCONFIRMED") throw error;
      return false;
    }
  }, { timeout: 90000 });
  prepareData();
  const directory = await mkdtemp(path.join(dataDir, ".balance-"));
  try {
    const screenshot = path.join(directory, "screen.png");
    for (let attempt = 0; attempt < 15; attempt++) {
      const checkedAt = new Date().toISOString();
      try {
        await writeFile(screenshot, await device.capture(), { mode: 0o600 });
        const { stdout } = await execute("/usr/bin/swift", [path.join(root, "src/read-balance.swift"), screenshot, ...bounds.map(String)], { timeout: 45000, maxBuffer: 4096 });
        return { cents: parseBalance(JSON.parse(stdout).amount), checkedAt };
      } catch (error) {
        if (attempt === 14 || error.killed) throw error;
        // The screen capture can fail while the balance is still loading.
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
