import SwiftUI

/// Private bookmark collection — mirrors web Profile → Saved posts (`renderSavedPosts`).
struct SavedPostsView: View {
    @State private var posts: [FeedPost] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedPost: FeedPost?

    var body: some View {
        Group {
            if isLoading && posts.isEmpty {
                ProgressView("Loading saved posts…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage, posts.isEmpty {
                FFErrorStateView(message: errorMessage) {
                    Task { await load() }
                }
            } else if posts.isEmpty {
                ContentUnavailableView(
                    "Nothing saved yet",
                    systemImage: "bookmark",
                    description: Text("Tap Save on a community post to keep it here. Bookmarks are private.")
                )
            } else {
                List {
                    Section {
                        Text("Private bookmarks for workouts, prayers, and encouragement you want to return to.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    ForEach(posts) { post in
                        FeedPostRow(
                            post: post,
                            onLike: { toggleLike(post) },
                            onSave: { unsave(post) },
                            onComments: { selectedPost = post },
                            onReport: { report(post) },
                            onBlock: {
                                if let id = post.authorID { block(id) }
                            }
                        )
                        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                    }
                }
                .ffListChrome()
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .navigationTitle("Saved posts")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $selectedPost) { post in
            NavigationStack {
                CommentThreadView(post: post)
            }
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            var loaded = try await APIClient.shared.fetchSavedPosts()
            // Collection is always “saved” from the member’s POV.
            for i in loaded.indices {
                loaded[i].savedByMe = true
            }
            posts = loaded
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func toggleLike(_ post: FeedPost) {
        Task {
            guard let response = try? await APIClient.shared.likePost(id: post.id),
                  let idx = posts.firstIndex(where: { $0.id == post.id }) else { return }
            posts[idx].likedByMe = response.liked
            posts[idx].likeCount = response.likeCount
        }
    }

    private func unsave(_ post: FeedPost) {
        Task {
            guard let response = try? await APIClient.shared.savePost(id: post.id) else { return }
            if !response.saved {
                posts.removeAll { $0.id == post.id }
            } else if let idx = posts.firstIndex(where: { $0.id == post.id }) {
                posts[idx].savedByMe = true
            }
        }
    }

    private func report(_ post: FeedPost) {
        Task {
            try? await APIClient.shared.reportPost(id: post.id, reason: "Reported from saved posts")
        }
    }

    private func block(_ id: UUID) {
        Task {
            guard (try? await APIClient.shared.blockUser(id: id)) != nil else { return }
            posts.removeAll { $0.authorID == id }
        }
    }
}

#Preview {
    NavigationStack { SavedPostsView() }
}
