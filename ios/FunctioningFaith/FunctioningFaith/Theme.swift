import SwiftUI

/// Design tokens for the native shell. Prefer these over one-off magic numbers
/// so reachability, density, and Dynamic Type stay consistent across screens.
enum FFTheme {
    // MARK: - Spacing (4pt grid — iOS HIG friendly)
    enum Space {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 8
        static let sm: CGFloat = 12
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
        static let xxl: CGFloat = 48
    }

    // MARK: - Touch targets
    /// Minimum interactive size per HIG (44×44).
    static let minTapTarget: CGFloat = 44

    // MARK: - Radii
    enum Radius {
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let pill: CGFloat = 999
    }

    // MARK: - Brand (system-tint friendly; works in light/dark)
    static let accent = Color.orange
    static let scripture = Color.indigo
    static let success = Color.green
    static let warning = Color.orange
    static let danger = Color.red

    // MARK: - Typography helpers that scale with Dynamic Type
    static func title() -> Font { .title2.weight(.bold) }
    static func section() -> Font { .headline }
    static func body() -> Font { .body }
    static func caption() -> Font { .caption }
}

extension View {
    /// Enforces the 44pt minimum touch target without changing visual size of small glyphs.
    func ffMinTapTarget() -> some View {
        frame(minWidth: FFTheme.minTapTarget, minHeight: FFTheme.minTapTarget)
            .contentShape(Rectangle())
    }
}
