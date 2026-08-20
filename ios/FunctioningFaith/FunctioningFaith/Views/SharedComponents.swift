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
                    .buttonStyle(.borderedProminent)
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
                    .buttonStyle(.borderedProminent)
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
            .padding(FFTheme.Space.md)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
    }
}
