import SwiftUI

struct NotificationsView: View {
    @EnvironmentObject private var deepLinks: DeepLinkRouter
    @State private var notifications: [NotificationItem] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

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
                .ffListChrome()
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

    // Every notification already carries a `url` (see fetchNotifications /
    // GET /api/notifications) but nothing here ever read it except a DM
    // special case that didn't even use it -- it just opened the generic
    // inbox, since a bare thread_id has no name/user id for DMConversationView
    // to open directly. Every OTHER type (post, group, verse, workout,
    // follow, badge, challenge, streak...) did nothing at all beyond marking
    // read. DeepLink.fromNotificationURL + DeepLinkRouter.apply reuses the
    // exact same routing this session already wired up for dm/post/group/
    // verse/athlete/workout deep links, including DM now opening the actual
    // thread instead of just the inbox.
    private func open(_ item: NotificationItem) async {
        if !item.isRead {
            try? await APIClient.shared.markNotificationRead(id: item.id)
            if let idx = notifications.firstIndex(where: { $0.id == item.id }) {
                notifications[idx] = NotificationItem(id: item.id, type: item.type, payload: item.payload, deliveredAt: item.deliveredAt, read: 1, url: item.url)
            }
        }
        guard let raw = item.url, let link = DeepLink.fromNotificationURL(raw) else { return }
        deepLinks.apply(link)
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

#Preview { NavigationStack { NotificationsView() }.environmentObject(DeepLinkRouter()) }
