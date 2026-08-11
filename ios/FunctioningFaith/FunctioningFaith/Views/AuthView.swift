import SwiftUI

@MainActor
final class NativeSession: ObservableObject {
    @Published var profile: UserProfile?
    @Published var isRestoring = true

    var isAuthenticated: Bool { profile != nil }

    func restore() async {
        guard profile == nil else { isRestoring = false; return }
        profile = try? await APIClient.shared.fetchProfile()
        isRestoring = false
    }

    func signOut() async {
        try? await APIClient.shared.logout()
        profile = nil
    }

    func deleteAccount() async throws {
        try await APIClient.shared.deleteAccount()
        profile = nil
    }
}

struct NativeAuthView: View {
    let onAuthenticated: (UserProfile, Bool) -> Void
    @State private var isRegistering = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var dateOfBirth = Calendar.current.date(byAdding: .year, value: -18, to: .now) ?? .now
    @State private var acceptedTerms = false
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Image(systemName: "figure.run.circle.fill")
                        .font(.system(size: 64)).foregroundStyle(.orange)
                    Text("Functioning Faith").font(.largeTitle.bold())
                    Text(isRegistering ? "Build a rhythm that strengthens body and spirit." : "Welcome back to your rhythm.")
                        .multilineTextAlignment(.center).foregroundStyle(.secondary)
                    if isRegistering {
                        TextField("Name", text: $name).textContentType(.name).textFieldStyle(.roundedBorder)
                        DatePicker("Date of birth", selection: $dateOfBirth, in: ...Date(), displayedComponents: .date)
                            .datePickerStyle(.compact)
                        Toggle("I am at least 13 and accept the Terms and Privacy Policy", isOn: $acceptedTerms)
                            .font(.footnote)
                        HStack(spacing: 14) {
                            Link("Terms", destination: URL(string: "https://faithfit-demo-production.up.railway.app/terms.html")!)
                            Link("Privacy Policy", destination: URL(string: "https://faithfit-demo-production.up.railway.app/privacy.html")!)
                        }
                        .font(.footnote)
                    }
                    TextField("Email", text: $email).textContentType(.emailAddress).textInputAutocapitalization(.never).keyboardType(.emailAddress).textFieldStyle(.roundedBorder)
                    SecureField(isRegistering ? "Password (12+ characters)" : "Password", text: $password).textContentType(isRegistering ? .newPassword : .password).textFieldStyle(.roundedBorder)
                    if isRegistering {
                        Text("Use 12+ characters and at least three of: lowercase, uppercase, number, or symbol.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.red).accessibilityAddTraits(.isStaticText) }
                    Button(action: submit) {
                        Group { if isSubmitting { ProgressView().tint(.white) } else { Text(isRegistering ? "Create account" : "Sign in") } }
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent).disabled(isSubmitting || !canSubmit)
                    Button(isRegistering ? "Already have an account? Sign in" : "New here? Create an account") {
                        isRegistering.toggle(); errorMessage = nil
                    }.buttonStyle(.plain).foregroundStyle(.secondary)
                }
                .padding(24)
            }
            .navigationTitle("Your space")
        }
    }

    private func submit() {
        isSubmitting = true; errorMessage = nil
        Task {
            do {
                let profile = isRegistering
                    ? try await APIClient.shared.registerForAppStore(name: name, email: email, password: password, dateOfBirth: dateOfBirth, acceptedTerms: acceptedTerms)
                    : try await APIClient.shared.login(email: email, password: password)
                await MainActor.run { isSubmitting = false; onAuthenticated(profile, isRegistering) }
            } catch {
                await MainActor.run { isSubmitting = false; errorMessage = error.localizedDescription }
            }
        }
    }

    private var canSubmit: Bool {
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !password.isEmpty else { return false }
        if !isRegistering { return true }
        return !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && passwordMeetsPolicy && isEligibleAge && acceptedTerms
    }

    private var isEligibleAge: Bool {
        (Calendar(identifier: .gregorian).dateComponents([.year], from: dateOfBirth, to: .now).year ?? 0) >= 13
    }

    private var passwordMeetsPolicy: Bool {
        guard password.count >= 12 else { return false }
        let classes = [
            password.rangeOfCharacter(from: .lowercaseLetters) != nil,
            password.rangeOfCharacter(from: .uppercaseLetters) != nil,
            password.rangeOfCharacter(from: .decimalDigits) != nil,
            password.rangeOfCharacter(from: CharacterSet.alphanumerics.inverted) != nil,
        ]
        return classes.filter { $0 }.count >= 3
    }
}

#Preview { NativeAuthView { _, _ in } }
