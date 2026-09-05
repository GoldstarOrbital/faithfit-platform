import SwiftUI

/// The app's top-level navigation, built around three pieces:
///
/// 1. A persistent GLOBAL bottom bar with the app's five most common
///    destinations: Home, Reels, Scripture, Messages, Search.
/// 2. A full side panel (like X's own left-drawer pattern) opened by
///    tapping the brand mark in the top-left corner, for the rest --
///    Train, Explore, Profile -- that don't fit in five slots.
/// 3. Once inside Train, Explore, or Profile, THAT section shows its own
///    five-item bottom bar for its real sub-areas (e.g. Explore's Faith /
///    Community / Discover), replacing the global bar while you're there.
///    Only one bottom bar is ever on screen at once.
///
/// Messages has no sub-bar of its own: today it only has two genuinely
/// distinct destinations (the inbox, and starting a new conversation), and
/// padding that out to five with invented tabs would be worse than being
/// honest that it isn't there yet.

// MARK: - AppTab metadata

extension AppTab: Identifiable {
    var id: Self { self }

    /// The persistent global bottom bar's five items, in order.
    static let globalBarSections: [AppTab] = [.home, .reels, .scripture, .messages, .search]
    /// Everything else -- reached through the side panel instead, since it
    /// doesn't fit in the global bar's five slots.
    static let overflowSections: [AppTab] = [.workouts, .explore, .profile]

    var title: String {
        switch self {
        case .home: return "Home"
        case .workouts: return "Train"
        case .explore: return "Explore"
        case .messages: return "Messages"
        case .profile: return "Profile"
        case .reels: return "Reels"
        case .scripture: return "Scripture"
        case .search: return "Search"
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house.fill"
        case .workouts: return "figure.run"
        case .explore: return "safari.fill"
        case .messages: return "bubble.left.and.bubble.right.fill"
        case .profile: return "person.crop.circle.fill"
        case .reels: return "rectangle.stack.fill"
        case .scripture: return "book.fill"
        case .search: return "magnifyingglass"
        }
    }
}

// MARK: - Side panel

/// Full-panel switcher for the sections that don't fit in the global
/// bottom bar's five slots (Train, Explore, Profile). Home, Reels,
/// Scripture, Messages, and Search live in the bar itself now, so they're
/// not repeated here.
struct SidePanelView: View {
    @Binding var selection: AppTab
    let onSelect: (AppTab) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: FFTheme.Space.sm) {
                Image("BrandMark")
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 44, height: 44)
                    .clipShape(Circle())
                Text("Functioning Faith")
                    .font(FFTheme.display(18))
                    .foregroundStyle(FFTheme.ink)
            }
            .padding(FFTheme.Space.lg)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            Divider().background(FFTheme.hairline)

            ForEach(AppTab.overflowSections) { section in
                sectionRow(section)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FFTheme.parchment0.ignoresSafeArea())
    }

    private func sectionRow(_ section: AppTab) -> some View {
        let isSelected = section == selection
        return Button {
            onSelect(section)
        } label: {
            HStack(spacing: FFTheme.Space.md) {
                Image(systemName: section.systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(isSelected ? FFTheme.meadowDeep : FFTheme.inkSoft)
                    .frame(width: 28)
                Text(section.title)
                    .font(.body.weight(isSelected ? .semibold : .regular))
                    .foregroundStyle(FFTheme.ink)
                Spacer()
            }
            .padding(.horizontal, FFTheme.Space.lg)
            .padding(.vertical, FFTheme.Space.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? FFTheme.parchment1 : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(section.title)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Per-feature bottom bar

struct FeatureBottomBarItem: Identifiable, Equatable {
    let id: String
    let title: String
    let systemImage: String
    var badge: Int = 0
}

/// The "5 piece horizontal bar" a feature shows for its own sub-areas.
/// Visually distinct from iOS's system tab bar (walnut/cream, matching this
/// app's own chrome) so it reads as "you're inside a feature," not as a
/// second, competing set of app-level tabs.
struct FeatureBottomBar: View {
    let items: [FeatureBottomBarItem]
    @Binding var selection: String

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items) { item in
                let isSelected = item.id == selection
                Button {
                    selection = item.id
                } label: {
                    VStack(spacing: 3) {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: item.systemImage)
                                .font(.system(size: 19, weight: isSelected ? .semibold : .regular))
                            if item.badge > 0 {
                                Circle().fill(FFTheme.hearth).frame(width: 7, height: 7).offset(x: 6, y: -3)
                            }
                        }
                        Text(item.title)
                            .font(.system(size: 10, weight: isSelected ? .semibold : .medium))
                    }
                    .foregroundStyle(isSelected ? FFTheme.emerald2 : FFTheme.parchment2.opacity(0.65))
                    .frame(maxWidth: .infinity)
                }
                .accessibilityLabel(item.title + (item.badge > 0 ? ", \(item.badge) unread" : ""))
                .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(.top, FFTheme.Space.xs)
        .padding(.bottom, FFTheme.Space.xxs)
        .background(FFTheme.walnut.ignoresSafeArea(edges: .bottom))
    }
}

// MARK: - Shared shell layout

private extension View {
    /// FeatureBottomBar overlays the bottom of its ZStack rather than
    /// participating in layout, so scrollable content underneath (a List,
    /// a Form) needs this to know to leave room at the bottom instead of
    /// letting its last rows land behind the bar.
    func reserveFeatureBottomBar() -> some View {
        safeAreaInset(edge: .bottom) { Color.clear.frame(height: 60) }
    }
}

// MARK: - Section shells

/// Home is one of the global bottom bar's five items now, not a section
/// with its own sub-bar -- its own For You / Following choice lives as an
/// in-feed toggle (see HomeFeedView's own picker) rather than as bottom-bar
/// items, so the bar isn't showing two different kinds of "tab" at once.
/// Saved moved to Profile; Search is its own global-bar item now (both
/// used to live here as sub-tabs).
struct HomeSectionShell: View {
    let onTapLogo: () -> Void

    var body: some View {
        NavigationStack {
            HomeFeedView()
                .ffRootBrand(onTapLogo: onTapLogo)
        }
    }
}

/// Reels, Scripture, and Search are plain top-level destinations in the
/// global bottom bar -- no sub-bar of their own, just the screen plus the
/// logo button for reaching Train/Explore/Profile.
struct ReelsSectionShell: View {
    let onTapLogo: () -> Void
    var body: some View {
        NavigationStack {
            ReelsFeedView().ffRootBrand(onTapLogo: onTapLogo)
        }
    }
}

struct ScriptureSectionShell: View {
    let onTapLogo: () -> Void
    var body: some View {
        NavigationStack {
            ScriptureView().ffRootBrand(onTapLogo: onTapLogo)
        }
    }
}

/// Its own dedicated NavigationStack, not a sub-tab nested inside another
/// screen's switch -- `.searchable()` binds most reliably to a
/// NavigationStack's own root content, and search living as a conditionally
/// swapped-in case inside Home's (and Explore's) ZStack was the likely
/// cause of it working unreliably before this became a top-level tab.
struct SearchSectionShell: View {
    let onTapLogo: () -> Void
    var body: some View {
        NavigationStack {
            SearchView().ffRootBrand(onTapLogo: onTapLogo)
        }
    }
}

/// Train's five real sub-areas -- these used to be three toolbar icons plus
/// an inline "See all" link on top of WorkoutView's own logging screen;
/// now they're peers instead of being nested inside it.
struct TrainSectionShell: View {
    let onTapLogo: () -> Void
    @State private var subTab = "log"

    private let items: [FeatureBottomBarItem] = [
        FeatureBottomBarItem(id: "log", title: "Log", systemImage: "figure.run"),
        FeatureBottomBarItem(id: "history", title: "History", systemImage: "clock.arrow.circlepath"),
        FeatureBottomBarItem(id: "stats", title: "Stats", systemImage: "chart.bar.fill"),
        FeatureBottomBarItem(id: "breathe", title: "Breathe", systemImage: "wind"),
        FeatureBottomBarItem(id: "heart", title: "Heart", systemImage: "heart.text.square.fill"),
    ]

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Group {
                    switch subTab {
                    case "log": WorkoutView()
                    case "history": WorkoutHistoryView()
                    case "stats": StatsView()
                    case "breathe": BreathworkView()
                    default: HeartCheckInView()
                    }
                }
                .reserveFeatureBottomBar()
                FeatureBottomBar(items: items, selection: $subTab)
            }
            .ffRootBrand(onTapLogo: onTapLogo)
        }
    }
}

/// Explore's own sub-bar -- Faith & Scripture and Discover's catalog tiles
/// each get their own screen instead of sharing one long scroll with
/// Community. Reels and Search used to live here too, but both are now
/// top-level items in the global bottom bar (see ReelsSectionShell /
/// SearchSectionShell above), so they were dropped from here.
struct ExploreSectionShell: View {
    let onTapLogo: () -> Void
    @State private var subTab = "community"

    // Reels and Search moved to the global bottom bar as their own
    // top-level items -- keeping them here too would mean the same
    // destination reachable two ways at once, so Explore's own bar now
    // only carries what's genuinely specific to it.
    private let items: [FeatureBottomBarItem] = [
        FeatureBottomBarItem(id: "faith", title: "Faith", systemImage: "book.fill"),
        FeatureBottomBarItem(id: "community", title: "Community", systemImage: "person.3.fill"),
        FeatureBottomBarItem(id: "discover", title: "Discover", systemImage: "safari.fill"),
    ]

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Group {
                    switch subTab {
                    case "faith": ExploreFaithView()
                    case "community": ExploreCommunityView()
                    default: ExploreDiscoverView()
                    }
                }
                .reserveFeatureBottomBar()
                FeatureBottomBar(items: items, selection: $subTab)
            }
            .ffRootBrand(onTapLogo: onTapLogo)
        }
    }
}

/// Messages, unchanged in content -- no five-item bar, see this file's
/// top-of-file note on why.
struct MessagesSectionShell: View {
    let onTapLogo: () -> Void
    @EnvironmentObject private var dmStore: DMStore

    var body: some View {
        NavigationStack {
            DMInboxView()
                .environmentObject(dmStore)
                .ffRootBrand(onTapLogo: onTapLogo)
        }
    }
}

/// Profile's five real sub-areas, splitting what used to be one very long
/// Form. Circle, Safety, and Saved were already their own standalone
/// screens (just reached via NavigationLink before); Account is a small,
/// self-contained extraction (see ProfileAccountView.swift) of what used to
/// be the Form's last section.
struct ProfileSectionShell: View {
    let onTapLogo: () -> Void
    @State private var subTab = "overview"

    private let items: [FeatureBottomBarItem] = [
        FeatureBottomBarItem(id: "overview", title: "Overview", systemImage: "person.crop.circle.fill"),
        FeatureBottomBarItem(id: "circle", title: "Circle", systemImage: "person.2.circle.fill"),
        FeatureBottomBarItem(id: "safety", title: "Safety", systemImage: "hand.raised.fill"),
        FeatureBottomBarItem(id: "saved", title: "Saved", systemImage: "bookmark.fill"),
        FeatureBottomBarItem(id: "account", title: "Account", systemImage: "gearshape.fill"),
    ]

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Group {
                    switch subTab {
                    case "overview": ProfileView()
                    case "circle": CircleView()
                    case "safety": SafetyView()
                    case "saved": SavedPostsView()
                    default: ProfileAccountView()
                    }
                }
                .reserveFeatureBottomBar()
                FeatureBottomBar(items: items, selection: $subTab)
            }
            .ffRootBrand(onTapLogo: onTapLogo)
        }
    }
}
