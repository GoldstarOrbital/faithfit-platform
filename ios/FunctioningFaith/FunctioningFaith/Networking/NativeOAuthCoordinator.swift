import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

enum NativeOAuthError: LocalizedError {
    case invalidStartURL
    case couldNotStart
    case cancelled
    case provider(String)
    case invalidCallback

    var errorDescription: String? {
        switch self {
        case .invalidStartURL, .invalidCallback:
            return "The sign-in response could not be verified. Please try again."
        case .couldNotStart:
            return "Secure sign-in could not be opened on this device."
        case .cancelled:
            return "Sign-in was cancelled."
        case .provider(let reason):
            return reason.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

/// Runs the provider's server-owned Authorization Code flow in Apple's secure
/// authentication session, then exchanges a one-use, app-PKCE-bound handoff
/// code for the same revocable HttpOnly session used everywhere else.
@MainActor
final class NativeOAuthCoordinator: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    private var webSession: ASWebAuthenticationSession?
    private var fallbackWindow: UIWindow?

    func signIn(provider: NativeAuthProvider) async throws -> NativeSessionState {
        let verifier = Self.randomVerifier()
        let challenge = Self.pkceChallenge(for: verifier)

        guard let endpoint = URL(string: "/api/auth/oauth/\(provider.name)/start", relativeTo: APIClient.shared.baseURL),
              var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: true)
        else { throw NativeOAuthError.invalidStartURL }
        components.queryItems = [
            URLQueryItem(name: "native", value: "1"),
            URLQueryItem(name: "handoff_challenge", value: challenge),
        ]
        guard let startURL = components.url else { throw NativeOAuthError.invalidStartURL }

        let code = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            let session = ASWebAuthenticationSession(url: startURL, callbackURLScheme: "functioningfaith") { [weak self] callbackURL, error in
                Task { @MainActor in
                    self?.webSession = nil
                    if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                        continuation.resume(throwing: NativeOAuthError.cancelled)
                        return
                    }
                    guard error == nil, let callbackURL,
                          let callback = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
                        continuation.resume(throwing: error ?? NativeOAuthError.invalidCallback)
                        return
                    }
                    let reason = callback.queryItems?.first(where: { $0.name == "error" })?.value
                    let callbackCode = callback.queryItems?.first(where: { $0.name == "code" })?.value
                    if let reason, !reason.isEmpty {
                        continuation.resume(throwing: NativeOAuthError.provider(reason))
                    } else if let callbackCode, !callbackCode.isEmpty {
                        continuation.resume(returning: callbackCode)
                    } else {
                        continuation.resume(throwing: NativeOAuthError.invalidCallback)
                    }
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            webSession = session
            if !session.start() {
                webSession = nil
                continuation.resume(throwing: NativeOAuthError.couldNotStart)
            }
        }

        return try await APIClient.shared.exchangeNativeOAuth(code: code, handoffVerifier: verifier)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let keyWindow = scenes.flatMap(\.windows).first(where: \.isKeyWindow) { return keyWindow }
        let window: UIWindow
        if let scene = scenes.first { window = UIWindow(windowScene: scene) }
        else { window = UIWindow(frame: UIScreen.main.bounds) }
        fallbackWindow = window
        return window
    }

    static func randomVerifier() -> String {
        var generator = SystemRandomNumberGenerator()
        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        return Data(bytes).base64URLEncodedString()
    }

    static func pkceChallenge(for verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
    }

    static func appleNonceHash(for nonce: String) -> String {
        SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
