import SwiftUI

/// Explore's general Bible/faith Q&A -- "what does the Bible say about
/// anxiety?", "who was Nehemiah?" -- distinct from VerseThreadView's
/// per-verse companion, which only ever discusses the one passage open in
/// front of you. Same underlying Gloo companion and the same verified-
/// citation guarantee (lib/companion.js's askBibleQuestion), just not
/// anchored to a specific verse someone is already reading.
///
/// Styled as a real chat: question bubbles, answer bubbles, a compose bar
/// pinned to the bottom, and an ancient, engraved tree of life line drawing
/// standing quietly behind the conversation -- the same "carved into
/// parchment" language the rest of the app's hairlines and walnut chrome
/// already speak, not a licensed emblem, just an old tree branching upward.
struct BibleAnswersView: View {
    private struct OpenVerseReference: Identifiable, Hashable {
        let reference: String
        var id: String { reference }
    }

    @State private var question = ""
    @State private var history: [BibleAnswer] = []
    @State private var pendingQuestion: String?
    @State private var isAsking = false
    @State private var errorMessage: String?
    @State private var openedReference: OpenVerseReference?
    @State private var sharingAnswer: BibleAnswer?
    @FocusState private var inputFocused: Bool

    private let starterPrompts = [
        "What does the Bible say about anxiety?",
        "Who was Nehemiah?",
        "How can I forgive someone who hurt me?",
        "What is the fruit of the Spirit?",
    ]

    var body: some View {
        ZStack {
            FFTheme.parchment0.ignoresSafeArea()
            ScriptureTreeBackdrop().ignoresSafeArea()
            VStack(spacing: 0) {
                if history.isEmpty && pendingQuestion == nil {
                    emptyState
                } else {
                    conversation
                }
                composeBar
            }
        }
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

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: FFTheme.Space.md) {
            Spacer()
            Image(systemName: "text.book.closed.fill")
                .font(.system(size: 36))
                .foregroundStyle(FFTheme.gold)
            Text("Ask about Scripture or the faith")
                .font(FFTheme.display(21))
                .foregroundStyle(FFTheme.ink)
                .multilineTextAlignment(.center)
            Text("Not about one verse in particular -- ask anything. Every reference cited is verified as real before it's shown, never invented.")
                .font(FFTheme.serif(14))
                .foregroundStyle(FFTheme.inkSoft)
                .multilineTextAlignment(.center)
                .padding(.horizontal, FFTheme.Space.lg)
            VStack(spacing: FFTheme.Space.xs) {
                ForEach(starterPrompts, id: \.self) { prompt in
                    Button {
                        question = prompt
                        Task { await ask() }
                    } label: {
                        HStack {
                            Text(prompt).font(FFTheme.serif(14)).foregroundStyle(FFTheme.ink)
                            Spacer(minLength: 8)
                            Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(FFTheme.muted)
                        }
                        .padding(.horizontal, FFTheme.Space.md)
                        .padding(.vertical, FFTheme.Space.sm)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous).strokeBorder(FFTheme.hairline, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, FFTheme.Space.lg)
            .padding(.top, FFTheme.Space.sm)
            Spacer()
            Spacer()
        }
    }

    // MARK: - Conversation

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: FFTheme.Space.lg) {
                    ForEach(history) { item in
                        chatExchange(item).id(item.id)
                    }
                    if let pendingQuestion {
                        pendingExchange(pendingQuestion).id("pending")
                    }
                }
                .padding(FFTheme.Space.md)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: history.count) { _, _ in
                guard let lastID = history.last?.id else { return }
                withAnimation { proxy.scrollTo(lastID, anchor: .bottom) }
            }
            .onChange(of: pendingQuestion) { _, value in
                guard value != nil else { return }
                withAnimation { proxy.scrollTo("pending", anchor: .bottom) }
            }
        }
    }

    private func questionBubble(_ text: String) -> some View {
        HStack {
            Spacer(minLength: 40)
            Text(text)
                .font(FFTheme.serifMedium(15))
                .foregroundStyle(FFTheme.cream)
                .padding(.horizontal, FFTheme.Space.md)
                .padding(.vertical, FFTheme.Space.sm)
                .background(FFTheme.meadowDeep, in: RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous))
        }
    }

    private func chatExchange(_ item: BibleAnswer) -> some View {
        VStack(alignment: .leading, spacing: FFTheme.Space.sm) {
            questionBubble(item.question)
            HStack {
                answerCard {
                    Text(item.answer).font(FFTheme.serif(15)).foregroundStyle(FFTheme.ink)
                    if !item.also.isEmpty {
                        citedVerseRow(item.also)
                    }
                    Button { sharingAnswer = item } label: {
                        Label("Share", systemImage: "paperplane")
                    }
                    .font(.caption)
                    .foregroundStyle(FFTheme.inkSoft)
                }
                Spacer(minLength: 20)
            }
        }
    }

    private func pendingExchange(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: FFTheme.Space.sm) {
            questionBubble(text)
            HStack {
                answerCard {
                    HStack(spacing: FFTheme.Space.xs) {
                        ProgressView()
                        Text("Searching Scripture…").font(FFTheme.serif(14)).foregroundStyle(FFTheme.inkSoft)
                    }
                }
                Spacer(minLength: 20)
            }
        }
    }

    @ViewBuilder
    private func answerCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: FFTheme.Space.sm) {
            content()
        }
        .padding(FFTheme.Space.md)
        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous).strokeBorder(FFTheme.hairline, lineWidth: 1))
        .shadow(color: FFTheme.walnut.opacity(0.08), radius: 6, x: 0, y: 2)
    }

    private func citedVerseRow(_ verses: [AlsoCitedVerse]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: FFTheme.Space.xs) {
                ForEach(verses) { cited in
                    Button {
                        openedReference = OpenVerseReference(reference: cited.reference)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(cited.reference).font(.caption.weight(.semibold)).foregroundStyle(FFTheme.scripture)
                            Text(cited.text).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                        }
                        .padding(FFTheme.Space.xs)
                        .frame(width: 160, alignment: .leading)
                        .background(FFTheme.parchment0, in: RoundedRectangle(cornerRadius: FFTheme.Radius.sm, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: FFTheme.Radius.sm, style: .continuous).strokeBorder(FFTheme.hairline, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Compose bar

    private var composeBar: some View {
        HStack(spacing: FFTheme.Space.sm) {
            TextField("Ask about Scripture or the faith…", text: $question, axis: .vertical)
                .lineLimit(1...4)
                .font(FFTheme.serif(15))
                .focused($inputFocused)
                .padding(.horizontal, FFTheme.Space.md)
                .padding(.vertical, FFTheme.Space.sm)
                .background(FFTheme.parchment2, in: Capsule())
                .overlay(Capsule().strokeBorder(FFTheme.hairline, lineWidth: 1))
            Button {
                Task { await ask() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(FFTheme.cream)
                    .frame(width: 36, height: 36)
                    .background(FFTheme.meadow, in: Circle())
            }
            .disabled(question.trimmingCharacters(in: .whitespaces).isEmpty || isAsking)
            .accessibilityLabel("Ask")
        }
        .padding(.horizontal, FFTheme.Space.sm)
        .padding(.vertical, FFTheme.Space.xs)
        .background(.ultraThinMaterial)
    }

    private func ask() async {
        let trimmed = question.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !isAsking else { return }
        question = ""
        pendingQuestion = trimmed
        isAsking = true
        errorMessage = nil
        do {
            let answer = try await APIClient.shared.askBibleQuestion(trimmed)
            history.append(answer)
        } catch {
            errorMessage = error.localizedDescription
            question = trimmed
        }
        pendingQuestion = nil
        isAsking = false
    }
}

// MARK: - Tree of life backdrop

/// A quiet, engraved-looking tree standing behind the conversation --
/// procedurally branched line art in the same hairline/gold language as
/// the rest of the app's parchment chrome, not a reproduction of any
/// particular illustration. Evokes Scripture's own tree of life (Genesis
/// 2:9, Revelation 22:2) rather than any one artist's rendering of it.
private struct ScriptureTreeBackdrop: View {
    var body: some View {
        GeometryReader { geo in
            ZStack {
                BranchingTreeMark()
                    .stroke(FFTheme.gold.opacity(0.16), lineWidth: 1.4)
                BranchingTreeMark(seed: 7)
                    .stroke(FFTheme.forest.opacity(0.07), lineWidth: 1)
            }
            .frame(width: geo.size.width * 0.86, height: geo.size.height * 0.62)
            .position(x: geo.size.width * 0.5, y: geo.size.height * 0.34)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Procedurally forks a trunk into a handful of branch generations using
/// simple deterministic pseudo-randomness (seeded, not `Double.random`, so
/// the drawing is stable across re-renders rather than reshuffling itself
/// every time SwiftUI recomputes the view).
private struct BranchingTreeMark: Shape {
    var seed: Int = 1

    func path(in rect: CGRect) -> Path {
        var path = Path()
        var rngState: UInt64 = UInt64(seed) &* 2_654_435_761 &+ 0x9E3779B9
        func next() -> Double {
            rngState = rngState &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Double((rngState >> 33) & 0xFFFF_FFFF) / Double(0xFFFF_FFFF)
        }

        let baseX = rect.midX
        let baseY = rect.maxY
        let trunkTop = CGPoint(x: baseX, y: baseY - rect.height * 0.34)
        path.move(to: CGPoint(x: baseX, y: baseY))
        path.addLine(to: trunkTop)

        func branch(from point: CGPoint, angle: Double, length: CGFloat, depth: Int) {
            guard depth > 0, length > 3 else { return }
            let jitter = (next() - 0.5) * 0.18
            let end = CGPoint(
                x: point.x + CGFloat(cos(angle + jitter)) * length,
                y: point.y - CGFloat(sin(angle + jitter)) * length
            )
            let control = CGPoint(
                x: point.x + CGFloat(cos(angle)) * length * 0.55,
                y: point.y - CGFloat(sin(angle)) * length * 0.55 - length * 0.12
            )
            path.move(to: point)
            path.addQuadCurve(to: end, control: control)

            let spread = 0.42 + next() * 0.22
            branch(from: end, angle: angle - spread, length: length * (0.68 + next() * 0.08), depth: depth - 1)
            branch(from: end, angle: angle + spread, length: length * (0.68 + next() * 0.08), depth: depth - 1)
        }

        branch(from: trunkTop, angle: .pi / 2 - 0.5, length: rect.height * 0.24, depth: 5)
        branch(from: trunkTop, angle: .pi / 2, length: rect.height * 0.27, depth: 5)
        branch(from: trunkTop, angle: .pi / 2 + 0.5, length: rect.height * 0.24, depth: 5)

        return path
    }
}

#Preview { NavigationStack { BibleAnswersView() } }
