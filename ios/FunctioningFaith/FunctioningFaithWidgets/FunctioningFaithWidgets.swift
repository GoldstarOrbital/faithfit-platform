import ActivityKit
import SwiftUI
import WidgetKit

@main
struct FunctioningFaithWidgets: WidgetBundle {
    var body: some Widget {
        FunctioningFaithWorkoutLiveActivity()
        FunctioningFaithScriptureWidget()
    }
}

private struct ScriptureEntry: TimelineEntry {
    let date: Date
    let scripture: WidgetScriptureSnapshot
}

private struct ScriptureProvider: TimelineProvider {
    func placeholder(in context: Context) -> ScriptureEntry { ScriptureEntry(date: .now, scripture: WidgetScriptureStore.fallback) }
    func getSnapshot(in context: Context, completion: @escaping (ScriptureEntry) -> Void) {
        completion(ScriptureEntry(date: .now, scripture: WidgetScriptureStore.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ScriptureEntry>) -> Void) {
        let entry = ScriptureEntry(date: .now, scripture: WidgetScriptureStore.load())
        completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(30 * 60))))
    }
}

struct FunctioningFaithScriptureWidget: Widget {
    let kind = "FunctioningFaithScripture"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScriptureProvider()) { entry in
            VStack(alignment: .leading, spacing: 8) {
                Text("FUNCTIONING FAITH")
                    .font(.caption2.weight(.heavy)).foregroundStyle(Color(red: 0.12, green: 0.38, blue: 0.25))
                Label(entry.scripture.context.uppercased(), systemImage: "cross.fill")
                    .font(.caption2.weight(.bold)).foregroundStyle(Color(red: 0.69, green: 0.48, blue: 0.15))
                Text("“\(entry.scripture.text)”")
                    .font(.system(.body, design: .serif, weight: .medium))
                    .lineLimit(4).foregroundStyle(Color(red: 0.16, green: 0.12, blue: 0.08))
                Text(entry.scripture.reference)
                    .font(.caption.weight(.semibold)).foregroundStyle(Color(red: 0.12, green: 0.38, blue: 0.25))
            }
            .containerBackground(for: .widget) {
                LinearGradient(colors: [Color(red: 0.98, green: 0.95, blue: 0.86), Color(red: 0.91, green: 0.85, blue: 0.69)], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
            .widgetURL(URL(string: "functioningfaith://scripture"))
        }
        .configurationDisplayName("Scripture for Your Journey")
        .description("Scripture refreshed from your Functioning Faith activity and daily mission.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct FunctioningFaithWorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutLiveActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("FUNCTIONING FAITH").font(.caption2.weight(.heavy)).foregroundStyle(Color(red: 0.85, green: 0.67, blue: 0.33))
                        Label(context.attributes.sport, systemImage: "figure.run").font(.headline)
                    }
                    Spacer()
                    elapsedText(context.state)
                }
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                    metric(String(format: "%.2f km", context.state.distanceKm), "distance")
                    if let speed = context.state.speedKmh { metric(String(format: "%.1f km/h", speed), "speed") }
                    if let heartRate = context.state.heartRate { metric("\(heartRate) BPM", "heart rate") }
                }
                Text(context.state.isPaused ? "Workout paused" : "Live training")
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .padding()
            .activityBackgroundTint(Color(red: 0.16, green: 0.12, blue: 0.09))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading) {
                        Text("Functioning Faith").font(.caption2.weight(.bold))
                        Label(context.attributes.sport, systemImage: "figure.run")
                    }
                }
                DynamicIslandExpandedRegion(.trailing) { elapsedText(context.state) }
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

    @ViewBuilder
    private func elapsedText(_ state: WorkoutLiveActivityAttributes.ContentState) -> some View {
        if state.isPaused {
            Text(Self.elapsedString(state.elapsedSeconds)).monospacedDigit()
        } else {
            // Reconstruct an effective start from active elapsed time. The OS
            // can animate this timer every second while distance is refreshed
            // at an ActivityKit-friendly cadence.
            Text(state.updatedAt.addingTimeInterval(-TimeInterval(state.elapsedSeconds)), style: .timer)
                .monospacedDigit()
        }
    }

    private static func elapsedString(_ seconds: Int) -> String {
        let safe = max(0, seconds)
        let hours = safe / 3600
        let minutes = (safe % 3600) / 60
        let remaining = safe % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, remaining)
            : String(format: "%02d:%02d", minutes, remaining)
    }
}
