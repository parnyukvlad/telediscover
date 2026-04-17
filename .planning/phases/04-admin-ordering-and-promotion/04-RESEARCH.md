# Phase 4: Admin — Ordering and Promotion - Research

**Researched:** 2026-04-17
**Domain:** Drag-drop reordering (admin), promotion toggle + animated star frame (public feed), D1 batch sort_order persistence
**Confidence:** HIGH

## Summary

Phase 4 adds three capabilities: (1) drag-and-drop reordering of feed entries in the admin panel, (2) a promotion toggle that floats entries to the top of the public feed, and (3) a CSS animated star-sparkle frame around promoted cards on the public feed. The schema columns (`sort_order`, `is_promoted`) and their composite index already exist from Phase 1 migration `0004_feed_entry_ordering.sql`. The public feed query in `routes/public.ts` currently ignores these columns -- it orders by `message_count` or `created_at` depending on tab. This must change to `ORDER BY is_promoted DESC, sort_order ASC` as the primary ordering, with the current tab-based ordering as a secondary concern or replaced entirely.

The admin panel (`photochoose/index.html`, 1411 lines) renders a flat persona list via `renderPersonaList()`. Drag-and-drop must be added here. The PITFALLS document explicitly warns against HTML5 DnD API (broken on mobile touch) and recommends SortableJS. Since the project constraint is "no frontend framework" and SortableJS is a standalone library with zero dependencies, it fits perfectly. It should be vendored as a `<script>` tag from CDN or a local copy.

**Primary recommendation:** Use SortableJS 1.15.7 for admin drag-drop, D1 `batch()` for atomic sort_order persistence, and a CSS-only `@keyframes` animation (transform + opacity) for the star-sparkle frame on promoted cards.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-08 | Drag-and-drop reorder feed entries in admin (SortableJS, touch-friendly) | SortableJS 1.15.7 handles touch+mouse; Pitfall 9 prevention; admin list already renders via `renderPersonaList()` |
| ADMIN-09 | Reorder persists to D1 (sort_order column, atomic batch update) and reflects on public feed | D1 `batch()` API provides atomic transactions; `sort_order` column exists from migration 0004; public feed query needs ORDER BY update |
| ADMIN-10 | Legacy personas rows always sort to bottom without override table | UNION query assigns synthetic `sort_order = 9999999` to personas branch; already a project decision (STATE.md) |
| PROMO-01 | Admin can toggle feed entry as promoted (binary is_promoted column) | `is_promoted` column exists from migration 0004; new admin endpoint + UI toggle needed |
| PROMO-02 | Promoted profiles sort above unpromoted on public feed | `ORDER BY is_promoted DESC, sort_order ASC` uses existing composite index `idx_feed_entries_sort` |
| PROMO-03 | Promoted profiles render with animated star-sparkle frame (GPU-composited CSS) | CSS-only `@keyframes` using `transform`/`opacity`; Pitfall 12 prevention; IntersectionObserver for off-screen pause |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SortableJS | 1.15.7 | Touch-friendly drag-and-drop list reordering | Zero dependencies, works on touch+mouse, 29KB minified, recommended by PITFALLS.md over HTML5 DnD |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| D1 batch() | Built-in | Atomic multi-row sort_order update | Every reorder save -- prevents partial updates |
| IntersectionObserver | Browser API | Pause star animation for off-screen cards | On public feed for promoted card animation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SortableJS | Custom Pointer Events drag | PITFALLS.md Pitfall 9 details a full custom implementation; SortableJS wraps all of this (threshold, setPointerCapture, touch-action). Custom code would be 100-200 lines of boilerplate that SortableJS already handles. |
| SortableJS CDN | Vendored local copy | CDN avoids repo bloat; local copy avoids CDN dependency. Either works -- CDN is simpler for a vanilla JS project with no build step. |

**Installation:**
SortableJS is loaded via `<script>` tag (no npm install needed -- project has no frontend build step):
```html
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js"></script>
```

**Version verification:** SortableJS 1.15.7 confirmed as latest via `npm view sortablejs version` on 2026-04-17.

## Architecture Patterns

### Files Modified

```
apps/onlydate-worker/src/routes/admin.ts     # New endpoints: reorder, toggle-promoted
apps/onlydate-worker/src/routes/public.ts     # Update feed query ORDER BY
apps/onlydate/photochoose/index.html          # SortableJS drag UI, promote toggle
apps/onlydate/index.html                      # Star-sparkle CSS + is_promoted rendering
```

No new files needed. No migrations needed (columns exist from Phase 1).

### Pattern 1: Batch Sort Order Update (Backend)

**What:** When admin reorders, frontend sends the full ordered list of IDs. Backend writes `sort_order = index` for each entry in a single D1 `batch()` call.

**When to use:** Every drag-drop completion (SortableJS `onEnd` event).

**Example:**
```typescript
// POST /api/onlydate/admin/feed-entries/reorder
// Body: { order: ["id1", "id2", "id3"] }
app.post('/api/onlydate/admin/feed-entries/reorder', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { order?: string[] };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!Array.isArray(body.order) || body.order.length === 0) {
    return c.json({ error: 'order array required' }, 400);
  }

  try {
    const stmts = body.order.map((id, i) =>
      c.env.DB.prepare('UPDATE onlydate_feed_entries SET sort_order = ? WHERE id = ?')
        .bind(i + 1, id)
    );
    await c.env.DB.batch(stmts);
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] reorder error:', err);
    return c.json({ error: 'Reorder failed' }, 500);
  }
});
```

**Source:** D1 batch API docs (https://developers.cloudflare.com/d1/worker-api/d1-database/)

### Pattern 2: Promotion Toggle (Backend)

**What:** Simple PUT of `is_promoted` column on a single feed entry. Must reject `personas`-source rows.

**Example:**
```typescript
// POST /api/onlydate/admin/feed-entry/toggle-promoted
// Body: { feed_entry_id: string, is_promoted: boolean }
app.post('/api/onlydate/admin/feed-entry/toggle-promoted', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { feed_entry_id?: string; is_promoted?: boolean };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.feed_entry_id) return c.json({ error: 'feed_entry_id required' }, 400);

  try {
    const val = body.is_promoted ? 1 : 0;
    await c.env.DB.prepare('UPDATE onlydate_feed_entries SET is_promoted = ? WHERE id = ?')
      .bind(val, body.feed_entry_id).run();
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] toggle-promoted error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});
```

### Pattern 3: Updated Public Feed Query

**What:** Replace current tab-based ordering with promotion-aware ordering. Personas always sort below feed entries.

**Key change in `routes/public.ts`:**
```sql
-- feed_entries branch: real sort_order and is_promoted
SELECT ...
  fe.is_promoted AS is_promoted,
  fe.sort_order  AS sort_order
FROM onlydate_feed_entries fe
WHERE ...

-- personas branch: always sort below, never promoted
SELECT ...
  0              AS is_promoted,
  9999999        AS sort_order
FROM personas p
WHERE ...

ORDER BY is_promoted DESC, sort_order ASC
LIMIT 100
```

The synthetic `sort_order = 9999999` for personas is an existing project decision (STATE.md: "Synthetic 9999999 sort_order for personas in UNION").

### Pattern 4: SortableJS Integration (Admin Frontend)

**What:** Initialize SortableJS on the persona list container after rendering.

**Example:**
```javascript
// After renderPersonaList() runs:
var sortable = Sortable.create($personaList, {
  animation: 150,
  handle: '.drag-handle',  // only drag via handle, not entire row
  filter: '[data-source="personas"]', // personas rows not draggable
  onEnd: function (evt) {
    // Reorder allPersonas array to match new DOM order
    var ids = Array.from($personaList.querySelectorAll('.persona-row[data-source="feed_entry"]'))
      .map(function (el) { return el.dataset.personaId; });
    // Send to server
    fetch(API_BASE + '/api/onlydate/admin/feed-entries/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Password': password },
      body: JSON.stringify({ order: ids })
    });
  }
});
```

### Pattern 5: Star-Sparkle Frame (Public Frontend CSS)

**What:** CSS pseudo-element animation on promoted cards. Uses only `transform` and `opacity` (GPU-composited, no layout thrashing).

**Example:**
```css
.model-card.promoted {
  position: relative;
}
.model-card.promoted::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: var(--radius-card);
  background: linear-gradient(135deg, #f59e0b, #fbbf24, #f59e0b);
  z-index: -1;
  opacity: 0.8;
  animation: promo-glow 2s ease-in-out infinite;
}
@keyframes promo-glow {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50%      { opacity: 1;   transform: scale(1.01); }
}
```

Star sparkle overlay (small rotating stars):
```css
.model-card.promoted::after {
  content: '';
  position: absolute;
  top: 4px; right: 4px;
  width: 20px; height: 20px;
  background: url('data:image/svg+xml,...') center/contain no-repeat; /* inline SVG star */
  animation: sparkle-spin 3s linear infinite;
  pointer-events: none;
}
@keyframes sparkle-spin {
  from { transform: rotate(0deg) scale(0.9); opacity: 0.7; }
  50%  { transform: rotate(180deg) scale(1.1); opacity: 1; }
  to   { transform: rotate(360deg) scale(0.9); opacity: 0.7; }
}
```

### Anti-Patterns to Avoid

- **Per-row sort_order updates with individual fetch calls:** Use D1 `batch()` to send all updates atomically in one call. Individual UPDATEs would mean N network roundtrips and risk partial updates on failure. (Architecture Anti-Pattern 3)
- **HTML5 Drag and Drop API:** Does not fire events on mobile touch devices. Always use SortableJS or Pointer Events. (Pitfall 9)
- **Animating `top`, `left`, `width`, `height`, `box-shadow` in keyframes:** Triggers layout recalculation per frame. Only animate `transform` and `opacity`. (Pitfall 12)
- **Applying `will-change` globally:** Only set `will-change: transform, opacity` on promoted cards, not all cards.
- **Silent no-op on personas rows:** Reorder/promote endpoints must check that the ID belongs to `onlydate_feed_entries`, not `personas`. Return 400 for read-only rows. (Pitfall 15)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Touch-friendly drag-drop | Custom Pointer Events handler | SortableJS 1.15.7 | Touch/mouse unification, drag threshold, scroll conflict resolution, animation -- all built in. Custom implementation is 150+ lines of edge-case-prone code. |
| Atomic multi-row UPDATE | Sequential individual UPDATEs | D1 `batch()` | batch() is transactional -- if one UPDATE fails, all roll back. Individual UPDATEs risk partial state. |
| Star animation | Canvas/Lottie/JS animation loop | CSS @keyframes (transform + opacity only) | CSS animations on compositor properties are GPU-offloaded. No JS execution overhead. No extra library. |

**Key insight:** SortableJS is the single external dependency this phase introduces. Everything else (D1 batch, CSS animations, IntersectionObserver) is built-in platform capability.

## Common Pitfalls

### Pitfall 1: SortableJS Filter vs Handle Interaction
**What goes wrong:** If SortableJS `filter` option is not set, `personas`-source rows become draggable even though reorder cannot persist for them. Dragging a personas row triggers a reorder that silently fails or corrupts the order array.
**Why it happens:** `renderPersonaList` renders both sources in the same container.
**How to avoid:** Add `data-source` attribute to each `.persona-row`. Set `filter: '[data-source="personas"]'` in SortableJS config. This makes personas rows non-draggable.
**Warning signs:** Personas rows visually drag but the order never saves.

### Pitfall 2: renderPersonaList Re-renders Destroy SortableJS Instance
**What goes wrong:** `renderPersonaList()` replaces `$personaList.innerHTML` entirely. If SortableJS was initialized on the container, the instance is orphaned and the new DOM elements are not sortable.
**Why it happens:** The admin panel calls `renderPersonaList()` after every mutation (delete, visibility toggle, search filter).
**How to avoid:** Either (a) re-initialize SortableJS after every `renderPersonaList()` call, or (b) separate the drag-order list from the search-filtered list (only show drag handles when not searching). Option (a) is simpler -- SortableJS `create()` is cheap.
**Warning signs:** Drag works on first load, stops working after any list mutation.

### Pitfall 3: sort_order Gaps After Delete
**What goes wrong:** Admin deletes a feed entry with `sort_order = 3`. Entries with sort_order 1, 2, 4, 5 remain. The next reorder save must renumber from 1. If the admin never drags again, the gap persists -- functionally harmless but aesthetically messy.
**Why it happens:** Delete does not renumber remaining entries.
**How to avoid:** This is acceptable. The `ORDER BY sort_order ASC` query works correctly with gaps. No action needed unless the admin panel displays sort_order numbers to the user.

### Pitfall 4: Public Feed ORDER BY Conflicts with Tab Sorting
**What goes wrong:** Currently the public feed query orders by `message_count DESC` (trending), `created_at DESC` (new), or `message_count DESC` (popular). Introducing `ORDER BY is_promoted DESC, sort_order ASC` replaces tab-based ordering entirely for `onlydate_feed_entries`. For `personas` rows, there is no `sort_order` or `is_promoted` column -- the UNION must assign synthetic defaults.
**Why it happens:** Two competing ordering intents (admin manual order vs tab algorithm).
**How to avoid:** Use `is_promoted DESC, sort_order ASC` as the primary ordering. The tab-based ordering becomes secondary (or irrelevant for feed_entries that have explicit sort_order). Personas rows always get `is_promoted = 0, sort_order = 9999999` in the UNION.

### Pitfall 5: IntersectionObserver Not Pausing Off-Screen Animations
**What goes wrong:** Promoted card star animations run continuously even when scrolled off screen, wasting GPU cycles and battery on mobile.
**Why it happens:** CSS animations run by default regardless of visibility.
**How to avoid:** Use IntersectionObserver to toggle `animation-play-state: paused` on promoted cards that leave the viewport.
**Warning signs:** Battery drain complaints; Chrome DevTools shows continuous paint events for off-screen elements.

## Code Examples

### Admin Panel: SortableJS Initialization
```javascript
// After renderPersonaList() completes:
function initSortable() {
  if (window._sortable) window._sortable.destroy();
  window._sortable = Sortable.create($personaList, {
    animation: 150,
    handle: '.drag-handle',
    filter: '[data-source="personas"]',
    ghostClass: 'sortable-ghost',
    onEnd: async function () {
      var ids = [];
      $personaList.querySelectorAll('.persona-row[data-source="feed_entry"]').forEach(function (el) {
        ids.push(el.dataset.personaId);
      });
      if (ids.length === 0) return;
      try {
        await fetch(API_BASE + '/api/onlydate/admin/feed-entries/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Password': password },
          body: JSON.stringify({ order: ids })
        });
      } catch {
        showToast('Reorder failed');
      }
    }
  });
}
```

### Public Feed: Star Animation with IntersectionObserver
```javascript
// After renderGrid() completes:
function observePromotedCards() {
  if (!('IntersectionObserver' in window)) return;
  var cards = document.querySelectorAll('.model-card.promoted');
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      entry.target.style.animationPlayState = entry.isIntersecting ? 'running' : 'paused';
      // Also pause pseudo-element animations via a class toggle
      entry.target.classList.toggle('offscreen', !entry.isIntersecting);
    });
  }, { threshold: 0 });
  cards.forEach(function (card) { observer.observe(card); });
}
```

### Admin Panel: Promote Toggle Button
```javascript
// Inside persona-row rendering:
function promoteBtn(p) {
  if (p.source !== 'feed_entry') return '';
  var cls = p.is_promoted ? 'btn-promo active' : 'btn-promo';
  var label = p.is_promoted ? 'Promoted' : 'Promote';
  return '<button class="' + cls + '" data-action="toggle-promoted" ' +
    'data-persona-id="' + escHtml(p.id) + '">' + label + '</button>';
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTML5 DnD API | SortableJS / Pointer Events | ~2018 | HTML5 DnD never worked on mobile; SortableJS is the standard for touch-friendly drag lists |
| JS-driven animations (requestAnimationFrame) | CSS @keyframes with compositor-only properties | ~2020 | GPU-composited CSS animations are smoother and more battery-efficient than JS-driven loops |
| Individual DB updates for sort_order | D1 batch() atomic transactions | D1 GA (2024) | batch() guarantees atomicity and reduces network roundtrips |

## Open Questions

1. **Tab ordering vs admin ordering on public feed**
   - What we know: Currently tabs (trending/popular/new) determine sort order. Phase 4 introduces admin-controlled `sort_order` + `is_promoted`.
   - What's unclear: Should admin ordering completely replace tab ordering, or should promoted/ordered entries appear first with tab-sorted entries filling below?
   - Recommendation: Replace tab ordering entirely with `ORDER BY is_promoted DESC, sort_order ASC`. The "trending/popular/new" tabs can be kept as UI but all serve the same admin-controlled order. This is the simplest approach and matches the product intent (operator controls who appears first). If the user wants tab-specific ordering later, it can be layered on in a future phase.

2. **Admin panel: drag mode vs search mode**
   - What we know: The admin panel has a search input that filters the persona list. Dragging during a filtered view would produce an incomplete order array.
   - What's unclear: Should drag handles be hidden during search?
   - Recommendation: Hide drag handles when search is active. Only allow reordering on the unfiltered list. This prevents confusion and partial-order bugs.

3. **Personas rows position in admin list**
   - What we know: Personas are read-only and always sort to bottom on the public feed. In the admin panel they currently intermix with feed entries sorted alphabetically.
   - What's unclear: Should the admin panel visually separate personas from feed entries?
   - Recommendation: Show feed entries first (in sort_order), then personas below a divider. This matches the public feed order and makes it clear which items are draggable.

## Project Constraints (from CLAUDE.md)

- **Tech stack:** Stay on Cloudflare Workers + D1 + R2 + vanilla JS frontend. No frontend framework.
- **Budget:** Zero paid external services.
- **Persona sources:** `personas` table stays read-only. Do not write to it.
- **Compatibility:** Existing Mini App URL must keep working.
- **Simplicity:** Minimum code that solves the problem. No speculative features.
- **Surgical changes:** Touch only what is needed. Match existing style.
- **SortableJS vendored directly:** Per REQUIREMENTS.md "SortableJS vendored directly" is acceptable.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (no test infrastructure exists -- CONCERNS.md CRITICAL gap) |
| Config file | none |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-08 | Drag-drop reorders admin list | manual-only | Human verification in admin panel | N/A |
| ADMIN-09 | Reorder persists to D1 and reflects on public feed | manual-only | Human verification: reorder in admin, reload public feed | N/A |
| ADMIN-10 | Personas rows sort below feed entries | manual-only | Human verification: check public feed order | N/A |
| PROMO-01 | Toggle promoted in admin | manual-only | Human verification in admin panel | N/A |
| PROMO-02 | Promoted entries sort above unpromoted on public feed | manual-only | Human verification: toggle promotion, reload feed | N/A |
| PROMO-03 | Star-sparkle frame renders on promoted cards, smooth on Android | manual-only | Visual inspection + Chrome DevTools performance audit | N/A |

### Sampling Rate
- **Per task commit:** Manual verification (no automated tests)
- **Per wave merge:** Manual verification of all 6 requirements
- **Phase gate:** All success criteria verified manually via `/gsd:verify-work`

### Wave 0 Gaps
- No test infrastructure exists. Per REQUIREMENTS.md, automated test suite is deferred to v2.
- All Phase 4 requirements are UI/interaction behaviors best verified manually.

## Sources

### Primary (HIGH confidence)
- D1 batch() API: https://developers.cloudflare.com/d1/worker-api/d1-database/ -- atomic transaction semantics confirmed
- SortableJS npm registry: `npm view sortablejs version` -- 1.15.7 confirmed 2026-04-17
- Project migration `0004_feed_entry_ordering.sql` -- sort_order and is_promoted columns verified in codebase
- Project STATE.md -- synthetic `9999999` sort_order for personas in UNION is a locked decision
- Project PITFALLS.md -- Pitfalls 9, 12, 15 directly apply to this phase

### Secondary (MEDIUM confidence)
- SortableJS GitHub: https://github.com/SortableJS/Sortable -- touch support, filter/handle options
- CSS compositor properties (transform, opacity): MDN Web Docs -- stable browser behavior
- IntersectionObserver API: MDN Web Docs -- widely supported, W3C standard

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- SortableJS is the established library; D1 batch() is documented; CSS animations are well-understood
- Architecture: HIGH -- all modified files are well-understood from prior phases; patterns follow existing conventions
- Pitfalls: HIGH -- PITFALLS.md already documents the exact pitfalls for this phase with prevention strategies

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable domain -- no fast-moving dependencies)
