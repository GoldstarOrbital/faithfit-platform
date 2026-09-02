import SwiftUI

/// A transparent comparison screen for a completed activity. It only renders
/// values returned from the member's recorded workout; unavailable sensor or
/// grade data remains visibly unavailable instead of being inferred.
struct WorkoutAnalysisView: View {
    let workoutID: String
    @State private var analysis: WorkoutAnalysis?
    @State private var intelligence: WorkoutIntelligenceSummary?
    @State private var errorMessage: String?
    @State private var isCorrectingGPS = false
    @State private var correctionResult: GPSCorrectionResult?
    @State private var correctionError: String?

    var body: some View {
        Group {
            if let analysis {
                List {
                    if let intelligence {
                        Section("Workout summary") {
                            Text(intelligence.summary)
                            Text(intelligence.nextStep).font(.subheadline).foregroundStyle(.secondary)
                            Text(intelligence.source == "gloo" ? "Personalized from your recorded activity." : "Based on recorded activity metrics.")
                                .font(.caption2).foregroundStyle(.secondary)
                            Text(intelligence.disclaimer).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Section("Activity intelligence") {
                        metricRow("Relative effort", "\(analysis.relativeEffort) RE")
                        if let pace = analysis.paceMinPerKm {
                            metricRow("Pace", "\(Units.paceString(minutesPerKm: pace)) /\(Units.distanceUnitLabel)")
                        }
                        if let gap = analysis.gradeAdjustedPaceMinPerKm {
                            metricRow("Grade-adjusted pace", "\(Units.paceString(minutesPerKm: gap)) /\(Units.distanceUnitLabel)")
                        } else {
                            metricRow("Grade-adjusted pace", "Unavailable")
                        }
                        if let power = analysis.powerWatts {
                            metricRow("Power", "\(Int(power.rounded())) W")
                        }
                        if let speed = analysis.topSpeedKmh {
                            metricRow("Top speed", Units.speedString(kmh: speed))
                        }
                        Text(analysis.note).font(.caption2).foregroundStyle(.secondary)
                    }
                    if analysis.hasRoute {
                        Section("Route") {
                            if let km = analysis.distanceKm {
                                metricRow("Distance", Units.distanceString(km: km))
                            }
                            if let gain = analysis.elevationGainM {
                                metricRow("Elevation gain", Units.elevationString(meters: gain))
                            }
                            if let loss = analysis.elevationLossM {
                                metricRow("Elevation loss", Units.elevationString(meters: loss))
                            }
                            Button {
                                Task { await correctGPS() }
                            } label: {
                                HStack {
                                    if isCorrectingGPS { ProgressView() }
                                    Text(analysis.gpsCorrectedAt == nil ? "Sync & correct with GPS" : "Re-sync & correct with GPS")
                                }
                            }
                            .disabled(isCorrectingGPS)
                            if let correctionResult {
                                Text("Corrected using \(correctionResult.pointsUsed) GPS points (\(correctionResult.pointsDropped) dropped as signal noise).")
                                    .font(.caption2).foregroundStyle(.secondary)
                            } else if analysis.gpsCorrectedAt != nil {
                                Text("Already corrected once. Real terrain elevation replaces device altitude; distance is re-derived after removing implausible GPS jumps.")
                                    .font(.caption2).foregroundStyle(.secondary)
                            } else {
                                Text("Replaces noisy device altitude with real terrain elevation, and drops any GPS points that imply an impossible jump before re-measuring distance. Optional -- your recorded numbers are kept unless you choose this.")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            if let correctionError {
                                Text(correctionError).font(.caption2).foregroundStyle(FFTheme.seal)
                            }
                        }
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
                                        Text(Units.distanceString(km: match.distanceKm))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 3) {
                                        Text(time(match.durationSec)).monospacedDigit()
                                        if let pace = match.paceMinPerKm {
                                            Text("\(Units.paceString(minutesPerKm: pace)) /\(Units.distanceUnitLabel)")
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
                ContentUnavailableView {
                    Label("Activity analysis unavailable", systemImage: "chart.line.uptrend.xyaxis")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Try again") { Task { await load() } }
                        .buttonStyle(.ffPrimary)
                }
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

    private func correctGPS() async {
        isCorrectingGPS = true
        correctionError = nil
        do {
            let result = try await APIClient.shared.correctWorkoutGPS(id: workoutID)
            correctionResult = result
            if var analysis {
                analysis.distanceKm = result.distanceKm
                if let gain = result.elevationGainM { analysis.elevationGainM = gain }
                if let loss = result.elevationLossM { analysis.elevationLossM = loss }
                analysis.gpsCorrectedAt = "now"
                self.analysis = analysis
            }
        } catch {
            correctionError = error.localizedDescription
        }
        isCorrectingGPS = false
    }

    private func load() async {
        errorMessage = nil
        do {
            analysis = try await APIClient.shared.fetchWorkoutAnalysis(id: workoutID)
            intelligence = try? await APIClient.shared.fetchWorkoutIntelligenceSummary(id: workoutID)
        }
        catch { errorMessage = error.localizedDescription }
    }
}

#Preview { NavigationStack { WorkoutAnalysisView(workoutID: "preview") } }
