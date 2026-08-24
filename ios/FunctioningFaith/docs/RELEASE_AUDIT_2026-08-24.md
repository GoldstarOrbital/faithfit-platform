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
