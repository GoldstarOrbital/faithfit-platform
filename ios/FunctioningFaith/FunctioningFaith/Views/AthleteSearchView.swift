import SwiftUI

/// Read-only athlete discovery: search + filter, tap through to a full
/// public profile. Editing your own athlete profile, coach-side matching/
/// roster/saved-searches, and CSV stat import are separate, larger features
/// not ported in this pass -- see the header comment in Models.swift.
struct AthleteSearchView: View {
    @State private var results: [AthleteSearchResult] = []
    @State private var query = ""
    @State private var selectedSport = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchTask: Task<Void, Never>?

    // Matches lib/athletes.js's SPORTS list exactly.
    private let sports = [
        "Football", "Basketball", "Baseball", "Softball", "Soccer", "Track & Field",
        "Cross Country", "Volleyball", "Wrestling", "Swimming", "Tennis", "Golf",
        "Lacrosse", "Hockey", "Rowing", "Gymnastics", "Other",
    ]

    var body: some View {
        Group {
            if isLoading && results.isEmpty {
                ProgressView()
            } else if results.isEmpty {
                ContentUnavailableView("No athletes found", systemImage: "figure.run", description: Text("Try a different sport or search term."))
            } else {
                List(results) { athlete in
                    NavigationLink {
                        AthleteProfileDetailView(userID: athlete.userID, displayName: athlete.displayName)
                    } label: {
                        AthleteResultRow(athlete: athlete)
                    }
                }
            }
        }
        .navigationTitle("Athlete Recruiting")
        .searchable(text: $query, prompt: "Name or school")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("All sports") { selectedSport = ""; Task { await search() } }
                    ForEach(sports, id: \.self) { sport in
                        Button(sport) { selectedSport = sport; Task { await search() } }
                    }
                } label: {
                    Label(selectedSport.isEmpty ? "Sport" : selectedSport, systemImage: "line.3.horizontal.decrease.circle")
                }
            }
        }
        .onChange(of: query) { _, _ in
            searchTask?.cancel()
            searchTask = Task {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                await search()
            }
        }
        .task { await search() }
        .alert("Could not load athletes", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func search() async {
        isLoading = true
        do { results = try await APIClient.shared.searchAthletes(sport: selectedSport, query: query) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

private struct AthleteResultRow: View {
    let athlete: AthleteSearchResult

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(athlete.displayName).font(.headline)
                Spacer()
                if let year = athlete.gradYear { Text("Class of \(year)").font(.caption).foregroundStyle(.secondary) }
            }
            HStack(spacing: 10) {
                Label(athlete.sport, systemImage: "figure.run")
                if let position = athlete.position { Text(position) }
            }
            .font(.caption).foregroundStyle(.secondary)
            if let school = athlete.school, !school.isEmpty {
                Text(school).font(.caption2).foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                Label("\(athlete.stats.workouts90d) workouts / 90d", systemImage: "chart.bar")
                if athlete.videoCount > 0 { Label("\(athlete.videoCount)", systemImage: "video") }
                if athlete.awardCount > 0 { Label("\(athlete.awardCount)", systemImage: "trophy") }
                if athlete.endorsementCount > 0 { Label("\(athlete.endorsementCount)", systemImage: "checkmark.seal") }
            }
            .font(.caption2).foregroundStyle(.tint)
        }
        .padding(.vertical, 4)
    }
}

#Preview { NavigationStack { AthleteSearchView() } }
