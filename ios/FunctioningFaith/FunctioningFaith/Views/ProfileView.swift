import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var session: NativeSession
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

    @State private var showingDeleteConfirmation = false
    @State private var deleteError: String?
}

#Preview { NavigationStack { ProfileView() }.environmentObject(NativeSession()) }
