import SwiftUI

/// Live location is shared only after a deliberate recipient choice. The
/// server accepts updates only for a current workout and expires them in four
/// hours; this view never creates a public map.
struct BeaconSafetyView: View {
    let workoutID: UUID
    let location: [Double]?
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
            }.navigationTitle("Safety Beacon").toolbar { ToolbarItem(placement:.confirmationAction) { Button("Share") { Task { await share() } }.disabled(selected.isEmpty || location == nil) }; ToolbarItem(placement:.cancellationAction) { Button("Done") { dismiss() } } }.task { await loadCandidates() }
        }
    }
    private func loadCandidates() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            candidates = try await APIClient.shared.fetchCircleCandidates()
        } catch is CancellationError {
            return
        } catch {
            loadError = "Couldn’t load your trusted people. Check your connection and try again."
        }
    }
    private func share() async {
        guard let location, location.count == 2 else { status="Waiting for an accurate GPS location."; return }
        do { for id in selected { guard let uuid=UUID(uuidString:id) else { continue }; _=try await APIClient.shared.updateWorkoutBeacon(id:workoutID, recipientID:uuid, latitude:location[0], longitude:location[1], accuracyM:nil) }; status="Beacon is live for your selected people." } catch { status=error.localizedDescription }
    }
}
