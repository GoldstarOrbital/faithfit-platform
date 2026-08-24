import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Reaction set matches the server's own STORY_REACTIONS exactly (routes/
/// api.js) -- sending anything else is a 400, so this can't drift from it.
private let STORY_REACTIONS = ["❤️", "🙏", "🔥", "💪", "👏"]

struct StoryViewerView: View {
    let stories: [Story]
    let onDismiss: () -> Void

    @EnvironmentObject private var session: NativeSession
    @State private var index = 0
    @State private var localReaction: [String: String?] = [:] // storyID -> my_reaction, optimistic overlay
    @State private var localReactionCount: [String: Int] = [:]
    @State private var replyText = ""
    @State private var isSendingReply = false
    @State private var errorMessage: String?
    @State private var deletedIDs = Set<String>()
    @State private var viewerStory: Story?
    @State private var isExtending = false
    @State private var extensionMessage: String?

    private var visibleStories: [Story] { stories.filter { !deletedIDs.contains($0.id) } }
    private var current: Story? { visibleStories.indices.contains(index) ? visibleStories[index] : nil }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let current {
                VStack(spacing: 0) {
                    progressBar
                    header(current)
                    ZStack {
                        content(current)
                        // Left third steps back, right two-thirds steps forward --
                        // drawn ABOVE the content but below the reaction row/reply
                        // field (which come after this in the VStack, so their own
                        // buttons still receive taps first).
                        HStack(spacing: 0) {
                            Color.clear.contentShape(Rectangle()).onTapGesture { advance(by: -1) }
                                .frame(maxWidth: .infinity)
                            Color.clear.contentShape(Rectangle()).onTapGesture { advance(by: 1) }
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .frame(maxHeight: .infinity)
                    reactionRow(current)
                    replyField(current)
                }
                .task(id: current.id) { try? await APIClient.shared.markStoryViewed(id: current.id) }
            } else {
                Color.clear.onAppear { onDismiss() }
            }
        }
        .foregroundStyle(.white)
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
        .alert("Moment extended", isPresented: Binding(get: { extensionMessage != nil }, set: { if !$0 { extensionMessage = nil } })) {
            Button("OK", role: .cancel) { extensionMessage = nil }
        } message: { Text(extensionMessage ?? "") }
        .sheet(item: $viewerStory) { story in
            NavigationStack { StoryViewersView(storyID: story.id, initialCount: story.viewCount ?? 0) }
        }
    }

    private var progressBar: some View {
        HStack(spacing: 4) {
            ForEach(Array(visibleStories.enumerated()), id: \.element.id) { i, story in
                Capsule().fill(i <= index ? Color.white : Color.white.opacity(0.3)).frame(height: 3)
            }
        }
        .padding(.horizontal).padding(.top, 8)
    }

    private func header(_ story: Story) -> some View {
        HStack {
            Text(story.author).font(.subheadline.weight(.semibold))
            Spacer()
            if story.userID == session.profile?.id.uuidString {
                Button { viewerStory = story } label: {
                    Label("\(story.viewCount ?? 0) views", systemImage: "person.2")
                        .font(.caption.weight(.semibold)).foregroundStyle(.white)
                }
                Button { Task { await extend(story) } } label: {
                    Image(systemName: isExtending ? "arrow.clockwise" : "calendar.badge.plus")
                        .foregroundStyle(.white)
                }
                .disabled(isExtending)
                .accessibilityLabel("Keep this moment for another 24 hours")
                Button(role: .destructive) { Task { await delete(story) } } label: {
                    Image(systemName: "trash").foregroundStyle(.white)
                }
            }
            Button { onDismiss() } label: { Image(systemName: "xmark").foregroundStyle(.white) }
        }
        .padding(.horizontal).padding(.top, 8)
    }

    @ViewBuilder
    private func content(_ story: Story) -> some View {
        VStack(spacing: 16) {
            #if canImport(UIKit)
            if let dataURLString = story.photoData, let image = ImageUpload.decode(dataURLString) {
                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 480).clipShape(RoundedRectangle(cornerRadius: 16))
            }
            #endif
            if let text = story.content, !text.isEmpty {
                Text(text).font(.title3.weight(.medium)).multilineTextAlignment(.center).padding(.horizontal, 24)
            }
        }
    }

    private func reactionRow(_ story: Story) -> some View {
        HStack(spacing: 14) {
            ForEach(STORY_REACTIONS, id: \.self) { emoji in
                let active = (localReaction[story.id] ?? story.myReaction) == emoji
                Button(emoji) { Task { await react(story, emoji: emoji) } }
                    .font(active ? .title2 : .title3)
                    .opacity(active ? 1 : 0.7)
            }
            Spacer()
            Text("\(localReactionCount[story.id] ?? story.reactionCount)").font(.caption).foregroundStyle(.white.opacity(0.7))
        }
        .padding(.horizontal)
    }

    @ViewBuilder
    private func replyField(_ story: Story) -> some View {
        if story.userID != session.profile?.id.uuidString {
            HStack {
                TextField("Reply to this moment…", text: $replyText)
                    .textFieldStyle(.plain)
                    .padding(10)
                    .background(Capsule().fill(.white.opacity(0.15)))
                    .foregroundStyle(.white)
                Button {
                    Task { await sendReply(story) }
                } label: {
                    if isSendingReply { ProgressView().tint(.white) } else { Image(systemName: "paperplane.fill") }
                }
                .disabled(replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSendingReply)
            }
            .padding()
        } else {
            Color.clear.frame(height: 60)
        }
    }

    private func advance(by delta: Int) {
        let next = index + delta
        if next >= visibleStories.count { onDismiss() }
        else { index = max(0, next) }
    }

    private func react(_ story: Story, emoji: String) async {
        do {
            let result = try await APIClient.shared.reactToStory(id: story.id, emoji: emoji)
            localReaction[story.id] = result.emoji
            localReactionCount[story.id] = result.reactionCount
        } catch { errorMessage = error.localizedDescription }
    }

    private func sendReply(_ story: Story) async {
        let text = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        isSendingReply = true
        do {
            _ = try await APIClient.shared.replyToStory(id: story.id, body: text)
            replyText = ""
        } catch { errorMessage = error.localizedDescription }
        isSendingReply = false
    }

    private func delete(_ story: Story) async {
        do {
            try await APIClient.shared.deleteStory(id: story.id)
            deletedIDs.insert(story.id)
            if index >= visibleStories.count { onDismiss() }
        } catch { errorMessage = error.localizedDescription }
    }

    private func extend(_ story: Story) async {
        isExtending = true
        do {
            let result = try await APIClient.shared.extendStory(id: story.id)
            extensionMessage = "Your moment will stay up for another \(result.extendedByHours) hours."
        } catch { errorMessage = error.localizedDescription }
        isExtending = false
    }
}

private struct StoryViewersView: View {
    let storyID: String
    let initialCount: Int
    @State private var query = ""
    @State private var response: StoryViewersResponse?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let response {
                List {
                    Section("\(response.viewCount) views") {
                        if response.viewers.isEmpty {
                            FFEmptyStateView(title: "No matching viewers", systemImage: "person.2", message: query.isEmpty ? "Nobody else has watched this moment yet." : "Try a different name.")
                        } else {
                            ForEach(response.viewers) { viewer in
                                HStack {
                                    Image(systemName: viewer.hasAvatar ? "person.crop.circle.fill" : "person.crop.circle")
                                        .foregroundStyle(FFTheme.meadow)
                                    VStack(alignment: .leading) {
                                        Text(viewer.displayName)
                                        Text(viewer.viewedAt.prefix(16)).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                    .listRowBackground(FFTheme.parchment1)
                }
                .ffListChrome()
                .searchable(text: $query, prompt: "Search viewers")
            } else if let errorMessage {
                FFErrorStateView(message: errorMessage, onRetry: { Task { await load() } })
            } else {
                FFLoadingView(message: "Loading viewers…")
            }
        }
        .navigationTitle("Viewed by")
        .task(id: query) { await load() }
    }

    private func load() async {
        do {
            let loaded = try await APIClient.shared.fetchStoryViewers(id: storyID, query: query)
            guard !Task.isCancelled else { return }
            response = loaded
            errorMessage = nil
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }
}
