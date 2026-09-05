import SwiftUI

/// The app's root shell. See AppShell.swift for the design this replaced a
/// plain TabView with: a full side panel (opened from the top-left brand
/// mark) listing Home/Train/Explore/Messages/Profile, and each of those
/// showing its own five-item bottom bar for its real sub-areas once you're
/// inside it.
struct RootTabView: View {
    @EnvironmentObject private var session: NativeSession
    @EnvironmentObject private var network: NetworkMonitor
    @EnvironmentObject private var deepLinks: DeepLinkRouter
    @StateObject private var dmStore = DMStore()
    @State private var showSidePanel = false

    var body: some View {
        VStack(spacing: 0) {
            OfflineBanner()

            ZStack(alignment: .leading) {
                currentSection
                    .environmentObject(dmStore)

                if showSidePanel {
                    Color.black.opacity(0.25)
                        .ignoresSafeArea()
                        .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { showSidePanel = false } }
                        .transition(.opacity)
                        .accessibilityLabel("Close menu")
                        .accessibilityAddTraits(.isButton)

                    SidePanelView(
                        selection: $deepLinks.selectedTab,
                        unreadMessages: dmStore.unreadTotal,
                        onSelect: { section in
                            deepLinks.selectedTab = section
                            withAnimation(.easeInOut(duration: 0.2)) { showSidePanel = false }
                        }
                    )
                    .frame(maxWidth: 300)
                    .transition(.move(edge: .leading))
                    .ignoresSafeArea(edges: .vertical)
                }
            }
        }
        .task {
            if let id = session.profile?.id {
                await dmStore.configure(myUserID: id)
                await dmStore.loadInbox()
            }
        }
    }

    // Every section stays alive underneath, only one visible at a time --
    // a `switch` here would destroy and recreate whichever shell you leave,
    // losing its own sub-tab selection and scroll position every time the
    // side panel is used. This is the same "all alive, toggle visibility"
    // trick TabView itself uses under the hood.
    private var currentSection: some View {
        ZStack {
            section(.home) { HomeSectionShell(onTapLogo: openPanel) }
            section(.workouts) { TrainSectionShell(onTapLogo: openPanel) }
            section(.explore) { ExploreSectionShell(onTapLogo: openPanel) }
            section(.messages) { MessagesSectionShell(onTapLogo: openPanel) }
            section(.profile) { ProfileSectionShell(onTapLogo: openPanel) }
        }
    }

    @ViewBuilder
    private func section<Content: View>(_ tab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        let isActive = deepLinks.selectedTab == tab
        content()
            .opacity(isActive ? 1 : 0)
            .allowsHitTesting(isActive)
            .accessibilityHidden(!isActive)
    }

    private func openPanel() {
        withAnimation(.easeInOut(duration: 0.2)) { showSidePanel = true }
    }
}

extension View {
    /// Every section shell's own NavigationStack calls this on its root
    /// screen so the brand mark opens the side panel from anywhere inside
    /// that section, not just its landing screen.
    func ffRootBrand(onTapLogo: @escaping () -> Void) -> some View {
        toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: onTapLogo) {
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
                }
                .accessibilityLabel("Open menu")
                .accessibilityHint("Shows Home, Train, Explore, Messages, and Profile")
            }
        }
    }
}

#Preview {
    RootTabView()
        .environmentObject(NativeSession())
        .environmentObject(NetworkMonitor.shared)
        .environmentObject(DeepLinkRouter())
}
