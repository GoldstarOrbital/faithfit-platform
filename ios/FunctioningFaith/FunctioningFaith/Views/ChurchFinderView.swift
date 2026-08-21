import SwiftUI
import CoreLocation

struct ChurchFinderView: View {
    @EnvironmentObject private var session: NativeSession
    @StateObject private var locator = ChurchLocator()
    @State private var churches: [NearbyChurch] = []
    @State private var hasSearched = false
    @State private var isSearching = false
    @State private var devotional: ChurchDevotional?
    @State private var weeklyService: ChurchWeeklyService?
    @State private var churchVideos: [ChurchVideo] = []
    @State private var isLoadingMyChurch = false
    @State private var transcript: ChurchServiceTranscript?
    @State private var isLoadingTranscript = false
    @State private var showTranscript = false
    @State private var errorMessage: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        List {
            myChurchSection
            searchSection
        }
        .ffListChrome()
        .navigationTitle("Find a Church")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadMyChurchContent() }
        .sheet(isPresented: $showTranscript) {
            NavigationStack {
                ScrollView {
                    Text(transcript?.transcript ?? "")
                        .padding()
                }
                .navigationTitle(transcript?.videoTitle ?? "This Week's Sermon")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { showTranscript = false } } }
            }
        }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    // Split out of `body` -- the same defensive pattern used elsewhere in
    // this app (StoryComposerView, ProfileView, ScriptureView) after
    // SwiftUI's type-checker choked on a few large, multi-section bodies.
    @ViewBuilder
    private var myChurchSection: some View {
        if let churchName = session.profile?.churchName {
            Section {
                Text(churchName).font(.headline)
                if isLoadingMyChurch {
                    ProgressView()
                } else {
                    if let devotional {
                        Label(devotional.title ?? "Today's devotional", systemImage: "play.rectangle")
                            .font(.subheadline)
                    } else {
                        Text("No devotional linked for this church yet.").font(.caption).foregroundStyle(.secondary)
                    }
                    if let weeklyService {
                        Label(weeklyService.title ?? "This week's service", systemImage: "play.tv")
                            .font(.subheadline)
                    } else {
                        Text("No service video linked for this week yet.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if !churchVideos.isEmpty {
                    ForEach(Array(churchVideos.enumerated()), id: \.offset) { _, video in
                        videoRow(video)
                    }
                }
                if weeklyService != nil {
                    Button {
                        Task { await loadTranscript() }
                    } label: {
                        if isLoadingTranscript { ProgressView() } else { Text("Read this week's sermon") }
                    }
                    .disabled(isLoadingTranscript)
                }
                NavigationLink { ChurchVerificationView() } label: {
                    Text("Become a verified church admin")
                }
                Button("Not your church?", role: .destructive) {
                    Task { await clearMyChurch() }
                }
                .font(.caption)
            } header: {
                Text("Your Church")
            } footer: {
                Text("Devotionals and service video appear once your church's verified admin links a YouTube channel from the web app.")
            }
            .listRowBackground(FFTheme.parchment1)
        }
    }

    @ViewBuilder
    private func videoRow(_ video: ChurchVideo) -> some View {
        if video.provider == "youtube", let videoID = video.videoID {
            NavigationLink {
                YouTubeEmbedView(videoID: videoID)
                    .navigationTitle(video.title ?? "Video")
                    .navigationBarTitleDisplayMode(.inline)
            } label: {
                Text(video.title ?? "Recent video").font(.caption)
            }
        } else {
            Text(video.title ?? "Recent video").font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var searchSection: some View {
        if isSearching {
            Section {
                HStack { Spacer(); ProgressView("Finding churches near you…"); Spacer() }
            }
            .listRowBackground(FFTheme.parchment1)
        } else if !hasSearched {
            Section {
                startPrompt
            }
            .listRowBackground(FFTheme.parchment1)
        } else if churches.isEmpty {
            Section {
                Text("No churches found nearby. Try again, or search from a different area.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .listRowBackground(FFTheme.parchment1)
        } else {
            Section("Nearby") {
                ForEach(churches) { church in
                    churchRow(church)
                }
            }
            .listRowBackground(FFTheme.parchment1)
        }
    }

    private var startPrompt: some View {
        VStack(spacing: 12) {
            Image(systemName: "building.2.crop.circle").font(.system(size: 40)).foregroundStyle(.tint)
            Text("Find real churches near you").font(.subheadline.weight(.medium))
            Text("Uses your location just for this search, via OpenStreetMap.")
                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Search nearby") { Task { await search() } }
                .buttonStyle(.ffPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    private func churchRow(_ church: NearbyChurch) -> some View {
        HStack {
            Button {
                openInMaps(church)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(church.name).font(.headline).foregroundStyle(.primary)
                    if let address = church.address {
                        Text(address).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .buttonStyle(.plain)
            Spacer()
            Button {
                Task { await setAsMyChurch(church) }
            } label: {
                Image(systemName: isMyChurch(church) ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isMyChurch(church) ? FFTheme.emerald : .secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 3)
    }

    private func isMyChurch(_ church: NearbyChurch) -> Bool {
        session.profile?.churchOsmID == church.osmID
    }

    private func search() async {
        isSearching = true
        do {
            let location = try await locator.currentLocation()
            churches = try await APIClient.shared.fetchNearbyChurches(lat: location.coordinate.latitude, lng: location.coordinate.longitude)
            hasSearched = true
        } catch {
            errorMessage = error.localizedDescription
        }
        isSearching = false
    }

    private func openInMaps(_ church: NearbyChurch) {
        guard let encoded = church.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "http://maps.apple.com/?ll=\(church.lat),\(church.lng)&q=\(encoded)") else { return }
        openURL(url)
    }

    private func setAsMyChurch(_ church: NearbyChurch) async {
        do {
            try await APIClient.shared.setMyChurch(church)
            session.profile = try await APIClient.shared.fetchProfile()
            await loadMyChurchContent()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func clearMyChurch() async {
        do {
            try await APIClient.shared.clearMyChurch()
            session.profile = try await APIClient.shared.fetchProfile()
            devotional = nil
            weeklyService = nil
            churchVideos = []
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadMyChurchContent() async {
        guard session.profile?.churchOsmID != nil else { return }
        isLoadingMyChurch = true
        devotional = try? await APIClient.shared.fetchTodaysDevotional()
        weeklyService = try? await APIClient.shared.fetchThisWeeksService()
        churchVideos = (try? await APIClient.shared.fetchChurchVideos())?.videos ?? []
        isLoadingMyChurch = false
    }

    private func loadTranscript() async {
        isLoadingTranscript = true
        do {
            transcript = try await APIClient.shared.fetchServiceTranscript()
            showTranscript = true
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoadingTranscript = false
    }
}

#Preview { NavigationStack { ChurchFinderView() }.environmentObject(NativeSession()) }
