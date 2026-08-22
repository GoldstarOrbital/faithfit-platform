import SwiftUI

struct RootTabView: View {
    @EnvironmentObject private var session: NativeSession
    @EnvironmentObject private var network: NetworkMonitor
    @EnvironmentObject private var deepLinks: DeepLinkRouter
    @AppStorage("onboarding.pendingUserID") private var pendingOnboardingUserID = ""
    @StateObject private var dmStore = DMStore()
    @State private var explorePath = NavigationPath()

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
        .fullScreenCover(isPresented: onboardingIsPresented) {
            SocialOnboardingView {
                pendingOnboardingUserID = ""
            }
        }
        .onChange(of: deepLinks.selectedTab) { tab in
            // Explore is a dashboard, not a linear wizard. Returning to this
            // tab must show the dashboard instead of a retained detail stack.
            if tab == .explore { explorePath = NavigationPath() }
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
                    .frame(width: 46, height: 46)
                    .padding(2)
                    .background(FFTheme.parchment2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(FFTheme.goldBright.opacity(0.7), lineWidth: 1.25))
                    .shadow(color: .black.opacity(0.22), radius: 4, x: 0, y: 2)
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
