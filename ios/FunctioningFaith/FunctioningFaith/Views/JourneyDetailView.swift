import SwiftUI

struct JourneyDetailView: View {
    let journeyKey: String
    @State private var detail: JourneyDetail?
    @State private var isLoading = true
    @State private var isChangingMembership = false
    @State private var errorMessage: String?
    @State private var showLiveSession = false

    var body: some View {
        Group {
            if isLoading && detail == nil {
                ProgressView()
            } else if let detail {
                List {
                    Section {
                        if let subtitle = detail.journey.subtitle { Text(subtitle).font(.callout) }
                        if let description = detail.journey.description { Text(description).font(.caption).foregroundStyle(.secondary) }
                        HStack {
                            if let terrain = detail.journey.terrain { Label(terrain, systemImage: "mountain.2") }
                            Spacer()
                            Text("\(String(format: "%.0f", detail.journey.totalKm)) km total")
                        }
                        .font(.caption).foregroundStyle(.secondary)
                        if let ref = detail.journey.scriptureRef {
                            Text(ref).font(.caption.weight(.semibold)).foregroundStyle(.indigo)
                        }
                    }

                    Section {
                        if detail.joined {
                            ProgressView(value: Double(detail.percent), total: 100)
                                .tint(detail.completed ? .green : .orange)
                            HStack {
                                Text("\(String(format: "%.1f", detail.progressKm)) / \(String(format: "%.0f", detail.journey.totalKm)) km")
                                Spacer()
                                Text("\(detail.percent)%")
                            }
                            .font(.caption).foregroundStyle(.secondary)
                            if detail.completed {
                                Label("Journey complete", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                            } else {
                                Button("Start live session") { showLiveSession = true }
                                    .buttonStyle(.borderedProminent)
                                Button("Leave journey", role: .destructive) { Task { await leave() } }
                                    .disabled(isChangingMembership)
                            }
                        } else {
                            Button("Join this journey") { Task { await join() } }
                                .buttonStyle(.borderedProminent)
                                .disabled(isChangingMembership)
                        }
                    }

                    Section {
                        NavigationLink { JourneySegmentsView(journeyKey: journeyKey) } label: {
                            Label("Segments & leaderboards", systemImage: "flag.checkered")
                        }
                    }

                    Section("Waypoints") {
                        ForEach(detail.waypoints) { wp in
                            WaypointRow(waypoint: wp)
                        }
                    }
                }
                .refreshable { await load() }
            }
        }
        .navigationTitle(detail?.journey.name ?? "Journey")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .fullScreenCover(isPresented: $showLiveSession) {
            JourneyLiveSessionView(journeyKey: journeyKey, journeyName: detail?.journey.name ?? "Journey") {
                showLiveSession = false
                Task { await load() }
            }
        }
        .alert("Could not complete that action", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        do { detail = try await APIClient.shared.fetchJourneyDetail(key: journeyKey) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func join() async {
        isChangingMembership = true
        do { try await APIClient.shared.joinJourney(key: journeyKey); await load() }
        catch { errorMessage = error.localizedDescription }
        isChangingMembership = false
    }

    private func leave() async {
        isChangingMembership = true
        do { try await APIClient.shared.leaveJourney(key: journeyKey); await load() }
        catch { errorMessage = error.localizedDescription }
        isChangingMembership = false
    }
}

private struct WaypointRow: View {
    let waypoint: JourneyWaypoint

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: waypoint.unlocked ? "mappin.circle.fill" : "lock.fill")
                .foregroundStyle(waypoint.unlocked ? .orange : .secondary)
            VStack(alignment: .leading, spacing: 3) {
                Text(waypoint.unlocked ? waypoint.title : "Locked").font(.subheadline.weight(.semibold))
                Text("\(String(format: "%.1f", waypoint.kmMark)) km mark").font(.caption2).foregroundStyle(.secondary)
                if waypoint.unlocked {
                    if let narrative = waypoint.narrative { Text(narrative).font(.caption) }
                    if let ref = waypoint.scriptureRef {
                        Text(ref).font(.caption.weight(.semibold)).foregroundStyle(.indigo)
                        if let text = waypoint.scriptureText { Text(text).font(.caption).italic().foregroundStyle(.secondary) }
                    }
                }
            }
        }
        .padding(.vertical, 3)
        .opacity(waypoint.unlocked ? 1 : 0.55)
    }
}

#Preview { NavigationStack { JourneyDetailView(journeyKey: "preview") } }
