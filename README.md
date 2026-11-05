# CC Coupons

A local monitor for three Cartão Continente accounts. Each account uses the official Android app in its own dedicated Google emulator. Previous Chrome profiles remain preserved locally. All three share SQLite history, Telegram notifications, an Express API, and a Portuguese React dashboard.

## Requirements

- macOS with Google Chrome installed.
- Android SDK with emulator, platform-tools, the `android` command-line tool, Java, and the configured Google Play devices described below.
- Node.js 22.13 or later. Node's built-in `node:sqlite` provides SQLite without a native package build.
- Access to the accounts and their SMS verification codes.

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

When `TAILSCALE_HOST` is configured, the server instead listens only on localhost. Use the private HTTPS address described below from your phone.

Do not replace an existing `.env`. Account names, port, browser channel, headless mode, and daily time are configurable there. Restart the dashboard after changing `.env`; each scheduled process reads it afresh.

## Phone installation through Tailscale

Keep Tailscale connected on the Mac and phone, signed into the same network. Enable HTTPS certificates for the network. Tailscale Serve remains private; do not enable Funnel.

1. Get the Mac's full `.ts.net` DNS name from `tailscale status --json`.
2. Add `TAILSCALE_HOST=your-mac.your-tailnet.ts.net` to the existing `.env`.
3. Run `npm run build` and restart the dashboard server.
4. Run `tailscale serve --bg http://127.0.0.1:4310` (use your configured `PORT`).
5. Open the printed HTTPS address in Safari on the iPhone.
6. Choose **Share → Add to Home Screen**, enable **Open as Web App** if shown, and tap **Add**.
7. Open the installed app once while connected, so it can save its own offline copy.

On this Mac, the CLI is `/Applications/Tailscale.app/Contents/MacOS/Tailscale`. `serve status` shows the private HTTPS mapping. `serve --https=443 off` removes it without deleting account data. HTTPS certificates renew through Tailscale; the Mac's `.ts.net` certificate name is published in certificate transparency logs, but the dashboard remains private.

If a phone can reach the Mac by Tailscale IP but cannot resolve its `.ts.net` name, check that phone's DNS settings. A custom DNS profile can interfere with MagicDNS even when Tailscale is connected. Avoid changing DNS for the whole network before identifying the device-specific cause.

This Mac also provides an online-only fallback at <http://100.101.125.114:4310/>. It uses private Tailscale TCP forwarding, while Express stays bound to localhost. The forwarding command is `tailscale serve --bg --tcp=4310 tcp://127.0.0.1:4310`; remove only this fallback with `tailscale serve --tcp=4310 off`. The fallback bypasses DNS, but HTTP does not support the service worker, so it cannot provide offline app loading. Use the HTTPS address for the full PWA once name resolution works.

The production build includes the manifest, Home Screen icons, and a versioned service worker. The service worker saves the app shell, fonts, and store logos. The dashboard saves the latest successful API response in this device's local storage. Development mode does not install a service worker. Close all dashboard tabs and the installed app, then reopen after a build to activate a waiting update.

Without a connection, the dashboard shows the saved copy and its synchronization time. Each account retains its actual last successful coupon-check time. Expiry, upcoming status, and 48-hour badges use the current Lisbon date even offline. Checks are disabled offline and never queued for later. Live access resumes when connectivity returns. API errors do not overwrite the saved copy. The Mac must remain awake for new data and checks; offline offers can have changed since collection. External coupon images are not saved, but coupon text and conditions remain available.

Offline data is private account information stored on that device. Clearing the site's storage removes it; the browser can also evict it. Safari and the installed web app can have separate storage, so load the installed app online before relying on it offline.

This Mac uses the LaunchAgent `local.cc-coupons.server` to start the dashboard at login and restart it after exit. Its definition is `~/Library/LaunchAgents/local.cc-coupons.server.plist`; output goes to `data/server.log` and `data/server-error.log`. It runs separately from the daily collector. Restart it after changing configuration or server code:

```sh
launchctl kickstart -k "gui/$(id -u)/local.cc-coupons.server"
```

Do not restart during a check. `launchctl print "gui/$(id -u)/local.cc-coupons.server"` shows its state. Update its Node executable and project paths if either installation moves. To stop automatic serving, use `launchctl bootout "gui/$(id -u)/local.cc-coupons.server"` and remove its plist. This leaves the daily collector and all account data intact.

Set `ProcessType` to `Interactive` in both LaunchAgents. The Android emulator and accessibility reader inherit the job's resource limits. `Background` priority caused Android's System UI to stop responding during startup, leaving checks on the welcome screen. `Interactive` gives these processes normal application resources; it does not open emulator windows. Reinstall the daily job with `npm run schedule -- install` after this setting changes. For the server, unload and bootstrap its plist after editing it; `kickstart` alone does not reload plist settings.

## Authentication

```sh
npm run login -- account-1
npm run login -- account-2
npm run login -- account-3
```

Each command opens that account's visible Android device. Complete the Continente login and any SMS inside the app. The command preserves the session, closes its window, and checks the account in the background. Allow up to 15 minutes for manual login. Closing the window cancels the flow.

Enter passwords and SMS codes only inside the official app. The monitor does not request them in chat, log them, or store them in configuration. Reauthentication uses the same `login` command. Previous browser profiles are retained under `data/profiles/`, but the configured accounts now use Android. Chrome import is not used for these accounts.

A SQLite process lock covers login, checks, scheduling, and notification dispatch. It prevents concurrent profile use across CLI and dashboard processes. Dead-process locks recover on the next operation.

## Android integration

All account checks read the official app's accessibility tree. The same manual check, dashboard button, daily schedule, history, comparison, and Telegram outbox process its coupons. The collector discovers store names from the full accessibility tree, including off-screen tabs. It reveals the store row vertically, then swipes horizontally to reach tabs on either side.

It opens each store's list entries individually, including upcoming coupons, and waits for complete codes, discounts, conditions, and dates. It scrolls links clear of the app's fixed controls before opening them. Navigation attempts are bounded; unreachable tabs fail the check. The detail count must match the list count, and coupon identities must be unique before saving a snapshot. Incomplete or empty results preserve the previous data. It reuses the verified screen layout for visibility checks and reads a fresh layout after scrolling or incomplete positioning.

Each device uses Android 16 Google Play ARM64, 3 GB RAM, and two CPU cores. Device names, ports, and storage are fixed per account:

| Account | Device | Port | Storage |
| --- | --- | --- | --- |
| 1 | `cc_coupons_account_1` | 5558 | `data/android/account-1.avd/` |
| 2 | `cc_coupons_account_2` | 5560 | `data/android/account-2.avd/` |
| 3 | `cc_coupons_account_3` | 5556 | `data/android/account-3.avd/` |

Each AVD definition must point to its own directory under the configured data directory. Set each device’s system language to **Português (Portugal)**. After the first Continente login, also open the profile icon → **Definições** → **Idioma** and select **Português**. The app has its own language preference; changing Android alone can leave English dates and discount labels. The coupon reader validates Portuguese labels. Git ignores this signed-in device storage. Install [Cartão Continente from Google Play](https://play.google.com/store/apps/details?id=pt.continente.ContinenteTelemovel) and sign into the matching Continente account inside each emulator. Accounts 1 and 2 were created from fresh device storage; their official app packages came from the Google Play installation, without copying account data. Do not copy another account's device storage or use **Wipe Data**.

The SDK defaults to `~/Library/Android/sdk`. Set `ANDROID_HOME` or `ANDROID_SDK_ROOT` for another location. The collector requires `platform-tools/adb`, `emulator/emulator`, and `cmdline-tools/latest/bin/android`. It uses `JAVA_HOME` when set, otherwise the Homebrew OpenJDK installation. Configure these variables in `.env` when the daily job also needs them.

```sh
npm run login -- account-3   # Opens the configured device for manual login
npm run check -- account-3   # Refreshes the dashboard and dispatches notifications
```

Checks start the selected accounts’ devices without windows and close them afterward. Manual and scheduled checks run the selected accounts simultaneously, with separate device storage. Checking all accounts runs three emulators at once and uses more memory than checking one account. The operation lock stays held until every device finishes, and notifications are sent afterward.

The monitor uses host graphics (`-gpu host`). Automatic graphics selection used SwiftShader software rendering for hidden emulators on this Mac, adding substantial CPU load during parallel checks.

If a device is already open, checks reuse it and leave it open. Do not interact with it during a check. The collector checks the device identity before accessing the app. Close an existing emulator before running the login command, or sign in there and run a check.

Emulators started by the monitor use separate virtual networks (`-feature -WiFiPacketStream`), avoiding connection timeouts seen with these devices on the shared Wi-Fi network. This uses Android’s documented [isolated networking mode](https://developer.android.com/studio/run/emulator-networking-interconnect).

Cold starts use `-no-snapshot`, preserving installed apps and authentication data. The collector flushes Android storage before shutting down a device it started. Quick Boot previously restored a blank sign-in screen. Local commands disable wireless discovery with `ADB_MDNS=0` because the installed ADB discovery service crashed on this Mac. These settings do not change regular Chrome. Every account keeps separate Android storage.

While waiting for a screen, temporary reader timeouts and missing layout roots retry within the readiness deadline without rebooting the device. The observed `CECE001` and `OEAE001` connection-error dialogs use the app's “Tentar Novamente” button at most twice within that deadline. Persistent failures still use the bounded account retry policy.

The app does not expose image URLs in its accessibility tree. The dashboard shows the discount text and coupon conditions without an invented image. Activation and usage remain unknown; the collector never selects, activates, archives, or redeems coupons.

On 5 November 2026, Account 3 retained its login after an app restart and a cold emulator restart without manual login or SMS. The app showed 18 current coupons across Continente (3), Galp (5), Wells (9), and Pizza Hut (1), plus 6 upcoming Continente coupons. An initial empty view resolved after restarting the app. A dashboard-triggered check then opened the emulator, saved all 24 unique coupons, and closed the emulator automatically. Telegram confirmed all 24 new-coupon notifications. Mobile and desktop dashboard views were verified. Idle retention remains untested; restart success does not guarantee permanent authentication.

Accounts 1 and 2 completed unattended Android dashboard checks on the same date, without another login or SMS. Account 1 saved 20 coupons at 13:19:33 UTC: 11 current and 9 upcoming. Account 2 saved 18 coupons at 13:31:42 UTC: 10 current and 8 upcoming. Both logins survived emulator restarts. The complete Account 1 check reused its device and restarted the app; Account 2's complete check cold-started its device. Both devices were then closed with their sessions saved. Telegram confirmed all five new notifications from these checks. Desktop and mobile verification confirmed all three accounts were ready, with Account 3's data unchanged. No idle test was run.

## Check now

```sh
npm run check                  # all accounts
npm run check -- account-1
npm run check -- account-2
npm run check -- account-3
```

The dashboard's account filter also selects the account for its check button. A failed account does not prevent the remaining accounts from being checked. Network and Android control failures receive at most three attempts, separated by 5 and 10 seconds. Authentication and layout failures stop without repeated scraping.

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

The LaunchAgent is `local.cc-coupons.daily`. It starts a lightweight Node gate every five minutes. The gate checks the configured Android accounts only once per Lisbon day, at or after the configured time. This avoids relying on the Mac's system timezone for launchd calendar matching. It catches up after waking or logging in; it does not wake a sleeping Mac or run while the user is logged out. Changing the time takes effect on the next tick; a day already attempted is not repeated automatically.

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
- The portal explicitly says app-exclusive coupons may require the mobile app. The web collectors cannot claim coverage of those offers; the Android collectors read the offers visible in each account’s app.
- One account initially received HTTP 247 verification HTML inside AJAX requests (`winsocks is not defined`), leaving a spinner or blank page. A manual login in regular Chrome followed by full navigation to `/AMinhaConta.aspx` allowed the website's verification to complete. The verified session was imported into its independent profile, and a headless check retrieved the complete snapshot. The monitor still stops with `MANUAL_VERIFICATION` if this response returns; it never treats partial data as a complete result. No challenge code is patched or manually invoked by the monitor.
- No authenticated zero-coupon state was available during inspection. An empty brand result therefore fails closed as `UNVERIFIED_EMPTY_STATE`, preserving previous data. Verify actual empty-state markup before supporting confirmed empty snapshots.

## History and comparison

SQLite records are separated by account and coupon key (brand, printed code, campaign start date). Each successful full snapshot detects new, changed, removed/expired, and returned coupons transactionally. A changed campaign start date is treated as a new campaign; description, discount, end date, and other eligibility changes within a campaign create change events. Cosmetic URL changes for known discount images do not trigger notifications. Unknown image changes do.

The dashboard shows current offers, future offers, 48-hour expiry warnings, and offers first detected in the previous 48 hours. Filters select account, status, and latest expiration date. The comparison groups offers with identical conditions and dates; it does not assume different product categories are equivalent. An unverified account displays “Por verificar”.

Circular store selectors group coupons by brand, following the mobile app's navigation pattern. Only stores with saved records appear. The selected store applies to coupons, account comparison, history, and the availability counts. A dot marks stores with new current or upcoming coupons for the selected account; comparison always includes all accounts. Account, status, and date filters remain available. Store logos are saved locally so navigation does not depend on external image requests.

The dashboard shows the latest 200 history events; the complete event history and previous snapshots remain in SQLite. Expired offers remain available through the status filter, even if no further successful website check has run.

## Local data and troubleshooting

Everything private lives under `data/`, ignored by Git. `.env`, build output, browser data, debug screenshots, and logs are also ignored. The data directory uses owner-only permissions. If setting `DATA_DIR`, use a location outside the repository. The SQLite database is local and not encrypted by this app; protect the Mac and its backups.

- `data/coupons.sqlite`: accounts, snapshots, events, notification outbox, and scheduler state.
- `data/checks.log`: timestamps, account IDs, safe status codes, counts, and collection source (`android` for the configured accounts).
- `data/debug/`: failure screenshots, with headers, account sidebar, form fields, and login frames masked. At most 20 generated failure screenshots are retained. Treat all screenshots as private.
- `data/android/`: private emulator storage and logs. `account-N-last-error.png` retains each account’s latest Android failure screenshot; it may contain account information. The matching `.json` file records the error code and stack. Temporary accessibility captures are removed after each check.
- `data/launchd.log` and `data/launchd-error.log`: scheduled process output.

If the portal changes, keep the previous database, inspect the authenticated page, and update the extractor and its tests. A failed check never confirms an empty inventory.

The HTTP server checks Host and Origin, refuses cross-site requests, and does not expose profile files or tokens. With `TAILSCALE_HOST`, only loopback connections can reach the server; its exact HTTPS hostname is accepted from the local Tailscale proxy. Forwarded headers never expand the allowed hosts or origins. Tailscale network policy controls which devices can connect. Without that setting, devices on the local network can also access the dashboard. There is no separate app password: permitted devices can view coupons and trigger checks. The Mac must remain awake and the server must remain running. Any program running as your macOS user can still access local data. Do not expose the server through port forwarding, Funnel, or a public proxy.

For development, run `npm start` and `npm run dev` in separate terminals. Vite proxies API traffic to the configured backend port and only accepts the two local development origins. Production serves the built dashboard directly from Express.

## Verification

```sh
npm test
npm run build
```

Tests cover date parsing/DST, expiry boundaries, observed markup in a real headless Chrome instance, failed extraction preservation, account separation, history, deduplication, process locks, Telegram delivery outcomes, the schedule gate, local API request checks, Android detail parsing and complete-store collection, and mobile store selection across coupon, comparison, and history views. Dashboard tests use synthetic offers. Telegram tests use a fake transport and do not contact recipients.

PWA tests build the production app and restart a persistent headless browser offline. They verify installability, icon sizes, saved coupon details, account comparison, disabled checks, and recovery without replayed requests. Offline unit tests cover expired coupons, stale running state, unavailable storage, corrupt snapshots, and access denials. These checks do not prove installation on a physical iPhone.

The live check establishes current portal access, not permanent authentication. Sessions can expire and need another manual SMS login. Actual Telegram delivery requires configured credentials and separate confirmation from Telegram.

## Modules

- `src/auth.js`: independent profiles, interactive login, scoped Chrome import, screenshots.
- `src/android.js`: dedicated emulator lifecycle, manual app login, and accessibility-based coupon collection.
- `src/extraction.js`: observed portal navigation and coupon parsing.
- `src/storage.js`, `src/dates.js`: SQLite, comparison/history, and Lisbon dates.
- `src/notifications.js`: Telegram outbox dispatch and deduplication.
- `src/monitor.js`, `src/lock.js`: orchestration, retries, logging, and mutual exclusion.
- `src/schedule.js`: launchd setup and daily schedule gate.
- `src/server.js`, `dashboard/src/`: local-network Express API and React dashboard.

Manrope font files in `public/fonts/` use the included SIL Open Font License.

Store marks in `public/stores/` identify their respective brands and remain the property of their owners. Sources: [Cartão Continente icon](https://cartaocontinente.pt/PortalCartaoContinente_Resources/img/logo_continente.png), [Galp wordmark](https://www.galp.com/pt/img/logo-galp.png), the inline Wells wordmark on [Wells](https://wells.pt), and the following assets from [Grupo Ibersol](https://www.ibersol.pt/): [Pizza Hut](https://www.ibersol.pt/wp-content/uploads/2018/12/logo_pizzahut.png), [Taco Bell](https://www.ibersol.pt/wp-content/uploads/2025/09/logo_tacobell.png), [KFC](https://www.ibersol.pt/wp-content/uploads/2018/12/logo_kfc.png), and [Pans & Company](https://www.ibersol.pt/wp-content/uploads/2018/12/logo_pans.png). They are not covered by the project's code license.
