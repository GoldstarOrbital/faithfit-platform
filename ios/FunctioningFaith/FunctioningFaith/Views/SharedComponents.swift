import SwiftUI

// MARK: - Async edge states (loading / empty / error)
// Built for small screens: clear hierarchy, large tap targets, recovery actions.

enum FFLoadState: Equatable {
    case idle
    case loading
    case loaded
    case empty(title: String, systemImage: String, message: String)
    case failed(String)
}

struct FFLoadingView: View {
    var message: String = "Loading…"

    var body: some View {
        VStack(spacing: FFTheme.Space.md) {
            ProgressView()
            Text(message)
                .font(FFTheme.caption())
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(message)
    }
}

struct FFEmptyStateView: View {
    let title: String
    let systemImage: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(message)
        } actions: {
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.ffPrimary)
                    .ffMinTapTarget()
            }
        }
    }
}

struct FFErrorStateView: View {
    let message: String
    var retryTitle: String = "Try again"
    var onRetry: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label("Something went wrong", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            if let onRetry {
                Button(retryTitle, action: onRetry)
                    .buttonStyle(.ffPrimary)
                    .ffMinTapTarget()
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Generic container: pick the right edge state for a screen body.
struct FFAsyncContainer<Content: View>: View {
    let state: FFLoadState
    var onRetry: (() -> Void)? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        switch state {
        case .idle, .loading:
            FFLoadingView()
        case .loaded:
            content()
        case .empty(let title, let image, let message):
            FFEmptyStateView(title: title, systemImage: image, message: message)
        case .failed(let message):
            FFErrorStateView(message: message, onRetry: onRetry)
        }
    }
}

// MARK: - Section chrome

struct FFSectionHeader: View {
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: FFTheme.Space.xxs) {
            Text(title).font(FFTheme.section())
            if let subtitle {
                Text(subtitle).font(FFTheme.caption()).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Card

struct FFCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .ffCardChrome()
    }
}

// MARK: - Buttons
// Mirror web `button.primary` (meadow gradient pill, cream text, Cinzel label)
// and `button.ghost` (parchment outline).

struct FFPrimaryButtonStyle: ButtonStyle {
    var isDestructive: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(FFTheme.display(15, weight: .semibold, relativeTo: .subheadline))
            .foregroundStyle(FFTheme.cream)
            .padding(.horizontal, FFTheme.Space.md)
            .padding(.vertical, FFTheme.Space.sm)
            .frame(minHeight: FFTheme.minTapTarget)
            .ffAdaptiveButtonSurface(isDestructive: isDestructive)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

struct FFGhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(FFTheme.serifSemibold(15, relativeTo: .subheadline))
            .foregroundStyle(FFTheme.ink)
            .padding(.horizontal, FFTheme.Space.md)
            .padding(.vertical, FFTheme.Space.sm)
            .frame(minHeight: FFTheme.minTapTarget)
            .background(FFTheme.parchment2, in: Capsule())
            .overlay(Capsule().strokeBorder(FFTheme.hairline, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

extension ButtonStyle where Self == FFPrimaryButtonStyle {
    static var ffPrimary: FFPrimaryButtonStyle { FFPrimaryButtonStyle() }
    static var ffDestructive: FFPrimaryButtonStyle { FFPrimaryButtonStyle(isDestructive: true) }
}

extension ButtonStyle where Self == FFGhostButtonStyle {
    static var ffGhost: FFGhostButtonStyle { FFGhostButtonStyle() }
}

// MARK: - Icon badge / quick tile
// Colored-backdrop icon treatment, used to give list rows a stronger visual
// anchor than a flat-tinted SF Symbol — and a horizontal "quick launch" tile
// for the same idea at hero scale (mirrors web `.breathe-orb` / story-ring
// gradients rather than any single flat accent).

struct FFIconBadge: View {
    let systemImage: String
    let tint: Color
    var size: CGFloat = 30

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: size * 0.32, style: .continuous))
    }
}

struct FFQuickTile: View {
    let systemImage: String
    let label: String
    let colors: [Color]

    var body: some View {
        VStack(spacing: FFTheme.Space.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(FFTheme.cream)
                .frame(width: 52, height: 52)
                .background(
                    LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous)
                        .strokeBorder(.white.opacity(0.22), lineWidth: 1)
                )
                .shadow(color: (colors.last ?? .clear).opacity(0.38), radius: 8, x: 0, y: 4)
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(FFTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .frame(width: 78)
    }
}

extension View {
    /// Conic-gradient ring matching web `.story-ring` (silver → emerald → gold sheen).
    func ffGradientRing(lineWidth: CGFloat = 2.5) -> some View {
        padding(lineWidth)
            .overlay(
                Circle().strokeBorder(
                    AngularGradient(
                        colors: [FFTheme.gold, FFTheme.emerald, FFTheme.goldBright, FFTheme.emerald2, FFTheme.gold],
                        center: .center
                    ),
                    lineWidth: lineWidth
                )
            )
    }
}
