# Project Research Summary

**Project:** OnlyDate — Telegram Mini App
**Domain:** Mobile-first social discovery feed with operator CMS + analytics
**Researched:** 2026-04-16
**Confidence:** MEDIUM (stack/architecture high-confidence; PostHog Worker integration medium; some Telegram SDK version details unverified against live docs)

---

## Executive Summary

OnlyDate is a Telegram Mini App that surfaces model profiles in a scrollable feed and funnels visitors into one-on-one Telegram DMs. This milestone adds five interlocking capabilities on top of an existing Cloudflare Workers + D1 + R2 + vanilla JS stack: desktop layout centering, chat CTA deeplinks, raw analytics in D1 forwarded to PostHog, and admin tooling (drag-drop ordering, promotion toggle, image management). The app must do all of this without paid external services and without introducing a frontend framework or build pipeline.

The recommended implementation approach is strictly additive. The Worker's single 733-line file gets split into a routes/shared module structure first (a pure refactor with no functional change), new D1 migrations add `sort_order`, `is_promoted`, and an `onlydate_events` table, and all new features attach to the resulting clean structure. Analytics uses a thin Worker-side `fetch` relay to PostHog rather than the `posthog-node` SDK — this is a deliberate architecture decision called out in detail below. The public feed gets two CSS changes (portrait centering) and two JS additions (chat CTA overlay, `track()` helper). The admin panel gets SortableJS drag-drop, a promotion toggle, and associated backend endpoints — all extending, not replacing, the existing 1411-line vanilla JS file.

The top risks are: (1) trusting `initDataUnsafe` user IDs without server-side HMAC validation, which would corrupt the entire analytics dataset; (2) not wrapping the PostHog forward in `ctx.waitUntil`, which silently drops events; (3) the `ADMIN_PASSWORD` constant still in source when new admin endpoints ship, widening the blast radius of an already-documented credential exposure; and (4) attempting to use Cloudflare Image Resizing (paid) in a zero-paid-services project. All four have clear, cheap mitigations that are part of the build order below.

---

## Key Findings

### Recommended Stack

The existing Cloudflare Workers + Hono + D1 + R2 + Cloudflare Pages stack requires no new infrastructure. New additions are minimal: **SortableJS v1.15.6** for drag-drop reorder in the admin panel (8 KB gzipped, no framework dependency, correct touch support on iOS/Android Telegram WebViews); **`html-minifier-terser`** as a one-shot pre-deploy build script for HTML+inline-JS minification; and a thin inline `forwardToPostHog()` function using the Workers `fetch` global. The `posthog-node` SDK is explicitly not recommended for the Worker (see tension section below). Telegram `initData` validation uses a ~30-line inline Web Crypto routine with no external library.

**Core technologies:**
- `SortableJS` v1.15.6: Touch-friendly drag-drop reorder in admin — only viable option that works on iOS Safari WebView
- `html-minifier-terser` ^7.x: Pre-deploy minification of inline JS/CSS in HTML — 30–50% size reduction with no bundler introduction
- Web Crypto API (built-in): HMAC-SHA256 `initData` validation — zero dependencies, runs in V8 isolate
- Plain `fetch` + `ctx.waitUntil`: PostHog event forwarding — canonical Workers fire-and-forget pattern; no SDK overhead
- PostHog Cloud free tier (`eu.posthog.com`): Analytics dashboards — 1M events/month free, adequate for 1k–10k DAU at 3 funnel events per session
- CSS `aspect-ratio: 9/16` + `max-height: 100vh`: Desktop portrait centering — pure CSS, no JS, zero CLS risk

**Critical version notes:**
- Native HTML5 drag events (`dragstart`) do not fire on iOS Safari — SortableJS is mandatory for mobile-functional drag-drop
- `100dvh` requires iOS 15.4+; provide `100vh` fallback for older clients
- `conic-gradient` is supported in all current Telegram WebView engines (2025+) — the rotating gold border CSS promotion animation is safe

### Expected Features

**Must have (table stakes for this milestone):**
- 9:16 portrait centering with dark letterbox on desktop — pure CSS, no JS required
- Chat CTA icon on every feed card AND on the profile view — existing `data-username` attribute already present on cards
- `feed_card_click_chat`, `profile_click_chat`, `profile_open`, `session_start` events captured via Worker → D1
- Attribution fields (`tg_start_param`, `utm_*`) captured on session start
- Admin: promote/demote toggle per profile with animated badge on public feed
- Admin: drag-drop reorder persisted to `sort_order` column via D1 batch

**Should have (differentiators):**
- PostHog forwarding for funnel/cohort analysis (fire-and-forget from Worker)
- Promoted profiles sorted above unpromoted in feed (`ORDER BY is_promoted DESC, sort_order ASC`)
- CSS star-sparkle animation on promoted cards: box-shadow pulse (Option 1) + badge icon (Option 5) combination — GPU-composited, no Lottie
- Haptic feedback on chat CTA tap (`tg.HapticFeedback.impactOccurred('medium')`)
- `navigator.sendBeacon` for the analytics event fired immediately before `openTelegramLink` navigation

**Defer to v2+:**
- In-browser image cropping (operator crops before upload)
- Multi-touch attribution model (first-touch is sufficient until 30 days of campaign data exist)
- Session replay (privacy risk for adult content)
- CF Image Resizing (paid — see image optimization tension below)
- `requestFullscreen()` (wrong direction for portrait feed on desktop)
- Audit log, RBAC, admin pagination, rich text bio

### Architecture Approach

The post-milestone architecture keeps the existing three-tier layout (Cloudflare Pages → Worker → D1/R2) with three new route files (`tracking.ts`, `admin/ordering.ts`, `admin/promotion.ts`), one new shared helper (`shared/posthog.ts`), two new D1 migrations, and a scheduled Worker export for 90-day event TTL cleanup. The critical structural change is splitting the 733-line monolithic `index.ts` into a `routes/` + `shared/` module hierarchy before adding any new routes — this is a prerequisite step with zero functional changes, done once, enabling parallel development of analytics and admin phases afterwards.

**Major components:**
1. `index.html` (public Mini App) — adds `track()` helper, chat CTA overlay buttons, 9:16 CSS layout, `is_promoted` CSS class on feed cards
2. `photochoose/index.html` (admin panel) — adds SortableJS drag-drop list view, promotion toggle button, wires new reorder/promote endpoints
3. `routes/tracking.ts` (new) — validates `initData` HMAC, inserts into `onlydate_events`, fires `ctx.waitUntil(forwardToPostHog(...))`
4. `routes/admin/ordering.ts` (new) — accepts ordered ID array, D1 `batch()` updates `sort_order`
5. `routes/admin/promotion.ts` (new) — toggles `is_promoted` on `onlydate_feed_entries`
6. `shared/posthog.ts` (new) — thin `forwardToPostHog()` using global `fetch`
7. `onlydate_events` D1 table (new) — append-only raw event log, 90-day TTL via cron
8. `onlydate_feed_entries` D1 additions — `sort_order INTEGER`, `is_promoted INTEGER` columns
9. Scheduled Worker export — daily `DELETE ... WHERE created_at < cutoff LIMIT 5000`

### Critical Pitfalls

1. **Trusting `initDataUnsafe` without HMAC validation** — Send raw `initData` string to Worker; verify `HMAC-SHA256(data_check_string, HMAC-SHA256("WebAppData", BOT_TOKEN))` before storing any `telegram_user_id`. Also check `auth_date` freshness (reject if >24 hours old). Must ship before any analytics data is trusted.

2. **Dropped PostHog events (missing `ctx.waitUntil`)** — Every PostHog forward must use `ctx.waitUntil(forwardToPostHog(...))`, never `await` inline. Awaiting adds 50–200 ms per event to user-perceived latency; not awaiting and not using `waitUntil` silently drops events when the isolate shuts down.

3. **New admin endpoints shipping before `ADMIN_PASSWORD` is rotated out of source** — The plaintext password in `index.ts` lines 13–14 is a documented critical concern. Adding reorder/promote endpoints widens the attack surface without fixing the root cause. Rotate to `c.env.ADMIN_PASSWORD` (Wrangler secret) before or with the first admin expansion phase.

4. **CF Image Resizing violates the zero-paid-services constraint** — `cf.image` transforms require a paid Cloudflare plan. The correct free path is client-side canvas resize before upload in the admin UI (`canvas.toBlob('image/webp', 0.85)` at max 800px), plus `loading="lazy"` + `decoding="async"` on all feed images. Do not introduce `/cdn-cgi/image/` URLs.

5. **Dual-source UNION: reorder/promote silently no-op on `personas` rows** — The `personas` table is read-only. Admin mutation endpoints must check `source` and return `400` if passed a personas-table ID, not silently succeed with 0 rows affected (existing `toggle-active` has this bug today).

---

## Tensions to Resolve in Roadmap Planning

These are genuine disagreements between researchers that the roadmap must address with an explicit decision. Do not paper over them.

### Tension 1: PostHog SDK (`posthog-node`) vs Plain `fetch`

**Stack researcher recommends:** `posthog-node` v4.x with `flushAt: 1` and `await ph.shutdownAsync()` called before the Worker returns a response. Rationale: official SDK, handles batching, provides typed API.

**Architecture researcher recommends:** A ~10-line `forwardToPostHog()` function using the global `fetch`, called via `ctx.waitUntil()`. Rationale: `posthog-node` depends on Node.js HTTP internals that conflict with the Workers fetch API in practice; `shutdownAsync()` adds the full PostHog network call to the user-facing response time; `ctx.waitUntil` is the canonical Workers pattern for fire-and-forget I/O.

**Recommended resolution: Use plain `fetch` + `ctx.waitUntil` (Architecture researcher's approach).** The architecture researcher's concern about `shutdownAsync()` blocking the response is directly confirmed by Pitfall 5 in PITFALLS.md — blocking on PostHog adds 50–200 ms per event to every tracked user action. The `ctx.waitUntil` pattern keeps user latency clean, D1 remains the source of truth, and PostHog gets the event asynchronously. If `posthog-node` is desired for its typed API, it can be used with `flushAt: 1` and `ctx.waitUntil(ph.shutdownAsync())` — but even then the plain `fetch` approach is simpler, auditable, and has zero dependency risk.

**Env bindings required either way:** `POSTHOG_API_KEY` (secret), `POSTHOG_HOST` (var: `https://eu.posthog.com`).

### Tension 2: Image Optimization — CF Image Resizing (paid) vs Free Alternatives

**Stack researcher recommends:** CF Image Resizing via `cf.image` fetch options for on-demand resize + WebP format negotiation. Notes the paid-plan requirement as a flag to verify.

**Pitfalls researcher calls out hard:** CF Image Resizing is a paid Cloudflare feature. The project constraint is zero paid external services. Using it would violate the constraint — full stop.

**Features and architecture researchers point to the free path:** Client-side canvas resize in the admin upload flow (`canvas.toBlob('image/webp', 0.85)` at 800px max), `loading="lazy"` + `decoding="async"` on feed images, and responsive CSS `max-width`. This produces smaller R2 objects at upload time and costs nothing.

**Recommended resolution: Client-side canvas resize on admin upload + lazy loading on public feed.** CF Image Resizing is explicitly out of scope for this milestone unless the operator confirms a paid Cloudflare plan is in place. The plan tier should be verified before any `/cdn-cgi/image/` code is written. The free path (canvas + lazy loading) addresses the performance goal adequately at 1k–10k DAU.

### Tension 3: Schema for `personas` Promotion and Ordering

**Features researcher proposes:** An `onlydate_persona_overrides` table keyed by `persona_id` with `is_promoted INTEGER DEFAULT 0` and `sort_order INTEGER DEFAULT 9999`. Handles both promotion state and ordering for the read-only personas table cleanly in one place.

**Architecture researcher proposes:** A synthetic `9999999` sort_order projected in the UNION query for personas rows, combined with `is_promoted` only on `onlydate_feed_entries`. Personas are always un-promoted and always sort last — no override table needed.

**Tradeoff:**

| Approach | Pros | Cons |
|----------|------|------|
| `onlydate_persona_overrides` table | Future-proof: enables per-persona promotion and fine-grained ordering of personas rows | Adds a third table to every UNION query; admin UI must know which source a row comes from to write to the right table |
| Synthetic sort_order in UNION | Simple: no new table, no new writes, personas always sort last, zero schema complexity | Cannot promote individual personas; cannot reorder personas relative to each other; if operator ever wants this, schema change is required |

**Recommended resolution for this milestone: Synthetic sort_order in UNION (Architecture approach).** The PROJECT.md explicitly marks tiered promotion and personas-to-feed-entries migration as out of scope. Since personas cannot be promoted or individually reordered this milestone, the override table is premature. Implement it only if the operator asks for personas-specific ordering control. Document the limitation explicitly in code with a `// personas: always sort last (read-only table)` comment.

---

## Implications for Roadmap

Based on combined research, the critical path is:

**Foundation → Analytics Backend → [Analytics Frontend + Layout/CTA in parallel] → [Admin in parallel]**

Multiple researchers converge on this sequence. Foundation unblocks everything. Analytics backend must precede frontend instrumentation. Layout/CTA and Admin are independent after Foundation.

### Phase 1: Foundation

**Rationale:** No other phase can proceed safely without this. Schema migrations add the columns all other phases depend on. Router modularization is a pure refactor that prevents merge conflicts between analytics and admin work happening in parallel. Admin password rotation must happen before new admin endpoints ship.
**Delivers:** Two D1 migrations (`sort_order` + `is_promoted` on `onlydate_feed_entries`; `onlydate_events` table with indexes); router split into `routes/` + `shared/` file structure; `ADMIN_PASSWORD` rotated to Wrangler secret.
**Addresses:** Admin ordering schema, analytics schema, admin security debt
**Avoids:** Pitfall 2 (credential exposure widened by new endpoints), Pitfall 5 (silent dual-table no-ops need a clean module to fix in)
**Research flag:** Standard patterns — no deeper research needed. D1 migration syntax and Hono router mounting are well-documented.

### Phase 2: Analytics Backend

**Rationale:** Analytics is the primary business deliverable of this milestone (ad attribution before paid launch). Backend must exist before frontend can instrument. `initData` validation must be correct before any user-scoped event is trusted.
**Delivers:** `POST /api/onlydate/track` route with HMAC validation; `shared/posthog.ts` using plain `fetch` + `ctx.waitUntil`; scheduled cron export for 90-day TTL; `POSTHOG_API_KEY` + `POSTHOG_HOST` env bindings.
**Uses:** Web Crypto API (HMAC-SHA256), `ctx.waitUntil`, PostHog `/capture/` HTTP endpoint
**Avoids:** Pitfall 1 (untrusted user IDs), Pitfall 5 (dropped PostHog events), Pitfall 6 (`tg_` prefix on `distinctId`), Pitfall 7 (no PII in person properties), Pitfall 11 (correct Mini App HMAC key derivation)
**Research flag:** Low risk on analytics schema and Worker patterns — well-documented. Verify PostHog free tier event limits at posthog.com/pricing before launch.

### Phase 3: Analytics Frontend + Layout/CTA (can run in parallel)

**Rationale:** Depends on Phase 2 (tracking endpoint exists) and Phase 1 (clean file to edit). Layout and CTA are pure frontend changes with no backend dependencies beyond the existing feed API. They can be done alongside analytics frontend instrumentation.
**Delivers:** 
- CSS 9:16 portrait centering (`max-width` + `aspect-ratio` + `max-height: 100dvh`)
- Chat CTA overlay button on feed cards (44px touch target, `e.stopPropagation()`, `openTelegramLink`)
- `track()` helper inline in `index.html`
- `session_start`, `profile_open`, `feed_card_click_chat`, `profile_click_chat` events wired
- `navigator.sendBeacon` for analytics event fired before `openTelegramLink` navigation
- Attribution capture: `start_param` + `utm_*` on `session_start`
**Uses:** CSS `aspect-ratio`, `100dvh`, `env(safe-area-inset-*)`, `Telegram.WebApp.openTelegramLink`, `navigator.sendBeacon`
**Avoids:** Pitfall 3 (`window.open` fails on iOS — must use SDK method), Pitfall 4 (attribution loss on hot-reload — capture immediately on load), Pitfall 10 (viewport/keyboard handling — use `dvh`, safe area insets)
**Research flag:** Layout patterns are well-documented. Telegram `openTelegramLink` behavior is stable. Verify `sendBeacon` support in Telegram WebViews before relying on it for pre-navigation analytics.

### Phase 4: Admin — Ordering and Promotion

**Rationale:** Depends on Phase 1 schema (columns exist). Admin CMS is the secondary business deliverable. Can proceed in parallel with Phase 3 after Phase 1 is complete.
**Delivers:**
- `POST /api/onlydate/admin/reorder` using D1 `batch()` for atomic bulk update
- `POST /api/onlydate/admin/promote` toggle on `onlydate_feed_entries`
- Feed query updated: `ORDER BY is_promoted DESC, sort_order ASC` with `9999999` synthetic sort for personas rows
- SortableJS drag-drop list view in admin panel (vendor the file — no CDN dependency)
- Promotion toggle UI (star button, yellow when promoted)
- Animated star-sparkle frame on promoted feed cards: CSS `box-shadow` pulse + badge icon (GPU-composited only)
- `is_promoted` class applied client-side from feed API response
**Uses:** SortableJS v1.15.6, D1 `batch()`, CSS `transform`/`opacity` animations only
**Avoids:** Pitfall 9 (HTML5 DnD broken on mobile — SortableJS handles pointer events), Pitfall 12 (jank on low-end Android — animate only `transform`/`opacity`, IntersectionObserver pause for off-screen cards), Pitfall 15 (dual-source mutation guard — check `source` before any UPDATE)
**Research flag:** SortableJS integration is well-documented. D1 batch is well-documented. Verify D1 batch 100-statement limit is not hit at scale (currently 20–100 profiles — safe).

### Phase 5: Admin — Profile and Image Management

**Rationale:** Refines existing admin capabilities. Lower business priority than analytics and ordering — the feed already works. Can follow Phase 4 or run partly in parallel. Image management improvement (client-side canvas resize) directly addresses the paid-image-optimization constraint.
**Delivers:**
- Edit display name / handle / cover on existing feed entries
- Hide / soft-delete profiles (map to `feed_visible = false` / `is_active = false`)
- Client-side canvas resize on admin upload (`canvas.toBlob('image/webp', 0.85)` at 800px max) — free image optimization
- `loading="lazy"` + `decoding="async"` on all public feed `<img>` tags
- R2 delete error logging (replace silent `.catch(() => {})` with `console.error`)
- `html-minifier-terser` build step pre-deploy
**Avoids:** Pitfall 13 (CF Image Resizing paid — canvas resize is the free path), silent R2 failures (CONCERNS.md fragile area)
**Research flag:** Canvas `toBlob` WebP support in Telegram admin WebView should be verified. It is well-supported in Chromium-based WebViews but admin panel is typically used on desktop.

### Phase Ordering Rationale

- Phase 1 first because schema and module structure are shared dependencies for all subsequent phases.
- Phase 2 before Phase 3 because the `track()` frontend helper needs the tracking endpoint to exist.
- Phases 3 and 4 can be parallelized after Phase 1 — they touch different files (public `index.html` vs admin `photochoose/index.html` and different Worker route files) with no shared state.
- Phase 5 last because it refines existing capability rather than enabling new capability.
- Admin password rotation is in Phase 1 (not Phase 4 where admin routes ship) because the fix must precede the blast-radius expansion.

### Research Flags

**Needs deeper research or live verification during planning:**
- Phase 2: PostHog free tier current event limits (1M/month as of training data — verify at launch)
- Phase 3: `navigator.sendBeacon` support in Telegram's embedded WebView on all platforms
- Phase 3: `100dvh` browser support floor in Telegram iOS WebView (requires iOS 15.4+)
- Phase 5: `canvas.toBlob('image/webp')` support in admin desktop browser context

**Standard well-documented patterns (skip research-phase):**
- Phase 1: D1 migrations, Hono router modularization
- Phase 2: Web Crypto HMAC-SHA256, `ctx.waitUntil`, PostHog `/capture` HTTP API
- Phase 4: SortableJS setup, D1 batch, CSS animation on `transform`/`opacity`

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | SortableJS, Web Crypto, `html-minifier-terser` all well-documented. PostHog plain-fetch approach is documented Cloudflare pattern. |
| Features | HIGH | Features are directly grounded in existing codebase reads + Telegram SDK stable behavior. |
| Architecture | HIGH | Grounded in existing codebase analysis + well-documented Cloudflare primitives (`ctx.waitUntil`, D1 batch, cron triggers). |
| Pitfalls | MEDIUM-HIGH | Telegram/Cloudflare pitfalls are HIGH confidence. PostHog-specific Worker behavior is MEDIUM (could not verify against live PostHog docs). |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Cloudflare plan tier:** CF Image Resizing requires a paid plan. Verify the current zone plan before Phase 5 begins. If paid plan is available, the canvas-resize approach can be reconsidered.
- **PostHog free tier current limits:** Training data says 1M events/month. At 10k DAU × 3 funnel events × 30 days = 900k events/month — tight. Verify at posthog.com/pricing before launch. Rate-limiting events to only the three funnel events (not scroll depth, etc.) is critical to staying within the limit.
- **`posthog-node` SDK compatibility:** The architecture researcher's concern about `posthog-node` conflicting with Workers fetch API is based on general knowledge, not live testing. If the plain `fetch` approach shows unexpected issues, `posthog-node` with `ctx.waitUntil(ph.shutdownAsync())` is the fallback — but block response latency will increase.
- **`navigator.sendBeacon` in Telegram WebViews:** This is the recommended pattern for firing the analytics event before `openTelegramLink` closes the Mini App. It is a W3C standard but Telegram's embedded WebView support should be verified. If unavailable, a `keepalive: true` fetch with a short `setTimeout` is the fallback.
- **D1 `onlydate_events` table separation:** The architecture researcher uses `onlydate_events` as the table name; the features researcher uses `analytics_events`. Standardize on `onlydate_events` to match the existing table naming convention (`onlydate_feed_entries`, `onlydate_feed_photos`).

---

## Sources

### Primary (HIGH confidence)
- `.planning/PROJECT.md` — product requirements and constraints
- `.planning/codebase/CONCERNS.md` — existing security debt and performance issues
- `apps/onlydate-worker/src/index.ts` (direct codebase read) — current architecture baseline
- Cloudflare Workers `ctx.waitUntil` docs — fire-and-forget pattern
- D1 `batch()` docs — atomic bulk update pattern
- Cloudflare cron triggers docs — scheduled Worker
- CSS `aspect-ratio` MDN — desktop centering approach
- Web Crypto API in Workers — HMAC-SHA256 implementation
- Telegram Bot API initData validation spec — HMAC key derivation algorithm
- SortableJS GitHub — capabilities, size, touch support

### Secondary (MEDIUM confidence)
- PostHog Node SDK docs (training data, cutoff Aug 2025) — `shutdownAsync` pattern
- PostHog `/capture` HTTP API — event ingestion endpoint shape
- Telegram Web App SDK (training data, Bot API 6.x–8.x) — `openTelegramLink`, `safeAreaInset`, `HapticFeedback`
- PostHog free tier limits — 1M events/month (verify current limits before launch)

### Tertiary (LOW confidence)
- `@cf-wasm/photon` for server-side image resize in Workers — niche library, verify CF Workers WASM support and bundle size before adopting
- Cloudflare Image Resizing paid-plan requirement — HIGH confidence on the paid constraint itself, but whether the current account has it should be verified live

---

*Research completed: 2026-04-16*
*Ready for roadmap: yes*
