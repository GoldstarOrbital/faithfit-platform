import SwiftUI

/// Compact teaser embedded at the top of the home feed, in the same slot as
/// StoriesRail/TrendingTagsRail -- surfaces scripture on the primary landing
/// screen rather than behind a 6th tab bar item (iOS collapses a tab bar into
/// "More" past 5 items, which would bury the app's namesake feature).
struct ScriptureHomeCard: View {
    @State private var verse: BibleVerse?

    var body: some View {
        NavigationLink { ScriptureView() } label: {
            VStack(alignment: .leading, spacing: 6) {
                Label("Scripture", systemImage: "book.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                if let verse {
                    Text(verse.text)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .lineLimit(3)
                    Text(verse.reference)
                        .font(.caption)
                        .foregroundStyle(.tint)
                } else {
                    Text("Read, search, and save verses")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(.tint.opacity(0.08)))
        }
        .buttonStyle(.plain)
        .task {
            verse = try? await APIClient.shared.fetchRandomVerse()
        }
    }
}

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
                Text(verse.text).font(.body)
                Text(verse.reference).font(.subheadline).foregroundStyle(.secondary)
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
        }
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
