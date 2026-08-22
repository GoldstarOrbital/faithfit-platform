import SwiftUI
import AVKit
#if canImport(WebKit)
import WebKit
#endif

struct ReelPlayerView: View {
    let reel: Reel
    @Environment(\.dismiss) private var dismiss
    @State private var didRecordImpression = false

    var body: some View {
        NavigationStack {
            Group {
                switch playbackKind {
                case .youtube(let videoID):
                    YouTubeEmbedView(videoID: videoID)
                case .nativeVideo(let dataURL):
                    NativeVideoPlayerView(dataURL: dataURL)
                case .external(let url):
                    ExternalWatchView(url: url, title: reel.title)
                case .unavailable:
                    ContentUnavailableView("This reel can't be played", systemImage: "play.slash")
                }
            }
            .navigationTitle(reel.title ?? "Reel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .task {
            guard !didRecordImpression else { return }
            didRecordImpression = true
            try? await APIClient.shared.recordReelImpression(videoID: reel.videoID)
        }
    }

    private enum Playback {
        case youtube(String)
        case nativeVideo(String)
        case external(URL)
        case unavailable
    }

    private var playbackKind: Playback {
        if reel.provider == "functioning_faith", let data = reel.videoData { return .nativeVideo(data) }
        if reel.provider == "youtube" { return .youtube(reel.videoID) }
        if let source = reel.sourceURL, let url = URL(string: source) { return .external(url) }
        return .unavailable
    }
}

/// YouTube's own embed player, loaded in a WKWebView -- the standard,
/// low-risk way to play a YouTube video inside an app without a third-party
/// SDK (which can't be added without network/build access in this
/// environment anyway). `playsinline=1` keeps it from forcing iOS's
/// native fullscreen video chrome on load.
#if canImport(WebKit)
/// Internal (not private) so VideoLibraryView can reuse it for the curated
/// video library -- same real embed, same reason to avoid a third-party SDK.
struct YouTubeEmbedView: UIViewRepresentable {
    let videoID: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // YouTube now rejects some anonymous native iframe loads. Giving the
        // embed a real first-party origin lets YouTube identify the player
        // without leaking user data or requiring a YouTube account.
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = false
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard let encoded = videoID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return }
        let origin = "https://faithfit-demo-production.up.railway.app"
        let html = """
        <!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
        <style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#17110d}</style></head>
        <body><iframe src=\"https://www.youtube-nocookie.com/embed/\(encoded)?playsinline=1&rel=0&origin=\(origin)\" allow=\"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture\" allowfullscreen></iframe></body></html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: origin))
    }
}
#endif

/// Decodes a stored `data:video/...;base64,...` post into a temp file and
/// plays it with AVKit -- the same data: URL shape ImageUpload.dataURL
/// produces for photos, just video instead.
private struct NativeVideoPlayerView: View {
    let dataURL: String
    @State private var player: AVPlayer?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player).onAppear { player.play() }
            } else if let errorMessage {
                ContentUnavailableView(errorMessage, systemImage: "exclamationmark.triangle")
            } else {
                ProgressView()
            }
        }
        .task { prepare() }
    }

    private func prepare() {
        // The server stores MP4, QuickTime MOV, or WebM here. AVFoundation has
        // no WebM/VP8/VP9 decoder on iOS (a
        // real, documented platform gap, not an edge case worth guessing
        // past) -- rather than hand AVPlayer a file it will silently fail
        // to play, that case gets an honest message instead.
        if dataURL.hasPrefix("data:video/webm") {
            errorMessage = "This video is in WebM format, which isn't supported for playback on iOS."
            return
        }
        guard let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]))
        else { errorMessage = "This video could not be decoded."; return }
        let fileExtension = dataURL.hasPrefix("data:video/quicktime") ? "mov" : "mp4"
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(fileExtension)
        do {
            try data.write(to: tempURL)
            player = AVPlayer(url: tempURL)
        } catch {
            errorMessage = "This video could not be saved for playback."
        }
    }
}

private struct ExternalWatchView: View {
    let url: URL
    let title: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "arrow.up.right.square").font(.system(size: 44)).foregroundStyle(.tint)
            Text(title ?? "This video").font(.headline).multilineTextAlignment(.center)
            Text("Opens outside the app.").font(.caption).foregroundStyle(.secondary)
            Button("Watch") { openURL(url) }.buttonStyle(.ffPrimary)
        }
        .padding()
    }
}

#Preview {
    ReelPlayerView(reel: Reel(
        videoID: "preview", title: "Preview Reel", description: nil, thumbnailURL: nil, channelTitle: "Preview Channel",
        category: nil, provider: "youtube", sourceURL: nil, sourceKind: nil, videoData: nil, verseReference: nil,
        verseText: nil, churchName: nil, likeCount: 0, saveCount: 0, likedByMe: false, savedByMe: false
    ))
}
