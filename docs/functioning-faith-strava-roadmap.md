# Functioning Faith: Strava-Inspired Product Improvement Roadmap

**Author:** Manus AI  
**Repository:** `GoldstarOrbital/faithfit-platform`  
**Deployment:** Railway, auto-deployed from `main`  
**Assessment date:** 2026-08-14

## Executive assessment

Functioning Faith already has an unusually broad product surface: GPS and manual activity logging, BLE heart-rate support, analytics, challenges, scripture search, social feed, group communication, church discovery, shareable activities, Strava synchronization, and PWA capabilities. The principal gap is not feature count. It is **experience compression**: the app needs to make the most important actions, metrics, and feedback states feel immediate and legible in the first few seconds of use.

Strava’s public product positioning reinforces a compact loop: start an activity quickly, return to a detailed map and performance summary, then share that effort inside a focused community feed [1]. Its current Activity Replay and map-style system also show the value of progressive visual storytelling: a static fallback first, followed by animated route playback and data-driven map treatments when available [2] [3]. Functioning Faith should borrow that interaction discipline without copying Strava’s brand or fitness-only framing.

## Prioritized roadmap

| Priority | Improvement | Impact | Effort | Why it matters | Proposed acceptance criteria |
|---|---|---:|---:|---|---|
| P0 | Replace the fixed 480px desktop shell with a responsive product canvas while preserving the mobile-first reading width | High | Medium | The live desktop view currently presents a narrow phone-like column surrounded by large empty margins. This makes the product feel like a prototype on laptop screens and reduces information density. | At widths above 900px, the app uses a centered two-column or wide single-column layout with a stable max width; at 320–480px it remains edge-to-edge and safe-area aware; no horizontal overflow. |
| P0 | Establish a single design-token layer for typography, spacing, elevation, focus rings, and motion, then remove conflicting late-file overrides | High | Medium | `styles.css` contains multiple generations of button/card overrides and repeated motion rules. A tokenized cascade will make the UI more predictable and easier to extend. | All primary interactive elements share consistent height, radius, focus, hover, active, and disabled states; spacing follows a 4/8px rhythm; reduced-motion users receive no nonessential animation. |
| P0 | Add a real loading/error/empty-state system for feed, stats, explore, and workout screens | High | Medium | A social fitness app must explain what is happening during network latency and recover gracefully from failed calls. Silent `catch` paths and direct `innerHTML` replacement make state changes easy to miss. | Every async screen has skeleton or progress feedback, an explicit retry path, and a useful empty state; errors are announced in a live region and do not leave stale controls active. |
| P0 | Make activity cards the visual center of the home feed | High | Medium | Strava’s feed makes activity type, time, route/map, and key metrics scannable as one coherent unit. Functioning Faith’s feed has the underlying data model but its current card hierarchy is visually dense and ornamental. | Activity cards show author/time, activity type, primary metric, route preview, secondary metrics, scripture/faith context, and clear actions in a consistent order; cards remain scannable at 320px. |
| P1 | Upgrade route and metric visualization with a progressive map treatment | High | High | Strava’s current map styles and Activity Replay demonstrate that map output can be both data-rich and emotionally engaging [2] [3]. | Static route preview loads immediately; enhanced gradient/animation is optional and progressively added; map failure falls back to a readable metric card; privacy controls are visible before sharing. |
| P1 | Rework bottom navigation for thumb reach, active-state clarity, and larger tap targets | High | Low | The current five-item bar uses small Cinzel labels and a dark textured rail. It is distinctive but less legible and less forgiving than a modern mobile navigation pattern. | Targets are at least 44px high, active tab has icon + label + contrast state, labels remain readable at 320px, and safe-area padding is preserved. |
| P1 | Add motion choreography for navigation, modal entry, feed insertion, and workout completion | Medium | Medium | The existing `visual-polish.js` adds generic card reveals and hover transforms, but not task-level transitions. Generic motion can feel decorative rather than purposeful. | Screen transitions use short, interruptible, reduced-motion-aware animations; loading-to-success transitions preserve context and never hide content behind delayed reveals. |
| P1 | Improve semantic accessibility and keyboard/screen-reader behavior | High | Medium | The app uses many generated controls and `innerHTML` render paths. It needs stronger landmark semantics, focus management for modals, explicit button names, live status messaging, and color-independent states. | Automated checks show no critical axe violations on core screens; modal focus is trapped/restored; dynamic status changes use `role=status` or `aria-live`; all icon-only controls have accessible names. |
| P1 | Make PWA caching safer and more observable | Medium | Medium | The service worker is thoughtfully versioned and network-first for navigation, but the shell list and asset query versions require manual synchronization. | A single build/version constant updates HTML and service-worker assets together; an update prompt or safe refresh path exists; offline mode exposes a clear status rather than silently serving stale content. |
| P2 | Streamline onboarding and demo access | Medium | Low | The current public screen is dominated by sign-in and an easter-egg/audio welcome can interrupt the first task. A demo should open reliably and onboarding should establish the faith-and-fitness value proposition quickly. | Demo profile opens from a keyboard and pointer click; optional audio is opt-in or delayed; first-run copy explains the core loop in one screen. |
| P2 | Add feed controls that clarify scope and freshness | Medium | Low | The feed needs explicit “Following/Discover” scope, date grouping, refresh feedback, and clear pagination. This follows the lesson that feed context and counts must be explicit [4]. | Current feed scope is visible, refresh/pagination state is announced, and stale content never looks like a fresh update. |
| P2 | Add visual regression and smoke coverage for core journeys | Medium | Medium | This is a vanilla client with many runtime-rendered states, so regressions can bypass compilation checks. | Automated smoke coverage covers sign-in, demo, tab navigation, manual activity logging, feed retry, and service-worker registration at mobile and desktop widths. |
| P3 | Consolidate decorative theme and add a restrained “performance mode” | Low | Medium | The illuminated-manuscript theme is a differentiator, but texture, shadows, and typography can compete with activity data. | Decorative textures are reduced at large data densities and on low-power devices; users can select a calmer presentation without losing brand identity. |

## First implementation slice

The first code slice should target the three P0 items with the best impact-to-effort ratio: responsive canvas and navigation, unified tokens and focus states, and resilient async feedback. It should also make the home feed’s activity hierarchy more legible without changing server contracts. These changes improve every screen and are safer to ship than a large map rewrite.

The initial implementation will therefore introduce a responsive desktop layout, a small set of reusable status primitives, stronger keyboard/focus affordances, and an explicit client build version used by the HTML and service worker. It will preserve the existing theme, APIs, data model, and mobile behavior while reducing the most visible prototype-like qualities.

## Comparative scorecard

| Dimension | Functioning Faith | Strava reference | Gap diagnosis |
|---|---|---|---|
| UI/UX polish | Distinctive, warm visual identity with cards, textures, and custom motion, but inconsistent cascade and a constrained desktop shell | Strong visual hierarchy around activity summaries, maps, and feed content [1] [2] | Functioning Faith needs less ornamental competition and more consistent spacing, hierarchy, and state transitions. |
| Technical quality | Strong breadth for a vanilla Node/Express app; versioned shell cache, clean SIGTERM handling, and broad feature coverage | Mature, deeply optimized product surface with explicit mobile and desktop roles | Main risks are runtime complexity, many `innerHTML` render paths, silent error handling, and manual asset-version coordination. |
| Feature completeness | Broad faith + fitness + social feature set; real integrations documented in README | Strong activity tracking, analysis, community, route, challenge, and map ecosystem [1] [3] | Functioning Faith is not missing the concept of features; its next gains are discoverability, reliability, and depth of activity storytelling. |
| User-flow quality | Sign-in, demo, home, workout, stats, explore, and profile flows exist, but first-run demo access and loading feedback need tightening | “Open, tap, go” activity capture and post-activity analysis are clear product anchors [1] | Reduce time-to-first-value and make the primary journey explicit. |
| Mobile experience | Mobile-first shell, safe-area padding, touch targets, GPS bar, and PWA support are present | Mobile is the center of Strava’s animated maps, feed, and recording loop [2] | Preserve the strong mobile foundation while improving readability, active navigation, and motion discipline. |

## References

[1]: https://www.strava.com/ "Strava homepage and product overview"
[2]: https://support.strava.com/en-us/articles/15401546-activity-replay "Strava Activity Replay support article"
[3]: https://support.strava.com/en-us/articles/15401748-map-types "Strava Map Types support article"
[4]: https://medium.com/on-strava/improving-the-activity-feed-on-strava-s-mobile-app-cbb1d4823945 "Improving the Activity Feed on Strava’s Mobile App"
