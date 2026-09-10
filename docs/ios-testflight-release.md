# Functioning Faith iOS release workflow

Use this checklist for every change that is intended to reach both production
services and internal TestFlight testers. It deliberately keeps signing assets
out of Git.

## 1. Start from the shared branch

```sh
git status --short
git fetch origin
git switch main
git pull --ff-only origin main
```

Do not overwrite unrelated working-tree changes. Keep certificates, `.cer`,
`.p12`, provisioning profiles, API keys, and Xcode archives out of commits.

## 2. Validate the change before committing

```sh
git diff --check
node --check webapp/routes/api.js
cd ios/FunctioningFaith
xcodegen generate --spec project.yml
xcodebuild -project FunctioningFaith.xcodeproj \
  -scheme FunctioningFaith \
  -configuration Debug \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
```

Run the affected user flow in the simulator as well: Apple Sign In (including
the cancellation path), Health permission state, Home search, Bible Answers,
Explain This Verse, workout pause/resume/finish, and an offline workout.

## 3. Commit and deploy the backend first

Increment `CURRENT_PROJECT_VERSION` in `ios/FunctioningFaith/project.yml` for
every TestFlight archive. Use a value greater than the last uploaded build
(for example, a UTC timestamp). Stage only source, tests, documentation, and
the regenerated project if it is intentionally tracked.

```sh
git add <reviewed-files>
git commit -m "Describe the release change"
git push origin main
```

The repository deploys the `webapp/` service from `main`; wait for that GitHub
deployment to complete and exercise a production API request before uploading
an iOS binary that depends on its new behavior.

## 4. Archive and upload the iOS binary

In Xcode, verify both `FunctioningFaith` and `FunctioningFaithWidgets` use
team `P3999S6HG4` with automatic signing. Select **Any iOS Device (arm64)**,
then use **Product → Archive**. In Organizer choose **Distribute App → App
Store Connect → Upload**.

Before upload, ensure the archive's `CFBundleVersion` is the intended new
build number. Never install another Mac's distribution certificate: create a
CSR in Keychain Access and use its corresponding Apple Distribution
certificate and App Store provisioning profile on this Mac.

## 5. Verify TestFlight, not merely App Store Connect

In App Store Connect → Functioning Faith → TestFlight, locate the exact build
number. It is not available to testers until its status is **Ready to Test**.
Confirm the internal tester group contains the intended tester, then install
that exact number and smoke-test the changed flows. Record the build number,
processing status, deployment revision, and any exact Apple/Xcode error in the
release handoff.
