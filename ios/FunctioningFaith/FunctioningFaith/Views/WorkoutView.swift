import SwiftUI

struct WorkoutView: View {
    @State private var isActive = false
    @State private var elapsed: TimeInterval = 0
    @State private var heartRate = 0
    @State private var showReflection = false
    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Text("\(heartRate)")
                .font(.system(size: 72, weight: .bold, design: .rounded))
                .monospacedDigit()
                .accessibilityLabel("Heart rate \(heartRate) beats per minute")
            Text("BPM").font(.caption).foregroundStyle(.secondary)

            Text(elapsedString)
                .font(.system(size: 28, weight: .medium, design: .rounded))
                .monospacedDigit()
                .accessibilityLabel("Elapsed time \(elapsedString)")

            Spacer()

            Button(action: toggleWorkout) {
                Text(isActive ? "Stop" : "Start")
                    .font(.title2.weight(.semibold))
                    .frame(width: 120, height: 120)
                    .background(isActive ? Color.red : Color.green)
                    .foregroundStyle(.white)
                    .clipShape(Circle())
            }
            .accessibilityLabel(isActive ? "Stop workout" : "Start workout")
            .frame(minWidth: 44, minHeight: 44)

            Spacer()
        }
        .padding()
        .navigationTitle("Workout")
        .onReceive(timer) { _ in if isActive { elapsed += 1; heartRate = Int.random(in: 110...165) } }
        .sheet(isPresented: $showReflection) { PostWorkoutReflectionView() }
    }

    private var elapsedString: String {
        let m = Int(elapsed) / 60, s = Int(elapsed) % 60
        return String(format: "%02d:%02d", m, s)
    }

    private func toggleWorkout() {
        isActive.toggle()
        if !isActive { showReflection = true }
        // TODO: on start -> emit workout.started via wearable-ingest bridge; on stop -> workout.completed
        // TODO: haptic feedback on HR zone changes via UIImpactFeedbackGenerator; audio cues via AVSpeechSynthesizer
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
