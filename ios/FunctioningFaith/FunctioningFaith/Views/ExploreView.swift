import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Explore hub — mirrors web `renderExplore` / `renderExploreIndex` surface area:
/// reels, journeys, recruiting, people, challenges, groups, quests, and Discover links
/// (scripture, breathwork, heart check-in, podcasts, church, news, videos, stats).
struct ExploreView: View {
    @State private var suggestions: [SuggestedUser] = []
    @State private var isLoadingSuggestions = true
    @State private var suggestionsError: String?
    @State private var groups: [ExploreGroup] = []
    @State private var quests: [ExploreQuest] = []
    @State private var challenges: [ExploreChallenge] = []
    @State private var isLoadingContent = true
    @State private var contentError: String?
    @State private var actionError: String?

    var body: some View {
        List {
            Section {
                ExploreCatalogGrid()
            } footer: {
                Text("Choose any section directly. Returning to Explore always brings you back to this dashboard.")
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)

            Section {
                NavigationLink { ScriptureView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "book.fill", tint: FFTheme.scripture)
                        Text("Scripture")
                    }
                }
                NavigationLink { BibleBrowseView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "books.vertical.fill", tint: FFTheme.scripture)
                        Text("Bible browse")
                    }
                }
                NavigationLink { ScripturePracticeView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "checkmark.circle.fill", tint: FFTheme.scripture)
                        Text("Scripture practice")
                    }
                }
                NavigationLink { SavedVersesView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "bookmark.fill", tint: FFTheme.gold)
                        Text("Saved verses")
                    }
                }
                NavigationLink { BreathworkView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "wind", tint: FFTheme.hearth)
                        Text("Breathwork")
                    }
                }
                NavigationLink { HeartCheckInView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "heart.text.square.fill", tint: FFTheme.seal)
                        Text("Heart check-in")
                    }
                }
            } header: {
                Text("Faith & body")
            } footer: {
                Text("Same surfaces as the web Scripture / Breathe flows — verified verse text only; models never author Scripture.")
            }
            .listRowBackground(FFTheme.parchment1)

            Section {
                if isLoadingSuggestions {
                    ProgressView("Finding your community…")
                } else if let suggestionsError {
                    FFErrorStateView(message: suggestionsError, onRetry: { Task { await loadExplore() } })
                } else if suggestions.isEmpty {
                    Text("You’re all caught up. Check back as more people join your communities.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(suggestions) { user in
                        HStack(spacing: 12) {
                            Image(systemName: "person.crop.circle.fill")
                                .font(.title2)
                                .foregroundStyle(FFTheme.meadow)
                                .background(FFTheme.parchment2, in: Circle())
                                .ffGradientRing()
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
                            .buttonStyle(.ffPrimary)
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
            .listRowBackground(FFTheme.parchment1)

            Section("Challenges") {
                if isLoadingContent {
                    ProgressView()
                } else if let contentError {
                    FFErrorStateView(message: contentError, onRetry: { Task { await loadExplore() } })
                } else if challenges.isEmpty {
                    Text("New challenges are being prepared.").foregroundStyle(.secondary)
                } else {
                    ForEach(challenges) { challenge in
                        VStack(alignment: .leading, spacing: 7) {
                            HStack(alignment: .top) {
                                FFIconBadge(systemImage: "flame.fill", tint: challenge.completed ? FFTheme.emerald : FFTheme.hearth)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(challenge.name).font(.headline)
                                    Text(challenge.description ?? challenge.flavor ?? "")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button(challenge.joined ? "Joined" : "Join") {
                                    join(challenge)
                                }
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
                }
            }
            .listRowBackground(FFTheme.parchment1)

            Section("Groups") {
                if isLoadingContent {
                    ProgressView()
                } else if let contentError {
                    FFErrorStateView(message: contentError, onRetry: { Task { await loadExplore() } })
                } else if groups.isEmpty {
                    Text("No groups yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(groups.prefix(8)) { group in
                        NavigationLink {
                            GroupDetailView(group: group)
                        } label: {
                            HStack(spacing: FFTheme.Space.sm) {
                                FFIconBadge(systemImage: "person.3.fill", tint: FFTheme.meadow2)
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
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
            .listRowBackground(FFTheme.parchment1)

            Section("Quests") {
                if isLoadingContent {
                    ProgressView()
                } else if let contentError {
                    FFErrorStateView(message: contentError, onRetry: { Task { await loadExplore() } })
                } else {
                    ForEach(quests) { quest in
                        HStack(spacing: FFTheme.Space.sm) {
                            FFIconBadge(systemImage: "sparkles", tint: FFTheme.hearth)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(quest.name).font(.headline)
                                Text(quest.description ?? "").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
            .listRowBackground(FFTheme.parchment1)

            Section("Discover") {
                NavigationLink { StatsView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "chart.bar.fill", tint: FFTheme.gold)
                        Text("Stats & goals")
                    }
                }
                NavigationLink { MotivationExploreView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "bolt.fill", tint: FFTheme.hearth)
                        Text("Motivation")
                    }
                }
                NavigationLink { PodcastsView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "microphone.fill", tint: FFTheme.gold)
                        Text("Podcasts")
                    }
                }
                NavigationLink { ChurchFinderView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "building.2.fill", tint: FFTheme.scripture)
                        Text("Find a church nearby")
                    }
                }
                NavigationLink { NewsView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "newspaper.fill", tint: FFTheme.hearth)
                        Text("News")
                    }
                }
                NavigationLink { VideoLibraryView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "play.rectangle.fill", tint: FFTheme.meadow)
                        Text("Videos")
                    }
                }
                NavigationLink { SearchView() } label: {
                    HStack(spacing: FFTheme.Space.sm) {
                        FFIconBadge(systemImage: "magnifyingglass", tint: FFTheme.meadow)
                        Text("Search people & posts")
                    }
                }
            }
            .listRowBackground(FFTheme.parchment1)
        }
        .ffListChrome()
        .navigationTitle("Explore")
        // Registered here, on the List itself, rather than down inside
        // ExploreCatalogGrid -- a List row can be torn down and recreated
        // as its content scrolls in and out of view, and a
        // navigationDestination registered that deep isn't guaranteed to
        // survive that the way one anchored at the stack's root content is.
        .navigationDestination(for: ExploreCatalogItem.self) { item in item.destination }
        .task { await loadExplore() }
        .refreshable { await loadExplore() }
        .alert("Couldn’t complete that action", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: {
            Text(actionError ?? "")
        }
    }

    private func loadExplore() async {
        isLoadingSuggestions = true
        isLoadingContent = true
        suggestionsError = nil
        contentError = nil
        async let suggestionsResult: Result<[SuggestedUser], Error> = loadSuggestions()
        async let contentResult: Result<ExploreContent, Error> = loadContent()
        let (loadedSuggestions, loadedContent) = await (suggestionsResult, contentResult)
        guard !Task.isCancelled else { return }

        switch loadedSuggestions {
        case .success(let value): suggestions = value
        case .failure(let error): suggestionsError = error.localizedDescription
        }
        switch loadedContent {
        case .success(let content):
            groups = content.groups
            quests = content.quests
            challenges = content.challenges
        case .failure(let error): contentError = error.localizedDescription
        }
        isLoadingSuggestions = false
        isLoadingContent = false
    }

    private func loadSuggestions() async -> Result<[SuggestedUser], Error> {
        do { return .success(try await APIClient.shared.fetchSuggestedUsers()) }
        catch { return .failure(error) }
    }

    private func loadContent() async -> Result<ExploreContent, Error> {
        do { return .success(try await APIClient.shared.fetchExploreContent()) }
        catch { return .failure(error) }
    }

    private func follow(_ user: SuggestedUser) {
        Task {
            do {
                let response = try await APIClient.shared.followUser(id: user.id)
                guard let index = suggestions.firstIndex(where: { $0.id == user.id }) else { return }
                suggestions[index].isFollowing = response.following
                #if canImport(UIKit)
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                #endif
            } catch { actionError = error.localizedDescription }
        }
    }

    private func join(_ challenge: ExploreChallenge) {
        Task {
            do {
                _ = try await APIClient.shared.joinChallenge(id: challenge.id)
                guard let index = challenges.firstIndex(where: { $0.id == challenge.id }) else { return }
                challenges[index].joined = true
                challenges[index].participants += 1
            } catch { actionError = error.localizedDescription }
        }
    }
}

#Preview { NavigationStack { ExploreView() } }
