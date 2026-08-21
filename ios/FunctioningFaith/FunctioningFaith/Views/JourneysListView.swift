import SwiftUI

struct JourneysListView: View {
    @State private var journeys: [JourneySummary] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && journeys.isEmpty {
                ProgressView()
            } else if journeys.isEmpty {
                ContentUnavailableView("No journeys yet", systemImage: "map", description: Text("Journeys aren't enabled on this server, or none exist yet."))
            } else {
                List {
                    ForEach(Dictionary(grouping: journeys, by: \.world).keys.sorted(), id: \.self) { world in
                        Section(world) {
                            ForEach(journeys.filter { $0.world == world }) { journey in
                                NavigationLink(value: journey.key) { JourneyRow(journey: journey) }
                            }
                        }
                        .listRowBackground(FFTheme.parchment1)
                    }
                }
                .ffListChrome()
                .refreshable { await load() }
            }
        }
        .navigationTitle("Journeys")
        .navigationDestination(for: String.self) { key in JourneyDetailView(journeyKey: key) }
        .task { await load() }
        .alert("Could not load journeys", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        do { journeys = try await APIClient.shared.fetchJourneys() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

private struct JourneyRow: View {
    let journey: JourneySummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(journey.name).font(FFTheme.display(17))
                Spacer()
                if journey.completed { Image(systemName: "checkmark.seal.fill").foregroundStyle(FFTheme.emerald) }
            }
            if let subtitle = journey.subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
            if journey.joined, let percent = journey.percent {
                ProgressView(value: Double(percent), total: 100)
                    .tint(journey.completed ? FFTheme.emerald : FFTheme.hearth)
                HStack {
                    Text("\(String(format: "%.1f", journey.progressKm ?? 0)) / \(String(format: "%.1f", journey.totalKm)) km")
                    Spacer()
                    Text("\(percent)%")
                }
                .font(.caption2).foregroundStyle(.secondary)
                if let next = journey.nextWaypoint {
                    Text("Next: \(next.title) · \(String(format: "%.1f", next.kmRemaining)) km away")
                        .font(.caption2).foregroundStyle(.tint)
                }
            } else {
                Text("\(String(format: "%.0f", journey.totalKm)) km · \(journey.travellers) travelling")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview { NavigationStack { JourneysListView() } }
