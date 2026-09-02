import SwiftUI
import Charts
import UIKit

private enum StatsQuickLink: Identifiable {
    case intelligence, heatmap, routeBuilder
    var id: Self { self }
}

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
    // A List row holding more than one NavigationLink only ever gets ONE
    // chevron for the whole row, and every tap resolves against it
    // regardless of which tile was actually pressed. Plain Buttons driving
    // one shared navigationDestination(item:) never register as "this row
    // is a nav link" to List, so no chevron gets added to steal a tap.
    @State private var quickLinkDestination: StatsQuickLink?

    var body: some View {
        Group {
            if isLoading && summary == nil {
                ProgressView()
            } else if let summary {
                List {
                    if let recap { recapSection(recap) }
                    quickLinksSection
                    streakSection(summary)
                    totalsSection(summary)
                    goalsSection
                    if !trends.isEmpty { trendsSection }
                    if hasAnyRecord(summary.records) { quickRecordsSection(summary.records) }
                    if !breakdown.isEmpty { breakdownSection }
                    if !records.isEmpty { personalRecordsSection }
                }
                .listRowSpacing(10)
                .ffListChrome()
                .refreshable { await load(forceRefresh: true) }
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
        .navigationDestination(item: $quickLinkDestination) { destination in
            switch destination {
            case .intelligence: AthleteIntelligenceView()
            case .heatmap: HeatmapView()
            case .routeBuilder: RouteBuilderView()
            }
        }
    }

    private func load(forceRefresh: Bool = false) async {
        isLoading = true
        do {
            async let s = APIClient.shared.fetchStatsSummary()
            async let t = APIClient.shared.fetchTrends(forceRefresh: forceRefresh)
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

    private var quickLinksSection: some View {
        Section {
            HStack(spacing: 10) {
                quickLink("Intelligence", icon: "chart.line.uptrend.xyaxis", tint: FFTheme.scripture, target: .intelligence)
                quickLink("Heatmap", icon: "map.fill", tint: FFTheme.hearth, target: .heatmap)
                quickLink("Build route", icon: "point.topleft.down.curvedto.point.bottomright.up.fill", tint: FFTheme.meadow, target: .routeBuilder)
            }
            .padding(.vertical, 2)
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
    }

    private func quickLink(_ title: String, icon: String, tint: Color, target: StatsQuickLink) -> some View {
        Button { quickLinkDestination = target } label: {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 44, height: 44)
                    .background(tint.opacity(0.12), in: Circle())
                Text(title)
                    .font(FFTheme.eyebrow(10.5))
                    .foregroundStyle(FFTheme.ink)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous).stroke(FFTheme.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var goalsSection: some View {
        Section {
            if goals.isEmpty {
                Text("No goals yet.").font(FFTheme.serif(15)).foregroundStyle(FFTheme.inkSoft)
            } else {
                ForEach(goals) { goal in
                    goalRow(goal)
                }
                .onDelete(perform: deleteGoal)
            }
            Button("Add goal") { showGoalComposer = true }
                .font(FFTheme.serifSemibold(15))
        } header: {
            Text("GOALS").font(FFTheme.eyebrow(12)).foregroundStyle(FFTheme.scripture)
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func goalRow(_ goal: TrainingGoal) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(goal.title).font(FFTheme.serifSemibold(15)).foregroundStyle(FFTheme.ink)
                Spacer()
                if goal.completed { Image(systemName: "checkmark.seal.fill").foregroundStyle(FFTheme.emerald) }
            }
            ProgressView(value: Double(goal.percent), total: 100).tint(goal.completed ? FFTheme.emerald : FFTheme.hearth)
            Text("\(goalProgressLabel(goal)) · \(goal.period.capitalized)").font(FFTheme.caption()).foregroundStyle(FFTheme.inkSoft)
        }
        .padding(.vertical, 3)
    }

    private func goalProgressLabel(_ goal: TrainingGoal) -> String {
        switch goal.metric {
        case "distance_km":
            return String(format: "%.1f / %.1f %@", Units.distanceValue(km: goal.progress), Units.distanceValue(km: goal.target), Units.distanceUnitLabel)
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
            HStack(spacing: 0) {
                recapTile("\(recap.workouts)", "workouts")
                recapTile(String(format: "%.1f", Units.distanceValue(km: recap.distanceKm)), Units.distanceUnitLabel)
                recapTile("\(recap.minutes)", "minutes")
                recapTile("\(recap.activeDays)", "active days")
            }
            Text(recap.shareText)
                .font(FFTheme.serifItalic(13))
                .foregroundStyle(FFTheme.inkSoft)
            if recap.kudos > 0 || recap.replies > 0 {
                Text("Your community sent \(recap.kudos) kudos and \(recap.replies) replies this week.")
                    .font(FFTheme.caption())
                    .foregroundStyle(FFTheme.muted)
            }
        } header: {
            Text("YOUR WEEK IN MOTION").font(FFTheme.eyebrow(12)).foregroundStyle(FFTheme.hearth)
        } footer: {
            Text("A private recap of the last seven days.")
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func recapTile(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(FFTheme.display(20, weight: .bold, relativeTo: .title3)).foregroundStyle(FFTheme.ink)
            Text(label).font(FFTheme.caption()).foregroundStyle(FFTheme.inkSoft)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func streakSection(_ summary: StatsSummary) -> some View {
        Section {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                        Image(systemName: "flame.fill").font(.system(size: 20)).foregroundStyle(FFTheme.hearth)
                        Text("\(summary.streakDays)").font(FFTheme.display(34, weight: .bold, relativeTo: .largeTitle)).foregroundStyle(FFTheme.ink)
                    }
                    Text(summary.streakDays == 1 ? "day streak" : "day streak").font(FFTheme.caption()).foregroundStyle(FFTheme.inkSoft)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(summary.activeDays)").font(FFTheme.display(34, weight: .bold, relativeTo: .largeTitle)).foregroundStyle(FFTheme.ink)
                    Text("active days").font(FFTheme.caption()).foregroundStyle(FFTheme.inkSoft)
                }
            }
            .padding(.vertical, 6)
        }
        .listRowBackground(FFTheme.parchment1)
    }

    @ViewBuilder
    private func totalsSection(_ summary: StatsSummary) -> some View {
        Section {
            Picker("Period", selection: periodSelection) {
                Text("Week").tag(0); Text("Month").tag(1); Text("Lifetime").tag(2)
            }.pickerStyle(.segmented)
            let totals = periodTab == 0 ? summary.thisWeek : periodTab == 1 ? summary.thisMonth : summary.lifetime
            HStack {
                statTile("Workouts", "\(totals.workouts)", icon: "figure.run")
                statTile("Distance", Units.distanceString(km: totals.distanceKm, decimals: 1), icon: "location.fill")
            }
            HStack {
                statTile("Time", durationLabel(totals.durationMin), icon: "clock.fill")
                statTile("Calories", "\(totals.calories)", icon: "bolt.fill")
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    /// A light tap tick on every period switch -- small, but it's the same
    /// "the data responded to me" feedback the charts below give, so the
    /// whole page feels consistently alive rather than the charts being an
    /// isolated interactive island.
    private var periodSelection: Binding<Int> {
        Binding(get: { periodTab }, set: { newValue in
            if newValue != periodTab { UISelectionFeedbackGenerator().selectionChanged() }
            periodTab = newValue
        })
    }

    private func statTile(_ title: String, _ value: String, icon: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(FFTheme.meadow)
                .frame(width: 30, height: 30)
                .background(FFTheme.meadow.opacity(0.1), in: Circle())
            VStack(alignment: .leading, spacing: 1) {
                Text(value).font(.system(size: 17, weight: .semibold)).monospacedDigit().foregroundStyle(FFTheme.ink)
                Text(title).font(FFTheme.caption()).foregroundStyle(FFTheme.inkSoft)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func durationLabel(_ minutes: Int) -> String {
        if minutes >= 60 { return "\(minutes / 60)h \(minutes % 60)m" }
        return "\(minutes)m"
    }

    private var trendsSection: some View {
        Section {
            TrendsChart(trends: trends)
        } header: {
            Text("LAST 12 WEEKS").font(FFTheme.eyebrow(12)).foregroundStyle(FFTheme.scripture)
        }
        .listRowBackground(FFTheme.parchment1)
    }

    @ViewBuilder
    private func quickRecordsSection(_ r: SummaryRecords) -> some View {
        Section {
            if let d = r.longestDistanceKm { recordRow("Longest distance", Units.distanceString(km: d)) }
            if let d = r.longestDurationMin { recordRow("Longest session", durationLabel(d)) }
            if let p = r.fastestPaceMinKm { recordRow("Fastest pace", "\(Units.paceString(minutesPerKm: p)) /\(Units.distanceUnitLabel)") }
            if let c = r.mostCalories { recordRow("Most calories", "\(c) kcal") }
            if let h = r.highestHR { recordRow("Highest heart rate", "\(h) bpm") }
        } header: {
            Text("PERSONAL BESTS").font(FFTheme.eyebrow(12)).foregroundStyle(FFTheme.hearth)
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func recordRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(FFTheme.serif(15)).foregroundStyle(FFTheme.ink)
            Spacer()
            Text(value).font(.system(size: 15, weight: .semibold)).monospacedDigit().foregroundStyle(FFTheme.inkSoft)
        }
    }

    private var breakdownSection: some View {
        Section {
            BreakdownChart(entries: breakdown)
        } header: {
            Text("ACTIVITY BREAKDOWN").font(FFTheme.eyebrow(12)).foregroundStyle(FFTheme.scripture)
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private var personalRecordsSection: some View {
        Section {
            ForEach(records.keys.sorted(), id: \.self) { type in
                DisclosureGroup(type) {
                    ForEach(records[type] ?? []) { rec in
                        HStack {
                            Text(rec.label).font(FFTheme.serif(14)).foregroundStyle(FFTheme.ink)
                            Spacer()
                            Text("\(formattedValue(rec)) \(rec.unit)").font(.system(size: 14, weight: .medium)).monospacedDigit().foregroundStyle(FFTheme.inkSoft)
                        }
                    }
                }
                .font(FFTheme.serifSemibold(15))
                .tint(FFTheme.ink)
            }
        } header: {
            Text("RECORDS BY ACTIVITY").font(FFTheme.eyebrow(12)).foregroundStyle(FFTheme.hearth)
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func formattedValue(_ r: PersonalRecord) -> String {
        r.value.truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", r.value) : String(format: "%.2f", r.value)
    }
}

// MARK: - Interactive, haptic-driven charts
//
// Both charts below share the same idea: dragging a finger across the plot
// scrubs a highlighted point, firing a light selection "tick" each time the
// nearest data point changes (the same feel as Apple's own Health and Stocks
// charts) and surfacing the exact value in a callout instead of making
// someone squint at an axis. This is the literal ask -- "haptic feedback
// from graphs" -- not a cosmetic add-on.

private struct TrendsChart: View {
    let trends: [TrendPoint]
    @State private var selected: TrendPoint?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Chart(trends) { point in
                AreaMark(x: .value("Week", point.label), y: .value("Distance", point.distanceKm))
                    .foregroundStyle(LinearGradient(colors: [FFTheme.meadow.opacity(0.32), FFTheme.meadow.opacity(0)], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.catmullRom)
                LineMark(x: .value("Week", point.label), y: .value("Distance", point.distanceKm))
                    .foregroundStyle(FFTheme.meadow)
                    .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.catmullRom)
                if let selected, selected.id == point.id {
                    PointMark(x: .value("Week", point.label), y: .value("Distance", point.distanceKm))
                        .foregroundStyle(FFTheme.meadowDeep)
                        .symbolSize(90)
                    RuleMark(x: .value("Week", point.label))
                        .foregroundStyle(FFTheme.ink.opacity(0.18))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                }
            }
            .frame(height: 170)
            .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) { AxisValueLabel().font(FFTheme.caption()) } }
            .chartYAxis { AxisMarks { AxisValueLabel().font(FFTheme.caption()) } }
            .chartOverlay { proxy in
                GeometryReader { geometry in
                    Rectangle().fill(.clear).contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 0)
                                .onChanged { drag in scrub(to: drag.location, proxy: proxy, geometry: geometry) }
                                .onEnded { _ in
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.6)
                                    withAnimation(.easeOut(duration: 0.25)) { selected = nil }
                                }
                        )
                }
            }

            Group {
                if let selected {
                    HStack {
                        Text(selected.label).font(FFTheme.serifSemibold(13)).foregroundStyle(FFTheme.ink)
                        Spacer()
                        Text(Units.distanceString(km: selected.distanceKm, decimals: 1)).font(.system(size: 14, weight: .bold)).monospacedDigit().foregroundStyle(FFTheme.meadowDeep)
                        Text("· \(selected.workouts) workout\(selected.workouts == 1 ? "" : "s")").font(FFTheme.caption()).foregroundStyle(FFTheme.inkSoft)
                    }
                } else {
                    Text("Touch and drag to inspect a week").font(FFTheme.caption()).foregroundStyle(FFTheme.muted)
                }
            }
            .frame(height: 16)
        }
    }

    private func scrub(to location: CGPoint, proxy: ChartProxy, geometry: GeometryProxy) {
        guard let plotAnchor = proxy.plotFrame else { return }
        let plotFrame = geometry[plotAnchor]
        let xPosition = location.x - plotFrame.origin.x
        guard xPosition >= 0, xPosition <= plotFrame.width,
              let label: String = proxy.value(atX: xPosition),
              let point = trends.first(where: { $0.label == label }) else { return }
        if selected?.id != point.id {
            selected = point
            UISelectionFeedbackGenerator().selectionChanged()
        }
    }
}

private struct BreakdownChart: View {
    let entries: [ActivityBreakdownEntry]
    @State private var selected: ActivityBreakdownEntry?

    private static let palette: [Color] = [FFTheme.meadow, FFTheme.hearth, FFTheme.scripture, FFTheme.gold, FFTheme.seal]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Chart(Array(entries.enumerated()), id: \.element.id) { index, entry in
                BarMark(x: .value("Distance", entry.distanceKm), y: .value("Type", entry.type))
                    .foregroundStyle(Self.palette[index % Self.palette.count].opacity(selected == nil || selected?.id == entry.id ? 1 : 0.35))
                    .cornerRadius(6)
            }
            .frame(height: CGFloat(entries.count) * 34 + 16)
            .chartXAxis { AxisMarks { AxisValueLabel().font(FFTheme.caption()) } }
            .chartYAxis { AxisMarks { AxisValueLabel().font(FFTheme.serifSemibold(12)) } }
            .chartOverlay { proxy in
                GeometryReader { geometry in
                    Rectangle().fill(.clear).contentShape(Rectangle())
                        .gesture(
                            // minimumDistance 0 means a plain tap already fires
                            // onChanged once at the touch-down location, so a
                            // tap and a drag-to-scrub both work through this
                            // one gesture -- no separate tap recognizer needed.
                            DragGesture(minimumDistance: 0)
                                .onChanged { drag in select(at: drag.location, proxy: proxy, geometry: geometry) }
                        )
                }
            }

            Group {
                if let selected {
                    HStack {
                        Text(selected.type).font(FFTheme.serifSemibold(13)).foregroundStyle(FFTheme.ink)
                        Spacer()
                        Text("\(selected.count) · \(Units.distanceString(km: selected.distanceKm, decimals: 1)) · \(selected.calories) kcal")
                            .font(FFTheme.caption()).foregroundStyle(FFTheme.inkSoft)
                    }
                } else {
                    Text("Tap a bar for the exact numbers").font(FFTheme.caption()).foregroundStyle(FFTheme.muted)
                }
            }
            .frame(height: 16)
        }
    }

    private func select(at location: CGPoint, proxy: ChartProxy, geometry: GeometryProxy) {
        guard let plotAnchor = proxy.plotFrame else { return }
        let plotFrame = geometry[plotAnchor]
        let yPosition = location.y - plotFrame.origin.y
        guard yPosition >= 0, yPosition <= plotFrame.height,
              let type: String = proxy.value(atY: yPosition),
              let entry = entries.first(where: { $0.type == type }) else { return }
        if selected?.id != entry.id {
            selected = entry
            UISelectionFeedbackGenerator().selectionChanged()
        }
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
        ("distance_km", "Distance (\(Units.distanceUnitLabel))"), ("duration_min", "Time (min)"),
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
            // The server always stores/compares this metric in km (see
            // goalProgressLabel's "distance_km" case) -- a member typing a
            // target in miles must have it converted back before it's saved,
            // or the label would say "mi" while the stored goal quietly
            // meant km.
            let storedTarget = metric == "distance_km" && Units.isImperial ? targetValue / 0.621371 : targetValue
            try await APIClient.shared.createGoal(
                title: title.trimmingCharacters(in: .whitespaces), metric: metric,
                target: storedTarget, period: period, activityType: nil)
            await onCreated()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }
}

#Preview { NavigationStack { StatsView() } }
