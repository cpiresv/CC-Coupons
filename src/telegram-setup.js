import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { root } from "./config.js";

export function findPrivateChat(updates) {
  const chats = new Map();
  for (const update of updates) {
    const message = update.message;
    if (
      message?.chat?.type === "private" &&
      message.from?.id === message.chat.id &&
      !message.from.is_bot
    ) {
      chats.set(message.chat.id, message.chat);
    }
  }
  if (chats.size !== 1) return null;
  return String(chats.keys().next().value);
}
export async function setupTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Save TELEGRAM_BOT_TOKEN in .env first.");
  const call = async (method, body = {}) => {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(35000),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw new Error(`Telegram rejected setup (${response.status}).`);
    return result.result;
  };
  const me = await call("getMe");
  const hook = await call("getWebhookInfo");
  if (hook.url)
    throw new Error(
      "This bot already uses a webhook. Use a dedicated bot or set TELEGRAM_CHAT_ID manually.",
    );
  console.log(
    `Send test to @${me.username} in Telegram. Waiting for one private chat.`,
  );
  const updates = await call("getUpdates", {
    timeout: 30,
    limit: 100,
    allowed_updates: ["message"],
  });
  const id = findPrivateChat(updates);
  if (!id)
    throw new Error(
      "No unique private chat was returned. Send test to the bot and rerun setup, or set TELEGRAM_CHAT_ID manually.",
    );
  const filename = path.join(root, ".env");
  let env = await readFile(filename, "utf8");
  env = /^TELEGRAM_CHAT_ID=.*$/m.test(env)
    ? env.replace(/^TELEGRAM_CHAT_ID=.*$/m, `TELEGRAM_CHAT_ID=${id}`)
    : env + `\nTELEGRAM_CHAT_ID=${id}\n`;
  await writeFile(filename + ".tmp", env, { mode: 0o600 });
  await rename(filename + ".tmp", filename);
  console.log(
    "Chat ID saved locally. Run a coupon check to send queued notifications.",
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  setupTelegram().catch((e) => {
    console.error(
      e.message.includes("bot") ||
        e.message.includes("Telegram") ||
        e.message.includes("TELEGRAM") ||
        e.message.includes("chat")
        ? e.message
        : "Telegram setup failed; check connectivity and try again.",
    );
    process.exitCode = 1;
  });
