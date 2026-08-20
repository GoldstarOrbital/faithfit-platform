import AVFoundation

/// A single shared player so starting one episode stops whatever else was
/// playing -- matches how every real podcast app behaves. `.playback`
/// category is what actually matters here: without it, audio is silenced by
/// the hardware mute switch, which would look like a broken feature rather
/// than a missing audio-session configuration.
@MainActor
final class PodcastPlayer: ObservableObject {
    static let shared = PodcastPlayer()

    @Published private(set) var currentEpisodeID: String?
    @Published private(set) var isPlaying = false

    private var player: AVPlayer?

    private init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func toggle(_ episode: PodcastEpisode) {
        guard let urlString = episode.audioURL, let url = URL(string: urlString) else { return }
        if currentEpisodeID == episode.id {
            if isPlaying { player?.pause() } else { player?.play() }
            isPlaying.toggle()
            return
        }
        player?.pause()
        player = AVPlayer(url: url)
        currentEpisodeID = episode.id
        player?.play()
        isPlaying = true
    }

    func isCurrentlyPlaying(_ episode: PodcastEpisode) -> Bool {
        currentEpisodeID == episode.id && isPlaying
    }
}
