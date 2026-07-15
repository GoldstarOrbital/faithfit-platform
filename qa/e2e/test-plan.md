# End-to-End Test Plan

## Core flows
1. **Signup -> profile -> device connect**: register user, set profile, link a wearable (mock),
   verify `wearable_devices` row + consent record created.
2. **Wearable ingest -> biometric spike -> scripture trigger -> notification**:
   POST biometric batch to wearable-ingest -> assert row in `biometric_data` hypertable ->
   assert `biometric.spike` event on Kafka -> assert scripture-engine consumes it, logs
   `scripture_triggers` row, emits `verse.triggered` -> assert notification-service composes
   and "sends" (mock APNs) a push.
3. **Workout lifecycle**: start workout -> `workout.started` event -> stop workout ->
   `workout.completed` event -> gamification awards XP/quest progress/badges ->
   notification-service delivers quest/badge pushes.
4. **Social**: create post referencing a workout + verse, follow another user, confirm
   feed ordering and swipe actions (like/share) via UI test.
5. **Groups (Gloo sync)**: with `gloo.read` enabled against mock server, sync group members
   into `group_members`.
6. **Privacy opt-out**: revoke `scripture_personalization` consent, confirm scripture-engine
   falls back to non-personalized scoring immediately (no cached personalization applied).

## Environments
- Local: docker-compose (Postgres+Timescale, Kafka, Redis, all services, YouVersion/Gloo mocks).
- Staging: real YouVersion/Gloo sandbox creds behind feature flags, synthetic wearable data.

## Exit criteria
All flows above pass with feature flags at both OFF (fallback paths) and ON (mock-backed) states.
