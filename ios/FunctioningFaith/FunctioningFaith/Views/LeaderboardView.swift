import SwiftUI

/// The last 7 days, scoped to the member plus who they follow -- never a
/// global ranking, matching the server's own LEADERBOARD_METRICS route.
struct LeaderboardView: View {
    private static let metrics: [(key: String, label: String)] = [
        ("distance_km", "Distance"), ("duration_min", "Time"), ("workouts", "Workouts"),
    ]

    @State private var metric = "distance_km"
    @State private var entries: [LeaderboardEntry] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            Picker("Metric", selection: $metric) {
                ForEach(Self.metrics, id: \.key) { m in Text(m.label).tag(m.key) }
            }
            .pickerStyle(.segmented)
            .padding()
            content
        }
        .navigationTitle("Leaderboard")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onChange(of: metric) { _, _ in Task { await load() } }
        .refreshable { await load() }
        .alert("Could not load the leaderboard", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && entries.isEmpty {
            ProgressView()
            Spacer()
        } else if entries.isEmpty {
            ContentUnavailableView("Nothing this week", systemImage: "trophy", description: Text("Log a workout, or follow people who do, to see a ranking here."))
        } else {
            List(entries) { entry in
                entryRow(entry)
            }
            .ffListChrome()
            .listStyle(.plain)
        }
    }

    private func entryRow(_ entry: LeaderboardEntry) -> some View {
        HStack {
            Text("\(entry.rank)").font(.subheadline.weight(.semibold)).frame(width: 28, alignment: .leading)
            Text(entry.isMe ? "You" : entry.displayName)
                .font(entry.isMe ? .subheadline.weight(.semibold) : .subheadline)
            Spacer()
            Text(valueLabel(entry.value)).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
        .listRowBackground(entry.isMe ? Color.accentColor.opacity(0.1) : Color.clear)
    }

    private func valueLabel(_ value: Double) -> String {
        switch metric {
        case "distance_km": return String(format: "%.1f km", value)
        case "duration_min": return "\(Int(value)) min"
        default: return "\(Int(value)) workouts"
        }
    }

    private func load() async {
        isLoading = true
        do { entries = try await APIClient.shared.fetchLeaderboard(metric: metric) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

#Preview { NavigationStack { LeaderboardView() } }
