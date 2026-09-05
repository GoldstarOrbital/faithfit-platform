import SwiftUI

/// The app's top-level navigation, redesigned around two pieces:
///
/// 1. A full side panel (like X's own left-drawer pattern) opened by tapping
///    the brand mark in the top-left corner, listing the five main sections
///    -- Home, Train, Explore, Messages, Profile -- that used to live in a
///    permanent bottom tab bar.
/// 2. Once inside a section, that section shows its OWN five-item bottom
///    bar for switching between its real sub-areas (e.g. Explore's Faith /
///    Community / Reels / Discover / Search), instead of one bar meaning
///    the same five things everywhere.
///
/// Messages doesn't get a bottom bar here: today it only has two genuinely
/// distinct destinations (the inbox, and starting a new conversation), and
/// padding that out to five with invented tabs would be worse than being
/// honest that it isn't there yet.

// MARK: - AppTab metadata

extension AppTab: Identifiable {
    var id: Self { self }

    static let orderedSections: [AppTab] = [.home, .workouts, .explore, .messages, .profile]

    var title: String {
        switch self {
        case .home: return "Home"
        case .workouts: return "Train"
        case .explore: return "Explore"
        case .messages: return "Messages"
        case .profile: return "Profile"
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house.fill"
        case .workouts: return "figure.run"
        case .explore: return "safari.fill"
        case .messages: return "bubble.left.and.bubble.right.fill"
        case .profile: return "person.crop.circle.fill"
        }
    }
}

// MARK: - Side panel

/// Full-panel section switcher opened from the top-left brand mark.
struct SidePanelView: View {
    @Binding var selection: AppTab
    let unreadMessages: Int
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

            ForEach(AppTab.orderedSections) { section in
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
                if section == .messages && unreadMessages > 0 {
                    Text("\(unreadMessages)")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(FFTheme.accent))
                        .foregroundStyle(.white)
                }
            }
            .padding(.horizontal, FFTheme.Space.lg)
            .padding(.vertical, FFTheme.Space.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? FFTheme.parchment1 : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(section.title + (section == .messages && unreadMessages > 0 ? ", \(unreadMessages) unread" : ""))
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

/// Home's five real sub-areas: the two feed modes, plus the three
/// destinations that used to be Home's own toolbar icons (Notifications,
/// Search) or buried in Profile (Saved).
struct HomeSectionShell: View {
    let onTapLogo: () -> Void
    @State private var subTab = "forYou"
    @State private var unreadNotifications = 0

    private var items: [FeatureBottomBarItem] {
        [
            FeatureBottomBarItem(id: "forYou", title: "For You", systemImage: "sparkles"),
            FeatureBottomBarItem(id: "following", title: "Following", systemImage: "person.2.fill"),
            FeatureBottomBarItem(id: "saved", title: "Saved", systemImage: "bookmark.fill"),
            FeatureBottomBarItem(id: "notifications", title: "Alerts", systemImage: "bell.fill", badge: unreadNotifications),
            FeatureBottomBarItem(id: "search", title: "Search", systemImage: "magnifyingglass"),
        ]
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Group {
                    switch subTab {
                    case "forYou": HomeFeedView(mode: .forYou)
                    case "following": HomeFeedView(mode: .following)
                    case "saved": SavedPostsView()
                    case "notifications": NotificationsView()
                    default: SearchView()
                    }
                }
                .reserveFeatureBottomBar()
                FeatureBottomBar(items: items, selection: $subTab)
            }
            .ffRootBrand(onTapLogo: onTapLogo)
        }
        .task {
            unreadNotifications = (try? await APIClient.shared.fetchNotifications().unreadCount) ?? 0
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

/// Explore's five real sub-areas -- Faith & Scripture and Discover's
/// catalog tiles each get their own screen instead of sharing one long
/// scroll with Community; Reels and Search, previously catalog tiles
/// themselves, are common enough to deserve a direct tab.
struct ExploreSectionShell: View {
    let onTapLogo: () -> Void
    @State private var subTab = "community"

    private let items: [FeatureBottomBarItem] = [
        FeatureBottomBarItem(id: "faith", title: "Faith", systemImage: "book.fill"),
        FeatureBottomBarItem(id: "community", title: "Community", systemImage: "person.3.fill"),
        FeatureBottomBarItem(id: "reels", title: "Reels", systemImage: "rectangle.stack.fill"),
        FeatureBottomBarItem(id: "discover", title: "Discover", systemImage: "safari.fill"),
        FeatureBottomBarItem(id: "search", title: "Search", systemImage: "magnifyingglass"),
    ]

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                // Reels alone skips reserving space for the bar -- it's
                // full-bleed video, and the bar sits over it translucently
                // the same way it does in Reels-style apps generally,
                // rather than shrinking the video to make room.
                switch subTab {
                case "faith": ExploreFaithView().reserveFeatureBottomBar()
                case "community": ExploreCommunityView().reserveFeatureBottomBar()
                case "reels": ReelsFeedView()
                case "discover": ExploreDiscoverView().reserveFeatureBottomBar()
                default: SearchView().reserveFeatureBottomBar()
                }
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
