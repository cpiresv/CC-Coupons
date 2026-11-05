# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User requested JavaScript, Node.js, Playwright, SQLite, React, Vite, Express, Telegram and macOS launchd.

## Users
Shoppers check personalized offers across three Cartão Continente accounts before shopping.

## Product Purpose
Monitor the accounts independently, compare current offers, retain changes, and notify without duplicates.

## Operating Context
Local macOS application. Daily scheduled headless checks and manual checks. Each account uses the official app in its own Android emulator. Checks run sequentially and preserve separate device storage. Manual authentication and SMS happen in the relevant website or app. Europe/Lisbon dates.

## Capabilities and Constraints
Never bypass authentication or store passwords or SMS codes. Keep profiles and personal data local and outside Git. Failed extraction must preserve the last successful snapshot. Web collectors cannot expose app-exclusive offers. Android collection reads complete coupon details from each visible store and preserves previous data if collection is incomplete.

## Evidence on Hand
Authenticated desktop portal inspected on 2026-11-04. Android dashboard checks on 2026-11-05 saved 20 coupons for Account 1, 18 for Account 2, and 24 for Account 3. All three accounts reported ready without errors, and Telegram confirmed notification delivery. Native logins survived app and emulator restarts without another login or SMS. Desktop and mobile account and store filters matched the saved counts. Idle retention remains untested. Each installation requires its own account sessions and Telegram configuration.

## Product Principles
- Show uncertainty instead of inventing values.
- Separate accounts at every storage boundary.
- Keep previous good data through failures.
- Prioritize dates, eligibility and account comparison.

## Open Decisions
Assumption: Portuguese operational dashboard with account labels Conta 1, Conta 2, and Conta 3; English technical documentation. Default daily check at 09:00, configurable.
