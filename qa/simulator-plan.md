# Simulator test plan

Written for a fixed budget of roughly 100 Codemagic simulator minutes. Ordered
by risk, so if the budget runs out partway the untested remainder is the part
that mattered least.

Everything below is code that has shipped to `main` and passed CI without any
of it being seen running. CI proves it compiles. It does not prove it works.

**Report per item**: pass, fail, or blocked, with a screenshot for anything
visual and the exact step that failed. "Looks fine" is not a result — say what
you did and what happened.

---

## Tier 1 — user-reported, still unconfirmed (budget ~30 min)

These are things a member has already said are broken. Everything else is a
prediction; these are observations.

### 1. Search field renders and accepts input
Reported broken repeatedly. The server is not the problem: signed-in search
returns people, scripture, podcasts, journeys, groups, challenges and videos
for real queries, and the iOS decode model matches the response exactly. So the
fault is the field itself.

The fix removed `.searchable()` from inside a conditional (a modifier nested in
an `if` branch never registers with the navigation bar). Never verified.

1. Open the Search tab. **Is there a search field at all?** This is the whole
   question — earlier it did not render, not merely fail to accept input.
2. Tap it, type `jo`, wait. Results should group into sections.
3. Switch to another tab and back. Field still there? Still typable?
4. If it still does not appear, capture the view hierarchy (Debug → Capture
   View Hierarchy) — that is the thing no amount of code reading has settled.

### 2. Home opens on content, not a spinner
New feed cache. Two cases, and the second is the one I designed against and
could not test.

1. Cold launch with an account that has already loaded a feed. Home should
   paint posts on the **first frame** — no spinner, no flash of empty state.
2. **Compose a post, publish it, and watch the feed reload.** The new post must
   appear. If the cached copy replaces it and the member's own post vanishes,
   that is the failure this design exists to avoid, and it is worse than the
   spinner was. Report immediately if so.
3. Sign out, sign in as a different account. The first account's posts must
   never appear.

### 3. Reels open time, and the picker's new position
Reels used to make a YouTube API call and an HTTP scrape of the member's church
website inline on every open. Now cached and refreshed in the background.

1. Time from tapping Reels to first video. Compare against TestFlight build
   1788676008 if it is still installable.
2. The All Reels / Functioning Faith Originals picker now sits in its **own
   strip above the video** rather than floating over it. Check it does not
   crowd the notch or the status bar — that safe-area collision is exactly what
   the old overlay was avoiding, so it is the likely failure.
3. Switch to Originals with none present: is there still a way back?

---

## Tier 2 — shipped blind, high blast radius (budget ~40 min)

### 4. Toolbar buttons across sections
All nine sections stay mounted at once, and UIKit-bridged toolbars from hidden
sections were competing with the visible one, leaving buttons silently dead.
Fixed twice — once for section roots, once for pushed screens — and neither fix
has been tapped.

Tap each, from a cold launch, then again after visiting several other tabs:
- Home: compose (pencil) and notifications (bell)
- Reels: create (+)
- Messages: new message (pencil)
- Scripture: open a verse thread, then its share button

The failure mode is silence — the button looks right and does nothing.

### 5. Navigation state does not leak between sections
1. Scripture → open a verse thread. Switch to Messages. Return to Scripture:
   you should be at the root list, not still inside the thread.
2. Home → open Notifications → tap a notification that routes to another tab
   (a DM or a workout kudos). It should switch tabs and open the destination.
   Then return to Home: you should be at the feed, not still on Notifications.

### 6. Offline Scripture
The whole Bible (31,202 verses, ~1.2MB) downloads once in the background.

1. Fresh install, sign in, leave the app open a minute on wifi.
2. **Enable airplane mode.**
3. Open Scripture and read a chapter you have never opened — Romans 8 is a good
   pick, deliberately not one of the obvious ones. It should read.
4. Check Acts 8. Verse 37 does not exist in this translation; verses 36 and 38
   must both render and the numbering must not shift. This is the case that
   nearly shipped broken.
5. Still offline, confirm the feed degrades honestly rather than hanging.

### 7. Workouts and verse conversations reach the feed
1. Start a workout, let it run past a minute, stop it. A post should appear in
   Home carrying the workout and a verse matched to the activity.
2. Confirm a workout stopped under a minute with no distance posts nothing.
3. Open a verse, write the first reflection on it. It should appear in Home.
   Write a second reflection: **no** second post.

---

## Tier 3 — safety and correctness (budget ~30 min)

### 8. Blocking, end to end
Server side is now test-covered; the member-facing flow never has been.

With two accounts, A blocks B from B's profile, then verify from **both** sides:
- B cannot follow A. B does not appear in A's followers, and A does not appear
  in B's.
- Any pending follow request between them is gone.
- B's posts and verse reflections do not appear to A.
- Neither can open or send a DM to the other.
- B liking or replying to A's verse reflection produces no notification to A.

### 9. Deep links
Each should open the specific destination, not merely the tab. Test cold (app
not running) and warm:
`functioningfaith://dm/<id>`, `.../post/<id>`, `.../workout/<id>`,
`.../group/<id>`, `.../athlete/<id>`, `.../verse?ref=John 3:16`

### 10. DM compose bar
Open a conversation and confirm the text field is visible and not hidden behind
the bottom bar. Type and send.

---

## Not in this plan

Device-only hardware — HealthKit consent, real outdoor GPS, background workout
recovery, Live Activity, Bluetooth sensors, heart-rate thresholds. A simulator
cannot certify any of these. They need a physical iPhone and are the reason
TestFlight on a real device still matters regardless of how this plan goes.
