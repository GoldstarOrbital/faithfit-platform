import Foundation

struct WorkoutSummary: Codable, Identifiable {
    let id: UUID
    let type: String
    let startTime: Date
    let endTime: Date?
    let calories: Int?
    let avgHR: Int?
}

struct VerseSnippet: Codable, Identifiable {
    let id: String
    let reference: String
    let snippet: String
    let deepLink: String
}

struct FeedPost: Codable, Identifiable {
    let id: UUID
    let authorID: UUID? = nil
    let authorName: String
    let content: String
    let workout: WorkoutSummary?
    let verse: VerseSnippet?
    let createdAt: Date
    var likeCount: Int = 0
    var likedByMe: Bool = false
    var savedByMe: Bool = false
}

struct Badge: Codable, Identifiable {
    let id: String
    let name: String
    let iconURL: String
}

struct UserProfile: Codable, Identifiable {
    let id: UUID
    let displayName: String
    let bio: String?
    let xp: Int
    let level: Int
    let badges: [Badge]
}

struct SuggestedUser: Codable, Identifiable {
    let id: UUID
    let displayName: String
    let bio: String?
    let followersCount: Int
    let reason: String
    var isFollowing: Bool = false
}

struct ExploreGroup: Codable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let username: String?
    let churchName: String?
    let locationName: String?
    let sport: String?
    let memberCount: Int

    enum CodingKeys: String, CodingKey {
        case id, name, description, username, sport
        case churchName = "church_name"
        case locationName = "location_name"
        case memberCount = "member_count"
    }
}

struct ExploreQuest: Codable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let theme: String?
    let target: Int
}

struct ExploreChallenge: Codable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let flavor: String?
    let scriptureReference: String?
    let metric: String
    let target: Double
    let theme: String?
    var progress: Double
    var participants: Int
    var joined: Bool
    var percent: Int
    var completed: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, description, flavor, metric, target, theme, progress, participants, joined, percent, completed
        case scriptureReference = "scripture_ref"
    }
}

struct ExploreContent {
    let groups: [ExploreGroup]
    let quests: [ExploreQuest]
    let challenges: [ExploreChallenge]
}
