import SwiftUI

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
                            DMBubble(message: message).id(message.id)
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
            HStack(spacing: 10) {
                TextField("Message…", text: $messageText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                Button {
                    Task { await send() }
                } label: {
                    if isSending { ProgressView() } else { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                }
                .disabled(messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending || (conversation?.blocked ?? false))
            }
            .padding(10)
        }
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
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        do { conversation = try await store.loadThread(id: threadID) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func send() async {
        let text = messageText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        messageText = ""
        isSending = true
        do {
            let sent = try await store.send(threadID: threadID, to: otherUserID, text: text)
            if let c = conversation {
                conversation = DMConversation(threadID: c.threadID, otherUserID: c.otherUserID, otherName: c.otherName,
                                               otherHasAvatar: c.otherHasAvatar, blocked: c.blocked, messages: c.messages + [sent])
            }
        } catch {
            messageText = text // put it back rather than losing what they typed
            errorMessage = error.localizedDescription
        }
        isSending = false
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

    var body: some View {
        HStack {
            if message.fromMe { Spacer(minLength: 40) }
            VStack(alignment: message.fromMe ? .trailing : .leading, spacing: 4) {
                if message.kind == "e2e" {
                    Label("End-to-end encrypted", systemImage: "lock.fill")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                if message.kind == "verse", let ref = message.verseReference {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(ref).font(.caption.weight(.semibold))
                        Text(message.body).font(.callout)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 12).fill(.tint.opacity(0.15)))
                } else {
                    Text(message.body)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 16).fill(message.fromMe ? Color.accentColor : Color(.secondarySystemBackground)))
                        .foregroundStyle(message.fromMe ? .white : .primary)
                }
                HStack(spacing: 4) {
                    Text(message.createdAt, style: .time)
                    if message.fromMe && message.read { Text("· read") }
                }
                .font(.caption2).foregroundStyle(.secondary)
            }
            if !message.fromMe { Spacer(minLength: 40) }
        }
    }
}

#Preview {
    NavigationStack { DMConversationView(threadID: "preview", otherUserID: UUID(), otherName: "Sam T.") }
        .environmentObject(DMStore())
}
