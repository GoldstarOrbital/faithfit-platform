import SwiftUI

/// A transparent comparison screen for a completed activity. It only renders
/// values returned from the member's recorded workout; unavailable sensor or
/// grade data remains visibly unavailable instead of being inferred.
struct WorkoutAnalysisView: View {
    let workoutID: String
    @State private var analysis: WorkoutAnalysis?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let analysis {
                List {
                    Section("Activity intelligence") {
                        metricRow("Relative effort", "\(analysis.relativeEffort) RE")
                        if let pace = analysis.paceMinPerKm {
                            metricRow("Pace", String(format: "%.2f min/km", pace))
                        }
                        if let gap = analysis.gradeAdjustedPaceMinPerKm {
                            metricRow("Grade-adjusted pace", String(format: "%.2f min/km", gap))
                        } else {
                            metricRow("Grade-adjusted pace", "Unavailable")
                        }
                        if let power = analysis.powerWatts {
                            metricRow("Power", "\(Int(power.rounded())) W")
                        }
                        if let speed = analysis.topSpeedKmh {
                            metricRow("Top speed", String(format: "%.1f km/h", speed))
                        }
                        Text(analysis.note).font(.caption2).foregroundStyle(.secondary)
                    }
                    Section("Matched activities") {
                        if analysis.matchedEfforts.isEmpty {
                            Text("No comparable completed activities yet.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(analysis.matchedEfforts) { match in
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(match.startTime.prefix(10))
                                        Text(String(format: "%.2f km", match.distanceKm))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 3) {
                                        Text(time(match.durationSec)).monospacedDigit()
                                        if let pace = match.paceMinPerKm {
                                            Text(String(format: "%.2f min/km", pace))
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .ffListChrome()
                .refreshable { await load() }
            } else if let errorMessage {
                ContentUnavailableView("Activity analysis unavailable", systemImage: "chart.line.uptrend.xyaxis", description: Text(errorMessage))
            } else {
                ProgressView("Loading activity…")
            }
        }
        .navigationTitle("Activity analysis")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func metricRow(_ label: String, _ value: String) -> some View {
        HStack { Text(label); Spacer(); Text(value).foregroundStyle(.secondary).monospacedDigit() }
    }

    private func time(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private func load() async {
        do { analysis = try await APIClient.shared.fetchWorkoutAnalysis(id: workoutID) }
        catch { errorMessage = error.localizedDescription }
    }
}

#Preview { NavigationStack { WorkoutAnalysisView(workoutID: "preview") } }
