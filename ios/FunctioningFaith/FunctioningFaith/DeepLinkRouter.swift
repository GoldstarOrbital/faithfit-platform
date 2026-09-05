import Foundation
import SwiftUI

/// Routes `functioningfaith://` and https paths into the native shell.
/// Skill: resume interrupted flows and open the right screen from notifications / shared links.
enum DeepLink: Equatable {
    case home
    case reels
    case search
    case workouts
    case explore
    case messages
    case profile
    case dm(threadID: String)
    case post(id: String)
    case workout(id: String)
    case group(id: String)
    case verse(reference: String)
    case athlete(id: String)

    static func parse(_ url: URL) -> DeepLink? {
        let scheme = url.scheme?.lowercased() ?? ""
        guard scheme == "functioningfaith" || scheme == "https" || scheme == "http" else { return nil }
        // Same-origin only (RELEASE_CHECKLIST.md's own requirement for this
        // item): there is no associated-domains entitlement configured, so
        // iOS never hands this app a Universal Link automatically today --
        // but .onOpenURL in FunctioningFaithApp.swift will still call this
        // with whatever URL any caller passes it, so this check is the only
        // thing standing between "the app's own https links" and "any
        // https link at all" if that ever changes.
        if scheme == "https" || scheme == "http" {
            guard url.host?.lowercased() == AppConfig.apiBaseURL.host?.lowercased() else { return nil }
        }

        var parts = url.pathComponents.filter { $0 != "/" }
        // For the custom functioningfaith:// scheme, URL parsing treats the
        // command as the host and only the argument as the path -- e.g.
        // functioningfaith://dm/<id> parses as host "dm", path ["<id>"], NOT
        // path ["dm", "<id>"]. Folding host back onto the front of parts
        // makes "dm" -> parts[0] and "<id>" -> parts[1] again, matching what
        // every two-segment case below (dm, workout, post, group, athlete)
        // expects. This must NOT apply to https/http universal links, where
        // host is a real domain and every path segment already lives in
        // pathComponents -- folding it in there would put the domain name
        // where a command word is expected and break every case.
        if scheme == "functioningfaith", let host = url.host, !host.isEmpty {
            parts = [host] + parts
        }

        guard let head = parts.first?.lowercased() else { return .home }

        switch head {
        case "home", "feed":
            return .home
        case "reels", "reel":
            return .reels
        case "search":
            return .search
        case "workouts", "workout":
            if parts.count >= 2 { return .workout(id: parts[1]) }
            return .workouts
        case "explore":
            return .explore
        case "messages", "dms", "dm":
            if parts.count >= 2 { return .dm(threadID: parts[1]) }
            return .messages
        case "profile":
            return .profile
        case "post", "posts":
            guard parts.count >= 2 else { return .home }
            return .post(id: parts[1])
        case "group", "groups":
            guard parts.count >= 2 else { return .explore }
            return .group(id: parts[1])
        case "athlete", "user", "users":
            guard parts.count >= 2 else { return .explore }
            return .athlete(id: parts[1])
        case "verse", "scripture":
            let ref = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "ref" || $0.name == "reference" })?.value
                ?? parts.dropFirst().joined(separator: " ")
            guard !ref.isEmpty else { return .explore }
            return .verse(reference: ref)
        default:
            return nil
        }
    }
}

@MainActor
final class DeepLinkRouter: ObservableObject {
    @Published var selectedTab: AppTab = .home
    @Published var pending: DeepLink?
    @Published var openDMThreadID: String?
    @Published var openPostID: String?
    @Published var openGroupID: String?
    @Published var openVerseReference: String?
    @Published var openAthleteID: String?

    func handle(_ url: URL) {
        guard let link = DeepLink.parse(url) else { return }
        apply(link)
    }

    func apply(_ link: DeepLink) {
        pending = link
        switch link {
        case .home:
            selectedTab = .home
        case .reels:
            selectedTab = .reels
        case .search:
            selectedTab = .search
        case .workouts, .workout:
            selectedTab = .workouts
        case .explore, .group, .athlete:
            selectedTab = .explore
            if case .group(let id) = link { openGroupID = id }
            if case .athlete(let id) = link { openAthleteID = id }
        case .verse(let ref):
            // Scripture split out into its own global-bar tab after this
            // routing was written (see AppShell.swift) -- a verse belongs
            // there now, not in Explore, which no longer hosts Scripture
            // content at all.
            selectedTab = .scripture
            openVerseReference = ref
        case .messages, .dm:
            selectedTab = .messages
            if case .dm(let id) = link { openDMThreadID = id }
        case .profile:
            selectedTab = .profile
        case .post(let id):
            selectedTab = .home
            openPostID = id
        }
    }

    func clearTransient() {
        openDMThreadID = nil
        openPostID = nil
        openGroupID = nil
        openVerseReference = nil
        openAthleteID = nil
        pending = nil
    }
}

enum AppTab: Hashable {
    // home, reels, scripture, messages, search are the persistent global
    // bottom bar's five items; workouts, explore, profile, settings are
    // reached through the side panel instead (see AppShell.swift).
    case home, workouts, explore, messages, profile, reels, scripture, search, settings
}
