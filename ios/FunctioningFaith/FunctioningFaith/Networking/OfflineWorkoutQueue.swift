import Foundation

/// Durable fallback for a workout finished without connectivity. GPS capture
/// and the active timer remain on-device; when the member reconnects we save
/// the session through the normal authenticated manual-workout endpoint.
@MainActor
final class OfflineWorkoutQueue {
    static let shared = OfflineWorkoutQueue()

    private struct Pending: Codable, Identifiable {
        let id: UUID
        let type: String
        let durationSec: Int
        let distanceKm: Double
        let finishedAt: Date
    }

    private let key = "offline-workout-queue.v1"
    private var pending: [Pending] = []

    private init() {
        pending = (try? JSONDecoder().decode([Pending].self, from: UserDefaults.standard.data(forKey: key) ?? Data())) ?? []
    }

    func enqueue(type: String, durationSec: Int, distanceKm: Double) {
        pending.append(Pending(id: UUID(), type: type, durationSec: max(0, durationSec), distanceKm: max(0, distanceKm), finishedAt: .now))
        persist()
    }

    func flush() async {
        guard NetworkMonitor.shared.isOnline, !pending.isEmpty else { return }
        var remaining: [Pending] = []
        for item in pending {
            do {
                let note = "Recorded offline • finished \(item.finishedAt.formatted(date: .abbreviated, time: .shortened))"
                _ = try await APIClient.shared.logManualWorkout(type: item.type, durationMin: Double(item.durationSec) / 60, distanceKm: item.distanceKm > 0 ? item.distanceKm : nil, note: note)
            } catch { remaining.append(item) }
        }
        pending = remaining
        persist()
    }

    private func persist() { UserDefaults.standard.set(try? JSONEncoder().encode(pending), forKey: key) }
}
