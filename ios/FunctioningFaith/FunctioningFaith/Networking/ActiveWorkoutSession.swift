import Combine
import Foundation

/// App-owned state for the workout currently being recorded. A workout must
/// outlive whichever tab or navigation route happened to start it.
@MainActor
final class ActiveWorkoutSession: ObservableObject {
    static let shared = ActiveWorkoutSession()

    let tracker = NativeWorkoutTracker()

    @Published var selectedType = "Run"
    @Published var isActive = false
    @Published var isPaused = false
    @Published var isOfflineWorkout = false
    @Published var elapsed: TimeInterval = 0
    @Published var heartRate = 0
    @Published var workoutID: UUID?
    @Published var workoutStartedAt: Date?
    @Published var workoutVerse: VerseSnippet?
    @Published var heartRateCalmMessage: String?
    @Published private(set) var beaconRecipients: Set<UUID> = []

    var lastHeartRateRefresh = Date.distantPast
    var lastBiometricUpload = Date.distantPast
    var lastHeartRateCalmCue = Date.distantPast

    private var timer: AnyCancellable?
    private var accumulatedElapsed: TimeInterval = 0
    private var runningBeganAt: Date?
    private var lastBeaconUpdate = Date.distantPast
    private var lastLiveActivityUpdate = Date.distantPast
    private var beaconUpdateInFlight = false

    private init() {}

    func begin(id: UUID, startedAt: Date, type: String, offline: Bool, verse: VerseSnippet?) {
        workoutID = id
        workoutStartedAt = startedAt
        selectedType = type
        accumulatedElapsed = 0
        runningBeganAt = startedAt
        elapsed = max(0, Date().timeIntervalSince(startedAt))
        isPaused = false
        isOfflineWorkout = offline
        heartRate = 0
        lastHeartRateRefresh = .distantPast
        lastBiometricUpload = .distantPast
        lastHeartRateCalmCue = .distantPast
        heartRateCalmMessage = nil
        workoutVerse = verse
        isActive = true
        beaconRecipients.removeAll()
        lastBeaconUpdate = .distantPast
        lastLiveActivityUpdate = .distantPast
        tracker.start(activityType: type)
        startClock()
    }

    func pause() {
        guard isActive, !isPaused else { return }
        refreshElapsed()
        accumulatedElapsed = elapsed
        runningBeganAt = nil
        isPaused = true
        tracker.stop()
        updateLiveActivity()
    }

    func resume() {
        guard isActive, isPaused else { return }
        isPaused = false
        runningBeganAt = .now
        tracker.resume()
        updateLiveActivity()
    }

    func markFinished() {
        let finishedID = workoutID
        refreshElapsed()
        accumulatedElapsed = elapsed
        runningBeganAt = nil
        isActive = false
        isPaused = false
        tracker.stop()
        timer?.cancel()
        timer = nil
        beaconRecipients.removeAll()
        if let finishedID { Task { try? await APIClient.shared.stopWorkoutBeacon(id: finishedID) } }
    }

    func enableBeacon(for recipients: Set<UUID>) async throws {
        guard let workoutID, let point = tracker.points.last, point.count == 2 else {
            throw APIError.invalidResponse
        }
        for recipient in recipients {
            _ = try await APIClient.shared.updateWorkoutBeacon(
                id: workoutID, recipientID: recipient,
                latitude: point[0], longitude: point[1], accuracyM: tracker.lastAccuracyMeters
            )
        }
        beaconRecipients = recipients
        lastBeaconUpdate = .now
    }

    private func refreshBeaconIfNeeded() async {
        guard isActive, !isPaused, !beaconRecipients.isEmpty, !beaconUpdateInFlight,
              Date().timeIntervalSince(lastBeaconUpdate) >= 20,
              let workoutID, let point = tracker.points.last, point.count == 2 else { return }
        beaconUpdateInFlight = true
        defer { beaconUpdateInFlight = false }
        var delivered = false
        for recipient in beaconRecipients {
            if (try? await APIClient.shared.updateWorkoutBeacon(
                id: workoutID, recipientID: recipient,
                latitude: point[0], longitude: point[1], accuracyM: tracker.lastAccuracyMeters
            )) != nil { delivered = true }
        }
        if delivered { lastBeaconUpdate = .now }
    }

    private func startClock() {
        timer?.cancel()
        timer = Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                guard let self, self.isActive, !self.isPaused else { return }
                // A publisher does not fire while iOS suspends the app. Derive
                // from wall time instead of counting callbacks so returning
                // from the Lock Screen cannot make elapsed time jump backward.
                self.refreshElapsed()
                if Date().timeIntervalSince(self.lastLiveActivityUpdate) >= 5 { self.updateLiveActivity() }
                if Int(self.elapsed) % 20 == 0 { Task { await self.refreshBeaconIfNeeded() } }
            }
    }

    private func refreshElapsed(now: Date = .now) {
        guard let runningBeganAt else {
            elapsed = accumulatedElapsed
            return
        }
        elapsed = accumulatedElapsed + max(0, now.timeIntervalSince(runningBeganAt))
    }

    func updateLiveActivity() {
        guard isActive else { return }
        lastLiveActivityUpdate = .now
        WorkoutLiveActivityManager.shared.update(
            distanceKm: tracker.distanceKm,
            elapsed: elapsed,
            isPaused: isPaused,
            speedKmh: isPaused ? nil : tracker.currentSpeedKmh,
            heartRate: heartRate > 0 ? heartRate : nil
        )
    }
}
