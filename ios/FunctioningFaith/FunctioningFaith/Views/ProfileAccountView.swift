import SwiftUI

/// Sign out and account deletion, split out of ProfileView's old single
/// giant Form into their own peer tab (see AppShell.swift's Profile bottom
/// bar) -- the same two actions, unchanged, just no longer buried at the
/// bottom of a settings page with a dozen unrelated sections above them.
struct ProfileAccountView: View {
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
        .navigationTitle("Account")
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

#Preview { NavigationStack { ProfileAccountView() }.environmentObject(NativeSession()) }
