import AuthenticationServices
import WebKit

enum SpotifyConnectError: LocalizedError {
    case notSignedIn
    case cancelled
    case couldNotStart
    case provider(String)

    var errorDescription: String? {
        switch self {
        case .notSignedIn: return "Sign in before connecting Spotify."
        case .cancelled: return "Connecting Spotify was cancelled."
        case .couldNotStart: return "Could not open the Spotify connection flow."
        case .provider(let reason): return reason.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

/// Bridges the app's own signed-in session into a real Spotify OAuth flow.
/// Identical shape to StravaConnector -- the member is already
/// authenticated, so there's no separate code-for-session exchange, only a
/// way to detect completion via the custom-scheme callback.
@MainActor
final class SpotifyConnector: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    private var webSession: ASWebAuthenticationSession?
    private var fallbackWindow: UIWindow?

    func connect() async throws {
        try await bridgeSessionCookie()

        guard let startURL = URL(string: "/api/connectors/spotify/start?native=1", relativeTo: APIClient.shared.baseURL) else {
            throw SpotifyConnectError.couldNotStart
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let session = ASWebAuthenticationSession(url: startURL, callbackURLScheme: "functioningfaith") { [weak self] callbackURL, error in
                Task { @MainActor in
                    self?.webSession = nil
                    if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                        continuation.resume(throwing: SpotifyConnectError.cancelled)
                        return
                    }
                    guard error == nil, let callbackURL,
                          let callback = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
                        continuation.resume(throwing: error ?? SpotifyConnectError.couldNotStart)
                        return
                    }
                    let reason = callback.queryItems?.first(where: { $0.name == "error" })?.value
                    if let reason, !reason.isEmpty {
                        continuation.resume(throwing: SpotifyConnectError.provider(reason))
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
                continuation.resume(throwing: SpotifyConnectError.couldNotStart)
            }
        }
    }

    private func bridgeSessionCookie() async throws {
        // A fresh authenticated round-trip guarantees the server's session
        // cookie has actually been (re)written into HTTPCookieStorage.shared
        // before we read it -- without this, a member who is genuinely signed
        // in could still see a spurious "not signed in" if the cookie last
        // written there was ever stale or momentarily missing. Best-effort:
        // if this fails, the guard below still correctly reports not signed in.
        _ = try? await APIClient.shared.fetchProfile()

        guard let cookies = HTTPCookieStorage.shared.cookies(for: APIClient.shared.baseURL), !cookies.isEmpty else {
            throw SpotifyConnectError.notSignedIn
        }
        let store = WKWebsiteDataStore.default().httpCookieStore
        // WKWebsiteDataStore.default() is a persistent, process-wide jar shared
        // by every WKWebView/ASWebAuthenticationSession in the app -- a stale
        // cookie left behind by an earlier connector attempt (or a session
        // that has since been revoked server-side) can coexist with the fresh
        // one instead of being cleanly replaced, and the server may end up
        // validating the wrong one. Clear this host's cookies here first so
        // only the current, actually-valid session cookie is ever present.
        if let host = APIClient.shared.baseURL.host {
            let existing = await withCheckedContinuation { (continuation: CheckedContinuation<[HTTPCookie], Never>) in
                store.getAllCookies { continuation.resume(returning: $0) }
            }
            for cookie in existing where cookie.domain.hasSuffix(host) {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    store.delete(cookie) { continuation.resume() }
                }
            }
        }
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
