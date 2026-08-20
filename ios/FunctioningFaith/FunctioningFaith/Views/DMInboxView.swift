import SwiftUI

struct DMInboxView: View {
    @EnvironmentObject private var session: NativeSession
    /// Shared with RootTabView so the tab badge and inbox stay in sync.
    @EnvironmentObject private var store: DMStore
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading && store.threads.isEmpty {
                FFLoadingView(message: "Loading conversations…")
            } else if store.threads.isEmpty {
                FFEmptyStateView(
                    title: "No conversations yet",
                    systemImage: "bubble.left.and.bubble.right",
                    message: "Message someone from their profile to start a conversation."
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

private struct DMThreadRow: View {
    let thread: DMThreadPreview

    var body: some View {
        HStack(spacing: FFTheme.Space.sm) {
            Circle()
                .fill(.secondary.opacity(0.2))
                .frame(width: FFTheme.minTapTarget, height: FFTheme.minTapTarget)
                .overlay(
                    Text(initials(thread.otherName))
                        .font(.subheadline.weight(.semibold))
                )
                .accessibilityHidden(true)

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

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first }
        return String(letters).uppercased()
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
