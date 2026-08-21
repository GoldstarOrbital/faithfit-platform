import SwiftUI

struct RootTabView: View {
    @EnvironmentObject private var session: NativeSession
    @EnvironmentObject private var network: NetworkMonitor
    @EnvironmentObject private var deepLinks: DeepLinkRouter
    @AppStorage("onboarding.pendingUserID") private var pendingOnboardingUserID = ""
    @StateObject private var dmStore = DMStore()

    var body: some View {
        VStack(spacing: 0) {
            OfflineBanner()

            TabView(selection: $deepLinks.selectedTab) {
                NavigationStack { HomeFeedView() }
                    .tabItem { Label("Home", systemImage: "house.fill") }
                    .tag(AppTab.home)

                NavigationStack { WorkoutView() }
                    .tabItem { Label("Train", systemImage: "figure.run") }
                    .tag(AppTab.workouts)

                NavigationStack { ExploreView() }
                    .tabItem { Label("Explore", systemImage: "safari.fill") }
                    .tag(AppTab.explore)

                NavigationStack { DMInboxView().environmentObject(dmStore) }
                    .tabItem { Label("Messages", systemImage: "bubble.left.and.bubble.right.fill") }
                    .badge(dmStore.unreadTotal > 0 ? dmStore.unreadTotal : 0)
                    .tag(AppTab.messages)

                NavigationStack { ProfileView() }
                    .tabItem { Label("Profile", systemImage: "person.crop.circle.fill") }
                    .tag(AppTab.profile)
            }
        }
        .task {
            if let id = session.profile?.id {
                await dmStore.configure(myUserID: id)
                await dmStore.loadInbox()
            }
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

#Preview {
    RootTabView()
        .environmentObject(NativeSession())
        .environmentObject(NetworkMonitor.shared)
        .environmentObject(DeepLinkRouter())
}
