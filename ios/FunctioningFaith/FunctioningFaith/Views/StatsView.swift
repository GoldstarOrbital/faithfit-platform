import SwiftUI
import Charts

struct StatsView: View {
    @State private var summary: StatsSummary?
    @State private var trends: [TrendPoint] = []
    @State private var breakdown: [ActivityBreakdownEntry] = []
    @State private var records: [String: [PersonalRecord]] = [:]
    @State private var goals: [TrainingGoal] = []
    @State private var recap: WeeklyRecap?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var periodTab = 0 // 0 = week, 1 = month, 2 = lifetime
    @State private var showGoalComposer = false

    var body: some View {
        Group {
            if isLoading && summary == nil {
                ProgressView()
            } else if let summary {
                List {
                    if let recap { recapSection(recap) }
                    Section {
                        NavigationLink { AthleteIntelligenceView() } label: {
                            Label("Athlete Intelligence", systemImage: "chart.line.uptrend.xyaxis")
                        }
                    }
                    .listRowBackground(FFTheme.parchment1)
                    streakSection(summary)
                    totalsSection(summary)
                    goalsSection
                    if !trends.isEmpty { trendsSection }
                    if hasAnyRecord(summary.records) { quickRecordsSection(summary.records) }
                    if !breakdown.isEmpty { breakdownSection }
                    if !records.isEmpty { personalRecordsSection }
                }
                .ffListChrome()
                .refreshable { await load() }
            } else {
                ContentUnavailableView("No stats yet", systemImage: "chart.bar", description: Text("Complete a workout to start tracking your progress."))
            }
        }
        .navigationTitle("Stats")
        .task { await load() }
        .sheet(isPresented: $showGoalComposer) {
            NavigationStack {
                GoalComposerView { await loadGoals() }
            }
        }
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
            async let g = APIClient.shared.fetchGoals()
            async let rec = APIClient.shared.fetchWeeklyRecap()
            let (summaryResult, trendsResult, breakdownResult, recordsResult, goalsResult) = try await (s, t, b, r, g)
            summary = summaryResult; trends = trendsResult; breakdown = breakdownResult; records = recordsResult; goals = goalsResult
            recap = try? await rec
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func loadGoals() async {
        goals = (try? await APIClient.shared.fetchGoals()) ?? []
    }

    @ViewBuilder
    private var goalsSection: some View {
        Section {
            if goals.isEmpty {
                Text("No goals yet.").foregroundStyle(.secondary)
            } else {
                ForEach(goals) { goal in
                    goalRow(goal)
                }
                .onDelete(perform: deleteGoal)
            }
            Button("Add goal") { showGoalComposer = true }
        } header: {
            Text("Goals")
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func goalRow(_ goal: TrainingGoal) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(goal.title).font(.subheadline.weight(.medium))
                Spacer()
                if goal.completed { Image(systemName: "checkmark.seal.fill").foregroundStyle(.green) }
            }
            ProgressView(value: Double(goal.percent), total: 100).tint(goal.completed ? FFTheme.emerald : FFTheme.hearth)
            Text("\(goalProgressLabel(goal)) · \(goal.period.capitalized)").font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    private func goalProgressLabel(_ goal: TrainingGoal) -> String {
        switch goal.metric {
        case "distance_km": return String(format: "%.1f / %.1f km", goal.progress, goal.target)
        case "duration_min": return "\(Int(goal.progress)) / \(Int(goal.target)) min"
        case "calories": return "\(Int(goal.progress)) / \(Int(goal.target)) kcal"
        default: return "\(Int(goal.progress)) / \(Int(goal.target)) workouts"
        }
    }

    private func deleteGoal(at offsets: IndexSet) {
        let toRemove = offsets.map { goals[$0] }
        goals.remove(atOffsets: offsets)
        Task {
            for goal in toRemove {
                try? await APIClient.shared.deleteGoal(id: goal.id)
            }
        }
    }

    private func hasAnyRecord(_ r: SummaryRecords) -> Bool {
        r.longestDistanceKm != nil || r.longestDurationMin != nil || r.fastestPaceMinKm != nil || r.mostCalories != nil || r.highestHR != nil
    }

    @ViewBuilder
    private func recapSection(_ recap: WeeklyRecap) -> some View {
        Section {
            HStack {
                recapTile("\(recap.workouts)", "workouts")
                recapTile(String(format: "%.1f", recap.distanceKm), "km")
                recapTile("\(recap.minutes)", "minutes")
                recapTile("\(recap.activeDays)", "active days")
            }
            Text(recap.shareText)
                .font(.caption)
                .foregroundStyle(.secondary)
            if recap.kudos > 0 || recap.replies > 0 {
                Text("Your community sent \(recap.kudos) kudos and \(recap.replies) replies this week.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Your week in motion")
        } footer: {
            Text("A private recap of the last seven days.")
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func recapTile(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.headline.monospacedDigit())
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func streakSection(_ summary: StatsSummary) -> some View {
        Section {
            HStack {
                VStack(alignment: .leading) {
                    Text("\(summary.streakDays)").font(FFTheme.display(34, weight: .bold, relativeTo: .largeTitle))
                    Text(summary.streakDays == 1 ? "day streak" : "day streak").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing) {
                    Text("\(summary.activeDays)").font(FFTheme.display(34, weight: .bold, relativeTo: .largeTitle))
                    Text("active days").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 6)
        }
        .listRowBackground(FFTheme.parchment1)
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
        .listRowBackground(FFTheme.parchment1)
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
        .listRowBackground(FFTheme.parchment1)
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
        .listRowBackground(FFTheme.parchment1)
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
        .listRowBackground(FFTheme.parchment1)
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
        .listRowBackground(FFTheme.parchment1)
    }

    private func formattedValue(_ r: PersonalRecord) -> String {
        r.value.truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", r.value) : String(format: "%.2f", r.value)
    }
}

private struct GoalComposerView: View {
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var metric = "distance_km"
    @State private var target = ""
    @State private var period = "week"
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let metrics: [(key: String, label: String)] = [
        ("distance_km", "Distance (km)"), ("duration_min", "Time (min)"),
        ("workouts", "Workouts"), ("calories", "Calories"),
    ]
    private let periods = ["week", "month", "year"]

    var body: some View {
        Form {
            Section("Goal") {
                TextField("Title", text: $title)
                Picker("Metric", selection: $metric) {
                    ForEach(metrics, id: \.key) { m in Text(m.label).tag(m.key) }
                }
                TextField("Target", text: $target)
                    .keyboardType(.decimalPad)
                Picker("Period", selection: $period) {
                    ForEach(periods, id: \.self) { p in Text(p.capitalized).tag(p) }
                }
            }
            .listRowBackground(FFTheme.parchment1)
        }
        .ffListChrome()
        .navigationTitle("New Goal")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save() } }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || Double(target) == nil || isSaving)
            }
        }
        .alert("Could not save", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func save() async {
        guard let targetValue = Double(target) else { return }
        isSaving = true
        do {
            try await APIClient.shared.createGoal(
                title: title.trimmingCharacters(in: .whitespaces), metric: metric,
                target: targetValue, period: period, activityType: nil)
            await onCreated()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }
}

#Preview { NavigationStack { StatsView() } }
