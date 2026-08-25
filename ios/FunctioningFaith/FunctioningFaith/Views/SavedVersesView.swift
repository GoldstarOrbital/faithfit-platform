import SwiftUI

struct SavedVersesView: View {
    @State private var verses: [SavedVerse] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && verses.isEmpty {
                ProgressView()
            } else if verses.isEmpty {
                ContentUnavailableView("No saved verses", systemImage: "bookmark", description: Text("Verses you save while reading or searching show up here."))
            } else {
                List {
                    ForEach(verses) { verse in
                        NavigationLink {
                            VerseThreadView(reference: verse.reference)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(verse.text).font(FFTheme.serif())
                                Text(verse.reference).font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                    .onDelete(perform: remove)
                }
                .ffListChrome()
                .listStyle(.plain)
            }
        }
        .navigationTitle("Saved verses")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .alert("Could not load saved verses", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        do { verses = try await APIClient.shared.fetchSavedVerses() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func remove(at offsets: IndexSet) {
        let toRemove = offsets.map { verses[$0] }
        verses.remove(atOffsets: offsets)
        Task {
            for verse in toRemove {
                try? await APIClient.shared.toggleSaveVerse(reference: verse.reference)
            }
        }
    }
}

#Preview { NavigationStack { SavedVersesView() } }
