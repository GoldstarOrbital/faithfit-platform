import SwiftUI

struct SearchView: View {
    // Defaults true for the other two call sites (ExploreCatalog's own
    // pushed "search" catalog tile, and previews), which are ordinary
    // push/pop navigation with no simultaneous-mounting concern. Only
    // SearchSectionShell (AppShell.swift) passes the real value.
    var isActive: Bool = true

    @State private var query = ""
    @State private var results: SearchResponse?
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var searchGeneration = UUID()

    var body: some View {
        // Keep the field in the screen instead of relying on navigation-bar
        // search chrome. This root stays mounted with the other tab roots,
        // where UIKit's `.searchable` attachment can be lost.
        VStack(spacing: 0) {
            searchField
            content
        }
            .navigationTitle("Search")
            .onChange(of: query) { _, newValue in
                searchTask?.cancel()
                let generation = UUID()
                searchGeneration = generation
                let trimmed = newValue.trimmingCharacters(in: .whitespaces)
                guard trimmed.count >= 2 else { results = nil; isSearching = false; return }
                searchTask = Task {
                    try? await Task.sleep(nanoseconds: 300_000_000) // debounce -- matches the web's own search-as-you-type pacing
                    guard !Task.isCancelled else { return }
                    await runSearch(trimmed, generation: generation)
                }
            }
            .alert("Search failed", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
    }

    private var searchField: some View {
        HStack(spacing: FFTheme.Space.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(FFTheme.inkSoft)
            TextField("People, groups, journeys, scripture…", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { searchImmediately() }
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(FFTheme.inkSoft)
                }
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, FFTheme.Space.md)
        .padding(.vertical, FFTheme.Space.sm)
        .background(FFTheme.parchment2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(FFTheme.hairline, lineWidth: 1)
        }
        .padding(.horizontal, FFTheme.Space.lg)
        .padding(.vertical, FFTheme.Space.sm)
        .accessibilityIdentifier("home-search-field")
    }

    private func searchImmediately() {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else { return }
        searchTask?.cancel()
        let generation = UUID()
        searchGeneration = generation
        searchTask = Task { await runSearch(trimmed, generation: generation) }
    }

    @ViewBuilder
    private var content: some View {
        if query.trimmingCharacters(in: .whitespaces).count < 2 {
            ContentUnavailableView.search
        } else if isSearching && results == nil {
            ProgressView()
        } else if let results, results.total == 0 {
            ContentUnavailableView.search(text: query)
        } else if let results {
            List {
                ForEach(results.groups) { group in
                    Section(group.label) {
                        ForEach(group.items) { item in
                            resultRow(item, groupType: group.type)
                        }
                    }
                    .listRowBackground(FFTheme.parchment1)
                }
            }
            .ffListChrome()
        }
    }

    @ViewBuilder
    private func resultRow(_ item: SearchResultItem, groupType: String) -> some View {
        if groupType == "people", let uuid = UUID(uuidString: item.id) {
            NavigationLink(value: SearchPersonDestination(id: uuid, name: item.title)) {
                resultLabel(item, systemImage: "person.crop.circle")
            }
            .navigationDestination(for: SearchPersonDestination.self) { person in
                MemberProfileView(userID: person.id)
            }
        } else if groupType == "scripture", let ref = Self.parseScriptureReference(item.id) {
            NavigationLink {
                BiblePassageView(book: ref.book, chapter: ref.chapter, highlightVerse: ref.verse)
            } label: {
                resultLabel(item, systemImage: icon(for: groupType))
            }
        } else {
            resultLabel(item, systemImage: icon(for: groupType))
        }
    }

    /// The scripture group's `id` is the server's own canonical "Book Ch:Vs"
    /// string (lib bible-search, e.g. "1 Corinthians 13:4"). Split on the
    /// *last* space rather than the first, since book names themselves can
    /// contain spaces.
    private static func parseScriptureReference(_ ref: String) -> (book: String, chapter: Int, verse: Int)? {
        guard let lastSpace = ref.lastIndex(of: " ") else { return nil }
        let book = String(ref[ref.startIndex..<lastSpace]).trimmingCharacters(in: .whitespaces)
        let chapterVerse = ref[ref.index(after: lastSpace)...].split(separator: ":")
        guard !book.isEmpty, chapterVerse.count == 2,
              let chapter = Int(chapterVerse[0]), let verse = Int(chapterVerse[1]) else { return nil }
        return (book, chapter, verse)
    }

    private func resultLabel(_ item: SearchResultItem, systemImage: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage).foregroundStyle(.tint).frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                if let subtitle = item.subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
        }
    }

    private func icon(for groupType: String) -> String {
        switch groupType {
        case "posts": return "text.bubble"
        case "journeys": return "map"
        case "challenges": return "flag.pattern.checkered"
        case "groups": return "person.3"
        case "videos": return "play.rectangle"
        case "podcasts": return "microphone"
        case "scripture": return "book"
        default: return "magnifyingglass"
        }
    }

    private func runSearch(_ q: String, generation: UUID) async {
        isSearching = true
        defer { if searchGeneration == generation { isSearching = false } }
        do {
            let response = try await APIClient.shared.search(q)
            guard !Task.isCancelled, searchGeneration == generation else { return }
            results = response
        } catch {
            guard !Task.isCancelled, searchGeneration == generation else { return }
            errorMessage = error.localizedDescription
        }
    }
}

private struct SearchPersonDestination: Hashable {
    let id: UUID
    let name: String
}

#Preview {
    NavigationStack { SearchView() }
        .environmentObject(NativeSession())
        .environmentObject(DMStore())
}
