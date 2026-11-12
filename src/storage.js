import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import path from "node:path";
import { accounts, dataDir, prepareData } from "./config.js";
import { couponStatus, expiring } from "./dates.js";

export function openStore(filename = path.join(dataDir, "coupons.sqlite")) {
  if (filename !== ":memory:") prepareData();
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, auth TEXT NOT NULL DEFAULT 'unknown', last_success TEXT, last_attempt TEXT, failures INTEGER NOT NULL DEFAULT 0, error TEXT, episode INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS coupons (account_id TEXT NOT NULL REFERENCES accounts(id), key TEXT NOT NULL, payload TEXT NOT NULL, fingerprint TEXT NOT NULL, present INTEGER NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, changed_at TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(account_id,key));
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), coupon_key TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL, previous TEXT);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, message TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, sent_at TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS operation_lock (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, owner TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS card_sessions (account_id TEXT PRIMARY KEY REFERENCES accounts(id), expires_at INTEGER NOT NULL, image BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS account_balances (account_id TEXT PRIMARY KEY REFERENCES accounts(id), cents INTEGER CHECK(cents>=0), checked_at TEXT, error INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS balance_changes (id INTEGER PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), previous_cents INTEGER NOT NULL CHECK(previous_cents>=0), cents INTEGER NOT NULL CHECK(cents>=0 AND cents<>previous_cents), checked_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  if (filename !== ":memory:") chmodSync(filename, 0o600);
  for (const a of accounts)
    db.prepare(
      "INSERT INTO accounts(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
    ).run(a.id, a.name);
  return db;
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function fingerprint(coupon) {
  const { imageUrl, discountSource, ...fields } = coupon;
  if (!coupon.discount) fields.imageUrl = imageUrl;
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}
export function enqueue(db, id, message, now = new Date()) {
  db.prepare(
    "INSERT OR IGNORE INTO outbox(id,message,created_at) VALUES(?,?,?)",
  ).run(id, message.slice(0, 3900), now.toISOString());
}
export function saveBalance(db, accountId, balance) {
  if (balance === null) {
    db.prepare("INSERT INTO account_balances(account_id,error) VALUES(?,1) ON CONFLICT(account_id) DO UPDATE SET error=1").run(accountId);
    return;
  }
  if (!Number.isSafeInteger(balance?.cents) || balance.cents < 0 ||
      typeof balance.checkedAt !== "string" || !Number.isFinite(Date.parse(balance.checkedAt)))
    throw new Error("INVALID_BALANCE");
  transaction(db, () => {
    const previous = db.prepare("SELECT cents,checked_at FROM account_balances WHERE account_id=?").get(accountId);
    if (previous?.checked_at && Date.parse(previous.checked_at) >= Date.parse(balance.checkedAt)) return;
    if (previous?.cents != null && previous.cents !== balance.cents) {
      db.prepare("INSERT INTO balance_changes(account_id,previous_cents,cents,checked_at) VALUES(?,?,?,?)")
        .run(accountId, previous.cents, balance.cents, balance.checkedAt);
    }
    db.prepare("INSERT INTO account_balances VALUES(?,?,?,0) ON CONFLICT(account_id) DO UPDATE SET cents=excluded.cents,checked_at=excluded.checked_at,error=0")
      .run(accountId, balance.cents, balance.checkedAt);
  });
}
export function saveSnapshot(db, accountId, coupons, now = new Date()) {
  if (!Array.isArray(coupons) || !coupons.length)
    throw new Error("UNVERIFIED_EMPTY_STATE");
  if (new Set(coupons.map((c) => c.key)).size !== coupons.length)
    throw new Error("DUPLICATE_COUPONS");
  return transaction(db, () => {
    const at = now.toISOString();
    const changes = [];
    const account = db
      .prepare("SELECT * FROM accounts WHERE id=?")
      .get(accountId);
    if (!account) throw new Error("UNKNOWN_ACCOUNT");
    const previous = new Map(
      db
        .prepare("SELECT * FROM coupons WHERE account_id=?")
        .all(accountId)
        .map((c) => [c.key, c]),
    );
    const event = (c, kind, old, revision) => {
      const payload = JSON.stringify(c);
      const info = db
        .prepare(
          "INSERT INTO events(account_id,coupon_key,kind,at,payload,previous) VALUES(?,?,?,?,?,?)",
        )
        .run(accountId, c.key, kind, at, payload, old?.payload || null);
      changes.push({ key: c.key, kind });
      if (["new", "changed", "returned"].includes(kind))
        enqueue(
          db,
          `event:${info.lastInsertRowid}`,
          `${account.name} · ${kind === "changed" ? "Cupão alterado" : "Novo cupão"}\n${c.brand} · ${c.discount || "Desconto na imagem"}\n${c.description}\n${c.startDate} → ${c.endDate}\nCódigo: ${c.code}`,
          now,
        );
      return revision;
    };
    for (const c of coupons) {
      if (!c.key || !c.code || !c.startDate || !c.endDate)
        throw new Error("INVALID_COUPON");
      const old = previous.get(c.key);
      const hash = fingerprint(c);
      const kind = !old
        ? "new"
        : !old.present
          ? "returned"
          : old.fingerprint !== hash
            ? "changed"
            : null;
      const revision = (old?.revision || 0) + (kind ? 1 : 0);
      if (kind) event(c, kind, old, revision);
      db.prepare(
        `INSERT INTO coupons VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,key) DO UPDATE SET payload=excluded.payload,fingerprint=excluded.fingerprint,present=1,last_seen=excluded.last_seen,changed_at=excluded.changed_at,revision=excluded.revision`,
      ).run(
        accountId,
        c.key,
        JSON.stringify(c),
        hash,
        1,
        old?.first_seen || at,
        at,
        kind ? at : old.changed_at,
        revision,
      );
      previous.delete(c.key);
      if (expiring(c, now) && c.used !== true)
        enqueue(
          db,
          `expiry:${accountId}:${c.key}:${c.endDate}`,
          `${account.name} · Expira em 48 horas\n${c.brand} · ${c.discount || "Desconto na imagem"}\n${c.description}\nVálido até ${c.endDate}\nCódigo: ${c.code}`,
          now,
        );
    }
    for (const old of previous.values())
      if (old.present) {
        const c = JSON.parse(old.payload);
        event(
          c,
          couponStatus(c, false, now) === "expired" ? "expired" : "removed",
          old,
          old.revision + 1,
        );
        db.prepare(
          "UPDATE coupons SET present=0,changed_at=?,revision=revision+1 WHERE account_id=? AND key=?",
        ).run(at, accountId, old.key);
      }
    db.prepare(
      `UPDATE accounts SET auth='ready',last_success=?,last_attempt=?,failures=0,error=NULL WHERE id=?`,
    ).run(at, at, accountId);
    return changes;
  });
}
export function recordFailure(db, accountId, code, now = new Date()) {
  transaction(db, () => {
    const a = db.prepare("SELECT * FROM accounts WHERE id=?").get(accountId);
    const auth = ["AUTH_REQUIRED", "MANUAL_VERIFICATION"].includes(code);
    const episode = a.episode + (a.failures === 0 ? 1 : 0);
    const failures = a.failures + 1;
    db.prepare(
      "UPDATE accounts SET auth=?,last_attempt=?,failures=?,error=?,episode=? WHERE id=?",
    ).run(
      auth ? "required" : a.auth,
      now.toISOString(),
      failures,
      code,
      episode,
      accountId,
    );
    if (auth)
      enqueue(
        db,
        `auth:${accountId}:${episode}`,
        code === "MANUAL_VERIFICATION"
          ? `${a.name} · Verificação do navegador necessária\nO portal bloqueou a leitura dos cupões com uma verificação do navegador. Confirme o acesso no site; repetir o SMS pode não resolver. Os cupões guardados foram preservados.`
          : `${a.name} · Autenticação manual necessária\nAbra a sessão local e conclua o início de sessão/SMS. Os cupões guardados foram preservados.`,
        now,
      );
    else if (failures >= 3)
      enqueue(
        db,
        `failure:${accountId}:${episode}`,
        `${a.name} · ${failures} verificações consecutivas falharam\nMotivo: ${code}. Os últimos cupões confirmados foram preservados.`,
        now,
      );
  });
}

export function queueSavedExpiryReminders(db, now = new Date()) {
  const rows = db
    .prepare(
      `SELECT coupons.*, accounts.name FROM coupons
    JOIN accounts ON accounts.id=coupons.account_id
    WHERE coupons.present=1 AND accounts.error IS NOT NULL`,
    )
    .all();
  for (const row of rows) {
    const c = JSON.parse(row.payload);
    if (expiring(c, now) && c.used !== true)
      enqueue(
        db,
        `expiry:${row.account_id}:${c.key}:${c.endDate}`,
        `${row.name} · Expira em 48 horas\n${c.brand} · ${c.discount || "Desconto na imagem"}\n${c.description}\nVálido até ${c.endDate}\nÚltimo registo confirmado: ${row.last_seen}. A verificação mais recente falhou; confirme a disponibilidade no portal.`,
        now,
      );
  }
}
export function dashboardData(db, now = new Date()) {
  const coupons = db
    .prepare("SELECT * FROM coupons ORDER BY last_seen DESC")
    .all()
    .map((row) => {
      const c = JSON.parse(row.payload);
      return {
        ...c,
        accountId: row.account_id,
        present: !!row.present,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        changedAt: row.changed_at,
        status: couponStatus(c, row.present, now),
        isNew: now - new Date(row.first_seen) < 48 * 3600000,
        expiring: !!row.present && c.used !== true && expiring(c, now),
      };
    });
  return {
    accounts: db.prepare("SELECT * FROM accounts").all().map((account) => ({
      ...account,
      source: accounts.find((configured) => configured.id === account.id)?.source || "web",
      card: db.prepare("SELECT expires_at AS expiresAt FROM card_sessions WHERE account_id=?").get(account.id) || null,
      balance: db.prepare("SELECT cents,checked_at AS checkedAt,error FROM account_balances WHERE account_id=?").get(account.id) || null,
    })),
    coupons,
    balanceChanges: db.prepare(
      "SELECT id,account_id AS accountId,previous_cents AS previousCents,cents,checked_at AS checkedAt FROM balance_changes ORDER BY id DESC LIMIT 200",
    ).all(),
    events: db
      .prepare("SELECT * FROM events ORDER BY id DESC LIMIT 200")
      .all()
      .map((e) => ({
        ...e,
        payload: JSON.parse(e.payload),
        previous: e.previous ? JSON.parse(e.previous) : null,
      })),
    notifications: db
      .prepare("SELECT state,COUNT(*) AS count FROM outbox GROUP BY state")
      .all(),
  };
}
