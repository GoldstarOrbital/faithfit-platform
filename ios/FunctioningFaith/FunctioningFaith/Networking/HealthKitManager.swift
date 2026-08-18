import Foundation
import HealthKit
import Combine

/// Apple Health / Apple Watch / third-party wearable sync (Fitbit, Garmin, Oura,
/// Whoop, and anything else that writes into Health — HealthKit is the one
/// integration point that reaches all of them at once on iOS).
///
/// Deliberately READ-ONLY. This app never writes to a member's Health data —
/// only reads workouts, step counts, and the heart rate recorded during a
/// synced workout — and the authorization request below asks for exactly
/// those three types and nothing else. Apple's own review guidance singles out
/// requesting Health access broader than what the app actually uses as a
/// common rejection cause (Guideline 5.1.1), and it is exactly the kind of
/// thing a fast, unreviewed integration gets wrong.
///
/// No synthetic data, ever — the same hard rule the web app already enforces
/// for physiological data (see webapp's account of "never fabricate
/// physiological data"). If HealthKit is unavailable, permission is denied, or
/// a query returns nothing, this reports exactly that; it never fills in a
/// plausible-looking number.
@MainActor
final class HealthKitManager: ObservableObject {
    static let shared = HealthKitManager()

    @Published private(set) var isAvailable: Bool = HKHealthStore.isHealthDataAvailable()
    @Published private(set) var authorizationRequested: Bool = false
    @Published private(set) var lastSyncedAt: Date?
    @Published private(set) var lastSyncError: String?

    private let store = HKHealthStore()
    private let lastSyncKey = "healthkit.lastWorkoutSyncStart"
    private let userDefaults = UserDefaults.standard

    // The `HKQuantityType(.stepCount)` typed-literal initializer is a newer
    // HealthKit API surface than this project's iOS 17 deployment target can
    // be confirmed to support from this environment (no Xcode/SDK available
    // to check), so this uses the traditional `quantityType(forIdentifier:)`
    // factory that has been stable since HealthKit's original iOS 8 release —
    // the safer choice when it can't be verified by actually building.
    private var workoutType: HKObjectType { HKObjectType.workoutType() }
    private var stepType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .stepCount)! }
    private var heartRateType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .heartRate)! }

    // Calories come from workout.totalEnergyBurned, part of the workout
    // sample's own metadata -- reading it needs authorization for
    // workoutType, not a separate activeEnergyBurned read grant. Requesting
    // a type nothing actually queries is exactly the over-broad ask this
    // file's own header warns about, so it's deliberately left out here.
    private var readTypes: Set<HKObjectType> { [workoutType, stepType, heartRateType] }

    private init() {
        lastSyncedAt = userDefaults.object(forKey: "healthkit.lastSyncedAt") as? Date
    }

    /// True once the system has recorded a decision either way. HealthKit
    /// deliberately never tells an app whether that decision was "allow" or
    /// "deny" for a read type (to avoid leaking whether a specific health fact
    /// exists) — a query simply returns nothing if the member said no, which
    /// requestAndSync()'s caller has to treat as a normal empty result, not an
    /// error to alarm the member with.
    func requestAuthorization() async throws {
        guard isAvailable else { throw HealthKitError.unavailable }
        try await store.requestAuthorization(toShare: [], read: readTypes)
        authorizationRequested = true
    }

    /// Pulls workouts since the last successful sync (or the last 30 days on
    /// first run), maps each into the app's own activity vocabulary, and hands
    /// them to `upload` for the actual network call — kept as an injected
    /// closure so this stays testable without a live server.
    func syncRecentWorkouts(upload: (SyncPayload) async throws -> SyncResult) async {
        guard isAvailable else { lastSyncError = "Health data is not available on this device."; return }
        do {
            let since = userDefaults.object(forKey: lastSyncKey) as? Date ?? Date().addingTimeInterval(-30 * 24 * 3600)
            let workouts = try await fetchWorkouts(since: since)
            var syncedWorkouts: [SyncedWorkout] = []
            for workout in workouts {
                let avgHR = try? await averageHeartRate(during: workout)
                syncedWorkouts.append(SyncedWorkout(
                    externalID: workout.uuid.uuidString,
                    activityType: activityName(for: workout.workoutActivityType),
                    startTime: workout.startDate,
                    endTime: workout.endDate,
                    durationSec: Int(workout.duration.rounded()),
                    calories: energyBurned(for: workout).map { Int($0.rounded()) },
                    distanceMeters: distance(for: workout),
                    avgHeartRate: avgHR.map { Int($0.rounded()) }
                ))
            }
            let steps = try await dailyStepTotals(since: since)
            _ = try await upload(SyncPayload(workouts: syncedWorkouts, dailySteps: steps))
            userDefaults.set(Date(), forKey: lastSyncKey)
            let now = Date()
            userDefaults.set(now, forKey: "healthkit.lastSyncedAt")
            lastSyncedAt = now
            lastSyncError = nil
        } catch {
            lastSyncError = error.localizedDescription
        }
    }

    // MARK: - Queries

    private func fetchWorkouts(since: Date) async throws -> [HKWorkout] {
        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: .workoutType(),
                predicate: predicate,
                limit: 200,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, samples, error in
                if let error { continuation.resume(throwing: error); return }
                continuation.resume(returning: (samples as? [HKWorkout]) ?? [])
            }
            store.execute(query)
        }
    }

    /// Distance the workout itself reports, when the recording source captured
    /// one (running/cycling/etc.) — nil for types HealthKit doesn't track
    /// distance for (yoga, strength training), never a computed guess.
    private func distance(for workout: HKWorkout) -> Double? {
        workout.totalDistance?.doubleValue(for: .meter())
    }

    private func energyBurned(for workout: HKWorkout) -> Double? {
        workout.totalEnergyBurned?.doubleValue(for: .kilocalorie())
    }

    /// Average heart rate strictly within the workout's own start/end window —
    /// not a device-wide average — so this can never attribute a resting or
    /// unrelated-activity heart rate to a specific session.
    private func averageHeartRate(during workout: HKWorkout) async throws -> Double? {
        let predicate = HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: .strictStartDate)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: heartRateType, quantitySamplePredicate: predicate, options: .discreteAverage) { _, stats, error in
                if let error { continuation.resume(throwing: error); return }
                let unit = HKUnit.count().unitDivided(by: .minute())
                continuation.resume(returning: stats?.averageQuantity()?.doubleValue(for: unit))
            }
            store.execute(query)
        }
    }

    /// Per-day step totals, summed from whichever source(s) contributed —
    /// HealthKit already de-duplicates overlapping sources (a paired iPhone
    /// and Watch both stepping) for the count/statistics APIs, so this does
    /// not double-count a member who owns both.
    private func dailyStepTotals(since: Date) async throws -> [DailySteps] {
        let calendar = Calendar.current
        let anchor = calendar.startOfDay(for: since)
        let predicate = HKQuery.predicateForSamples(withStart: anchor, end: nil, options: .strictStartDate)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: stepType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum,
                anchorDate: anchor,
                intervalComponents: DateComponents(day: 1)
            )
            query.initialResultsHandler = { _, collection, error in
                if let error { continuation.resume(throwing: error); return }
                var out: [DailySteps] = []
                collection?.enumerateStatistics(from: anchor, to: Date()) { stats, _ in
                    guard let sum = stats.sumQuantity() else { return }
                    let count = sum.doubleValue(for: .count())
                    if count > 0 {
                        let formatter = DateFormatter()
                        formatter.locale = Locale(identifier: "en_US_POSIX")
                        formatter.dateFormat = "yyyy-MM-dd"
                        out.append(DailySteps(date: formatter.string(from: stats.startDate), steps: Int(count.rounded())))
                    }
                }
                continuation.resume(returning: out)
            }
            store.execute(query)
        }
    }

    // MARK: - Activity mapping

    /// HKWorkoutActivityType -> Functioning Faith's own vocabulary
    /// (routes/api.js ACTIVITY_TYPES on the server). Anything not explicitly
    /// listed falls through to "Workout" rather than a wrong specific guess.
    private func activityName(for type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "Run"
        case .walking: return "Walk"
        case .hiking: return "Hike"
        case .cycling: return "Cycle"
        case .swimming: return "Swim"
        case .rowing: return "Row"
        case .elliptical: return "Elliptical"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "Strength"
        case .highIntensityIntervalTraining: return "HIIT"
        case .yoga: return "Yoga"
        case .pilates: return "Pilates"
        case .climbing: return "Climbing"
        case .tennis: return "Tennis"
        case .basketball: return "Basketball"
        case .downhillSkiing, .crossCountrySkiing, .snowSports: return "Skiing"
        case .pickleball: return "Pickleball" // added to HKWorkoutActivityType well before this app's iOS 17 minimum, no availability guard needed
        default: return "Workout"
        }
    }
}

enum HealthKitError: LocalizedError {
    case unavailable
    var errorDescription: String? {
        switch self {
        case .unavailable: return "Health data is not available on this device."
        }
    }
}

struct SyncedWorkout {
    let externalID: String
    let activityType: String
    let startTime: Date
    let endTime: Date
    let durationSec: Int
    let calories: Int?
    let distanceMeters: Double?
    let avgHeartRate: Int?
}

struct DailySteps {
    let date: String
    let steps: Int
}

struct SyncPayload {
    let workouts: [SyncedWorkout]
    let dailySteps: [DailySteps]
}

struct SyncResult {
    let imported: Int
    let checked: Int
    let stepDaysSynced: Int
}
