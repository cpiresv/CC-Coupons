import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAndroidDiscount } from "../src/discount.js";

const execute = promisify(execFile);
test("Image recognition confirms missing discount units and rejects mismatched, ambiguous or out-of-region amounts", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cc-discount-test-"));
  try {
    const filename = path.join(directory, "screen.png");
    const image = { "resource-id": "coupon-Image", "content-desc": "DESCONTO 15.00000000 EM CARTão NA MARCA Wells Ótica", bounds: "[200,300][450,600]" };
    const screen = { class: "android.webkit.WebView", bounds: "[0,0][600,1000]" };
    const device = { capture: () => readFile(filename) };
    for (const [visible, expected, discount] of [["15%", "15.00000000", "15%"], ["75 €", "75.00000000", "75 €"], ["0,10 €", "0.10000000", "0,10 €"]]) {
      await execute("/usr/bin/swift", ["test/fixtures/discount-image.swift", filename, visible]);
      image["content-desc"] = `DESCONTO ${expected} EM CARTão NA MARCA Wells`;
      assert.equal(await readAndroidDiscount(device, [screen, image]), discount);
    }
    image["content-desc"] = "DESCONTO 15.00000000 EM CARTão NA MARCA Wells";
    await assert.rejects(readAndroidDiscount(device, [screen, image]), { code: "DISCOUNT_UNCONFIRMED" });
    for (const text of ["15", "", "15% 20%"] ) {
      await execute("/usr/bin/swift", ["test/fixtures/discount-image.swift", filename, text]);
      await assert.rejects(readAndroidDiscount(device, [screen, image]), { code: "DISCOUNT_UNCONFIRMED" });
    }
    await execute("/usr/bin/swift", ["test/fixtures/discount-image.swift", filename, "15%", "20%"]);
    await assert.rejects(readAndroidDiscount(device, [screen, image]), { code: "DISCOUNT_UNCONFIRMED" });
    for (const nodes of [[screen, image, image], [screen, { ...image, hidden: true }], [screen, { ...image, bounds: "[200,300][601,600]" }], [image]])
      await assert.rejects(readAndroidDiscount(device, nodes), { code: "DISCOUNT_UNCONFIRMED" });

    const capturedScreen = { ...screen, bounds: "[0,0][260,315]" };
    const capturedImage = { ...image, bounds: "[0,0][260,315]", "content-desc": "DESCONTO 30.00000000 EM CARTão NA MARCA Wells Ótica" };
    const capture = name => ({ capture: () => readFile(`test/fixtures/${name}.png`) });
    assert.equal(await readAndroidDiscount(capture("wells-30-captured"), [capturedScreen, capturedImage]), "30 €");
    assert.equal(await readAndroidDiscount(capture("wells-30-account3"), [capturedScreen, capturedImage]), "30 €");
    for (const fixture of ["wells-15-captured", "wells-30-altered-unit"])
      await assert.rejects(readAndroidDiscount(capture(fixture), [capturedScreen, capturedImage]), { code: "DISCOUNT_UNCONFIRMED" });
    capturedImage["content-desc"] = "DESCONTO 15.00000000 EM CARTão NA MARCA Wells Ótica";
    assert.equal(await readAndroidDiscount(capture("wells-15-captured"), [capturedScreen, capturedImage]), "15%");
    assert.equal(await readAndroidDiscount(capture("wells-15-account3"), [capturedScreen, capturedImage]), "15%");
    await assert.rejects(readAndroidDiscount(capture("wells-30-captured"), [capturedScreen, capturedImage]), { code: "DISCOUNT_UNCONFIRMED" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
