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
    private var lastBeaconUpdate = Date.distantPast
    private var beaconUpdateInFlight = false

    private init() {}

    func begin(id: UUID, startedAt: Date, type: String, offline: Bool, verse: VerseSnippet?) {
        workoutID = id
        workoutStartedAt = startedAt
        selectedType = type
        elapsed = 0
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
        tracker.start(activityType: type)
        startClock()
    }

    func pause() {
        guard isActive, !isPaused else { return }
        isPaused = true
        tracker.stop()
    }

    func resume() {
        guard isActive, isPaused else { return }
        isPaused = false
        tracker.resume()
    }

    func markFinished() {
        let finishedID = workoutID
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
                self.elapsed += 1
                if Int(self.elapsed) % 10 == 0 {
                    WorkoutLiveActivityManager.shared.update(
                        distanceKm: self.tracker.distanceKm,
                        speedKmh: self.tracker.currentSpeedKmh,
                        heartRate: self.heartRate > 0 ? self.heartRate : nil
                    )
                }
                if Int(self.elapsed) % 20 == 0 { Task { await self.refreshBeaconIfNeeded() } }
            }
    }
}
