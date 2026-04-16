# OnlyDate — Telegram Mini App

## What This Is

OnlyDate is a Telegram Mini App that showcases a curated feed of model profiles and funnels visitors into one-on-one Telegram chats. Users land from ads, scroll or open a profile, and tap a message icon that deeplinks directly into a DM with the model (`t.me/<handle>`). An admin panel lets the operator control who appears, in what order, and with which photos — without a developer in the loop.

## Core Value

**Turn an ad click into a Telegram chat in as few taps as possible — and prove it happened, per user, so traffic spend can be optimized.**

## Requirements

### Validated

<!-- Existing capabilities that already work in production -->

- ✓ Cloudflare Worker backend on Hono with D1 + R2 — existing
- ✓ Telegram Mini App frontend served from Cloudflare Pages — existing
- ✓ Admin-created feed entries stored in `onlydate_feed_entries` with cover + gallery photos on R2 — existing
- ✓ Read-only import of legacy `personas` populated from an external sibling app — existing
- ✓ UNION-based feed query over both sources with visibility flags (`feed_visible`, `feed_mode`) — existing
- ✓ Password-gated admin UI (`/photochoose`) for creating feed entries, uploading cover, managing gallery — existing

### Active

<!-- This milestone — hypotheses until shipped -->

- [ ] **Layout:** App opens in 9:16 portrait on all devices. Desktop shows a centered portrait window that looks like an enlarged mobile screen.
- [ ] **Performance:** First-screen content loads fast. Images lazy-load and are delivered at appropriate sizes. JS/CSS minified. UI stripped of elements that don't drive the user toward a chat.
- [ ] **Chat CTA:** Message icon on every feed card AND on the model profile page. Tap opens `t.me/<handle>` DM. Works from both entry points.
- [ ] **Event tracking (D1):** Raw events persisted in D1 — `feed_card_click_chat`, `profile_click_chat`, `profile_open` — bound to Telegram user id.
- [ ] **Attribution capture:** Every session records its ad source from Telegram `start_param` AND URL `utm_*` params (whichever is present).
- [ ] **Analytics dashboards (PostHog):** Same events forwarded to PostHog (self-hosted or free tier) for funnel / cohort / repeat-visit analysis. No paid tier.
- [ ] **Admin — profile management:** Edit display name / handle / cover, hide individual profile, soft delete.
- [ ] **Admin — image management:** Choose cover from gallery, add / delete photos, hide individual photos without deleting them.
- [ ] **Admin — ordering:** Drag-and-drop reorder of profiles on the public feed. Persisted to DB.
- [ ] **Admin — promotion:** Binary promote/unpromote toggle per profile. Promoted profiles render with animated star-sparkle frame on the public feed.

### Out of Scope

- **In-app chat / messaging UI** — the whole point is handing off to Telegram DM. — keeps the app small and the funnel clear.
- **User authentication beyond Telegram init data** — we rely on Telegram Web App's built-in user identification. — no separate account system.
- **Tiered promotion (gold/silver/bronze)** — explicitly chosen binary model. — simplicity wins until we have data saying otherwise.
- **Migrating legacy `personas` → `onlydate_feed_entries`** — the `personas` table stays read-only, populated externally. — dual-source stays by design.
- **Paid external analytics services** — PostHog cloud paid tier, Mixpanel, Amplitude. — constraint: zero paid external services.
- **Breaking changes to the existing Mini App URL** — query params may be added, but existing structure must keep working for current bot links. — constraint: no breaking URL changes.
- **Automated tests during this milestone** — testing infrastructure is a known gap (see `.planning/codebase/TESTING.md`) but adding it is not in scope this round. — prioritizing feature delivery for ad launch; revisit next milestone.
- **Full admin overhaul — rewrite from vanilla JS** — we extend the existing photochoose HTML/JS rather than rebuild. — matches existing conventions; avoids scope blowup.

## Context

### Product

- Launching paid advertising soon. Everything this milestone does serves two things: (a) make the funnel cleaner and faster, (b) make the results measurable.
- Scale assumption: 20–100 personas, 1k–10k DAU. Medium scale — need pagination + query perf discipline but not serious distributed-systems engineering.
- Two content sources coexist permanently:
  - `personas` — read-only, populated from an external sibling app.
  - `onlydate_feed_entries` — admin-created in this app's photochoose UI.
  - The feed UNIONs both. Both expose a `handle` column that is the real Telegram username (usable directly for `t.me/<handle>` deeplinks).

### Technical

- Stack: Cloudflare Workers (Hono 4.x) + D1 (SQLite) + R2 + Cloudflare Pages. Vanilla JS frontend, no bundler. pnpm workspace.
- Admin UI is a single-file vanilla JS app (`apps/onlydate/photochoose/index.html`, 1411 lines) — extend it, don't rewrite.
- All backend routes live in one file: `apps/onlydate-worker/src/index.ts` (733 lines). Pattern is consistent: `isAdmin` check → JSON parse → validation → D1 prepare/bind/run → `{ ok: true }` / `{ error }`. Match that pattern for new routes.
- Existing codebase concerns are documented in `.planning/codebase/CONCERNS.md`. Most notable: hardcoded admin password in source (critical), admin password in sessionStorage, N+1 subqueries for cover photos, no foreign key on `onlydate_feed_photos.feed_entry_id`, silent R2 delete failures. These are not blockers for this milestone but worth addressing opportunistically.

### User identity

- Telegram Mini App exposes user info via `window.Telegram.WebApp.initDataUnsafe.user.id` — that's the Telegram user ID. In Telegram, a DM chat_id equals the user_id, so user.id is what we bind analytics events to.
- For server-side correctness, `initData` must be validated against the bot token secret — we should not trust the client's claimed user id blindly.

### Ad attribution

- Two parallel channels must be captured:
  - **Telegram start_param** — reaches the Mini App via `tgWebAppStartParam`. Used when ads deeplink into the bot.
  - **URL utm_* params** — passed in the Mini App URL directly. Used for web ads or when bot link embeds utm params.
- Capture either or both on first session event for that Telegram user.

## Constraints

- **Budget:** Zero paid external services. PostHog must be self-hosted or on its free tier. — stated constraint.
- **Compatibility:** Existing Mini App URL must keep working. New query params allowed; removing/renaming existing ones is not. — live bot links depend on current URL.
- **Identity:** Telegram `initData` must be validated server-side with the bot token secret before any user-scoped analytics event is trusted. — prevents event forgery.
- **Tech stack:** Stay on Cloudflare Workers + D1 + R2 + vanilla JS frontend. Don't introduce a frontend framework this milestone. — matches existing code and keeps the app tiny.
- **Privacy / content:** Admin password stored in source (`apps/onlydate-worker/src/index.ts:13-14`) and sessionStorage are known security debts — do not make them worse. Ideally rotate out of source during this milestone if a phase touches auth.
- **Persona sources:** `personas` stays read-only. Do not write to it. Do not migrate its rows out. — external app owns its lifecycle.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| App viewport = 9:16 portrait everywhere, centered on desktop | User-stated requirement; unifies visual experience across mobile and desktop Telegram | — Pending |
| Chat CTA deeplinks to `t.me/<handle>` using the existing `handle` column on both feed sources | `handle` already holds the real Telegram username — no schema change needed | — Pending |
| Analytics: raw events in D1 + forwarded to PostHog for dashboards | Full control of raw data + rich analysis UI without building one; PostHog free tier avoids cost constraint | — Pending |
| Ad attribution: capture both Telegram `start_param` and URL `utm_*` | Ads may come from either Telegram-native placements or web placements | — Pending |
| Admin reordering = drag-and-drop (not a numeric field) | User-selected; better UX for 20–100 personas | — Pending |
| Promotion = binary toggle + animated star frame | Simplest product shape that still delivers the "featured" visual affordance | — Pending |
| Dual content sources (`personas` read-only + `onlydate_feed_entries` writable) stay in place | `personas` is a feed from an external app the operator also owns — unification is out of scope | — Pending |
| Do not rewrite admin UI — extend existing vanilla JS photochoose page | Existing file is 1411 lines but coherent; rewrite risk ≫ feature value this milestone | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-16 after initialization*
