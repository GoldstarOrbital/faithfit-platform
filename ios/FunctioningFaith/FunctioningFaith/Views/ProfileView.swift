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
    @State private var biometricConsent = false
    @State private var scripturePersonalization = false
    @State private var healthKitSyncing = false
    @State private var pendingFollowRequests = 0
    @State private var showEditProfile = false
    @State private var connections: [ConnectedAccount] = []
    @State private var stravaConfigured = false
    @State private var isConnectingStrava = false
    @State private var connectorError: String?

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
            accountSection
        }
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
        }
        .alert("Could not connect Strava", isPresented: Binding(get: { connectorError != nil }, set: { if !$0 { connectorError = nil } })) {
            Button("OK", role: .cancel) { connectorError = nil }
        } message: { Text(connectorError ?? "") }
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
    }

    @ViewBuilder
    private func badgesSection(_ profile: UserProfile) -> some View {
        Section("Badges") {
            ForEach(profile.badges) { badge in
                Label(badge.name, systemImage: badge.iconURL)
            }
        }
    }

    @ViewBuilder
    private var healthKitSection: some View {
        Section {
            if !healthKit.isAvailable {
                Text("Health data isn't available on this device.")
                    .foregroundStyle(.secondary)
            } else if healthKit.authorizationRequested {
                if let lastSyncedAt = healthKit.lastSyncedAt {
                    Text("Last synced \(lastSyncedAt.formatted(.relative(presentation: .named)))")
                        .foregroundStyle(.secondary)
                } else {
                    Text("Connected — not yet synced")
                        .foregroundStyle(.secondary)
                }
                Button {
                    Task {
                        healthKitSyncing = true
                        await healthKit.syncRecentWorkouts { payload in
                            try await APIClient.shared.syncAppleHealth(payload)
                        }
                        healthKitSyncing = false
                    }
                } label: {
                    if healthKitSyncing { ProgressView() } else { Text("Sync now") }
                }
                .disabled(healthKitSyncing)
                if let error = healthKit.lastSyncError {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
            } else {
                Button("Connect Apple Health") {
                    Task {
                        do { try await healthKit.requestAuthorization() }
                        catch { /* surfaced via lastSyncError on next sync attempt */ }
                    }
                }
            }
        } header: {
            Text("Apple Health & Watch")
        } footer: {
            Text("Reads workouts, step counts, and workout heart rate from Health — from your Apple Watch or any other app that writes into it (Fitbit, Garmin, Oura, and others all sync through Health). Functioning Faith never writes to your Health data.")
        }
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
        } header: {
            Text("Connected Accounts")
        } footer: {
            Text("Strava aggregates activity from most GPS watches and wearables (Garmin, Coros, Wahoo, and others), so connecting it brings that data in too.")
        }
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
            Toggle("Share biometrics for workout tracking", isOn: $biometricConsent)
            Toggle("Personalize scripture with my biometrics", isOn: $scripturePersonalization)
                .disabled(!biometricConsent)
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
    }

    private var remindersSection: some View {
        Section {
            NavigationLink { RemindersView() } label: {
                Label("Reminders", systemImage: "bell.badge")
            }
        }
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
            guard enabled else { return }
            Task {
                let granted = await NotificationCoordinator.shared.enable(category: category)
                if !granted { isOn.wrappedValue = false }
            }
        }
    }

    @State private var showingDeleteConfirmation = false
    @State private var deleteError: String?
}

#Preview { NavigationStack { ProfileView() }.environmentObject(NativeSession()).environmentObject(BiometricLock()) }
