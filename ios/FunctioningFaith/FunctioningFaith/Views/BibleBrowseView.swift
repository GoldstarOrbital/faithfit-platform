import SwiftUI

/// Book list comes from /api/bible/coverage rather than a hardcoded canon --
/// the server only carries a verified public-domain subset that grows over
/// time, and the server's own comment on that route warns never to hardcode
/// a coverage claim since it drifts. Offering only real books/chapters here
/// means a chapter link can never 404.
struct BibleBrowseView: View {
    @State private var books: [BibleCoverageBook] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && books.isEmpty {
                ProgressView()
            } else if books.isEmpty {
                ContentUnavailableView("No books available", systemImage: "book", description: Text("Scripture text isn't loaded yet."))
            } else {
                List(books) { book in
                    NavigationLink {
                        BibleChapterGridView(book: book)
                    } label: {
                        HStack {
                            Text(book.book)
                            Spacer()
                            Text("\(book.chapters) ch").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .ffListChrome()
            }
        }
        .navigationTitle("Read")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .alert("Could not load books", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        do { books = try await APIClient.shared.fetchBibleCoverage() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

struct BibleChapterGridView: View {
    let book: BibleCoverageBook
    private let columns = [GridItem(.adaptive(minimum: 48), spacing: 10)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(book.minCh...book.maxCh, id: \.self) { chapter in
                    NavigationLink {
                        BiblePassageView(book: book.book, chapter: chapter)
                    } label: {
                        Text("\(chapter)")
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(.tint.opacity(0.12)))
                    }
                }
            }
            .padding()
        }
        .navigationTitle(book.book)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct BiblePassageView: View {
    let book: String
    let chapter: Int
    @State private var highlightVerse: Int?

    @State private var passage: BiblePassage?
    @State private var isLoading = true
    @State private var savedReferences: Set<String> = []
    @State private var errorMessage: String?

    init(book: String, chapter: Int, highlightVerse: Int? = nil) {
        self.book = book
        self.chapter = chapter
        self._highlightVerse = State(initialValue: highlightVerse)
    }

    var body: some View {
        Group {
            if isLoading && passage == nil {
                ProgressView()
            } else if let passage {
                List(passage.verses) { verse in
                    verseRow(verse)
                }
                .ffListChrome()
                .listStyle(.plain)
            }
        }
        .navigationTitle("\(book) \(chapter)")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .alert("Could not load passage", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func verseRow(_ verse: BibleVerse) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("\(verse.verse)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 20, alignment: .trailing)
            Text(verse.text)
                .font(FFTheme.serif())
            Spacer()
            NavigationLink {
                VerseThreadView(reference: verse.reference)
            } label: {
                Image(systemName: "bubble.left")
                    .foregroundStyle(.secondary)
            }
            Button {
                Task { await toggleSave(verse) }
            } label: {
                Image(systemName: savedReferences.contains(verse.reference) ? "bookmark.fill" : "bookmark")
                    .foregroundStyle(.tint)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 3)
        .listRowBackground(verse.verse == highlightVerse ? Color.accentColor.opacity(0.12) : Color.clear)
    }

    private func load() async {
        isLoading = true
        do { passage = try await APIClient.shared.fetchBiblePassage(book: book, chapter: chapter) }
        catch { errorMessage = error.localizedDescription }
        if let saved = try? await APIClient.shared.fetchSavedVerses() {
            savedReferences = Set(saved.map(\.reference))
        }
        isLoading = false
    }

    private func toggleSave(_ verse: BibleVerse) async {
        do {
            let response = try await APIClient.shared.toggleSaveVerse(reference: verse.reference)
            if response.saved { savedReferences.insert(response.reference) }
            else { savedReferences.remove(response.reference) }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview { NavigationStack { BibleBrowseView() } }
