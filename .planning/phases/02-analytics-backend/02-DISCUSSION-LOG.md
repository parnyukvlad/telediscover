# Phase 2: Analytics Backend - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 02-analytics-backend
**Areas discussed:** PostHog setup, auth_date freshness, dev HMAC bypass, route file placement

---

## PostHog Setup

| Option | Description | Selected |
|--------|-------------|----------|
| Self-hosted PostHog | Operator runs their own PostHog instance | |
| Cloud free tier (EU) | app.posthog.com EU region, free tier | ✓ |

**User's choice:** Cloud free tier, EU region. Project token provided: `phc_zprkyviP8t2JwCCMWQUPn3GwJmi6MtAXvApPkUBXtf6f`

**Notes:** Operator mentioned a PostHog AI wizard install command (`npx -y @posthog/wizard@latest --region eu`). Not used — we use plain fetch to the capture endpoint per prior STATE.md decision (posthog-node SDK blocks response latency). Token stored as Wrangler secret `POSTHOG_API_KEY`. EU capture host: `https://eu.i.posthog.com`.

---

## auth_date Freshness Window

| Option | Description | Selected |
|--------|-------------|----------|
| 1 hour | Very strict; many returning users with cached WebViews rejected | |
| 24 hours | Standard Telegram recommendation | ✓ |
| 7 days | Lenient; good for long-session apps | |

**User's choice:** 24 hours (86400 seconds).

**Notes:** Telegram's aggressive WebView caching means returning users' initData may be hours old. 24h is the industry standard and balances security vs. valid event acceptance.

---

## Dev/Local HMAC Bypass

| Option | Description | Selected |
|--------|-------------|----------|
| Bypass when ENVIRONMENT != "production" | Easier local dev | |
| Always enforce | No bypass; devs use real BOT_TOKEN in .dev.vars | ✓ |

**User's choice:** "I don't know, we just need to have production version" — interpreted as: always enforce, no dev bypass needed.

**Notes:** Claude's discretion — always enforce is simpler and avoids a security footgun (bypass accidentally left enabled). Local dev uses `.dev.vars` with real `BOT_TOKEN`.

---

## Route File Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Fold into routes/public.ts | Fewer files | |
| New routes/analytics.ts | Separate concern, cleaner public.ts | ✓ (Claude's discretion) |

**User's choice:** Deferred to Claude.

**Notes:** Claude chose `routes/analytics.ts` — HMAC validation is a distinct enough concern from public feed/media serving; keeps `public.ts` focused on read-only data serving.

---

## Claude's Discretion

- `sendToPostHog()` function placement (local to analytics.ts vs shared/telegram.ts)
- PostHog capture payload exact structure
- Error handling for PostHog relay failure (swallowed)

## Deferred Ideas

None.
