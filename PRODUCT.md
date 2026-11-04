# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User requested JavaScript, Node.js, Playwright, SQLite, React, Vite, Express, Telegram and macOS launchd.

## Users
Shoppers check personalized offers across two Cartão Continente accounts before shopping.

## Product Purpose
Monitor both accounts independently, compare current offers, retain changes, and notify without duplicates.

## Operating Context
Local macOS application. Daily scheduled headless checks and manual checks. Manual visible-browser authentication with SMS. Europe/Lisbon dates.

## Capabilities and Constraints
Never bypass authentication or store passwords or SMS codes. Keep profiles and personal data local and outside Git. Failed extraction must preserve the last successful snapshot. Desktop website cannot expose app-exclusive offers.

## Evidence on Hand
Authenticated desktop portal inspected on 2026-11-04. Three brand tabs: Continente, Galp, Wells. Discounts are image-based. Both independent account profiles passed unattended checks, and Telegram confirmed notification delivery. Each installation requires its own account sessions and Telegram configuration.

## Product Principles
- Show uncertainty instead of inventing values.
- Separate accounts at every storage boundary.
- Keep previous good data through failures.
- Prioritize dates, eligibility and account comparison.

## Open Decisions
Assumption: Portuguese operational dashboard with account labels Conta 1 and Conta 2; English technical documentation. Default daily check at 09:00, configurable.
