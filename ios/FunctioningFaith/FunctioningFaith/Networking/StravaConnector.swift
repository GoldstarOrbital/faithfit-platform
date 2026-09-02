import AuthenticationServices

enum StravaConnectError: LocalizedError {
    case notSignedIn
    case cancelled
    case couldNotStart
    case provider(String)

    var errorDescription: String? {
        switch self {
        case .notSignedIn: return "Sign in before connecting Strava."
        case .cancelled: return "Connecting Strava was cancelled."
        case .couldNotStart: return "Could not open the Strava connection flow."
        case .provider(let reason): return reason.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

/// Bridges the app's own signed-in session into a real Strava OAuth flow.
/// Structured the same way NativeOAuthCoordinator handles sign-in
/// (ASWebAuthenticationSession + custom-scheme callback), but this is a
/// simpler case: the member is already authenticated, so there's no
/// separate code-for-session exchange -- only a way to detect completion.
///
/// ASWebAuthenticationSession's browsing context is a separate,
/// system-managed Safari-shared jar -- it is NOT WKWebsiteDataStore.default()
/// and isn't reachable from any public WebKit API, so there's no way to
/// bridge the app's session cookie into it. Instead, a short-lived
/// single-use handoff token carries the member's identity as a query
/// parameter on the start URL. See the server's requireAuthOrHandoffToken
/// for the full reasoning.
@MainActor
final class StravaConnector: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    private var webSession: ASWebAuthenticationSession?
    private var fallbackWindow: UIWindow?

    func connect() async throws {
        let token: String
        do {
            token = try await APIClient.shared.fetchOAuthHandoffToken()
        } catch {
            throw StravaConnectError.notSignedIn
        }

        guard var components = URLComponents(url: URL(string: "/api/connectors/strava/start", relativeTo: APIClient.shared.baseURL)!, resolvingAgainstBaseURL: true) else {
            throw StravaConnectError.couldNotStart
        }
        components.queryItems = [URLQueryItem(name: "native", value: "1"), URLQueryItem(name: "token", value: token)]
        guard let startURL = components.url else {
            throw StravaConnectError.couldNotStart
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let session = ASWebAuthenticationSession(url: startURL, callbackURLScheme: "functioningfaith") { [weak self] callbackURL, error in
                Task { @MainActor in
                    self?.webSession = nil
                    if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                        continuation.resume(throwing: StravaConnectError.cancelled)
                        return
                    }
                    guard error == nil, let callbackURL,
                          let callback = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
                        continuation.resume(throwing: error ?? StravaConnectError.couldNotStart)
                        return
                    }
                    let reason = callback.queryItems?.first(where: { $0.name == "error" })?.value
                    if let reason, !reason.isEmpty {
                        continuation.resume(throwing: StravaConnectError.provider(reason))
                    } else {
                        continuation.resume(returning: ())
                    }
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            webSession = session
            if !session.start() {
                webSession = nil
                continuation.resume(throwing: StravaConnectError.couldNotStart)
            }
        }
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
}
