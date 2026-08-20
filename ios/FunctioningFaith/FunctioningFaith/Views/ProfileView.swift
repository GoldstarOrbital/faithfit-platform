import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var session: NativeSession
    @EnvironmentObject private var biometricLock: BiometricLock
    @StateObject private var healthKit = HealthKitManager.shared
    @AppStorage("security.biometricLock") private var biometricLockEnabled = false
    @AppStorage("notifications.scripture") private var scriptureNotifications = false
    @AppStorage("notifications.community") private var communityNotifications = false
    @AppStorage("notifications.reminders") private var reminderNotifications = false
    @State private var profile: UserProfile?
    @State private var biometricConsent = false
    @State private var scripturePersonalization = false
    @State private var healthKitSyncing = false
    @State private var pendingFollowRequests = 0

    var body: some View {
        Form {
            if let profile {
                Section("Stats") {
                    Text("\(profile.displayName)")
                    Text("Level \(profile.level) · \(profile.xp) XP")
                }
                Section("Badges") {
                    ForEach(profile.badges) { badge in
                        Label(badge.name, systemImage: badge.iconURL)
                    }
                }
            }
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
            Section("Privacy") {
                Toggle("Share biometrics for workout tracking", isOn: $biometricConsent)
                Toggle("Personalize scripture with my biometrics", isOn: $scripturePersonalization)
                    .disabled(!biometricConsent)
            }
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
            Section("Account") {
                Button("Sign out", role: .destructive) {
                    Task { await session.signOut() }
                }
                Button("Delete account", role: .destructive) {
                    showingDeleteConfirmation = true
                }
            }
        }
        .navigationTitle("Profile")
        .task {
            if let current = session.profile {
                profile = current
            } else {
                profile = try? await APIClient.shared.fetchProfile()
            }
            pendingFollowRequests = (try? await APIClient.shared.fetchFollowRequests().count) ?? 0
        }
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
