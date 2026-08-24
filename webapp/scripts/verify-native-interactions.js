#!/usr/bin/env node
'use strict';

// A lightweight release gate for the native tab actions. It deliberately checks
// the server route and the Swift caller together, so a renamed API cannot leave
// a visible native control timing out against a missing endpoint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const api = read('routes', 'api.js');
const client = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Networking', 'APIClient.swift');
const sensors = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Networking', 'BluetoothHeartRateManager.swift');
const workout = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'WorkoutView.swift');
const exploreCatalog = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'ExploreCatalog.swift');
const dmInbox = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'DMInboxView.swift');
const profileEditor = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'EditProfileView.swift');
const reels = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'ReelsFeedView.swift');
const project = read('..', 'ios', 'FunctioningFaith', 'project.yml');
const profile = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'ProfileView.swift');
const rootTabs = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'RootTabView.swift');
const journeys = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'JourneysListView.swift');
const journeyVisual = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'JourneyWorldVisual.swift');
const liveActivity = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Networking', 'WorkoutLiveActivityManager.swift');
const tracker = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Networking', 'NativeWorkoutTracker.swift');
const appInfo = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Resources', 'Info.plist');
const widgetProject = read('..', 'ios', 'FunctioningFaith', 'project.yml');
const postComposer = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'PostComposerView.swift');
const reelComposer = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'ReelComposerView.swift');
const reelClient = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Networking', 'APIClient+MemberReels.swift');
const notifications = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Networking', 'NotificationCoordinator.swift');
const media = read('lib', 'media.js');

assert.match(client, /request\.timeoutInterval = timeoutInterval/, 'native requests need an explicit finite deadline');
for (const route of ['/feed', '/explore', '/dms', '/notifications', '/journeys', '/groups/nearby', '/workouts/start', '/workouts/:id/stop']) {
  assert.match(api, new RegExp(`router\\.(?:get|post|put|patch|delete)\\('${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `missing server route ${route}`);
}
assert.match(sensors, /CBUUID\(string: "1816"\)/, 'cycling cadence service must be supported');
assert.match(sensors, /CBUUID\(string: "1818"\)/, 'cycling power service must be supported');
assert.match(sensors, /CBUUID\(string: "1826"\)/, 'fitness machine service must be supported');
assert.match(sensors, /parseCyclingSpeedCadence/, 'cadence data must be decoded');
assert.match(sensors, /parseCyclingPower/, 'power data must be decoded');
assert.match(workout, /"cadence_rpm"/, 'workout completion must retain cadence');
assert.match(workout, /"peak_power_w"/, 'workout completion must retain peak power');
assert.match(api, /'cadence_rpm', 'power_w', 'peak_power_w'/, 'server must validate sensor metrics');
for (const property of ['name', 'username', 'description', 'sport', 'locationName', 'isPrivate', 'useCurrentLocation', 'isSaving']) {
  assert.match(exploreCatalog, new RegExp(`@State private var ${property}\\b`), `group creation state must expose a SwiftUI binding for ${property}`);
}
assert.match(dmInbox, /struct NewConversationDestination: Identifiable, Hashable/, 'message compose destinations must satisfy navigationDestination item requirements');
assert.match(profileEditor, /PhotosPicker\(selection: \$avatarPickerItem, matching: \.images\)/, 'members must be able to choose a profile photo');
assert.match(profileEditor, /avatarData: avatarData\.map\(ImageUpload\.dataURL\(from:\)\)/, 'profile photo must be sent through the validated profile update API');
assert.match(client, /fetchAvatarData\(userID: UUID\).*refresh=/s, 'avatar reads must bypass stale image cache after an update');
assert.match(reelClient, /timeoutInterval: 90/, 'member Reel uploads need a mobile-safe request deadline');
const memberProfile = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'MemberProfileView.swift');
assert.match(memberProfile, /fetchAvatarData\(userID: userID\)/, 'member profiles must load the stored avatar');
assert.match(memberProfile, /Label\("Message", systemImage: "paperplane\.fill"\)/, 'member profiles must open a direct-message action');
assert.match(memberProfile, /momentsSection\(profile\.posts\)/, 'member profiles must show the API-approved public post grid');
assert.match(reels, /ScrollView\s*\{\s*LazyVStack/s, 'Reels must have a dedicated vertical scrolling feed');
assert.match(project, /CODE_SIGN_ENTITLEMENTS: FunctioningFaith\/Resources\/FunctioningFaith\.entitlements/, 'HealthKit entitlement must be attached to generated release projects');
assert.match(api, /router\.get\('\/consent', requireAuth/, 'native app must be able to restore opt-in consent choices');
assert.match(client, /func fetchPrivacySettings\(\)/, 'native app must load persisted privacy controls');
assert.match(client, /func setConsent\(scope: String, granted: Bool\)/, 'native app must persist biometric consent');
assert.match(profile, /await APIClient\.shared\.fetchPrivacySettings\(\)/, 'profile must restore saved privacy choices');
assert.match(workout, /guard biometricIngestEnabled, heartRate > 0, let workoutID/, 'biometric uploads must remain explicit opt-in');
assert.match(workout, /Date\(\)\.timeIntervalSince\(lastBiometricUpload\) >= 60/, 'biometric uploads must be rate limited');
assert.match(rootTabs, /@State private var exploreRootID = UUID\(\)/, 'Explore needs a resettable root identity');
assert.match(rootTabs, /\.id\(exploreRootID\)/, 'Explore must rebuild when returning from a detail');
assert.match(rootTabs, /if tab == \.explore \{ resetExplore\(\) \}/, 'entering Explore must clear retained detail navigation');
assert.match(journeys, /JourneyRouteCard\(journey: journey\)/, 'Journeys need direct, rich route cards instead of inert rows');
assert.match(journeyVisual, /figure\.run\.circle\.fill/, 'Journey map needs a member position marker');
assert.match(liveActivity, /Activity<WorkoutLiveActivityAttributes>/, 'active workouts need a real ActivityKit Live Activity');
assert.match(workout, /WorkoutLiveActivityManager\.shared\.start/, 'starting a workout must begin its Live Activity');
assert.match(workout, /WorkoutLiveActivityManager\.shared\.end/, 'stopping a workout must dismiss its Live Activity');
assert.match(tracker, /allowsBackgroundLocationUpdates = true/, 'live workouts must keep collecting location in the background');
assert.match(appInfo, /NSSupportsLiveActivities/, 'the app must declare Live Activity support');
assert.match(appInfo, /UIBackgroundModes/, 'the app must declare its background location mode');
assert.match(widgetProject, /FunctioningFaithWidgets:/, 'the generated project must include the Widget extension');
assert.match(client, /func fetchAvatarData\(userID: UUID\)/, 'profile needs a privacy-scoped avatar fetch');
assert.match(profile, /fetchAvatarData\(userID: userID\)/, 'Profile must render the member’s stored avatar');
assert.match(postComposer, /!content\.trimmingCharacters\(in: \.whitespacesAndNewlines\)\.isEmpty \|\| uploadData != nil/, 'photo-only posts must be publishable');
assert.match(reelComposer, /Choose an MP4 or MOV/, 'iPhone MOV files must be accepted by the Reel picker');
assert.match(reelComposer, /let mime = "video\/mp4"/, 'accepted camera videos must be exported to an iOS/web-playable MP4');
assert.match(media, /const MAX_VIDEO_BYTES = 10 \* 1024 \* 1024/, 'the server must accommodate a short iPhone MOV');
assert.match(reelComposer, /private static let maxBytes = 10 \* 1024 \* 1024/, 'the native reel picker must match the server upload cap');
assert.match(reelComposer, /private func compressedVideoURL\(from sourceURL: URL\) async throws -> URL/, 'native Reel uploads must run through a client-side compression export');
assert.match(reelComposer, /AVAssetExportPresetMediumQuality/, 'native Reel compression must use a practical mobile export preset');
assert.match(reelComposer, /exportAsynchronously/, 'video compression must not block the SwiftUI interaction thread');
assert.match(reelComposer, /uploadURL = try await compressedVideoURL\(from: url\)/, 'the uploaded Reel payload must come from the compressed output, not the camera original');
assert.match(workout, /struct PostWorkoutSummaryView/, 'stopping a workout must show a complete session recap');
assert.match(workout, /Apple Health insight/, 'the recap must explain the actual available Apple Health data');
assert.match(profile, /Heart-rate calm cue/, 'members need an explicit calm-cue preference');
assert.match(workout, /Date\(\)\.timeIntervalSince\(lastHeartRateCalmCue\) >= 5 \* 60/, 'heart-rate calm cues must be rate limited');
assert.match(notifications, /deliverHeartRateCalmCue/, 'the calm cue must reach the local-notification coordinator');

console.log(JSON.stringify({ native_action_contracts: true, timeout_boundary_seconds: 20, bluetooth_profiles: ['heart_rate', 'cycling_speed_cadence', 'cycling_power', 'fitness_machine'] }));
