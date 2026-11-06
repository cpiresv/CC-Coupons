import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dataDir } from "./config.js";
import { parseDateRange } from "./dates.js";
import { CheckError } from "./extraction.js";

const execute = promisify(execFile);
const activity = "pt.continente.ContinenteTelemovel/.MainActivity";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const label = (node) => node.text || node["content-desc"] || "";

export function androidTarget(accountId) {
  const port = { "account-1": 5558, "account-2": 5560, "account-3": 5556 }[accountId];
  if (!Number.isInteger(port)) throw new CheckError("INVALID_ACCOUNT");
  return {
    port: String(port), serial: `emulator-${port}`,
    avd: `cc_coupons_${accountId.replaceAll("-", "_")}`,
    profile: path.join(dataDir, "android", `${accountId}.avd`),
  };
}

export function layoutNodes(tree) {
  if (!Array.isArray(tree)) throw new CheckError("LAYOUT_CHANGED");
  const nodes = [];
  const visit = (items, depth = 0) => {
    if (!Array.isArray(items) || depth > 100) throw new CheckError("LAYOUT_CHANGED");
    for (const node of items) {
      if (!node || typeof node !== "object" || nodes.length >= 20000)
        throw new CheckError("LAYOUT_CHANGED");
      nodes.push(node);
      for (const key of ["content", "children"])
        if (node[key]) visit(node[key], depth + 1);
    }
  };
  visit(tree);
  return nodes;
}

export function parseAndroidCoupon(nodes, brand) {
  const field = (suffix) => {
    const found = nodes.filter((n) => n["resource-id"]?.endsWith(suffix));
    if (found.length !== 1) throw new CheckError("LAYOUT_CHANGED");
    return label(found[0]).trim();
  };
  try {
    if (!nodes.some((n) => label(n) === "CouponDetail")) throw Error();
    const code = field("-VoucherCode").match(/^Código:\s*(\d+)$/u)?.[1];
    const description = field("-ConditionsContainer").replace(/\s+/g, " ");
    const amount = field("-Image").match(/^Desconto (\d+(?:[.,]\d+)?)\s*(%|€) em Cartão na marca /u);
    const dates = parseDateRange(field("-Date"));
    if (!code || !description || !amount || !brand?.trim()) throw Error();
    const discount = amount[1].replace(".", ",") + (amount[2] === "%" ? "%" : " €");
    const minimum = description.match(/(?:COMPRA|ABASTECIMENTO) SUPERIOR A (\d+(?:[,.]\d+)?)\s*(€|EUR|L)(?=\s|[.,]|$)/u);
    return {
      key: `${brand}:${code}:${dates.startDate}`, code, brand,
      title: description, description, ...dates, discount,
      discountSource: "android-accessibility", imageUrl: null,
      minimumPurchase: minimum ? `Superior a ${minimum[1]} ${minimum[2] === "EUR" ? "€" : minimum[2]}` : null,
      activationRequired: null, activated: null, used: null,
    };
  } catch {
    throw new CheckError("LAYOUT_CHANGED");
  }
}

function carousel(nodes) {
  const slide = nodes.find((n) => /^splide\d+-slide\d+$/.test(n["resource-id"] || "") && /^\d+ of \d+$/.test(label(n)));
  const position = slide && label(slide).match(/^(\d+) of (\d+)$/);
  if (!position) throw new CheckError("LAYOUT_CHANGED");
  return { index: Number(position[1]), total: Number(position[2]) };
}

export function couponTapRange([, top, , bottom], cardTop) {
  if (![top, bottom, cardTop].every(Number.isFinite) || cardTop <= top || cardTop >= bottom)
    throw new CheckError("LAYOUT_CHANGED");
  const margin = (bottom - top) * .05;
  return [top + margin, cardTop - margin];
}

export function couponBackPoint(node) {
  if (!node?.["resource-id"]?.endsWith("-Back") || label(node) !== "Voltar página anterior" || node.hidden || node["off-screen"])
    return null;
  const point = node.center?.match(/^\[(\d+),(\d+)\]$/)?.slice(1).map(Number);
  const bounds = node.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.slice(1).map(Number);
  if (!point || !bounds || ![...point, ...bounds].every(Number.isSafeInteger)) return null;
  const [x, y] = point, [left, top, right, bottom] = bounds;
  return x > left && x < right && y > top && y < bottom ? point : null;
}

export function couponNavigationSwipe(nodes, id) {
  const node = nodes.find((n) => n["resource-id"] === id);
  const bounds = (n) => n?.bounds?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/)?.slice(1).map(Number);
  const content = bounds(nodes.find((n) => n["resource-id"] === "b1-Content"));
  if (!node || !content || content[2] <= content[0]) throw new CheckError("LAYOUT_CHANGED");
  const [left, top, right, bottom] = content;
  const [safeTop, safeBottom] = couponTapRange(content, bounds(nodes.find((n) => n["resource-id"] === "UseCardLink"))?.[1]);
  const center = (n) => n?.center?.match(/^\[(-?\d+),(-?\d+)\]$/)?.slice(1).map(Number) || [];
  const [x, y] = center(node);
  const visible = (n) => !n.hidden && !n["off-screen"];
  const storeTab = id.endsWith("-SelectInsigniaLink2");
  const row = nodes.find((n) => n["resource-id"] === "InsigniaList");
  const rowBounds = bounds(row);
  const rowY = center(row)[1];
  // Reveal the store row vertically before swiping within its horizontal viewport.
  if (storeTab && rowBounds && visible(row) && rowY > safeTop && rowY < safeBottom) {
    const start = Math.max(left, rowBounds[0]), end = Math.min(right, rowBounds[2]);
    if (end <= start) throw new CheckError("LAYOUT_CHANGED");
    const inset = (end - start) * .05;
    const reachable = (n) => {
      const [nx, ny] = center(n);
      return visible(n) && nx > start + inset && nx < end - inset && ny > safeTop && ny < safeBottom;
    };
    if (reachable(node)) return null;
    const tabs = nodes.filter((n) => n["resource-id"]?.endsWith("-SelectInsigniaLink2"));
    const firstVisible = tabs.findIndex(reachable);
    if (firstVisible < 0) throw new CheckError("LAYOUT_CHANGED");
    const towardsLeft = x <= start + inset || tabs.indexOf(node) < firstVisible;
    return [start + (end - start) * (towardsLeft ? .2 : .8), rowY,
      start + (end - start) * (towardsLeft ? .8 : .2), rowY].map(Math.round);
  }
  if (!storeTab && visible(node) && y > safeTop && y < safeBottom) return null;
  const links = nodes.filter((n) => /-(seeDetail2?|SelectInsigniaLink2)$/.test(n["resource-id"] || ""));
  const firstVisible = links.findIndex((n) => n.bounds && visible(n));
  const up = storeTab || y <= safeTop || (firstVisible >= 0 && links.indexOf(node) < firstVisible);
  const swipeX = left + (right - left) * .7;
  return [swipeX, top + (bottom - top) * (up ? .35 : .65),
    swipeX, top + (bottom - top) * (up ? .65 : .35)].map(Math.round);
}

async function navigate(device, nodes, node, predicate) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await device.tap(node, nodes);
      return await device.waitFor(predicate, { timeout: 15000 });
    }
    catch (error) {
      const missingTarget = error.code === "ANDROID_UNAVAILABLE" && /No matching elements/.test(error.cause?.stderr || "");
      if ((error.code !== "LAYOUT_CHANGED" && !missingTarget) || attempt === 2) throw error;
      nodes = await device.read();
      if (predicate(nodes)) return nodes;
      node = nodes.find((n) => n["resource-id"] === node["resource-id"]);
      if (!node) return device.waitFor(predicate);
    }
  }
}

export async function collectAndroidCoupons(device) {
  let nodes = await device.waitFor((ns) => ns.some((n) => /-CouponsLink$/.test(n["resource-id"] || "")));
  nodes = await navigate(device, nodes, nodes.find((n) => /-CouponsLink$/.test(n["resource-id"] || "")), (ns) => ns.some((n) => /-SelectInsigniaLink2$/.test(n["resource-id"] || "")));
  const brands = nodes.filter((n) => /-SelectInsigniaLink2$/.test(n["resource-id"] || "")).map(label);
  if (!brands.length || brands.length > 30 || new Set(brands).size !== brands.length)
    throw new CheckError("LAYOUT_CHANGED");
  const coupons = [];
  for (const brand of brands) {
    const tab = nodes.find((n) => /-SelectInsigniaLink2$/.test(n["resource-id"] || "") && label(n) === brand);
    if (!tab) throw new CheckError("LAYOUT_CHANGED");
    nodes = await navigate(device, nodes, tab, (ns) => ns.some((n) => /-seeDetail2?$/.test(n["resource-id"] || "")) && ns.some((n) => label(n).startsWith("Desconto ") && label(n).includes(`na marca ${brand}`)));
    const expected = new Set(nodes.filter((n) => /-seeDetail2?$/.test(n["resource-id"] || "")).map((n) => n["resource-id"])).size;
    if (!expected || expected > 100) throw new CheckError("UNVERIFIED_EMPTY_STATE");
    for (let index = 0; index < expected; index++) {
      const links = nodes.filter((n) => /-seeDetail2?$/.test(n["resource-id"] || ""));
      if (links.length !== expected) throw new CheckError("LAYOUT_CHANGED");
      let coupon;
      nodes = await navigate(device, nodes, links[index], (ns) => {
        try {
          if (carousel(ns).total !== expected) return false;
          if (!ns.some((n) => n["resource-id"]?.endsWith("-Back") && label(n) === "Voltar página anterior" && !n.hidden && !n["off-screen"])) return false;
          const insignia = ns.find((n) => n["resource-id"]?.endsWith("-InsigniaImage"));
          if (!insignia || !label(insignia).startsWith(brand)) return false;
          coupon = parseAndroidCoupon(ns, brand);
          return true;
        } catch { return false; }
      });
      coupons.push(coupon);
      nodes = await navigate(device, nodes, nodes.find((n) => n["resource-id"]?.endsWith("-Back") && label(n) === "Voltar página anterior" && !n.hidden && !n["off-screen"]), (ns) => ns.some((n) => label(n) === "CouponsList") && ns.filter((n) => /-seeDetail2?$/.test(n["resource-id"] || "")).length === expected);
    }
  }
  if (new Set(coupons.map((c) => c.key)).size !== coupons.length)
    throw new CheckError("DUPLICATE_COUPONS");
  return coupons;
}

export async function waitForAndroid(device, predicate, { timeout = 45000, manualLogin = false } = {}) {
  const until = Date.now() + timeout;
  let readError, networkRetries = 0;
  while (Date.now() < until) {
    let nodes;
    try {
      nodes = await device.read();
      readError = undefined;
    } catch (error) {
      if (error.code !== "TIMEOUT" && !(error.code === "ANDROID_UNAVAILABLE" &&
          /Could not obtain layout root/.test(error.cause?.stderr || ""))) throw error;
      readError = error;
      await pause(500);
      continue;
    }
    const offlinePage = nodes.some((n) => label(n) === "Ocorreu um erro!") && nodes.some((n) => label(n).startsWith("Mesmo sem ligação"));
    if (offlinePage || nodes.some((n) => /Code:\s*\((?:CECE001|OEAE001)\)/i.test(label(n)) && /connection has timed out|Não estamos a conseguir estabelecer ligação/i.test(label(n)))) {
      readError = new CheckError("NETWORK_ERROR");
      const retry = nodes.find((n) => label(n) === "Tentar Novamente" && !n.hidden && !n["off-screen"]);
      if (!retry || networkRetries++ >= 2) throw readError;
      await device.tap(retry, nodes);
      continue;
    }
    if (predicate(nodes)) return nodes;
    if (!manualLogin && nodes.some((n) => /^(Iniciar sessão|Entrar|Número de telemóvel|Código SMS)$/iu.test(label(n))))
      throw new CheckError("AUTH_REQUIRED");
    await pause(500);
  }
  throw readError || new CheckError("LAYOUT_CHANGED");
}

export async function openAndroid(accountId, { headed = false } = {}) {
  const { port, serial, avd, profile } = androidTarget(accountId);
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), "Library/Android/sdk");
  const adbPath = path.join(sdk, "platform-tools/adb");
  const cli = path.join(sdk, "cmdline-tools/latest/bin/android");
  const emulator = path.join(sdk, "emulator/emulator");
  const directory = path.join(dataDir, "android");
  const env = { ...process.env, ANDROID_HOME: sdk, ADB_MDNS: "0" };
  if (!env.JAVA_HOME) env.JAVA_HOME = ["/opt/homebrew", "/usr/local"].map((p) => `${p}/opt/openjdk/libexec/openjdk.jdk/Contents/Home`).find(existsSync);
  if (![adbPath, cli, emulator].every(existsSync)) throw new CheckError("ANDROID_SETUP_REQUIRED");
  let definition;
  try { definition = await readFile(path.join(process.env.ANDROID_AVD_HOME || path.join(os.homedir(), ".android/avd"), `${avd}.ini`), "utf8"); } catch { throw new CheckError("ANDROID_SETUP_REQUIRED"); }
  if (path.resolve(definition.match(/^path=(.+)$/m)?.[1] || "/") !== profile)
    throw new CheckError("ANDROID_DEVICE_MISMATCH");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(path.join(directory, `.check-${accountId}-`));
  let child, owned = false, verified = false, sequence = 0;
  const run = async (program, args, timeout = 30000) => {
    try { return (await execute(program, args, { env, timeout, maxBuffer: 2 * 1024 * 1024 })).stdout; }
    catch (error) {
      const failure = new CheckError(error.killed ? "TIMEOUT" : "ANDROID_UNAVAILABLE");
      failure.cause = error;
      throw failure;
    }
  };
  const adb = (args, timeout) => run(adbPath, ["-s", serial, ...args], timeout);
  const android = (args) => run(cli, ["--no-metrics", `--sdk=${sdk}`, ...args]);
  const close = async () => {
    if (owned) {
      if (verified) {
        await adb(["shell", "sync"]).catch(() => {});
        await adb(["emu", "kill"]).catch(() => {});
      }
      else child?.kill("SIGTERM");
      const until = Date.now() + 20000;
      while (child && child.exitCode === null && child.signalCode === null && Date.now() < until) await pause(250);
    }
    await rm(temporary, { recursive: true, force: true });
  };
  try {
    const devices = await run(adbPath, ["devices"]);
    if (headed && devices.split("\n").some((line) => line.startsWith(`${serial}\t`)))
      throw new CheckError("ANDROID_DEVICE_BUSY");
    if (!devices.split("\n").some((line) => line.startsWith(`${serial}\t`))) {
      const log = await open(path.join(directory, `${accountId}-emulator.log`), "a", 0o600);
      try {
        // Separate virtual networks avoid shared Wi-Fi conflicts between accounts.
        child = spawn(emulator, ["-avd", avd, "-port", port, "-gpu", "host", "-feature", "-WiFiPacketStream", "-no-metrics", "-crash-report-mode", "never", "-no-snapshot", ...(!headed ? ["-no-window"] : []), "-no-audio", "-no-boot-anim", "-camera-back", "none", "-camera-front", "none", "-timezone", "Europe/Lisbon"], { env, stdio: ["ignore", log.fd, log.fd] });
        await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
        owned = true;
      } finally { await log.close(); }
    }
    const until = Date.now() + 120000;
    while (true) {
      if (owned && (child.exitCode !== null || child.signalCode !== null)) throw new CheckError("ANDROID_UNAVAILABLE");
      const ready = await adb(["shell", "getprop", "sys.boot_completed"], 5000).catch(() => "");
      if (ready.trim() === "1") break;
      if (Date.now() >= until) throw new CheckError("TIMEOUT");
      await pause(1000);
    }
    if ((await adb(["emu", "avd", "name"])).split(/\r?\n/)[0] !== avd)
      throw new CheckError("ANDROID_DEVICE_MISMATCH");
    verified = true;
    if (!(await adb(["shell", "pm", "list", "packages", "pt.continente.ContinenteTelemovel"])).includes("package:pt.continente.ContinenteTelemovel"))
      throw new CheckError("ANDROID_SETUP_REQUIRED");
    await adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
    await adb(["shell", "svc", "power", "stayon", "true"]);
    await adb(["shell", "am", "force-stop", "pt.continente.ContinenteTelemovel"]);
    await adb(["shell", "am", "start", "-n", activity]);
    const device = {
      source: "android", close,
      async read() {
        const filename = path.join(temporary, `${++sequence}.json`);
        await android(["layout", "--no-idle", "--full", `--device=${serial}`, `--output=${filename}`]);
        const raw = await readFile(filename, "utf8");
        if (raw.length > 10 * 1024 * 1024) throw new CheckError("LAYOUT_CHANGED");
        return layoutNodes(JSON.parse(raw));
      },
      waitFor: (predicate, options) => waitForAndroid(device, predicate, options),
      async tap(node, nodes) {
        if (!node || !/^[\w:/-]+$/.test(node["resource-id"] || "")) throw new CheckError("LAYOUT_CHANGED");
        const id = node["resource-id"];
        const listLink = /-(seeDetail2?|SelectInsigniaLink2)$/.test(id);
        for (let attempt = 0; listLink || node.hidden || node["off-screen"]; attempt++) {
          if (attempt >= 20 || !/-(seeDetail2?|SelectInsigniaLink2)$/.test(id)) throw new CheckError("LAYOUT_CHANGED");
          nodes ||= await device.read();
          let swipe;
          try { swipe = couponNavigationSwipe(nodes, id); }
          catch (error) {
            if (error.code !== "LAYOUT_CHANGED") throw error;
            // List entries can appear before their container has finished laying out.
            nodes = await device.read();
            swipe = couponNavigationSwipe(nodes, id);
          }
          if (!swipe) break;
          await adb(["shell", "input", "touchscreen", "swipe", ...swipe.map(String), "1000"]);
          nodes = undefined;
        }
        const point = couponBackPoint(nodes?.find((n) => n["resource-id"] === id));
        if (point) return adb(["shell", "input", "touchscreen", "tap", ...point.map(String)]);
        await android(["input", `--device=${serial}`, "tap", "--wait=10000", `id=/^${node["resource-id"].replaceAll("/", "\\/")}$/`]);
      },
      async screenshot() {
        try {
          const { stdout } = await execute(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { env, encoding: "buffer", timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
          await writeFile(path.join(directory, `${accountId}-last-error.png`), stdout, { mode: 0o600 });
        } catch {}
      },
    };
    return device;
  } catch (error) {
    await close();
    throw error instanceof CheckError ? error : new CheckError("ANDROID_UNAVAILABLE");
  }
}

export async function checkAndroid(accountId) {
  const device = await openAndroid(accountId);
  try { return await collectAndroidCoupons(device); }
  catch (error) {
    await device.screenshot();
    await writeFile(path.join(dataDir, "android", `${accountId}-last-error.json`), JSON.stringify({ code: error.code, stack: error.stack, detail: error.cause?.stderr }), { mode: 0o600 }).catch(() => {});
    throw error;
  }
  finally { await device.close(); }
}

export async function authenticateAndroid(accountId, onReady = () => {}) {
  const device = await openAndroid(accountId, { headed: true });
  try {
    onReady();
    await device.waitFor((ns) => ns.some((n) => /-CouponsLink$/.test(n["resource-id"] || "")), { timeout: 15 * 60 * 1000, manualLogin: true });
  } finally { await device.close(); }
}
