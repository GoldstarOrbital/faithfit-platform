import SwiftUI

struct RootTabView: View {
    var body: some View {
        TabView {
            NavigationStack { HomeFeedView() }
                .tabItem { Label("Home", systemImage: "house.fill") }

            NavigationStack { WorkoutView() }
                .tabItem { Label("Workouts", systemImage: "figure.run") }

            NavigationStack { ExploreView() }
                .tabItem { Label("Explore", systemImage: "safari.fill") }

            NavigationStack { ProfileView() }
                .tabItem { Label("Profile", systemImage: "person.crop.circle.fill") }
        }
    }
}

#Preview { RootTabView() }
