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
                NavigationStack { HomeFeedView().ffRootBrand() }
                    .tabItem { Label("Home", systemImage: "house.fill") }
                    .tag(AppTab.home)

                NavigationStack { WorkoutView().ffRootBrand() }
                    .tabItem { Label("Train", systemImage: "figure.run") }
                    .tag(AppTab.workouts)

                NavigationStack { ExploreView().ffRootBrand() }
                    .tabItem { Label("Explore", systemImage: "safari.fill") }
                    .tag(AppTab.explore)

                NavigationStack { DMInboxView().environmentObject(dmStore).ffRootBrand() }
                    .tabItem { Label("Messages", systemImage: "bubble.left.and.bubble.right.fill") }
                    .badge(dmStore.unreadTotal > 0 ? dmStore.unreadTotal : 0)
                    .tag(AppTab.messages)

                NavigationStack { ProfileView().ffRootBrand() }
                    .tabItem { Label("Profile", systemImage: "person.crop.circle.fill") }
                    .tag(AppTab.profile)
            }
            // A single authenticated message store must be available to every
            // navigation path (home, search, notifications, and the tab). A
            // view that creates an inbox without this environment object
            // terminates at runtime as soon as it is opened.
            .environmentObject(dmStore)
            .ffCurrentTabBehavior()
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

private extension View {
    /// Keeps the approved mark in the unused leading navigation space on every
    /// root tab, while allowing pushed screens to keep a normal back button.
    func ffRootBrand() -> some View {
        toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Image("BrandMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 40, height: 40)
                    .padding(3)
                    .background(.white, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(FFTheme.gold.opacity(0.32), lineWidth: 1))
                    .accessibilityLabel("Functioning Faith")
            }
        }
    }
}

private extension View {
    @ViewBuilder
    func ffCurrentTabBehavior() -> some View {
        if #available(iOS 26.0, *) {
            self.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            self
        }
    }
}

#Preview {
    RootTabView()
        .environmentObject(NativeSession())
        .environmentObject(NetworkMonitor.shared)
        .environmentObject(DeepLinkRouter())
}
