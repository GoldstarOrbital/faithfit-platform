import SwiftUI
import MapKit

struct HeatmapView: View {
    @State private var community = false
    @State private var map: WorkoutHeatmap?
    @State private var position: MapCameraPosition = .automatic
    @State private var error: String?
    var body: some View {
        VStack(spacing: 0) {
            Picker("Heatmap", selection: $community) { Text("My history").tag(false); Text("Community").tag(true) }.pickerStyle(.segmented).padding()
            Map(position: $position) {
                ForEach(map?.cells ?? []) { cell in
                    Annotation("\(cell.count) activities", coordinate: CLLocationCoordinate2D(latitude: cell.latitude, longitude: cell.longitude)) {
                        Circle().fill(FFTheme.hearth.opacity(min(0.9,0.2+Double(cell.count)/10))).frame(width: max(12,min(42,10+CGFloat(cell.count)*4)), height:max(12,min(42,10+CGFloat(cell.count)*4))).overlay(Circle().stroke(.white.opacity(.7),lineWidth:1))
                    }
                }
            }
            .overlay { if map?.cells.isEmpty == true { ContentUnavailableView("No route density yet", systemImage:"map", description:Text("Record a GPS workout to build your personal heatmap.")) } }
            .overlay(alignment:.bottom) { if let map { Text(map.privacy).font(.caption).padding(10).background(.thinMaterial,in:Capsule()).padding() } }
        }.navigationTitle("Heatmap").task { await load() }.onChange(of: community) { _,_ in Task { await load() } }.alert("Could not load heatmap",isPresented:Binding(get:{error != nil},set:{if !$0 {error=nil}})){Button("OK",role:.cancel){}} message:{Text(error ?? "")}
    }
    private func load() async { do { let value=try await APIClient.shared.fetchHeatmap(community:community); map=value; if let cell=value.cells.first { position=.region(MKCoordinateRegion(center:CLLocationCoordinate2D(latitude:cell.latitude,longitude:cell.longitude),span:MKCoordinateSpan(latitudeDelta:0.08,longitudeDelta:0.08))) } } catch { self.error=error.localizedDescription } }
}
