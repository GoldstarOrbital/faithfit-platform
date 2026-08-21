import SwiftUI

struct FollowRequestsView: View {
    @State private var requests: [FollowRequestUser] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var workingID: String?

    var body: some View {
        Group {
            if isLoading && requests.isEmpty {
                ProgressView()
            } else if requests.isEmpty {
                ContentUnavailableView("No pending requests", systemImage: "person.crop.circle.badge.checkmark")
            } else {
                List(requests) { request in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(request.displayName).font(.body.weight(.medium))
                        if let bio = request.bioVerseRef, !bio.isEmpty {
                            Text(bio).font(.caption).foregroundStyle(.secondary)
                        }
                        HStack {
                            Button("Accept") { Task { await decide(request, "accept") } }
                                .buttonStyle(.ffPrimary)
                            Button("Decline") { Task { await decide(request, "decline") } }
                                .buttonStyle(.ffGhost)
                        }
                        .disabled(workingID == request.id)
                    }
                    .padding(.vertical, 4)
                }
                .ffListChrome()
                .refreshable { await load() }
            }
        }
        .navigationTitle("Follow requests")
        .task { await load() }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        do { requests = try await APIClient.shared.fetchFollowRequests() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func decide(_ request: FollowRequestUser, _ decision: String) async {
        workingID = request.id
        do {
            try await APIClient.shared.decideFollowRequest(requesterID: request.userID, decision: decision)
            requests.removeAll { $0.id == request.id }
        } catch { errorMessage = error.localizedDescription }
        workingID = nil
    }
}

#Preview { NavigationStack { FollowRequestsView() } }
