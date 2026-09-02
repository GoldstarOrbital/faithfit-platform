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
        XCTAssertEqual(TrainingMath.elapsedString(0), "00:00")
        XCTAssertEqual(TrainingMath.elapsedString(65), "01:05")
        XCTAssertEqual(TrainingMath.elapsedString(3661), "1:01:01")
    }

    func testHaversineAndRouteDistance() {
        let km = TrainingMath.haversineKm(lat1: 0, lon1: 0, lat2: 0, lon2: 0)
        XCTAssertEqual(km, 0, accuracy: 0.0001)
        // One degree of latitude is ~111.2 km.
        let oneDegree = TrainingMath.haversineKm(lat1: 0, lon1: 0, lat2: 1, lon2: 0)
        XCTAssertEqual(oneDegree, 111.2, accuracy: 0.5)
        let route = TrainingMath.routeDistanceKm([[0, 0], [1, 0], [1, 0]])
        XCTAssertEqual(route, oneDegree, accuracy: 0.01)
    }

    func testPaceAndCaloriesHeuristicsMatchWeb() {
        XCTAssertEqual(TrainingMath.paceString(elapsed: 0, km: 5), "—")
        XCTAssertEqual(TrainingMath.paceString(elapsed: 1800, km: 5), "6:00")
        XCTAssertEqual(TrainingMath.estimatedKcal(elapsed: 1800, km: 5), 300)
        XCTAssertEqual(TrainingMath.estimatedKcal(elapsed: 1800, km: 0), 240)
    }

    func testSkiingMetricsPrioritizeSpeedAndVertical() {
        // liveMetrics reads the member's unit preference (Units.current),
        // which otherwise falls back to this device/simulator's own region --
        // pin it explicitly so the test is deterministic regardless of what
        // locale happens to run it.
        let original = UserDefaults.standard.string(forKey: Units.storageKey)
        UserDefaults.standard.set(UnitsSystem.metric.rawValue, forKey: Units.storageKey)
        defer { UserDefaults.standard.set(original, forKey: Units.storageKey) }

        let metrics = TrainingMath.liveMetrics(
            activity: "Skiing", elapsed: 600, distanceKm: 4.2,
            currentSpeedKmh: 42.3, maxSpeedKmh: 61.8,
            elevationGainM: 130, elevationLossM: 540, heartRate: 0
        )
        XCTAssertEqual(metrics.map(\.label), ["SPEED · KM/H", "TOP SPEED · KM/H", "DESCENT · M", "ASCENT · M"])
        XCTAssertEqual(metrics[1].value, "61.8")
    }

    func testSkiingMetricsConvertToImperialWhenChosen() {
        let original = UserDefaults.standard.string(forKey: Units.storageKey)
        UserDefaults.standard.set(UnitsSystem.imperial.rawValue, forKey: Units.storageKey)
        defer { UserDefaults.standard.set(original, forKey: Units.storageKey) }

        let metrics = TrainingMath.liveMetrics(
            activity: "Skiing", elapsed: 600, distanceKm: 4.2,
            currentSpeedKmh: 42.3, maxSpeedKmh: 61.8,
            elevationGainM: 130, elevationLossM: 540, heartRate: 0
        )
        XCTAssertEqual(metrics.map(\.label), ["SPEED · MPH", "TOP SPEED · MPH", "DESCENT · FT", "ASCENT · FT"])
        XCTAssertEqual(metrics[1].value, "38.4") // 61.8 km/h * 0.621371
    }

    func testActivityCatalogMatchesRailwayVocabulary() {
        let types = Set(ActivityCatalog.fallback.map(\.type))
        XCTAssertEqual(types.count, 18)
        XCTAssertTrue(types.isSuperset(of: ["Run", "Walk", "Hike", "Trail Run", "Cycle", "Swim", "Row", "Strength", "Yoga", "Pickleball"]))
    }

    // "Bible Answers" is deliberately native-only: it has no web Explore
    // equivalent, so this now has one more section than Railway's
    // EXPLORE_SECTIONS (12) -- everything else still matches that list
    // exactly, in the same order.
    func testExploreCatalogHasRailwaySectionsPlusBibleAnswers() {
        XCTAssertEqual(ExploreCatalogItem.allCases.count, 13)
        XCTAssertEqual(ExploreCatalogItem.allCases.map(\.rawValue), [
            "journeys", "challenges", "videos", "reels", "podcasts", "scripture",
            "groups", "leaderboard", "breathe", "motivation", "news", "recruiting",
            "bibleAnswers",
        ])
    }

    func testWeeklyRecapDecodesRailwayShape() throws {
        let json = #"{"workouts":4,"distance_km":18.2,"minutes":110,"active_days":3,"posts":1,"kudos":6,"replies":2,"focus":"Run","share_text":"This week I showed up."}"#
        let recap = try JSONDecoder().decode(WeeklyRecap.self, from: Data(json.utf8))
        XCTAssertEqual(recap.workouts, 4)
        XCTAssertEqual(recap.distanceKm, 18.2, accuracy: 0.01)
        XCTAssertEqual(recap.activeDays, 3)
        XCTAssertEqual(recap.focus, "Run")
    }

    func testActivityTypeItemDecodesWebFlag() throws {
        let json = #"{"type":"Run","icon":"🏃","d":true}"#
        let item = try JSONDecoder().decode(ActivityTypeItem.self, from: Data(json.utf8))
        XCTAssertEqual(item.type, "Run")
        XCTAssertTrue(item.distance)
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
