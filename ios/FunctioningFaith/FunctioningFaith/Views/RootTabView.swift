import SwiftUI

struct RootTabView: View {
    @EnvironmentObject private var session: NativeSession
    @AppStorage("onboarding.pendingUserID") private var pendingOnboardingUserID = ""

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
        .fullScreenCover(isPresented: onboardingIsPresented) {
            SocialOnboardingView {
                pendingOnboardingUserID = ""
            }
        }
    }

    private var onboardingIsPresented: Binding<Bool> {
        Binding(
            get: { SocialOnboardingGate.shouldPresent(pendingUserID: pendingOnboardingUserID, profileID: session.profile?.id) },
            set: { if !$0 { pendingOnboardingUserID = "" } }
        )
    }
}

#Preview { RootTabView().environmentObject(NativeSession()) }
