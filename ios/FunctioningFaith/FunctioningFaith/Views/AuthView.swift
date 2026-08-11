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
}

struct NativeAuthView: View {
    let onAuthenticated: (UserProfile) -> Void
    @State private var isRegistering = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
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
                    if isRegistering { TextField("Name", text: $name).textContentType(.name).textFieldStyle(.roundedBorder) }
                    TextField("Email", text: $email).textContentType(.emailAddress).textInputAutocapitalization(.never).keyboardType(.emailAddress).textFieldStyle(.roundedBorder)
                    SecureField("Password", text: $password).textContentType(isRegistering ? .newPassword : .password).textFieldStyle(.roundedBorder)
                    if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.red).accessibilityAddTraits(.isStaticText) }
                    Button(action: submit) {
                        Group { if isSubmitting { ProgressView().tint(.white) } else { Text(isRegistering ? "Create account" : "Sign in") } }
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent).disabled(isSubmitting)
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
                    ? try await APIClient.shared.register(name: name, email: email, password: password)
                    : try await APIClient.shared.login(email: email, password: password)
                await MainActor.run { isSubmitting = false; onAuthenticated(profile) }
            } catch {
                await MainActor.run { isSubmitting = false; errorMessage = error.localizedDescription }
            }
        }
    }
}

#Preview { NativeAuthView { _ in } }
