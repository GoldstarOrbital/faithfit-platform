import SwiftUI
import UIKit

/// Design tokens aligned with the Railway web app (`webapp/public/styles.css` :root).
/// Native keeps iOS HIG spacing/touch targets; colors, materials, and type mirror
/// the web's "Rustic Silver / Wood" system — walnut + parchment + pewter, lit by
/// meadow-green and hearth-gold, set in Cinzel (display) over Spectral (body serif).
enum FFTheme {
    // MARK: - Spacing (4pt grid — iOS HIG)
    enum Space {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 8
        static let sm: CGFloat = 12
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
        static let xxl: CGFloat = 48
    }

    static let minTapTarget: CGFloat = 44

    enum Radius {
        static let sm: CGFloat = 14   // --radius-sm
        static let md: CGFloat = 18
        static let lg: CGFloat = 20   // --radius
        static let pill: CGFloat = 999
    }

    // MARK: - Brand (web CSS variables)
    /// Page / card parchment
    static let parchment0 = Color(red: 0xE9 / 255, green: 0xE0 / 255, blue: 0xC6 / 255) // --parch-0
    static let parchment1 = Color(red: 0xF6 / 255, green: 0xEF / 255, blue: 0xDC / 255) // --parch-1
    static let parchment2 = Color(red: 0xFD / 255, green: 0xF8 / 255, blue: 0xEA / 255) // --parch-2
    static let parchmentSink = Color(red: 0xDD / 255, green: 0xD2 / 255, blue: 0xB4 / 255) // --parch-sink

    /// Ink
    static let ink = Color(red: 0x33 / 255, green: 0x25 / 255, blue: 0x1A / 255)       // --ink
    static let inkSoft = Color(red: 0x61 / 255, green: 0x50 / 255, blue: 0x3C / 255)   // --ink-soft
    static let muted = Color(red: 0x8D / 255, green: 0x7A / 255, blue: 0x5F / 255)     // --muted

    /// Meadow / forest (primary accent on web)
    static let meadow = Color(red: 0x6F / 255, green: 0x8F / 255, blue: 0x43 / 255)    // --meadow
    static let meadow2 = Color(red: 0x87 / 255, green: 0xA8 / 255, blue: 0x54 / 255)   // --meadow-2
    static let meadowDeep = Color(red: 0x48 / 255, green: 0x63 / 255, blue: 0x2F / 255) // --meadow-deep
    static let emerald = Color(red: 0x7B / 255, green: 0xA8 / 255, blue: 0x4F / 255)   // --emerald
    static let emerald2 = Color(red: 0x9B / 255, green: 0xC4 / 255, blue: 0x6A / 255)  // --emerald-2
    static let forest = Color(red: 0x4F / 255, green: 0x72 / 255, blue: 0x39 / 255)    // --forest
    // Note: web's --forest-2 (#6f8f43) is numerically identical to --meadow; use `meadow`.

    /// Hearth / brass / gold
    static let hearth = Color(red: 0xD9 / 255, green: 0x9A / 255, blue: 0x3F / 255)    // --hearth
    static let hearthSoft = Color(red: 0xF0 / 255, green: 0xC4 / 255, blue: 0x77 / 255) // --hearth-soft
    static let gold = Color(red: 0xB0 / 255, green: 0x8D / 255, blue: 0x46 / 255)      // --gold, --brass
    static let goldBright = Color(red: 0xD9 / 255, green: 0xAB / 255, blue: 0x55 / 255) // --gold-2
    static let brass = gold

    /// Seal (destructive / secondary accent)
    static let seal = Color(red: 0xA2 / 255, green: 0x47 / 255, blue: 0x2F / 255)      // --seal

    /// Walnut chrome (nav bar / tab bar / dark surfaces)
    static let walnut0 = Color(red: 0x3A / 255, green: 0x2A / 255, blue: 0x1A / 255)   // --walnut-0
    static let walnut = Color(red: 0x2B / 255, green: 0x1E / 255, blue: 0x12 / 255)    // --walnut-1
    static let walnutEdge = Color(red: 0x52 / 255, green: 0x40 / 255, blue: 0x2C / 255) // --walnut-edge

    /// Brushed pewter
    static let silver0 = Color(red: 0x9A / 255, green: 0x9E / 255, blue: 0xA6 / 255)   // --silver-0
    static let silver1 = Color(red: 0xC6 / 255, green: 0xCA / 255, blue: 0xD0 / 255)   // --silver-1
    static let silver2 = Color(red: 0xEE / 255, green: 0xF0 / 255, blue: 0xF2 / 255)   // --silver-2

    /// Engraved hairlines on parchment
    static let hairline = Color(red: 0x4A / 255, green: 0x3A / 255, blue: 0x28 / 255).opacity(0.22)
    static let hairlineSoft = Color(red: 0x4A / 255, green: 0x3A / 255, blue: 0x28 / 255).opacity(0.12)

    // Semantic aliases used across the shell
    static let accent = meadow
    static let scripture = forest
    static let success = emerald
    static let warning = hearth
    static let danger = seal
    /// Text-on-walnut (header/tab bar)
    static let cream = parchment2

    // MARK: - Typography
    // Web: Cinzel (display) over Spectral (body serif), both bundled locally
    // (see ios/FunctioningFaith/Fonts-THIRD-PARTY for the SIL OFL license text).
    // Cinzel ships from Google Fonts only as a variable font (wght 400-900), so
    // weight is selected via `.weight()` on top of the registered base instance
    // rather than a separate static file per weight.
    enum FontName {
        static let cinzel = "Cinzel-Regular"
        static let spectral = "Spectral-Regular"
        static let spectralMedium = "Spectral-Medium"
        static let spectralSemibold = "Spectral-SemiBold"
        static let spectralItalic = "Spectral-Italic"
    }

    /// Display / heading type — mirrors web `font-family: 'Cinzel', serif`.
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold, relativeTo style: Font.TextStyle = .headline) -> Font {
        .custom(FontName.cinzel, size: size, relativeTo: style).weight(weight)
    }

    /// Small-caps-ish eyebrow label — mirrors web `.journey-group` / section kickers:
    /// Cinzel, uppercased + letter-spaced by the caller, muted color.
    static func eyebrow(_ size: CGFloat = 12) -> Font {
        .custom(FontName.cinzel, size: size, relativeTo: .caption2).weight(.semibold)
    }

    /// Narrative body serif — mirrors web `font-family: 'Spectral', serif`.
    static func serif(_ size: CGFloat = 17, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(FontName.spectral, size: size, relativeTo: style)
    }
    static func serifMedium(_ size: CGFloat = 17, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(FontName.spectralMedium, size: size, relativeTo: style)
    }
    static func serifSemibold(_ size: CGFloat = 17, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(FontName.spectralSemibold, size: size, relativeTo: style)
    }
    static func serifItalic(_ size: CGFloat = 17, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(FontName.spectralItalic, size: size, relativeTo: style)
    }

    // Existing zero-arg call sites (FFTheme.section(), .caption()) keep compiling —
    // now backed by the brand type instead of the system font.
    static func title(_ size: CGFloat = 22) -> Font { display(size, weight: .bold, relativeTo: .title2) }
    static func section() -> Font { display(17, weight: .semibold, relativeTo: .headline) }
    static func body() -> Font { serif(17) }
    static func caption() -> Font { serif(13, relativeTo: .caption) }

    // MARK: - Global chrome
    /// Configures nav bar / tab bar chrome once at launch so every screen — List,
    /// Form, or custom — inherits the walnut/parchment identity without per-view
    /// styling. Call once from the App's `init()`. SwiftUI has no equivalent
    /// global proxy for List/Form backgrounds; those opt in per-screen via
    /// `.ffListChrome()` so the change stays scoped to this app's own screens.
    static func configureGlobalAppearance() {
        let walnutUI = UIColor(walnut)
        let creamUI = UIColor(parchment2)
        let mutedCreamUI = UIColor(parchment2).withAlphaComponent(0.6)
        let emeraldUI = UIColor(emerald2)
        let goldUI = UIColor(goldBright)

        let cinzelTitle = UIFont(name: FontName.cinzel, size: 17) ?? .boldSystemFont(ofSize: 17)
        let cinzelLarge = UIFont(name: FontName.cinzel, size: 30) ?? .boldSystemFont(ofSize: 30)
        let cinzelTab = UIFont(name: FontName.cinzel, size: 10) ?? .systemFont(ofSize: 10, weight: .medium)

        // Nav bar — weathered walnut plank, cream title text, thin brass hairline.
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = walnutUI
        nav.titleTextAttributes = [.foregroundColor: creamUI, .font: cinzelTitle]
        nav.largeTitleTextAttributes = [.foregroundColor: creamUI, .font: cinzelLarge]
        nav.shadowColor = goldUI.withAlphaComponent(0.4)
        let navProxy = UINavigationBar.appearance()
        navProxy.standardAppearance = nav
        navProxy.scrollEdgeAppearance = nav
        navProxy.compactAppearance = nav
        navProxy.tintColor = emeraldUI

        // Tab bar — carved walnut rail, muted-cream inactive, glowing meadow active.
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = walnutUI
        let item = UITabBarItemAppearance()
        item.normal.iconColor = mutedCreamUI
        item.normal.titleTextAttributes = [.foregroundColor: mutedCreamUI, .font: cinzelTab]
        item.selected.iconColor = emeraldUI
        item.selected.titleTextAttributes = [.foregroundColor: emeraldUI, .font: cinzelTab]
        tab.stackedLayoutAppearance = item
        tab.inlineLayoutAppearance = item
        tab.compactInlineLayoutAppearance = item
        let tabProxy = UITabBar.appearance()
        tabProxy.standardAppearance = tab
        tabProxy.scrollEdgeAppearance = tab
        tabProxy.tintColor = emeraldUI
    }
}

extension View {
    func ffMinTapTarget() -> some View {
        frame(minWidth: FFTheme.minTapTarget, minHeight: FFTheme.minTapTarget)
            .contentShape(Rectangle())
    }

    /// Parchment card chrome matching web `.card.glass`: cream fill, hairline
    /// border, soft outer shadow. Prefer wrapping content in `FFCard` for new
    /// screens; this modifier is for spots that can't use the container directly.
    func ffCardChrome() -> some View {
        ffAdaptiveCardSurface()
    }

    /// High-contrast parchment treatment. Keeping this in our own design
    /// system also lets the app compile on the stable Xcode SDK used by CI.
    @ViewBuilder
    func ffAdaptiveCardSurface() -> some View {
        self.padding(FFTheme.Space.md)
            .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous).strokeBorder(FFTheme.hairline, lineWidth: 1))
            .shadow(color: FFTheme.walnut.opacity(0.14), radius: 10, x: 0, y: 4)
    }

    @ViewBuilder
    func ffAdaptiveButtonSurface(isDestructive: Bool) -> some View {
        self.background(LinearGradient(colors: isDestructive ? [FFTheme.seal, FFTheme.seal.opacity(0.85)] : [FFTheme.meadow2, FFTheme.meadow], startPoint: .top, endPoint: .bottom), in: Capsule())
    }

    /// Parchment page background behind a List/Form, replacing the default
    /// system grouped background — mirrors web `body { background: var(--parch-0) }`.
    func ffListChrome() -> some View {
        scrollContentBackground(.hidden)
            .background(FFTheme.parchment0.ignoresSafeArea())
    }
}
