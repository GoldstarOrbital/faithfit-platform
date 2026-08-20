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

    init(journeyKey: String, journeyName: String, onEnd: @escaping () -> Void) {
        self.journeyKey = journeyKey
        self.journeyName = journeyName
        self.onEnd = onEnd
        _tracker = StateObject(wrappedValue: JourneyLiveTracker(journeyKey: journeyKey))
    }

    var body: some View {
        VStack(spacing: 24) {
            Text(journeyName).font(.title3.weight(.semibold))

            Text(String(format: "%.2f km", tracker.sessionKm))
                .font(.system(size: 56, weight: .bold, design: .rounded))
                .monospacedDigit()
            Text("this session").font(.caption).foregroundStyle(.secondary)

            Text(elapsedLabel).font(.title2.monospacedDigit()).foregroundStyle(.secondary)

            statusView

            if let progress = tracker.latestProgress {
                VStack(spacing: 4) {
                    ProgressView(value: Double(progress.percent), total: 100).tint(progress.completed ? .green : .orange)
                    Text("\(progress.percent)% of the journey").font(.caption).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 32)
            }

            if !tracker.justCrossed.isEmpty {
                VStack(spacing: 4) {
                    ForEach(tracker.justCrossed) { wp in
                        Label("Reached \(wp.title)", systemImage: "flag.checkered")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(.orange)
                    }
                }
                .transition(.opacity)
            }

            Spacer()

            Button(role: .destructive) {
                Task { await end() }
            } label: {
                if isEnding { ProgressView() } else { Text("End session").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
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
            Label(tracker.sessionKm > 0 ? "Tracking" : "Locating…", systemImage: "location.fill").font(.caption).foregroundStyle(.green)
        case .denied, .restricted:
            Label("Location permission is off -- this session can't record distance", systemImage: "location.slash")
                .font(.caption).foregroundStyle(.red).multilineTextAlignment(.center).padding(.horizontal, 32)
        default:
            Label("Waiting for location permission", systemImage: "location").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var elapsedLabel: String {
        let minutes = Int(elapsed) / 60, seconds = Int(elapsed) % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }

    private func startSession() {
        startedAt = .now
        tracker.start()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            elapsed = Date.now.timeIntervalSince(startedAt ?? .now)
        }
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
