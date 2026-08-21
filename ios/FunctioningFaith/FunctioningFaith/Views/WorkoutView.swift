import SwiftUI

struct WorkoutView: View {
    @StateObject private var tracker = NativeWorkoutTracker()
    @State private var isActive = false
    @State private var elapsed: TimeInterval = 0
    @State private var heartRate = 0
    @State private var workoutID: UUID?
    @State private var errorMessage: String?
    @State private var showReflection = false
    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Text(heartRate > 0 ? "\(heartRate)" : "—")
                .font(.system(size: 72, weight: .bold, design: .rounded))
                .monospacedDigit()
                .accessibilityLabel("Heart rate \(heartRate) beats per minute")
            Text("BPM").font(.caption).foregroundStyle(.secondary)
            Text(tracker.statusText)
                .font(.caption)
                .foregroundStyle(tracker.points.isEmpty ? Color.secondary : FFTheme.emerald)
                .multilineTextAlignment(.center)

            Text(elapsedString)
                .font(.system(size: 28, weight: .medium, design: .rounded))
                .monospacedDigit()
                .accessibilityLabel("Elapsed time \(elapsedString)")

            Spacer()

            Button(action: toggleWorkout) {
                Text(isActive ? "Stop" : "Start")
                    .font(.title2.weight(.semibold))
                    .frame(width: 120, height: 120)
                    .background(isActive ? FFTheme.seal : FFTheme.emerald)
                    .foregroundStyle(.white)
                    .clipShape(Circle())
            }
            .accessibilityLabel(isActive ? "Stop workout" : "Start workout")
            .frame(minWidth: 44, minHeight: 44)

            Spacer()
        }
        .padding()
        .navigationTitle("Workout")
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
    }

    private var elapsedString: String {
        let m = Int(elapsed) / 60, s = Int(elapsed) % 60
        return String(format: "%02d:%02d", m, s)
    }

    private func toggleWorkout() {
        if isActive {
            guard let id = workoutID else { return }
            isActive = false
            tracker.stop()
            let route = tracker.points
            Task {
                do { try await APIClient.shared.stopWorkout(id: id, gpsPoints: route); await MainActor.run { showReflection = true } }
                catch { await MainActor.run { errorMessage = error.localizedDescription } }
            }
            return
        }
        Task {
            do {
                let started = try await APIClient.shared.startWorkout(type: "Run")
                await MainActor.run { workoutID = started.id; elapsed = 0; heartRate = 0; isActive = true; tracker.start() }
            } catch { await MainActor.run { errorMessage = error.localizedDescription } }
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
