import SwiftUI
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
    @State private var mode: Mode = .live
    @State private var activityTypes: [ActivityTypeItem] = ActivityCatalog.fallback
    @State private var selectedType = "Run"
    @State private var isActive = false
    @State private var elapsed: TimeInterval = 0
    @State private var heartRate = 0
    @State private var workoutID: UUID?
    @State private var errorMessage: String?
    @State private var showReflection = false
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
        .onReceive(timer) { _ in if isActive { elapsed += 1 } }
        .sheet(isPresented: $showReflection) { PostWorkoutReflectionView() }
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
            VStack(spacing: 4) {
                Text(heartRate > 0 ? "\(heartRate)" : "—")
                    .font(.system(size: 64, weight: .bold, design: .rounded))
                    .monospacedDigit()
                Text("BPM · connect a monitor on device")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(TrainingMath.elapsedString(elapsed))
                .font(.system(size: 40, weight: .medium, design: .rounded))
                .monospacedDigit()
                .accessibilityLabel("Elapsed time \(TrainingMath.elapsedString(elapsed))")

            Text(tracker.statusText)
                .font(.caption)
                .foregroundStyle(tracker.points.isEmpty ? Color.secondary : FFTheme.emerald)
                .multilineTextAlignment(.center)

            HStack {
                metric(String(format: "%.2f", tracker.distanceKm), "km")
                metric(TrainingMath.paceString(elapsed: elapsed, km: tracker.distanceKm), "pace /km")
                metric("\(TrainingMath.estimatedKcal(elapsed: elapsed, km: tracker.distanceKm))", "kcal est.")
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
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
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
        VStack(spacing: 2) {
            Text(value).font(.title3.weight(.semibold).monospacedDigit())
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
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
            let route = tracker.points
            Task {
                do {
                    try await APIClient.shared.stopWorkout(id: id, gpsPoints: route)
                    await MainActor.run { showReflection = true }
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
                    isActive = true
                    tracker.start()
                }
            } catch {
                await MainActor.run { errorMessage = error.localizedDescription }
            }
        }
    }

    private func saveManual() async {
        isSavingManual = true
        defer { isSavingManual = false }
        let minutes = Double(manualMinutes) ?? 0
        let km = Double(manualKm)
        do {
            _ = try await APIClient.shared.logManualWorkout(
                type: selectedType,
                durationMin: minutes,
                distanceKm: (km ?? 0) > 0 ? km : nil,
                note: manualNote.isEmpty ? nil : manualNote
            )
            showReflection = true
            recent = (try? await APIClient.shared.fetchWorkouts()) ?? recent
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct PostWorkoutReflectionView: View {
    @Environment(\.dismiss) var dismiss
    var body: some View {
        VStack(spacing: 16) {
            Text("Nice work!").font(.title2.bold())
            VerseSnippetCard(verse: VerseSnippet(id: "phl.4.13", reference: "Philippians 4:13",
                snippet: "I can do all this through him who gives me strength.", deepLink: "youversion://bible/verse/phl.4.13"))
            Button("Done") { dismiss() }
                .frame(minWidth: 44, minHeight: 44)
        }
        .padding()
        .presentationDetents([.medium])
    }
}

#Preview { NavigationStack { WorkoutView() } }
