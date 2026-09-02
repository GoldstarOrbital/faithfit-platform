import SwiftUI
import MapKit
import UIKit

/// Build a route by tapping the map, then save it to the member's private
/// route library. Community density is deliberately coarse and comes only
/// from public routes, matching the privacy contract used by HeatmapView.
///
/// Previously the only way to add a waypoint was typing its exact latitude
/// and longitude by hand -- correct, but nobody actually knows a trailhead's
/// coordinates to five decimal places. Tapping the map is the primary flow
/// now; typed coordinates remain available underneath for the rare case
/// someone has an exact reference point to enter.
struct RouteBuilderView: View {
    @State private var name = ""
    @State private var activityType = "Run"
    @State private var manualLatitude = ""
    @State private var manualLongitude = ""
    @State private var points: [[Double]] = []
    @State private var savedRoutes: [SavedRoute] = []
    @State private var communityCells: [HeatmapCell] = []
    @State private var camera: MapCameraPosition = .automatic
    @State private var isSaving = false
    @State private var message: String?

    var body: some View {
        List {
            Section {
                MapReader { proxy in
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
                                Button { removeWaypoint(at: item.offset) } label: {
                                    Image(systemName: item.offset == 0 ? "figure.run.circle.fill" : "mappin.circle.fill")
                                        .font(.system(size: item.offset == 0 ? 15 : 13, weight: .bold))
                                        .foregroundStyle(item.offset == 0 ? FFTheme.emerald : FFTheme.hearth)
                                        .frame(width: 30, height: 30)
                                        .background(Circle().fill(.white).shadow(radius: 1.5))
                                        .contentShape(Circle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .gesture(
                        SpatialTapGesture()
                            .onEnded { value in
                                guard let coordinate = proxy.convert(value.location, from: .local) else { return }
                                points.append([coordinate.latitude, coordinate.longitude])
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                updateCamera()
                            }
                    )
                }
                .frame(height: 320)
                .clipShape(RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
                .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))

                Text("Tap the map to drop a waypoint in order. Tap a pin to remove it.")
                    .font(.caption).foregroundStyle(.secondary)
                if !points.isEmpty {
                    HStack {
                        Text("\(points.count) waypoint\(points.count == 1 ? "" : "s") · \(estimatedDistanceLabel)")
                            .font(.caption.weight(.semibold))
                        Spacer()
                        Button("Clear route", role: .destructive) {
                            points = []
                            UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
                        }
                        .font(.caption)
                    }
                }
                Text("Community activity density is public-route activity rounded to approximate areas; it never reveals another member's exact track.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .listRowBackground(FFTheme.parchment1)

            Section("Route details") {
                TextField("Route name", text: $name)
                Picker("Activity", selection: $activityType) {
                    ForEach(["Run", "Ride", "Walk", "Hike", "Ski"], id: \.self) { Text($0).tag($0) }
                }
                DisclosureGroup("Add a waypoint by coordinates") {
                    HStack {
                        TextField("Latitude", text: $manualLatitude).keyboardType(.numbersAndPunctuation)
                        TextField("Longitude", text: $manualLongitude).keyboardType(.numbersAndPunctuation)
                    }
                    Button("Add waypoint", action: addManualWaypoint)
                        .disabled(Double(manualLatitude) == nil || Double(manualLongitude) == nil)
                }
                .font(.subheadline)
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
                            Text("\(route.activityType) · \(Units.distanceString(km: route.distanceKm))")
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
        return Units.distanceString(km: meters / 1000)
    }

    private func removeWaypoint(at index: Int) {
        guard points.indices.contains(index) else { return }
        points.remove(at: index)
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
    }

    private func addManualWaypoint() {
        guard let lat = Double(manualLatitude), let lon = Double(manualLongitude), (-90...90).contains(lat), (-180...180).contains(lon) else {
            message = "Enter a valid latitude and longitude."
            return
        }
        points.append([lat, lon])
        manualLatitude = ""; manualLongitude = ""
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
