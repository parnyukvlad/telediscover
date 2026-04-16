# Feature Landscape

**Domain:** Telegram Mini App — model discovery feed with chat funnel + operator CMS
**Researched:** 2026-04-16
**Confidence notes:** Web tools were unavailable during this research session. All findings draw from
(a) direct reading of the existing codebase, (b) training-data knowledge of the Telegram Web App SDK
(cutoff ~Aug 2025), and (c) general knowledge of PostHog, drag-drop libraries, and CSS animation
patterns. Confidence levels are assigned per-claim. No claim is presented as authoritative without a
HIGH-confidence source.

---

## Area 1 — Viewport Handling on Desktop Telegram

### What the existing code does

`tg.expand()` is already called at init. `setHeaderColor` and `setBackgroundColor` match the dark
theme. The layout is `min-height: 100vh` with no max-width constraint — on desktop Telegram the
Mini App pane stretches to fill whatever width the chat panel is.

### Table Stakes (expected by Mini App users)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `tg.expand()` on init | Standard — without it, the app opens at half-height on mobile | Low | Already implemented |
| Dark background matching Telegram theme | Jarring white flash if omitted; Telegram users expect dark-first | Low | Already implemented via `setBackgroundColor` |
| No horizontal scroll on mobile | Breaks usability; `overflow-x: hidden` is baseline hygiene | Low | Already implemented |
| `viewport` meta `user-scalable=no` | Standard Mini App hygiene — prevents accidental pinch-zoom | Low | Already implemented |
| Sticky tab bar at top | Expected navigation pattern in portrait scroll apps | Low | Already implemented |

### The 9:16 Centered Portrait Canvas Requirement

**Verdict:** This is a deliberate product decision, not a community-standard pattern. Confidence:
MEDIUM (based on training knowledge; Telegram docs do not prescribe this).

**What Telegram actually recommends (HIGH confidence, SDK behavior is well-documented):**
- The Telegram Web App SDK exposes `Telegram.WebApp.viewportHeight` and `Telegram.WebApp.viewportStableHeight`.
- On desktop, the Mini App opens in a panel that is typically 400–600 px wide and full-height of the
  window. There is no built-in "portrait phone frame" rendering.
- `requestFullscreen()` (added in Bot API 8.0, ~late 2024) makes the Mini App fill the entire
  desktop window — but this is landscape on wide monitors.
- The Telegram SDK provides no native "show me in a phone frame" mode.

**Common community patterns (MEDIUM confidence):**

1. **Unconstrained fluid layout** — Most Mini Apps just flow to whatever width the pane is. This is
   the path of least resistance. Works fine for utility apps (booking, payments, games).
   Drawback for OnlyDate: a 1200 px wide model-photo grid looks wrong and dilutes the "app-like"
   feel.

2. **`max-width` + `margin: auto` centering** — Apply `max-width: 430px; margin: 0 auto` to the
   main container. Desktop pane becomes a centered narrow column. Dark background fills the sides.
   This is the standard e-commerce / social app pattern when the content is inherently portrait.
   **This is the right pattern for OnlyDate.** Complexity: Low.

3. **Fixed pixel canvas with hardware-feel border** — Set a fixed `width: 390px; height: 844px`
   div, center it, add `border-radius: 40px; box-shadow: inset 0 0 0 2px rgba(255,255,255,0.08)`.
   Creates a "phone in desktop" aesthetic. Complexity: Low–Medium. Potential downside: content can
   overflow if JS dynamically appends elements outside the constraint.

4. **Viewport-height-driven full portrait fill** — Use `height: 100dvh; max-width: 430px` with the
   app scrolling inside. No fake phone chrome. Cleanest CSS approach for a scroll-based feed.
   **Recommended for this project.** Complexity: Low.

**What "9:16 portrait, dark backdrop" actually needs:**

```css
/* On the root container */
#app {
  max-width: 430px;
  min-height: 100dvh;
  margin: 0 auto;
  background: var(--bg);   /* already #0f1115 */
  position: relative;
}

/* On body, to show the dark backdrop on desktop */
body {
  background: #080a0e;     /* slightly darker than card bg */
}
```

No JavaScript required. No Telegram SDK viewport API calls beyond what is already present.

**`requestFullscreen()` note:** Do NOT call this for a portrait feed. It maximises to window size,
which on desktop is landscape. Only appropriate for full-screen games.

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Fake phone chrome on desktop | "App-in-app" novelty, reinforces mobile-first brand feel | Low–Medium | Optional; skip unless operator specifically wants it |
| Dynamic viewport height adaptation (`tg.onEvent('viewportChanged', ...)`) | Smooth expansion when user resizes desktop window | Low | Nice polish; not blocking |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| `requestFullscreen()` on a portrait feed | Makes the app landscape on desktop; portrait photos look tiny | Use `max-width` CSS constraint |
| CSS `height: 100vh` (not `dvh`) on mobile | Causes the bottom CTA to be cut off by mobile browser chrome | Use `min-height: 100dvh` or `100svh` |
| Hardcoded `width: 390px` with `overflow: hidden` on root | Content injected outside that div (modals, toasts) is clipped | Use `max-width` not fixed width |

---

## Area 2 — Chat CTA: Deeplink to Telegram DM

### What the existing code does

`onMessageClick()` currently uses:
```javascript
var url = 'https://t.me/' + encodeURIComponent(currentProfile.username);
if (tg && tg.openTelegramLink) {
  tg.openTelegramLink(url);
} else {
  window.open(url, '_blank');
}
```

This pattern is correct for the profile page. The lightbox's "Message" button also routes through
`onMessageClick()`. The feed card has no chat CTA yet (PROJECT.md Active requirement).

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Chat CTA on profile page | Core funnel step; users expect a clear "message" affordance | Low | Partially implemented |
| Chat CTA on every feed card | PROJECT.md Active requirement; reduces friction | Low | Not yet implemented |
| CTA that opens the DM directly on tap | Any extra step (browser redirect, login wall) kills conversion | Low | Depends on method choice |

### Method Analysis (HIGH confidence — SDK behavior is stable and well-documented)

**`tg.openTelegramLink(url)` with `https://t.me/<handle>`:**
- This is the canonical method inside a Mini App. The SDK intercepts the `t.me` URL and opens the
  chat inside Telegram without leaving the app on iOS/Android. On Desktop Telegram, it opens the
  chat in the same Telegram window.
- Works across iOS, Android, Desktop. Requires Bot API 6.0+ SDK.
- `https://t.me/<handle>` resolves to a DM chat. For usernames associated with bots, it opens the
  bot chat. For regular users, it opens a DM. Both are correct for this use case.
- **This is the right choice.** The existing fallback to `window.open` for non-SDK contexts is also
  correct.

**`tg://resolve?domain=<handle>`:**
- Deep-link URI scheme. Works on mobile (iOS/Android) when Telegram is installed. Does NOT work
  reliably inside Desktop Telegram's web view — the web view may not handle custom URI schemes.
- Also does not work in browsers (no app installed handling). Only useful as a last-resort fallback
  for native app contexts outside the Mini App.
- **Do not use as primary.** Only consider as a native deep-link fallback if app is ever shipped
  outside the Mini App context.

**`window.Telegram.WebApp.close()` + redirect:**
- Close the Mini App, then redirect to `t.me/<handle>`. This is a workaround for the case where
  `openTelegramLink` fails. In practice, `openTelegramLink` handles this correctly; closing the app
  first creates a confusing UX (the Mini App disappears before the chat opens).
- **Anti-pattern for this use case.** Do not use.

**`window.open('https://t.me/<handle>', '_blank')`:**
- Opens in system browser. On mobile, depending on OS, Telegram may capture the `t.me` URL and
  open it in-app. On Desktop, it opens in a real browser tab. This is the correct fallback for
  when `tg.openTelegramLink` is unavailable (e.g., app previewed in browser).
- Keep as fallback (already implemented).

### Feed Card Chat CTA

The current card render (`renderGrid`) has no message icon. The requirement is to add one.

**Pattern:** A small icon button overlaid on the card (bottom-right or bottom-left), separate from
the card-click handler which opens the profile. This must:
1. Stop event propagation (`e.stopPropagation()`) so the card click does not also fire.
2. Call `openChatWithHandle(handle)` directly without going through the profile page.
3. Be large enough to tap on mobile (min 44x44 px touch target).

**Dependency:** Feed card CTA needs the `handle` value, which is already rendered as
`data-username` on each card element. No backend change required.

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| "Message" button sticky at bottom of profile page (not just in header) | Reduces scroll-to-CTA friction; always visible | Low | Small CSS change |
| Haptic feedback on CTA tap (`tg.HapticFeedback.impactOccurred('medium')`) | Tactile confirmation; common in polished Mini Apps | Low | One-liner in click handler |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| `tg://resolve` as primary deeplink | Fails on Desktop Telegram web view | Use `openTelegramLink` with `https://t.me/<handle>` |
| `tg.close()` before redirect | App closes before chat opens; confusing UX | Use `openTelegramLink` directly |
| CTA that opens in a browser tab inside Mini App | Some Telegram clients open `window.open` in a mini-browser; user is stuck | Use `tg.openTelegramLink` |
| CTA outside the 44px touch target | Mis-taps; frustrating on mobile | Enforce `min-width: 44px; min-height: 44px` |

---

## Area 3 — Analytics Events: View → Click → Chat Funnel

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| At least one event per funnel stage | Without this, no funnel analysis is possible | Low | Three events needed |
| Bound to Telegram user ID | Without identity, cohort and repeat-visit analysis is impossible | Low | `initDataUnsafe.user.id` available; must validate server-side |
| Timestamp on every event | Funnel time-to-convert requires it | Low | ISO 8601 or Unix ms |
| Session identifier | Without it, funnel collapses multiple page views into one "session" | Low | Generated client-side UUID, stored in `sessionStorage` |
| Attribution fields on session start | Without these, you cannot attribute chat conversions to ad spend | Medium | See Area 4 |

### Minimum Event Schema

**Three events are the minimum viable funnel:**

```
profile_open         — user tapped a feed card, profile page opened
feed_card_click_chat — user tapped message icon ON the feed card (skipped profile)
profile_click_chat   — user tapped Message button ON the profile page
```

**Standard property names (MEDIUM confidence — PostHog convention + common analytics schema):**

```json
{
  "event":           "profile_open",
  "distinct_id":     "tg_123456789",
  "timestamp":       "2026-04-16T18:00:00.000Z",
  "session_id":      "sess_abc123",
  "source":          "feed_card",
  "profile_handle":  "model_handle_here",
  "tab":             "trending",
  "tg_user_id":      123456789,
  "tg_start_param":  "ad_campaign_01",
  "utm_source":      "telegram_ads",
  "utm_medium":      "cpc",
  "utm_campaign":    "launch_q2",
  "utm_content":     null,
  "platform":        "ios"
}
```

**Property explanations:**

- `distinct_id`: PostHog's required user identifier. Use `tg_<user_id>` string prefix to avoid
  integer ambiguity.
- `session_id`: UUID generated at Mini App boot, stored in `sessionStorage`. New tab = new session.
  Allows per-session funnel steps to be grouped.
- `source`: Where within the app the event originated. `feed_card` vs `profile_page` vs `lightbox`
  distinguishes engagement patterns.
- `tab`: Which feed tab was active (`trending`/`popular`/`new`) when the card was opened. Needed
  to identify which tab drives the most conversions.
- `tg_user_id`: Raw integer for D1 binding. `distinct_id` string for PostHog.
- `tg_start_param`: From `Telegram.WebApp.initDataUnsafe.start_param`. Null if not present.
- `utm_*`: From URL query string. Null if not present.
- `platform`: From `Telegram.WebApp.platform` (`ios`, `android`, `tdesktop`, `webk`, etc.).

**D1 table schema (minimum):**

```sql
CREATE TABLE analytics_events (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event       TEXT NOT NULL,
  tg_user_id  INTEGER,
  session_id  TEXT NOT NULL,
  timestamp   TEXT NOT NULL,           -- ISO 8601
  properties  TEXT NOT NULL            -- JSON blob for flexibility
);
CREATE INDEX idx_events_tg_user ON analytics_events(tg_user_id);
CREATE INDEX idx_events_session  ON analytics_events(session_id);
CREATE INDEX idx_events_event    ON analytics_events(event, timestamp);
```

Store extra fields in the `properties` JSON blob rather than individual columns. This avoids a
migration every time a new property is added.

**Server-side validation requirement (HIGH confidence — security requirement from PROJECT.md):**
`initData` must be validated against the bot token HMAC before any `tg_user_id` is trusted. The
`BOT_TOKEN` env binding already exists.

### PostHog Insights That Matter (MEDIUM confidence — PostHog free tier)

| Insight Type | What It Answers | Priority |
|---|---|---|
| Funnel: `profile_open` → `profile_click_chat` | What % of profile views convert to chat | Must-have |
| Funnel: feed load → `feed_card_click_chat` | Direct-from-feed conversion rate | Must-have |
| Retention (Day 1, Day 7, Day 30) | Do users return? If yes, which cohort? | High value |
| Breakdown by `tab` property | Does "trending" vs "new" drive different conversion? | Medium |
| Breakdown by `tg_start_param` | Which ad campaign converts best? | High value |
| User paths (PostHog Paths) | Unusual navigation patterns before conversion | Nice to have |

**Free tier limit:** PostHog Cloud free tier allows 1M events/month. At 10K DAU with ~10 events/user/
session, that is 100K events/day = 3M/month — exceeds free tier. Self-hosting is a must at scale, or
rate-limit events to only the three funnel events (not page scroll events etc.).

### Dependencies

```
Server-side initData validation
  → tg_user_id trusted
      → analytics_events D1 table
          → D1 raw event storage
              → PostHog forwarding (fire-and-forget from Worker)
                  → PostHog funnel insights
                  → PostHog retention charts
```

Attribution capture (Area 4) is a prerequisite for breakdowns by campaign.

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Client-side event sending directly to PostHog | Exposes PostHog API key in client JS | Send from Worker (server-side) after D1 insert |
| Tracking scroll depth, mouse moves, every click | Event volume blows past free tier | Track only the three funnel events + session start |
| Separate analytics table per event type | Schema sprawl; hard to query across events | Single `analytics_events` table with JSON properties |
| User-level PII (Telegram name, photo) in events | Privacy risk; not needed for funnel analysis | Only store `tg_user_id` integer |

---

## Area 4 — Attribution via `start_param` + `utm_*`

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Capture `tg_start_param` on first event | Without it, Telegram ad spend is unattributable | Low | `Telegram.WebApp.initDataUnsafe.start_param` |
| Capture `utm_*` from URL on first event | Without it, web ad spend is unattributable | Low | `new URLSearchParams(location.search)` |
| Store attribution on the session record, not every event | Avoids redundant storage; attribution is session-level | Low | Read once at session init |

### First-Touch Attribution Pattern (MEDIUM confidence)

**What to capture at session start:**

```javascript
// client-side, run once at Mini App boot
const tg = window.Telegram.WebApp;
const startParam = tg.initDataUnsafe?.start_param || null;
const params = new URLSearchParams(location.search);
const attribution = {
  tg_start_param: startParam,
  utm_source:     params.get('utm_source'),
  utm_medium:     params.get('utm_medium'),
  utm_campaign:   params.get('utm_campaign'),
  utm_content:    params.get('utm_content'),
  utm_term:       params.get('utm_term'),
};
```

Send this in the `session_start` event (or as part of the first event in the session). Persist to
`sessionStorage` so subsequent events in the same session can carry the same attribution without
re-reading.

**"Session" record definition (for this project's scale):**

A session is one continuous Mini App open. It starts when the app boots and ends when it is closed
(or after 30 minutes of inactivity — not worth implementing at this scale). The session record
contains:

```json
{
  "session_id":      "sess_<uuid>",
  "tg_user_id":      123456789,
  "started_at":      "2026-04-16T18:00:00.000Z",
  "tg_start_param":  "ad_q2_01",
  "utm_source":      null,
  "utm_medium":      null,
  "utm_campaign":    null,
  "platform":        "ios"
}
```

Store as the first event with `event: "session_start"` — no separate sessions table needed at this
scale. PostHog will use `session_id` to group funnel steps.

### Multi-Touch Handling

**Table stakes for this milestone:** First-touch only. A user who opens the app from two different
ads in the same session will have the first `start_param` as their attribution. This is correct and
sufficient for optimising ad spend at launch.

**What is overkill:** Building a last-touch or linear-attribution model. Requires a separate
attribution table, merge logic across sessions, and reporting complexity that is not justified
before the first ad campaign has run.

### Telegram Ads vs Web Ads Distinguishing

**Reliable heuristic (HIGH confidence — based on SDK behavior):**

| Signal | Telegram Ad | Web Ad (external) |
|--------|-------------|-------------------|
| `tg_start_param` present | Yes (deeplink via bot start param) | Possibly (if ad link embeds it) |
| `utm_source` present | Possibly (if operator embeds in bot link) | Yes |
| `tg.platform` | `ios` / `android` / `tdesktop` | `webk` (Web Telegram) or non-Telegram browser |

**Simplest distinguishing rule:**
- `tg_start_param` present AND `utm_source` absent → native Telegram ad
- `utm_source` present → web/external ad
- Both present → operator manually embedded both in the same link (capture both)
- Neither present → organic (direct bot link, no tracking)

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-model attribution breakdown | "Which model drives the most chat conversions from Campaign X?" | Medium | Requires `profile_handle` on events AND PostHog breakdown |
| Session replay integration (PostHog) | See what users actually do before clicking chat | Medium | High privacy risk for adult content; skip |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Multi-touch attribution model at launch | Complexity with no data to validate it | First-touch only; revisit after 30 days of data |
| Storing raw `initData` string in D1 | Contains sensitive user info; large payload | Extract only `user.id` and `start_param` |
| Separate `sessions` table | Overkill at this scale | Use `session_start` event + PostHog session grouping |

---

## Area 5 — Admin UX for a Small-Operator CMS

### Context

Single operator. 20–100 profiles. Vanilla JS single-file app (`photochoose/index.html`, 1411 lines).
Constraint: extend, do not rewrite.

### Table Stakes for a One-Operator Panel

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Add / edit display name and handle | Operator must fix typos and update profiles | Low | Partially implemented |
| Upload cover photo | Primary visual; without it profiles look broken | Low | Implemented |
| Add / remove gallery photos | Content management core | Low | Implemented |
| Show / hide individual profiles | Remove a profile without deleting data | Low | Implemented (`feed_visible`) |
| Drag-and-drop feed ordering | Operator-selected requirement; natural for 20–100 items | Medium | Not yet implemented |
| Promote / unpromote toggle | Operator-selected requirement; binary | Low | Not yet implemented |
| Soft delete (hide without data loss) | Safe; lets operator recover a "deleted" profile | Low | Map to `is_active = false` |

### Drag-and-Drop Ordering

**Library recommendation: SortableJS (MEDIUM confidence)**

- SortableJS is the dominant vanilla-JS-compatible drag-drop library. No framework dependency.
  Works with plain DOM. CDN-loadable.
- Alternative: `@dnd-kit/core` (React-only, not applicable here).
- Alternative: HTML5 native drag-and-drop API (no library). Works but requires significant
  boilerplate for touch support. Touch drag does not work on mobile without polyfill or library.
  **Avoid for cross-device admin panel.**

**Backend requirement:** An `order` (INTEGER) column on both `onlydate_feed_entries` and read-only
`personas` (add a separate `onlydate_feed_order` table or add `sort_order` to a join config table
since `personas` is read-only). The `POST /api/onlydate/admin/feed-order` endpoint accepts an array
of `{id, sort_order}` pairs and batch-updates D1.

**D1 batch approach:**
```typescript
await db.batch(ids.map((id, i) =>
  db.prepare('UPDATE onlydate_feed_entries SET sort_order = ? WHERE id = ?').bind(i, id)
));
```
For `personas` entries (read-only table), a separate `onlydate_feed_order` override table is needed.

**UX pattern for 20–100 items:** A vertical list (not the current grid) with drag handles on the
left. The grid view is better for end-user browsing; a list is better for admin reordering.
Consider a separate "Reorder" mode in the admin panel that switches to a list view.

### Image Management

| Feature | Table Stakes? | Complexity | Notes |
|---------|--------------|------------|-------|
| Choose cover from existing gallery | Yes — avoids re-upload | Low | Implemented |
| Upload new image directly from file picker | Yes | Low | Implemented |
| Hide individual photos without deleting | Yes — safe moderation | Low | Implemented |
| Delete photo (with R2 cleanup) | Yes | Low | Implemented (R2 cleanup has silent failure — see CONCERNS.md) |
| **Image cropping in-browser** | No — nice to have | High | Skip this milestone |
| **Bulk photo operations** | No — overkill for 20–100 profiles | Medium | Skip |
| **CDN image optimisation (resize on upload)** | No — but worth doing for perf | Medium | Defer; use Cloudflare Image Resizing if needed |

### Promotion Toggle

The requirement is binary. Implementation:

1. Add `is_promoted` BOOLEAN column to `onlydate_feed_entries`.
2. `POST /api/onlydate/admin/feed-entry/toggle-promote` endpoint.
3. Admin UI: a star button per profile card, yellow when promoted.
4. Feed query: include `is_promoted` in the response payload (already does `SELECT *` effectively).

For `personas` table entries (read-only), add `is_promoted` to a join-config override table or to
`onlydate_feed_entries` via a matching record. Since `personas` is read-only, promotion state for
those entries must live in a separate table keyed by `persona_id`.

**Suggested: add `onlydate_persona_overrides` table:**
```sql
CREATE TABLE onlydate_persona_overrides (
  persona_id   TEXT PRIMARY KEY,
  is_promoted  INTEGER DEFAULT 0,
  sort_order   INTEGER DEFAULT 9999
);
```
This cleanly handles both ordering and promotion state for read-only persona entries, without
touching the external `personas` table.

### What Is Overkill (Anti-Features for Admin)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| In-browser image cropping (Cropper.js etc.) | High complexity, poor mobile UX, out of scope | Operator crops before upload |
| Bulk select + bulk operations | Not needed for 20–100 profiles | Single-item operations |
| Audit log (who changed what) | Single operator; no accountability need | Skip entirely this milestone |
| Role-based access control | One operator | Skip entirely |
| Rich text editor for bio/description | Not in data model; feature scope creep | Plain text input if needed |
| Pagination in admin panel | 20–100 profiles fits one page | Keep current all-at-once load |
| Confirmation modal on every delete | Adds friction for single operator who knows what they're doing | One confirmation dialog is enough |
| Undo/redo history | Enterprise feature; not needed | Soft deletes provide sufficient safety net |

---

## Area 6 — Promoted Profile Animations (Star-Sparkle Frame)

### What Is Expected

The operator requirement is: "Promoted profiles render with animated star-sparkle frame on the
public feed." The feed card is a `3:4 aspect-ratio` div with an image fill and overlay text.

The animation must:
1. Be visually distinct from unpromoted cards.
2. Not degrade scroll performance on a 2-column grid of 100 cards.
3. Work on iOS/Android Telegram web views (which have limited GPU budget).

### Implementation Options

**Option 1: CSS keyframes with `box-shadow` pulse (RECOMMENDED)**

```css
.model-card.promoted::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: calc(var(--radius-card) + 2px);
  background: transparent;
  border: 2px solid transparent;
  background-clip: padding-box;
  animation: sparkle-border 1.8s ease-in-out infinite;
  pointer-events: none;
}

@keyframes sparkle-border {
  0%, 100% { box-shadow: 0 0 6px 1px rgba(245, 158, 11, 0.4), 0 0 0 2px rgba(245, 158, 11, 0.6); }
  50%       { box-shadow: 0 0 14px 4px rgba(245, 158, 11, 0.7), 0 0 0 2px rgba(251, 191, 36, 0.9); }
}
```

Complexity: Low. Performance: Excellent — `box-shadow` animation is composited on modern browsers.
No JS. No external library.

**Option 2: CSS `@keyframes` with a rotating gradient border**

Uses `conic-gradient` + `animation: spin 2s linear infinite` on a pseudo-element. Creates a
rotating rainbow or gold border. More visually striking than a pulse.

```css
.model-card.promoted::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: calc(var(--radius-card) + 2px);
  background: conic-gradient(from 0deg, #f59e0b, #fcd34d, #f59e0b, transparent 50%);
  animation: border-spin 2.5s linear infinite;
  z-index: -1;
}
@keyframes border-spin { to { transform: rotate(360deg); } }
```

Complexity: Low–Medium (cross-browser conic-gradient support is now HIGH in 2025 — all modern
browsers including Telegram web view). Performance: Good — uses `transform` which is GPU-composited.

**Option 3: Lottie animation (star sparkle overlay)**

A small Lottie JSON file with star particles. Requires loading `lottie-web` (~250 KB gzipped) or
`lottie-light` (~70 KB). Each card instance must initialise its own Lottie animation instance.

Complexity: High (100 promoted cards = 100 Lottie instances in memory). Performance: Poor at scale.
Do not use for feed cards.

**Option 4: Canvas-based particle system**

Custom canvas overlay with JS-driven star particles. Maximum flexibility, maximum complexity.

Complexity: Very High. Performance: Depends entirely on implementation. Overkill.

**Option 5: Small star icon + `animation: bounce/pulse`**

A star emoji or SVG icon in the top-right corner of promoted cards, with a simple scale pulse.

```css
.promoted-badge {
  position: absolute; top: 8px; right: 8px;
  font-size: 18px;
  animation: star-pulse 1.5s ease-in-out infinite;
}
@keyframes star-pulse {
  0%, 100% { transform: scale(1);   opacity: 1; }
  50%       { transform: scale(1.2); opacity: 0.8; }
}
```

Complexity: Very Low. Performance: Excellent. Reads clearly as "featured." Less visually premium.

### Recommendation

Use **Option 1 (box-shadow pulse)** as a baseline — it is one CSS block, zero dependencies,
GPU-composited, and legible at small card size. Layer a **badge icon** (Option 5) in the top-right
corner for clarity. The combined effect (pulsing gold border + small star badge) achieves the
"sparkle frame" feel without Lottie or Canvas.

If the operator wants a more premium feel after launch, Option 2 (rotating gradient border) is the
natural upgrade and requires only a CSS change.

### Performance Constraints

| Concern | At 20 promoted cards (max) | At 100+ cards |
|---------|---------------------------|---------------|
| CSS keyframe animation | No perf issue; composited | Monitor; should still be fine |
| Lottie instances | 20 instances is borderline | 100+ instances = janky scroll |
| Canvas overlay | High JS overhead regardless of count | Avoid |
| `will-change: transform` on animated elements | Promotes to its own layer; helps with 60fps | Use sparingly; excessive promotion wastes GPU memory |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Lottie for feed cards | Memory overhead × N cards; complex initialisation | CSS keyframes |
| Canvas particle overlay on every card | CPU/GPU intensive; janky scroll | CSS only |
| `animation: all` shorthand on the card itself | Forces browser to recalculate all properties per frame | Animate only `box-shadow` or `opacity` or `transform` |
| Animating `width`, `height`, `border-width` | Triggers layout reflow per frame | Use `box-shadow` or `outline` (no layout impact) |
| Three tiers of sparkle (gold/silver/bronze) | Out of scope per PROJECT.md | Binary promoted/not-promoted |

---

## Feature Dependencies

```
server-side initData validation
  → trusted tg_user_id
      → analytics_events D1 table (Area 3)
          → PostHog event forwarding
              → funnel insights
              → cohort/retention charts

attribution capture (Area 4)
  → included in session_start event
      → PostHog breakdown by campaign

feed card chat CTA (Area 2)
  → needs handle on card element (already present as data-username)
  → triggers feed_card_click_chat event (Area 3)

promotion toggle — admin (Area 5)
  → is_promoted column on onlydate_feed_entries
  → onlydate_persona_overrides table for personas entries
      → promoted badge + CSS animation on feed card (Area 6)
          → is_promoted in feed API response

admin drag-drop ordering (Area 5)
  → sort_order column on onlydate_feed_entries
  → onlydate_persona_overrides.sort_order for personas entries
  → ORDER BY sort_order in feed query

viewport max-width constraint (Area 1)
  → body background + app container CSS only
  → no backend changes required
```

---

## MVP Recommendation

**Prioritize (this milestone, in order):**

1. **Viewport constraint** — Pure CSS, zero risk, immediate visual improvement. `max-width: 430px;
   margin: 0 auto` on the app container + darker `body` background.
2. **Feed card chat CTA** — Small JS addition to `renderGrid`. Requires `feed_card_click_chat`
   event, which drives analytics. High funnel value.
3. **Server-side initData validation + analytics D1 table** — Foundation for all analytics. Must
   ship before ad launch.
4. **Attribution capture (session_start event)** — Depends on item 3. Ships in same phase.
5. **PostHog forwarding** — Fire-and-forget from the Worker after D1 insert. Low risk.
6. **Promotion toggle (admin) + promoted badge + CSS animation** — Admin toggle is low complexity;
   CSS animation is low complexity. Ship together.
7. **Drag-and-drop ordering** — Medium complexity due to dual-source schema. Needs the override
   table. Ship after promotion is working.
8. **Admin profile management improvements** — Edit name/handle/cover, soft delete improvements.
   Refine existing photochoose UI.

**Defer:**

- Image cropping — operator crops before upload.
- Audit log — single operator, not needed.
- Multi-touch attribution — revisit after 30 days of campaign data.
- Session replay — privacy concern for adult-content app.
- `requestFullscreen()` — wrong direction for portrait feed.
- Lottie animations — CSS is sufficient.

---

## Sources

- Codebase: `apps/onlydate/index.html` (direct read — HIGH confidence)
- Codebase: `apps/onlydate/photochoose/index.html` (direct read — HIGH confidence)
- Codebase: `apps/onlydate-worker/src/index.ts` (via ARCHITECTURE.md — HIGH confidence)
- `.planning/PROJECT.md` (direct read — HIGH confidence)
- `.planning/codebase/CONCERNS.md` (direct read — HIGH confidence)
- `.planning/codebase/ARCHITECTURE.md` (direct read — HIGH confidence)
- Telegram Web App SDK behavior (training data, Bot API 6.x–8.x — MEDIUM confidence; web verification was unavailable)
- PostHog free-tier event limits (training data — MEDIUM confidence; verify current limits at posthog.com/pricing)
- SortableJS library characteristics (training data — MEDIUM confidence)
- CSS animation performance properties (`box-shadow`, `transform`, `conic-gradient` browser support) (training data — HIGH confidence for 2025 browser support)
