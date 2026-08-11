# Functioning Faith developer verification

Developer keys, webhooks, and first-party publishing are denied until every required check is current.

## Applicant checklist

- Accept the current Functioning Faith Terms, Developer Terms, content standard, and accountability policy.
- Link a provider-verified `.edu` identity. An address string alone is not proof.
- Select a church or submit a missing church with its physical address, HTTPS website, and public contact email.
- Describe the project and the concrete community purpose it serves.
- Attest that submitted content is licensed and is not vanity/follower-farming content.
- Complete human review.

## Church verification

A selected OpenStreetMap record is a discovery aid, not authority. A user-submitted church is created with `verification_status=pending`. A reviewer confirms the public contact and representative relationship before setting `verified`. Church administration and content-source mutation must use that verified claim.

## Enforcement and notice

Reports remain allegations until reviewed. Automated systems can prioritize a report but cannot make a legal finding. A reviewer must record the evidence, serious policy or legal basis, action, and prior member notice. Only then may the system queue a limited notice to the church contact. Suspension or revocation also revokes active API keys and disables webhooks. Appeals and corrections must be retained with the case record.

## First-party content migration

Approved developer submissions are marked `source_kind=functioning_faith` and receive a ranking lift. The lift changes ordering but does not create a hard quota, so the feed continues to work while safe first-party supply is small and migrates gradually as approved supply grows.

## Deployment configuration

- `DEVELOPER_REVIEW_TOKEN`: protects review and enforcement endpoints.
- `DATA_ENCRYPTION_KEY`: preferred independent field-encryption key for authenticator seeds, connector tokens, and webhook secrets. `MFA_ENCRYPTION_KEY`, then `SESSION_SECRET`, are compatibility fallbacks.
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`: required before CAPTCHA can be reported as active.
- `RESEND_API_KEY` and a verified `EMAIL_FROM`: required before recovery and accountability email can be reported as active.

The product UI reports provider-dependent controls as unavailable until their complete configuration is present.
