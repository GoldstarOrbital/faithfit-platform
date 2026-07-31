import XCTest
@testable import Functioning Faith

final class FunctioningFaithTests: XCTestCase {
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
}
