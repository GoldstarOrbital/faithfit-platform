import SwiftUI

/// Scripture as conversation, not broadcast: one public thread per verse,
/// replies nested exactly one level (server enforces this -- a reply to a
/// reply attaches to the top-level parent instead).
///
/// Reading comes first: the verse text and the per-verse "explain this"
/// companion are always on screen; the community discussion is real but
/// opt-in, behind a single toggle row, so tapping a verse from anywhere in
/// the app (browse, search, a shared verse, a reel) shows you the verse to
/// read, not a discussion you have to scroll past.
struct VerseThreadView: View {
    let reference: String

    @State private var verse: BibleVerse?
    @State private var thread: VerseThread?
    @State private var reflections: [VerseReflection] = []
    @State private var isLoading = true
    @State private var isSubmitting = false
    @State private var openingPrompt = ""
    @State private var newReflection = ""
    @State private var replyDraftFor: String?
    @State private var replyText = ""
    @State private var errorMessage: String?
    @State private var showSharePicker = false
    @State private var showDiscussion = false

    @State private var askQuestion = ""
    @State private var askHistory: [VerseAskAnswer] = []
    @State private var isAsking = false

    private var totalReflectionCount: Int {
        reflections.reduce(0) { $0 + 1 + $1.replies.count }
    }

    var body: some View {
        Group {
            if isLoading && verse == nil {
                ProgressView()
            } else {
                List {
                    verseSection
                    askSection
                    discussionToggleSection
                    if showDiscussion {
                        if thread != nil {
                            reflectionsSection
                            composeSection
                        } else {
                            startSection
                        }
                    }
                }
                .ffListChrome()
                .listStyle(.plain)
            }
        }
        .navigationTitle(reference)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSharePicker = true } label: { Image(systemName: "paperplane") }
                    .accessibilityLabel("Send this verse to someone")
            }
        }
        .sheet(isPresented: $showSharePicker) { SharePickerSheet(content: .verse(reference: reference)) }
        .task { await load() }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    @ViewBuilder
    private var verseSection: some View {
        if let verse {
            Section {
                Text(verse.text)
                    .font(FFTheme.serif(20))
                    .lineSpacing(5)
                    .padding(.vertical, 4)
                if let translation = verse.translation {
                    Text(translation).font(.caption).foregroundStyle(.secondary)
                }
            }
            .listRowBackground(FFTheme.parchment1)
        }
    }

    // "Explain this verse" -- the per-verse companion, tied to the exact
    // passage on screen (lib/companion.js's askAboutVerse), distinct from
    // Explore's general "Bible Answers" Q&A. Always visible, not gated
    // behind the discussion toggle: reading and asking are the primary
    // actions here, discussing is secondary.
    private var askSection: some View {
        Section {
            TextField("e.g. \"What does this mean for me today?\"", text: $askQuestion, axis: .vertical)
                .lineLimit(1...3)
            Button("Explain this verse") { Task { await askAboutThisVerse() } }
                .buttonStyle(.ffPrimary)
                .disabled(askQuestion.trimmingCharacters(in: .whitespaces).isEmpty || isAsking)
            if isAsking {
                ProgressView().frame(maxWidth: .infinity)
            }
            ForEach(Array(askHistory.enumerated().reversed()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.answer).font(FFTheme.serif(15)).foregroundStyle(FFTheme.ink)
                    ForEach(item.also) { cited in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(cited.reference).font(.caption.weight(.semibold)).foregroundStyle(FFTheme.scripture)
                            Text(cited.text).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text("Explain this verse")
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private var discussionToggleSection: some View {
        Section {
            Button {
                withAnimation { showDiscussion.toggle() }
            } label: {
                HStack {
                    Label(
                        totalReflectionCount == 0 ? "Join the conversation" : "\(totalReflectionCount) reflection\(totalReflectionCount == 1 ? "" : "s")",
                        systemImage: "bubble.left.and.bubble.right"
                    )
                    Spacer()
                    Image(systemName: showDiscussion ? "chevron.up" : "chevron.down").foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            if showDiscussion, let openedByName = thread?.openedByName {
                Text("Conversation started by \(openedByName)").font(.caption).foregroundStyle(.secondary)
            }
            if showDiscussion, let prompt = thread?.prompt, !prompt.isEmpty {
                Text(prompt).font(.subheadline).italic()
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private var startSection: some View {
        Section("Start the conversation") {
            TextField("An opening thought or question (optional)", text: $openingPrompt, axis: .vertical)
                .lineLimit(2...4)
            Button("Open this verse's conversation") {
                Task { await openThread() }
            }
            .buttonStyle(.ffPrimary)
            .disabled(isSubmitting)
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private var reflectionsSection: some View {
        Section("Reflections") {
            if reflections.isEmpty {
                Text("No reflections yet. Be the first.").foregroundStyle(.secondary)
            } else {
                ForEach(reflections) { reflection in
                    reflectionRow(reflection)
                }
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    // Split out of reflectionsSection's ForEach for the same reason other
    // screens in this app split large conditional view bodies out into
    // their own methods -- keeps any one body small enough for SwiftUI's
    // type-checker.
    @ViewBuilder
    private func reflectionRow(_ reflection: VerseReflection) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(reflection.author).font(.subheadline.weight(.semibold))
                    Text(reflection.content).font(.body)
                }
                Spacer()
                Button {
                    Task { await toggleLike(reflection) }
                } label: {
                    Label("\(reflection.likeCount)", systemImage: reflection.likedByMe ? "heart.fill" : "heart")
                }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(reflection.likedByMe ? .pink : .secondary)
            }
            Button(replyDraftFor == reflection.id ? "Cancel" : "Reply") {
                replyDraftFor = (replyDraftFor == reflection.id) ? nil : reflection.id
                replyText = ""
            }
            .font(.caption)
            if replyDraftFor == reflection.id {
                HStack {
                    TextField("Write a reply…", text: $replyText)
                    Button("Send") { Task { await reply(to: reflection) } }
                        .disabled(replyText.trimmingCharacters(in: .whitespaces).isEmpty || isSubmitting)
                }
            }
            ForEach(reflection.replies) { childReply in
                HStack(alignment: .top, spacing: 6) {
                    Text(childReply.author).font(.caption.weight(.semibold))
                    Text(childReply.content).font(.caption)
                }
                .padding(.leading, 16)
            }
        }
        .padding(.vertical, 4)
    }

    private var composeSection: some View {
        Section {
            TextField("Add a reflection…", text: $newReflection, axis: .vertical)
                .lineLimit(2...5)
            Button("Post") {
                Task { await postReflection() }
            }
            .disabled(newReflection.trimmingCharacters(in: .whitespaces).isEmpty || isSubmitting)
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func load() async {
        isLoading = true
        do {
            let response = try await APIClient.shared.fetchVerseThread(reference: reference)
            verse = response.verse
            thread = response.thread
            reflections = response.reflections
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func askAboutThisVerse() async {
        let trimmed = askQuestion.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        isAsking = true
        errorMessage = nil
        do {
            let answer = try await APIClient.shared.askAboutVerse(reference: reference, question: trimmed)
            askHistory.append(answer)
            askQuestion = ""
        } catch {
            errorMessage = error.localizedDescription
        }
        isAsking = false
    }

    private func openThread() async {
        isSubmitting = true
        do {
            let response = try await APIClient.shared.openVerseThread(reference: reference, prompt: openingPrompt.isEmpty ? nil : openingPrompt)
            thread = response.thread
            verse = response.verse
            reflections = []
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }

    private func postReflection() async {
        guard let thread else { return }
        isSubmitting = true
        do {
            let reflection = try await APIClient.shared.addReflection(threadID: thread.id, content: newReflection, parentID: nil)
            reflections.append(reflection)
            newReflection = ""
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }

    private func reply(to parent: VerseReflection) async {
        guard let thread else { return }
        isSubmitting = true
        do {
            let reflection = try await APIClient.shared.addReflection(threadID: thread.id, content: replyText, parentID: parent.id)
            if let index = reflections.firstIndex(where: { $0.id == parent.id }) {
                reflections[index].replies.append(reflection)
            }
            replyText = ""
            replyDraftFor = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }

    private func toggleLike(_ reflection: VerseReflection) async {
        do {
            let response = try await APIClient.shared.toggleReflectionLike(id: reflection.id)
            applyLike(id: reflection.id, response: response)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func applyLike(id: String, response: ReflectionLikeResponse) {
        if let index = reflections.firstIndex(where: { $0.id == id }) {
            reflections[index].likeCount = response.likeCount
            reflections[index].likedByMe = response.liked
            return
        }
        for i in reflections.indices {
            if let j = reflections[i].replies.firstIndex(where: { $0.id == id }) {
                reflections[i].replies[j].likeCount = response.likeCount
                reflections[i].replies[j].likedByMe = response.liked
                return
            }
        }
    }
}

/// Discovery surface for threads that already exist -- reachable without
/// already knowing a specific reference to look up.
struct DiscussedVersesView: View {
    @State private var verses: [DiscussedVerse] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && verses.isEmpty {
                ProgressView()
            } else if verses.isEmpty {
                ContentUnavailableView("No conversations yet", systemImage: "bubble.left.and.bubble.right",
                                        description: Text("Be the first to start one from a verse you're reading."))
            } else {
                List(verses) { verse in
                    NavigationLink {
                        VerseThreadView(reference: verse.reference)
                    } label: {
                        discussedRow(verse)
                    }
                }
                .ffListChrome()
            }
        }
        .navigationTitle("Discussions")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .alert("Could not load discussions", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func discussedRow(_ verse: DiscussedVerse) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verse.reference).font(.headline)
            if let text = verse.text {
                Text(text).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Text("\(verse.reflectionCount) reflection\(verse.reflectionCount == 1 ? "" : "s")")
                .font(.caption2).foregroundStyle(.tint)
        }
        .padding(.vertical, 2)
    }

    private func load() async {
        isLoading = true
        do { verses = try await APIClient.shared.fetchDiscussedVerses() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

#Preview { NavigationStack { VerseThreadView(reference: "Isaiah 40:31") } }
