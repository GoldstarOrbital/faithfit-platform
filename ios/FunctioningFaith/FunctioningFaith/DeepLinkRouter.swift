import Foundation
import SwiftUI

/// Routes `functioningfaith://` and https paths into the native shell.
/// Skill: resume interrupted flows and open the right screen from notifications / shared links.
enum DeepLink: Equatable {
    case home
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

        var parts = url.pathComponents.filter { $0 != "/" }
        // functioningfaith://messages → host is the first segment when path is empty
        if parts.isEmpty, let host = url.host, !host.isEmpty {
            parts = [host]
        }

        guard let head = parts.first?.lowercased() else { return .home }

        switch head {
        case "home", "feed":
            return .home
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
        case .workouts, .workout:
            selectedTab = .workouts
        case .explore, .group, .verse, .athlete:
            selectedTab = .explore
            if case .group(let id) = link { openGroupID = id }
            if case .verse(let ref) = link { openVerseReference = ref }
            if case .athlete(let id) = link { openAthleteID = id }
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
