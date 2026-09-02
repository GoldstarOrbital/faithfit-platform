import SwiftUI

struct AthleteProfileDetailView: View {
    let userID: String
    let displayName: String
    @State private var profile: AthleteProfile?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && profile == nil {
                ProgressView()
            } else if let profile {
                List {
                    headerSection(profile)
                    statsSection(profile)
                    if !profile.sportStats.isEmpty { sportStatsSection(profile) }
                    if !profile.videos.isEmpty { videosSection(profile) }
                    if !profile.teams.isEmpty { teamsSection(profile) }
                    if !profile.awards.isEmpty { awardsSection(profile) }
                    if !profile.endorsements.isEmpty { endorsementsSection(profile) }
                    linksSection(profile)
                }
                .ffListChrome()
            }
        }
        .navigationTitle(displayName)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .alert("Could not load profile", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        do { profile = try await APIClient.shared.fetchAthleteProfile(userID: userID) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    @ViewBuilder
    private func headerSection(_ p: AthleteProfile) -> some View {
        Section {
            HStack(spacing: 10) {
                Label(p.sport, systemImage: "figure.run")
                if let position = p.position { Text("· \(position)") }
                Spacer()
                if let year = p.gradYear { Text("Class of \(year)").foregroundStyle(.secondary) }
            }
            if let school = p.school, !school.isEmpty { Label(school, systemImage: "building.columns") }
            if let handedness = p.handedness { Label(handedness.capitalized + "-handed", systemImage: "hand.raised") }
            if let heightCM = p.heightCM { Label(heightLabel(heightCM), systemImage: "ruler") }
            if let bio = p.bio, !bio.isEmpty { Text(bio).font(.callout).padding(.top, 4) }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func heightLabel(_ cm: Int) -> String {
        let totalInches = Double(cm) / 2.54
        let feet = Int(totalInches / 12)
        let inches = Int(totalInches.truncatingRemainder(dividingBy: 12).rounded())
        return "\(feet)'\(inches)\""
    }

    private func statsSection(_ p: AthleteProfile) -> some View {
        Section {
            HStack {
                statTile("Workouts (90d)", "\(p.stats.workouts90d)")
                statTile("Distance (90d)", Units.distanceString(km: p.stats.distanceKm90d, decimals: 1))
                if let hr = p.stats.avgHR90d { statTile("Avg HR", "\(hr) bpm") }
            }
        } header: { Text("Real training data") } footer: { Text("Pulled live from logged workouts, not self-reported.") }
        .listRowBackground(FFTheme.parchment1)
    }

    private func statTile(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.subheadline.weight(.semibold))
            Text(title).font(.caption2).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sportStatsSection(_ p: AthleteProfile) -> some View {
        Section("\(p.sport) stats") {
            ForEach(p.sportStats) { stat in
                HStack {
                    Text(stat.label)
                    Spacer()
                    Text("\(stat.value)\(stat.unit.isEmpty ? "" : " \(stat.unit)")").foregroundStyle(.secondary)
                    sourceBadge(stat)
                }
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    @ViewBuilder
    private func sourceBadge(_ stat: SportStatEntry) -> some View {
        if stat.confirmedBy > 0 {
            Label("\(stat.confirmedBy)", systemImage: "checkmark.seal.fill").font(.caption2).foregroundStyle(FFTheme.emerald)
        } else if stat.source == "csv" {
            Text("CSV").font(.caption2).foregroundStyle(FFTheme.meadow)
        }
    }

    private func videosSection(_ p: AthleteProfile) -> some View {
        Section("Highlight videos") {
            ForEach(p.videos) { video in
                if let url = URL(string: video.url) {
                    Link(destination: url) { Label(video.title ?? "Video", systemImage: "play.rectangle.fill") }
                }
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func teamsSection(_ p: AthleteProfile) -> some View {
        Section("Teams") {
            ForEach(p.teams) { team in
                VStack(alignment: .leading) {
                    Text(team.teamName)
                    if team.level != nil || team.season != nil {
                        Text([team.level, team.season].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func awardsSection(_ p: AthleteProfile) -> some View {
        Section("Awards") {
            ForEach(p.awards) { award in
                HStack {
                    Label(award.title, systemImage: "trophy.fill")
                    Spacer()
                    if let year = award.year { Text(String(year)).foregroundStyle(.secondary) }
                }
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func endorsementsSection(_ p: AthleteProfile) -> some View {
        Section("Coach endorsements") {
            ForEach(p.endorsements) { endorsement in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\u{201C}\(endorsement.quote)\u{201D}").italic()
                    Text([endorsement.coachName, endorsement.coachTitle, endorsement.coachOrganization].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(.vertical, 3)
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    @ViewBuilder
    private func linksSection(_ p: AthleteProfile) -> some View {
        if p.maxprepsURL != nil || p.gamechangerURL != nil {
            Section("Verify at the source") {
                if let s = p.maxprepsURL, let url = URL(string: s) { Link("MaxPreps", destination: url) }
                if let s = p.gamechangerURL, let url = URL(string: s) { Link("GameChanger", destination: url) }
            }
            .listRowBackground(FFTheme.parchment1)
        }
    }
}

#Preview { NavigationStack { AthleteProfileDetailView(userID: "preview", displayName: "Preview Athlete") } }
