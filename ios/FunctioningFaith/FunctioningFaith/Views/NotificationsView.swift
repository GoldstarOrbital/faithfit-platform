import SwiftUI

/// Local Identifiable wrapper so `.navigationDestination(item:)` has
/// something conforming without adding a global `String: Identifiable`
/// conformance to the whole module (a broader, riskier change than this
/// screen needs).
private struct ThreadDestination: Identifiable, Hashable { let id: String }

struct NotificationsView: View {
    @State private var notifications: [NotificationItem] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var openThread: ThreadDestination?

    var body: some View {
        Group {
            if isLoading && notifications.isEmpty {
                ProgressView()
            } else if notifications.isEmpty {
                ContentUnavailableView("No notifications yet", systemImage: "bell", description: Text("You'll see activity on your posts, workouts, and groups here."))
            } else {
                List(notifications) { item in
                    NotificationRow(item: item)
                        .contentShape(Rectangle())
                        .onTapGesture { Task { await open(item) } }
                        .listRowBackground(item.isRead ? Color.clear : Color.accentColor.opacity(0.06))
                }
                .refreshable { await load() }
            }
        }
        .navigationTitle("Notifications")
        .toolbar {
            if notifications.contains(where: { !$0.isRead }) {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Mark all read") { Task { await markAllRead() } }
                }
            }
        }
        .navigationDestination(item: $openThread) { _ in
            // thread_id alone doesn't carry the other person's name or id --
            // DMConversationView needs both. Fall back to opening the inbox;
            // full deep-linking into a specific thread from a notification
            // is worth revisiting once there's a lightweight "resolve thread"
            // endpoint, rather than guessing at names here.
            DMInboxView()
        }
        .task { await load() }
        .alert("Could not load notifications", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        do { notifications = try await APIClient.shared.fetchNotifications().notifications }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func open(_ item: NotificationItem) async {
        if !item.isRead {
            try? await APIClient.shared.markNotificationRead(id: item.id)
            if let idx = notifications.firstIndex(where: { $0.id == item.id }) {
                notifications[idx] = NotificationItem(id: item.id, type: item.type, payload: item.payload, deliveredAt: item.deliveredAt, read: 1, url: item.url)
            }
        }
        if item.type == "dm" { openThread = ThreadDestination(id: "inbox") }
    }

    private func markAllRead() async {
        do {
            try await APIClient.shared.markAllNotificationsRead()
            notifications = notifications.map { NotificationItem(id: $0.id, type: $0.type, payload: $0.payload, deliveredAt: $0.deliveredAt, read: 1, url: $0.url) }
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct NotificationRow: View {
    let item: NotificationItem

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).foregroundStyle(.tint).frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.message).font(item.isRead ? .subheadline : .subheadline.weight(.semibold))
                Text(item.deliveredAt).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 2)
    }

    private var icon: String {
        switch item.type {
        case "dm": return "bubble.left.fill"
        case "verse", "reflection": return "book.fill"
        case "challenge_complete", "badge", "quest": return "star.fill"
        case "streak": return "flame.fill"
        case "security", "moderation": return "shield.fill"
        default: return "bell.fill"
        }
    }
}

#Preview { NavigationStack { NotificationsView() } }
