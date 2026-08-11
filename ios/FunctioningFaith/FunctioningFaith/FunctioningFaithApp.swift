import SwiftUI

@main
struct FunctioningFaithApp: App {
    @StateObject private var session = NativeSession()
    @StateObject private var biometricLock = BiometricLock()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if session.isAuthenticated && biometricLock.isLocked {
                    BiometricLockView()
                } else if session.isAuthenticated {
                    RootTabView()
                } else {
                    NativeAuthView { profile in
                        session.profile = profile
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
