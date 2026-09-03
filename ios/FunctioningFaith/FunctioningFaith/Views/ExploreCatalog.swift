import SwiftUI
import CoreLocation

/// Railway `EXPLORE_SECTIONS` — the native Explore tab opens on this catalogue
/// so the whole member product is visible at a glance, same as `renderExploreIndex`.
///
/// Every destination Explore can open lives here exactly once. Explore used
/// to show this catalog grid AND a second, separate list of plain
/// NavigationLinks underneath it -- several pointing at the very same
/// screens (Scripture, Breathe, Motivation, News, Videos, Podcasts, the full
/// Challenges/Groups lists), so the tab read as two competing menus. The fix
/// was to fold every real destination into one categorized catalog instead
/// of pruning the duplicates piecemeal.
enum ExploreCatalogItem: String, CaseIterable, Identifiable, Hashable {
    case scripture, bibleBrowse, scripturePractice, savedVerses, bibleAnswers, breathe, heartCheckIn
    case journeys, challenges, groups, leaderboard, recruiting, reels
    case videos, podcasts, motivation, news, churchFinder, search

    enum Category: String, CaseIterable, Identifiable {
        case faith = "Faith & Scripture"
        case community = "Community & Movement"
        case discover = "Discover"
        var id: String { rawValue }
    }

    var id: String { rawValue }

    var category: Category {
        switch self {
        case .scripture, .bibleBrowse, .scripturePractice, .savedVerses, .bibleAnswers, .breathe, .heartCheckIn:
            return .faith
        case .journeys, .challenges, .groups, .leaderboard, .recruiting, .reels:
            return .community
        case .videos, .podcasts, .motivation, .news, .churchFinder, .search:
            return .discover
        }
    }

    var name: String {
        switch self {
        case .scripture: return "Scripture"
        case .bibleBrowse: return "Bible Browse"
        case .scripturePractice: return "Scripture Practice"
        case .savedVerses: return "Saved Verses"
        case .bibleAnswers: return "Bible Answers"
        case .breathe: return "Breathe"
        case .heartCheckIn: return "Heart Check-in"
        case .journeys: return "Journeys"
        case .challenges: return "Challenges"
        case .groups: return "Groups"
        case .leaderboard: return "Leaderboard"
        case .recruiting: return "Recruiting"
        case .reels: return "Reels"
        case .videos: return "Videos"
        case .podcasts: return "Podcasts"
        case .motivation: return "Motivation"
        case .news: return "News"
        case .churchFinder: return "Find a Church"
        case .search: return "Search"
        }
    }

    var blurb: String {
        switch self {
        case .scripture: return "Search the Bible and join the conversation on a verse."
        case .bibleBrowse: return "Read any book, chapter by chapter."
        case .scripturePractice: return "Memorize verses with guided practice."
        case .savedVerses: return "Your personal library of kept verses."
        case .bibleAnswers: return "Ask any Bible or faith question — answers cite only verified Scripture."
        case .breathe: return "A guided breathing pause with scripture."
        case .heartCheckIn: return "Log a resting-heart-rate moment and get scripture and a way to breathe."
        case .journeys: return "An interactive virtual world — real workouts move your marker along real routes."
        case .challenges: return "Scripture- and story-themed goals. Join one; your workouts carry it forward."
        case .groups: return "Your churches and clubs, their chat and meetups."
        case .leaderboard: return "Where you stand this week."
        case .recruiting: return "Athlete stat profiles and coach connections, by sport."
        case .reels: return "Scroll short encouragement, movement, faith, and food."
        case .videos: return "Kids, fitness, and short teaching films."
        case .podcasts: return "Full episodes from public faith and fitness feeds."
        case .motivation: return "Short encouragement for the middle of a hard week."
        case .news: return "Christian news headlines from independent outlets."
        case .churchFinder: return "Locate and link a nearby church."
        case .search: return "Find people and posts across the app."
        }
    }

    var systemImage: String {
        switch self {
        case .scripture: return "book.fill"
        case .bibleBrowse: return "books.vertical.fill"
        case .scripturePractice: return "checkmark.circle.fill"
        case .savedVerses: return "bookmark.fill"
        case .bibleAnswers: return "questionmark.bubble.fill"
        case .breathe: return "wind"
        case .heartCheckIn: return "heart.text.square.fill"
        case .journeys: return "map.fill"
        case .challenges: return "flame.fill"
        case .groups: return "person.3.fill"
        case .leaderboard: return "trophy.fill"
        case .recruiting: return "figure.run.circle.fill"
        case .reels: return "rectangle.stack.fill"
        case .videos: return "play.rectangle.fill"
        case .podcasts: return "microphone.fill"
        case .motivation: return "bolt.fill"
        case .news: return "newspaper.fill"
        case .churchFinder: return "building.2.fill"
        case .search: return "magnifyingglass"
        }
    }

    var colors: [Color] {
        switch self {
        case .scripture: return [FFTheme.forest, FFTheme.meadowDeep]
        case .bibleBrowse: return [FFTheme.forest, FFTheme.meadow]
        case .scripturePractice: return [FFTheme.meadow2, FFTheme.forest]
        case .savedVerses: return [FFTheme.gold, FFTheme.hearth]
        case .bibleAnswers: return [FFTheme.forest, FFTheme.meadowDeep]
        case .breathe: return [FFTheme.hearth, FFTheme.hearthSoft]
        case .heartCheckIn: return [FFTheme.seal, FFTheme.hearth]
        case .journeys: return [FFTheme.meadow2, FFTheme.meadowDeep]
        case .challenges: return [FFTheme.hearth, FFTheme.gold]
        case .groups: return [FFTheme.meadow, FFTheme.meadowDeep]
        case .leaderboard: return [FFTheme.goldBright, FFTheme.gold]
        case .recruiting: return [FFTheme.emerald, FFTheme.meadowDeep]
        case .reels: return [FFTheme.hearth, FFTheme.goldBright]
        case .videos: return [FFTheme.meadow, FFTheme.forest]
        case .podcasts: return [FFTheme.gold, FFTheme.hearth]
        case .motivation: return [FFTheme.goldBright, FFTheme.hearth]
        case .news: return [FFTheme.hearth, FFTheme.seal]
        case .churchFinder: return [FFTheme.forest, FFTheme.gold]
        case .search: return [FFTheme.meadow, FFTheme.meadow2]
        }
    }

    @ViewBuilder
    var destination: some View {
        switch self {
        case .scripture: ScriptureView()
        case .bibleBrowse: BibleBrowseView()
        case .scripturePractice: ScripturePracticeView()
        case .savedVerses: SavedVersesView()
        case .bibleAnswers: BibleAnswersView()
        case .breathe: BreathworkView()
        case .heartCheckIn: HeartCheckInView()
        case .journeys: JourneysListView()
        case .challenges: ChallengesHubView()
        case .groups: GroupsHubView()
        case .leaderboard: LeaderboardView()
        case .recruiting: AthleteSearchView()
        case .reels: ReelsFeedView()
        case .videos: VideoLibraryView()
        case .podcasts: PodcastsView()
        case .motivation: MotivationExploreView()
        case .news: NewsView()
        case .churchFinder: ChurchFinderView()
        case .search: SearchView()
        }
    }
}

struct ExploreCatalogGrid: View {
    private let columns = [GridItem(.flexible(), spacing: FFTheme.Space.sm), GridItem(.flexible(), spacing: FFTheme.Space.sm)]
    // Each row of two tiles was showing exactly one trailing disclosure
    // chevron for the whole row (List's automatic behavior for any row
    // containing a NavigationLink), not one per tile -- and that single,
    // row-level chevron is what every first tap after the grid appeared
    // was actually resolving against, regardless of which tile the user
    // meant. Plain Buttons driving a separate, explicit navigationDestination
    // never register as "this row is a nav link" to List in the first
    // place, so it never adds a chevron to steal a tap.
    @State private var selectedItem: ExploreCatalogItem?
    @State private var expandedCategories: Set<ExploreCatalogItem.Category> = [.faith]

    var body: some View {
        VStack(alignment: .leading, spacing: FFTheme.Space.md) {
            ForEach(ExploreCatalogItem.Category.allCases) { category in
                categorySection(category)
            }
        }
        .padding(.vertical, FFTheme.Space.xxs)
        .navigationDestination(item: $selectedItem) { item in
            item.destination
        }
    }

    private func categorySection(_ category: ExploreCatalogItem.Category) -> some View {
        let items = ExploreCatalogItem.allCases.filter { $0.category == category }
        let isExpanded = expandedCategories.contains(category)
        return VStack(alignment: .leading, spacing: FFTheme.Space.xs) {
            Button {
                withAnimation { toggle(category) }
            } label: {
                HStack {
                    Text(category.rawValue)
                        .font(FFTheme.section())
                        .foregroundStyle(FFTheme.ink)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            if isExpanded {
                LazyVGrid(columns: columns, spacing: FFTheme.Space.sm) {
                    ForEach(items) { item in
                        tile(item)
                    }
                }
            }
        }
    }

    private func toggle(_ category: ExploreCatalogItem.Category) {
        if expandedCategories.contains(category) { expandedCategories.remove(category) }
        else { expandedCategories.insert(category) }
    }

    private func tile(_ item: ExploreCatalogItem) -> some View {
        Button {
            selectedItem = item
        } label: {
            VStack(alignment: .leading, spacing: FFTheme.Space.xs) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(FFTheme.cream)
                    .frame(width: 36, height: 36)
                    .background(
                        LinearGradient(colors: item.colors, startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: FFTheme.Radius.sm, style: .continuous)
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
            .padding(FFTheme.Space.sm)
            .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
            .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Open \(item.name)")
    }
}

struct ChallengesHubView: View {
    @State private var challenges: [ExploreChallenge] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                Text("Goals drawn from scripture and story — Frodo's Sprint, the Emmaus Road, Gideon's 300. Join one and let your workouts carry you toward it.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }
            Section {
                if isLoading {
                    FFLoadingView(message: "Loading challenges…")
                } else if let errorMessage {
                    FFErrorStateView(message: errorMessage, onRetry: { Task { await load() } })
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
                    Text(challenge.flavor ?? challenge.description ?? "")
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
        errorMessage = nil
        do {
            challenges = try await APIClient.shared.fetchExploreContent().challenges
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
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
    @EnvironmentObject private var session: NativeSession
    @StateObject private var locator = ChurchLocator()
    @State private var groups: [ExploreGroup] = []
    @State private var nearby: [NearbyGroup] = []
    @State private var isLoading = true
    @State private var isFindingNearby = false
    @State private var showCreate = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                Button { Task { await findNearby() } } label: {
                    Label(isFindingNearby ? "Finding groups…" : "Find groups near me", systemImage: "location.magnifyingglass")
                }
                .disabled(isFindingNearby)
                if !nearby.isEmpty {
                    ForEach(nearby) { group in
                        NavigationLink { GroupDetailView(group: exploreGroup(group)) } label: {
                            GroupDiscoveryRow(group: group)
                        }
                    }
                }
            } header: { Text("Near you") } footer: {
                Text("Only public groups that choose an approximate location appear here.")
            }
            if isLoading {
                FFLoadingView(message: "Loading groups…")
            } else if let errorMessage, groups.isEmpty {
                FFErrorStateView(message: errorMessage, onRetry: { Task { await load() } })
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
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { showCreate = true } label: { Image(systemName: "plus.circle.fill") }.accessibilityLabel("Create group") } }
        .sheet(isPresented: $showCreate) {
            NavigationStack { CreateGroupView { await load() } }
                .environmentObject(session)
        }
        .alert("Groups", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
        .task {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            groups = try await APIClient.shared.fetchExploreContent().groups
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func findNearby() async {
        isFindingNearby = true
        defer { isFindingNearby = false }
        do {
            let point = try await locator.currentLocation()
            nearby = try await APIClient.shared.fetchNearbyGroups(lat: point.coordinate.latitude, lng: point.coordinate.longitude)
        } catch { errorMessage = error.localizedDescription }
    }

    private func exploreGroup(_ group: NearbyGroup) -> ExploreGroup {
        ExploreGroup(id: group.id, name: group.name, description: group.description, username: group.username,
                     churchName: group.churchName, locationName: group.locationName, sport: group.sport,
                     memberCount: group.memberCount ?? 0)
    }
}

private struct GroupDiscoveryRow: View {
    let group: NearbyGroup
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack { Text(group.name).font(.headline); Spacer(); if let distance = group.distanceKm { Text(Units.distanceString(km: distance, decimals: 1)).font(.caption.weight(.semibold)).foregroundStyle(.tint) } }
            Text([group.sport, group.locationName, group.churchName].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(.vertical, 3)
    }
}

private struct CreateGroupView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: NativeSession
    @StateObject private var locator = ChurchLocator()
    // Property-wrapper attributes only apply to the first declaration in a
    // comma-separated list. Keep these separate so every control has a SwiftUI
    // binding and mutations made by `create()` persist in the view state.
    @State private var name = ""
    @State private var username = ""
    @State private var description = ""
    @State private var sport = ""
    @State private var locationName = ""
    @State private var isPrivate = false
    @State private var useCurrentLocation = true
    @State private var isSaving = false
    @State private var errorMessage: String?
    let onCreated: () async -> Void

    var body: some View {
        Form {
            Section("Group") {
                TextField("Name", text: $name)
                TextField("Group username", text: $username)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Sport or focus (optional)", text: $sport)
                TextField("What is this group for?", text: $description, axis: .vertical).lineLimit(3...6)
            }
            Section("Discovery") {
                Toggle("Use my current location for discovery", isOn: $useCurrentLocation)
                TextField("Location name (optional)", text: $locationName)
                Toggle("Private group", isOn: $isPrivate)
                Text("You are the group admin. Public groups can be found nearby; private groups are invite-only.").font(.caption).foregroundStyle(.secondary)
            }
            Section {
                Button(isSaving ? "Creating…" : "Create group") { Task { await create() } }
                    .frame(maxWidth: .infinity).disabled(isSaving || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .navigationTitle("Create group")
        .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } } }
        .alert("Could not create group", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "") }
    }

    private func create() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let location = useCurrentLocation ? try await locator.currentLocation() : nil
            _ = try await APIClient.shared.createGroup(name: name.trimmingCharacters(in: .whitespaces), username: username.trimmingCharacters(in: .whitespaces), description: description, sport: sport, locationName: locationName, latitude: location?.coordinate.latitude, longitude: location?.coordinate.longitude, visibility: isPrivate ? "private" : "public", church: session.profile)
            await onCreated()
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}

struct MotivationExploreView: View {
    @State private var quote: MotivationQuote?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
        if isLoading && quote == nil {
            FFLoadingView(message: "Finding encouragement…")
        } else if let errorMessage, quote == nil {
            FFErrorStateView(message: errorMessage, onRetry: { Task { await load() } })
        } else {
        VStack(spacing: FFTheme.Space.lg) {
            if let quote {
                Text("“\(quote.text)”")
                    .font(.title3.italic())
                    .multilineTextAlignment(.center)
                if let attribution = quote.attribution {
                    Text(attribution)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
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
        .padding(FFTheme.Space.lg)
        }
        }
        // Was attached to the VStack inside the "loaded" branch only -- but
        // that branch can never render until load() has already run once,
        // and nothing else ever called it, so the view was stuck on the
        // loading spinner forever on every first appearance. Attaching it to
        // the outer Group means it fires regardless of which branch is
        // currently showing.
        .navigationTitle("Motivation")
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            quote = try await APIClient.shared.fetchMotivationQuote()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
