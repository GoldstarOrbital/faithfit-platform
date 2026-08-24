import SwiftUI

/// The web app renders this as a real-time 3D flythrough; this is the same
/// underlying mechanic (real GPS distance, streamed to the server in small
/// increments, unlocking waypoints as you cross them) without that
/// visualization layer -- see the header comment on the Journeys models for
/// why that's a deliberate scope decision, not an oversight.
struct JourneyLiveSessionView: View {
    let journeyKey: String
    let journeyName: String
    let onEnd: () -> Void

    @StateObject private var tracker: JourneyLiveTracker
    @State private var elapsed: TimeInterval = 0
    @State private var timer: Timer?
    @State private var startedAt: Date?
    @State private var isEnding = false
    @State private var segments: [JourneySegmentBoundary] = []
    @State private var recordedWaypointIDs: Set<String> = []
    @State private var lastBoundaryAt: Date?
    @State private var lastSegmentResult: SegmentCompletionResult?
    @State private var ghosts: [JourneyGhost] = []
    @State private var liveHeartRate: Double?
    @State private var lastHeartRateCheck: Date?

    init(journeyKey: String, journeyName: String, onEnd: @escaping () -> Void) {
        self.journeyKey = journeyKey
        self.journeyName = journeyName
        self.onEnd = onEnd
        _tracker = StateObject(wrappedValue: JourneyLiveTracker(journeyKey: journeyKey))
    }

    var body: some View {
        VStack(spacing: 24) {
            Text(journeyName).font(FFTheme.display(20, weight: .semibold, relativeTo: .title3))

            Text(String(format: "%.2f km", tracker.sessionKm))
                .font(.system(size: 56, weight: .bold, design: .rounded))
                .monospacedDigit()
            Text("this session").font(.caption).foregroundStyle(.secondary)

            Text(elapsedLabel).font(.title2.monospacedDigit()).foregroundStyle(.secondary)

            liveEffortCard

            statusView

            if let progress = tracker.latestProgress {
                VStack(spacing: 4) {
                    ProgressView(value: Double(progress.percent), total: 100).tint(progress.completed ? FFTheme.emerald : FFTheme.hearth)
                    Text("\(progress.percent)% of the journey").font(.caption).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 32)
            }

            if let error = tracker.lastError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(FFTheme.seal)
                    .multilineTextAlignment(.center).padding(.horizontal, 28)
            }

            if !tracker.justCrossed.isEmpty {
                VStack(spacing: 4) {
                    ForEach(tracker.justCrossed) { wp in
                        Label("Reached \(wp.title)", systemImage: "flag.pattern.checkered")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(FFTheme.hearth)
                    }
                }
                .transition(.opacity)
            }

            if let result = lastSegmentResult {
                Label(result.personalBest ? "Personal best segment! \(Self.timeLabel(result.durationSec))" : "Segment: \(Self.timeLabel(result.durationSec)) · #\(result.rank) on this road",
                      systemImage: result.personalBest ? "star.fill" : "stopwatch")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(result.personalBest ? FFTheme.goldBright : .secondary)
            }

            Spacer()

            Button(role: .destructive) {
                Task { await end() }
            } label: {
                if isEnding { ProgressView() } else { Text("End session").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.ffDestructive)
            .disabled(isEnding)
            .padding(.horizontal, 32)
        }
        .padding(.top, 60)
        .padding(.bottom, 40)
        .onAppear { startSession() }
        .onDisappear { timer?.invalidate() }
    }

    @ViewBuilder
    private var statusView: some View {
        switch tracker.authorization {
        case .authorizedAlways, .authorizedWhenInUse:
            Label(tracker.sessionKm > 0 ? "Tracking" : "Locating…", systemImage: "location.fill").font(.caption).foregroundStyle(FFTheme.emerald)
        case .denied, .restricted:
            Label("Location permission is off -- this session can't record distance", systemImage: "location.slash")
                .font(.caption).foregroundStyle(FFTheme.seal).multilineTextAlignment(.center).padding(.horizontal, 32)
        default:
            Label("Waiting for location permission", systemImage: "location").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var elapsedLabel: String {
        let minutes = Int(elapsed) / 60, seconds = Int(elapsed) % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }

    @ViewBuilder
    private var liveEffortCard: some View {
        VStack(alignment: .leading, spacing: FFTheme.Space.xs) {
            Text("Live effort").font(FFTheme.section())
            HStack(spacing: FFTheme.Space.lg) {
                Label(speedLabel, systemImage: "speedometer")
                if let liveHeartRate {
                    Label("\(Int(liveHeartRate.rounded())) bpm", systemImage: "heart.fill")
                        .foregroundStyle(FFTheme.seal)
                } else {
                    Label("Heart rate unavailable", systemImage: "heart.slash")
                        .foregroundStyle(.secondary)
                }
            }
            .font(.subheadline.weight(.semibold))
            if let comparisonLabel {
                Label(comparisonLabel.text, systemImage: comparisonLabel.systemImage)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(comparisonLabel.isAhead ? FFTheme.emerald : FFTheme.hearth)
            } else {
                Text("Complete this route once to compare live effort against your own recorded best.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(FFTheme.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Live effort. \(speedLabel). \(liveHeartRate.map { "\(Int($0.rounded())) beats per minute" } ?? "Heart rate unavailable"). \(comparisonLabel?.text ?? "No previous route comparison")")
    }

    private var speedLabel: String {
        guard let speed = tracker.currentSpeedKmh else { return "Pace locating…" }
        return String(format: "%.1f km/h", speed)
    }

    private var comparisonLabel: (text: String, systemImage: String, isAhead: Bool)? {
        guard let ghost = ghosts.first(where: { $0.isSelf == true }),
              let progress = tracker.latestProgress,
              progress.percent > 0 else { return nil }
        let targetSeconds = ghost.totalSec * Double(progress.percent) / 100
        let delta = elapsed - targetSeconds
        let seconds = Int(abs(delta).rounded())
        let time = String(format: "%d:%02d", seconds / 60, seconds % 60)
        return delta <= 0
            ? ("\(time) ahead of your recorded route", "arrow.up.right", true)
            : ("\(time) behind your recorded route", "arrow.down.right", false)
    }

    private func startSession() {
        startedAt = .now
        lastBoundaryAt = .now
        tracker.start()
        Task {
            async let segmentLoad = APIClient.shared.fetchJourneySegments(key: journeyKey)
            async let ghostLoad = APIClient.shared.fetchJourneyGhosts(key: journeyKey)
            do {
                let (loadedSegments, loadedGhosts) = try await (segmentLoad, ghostLoad)
                guard !Task.isCancelled else { return }
                segments = loadedSegments
                ghosts = loadedGhosts.ghosts
            } catch {
                guard !Task.isCancelled else { return }
                tracker.setPresentationError("Live route comparison is temporarily unavailable. GPS progress will keep recording.")
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            elapsed = Date.now.timeIntervalSince(startedAt ?? .now)
            checkForCompletedSegments()
            refreshHeartRateIfNeeded()
        }
    }

    private func refreshHeartRateIfNeeded() {
        guard lastHeartRateCheck == nil || Date.now.timeIntervalSince(lastHeartRateCheck!) >= 30 else { return }
        lastHeartRateCheck = .now
        Task {
            guard let samples = try? await HealthKitManager.shared.recentHeartRateSamples(limit: 1),
                  let latest = samples.last,
                  !Task.isCancelled else { return }
            liveHeartRate = latest
        }
    }

    /// tracker.justCrossed is sticky (stays populated until the next flush
    /// that crosses something new -- see JourneyLiveTracker's own comment),
    /// so recordedWaypointIDs guards against recording the same segment
    /// twice while it's still showing.
    private func checkForCompletedSegments() {
        for wp in tracker.justCrossed where !recordedWaypointIDs.contains(wp.id) {
            recordedWaypointIDs.insert(wp.id)
            guard let segment = segments.first(where: { abs($0.toKm - wp.kmMark) < 0.01 }) else { continue }
            let start = lastBoundaryAt ?? startedAt ?? .now
            let duration = Date.now.timeIntervalSince(start)
            lastBoundaryAt = .now
            Task {
                lastSegmentResult = try? await APIClient.shared.completeJourneySegment(
                    key: journeyKey, index: segment.index, durationSec: duration, measured: true)
            }
        }
    }

    private static func timeLabel(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private func end() async {
        isEnding = true
        timer?.invalidate()
        await tracker.flushNow()
        tracker.stop()
        isEnding = false
        onEnd()
    }
}

#Preview { JourneyLiveSessionView(journeyKey: "preview", journeyName: "Preview Journey") { } }
