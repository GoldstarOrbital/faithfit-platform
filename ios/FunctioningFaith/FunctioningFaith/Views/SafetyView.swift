import SwiftUI

/// Everyone the member has muted, restricted, or blocked, with an undo for
/// each -- mirrors the web app's /me/relationships screen. Mute and restrict
/// are enforced entirely server-side (feed filtering, DM open/send); this
/// view is purely a management surface over controls that already work.
struct SafetyView: View {
    @State private var relationships: RelationshipsResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var workingID: String?

    var body: some View {
        Group {
            if isLoading && relationships == nil {
                ProgressView()
            } else if let relationships, isEmpty(relationships) {
                ContentUnavailableView("Nobody muted, restricted, or blocked", systemImage: "hand.raised", description: Text("Safety controls you apply to other members appear here."))
            } else if let relationships {
                List {
                    section("Muted", items: relationships.muted, control: "mute", note: "Their posts and workouts stay out of your feed. They can't tell.")
                    section("Restricted", items: relationships.restricted, control: "restrict", note: "New message threads from them are blocked; existing conversations still work.")
                    section("Blocked", items: relationships.blocked, control: "block", note: "Neither of you can message the other.")
                }
                .ffListChrome()
                .refreshable { await load() }
            }
        }
        .navigationTitle("Safety controls")
        .task { await load() }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func isEmpty(_ r: RelationshipsResponse) -> Bool { r.muted.isEmpty && r.restricted.isEmpty && r.blocked.isEmpty }

    @ViewBuilder
    private func section(_ title: String, items: [RelationshipUser], control: String, note: String) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { user in
                    HStack {
                        Text(user.displayName)
                        Spacer()
                        Button("Undo") { Task { await undo(user, control: control) } }
                            .disabled(workingID == user.id)
                    }
                }
            } header: { Text(title) } footer: { Text(note) }
            .listRowBackground(FFTheme.parchment1)
        }
    }

    private func load() async {
        isLoading = true
        do { relationships = try await APIClient.shared.fetchRelationships() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func undo(_ user: RelationshipUser, control: String) async {
        workingID = user.id
        do {
            if control == "block", let uuid = UUID(uuidString: user.userID) {
                try await APIClient.shared.unblockUser(id: uuid)
            } else {
                try await APIClient.shared.setRelationshipControl(userID: user.userID, control: control, on: false)
            }
            await load()
        } catch { errorMessage = error.localizedDescription }
        workingID = nil
    }
}

#Preview { NavigationStack { SafetyView() } }
