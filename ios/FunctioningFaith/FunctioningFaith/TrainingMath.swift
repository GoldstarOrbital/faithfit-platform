import Foundation

/// Distance and display helpers shared by the Train tab. Kept free of UIKit so
/// unit tests can cover the same numbers the live GPS session shows.
enum TrainingMath {
    static let earthRadiusKm = 6371.0

    static func haversineKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * earthRadiusKm * asin(min(1, sqrt(a)))
    }

    static func routeDistanceKm(_ points: [[Double]]) -> Double {
        guard points.count >= 2 else { return 0 }
        var total = 0.0
        for index in 1..<points.count {
            let previous = points[index - 1]
            let current = points[index]
            guard previous.count >= 2, current.count >= 2 else { continue }
            total += haversineKm(lat1: previous[0], lon1: previous[1], lat2: current[0], lon2: current[1])
        }
        return total
    }

    static func elapsedString(_ elapsed: TimeInterval) -> String {
        let total = max(0, Int(elapsed))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%02d:%02d", minutes, seconds)
    }

    static func paceString(elapsed: TimeInterval, km: Double) -> String {
        guard km > 0.05, elapsed > 0 else { return "—" }
        let minutesPerKm = (elapsed / 60) / km
        let minutes = Int(minutesPerKm)
        let seconds = Int((minutesPerKm - Double(minutes)) * 60)
        return String(format: "%d:%02d", minutes, seconds)
    }

    static func estimatedKcal(elapsed: TimeInterval, km: Double) -> Int {
        if km > 0 { return Int((km * 60).rounded()) }
        return Int(((elapsed / 60) * 8).rounded())
    }
}

/// Same catalog as `webapp/routes/api.js` ACTIVITY_TYPES. Used when the
/// `/activity-types` call is unavailable so Train never ships an empty picker.
enum ActivityCatalog {
    static let fallback: [ActivityTypeItem] = [
        .init(type: "Run", icon: "🏃", distance: true),
        .init(type: "Walk", icon: "🚶", distance: true),
        .init(type: "Hike", icon: "🥾", distance: true),
        .init(type: "Trail Run", icon: "⛰️", distance: true),
        .init(type: "Cycle", icon: "🚴", distance: true),
        .init(type: "Swim", icon: "🏊", distance: true),
        .init(type: "Row", icon: "🚣", distance: true),
        .init(type: "Elliptical", icon: "🌀", distance: false),
        .init(type: "Strength", icon: "🏋️", distance: false),
        .init(type: "HIIT", icon: "🔥", distance: false),
        .init(type: "Yoga", icon: "🧘", distance: false),
        .init(type: "Pilates", icon: "🤸", distance: false),
        .init(type: "Climbing", icon: "🧗", distance: false),
        .init(type: "Pickleball", icon: "🏓", distance: true),
        .init(type: "Tennis", icon: "🎾", distance: false),
        .init(type: "Basketball", icon: "🏀", distance: false),
        .init(type: "Skiing", icon: "⛷️", distance: true),
        .init(type: "Workout", icon: "💪", distance: false),
    ]
}
