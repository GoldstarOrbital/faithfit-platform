import SwiftUI

struct ExploreView: View {
    var body: some View {
        List {
            Section("Challenges") { Text("Faithful Five - weekly workout challenge") }
            Section("Groups") { Text("Sunrise 5K Fellowship (synced via Gloo)") }
            Section("Quests") { Text("Scripture Streak - 7 day devotion quest") }
        }
        .navigationTitle("Explore")
    }
}

#Preview { NavigationStack { ExploreView() } }
