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

    func testNativeAuthProvidersOnlyExposeSupportedProviderNames() async throws {
        let client = APIClient.shared
        client.useMock = true
        let providers = try await client.fetchAuthProviders()

        XCTAssertEqual(Set(providers.map(\.name)), Set(["google", "apple"]))
        XCTAssertTrue(providers.allSatisfy { !$0.label.isEmpty })
    }

    @MainActor
    func testNativeOAuthNonceDerivationsMatchServerContracts() {
        let verifier = "test"
        XCTAssertEqual(NativeOAuthCoordinator.appleNonceHash(for: verifier),
                       "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")
        XCTAssertEqual(NativeOAuthCoordinator.pkceChallenge(for: verifier),
                       "n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg")
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

    func testGroupPulseDecodesPrivacyScopedContract() throws {
        let json = #"{"day":"2026-08-11","today_count":1,"mine":null,"checkins":[{"id":"pulse-1","group_id":"group-1","user_id":"user-1","day":"2026-08-11","kind":"moved","note":"Easy miles.","author":"Sam","verse_reference":"Isaiah 40:31","verse_text":"Renew their strength.","encouragement_count":2,"encouraged_by_me":true}]}"#
        let pulse = try JSONDecoder().decode(GroupPulse.self, from: Data(json.utf8))

        XCTAssertEqual(pulse.todayCount, 1)
        XCTAssertEqual(pulse.checkins.first?.kind, "moved")
        XCTAssertEqual(pulse.checkins.first?.encouragementCount, 2)
        XCTAssertEqual(pulse.checkins.first?.encouragedByMe, true)
    }
}
