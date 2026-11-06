import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { openAndroid, androidTarget } from "./android.js";
import { dataDir, root, prepareData } from "./config.js";
import { CheckError } from "./extraction.js";
import { acquireLock } from "./lock.js";

const execute = promisify(execFile);
const visible = (node) => !node.hidden && !node["off-screen"];
const label = (node) => node.text || node["content-desc"] || "";

export async function openCardScreen(device) {
  let nodes = await device.waitFor((ns) => ns.some((n) => n["resource-id"] === "UseCardLink" && visible(n)));
  await device.tap(nodes.find((n) => n["resource-id"] === "UseCardLink" && visible(n)), nodes);
  nodes = await device.waitFor((ns) => ns.some((n) => label(n) === "UseCardCode") ||
    ns.some((n) => /-Skip$/.test(n["resource-id"] || "") && label(n) === "Saltar" && visible(n)));
  const skip = nodes.find((n) => /-Skip$/.test(n["resource-id"] || "") && label(n) === "Saltar" && visible(n));
  if (skip) await device.tap(skip, nodes);
  return device.waitFor((ns) => ns.some((n) => label(n) === "UseCardCode") &&
    ns.some((n) => n["resource-id"] === "UniqueCodeParentContainer" && visible(n)) &&
    ns.some((n) => label(n) === "codigo de barras" && visible(n)));
}

export function cardBounds(nodes) {
  const bounds = (node) => node?.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.slice(1).map(Number);
  const card = bounds(nodes.find((n) => n["resource-id"] === "UniqueCodeParentContainer" && visible(n)));
  const screen = bounds(nodes.find((n) => label(n) === "UseCardCode" && visible(n)));
  if (!card || !screen || screen[0] !== 0 || screen[1] !== 0 ||
      ![...card, ...screen].every(Number.isSafeInteger) || card[2] <= card[0] || card[3] <= card[1] ||
      card[2] > screen[2] || card[3] > screen[3]) throw new CheckError("LAYOUT_CHANGED");
  return [...card, screen[2], screen[3]];
}

export async function activateCard(db, accountId, openDevice = openAndroid) {
  androidTarget(accountId);
  const release = acquireLock(db);
  let device, directory;
  try {
    const existing = db.prepare("SELECT expires_at AS expiresAt FROM card_sessions WHERE account_id=?").get(accountId);
    if (existing?.expiresAt > Date.now()) return existing;
    device = await openDevice(accountId);
    const bounds = cardBounds(await openCardScreen(device));
    prepareData();
    directory = await mkdtemp(path.join(dataDir, ".card-"));
    const screenshot = path.join(directory, "screen.png"), cropped = path.join(directory, "card.png");
    const capturedAt = Date.now();
    await writeFile(screenshot, await device.capture(), { mode: 0o600 });
    let remainingSeconds;
    try {
      const { stdout } = await execute("/usr/bin/swift", [path.join(root, "src/read-card.swift"), screenshot, cropped, ...bounds.map(String)], { timeout: 45000, maxBuffer: 4096 });
      ({ remainingSeconds } = JSON.parse(stdout));
    } catch { throw new CheckError("CARD_UNCONFIRMED"); }
    if (!Number.isInteger(remainingSeconds) || remainingSeconds < 1 || remainingSeconds > 600)
      throw new CheckError("CARD_UNCONFIRMED");
    // Round down so capture and recognition latency never extend the authorization.
    const expiresAt = capturedAt + (remainingSeconds - 1) * 1000;
    if (expiresAt <= Date.now()) throw new CheckError("CARD_EXPIRED");
    db.prepare("INSERT INTO card_sessions VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET expires_at=excluded.expires_at,image=excluded.image")
      .run(accountId, expiresAt, await readFile(cropped));
    return { expiresAt };
  } finally {
    try { await device?.close(); }
    finally {
      release();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
}
