# Phase 3: Layout, CTA and Analytics Frontend - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Three interlocked frontend deliverables in `apps/onlydate/index.html`:
1. **Layout** — 9:16 portrait on mobile, centered portrait with dark letterbox on desktop, safe-area handling, `100dvh` viewport fix
2. **Chat CTA** — message icon on every feed card AND on the profile page AND in the lightbox (already has one), all using `openTelegramLink`
3. **Analytics instrumentation** — `track()` client utility that calls `POST /api/onlydate/track` via `sendBeacon`/`keepalive fetch` before navigation; fires `session_start` (with attribution), `profile_open`, `feed_card_click_chat`, `profile_click_chat`

No backend changes. Phase 2 shipped `POST /api/onlydate/track` — this phase wires the frontend to it.

</domain>

<decisions>
## Implementation Decisions

### Layout — 9:16 Portrait and Viewport

- **D-01:** Add `viewport-fit=cover` to the existing viewport meta tag: `content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"`. This is required for `env(safe-area-inset-*)` to be populated on iOS.
- **D-02:** Replace `min-height: 100vh` on `#grid-view` and `#profile-view` with `min-height: 100dvh` + `100vh` fallback (via `min-height: 100vh; min-height: 100dvh`). Also apply to any full-height container rules in the lightbox.
- **D-03:** Desktop 9:16 centering: wrap the entire app body content in a `#app-wrapper` div. CSS:
  ```css
  #app-wrapper {
    max-width: min(100vw, calc(100dvh * 9 / 16));
    margin: 0 auto;
    position: relative;
    min-height: 100dvh;
    background: var(--bg);
  }
  ```
  The `<body>` background remains `var(--bg)` — already `#0f1115` dark — so the letterbox columns match seamlessly. No separate letterbox div needed.
- **D-04:** Top safe area: apply `padding-top: env(safe-area-inset-top)` to `.profile-topbar` and `.tab-bar` (the two sticky top elements). Use `Telegram.WebApp.contentSafeAreaInset.top` as a JS override if the CSS env variable resolves to 0 in old Telegram versions.
- **D-05:** Bottom safe area: apply `padding-bottom: env(safe-area-inset-bottom)` to `.tab-bar` and any future sticky-bottom elements. Ensures clearance of iOS home indicator.
- **D-06:** Call `tg.expand()` on init (already present) — keep as-is; this ensures full vertical space before layout paints.

### Chat CTA — Feed Cards

- **D-07:** Each feed card gets a chat icon button overlaid in the bottom-right corner, **above** the existing `.model-card-info` overlay. Always visible (not hover-only — touch devices have no hover). SVG paper-plane or message-bubble icon, ~32×32px tap target, semi-transparent dark circle background.
- **D-08:** Card tap behavior is unchanged: tapping anywhere on the card (except the chat icon) opens the profile view and fires `profile_open`. Tapping the chat icon fires `feed_card_click_chat` via `sendBeacon` then calls `openTelegramLink`. The icon tap must use `stopPropagation()` to prevent the card's profile-open handler from also firing.
- **D-09:** Chat icon HTML structure inside the card template:
  ```html
  <button class="card-chat-btn" data-handle="<handle>" aria-label="Message">
    <svg><!-- paper-plane icon --></svg>
  </button>
  ```
  Attach a single delegated listener on `.model-grid` that checks `e.target.closest('.card-chat-btn')` — consistent with the existing card-click delegation pattern.
- **D-10:** The profile page's existing `💬 Message` button already calls `onMessageClick()` — extend that function to fire `profile_click_chat` via `sendBeacon` before `openTelegramLink`.
- **D-11:** The lightbox already has a `#lightbox-msg` button — extend its click handler to fire `profile_click_chat` via `sendBeacon` before `openTelegramLink`. It uses the same `currentProfile.username` reference.

### Analytics — `track()` Client Utility

- **D-12:** Define a single `track(eventType, extraFields)` function in the app script block. It builds the request body, sends via `navigator.sendBeacon` (preferred — survives navigation), falls back to `fetch({keepalive: true})` if `sendBeacon` is unavailable:
  ```js
  function track(eventType, extra) {
    var initData = tg ? tg.initData : '';
    var payload = JSON.stringify(Object.assign({
      initData:     initData,
      event_type:   eventType,
      persona_handle: null,
      start_param:  null,
      utm_source:   null,
      utm_medium:   null,
      utm_campaign: null,
    }, extra));
    var url = API_BASE + '/api/onlydate/track';
    var sent = false;
    if (navigator.sendBeacon) {
      sent = navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    }
    if (!sent) {
      fetch(url, { method: 'POST', body: payload,
                   headers: { 'Content-Type': 'application/json' },
                   keepalive: true }).catch(function () {});
    }
  }
  ```
- **D-13:** `track()` is fire-and-forget. No await, no error UI. Failures are silently swallowed — the user experience must not degrade if tracking fails.
- **D-14:** `track()` is called BEFORE `openTelegramLink` on every chat CTA tap. Order: `track(...)` → `openTelegramLink(...)`. This ensures the event is dispatched before the Mini App may close.
- **D-15:** `profile_open` is fired every time the profile view is displayed — no session-level deduplication on the client. Repeats within a session are valid data (user browsed away and returned). PostHog/D1 can deduplicate in queries if needed. Call site: inside `showProfile()`, after the profile data is rendered.

### Analytics — `session_start` and Attribution

- **D-16:** `session_start` fires once per app load — in `init()`, after `tg.ready()` and `tg.expand()`. It fires on every Mini App open (not deduplicated client-side). Every ad click that opens the app is a new session the operator cares about.
- **D-17:** Attribution is read once at init time and stored in `sessionStorage` (key: `od_attr`) as a JSON string to survive Telegram WebView hot-reloads within the same session. On the next app open (new sessionStorage) it re-reads from the URL. Reading logic:
  ```js
  var attr = {};
  var stored = sessionStorage.getItem('od_attr');
  if (stored) {
    attr = JSON.parse(stored);
  } else {
    var sp = new URLSearchParams(window.location.search);
    var tgStartParam = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
    attr = {
      start_param:   tgStartParam   || null,
      utm_source:    sp.get('utm_source')   || null,
      utm_medium:    sp.get('utm_medium')   || null,
      utm_campaign:  sp.get('utm_campaign') || null,
    };
    sessionStorage.setItem('od_attr', JSON.stringify(attr));
  }
  ```
- **D-18:** When both `start_param` and `utm_source` are present, send both — the server records all attribution columns on `session_start`. No client-side "prefer one" logic; the operator can query either field in PostHog. Multi-touch is fine in the raw log even if not yet analyzed.
- **D-19:** `session_start` payload: `track('session_start', attr)` — passes all four attribution fields directly.

### UI Simplification (PERF-05)

- **D-20:** **Remove the share button** (`#btn-share` and `onShareClick`) from the profile page. It doesn't drive chat conversion and clipboard copy is a distraction. The `@handle` link in the profile header (`<a class="profile-username">`) remains as a passive reference.
- **D-21:** **Keep the tab bar** (trending/popular/new). It drives discovery → profile opens → chat CTAs. Removing it would hurt funnel depth.
- **D-22:** **Keep the header/logo**. Brand presence costs nothing and is not in the conversion path.
- **D-23:** **Keep the lightbox** (photo gallery). Model photos are the product — letting users browse them increases conversion intent before tapping chat. The lightbox already has a `#lightbox-msg` CTA (D-11).
- **D-24:** **Remove the `💬 Message` emoji label** from the profile button text — replace with icon-only or shorter label. The button itself stays; just the verbose label is stripped. Defer exact icon/label styling to planner.

### Performance (PERF-01, PERF-02)

- **D-25:** First card in the grid (`i === 0`) should use `loading="eager"` instead of `loading="lazy"` — above-the-fold cover image should not be lazy. All others remain `loading="lazy"`.
- **D-26:** All `<img>` tags already have `loading="lazy"` except the first one (D-25) — no other changes needed for PERF-02.
- **D-27:** The three parallel `fetchModels()` calls on init (CONCERNS.md noted this) are acceptable for now — they are already parallel via `Promise.all`. Do not serialize them. Optimization is deferred.
- **D-28:** Non-critical scripts: the `tg.expand()` + color calls already happen synchronously before content loads — they are lightweight SDK calls, not script bundles. No deferral needed for this phase. HTML minification (PERF-04) is Phase 5 scope.

### Claude's Discretion

- Exact SVG icon for the card chat button — paper-plane or message bubble, whichever renders cleanly at 20×20px
- CSS animation/transition on the card chat button tap state — match `.model-card:active` scale pattern
- Exact pixel sizing and positioning of the card chat icon button — keep it inside the existing `model-card-info` right side or float top-right; whatever looks clean at 14px card width
- Whether `tg.initDataUnsafe.start_param` fallback also checks `tg.initData` query params or not

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 3 Requirements
- `.planning/ROADMAP.md` §Phase 3 — 5 acceptance conditions (what must be TRUE)
- `.planning/REQUIREMENTS.md` §LAYOUT — LAYOUT-01, LAYOUT-02, LAYOUT-03
- `.planning/REQUIREMENTS.md` §CHAT — CHAT-01, CHAT-02, CHAT-03
- `.planning/REQUIREMENTS.md` §PERF — PERF-01, PERF-02, PERF-05
- `.planning/REQUIREMENTS.md` §TRACK — TRACK-07 (frontend sendBeacon/keepalive — Phase 3 deliverable per 02-CONTEXT.md)

### Pitfalls to avoid
- `.planning/research/PITFALLS.md` Pitfall 3 — `openTelegramLink` vs `window.open`; fire event BEFORE navigation
- `.planning/research/PITFALLS.md` Pitfall 4 — `start_param` hot-reload survival; read once + sessionStorage
- `.planning/research/PITFALLS.md` Pitfall 10 — viewport `dvh`, `safe-area-inset-*`, desktop 9:16 centering technique

### Backend (Phase 2 output)
- `.planning/phases/02-analytics-backend/02-CONTEXT.md` — full track endpoint contract: URL, request body shape, event types, `initData` field
- `apps/onlydate-worker/src/routes/analytics.ts` — live implementation to verify endpoint signature

### Existing frontend code
- `apps/onlydate/index.html` — single file to modify (943 lines); all JS inline in `<script>` block
- `apps/onlydate/index.html` line ~640 — `renderGrid()`: where card chat button HTML must be injected
- `apps/onlydate/index.html` line ~673 — `attachGridEvents()`: delegated card click handler; add chat-icon branch here
- `apps/onlydate/index.html` line ~747 — profile view render: where share button removal applies
- `apps/onlydate/index.html` line ~799 — `onMessageClick()`: extend to call `track()` before `openTelegramLink`
- `apps/onlydate/index.html` line ~839 — lightbox refs: `$lightboxMsg` click handler to extend

### State flags from prior phases
- `.planning/STATE.md` — "Phase 3 flag: Verify `navigator.sendBeacon` support in Telegram WebViews" — planner must note this as a known risk; the `fetch({keepalive})` fallback in D-12 covers it
- `.planning/STATE.md` — "Phase 3 flag: Verify `100dvh` support in Telegram iOS WebView (requires iOS 15.4+)" — `100vh` fallback in D-02 covers it; planner should document the iOS floor

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tg.openTelegramLink(url)` with `window.open(url, '_blank')` fallback — already in `onMessageClick()`; replicate this pattern in the card chat handler and lightbox handler
- `.model-card-info` overlay pattern — absolute-positioned bottom overlay with name/handle; the card chat button slots into the same overlay container at bottom-right
- Delegated event listener on `.model-grid` — `e.target.closest('.model-card')` pattern; add a `.card-chat-btn` branch before the card branch
- `escHtml()` utility — use for handle in card chat button `data-handle` attribute
- `currentProfile.username` — available in profile context for `onMessageClick` and lightbox `$lightboxMsg` handler

### Established Patterns
- All API calls: `fetch(API_BASE + '/api/...')` — `track()` follows the same `API_BASE` constant
- `'use strict'` + `var` declarations in non-async functions (legacy style) — keep consistent; `track()` uses `var`
- `async function` only for `fetchModels()` and `fetchProfile()` — `track()` is synchronous (fire-and-forget)
- Error swallowing: `.catch(function () {})` on non-critical fetches — `track()` follows this
- DOM refs: `$` prefix — e.g. `var $lightboxMsg = document.getElementById('lightbox-msg')`

### Integration Points
- `init()` function — add attribution read + `track('session_start', attr)` at the top, after `tg.ready()` / `tg.expand()`
- `showProfile()` function — add `track('profile_open', { persona_handle: profile.username })` after profile content is rendered
- `renderGrid()` — card template string: add `.card-chat-btn` button HTML inside each card
- `attachGridEvents()` — delegated listener: add `.card-chat-btn` intercept
- `onMessageClick()` — prepend `track('profile_click_chat', { persona_handle: currentProfile.username })`
- `$lightboxMsg` click handler (around line 900) — prepend same `track('profile_click_chat', ...)` call

</code_context>

<specifics>
## Specific Ideas

- `#app-wrapper` desktop constraint: `max-width: min(100vw, calc(100dvh * 9 / 16))` — from PITFALLS.md Pitfall 10, tested approach
- `sendBeacon` blob pattern: `new Blob([payload], { type: 'application/json' })` — required because `sendBeacon` doesn't set Content-Type from a plain string
- Attribution sessionStorage key: `od_attr` — short, namespaced, collision-safe
- PostHog receives these events via Phase 2's `ctx.waitUntil` relay — frontend does not call PostHog directly

</specifics>

<deferred>
## Deferred Ideas

- HTML/JS/CSS minification (PERF-04) — Phase 5 scope
- Three parallel `fetchModels()` calls on init — CONCERNS.md [LOW]; acceptable for now; optimize in a future phase
- `sessionStorage` admin password — known debt (CONCERNS.md [HIGH]); not touched here per constraint

</deferred>

---

*Phase: 03-layout-cta-and-analytics-frontend*
*Context gathered: 2026-04-16*
