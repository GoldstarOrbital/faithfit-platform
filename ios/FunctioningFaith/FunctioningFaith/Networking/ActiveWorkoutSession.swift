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

    var lastHeartRateRefresh = Date.distantPast
    var lastBiometricUpload = Date.distantPast
    var lastHeartRateCalmCue = Date.distantPast

    private var timer: AnyCancellable?

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
        tracker.start()
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
        isActive = false
        isPaused = false
        tracker.stop()
        timer?.cancel()
        timer = nil
    }

    private func startClock() {
        timer?.cancel()
        timer = Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                guard let self, self.isActive, !self.isPaused else { return }
                self.elapsed += 1
            }
    }
}
