import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var session: NativeSession
    @EnvironmentObject private var biometricLock: BiometricLock
    @StateObject private var healthKit = HealthKitManager.shared
    @StateObject private var stravaConnector = StravaConnector()
    @AppStorage("security.biometricLock") private var biometricLockEnabled = false
    @AppStorage("notifications.scripture") private var scriptureNotifications = false
    @AppStorage("notifications.community") private var communityNotifications = false
    @AppStorage("notifications.reminders") private var reminderNotifications = false
    @State private var profile: UserProfile?
    @AppStorage("privacy.biometricIngest") private var biometricConsent = false
    @AppStorage("privacy.scripturePersonalization") private var scripturePersonalization = false
    @State private var privacySettings = PrivacySettings.default
    @State private var privacySaving = false
    @State private var healthKitSyncing = false
    @State private var pendingFollowRequests = 0
    @State private var showEditProfile = false
    @State private var badgeCatalog: [BadgeCatalogEntry] = []
    @State private var connections: [ConnectedAccount] = []
    @State private var stravaConfigured = false
    @State private var isConnectingStrava = false
    @State private var connectorError: String?
    @State private var healthKitError: String?

    var body: some View {
        Form {
            if let profile {
                statsSection(profile)
                badgesSection(profile)
            }
            healthKitSection
            connectorsSection
            privacySection
            safetySection
            signInSecuritySection
            notificationsSection
            remindersSection
            savedPostsSection
            accountSection
        }
        .ffListChrome()
        .navigationTitle("Profile")
        .task {
            if let current = session.profile {
                profile = current
            } else {
                profile = try? await APIClient.shared.fetchProfile()
            }
            pendingFollowRequests = (try? await APIClient.shared.fetchFollowRequests().count) ?? 0
            stravaConfigured = (try? await APIClient.shared.isStravaConfigured()) ?? false
            await loadConnections()
            badgeCatalog = (try? await APIClient.shared.fetchBadgeCatalog()) ?? []
            if let saved = try? await APIClient.shared.fetchPrivacySettings() { privacySettings = saved }
            if let consent = try? await APIClient.shared.fetchConsentStatus() {
                biometricConsent = consent.scopes.contains("biometric_ingest")
                scripturePersonalization = consent.scopes.contains("scripture_personalization")
            }
        }
        .alert("Could not connect Strava", isPresented: Binding(get: { connectorError != nil }, set: { if !$0 { connectorError = nil } })) {
            Button("OK", role: .cancel) { connectorError = nil }
        } message: { Text(connectorError ?? "") }
        .alert("Apple Health needs attention", isPresented: Binding(get: { healthKitError != nil }, set: { if !$0 { healthKitError = nil } })) {
            Button("OK", role: .cancel) { healthKitError = nil }
        } message: { Text(healthKitError ?? "") }
        .confirmationDialog("Delete your Functioning Faith account?", isPresented: $showingDeleteConfirmation, titleVisibility: .visible) {
            Button("Delete permanently", role: .destructive) {
                Task {
                    do { try await session.deleteAccount() }
                    catch { deleteError = error.localizedDescription }
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This removes your profile, posts, workouts, messages, connected tokens, and push subscriptions. This cannot be undone.")
        }
        .alert("Could not delete account", isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })) {
            Button("OK", role: .cancel) { deleteError = nil }
        } message: { Text(deleteError ?? "Please try again.") }
        .sheet(isPresented: $showEditProfile) {
            if let profile {
                EditProfileView(profile: profile) { updated in
                    self.profile = updated
                    session.profile = updated
                }
            }
        }
    }

    // Split out of `body` (rather than inlined, the way the first draft had
    // it) because a single Form{} with this many Sections -- several with
    // conditionals, closures, and bindings of their own -- is exactly the
    // shape that trips SwiftUI's type-checker into "unable to type-check
    // this expression in reasonable time." Confirmed by CI actually failing
    // on the near-identical shape in StoryComposerView.swift with that
    // exact error, not a guess -- this file is larger than that one was.
    @ViewBuilder
    private func statsSection(_ profile: UserProfile) -> some View {
        Section {
            Text("\(profile.displayName)")
            Text("Level \(profile.level) · \(profile.xp) XP")
            if let bio = profile.bio, !bio.isEmpty { Text(bio).font(.caption).foregroundStyle(.secondary) }
            if let job = profile.job, !job.isEmpty { Text(job).font(.caption).foregroundStyle(.secondary) }
            if let church = profile.church, !church.isEmpty { Text(church).font(.caption).foregroundStyle(.secondary) }
            Button("Edit profile") { showEditProfile = true }
        } header: { Text("Stats") }
        .listRowBackground(FFTheme.parchment1)
    }

    @ViewBuilder
    private func badgesSection(_ profile: UserProfile) -> some View {
        Section("Badges") {
            if badgeCatalog.isEmpty {
                ForEach(profile.badges) { badge in
                    Label(badge.name, systemImage: badge.iconURL)
                }
            } else {
                ForEach(badgeCatalog) { badge in
                    badgeRow(badge)
                }
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func badgeRow(_ badge: BadgeCatalogEntry) -> some View {
        HStack {
            Image(systemName: badge.icon ?? "star.fill")
                .foregroundStyle(badge.earned ? FFTheme.goldBright : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(badge.name).foregroundStyle(badge.earned ? .primary : .secondary)
                if !badge.earned, let percent = badge.percent {
                    ProgressView(value: Double(percent), total: 100).tint(FFTheme.hearth)
                }
            }
        }
    }

    @ViewBuilder
    private var healthKitSection: some View {
        Section {
            if !healthKit.isAvailable {
                healthStatusCard(
                    icon: "heart.slash.fill",
                    tint: FFTheme.muted,
                    title: "Apple Health isn't available",
                    detail: "Health data can only be connected on an iPhone or iPad with Apple Health."
                )
            } else if healthKit.authorizationRequested {
                healthStatusCard(
                    icon: "heart.text.square.fill",
                    tint: FFTheme.meadow,
                    title: "Apple Health connected",
                    detail: healthDetail
                )
                Button {
                    Task {
                        healthKitSyncing = true
                        await healthKit.syncRecentWorkouts { payload in
                            try await APIClient.shared.syncAppleHealth(payload)
                        }
                        healthKitSyncing = false
                    }
                } label: {
                    HStack {
                        if healthKitSyncing { ProgressView() }
                        Text(healthKitSyncing ? "Syncing activity…" : "Sync Apple Health now")
                    }
                }
                .buttonStyle(.ffPrimary)
                .disabled(healthKitSyncing)
                if let error = healthKit.lastSyncError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(FFTheme.seal)
                } else if let result = healthKit.lastSyncResult, result.imported == 0 && result.stepDaysSynced == 0 {
                    Label("No new Health activity was found. Check Health sharing if you expected data.", systemImage: "info.circle.fill")
                        .font(.caption)
                        .foregroundStyle(FFTheme.inkSoft)
                }
            } else {
                healthStatusCard(
                    icon: "heart.circle.fill",
                    tint: FFTheme.hearth,
                    title: "Bring your activity together",
                    detail: "Import workouts, steps, and workout heart rate from Apple Health and Apple Watch."
                )
                Button {
                    Task {
                        do {
                            try await healthKit.requestAuthorization()
                            healthKitSyncing = true
                            await healthKit.syncRecentWorkouts { payload in
                                try await APIClient.shared.syncAppleHealth(payload)
                            }
                            healthKitSyncing = false
                        } catch {
                            healthKitError = error.localizedDescription
                        }
                    }
                } label: {
                    HStack {
                        if healthKitSyncing { ProgressView() }
                        Text(healthKitSyncing ? "Connecting Apple Health…" : "Connect Apple Health")
                    }
                }
                .buttonStyle(.ffPrimary)
                .disabled(healthKitSyncing)
            }
        } header: {
            Text("Apple Health & Watch")
        } footer: {
            Text("Reads workouts, step counts, and workout heart rate from Health — from your Apple Watch or any other app that writes into it (Fitbit, Garmin, Oura, and others all sync through Health). Functioning Faith never writes to your Health data.")
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private var healthDetail: String {
        if let result = healthKit.lastSyncResult {
            let workoutText = result.imported == 1 ? "1 workout" : "\(result.imported) workouts"
            let stepText = result.stepDaysSynced == 1 ? "1 day of steps" : "\(result.stepDaysSynced) days of steps"
            return "Last sync imported \(workoutText) and \(stepText)."
        }
        if let lastSyncedAt = healthKit.lastSyncedAt {
            return "Last synced \(lastSyncedAt.formatted(.relative(presentation: .named)))."
        }
        return "Ready to sync your recent activity."
    }

    private func healthStatusCard(icon: String, tint: Color, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: FFTheme.Space.sm) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(FFTheme.cream)
                .frame(width: 42, height: 42)
                .background(tint, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline).foregroundStyle(FFTheme.ink)
                Text(detail).font(.caption).foregroundStyle(FFTheme.inkSoft)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var connectorsSection: some View {
        // Hidden when Strava isn't configured server-side, unless a
        // connection from before that was true still exists to show.
        if stravaConfigured || connections.contains(where: { $0.provider == "strava" }) {
        Section {
            if let strava = connections.first(where: { $0.provider == "strava" }) {
                Text(strava.lastSyncedAt != nil ? "Strava connected · synced" : "Strava connected — not yet synced")
                    .foregroundStyle(.secondary)
                Button {
                    Task { await syncStrava() }
                } label: {
                    if isConnectingStrava { ProgressView() } else { Text("Sync now") }
                }
                .disabled(isConnectingStrava)
            } else {
                Button {
                    Task { await connectStrava() }
                } label: {
                    if isConnectingStrava { ProgressView() } else { Text("Connect Strava") }
                }
                .disabled(isConnectingStrava)
            }
            Link(destination: URL(string: "https://connect.garmin.com/modern/settings/connectedapps")!) {
                Label("Set up Garmin Connect sync", systemImage: "applewatch.radiowaves.left.and.right")
            }
        } header: {
            Text("Garmin & connected accounts")
        } footer: {
            Text("For a Garmin Forerunner: connect Garmin Connect to Strava, then connect Strava here and tap Sync now. Routes, distance, pace, and completed activities import without sharing your Garmin password with Functioning Faith.")
        }
        .listRowBackground(FFTheme.parchment1)
        }
    }

    private func loadConnections() async {
        connections = (try? await APIClient.shared.fetchConnections()) ?? []
    }

    private func connectStrava() async {
        isConnectingStrava = true
        do {
            try await stravaConnector.connect()
            await loadConnections()
        } catch {
            connectorError = error.localizedDescription
        }
        isConnectingStrava = false
    }

    private func syncStrava() async {
        isConnectingStrava = true
        do {
            _ = try await APIClient.shared.syncStrava()
            await loadConnections()
        } catch {
            connectorError = error.localizedDescription
        }
        isConnectingStrava = false
    }

    private var privacySection: some View {
        Section("Privacy") {
            Picker("Profile visibility", selection: $privacySettings.profileVisibility) {
                Text("Everyone").tag("public")
                Text("Followers").tag("followers")
                Text("Only me").tag("private")
            }
            Picker("Who can message me", selection: $privacySettings.messagePermission) {
                Text("Everyone").tag("everyone")
                Text("Followers").tag("followers")
                Text("Nobody").tag("nobody")
            }
            Picker("Who can tag me", selection: $privacySettings.tagPermission) {
                Text("Everyone").tag("everyone")
                Text("Followers").tag("followers")
                Text("Nobody").tag("nobody")
            }
            Picker("Who can comment", selection: $privacySettings.commentPermission) {
                Text("Everyone").tag("everyone")
                Text("Followers").tag("followers")
                Text("Nobody").tag("nobody")
            }
            Toggle("Share biometrics for workout tracking", isOn: $biometricConsent)
                .onChange(of: biometricConsent) { _, enabled in
                    Task { await saveConsent(scope: "biometric_ingest", granted: enabled) }
                    if !enabled { scripturePersonalization = false }
                }
            Toggle("Personalize scripture with my biometrics", isOn: $scripturePersonalization)
                .disabled(!biometricConsent)
                .onChange(of: scripturePersonalization) { _, enabled in
                    Task { await saveConsent(scope: "scripture_personalization", granted: enabled) }
                }
            if privacySaving { ProgressView("Saving privacy…") }
            Text("Biometric readings are used only during an active workout after you opt in. Personalization can be turned off at any time.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .listRowBackground(FFTheme.parchment1)
        .onChange(of: privacySettings.profileVisibility) { _, _ in Task { await savePrivacy() } }
        .onChange(of: privacySettings.messagePermission) { _, _ in Task { await savePrivacy() } }
        .onChange(of: privacySettings.tagPermission) { _, _ in Task { await savePrivacy() } }
        .onChange(of: privacySettings.commentPermission) { _, _ in Task { await savePrivacy() } }
    }

    private func savePrivacy() async {
        privacySaving = true
        defer { privacySaving = false }
        do { privacySettings = try await APIClient.shared.updatePrivacySettings(privacySettings) }
        catch { connectorError = "Privacy settings could not be saved: \(error.localizedDescription)" }
    }

    private func saveConsent(scope: String, granted: Bool) async {
        do { try await APIClient.shared.setConsent(scope: scope, granted: granted) }
        catch {
            if scope == "biometric_ingest" { biometricConsent.toggle() }
            else { scripturePersonalization.toggle() }
            connectorError = "Your privacy choice could not be saved: \(error.localizedDescription)"
        }
    }

    @ViewBuilder
    private var safetySection: some View {
        Section("Safety & community") {
            NavigationLink("Trusted circle") { CircleView() }
            NavigationLink {
                FollowRequestsView()
            } label: {
                HStack {
                    Text("Follow requests")
                    if pendingFollowRequests > 0 {
                        Spacer()
                        Text("\(pendingFollowRequests)").foregroundStyle(.secondary)
                    }
                }
            }
            NavigationLink("Muted, restricted & blocked") { SafetyView() }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private var signInSecuritySection: some View {
        Section("Sign-in security") {
            Toggle("Require Face ID, Touch ID, or device passcode", isOn: $biometricLockEnabled)
                .onChange(of: biometricLockEnabled) { oldValue, enabled in
                    guard enabled && !oldValue else { return }
                    Task {
                        if !(await biometricLock.requestEnable()) { biometricLockEnabled = false }
                    }
                }
            Text("This protects the signed-in app on this device. Account-level two-factor authentication and device sessions are managed by the server.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private var notificationsSection: some View {
        Section {
            notificationToggle(.scripture, isOn: $scriptureNotifications)
            notificationToggle(.community, isOn: $communityNotifications)
            notificationToggle(.reminders, isOn: $reminderNotifications)
            Button("Manage notification permissions") {
                NotificationCoordinator.shared.openSystemSettings()
            }
        } header: {
            Text("Notifications")
        } footer: {
            Text("You choose each category. Functioning Faith does not use notifications to create pressure or shame. You can change access any time in iOS Settings.")
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private var remindersSection: some View {
        Section {
            NavigationLink { RemindersView() } label: {
                Label("Reminders", systemImage: "bell.badge")
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private var savedPostsSection: some View {
        Section {
            NavigationLink { SavedPostsView() } label: {
                Label("Saved posts", systemImage: "bookmark")
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private var accountSection: some View {
        Section("Account") {
            Button("Sign out", role: .destructive) {
                Task { await session.signOut() }
            }
            Button("Delete account", role: .destructive) {
                showingDeleteConfirmation = true
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    @ViewBuilder
    private func notificationToggle(_ category: NotificationCategory, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 3) {
                Text(category.title)
                Text(category.explanation)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .onChange(of: isOn.wrappedValue) { _, enabled in
            Task {
                if enabled {
                    let granted = await NotificationCoordinator.shared.enable(category: category)
                    if !granted { isOn.wrappedValue = false }
                }
                await NotificationCoordinator.shared.syncDeviceToken()
            }
        }
    }

    @State private var showingDeleteConfirmation = false
    @State private var deleteError: String?
}

#Preview { NavigationStack { ProfileView() }.environmentObject(NativeSession()).environmentObject(BiometricLock()) }
