---
phase: 05-admin-profile-and-image-management
plan: 02
subsystem: admin-ui
tags: [admin, frontend, photochoose, edit-modal, image-resize, feed-entry]
dependency_graph:
  requires: [05-01]
  provides: [edit-modal-ui, feed-photo-hide-toggle, client-side-resize]
  affects: [apps/onlydate/photochoose/index.html]
tech_stack:
  added: []
  patterns: [canvas-resize-webp, in-memory-state-update, modal-pattern]
key_files:
  created: []
  modified:
    - apps/onlydate/photochoose/index.html
decisions:
  - Edit modal reuses existing .modal-card/.modal-input/.modal-btn-* CSS classes — no new stylesheet needed
  - resizeToWebP placed in Helpers section before showToast — consistent with existing utility placement
  - Feed entry photo eye toggle uses btn-eye/hidden-state classes already defined for persona photos — no new CSS needed
metrics:
  duration: 2m
  completed: "2026-04-17"
  tasks_completed: 3
  files_modified: 1
---

# Phase 05 Plan 02: Admin UI — Edit Modal, Photo Hide Toggle, Client-side Resize

**One-liner:** Edit modal for feed_entry metadata + eye toggle for feed_entry gallery photos + canvas-based WebP resize (max 800px, 0.85 quality) before upload.

## What Was Built

Three UI features added to `apps/onlydate/photochoose/index.html`:

1. **Edit modal** — a `#edit-modal-overlay` modal pre-filled with current display_name, handle, cover_url. Triggered by a pencil (✏) button on each feed_entry row. Submits to `POST /api/onlydate/admin/feed-entry/update`, updates `allPersonas` in-memory, re-renders the list without page refresh.

2. **Feed entry photo hide toggle** — each gallery photo in a feed_entry's photo grid now shows an eye button (👁 / 🚫, `data-action="toggle-feed-photo"`). Clicking calls `POST /api/onlydate/admin/feed-entry/photo/toggle-hidden` and immediately updates the card's CSS (hidden-photo class) and button state.

3. **Client-side canvas resize** — `resizeToWebP(file, maxPx, quality)` utility added in the Helpers section. Uses canvas.toBlob to downscale images to max 800px and encode as WebP. Safari fallback: checks `blob.type` after toBlob and uses the actual extension (png/jpg) if WebP is not supported. Called in both `uploadGalleryPhotos()` and `submitNewPersona()` before `uploadFile()`.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add Edit modal (HTML + CSS) and wire Edit button in persona row | 2c4a9d7 | apps/onlydate/photochoose/index.html |
| 2 | Add hide/unhide toggle on feed_entry gallery photos | 5f18de4 | apps/onlydate/photochoose/index.html |
| 3 | Client-side canvas resize to WebP before upload (PERF-03) | d7092bb | apps/onlydate/photochoose/index.html |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- apps/onlydate/photochoose/index.html — modified (exists)
- Commit 2c4a9d7 — exists (feat: edit modal)
- Commit 5f18de4 — exists (feat: hide toggle)
- Commit d7092bb — exists (feat: resize)
- grep edit-modal-overlay → 4 (≥2 required)
- grep feed-entry/update → 1 (≥1 required)
- grep toggle-feed-photo → 2 (≥2 required)
- grep resizeToWebP → 3 (≥3 required)
- grep blob.type === 'image/webp' → 1 (≥1 required)
