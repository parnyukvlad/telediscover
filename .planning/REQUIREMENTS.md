# OnlyDate — v1 Requirements

**Milestone:** Ad-launch readiness — funnel + analytics + admin upgrades
**Scope date:** 2026-04-16

---

## v1 Requirements

### LAYOUT — Display and Responsiveness

- [ ] **LAYOUT-01:** User sees the Mini App in 9:16 portrait on mobile devices.
- [ ] **LAYOUT-02:** User sees the Mini App as a centered 9:16 portrait window on Telegram Desktop / Web (letterboxed against a dark backdrop; visually reads as "enlarged mobile").
- [ ] **LAYOUT-03:** User's keyboard, iOS notch, and home-indicator safe areas do not break the layout (`env(safe-area-inset-*)`, `100dvh` with `100vh` fallback).

### PERF — Performance

- [ ] **PERF-01:** User perceives fast first-screen content load — above-the-fold assets prioritized; non-critical scripts deferred.
- [ ] **PERF-02:** Feed images lazy-load and decode asynchronously (`loading="lazy"`, `decoding="async"`).
- [ ] **PERF-03:** Admin uploads are resized client-side to WebP at ≤ 800 px max dimension before hitting R2 (smaller R2 objects + faster feed rendering).
- [ ] **PERF-04:** Production HTML bundle minified (JS + CSS + HTML) before deploy.
- [ ] **PERF-05:** User sees simplified feed/profile UI — elements that don't drive chat conversion removed.

### CHAT — Chat CTA (deeplink to Telegram DM)

- [ ] **CHAT-01:** User taps a message icon on any feed card and lands in a Telegram DM with that model (`t.me/<handle>` via `Telegram.WebApp.openTelegramLink`).
- [ ] **CHAT-02:** User taps a message icon on the model profile page and lands in the same DM.
- [ ] **CHAT-03:** Chat CTA works on iOS, Android, and Telegram Desktop without breaking the Mini App session or dropping out to the system browser.

### TRACK — Analytics (raw D1 + PostHog dashboards)

- [ ] **TRACK-01:** Operator can see count of transitions — feed → chat, profile → chat, profile opens — in PostHog.
- [ ] **TRACK-02:** Operator can see unique-user counts per event type in PostHog.
- [ ] **TRACK-03:** Operator can see repeat transitions per user (same user, multiple chat CTAs).
- [ ] **TRACK-04:** Operator can see the view → click → chat funnel conversion rate in PostHog.
- [ ] **TRACK-05:** Every tracked event is bound to the user's Telegram user ID, derived from server-side HMAC-validated `initData` (no trust of `initDataUnsafe`).
- [ ] **TRACK-06:** Every session records its ad source on first load — Telegram `start_param` and/or URL `utm_*` parameters (whichever is present).
- [ ] **TRACK-07:** Chat-CTA events are captured reliably even though the tap navigates away from the Mini App (use `navigator.sendBeacon` or `fetch` with `keepalive: true` before `openTelegramLink`).
- [ ] **TRACK-08:** Raw event log persists in D1 for ≥ 90 days (post-ad retrospective analysis), with older rows pruned automatically.

### ADMIN-PROFILE — Profile Management

- [ ] **ADMIN-01:** Admin can edit profile fields on existing `onlydate_feed_entries` rows: `display_name`, `handle`, `cover_url`.
- [ ] **ADMIN-02:** Admin can hide / unhide a profile from the public feed (`feed_visible` toggle).
- [ ] **ADMIN-03:** Admin can soft-delete a profile (marks inactive; R2 photo cleanup logged on failure, not silently swallowed).

### ADMIN-IMAGE — Image Management

- [ ] **ADMIN-04:** Admin can choose any gallery photo as the profile cover.
- [ ] **ADMIN-05:** Admin can add gallery photos (already works; extended with client-side resize — see PERF-03).
- [ ] **ADMIN-06:** Admin can delete gallery photos with R2 cleanup (already works; R2 delete errors surfaced in logs).
- [ ] **ADMIN-07:** Admin can hide individual gallery photos without deleting them (new `is_hidden` flag on `onlydate_feed_photos`).

### ADMIN-ORDER — Drag-Drop Reordering

- [ ] **ADMIN-08:** Admin can drag-and-drop reorder `onlydate_feed_entries` in the admin list view (SortableJS, touch-friendly).
- [ ] **ADMIN-09:** Reorder persists to D1 (`sort_order` column, atomic D1 `batch()` update) and reflects immediately on the public feed.
- [ ] **ADMIN-10:** Legacy `personas` rows (read-only) always sort to the bottom of the feed without requiring a separate override table.

### PROMO — Promotion Feature

- [ ] **PROMO-01:** Admin can toggle a feed entry as "promoted" (binary `is_promoted` column on `onlydate_feed_entries`).
- [ ] **PROMO-02:** Promoted profiles sort above unpromoted on the public feed (`ORDER BY is_promoted DESC, sort_order ASC`).
- [ ] **PROMO-03:** Promoted profiles render with an animated star-sparkle frame visible to end users — GPU-composited CSS (`transform` / `opacity` / `box-shadow` pulse only; no Canvas, no Lottie).

---

## v2 — Deferred (not this milestone)

- Tiered promotion (gold / silver / bronze) — binary suffices to start.
- Per-persona ordering for legacy `personas` rows — current scope lets them always sort last.
- Image cropping in the admin UI — client-side resize is enough; crop is a v2 polish.
- Bulk admin operations (bulk hide, bulk delete).
- Audit log / admin action history.
- Multi-touch attribution (first-touch is enough for v1 ad launch analysis).
- PostHog session replay.
- Server-side image optimization via Cloudflare Image Resizing (paid).
- Automated test suite — tracked as a known gap in `.planning/codebase/TESTING.md`, to be addressed in a follow-up milestone.

---

## Out of Scope — Explicit Exclusions

- **In-app messaging UI** — the whole product concept is to hand off to Telegram DM. Building our own chat layer contradicts the funnel. Always out of scope.
- **Migrating `personas` rows into `onlydate_feed_entries`** — the `personas` table is owned by an external sibling app and must remain read-only here.
- **User authentication beyond Telegram `initData`** — relying on Telegram's identity model is the intent; no separate login system.
- **Paid external services** (PostHog Cloud paid tier, Mixpanel, Amplitude, Cloudflare Image Resizing) — project constraint.
- **Breaking changes to the existing Mini App URL** — adding new query params is fine; removing/renaming existing ones is not (live bot links depend on current URL structure).
- **Frontend framework or bundler** — stays vanilla JS; SortableJS vendored directly.

---

## Traceability

*Requirement → Phase mapping filled in by roadmap.*

| REQ-ID | Phase |
|--------|-------|
| LAYOUT-01 … LAYOUT-03 | TBD |
| PERF-01 … PERF-05 | TBD |
| CHAT-01 … CHAT-03 | TBD |
| TRACK-01 … TRACK-08 | TBD |
| ADMIN-01 … ADMIN-10 | TBD |
| PROMO-01 … PROMO-03 | TBD |

---

*Requirements scoped: 2026-04-16*
