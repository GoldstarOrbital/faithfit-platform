import SwiftUI
import Charts

struct StatsView: View {
    @State private var summary: StatsSummary?
    @State private var trends: [TrendPoint] = []
    @State private var breakdown: [ActivityBreakdownEntry] = []
    @State private var records: [String: [PersonalRecord]] = [:]
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var periodTab = 0 // 0 = week, 1 = month, 2 = lifetime

    var body: some View {
        Group {
            if isLoading && summary == nil {
                ProgressView()
            } else if let summary {
                List {
                    streakSection(summary)
                    totalsSection(summary)
                    if !trends.isEmpty { trendsSection }
                    if hasAnyRecord(summary.records) { quickRecordsSection(summary.records) }
                    if !breakdown.isEmpty { breakdownSection }
                    if !records.isEmpty { personalRecordsSection }
                }
                .refreshable { await load() }
            } else {
                ContentUnavailableView("No stats yet", systemImage: "chart.bar", description: Text("Complete a workout to start tracking your progress."))
            }
        }
        .navigationTitle("Stats")
        .task { await load() }
        .alert("Could not load stats", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        do {
            async let s = APIClient.shared.fetchStatsSummary()
            async let t = APIClient.shared.fetchTrends()
            async let b = APIClient.shared.fetchActivityBreakdown()
            async let r = APIClient.shared.fetchPersonalRecords()
            let (summaryResult, trendsResult, breakdownResult, recordsResult) = try await (s, t, b, r)
            summary = summaryResult; trends = trendsResult; breakdown = breakdownResult; records = recordsResult
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func hasAnyRecord(_ r: SummaryRecords) -> Bool {
        r.longestDistanceKm != nil || r.longestDurationMin != nil || r.fastestPaceMinKm != nil || r.mostCalories != nil || r.highestHR != nil
    }

    @ViewBuilder
    private func streakSection(_ summary: StatsSummary) -> some View {
        Section {
            HStack {
                VStack(alignment: .leading) {
                    Text("\(summary.streakDays)").font(.system(size: 34, weight: .bold))
                    Text(summary.streakDays == 1 ? "day streak" : "day streak").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing) {
                    Text("\(summary.activeDays)").font(.system(size: 34, weight: .bold))
                    Text("active days").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 6)
        }
    }

    @ViewBuilder
    private func totalsSection(_ summary: StatsSummary) -> some View {
        Section {
            Picker("Period", selection: $periodTab) {
                Text("Week").tag(0); Text("Month").tag(1); Text("Lifetime").tag(2)
            }.pickerStyle(.segmented)
            let totals = periodTab == 0 ? summary.thisWeek : periodTab == 1 ? summary.thisMonth : summary.lifetime
            HStack {
                statTile("Workouts", "\(totals.workouts)")
                statTile("Distance", String(format: "%.1f km", totals.distanceKm))
            }
            HStack {
                statTile("Time", durationLabel(totals.durationMin))
                statTile("Calories", "\(totals.calories)")
            }
        }
    }

    private func statTile(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.weight(.semibold))
            Text(title).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func durationLabel(_ minutes: Int) -> String {
        if minutes >= 60 { return "\(minutes / 60)h \(minutes % 60)m" }
        return "\(minutes)m"
    }

    private var trendsSection: some View {
        Section("Last 12 weeks") {
            Chart(trends) { point in
                BarMark(x: .value("Week", point.label), y: .value("Distance", point.distanceKm))
                    .foregroundStyle(.tint)
            }
            .frame(height: 160)
            .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
        }
    }

    @ViewBuilder
    private func quickRecordsSection(_ r: SummaryRecords) -> some View {
        Section("Personal bests") {
            if let d = r.longestDistanceKm { recordRow("Longest distance", String(format: "%.2f km", d)) }
            if let d = r.longestDurationMin { recordRow("Longest session", durationLabel(d)) }
            if let p = r.fastestPaceMinKm { recordRow("Fastest pace", String(format: "%.2f min/km", p)) }
            if let c = r.mostCalories { recordRow("Most calories", "\(c) kcal") }
            if let h = r.highestHR { recordRow("Highest heart rate", "\(h) bpm") }
        }
    }

    private func recordRow(_ label: String, _ value: String) -> some View {
        HStack { Text(label); Spacer(); Text(value).foregroundStyle(.secondary) }
    }

    private var breakdownSection: some View {
        Section("Activity breakdown") {
            ForEach(breakdown) { entry in
                HStack {
                    Text(entry.type)
                    Spacer()
                    Text("\(entry.count) · \(String(format: "%.1f", entry.distanceKm)) km")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var personalRecordsSection: some View {
        Section("Records by activity") {
            ForEach(records.keys.sorted(), id: \.self) { type in
                DisclosureGroup(type) {
                    ForEach(records[type] ?? []) { rec in
                        HStack {
                            Text(rec.label).font(.subheadline)
                            Spacer()
                            Text("\(formattedValue(rec)) \(rec.unit)").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private func formattedValue(_ r: PersonalRecord) -> String {
        r.value.truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", r.value) : String(format: "%.2f", r.value)
    }
}

#Preview { NavigationStack { StatsView() } }
