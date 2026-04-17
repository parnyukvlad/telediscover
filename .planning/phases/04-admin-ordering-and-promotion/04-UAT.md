---
status: complete
phase: 04-admin-ordering-and-promotion
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md]
started: 2026-04-17T00:00:00Z
updated: 2026-04-17T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Drag-drop reorder in admin panel
expected: Open the admin panel (photochoose). Feed_entry rows appear above legacy persona rows with a divider. Drag a feed_entry row to a different position — it moves smoothly. After drop, reload the admin panel and rows appear in the new order.
result: pass

### 2. Reorder reflects on public feed
expected: After dragging a feed_entry row to a new position in the admin panel, open the public Mini App feed. The feed cards appear in the same order as set in admin.
result: pass

### 3. Legacy personas always sort to bottom
expected: In both the admin panel and the public feed, legacy persona rows (non-feed_entry profiles) always appear below all feed_entry rows. Drag handles are absent on persona rows — they cannot be dragged.
result: pass

### 4. Promote toggle — admin panel
expected: In the admin panel, each feed_entry row has a promote button (star/gold icon). Clicking it activates gold highlighted state. Clicking again deactivates. The state persists after page reload.
result: pass

### 5. Promoted profiles sort first on public feed
expected: After promoting one or more feed_entry profiles in the admin panel, open the public Mini App feed. Promoted profiles appear at the top of the feed, above unpromoted entries.
result: pass

### 6. Promoted card star-sparkle animation
expected: In the public Mini App feed, promoted profile cards display an animated gold border glow and a small rotating star icon in the top-right corner. The animation runs smoothly (GPU-composited — no jank).
result: pass

### 7. Search disables drag handles
expected: In the admin panel, type anything in the search box. Drag handles on all rows disappear (hidden). Drag-and-drop is disabled while search is active. Clearing the search restores the handles.
result: pass

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

