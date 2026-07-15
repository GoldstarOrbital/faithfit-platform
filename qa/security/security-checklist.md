# Security Test Checklist

- [ ] Auth: password hashing (argon2/bcrypt), JWT expiry + rotation, rate-limited login attempts
- [ ] Biometric data encrypted at rest (TimescaleDB tablespace/KMS) and in transit (TLS everywhere)
- [ ] All third-party adapters (YouVersion/Gloo/wearables) load keys from vault, never env files in prod
- [ ] Feature flags default OFF verified in CI (assert config/feature-flags.json has no `true` values before prod deploy job)
- [ ] Consent required before biometric ingest and before scripture personalization (unit + integration tested)
- [ ] Audit log entries written for: profile access by non-owner (admin tooling), data export, consent changes
- [ ] Dependency scanning (npm audit / Snyk) in CI on every PR
- [ ] Kafka topics ACL'd per-service (producers/consumers scoped to only the topics they own)
- [ ] Gloo Gateway: authN/authZ policy on every route, no unauthenticated write endpoints
- [ ] Penetration test / OWASP ASVS pass before GA, focused on auth service and wearable-ingest (biggest PII surface)
- [ ] GDPR/CCPA: data deletion request flow removes/anonymizes biometric_data, scripture_triggers, posts within SLA
