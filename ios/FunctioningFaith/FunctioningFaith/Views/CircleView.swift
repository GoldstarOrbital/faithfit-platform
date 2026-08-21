import SwiftUI

/// Trusted circle: a subset of your own followers who can see "circle"-
/// visibility posts. Only followers are eligible (see /circle/candidates on
/// the server) so this picker can never push private content at someone who
/// never chose to follow you.
struct CircleView: View {
    @State private var members: [CircleMember] = []
    @State private var maxSize = 150
    @State private var candidates: [CircleCandidate] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var workingID: String?

    var body: some View {
        Group {
            if isLoading && members.isEmpty && candidates.isEmpty {
                ProgressView()
            } else {
                List {
                    Section {
                        Text("\(members.count) of \(maxSize) members")
                            .font(.caption).foregroundStyle(.secondary)
                    } footer: {
                        Text("Circle posts are only visible to people you add here. Membership is one-directional and silent -- they're never told they were added.")
                    }
                    .listRowBackground(FFTheme.parchment1)
                    if !candidates.isEmpty {
                        Section("Your followers") {
                            ForEach(candidates) { candidate in
                                HStack {
                                    Text(candidate.displayName)
                                    Spacer()
                                    Button(candidate.inCircle ? "Remove" : "Add") {
                                        Task { await toggle(candidate) }
                                    }
                                    .disabled(workingID == candidate.id)
                                }
                            }
                        }
                        .listRowBackground(FFTheme.parchment1)
                    } else if !isLoading {
                        Section {
                            Text("Nobody follows you yet -- circle members can only be chosen from your followers.")
                                .foregroundStyle(.secondary)
                        }
                        .listRowBackground(FFTheme.parchment1)
                    }
                }
                .ffListChrome()
                .refreshable { await load() }
            }
        }
        .navigationTitle("Trusted circle")
        .task { await load() }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        do {
            async let m = APIClient.shared.fetchCircle()
            async let c = APIClient.shared.fetchCircleCandidates()
            let (memberResult, candidateResult) = try await (m, c)
            members = memberResult; candidates = candidateResult
        } catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func toggle(_ candidate: CircleCandidate) async {
        workingID = candidate.id
        do {
            try await APIClient.shared.setCircleMembership(userID: candidate.userID, inCircle: !candidate.inCircle)
            await load()
        } catch { errorMessage = error.localizedDescription }
        workingID = nil
    }
}

#Preview { NavigationStack { CircleView() } }
