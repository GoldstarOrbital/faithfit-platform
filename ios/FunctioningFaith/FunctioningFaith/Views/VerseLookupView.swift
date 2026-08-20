import SwiftUI

/// Reference-based lookup across the whole canon, not just the local
/// 22-book library -- complements the existing keyword search, which is
/// local-only. Real text or nothing: a reference nobody can resolve comes
/// back as an honest "could not look that up," never a guess.
struct VerseLookupView: View {
    @State private var reference = ""
    @State private var result: ResolvedPassage?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var savedReferences: Set<String> = []

    var body: some View {
        Form {
            Section {
                TextField("e.g. \"Obadiah 1:3\" or \"John 3\"", text: $reference)
                    .autocorrectionDisabled()
                Button("Look up") { Task { await lookup() } }
                    .disabled(reference.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
            } header: {
                Text("Any reference, not just the local library")
            } footer: {
                Text("The local library covers 22 books. This looks up anything else through YouVersion, in your preferred translation.")
            }
            if isLoading {
                Section { ProgressView() }
            } else if let result {
                resultSection(result)
            }
        }
        .navigationTitle("Look Up a Verse")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Could not look that up", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func resultSection(_ result: ResolvedPassage) -> some View {
        Section {
            Text(result.text).font(.body)
            HStack {
                Text(result.reference).font(.caption).foregroundStyle(.secondary)
                Spacer()
                if let translation = result.translation {
                    Text(translation).font(.caption2).foregroundStyle(.tint)
                }
            }
            Button {
                Task { await toggleSave(result) }
            } label: {
                Label(savedReferences.contains(result.reference) ? "Saved" : "Save",
                      systemImage: savedReferences.contains(result.reference) ? "bookmark.fill" : "bookmark")
            }
        }
    }

    private func lookup() async {
        isLoading = true
        do {
            result = try await APIClient.shared.lookupVerse(reference: reference.trimmingCharacters(in: .whitespaces))
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func toggleSave(_ result: ResolvedPassage) async {
        do {
            let response = try await APIClient.shared.toggleSaveVerse(reference: result.reference)
            if response.saved { savedReferences.insert(response.reference) }
            else { savedReferences.remove(response.reference) }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct BibleVersionPickerView: View {
    @EnvironmentObject private var session: NativeSession
    @State private var response: BibleVersionsResponse?
    @State private var selected: Int?
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let response {
                if !response.configured || response.versions.isEmpty {
                    ContentUnavailableView("Not available yet", systemImage: "text.book.closed",
                                            description: Text("Translation choice isn't configured on the server yet. Scripture still reads from the verified local library."))
                } else {
                    versionList(response)
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Bible Translation")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            selected = session.profile?.bibleVersionID
            response = try? await APIClient.shared.fetchBibleVersions()
        }
        .alert("Could not save", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func versionList(_ response: BibleVersionsResponse) -> some View {
        List {
            Section {
                versionRow(title: "Local library (default)", isSelected: selected == nil) {
                    Task { await select(nil) }
                }
            }
            Section("Translations") {
                ForEach(response.versions) { version in
                    versionRow(title: version.title ?? version.abbreviation ?? "Version \(version.id)", isSelected: selected == version.id) {
                        Task { await select(version.id) }
                    }
                }
            }
        }
    }

    private func versionRow(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title).foregroundStyle(.primary)
                Spacer()
                if isSelected { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
        }
        .disabled(isSaving)
    }

    private func select(_ versionID: Int?) async {
        isSaving = true
        do {
            try await APIClient.shared.setPreferredBibleVersion(versionID)
            selected = versionID
            session.profile = try? await APIClient.shared.fetchProfile()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }
}

#Preview { NavigationStack { VerseLookupView() } }
