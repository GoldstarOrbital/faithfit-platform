import Foundation

enum APIError: LocalizedError {
    case invalidResponse
    case requestFailed(Int, String?)
    case notSignedIn

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "The server returned an invalid response."
        case .requestFailed(let code, let message): return message ?? "The request failed (\(code))."
        case .notSignedIn: return "Please sign in to continue."
        }
    }
}

/// Cookie-backed client shared by the native screens. The web backend already
/// uses an HttpOnly session cookie, so URLSession keeps the native sign-in and
/// API calls on the same authenticated session without inventing a second token
/// format. Mock mode remains available for previews and offline UI review.
final class APIClient {
    static let shared = APIClient()

#if DEBUG
    var useMock = true
#else
    var useMock = false
#endif

    var baseURL = URL(string: "https://faithfit-demo-production.up.railway.app")!
    private let session = URLSession.shared
    private let decoder: JSONDecoder

    private init() {
        decoder = JSONDecoder()
    }

    func fetchFeed() async throws -> [FeedPost] {
        let page = try await fetchFeedPage()
        return page.posts
    }

    func fetchFeedPage(before: String? = nil) async throws -> FeedPage {
        if useMock { return FeedPage(posts: MockData.feed, nextCursor: nil) }
        // The production feed is a cursor-paginated envelope. Keep the cursor
        // on the client so native scrolling never reloads already-rendered rows.
        var path = "/api/feed?limit=20"
        if let before, let encoded = before.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "&before=\(encoded)"
        }
        let response: FeedResponse = try await request(path)
        return FeedPage(posts: response.posts.map(\.model), nextCursor: response.nextCursor)
    }

    func fetchProfile() async throws -> UserProfile {
        (try await fetchSessionState()).profile
    }

    func fetchSessionState() async throws -> NativeSessionState {
        if useMock { return NativeSessionState(profile: MockData.profile, accountSetupRequired: false) }
        let response: MeDTO = try await request("/api/me")
        return NativeSessionState(profile: response.model, accountSetupRequired: response.accountSetupRequired ?? false)
    }

    func fetchAuthProviders() async throws -> [NativeAuthProvider] {
        if useMock { return [NativeAuthProvider(name: "google", label: "Google"), NativeAuthProvider(name: "apple", label: "Apple")] }
        let response: AuthProvidersResponse = try await request("/api/auth/providers")
        return response.providers
    }

    func fetchSuggestedUsers() async throws -> [SuggestedUser] {
        if useMock { return [] }
        let response: [SuggestedUserDTO] = try await request("/api/users/suggested")
        return response.map(\.model)
    }

    func followUser(id: UUID) async throws -> FollowResponse {
        if useMock { return FollowResponse(following: true, followersCount: 1) }
        return try await request("/api/users/\(id.uuidString)/follow", method: "POST", body: EmptyBody())
    }

    func fetchExploreContent() async throws -> ExploreContent {
        if useMock { return MockData.exploreContent }
        async let catalog: ExploreResponse = request("/api/explore")
        async let challenges: [ExploreChallenge] = request("/api/challenges")
        let (base, liveChallenges) = try await (catalog, challenges)
        return ExploreContent(groups: base.groups, quests: base.quests, challenges: liveChallenges)
    }

    func joinChallenge(id: String) async throws {
        if useMock { return }
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        let _: ActionResponse = try await request("/api/challenges/\(encoded)/join", method: "POST", body: EmptyBody())
    }

    func fetchGroupDetail(id: String) async throws -> NativeGroupDetail {
        if useMock { return MockData.groupDetail }
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        let response: GroupDetailResponse = try await request("/api/groups/\(encoded)")
        return response.model
    }

    func setGroupMembership(id: String, joining: Bool) async throws {
        if useMock { return }
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        let action = joining ? "join" : "leave"
        let _: ActionResponse = try await request("/api/groups/\(encoded)/\(action)", method: "POST", body: EmptyBody())
    }

    func sendGroupMessage(groupID: String, content: String) async throws -> GroupMessage {
        if useMock {
            return GroupMessage(id: UUID().uuidString, content: content, createdAt: ISO8601DateFormatter().string(from: .now), authorID: MockData.profile.id.uuidString, author: MockData.profile.displayName)
        }
        guard let encoded = groupID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        return try await request("/api/groups/\(encoded)/messages", method: "POST", body: GroupMessageBody(content: content))
    }

    func fetchGroupPulse(groupID: String) async throws -> GroupPulse {
        if useMock { return MockData.groupPulse }
        guard let encoded = groupID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        return try await request("/api/groups/\(encoded)/pulse")
    }

    func updateGroupPulse(groupID: String, kind: String, note: String, day: String) async throws -> GroupPulseCheckin {
        if useMock { return MockData.groupPulse.checkins[0] }
        guard let encoded = groupID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        return try await request(
            "/api/groups/\(encoded)/pulse",
            method: "POST",
            body: GroupPulseBody(kind: kind, note: note, day: day)
        )
    }

    func encourageGroupPulse(groupID: String, checkinID: String) async throws -> PulseEncouragementResponse {
        if useMock { return PulseEncouragementResponse(encouraged: true, encouragementCount: 2) }
        guard let group = groupID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let checkin = checkinID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        return try await request("/api/groups/\(group)/pulse/\(checkin)/encourage", method: "POST", body: EmptyBody())
    }

    func login(email: String, password: String) async throws -> NativeLoginOutcome {
        if useMock { return .authenticated(NativeSessionState(profile: MockData.profile, accountSetupRequired: false)) }
        let response: AuthResponse = try await request("/api/auth/login", method: "POST", body: Credentials(email: email, password: password))
        if response.mfaRequired == true { return .mfaRequired }
        return .authenticated(try await fetchSessionState())
    }

    func completeMfa(code: String) async throws -> NativeSessionState {
        if useMock { return NativeSessionState(profile: MockData.profile, accountSetupRequired: false) }
        let _: AuthResponse = try await request("/api/auth/mfa/complete", method: "POST", body: MfaBody(code: code))
        return try await fetchSessionState()
    }

    func exchangeNativeOAuth(code: String, handoffVerifier: String) async throws -> NativeSessionState {
        if useMock { return NativeSessionState(profile: MockData.profile, accountSetupRequired: false) }
        let response: NativeOAuthExchangeResponse = try await request(
            "/api/auth/native/exchange",
            method: "POST",
            body: NativeOAuthExchangeBody(code: code, handoffVerifier: handoffVerifier)
        )
        let state = try await fetchSessionState()
        return NativeSessionState(profile: state.profile, accountSetupRequired: response.accountSetupRequired)
    }

    func signInWithApple(identityToken: String, nonce: String, displayName: String?) async throws -> NativeLoginOutcome {
        if useMock { return .authenticated(NativeSessionState(profile: MockData.profile, accountSetupRequired: false)) }
        let response: NativeAppleAuthResponse = try await request(
            "/api/auth/native/apple",
            method: "POST",
            body: NativeAppleAuthBody(identityToken: identityToken, nonce: nonce, displayName: displayName)
        )
        if response.mfaRequired == true { return .mfaRequired }
        let state = try await fetchSessionState()
        return .authenticated(NativeSessionState(
            profile: state.profile,
            accountSetupRequired: response.accountSetupRequired ?? state.accountSetupRequired
        ))
    }

    func register(name: String, email: String, password: String) async throws -> UserProfile {
        if useMock { return MockData.profile }
        let _: AuthResponse = try await request("/api/auth/register", method: "POST", body: Registration(displayName: name, email: email, password: password))
        return try await fetchProfile()
    }

    func logout() async throws {
        guard !useMock else { return }
        let _: AuthResponse = try await request("/api/auth/logout", method: "POST", body: EmptyBody())
    }

    func startWorkout(type: String) async throws -> WorkoutSummary {
        if useMock { return MockData.activeWorkout(type: type) }
        let response: WorkoutStartResponse = try await request("/api/workouts/start", method: "POST", body: WorkoutStart(type: type))
        return WorkoutSummary(id: response.id, type: type, startTime: .now, endTime: nil, calories: nil, avgHR: nil)
    }

    func stopWorkout(id: UUID, gpsPoints: [[Double]]) async throws {
        if useMock { return }
        let _: WorkoutStopResponse = try await request("/api/workouts/\(id.uuidString)/stop", method: "POST", body: WorkoutStop(gpsPoints: gpsPoints))
    }

    func deleteAccount() async throws {
        if useMock { return }
        let _: AuthResponse = try await request("/api/me", method: "DELETE")
    }

    func likePost(id: UUID) async throws -> PostReactionResponse {
        if useMock { return PostReactionResponse(liked: true, likeCount: 1) }
        return try await request("/api/posts/\(id.uuidString)/like", method: "POST", body: EmptyBody())
    }

    func savePost(id: UUID) async throws -> PostSaveResponse {
        if useMock { return PostSaveResponse(saved: true) }
        return try await request("/api/posts/\(id.uuidString)/save", method: "POST", body: EmptyBody())
    }

    func fetchComments(postID: UUID) async throws -> [FeedComment] {
        if useMock { return [] }
        let response: CommentListResponse = try await request("/api/posts/\(postID.uuidString)/comments")
        return response.comments.map(\.model)
    }

    func addComment(postID: UUID, content: String) async throws -> FeedComment {
        if useMock {
            return FeedComment(id: UUID(), content: content, author: MockData.profile.displayName, createdAt: ISO8601DateFormatter().string(from: .now), likeCount: 0, likedByMe: false)
        }
        let response: CommentDTO = try await request("/api/posts/\(postID.uuidString)/comments", method: "POST", body: CommentBody(content: content))
        return response.model
    }

    func likeComment(id: UUID) async throws -> CommentReactionResponse {
        if useMock { return CommentReactionResponse(liked: true, likeCount: 1) }
        return try await request("/api/comments/\(id.uuidString)/like", method: "POST", body: EmptyBody())
    }

    func createPost(content: String, visibility: String, photoData: String?, photoCategory: String?) async throws -> CreatedPostResponse {
        if useMock { return CreatedPostResponse(id: UUID(), visibility: visibility, shareURL: nil) }
        return try await request(
            "/api/posts",
            method: "POST",
            body: CreatePostBody(content: content, visibility: visibility, photoData: photoData, photoCategory: photoCategory)
        )
    }

    func reportPost(id: UUID, reason: String) async throws {
        if useMock { return }
        let _: ActionResponse = try await request("/api/posts/\(id.uuidString)/report", method: "POST", body: ReportBody(reason: reason))
    }

    func blockUser(id: UUID) async throws {
        if useMock { return }
        let _: ActionResponse = try await request("/api/users/\(id.uuidString)/block", method: "POST", body: EmptyBody())
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET") async throws -> T {
        try await request(path, method: method, body: Optional<EmptyBody>.none)
    }

    private func request<T: Decodable, Body: Encodable>(_ path: String, method: String = "GET", body: Body? = nil) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("ios-native-v1", forHTTPHeaderField: "X-Functioning-Faith-Client")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.notSignedIn }
        guard (200..<300).contains(http.statusCode) else {
            let details = try? decoder.decode(APIErrorResponse.self, from: data)
            let message = details?.hint ?? details?.error?.replacingOccurrences(of: "_", with: " ").capitalized
            throw APIError.requestFailed(http.statusCode, message)
        }
        return try decoder.decode(T.self, from: data)
    }
}

private struct EmptyBody: Encodable {}
private struct APIErrorResponse: Decodable { let error: String?; let hint: String? }
private struct Credentials: Encodable { let email: String; let password: String }
private struct MfaBody: Encodable { let code: String }
private struct NativeOAuthExchangeBody: Encodable {
    let code: String
    let handoffVerifier: String
    enum CodingKeys: String, CodingKey { case code; case handoffVerifier = "handoff_verifier" }
}
private struct NativeAppleAuthBody: Encodable {
    let identityToken: String
    let nonce: String
    let displayName: String?
    enum CodingKeys: String, CodingKey {
        case identityToken = "identity_token"
        case nonce
        case displayName = "display_name"
    }
}
private struct Registration: Encodable { let displayName: String; let email: String; let password: String; enum CodingKeys: String, CodingKey { case displayName = "display_name"; case email, password } }
private struct WorkoutStart: Encodable { let type: String }
private struct GroupPulseBody: Encodable { let kind: String; let note: String; let day: String }
private struct WorkoutStop: Encodable { let gpsPoints: [[Double]]; enum CodingKeys: String, CodingKey { case gpsPoints = "gps_path" } }
private struct AuthResponse: Decodable {
    let ok: Bool?
    let mfaRequired: Bool?
    enum CodingKeys: String, CodingKey { case ok; case mfaRequired = "mfa_required" }
}
private struct AuthProvidersResponse: Decodable { let providers: [NativeAuthProvider] }
private struct NativeOAuthExchangeResponse: Decodable {
    let accountSetupRequired: Bool
    enum CodingKeys: String, CodingKey { case accountSetupRequired = "account_setup_required" }
}
private struct NativeAppleAuthResponse: Decodable {
    let accountSetupRequired: Bool?
    let mfaRequired: Bool?
    enum CodingKeys: String, CodingKey {
        case accountSetupRequired = "account_setup_required"
        case mfaRequired = "mfa_required"
    }
}
private struct WorkoutStartResponse: Decodable { let id: UUID }
private struct WorkoutStopResponse: Decodable { let id: UUID }

struct PulseEncouragementResponse: Decodable {
    let encouraged: Bool
    let encouragementCount: Int
    enum CodingKeys: String, CodingKey { case encouraged; case encouragementCount = "encouragement_count" }
}

struct PostReactionResponse: Decodable {
    let liked: Bool
    let likeCount: Int

    enum CodingKeys: String, CodingKey {
        case liked
        case likeCount = "like_count"
    }
}

struct PostSaveResponse: Decodable {
    let saved: Bool
}

struct FollowResponse: Decodable {
    let following: Bool
    let followersCount: Int

    enum CodingKeys: String, CodingKey {
        case following
        case followersCount = "followers_count"
    }
}

struct CommentReactionResponse: Decodable {
    let liked: Bool
    let likeCount: Int

    enum CodingKeys: String, CodingKey {
        case liked
        case likeCount = "like_count"
    }
}

struct CreatedPostResponse: Decodable {
    let id: UUID
    let visibility: String
    let shareURL: String?

    enum CodingKeys: String, CodingKey {
        case id, visibility
        case shareURL = "share_url"
    }
}

private struct ActionResponse: Decodable {
    let ok: Bool
}

private struct ReportBody: Encodable {
    let reason: String
}

private struct GroupMessageBody: Encodable {
    let content: String
}

private struct CommentBody: Encodable {
    let content: String
}

private struct CreatePostBody: Encodable {
    let content: String
    let visibility: String
    let photoData: String?
    let photoCategory: String?

    enum CodingKeys: String, CodingKey {
        case content, visibility
        case photoData = "photo_data"
        case photoCategory = "photo_category"
    }
}

private struct FeedResponse: Decodable {
    let posts: [FeedDTO]
    let nextCursor: String?
    enum CodingKeys: String, CodingKey { case posts; case nextCursor = "next_cursor" }
}

private struct CommentListResponse: Decodable {
    let comments: [CommentDTO]
}

private struct CommentDTO: Decodable {
    let id: UUID
    let content: String
    let author: String
    let createdAt: String
    let likeCount: Int?
    let likedByMe: Bool?

    enum CodingKeys: String, CodingKey {
        case id, content, author
        case createdAt = "created_at"
        case likeCount = "like_count"
        case likedByMe = "liked_by_me"
    }

    var model: FeedComment {
        FeedComment(id: id, content: content, author: author, createdAt: createdAt, likeCount: likeCount ?? 0, likedByMe: likedByMe ?? false)
    }
}

private struct ExploreResponse: Decodable {
    let groups: [ExploreGroup]
    let quests: [ExploreQuest]
}

private struct GroupDetailResponse: Decodable {
    let group: GroupCoreDTO
    let memberCount: Int
    let isMember: Bool
    let isAdmin: Bool
    let messages: [GroupMessage]
    let events: [GroupEvent]

    enum CodingKeys: String, CodingKey {
        case group, messages, events
        case memberCount = "member_count"
        case isMember = "is_member"
        case isAdmin = "is_admin"
    }

    var model: NativeGroupDetail {
        NativeGroupDetail(
            group: group.model(memberCount: memberCount),
            memberCount: memberCount,
            isMember: isMember,
            isAdmin: isAdmin,
            messages: messages,
            events: events
        )
    }
}

private struct GroupCoreDTO: Decodable {
    let id: String
    let name: String
    let description: String?
    let username: String?
    let churchName: String?
    let locationName: String?
    let sport: String?

    enum CodingKeys: String, CodingKey {
        case id, name, description, username, sport
        case churchName = "church_name"
        case locationName = "location_name"
    }

    func model(memberCount: Int) -> ExploreGroup {
        ExploreGroup(id: id, name: name, description: description, username: username, churchName: churchName, locationName: locationName, sport: sport, memberCount: memberCount)
    }
}

struct FeedPage {
    let posts: [FeedPost]
    let nextCursor: String?
}

private struct FeedDTO: Decodable {
    let id: UUID; let authorID: UUID?; let content: String?; let author: String; let createdAt: String
    let workoutID: UUID?; let workoutType: String?; let startTime: String?; let endTime: String?
    let calories: Int?; let avgHR: Int?; let verseReference: String?; let verseText: String?; let youVersionID: String?
    let likeCount: Int?; let likedByMe: Bool?; let savedByMe: Bool?; let commentCount: Int?
    let photoData: String?; let photoCategory: String?

    enum CodingKeys: String, CodingKey { case id; case authorID = "author_id"; case content, author; case createdAt = "created_at"; case workoutID = "workout_id"; case workoutType = "workout_type"; case startTime = "start_time"; case endTime = "end_time"; case calories; case avgHR = "avg_hr"; case verseReference = "verse_reference"; case verseText = "verse_text"; case youVersionID = "youversion_id"; case likeCount = "like_count"; case likedByMe = "liked_by_me"; case savedByMe = "saved_by_me"; case commentCount = "comment_count"; case photoData = "photo_data"; case photoCategory = "photo_category" }
    var model: FeedPost {
        let workout = workoutType.map { WorkoutSummary(id: workoutID ?? UUID(), type: $0, startTime: DateParser.parse(startTime) ?? .now, endTime: DateParser.parse(endTime), calories: calories, avgHR: avgHR) }
        let verse = verseReference.map { VerseSnippet(id: youVersionID ?? $0, reference: $0, snippet: verseText ?? "", deepLink: "https://www.bible.com/bible?query=\($0.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0)") }
        return FeedPost(id: id, authorID: authorID, authorName: author, content: content ?? "", workout: workout, verse: verse, createdAt: DateParser.parse(createdAt) ?? .now, photoData: photoData, photoCategory: photoCategory, likeCount: likeCount ?? 0, likedByMe: likedByMe ?? false, savedByMe: savedByMe ?? false, commentCount: commentCount ?? 0)
    }
}

private struct MeDTO: Decodable {
    let user: UserDTO; let xp: XPDTO?; let badges: [BadgeDTO]; let accountSetupRequired: Bool?
    enum CodingKeys: String, CodingKey { case user, xp, badges; case accountSetupRequired = "account_setup_required" }
    var model: UserProfile { UserProfile(id: user.id, displayName: user.displayName, bio: user.bioVerseRef, xp: xp?.xp ?? 0, level: xp?.level ?? 1, badges: badges.map { Badge(id: $0.id, name: $0.name, iconURL: $0.icon) }) }
}
private struct UserDTO: Decodable { let id: UUID; let displayName: String; let bioVerseRef: String?; enum CodingKeys: String, CodingKey { case id; case displayName = "display_name"; case bioVerseRef = "bio_verse_ref" } }
private struct XPDTO: Decodable { let xp: Int; let level: Int }
private struct BadgeDTO: Decodable { let id: String; let name: String; let icon: String }
private struct SuggestedUserDTO: Decodable {
    let id: UUID
    let displayName: String
    let bioVerseRef: String?
    let followersCount: Int
    let reason: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case bioVerseRef = "bio_verse_ref"
        case followersCount = "followers_count"
        case reason
    }

    var model: SuggestedUser {
        SuggestedUser(id: id, displayName: displayName, bio: bioVerseRef, followersCount: followersCount, reason: reason)
    }
}

private enum DateParser {
    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        if let date = ISO8601DateFormatter().date(from: value) { return date }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter.date(from: value)
    }
}

enum MockData {
    static let feed: [FeedPost] = [
        FeedPost(id: UUID(), authorName: "Sam T.", content: "Morning 5K done!", workout: WorkoutSummary(id: UUID(), type: "Run", startTime: .now.addingTimeInterval(-3600), endTime: .now, calories: 420, avgHR: 152), verse: VerseSnippet(id: "isa.40.31", reference: "Isaiah 40:31", snippet: "Those who hope in the Lord will renew their strength...", deepLink: "youversion://bible/verse/isa.40.31"), createdAt: .now.addingTimeInterval(-3000)),
        FeedPost(id: UUID(), authorName: "Priya K.", content: "Rest day reflection.", workout: nil, verse: VerseSnippet(id: "psa.46.1", reference: "Psalm 46:1", snippet: "God is our refuge and strength...", deepLink: "youversion://bible/verse/psa.46.1"), createdAt: .now.addingTimeInterval(-7200)),
    ]
    static let profile = UserProfile(id: UUID(), displayName: "Alex G.", bio: "Training body and spirit.", xp: 320, level: 3, badges: [Badge(id: "b-first-workout", name: "First Steps", iconURL: "star.fill")])
    static let exploreContent = ExploreContent(
        groups: [ExploreGroup(id: "group-preview", name: "Sunrise 5K Fellowship", description: "Early runs and spiritual reflection.", username: "sunrise-5k", churchName: nil, locationName: nil, sport: "Running", memberCount: 12)],
        quests: [ExploreQuest(id: "quest-preview", name: "Faithful Five", description: "Complete five workouts this week.", theme: "perseverance", target: 5)],
        challenges: [ExploreChallenge(id: "challenge-preview", name: "First Steps", description: "Complete three workouts.", flavor: "Do not despise small beginnings.", scriptureReference: "Zechariah 4:10", metric: "workouts", target: 3, theme: "beginning", progress: 1, participants: 24, joined: true, percent: 33, completed: false)]
    )
    static let groupDetail = NativeGroupDetail(
        group: exploreContent.groups[0],
        memberCount: exploreContent.groups[0].memberCount,
        isMember: true,
        isAdmin: false,
        messages: [GroupMessage(id: "message-preview", content: "See everyone at sunrise!", createdAt: "2026-08-11 06:00:00", authorID: "preview-author", author: "Sam T.")],
        events: [GroupEvent(id: "event-preview", title: "Saturday 5K", description: "Easy community run.", activityType: "Run", eventTime: "2026-08-15 07:00:00", locationName: "River Trail", goingCount: 8, interestedCount: 3, myRSVP: "going")]
    )
    static let groupPulse = GroupPulse(
        day: "2026-08-11",
        todayCount: 2,
        mine: nil,
        checkins: [GroupPulseCheckin(id: "pulse-preview", groupID: "group-preview", userID: "preview-author", day: "2026-08-11", kind: "moved", note: "Easy miles before work.", author: "Sam T.", verseReference: "Isaiah 40:31", verseText: "Those who wait for Yahweh will renew their strength.", encouragementCount: 1, encouragedByMe: false)]
    )
    static func activeWorkout(type: String) -> WorkoutSummary { WorkoutSummary(id: UUID(), type: type, startTime: .now, endTime: nil, calories: nil, avgHR: nil) }
}
