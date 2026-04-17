# Phase 3: Layout, CTA and Analytics Frontend - Research

**Researched:** 2026-04-16
**Domain:** Telegram Mini App — vanilla JS frontend instrumentation, viewport/layout, deeplink CTAs
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Layout — 9:16 Portrait and Viewport**
- D-01: Add `viewport-fit=cover` to existing viewport meta tag
- D-02: Replace `min-height: 100vh` on `#grid-view` and `#profile-view` with `min-height: 100dvh` + `100vh` fallback (stacked declarations). Apply to lightbox full-height containers.
- D-03: Desktop 9:16 centering via `#app-wrapper` div with `max-width: min(100vw, calc(100dvh * 9 / 16)); margin: 0 auto; position: relative; min-height: 100dvh; background: var(--bg)`. Body background stays `var(--bg)` (#0f1115) — no separate letterbox div.
- D-04: Top safe area: `padding-top: env(safe-area-inset-top)` on `.profile-topbar` and `.tab-bar`. JS override via `Telegram.WebApp.contentSafeAreaInset.top` if CSS env resolves to 0.
- D-05: Bottom safe area: `padding-bottom: env(safe-area-inset-bottom)` on `.tab-bar` and future sticky-bottom elements.
- D-06: Keep `tg.expand()` call as-is on init.

**Chat CTA — Feed Cards**
- D-07: Card chat icon button overlaid bottom-right, always visible (not hover-only). ~32×32px tap target, semi-transparent dark circle, SVG icon.
- D-08: Card tap opens profile and fires `profile_open`. Chat icon tap fires `feed_card_click_chat` via sendBeacon then calls `openTelegramLink`. Icon tap uses `stopPropagation()`.
- D-09: Chat button HTML: `<button class="card-chat-btn" data-handle="<handle>" aria-label="Message"><svg>...</svg></button>`. Single delegated listener on `.model-grid` checking `e.target.closest('.card-chat-btn')`.
- D-10: Profile `💬 Message` button (`onMessageClick()`) extended to fire `profile_click_chat` via sendBeacon before `openTelegramLink`.
- D-11: Lightbox `#lightbox-msg` click handler extended to fire `profile_click_chat` via sendBeacon before `openTelegramLink`.

**Analytics — `track()` Client Utility**
- D-12: Single `track(eventType, extra)` function using `navigator.sendBeacon` with `Blob` wrapper (required for Content-Type), fallback to `fetch({keepalive: true})`. Uses `var` declarations (legacy style).
- D-13: Fire-and-forget. No await, no error UI, failures silently swallowed.
- D-14: `track()` called BEFORE `openTelegramLink`. Always: `track(...)` → `openTelegramLink(...)`.
- D-15: `profile_open` fires every time profile view displays — no client-side dedup.

**Analytics — `session_start` and Attribution**
- D-16: `session_start` fires once per app load in `init()` after `tg.ready()` and `tg.expand()`.
- D-17: Attribution read once at init, stored in `sessionStorage` key `od_attr` as JSON. On load: check sessionStorage first, else parse from URL + `tg.initDataUnsafe.start_param`. Code pattern specified verbatim in CONTEXT.md.
- D-18: When both `start_param` and `utm_source` present, send both. No client-side preference logic.
- D-19: `session_start` payload: `track('session_start', attr)` with all four attribution fields.

**UI Simplification (PERF-05)**
- D-20: Remove share button (`#btn-share` and `onShareClick`).
- D-21: Keep tab bar.
- D-22: Keep header/logo.
- D-23: Keep lightbox.
- D-24: Remove `💬 Message` emoji label from profile button text — defer exact icon/label styling to planner.

**Performance (PERF-01, PERF-02)**
- D-25: First card (`i === 0`) uses `loading="eager"`; all others remain `loading="lazy"`.
- D-26: All `<img>` already have `loading="lazy"` — no other PERF-02 changes needed.
- D-27: Three parallel `fetchModels()` calls are acceptable — do not serialize.
- D-28: No deferral of SDK calls needed. HTML minification is Phase 5 scope.

### Claude's Discretion
- Exact SVG icon for the card chat button — paper-plane or message bubble, whichever renders cleanly at 20×20px
- CSS animation/transition on the card chat button tap state — match `.model-card:active` scale pattern
- Exact pixel sizing and positioning of the card chat icon button
- Whether `tg.initDataUnsafe.start_param` fallback also checks `tg.initData` query params or not

### Deferred Ideas (OUT OF SCOPE)
- HTML/JS/CSS minification (PERF-04) — Phase 5 scope
- Three parallel `fetchModels()` calls optimization — acceptable for now
- `sessionStorage` admin password — known debt, not touched here
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LAYOUT-01 | User sees Mini App in 9:16 portrait on mobile | D-02 (100dvh fallback) + D-06 (expand()) handle mobile full-screen |
| LAYOUT-02 | User sees centered 9:16 portrait on Telegram Desktop, dark letterbox | D-03 (#app-wrapper with min(100vw, calc(100dvh*9/16))) — body bg matches letterbox color |
| LAYOUT-03 | Safe areas don't break layout (notch, home indicator, keyboard) | D-01 (viewport-fit=cover) + D-04/D-05 (safe-area-inset-* + JS override) + D-02 (dvh) |
| CHAT-01 | Feed card message icon opens Telegram DM | D-07/D-08/D-09 (card-chat-btn with openTelegramLink) |
| CHAT-02 | Profile page message button opens Telegram DM | D-10 (onMessageClick extended) |
| CHAT-03 | Chat CTA works on iOS, Android, Desktop without breaking session | D-12/D-14 (sendBeacon before openTelegramLink); openTelegramLink is the correct SDK method per Pitfall 3 |
| PERF-01 | Above-the-fold content prioritized | D-25 (eager load first card) |
| PERF-02 | Feed images lazy-load and decode async | D-26 (existing loading="lazy" confirmed; first card changed to eager) |
| PERF-05 | Simplified UI — non-conversion elements removed | D-20 (remove share button) + D-24 (strip emoji label) |
| TRACK-07 | Chat-CTA events captured even when tap navigates away | D-12/D-14 (sendBeacon + keepalive fetch fallback, fired before openTelegramLink) |
</phase_requirements>

---

## Summary

Phase 3 is a pure frontend change to a single file: `apps/onlydate/index.html` (943 lines). No backend changes are needed — Phase 2 shipped `POST /api/onlydate/track` and the analytics route is verified in production. The three deliverables are tightly specified in CONTEXT.md with verbatim code patterns for the critical paths.

The implementation adds five things to the existing script block: (1) a `track()` utility function using sendBeacon with Blob wrapper, (2) attribution reading + sessionStorage persistence in `init()`, (3) `session_start` event fire on init, (4) `card-chat-btn` HTML injected in card template + delegated event handler branch, (5) `profile_click_chat` instrumentation in `onMessageClick()` and the lightbox `$lightboxMsg` handler. The CSS changes are additive: `#app-wrapper` wrapper div, `100dvh` overrides, safe-area padding on `.tab-bar` and `.profile-topbar`.

The key verified risk from STATE.md is `navigator.sendBeacon` availability in Telegram WebViews — the D-12 `fetch({keepalive})` fallback covers this. The `100dvh` floor is iOS 15.4+ — the `100vh` fallback in D-02 covers older iOS. Both risks are mitigated by decisions already locked in CONTEXT.md.

**Primary recommendation:** Implement changes in order: CSS layout fixes first (can be verified visually without any JS), then `track()` utility + attribution in `init()`, then CTA buttons and handlers. This order lets each change be independently verified before building on it.

---

## Standard Stack

### Core (no new dependencies — all changes are vanilla JS / CSS)

| Asset | Location | Purpose | Status |
|-------|----------|---------|--------|
| `apps/onlydate/index.html` | `apps/onlydate/` | Single file containing all HTML, CSS, inline JS | Modify in place |
| `navigator.sendBeacon` | Browser API | Fire-and-forget POST that survives navigation | Built-in; fallback to keepalive fetch |
| `Telegram.WebApp` SDK | Loaded from `https://telegram.org/js/telegram-web-app.js` | `openTelegramLink`, `expand`, `contentSafeAreaInset`, `initDataUnsafe` | Already loaded at line 7 |
| `sessionStorage` | Browser API | Attribution persistence across WebView hot-reloads | Built-in |

### No New Dependencies

This phase introduces zero new npm packages, no build steps, and no new files beyond the HTML modification. The track endpoint at `POST https://onlydate-api.tg-saas.workers.dev/api/onlydate/track` is already deployed and accepting requests.

**Version verification:** Not applicable — no packages being installed.

---

## Architecture Patterns

### Existing Code Structure (lines verified against actual file)

```
apps/onlydate/index.html
├── <head>
│   ├── viewport meta (line 5) — needs viewport-fit=cover added
│   └── <style> block (lines 8–487) — CSS changes here
├── <body>
│   ├── #grid-view (lines 495–510) — needs #app-wrapper to wrap
│   ├── #profile-view (lines 515–525) — inside #app-wrapper
│   ├── #toast (line 530)
│   └── #lightbox (lines 535–541)
└── <script> (lines 546–940)
    ├── API_BASE constant (line 549)
    ├── tg init (lines 551–557) — session_start fires after tg.ready()
    ├── init() (lines 572–594) — attribution read + session_start added here
    ├── renderGrid() (line 620) — card-chat-btn HTML injected here
    ├── attachGridEvents() (line 671) — .card-chat-btn branch added here
    ├── renderProfile() (line 706) — share button removed, msg label trimmed
    ├── onMessageClick() (line 797) — track() prepended
    ├── onShareClick() (line 807) — DELETED (D-20)
    ├── lightbox vars (lines 839–845)
    └── $lightboxMsg click handler (line 934) — track() prepended
```

### Pattern 1: sendBeacon with Blob wrapper (TRACK-07)

**What:** `navigator.sendBeacon` requires a `Blob` with explicit Content-Type to send JSON — passing a plain string defaults to `text/plain`, which the Hono JSON parser rejects.

**When to use:** All `track()` calls before navigation.

**Example (from CONTEXT.md D-12 — canonical, do not deviate):**
```js
function track(eventType, extra) {
  var initData = tg ? tg.initData : '';
  var payload = JSON.stringify(Object.assign({
    initData:       initData,
    event_type:     eventType,
    persona_handle: null,
    start_param:    null,
    utm_source:     null,
    utm_medium:     null,
    utm_campaign:   null,
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

### Pattern 2: Attribution read + sessionStorage (CONTEXT.md D-17 — canonical)

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

### Pattern 3: Delegated event — card-chat-btn branch

The existing `attachGridEvents()` uses `e.target.closest('.model-card')`. The new branch must appear BEFORE the card branch (so the `stopPropagation` fires first):

```js
function attachGridEvents() {
  $gridContainer.addEventListener('click', function (e) {
    // chat button branch FIRST — must precede card branch
    var chatBtn = e.target.closest('.card-chat-btn');
    if (chatBtn) {
      e.stopPropagation();
      var handle = chatBtn.dataset.handle;
      if (handle) {
        track('feed_card_click_chat', { persona_handle: handle });
        var url = 'https://t.me/' + encodeURIComponent(handle);
        if (tg && tg.openTelegramLink) {
          tg.openTelegramLink(url);
        } else {
          window.open(url, '_blank');
        }
      }
      return;
    }
    // existing card branch below
    var card = e.target.closest('.model-card');
    if (card && card.dataset.username) openProfile(card.dataset.username);
  });
}
```

### Pattern 4: Desktop 9:16 letterbox wrapper (CONTEXT.md D-03)

HTML: wrap the two view divs and lightbox in `<div id="app-wrapper">`.

CSS:
```css
#app-wrapper {
  max-width: min(100vw, calc(100dvh * 9 / 16));
  margin: 0 auto;
  position: relative;
  min-height: 100dvh;
  background: var(--bg);
}
```

`<body>` background is already `var(--bg)` (#0f1115 dark) — the areas outside `#app-wrapper` inherit this, creating seamless dark letterboxing.

### Pattern 5: `loading="eager"` for first card (D-25)

```js
return (
  '<div class="model-card fade-up" data-username="' + handle + '" ' +
      'style="animation-delay:' + delay + 'ms">' +
    '<img class="model-card-img" src="' + imgSrc + '" ' +
        (i === 0 ? 'loading="eager"' : 'loading="lazy"') + ' alt="' + name + '" ' +
        'onerror="this.style.opacity=\'0\'">' +
  ...
```

### Anti-Patterns to Avoid

- **Using `window.open` for t.me links:** Will fail on iOS (Pitfall 3). Always use `tg.openTelegramLink` with `window.open` as the non-Telegram fallback only.
- **Calling `track()` after `openTelegramLink`:** The Mini App closes; the beacon will not be sent. Order MUST be: track → navigate.
- **Plain string to `sendBeacon`:** Sends as `text/plain` — Hono's `c.req.json()` will throw. Must wrap in `Blob([payload], { type: 'application/json' })`.
- **Re-reading URL params on every init:** `start_param` is lost after Telegram WebView hot-reload (Pitfall 4). The sessionStorage check in D-17 is the fix.
- **JS-computed layout for 9:16:** Computing dimensions in JS runs after paint, causing layout flicker. Pure CSS `min(100vw, calc(100dvh * 9 / 16))` computes at style-recalc time — no JS needed (per ARCHITECTURE.md Anti-Pattern 4).
- **Hardcoding `100vh` only:** On iOS Safari and Telegram iOS WebView, `100vh` includes the browser chrome, causing content to be cut off. `100dvh` is correct; `100vh` is the fallback for iOS < 15.4.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fire-and-forget POST before navigation | Custom XHR/fetch with manual lifecycle management | `navigator.sendBeacon` + keepalive fetch fallback | sendBeacon is specifically designed for this — survives tab/app close |
| Telegram deeplink | `window.open` or `location.href` | `tg.openTelegramLink` | Platform-specific routing; window.open triggers Safari handoff on iOS |
| Desktop 9:16 centering | JS resize observer computing widths | CSS `min(100vw, calc(100dvh * 9 / 16))` | No JS needed; CSS handles it at layout time; no flicker |
| Attribution persistence | Per-event URL re-parsing | sessionStorage keyed `od_attr` | start_param disappears from URL on WebView hot-reload |

---

## Common Pitfalls

### Pitfall A: sendBeacon returns `false` silently

**What goes wrong:** `navigator.sendBeacon` returns `false` when the payload is too large (browser limit: typically 64KB) or when called after the page is fully unloaded. The caller doesn't notice and the event is lost.

**Why it happens:** The code pattern checks `sent = navigator.sendBeacon(...)` and only falls back to fetch if `sendBeacon` is unavailable — not if it returns `false`.

**How to avoid:** The D-12 pattern already handles this: `sent = navigator.sendBeacon(...)` — if `sent` is `false`, the `if (!sent)` branch triggers the keepalive fetch. Verify the `if (!sent)` check is on the return value, not `if (!navigator.sendBeacon)`.

**Warning signs:** Track events missing from D1 for large payloads; no keepalive fetch fallback in code.

---

### Pitfall B: `stopPropagation` on chat button allows card click to fire profile_open

**What goes wrong:** If the `.card-chat-btn` branch in `attachGridEvents()` is placed AFTER the `.model-card` branch, the card click handler fires first (opening the profile), then bubbles to the chat button handler. `stopPropagation` only stops upward bubbling, not the already-fired parent handler.

**Why it happens:** Event delegation checks the wrong order. The parent `.model-card` is an ancestor of `.card-chat-btn`, so `e.target.closest('.model-card')` matches even when the user clicks the chat button.

**How to avoid:** Always check `.card-chat-btn` FIRST in the delegated listener, call `e.stopPropagation()`, and `return` before the `.model-card` check. This is explicit in the D-09 pattern and Pattern 3 code above.

---

### Pitfall C: `#app-wrapper` breaks the lightbox `position: fixed`

**What goes wrong:** `#lightbox` uses `position: fixed; inset: 0` to cover the entire viewport. If `#app-wrapper` has `position: relative` AND `transform` or `filter`, CSS creates a new stacking context that makes `position: fixed` relative to the wrapper, not the viewport — the lightbox appears clipped to the 9:16 column.

**Why it happens:** D-03 sets `position: relative` on `#app-wrapper`. This alone does NOT create a new containing block for fixed positioning. Only `transform`, `filter`, `will-change: transform`, or `backdrop-filter` on an ancestor do.

**How to avoid:** Ensure `#app-wrapper` CSS does NOT include `transform`, `filter`, `perspective`, or `backdrop-filter`. The D-03 spec is clean: only `max-width`, `margin`, `position: relative`, `min-height`, and `background`. Move `#lightbox` and `#toast` outside of `#app-wrapper` in the HTML — they are already placed after the view divs in the existing DOM and should stay outside the wrapper.

---

### Pitfall D: `contentSafeAreaInset.top` JS override timing

**What goes wrong:** `Telegram.WebApp.contentSafeAreaInset` is populated asynchronously after the WebApp is fully initialized. Reading it before `tg.ready()` returns 0 for all insets.

**Why it happens:** The Telegram SDK fires initialization events asynchronously. Safe area insets are only available after the native Telegram shell reports them.

**How to avoid:** Read `contentSafeAreaInset` inside `init()` after `tg.ready()` is called (which is already called at the top of the script block, before `init()`). The D-04 pattern specifies it as a JS override — apply it by setting a CSS variable or inline style on the `.tab-bar` element inside `init()`:

```js
if (tg && tg.contentSafeAreaInset && tg.contentSafeAreaInset.top > 0) {
  $tabBar.style.paddingTop = tg.contentSafeAreaInset.top + 'px';
}
```

---

### Pitfall E: `tg.initData` is empty string in non-Telegram browsers

**What goes wrong:** `track()` sends `initData: ''` when the app is opened outside Telegram (e.g., during local development with `wrangler dev`). The backend `verifyInitData('')` returns `false` and the track endpoint returns 403.

**Why it happens:** `tg.initData` is only populated when the app is launched via Telegram. Outside Telegram, the SDK still loads but `initData` is an empty string.

**How to avoid:** This is expected behavior — tracking is only valid from within Telegram. The `track()` function already handles this gracefully because failures are silently swallowed (D-13). The 403 is caught by `.catch(function () {})`. No special handling needed; document it as expected in development.

---

## Code Examples

### Track endpoint request body shape (from `analytics.ts` — verified)

```typescript
// POST /api/onlydate/track
// Body fields (all required at top level; nulls accepted):
{
  initData:       string;   // tg.initData raw string
  event_type:     string;   // 'session_start' | 'profile_open' | 'feed_card_click_chat' | 'profile_click_chat'
  persona_handle: string | null;
  start_param:    string | null;
  utm_source:     string | null;
  utm_medium:     string | null;
  utm_campaign:   string | null;
}
// Response: { ok: true } | { error: string }
```

Event type strings that the backend already accepts (verified in analytics.ts line 21-31): free-form string — the backend stores whatever `event_type` is sent. The four event types for this phase are: `session_start`, `profile_open`, `feed_card_click_chat`, `profile_click_chat`.

### Card chat button HTML (from CONTEXT.md D-09)

```html
<button class="card-chat-btn" data-handle="<handle>" aria-label="Message">
  <svg><!-- paper-plane icon --></svg>
</button>
```

Insert inside the `.model-card-info` div in `renderGrid()`, or as a sibling to `.model-card-info` at the same stacking level. CSS positions it at bottom-right, above the text overlay.

### Suggested card-chat-btn CSS

```css
.card-chat-btn {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
  transition: background 0.14s, transform 0.14s;
  -webkit-tap-highlight-color: transparent;
}
.card-chat-btn:active {
  background: rgba(255, 255, 255, 0.2);
  transform: scale(0.92);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `window.open` for t.me links | `tg.openTelegramLink` | Telegram WebApp SDK v6+ | No Safari handoff on iOS; Mini App session handled correctly |
| `100vh` for full-height | `100dvh` with `100vh` fallback | CSS baseline (iOS 15.4, Chrome 108) | Correct behavior when browser chrome changes height dynamically |
| Hardcode safe area padding | `env(safe-area-inset-*)` CSS + Telegram SDK `contentSafeAreaInset` | iOS 11+ / Telegram SDK v6.9+ | Works with notch, Dynamic Island, home indicator |
| Analytics fire-and-forget fetch | `navigator.sendBeacon` with Blob | Widely supported as of 2019 | Survives navigation/app close; no keepalive flag needed |

**Deprecated/outdated patterns currently in this codebase:**
- `100vh` only on `#grid-view` and `#profile-view` (line 40-41) — causes content cutoff on iOS when Telegram chrome is present. Fixed by D-02.
- No `viewport-fit=cover` on the viewport meta (line 5) — `env(safe-area-inset-*)` is never populated without it. Fixed by D-01.
- Share button (`#btn-share`) — identified as non-conversion UI. Removed by D-20.

---

## Open Questions

1. **`tg.initData` availability during sendBeacon race**
   - What we know: `tg.initData` is set synchronously after `tg.ready()`. The script block calls `tg.ready()` before `init()`, so by the time any user interaction fires `track()`, `tg.initData` should be populated.
   - What's unclear: Whether a very fast user tap on a card before `init()` completes could fire `track()` with `tg.initData = ''`. In practice, `init()` is the first thing called and grid events are attached inside `init()` — so no event listener is active before `init()` runs. Risk is negligible.
   - Recommendation: No action needed. Document as expected.

2. **`navigator.sendBeacon` in Telegram iOS WebView (STATE.md Phase 3 flag)**
   - What we know: sendBeacon is supported in iOS 11.3+ (Safari 11.1+). Telegram iOS WebView is based on WKWebView which tracks Safari's web platform features. As of iOS 15+, sendBeacon is well-supported.
   - What's unclear: Exact minimum Telegram iOS version where sendBeacon works. Telegram has a broad install base including very old iOS versions.
   - Recommendation: D-12 keepalive fetch fallback is the correct mitigation. The `if (!sent)` branch covers the case where sendBeacon returns false or is unavailable. No additional action required — the fallback is already in the locked decision.

3. **`100dvh` in Telegram iOS WebView (STATE.md Phase 3 flag)**
   - What we know: `dvh` requires iOS 15.4+. Telegram's iOS WebView uses WKWebView which supports `dvh` on iOS 15.4+.
   - What's unclear: What percentage of the user base is on iOS < 15.4 (released 2022). The `100vh` fallback in D-02 ensures older iOS gets `100vh` behavior (acceptable, not ideal).
   - Recommendation: Implement with stacked declarations (`min-height: 100vh; min-height: 100dvh`) as specified in D-02. No additional action.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | wrangler dev, build tooling | Yes | v24.11.1 | — |
| wrangler | Local dev, deploy | Yes | 4.69.0 | — |
| POST /api/onlydate/track | analytics instrumentation | Yes (Phase 2 shipped) | — | — |
| `navigator.sendBeacon` | TRACK-07 | Runtime (Telegram WebView) | varies | keepalive fetch (D-12) |
| `100dvh` CSS unit | LAYOUT-03 | Runtime (iOS 15.4+) | — | `100vh` fallback (D-02) |
| `env(safe-area-inset-*)` | LAYOUT-03 | Runtime (requires viewport-fit=cover) | — | JS override via contentSafeAreaInset (D-04) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** sendBeacon and dvh both have explicit fallbacks defined in locked decisions.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None — zero automated tests exist (see TESTING.md) |
| Config file | None |
| Quick run command | `pnpm typecheck` (TypeScript only; no runtime assertions) |
| Full suite command | `pnpm typecheck` |

No test infrastructure exists. The project quality gate is TypeScript compilation + manual smoke-testing via wrangler dev + Telegram client.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LAYOUT-01 | Portrait fill on mobile Telegram | visual/manual | — (no CSS test tooling) | N/A — manual only |
| LAYOUT-02 | 9:16 centered on Desktop, dark letterbox | visual/manual | — | N/A — manual only |
| LAYOUT-03 | Safe areas don't break layout | visual/manual | — | N/A — manual only |
| CHAT-01 | Feed card chat icon opens DM | manual (Telegram client) | — | N/A — manual only |
| CHAT-02 | Profile message button opens DM | manual (Telegram client) | — | N/A — manual only |
| CHAT-03 | Works iOS/Android/Desktop | manual (three platforms) | — | N/A — manual only |
| PERF-01 | First card loads eagerly | inspect network tab | — | N/A — manual only |
| PERF-02 | Other images lazy-load | inspect network tab | — | N/A — manual only |
| PERF-05 | Share button absent; simplified UI | DOM inspection | — | N/A — manual only |
| TRACK-07 | Events land in D1 before navigation | D1 query after tap | — | N/A — manual only |

All requirements are verifiable manually. TypeScript has nothing to typecheck in this phase (vanilla JS only — HTML file has no `.ts` compilation).

### Sampling Rate

- **Per task commit:** Manual visual check in browser (Telegram WebApp or wrangler dev + browser)
- **Per wave merge:** `pnpm typecheck` (ensures worker TypeScript unchanged) + manual smoke test in Telegram iOS
- **Phase gate:** All 5 acceptance criteria TRUE before `/gsd:verify-work`

### Wave 0 Gaps

None — no test framework setup is planned for this phase. All changes are to `apps/onlydate/index.html` (vanilla JS/CSS). Testing is manual per TESTING.md documented status.

---

## Project Constraints (from CLAUDE.md)

The following directives from CLAUDE.md apply to this phase:

- **Tech stack:** Stay on Cloudflare Workers + D1 + R2 + vanilla JS frontend. No frontend framework. (This phase is vanilla JS only — compliant.)
- **Compatibility:** Existing Mini App URL must keep working. New query params allowed. (Phase 3 reads `utm_*` from URL but does not add or remove params — compliant.)
- **Identity:** `initData` sent to backend for server-side HMAC validation — do not trust `initDataUnsafe` on the server. (The `track()` function sends `tg.initData` raw string; the backend validates it. `initDataUnsafe.start_param` is used CLIENT-SIDE only for attribution reading, not for server-side identity — compliant.)
- **Privacy / content:** Do not make admin password security worse. (This phase does not touch admin auth — compliant.)
- **`personas`:** Stays read-only. (Phase 3 is frontend-only — compliant.)
- **Style:** `'use strict'` + `var` declarations in non-async functions. `$` prefix for DOM refs. `UPPER_SNAKE_CASE` for constants. Error swallowing with `.catch(function () {})` for non-critical. Match existing style throughout.
- **GSD workflow:** Execute through `/gsd:execute-phase` — no direct file edits outside GSD.

---

## Sources

### Primary (HIGH confidence)

- `apps/onlydate/index.html` (verified, read in full at 943 lines) — existing DOM structure, line numbers for all integration points
- `apps/onlydate-worker/src/routes/analytics.ts` (verified, read in full) — confirmed endpoint URL, request body shape, event_type field is free-form string, `initData` required
- `.planning/phases/03-layout-cta-and-analytics-frontend/03-CONTEXT.md` — locked implementation decisions with verbatim code patterns
- `.planning/research/PITFALLS.md` — Pitfalls 3, 4, 10 directly applicable to this phase
- `.planning/codebase/TESTING.md` — confirmed zero test infrastructure
- `.planning/codebase/CONCERNS.md` — confirmed `[LOW]` concern on three parallel fetch calls (deferred per D-27)

### Secondary (MEDIUM confidence)

- Telegram Mini App SDK behavior for `openTelegramLink` vs `window.open` — sourced from PITFALLS.md which cites `https://core.telegram.org/bots/webapps`
- `navigator.sendBeacon` with Blob requirement for JSON Content-Type — well-established browser behavior, confirmed by the CONTEXT.md explicit note on Blob usage

### Tertiary (LOW confidence)

- Exact iOS minimum version for `100dvh` (15.4) — from PITFALLS.md training data; verify with MDN if exact floor matters
- `navigator.sendBeacon` availability in specific Telegram iOS WebView versions — operational risk flagged in STATE.md; covered by fallback

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all APIs are browser-native or already in the codebase
- Architecture: HIGH — single file modification; all integration points verified by reading actual source
- Pitfalls: HIGH — sourced from project-specific PITFALLS.md and verified against actual code patterns
- Validation: HIGH (absence) — TESTING.md confirms zero test infrastructure; manual testing is the documented path

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable domain; Telegram SDK is slow-moving)
