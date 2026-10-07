# Gloo AI Hackathon — Functioning Faith

## One-line pitch

Functioning Faith is a Christian movement and community app where a real workout
can become a moment for Scripture, reflection, and connection—with AI helping
select context, never inventing the Bible text.

## The 60-second product demo

1. Open Home and show the combined movement, Scripture, and community experience.
2. Start a GPS workout and show the live route and metrics. On iOS, the native
   workout screen uses Core Location; the app also includes an ActivityKit Live
   Activity and WidgetKit extension for an active session.
3. Show how the activity can be reviewed and shared with the member's community.
4. Open the Scripture moment or Bible reader and show the passage reference and
   source text, distinct from any AI-written coaching sentence.
5. Finish on a group, feed, or conversation to show that the product connects
   personal practice to real people—not just a generated response.

The demo should use a known-good account and a route/device setup tested before
recording. Do not imply GPS, health, or wearable data is live unless the demo
device actually supplies it.

## How Gloo and YouVersion are used

The server-side Gloo adapter (`webapp/lib/gloo.js`) can provide contextual
selection and coaching. The YouVersion adapter (`webapp/lib/youversion.js`) can
retrieve canon/version/passage data. Scripture text is resolved from a trusted
source or the verified local public-domain library; a model response is never
treated as Bible text. Requests are server-side so provider secrets are not
exposed in browser code.

Provider calls depend on the corresponding server credentials and provider
availability. Without Gloo credentials, the app falls back to authored verse
lists. Without YouVersion credentials, it can serve local public-domain text;
unavailable references are not synthesized. Check `/api/ai/status` on the live
service to inspect configured provider status and citation-verification counts.

These are technical integrations, not a claim of Gloo or YouVersion sponsorship,
endorsement, or official affiliation. Follow the event's current entry rules and
use of marks when preparing a submission.

## Why it fits “Humans, Agents, and the Future of Flourishing”

- **Human-led:** the member chooses whether to move, reflect, share, or engage an
  AI feature; AI does not replace a pastor, coach, clinician, or community.
- **Grounded:** the model can help with selection and surrounding language, but
  Scripture passages are separately sourced and verified.
- **Whole-person:** the product connects movement, faith practice, and community
  rather than optimizing a single engagement metric.
- **Useful across platforms:** a native iOS client and responsive web app share a
  backend, so the core product story is not limited to a prototype screen.
- **Privacy-aware:** location and health experiences depend on user permission;
  workout visibility is controlled by the member.

## Submission readiness checklist

- [ ] Verify Gloo and YouVersion provider configuration in the target environment;
      keep the demo usable with documented fallbacks.
- [ ] Run the full demo once on the exact account, device, and network intended
      for judging; record a backup demo.
- [ ] Confirm every shown Scripture reference resolves to its displayed source
      text and translation.
- [ ] Confirm GPS, heart-rate, and health metrics are actual device data or label
      them clearly as sample/demo values.
- [ ] Check privacy settings, permissions, and account controls in the submitted
      build.
- [ ] Review current event rules, submission format, attribution, and deadlines
      on the [Gloo AI Hackathon page](https://gloo.com/ai/hackathon).
- [ ] Do not describe the app as App Store ready or TestFlight approved unless the
      current signed build has completed Apple's processing and the required
      device QA is complete.

## Technical entry points

- Product overview and setup: [`../README.md`](../README.md)
- Native iOS build: [`../ios/FunctioningFaith/README.md`](../ios/FunctioningFaith/README.md)
- iOS release/device checklist: [`../ios/FunctioningFaith/APP_STORE_SUBMISSION.md`](../ios/FunctioningFaith/APP_STORE_SUBMISSION.md)
- Gloo adapter: [`../webapp/lib/gloo.js`](../webapp/lib/gloo.js)
- YouVersion adapter: [`../webapp/lib/youversion.js`](../webapp/lib/youversion.js)
