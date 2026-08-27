import SwiftUI

struct PodcastsView: View {
    @State private var podcasts: [Podcast] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && podcasts.isEmpty {
                ProgressView()
            } else if podcasts.isEmpty {
                ContentUnavailableView("No podcasts available", systemImage: "microphone", description: Text("Check back soon."))
            } else {
                List(podcasts) { podcast in
                    NavigationLink {
                        PodcastEpisodesView(podcast: podcast)
                    } label: {
                        showRow(podcast)
                    }
                }
                .ffListChrome()
            }
        }
        .navigationTitle("Podcasts")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load(forceRefresh: true) }
        .alert("Could not load podcasts", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func showRow(_ podcast: Podcast) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(podcast.title).font(.headline)
            if let host = podcast.host {
                Text(host).font(.caption).foregroundStyle(.secondary)
            }
            if let description = podcast.description {
                Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.vertical, 3)
    }

    private func load(forceRefresh: Bool = false) async {
        isLoading = true
        do { podcasts = try await APIClient.shared.fetchPodcasts(forceRefresh: forceRefresh) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

struct PodcastEpisodesView: View {
    let podcast: Podcast
    @StateObject private var player = PodcastPlayer.shared

    var body: some View {
        Group {
            if podcast.episodes.isEmpty {
                ContentUnavailableView("No episodes yet", systemImage: "microphone.slash", description: Text("This show hasn't published anything we could fetch."))
            } else {
                List(podcast.episodes) { episode in
                    episodeRow(episode)
                }
                .ffListChrome()
            }
        }
        .navigationTitle(podcast.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func episodeRow(_ episode: PodcastEpisode) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Button {
                player.toggle(episode)
            } label: {
                Image(systemName: player.isCurrentlyPlaying(episode) ? "pause.circle.fill" : "play.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.tint)
            }
            .buttonStyle(.plain)
            .disabled(episode.audioURL == nil)
            episodeDetails(episode)
        }
        .padding(.vertical, 3)
    }

    private func episodeDetails(_ episode: PodcastEpisode) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(episode.title).font(.subheadline.weight(.medium))
            if let description = episode.description {
                Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            HStack(spacing: 8) {
                if let durationSec = episode.durationSec {
                    Text(Self.formatDuration(durationSec)).font(.caption2).foregroundStyle(.secondary)
                }
                if let publishedAt = episode.publishedAt, publishedAt.count >= 10 {
                    Text(publishedAt.prefix(10)).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }

    private static func formatDuration(_ seconds: Int) -> String {
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes) min" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }
}

#Preview { NavigationStack { PodcastsView() } }
