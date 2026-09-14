import SwiftUI

/// Live location is shared only after a deliberate recipient choice. The
/// server accepts updates only for a current workout and expires them in four
/// hours; this view never creates a public map.
struct BeaconSafetyView: View {
    @ObservedObject private var activeWorkout = ActiveWorkoutSession.shared
    @Environment(\.dismiss) private var dismiss
    @State private var candidates: [CircleCandidate] = []
    @State private var selected: Set<String> = []
    @State private var status = ""
    @State private var isLoading = true
    @State private var loadError: String?
    var body: some View {
        NavigationStack {
            List {
                Section { Text("Share your live workout location with people you choose. It expires automatically after four hours and is never public.").font(.subheadline) }
                Section("Trusted people") {
                    if isLoading {
                        HStack { Spacer(); ProgressView("Loading trusted people…"); Spacer() }
                    } else if let loadError {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(loadError).foregroundStyle(.secondary)
                            Button("Try again") { Task { await loadCandidates() } }.buttonStyle(.ffPrimary)
                        }
                    } else if candidates.isEmpty {
                        ContentUnavailableView("No trusted people yet", systemImage:"person.2", description:Text("Add a follower to your trusted circle in Safety settings first."))
                    } else {
                        ForEach(candidates) { person in
                            Toggle(person.displayName, isOn: Binding(
                                get: { selected.contains(person.userID) },
                                set: { isOn in
                                    if isOn { selected.insert(person.userID) }
                                    else { selected.remove(person.userID) }
                                }
                            ))
                        }
                    }
                }
                if !status.isEmpty { Section { Text(status).font(.caption).foregroundStyle(.secondary) } }
            }.navigationTitle("Safety Beacon").toolbar { ToolbarItem(placement:.confirmationAction) { Button("Share") { Task { await share() } }.disabled(selected.isEmpty || activeWorkout.tracker.points.last == nil) }; ToolbarItem(placement:.cancellationAction) { Button("Done") { dismiss() } } }.task { await loadCandidates() }
        }
    }
    private func loadCandidates() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            candidates = try await APIClient.shared.fetchCircleCandidates().filter(\.inCircle)
            selected = Set(activeWorkout.beaconRecipients.map(\.uuidString))
        } catch is CancellationError {
            return
        } catch {
            loadError = "Couldn’t load your trusted people. Check your connection and try again."
        }
    }
    private func share() async {
        let recipients = Set(selected.compactMap(UUID.init(uuidString:)))
        guard !recipients.isEmpty else { status = "Choose at least one trusted person."; return }
        do {
            try await activeWorkout.enableBeacon(for: recipients)
            status = "Beacon is live and will update throughout this workout."
        } catch {
            status = activeWorkout.tracker.points.last == nil
                ? "Waiting for an accurate GPS location."
                : error.localizedDescription
        }
    }
}
