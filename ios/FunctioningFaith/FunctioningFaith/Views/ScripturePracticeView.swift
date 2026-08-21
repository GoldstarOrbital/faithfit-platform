import SwiftUI

/// Deliberately not a streak/ranking/social score -- matches the server's
/// own comment on lib/scripture-practice.js. One quiet day unlocks at a
/// time; a private note is optional.
struct ScripturePracticeView: View {
    @State private var state: ScripturePracticeState?
    @State private var isLoading = true
    @State private var isSubmitting = false
    @State private var noteDraft = ""
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && state == nil {
                ProgressView()
            } else if let state {
                List {
                    headerSection(state)
                    if state.started {
                        daysSection(state)
                    }
                }
                .ffListChrome()
            }
        }
        .navigationTitle("Scripture Practice")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    @ViewBuilder
    private func headerSection(_ state: ScripturePracticeState) -> some View {
        Section {
            Text(state.plan.title).font(.title3.weight(.semibold))
            Text(state.plan.subtitle).font(.subheadline).foregroundStyle(.secondary)
            if !state.started {
                Button("Start this week") { Task { await start() } }
                    .buttonStyle(.ffPrimary)
                    .disabled(isSubmitting)
            } else if state.complete {
                Label("You completed all \(state.plan.totalDays) days", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(FFTheme.emerald)
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    private func daysSection(_ state: ScripturePracticeState) -> some View {
        Section("Days") {
            ForEach(state.days) { day in
                dayRow(day)
            }
        }
        .listRowBackground(FFTheme.parchment1)
    }

    // Kept as its own method (not inlined into daysSection's ForEach) so
    // each day's body stays a small, independently-typed chunk -- the same
    // defensive split used elsewhere in this app after SwiftUI's
    // type-checker choked on a few large, deeply-nested view bodies.
    @ViewBuilder
    private func dayRow(_ day: ScripturePracticeDay) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: day.completed ? "checkmark.circle.fill" : (day.available ? "circle" : "lock"))
                    .foregroundStyle(day.completed ? FFTheme.emerald : (day.available ? .accentColor : .secondary))
                Text("Day \(day.number) · \(day.focus)").font(.headline)
            }
            if day.available || day.completed {
                if let verse = day.verse {
                    Text(verse.text).font(FFTheme.serif())
                    Text(verse.reference).font(.caption).foregroundStyle(.secondary)
                }
                Text(day.prompt).font(.subheadline).foregroundStyle(.secondary)
                if day.completed {
                    if !day.note.isEmpty {
                        Text("Your note: \(day.note)").font(.caption).italic()
                    }
                } else {
                    TextField("A private note (optional)", text: $noteDraft, axis: .vertical)
                        .lineLimit(2...4)
                    Button("Mark complete") {
                        Task { await complete(day.number) }
                    }
                    .buttonStyle(.ffGhost)
                    .disabled(isSubmitting)
                }
            } else {
                Text("Unlocks once today's day is complete").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        isLoading = true
        do { state = try await APIClient.shared.fetchScripturePractice() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func start() async {
        isSubmitting = true
        do { state = try await APIClient.shared.startScripturePractice() }
        catch { errorMessage = error.localizedDescription }
        isSubmitting = false
    }

    private func complete(_ day: Int) async {
        isSubmitting = true
        do {
            let note = noteDraft
            state = try await APIClient.shared.completeScripturePracticeDay(day, note: note.isEmpty ? nil : note)
            noteDraft = ""
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }
}

#Preview { NavigationStack { ScripturePracticeView() } }
