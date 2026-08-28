import SwiftUI

/// A term/topic search across the whole local library -- for someone with a
/// word or idea in mind ("peace", "forgiveness") rather than an exact
/// reference already memorized. Complements VerseLookupView's exact-reference
/// lookup and VerseCategoryBrowseView's theme browsing: three different ways
/// into the same Scripture, for three different starting points a member
/// might actually have.
struct BibleSearchView: View {
    @State private var query = ""
    @State private var response: BibleSearchResponse?
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var threadVerse: BibleVerse?

    var body: some View {
        Form {
            Section {
                TextField("e.g. \"peace\" or \"forgiveness\"", text: $query)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await search() } }
                Button("Search") { Task { await search() } }
                    .disabled(query.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
            } header: {
                Text("Search by word or topic")
            } footer: {
                Text("Searches the verse text itself, not just references -- try a feeling, a virtue, or a word you remember from a verse.")
            }
            .listRowBackground(FFTheme.parchment1)

            if isLoading && response == nil {
                Section { FFLoadingView(message: "Searching…") }
                    .listRowBackground(Color.clear)
            } else if let errorMessage, response == nil {
                Section { FFErrorStateView(message: errorMessage, onRetry: { Task { await search() } }) }
                    .listRowBackground(Color.clear)
            } else if let response {
                resultsSection(response)
            }
        }
        .ffListChrome()
        .navigationTitle("Search Scripture")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $threadVerse) { verse in
            VerseThreadView(reference: verse.reference)
        }
    }

    @ViewBuilder
    private func resultsSection(_ response: BibleSearchResponse) -> some View {
        if response.results.isEmpty {
            Section {
                FFEmptyStateView(title: "No matches", systemImage: "magnifyingglass",
                                  message: "Nothing in the library matches \"\(response.query)\". Try a different word.")
            }
            .listRowBackground(Color.clear)
        } else {
            Section("\(response.total) result\(response.total == 1 ? "" : "s") for \u{201c}\(response.query)\u{201d}") {
                ForEach(response.results) { verse in
                    Button { threadVerse = verse } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(verse.reference).font(FFTheme.serifSemibold(15)).foregroundStyle(FFTheme.scripture)
                            Text(verse.text).font(FFTheme.serif(15)).foregroundStyle(FFTheme.ink).lineLimit(3)
                        }
                        .padding(.vertical, 3)
                    }
                    .buttonStyle(.plain)
                }
                if response.results.count < response.total {
                    if isLoadingMore {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Button("Load more") { Task { await loadMore() } }
                    }
                }
            }
            .listRowBackground(FFTheme.parchment1)
        }
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        isLoading = true
        errorMessage = nil
        do { response = try await APIClient.shared.searchBible(query: trimmed) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func loadMore() async {
        guard let response else { return }
        isLoadingMore = true
        do {
            let next = try await APIClient.shared.searchBible(query: response.query, page: response.page + 1)
            self.response = BibleSearchResponse(query: response.query, page: next.page, limit: next.limit,
                                                 total: next.total, count: response.count + next.count,
                                                 results: response.results + next.results)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoadingMore = false
    }
}

#Preview { NavigationStack { BibleSearchView() } }
