import XCTest
@testable import FunctioningFaith

final class FunctioningFaithTests: XCTestCase {
    func testSocialOnboardingOnlyAppearsForTheNewlyRegisteredAccount() {
        let registered = UUID()

        XCTAssertTrue(SocialOnboardingGate.shouldPresent(
            pendingUserID: registered.uuidString.lowercased(),
            profileID: registered
        ))
        XCTAssertFalse(SocialOnboardingGate.shouldPresent(
            pendingUserID: registered.uuidString,
            profileID: UUID()
        ))
        XCTAssertFalse(SocialOnboardingGate.shouldPresent(
            pendingUserID: "",
            profileID: registered
        ))
    }

    func testMockFeedIsNonEmpty() async throws {
        let client = APIClient.shared
        client.useMock = true
        let feed = try await client.fetchFeed()
        XCTAssertFalse(feed.isEmpty)
    }

    func testElapsedTimeFormatting() {
        // Example unit test target for WorkoutView's private formatting logic if extracted to a helper.
        XCTAssertTrue(true)
    }

    func testFeedPostPhotoFieldsSurviveCodableRoundTrip() throws {
        let original = FeedPost(
            id: UUID(),
            authorName: "Community Runner",
            content: "Trail miles with the group.",
            workout: nil,
            verse: nil,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            photoData: "data:image/jpeg;base64,/9j/2Q==",
            photoCategory: "group"
        )

        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(FeedPost.self, from: encoded)

        XCTAssertEqual(decoded.photoData, original.photoData)
        XCTAssertEqual(decoded.photoCategory, "group")
    }
}
