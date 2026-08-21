import SwiftUI

/// Reuses FeedPostRow, same as HashtagView -- a saved post looks and
/// behaves identically to one reached from the home feed. Unsaving here
/// removes it from the list immediately, matching what "saved posts"
/// means: this is the collection, not just a toggle state.
struct SavedPostsView: View {
    @State private var posts: [FeedPost] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedPost: FeedPost?

    var body: some View {
        Group {
            if isLoading && posts.isEmpty {
                ProgressView()
            } else if posts.isEmpty {
                ContentUnavailableView("No saved posts", systemImage: "bookmark", description: Text("Posts you save from the feed show up here."))
            } else {
                List {
                    ForEach(posts) { post in
                        FeedPostRow(
                            post: post,
                            onLike: { toggleLike(post) },
                            onSave: { toggleSave(post) },
                            onComments: { selectedPost = post },
                            onReport: { Task { try? await APIClient.shared.reportPost(id: post.id, reason: "Reported from saved posts") } },
                            onBlock: {
                                guard let authorID = post.authorID else { return }
                                Task { try? await APIClient.shared.blockUser(id: authorID) }
                            }
                        )
                    }
                }
                .listStyle(.plain)
                .refreshable { await load() }
            }
        }
        .navigationTitle("Saved Posts")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $selectedPost) { post in
            NavigationStack {
                CommentThreadView(post: post) {
                    if let idx = posts.firstIndex(where: { $0.id == post.id }) { posts[idx].commentCount += 1 }
                }
            }
        }
        .alert("Could not load saved posts", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        do { posts = try await APIClient.shared.fetchSavedPosts() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func toggleLike(_ post: FeedPost) {
        guard let idx = posts.firstIndex(where: { $0.id == post.id }) else { return }
        Task {
            guard let response = try? await APIClient.shared.likePost(id: post.id) else { return }
            posts[idx].likedByMe = response.liked
            posts[idx].likeCount = response.likeCount
        }
    }

    private func toggleSave(_ post: FeedPost) {
        Task {
            guard let response = try? await APIClient.shared.savePost(id: post.id) else { return }
            if !response.saved {
                posts.removeAll { $0.id == post.id }
            }
        }
    }
}

#Preview { NavigationStack { SavedPostsView() } }
