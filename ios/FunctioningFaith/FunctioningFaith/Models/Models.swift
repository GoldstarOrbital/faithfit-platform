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
    let authorID: UUID?
    let authorName: String
    let content: String
    let workout: WorkoutSummary?
    let verse: VerseSnippet?
    let createdAt: Date
    let photoData: String?
    let photoCategory: String?
    let visibility: String
    var likeCount: Int = 0
    var likedByMe: Bool = false
    var savedByMe: Bool = false
    var commentCount: Int = 0

    init(
        id: UUID,
        authorID: UUID? = nil,
        authorName: String,
        content: String,
        workout: WorkoutSummary?,
        verse: VerseSnippet?,
        createdAt: Date,
        photoData: String? = nil,
        photoCategory: String? = nil,
        visibility: String = "public",
        likeCount: Int = 0,
        likedByMe: Bool = false,
        savedByMe: Bool = false,
        commentCount: Int = 0
    ) {
        self.id = id
        self.authorID = authorID
        self.authorName = authorName
        self.content = content
        self.workout = workout
        self.verse = verse
        self.createdAt = createdAt
        self.photoData = photoData
        self.photoCategory = photoCategory
        self.visibility = visibility
        self.likeCount = likeCount
        self.likedByMe = likedByMe
        self.savedByMe = savedByMe
        self.commentCount = commentCount
    }
}

struct FeedComment: Codable, Identifiable {
    let id: UUID
    let content: String
    let author: String
    let createdAt: String
    var likeCount: Int
    var likedByMe: Bool
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

// ---- Direct messages ----

struct DMThreadPreview: Identifiable {
    let threadID: String
    let otherUserID: UUID
    let otherName: String
    let otherHasAvatar: Bool
    /// nil for an e2e thread the inbox list didn't decrypt (see DMStore) or a
    /// thread with no messages yet -- never a placeholder string standing in
    /// for real content.
    let previewText: String?
    let lastKind: String
    let lastFromMe: Bool
    let lastMessageAt: Date?
    let unread: Int
    var id: String { threadID }
}

struct DMMessage: Identifiable {
    let id: String
    /// Decrypted (or always-plaintext, for kind "text"/"verse") body ready to
    /// display. Never the raw ciphertext -- DMStore only ever hands out
    /// messages it already decrypted or determined don't need decryption.
    let body: String
    let kind: String
    let fromMe: Bool
    let createdAt: Date
    let read: Bool
    let verseReference: String?
}

struct DMConversation {
    let threadID: String
    let otherUserID: UUID
    let otherName: String
    let otherHasAvatar: Bool
    let blocked: Bool
    let messages: [DMMessage]
}

struct NativeAuthProvider: Codable, Identifiable {
    let name: String
    let label: String
    var id: String { name }
}

struct NativeSessionState {
    let profile: UserProfile
    let accountSetupRequired: Bool
}

enum NativeLoginOutcome {
    case authenticated(NativeSessionState)
    case mfaRequired
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

struct GroupMessage: Codable, Identifiable {
    let id: String
    let content: String
    let createdAt: String
    let authorID: String
    let author: String

    enum CodingKeys: String, CodingKey {
        case id, content, author
        case createdAt = "created_at"
        case authorID = "author_id"
    }
}

struct GroupEvent: Codable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let activityType: String?
    let eventTime: String
    let locationName: String?
    let goingCount: Int
    let interestedCount: Int
    let myRSVP: String?

    enum CodingKeys: String, CodingKey {
        case id, title, description
        case activityType = "activity_type"
        case eventTime = "event_time"
        case locationName = "location_name"
        case goingCount = "going_count"
        case interestedCount = "interested_count"
        case myRSVP = "my_rsvp"
    }
}

struct GroupPulseCheckin: Codable, Identifiable {
    let id: String
    let groupID: String
    let userID: String
    let day: String
    let kind: String
    let note: String?
    let author: String
    let verseReference: String?
    let verseText: String?
    var encouragementCount: Int
    var encouragedByMe: Bool

    enum CodingKeys: String, CodingKey {
        case id, day, kind, note, author
        case groupID = "group_id"
        case userID = "user_id"
        case verseReference = "verse_reference"
        case verseText = "verse_text"
        case encouragementCount = "encouragement_count"
        case encouragedByMe = "encouraged_by_me"
    }
}

struct GroupPulse: Codable {
    let day: String
    let todayCount: Int
    let mine: GroupPulseCheckin?
    var checkins: [GroupPulseCheckin]

    enum CodingKeys: String, CodingKey {
        case day, mine, checkins
        case todayCount = "today_count"
    }
}

struct NativeGroupDetail {
    let group: ExploreGroup
    var memberCount: Int
    var isMember: Bool
    let isAdmin: Bool
    var messages: [GroupMessage]
    let events: [GroupEvent]
}
