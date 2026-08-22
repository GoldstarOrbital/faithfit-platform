import ActivityKit
import SwiftUI
import WidgetKit

@main
struct FunctioningFaithWidgets: WidgetBundle {
    var body: some Widget { FunctioningFaithWorkoutLiveActivity() }
}

struct FunctioningFaithWorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutLiveActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label(context.attributes.sport, systemImage: "figure.run")
                        .font(.headline)
                    Spacer()
                    Text(context.state.startedAt, style: .timer).monospacedDigit()
                }
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                    metric(String(format: "%.2f km", context.state.distanceKm), "distance")
                    if let speed = context.state.speedKmh { metric(String(format: "%.1f km/h", speed), "speed") }
                    if let heartRate = context.state.heartRate { metric("\(heartRate) BPM", "heart rate") }
                }
                Text("Functioning Faith · Live training")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding()
            .activityBackgroundTint(Color(red: 0.16, green: 0.12, blue: 0.09))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Label(context.attributes.sport, systemImage: "figure.run") }
                DynamicIslandExpandedRegion(.trailing) { Text(context.state.startedAt, style: .timer).monospacedDigit() }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(String(format: "%.2f km", context.state.distanceKm)).bold()
                        Spacer()
                        if let heartRate = context.state.heartRate { Label("\(heartRate)", systemImage: "heart.fill").foregroundStyle(.red) }
                    }
                }
            } compactLeading: {
                Image(systemName: "figure.run")
            } compactTrailing: {
                Text(String(format: "%.1f", context.state.distanceKm))
            } minimal: {
                Image(systemName: "figure.run")
            }
        }
    }

    @ViewBuilder
    private func metric(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.headline.monospacedDigit())
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}
