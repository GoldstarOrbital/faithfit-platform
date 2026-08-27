import AuthenticationServices
import SwiftUI

@MainActor
final class NativeSession: ObservableObject {
    @Published var profile: UserProfile?
    @Published var isRestoring = true
    @Published var requiresAccountSetup = false

    var isAuthenticated: Bool { profile != nil }
    private var sessionExpiredObserver: NSObjectProtocol?

    init() {
        // A 401 anywhere means the session itself is gone server-side --
        // clearing profile here is what actually takes the whole app back
        // to the sign-in screen, instead of each screen that happened to
        // make a request at that moment showing its own dead-end error
        // while every other tab still looks logged in.
        sessionExpiredObserver = NotificationCenter.default.addObserver(forName: .apiSessionExpired, object: nil, queue: nil) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.profile != nil else { return }
                self.profile = nil
                self.requiresAccountSetup = false
                APIClient.shared.clearResponseCache()
            }
        }
    }

    deinit {
        if let sessionExpiredObserver { NotificationCenter.default.removeObserver(sessionExpiredObserver) }
    }

    /// The session cookie itself is valid for 30 days -- a member should
    /// never see the sign-in screen just because the very first request of a
    /// cold launch hit a slow or momentarily-unreachable network before
    /// connectivity settled. Only an explicit "the server says I'm not
    /// signed in" (APIError.notSignedIn, from a real 401) should ever clear
    /// profile; anything else gets one retry before giving up, and a retry
    /// failure leaves profile untouched rather than forcing a sign-out.
    func restore() async {
        guard profile == nil else { isRestoring = false; return }
        do {
            let state = try await APIClient.shared.fetchSessionState()
            profile = state.profile
            requiresAccountSetup = state.accountSetupRequired
        } catch APIError.notSignedIn {
            profile = nil
        } catch {
            if let state = try? await APIClient.shared.fetchSessionState() {
                profile = state.profile
                requiresAccountSetup = state.accountSetupRequired
            }
        }
        isRestoring = false
    }

    func signOut() async {
        try? await APIClient.shared.logout()
        profile = nil
        requiresAccountSetup = false
        APIClient.shared.clearResponseCache()
    }

    func deleteAccount() async throws {
        try await APIClient.shared.deleteAccount()
        profile = nil
        requiresAccountSetup = false
        APIClient.shared.clearResponseCache()
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
    @State private var usernameStatus: UsernameCheckResult?
    @State private var usernameCheckTask: Task<Void, Never>?
    @State private var errorMessage: String?
    @State private var isSubmitting = false
    @State private var providers: [NativeAuthProvider] = []
    @State private var mfaRequired = false
    @State private var mfaCode = ""
    @State private var appleNonce: String?

    var body: some View {
        NavigationStack {
            ZStack {
                // A warm, dawn-lit backdrop instead of a flat two-stop
                // gradient -- deep walnut settling into parchment, with a
                // soft hearth-gold glow rising behind the brand mark, so the
                // very first screen someone sees reads as considered rather
                // than a placeholder gradient.
                LinearGradient(
                    colors: [FFTheme.walnut0, FFTheme.parchment0, FFTheme.parchment2],
                    startPoint: .top, endPoint: .bottom
                )
                .ignoresSafeArea()
                RadialGradient(
                    colors: [FFTheme.hearthSoft.opacity(0.35), .clear],
                    center: .init(x: 0.5, y: 0.02), startRadius: 10, endRadius: 340
                )
                .ignoresSafeArea()
                .blendMode(.plusLighter)

                ScrollView {
                    VStack(spacing: 22) {
                        VStack(spacing: 12) {
                            Image("BrandMark")
                                .resizable().scaledToFit().frame(width: 80, height: 80)
                                .padding(10)
                                .background(
                                    Circle().fill(
                                        LinearGradient(colors: [FFTheme.parchment2, FFTheme.hearthSoft.opacity(0.5)],
                                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                                    )
                                )
                                .overlay(Circle().stroke(FFTheme.goldBright.opacity(0.55), lineWidth: 1.5))
                                .shadow(color: FFTheme.walnut0.opacity(0.25), radius: 14, x: 0, y: 8)
                            VStack(spacing: 4) {
                                Text("Functioning Faith")
                                    .font(.system(size: 30, weight: .bold, design: .rounded))
                                    .foregroundStyle(FFTheme.ink)
                                Rectangle()
                                    .fill(FFTheme.goldBright.opacity(0.6))
                                    .frame(width: 36, height: 2)
                            }
                            Text(isRegistering ? "Create a rhythm for your body, mind, and spirit." : "Move with purpose. Stay connected in faith.")
                                .font(.subheadline).multilineTextAlignment(.center).foregroundStyle(FFTheme.inkSoft)
                        }
                        .padding(.top, 36)

                        VStack(spacing: 16) {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(isRegistering ? "Create your account" : "Welcome back")
                                        .font(.title3.weight(.bold)).foregroundStyle(FFTheme.ink)
                                    Text(isRegistering ? "A few details, then you’re ready to go." : "Sign in to continue your rhythm.")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: isRegistering ? "sparkles" : "figure.run")
                                    .foregroundStyle(FFTheme.cream)
                                    .padding(10)
                                    .background(
                                        Circle().fill(LinearGradient(colors: [FFTheme.hearth, FFTheme.goldBright],
                                                                      startPoint: .topLeading, endPoint: .bottomTrailing))
                                    )
                            }
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
                        }.buttonStyle(.plain).foregroundStyle(FFTheme.meadowDeep)
                    }
                        }
                        .padding(20)
                        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(FFTheme.gold.opacity(0.22), lineWidth: 1))
                        .shadow(color: FFTheme.walnut0.opacity(0.14), radius: 24, x: 0, y: 14)

                        Label("Private by default · Scripture grounded · Built for your real life", systemImage: "lock.shield")
                            .font(.caption2.weight(.medium)).foregroundStyle(FFTheme.inkSoft)
                            .padding(.bottom, 20)
                    }
                    .padding(.horizontal, 20)
                }
            }
            .navigationBarHidden(true)
            .task {
                providers = (try? await APIClient.shared.fetchAuthProviders()) ?? []
            }
        }
    }

    @ViewBuilder
    private var credentialForm: some View {
        if isRegistering {
            fieldLabel("Username")
            TextField("Choose a username", text: $name)
                .textContentType(.username)
                .textInputAutocapitalization(.words)
                .ffAuthField()
                .onChange(of: name) { _, value in scheduleUsernameCheck(value) }
            if let usernameStatus {
                Label(usernameStatus.available ? "Username available" : (usernameStatus.message ?? "Username unavailable"), systemImage: usernameStatus.available ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .font(.caption).foregroundStyle(usernameStatus.available ? FFTheme.emerald : FFTheme.seal)
            }
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
        fieldLabel("Email")
        TextField("you@example.com", text: $email).textContentType(.emailAddress).textInputAutocapitalization(.never).keyboardType(.emailAddress).ffAuthField()
        fieldLabel("Password")
        SecureField(isRegistering ? "12+ characters" : "Your password", text: $password).textContentType(isRegistering ? .newPassword : .password).ffAuthField()
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

    private func fieldLabel(_ text: String) -> some View {
        Text(text).font(.caption.weight(.bold)).foregroundStyle(FFTheme.inkSoft).frame(maxWidth: .infinity, alignment: .leading)
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
        return !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && usernameStatus?.available != false && passwordMeetsPolicy && isEligibleAge && acceptedTerms
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

    private func scheduleUsernameCheck(_ value: String) {
        usernameCheckTask?.cancel()
        let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard candidate.count >= 2 else { usernameStatus = nil; return }
        usernameCheckTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            usernameStatus = try? await APIClient.shared.checkUsernameAvailable(candidate)
        }
    }
}

private extension View {
    func ffAuthField() -> some View {
        self
            .padding(.horizontal, 13).frame(minHeight: 50)
            .background(FFTheme.parchment0, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(FFTheme.walnut0.opacity(0.14), lineWidth: 1))
    }
}

#Preview { NativeAuthView { _, _, _ in } }
