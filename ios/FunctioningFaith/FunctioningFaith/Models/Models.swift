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
    var job: String? = nil
    var church: String? = nil
    var tradition: String? = nil
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

// ---- Stats & personal records ----

struct PeriodTotals: Decodable {
    let workouts: Int
    let distanceKm: Double
    let durationMin: Int
    let calories: Int
    enum CodingKeys: String, CodingKey { case workouts; case distanceKm = "distance_km"; case durationMin = "duration_min"; case calories }
}

struct StatsSummary: Decodable {
    let lifetime: PeriodTotals
    let thisWeek: PeriodTotals
    let thisMonth: PeriodTotals
    let streakDays: Int
    let activeDays: Int
    let records: SummaryRecords
    enum CodingKeys: String, CodingKey {
        case lifetime; case thisWeek = "this_week"; case thisMonth = "this_month"
        case streakDays = "streak_days"; case activeDays = "active_days"; case records
    }
}

struct SummaryRecords: Decodable {
    let longestDistanceKm: Double?
    let longestDurationMin: Int?
    let fastestPaceMinKm: Double?
    let mostCalories: Int?
    let highestHR: Int?
    enum CodingKeys: String, CodingKey {
        case longestDistanceKm = "longest_distance_km", longestDurationMin = "longest_duration_min"
        case fastestPaceMinKm = "fastest_pace_min_km", mostCalories = "most_calories", highestHR = "highest_hr"
    }
}

struct TrendPoint: Decodable, Identifiable {
    let label: String
    let workouts: Int
    let distanceKm: Double
    let durationMin: Int
    let calories: Int
    var id: String { label }
    enum CodingKeys: String, CodingKey { case label, workouts; case distanceKm = "distance_km"; case durationMin = "duration_min"; case calories }
}

struct ActivityBreakdownEntry: Decodable, Identifiable {
    let type: String
    let count: Int
    let distanceKm: Double
    let durationMin: Int
    let calories: Int
    var id: String { type }
    enum CodingKeys: String, CodingKey { case type, count; case distanceKm = "distance_km"; case durationMin = "duration_min"; case calories }
}

// ---- Hashtags ----

struct TrendingTag: Decodable, Identifiable {
    let tag: String
    let c: Int
    var id: String { tag }
}

// ---- Safety: mute / restrict / block, trusted circle, follow requests ----

struct RelationshipUser: Decodable, Identifiable {
    let userID: String
    let control: String // "mute" | "restrict" | "block"
    let createdAt: String
    let displayName: String
    let hasAvatar: Bool
    var id: String { userID + control }
    enum CodingKeys: String, CodingKey {
        case userID = "user_id", control; case createdAt = "created_at"
        case displayName = "display_name"; case hasAvatar = "has_avatar"
    }
}

struct RelationshipsResponse: Decodable {
    let muted: [RelationshipUser]
    let restricted: [RelationshipUser]
    let blocked: [RelationshipUser]
}

struct CircleMember: Decodable, Identifiable {
    let userID: String
    let displayName: String
    let hasAvatar: Bool
    var id: String { userID }
    enum CodingKeys: String, CodingKey { case userID = "user_id"; case displayName = "display_name"; case hasAvatar = "has_avatar" }
}

struct CircleCandidate: Decodable, Identifiable {
    let userID: String
    let displayName: String
    let hasAvatar: Bool
    let inCircle: Bool
    var id: String { userID }
    enum CodingKeys: String, CodingKey {
        case userID = "user_id"; case displayName = "display_name"
        case hasAvatar = "has_avatar"; case inCircle = "in_circle"
    }
}

struct FollowRequestUser: Decodable, Identifiable {
    let userID: String
    let createdAt: String
    let displayName: String
    let bioVerseRef: String?
    let hasAvatar: Bool
    var id: String { userID }
    enum CodingKeys: String, CodingKey {
        case userID = "user_id"; case createdAt = "created_at"; case displayName = "display_name"
        case bioVerseRef = "bio_verse_ref"; case hasAvatar = "has_avatar"
    }
}

// ---- Notifications ----

/// The server stores display text inside `payload` (a JSON string column,
/// not a parsed object) -- see routes/api.js's `notify()`, which writes
/// `{message, ...extra, url}` as `JSON.stringify(payload)`. This struct
/// decodes the outer row as-is (payload stays a raw String) and parses it
/// lazily via `message`/`url`, matching the real wire shape rather than
/// assuming the server pre-parses it for the client.
struct NotificationItem: Decodable, Identifiable {
    let id: String
    let type: String
    let payload: String
    let deliveredAt: String
    let read: Int
    let url: String?

    enum CodingKeys: String, CodingKey { case id, type, payload; case deliveredAt = "delivered_at"; case read, url }

    var isRead: Bool { read != 0 }
    var message: String {
        guard let data = payload.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let m = obj["message"] as? String else { return "New activity" }
        return m
    }
}

struct NotificationsResponse: Decodable {
    let notifications: [NotificationItem]
    let unreadCount: Int
    enum CodingKeys: String, CodingKey { case notifications; case unreadCount = "unread_count" }
}

// ---- Search ----

struct SearchResultItem: Decodable, Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let hasAvatar: Bool?
    enum CodingKeys: String, CodingKey { case id, title, subtitle; case hasAvatar = "has_avatar" }
}

struct SearchResultGroup: Decodable, Identifiable {
    let type: String
    let label: String
    let items: [SearchResultItem]
    var id: String { type }
}

struct SearchResponse: Decodable {
    let q: String
    let groups: [SearchResultGroup]
    let total: Int
}

/// One personal-record row -- matches lib/records.js's METRICS shape exactly
/// (label/unit/higher come from the server, not hardcoded here, so a metric
/// added server-side shows up correctly without a client update).
struct PersonalRecord: Decodable, Identifiable {
    let activityType: String
    let metric: String
    let value: Double
    let workoutID: String
    let achievedAt: String
    let label: String
    let unit: String
    let higher: Bool
    var id: String { activityType + metric }
    enum CodingKeys: String, CodingKey {
        case activityType = "activity_type", metric, value
        case workoutID = "workout_id", achievedAt = "achieved_at", label, unit, higher
    }
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
    var announcement: String? = nil
    var announcementAt: String? = nil
}

struct GroupMemberEntry: Decodable, Identifiable {
    let userID: String
    let role: String?
    let displayName: String
    let hasAvatar: Bool
    var id: String { userID }
    var isAdmin: Bool { role == "admin" }
    enum CodingKeys: String, CodingKey {
        case userID = "user_id", role; case displayName = "display_name"; case hasAvatar = "has_avatar"
    }
}
