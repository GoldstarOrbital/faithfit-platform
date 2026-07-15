import SwiftUI

struct HomeFeedView: View {
    @State private var posts: [FeedPost] = []
    @State private var isLoading = true

    var body: some View {
        List {
            ForEach(posts) { post in
                FeedPostRow(post: post)
                    .swipeActions(edge: .trailing) {
                        Button { /* like */ } label: { Label("Like", systemImage: "heart.fill") }
                            .tint(.pink)
                        Button { /* share */ } label: { Label("Share", systemImage: "square.and.arrow.up") }
                            .tint(.blue)
                    }
            }
        }
        .listStyle(.plain)
        .refreshable { await loadFeed() }
        .navigationTitle("Home")
        .task { await loadFeed() }
        .overlay {
            if isLoading && posts.isEmpty { ProgressView() }
        }
    }

    private func loadFeed() async {
        isLoading = true
        defer { isLoading = false }
        posts = (try? await APIClient.shared.fetchFeed()) ?? []
    }
}

struct FeedPostRow: View {
    let post: FeedPost

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(post.authorName)
                .font(.system(.subheadline, design: .default).weight(.semibold))
                .accessibilityAddTraits(.isHeader)

            Text(post.content)
                .font(.system(size: 16))
                .dynamicTypeSize(.large ... .accessibility3)

            if let workout = post.workout {
                WorkoutCard(workout: workout)
            }

            if let verse = post.verse {
                VerseSnippetCard(verse: verse)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

struct WorkoutCard: View {
    let workout: WorkoutSummary
    var body: some View {
        HStack {
            Image(systemName: "figure.run").imageScale(.large)
            VStack(alignment: .leading) {
                Text(workout.type).font(.footnote.weight(.semibold))
                if let cal = workout.calories, let hr = workout.avgHR {
                    Text("\(cal) kcal · avg HR \(hr)").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct VerseSnippetCard: View {
    let verse: VerseSnippet
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verse.reference).font(.caption.weight(.bold)).foregroundStyle(.indigo)
            Text(verse.snippet).font(.caption).italic()
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.indigo.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("Scripture: \(verse.reference). \(verse.snippet)")
    }
}

#Preview { NavigationStack { HomeFeedView() } }
