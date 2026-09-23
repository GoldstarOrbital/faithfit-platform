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
            Section("Sign-in") {
                NavigationLink {
                    ChangePasswordView()
                } label: {
                    Label("Change password", systemImage: "key.fill")
                }
            }
            .listRowBackground(FFTheme.parchment1)
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

private struct ChangePasswordView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmation = ""
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var saved = false
    @State private var showingRecovery = false

    var body: some View {
        Form {
            Section {
                SecureField("Current password", text: $currentPassword)
                    .textContentType(.password)
                SecureField("New password", text: $newPassword)
                    .textContentType(.newPassword)
                SecureField("Confirm new password", text: $confirmation)
                    .textContentType(.newPassword)
                Text("Use 12+ characters and at least three of: lowercase, uppercase, number, or symbol.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Forgot your current password?") { showingRecovery = true }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(FFTheme.meadowDeep)
                if let errorMessage {
                    Text(errorMessage).font(.footnote).foregroundStyle(FFTheme.seal)
                }
            } header: {
                Text("Password")
            } footer: {
                Text("Changing your password signs out your other devices, but keeps this one signed in.")
            }
            .listRowBackground(FFTheme.parchment1)
        }
        .ffListChrome()
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Change password")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(isSaving ? "Saving…" : "Save") { save() }
                    .disabled(isSaving || !canSave)
            }
        }
        .sheet(isPresented: $showingRecovery) { PasswordRecoverySheet() }
        .alert("Password changed", isPresented: $saved) {
            Button("Done") { dismiss() }
        } message: {
            Text("Your other signed-in devices have been signed out.")
        }
    }

    private var canSave: Bool {
        !currentPassword.isEmpty && newPassword.count >= 12 && newPassword == confirmation
    }

    private func save() {
        isSaving = true
        errorMessage = nil
        Task {
            do {
                try await APIClient.shared.changePassword(currentPassword: currentPassword, newPassword: newPassword)
                currentPassword = ""
                newPassword = ""
                confirmation = ""
                saved = true
            } catch {
                errorMessage = error.localizedDescription
            }
            isSaving = false
        }
    }
}

/// Account Management does not have the e-mail text from the sign-in screen,
/// so this small wrapper gives recovery the same privacy-preserving request UI.
private struct PasswordRecoverySheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var isSending = false
    @State private var submitted = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Enter the email for your password account. If recovery is available, we’ll send a secure reset link.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    TextField("you@example.com", text: $email)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .autocorrectionDisabled()
                    if submitted {
                        Label("If that account can use password recovery, a reset link is on its way.", systemImage: "envelope.badge")
                            .font(.footnote).foregroundStyle(FFTheme.meadowDeep)
                    }
                    if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(FFTheme.seal) }
                }
                .listRowBackground(FFTheme.parchment1)
            }
            .ffListChrome()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Reset password")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSending ? "Sending…" : "Send link") { send() }
                        .disabled(isSending || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private func send() {
        isSending = true
        errorMessage = nil
        Task {
            do {
                try await APIClient.shared.requestPasswordReset(email: email)
                submitted = true
            } catch {
                errorMessage = "We couldn’t request a reset link. Please check your connection and try again."
            }
            isSending = false
        }
    }
}

#Preview { NavigationStack { ProfileAccountView() }.environmentObject(NativeSession()).environmentObject(BiometricLock()) }
