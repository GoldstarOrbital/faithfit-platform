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
    /// The real, OSM-picked church (distinct from `church`, a free-text
    /// fallback) -- set via ChurchFinderView. nil until a member selects one.
    var churchOsmID: String? = nil
    var churchName: String? = nil
    var bibleVersionID: Int? = nil
}

// ---- Bible beyond the local 22-book library: the YouVersion Platform
// covers the full canon in eleven English translations. Local text is
// still preferred where it exists; this only fills the gap -- see
// lib/youversion.js's own header. ----

struct BibleVersion: Decodable, Identifiable {
    let id: Int
    let abbreviation: String?
    let title: String?
    let deepLink: String?
    enum CodingKeys: String, CodingKey { case id, abbreviation, title, deepLink = "deep_link" }
}

struct BibleVersionsResponse: Decodable {
    let configured: Bool
    let defaultVersionID: Int
    let versions: [BibleVersion]
    enum CodingKeys: String, CodingKey {
        case configured, versions
        case defaultVersionID = "default_version_id"
    }
}

struct ResolvedPassage: Decodable {
    let reference: String
    let text: String
    let source: String
    let translation: String?
    let youversionURL: String?
    enum CodingKeys: String, CodingKey {
        case reference, text, source, translation
        case youversionURL = "youversion_url"
    }
}

// ---- Ask about a verse: Gloo-grounded Q&A that only ever cites references
// it has independently verified -- see companion.js's askAboutVerse. ----

struct AlsoCitedVerse: Decodable, Identifiable {
    let reference: String
    let text: String
    var id: String { reference }
}

struct VerseAskAnswer: Decodable {
    let reference: String
    let text: String
    let answer: String
    let also: [AlsoCitedVerse]
}

// ---- Selected church: daily devotional + this week's service, both
// resolved server-side from the member's own church_osm_id. Either can be
// nil -- most churches haven't been linked by a verified admin yet, and
// that's an honest, expected state, not an error. ----

struct ChurchDevotional: Decodable {
    let videoID: String
    let title: String?
    let thumbnailURL: String?
    let publishedAt: String?
    enum CodingKeys: String, CodingKey {
        case videoID = "video_id", title
        case thumbnailURL = "thumbnail_url", publishedAt = "published_at"
    }
}

struct ChurchWeeklyService: Decodable {
    let videoID: String
    let title: String?
    let durationSec: Int?
    let publishedAt: String?
    enum CodingKeys: String, CodingKey {
        case videoID = "video_id", title
        case durationSec = "duration_sec", publishedAt = "published_at"
    }
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

// ---- Reels: short-form video feed. Three real content sources mixed into
// one list (see routes/api.js's GET /reels): YouTube catalogue videos,
// member-uploaded video posts (own video_data, a data: URL), and church
// uploads. Played accordingly -- WKWebView embed for YouTube, AVKit for a
// member's own uploaded clip, external Safari for anything else (a
// church's arbitrary embed page isn't worth building a third player for).

struct Reel: Decodable, Identifiable {
    let videoID: String
    let title: String?
    let description: String?
    let thumbnailURL: String?
    let channelTitle: String?
    let category: String?
    let provider: String?
    let sourceURL: String?
    let sourceKind: String?
    let videoData: String?
    let verseReference: String?
    let verseText: String?
    let churchName: String?
    let likeCount: Int
    let saveCount: Int
    let likedByMe: Bool
    let savedByMe: Bool
    var id: String { videoID }

    enum CodingKeys: String, CodingKey {
        case videoID = "video_id", title, description
        case thumbnailURL = "thumbnail_url", channelTitle = "channel_title"
        case category, provider; case sourceURL = "source_url"; case sourceKind = "source_kind"
        case videoData = "video_data"; case verseReference = "verse_reference"; case verseText = "verse_text"
        case churchName = "church_name"
        case likeCount = "like_count", saveCount = "save_count"
        case likedByMe = "liked_by_me", savedByMe = "saved_by_me"
    }
}

struct ReelsFeedResponse: Decodable {
    let videos: [Reel]
    let churchName: String?
    enum CodingKeys: String, CodingKey { case videos; case churchName = "church_name" }
}

struct ReelReactionResult: Decodable {
    let kind: String
    let active: Bool
    let count: Int
}

// ---- Journeys: progress-tracking core only, no 3D world. ----
// The web app renders each journey as a real-time flythrough of a 3D scene
// (Three.js) as you move through it. That is a visualization layer on top
// of a plain, honest progress mechanic -- join, accumulate real km, unlock
// waypoints at distance marks. This port builds the actual mechanic (which
// is everything that matters for the feature to work) with a live km
// counter and progress bar instead of a rendered 3D world -- deliberately,
// not as a stopgap: 3D scene code is exactly the kind of thing that's
// hardest to verify correct by reading alone with no way to actually run
// it, and a wrong number is a worse failure than a plain UI.

struct NextWaypointPreview: Decodable {
    let title: String
    let kmMark: Double
    let kmRemaining: Double
    enum CodingKeys: String, CodingKey { case title; case kmMark = "km_mark"; case kmRemaining = "km_remaining" }
}

struct JourneySummary: Decodable, Identifiable {
    let id: String
    let key: String
    let name: String
    let world: String
    let subtitle: String?
    let totalKm: Double
    let joined: Bool
    let completed: Bool
    let progressKm: Double?
    let percent: Int?
    let nextWaypoint: NextWaypointPreview?
    let travellers: Int

    enum CodingKeys: String, CodingKey {
        case id, key, name, world, subtitle; case totalKm = "total_km"
        case joined, completed; case progressKm = "progress_km"; case percent
        case nextWaypoint = "next_waypoint"; case travellers
    }
}

struct JourneyWaypoint: Decodable, Identifiable {
    let id: String
    let kmMark: Double
    let title: String
    let narrative: String?
    let scriptureRef: String?
    let scriptureText: String?
    let unlocked: Bool
    enum CodingKeys: String, CodingKey {
        case id; case kmMark = "km_mark"; case title, narrative
        case scriptureRef = "scripture_ref"; case scriptureText = "scripture_text"; case unlocked
    }
}

struct JourneyCore: Decodable {
    let id: String
    let key: String
    let name: String
    let world: String
    let subtitle: String?
    let description: String?
    let scriptureRef: String?
    let totalKm: Double
    let terrain: String?
    enum CodingKeys: String, CodingKey {
        case id, key, name, world, subtitle, description; case scriptureRef = "scripture_ref"
        case totalKm = "total_km"; case terrain
    }
}

struct JourneyDetail: Decodable {
    let journey: JourneyCore
    let joined: Bool
    let completed: Bool
    let progressKm: Double
    let percent: Int
    let waypoints: [JourneyWaypoint]
    let nextWaypoint: NextWaypointPreview?
    enum CodingKeys: String, CodingKey {
        case journey, joined, completed; case progressKm = "progress_km"; case percent, waypoints
        case nextWaypoint = "next_waypoint"
    }
}

/// `advanceJourney`'s `crossed` list comes from a raw `SELECT * FROM
/// journey_waypoints` (lib/journeys.js) -- unlike the two GET routes, it
/// never adds an `unlocked` field, since every waypoint in this list was
/// JUST unlocked by definition. A genuinely different shape from
/// JourneyWaypoint, not a superset -- decoding it as JourneyWaypoint would
/// fail on every single live-progress response over a missing key.
struct CrossedWaypoint: Decodable, Identifiable {
    let id: String
    let kmMark: Double
    let title: String
    let narrative: String?
    let scriptureRef: String?
    let scriptureText: String?
    enum CodingKeys: String, CodingKey {
        case id; case kmMark = "km_mark"; case title, narrative
        case scriptureRef = "scripture_ref"; case scriptureText = "scripture_text"
    }
}

struct JourneyProgressResult: Decodable {
    let progressKm: Double
    let percent: Int
    let completed: Bool
    let crossed: [CrossedWaypoint]
    enum CodingKeys: String, CodingKey { case progressKm = "progress_km"; case percent, completed, crossed }
}

// ---- Athlete recruiting: discovery (search + public profile), read-only.
// Self-profile editing (videos/teams/awards/sports CRUD), coach profile
// setup, coach matching/roster/saved-searches, and CSV stat import are NOT
// ported in this pass -- each is a real sub-feature of its own, not a
// one-line addition here. This covers the actual "recruiting hub" core
// value: a coach browsing and reading real athlete profiles.

/// The 90-day training snapshot every athlete card and profile shows --
/// pulled live from real logged workouts (see lib/athletes.js's own
/// comment: "cannot be puffed up"), never self-reported.
struct AthleteRecentStats: Decodable {
    let workouts90d: Int
    let distanceKm90d: Double
    let avgHR90d: Int?
    enum CodingKeys: String, CodingKey {
        case workouts90d = "workouts_90d", distanceKm90d = "distance_km_90d", avgHR90d = "avg_hr_90d"
    }
}

struct AthleteSearchResult: Decodable, Identifiable {
    let userID: String
    let sport: String
    let position: String?
    let gradYear: Int?
    let school: String?
    let highlightURL: String?
    let bio: String?
    let displayName: String
    let hasAvatar: Bool
    let videoCount: Int
    let endorsementCount: Int
    let awardCount: Int
    let stats: AthleteRecentStats
    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id", sport, position; case gradYear = "grad_year"
        case school; case highlightURL = "highlight_url"; case bio
        case displayName = "display_name"; case hasAvatar = "has_avatar"
        case videoCount = "video_count", endorsementCount = "endorsement_count", awardCount = "award_count"
        case stats
    }
}

struct SportStatEntry: Decodable, Identifiable {
    let key: String
    let label: String
    let unit: String
    let value: String
    let source: String
    let confirmedBy: Int
    var id: String { key }
    enum CodingKeys: String, CodingKey { case key, label, unit, value, source; case confirmedBy = "confirmed_by" }
}

struct AthleteVideo: Decodable, Identifiable { let id: String; let url: String; let title: String? }
struct AthleteTeam: Decodable, Identifiable { let id: String; let teamName: String; let level: String?; let season: String?
    enum CodingKeys: String, CodingKey { case id; case teamName = "team_name"; case level, season }
}
struct AthleteAward: Decodable, Identifiable { let id: String; let title: String; let year: Int?; let issuer: String? }
struct AthleteEndorsement: Decodable, Identifiable {
    let id: String; let quote: String; let coachName: String; let coachOrganization: String?; let coachTitle: String?
    enum CodingKeys: String, CodingKey { case id, quote; case coachName = "coach_name"; case coachOrganization = "coach_organization"; case coachTitle = "coach_title" }
}

struct AthleteProfile: Decodable, Identifiable {
    let userID: String
    let sport: String
    let position: String?
    let gradYear: Int?
    let school: String?
    let heightCM: Int?
    let weightKG: Int?
    let highlightURL: String?
    let bio: String?
    let handedness: String?
    let maxprepsURL: String?
    let gamechangerURL: String?
    let displayName: String
    let hasAvatar: Bool
    let stats: AthleteRecentStats
    let sportStats: [SportStatEntry]
    let videos: [AthleteVideo]
    let teams: [AthleteTeam]
    let awards: [AthleteAward]
    let endorsements: [AthleteEndorsement]
    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id", sport, position; case gradYear = "grad_year"; case school
        case heightCM = "height_cm"; case weightKG = "weight_kg"; case highlightURL = "highlight_url"
        case bio, handedness; case maxprepsURL = "maxpreps_url"; case gamechangerURL = "gamechanger_url"
        case displayName = "display_name"; case hasAvatar = "has_avatar"; case stats
        case sportStats = "sport_stats", videos, teams, awards, endorsements
    }
}

/// Matches the server's PHOTO_CATEGORIES exactly (routes/api.js) -- shared
/// between post and story composers since both validate against the same
/// list.
enum PhotoCategory: String, CaseIterable, Identifiable {
    case workout, nature, animal, group
    var id: String { rawValue }
    var label: String {
        switch self {
        case .workout: return "Workout or gear"
        case .nature: return "Nature"
        case .animal: return "Animal"
        case .group: return "Group of people"
        }
    }
}

// ---- Stories / Moments (24h ephemeral) ----

struct Story: Decodable, Identifiable {
    let id: String
    let userID: String
    let content: String?
    let photoData: String?
    let photoCategory: String?
    let visibility: String
    let createdAt: String
    let expiresAt: String
    let author: String
    let authorHasAvatar: Bool
    let viewed: Int
    let reactionCount: Int
    let myReaction: String?

    var isViewed: Bool { viewed != 0 }

    enum CodingKeys: String, CodingKey {
        case id; case userID = "user_id"; case content
        case photoData = "photo_data"; case photoCategory = "photo_category"
        case visibility; case createdAt = "created_at"; case expiresAt = "expires_at"
        case author; case authorHasAvatar = "author_has_avatar"
        case viewed; case reactionCount = "reaction_count"; case myReaction = "my_reaction"
    }
}

struct StoryReactionResult: Decodable {
    let emoji: String?
    let reactionCount: Int
    enum CodingKeys: String, CodingKey { case emoji; case reactionCount = "reaction_count" }
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

// ---- Bible / Scripture ----
// Verse *text* only ever comes from these server-verified endpoints -- never
// authored or edited client-side. Matches the server's own hard rule against
// fabricated scripture.

struct BibleVerse: Decodable, Identifiable {
    let book: String
    let chapter: Int
    let verse: Int
    let text: String
    let translation: String?
    var id: String { reference }
    var reference: String { "\(book) \(chapter):\(verse)" }
}

struct BiblePassage: Decodable {
    let book: String
    let chapter: Int
    let translation: String?
    let verses: [BibleVerse]
}

struct BibleCoverageBook: Decodable, Identifiable {
    let book: String
    let translation: String?
    let minCh: Int
    let maxCh: Int
    let chapters: Int
    let verseCount: Int
    var id: String { book }
    enum CodingKeys: String, CodingKey {
        case book, translation
        case minCh = "min_ch", maxCh = "max_ch", chapters
        case verseCount = "verse_count"
    }
}

struct BibleCoverageResponse: Decodable {
    let totalVerses: Int
    let coverage: [BibleCoverageBook]
    enum CodingKeys: String, CodingKey {
        case totalVerses = "total_verses", coverage
    }
}

/// A member's private saved-verse library -- matches lib/verse-saves.js's
/// `list()` row shape exactly (has `id`; distinct from the lighter object
/// `toggle()` echoes back on save, which VerseSaveResponse below models).
struct SavedVerse: Decodable, Identifiable {
    let id: String
    let reference: String
    let book: String
    let chapter: Int
    let verse: Int
    let text: String
    let translation: String?
    let createdAt: String?
    enum CodingKeys: String, CodingKey {
        case id, reference, book, chapter, verse, text, translation
        case createdAt = "created_at"
    }
}

struct SavedVersesResponse: Decodable { let verses: [SavedVerse] }

struct VerseSaveResponse: Decodable {
    let saved: Bool
    let reference: String
}

// ---- Scripture practice: a private, seven-day reading plan (not a streak,
// ranking, or social score -- see lib/scripture-practice.js's own comment). ----

/// The verse shape returned inside a practice day differs from BibleVerse
/// (flat `reference` rather than book/chapter/verse), so it gets its own
/// small type rather than a shared one with fields that don't apply.
struct PracticeVerse: Decodable {
    let reference: String
    let text: String
    let translation: String?
}

struct ScripturePracticeDay: Decodable, Identifiable {
    let number: Int
    let focus: String
    let prompt: String
    let verse: PracticeVerse?
    let completed: Bool
    let completedAt: String?
    let note: String
    let available: Bool
    let next: Bool
    var id: Int { number }
    enum CodingKeys: String, CodingKey {
        case number, focus, prompt, verse, completed, note, available, next
        case completedAt = "completed_at"
    }
}

struct ScripturePracticePlan: Decodable {
    let key: String
    let title: String
    let subtitle: String
    let totalDays: Int
    enum CodingKeys: String, CodingKey {
        case key, title, subtitle
        case totalDays = "total_days"
    }
}

struct ScripturePracticeState: Decodable {
    let plan: ScripturePracticePlan
    let started: Bool
    let startedOn: String?
    let complete: Bool
    let currentDay: Int?
    let nextDay: Int?
    let days: [ScripturePracticeDay]
    enum CodingKeys: String, CodingKey {
        case plan, started, complete, days
        case startedOn = "started_on"
        case currentDay = "current_day"
        case nextDay = "next_day"
    }
}

/// Wraps a practice mutation's result -- start/complete/note-update all
/// return either the fresh state or a typed error (invalid day, not
/// started yet, day not available). Errors already carry a server `hint`
/// via APIError.requestFailed, so no separate error type is needed here.
struct ScripturePracticeResult: Decodable {
    let practice: ScripturePracticeState
}

// ---- Verse threads: scripture as conversation, not broadcast ----

struct VerseThread: Decodable, Identifiable {
    let id: String
    let reference: String
    let book: String
    let chapter: Int
    let verse: Int
    let openedBy: String
    let openedByName: String?
    let prompt: String?
    let createdAt: String
    enum CodingKeys: String, CodingKey {
        case id, reference, book, chapter, verse, prompt
        case openedBy = "opened_by", openedByName = "opened_by_name"
        case createdAt = "created_at"
    }
}

/// One level of nesting only, enforced server-side (a reply to a reply
/// attaches to the top-level parent instead) -- `replies` is always flat.
struct VerseReflection: Decodable, Identifiable {
    let id: String
    let parentID: String?
    let content: String
    let createdAt: String
    let userID: String
    let author: String
    let hasAvatar: Bool?
    var likeCount: Int
    var likedByMe: Bool
    var replies: [VerseReflection]
    enum CodingKeys: String, CodingKey {
        case id, content, author, replies
        case parentID = "parent_id", createdAt = "created_at", userID = "user_id"
        case hasAvatar = "has_avatar", likeCount = "like_count", likedByMe = "liked_by_me"
    }
}

struct VerseThreadResponse: Decodable {
    let thread: VerseThread?
    let verse: BibleVerse
    let reflections: [VerseReflection]
}

struct OpenVerseThreadResponse: Decodable {
    let thread: VerseThread
    let verse: BibleVerse
    let created: Bool
}

struct ReflectionLikeResponse: Decodable {
    let liked: Bool
    let likeCount: Int
    enum CodingKeys: String, CodingKey { case liked; case likeCount = "like_count" }
}

// ---- Podcasts: real independent Christian shows, ingested from each show's
// public RSS feed server-side. No fabricated episodes or hosts. ----

struct PodcastEpisode: Decodable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let audioURL: String?
    let link: String?
    let durationSec: Int?
    let publishedAt: String?
    enum CodingKeys: String, CodingKey {
        case id, title, description, link
        case audioURL = "audio_url"
        case durationSec = "duration_sec"
        case publishedAt = "published_at"
    }
}

struct Podcast: Decodable, Identifiable {
    let id: String
    let title: String
    let host: String?
    let description: String?
    let theme: String?
    let artworkURL: String?
    let episodes: [PodcastEpisode]
    enum CodingKeys: String, CodingKey {
        case id, title, host, description, theme, episodes
        case artworkURL = "artwork_url"
    }
}

// ---- Church discovery: real, free OpenStreetMap Overpass data -- an unnamed
// node is never shown as a church, per lib/overpass.js. ----

struct NearbyChurch: Decodable, Identifiable {
    let osmID: String
    let name: String
    let lat: Double
    let lng: Double
    let address: String?
    var id: String { osmID }
    enum CodingKeys: String, CodingKey {
        case osmID = "osm_id", name, lat, lng, address
    }
}

// ---- Breathwork: real, named techniques with a physiological rationale --
// see lib/breathwork.js's own header. Scripture is always resolved from the
// verified table server-side, never authored here. ----

struct BreathingPhase: Decodable {
    let label: String
    let sec: Double
    let kind: String
}

struct BreathingPattern: Decodable, Identifiable {
    let key: String
    let name: String
    let tagline: String
    let about: String
    let phases: [BreathingPhase]
    let cycleSec: Double
    let breathsPerMin: Double
    let defaultMinutes: Int
    let scriptureRef: String?
    let scriptureText: String?
    var id: String { key }
    enum CodingKeys: String, CodingKey {
        case key, name, tagline, about, phases
        case cycleSec = "cycle_sec", breathsPerMin = "breaths_per_min"
        case defaultMinutes = "default_minutes"
        case scriptureRef = "scripture_ref", scriptureText = "scripture_text"
    }
}

struct BreathingVerseResult: Decodable {
    let reference: String
    let text: String
}

// ---- Heart-rate check-in: a measurement, reported plainly, never an
// interpretation of how the member feels -- see lib/contexts.js's own
// header for why. Only ever produced from a real HealthKit reading. ----

struct SuggestedBreathingPattern: Decodable {
    let key: String
    let name: String
    let tagline: String
    let minutes: Int
}

struct HeartCheckInResult: Decodable {
    let context: String?
    let status: String
    let label: String?
    let blurb: String?
    let measured: Bool
    let reason: String?
    let hr: Int?
    let restingHr: Int?
    let aboveResting: Int?
    let missing: String?
    let hint: String?
    let verse: BreathingVerseResult?
    let suggestedPattern: SuggestedBreathingPattern?
    enum CodingKeys: String, CodingKey {
        case context, status, label, blurb, measured, reason, hr
        case restingHr = "resting_hr", aboveResting = "above_resting"
        case missing, hint, verse
        case suggestedPattern = "suggested_pattern"
    }
}

// ---- Custom reminders: a member-created title/body/schedule, distinct from
// the generic push-category toggles already in ProfileView. ----

struct UserReminder: Decodable, Identifiable {
    let id: String
    let title: String
    let body: String
    let scheduledAt: String
    let repeatRule: String
    // SQLite has no boolean type -- this column round-trips as a JSON 0/1
    // integer, not true/false, so it's modeled as Int rather than risking a
    // Bool decode failure against real data.
    let enabled: Int
    let lastSentAt: String?
    var isEnabled: Bool { enabled != 0 }
    enum CodingKeys: String, CodingKey {
        case id, title, body, enabled
        case scheduledAt = "scheduled_at", repeatRule = "repeat_rule"
        case lastSentAt = "last_sent_at"
    }
}

// ---- Connected data connectors (Strava, etc.) -- real wearable/GPS-watch
// activity sync, same shape as the already-native Apple Health connection. ----

struct StravaSyncResult: Decodable {
    let imported: Int
    let checked: Int
}

struct ConnectedAccount: Decodable, Identifiable {
    let provider: String
    let scope: String?
    let connectedAt: String?
    let lastSyncedAt: String?
    var id: String { provider }
    enum CodingKeys: String, CodingKey {
        case provider, scope, connectedAt = "connected_at", lastSyncedAt = "last_synced_at"
    }
}

// ---- Journey segments, leaderboards and ghosts: the stretch between two
// waypoints, timed, ranked against every rider's own best. Ghosts are built
// only from rides that actually happened -- see lib/segments.js's header. ----

struct SegmentLeaderboardEntry: Decodable, Identifiable {
    let position: Int
    let userID: String
    let displayName: String
    let bestSec: Double
    let measured: Bool
    var id: String { userID }
    enum CodingKeys: String, CodingKey {
        case position, measured
        case userID = "user_id", displayName = "display_name", bestSec = "best_sec"
    }
}

struct JourneySegmentBoundary: Decodable, Identifiable {
    let index: Int
    let fromKm: Double
    let toKm: Double
    let from: String
    let to: String
    let leaderboard: [SegmentLeaderboardEntry]
    let yourBestSec: Double?
    var id: Int { index }
    enum CodingKeys: String, CodingKey {
        case index, from, to, leaderboard
        case fromKm = "from_km", toKm = "to_km", yourBestSec = "your_best_sec"
    }
}

struct SegmentCompletionResult: Decodable {
    let segmentIndex: Int
    let durationSec: Double
    let personalBest: Bool
    let previousBestSec: Double?
    let rank: Int
    enum CodingKeys: String, CodingKey {
        case rank
        case segmentIndex = "segment_index", durationSec = "duration_sec"
        case personalBest = "personal_best", previousBestSec = "previous_best_sec"
    }
}

struct GhostSegment: Decodable {
    let index: Int
    let durationSec: Double
    enum CodingKeys: String, CodingKey { case index, durationSec = "duration_sec" }
}

struct JourneyGhost: Decodable, Identifiable {
    let userID: String
    let displayName: String
    let isSelf: Bool?
    let totalSec: Double
    let segments: [GhostSegment]
    var id: String { userID }
    enum CodingKeys: String, CodingKey {
        case userID = "user_id", displayName = "display_name"
        case isSelf = "is_self", totalSec = "total_sec", segments
    }
}

struct JourneyGhostsResponse: Decodable {
    let ghosts: [JourneyGhost]
    let note: String?
}

// ---- Christian news: real headlines from each outlet's public RSS feed,
// summary only, never the full copyrighted article -- see lib/news.js. ----

struct NewsItem: Decodable, Identifiable {
    let id: String
    let source: String
    let title: String
    let summary: String?
    let link: String
    let imageURL: String?
    let publishedAt: String?
    enum CodingKeys: String, CodingKey {
        case id, source, title, summary, link
        case imageURL = "image_url", publishedAt = "published_at"
    }
}

struct NewsResponse: Decodable {
    let items: [NewsItem]
    let sources: [String]
    let disabled: Bool?
}

// ---- Curated video library: real YouTube channels by category, distinct
// from Reels' short-form feed. ----

struct VideoItem: Decodable, Identifiable {
    let videoID: String
    let title: String
    let description: String?
    let thumbnailURL: String?
    let channelTitle: String?
    let publishedAt: String?
    var id: String { videoID }
    enum CodingKeys: String, CodingKey {
        case videoID = "video_id", title, description
        case thumbnailURL = "thumbnail_url", channelTitle = "channel_title"
        case publishedAt = "published_at"
    }
}

/// Discovery surface -- which verses people are actually talking about.
struct DiscussedVerse: Decodable, Identifiable {
    let id: String
    let reference: String
    let book: String
    let chapter: Int
    let verse: Int
    let prompt: String?
    let reflectionCount: Int
    let lastActivity: String
    let text: String?
    enum CodingKeys: String, CodingKey {
        case id, reference, book, chapter, verse, prompt, text
        case reflectionCount = "reflection_count", lastActivity = "last_activity"
    }
}
