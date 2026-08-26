import SwiftUI
import AVKit
import Foundation
#if canImport(UIKit)
import UIKit
#endif
#if canImport(WebKit)
import WebKit
#endif

/// Shared once-per-process audio session setup for both inline player kinds
/// below -- without it, playback audio silently defers to whatever ambient
/// session happens to already be in effect, which respects the ringer/silent
/// switch and can leave an autoplaying reel visibly playing with no sound.
private func configureReelAudioSession() {
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    try? AVAudioSession.sharedInstance().setActive(true)
}

/// A short-form feed that warms the next visuals before the member reaches
/// them. Native uploads are already returned with their compact data payload;
/// catalogue items need only their thumbnail fetched ahead of the player.
struct ReelsFeedView: View {
    @State private var reels: [Reel] = []
    @State private var churchName: String?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var playingReel: Reel?
    @State private var commentPost: FeedPost?
    @State private var showComposer = false
    // "Functioning Faith Originals" -- videos uploaded directly to the app --
    // are always provider == "functioning_faith" and always carry their own
    // video_data, which is what makes true inline autoplay possible for them
    // without the WebView/external-app complexity a YouTube or church-linked
    // reel would bring. Filtering client-side since the full set is already
    // fetched in one page.
    @State private var showOriginalsOnly = false
    // Drives which page's video is actually playing -- see ReelPage/
    // InlineReelPlayer. Bound to the paging ScrollView's own position so
    // exactly one video plays at a time, and it pauses the instant its page
    // scrolls out of view instead of continuing to play off-screen.
    @State private var currentReelID: String?

    private var visibleReels: [Reel] {
        showOriginalsOnly ? reels.filter { $0.provider == "functioning_faith" } : reels
    }

    var body: some View {
        Group {
            if isLoading && reels.isEmpty {
                FFLoadingView(message: "Loading Reels…")
            } else if let errorMessage, reels.isEmpty {
                FFErrorStateView(message: errorMessage, onRetry: { Task { await load() } })
            } else if reels.isEmpty {
                FFEmptyStateView(title: "No Reels right now", systemImage: "play.rectangle", message: "Check back soon — or publish a short encouragement of your own.", actionTitle: "Create a Reel", action: { showComposer = true })
            } else if visibleReels.isEmpty {
                // Still needs the toggle -- otherwise switching to Originals
                // when there aren't any yet strands the member with no way
                // back to All Reels short of leaving the tab.
                FFEmptyStateView(title: "No Originals yet", systemImage: "play.rectangle", message: "Videos uploaded directly to Functioning Faith show up here.", actionTitle: "Create a Reel", action: { showComposer = true })
                    .overlay(alignment: .top) { originalsToggle }
            } else {
                // A one-video-per-screen, edge-to-edge paged feed -- not a
                // scrollable list of preview cards. Each page fills the
                // screen and the scroll view snaps exactly one at a time,
                // matching the continuous feed members expect instead of
                // visibly separated cards.
                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(visibleReels.enumerated()), id: \.element.id) { index, reel in
                            ReelPage(reel: reel, churchName: churchName,
                                     isCurrent: currentReelID == reel.id,
                                     onPlay: { playingReel = reel },
                                     onLike: { react(reel, kind: "like") },
                                     onSave: { react(reel, kind: "save") },
                                     onComments: reel.provider == "functioning_faith" ? { openComments(for: reel) } : nil,
                                     onNotInterested: { hide(reel) })
                                .containerRelativeFrame([.horizontal, .vertical])
                                .id(reel.id)
                                .onAppear { prefetch(after: index) }
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.paging)
                .scrollPosition(id: $currentReelID)
                .scrollIndicators(.hidden)
                .ignoresSafeArea(edges: .bottom)
                .background(Color.black)
                .refreshable { await load() }
                // Floats over the edge-to-edge video rather than reserving
                // its own strip -- the feed stays truly full-bleed, matching
                // the TikTok-style "Following / For You" tab placement this
                // is modeled on, sitting above where each page's own
                // profile/channel line is overlaid near the bottom.
                .overlay(alignment: .top) {
                    originalsToggle
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showComposer = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Create a Reel")
            }
        }
        .task { await load() }
        .sheet(item: $playingReel) { reel in ReelPlayerView(reel: reel) }
        .sheet(item: $commentPost) { post in NavigationStack { CommentThreadView(post: post) { } } }
        .sheet(isPresented: $showComposer) {
            ReelComposerView {
                Task { await load() }
            }
        }
        .alert("Could not load reels", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private var originalsToggle: some View {
        Picker("Feed", selection: $showOriginalsOnly.animation(.default)) {
            Text("All Reels").tag(false)
            Text("Functioning Faith Originals").tag(true)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, FFTheme.Space.md)
        .padding(.top, FFTheme.Space.sm)
        .padding(.bottom, FFTheme.Space.xs)
        .background(.black.opacity(0.35))
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            let response = try await APIClient.shared.fetchReels()
            guard !Task.isCancelled else { return }
            reels = response.videos
            churchName = response.churchName
            prefetch(after: -1)
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func react(_ reel: Reel, kind: String) {
        guard let idx = reels.firstIndex(where: { $0.id == reel.id }) else { return }
        Task {
            do {
                let result = try await APIClient.shared.reactToReel(videoID: reel.videoID, kind: kind)
                guard !Task.isCancelled else { return }
                if kind == "like" { reels[idx] = reels[idx].withLike(active: result.active, count: result.count) }
                else { reels[idx] = reels[idx].withSave(active: result.active, count: result.count) }
                #if canImport(UIKit)
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                #endif
            } catch { errorMessage = error.localizedDescription }
        }
    }

    private func hide(_ reel: Reel) {
        reels.removeAll { $0.id == reel.id }
        Task { do { try await APIClient.shared.markReelNotInterested(videoID: reel.videoID) } catch { errorMessage = error.localizedDescription } }
    }

    private func openComments(for reel: Reel) {
        guard let id = UUID(uuidString: reel.videoID) else { return }
        Task { do { commentPost = try await APIClient.shared.fetchPost(id: id) } catch { errorMessage = error.localizedDescription } }
    }

    /// Keep this intentionally bounded: it guarantees the next two cards are
    /// visually ready without consuming a whole feed's bandwidth or keeping a
    /// long-lived video buffer in memory.
    private func prefetch(after index: Int) {
        let urls = reels.dropFirst(index + 1).prefix(2).compactMap { reel in
            reel.thumbnailURL.flatMap(URL.init(string:))
        }
        guard !urls.isEmpty else { return }
        Task { await ReelPrefetcher.shared.prefetch(urls) }
    }
}

private actor ReelPrefetcher {
    static let shared = ReelPrefetcher()
    private var warmed: Set<URL> = []

    func prefetch(_ urls: [URL]) async {
        for url in urls where !warmed.contains(url) {
            warmed.insert(url)
            let request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15)
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                URLCache.shared.storeCachedResponse(CachedURLResponse(response: response, data: data), for: request)
            } catch {
                // A thumbnail miss must never interrupt the feed. AsyncImage
                // still makes its normal request when the card becomes visible.
            }
        }
    }
}

private extension Reel {
    func withLike(active: Bool, count: Int) -> Reel {
        Reel(videoID: videoID, title: title, description: description, thumbnailURL: thumbnailURL,
             channelTitle: channelTitle, category: category, provider: provider, sourceURL: sourceURL,
             sourceKind: sourceKind, videoData: videoData, verseReference: verseReference, verseText: verseText,
             churchName: churchName, likeCount: likeCount, saveCount: saveCount, likedByMe: active, savedByMe: savedByMe)
    }
    func withSave(active: Bool, count: Int) -> Reel {
        Reel(videoID: videoID, title: title, description: description, thumbnailURL: thumbnailURL,
             channelTitle: channelTitle, category: category, provider: provider, sourceURL: sourceURL,
             sourceKind: sourceKind, videoData: videoData, verseReference: verseReference, verseText: verseText,
             churchName: churchName, likeCount: likeCount, saveCount: count, likedByMe: likedByMe, savedByMe: active)
    }
}

/// One full-screen page of the feed -- edge-to-edge thumbnail (or, for a
/// Functioning Faith Original, the actual playing video), a bottom gradient
/// for legibility, and a TikTok-style bottom-left caption / right-side
/// action rail. A YouTube or church-linked reel still opens the modal
/// player on tap -- those are a WebView embed or an external link, and
/// autoplaying either inline in a recycling feed is a real, separate
/// undertaking this doesn't attempt. A native upload autoplays inline
/// instead, since it's already just local MP4/MOV data with none of that
/// complexity.
private struct ReelPage: View {
    let reel: Reel
    let churchName: String?
    let isCurrent: Bool
    let onPlay: () -> Void
    let onLike: () -> Void
    let onSave: () -> Void
    let onComments: (() -> Void)?
    let onNotInterested: () -> Void

    private var isNativeInline: Bool { reel.provider == "functioning_faith" && reel.videoData != nil }
    // A YouTube reel autoplays inline too, exactly like a native upload,
    // instead of tapping into a modal that stops the feed's own scrolling --
    // the modal only remains for reels with neither a native payload nor a
    // YouTube ID (an external/church link with no embeddable player).
    private var isYouTubeInline: Bool { reel.provider == "youtube" }
    private var isInlinePlayable: Bool { isNativeInline || isYouTubeInline }

    var body: some View {
        ZStack {
            Color.black
            if isNativeInline, let dataURL = reel.videoData {
                InlineReelPlayer(dataURL: dataURL, isActive: isCurrent)
            } else if isYouTubeInline && isCurrent {
                InlineYouTubeReelPlayer(videoID: reel.videoID)
            } else if let thumb = reel.thumbnailURL, let url = URL(string: thumb) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.white.opacity(0.08)
                }
            } else {
                LinearGradient(colors: [FFTheme.walnut0, FFTheme.walnut], startPoint: .top, endPoint: .bottom)
            }

            LinearGradient(colors: [.clear, .clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
                .allowsHitTesting(false)

            if !isInlinePlayable {
                Button(action: onPlay) {
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(.white.opacity(0.92))
                        .shadow(color: .black.opacity(0.4), radius: 8)
                }
                .accessibilityLabel("Play")
            }

            VStack {
                Spacer()
                HStack(alignment: .bottom, spacing: FFTheme.Space.md) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(reel.title ?? "Untitled")
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)
                            .foregroundStyle(.white)
                        HStack(spacing: 6) {
                            if let channel = reel.channelTitle { Text(channel) }
                            if reel.sourceKind == "church", let name = reel.churchName ?? churchName { Text("· \(name)") }
                        }
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.8))
                        if let ref = reel.verseReference {
                            Text(ref).font(.caption.weight(.semibold)).foregroundStyle(FFTheme.goldBright)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(spacing: 20) {
                        actionButton(systemImage: reel.likedByMe ? "heart.fill" : "heart", count: reel.likeCount, tint: reel.likedByMe ? FFTheme.seal : .white, action: onLike)
                        actionButton(systemImage: reel.savedByMe ? "bookmark.fill" : "bookmark", count: reel.saveCount, tint: reel.savedByMe ? FFTheme.goldBright : .white, action: onSave)
                        if let onComments {
                            Button(action: onComments) {
                                VStack(spacing: 3) {
                                    Image(systemName: "bubble.left.fill").font(.title2)
                                    Text("Reply").font(.caption2)
                                }
                            }
                            .foregroundStyle(.white)
                        }
                        Button(role: .destructive, action: onNotInterested) {
                            Image(systemName: "hand.thumbsdown").font(.title3)
                        }
                        .foregroundStyle(.white.opacity(0.85))
                        .accessibilityLabel("Not interested")
                    }
                }
                .padding(.horizontal, FFTheme.Space.md)
                .padding(.bottom, FFTheme.Space.xxl)
            }
        }
        .clipped()
    }

    private func actionButton(systemImage: String, count: Int, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: systemImage).font(.title2)
                Text("\(count)").font(.caption2)
            }
        }
        .foregroundStyle(tint)
    }
}

/// Full-bleed, chrome-free, looping playback for a native upload's own
/// data: URL -- decodes once on first appear, then just starts/stops/rewinds
/// the same player as `isActive` tracks the feed's scroll position, instead
/// of tearing down and rebuilding a player on every scroll (which is what
/// made ReelPlayerView.swift's NativeVideoPlayerView the right shape for a
/// one-off modal but the wrong shape for a page that gets asked to play and
/// pause repeatedly as the member scrolls back and forth).
private struct InlineReelPlayer: View {
    let dataURL: String
    let isActive: Bool

    @State private var player: AVQueuePlayer?
    @State private var looper: AVPlayerLooper?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player)
                    .allowsHitTesting(false)
            } else if let errorMessage {
                ContentUnavailableView(errorMessage, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.white)
            } else {
                ProgressView().tint(.white)
            }
        }
        .task { prepare() }
        .onChange(of: isActive) { _, active in
            guard let player else { return }
            if active {
                player.seek(to: .zero)
                player.play()
            } else {
                player.pause()
            }
        }
        .onDisappear { player?.pause() }
    }

    private func prepare() {
        guard player == nil else { return }
        // Same real, documented iOS gap as the modal player: no WebM/VP8/VP9
        // decoder in AVFoundation. An honest placeholder beats a silently
        // frozen tile.
        if dataURL.hasPrefix("data:video/webm") {
            errorMessage = "This video format isn't supported for playback."
            return
        }
        guard let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]))
        else { errorMessage = "This video could not be decoded."; return }
        let fileExtension = dataURL.hasPrefix("data:video/quicktime") ? "mov" : "mp4"
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(fileExtension)
        do {
            try data.write(to: tempURL)
            configureReelAudioSession()
            let item = AVPlayerItem(url: tempURL)
            let queuePlayer = AVQueuePlayer()
            looper = AVPlayerLooper(player: queuePlayer, templateItem: item)
            queuePlayer.isMuted = false
            player = queuePlayer
            if isActive { queuePlayer.play() }
        } catch {
            errorMessage = "This video could not be saved for playback."
        }
    }
}

/// Inline, chrome-free playback for a YouTube reel -- mounted only while its
/// page `isCurrent` (see ReelPage), so exactly one WKWebView loads at a time
/// instead of every YouTube tile in the feed running its own player, and
/// scrolling to the next page simply unmounts it rather than needing a
/// postMessage handshake with the YouTube IFrame API to pause it. Reuses
/// YouTube's own nocookie embed, the same approach ReelPlayerView's modal
/// player already uses for a one-off tap-to-watch.
#if canImport(WebKit)
private struct InlineYouTubeReelPlayer: UIViewRepresentable {
    let videoID: String

    func makeUIView(context: Context) -> WKWebView {
        configureReelAudioSession()
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .black
        load(videoID: videoID, into: webView)
        context.coordinator.loadedVideoID = videoID
        return webView
    }

    // SwiftUI can call updateUIView on any unrelated state change in this
    // view's ancestors, not just when `videoID` actually changes -- without
    // this guard, every such call would reload the HTML and restart the
    // video from the top mid-playback.
    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loadedVideoID != videoID else { return }
        load(videoID: videoID, into: webView)
        context.coordinator.loadedVideoID = videoID
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var loadedVideoID: String?
    }

    private func load(videoID: String, into webView: WKWebView) {
        guard let encoded = videoID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return }
        let origin = "https://faithfit-demo-production.up.railway.app"
        let html = """
        <!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
        <style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#000}</style></head>
        <body><iframe src=\"https://www.youtube-nocookie.com/embed/\(encoded)?playsinline=1&rel=0&autoplay=1&origin=\(origin)\" allow=\"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture\" allowfullscreen></iframe></body></html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: origin))
    }
}
#endif

#Preview { NavigationStack { ReelsFeedView() } }
