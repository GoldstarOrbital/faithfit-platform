import SwiftUI

/// One ring per author with an active moment, matching the familiar
/// stories-rail pattern -- an unviewed ring is highlighted, tapping opens
/// that author's moments in order. "Add a moment" is always the first ring.
struct StoriesRail: View {
    @State private var stories: [Story] = []
    @State private var showComposer = false
    @State private var viewingAuthor: String?

    private var byAuthor: [(authorID: String, authorName: String, stories: [Story])] {
        var order: [String] = []
        var groups: [String: [Story]] = [:]
        for s in stories {
            if groups[s.userID] == nil { order.append(s.userID) }
            groups[s.userID, default: []].append(s)
        }
        return order.map { id in (id, groups[id]!.first!.author, groups[id]!) }
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

    private func load() async {
        stories = (try? await APIClient.shared.fetchStories()) ?? []
    }

    private func initials(_ name: String) -> String {
        String(name.split(separator: " ").prefix(2).compactMap { $0.first }).uppercased()
    }
}
