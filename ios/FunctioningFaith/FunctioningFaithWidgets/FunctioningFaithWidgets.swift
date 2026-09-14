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
