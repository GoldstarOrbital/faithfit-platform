import SwiftUI
import Foundation
#if canImport(UIKit)
import UIKit
#endif

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

    var body: some View {
        Group {
            if isLoading && reels.isEmpty {
                FFLoadingView(message: "Loading Reels…")
            } else if let errorMessage, reels.isEmpty {
                FFErrorStateView(message: errorMessage, onRetry: { Task { await load() } })
            } else if reels.isEmpty {
                FFEmptyStateView(title: "No Reels right now", systemImage: "play.rectangle", message: "Check back soon — or publish a short encouragement of your own.", actionTitle: "Create a Reel", action: { showComposer = true })
            } else {
                // A one-video-per-screen, edge-to-edge paged feed -- not a
                // scrollable list of preview cards. Each page fills the
                // screen and the scroll view snaps exactly one at a time,
                // matching the continuous feed members expect instead of
                // visibly separated cards.
                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(reels.enumerated()), id: \.element.id) { index, reel in
                            ReelPage(reel: reel, churchName: churchName,
                                     onPlay: { playingReel = reel },
                                     onLike: { react(reel, kind: "like") },
                                     onSave: { react(reel, kind: "save") },
                                     onComments: reel.provider == "functioning_faith" ? { openComments(for: reel) } : nil,
                                     onNotInterested: { hide(reel) })
                                .containerRelativeFrame([.horizontal, .vertical])
                                .onAppear { prefetch(after: index) }
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.paging)
                .scrollIndicators(.hidden)
                .ignoresSafeArea(edges: .bottom)
                .background(Color.black)
                .refreshable { await load() }
            }
        }
        .navigationTitle("Reels")
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

/// One full-screen page of the feed -- edge-to-edge thumbnail, a bottom
/// gradient for legibility, and a TikTok-style bottom-left caption /
/// right-side action rail. Tapping the play button opens the real player;
/// this view itself never plays video, keeping playback lifecycle (and its
/// failure modes -- audio session conflicts, undisposed AVPlayers) confined
/// to the one place that already handles it correctly.
private struct ReelPage: View {
    let reel: Reel
    let churchName: String?
    let onPlay: () -> Void
    let onLike: () -> Void
    let onSave: () -> Void
    let onComments: (() -> Void)?
    let onNotInterested: () -> Void

    var body: some View {
        ZStack {
            Color.black
            if let thumb = reel.thumbnailURL, let url = URL(string: thumb) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.white.opacity(0.08)
                }
            } else {
                LinearGradient(colors: [FFTheme.walnut0, FFTheme.walnut], startPoint: .top, endPoint: .bottom)
            }

            LinearGradient(colors: [.clear, .clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)

            Button(action: onPlay) {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(.white.opacity(0.92))
                    .shadow(color: .black.opacity(0.4), radius: 8)
            }
            .accessibilityLabel("Play")

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

#Preview { NavigationStack { ReelsFeedView() } }
