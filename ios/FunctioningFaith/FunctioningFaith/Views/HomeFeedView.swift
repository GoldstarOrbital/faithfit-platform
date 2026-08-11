import SwiftUI

struct HomeFeedView: View {
    @State private var posts: [FeedPost] = []
    @State private var isLoading = true

    var body: some View {
        List {
            ForEach(posts) { post in
                FeedPostRow(post: post, onLike: { toggleLike(post) }, onSave: { toggleSave(post) })
                    .swipeActions(edge: .trailing) {
                        Button { toggleLike(post) } label: { Label(post.likedByMe ? "Unlike" : "Like", systemImage: post.likedByMe ? "heart.slash" : "heart.fill") }
                            .tint(.pink)
                        Button { toggleSave(post) } label: { Label(post.savedByMe ? "Unsave" : "Save", systemImage: post.savedByMe ? "bookmark.slash" : "bookmark.fill") }
                            .tint(.blue)
                    }
            }
        }
        .listStyle(.plain)
        .refreshable { await loadFeed() }
        .navigationTitle("Home")
        .task { await loadFeed() }
        .overlay {
            if isLoading && posts.isEmpty { ProgressView() }
        }
    }

    private func loadFeed() async {
        isLoading = true
        defer { isLoading = false }
        posts = (try? await APIClient.shared.fetchFeed()) ?? []
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
}

struct FeedPostRow: View {
    let post: FeedPost
    let onLike: () -> Void
    let onSave: () -> Void

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

            HStack(spacing: 18) {
                Button(action: onLike) {
                    Label("\(post.likeCount)", systemImage: post.likedByMe ? "heart.fill" : "heart")
                }
                .tint(post.likedByMe ? .pink : .secondary)

                Button(action: onSave) {
                    Label(post.savedByMe ? "Saved" : "Save", systemImage: post.savedByMe ? "bookmark.fill" : "bookmark")
                }
                .tint(post.savedByMe ? .indigo : .secondary)

                ShareLink(item: post.content) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                .tint(.secondary)
                Spacer()
            }
            .buttonStyle(.borderless)
            .font(.footnote.weight(.semibold))
            .accessibilityElement(children: .contain)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .contain)
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
            Text(verse.reference).font(.caption.weight(.bold)).foregroundStyle(.indigo)
            Text(verse.snippet).font(.caption).italic()
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.indigo.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("Scripture: \(verse.reference). \(verse.snippet)")
    }
}

#Preview { NavigationStack { HomeFeedView() } }
