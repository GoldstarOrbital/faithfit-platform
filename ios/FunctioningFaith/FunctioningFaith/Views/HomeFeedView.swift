import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct HomeFeedView: View {
    @State private var posts: [FeedPost] = []
    @State private var isLoading = true
    @State private var isLoadingMore = false
    @State private var nextCursor: String?
    @State private var selectedPost: FeedPost?
    @State private var showComposer = false
    @State private var blockCandidate: (id: UUID, name: String)?
    @State private var showBlockConfirmation = false
    @State private var showMessages = false
    @State private var unreadMessages = 0
    @State private var showNotifications = false
    @State private var unreadNotifications = 0
    @State private var showSearch = false

    var body: some View {
        List {
            StoriesRail()
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            ScriptureHomeCard()
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
                    }
                )
                    .onAppear { loadNextPageIfNeeded(post) }
                    .swipeActions(edge: .trailing) {
                        Button { toggleLike(post) } label: { Label(post.likedByMe ? "Unlike" : "Like", systemImage: post.likedByMe ? "heart.slash" : "heart.fill") }
                            .tint(.pink)
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
                Button { showMessages = true } label: {
                    badgedIcon("bubble.left.and.bubble.right", count: unreadMessages)
                }
                .accessibilityLabel(unreadMessages > 0 ? "Messages, \(unreadMessages) unread" : "Messages")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSearch = true } label: { Image(systemName: "magnifyingglass") }
                    .accessibilityLabel("Search")
            }
        }
        .navigationDestination(isPresented: $showMessages) { DMInboxView() }
        .navigationDestination(isPresented: $showNotifications) { NotificationsView() }
        .navigationDestination(isPresented: $showSearch) { SearchView() }
        .task {
            await loadFeed()
            unreadMessages = (try? await APIClient.shared.fetchDMInbox().unread) ?? 0
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
            if isLoading && posts.isEmpty { ProgressView() }
        }
    }

    private func loadFeed() async {
        isLoading = true
        defer { isLoading = false }
        guard let page = try? await APIClient.shared.fetchFeedPage() else { return }
        posts = page.posts
        nextCursor = page.nextCursor
    }

    private func loadNextPageIfNeeded(_ post: FeedPost) {
        guard post.id == posts.last?.id, nextCursor != nil, !isLoadingMore else { return }
        Task { await loadMore() }
    }

    private func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        guard let page = try? await APIClient.shared.fetchFeedPage(before: cursor) else { return }
        let existing = Set(posts.map(\.id))
        posts.append(contentsOf: page.posts.filter { !existing.contains($0.id) })
        nextCursor = page.nextCursor
    }

    private func toggleLike(_ post: FeedPost) {
        Task {
            guard let response = try? await APIClient.shared.likePost(id: post.id),
                  let index = posts.firstIndex(where: { $0.id == post.id }) else { return }
            posts[index].likedByMe = response.liked
            posts[index].likeCount = response.likeCount
        }
    }

    private func toggleSave(_ post: FeedPost) {
        Task {
            guard let response = try? await APIClient.shared.savePost(id: post.id),
                  let index = posts.firstIndex(where: { $0.id == post.id }) else { return }
            posts[index].savedByMe = response.saved
        }
    }

    private func report(_ post: FeedPost) {
        Task {
            try? await APIClient.shared.reportPost(id: post.id, reason: "Reported from the native feed")
        }
    }

    private func block(_ id: UUID) {
        Task {
            guard (try? await APIClient.shared.blockUser(id: id)) != nil else { return }
            posts.removeAll { $0.authorID == id }
            blockCandidate = nil
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

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(post.authorName)
                .font(.system(.subheadline, design: .default).weight(.semibold))
                .accessibilityAddTraits(.isHeader)

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

            HStack(spacing: 18) {
                Button(action: onLike) {
                    Label("\(post.likeCount)", systemImage: post.likedByMe ? "heart.fill" : "heart")
                }
                .tint(post.likedByMe ? .pink : .secondary)

                Button(action: onSave) {
                    Label(post.savedByMe ? "Saved" : "Save", systemImage: post.savedByMe ? "bookmark.fill" : "bookmark")
                }
                .tint(post.savedByMe ? .indigo : .secondary)

                Button(action: onComments) {
                    Label("\(post.commentCount)", systemImage: "bubble.left")
                }
                .tint(.secondary)

                if post.visibility == "public", let url = URL(string: "/w/\(post.id.uuidString)", relativeTo: APIClient.shared.baseURL)?.absoluteURL {
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
            Button("Report post", role: .destructive, action: onReport)
            if post.authorID != nil {
                Button("Block \(post.authorName)", role: .destructive, action: onBlock)
            }
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
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verse.reference).font(.caption.weight(.bold)).foregroundStyle(FFTheme.scripture)
            Text(verse.snippet).font(.caption).italic()
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FFTheme.scripture.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("Scripture: \(verse.reference). \(verse.snippet)")
    }
}

#Preview { NavigationStack { HomeFeedView() } }
