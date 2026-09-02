import SwiftUI

/// Explore's general Bible/faith Q&A -- "what does the Bible say about
/// anxiety?", "who was Nehemiah?" -- distinct from VerseThreadView's
/// per-verse companion, which only ever discusses the one passage open in
/// front of you. Same underlying Gloo companion and the same verified-
/// citation guarantee (lib/companion.js's askBibleQuestion), just not
/// anchored to a specific verse someone is already reading.
struct BibleAnswersView: View {
    private struct OpenVerseReference: Identifiable, Hashable {
        let reference: String
        var id: String { reference }
    }

    @State private var question = ""
    @State private var history: [BibleAnswer] = []
    @State private var isAsking = false
    @State private var errorMessage: String?
    @State private var openedReference: OpenVerseReference?
    @State private var sharingAnswer: BibleAnswer?

    var body: some View {
        Form {
            Section {
                TextField("e.g. \"What does the Bible say about anxiety?\"", text: $question, axis: .vertical)
                    .lineLimit(1...4)
                Button("Ask") { Task { await ask() } }
                    .buttonStyle(.ffPrimary)
                    .disabled(question.trimmingCharacters(in: .whitespaces).isEmpty || isAsking)
            } header: {
                Text("Ask a Bible question")
            } footer: {
                Text("Not about one verse in particular -- ask anything about Scripture or the faith. Any reference cited is verified as real before it's shown, never invented.")
            }
            .listRowBackground(FFTheme.parchment1)

            if isAsking {
                Section { ProgressView().frame(maxWidth: .infinity) }
                    .listRowBackground(Color.clear)
            }

            if history.isEmpty && !isAsking {
                Section {
                    Text("Your answers will appear here.").font(.caption).foregroundStyle(.secondary)
                }
                .listRowBackground(Color.clear)
            } else {
                ForEach(Array(history.enumerated().reversed()), id: \.offset) { _, item in
                    answerSection(item)
                }
            }
        }
        .ffListChrome()
        .navigationTitle("Bible Answers")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $openedReference) { ref in VerseThreadView(reference: ref.reference) }
        .sheet(item: $sharingAnswer) { answer in
            SharePickerSheet(content: .bibleAnswer(question: answer.question, answer: answer.answer))
        }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func answerSection(_ item: BibleAnswer) -> some View {
        Section(item.question) {
            Text(item.answer).font(FFTheme.serif(15)).foregroundStyle(FFTheme.ink)
            ForEach(item.also) { cited in
                Button { openedReference = OpenVerseReference(reference: cited.reference) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cited.reference).font(.caption.weight(.semibold)).foregroundStyle(FFTheme.scripture)
                        Text(cited.text).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                .buttonStyle(.plain)
            }
            Button { sharingAnswer = item } label: {
                Label("Share", systemImage: "paperplane")
            }
            .font(.caption)
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func ask() async {
        let trimmed = question.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        isAsking = true
        errorMessage = nil
        do {
            let answer = try await APIClient.shared.askBibleQuestion(trimmed)
            history.append(answer)
            question = ""
        } catch {
            errorMessage = error.localizedDescription
        }
        isAsking = false
    }
}

#Preview { NavigationStack { BibleAnswersView() } }
