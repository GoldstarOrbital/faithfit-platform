import SwiftUI
import UIKit

// MARK: - Keyboard behavior

/// One source of truth for keyboard visibility. The app's persistent bottom
/// chrome and its matching content reservation both read this value, so they
/// disappear and return together instead of independently resizing around
/// the keyboard and leaving stretched headers or a stale bottom gap.
@MainActor
final class FFKeyboardState: ObservableObject {
    static let shared = FFKeyboardState()

    @Published private(set) var isVisible = false
    private var observers: [NSObjectProtocol] = []

    private init() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in
            self?.isVisible = true
        })
        observers.append(center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
            self?.isVisible = false
        })
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
    }
}

/// Installs a non-blocking tap recognizer on the app window. Tapping outside
/// the active field dismisses every keyboard type (including number pads that
/// have no Return key) while the original tap still reaches buttons and links.
struct FFKeyboardDismissBridge: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.isUserInteractionEnabled = false
        DispatchQueue.main.async { context.coordinator.install(from: view) }
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        DispatchQueue.main.async { context.coordinator.install(from: uiView) }
    }

    static func dismantleUIView(_ uiView: UIView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private weak var window: UIWindow?
        private lazy var recognizer: UITapGestureRecognizer = {
            let recognizer = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
            recognizer.cancelsTouchesInView = false
            recognizer.delegate = self
            return recognizer
        }()

        func install(from view: UIView) {
            guard let window = view.window, self.window !== window else { return }
            uninstall()
            self.window = window
            window.addGestureRecognizer(recognizer)
        }

        func uninstall() {
            window?.removeGestureRecognizer(recognizer)
            window = nil
        }

        @objc private func dismissKeyboard() {
            window?.endEditing(true)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            // SwiftUI's TextField is wrapped in private hosting views. On the
            // first tap those wrappers can be reported instead of the actual
            // UITextField, so an unconditional recognizer immediately ended
            // the edit session it had just started and no keyboard appeared.
            // An outside-tap dismissal only makes sense when something was
            // already editing before this touch began.
            guard window?.ffFirstResponder != nil else { return false }
            var view = touch.view
            while let current = view {
                if current is UITextField || current is UITextView || current is UIControl { return false }
                view = current.superview
            }
            return true
        }
    }
}

private extension UIView {
    var ffFirstResponder: UIView? {
        if isFirstResponder { return self }
        for child in subviews {
            if let responder = child.ffFirstResponder { return responder }
        }
        return nil
    }
}

// MARK: - Member avatar

/// A member's real profile photo, fetched lazily -- matches the circle +
/// meadow-gradient-placeholder treatment already used inline in
/// MemberProfileView/ProfileView/EditProfileView, pulled out so the feed and
/// the DM inbox (which previously showed only a generic person icon or bare
/// initials, never the real photo) can share the exact same look and fetch
/// path instead of each growing its own copy.
///
/// `hasAvatar` must come from whatever list/feed response already carries it
/// (author_has_avatar, other_has_avatar, etc.) -- this view never guesses
/// whether a fetch is worth attempting, it only skips one when told there's
/// definitely nothing to fetch.
struct MemberAvatarView: View {
    let userID: UUID
    let hasAvatar: Bool
    var size: CGFloat = 36
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.45))
                    .foregroundStyle(FFTheme.cream)
            }
        }
        .frame(width: size, height: size)
        .background(LinearGradient(colors: [FFTheme.meadow2, FFTheme.meadowDeep], startPoint: .topLeading, endPoint: .bottomTrailing), in: Circle())
        .clipShape(Circle())
        .accessibilityHidden(true)
        // id: userID -- a recycled row (List/LazyVStack) reusing this view
        // for a different person must re-fetch, not keep showing whichever
        // photo happened to load first for that view identity.
        .task(id: userID) {
            image = nil
            guard hasAvatar else { return }
            if let dataURL = await MemberAvatarCache.shared.dataURL(for: userID, hasAvatar: hasAvatar) {
                image = ImageUpload.decode(dataURL)
            }
        }
    }
}

// MARK: - Async edge states (loading / empty / error)
// Built for small screens: clear hierarchy, large tap targets, recovery actions.

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
