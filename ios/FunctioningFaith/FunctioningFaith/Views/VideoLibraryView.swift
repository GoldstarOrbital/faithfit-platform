import SwiftUI

/// Curated by category from real, verified YouTube channels -- distinct
/// from Reels' short-form feed. Playback reuses ReelPlayerView's own
/// YouTube embed rather than a second implementation.
struct VideoLibraryView: View {
    private static let categories: [(key: String, label: String)] = [
        ("christian", "Christian"), ("motivational", "Motivational"), ("fitness", "Fitness"),
        ("food", "Food"), ("kids", "Kids"), ("veggietales", "VeggieTales"), ("nickbare", "Nick Bare"),
    ]

    @State private var category = "christian"
    @State private var videos: [VideoItem] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var playingVideo: VideoItem?

    var body: some View {
        VStack(spacing: 0) {
            Picker("Category", selection: $category) {
                ForEach(Self.categories, id: \.key) { c in Text(c.label).tag(c.key) }
            }
            .pickerStyle(.segmented)
            .padding()
            content
        }
        .navigationTitle("Videos")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onChange(of: category) { _, _ in Task { await load() } }
        .sheet(item: $playingVideo) { video in
            NavigationStack {
                YouTubeEmbedView(videoID: video.videoID)
                    .navigationTitle(video.title)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { playingVideo = nil } } }
            }
        }
        .alert("Could not load videos", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && videos.isEmpty {
            ProgressView()
            Spacer()
        } else if videos.isEmpty {
            ContentUnavailableView("No videos yet", systemImage: "play.rectangle", description: Text("Check back soon."))
        } else {
            List(videos) { video in
                Button { playingVideo = video } label: { videoRow(video) }
                    .buttonStyle(.plain)
            }
            .listStyle(.plain)
        }
    }

    private func videoRow(_ video: VideoItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "play.rectangle.fill").font(.title2).foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 3) {
                Text(video.title).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                if let channel = video.channelTitle {
                    Text(channel).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 3)
    }

    private func load() async {
        isLoading = true
        do { videos = try await APIClient.shared.fetchVideos(category: category) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

#Preview { NavigationStack { VideoLibraryView() } }
