# Release reconciliation audit — 2026-08-24

This log records concrete findings and fixes from the requested release pass.
Each batch is pushed independently and must be confirmed by macOS CI before it
is considered verified.

## Batch 1 — symbols and Explore component consolidation

| Finding | Location | Resolution |
| --- | --- | --- |
| Invalid SF Symbol `speedometer` silently rendered as a blank image. | `FunctioningFaith/Views/WorkoutView.swift:181` | Replaced with catalog-verified `gauge.with.dots.needle.50percent`. |
| `FFQuickTile` duplicated Explore tile intent but had no call sites after `ExploreCatalogGrid` became the Explore grid. | `FunctioningFaith/Views/SharedComponents.swift:185` | Removed the orphan; retained `ExploreCatalogGrid`, which provides destinations, descriptions, adaptive two-column layout, and accessibility hints. |

### Verification

- Catalog comparison: 107 literal `systemName` / `systemImage` values, 0 invalid
  values against the Apple SF Symbols catalog snapshot named in the release brief.
- `rg` confirmed no remaining `FFQuickTile` or `speedometer` references.
- `npm --prefix webapp run verify:native-interactions` passed.
- `node --check webapp/routes/api.js` passed.
- Swift compilation is intentionally deferred to macOS CI / Codemagic, because
  this Windows workspace has no local iOS compiler.

## Batch 2 — release pipeline trigger

| Finding | Location | Resolution |
| --- | --- | --- |
| The signed TestFlight workflow could be started manually but had no `main` push trigger, so a native change could miss release verification. | `codemagic.yaml:ios-testflight` | Added an explicit `push` trigger limited to `main`; Codemagic remains the signing and TestFlight delivery path. |

## Batch 3 — native visual system consistency

| Finding | Location | Resolution |
| --- | --- | --- |
| Native root used a literal system orange status color. | `FunctioningFaithApp.swift:29` | Replaced with `FFTheme.hearth`. |
| Biometric lock and Reels empty state used default prominent system button chrome. | `BiometricLock.swift:52`, `Views/ReelsFeedView.swift:27` | Replaced with the branded `ffPrimary` style. |
| Workout sensor and beacon controls used default bordered button chrome. | `Views/WorkoutView.swift:174`, `Views/WorkoutView.swift:193` | Replaced with `ffGhost`. |
| Completed goals relied on system green alone. | `Views/StatsView.swift:106` | Replaced with the branded emerald token. |
| Explore tiles used literal spacing/radius values. | `Views/ExploreCatalog.swift:112-134` | Replaced relevant padding, vertical spacing, and corner radius literals with `FFTheme` tokens. |

### Verification

- Repository search found no remaining `.bordered` / `.borderedProminent`
  button styles or literal brand `foregroundStyle` colors.
- `npm --prefix webapp run verify:native-interactions` passed.
- `node --check webapp/routes/api.js` and `git diff --check` passed.

## Batch 4 — Moment ownership, viewers, and retention

| Finding | Location | Resolution |
| --- | --- | --- |
| Moment creators could not see who watched their active Moment. | `webapp/routes/api.js`, `Views/StoryViewerView.swift` | Added a creator-only, searchable viewer list. It excludes the creator from the count and caps returned rows at 100. |
| A creator could not deliberately retain a still-active Moment. | `webapp/routes/api.js`, `APIClient.swift`, `StoryViewerView.swift` | Added an authenticated owner-only extension that adds exactly 24 hours and cannot resurrect an expired Moment. |
| The Moment viewer search could display an older request after a newer one. | `Views/StoryViewerView.swift` | Added cancellation guards before state updates. |
| Moment cache verification was pinned to historic release version strings. | `webapp/scripts/verify-story-replies.js` | Validates versioned bundle and shell-cache behavior without accepting an unversioned asset. |

### Verification

- `npm --prefix webapp run verify:story-ownership` passed.
- `npm --prefix webapp run verify:story-replies` passed.
- `npm --prefix webapp run verify:native-interactions`, `node --check webapp/routes/api.js`, and `git diff --check` passed.
- A fresh canonical SF Symbols comparison found 0 invalid literal symbols.
