import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var session: NativeSession
    @EnvironmentObject private var biometricLock: BiometricLock
    @AppStorage("security.biometricLock") private var biometricLockEnabled = false
    @AppStorage("notifications.scripture") private var scriptureNotifications = false
    @AppStorage("notifications.community") private var communityNotifications = false
    @AppStorage("notifications.reminders") private var reminderNotifications = false
    @State private var profile: UserProfile?
    @State private var biometricConsent = false
    @State private var scripturePersonalization = false

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
            Section("Connected Devices") {
                Text("Apple Watch (HealthKit)")
                Text("Add device…")
            }
            Section("Privacy") {
                Toggle("Share biometrics for workout tracking", isOn: $biometricConsent)
                Toggle("Personalize scripture with my biometrics", isOn: $scripturePersonalization)
                    .disabled(!biometricConsent)
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
        .task { profile = session.profile ?? (try? await APIClient.shared.fetchProfile()) }
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
