import SwiftUI

/// A hand-curated catalog of real Christian/worship Spotify playlists.
/// Browsable by anyone; connecting Spotify (Profile > Music) surfaces a
/// "Recommended for you" row up top, matched to real listening data rather
/// than a generic popularity ranking.
struct MusicPlaylistsView: View {
    @State private var response: MusicPlaylistsResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && response == nil {
                ProgressView()
            } else if let response {
                List {
                    if !response.connected {
                        Section {
                            Text(response.spotifyConfigured
                                 ? "Connect Spotify in Profile to see playlists picked from your own listening, and let it personalize your morning verse."
                                 : "Every playlist below is free to open in Spotify. Personalized picks aren't available on this server yet.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        .listRowBackground(Color.clear)
                    }
                    if !response.recommended.isEmpty {
                        Section("Recommended for you") {
                            ForEach(response.recommended) { playlist in
                                playlistRow(playlist)
                            }
                        }
                        .listRowBackground(FFTheme.parchment1)
                    }
                    Section(response.recommended.isEmpty ? "Christian & Worship Playlists" : "All Playlists") {
                        ForEach(response.playlists) { playlist in
                            playlistRow(playlist)
                        }
                    }
                    .listRowBackground(FFTheme.parchment1)
                }
                .ffListChrome()
            } else if let errorMessage {
                ContentUnavailableView("Could not load playlists", systemImage: "music.note.list", description: Text(errorMessage))
            }
        }
        .navigationTitle("Christian Playlists")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func playlistRow(_ playlist: ChristianPlaylist) -> some View {
        Link(destination: URL(string: playlist.url) ?? URL(string: "https://open.spotify.com")!) {
            HStack(spacing: 12) {
                AsyncImage(url: playlist.image.flatMap(URL.init(string:))) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(FFTheme.meadow.opacity(0.15))
                        .overlay(Image(systemName: "music.note").foregroundStyle(FFTheme.meadow))
                }
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text(playlist.name).font(.subheadline.weight(.semibold)).foregroundStyle(FFTheme.ink)
                    Text(playlist.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    Text("by \(playlist.owner)").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "arrow.up.right.square").foregroundStyle(.secondary)
            }
            .padding(.vertical, 3)
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        isLoading = true
        do { response = try await APIClient.shared.fetchMusicPlaylists() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

#Preview { NavigationStack { MusicPlaylistsView() } }
