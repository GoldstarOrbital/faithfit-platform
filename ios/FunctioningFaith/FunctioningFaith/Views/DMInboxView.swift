import SwiftUI

struct DMInboxView: View {
    @EnvironmentObject private var session: NativeSession
    /// Shared with RootTabView so the tab badge and inbox stay in sync.
    @EnvironmentObject private var store: DMStore
    @State private var isLoading = true
    @State private var showNewMessage = false

    var body: some View {
        Group {
            if isLoading && store.threads.isEmpty {
                FFLoadingView(message: "Loading conversations…")
            } else if store.threads.isEmpty {
                FFEmptyStateView(
                    title: "No conversations yet",
                    systemImage: "bubble.left.and.bubble.right",
                    message: "Start a conversation by finding a member."
                )
            } else {
                List(store.threads) { thread in
                    NavigationLink(value: thread) {
                        DMThreadRow(thread: thread)
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }
                .listStyle(.plain)
                .refreshable { await store.loadInbox() }
            }
        }
        .navigationTitle("Messages")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showNewMessage = true } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel("New message")
            }
        }
        .sheet(isPresented: $showNewMessage) {
            NavigationStack { NewMessageView() }
                .environmentObject(session)
                .environmentObject(store)
        }
        .navigationDestination(for: DMThreadPreview.self) { thread in
            DMConversationView(threadID: thread.threadID, otherUserID: thread.otherUserID, otherName: thread.otherName)
                .environmentObject(store)
        }
        .task {
            if let id = session.profile?.id { await store.configure(myUserID: id) }
            await store.loadInbox()
            isLoading = false
        }
        .alert("Could not load messages", isPresented: Binding(
            get: { store.loadError != nil },
            set: { if !$0 { /* clear via reload */ }
            }
        )) {
            Button("Try again") { Task { await store.loadInbox() } }
            Button("OK", role: .cancel) { }
        } message: {
            Text(store.loadError ?? "")
        }
    }
}

/// A real compose entry point inside the Messages tab. Search is deliberately
/// restricted to member results: selecting a person opens the existing
/// protected, permission-checked DM route rather than creating an unaudited
/// second messaging surface.
private struct NewMessageView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: NativeSession
    @EnvironmentObject private var store: DMStore
    @State private var query = ""
    @State private var people: [SearchResultItem] = []
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var opened: NewConversationDestination?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        Group {
            if query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 {
                ContentUnavailableView("Find someone", systemImage: "person.badge.plus", description: Text("Search by their name or username to start a message."))
            } else if isSearching && people.isEmpty {
                ProgressView()
            } else if people.isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                List(people) { person in
                    Button { Task { await open(person) } } label: {
                        HStack(spacing: 12) {
                            if let personID = UUID(uuidString: person.id) {
                                MemberAvatarView(userID: personID, hasAvatar: person.hasAvatar ?? false, size: 32)
                            } else {
                                Image(systemName: "person.crop.circle.fill")
                                    .font(.title2).foregroundStyle(FFTheme.hearth)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(person.title).foregroundStyle(FFTheme.ink)
                                if let subtitle = person.subtitle, !subtitle.isEmpty {
                                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            Spacer()
                            Image(systemName: "message.fill").foregroundStyle(.tint)
                        }
                    }
                    .buttonStyle(.plain)
                }
                .ffListChrome()
            }
        }
        .navigationTitle("New message")
        .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } } }
        .searchable(text: $query, prompt: "Name or username")
        .onChange(of: query) { _, value in
            searchTask?.cancel()
            let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard clean.count >= 2 else { people = []; return }
            searchTask = Task {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                isSearching = true
                defer { isSearching = false }
                do {
                    let response = try await APIClient.shared.search(clean)
                    people = response.groups.first(where: { $0.type == "people" })?.items ?? []
                } catch { errorMessage = error.localizedDescription }
            }
        }
        .navigationDestination(item: $opened) { target in
            DMConversationView(threadID: target.threadID, otherUserID: target.userID, otherName: target.name)
                .environmentObject(store)
        }
        .alert("Could not open conversation", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func open(_ person: SearchResultItem) async {
        guard let userID = UUID(uuidString: person.id), userID != session.profile?.id else {
            errorMessage = "That member cannot be messaged from this account."
            return
        }
        do {
            if let myID = session.profile?.id { await store.configure(myUserID: myID) }
            let threadID = try await store.openThread(withUserID: userID)
            await store.loadInbox()
            opened = NewConversationDestination(threadID: threadID, userID: userID, name: person.title)
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct NewConversationDestination: Identifiable, Hashable {
    let threadID: String
    let userID: UUID
    let name: String
    var id: String { threadID }
}

private struct DMThreadRow: View {
    let thread: DMThreadPreview

    var body: some View {
        HStack(spacing: FFTheme.Space.sm) {
            MemberAvatarView(userID: thread.otherUserID, hasAvatar: thread.otherHasAvatar, size: FFTheme.minTapTarget)

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(thread.otherName)
                        .font(.body.weight(thread.unread > 0 ? .semibold : .regular))
                    Spacer()
                    if let date = thread.lastMessageAt {
                        Text(date, style: .relative)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(previewLine)
                    .font(.subheadline)
                    .foregroundStyle(thread.unread > 0 ? .primary : .secondary)
                    .lineLimit(1)
            }

            if thread.unread > 0 {
                Text("\(thread.unread)")
                    .font(.caption2.weight(.bold))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(FFTheme.accent))
                    .foregroundStyle(.white)
                    .accessibilityLabel("\(thread.unread) unread")
            }
        }
        .padding(.vertical, FFTheme.Space.xxs)
        .accessibilityElement(children: .combine)
    }

    private var previewLine: String {
        let prefix = thread.lastFromMe ? "You: " : ""
        switch thread.lastKind {
        case "e2e": return "🔒 Encrypted message"
        case "verse": return prefix + "Shared a verse"
        default: return prefix + (thread.previewText ?? "…")
        }
    }
}

extension DMThreadPreview: Hashable {
    static func == (lhs: DMThreadPreview, rhs: DMThreadPreview) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

#Preview {
    NavigationStack {
        DMInboxView()
    }
    .environmentObject(NativeSession())
    .environmentObject(DMStore())
}
