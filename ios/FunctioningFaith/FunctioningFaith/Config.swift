import Foundation

/// Build-time / Info.plist driven configuration.
/// Prefer keys in Info.plist so Release archives never need source edits.
enum AppConfig {
    /// Production API host. Override with Info.plist `FFAPIBaseURL` for staging.
    static var apiBaseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "FFAPIBaseURL") as? String,
           let url = URL(string: raw), !raw.isEmpty,
           // A release archive must never be pointed at clear-text HTTP by a
           // build-setting or plist mistake. Debug builds retain the option
           // for a local development server.
           (url.scheme?.lowercased() == "https" || isDebugBuild) {
            return url
        }
        return URL(string: "https://faithfit-demo-production.up.railway.app")!
    }

    private static var isDebugBuild: Bool {
#if DEBUG
        true
#else
        false
#endif
    }

    /// Native Sign in with Apple audience / client id.
    /// Must match server `APPLE_NATIVE_CLIENT_ID` and the App ID.
    static var appleClientID: String {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "FFAppleClientID") as? String,
           !raw.isEmpty {
            return raw
        }
        return "com.functioningfaith.app"
    }

    static var oauthCallbackScheme: String { "functioningfaith" }
}
