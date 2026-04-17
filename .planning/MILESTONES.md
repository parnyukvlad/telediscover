# Milestones

## v1.0 Ad-Launch Readiness (Shipped: 2026-04-17)

**Phases completed:** 5 phases, 15 plans, 21 tasks

**Key accomplishments:**

- 9:16 portrait centering, 100dvh fallback stack, and iOS safe-area padding applied to index.html via CSS-only changes
- One-liner:
- Two new admin POST endpoints (reorder via D1 batch, toggle-promoted) and a promotion-aware public feed query (is_promoted DESC, sort_order ASC) replacing tab-dependent ordering
- SortableJS drag-drop reordering with promote toggle added to admin panel — feed entries draggable, personas read-only, drag disabled during search
- Gold animated glow border and spinning star icon on promoted feed cards, paused off-screen via IntersectionObserver using GPU-composited transform + opacity only

---
