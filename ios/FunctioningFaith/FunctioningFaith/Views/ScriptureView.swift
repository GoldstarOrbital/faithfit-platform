import SwiftUI

struct ScriptureView: View {
    @State private var verse: BibleVerse?
    @State private var isLoadingVerse = true
    @State private var savedReferences: Set<String> = []
    @State private var savedCount = 0
    @State private var errorMessage: String?

    var body: some View {
        Form {
            randomVerseSection
            navigationSection
        }
        .ffListChrome()
        .navigationTitle("Scripture")
        .task {
            await loadVerse()
            await loadSavedCount()
        }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    // Split out of `body` -- a single Form with a conditional verse card plus
    // a row of buttons plus a second section is exactly the shape that has
    // twice already tripped SwiftUI's type-checker elsewhere in this app
    // (StoryComposerView, ProfileView). Splitting each Section into its own
    // computed property avoided it there.
    @ViewBuilder
    private var randomVerseSection: some View {
        Section {
            if isLoadingVerse && verse == nil {
                ProgressView()
            } else if let verse {
                Text(verse.text).font(FFTheme.serif())
                Text(verse.reference).font(.subheadline).foregroundStyle(.secondary)
                NavigationLink {
                    VerseThreadView(reference: verse.reference)
                } label: {
                    Label("Read and discuss", systemImage: "bubble.left.and.bubble.right")
                }
                HStack {
                    Button {
                        Task { await loadVerse() }
                    } label: {
                        Label("Another verse", systemImage: "arrow.clockwise")
                    }
                    Spacer()
                    Button {
                        Task { await toggleSave(verse) }
                    } label: {
                        Label(savedReferences.contains(verse.reference) ? "Saved" : "Save",
                              systemImage: savedReferences.contains(verse.reference) ? "bookmark.fill" : "bookmark")
                    }
                }
            }
        } header: {
            Text("A verse to sit with")
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private var navigationSection: some View {
        Section {
            NavigationLink { BibleBrowseView() } label: {
                Label("Read the Bible", systemImage: "book")
            }
            NavigationLink { SavedVersesView() } label: {
                HStack {
                    Label("Saved verses", systemImage: "bookmark")
                    if savedCount > 0 {
                        Spacer()
                        Text("\(savedCount)").foregroundStyle(.secondary)
                    }
                }
            }
            NavigationLink { ScripturePracticeView() } label: {
                Label("7-day practice", systemImage: "calendar")
            }
            NavigationLink { DiscussedVersesView() } label: {
                Label("Discussions", systemImage: "bubble.left.and.bubble.right")
            }
            NavigationLink { VerseLookupView() } label: {
                Label("Look up any verse", systemImage: "magnifyingglass")
            }
            NavigationLink { BibleVersionPickerView() } label: {
                Label("Bible translation", systemImage: "text.book.closed")
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func loadVerse() async {
        isLoadingVerse = true
        do { verse = try await APIClient.shared.fetchRandomVerse() }
        catch { errorMessage = error.localizedDescription }
        isLoadingVerse = false
    }

    private func loadSavedCount() async {
        guard let verses = try? await APIClient.shared.fetchSavedVerses() else { return }
        savedReferences = Set(verses.map(\.reference))
        savedCount = verses.count
    }

    private func toggleSave(_ verse: BibleVerse) async {
        do {
            let response = try await APIClient.shared.toggleSaveVerse(reference: verse.reference)
            if response.saved {
                savedReferences.insert(response.reference)
                savedCount += 1
            } else {
                savedReferences.remove(response.reference)
                savedCount = max(0, savedCount - 1)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview { NavigationStack { ScriptureView() } }
