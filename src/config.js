import { loadEnvFile } from "node:process";
import { mkdirSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = fileURLToPath(new URL("../", import.meta.url));
try {
  loadEnvFile(path.join(root, ".env"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
process.umask(0o077);
export const dataDir = path.resolve(root, process.env.DATA_DIR || "data");
export const accounts = [
  { id: "account-1", name: process.env.ACCOUNT_1_NAME || "Conta 1" },
  { id: "account-2", name: process.env.ACCOUNT_2_NAME || "Conta 2" },
];
export const timezone = "Europe/Lisbon";
export const portalUrl = "https://cartaocontinente.pt/IniciarSessao.aspx";
export const port = Number(process.env.PORT || 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid PORT");
export function selectAccounts(id = "all") {
  if (id === "all") return accounts;
  const account = accounts.find((a) => a.id === id);
  if (!account) throw new Error("Use account-1, account-2 or all");
  return [account];
}
export function prepareData() {
  for (const dir of [
    dataDir,
    path.join(dataDir, "profiles"),
    path.join(dataDir, "debug"),
  ]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
}
