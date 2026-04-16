# Technology Stack — Milestone Research

**Project:** OnlyDate (Telegram Mini App)
**Researched:** 2026-04-16
**Scope:** New pieces only — PostHog analytics, drag-drop reorder, Telegram initData validation, image optimization, JS minification, user identification. Existing Cloudflare Workers / Hono / D1 / R2 setup NOT re-researched.
**Overall confidence:** MEDIUM (all external fetch/search tools blocked during this session; findings are based on training knowledge verified against known official specs where possible; see per-item confidence notes)

---

## Research Questions Answered

### 1. PostHog on Cloudflare Workers — SDK, proxy, adblocker bypass

**Recommendation: `posthog-node` on the Worker side only. Zero PostHog SDK in the browser.**

#### What to use

| Layer | Package | Version | Purpose |
|-------|---------|---------|---------|
| Worker (server) | `posthog-node` | `^4.x` (latest stable) | Server-side capture, called after D1 insert |
| Browser | none | — | No PostHog JS in browser at all |

#### Why this approach

The project already commits to writing raw events to D1 on the server side (see PROJECT.md "Event tracking (D1)"). The Worker receives the event, persists to D1, **then** calls `posthog.capture()` server-side using `posthog-node`. This gives:

1. **Zero browser payload** — no PostHog script tag, no `posthog-js` bundle (~80 KB gzipped) loaded by the Mini App browser context.
2. **Complete adblocker immunity** — event never originates from the browser; it comes from `onlydate-api.tg-saas.workers.dev` (your own domain). There is no network request the browser makes to posthog.com.
3. **Validated user identity** — the Worker has already validated `initData` HMAC before it processes the event, so the `distinctId` is trusted.
4. **No proxy routing needed** — because the browser never sends to posthog.com directly, there is nothing to proxy.

#### posthog-node usage pattern in a Cloudflare Worker

```typescript
import PostHog from 'posthog-node'

// Initialise once outside the handler (module-level)
const ph = new PostHog(env.POSTHOG_API_KEY, {
  host: 'https://eu.posthog.com',   // or us.posthog.com — free tier on both regions
  flushAt: 1,       // flush immediately — Workers have no persistent background
  flushInterval: 0, // disable interval-based flushing
})

// Inside a route handler, after D1 insert:
ph.capture({
  distinctId: String(telegramUserId),
  event: 'feed_card_click_chat',
  properties: {
    handle,
    start_param: startParam ?? null,
    utm_source: utmSource ?? null,
  },
})
await ph.shutdownAsync()  // flush before Worker response is sent
```

**Critical:** `flushAt: 1` and `await ph.shutdownAsync()` are mandatory. Cloudflare Workers do not have a persistent process; if you don't flush before returning the Response, buffered events are lost. PostHog's Node SDK supports `shutdownAsync()` as of v3+.

#### PostHog free tier constraint

PostHog Cloud free tier (as of training cutoff, August 2025): 1 million events/month free. At 1k–10k DAU with 3–5 events per session, this is well within limits. **No paid tier required.** Use `host: 'https://eu.posthog.com'` (EU region) or `host: 'https://us.posthog.com'`.

#### What NOT to use

- `posthog-js` — do not import it in the browser. ~80 KB, designed for SPAs, and triggers adblockers.
- A Worker "reverse proxy" that forwards browser requests to posthog.com — unnecessary if the browser never calls PostHog directly.
- Self-hosted PostHog — requires a VM/container, costs money to operate, adds operational burden. Free cloud tier is the right call here.

**Confidence:** MEDIUM. `posthog-node` v4 stable + `shutdownAsync()` pattern is correct per training knowledge. `flushAt: 1` + `shutdownAsync` pattern for serverless is documented PostHog guidance. Could not verify latest version via live docs in this session.

---

### 2. Vanilla-JS drag-and-drop reorder — small, touch-friendly, no framework

**Recommendation: `SortableJS` v1.15.x**

#### Comparison

| Library | Minified+gzip | Touch | Framework-free | Last release | Notes |
|---------|--------------|-------|----------------|-------------|-------|
| **SortableJS** | ~8 KB | YES | YES | Active (v1.15.6 as of mid-2025) | Single file, no deps, wide browser support |
| Dragula | ~4 KB | limited | YES | Unmaintained (last 2019) | Touch support brittle on mobile; skip |
| Shopify Draggable | ~35 KB | YES | YES | Actively maintained | Too large for this use-case |
| interact.js | ~26 KB | YES | YES | Active | Overkill |
| native HTML5 DnD | 0 KB | NO on iOS | YES | — | iOS Safari ignores `dragstart`; broken for Telegram Mini App on iPhone |

SortableJS is under 10 KB gzipped, works on iOS/Android touch events, has no dependencies, and is the de-facto standard for this exact use case (list reorder in admin UIs). Import as a `<script>` tag or inline the built file — no bundler required.

#### Usage pattern (inline in `photochoose/index.html`)

```html
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"></script>
```

Or vendor the file into `apps/onlydate/` to avoid CDN dependency.

```javascript
const el = document.getElementById('persona-list')
const sortable = Sortable.create(el, {
  animation: 150,
  handle: '.drag-handle',  // optional drag handle
  onEnd(evt) {
    const orderedIds = [...el.querySelectorAll('[data-id]')].map(n => n.dataset.id)
    fetch('/api/onlydate/admin/reorder', {
      method: 'POST',
      headers: { 'X-Admin-Password': adminPassword, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: orderedIds }),
    })
  },
})
```

#### What NOT to use

- Dragula — unmaintained, iOS touch is unreliable.
- `@shopify/draggable` — 35 KB, overkill.
- Native HTML5 drag events — broken on iOS Safari (Telegram iOS Mini App uses Safari WebView).

**Confidence:** HIGH. SortableJS v1.15.x capabilities and size are well-documented; the iOS Safari `dragstart` limitation is a known platform constraint.

---

### 3. Telegram initData validation in Cloudflare Workers

**Recommendation: Write a ~30-line HMAC-SHA256 routine using the Web Crypto API. No external library needed.**

#### Why no library

The algorithm is defined once in the Telegram docs and does not change. It is:

1. Parse `initData` query string → sorted key=value pairs (excluding `hash`).
2. Join with `\n` → `data_check_string`.
3. Compute `HMAC-SHA256(data_check_string, SHA256("WebAppData"))` where the inner SHA256 of the literal string `"WebAppData"` becomes the HMAC key.
4. Compare result (hex) against the `hash` param from `initData`.

Cloudflare Workers expose the Web Crypto API natively (`crypto.subtle`). No Node.js `crypto` polyfill needed.

#### Reference implementation

```typescript
async function validateTelegramInitData(
  initData: string,
  botToken: string,
): Promise<{ valid: boolean; user: Record<string, unknown> | null }> {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return { valid: false, user: null }

  params.delete('hash')
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const encoder = new TextEncoder()

  // key = HMAC-SHA256("WebAppData", botToken)
  const secretKey = await crypto.subtle.importKey(
    'raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const botTokenBytes = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken))

  // signature = HMAC-SHA256(dataCheckString, key)
  const dataKey = await crypto.subtle.importKey(
    'raw', botTokenBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', dataKey, encoder.encode(dataCheckString))
  const sigHex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')

  if (sigHex !== hash) return { valid: false, user: null }

  const userParam = params.get('user')
  const user = userParam ? JSON.parse(userParam) : null
  return { valid: true, user }
}
```

This runs entirely in the Worker's V8 isolate with zero network calls.

#### Hono / @twa-dev libraries

- `@twa-dev/sdk` is a browser-side SDK (DOM-dependent), not usable in Workers.
- `hono/telegram` does not exist as a first-party Hono middleware (as of training cutoff).
- There is a community package `@telegram-apps/init-data-node` that implements this validation, but it adds a dependency for a 30-line function. Prefer the inline implementation — it has no version skew risk and is trivial to audit.

#### What NOT to use

- `@twa-dev/sdk` — browser only.
- Any library that uses Node.js `crypto` module — Workers use Web Crypto, not Node's `createHmac`. (Note: the project has `nodejs_compat` enabled, which *does* expose `crypto` from Node.js as well, but using Web Crypto directly is cleaner and doesn't depend on compatibility flags.)

**Confidence:** HIGH. The Telegram initData validation algorithm is specified in Telegram's official documentation and is stable. Web Crypto API usage in Workers is well-established.

---

### 4. Image optimization for R2-hosted assets — CF Image Resizing, Polish, AVIF/WebP

**Recommendation: Use Cloudflare Image Resizing (via Worker `fetch` with `cf.image` options) for on-demand resizing + format negotiation. Enable Polish on the zone.**

#### Cloudflare Image Resizing

Cloudflare Image Resizing transforms images at the edge via the `cf.image` object in a Worker fetch. The Worker currently serves R2 assets at `GET /media/*`. Extend it to accept size query params and pass them to the Cloudflare fetch transform.

```typescript
// In the /media/* route, instead of raw R2 passthrough:
app.get('/media/*', async (c) => {
  const key = c.req.param('*')
  const width = Number(c.req.query('w') ?? 0) || undefined
  const format = c.req.header('accept')?.includes('avif') ? 'avif'
               : c.req.header('accept')?.includes('webp') ? 'webp'
               : 'jpeg'

  // Fetch from R2 public URL (or internal R2 binding)
  const r2Object = await c.env.MEDIA.get(key)
  if (!r2Object) return c.notFound()

  // Re-fetch through Cloudflare's image pipeline
  const imageUrl = `https://onlydate-api.tg-saas.workers.dev/media-raw/${key}`
  const transformed = await fetch(imageUrl, {
    cf: {
      image: {
        width,
        format,
        quality: 85,
        fit: 'cover',
      },
    },
  })
  return new Response(transformed.body, {
    headers: {
      'Content-Type': transformed.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Vary': 'Accept',
    },
  })
})
```

Then in HTML:
```html
<img
  src="/media/feed-entries/123/cover-abc.jpg?w=400"
  srcset="/media/feed-entries/123/cover-abc.jpg?w=200 200w,
          /media/feed-entries/123/cover-abc.jpg?w=400 400w,
          /media/feed-entries/123/cover-abc.jpg?w=800 800w"
  sizes="(max-width: 480px) 200px, 400px"
  loading="lazy"
  decoding="async"
/>
```

#### CF Polish

Polish is a Cloudflare zone-level setting (Dashboard → Speed → Optimization → Polish). Enable "Lossless" or "Lossy". It auto-converts to WebP for supporting browsers. **No code change required.** However, Polish operates on cacheable responses; it does not run when a Worker intercepts and returns a Response directly. Image Resizing (above) supersedes Polish for Worker-served assets.

#### Important constraints

- **Cloudflare Image Resizing requires a paid Cloudflare plan** (Pro or above) on the zone where the Worker runs. On the free plan, `cf.image` transforms are silently ignored. **Flag: verify the Cloudflare plan before relying on this.**
- If the zone is on the free plan: serve images directly from R2 (current behaviour) and add `loading="lazy"` + reasonable `max-width` CSS. Skip format negotiation. Accept the limitation.
- AVIF encoding via CF Image Resizing is supported on Cloudflare's paid tiers. WebP is more widely supported and should be the primary modern target.

#### What NOT to use

- `sharp` — not available in Cloudflare Workers (Node.js native module).
- `@cf-wasm/photon` or similar WASM image libraries — large WASM binary, slow first-load, overkill for this scale.
- Imgix / Cloudinary — paid services, violates the zero-cost constraint.

**Confidence:** MEDIUM. CF Image Resizing capabilities are well-documented. The paid-plan requirement is a known platform constraint. Specific API shape of `cf.image` in fetch is stable. Could not verify if free plan changed as of 2026 in this session — treat the paid-plan constraint as HIGH-confidence until verified.

---

### 5. Minification for vanilla JS inlined in HTML on Cloudflare Pages

**Recommendation: `html-minifier-terser` as a one-shot build script in the pnpm workspace.**

#### Current state

`apps/onlydate/index.html` and `apps/onlydate/photochoose/index.html` are static HTML files with large inline `<script>` blocks. There is no bundler. Cloudflare Pages serves the files as-is.

#### Recommended approach

Add a minimal build step that runs `html-minifier-terser` over the HTML files before `wrangler pages deploy`. No bundler (webpack/vite/esbuild) introduction needed.

```jsonc
// package.json in apps/onlydate (or root)
{
  "scripts": {
    "build:html": "html-minifier-terser --collapse-whitespace --remove-comments --minify-js true --minify-css true apps/onlydate/index.html -o dist/index.html && html-minifier-terser --collapse-whitespace --remove-comments --minify-js true --minify-css true apps/onlydate/photochoose/index.html -o dist/photochoose/index.html",
    "deploy:pages": "pnpm run build:html && wrangler pages deploy dist --project-name onlydate"
  }
}
```

`html-minifier-terser` (npm: `html-minifier-terser`, ~500 KB install) uses Terser internally for `<script>` block minification. It handles inline JS correctly, including ES2020+ syntax.

**Estimated savings:** 30–50% reduction in HTML file size for a 1400-line file with significant inline JS.

#### Alternative: esbuild

If the team later wants to split JS into separate files and bundle, `esbuild` is the right choice — fastest bundler, supports ESM/IIFE output, minimal config. But for this milestone's constraint ("extend, don't rewrite"), `html-minifier-terser` is less disruptive.

#### What NOT to use

- Vite / webpack / Rollup — too much infrastructure change for a vanilla JS file.
- Uglify-js — does not support ES2020+ syntax (let/const/arrow functions/optional chaining). The existing inline JS likely uses modern syntax.
- Manual minification — not maintainable.

**Confidence:** HIGH. `html-minifier-terser` is the standard tool for this exact use case (HTML with inline script minification). Terser is the current standard for ES2020+ JS minification.

---

### 6. PostHog + Telegram initData user identification — distinctId strategy

**Recommendation: Use the Telegram `user.id` (integer) as the PostHog `distinctId`, cast to string.**

#### Rationale

Telegram `user.id` is:
- Globally unique and stable per Telegram account.
- Available on the server after `initData` validation (see section 3 above).
- Equal to the DM `chat_id` for that user — the same ID used elsewhere in the system.
- Never reused by Telegram for different accounts.

Since all events are captured server-side (Worker), and the Worker has already validated `initData`, the `user.id` extracted from the validated `user` JSON blob is trustworthy.

```typescript
// After validateTelegramInitData() returns { valid: true, user }
const distinctId = String(user.id)  // e.g. "123456789"

ph.capture({
  distinctId,
  event: 'profile_open',
  properties: {
    handle,
    telegram_username: user.username ?? null,
    telegram_first_name: user.first_name ?? null,
    // Attribution
    start_param: startParam ?? null,
    utm_source: utmSource ?? null,
    utm_medium: utmMedium ?? null,
    utm_campaign: utmCampaign ?? null,
  },
})
```

#### What to set as person properties on first seen

PostHog has a concept of `$set` and `$set_once` for person properties. Use `$set_once` for attribution (capture the first-touch ad source once, never overwrite):

```typescript
ph.capture({
  distinctId,
  event: 'profile_open',
  properties: {
    // Event properties
    handle,
    // Person properties — set once on first event
    $set_once: {
      telegram_id: user.id,
      first_start_param: startParam ?? null,
      first_utm_source: utmSource ?? null,
      first_seen_at: new Date().toISOString(),
    },
    // Person properties — always update
    $set: {
      telegram_username: user.username ?? null,
      telegram_first_name: user.first_name ?? null,
    },
  },
})
```

#### What NOT to do

- Do not use `window.Telegram.WebApp.initDataUnsafe.user.id` client-side as the `distinctId` for server-side events — it is untrusted until validated.
- Do not call `posthog.identify()` browser-side — there is no browser-side PostHog SDK in this architecture.
- Do not use a random UUID as `distinctId` — Telegram user IDs are stable and allow cross-session identity linkage without a separate identity graph.
- Do not hash the Telegram user ID before using as `distinctId` — the ID is already opaque enough; hashing makes debugging harder without improving privacy in PostHog.

**Confidence:** MEDIUM-HIGH. The `distinctId` strategy is conventional PostHog guidance applied to Telegram context. `$set_once` for first-touch attribution is standard PostHog person property practice. Could not verify any Telegram-specific PostHog documentation in this session, but the pattern follows directly from both systems' documented designs.

---

## Full Stack Recommendation Table

| Category | Technology | Version | Purpose | Confidence |
|----------|-----------|---------|---------|------------|
| Analytics (server) | `posthog-node` | `^4.x` | Server-side event capture from Worker | MEDIUM |
| Analytics (browser) | none | — | No browser SDK — all via Worker | HIGH |
| Drag-drop reorder | `SortableJS` | `1.15.6` | Touch-friendly list reorder in admin UI | HIGH |
| Telegram validation | Web Crypto (inline) | Workers built-in | HMAC-SHA256 initData validation | HIGH |
| Image optimization | CF Image Resizing (`cf.image`) | Workers built-in | On-demand resize + format negotiation | MEDIUM (paid plan req.) |
| Image format | WebP primary / AVIF secondary | — | Format negotiation via `Accept` header | HIGH |
| HTML/JS minification | `html-minifier-terser` | `^7.x` | Minify inline JS+CSS in HTML pre-deploy | HIGH |
| PostHog host | PostHog Cloud free tier | — | `eu.posthog.com` or `us.posthog.com` | MEDIUM |
| User identity | Telegram `user.id` as string | — | `distinctId` for all analytics events | MEDIUM-HIGH |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Analytics SDK | `posthog-node` (server only) | `posthog-js` in browser | 80 KB browser payload, adblockers, untrusted user identity |
| Analytics SDK | `posthog-node` (server only) | Cloudflare reverse-proxy to PostHog | Only needed if browser sends events; architecture avoids browser calls entirely |
| Analytics host | PostHog Cloud free tier | Self-hosted PostHog | VM cost, operational burden — violates zero-paid-services constraint |
| Analytics host | PostHog Cloud free tier | Plausible / Fathom | Paid tiers only for the features needed (funnels, cohorts) |
| Drag-drop | SortableJS | Dragula | Unmaintained, iOS touch unreliable |
| Drag-drop | SortableJS | Shopify Draggable | 35 KB — exceeds 10 KB budget |
| Drag-drop | SortableJS | Native HTML5 DnD | Broken on iOS Safari (Telegram iOS WebView) |
| Telegram validation | Inline Web Crypto routine | `@telegram-apps/init-data-node` | Adds a dependency for 30 lines; inline is trivial to audit |
| Image optimization | CF Image Resizing | `sharp` in Worker | Not available in Workers (native module) |
| Image optimization | CF Image Resizing | Cloudinary / Imgix | Paid — violates constraint |
| Minification | `html-minifier-terser` | Vite / webpack | Introduces full build pipeline; out of scope for "extend not rewrite" |
| Minification | `html-minifier-terser` | Uglify-js | Does not support ES2020+ (let/const/optional chaining) |

---

## Installation

```bash
# Worker — add to apps/onlydate-worker
pnpm add posthog-node

# Admin UI build tool — add to apps/onlydate (or root devDependencies)
pnpm add -D html-minifier-terser

# SortableJS — vendor the file (no bundler) or use CDN script tag
# Download: https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js
# Place at: apps/onlydate/vendor/sortable.min.js
# Reference in photochoose/index.html: <script src="/vendor/sortable.min.js"></script>
```

---

## Flags and Risks

| Risk | Severity | Mitigation |
|------|---------|-----------|
| CF Image Resizing requires paid Cloudflare plan | HIGH | Verify plan before implementing; fall back to raw R2 serving + CSS `max-width` if on free plan |
| `posthog-node` must `shutdownAsync()` before Worker returns | HIGH | Must be in every event-capturing code path; missing it silently drops events |
| PostHog free tier event limit (1M/month) | LOW | At 10k DAU × 5 events = 50k/day = 1.5M/month worst case — may exceed free tier at high DAU; monitor |
| SortableJS CDN availability | LOW | Vendor the file into the repo to eliminate CDN dependency |
| `initData` expires (Telegram sets `auth_date`) | MEDIUM | Add `auth_date` freshness check: reject if `Date.now()/1000 - auth_date > 86400` (24 h) |

---

## Sources

- Telegram Bot API — initData validation algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app (HIGH confidence — official spec, stable algorithm)
- PostHog Node SDK: https://posthog.com/docs/libraries/node (MEDIUM — training knowledge, could not verify live in this session)
- PostHog Cloudflare Workers guide: https://posthog.com/docs/libraries/cloudflare-workers (MEDIUM — training knowledge)
- SortableJS: https://github.com/SortableJS/Sortable (HIGH — well-established library, capabilities well-documented)
- Cloudflare Image Resizing: https://developers.cloudflare.com/images/image-resizing/ (MEDIUM — training knowledge; paid-plan requirement is a known platform fact)
- html-minifier-terser: https://github.com/terser/html-minifier-terser (HIGH — active project, widely used)
- Web Crypto API in Workers: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ (HIGH — documented platform API)

*Note: All external fetch/search tools were unavailable during this research session. Findings rely on training knowledge (cutoff August 2025). Recommendations marked MEDIUM should be spot-checked against current official docs before implementation.*
