import CoreLocation
import Combine
import Foundation

/// Real location collection for a member who has started a workout. No
/// synthetic telemetry is generated: if permission is denied, the session can
/// still be timed but its route remains empty and the UI says so plainly.
final class NativeWorkoutTracker: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var points: [[Double]] = []
    @Published private(set) var distanceKm: Double = 0
    @Published private(set) var authorization: CLAuthorizationStatus
    @Published private(set) var lastAccuracyMeters: Double?

    private let manager = CLLocationManager()
    private var lastAcceptedLocation: CLLocation?

    override init() {
        authorization = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = 3
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
    }

    func start() {
        points.removeAll(keepingCapacity: true)
        distanceKm = 0
        lastAcceptedLocation = nil
        lastAccuracyMeters = nil
        manager.requestWhenInUseAuthorization()
        guard manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse else { return }
        manager.startUpdatingLocation()
    }

    func stop() { manager.stopUpdatingLocation() }

    var isLocationReady: Bool {
        lastAcceptedLocation != nil && (lastAccuracyMeters ?? .infinity) <= 50
    }

    var statusText: String {
        switch authorization {
        case .authorizedAlways, .authorizedWhenInUse:
            if let accuracy = lastAccuracyMeters {
                return isLocationReady ? "GPS locked · ±\(Int(accuracy.rounded())) m" : "Improving GPS · ±\(Int(accuracy.rounded())) m"
            }
            return "Locating…"
        case .denied, .restricted: return "Location permission is off — workout will have no route"
        default: return "Waiting for location permission"
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
        if authorization == .authorizedAlways || authorization == .authorizedWhenInUse { manager.startUpdatingLocation() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations {
            // Ignore stale or low-confidence readings so a poor initial fix
            // cannot draw a misleading route or inflate distance.
            guard location.timestamp.timeIntervalSinceNow > -10,
                  location.horizontalAccuracy >= 0,
                  location.horizontalAccuracy <= 50 else { continue }
            lastAccuracyMeters = location.horizontalAccuracy
            let next = [location.coordinate.latitude, location.coordinate.longitude]
            if let last = lastAcceptedLocation {
                let deltaMeters = location.distance(from: last)
                // Less than two metres is normally GPS wander; a kilometre
                // jump between callbacks is never a credible workout trace.
                guard deltaMeters >= 2, deltaMeters <= 1_000 else { continue }
                distanceKm += deltaMeters / 1_000
            }
            points.append(next)
            lastAcceptedLocation = location
        }
        if points.count > 3000 { points.removeFirst(points.count - 3000) }
    }
}
