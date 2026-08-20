import SwiftUI

struct BreathworkView: View {
    @State private var patterns: [BreathingPattern] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && patterns.isEmpty {
                ProgressView()
            } else if patterns.isEmpty {
                ContentUnavailableView("No patterns available", systemImage: "wind", description: Text("Check back soon."))
            } else {
                List(patterns) { pattern in
                    NavigationLink {
                        BreathingSessionView(pattern: pattern)
                    } label: {
                        patternRow(pattern)
                    }
                }
            }
        }
        .navigationTitle("Breathe")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .alert("Could not load breathing patterns", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func patternRow(_ pattern: BreathingPattern) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(pattern.name).font(.headline)
            Text(pattern.tagline).font(.caption).foregroundStyle(.secondary)
            Text("\(pattern.breathsPerMin, specifier: "%.1f") breaths/min · \(pattern.defaultMinutes) min")
                .font(.caption2).foregroundStyle(.tint)
        }
        .padding(.vertical, 3)
    }

    private func load() async {
        isLoading = true
        do { patterns = try await APIClient.shared.fetchBreathingPatterns() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

/// A single guided session: an animated circle that grows on 'in', holds,
/// and shrinks on 'out', driven phase-by-phase by the pattern's own timing
/// (not a fixed generic animation) -- matches lib/breathwork.js's `kind`
/// field exactly. One Timer per phase transition rather than a fast
/// repeating tick: simpler to reason about correctness for, and the
/// crossfade animation duration is set to match each phase's real length.
struct BreathingSessionView: View {
    let pattern: BreathingPattern
    @Environment(\.dismiss) private var dismiss
    @State private var phaseIndex = 0
    @State private var isRunning = false
    @State private var totalElapsed: Double = 0
    @State private var timer: Timer?
    @State private var verse: BreathingVerseResult?

    private var targetSeconds: Double { Double(pattern.defaultMinutes) * 60 }
    private var currentPhase: BreathingPhase { pattern.phases[phaseIndex % pattern.phases.count] }
    private var isComplete: Bool { totalElapsed >= targetSeconds }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            circleView
            Text(currentPhase.label).font(.title3.weight(.medium))
            scriptureBlock
            Spacer()
            controls
        }
        .padding()
        .navigationTitle(pattern.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadVerse() }
        .onDisappear { timer?.invalidate() }
    }

    private var circleView: some View {
        Circle()
            .fill(.tint.opacity(0.15))
            .overlay(Circle().stroke(.tint, lineWidth: 3))
            .frame(width: circleSize, height: circleSize)
            .animation(.easeInOut(duration: currentPhase.sec), value: phaseIndex)
    }

    private var circleSize: CGFloat {
        switch currentPhase.kind {
        case "in": return 200
        case "out": return 110
        default: return 160 // hold, wherever it landed
        }
    }

    @ViewBuilder
    private var scriptureBlock: some View {
        if let verse {
            VStack(spacing: 4) {
                Text(verse.text).font(.subheadline).multilineTextAlignment(.center)
                Text(verse.reference).font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal)
        } else if let scriptureText = pattern.scriptureText, let ref = pattern.scriptureRef {
            VStack(spacing: 4) {
                Text(scriptureText).font(.subheadline).multilineTextAlignment(.center)
                Text(ref).font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal)
        }
    }

    @ViewBuilder
    private var controls: some View {
        if isComplete {
            Label("Session complete", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            Button("Done") { Task { await finish() } }
                .buttonStyle(.borderedProminent)
        } else {
            Button(isRunning ? "Pause" : "Start") {
                isRunning ? pause() : start()
            }
            .buttonStyle(.borderedProminent)
            if totalElapsed > 0 {
                Button("Finish now") { Task { await finish() } }
                    .buttonStyle(.bordered)
            }
        }
    }

    private func start() {
        isRunning = true
        scheduleNextPhase()
    }

    private func pause() {
        isRunning = false
        timer?.invalidate()
        timer = nil
    }

    private func scheduleNextPhase() {
        timer?.invalidate()
        let duration = currentPhase.sec
        timer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { _ in
            Task { @MainActor in
                totalElapsed += duration
                phaseIndex += 1
                if totalElapsed < targetSeconds {
                    scheduleNextPhase()
                } else {
                    isRunning = false
                }
            }
        }
    }

    private func loadVerse() async {
        verse = try? await APIClient.shared.fetchBreathingVerse(key: pattern.key)
    }

    private func finish() async {
        pause()
        try? await APIClient.shared.completeBreathingSession(pattern: pattern.key, durationSec: Int(totalElapsed))
        dismiss()
    }
}

/// Bridges a bare pattern key (from a heart check-in's suggestion, which
/// only carries key/name/tagline/minutes) to the full BreathingPattern a
/// session needs -- there's no single-pattern-by-key endpoint, so this
/// fetches the catalogue once and picks the match.
struct BreathingPatternLoader: View {
    let key: String
    @State private var pattern: BreathingPattern?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let pattern {
                BreathingSessionView(pattern: pattern)
            } else if let errorMessage {
                ContentUnavailableView(errorMessage, systemImage: "wind")
            } else {
                ProgressView().task { await load() }
            }
        }
    }

    private func load() async {
        do {
            let patterns = try await APIClient.shared.fetchBreathingPatterns()
            if let match = patterns.first(where: { $0.key == key }) {
                pattern = match
            } else {
                errorMessage = "That breathing pattern isn't available right now."
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview { NavigationStack { BreathworkView() } }
