import ActivityKit
import Foundation

/// The small, non-sensitive state shown outside the app during a workout.
/// Route points and precise location deliberately never leave the app here.
struct WorkoutLiveActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var startedAt: Date
        /// Active workout time only. Unlike `Date.now - startedAt`, this does
        /// not keep advancing while the member has paused the workout.
        var elapsedSeconds: Int
        var isPaused: Bool
        /// Lets WidgetKit animate a live timer from the last authoritative
        /// elapsed value without requiring one ActivityKit push per second.
        var updatedAt: Date
        var distanceKm: Double
        var speedKmh: Double?
        var heartRate: Int?
    }

    var activityName: String
    var sport: String
}
