import Foundation

/// Minimal API client. `useMock` defaults to true so the skeleton runs without a live backend
/// (per acceptance criteria: "SwiftUI skeleton runs on iOS simulator and connects to mock API").
final class APIClient {
    static let shared = APIClient()
    var useMock = true
    var baseURL = URL(string: "https://api.faithfit.example")!

    func fetchFeed() async throws -> [FeedPost] {
        if useMock { return MockData.feed }
        // TODO: real network call to GET /api/social-graph/feed (or a dedicated feed aggregator)
        fatalError("Live networking not implemented in skeleton")
    }

    func fetchProfile() async throws -> UserProfile {
        if useMock { return MockData.profile }
        fatalError("Live networking not implemented in skeleton")
    }

    func startWorkout(type: String) async throws -> WorkoutSummary {
        if useMock { return MockData.activeWorkout(type: type) }
        fatalError("Live networking not implemented in skeleton")
    }
}

enum MockData {
    static let feed: [FeedPost] = [
        FeedPost(id: UUID(), authorName: "Sam T.", content: "Morning 5K done!",
                  workout: WorkoutSummary(id: UUID(), type: "Run", startTime: .now.addingTimeInterval(-3600), endTime: .now, calories: 420, avgHR: 152),
                  verse: VerseSnippet(id: "isa.40.31", reference: "Isaiah 40:31", snippet: "Those who hope in the Lord will renew their strength...", deepLink: "youversion://bible/verse/isa.40.31"),
                  createdAt: .now.addingTimeInterval(-3000)),
        FeedPost(id: UUID(), authorName: "Priya K.", content: "Rest day reflection.",
                  workout: nil,
                  verse: VerseSnippet(id: "psa.46.1", reference: "Psalm 46:1", snippet: "God is our refuge and strength...", deepLink: "youversion://bible/verse/psa.46.1"),
                  createdAt: .now.addingTimeInterval(-7200)),
    ]

    static let profile = UserProfile(id: UUID(), displayName: "Alex G.", bio: "Training body and spirit.",
        xp: 320, level: 3, badges: [Badge(id: "b-first-workout", name: "First Steps", iconURL: "star.fill")])

    static func activeWorkout(type: String) -> WorkoutSummary {
        WorkoutSummary(id: UUID(), type: type, startTime: .now, endTime: nil, calories: nil, avgHR: nil)
    }
}
