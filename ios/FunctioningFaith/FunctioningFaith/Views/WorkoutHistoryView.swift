import SwiftUI

/// Every past workout, not just the last handful Train's own Recent panel
/// shows -- paginated with the server's own cursor (`next_before`) so a
/// workout logged mid-scroll can't shift the window and duplicate or skip a
/// row.
struct WorkoutHistoryView: View {
    @State private var workouts: [LoggedWorkout] = []
    @State private var nextBefore: String?
    @State private var isLoading = true
    @State private var isLoadingMore = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && workouts.isEmpty {
                FFLoadingView(message: "Loading your workouts…")
            } else if let errorMessage, workouts.isEmpty {
                FFErrorStateView(message: errorMessage, onRetry: { Task { await load() } })
            } else if workouts.isEmpty {
                FFEmptyStateView(title: "No workouts yet", systemImage: "figure.run",
                                  message: "Every completed workout will show up here.", actionTitle: nil, action: nil)
            } else {
                List {
                    ForEach(workouts) { workout in
                        NavigationLink {
                            WorkoutAnalysisView(workoutID: workout.id)
                        } label: {
                            row(for: workout)
                        }
                        .onAppear {
                            guard workout.id == workouts.last?.id else { return }
                            Task { await loadMore() }
                        }
                    }
                    .onDelete(perform: delete)
                    if isLoadingMore {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                        .listRowBackground(Color.clear)
                    }
                }
                .ffListChrome()
                .refreshable { await load() }
            }
        }
        .navigationTitle("Workout History")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func row(for workout: LoggedWorkout) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(workout.type).font(.subheadline.weight(.semibold))
                Text(workout.startTime.prefix(16)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                if let km = workout.distanceKm {
                    Text(Units.distanceString(km: km)).font(.subheadline.monospacedDigit())
                }
                if let sec = workout.durationSec {
                    Text(TrainingMath.elapsedString(TimeInterval(sec))).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            let page = try await APIClient.shared.fetchWorkoutsPage()
            workouts = page.workouts
            nextBefore = page.nextBefore
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func loadMore() async {
        guard let nextBefore, !isLoadingMore else { return }
        isLoadingMore = true
        do {
            let page = try await APIClient.shared.fetchWorkoutsPage(before: nextBefore)
            workouts.append(contentsOf: page.workouts)
            self.nextBefore = page.nextBefore
        } catch {
            // A failed "load more" shouldn't blank out what's already showing.
        }
        isLoadingMore = false
    }

    private func delete(at offsets: IndexSet) {
        let toRemove = offsets.map { workouts[$0] }
        workouts.remove(atOffsets: offsets)
        Task {
            for workout in toRemove {
                try? await APIClient.shared.deleteWorkout(id: workout.id)
            }
        }
    }
}

#Preview { NavigationStack { WorkoutHistoryView() } }
