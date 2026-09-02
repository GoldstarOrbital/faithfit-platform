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

    struct LiveMetric: Identifiable {
        let value: String
        let label: String
        var id: String { label }
    }

    static func speedString(_ kmh: Double?) -> String {
        guard let kmh, kmh > 0 else { return "—" }
        return String(format: "%.1f", Units.speedValue(kmh: kmh))
    }

    /// Run/cycle/hike pace, honoring the member's unit system (see
    /// Units.swift) -- distinct from `paceString(elapsed:km:)` above, which
    /// stays a bare, unit-agnostic "M:SS" for callers that don't want a
    /// converted-and-labeled result.
    private static func unitPaceString(elapsed: TimeInterval, km: Double) -> String {
        guard km > 0.05, elapsed > 0 else { return "—" }
        return Units.paceString(minutesPerKm: (elapsed / 60) / km)
    }

    static func liveMetrics(activity: String, elapsed: TimeInterval, distanceKm: Double,
                            currentSpeedKmh: Double?, maxSpeedKmh: Double,
                            elevationGainM: Double, elevationLossM: Double, heartRate: Int) -> [LiveMetric] {
        let unitLabel = Units.distanceUnitLabel.uppercased()
        let elapsedMetric = LiveMetric(value: elapsedString(elapsed), label: "ELAPSED")
        let distance = LiveMetric(value: String(format: "%.2f", Units.distanceValue(km: distanceKm)), label: "DISTANCE · \(unitLabel)")
        let heart = LiveMetric(value: heartRate > 0 ? "\(heartRate)" : "—", label: heartRate > 0 ? "HEART RATE · BPM" : "HEART RATE")
        let calories = LiveMetric(value: "~\(estimatedKcal(elapsed: elapsed, km: distanceKm))", label: "CALORIES · EST.")
        let pace = LiveMetric(value: unitPaceString(elapsed: elapsed, km: distanceKm), label: "PACE · /\(unitLabel)")
        // Swim pace stays per-100m regardless of unit system -- pool
        // convention (25/50m) doesn't map onto imperial the way road
        // distance does, and guessing a yard-pool assumption would be
        // exactly the kind of invented precision this app avoids elsewhere.
        let waterPace = LiveMetric(value: paceString(elapsed: elapsed, km: distanceKm * 10), label: "PACE · /100 M")
        let speed = LiveMetric(value: speedString(currentSpeedKmh), label: "SPEED · \(Units.speedUnitLabel.uppercased())")
        let topSpeed = LiveMetric(value: speedString(maxSpeedKmh), label: "TOP SPEED · \(Units.speedUnitLabel.uppercased())")
        let ascent = LiveMetric(value: "\(Int(Units.elevationValue(meters: elevationGainM).rounded()))", label: "ASCENT · \(Units.elevationUnitLabel.uppercased())")
        let descent = LiveMetric(value: "\(Int(Units.elevationValue(meters: elevationLossM).rounded()))", label: "DESCENT · \(Units.elevationUnitLabel.uppercased())")

        switch activity {
        case "Skiing": return [speed, topSpeed, descent, ascent]
        case "Cycle": return [speed, topSpeed, distance, ascent]
        case "Hike", "Trail Run": return [distance, ascent, pace, heart]
        case "Swim", "Row": return [distance, waterPace, elapsedMetric, heart]
        case "Run", "Walk": return [distance, pace, elapsedMetric, heart]
        case "Pickleball": return [elapsedMetric, distance, heart, calories]
        case "Elliptical", "Strength", "HIIT", "Yoga", "Pilates", "Climbing", "Tennis", "Basketball", "Workout":
            return [elapsedMetric, heart, calories, LiveMetric(value: "Live", label: "SESSION")]
        default: return [distance, pace, elapsedMetric, heart]
        }
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
