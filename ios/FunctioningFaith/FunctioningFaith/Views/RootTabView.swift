import SwiftUI

/// The app's root shell. See AppShell.swift for the design: a persistent
/// global bottom bar (Home, Reels, Scripture, Messages, Search) plus a
/// side panel (opened from the top-left brand mark) for Train, Explore,
/// and Profile, each of which shows its own sub-bar in place of the
/// global one while you're inside it. The Bible Answers AI stays reachable
/// everywhere via a floating button, independent of whichever bar is
/// currently showing.
struct RootTabView: View {
    @EnvironmentObject private var session: NativeSession
    @EnvironmentObject private var network: NetworkMonitor
    @EnvironmentObject private var deepLinks: DeepLinkRouter
    @StateObject private var dmStore = DMStore()
    @State private var showSidePanel = false
    @State private var showAskAI = false

    var body: some View {
        VStack(spacing: 0) {
            OfflineBanner()

            ZStack(alignment: .leading) {
                ZStack(alignment: .bottom) {
                    currentSection
                    if isGlobalBarActive {
                        FeatureBottomBar(items: globalBarItems, selection: globalBarSelection)
                    }
                    askAIButton
                }
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
        .sheet(isPresented: $showAskAI) {
            NavigationStack { BibleAnswersView() }
        }
    }

    // Every section stays alive underneath, only one visible at a time --
    // a `switch` here would destroy and recreate whichever shell you leave,
    // losing its own sub-tab selection and scroll position every time you
    // navigate away and back. This is the same "all alive, toggle
    // visibility" trick TabView itself uses under the hood.
    private var currentSection: some View {
        ZStack {
            section(.home) { HomeSectionShell(onTapLogo: openPanel) }
            section(.reels) { ReelsSectionShell(onTapLogo: openPanel) }
            section(.scripture) { ScriptureSectionShell(onTapLogo: openPanel) }
            section(.messages) { MessagesSectionShell(onTapLogo: openPanel) }
            section(.search) { SearchSectionShell(onTapLogo: openPanel) }
            section(.workouts) { TrainSectionShell(onTapLogo: openPanel) }
            section(.explore) { ExploreSectionShell(onTapLogo: openPanel) }
            section(.profile) { ProfileSectionShell(onTapLogo: openPanel) }
            section(.settings) { SettingsSectionShell(onTapLogo: openPanel) }
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

    // MARK: - Global bottom bar

    private var isGlobalBarActive: Bool {
        AppTab.globalBarSections.contains(deepLinks.selectedTab)
    }

    private var globalBarItems: [FeatureBottomBarItem] {
        AppTab.globalBarSections.map { tab in
            FeatureBottomBarItem(
                id: tab.title,
                title: tab.title,
                systemImage: tab.systemImage,
                badge: tab == .messages ? dmStore.unreadTotal : 0
            )
        }
    }

    private var globalBarSelection: Binding<String> {
        Binding(
            get: { deepLinks.selectedTab.title },
            set: { newTitle in
                if let match = AppTab.globalBarSections.first(where: { $0.title == newTitle }) {
                    deepLinks.selectedTab = match
                }
            }
        )
    }

    // MARK: - Ask Bible Answers (global)

    private var askAIButton: some View {
        // Bottom-CENTER, not bottom-trailing: confirmed live that trailing
        // placement collides with two different, unrelated things that both
        // happen to live in that same corner -- a row's trailing "Follow"
        // button on Explore, and Reels' own vertical action stack (like/
        // save/reply/share/not-interested) which also hugs the trailing
        // edge. Center avoids both at the source instead of chasing every
        // screen's trailing content one at a time.
        HStack {
            Spacer()
            Button {
                showAskAI = true
            } label: {
                Image(systemName: "sparkles")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(FFTheme.cream)
                    .frame(width: FFTheme.minTapTarget, height: FFTheme.minTapTarget)
                    .background(
                        LinearGradient(colors: [FFTheme.meadow2, FFTheme.meadowDeep], startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: Circle()
                    )
                    .overlay(Circle().strokeBorder(FFTheme.goldBright.opacity(0.5), lineWidth: 1))
                    .shadow(color: FFTheme.walnut.opacity(0.35), radius: 8, x: 0, y: 3)
            }
            .accessibilityLabel("Ask Bible Answers")
            .accessibilityHint("Opens a chat to ask any Bible or faith question, answered with verified Scripture")
            Spacer()
        }
        // Sits just above whichever bar is showing (bar height is ~78-80pt
        // including its own safe-area padding) rather than hovering well
        // above it -- confirmed live that hovering higher (previously
        // 56pt button at 70pt padding) reached far enough into ordinary
        // list content to cover a trailing-aligned row button. Smaller
        // footprint (44pt, Apple's own minimum tap target) plus sitting
        // lower cuts how far it intrudes into content without disappearing
        // into the bar itself.
        .padding(.bottom, 54)
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
                .accessibilityHint("Shows Train, Explore, and Profile")
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
