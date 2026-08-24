import SwiftUI
import Charts

/// Honest athlete dashboard: every value comes from recorded workouts, never
/// synthetic performance claims. It complements the activity detail screen.
struct AthleteIntelligenceView: View {
    @State private var data: AthleteTrainingIntelligence?
    @State private var error: String?
    var body: some View {
        Group {
            if let data {
                List {
                    Section("Fitness & Freshness") {
                        HStack { tile("Fitness", String(format:"%.1f",data.fitness.ctl)); tile("Fatigue", String(format:"%.1f",data.fitness.atl)); tile("Form", String(format:"%+.1f",data.fitness.form)) }
                        Label(data.fitness.label, systemImage: "waveform.path.ecg")
                        Text(data.fitness.disclaimer).font(.caption2).foregroundStyle(.secondary)
                    }
                    Section("Relative Effort") {
                        if data.trainingLog.isEmpty { ContentUnavailableView("No completed workouts", systemImage:"figure.run") }
                        else {
                            Chart(data.trainingLog.reversed()) { BarMark(x:.value("Workout", $0.endTime.prefix(10)), y:.value("Effort",$0.relativeEffort)).foregroundStyle(FFTheme.emerald) }.frame(height:170)
                            ForEach(data.trainingLog) { entry in
                                HStack { VStack(alignment:.leading){ Text(entry.type).font(.headline); Text(entry.endTime.prefix(10)).font(.caption).foregroundStyle(.secondary) }; Spacer(); VStack(alignment:.trailing){ Text("\(entry.relativeEffort) RE").font(.headline); if let pace=entry.paceMinPerKm { Text(String(format:"%.2f min/km",pace)).font(.caption).foregroundStyle(.secondary) } } }
                            }
                        }
                    }
                    Section("Best efforts") {
                        ForEach(data.bestEfforts.keys.sorted(), id:\.self) { type in if let effort=data.bestEfforts[type] { HStack { Text(type); Spacer(); Text(String(format:"%.2f min/km · %.1f km",effort.paceMinPerKm,effort.distanceKm)).foregroundStyle(.secondary) } } }
                    }
                }.ffListChrome().refreshable { await load() }
            } else if let error { ContentUnavailableView("Athlete intelligence unavailable", systemImage:"chart.line.uptrend.xyaxis", description:Text(error)) }
            else { ProgressView("Loading training…") }
        }.navigationTitle("Athlete Intelligence").task { await load() }
    }
    private func tile(_ title:String,_ value:String)->some View { VStack { Text(value).font(.title3.bold()); Text(title).font(.caption2).foregroundStyle(.secondary) }.frame(maxWidth:.infinity) }
    private func load() async { do { data=try await APIClient.shared.fetchAthleteIntelligence() } catch { self.error=error.localizedDescription } }
}
#Preview { NavigationStack { AthleteIntelligenceView() } }
