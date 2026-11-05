import test from "node:test";
import assert from "node:assert/strict";
import { readState } from "../dashboard/src/offline.js";

function mockStorage(t, storage) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  });
}

test("Offline snapshots retain their timestamp, expire coupons, and never report an old check as running", async (t) => {
  let stored;
  mockStorage(t, {
    getItem: () => stored,
    setItem: (_key, value) => { stored = value; },
  });
  const data = {
    accounts: [], events: [], notifications: [], running: true,
    coupons: [{
      present: true, used: false, status: "available", isNew: true, expiring: true,
      startDate: "2020-01-01", endDate: "2020-01-02", firstSeen: "2020-01-01T12:00:00Z",
    }],
  };
  const request = t.mock.method(globalThis, "fetch", async () => Response.json(data));
  const live = await readState();
  assert.equal(live.offline, false);
  assert.equal(live.saved, true);
  request.mock.mockImplementation(async () => { throw new TypeError("Offline"); });
  const offline = await readState();
  assert.equal(offline.offline, true);
  assert.equal(offline.savedAt, live.savedAt);
  assert.equal(offline.running, false);
  assert.equal(offline.coupons[0].status, "expired");
  assert.equal(offline.coupons[0].isNew, false);
  assert.equal(offline.coupons[0].expiring, false);
  request.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  assert.equal((await readState()).offline, true);
  request.mock.mockImplementation(async () => new Response(null, { status: 403 }));
  await assert.rejects(readState(), /Não foi possível/);
  request.mock.mockImplementation(async () => { throw new TypeError("Offline"); });
  stored = "invalid JSON";
  await assert.rejects(readState(), /Não foi possível/);
  stored = JSON.stringify({ data: {}, savedAt: new Date().toISOString() });
  await assert.rejects(readState(), /Não foi possível/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readState(controller.signal), /Offline/);
});

test("Unavailable device storage does not break live coupon access", async (t) => {
  mockStorage(t, {
    getItem: () => { throw new Error("Storage disabled"); },
    setItem: () => { throw new Error("Storage full"); },
  });
  const request = t.mock.method(globalThis, "fetch", async () => Response.json({ coupons: [] }));
  assert.equal((await readState()).saved, false);
  request.mock.mockImplementation(async () => { throw new TypeError("Offline"); });
  await assert.rejects(readState(), /Não foi possível/);
});
