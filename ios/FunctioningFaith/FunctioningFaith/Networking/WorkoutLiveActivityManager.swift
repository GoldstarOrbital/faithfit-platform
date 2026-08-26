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
            await endAllOrphaned()
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

    /// `activity` only ever tracks what THIS process started -- it starts
    /// `nil` on every fresh launch. If the app was force-quit, crashed, or
    /// otherwise never reached toggleWorkout()'s stop path while a workout
    /// was live, the system Live Activity keeps running with nothing left
    /// in the app that still knows about it, showing on the Lock Screen /
    /// Dynamic Island indefinitely with no way to dismiss it from within the
    /// app. `Activity<T>.activities` is the OS's own list, independent of
    /// process lifetime, so this is the only reliable way to find and end
    /// one left over from a previous run. Called at app launch, and again
    /// before starting a new one so a desynced in-memory `activity` can't
    /// mask a still-running duplicate.
    func endAllOrphaned() async {
        for existing in Activity<WorkoutLiveActivityAttributes>.activities {
            await existing.end(existing.content, dismissalPolicy: .immediate)
        }
        activity = nil
    }
}
