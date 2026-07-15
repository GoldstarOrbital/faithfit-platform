import HealthKit

/// Requests HealthKit authorization and streams samples to the backend wearable-ingest service.
/// Explicit user consent (HealthKit's own permission sheet + in-app privacy toggle) is required
/// before this manager starts observing any data type.
final class HealthKitManager {
    private let store = HKHealthStore()

    private let readTypes: Set<HKObjectType> = [
        HKObjectType.quantityType(forIdentifier: .heartRate)!,
        HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!,
        HKObjectType.quantityType(forIdentifier: .stepCount)!,
        HKObjectType.workoutType(),
    ]

    func requestAuthorization(completion: @escaping (Bool, Error?) -> Void) {
        guard HKHealthStore.isHealthDataAvailable() else {
            completion(false, nil)
            return
        }
        store.requestAuthorization(toShare: [], read: readTypes, completion: completion)
    }

    /// Starts an anchored query for heart rate samples and forwards batches to the app's
    /// networking layer (APIClient) for POST to /api/wearable-ingest/healthkit.
    func startHeartRateObserver(onBatch: @escaping ([HeartRateSample]) -> Void) {
        // TODO: implement HKAnchoredObjectQuery + HKObserverQuery with background delivery,
        // batching samples and calling onBatch(). Kept minimal here as a skeleton.
    }
}

struct HeartRateSample: Codable {
    let timestamp: Date
    let heartRate: Double
}
