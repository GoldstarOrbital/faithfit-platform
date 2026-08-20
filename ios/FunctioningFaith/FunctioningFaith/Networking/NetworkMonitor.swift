import Foundation
import Network
import SwiftUI

/// Observes path reachability so screens can show an offline banner and avoid
/// treating transport failures as “server is broken.” Skill requirement:
/// design for interruption and offline risk on mobile.
@MainActor
final class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()

    @Published private(set) var isOnline: Bool = true
    @Published private(set) var isExpensive: Bool = false
    @Published private(set) var isConstrained: Bool = false

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "app.functioningfaith.network")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isOnline = path.status == .satisfied
                self?.isExpensive = path.isExpensive
                self?.isConstrained = path.isConstrained
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }
}

/// Thin top banner used under the status bar when the path is offline.
struct OfflineBanner: View {
    @EnvironmentObject private var network: NetworkMonitor

    var body: some View {
        if !network.isOnline {
            HStack(spacing: FFTheme.Space.xs) {
                Image(systemName: "wifi.slash")
                    .accessibilityHidden(true)
                Text("You're offline — showing what we have, new actions will retry when you reconnect.")
                    .font(.caption.weight(.medium))
                    .multilineTextAlignment(.leading)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, FFTheme.Space.md)
            .padding(.vertical, FFTheme.Space.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.gradient)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Offline. New actions will retry when you reconnect.")
        }
    }
}
