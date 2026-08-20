import SwiftUI
import PhotosUI
#if canImport(UIKit)
import UIKit
#endif

struct StoryComposerView: View {
    let onPosted: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var content = ""
    @State private var visibility: StoryAudience = .publicAudience
    @State private var category: PhotoCategory = .workout
    @State private var pickerItem: PhotosPickerItem?
    @State private var previewImage: Image?
    @State private var uploadData: Data?
    @State private var isPreparingPhoto = false
    @State private var isPosting = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section("Share a thought or a photo") {
                TextField("What's on your mind?", text: $content, axis: .vertical)
                    .lineLimit(3...6)
                    .onChange(of: content) { _, value in if value.count > 280 { content = String(value.prefix(280)) } }
                Text("\(content.count)/280 · visible for 24 hours").font(.caption2).foregroundStyle(.secondary)
            }
            Section("Photo") {
                PhotosPicker(selection: $pickerItem, matching: .images) {
                    Label(uploadData == nil ? "Add photo" : "Change photo", systemImage: "photo")
                }
                .onChange(of: pickerItem) { _, item in Task { await prepare(item) } }
                if isPreparingPhoto { ProgressView("Preparing photo…") }
                if let previewImage {
                    previewImage.resizable().scaledToFit().frame(maxHeight: 240).clipShape(RoundedRectangle(cornerRadius: 14))
                    Picker("Photo type", selection: $category) {
                        ForEach(PhotoCategory.allCases) { item in Text(item.label).tag(item) }
                    }
                    Button("Remove photo", role: .destructive) { pickerItem = nil; previewImage = nil; uploadData = nil }
                }
            }
            Section("Who can see this?") {
                Picker("Audience", selection: $visibility) {
                    ForEach(StoryAudience.allCases) { item in Label(item.label, systemImage: item.icon).tag(item) }
                }
                .pickerStyle(.inline)
            }
        }
        .navigationTitle("New moment")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Share") { Task { await post() } }.disabled(!canPost || isPosting)
            }
        }
        .overlay { if isPosting { ProgressView("Sharing…") } }
        .alert("Could not share", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private var canPost: Bool { !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || uploadData != nil }

    private func prepare(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        isPreparingPhoto = true
        defer { isPreparingPhoto = false }
        do {
            guard let source = try await item.loadTransferable(type: Data.self) else { throw ImageUpload.UploadError.invalidImage }
            let prepared = try ImageUpload.prepare(source)
            uploadData = prepared
            #if canImport(UIKit)
            if let image = UIImage(data: prepared) { previewImage = Image(uiImage: image) }
            #endif
        } catch {
            pickerItem = nil; uploadData = nil; previewImage = nil
            errorMessage = error.localizedDescription
        }
    }

    private func post() async {
        guard canPost else { return }
        isPosting = true
        do {
            try await APIClient.shared.postStory(
                content: content.trimmingCharacters(in: .whitespacesAndNewlines),
                photoData: uploadData.map(ImageUpload.dataURL(from:)),
                photoCategory: uploadData == nil ? nil : category.rawValue,
                visibility: visibility.rawValue
            )
            onPosted()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isPosting = false
    }
}

/// Stories support all four of the app's visibility levels, including
/// trusted circle -- matches the server's VISIBILITIES list exactly, unlike
/// the post composer's narrower three-option audience (worth aligning that
/// one too, separately).
private enum StoryAudience: String, CaseIterable, Identifiable {
    case publicAudience = "public", followers, circle, privateAudience = "private"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .publicAudience: return "Everyone"
        case .followers: return "Followers"
        case .circle: return "Trusted circle"
        case .privateAudience: return "Only me"
        }
    }
    var icon: String {
        switch self {
        case .publicAudience: return "globe"
        case .followers: return "person.2"
        case .circle: return "person.2.circle"
        case .privateAudience: return "lock"
        }
    }
}

#Preview { NavigationStack { StoryComposerView { } } }
