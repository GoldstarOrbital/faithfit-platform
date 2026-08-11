import LocalAuthentication
import SwiftUI

@MainActor
final class BiometricLock: ObservableObject {
    @Published private(set) var isLocked: Bool

    init(defaults: UserDefaults = .standard) {
        isLocked = defaults.bool(forKey: "security.biometricLock")
    }

    var isEnabled: Bool { UserDefaults.standard.bool(forKey: "security.biometricLock") }

    func lockWhenNeeded() {
        if isEnabled { isLocked = true }
    }

    func unlock() async -> Bool {
        guard isEnabled else { isLocked = false; return true }
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return false }
        do {
            let allowed = try await context.evaluatePolicy(.deviceOwnerAuthentication,
                localizedReason: "Unlock your Functioning Faith account")
            if allowed { isLocked = false }
            return allowed
        } catch { return false }
    }

    func requestEnable() async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return false }
        do {
            let allowed = try await context.evaluatePolicy(.deviceOwnerAuthentication,
                localizedReason: "Enable biometric protection for Functioning Faith")
            UserDefaults.standard.set(allowed, forKey: "security.biometricLock")
            return allowed
        } catch { return false }
    }
}

struct BiometricLockView: View {
    @EnvironmentObject private var lock: BiometricLock

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "lock.shield.fill").font(.system(size: 48)).foregroundStyle(.tint)
            Text("Functioning Faith is locked").font(.title2.bold())
            Text("Use Face ID, Touch ID, or your device passcode to continue.").multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Unlock") { Task { _ = await lock.unlock() } }.buttonStyle(.borderedProminent)
        }.padding(30).task { _ = await lock.unlock() }
    }
}
