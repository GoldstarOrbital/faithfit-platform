import SwiftUI

@main
struct FunctioningFaithApp: App {
    @UIApplicationDelegateAdaptor(NotificationCoordinator.self) private var notificationCoordinator
    @StateObject private var session = NativeSession()
    @StateObject private var biometricLock = BiometricLock()
    @StateObject private var network = NetworkMonitor.shared
    @StateObject private var deepLinks = DeepLinkRouter()
    @AppStorage("onboarding.pendingUserID") private var pendingOnboardingUserID = ""
    @Environment(\.scenePhase) private var scenePhase

    init() {
        FFTheme.configureGlobalAppearance()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if session.isRestoring {
                    VStack(spacing: FFTheme.Space.md) {
                        ProgressView()
                        Text("Restoring your account…")
                            .font(FFTheme.caption())
                            .foregroundStyle(.secondary)
                        if !network.isOnline {
                            Text("Waiting for a connection…")
                                .font(FFTheme.caption())
                                .foregroundStyle(FFTheme.hearth)
                        }
                    }
                    .padding(FFTheme.Space.lg)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Restoring your account")
                } else if session.isAuthenticated && biometricLock.isLocked {
                    BiometricLockView()
                } else if session.isAuthenticated && session.requiresAccountSetup {
                    NativeAccountSetupView(
                        onComplete: {
                            session.requiresAccountSetup = false
                            if let id = session.profile?.id.uuidString { pendingOnboardingUserID = id }
                        },
                        onSignOut: { Task { await session.signOut() } }
                    )
                } else if session.isAuthenticated {
                    RootTabView()
                } else {
                    NativeAuthView { profile, isNewAccount, requiresAccountSetup in
                        session.profile = profile
                        session.requiresAccountSetup = requiresAccountSetup
                        if isNewAccount && !requiresAccountSetup { pendingOnboardingUserID = profile.id.uuidString }
                    }
                }
            }
            .environmentObject(session)
            .environmentObject(biometricLock)
            .environmentObject(network)
            .environmentObject(deepLinks)
            // Every branded surface is parchment. Respecting a system dark
            // text palette on that fixed light surface produces white-on-white
            // labels, so keep the native app's readable light palette until a
            // complete dark theme exists.
            .preferredColorScheme(.light)
            .tint(FFTheme.accent)
            .task {
                await session.restore()
                await NotificationCoordinator.shared.syncDeviceToken()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { biometricLock.lockWhenNeeded() }
                if phase == .active && biometricLock.isLocked {
                    Task { _ = await biometricLock.unlock() }
                }
            }
            .onOpenURL { url in
                // OAuth callback (functioningfaith://oauth/...) is handled by
                // ASWebAuthenticationSession; other paths go to the router.
                if url.host == "oauth" || url.path.contains("oauth") { return }
                deepLinks.handle(url)
            }
        }
    }
}
