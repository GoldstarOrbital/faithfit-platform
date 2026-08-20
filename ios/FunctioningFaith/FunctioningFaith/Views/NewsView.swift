import SwiftUI

/// Headline + summary only, never the full article body -- see lib/news.js.
/// Tapping opens the real source in Safari.
struct NewsView: View {
    @State private var items: [NewsItem] = []
    @State private var isLoading = true
    @State private var isDisabled = false
    @State private var errorMessage: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            if isLoading && items.isEmpty {
                ProgressView()
            } else if isDisabled {
                ContentUnavailableView("News isn't available right now", systemImage: "newspaper")
            } else if items.isEmpty {
                ContentUnavailableView("No headlines yet", systemImage: "newspaper", description: Text("Check back soon."))
            } else {
                List(items) { item in
                    Button {
                        if let url = URL(string: item.link) { openURL(url) }
                    } label: {
                        itemRow(item)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .navigationTitle("News")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .alert("Could not load news", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func itemRow(_ item: NewsItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.source).font(.caption2).foregroundStyle(.tint)
            Text(item.title).font(.headline).foregroundStyle(.primary)
            if let summary = item.summary {
                Text(summary).font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
        }
        .padding(.vertical, 3)
    }

    private func load() async {
        isLoading = true
        do {
            let response = try await APIClient.shared.fetchNews()
            items = response.items
            isDisabled = response.disabled ?? false
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

#Preview { NavigationStack { NewsView() } }
