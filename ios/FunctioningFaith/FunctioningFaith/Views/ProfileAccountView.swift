import SwiftUI

/// The Settings destination now owns preferences that previously crowded the
/// public-facing Profile screen. Destructive account actions remain one level
/// deeper so they cannot be tapped accidentally while changing a preference.
struct ProfileAccountView: View {
    var body: some View { ProfileView(content: .settings) }
}

struct AccountManagementView: View {
    @EnvironmentObject private var session: NativeSession
    @State private var showingDeleteConfirmation = false
    @State private var deleteError: String?

    var body: some View {
        Form {
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
        .ffListChrome()
        .navigationTitle("Account management")
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
}

#Preview { NavigationStack { ProfileAccountView() }.environmentObject(NativeSession()).environmentObject(BiometricLock()) }
