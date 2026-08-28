import SwiftUI

/// Browsing Scripture by theme -- the seven deadly sins and the seven
/// virtues that answer them -- rather than by book/chapter or an exact
/// reference someone already has to know by heart. Mirrors BibleBrowseView's
/// own `onSelectVerse` pattern so this slots into the same DM verse picker,
/// and the same "Read" entry points, without a separate wiring path.
struct VerseCategoryBrowseView: View {
    var onSelectVerse: ((BibleVerse) -> Void)? = nil
    @State private var categories: [VerseCategory] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private var vices: [VerseCategory] { categories.filter { $0.kind == "vice" } }
    private var virtues: [VerseCategory] { categories.filter { $0.kind == "virtue" } }

    var body: some View {
        Group {
            if isLoading && categories.isEmpty {
                FFLoadingView(message: "Loading themes…")
            } else if let errorMessage, categories.isEmpty {
                FFErrorStateView(message: errorMessage, onRetry: { Task { await load() } })
            } else {
                List {
                    Section("The Seven Deadly Sins") {
                        ForEach(vices) { categoryRow($0) }
                    }
                    .listRowBackground(FFTheme.parchment1)

                    Section("The Seven Virtues") {
                        ForEach(virtues) { categoryRow($0) }
                    }
                    .listRowBackground(FFTheme.parchment1)
                }
                .ffListChrome()
            }
        }
        .navigationTitle("Browse by Theme")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func categoryRow(_ category: VerseCategory) -> some View {
        NavigationLink {
            VerseCategoryDetailView(category: category, onSelectVerse: onSelectVerse)
        } label: {
            HStack {
                Text(category.label).font(FFTheme.serifMedium(16)).foregroundStyle(FFTheme.ink)
                Spacer()
                Text("\(category.count)").font(.caption).foregroundStyle(FFTheme.muted)
            }
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do { categories = try await APIClient.shared.fetchVerseCategories() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

struct VerseCategoryDetailView: View {
    let category: VerseCategory
    var onSelectVerse: ((BibleVerse) -> Void)? = nil
    @State private var detail: VerseCategoryDetail?
    @State private var isLoading = true
    @State private var errorMessage: String?
    // Same shape as BiblePassageView's own fix for the chevron-sharing bug --
    // a NavigationLink alongside another tappable sibling in one row only
    // ever gets one chevron/tap target for the whole row. There's no second
    // sibling in this row today, but routing "open the full passage" through
    // a plain Button + this shared destination keeps the pattern consistent
    // with every other verse list in the app, and leaves room to add one
    // (a bookmark action, say) later without reintroducing the bug.
    @State private var threadVerse: BibleVerse?

    var body: some View {
        Group {
            if isLoading && detail == nil {
                FFLoadingView(message: "Loading verses…")
            } else if let errorMessage, detail == nil {
                FFErrorStateView(message: errorMessage, onRetry: { Task { await load() } })
            } else if let detail, detail.verses.isEmpty {
                FFEmptyStateView(title: "No verses yet", systemImage: "book.closed",
                                  message: "This theme doesn't have any verses loaded yet.")
            } else if let detail {
                List(detail.verses) { verseRow($0) }
                    .ffListChrome()
            }
        }
        .navigationTitle(category.label)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .navigationDestination(item: $threadVerse) { verse in
            VerseThreadView(reference: verse.reference)
        }
    }

    @ViewBuilder
    private func verseRow(_ verse: BibleVerse) -> some View {
        Button {
            if let onSelectVerse { onSelectVerse(verse) } else { threadVerse = verse }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(verse.reference).font(FFTheme.serifSemibold(15)).foregroundStyle(FFTheme.scripture)
                Text(verse.text).font(FFTheme.serif(15)).foregroundStyle(FFTheme.ink).lineLimit(4)
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .listRowBackground(FFTheme.parchment1)
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do { detail = try await APIClient.shared.fetchVerseCategoryDetail(id: category.id) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

#Preview { NavigationStack { VerseCategoryBrowseView() } }
