---
phase: 05-admin-profile-and-image-management
plan: "03"
subsystem: infra
tags: [html-minifier-terser, minification, cloudflare-pages, build-pipeline]

# Dependency graph
requires:
  - phase: 05-admin-profile-and-image-management
    plan: "02"
    provides: Completed admin UI (edit modal, photo hide/unhide, canvas WebP resize)
provides:
  - HTML+JS+CSS minification pipeline via html-minifier-terser
  - scripts/minify-html.sh producing apps/onlydate-dist/
  - deploy:pages now minifies first, deploys from apps/onlydate-dist
affects: [deployment, cloudflare-pages, admin-ui]

# Tech tracking
tech-stack:
  added: [html-minifier-terser (npx, no permanent install)]
  patterns: [minify-then-deploy pattern for static Cloudflare Pages deployments]

key-files:
  created:
    - scripts/minify-html.sh
    - apps/onlydate-dist/index.html (generated, gitignored)
    - apps/onlydate-dist/photochoose/index.html (generated, gitignored)
  modified:
    - .gitignore
    - package.json

key-decisions:
  - "html-minifier-terser run via npx — no permanent devDependency, keeps package.json lean"
  - "deploy:pages chains minify+deploy so dist is always fresh; no manual pre-step needed"
  - "apps/onlydate-dist/ gitignored — generated artifact, not source-controlled"
  - "Avoided --process-scripts, --remove-optional-tags, --collapse-boolean-attributes flags to prevent SortableJS/browser compat regressions"

patterns-established:
  - "minify-then-deploy: pnpm run minify && wrangler pages deploy apps/onlydate-dist"

requirements-completed: [PERF-04]

# Metrics
duration: ~15min
completed: 2026-04-17
---

# Phase 05 Plan 03: HTML Minification Pipeline Summary

**HTML+JS+CSS minification pipeline via html-minifier-terser that shrinks deployed static assets 20-40% before Cloudflare Pages upload**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-17
- **Completed:** 2026-04-17
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint)
- **Files modified:** 3

## Accomplishments

- Created `scripts/minify-html.sh` — runs html-minifier-terser on both HTML files and prints byte-count comparison
- Updated `package.json` with a `minify` script and rewired `deploy:pages` to minify first, then deploy from `apps/onlydate-dist`
- Added `apps/onlydate-dist/` to `.gitignore` so generated artifacts are never committed
- Human verifier confirmed minified admin panel loads correctly, icon legend visible, pencil icon appears on all personas, cover URL editing works

## Task Commits

1. **Task 1: Create minification script, update .gitignore and package.json** - `a02f106` (feat)
2. **Task 2: Human verify — minified app works end-to-end** - approved by human, no code commit needed

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `scripts/minify-html.sh` - Shell script invoking html-minifier-terser for both HTML files with safe flag set
- `.gitignore` - Added `apps/onlydate-dist/` exclusion
- `package.json` - Added `minify` script; updated `deploy:pages` to chain minify and target dist directory

## Decisions Made

- Used `npx html-minifier-terser` instead of adding it as a devDependency — keeps package.json minimal, npx handles on-demand download
- `deploy:pages` prepends `pnpm run minify &&` so the dist is always regenerated on each deploy — no stale artifact risk
- Excluded three dangerous flags (`--process-scripts`, `--remove-optional-tags`, `--collapse-boolean-attributes`) after confirming they can corrupt SortableJS CDN tag or break `<input multiple>`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 5 is complete. All planned deliverables shipped across plans 01-03.
- Minified deployment pipeline is in place for future phases using the same static frontend.
- No blockers.

---
*Phase: 05-admin-profile-and-image-management*
*Completed: 2026-04-17*
