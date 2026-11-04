# CC Coupons

A local monitor for two Cartão Continente accounts. It uses independent Playwright Chromium profiles, SQLite history, Telegram notifications, an Express API, and a Portuguese React dashboard.

## Requirements

- macOS with Google Chrome installed.
- Node.js 22.13 or later. Node's built-in `node:sqlite` provides SQLite without a native package build.
- Access to both accounts and their SMS verification codes.

## Start

```sh
git clone https://github.com/cpiresv/CC-Coupons.git
cd CC-Coupons
npm ci
cp -n .env.example .env
npm run build
npm start
```

Open <http://127.0.0.1:4310> on the host Mac. For another device on the same local network, open a private network URL printed by `npm start`. Through Tailscale, use the host Mac's Tailscale IPv4 URL printed by the same command. The server listens on IPv4 interfaces and accepts localhost plus the host Mac's assigned private and Tailscale IPv4 addresses. Keep it running while using the dashboard. The daily monitor runs independently of the dashboard server.

Do not replace an existing `.env`. Account names, port, browser channel, headless mode, and daily time are configurable there. Restart the dashboard after changing `.env`; each scheduled process reads it afresh.

## Authentication

```sh
npm run login -- account-1
npm run login -- account-2
```

Each command opens a separate, visible profile. Complete the login and SMS on the website. The command opens the coupon section, saves the session, closes its browser, and verifies the account headlessly. Allow up to 15 minutes for manual login. Closing the window cancels the flow.

After login, the browser opens the observed account-page form URL before clicking Cupões. This lets the website display and complete its browser verification as a full page. A verification response inside an AJAX request can otherwise leave a permanent loading spinner. Complete any visible verification yourself. If it still fails, open Cupões in regular Chrome and use the scoped import below once the page works there.

If the portal is already authenticated in your local CDP-enabled Chrome:

```sh
npm run import-chrome -- account-1
```

The import connects to `127.0.0.1:9333`, reads only Cartão Continente cookies and local storage, and verifies them in the account's separate profile. It does not copy the regular Chrome profile or other websites' sessions. Import one account at a time. Never import the same open account into both account slots.

Profiles are `data/profiles/account-1` and `data/profiles/account-2`. Chrome's native session restoration preserves session cookies across headless browser restarts. Passwords and SMS codes are never requested by the program, logged, or stored in configuration. Complete security challenges manually. Reauthentication uses the same `login` command.

Chrome manages persistent and session cookies together, including token rotation and revocation. The monitor does not replay old JSON cookies over the profile. Private JSON snapshots remain available for diagnosis and are updated after failed extractions too.

Each run uses one fresh tab. Portal tabs are closed before the browser exits so old login pages and background requests are not restored alongside the next check. Interactive login selects its tab explicitly.

A SQLite process lock covers login, checks, scheduling, and notification dispatch. It prevents concurrent profile use across CLI and dashboard processes. Dead-process locks recover on the next operation. Do not open these profile directories with another program while checks run.

## Check now

```sh
npm run check                  # both accounts
npm run check -- account-1
npm run check -- account-2
```

The dashboard's account filter also selects the account for its check button. A failed account does not prevent the other account from being checked. Network failures receive at most three attempts, separated by 5 and 10 seconds. Authentication and layout failures stop without repeated scraping.

If the portal returns its homepage, the checker follows the observed account menu to Cupões. A resulting login form is reported as an expired session, instead of a layout change.

## Telegram

1. Create a bot through Telegram's official BotFather if needed.
2. Start a conversation with the bot or add it to your intended chat.
3. Put its token and your intended chat ID in `.env` locally.
4. Run `npm run telegram-setup` to discover and save the private chat ID.
5. Run a manual check to dispatch queued notifications.

```dotenv
TELEGRAM_BOT_TOKEN=your-token
TELEGRAM_CHAT_ID=your-chat-id
```

New and changed coupons, returns, expiry within 48 hours, authentication failures, and three consecutive failed checks generate notifications. The first successful snapshot counts its offers as new. Names identify accounts in every message. Removed offers are recorded in history without an extra notification. If a refresh fails, expiry reminders still use the last confirmed snapshot and explicitly warn that current availability is unverified.

The SQLite outbox deduplicates messages. Missing credentials leave messages pending. Telegram-confirmed sends are marked sent. Explicit transient rejection receives at most three attempts on subsequent checks. A timeout or a crash after dispatch makes delivery uncertain: the program retains the message for review and does not blindly resend it. Telegram has no send-message idempotency key, so guaranteed delivery and absolute duplicate prevention cannot both be promised after a lost response.

Inspect delivery state without displaying tokens:

```sh
sqlite3 data/coupons.sqlite 'SELECT state, count(*) FROM outbox GROUP BY state;'
```

Messages themselves contain coupon details. Do not publish the database.

## Daily scheduling on macOS

```sh
npm run schedule -- install
npm run schedule -- status
npm run schedule -- uninstall
```

Set `DAILY_CHECK_TIME=09:00` in `.env` to choose a daily time in **Europe/Lisbon**.

The LaunchAgent is `local.cc-coupons.daily`. It starts a lightweight Node gate every five minutes. The gate launches a browser only once per Lisbon day, at or after the configured time. This avoids relying on the Mac's system timezone for launchd calendar matching. It catches up after waking or logging in; it does not wake a sleeping Mac or run while the user is logged out. Changing the time takes effect on the next tick; a day already attempted is not repeated automatically.

Checks that fail consume that day's scheduled attempt. The monitor retries transient failures inside the check, preserves previous data, and sends a repeated-failure alert after three failed checks. Manual checks remain available.

To inspect the generated property list before installation:

```sh
npm run schedule -- print
```

The schedule uses the current absolute Node executable and project path. Reinstall it after moving the project or replacing that Node installation.

## What was verified on the actual website

On 4 November 2026, the authenticated desktop page was `https://cartaocontinente.pt/IniciarSessao.aspx`, with account navigation and coupon rendering at `/AMinhaConta.aspx`. Personalized coupons were accessible on the Cartão Continente portal. Both independent account profiles passed repeated headless checks. The portal exposed Continente, Galp, and Wells tabs.

The site uses OutSystems page/AJAX updates. No undocumented JSON endpoint is assumed or called. The extractor uses observed `.TituloDadosConta`, `.MyAccountLeftMenu`, `.insignia-name`, `.circle-active`, `wtCouponsContainer`, `.new-coupon`, `.coupon-date-info`, `.coupon-descr`, `.coupon-code`, and `.cupoes-insignias-image` markup. It waits for the observed account-page POST and selected-brand state before reading each tab.

- Exact coupon IDs, conditions, minimum purchase thresholds, and Portuguese date ranges come from the page.
- Discounts are images. Twelve image assets were visually checked and mapped to their displayed value. Unknown images remain available in the dashboard with an explicitly unknown numeric discount; no value is guessed from an unfamiliar filename.
- Start/end dates use Lisbon time. A coupon is valid through the end of its printed expiration day. Future coupons are separate from currently usable coupons.
- The site's `coupon-holder-inactive` class also occurs on future offers. It is **not** treated as an activation or usage flag.
- Activation-required, activated, and used remain `null` where the portal provides no confirmed information. The monitor never activates or redeems a coupon.
- The portal explicitly says app-exclusive coupons may require the mobile app. The monitor cannot claim coverage of those offers.
- One account initially received HTTP 247 verification HTML inside AJAX requests (`winsocks is not defined`), leaving a spinner or blank page. A manual login in regular Chrome followed by full navigation to `/AMinhaConta.aspx` allowed the website's verification to complete. The verified session was imported into its independent profile, and a headless check retrieved the complete snapshot. The monitor still stops with `MANUAL_VERIFICATION` if this response returns; it never treats partial data as a complete result. No challenge code is patched or manually invoked by the monitor.
- No authenticated zero-coupon state was available during inspection. An empty brand result therefore fails closed as `UNVERIFIED_EMPTY_STATE`, preserving previous data. Verify actual empty-state markup before supporting confirmed empty snapshots.

## History and comparison

SQLite records are separated by account and coupon key (brand, printed code, campaign start date). Each successful full snapshot detects new, changed, removed/expired, and returned coupons transactionally. A changed campaign start date is treated as a new campaign; description, discount, end date, and other eligibility changes within a campaign create change events. Cosmetic URL changes for known discount images do not trigger notifications. Unknown image changes do.

The dashboard shows current offers, future offers, 48-hour expiry warnings, and offers first detected in the previous 48 hours. Filters select account, status, and latest expiration date. The comparison groups offers with identical conditions and dates; it does not assume different product categories are equivalent. An unverified account displays “Por verificar”.

The dashboard shows the latest 200 history events; the complete event history and previous snapshots remain in SQLite. Expired offers remain available through the status filter, even if no further successful website check has run.

## Local data and troubleshooting

Everything private lives under `data/`, ignored by Git. `.env`, build output, browser data, debug screenshots, and logs are also ignored. The data directory uses owner-only permissions. If setting `DATA_DIR`, use a location outside the repository. The SQLite database is local and not encrypted by this app; protect the Mac and its backups.

- `data/coupons.sqlite`: accounts, snapshots, events, notification outbox, and scheduler state.
- `data/checks.log`: timestamps, account IDs, safe status codes, and counts only.
- `data/debug/`: failure screenshots, with headers, account sidebar, form fields, and login frames masked. At most 20 generated failure screenshots are retained. Treat all screenshots as private.
- `data/launchd.log` and `data/launchd-error.log`: scheduled process output.

If the portal changes, keep the previous database, inspect the authenticated page, and update the extractor and its tests. A failed check never confirms an empty inventory.

The HTTP server checks Host and Origin, refuses cross-site requests, and does not expose profile files or tokens. The dashboard has no password: devices that can reach it on the local network or through Tailscale can view coupons and trigger checks. Use a trusted network. The Mac must remain awake and the server must remain running. Its network address can change after reconnecting. Any program running as your macOS user can still access local data. Do not expose the server through port forwarding or a public proxy.

For development, run `npm start` and `npm run dev` in separate terminals. Vite proxies API traffic to the configured backend port and only accepts the two local development origins. Production serves the built dashboard directly from Express.

## Verification

```sh
npm test
npm run build
```

Tests cover date parsing/DST, expiry boundaries, observed markup in a real headless Chrome instance, failed extraction preservation, account separation, history, deduplication, process locks, Telegram delivery outcomes, the schedule gate, and local API request checks. Telegram tests use a fake transport and do not contact recipients.

The live check establishes current portal access, not permanent authentication. Sessions can expire and need another manual SMS login. Actual Telegram delivery requires configured credentials and separate confirmation from Telegram.

## Modules

- `src/auth.js`: independent profiles, interactive login, scoped Chrome import, screenshots.
- `src/extraction.js`: observed portal navigation and coupon parsing.
- `src/storage.js`, `src/dates.js`: SQLite, comparison/history, and Lisbon dates.
- `src/notifications.js`: Telegram outbox dispatch and deduplication.
- `src/monitor.js`, `src/lock.js`: orchestration, retries, logging, and mutual exclusion.
- `src/schedule.js`: launchd setup and daily schedule gate.
- `src/server.js`, `dashboard/src/`: local-network Express API and React dashboard.

Manrope font files in `public/fonts/` use the included SIL Open Font License.
