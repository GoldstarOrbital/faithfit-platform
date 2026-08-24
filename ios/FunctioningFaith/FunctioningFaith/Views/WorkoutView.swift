import SwiftUI
import MapKit
#if canImport(UIKit)
import UIKit
#endif

/// Train tab — mirrors Railway `renderWorkout`: live GPS, manual log, and a
/// journey picker, plus the same 18-type activity catalog.
struct WorkoutView: View {
    enum Mode: String, CaseIterable {
        case live = "Live track"
        case manual = "Log manually"
        case journey = "Journey"
    }

    @StateObject private var tracker = NativeWorkoutTracker()
    @ObservedObject private var bluetooth = BluetoothHeartRateManager.shared
    @State private var mode: Mode = .live
    @State private var activityTypes: [ActivityTypeItem] = ActivityCatalog.fallback
    @State private var selectedType = "Run"
    @State private var isActive = false
    @State private var elapsed: TimeInterval = 0
    @State private var heartRate = 0
    @State private var mapPosition: MapCameraPosition = .automatic
    @State private var lastHeartRateRefresh = Date.distantPast
    @State private var lastBiometricUpload = Date.distantPast
    @State private var lastHeartRateCalmCue = Date.distantPast
    @State private var heartRateCalmMessage: String?
    @AppStorage("privacy.biometricIngest") private var biometricIngestEnabled = false
    @AppStorage("privacy.scripturePersonalization") private var scripturePersonalizationEnabled = false
    @AppStorage("notifications.heartRateCalm") private var heartRateCalmNotifications = false
    @AppStorage("notifications.heartRateCalm.threshold") private var heartRateCalmThreshold = 160
    @State private var workoutID: UUID?
    @State private var workoutVerse: VerseSnippet?
    @State private var errorMessage: String?
    @State private var completedWorkout: WorkoutCompletion?
    @State private var completedSportMetrics: [String: Double] = [:]
    @State private var showWearables = false
    @State private var showBeacon = false
    @State private var manualMinutes = "30"
    @State private var manualKm = "5"
    @State private var manualNote = ""
    @State private var isSavingManual = false
    @State private var recent: [LoggedWorkout] = []
    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if !isActive {
                    Picker("Mode", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }

                typePicker

                switch mode {
                case .live:
                    livePanel
                case .manual:
                    if isActive { livePanel } else { manualPanel }
                case .journey:
                    if isActive { livePanel } else { journeyPanel }
                }

                if !recent.isEmpty {
                    recentPanel
                }
            }
            .padding()
        }
        .background(FFTheme.parchment0.ignoresSafeArea())
        .navigationTitle("Train")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { BreathworkView() } label: { Image(systemName: "wind") }
                    .accessibilityLabel("Breathing exercises")
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { HeartCheckInView() } label: { Image(systemName: "heart.text.square") }
                    .accessibilityLabel("Heart rate check-in")
            }
        }
        .onReceive(timer) { _ in
            guard isActive else { return }
            elapsed += 1
            // ActivityKit updates are intentionally paced; the timer continues
            // live in the widget without waking the extension every second.
            if Int(elapsed) % 10 == 0 { updateLiveActivity() }
        }
        .onReceive(timer) { _ in
            guard isActive, Date().timeIntervalSince(lastHeartRateRefresh) >= 15 else { return }
            lastHeartRateRefresh = .now
            Task { await refreshHeartRate() }
        }
        .onChange(of: tracker.points) { _, points in
            guard let last = points.last, last.count == 2 else { return }
            mapPosition = .region(MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: last[0], longitude: last[1]),
                span: MKCoordinateSpan(latitudeDelta: 0.012, longitudeDelta: 0.012)
            ))
        }
        .sheet(item: $completedWorkout) { completion in
            PostWorkoutSummaryView(
                completion: completion,
                activityType: selectedType,
                verse: workoutVerse ?? WorkoutView.completionVerse,
                sportMetrics: completedSportMetrics,
                healthConnected: HealthKitManager.shared.authorizationRequested
            )
        }
        .sheet(isPresented: $showWearables) { WearableConnectView() }
        .sheet(isPresented: $showBeacon) {
            if let workoutID { BeaconSafetyView(workoutID: workoutID, location: tracker.points.last) }
        }
        .alert("Workout unavailable", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "Please try again.") }
        .task {
            activityTypes = (try? await APIClient.shared.fetchActivityTypes()) ?? ActivityCatalog.fallback
            recent = (try? await APIClient.shared.fetchWorkouts()) ?? []
        }
    }

    private var typePicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(activityTypes) { item in
                    Button {
                        selectedType = item.type
                    } label: {
                        Text("\(item.icon) \(item.type)")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .background(selectedType == item.type ? FFTheme.walnut0 : FFTheme.parchment1, in: Capsule())
                            .foregroundStyle(selectedType == item.type ? FFTheme.cream : FFTheme.inkSoft)
                    }
                    .buttonStyle(.plain)
                    .disabled(isActive)
                }
            }
        }
        .accessibilityLabel("Activity type")
    }

    private var livePanel: some View {
        VStack(spacing: 16) {
            liveMap

            HStack(spacing: 8) {
                Label(tracker.statusText, systemImage: tracker.isLocationReady ? "location.fill" : "location")
                Spacer()
                Text(isActive ? "LIVE" : "READY")
                    .font(.caption2.weight(.bold))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(isActive ? FFTheme.seal : FFTheme.meadow, in: Capsule())
                    .foregroundStyle(FFTheme.cream)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(tracker.isLocationReady ? FFTheme.meadowDeep : FFTheme.inkSoft)

            Button {
                showWearables = true
            } label: {
                Label(bluetooth.connectedName ?? "Connect sensor", systemImage: bluetooth.connectedName == nil ? "applewatch" : "heart.fill")
                    .font(.caption.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 42)
            }
            .buttonStyle(.bordered)
            .tint(bluetooth.connectedName == nil ? FFTheme.walnut0 : FFTheme.meadow)

            if bluetooth.hasLiveSensorData {
                HStack(spacing: 10) {
                    if let cadence = bluetooth.cadenceRPM { Label("\(cadence) rpm", systemImage: "gauge.with.dots.needle.50percent") }
                    if let power = bluetooth.cyclingPowerWatts { Label("\(power) W", systemImage: "bolt.fill") }
                    if let speed = bluetooth.speedKmh { Label(String(format: "%.1f km/h", speed), systemImage: "speedometer") }
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(FFTheme.inkSoft)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if isActive {
                Button { showBeacon = true } label: {
                    Label("Share safety beacon", systemImage: "location.circle.fill")
                        .font(.caption.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 42)
                }
                .buttonStyle(.bordered).tint(FFTheme.hearth)
                .accessibilityHint("Shares your live workout location only with trusted people you select")
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(liveMetrics) { item in metric(item.value, item.label) }
            }

            if let workoutVerse {
                VerseSnippetCard(verse: workoutVerse)
            }
            if let heartRateCalmMessage {
                Label(heartRateCalmMessage, systemImage: "wind")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(FFTheme.meadowDeep)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(FFTheme.parchment2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            Button(action: toggleWorkout) {
                Text(isActive ? "Stop" : "Start")
                    .font(.title2.weight(.semibold))
                    .frame(width: 120, height: 120)
                    .background(isActive ? FFTheme.seal : FFTheme.emerald)
                    .foregroundStyle(.white)
                    .clipShape(Circle())
            }
            .accessibilityLabel(isActive ? "Stop workout" : "Start workout")
            .frame(maxWidth: .infinity)
        }
        .padding(FFTheme.Space.sm)
        .frame(maxWidth: .infinity)
        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous))
    }

    private var liveMap: some View {
        Map(position: $mapPosition, interactionModes: .all) {
            UserAnnotation()
            if tracker.points.count > 1 {
                MapPolyline(coordinates: routeCoordinates)
                    .stroke(FFTheme.emerald, style: StrokeStyle(lineWidth: 6, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(height: 265)
        .clipShape(RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
        .overlay(alignment: .bottomLeading) {
            Text(tracker.points.count > 1 ? "LIVE ROUTE" : "YOUR ROUTE WILL APPEAR HERE")
                .font(.caption2.weight(.bold))
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(10)
        }
        .accessibilityLabel(tracker.points.count > 1 ? "Live workout route" : "Map ready to record your route")
    }

    private var routeCoordinates: [CLLocationCoordinate2D] {
        tracker.points.compactMap { point in
            guard point.count == 2 else { return nil }
            return CLLocationCoordinate2D(latitude: point[0], longitude: point[1])
        }
    }

    private var liveMetrics: [TrainingMath.LiveMetric] {
        TrainingMath.liveMetrics(activity: selectedType, elapsed: elapsed, distanceKm: tracker.distanceKm,
                                 currentSpeedKmh: tracker.currentSpeedKmh, maxSpeedKmh: tracker.maxSpeedKmh,
                                 elevationGainM: tracker.elevationGainM, elevationLossM: tracker.elevationLossM,
                                 heartRate: heartRate)
    }

    private var manualPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Log a workout")
                .font(.headline)
            Text("Add an activity you did off-app.")
                .font(.caption)
                .foregroundStyle(.secondary)
            labeledField("Duration (minutes)", text: $manualMinutes, keyboard: .numberPad)
            labeledField("Distance (km) — optional", text: $manualKm, keyboard: .decimalPad)
            labeledField("Note — optional", text: $manualNote, keyboard: .default)
            Button {
                Task { await saveManual() }
            } label: {
                Text(isSavingManual ? "Saving…" : "Save workout")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.ffPrimary)
            .disabled(isSavingManual)
        }
        .padding()
        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous))
    }

    private var journeyPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Ride a route")
                .font(.headline)
            Text("Every kilometre you cover in real life moves the marker. Biblical routes use real geography.")
                .font(.caption)
                .foregroundStyle(.secondary)
            NavigationLink {
                JourneysListView()
            } label: {
                Text("Open journeys")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.ffPrimary)
            Text("Or start a live track above after you pick a journey — the same GPS session advances the route.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous))
    }

    private var recentPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Recent")
                .font(.headline)
            ForEach(recent.prefix(8)) { workout in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(workout.type).font(.subheadline.weight(.semibold))
                        Text(workout.startTime.prefix(16)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        if let km = workout.distanceKm {
                            Text(String(format: "%.2f km", km)).font(.subheadline.monospacedDigit())
                        }
                        if let sec = workout.durationSec {
                            Text(TrainingMath.elapsedString(TimeInterval(sec))).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.vertical, 6)
            }
        }
    }

    private func metric(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value).font(.title2.weight(.bold).monospacedDigit()).foregroundStyle(FFTheme.ink)
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(FFTheme.inkSoft)
        }
        .frame(maxWidth: .infinity, minHeight: 68, alignment: .leading)
        .padding(10)
        .background(FFTheme.parchment2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func labeledField(_ title: String, text: Binding<String>, keyboard: UIKeyboardType) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField(title, text: text)
                .keyboardType(keyboard)
                .textFieldStyle(.roundedBorder)
                .frame(minHeight: 44)
        }
    }

    private func toggleWorkout() {
        if isActive {
            guard let id = workoutID else { return }
            isActive = false
            tracker.stop()
            Task { await WorkoutLiveActivityManager.shared.end() }
            let route = tracker.points
            let distance = tracker.distanceKm
            Task {
                do {
                    var sportMetrics: [String: Double] = ["top_speed_kmh": max(tracker.maxSpeedKmh, bluetooth.speedKmh ?? 0),
                                                           "elevation_gain_m": tracker.elevationGainM,
                                                           "elevation_loss_m": tracker.elevationLossM]
                    if let cadence = bluetooth.cadenceRPM { sportMetrics["cadence_rpm"] = Double(cadence) }
                    if let power = bluetooth.cyclingPowerWatts { sportMetrics["power_w"] = Double(power) }
                    if bluetooth.peakPowerWatts > 0 { sportMetrics["peak_power_w"] = Double(bluetooth.peakPowerWatts) }
                    let completion = try await APIClient.shared.stopWorkout(id: id, gpsPoints: route, gpsDistanceKm: distance, sportMetrics: sportMetrics)
                    await MainActor.run {
                        completedSportMetrics = sportMetrics
                        completedWorkout = completion
                    }
                    recent = (try? await APIClient.shared.fetchWorkouts()) ?? recent
                } catch {
                    await MainActor.run { errorMessage = error.localizedDescription }
                }
            }
            return
        }
        Task {
            do {
                let started = try await APIClient.shared.startWorkout(type: selectedType)
                await MainActor.run {
                    workoutID = started.id
                    elapsed = 0
                    heartRate = 0
                    lastHeartRateRefresh = .distantPast
                    lastBiometricUpload = .distantPast
                    lastHeartRateCalmCue = .distantPast
                    heartRateCalmMessage = nil
                    workoutVerse = nil
                    isActive = true
                    tracker.start()
                    WorkoutLiveActivityManager.shared.start(sport: selectedType)
                }
            } catch {
                await MainActor.run { errorMessage = error.localizedDescription }
            }
        }
    }

    private func refreshHeartRate() async {
        if let wearableHeartRate = bluetooth.heartRate {
            heartRate = wearableHeartRate
            updateLiveActivity()
            await deliverCalmCueIfNeeded()
            await submitBiometricSampleIfNeeded()
            return
        }
        let samples = (try? await HealthKitManager.shared.recentHeartRateSamples()) ?? []
        guard let latest = samples.last else { return }
        heartRate = Int(latest.rounded())
        updateLiveActivity()
        await deliverCalmCueIfNeeded()
        await submitBiometricSampleIfNeeded()
    }

    private func deliverCalmCueIfNeeded() async {
        guard heartRateCalmNotifications,
              heartRate >= heartRateCalmThreshold,
              Date().timeIntervalSince(lastHeartRateCalmCue) >= 5 * 60 else { return }
        lastHeartRateCalmCue = .now
        heartRateCalmMessage = "Your heart rate is elevated. Ease your pace if you need to and take a few slow breaths."
        await NotificationCoordinator.shared.deliverHeartRateCalmCue(heartRate: heartRate)
    }

    private func updateLiveActivity() {
        guard isActive else { return }
        WorkoutLiveActivityManager.shared.update(
            distanceKm: tracker.distanceKm,
            speedKmh: tracker.currentSpeedKmh ?? bluetooth.speedKmh,
            heartRate: heartRate > 0 ? heartRate : bluetooth.heartRate
        )
    }

    private func submitBiometricSampleIfNeeded() async {
        guard biometricIngestEnabled, heartRate > 0, let workoutID,
              Date().timeIntervalSince(lastBiometricUpload) >= 60 else { return }
        lastBiometricUpload = .now
        do {
            let result = try await APIClient.shared.recordWorkoutBiometrics(id: workoutID, heartRate: heartRate)
            if scripturePersonalizationEnabled, let verse = result.verse { workoutVerse = verse }
        } catch {
            // Live workout recording remains usable if a moment cannot be sent.
        }
    }

    private func saveManual() async {
        isSavingManual = true
        defer { isSavingManual = false }
        let minutes = Double(manualMinutes) ?? 0
        let km = Double(manualKm)
        do {
            let saved = try await APIClient.shared.logManualWorkout(
                type: selectedType,
                durationMin: minutes,
                distanceKm: (km ?? 0) > 0 ? km : nil,
                note: manualNote.isEmpty ? nil : manualNote
            )
            completedSportMetrics = [:]
            completedWorkout = WorkoutCompletion(
                id: UUID(uuidString: saved.id) ?? UUID(),
                calories: saved.calories,
                avgHR: nil,
                maxHR: nil,
                distanceKm: saved.distanceKm,
                durationSec: saved.durationSec,
                encouragement: "Every faithful step counts. Keep building the rhythm God has given you.",
                effort: nil
            )
            recent = (try? await APIClient.shared.fetchWorkouts()) ?? recent
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private extension WorkoutView {
    static let completionVerse = VerseSnippet(
        id: "phl.4.13",
        reference: "Philippians 4:13",
        snippet: "I can do all this through him who gives me strength.",
        deepLink: "youversion://bible/verse/phl.4.13"
    )
}

struct PostWorkoutSummaryView: View {
    @Environment(\.dismiss) var dismiss
    let completion: WorkoutCompletion
    let activityType: String
    let verse: VerseSnippet
    let sportMetrics: [String: Double]
    let healthConnected: Bool

    private var distanceText: String? {
        guard let distance = completion.distanceKm, distance > 0 else { return nil }
        return String(format: "%.2f km", distance)
    }

    private var paceText: String? {
        guard let km = completion.distanceKm, km > 0, completion.durationSec > 0,
              !["Skiing", "Strength", "HIIT", "Yoga", "Pilates"].contains(activityType) else { return nil }
        let seconds = Double(completion.durationSec) / km
        return String(format: "%d:%02d /km", Int(seconds) / 60, Int(seconds) % 60)
    }

    private var extraMetrics: [(String, String)] {
        var items: [(String, String)] = []
        if let topSpeed = sportMetrics["top_speed_kmh"], topSpeed > 0 {
            items.append((String(format: "%.1f km/h", topSpeed), "Top speed"))
        }
        if let elevation = sportMetrics["elevation_gain_m"], elevation > 0 {
            items.append(("\(Int(elevation.rounded())) m", "Elevation gain"))
        }
        if let cadence = sportMetrics["cadence_rpm"], cadence > 0 {
            items.append(("\(Int(cadence.rounded())) rpm", "Cadence"))
        }
        if let power = sportMetrics["power_w"], power > 0 {
            items.append(("\(Int(power.rounded())) W", "Power"))
        }
        return items
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("ACTIVITY COMPLETE")
                            .font(.caption.weight(.bold)).tracking(1.1).foregroundStyle(FFTheme.meadowDeep)
                        Text("Great work, \(activityType).")
                            .font(FFTheme.display(28, weight: .bold, relativeTo: .title))
                        Text("Your session is saved. Here is what you recorded.")
                            .font(.subheadline).foregroundStyle(FFTheme.inkSoft)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        summaryMetric(TrainingMath.elapsedString(TimeInterval(completion.durationSec)), "Duration")
                        if let distanceText { summaryMetric(distanceText, "Distance") }
                        summaryMetric("\(completion.calories)", "Calories")
                        if let paceText { summaryMetric(paceText, "Average pace") }
                        if let avgHR = completion.avgHR { summaryMetric("\(avgHR) bpm", "Average heart rate") }
                        if let maxHR = completion.maxHR { summaryMetric("\(maxHR) bpm", "Peak heart rate") }
                        if let effort = completion.effort?.effortScore { summaryMetric("\(Int(effort.rounded()))", "Effort score") }
                        ForEach(Array(extraMetrics.enumerated()), id: \.offset) { _, metric in
                            summaryMetric(metric.0, metric.1)
                        }
                    }

                    VStack(alignment: .leading, spacing: 7) {
                        Label(healthConnected ? "Apple Health insight" : "Apple Health", systemImage: "heart.text.square.fill")
                            .font(.headline).foregroundStyle(FFTheme.seal)
                        if completion.avgHR != nil || completion.maxHR != nil {
                            Text("Your recorded heart-rate data is included above. Functioning Faith only shows measurements captured during this session.")
                        } else if healthConnected {
                            Text("Apple Health is connected, but this session did not include heart-rate samples. Your activity can still sync with its recorded duration, distance, and energy.")
                        } else {
                            Text("Connect Apple Health in Profile to bring compatible Apple Watch and Health-connected workout data into your insights.")
                        }
                    }
                    .font(.caption).foregroundStyle(FFTheme.inkSoft)
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                    .background(FFTheme.parchment2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                    if let encouragement = completion.encouragement, !encouragement.isEmpty {
                        Text(encouragement).font(.subheadline.weight(.medium)).foregroundStyle(FFTheme.ink)
                    }
                    VerseSnippetCard(verse: verse)
                }
                .padding()
            }
            .background(FFTheme.parchment0.ignoresSafeArea())
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.large])
    }

    private func summaryMetric(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(FFTheme.ink)
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(FFTheme.inkSoft)
        }
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading).padding(12)
        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

#Preview { NavigationStack { WorkoutView() } }
