import SwiftUI

/// Organiser-only. The server itself enforces every rule here (can't remove
/// the owner, can't remove yourself this way, 404s for a non-admin caller)
/// -- this view is a management surface over those rules, not a second copy
/// of them.
struct GroupMembersView: View {
    let groupID: String
    @State private var members: [GroupMemberEntry] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var removeCandidate: GroupMemberEntry?

    var body: some View {
        Group {
            if isLoading && members.isEmpty {
                ProgressView()
            } else {
                List(members) { member in
                    HStack {
                        VStack(alignment: .leading) {
                            HStack(spacing: 4) {
                                Text(member.displayName)
                                if member.verifiedLeader {
                                    Image(systemName: "checkmark.seal.fill")
                                        .font(.caption)
                                        .foregroundStyle(FFTheme.goldBright)
                                        .accessibilityLabel("Verified leader")
                                }
                            }
                            if member.isAdmin {
                                Text(member.verifiedLeader ? "Verified leader" : "Admin")
                                    .font(.caption)
                                    .foregroundStyle(member.verifiedLeader ? FFTheme.goldBright : FFTheme.gold)
                            }
                        }
                        Spacer()
                        Button("Remove", role: .destructive) { removeCandidate = member }
                    }
                }
                .ffListChrome()
                .refreshable { await load() }
            }
        }
        .navigationTitle("Members")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .confirmationDialog(
            "Remove \(removeCandidate?.displayName ?? "this member")?",
            isPresented: Binding(get: { removeCandidate != nil }, set: { if !$0 { removeCandidate = nil } }),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) { Task { await remove() } }
            Button("Cancel", role: .cancel) { }
        }
        .alert("Could not complete that action", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        do { members = try await APIClient.shared.fetchGroupMembers(groupID: groupID) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func remove() async {
        guard let candidate = removeCandidate else { return }
        removeCandidate = nil
        do {
            try await APIClient.shared.removeGroupMember(groupID: groupID, userID: candidate.userID)
            members.removeAll { $0.id == candidate.id }
        } catch { errorMessage = error.localizedDescription }
    }
}

#Preview { NavigationStack { GroupMembersView(groupID: "preview") } }
