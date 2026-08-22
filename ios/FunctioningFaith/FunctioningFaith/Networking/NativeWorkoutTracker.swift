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
    @Published private(set) var currentSpeedKmh: Double?
    @Published private(set) var maxSpeedKmh: Double = 0
    @Published private(set) var elevationGainM: Double = 0
    @Published private(set) var elevationLossM: Double = 0

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
        manager.allowsBackgroundLocationUpdates = true
    }

    func start() {
        points.removeAll(keepingCapacity: true)
        distanceKm = 0
        lastAcceptedLocation = nil
        lastAccuracyMeters = nil
        currentSpeedKmh = nil
        maxSpeedKmh = 0
        elevationGainM = 0
        elevationLossM = 0
        manager.requestAlwaysAuthorization()
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
                let seconds = max(0.1, location.timestamp.timeIntervalSince(last.timestamp))
                let derivedSpeed = deltaMeters / seconds * 3.6
                let speedKmh = location.speed >= 0 ? location.speed * 3.6 : derivedSpeed
                // Ignore impossible GPS spikes. A 160 km/h ceiling still
                // leaves room for downhill skiing while protecting a bad fix.
                if speedKmh.isFinite, speedKmh >= 0, speedKmh <= 160 {
                    currentSpeedKmh = speedKmh
                    maxSpeedKmh = max(maxSpeedKmh, speedKmh)
                }
                if location.verticalAccuracy >= 0, last.verticalAccuracy >= 0,
                   location.verticalAccuracy <= 20, last.verticalAccuracy <= 20 {
                    let vertical = location.altitude - last.altitude
                    if vertical > 0 { elevationGainM += vertical }
                    else { elevationLossM += abs(vertical) }
                }
            }
            points.append(next)
            lastAcceptedLocation = location
        }
        if points.count > 3000 { points.removeFirst(points.count - 3000) }
    }
}
