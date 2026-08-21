import SwiftUI

/// Card feed rather than an auto-playing swipeable video wall (the web
/// app's own style). Delivers the same real functionality -- browse, react,
/// mark not-interested, actually watch each clip -- without the much
/// higher-risk gesture/preload/autoplay machinery a TikTok-style feed needs,
/// which isn't the kind of thing to write with no way to actually run it.
struct ReelsFeedView: View {
    @State private var reels: [Reel] = []
    @State private var churchName: String?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var playingReel: Reel?
    @State private var showComposer = false

    var body: some View {
        Group {
            if isLoading && reels.isEmpty {
                ProgressView()
            } else if reels.isEmpty {
                ContentUnavailableView {
                    Label("No reels right now", systemImage: "play.rectangle")
                } description: {
                    Text("Check back soon — or publish a short encouragement of your own.")
                } actions: {
                    Button("Create a Reel") { showComposer = true }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                List {
                    Section {
                        Button {
                            showComposer = true
                        } label: {
                            Label("Create a Reel", systemImage: "plus.circle.fill")
                                .font(.headline)
                        }
                        .listRowBackground(FFTheme.parchment1)
                        Text("Up to 60s · workout, nature, animals, or groups — paired with verified Scripture.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .listRowBackground(FFTheme.parchment1)
                    }
                    ForEach(reels) { reel in
                        ReelCard(reel: reel, churchName: churchName,
                                 onPlay: { playingReel = reel },
                                 onLike: { react(reel, kind: "like") },
                                 onSave: { react(reel, kind: "save") },
                                 onNotInterested: { hide(reel) })
                        .listRowBackground(FFTheme.parchment1)
                    }
                }
                .ffListChrome()
                .listStyle(.plain)
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
        do {
            let response = try await APIClient.shared.fetchReels()
            reels = response.videos
            churchName = response.churchName
        } catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func react(_ reel: Reel, kind: String) {
        guard let idx = reels.firstIndex(where: { $0.id == reel.id }) else { return }
        Task {
            guard let result = try? await APIClient.shared.reactToReel(videoID: reel.videoID, kind: kind) else { return }
            if kind == "like" { reels[idx] = reels[idx].withLike(active: result.active, count: result.count) }
            else { reels[idx] = reels[idx].withSave(active: result.active, count: result.count) }
        }
    }

    private func hide(_ reel: Reel) {
        reels.removeAll { $0.id == reel.id }
        Task { try? await APIClient.shared.markReelNotInterested(videoID: reel.videoID) }
    }
}

private extension Reel {
    func withLike(active: Bool, count: Int) -> Reel {
        Reel(videoID: videoID, title: title, description: description, thumbnailURL: thumbnailURL,
             channelTitle: channelTitle, category: category, provider: provider, sourceURL: sourceURL,
             sourceKind: sourceKind, videoData: videoData, verseReference: verseReference, verseText: verseText,
             churchName: churchName, likeCount: count, saveCount: saveCount, likedByMe: active, savedByMe: savedByMe)
    }
    func withSave(active: Bool, count: Int) -> Reel {
        Reel(videoID: videoID, title: title, description: description, thumbnailURL: thumbnailURL,
             channelTitle: channelTitle, category: category, provider: provider, sourceURL: sourceURL,
             sourceKind: sourceKind, videoData: videoData, verseReference: verseReference, verseText: verseText,
             churchName: churchName, likeCount: likeCount, saveCount: count, likedByMe: likedByMe, savedByMe: active)
    }
}

private struct ReelCard: View {
    let reel: Reel
    let churchName: String?
    let onPlay: () -> Void
    let onLike: () -> Void
    let onSave: () -> Void
    let onNotInterested: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: onPlay) {
                ZStack {
                    if let thumb = reel.thumbnailURL, let url = URL(string: thumb) {
                        AsyncImage(url: url) { image in image.resizable().scaledToFill() }
                        placeholder: { Color.secondary.opacity(0.15) }
                    } else {
                        Color.secondary.opacity(0.15)
                    }
                    Image(systemName: "play.circle.fill").font(.system(size: 44)).foregroundStyle(.white).shadow(radius: 4)
                }
                .frame(height: 200)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)

            Text(reel.title ?? "Untitled").font(.subheadline.weight(.semibold)).lineLimit(2)
            HStack(spacing: 6) {
                if let channel = reel.channelTitle { Text(channel) }
                if reel.sourceKind == "church", let name = reel.churchName ?? churchName { Text("· \(name)") }
            }
            .font(.caption).foregroundStyle(.secondary)
            if let ref = reel.verseReference {
                Text(ref).font(.caption.weight(.semibold).foregroundStyle(FFTheme.scripture)
            }
            HStack(spacing: 18) {
                Button { onLike() } label: {
                    Label("\(reel.likeCount)", systemImage: reel.likedByMe ? "heart.fill" : "heart")
                }.foregroundStyle(reel.likedByMe ? FFTheme.seal : .primary)
                Button { onSave() } label: {
                    Label("\(reel.saveCount)", systemImage: reel.savedByMe ? "bookmark.fill" : "bookmark")
                }.foregroundStyle(reel.savedByMe ? FFTheme.meadow : .primary)
                Spacer()
                Button(role: .destructive) { onNotInterested() } label: {
                    Label("Not interested", systemImage: "hand.thumbsdown")
                }.labelStyle(.iconOnly)
            }
            .font(.caption).buttonStyle(.plain)
        }
        .padding(.vertical, 6)
    }
}

#Preview { NavigationStack { ReelsFeedView() } }
