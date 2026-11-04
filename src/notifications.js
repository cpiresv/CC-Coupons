export async function flushNotifications(
  db,
  {
    token = process.env.TELEGRAM_BOT_TOKEN,
    chatId = process.env.TELEGRAM_CHAT_ID,
    fetchImpl = fetch,
  } = {},
) {
  if (!token || !chatId) return { configured: false, sent: 0 };
  let sent = 0;
  // A prior process may have died after Telegram accepted a message.
  db.prepare(
    "UPDATE outbox SET state='uncertain',error='DELIVERY_UNKNOWN' WHERE state='sending'",
  ).run();
  const pending = db
    .prepare(
      "SELECT * FROM outbox WHERE state='pending' AND attempts<3 ORDER BY created_at LIMIT 100",
    )
    .all();
  for (const item of pending) {
    db.prepare(
      "UPDATE outbox SET state='sending',attempts=attempts+1 WHERE id=?",
    ).run(item.id);
    try {
      const response = await fetchImpl(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: item.message,
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const result = await response.json();
      if (response.ok && result.ok) {
        db.prepare(
          "UPDATE outbox SET state='sent',sent_at=?,error=NULL WHERE id=?",
        ).run(new Date().toISOString(), item.id);
        sent++;
      } else {
        const retryable = response.status === 429 || response.status >= 500;
        db.prepare("UPDATE outbox SET state=?,error=? WHERE id=?").run(
          retryable && item.attempts < 2 ? "pending" : "failed",
          `TELEGRAM_${response.status}`,
          item.id,
        );
        break;
      }
    } catch {
      db.prepare(
        "UPDATE outbox SET state='uncertain',error='DELIVERY_UNKNOWN' WHERE id=?",
      ).run(item.id);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  return { configured: true, sent };
}
