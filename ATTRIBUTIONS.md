# Third-party assets

Everything else in this app's audio/visual layer is original work (the
synthesized chime in `webapp/public/intro-sound.js`, the AI-generated intro
video clips, the hand-coded PNG icon generator) or content ingested through
verified, documented pipelines (news, podcasts, reels — see the header
comments in `webapp/lib/news.js`, `webapp/lib/podcasts.js`,
`webapp/lib/reel-sources.js`). This file is for the one asset that isn't:
something pulled in from outside under a license that requires credit.

## webapp/public/violin-open-string.ogg

- **Title:** Violin open string
- **Author:** Clngre (Wikimedia Commons username `Clngre~commonswiki`)
- **Source:** https://commons.wikimedia.org/wiki/File:Violin_open_string.ogg
- **License:** Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA
  3.0), also available under GFDL 1.2+ at the uploader's choice — this app
  uses the CC BY-SA 3.0 option.
- **Used as:** a ~0.95s trimmed excerpt, played during the app-open intro
  (`webapp/public/app-intro.js`). Trimmed at playback time via the Web Audio
  API's native `start(when, offset, duration)`; the distributed file itself
  is unmodified.
- **Why this file:** verified directly (not assumed) — fetched from Wikimedia
  Commons' own file page, confirmed the exact license text on that page, and
  confirmed the downloaded file's magic bytes are a real Ogg container before
  it was committed.
