# Domain Event Topics (Kafka)

| Topic               | Producer            | Consumers                          | Payload shape                                   |
|----------------------|---------------------|-------------------------------------|--------------------------------------------------|
| workout.started      | fitness service      | gamification, notification, scripture-engine | { user_id, workout_id, type, start_time } |
| workout.completed    | fitness service      | gamification, notification, personalization  | { user_id, workout_id, calories, avg_hr, max_hr } |
| biometric.spike      | wearable-ingest      | scripture-engine, notification      | { user_id, time, heart_rate, hrv, stress_level, kind } |
| verse.triggered      | scripture-engine     | notification, personalization       | { user_id, verse_id, youversion_id, trigger_type, timestamp } |
| quest.progress       | gamification         | notification                        | { user_id, quest_id, progress, completed } |
| badge.awarded        | gamification         | notification                        | { user_id, badge_id, earned_at } |

Naming convention: `<domain>.<past_tense_event>`. All events carry `{ event_id, occurred_at, ...payload }`.
