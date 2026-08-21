import Foundation

enum APIError: LocalizedError {
    case invalidResponse
    case requestFailed(Int, String?)
    case notSignedIn

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "The server returned an invalid response."
        case .requestFailed(_, let message): return message ?? "Something went wrong. Please try again."
        case .notSignedIn: return "Please sign in to continue."
        }
    }

    /// Known backend error codes mapped to calm, member-facing copy.
    /// Never surface raw codes like `gloo_not_configured` in the UI.
    static func memberMessage(for code: String?, hint: String?, status: Int) -> String {
        switch code {
        case "companion_unavailable", "gloo_not_configured", "gloo_unavailable":
            return "The companion isn’t available right now. Scripture and community still work as usual."
        case "no_verified_answer":
            return "Couldn’t verify an answer for that question. Try rephrasing, or reflect with others in the conversation."
        case "no_text_available":
            return "No verified text is available for that reference yet. Try another reference, or open it in YouVersion."
        case "biometric_consent_required":
            return "Heart-rate sharing needs your consent. You can enable it in Profile privacy settings."
        case "member_reels_paused", "reels_paused":
            return "Member Reel publishing is temporarily paused. Try again later."
        case "invalid_video", "invalid_video_category", "video_too_large", "video_too_long":
            return hint ?? "That video doesn’t meet Reel criteria (MP4, ≤4MB, ≤60s, allowed category)."
        default:
            if status == 401 || status == 403 { return "Please sign in to continue." }
            if status >= 500 { return "The server had a problem. Please try again in a moment." }
            return hint ?? "Something went wrong. Please try again."
        }
    }
}

// PLACEHOLDER_FULL_FILE_TOO_LARGE_FOR_SINGLE_ARG
