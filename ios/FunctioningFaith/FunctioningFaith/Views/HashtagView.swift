import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Reuses FeedPostRow (from HomeFeedView) so a post looks and behaves
/// identically whether reached from the home feed or a hashtag -- same
/// like/save/comment/report/block actions, same visibility styling.
struct HashtagView: View {
    let tag: String
    @State private var posts: [FeedPost] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedPost: FeedPost?

    var body: some View {
        Group {
            if isLoading && posts.isEmpty {
                FFLoadingView(message: "Loading #\(tag)…")
            } else if let errorMessage, posts.isEmpty {
                FFErrorStateView(message: errorMessage, onRetry: { Task { await load() } })
            } else if posts.isEmpty {
                FFEmptyStateView(title: "No posts yet", systemImage: "number", message: "Nobody's tagged #\(tag) that you can see.")
            } else {
                List {
                    ForEach(posts) { post in
                        FeedPostRow(
                            post: post,
                            onLike: { toggleLike(post) },
                            onSave: { toggleSave(post) },
                            onComments: { selectedPost = post },
                            onReport: { Task { try? await APIClient.shared.reportPost(id: post.id, reason: "Reported from hashtag #\(tag)") } },
                            onBlock: {
                                guard let authorID = post.authorID else { return } // no known author to block
                                Task { try? await APIClient.shared.blockUser(id: authorID) }
                            }
                        )
                    }
                }
                .ffListChrome()
                .listStyle(.plain)
                .refreshable { await load() }
            }
        }
        .navigationTitle("#\(tag)")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $selectedPost) { post in
            NavigationStack {
                CommentThreadView(post: post) {
                    if let idx = posts.firstIndex(where: { $0.id == post.id }) { posts[idx].commentCount += 1 }
                }
            }
        }
        .alert("Could not load posts", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            let loaded = try await APIClient.shared.fetchPosts(forTag: tag)
            guard !Task.isCancelled else { return }
            posts = loaded
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func toggleLike(_ post: FeedPost) {
        guard let idx = posts.firstIndex(where: { $0.id == post.id }) else { return }
        Task {
            do {
                let response = try await APIClient.shared.likePost(id: post.id)
                guard !Task.isCancelled, posts.indices.contains(idx), posts[idx].id == post.id else { return }
                posts[idx].likedByMe = response.liked
                posts[idx].likeCount = response.likeCount
                #if canImport(UIKit)
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                #endif
            } catch { errorMessage = error.localizedDescription }
        }
    }

    private func toggleSave(_ post: FeedPost) {
        guard let idx = posts.firstIndex(where: { $0.id == post.id }) else { return }
        Task {
            do {
                let response = try await APIClient.shared.savePost(id: post.id)
                guard !Task.isCancelled, posts.indices.contains(idx), posts[idx].id == post.id else { return }
                posts[idx].savedByMe = response.saved
            } catch { errorMessage = error.localizedDescription }
        }
    }
}

/// A horizontal rail of trending tags -- matches the web home page's own
/// trending-tags rail. Embedded at the top of HomeFeedView.
struct TrendingTagsRail: View {
    @State private var tags: [TrendingTag] = []
    // A plain Button + navigationDestination(item:), not
    // NavigationLink(value:) -- this rail is one row inside HomeFeedView's
    // List, and multiple NavigationLinks sharing a single List row is
    // exactly the pattern that produced Explore's chevron-misrouting bug
    // (List adds one automatic disclosure chevron per row, not per link).
    @State private var selectedTag: TrendingTag?

    var body: some View {
        Group {
            if !tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(tags) { tag in
                            Button {
                                selectedTag = tag
                            } label: {
                                Text("#\(tag.tag) · \(tag.c)")
                                    .font(.caption.weight(.medium))
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(Capsule().fill(.tint.opacity(0.12)))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
        .task {
            tags = (try? await APIClient.shared.fetchTrendingTags()) ?? []
        }
        .navigationDestination(item: $selectedTag) { tag in
            HashtagView(tag: tag.tag)
        }
    }
}

extension TrendingTag: Hashable {
    static func == (lhs: TrendingTag, rhs: TrendingTag) -> Bool { lhs.tag == rhs.tag }
    func hash(into hasher: inout Hasher) { hasher.combine(tag) }
}

#Preview { NavigationStack { HashtagView(tag: "morningrun") } }
