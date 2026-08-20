import CoreLocation
import Combine
import Foundation

/// GPS-driven live distance for a journey session. Deliberately a separate,
/// small tracker rather than reusing NativeWorkoutTracker (which accumulates
/// a raw point path for regular workouts, not incremental km) -- extending
/// that one to also do this risked the already-working workout GPS flow for
/// no real benefit, since the two have almost nothing in common beyond both
/// wrapping CLLocationManager. Structured the same way NativeWorkoutTracker
/// is (no explicit actor isolation on the class -- CLLocationManager
/// delegate callbacks are delivered on the thread that called
/// startUpdatingLocation, which is the main thread for both trackers in
/// practice) rather than introducing a different concurrency pattern for
/// what is otherwise the same kind of code.
///
/// Batches small distance deltas and flushes them periodically rather than
/// posting every GPS update: the server caps a single /progress call at 5km
/// and treats a larger jump as a runaway-client bug (routes/api.js), so
/// frequent small flushes are the correct shape for this endpoint, not an
/// optimization.
final class JourneyLiveTracker: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var sessionKm: Double = 0
    @Published private(set) var authorization: CLAuthorizationStatus
    @Published private(set) var isFlushing = false
    @Published private(set) var lastError: String?
    // Owned here rather than threaded back through an init-time closure --
    // a View can't cleanly wire a callback from a @StateObject's init into
    // its OWN @State (the view struct may be recreated many times before
    // the StateObject's single init runs), so the tracker just publishes
    // its own results and the view reads them directly off it instead.
    @Published private(set) var latestProgress: JourneyProgressResult?
    @Published private(set) var justCrossed: [CrossedWaypoint] = []

    private let manager = CLLocationManager()
    private var lastLocation: CLLocation?
    private var pendingKm: Double = 0
    private var flushTimer: Timer?
    private let journeyKey: String

    init(journeyKey: String) {
        self.journeyKey = journeyKey
        authorization = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10 // meters between callbacks; fine enough for a running/riding pace
        manager.activityType = .fitness
    }

    func start() {
        manager.requestWhenInUseAuthorization()
        if manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse {
            manager.startUpdatingLocation()
        }
        flushTimer?.invalidate()
        flushTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { await self?.flush() }
        }
    }

    func stop() {
        manager.stopUpdatingLocation()
        flushTimer?.invalidate()
        flushTimer = nil
        lastLocation = nil
    }

    /// Sends any accumulated-but-unsent distance immediately -- call this
    /// when the session ends, not just on the timer, so the last few meters
    /// before stopping aren't silently dropped.
    func flushNow() async { await flush() }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
        if authorization == .authorizedAlways || authorization == .authorizedWhenInUse { manager.startUpdatingLocation() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations where location.horizontalAccuracy >= 0 && location.horizontalAccuracy <= 50 {
            if let last = lastLocation {
                let deltaMeters = location.distance(from: last)
                // A GPS jump under poor signal can register as tens of
                // meters in one tick with no real movement; anything over
                // 200m between consecutive fixes (well beyond a real
                // 10m-filtered update at any plausible running/riding
                // speed) is treated as noise, not distance.
                if deltaMeters > 0 && deltaMeters < 200 {
                    let deltaKm = deltaMeters / 1000
                    sessionKm += deltaKm
                    pendingKm += deltaKm
                }
            }
            lastLocation = location
        }
    }

    private func flush() async {
        guard pendingKm > 0, !isFlushing else { return }
        let toSend = min(pendingKm, 5.0) // server hard-caps a single call at 5km
        isFlushing = true
        do {
            let result = try await APIClient.shared.postJourneyProgress(key: journeyKey, addKm: toSend)
            pendingKm -= toSend
            latestProgress = result
            if !result.crossed.isEmpty { justCrossed = result.crossed } // sticky until the next flush that crosses something new -- lets the UI show it briefly rather than flicker per flush
            lastError = nil
        } catch {
            // Leave pendingKm intact -- the next timer tick retries the same
            // (or by-then-larger) unsent amount rather than losing it.
            lastError = error.localizedDescription
        }
        isFlushing = false
    }
}
