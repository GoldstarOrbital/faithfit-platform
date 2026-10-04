import SwiftUI
import AVFoundation

enum MeditationSoundscape: String, CaseIterable, Identifiable {
    case off, ocean, rain, forest
    var id: String { rawValue }

    var title: String {
        switch self {
        case .off: return "Quiet"
        case .ocean: return "Ocean hush"
        case .rain: return "Gentle rain"
        case .forest: return "Evening forest"
        }
    }

    var systemImage: String {
        switch self {
        case .off: return "speaker.slash"
        case .ocean: return "water.waves"
        case .rain: return "cloud.rain"
        case .forest: return "leaf.fill"
        }
    }
}

/// A lightweight, offline sound bed generated on-device. No stream or
/// tracking request is needed, and `.ambient` respects Silent Mode while
/// mixing gently with audio the member may already be playing.
@MainActor
final class MeditationSoundscapePlayer: ObservableObject {
    @Published private(set) var nowPlaying: MeditationSoundscape = .off
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2)!

    init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    func play(_ soundscape: MeditationSoundscape) {
        stop()
        guard soundscape != .off, let buffer = makeBuffer(for: soundscape) else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.ambient, options: [.mixWithOthers])
            try session.setActive(true)
            player.volume = 0.22
            player.scheduleBuffer(buffer, at: nil, options: .loops)
            try engine.start()
            player.play()
            nowPlaying = soundscape
        } catch {
            stop()
        }
    }

    func stop() {
        player.stop()
        engine.pause()
        nowPlaying = .off
    }

    private func makeBuffer(for soundscape: MeditationSoundscape) -> AVAudioPCMBuffer? {
        let frames = AVAudioFrameCount(format.sampleRate * 6)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
              let channels = buffer.floatChannelData else { return nil }
        buffer.frameLength = frames
        var seed: UInt64 = 0xF41_7A17
        var softenedNoise: Float = 0
        for frame in 0..<Int(frames) {
            seed = 6_364_136_223_846_793_005 &* seed &+ 1
            let rawNoise = Float(seed & 0xffff) / 32_767.5 - 1
            softenedNoise = softenedNoise * 0.92 + rawNoise * 0.08
            let t = Double(frame) / format.sampleRate
            let sample: Float
            switch soundscape {
            case .off:
                sample = 0
            case .ocean:
                let tide = Float(0.45 + 0.35 * sin(2 * .pi * 0.09 * t))
                sample = softenedNoise * tide + Float(sin(2 * .pi * 92 * t)) * 0.08
            case .rain:
                sample = softenedNoise * 0.75 + rawNoise * 0.08
            case .forest:
                let breeze = Float(0.35 + 0.2 * sin(2 * .pi * 0.05 * t))
                let distantTone = Float(sin(2 * .pi * 174 * t) + sin(2 * .pi * 261 * t)) * 0.025
                sample = softenedNoise * breeze + distantTone
            }
            channels[0][frame] = sample
            channels[1][frame] = sample * 0.94
        }
        return buffer
    }
}

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
                List {
                    Section {
                        Text("Slow the body, quiet the mind, and rest your attention on verified Scripture. Each practice includes an optional offline soundscape.")
                            .font(.subheadline)
                            .foregroundStyle(FFTheme.inkSoft)
                    }
                    ForEach(patterns) { pattern in
                        NavigationLink {
                            BreathingSessionView(pattern: pattern)
                        } label: {
                            patternRow(pattern)
                        }
                    }
                }
                .ffListChrome()
            }
        }
        .navigationTitle("Meditation")
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
            if let reference = pattern.scriptureRef {
                Label(reference, systemImage: "book.closed.fill")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(FFTheme.scripture)
            }
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
    @State private var breathScale: CGFloat = 0.58
    @State private var glowOpacity = 0.28
    @State private var soundscape: MeditationSoundscape = .ocean
    @StateObject private var ambientAudio = MeditationSoundscapePlayer()

    private var targetSeconds: Double { Double(pattern.defaultMinutes) * 60 }
    private var currentPhase: BreathingPhase { pattern.phases[phaseIndex % pattern.phases.count] }
    private var isComplete: Bool { totalElapsed >= targetSeconds }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                scriptureBlock
                circleView
                Text(currentPhase.label)
                    .font(FFTheme.display(24, weight: .semibold, relativeTo: .title3))
                    .contentTransition(.numericText())
                ProgressView(value: min(totalElapsed, targetSeconds), total: targetSeconds)
                    .tint(FFTheme.meadow)
                    .padding(.horizontal, 28)
                soundscapePicker
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 18)
        }
        .padding()
        .safeAreaInset(edge: .bottom) {
            controls
                .padding(.horizontal)
                .padding(.top, 8)
                .background(.ultraThinMaterial)
        }
        .navigationTitle(pattern.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadVerse() }
        .onDisappear {
            timer?.invalidate()
            ambientAudio.stop()
        }
        .onChange(of: soundscape) { _, sound in
            if isRunning { ambientAudio.play(sound) }
        }
    }

    private var circleView: some View {
        ZStack {
            Circle()
                .fill(FFTheme.meadow.opacity(0.08))
                .frame(width: 270, height: 270)
            Circle()
                .stroke(FFTheme.goldBright.opacity(glowOpacity), lineWidth: 2)
                .frame(width: 238, height: 238)
                .scaleEffect(breathScale)
            Circle()
                .fill(
                    RadialGradient(
                        colors: [FFTheme.parchment0, FFTheme.goldBright.opacity(0.34), FFTheme.meadow.opacity(0.72)],
                        center: .topLeading,
                        startRadius: 8,
                        endRadius: 110
                    )
                )
                .overlay(Circle().stroke(FFTheme.cream.opacity(0.85), lineWidth: 2))
                .frame(width: 210, height: 210)
                .scaleEffect(breathScale)
                .shadow(color: FFTheme.meadow.opacity(glowOpacity), radius: 28)
            Image(systemName: "cross.fill")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(FFTheme.walnut.opacity(0.72))
                .scaleEffect(breathScale)
        }
        .frame(width: 280, height: 280)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(currentPhase.label)
    }

    @ViewBuilder
    private var scriptureBlock: some View {
        if let verse {
            VStack(spacing: 4) {
                Text(verse.text).font(.subheadline).multilineTextAlignment(.center)
                Text(verse.reference).font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
            .background(FFTheme.scripture.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
        } else if let scriptureText = pattern.scriptureText, let ref = pattern.scriptureRef {
            VStack(spacing: 4) {
                Text(scriptureText).font(.subheadline).multilineTextAlignment(.center)
                Text(ref).font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
            .background(FFTheme.scripture.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private var soundscapePicker: some View {
        Picker("Background sound", selection: $soundscape) {
            ForEach(MeditationSoundscape.allCases) { sound in
                Label(sound.title, systemImage: sound.systemImage).tag(sound)
            }
        }
        .pickerStyle(.menu)
        .padding(.horizontal, 18)
        .frame(minHeight: 44)
        .background(FFTheme.parchment1, in: Capsule())
        .accessibilityHint("Selects an optional soothing sound during this meditation")
    }

    @ViewBuilder
    private var controls: some View {
        if isComplete {
            Label("Session complete", systemImage: "checkmark.circle.fill").foregroundStyle(FFTheme.emerald)
            Button("Done") { Task { await finish() } }
                .buttonStyle(.ffPrimary)
        } else {
            Button(isRunning ? "Pause" : "Start") {
                isRunning ? pause() : start()
            }
            .buttonStyle(.ffPrimary)
            if totalElapsed > 0 {
                Button("Finish now") { Task { await finish() } }
                    .buttonStyle(.ffGhost)
            }
        }
    }

    private func start() {
        isRunning = true
        ambientAudio.play(soundscape)
        animateCurrentPhase()
        scheduleNextPhase()
    }

    private func pause() {
        isRunning = false
        timer?.invalidate()
        timer = nil
        ambientAudio.stop()
    }

    private func scheduleNextPhase() {
        timer?.invalidate()
        let duration = currentPhase.sec
        timer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { _ in
            Task { @MainActor in
                totalElapsed += duration
                phaseIndex += 1
                if totalElapsed < targetSeconds {
                    animateCurrentPhase()
                    scheduleNextPhase()
                } else {
                    isRunning = false
                    ambientAudio.stop()
                }
            }
        }
    }

    private func animateCurrentPhase() {
        let target: CGFloat
        switch currentPhase.kind {
        case "in": target = 1
        case "out": target = 0.58
        default: target = breathScale
        }
        withAnimation(.easeInOut(duration: max(0.5, currentPhase.sec))) {
            breathScale = target
            glowOpacity = currentPhase.kind == "in" ? 0.7 : 0.28
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
