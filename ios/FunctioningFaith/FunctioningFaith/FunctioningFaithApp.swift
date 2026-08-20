import SwiftUI

@main
struct FunctioningFaithApp: App {
    @StateObject private var session = NativeSession()
    @StateObject private var biometricLock = BiometricLock()
    @StateObject private var network = NetworkMonitor.shared
    @AppStorage("onboarding.pendingUserID") private var pendingOnboardingUserID = ""
    @Environment(\.scenePhase) private var scenePhase

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
                                .foregroundStyle(.orange)
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
            .tint(FFTheme.accent)
            .task { await session.restore() }
            .onChange(of: scenePhase) { _, phase in
                // Lock when backgrounded; unlock attempt when becoming active again.
                // Skill: interrupted-flow recovery + resumed-session behavior.
                if phase == .background { biometricLock.lockWhenNeeded() }
                if phase == .active && biometricLock.isLocked {
                    Task { _ = await biometricLock.unlock() }
                }
            }
        }
    }
}
