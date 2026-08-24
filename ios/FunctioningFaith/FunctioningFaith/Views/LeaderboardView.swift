import SwiftUI

/// Fixed picker of metrics APIClient.fetchLeaderboard accepts (see its own
/// doc comment) — server falls back to distance for anything else, so this
/// is the only place a metric string gets typed.
enum LeaderboardMetric: String, CaseIterable, Identifiable, Hashable {
    case distanceKm = "distance_km"
    case durationMin = "duration_min"
    case workouts = "workouts"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .distanceKm: return "Distance"
        case .durationMin: return "Time"
        case .workouts: return "Workouts"
        }
    }

    func format(_ value: Double) -> String {
        switch self {
        case .distanceKm:
            return String(format: "%.1f km", value)
        case .durationMin:
            let minutes = Int(value)
            return minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes)m"
        case .workouts:
            let count = Int(value)
            return "\(count) workout\(count == 1 ? "" : "s")"
        }
    }
}

private enum LeaderboardWindow: Int, CaseIterable, Identifiable {
    case week = 7, month = 30, season = 90
    var id: Int { rawValue }
    var label: String { self == .week ? "7 days" : self == .month ? "30 days" : "90 days" }
    var description: String { self == .week ? "this week" : self == .month ? "the last 30 days" : "the last 90 days" }
}

/// Weekly standings for you and people you follow — mirrors web Explore → Leaderboard.
struct LeaderboardView: View {
    @State private var metric: LeaderboardMetric = .distanceKm
    @State private var window: LeaderboardWindow = .week
    @State private var rows: [LeaderboardEntry] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && rows.isEmpty {
                ProgressView("Loading leaderboard…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage, rows.isEmpty {
                FFErrorStateView(message: errorMessage) {
                    Task { await load() }
                }
            } else {
                List {
                    Section {
                        Picker("Metric", selection: $metric) {
                            ForEach(LeaderboardMetric.allCases) { m in
                                Text(m.label).tag(m)
                            }
                        }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .onChange(of: metric) { _, _ in
                            Task { await load() }
                        }
                        Picker("History", selection: $window) {
                            ForEach(LeaderboardWindow.allCases) { window in
                                Text(window.label).tag(window)
                            }
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: window) { _, _ in Task { await load() } }
                    } footer: {
                        Text("You and everyone you follow, ranked by activity from \(window.description). Every ranking and personal best is free for everyone.")
                    }

                    if rows.isEmpty {
                        Section {
                            ContentUnavailableView(
                                "Follow a few people",
                                systemImage: "person.2",
                                description: Text("When friends log workouts, they’ll show up here with you.")
                            )
                        }
                        .listRowBackground(FFTheme.parchment1)
                    } else {
                        Section {
                            ForEach(rows) { row in
                                LeaderboardRow(entry: row, metric: metric)
                            }
                        }
                        .listRowBackground(FFTheme.parchment1)
                    }
                }
                .ffListChrome()
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .navigationTitle("Leaderboard")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            rows = try await APIClient.shared.fetchLeaderboard(metric: metric.rawValue, days: window.rawValue)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

private struct LeaderboardRow: View {
    let entry: LeaderboardEntry
    let metric: LeaderboardMetric

    var body: some View {
        HStack(spacing: 14) {
            Text(rankLabel)
                .font(.title3.weight(.bold))
                .frame(width: 36, alignment: .center)
                .accessibilityLabel("Rank \(entry.rank)")

            Image(systemName: "person.crop.circle.fill")
                .font(.title2)
                .foregroundStyle(entry.isMe ? FFTheme.meadow : FFTheme.inkSoft)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(entry.displayName)
                        .font(.headline)
                    if entry.isMe {
                        Text("(you)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(metric.format(entry.value))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .listRowBackground(entry.isMe ? FFTheme.parchment1.opacity(0.85) : nil)
        .accessibilityElement(children: .combine)
    }

    private var rankLabel: String {
        switch entry.rank {
        case 1: return "🥇"
        case 2: return "🥈"
        case 3: return "🥉"
        default: return "\(entry.rank)"
        }
    }
}

#Preview {
    NavigationStack { LeaderboardView() }
}
