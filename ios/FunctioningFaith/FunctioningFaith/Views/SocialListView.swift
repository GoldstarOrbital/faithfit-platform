import SwiftUI

/// Browsing a member's followers or following list -- the tap-through that
/// was previously missing entirely: MemberProfileView showed the counts as
/// plain, non-interactive numbers with nowhere to go. Followers and
/// following are the exact same shape server-side (see the server's shared
/// socialList handler), so one generic view covers both instead of two
/// near-duplicates.
struct SocialListView: View {
    let userID: UUID
    let kind: String  // "followers" | "following"
    let title: String

    @State private var members: [SocialListMember] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var followBusy: Set<UUID> = []
    // A row containing both a NavigationLink and a second tappable sibling
    // (the Follow button) only ever gets one tap target for the whole row --
    // the same chevron-sharing bug fixed elsewhere in this app. Routing
    // "open this member's profile" through a plain Button + this shared
    // destination keeps the Follow button a genuinely separate tap target.
    @State private var openedProfile: UUID?

    var body: some View {
        Group {
            if isLoading && members.isEmpty {
                FFLoadingView(message: "Loading \(title.lowercased())…")
            } else if let errorMessage, members.isEmpty {
                FFErrorStateView(message: errorMessage, onRetry: { Task { await load() } })
            } else if members.isEmpty {
                FFEmptyStateView(title: "No \(title.lowercased()) yet", systemImage: "person.2",
                                  message: "Nobody to show here yet.")
            } else {
                List(members) { row($0) }
                    .ffListChrome()
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .navigationDestination(item: $openedProfile) { id in MemberProfileView(userID: id) }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil && !members.isEmpty }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func row(_ member: SocialListMember) -> some View {
        HStack(spacing: 12) {
            Button { openedProfile = member.id } label: {
                HStack(spacing: 12) {
                    MemberAvatarView(userID: member.id, hasAvatar: member.hasAvatar, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(member.displayName).font(FFTheme.serifSemibold(16)).foregroundStyle(FFTheme.ink)
                        if let ref = member.bioVerseRef, !ref.isEmpty {
                            Text(ref).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(.plain)

            if let isFollowing = member.isFollowing {
                Button(isFollowing ? "Following" : "Follow") { Task { await toggleFollow(member) } }
                    .buttonStyle(isFollowing ? .ffGhost : .ffPrimary)
                    .font(.caption)
                    .disabled(followBusy.contains(member.id))
            }
        }
        .padding(.vertical, 4)
        .listRowBackground(FFTheme.parchment1)
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            let response = try await APIClient.shared.fetchSocialList(userID: userID, kind: kind)
            members = response.members
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func toggleFollow(_ member: SocialListMember) async {
        guard let idx = members.firstIndex(where: { $0.id == member.id }) else { return }
        followBusy.insert(member.id)
        defer { followBusy.remove(member.id) }
        do {
            let result = try await APIClient.shared.followUser(id: member.id)
            members[idx].isFollowing = result.following
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview { NavigationStack { SocialListView(userID: UUID(), kind: "followers", title: "Followers") } }
