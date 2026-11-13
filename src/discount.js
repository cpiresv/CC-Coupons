import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { dataDir, root, prepareData } from "./config.js";
import { CheckError } from "./extraction.js";

const execute = promisify(execFile);

export async function readAndroidDiscount(device, nodes) {
  const images = nodes.filter(n => n["resource-id"]?.endsWith("-Image"));
  const image = images.length === 1 && images[0];
  const expected = (image?.text || image?.["content-desc"] || "").match(/^Desconto (\d+(?:[.,]\d+)?) em Cartão na marca .+$/iu)?.[1];
  const bounds = node => node?.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.slice(1).map(Number);
  const region = bounds(image);
  const screen = bounds(nodes.find(n => n.class === "android.webkit.WebView" && !n.hidden && !n["off-screen"]));
  if (!expected || !region || !screen || image.hidden || image["off-screen"] || screen[0] !== 0 || screen[1] !== 0 ||
      ![...region, ...screen].every(Number.isSafeInteger) || region[2] <= region[0] || region[3] <= region[1] ||
      region[2] > screen[2] || region[3] > screen[3]) throw new CheckError("DISCOUNT_UNCONFIRMED");
  prepareData();
  const directory = await mkdtemp(path.join(dataDir, ".discount-"));
  try {
    const filename = path.join(directory, "screen.png");
    await writeFile(filename, await device.capture(), { mode: 0o600 });
    const { stdout } = await execute("/usr/bin/swift", [path.join(root, "src/read-discount.swift"), filename, ...region.map(String), ...screen.slice(2).map(String)], { timeout: 45000, maxBuffer: 4096 });
    const amount = JSON.parse(stdout).discount?.match(/^(\d+(?:[.,]\d+)?)\s*(%|€)$/u);
    if (!amount || !Number.isFinite(Number(expected.replace(",", "."))) ||
        Number(amount[1].replace(",", ".")) !== Number(expected.replace(",", "."))) throw new CheckError("DISCOUNT_UNCONFIRMED");
    return amount[1].replace(".", ",") + (amount[2] === "%" ? "%" : " €");
  } catch (error) {
    throw Object.assign(new CheckError("DISCOUNT_UNCONFIRMED"), { cause: error });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
