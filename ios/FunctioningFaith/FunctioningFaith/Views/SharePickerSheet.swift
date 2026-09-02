import SwiftUI

/// Anything on the app should be sendable to another member through DM --
/// a reel, a workout, a Bible Answers response -- the same way a verse
/// already could. One reusable "who do you want to send this to" sheet
/// instead of a bespoke picker per content type: pick an existing
/// conversation or search for someone new, and this sends the content and
/// dismisses. The server re-resolves the real content in every case (see
/// the /dms/:threadId/reel|workout|bible-answer routes); nothing here is
/// trusted client-side beyond an id/reference to look up.
enum ShareableContent {
    case verse(reference: String)
    case reel(videoID: String)
    case workout(id: String)
    case bibleAnswer(question: String, answer: String)
}

struct SharePickerSheet: View {
    @EnvironmentObject private var store: DMStore
    let content: ShareableContent
    var onSent: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var people: [SearchResultItem] = []
    @State private var isSearching = false
    @State private var sendingUserID: String?
    @State private var errorMessage: String?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            Group {
                if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    if store.threads.isEmpty {
                        FFEmptyStateView(title: "No conversations yet", systemImage: "bubble.left.and.bubble.right",
                                          message: "Search for someone to send this to.")
                    } else {
                        List(store.threads) { thread in
                            row(id: thread.otherUserID.uuidString, name: thread.otherName,
                                hasAvatar: thread.otherHasAvatar, existingThreadID: thread.threadID)
                        }
                        .ffListChrome()
                    }
                } else if isSearching && people.isEmpty {
                    ProgressView()
                } else if people.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    List(people) { person in
                        row(id: person.id, name: person.title, hasAvatar: person.hasAvatar ?? false, existingThreadID: nil)
                    }
                    .ffListChrome()
                }
            }
            .navigationTitle("Send to…")
            .navigationBarTitleDisplayMode(.inline)
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
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task { await store.loadInbox() }
            .alert("Could not send", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
        }
    }

    private func row(id: String, name: String, hasAvatar: Bool, existingThreadID: String?) -> some View {
        Button {
            Task { await send(toUserID: id, existingThreadID: existingThreadID) }
        } label: {
            HStack(spacing: 12) {
                if let uuid = UUID(uuidString: id) {
                    MemberAvatarView(userID: uuid, hasAvatar: hasAvatar, size: 40)
                } else {
                    Image(systemName: "person.crop.circle.fill").font(.title2).foregroundStyle(FFTheme.hearth)
                }
                Text(name).font(FFTheme.serifMedium(16)).foregroundStyle(FFTheme.ink)
                Spacer()
                if sendingUserID == id { ProgressView() }
            }
        }
        .buttonStyle(.plain)
        .disabled(sendingUserID != nil)
        .listRowBackground(FFTheme.parchment1)
    }

    private func send(toUserID id: String, existingThreadID: String?) async {
        guard let userID = UUID(uuidString: id) else { return }
        sendingUserID = id
        defer { sendingUserID = nil }
        do {
            let threadID: String
            if let existingThreadID {
                threadID = existingThreadID
            } else {
                threadID = try await store.openThread(withUserID: userID)
            }
            switch content {
            case .verse(let reference):
                _ = try await store.sendVerse(threadID: threadID, reference: reference)
            case .reel(let videoID):
                _ = try await store.sendReel(threadID: threadID, videoID: videoID)
            case .workout(let workoutID):
                _ = try await store.sendWorkout(threadID: threadID, workoutID: workoutID)
            case .bibleAnswer(let question, let answer):
                _ = try await store.sendBibleAnswer(threadID: threadID, question: question, answer: answer)
            }
            onSent?()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
