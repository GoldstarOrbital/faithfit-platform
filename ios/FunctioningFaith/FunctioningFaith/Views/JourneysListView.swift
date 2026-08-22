import SwiftUI

struct JourneysListView: View {
    @State private var journeys: [JourneySummary] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && journeys.isEmpty {
                ProgressView("Loading worlds…")
            } else if journeys.isEmpty {
                ContentUnavailableView("No journeys yet", systemImage: "map", description: Text("Pull to refresh, then choose a route through scripture and story."))
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: FFTheme.Space.lg) {
                        JourneyIntroCard()
                        ForEach(worlds, id: \.self) { world in
                            VStack(alignment: .leading, spacing: FFTheme.Space.sm) {
                                Text(world.uppercased()).font(FFTheme.eyebrow()).tracking(1.2).foregroundStyle(FFTheme.inkSoft)
                                ForEach(journeys.filter { $0.world == world }) { journey in
                                    NavigationLink { JourneyDetailView(journeyKey: journey.key) } label: {
                                        JourneyRouteCard(journey: journey)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    .padding(FFTheme.Space.md)
                }
                .background(FFTheme.parchment0.ignoresSafeArea())
                .refreshable { await load() }
            }
        }
        .navigationTitle("Journeys")
        .task { await load() }
        .alert("Could not load journeys", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private var worlds: [String] { Array(Set(journeys.map(\.world))).sorted() }

    private func load() async {
        isLoading = true
        do { journeys = try await APIClient.shared.fetchJourneys() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

private struct JourneyIntroCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("MOVE THROUGH THE STORY", systemImage: "sparkles")
                .font(FFTheme.eyebrow()).tracking(1).foregroundStyle(FFTheme.cream)
            Text("Every real mile moves your marker.")
                .font(FFTheme.display(24, weight: .bold, relativeTo: .title2)).foregroundStyle(FFTheme.cream)
            Text("Choose a world, unlock waypoints, and take segments against friends.")
                .font(.subheadline).foregroundStyle(FFTheme.cream.opacity(0.86))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(FFTheme.Space.md)
        .background(LinearGradient(colors: [FFTheme.walnut0, FFTheme.meadowDeep], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous))
    }
}

private struct JourneyRouteCard: View {
    let journey: JourneySummary
    private var progress: Int { journey.percent ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            JourneyWorldVisual(world: journey.world, progress: progress, compact: true)
            HStack(alignment: .firstTextBaseline) {
                Text(journey.name).font(FFTheme.display(19, weight: .bold, relativeTo: .headline)).foregroundStyle(FFTheme.ink)
                Spacer()
                if journey.completed { Image(systemName: "checkmark.seal.fill").foregroundStyle(FFTheme.emerald) }
            }
            if let subtitle = journey.subtitle { Text(subtitle).font(.subheadline).foregroundStyle(FFTheme.inkSoft).lineLimit(2) }
            if journey.joined {
                ProgressView(value: Double(progress), total: 100).tint(journey.completed ? FFTheme.emerald : FFTheme.hearth)
                HStack {
                    Text("\(String(format: "%.1f", journey.progressKm ?? 0)) / \(String(format: "%.1f", journey.totalKm)) km")
                    Spacer()
                    Text(journey.completed ? "Complete" : "Continue")
                }
                .font(.caption.weight(.semibold)).foregroundStyle(FFTheme.inkSoft)
                if let next = journey.nextWaypoint {
                    Label("Next: \(next.title) · \(String(format: "%.1f", next.kmRemaining)) km", systemImage: "mappin.and.ellipse")
                        .font(.caption).foregroundStyle(FFTheme.scripture)
                }
            } else {
                HStack {
                    Label("\(String(format: "%.0f", journey.totalKm)) km", systemImage: "figure.run")
                    Spacer()
                    Text("\(journey.travellers) travelling")
                }
                .font(.caption.weight(.semibold)).foregroundStyle(FFTheme.inkSoft)
            }
        }
        .padding(FFTheme.Space.sm)
        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous).strokeBorder(FFTheme.hairline, lineWidth: 1))
        .shadow(color: FFTheme.walnut.opacity(0.10), radius: 8, x: 0, y: 3)
        .accessibilityHint("Open \(journey.name)")
    }
}

#Preview { NavigationStack { JourneysListView() } }
