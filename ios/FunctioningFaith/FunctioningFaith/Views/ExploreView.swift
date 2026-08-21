import SwiftUI

/// Explore hub — mirrors web `renderExplore` / `renderExploreIndex` surface area:
/// reels, journeys, recruiting, people, challenges, groups, quests, and Discover links
/// (scripture, breathwork, heart check-in, podcasts, church, news, videos, stats).
struct ExploreView: View {
    @State private var suggestions: [SuggestedUser] = []
    @State private var isLoadingSuggestions = true
    @State private var groups: [ExploreGroup] = []
    @State private var quests: [ExploreQuest] = []
    @State private var challenges: [ExploreChallenge] = []
    @State private var isLoadingContent = true

    var body: some View {
        List {
            Section {
                NavigationLink {
                    ReelsFeedView()
                } label: {
                    Label("Reels", systemImage: "play.rectangle.fill")
                }
                NavigationLink {
                    JourneysListView()
                } label: {
                    Label("Journeys", systemImage: "map.fill")
                }
                NavigationLink {
                    AthleteSearchView()
                } label: {
                    Label("Athlete Recruiting", systemImage: "figure.run.circle.fill")
                }
                NavigationLink {
                    StatsView()
                } label: {
                    Label("Stats & goals", systemImage: "chart.bar.fill")
                }
                NavigationLink {
                    LeaderboardView()
                } label: {
                    Label("Leaderboard", systemImage: "trophy.fill")
                }
            } footer: {
                Text("Journeys track real distance toward scripture-marked waypoints. Recruiting browses public, .edu-verified athlete profiles. Stats mirrors the web Stats tab (moved here so Messages can stay in the tab bar).")
            }

            Section {
                NavigationLink { ScriptureView() } label: {
                    Label("Scripture", systemImage: "book.fill")
                }
                NavigationLink { BibleBrowseView() } label: {
                    Label("Bible browse", systemImage: "books.vertical")
                }
                NavigationLink { ScripturePracticeView() } label: {
                    Label("Scripture practice", systemImage: "checkmark.circle")
                }
                NavigationLink { SavedVersesView() } label: {
                    Label("Saved verses", systemImage: "bookmark.fill")
                }
                NavigationLink { BreathworkView() } label: {
                    Label("Breathwork", systemImage: "wind")
                }
                NavigationLink { HeartCheckInView() } label: {
                    Label("Heart check-in", systemImage: "heart.text.square")
                }
            } header: {
                Text("Faith & body")
            } footer: {
                Text("Same surfaces as the web Scripture / Breathe flows — verified verse text only; models never author Scripture.")
            }

            Section {
                if isLoadingSuggestions {
                    ProgressView("Finding your community…")
                } else if suggestions.isEmpty {
                    Text("You’re all caught up. Check back as more people join your communities.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(suggestions) { user in
                        HStack(spacing: 12) {
                            Image(systemName: "person.crop.circle.fill")
                                .font(.title2)
                                .foregroundStyle(FFTheme.meadow)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(user.displayName).font(.headline)
                                Text(user.reason).font(.caption).foregroundStyle(.secondary)
                                if let bio = user.bio, !bio.isEmpty {
                                    Text(bio).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            Spacer()
                            Button(user.isFollowing ? "Following" : "Follow") {
                                follow(user)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(user.isFollowing ? .gray : FFTheme.meadow)
                            .disabled(user.isFollowing)
                        }
                        .padding(.vertical, 4)
                    }
                }
            } header: {
                Text("People for you")
            } footer: {
                Text("Suggestions are based on shared communities and mutual connections.")
            }

            Section("Challenges") {
                if isLoadingContent {
                    ProgressView()
                } else if challenges.isEmpty {
                    Text("New challenges are being prepared.").foregroundStyle(.secondary)
                } else {
                    ForEach(challenges.prefix(6)) { challenge in
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(challenge.name).font(.headline)
                                    Text(challenge.description ?? challenge.flavor ?? "")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button(challenge.joined ? "Joined" : "Join") {
                                    join(challenge)
                                }
                                .buttonStyle(.bordered)
                                .tint(FFTheme.meadow)
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
                }
            }

            Section("Groups") {
                if isLoadingContent {
                    ProgressView()
                } else if groups.isEmpty {
                    Text("No groups yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(groups.prefix(8)) { group in
                        NavigationLink {
                            GroupDetailView(group: group)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(group.name).font(.headline)
                                if let description = group.description {
                                    Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                                HStack {
                                    if let sport = group.sport { Label(sport, systemImage: "figure.run") }
                                    Spacer()
                                    Text("\(group.memberCount) members")
                                }
                                .font(.caption2).foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }

            Section("Quests") {
                if isLoadingContent {
                    ProgressView()
                } else {
                    ForEach(quests) { quest in
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(quest.name).font(.headline)
                                Text(quest.description ?? "").font(.caption).foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: "sparkles").foregroundStyle(FFTheme.hearth)
                        }
                    }
                }
            }

            Section("Discover") {
                NavigationLink { PodcastsView() } label: {
                    Label("Podcasts", systemImage: "mic")
                }
                NavigationLink { ChurchFinderView() } label: {
                    Label("Find a church nearby", systemImage: "building.2")
                }
                NavigationLink { NewsView() } label: {
                    Label("News", systemImage: "newspaper")
                }
                NavigationLink { VideoLibraryView() } label: {
                    Label("Videos", systemImage: "play.rectangle")
                }
                NavigationLink { SearchView() } label: {
                    Label("Search people & posts", systemImage: "magnifyingglass")
                }
            }
        }
        .navigationTitle("Explore")
        .task { await loadExplore() }
        .refreshable { await loadExplore() }
    }

    private func loadExplore() async {
        isLoadingSuggestions = true
        isLoadingContent = true
        let suggestionsTask = Task { try? await APIClient.shared.fetchSuggestedUsers() }
        let contentTask = Task { try? await APIClient.shared.fetchExploreContent() }
        suggestions = (await suggestionsTask.value) ?? []
        if let content = await contentTask.value {
            groups = content.groups
            quests = content.quests
            challenges = content.challenges
        }
        isLoadingSuggestions = false
        isLoadingContent = false
    }

    private func follow(_ user: SuggestedUser) {
        Task {
            guard let response = try? await APIClient.shared.followUser(id: user.id),
                  let index = suggestions.firstIndex(where: { $0.id == user.id }) else { return }
            suggestions[index].isFollowing = response.following
        }
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

#Preview { NavigationStack { ExploreView() } }
