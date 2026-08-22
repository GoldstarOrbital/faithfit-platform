import ActivityKit
import Foundation

/// Owns the one workout Live Activity. It intentionally contains only display
/// metrics, never the member's GPS path or account data.
@MainActor
final class WorkoutLiveActivityManager {
    static let shared = WorkoutLiveActivityManager()
    private var activity: Activity<WorkoutLiveActivityAttributes>?

    private init() { }

    func start(sport: String, startedAt: Date = .now) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        Task {
            await end()
            let attributes = WorkoutLiveActivityAttributes(activityName: "Functioning Faith", sport: sport)
            let state = WorkoutLiveActivityAttributes.ContentState(startedAt: startedAt, distanceKm: 0, speedKmh: nil, heartRate: nil)
            do {
                activity = try Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil), pushType: nil)
            } catch {
                // The workout itself must keep recording if Live Activities are disabled.
            }
        }
    }

    func update(distanceKm: Double, speedKmh: Double?, heartRate: Int?) {
        guard let activity else { return }
        let prior = activity.content.state
        let state = WorkoutLiveActivityAttributes.ContentState(
            startedAt: prior.startedAt,
            distanceKm: distanceKm,
            speedKmh: speedKmh,
            heartRate: heartRate
        )
        Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
    }

    func end() async {
        guard let activity else { return }
        let final = activity.content.state
        await activity.end(ActivityContent(state: final, staleDate: nil), dismissalPolicy: .immediate)
        self.activity = nil
    }
}
