import SwiftUI

/// A rotating curated quote or scripture -- distinct from the church
/// devotional, which is tied to a specific linked church.
struct MotivationCard: View {
    @State private var quote: MotivationQuote?

    var body: some View {
        Group {
            if let quote {
                VStack(alignment: .leading, spacing: 4) {
                    Text(quote.text).font(.subheadline).italic()
                    if let attribution = quote.attribution {
                        Text("— \(attribution)").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12).fill(FFTheme.hearth.opacity(0.08)))
            }
        }
        .task {
            quote = try? await APIClient.shared.fetchMotivationQuote()
        }
    }
}

/// Cheering a followed friend's workout -- deliberately scoped to what the
/// followed-friends rail already shows, never a global popularity counter.
struct FriendsWorkoutsRail: View {
    @State private var workouts: [FriendWorkout] = []

    var body: some View {
        Group {
            if !workouts.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Friends' workouts").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.horizontal)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(workouts) { workout in
                                workoutCard(workout)
                            }
                        }
                        .padding(.horizontal)
                    }
                }
            }
        }
        .task {
            workouts = (try? await APIClient.shared.fetchFriendsWorkouts()) ?? []
        }
    }

    private func workoutCard(_ workout: FriendWorkout) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(workout.author).font(.caption.weight(.semibold)).lineLimit(1)
            Text(workout.workoutType ?? "Workout").font(.subheadline)
            if let distanceKm = workout.distanceKm {
                Text(String(format: "%.1f km", distanceKm)).font(.caption2).foregroundStyle(.secondary)
            }
            Button {
                toggleKudos(workout)
            } label: {
                Label("\(workout.kudosCount)", systemImage: workout.kudosByMe ? "hands.clap.fill" : "hands.clap")
            }
            .font(.caption)
            .buttonStyle(.plain)
            .foregroundStyle(workout.kudosByMe ? FFTheme.hearth : .secondary)
        }
        .padding(10)
        .frame(width: 140, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(.tint.opacity(0.08)))
    }

    private func toggleKudos(_ workout: FriendWorkout) {
        guard let index = workouts.firstIndex(where: { $0.id == workout.id }) else { return }
        Task {
            guard let result = try? await APIClient.shared.kudosWorkout(id: workout.workoutID) else { return }
            workouts[index].kudosByMe = result.given
            workouts[index].kudosCount = result.count
        }
    }
}
