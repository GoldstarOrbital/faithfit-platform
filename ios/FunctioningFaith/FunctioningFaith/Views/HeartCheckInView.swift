import SwiftUI

/// A heart-rate reading, reported plainly -- never an interpretation of how
/// the member feels. See lib/contexts.js's own header: "Stress, anxiety,
/// fear and dread are not measurements ... nothing here ever tells a
/// member what they are feeling." Only ever built from a real HealthKit
/// reading; an empty sample set is reported as exactly that.
struct HeartCheckInView: View {
    @State private var isChecking = false
    @State private var result: HeartCheckInResult?
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            if isChecking {
                ProgressView("Reading your heart rate…")
            } else if let result {
                resultView(result)
            } else {
                startPrompt
            }
            Spacer()
        }
        .padding()
        .navigationTitle("Heart Check-in")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Could not check", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private var startPrompt: some View {
        VStack(spacing: 16) {
            Image(systemName: "heart.text.square").font(.system(size: 44)).foregroundStyle(.tint)
            Text("See how your heart is doing right now, at rest.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Check now") { Task { await check() } }
                .buttonStyle(.ffPrimary)
        }
    }

    @ViewBuilder
    private func resultView(_ result: HeartCheckInResult) -> some View {
        VStack(spacing: 16) {
            if let label = result.label {
                Text(label).font(.title3.weight(.semibold))
                if let blurb = result.blurb {
                    Text(blurb).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
            } else {
                Text(result.hint ?? result.reason ?? "Nothing to report right now.")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
            }
            if let verse = result.verse {
                VStack(spacing: 4) {
                    Text(verse.text).multilineTextAlignment(.center)
                    Text(verse.reference).font(.caption).foregroundStyle(.secondary)
                }
                .padding(.horizontal)
            }
            if let suggested = result.suggestedPattern {
                NavigationLink {
                    BreathingPatternLoader(key: suggested.key)
                } label: {
                    Label("Try \(suggested.name) (\(suggested.minutes) min)", systemImage: "wind")
                }
                .buttonStyle(.ffPrimary)
            }
            Button("Check again") { Task { await check() } }
                .font(.caption)
        }
    }

    private func check() async {
        isChecking = true
        do {
            let samples = try await HealthKitManager.shared.recentHeartRateSamples()
            let ints = samples.map { Int($0.rounded()) }
            result = try await APIClient.shared.checkHeartRate(recentHR: ints, moving: false)
        } catch {
            errorMessage = error.localizedDescription
        }
        isChecking = false
    }
}

#Preview { NavigationStack { HeartCheckInView() } }
