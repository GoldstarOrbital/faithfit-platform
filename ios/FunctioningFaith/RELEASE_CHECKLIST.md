# Functioning Faith iOS — release checklist

Mechanical gate for TestFlight and App Store. Check every box on a **signed
physical device** against the **production** API before upload.

Production API default: `https://faithfit-demo-production.up.railway.app`  
Override (optional): set `FFAPIBaseURL` in `Info.plist` or build setting.

Bundle ID: `com.functioningfaith.app`

---

## 0. Pre-flight (Mac / portal)

- [ ] Apple Developer membership active
- [ ] App ID `com.functioningfaith.app` created
- [ ] Capabilities enabled on App ID: **Sign in with Apple**, **HealthKit**
- [ ] Push Notifications enabled if shipping native APNs (optional for v1)
- [ ] `DEVELOPMENT_TEAM` set in Xcode (or `project.yml`)
- [ ] `xcodegen generate --spec project.yml` succeeds
- [ ] Release scheme builds without errors
- [ ] `APIClient.useMock` is **false** in Release (`#if DEBUG` only)
- [ ] Server env: `APPLE_NATIVE_CLIENT_ID=com.functioningfaith.app` (or matches bundle)
- [ ] Privacy / Terms / Support URLs reachable over HTTPS

---

## 1. Auth

| Flow | Pass |
|---|---|
| Email/password register with DOB + Terms acceptance | [ ] |
| Email/password login | [ ] |
| Session restore after force-quit | [ ] |
| Sign in with Apple (native control) | [ ] |
| Google (if provider enabled) via ASWebAuthenticationSession | [ ] |
| MFA complete path (if account has 2FA) | [ ] |
| Sign out | [ ] |
| New identity-only account hits age/Terms gate | [ ] |

---

## 2. Core product

| Flow | Pass |
|---|---|
| Home feed loads (paginated) | [ ] |
| Open post comments, like, save | [ ] |
| Report post + block user | [ ] |
| Create text post | [ ] |
| Explore groups / challenges | [ ] |
| Scripture browse + random verse + save verse | [ ] |
| Scripture practice start / complete day | [ ] |
| Verse thread open + reflection | [ ] |
| Podcasts list plays | [ ] |
| Church finder with location allow | [ ] |
| Church finder with location **deny** (graceful) | [ ] |

---

## 3. Workouts & Health

| Flow | Pass |
|---|---|
| Start live workout | [ ] |
| GPS points recorded when permission granted | [ ] |
| Stop workout posts to API | [ ] |
| Location permission denied → no crash, clear copy | [ ] |
| HealthKit authorization (workouts, steps, workout HR only) | [ ] |
| Health sync POST `/api/connectors/apple-health/sync` | [ ] |
| No fabricated heart rate | [ ] |

---

## 4. Notifications

| Flow | Pass |
|---|---|
| Permission **not** requested at first launch | [ ] |
| Permission requested only after member enables a category | [ ] |
| Scripture / community / reminder toggles independent | [ ] |
| Deep link opens correct screen (same-origin only) | [ ] |
| Path to iOS Settings from Profile works | [ ] |

---

## 5. Direct messages (E2E)

Complete the full procedure in
[`docs/E2E_DM_VERIFICATION.md`](docs/E2E_DM_VERIFICATION.md).

| Flow | Pass |
|---|---|
| Publish public key on first encrypted send | [ ] |
| Native → Web decrypt | [ ] |
| Web → Native decrypt | [ ] |
| Plaintext fallback when peer has no key | [ ] |
| Keychain scoped per account id | [ ] |

---

## 6. Safety & account

| Flow | Pass |
|---|---|
| Mute / restrict / block from Safety | [ ] |
| Follow requests accept / decline | [ ] |
| Trusted circle add / remove | [ ] |
| Profile edit (display name, tradition, etc.) | [ ] |
| Data export (if exposed in native Profile) | [ ] |
| **Permanent account deletion** via Profile | [ ] |
| After delete, session is invalid | [ ] |

---

## 7. Offline / resilience

| Flow | Pass |
|---|---|
| Airplane mode: app launches without crash | [ ] |
| Failed request shows actionable error | [ ] |
| Biometric lock (if enabled) gates return to app | [ ] |

---

## 8. App Store Connect package

- [ ] Screenshots: 6.7", 6.5", 5.5" (and iPad if supporting)
- [ ] Description + keywords + subtitle
- [ ] Age rating questionnaire completed (expect 12+)
- [ ] Privacy nutrition labels from `privacy.html` / collection map
- [ ] Support URL, Privacy URL, Marketing URL
- [ ] Review notes mention: native GPS workouts, HealthKit read-only,
      Sign in with Apple, E2E DMs, UGC report/block, in-app deletion
- [ ] Archive uploaded; TestFlight internal build installed
- [ ] External TestFlight (optional) before Submit for Review

---

## Sign-off

| Role | Name | Date | Build |
|---|---|---|---|
| Device QA | | | |
| Crypto (E2E DM) | | | |
| Submitter | | | |
