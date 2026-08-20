import Foundation

/// Build-time / Info.plist driven configuration.
/// Prefer keys in Info.plist so Release archives never need source edits.
enum AppConfig {
    /// Production API host. Override with Info.plist `FFAPIBaseURL` for staging.
    static var apiBaseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "FFAPIBaseURL") as? String,
           let url = URL(string: raw), !raw.isEmpty {
            return url
        }
        return URL(string: "https://faithfit-demo-production.up.railway.app")!
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
