import SwiftUI

/// Covers the fields most worth editing from a phone: username, bio verse,
/// job, church, tradition. Deliberately NOT ported here: avatar upload,
/// bio link, fitness group/gym, age, heart-rate reference figures,
/// location-based church search -- each is its own real feature (photo
/// picker + validation, a second free-text field, etc.), not a one-line
/// addition to this form. Worth a dedicated pass later.
struct EditProfileView: View {
    let profile: UserProfile
    let onSaved: (UserProfile) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var displayName: String
    @State private var bioVerseRef: String
    @State private var job: String
    @State private var church: String
    @State private var tradition: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    @State private var usernameStatus: UsernameCheckResult?
    @State private var isCheckingUsername = false
    @State private var usernameCheckTask: Task<Void, Never>?
    // Bumped on every new check; a check only applies its result if its own
    // sequence number is still the latest one issued when it completes --
    // matches the web form's own out-of-order-response guard (a slow first
    // keystroke's response landing after a fast later one would otherwise
    // show a stale, wrong verdict).
    @State private var usernameCheckSequence = 0

    private let traditions = [
        ("", "Prefer not to say"), ("evangelical", "Evangelical"), ("catholic", "Catholic"),
        ("mainline", "Mainline Protestant"), ("not_faith_specific", "Not faith-specific"),
    ]

    init(profile: UserProfile, onSaved: @escaping (UserProfile) -> Void) {
        self.profile = profile
        self.onSaved = onSaved
        _displayName = State(initialValue: profile.displayName)
        _bioVerseRef = State(initialValue: profile.bio ?? "")
        _job = State(initialValue: profile.job ?? "")
        _church = State(initialValue: profile.church ?? "")
        _tradition = State(initialValue: profile.tradition ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Username", text: $displayName)
                        .textInputAutocapitalization(.words)
                        .onChange(of: displayName) { _, newValue in scheduleUsernameCheck(newValue) }
                    usernameStatusView
                } header: { Text("Username") } footer: { Text("How people find and mention you. No two members can share one.") }

                Section {
                    TextField("e.g. Philippians 4:13", text: $bioVerseRef)
                } header: { Text("Bio verse") } footer: { Text("Must match a verse in the verified library -- \"Book Chapter:Verse\", e.g. \"Philippians 4:13\". Leave blank to clear it.") }

                Section("Job") { TextField("e.g. Nurse", text: $job) }
                Section("Church") { TextField("e.g. Grace Community Church", text: $church) }

                Section {
                    Picker("Tradition", selection: $tradition) {
                        ForEach(traditions, id: \.0) { value, label in Text(label).tag(value) }
                    }
                } footer: {
                    Text("Shapes how scripture is chosen for you mid-workout and how the companion answers your questions. Left blank, nothing is assumed.")
                }
            }
            .navigationTitle("Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving { ProgressView() } else { Button("Save") { Task { await save() } }.disabled(!canSave) }
                }
            }
            .alert("Could not save", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
        }
    }

    private var canSave: Bool {
        !displayName.trimmingCharacters(in: .whitespaces).isEmpty && usernameStatus?.available != false
    }

    @ViewBuilder
    private var usernameStatusView: some View {
        if isCheckingUsername {
            Text("Checking…").font(.caption).foregroundStyle(.secondary)
        } else if let status = usernameStatus {
            if status.available {
                if displayName != profile.displayName {
                    Label("Available", systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(.green)
                }
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Label(status.message ?? "That name is taken.", systemImage: "xmark.circle.fill")
                        .font(.caption).foregroundStyle(.red)
                    if let suggestion = status.suggestion {
                        Button("Use \"\(suggestion)\" instead") { displayName = suggestion; scheduleUsernameCheck(suggestion) }
                            .font(.caption)
                    }
                }
            }
        }
    }

    private func scheduleUsernameCheck(_ name: String) {
        usernameCheckTask?.cancel()
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed != profile.displayName else { usernameStatus = nil; isCheckingUsername = false; return }
        usernameCheckSequence += 1
        let sequence = usernameCheckSequence
        isCheckingUsername = true
        usernameCheckTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000) // 350ms debounce, matches the web form's own pacing
            guard !Task.isCancelled else { return }
            let result = try? await APIClient.shared.checkUsernameAvailable(trimmed)
            guard sequence == usernameCheckSequence else { return } // a newer check superseded this one
            usernameStatus = result
            isCheckingUsername = false
        }
    }

    private func save() async {
        isSaving = true
        do {
            try await APIClient.shared.updateProfile(
                displayName: displayName.trimmingCharacters(in: .whitespaces),
                bioVerseRef: bioVerseRef.trimmingCharacters(in: .whitespaces),
                job: job.trimmingCharacters(in: .whitespaces),
                church: church.trimmingCharacters(in: .whitespaces),
                tradition: tradition
            )
            let fresh = try await APIClient.shared.fetchProfile()
            onSaved(fresh)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }
}

#Preview {
    EditProfileView(profile: MockData.profile) { _ in }
}
