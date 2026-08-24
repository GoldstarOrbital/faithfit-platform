import SwiftUI

/// One ring per author with an active moment, matching the familiar
/// stories-rail pattern -- an unviewed ring is highlighted, tapping opens
/// that author's moments in order. "Add a moment" is always the first ring.
struct StoriesRail: View {
    @State private var stories: [Story] = []
    @State private var showComposer = false
    @State private var viewingAuthor: String?
    @State private var loadError: String?

    private var byAuthor: [(authorID: String, authorName: String, stories: [Story])] {
        var order: [String] = []
        var groups: [String: [Story]] = [:]
        for s in stories {
            if groups[s.userID] == nil { order.append(s.userID) }
            groups[s.userID, default: []].append(s)
        }
        return order.compactMap { id in
            guard let authorStories = groups[id], let first = authorStories.first else { return nil }
            return (id, first.author, authorStories)
        }
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 14) {
                VStack(spacing: 4) {
                    ZStack {
                        Circle().strokeBorder(.secondary.opacity(0.4), lineWidth: 1.5).frame(width: 60, height: 60)
                        Image(systemName: "plus").font(.title3).foregroundStyle(.tint)
                    }
                    Text("Your moment").font(.caption2)
                }
                .onTapGesture { showComposer = true }

                // A failed load replaces the rail inline, matching its own
                // ring size and rhythm, instead of overlaying a text+button
                // row on top of it -- the previous version could visually
                // collide with whatever rings were still showing underneath.
                if let loadError {
                    retryRing(loadError)
                } else {
                    ForEach(byAuthor, id: \.authorID) { group in
                        VStack(spacing: 4) {
                            let allViewed = group.stories.allSatisfy(\.isViewed)
                            Circle()
                                .strokeBorder(allViewed ? Color.secondary.opacity(0.4) : FFTheme.hearth, lineWidth: 2)
                                .frame(width: 60, height: 60)
                                .overlay(Text(initials(group.authorName)).font(.headline))
                            Text(group.authorName).font(.caption2).lineLimit(1).frame(maxWidth: 66)
                        }
                        .onTapGesture { viewingAuthor = group.authorID }
                    }
                }
            }
            .padding(.horizontal)
        }
        .task { await load() }
        .sheet(isPresented: $showComposer) {
            NavigationStack { StoryComposerView { Task { await load() } } }
        }
        .fullScreenCover(isPresented: Binding(get: { viewingAuthor != nil }, set: { if !$0 { viewingAuthor = nil } })) {
            if let authorID = viewingAuthor, let group = byAuthor.first(where: { $0.authorID == authorID }) {
                StoryViewerView(stories: group.stories) { viewingAuthor = nil; Task { await load() } }
            }
        }
    }

    private func retryRing(_ message: String) -> some View {
        Button { Task { await load() } } label: {
            VStack(spacing: 4) {
                ZStack {
                    Circle().strokeBorder(FFTheme.hearth, lineWidth: 1.5).frame(width: 60, height: 60)
                    Image(systemName: "arrow.clockwise").font(.title3).foregroundStyle(FFTheme.hearth)
                }
                Text("Retry").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(message)
        .accessibilityHint("Double tap to try loading moments again")
    }

    private func load() async {
        loadError = nil
        do {
            stories = try await APIClient.shared.fetchStories()
        } catch is CancellationError {
            return
        } catch {
            loadError = "Couldn’t load moments."
        }
    }

    private func initials(_ name: String) -> String {
        String(name.split(separator: " ").prefix(2).compactMap { $0.first }).uppercased()
    }
}
