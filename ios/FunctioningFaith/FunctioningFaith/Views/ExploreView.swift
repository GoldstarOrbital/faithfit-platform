import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Explore's "Community" sub-tab (see AppShell.swift's ExploreSectionShell,
/// which also has Faith, Reels, Discover, and Search peers) -- the
/// Community & Movement catalog tiles (Groups, Journeys, Challenges,
/// Leaderboard, Recruiting), live "People for you" suggestions, and compact
/// horizontal previews of what's happening in Challenges/Groups/Quests.
///
/// This used to be the whole of Explore, with Faith and Discover's tiles
/// mixed in below it and a second, full list of plain NavigationLinks
/// duplicating several destinations (Scripture, Breathe, Motivation, News,
/// Videos, Podcasts) plus full inline copies of the Challenges and Groups
/// lists you could already reach from the catalog. Splitting Faith/Discover
/// out into their own tabs, and giving Reels and Search their own tabs too,
/// is what actually fixed the "everything shown twice" problem -- narrowing
/// what any one screen tries to be, not just editing the list.
struct ExploreCommunityView: View {
    @State private var suggestions: [SuggestedUser] = []
    @State private var isLoadingSuggestions = true
    @State private var suggestionsError: String?
    @State private var groups: [ExploreGroup] = []
    @State private var quests: [ExploreQuest] = []
    @State private var challenges: [ExploreChallenge] = []
    @State private var isLoadingContent = true
    @State private var contentError: String?
    @State private var actionError: String?
    // A List row containing both a NavigationLink and another tappable
    // sibling (the Follow button) only ever gets one tap target for the
    // whole row -- routing "open this profile" through a plain Button +
    // this shared destination keeps Follow a genuinely separate target.
    @State private var openedSuggestion: UUID?
    @State private var selectedGroupID: String?

    var body: some View {
        List {
            Section {
                ExploreCatalogGrid(categories: [.community])
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)

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
                            Button { openedSuggestion = user.id } label: {
                                HStack(spacing: 12) {
                                    MemberAvatarView(userID: user.id, hasAvatar: user.hasAvatar, size: 44)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(user.displayName).font(.headline)
                                        Text(user.reason).font(.caption).foregroundStyle(.secondary)
                                        if let bio = user.bio, !bio.isEmpty {
                                            Text(bio).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                        }
                                    }
                                    Spacer(minLength: 0)
                                }
                            }
                            .buttonStyle(.plain)
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

            Section {
                if isLoadingContent {
                    ProgressView()
                } else if let contentError {
                    FFErrorStateView(message: contentError, onRetry: { Task { await loadExplore() } })
                } else if challenges.isEmpty && groups.isEmpty && quests.isEmpty {
                    Text("Nothing happening yet — check back soon.").foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: FFTheme.Space.lg) {
                        if !challenges.isEmpty {
                            previewCarousel(title: "Challenges", seeAll: AnyView(ChallengesHubView())) {
                                ForEach(challenges.prefix(6)) { challengeCard($0) }
                            }
                        }
                        if !groups.isEmpty {
                            previewCarousel(title: "Groups", seeAll: AnyView(GroupsHubView())) {
                                ForEach(groups.prefix(6)) { groupCard($0) }
                            }
                        }
                        if !quests.isEmpty {
                            previewCarousel(title: "Quests", seeAll: nil) {
                                ForEach(quests.prefix(6)) { questCard($0) }
                            }
                        }
                    }
                    .padding(.vertical, FFTheme.Space.xxs)
                }
            } header: {
                Text("Happening now")
            }
            .listRowBackground(FFTheme.parchment1)
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        }
        .ffListChrome()
        .navigationTitle("Community")
        .task { await loadExplore() }
        .refreshable { await loadExplore(forceRefresh: true) }
        .navigationDestination(item: $openedSuggestion) { id in MemberProfileView(userID: id) }
        .navigationDestination(item: $selectedGroupID) { id in
            if let group = groups.first(where: { $0.id == id }) { GroupDetailView(group: group) }
        }
        .alert("Couldn’t complete that action", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - Happening now: compact previews

    @ViewBuilder
    private func previewCarousel<Content: View>(title: String, seeAll: AnyView?, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: FFTheme.Space.xs) {
            HStack {
                Text(title).font(.headline).foregroundStyle(FFTheme.ink)
                Spacer()
                if let seeAll {
                    NavigationLink { seeAll } label: { Text("See all").font(.caption.weight(.semibold)) }
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: FFTheme.Space.sm) { content() }
                .padding(.bottom, 2)
            }
        }
    }

    private func challengeCard(_ challenge: ExploreChallenge) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            FFIconBadge(systemImage: "flame.fill", tint: challenge.completed ? FFTheme.emerald : FFTheme.hearth)
            Text(challenge.name).font(.subheadline.weight(.semibold)).foregroundStyle(FFTheme.ink).lineLimit(2)
            ProgressView(value: Double(challenge.percent), total: 100)
                .tint(challenge.completed ? FFTheme.emerald : FFTheme.hearth)
            HStack {
                Text("\(challenge.percent)%").font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Button(challenge.joined ? "Joined" : "Join") { join(challenge) }
                    .buttonStyle(.ffGhost)
                    .disabled(challenge.joined)
                    .font(.caption2)
            }
        }
        .padding(FFTheme.Space.sm)
        .frame(width: 180, alignment: .leading)
        .background(FFTheme.parchment2, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
    }

    private func groupCard(_ group: ExploreGroup) -> some View {
        Button { selectedGroupID = group.id } label: {
            VStack(alignment: .leading, spacing: 6) {
                FFIconBadge(systemImage: "person.3.fill", tint: FFTheme.meadow2)
                Text(group.name).font(.subheadline.weight(.semibold)).foregroundStyle(FFTheme.ink).lineLimit(2)
                if let sport = group.sport, !sport.isEmpty {
                    Text(sport).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Text("\(group.memberCount) member\(group.memberCount == 1 ? "" : "s")")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .padding(FFTheme.Space.sm)
            .frame(width: 160, alignment: .leading)
            .background(FFTheme.parchment2, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func questCard(_ quest: ExploreQuest) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            FFIconBadge(systemImage: "sparkles", tint: FFTheme.hearth)
            Text(quest.name).font(.subheadline.weight(.semibold)).foregroundStyle(FFTheme.ink).lineLimit(2)
            if let description = quest.description, !description.isEmpty {
                Text(description).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(FFTheme.Space.sm)
        .frame(width: 170, alignment: .leading)
        .background(FFTheme.parchment2, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
    }

    private func loadExplore(forceRefresh: Bool = false) async {
        isLoadingSuggestions = true
        isLoadingContent = true
        suggestionsError = nil
        contentError = nil
        async let suggestionsResult: Result<[SuggestedUser], Error> = loadSuggestions(forceRefresh: forceRefresh)
        async let contentResult: Result<ExploreContent, Error> = loadContent(forceRefresh: forceRefresh)
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

    private func loadSuggestions(forceRefresh: Bool = false) async -> Result<[SuggestedUser], Error> {
        do { return .success(try await APIClient.shared.fetchSuggestedUsers(forceRefresh: forceRefresh)) }
        catch { return .failure(error) }
    }

    private func loadContent(forceRefresh: Bool = false) async -> Result<ExploreContent, Error> {
        do { return .success(try await APIClient.shared.fetchExploreContent(forceRefresh: forceRefresh)) }
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

#Preview { NavigationStack { ExploreCommunityView() } }
