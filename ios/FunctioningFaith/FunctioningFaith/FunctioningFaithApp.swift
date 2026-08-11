import SwiftUI

@main
struct FunctioningFaithApp: App {
    @StateObject private var session = NativeSession()
    @StateObject private var biometricLock = BiometricLock()
    @AppStorage("onboarding.pendingUserID") private var pendingOnboardingUserID = ""
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if session.isRestoring {
                    ProgressView("Restoring your account...")
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
            .task { await session.restore() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { biometricLock.lockWhenNeeded() }
                if phase == .active && biometricLock.isLocked { Task { _ = await biometricLock.unlock() } }
            }
        }
    }
}
