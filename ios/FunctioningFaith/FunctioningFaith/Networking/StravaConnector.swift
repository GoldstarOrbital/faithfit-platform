import AuthenticationServices
import WebKit

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
/// ASWebAuthenticationSession's browsing context draws from
/// WKWebsiteDataStore, a different cookie jar from URLSession.shared (which
/// APIClient uses for every other call) -- so without bridging the existing
/// session cookie across first, the web view would hit
/// /connectors/strava/start unauthenticated. This is the standard fix for
/// exactly that gap.
@MainActor
final class StravaConnector: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    private var webSession: ASWebAuthenticationSession?
    private var fallbackWindow: UIWindow?

    func connect() async throws {
        try await bridgeSessionCookie()

        guard let startURL = URL(string: "/api/connectors/strava/start?native=1", relativeTo: APIClient.shared.baseURL) else {
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

    private func bridgeSessionCookie() async throws {
        guard let cookies = HTTPCookieStorage.shared.cookies(for: APIClient.shared.baseURL), !cookies.isEmpty else {
            throw StravaConnectError.notSignedIn
        }
        let store = WKWebsiteDataStore.default().httpCookieStore
        for cookie in cookies {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                store.setCookie(cookie) { continuation.resume() }
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
