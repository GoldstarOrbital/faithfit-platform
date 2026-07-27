# Hackathon readiness — Scripture in Motion

## One-line pitch

FaithFit turns a real walk, run, ride, or workout into a shared Scripture practice: your body moves through a living world, a verified passage meets the moment, and your community helps you keep going.

## The 60-second demo

1. Open the live app and enter the demo profile.
2. On Home, show **Scripture in Motion**: a real verse, movement prompt, and “Read in Bible” handoff.
3. Tap **Begin the mission** and choose a Bible, Middle-earth, or Narnia route.
4. Show the visible third-person rider, animated world, route progress, and segment race panel.
5. Finish/log the activity, then show the faith-grounded share card, XP, waypoint, and community feed.
6. Open Stats and show the 28-day training log, freshness heuristic, custom goal, and effort zones.

## Why it fits the challenge

- **Gaming:** real-world movement advances an explorable 3D Scripture/story route.
- **Wearables:** Bluetooth heart-rate data changes effort zones and Scripture moments; no sensor data is invented.
- **Social:** people can share a workout, tag confirmed partners, follow one another, join groups, and compete on segments.
- **Bible-first:** text comes from the verified local Scripture library, and coaching copy is clearly separated from the passage.
- **Human flourishing:** metrics point toward consistency, community, reflection, and service—not body comparison.

## Required submission integrations

The product is ready for the YouVersion Platform and Gloo AI Studio once event credentials are available. The live app currently uses a verified KJV/WEB fallback and must not claim official YouVersion or Gloo affiliation until those credentials and approvals are configured.

Before submission, add official event credentials through Railway variables and wire them behind server-side adapters. Never put API keys in browser JavaScript. Keep the fallback path so a demo remains usable if an external service is temporarily unavailable.

Suggested variables:

```text
YOUVERSION_API_BASE_URL=<official value from the developer dashboard>
YOUVERSION_API_KEY=<server-side credential>
GLOO_AI_BASE_URL=<official value from Gloo AI Studio>
GLOO_AI_API_KEY=<server-side credential>
```

## Judge-proofing checklist

- Demo account works without OAuth or device hardware.
- A 3–4 minute recording shows the complete loop, including the faith moment.
- Every Scripture passage is attributed and traceable to its source/version.
- AI is used for contextual coaching only; it cannot fabricate, paraphrase as Scripture, or provide medical diagnoses.
- Privacy defaults stay conservative: workout visibility is private unless the user chooses otherwise, and biometric consent is explicit.
- The README, live URL, GitHub branch, and video use the same product name and one-line story.
