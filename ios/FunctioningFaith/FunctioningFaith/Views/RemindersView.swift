import SwiftUI

struct RemindersView: View {
    @State private var reminders: [UserReminder] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showCompose = false

    var body: some View {
        Group {
            if isLoading && reminders.isEmpty {
                ProgressView()
            } else if reminders.isEmpty {
                ContentUnavailableView("No reminders", systemImage: "bell.badge",
                                        description: Text("Create one to get a nudge at a time that works for you."))
            } else {
                List {
                    ForEach(reminders) { reminder in
                        reminderRow(reminder)
                    }
                    .onDelete(perform: delete)
                }
                .ffListChrome()
            }
        }
        .navigationTitle("Reminders")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showCompose = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New reminder")
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showCompose) {
            NavigationStack {
                ReminderComposerView { await load() }
            }
        }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func reminderRow(_ reminder: UserReminder) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(reminder.title).font(.headline)
                Text(reminder.body).font(.caption).foregroundStyle(.secondary)
                Text(scheduleLabel(reminder)).font(.caption2).foregroundStyle(.tint)
            }
            Spacer()
            Toggle("", isOn: Binding(
                get: { reminder.isEnabled },
                set: { newValue in Task { await toggle(reminder, enabled: newValue) } }
            ))
            .labelsHidden()
        }
        .padding(.vertical, 3)
    }

    private func scheduleLabel(_ reminder: UserReminder) -> String {
        let repeatText = reminder.repeatRule == "once" ? "" : " · \(reminder.repeatRule.capitalized)"
        guard let date = Self.parseDate(reminder.scheduledAt) else { return reminder.scheduledAt + repeatText }
        return date.formatted(date: .abbreviated, time: .shortened) + repeatText
    }

    private static func parseDate(_ s: String) -> Date? {
        if let d = ISO8601DateFormatter().date(from: s) { return d }
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.date(from: s)
    }

    private func load() async {
        isLoading = true
        do { reminders = try await APIClient.shared.fetchReminders() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func toggle(_ reminder: UserReminder, enabled: Bool) async {
        do {
            let updated = try await APIClient.shared.setReminderEnabled(id: reminder.id, enabled: enabled)
            if let idx = reminders.firstIndex(where: { $0.id == reminder.id }) { reminders[idx] = updated }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete(at offsets: IndexSet) {
        let toRemove = offsets.map { reminders[$0] }
        reminders.remove(atOffsets: offsets)
        Task {
            for reminder in toRemove {
                try? await APIClient.shared.deleteReminder(id: reminder.id)
            }
        }
    }
}

struct ReminderComposerView: View {
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var message = ""
    @State private var scheduledAt = Date().addingTimeInterval(3600)
    @State private var repeatRule = "once"
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section("Reminder") {
                TextField("Title", text: $title)
                TextField("Message", text: $message, axis: .vertical)
                    .lineLimit(2...4)
            }
            .listRowBackground(FFTheme.parchment1)
            Section("When") {
                DatePicker("Time", selection: $scheduledAt, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                Picker("Repeat", selection: $repeatRule) {
                    Text("Once").tag("once")
                    Text("Daily").tag("daily")
                    Text("Weekly").tag("weekly")
                }
            }
            .listRowBackground(FFTheme.parchment1)
        }
        .ffListChrome()
        .navigationTitle("New Reminder")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save() } }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty
                              || message.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
            }
        }
        .alert("Could not save", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func save() async {
        isSaving = true
        do {
            try await APIClient.shared.createReminder(
                title: title.trimmingCharacters(in: .whitespaces),
                body: message.trimmingCharacters(in: .whitespaces),
                scheduledAt: scheduledAt,
                repeatRule: repeatRule
            )
            await onCreated()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }
}

#Preview { NavigationStack { RemindersView() } }
