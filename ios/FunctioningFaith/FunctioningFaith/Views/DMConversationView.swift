import SwiftUI
import UIKit

private struct OpenVerseReference: Identifiable, Hashable {
    let reference: String
    var id: String { reference }
}

struct DMConversationView: View {
    let threadID: String
    let otherUserID: UUID
    let otherName: String

    @EnvironmentObject private var store: DMStore
    @State private var conversation: DMConversation?
    @State private var messageText = ""
    @State private var isSending = false
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showBlockConfirm = false
    @State private var editingMessage: DMMessage?
    @State private var showVersePicker = false
    @State private var replyingTo: DMMessage?
    @State private var openVerseReference: OpenVerseReference?

    var body: some View {
        VStack(spacing: 0) {
            if let conversation, conversation.blocked {
                Label("You and \(otherName) cannot message each other.", systemImage: "hand.raised.fill")
                    .font(.footnote).foregroundStyle(.secondary)
                    .padding(10).frame(maxWidth: .infinity)
                    .background(.secondary.opacity(0.1))
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(conversation?.messages ?? []) { message in
                            DMBubble(message: message, onLike: { Task { await like(message) } },
                                     onEdit: message.fromMe && message.kind == "text" ? { beginEdit(message) } : nil,
                                     onReply: { beginReply(message) },
                                     onOpenVerse: message.kind == "verse" ? { ref in openVerseReference = OpenVerseReference(reference: ref) } : nil)
                                .id(message.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: conversation?.messages.count) { _, _ in
                    if let last = conversation?.messages.last?.id {
                        withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                    }
                }
            }
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            if editingMessage != nil {
                HStack {
                    Label("Editing message", systemImage: "pencil")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Cancel") { cancelEdit() }
                        .font(.caption)
                }
                .padding(.horizontal, 10).padding(.top, 6)
            } else if let replyingTo {
                HStack {
                    Label("Replying to \(replyingTo.fromMe ? "yourself" : otherName)", systemImage: "arrowshape.turn.up.left")
                        .font(.caption).foregroundStyle(.secondary)
                    Text(replyPreviewSnippet(replyingTo)).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    Button("Cancel") { self.replyingTo = nil }
                        .font(.caption)
                }
                .padding(.horizontal, 10).padding(.top, 6)
            }
            HStack(spacing: 10) {
                Button { showVersePicker = true } label: {
                    Image(systemName: "book.closed.fill").font(.title3)
                }
                .disabled(conversation?.blocked ?? false)
                TextField("Message…", text: $messageText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                Button {
                    Task {
                        if editingMessage != nil { await saveEdit() } else { await send() }
                    }
                } label: {
                    if isSending { ProgressView() } else { Image(systemName: editingMessage != nil ? "checkmark.circle.fill" : "arrow.up.circle.fill").font(.title2) }
                }
                .disabled(messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending || (conversation?.blocked ?? false))
            }
            .padding(10)
        }
        // Pushed from DMInboxView, which reserves this space on itself --
        // but that modifier only applies to the exact view it's chained
        // onto, not to whatever gets pushed on top of it. Without it here,
        // the compose bar (the last thing in the VStack above) renders at
        // the true bottom of the screen, directly behind the persistent
        // global bottom bar that RootTabView draws as a ZStack overlay
        // above every section's content -- not just missing visually, but
        // genuinely untappable, since the bar overlay sits in front of it.
        .reserveFeatureBottomBar()
        .navigationTitle(otherName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(conversation?.blocked == true ? "Unblock" : "Block", role: .destructive) {
                    showBlockConfirm = true
                }
            }
        }
        .confirmationDialog(
            conversation?.blocked == true ? "Unblock \(otherName)?" : "Block \(otherName)?",
            isPresented: $showBlockConfirm, titleVisibility: .visible
        ) {
            Button(conversation?.blocked == true ? "Unblock" : "Block", role: .destructive) {
                Task { await toggleBlock() }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            if conversation?.blocked != true {
                Text("Neither of you will be able to message the other.")
            }
        }
        .sheet(isPresented: $showVersePicker) {
            DMVersePickerSheet { reference in
                Task { await sendVerse(reference) }
            }
        }
        .navigationDestination(item: $openVerseReference) { ref in
            VerseThreadView(reference: ref.reference)
        }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
        .task { await load() }
        .task { await pollWhileVisible() }
    }

    private func replyPreviewSnippet(_ message: DMMessage) -> String {
        switch message.kind {
        case "e2e": return "🔒 Encrypted message"
        case "verse": return message.verseReference ?? "Shared verse"
        default: return message.body
        }
    }

    private func load() async {
        isLoading = true
        do { conversation = try await store.loadThread(id: threadID) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    /// A light poll rather than a socket -- this app has no persistent
    /// connection to the server, and re-fetching a single thread every few
    /// seconds while its screen is actually open is cheap. Deliberately
    /// silent: no loading spinner, no scroll jump unless a new message
    /// really arrived (onChange above only fires on a genuine count change).
    private func pollWhileVisible() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            if let fresh = try? await store.loadThread(id: threadID) {
                conversation = fresh
            }
        }
    }

    private func send() async {
        let text = messageText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let replyToID = replyingTo?.id
        messageText = ""
        replyingTo = nil
        isSending = true
        do {
            let sent = try await store.send(threadID: threadID, to: otherUserID, text: text, replyToID: replyToID)
            if let c = conversation {
                conversation = DMConversation(threadID: c.threadID, otherUserID: c.otherUserID, otherName: c.otherName,
                                               otherHasAvatar: c.otherHasAvatar, blocked: c.blocked, messages: c.messages + [sent])
            }
        } catch {
            // A request can fail on the client side (a dropped or timed-out
            // response) after the server already stored the message -- the
            // message really did send. Restoring the typed text in that case
            // left it sitting in the composer looking unsent, and a member
            // resending it would have posted a duplicate. Check the thread's
            // actual state before assuming the send truly failed.
            if let fresh = try? await store.loadThread(id: threadID),
               fresh.messages.contains(where: { $0.fromMe && $0.body == text }) {
                conversation = fresh
            } else {
                messageText = text // put it back rather than losing what they typed
                errorMessage = error.localizedDescription
            }
        }
        isSending = false
    }

    private func beginEdit(_ message: DMMessage) {
        replyingTo = nil
        editingMessage = message
        messageText = message.body
    }

    private func cancelEdit() {
        editingMessage = nil
        messageText = ""
    }

    private func beginReply(_ message: DMMessage) {
        editingMessage = nil
        replyingTo = message
    }

    private func saveEdit() async {
        guard let editingMessage else { return }
        let text = messageText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        isSending = true
        do {
            let updated = try await store.editMessage(threadID: threadID, messageID: editingMessage.id, newText: text)
            if let c = conversation {
                let messages = c.messages.map { $0.id == updated.id ? updated : $0 }
                conversation = DMConversation(threadID: c.threadID, otherUserID: c.otherUserID, otherName: c.otherName,
                                               otherHasAvatar: c.otherHasAvatar, blocked: c.blocked, messages: messages)
            }
            self.editingMessage = nil
            messageText = ""
        } catch {
            errorMessage = error.localizedDescription
        }
        isSending = false
    }

    private func like(_ message: DMMessage) async {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        do {
            let result = try await store.toggleLike(threadID: threadID, messageID: message.id)
            if let c = conversation {
                let messages = c.messages.map { m -> DMMessage in
                    guard m.id == message.id else { return m }
                    var updated = m
                    updated.likedByMe = result.liked
                    updated.likeCount = result.count
                    return updated
                }
                conversation = DMConversation(threadID: c.threadID, otherUserID: c.otherUserID, otherName: c.otherName,
                                               otherHasAvatar: c.otherHasAvatar, blocked: c.blocked, messages: messages)
            }
        } catch {
            // A failed like tap isn't worth an alert -- just leave the heart as it was.
        }
    }

    private func sendVerse(_ reference: String) async {
        let replyToID = replyingTo?.id
        replyingTo = nil
        do {
            let sent = try await store.sendVerse(threadID: threadID, reference: reference, replyToID: replyToID)
            if let c = conversation {
                conversation = DMConversation(threadID: c.threadID, otherUserID: c.otherUserID, otherName: c.otherName,
                                               otherHasAvatar: c.otherHasAvatar, blocked: c.blocked, messages: c.messages + [sent])
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func toggleBlock() async {
        do {
            if conversation?.blocked == true { try await APIClient.shared.unblockUser(id: otherUserID) }
            else { try await APIClient.shared.blockUser(id: otherUserID) }
            await load()
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct DMBubble: View {
    let message: DMMessage
    let onLike: () -> Void
    let onEdit: (() -> Void)?
    let onReply: () -> Void
    /// Non-nil only for a "verse" kind message -- tapping it opens the full
    /// passage in VerseThreadView instead of leaving the reference and one
    /// line of text as the only thing either side can ever see of it.
    let onOpenVerse: ((String) -> Void)?

    var body: some View {
        HStack {
            if message.fromMe { Spacer(minLength: 40) }
            VStack(alignment: message.fromMe ? .trailing : .leading, spacing: 4) {
                if let reply = message.replyTo {
                    replyQuote(reply)
                }
                if message.kind == "e2e" {
                    Label("End-to-end encrypted", systemImage: "lock.fill")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                if message.kind == "verse", let ref = message.verseReference {
                    Button { onOpenVerse?(ref) } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 4) {
                                Text(ref).font(.caption.weight(.semibold))
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption2)
                            }
                            Text(message.body).font(.callout).lineLimit(4)
                            Text("Tap to read the full passage").font(.caption2).foregroundStyle(.secondary)
                        }
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 12).fill(.tint.opacity(0.15)))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.primary)
                } else if message.kind == "reel", let reel = message.sharedReel {
                    sharedReelCard(reel)
                } else if message.kind == "workout", let workout = message.sharedWorkout {
                    sharedWorkoutCard(workout)
                } else if message.kind == "bible_answer", let answer = message.sharedBibleAnswer {
                    sharedBibleAnswerCard(answer)
                } else {
                    Text(message.body)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 16).fill(message.fromMe ? Color.accentColor : Color(.secondarySystemBackground)))
                        .foregroundStyle(message.fromMe ? .white : .primary)
                }
                HStack(spacing: 6) {
                    Button(action: onLike) {
                        HStack(spacing: 3) {
                            Image(systemName: message.likedByMe ? "heart.fill" : "heart")
                                .foregroundStyle(message.likedByMe ? FFTheme.seal : .secondary)
                            if message.likeCount > 0 {
                                Text("\(message.likeCount)")
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    Text(message.createdAt, style: .time)
                    if message.fromMe && message.read { Text("· read") }
                    if message.editedAt != nil { Text("· edited") }
                }
                .font(.caption2).foregroundStyle(.secondary)
            }
            .contextMenu {
                Button { onReply() } label: { Label("Reply", systemImage: "arrowshape.turn.up.left") }
                if let onEdit {
                    Button { onEdit() } label: { Label("Edit", systemImage: "pencil") }
                }
            }
            if !message.fromMe { Spacer(minLength: 40) }
        }
    }

    @ViewBuilder
    private func sharedReelCard(_ reel: DMSharedReel) -> some View {
        let card = HStack(spacing: 10) {
            if let thumb = reel.thumbnailURL, let url = URL(string: thumb) {
                AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.15) }
                    .frame(width: 48, height: 48)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            } else {
                RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.tint.opacity(0.15))
                    .frame(width: 48, height: 48)
                    .overlay(Image(systemName: "play.rectangle.fill").foregroundStyle(.tint))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Shared a reel").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Text(reel.title ?? "Untitled").font(.callout).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(.tint.opacity(0.12)))
        .foregroundStyle(.primary)

        if let sourceURL = reel.sourceURL, let url = URL(string: sourceURL) {
            Link(destination: url) { card }
        } else {
            card
        }
    }

    private func sharedWorkoutCard(_ workout: DMSharedWorkout) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "figure.run.circle.fill").font(.title).foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 2) {
                Text("Shared a workout").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Text(workout.type).font(.callout.weight(.semibold))
                HStack(spacing: 8) {
                    if let km = workout.distanceKM, km > 0.05 {
                        Text(Units.distanceString(km: km))
                    }
                    if let sec = workout.durationSec {
                        Text(TrainingMath.elapsedString(TimeInterval(sec)))
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(.tint.opacity(0.12)))
        .foregroundStyle(.primary)
    }

    private func sharedBibleAnswerCard(_ answer: DMSharedBibleAnswer) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Bible Answers", systemImage: "questionmark.bubble.fill")
                .font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            Text(answer.question).font(.callout.weight(.semibold)).lineLimit(2)
            Text(answer.answer).font(.callout).foregroundStyle(.secondary).lineLimit(6)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(.tint.opacity(0.12)))
        .foregroundStyle(.primary)
    }

    private func replyQuote(_ reply: DMReplyPreview) -> some View {
        HStack(spacing: 6) {
            Rectangle().fill(.secondary.opacity(0.4)).frame(width: 2)
            VStack(alignment: .leading, spacing: 1) {
                Text(reply.fromMe ? "You" : "Them").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Text(replySnippetText(reply)).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    private func replySnippetText(_ reply: DMReplyPreview) -> String {
        switch reply.kind {
        case "e2e": return "🔒 Encrypted message"
        case "verse": return reply.body ?? "Shared a verse"
        case "reel": return reply.body ?? "Shared a reel"
        case "workout": return reply.body ?? "Shared a workout"
        case "bible_answer": return reply.body ?? "Shared a Bible Answers response"
        default: return reply.body ?? "…"
        }
    }
}

/// "Find and send" a verse without leaving the conversation -- a reference
/// lookup, not a full keyword search, matching the pattern VerseLookupView
/// already uses elsewhere: type a reference, resolve it against the
/// verified canon, send only what actually resolved.
private struct DMVersePickerSheet: View {
    let onSend: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var reference = ""
    @State private var result: ResolvedPassage?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showBrowse = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button { showBrowse = true } label: {
                        Label("Browse the Bible", systemImage: "book.pages")
                    }
                } footer: {
                    Text("No reference memorized? Browse by book and chapter instead.")
                }
                .listRowBackground(FFTheme.parchment1)

                Section {
                    TextField("e.g. \"Philippians 4:13\"", text: $reference)
                        .autocorrectionDisabled()
                    Button(isLoading ? "Looking up…" : "Look up") { Task { await lookup() } }
                        .disabled(reference.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
                } header: {
                    Text("Or type a reference")
                }
                .listRowBackground(FFTheme.parchment1)

                if let result {
                    Section {
                        Text(result.text).font(FFTheme.serif())
                        Text(result.reference).font(.caption).foregroundStyle(.secondary)
                        Button("Send this verse") { onSend(result.reference); dismiss() }
                            .buttonStyle(.ffPrimary)
                    }
                    .listRowBackground(FFTheme.parchment1)
                }
            }
            .ffListChrome()
            .navigationTitle("Share a Verse")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .navigationDestination(isPresented: $showBrowse) {
                BibleBrowseView { verse in
                    onSend(verse.reference)
                    dismiss()
                }
            }
            .alert("Could not look that up", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
        }
    }

    private func lookup() async {
        isLoading = true
        do {
            result = try await APIClient.shared.lookupVerse(reference: reference.trimmingCharacters(in: .whitespaces))
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

#Preview {
    NavigationStack { DMConversationView(threadID: "preview", otherUserID: UUID(), otherName: "Sam T.") }
        .environmentObject(DMStore())
}
