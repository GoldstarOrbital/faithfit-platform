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
    private(set) var isTracking = false

    private let manager = CLLocationManager()
    private var lastAcceptedLocation: CLLocation?
    private var elevationReference: CLLocation?
    private var activityType = "Workout"

    override init() {
        authorization = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = 3
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
        manager.allowsBackgroundLocationUpdates = true
        // The system's blue location indicator must never appear merely
        // because this singleton was created. It is enabled only while a
        // member has explicitly started or resumed a workout.
        manager.showsBackgroundLocationIndicator = false
    }

    func start(activityType: String = "Workout") {
        isTracking = true
        manager.showsBackgroundLocationIndicator = true
        self.activityType = activityType
        points.removeAll(keepingCapacity: true)
        distanceKm = 0
        lastAcceptedLocation = nil
        elevationReference = nil
        lastAccuracyMeters = nil
        currentSpeedKmh = nil
        maxSpeedKmh = 0
        elevationGainM = 0
        elevationLossM = 0
        manager.requestAlwaysAuthorization()
        guard manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse else { return }
        manager.startUpdatingLocation()
    }

    func stop() {
        isTracking = false
        manager.stopUpdatingLocation()
        manager.showsBackgroundLocationIndicator = false
    }

    /// Temporarily stops GPS collection without discarding the route or the
    /// accumulated distance. A resumed workout must be one continuous record,
    /// not a new workout with a silently reset route.
    func resume() {
        isTracking = true
        manager.showsBackgroundLocationIndicator = true
        lastAcceptedLocation = nil
        currentSpeedKmh = nil
        guard authorization == .authorizedAlways || authorization == .authorizedWhenInUse else { return }
        manager.startUpdatingLocation()
    }

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
        guard isTracking else { return }
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
                let seconds = max(0.1, location.timestamp.timeIntervalSince(last.timestamp))
                let derivedSpeed = deltaMeters / seconds * 3.6
                let speedKmh = location.speed >= 0 ? location.speed * 3.6 : derivedSpeed
                // Reject the point before adding its distance. Previously an
                // impossible spike was hidden from the speed tile but had
                // already inflated distance, pace, records, and the widget.
                let ceiling = speedCeilingKmh(for: activityType)
                guard speedKmh.isFinite, speedKmh >= 0, speedKmh <= ceiling else { continue }
                distanceKm += deltaMeters / 1_000
                currentSpeedKmh = speedKmh
                maxSpeedKmh = max(maxSpeedKmh, speedKmh)

                // Accumulate elevation only after a meaningful move from a
                // stable reference, rather than summing every 1m GPS wobble.
                if location.verticalAccuracy >= 0, location.verticalAccuracy <= 20 {
                    if let reference = elevationReference {
                        let threshold = max(3, min(8, max(location.verticalAccuracy, reference.verticalAccuracy) * 0.5))
                        let vertical = location.altitude - reference.altitude
                        if vertical >= threshold { elevationGainM += vertical; elevationReference = location }
                        else if vertical <= -threshold { elevationLossM += abs(vertical); elevationReference = location }
                    } else {
                        elevationReference = location
                    }
                }
            }
            points.append(next)
            lastAcceptedLocation = location
        }
        if points.count > 3000 { points.removeFirst(points.count - 3000) }
    }

    private func speedCeilingKmh(for activity: String) -> Double {
        switch activity.lowercased() {
        case "walk", "hike": return 18
        case "run", "trail run": return 40
        case "cycling", "cycle", "mountain biking": return 100
        case "swim": return 12
        case "skiing", "snowboarding": return 160
        default: return 80
        }
    }
}
