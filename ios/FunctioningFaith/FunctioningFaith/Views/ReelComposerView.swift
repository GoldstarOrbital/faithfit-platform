import SwiftUI
import PhotosUI
import AVFoundation
import AVKit
import UniformTypeIdentifiers

/// Member Reel studio — mirrors web `openReelStudio` criteria:
/// - MP4 and Apple's QuickTime .mov are playable on iOS (WebM can be hosted
///   for web viewers but cannot be played by AVFoundation)
/// - ≤ 10MB, ≤ 60 seconds
/// - Category: workout / nature / animal / group (never solo vanity)
/// - Caption required (server pairs verified Scripture)
/// - Rights + community-purpose attestation
struct ReelComposerView: View {
    let onPublished: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var caption = ""
    @State private var category: PhotoCategory = .workout
    @State private var pickerItem: PhotosPickerItem?
    @State private var videoDataURL: String?
    @State private var previewURL: URL?
    @State private var sourceAspectRatio: CGFloat = 9.0 / 16.0
    @State private var cropZoom: Double = 1
    @State private var cropPosition: Double = 0
    @State private var fileLabel: String?
    @State private var durationSec: Double?
    @State private var byteCount: Int?
    @State private var attested = false
    @State private var isPreparing = false
    @State private var isPublishing = false
    @State private var statusMessage: String?
    @State private var errorMessage: String?

    private static let maxBytes = 10 * 1024 * 1024
    private static let maxSeconds: Double = 60

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Up to 60 seconds and 10MB. Show a workout, nature, animals, or a group — never a solo vanity clip. Every Reel is paired with verified Scripture.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Section("Video") {
                    PhotosPicker(selection: $pickerItem, matching: .videos) {
                        Label(videoDataURL == nil ? "Choose video from library" : "Change video", systemImage: "video.badge.plus")
                    }
                    .onChange(of: pickerItem) { _, item in
                        Task { await prepare(item) }
                    }

                    if isPreparing {
                        ProgressView("Preparing your Reel…")
                    }

                    if let fileLabel {
                        LabeledContent("File", value: fileLabel)
                    }
                    if let durationSec {
                        LabeledContent("Duration", value: String(format: "%.0f s", durationSec))
                    }
                    if let byteCount {
                        LabeledContent("Size", value: String(format: "%.1f MB", Double(byteCount) / 1_048_576))
                    }

                    if previewURL != nil {
                        Button("Remove video", role: .destructive, action: clearVideo)
                    }
                }

                if let previewURL {
                    Section("Preview and framing") {
                        ReelCropPreview(
                            url: previewURL,
                            sourceAspectRatio: sourceAspectRatio,
                            zoom: cropZoom,
                            position: cropPosition
                        )
                        .frame(maxWidth: .infinity)
                        .aspectRatio(9.0 / 16.0, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                        VStack(alignment: .leading) {
                            Text("Zoom").font(.caption).foregroundStyle(.secondary)
                            Slider(value: $cropZoom, in: 1...1.5, step: 0.01)
                        }
                        VStack(alignment: .leading) {
                            Text(sourceAspectRatio > 9.0 / 16.0 ? "Horizontal position" : "Vertical position")
                                .font(.caption).foregroundStyle(.secondary)
                            Slider(value: $cropPosition, in: -1...1, step: 0.01)
                        }
                        Text("This 9:16 preview is the exact framing exported to Functioning Faith.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section("Caption") {
                    TextField("What encouragement or lesson does this offer?", text: $caption, axis: .vertical)
                        .lineLimit(3...6)
                    Text("A short caption helps match verified Scripture thoughtfully.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("What’s in the clip?") {
                    Picker("Category", selection: $category) {
                        ForEach(PhotoCategory.allCases) { item in
                            Text(item.label).tag(item)
                        }
                    }
                    .pickerStyle(.inline)
                    Text("Same anti-vanity rule as photos: workout/gear, nature, animals, or groups of people — not a single-person clip.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Toggle(isOn: $attested) {
                        Text("I have the rights to share this, it serves the community, and it is not a solo vanity clip.")
                            .font(.caption)
                    }
                }

                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Create a Reel")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Publish") { Task { await publish() } }
                        .disabled(!canPublish || isPublishing || isPreparing)
                }
            }
            .overlay {
                if isPublishing {
                    ZStack {
                        Color.black.opacity(0.15).ignoresSafeArea()
                        ProgressView("Matching Scripture and publishing…")
                            .padding()
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
            .alert("Could not publish", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "Please try again.")
            }
            .onDisappear { clearTempFiles() }
        }
    }

    private var canPublish: Bool {
        previewURL != nil
            && !caption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && attested
            && !isPreparing
    }

    private func clearVideo() {
        clearTempFiles()
        pickerItem = nil
        videoDataURL = nil
        previewURL = nil
        fileLabel = nil
        durationSec = nil
        byteCount = nil
        statusMessage = nil
        cropZoom = 1
        cropPosition = 0
        sourceAspectRatio = 9.0 / 16.0
    }

    private func clearTempFiles() {
        if let previewURL {
            try? FileManager.default.removeItem(at: previewURL)
        }
    }

    private func prepare(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        isPreparing = true
        statusMessage = nil
        errorMessage = nil
        defer { isPreparing = false }

        do {
            guard let movie = try await item.loadTransferable(type: ReelMovieFile.self) else {
                statusMessage = "Could not read that video. Choose an MP4 or MOV under 10MB."
                return
            }
            let url = movie.url
            let asset = AVURLAsset(url: url)
            let duration = try await asset.load(.duration)
            let seconds = CMTimeGetSeconds(duration)
            guard seconds.isFinite, seconds > 0 else {
                statusMessage = "That video has no readable duration."
                try? FileManager.default.removeItem(at: url)
                clearTempFiles()
                return
            }
            if seconds > Self.maxSeconds {
                statusMessage = "Keep the Reel under 60 seconds — trim it and try again."
                try? FileManager.default.removeItem(at: url)
                clearTempFiles()
                return
            }

            guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
                statusMessage = "That video does not contain a readable picture track."
                try? FileManager.default.removeItem(at: url)
                clearTempFiles()
                return
            }
            let naturalSize = try await videoTrack.load(.naturalSize)
            let preferredTransform = try await videoTrack.load(.preferredTransform)
            let orientedRect = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
            let orientedSize = CGSize(width: abs(orientedRect.width), height: abs(orientedRect.height))
            guard orientedSize.width > 0, orientedSize.height > 0 else {
                statusMessage = "That video has an invalid frame size."
                try? FileManager.default.removeItem(at: url)
                clearTempFiles()
                return
            }

            statusMessage = "Compressing your Reel…"
            let uploadURL = try await compressedVideoURL(from: url, zoom: 1, position: 0)
            let data = try Data(contentsOf: uploadURL)
            try? FileManager.default.removeItem(at: uploadURL)
            if data.count > Self.maxBytes {
                statusMessage = "That Reel is still over 10MB after compression. Trim it or record a shorter clip."
                try? FileManager.default.removeItem(at: url)
                clearTempFiles()
                return
            }

            // AVFoundation exports H.264/AAC MP4, the common iOS/web playback
            // format. This deliberately avoids uploading a camera original.
            let mime = "video/mp4"

            let base64 = data.base64EncodedString()
            let dataURL = "data:\(mime);base64,\(base64)"
            if dataURL.count > (Self.maxBytes / 3) * 4 + 64 {
                statusMessage = "Keep the Reel under 10MB."
                try? FileManager.default.removeItem(at: url)
                clearTempFiles()
                return
            }

            await MainActor.run {
                clearTempFiles()
                previewURL = url
                sourceAspectRatio = orientedSize.width / orientedSize.height
                videoDataURL = dataURL
                durationSec = seconds
                byteCount = data.count
                fileLabel = uploadURL.lastPathComponent
                statusMessage = "Ready to publish. Video compressed for fast playback."
            }
        } catch {
            statusMessage = "Could not prepare that video. Use an MP4 or MOV under 10MB and 60 seconds."
            clearTempFiles()
        }
    }

    /// Produces a modest H.264 MP4 before any member Reel leaves the device.
    /// The export is asynchronous so Photos selection never blocks SwiftUI.
    private func compressedVideoURL(from sourceURL: URL, zoom: Double, position: Double) async throws -> URL {
        let asset = AVURLAsset(url: sourceURL)
        guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetMediumQuality)
                ?? AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetLowQuality) else {
            throw ReelCompressionError.unavailable
        }
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("ff-reel-upload-\(UUID().uuidString)")
            .appendingPathExtension("mp4")
        exporter.outputURL = destination
        exporter.outputFileType = .mp4
        exporter.shouldOptimizeForNetworkUse = true

        guard let track = try await asset.loadTracks(withMediaType: .video).first else {
            throw ReelCompressionError.failed
        }
        let naturalSize = try await track.load(.naturalSize)
        let preferredTransform = try await track.load(.preferredTransform)
        let duration = try await asset.load(.duration)
        let composition = AVMutableVideoComposition()
        composition.renderSize = CGSize(width: 720, height: 1280)
        composition.frameDuration = CMTime(value: 1, timescale: 30)
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
        layerInstruction.setTransform(
            ReelCropMath.transform(
                sourceSize: naturalSize,
                preferredTransform: preferredTransform,
                renderSize: composition.renderSize,
                zoom: zoom,
                position: position
            ),
            at: .zero
        )
        instruction.layerInstructions = [layerInstruction]
        composition.instructions = [instruction]
        exporter.videoComposition = composition
        await withCheckedContinuation { continuation in
            exporter.exportAsynchronously { continuation.resume() }
        }
        guard exporter.status == .completed else {
            try? FileManager.default.removeItem(at: destination)
            throw exporter.error ?? ReelCompressionError.failed
        }
        return destination
    }

    private func publish() async {
        guard let previewURL else { return }
        let trimmed = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, attested else { return }
        isPublishing = true
        statusMessage = "Matching verified Scripture and publishing…"
        defer { isPublishing = false }
        do {
            let uploadURL = try await compressedVideoURL(from: previewURL, zoom: cropZoom, position: cropPosition)
            defer { try? FileManager.default.removeItem(at: uploadURL) }
            let data = try Data(contentsOf: uploadURL)
            guard data.count <= Self.maxBytes else { throw ReelCompressionError.tooLarge }
            let videoDataURL = "data:video/mp4;base64,\(data.base64EncodedString())"
            _ = try await APIClient.shared.publishReel(
                caption: trimmed,
                videoDataURL: videoDataURL,
                category: category.rawValue
            )
            onPublished()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            statusMessage = nil
        }
    }
}

private enum ReelCompressionError: LocalizedError {
    case unavailable, failed, tooLarge
    var errorDescription: String? {
        switch self {
        case .unavailable: return "This video cannot be compressed on this device."
        case .failed: return "This video could not be compressed."
        case .tooLarge: return "That framing is over 10MB after compression. Shorten the video and try again."
        }
    }
}

/// Shared, deterministic crop geometry so the preview controls and exporter
/// use a single 9:16 contract. `position` travels only along the axis that has
/// overflow after aspect-fill, and is clamped so no black edge can enter.
enum ReelCropMath {
    static func transform(
        sourceSize: CGSize,
        preferredTransform: CGAffineTransform,
        renderSize: CGSize,
        zoom: Double,
        position: Double
    ) -> CGAffineTransform {
        let orientedRect = CGRect(origin: .zero, size: sourceSize).applying(preferredTransform)
        let orientedSize = CGSize(width: abs(orientedRect.width), height: abs(orientedRect.height))
        guard orientedSize.width > 0, orientedSize.height > 0 else { return preferredTransform }

        let safeZoom = CGFloat(min(max(zoom, 1), 1.5))
        let scale = max(renderSize.width / orientedSize.width, renderSize.height / orientedSize.height) * safeZoom
        let scaled = CGSize(width: orientedSize.width * scale, height: orientedSize.height * scale)
        let overflowX = max(0, (scaled.width - renderSize.width) / 2)
        let overflowY = max(0, (scaled.height - renderSize.height) / 2)
        let safePosition = CGFloat(min(max(position, -1), 1))
        let translation = CGAffineTransform(
            translationX: (renderSize.width - scaled.width) / 2 - safePosition * overflowX,
            y: (renderSize.height - scaled.height) / 2 - safePosition * overflowY
        )

        return preferredTransform
            .concatenating(CGAffineTransform(translationX: -orientedRect.minX, y: -orientedRect.minY))
            .concatenating(CGAffineTransform(scaleX: scale, y: scale))
            .concatenating(translation)
    }
}

private struct ReelCropPreview: View {
    let url: URL
    let sourceAspectRatio: CGFloat
    let zoom: Double
    let position: Double
    @State private var player: AVQueuePlayer?
    @State private var looper: AVPlayerLooper?

    var body: some View {
        GeometryReader { geometry in
            if let player {
                let targetAspect = geometry.size.width / max(geometry.size.height, 1)
                let isWide = sourceAspectRatio > targetAspect
                let baseSize = isWide
                    ? CGSize(width: geometry.size.height * sourceAspectRatio, height: geometry.size.height)
                    : CGSize(width: geometry.size.width, height: geometry.size.width / max(sourceAspectRatio, 0.001))
                let scaledSize = CGSize(width: baseSize.width * zoom, height: baseSize.height * zoom)
                let overflowX = max(0, (scaledSize.width - geometry.size.width) / 2)
                let overflowY = max(0, (scaledSize.height - geometry.size.height) / 2)
                FillingVideoPlayer(player: player)
                    .scaleEffect(zoom)
                    .offset(
                        x: isWide ? CGFloat(position) * -overflowX : 0,
                        y: isWide ? 0 : CGFloat(position) * -overflowY
                    )
            } else {
                ProgressView().tint(.white)
            }
        }
        .background(Color.black)
        .clipped()
        .task(id: url) {
            let item = AVPlayerItem(url: url)
            let queue = AVQueuePlayer()
            looper = AVPlayerLooper(player: queue, templateItem: item)
            queue.isMuted = true
            queue.play()
            player = queue
        }
        .onDisappear { player?.pause() }
        .accessibilityLabel("Reel framing preview")
    }
}

/// PhotosPicker transferable for a local movie file URL.
private struct ReelMovieFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let temp = FileManager.default.temporaryDirectory
                .appendingPathComponent("ff-reel-\(UUID().uuidString)")
                .appendingPathExtension(received.file.pathExtension.isEmpty ? "mp4" : received.file.pathExtension)
            try FileManager.default.copyItem(at: received.file, to: temp)
            return ReelMovieFile(url: temp)
        }
    }
}

#Preview {
    ReelComposerView(onPublished: {})
}
