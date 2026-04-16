# Domain Pitfalls

**Domain:** Telegram Mini App — feed/profile funnel with analytics, admin ordering/promotion, deeplink CTAs
**Project:** OnlyDate
**Researched:** 2026-04-16
**Confidence:** MEDIUM — Telegram Bot API and Mini App SDK are well-documented; Cloudflare D1/Workers limits are documented in official CF docs; PostHog Worker usage is less commonly documented, lowering confidence there to LOW/MEDIUM.

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or broken funnels.

---

### Pitfall 1: Trusting `initDataUnsafe` Without Server-Side HMAC Validation

**What goes wrong:** The frontend reads `window.Telegram.WebApp.initDataUnsafe.user.id` and sends it to the Worker as the identity for analytics events. The Worker trusts it as-is.

**Why it happens:** `initDataUnsafe` is immediately available with no async call, so it is easy to use as the quick path. `initData` (the raw string that must be validated) feels redundant to developers who see the same data.

**Consequences:**
- Any user can forge `initData` with a different `user_id`, attributing their events to another user's ID, or injecting arbitrary funnel data.
- Attribution becomes polluted — a competitor or curious user can inject fake "chat click" events against real Telegram IDs.
- At 10k DAU the noise from even a handful of forged events makes funnel data untrustworthy.

**Prevention:**
1. Send the raw `initData` string (not `initDataUnsafe`) to the Worker with every analytics-write call.
2. On the Worker, reconstruct the HMAC-SHA256 check-string by:
   - Splitting `initData` on `&`.
   - Removing the `hash=` field.
   - Sorting the remaining pairs alphabetically by key.
   - Joining with `\n`.
   - HMAC-SHA256 the result using `HMAC-SHA256("WebAppData", BOT_TOKEN)` as the key (note: this double-HMAC is Mini App-specific — **not** the same as the Telegram Login Widget which uses `SHA256(BOT_TOKEN)` directly).
3. Compare the result to the `hash` field with a timing-safe compare.
4. Reject with 403 if the hash does not match.
5. Enforce `auth_date` freshness: reject events where `Date.now()/1000 - auth_date > 86400` (24 hours is the standard; use a tighter window if sessions are short-lived).

**Warning signs:**
- Analytics events that reference Telegram user IDs that don't correspond to any real session you can correlate.
- `auth_date` values far in the past.
- The Worker reads from `initDataUnsafe` in the request body rather than `initData`.

**Phase:** Analytics / Event Tracking phase (any phase that writes user-scoped D1 events). Must be done before any analytics data is trusted.

---

### Pitfall 2: Admin Password in `sessionStorage` Inherited by New Admin Endpoints

**What goes wrong:** Every new admin endpoint (reorder, promote, toggle visibility) added this milestone inherits the current auth pattern: the frontend reads `sessionStorage.getItem('od_admin_pw')` and sends it as `X-Admin-Password`. The Worker compares it against the hardcoded `ADMIN_PASSWORD` constant in source. Adding more admin endpoints does not make the situation worse in degree, but it widens the blast radius — more actions are attackable once the password is obtained.

**Why it happens:** The pattern is already in place and it is the path of least resistance when extending the admin UI.

**Consequences:**
- The plaintext password is visible to any script on the same origin (XSS, rogue browser extension, devtools).
- The hardcoded password in source means every developer with repo access knows the production admin credential with no rotation path.
- New reorder/promote endpoints use the same credential, so the existing exposure directly enables reordering or mass-promoting/demoting profiles.

**Prevention:**
1. **This milestone should rotate the password out of source.** The fix is already documented in CONCERNS.md: replace the `ADMIN_PASSWORD` constant with `c.env.ADMIN_PASSWORD` and provision via `wrangler secret put ADMIN_PASSWORD`. This is a one-hour change and should be a prerequisite for the admin-expansion phase.
2. Do not add new admin endpoints before the secret rotation is done — each one widens the surface without fixing the root cause.
3. The `sessionStorage` issue is a follow-on concern (replace stored password with a short-lived token from a login endpoint), but secret rotation is the higher-priority step.

**Warning signs:**
- `ADMIN_PASSWORD` still appears as a string literal in `apps/onlydate-worker/src/index.ts`.
- New admin routes (reorder, promote) are merged before the rotation PR.

**Phase:** Admin Ordering / Admin Promotion phases. Secret rotation must land before or with the first admin-expansion phase.

---

### Pitfall 3: `t.me/<handle>` Deeplink Behavior — Mini App Closes vs Stays Open

**What goes wrong:** Using `window.open('https://t.me/<handle>', '_blank')` from inside a Telegram Mini App does not open a Telegram DM. On iOS the system Safari intercepts the URL, briefly opens Safari, then hands it to Telegram — which may or may not reopen the Mini App afterwards. On Android the behavior varies by Telegram version. In both cases the Mini App is either closed or loses focus, and the navigation away from `t.me/` is not tracked.

**Why it happens:** `window.open` is a browser-level call that does not go through Telegram's routing layer.

**Consequences:**
- The user ends up in the DM (the primary goal), but the Mini App is closed — this is acceptable functionally.
- On iOS Safari the URL may fail to route into Telegram at all if the Telegram URL scheme (`tg://resolve?domain=<handle>`) is used instead of `https://t.me/`.
- If the intent is to track that the chat tap happened before navigating away, the tracking call must complete before navigation — fire-and-forget `fetch()` calls will be killed when the app closes.

**Prevention:**
1. Use `window.Telegram.WebApp.openTelegramLink('https://t.me/<handle>')` — this is the correct Telegram SDK method. It routes through Telegram's internal scheme and reliably opens the DM on both platforms without the Safari handoff dance.
2. The Mini App will close after `openTelegramLink` on most platforms — this is expected and acceptable for a "go chat" CTA.
3. Fire the analytics event (`feed_card_click_chat` / `profile_click_chat`) **before** calling `openTelegramLink`, using `await fetch(...)` or a synchronous beacon: `navigator.sendBeacon('/api/analytics/event', payload)`. Do not rely on the fetch completing after navigation.
4. Do not use `openLink` (the generic SDK method for external URLs) for `t.me` links — `openTelegramLink` is specifically meant for Telegram-internal destinations.

**Warning signs:**
- Code calls `window.open('https://t.me/...')` or `location.href = 'https://t.me/...'` instead of the SDK method.
- Analytics events for chat clicks appear in D1 significantly less often than expected given the tap count.
- Users on iOS report "opens Safari then nothing happens."

**Phase:** Chat CTA phase.

---

### Pitfall 4: Attribution Loss — `start_param` and `utm_*` Survive Only Once

**What goes wrong:** `tgWebAppStartParam` is only present in the initial URL that Telegram passes to the Mini App. If Telegram re-uses a cached Mini App WebView (hot reload / fast resume), the start_param from the original launch is gone. Similarly, `utm_*` params in the Mini App URL are consumed on first load; client-side navigation or Telegram's internal state restoration does not replay them.

**Why it happens:** Telegram caches Mini App WebViews aggressively, especially on iOS. A returning user's WebView may resume from the previous session's JS state without a fresh URL parse. The `window.location.search` will reflect the current (stale or empty) state, not the original launch URL.

**Consequences:**
- Attribution appears "organic" for returning users who originally came from a paid ad, because `start_param` was only present on the first ever launch.
- Double-counting if both `start_param` and `utm_source` are present and both are recorded as separate attribution sources for the same session.
- Lost attribution when the Mini App is re-opened from Telegram's recent apps list rather than through the bot link.

**Prevention:**
1. Capture attribution on the **first event of a session**, not on every event. Use `Telegram.WebApp.initDataUnsafe.start_param` (available even in `initDataUnsafe` without server validation, but validate server-side before storing).
2. Persist the resolved attribution source in `localStorage` with a session key. On subsequent events within the same session, read from `localStorage` rather than re-parsing the URL.
3. For cross-session attribution (is this the same ad campaign on a return visit?), use the D1 `analytics_sessions` or `analytics_events` table to check if this `user_id` already has an attributed source from a previous session and decide whether to overwrite.
4. When both `start_param` and `utm_source` are present, prefer `start_param` (Telegram-native) as the primary source and store `utm_source` as a secondary field. Do not count them as two separate acquisition events.
5. Record `tgWebAppStartParam` from `window.Telegram.WebApp.initDataUnsafe.start_param` immediately on load — not lazily — because Telegram can call `onEvent('activated', ...)` later without re-supplying it.

**Warning signs:**
- Attribution table shows >80% organic for a campaign that was clearly paid.
- D1 events for the same `user_id` show different `start_param` values across sessions (first correct, subsequent null).
- Both `start_param` and `utm_source` columns are populated in the same event row, and they are being counted independently in the PostHog funnel.

**Phase:** Analytics / Attribution phase.

---

## Moderate Pitfalls

---

### Pitfall 5: PostHog from a Cloudflare Worker — Dropped Events via Missing `ctx.waitUntil`

**What goes wrong:** The Worker fires a `fetch()` to the PostHog ingestion endpoint inside a request handler. If the `fetch` is not awaited and not registered with `ctx.waitUntil()`, Cloudflare will terminate the Worker isolate as soon as the handler returns a response. The in-flight PostHog request is killed.

**Why it happens:** In a standard `async` Hono route, returning `c.json(...)` resolves the response. Any unawaited background work after that point runs in a race against isolate shutdown.

**Consequences:**
- PostHog event delivery is intermittent and non-deterministic. Under load, most events are dropped silently.
- D1 events are written correctly (they are awaited before response), but PostHog shows a fraction of the real funnel — leading to incorrect conversion analysis.

**Prevention:**
1. Wrap the PostHog dispatch in `ctx.waitUntil(sendToPostHog(...))`. This tells the Workers runtime to keep the isolate alive until the promise resolves, without blocking the user's response.
2. Example pattern in Hono:
   ```typescript
   app.post('/api/analytics/event', async (c) => {
     const ctx = c.executionCtx; // ExecutionContext
     const payload = await c.req.json();
     await writeToD1(c.env.DB, payload);            // awaited, blocks response
     ctx.waitUntil(sendToPostHog(payload, c.env));  // non-blocking, survives response
     return c.json({ ok: true });
   });
   ```
3. PostHog's `/capture` endpoint is free-tier compatible. Use the batch endpoint (`/batch`) for efficiency if multiple events are sent per request.

**Warning signs:**
- D1 event count and PostHog event count diverge significantly (D1 higher).
- PostHog events appear in PostHog intermittently — some sessions are complete, others have only 1-2 events out of 5+ expected.
- No `ctx.waitUntil` call appears near the PostHog dispatch code.

**Phase:** Analytics / PostHog integration phase.

---

### Pitfall 6: PostHog `distinctId` Collision — Using Raw Telegram `user_id`

**What goes wrong:** Telegram `user_id` is a 64-bit integer in the range of 1–10^10+. PostHog uses the same `distinctId` namespace for all sources. If the same PostHog instance also receives events from non-Telegram sources (web, iOS app, etc.) that use numeric IDs or sequential integers, IDs can collide.

**Consequences:**
- A Telegram user's funnel is merged with an unrelated user's session from a different channel.
- Cohort analysis is corrupted for any user whose Telegram ID happens to match another channel's ID.

**Prevention:**
1. Prefix all Telegram-sourced `distinctId` values: `tg_${user_id}` rather than bare `user_id`.
2. Apply this prefix consistently in every Worker call to PostHog — never pass the bare integer.
3. If the PostHog instance is shared with a non-Telegram product, add a `channel: 'telegram'` property to all events for segmentation.

**Warning signs:**
- PostHog profiles show impossibly mixed behavior (web session data merged with Telegram session data).
- `distinctId` in PostHog events is a bare integer string without a prefix.

**Phase:** Analytics / PostHog integration phase.

---

### Pitfall 7: PostHog PII Capture — Telegram `first_name` / `last_name` / `username`

**What goes wrong:** The Worker logs `initDataUnsafe.user.first_name`, `last_name`, or `username` as PostHog person properties. If PostHog is self-hosted these fields are stored in the PostHog database; if using the cloud free tier they leave the operator's infrastructure. Telegram's ToS and GDPR both restrict forwarding user PII to third parties without explicit consent.

**Prevention:**
1. Never send `first_name`, `last_name`, `username`, or `photo_url` to PostHog.
2. The only safe person identifier is the prefixed `tg_${user_id}` — a pseudonymous ID.
3. If user language or locale is needed for segmentation, `language_code` is lower-risk than a name.
4. Review PostHog's person properties UI to confirm no PII was accidentally auto-captured.

**Warning signs:**
- PostHog person profile pages show real names or usernames.
- Worker code passes `user` object properties directly as PostHog event properties.

**Phase:** Analytics / PostHog integration phase. Also applies if any future phase adds enriched person profiles.

---

### Pitfall 8: D1 Append-Only Analytics Table Growth at 10k DAU

**What goes wrong:** At 10k DAU × 3 events/session × 30 days = 900,000 rows/month, ~10.8M rows/year. D1's size limit is 10 GB per database (as of 2025). Each analytics row (user_id, event_name, persona_id, attribution, timestamp) is approximately 200 bytes, so 10M rows ≈ 2 GB in data alone — reachable within 2 years at current scale. More immediately: D1 read performance degrades on very large tables without proper indexing, and `SELECT COUNT(*) WHERE ...` full-scans on millions of rows can hit D1's 1000ms CPU time limit.

**Consequences:**
- Dashboard queries slow down progressively as the table grows.
- A full-scan attribution query ("all users who clicked chat in the last 7 days") times out for large date ranges.
- The D1 10 GB limit is eventually breached, causing write failures in production.

**Prevention:**
1. Add a composite index on `(event_name, created_at)` and a separate index on `(user_id, created_at)` at table creation time.
2. Implement a retention policy from day one: a scheduled Cloudflare Worker Cron that `DELETE FROM analytics_events WHERE created_at < unixepoch() - 7776000` (90 days) runs weekly. D1 Cron Triggers are free.
3. For long-term retention, export aged-out rows to R2 as newline-delimited JSON before deletion (write a small cursor-based export into a dated R2 key). Cost: R2 write operations are cheap and storage is $0.015/GB/month.
4. Keep PostHog as the analytical query layer — raw D1 events are the append log; PostHog is the query interface. This means D1 only needs to retain enough raw data to re-seed PostHog if needed (30-90 days), not the full history.
5. For the aggregated "number of clicks per profile today" admin dashboard widget, maintain a separate `analytics_daily_summary` table updated by the same Worker event handler, rather than querying raw events in real time.

**Warning signs:**
- `SELECT COUNT(*) FROM analytics_events` takes more than 200ms.
- No `DELETE` or archival job exists for the analytics table.
- No index on `created_at` in the analytics table DDL.

**Phase:** Analytics phase (schema design). Retention/archival can be Phase 2 of analytics, but the index and schema must be correct from day one.

---

### Pitfall 9: Drag-and-Drop in Vanilla JS — Touch vs Pointer Events on Mobile

**What goes wrong:** HTML5 Drag and Drop API (`draggable=true`, `ondragstart`, `ondrop`) does not work on mobile browsers, including the WebView inside Telegram Mini Apps on iOS and Android. Touch devices do not fire `dragstart` events; they fire `touchstart`/`touchmove`/`touchend` or `pointerdown`/`pointermove`/`pointerup`.

**Consequences:**
- Admin reorder UI works on desktop Telegram but is completely non-functional on mobile Telegram.
- `touchmove` during a drag also scrolls the page — the two gestures conflict unless `e.preventDefault()` is called on `touchmove`, which itself has side effects (blocks accessibility scroll on the whole page).
- Accidental drag triggers on short taps: if drag starts on `pointerdown` without a minimum movement threshold (e.g., 5px), a tap on a button inside a draggable card triggers a drag instead of the button's click.

**Prevention:**
1. Do not use the HTML5 drag-and-drop API for mobile admin drag-to-reorder. Use Pointer Events (`pointerdown`, `pointermove`, `pointerup`) which unify mouse and touch under one API.
2. Implement a minimum drag-start threshold: only transition to drag-mode if the pointer moves more than 8px from its `pointerdown` origin. This prevents taps on buttons inside the card from triggering drags.
3. Call `e.preventDefault()` on `pointermove` only after the drag threshold is exceeded and you have already called `element.setPointerCapture(e.pointerId)`. This avoids blocking page scroll when the user is not dragging.
4. During a drag, set `touch-action: none` on the draggable item via inline style and restore it on `pointerup`/`pointercancel`.
5. Visual feedback: clone the dragged element and position the clone absolutely under the pointer (`position: fixed; pointer-events: none`) rather than moving the real element — this avoids layout recalculations for each pointermove event.
6. The 1411-line `photochoose/index.html` already has complex DOM manipulation patterns; add the drag logic in a self-contained function block with a clear "DRAG-TO-REORDER" comment section to keep it maintainable.

**Warning signs:**
- Using `addEventListener('dragstart', ...)` — will not fire on mobile.
- `touchmove` handler calls `e.preventDefault()` unconditionally — will break scroll everywhere.
- No drag threshold check before entering drag mode.

**Phase:** Admin Ordering phase.

---

### Pitfall 10: Telegram Mini App Viewport on Desktop — 9:16 Centering and Keyboard Handling

**What goes wrong:** On desktop Telegram, the Mini App opens in a resizable panel. Forcing a 9:16 portrait viewport via CSS (max-width, aspect-ratio, centered container) conflicts with how Telegram Desktop allocates viewport space. On mobile, when the software keyboard appears (relevant for any admin text input or future search), the viewport height shrinks — `100vh` and `100dvh` behave differently across iOS Safari, Chrome on Android, and Telegram's own WebView.

**Specific breakages:**
1. **Desktop centering:** Setting `max-width: calc(100vh * 9/16)` on a centered `#app` div works visually but causes Telegram Desktop to show a gray sidebar beside the app content. The Mini App JS SDK's `Telegram.WebApp.expand()` will expand to fill the entire available panel, which may be wider than 9:16 on a widescreen monitor.
2. **iOS keyboard:** On iOS, when a text input is focused in the Mini App, the WebView viewport shrinks. Elements with `position: fixed; bottom: 0` (chat CTAs, sticky footers) jump up on top of the keyboard rather than staying below the visible area. Using `100dvh` (dynamic viewport height) mitigates this but `dvh` is not supported on older iOS versions (< iOS 15.4).
3. **Telegram top bar height:** Telegram Desktop adds a title bar above the Mini App. Its height varies between Telegram versions (approximately 56px on iOS, varies on Android, absent on desktop). The Mini App SDK exposes `Telegram.WebApp.safeAreaInset.top` and `contentSafeAreaInset.top` for this — use them rather than hardcoding a pixel value.
4. **`viewport` meta tag:** The standard `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` is required. Without `viewport-fit=cover`, `env(safe-area-inset-*)` CSS variables are not populated, and content appears behind the iOS notch or dynamic island.

**Prevention:**
1. Use `env(safe-area-inset-top)` and `Telegram.WebApp.contentSafeAreaInset.top` for top padding — do not hardcode.
2. For the 9:16 desktop container: apply `max-width: min(100vw, calc(100dvh * 9 / 16)); margin: 0 auto;` on a wrapper div. This constrains width to portrait ratio without breaking on tall screens.
3. For sticky bottom elements (chat CTA bar), use `padding-bottom: env(safe-area-inset-bottom)` to avoid the iOS home indicator overlap.
4. Avoid `100vh` for full-height layouts; use `100dvh` with a `100vh` fallback for older browsers.
5. Call `Telegram.WebApp.expand()` on load to ensure the Mini App takes all available vertical space in Telegram's panel before measuring dimensions.
6. Test on: Telegram Desktop (macOS/Windows), Telegram iOS (notch device), Telegram Android (mid-range device). These three platforms will surface all significant layout issues.

**Warning signs:**
- Bottom CTAs disappear behind keyboard on iOS.
- Content is clipped by the iOS notch/dynamic island.
- On Telegram Desktop the app appears letterboxed with Telegram's gray background visible.

**Phase:** Layout / Viewport phase (first phase of this milestone).

---

### Pitfall 11: `initData` HMAC Sorting — Mini App vs Telegram Login Widget Difference

**What goes wrong:** The Telegram documentation describes two different HMAC schemes that look similar but use different key derivation:
- **Mini App (`initData`):** Key = `HMAC-SHA256("WebAppData", BOT_TOKEN)`. The string `"WebAppData"` is the HMAC key input, and `BOT_TOKEN` is the HMAC key.
- **Telegram Login Widget:** Key = `SHA256(BOT_TOKEN)` (simple hash, not HMAC). The sorted field string is the same format but the key is derived differently.

Using the Login Widget derivation for Mini App validation (or vice versa) produces a different HMAC and fails silently — the comparison returns false and all events are rejected.

**Prevention:**
1. Use exactly `HMAC-SHA256(data_check_string, HMAC-SHA256("WebAppData", bot_token))` — that is, the key is itself an HMAC of the literal string `"WebAppData"`.
2. The Web Crypto API implementation in a Cloudflare Worker:
   ```typescript
   async function verifyInitData(initData: string, botToken: string): Promise<boolean> {
     const params = new URLSearchParams(initData);
     const hash = params.get('hash');
     params.delete('hash');
     const dataCheckString = [...params.entries()]
       .sort(([a], [b]) => a.localeCompare(b))
       .map(([k, v]) => `${k}=${v}`)
       .join('\n');
     const encoder = new TextEncoder();
     const secretKey = await crypto.subtle.importKey(
       'raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
     );
     const secretKeyBytes = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
     const dataKey = await crypto.subtle.importKey(
       'raw', secretKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
     );
     const sig = await crypto.subtle.sign('HMAC', dataKey, encoder.encode(dataCheckString));
     const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
     return computed === hash;
   }
   ```
3. Always check `auth_date` after a valid signature — a replayed old token with a valid signature should still be rejected.

**Warning signs:**
- Validation always fails even with legitimate initData (wrong key derivation).
- Validation always passes even with tampered data (forgot to actually compare, or compared wrong field).
- `SHA256(BOT_TOKEN)` appears in the validation code instead of `HMAC-SHA256("WebAppData", BOT_TOKEN)`.

**Phase:** Analytics / Server-side validation phase.

---

### Pitfall 12: Promotion Star Animation — 60fps on Low-End Android

**What goes wrong:** An infinite CSS animation using `top`, `left`, `width`, or `height` forces layout recalculation on every frame (layout thrashing). On low-end Android devices (1-2GB RAM, budget Snapdragon) this drops from 60fps to 15-20fps, causing the entire feed to stutter while the animation runs. Battery drain compounds because the GPU must repaint continuously even when nothing else is changing.

**Consequences:**
- The feed feels janky on the exact demographic most likely to be using budget Android phones.
- Battery drain may cause Telegram to throttle the Mini App WebView on prolonged use.

**Prevention:**
1. Animate only `transform` and `opacity` — these run on the compositor thread and do not trigger layout or paint. `transform: scale()`, `transform: translateX/Y()`, and `opacity` are free (GPU-composited).
2. Add `will-change: transform, opacity` to animated elements before the animation starts. Remove it after the animation ends via `animationend` event — `will-change` on many elements simultaneously increases VRAM usage.
3. Use `@keyframes` with `transform` only:
   ```css
   @keyframes sparkle {
     0%   { transform: scale(0) rotate(0deg); opacity: 0; }
     50%  { transform: scale(1.2) rotate(180deg); opacity: 1; }
     100% { transform: scale(0) rotate(360deg); opacity: 0; }
   }
   ```
4. For the star frame (border effect around the card), prefer a CSS `box-shadow` or `outline` animation to avoid painting the card background. Alternatively, overlay a pseudo-element (`::before`/`::after`) that is the only animated layer.
5. Infinite animations that run constantly for every promoted profile (even when off-screen) waste battery. Use `animation-play-state: paused` for cards not in the viewport, toggled via an IntersectionObserver.
6. Test on a real low-end Android device or Telegram's Android beta on a throttled emulator (Chrome DevTools CPU 6x throttle as a proxy).

**Warning signs:**
- Animation uses `top`, `left`, `margin`, or `width` in keyframes.
- `will-change: transform` is set globally on all feed cards (not just promoted ones).
- No IntersectionObserver pauses animations for off-screen cards.
- Chrome DevTools Performance tab shows "Layout" blocks in the flame chart during the animation.

**Phase:** Admin Promotion / Promotion UI phase.

---

## Minor Pitfalls

---

### Pitfall 13: Image Optimization — CF Image Resizing is a Paid Feature

**What goes wrong:** Cloudflare Image Resizing (`/cdn-cgi/image/width=400,format=webp/...`) is a paid Cloudflare feature (requires a paid plan with Image Resizing add-on). The project constraint is zero paid external services. Using CF Image Resizing during this milestone would violate that constraint.

**What the project does today:** R2 images are served at their original upload size (up to whatever the admin uploaded). A 5 MB cover photo is delivered as-is to mobile users.

**Prevention (free alternatives):**
1. **Pre-generate thumbnails on upload (recommended):** When the admin uploads a cover photo via `POST /api/onlydate/admin/upload`, resize it in the Worker before writing to R2 using the Canvas API or a WASM image library. Cloudflare Workers support the `@cf-wasm/photon` package (WASM-based, no paid plan required) or raw WASM compiled from `image` (Rust) or `sharp` (requires Node.js compatibility mode). Write two R2 objects: `cover-{uuid}.jpg` (original) and `cover-{uuid}-thumb.jpg` (e.g., 400px wide WebP). The feed endpoint serves the thumb; the profile page serves the original.
2. **Constrain upload size on the client:** In the admin UI, before uploading, draw the image to a `<canvas>` element at the target dimensions (e.g., max 800px on the long side) and export as `canvas.toBlob('image/webp', 0.85)`. This is a free, zero-dependency, client-side resize. The upload is already smaller, reducing R2 storage and egress.
3. **Accept current state for MVP:** If neither approach is implemented this milestone, add a note to the admin UI: "Upload images at 800px wide max for best performance." Rely on `loading="lazy"` and `decoding="async"` on all `<img>` tags to prevent blocking render.

**Do not:** Enable CF Image Resizing, use Cloudflare's paid image optimization pipeline, or introduce Imgix/Cloudinary (all paid).

**Warning signs:**
- `/cdn-cgi/image/` appears in any URL construction in the codebase.
- `CF-Resized` response header appears on R2-served images.
- An image optimization service appears in `package.json` without a free-tier caveat.

**Phase:** Performance / Image Optimization phase. Client-side canvas resize in admin upload is the lowest-effort implementation.

---

### Pitfall 14: `start_param` Bot Token Freshness Rotation

**What goes wrong:** The `initData` hash is signed with the bot token. If the bot token is rotated (via BotFather `/revoke`), all existing `initData` signatures become invalid. If the Worker caches the derived HMAC key (e.g., in a module-level variable across requests), the old key survives until the Worker is redeployed, causing all new initData to fail validation.

**Prevention:**
1. Derive the HMAC key per-request from `c.env.BOT_TOKEN` — do not cache it at module initialization time.
2. If bot token rotation is planned (it should be, as a periodic security hygiene), have a deployment runbook that: (a) revokes old token, (b) sets new `BOT_TOKEN` secret via `wrangler secret put`, (c) redeploys Worker, all within minutes.
3. Cloudflare Workers environment secrets are injected fresh per isolate invocation, so the secret itself is always current — the risk is only in application-level caching.

**Warning signs:**
- `const secretKey = await deriveKey(botToken)` at module scope rather than inside the request handler.

**Phase:** Analytics / Server-side validation phase.

---

### Pitfall 15: Dual-Source UNION — Reorder and Promote Operate on Wrong Table

**What goes wrong:** Both `personas` and `onlydate_feed_entries` appear in the public feed. When the admin drags to reorder, the reorder endpoint must write `sort_order` to the correct table. The existing pattern in CONCERNS.md notes that `toggle-active` silently no-ops on `personas` table rows. The same silent failure will affect reorder and promote if not explicitly guarded.

**Prevention:**
1. The admin frontend already tracks `source` per persona row (from the admin API response). Pass `source` in every mutation request body.
2. On the Worker, check `source` before writing: if `source === 'personas'`, return `400 { error: 'personas table is read-only — reorder/promote not supported' }`. This makes the failure explicit rather than silent.
3. Promotion and reorder columns (`is_promoted`, `sort_order`) only exist on `onlydate_feed_entries`. Do not attempt to add equivalent columns to `personas` — that table is owned by the external sibling app.
4. In the feed UNION query, give `personas` table rows a default `sort_order` (e.g., `9999` or the row's creation timestamp) so they always sort after explicitly-ordered `onlydate_feed_entries` rows, rather than interleaving unpredictably.

**Warning signs:**
- Reorder/promote endpoints do not check `source` before executing UPDATE.
- The UNION query orders both tables by the same `sort_order` column that only exists on one of them (SQLite will default the missing column to NULL — NULL sorts first by default in ASC order, last in DESC).

**Phase:** Admin Ordering and Admin Promotion phases.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Layout / Viewport | iOS keyboard pushes fixed CTAs on top of keyboard; desktop shows gray bars beside 9:16 container | Use `100dvh`, `env(safe-area-inset-*)`, `Telegram.WebApp.safeAreaInset`; test on real iOS |
| Chat CTA Deeplinks | `window.open` fails on iOS; analytics event dropped after navigation | Use `openTelegramLink`; fire analytics with `navigator.sendBeacon` before navigation |
| Analytics Schema | No index on `created_at`; table grows unbounded | Add indexes at DDL time; implement Cron-based deletion from day one |
| Analytics — PostHog | Dropped events; bare `user_id` as `distinctId`; PII capture | `ctx.waitUntil`; prefix `tg_${user_id}`; strip name fields |
| Analytics — initData | Wrong HMAC derivation (Mini App ≠ Login Widget); stale `auth_date` | Use `HMAC-SHA256("WebAppData", BOT_TOKEN)` as key; check `auth_date` freshness |
| Admin Ordering | HTML5 DnD doesn't work on mobile Telegram; scroll/drag conflict | Use Pointer Events; 8px drag threshold; `setPointerCapture` |
| Admin Ordering | Reorder silently no-ops on `personas` rows | Check `source` field server-side; return 400 for read-only rows |
| Admin Promotion | Infinite CSS animation causes jank on low-end Android | Animate only `transform`/`opacity`; pause via IntersectionObserver off-screen |
| Admin Expansion (any) | New admin endpoints inherit sessionStorage password exposure | Rotate `ADMIN_PASSWORD` to Wrangler secret before adding new admin routes |
| Image Optimization | CF Image Resizing is paid — violates constraint | Client-side canvas resize on upload; `loading="lazy"` on all feed images |
| Attribution | `start_param` lost on Telegram WebView hot-reload; double-counting | Store attribution in `localStorage` per session; prefer `start_param` over `utm_source` when both present |

---

## Sources

- Telegram Mini App SDK documentation (initData validation, openTelegramLink, safeAreaInset): https://core.telegram.org/bots/webapps — MEDIUM confidence (verified against known SDK behavior; some version-specific details may have changed)
- Cloudflare D1 limits (10 GB database size, 1000ms CPU time limit per query): https://developers.cloudflare.com/d1/platform/limits/ — MEDIUM confidence (based on CF docs as of training data; verify current limits before milestone planning)
- Cloudflare Workers `ctx.waitUntil` behavior: https://developers.cloudflare.com/workers/runtime-apis/context/ — HIGH confidence (well-established Workers primitive, stable API)
- Cloudflare Image Resizing (paid feature): https://developers.cloudflare.com/images/image-resizing/ — HIGH confidence (consistently paid feature across CF plans)
- CSS compositor-safe properties (transform, opacity): MDN Web Docs "CSS performance optimization" — HIGH confidence (stable browser behavior, well-documented)
- PostHog ingestion API (`/capture`, `/batch`): https://posthog.com/docs/api/capture — MEDIUM confidence (API shape is stable; rate limits on free tier may have changed)
- Pointer Events API (mobile drag-and-drop replacement): MDN Web Docs PointerEvent — HIGH confidence (W3C standard, widely supported)
- `@cf-wasm/photon` for server-side image resizing in Workers: https://github.com/nicolo-ribaudo/cf-wasm — LOW confidence (niche library; verify current CF Workers WASM support and bundle size limits before adopting)
- Project-specific concerns (sessionStorage password, silent R2 failures, dual-table architecture): `.planning/codebase/CONCERNS.md` (this codebase) — HIGH confidence
