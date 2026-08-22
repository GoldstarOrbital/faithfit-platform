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

assert.match(client, /request\.timeoutInterval = 20/, 'native taps need a finite network deadline');
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
assert.match(reels, /ScrollView\s*\{\s*LazyVStack/s, 'Reels must have a dedicated vertical scrolling feed');
assert.match(project, /CODE_SIGN_ENTITLEMENTS: FunctioningFaith\/Resources\/FunctioningFaith\.entitlements/, 'HealthKit entitlement must be attached to generated release projects');
assert.match(api, /router\.get\('\/consent', requireAuth/, 'native app must be able to restore opt-in consent choices');
assert.match(client, /func fetchPrivacySettings\(\)/, 'native app must load persisted privacy controls');
assert.match(client, /func setConsent\(scope: String, granted: Bool\)/, 'native app must persist biometric consent');
assert.match(profile, /await APIClient\.shared\.fetchPrivacySettings\(\)/, 'profile must restore saved privacy choices');
assert.match(workout, /guard biometricIngestEnabled, heartRate > 0, let workoutID/, 'biometric uploads must remain explicit opt-in');
assert.match(workout, /Date\(\)\.timeIntervalSince\(lastBiometricUpload\) >= 60/, 'biometric uploads must be rate limited');
assert.match(rootTabs, /NavigationStack\(path: \$explorePath\)/, 'Explore needs an owned path that can return to its dashboard');
assert.match(rootTabs, /if tab == \.explore \{ explorePath = NavigationPath\(\) \}/, 'reselecting Explore must clear stale destinations');
assert.match(journeys, /JourneyRouteCard\(journey: journey\)/, 'Journeys need direct, rich route cards instead of inert rows');
assert.match(journeyVisual, /figure\.run\.circle\.fill/, 'Journey map needs a member position marker');

console.log(JSON.stringify({ native_action_contracts: true, timeout_boundary_seconds: 20, bluetooth_profiles: ['heart_rate', 'cycling_speed_cadence', 'cycling_power', 'fitness_machine'] }));
