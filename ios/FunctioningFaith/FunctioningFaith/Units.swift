import Foundation

/// A member's chosen distance/speed/elevation unit system, synced to their
/// profile (the server's `units_system` column) so it stays consistent
/// across devices rather than being a per-screen guess.
enum UnitsSystem: String, CaseIterable, Identifiable, Codable {
    case metric, imperial
    var id: String { rawValue }
    var label: String {
        switch self {
        case .metric: return "Metric (km, kg)"
        case .imperial: return "Imperial (mi, lb)"
        }
    }
}

/// Central distance/speed/pace/elevation formatting, so every screen agrees
/// with the member's chosen unit system instead of each one hardcoding km.
/// Reads straight from UserDefaults (the same storage `@AppStorage` uses)
/// rather than requiring a preference to be threaded through every call
/// site, so plain, non-View code (TrainingMath's live-workout math) can use
/// it too.
enum Units {
    static let storageKey = "units.system"
    private static let kmPerMile = 0.621371
    private static let mPerFoot = 3.28084

    /// The member's explicit choice, synced from their profile via
    /// APIClient.setUnitsSystem(_:); falling back to whatever unit system
    /// this device's own region uses when they haven't chosen one -- the
    /// same rule iOS's own Maps/Weather apps follow.
    static var current: UnitsSystem {
        if let raw = UserDefaults.standard.string(forKey: storageKey), let saved = UnitsSystem(rawValue: raw) {
            return saved
        }
        return Locale.current.measurementSystem == .metric ? .metric : .imperial
    }

    static var isImperial: Bool { current == .imperial }
    static var distanceUnitLabel: String { isImperial ? "mi" : "km" }
    static var speedUnitLabel: String { isImperial ? "mph" : "km/h" }
    static var elevationUnitLabel: String { isImperial ? "ft" : "m" }

    static func distanceValue(km: Double) -> Double { isImperial ? km * kmPerMile : km }
    static func speedValue(kmh: Double) -> Double { isImperial ? kmh * kmPerMile : kmh }
    static func elevationValue(meters: Double) -> Double { isImperial ? meters * mPerFoot : meters }

    /// `km` in, a formatted display string honoring the member's unit choice out.
    static func distanceString(km: Double, decimals: Int = 2) -> String {
        String(format: "%.\(decimals)f %@", distanceValue(km: km), distanceUnitLabel)
    }

    static func speedString(kmh: Double, decimals: Int = 1) -> String {
        String(format: "%.\(decimals)f %@", speedValue(kmh: kmh), speedUnitLabel)
    }

    static func elevationString(meters: Double) -> String {
        "\(Int(elevationValue(meters: meters).rounded())) \(elevationUnitLabel)"
    }

    /// Pace as minutes:seconds per distance unit -- per km normally, per mile
    /// under imperial. Always fed minutes-per-KM regardless of display unit;
    /// the conversion happens here, once, rather than at every call site.
    static func paceString(minutesPerKm: Double) -> String {
        guard minutesPerKm.isFinite, minutesPerKm > 0 else { return "—" }
        let perUnit = isImperial ? minutesPerKm / kmPerMile : minutesPerKm
        let minutes = Int(perUnit)
        let seconds = Int((perUnit - Double(minutes)) * 60)
        return String(format: "%d:%02d", minutes, seconds)
    }
}
