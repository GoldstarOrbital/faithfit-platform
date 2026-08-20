import SwiftUI
import CoreLocation

struct ChurchFinderView: View {
    @StateObject private var locator = ChurchLocator()
    @State private var churches: [NearbyChurch] = []
    @State private var hasSearched = false
    @State private var isSearching = false
    @State private var errorMessage: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            if isSearching {
                ProgressView("Finding churches near you…")
            } else if !hasSearched {
                startPrompt
            } else if churches.isEmpty {
                ContentUnavailableView("No churches found nearby", systemImage: "building.2",
                                        description: Text("Try again, or search from a different area."))
            } else {
                resultsList
            }
        }
        .navigationTitle("Find a Church")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Could not search", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private var startPrompt: some View {
        VStack(spacing: 16) {
            Image(systemName: "building.2.crop.circle").font(.system(size: 44)).foregroundStyle(.tint)
            Text("Find real churches near you").font(.headline)
            Text("Uses your location just for this search, via OpenStreetMap.")
                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Search nearby") { Task { await search() } }
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }

    private var resultsList: some View {
        List(churches) { church in
            Button {
                openInMaps(church)
            } label: {
                churchRow(church)
            }
        }
        .refreshable { await search() }
    }

    private func churchRow(_ church: NearbyChurch) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(church.name).font(.headline).foregroundStyle(.primary)
            if let address = church.address {
                Text(address).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
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
}

#Preview { NavigationStack { ChurchFinderView() } }
