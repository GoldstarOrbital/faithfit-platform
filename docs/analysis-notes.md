# Comparative Analysis Notes

## Live Functioning Faith deployment

- URL: https://faithfit-demo-production.up.railway.app/
- Page title: Functioning Faith.
- Public entry screen is a narrow, centered mobile-style canvas on desktop with a dark wood top bar, search icon, sign-in form, and bottom browser safe-area-like bar.
- Primary copy: “Welcome back,” “Sign in to continue your journey,” Google OAuth, email/password sign-in, “Explore a demo profile,” legal links, and launch-notification capture.
- A first-visit audio welcome and easter-egg overlay appeared on the public landing screen; after dismissal, the sign-in view remained visually sparse and the demo-profile control did not visibly navigate when clicked in the browser session.
- Visible UI concern: desktop viewport is mostly empty cream canvas around a narrow app shell, so the experience reads as a mobile preview rather than a responsive desktop product.

## Repository verification

- Confirmed source repository: GoldstarOrbital/faithfit-platform.
- Current branch: main. Latest commit at inspection: 44caf5d, “Exclude the admin's own traffic from visitor/activity metrics”.
- App is a single Node.js/Express process with vanilla HTML/CSS/JS, no frontend build step, Leaflet for maps, and a service worker for versioned shell assets.
- Primary client files: webapp/public/index.html, app.js, styles.css, visual-polish.js, journey-live.js, sensors.js, journey3d.js, service worker sw.js.
- README describes GPS tracking, BLE heart-rate pairing, manual activity logging, analytics, challenges, social feed, maps, Strava sync, Bible search, devotionals, church discovery, chat, meetups, PWA support, and Railway deployment by pushing main.

## Strava reference findings

- Strava positions its core loop as open/tap/go recording followed by detailed activity maps and performance data, combined with a community feed and discovery tools [1].
- Current Strava Activity Replay provides animated activity maps in the mobile feed, with top achievements highlighted; static maps remain as a loading fallback [2].
- Current Strava map types include gradient-driven data visualization for pace/speed, heart rate, elevation, gradient, surface, power, time, and temperature; maps appear in feeds, profiles, and activity detail [3].
- A Strava feed UX case study emphasizes that mobile feed metrics must be explicit and that floating date/activity headers need strong visual hierarchy to avoid ambiguity [4].

## Initial comparative diagnosis

Functioning Faith is feature-rich and thoughtfully instrumented, but its visible polish is inconsistent with Strava’s focus on glanceable activity storytelling. The main likely gaps are shell sizing and responsive behavior, typography hierarchy, a more disciplined spacing system, clearer state transitions and loading/failure affordances, stronger feed/activity card hierarchy, richer map/data visualization defaults, and a more legible mobile navigation treatment.

## References

[1]: https://www.strava.com/ "Strava homepage and product overview"
[2]: https://support.strava.com/en-us/articles/15401546-activity-replay "Strava Activity Replay support article"
[3]: https://support.strava.com/en-us/articles/15401748-map-types "Strava Map Types support article"
[4]: https://medium.com/on-strava/improving-the-activity-feed-on-strava-s-mobile-app-cbb1d4823945 "Improving the Activity Feed on Strava’s Mobile App"
