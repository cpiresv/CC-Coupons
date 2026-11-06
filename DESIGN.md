---
name: CC Cupões
description: A calm Portuguese shopping planner for comparing local coupon records across three accounts.
colors:
  brand: "#e10916"
  brand-hover: "#bd0712"
  ink: "#272326"
  muted: "#6d6164"
  background: "#faf8f8"
  surface: "#ffffff"
  brand-soft: "#fff0f1"
  line: "#e6dadd"
  account-divider: "#e5d1d5"
  field-border: "#cdbfc2"
  inverse-muted: "#fff5f5"
  connected: "#326146"
  positive: "#285a3f"
  new-background: "#fff0f1"
  success-background: "#e7f0e6"
  amber: "#795004"
  amber-bg: "#fff4d4"
  error: "#893b23"
  error-background: "#fff0ea"
  focus: "#860711"
typography:
  display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(2rem, 3vw, 2.75rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Manrope, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 700
    lineHeight: 1.55
  title:
    fontFamily: "Manrope, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.65
  body:
    fontFamily: "Manrope, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Manrope, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.55
  discount:
    fontFamily: "Manrope, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.55
    letterSpacing: "-0.035em"
rounded:
  badge: "4px"
  field: "6px"
  control: "8px"
  account-strip: "12px"
spacing:
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "32": "32px"
  "36": "36px"
  "48": "48px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "14px 20px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 34px 10px 12px"
  navigation-tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    padding: "12px 0"
  navigation-tab-selected:
    textColor: "{colors.ink}"
  store-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    padding: "0"
  store-circle:
    backgroundColor: "{colors.surface}"
    rounded: "50%"
    width: "76px"
    height: "76px"
  store-circle-selected:
    backgroundColor: "{colors.brand-soft}"
  store-circle-mobile:
    width: "64px"
    height: "64px"
  badge-new:
    backgroundColor: "{colors.new-background}"
    textColor: "{colors.brand-hover}"
    rounded: "{rounded.badge}"
    padding: "2px 8px"
  badge-urgent:
    backgroundColor: "{colors.amber-bg}"
    textColor: "{colors.amber}"
    rounded: "{rounded.badge}"
    padding: "2px 8px"
  account-strip:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.account-strip}"
  offer-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "26px 20px 26px 0"
  comparison-heading:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.muted}"
    padding: "12px 24px"
  history-row:
    textColor: "{colors.ink}"
    padding: "24px 0"
---

# Design System: CC Cupões

## Overview

**Creative North Star: "Weekly shopping planner"**

CC Cupões is a Portuguese operational dashboard for checking coupon records before shopping. Its Continente-red navigation, pale red account strip, and white offer rows make account ownership and usable dates easy to scan. Manrope gives the interface a consistent, restrained voice.

The implemented system uses alignment, horizontal rules, and clear text states. Discount values lead each offer; account identity, conditions, and validity stay close. The account comparison preserves the same offer identity across columns.

This document records `dashboard/src/App.jsx` and `dashboard/src/style.css`, with the direction contract in `index.html` (seed `25aafe48`) and product constraints in `PRODUCT.md`. It describes implemented presentation, not successful external account authentication or Telegram delivery.

**Key Characteristics:**

- Continente-red navigation and a pale red account status strip.
- Self-hosted Manrope throughout the working interface.
- Ruled offer rows with large discount values and explicit dates.
- Portuguese account, status, comparison, and history labels.
- Flat surfaces with visible keyboard focus and restrained motion.

## Colors

Continente red identifies navigation, actions, selections, and featured offers. Neutral text keeps dense coupon lists readable. Warm status colors identify attention without replacing the written state.

### Primary

- **Continente Red** (`brand`): navigation bar, primary action, input caret, and core identity.
- **Dark Red** (`brand-hover`): the enabled primary button's hover state.
- **Pale Red** (`brand-soft`): the shared account strip and comparison column heading.
- **Near White** (`inverse-muted`): secondary text inside the red navigation bar.

### Secondary

- **Connected Green** (`connected`): a saved-session indicator.
- **Positive Green** (`positive`): successful-check text.
- **New Offer Wash** (`new-background`): the compact new-offer badge.
- **Success Wash** (`success-background`): the successful-check message.
- **Amber** (`amber`, `amber-bg`): account attention, approaching expiry, and the urgency badge.
- **Rust** (`error`, `error-background`): failed checks and error messages.
- **Dark Red Focus** (`focus`): keyboard focus outlines on interactive elements.

### Neutral

- **Charcoal** (`ink`): headings, offer content, selected navigation, and field text.
- **Muted Charcoal** (`muted`): metadata, helper copy, date context, and unselected navigation.
- **Off White** (`background`): the page background.
- **White Surface** (`surface`): offer lists, fields, empty states, and text on the primary action.
- **Soft Rule** (`line`): list, navigation, history, comparison, and footer dividers.
- **Account Rule** (`account-divider`): separation inside the shared account strip.
- **Field Stroke** (`field-border`): native select and input boundaries.

**The Written State Rule.** Always retain the state label beside a status color or dot, including on mobile.

## Typography

**Display Font:** Manrope, with a sans-serif fallback.

**Body Font:** Manrope, with the same fallback.

The font files are self-hosted under `public/fonts/`. The regular face serves weight 400; the bold face is declared for weights 600–800. The root font size is 15px. Form controls inherit the body font.

### Hierarchy

- **Display:** the single-line **Cupões** heading uses the responsive `display` token and tight tracking.
- **Headline:** account names and list captions use `headline`.
- **Title:** offer and history titles use `title`; offer titles reduce to 0.92rem on mobile.
- **Body:** descriptions and controls use the body family and rhythm. Supporting copy commonly uses 0.8rem.
- **Label:** filter labels use `label`; brand labels retain this size with bold weight. Status labels and badges use smaller explicit roles.
- **Discount:** offer values use `discount`; comparison values use 1.6rem. Offer discounts reduce to 1.65rem on mobile.

Discount values, comparison values, and validity blocks use tabular numerals. Offer and history titles render in Portuguese lowercase with a capitalized first letter. Headings use balanced text wrapping. Expanded details have a maximum width of 70ch; footer copy has a maximum width of 75ch.

## Layout

The working container has a maximum width of 1260px, centered with desktop padding of 48px 36px 24px. A full-width, 76px navigation bar sits above it. The page heading aligns its title and manual-check control horizontally.

Account summaries share one three-column strip. A horizontally scrollable store selector sits between the account strip and the ruled view-navigation and counts row. Store buttons have a 24px gap; the selector uses 24px top padding, 12px bottom padding, and 8px side padding with matching negative inline margins. The view row follows with a 12px top margin. Labeled filters precede the current view. Spacing is mostly built from the documented scale; source-specific values remain local to their components.

Offer rows use three columns: a 120px discount column, a flexible description column, and a 170px validity column, with 24px gaps. Comparison rows use one flexible offer column and three account columns from 96px to 160px wide. History rows align a 160px timestamp column with the event content.

At widths of 760px or less:

- The top bar becomes 64px tall, and main padding becomes 32px 20px 24px.
- The heading, check control, and account strip stack vertically.
- Store circles use the mobile size, with 12px gaps and an 80px minimum button width; the row scrolls horizontally when needed.
- Filters wrap, with labels using a 135px flex basis.
- Offer rows use a 78px discount column and a flexible content column, separated by 12px.
- Validity moves below the offer content, keeping its status label visible.
- Comparison offers span all three columns; each account value gains its own visible account label.
- History timestamps move above their event content, and footer metadata stacks.

**The Offer Identity Rule.** Keep each offer's title and validity together when its account values move between desktop and mobile layouts.

## Elevation & Depth

The interface uses no box shadows. White working surfaces, pale red grouping, horizontal rules, and type hierarchy establish depth. Account summaries belong to one shared strip; offer rows remain flat, contiguous records.

Buttons transition background color over 120ms with `ease-out`. Comparison rows briefly fade their pale red background over 160ms. Both effects run only when `prefers-reduced-motion: no-preference` matches.

## Shapes

Corner rounding is restrained and role-specific: badges use `badge`, fields use `field`, buttons and notices use `control`, and the shared account strip uses `account-strip`. Offer, comparison, and history rows retain square boundaries. Dividers and field strokes are 1px. Status dots are circular and 7px wide.

Icons use simple current-color SVG strokes with rounded caps and joins. The ticket mark is 27px; the primary action icon is 20px.

## Components

### Buttons

The primary action is a solid Continente-red control with white text, bold weight, a leading refresh icon, and a minimum height of 44px. Its hover state uses `brand-hover`. Disabled buttons use 0.6 opacity and a waiting cursor; the action label also reports the running state.

The date-reset action is an underlined text button with a transparent background. It appears only when a date filter is active. Interactive controls receive a 3px focus outline with a 4px offset. Hover and focus styling must remain independent.

### Inputs / Fields

Native selects and the date input have white backgrounds, charcoal text, a 1px field stroke, and gently rounded corners. They have a minimum height of 44px. Labels sit above controls with a 7px gap. The date input uses 12px right padding; selects reserve more room for their native arrow.

### Navigation

The three views are **Cupões**, **Comparar contas**, and **Histórico**. Navigation uses plain text buttons with a transparent background. The selected view has bold ink text and a 3px bottom rule; `aria-current="page"` carries the state. On mobile, the navigation spans the available width above the counts.

### Store Selector

Store buttons pair an official logo inside a circle with a bold, muted store name underneath. Continente, Galp, Wells, Pizza Hut, Taco Bell, KFC, and Pans & Company use local logo assets. TacoBell and Pans&Company labels use the same respective assets. Unknown brands use up to two initials. Only brands represented in coupon records appear; the selector is absent when no brands exist. Continente is selected initially when present, otherwise the first available brand is used. Selection remains when that brand is still available.

The circle uses the `store-circle` size, a white surface, and a 2px soft-rule border. Each button has an 84px minimum width and a 10px gap between its circle and label. Logos fit within 60% of the circle width and 48% of its height. The selected circle has a 3px Continente-red border and pale red background; its label uses charcoal. Hover changes the unselected border to muted charcoal. Buttons retain the shared focus outline, and `aria-pressed` exposes selection.

A rust dot (12px) sits at the upper-right of the circle with a 2px page-background border. It marks new, present coupons that are available or upcoming in the relevant account scope. The accessible button name adds **novos cupões** when the dot appears. Store labels remain visible below every logo.

The selected store scopes coupons, comparison, history, and available/upcoming counts. Coupon and history views also respect the account filter. Comparison includes all accounts, including its counts and new-coupon dots. The selector uses the compact `store-circle-mobile` size at the existing mobile breakpoint.

### Chips

**Novo** and **Expira em 48h** are compact informational badges, not controls. They use brand red and amber colors respectively, bold 0.68rem type, and the `badge` shape. Keep account and brand text alongside them.

### Account Strip

Three summaries share a pale red container with dividers. Each shows the account name, a written connection state with a dot, and the last successful check. Errors remain visible beneath the summary. Manual-login guidance uses a native disclosure. On mobile, the divider becomes horizontal; state text remains present.

### Ruled Offer Row

The discount leads, followed by brand, account, badges, offer title, and the conditions disclosure. A separate validity block includes the written status, end date, and start date. Approaching expiry changes the end-date emphasis to amber.

Upcoming offers use a light gray surface, neutral text, grayscale images, and an **Em breve** badge. Their validity block leads with **Disponível a partir de** and the start date, followed by the end date. Conditions remain accessible. Upcoming account comparison values also use neutral text and retain their written state.

The €5 offers for purchases over €20 at Continente or over €5 at Wells carry a **Destaque** badge. Available versions lead each store's list and comparison, with a pale red surface and a Continente-red discount block in the coupon list. Upcoming versions retain the gray treatment and normal expiry order. Removed, used, and expired versions are not featured; account and date filters still apply.

Unknown discounts render **Ver imagem** with **Valor não identificado**. The disclosure contains conditions, code, known purchase information, first detection, and the original offer image when available. Android offers use the app’s accessible discount text and omit the image. This image is evidence content, not decoration. Details use a side-by-side layout on desktop and stack on mobile.

### Account Comparison

Matching offers share one identity and date range, then display each account's values. Comparison rows have 24px padding; the desktop header uses 12px vertical and 24px horizontal padding so its columns align. Mobile rows use 20px vertical and 16px horizontal padding. The desktop heading names each account column. Mobile labels repeat the account name above each value. **Sem esta oferta** and **Por verificar** distinguish known absence from missing verification. The account filter controls the next manual check; comparison continues to show all accounts.

### Filtered History

The history view respects the selected account. Timestamp, change type, account name, offer title, discount, and expiry form each ruled record. A native **Ver alteração** disclosure reveals **Antes** and **Depois** when previous values exist. The visible list states its 200-event limit and explains that the complete history stays in the local database.

### Feedback and Empty States

Errors use the rust message treatment with `role="alert"`. Successful checks and initial loading use `role="status"`. Empty copy distinguishes a filter with no matches from an account with no confirmed records. Preserved records remain accompanied by the failed-check state. Footer text reports portal limitations, configured notification state, and schedule context without implying delivery proof.

## Do's and Don'ts

### Do:

- **Do** keep Portuguese operational labels and Europe/Lisbon date context consistent.
- **Do** place account identity, written status, and validity near each offer.
- **Do** preserve visible status and account labels when columns collapse on mobile.
- **Do** use horizontal rules and aligned values to organize repeated records.
- **Do** keep unknown values and unverified account states explicit.
- **Do** retain native fields, disclosures, visible focus, and reduced-motion behavior.

### Don't:

- **Don't** turn every offer into a floating, shadowed card.
- **Don't** communicate connection or expiry state through color alone.
- **Don't** replace original offer evidence with invented discount values or decorative imagery.
- **Don't** treat an account without a successful check as confirmed to have no offers.
- **Don't** present configured Telegram settings as verified notification delivery.
