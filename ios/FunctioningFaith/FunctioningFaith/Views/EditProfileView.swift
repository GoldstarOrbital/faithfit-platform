import SwiftUI
import PhotosUI
#if canImport(UIKit)
import UIKit
#endif

/// Covers the fields most worth editing from a phone: profile photo, username,
/// bio verse, job, church, and tradition. Images use the shared compression
/// policy so the native picker honors the same server limits as the web app.
struct EditProfileView: View {
    let profile: UserProfile
    let onSaved: (UserProfile) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var displayName: String
    @State private var bioVerseRef: String
    @State private var job: String
    @State private var church: String
    @State private var tradition: String
    @State private var linkedInURL: String
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var avatarPickerItem: PhotosPickerItem?
    @State private var avatarPreview: Image?
    @State private var avatarData: Data?
    @State private var isPreparingAvatar = false

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
        _linkedInURL = State(initialValue: profile.bioLinkURL ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                profilePhotoSection
                Section {
                    TextField("Username", text: $displayName)
                        .textInputAutocapitalization(.words)
                        .onChange(of: displayName) { _, newValue in scheduleUsernameCheck(newValue) }
                    usernameStatusView
                } header: { Text("Username") } footer: { Text("How people find and mention you. No two members can share one.") }
                .listRowBackground(FFTheme.parchment1)

                Section {
                    TextField("e.g. Philippians 4:13", text: $bioVerseRef)
                } header: { Text("Bio verse") } footer: { Text("Must match a verse in the verified library -- \"Book Chapter:Verse\", e.g. \"Philippians 4:13\". Leave blank to clear it.") }
                .listRowBackground(FFTheme.parchment1)

                Section("Job") { TextField("e.g. Nurse", text: $job) }
                    .listRowBackground(FFTheme.parchment1)
                Section("Church") { TextField("e.g. Grace Community Church", text: $church) }
                    .listRowBackground(FFTheme.parchment1)

                Section {
                    TextField("https://www.linkedin.com/in/you", text: $linkedInURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: { Text("LinkedIn") } footer: { Text("Shown on your profile as a tappable link. Leave blank to remove it.") }
                .listRowBackground(FFTheme.parchment1)

                Section {
                    Picker("Tradition", selection: $tradition) {
                        ForEach(traditions, id: \.0) { value, label in Text(label).tag(value) }
                    }
                } footer: {
                    Text("Shapes how scripture is chosen for you mid-workout and how the companion answers your questions. Left blank, nothing is assumed.")
                }
                .listRowBackground(FFTheme.parchment1)
            }
            .ffListChrome()
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
            .task {
                guard avatarPreview == nil,
                      let dataURL = try? await APIClient.shared.fetchAvatarData(userID: profile.id) else { return }
                #if canImport(UIKit)
                if let image = ImageUpload.decode(dataURL) { avatarPreview = Image(uiImage: image) }
                #endif
            }
        }
    }

    private var canSave: Bool {
        !displayName.trimmingCharacters(in: .whitespaces).isEmpty && usernameStatus?.available != false
    }

    @ViewBuilder
    private var profilePhotoSection: some View {
        Section("Profile photo") {
            HStack(spacing: 14) {
                Group {
                    if let avatarPreview {
                        avatarPreview.resizable().scaledToFill()
                    } else {
                        Image(systemName: "person.crop.circle.fill")
                            .resizable().scaledToFit().padding(9).foregroundStyle(FFTheme.meadow)
                    }
                }
                .frame(width: 68, height: 68)
                .background(FFTheme.parchment2, in: Circle())
                .clipShape(Circle())

                PhotosPicker(selection: $avatarPickerItem, matching: .images) {
                    Label(avatarData == nil ? "Add profile photo" : "Change profile photo", systemImage: "photo")
                }
                .onChange(of: avatarPickerItem) { _, item in
                    Task { await prepareAvatar(item) }
                }
            }
            if isPreparingAvatar { ProgressView("Preparing photo…") }
            Text("Use a clear, appropriate photo that helps people recognize you in groups and messages.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .listRowBackground(FFTheme.parchment1)
    }

    @ViewBuilder
    private var usernameStatusView: some View {
        if isCheckingUsername {
            Text("Checking…").font(.caption).foregroundStyle(.secondary)
        } else if let status = usernameStatus {
            if status.available {
                if displayName != profile.displayName {
                    Label("Available", systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(FFTheme.emerald)
                }
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Label(status.message ?? "That name is taken.", systemImage: "xmark.circle.fill")
                        .font(.caption).foregroundStyle(FFTheme.seal)
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

    private func prepareAvatar(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        isPreparingAvatar = true
        defer { isPreparingAvatar = false }
        do {
            guard let source = try await item.loadTransferable(type: Data.self) else {
                throw ImageUpload.UploadError.invalidImage
            }
            let prepared = try ImageUpload.prepare(source)
            avatarData = prepared
            #if canImport(UIKit)
            if let image = UIImage(data: prepared) { avatarPreview = Image(uiImage: image) }
            #endif
        } catch {
            avatarPickerItem = nil
            avatarData = nil
            avatarPreview = nil
            errorMessage = error.localizedDescription
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
                tradition: tradition,
                bioLinkURL: linkedInURL.trimmingCharacters(in: .whitespaces),
                avatarData: avatarData.map(ImageUpload.dataURL(from:))
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
