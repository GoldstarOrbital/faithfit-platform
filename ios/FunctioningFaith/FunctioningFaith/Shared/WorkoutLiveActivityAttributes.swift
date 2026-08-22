import ActivityKit
import Foundation

/// The small, non-sensitive state shown outside the app during a workout.
/// Route points and precise location deliberately never leave the app here.
struct WorkoutLiveActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var startedAt: Date
        var distanceKm: Double
        var speedKmh: Double?
        var heartRate: Int?
    }

    var activityName: String
    var sport: String
}
