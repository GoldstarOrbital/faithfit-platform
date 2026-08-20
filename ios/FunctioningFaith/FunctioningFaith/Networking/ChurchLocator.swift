import CoreLocation

/// One-shot "where am I right now" for church search -- deliberately not
/// built on the same continuous-tracking shape as JourneyLiveTracker (that
/// one accumulates distance over a live session; this just needs a single
/// fix). Structured the same way regardless: NSObject + CLLocationManagerDelegate,
/// no explicit actor isolation on the class, since delegate callbacks land on
/// the thread that started location services -- the main thread here, same
/// as JourneyLiveTracker's own documented assumption.
final class ChurchLocator: NSObject, ObservableObject, CLLocationManagerDelegate {
    enum LocatorError: LocalizedError {
        case denied
        var errorDescription: String? {
            "Location access is off. Enable it in Settings to find churches near you."
        }
    }

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation, Error>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    /// Resumes exactly once: immediately on denied/restricted, or later from
    /// whichever delegate callback fires first once permission is settled.
    func currentLocation() async throws -> CLLocation {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            switch manager.authorizationStatus {
            case .notDetermined:
                manager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse, .authorizedAlways:
                manager.requestLocation()
            case .denied, .restricted:
                self.continuation = nil
                continuation.resume(throwing: LocatorError.denied)
            @unknown default:
                self.continuation = nil
                continuation.resume(throwing: LocatorError.denied)
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard continuation != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .denied, .restricted:
            continuation?.resume(throwing: LocatorError.denied)
            continuation = nil
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        continuation?.resume(returning: location)
        continuation = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}
