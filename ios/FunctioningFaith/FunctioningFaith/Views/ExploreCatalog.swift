import SwiftUI

/// Railway `EXPLORE_SECTIONS` — the native Explore tab opens on this catalogue
/// so the whole member product is visible at a glance, same as `renderExploreIndex`.
enum ExploreCatalogItem: String, CaseIterable, Identifiable, Hashable {
    case journeys, challenges, videos, reels, podcasts, scripture
    case groups, leaderboard, breathe, motivation, news, recruiting

    var id: String { rawValue }

    var name: String {
        switch self {
        case .journeys: return "Journeys"
        case .challenges: return "Challenges"
        case .videos: return "Videos"
        case .reels: return "Reels"
        case .podcasts: return "Podcasts"
        case .scripture: return "Scripture"
        case .groups: return "Groups"
        case .leaderboard: return "Leaderboard"
        case .breathe: return "Breathe"
        case .motivation: return "Motivation"
        case .news: return "News"
        case .recruiting: return "Recruiting"
        }
    }

    var blurb: String {
        switch self {
        case .journeys: return "Ride or run a 3D route through scripture and story."
        case .challenges: return "Themed distance and effort goals to join."
        case .videos: return "Kids, fitness, and short teaching films."
        case .reels: return "Scroll short encouragement, movement, faith, and food."
        case .podcasts: return "Full episodes from public faith and fitness feeds."
        case .scripture: return "Search the Bible and join the conversation on a verse."
        case .groups: return "Your churches and clubs, their chat and meetups."
        case .leaderboard: return "Where you stand this week."
        case .breathe: return "A guided breathing pause with scripture."
        case .motivation: return "Short encouragement for the middle of a hard week."
        case .news: return "Christian news headlines from independent outlets."
        case .recruiting: return "Athlete stat profiles and coach connections, by sport."
        }
    }

    var systemImage: String {
        switch self {
        case .journeys: return "map.fill"
        case .challenges: return "flame.fill"
        case .videos: return "play.rectangle.fill"
        case .reels: return "rectangle.stack.fill"
        case .podcasts: return "mic.fill"
        case .scripture: return "book.fill"
        case .groups: return "person.3.fill"
        case .leaderboard: return "trophy.fill"
        case .breathe: return "wind"
        case .motivation: return "bolt.fill"
        case .news: return "newspaper.fill"
        case .recruiting: return "figure.run.circle.fill"
        }
    }

    var colors: [Color] {
        switch self {
        case .journeys: return [FFTheme.meadow2, FFTheme.meadowDeep]
        case .challenges: return [FFTheme.hearth, FFTheme.gold]
        case .videos: return [FFTheme.meadow, FFTheme.forest]
        case .reels: return [FFTheme.hearth, FFTheme.goldBright]
        case .podcasts: return [FFTheme.gold, FFTheme.hearth]
        case .scripture: return [FFTheme.forest, FFTheme.meadowDeep]
        case .groups: return [FFTheme.meadow, FFTheme.meadowDeep]
        case .leaderboard: return [FFTheme.goldBright, FFTheme.gold]
        case .breathe: return [FFTheme.hearth, FFTheme.hearthSoft]
        case .motivation: return [FFTheme.goldBright, FFTheme.hearth]
        case .news: return [FFTheme.hearth, FFTheme.seal]
        case .recruiting: return [FFTheme.emerald, FFTheme.meadowDeep]
        }
    }

    @ViewBuilder
    var destination: some View {
        switch self {
        case .journeys: JourneysListView()
        case .challenges: ChallengesHubView()
        case .videos: VideoLibraryView()
        case .reels: ReelsFeedView()
        case .podcasts: PodcastsView()
        case .scripture: ScriptureView()
        case .groups: GroupsHubView()
        case .leaderboard: LeaderboardView()
        case .breathe: BreathworkView()
        case .motivation: MotivationExploreView()
        case .news: NewsView()
        case .recruiting: AthleteSearchView()
        }
    }
}

struct ExploreCatalogGrid: View {
    private let columns = [GridItem(.flexible(), spacing: FFTheme.Space.sm), GridItem(.flexible(), spacing: FFTheme.Space.sm)]

    var body: some View {
        VStack(alignment: .leading, spacing: FFTheme.Space.sm) {
            Text("Everything Functioning Faith has beyond your own training. Pick a section.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            LazyVGrid(columns: columns, spacing: FFTheme.Space.sm) {
                ForEach(ExploreCatalogItem.allCases) { item in
                    NavigationLink(value: item) {
                        VStack(alignment: .leading, spacing: 6) {
                            Image(systemName: item.systemImage)
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(FFTheme.cream)
                                .frame(width: 36, height: 36)
                                .background(
                                    LinearGradient(colors: item.colors, startPoint: .topLeading, endPoint: .bottomTrailing),
                                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                                )
                            Text(item.name)
                                .font(.headline)
                                .foregroundStyle(FFTheme.ink)
                            Text(item.blurb)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
                        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
                        .contentShape(RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
                    }
                    .accessibilityHint("Open \(item.name)")
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct ChallengesHubView: View {
    @State private var challenges: [ExploreChallenge] = []
    @State private var isLoading = true

    var body: some View {
        List {
            Section {
                Text("Themed journeys through scripture and story. Join one — your workouts move you forward.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }
            Section {
                if isLoading {
                    ProgressView()
                } else if challenges.isEmpty {
                    Text("New challenges are being prepared.").foregroundStyle(.secondary)
                } else {
                    ForEach(challenges) { challenge in
                        challengeRow(challenge)
                    }
                }
            }
            .listRowBackground(FFTheme.parchment1)
        }
        .ffListChrome()
        .navigationTitle("Challenges")
        .task { await load() }
        .refreshable { await load() }
    }

    private func challengeRow(_ challenge: ExploreChallenge) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .top) {
                FFIconBadge(systemImage: "flame.fill", tint: challenge.completed ? FFTheme.emerald : FFTheme.hearth)
                VStack(alignment: .leading, spacing: 3) {
                    Text(challenge.name).font(.headline)
                    Text(challenge.description ?? challenge.flavor ?? "")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button(challenge.joined ? "Joined" : "Join") { join(challenge) }
                    .buttonStyle(.ffGhost)
                    .disabled(challenge.joined)
            }
            ProgressView(value: Double(challenge.percent), total: 100)
                .tint(challenge.completed ? FFTheme.emerald : FFTheme.hearth)
            HStack {
                Text("\(challenge.percent)%")
                Spacer()
                Text("\(challenge.participants) participating")
            }
            .font(.caption2).foregroundStyle(.secondary)
            if let reference = challenge.scriptureReference {
                Text(reference).font(.caption.weight(.semibold)).foregroundStyle(FFTheme.scripture)
            }
        }
        .padding(.vertical, 5)
    }

    private func load() async {
        isLoading = true
        challenges = (try? await APIClient.shared.fetchExploreContent())?.challenges ?? []
        isLoading = false
    }

    private func join(_ challenge: ExploreChallenge) {
        Task {
            guard (try? await APIClient.shared.joinChallenge(id: challenge.id)) != nil,
                  let index = challenges.firstIndex(where: { $0.id == challenge.id }) else { return }
            challenges[index].joined = true
            challenges[index].participants += 1
        }
    }
}

struct GroupsHubView: View {
    @State private var groups: [ExploreGroup] = []
    @State private var isLoading = true

    var body: some View {
        List {
            if isLoading {
                ProgressView()
            } else if groups.isEmpty {
                Text("No groups yet.").foregroundStyle(.secondary)
            } else {
                ForEach(groups) { group in
                    NavigationLink {
                        GroupDetailView(group: group)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(group.name).font(.headline)
                            if let description = group.description {
                                Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                            Text("\(group.memberCount) members").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .ffListChrome()
        .navigationTitle("Groups")
        .task {
            isLoading = true
            groups = (try? await APIClient.shared.fetchExploreContent())?.groups ?? []
            isLoading = false
        }
    }
}

struct MotivationExploreView: View {
    @State private var quote: MotivationQuote?
    @State private var isLoading = false

    var body: some View {
        VStack(spacing: 20) {
            if let quote {
                Text("“\(quote.text)”")
                    .font(.title3.italic())
                    .multilineTextAlignment(.center)
                if let attribution = quote.attribution {
                    Text(attribution)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            } else if isLoading {
                ProgressView()
            } else {
                Text("No quote right now.").foregroundStyle(.secondary)
            }
            Button("Another") { Task { await load() } }
                .buttonStyle(.ffPrimary)
            Text("Fact-checked attributions — never a generated fake quote.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .navigationTitle("Motivation")
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        quote = try? await APIClient.shared.fetchMotivationQuote()
        isLoading = false
    }
}
