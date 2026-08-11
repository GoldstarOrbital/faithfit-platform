import SwiftUI

struct ExploreView: View {
    @State private var suggestions: [SuggestedUser] = []
    @State private var isLoadingSuggestions = true

    var body: some View {
        List {
            Section {
                if isLoadingSuggestions {
                    ProgressView("Finding your community…")
                } else if suggestions.isEmpty {
                    Text("You’re all caught up. Check back as more people join your communities.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(suggestions) { user in
                        HStack(spacing: 12) {
                            Image(systemName: "person.crop.circle.fill")
                                .font(.title2)
                                .foregroundStyle(.indigo)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(user.displayName).font(.headline)
                                Text(user.reason).font(.caption).foregroundStyle(.secondary)
                                if let bio = user.bio, !bio.isEmpty {
                                    Text(bio).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            Spacer()
                            Button(user.isFollowing ? "Following" : "Follow") {
                                follow(user)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(user.isFollowing ? .gray : .indigo)
                            .disabled(user.isFollowing)
                        }
                        .padding(.vertical, 4)
                    }
                }
            } header: {
                Text("People for you")
            } footer: {
                Text("Suggestions are based on shared communities and mutual connections. You can unfollow any time from the web profile.")
            }
            Section("Challenges") { Text("Faithful Five - weekly workout challenge") }
            Section("Groups") { Text("Sunrise 5K Fellowship (synced via Gloo)") }
            Section("Quests") { Text("Scripture Streak - 7 day devotion quest") }
        }
        .navigationTitle("Explore")
        .task { await loadSuggestions() }
        .refreshable { await loadSuggestions() }
    }

    private func loadSuggestions() async {
        isLoadingSuggestions = true
        defer { isLoadingSuggestions = false }
        suggestions = (try? await APIClient.shared.fetchSuggestedUsers()) ?? []
    }

    private func follow(_ user: SuggestedUser) {
        Task {
            guard let response = try? await APIClient.shared.followUser(id: user.id),
                  let index = suggestions.firstIndex(where: { $0.id == user.id }) else { return }
            suggestions[index].isFollowing = response.following
        }
    }
}

#Preview { NavigationStack { ExploreView() } }
