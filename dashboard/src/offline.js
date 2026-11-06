import { couponStatus, expiring } from "../../src/dates.js";

const storageKey = "cc-coupons-state-v1";
const unavailable = "Não foi possível carregar os cupões. Ligue o Tailscale e confirme que o Mac está ligado.";

export function rememberCard(accountId, card, serverNow) {
  try {
    const snapshot = JSON.parse(localStorage.getItem(storageKey));
    if (!snapshot?.data?.accounts) return;
    snapshot.data.accounts = snapshot.data.accounts.map((account) => account.id === accountId ? { ...account, card } : account);
    snapshot.data.serverNow = serverNow;
    snapshot.data.clockOffsetMs = serverNow - Date.now();
    localStorage.setItem(storageKey, JSON.stringify(snapshot));
  } catch {
    // A live authorization remains usable when device storage is unavailable.
  }
}

export async function readState(signal) {
  let response;
  try {
    response = await fetch("/api/state", {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  if (response?.ok) {
    const data = await response.json();
    data.clockOffsetMs = Number.isFinite(data.serverNow) ? data.serverNow - Date.now() : 0;
    const savedAt = new Date().toISOString();
    let saved = true;
    try {
      let previous;
      try { previous = JSON.parse(localStorage.getItem(storageKey)); } catch {}
      if (previous?.data?.serverNow > data.serverNow)
        return { ...previous.data, savedAt: previous.savedAt, saved: true, offline: false };
      localStorage.setItem(storageKey, JSON.stringify({ data, savedAt }));
    } catch {
      saved = false;
    }
    return { ...data, savedAt, saved, offline: false };
  }
  // An explicit access denial must not masquerade as a network outage.
  if (response && response.status < 500) throw new Error(unavailable);
  try {
    const snapshot = JSON.parse(localStorage.getItem(storageKey));
    const data = snapshot?.data;
    if (data && Number.isFinite(Date.parse(snapshot.savedAt)) &&
        [data.accounts, data.coupons, data.events, data.notifications].every(Array.isArray)) {
      const now = new Date();
      return {
        ...data, savedAt: snapshot.savedAt, saved: true, offline: true, running: false,
        coupons: data.coupons.map((coupon) => ({
          ...coupon,
          status: couponStatus(coupon, coupon.present, now),
          isNew: now - new Date(coupon.firstSeen) < 48 * 3600000,
          expiring: !!coupon.present && coupon.used !== true && expiring(coupon, now),
        })),
      };
    }
  } catch {
    // Storage may be disabled, full, or left over from an incompatible version.
  }
  throw new Error(unavailable);
}
