import SwiftUI
import MapKit

/// Build a route from explicit waypoints, then save it to the member's private
/// route library. Community density is deliberately coarse and comes only from
/// public routes, matching the privacy contract used by HeatmapView.
struct RouteBuilderView: View {
    @State private var name = ""
    @State private var activityType = "Run"
    @State private var latitude = ""
    @State private var longitude = ""
    @State private var points: [[Double]] = []
    @State private var savedRoutes: [SavedRoute] = []
    @State private var communityCells: [HeatmapCell] = []
    @State private var camera: MapCameraPosition = .automatic
    @State private var isSaving = false
    @State private var message: String?

    var body: some View {
        List {
            Section("Plan a route") {
                TextField("Route name", text: $name)
                Picker("Activity", selection: $activityType) {
                    ForEach(["Run", "Ride", "Walk", "Hike", "Ski"], id: \.self) { Text($0).tag($0) }
                }
                HStack {
                    TextField("Latitude", text: $latitude).keyboardType(.numbersAndPunctuation)
                    TextField("Longitude", text: $longitude).keyboardType(.numbersAndPunctuation)
                }
                Button("Add waypoint", action: addWaypoint)
                    .disabled(Double(latitude) == nil || Double(longitude) == nil)
                if !points.isEmpty {
                    Text("\(points.count) waypoint\(points.count == 1 ? "" : "s") · \(estimatedDistanceLabel)")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("Remove last waypoint", role: .destructive) { _ = points.popLast(); updateCamera() }
                }
            }
            .listRowBackground(FFTheme.parchment1)

            Section("Community route density") {
                Map(position: $camera) {
                    ForEach(communityCells) { cell in
                        Annotation("Community activity density", coordinate: CLLocationCoordinate2D(latitude: cell.latitude, longitude: cell.longitude)) {
                            Circle().fill(FFTheme.hearth.opacity(min(0.8, 0.15 + Double(cell.count) / 12)))
                                .frame(width: 14, height: 14)
                        }
                    }
                    if points.count > 1 {
                        MapPolyline(coordinates: coordinates)
                            .stroke(FFTheme.emerald, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
                    }
                    ForEach(Array(points.enumerated()), id: \.offset) { item in
                        Annotation("Waypoint \(item.offset + 1)", coordinate: CLLocationCoordinate2D(latitude: item.element[0], longitude: item.element[1])) {
                            Image(systemName: item.offset == 0 ? "figure.run" : "mappin.circle.fill")
                                .foregroundStyle(item.offset == 0 ? FFTheme.emerald : FFTheme.hearth)
                        }
                    }
                }
                .frame(height: 270)
                .clipShape(RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
                Text("Density is public-route activity rounded to approximate areas; it never reveals another member's exact track.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .listRowBackground(FFTheme.parchment1)

            Section {
                Button(isSaving ? "Saving…" : "Save private route") { Task { await save() } }
                    .disabled(points.count < 2 || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
            }
            .listRowBackground(FFTheme.parchment1)

            Section("Saved routes") {
                if savedRoutes.isEmpty {
                    Text("No saved routes yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(savedRoutes) { route in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(route.name).font(.headline)
                            Text("\(route.activityType) · \(String(format: "%.2f km", route.distanceKm))")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .listRowBackground(FFTheme.parchment1)
        }
        .ffListChrome()
        .navigationTitle("Route builder")
        .task { await load() }
        .alert("Route builder", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK", role: .cancel) { message = nil }
        } message: { Text(message ?? "") }
    }

    private var coordinates: [CLLocationCoordinate2D] {
        points.map { CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) }
    }

    private var estimatedDistanceLabel: String {
        let meters = zip(points.dropFirst(), points).reduce(0.0) { total, pair in
            total + CLLocation(latitude: pair.0[0], longitude: pair.0[1]).distance(from: CLLocation(latitude: pair.1[0], longitude: pair.1[1]))
        }
        return String(format: "%.2f km", meters / 1000)
    }

    private func addWaypoint() {
        guard let lat = Double(latitude), let lon = Double(longitude), (-90...90).contains(lat), (-180...180).contains(lon) else {
            message = "Enter a valid latitude and longitude."
            return
        }
        points.append([lat, lon])
        latitude = ""; longitude = ""
        updateCamera()
    }

    private func updateCamera() {
        guard let last = points.last else { return }
        camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: last[0], longitude: last[1]), span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)))
    }

    private func load() async {
        async let routes = APIClient.shared.fetchSavedRoutes()
        async let heatmap = APIClient.shared.fetchHeatmap(community: true)
        savedRoutes = (try? await routes) ?? []
        let publicHeatmap = try? await heatmap
        communityCells = publicHeatmap?.cells ?? []
        if let cell = communityCells.first {
            camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: cell.latitude, longitude: cell.longitude), span: MKCoordinateSpan(latitudeDelta: 0.12, longitudeDelta: 0.12)))
        }
    }

    private func save() async {
        isSaving = true
        do {
            _ = try await APIClient.shared.saveRoute(name: name.trimmingCharacters(in: .whitespacesAndNewlines), activityType: activityType, path: points)
            message = "Route saved privately."
            name = ""; points = []
            savedRoutes = (try? await APIClient.shared.fetchSavedRoutes()) ?? savedRoutes
        } catch {
            message = error.localizedDescription
        }
        isSaving = false
    }
}

#Preview { NavigationStack { RouteBuilderView() } }
