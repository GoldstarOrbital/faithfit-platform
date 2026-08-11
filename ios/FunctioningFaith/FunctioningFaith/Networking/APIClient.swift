import Foundation

enum APIError: LocalizedError {
    case invalidResponse
    case requestFailed(Int)
    case notSignedIn

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "The server returned an invalid response."
        case .requestFailed(let code): return "The request failed (\(code))."
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
        if useMock { return MockData.feed }
        // The web API returns a paginated envelope. Decoding the old bare array
        // made the native Home tab silently empty against the production API.
        let response: FeedResponse = try await request("/api/feed?limit=20")
        return response.posts.map(\.model)
    }

    func fetchProfile() async throws -> UserProfile {
        if useMock { return MockData.profile }
        let response: MeDTO = try await request("/api/me")
        return response.model
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

    func login(email: String, password: String) async throws -> UserProfile {
        if useMock { return MockData.profile }
        let _: AuthResponse = try await request("/api/auth/login", method: "POST", body: Credentials(email: email, password: password))
        return try await fetchProfile()
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

    func reportPost(id: UUID, reason: String) async throws {
        if useMock { return }
        let _: SafetyResponse = try await request("/api/posts/\(id.uuidString)/report", method: "POST", body: ReportBody(reason: reason))
    }

    func blockUser(id: UUID) async throws {
        if useMock { return }
        let _: SafetyResponse = try await request("/api/users/\(id.uuidString)/block", method: "POST", body: EmptyBody())
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET") async throws -> T {
        try await request(path, method: method, body: Optional<EmptyBody>.none)
    }

    private func request<T: Decodable, Body: Encodable>(_ path: String, method: String = "GET", body: Body? = nil) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.notSignedIn }
        guard (200..<300).contains(http.statusCode) else { throw APIError.requestFailed(http.statusCode) }
        return try decoder.decode(T.self, from: data)
    }
}

private struct EmptyBody: Encodable {}
private struct Credentials: Encodable { let email: String; let password: String }
private struct Registration: Encodable { let displayName: String; let email: String; let password: String; enum CodingKeys: String, CodingKey { case displayName = "display_name"; case email, password } }
private struct WorkoutStart: Encodable { let type: String }
private struct WorkoutStop: Encodable { let gpsPoints: [[Double]]; enum CodingKeys: String, CodingKey { case gpsPoints = "gps_path" } }
private struct AuthResponse: Decodable { let ok: Bool }
private struct WorkoutStartResponse: Decodable { let id: UUID }
private struct WorkoutStopResponse: Decodable { let id: UUID }

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

private struct SafetyResponse: Decodable {
    let ok: Bool
}

private struct ReportBody: Encodable {
    let reason: String
}

private struct FeedResponse: Decodable {
    let posts: [FeedDTO]
    let nextCursor: String?
    enum CodingKeys: String, CodingKey { case posts; case nextCursor = "next_cursor" }
}

private struct FeedDTO: Decodable {
    let id: UUID; let authorID: UUID?; let content: String?; let author: String; let createdAt: String
    let workoutID: UUID?; let workoutType: String?; let startTime: String?; let endTime: String?
    let calories: Int?; let avgHR: Int?; let verseReference: String?; let verseText: String?; let youVersionID: String?
    let likeCount: Int?; let likedByMe: Bool?; let savedByMe: Bool?

    enum CodingKeys: String, CodingKey { case id; case authorID = "author_id"; case content, author; case createdAt = "created_at"; case workoutID = "workout_id"; case workoutType = "workout_type"; case startTime = "start_time"; case endTime = "end_time"; case calories; case avgHR = "avg_hr"; case verseReference = "verse_reference"; case verseText = "verse_text"; case youVersionID = "youversion_id"; case likeCount = "like_count"; case likedByMe = "liked_by_me"; case savedByMe = "saved_by_me" }
    var model: FeedPost {
        let workout = workoutType.map { WorkoutSummary(id: workoutID ?? UUID(), type: $0, startTime: DateParser.parse(startTime) ?? .now, endTime: DateParser.parse(endTime), calories: calories, avgHR: avgHR) }
        let verse = verseReference.map { VerseSnippet(id: youVersionID ?? $0, reference: $0, snippet: verseText ?? "", deepLink: "https://www.bible.com/bible?query=\($0.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0)") }
        return FeedPost(id: id, authorID: authorID, authorName: author, content: content ?? "", workout: workout, verse: verse, createdAt: DateParser.parse(createdAt) ?? .now, likeCount: likeCount ?? 0, likedByMe: likedByMe ?? false, savedByMe: savedByMe ?? false)
    }
}

private struct MeDTO: Decodable {
    let user: UserDTO; let xp: XPDTO?; let badges: [BadgeDTO]
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
    static func activeWorkout(type: String) -> WorkoutSummary { WorkoutSummary(id: UUID(), type: type, startTime: .now, endTime: nil, calories: nil, avgHR: nil) }
}
