import SwiftUI

struct CommentThreadView: View {
    let post: FeedPost
    let onCommentAdded: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var comments: [FeedComment] = []
    @State private var draft = ""
    @State private var isLoading = true
    @State private var isSending = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 5) {
                    Text(post.authorName).font(.headline)
                    Text(post.content)
                }
                .padding(.vertical, 4)
            }
            .listRowBackground(FFTheme.parchment1)

            Section("Conversation") {
                if isLoading {
                    ProgressView("Loading comments…")
                } else if comments.isEmpty {
                    Text("Be the first to offer encouragement.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(comments) { comment in
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(comment.author).font(.caption.weight(.semibold))
                                Text(comment.content)
                            }
                            Spacer()
                            Button {
                                toggleLike(comment)
                            } label: {
                                Label("\(comment.likeCount)", systemImage: comment.likedByMe ? "heart.fill" : "heart")
                                    .labelStyle(.titleAndIcon)
                            }
                            .buttonStyle(.borderless)
                            .tint(comment.likedByMe ? FFTheme.seal : .secondary)
                            .accessibilityLabel(comment.likedByMe ? "Unlike comment" : "Like comment")
                        }
                        .padding(.vertical, 3)
                    }
                }
            }
            .listRowBackground(FFTheme.parchment1)
        }
        .ffListChrome()
        .listStyle(.plain)
        .navigationTitle("Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") { dismiss() }
            }
        }
        .safeAreaInset(edge: .bottom) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Add encouragement…", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .onChange(of: draft) { _, value in
                        if value.count > 500 { draft = String(value.prefix(500)) }
                    }
                Button {
                    send()
                } label: {
                    if isSending { ProgressView() } else { Image(systemName: "paperplane.fill") }
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
                .accessibilityLabel("Post comment")
            }
            .padding(12)
            .background(.regularMaterial)
        }
        .task { await load() }
        .refreshable { await load() }
        .alert("Could not update the conversation", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Please try again.")
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do { comments = try await APIClient.shared.fetchComments(postID: post.id) }
        catch { errorMessage = error.localizedDescription }
    }

    private func send() {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        isSending = true
        Task {
            do {
                let comment = try await APIClient.shared.addComment(postID: post.id, content: content)
                comments.append(comment)
                draft = ""
                onCommentAdded()
            } catch {
                errorMessage = error.localizedDescription
            }
            isSending = false
        }
    }

    private func toggleLike(_ comment: FeedComment) {
        Task {
            guard let response = try? await APIClient.shared.likeComment(id: comment.id),
                  let index = comments.firstIndex(where: { $0.id == comment.id }) else { return }
            comments[index].likedByMe = response.liked
            comments[index].likeCount = response.likeCount
        }
    }
}

#Preview {
    NavigationStack {
        CommentThreadView(post: MockData.feed[0]) { }
    }
}
