import SwiftUI
import PhotosUI
#if canImport(UIKit)
import UIKit
#endif

struct PostComposerView: View {
    let onPublished: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var content = ""
    @State private var audience: PostAudience = .publicAudience
    @State private var category: PhotoCategory = .workout
    @State private var pickerItem: PhotosPickerItem?
    @State private var previewImage: Image?
    @State private var uploadData: Data?
    @State private var photoPolicyAccepted = false
    @State private var isPreparingPhoto = false
    @State private var isPublishing = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            postTextSection
            photoSection
            audienceSection
        }
        .navigationTitle("New post")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Publish") { publish() }
                    .disabled(!canPublish || isPublishing)
            }
        }
        .overlay { if isPublishing { ProgressView("Publishing…") } }
        .alert("Could not publish", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Please try again.")
        }
    }

    private var postTextSection: some View {
        Section("Share encouragement or progress") {
            TextField("What is moving you today?", text: $content, axis: .vertical)
                .lineLimit(4...10)
                .onChange(of: content) { _, value in
                    if value.count > 1000 { content = String(value.prefix(1000)) }
                }
            Text("\(content.count)/1000")
                .font(.caption2).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private var photoSection: some View {
        Section("Photo") {
            PhotosPicker(selection: $pickerItem, matching: .images) {
                Label(uploadData == nil ? "Add fitness photo" : "Change photo", systemImage: "photo")
            }
            .onChange(of: pickerItem) { _, item in
                Task { await prepare(item) }
            }

            if isPreparingPhoto { ProgressView("Preparing photo…") }
            if let previewImage {
                previewImage
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 280)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                Picker("Photo type", selection: $category) {
                    ForEach(PhotoCategory.allCases) { item in Text(item.label).tag(item) }
                }
                Button("Remove photo", role: .destructive, action: removePhoto)
                Text("Choose the closest category. Community posts may show workouts or gear, nature, animals, or groups—use your profile photo for a solo portrait.")
                    .font(.caption).foregroundStyle(.secondary)
                Toggle("I have permission from identifiable people, and this photo serves the community rather than personal promotion.", isOn: $photoPolicyAccepted)
                    .font(.caption)
            }
        }
    }

    private var audienceSection: some View {
        Section("Audience") {
            Picker("Who can see this?", selection: $audience) {
                ForEach(PostAudience.allCases) { item in
                    Label(item.label, systemImage: item.icon).tag(item)
                }
            }
            .pickerStyle(.inline)
        }
    }

    private func removePhoto() {
        pickerItem = nil
        previewImage = nil
        uploadData = nil
        photoPolicyAccepted = false
    }

    private var canPublish: Bool {
        (!content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || uploadData != nil)
            && (uploadData == nil || photoPolicyAccepted)
    }

    private func prepare(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        isPreparingPhoto = true
        defer { isPreparingPhoto = false }
        do {
            guard let source = try await item.loadTransferable(type: Data.self) else {
                throw ImageUpload.UploadError.invalidImage
            }
            let prepared = try ImageUpload.prepare(source)
            uploadData = prepared
            #if canImport(UIKit)
            if let image = UIImage(data: prepared) { previewImage = Image(uiImage: image) }
            #endif
        } catch {
            pickerItem = nil
            uploadData = nil
            previewImage = nil
            photoPolicyAccepted = false
            errorMessage = error.localizedDescription
        }
    }

    private func publish() {
        guard canPublish else { return }
        isPublishing = true
        let text = content.trimmingCharacters(in: .whitespacesAndNewlines)
        let dataURL = uploadData.map(ImageUpload.dataURL(from:))
        Task {
            do {
                _ = try await APIClient.shared.createPost(
                    content: text,
                    visibility: audience.rawValue,
                    photoData: dataURL,
                    photoCategory: uploadData == nil ? nil : category.rawValue
                )
                onPublished()
            } catch {
                errorMessage = error.localizedDescription
            }
            isPublishing = false
        }
    }
}

private enum PostAudience: String, CaseIterable, Identifiable {
    case publicAudience = "public"
    case followers
    case privateAudience = "private"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .publicAudience: return "Everyone"
        case .followers: return "Followers"
        case .privateAudience: return "Only me"
        }
    }
    var icon: String {
        switch self {
        case .publicAudience: return "globe"
        case .followers: return "person.2"
        case .privateAudience: return "lock"
        }
    }
}

#Preview {
    NavigationStack {
        PostComposerView { }
    }
}
