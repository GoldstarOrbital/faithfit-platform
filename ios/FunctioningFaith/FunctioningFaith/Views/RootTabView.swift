import SwiftUI

struct RootTabView: View {
    @EnvironmentObject private var session: NativeSession
    @EnvironmentObject private var network: NetworkMonitor
    @EnvironmentObject private var deepLinks: DeepLinkRouter
    @StateObject private var dmStore = DMStore()
    @State private var explorePath = NavigationPath()

    var body: some View {
        VStack(spacing: 0) {
            OfflineBanner()

            TabView(selection: tabSelection) {
                NavigationStack { HomeFeedView().ffRootBrand() }
                    .tabItem { Label("Home", systemImage: "house.fill") }
                    .tag(AppTab.home)

                NavigationStack { WorkoutView().ffRootBrand() }
                    .tabItem { Label("Train", systemImage: "figure.run") }
                    .tag(AppTab.workouts)

                NavigationStack(path: $explorePath) { ExploreView().ffRootBrand() }
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
        .onChange(of: deepLinks.selectedTab) { _, tab in
            if tab == .explore { resetExplore() }
        }
    }

    private var tabSelection: Binding<AppTab> {
        Binding(
            get: { deepLinks.selectedTab },
            set: { tab in
                // An Explore tap is always a request for the dashboard. This
                // prevents a retained NavigationStack from reopening a deep
                // catalog destination such as Athlete Recruiting.
                if tab == .explore { resetExplore() }
                deepLinks.selectedTab = tab
            }
        )
    }

    // Pops to the dashboard root without tearing down the NavigationStack's
    // identity. The previous approach forced a fresh .id() on the whole
    // stack on every Explore selection -- that's a full subtree teardown
    // and rebuild, and it's the reason every catalog tile started resolving
    // to the same wrong destination (Athlete Recruiting): a
    // .navigationDestination(for:) registration surviving a forced identity
    // change is exactly the fragile case that produces stale routing.
    // Clearing the bound path pops to root without touching identity at all.
    private func resetExplore() { explorePath = NavigationPath() }
}

private extension View {
    /// Keeps the approved mark in the unused leading navigation space on every
    /// root tab, while allowing pushed screens to keep a normal back button.
    func ffRootBrand() -> some View {
        toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Image("BrandMark")
                    .resizable()
                    // Measured: the source PNG's opaque content already
                    // fills ~99% of its canvas (a parchment roundel behind
                    // the cross monogram, not padding around it) -- an
                    // earlier fix here assumed padding that isn't there and
                    // zoomed past real artwork instead. Native 1:1 fill,
                    // clipped to a circle, is the correct crop. 30pt keeps
                    // real margin inside a 44pt nav bar instead of nearly
                    // filling it.
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 30, height: 30)
                    .clipShape(Circle())
                    .accessibilityLabel("Functioning Faith")
            }
        }
    }

}

private extension View {
    @ViewBuilder
    func ffCurrentTabBehavior() -> some View {
        // Keep the tab bar stable until the iOS 26 SDK is available on every
        // supported CI runner. The native API cannot be referenced by older
        // Xcode toolchains, even inside an availability check.
        self
    }
}

#Preview {
    RootTabView()
        .environmentObject(NativeSession())
        .environmentObject(NetworkMonitor.shared)
        .environmentObject(DeepLinkRouter())
}
