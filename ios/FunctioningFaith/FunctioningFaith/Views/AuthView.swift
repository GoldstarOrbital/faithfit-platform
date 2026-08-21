import AuthenticationServices
import SwiftUI

@MainActor
final class NativeSession: ObservableObject {
    @Published var profile: UserProfile?
    @Published var isRestoring = true
    @Published var requiresAccountSetup = false

    var isAuthenticated: Bool { profile != nil }

    func restore() async {
        guard profile == nil else { isRestoring = false; return }
        if let state = try? await APIClient.shared.fetchSessionState() {
            profile = state.profile
            requiresAccountSetup = state.accountSetupRequired
        }
        isRestoring = false
    }

    func signOut() async {
        try? await APIClient.shared.logout()
        profile = nil
        requiresAccountSetup = false
    }

    func deleteAccount() async throws {
        try await APIClient.shared.deleteAccount()
        profile = nil
        requiresAccountSetup = false
    }
}

struct NativeAuthView: View {
    let onAuthenticated: (UserProfile, Bool, Bool) -> Void
    @StateObject private var oauthCoordinator = NativeOAuthCoordinator()
    @State private var isRegistering = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var dateOfBirth = Calendar.current.date(byAdding: .year, value: -18, to: .now) ?? .now
    @State private var acceptedTerms = false
    @State private var errorMessage: String?
    @State private var isSubmitting = false
    @State private var providers: [NativeAuthProvider] = []
    @State private var mfaRequired = false
    @State private var mfaCode = ""
    @State private var appleNonce: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Image(systemName: "figure.run.circle.fill")
                        .font(.system(size: 64)).foregroundStyle(FFTheme.hearth)
                    Text("Functioning Faith").font(.largeTitle.bold())
                    Text(isRegistering ? "Build a rhythm that strengthens body and spirit." : "Welcome back to your rhythm.")
                        .multilineTextAlignment(.center).foregroundStyle(.secondary)
                    if mfaRequired {
                        mfaChallenge
                    } else {
                        credentialForm
                        if !providers.filter({ $0.name != "apple" }).isEmpty {
                            HStack { Divider(); Text("or").font(.caption).foregroundStyle(.secondary); Divider() }
                            ForEach(providers.filter { $0.name != "apple" }) { provider in
                                Button { signIn(with: provider) } label: {
                                    Label("Continue with \(providerTitle(provider))", systemImage: "person.badge.key.fill")
                                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                                }
                                .buttonStyle(.ffGhost)
                                .disabled(isSubmitting)
                            }
                        }
                        SignInWithAppleButton(.continue, onRequest: prepareAppleRequest, onCompletion: completeAppleRequest)
                            .signInWithAppleButtonStyle(.black)
                            .frame(height: 50)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .disabled(isSubmitting)
                        Button(isRegistering ? "Already have an account? Sign in" : "New here? Create an account") {
                            isRegistering.toggle(); errorMessage = nil
                        }.buttonStyle(.plain).foregroundStyle(.secondary)
                    }
                }
                .padding(24)
            }
            .navigationTitle("Your space")
            .task {
                providers = (try? await APIClient.shared.fetchAuthProviders()) ?? []
            }
        }
    }

    @ViewBuilder
    private var credentialForm: some View {
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
        if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(FFTheme.seal).accessibilityAddTraits(.isStaticText) }
        Button(action: submit) {
            Group { if isSubmitting { ProgressView().tint(.white) } else { Text(isRegistering ? "Create account" : "Sign in") } }
                .frame(maxWidth: .infinity).padding(.vertical, 12)
        }
        .buttonStyle(.ffPrimary).disabled(isSubmitting || !canSubmit)
    }

    @ViewBuilder
    private var mfaChallenge: some View {
        Text("Enter the code from your authenticator app or one backup code.")
            .multilineTextAlignment(.center).foregroundStyle(.secondary)
        TextField("Security code", text: $mfaCode)
            .textContentType(.oneTimeCode)
            .keyboardType(.asciiCapable)
            .textInputAutocapitalization(.characters)
            .textFieldStyle(.roundedBorder)
        if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(FFTheme.seal) }
        Button("Verify", action: completeMfa)
            .buttonStyle(.ffPrimary)
            .disabled(mfaCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
        Button("Cancel") {
            mfaRequired = false; mfaCode = ""; errorMessage = nil
        }
        .buttonStyle(.plain).foregroundStyle(.secondary)
    }

    private func submit() {
        isSubmitting = true; errorMessage = nil
        Task {
            do {
                if isRegistering {
                    let profile = try await APIClient.shared.registerForAppStore(name: name, email: email, password: password, dateOfBirth: dateOfBirth, acceptedTerms: acceptedTerms)
                    isSubmitting = false
                    onAuthenticated(profile, true, false)
                } else {
                    switch try await APIClient.shared.login(email: email, password: password) {
                    case .mfaRequired:
                        isSubmitting = false
                        mfaRequired = true
                    case .authenticated(let state):
                        isSubmitting = false
                        onAuthenticated(state.profile, false, state.accountSetupRequired)
                    }
                }
            } catch {
                isSubmitting = false; errorMessage = error.localizedDescription
            }
        }
    }

    private func completeMfa() {
        isSubmitting = true; errorMessage = nil
        Task {
            do {
                let state = try await APIClient.shared.completeMfa(code: mfaCode)
                isSubmitting = false
                onAuthenticated(state.profile, false, state.accountSetupRequired)
            } catch {
                isSubmitting = false; errorMessage = error.localizedDescription
            }
        }
    }

    private func signIn(with provider: NativeAuthProvider) {
        isSubmitting = true; errorMessage = nil
        Task {
            do {
                let state = try await oauthCoordinator.signIn(provider: provider)
                isSubmitting = false
                onAuthenticated(state.profile, false, state.accountSetupRequired)
            } catch {
                isSubmitting = false; errorMessage = error.localizedDescription
            }
        }
    }

    private func prepareAppleRequest(_ request: ASAuthorizationAppleIDRequest) {
        let nonce = NativeOAuthCoordinator.randomVerifier()
        appleNonce = nonce
        request.requestedScopes = [.fullName, .email]
        request.nonce = NativeOAuthCoordinator.appleNonceHash(for: nonce)
    }

    private func completeAppleRequest(_ result: Result<ASAuthorization, Error>) {
        do {
            guard case .success(let authorization) = result,
                  let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let identityToken = String(data: tokenData, encoding: .utf8),
                  let nonce = appleNonce else {
                if case .failure(let error) = result { throw error }
                throw NativeOAuthError.invalidCallback
            }
            let displayName = credential.fullName.map { PersonNameComponentsFormatter().string(from: $0) }
            isSubmitting = true
            errorMessage = nil
            Task {
                do {
                    switch try await APIClient.shared.signInWithApple(identityToken: identityToken, nonce: nonce, displayName: displayName) {
                    case .mfaRequired:
                        isSubmitting = false
                        mfaRequired = true
                    case .authenticated(let state):
                        isSubmitting = false
                        onAuthenticated(state.profile, false, state.accountSetupRequired)
                    }
                } catch {
                    isSubmitting = false; errorMessage = error.localizedDescription
                }
            }
        } catch {
            isSubmitting = false
            errorMessage = (error as? ASAuthorizationError)?.code == .canceled ? "Sign-in was cancelled." : error.localizedDescription
        }
    }

    private func providerTitle(_ provider: NativeAuthProvider) -> String {
        if provider.name == "google" { return "Google" }
        if provider.name == "apple" { return "Apple" }
        return provider.label
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

#Preview { NativeAuthView { _, _, _ in } }
