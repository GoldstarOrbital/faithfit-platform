import SwiftUI
import AVKit
#if canImport(UIKit)
import UIKit
#endif

struct HomeFeedView: View {
    @EnvironmentObject private var session: NativeSession
    @EnvironmentObject private var deepLinks: DeepLinkRouter
    @EnvironmentObject private var dmStore: DMStore
    @State private var posts: [FeedPost] = []
    @State private var isLoading = true
    @State private var isLoadingMore = false
    @State private var nextCursor: String?
    @State private var feedError: String?
    @State private var actionError: String?
    @State private var selectedPost: FeedPost?
    @State private var showComposer = false
    @State private var blockCandidate: (id: UUID, name: String)?
    @State private var showBlockConfirmation = false
    @State private var showNotifications = false
    @State private var unreadNotifications = 0
    @State private var showSearch = false

    var body: some View {
        List {
            HomeRhythmHeader()
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 4, trailing: 16))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            HomeActionsRow()
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            ScriptureInMotionCard()
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            StoriesRail()
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            FromExploreRail()
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            MotivationCard()
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            FriendsWorkoutsRail()
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            TrendingTagsRail()
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            ForEach(posts) { post in
                FeedPostRow(
                    post: post,
                    onLike: { toggleLike(post) },
                    onSave: { toggleSave(post) },
                    onComments: { selectedPost = post },
                    onReport: { report(post) },
                    onBlock: {
                        guard let authorID = post.authorID else { return }
                        blockCandidate = (authorID, post.authorName)
                        showBlockConfirmation = true
                    },
                    onDelete: post.authorID == session.profile?.id ? { delete(post) } : nil
                )
                    .onAppear { loadNextPageIfNeeded(post) }
                    .swipeActions(edge: .trailing) {
                        Button { toggleLike(post) } label: { Label(post.likedByMe ? "Unlike" : "Like", systemImage: post.likedByMe ? "heart.slash" : "heart.fill") }
                            .tint(FFTheme.hearth)
                        Button { toggleSave(post) } label: { Label(post.savedByMe ? "Unsave" : "Save", systemImage: post.savedByMe ? "bookmark.slash" : "bookmark.fill") }
                            .tint(FFTheme.meadow)
                    }
            }
            if isLoadingMore {
                HStack {
                    Spacer()
                    ProgressView("Loading more")
                    Spacer()
                }
                .listRowSeparator(.hidden)
            }
        }
        .ffListChrome()
        .listStyle(.plain)
        .refreshable { await loadFeed() }
        .navigationTitle("Home")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showComposer = true } label: { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel("Create post")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showNotifications = true } label: {
                    badgedIcon("bell", count: unreadNotifications)
                }
                .accessibilityLabel(unreadNotifications > 0 ? "Notifications, \(unreadNotifications) unread" : "Notifications")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { deepLinks.selectedTab = .messages } label: {
                    badgedIcon("bubble.left.and.bubble.right", count: dmStore.unreadTotal)
                }
                .accessibilityLabel(dmStore.unreadTotal > 0 ? "Messages, \(dmStore.unreadTotal) unread" : "Messages")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSearch = true } label: { Image(systemName: "magnifyingglass") }
                    .accessibilityLabel("Search")
            }
        }
        .navigationDestination(isPresented: $showNotifications) { NotificationsView() }
        .navigationDestination(isPresented: $showSearch) { SearchView() }
        .task {
            await loadFeed()
            unreadNotifications = (try? await APIClient.shared.fetchNotifications().unreadCount) ?? 0
        }
        .sheet(isPresented: $showComposer) {
            NavigationStack {
                PostComposerView {
                    showComposer = false
                    Task { await loadFeed() }
                }
            }
        }
        .sheet(item: $selectedPost) { post in
            NavigationStack {
                CommentThreadView(post: post) {
                    if let index = posts.firstIndex(where: { $0.id == post.id }) {
                        posts[index].commentCount += 1
                    }
                }
            }
        }
        .confirmationDialog(
            "Block this member?",
            isPresented: $showBlockConfirmation,
            titleVisibility: .visible
        ) {
            Button("Block \(blockCandidate?.name ?? "member")", role: .destructive) {
                guard let candidate = blockCandidate else { return }
                block(candidate.id)
            }
            Button("Cancel", role: .cancel) { blockCandidate = nil }
        } message: {
            Text("Their posts and messages will no longer appear to you. You can manage blocks from their profile later.")
        }
        .overlay {
            if isLoading && posts.isEmpty {
                FFLoadingView(message: "Loading your community…")
            } else if let feedError, posts.isEmpty {
                FFErrorStateView(message: feedError, onRetry: { Task { await loadFeed() } })
            } else if !isLoading && posts.isEmpty {
                FFEmptyStateView(title: "Your feed is ready", systemImage: "person.2", message: "Follow people, join a group, or share your first activity to see community updates here.")
            }
        }
        .alert("Couldn’t complete that action", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: { Text(actionError ?? "") }
    }

    private func loadFeed() async {
        isLoading = true
        defer { isLoading = false }
        feedError = nil
        do {
            let page = try await APIClient.shared.fetchFeedPage()
            guard !Task.isCancelled else { return }
            posts = page.posts
            nextCursor = page.nextCursor
        } catch {
            guard !Task.isCancelled else { return }
            feedError = error.localizedDescription
        }
    }

    private func loadNextPageIfNeeded(_ post: FeedPost) {
        guard post.id == posts.last?.id, nextCursor != nil, !isLoadingMore else { return }
        Task { await loadMore() }
    }

    private func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await APIClient.shared.fetchFeedPage(before: cursor)
            guard !Task.isCancelled else { return }
            let existing = Set(posts.map(\.id))
            posts.append(contentsOf: page.posts.filter { !existing.contains($0.id) })
            nextCursor = page.nextCursor
        } catch {
            guard !Task.isCancelled else { return }
            actionError = "Couldn’t load more posts. Pull down to try again."
        }
    }

    private func toggleLike(_ post: FeedPost) {
        Task {
            do {
                let response = try await APIClient.shared.likePost(id: post.id)
                guard let index = posts.firstIndex(where: { $0.id == post.id }) else { return }
                posts[index].likedByMe = response.liked
                posts[index].likeCount = response.likeCount
                #if canImport(UIKit)
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                #endif
            } catch { actionError = error.localizedDescription }
        }
    }

    private func toggleSave(_ post: FeedPost) {
        Task {
            do {
                let response = try await APIClient.shared.savePost(id: post.id)
                guard let index = posts.firstIndex(where: { $0.id == post.id }) else { return }
                posts[index].savedByMe = response.saved
            } catch { actionError = error.localizedDescription }
        }
    }

    private func report(_ post: FeedPost) {
        Task {
            do { try await APIClient.shared.reportPost(id: post.id, reason: "Reported from the native feed") }
            catch { actionError = error.localizedDescription }
        }
    }

    private func delete(_ post: FeedPost) {
        Task {
            do {
                try await APIClient.shared.deletePost(id: post.id)
                posts.removeAll { $0.id == post.id }
            } catch { actionError = error.localizedDescription }
        }
    }

    private func block(_ id: UUID) {
        Task {
            do {
                _ = try await APIClient.shared.blockUser(id: id)
                posts.removeAll { $0.authorID == id }
                blockCandidate = nil
            } catch { actionError = error.localizedDescription }
        }
    }

    @ViewBuilder
    private func badgedIcon(_ systemName: String, count: Int) -> some View {
        ZStack(alignment: .topTrailing) {
            Image(systemName: systemName)
            if count > 0 {
                Circle().fill(FFTheme.seal).frame(width: 8, height: 8).offset(x: 3, y: -3)
            }
        }
    }
}

struct FeedPostRow: View {
    let post: FeedPost
    let onLike: () -> Void
    let onSave: () -> Void
    let onComments: () -> Void
    let onReport: () -> Void
    let onBlock: () -> Void
    // Non-nil only for the signed-in member's own post -- report/block make
    // no sense against yourself, and delete makes no sense against anyone
    // else's post.
    var onDelete: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let authorID = post.authorID {
                NavigationLink {
                    MemberProfileView(userID: authorID)
                } label: {
                    Label(post.authorName, systemImage: "person.circle.fill")
                        .font(.system(.subheadline, design: .default).weight(.semibold))
                        .foregroundStyle(FFTheme.ink)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(post.authorName)'s profile")
            } else {
                Text(post.authorName)
                    .font(.system(.subheadline, design: .default).weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
            }

            Text(post.content)
                .font(.system(size: 16))
                .dynamicTypeSize(.large ... .accessibility3)

            if let workout = post.workout {
                WorkoutCard(workout: workout)
            }

            if let verse = post.verse {
                VerseSnippetCard(verse: verse)
            }

            #if canImport(UIKit)
            if let dataURL = post.photoData, let image = ImageUpload.decode(dataURL) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity, minHeight: 190, maxHeight: 360)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .accessibilityLabel(post.photoCategory.map { "Post photo: \($0)" } ?? "Post photo")
            }
            #endif
            if let dataURL = post.videoData {
                FeedVideoView(dataURL: dataURL)
                    .accessibilityLabel(post.videoCategory.map { "Post video: \($0)" } ?? "Post video")
            }

            HStack(spacing: 18) {
                Button(action: onLike) {
                    Label("\(post.likeCount)", systemImage: post.likedByMe ? "heart.fill" : "heart")
                }
                .tint(post.likedByMe ? FFTheme.hearth : .secondary)

                Button(action: onSave) {
                    Label(post.savedByMe ? "Saved" : "Save", systemImage: post.savedByMe ? "bookmark.fill" : "bookmark")
                }
                .tint(post.savedByMe ? FFTheme.scripture : .secondary)

                Button(action: onComments) {
                    Label("\(post.commentCount)", systemImage: "bubble.left")
                }
                .tint(.secondary)

                if post.visibility == "public", let url = URL(string: "/w/\(post.id.uuidString.lowercased())", relativeTo: APIClient.shared.baseURL)?.absoluteURL {
                    ShareLink(item: url, subject: Text("Functioning Faith"), message: Text(post.content)) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    .tint(.secondary)
                } else {
                    ShareLink(item: post.content) { Label("Share", systemImage: "square.and.arrow.up") }
                        .tint(.secondary)
                }
                Spacer()
            }
            .buttonStyle(.borderless)
            .font(.footnote.weight(.semibold))
            .accessibilityElement(children: .contain)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .contain)
        .contextMenu {
            if let onDelete {
                Button("Delete post", role: .destructive, action: onDelete)
            } else {
                Button("Report post", role: .destructive, action: onReport)
                if post.authorID != nil {
                    Button("Block \(post.authorName)", role: .destructive, action: onBlock)
                }
            }
        }
    }
}

/// A feed post's video attachment -- tap-to-play with standard AVKit chrome,
/// not autoplay: unlike the dedicated Reels tab's full-bleed paging feed,
/// this sits inside an ordinary scrolling list mixed with text/photo posts,
/// where several videos autoplaying at once would be both jarring and
/// wasteful. Same decode shape as ReelPlayerView's modal player -- MP4/MOV
/// only, WebM has no AVFoundation decoder on iOS.
internal struct FeedVideoView: View {
    let dataURL: String
    @State private var player: AVPlayer?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player)
            } else if let errorMessage {
                ContentUnavailableView(errorMessage, systemImage: "exclamationmark.triangle")
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220, maxHeight: 360)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .task { prepare() }
    }

    private func prepare() {
        guard player == nil else { return }
        if dataURL.hasPrefix("data:video/webm") {
            errorMessage = "This video format isn't supported for playback."
            return
        }
        guard let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]))
        else { errorMessage = "This video could not be decoded."; return }
        let fileExtension = dataURL.hasPrefix("data:video/quicktime") ? "mov" : "mp4"
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(fileExtension)
        do {
            try data.write(to: tempURL)
            player = AVPlayer(url: tempURL)
        } catch {
            errorMessage = "This video could not be saved for playback."
        }
    }
}

struct WorkoutCard: View {
    let workout: WorkoutSummary
    var body: some View {
        HStack {
            Image(systemName: "figure.run").imageScale(.large)
            VStack(alignment: .leading) {
                Text(workout.type).font(.footnote.weight(.semibold))
                if let cal = workout.calories, let hr = workout.avgHR {
                    Text("\(cal) kcal · avg HR \(hr)").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct VerseSnippetCard: View {
    let verse: VerseSnippet
    // A plain Button + navigationDestination(isPresented:), not a
    // NavigationLink -- this card renders inside a List row that may
    // already contain another NavigationLink (the post author's name, in
    // FeedPostRow), and two NavigationLinks sharing one row is exactly the
    // pattern that produced Explore's chevron-misrouting bug.
    @State private var showThread = false

    var body: some View {
        Button {
            showThread = true
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(verse.reference).font(.caption.weight(.bold)).foregroundStyle(FFTheme.scripture)
                Text(verse.snippet).font(.caption).italic()
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FFTheme.scripture.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Scripture: \(verse.reference). \(verse.snippet)")
        .accessibilityHint("Double tap to read and discuss this verse")
        .navigationDestination(isPresented: $showThread) {
            VerseThreadView(reference: verse.reference)
        }
    }
}

struct HomeRhythmHeader: View {
    @EnvironmentObject private var session: NativeSession

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("YOUR RHYTHM · TODAY")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .tracking(1.2)
            Text("Keep moving, \(firstName)")
                .font(FFTheme.display(28, weight: .bold, relativeTo: .title))
                .foregroundStyle(FFTheme.ink)
            Text("Small steps. Stronger faith. A community moving with you.")
                .font(.subheadline)
                .foregroundStyle(FFTheme.inkSoft)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var firstName: String {
        session.profile?.displayName.split(separator: " ").first.map(String.init) ?? "friend"
    }
}

struct HomeActionsRow: View {
    // "Log activity" was redundant with Scripture in Motion's own "Begin the
    // mission" button just below, which already opens Train -- so this slot
    // becomes a Reels shortcut instead. Both actions are plain Buttons
    // sharing one navigationDestination(item:) rather than one of them being
    // a NavigationLink: a List row with a NavigationLink alongside any other
    // tappable sibling gets exactly one chevron for the whole row, and every
    // tap resolves against it regardless of which side was actually pressed
    // (the same bug already fixed once in this file for the rails below).
    private enum Destination: Hashable { case journeys, reels }
    @State private var destination: Destination?

    var body: some View {
        HStack(spacing: 10) {
            Button { destination = .reels } label: {
                actionCard(title: "Watch Reels", subtitle: "Short encouragement & movement")
            }
            .buttonStyle(.plain)
            Button { destination = .journeys } label: {
                actionCard(title: "Explore routes", subtitle: "Bible & fantasy worlds")
            }
            .buttonStyle(.plain)
        }
        .navigationDestination(item: $destination) { destination in
            switch destination {
            case .journeys: JourneysListView()
            case .reels: ReelsFeedView()
            }
        }
    }

    private func actionCard(title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(FFTheme.ink)
            Text(subtitle).font(.caption).foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
    }
}

struct FromExploreRail: View {
    private let items: [(ExploreCatalogItem, String)] = [
        (.motivation, "Courage, dear heart"),
        (.journeys, "Emmaus · 11 km"),
        (.reels, "Short encouragement"),
        (.groups, "Find or start one"),
        (.scripture, "Search & discuss"),
    ]
    // A plain Button here, not a NavigationLink -- see ExploreCatalogGrid's
    // matching comment, which shares this card shape and had the identical
    // bug: List adds an automatic disclosure chevron to any row containing
    // a NavigationLink, and that single chevron was what a tap was actually
    // resolving against rather than the specific card tapped.
    @State private var selectedItem: ExploreCatalogItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("From Explore")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(items, id: \.0.rawValue) { item, subtitle in
                        Button {
                            selectedItem = item
                        } label: {
                            VStack(alignment: .leading, spacing: 9) {
                                Image(systemName: item.systemImage)
                                    .font(.title3.weight(.bold))
                                    .foregroundStyle(FFTheme.cream)
                                    .frame(width: 42, height: 42)
                                    .background(
                                        LinearGradient(colors: item.colors, startPoint: .topLeading, endPoint: .bottomTrailing),
                                        in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                                    )
                                Text(item.name).font(.subheadline.weight(.semibold)).foregroundStyle(FFTheme.ink)
                                Text(subtitle).font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(13)
                            .frame(width: 158, height: 146, alignment: .leading)
                            .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
            .navigationDestination(item: $selectedItem) { item in
                item.destination
            }
        }
    }
}

#Preview {
    NavigationStack { HomeFeedView() }
        .environmentObject(NativeSession())
        .environmentObject(DeepLinkRouter())
        .environmentObject(DMStore())
}

/// Home's invitation to move toward Scripture or Training first, framed by
/// one verse -- replaces the earlier "Your Community" pulse card in this
/// same slot. Meant to feel fresh every time a member returns to Home, not a
/// stable pick for the day, so it re-rolls on every appearance rather than
/// once per day (see webapp's scriptureMission.js). Distinct from the live
/// per-moment verse a tracked workout itself uses.
struct ScriptureInMotionCard: View {
    @State private var mission: ScriptureMission?
    // Same chevron risk as the Explore grid and Home's From Explore rail --
    // two destinations reachable from one List row. Plain Buttons + a single
    // navigationDestination(item:), never two NavigationLinks in one row.
    private enum Destination: Hashable { case mission, verse }
    @State private var destination: Destination?

    var body: some View {
        Group {
            if let mission {
                content(for: mission)
            } else {
                // A silent skeleton, not an error state -- this replaces a
                // section that was always present, and a failed fetch here
                // shouldn't put an alarming error on the Home feed.
                RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous)
                    .fill(FFTheme.parchment1)
                    .frame(height: 190)
                    .overlay(ProgressView())
            }
        }
        // .onAppear, not .task -- .task only ever runs once per view
        // identity, but this card should re-roll every time a member
        // returns to Home (a tab switch back, or scrolling it back into
        // view), not just on the very first load. The existing verse stays
        // on screen while the new one loads, rather than flashing back to
        // the skeleton on every return.
        .onAppear { Task { mission = (try? await APIClient.shared.fetchScriptureMission()) ?? mission } }
        .navigationDestination(item: $destination) { destination in
            switch destination {
            case .mission:
                WorkoutView(initialVerse: mission.map {
                    VerseSnippet(id: $0.reference, reference: $0.reference, snippet: $0.text, deepLink: "")
                })
            case .verse:
                VerseThreadView(reference: mission?.reference ?? "")
            }
        }
    }

    private func content(for mission: ScriptureMission) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("SCRIPTURE IN MOTION", systemImage: "sparkles")
                    .font(.caption.weight(.bold)).tracking(1)
                Spacer()
                Text("TODAY").font(.caption2.weight(.bold)).foregroundStyle(FFTheme.cream)
                    .padding(.horizontal, 8).padding(.vertical, 4).background(FFTheme.meadow, in: Capsule())
            }
            Text(mission.headline)
                .font(FFTheme.display(22, weight: .bold, relativeTo: .title3)).foregroundStyle(FFTheme.ink)

            VStack(alignment: .leading, spacing: 4) {
                Text(mission.reference).font(.caption.weight(.bold)).foregroundStyle(FFTheme.scripture)
                Text(mission.text).font(.subheadline).italic().foregroundStyle(FFTheme.ink)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FFTheme.parchment2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(alignment: .leading) {
                Rectangle().fill(FFTheme.goldBright).frame(width: 3)
                    .clipShape(RoundedRectangle(cornerRadius: 1.5))
            }

            Text(mission.coaching)
                .font(.caption).foregroundStyle(FFTheme.inkSoft)

            HStack(spacing: 14) {
                Button { destination = .mission } label: {
                    Label("Begin the mission", systemImage: "figure.run")
                        .font(.caption.weight(.bold)).foregroundStyle(FFTheme.cream)
                        .frame(maxWidth: .infinity, minHeight: 42)
                        .background(FFTheme.meadow, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                Button { destination = .verse } label: {
                    Label("Read in Bible", systemImage: "arrow.up.right")
                        .font(.caption.weight(.semibold)).foregroundStyle(FFTheme.meadowDeep)
                }
                .buttonStyle(.plain)
            }

            Text("Functioning Faith coaching is generated from your activity context; Scripture text is always shown from the verified library.")
                .font(.caption2).foregroundStyle(FFTheme.inkSoft.opacity(0.8))
        }
        .padding(16)
        .background(LinearGradient(colors: [FFTheme.goldBright.opacity(0.28), FFTheme.meadow2.opacity(0.22), FFTheme.parchment1], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous))
    }
}
