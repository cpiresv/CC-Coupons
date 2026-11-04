import { randomUUID } from "node:crypto";
import { transaction } from "./storage.js";

export function isBusy(db) {
  const lock = db.prepare("SELECT pid FROM operation_lock WHERE id=1").get();
  if (!lock) return false;
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
}

export function acquireLock(db) {
  const owner = randomUUID();
  transaction(db, () => {
    const lock = db.prepare("SELECT * FROM operation_lock WHERE id=1").get();
    if (lock) {
      let alive = true;
      try {
        process.kill(lock.pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") alive = false;
      }
      if (alive) {
        const e = new Error("Another check or login is running");
        e.code = "BUSY";
        throw e;
      }
      db.prepare("DELETE FROM operation_lock WHERE id=1").run();
    }
    db.prepare("INSERT INTO operation_lock VALUES(1,?,?)").run(
      process.pid,
      owner,
    );
  });
  return () =>
    db.prepare("DELETE FROM operation_lock WHERE id=1 AND owner=?").run(owner);
}
