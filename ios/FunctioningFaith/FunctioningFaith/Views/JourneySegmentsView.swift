import SwiftUI

/// Read-only leaderboards + ghosts for a route. Ghosts are only ever built
/// from rides that actually happened -- see lib/segments.js's own header --
/// so an empty list here is shown honestly ("nobody has ridden this road
/// yet"), never filled with invented company.
struct JourneySegmentsView: View {
    let journeyKey: String
    @State private var segments: [JourneySegmentBoundary] = []
    @State private var ghosts: JourneyGhostsResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && segments.isEmpty {
                ProgressView()
            } else if segments.isEmpty {
                ContentUnavailableView("No segments yet", systemImage: "flag.checkered",
                                        description: Text("This route doesn't have timed segments."))
            } else {
                List {
                    ghostsSection
                    ForEach(segments) { segment in
                        segmentSection(segment)
                    }
                }
                .ffListChrome()
            }
        }
        .navigationTitle("Segments")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .alert("Could not load segments", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    @ViewBuilder
    private var ghostsSection: some View {
        if let ghosts {
            Section("Riders on this road") {
                if let note = ghosts.note {
                    Text(note).font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(ghosts.ghosts) { ghost in
                        HStack {
                            Text(ghost.isSelf == true ? "You (best)" : ghost.displayName)
                                .font(ghost.isSelf == true ? .subheadline.weight(.semibold) : .subheadline)
                            Spacer()
                            Text(Self.timeLabel(ghost.totalSec)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .listRowBackground(FFTheme.parchment1)
        }
    }

    private func segmentSection(_ segment: JourneySegmentBoundary) -> some View {
        Section {
            HStack {
                Text("\(segment.from) → \(segment.to)").font(.subheadline.weight(.medium))
                Spacer()
                Text(String(format: "%.1f km", segment.toKm - segment.fromKm)).font(.caption2).foregroundStyle(.secondary)
            }
            if let yourBest = segment.yourBestSec {
                Text("Your best: \(Self.timeLabel(yourBest))").font(.caption).foregroundStyle(.tint)
            }
            if segment.leaderboard.isEmpty {
                Text("No times recorded yet.").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(segment.leaderboard) { entry in
                    HStack {
                        Text("\(entry.position). \(entry.displayName)").font(.caption)
                        Spacer()
                        Text(Self.timeLabel(entry.bestSec)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private static func timeLabel(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        let m = total / 60, s = total % 60
        return String(format: "%d:%02d", m, s)
    }

    private func load() async {
        isLoading = true
        do {
            async let segmentsResult = APIClient.shared.fetchJourneySegments(key: journeyKey)
            async let ghostsResult = APIClient.shared.fetchJourneyGhosts(key: journeyKey)
            segments = try await segmentsResult
            ghosts = try await ghostsResult
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

#Preview { NavigationStack { JourneySegmentsView(journeyKey: "preview") } }
