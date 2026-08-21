import SwiftUI

/// Design tokens aligned with the Railway web app (`webapp/public/styles.css` :root).
/// Native keeps iOS HIG spacing/touch targets; colors match the parchment / meadow / hearth system.
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

    /// Ink
    static let ink = Color(red: 0x33 / 255, green: 0x25 / 255, blue: 0x1A / 255)       // --ink
    static let inkSoft = Color(red: 0x61 / 255, green: 0x50 / 255, blue: 0x3C / 255)   // --ink-soft
    static let muted = Color(red: 0x8D / 255, green: 0x7A / 255, blue: 0x5F / 255)     // --muted

    /// Meadow / forest (primary accent on web)
    static let meadow = Color(red: 0x6F / 255, green: 0x8F / 255, blue: 0x43 / 255)    // --meadow
    static let meadowDeep = Color(red: 0x48 / 255, green: 0x63 / 255, blue: 0x2F / 255)
    static let emerald = Color(red: 0x7B / 255, green: 0xA8 / 255, blue: 0x4F / 255)

    /// Hearth / brass / gold
    static let hearth = Color(red: 0xD9 / 255, green: 0x9A / 255, blue: 0x3F / 255)    // --hearth
    static let gold = Color(red: 0xB0 / 255, green: 0x8D / 255, blue: 0x46 / 255)      // --gold
    static let goldBright = Color(red: 0xD9 / 255, green: 0xAB / 255, blue: 0x55 / 255) // --gold-2

    /// Seal (destructive / secondary accent)
    static let seal = Color(red: 0xA2 / 255, green: 0x47 / 255, blue: 0x2F / 255)      // --seal

    /// Walnut chrome (tab bar / dark surfaces)
    static let walnut = Color(red: 0x2B / 255, green: 0x1E / 255, blue: 0x12 / 255)    // --walnut-1

    // Semantic aliases used across the shell
    static let accent = meadow
    static let scripture = Color(red: 0x4F / 255, green: 0x72 / 255, blue: 0x39 / 255) // --forest
    static let success = emerald
    static let warning = hearth
    static let danger = seal

    static func title() -> Font { .title2.weight(.bold) }
    static func section() -> Font { .headline }
    static func body() -> Font { .body }
    static func caption() -> Font { .caption }
}

extension View {
    func ffMinTapTarget() -> some View {
        frame(minWidth: FFTheme.minTapTarget, minHeight: FFTheme.minTapTarget)
            .contentShape(Rectangle())
    }

    /// Soft parchment card chrome matching web `.card.glass`.
    func ffCardChrome() -> some View {
        padding(FFTheme.Space.md)
            .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
    }
}
