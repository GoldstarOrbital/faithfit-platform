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

    private let manager = CLLocationManager()

    override init() {
        authorization = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.activityType = .fitness
    }

    func start() {
        points.removeAll(keepingCapacity: true)
        distanceKm = 0
        manager.requestWhenInUseAuthorization()
        guard manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse else { return }
        manager.startUpdatingLocation()
    }

    func stop() { manager.stopUpdatingLocation() }

    var statusText: String {
        switch authorization {
        case .authorizedAlways, .authorizedWhenInUse: return points.isEmpty ? "Locating…" : "GPS route recording"
        case .denied, .restricted: return "Location permission is off — workout will have no route"
        default: return "Waiting for location permission"
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
        if authorization == .authorizedAlways || authorization == .authorizedWhenInUse { manager.startUpdatingLocation() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations where location.horizontalAccuracy >= 0 && location.horizontalAccuracy <= 100 {
            let next = [location.coordinate.latitude, location.coordinate.longitude]
            if let last = points.last, last.count >= 2 {
                distanceKm += TrainingMath.haversineKm(lat1: last[0], lon1: last[1], lat2: next[0], lon2: next[1])
            }
            points.append(next)
        }
        if points.count > 3000 { points.removeFirst(points.count - 3000) }
    }
}
